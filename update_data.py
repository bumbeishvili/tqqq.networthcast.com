#!/usr/bin/env python3
"""
Fetches daily closing prices for QQQ, QLD, TQQQ, SPY, SSO, SPXL, and SQQQ
from Yahoo Finance and short-term interest rates from FRED, then writes them
as TSV files consumed by index.html.

Two modes. The default (no flags, what the cron runs) is an incremental
refresh: replace the post-IPO tail of the seven price TSVs with fresh
yfinance bars, copy the committed pre-IPO synthesized prefix through
untouched, never touch FRED. --rebuild runs the full synthesis below.
--refresh-rates re-pulls the FRED TSVs (three rate files + nfci.tsv); nothing else does.

Pre-IPO history is fabricated by walking actual daily index values backward
from each ETF's first real trading day, applying the leveraged-return-minus-
expense formula PLUS the financing-cost correction for leveraged ETFs:

    synth[t-1] = synth[t] / (1 + L × ret − (L-1) × rate_daily − expense_daily)

The (L-1) × rate_daily term reflects the interest cost real leveraged ETFs
pay on the borrowed portion of their notional exposure. Empirically the
naive formula (no rate term) overstates real TQQQ by ≈2 × short_rate per
year — verified by regressing 2010-present naive-vs-real drift against Fed
Funds rate: slope 1.998 (theory predicts exactly 2.0), R² 0.97.

Sources used:

  ^NDX  base series   ← local ^ndx_d.csv (Stooq, back to 1938-01-03), NOT
                          committed to the repo. read_ndx_csv() returns [] when
                          it is absent, so a --rebuild without it reaches only
                          as far back as yfinance ^NDX (1985-10-01). Merged with
                          yfinance ^NDX, which overrides the CSV on overlaps.
  ^GSPC, ^SP500TR, QQQ, QLD, TQQQ, SPY, SSO, SPXL, SQQQ, QQQ-raw  ← yfinance
  DFF  (daily 1954+)  ← FRED  — Fed Funds Effective Rate, the swap-counterparty
                                financing reference for leveraged ETFs
  TB3MS (monthly 1934+) ← FRED — 3-month T-bill, used as the pre-1954 proxy

Synthesis formulas:

  QQQ  pre-1999       ← extended ^NDX                (1× − QQQ expense)
  QLD  pre-1999       ← extended ^NDX                (2× − 1×rate − QLD exp)
  QLD  1999 → 2006    ← derived NDX-TR               (2× − 1×rate − QLD exp)
  TQQQ pre-1999       ← extended ^NDX                (3× − 2×rate − TQQQ exp)
  TQQQ 1999 → 2010    ← derived NDX-TR               (3× − 2×rate − TQQQ exp)
                        = ^NDX × QQQ_adj / QQQ_raw
  SPY  pre-1988       ← ^GSPC, clipped to NDX start  (1× − SPY expense)
  SPY  1988 → 1993    ← ^SP500TR                     (1× − SPY expense)
  SSO  pre-1988       ← ^GSPC                        (2× − 1×rate − SSO exp)
  SSO  1988 → 2006    ← ^SP500TR                     (2× − 1×rate − SSO exp)
  SPXL pre-1988       ← ^GSPC                        (3× − 2×rate − SPXL exp)
  SPXL 1988 → 2008    ← ^SP500TR                     (3× − 2×rate − SPXL exp)
  SQQQ pre-1999       ← extended ^NDX                (inverse model, below)
  SQQQ 1999 → 2010    ← derived NDX-TR               (inverse model, below)

The three ^GSPC fallbacks are clipped to the extended-^NDX start date, not to
1985. With ^ndx_d.csv present that is 1938, and the committed TSVs carry it
from their 1953 first row. So every S&P-based series is price-only for roughly
35 years, not for a couple of years — see the bias note below.

QQQ and SPY have leverage 1, so (L-1) × rate = 0 — no financing-cost term.
QLD, TQQQ, SSO, and SPXL get the rate correction, each at the benchmark rate
plus its own swap spread (see the calibration block below). SQQQ is inverse
and earns rather than pays: it uses walk_backward_inverse(), not walk_backward().

The local ^ndx_d.csv extends pre-1985 history. The actual NASDAQ-100 index
didn't exist before 1985-01-31, so values before that are a back-reconstruction
by the data provider. Treat pre-1985 synth QQQ/TQQQ as "what would have been"
not "what was".

The "derived NDX-TR" trick: real QQQ_adj returns ≈ NDX-TR − QQQ_exp; real
QQQ_raw (split-adjusted only, no dividend reinvestment) returns ≈ NDX − QQQ_exp.
Multiplying ^NDX × (QQQ_adj/QQQ_raw) cancels the QQQ_exp from both sides and
recovers a daily NDX-TR series straight from real market data — not an
annualized estimate. This is what lets the TQQQ 1999-2010 phase track real
TQQQ to within QQQ's small tracking error instead of the −0.6%/yr structural
drift you'd get from chaining through QQQ_adj directly.

Known biases (after the financing-cost correction and swap spreads):

  - For pre-1999 QQQ, QLD, TQQQ, and SQQQ we have only ^NDX (price-only) —
    Yahoo lists ^XNDX (NDX Total Return) but serves no history for it;
    NASDAQ.com's API, NASDAQ Data Link, Stooq, Tiingo, EODHD, Alpha Vantage
    all gate it. Dividends contributed 0.690 pp/yr to QQQ over 1999-2026,
    so pre-1999 synth QQQ runs ~0.7%/yr light and synth TQQQ ~2%/yr.
  - SPY, SSO, and SPXL use price-only ^GSPC from the files' 1953 start to
    ^SP500TR's 1988-01-04 first bar. The ^SP500TR-vs-^GSPC premium shrinks
    as dividend yields fall: 3.97 pp/yr over 1988-1990, 3.70 over 1988-1993,
    2.92 over 1988-2000, 1.82 over 2000-2010, 2.30 over the full 1988-2026
    overlap. The windows next to the gap are the applicable ones and
    pre-1988 yields were higher still, so the 1953-1988 stretch runs
    ~3.7-4.0 pp/yr light at 1×, and L × that leveraged. Longest-span bias
    in the dataset.
  - Swap spreads (TQQQ_SWAP_SPREAD etc.) now carry what used to be logged
    here as an unmodeled ~1.3 pp/yr residual. TQQQ's 0.65%/yr was fitted to
    absorb that residual outright, so nothing measurable is left over for
    TQQQ. QLD/SSO/SPXL spreads are unregressed estimates: their residual is
    unmeasured, not zero.
  - Still unmodeled inside those estimates: NAV-vs-market price deviation
    and daily rebalancing slippage on QLD, SSO, and SPXL.

Usage:
    python3 update_data.py                    # incremental price refresh
    python3 update_data.py --refresh-rates    # re-pull FRED rate TSVs
    python3 update_data.py --rebuild          # full synthesis from scratch
"""
import csv
import io
import os
import sys
import time
import urllib.request
from datetime import timedelta

