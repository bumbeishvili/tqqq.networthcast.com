"""Split guard for the daily refresh (incremental_refresh in update_data.py).

When a fund splits or pays a dividend, Yahoo re-scales the whole adjusted
history it serves. The refresh copies a fund's real rows from Yahoo and keeps
the reconstructed rows before its launch as they are, so two things went wrong:

  - the reconstructed rows stayed on the old scale: a step on the fund's first
    real day, a fraction of a percent after a dividend and the split's full
    size after a split;
  - for about a day after a split, Yahoo's history is not in one piece. On
    SOXX's 3-for-1 of 2026-11-05 it showed, in turn: the new price on the old
    history (a false -68% day); a history adjusted unevenly (the rows of 2001
    down 78%, last month's down 67%); three recent rows back on the old basis
    (a false +189% and a false -70%); and the right history the next morning.
    The refresh wrote each of those into the file as it came.

plan_refresh decides what to write from two lists of (day, close), the file's
rows and Yahoo's, both oldest first:

  - nothing unusual: Yahoo's rows, and the reconstructed rows times the factor
    Yahoo applied to its history (1 on most days, about 0.999 after a
    dividend);
  - a split listed in the last RECENT_DAYS days and Yahoo's history not in one
    piece: the file's own rows before the split day (times the split's price
    factor, once, while they are still on the old basis), then Yahoo's rows
    from the split day on. Yahoo's history is taken again once it agrees with
    the file's up to one factor;
  - something unusual and no split listed: Yahoo's rows as served, with a line
    in the log.

Every split found goes into data/splits.tsv (note_splits). That file is how a
split gets noticed: the refresh workflow puts a new row of it into the commit
subject.

tests/split-guard-replay.py replays the SOXX day from this repo's history.
"""
import collections
import math
import os
import statistics

# Yahoo serves adjusted closes as float32: two fetches of an unchanged history
# differ by up to 1.4e-06 (NOISE_REL in update_data.py). A dividend re-scales
# the history by about 1e-03. A factor past RESCALE_REL is a real re-adjustment.
RESCALE_REL = 5e-5
# One re-adjustment moves every older row by the same factor. A row further
# than UNEVEN_REL from that factor did not get it; more than UNEVEN_SHARE of
# such rows means the history is mid-adjustment (a handful are Yahoo's
# corrections of single old rows, which are taken as they come).
UNEVEN_REL = 1e-4
UNEVEN_SHARE = 0.005
# Yahoo applies an adjustment to the newest rows last, so they are left out of
# the factor, and they are the rows searched for a split-sized move.
SETTLE_ROWS = 10
# A factor this far from 1 is a split. The largest dividend here is under 3%.
SPLIT_SIZED = 0.1
# A one-day move past this, either way (under x0.6 or over x1.67), is checked
# against Yahoo's split list. No real day of these funds has reached it (the
# largest is SOXL's -38.7% of 2026-11-05) and a 2-for-1 on an ordinary day is
# past it. One may yet, so with no split listed the rows are written as served.
JUMP = 0.4
# How many days back a split counts as the reason for an unusual history.
RECENT_DAYS = 15
# Across the split day, the file's last row before it and Yahoo's first row from
# it differ by the split's price factor while the file is on the old basis, and
# by an ordinary day's move once it is on the new one. Each is recognised
# within this band.
BASIS_BAND = 0.25

REGISTRY_HEADER = 'Fund\tDay\tSplit\tNoted'

# kept: the rows to write first (None: leave the file as it is). start: Yahoo's
# rows from this position follow them. note: what was unusual, '' when nothing.
Plan = collections.namedtuple('Plan', 'kept start note')


def history_factor(file_real, fresh):
    """How Yahoo's history compares with the file's, over the days both hold
    except the file's newest SETTLE_ROWS: (factor, uneven share). The factor is
    the median of Yahoo/file over the oldest 60 such days, the ones that meet
    the reconstructed rows. The uneven share is the part of all such days whose
    ratio is not that factor."""
    served = dict(fresh)
    ratios = [served[day] / close for day, close in file_real[:-SETTLE_ROWS] if day in served and close > 0]
    if not ratios:
        return 1.0, 0.0
    factor = statistics.median(ratios[:60])
    return factor, sum(1 for r in ratios if abs(r / factor - 1) > UNEVEN_REL) / len(ratios)


