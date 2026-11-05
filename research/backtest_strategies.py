#!/usr/bin/env python3
"""Consistent 2010->present backtest for the price+SMA strategies, computed
from this repo's own daily TSVs. Lump-sum $10k, no contributions, no-lookahead
(position from yesterday's signal applied to today's return), cash = 0%.
"""
import os, math
BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")   # the repo's data folder
START = "2010-02-11"  # TQQQ inception

def load(fn):
    out = {}
    with open(os.path.join(BASE, fn)) as f:
        next(f)
        for line in f:
            ds, close = line.rstrip("\n").split("\t")
            m, d, y = ds.split(" ")[0].split("/")
            key = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
            out[key] = float(close)
    return out

qqq = load("synthetic-qqq.tsv")
tqqq = load("synthetic-tqqq.tsv")
spy = load("spy.tsv")
sso = load("synthetic-sso.tsv")

# common sorted dates with all needed assets present, from a bit before START
# so the 200-SMA is warm at START.
alldates = sorted(set(qqq) & set(tqqq) & set(spy) & set(sso))

def sma(series, dates, i, n):
    if i + 1 < n:
        return None
    s = 0.0
    for k in range(i - n + 1, i + 1):
        s += series[dates[k]]
    return s / n

def stats(equity, dates):
    """CAGR, maxDD, annualized vol, Sharpe(rf=0) from a daily equity list."""
    start_v, end_v = equity[0], equity[-1]
    d0 = dates[0]; d1 = dates[-1]
    from datetime import date
    y0 = date(*map(int, d0.split("-")))
    y1 = date(*map(int, d1.split("-")))
    years = (y1 - y0).days / 365.25
    cagr = (end_v / start_v) ** (1 / years) - 1
    peak = -1e18; mdd = 0.0
    for v in equity:
        if v > peak: peak = v
        dd = (peak - v) / peak
        if dd > mdd: mdd = dd
    rets = [equity[i] / equity[i-1] - 1 for i in range(1, len(equity))]
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / len(rets)
    vol = math.sqrt(var) * math.sqrt(252)
    sharpe = (mean * 252) / vol if vol > 0 else 0
    return cagr, mdd, vol, sharpe, years

# Precompute index of START
idxs = [i for i, d in enumerate(alldates) if d >= START]
start_i = idxs[0]

def run(position_fn, label):
    """position_fn(i) -> asset name held for day i->i+1 return, decided using
    data up to and including day i (no lookahead). We apply it to the i->i+1
    return. Equity sampled at each day's close from START."""
    equity = []
    dates_out = []
    val = 10000.0
    # seed equity at START
    equity.append(val); dates_out.append(alldates[start_i])
    for i in range(start_i, len(alldates) - 1):
        asset = position_fn(i)
        d_today = alldates[i]; d_next = alldates[i+1]
        if asset == "cash":
            r = 0.0
        else:
            series = {"tqqq": tqqq, "qqq": qqq, "spy": spy, "sso": sso}[asset]
            r = series[d_next] / series[d_today] - 1
        val *= (1 + r)
        equity.append(val); dates_out.append(d_next)
    cagr, mdd, vol, sharpe, years = stats(equity, dates_out)
    print(f"{label:52s} CAGR {cagr*100:6.1f}%  maxDD {mdd*100:5.1f}%  vol {vol*100:5.0f}%  Sharpe {sharpe:4.2f}  x{val/10000:6.1f}")
    return val

# --- signal helpers (decided at day i close, no lookahead) ---
def above_sma(series, i, n, buf=0.0):
    s = sma(series, alldates, i, n)
    if s is None: return None
    return series[alldates[i]] > s * (1 + buf)

def below_sma(series, i, n, buf=0.0):
    s = sma(series, alldates, i, n)
    if s is None: return None
    return series[alldates[i]] < s * (1 - buf)

print(f"\n=== 2010-02-11 -> {alldates[-1]}  |  lump-sum $10k, no contrib, cash=0%, no-lookahead ===\n")