try:
    import yfinance as yf
except ImportError:
    print("yfinance not installed. Run: pip install yfinance")
    sys.exit(1)

basedir = os.path.dirname(os.path.abspath(__file__))

QQQ_EXPENSE_DAILY  = 0.0020   / 252  # 0.20%   annual
QLD_EXPENSE_DAILY  = 0.0095   / 252  # 0.95%   annual (ProShares Ultra QQQ, 2×)
TQQQ_EXPENSE_DAILY = 0.0088   / 252  # 0.88%   annual
SPY_EXPENSE_DAILY  = 0.000945 / 252  # 0.0945% annual
SSO_EXPENSE_DAILY  = 0.0087   / 252  # 0.87%   annual (ProShares Ultra S&P500, 2×)
SPXL_EXPENSE_DAILY = 0.0095   / 252  # 0.95%   annual (Direxion Daily S&P500 Bull 3×)
# === Swap-spread calibration ==============================================
# Real leveraged ETFs pay their swap counterparty something HIGHER than the
# bare Fed Funds rate. The spread reflects counterparty risk premium, swap
# desk margin, and product-specific friction. Empirically calibrated by
# regressing real (yfinance) returns against the naive (L × index − (L-1)×DFF
# − TER) prediction:
#   QLD  (2×): 0.50%/yr   — uncalibrated estimate; ProShares-standard 2× is
#                            the most liquid leverage tier, tighter swap pricing
#                            than 3×. Refine via regression once a few years of
#                            real data have been logged against the naive synth.
#   SSO  (2× S&P): 0.50%/yr — uncalibrated estimate; SPY swaps are the deepest
#                            equity-swap market, so we mirror QLD's 2× spread.
#   TQQQ (3×): 0.65%/yr   — original code's residual 1.3 pp/yr ÷ 2
#   SPXL (3× S&P): 0.50%/yr — uncalibrated estimate; SPY 3× swaps are tighter
#                            than QQQ-based 3× because S&P swaps are deeper.
QLD_SWAP_SPREAD   = 0.005
SSO_SWAP_SPREAD   = 0.005
TQQQ_SWAP_SPREAD  = 0.0065
SPXL_SWAP_SPREAD  = 0.005

# === Inverse (-3x) model, calibrated ======================================
# A -3x fund is short 3 units of index and therefore sits on (1+L)=4 units of
# cash earning the short rate. Regressing (real SQQQ daily + 3 x NDX-TR daily)
# on the daily short rate over 2010-02-11..2026-07-31 gives a slope of 4.028 --
# theory predicts exactly 4.0 -- and an intercept of -1.537 %/yr covering the
# 0.95 % management fee plus swap spread and rebalancing slippage.
# Replaying the fitted model forward from SQQQ's first real close tracks the
# real fund to within -6.4 % / +1.9 % cumulative over 16.5 years.
SQQQ_INVERSE_LEVERAGE = 3
SQQQ_CASH_MULTIPLE    = 4.028      # fitted; theory = L + 1
SQQQ_DRAG_DAILY       = -6.099e-05 # fitted intercept (~ -1.537 %/yr)

# === Financing-cost model =================================================
# A leveraged ETF holding $1 of investor NAV achieves $L of index exposure by
# borrowing the extra $(L-1) of synthetic exposure via total-return swap. The
# bank charges interest on that borrowed amount; the fund's cash collateral
# earns roughly the same short rate, leaving a net daily drag of
# (L-1) × short_rate. Empirically verified against 2010-present TQQQ data:
# regression of (naive synth − real) on Fed Funds rate gives slope ≈ 2.0
# (theory predicts exactly 2 for L=3), R² ≈ 0.97.
# Rate source: FRED DFF (Fed Funds Effective, daily from 1954) + TB3MS
# (3-month T-bill, monthly from 1934) as pre-Fed-Funds-market proxy.
DFF_START   = '1954-07-01'
TBMS_START  = '1934-01-01'

DATA_DIR = 'data'