def newest_jump(fresh):
    """The largest one-day move past JUMP among Yahoo's newest SETTLE_ROWS + 1
    rows, as (day, close / prior close); None when every move is ordinary."""
    tail = fresh[-(SETTLE_ROWS + 1):]
    moves = [(tail[i][0], tail[i][1] / tail[i - 1][1]) for i in range(1, len(tail))]
    big = [m for m in moves if m[1] < 1 - JUMP or m[1] > 1 / (1 - JUMP)]
    return max(big, key=lambda m: abs(math.log(m[1]))) if big else None


def _scaled(rows, factor):
    return rows if factor == 1.0 else [(day, close * factor) for day, close in rows]


def plan_refresh(file_rows, fresh, recent_split):
    """What to write for one fund: a Plan. `file_rows` are the file's rows,
    `fresh` Yahoo's, both [(day, close)] oldest first. `recent_split()` is
    called only when something is unusual and returns the newest split Yahoo
    lists in the last RECENT_DAYS days as (day, shares ratio: 3.0 for a
    3-for-1), or None."""
    first_real = fresh[0][0]
    prefix = [r for r in file_rows if r[0] < first_real]
    real = [r for r in file_rows if r[0] >= first_real]
    seam, uneven = history_factor(real, fresh)
    jump = newest_jump(fresh)
    factor = seam if abs(seam - 1) > RESCALE_REL else 1.0
    if uneven <= UNEVEN_SHARE and jump is None and abs(seam - 1) < SPLIT_SIZED:
        note = '' if factor == 1.0 else f'Yahoo re-adjusted its history x{factor:.6f} (a dividend); the reconstructed rows follow'
        return Plan(_scaled(prefix, factor), 0, note)

    seen = ', '.join(part for part in (
        f'history x{seam:.4f}' if abs(seam - 1) >= SPLIT_SIZED else '',
        f'{uneven:.0%} of the history changed unevenly' if uneven > UNEVEN_SHARE else '',
        f'{jump[1] - 1:+.0%} on {jump[0]:%Y-%m-%d}' if jump else '',
    ) if part)
    split = recent_split()
    if split is None:
        return Plan(_scaled(prefix, factor), 0, f'{seen}; Yahoo lists no split in the last {RECENT_DAYS} days, written as served')

    day, shares = split
    price_factor = 1 / shares
    if uneven <= UNEVEN_SHARE and jump is None:
        return Plan(_scaled(prefix, factor), 0, f"split of {day:%Y-%m-%d}: Yahoo's history is in one piece on the new basis ({seen})")
    before = [r for r in file_rows if r[0] < day]
    start = next((i for i, r in enumerate(fresh) if r[0] >= day), None)
    if not before or start is None:
        return Plan(None, 0, f'split of {day:%Y-%m-%d}: no row on one side of it; the file is left as it is ({seen})')
    step = fresh[start][1] / before[-1][1]
    if abs(step / price_factor - 1) < BASIS_BAND and abs(step - 1) >= BASIS_BAND:
        return Plan(_scaled(before, price_factor), start, f"split of {day:%Y-%m-%d}: our rows before it x{price_factor:.4f}; Yahoo's history is not in one piece yet ({seen})")
    if abs(step - 1) < BASIS_BAND:
        return Plan(before, start, f"split of {day:%Y-%m-%d}: our rows before it held as they are; Yahoo's history is not in one piece yet ({seen})")
    return Plan(None, 0, f'split of {day:%Y-%m-%d}: cannot tell which basis the file is on (x{step:.3f} across the split day); the file is left as it is')


def split_label(shares):
    """Yahoo's shares ratio in words: 3.0 -> '3-for-1', 0.2 -> '1-for-5 reverse'."""
    return f'{shares:g}-for-1' if shares >= 1 else f'1-for-{1 / shares:g} reverse'


def read_splits(path):
    """data/splits.tsv as rows of [fund, day, split, noted]; [] before the file exists."""
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [line.rstrip('\n').split('\t') for line in f.readlines()[1:] if line.strip()]


def note_splits(path, fund, listed, noted):
    """Add to data/splits.tsv every split of `listed`, [(day 'YYYY-MM-DD',
    shares ratio)], that `fund` has no row for, stamped `noted`. Funds keep the
    order they first appear in, days ascend within a fund. Returns the rows
    added."""
    rows = read_splits(path)
    have = {(r[0], r[1]) for r in rows}
    added = [[fund, day, split_label(shares), noted] for day, shares in listed if (fund, day) not in have]
    if added:
        order = {}
        for r in rows + added:
            order.setdefault(r[0], len(order))
        rows = sorted(rows + added, key=lambda r: (order[r[0]], r[1]))
        with open(path, 'w') as f:
            f.write(REGISTRY_HEADER + '\n')
            f.writelines('\t'.join(r) + '\n' for r in rows)
    return added