# Benchmarks
run(lambda i: "tqqq", "Buy & Hold TQQQ (benchmark)")
run(lambda i: "qqq",  "Buy & Hold QQQ (benchmark)")
run(lambda i: "spy",  "Buy & Hold SPY (benchmark)")
run(lambda i: "sso",  "Buy & Hold SSO 2x (benchmark)")
print()

# #10 canonical QQQ 200SMA -> TQQQ else cash (daily)
def s_qqq200_tqqq_cash(i):
    a = above_sma(qqq, i, 200)
    return "tqqq" if a else "cash"
run(s_qqq200_tqqq_cash, "#10 QQQ>200SMA -> TQQQ else cash (daily)")

# #10b same but park in QQQ (always invested) = part of #25
def s_qqq200_tqqq_qqq(i):
    a = above_sma(qqq, i, 200)
    return "tqqq" if a else "qqq"
run(s_qqq200_tqqq_qqq, "#25 QQQ>200SMA -> TQQQ else QQQ (always-in)")

# #9/#21 SPY 200SMA cross-index -> TQQQ else cash
def s_spy200_tqqq_cash(i):
    a = above_sma(spy, i, 200)
    return "tqqq" if a else "cash"
run(s_spy200_tqqq_cash, "#21 SPY>200SMA -> TQQQ else cash (cross-index)")

# #13 Hollywood +4/-3: SPY 200SMA, +4 -> TQQQ, -3 -> QQQ (hysteresis, daily)
def make_hollywood():
    state = {"pos": "qqq"}
    def fn(i):
        s = sma(spy, alldates, i, 200)
        if s is None:
            return "qqq"
        px = spy[alldates[i]]
        if px >= s * 1.04:
            state["pos"] = "tqqq"
        elif px <= s * 0.97:
            state["pos"] = "qqq"
        return state["pos"]
    return fn
run(make_hollywood(), "#13 Hollywood SPY 200SMA +4/-3 -> TQQQ/QQQ (daily)")

# #12 SSO own-price 200SMA -> SSO else cash (SHY~cash proxy)
def s_sso_own(i):
    a = above_sma(sso, i, 200)
    return "sso" if a else "cash"
run(s_sso_own, "#12 SSO own 200SMA -> SSO else cash (2x)")

# #11 TQQQ own-price 200SMA -> TQQQ else cash
def s_tqqq_own(i):
    a = above_sma(tqqq, i, 200)
    return "tqqq" if a else "cash"
run(s_tqqq_own, "#(own) TQQQ own 200SMA -> TQQQ else cash")

# #19 Golden/Death cross 50/200 on QQQ -> TQQQ else cash
def s_golden(i):
    s50 = sma(qqq, alldates, i, 50)
    s200 = sma(qqq, alldates, i, 200)
    if s50 is None or s200 is None:
        return "cash"
    return "tqqq" if s50 > s200 else "cash"
run(s_golden, "#19 Golden/Death cross 50/200 QQQ -> TQQQ else cash")

# #1/#3 Faber MONTHLY cadence: QQQ vs 200SMA checked only on last trading day
# of each month; hold that decision all month.
def make_faber_monthly():
    # precompute last-trading-day index per month
    last_of_month = {}
    for i, d in enumerate(alldates):
        ym = d[:7]
        last_of_month[ym] = i  # last wins
    lasts = set(last_of_month.values())
    state = {"pos": "cash"}
    def fn(i):
        if i in lasts:
            a = above_sma(qqq, i, 200)
            state["pos"] = "tqqq" if a else "cash"
        return state["pos"]
    return fn
run(make_faber_monthly(), "#1/#3 Faber MONTHLY QQQ 200SMA -> TQQQ else cash")

print("\n(Cash=0%. Adding a ~1.5-2%/yr T-bill yield on the parked cash would lift")
print(" the timing rows by roughly +0.5-1.0pp CAGR each; benchmarks unaffected.)")