tickers = [
    ('QQQ',    'synthetic-qqq.tsv'),
    ('QLD',    'synthetic-qld.tsv'),
    ('TQQQ',   'synthetic-tqqq.tsv'),
    ('SPY',    'spy.tsv'),
    ('SSO',    'synthetic-sso.tsv'),
    ('SPXL',   'synthetic-spxl.tsv'),
    ('SQQQ',   'synthetic-sqqq.tsv'),
]


def cell(value):
    return float(value.iloc[0]) if hasattr(value, 'iloc') else float(value)


def normalize_ts(ts):
    """Snap a pandas Timestamp to tz-naive midnight so dates from yfinance
    (tz-aware) match dates from the local CSV (tz-naive)."""
    import pandas as pd
    if hasattr(ts, 'tz') and ts.tz is not None:
        ts = ts.tz_localize(None)
    return pd.Timestamp(ts.year, ts.month, ts.day)


def df_to_pairs(df):
    """yfinance DataFrame -> list of (tz-naive Timestamp, close), chronological."""
    return [(normalize_ts(date), cell(row['Close'])) for date, row in df.iterrows()]


def read_ndx_csv():
    """Read local ^ndx_d.csv (Stooq-style: Date,Open,High,Low,Close,Volume).
    Returns [(tz-naive Timestamp, close)] sorted by date."""
    import pandas as pd
    csv_path = os.path.join(basedir, '^ndx_d.csv')
    if not os.path.exists(csv_path):
        return []
    pairs = []
    with open(csv_path) as f:
        next(f)
        for line in f:
            parts = line.strip().split(',')
            if len(parts) < 5:
                continue
            try:
                pairs.append((pd.Timestamp(parts[0]), float(parts[4])))
            except (ValueError, TypeError):
                continue
    pairs.sort(key=lambda x: x[0])
    return pairs


def extend_with_csv(yf_pairs, csv_pairs):
    """Use yfinance values wherever they exist; fall back to CSV for older
    dates that yfinance doesn't cover."""
    yf_map = dict(yf_pairs)
    yf_first = min(yf_map.keys()) if yf_map else None
    if yf_first is None:
        return csv_pairs
    pre = [(d, c) for d, c in csv_pairs if d < yf_first]
    return pre + sorted(yf_map.items())


def fmt_close(value):
    """12 significant figures, general format. Preserves precision for the
    very small values that show up at the start of long backward synthesis
    chains (e.g., TQQQ 1938 ≈ 1e-9). Falls back to scientific notation when
    fixed decimals would lose information."""
    return f'{value:.12g}'


def read_rate_tsv(path):
    """Inverse of write_rate_tsv: parse a cached rate TSV back into
    [(Timestamp, value_percent)]. Used as a fallback when FRED is
    unreachable so the daily refresh doesn't crash."""
    import pandas as pd
    out = []
    if not os.path.exists(path):
        return out
    with open(path) as f:
        next(f, None)  # skip header
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 2:
                continue
            try:
                date_str = parts[0].split(' ')[0]
                m, d, y = date_str.split('/')
                out.append((pd.Timestamp(int(y), int(m), int(d)), float(parts[1])))
            except (ValueError, TypeError):
                continue
    return out


def fetch_fred(series_id, start_date, fallback_path=None, attempts=3, force_remote=False):
    """Return a FRED daily/monthly rate series as [(Timestamp, value_percent)].

    Cache-first: if `fallback_path` exists and has rows, return it without
    touching the network. The series we use (DFF, TB3MS) are historical
    rates — their pre-today values never change, and today's value barely
    matters for the synthesis. The cron should not depend on FRED's uptime.

    `force_remote=True` (set via the --refresh-rates CLI flag) bypasses the
    cache and pulls from FRED with retry + final cache fallback on failure.
    Use this when you genuinely need fresh rates (e.g. updating the rate
    TSVs committed alongside the price data)."""
    import pandas as pd
    if not force_remote and fallback_path and os.path.exists(fallback_path):
        cached = read_rate_tsv(fallback_path)
        if cached:
            print(f"  FRED {series_id}: using cached {os.path.basename(fallback_path)} ({len(cached)} rows; pass --refresh-rates to re-fetch)")
            return cached
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start_date}"
    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            print(f"Fetching FRED {series_id} (attempt {attempt}/{attempts})...")
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            raw = urllib.request.urlopen(req, timeout=60).read().decode('utf-8')
            out = []
            reader = csv.reader(io.StringIO(raw))
            next(reader)  # header row: observation_date,SERIES
            for row in reader:
                if len(row) < 2 or row[1].strip() in ('', '.'):
                    continue
                try:
                    out.append((pd.Timestamp(row[0]), float(row[1])))
                except (ValueError, TypeError):
                    continue
            if out:
                return out
            last_err = "empty response"
        except Exception as e:
            last_err = e
            print(f"  FRED {series_id} attempt {attempt} failed: {e}")
        if attempt < attempts:
            time.sleep(2 ** attempt)  # 2s, 4s backoff
    if fallback_path and os.path.exists(fallback_path):
        cached = read_rate_tsv(fallback_path)
        if cached:
            print(f"  FRED {series_id} unreachable ({last_err}); using cached {os.path.basename(fallback_path)} ({len(cached)} rows)")
            return cached
    raise RuntimeError(f"FRED {series_id} fetch failed after {attempts} attempts and no usable fallback: {last_err}")


