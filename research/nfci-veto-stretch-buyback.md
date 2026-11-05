Hold TQQQ. When it closes 55% above its 250-day median, switch to SQQQ; switch back to TQQQ as soon as it closes under that line again.

Sell line: the median itself. When it closes below the median, sell to cash; buy back when it closes above it again.

Buy-back line: 28% below the median. If, while sold out, the price closes at or below it, the first close back above it buys TQQQ without waiting for the sell line. Until the price has closed above the sell line again, the buy-back line is the sell line too: a close back under it sells again, and the next close above it buys again.

Checked daily, one trade per day. On top of that, one credit rule using the Chicago Fed’s weekly NFCI (0 = average conditions, higher = tighter credit; each reading is used 7 days after its week ends): when it crosses above +0.4, sell whatever is held to cash and stay there. The credit rule switches off when the NFCI falls back under +0.4, or as soon as the price rules have gone through their own sell and re-entry while it was on. After that the price rules run everything until the NFCI drops under +0.4 and crosses back above. The credit rule only ever sells, never buys.

Everything not named above is exactly as the library's "NFCI veto, med stretch with SQQQ and med crash exit" has it; the code below is derived from that entry and reproduces it row for row when the sell line is set back to -28% with its gates on (slope 20, 10 days) and the buy-back line is Off.

