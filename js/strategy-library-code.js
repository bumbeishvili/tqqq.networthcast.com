// Custom-strategy code for the Strategy Library. Each value is a pure object
// literal per the app's custom-strategy contract: { name, params, run(data, p) }.
// Self-contained (the sandbox worker evals each in isolation — no shared helpers).
// Verified over 1990–2025 / 2000–2008 / 2010–2025 via scratchpad/verify3.js.
//
// Browser: exposes window.STRATEGY_CODE. Node: module.exports (for the backtest).
const CODE = {};

// Shared SOURCE text for every strategy's weekly-vs-monthly log-density
// check (see CUSTOM_PROMPT's p.weeklyDisplay docs, js/saved-configs.js).
// Each CODE[n] below still needs its OWN literal copy of this at RUNTIME —
// the sandboxed Worker has no shared-function access, so every strategy's
// executed text must stay fully self-contained — but there's no reason to
// hand-duplicate the SOURCE 21 times too. Interpolated into each template
// literal below at file-load time, so the string actually stored in
// CODE[n] is byte-identical to writing it out by hand in each one.
const WEEKLY_MONTH_END_SNIPPET = `      // Whether today gets a plain "hold" row in the log. Logging cadence ONLY:
      // a rule that fires at month end computes its own calendar check (see the
      // Faber strategy), because this flag follows the display. p.dailyDisplay
      // is the signal chart's detail run (js/saved-configs.js customDetailLog):
      // every day, so zooming that chart in shows each day. Otherwise weekly
      // when the chart's shared axis is weekly (a <10y window — js/chart.js's
      // chartDisplayPeriod), so this line renders as smoothly as the built-in
      // engines instead of a sparse once-a-month log getting step-resampled
      // onto a much finer axis; month end otherwise.
      const logDay = p.dailyDisplay
        || (p.weeklyDisplay
          ? (i === p.endIdx || Math.floor((Date.parse(data.dates[i]) / 86400000 + 3) / 7) !== Math.floor((Date.parse(data.dates[i + 1]) / 86400000 + 3) / 7))
          : (i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month));`;

// The Center line statistic every rolling-level strategy offers: the moving
// average (the original arithmetic of the SMA strategies, unchanged) or the
// median of the same trailing window. A real function so there is ONE readable
// copy — each strategy embeds its SOURCE via CENTER_LINE_SNIPPET below, since
// the sandbox evals every strategy in isolation and the executed text must be
// self-contained.
function centerLine(arr, Wn, at, useMed) {
  if (!useMed) {
    let sum = 0, n = 0;
    for (let k = Math.max(0, at - Wn + 1); k <= at; k++) { if (arr[k] > 0) { sum += arr[k]; n++; } }
    return n ? sum / n : 0;
  }
  const w = [];
  for (let k = Math.max(0, at - Wn + 1); k <= at; k++) if (arr[k] > 0) w.push(arr[k]);
  const n = w.length;
  if (!n) return 0;
  w.sort((a, b) => a - b);
  return n % 2 ? w[(n - 1) >> 1] : (w[n / 2 - 1] + w[n / 2]) / 2;
}
// Interpolated into each strategy's run(): the param flag + the function's
// own source text (kept in sync automatically — it IS the function above).
const CENTER_LINE_SNIPPET = `    const useMed = p.stat === "median";
    ${centerLine.toString().replace(/\n/g, '\n    ')}`;

// The close that would put Wilder's RSI at x today, from yesterday's close and
// the average gain and loss over n days, smoothed as the RSI strategies below
// smooth them. RSI rises with the close, so a close above this level is
// exactly RSI above x: those strategies draw their RSI thresholds on the
// signal chart at these prices. null for x of 0 or 100, which no close
// reaches. Shared like centerLine: each strategy embeds the SOURCE via
// RSI_LEVEL_SNIPPET.
function rsiLevel(prev, ag, al, n, x) {
  if (!(x > 0 && x < 100) || !(prev > 0)) return null;
  const rs = x / (100 - x), m = n - 1;
  const rise = m * (rs * al - ag);
  return rise >= 0 ? prev + rise : prev - m * (ag / rs - al);
}
const RSI_LEVEL_SNIPPET = `    ${rsiLevel.toString().replace(/\n/g, '\n    ')}`;
// The stat param entry, in both default flavors.
const STAT_PARAM_SNIPPET = `{ id: "stat", label: "Center line", options: [{ value: "sma", label: "Moving average" }, { value: "median", label: "Median" }], default: "sma" }`;
const STAT_PARAM_MEDIAN_SNIPPET = `{ id: "stat", label: "Center line", options: [{ value: "median", label: "Median" }, { value: "sma", label: "Moving average" }], default: "median" }`;

// A withdrawal is a negative amount in p.contributions: a real uploaded
// transaction history has them. Every strategy below adds the day's amount to
// cash, so a withdrawal larger than the cash on hand used to leave cash
// negative with every share still held. That is an interest-free loan: the
// line ran leveraged, 2.4x on the history that exposed it, with no trade row
// to show for it. The rule now is the one the built-in engines use
// (js/simulate.js, the `currentMonthly < 0` branches of simulateSMA and
// simulate): cash pays first, then just enough of what is held is sold at
// that day's close. A withdrawal bigger than the whole account empties it and
// the rest is dropped, as it is there.
//
// Shared SOURCE like WEEKLY_MONTH_END_SNIPPET, interpolated on the line after
// each strategy's `cash += amt`. The strategies keep their books in a few
// different shapes, so `holdings` names each [share-count variable, price
// expression] pair a strategy can be holding.
const WITHDRAWAL_RULE = "A withdrawal: cash pays first, then holdings are sold at today's close. The account never goes below zero.";
const sellToCoverSnippet = (holdings) => [
  `        // ${WITHDRAWAL_RULE}`,
  `        if (cash < 0) {`,
  ...holdings.map(([sh, px]) =>
    `          { const sold = Math.min(${sh} * (${px} || 0), -cash); if (sold > 0) { ${sh} = Math.max(0, ${sh} - sold / ${px}); cash += sold; } }`),
  `          cash = 0;`,
  `        }`,
].join('\n');
const SELL_SH_TO_COVER = sellToCoverSnippet([['sh', 'lev[i]']]);
const SELL_TQQQ_QQQ_TO_COVER = sellToCoverSnippet([['shT', 'data.tqqq[i]'], ['shQ', 'data.qqq[i]']]);
const SELL_LEV_PARK_TO_COVER = sellToCoverSnippet([['shLev', 'lev[i]'], ['shPark', 'sig[i]']]);
// The strategies that charge a trading cost pay it on this sale too and say so
// in the row's note. `tracksTraded` is for the one that totals dollars traded.
const sellHeldToCoverSnippet = (tracksTraded) => [
  `        // ${WITHDRAWAL_RULE}`,
  `        if (cash < 0) {`,
  `          const heldPx = priceOf(held, i), gross = Math.min(shares * heldPx, -cash / (1 - cost));`,
  `          if (gross > 0) {`,
  `            shares = Math.max(0, shares - gross / heldPx); fee += gross * cost;${tracksTraded ? ' traded += gross;' : ''}`,
  `            note = "withdrawal — sold " + held.toUpperCase();`,
  `          }`,
  `          cash = 0;`,
  `        }`,
].join('\n');
const SELL_HELD_TO_COVER = sellHeldToCoverSnippet(false);
const SELL_HELD_TO_COVER_TRADED = sellHeldToCoverSnippet(true);

// Saved strategies carry their OWN copy of a library entry's code (cfg.code,
// and the same text inside share links), taken on the day it was added, so
// the snippets above never reach a copy made before they existed.
// upgradeWithdrawalHandling puts the matching snippet into such a copy. It
// only touches code that keeps its books the way a library entry does: each
// rule lists the declarations that must come before the money line, which is
// also what guarantees every variable the snippet uses exists by then.
// Anything else, hand-written and generated code included, comes back
// unchanged.
//
// Matching ignores whitespace because the code editor re-indents and re-wraps
// on paste and blur (js/saved-configs.js's initCodeEditor), so a saved copy
// can differ from the library's layout in whitespace alone.
const sourcePattern = (text) =>
  new RegExp(text.trim().split(/\s+/).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
const MONEY_LINE = 'cash += amt; contributed = amt; action = "contribution";';
const MONEY_LINE_INVESTED = 'cash += amt; contributed = amt; invested += amt; action = "contribution";';
const FEE_BOOKS = ['const cost =', 'const priceOf =', 'let cash = p.initial, shares = 0, held = "cash"'];
const WITHDRAWAL_UPGRADES = [
  { declares: [...FEE_BOOKS, 'note = "", fee = 0, traded = 0'], moneyLine: MONEY_LINE_INVESTED, snippet: SELL_HELD_TO_COVER_TRADED },
  { declares: [...FEE_BOOKS, 'note = "", fee = 0'], moneyLine: MONEY_LINE_INVESTED, snippet: SELL_HELD_TO_COVER },
  { declares: ['lev = data', 'sig = data', 'shLev = 0, shPark = 0'], moneyLine: MONEY_LINE, snippet: SELL_LEV_PARK_TO_COVER },
  { declares: ['shT = 0, shQ = 0'], moneyLine: MONEY_LINE, snippet: SELL_TQQQ_QQQ_TO_COVER },
  { declares: ['lev = data', 'let cash = p.initial, sh = 0,'], moneyLine: MONEY_LINE, snippet: SELL_SH_TO_COVER },
];
function upgradeWithdrawalHandling(code) {
  if (code.includes(WITHDRAWAL_RULE)) return code;
  const upgrade = WITHDRAWAL_UPGRADES
    .map(rule => ({ rule, money: sourcePattern(rule.moneyLine).exec(code) }))
    .find(({ rule, money }) => money && rule.declares.every(text => {
      const declared = sourcePattern(text).exec(code);
      return declared && declared.index < money.index;
    }));
  if (!upgrade) return code;
  const afterMoneyLine = upgrade.money.index + upgrade.money[0].length;
  return code.slice(0, afterMoneyLine) + '\n' + upgrade.rule.snippet + code.slice(afterMoneyLine);
}

// A saved copy made before 2026-10 ignores p.dailyDisplay, so the signal chart's
// detail run (js/saved-configs.js customDetailLog) shows it no finer than the
// ordinary run. upgradeDailyDisplay adds the flag to such a copy's row
// condition: `if (contributed !== 0 ||` is where every library strategy (and
// the prompt's worked example) decides whether to push a row, and the flag is
// unset on every run but the detail one, so nothing else changes. Code that
// already reads p.dailyDisplay is left alone, as is code without the library's
// `const monthEnd =` cadence line or whose params object is not `p`, since
// the same condition could be part of a rule there.
const ROW_CONDITION = new RegExp(sourcePattern('if (contributed !== 0 ||').source, 'g');
function upgradeDailyDisplay(code) {
  if (code.includes('dailyDisplay') || !/run\(data,\s*p\)/.test(code) || !sourcePattern('const monthEnd =').test(code)) return code;
  return code.replace(ROW_CONDITION, 'if (contributed !== 0 || p.dailyDisplay ||');
}
// Every upgrade a saved copy may need, in one call for js/saved-configs.js.
function upgradeSavedCode(code) { return upgradeDailyDisplay(upgradeWithdrawalHandling(code)); }

// Which library entry a saved copy came from, read off the `name:` line of its
// code — the one line every version of an entry keeps. Former names are listed
// for entries renamed since copies of them were made. null for code that is not
// a library copy. Used by js/saved-configs.js to bring unedited copies up to
// the current library code at load.
const LIBRARY_FORMER_NAMES = { 45: ['NFCI veto, SQQQ stretch, sell line + crash buy-back'] };
const codeName = code => { const m = /^\s*name:\s*"([^"]+)"/m.exec(String(code || '')); return m ? m[1] : null; };
function libraryEntryOf(code) {
  const name = codeName(code);
  if (!name) return null;
  for (const n of Object.keys(CODE)) if (codeName(CODE[n]) === name || (LIBRARY_FORMER_NAMES[n] || []).includes(name)) return +n;
  return null;
}
// A short fingerprint of a code text, stored on a copy when it is made so a
// later load can tell an untouched copy from one the user edited.
function codeFingerprint(code) {
  let h = 5381; const t = String(code || '');
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + t.length;
}

// #1 Faber 10-month: QQQ vs 200-SMA checked ONLY on the last trading day of each month.
CODE[1] = `{
  name: "Faber 10-mo / 200-day (monthly) → TQQQ/cash",
  params: [{ id: "window", label: "Window (days)", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "QQQ", tip: "QQQ's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "QQQ's average or median close over the window (the Center line setting). Checked only on the month end." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.qqq, lev = data.tqqq;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const px = lev[i];
${WEEKLY_MONTH_END_SNIPPET}
      // The rule is monthly: it fires on the calendar month's last trading day
      // (and the run's last day), whatever cadence the log is kept at. Until
      // 2026-10 it keyed off the logging flag and so traded weekly whenever the
      // chart window was under ten years.
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (monthEnd) {
        const sma = centerLine(sig, W, i, useMed), bull = sma > 0 && sig[i] > sma;
        if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought TQQQ: month end, QQQ closed above its " + lineName; }
        else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold TQQQ: month end, QQQ closed under its " + lineName; }
      }
      if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "TQQQ" : "CASH", note: note, assetPrice: sig[i], center: centerLine(sig, W, i, useMed) });
    }
    return { log, lines: [{ key: "assetPrice", label: "QQQ price" }, { key: "center", label: lineName }] };
  }
}`;

// #2 Gayed LRS 3×: SPY vs 200-SMA daily → SPXL (3× S&P) else cash.
CODE[2] = `{
  name: "Gayed LRS 3× — SPY 200SMA → SPXL/cash",
  params: [{ id: "window", label: "Window (days)", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "SPY", tip: "SPY's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, lev = data.spxl;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(sig, W, i, useMed), px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought " + "SPXL" + ": " + "SPY" + " closed above its " + lineName; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold " + "SPXL" + ": " + "SPY" + " closed under its " + lineName; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "SPXL" : "CASH", note: note, assetPrice: sig[i], center: sma });
    }
    return { log, lines: [{ key: "assetPrice", label: "SPY" + " price" }, { key: "center", label: lineName }] };
  }
}`;

// #3 Gayed LRS 2×: SPY vs 200-SMA daily → SSO (2× S&P) else cash.
CODE[3] = `{
  name: "Gayed LRS 2× — SPY 200SMA → SSO/cash",
  params: [{ id: "window", label: "Window (days)", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "SPY", tip: "SPY's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, lev = data.sso;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(sig, W, i, useMed), px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought " + "SSO" + ": " + "SPY" + " closed above its " + lineName; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold " + "SSO" + ": " + "SPY" + " closed under its " + lineName; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "SSO" : "CASH", note: note, assetPrice: sig[i], center: sma });
    }
    return { log, lines: [{ key: "assetPrice", label: "SPY" + " price" }, { key: "center", label: lineName }] };
  }
}`;

// #8 Siegel ±band: SPY vs 200-SMA symmetric band → TQQQ/cash.
CODE[8] = `{
  name: "Siegel ±band SPY 200SMA → TQQQ/cash",
  params: [{ id: "band", label: "Band (% around line)", options: [0, 1, 2, 3], default: 1 },
           { id: "window", label: "Window", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "SPY", tip: "SPY's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." },
             { key: "buyLine", label: "Buy line", tip: "Where SPY must close to buy: the center plus the band." },
             { key: "sellLine", label: "Sell line", tip: "Where SPY must close to sell: the center minus the band." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, lev = data.tqqq, up = 1 + p.band / 100, dn = 1 - p.band / 100;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    const bandTxt = p.band > 0 ? p.band + "% " : "";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(sig, W, i, useMed), px = lev[i], s = sig[i];
      if (sma > 0 && s > 0) {
        if (!invested && s >= sma * up && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought TQQQ: SPY closed " + bandTxt + "above its " + lineName; }
        else if (invested && s <= sma * dn) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold TQQQ: SPY closed " + bandTxt + "under its " + lineName; }
      }
      if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "TQQQ" : "CASH", note: note, assetPrice: s, center: sma, ...(p.band > 0 ? { buyLine: sma * up, sellLine: sma * dn } : {}) });
    }
    return { log, lines: [{ key: "assetPrice", label: "SPY price" }, { key: "center", label: lineName },
      ...(p.band > 0 ? [{ key: "buyLine", label: "Buy line (+" + p.band + "%)" }, { key: "sellLine", label: "Sell line (-" + p.band + "%)" }] : [])] };
  }
}`;

// #9 Canonical (SPY signal) 200-SMA → TQQQ/cash.
CODE[9] = `{
  name: "Canonical SPY 200SMA → TQQQ/cash",
  params: [{ id: "signal", label: "Signal", options: ["spy", "qqq"], default: "spy" },
           { id: "window", label: "Window", options: [100, 150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "Signal", tip: "Close of the signal fund (the Signal setting): the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." }],
  run(data, p) {
    const log = [], W = p.window, sig = data[p.signal], lev = data.tqqq;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average"), sigName = p.signal.toUpperCase();
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(sig, W, i, useMed), px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought " + "TQQQ" + ": " + sigName + " closed above its " + lineName; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold " + "TQQQ" + ": " + sigName + " closed under its " + lineName; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "TQQQ" : "CASH", note: note, assetPrice: sig[i], center: sma });
    }
    return { log, lines: [{ key: "assetPrice", label: sigName + " price" }, { key: "center", label: lineName }] };
  }
}`;

// #10 Canonical QQQ 200SMA → TQQQ else cash.
CODE[10] = `{
  name: "QQQ 200-day SMA → TQQQ else cash",
  params: [{ id: "signal", label: "Signal asset", options: ["qqq", "spy"], default: "qqq" },
           { id: "lev", label: "Leveraged ETF", options: ["tqqq", "qld", "sso", "spxl"], default: "tqqq" },
           { id: "window", label: "Window (days)", options: [100, 150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "Signal", tip: "Close of the signal fund (the Signal setting): the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." }],
  run(data, p) {
    const log = [], W = p.window, sig = data[p.signal], lev = data[p.lev];
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average"), sigName = p.signal.toUpperCase(), levName = p.lev.toUpperCase();
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(sig, W, i, useMed), px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought " + levName + ": " + sigName + " closed above its " + lineName; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold " + levName + ": " + sigName + " closed under its " + lineName; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? levName : "CASH", note: note, assetPrice: sig[i], center: sma });
    }
    return { log, lines: [{ key: "assetPrice", label: sigName + " price" }, { key: "center", label: lineName }] };
  }
}`;

// #11 SPY 200SMA → UPRO (SPXL 3× S&P) else cash.
CODE[11] = `{
  name: "SPY 200SMA → UPRO (SPXL) / cash",
  params: [{ id: "window", label: "Window", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "SPY", tip: "SPY's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, lev = data.spxl;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(sig, W, i, useMed), px = lev[i], bull = sma > 0 && sig[i] > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought " + "SPXL" + ": " + "SPY" + " closed above its " + lineName; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold " + "SPXL" + ": " + "SPY" + " closed under its " + lineName; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "SPXL" : "CASH", note: note, assetPrice: sig[i], center: sma });
    }
    return { log, lines: [{ key: "assetPrice", label: "SPY" + " price" }, { key: "center", label: lineName }] };
  }
}`;

// #12 SSO own-price 200SMA → SSO else cash.
CODE[12] = `{
  name: "SSO own 200SMA → SSO/cash (2×)",
  params: [{ id: "window", label: "Window", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "center", label: "Center", tip: "SSO's average or median close over the window (the Center line setting). The rule holds SSO while SSO closes above it." }],
  run(data, p) {
    const log = [], W = p.window, lev = data.sso;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(lev, W, i, useMed), px = lev[i], bull = sma > 0 && px > sma;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought SSO: SSO closed above its " + lineName; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold SSO: SSO closed under its " + lineName; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "SSO" : "CASH", note: note, center: sma });
    }
    return { log, lines: [{ key: "price", label: "SSO price" }, { key: "center", label: lineName }] };
  }
}`;