def build_combined_rates(dff_pairs, tbms_pairs):
    """Combine FRED DFF (daily, 1954+) with TB3MS (monthly, 1934+ as pre-1954
    proxy) into a single weekday-resolution series. Holidays carry forward
    the previous trading day's rate. Returns [(Timestamp, value_percent)]."""
    import pandas as pd
    dff_map  = dict(dff_pairs)
    tbms_map = dict(tbms_pairs)

    def tbms_lookup(d):
        # TB3MS is anchored on the 1st of the month — forward-fill within month.
        return tbms_map.get(pd.Timestamp(d.year, d.month, 1))

    end = max(d for d, _ in dff_pairs)
    combined = []
    d = pd.Timestamp(1934, 1, 2)
    last_dff = None
    last_tb  = tbms_map.get(pd.Timestamp(1934, 1, 1), 0.72)
    while d <= end:
        if d.weekday() < 5:  # weekdays only
            if d in dff_map:
                last_dff = dff_map[d]
                v = last_dff
            elif last_dff is not None:
                v = last_dff  # forward-fill DFF on holidays
            else:
                tb = tbms_lookup(d)
                if tb is not None: last_tb = tb
                v = last_tb
            combined.append((d, v))
        d += timedelta(days=1)
    return combined


def write_rate_tsv(path, rows):
    """Write a rate series in the same Date \\t Rate TSV format as price TSVs."""
    with open(path, 'w') as f:
        f.write("Date\tRate\n")
        for d, v in rows:
            f.write(f"{d.month}/{d.day}/{d.year} 16:00:00\t{v:.4f}\n")


def walk_backward(source_pairs, anchor_date, anchor_price, leverage, expense_daily, rate_map=None, rate_spread=0.0):
    """Anchor at (anchor_date, anchor_price) and walk source returns backward
    to fabricate target closes for every source date < anchor_date.

    For a leveraged target (leverage > 1), pass `rate_map` (date → percent
    short rate). The formula then includes the financing-cost term
    (L-1) × rate_daily that real leveraged ETFs pay on the borrowed leg.
    Without `rate_map`, the unmodelled financing cost makes the synthesis
    too high by ~2×rate per year — wildly inaccurate in high-rate eras.

    If source contains anchor_date, anchoring is exact (no 1-day lag) and the
    anchor row itself is excluded from the output. Otherwise the anchor is
    placed on the last source date < anchor_date and the entire synth series
    is shifted forward ~1 trading day (the original kludge).

    Returns (rows, pairs):
      rows  = [(date_str_for_tsv, close)]
      pairs = [(Timestamp, close)] — for chaining into a downstream synthesis
    """
    pre = [(d, c) for d, c in source_pairs if d <= anchor_date]
    n = len(pre)
    if n < 2:
        return [], []
    synth = [0.0] * n
    synth[-1] = anchor_price
    financing_mult = leverage - 1  # 0 for L=1 (no leverage, no cost), 2 for L=3
    for i in range(n - 1, 0, -1):
        ret = (pre[i][1] - pre[i - 1][1]) / pre[i - 1][1]
        # Financing cost charged for the period from pre[i-1] → pre[i]. We
        # apply one trading day's worth of (L-1)×rate, using the rate as of
        # the earlier date (or most recent prior weekday).
        financing_daily = 0.0
        if rate_map is not None and financing_mult > 0:
            rate_pct = rate_lookup(rate_map, pre[i - 1][0])
            # Effective swap rate = benchmark rate + per-product spread.
            # Most products use the bare benchmark (spread=0).
            financing_daily = financing_mult * ((rate_pct / 100.0) + rate_spread) / 252.0
        synth[i - 1] = max(synth[i] / (1 + leverage * ret - financing_daily - expense_daily), 0)
    exact = pre[-1][0] == anchor_date
    output_n = n - 1 if exact else n
    pairs = [(pre[i][0], synth[i]) for i in range(output_n)]
    rows = [(d.strftime('%-m/%-d/%Y 16:00:00'), c) for d, c in pairs]
    return rows, pairs


def walk_forward(source_pairs, anchor_date, anchor_price, leverage, expense_daily, rate_map=None):
    """Mirror of walk_backward. Used for fully-synthetic series
    where there's no real ETF anchor for the forward window — we run the
    same leverage formula past the anchor instead of stopping at a real
    first-trading-day price.

    Returns (rows, pairs) including the anchor row (unlike walk_backward,
    which excludes the anchor when it falls exactly on the source date)."""
    post = [(d, c) for d, c in source_pairs if d >= anchor_date]
    n = len(post)
    if n < 2:
        return [], []
    synth = [0.0] * n
    synth[0] = anchor_price
    financing_mult = leverage - 1
    for i in range(1, n):
        ret = (post[i][1] - post[i - 1][1]) / post[i - 1][1]
        financing_daily = 0.0
        if rate_map is not None and financing_mult > 0:
            rate_pct = rate_lookup(rate_map, post[i - 1][0])
            financing_daily = financing_mult * (rate_pct / 100.0) / 252.0
        synth[i] = max(synth[i - 1] * (1 + leverage * ret - financing_daily - expense_daily), 0)
    pairs = [(post[i][0], synth[i]) for i in range(n)]
    rows = [(d.strftime('%-m/%-d/%Y 16:00:00'), c) for d, c in pairs]
    return rows, pairs