{
  name: "NFCI veto, SQQQ stretch, sell line + crash buy-back",
  params: [
    { section: "Fund & signal" },
    { id: "asset", label: "Fund traded", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "stat", label: "Center line", default: "median", options: [
      { value: "median", label: "Median" }, { value: "sma", label: "Moving average" },
      { value: "rsi", label: "RSI (vs its 50 midline)" } ] },
    { id: "window", label: "Window (days)", default: 250, options: [
      5,7,10,14,20,30,40,50,60,75,90,100,110,120,130,140,150,160,175,190,200,210,220,230,240,250,260,270,280,290,300,320,340,360,400,450,500] },
    { section: "Overextended — sell the melt-up" },
    { id: "overPct", label: "Above line (%)", default: 55, options: [
      2,4,5,6,8,10,12,15,18,20,22,25,28,30,32,35,38,40,42.5,45,47.5,50,52.5,55,57.5,60,62.5,65,67.5,70,72.5,75,80,85,90,95,100,110,120,125,130,140,150,160,175,200,225,250,300] },
    { id: "park", label: "Then hold", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    { section: "Crash signal — the exit measures against this" },
    { id: "crashStat", label: "Center line", default: "same", options: [
      { value: "same", label: "Same as main" }, { value: "median", label: "Median" },
      { value: "sma", label: "Moving average" }, { value: "rsi", label: "RSI (vs its 50 midline)" } ] },
    { id: "crashWindow", label: "Window (days)", default: 0, options: [
      { value: 0, label: "Same as main" },
      5,7,10,14,20,30,40,50,60,75,90,100,110,120,130,140,150,160,175,190,200,210,220,230,240,250,260,270,280,290,300,320,340,360,400,450,500] },
    { section: "Sell line — leave when it breaks down" },
    { id: "exitPct", label: "Below line (%)", default: 0, options: [
      10,8,6,5,4,3,2,1,0,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-11,-12,-13,-14,-15,-16,-17,-18,-19,-20,-22,-24,-25,-26,-28,-30,-32,-34,-35,-36,-38,-40,-42,-44,-45,-46,-48,-50,-52,-55,-58,-60,-65,-70,-75,-80] },
    { id: "crashAsset", label: "Then hold", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "sqqq", label: "SQQQ" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" },
      { value: "tqqq", label: "TQQQ" }, { value: "spxl", label: "SPXL" } ] },
    { id: "slopeGate", label: "Only if line slope below (%/yr)", default: 999, options: [
      { value: 999, label: "Off" }, { value: -40, label: "-40" }, { value: -20, label: "-20" },
      { value: -10, label: "-10" }, { value: 0, label: "0" }, { value: 10, label: "10" },
      { value: 20, label: "20" }, { value: 30, label: "30" }, { value: 40, label: "40" },
      { value: 60, label: "60" }, { value: 80, label: "80" }, { value: 120, label: "120" } ] },
    { id: "belowGate", label: "Only after days below line", default: 0, options: [
      { value: 0, label: "Off" }, 1,2,3,5,8,10,15,20,30] },
    { section: "Buy-back line — after a crash, re-enter here instead of waiting for the sell line; it sells again below it" },
    { id: "bbPct", label: "Below line (%)", default: -28, options: [
      { value: 999, label: "Off" }, -10,-12,-14,-15,-16,-18,-20,-22,-24,-25,-26,-28,-30,-32,-34,-35,-36,-38,-40,-42,-44,-45,-46,-48,-50,-52,-55,-58,-60,-65,-70,-75,-80] },
    { section: "Credit veto — NFCI (Chicago Fed)" },
    { id: "nfciTh", label: "Go to cash when NFCI above", default: 0.4, options: [
      { value: 999, label: "Off" }, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0, 1.5, 2.0 ] },
    { id: "vetoEnd", label: "Veto lifts when", default: "cycle", options: [
      { value: "cycle", label: "NFCI calms OR a crash exit→recovery completes" },
      { value: "nfci", label: "NFCI calms only" } ] },
    { section: "Execution & costs" },
    { id: "splitDays", label: "One trade per day", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "cashRate", label: "Cash interest (%/yr)", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,10,11,12] },
    { id: "tradeCost", label: "Trading cost (%)", default: 0.02, options: [
      0,0.01,0.02,0.03,0.04,0.05,0.06,0.08,0.1,0.15,0.2,0.25,0.3,0.4,0.5,0.6,0.75,1] }
  ],
  columns: [
    { key: "assetPrice", label: "Fund", tip: "Closing price of the traded fund." },
    { key: "medianPrice", label: "Center", tip: "The main center line in price dollars — median or moving average of the last N closes, or the RSI-implied center (price x 50 / RSI) when the signal is RSI." },
    { key: "abovePct", label: "vs line", tip: "How far the main signal sits above (+) or below (−) its center, in percent." },
    { key: "nfci", label: "NFCI", tip: "Chicago Fed National Financial Conditions Index (weekly, 7-day publication lag). Above 0 = tighter-than-average conditions; above the veto threshold = credit crunch, everything to cash." },
    { key: "zone", label: "Band", tip: "Which band the close landed in — overextended, normal, or sold (below the sell line) — or CREDIT VETO while the NFCI override holds everything in cash." },
    { key: "fee", label: "Fee", tip: "Trading cost paid on this row's trade." }
  ],
  run(data, p) {
    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = Math.max(2, p.window || 250);
    const over = (p.overPct || 0) / 100;
    const exitB = (p.exitPct || 0) / 100;
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    const crashAsset = p.crashAsset || "cash";
    const nfciTh = p.nfciTh == null ? 0.4 : +p.nfciTh;
    const nfciArr = data.nfci || null;
    // Veto-lift semantics. "cycle" (default): NFCI is a crash START signal —
    // the veto arms when NFCI crosses above the threshold and lifts when
    // EITHER NFCI calms OR the price engine completes a full crash-exit →
    // recovery cycle while vetoed (the price side has re-earned entry, so
    // elevated credit stress alone no longer keeps us out). "nfci": stay in
    // cash the whole time NFCI reads above the threshold.
    const vetoCycle = (p.vetoEnd || "cycle") !== "nfci";
    let vetoActive = false, cycleExit = false, prevAbove = false;

    const useMed = p.stat !== "sma";
    const mainRsi = p.stat === "rsi";
    const crashSame = p.crashStat === "same" || p.crashStat == null;
    const crashRsi = crashSame ? mainRsi : p.crashStat === "rsi";
    const W2raw = +p.crashWindow || 0;
    const W2 = W2raw > 0 ? Math.max(2, W2raw) : W;
    const useMedC = crashSame ? useMed : p.crashStat !== "sma";
    const sameLine = W2 === W && crashRsi === mainRsi && (crashRsi || useMedC === useMed);

    const mkRoll = (Wn) => {
      const win = []; let sum = 0;
      const lb = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
      const warmFrom = Math.max(0, p.startIdx - Wn + 1);
      return {
        warmFrom, Wn,
        ins(v) { win.splice(lb(v), 0, v); sum += v; },
        rem(v) { const k = lb(v); if (k < win.length && win[k] === v) { win.splice(k, 1); sum -= v; } },
        center(m) { const n = win.length; return n === 0 ? 0 : (m ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : sum / n); }
      };
    };
    const mkRsi = (Wn) => {
      let ag = 0, al = 0, cnt = 0;
      const upd = (i) => {
        if (!(px[i] > 0 && px[i - 1] > 0)) return;
        const d = px[i] - px[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
        if (cnt < Wn) { ag += g; al += l; cnt++; if (cnt === Wn) { ag /= Wn; al /= Wn; } }
        else { ag = (ag * (Wn - 1) + g) / Wn; al = (al * (Wn - 1) + l) / Wn; }
      };
      for (let k = Math.max(1, p.startIdx - 4 * Wn); k < p.startIdx; k++) upd(k);
      return { step: upd, val() { return cnt < Wn ? 0 : (al === 0 ? 100 : 100 - 100 / (1 + ag / al)); } };
    };
    const rollM = mainRsi ? null : mkRoll(W);
    const rollC = crashRsi ? null : (sameLine ? rollM : mkRoll(W2));
    const rsiM = mainRsi ? mkRsi(W) : null;
    const rsiC = crashRsi ? (mainRsi && W2 === W ? rsiM : mkRsi(W2)) : null;
    if (rollM) for (let k = rollM.warmFrom; k < p.startIdx; k++) if (px[k] > 0) rollM.ins(px[k]);
    if (rollC && rollC !== rollM) for (let k = rollC.warmFrom; k < p.startIdx; k++) if (px[k] > 0) rollC.ins(px[k]);

    const slopeGate = p.slopeGate == null ? 999 : +p.slopeGate;
    const belowGate = +p.belowGate || 0;
    const bbPct = p.bbPct == null ? 999 : +p.bbPct;
    const bbB = bbPct === 999 ? 0 : bbPct / 100;
    // sellArmed: the normal sell line is live. A buy-back switches it off until the price has closed
    // back above that line; until then the buy-back line is the sell line, so a close back under it
    // sells again. bbArmed: while sold out, the price has closed at or below the buy-back line.
    let sellArmed = true, bbArmed = false;
    const preC = new Float64Array(63);
    if (!crashRsi && slopeGate !== 999) {
      const pre = mkRoll(W2);
      const pf = Math.max(0, p.startIdx - 63 - W2 + 1);
      for (let k = pf; k < p.startIdx - 63; k++) if (px[k] > 0) pre.ins(px[k]);
      for (let j = 0; j < 63; j++) {
        const k = p.startIdx - 63 + j;
        if (k >= 0 && px[k] > 0) pre.ins(px[k]);
        const dropK = k - W2;
        if (dropK >= pf && px[dropK] > 0) pre.rem(px[dropK]);
        preC[j] = k >= 0 ? pre.center(useMedC) : 0;
      }
    }
    const histC = new Float64Array(64);
    let belowC = 0, slopeC = 0;

    let cash = p.initial, shares = 0, held = "cash";
    let state = "normal", invested = p.initial, feeTotal = 0;
    let med = 0, medC = 0, above = 0, aboveC = 0, zone = "normal";
    let sigM = 0, sigC = 0;
    let minAC = Infinity, maxAC = -Infinity;
    let stints = [], inCrash = false, stintLen = 0;
    let peakPx = 0, peakDate = "", ddNow = 0, maxDdSeen = 0;
    // Credit-veto bookkeeping for the signal cards.
    let nfNow = NaN, vetoOn = false, vetoDays = 0, vetoWindows = 0, wasVeto = false;

    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (px[i] > 0) {
        if (rollM) rollM.ins(px[i]);
        if (rollC && rollC !== rollM) rollC.ins(px[i]);
      }
      if (rollM) { const drop = i - W; if (drop >= rollM.warmFrom && px[drop] > 0) rollM.rem(px[drop]); }
      if (rollC && rollC !== rollM) { const dropC = i - W2; if (dropC >= rollC.warmFrom && px[dropC] > 0) rollC.rem(px[dropC]); }
      if (rsiM && i > 0) rsiM.step(i);
      if (rsiC && rsiC !== rsiM && i > 0) rsiC.step(i);
      med = mainRsi ? 50 : rollM.center(useMed);
      sigM = mainRsi ? rsiM.val() : px[i];
      medC = sameLine ? med : (crashRsi ? 50 : rollC.center(useMedC));
      sigC = sameLine ? sigM : (crashRsi ? rsiC.val() : px[i]);
      above = med > 0 && sigM > 0 ? sigM / med - 1 : 0;
      aboveC = medC > 0 && sigC > 0 ? sigC / medC - 1 : 0;
      const dayN = i - p.startIdx;
      const prevC = crashRsi ? 50 : (dayN >= 63 ? histC[(dayN - 63) % 64] : preC[dayN] || 0);
      slopeC = prevC > 0 && medC > 0 ? (Math.pow(medC / prevC, 4) - 1) * 100 : 0;
      histC[dayN % 64] = medC;
      belowC = (medC > 0 && sigC > 0 && sigC < medC) ? belowC + 1 : 0;
      if (medC > 0 && sigC > 0) {
        if (aboveC < minAC) minAC = aboveC;
        if (aboveC > maxAC) maxAC = aboveC;
      }
      if (px[i] > 0) {
        if (px[i] > peakPx) { peakPx = px[i]; peakDate = data.dates[i]; }
        ddNow = peakPx > 0 ? px[i] / peakPx - 1 : 0;
        if (-ddNow > maxDdSeen) maxDdSeen = -ddNow;
      }
      nfNow = nfciArr ? nfciArr[i] : NaN;
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      if (held === "cash") cash *= 1 + dayRate;
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
        // A withdrawal: cash pays first, then holdings are sold at today's close. The account never goes below zero.
        if (cash < 0) {
          const heldPx = priceOf(held, i), gross = Math.min(shares * heldPx, -cash / (1 - cost));
          if (gross > 0) {
            shares = Math.max(0, shares - gross / heldPx); fee += gross * cost;
            note = "withdrawal — sold " + held.toUpperCase();
          }
          cash = 0;
        }
      }

      if (med > 0 && medC > 0 && sigM > 0 && sigC > 0 && px[i] > 0) {
        const pOver = med * (1 + over), pExit = medC * (1 + exitB), pBuyBack = medC * (1 + bbB);
        if (state === "normal" || state === "over") {
          if (!sellArmed && sigC >= pExit) sellArmed = true;   // back above the sell line: it is live again
          if (sigM > pOver) state = "over";
          else if (sellArmed && sigC < pExit
            && (slopeGate === 999 || slopeC < slopeGate)
            && (belowGate === 0 || belowC >= belowGate)) state = "crashCash";
          else if (!sellArmed && sigC < pBuyBack) state = "crashCash";   // the second sell line: back under the buy-back line after a buy-back
          else state = "normal";
        } else if (bbArmed && sigC > pBuyBack) { state = "normal"; sellArmed = false; }   // crash buy-back: in early, the normal sell on hold
        else if (sigC > pExit) { state = "normal"; sellArmed = true; }
        bbArmed = state === "crashCash" && bbPct !== 999 && (bbArmed || sigC <= pBuyBack);
        zone = state === "over" ? "overextended" : state === "normal" ? "normal" : "sold";
        // The one-way credit veto: only ever a reason to be in cash.
        const nfAbove = nfciTh !== 999 && isFinite(nfNow) && nfNow > nfciTh;
        if (!vetoCycle) vetoOn = nfAbove;
        else {
          if (nfAbove && !prevAbove) { vetoActive = true; cycleExit = false; }
          if (!nfAbove) vetoActive = false;
          if (vetoActive) {
            if (state === "crashCash") cycleExit = true;
            else if (cycleExit) vetoActive = false;   // price re-earned entry: release
          }
          vetoOn = vetoActive;
        }
        prevAbove = nfAbove;
        if (vetoOn) { vetoDays++; if (!wasVeto) vetoWindows++; }
        wasVeto = vetoOn;
        let want = state === "normal" ? p.asset
          : state === "over" ? p.park
          : crashAsset;
        if (vetoOn) want = "cash";
        if (p.splitDays && want !== held && held !== "cash" && want !== "cash") want = "cash"; // leg 1 today, buy re-checks next bar
        if (want !== held) {
          const oldPx = priceOf(held, i);
          if (held !== "cash" && oldPx > 0) {
            const gross = shares * oldPx, f = gross * cost;
            cash += gross - f; fee += f; shares = 0;
          }
          const newPx = priceOf(want, i);
          if (want === "cash" || newPx > 0) {
            if (want !== "cash") { const f = cash * cost; shares = (cash - f) / newPx; fee += f; cash = 0; }
            action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
            note = vetoOn ? "NFCI " + nfNow.toFixed(2) + " > " + nfciTh + " — credit veto"
              : (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% vs line — " + zone;
            held = want;
          }
        } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
          const f = cash * cost;
          shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
          if (action === "contribution") note = "contribution deployed";
        }
      }
      const wasCrash = inCrash;
      inCrash = state === "crashCash";
      if (inCrash) stintLen++;
      if (wasCrash && !inCrash) { stints.push(stintLen); stintLen = 0; }
      feeTotal += fee;
      const medPlot = mainRsi ? (sigM > 0 ? px[i] * 50 / sigM : 0) : med;
      const hp = priceOf(held, i);
      const stockVal = shares * hp;
      // Weekly-resolution logging when the chart's shared axis is weekly
      // (a <10y window — js/chart.js's chartDisplayPeriod), so this line
      // renders as smoothly as the built-in engines instead of a sparse
      // once-a-month log getting step-resampled onto a much finer axis.
      // Falls back to the original month-boundary check otherwise —
      // byte-identical to before whenever p.weeklyDisplay is unset.
      const monthEnd = p.weeklyDisplay
        ? (i === p.endIdx || Math.floor((Date.parse(data.dates[i]) / 86400000 + 3) / 7) !== Math.floor((Date.parse(data.dates[i + 1]) / 86400000 + 3) / 7))
        : (i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month);
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || monthEnd || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i] || 0, medianPrice: medPlot, abovePct: above * 100,
          nfci: isFinite(nfNow) ? nfNow : null,
          zone: vetoOn ? "CREDIT VETO" : zone,
          overLine: medPlot * (1 + over), exitLine: medPlot * (1 + exitB),
          ...(bbPct === 999 ? {} : { buyBackLine: medPlot * (1 + bbB) })
        });
      }
    }

    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "cash" : p.park.toUpperCase();
    const lbl = id => id === "cash" ? "cash" : id.toUpperCase();
    const CN = mainRsi ? "RSI(" + W + ")" : (useMed ? "median" : "avg");
    const pctStr = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const zoneTone = vetoOn ? "bad" : zone === "normal" ? "good" : "bad";
    const holdTxt = held === "cash" ? "cash" : held.toUpperCase();
    const chartLines = [
      { key: "assetPrice", label: A + " price" },
      mainRsi ? { key: "medianPrice", label: "RSI(" + W + ") line" } : { key: "medianPrice", label: W + "-day " + CN },
      { key: "exitLine", label: "Sell line (" + (p.exitPct || 0) + "%)" },
      { key: "overLine", label: "Overextended (+" + (p.overPct || 0) + "%)" }
    ];
    if (bbPct !== 999) chartLines.push({ key: "buyBackLine", label: "Buy-back (" + bbPct + "%)" });
    if (inCrash && stintLen > 0) stints.push(stintLen);
    const nfciStr = isFinite(nfNow) ? (nfNow >= 0 ? "+" : "") + nfNow.toFixed(2) : "n/a";
    const vetoDist = isFinite(nfNow) && nfciTh !== 999 ? (nfciTh - nfNow) : NaN;
    return {
      log: log,
      lines: chartLines,
      signals: {
        cards: [
          { label: mainRsi ? "RSI(" + W + ") vs 50" : A + " vs " + W + "-day " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pctStr,
            tone: zone === "normal" ? "good" : "bad",
            icon: above >= 0 ? "trendUp" : "trendDown",
            sub: (mainRsi ? sigM.toFixed(1) + " vs 50" : (px[p.endIdx] || 0).toFixed(2) + " vs " + med.toFixed(2) + " " + CN),
            tip: "The stretch reading the overextension rule uses. Above +" + (p.overPct || 0) + "% parks in " + K + "; below " + (p.exitPct || 0) + "% (with the confirmation gates) sells to " + lbl(crashAsset) + "." },
          { label: "Current band",
            value: vetoOn ? "CREDIT VETO" : zone,
            tone: zoneTone,
            icon: "sliders",
            sub: "holding " + holdTxt,
            tip: "Which band the last close landed in — overextended (park), normal (hold), sold (out) — or CREDIT VETO while the NFCI override keeps everything in cash regardless of the bands." },
          { label: "NFCI credit veto",
            value: nfciStr,
            tone: nfciTh === 999 ? "good" : (vetoOn ? "bad" : "good"),
            icon: "shield",
            sub: nfciTh === 999 ? "veto off"
              : vetoOn ? "ABOVE +" + nfciTh + " — in cash until it calms" + (vetoCycle ? " or a crash cycle completes" : "")
              : "veto at +" + nfciTh + " (" + vetoDist.toFixed(2) + " away) · fired " + vetoWindows + "x, " + vetoDays + "d this run",
            tip: "Chicago Fed National Financial Conditions Index, weekly with a 7-day publication lag. Above +" + (nfciTh === 999 ? "0.4" : nfciTh) + " = credit crunch: everything goes to cash. One-way — it never adds leverage. The veto lifts when the index calms" + (vetoCycle ? ", or earlier if the price engine fires its own crash exit and then recovers while vetoed — the market has re-earned entry, so credit stress alone no longer keeps you out" : "") + ". Fired only in genuine credit crises since 1971 (1973-75, the Volcker squeeze, 1987, S&L 1990, the GFC) and has been silent since July 2009." },
          { label: "Sell line",
            value: (p.exitPct || 0) + "%",
            icon: "shield",
            sub: (sellArmed ? "armed" : "on hold until a close above it") + " · then hold " + lbl(crashAsset)
              + (slopeGate !== 999 ? " · needs slope<" + slopeGate : "")
              + (belowGate > 0 ? " · " + belowGate + "d below" : ""),
            tip: "A close this far below the center sells " + A + " to " + lbl(crashAsset) + " (after any confirmation gates). Bought back on a close above this line, or earlier at the buy-back line after a crash; after such an early buy-back this line is on hold and the buy-back line sells instead, until the price has closed above this line again." },
          { label: "Buy-back line",
            value: bbPct === 999 ? "off" : bbPct + "%",
            icon: "flag",
            tone: bbArmed ? "good" : "",
            sub: bbPct === 999 ? "re-entry only above the sell line"
              : bbArmed ? "ARMED — the first close above it buys " + A
              : state === "crashCash" ? "waiting for a close at or below it"
              : sellArmed ? "idle while in the market" : "live — a close under it sells again",
            tip: "After a sell, a close at or below this line marks a crash; the first close back above it buys " + A + " without waiting for the sell line. Until the price has closed above the sell line again, this line sells too: a close back under it puts you out, and the next close above it buys again." },
          { label: A + " drawdown",
            value: (ddNow * 100).toFixed(1) + "%",
            tone: ddNow > -0.15 ? "good" : "bad",
            icon: "trendDown",
            sub: "from " + peakPx.toFixed(2) + " high (" + peakDate + "); worst " + (-maxDdSeen * 100).toFixed(0) + "%",
            tip: "The traded fund's fall from its running high. The price bands act on stretch-vs-line, the veto on credit conditions — this shows what they are protecting against." }
        ],
        decision: {
          action: vetoOn ? "Stay in cash — credit veto"
            : (state === "normal" ? "Buy " + A : state === "over" ? "Hold " + K : lbl(crashAsset) === "cash" ? "Stay in cash" : "Hold " + lbl(crashAsset)),
          note: vetoOn ? "NFCI " + nfciStr + " above +" + nfciTh + " — waiting for credit conditions to calm"
            : "signal is " + pctStr + " vs the " + CN + " — " + zone + " band; NFCI " + nfciStr,
          tone: zoneTone,
          reasons: [
            { name: "Band", val: A + " " + pctStr + " vs " + CN, tag: zone + " · " + holdTxt,
              lean: zone === "normal" ? "buy" : holdTxt === "cash" ? "cash" : "out" },
            { name: "Credit (NFCI)", val: nfciStr + " vs +" + (nfciTh === 999 ? "off" : nfciTh),
              tag: vetoOn ? "VETO — cash" : "calm",
              lean: vetoOn ? "cash" : "buy" }
          ]
        }
      }
    };
  }
}
