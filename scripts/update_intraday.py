#!/usr/bin/env python3
"""
Fetches 5-minute bars from Alpaca Market Data for each of the site's funds and
writes them to data/intraday/<ticker>-5m.tsv (tqqq-5m.tsv, soxl-5m.tsv, ...),
one file a fund. These are the intraday page's history, whichever ticker it
shows; the daily price files the main chart uses come from Yahoo via
scripts/update_data.py, and the two are kept separate on purpose.

Alpaca is free with an account and serves bars back to 2016 from the
consolidated SIP feed, split-adjusted here. It needs ALPACA_API_KEY and
ALPACA_API_SECRET in the environment or in a .env file at the repo root.
--years sets how far back a full pull goes; --incremental instead starts
from the last day already in the file (that day is re-fetched so a partial
session gets completed). The cron uses --incremental: two requests a fund per
run. A fund with no file yet gets the full pull, so a new ticker fills in on
its first run. --tickers limits a run to some of the funds.

One fund failing does not stop the others: its error is printed with its
traceback, the rest are written, and the run then exits with a failure so the
log shows it.

A split changes every price Alpaca serves for the fund. The day re-fetched
each run is compared with the same day on disk: closes that differ by more
than SPLIT_TOLERANCE mean the file is on the old basis, and the fund's whole
stored span is pulled again, so the file never mixes two bases.

The file on disk is the long-term store: each run merges the fresh bars into
whatever is already there, fresh bars winning on overlap.

Output is tab-separated with one row per regular-session bar (09:30-15:55 ET,
timestamps are the bar's open time in New York local time):

    Date                Open    High    Low     Close   Volume
    9/22/2026 9:30:00   38.93   39.10   38.80   39.02   1234567
"""

import argparse
import os
import traceback
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# The site's funds: the same ten as the quotes worker's SYMBOLS
# (cloudflare/quotes/src/worker.mjs) and the intraday page's TICKERS.
TICKERS = ['TQQQ', 'QQQ', 'SPY', 'QLD', 'SSO', 'SPXL', 'SQQQ', 'GLD', 'SOXL', 'SOXX']
BAR_MINUTES = 5
MARKET_TZ = ZoneInfo('America/New_York')
SESSION_OPEN = (9, 30)
SESSION_LAST_BAR = (15, 55)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the repo root; this script lives in scripts/
OUT_DIR = os.path.join(BASE_DIR, 'data', 'intraday')
COLUMNS = ['Open', 'High', 'Low', 'Close', 'Volume']
DATE_FORMAT = '%-m/%-d/%Y %H:%M:%S'

ALPACA_BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars'
ALPACA_CALENDAR_URL = 'https://paper-api.alpaca.markets/v2/calendar'
ALPACA_PAGE_LIMIT = 10000
# A bar's close on disk against the same bar fetched again: further apart than
# this and the fund has split since the file was written (the smallest split
# ratio is 2-for-1; a bar still forming moves by far less).
SPLIT_TOLERANCE = 0.2
CLOSE_COLUMN = COLUMNS.index('Close')


def out_path(ticker):
    """The fund's file: data/intraday/tqqq-5m.tsv for TQQQ."""
    return os.path.join(OUT_DIR, f'{ticker.lower()}-{BAR_MINUTES}m.tsv')


def in_regular_session(ts):
    """True for bars whose open time falls inside 09:30-15:55 New York time."""
    hm = (ts.hour, ts.minute)
    return SESSION_OPEN <= hm <= SESSION_LAST_BAR


def before_close(ts, close_by_date):
    """False for a bar that opens at or after that day's real close. Alpaca
    keeps serving bars through the afternoon on 1 PM early-close days, and
    those are after-hours trades. Days missing from the calendar pass."""
    close = close_by_date.get(ts.date())
    return close is None or (ts.hour, ts.minute) < close


def load_dotenv(path):
    """Minimal KEY=VALUE reader so the Alpaca credentials can live in .env
    without adding a dependency. Existing environment variables win."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip())


def fetch_alpaca_calendar(start, headers):
    """Trading days in the window with their real close time, as
    {date: (hour, minute)}. Early-close days report 13:00."""
    import requests
    params = {'start': start.strftime('%Y-%m-%d'), 'end': datetime.now(timezone.utc).strftime('%Y-%m-%d')}
    r = requests.get(ALPACA_CALENDAR_URL, headers=headers, params=params, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"Alpaca calendar HTTP {r.status_code}: {r.text[:300]}")
    return {datetime.strptime(day['date'], '%Y-%m-%d').date(): tuple(int(x) for x in day['close'].split(':'))
            for day in r.json()}


def fetch_alpaca(ticker, start):
    import requests
    key, secret = os.environ.get('ALPACA_API_KEY'), os.environ.get('ALPACA_API_SECRET')
    if not key or not secret:
        raise RuntimeError("ALPACA_API_KEY and ALPACA_API_SECRET must be set (environment or .env)")
    headers = {'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret}
    close_by_date = fetch_alpaca_calendar(start, headers)
    early_closes = sum(1 for close in close_by_date.values() if close != (16, 0))
    print(f"Fetching {ticker} {BAR_MINUTES}m bars from Alpaca since {start:%Y-%m-%d} "
          f"({len(close_by_date)} trading days, {early_closes} early closes)...")
    params = {
        'symbols': ticker, 'timeframe': f'{BAR_MINUTES}Min',
        'start': start.strftime('%Y-%m-%dT%H:%M:%SZ'),
        # Split-adjusted, so a day's open compares with the previous close
        # across a split (TQQQ split 2-for-1 on 2025-11-20). A split after
        # a fund's stored history needs a full re-pull of that fund to stay
        # consistent.
        'limit': ALPACA_PAGE_LIMIT, 'adjustment': 'split', 'feed': 'sip', 'sort': 'asc',
    }
    bars = {}
    page = 0
    while True:
        r = requests.get(ALPACA_BARS_URL, headers=headers, params=params, timeout=60)
        if r.status_code != 200:
            raise RuntimeError(f"Alpaca HTTP {r.status_code}: {r.text[:300]}")
        body = r.json()
        page += 1
        for bar in body.get('bars', {}).get(ticker, []):
            ts = datetime.fromisoformat(bar['t'].replace('Z', '+00:00')).astimezone(MARKET_TZ)
            if in_regular_session(ts) and before_close(ts, close_by_date):
                bars[ts] = {'Open': bar['o'], 'High': bar['h'], 'Low': bar['l'],
                            'Close': bar['c'], 'Volume': bar['v']}
        print(f"  page {page}: {len(bars)} session bars so far")
        if not body.get('next_page_token'):
            break
        params['page_token'] = body['next_page_token']
    if not bars:
        raise RuntimeError(f"Alpaca returned no {BAR_MINUTES}m rows for {ticker}")
    return bars, close_by_date


def stored_midnight(date_str):
    """UTC instant of New York midnight on a stored row's day."""
    midnight = parse_key(date_str).replace(hour=0, minute=0, second=0, tzinfo=MARKET_TZ)
    return midnight.astimezone(timezone.utc)