def rate_lookup(rate_map, d, fallback_days=10):
    """Return the rate (percent) for date d, falling back to the most recent
    prior weekday if d itself is a weekend/holiday. Returns 0 if no rate
    within the fallback window — should not happen for our 1934+ coverage."""
    import pandas as pd
    if d in rate_map:
        return rate_map[d]
    for delta in range(1, fallback_days + 1):
        prev = d - pd.Timedelta(days=delta)
        if prev in rate_map:
            return rate_map[prev]
    return 0.0


def fetch(ticker, auto_adjust=True):
    print(f"Fetching {ticker}{' (raw)' if not auto_adjust else ''}...")
    return yf.download(ticker, period="max", auto_adjust=auto_adjust, progress=False)


def read_price_tsv(path):
    """Inverse of the price TSV writer: parse a synthetic-*.tsv back into
    [(Timestamp, close)]. Used by the incremental refresh path to preserve
    the (already permanently synthesized) pre-IPO prefix while replacing
    the post-IPO real-data tail with fresh yfinance values."""
    import pandas as pd
    out = []
    if not os.path.exists(path):
        return out
    with open(path) as f:
        next(f, None)  # header
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 2:
                continue
            try:
                date_str = parts[0].split(' ')[0]
                m, d, y = date_str.split('/')
                out.append((pd.Timestamp(int(y), int(m), int(d)), float(parts[1])))
            except (ValueError, TypeError):
                continue
    return out


# Yahoo serves adjusted closes as float32, so two fetches minutes apart disagree
# from about the 8th significant digit. Written at %.12g that turned every run
# into a ~16k-line rewrite of prices that had not moved — measured across two
# back-to-back runs, the largest such wobble was 1.4e-06 relative. Anything at or
# under NOISE_REL is treated as the same price and the existing line is reused
# byte-for-byte, so a commit only appears when a price really changed. A genuine
# move is orders of magnitude larger: one cent on a $24 close is 4e-04, and a
# dividend re-adjustment rescales history by ~1e-03.
NOISE_REL = 5e-6


def write_price_tsv(path, prefix_pairs, real_df):
    """Write Date\\tClose with synthesized prefix rows first, then real
    yfinance bars. Shared by both rebuild and incremental modes."""
    prior = {}
    if os.path.exists(path):
        with open(path) as f:
            next(f, None)  # header
            for line in f:
                parts = line.rstrip('\n').split('\t')
                if len(parts) == 2:
                    prior[parts[0]] = parts[1]

    def render(date_str, value):
        """The previous line verbatim when the price is unchanged within noise."""
        old = prior.get(date_str)
        if old is not None:
            try:
                old_val = float(old)
            except ValueError:
                return fmt_close(value)
            if old_val == value or abs(value - old_val) <= NOISE_REL * abs(old_val):
                return old
        return fmt_close(value)

    with open(path, 'w') as f:
        f.write('Date\tClose\n')
        for d, c in prefix_pairs:
            date_str = f'{d.month}/{d.day}/{d.year} 16:00:00'
            f.write(f'{date_str}\t{render(date_str, c)}\n')
        for date, row in real_df.iterrows():
            date_str = date.strftime('%-m/%-d/%Y 16:00:00')
            f.write(f'{date_str}\t{render(date_str, cell(row["Close"]))}\n')


def incremental_refresh():
    """Default daily-cron path. The synthesized pre-IPO prefix of each TSV
    is permanent and lives in the committed file; we only need to refresh
    the post-IPO real-data tail with fresh yfinance bars (and pick up any
    Yahoo backfill corrections to existing real rows).

    No rate-file FRED pulls, no ^NDX, no ^SOX, no synthesis logic — those are
    bootstrap-only concerns (use --rebuild). Daily runs touch the ETF TSVs
    plus one failure-tolerant NFCI refresh (a live strategy input; see below)."""
    data_dir = os.path.join(basedir, DATA_DIR)
    for ticker, filename in tickers:
        path = os.path.join(data_dir, filename)
        if not os.path.exists(path):
            print(f"  {filename}: missing — run with --rebuild to bootstrap")
            continue
        real_df = fetch(ticker)
        if real_df.empty:
            print(f"  {filename}: yfinance returned no rows; leaving TSV untouched")
            continue
        first_real = normalize_ts(real_df.index[0])
        existing = read_price_tsv(path)
        prefix_pairs = [(d, c) for d, c in existing if d < first_real]
        write_price_tsv(path, prefix_pairs, real_df)
        last = real_df.index[-1].strftime('%Y-%m-%d')
        print(f"  {filename}: {len(prefix_pairs)} preserved + {len(real_df)} real, through {last}")

    # NFCI (weekly) is a LIVE decision input for the credit-veto strategy, so
    # the cron keeps it current — unlike the historical rate files, which only
    # refresh via --refresh-rates. FRED downtime must never break the price
    # refresh above, so any failure leaves the committed TSV untouched.
    try:
        nfci = fetch_fred('NFCI', '1971-01-01', force_remote=True)
        if nfci:
            write_rate_tsv(os.path.join(data_dir, 'nfci.tsv'), nfci)
            print(f"  nfci.tsv: {len(nfci)} weekly rows, through {nfci[-1][0].strftime('%Y-%m-%d')}")
    except Exception as e:
        print(f"  nfci.tsv: FRED unreachable ({e}); leaving committed TSV untouched")


# === CLI =================================================================
# Default mode: incremental refresh (fast, yfinance-only, no FRED). Used by
# the daily GitHub Actions cron. Pre-IPO synthesized history stays as-is.
# --rebuild: regenerate every TSV from scratch via the backward-synthesis
# pipeline. Needs FRED + index data. Only run when adding a new ticker or
# fixing the synthesis itself.
import argparse
_argp = argparse.ArgumentParser(description='Refresh ETF price TSVs.')
_argp.add_argument('--rebuild', action='store_true',
                   help='Full synthesis from scratch (uses cached FRED rates by '
                        'default — historical rates do not change). Default is '
                        'incremental yfinance refresh.')