// #13 Hollywood SPY 200SMA +4/-3 → TQQQ/QQQ.
CODE[13] = `{
  name: "Hollywood SPY 200SMA +4/-3 → TQQQ/QQQ",
  params: [{ id: "entry", label: "Enter band (% above)", options: [0, 2, 3, 4, 5], default: 4 },
           { id: "exit", label: "Exit band (% below)", options: [0, 2, 3, 4, 5], default: 3 },
           { id: "window", label: "Window", options: [100, 150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "SPY", tip: "SPY's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." },
             { key: "tqqqLine", label: "TQQQ line", tip: "Where SPY must close to switch to TQQQ: the center plus the enter band." },
             { key: "qqqLine", label: "QQQ line", tip: "Where SPY must close to switch to QQQ: the center minus the exit band." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, up = 1 + p.entry / 100, dn = 1 - p.exit / 100;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, shT = 0, shQ = 0, state = "qqq", prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    const upTxt = p.entry > 0 ? p.entry + "% " : "", dnTxt = p.exit > 0 ? p.exit + "% " : "";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_TQQQ_QQQ_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(sig, W, i, useMed), px = sig[i];
      if (sma > 0 && px > 0) { if (px >= sma * up) state = "tqqq"; else if (px <= sma * dn) state = "qqq"; }
      const pxT = data.tqqq[i], pxQ = data.qqq[i], cur = shT > 0 ? "tqqq" : (shQ > 0 ? "qqq" : "none");
      if (state !== cur && pxT > 0 && pxQ > 0) {
        cash += shT * pxT + shQ * pxQ; shT = 0; shQ = 0;
        if (state === "tqqq") shT = cash / pxT; else shQ = cash / pxQ;
        cash = 0; action = cur === "none" ? "buy" : "switch";
        const why = state === "tqqq" ? "SPY closed " + upTxt + "above its " + lineName
          : px <= sma * dn ? "SPY closed " + dnTxt + "under its " + lineName : "SPY not " + upTxt + "above its " + lineName;
        note = (action === "buy" ? "Bought " : "Switched to ") + state.toUpperCase() + ": " + why;
      } else if (cash > 0) {
        if (state === "tqqq" && pxT > 0) { shT += cash / pxT; cash = 0; }
        else if (state === "qqq" && pxQ > 0) { shQ += cash / pxQ; cash = 0; }
      }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "switch" || logDay)
        log.push({ date: data.dates[i], value: shT * pxT + shQ * pxQ + cash, price: pxT, contributed: contributed, action: action,
          held: shT > 0 ? "TQQQ" : shQ > 0 ? "QQQ" : "CASH", note: note, assetPrice: px, center: sma,
          ...(p.entry > 0 ? { tqqqLine: sma * up } : {}), ...(p.exit > 0 ? { qqqLine: sma * dn } : {}) });
    }
    return { log, lines: [{ key: "assetPrice", label: "SPY price" }, { key: "center", label: lineName },
      ...(p.entry > 0 ? [{ key: "tqqqLine", label: "TQQQ line (+" + p.entry + "%)" }] : []), ...(p.exit > 0 ? [{ key: "qqqLine", label: "QQQ line (-" + p.exit + "%)" }] : [])] };
  }
}`;

// #15 Composer: QQQ 200-SMA trend AND RSI(14) not overbought → TQQQ else cash.
CODE[15] = `{
  name: "Composer 200MA + RSI trend → TQQQ/cash",
  params: [{ id: "rsiMax", label: "Max RSI(14) to hold", options: [60, 70, 80, 100], default: 80 },
           { id: "window", label: "Window", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "QQQ", tip: "QQQ's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." },
             { key: "rsiCapLine", label: "RSI cap", tip: "The QQQ close that would put RSI(14) at the cap today. Above it the strategy is out." }],
  run(data, p) {
    const log = [], W = p.window, RW = 14, sig = data.qqq, lev = data.tqqq;
${CENTER_LINE_SNIPPET}
${RSI_LEVEL_SNIPPET}
    const seed = Math.max(1, p.startIdx - 60);
    let ag = 0, al = 0;
    for (let i = seed; i < seed + RW && i <= p.startIdx; i++) { const d = sig[i] - sig[i - 1]; if (d > 0) ag += d; else al -= d; }
    ag /= RW; al /= RW;
    for (let i = seed + RW; i < p.startIdx; i++) { const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0; ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW; }
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const capLine = rsiLevel(sig[i - 1], ag, al, RW, p.rsiMax);   // where QQQ would close for RSI(14) to sit at the cap
      const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW;
      const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
      const sma = centerLine(sig, W, i, useMed), px = lev[i], bull = sma > 0 && sig[i] > sma && rsi < p.rsiMax;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought TQQQ: QQQ above its " + lineName + ", RSI(14) under " + p.rsiMax; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = sig[i] > sma ? "Sold TQQQ: RSI(14) reached " + p.rsiMax : "Sold TQQQ: QQQ closed under its " + lineName; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "TQQQ" : "CASH", note: note, assetPrice: sig[i], center: sma, rsiCapLine: capLine });
    }
    return { log, lines: [{ key: "assetPrice", label: "QQQ price" }, { key: "center", label: lineName },
      ...(p.rsiMax < 100 ? [{ key: "rsiCapLine", label: "RSI(14) " + p.rsiMax }] : [])] };
  }
}`;

// #17 MACD(12/26/9) on QQQ → TQQQ/cash + trailing stop.
CODE[17] = `{
  name: "MACD(12/26) → TQQQ/cash (+trailing stop)",
  params: [{ id: "trail", label: "Trailing stop (% from peak)", options: [0, 20, 30, 40], default: 30 }],
  columns: [{ key: "assetPrice", label: "QQQ", tip: "QQQ's close: the price the rule compares with the center line." },
             { key: "triggerLine", label: "MACD trigger", tip: "The QQQ close that would put MACD exactly on its signal line or zero, whichever is higher. Above it the buy rule holds." },
             { key: "stopLine", label: "Trailing stop", tip: "While holding: TQQQ's high since the buy, less the stop setting. A TQQQ close under it sells." }],
  run(data, p) {
    const log = [], sig = data.qqq, lev = data.tqqq;
    const seed = Math.max(0, p.startIdx - 60);
    let e12 = sig[seed] || 0, e26 = sig[seed] || 0, macd = 0, signal = 0;
    const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
    for (let i = seed + 1; i < p.startIdx; i++) { if (sig[i] > 0) { e12 += k12 * (sig[i] - e12); e26 += k26 * (sig[i] - e26); macd = e12 - e26; signal += k9 * (macd - signal); } }
    let cash = p.initial, sh = 0, invested = false, prevMonth = null, peak = 0;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4)), trail = p.trail / 100;
    const QQQ_PANEL = "QQQ", TQQQ_PANEL = "TQQQ";   // the chart's panels: MACD on QQQ, the stop on TQQQ
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const s = sig[i], px = lev[i];
      // The QQQ close that would put MACD exactly on its signal line or zero,
      // whichever is higher, today: MACD rises with the close, so above it the buy rule holds.
      const triggerLine = (Math.max(signal, 0) - (1 - k12) * e12 + (1 - k26) * e26) / (k12 - k26);
      if (s > 0) { e12 += k12 * (s - e12); e26 += k26 * (s - e26); macd = e12 - e26; signal += k9 * (macd - signal); }
      const bull = macd > signal && macd > 0;
      if (invested && px > peak) peak = px;
      const stopped = invested && trail > 0 && px > 0 && px < peak * (1 - trail);
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; peak = px; action = "buy"; note = "Bought TQQQ: MACD rose above its signal line and zero"; }
      else if ((!bull || stopped) && invested) { cash = sh * px; sh = 0; invested = false; action = "sell";
        note = stopped ? "Sold TQQQ: trailing stop, " + p.trail + "% under its high since the buy" : "Sold TQQQ: MACD fell under " + (macd > 0 ? "its signal line" : "zero"); }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "TQQQ" : "CASH", note: note, assetPrice: s, triggerLine: triggerLine, stopLine: invested && trail > 0 ? peak * (1 - trail) : null,
          ...(action === "sell" && stopped ? { firedBy: TQQQ_PANEL } : {}) });
    }
    // A panel per fund with a level: QQQ with the MACD trigger, TQQQ with its
    // trailing stop. Without the stop TQQQ has no level of its own, so no panel.
    return { log, lines: [{ key: "assetPrice", label: "QQQ price", group: QQQ_PANEL }, { key: "triggerLine", label: "MACD trigger", group: QQQ_PANEL },
      ...(p.trail > 0 ? [{ key: "price", label: "TQQQ price", group: TQQQ_PANEL }, { key: "stopLine", label: "Trailing stop (-" + p.trail + "%)", group: TQQQ_PANEL }] : [])] };
  }
}`;

// #18 40-week SMA crossover: QQQ vs 200-day SMA checked WEEKLY (last trading day of ISO week).
CODE[18] = `{
  name: "40-week SMA (weekly) → TQQQ/cash",
  params: [{ id: "window", label: "Window (days)", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "QQQ", tip: "QQQ's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "QQQ's average or median close over the window (the Center line setting). Checked only on the week end." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.qqq, lev = data.tqqq;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    const dow = (ds) => new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10))).getUTCDay();
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const px = lev[i];
      const weekEnd = i === p.endIdx || dow(data.dates[i + 1]) <= dow(data.dates[i]);
      if (weekEnd) {
        const sma = centerLine(sig, W, i, useMed), bull = sma > 0 && sig[i] > sma;
        if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought TQQQ: week end, QQQ closed above its " + lineName; }
        else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold TQQQ: week end, QQQ closed under its " + lineName; }
      }
      if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "TQQQ" : "CASH", note: note, assetPrice: sig[i], center: centerLine(sig, W, i, useMed) });
    }
    return { log, lines: [{ key: "assetPrice", label: "QQQ price" }, { key: "center", label: lineName }] };
  }
}`;

// #19 Golden/Death cross 50/200 on QQQ → TQQQ/cash.
CODE[19] = `{
  name: "Golden/Death Cross 50/200 → TQQQ/cash",
  params: [{ id: "fast", label: "Fast window", options: [20, 50, 100], default: 50 },
           { id: "slow", label: "Slow window", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "fastLine", label: "Fast line", tip: "QQQ's average or median close over the fast window." },
             { key: "slowLine", label: "Slow line", tip: "QQQ's average or median close over the slow window. The rule holds TQQQ while the fast line is above it." },
             { key: "assetPrice", label: "QQQ", tip: "QQQ's close." }],
  run(data, p) {
    const log = [], F = p.fast, S = p.slow, sig = data.qqq, lev = data.tqqq;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const stat = useMed ? "median" : "average";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const maF = centerLine(sig, F, i, useMed), maS = centerLine(sig, S, i, useMed), px = lev[i], bull = maS > 0 && maF > maS;
      if (bull && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought TQQQ: the " + F + "-day " + stat + " crossed above the " + S + "-day"; }
      else if (!bull && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = "Sold TQQQ: the " + F + "-day " + stat + " crossed under the " + S + "-day"; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "TQQQ" : "CASH", note: note, fastLine: maF, slowLine: maS, assetPrice: sig[i] });
    }
    return { log, lines: [{ key: "fastLine", label: F + "-day " + stat }, { key: "slowLine", label: S + "-day " + stat }, { key: "assetPrice", label: "QQQ price" }] };
  }
}`;

// #20 Volatility targeting: hold TQQQ scaled so trailing vol ≈ target; rest cash. Rebalance monthly.
CODE[20] = `{
  name: "Vol-target TQQQ (scale to target vol)",
  params: [{ id: "target", label: "Target vol (%/yr)", options: [15, 20, 25, 30], default: 25 },
           { id: "lookback", label: "Vol lookback (days)", options: [20, 40, 60], default: 20 }],
  columns: [{ key: "share", label: "TQQQ share", tip: "Share of the account in TQQQ at the close." },
             { key: "vol", label: "Volatility", tip: "TQQQ's annualised volatility over the lookback. Each month the share is reset to the target divided by it, at most 100%." },
             { key: "target", label: "Target", tip: "The target volatility setting." }],
  run(data, p) {
    const log = [], lev = data.tqqq, L = p.lookback, tgt = p.target / 100;
    // Annualised volatility of TQQQ's daily returns over the lookback ending on day j.
    const volAt = j => {
      let m = 0, c = 0; const r = [];
      for (let k = Math.max(1, j - L + 1); k <= j; k++) { if (lev[k] > 0 && lev[k - 1] > 0) { const ret = lev[k] / lev[k - 1] - 1; r.push(ret); m += ret; c++; } }
      m = c ? m / c : 0; let v = 0; for (const x of r) v += (x - m) * (x - m);
      return c ? Math.sqrt(v / c) * Math.sqrt(252) : 0;
    };
    let cash = p.initial, sh = 0, prevMonth = null, w = 0;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      const px = lev[i], newMonth = prevMonth === null || month !== prevMonth;
      prevMonth = month;
      if (newMonth && px > 0) {
        const v = volAt(i);
        const targetW = v > 0 ? Math.max(0, Math.min(1, tgt / v)) : 0;
        const total = sh * px + cash;
        sh = (total * targetW) / px; cash = total - sh * px; w = targetW; action = "rebalance";
        note = "Rebalanced to " + Math.round(targetW * 100) + "% TQQQ: volatility " + Math.round(v * 100) + "% against the " + p.target + "% target";
      }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "rebalance" || logDay) {
        const total = sh * px + cash;
        log.push({ date: data.dates[i], value: total, price: px, contributed: contributed, action: action, weight: w,
          held: sh > 0 ? (cash > total * 0.001 ? "TQQQ + CASH" : "TQQQ") : "CASH", note: note,
          share: total > 0 ? sh * px / total * 100 : 0, vol: volAt(i) * 100, target: p.target });
      }
    }
    return { log, lines: [{ key: "share", label: "TQQQ share", unit: "%" }, { key: "vol", label: L + "-day volatility", unit: "%" },
      { key: "target", label: "Target (" + p.target + "%)", unit: "%" }] };
  }
}`;

// #22 Connors RSI(2) dip-buy within a 200-SMA uptrend.
CODE[22] = `{
  name: "Connors RSI(2) dip-buy (200SMA trend)",
  params: [{ id: "buy", label: "Buy RSI(2) below", options: [5, 10, 15], default: 10 },
           { id: "sell", label: "Sell RSI(2) above", options: [60, 70, 80], default: 70 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "QQQ", tip: "QQQ's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." },
             { key: "rsiBuyLine", label: "RSI buy", tip: "The QQQ close that would put RSI(2) at the buy level today. A close under it, with QQQ above its center, buys." },
             { key: "rsiSellLine", label: "RSI sell", tip: "The QQQ close that would put RSI(2) at the sell level today. A close above it sells." }],
  run(data, p) {
    const log = [], W = 200, RW = 2, sig = data.qqq, lev = data.tqqq;
${CENTER_LINE_SNIPPET}
${RSI_LEVEL_SNIPPET}
    const seed = Math.max(1, p.startIdx - 30);
    let ag = 0, al = 0;
    for (let i = seed; i < seed + RW && i <= p.startIdx; i++) { const d = sig[i] - sig[i - 1]; if (d > 0) ag += d; else al -= d; }
    ag /= RW; al /= RW;
    for (let i = seed + RW; i < p.startIdx; i++) { const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0; ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW; }
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const rsiBuyLine = rsiLevel(sig[i - 1], ag, al, RW, p.buy), rsiSellLine = rsiLevel(sig[i - 1], ag, al, RW, p.sell);
      const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW;
      const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
      const sma = centerLine(sig, W, i, useMed), px = lev[i], up = sma > 0 && sig[i] > sma;
      if (up && !invested && rsi < p.buy && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought TQQQ: RSI(2) under " + p.buy + ", QQQ above its " + lineName; }
      else if (invested && (!up || rsi > p.sell)) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = up ? "Sold TQQQ: RSI(2) over " + p.sell : "Sold TQQQ: QQQ closed under its " + lineName; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "TQQQ" : "CASH", note: note, assetPrice: sig[i], center: sma, rsiBuyLine: rsiBuyLine, rsiSellLine: rsiSellLine });
    }
    return { log, lines: [{ key: "assetPrice", label: "QQQ price" }, { key: "center", label: lineName },
      { key: "rsiBuyLine", label: "RSI(2) " + p.buy }, { key: "rsiSellLine", label: "RSI(2) " + p.sell }] };
  }
}`;

// #23 TFTLT: QQQ 200SMA → TQQQ, RSI(10) overheat exit + cool-gate re-entry.
CODE[23] = `{
  name: "200-day SMA + RSI exit & re-entry",
  params: [{ id: "oh", label: "Overheat exit RSI(10) ≥", options: [60, 70, 80, 100], default: 80 },
           { id: "cool", label: "Cool-gate re-entry RSI(10) <", options: [40, 50, 60, 100], default: 60 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "QQQ", tip: "QQQ's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." },
             { key: "overheatLine", label: "Overheat line", tip: "The QQQ close that would put RSI(10) at the overheat level today. A close above it sells." },
             { key: "coolLine", label: "Cool line", tip: "The QQQ close that would put RSI(10) at the cool level today. While out, a close under it, with QQQ above its center, buys back." }],
  run(data, p) {
    const log = [], W = 200, RW = 10, sig = data.qqq, lev = data.tqqq;
${CENTER_LINE_SNIPPET}
${RSI_LEVEL_SNIPPET}
    const seed = Math.max(1, p.startIdx - 40);
    let ag = 0, al = 0;
    for (let i = seed; i < seed + RW && i <= p.startIdx; i++) { const d = sig[i] - sig[i - 1]; if (d > 0) ag += d; else al -= d; }
    ag /= RW; al /= RW;
    for (let i = seed + RW; i < p.startIdx; i++) { const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0; ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW; }
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_SH_TO_COVER}
      }
      prevMonth = month;
      const overheatLine = rsiLevel(sig[i - 1], ag, al, RW, p.oh), coolLine = rsiLevel(sig[i - 1], ag, al, RW, p.cool);
      const d = sig[i] - sig[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      ag = (ag * (RW - 1) + g) / RW; al = (al * (RW - 1) + l) / RW;
      const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
      const sma = centerLine(sig, W, i, useMed), px = lev[i], up = sma > 0 && sig[i] > sma;
      const wantIn = up && rsi < p.oh && (invested || rsi < p.cool);
      if (wantIn && !invested && px > 0) { sh = cash / px; cash = 0; invested = true; action = "buy"; note = "Bought TQQQ: " + (p.cool < 100 ? "RSI(10) under " + p.cool + ", " : "") + "QQQ above its " + lineName; }
      else if (!wantIn && invested) { cash = sh * px; sh = 0; invested = false; action = "sell"; note = up ? "Sold TQQQ: RSI(10) reached " + p.oh : "Sold TQQQ: QQQ closed under its " + lineName; }
      else if (invested && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action,
          held: invested ? "TQQQ" : "CASH", note: note, assetPrice: sig[i], center: sma, overheatLine: overheatLine, coolLine: coolLine });
    }
    return { log, lines: [{ key: "assetPrice", label: "QQQ price" }, { key: "center", label: lineName },
      ...(p.oh < 100 ? [{ key: "overheatLine", label: "RSI(10) " + p.oh }] : []), ...(p.cool < 100 ? [{ key: "coolLine", label: "RSI(10) " + p.cool }] : [])] };
  }
}`;

