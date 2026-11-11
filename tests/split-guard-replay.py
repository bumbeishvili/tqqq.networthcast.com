"""Checks scripts/split_guard.py: made-up cases, then SOXX's real split day.

    python3 tests/split-guard-replay.py

SOXX split 3-for-1 on 2026-11-05. The hourly refresh of that day copied Yahoo's
rows into data/synthetic-soxx.tsv as they came, so this repo's history holds
what Yahoo served at each run: commits 4d6644f (the evening before) to f65118f
(the next day's close). The replay starts from the first and feeds each later
one to plan_refresh as Yahoo's rows, the way the refresh would have met them.

Reads git history; writes nothing in the repo and asks no network.
"""
import datetime
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from split_guard import note_splits, plan_refresh, read_splits, split_label   # noqa: E402

failed = []


def check(name, ok, detail=''):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{' | ' + detail if detail else ''}")
    if not ok:
        failed.append(name)


def scaled(rows, factor):
    return [(day, close * factor) for day, close in rows]


def same(a, b):
    return a is not None and len(a) == len(b) and all(x[0] == y[0] and abs(x[1] / y[1] - 1) < 1e-9 for x, y in zip(a, b))


def never():
    raise AssertionError('the split list must not be asked')


# ---- made-up cases -------------------------------------------------------
START = datetime.date(2020, 1, 1)
days = [START + datetime.timedelta(days=i) for i in range(301)]
file_rows = [(days[i], 100 * 1.001 ** i * (1 + 0.01 * ((i * 7) % 11 - 5) / 5)) for i in range(300)]
prefix, real = file_rows[:100], file_rows[100:]
next_day, last_close = days[300], real[-1][1]

p = plan_refresh(file_rows, [(d, c * (1 + (i % 3 - 1) * 1e-6)) for i, (d, c) in enumerate(real)], never)
check('unchanged history with float wobble', same(p.kept, prefix) and p.start == 0 and p.note == '', p.note)

p = plan_refresh(file_rows, scaled(real[:-1], 0.998) + [real[-1]], never)
check('dividend: the reconstructed rows follow', same(p.kept, scaled(prefix, 0.998)) and p.start == 0 and 'dividend' in p.note, p.note)

p = plan_refresh(file_rows, real + [(next_day, last_close * 0.59)], lambda: None)
check('a real -41% day, no split listed: written as served', same(p.kept, prefix) and p.start == 0 and 'written as served' in p.note, p.note)

p = plan_refresh(file_rows, scaled(real, 0.5), lambda: (days[295], 2.0))
check('split already settled at Yahoo (the refresh was down)', same(p.kept, scaled(prefix, 0.5)) and p.start == 0 and 'in one piece' in p.note, p.note)

split_day = real + [(next_day, last_close * 0.5 * 1.02)]
p = plan_refresh(file_rows, split_day, lambda: (next_day, 2.0))
check('split day, Yahoo still on the old history: our rows halved', same(p.kept, scaled(file_rows, 0.5)) and p.start == len(real) and 'x0.5000' in p.note, p.note)

after = p.kept + split_day[p.start:]
p = plan_refresh(after, split_day, lambda: (next_day, 2.0))
check('the same run again: not halved twice', same(p.kept, scaled(file_rows, 0.5)) and p.start == len(real) and 'held as they are' in p.note, p.note)

p = plan_refresh(after, scaled(real, 0.5) + [(next_day, last_close * 0.5 * 1.03)], never)
check('Yahoo settled: back to its rows, nothing to say', same(p.kept, scaled(prefix, 0.5)) and p.start == 0 and p.note == '', p.note)

p = plan_refresh(file_rows, real + [(next_day, last_close * 5 * 0.97)], lambda: (next_day, 0.2))
check('reverse split 1-for-5: our rows times five', same(p.kept, scaled(file_rows, 5)) and p.start == len(real), p.note)

p = plan_refresh(file_rows, real + [(next_day, last_close * 0.30)], lambda: (next_day, 2.0))
check('split listed but the step fits neither basis: the file is left alone', p.kept is None and 'cannot tell' in p.note, p.note)