_argp.add_argument('--refresh-rates', action='store_true',
                   help='Re-fetch FRED DFF + TB3MS + NFCI from the network and '
                        'overwrite data/fed-funds-effective.tsv + data/t-bill-3mo.tsv + '
                        'data/short-rates.tsv + data/nfci.tsv. Use to refresh the '
                        'committed rate/signal data; not needed for synthesis '
                        '(historical rates do not change).')
_args = _argp.parse_args()

if not _args.rebuild:
    incremental_refresh()
    print("Done.")
    sys.exit(0)


# === REBUILD MODE: full synthesis from scratch ===========================
# Everything below this line is the original bootstrap pipeline that builds
# pre-IPO synthesized history by walking index returns backward from each
# ETF's first real trading day.
qqq_df          = fetch('QQQ')                              # auto-adjusted (TR)
qqq_raw_df      = fetch('QQQ', auto_adjust=False)           # split-adjusted only
qld_df          = fetch('QLD')                              # ProShares 2× QQQ, 2006-06-21+
tqqq_df         = fetch('TQQQ')
spy_df          = fetch('SPY')
sso_df          = fetch('SSO')                              # ProShares 2× S&P500, 2006-06-21+
spxl_df         = fetch('SPXL')                             # Direxion 3× S&P500, 2008-11-05+
ndx_df          = fetch('^NDX')
gspc_df         = fetch('^GSPC')
sp500tr_df      = fetch('^SP500TR')

ndx_pairs       = extend_with_csv(df_to_pairs(ndx_df), read_ndx_csv())
qqq_pairs       = df_to_pairs(qqq_df)                       # = QQQ_adj
sp500tr_pairs   = df_to_pairs(sp500tr_df)
ndx_start       = ndx_pairs[0][0] if ndx_pairs else df_to_pairs(ndx_df)[0][0]
gspc_clipped    = [(d, c) for d, c in df_to_pairs(gspc_df) if d >= ndx_start]

# Fetch FRED short-rate series for financing-cost correction. Done after the
# yfinance pulls so that if FRED rate-limits us, we still have fresh price
# data; the synthesis just falls back to the naive formula until next run.
dff_pairs       = fetch_fred('DFF',   DFF_START,  fallback_path=os.path.join(basedir, DATA_DIR, 'fed-funds-effective.tsv'), force_remote=_args.refresh_rates)  # daily 1954+
tbms_pairs      = fetch_fred('TB3MS', TBMS_START, fallback_path=os.path.join(basedir, DATA_DIR, 't-bill-3mo.tsv'),           force_remote=_args.refresh_rates)  # monthly 1934+
# Chicago Fed NFCI (weekly, 1971+). Not a synthesis input — it feeds the
# NFCI-credit-veto strategy in the app (js/data.js aligns it to trading days
# with a 7-day publication lag). Refreshed alongside the rate files.
nfci_pairs      = fetch_fred('NFCI',  '1971-01-01', fallback_path=os.path.join(basedir, DATA_DIR, 'nfci.tsv'),               force_remote=_args.refresh_rates)  # weekly 1971+
combined_rates  = build_combined_rates(dff_pairs, tbms_pairs)
rate_map        = dict(combined_rates)                      # Timestamp → percent

# Build derived NDX-TR pairs: ^NDX × QQQ_adj / QQQ_raw, only for dates where
# all three are available (1999-03-10 onwards). Real daily data on both sides.
ndx_map     = dict(ndx_pairs)
qqq_adj_map = {d: cell(row['Adj Close']) for d, row in qqq_raw_df.iterrows()}
qqq_raw_map = {d: cell(row['Close'])     for d, row in qqq_raw_df.iterrows()}
ndx_tr_pairs = []
for d in sorted(qqq_adj_map):
    if d in ndx_map and d in qqq_raw_map and qqq_raw_map[d] > 0:
        ndx_tr_pairs.append((d, ndx_map[d] * qqq_adj_map[d] / qqq_raw_map[d]))

# ---- QQQ pre-1999 (single phase, ^NDX) ----
qqq_prefix_rows, _ = walk_backward(
    ndx_pairs,
    anchor_date=qqq_df.index[0],
    anchor_price=cell(qqq_df['Close'].iloc[0]),
    leverage=1,
    expense_daily=QQQ_EXPENSE_DAILY,
)


