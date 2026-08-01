// Custom-strategy code for the Strategy Library. Each value is a pure object
// literal per the app's custom-strategy contract: { name, params, run(data, p) }.
// Self-contained (the sandbox worker evals each in isolation — no shared helpers).
// Verified over 1990–2025 / 2000–2008 / 2010–2025 via scratchpad/verify3.js.
//
// Browser: exposes window.STRATEGY_CODE. Node: module.exports (for the backtest).
const CODE = {};

// #1 Faber 10-month: QQQ vs 200-SMA checked ONLY on the last trading day of each month.
CODE[1] = `{
  name: "Faber 10-mo / 200-day (monthly) → TQQQ/cash",
  params: [{ id: "window", label: "SMA window (days)", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data.qqq, lev = data.tqqq;
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      const px = lev[i];
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (monthEnd) {
        let sum = 0, n = 0;
        for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
        const sma = n ? sum / n : 0, bull = sma > 0 && sig[i] > sma;
        if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
        else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      }
      if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #2 Gayed LRS 3×: SPY vs 200-SMA daily → SPXL (3× S&P) else cash.
CODE[2] = `{
  name: "Gayed LRS 3× — SPY 200SMA → SPXL/cash",
  params: [{ id: "window", label: "SMA window (days)", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, lev = data.spxl;
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #3 Gayed LRS 2×: SPY vs 200-SMA daily → SSO (2× S&P) else cash.
CODE[3] = `{
  name: "Gayed LRS 2× — SPY 200SMA → SSO/cash",
  params: [{ id: "window", label: "SMA window (days)", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, lev = data.sso;
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #8 Siegel ±band: SPY vs 200-SMA symmetric band → TQQQ/cash.
CODE[8] = `{
  name: "Siegel ±band SPY 200SMA → TQQQ/cash",
  params: [{ id: "band", label: "Band (% around SMA)", options: [0, 1, 2, 3], default: 1 },
           { id: "window", label: "SMA window", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, lev = data.tqqq, up = 1 + p.band / 100, dn = 1 - p.band / 100;
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], s = sig[i];
      if (sma > 0 && s > 0) {
        if (!invested && s >= sma * up && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
        else if (invested && s <= sma * dn) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      }
      if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #9 Canonical (SPY signal) 200-SMA → TQQQ/cash.
CODE[9] = `{
  name: "Canonical SPY 200SMA → TQQQ/cash",
  params: [{ id: "signal", label: "Signal", options: ["spy", "qqq"], default: "spy" },
           { id: "window", label: "SMA window", options: [100, 150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data[p.signal], lev = data.tqqq;
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #10 Canonical QQQ 200SMA → TQQQ else cash.
CODE[10] = `{
  name: "QQQ 200-day SMA → TQQQ else cash",
  params: [{ id: "signal", label: "Signal asset", options: ["qqq", "spy"], default: "qqq" },
           { id: "lev", label: "Leveraged ETF", options: ["tqqq", "qld", "sso", "spxl"], default: "tqqq" },
           { id: "window", label: "SMA window (days)", options: [100, 150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data[p.signal], lev = data[p.lev];
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #11 SPY 200SMA → UPRO (SPXL 3× S&P) else cash.
CODE[11] = `{
  name: "SPY 200SMA → UPRO (SPXL) / cash",
  params: [{ id: "window", label: "SMA window", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, lev = data.spxl;
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #12 SSO own-price 200SMA → SSO else cash.
CODE[12] = `{
  name: "SSO own 200SMA → SSO/cash (2×)",
  params: [{ id: "window", label: "SMA window", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, lev = data.sso;
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (lev[k] > 0) { sum += lev[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], bull = sma > 0 && px > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #13 Hollywood SPY 200SMA +4/-3 → TQQQ/QQQ.
CODE[13] = `{
  name: "Hollywood SPY 200SMA +4/-3 → TQQQ/QQQ",
  params: [{ id: "entry", label: "Enter band (% above)", options: [0, 2, 3, 4, 5], default: 4 },
           { id: "exit", label: "Exit band (% below)", options: [0, 2, 3, 4, 5], default: 3 },
           { id: "window", label: "SMA window", options: [100, 150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, up = 1 + p.entry / 100, dn = 1 - p.exit / 100;
    let cash = p.initial, shT = 0, shQ = 0, state = "qqq", prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = sig[i];
      if (sma > 0 && px > 0) { if (px >= sma * up) state = "tqqq"; else if (px <= sma * dn) state = "qqq"; }
      const pxT = data.tqqq[i], pxQ = data.qqq[i], cur = shT > 0 ? "tqqq" : (shQ > 0 ? "qqq" : "none");
      if (state !== cur && pxT > 0 && pxQ > 0) {
        cash += shT * pxT + shQ * pxQ; shT = 0; shQ = 0;
        if (state === "tqqq") shT = cash / pxT; else shQ = cash / pxQ;
        cash = 0; action = state === "tqqq" ? "buy TQQQ" : "derisk QQQ";
      } else if (cash > 0) {
        if (state === "tqqq" && pxT > 0) { shT += cash / pxT; cash = 0; }
        else if (state === "qqq" && pxQ > 0) { shQ += cash / pxQ; cash = 0; }
      }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action.indexOf("buy") === 0 || action.indexOf("derisk") === 0 || monthEnd)
        log.push({ date: data.dates[i], value: shT * pxT + shQ * pxQ + cash, price: pxT, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #15 Composer: QQQ 200-SMA trend AND RSI(14) not overbought → TQQQ else cash.
CODE[15] = `{
  name: "Composer 200MA + RSI trend → TQQQ/cash",
  params: [{ id: "rsiMax", label: "Max RSI(14) to hold", options: [60, 70, 80, 100], default: 80 },
           { id: "window", label: "SMA window", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, RW = 14, sig = data.qqq, lev = data.tqqq;
    const seed = Math.max(1, p.startIdx - 60);
    let ag = 0, al = 0;
    for (let i = seed; i < seed + RW && i <= p.startIdx; i++) { const d = sig[i] - sig[i - 1]; if (d > 0) ag += d; else al -= d; }
    ag /= RW; al /= RW;
    for (let i = seed + RW; i < p.startIdx; i++) { const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0; ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW; }
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW;
      const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], bull = sma > 0 && sig[i] > sma && rsi < p.rsiMax;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #17 MACD(12/26/9) on QQQ → TQQQ/cash + trailing stop.
CODE[17] = `{
  name: "MACD(12/26) → TQQQ/cash (+trailing stop)",
  params: [{ id: "trail", label: "Trailing stop (% from peak)", options: [0, 20, 30, 40], default: 30 }],
  run(data, p) {
    const log = [], sig = data.qqq, lev = data.tqqq;
    const seed = Math.max(0, p.startIdx - 60);
    let e12 = sig[seed] || 0, e26 = sig[seed] || 0, macd = 0, signal = 0;
    const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
    for (let i = seed + 1; i < p.startIdx; i++) { if (sig[i] > 0) { e12 += k12 * (sig[i] - e12); e26 += k26 * (sig[i] - e26); macd = e12 - e26; signal += k9 * (macd - signal); } }
    let cash = p.initial, sh = 0, invested = false, prevMonth = null, peak = 0;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4)), trail = p.trail / 100;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      const s = sig[i], px = lev[i];
      if (s > 0) { e12 += k12 * (s - e12); e26 += k26 * (s - e26); macd = e12 - e26; signal += k9 * (macd - signal); }
      const bull = macd > signal && macd > 0;
      if (invested && px > peak) peak = px;
      const stopped = invested && trail > 0 && px > 0 && px < peak * (1 - trail);
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; peak = px; action = "buy"; }
      else if ((!bull || stopped) && invested) { cash = sh * px; sh = 0; invested = false; action = stopped ? "stop" : "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || action === "stop" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #18 40-week SMA crossover: QQQ vs 200-day SMA checked WEEKLY (last trading day of ISO week).
CODE[18] = `{
  name: "40-week SMA (weekly) → TQQQ/cash",
  params: [{ id: "window", label: "SMA window (days)", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data.qqq, lev = data.tqqq;
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const dow = (ds) => new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10))).getUTCDay();
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      const px = lev[i];
      const weekEnd = i === p.endIdx || dow(data.dates[i + 1]) <= dow(data.dates[i]);
      if (weekEnd) {
        let sum = 0, n = 0;
        for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
        const sma = n ? sum / n : 0, bull = sma > 0 && sig[i] > sma;
        if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
        else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      }
      if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #19 Golden/Death cross 50/200 on QQQ → TQQQ/cash.
CODE[19] = `{
  name: "Golden/Death Cross 50/200 → TQQQ/cash",
  params: [{ id: "fast", label: "Fast SMA", options: [20, 50, 100], default: 50 },
           { id: "slow", label: "Slow SMA", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], F = p.fast, S = p.slow, sig = data.qqq, lev = data.tqqq;
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sf = 0, nf = 0; for (let k = Math.max(0, i - F + 1); k <= i; k++) { if (sig[k] > 0) { sf += sig[k]; nf++; } }
      let ss = 0, ns = 0; for (let k = Math.max(0, i - S + 1); k <= i; k++) { if (sig[k] > 0) { ss += sig[k]; ns++; } }
      const maF = nf ? sf / nf : 0, maS = ns ? ss / ns : 0, px = lev[i], bull = maS > 0 && maF > maS;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #20 Volatility targeting: hold TQQQ scaled so trailing vol ≈ target; rest cash. Rebalance monthly.
CODE[20] = `{
  name: "Vol-target TQQQ (scale to target vol)",
  params: [{ id: "target", label: "Target vol (%/yr)", options: [15, 20, 25, 30], default: 25 },
           { id: "lookback", label: "Vol lookback (days)", options: [20, 40, 60], default: 20 }],
  run(data, p) {
    const log = [], lev = data.tqqq, L = p.lookback, tgt = p.target / 100;
    let cash = p.initial, sh = 0, prevMonth = null, w = 0;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      const px = lev[i], newMonth = prevMonth === null || month !== prevMonth;
      prevMonth = month;
      if (newMonth && px > 0) {
        let m = 0, c = 0; const r = [];
        for (let k = Math.max(1, i - L + 1); k <= i; k++) { if (lev[k] > 0 && lev[k - 1] > 0) { const ret = lev[k] / lev[k - 1] - 1; r.push(ret); m += ret; c++; } }
        m = c ? m / c : 0; let v = 0; for (const x of r) v += (x - m) * (x - m); v = c ? Math.sqrt(v / c) * Math.sqrt(252) : 0;
        const targetW = v > 0 ? Math.max(0, Math.min(1, tgt / v)) : 0;
        const total = sh * px + cash;
        sh = (total * targetW) / px; cash = total - sh * px; w = targetW; action = "rebalance";
      }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "rebalance" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action, weight: w });
    }
    return { log };
  }
}`;

// #22 Connors RSI(2) dip-buy within a 200-SMA uptrend.
CODE[22] = `{
  name: "Connors RSI(2) dip-buy (200SMA trend)",
  params: [{ id: "buy", label: "Buy RSI(2) below", options: [5, 10, 15], default: 10 },
           { id: "sell", label: "Sell RSI(2) above", options: [60, 70, 80], default: 70 }],
  run(data, p) {
    const log = [], W = 200, RW = 2, sig = data.qqq, lev = data.tqqq;
    const seed = Math.max(1, p.startIdx - 30);
    let ag = 0, al = 0;
    for (let i = seed; i < seed + RW && i <= p.startIdx; i++) { const d = sig[i] - sig[i - 1]; if (d > 0) ag += d; else al -= d; }
    ag /= RW; al /= RW;
    for (let i = seed + RW; i < p.startIdx; i++) { const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0; ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW; }
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW;
      const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], up = sma > 0 && sig[i] > sma;
      if (up && !invested && rsi < p.buy && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (invested && (!up || rsi > p.sell)) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #23 TFTLT: QQQ 200SMA → TQQQ, RSI(10) overheat exit + cool-gate re-entry.
CODE[23] = `{
  name: "200-day SMA + RSI exit & re-entry",
  params: [{ id: "oh", label: "Overheat exit RSI(10) ≥", options: [60, 70, 80, 100], default: 80 },
           { id: "cool", label: "Cool-gate re-entry RSI(10) <", options: [40, 50, 60, 100], default: 60 }],
  run(data, p) {
    const log = [], W = 200, RW = 10, sig = data.qqq, lev = data.tqqq;
    const seed = Math.max(1, p.startIdx - 40);
    let ag = 0, al = 0;
    for (let i = seed; i < seed + RW && i <= p.startIdx; i++) { const d = sig[i] - sig[i - 1]; if (d > 0) ag += d; else al -= d; }
    ag /= RW; al /= RW;
    for (let i = seed + RW; i < p.startIdx; i++) { const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0; ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW; }
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW;
      const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, px = lev[i], up = sma > 0 && sig[i] > sma;
      const wantIn = up && rsi < p.oh && (invested || rsi < p.cool);
      if (wantIn && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; }
      else if (!wantIn && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "sell" || monthEnd)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #24 200SMA + Bodyguard (delever to QQQ, GTFO to cash).
CODE[24] = `{
  name: "200SMA + Bodyguard (delever/GTFO)",
  params: [{ id: "delev", label: "Delever→QQQ at (% above SMA)", options: [0, 20, 25, 30, 35, 40], default: 30 },
           { id: "gtfo", label: "Sell→cash at (% above SMA)", options: [0, 35, 40, 45, 50], default: 40 },
           { id: "window", label: "SMA window", options: [150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data.qqq;
    let cash = p.initial, shT = 0, shQ = 0, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, q = sig[i], aboveBy = sma > 0 ? (q / sma - 1) * 100 : 0;
      let want;
      if (sma <= 0 || q <= 0 || q < sma) want = "cash";
      else if (p.gtfo > 0 && aboveBy >= p.gtfo) want = "cash";
      else if (p.delev > 0 && aboveBy >= p.delev) want = "qqq";
      else want = "tqqq";
      const pxT = data.tqqq[i], pxQ = data.qqq[i], cur = shT > 0 ? "tqqq" : (shQ > 0 ? "qqq" : "cash");
      if (want !== cur && pxT > 0 && pxQ > 0) {
        cash += shT * pxT + shQ * pxQ; shT = 0; shQ = 0;
        if (want === "tqqq") { shT = cash / pxT; cash = 0; } else if (want === "qqq") { shQ = cash / pxQ; cash = 0; }
        action = want === "tqqq" ? "buy" : (want === "qqq" ? "delever" : "gtfo");
      } else if (cash > 0) {
        if (want === "tqqq" && pxT > 0) { shT += cash / pxT; cash = 0; }
        else if (want === "qqq" && pxQ > 0) { shQ += cash / pxQ; cash = 0; }
      }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "delever" || action === "gtfo" || monthEnd)
        log.push({ date: data.dates[i], value: shT * pxT + shQ * pxQ + cash, price: pxT, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #25 Always-invested: 200SMA → TQQQ else QQQ (park in unleveraged, not cash).
CODE[25] = `{
  name: "200SMA → TQQQ else QQQ (always in)",
  params: [{ id: "signal", label: "Signal / park", options: ["qqq", "spy"], default: "qqq" },
           { id: "lev", label: "Leveraged ETF", options: ["tqqq", "qld", "sso", "spxl"], default: "tqqq" },
           { id: "window", label: "SMA window", options: [100, 150, 200, 250], default: 200 }],
  run(data, p) {
    const log = [], W = p.window, sig = data[p.signal], lev = data[p.lev];
    let cash = p.initial, shLev = 0, shPark = 0, state = "park", prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold";
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4)) - y0);
        cash += amt; contributed = amt; action = "contribution";
      }
      prevMonth = month;
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W + 1); k <= i; k++) { if (sig[k] > 0) { sum += sig[k]; n++; } }
      const sma = n ? sum / n : 0, pxL = lev[i], pxP = sig[i], want = (sma > 0 && sig[i] > sma) ? "lev" : "park";
      if (want !== state && pxL > 0 && pxP > 0) {
        cash += shLev * pxL + shPark * pxP; shLev = 0; shPark = 0;
        if (want === "lev") shLev = cash / pxL; else shPark = cash / pxP;
        cash = 0; state = want; action = want === "lev" ? "buy" : "derisk";
      } else if (cash > 0) {
        if (state === "lev" && pxL > 0) { shLev += cash / pxL; cash = 0; }
        else if (state === "park" && pxP > 0) { shPark += cash / pxP; cash = 0; }
      }
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (contributed > 0 || action === "buy" || action === "derisk" || monthEnd)
        log.push({ date: data.dates[i], value: shLev * pxL + shPark * pxP + cash, price: pxL, contributed: contributed, action: action });
    }
    return { log };
  }
}`;

// #26 Rolling median 250 (hand-picked): sell when price runs >55% above its
// 250-day rolling median, hold otherwise. An overextension filter, NOT a trend
// filter — it only ever exits on strength, so it rides every crash to the bottom.
CODE[26] = `{
  name: "Rolling median 250",
  params: [
    { id: "asset", label: "Fund traded", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" },
      { value: "spxl", label: "SPXL" }, { value: "sso", label: "SSO" },
      { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "park", label: "Held when out", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" },
      { value: "qld", label: "QLD" } ] },
    { id: "threshold", label: "Sell when above median (%)", default: 55, options: [
      10,15,20,25,30,35,40,42,44,46,48,50,52,54,55,56,58,60,62,64,66,68,70,75,80,85,90,100,110,125,150,175,200] },
    { id: "window", label: "Median window (days)", default: 250, options: [
      40,60,80,100,120,140,160,180,190,200,210,220,230,240,250,260,270,280,290,300,310,320,340,360,380,400,450,500] },
    { id: "cashRate", label: "Cash interest (%/yr)", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", label: "Trading cost (%)", default: 0.02, options: [
      0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
  ],
  columns: [
    { key: "assetPrice", label: "Price", tip: "Closing price of the traded fund that day. The sell rule compares this against the rolling median." },
    { key: "medianPrice", label: "Median", tip: "The median closing price of the traded fund over your chosen window of trading days. Half the days in the window closed above this level, half below." },
    { key: "overPct", label: "Over median", tip: "How far the price sits above (+) or below (−) the rolling median, in percent. The strategy sells once this exceeds your sell threshold and buys back as soon as it drops below it again. Blank while the median is still warming up." }
  ],
  run(data, p) {
    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = p.window || 250;
    const thr = (p.threshold || 0) / 100;
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    // Rolling sorted window: binary insert/remove, one in one out per day — never re-sorted.
    const win = [];
    const lowerBound = v => {
      let lo = 0, hi = win.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; }
      return lo;
    };
    const ins = v => { win.splice(lowerBound(v), 0, v); };
    const rem = v => { const j = lowerBound(v); if (j < win.length && win[j] === v) win.splice(j, 1); };
    for (let k = Math.max(0, p.startIdx - W + 1); k < p.startIdx; k++) if (px[k] > 0) ins(px[k]);
    let cash = p.initial, shares = 0, held = "cash";
    let invested = p.initial, prevMonth = null;
    let median = 0, over = 0;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4), 10);
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (px[i] > 0) ins(px[i]);
      const out = i - W;
      if (out >= 0 && px[out] > 0) rem(px[out]);
      const m = win.length;
      median = m === 0 ? 0 : (m % 2 ? win[(m - 1) >> 1] : (win[m / 2 - 1] + win[m / 2]) / 2);
      over = median > 0 && px[i] > 0 ? px[i] / median - 1 : 0;
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4), 10) - y0);
        cash += amt; contributed = amt; invested += amt; action = "contribution";
      }
      prevMonth = month;
      let want = held;
      if (median > 0 && px[i] > 0) want = over > thr ? p.park : p.asset;
      if (want !== held) {
        const oldPx = priceOf(held, i);
        if (held !== "cash" && oldPx > 0) {
          const gross = shares * oldPx, f = gross * cost;
          cash += gross - f; fee += f; shares = 0;
        }
        const newPx = priceOf(want, i);
        if (want !== "cash" && newPx > 0) {
          const f = cash * cost;
          shares = (cash - f) / newPx; fee += f; cash = 0;
        }
        action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
        note = "price " + (over >= 0 ? "+" : "−") + Math.abs(over * 100).toFixed(1) + "% vs " + W + "d median";
        held = want;
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const hp = priceOf(held, i);
      const stockVal = shares * hp;
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed > 0 || monthEnd || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i], medianPrice: median, overPct: over * 100
        });
      }
    }
    const stretched = over > thr;
    const pctStr = (over >= 0 ? "+" : "−") + Math.abs(over * 100).toFixed(2) + "%";
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "cash" : p.park.toUpperCase();
    return {
      log: log,
      signals: {
        cards: [
          { label: A + " vs " + W + "-day median",
            value: (stretched ? "▲ " : "") + pctStr,
            tone: stretched ? "bad" : "good",
            icon: stretched ? "trendUp" : "activity",
            sub: (px[p.endIdx] || 0).toFixed(2) + " vs " + median.toFixed(2) + " median",
            tip: "How far " + A + "'s last close sits above or below its " + W + "-day rolling median. Below the sell threshold means stay invested; above it means the price is stretched and the strategy steps aside." },
          { label: "Sell trigger",
            value: "+" + (p.threshold || 0) + "%",
            icon: "flag",
            sub: stretched ? "exceeded — out of " + A : (Math.max(0, thr - over) * 100).toFixed(1) + " pts of headroom left",
            tip: "The overshoot level that triggers the exit: once the price runs this far above the median, the strategy sells to " + K + ". As soon as the reading drops back below this level it buys " + A + " again." },
          { label: "Held when out",
            value: K,
            icon: "shield",
            sub: p.park === "cash" ? "earning " + (p.cashRate || 0) + "%/yr" : "stays in the market while out",
            tip: "Where money sits while the sell signal is active. Cash earns the interest rate you set; a fund keeps market exposure at lower octane." }
        ],
        decision: {
          action: stretched ? (K === "cash" ? "Stay in cash" : "Buy " + K) : "Buy " + A,
          note: stretched ? "price is more than " + (p.threshold || 0) + "% above its median" : "price is within the normal band",
          tone: stretched ? "bad" : "good",
          reasons: [{
            name: "Median overshoot",
            val: A + " " + pctStr + " vs " + W + "d median",
            tag: stretched ? "out · " + K : "in · " + A,
            lean: stretched ? (K === "cash" ? "cash" : "out") : "buy"
          }]
        }
      }
    };
  }
}`;

// #39 Overheat exit (hand-picked): sell when the SIGNAL fund (SSO by default)
// closes >20% above its 150-day SMA, hold otherwise. Like #26 it only exits on
// strength, so it has no downside rule and rides every crash to the bottom.
CODE[39] = `{
  name: "Overheat exit (sell when stretched)",
  params: [
    { id: "asset", label: "Fund traded", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" },
      { value: "spxl", label: "SPXL" }, { value: "sso", label: "SSO" },
      { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "signal", label: "Signal read from", default: "sso", options: [
      { value: "sso", label: "SSO" }, { value: "spy", label: "SPY" },
      { value: "qqq", label: "QQQ" }, { value: "tqqq", label: "TQQQ" } ] },
    { id: "window", label: "SMA window (days)", default: 150, options: [
      20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,
      210,220,230,240,250,260,270,280,300,320,350,400] },
    { id: "stretch", label: "Sell when above SMA (%)", default: 20, options: [
      5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,28,30,32,35,40,45,50] },
    { id: "park", label: "Held when out", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" } ] },
    { id: "cashRate", label: "Cash interest (%/yr)", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", label: "Trading cost (%)", default: 0.02, options: [
      0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
  ],
  columns: [
    { key: "signalPrice", label: "Signal", tip: "Closing price of the fund the overheat signal is read from (SSO by default) — not necessarily the fund you trade." },
    { key: "signalSma", label: "SMA", tip: "The signal fund's moving average over your chosen window. The strategy compares the signal price against this line." },
    { key: "abovePct", label: "Above SMA", tip: "How far the signal price sits above (+) or below (−) its moving average. When this exceeds your sell threshold, the strategy sells; while it is at or below the threshold, it holds the traded fund." },
    { key: "assetPrice", label: "Fund price", tip: "Closing price of the traded fund that day, shown even on days you are parked, so you can see what you are in or out of." }
  ],
  run(data, p) {
    const log = [];
    const sig = data[p.signal] || data.sso;
    const px0 = data[p.asset] || data.tqqq;
    const W = p.window, thr = (p.stretch || 0) / 100;
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : data[id][i];
    let cash = p.initial, shares = 0, held = "cash";
    let sma = 0, above = 0;
    let invested = p.initial, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4), 10);
    let sum = 0, n = 0;
    for (let k = Math.max(0, p.startIdx - W + 1); k <= p.startIdx; k++)
      if (sig[k] > 0) { sum += sig[k]; n++; }
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (i > p.startIdx) {
        if (sig[i] > 0) { sum += sig[i]; n++; }
        const out = i - W;
        if (out >= 0 && sig[out] > 0) { sum -= sig[out]; n--; }
      }
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4), 10) - y0);
        cash += amt; contributed = amt; invested += amt; action = "contribution";
      }
      prevMonth = month;
      sma = n > 0 ? sum / n : 0;
      above = sma > 0 ? sig[i] / sma - 1 : 0;
      let want = held;
      if (sma > 0) { want = above > thr ? p.park : p.asset; }
      if (want !== held) {
        const oldPx = priceOf(held, i);
        if (held !== "cash" && oldPx > 0) {
          const gross = shares * oldPx, f = gross * cost;
          cash += gross - f; fee += f; shares = 0;
        }
        const newPx = priceOf(want, i);
        if (want !== "cash" && newPx > 0) {
          const f = cash * cost;
          shares = (cash - f) / newPx; fee += f; cash = 0;
        }
        action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
        note = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% vs SMA (trigger " + (thr * 100).toFixed(0) + "%)";
        held = want;
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const px = priceOf(held, i);
      const stockVal = shares * px;
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed > 0 || monthEnd || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: px, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          signalPrice: sig[i], signalSma: sma, abovePct: above * 100, assetPrice: px0[i]
        });
      }
    }
    const stretched = above > thr;
    const pctStr = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const gap = thr * 100 - above * 100;
    const A = p.asset.toUpperCase(), S = p.signal.toUpperCase();
    const K = p.park === "cash" ? "cash" : p.park.toUpperCase();
    return {
      log: log,
      signals: {
        cards: [
          { label: S + " vs " + p.window + "-day avg",
            value: (above >= 0 ? "▲ " : "▼ ") + pctStr,
            tone: stretched ? "bad" : "good",
            icon: stretched ? "trendDown" : "trendUp",
            sub: (sig[p.endIdx] || 0).toFixed(2) + " vs " + sma.toFixed(2) + " avg",
            tip: "How far " + S + " sits above its " + p.window + "-day moving average. At or below +" + (thr * 100).toFixed(0) + "% the strategy holds " + A + "; beyond it, it sells." },
          { label: "Sell trigger",
            value: "+" + (thr * 100).toFixed(0) + "%",
            icon: "flag",
            sub: stretched ? "trigger is active — stretched past it" : "fires if " + S + " stretches past this",
            tip: "The overheat level: when " + S + " closes more than this far above its moving average, " + A + " is sold and the money moves to " + K + "." },
          { label: "Distance to trigger",
            value: (gap >= 0 ? gap.toFixed(2) + "% room" : Math.abs(gap).toFixed(2) + "% past"),
            tone: stretched ? "bad" : "good",
            icon: "activity",
            sub: stretched ? "must fall back below +" + (thr * 100).toFixed(0) + "% to re-buy" : "how much further " + S + " can stretch before selling",
            tip: "Gap between the current stretch and the sell trigger. Positive means room left while holding; negative means the market is past the trigger and the strategy is out." },
          { label: "Held when out",
            value: K === "cash" ? "Cash" : K,
            icon: K === "cash" ? "dollar" : "shield",
            sub: K === "cash" ? (p.cashRate || 0) + "%/yr interest on parked money" : "parked in " + K + " while out of " + A,
            tip: "Where money sits after an overheat sell. It moves back into " + A + " as soon as " + S + " drops back to or below the trigger." }
        ],
        decision: {
          action: stretched ? (K === "cash" ? "Stay in cash" : "Buy " + K) : "Buy " + A,
          note: stretched ? S + " is stretched " + pctStr + " above its average" : "market is not overheated (" + pctStr + " vs +" + (thr * 100).toFixed(0) + "% trigger)",
          tone: stretched ? "bad" : "good",
          reasons: [{
            name: "Overheat",
            val: S + " " + pctStr + " vs " + p.window + "d (trigger +" + (thr * 100).toFixed(0) + "%)",
            tag: stretched ? "out · " + K : "in · " + A,
            lean: stretched ? (K === "cash" ? "cash" : "out") : "buy"
          }]
        }
      }
    };
  }
}`;

// Browser global + Node export.
if (typeof window !== 'undefined') window.STRATEGY_CODE = CODE;
if (typeof module !== 'undefined' && module.exports) module.exports = CODE;