check('split words', split_label(3.0) == '3-for-1' and split_label(0.2) == '1-for-5 reverse' and split_label(15.0) == '15-for-1', f"{split_label(3.0)}, {split_label(0.2)}, {split_label(15.0)}")

with tempfile.TemporaryDirectory() as folder:
    registry = os.path.join(folder, 'splits.tsv')
    first = note_splits(registry, 'TQQQ', [('2022-01-13', 2.0), ('2025-11-20', 2.0)], 'seed')
    second = note_splits(registry, 'SQQQ', [('2025-11-20', 0.2)], 'seed')
    third = note_splits(registry, 'TQQQ', [('2022-01-13', 2.0), ('2025-11-20', 2.0), ('2027-01-14', 2.0)], 'found now')
    rows = read_splits(registry)
    check('registry: only the missing split is added, funds keep their order',
          len(first) == 2 and len(second) == 1 and third == [['TQQQ', '2027-01-14', '2-for-1', 'found now']]
          and [r[:2] for r in rows] == [['TQQQ', '2022-01-13'], ['TQQQ', '2025-11-20'], ['TQQQ', '2027-01-14'], ['SQQQ', '2025-11-20']],
          f'{len(rows)} rows')


# ---- SOXX, 2026-11-05, from this repo's history -----------------------------
def git(*args):
    return subprocess.run(['git', '-C', ROOT, *args], check=True, capture_output=True, text=True).stdout


def rows_at(commit):
    out = []
    for line in git('show', f'{commit}:data/synthetic-soxx.tsv').splitlines()[1:]:
        stamp, close = line.split('\t')
        month, day, year = stamp.split(' ')[0].split('/')
        out.append((datetime.date(int(year), int(month), int(day)), float(close)))
    return out


def worst_recent_move(rows):
    return max(abs(rows[i][1] / rows[i - 1][1] - 1) for i in range(len(rows) - 12, len(rows)))


def seam_move(rows):
    i = next(k for k, r in enumerate(rows) if r[0] >= FIRST_REAL)
    return rows[i][1] / rows[i - 1][1] - 1


FIRST_REAL = datetime.date(2001, 7, 13)
SPLIT = (datetime.date(2026, 11, 5), 3.0)
commits = [line.split('\t') for line in git('log', '--reverse', '--format=%h%x09%s', '4d6644f^..f65118f', '--', 'data/synthetic-soxx.tsv').splitlines()]

for list_is_late in (False, True):
    print(f"\nSOXX 3-for-1, replayed{' with the split list one run late' if list_is_late else ''}: run | newest rows | worst move in the last 12 rows, ours vs as written then | note")
    state, runs, worst, seam_start = None, 0, 0.0, None
    for commit, subject in commits:
        if state is None:
            state, seam_start = rows_at(commit), seam_move(rows_at(commit))
            continue
        if not subject.startswith('Refresh market data'):
            continue
        served = rows_at(commit)
        fresh = [r for r in served if r[0] >= FIRST_REAL]
        runs += 1
        plan = plan_refresh(state, fresh, lambda: None if list_is_late and runs == 1 else SPLIT)
        if plan.kept is not None:
            state = plan.kept + fresh[plan.start:]
        if not (list_is_late and runs == 1):
            worst = max(worst, worst_recent_move(state))
        print(f"  {subject[20:36]} | {'  '.join(f'{d:%m-%d} {c:.2f}' for d, c in state[-4:])} | {worst_recent_move(state):.1%} vs {worst_recent_move(served):.1%} | {plan.note or 'nothing unusual'}")
    check(f"SOXX{' (list late)' if list_is_late else ''}: no false move reaches the file once the split is listed", worst < 0.25, f'worst {worst:.1%}')
    check(f"SOXX{' (list late)' if list_is_late else ''}: the first real day still meets the reconstructed rows", abs(seam_move(state) - seam_start) < 1e-6, f'{seam_move(state):.2%} at the end, {seam_start:.2%} at the start')
    check(f"SOXX{' (list late)' if list_is_late else ''}: Yahoo's rows are taken again once it settles", plan.note == '' and plan.start == 0)

print(f"\n{'ALL PASSED' if not failed else 'FAILED: ' + '; '.join(failed)}")
sys.exit(1 if failed else 0)