# ---- TQQQ: two-phase to avoid double-deducting QQQ expense pre-1999 ----
# Phase 1: 1999 → 2010, walk through derived NDX-TR (real daily ^NDX × QQQ_adj
# / QQQ_raw). The QQQ_exp on both sides cancels, leaving a clean NDX-TR daily
# return — closer to real TQQQ's swap-tracking behavior than chaining through
# real QQQ_adj alone (which would over-deduct 3*QQQ_exp = 0.6%/yr).
# rate_map is passed in so the synthesis subtracts (L-1)×rate financing cost
# per day, matching how real leveraged ETFs operate. Without this, synthesis
# would overstate real TQQQ by ~2×rate per year (huge in 1970s-80s high-rate
# eras, small in 2010-2021 ZIRP era).
phase1_rows, phase1_pairs = walk_backward(
    ndx_tr_pairs,
    anchor_date=tqqq_df.index[0],
    anchor_price=cell(tqqq_df['Close'].iloc[0]),
    leverage=3,
    expense_daily=TQQQ_EXPENSE_DAILY,
    rate_map=rate_map,
    rate_spread=TQQQ_SWAP_SPREAD,
)
# Phase 2: pre-1999, walk through ^NDX directly anchored on phase 1's earliest
# synth value. Net daily error ~ -3*dividend_yield = ~-1.5-2%/yr (price-only).
if phase1_pairs:
    p2_anchor_date, p2_anchor_price = phase1_pairs[0]
    phase2_rows, _ = walk_backward(
        ndx_pairs, p2_anchor_date, p2_anchor_price,
        leverage=3, expense_daily=TQQQ_EXPENSE_DAILY,
        rate_map=rate_map,
        rate_spread=TQQQ_SWAP_SPREAD,
    )
    tqqq_prefix_rows = phase2_rows + phase1_rows
else:
    tqqq_prefix_rows = phase1_rows


# ---- QLD: real ProShares 2× QQQ from 2006-06-21, synthesized prefix ----
# Mirrors the TQQQ two-phase chain but with leverage=2, expense=0.95%/yr,
# and ~half the swap spread (2× swaps are the most liquid leverage tier).
qld_phase1_rows, qld_phase1_pairs = walk_backward(
    ndx_tr_pairs,
    anchor_date=qld_df.index[0],
    anchor_price=cell(qld_df['Close'].iloc[0]),
    leverage=2,
    expense_daily=QLD_EXPENSE_DAILY,
    rate_map=rate_map,
    rate_spread=QLD_SWAP_SPREAD,
)
if qld_phase1_pairs:
    qld_p2_d, qld_p2_p = qld_phase1_pairs[0]
    qld_phase2_rows, _ = walk_backward(
        ndx_pairs, qld_p2_d, qld_p2_p,
        leverage=2, expense_daily=QLD_EXPENSE_DAILY,
        rate_map=rate_map,
        rate_spread=QLD_SWAP_SPREAD,
    )
    qld_prefix_rows = qld_phase2_rows + qld_phase1_rows
else:
    qld_prefix_rows = qld_phase1_rows




# ---- SPY: two-phase to use real S&P TR data where available ----
# Phase 1: 1988 → 1993, walk through ^SP500TR (real total-return index)
spy_phase1_rows, spy_phase1_pairs = walk_backward(
    sp500tr_pairs,
    anchor_date=spy_df.index[0],
    anchor_price=cell(spy_df['Close'].iloc[0]),
    leverage=1,
    expense_daily=SPY_EXPENSE_DAILY,
)
# Phase 2: 1985 → 1987, walk through ^GSPC (price-only fallback)
if spy_phase1_pairs:
    s2_anchor_date, s2_anchor_price = spy_phase1_pairs[0]
    spy_phase2_rows, _ = walk_backward(
        gspc_clipped, s2_anchor_date, s2_anchor_price,
        leverage=1, expense_daily=SPY_EXPENSE_DAILY,
    )
    spy_prefix_rows = spy_phase2_rows + spy_phase1_rows
else:
    spy_prefix_rows = spy_phase1_rows


# ---- SSO: real ProShares 2× S&P500 from 2006-06-21, synthesized prefix ----
# Mirrors QLD's two-phase chain but on the S&P 500. Phase 1 walks back through
# ^SP500TR (real S&P total-return index, 1988+); phase 2 falls back to ^GSPC
# (price-only, the only signal we have pre-1988). The missing dividends cost
# ~3.7-4.0 pp/yr at 1× in the years adjacent to the gap, so ~2× that here.
sso_phase1_rows, sso_phase1_pairs = walk_backward(
    sp500tr_pairs,
    anchor_date=sso_df.index[0],
    anchor_price=cell(sso_df['Close'].iloc[0]),
    leverage=2,
    expense_daily=SSO_EXPENSE_DAILY,
    rate_map=rate_map,
    rate_spread=SSO_SWAP_SPREAD,
)
if sso_phase1_pairs:
    sso_p2_d, sso_p2_p = sso_phase1_pairs[0]
    sso_phase2_rows, _ = walk_backward(
        gspc_clipped, sso_p2_d, sso_p2_p,
        leverage=2, expense_daily=SSO_EXPENSE_DAILY,
        rate_map=rate_map,
        rate_spread=SSO_SWAP_SPREAD,
    )
    sso_prefix_rows = sso_phase2_rows + sso_phase1_rows
else:
    sso_prefix_rows = sso_phase1_rows


# ---- SPXL: real Direxion 3× S&P500 from 2008-11-05, synthesized prefix ----
# Same shape as SSO but leverage=3 and a higher financing-cost burden.
spxl_phase1_rows, spxl_phase1_pairs = walk_backward(
    sp500tr_pairs,
    anchor_date=spxl_df.index[0],
    anchor_price=cell(spxl_df['Close'].iloc[0]),
    leverage=3,
    expense_daily=SPXL_EXPENSE_DAILY,
    rate_map=rate_map,
    rate_spread=SPXL_SWAP_SPREAD,
)
if spxl_phase1_pairs:
    spxl_p2_d, spxl_p2_p = spxl_phase1_pairs[0]
    spxl_phase2_rows, _ = walk_backward(
        gspc_clipped, spxl_p2_d, spxl_p2_p,
        leverage=3, expense_daily=SPXL_EXPENSE_DAILY,
        rate_map=rate_map,
        rate_spread=SPXL_SWAP_SPREAD,
    )
    spxl_prefix_rows = spxl_phase2_rows + spxl_phase1_rows