// #24 200SMA + Bodyguard (delever to QQQ, GTFO to cash).
CODE[24] = `{
  name: "200SMA + Bodyguard (delever/GTFO)",
  params: [{ id: "delev", label: "Delever→QQQ at (% above line)", options: [0, 20, 25, 30, 35, 40], default: 30 },
           { id: "gtfo", label: "Sell→cash at (% above line)", options: [0, 35, 40, 45, 50], default: 40 },
           { id: "window", label: "Window", options: [150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "QQQ", tip: "QQQ's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting)." },
             { key: "delevLine", label: "Delever line", tip: "Where QQQ must close to switch from TQQQ to QQQ: the center plus the delever setting." },
             { key: "cashLine", label: "Cash line", tip: "Where QQQ must close to sell everything: the center plus the cash setting." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.qqq;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, shT = 0, shQ = 0, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    const delevName = "the delever line (+" + p.delev + "%)", cashName = "the cash line (+" + p.gtfo + "%)";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_TQQQ_QQQ_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(sig, W, i, useMed), q = sig[i], aboveBy = sma > 0 ? (q / sma - 1) * 100 : 0;
      let want;
      if (sma <= 0 || q <= 0 || q < sma) want = "cash";
      else if (p.gtfo > 0 && aboveBy >= p.gtfo) want = "cash";
      else if (p.delev > 0 && aboveBy >= p.delev) want = "qqq";
      else want = "tqqq";
      const pxT = data.tqqq[i], pxQ = data.qqq[i], cur = shT > 0 ? "tqqq" : (shQ > 0 ? "qqq" : "cash");
      if (want !== cur && pxT > 0 && pxQ > 0) {
        cash += shT * pxT + shQ * pxQ; shT = 0; shQ = 0;
        if (want === "tqqq") { shT = cash / pxT; cash = 0; } else if (want === "qqq") { shQ = cash / pxQ; cash = 0; }
        action = want === "cash" ? "sell" : cur === "cash" ? "buy" : "switch";
        const why = want === "cash" ? (q < sma ? "QQQ closed under its " + lineName : "QQQ closed above " + cashName)
          : want === "qqq" ? (cur === "tqqq" ? "QQQ closed above " + delevName : "QQQ closed back under " + cashName)
          : cur === "qqq" ? "QQQ closed back under " + delevName : "QQQ closed above its " + lineName;
        note = (action === "sell" ? "Sold " + cur.toUpperCase() : action === "buy" ? "Bought " + want.toUpperCase() : "Switched to " + want.toUpperCase()) + ": " + why;
      } else if (cash > 0) {
        if (want === "tqqq" && pxT > 0) { shT += cash / pxT; cash = 0; }
        else if (want === "qqq" && pxQ > 0) { shQ += cash / pxQ; cash = 0; }
      }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "switch" || action === "sell" || logDay)
        log.push({ date: data.dates[i], value: shT * pxT + shQ * pxQ + cash, price: pxT, contributed: contributed, action: action,
          held: shT > 0 ? "TQQQ" : shQ > 0 ? "QQQ" : "CASH", note: note, assetPrice: q, center: sma,
          ...(p.delev > 0 ? { delevLine: sma * (1 + p.delev / 100) } : {}), ...(p.gtfo > 0 ? { cashLine: sma * (1 + p.gtfo / 100) } : {}) });
    }
    return { log, lines: [{ key: "assetPrice", label: "QQQ price" }, { key: "center", label: lineName },
      ...(p.delev > 0 ? [{ key: "delevLine", label: "Delever line (+" + p.delev + "%)" }] : []), ...(p.gtfo > 0 ? [{ key: "cashLine", label: "Cash line (+" + p.gtfo + "%)" }] : [])] };
  }
}`;

// #25 Always-invested: 200SMA → TQQQ else QQQ (park in unleveraged, not cash).
CODE[25] = `{
  name: "200SMA → TQQQ else QQQ (always in)",
  params: [{ id: "signal", label: "Signal / park", options: ["qqq", "spy"], default: "qqq" },
           { id: "lev", label: "Leveraged ETF", options: ["tqqq", "qld", "sso", "spxl"], default: "tqqq" },
           { id: "window", label: "Window", options: [100, 150, 200, 250], default: 200 },
           ${STAT_PARAM_SNIPPET}],
  columns: [{ key: "assetPrice", label: "Signal", tip: "Close of the signal fund (the Signal setting): the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "The signal fund's average or median close over the window (the Center line setting). Above it the strategy holds the leveraged fund, under it the signal fund." }],
  run(data, p) {
    const log = [], W = p.window, sig = data[p.signal], lev = data[p.lev];
${CENTER_LINE_SNIPPET}
    let cash = p.initial, shLev = 0, shPark = 0, state = "park", prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average"), sigName = p.signal.toUpperCase(), levName = p.lev.toUpperCase();
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "";
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; action = "contribution";
${SELL_LEV_PARK_TO_COVER}
      }
      prevMonth = month;
      const sma = centerLine(sig, W, i, useMed), pxL = lev[i], pxP = sig[i], want = (sma > 0 && sig[i] > sma) ? "lev" : "park";
      if (want !== state && pxL > 0 && pxP > 0) {
        const fromCash = shLev === 0 && shPark === 0;
        cash += shLev * pxL + shPark * pxP; shLev = 0; shPark = 0;
        if (want === "lev") shLev = cash / pxL; else shPark = cash / pxP;
        cash = 0; state = want; action = fromCash ? "buy" : "switch";
        note = (fromCash ? "Bought " : "Switched to ") + (want === "lev" ? levName : sigName) + ": " + sigName + " closed " + (want === "lev" ? "above" : "under") + " its " + lineName;
      } else if (cash > 0) {
        if (state === "lev" && pxL > 0) { shLev += cash / pxL; cash = 0; }
        else if (state === "park" && pxP > 0) { shPark += cash / pxP; cash = 0; }
      }
${WEEKLY_MONTH_END_SNIPPET}
      if (contributed !== 0 || action === "buy" || action === "switch" || logDay)
        log.push({ date: data.dates[i], value: shLev * pxL + shPark * pxP + cash, price: pxL, contributed: contributed, action: action,
          held: shLev > 0 ? levName : shPark > 0 ? sigName : "CASH", note: note, assetPrice: pxP, center: sma });
    }
    return { log, lines: [{ key: "assetPrice", label: sigName + " price" }, { key: "center", label: lineName }] };
  }
}`;

// #26 Median overextension 250d (hand-picked): sell when price runs >55% above its
// 250-day rolling median, hold otherwise. An overextension filter, NOT a trend
// filter — it only ever exits on strength, so it rides every crash to the bottom.
CODE[26] = `{
  name: "Median overextension 250d",
  params: [
    { id: "asset", label: "Fund traded", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" },
      { value: "spxl", label: "SPXL" }, { value: "sso", label: "SSO" },
      { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "park", label: "Held when out", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" },
      { value: "qld", label: "QLD" } ] },
    { id: "threshold", label: "Sell when above line (%)", default: 55, options: [
      10,15,20,25,30,35,40,42,44,46,48,50,52,54,55,56,58,60,62,64,66,68,70,75,80,85,90,100,110,125,150,175,200] },
    ${STAT_PARAM_MEDIAN_SNIPPET},
    { id: "window", label: "Window (days)", default: 250, options: [
      40,60,80,100,120,140,160,180,190,200,210,220,230,240,250,260,270,280,290,300,310,320,340,360,380,400,450,500] },
    { id: "cashRate", label: "Cash interest (%/yr)", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", label: "Trading cost (%)", default: 0.02, options: [
      0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
  ],
  columns: [
    { key: "assetPrice", label: "Price", tip: "Closing price of the traded fund that day. The sell rule compares this against the rolling median." },
    { key: "medianPrice", label: "Center", tip: "The center line of the traded fund over your chosen window of trading days — its median by default (half the window closed above, half below), or its moving average per the Center line setting." },
    { key: "overPct", label: "Over line", tip: "How far the price sits above (+) or below (−) the rolling center line, in percent. The strategy sells once this exceeds your sell threshold and buys back as soon as it drops below it again. Blank while the median is still warming up." },
    { key: "sellLevel", label: "Sell level", tip: "Price sitting exactly your chosen percentage above the center line. Closing above it triggers the exit; dropping back under it triggers the re-entry." }
  ],
  run(data, p) {
    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = p.window || 250;
    const thr = (p.threshold || 0) / 100;
    const useMed = p.stat !== "sma", CN = useMed ? "median" : "avg";
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    // Rolling sorted window: binary insert/remove, one in one out per day — never re-sorted.
    const win = []; let wSum = 0;
    const lowerBound = v => {
      let lo = 0, hi = win.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; }
      return lo;
    };
    const ins = v => { win.splice(lowerBound(v), 0, v); wSum += v; };
    const rem = v => { const j = lowerBound(v); if (j < win.length && win[j] === v) { win.splice(j, 1); wSum -= v; } };
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
      median = m === 0 ? 0 : (useMed ? (m % 2 ? win[(m - 1) >> 1] : (win[m / 2 - 1] + win[m / 2]) / 2) : wSum / m);
      over = median > 0 && px[i] > 0 ? px[i] / median - 1 : 0;
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
${SELL_HELD_TO_COVER}
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
        note = "price " + (over >= 0 ? "+" : "−") + Math.abs(over * 100).toFixed(1) + "% vs " + W + "d " + CN;
        held = want;
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const hp = priceOf(held, i);
      const stockVal = shares * hp;
${WEEKLY_MONTH_END_SNIPPET}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || logDay || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i], medianPrice: median, overPct: over * 100,
          sellLevel: median * (1 + thr)
        });
      }
    }
    const stretched = over > thr;
    const pctStr = (over >= 0 ? "+" : "−") + Math.abs(over * 100).toFixed(2) + "%";
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "cash" : p.park.toUpperCase();
    return {
      log: log,
      lines: [
        { key: "assetPrice", label: A + " price" },
        { key: "medianPrice", label: W + "-day " + CN },
        { key: "sellLevel", label: "Overextended (+" + (p.threshold || 0) + "%)" }
      ],
      signals: {
        cards: [
          { label: A + " vs " + W + "-day " + CN,
            value: (stretched ? "▲ " : "") + pctStr,
            tone: stretched ? "bad" : "good",
            icon: stretched ? "trendUp" : "activity",
            sub: (px[p.endIdx] || 0).toFixed(2) + " vs " + median.toFixed(2) + " " + CN,
            tip: "How far " + A + "'s last close sits above or below its " + W + "-day rolling " + CN + ". Below the sell threshold means stay invested; above it means the price is stretched and the strategy steps aside." },
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
          note: stretched ? "price is more than " + (p.threshold || 0) + "% above its " + CN : "price is within the normal band",
          tone: stretched ? "bad" : "good",
          reasons: [{
            name: "Median overshoot",
            val: A + " " + pctStr + " vs " + W + "d " + CN,
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
    ${STAT_PARAM_SNIPPET},
    { id: "window", label: "Window (days)", default: 150, options: [
      20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,
      210,220,230,240,250,260,270,280,300,320,350,400] },
    { id: "stretch", label: "Sell when above line (%)", default: 20, options: [
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
    { key: "signalSma", label: "Center", tip: "The signal fund's center line (moving average or median, per the Center line setting) over your chosen window. The strategy compares the signal price against this line." },
    { key: "abovePct", label: "Above line", tip: "How far the signal price sits above (+) or below (−) its center line. When this exceeds your sell threshold, the strategy sells; while it is at or below the threshold, it holds the traded fund." },
    { key: "assetPrice", label: "Fund price", tip: "Closing price of the traded fund that day, shown even on days you are parked, so you can see what you are in or out of." },
    { key: "triggerLine", label: "Trigger", tip: "The signal price sitting exactly your sell threshold above its center line — the signal closing above it parks, back below it re-buys." }
  ],
  run(data, p) {
    const log = [];
    const sig = data[p.signal] || data.sso;
    const px0 = data[p.asset] || data.tqqq;
    const W = p.window, thr = (p.stretch || 0) / 100;
    const useMed = p.stat === "median", CN = useMed ? "median" : "avg";
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : data[id][i];
    let cash = p.initial, shares = 0, held = "cash";
    let sma = 0, above = 0;
    let invested = p.initial, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4), 10);
    // Rolling window kept BOTH as a running sum (the average) and a sorted
    // array (the median) — one insert + one delete per day either way.
    let sum = 0, n = 0;
    const win = [];
    const lb = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
    const ins = (v) => { win.splice(lb(v), 0, v); sum += v; n++; };
    const rem = (v) => { const k = lb(v); if (k < win.length && win[k] === v) { win.splice(k, 1); sum -= v; n--; } };
    for (let k = Math.max(0, p.startIdx - W + 1); k <= p.startIdx; k++)
      if (sig[k] > 0) ins(sig[k]);
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (i > p.startIdx) {
        if (sig[i] > 0) ins(sig[i]);
        const out = i - W;
        if (out >= 0 && sig[out] > 0) rem(sig[out]);
      }
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
${SELL_HELD_TO_COVER}
      }
      prevMonth = month;
      sma = n > 0 ? (useMed ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : sum / n) : 0;
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
        note = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% vs " + (useMed ? "median" : "SMA") + " (trigger " + (thr * 100).toFixed(0) + "%)";
        held = want;
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const px = priceOf(held, i);
      const stockVal = shares * px;
${WEEKLY_MONTH_END_SNIPPET}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || logDay || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: px, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          signalPrice: sig[i], signalSma: sma, abovePct: above * 100, assetPrice: px0[i],
          triggerLine: sma * (1 + thr)
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
      // The rule reads the signal fund only: its price, center and trigger.
      // The fund traded has no level of its own, so it gets no line.
      lines: [
        { key: "signalPrice", label: S + " price" },
        { key: "signalSma", label: W + "-day " + (useMed ? "median" : "avg") },
        { key: "triggerLine", label: "Sell trigger (+" + (p.stretch || 0) + "%)" }
      ],
      signals: {
        cards: [
          { label: S + " vs " + p.window + "-day " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pctStr,
            tone: stretched ? "bad" : "good",
            icon: stretched ? "trendDown" : "trendUp",
            sub: (sig[p.endIdx] || 0).toFixed(2) + " vs " + sma.toFixed(2) + " " + CN,
            tip: "How far " + S + " sits above its " + p.window + "-day center line. At or below +" + (thr * 100).toFixed(0) + "% the strategy holds " + A + "; beyond it, it sells." },
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
          note: stretched ? S + " is stretched " + pctStr + " above its " + (useMed ? "median" : "average") : "market is not overheated (" + pctStr + " vs +" + (thr * 100).toFixed(0) + "% trigger)",
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

// #40 Median overextension (250d) — the SQQQ-park evolution of #26. Same signal
// (price vs its own 250-day rolling median, exit above +55%), three additions:
// SQQQ (−3×) as a park option and the default, a one-trade-per-day execution
// mode that splits a fund-to-fund switch across two bars, and per-leg fee
// accounting. Still an overextension filter with NO downside rule.
//
// The failure mode is structural. +55% over the median is a melt-up detector,
// and in a real melt-up it stays true for months while you sit −3× short — 138
// days into June 1999, against a longest post-2010 park stint of 62 days. Only
// the post-GFC era beats holding. (250, 55) is the peak cell of a 16×17
// window/threshold sweep tuned on 2010–2026. The card computes its era columns
// live, so read those rather than any figure pinned here.
CODE[40] = `{
  name: "Median overextension (250d)",
  params: [
    { id: "asset", label: "Fund traded", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "park", label: "Held when out", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    ${STAT_PARAM_MEDIAN_SNIPPET},
    { id: "window", label: "Window (days)", default: 250, options: [
      20,30,40,50,60,75,90,100,110,120,130,140,150,160,175,190,200,210,220,230,240,250,260,270,280,290,300,320,340,360,400,450,500] },
    { id: "overPct", label: "Exit when above line (%)", default: 55, options: [
      10,15,20,25,30,35,40,42.5,45,47.5,50,52.5,55,57.5,60,62.5,65,67.5,70,75,80,85,90,95,100,110,125,150,175,200] },
    // type:"bool" is required — without it the sandbox coerces the pick to the
    // STRING "false", which is truthy, and the toggle silently does nothing.
    { id: "splitDays", label: "One trade per day", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "cashRate", label: "Cash interest (%/yr)", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", label: "Trading cost (%)", default: 0.02, options: [
      0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
  ],
  columns: [
    { key: "assetPrice", label: "Fund", tip: "Closing price of the fund you trade — the signal is read off it, not off an index." },
    { key: "medianPrice", label: "Center", tip: "The center line of the fund's last N closes — its median by default (half the window above, half below; ignores spikes), or its moving average per the Center line setting." },
    { key: "abovePct", label: "Above line", tip: "How far today's close sits above (+) or below (−) the center line. This is the only number the strategy acts on." },
    { key: "triggerPrice", label: "Trigger", tip: "Price sitting exactly your chosen percentage over the center line. Close above it and it parks; back below and it buys again — same line both ways, no separate re-entry level." },
    { key: "parkPrice", label: "Park px", tip: "Closing price of whatever is held when out. Zero when the park is cash." },
    { key: "leg", label: "Leg", tip: "Which half of a fund-to-fund conversion this row is. Blank on single-leg trades (buy from cash, sell to cash) and on non-trade rows." },
    { key: "traded", label: "Traded", tip: "Gross dollars that changed hands on this row — what the fee is charged against. A split switch shows the sell and the buy on separate rows, each with its own amount." },
    { key: "fee", label: "Fee", tip: "Cost paid on this row as a percentage of dollars traded. A fund-to-fund move is two legs and pays twice; with one-trade-per-day on, those two fees land on two rows a day apart." },
    { key: "feesPaid", label: "Fees to date", tip: "Every trading cost paid since the start, running total. Compare against value to see what the switching has actually cost." },
    { key: "holdingsValue", label: "Holdings", tip: "Dollar value of the fund held. Add cash for the total." }
  ],
  run(data, p) {
    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = Math.max(2, p.window || 250);
    const over = (p.overPct || 0) / 100;
    const useMed = p.stat !== "sma", CN = useMed ? "median" : "avg";
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);

    // Rolling median: sorted window, one insert + one delete per day.
    const win = []; let wSum = 0;
    const lb = (v) => {
      let lo = 0, hi = win.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; }
      return lo;
    };
    const ins = (v) => { win.splice(lb(v), 0, v); wSum += v; };
    const rem = (v) => { const k = lb(v); if (k < win.length && win[k] === v) { win.splice(k, 1); wSum -= v; } };
    const warmFrom = Math.max(0, p.startIdx - W + 1);
    for (let k = warmFrom; k < p.startIdx; k++) if (px[k] > 0) ins(px[k]);

    let cash = p.initial, shares = 0, held = "cash";
    let invested = p.initial, prevMonth = null, awaitingLeg2 = false, feesPaid = 0;
    let med = 0, above = 0, trigger = 0, stretched = false, want = "cash";
    // Yesterday's readings, captured one bar behind — lets the final day's
    // signal cards show "moved by X today" instead of just the raw level.
    let prevAbove = 0, prevRoom = 0;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4), 10);

    for (let i = p.startIdx; i <= p.endIdx; i++) {
      // med/above/trigger still hold YESTERDAY's values at this point (today's
      // recompute is below), so this is exactly where to snapshot them.
      if (i > p.startIdx) {
        prevAbove = above;
        prevRoom = trigger > 0 && px[i - 1] > 0 ? trigger / px[i - 1] - 1 : 0;
      }
      if (px[i] > 0) ins(px[i]);
      // Drop the bar that just fell out of the window. Skip it on the very first
      // iteration when the warm-up loop never inserted px[startIdx - W] — without
      // this guard rem() can match an equal price still inside the window and
      // shrink it to W-1 for the rest of the run.
      const drop = i - W;
      if (drop >= warmFrom && px[drop] > 0) rem(px[drop]);

      const n = win.length;
      med = n === 0 ? 0 : (useMed ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : wSum / n);
      above = med > 0 && px[i] > 0 ? px[i] / med - 1 : 0;
      trigger = med * (1 + over);
      stretched = med > 0 && px[i] > 0 && px[i] > trigger;

      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0, traded = 0, leg = "";
      cash *= 1 + dayRate;
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
${SELL_HELD_TO_COVER_TRADED}
      }
      prevMonth = month;

      want = held;
      if (med > 0 && px[i] > 0) want = stretched ? p.park : p.asset;
      const pctTxt = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% vs " + CN;

      let didTrade = false;
      if (want !== held) {
        const twoLeg = held !== "cash" && want !== "cash";
        const wasLeg2 = awaitingLeg2 && held === "cash";
        const oldPx = priceOf(held, i);
        if (p.splitDays && twoLeg) {
          // Leg 1 only: out to cash today, the buy waits a bar and re-checks the signal.
          if (oldPx > 0) {
            const gross = shares * oldPx, f = gross * cost;
            cash += gross - f; fee += f; traded += gross; shares = 0;
            action = "sell"; leg = "1 of 2";
            note = pctTxt + " — leg 1 of 2, into " + want.toUpperCase() + " next bar";
            held = "cash"; awaitingLeg2 = true; didTrade = true;
          }
        } else {
          const newPx = priceOf(want, i);
          // Only commit the switch if the destination is actually priceable —
          // otherwise a data gap would flag us as holding the park with zero shares.
          if (want === "cash" || newPx > 0) {
            if (held !== "cash" && oldPx > 0) {
              const gross = shares * oldPx, f = gross * cost;
              cash += gross - f; fee += f; traded += gross; shares = 0;
            }
            if (want !== "cash") {
              const f = cash * cost;
              traded += cash; shares = (cash - f) / newPx; fee += f; cash = 0;
            }
            action = held === "cash" ? "buy" : (want === "cash" ? "sell" : "switch");
            leg = wasLeg2 ? "2 of 2" : (twoLeg ? "1+2 same day" : "");
            note = pctTxt + (wasLeg2 ? " — leg 2 of 2" : " (trigger +" + (over * 100).toFixed(1) + "%)");
            held = want; awaitingLeg2 = false; didTrade = true;
          }
        }
      } else if (awaitingLeg2) {
        awaitingLeg2 = false;
      }

      // New cash only deploys on a day that hasn't already traded.
      if (!didTrade && held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        traded += cash; shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
        if (action === "contribution") note = "contribution deployed";
      }

      const hp = priceOf(held, i);
      const stockVal = shares * hp;