def alpaca_start(existing, args, path):
    """UTC instant to fetch from. Incremental mode restarts at New York
    midnight of the last day on disk; with nothing on disk it says so and
    does the full --years pull instead."""
    if args.incremental and existing:
        return stored_midnight(max(existing, key=parse_key))
    if args.incremental:
        print(f"  {os.path.relpath(path)} is empty; doing the full {args.years}-year pull instead")
    return datetime.now(timezone.utc) - timedelta(days=365 * args.years)


def read_existing(path):
    """Rows already on disk, keyed by the date string, so a re-run extends
    the file instead of truncating it to the source's window."""
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        next(f, None)
        rows = (line.rstrip('\n').split('\t') for line in f)
        return {parts[0]: parts[1:] for parts in rows if len(parts) == len(COLUMNS) + 1}


def format_row(row):
    return [f'{row["Open"]:.4f}', f'{row["High"]:.4f}', f'{row["Low"]:.4f}',
            f'{row["Close"]:.4f}', f'{int(row["Volume"])}']


def parse_key(date_str):
    """Sort key: the date string back to a datetime, since the M/D/YYYY
    format does not sort lexically."""
    return datetime.strptime(date_str, '%m/%d/%Y %H:%M:%S')


def write_tsv(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write('Date\t' + '\t'.join(COLUMNS) + '\n')
        for date_str in sorted(rows, key=parse_key):
            f.write(date_str + '\t' + '\t'.join(rows[date_str]) + '\n')


def basis_changed(existing, fresh):
    """True when a bar held both on disk and in the fetch closes more than
    SPLIT_TOLERANCE apart in the two: the fund has split since the file was
    written, and Alpaca now serves every price on the new basis."""
    def apart(key):
        old, new = float(existing[key][CLOSE_COLUMN]), float(fresh[key][CLOSE_COLUMN])
        return old > 0 and abs(new / old - 1) > SPLIT_TOLERANCE
    return any(apart(key) for key in fresh if key in existing)


def refresh(ticker, args):
    """Fetches one fund's bars and merges them into its file."""
    path = out_path(ticker)
    existing = read_existing(path)
    fetched, close_by_date = fetch_alpaca(ticker, alpaca_start(existing, args, path))

    fresh = {ts.strftime(DATE_FORMAT): format_row(row) for ts, row in fetched.items()}
    if basis_changed(existing, fresh):
        print(f"  {ticker} has split since {os.path.relpath(path)} was written; pulling its whole stored span again")
        fetched, close_by_date = fetch_alpaca(ticker, stored_midnight(min(existing, key=parse_key)))
        fresh = {ts.strftime(DATE_FORMAT): format_row(row) for ts, row in fetched.items()}
        existing = {}                     # every stored row is on the old basis
    merged = {**existing, **fresh}        # fresh bars win where the two overlap
    # Rows written by an earlier run can sit past an early close; the calendar
    # fetched this run is the authority for every day it covers.
    merged = {date_str: row for date_str, row in merged.items()
              if before_close(parse_key(date_str), close_by_date)}
    write_tsv(path, merged)

    dates = sorted(merged, key=parse_key)
    print(f"  {os.path.relpath(path)}: {len(merged)} bars "
          f"({len(fresh)} fresh, {len(merged) - len(existing)} new), "
          f"{dates[0]} to {dates[-1]}")


argp = argparse.ArgumentParser(description=f'Refresh {BAR_MINUTES}-minute bars from Alpaca, one file a fund.')
argp.add_argument('--years', type=int, default=3, help='how many years back a full pull goes')
argp.add_argument('--incremental', action='store_true',
                  help='fetch from the last day already in each file instead of --years back')
argp.add_argument('--tickers', nargs='+', default=TICKERS, type=str.upper,
                  help='the funds to refresh; every fund of the site unless given')
args = argp.parse_args()

load_dotenv(os.path.join(BASE_DIR, '.env'))
failed = []
for ticker in args.tickers:
    try:
        refresh(ticker, args)
    except Exception:   # one fund's failure (a symbol Alpaca lacks, a timeout) must not stop the others
        print(f"  {ticker} FAILED:")
        traceback.print_exc()
        failed.append(ticker)
if failed:
    raise SystemExit(f"{len(failed)} of {len(args.tickers)} funds failed: {', '.join(failed)}")