else:
    spxl_prefix_rows = spxl_phase1_rows


# ---- SQQQ: real ProShares UltraPro Short QQQ (-3x) from 2010-02-11 ----
# Inverse funds don't fit walk_backward's long formula: instead of paying
# financing on a borrowed leg, a -3x fund sits on (1+L) units of cash EARNING
# the short rate. Both coefficients below were fitted against real SQQQ.
def walk_backward_inverse(source_pairs, anchor_date, anchor_price, rate_map):
    pre = [(d, c) for d, c in source_pairs if d <= anchor_date]
    n = len(pre)
    if n < 2:
        return [], []
    synth = [0.0] * n
    synth[-1] = anchor_price
    for i in range(n - 1, 0, -1):
        ret = (pre[i][1] - pre[i - 1][1]) / pre[i - 1][1]
        r_daily = (rate_lookup(rate_map, pre[i - 1][0]) / 100.0) / 252.0
        step = (-SQQQ_INVERSE_LEVERAGE * ret) + SQQQ_CASH_MULTIPLE * r_daily + SQQQ_DRAG_DAILY
        synth[i - 1] = max(synth[i] / (1 + step), 0) if (1 + step) > 0 else 0
    exact = pre[-1][0] == anchor_date
    output_n = n - 1 if exact else n
    pairs = [(pre[i][0], synth[i]) for i in range(output_n)]
    rows = [(d.strftime('%-m/%-d/%Y 16:00:00'), c) for d, c in pairs]
    return rows, pairs


sqqq_p1_rows, sqqq_p1_pairs = walk_backward_inverse(
    ndx_tr_pairs, sqqq_df.index[0], cell(sqqq_df['Close'].iloc[0]), rate_map)
if sqqq_p1_pairs:
    sq_d, sq_p = sqqq_p1_pairs[0]
    sqqq_p2_rows, _ = walk_backward_inverse(ndx_pairs, sq_d, sq_p, rate_map)
    sqqq_prefix_rows = sqqq_p2_rows + sqqq_p1_rows
else:
    sqqq_prefix_rows = sqqq_p1_rows


prefix_by_ticker = {'QQQ': qqq_prefix_rows, 'QLD': qld_prefix_rows,
                    'TQQQ': tqqq_prefix_rows, 'SPY': spy_prefix_rows,
                    'SSO': sso_prefix_rows, 'SPXL': spxl_prefix_rows,
                    'SQQQ': sqqq_prefix_rows}
real_by_ticker   = {'QQQ': qqq_df, 'QLD': qld_df, 'TQQQ': tqqq_df, 'SPY': spy_df,
                    'SSO': sso_df, 'SPXL': spxl_df, 'SQQQ': sqqq_df}

data_dir = os.path.join(basedir, DATA_DIR)
os.makedirs(data_dir, exist_ok=True)

for ticker, filename in tickers:
    data = real_by_ticker[ticker]
    prefix_rows = prefix_by_ticker.get(ticker, [])
    path = os.path.join(data_dir, filename)

    with open(path, 'w') as f:
        f.write('Date\tClose\n')
        for date_str, close in prefix_rows:
            f.write(f'{date_str}\t{fmt_close(close)}\n')
        for date, row in data.iterrows():
            date_str = date.strftime('%-m/%-d/%Y 16:00:00')
            f.write(f'{date_str}\t{fmt_close(cell(row["Close"]))}\n')

    if prefix_rows:
        first = prefix_rows[0][0].split(' ')[0]
        last = data.index[-1].strftime('%Y-%m-%d')
        print(f"  {filename}: {len(prefix_rows)} synthesized + {len(data)} real, {first} to {last}")
    else:
        start = data.index[0].strftime('%Y-%m-%d')
        end = data.index[-1].strftime('%Y-%m-%d')
        print(f"  {filename}: {len(data)} rows, {start} to {end}")

# === Write rate files =====================================================
# Same TSV format as the price files so they're trivial to load with the same
# parser. Daily granularity post-1954, monthly forward-filled pre-1954.
write_rate_tsv(os.path.join(data_dir, 'fed-funds-effective.tsv'), dff_pairs)
write_rate_tsv(os.path.join(data_dir, 't-bill-3mo.tsv'),          tbms_pairs)
write_rate_tsv(os.path.join(data_dir, 'short-rates.tsv'),         combined_rates)
write_rate_tsv(os.path.join(data_dir, 'nfci.tsv'),                nfci_pairs)
print(f"  fed-funds-effective.tsv: {len(dff_pairs)} daily rows, {dff_pairs[0][0].strftime('%Y-%m-%d')} to {dff_pairs[-1][0].strftime('%Y-%m-%d')}")
print(f"  t-bill-3mo.tsv:          {len(tbms_pairs)} monthly rows, {tbms_pairs[0][0].strftime('%Y-%m-%d')} to {tbms_pairs[-1][0].strftime('%Y-%m-%d')}")
print(f"  short-rates.tsv:         {len(combined_rates)} daily rows, {combined_rates[0][0].strftime('%Y-%m-%d')} to {combined_rates[-1][0].strftime('%Y-%m-%d')}")
print(f"  nfci.tsv:                {len(nfci_pairs)} weekly rows, {nfci_pairs[0][0].strftime('%Y-%m-%d')} to {nfci_pairs[-1][0].strftime('%Y-%m-%d')}")

print("Done.")
