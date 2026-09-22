#!/usr/bin/env python3
"""
Fetches 5-minute TQQQ bars and writes them to data/intraday/tqqq-5m.tsv.

Two sources:

  --source yahoo   (default)  Yahoo Finance via yfinance. Free, no account,
                              but only the most recent 60 calendar days.
  --source alpaca             Alpaca Market Data. Free with an account, bars
                              back to 2016 from the consolidated SIP feed.
                              Needs ALPACA_API_KEY and ALPACA_API_SECRET in
                              the environment or in a .env file next to this
                              script. --years sets how far back to pull;
                              --incremental instead starts from the last day
                              already in the file (that day is re-fetched so a
                              partial session gets completed). The cron uses
                              --incremental: two requests per run.

Either way the file on disk is the long-term store: each run merges the fresh
bars into whatever is already there, fresh bars winning on overlap, so history
accumulates across runs and across sources.

Output is tab-separated with one row per regular-session bar (09:30-15:55 ET,
timestamps are the bar's open time in New York local time):

    Date                Open    High    Low     Close   Volume
    9/22/2026 9:30:00   38.93   39.10   38.80   39.02   1234567
"""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TICKER = 'TQQQ'
BAR_MINUTES = 5
MARKET_TZ = ZoneInfo('America/New_York')
SESSION_OPEN = (9, 30)
SESSION_LAST_BAR = (15, 55)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(BASE_DIR, 'data', 'intraday', 'tqqq-5m.tsv')
COLUMNS = ['Open', 'High', 'Low', 'Close', 'Volume']
DATE_FORMAT = '%-m/%-d/%Y %H:%M:%S'

YAHOO_PERIOD = '60d'                       # Yahoo's hard ceiling for 5-minute bars
ALPACA_BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars'
ALPACA_CALENDAR_URL = 'https://paper-api.alpaca.markets/v2/calendar'
ALPACA_PAGE_LIMIT = 10000


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


def fetch_yahoo():
    try:
        import yfinance as yf
    except ImportError:
        print("yfinance not installed. Run: pip install yfinance")
        sys.exit(1)
    print(f"Fetching {TICKER} {BAR_MINUTES}m bars from Yahoo for the last {YAHOO_PERIOD}...")
    df = yf.Ticker(TICKER).history(period=YAHOO_PERIOD, interval=f'{BAR_MINUTES}m',
                                   auto_adjust=False, prepost=False)
    if df.empty:
        raise RuntimeError(f"Yahoo returned no {BAR_MINUTES}m rows for {TICKER}")
    df = df.tz_convert(MARKET_TZ)
    bars = {ts.to_pydatetime(): {c: row[c] for c in COLUMNS}
            for ts, row in df.iterrows() if in_regular_session(ts)}
    return bars, {}          # yfinance already stops at the real close on early-close days


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


def fetch_alpaca(start):
    import requests
    key, secret = os.environ.get('ALPACA_API_KEY'), os.environ.get('ALPACA_API_SECRET')
    if not key or not secret:
        raise RuntimeError("ALPACA_API_KEY and ALPACA_API_SECRET must be set (environment or .env)")
    headers = {'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret}
    close_by_date = fetch_alpaca_calendar(start, headers)
    early_closes = sum(1 for close in close_by_date.values() if close != (16, 0))
    print(f"Fetching {TICKER} {BAR_MINUTES}m bars from Alpaca since {start:%Y-%m-%d} "
          f"({len(close_by_date)} trading days, {early_closes} early closes)...")
    params = {
        'symbols': TICKER, 'timeframe': f'{BAR_MINUTES}Min',
        'start': start.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'limit': ALPACA_PAGE_LIMIT, 'adjustment': 'raw', 'feed': 'sip', 'sort': 'asc',
    }
    bars = {}
    page = 0
    while True:
        r = requests.get(ALPACA_BARS_URL, headers=headers, params=params, timeout=60)
        if r.status_code != 200:
            raise RuntimeError(f"Alpaca HTTP {r.status_code}: {r.text[:300]}")
        body = r.json()
        page += 1
        for bar in body.get('bars', {}).get(TICKER, []):
            ts = datetime.fromisoformat(bar['t'].replace('Z', '+00:00')).astimezone(MARKET_TZ)
            if in_regular_session(ts) and before_close(ts, close_by_date):
                bars[ts] = {'Open': bar['o'], 'High': bar['h'], 'Low': bar['l'],
                            'Close': bar['c'], 'Volume': bar['v']}
        print(f"  page {page}: {len(bars)} session bars so far")
        if not body.get('next_page_token'):
            break
        params['page_token'] = body['next_page_token']
    if not bars:
        raise RuntimeError(f"Alpaca returned no {BAR_MINUTES}m rows for {TICKER}")
    return bars, close_by_date


def alpaca_start(existing, args):
    """UTC instant to fetch from. Incremental mode restarts at New York
    midnight of the last day on disk; with nothing on disk it says so and
    does the full --years pull instead."""
    if args.incremental and existing:
        last_day = max(existing, key=parse_key)
        midnight = parse_key(last_day).replace(hour=0, minute=0, second=0, tzinfo=MARKET_TZ)
        return midnight.astimezone(timezone.utc)
    if args.incremental:
        print(f"  {os.path.relpath(OUT_PATH)} is empty; doing the full {args.years}-year pull instead")
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


argp = argparse.ArgumentParser(description=f'Refresh {TICKER} {BAR_MINUTES}-minute bars.')
argp.add_argument('--source', choices=['yahoo', 'alpaca'], default='yahoo')
argp.add_argument('--years', type=int, default=3, help='Alpaca only: how many years back to pull')
argp.add_argument('--incremental', action='store_true',
                  help='Alpaca only: fetch from the last day already in the file instead of --years back')
args = argp.parse_args()

load_dotenv(os.path.join(BASE_DIR, '.env'))
existing = read_existing(OUT_PATH)
fetched, close_by_date = (fetch_alpaca(alpaca_start(existing, args)) if args.source == 'alpaca'
                          else fetch_yahoo())

fresh = {ts.strftime(DATE_FORMAT): format_row(row) for ts, row in fetched.items()}
merged = {**existing, **fresh}        # fresh bars win where the two overlap
# Rows written by an earlier run can sit past an early close; the calendar
# fetched this run is the authority for every day it covers.
merged = {date_str: row for date_str, row in merged.items()
          if before_close(parse_key(date_str), close_by_date)}
write_tsv(OUT_PATH, merged)

dates = sorted(merged, key=parse_key)
print(f"  {os.path.relpath(OUT_PATH)}: {len(merged)} bars "
      f"({len(fresh)} fresh, {len(merged) - len(existing)} new), "
      f"{dates[0]} to {dates[-1]}")