${WEEKLY_MONTH_END_SNIPPET}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      feesPaid += fee;
      if (contributed !== 0 || logDay || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, leg: leg,
          traded: traded, fee: fee, feesPaid: feesPaid,
          assetPrice: px[i] || 0, medianPrice: med, abovePct: above * 100,
          triggerPrice: trigger, parkPrice: priceOf(p.park, i)
        });
      }
    }

    const A = p.asset.toUpperCase();
    const K = p.park === "cash" ? "cash" : p.park.toUpperCase();
    const WANT = want === "cash" ? "cash" : want.toUpperCase();
    const last = px[p.endIdx] || 0;
    const pctStr = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const room = trigger > 0 && last > 0 ? trigger / last - 1 : 0;
    const roomStr = (room >= 0 ? "+" : "−") + Math.abs(room * 100).toFixed(2) + "%";
    const pending = want !== held;

    // Day-over-day deltas for the signal cards below — how much each reading
    // moved from yesterday's close to today's, so the panel shows a live
    // pulse instead of a static snapshot.
    const deltaAbove = (above - prevAbove) * 100;
    const deltaAboveStr = (deltaAbove >= 0 ? "+" : "−") + Math.abs(deltaAbove).toFixed(2) + "%";
    const deltaRoom = (room - prevRoom) * 100;
    const deltaRoomStr = (deltaRoom >= 0 ? "+" : "−") + Math.abs(deltaRoom).toFixed(2) + "%";
    // Headroom SHRINKING (a negative delta) means the fund closed nearer the
    // trigger than yesterday — while still holding it (not stretched) that's
    // the fund RISING, which is the favorable direction for this position, so
    // the color is the opposite of the delta's own sign, not a match to it.
    const deltaRoomTone = deltaRoom <= 0 ? "good" : "bad";
    const heldPrevPx = priceOf(held, p.endIdx - 1);
    const heldGainPct = heldPrevPx > 0 ? (priceOf(held, p.endIdx) / heldPrevPx - 1) * 100 : null;
    const heldGainStr = heldGainPct == null ? null
      : (heldGainPct >= 0 ? "+" : "−") + Math.abs(heldGainPct).toFixed(2) + "%";

    return {
      log: log,
      lines: [
        { key: "assetPrice", label: A + " price" },
        { key: "medianPrice", label: W + "-day " + CN },
        { key: "triggerPrice", label: "Overextended (+" + (p.overPct || 0) + "%)" }
      ],
      signals: {
        cards: [
          { label: A + " vs " + W + "-day " + CN,
            value: (stretched ? "▲ " : "▼ ") + pctStr,
            tone: stretched ? "bad" : "good",
            icon: stretched ? "trendUp" : "trendDown",
            sub: last.toFixed(2) + " vs " + med.toFixed(2) + " " + CN,
            delta: { text: deltaAboveStr, tone: deltaAbove >= 0 ? "good" : "bad" },
            tip: "Last close against the center line of the last " + W + " closes — the median or the moving average, per the Center line setting. Stretched too far above it means park; anything else means hold " + A + ". The bracketed figure is how much this reading moved from yesterday's close to today's." },
          { label: stretched ? "Below trigger by" : "Headroom",
            value: roomStr,
            tone: stretched ? "bad" : "good",
            icon: "activity",
            sub: stretched ? "needs to fall under " + trigger.toFixed(2) : last.toFixed(2) + " → " + trigger.toFixed(2),
            delta: { text: deltaRoomStr, tone: deltaRoomTone },
            tip: "How much further the fund can run before the exit fires, or how far it must fall to get back in. The bracketed figure is today's move — headroom shrinking usually means the fund is climbing, the favorable direction while still holding it, so it's shown in green even though the headroom number itself went down." },
          { label: "Currently held",
            value: held.toUpperCase() + (pending ? " → " + WANT : ""),
            tone: held === p.asset ? "good" : "bad",
            icon: held === p.asset ? "trendUp" : "flag",
            sub: held === "cash" ? "earning " + (p.cashRate || 0) + "%/yr" : "at " + priceOf(held, p.endIdx).toFixed(2),
            delta: heldGainStr ? { text: heldGainStr, tone: heldGainPct >= 0 ? "good" : "bad" } : null,
            tip: "What is owned on the last day, plus any leg queued for the next bar. No stop, no trend filter, no crash rule — it only reacts to overextension, so it rides declines all the way down." + (p.park === "sqqq" ? " SQQQ is −3x inverse and bleeds in any rising or flat market." : "") }
        ],
        decision: {
          action: pending ? (WANT === "cash" ? "Move to cash" : "Buy " + WANT) : (stretched ? (K === "cash" ? "Stay in cash" : "Hold " + K) : "Buy " + A),
          note: pending ? "leg 2 — sold to cash last bar, " + WANT + " buys next" : (stretched ? "price is " + pctStr + " over its " + W + "-day " + CN : "price is " + pctStr + " vs " + CN),
          tone: stretched ? "bad" : "good",
          reasons: [
            { name: "Overextension", val: A + " " + pctStr + " vs " + W + "d " + CN, tag: stretched ? "out · " + K : "in · " + A, lean: stretched ? (p.park === "cash" ? "cash" : "out") : "buy" },
            { name: "Trigger level", val: "+" + (over * 100).toFixed(1) + "% = " + trigger.toFixed(2), tag: stretched ? "breached" : roomStr + " away", lean: stretched ? "out" : "hold" }
          ]
        }
      }
    };
  }
}`;

// #41 Median overextension with SQQQ and crash exit. #40's overextension
// rule plus a DEEP, CONFIRMED crash exit — the structure a 9-family research
// program (megaresearch, 2026-08) converged on from three directions: leave
// only at −28% below the median AND only while the median's own slope has
// stalled under +20%/yr with ≥10 straight days below the line; re-enter on
// recovery above the exit line. Validated three ways: arc-preserving
// bootstrap (74–76% of resampled out-of-sample segments beat the plain −8%
// exit, median 2.5× ratio), walk-forward 17/27 folds, and era tables —
// 2010–2025 $10K → $158.7M (DD 60%) and 1990–2025 → $804M (survives dot-com)
// vs $23M / $27M for the ungated −8% exit. Shallow exits, velocity exits,
// RSI exits and bounce/bail all FAILED the same validation. In-sample
// caveats still apply to the exact thresholds.
CODE[41] = `{
  name: "Median overextension with SQQQ and crash exit",
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
    { section: "Crash exit — leave when it breaks down" },
    { id: "exitPct", label: "Below line (%)", default: -28, options: [
      10,8,6,5,4,3,2,1,0,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-11,-12,-13,-14,-15,-16,-17,-18,-19,-20,-22,-24,-25,-26,-28,-30,-32,-34,-35,-36,-38,-40,-42,-44,-45,-46,-48,-50,-52,-55,-58,-60,-65,-70,-75,-80] },
    { id: "crashAsset", label: "Then hold", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "sqqq", label: "SQQQ" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" },
      { value: "tqqq", label: "TQQQ" }, { value: "spxl", label: "SPXL" } ] },
    { id: "slopeGate", label: "Only if line slope below (%/yr)", default: 20, options: [
      { value: 999, label: "Off" }, { value: -40, label: "-40" }, { value: -20, label: "-20" },
      { value: -10, label: "-10" }, { value: 0, label: "0" }, { value: 10, label: "10" },
      { value: 20, label: "20" }, { value: 30, label: "30" }, { value: 40, label: "40" },
      { value: 60, label: "60" }, { value: 80, label: "80" }, { value: 120, label: "120" } ] },
    { id: "belowGate", label: "Only after days below line", default: 10, options: [
      { value: 0, label: "Off" }, 1,2,3,5,8,10,15,20,30] },
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
    { key: "medianPrice", label: "Center", tip: "The main center line in price dollars — median or moving average of the last N closes, or the RSI-implied center (price x 50 / RSI) when the signal is RSI. Price crossing a band drawn off this line is exactly the trigger." },
    { key: "crashCenter", label: "Crash ctr", tip: "The center line the crash-side bands (exit, bounce, bail) measure against. Equals the main center unless the crash-bands signal is set to its own window or statistic." },
    { key: "abovePct", label: "vs line", tip: "How far the main signal (price, or the RSI reading) sits above (+) or below (−) its center, in percent. This number decides the overextension band." },
    { key: "crashAbovePct", label: "vs crash", tip: "The same stretch reading measured on the crash-bands signal — this one decides the exit, bounce and bail bands." },
    { key: "zone", label: "Band", tip: "Which band the close landed in: overextended (park), normal (hold), or crash (out)." },
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

    // Signal abstraction: each side is either PRICE vs a rolling center line
    // (median / moving average) or the RSI reading vs its constant 50 midline
    // — so "+55%" means RSI 77.5 and "-30%" means RSI 35, and every band
    // threshold keeps its meaning across statistics. The crash side defaults
    // to "same", reusing the main signal exactly.
    const useMed = p.stat !== "sma";
    const mainRsi = p.stat === "rsi";
    const crashSame = p.crashStat === "same" || p.crashStat == null;
    const crashRsi = crashSame ? mainRsi : p.crashStat === "rsi";
    const W2raw = +p.crashWindow || 0;
    const W2 = W2raw > 0 ? Math.max(2, W2raw) : W;
    const useMedC = crashSame ? useMed : p.crashStat !== "sma";
    const sameLine = W2 === W && crashRsi === mainRsi && (crashRsi || useMedC === useMed);

    // Rolling center line: sorted window + running sum, one in one out per day.
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
    // Wilder RSI, seeded from up to 4 windows of pre-start history.
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

    // Slope gate needs 63 days of crash-center history BEFORE the start, so
    // the confirmed-breakdown exit is live from day one. A throwaway roll
    // replays the 63 pre-start days recording the crash center. (With an RSI
    // crash signal the center is the constant 50, slope 0 — the gate passes
    // any positive threshold and should be set Off for negative ones.)
    const slopeGate = p.slopeGate == null ? 999 : +p.slopeGate;
    const belowGate = +p.belowGate || 0;
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
    // Decision-support stats (observation only — nothing here feeds a trade):
    // the crash signal's historical stretch range + exit stints, and the
    // traded fund's drawdown from its running high.
    let minAC = Infinity, maxAC = -Infinity;
    let stints = [], inCrash = false, stintLen = 0;
    let peakPx = 0, peakDate = "", ddNow = 0, maxDdSeen = 0;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4), 10);

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
      // Confirmation gates: the crash center's annualized 63d slope, and the
      // count of consecutive days the crash signal has spent below its center.
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
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      if (held === "cash") cash *= 1 + dayRate;
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
${SELL_HELD_TO_COVER}
      }

      if (med > 0 && medC > 0 && sigM > 0 && sigC > 0 && px[i] > 0) {
        const pOver = med * (1 + over), pExit = medC * (1 + exitB);
        if (state === "normal" || state === "over") {
          if (sigM > pOver) state = "over";
          else if (sigC < pExit
            && (slopeGate === 999 || slopeC < slopeGate)
            && (belowGate === 0 || belowC >= belowGate)) state = "crashCash";
          else state = "normal";
        } else if (sigC > pExit) state = "normal";
        zone = state === "over" ? "overextended" : state === "normal" ? "normal" : "crash";
        let want = state === "normal" ? p.asset
          : state === "over" ? p.park
          : crashAsset;
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
            note = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% vs line — " + zone;
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
      // Plot-space centers: an RSI signal draws as its IMPLIED center in
      // price dollars (price x 50 / RSI) — price crossing a band line off
      // this center is exactly the RSI trigger, so the chart reads the same
      // in every mode and the hover shows real dollar levels.
      const medPlot = mainRsi ? (sigM > 0 ? px[i] * 50 / sigM : 0) : med;
      const medCPlot = sameLine ? medPlot : (crashRsi ? (sigC > 0 ? px[i] * 50 / sigC : 0) : medC);
      const hp = priceOf(held, i);
      const stockVal = shares * hp;
${WEEKLY_MONTH_END_SNIPPET}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || logDay || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i] || 0, medianPrice: medPlot, abovePct: above * 100, zone: zone,
          crashCenter: medCPlot, crashAbovePct: aboveC * 100,
          mainSignal: sigM, crashSignal: sigC,
          overLine: medPlot * (1 + over), exitLine: medCPlot * (1 + exitB)
        });
      }
    }

    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "cash" : p.park.toUpperCase();
    const lbl = id => id === "cash" ? "cash" : id.toUpperCase();
    const zoneHold = zone === "normal" ? A : zone === "overextended" ? K : lbl(crashAsset);
    const CN = mainRsi ? "RSI(" + W + ")" : (useMed ? "median" : "avg");
    const CNc = crashRsi ? "RSI(" + W2 + ")" : (useMedC ? "median" : "avg");
    const pctStr = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const zoneTone = zone === "normal" ? "good" : "bad";
    const holdTxt = held === "cash" ? "cash" : held.toUpperCase();
    // Signal-chart lines (bounce/bail levels intentionally not drawn — they
    // cluttered the chart; the exit line anchors the downside visually).
    const chartLines = [
      { key: "assetPrice", label: A + " price" },
      mainRsi ? { key: "medianPrice", label: "RSI(" + W + ") line" } : { key: "medianPrice", label: W + "-day " + CN },
    ];
    if (!sameLine) chartLines.push(crashRsi ? { key: "crashCenter", label: "RSI(" + W2 + ") crash line" } : { key: "crashCenter", label: W2 + "-day " + CNc + " crash" });
    chartLines.push(
      { key: "exitLine", label: "Crash exit (" + (p.exitPct || 0) + "%" + (sameLine ? "" : " @ " + CNc) + ")" },
      { key: "overLine", label: "Overextended (+" + (p.overPct || 0) + "%)" }
    );
    if (inCrash && stintLen > 0) stints.push(stintLen);   // still out on the last day
    const stintsSorted = stints.slice().sort((a, b) => a - b);
    const medianStint = stintsSorted.length ? stintsSorted[(stintsSorted.length - 1) >> 1] : 0;
    const exitReachable = minAC < Infinity && minAC * 100 <= (p.exitPct || 0);
    const roomPts = aboveC * 100 - (p.exitPct || 0);
    return {
      log: log,
      lines: chartLines,
      signals: {
        cards: [
          { label: mainRsi ? "RSI(" + W + ") vs 50" : A + " vs " + W + "-day " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pctStr,
            tone: zoneTone,
            icon: above >= 0 ? "trendUp" : "trendDown",
            sub: (mainRsi ? sigM.toFixed(1) + " vs 50" : (px[p.endIdx] || 0).toFixed(2) + " vs " + med.toFixed(2) + " " + CN),
            tip: "The stretch reading the overextension rule uses: the " + (mainRsi ? "RSI against its 50 midline" : "close against the " + W + "-day " + CN) + ". Above +" + (p.overPct || 0) + "% parks in " + K + "; the crash exit reads " + (sameLine ? "the same signal" : "its own signal (" + CNc + ")") + " and leaves for " + lbl(crashAsset) + " below " + (p.exitPct || 0) + "%." },
          { label: "Current band",
            value: zone,
            tone: zoneTone,
            icon: "sliders",
            sub: "holding " + holdTxt,
            tip: "Which of the three bands the last close landed in, and what is held there: overextended (park), normal (hold the fund), crash (out until the signal recovers above the exit line)." },
          { label: "Crash exit",
            value: (p.exitPct || 0) + "%",
            icon: "shield",
            sub: "then hold " + lbl(crashAsset)
              + (slopeGate !== 999 ? " · needs slope<" + slopeGate : "")
              + (belowGate > 0 ? " · " + belowGate + "d below" : "")
              + (sameLine ? "" : " — vs " + CNc),
            tip: "The confirmed-breakdown exit: the signal must fall this far below its center AND pass the confirmation gates (center-line slope stalled, days spent below the line) before " + A + " is sold to " + lbl(crashAsset) + "; it is bought back as soon as the signal recovers above the exit line. A 9-family validation study picked deep-and-confirmed over shallow-and-fast: gates cut the whipsaws that made a plain −8% exit a tax." },
          { label: "Crash signal range",
            value: (minAC < Infinity ? (minAC >= 0 ? "+" : "") + (minAC * 100).toFixed(1) + "% … +" + (maxAC * 100).toFixed(1) + "%" : "—"),
            tone: exitReachable ? "good" : "bad",
            icon: "activity",
            sub: exitReachable ? stints.length + " exit stint" + (stints.length === 1 ? "" : "s") + ", median " + medianStint + "d out" : "your " + (p.exitPct || 0) + "% exit line was NEVER reached",
            tip: "The full range the crash signal's stretch has covered over this run. If your exit threshold sits below the bottom of this range it can never fire and the crash exit is effectively off — slow RSI windows compress the range hard (RSI(250) barely leaves ±10%), so deep thresholds need fast windows." },
          { label: "Room to crash exit",
            value: (roomPts >= 0 ? "+" : "") + roomPts.toFixed(1) + " pts",
            tone: roomPts >= 0 ? "good" : "bad",
            icon: "shield",
            sub: "signal " + (aboveC >= 0 ? "+" : "") + (aboveC * 100).toFixed(1) + "% vs " + (p.exitPct || 0) + "% line",
            tip: "How much further the crash signal can fall before the exit fires (positive), or how far past the line it already is (negative). The single most direct read on 'am I about to be sold out'." },
          { label: A + " drawdown",
            value: (ddNow * 100).toFixed(1) + "%",
            tone: ddNow > -0.15 ? "good" : "bad",
            icon: "trendDown",
            sub: "from " + peakPx.toFixed(2) + " high (" + peakDate + "); worst " + (-maxDdSeen * 100).toFixed(0) + "%",
            tip: "The traded fund's fall from its running high. The strategy never reads this number directly — it acts on the signal-vs-line stretch — but comparing the two tells you whether the exit rule actually engages in the declines that hurt: a deep drawdown with the exit never firing means the crash signal is configured too slow or too deep." }
        ],
        decision: {
          action: zoneHold === "cash" ? "Stay in cash"
            : zone === "normal" ? "Buy " + zoneHold : "Hold " + zoneHold,
          note: "signal is " + pctStr + " vs the " + CN + " — " + zone + " band",
          tone: zoneTone,
          reasons: [
            { name: "Band", val: A + " " + pctStr + " vs " + CN, tag: zone + " · " + holdTxt,
              lean: zone === "normal" ? "buy" : zoneHold === "cash" ? "cash" : "out" }
          ]
        }
      }
    };
  }
}`;

// #44 — #41 plus a one-way credit veto on the Chicago Fed NFCI: while the
// index reads above the threshold (a credit crunch), everything goes to cash
// regardless of the price bands; when it calms, the bands decide again. The
// veto can only ever REMOVE leverage. Validated Aug 2026: era tables 1973/1990
// (x5.8/x2.3 at real cash rates), 52-window walk-forward, arc-preserving
// bootstrap (86.5% OOS path wins), ALFRED vintage check, placebo test (beats
// 98.7% of random same-length vetoes). Dormant since Jul 2009 — by design it
// does nothing outside genuine credit crises (1973-75, Volcker, 1987, GFC).
// Default threshold 0.4 (the era-consistent point of the validated 0.4-0.6
// plateau under cycle-lift semantics); default lift = "cycle" (veto ends when
// NFCI calms OR a crash exit->recovery completes while vetoed), which beat
// the calm-only variant on walk-forward (12W/2L vs 11W/10L) and bootstrap
// (382/400 vs 346/400 path wins) — see veto-cycle.cjs in the research notes.
CODE[44] = `{
  name: "NFCI veto, med stretch with SQQQ and med crash exit",
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
    { section: "Crash exit — leave when it breaks down" },
    { id: "exitPct", label: "Below line (%)", default: -28, options: [
      10,8,6,5,4,3,2,1,0,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-11,-12,-13,-14,-15,-16,-17,-18,-19,-20,-22,-24,-25,-26,-28,-30,-32,-34,-35,-36,-38,-40,-42,-44,-45,-46,-48,-50,-52,-55,-58,-60,-65,-70,-75,-80] },
    { id: "crashAsset", label: "Then hold", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "sqqq", label: "SQQQ" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" },
      { value: "tqqq", label: "TQQQ" }, { value: "spxl", label: "SPXL" } ] },
    { id: "slopeGate", label: "Only if line slope below (%/yr)", default: 20, options: [
      { value: 999, label: "Off" }, { value: -40, label: "-40" }, { value: -20, label: "-20" },
      { value: -10, label: "-10" }, { value: 0, label: "0" }, { value: 10, label: "10" },
      { value: 20, label: "20" }, { value: 30, label: "30" }, { value: 40, label: "40" },
      { value: 60, label: "60" }, { value: 80, label: "80" }, { value: 120, label: "120" } ] },
    { id: "belowGate", label: "Only after days below line", default: 10, options: [
      { value: 0, label: "Off" }, 1,2,3,5,8,10,15,20,30] },
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
    { key: "zone", label: "Band", tip: "Which band the close landed in — or CREDIT VETO while the NFCI override holds everything in cash." },
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
    const nfciTh = p.nfciTh == null ? 0.4 : +p.nfciTh, CREDIT = "Credit stress (NFCI)";   // CREDIT: its chart panel
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
      let fired = null;   // the chart panel whose rule fired this close's trade
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      if (held === "cash") cash *= 1 + dayRate;
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
${SELL_HELD_TO_COVER}
      }

      if (med > 0 && medC > 0 && sigM > 0 && sigC > 0 && px[i] > 0) {
        const pOver = med * (1 + over), pExit = medC * (1 + exitB);
        if (state === "normal" || state === "over") {
          if (sigM > pOver) state = "over";
          else if (sigC < pExit
            && (slopeGate === 999 || slopeC < slopeGate)
            && (belowGate === 0 || belowC >= belowGate)) state = "crashCash";
          else state = "normal";
        } else if (sigC > pExit) state = "normal";
        zone = state === "over" ? "overextended" : state === "normal" ? "normal" : "crash";
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
        const vetoMoved = vetoOn !== wasVeto;   // the veto began or ended at this close
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
            // The veto's own trades go in the NFCI panel, the rest in the price
            // panel: the veto starting, or ending as NFCI calms (a crash cycle
            // that lifts it is the price's doing).
            fired = vetoMoved && (vetoOn || !nfAbove) ? CREDIT : null;
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
${WEEKLY_MONTH_END_SNIPPET}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || logDay || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i] || 0, medianPrice: medPlot, abovePct: above * 100,
          nfci: isFinite(nfNow) ? nfNow : null,
          nfciVeto: nfciTh !== 999 && isFinite(nfNow) ? nfciTh : null,
          ...(fired ? { firedBy: fired } : {}),
          zone: vetoOn ? "CREDIT VETO" : zone,
          overLine: medPlot * (1 + over), exitLine: medPlot * (1 + exitB)
        });
      }
    }

    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "cash" : p.park.toUpperCase();
    const lbl = id => id === "cash" ? "cash" : id.toUpperCase();
    const CN = mainRsi ? "RSI(" + W + ")" : (useMed ? "median" : "avg");
    const pctStr = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const zoneTone = vetoOn ? "bad" : zone === "normal" ? "good" : "bad";
    const holdTxt = held === "cash" ? "cash" : held.toUpperCase();
    // Two panels: the price with the lines set from its center, and NFCI with
    // the credit veto, the rule that reads it.
    const PRICE = A + " price";
    const chartLines = [
      { key: "assetPrice", label: A + " price", group: PRICE },
      mainRsi ? { key: "medianPrice", label: "RSI(" + W + ") line", group: PRICE } : { key: "medianPrice", label: W + "-day " + CN, group: PRICE },
      { key: "exitLine", label: "Crash exit (" + (p.exitPct || 0) + "%)", group: PRICE },
      { key: "overLine", label: "Overextended (+" + (p.overPct || 0) + "%)", group: PRICE }
    ];
    if (nfciTh !== 999) chartLines.push({ key: "nfci", label: "NFCI", unit: "num", group: CREDIT }, { key: "nfciVeto", label: "Credit veto", unit: "num", group: CREDIT });
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
            tip: "Which band the last close landed in — overextended (park), normal (hold), crash (out) — or CREDIT VETO while the NFCI override keeps everything in cash regardless of the bands." },
          { label: "NFCI credit veto",
            value: nfciStr,
            tone: nfciTh === 999 ? "good" : (vetoOn ? "bad" : "good"),
            icon: "shield",
            sub: nfciTh === 999 ? "veto off"
              : vetoOn ? "ABOVE +" + nfciTh + " — in cash until it calms" + (vetoCycle ? " or a crash cycle completes" : "")
              : "veto at +" + nfciTh + " (" + vetoDist.toFixed(2) + " away) · fired " + vetoWindows + "x, " + vetoDays + "d this run",
            tip: "Chicago Fed National Financial Conditions Index, weekly with a 7-day publication lag. Above +" + (nfciTh === 999 ? "0.4" : nfciTh) + " = credit crunch: everything goes to cash. One-way — it never adds leverage. The veto lifts when the index calms" + (vetoCycle ? ", or earlier if the price engine fires its own crash exit and then recovers while vetoed — the market has re-earned entry, so credit stress alone no longer keeps you out" : "") + ". Fired only in genuine credit crises since 1971 (1973-75, the Volcker squeeze, 1987, S&L 1990, the GFC) and has been silent since July 2009." },
          { label: "Crash exit",
            value: (p.exitPct || 0) + "%",
            icon: "shield",
            sub: "then hold " + lbl(crashAsset)
              + (slopeGate !== 999 ? " · needs slope<" + slopeGate : "")
              + (belowGate > 0 ? " · " + belowGate + "d below" : ""),
            tip: "The confirmed-breakdown exit: the signal must fall this far below its center AND pass the confirmation gates before " + A + " is sold to " + lbl(crashAsset) + "; bought back when the signal recovers above the exit line." },
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
}`;


// #45 — #44 with two changes and nothing else: the exit is a plain sell line
// (default: the center itself, no gates) and a buy-back line sits 28% under
// the center. After a sell, a close at or below the buy-back line marks a
// crash; the first close back above it buys without waiting for the sell
// line. Until the price has closed above the sell line again, the buy-back
// line is also the sell line, so a close back under it sells again and the
// next close above it buys again: two sell lines, one for the way down from
// above and one around the crash level. SQQQ at +55%, the credit veto, costs
// and one-trade-per-day are #44's. With exitPct -28, slopeGate 20, belowGate
// 10 and bbPct Off it reproduces #44 row for row (checked across 22,984 rows
// when it was written; tests/library-withdrawals.cjs does not cover that).
// The defaults are the best fit on Q1 2010 to Q4 2025, 2009-12-31 to
// 2025-12-31 (2026-10-29, six searches, 286,000 runs of this code, scratchpad
// r5/bb-fit.cjs): sell line +10% (above the center), 4 closes, buy-back -32%
// with all the money; 100.8% a year against 91.8% for the earlier -3 / 5 /
// -34 / half.
CODE[45] = `{
  name: "SQQQ stretch, sell line + crash buy-back",
  params: [
    { section: "Fund & signal" },
    { id: "asset", label: "Fund traded", tip: "The fund held whenever the strategy is in the market.", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "stat", label: "Center line", tip: "What the price is compared to. A median is not pulled by spikes; a moving average is.", default: "median", options: [
      { value: "median", label: "Median" }, { value: "sma", label: "Moving average" },
      { value: "rsi", label: "RSI (vs its 50 midline)" } ] },
    { id: "window", label: "Window (days)", tip: "Trading days the center line covers. Longer is smoother and slower.", default: 250, options: [
      5,7,10,14,20,30,40,50,60,75,90,100,110,120,130,140,150,160,175,190,200,210,220,230,240,250,260,270,280,290,300,320,340,360,400,450,500] },
    { section: "Overextended — sell the melt-up" },
    { id: "overPct", label: "Above line (%)", tip: "Switch to the fund below when the price closes this far above the center line, and back on the first close under it.", default: 55, options: [
      2,4,5,6,8,10,12,15,18,20,22,25,28,30,32,35,38,40,42.5,45,47.5,50,52.5,55,57.5,60,62.5,65,67.5,70,72.5,75,80,85,90,95,100,110,120,125,130,140,150,160,175,200,225,250,300] },
    { id: "park", label: "Then hold", tip: "What to hold until the price closes back under that line.", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    { section: "Sell line — leave when it breaks down" },
    { id: "exitPct", label: "Level vs center line (%)", tip: "Sell on the first close under this level. Negative is below the center line, positive above it.", default: 10, options: [
      10,8,6,5,4,3,2,1,0,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-11,-12,-13,-14,-15,-16,-17,-18,-19,-20,-22,-24,-25,-26,-28,-30,-32,-34,-35,-36,-38,-40,-42,-44,-45,-46,-48,-50,-52,-55,-58,-60,-65,-70,-75,-80] },
    { id: "crashAsset", label: "Then hold", tip: "What to hold after selling, until the strategy buys back.", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "sqqq", label: "SQQQ" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" },
      { value: "tqqq", label: "TQQQ" }, { value: "spxl", label: "SPXL" } ] },
    { id: "confirmDays", label: "Buy back after closes above line", tip: "Closes in a row above the line before buying back. Selling needs one.", default: 4, options: [1, 2, 3, 4, 5, 6] },
    { id: "dipReentry", label: "Re-enter a correction", tip: "How far the price must climb from its low toward the center line before buying back.", default: 50, options: [
      { value: 0, label: "At the sell line" }, { value: 25, label: "A quarter of the way back from its low" },
      { value: 33, label: "A third of the way back from its low" }, { value: 50, label: "Half way back from its low" },
      { value: 67, label: "Two thirds of the way back from its low" } ] },
    { section: "Buy-back line — after a crash, re-enter here instead of waiting for the sell line; it sells again below it" },
    { id: "bbPct", label: "Below line (%)", tip: "How far under the center line counts as a crash.", default: -32, options: [
      { value: 999, label: "Off" }, -10,-12,-14,-15,-16,-18,-20,-22,-24,-25,-26,-28,-30,-32,-34,-35,-36,-38,-40,-42,-44,-45,-46,-48,-50,-52,-55,-58,-60,-65,-70,-75,-80] },
    { id: "bbSlice", label: "Buy a slice at the line right away", tip: "Bought at the first close under the line. The rest waits for the closes above it.", default: 100, options: [
      { value: 0, label: "No — wait for the closes above it" }, { value: 25, label: "A quarter of the money" },
      { value: 33, label: "A third of the money" }, { value: 50, label: "Half of the money" },
      { value: 75, label: "Three quarters of the money" }, { value: 100, label: "All of the money" } ] },
    { id: "sliceStop", label: "Slice stop (% under its price)", tip: "Sells the slice if the price falls this far below its buy price.", default: 20, options: [10, 15, 20, 25, 30] },
    { id: "sliceCap", label: "Slices per sold-out stint", tip: "Slices allowed before the strategy is fully back in.", default: 1, options: [
      { value: 1, label: "One" }, { value: 2, label: "Two" }, { value: 999, label: "No limit" } ] },
    { section: "Execution & costs" },
    { id: "splitDays", label: "One trade per day", tip: "Yes: a switch sells today and buys tomorrow. No: both at one close.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "cashRate", label: "Cash interest (%/yr)", tip: "Yearly rate earned on money held in cash.", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,10,11,12] },
    { id: "tradeCost", label: "Trading cost (%)", tip: "Charged on every buy and sell, as a share of the amount traded.", default: 0.02, options: [
      0,0.01,0.02,0.03,0.04,0.05,0.06,0.08,0.1,0.15,0.2,0.25,0.3,0.4,0.5,0.6,0.75,1] }
  ],
  columns: [
    { key: "assetPrice", label: "Fund", tip: "Closing price of the traded fund." },
    { key: "medianPrice", label: "Center", tip: "The main center line in price dollars — median or moving average of the last N closes, or the RSI-implied center (price x 50 / RSI) when the signal is RSI." },
    { key: "abovePct", label: "vs line", tip: "How far the main signal sits above (+) or below (−) its center, in percent." },
    { key: "zone", label: "Band", tip: "Where the close landed: overextended (above the overextended line), between lines, or sold." },
    { key: "closesAbove", label: "Closes above", tip: "While sold out: how many closes in a row the price has made above the line it will buy back at — the buy-back line once a crash is marked, the re-entry line after a correction, the sell line otherwise. Buying waits for the count in the setting; selling never waits." },
    { key: "slice", label: "Slice", tip: "Share of the money bought at the first close under the buy-back line, shown while held. Sold if the price falls the stop setting under its buy price. A new slice needs a close above the line and another under it; at most the set number per sold-out stint." },
    { key: "reentryLine", label: "Re-entry line", tip: "While sold out after a correction that stayed above the buy-back line: the price the strategy will buy back at, part of the way back from the correction's low toward the center (the setting), never below the buy-back line. Blank in the market, while a crash is marked, and when the setting is off." },
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

    const useMed = p.stat !== "sma";
    const mainRsi = p.stat === "rsi";

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
    const rsiM = mainRsi ? mkRsi(W) : null;
    if (rollM) for (let k = rollM.warmFrom; k < p.startIdx; k++) if (px[k] > 0) rollM.ins(px[k]);

    const bbPct = p.bbPct == null ? 999 : +p.bbPct;
    const bbB = bbPct === 999 ? 0 : bbPct / 100;
    // A slice of the money at the first close under the buy-back line, without
    // waiting for the closes above it: the five-close rule enters a V-shaped
    // recovery (2020, 2025) a long way up from the low, and a slice bought at
    // the line takes part of that move. It is stopped SLICE_STOP under its own
    // price, and a new slice needs a fresh cross under the line, so a bear
    // market costs at most one slice per leg; a sold-out stint buys at most
    // sliceCap slices, because 2022 bought three (April, August, November)
    // and stopped all three. The rest waits for the buy-back.
    const sliceF = bbPct === 999 ? 0 : Math.max(0, Math.min(1, (+p.bbSlice || 0) / 100));
    const SLICE_STOP = Math.max(0.05, Math.min(0.5, (p.sliceStop == null ? 20 : +p.sliceStop) / 100));
    const sliceCap = p.sliceCap == null ? 1 : +p.sliceCap;
    // Buying back waits for this many closes in a row above the line; selling
    // acts on the first close. 1 = the first close buys. The asymmetry is the
    // whipsaw defence: in a crash the big up days are the traps, and a sale
    // reversed a day later costs the gap between the two closes.
    const confirmDays = Math.max(1, Math.round(+p.confirmDays) || 1);
    // Re-entry after a correction. Sold out with the sell line reclaimed only
    // when the price has climbed all the way back, every such re-entry since
    // 2010 bought higher than it sold; the corrections that bottomed between
    // 10% and 34% under the center cost the most, because nothing let the
    // strategy back in before the line. dipF puts the re-entry line part of
    // the way back from the correction's low toward the center instead
    // (never below the buy-back line, whose own rule governs deeper falls).
    // Such a buy-back behaves like a crash buy-back: the buy-back line is the
    // sell line until the sell line is reclaimed. 0 = the sell line, as before.
    const dipF = Math.max(0, Math.min(1, (+p.dipReentry || 0) / 100));
    const dipText = dipF >= 0.66 ? "two thirds of the way back" : dipF >= 0.5 ? "half way back" : dipF >= 0.33 ? "a third of the way back" : "a quarter of the way back";
    // sellArmed: the normal sell line is live. A buy-back switches it off until the price has closed
    // back above that line; until then the buy-back line is the sell line, so a close back under it
    // sells again. bbArmed: while sold out, the price has closed at or below the buy-back line.
    let sellArmed = true, bbArmed = false;
    let aboveRe = 0, aboveBB = 0;   // closes in a row above the re-entry line / the buy-back line
    let tr = false, trEntry = 0, trArmed = false, belowPrev = false, _frac = 1, sliceNote = "", sliceN = 0;   // the slice; sliceN = slices bought this stint
    let lowRel = 0;                   // the sold-out stint's lowest close, as a fraction of the center (≤ 0)
    // Trade notes say what was traded and which rule fired, naming the line with its setting.
    const nm = id => id === "cash" ? "cash" : String(id).toUpperCase();
    const closesTxt = confirmDays + (confirmDays > 1 ? " closes in a row" : " close");
    const exitLvl = ((p.exitPct || 0) > 0 ? "+" : "") + (p.exitPct || 0) + "%";   // the sell line can sit above the center line
    const overTxt = "the overextended line (+" + (p.overPct || 0) + "%)", exitTxt = "the sell line (" + exitLvl + ")", bbTxt = "the buy-back line (" + bbPct + "%)";
    const shareTxt = f => f >= 0.99 ? "all the money" : f >= 0.74 ? "three quarters of the money" : f >= 0.49 ? "half the money" : f >= 0.32 ? "a third of the money" : "a quarter of the money";
    let why = "", splitFrom = "", splitIdx = -9;   // why: the rule that changed the state today; splitFrom/splitIdx: leg one of a switch

    let cash = p.initial, shares = 0, held = "cash";
    let state = "normal", invested = p.initial, feeTotal = 0;
    let med = 0, above = 0, zone = "normal";
    let sigM = 0;
    let stints = [], inCrash = false, stintLen = 0;
    let peakPx = 0, peakDate = "", ddNow = 0, maxDdSeen = 0;

    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (px[i] > 0 && rollM) rollM.ins(px[i]);
      if (rollM) { const drop = i - W; if (drop >= rollM.warmFrom && px[drop] > 0) rollM.rem(px[drop]); }
      if (rsiM && i > 0) rsiM.step(i);
      med = mainRsi ? 50 : rollM.center(useMed);
      sigM = mainRsi ? rsiM.val() : px[i];
      above = med > 0 && sigM > 0 ? sigM / med - 1 : 0;
      if (px[i] > 0) {
        if (px[i] > peakPx) { peakPx = px[i]; peakDate = data.dates[i]; }
        ddNow = peakPx > 0 ? px[i] / peakPx - 1 : 0;
        if (-ddNow > maxDdSeen) maxDdSeen = -ddNow;
      }
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      if (held === "cash") cash *= 1 + dayRate;
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
${SELL_HELD_TO_COVER}
      }

      if (med > 0 && sigM > 0 && px[i] > 0) {
        why = "";
        const pOver = med * (1 + over), pExit = med * (1 + exitB), pBuyBack = med * (1 + bbB);
        if (state === "crashCash") lowRel = Math.min(lowRel, sigM / med - 1);
        const pReenter = dipF > 0 ? Math.min(pExit, Math.max(pBuyBack, med * (1 + lowRel * dipF))) : pExit;
        aboveRe = sigM > pReenter ? aboveRe + 1 : 0;
        aboveBB = sigM > pBuyBack ? aboveBB + 1 : 0;
        if (state === "normal" || state === "over") {
          const was = state;
          if (!sellArmed && sigM >= pExit) sellArmed = true;   // back above the sell line: it is live again
          if (sigM > pOver) state = "over";
          else if (sellArmed && sigM < pExit) { state = "crashCash"; lowRel = sigM / med - 1; aboveRe = 0; why = "closed under " + exitTxt; }
          else if (!sellArmed && sigM < pBuyBack) { state = "crashCash"; sliceN = sliceCap; why = "closed back under " + bbTxt; }   // the second sell line: a failed buy-back sells everything, no slice until back in
          else state = "normal";
          if (was === "normal" && state === "over") why = "closed above " + overTxt;
          if (was === "over" && state === "normal") why = "closed back under " + overTxt;
        } else if (bbArmed && aboveBB >= confirmDays) { state = "normal"; sellArmed = false; why = closesTxt + " above " + bbTxt; }   // crash buy-back: in early, the normal sell on hold
        else if (aboveRe >= confirmDays) { state = "normal"; sellArmed = pReenter >= pExit * 0.999999; why = closesTxt + " above " + (sellArmed ? exitTxt : "the re-entry line"); }   // below the sell line: a buy-back, with the buy-back line as the sell line
        bbArmed = state === "crashCash" && bbPct !== 999 && (bbArmed || sigM <= pBuyBack);
        zone = state === "over" ? "overextended" : state === "normal" ? "between lines" : "sold";
        const belowNow = sigM <= pBuyBack;
        if (sliceF > 0 && state === "crashCash") {
          if (belowNow && !belowPrev && sliceN < sliceCap) trArmed = true;
          if (tr && sigM < trEntry * (1 - SLICE_STOP)) { tr = false; trArmed = false; sliceNote = "Sold the slice: down " + Math.round(SLICE_STOP * 100) + "% from its buy price"; }
          else if (!tr && trArmed && belowNow) { tr = true; trEntry = sigM; trArmed = false; sliceN++; sliceNote = "Bought " + nm(p.asset) + " with " + shareTxt(sliceF) + ": first close under " + bbTxt; }
        } else { tr = false; trArmed = false; sliceN = 0; }
        belowPrev = belowNow;
        const prevFrac = _frac;
        _frac = state === "crashCash" ? (tr ? sliceF : 0) : 1;   // share of the money meant to be in the fund
        let want = state === "normal" ? p.asset
          : state === "over" ? p.park
          : (_frac > 0 ? p.asset : crashAsset);
        const target = want;
        if (p.splitDays && want !== held && held !== "cash" && want !== "cash") want = "cash"; // leg 1 today, buy re-checks next bar
        if (want !== held) {
          const oldPx = priceOf(held, i);
          if (held !== "cash" && oldPx > 0) {
            const gross = shares * oldPx, f = gross * cost;
            cash += gross - f; fee += f; shares = 0;
          }
          const newPx = priceOf(want, i);
          if (want === "cash" || newPx > 0) {
            if (want !== "cash") { const spend = want === p.asset ? cash * _frac : cash; const f = spend * cost; shares = (spend - f) / newPx; fee += f; cash -= spend; }
            action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
            const verb = action === "buy" ? "Bought " + nm(want) : action === "sell" ? "Sold " + nm(held) : "Switched " + nm(held) + " to " + nm(want);
            note = sliceNote || (why ? verb + ": " + why : action === "buy" && splitIdx === i - 1 ? verb + ", the day after selling " + splitFrom : verb);
            if (action === "sell" && target !== "cash") { splitFrom = nm(held); splitIdx = i; }
            sliceNote = "";
            held = want;
          }
        } else if (held === p.asset && priceOf(held, i) > 0 && _frac < 1) {
          // Holding the fund while only a slice is meant to be held. The slice is
          // bought once and left alone; this sells down to it only on the day a
          // full position and a slice decision coincide (the sell line and the
          // buy-back line crossed on the same day), and otherwise lets new money
          // in only up to the slice's share.
          const pxh = priceOf(held, i), total = shares * pxh + cash, excess = shares * pxh - total * _frac;
          if (prevFrac >= 1 && excess > total * 0.02) { const sh = excess / pxh, gross = sh * pxh, f = gross * cost; shares -= sh; cash += gross - f; fee += f; action = "sell"; note = "Sold " + nm(p.asset) + " down to " + shareTxt(sliceF) + ": closed under " + bbTxt; sliceNote = ""; }
          else if (prevFrac < 1 && -excess > total * 0.02 && cash > 0) { const spend = Math.min(cash, -excess), f = spend * cost; shares += (spend - f) / pxh; cash -= spend; fee += f; }
        } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
          const f = cash * cost;
          shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
          if (prevFrac < 1 && _frac >= 1) { action = "buy"; note = "Bought " + nm(p.asset) + " with the rest of the money" + (why ? ": " + why : ""); }
          else if (action === "contribution") note = "contribution deployed";
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
${WEEKLY_MONTH_END_SNIPPET}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || logDay || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i] || 0, medianPrice: medPlot, abovePct: above * 100,
          zone: zone,
          ...(state === "crashCash" ? { closesAbove: Math.min(bbArmed ? aboveBB : aboveRe, confirmDays) } : {}),
          ...(tr ? { slice: Math.round(sliceF * 100) + "%" } : {}),
          ...(dipF > 0 && state === "crashCash" && !bbArmed && lowRel * dipF < exitB ? { reentryLine: medPlot * (1 + Math.max(bbB, lowRel * dipF)) } : {}),
          // The chart's line for the stint: the re-entry while sold out after a
          // correction, the slice's stop while a slice is held (a slice is only
          // bought under the buy-back line, where no re-entry line exists), in
          // price as the other lines are drawn.
          ...(dipF > 0 && state === "crashCash" && !bbArmed && lowRel * dipF < exitB ? { stintLine: medPlot * (1 + Math.max(bbB, lowRel * dipF)) }
            : tr ? { stintLine: (mainRsi ? px[i] / sigM : 1) * trEntry * (1 - SLICE_STOP) } : {}),
          overLine: medPlot * (1 + over), exitLine: medPlot * (1 + exitB),
          ...(bbPct === 999 ? {} : { buyBackLine: medPlot * (1 + bbB) })
        });
      }
    }

    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "cash" : p.park.toUpperCase();
    const lbl = id => id === "cash" ? "cash" : id.toUpperCase();
    const CN = mainRsi ? "RSI(" + W + ")" : (useMed ? "median" : "avg");
    const pctStr = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const zoneTone = state === "normal" ? "good" : "bad";
    const holdTxt = held === "cash" ? "cash" : held.toUpperCase();
    const chartLines = [
      { key: "assetPrice", label: A + " price" },
      mainRsi ? { key: "medianPrice", label: "RSI(" + W + ") line" } : { key: "medianPrice", label: W + "-day " + CN },
      { key: "exitLine", label: "Sell line (" + exitLvl + ")" },
      { key: "overLine", label: "Overextended (+" + (p.overPct || 0) + "%)" }
    ];
    if (bbPct !== 999) chartLines.push({ key: "buyBackLine", label: "Buy-back (" + bbPct + "%)" });
    if (dipF > 0 || sliceF > 0) chartLines.push({ key: "stintLine", label: dipF > 0 && sliceF > 0 ? "Re-entry, slice stop" : dipF > 0 ? "Re-entry" : "Slice stop (-" + Math.round(SLICE_STOP * 100) + "%)" });
    if (inCrash && stintLen > 0) stints.push(stintLen);
    return {
      log: log,
      lines: chartLines,
      signals: {
        cards: [
          { label: mainRsi ? "RSI(" + W + ") vs 50" : A + " vs " + W + "-day " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pctStr,
            tone: state === "normal" ? "good" : "bad",
            icon: above >= 0 ? "trendUp" : "trendDown",
            sub: (mainRsi ? sigM.toFixed(1) + " vs 50" : (px[p.endIdx] || 0).toFixed(2) + " vs " + med.toFixed(2) + " " + CN),
            tip: "The stretch reading the overextension rule uses. Above +" + (p.overPct || 0) + "% parks in " + K + "; below " + exitLvl + " sells to " + lbl(crashAsset) + "." },
          { label: "Current band",
            value: zone,
            tone: zoneTone,
            icon: "sliders",
            sub: "holding " + holdTxt,
            tip: "Where the last close landed: overextended (park), between lines (hold), sold (out)." },
          { label: "Sell line",
            value: exitLvl,
            icon: "shield",
            sub: (sellArmed ? "armed" : "on hold until a close above it") + " · then hold " + lbl(crashAsset)
              + (state === "crashCash" && !bbArmed ? " · " + Math.min(aboveRe, confirmDays) + " of " + confirmDays + " closes above " + (dipF > 0 && lowRel * dipF < exitB ? "the re-entry line" : "it") : confirmDays > 1 ? " · buys back after " + confirmDays + " closes above" : ""),
            tip: "A close this far below the center sells " + A + " to " + lbl(crashAsset) + ". Bought back after " + confirmDays + (confirmDays > 1 ? " closes in a row" : " close") + " above this line, or earlier at the buy-back line after a crash; after such an early buy-back this line is on hold and the buy-back line sells instead, until the price has closed above this line again." },
          { label: "Buy-back line",
            value: bbPct === 999 ? "off" : bbPct + "%",
            icon: "flag",
            tone: bbArmed ? "good" : "",
            sub: bbPct === 999 ? "re-entry only above the sell line"
              : bbArmed ? "ARMED — " + (confirmDays > 1 ? Math.min(aboveBB, confirmDays) + " of " + confirmDays + " closes above it; then buys " : "the first close above it buys ") + A + (tr ? " · " + Math.round(sliceF * 100) + "% already bought at the line, stop " + (trEntry * (1 - SLICE_STOP)).toFixed(2) : sliceF > 0 && sliceN >= sliceCap ? " · no new slice until back in the market" : "")
              : state === "crashCash" ? "waiting for a close at or below it"
              : sellArmed ? "idle while in the market" : "live — a close under it sells again",
            tip: "After a sell, a close at or below this line marks a crash; " + confirmDays + (confirmDays > 1 ? " closes in a row" : " close") + " back above it buys " + A + " without waiting for the sell line. Until the price has closed above the sell line again, this line sells too: a close back under it puts you out, and the same count of closes above it buys again." },
          ...(dipF > 0 ? [{ label: "Re-entry line",
            value: state === "crashCash" && !bbArmed && lowRel * dipF < exitB ? (Math.max(bbB, lowRel * dipF) * 100).toFixed(1) + "%" : "—",
            icon: "flag",
            tone: "",
            sub: state === "crashCash" && !bbArmed
              ? (lowRel * dipF < exitB ? dipText + " from the low (" + (lowRel * 100).toFixed(0) + "%) · " + Math.min(aboveRe, confirmDays) + " of " + confirmDays + " closes above it" : "the correction is too shallow — the sell line applies")
              : bbArmed ? "a crash is marked — the buy-back line applies" : "idle while in the market",
            tip: "After a correction that stays above the buy-back line, the strategy buys back once the price has closed " + confirmDays + (confirmDays > 1 ? " days in a row" : " day") + " above a line " + dipText + " from the correction's low toward the center, instead of waiting for the sell line. After such a buy-back the buy-back line is the sell line until the price has closed above the sell line again." }] : []),
          { label: A + " drawdown",
            value: (ddNow * 100).toFixed(1) + "%",
            tone: ddNow > -0.15 ? "good" : "bad",
            icon: "trendDown",
            sub: "from " + peakPx.toFixed(2) + " high (" + peakDate + "); worst " + (-maxDdSeen * 100).toFixed(0) + "%",
            tip: "The traded fund's fall from its running high. The price bands act on stretch-vs-line — this shows what they are protecting against." }
        ],
        decision: {
          action: state === "normal" ? "Buy " + A : state === "over" ? "Hold " + K : lbl(crashAsset) === "cash" ? "Stay in cash" : "Hold " + lbl(crashAsset),
          note: "signal is " + pctStr + " vs the " + CN + " — " + zone + " band",
          tone: zoneTone,
          reasons: [
            { name: "Band", val: A + " " + pctStr + " vs " + CN, tag: zone + " · " + holdTxt,
              lean: state === "normal" ? "buy" : holdTxt === "cash" ? "cash" : "out" }
          ]
        }
      }
    };
  }
}`;

// #47 — TQQQ vs QQQ stretch (the user's idea, 2026-10-29). The signal is how
// far TQQQ's buy & hold over a lookback is ahead of QQQ's: (TQQQ growth ÷ QQQ
// growth − 1) in percent, read off the last `lookback` years of prices only —
// nothing older matters (an earlier version ranked it against every reading
// since 1971, which made 2010+ results swing from 1% to 86% with the start
// year of that history). Rules on that lead: a ceiling (step aside, SQQQ for
// at most N days then cash, back at a lower lead), a floor (a break sells,
// SQQQ while broken, back after N closes above a re-entry lead) and a deep
// buy (TQQQ again far behind while the floor is broken); and the buy-back
// strategy's overextended line (SQQQ while TQQQ closes more than 55% above its
// own 250-day median; Off leaves the stretch rules alone). The rules also run
// over the lookback window before the entry, so a start inside a stepped-aside
// or floor-broken stretch carries that state in. Sales go through at the close
// that shows the signal; a switch between two funds buys the other one at the
// next close unless One trade per day is off. The defaults are the
// best fit of a search over about four million settings scored on Q1 2010 to
// Q4 2025, 2009-12-31 to 2025-12-31, memory before the entry included
// (scratchpad r5/opt-q.cjs, the strategy's own option lists): 135.8% a year
// with the line, 98.2% with it off; January to October 2026, left out of the
// fit, +187.5%. The SQQQ limit came after: run on the reconstructed prices
// from 1953 the rules made 4.4% a year and lost 99.999% before 2010, mostly
// in SQQQ under the floor (3,694 days) and over the line (1,616 days) while
// the market rose. The user wants nothing lost from 2010, where the longest
// SQQQ run is 95 days, so the default limit is 126 days: identical from 2010
// (135.8%), 8.6% a year from 1953 instead of 4.4%. 20 days is the best count
// over the full history (14.9%) but costs 8 points from 2010 (scratchpad
// r5/defence-grid.cjs). The two median defences, off by default, keep the
// money over 1953-2009 but cost 25-35 points from 2010. A plain stop on the
// deep buy lost on both counts; the deep buy guard (25% under the buy price,
// cash until TQQQ closes above its median, then bought again) and the credit
// veto (NFCI above 0.4, the NFCI strategy's level) never fire after 2009, so
// 2010 to today is identical, and lift 1953-2026 to 17.1% a year: 1973-74
// +28%, 2000-02 +9%, 2008 +5% instead of -89%, -99%, -88% (scratchpad
// r5/defence2.cjs, after surveying how the other library strategies get
// through those bears, r5/survey.cjs).
// Number 46 is skipped on purpose: it was handed out once
// on 2026-10-23 and withdrawn, and a saved copy stamped 46 would refresh into
// whatever strategy reused it.
CODE[47] = `{
  name: "TQQQ vs QQQ stretch",
  params: [
    { section: "Stretch" },
    { id: "lookbackYears", label: "Lookback (years)", tip: "How many years of buy & hold growth are compared: TQQQ's against QQQ's.", default: 2.25, options: [
      1,1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.25,3.5,3.75,4,4.5,5,5.5,6,7,8,9,10] },
    { section: "Ceiling — step aside" },
    { id: "topLead", label: "TQQQ ahead by at least (%)", tip: "TQQQ's growth over the lookback against QQQ's: 90 means TQQQ grew 1.9 times as much.", default: 90, options: [
      20,30,40,50,60,70,75,80,85,90,95,100,110,120,130,140,150,160,180,200,225,250,300,{ value: 9999, label: "Off" }] },
    { id: "topHold", label: "Held instead", tip: "What is held from the ceiling until the lead falls back.", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" } ] },
    { id: "topDays", label: "SQQQ for at most (days)", tip: "After this many days SQQQ is sold to cash, which waits for the lead to fall back.", default: 10, options: [
      { value: 0, label: "No limit" }, 3,5,10,15,21,42,63,126] },
    { id: "backLead", label: "Back to TQQQ at lead ≤ (%)", tip: "At or above the ceiling means no band: back on the first close under the ceiling.", default: 80, options: [
      -20,0,10,20,30,40,50,60,70,75,80,85,90,95,100,110,120,130,140,150,160,180,200,250] },
    { section: "Floor — sell the breakdown" },
    { id: "floorLead", label: "Sell at lead under (%)", tip: "A close with TQQQ's lead under this sells TQQQ; negative means TQQQ is behind QQQ.", default: 10, options: [
      { value: -9999, label: "Off" }, -70,-60,-50,-40,-30,-25,-20,-15,-10,-5,0,5,10,15,20,25,30] },
    { id: "floorHold", label: "Held after the break", tip: "What is held while the floor is broken.", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" } ] },
    { id: "floorDays", label: "SQQQ for at most (days)", tip: "After this many days SQQQ is sold to cash, which waits for the re-entry.", default: 0, options: [
      { value: 0, label: "No limit" }, 3,5,10,15,21,42,63] },
    { id: "reentryLead", label: "Back at lead ≥ (%)", tip: "TQQQ is bought again after the closes in a row below at or above this lead.", default: 30, options: [
      -70,-60,-50,-40,-30,-20,-10,0,5,10,15,20,25,30,35,40,45,50,60,70,80] },
    { id: "reentryCloses", label: "Closes in a row", tip: "How many closes in a row at or above the re-entry lead buy TQQQ again.", default: 3, options: [1,2,3,5,7,10] },
    { id: "deepLead", label: "Deep buy at lead ≤ (%)", tip: "While the floor is broken, a close this far behind or worse buys TQQQ, held until the ceiling.", default: -30, options: [
      { value: -9999, label: "Off" }, -85,-80,-75,-70,-65,-60,-55,-50,-45,-40,-35,-30,-25,-20] },
    { section: "Overextended price — the buy-back strategy's SQQQ line" },
    { id: "overPct", label: "SQQQ above median (%)", tip: "SQQQ while TQQQ closes this far above its own median, back on the first close under.", default: 55, options: [
      { value: 0, label: "Off" }, 30,40,45,50,55,60,70,80] },
    { id: "overWindow", label: "Median window (days)", tip: "How many days of TQQQ closes the median covers.", default: 250, options: [150,200,250,300] },
    { section: "Defence" },
    { id: "sqqqMaxDays", label: "SQQQ at most (days in a row)", tip: "After this many days in a row in SQQQ, hold cash until the rules want something else.", default: 126, options: [
      { value: 0, label: "No limit" }, 5, 10, 15, 20, 30, 42, 63, 100, 126, 252] },
    { id: "sqqqNeedsDown", label: "SQQQ only under the median", tip: "The ceiling and the floor hold SQQQ only while TQQQ closes under its median, cash otherwise. The overextended line is not affected.", type: "bool", default: false, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "sellLine", label: "Cash under median (%)", tip: "Holds cash instead of TQQQ while TQQQ closes this far under its median.", default: 0, options: [
      { value: 0, label: "Off" }, -10, -15, -20, -25, -30, -35, -40, -50] },
    { id: "deepGuard", label: "Deep buy guard (% under its price)", tip: "A deep buy that closes this far under its buy price goes to cash, and buys back once TQQQ closes above its median.", default: 25, options: [
      { value: 0, label: "Off" }, 15, 20, 25, 30, 40, 50] },
    { id: "nfciVeto", label: "Credit veto (NFCI above)", tip: "Cash instead of TQQQ while the Chicago Fed's credit stress index is above this. Each weekly reading is used a week later.", default: 0.4, options: [
      { value: 0, label: "Off" }, 0.2, 0.3, 0.4, 0.5, 0.75, 1] },
    { section: "Execution & costs" },
    { id: "splitDays", label: "One trade per day", tip: "Yes: a switch sells today and buys tomorrow. No: both at one close.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "cashRate", label: "Cash interest (%/yr)", tip: "Yearly rate earned on money held in cash.", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,10,11,12] },
    { id: "tradeCost", label: "Trading cost (%)", tip: "Charged on every buy and sell, as a share of the amount traded.", default: 0.02, options: [
      0,0.01,0.02,0.03,0.04,0.05,0.06,0.08,0.1,0.15,0.2,0.25,0.3,0.4,0.5,0.6,0.75,1] }
  ],
  columns: [
    { key: "leadPct", label: "TQQQ ahead", tip: "How far TQQQ's buy & hold over the lookback is ahead of QQQ's: TQQQ growth ÷ QQQ growth − 1. Negative means behind." },
    { key: "tqqqGrowthPct", label: "TQQQ growth", tip: "TQQQ's buy & hold return over the lookback." },
    { key: "qqqGrowthPct", label: "QQQ growth", tip: "QQQ's buy & hold return over the lookback." },
    { key: "overPct", label: "TQQQ vs median", tip: "How far TQQQ's close sits above (+) or below (−) its own median. Blank when the overextended line is off." },
    { key: "sqqqRun", label: "SQQQ days", tip: "Days in a row the rules have wanted SQQQ. Past the limit the money sits in cash." }
  ],
  run(data, p) {
    const log = [], dates = data.dates, n = dates.length, T = data.tqqq, Q = data.qqq;
    const years = p.lookbackYears || 2.25, L = Math.round(years * 252);
    const top = p.topLead == null ? 90 : +p.topLead, back = p.backLead == null ? 80 : +p.backLead, band = back < top;
    const topOn = top < 9999, topHold = p.topHold || "sqqq", topDays = +p.topDays || 0;
    const floor = p.floorLead == null ? 10 : +p.floorLead, floorOn = floor > -9999, floorHold = p.floorHold || "sqqq", floorDays = +p.floorDays || 0;
    const reentry = p.reentryLead == null ? 30 : +p.reentryLead, closesNeeded = Math.max(1, +p.reentryCloses || 1);
    const deep = p.deepLead == null ? -30 : +p.deepLead, deepOn = floorOn && deep > -9999;
    const over = (+p.overPct || 0) / 100, OW = +p.overWindow || 250;
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    // The lead: TQQQ's growth over the lookback divided by QQQ's, minus 1, in
    // percent — from the last L closes only.
    const lead = new Float64Array(n).fill(NaN), gT = new Float64Array(n).fill(NaN), gQ = new Float64Array(n).fill(NaN);
    for (let i = L; i < n; i++) {
      if (T[i] > 0 && T[i - L] > 0 && Q[i] > 0 && Q[i - L] > 0) {
        gT[i] = T[i] / T[i - L]; gQ[i] = Q[i] / Q[i - L];
        lead[i] = (Math.exp(Math.log(T[i] / T[i - L]) - Math.log(Q[i] / Q[i - L])) - 1) * 100;
      }
    }
    // TQQQ against its own median over the window, today's close included,
    // from the start of the memory window before the entry (when the
    // overextended line or a median defence is on).
    const sqMax = +p.sqqqMaxDays || 0, needsDown = !!p.sqqqNeedsDown, sellLine = (+p.sellLine || 0) / 100;
    const dGuard = (+p.deepGuard || 0) / 100, nfTh = +p.nfciVeto || 0;
    const rel = new Float64Array(n).fill(NaN);
    if (over > 0 || needsDown || sellLine || dGuard) {
      const win = [];
      const lb = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
      for (let i = Math.max(0, p.startIdx - L - OW - 1); i <= p.endIdx; i++) {
        if (T[i] > 0) win.splice(lb(T[i]), 0, T[i]);
        if (i - OW >= 0 && T[i - OW] > 0) { const k = lb(T[i - OW]); if (win[k] === T[i - OW]) win.splice(k, 1); }
        if (win.length >= OW && T[i] > 0) { const c = win.length, med = c % 2 ? win[(c - 1) >> 1] : (win[c / 2 - 1] + win[c / 2]) / 2; rel[i] = T[i] / med - 1; }
      }
    }
    const leadTxt = (x) => x === x ? (x >= 0 ? x.toFixed(0) + "% ahead" : (-x).toFixed(0) + "% behind") : "n/a";
    // State on the lead: "in" (TQQQ), "top" (stepped aside at the ceiling),
    // "brk" (floor broken), "deep" (bought back far behind).
    let state = "in", days = 0, closes = 0, why = "", whyIdx = -1, deepPx = 0, deepPaused = false, releasedAt = -1;
    const advance = (i) => {
      const v = lead[i];
      if (!(v === v)) return;
      const prev = state, now = "TQQQ is " + leadTxt(v);
      if (state === "in") {
        if (topOn && v >= top) { state = "top"; why = now + ", at or past the ceiling (" + top + "%)"; }
        else if (floorOn && v < floor) { state = "brk"; closes = 0; why = now + ", under the floor (" + floor + "%)"; }
      } else if (state === "top") {
        if (floorOn && v < floor) { state = "brk"; closes = 0; why = now + ", under the floor (" + floor + "%)"; }
        else if (band ? v <= back : v < top) { state = "in"; why = now + (band ? ", at or under " + back + "%" : ", under the ceiling (" + top + "%)"); }
      } else if (state === "brk") {
        if (deepOn && v <= deep) { state = "deep"; deepPx = T[i]; deepPaused = false; why = now + ", at or past the deep buy (" + deep + "%)"; }
        else { closes = v >= reentry ? closes + 1 : 0; if (closes >= closesNeeded) { state = "in"; why = closesNeeded + (closesNeeded > 1 ? " closes in a row" : " close") + " at " + reentry + "% or more"; } }
      } else {
        if (topOn && v >= top) { state = "top"; why = now + ", at or past the ceiling (" + top + "%)"; }
        else if (v >= reentry) { state = "in"; why = now + ", back at " + reentry + "% or more"; }
      }
      days = state === prev ? days + 1 : 0;
      if (state !== prev) whyIdx = i;
      // The deep buy guard: a deep buy closing dGuard under its buy price waits in
      // cash until TQQQ closes above its median, then is bought again. 1973, 2000
      // and 2008 each fell another 89-99% after a deep buy; since 2010 a deep buy
      // fell at most 17% further, so the guard has never fired there.
      if (state !== "deep") deepPaused = false;
      else if (dGuard > 0) {
        if (!deepPaused && T[i] < deepPx * (1 - dGuard)) { deepPaused = true; why = "the deep buy guard, TQQQ " + Math.round(dGuard * 100) + "% under its buy price"; whyIdx = i; }
        else if (deepPaused && rel[i] >= 0) { deepPaused = false; deepPx = T[i]; why = "the deep buy guard released, TQQQ back above its median"; whyIdx = i; releasedAt = i; }
      }
    };
    // What the rules want to hold at a close, and which of the chart's panels
    // holds the rule that settles it: the stretch rules on the lead, a line set
    // from the median, or the credit veto.
    const PRICE = "TQQQ price", LEAD = "TQQQ vs QQQ", CREDIT = "Credit stress (NFCI)";
    const decide = (i) => {
      const base = state === "deep" && deepPaused ? "cash" : state === "in" || state === "deep" ? "tqqq"
        : state === "top" ? (topHold === "sqqq" && topDays && days >= topDays ? "cash" : topHold)
        : (floorHold === "sqqq" && floorDays && days >= floorDays ? "cash" : floorHold);
      const overNow = over > 0 && rel[i] === rel[i] && rel[i] > over;
      const downNow = needsDown && !(rel[i] < 0), cashNow = !!sellLine && rel[i] === rel[i] && rel[i] < sellLine;
      const vetoNow = !!nfTh && !!data.nfci && data.nfci[i] > nfTh;
      let w = overNow ? "sqqq" : base;
      // Defences: the ceiling's and floor's SQQQ only in a downtrend, cash far under the median.
      if (w === "sqqq" && !overNow && downNow) w = "cash";
      if (w === "tqqq" && cashNow) w = "cash";
      // The credit veto: never above 0.4 since 2010 (0.31 in April 2020), 5.2 in 1974, 3.1 in 2008.
      if (w === "tqqq" && vetoNow) w = "cash";
      return { w, base, overNow, downNow, cashNow, vetoNow };
    };
    const wantNow = (i) => decide(i).w;
    // SQQQ at most sqMax days in a row, counted on the rules' choice; cash once past it.
    // Before 2010 the floor alone held SQQQ for years while the market rose.
    let sqRun = 0, sqAt = -1;
    const capSq = (i, w) => {
      if (i !== sqAt) { sqRun = w === "sqqq" ? sqRun + 1 : 0; sqAt = i; }
      return w === "sqqq" && sqMax > 0 && sqRun > sqMax ? "cash" : w;
    };
    // The panel a trade at this close is marked in: the rule whose reading
    // changed at it, the stretch rules' state first, then the +55% line, the
    // credit veto and the median defences. The deep buy guard's release is a
    // close above the median; a trade none of them explains, the SQQQ limit,
    // goes with the rule that wanted SQQQ. Once a day, in order.
    let lastDec = null;
    const triggerAt = (i) => {
      const d = decide(i), y = lastDec || d;
      lastDec = d;
      return releasedAt === i ? PRICE : d.base !== y.base ? LEAD : d.overNow !== y.overNow ? PRICE
        : d.vetoNow !== y.vetoNow ? CREDIT : d.downNow !== y.downNow || d.cashNow !== y.cashNow ? PRICE
        : d.overNow ? PRICE : LEAD;
    };
    const lbl = (id) => id === "cash" ? "cash" : id.toUpperCase();
    // Why the money is in cash when the rules' state would hold a fund. Past the
    // SQQQ limit the note names what wanted SQQQ, not the stretch's older reason.
    const capped = () => sqMax > 0 && sqRun > sqMax;
    const capWhy = (i) => "SQQQ held " + sqMax + " days in a row, the most allowed; "
      + (over > 0 && rel[i] > over ? "TQQQ " + (rel[i] * 100).toFixed(0) + "% above its " + OW + "-day median" : state === "brk" ? "the floor is broken" : "stepped aside at the ceiling");
    // A defence that put the money in cash is the whole reason for it.
    const defenceWhy = (i) => capped() ? capWhy(i)
      : state === "deep" && deepPaused ? "the deep buy guard, TQQQ fell " + Math.round(dGuard * 100) + "% under its buy price; back once it closes above its median"
      : nfTh && data.nfci && data.nfci[i] > nfTh && (state === "in" || state === "deep") ? "credit veto, NFCI " + data.nfci[i].toFixed(2) + " above " + nfTh
      : sellLine && rel[i] < sellLine && (state === "in" || state === "deep") ? "TQQQ " + Math.abs(rel[i] * 100).toFixed(0) + "% under its median, past the cash line"
      : needsDown && !(rel[i] < 0) && (state === "top" || state === "brk") ? "TQQQ above its median, so no SQQQ" : "";
    const cashWhy = (i) => defenceWhy(i) ? defenceWhy(i) + "; "
      : state === "top" && topHold === "sqqq" && topDays && days >= topDays ? "SQQQ held for its " + topDays + " days; "
      : state === "brk" && floorHold === "sqqq" && floorDays && days >= floorDays ? "SQQQ held for its " + floorDays + " days; " : "";
    // The rules' levels as TQQQ prices for a day's close: a close past one is
    // the trade it names. A lead threshold x is the close that puts TQQQ x%
    // ahead of QQQ over the lookback.
    const leadLbl = (x) => x >= 0 ? x + "% ahead" : -x + "% behind";
    const atLead = (i, x) => lead[i] === lead[i] ? T[i - L] * (Q[i] / Q[i - L]) * (1 + x / 100) : null;
    // The levels that can fire from the current state, for the Nearest signal
    // card. Each says whether crossing it sells TQQQ or buys it (kind).
    const signalLevels = (i) => {
      const med = rel[i] === rel[i] ? T[i] / (1 + rel[i]) : null, out = [], holdsT = capSq(i, wantNow(i)) === "tqqq";
      const wantsT = (state === "in" || state === "deep") && !deepPaused;
      const add = (label, px, dir, kind, act) => { if (px > 0) out.push({ label, px, dir, kind, act }); };
      if (over > 0 && med) {
        const ln = med * (1 + over), on = T[i] > ln;
        if (on) add("Overextended (+" + Math.round(over * 100) + "%)", ln, "down", wantsT ? "buy" : "", "a close under it ends the SQQQ hold");
        else add("Overextended (+" + Math.round(over * 100) + "%)", ln, "up", holdsT ? "sell" : "", "a close above it holds SQQQ");
      }
      if (topOn && (state === "in" || state === "deep")) add("Ceiling (" + leadLbl(top) + ")", atLead(i, top), "up", holdsT ? "sell" : "", "a close above it steps aside to " + lbl(topHold));
      if (topOn && band && state === "top") add("Back at (" + leadLbl(back) + ")", atLead(i, back), "down", "buy", "a close under it buys TQQQ");
      if (floorOn && state === "in") add("Floor (" + leadLbl(floor) + ")", atLead(i, floor), "down", holdsT ? "sell" : "", "a close under it sells to " + lbl(floorHold));
      if (floorOn && state === "brk") add("Re-entry (" + leadLbl(reentry) + ")", atLead(i, reentry), "up", "buy", closesNeeded + (closesNeeded > 1 ? " closes" : " close") + " above it buy TQQQ");
      if (deepOn && state === "brk") add("Deep buy (" + leadLbl(deep) + ")", atLead(i, deep), "down", "buy", "a close under it buys TQQQ");
      if (dGuard && state === "deep" && !deepPaused) add("Deep buy guard (−" + Math.round(dGuard * 100) + "%)", deepPx * (1 - dGuard), "down", holdsT ? "sell" : "", "a close under it sells to cash");
      if (dGuard && state === "deep" && deepPaused && med) add(OW + "-day median", med, "up", "buy", "a close above it buys the deep buy back");
      if (sellLine && med && (state === "in" || state === "deep")) add("Cash line (" + Math.round(sellLine * 100) + "%)", med * (1 + sellLine), "down", holdsT ? "sell" : "", "a close under it sells to cash");
      return { med, out };
    };
    // A day's chart row for three panels: TQQQ's price with its median and the
    // lines set from the median; the lead with its levels, in percent; NFCI
    // with the credit veto. Each line is on every day its data allows, so none
    // breaks. A rule with two levels draws the one that fires from the current
    // state: the ceiling's back-at lead while stepped aside, the floor's
    // re-entry lead while out after a break, and while a deep buy is held its
    // guard, as the lead at which TQQQ would close that far under the price
    // paid. Each trade then sits where a panel's first line crosses the line
    // that fired it.
    const chartRow = (i) => {
      const med = rel[i] === rel[i] ? T[i] / (1 + rel[i]) : null, led = lead[i] === lead[i];
      const out = state === "brk" || deepPaused, nf = data.nfci ? data.nfci[i] : NaN;
      return {
        assetPrice: T[i] > 0 ? T[i] : null,
        medianPrice: med,
        overLine: over > 0 && med ? med * (1 + over) : null,
        cashLine: sellLine && med ? med * (1 + sellLine) : null,
        ceilingLine: topOn && led ? (state === "top" && band ? back : top) : null,
        floorLine: floorOn && led ? (out ? reentry : floor) : null,
        deepLine: deepOn && led ? (state === "deep" && dGuard && !deepPaused ? (deepPx * (1 - dGuard) / atLead(i, 0) - 1) * 100 : deep) : null,
        nfci: nfTh && isFinite(nf) ? nf : null,
        nfciVeto: nfTh && isFinite(nf) ? nfTh : null
      };
    };
    const reason = (i, w) => over > 0 && rel[i] === rel[i] && rel[i] > over && w === "sqqq"
      ? "TQQQ closed " + (rel[i] * 100).toFixed(0) + "% above its " + OW + "-day median"
      : w === "cash" && defenceWhy(i) ? defenceWhy(i)
      : (w === "cash" ? cashWhy(i) : "") + (why || "TQQQ is " + leadTxt(lead[i])) +
        (whyIdx >= 0 && whyIdx < p.startIdx ? "; that was on " + dates[whyIdx] + ", before the entry" : "");
    // Memory before the entry: the rules run over the lookback window before
    // it, without trading, so the first day holds what the running strategy
    // held. Started blank, an entry on 2020-03-23 read the crash low only as
    // "under the floor" and bought SQQQ (the deep buy had fired on 2020-03-20),
    // then held it while TQQQ nearly tripled.
    for (let i = Math.max(0, p.startIdx - L); i < p.startIdx; i++) { advance(i); capSq(i, wantNow(i)); triggerAt(i); }
    let cash = p.initial, shares = 0, held = "cash";
    let invested = p.initial, pending = false, switchBy = null;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      if (i > p.startIdx) cash *= 1 + dayRate;
      if (p.contributions && p.contributions[dates[i]]) {
        const amt = p.contributions[dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
${SELL_HELD_TO_COVER}
      }
      advance(i);
      const want = capSq(i, wantNow(i));
      const trigger = triggerAt(i);
      let firedBy = null;
      if (pending) {
        // second day of a switch: buy what the rule wants now
        if (want !== "cash" && priceOf(want, i) > 0) {
          const f = cash * cost; shares = (cash - f) / priceOf(want, i); fee += f; cash = 0; held = want;
          action = "buy"; note = "Bought " + lbl(want) + ": second day of the switch; " + reason(i, want);
          firedBy = switchBy;
        }
        pending = false;
      } else if (want !== held) {
        if (held !== "cash") {
          const from = held, gross = shares * priceOf(held, i), f = gross * cost;
          cash += gross - f; fee += f; shares = 0; held = "cash";
          if (want === "cash") { action = "sell"; note = "Sold " + lbl(from) + ": " + reason(i, want); }
          else if (p.splitDays !== false) { pending = true; action = "sell"; note = "Sold " + lbl(from) + ": " + reason(i, want) + "; " + lbl(want) + " is bought tomorrow"; }
          else if (priceOf(want, i) > 0) {
            const f2 = cash * cost; shares = (cash - f2) / priceOf(want, i); fee += f2; cash = 0; held = want;
            action = "switch"; note = "Switched " + lbl(from) + " to " + lbl(want) + ": " + reason(i, want);
          }
        } else if (priceOf(want, i) > 0) {
          const f = cash * cost; shares = (cash - f) / priceOf(want, i); fee += f; cash = 0; held = want;
          action = "buy"; note = "Bought " + lbl(want) + ": " + reason(i, want);
        }
        if (action === "sell" || action === "switch" || action === "buy") firedBy = switchBy = trigger;   // a switch's second day keeps it
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost; shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const hp = priceOf(held, i), holdingsValue = shares * hp;
${WEEKLY_MONTH_END_SNIPPET}
      if (i === p.startIdx) { action = "start"; if (!note) note = "Holding " + lbl(held) + ": " + reason(i, held); }
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || logDay || action !== "hold") {
        log.push({
          date: dates[i], value: holdingsValue + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: holdingsValue,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          leadPct: lead[i] === lead[i] ? lead[i] : null,
          tqqqGrowthPct: gT[i] === gT[i] ? (gT[i] - 1) * 100 : null, qqqGrowthPct: gQ[i] === gQ[i] ? (gQ[i] - 1) * 100 : null,
          overPct: over > 0 && rel[i] === rel[i] ? rel[i] * 100 : null,
          sqqqRun: sqRun > 0 ? sqRun : null,
          ...chartRow(i),
          ...(firedBy ? { firedBy } : {})
        });
      }
    }
    const e = p.endIdx, wantE = capSq(e, wantNow(e)), v = lead[e];
    const cashNow = wantE === "cash" ? cashWhy(e).replace(/; $/, "") : "";
    const pctTxt = (x) => x === x ? (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(0) + "%" : "n/a";
    const zone = { in: "between the floor and the ceiling", top: "stepped aside at the ceiling", brk: "under the floor", deep: "bought back far behind" }[state];
    // The chart's panels (chartRow, the names at decide), each with the rules that read its first line.
    const lines = [{ key: "assetPrice", label: "TQQQ price", group: PRICE }];
    if (over > 0 || needsDown || sellLine || dGuard) lines.push({ key: "medianPrice", label: OW + "-day median", group: PRICE });
    if (over > 0) lines.push({ key: "overLine", label: "Overextended (+" + Math.round(over * 100) + "%)", group: PRICE });
    if (sellLine) lines.push({ key: "cashLine", label: "Cash line (" + Math.round(sellLine * 100) + "%)", group: PRICE });
    lines.push({ key: "leadPct", label: "TQQQ ahead of QQQ", unit: "%", group: LEAD });
    if (topOn) lines.push({ key: "ceilingLine", label: "Ceiling", unit: "%", group: LEAD });
    if (floorOn) lines.push({ key: "floorLine", label: "Floor", unit: "%", group: LEAD });
    if (deepOn) lines.push({ key: "deepLine", label: "Deep buy", unit: "%", group: LEAD });
    if (nfTh) lines.push({ key: "nfci", label: "NFCI", unit: "num", group: CREDIT }, { key: "nfciVeto", label: "Credit veto", unit: "num", group: CREDIT });
    const nearest = signalLevels(e).out.filter(l => l.kind).map(l => ({ ...l, dist: l.px / T[e] - 1 })).sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist))[0];
    const cards = [
      { label: "TQQQ ahead of QQQ", value: v === v ? (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(0) + "%" : "n/a",
        sub: years + "y: TQQQ " + pctTxt(gT[e] - 1) + " vs QQQ " + pctTxt(gQ[e] - 1),
        icon: state === "top" ? "trendUp" : state === "brk" ? "trendDown" : "activity", tone: wantE === "tqqq" ? "good" : "bad",
        tip: "How far TQQQ's buy & hold over the lookback is ahead of QQQ's." },
      { label: "Holding", value: lbl(wantE), sub: cashNow || zone, icon: "shield", tone: wantE === "tqqq" ? "good" : "bad",
        tip: "What the rules hold today and which zone of the lead they are in." },
      { label: "Levels", value: (floorOn ? floor + "%" : "—") + " / " + (topOn ? top + "%" : "—"), sub: "floor · ceiling", icon: "flag",
        tip: "The leads that sell TQQQ: the floor below, the ceiling above." }
    ];
    if (over > 0) cards.push({ label: "TQQQ vs median", value: rel[e] === rel[e] ? pctTxt(rel[e]) : "n/a", sub: "SQQQ above +" + (over * 100).toFixed(0) + "%",
      icon: "flag", tone: rel[e] > over ? "bad" : "good", tip: "How far TQQQ's close sits above its own " + OW + "-day median." });
    if (nearest) cards.push({ label: "Nearest signal", value: nearest.label.replace(/ \\(.*$/, "") + " " + pctTxt(nearest.dist),
      sub: nearest.act + ", at " + nearest.px.toFixed(2), icon: nearest.dir === "up" ? "trendUp" : "trendDown",
      tip: "The signal line closest to today's close, how far TQQQ has to move to reach it, and what a close past it does." });
    return {
      log: log, lines: lines,
      signals: {
        cards: cards,
        decision: {
          action: wantE === "tqqq" ? "Hold TQQQ" : wantE === "cash" ? "Stay in cash" : "Hold " + lbl(wantE),
          note: (over > 0 && rel[e] > over ? "TQQQ is " + pctTxt(rel[e]) + " against its " + OW + "-day median; " : "") +
            "over " + years + " years TQQQ is " + leadTxt(v) + " of QQQ today, " + zone + (cashNow ? "; " + cashNow : ""),
          tone: wantE === "tqqq" ? "good" : "bad",
          reasons: [{ name: "Stretch", val: leadTxt(v), tag: state + " · " + lbl(wantE), lean: wantE === "tqqq" ? "buy" : wantE === "cash" ? "cash" : "out" }]
        }
      }
    };
  }
}`;

// #48-#50 — NFCI veto, buy-back and TQQQ vs QQQ stretch, each trading
// Turnaround Monday in its idle cash (2026-10-29, the user's request after
// the combination study, scratchpad r5/combo-sim.cjs and combo-cagr.cjs).
// The rule is the user's custom "Turnaround Monday" code (the r/TQQQ
// "Turnaround Tuesday" post): buy at a Monday close under the prior close,
// sell at the first close above the prior close. The data has closes only,
// so the prior close stands in for the prior day's high.
//
// Each entry is its base strategy's own text with these additions, made at
// load, so a change to the base reaches the combination too:
//   - the Turnaround Monday settings before Execution & costs, and a column;
//   - the rule run on the signal fund every day, before the main loop;
//   - a hook on the line where the base decides what to hold: while the base
//     wants cash, an open Turnaround Monday trade holds the fund instead, and
//     the trade ends at the rule's exit or as soon as the base wants anything
//     else. A trade starts at a Monday close on money in cash, or on the fund
//     the rules are selling at that close, which is then kept (a "keep" row
//     says so); money in another fund would need a two-day switch, so it waits;
//   - the trade note, the log column, and on the dashboard a Turnaround
//     Monday card and today's call while a trade is open.
// Every insertion point must appear exactly once in the base text; a base
// edited so that one moves fails here at load instead of running half-wired.
function withTurnaroundMonday(base, spec) {
  // Its chart panels: the rule's own, and NFCI for its pause (the base's when it has one).
  const panel = JSON.stringify("Turnaround Monday"), creditPanel = JSON.stringify(spec.creditPanel || "Credit stress (NFCI)");
  const once = (text, find, repl, what) => {
    const at = text.indexOf(find);
    if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`withTurnaroundMonday(${spec.name}): ${what} must appear exactly once in the base`);
    return text.slice(0, at) + repl + text.slice(at + find.length);
  };
  const params = `    { section: "Turnaround Monday — trade the idle cash" },
    { id: "tmOn", label: "Trade down Mondays while in cash", tip: "While the rules above hold cash, buy at a Monday close under the prior close and sell at the first close above the prior close.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "tmSignal", label: "Monday signal read on", tip: "The fund whose closes decide when a trade starts and ends.", default: "${spec.signal}", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "tmFund", label: "Fund bought", tip: "What a trade holds, paid for with the idle cash.", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" }, { value: "sso", label: "SSO" } ] },
    { id: "tmNfci", label: "No trades while NFCI above", tip: "No Monday trades while the Chicago Fed's credit stress index is above this, and an open one is sold.", default: 0, options: [
      { value: 0, label: "Off" }, 0.4, 0.75, 1] },
`;
  const setup = `    // Turnaround Monday on the signal fund, run every day on its own. A trade
    // it opens at a Monday close while the rules want cash buys the fund; it
    // ends at the rule's exit or as soon as the rules want anything else.
    const tmOn = p.tmOn !== false, tmFund = data[p.tmFund] ? p.tmFund : "tqqq";
    const tmSig = data[p.tmSignal] ? p.tmSignal : "tqqq", tmSigName = tmSig.toUpperCase();
    const tmIn = new Uint8Array(p.endIdx + 1);   // 1 = the rule is in a trade at that close
    for (let i = p.startIdx, inT = false; i <= p.endIdx; i++) {
      const c = data[tmSig][i], prev = i > 0 ? data[tmSig][i - 1] : 0;
      const wd = ((Math.floor(Date.parse(data.dates[i]) / 86400000) + 4) % 7 + 7) % 7;   // 1 = Monday (1970-01-01 was a Thursday)
      if (c > 0 && prev > 0) { if (inT) { if (c > prev) inT = false; } else if (wd === 1 && c < prev) inT = true; }
      tmIn[i] = inT ? 1 : 0;
    }
    let tmActive = false, tmSince = "", tmWhy = "", tmKept = false, tmPauseSale = false;
    const tmStress = (i) => !!(+p.tmNfci && data.nfci && data.nfci[i] > +p.tmNfci);
    // What to hold today: the rules' choice, or the fund while a trade opened in their cash is open.
    // A trade starts at the Monday close on money in cash, or on the fund the rules are selling
    // that close (kept instead of sold); money in another fund would need a two-day switch.
    const tmHold = (i, want) => {
      tmWhy = ""; tmKept = false; tmPauseSale = false;
      // Credit stress can pause it (tmNfci, Off by default, the user's call on
      // 2026-10-30). NFCI has not been above 0.4 since 2010, so 2010-2025 is the
      // same either way. Before that, trading through it won in 2007-09 (+373%
      // over the pause for #50) and lost in 1973-75 (-76%) and 1978-83 (-71%):
      // 18.2%/yr from 1953 against 20.2% paused (scratchpad r7/tm-pause-check.cjs).
      if (!tmOn || want !== "cash" || tmStress(i)) { if (tmActive && tmStress(i)) { tmWhy = "Turnaround Monday paused, NFCI " + data.nfci[i].toFixed(2) + " above " + p.tmNfci; tmPauseSale = true; } tmActive = false; return want; }
      if (tmActive && !tmIn[i]) { tmActive = false; tmWhy = "Turnaround Monday exit, " + tmSigName + " closed above the prior close"; }
      else if (!tmActive && (held === "cash" || held === tmFund) && tmIn[i] && !(i > p.startIdx && tmIn[i - 1])) {
        tmActive = true; tmSince = data.dates[i]; tmKept = held === tmFund;
        tmWhy = tmKept ? "Kept " + tmFund.toUpperCase() + ": the rules sold, but " + tmSigName + " closed a Monday under the prior close; held to the first close above it"
          : "Turnaround Monday, " + tmSigName + " closed a Monday under the prior close";
      }
      return tmActive ? tmFund : "cash";
    };
    // The chart panel a trade at this close is marked in: the rules' own (t),
    // Turnaround Monday's for a Monday trade, NFCI's for a sale on credit stress.
    const TM_PANEL = ${panel}, TM_CREDIT = ${creditPanel}, tmPauseOn = !!(+p.tmNfci && data.nfci);
    const tmPanel = (t) => !tmWhy ? t : tmPauseSale ? TM_CREDIT : TM_PANEL;
`;
  const dashboard = `    // Turnaround Monday on the dashboard: its card, and today's call while a trade is open.
    const last = res.log[res.log.length - 1] || {};
    const tmF = (data[p.tmFund] ? p.tmFund : "tqqq").toUpperCase(), tmS = (data[p.tmSignal] ? p.tmSignal : "tqqq").toUpperCase();
    const tmOpen = p.tmOn !== false && !!last.tmTrade, tmIdle = last.held === "CASH";
    const nfE = data.nfci ? data.nfci[p.endIdx] : NaN, tmPausedNow = !!(+p.tmNfci && nfE > +p.tmNfci);
    // Its chart panel, and the pause beside the base's NFCI: on the veto's line
    // when the levels agree, a line of its own when they do not, or in a panel
    // of its own when the base has no NFCI. The base's lines name their panel
    // now that there are several.
    if (p.tmOn !== false) {
      const lines = res.lines || [], first = lines.length ? lines[0].label : "";
      for (const l of lines) if (!l.group) l.group = first;
      // Panels stack from the most trades to the fewest, so the Monday panel
      // goes second: since 2010 its trades fall between the base's main panel
      // and the rest (#50: price 186, Monday 146, lead 104, NFCI none;
      // scratchpad r7/panel-trades.cjs).
      const afterFirst = lines.findIndex(l => l.group !== lines[0].group);
      lines.splice(afterFirst < 0 ? lines.length : afterFirst, 0, { key: "tmChange", label: tmS + " vs prior close", unit: "%", group: ${panel} }, { key: "tmPrior", label: "Prior close", unit: "%", group: ${panel} });
      if (+p.tmNfci && data.nfci) {
        const veto = lines.find(l => l.key === "nfciVeto"), vetoAt = (res.log.find(r => r.nfciVeto != null) || {}).nfciVeto;
        if (lines.some(l => l.key === "nfci") && veto && vetoAt === +p.tmNfci) veto.label += ", Monday pause";
        else if (lines.some(l => l.key === "nfci")) lines.push({ key: "tmPause", label: "Monday pause", unit: "num", group: ${creditPanel} });
        else lines.push({ key: "tmNfciRead", label: "NFCI", unit: "num", group: ${creditPanel} }, { key: "tmPause", label: "Monday pause", unit: "num", group: ${creditPanel} });
      }
      res.lines = lines;
    }
    if (res.signals) {
      res.signals.cards = (res.signals.cards || []).concat([{ label: "Turnaround Monday", icon: "clock", tone: tmOpen ? "good" : "",
        value: p.tmOn === false ? "Off" : tmOpen ? "In a trade" : tmPausedNow ? "Paused" : tmIdle ? "Waiting" : "Idle",
        sub: tmOpen ? tmF + " since " + last.tmTrade + ", sells at the first close above the prior close" : tmPausedNow ? "credit stress, NFCI " + nfE.toFixed(2) + " above " + p.tmNfci
          : tmIdle ? "buys " + tmF + " at a Monday close under the prior close" : "the rules hold " + last.held,
        tip: "Trades the idle cash: buys " + tmF + " when " + tmS + " closes a Monday under the prior close, sells at the first close above it." }]);
      if (tmOpen && res.signals.decision) {
        const d = res.signals.decision;
        res.signals.decision = { action: "Hold " + tmF, note: "Turnaround Monday trade since " + last.tmTrade + "; the rules themselves are in cash", tone: "good",
          reasons: (d.reasons || []).concat([{ name: "Turnaround Monday", val: "open since " + last.tmTrade, tag: "in · " + tmF, lean: "buy" }]) };
      }
    }
`;
  let t = base.replace(/^(\s*name:\s*)"[^"]+"/m, (m, pre) => `${pre}"${spec.name}"`);
  t = once(t, '    { section: "Execution & costs" },', params + '    { section: "Execution & costs" },', 'the Execution & costs section');
  t = once(t, '  columns: [\n', '  columns: [\n    { key: "tmTrade", label: "Monday trade", tip: "The day an open Turnaround Monday trade was bought. Blank when none is open." },\n', 'the columns list');
  t = once(t, '  run(data, p) {\n', '  run(data, p) {\n    const res = (function (data, p) {\n', 'run(data, p)');
  t = once(t, '    for (let i = p.startIdx; i <= p.endIdx; i++) {', setup + '    for (let i = p.startIdx; i <= p.endIdx; i++) {', 'the main loop');
  // On every row: the signal fund against the prior close, in percent, with the
  // prior close at 0% (a Monday under it buys, the first close over it sells),
  // NFCI and the pause level, and a Monday trade's panel.
  t = once(t, '        log.push({\n', '        log.push({\n          tmTrade: tmActive ? tmSince : null,\n'
    + '          tmChange: tmOn && i > 0 && data[tmSig][i - 1] > 0 ? (data[tmSig][i] / data[tmSig][i - 1] - 1) * 100 : null,\n'
    + '          tmPrior: tmOn && i > 0 && data[tmSig][i - 1] > 0 ? 0 : null,\n'
    + '          tmNfciRead: tmPauseOn && isFinite(data.nfci[i]) ? data.nfci[i] : null,\n'
    + '          tmPause: tmPauseOn && isFinite(data.nfci[i]) ? +p.tmNfci : null,\n'
    + '          ...(tmWhy ? { firedBy: tmPanel(null) } : {}),\n', 'the log row');
  t = once(t, '      if (i === p.endIdx) action = "end";\n', '      if (tmKept) { if (action === "hold") action = "keep"; note = note ? note + "; " + tmWhy : tmWhy; }   // a sale the Monday trade held off\n      if (i === p.endIdx) action = "end";\n', 'the end-of-run action');
  for (const [find, repl, what] of spec.hooks) t = once(t, find, repl, what);
  if (!t.endsWith('\n  }\n}')) throw new Error(`withTurnaroundMonday(${spec.name}): the base must end with its run method`);
  return t.slice(0, -'\n  }\n}'.length) + '\n    })(data, p);\n' + dashboard + '    return res;\n  }\n}';
}
CODE[48] = withTurnaroundMonday(CODE[44], { name: "NFCI veto + Turnaround Monday", signal: "tqqq", creditPanel: "Credit stress (NFCI)", hooks: [
  ['        if (vetoOn) want = "cash";\n', '        if (vetoOn) want = "cash";\n        want = tmHold(i, want);\n', 'the credit-veto line'],
  ['note = vetoOn ? "NFCI "', 'note = tmWhy ? tmWhy : vetoOn ? "NFCI "', 'the trade note'],
  ['fired = vetoMoved && (vetoOn || !nfAbove) ? CREDIT : null;', 'fired = tmPanel(vetoMoved && (vetoOn || !nfAbove) ? CREDIT : null);', 'the trade panel'] ] });
CODE[49] = withTurnaroundMonday(CODE[45], { name: "Buy-back + Turnaround Monday", signal: "spy", hooks: [
  ['          : (_frac > 0 ? p.asset : crashAsset);\n', '          : (_frac > 0 ? p.asset : crashAsset);\n        want = tmHold(i, want);\n        if (tmActive) _frac = 1;\n        if (tmWhy && !why) why = tmWhy;\n', 'the holding decision'] ] });
CODE[50] = withTurnaroundMonday(CODE[47], { name: "TQQQ vs QQQ + Turnaround Monday", signal: "tqqq", creditPanel: "Credit stress (NFCI)", hooks: [
  ['      const want = capSq(i, wantNow(i));', '      const want = tmHold(i, capSq(i, wantNow(i)));', 'the holding decision'],
  ['      const trigger = triggerAt(i);', '      const trigger = tmPanel(triggerAt(i));', 'the trade panel'],
  ['const reason = (i, w) => ', 'const reason = (i, w) => tmWhy ? tmWhy : ', 'the trade reason'] ] });

// Browser global + Node export.
if (typeof window !== 'undefined') window.STRATEGY_CODE = CODE;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CODE;
  // Reachable from tests without becoming a strategy key.
  Object.defineProperty(module.exports, 'upgradeWithdrawalHandling', { value: upgradeWithdrawalHandling });
  Object.defineProperty(module.exports, 'upgradeDailyDisplay', { value: upgradeDailyDisplay });
  Object.defineProperty(module.exports, 'upgradeSavedCode', { value: upgradeSavedCode });
  Object.defineProperty(module.exports, 'libraryEntryOf', { value: libraryEntryOf });
  Object.defineProperty(module.exports, 'codeFingerprint', { value: codeFingerprint });
}
