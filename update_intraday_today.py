#!/usr/bin/env python3
"""
Fetches today's 1-minute TQQQ bars from Yahoo Finance and writes them to
data/intraday/tqqq-today-1m.tsv, the intraday page's source for the live
session. The long-term 5-minute history stays on Alpaca (update_intraday.py);
Alpaca's free plan withholds the most recent 15 minutes of SIP data, while
Yahoo serves the current minute, so the two are combined: history from
Alpaca, today from here.

Yahoo's 1-minute bars reach back 7 days per request; period=1d returns the
latest session, which is today during market hours and the last trading
day otherwise. The page decides whether to use the file by comparing its
date with the market calendar, so writing a stale session is harmless.

Same layout as the 5-minute file, one row per regular-session bar with the
bar's open time in New York local time:

    Date                Open    High    Low     Close   Volume
    9/29/2026 09:30:00  78.29   78.59   77.96   77.97   2103493
"""

import os

import pandas as pd
import yfinance as yf

TICKER = 'TQQQ'
INTERVAL = '1m'
MARKET_TZ = 'America/New_York'
SESSION_OPEN = (9, 30)
SESSION_LAST_BAR = (15, 59)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(BASE_DIR, 'data', 'intraday', 'tqqq-today-1m.tsv')
COLUMNS = ['Open', 'High', 'Low', 'Close', 'Volume']
DATE_FORMAT = '%-m/%-d/%Y %H:%M:%S'


def in_regular_session(ts):
    """True for bars whose open time falls inside 09:30-15:59 New York time."""
    return SESSION_OPEN <= (ts.hour, ts.minute) <= SESSION_LAST_BAR


def fetch_today():
    df = yf.download(TICKER, interval=INTERVAL, period='1d', auto_adjust=False, prepost=False, progress=False)
    if df.empty:
        raise RuntimeError(f"Yahoo returned no {INTERVAL} bars for {TICKER}")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[COLUMNS].dropna(subset=['Close'])
    df.index = df.index.tz_convert(MARKET_TZ)
    df = df[[in_regular_session(ts) for ts in df.index]]
    if df.empty:
        raise RuntimeError(f"Yahoo returned only out-of-session {INTERVAL} bars for {TICKER}")
    return df


def write_tsv(df, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write('Date\t' + '\t'.join(COLUMNS) + '\n')
        for ts, row in df.iterrows():
            f.write(ts.strftime(DATE_FORMAT) + '\t'
                    + '\t'.join(f'{row[c]:.4f}' for c in COLUMNS[:-1])
                    + f'\t{int(row["Volume"])}\n')


df = fetch_today()
write_tsv(df, OUT_PATH)
print(f"  {os.path.relpath(OUT_PATH)}: {len(df)} bars, "
      f"{df.index[0]:%Y-%m-%d %H:%M} to {df.index[-1]:%H:%M} ET")
