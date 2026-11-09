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

// The last day's action: "end" when nothing else happened that day, else its
// own word, so a trade on the data's latest day stays a trade and the charts
// mark it as the action to take at that close (js/signal-chart.js).
// withTurnaroundMonday finds the line by this text.
const END_ROW_ACTION = `      if (i === p.endIdx && action === "hold") action = "end";`;

// The trading day after row i, for a rule that fires on a calendar month's or
// week's last trading day: the next row, or past the data's end the next
// weekday. So the data's latest day counts as a period end only when it is
// one, and a trade logged there is one to make at that close. When that
// weekday is a holiday, the true last day fires once the next row exists.
const NEXT_DATE_SNIPPET = `    const nextDate = (i) => {
      if (i + 1 < data.dates.length) return data.dates[i + 1];
      const d = new Date(data.dates[i] + "T00:00:00Z");
      do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      return d.toISOString().slice(0, 10);
    };`;

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
const STAT_PARAM_SNIPPET = `{ id: "stat", label: "Center line", text: "Use the {} for the line.", options: [{ value: "sma", label: "Moving average" }, { value: "median", label: "Median" }], default: "sma" }`;
const STAT_PARAM_MEDIAN_SNIPPET = `{ id: "stat", label: "Center line", text: "Use the {} for the line.", options: [{ value: "median", label: "Median" }, { value: "sma", label: "Moving average" }], default: "median" }`;

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
  params: [{ id: "window", label: "Window (days)", text: "Hold TQQQ while QQQ ends the month above its line over the last {} days.", options:
      [5].concat(Array.from({ length: 18 }, (_, k) => 10 + 10 * k), Array.from({ length: 40 }, (_, k) => 181 + k), Array.from({ length: 12 }, (_, k) => 230 + 10 * k), Array.from({ length: 96 }, (_, k) => 342 + k), [440, 450], Array.from({ length: 31 }, (_, k) => 454 + k), [490, 500], Array.from({ length: 40 }, (_, k) => 505 + 5 * k), Array.from({ length: 12 }, (_, k) => 725 + 25 * k)), default: 530 },
           ${STAT_PARAM_MEDIAN_SNIPPET}],
  columns: [{ key: "assetPrice", label: "QQQ", tip: "QQQ's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "QQQ's average or median close over the window (the Center line setting). Checked only on the month end." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.qqq, lev = data.tqqq;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
${NEXT_DATE_SNIPPET}
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
      // (nextDate), whatever cadence the log is kept at. Until 2026-10 it keyed
      // off the logging flag and so traded weekly whenever the chart window was
      // under ten years; until 2026-11 it also fired on the run's last day.
      const monthEnd = nextDate(i).slice(0, 7) !== month;
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
  params: [{ id: "window", label: "Window (days)", text: "Hold SPXL while SPY closes above its line over the last {} days.", options:
      [5].concat(Array.from({ length: 18 }, (_, k) => 10 + 10 * k), Array.from({ length: 40 }, (_, k) => 181 + k), [230, 240, 250], Array.from({ length: 81 }, (_, k) => 257 + k), Array.from({ length: 17 }, (_, k) => 340 + 10 * k)), default: 295 },
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
  params: [{ id: "window", label: "Window (days)", text: "Hold SSO while SPY closes above its line over the last {} days.", options:
      [5].concat(Array.from({ length: 18 }, (_, k) => 10 + 10 * k), Array.from({ length: 40 }, (_, k) => 181 + k), [230, 240, 250], Array.from({ length: 81 }, (_, k) => 257 + k), Array.from({ length: 17 }, (_, k) => 340 + 10 * k)), default: 295 },
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
  params: [{ id: "band", label: "Band (% around line)", text: "Buy TQQQ when SPY closes {} above its line, and sell when it closes that far below.", unit: "%", options:
      Array.from({ length: 101 }, (_, k) => +(0.1 * k).toFixed(1)), default: 3.5 },
           { id: "window", label: "Window", text: "The line covers the last {} days.", options:
      [5].concat(Array.from({ length: 7 }, (_, k) => 10 + 10 * k), Array.from({ length: 31 }, (_, k) => 74 + k), [110, 120], Array.from({ length: 24 }, (_, k) => 125 + k), Array.from({ length: 82 }, (_, k) => 149 + k), [240], Array.from({ length: 31 }, (_, k) => 246 + k), Array.from({ length: 23 }, (_, k) => 280 + 10 * k)), default: 145 },
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

// #10 Canonical QQQ 200SMA → TQQQ else cash.
CODE[10] = `{
  name: "QQQ 200-day SMA → TQQQ else cash",
  params: [{ id: "signal", label: "Signal asset", text: "Watch {} against its line.", options: [{ value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }], default: "qqq" },
           { id: "lev", label: "Leveraged ETF", text: "Hold {} while it is above the line, and cash while it is below.", options: [{ value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "sso", label: "SSO" }, { value: "spxl", label: "SPXL" }], default: "tqqq" },
           { id: "window", label: "Window (days)", text: "The line covers the last {} days.", options:
      [5].concat(Array.from({ length: 11 }, (_, k) => 10 + 10 * k), Array.from({ length: 108 }, (_, k) => 113 + k), Array.from({ length: 31 }, (_, k) => 226 + k), Array.from({ length: 25 }, (_, k) => 260 + 10 * k)), default: 160 },
           ${STAT_PARAM_MEDIAN_SNIPPET}],
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

// #12 SSO own-price 200SMA → SSO else cash.
CODE[12] = `{
  name: "SSO own 200SMA → SSO/cash (2×)",
  params: [{ id: "window", label: "Window", text: "Hold SSO while it closes above its own line over the last {} days.", options:
      [5].concat(Array.from({ length: 18 }, (_, k) => 10 + 10 * k), Array.from({ length: 44 }, (_, k) => 181 + k), [230, 240], Array.from({ length: 31 }, (_, k) => 250 + k), Array.from({ length: 7 }, (_, k) => 290 + 10 * k), Array.from({ length: 81 }, (_, k) => 357 + k), Array.from({ length: 7 }, (_, k) => 440 + 10 * k)), default: 400 },
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
  params: [{ id: "entry", label: "Enter band (% above)", text: "Hold TQQQ once SPY closes {} above its line.", unit: "%", options:
      Array.from({ length: 101 }, (_, k) => +(0.1 * k).toFixed(1)), default: 3 },
           { id: "exit", label: "Exit band (% below)", text: "Switch to QQQ once SPY closes {} below it.", unit: "%", options:
      Array.from({ length: 101 }, (_, k) => +(0.1 * k).toFixed(1)), default: 5.5 },
           { id: "window", label: "Window", text: "The line covers the last {} days.", options:
      [5].concat(Array.from({ length: 31 }, (_, k) => 6 + k), Array.from({ length: 8 }, (_, k) => 40 + 10 * k), Array.from({ length: 104 }, (_, k) => 117 + k), Array.from({ length: 28 }, (_, k) => 230 + 10 * k)), default: 15 },
           ${STAT_PARAM_MEDIAN_SNIPPET}],
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
  params: [{ id: "rsiMax", label: "Max RSI(14) to hold", text: "Hold TQQQ while QQQ is above its line and QQQ's RSI(14) is under {}.", options:
      Array.from({ length: 101 }, (_, k) => +(50 + 0.5 * k).toFixed(1)), default: 75 },
           { id: "window", label: "Window", text: "The line covers the last {} days.", options:
      [5].concat(Array.from({ length: 11 }, (_, k) => 10 + 10 * k), Array.from({ length: 108 }, (_, k) => 113 + k), Array.from({ length: 31 }, (_, k) => 226 + k), Array.from({ length: 25 }, (_, k) => 260 + 10 * k)), default: 160 },
           ${STAT_PARAM_MEDIAN_SNIPPET}],
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
  params: [{ id: "trail", label: "Trailing stop (% from peak)", text: "Sell on a trailing stop {} under TQQQ's high since the buy.", unit: "%", options:
      [{ value: 0, label: "Off" }].concat(Array.from({ length: 111 }, (_, k) => +(5 + 0.5 * k).toFixed(1))), default: 15 }],
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
  params: [{ id: "window", label: "Window (days)", text: "Hold TQQQ while QQQ's weekly close is above its line over the last {} days.", options:
      [5].concat(Array.from({ length: 16 }, (_, k) => 10 + 10 * k), Array.from({ length: 55 }, (_, k) => 166 + k), Array.from({ length: 8 }, (_, k) => 230 + 10 * k), Array.from({ length: 31 }, (_, k) => 306 + k), Array.from({ length: 12 }, (_, k) => 340 + 10 * k), Array.from({ length: 44 }, (_, k) => 457 + k)), default: 495 },
           ${STAT_PARAM_MEDIAN_SNIPPET}],
  columns: [{ key: "assetPrice", label: "QQQ", tip: "QQQ's close: the price the rule compares with the center line." },
             { key: "center", label: "Center", tip: "QQQ's average or median close over the window (the Center line setting). Checked only on the week end." }],
  run(data, p) {
    const log = [], W = p.window, sig = data.qqq, lev = data.tqqq;
${CENTER_LINE_SNIPPET}
    let cash = p.initial, sh = 0, invested = false, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4));
    const lineName = W + "-day " + (useMed ? "median" : "average");
    const dow = (ds) => new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10))).getUTCDay();
${NEXT_DATE_SNIPPET}
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
      const weekEnd = dow(nextDate(i)) <= dow(data.dates[i]);   // the week's last trading day (nextDate)
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
  params: [{ id: "fast", label: "Fast window", text: "Hold TQQQ while QQQ's fast line, over {} days, is above its slow line.", options:
      Array.from({ length: 146 }, (_, k) => 5 + k), default: 75 },
           { id: "slow", label: "Slow window", text: "The slow line covers the last {} days.", options:
      Array.from({ length: 14 }, (_, k) => 50 + 10 * k).concat(Array.from({ length: 40 }, (_, k) => 181 + k), Array.from({ length: 8 }, (_, k) => 230 + 10 * k), Array.from({ length: 100 }, (_, k) => 301 + k)), default: 335 },
           { id: "stat", label: "Center line", text: "Use the {} for both lines.", options: [{ value: "sma", label: "Moving average" }, { value: "median", label: "Median" }], default: "median" }],
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
    return { log, lines: [{ key: "assetPrice", label: "QQQ price" }, { key: "fastLine", label: F + "-day " + stat }, { key: "slowLine", label: S + "-day " + stat }] };
  }
}`;

// #20 Volatility targeting: hold TQQQ scaled so trailing vol ≈ target; rest cash. Rebalance monthly.
CODE[20] = `{
  name: "Vol-target TQQQ (scale to target vol)",
  params: [{ id: "target", label: "Target vol (%/yr)", text: "Size TQQQ so the holding swings about {} a year.", unit: "%", options:
      Array.from({ length: 111 }, (_, k) => +(5 + 0.5 * k).toFixed(1)).concat(Array.from({ length: 40 }, (_, k) => 61 + k)), default: 65 },
           { id: "lookback", label: "Vol lookback (days)", text: "Measure the swings over the last {} days.", options:
      Array.from({ length: 246 }, (_, k) => 5 + k), default: 10 }],
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
    return { log, lines: [{ key: "share", label: "TQQQ share", unit: "%" }, { key: "vol", label: L + "-day volatility", unit: "%", priceKey: "price" },
      { key: "target", label: "Target (" + p.target + "%)", unit: "%" }] };
  }
}`;

// #22 Connors RSI(2) dip-buy within a 200-SMA uptrend.
CODE[22] = `{
  name: "Connors RSI(2) dip-buy (200SMA trend)",
  params: [{ id: "buy", label: "Buy RSI(2) below", text: "Buy TQQQ when QQQ's RSI(2) drops under {} while QQQ is above its 200-day line.", options:
      Array.from({ length: 100 }, (_, k) => +(0.5 + 0.5 * k).toFixed(1)), default: 20 },
           { id: "sell", label: "Sell RSI(2) above", text: "Sell when RSI(2) rises over {}, or when QQQ closes under the line.", options:
      Array.from({ length: 120 }, (_, k) => +(40 + 0.5 * k).toFixed(1)), default: 95 },
           ${STAT_PARAM_MEDIAN_SNIPPET}],
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
  params: [{ id: "oh", label: "Overheat exit RSI(10) ≥", text: "Sell TQQQ when QQQ's RSI(10) reaches {}, even above the line.", options:
      Array.from({ length: 100 }, (_, k) => +(50 + 0.5 * k).toFixed(1)).concat([{ value: 100, label: "Off" }]), default: 85 },
           { id: "cool", label: "Cool-gate re-entry RSI(10) <", text: "Then buy back only once RSI(10) is under {}.", options:
      Array.from({ length: 160 }, (_, k) => +(20 + 0.5 * k).toFixed(1)).concat([{ value: 100, label: "Off" }]), default: 60 },
           ${STAT_PARAM_MEDIAN_SNIPPET}],
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
  params: [{ id: "delev", label: "Delever→QQQ at (% above line)", text: "Switch TQQQ to QQQ when QQQ closes {} above its line.", unit: "%", options:
      [{ value: 0, label: "Off" }].concat(Array.from({ length: 151 }, (_, k) => +(5 + 0.5 * k).toFixed(1))), default: 8.5 },
           { id: "gtfo", label: "Sell→cash at (% above line)", text: "Sell everything to cash when it closes {} above it.", unit: "%", options:
      [{ value: 0, label: "Off" }].concat(Array.from({ length: 181 }, (_, k) => +(10 + 0.5 * k).toFixed(1))), default: 15 },
           { id: "window", label: "Window", text: "Below the line, hold cash. The line covers the last {} days.", options:
      [5].concat(Array.from({ length: 11 }, (_, k) => 10 + 10 * k), Array.from({ length: 108 }, (_, k) => 113 + k), Array.from({ length: 31 }, (_, k) => 226 + k), Array.from({ length: 20 }, (_, k) => 260 + 10 * k), Array.from({ length: 30 }, (_, k) => 451 + k), [490, 500]), default: 160 },
           ${STAT_PARAM_MEDIAN_SNIPPET}],
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
  params: [{ id: "signal", label: "Signal / park", text: "Watch {} against its line, and hold it while it is below.", options: [{ value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }], default: "qqq" },
           { id: "lev", label: "Leveraged ETF", text: "Hold {} while it is above.", options: [{ value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "sso", label: "SSO" }, { value: "spxl", label: "SPXL" }], default: "tqqq" },
           { id: "window", label: "Window", text: "The line covers the last {} days.", options:
      Array.from({ length: 32 }, (_, k) => 5 + k).concat(Array.from({ length: 8 }, (_, k) => 40 + 10 * k), Array.from({ length: 108 }, (_, k) => 113 + k), Array.from({ length: 31 }, (_, k) => 226 + k), Array.from({ length: 25 }, (_, k) => 260 + 10 * k)), default: 160 },
           ${STAT_PARAM_MEDIAN_SNIPPET}],
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
    { id: "asset", label: "Fund traded", text: "Hold {} as the main fund.", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" },
      { value: "spxl", label: "SPXL" }, { value: "sso", label: "SSO" },
      { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "park", label: "Held when out", text: "Hold {} while it is overextended.", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" },
      { value: "qld", label: "QLD" } ] },
    { id: "threshold", label: "Sell when above line (%)", text: "It is overextended when it closes {} above its line.", unit: "%", default: 55, options:
      Array.from({ length: 191 }, (_, k) => 10 + k) },
    ${STAT_PARAM_MEDIAN_SNIPPET},
    { id: "window", label: "Window (days)", text: "The line covers the last {} days.", default: 250, options:
      [5].concat(Array.from({ length: 20 }, (_, k) => 10 + 10 * k), Array.from({ length: 82 }, (_, k) => 209 + k), Array.from({ length: 21 }, (_, k) => 300 + 10 * k)) },
    { id: "cashRate", fit: false, label: "Cash interest (%/yr)", text: "Cash earns {} a year.", unit: "%", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", fit: false, label: "Trading cost (%)", text: "Each buy and sell costs {} of the amount traded.", unit: "%", default: 0.02, options: [
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
${END_ROW_ACTION}
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

// Books for the library strategies that hold a mix of funds at once (#7,
// #14): shares per fund plus cash, moved toward target weights at a close.
// Shared SOURCE like the snippets above, interpolated into each run() so the
// executed text stays self-contained. It carries WITHDRAWAL_RULE's text, so
// upgradeWithdrawalHandling leaves these strategies alone.
const MIX_BOOKS_SNIPPET = `    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    const sh = {}, holdings = [];
    let cash = p.initial, invested = p.initial, feesPaid = 0;
    const worth = (i) => Object.keys(sh).reduce((s, f) => s + sh[f] * priceOf(f, i), cash);
    const heldText = () => Object.keys(sh).filter(f => sh[f] > 0).map(f => f.toUpperCase()).join("+") || "CASH";
    const names = (funds) => funds.map(f => f.toUpperCase()).join("+");
    // The fund worth the most today, for the row's price.
    const mainFund = (i) => Object.keys(sh).filter(f => sh[f] > 0).sort((a, b) => sh[b] * priceOf(b, i) - sh[a] * priceOf(a, i))[0] || null;
    // A target is { fund: weight }, and what the weights leave over is cash.
    // moveTo reaches it at today's close: it sells what sits above its weight,
    // then buys what sits under. With one trade per day, a day that sold buys
    // nothing, and the buys wait for the next close (waiting, queued). That
    // next close only buys (buysOnly): prices have moved overnight, and
    // selling again would push the buys back another day.
    function moveTo(target, i, oneTradePerDay, buysOnly) {
      const total = worth(i), sold = [], bought = [];
      let fee = 0;
      if (!buysOnly) for (const f of Object.keys(sh)) {
        const px = priceOf(f, i), keep = (target[f] || 0) * total, over = sh[f] * px - keep;
        if (px > 0 && sh[f] > 0 && over > total * 1e-9) {
          const charge = over * cost;
          sh[f] = keep > 0 ? sh[f] - over / px : 0; cash += over - charge; fee += charge; sold.push(f);
        }
      }
      const total2 = worth(i);
      const under = (f) => target[f] * total2 - (sh[f] || 0) * priceOf(f, i);
      const queued = Object.keys(target).filter(f => target[f] > 0 && priceOf(f, i) > 0 && under(f) > total2 * 1e-9);
      const waiting = !!oneTradePerDay && sold.length > 0 && queued.length > 0;
      if (!waiting) for (const f of queued) {
        const spend = Math.min(cash, under(f));
        if (spend > 0) { const charge = spend * cost; sh[f] = (sh[f] || 0) + (spend - charge) / priceOf(f, i); cash -= spend; fee += charge; bought.push(f); }
      }
      feesPaid += fee;
      return { sold: sold, bought: bought, fee: fee, waiting: waiting, queued: waiting ? queued : [] };
    }
    // New money on a day without a trade goes in by the target's weights.
    function deploy(amt, target, i) {
      let fee = 0;
      for (const f of Object.keys(target)) {
        const px = priceOf(f, i), spend = Math.min(cash, amt * target[f]);
        if (px > 0 && spend > 0) { const charge = spend * cost; sh[f] = (sh[f] || 0) + (spend - charge) / px; cash -= spend; fee += charge; }
      }
      feesPaid += fee;
      return fee;
    }
    // ${WITHDRAWAL_RULE}
    // Every fund held is sold in the same proportion.
    function cover(i) {
      const held = Object.keys(sh).reduce((s, f) => s + sh[f] * priceOf(f, i), 0);
      const frac = held > 0 ? Math.min(1, -cash / (held * (1 - cost))) : 0;
      let fee = 0;
      for (const f of Object.keys(sh)) {
        const gross = sh[f] * frac * priceOf(f, i);
        if (gross > 0) { fee += gross * cost; cash += gross * (1 - cost); sh[f] = frac >= 1 ? 0 : sh[f] * (1 - frac); }
      }
      if (cash < 0) cash = 0;
      feesPaid += fee;
      return fee;
    }
    // The verb for what moved today. A day that only sold while its buys wait
    // is the first leg of a switch.
    const verbOf = (mv) => mv.sold.length && mv.bought.length ? "switch" : mv.bought.length ? "buy" : "sell";`;

// The three settings every mixed-fund strategy ends with. Their values are
// costs and execution, not rules, so Fit leaves them alone (fit: false).
const mixCostParams = (cashTip) => `{ id: "splitDays", fit: false, label: "One trade per day", text: "Spread each switch over two days, selling at one close and buying at the next: {}.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ],
      tip: "Yes waits a day between the sale and the purchase. No does both at the same close." },
    { id: "cashRate", fit: false, label: "Cash interest (%/yr)", text: "Cash earns {} a year.", unit: "%", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8],
      tip: "${cashTip}" },
    { id: "tradeCost", fit: false, label: "Trading cost (%)", text: "Each buy and sell costs {} of the amount traded.", unit: "%", default: 0.02, options: [
      0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1],
      tip: "Charged on every sale and purchase." }`;

// #7 Antonacci dual momentum, leveraged: at each month end, the stronger of
// SPY and QQQ over 12 months; if it beat cash over the same months, hold its
// 3× fund (SPXL or TQQQ), else cash. Cash stands in for T-bills, at the cash
// interest setting, which is also the return to beat.
CODE[7] = `{
  name: "Antonacci dual momentum — SPY vs QQQ → SPXL/TQQQ or cash",
  params: [
    { id: "lookback", label: "Lookback (days)", text: "At each month end, compare SPY's and QQQ's returns over the last {} trading days.", default: 430, options:
      Array.from({ length: 21 }, (_, k) => 21 + 5 * k).concat(Array.from({ length: 253 }, (_, k) => 126 + k), Array.from({ length: 101 }, (_, k) => 380 + k), Array.from({ length: 6 }, (_, k) => 484 + 4 * k)),
      tip: "252 trading days is 12 months, the length Antonacci uses." },
    { id: "spFund", label: "When SPY leads", text: "If SPY did better, hold {}.", default: "spy", options: [
      { value: "spxl", label: "SPXL" }, { value: "sso", label: "SSO" }, { value: "spy", label: "SPY" } ],
      tip: "The fund held while SPY has the higher return." },
    { id: "nqFund", label: "When QQQ leads", text: "If QQQ did better, hold {}.", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "qqq", label: "QQQ" } ],
      tip: "The fund held while QQQ has the higher return." },
    { id: "park", label: "Held when out", text: "When the better one earned less than cash, hold {} instead.", default: "gld", options: [
      { value: "cash", label: "cash" }, { value: "gld", label: "GLD" } ],
      tip: "Cash earns the cash interest, standing in for T-bills." },
    ${mixCostParams("What cash earns, as T-bills would. It is also the return the better fund must beat.")}
  ],
  columns: [
    { key: "spyRet", label: "SPY return", tip: "SPY's return over the lookback, in %." },
    { key: "qqqRet", label: "QQQ return", tip: "QQQ's return over the lookback, in %." },
    { key: "hurdleRet", label: "Cash return", tip: "What cash earned over the same days at the cash interest, in %: the return to beat." }
  ],
  run(data, p) {
    const log = [], L = +p.lookback || 252;
${MIX_BOOKS_SNIPPET}
${NEXT_DATE_SNIPPET}
    const hurdle = Math.pow(1 + (p.cashRate || 0) / 100, L / 252) - 1;
    const span = L === 252 ? "12-month" : L + "-day";
    const ret = (arr, i) => i - L >= 0 && arr[i - L] > 0 && arr[i] > 0 ? arr[i] / arr[i - L] - 1 : NaN;
    const pct = (x) => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(1) + "%";
    const isMonthEnd = (i) => nextDate(i).slice(0, 7) !== data.dates[i].slice(0, 7);
    // The month-end decision: the leader, and its fund or the park.
    const decide = (i) => {
      const s = ret(data.spy, i), q = ret(data.qqq, i);
      if (!(s === s && q === q)) return null;
      const lead = q > s ? "QQQ" : "SPY", r = Math.max(s, q);
      const fund = r > hurdle ? (lead === "QQQ" ? p.nqFund : p.spFund) : p.park;
      const reason = r > hurdle
        ? lead + " led over " + span + ", " + pct(r) + " vs " + (lead === "QQQ" ? "SPY " + pct(s) : "QQQ " + pct(q)) + ", above cash's " + pct(hurdle)
        : lead + " led over " + span + " with " + pct(r) + ", under cash's " + pct(hurdle);
      return { fund: fund, why: reason, date: data.dates[i] };
    };
    // The last month end before the Entry decides what the Entry holds.
    let pick = null;
    for (let j = p.startIdx - 1; j >= 0; j--) if (isMonthEnd(j)) { pick = decide(j); break; }
    let applied = null, waiting = false, pendingKey = null, why = pick ? "month end " + pick.date + " (before the Entry): " + pick.why : "";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
        if (cash < 0) { const was = heldText(); fee += cover(i); note = "withdrawal — sold " + was; }
      }
      if (isMonthEnd(i)) {
        const d = decide(i);
        if (d && (!pick || d.fund !== pick.fund)) why = "month end: " + d.why;
        if (d) pick = d;
      }
      const fund = pick ? pick.fund : p.park, target = fund === "cash" ? {} : { [fund]: 1 }, key = JSON.stringify(target);
      if (key !== applied || waiting) {
        const first = applied === null, mv = moveTo(target, i, p.splitDays, waiting && key === pendingKey);
        fee += mv.fee; waiting = mv.waiting; pendingKey = waiting ? key : null;
        if (!waiting) applied = key;
        if (mv.sold.length || mv.bought.length) {
          action = first ? "start" : verbOf(mv);
          const moved = (mv.sold.length ? "Sold " + names(mv.sold) : "") + (mv.sold.length && mv.bought.length ? ", bought " : mv.bought.length ? "Bought " : "") + (mv.bought.length ? names(mv.bought) : "");
          note = moved + ": " + why + (mv.waiting ? "; buys " + names(mv.queued) + " at the next close" : "");
        }
      } else if (contributed > 0) fee += deploy(contributed, target, i);
      holdings.push({ date: data.dates[i], h: Object.assign({}, sh), cash: cash });
${WEEKLY_MONTH_END_SNIPPET}
${END_ROW_ACTION}
      if (contributed !== 0 || logDay || action !== "hold") {
        const value = worth(i), main = mainFund(i), s = ret(data.spy, i), q = ret(data.qqq, i);
        log.push({ date: data.dates[i], value: value, action: action, note: note, held: heldText(),
          price: main ? priceOf(main, i) : 0, holdingsValue: value - cash, cash: cash, contributed: contributed,
          invested: invested, fee: fee, feesPaid: feesPaid,
          ...(s === s ? { spyRet: s * 100 } : {}), ...(q === q ? { qqqRet: q * 100 } : {}), hurdleRet: hurdle * 100,
          // The close that puts each fund's return on the hurdle: the return lines name it in brackets.
          spyHurdlePx: i - L >= 0 && data.spy[i - L] > 0 ? data.spy[i - L] * (1 + hurdle) : null, qqqHurdlePx: i - L >= 0 && data.qqq[i - L] > 0 ? data.qqq[i - L] * (1 + hurdle) : null });
      }
    }
    return { log, holdings, lines: [
      { key: "spyRet", label: "SPY " + span + " return", unit: "%", priceKey: "spyHurdlePx" },
      { key: "qqqRet", label: "QQQ " + span + " return", unit: "%", priceKey: "qqqHurdlePx" },
      { key: "hurdleRet", label: "Cash over the same days", unit: "%" }] };
  }
}`;

// #14 Three-phase (a TradingView script, 3PH): SPY's +4% and −3% bands around
// its 200-day SMA. Phase one holds TQQQ; after 366 days held, phase two holds
// 50% QLD + 50% gold; under the lower band, defensive holds 50% cash + 50%
// gold until the upper band buys TQQQ again. GLD stands in for GLDM, cash at
// the cash interest for SGOV.
CODE[14] = `{
  name: "Three-phase SPY 200SMA +4/-3 → TQQQ, QLD + gold, cash + gold",
  params: [
    { id: "entry", label: "Buy band (% above)", text: "Buy TQQQ once SPY closes {} above its line.", unit: "%", default: 0.5, options:
      Array.from({ length: 101 }, (_, k) => +(0.1 * k).toFixed(1)),
      tip: "How far above its line SPY must close. Between the two bands nothing changes." },
    { id: "exit", label: "Defensive band (% below)", text: "Go defensive once SPY closes {} under it.", unit: "%", default: 7.5, options:
      Array.from({ length: 101 }, (_, k) => +(0.1 * k).toFixed(1)),
      tip: "How far under its line SPY must close." },
    { id: "window", label: "Window", text: "The line covers the last {} days.", default: 10, options:
      [5].concat(Array.from({ length: 11 }, (_, k) => 10 + 10 * k), Array.from({ length: 104 }, (_, k) => 117 + k), Array.from({ length: 28 }, (_, k) => 230 + 10 * k)),
      tip: "Trading days in SPY's line." },
    ${STAT_PARAM_MEDIAN_SNIPPET},
    { id: "holdDays", label: "Phase two after (days)", text: "After holding TQQQ {} days, move to phase two.", default: 640, options:
      Array.from({ length: 68 }, (_, k) => 30 + 5 * k).concat([366], Array.from({ length: 146 }, (_, k) => 370 + 5 * k)),
      tip: "Calendar days since TQQQ was bought. 366 makes the gain long-term for US taxes." },
    { id: "fund2", label: "Phase two fund", text: "Phase two holds {} as its stock part.", default: "qld", options: [
      { value: "qld", label: "QLD" }, { value: "tqqq", label: "TQQQ" }, { value: "qqq", label: "QQQ" } ],
      tip: "The stock part of phase two." },
    { id: "gold2", label: "Phase two gold (%)", text: "Phase two keeps {} in gold.", unit: "%", default: 100, options:
      Array.from({ length: 101 }, (_, k) => k),
      tip: "The share of phase two in GLD." },
    { id: "gold3", label: "Defensive gold (%)", text: "Defensive keeps {} in gold and the rest in cash.", unit: "%", default: 100, options:
      Array.from({ length: 101 }, (_, k) => k),
      tip: "The share of the defensive phase in GLD." },
    ${mixCostParams("What the cash part earns, as SGOV would.")}
  ],
  columns: [
    { key: "assetPrice", label: "SPY", tip: "SPY's close: the price the bands are read on." },
    { key: "center", label: "Center", tip: "SPY's average or median close over the window (the Center line setting)." },
    { key: "buyLine", label: "Buy line", tip: "Where SPY must close to buy TQQQ: the center plus the buy band." },
    { key: "defenseLine", label: "Defensive line", tip: "Where SPY must close to go defensive: the center minus the defensive band." },
    { key: "heldDays", label: "Days held", tip: "Calendar days since TQQQ was bought, in phase one." }
  ],
  run(data, p) {
    const log = [], W = p.window, sig = data.spy, up = 1 + p.entry / 100, dn = 1 - p.exit / 100;
${CENTER_LINE_SNIPPET}
${MIX_BOOKS_SNIPPET}
    const lineName = W + "-day " + (useMed ? "median" : "average");
    const fund2 = p.fund2 || "qld", g2 = (+p.gold2 || 0) / 100, g3 = (+p.gold3 || 0) / 100;
    const daysSince = (i, d0) => Math.round((Date.parse(data.dates[i]) - Date.parse(d0)) / 86400000);
    const weights = (w) => Object.fromEntries(Object.entries(w).filter(([, x]) => x > 0));
    const targetOf = (ph) => ph === "one" ? { tqqq: 1 } : ph === "two" ? weights({ [fund2]: 1 - g2, gld: g2 }) : weights({ gld: g3 });
    const PHASE = { one: "phase one", two: "phase two", defense: "defensive" };
    // The phase and TQQQ's clock: the bands' state carries from the first day
    // SPY has a full window, replayed without trading up to the Entry.
    let phase = "defense", since = null;
    const step = (i, c) => {
      const s = sig[i];
      if (!(c > 0 && s > 0)) return "";
      if (phase === "defense" && s >= c * up) { phase = "one"; since = data.dates[i]; return "SPY closed " + p.entry + "% above its " + lineName; }
      if (phase !== "defense" && s <= c * dn) { phase = "defense"; since = null; return "SPY closed " + p.exit + "% under its " + lineName; }
      if (phase === "one" && daysSince(i, since) >= p.holdDays) { phase = "two"; return "TQQQ held " + p.holdDays + " days"; }
      return "";
    };
    // The median line as a sorted window that takes one close in and one out
    // per day: centerLine's median without re-sorting the window every day,
    // which the replay from the first full window made slow. Days arrive in
    // order (the replay, then the run), so the window only moves forward.
    const win = [];
    let winTo = -1;
    const lb = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
    const lineAt = (i) => {
      if (!useMed) return centerLine(sig, W, i, false);
      for (let k = winTo < 0 ? Math.max(0, i - W + 1) : winTo + 1; k <= i; k++) {
        if (sig[k] > 0) win.splice(lb(sig[k]), 0, sig[k]);
        const out = k - W;
        if (winTo >= 0 && out >= 0 && sig[out] > 0) win.splice(lb(sig[out]), 1);
      }
      winTo = i;
      const n = win.length;
      return !n ? 0 : n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2;
    };
    for (let i = Math.max(0, W - 1); i < p.startIdx; i++) step(i, lineAt(i));
    let applied = null, waiting = false, pendingKey = null;
    let why = PHASE[phase] + (since ? " since " + since : "") + " (before the Entry)";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
      if (p.contributions && p.contributions[data.dates[i]]) {
        const amt = p.contributions[data.dates[i]];
        cash += amt; contributed = amt; invested += amt; action = "contribution";
        if (cash < 0) { const was = heldText(); fee += cover(i); note = "withdrawal — sold " + was; }
      }
      const c = lineAt(i), changed = step(i, c);
      if (changed) why = changed + ", " + PHASE[phase];
      const target = targetOf(phase), key = JSON.stringify(target);
      if (key !== applied || waiting) {
        const first = applied === null, mv = moveTo(target, i, p.splitDays, waiting && key === pendingKey);
        fee += mv.fee; waiting = mv.waiting; pendingKey = waiting ? key : null;
        if (!waiting) applied = key;
        if (mv.sold.length || mv.bought.length) {
          action = first ? "start" : verbOf(mv);
          const moved = (mv.sold.length ? "Sold " + names(mv.sold) : "") + (mv.sold.length && mv.bought.length ? ", bought " : mv.bought.length ? "Bought " : "") + (mv.bought.length ? names(mv.bought) : "");
          note = moved + ": " + why + (mv.waiting ? "; buys " + names(mv.queued) + " at the next close" : "");
        }
      } else if (contributed > 0) fee += deploy(contributed, target, i);
      holdings.push({ date: data.dates[i], h: Object.assign({}, sh), cash: cash });
${WEEKLY_MONTH_END_SNIPPET}
${END_ROW_ACTION}
      if (contributed !== 0 || logDay || action !== "hold") {
        const value = worth(i), main = mainFund(i);
        log.push({ date: data.dates[i], value: value, action: action, note: note, held: heldText(),
          price: main ? priceOf(main, i) : 0, holdingsValue: value - cash, cash: cash, contributed: contributed,
          invested: invested, fee: fee, feesPaid: feesPaid, assetPrice: sig[i], center: c, buyLine: c * up, defenseLine: c * dn,
          ...(phase === "one" && since ? { heldDays: daysSince(i, since) } : {}) });
      }
    }
    return { log, holdings, lines: [{ key: "assetPrice", label: "SPY price" }, { key: "center", label: lineName },
      { key: "buyLine", label: "Buy TQQQ (+" + p.entry + "%)" }, { key: "defenseLine", label: "Defensive (−" + p.exit + "%)" }] };
  }
}`;

// #39 Overheat exit (hand-picked): sell when the SIGNAL fund (SSO by default)
// closes >20% above its 150-day SMA, hold otherwise. Like #26 it only exits on
// strength, so it has no downside rule and rides every crash to the bottom.
CODE[39] = `{
  name: "Overheat exit (sell when stretched)",
  params: [
    { id: "asset", label: "Fund traded", text: "Hold {} as the main fund.", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" },
      { value: "spxl", label: "SPXL" }, { value: "sso", label: "SSO" },
      { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "signal", label: "Signal read from", text: "Read the signal from {}.", default: "sso", options: [
      { value: "sso", label: "SSO" }, { value: "spy", label: "SPY" },
      { value: "qqq", label: "QQQ" }, { value: "tqqq", label: "TQQQ" } ] },
    ${STAT_PARAM_SNIPPET},
    { id: "window", label: "Window (days)", text: "The line covers the last {} days.", default: 150, options:
      [5].concat(Array.from({ length: 11 }, (_, k) => 10 + 10 * k), Array.from({ length: 81 }, (_, k) => 117 + k), [200, 210], Array.from({ length: 31 }, (_, k) => 218 + k), Array.from({ length: 26 }, (_, k) => 250 + 10 * k)) },
    { id: "stretch", label: "Sell when above line (%)", text: "Sell when the signal closes {} above its line.", unit: "%", default: 20, options:
      Array.from({ length: 117 }, (_, k) => +(2 + 0.5 * k).toFixed(1)) },
    { id: "park", label: "Held when out", text: "Then hold {} until it is back under.", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" } ] },
    { id: "cashRate", fit: false, label: "Cash interest (%/yr)", text: "Cash earns {} a year.", unit: "%", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", fit: false, label: "Trading cost (%)", text: "Each buy and sell costs {} of the amount traded.", unit: "%", default: 0.02, options: [
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
${END_ROW_ACTION}
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
    { id: "asset", label: "Fund traded", text: "Hold {} as the main fund.", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "park", label: "Held when out", text: "Switch to {} when it runs far above its line.", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    ${STAT_PARAM_MEDIAN_SNIPPET},
    { id: "window", label: "Window (days)", text: "The line covers the last {} days.", default: 250, options:
      [5].concat(Array.from({ length: 7 }, (_, k) => 10 + 10 * k), [75], Array.from({ length: 10 }, (_, k) => 80 + 10 * k), [175, 180, 190, 200], Array.from({ length: 82 }, (_, k) => 209 + k), Array.from({ length: 21 }, (_, k) => 300 + 10 * k)) },
    { id: "overPct", label: "Exit when above line (%)", text: "Far above means a close {} above the line, and it switches back on the first close under it.", unit: "%", default: 55, options:
      [2].concat(Array.from({ length: 6 }, (_, k) => 5 + 5 * k), Array.from({ length: 82 }, (_, k) => +(34.5 + 0.5 * k).toFixed(1)), Array.from({ length: 45 }, (_, k) => 80 + 5 * k)) },
    // type:"bool" is required — without it the sandbox coerces the pick to the
    // STRING "false", which is truthy, and the toggle silently does nothing.
    { id: "splitDays", fit: false, label: "One trade per day", text: "Spread each switch over two days, selling at one close and buying at the next: {}.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "cashRate", fit: false, label: "Cash interest (%/yr)", text: "Cash earns {} a year.", unit: "%", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", fit: false, label: "Trading cost (%)", text: "Each buy and sell costs {} of the amount traded.", unit: "%", default: 0.02, options: [
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
${END_ROW_ACTION}
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
    { id: "asset", label: "Fund traded", text: "Hold {} as the main fund.", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "stat", label: "Center line", text: "Compare its close with its {}.", default: "median", options: [
      { value: "median", label: "Median" }, { value: "sma", label: "Moving average" },
      { value: "rsi", label: "RSI (vs its 50 midline)" } ] },
    { id: "window", label: "Window (days)", text: "The line covers the last {} days.", default: 250, options:
      [5, 7, 10, 14].concat(Array.from({ length: 6 }, (_, k) => 20 + 10 * k), [75], Array.from({ length: 10 }, (_, k) => 80 + 10 * k), [175, 180, 190, 200], Array.from({ length: 82 }, (_, k) => 209 + k), Array.from({ length: 21 }, (_, k) => 300 + 10 * k)) },
    { section: "Overextended — sell the melt-up" },
    { id: "overPct", label: "Above line (%)", text: "Switch out when it closes {} above the line.", unit: "%", default: 55, options:
      [2, 4, 5].concat(Array.from({ length: 4 }, (_, k) => 6 + 2 * k), [15, 18, 20, 22, 25, 28, 30, 32], Array.from({ length: 82 }, (_, k) => +(34.5 + 0.5 * k).toFixed(1)), Array.from({ length: 45 }, (_, k) => 80 + 5 * k)) },
    { id: "park", label: "Then hold", text: "Then hold {} until it closes back under the line.", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    { section: "Crash signal — the exit measures against this" },
    { id: "crashStat", label: "Center line", text: "The crash exit measures against {}.", default: "same", options: [
      { value: "same", label: "Same as main" }, { value: "median", label: "Median" },
      { value: "sma", label: "Moving average" }, { value: "rsi", label: "RSI (vs its 50 midline)" } ] },
    { id: "crashWindow", label: "Window (days)", text: "That line covers {}.", unit: " days", default: 0, options:
      [{ value: 0, label: "Same as main" }].concat(Array.from({ length: 28 }, (_, k) => 5 + k), Array.from({ length: 4 }, (_, k) => 40 + 10 * k), [75], Array.from({ length: 10 }, (_, k) => 80 + 10 * k), [175], Array.from({ length: 4 }, (_, k) => 180 + 10 * k), Array.from({ length: 96 }, (_, k) => 217 + k), Array.from({ length: 19 }, (_, k) => 320 + 10 * k)) },
    { section: "Crash exit — leave when it breaks down" },
    { id: "exitPct", label: "Below line (%)", text: "Sell on the first close under a level {} from that line.", unit: "%", default: -28, options:
      Array.from({ length: 201 }, (_, k) => +(20 - 0.5 * k).toFixed(1)) },
    { id: "crashAsset", label: "Then hold", text: "Then hold {} until the price recovers above that level.", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "sqqq", label: "SQQQ" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" },
      { value: "tqqq", label: "TQQQ" }, { value: "spxl", label: "SPXL" } ] },
    { id: "slopeGate", label: "Only if line slope below (%/yr)", text: "Only while the line rises less than {} a year.", unit: "%", default: 20, options:
      [{ value: 999, label: "Off" }].concat(Array.from({ length: 201 }, (_, k) => -50 + k)) },
    { id: "belowGate", label: "Only after days below line", text: "And only after {} closes in a row under the line.", default: 10, options:
      [{ value: 0, label: "Off" }].concat(Array.from({ length: 100 }, (_, k) => 1 + k)) },
    { section: "Execution & costs" },
    { id: "splitDays", fit: false, label: "One trade per day", text: "Spread each switch over two days, selling at one close and buying at the next: {}.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "cashRate", fit: false, label: "Cash interest (%/yr)", text: "Cash earns {} a year.", unit: "%", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,10,11,12] },
    { id: "tradeCost", fit: false, label: "Trading cost (%)", text: "Each buy and sell costs {} of the amount traded.", unit: "%", default: 0.02, options: [
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
${END_ROW_ACTION}
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
    { id: "asset", label: "Fund traded", text: "Hold {} as the main fund.", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "stat", label: "Center line", text: "Compare its close with its {}.", default: "median", options: [
      { value: "median", label: "Median" }, { value: "sma", label: "Moving average" },
      { value: "rsi", label: "RSI (vs its 50 midline)" } ] },
    { id: "window", label: "Window (days)", text: "The line covers the last {} days.", default: 250, options:
      [5, 7, 10, 14].concat(Array.from({ length: 6 }, (_, k) => 20 + 10 * k), [75], Array.from({ length: 10 }, (_, k) => 80 + 10 * k), [175, 180, 190, 200], Array.from({ length: 82 }, (_, k) => 209 + k), Array.from({ length: 21 }, (_, k) => 300 + 10 * k)) },
    { section: "Overextended — sell the melt-up" },
    { id: "overPct", label: "Above line (%)", text: "Switch out when it closes {} above the line.", unit: "%", default: 55, options:
      [2, 4, 5].concat(Array.from({ length: 4 }, (_, k) => 6 + 2 * k), [15, 18, 20, 22, 25, 28, 30, 32], Array.from({ length: 82 }, (_, k) => +(34.5 + 0.5 * k).toFixed(1)), Array.from({ length: 45 }, (_, k) => 80 + 5 * k)) },
    { id: "park", label: "Then hold", text: "Then hold {} until it closes back under the line.", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    { section: "Crash signal — the exit measures against this" },
    { id: "crashStat", label: "Center line", text: "The crash exit measures against {}.", default: "same", options: [
      { value: "same", label: "Same as main" }, { value: "median", label: "Median" },
      { value: "sma", label: "Moving average" }, { value: "rsi", label: "RSI (vs its 50 midline)" } ] },
    { id: "crashWindow", label: "Window (days)", text: "That line covers {}.", unit: " days", default: 0, options:
      [{ value: 0, label: "Same as main" }].concat(Array.from({ length: 28 }, (_, k) => 5 + k), Array.from({ length: 4 }, (_, k) => 40 + 10 * k), [75], Array.from({ length: 10 }, (_, k) => 80 + 10 * k), [175], Array.from({ length: 4 }, (_, k) => 180 + 10 * k), Array.from({ length: 96 }, (_, k) => 217 + k), Array.from({ length: 19 }, (_, k) => 320 + 10 * k)) },
    { section: "Crash exit — leave when it breaks down" },
    { id: "exitPct", label: "Below line (%)", text: "Sell on the first close under a level {} from that line.", unit: "%", default: -28, options:
      Array.from({ length: 201 }, (_, k) => +(20 - 0.5 * k).toFixed(1)) },
    { id: "crashAsset", label: "Then hold", text: "Then hold {} until the price recovers above that level.", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "sqqq", label: "SQQQ" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" },
      { value: "tqqq", label: "TQQQ" }, { value: "spxl", label: "SPXL" } ] },
    { id: "slopeGate", label: "Only if line slope below (%/yr)", text: "Only while the line rises less than {} a year.", unit: "%", default: 20, options:
      [{ value: 999, label: "Off" }].concat(Array.from({ length: 201 }, (_, k) => -50 + k)) },
    { id: "belowGate", label: "Only after days below line", text: "And only after {} closes in a row under the line.", default: 10, options:
      [{ value: 0, label: "Off" }].concat(Array.from({ length: 100 }, (_, k) => 1 + k)) },
    { section: "Credit veto — NFCI (Chicago Fed)" },
    { id: "nfciTh", label: "Go to cash when NFCI above", text: "Go to cash while the NFCI is above {}.", default: 0.4, options:
      [{ value: 999, label: "Off" }].concat(Array.from({ length: 101 }, (_, k) => +(0.02 * k).toFixed(2))) },
    { id: "vetoEnd", label: "Veto lifts when", text: "The veto lifts when {}.", default: "cycle", options: [
      { value: "cycle", label: "NFCI calms OR a crash exit→recovery completes" },
      { value: "nfci", label: "NFCI calms only" } ] },
    { section: "Execution & costs" },
    { id: "splitDays", fit: false, label: "One trade per day", text: "Spread each switch over two days, selling at one close and buying at the next: {}.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "cashRate", fit: false, label: "Cash interest (%/yr)", text: "Cash earns {} a year.", unit: "%", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,10,11,12] },
    { id: "tradeCost", fit: false, label: "Trading cost (%)", text: "Each buy and sell costs {} of the amount traded.", unit: "%", default: 0.02, options: [
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
${END_ROW_ACTION}
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
    { id: "asset", label: "Fund traded", tip: "The fund held whenever the strategy is in the market.", text: "Hold {} as the main fund.", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "stat", label: "Center line", tip: "What the price is compared to. A median is not pulled by spikes; a moving average is.", text: "Compare its close with its {}.", default: "median", options: [
      { value: "median", label: "Median" }, { value: "sma", label: "Moving average" },
      { value: "rsi", label: "RSI (vs its 50 midline)" } ] },
    { id: "window", label: "Window (days)", tip: "Trading days the center line covers. Longer is smoother and slower.", text: "The line covers the last {} days.", default: 250, options:
      [5, 7, 10, 14].concat(Array.from({ length: 6 }, (_, k) => 20 + 10 * k), [75], Array.from({ length: 10 }, (_, k) => 80 + 10 * k), [175, 180, 190, 200], Array.from({ length: 82 }, (_, k) => 209 + k), Array.from({ length: 21 }, (_, k) => 300 + 10 * k)) },
    { section: "Overextended — sell the melt-up" },
    { id: "overPct", label: "Above line (%)", tip: "Switch to the fund below when the price closes this far above the center line, and back on the first close under it.", text: "Switch out when it closes {} above the line.", unit: "%", default: 55, options:
      [2, 4, 5].concat(Array.from({ length: 4 }, (_, k) => 6 + 2 * k), [15, 18, 20, 22, 25, 28, 30, 32], Array.from({ length: 82 }, (_, k) => +(34.5 + 0.5 * k).toFixed(1)), Array.from({ length: 45 }, (_, k) => 80 + 5 * k)) },
    { id: "park", label: "Then hold", tip: "What to hold until the price closes back under that line.", text: "Then hold {} until it closes back under the line.", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    { section: "Sell line — leave when it breaks down" },
    { id: "exitPct", label: "Level vs center line (%)", tip: "Sell on the first close under this level. Negative is below the center line, positive above it.", text: "Sell on the first close under a level {} from the line.", unit: "%", default: 10, options:
      Array.from({ length: 201 }, (_, k) => +(20 - 0.5 * k).toFixed(1)) },
    { id: "crashAsset", label: "Then hold", tip: "What to hold after selling, until the strategy buys back.", text: "Then hold {} until it buys back.", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "sqqq", label: "SQQQ" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" },
      { value: "tqqq", label: "TQQQ" }, { value: "spxl", label: "SPXL" } ] },
    { id: "confirmDays", label: "Buy back after closes above line", tip: "Closes in a row above the line before buying back. Selling needs one.", text: "Buy back after {} closes in a row above the line.", default: 4, options:
      Array.from({ length: 100 }, (_, k) => 1 + k) },
    { id: "dipReentry", label: "Re-enter a correction", tip: "How far the price must climb from its low toward the center line before buying back. 0% waits for the sell line.", text: "In a correction, buy back {} of the way from its low.", unit: "%", default: 50, options:
      Array.from({ length: 101 }, (_, k) => k) },
    { section: "Buy-back line — after a crash, re-enter here instead of waiting for the sell line; it sells again below it" },
    { id: "bbPct", label: "Below line (%)", tip: "How far under the center line counts as a crash.", text: "A crash is a close {} from the line.", unit: "%", default: -32, options:
      [{ value: 999, label: "Off" }].concat(Array.from({ length: 141 }, (_, k) => +(-80 + 0.5 * k).toFixed(1))) },
    { id: "bbSlice", label: "Buy a slice at the line right away", tip: "Bought at the first close under the line. The rest waits for the closes above it. 0% buys nothing there.", text: "At the first close under it, buy back with {} of the money.", unit: "%", default: 100, options:
      Array.from({ length: 101 }, (_, k) => k) },
    { id: "sliceStop", label: "Slice stop (% under its price)", tip: "Sells the slice if the price falls this far below its buy price.", text: "Sell that slice if it falls {} under its price.", unit: "%", default: 20, options:
      Array.from({ length: 111 }, (_, k) => +(5 + 0.5 * k).toFixed(1)) },
    { id: "sliceCap", label: "Slices per sold-out stint", tip: "Slices allowed before the strategy is fully back in.", text: "Slices allowed per sold-out stint: {}.", default: 1, options:
      Array.from({ length: 100 }, (_, k) => 1 + k).concat([{ value: 999, label: "No limit" }]) },
    { section: "Execution & costs" },
    { id: "splitDays", fit: false, label: "One trade per day", tip: "Yes: a switch sells today and buys tomorrow. No: both at one close.", text: "Spread each switch over two days, selling at one close and buying at the next: {}.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "cashRate", fit: false, label: "Cash interest (%/yr)", tip: "Yearly rate earned on money held in cash.", text: "Cash earns {} a year.", unit: "%", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,10,11,12] },
    { id: "tradeCost", fit: false, label: "Trading cost (%)", tip: "Charged on every buy and sell, as a share of the amount traded.", text: "Each buy and sell costs {} of the amount traded.", unit: "%", default: 0.02, options: [
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
    const dipText = Math.round(dipF * 100) + "% of the way back";
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
${END_ROW_ACTION}
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
// fit, +187.5%. On 2026-10-30 the percent settings went to 1% steps and a
// coordinate search from those defaults moved the ceiling 90 -> 92 and the
// re-entry 30 -> 23 (the middle of a 22-24 plateau): 138.2% a year, 2010-17
// 90.3% (was 92.4), 2018-25 198.1% (was 188.9), drawdown and 2026 unchanged
// (scratchpad r8/fit1pct.cjs). The SQQQ limit came after the first fit: run on the reconstructed prices
// from 1953 the rules made 4.4% a year and lost 99.999% before 2010, mostly
// in SQQQ under the floor (3,694 days) and over the line (1,616 days) while
// the market rose. The user wants nothing lost from 2010, where the longest
// SQQQ run is 95 days, so the default limit is 126 days: identical from 2010
// (135.8%), 8.6% a year from 1953 instead of 4.4%. 20 days is the best count
// over the full history (14.9%) but costs 8 points from 2010 (scratchpad
// r5/defence-grid.cjs). Two median defences (SQQQ only under the median, cash
// far under it) kept the money over 1953-2009 but cost 25-35 points from 2010;
// they were off by default and were removed on 2026-11-01. A plain stop on the
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
    // Every percent setting steps by 1% (the user's call, 2026-10-30): the
    // results move sharply between neighbours, 5% steps hid the best ones.
    // In trading days since 2026-11-02 (the user: "can you have the days
    // instead of years"), every week from 462 to 672 and every 3-4 days from
    // 518 to 588; the other coarse lists got steps around their defaults too
    // (2026-11-03, the user: "flexibility to choose more around plateaus").
    // The defaults since
    // 2026-11-03 come from a hill-climb on the worst dropdown neighbour (the
    // user: "cagr above 135 but still plateau"; the overextended line's two
    // settings left out of the score at the user's call), then set by the
    // user in the middle of the flat stretch each dropdown shows ("have these
    // defaults", 2026-11-03): #50 makes 140.7% a year 2010-2025 with a 41%
    // drawdown (139.6% since the SQQQ limit went from 100 to 40 days and the
    // TQQQ highs and lows reached back to 1985, both 2026-11-04); 135-141% at the lookbacks 532-553 (556: 118), 135-141% at
    // start windows 56-65 (70: 122), 138-141% with the floor 3-8, 141% with
    // re-entry 24-37, 139-141% with the deep buy -33..-24. The one-day start
    // at 567 made 141% at 567 alone and 88-97% a week either side; the
    // 609-day plateau tried first made 119% (scratchpad r13/ca*.cjs,
    // option-curves.cjs, floor-bars.cjs).
    { id: "lookbackDays", label: "Lookback (trading days)", tip: "How many trading days of buy & hold growth are compared: TQQQ's against QQQ's. 252 is about a year.", text: "Compare TQQQ's growth with QQQ's over the last {} trading days.", default: 550, options:
      [252, 260, 280, 300, 315, 320, 340, 360, 378].concat(Array.from({ length: 4 }, (_, k) => 380 + 20 * k), [441, 460, 462, 469, 476, 480, 483, 490, 497, 500, 504], Array.from({ length: 82 }, (_, k) => 511 + k), [595, 600, 602, 609, 616, 620, 623, 630, 637, 640, 644, 651, 658, 660, 665, 672, 680, 693, 700, 720, 740, 756, 760, 780, 800, 819], Array.from({ length: 4 }, (_, k) => 820 + 20 * k), [882], Array.from({ length: 6 }, (_, k) => 900 + 20 * k), [1008]) },
    { id: "startAvgDays", label: "Start averaged over ± (days)", tip: "Example: with a 550-day lookback and ±65, the start price is the average close from 615 to 485 days ago, so one day's price can't decide the lead. At 0 it is the close 550 days ago.", text: "Average the start price over ±{} days.", default: 65, options:
      Array.from({ length: 201 }, (_, k) => k) },
    { section: "Ceiling — step aside" },
    { id: "topLead", label: "TQQQ ahead by at least (%)", tip: "TQQQ's growth over the lookback against QQQ's: 90 means TQQQ grew 1.9 times as much.", text: "Step aside when TQQQ is {} ahead of QQQ.", unit: "%", default: 125, options:
      Array.from({ length: 281 }, (_, k) => 20 + k).concat([{ value: 9999, label: "Off" }]) },
    { id: "topHold", label: "Held instead", tip: "What is held from the ceiling until the lead falls back.", text: "Then hold {}.", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" } ] },
    { id: "topDays", label: "SQQQ for at most (days)", tip: "After this many days SQQQ is sold to cash, which waits for the lead to fall back.", text: "Keep SQQQ for at most {} days, then cash.", default: 20, options:
      [{ value: 0, label: "No limit" }].concat(Array.from({ length: 126 }, (_, k) => 1 + k)) },
    { id: "backLead", label: "Back to TQQQ at lead ≤ (%)", tip: "At or above the ceiling means no band: back on the first close under the ceiling.", text: "Go back to TQQQ once the lead is down to {}.", unit: "%", default: 25, options:
      Array.from({ length: 271 }, (_, k) => -20 + k) },
    { section: "Floor — sell the breakdown" },
    { id: "floorLead", label: "Sell at lead under (%)", tip: "A close with TQQQ's lead under this sells TQQQ; negative means TQQQ is behind QQQ.", text: "Sell TQQQ when its lead falls under {}.", unit: "%", default: 5, options:
      [{ value: -9999, label: "Off" }].concat(Array.from({ length: 101 }, (_, k) => -70 + k)) },
    // Cash since 2026-11-02 (the user): SQQQ bought after a floor break lost on
    // average over 169 break days since 2010 across nearby settings, and cash
    // beat it in 86% of 105 nearby settings (scratchpad r12/, r10/).
    { id: "floorHold", label: "Held after the break", tip: "What is held while the floor is broken.", text: "Hold {} after the break.", default: "cash", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "Cash" } ] },
    { id: "reentryLead", label: "Back at lead ≥ (%)", tip: "TQQQ is bought again after the closes in a row below at or above this lead.", text: "Buy TQQQ back once the lead is {} or more.", unit: "%", default: 25, options:
      Array.from({ length: 151 }, (_, k) => -70 + k) },
    { id: "reentryCloses", label: "Closes in a row", tip: "How many closes in a row at or above the re-entry lead buy TQQQ again.", text: "It has to stay there for {} closes in a row.", default: 5, options:
      Array.from({ length: 100 }, (_, k) => 1 + k) },
    { id: "deepLead", label: "Deep buy at lead ≤ (%)", tip: "While the floor is broken, a close this far behind or worse buys TQQQ. The floor stays off until the lead is back at the re-entry level.", text: "While sold, make a deep buy at a lead of {}.", unit: "%", default: -30, options:
      [{ value: -9999, label: "Off" }].concat(Array.from({ length: 131 }, (_, k) => +(-85 + 0.5 * k).toFixed(1))) },
    { section: "Overextended price — the buy-back strategy's SQQQ line" },
    { id: "overPct", label: "SQQQ above median (%)", tip: "SQQQ while TQQQ closes this far above its own median, back on the first close under.", text: "Hold SQQQ while TQQQ closes {} above its median.", unit: "%", default: 55, options:
      [{ value: 0, label: "Off" }].concat(Array.from({ length: 161 }, (_, k) => +(20 + 0.5 * k).toFixed(1))) },
    { id: "overWindow", label: "Median window (days)", tip: "How many days of TQQQ closes the median covers.", text: "The median covers the last {} days.", default: 250, options:
      Array.from({ length: 23 }, (_, k) => 100 + 5 * k).concat(Array.from({ length: 80 }, (_, k) => 211 + k), Array.from({ length: 22 }, (_, k) => 295 + 5 * k)) },
    { section: "Defence" },
    // Every day up to 50 and every 5 days from 50 to 120 (the user, 2026-11-04),
    // then the old long steps. 40 by default since 2026-11-04 (the user): the
    // long holds since 2010 ended by day 35, and 100 let 1999 run its full
    // course (two 100-day holds, -71% and -89%, scratchpad sqqq-runs/).
    { id: "sqqqMaxDays", label: "SQQQ at most (days in a row)", tip: "After this many days in a row in SQQQ, hold cash until the rules want something else.", text: "Hold SQQQ at most {} days in a row, then cash.", default: 40, options:
      [{ value: 0, label: "No limit" }].concat(Array.from({ length: 50 }, (_, k) => 1 + k), Array.from({ length: 15 }, (_, k) => 55 + 5 * k), [126], Array.from({ length: 12 }, (_, k) => 130 + 5 * k), [189], Array.from({ length: 13 }, (_, k) => 190 + 5 * k), [252], Array.from({ length: 10 }, (_, k) => 255 + 5 * k)) },
    { id: "deepGuard", label: "Deep buy guard (% under its price)", tip: "A deep buy that closes this far under its buy price goes to cash, and buys back once TQQQ closes above its median.", text: "Sell a deep buy that falls {} under its price.", unit: "%", default: 25, options:
      [{ value: 0, label: "Off" }].concat(Array.from({ length: 111 }, (_, k) => +(5 + 0.5 * k).toFixed(1))) },
    { id: "nfciVeto", label: "Credit veto (NFCI above)", tip: "Cash instead of TQQQ while the Chicago Fed's credit stress index is above this. Each weekly reading is used a week later.", text: "Hold cash instead of TQQQ while credit stress (NFCI) is above {}.", default: 0.5, options:
      [{ value: 0, label: "Off" }].concat(Array.from({ length: 141 }, (_, k) => +(0.1 + 0.01 * k).toFixed(2))) },
    { section: "Execution & costs" },
    { id: "splitDays", fit: false, label: "One trade per day", tip: "Yes: a switch sells today and buys tomorrow. No: both at one close.", text: "Spread each switch over two days, selling at one close and buying at the next: {}.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "cashRate", fit: false, label: "Cash interest (%/yr)", tip: "Yearly rate earned on money held in cash.", text: "Cash earns {} a year.", unit: "%", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,10,11,12] },
    { id: "tradeCost", fit: false, label: "Trading cost (%)", tip: "Charged on every buy and sell, as a share of the amount traded.", text: "Each buy and sell costs {} of the amount traded.", unit: "%", default: 0.02, options: [
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
    const L = Math.round(+p.lookbackDays || 550), years = +(L / 252).toFixed(2);
    const W = p.startAvgDays == null ? 65 : Math.max(0, Math.round(+p.startAvgDays));
    const top = p.topLead == null ? 125 : +p.topLead, back = p.backLead == null ? 25 : +p.backLead, band = back < top;
    const topOn = top < 9999, topHold = p.topHold || "sqqq", topDays = +p.topDays || 0;
    const floor = p.floorLead == null ? 5 : +p.floorLead, floorOn = floor > -9999, floorHold = p.floorHold || "sqqq";
    const reentry = p.reentryLead == null ? 25 : +p.reentryLead, closesNeeded = Math.max(1, +p.reentryCloses || 5);
    const deep = p.deepLead == null ? -30 : +p.deepLead, deepOn = floorOn && deep > -9999;
    const over = (+p.overPct || 0) / 100, OW = +p.overWindow || 250;
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    // The lead: TQQQ's growth over the lookback divided by QQQ's, minus 1, in
    // percent. Growth runs from the start price: the average close (geometric
    // mean) over the W closes either side of the day L back, or that day's
    // close when W is 0. With one day's close, lookbacks a week apart made 80%
    // to 141% a year (2010-2025): the lead swung with the day it started on.
    const lead = new Float64Array(n).fill(NaN), gT = new Float64Array(n).fill(NaN), gQ = new Float64Array(n).fill(NaN);
    const baseT = new Float64Array(n).fill(NaN), baseQ = new Float64Array(n).fill(NaN);
    const logT = new Float64Array(n + 1), logQ = new Float64Array(n + 1), priced = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const ok = T[i] > 0 && Q[i] > 0;
      logT[i + 1] = logT[i] + (ok ? Math.log(T[i]) : 0); logQ[i + 1] = logQ[i] + (ok ? Math.log(Q[i]) : 0); priced[i + 1] = priced[i] + (ok ? 1 : 0);
    }
    for (let i = L + W; i < n; i++) {
      const a = i - L - W, b = i - L + W + 1;
      if (!(T[i] > 0 && Q[i] > 0) || priced[b] - priced[a] !== b - a) continue;
      baseT[i] = W ? Math.exp((logT[b] - logT[a]) / (b - a)) : T[i - L];
      baseQ[i] = W ? Math.exp((logQ[b] - logQ[a]) / (b - a)) : Q[i - L];
      gT[i] = T[i] / baseT[i]; gQ[i] = Q[i] / baseQ[i];
      lead[i] = (Math.exp(Math.log(gT[i]) - Math.log(gQ[i])) - 1) * 100;
    }
    // TQQQ against its own median over the window, today's close included,
    // from the start of the memory window before the entry (when the
    // overextended line or the deep buy guard is on).
    const sqMax = +p.sqqqMaxDays || 0;
    const dGuard = (+p.deepGuard || 0) / 100, nfTh = +p.nfciVeto || 0;
    const rel = new Float64Array(n).fill(NaN);
    if (over > 0 || dGuard) {
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
      // fell at most 16% further, so the guard has never fired there.
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
        : floorHold;   // no limit of its own: the crash defence caps every SQQQ stretch (sqqqMaxDays)
      const overNow = over > 0 && rel[i] === rel[i] && rel[i] > over;
      const vetoNow = !!nfTh && !!data.nfci && data.nfci[i] > nfTh;
      let w = overNow ? "sqqq" : base;
      // The credit veto: never above 0.5 since 2010 (0.31 in April 2020), 5.2 in 1974, 3.1 in 2008.
      if (w === "tqqq" && vetoNow) w = "cash";
      return { w, base, overNow, vetoNow };
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
    // credit veto. The deep buy guard's release is a
    // close above the median; a trade none of them explains, the SQQQ limit,
    // goes with the rule that wanted SQQQ. Once a day, in order.
    let lastDec = null, prevDec = null;
    const triggerAt = (i) => {
      const d = decide(i), y = lastDec || d;
      prevDec = y; lastDec = d;
      return releasedAt === i ? PRICE : d.base !== y.base ? LEAD : d.overNow !== y.overNow ? PRICE
        : d.vetoNow !== y.vetoNow ? CREDIT : d.overNow ? PRICE : LEAD;
    };
    const lbl = (id) => id === "cash" ? "cash" : id.toUpperCase();
    const zoneOf = (s) => ({ in: "between the floor and the ceiling", top: "stepped aside at the ceiling", brk: "under the floor", deep: "bought back far behind" })[s];
    // Why the money is in cash when the rules' state would hold a fund. Past the
    // SQQQ limit the note names what wanted SQQQ, not the stretch's older reason.
    const capped = () => sqMax > 0 && sqRun > sqMax;
    const capWhy = (i) => "SQQQ held " + sqMax + " days in a row, the most allowed; "
      + (over > 0 && rel[i] > over ? "TQQQ " + (rel[i] * 100).toFixed(0) + "% above its " + OW + "-day median" : state === "brk" ? "the floor is broken" : "stepped aside at the ceiling");
    // A defence that put the money in cash is the whole reason for it.
    const defenceWhy = (i) => capped() ? capWhy(i)
      : state === "deep" && deepPaused ? "the deep buy guard, TQQQ fell " + Math.round(dGuard * 100) + "% under its buy price; back once it closes above its median"
      : nfTh && data.nfci && data.nfci[i] > nfTh && (state === "in" || state === "deep") ? "credit veto, NFCI " + data.nfci[i].toFixed(2) + " above " + nfTh : "";
    const cashWhy = (i) => defenceWhy(i) ? defenceWhy(i) + "; "
      : state === "top" && topHold === "sqqq" && topDays && days >= topDays ? "SQQQ held for its " + topDays + " days; " : "";
    // The rules' levels as TQQQ prices for a day's close: a close past one is
    // the trade it names. A lead threshold x is the close that puts TQQQ x%
    // ahead of QQQ over the lookback. The lead is TQQQ against QQQ, so the
    // close that reads x% at QQQ's price right now (atLead) moves with QQQ
    // through the day; the close TQQQ and QQQ reach together, QQQ moving a
    // third of TQQQ's move from the prior close (TQQQ's daily leverage, LEV),
    // holds all day, so an order can be set at it (crossAt; the user,
    // 2026-11-06, after a floor price that moved with the market).
    const leadLbl = (x) => x >= 0 ? x + "% ahead" : -x + "% behind";
    const atLead = (i, x) => lead[i] === lead[i] ? baseT[i] * (Q[i] / baseQ[i]) * (1 + x / 100) : null;
    const LEV = 3;
    // A level today's close cannot reach without QQQ moving more than a quarter
    // from its prior close carries no price: the close runs off to infinity as
    // the move it needs grows (a far level once read $448K), and no order
    // belongs there. QQQ's largest day on record is 18.6% (2025-04-09).
    const MAX_PAIR_MOVE = 0.25;
    const crossAt = (i, x) => {
      if (!(lead[i] === lead[i]) || !(i > 0 && T[i - 1] > 0 && Q[i - 1] > 0)) return null;
      const perQ = baseT[i] / baseQ[i] * (1 + x / 100), t0 = T[i - 1], q0 = Q[i - 1];   // TQQQ per QQQ dollar on the level; the prior closes
      const move = (perQ * q0 - t0) / (LEV * t0 - perQ * q0);   // QQQ's move from its prior close to the level, TQQQ moving LEV times it
      return Math.abs(move) <= MAX_PAIR_MOVE ? t0 * (1 + LEV * move) : null;
    };
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
      if (topOn && (state === "in" || state === "deep")) add("Ceiling (" + leadLbl(top) + ")", crossAt(i, top), "up", holdsT ? "sell" : "", "a close above it steps aside to " + lbl(topHold));
      if (topOn && band && state === "top") add("Back at (" + leadLbl(back) + ")", crossAt(i, back), "down", "buy", "a close under it buys TQQQ");
      if (floorOn && state === "in") add("Floor (" + leadLbl(floor) + ")", crossAt(i, floor), "down", holdsT ? "sell" : "", "a close under it sells to " + lbl(floorHold));
      if (floorOn && state === "brk") add("Re-entry (" + leadLbl(reentry) + ")", crossAt(i, reentry), "up", "buy", closesNeeded + (closesNeeded > 1 ? " closes" : " close") + " above it buy TQQQ");
      if (deepOn && state === "brk") add("Deep buy (" + leadLbl(deep) + ")", crossAt(i, deep), "down", "buy", "a close under it buys TQQQ");
      if (dGuard && state === "deep" && !deepPaused) add("Deep buy guard (−" + Math.round(dGuard * 100) + "%)", deepPx * (1 - dGuard), "down", holdsT ? "sell" : "", "a close under it sells to cash");
      if (dGuard && state === "deep" && deepPaused && med) add(OW + "-day median", med, "up", "buy", "a close above it buys the deep buy back");
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
      const ceilingLead = topOn && led ? (state === "top" && band ? back : top) : null, floorLead = floorOn && led ? (out ? reentry : floor) : null;
      const deepLead = deepOn && led ? (state === "deep" && dGuard && !deepPaused ? (deepPx * (1 - dGuard) / atLead(i, 0) - 1) * 100 : deep) : null;
      return {
        assetPrice: T[i] > 0 ? T[i] : null,
        medianPrice: med,
        overLine: over > 0 && med ? med * (1 + over) : null,
        ceilingLine: ceilingLead, floorLine: floorLead, deepLine: deepLead,
        // The close that puts the lead on each level today, QQQ moving along (crossAt): the labels name it in brackets, for orders at a price. The deep buy guard is a price already.
        ceilingPx: ceilingLead == null ? null : crossAt(i, ceilingLead), floorPx: floorLead == null ? null : crossAt(i, floorLead),
        deepPx: deepLead == null ? null : state === "deep" && dGuard && !deepPaused ? deepPx * (1 - dGuard) : crossAt(i, deep),
        nfci: nfTh && isFinite(nf) ? nf : null,
        nfciVeto: nfTh && isFinite(nf) ? nfTh : null
      };
    };
    // A trade's reason: the overextended line while it holds SQQQ; a defence
    // that put the money in cash; a line or veto that stopped holding today
    // (triggerAt's decisions, so a stale stretch reason is never given for a
    // return from the +55% line or the credit veto); else the stretch's own.
    const lifted = (k) => prevDec && lastDec && prevDec.base === lastDec.base && prevDec[k] && !lastDec[k];
    const stretchNow = (i) => "TQQQ is " + leadTxt(lead[i]) + ", " + zoneOf(state);
    const reason = (i, w) => over > 0 && rel[i] === rel[i] && rel[i] > over && w === "sqqq"
      ? "TQQQ closed " + (rel[i] * 100).toFixed(0) + "% above its " + OW + "-day median"
      : w === "cash" && defenceWhy(i) ? defenceWhy(i)
      : lifted("overNow") ? "TQQQ closed " + (rel[i] * 100).toFixed(0) + "% above its " + OW + "-day median, back under the +" + Math.round(over * 100) + "% line; " + (w === "cash" ? cashWhy(i) : "") + stretchNow(i)
      : lifted("vetoNow") && w === "tqqq" ? "credit veto lifted, NFCI " + data.nfci[i].toFixed(2) + " at or under " + nfTh + "; " + stretchNow(i)
      : (w === "cash" ? cashWhy(i) : "") + (why || "TQQQ is " + leadTxt(lead[i])) +
        (whyIdx >= 0 && whyIdx < p.startIdx ? "; that was on " + dates[whyIdx] + ", before the entry" : "");
    // Memory before the entry: the rules run over the lookback window before
    // it, without trading, so the first day holds what the running strategy
    // held. Started blank, an entry on 2020-03-23 read the crash low only as
    // "under the floor" and bought SQQQ (the deep buy had fired on 2020-03-20),
    // then held it while TQQQ nearly tripled.
    for (let i = Math.max(0, p.startIdx - L); i < p.startIdx; i++) { advance(i); capSq(i, wantNow(i)); triggerAt(i); }
    let cash = p.initial, shares = 0, held = "cash";
    let invested = p.initial, pending = false, switchBy = null, switchFor = null, switchWhy = "";
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
          // the first day's reason, unless the rules now want another fund
          action = "buy"; note = "Bought " + lbl(want) + ": second day of the switch; " + (want === switchFor ? switchWhy : reason(i, want));
          firedBy = switchBy;
        }
        pending = false;
      } else if (want !== held) {
        if (held !== "cash") {
          const from = held, gross = shares * priceOf(held, i), f = gross * cost;
          cash += gross - f; fee += f; shares = 0; held = "cash";
          if (want === "cash") { action = "sell"; note = "Sold " + lbl(from) + ": " + reason(i, want); }
          else if (p.splitDays !== false) { pending = true; switchFor = want; switchWhy = reason(i, want); action = "sell"; note = "Sold " + lbl(from) + ": " + switchWhy + "; " + lbl(want) + " is bought tomorrow"; }
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
${END_ROW_ACTION}
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
    const zone = zoneOf(state);
    // The chart's panels (chartRow, the names at decide), each with the rules that read its first line.
    const lines = [{ key: "assetPrice", label: "TQQQ price", group: PRICE }];
    if (over > 0 || dGuard) lines.push({ key: "medianPrice", label: OW + "-day median", group: PRICE });
    if (over > 0) lines.push({ key: "overLine", label: "Overextended (+" + Math.round(over * 100) + "%)", group: PRICE });
    lines.push({ key: "leadPct", label: "TQQQ ahead of QQQ", unit: "%", group: LEAD, priceKey: "assetPrice" });
    if (topOn) lines.push({ key: "ceilingLine", label: "Ceiling", unit: "%", group: LEAD, priceKey: "ceilingPx" });
    if (floorOn) lines.push({ key: "floorLine", label: "Floor", unit: "%", group: LEAD, priceKey: "floorPx" });
    if (deepOn) lines.push({ key: "deepLine", label: "Deep buy", unit: "%", group: LEAD, priceKey: "deepPx" });
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
// The rule is the r/TQQQ "Turnaround Tuesday" post's: buy at a Monday close
// under the prior day's low, sell at the first close above the prior day's
// high (data.<fund>High / Low, js/data.js). Until 2026-10-30 it ran on the
// prior close both ways, as the user's first code did, and a reader of the
// user's post pointed it out. Each entry ships the better of the two on Q1
// 2010 - Q4 2025 (spec.levels): #50 the post's rule, 151.1% against 144.0%;
// #48 and #49 the prior close, 88.0 against 87.1% and 116.8 against 116.2%
// with a 49% drawdown instead of 53% (scratchpad ohlc/three-monday.cjs). The
// prior close stands in where the data has no high or low: before October
// 1985 (data/README.md, "Daily highs and lows"). The rule
// has no settings since 2026-11-01 (the user: "it's assumed already"): each
// entry runs its own signal fund and levels, buys TQQQ, and never pauses (the
// NFCI pause had been Off; NFCI has not been above 0.4 since 2010).
//
// Each entry is its base strategy's own text with these additions, made at
// load, so a change to the base reaches the combination too:
//   - a column;
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
  // Its chart panel, and the rule as the entry fixes it: the fund whose closes
  // it reads, and whether it compares them with the prior day's low and high
  // or with the prior close.
  const panel = JSON.stringify("Turnaround Monday"), sigName = spec.signal.toUpperCase(), hl = spec.levels === "hl";
  // The panel's level lines, on the same scale as the signal fund's move: the
  // prior day's high and low, or the prior close.
  const levelLines = hl
    ? `{ key: "tmHighPct", label: "Prior day's high", unit: "%", group: ${panel}, priceKey: "tmHighPx" }, { key: "tmLowPct", label: "Prior day's low", unit: "%", group: ${panel}, priceKey: "tmLowPx" }`
    : `{ key: "tmLowPct", label: "Prior close", unit: "%", group: ${panel}, priceKey: "tmLowPx" }`;
  const once = (text, find, repl, what) => {
    const at = text.indexOf(find);
    if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`withTurnaroundMonday(${spec.name}): ${what} must appear exactly once in the base`);
    return text.slice(0, at) + repl + text.slice(at + find.length);
  };
  const setup = `    // Turnaround Monday on ${sigName}, run every day on its own. A trade it
    // opens at a Monday close while the rules want cash buys the fund (TQQQ, or
    // spec.fund); it ends at
    // the rule's exit or as soon as the rules want anything else.
    const tmFund = "${spec.fund || 'tqqq'}", tmSig = "${spec.signal}", tmSigName = "${sigName}";
    // ${hl ? "A Monday close under the prior day's low buys, the first close over the prior day's high sells. Before the data's first high and low (October 1985), the prior close stands in." : "A Monday close under the prior close buys, the first close over it sells."}
    const tmHL = ${hl}, tmHigh = data[tmSig + "High"], tmLow = data[tmSig + "Low"];
    if (tmHL && !(tmHigh && tmLow)) throw new Error("Turnaround Monday needs " + tmSigName + "'s daily highs and lows (data." + tmSig + "High, data." + tmSig + "Low)");
    const tmLevel = (arr, i) => (tmHL && arr[i] > 0 ? arr[i] : data[tmSig][i]);
    const tmLevelName = (arr, i, word) => (tmHL && arr[i] > 0 ? "the prior day's " + word : "the prior close");
    const tmIn = new Uint8Array(p.endIdx + 1);   // 1 = the rule is in a trade at that close
    for (let i = p.startIdx, inT = false; i <= p.endIdx; i++) {
      const c = data[tmSig][i], prev = i > 0 ? data[tmSig][i - 1] : 0;
      const wd = ((Math.floor(Date.parse(data.dates[i]) / 86400000) + 4) % 7 + 7) % 7;   // 1 = Monday (1970-01-01 was a Thursday)
      if (c > 0 && prev > 0) { if (inT) { if (c > tmLevel(tmHigh, i - 1)) inT = false; } else if (wd === 1 && c < tmLevel(tmLow, i - 1)) inT = true; }
      tmIn[i] = inT ? 1 : 0;
    }
    let tmActive = false, tmSince = "", tmWhy = "", tmKept = false;
    // What to hold today: the rules' choice, or the fund while a trade opened in their cash is open.
    // A trade starts at the Monday close on money in cash, or on the fund the rules are selling
    // that close (kept instead of sold); money in another fund would need a two-day switch.
    const tmHold = (i, want) => {
      tmWhy = ""; tmKept = false;
      if (want !== "cash") { tmActive = false; return want; }
      if (tmActive && !tmIn[i]) { tmActive = false; tmWhy = "Turnaround Monday exit, " + tmSigName + " closed above " + tmLevelName(tmHigh, i - 1, "high"); }
      else if (!tmActive && (held === "cash" || held === tmFund) && tmIn[i] && !(i > p.startIdx && tmIn[i - 1])) {
        tmActive = true; tmSince = data.dates[i]; tmKept = held === tmFund;
        const under = tmLevelName(tmLow, i - 1, "low");
        tmWhy = tmKept ? "Kept " + tmFund.toUpperCase() + ": the rules sold, but " + tmSigName + " closed a Monday under " + under
          : "Turnaround Monday, " + tmSigName + " closed a Monday under " + under;
      }
      return tmActive ? tmFund : "cash";
    };
    // The chart panel a trade at this close is marked in: Turnaround Monday's
    // for a Monday trade, the rules' own (t) otherwise.
    const TM_PANEL = ${panel};
    const tmPanel = (t) => (tmWhy ? TM_PANEL : t);
`;
  const dashboard = `    // Turnaround Monday on the dashboard: its card, and today's call while a trade is open.
    const last = res.log[res.log.length - 1] || {};
    const tmF = "${(spec.fund || 'tqqq').toUpperCase()}", tmS = "${sigName}";
    const tmOpen = !!last.tmTrade, tmIdle = last.held === "CASH";
    const tmUp = "${hl ? "the prior day's high" : "the prior close"}", tmDown = "${hl ? "the prior day's low" : "the prior close"}";
    // Its chart panel. The base's lines name their panel now that there are several.
    const lines = res.lines || [], first = lines.length ? lines[0].label : "";
    for (const l of lines) if (!l.group) l.group = first;
    // Panels stack from the most trades to the fewest, so the Monday panel
    // goes second: since 2010 its trades fall between the base's main panel
    // and the rest (#50: price 186, Monday 146, lead 104, NFCI none;
    // scratchpad r7/panel-trades.cjs).
    const afterFirst = lines.findIndex(l => l.group !== lines[0].group);
    lines.splice(afterFirst < 0 ? lines.length : afterFirst, 0, { key: "tmChange", label: tmS + " close vs prior close", unit: "%", group: ${panel}, priceKey: "tmClose" },
      ${levelLines});
    res.lines = lines;
    if (res.signals) {
      res.signals.cards = (res.signals.cards || []).concat([{ label: "Turnaround Monday", icon: "clock", tone: tmOpen ? "good" : "",
        value: tmOpen ? "In a trade" : tmIdle ? "Waiting" : "Idle",
        sub: tmOpen ? tmF + " since " + last.tmTrade + ", sells at the first close above " + tmUp
          : tmIdle ? "buys " + tmF + " at a Monday close under " + tmDown : "the rules hold " + last.held,
        tip: "Trades the idle cash: buys " + tmF + " when " + tmS + " closes a Monday under " + tmDown + ", sells at the first close above " + tmUp + "." }]);
      if (tmOpen && res.signals.decision) {
        const d = res.signals.decision;
        res.signals.decision = { action: "Hold " + tmF, note: "Turnaround Monday trade since " + last.tmTrade + "; the rules themselves are in cash", tone: "good",
          reasons: (d.reasons || []).concat([{ name: "Turnaround Monday", val: "open since " + last.tmTrade, tag: "in · " + tmF, lean: "buy" }]) };
      }
    }
`;
  let t = base.replace(/^(\s*name:\s*)"[^"]+"/m, (m, pre) => `${pre}"${spec.name}"`);
  t = once(t, '  columns: [\n', '  columns: [\n    { key: "tmTrade", label: "Monday trade", tip: "The day an open Turnaround Monday trade was bought. Blank when none is open." },\n', 'the columns list');
  t = once(t, '  run(data, p) {\n', '  run(data, p) {\n    const res = (function (data, p) {\n', 'run(data, p)');
  t = once(t, '    for (let i = p.startIdx; i <= p.endIdx; i++) {', setup + '    for (let i = p.startIdx; i <= p.endIdx; i++) {', 'the main loop');
  // On every row: the signal fund against the prior close, in percent, and the
  // prior day's high and low on the same scale (a Monday close under the low
  // buys, the first close over the high sells; both 0% where the prior close
  // stands in), and a Monday trade's panel.
  t = once(t, '        log.push({\n', '        log.push({\n          tmTrade: tmActive ? tmSince : null,\n'
    + '          tmChange: i > 0 && data[tmSig][i - 1] > 0 ? (data[tmSig][i] / data[tmSig][i - 1] - 1) * 100 : null, tmClose: data[tmSig][i] > 0 ? data[tmSig][i] : null,\n'
    + '          tmHighPct: i > 0 && data[tmSig][i - 1] > 0 ? (tmLevel(tmHigh, i - 1) / data[tmSig][i - 1] - 1) * 100 : null,\n'
    + '          tmLowPct: i > 0 && data[tmSig][i - 1] > 0 ? (tmLevel(tmLow, i - 1) / data[tmSig][i - 1] - 1) * 100 : null,\n'
    + '          tmHighPx: i > 0 && data[tmSig][i - 1] > 0 ? tmLevel(tmHigh, i - 1) : null, tmLowPx: i > 0 && data[tmSig][i - 1] > 0 ? tmLevel(tmLow, i - 1) : null,\n'
    + '          ...(tmWhy ? { firedBy: tmPanel(null) } : {}),\n', 'the log row');
  t = once(t, END_ROW_ACTION + '\n', '      if (tmKept) { if (action === "hold") action = "keep"; note = note ? note + "; " + tmWhy : tmWhy; }   // a sale the Monday trade held off\n' + END_ROW_ACTION + '\n', 'the end-of-run action');
  for (const [find, repl, what] of spec.hooks) t = once(t, find, repl, what);
  if (!t.endsWith('\n  }\n}')) throw new Error(`withTurnaroundMonday(${spec.name}): the base must end with its run method`);
  return t.slice(0, -'\n  }\n}'.length) + '\n    })(data, p);\n' + dashboard + '    return res;\n  }\n}';
}
CODE[48] = withTurnaroundMonday(CODE[44], { name: "NFCI veto + Turnaround Monday", signal: "tqqq", levels: "close", hooks: [
  ['        if (vetoOn) want = "cash";\n', '        if (vetoOn) want = "cash";\n        want = tmHold(i, want);\n', 'the credit-veto line'],
  ['note = vetoOn ? "NFCI "', 'note = tmWhy ? tmWhy : vetoOn ? "NFCI "', 'the trade note'],
  ['fired = vetoMoved && (vetoOn || !nfAbove) ? CREDIT : null;', 'fired = tmPanel(vetoMoved && (vetoOn || !nfAbove) ? CREDIT : null);', 'the trade panel'] ] });
CODE[49] = withTurnaroundMonday(CODE[45], { name: "Buy-back + Turnaround Monday", signal: "spy", levels: "close", hooks: [
  ['          : (_frac > 0 ? p.asset : crashAsset);\n', '          : (_frac > 0 ? p.asset : crashAsset);\n        want = tmHold(i, want);\n        if (tmActive) _frac = 1;\n        if (tmWhy && !why) why = tmWhy;\n', 'the holding decision'] ] });
// #50's floor holds cash, like #47's, and the Monday rule trades it (the user,
// 2026-11-02: "swap it for floor"). 2010-2025 141.1% against 151.1% with SQQQ,
// but far steadier: at lookbacks of 1.75 to 2.75 years 54-141% a year (worst
// drawdown 74%) against 10-151% (96%), and from 2005 a 47% drawdown against
// 75% (scratchpad r10/no-sqqq.cjs, r12/).
CODE[50] = withTurnaroundMonday(CODE[47], { name: "TQQQ vs QQQ + Turnaround Monday", signal: "tqqq", levels: "hl", hooks: [
  ['{ id: "floorHold", label: "Held after the break", tip: "What is held while the floor is broken.",',
    '{ id: "floorHold", label: "Held after the break", tip: "What is held while the floor is broken. Cash is traded by the Monday rule.",', 'the floor tip'],
  ['      const want = capSq(i, wantNow(i));', '      const want = tmHold(i, capSq(i, wantNow(i)));', 'the holding decision'],
  ['      const trigger = triggerAt(i);', '      const trigger = tmPanel(triggerAt(i));', 'the trade panel'],
  ['const reason = (i, w) => ', 'const reason = (i, w) => tmWhy ? tmWhy : ', 'the trade reason'] ] });

// #52 — SOXL, TQQQ VS QQQ, Mon Turns (the user's name, 2026-11-06; "TQQQ VS QQQ,
// Mon Turn, Soxl Acc" before): #50 with the monthly contributions
// piling up in SOXL while the stretch rules hold TQQQ, handed to the strategy
// as one contribution when the rules switch to SQQQ (the user's idea,
// 2026-11-05, scratchpad soxl/recheck.cjs). Built from #50's text at load,
// as #50 is built from #47, so a change to either reaches it.
//   - A contribution buys SOXL at the close it arrives while the rules
//     themselves hold TQQQ. A Monday trade is not that, and before the SOXL
//     data starts (May 1994) contributions go to the strategy.
//   - When the rules sell TQQQ for SQQQ, the pile is sold once SQQQ is
//     actually bought, at the next close, and its money reaches the strategy
//     the close after, bought like any deposit: 15 of the +55% line's signals
//     since 2010 reversed the next day, and the pile sits them out. As a
//     setting, the pile is sold at the signal close instead, and the strategy
//     buys SQQQ with both the next day.
//   - When the rules sell TQQQ to cash (the floor, the credit veto, the deep
//     buy guard, a Monday trade holding the sale off), the pile waits in cash
//     and buys SOXL again when the rules hold TQQQ again; as a setting it
//     joins the strategy instead.
//   - A withdrawal draws on the pile before the strategy's own holdings.
//   - SOXL instead of TQQQ (the user, 2026-11-05: "find the edge with soxl"):
//     while the rules hold TQQQ, the account holds SOXL under a condition. The
//     default is the lead rule, the user's own call against the price rules
//     ("I find that hard to believe"; scratchpad edge/stretch-signal*.cjs):
//     SOXL's growth over 400 trading days against SOXX's, held from a close
//     with the lead under 0% until the first close over 20%. 2010-25 lump sum
//     183.2% a year at a 42.3% drawdown against 170.3% / 42.9% for "below its
//     225-day average" and 139.6% / 40.8% for #50; halves 114 / 275 against
//     96 / 272; 22 SOXL stretches against 41; out of SOXL since 2026-04-09, so it
//     held TQQQ through the October 2026 semiconductor crash. The price rules
//     stay as settings. Every SOXL rule loses to plain TQQQ before 2010.
// $100K + $4K a month from each of 199 month-end starts since March 2010:
// $1M reached sooner than with every contribution in the strategy in 102
// starts, later in 11, the same day in 67; the contributions are worth 6%
// more at the goal. SOXL beat the strategy only while it held plain TQQQ
// (×1.8 over 2010-17, ×6.5 over 2018-26 against it) and lost 63% to 99%
// against it in every SQQQ and cash phase, hence the handover.
function withSoxlPile(base, spec) {
  const once = (text, find, repl, what) => {
    const at = text.indexOf(find);
    if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`withSoxlPile(${spec.name}): ${what} must appear exactly once in the base`);
    return text.slice(0, at) + repl + text.slice(at + find.length);
  };
  const params = `    { section: "SOXL instead of TQQQ" },
    { id: "soxlWhen", label: "Hold SOXL instead of TQQQ", tip: "While the rules hold TQQQ, the account holds SOXL instead under this condition. The lead rule (SOXL's growth against SOXX's over the lookback, held from a close under the entry level until one over the exit level) made the most on 2010-2025 and was out of SOXL before the 2026 crash; the two price rules and Always made less, and every rule lost to plain TQQQ in 2003-2007.", text: "Hold SOXL instead of TQQQ {}.", default: "lead", options: [
      { value: "never", label: "never" }, { value: "lead", label: "while SOXL's lead over SOXX is low" }, { value: "drawdown", label: "while SOXL is far under its high" }, { value: "belowAvg", label: "while SOXL is below its average" }, { value: "always", label: "always" } ] },
    { id: "soxlLeadDays", label: "Lead lookback (trading days)", tip: "How many trading days of growth are compared: SOXL's against SOXX's. 380 is about 18 months; 350 to 450 all beat the price rules since 2010.", text: "The lead is SOXL's growth against SOXX's over the last {} trading days.", default: 380, options:
      [60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 525, 550, 575, 600, 625, 650, 675, 700, 725, 750] },
    { id: "soxlLeadEnter", label: "Hold SOXL at lead under (%)", tip: "The first close with the lead under this holds SOXL. 0 means SOXL has grown no more than SOXX over the lookback; negative means it is behind.", text: "Hold SOXL from the first close with the lead under {}.", unit: "%", default: -15, options:
      Array.from({ length: 25 }, (_, k) => -80 + 5 * k) },
    { id: "soxlLeadExit", label: "Back to TQQQ at lead over (%)", tip: "The first close with the lead over this goes back to TQQQ. The gap to the entry level keeps a lead hovering around one line from switching every few days.", text: "Back to TQQQ at the first close with the lead over {}.", unit: "%", default: 90, options:
      Array.from({ length: 93 }, (_, k) => -60 + 5 * k) },   // −60% to 400% in 5s (the user, 2026-11-06: "so lead can go up to 400%")
    { id: "soxlDrop", label: "Far under the high (%)", tip: "How far under its highest close of the window SOXL has to be for the rule to hold it. 40 to 70 all beat TQQQ alone since 2010; 50 is the plateau's middle.", text: "Far under means {} under the highest close of the window.", unit: "%", default: 50, options:
      Array.from({ length: 11 }, (_, k) => 20 + 5 * k) },
    { id: "soxlWindow", label: "Window (trading days)", tip: "The window of closes the high and the average are taken over. 250 is about a year.", text: "The high and the average cover the last {} trading days.", default: 225, options:
      [60, 90, 120, 150, 175, 200, 225, 250, 275, 300, 350, 400, 500] },
    { id: "soxlConfirm", label: "Switch in", tip: "At once: the day SOXL closes that far under its high, even while it is still falling; that is where the 2010-2025 edge was. Waiting for SOXL to climb back above its average keeps only a few points of it and no longer beats random dates, but sits out a crash that keeps going, like July to November 2026.", text: "Switch in {}.", default: 0, options: [
      { value: 0, label: "at once" }, { value: 10, label: "only once SOXL is back above its 10-day average" }, { value: 20, label: "only once SOXL is back above its 20-day average" }, { value: 50, label: "only once SOXL is back above its 50-day average" }, { value: 100, label: "only once SOXL is back above its 100-day average" }, { value: 200, label: "only once SOXL is back above its 200-day average" } ] },
    { section: "Contributions in SOXL" },
    { id: "soxlPile", label: "Contributions buy SOXL", tip: "Yes: a contribution buys SOXL while the rules hold TQQQ, and the pile goes into the strategy when they switch to SQQQ. No: every contribution goes into the strategy at once, as in TQQQ vs QQQ + Turnaround Monday.", text: "Contributions buy SOXL while the rules hold TQQQ: {}.", type: "bool", default: true, options: [
      { value: true, label: "Yes" }, { value: false, label: "No" } ] },
    { id: "pileHandover", label: "Hand the pile over", tip: "Once SQQQ is bought: the pile is sold at the close the strategy buys SQQQ, and its money is bought at the close after; a signal that reverses the next day costs the pile nothing. At the signal: the pile is sold with TQQQ, and the strategy buys SQQQ with both the next day.", text: "Hand the pile to the strategy {}.", default: "confirmed", options: [
      { value: "confirmed", label: "once SQQQ is bought" }, { value: "signal", label: "at the signal" } ] },
    { id: "pileFloor", label: "When the rules sell to cash", tip: "The floor, the credit veto, the deep buy guard and a Monday trade holding a sale off all leave the rules in cash. Waits in cash: the pile is sold to cash and buys SOXL again at the rules' next TQQQ buy. Joins the strategy: the pile's money becomes the strategy's cash.", text: "When the rules sell TQQQ to cash, the pile {}.", default: "wait", options: [
      { value: "wait", label: "waits in cash" }, { value: "join", label: "joins the strategy" } ] },
`;
  const setup = `    // The SOXL pile (the Contributions in SOXL settings): shares, cash it waits
    // in, what was put in, and the handover in flight. "rally" below is the
    // rules' own choice of TQQQ, a Monday trade aside.
    const pileOn = p.soxlPile !== false, pileConfirm = (p.pileHandover || "confirmed") === "confirmed", pileWait = (p.pileFloor || "wait") === "wait";
    const SOXL_FROM = "1994-05-04";   // the semiconductor index starts here; js/data.js holds SOXL's first price flat before it
    const soxlAt = (i) => data.soxl && dates[i] >= SOXL_FROM ? (data.soxl[i] || 0) : 0;
    let pileSh = 0, pileCash = 0, pilePut = 0, pileDeposits = 0, pileAwait = false, rallyPrev = false, pileTransfer = 0;
    const holdings = [];   // daily control points, the pile included, for the app's revaluation (drawdown, cards)
    const money = (x) => "$" + (x >= 1e6 ? (x / 1e6).toFixed(2) + "M" : x >= 1e3 ? (x / 1e3).toFixed(1) + "K" : x.toFixed(0));
    const pileCount = () => pileDeposits + (pileDeposits === 1 ? " contribution" : " contributions");
    // SOXL instead of TQQQ: the condition at each close over the run and its warm-up,
    // from SOXL's highest close and average over the window.
    const soxlWhen = p.soxlWhen || "lead", soxlDrop = (p.soxlDrop == null ? 50 : +p.soxlDrop) / 100, SW = Math.max(2, Math.round(+p.soxlWindow || 225));
    const soxlHi = new Float64Array(n).fill(NaN), soxlAvg = new Float64Array(n).fill(NaN), soxlOnAt = new Uint8Array(n);
    const SC = Math.round(+p.soxlConfirm || 0), soxlConf = new Float64Array(n).fill(NaN);   // the "switch in" average
    if (data.soxl && SC > 0) { let sc = 0; for (let i = 0; i < n; i++) { sc += data.soxl[i] > 0 ? data.soxl[i] : 0; if (i >= SC) sc -= data.soxl[i - SC] > 0 ? data.soxl[i - SC] : 0; if (i >= SC - 1) soxlConf[i] = sc / SC; } }
    if (data.soxl) {
      const from = Math.max(SW, p.startIdx - L - SW), win = [];   // a deque of indexes with falling closes, for the running high
      let sum = 0, head = 0;
      for (let i = from - SW + 1; i <= p.endIdx; i++) {
        const c = data.soxl[i] > 0 && dates[i] >= SOXL_FROM ? data.soxl[i] : NaN;
        sum += c === c ? c : 0;
        while (win.length > head && data.soxl[win[win.length - 1]] <= c) win.pop();
        win.push(i);
        if (i - SW >= from - SW + 1) { const o = data.soxl[i - SW]; sum -= o > 0 && dates[i - SW] >= SOXL_FROM ? o : 0; }
        while (win[head] <= i - SW) head++;
        if (i >= from && c === c && dates[i - SW + 1] >= SOXL_FROM) {
          soxlHi[i] = data.soxl[win[head]]; soxlAvg[i] = sum / SW;
          const okC = !SC || c > soxlConf[i];
          soxlOnAt[i] = soxlWhen === "always" ? 1 : soxlWhen === "drawdown" ? (c < soxlHi[i] * (1 - soxlDrop) && okC ? 1 : 0) : soxlWhen === "belowAvg" ? (c < soxlAvg[i] && okC ? 1 : 0) : 0;
        }
      }
    }
    // The lead rule: SOXL's growth over the lead lookback against SOXX's, in %, at every
    // close with both ends in the data; SOXL is held from a close with the lead under the
    // entry level until the first close with it over the exit level. The state runs over
    // the whole history, so a moved Entry never starts it blank.
    const LD = Math.max(1, Math.round(+p.soxlLeadDays || 380)), leadIn = p.soxlLeadEnter == null ? -15 : +p.soxlLeadEnter, leadOut = p.soxlLeadExit == null ? 90 : +p.soxlLeadExit;
    const soxlLead = new Float64Array(n).fill(NaN), soxlBase = new Float64Array(n).fill(NaN);   // soxlBase: the SOXL price at a lead of 0% today
    if (data.soxl && data.soxx) {
      let on = false;
      for (let i = LD; i <= p.endIdx; i++) {
        const s0 = data.soxl[i - LD], x0 = data.soxx[i - LD];
        if (!(s0 > 0 && x0 > 0 && data.soxl[i] > 0 && data.soxx[i] > 0) || dates[i - LD] < SOXL_FROM) continue;
        soxlBase[i] = s0 * (data.soxx[i] / x0);
        soxlLead[i] = (data.soxl[i] / soxlBase[i] - 1) * 100;
        if (!on && soxlLead[i] < leadIn) on = true; else if (on && soxlLead[i] > leadOut) on = false;
        if (soxlWhen === "lead") soxlOnAt[i] = on && (!SC || data.soxl[i] > soxlConf[i]) ? 1 : 0;
      }
    }
    // The SOXL close that puts the lead on a level today, SOXX moving a third of SOXL's move from
    // the prior close (SOXL's daily leverage): it holds through the day, so an order can be set at
    // it, where the close that reads the level at SOXX's price right now moves with SOXX.
    // A level today's close cannot reach without SOXX moving more than a quarter from its prior
    // close carries no price: the close runs off to infinity as the move it needs grows (the
    // user, 2026-11-08, at a "Back to TQQQ over" of $448K with the lead at -32%), and no order
    // belongs there. SOXX's largest day on record is 18.6% (2025-04-09), SOXL's 54.8%.
    const SOXL_LEV = 3, SOXL_MAX_PAIR_MOVE = 0.25;
    const soxlCrossAt = (i, lvl) => {
      if (!(soxlBase[i] > 0) || !(i > 0 && data.soxl[i - 1] > 0 && data.soxx[i - 1] > 0)) return null;
      const perX = soxlBase[i] / data.soxx[i] * (1 + lvl / 100), s0 = data.soxl[i - 1], x0 = data.soxx[i - 1];   // SOXL per SOXX dollar on the level; the prior closes
      const move = (perX * x0 - s0) / (SOXL_LEV * s0 - perX * x0);   // SOXX's move from its prior close to the level, SOXL moving SOXL_LEV times it
      return Math.abs(move) <= SOXL_MAX_PAIR_MOVE ? s0 * (1 + SOXL_LEV * move) : null;
    };
    const SOXL_PRICE = "SOXL price", SOXL_PANEL = soxlWhen === "lead" ? "SOXL vs SOXX" : SOXL_PRICE;   // SOXL_PANEL: where the SOXL rule's trades are marked
    let soxlPrev = false, soxlSwitch = false, soxlLeft = false;
    const soxlUnder = (i) => soxlHi[i] > 0 ? ((1 - data.soxl[i] / soxlHi[i]) * 100).toFixed(0) + "% under its " + SW + "-day high" : "";
    const soxlLeadTxt = (i) => soxlLead[i] === soxlLead[i] ? (soxlLead[i] >= 0 ? "+" : "−") + Math.abs(soxlLead[i]).toFixed(0) + "%" : "n/a";
    const soxlWhy = (i, w) => w === "soxl" ? (soxlWhen === "lead" ? "SOXL's lead over SOXX is " + soxlLeadTxt(i) + ", under " + leadIn + "%" : "SOXL is " + (soxlWhen === "always" ? "held for TQQQ" : soxlWhen === "belowAvg" ? "below its " + SW + "-day average" : soxlUnder(i))) + "; the rules hold TQQQ"
      : w === "tqqq" && soxlLeft ? (soxlWhen === "lead" ? "SOXL's lead over SOXX is back over " + leadOut + "% (" + soxlLeadTxt(i) + ")" : "SOXL is back " + (soxlWhen === "belowAvg" ? "above its " + SW + "-day average" : "within " + Math.round(soxlDrop * 100) + "% of its " + SW + "-day high")) : "";
`;
  const atClose = `      // The SOXL pile at this close, settled before the strategy's own trade
      // below, so money handed over at this close is in its cash for that trade.
      const rally = pileOn && baseWant === "tqqq" && soxlPx > 0;
      const pileWas = money(pileSh * soxlPx + pileCash) + " from " + pileCount();
      const sellPile = () => { const gross = pileSh * soxlPx, f = gross * cost; fee += f; pileSh = 0; const got = gross - f + pileCash; pileCash = 0; return got; };
      const pileEmptied = () => { pilePut = 0; pileDeposits = 0; };
      if (pileAwait) {   // yesterday's SQQQ signal: what did the strategy buy?
        pileAwait = false;
        if (baseWant === "tqqq") pileNote = "SOXL pile kept: the strategy bought TQQQ back, not SQQQ";
        else if (baseWant !== "cash") { pileTransfer = sellPile(); pileNote = "Sold the SOXL pile (" + pileWas + "): " + lbl(baseWant) + " bought; its money joins the strategy tomorrow"; pileEmptied(); }
        else if (pileWait) { pileCash = sellPile(); pileNote = "SOXL pile to cash (" + pileWas + "): the rules want cash"; }
        else { cash += sellPile(); pileNote = "SOXL pile handed over (" + pileWas + "): the rules want cash"; pileEmptied(); }
      } else if (rallyPrev && !rally && (pileSh > 0 || pileCash > 0)) {
        if (baseWant !== "cash") {   // the stretch: TQQQ sold for SQQQ
          if (pileConfirm && p.splitDays !== false) { pileAwait = true; pileNote = "SOXL pile (" + pileWas + ") waits for tomorrow's " + lbl(baseWant) + " buy"; }
          else if (pileConfirm) { pileTransfer = sellPile(); pileNote = "Sold the SOXL pile (" + pileWas + "); its money joins the strategy tomorrow"; pileEmptied(); }
          else { cash += sellPile(); pileNote = "Sold the SOXL pile (" + pileWas + "): it joins the switch to " + lbl(baseWant); pileEmptied(); }
        } else if (pileWait) { if (pileSh > 0) { pileCash = sellPile(); pileNote = "SOXL pile to cash (" + pileWas + "): the rules sold TQQQ to cash"; } }
        else { cash += sellPile(); pileNote = "SOXL pile handed over (" + pileWas + "): the rules sold TQQQ to cash"; pileEmptied(); }
      }
      if (rally) {
        if (pileCash > 0) { const f = pileCash * cost; pileSh += (pileCash - f) / soxlPx; fee += f; pileCash = 0; pileNote = "SOXL pile bought back (" + money(pileSh * soxlPx) + "): the rules hold TQQQ again"; }
        if (contributed > 0) { const f = contributed * cost; cash -= contributed; pileSh += (contributed - f) / soxlPx; fee += f; pilePut += contributed; pileDeposits++; pileNote = "contribution bought SOXL (pile " + money(pileSh * soxlPx) + " from " + pileCount() + ")"; }
      }
      rallyPrev = rally;
`;
  const joined = `      if (pileJoined > 0) {   // yesterday's pile sale, bought with the strategy's own trade or added to what it holds
        if (held !== "cash" && action === "hold") action = "buy";
        pileNote = (pileNote ? pileNote + "; " : "") + "the SOXL pile's " + money(pileJoined) + (held === "cash" ? " joined the strategy's cash" : " bought " + lbl(held));
      }
      if (pileNote) note = note ? note + "; " + pileNote : pileNote;
      const pileValue = pileSh * soxlPx + pileCash + pileTransfer;
      const h = {}; if (held !== "cash" && shares > 0) h[held] = shares; if (pileSh > 0) h.soxl = (h.soxl || 0) + pileSh;   // the strategy and the pile can both hold SOXL
      holdings.push({ date: dates[i], cash: cash + pileCash + pileTransfer, h });
`;
  const card = `    // This entry's panel order (the user, 2026-11-05: "move this chart up so it
    // is just down of price chart", then "put turnaround monday between these
    // two"): TQQQ's price over its pair, Turnaround Monday (the Monday
    // generator put it second, by trade count), SOXL's price over its pair,
    // credit stress last. With no SOXL panel the Monday panel sits before credit stress.
    if (res.lines) {
      const tm = res.lines.filter(l => l.group === "Turnaround Monday"), rest = res.lines.filter(l => l.group !== "Turnaround Monday");
      let at = rest.findIndex(l => l.group === "SOXL price" || l.group === "SOXL vs SOXX");
      if (at < 0) at = rest.findIndex(l => l.group === "Credit stress (NFCI)");
      res.lines = at < 0 ? rest.concat(tm) : rest.slice(0, at).concat(tm, rest.slice(at));
    }
    // The SOXL pile on the dashboard.
    if (res.signals) {
      const lastRow = res.log[res.log.length - 1] || {}, pileNow = lastRow.soxlPile || 0, putNow = lastRow.soxlPut || 0;
      const fmtMoney = (x) => "$" + (x >= 1e6 ? (x / 1e6).toFixed(2) + "M" : x >= 1e3 ? (x / 1e3).toFixed(1) + "K" : x.toFixed(0));
      // SOXL instead of TQQQ: one voice. The base's cards and verdict say what its
      // rules chose (TQQQ); while SOXL stands in for it, say so everywhere.
      const sWhen = p.soxlWhen || "lead", sWin = Math.round(+p.soxlWindow || 225), sDrop = p.soxlDrop == null ? 50 : +p.soxlDrop;
      const sLead = lastRow.soxlLead, sLeadTxt = sLead != null ? (sLead >= 0 ? "+" : "−") + Math.abs(sLead).toFixed(0) + "%" : "n/a";
      const sIn = p.soxlLeadEnter == null ? -15 : +p.soxlLeadEnter, sOut = p.soxlLeadExit == null ? 90 : +p.soxlLeadExit;
      const inSoxl = lastRow.held === "SOXL";
      const sRule = sWhen === "always" ? "SOXL is always held for TQQQ"
        : sWhen === "lead" ? "SOXL's lead over SOXX " + sLeadTxt + " over " + Math.round(+p.soxlLeadDays || 380) + " days; held for TQQQ from under " + sIn + "% until over " + sOut + "%"
        : sWhen === "belowAvg" ? "SOXL " + (lastRow.soxlAvgLine > 0 ? Math.abs((1 - lastRow.soxlPrice / lastRow.soxlAvgLine) * 100).toFixed(0) + "% " + (lastRow.soxlPrice < lastRow.soxlAvgLine ? "below" : "above") + " its " + sWin + "-day average" : "against its " + sWin + "-day average") + "; held for TQQQ while below"
        : "SOXL " + (lastRow.soxlLine > 0 ? ((1 - lastRow.soxlPrice / (lastRow.soxlLine / (1 - sDrop / 100))) * 100).toFixed(0) + "% under its " + sWin + "-day high" : "against its " + sWin + "-day high") + "; held for TQQQ past " + sDrop + "%";
      if (sWhen !== "never" && (lastRow.soxlPrice > 0 || sLead != null)) {
        res.signals.cards = (res.signals.cards || []).map(c => c.label === "Holding" && inSoxl ? Object.assign({}, c, { value: "SOXL", sub: "for TQQQ; " + c.sub }) : c.label === "Turnaround Monday" ? Object.assign({}, c, { sub: String(c.sub).replace("the rules hold SOXL", "the rules hold TQQQ, held as SOXL") }) : c);
        res.signals.cards = res.signals.cards.concat([{ label: "SOXL instead of TQQQ", icon: "activity", tone: inSoxl ? "good" : "",
          value: inSoxl ? "Holding SOXL" : "TQQQ", sub: sRule,
          tip: "While the rules hold TQQQ, SOXL is held instead under the Hold SOXL instead of TQQQ setting." }]);
        if (inSoxl && res.signals.decision && /^Hold TQQQ/.test(res.signals.decision.action || "")) {
          const d = res.signals.decision;
          res.signals.decision = Object.assign({}, d, { action: "Hold SOXL", note: sRule + "; " + (d.note || ""),
            reasons: (d.reasons || []).concat([{ name: "SOXL instead of TQQQ", val: sWhen === "lead" ? "lead over SOXX " + sLeadTxt : sWhen === "belowAvg" ? "below its " + sWin + "-day average" : sWhen === "always" ? "always" : "far under its high", tag: "in · SOXL", lean: "buy" }]) });
        }
      }
      res.signals.cards = (res.signals.cards || []).concat([{ label: "SOXL pile", icon: "dollar", tone: pileNow > 0 ? "good" : "",
        value: pileNow > 0 ? fmtMoney(pileNow) : "Empty",
        sub: pileNow > 0 ? fmtMoney(putNow) + " put in; sold for the strategy at the next SQQQ buy" : "contributions buy SOXL while the rules hold TQQQ",
        tip: "Contributions pile up in SOXL while the rules hold TQQQ. The pile goes into the strategy when they switch to SQQQ." }]);
    }
`;
  let t = base.replace(/^(\s*name:\s*)"[^"]+"/m, (m, pre) => `${pre}"${spec.name}"`);
  t = once(t, '    { section: "Execution & costs" },\n', params + '    { section: "Execution & costs" },\n', 'the costs section');
  t = once(t, '  columns: [\n', '  columns: [\n    { key: "soxlPile", label: "SOXL pile", tip: "Contributions piled up in SOXL, or waiting in cash, before they join the strategy." },\n    { key: "soxlPut", label: "Put in the pile", tip: "The contributions in the current pile." },\n    { key: "soxlLead", label: "SOXL ahead of SOXX", tip: "SOXL\'s growth over the lead lookback against SOXX\'s: SOXL growth ÷ SOXX growth − 1, in %. Negative means behind." },\n', 'the columns list');
  t = once(t, '    const cost = (p.tradeCost || 0) / 100;\n', '    const cost = (p.tradeCost || 0) / 100;\n' + setup, 'the cost line');
  t = once(t, '      let contributed = 0, action = "hold", note = "", fee = 0;\n', '      let contributed = 0, action = "hold", note = "", fee = 0;\n      const soxlPx = soxlAt(i); let pileNote = "";\n', 'the day\'s row variables');
  t = once(t, '      if (i > p.startIdx) cash *= 1 + dayRate;\n', '      if (i > p.startIdx) cash *= 1 + dayRate;\n      if (i > p.startIdx) pileCash *= 1 + dayRate;\n      const pileJoined = pileTransfer; cash += pileTransfer; pileTransfer = 0;\n', 'the interest line');
  t = once(t, '        cash += amt; contributed = amt; invested += amt; action = "contribution";\n',
    '        cash += amt; contributed = amt; invested += amt; action = "contribution";\n'
    + '        // A withdrawal draws on the SOXL pile before the strategy\'s own holdings.\n'
    + '        if (cash < 0 && pileCash > 0) { const take = Math.min(pileCash, -cash); pileCash -= take; cash += take; pileNote = "withdrawal — took " + money(take) + " from the pile\'s cash"; }\n'
    + '        if (cash < 0 && pileSh > 0 && soxlPx > 0) {\n'
    + '          const gross = Math.min(pileSh * soxlPx, -cash / (1 - cost));\n'
    + '          pileSh = Math.max(0, pileSh - gross / soxlPx); fee += gross * cost; cash += gross * (1 - cost);\n'
    + '          pileNote = "withdrawal — sold " + money(gross) + " of the SOXL pile"; if (!(pileSh > 0)) { pileSh = 0; pilePut = 0; pileDeposits = 0; }\n'
    + '        }\n', 'the contribution line');
  t = once(t, '      const want = tmHold(i, capSq(i, wantNow(i)));\n', '      const baseWant = capSq(i, wantNow(i));\n      let want = tmHold(i, baseWant);\n      const soxlOn = baseWant === "tqqq" && soxlOnAt[i] === 1 && soxlPx > 0;\n      if (soxlOn) want = "soxl";\n      soxlSwitch = soxlOn !== soxlPrev && baseWant === "tqqq";\n      soxlLeft = soxlPrev && !soxlOn;   // for the trade reason: the pile block below moves soxlPrev on before the note is built\n', 'the holding decision');
  t = once(t, '      const trigger = tmPanel(triggerAt(i));\n', '      const trigger = soxlSwitch ? SOXL_PANEL : tmPanel(triggerAt(i));\n' + atClose, 'the trade panel line');
  t = once(t, 'const reason = (i, w) => tmWhy ? tmWhy : ', 'const reason = (i, w) => soxlWhy(i, w) ? soxlWhy(i, w) + (tmWhy ? "; " + tmWhy : "") : tmWhy ? tmWhy : ', 'the trade reason');
  t = once(t, '      rallyPrev = rally;\n', '      rallyPrev = rally; soxlPrev = soxlOn;\n', 'the end of the pile block');
  // SOXL's panels go after TQQQ's lead panel: each fund's price over its
  // relative pricing (the user, 2026-11-05: "show soxl pricing chart at the
  // relative soxl pricing too"), both at full height. In the lead mode the
  // price panel carries the lead's levels as SOXL prices (the price at which
  // the lead would sit on the level today), so the crossings read there too.
  t = once(t, '    if (deepOn) lines.push({ key: "deepLine", label: "Deep buy", unit: "%", group: LEAD, priceKey: "deepPx" });\n',
    '    if (deepOn) lines.push({ key: "deepLine", label: "Deep buy", unit: "%", group: LEAD, priceKey: "deepPx" });\n'
    + '    if (data.soxl && soxlWhen === "lead") lines.push({ key: "soxlPrice", label: "SOXL price", group: SOXL_PRICE, tall: true }, { key: "soxlLeadInPx", label: "Hold SOXL under", group: SOXL_PRICE }, { key: "soxlLeadOutPx", label: "Back to TQQQ over", group: SOXL_PRICE },\n'
    + '      { key: "soxlLead", label: "SOXL ahead of SOXX", unit: "%", group: SOXL_PANEL, tall: true, priceKey: "soxlPrice" }, { key: "soxlLeadIn", label: "Hold SOXL under", unit: "%", group: SOXL_PANEL, priceKey: "soxlLeadInPx" }, { key: "soxlLeadOut", label: "Back to TQQQ over", unit: "%", group: SOXL_PANEL, priceKey: "soxlLeadOutPx" });\n'
    + '    else if (data.soxl && soxlWhen !== "never" && soxlWhen !== "always") lines.push({ key: "soxlPrice", label: "SOXL price", group: SOXL_PANEL, tall: true }, soxlWhen === "belowAvg" ? { key: "soxlAvgLine", label: SW + "-day average", group: SOXL_PANEL } : { key: "soxlLine", label: Math.round(soxlDrop * 100) + "% under the " + SW + "-day high", group: SOXL_PANEL });\n', 'the chart lines');
  t = once(t, '      const hp = priceOf(held, i), holdingsValue = shares * hp;\n', '      const hp = priceOf(held, i), holdingsValue = shares * hp;\n' + joined, 'the holdings value line');
  t = once(t, '      log: log, lines: lines,\n', '      log: log, holdings: holdings, lines: lines,\n', 'the result object');
  t = once(t, '          date: dates[i], value: holdingsValue + cash, action: action, note: note,\n',
    '          date: dates[i], value: holdingsValue + cash + pileValue, action: action, note: note,\n          soxlPile: pileValue > 0 ? pileValue : null, soxlPut: pilePut > 0 ? pilePut : null,\n          soxlPrice: soxlPx > 0 && soxlHi[i] > 0 ? soxlPx : null, soxlLine: soxlHi[i] > 0 ? soxlHi[i] * (1 - soxlDrop) : null, soxlAvgLine: soxlAvg[i] > 0 ? soxlAvg[i] : null,\n          soxlLead: soxlLead[i] === soxlLead[i] ? soxlLead[i] : null, soxlLeadIn: soxlLead[i] === soxlLead[i] ? leadIn : null, soxlLeadOut: soxlLead[i] === soxlLead[i] ? leadOut : null,\n          soxlLeadInPx: soxlCrossAt(i, leadIn), soxlLeadOutPx: soxlCrossAt(i, leadOut),\n', 'the log row');
  if (!t.endsWith('    return res;\n  }\n}')) throw new Error(`withSoxlPile(${spec.name}): the base must end with its dashboard`);
  return t.slice(0, -'    return res;\n  }\n}'.length) + card + '    return res;\n  }\n}';
}
CODE[52] = withSoxlPile(CODE[50], { name: "SOXL, TQQQ VS QQQ, Mon Turns" });

// #53 — SOXL, TQQQ, QQQ - 1983 fit (the user, 2026-11-08: "let's create this
// new strategy, call soxl, tqqq, qqq - 1983 fit"): #52 with the settings the
// Fit button (Best CAGR) found on the whole chart, Q1 1953 to date, as its
// defaults (the name is the user's; the fit's 29.5% → 55.3% note matches the
// 1953 start with a $100K lump sum), sixteen of them changed from #52's. The
// ceiling's SQQQ limit of 61 stays as fitted at the user's call, though the
// defence's 18-day cap cuts every SQQQ hold first. The rules are the same. Built
// from #52's text at load, so a change to #47, #50 or #52 reaches it. Three of
// the fitted values lie between the dropdown's options (58.2%, −33%, 101%:
// the Fit's between-options stage); the dropdown shows such a value in its
// place (js/saved-configs.js customParamOptionsWithCurrent). The prices
// before 2010 are reconstructed, and the user's rule is to judge a strategy
// on 2010 onward: the card gives both periods.
function withDefaults(base, spec) {
  let t = base.replace(/^(\s*name:\s*)"[^"]+"/m, (m, pre) => `${pre}"${spec.name}"`);
  for (const [id, value] of Object.entries(spec.defaults)) {
    const head = `{ id: "${id}",`, at = t.indexOf(head);
    if (at < 0 || t.indexOf(head, at + 1) >= 0) throw new Error(`withDefaults(${spec.name}): the setting ${id} must appear exactly once in the base`);
    const next = t.indexOf('{ id: "', at + 1), end = next < 0 ? t.length : next;   // this setting's text runs to the next one's
    const entry = t.slice(at, end), m = /, default: ([^,}]+)/.exec(entry);
    if (!m) throw new Error(`withDefaults(${spec.name}): the setting ${id} declares no default`);
    t = t.slice(0, at) + entry.replace(m[0], ', default: ' + JSON.stringify(value)) + t.slice(end);
  }
  return t;
}
CODE[53] = withDefaults(CODE[52], { name: "SOXL, TQQQ, QQQ - 1983 fit", defaults: {
  lookbackDays: 543, topLead: 123, topDays: 61, backLead: 34, floorLead: 6, floorHold: "sqqq", reentryLead: 65, reentryCloses: 44, deepLead: -32.5,
  overPct: 58.2, overWindow: 236, sqqqMaxDays: 18, deepGuard: 52, nfciVeto: 0.75, soxlLeadEnter: -33, soxlLeadExit: 101 } });

// #54 — SOXL, TQQQ, QQQ - spread start (the user, 2026-11-09: "i want strategy,
// where rate will be considered, but should not be influenced by when it
// started measuring"): #52 with both leads measured from a spread of starting
// days instead of one block or one close. Each start price is an average of
// past closes weighted like a triangle: most weight at the lookback, falling
// in a straight line to nothing at ± the spread, so no single day and no edge
// of a block decides the lead, and a lookback moved by a day moves the lead by
// a hair. (#52 averages the TQQQ and QQQ starts over a ±65-day block and takes
// SOXL's and SOXX's from the one close 380 days back.) The lead thresholds are
// refit to the new measure, whose scale differs; every other setting is #52's.
// The cliffs the user saw (a lookback of 558 against 559 ending 110 times
// apart since 1953) were one close sitting 0.1 point from the deep-buy line on
// 2020-03-20, and no start measure removes them: the lines are all-or-nothing.
// Numbers in the card (js/strategy-library.js). Built from #52's text at load,
// so a change to #47, #50 or #52 reaches it.
function withSpreadStart(base) {
  const once = (text, find, repl, what) => {
    const at = text.indexOf(find);
    if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`withSpreadStart: ${what} must appear exactly once in the base`);
    return text.slice(0, at) + repl + text.slice(at + find.length);
  };
  let t = base;
  // The TQQQ-vs-QQQ lead: its settings' words, the ±W block setting becomes the spread.
  t = once(t, `tip: "How many trading days of buy & hold growth are compared: TQQQ's against QQQ's. 252 is about a year.", text: "Compare TQQQ's growth with QQQ's over the last {} trading days."`,
    `tip: "Where the start weight peaks: this many trading days back. 252 is about a year.", text: "Compare TQQQ's growth with QQQ's from a start centred {} trading days back."`, 'the lookback setting');
  t = once(t, `    { id: "startAvgDays", label: "Start averaged over ± (days)", tip: "Example: with a 550-day lookback and ±65, the start price is the average close from 615 to 485 days ago, so one day's price can't decide the lead. At 0 it is the close 550 days ago.", text: "Average the start price over ±{} days.", default: 65, options:
      Array.from({ length: 201 }, (_, k) => k) },
`, `    { id: "startSpreadPct", label: "Start spread (± % of the lookback)", tip: "The start price is an average of past closes weighted like a triangle: most weight at the lookback, falling in a straight line to nothing this far either side of it. Example: a 500-day lookback with 50% counts the closes from 750 to 250 days ago, the one 500 back most. No single day decides the lead.", text: "Spread the start over ±{} of the lookback, the closes nearest its centre counting most.", unit: "%", default: 75, options:
      Array.from({ length: 100 }, (_, k) => 1 + k) },
`, 'the start-average setting');
  t = once(t, `    const W = p.startAvgDays == null ? 65 : Math.max(0, Math.round(+p.startAvgDays));
`, `    const S = Math.max(1, Math.min(L, Math.round(L * (p.startSpreadPct == null ? 75 : +p.startSpreadPct) / 100)));   // the start triangle's half-width in days, at most the lookback: the start stays in the past
`, 'the block width');
  t = once(t, `    // The lead: TQQQ's growth over the lookback divided by QQQ's, minus 1, in
    // percent. Growth runs from the start price: the average close (geometric
    // mean) over the W closes either side of the day L back, or that day's
    // close when W is 0. With one day's close, lookbacks a week apart made 80%
    // to 141% a year (2010-2025): the lead swung with the day it started on.
`, `    // The lead: TQQQ's growth divided by QQQ's, minus 1, in percent. Growth
    // runs from the start price: the geometric mean of the closes L + S - 1 to
    // L - S + 1 days back, each weighted S minus its distance from L (a
    // triangle; the weights sum to S * S), so the close L back counts most and
    // the two ends count once. Prefix sums of log close and of day index times
    // log close give every day's start in constant time.
`, 'the lead comment');
  t = once(t, `    for (let i = L + W; i < n; i++) {
      const a = i - L - W, b = i - L + W + 1;
      if (!(T[i] > 0 && Q[i] > 0) || priced[b] - priced[a] !== b - a) continue;
      baseT[i] = W ? Math.exp((logT[b] - logT[a]) / (b - a)) : T[i - L];
      baseQ[i] = W ? Math.exp((logQ[b] - logQ[a]) / (b - a)) : Q[i - L];
`, `    const sT = new Float64Array(n + 1), sQ = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { const ok = T[i] > 0 && Q[i] > 0; sT[i + 1] = sT[i] + (ok ? i * Math.log(T[i]) : 0); sQ[i + 1] = sQ[i] + (ok ? i * Math.log(Q[i]) : 0); }
    const triSum = (P1, P2, c, s1, s2) => (S - c) * (P1[c + 1] - P1[s1]) + (P2[c + 1] - P2[s1]) + (S + c) * (P1[s2 + 1] - P1[c + 1]) - (P2[s2 + 1] - P2[c + 1]);
    for (let i = L + S; i < n; i++) {
      const c = i - L, s1 = c - S + 1, s2 = c + S - 1;   // the centre of the start and its first and last day
      if (!(T[i] > 0 && Q[i] > 0) || priced[s2 + 1] - priced[s1] !== s2 - s1 + 1) continue;
      baseT[i] = Math.exp(triSum(logT, sT, c, s1, s2) / (S * S));
      baseQ[i] = Math.exp(triSum(logQ, sQ, c, s1, s2) / (S * S));
`, 'the lead loop');
  // The SOXL-vs-SOXX lead: the one close LD back becomes the same triangle, with its own spread setting.
  t = once(t, `tip: "How many trading days of growth are compared: SOXL's against SOXX's. 380 is about 18 months; 350 to 450 all beat the price rules since 2010.", text: "The lead is SOXL's growth against SOXX's over the last {} trading days."`,
    `tip: "Where SOXL's start weight peaks: this many trading days back. 380 is about 18 months.", text: "The lead is SOXL's growth against SOXX's from a start centred {} trading days back."`, 'the SOXL lookback setting');
  t = once(t, `, 675, 700, 725, 750] },
`, `, 675, 700, 725, 750] },
    { id: "soxlStartSpreadPct", label: "SOXL start spread (± % of the lookback)", tip: "SOXL's and SOXX's start prices are averages of past closes weighted like a triangle: most weight at the lead lookback, falling in a straight line to nothing this far either side of it.", text: "Spread SOXL's start over ±{} of its lookback.", unit: "%", default: 25, options:
      Array.from({ length: 100 }, (_, k) => 1 + k) },
`, 'the SOXL lookback options');
  t = once(t, `    const soxlLead = new Float64Array(n).fill(NaN), soxlBase = new Float64Array(n).fill(NaN);   // soxlBase: the SOXL price at a lead of 0% today
    if (data.soxl && data.soxx) {
      let on = false;
      for (let i = LD; i <= p.endIdx; i++) {
        const s0 = data.soxl[i - LD], x0 = data.soxx[i - LD];
        if (!(s0 > 0 && x0 > 0 && data.soxl[i] > 0 && data.soxx[i] > 0) || dates[i - LD] < SOXL_FROM) continue;
`, `    const SS = Math.max(1, Math.min(LD, Math.round(LD * (p.soxlStartSpreadPct == null ? 25 : +p.soxlStartSpreadPct) / 100)));   // the SOXL start triangle's half-width in days
    const soxlLead = new Float64Array(n).fill(NaN), soxlBase = new Float64Array(n).fill(NaN);   // soxlBase: the SOXL price at a lead of 0% today
    if (data.soxl && data.soxx) {
      // Each fund's start price: the triangle-weighted geometric mean of its closes LD ± SS days back, as the TQQQ lead's; every day of it priced and on or after SOXL_FROM.
      const lS = new Float64Array(n + 1), lX = new Float64Array(n + 1), sS = new Float64Array(n + 1), sX = new Float64Array(n + 1), pSX = new Int32Array(n + 1);
      for (let i = 0; i < n; i++) { const ok = data.soxl[i] > 0 && data.soxx[i] > 0 && dates[i] >= SOXL_FROM, a = ok ? Math.log(data.soxl[i]) : 0, b = ok ? Math.log(data.soxx[i]) : 0; lS[i + 1] = lS[i] + a; lX[i + 1] = lX[i] + b; sS[i + 1] = sS[i] + i * a; sX[i + 1] = sX[i] + i * b; pSX[i + 1] = pSX[i] + (ok ? 1 : 0); }
      const triSumSx = (P1, P2, c, s1, s2) => (SS - c) * (P1[c + 1] - P1[s1]) + (P2[c + 1] - P2[s1]) + (SS + c) * (P1[s2 + 1] - P1[c + 1]) - (P2[s2 + 1] - P2[c + 1]);
      let on = false;
      for (let i = LD + SS; i <= p.endIdx; i++) {
        const c = i - LD, s1 = c - SS + 1, s2 = c + SS - 1;
        if (!(data.soxl[i] > 0 && data.soxx[i] > 0) || pSX[s2 + 1] - pSX[s1] !== s2 - s1 + 1) continue;
        const s0 = Math.exp(triSumSx(lS, sS, c, s1, s2) / (SS * SS)), x0 = Math.exp(triSumSx(lX, sX, c, s1, s2) / (SS * SS));
`, 'the SOXL lead loop');
  return t;
}
// Defaults: the lead settings fitted to 2010-2025 on this measure ($100K lump
// sum, research/lead-basis/fit.cjs --kernel tri: the SOXL lead first with the
// TQQQ lead at #52's words, then the TQQQ lead with that SOXL lead fixed, eight
// starts), the rest #52's. Both leads chose a quarter spread with 10% to 100%
// offered. A second SOXL pass against the new TQQQ settings found 0.9 points
// more with a zero-width band (SOXL in and out at the same 49.7% lead) and was
// not taken: the band exists to keep a hovering lead from switching every few
// days. The fit's floor (56.8%) sits above its deep buy (32.5%): sold under the
// floor, it buys back either far lower or once the lead is back over 92.5%.
CODE[54] = withDefaults(withSpreadStart(CODE[52]), { name: "SOXL, TQQQ, QQQ - spread start", defaults: {
  lookbackDays: 600, startSpreadPct: 25, topLead: 97.1, backLead: 78.7, floorLead: 56.8, reentryLead: 92.5, deepLead: 32.5,
  soxlLeadDays: 500, soxlStartSpreadPct: 25, soxlLeadEnter: 27.4, soxlLeadExit: 33.9 } });

// ===== The SMA strategy as code =============================================
// The user (2026-11-04): "I want built in sma panel ... converted into code,
// but still keeping all functionality as is, and the result should stay
// exactly the same." run() below carries the app's own SMA engine
// (js/simulate.js simulateSMA) and the tables it reads (js/data.js) as their
// source text, copied in when this file loads, and calls the engine the way a
// saved SMA strategy's line was computed (js/saved-configs.js, type "sma"):
// both run the same instructions on the same prices. The library's SMA entries
// (#43 and the overfit rows #33-#38) are this code with their own defaults.
//
// In node (the tests, the widget, the backtest harness) the page scripts the
// engine comes from may not be loaded yet: load what is missing.
if (typeof simulateSMA === 'undefined' && typeof require === 'function') {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  if (typeof rollingSMA === 'undefined') vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'));
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'simulate.js'), 'utf8'));
}
const SMA_ENGINE_SOURCE = [wilderAverages, rollingSMA, rollingRSI, makeLazyIndicator, precomputeSMASeries, lastOfPeriod,
  getQuarter, getMonth, periodRows, _mondayOf, isWeekEnd, buildFormulaSchedule, simulateSMA].map(String).join('\n')
  + `\nconst SMA_ASSET_COL = ${JSON.stringify(SMA_ASSET_COL)}, SMA_UNLEVERAGED_OF = ${JSON.stringify(SMA_UNLEVERAGED_OF)};`;

// The settings, from the built-in SMA panel (index.html): its values, labels
// and tips, one dropdown per sentence piece. `select` is that panel's dropdown,
// for moving saved SMA strategies and old links over (SMA_PARAM_OF_SELECT);
// it stays out of the strategy's code.
const SMA_SETTINGS = [
  {section: "Signal"},
  {id: "fund",select: "select-sma-underlying",label: "Fund bought",text: "Buy {}",options: [{value: "tqqq",label: "TQQQ"},{value: "qld",label: "QLD"},{value: "sso",label: "SSO"},{value: "spxl",label: "SPXL"},{value: "sqqq",label: "SQQQ"},{value: "gld",label: "GLD"},{value: "soxl",label: "SOXL"},{value: "soxx",label: "SOXX"},{value: "qqq",label: "QQQ"},{value: "spy",label: "SPY"}]},
  {id: "signal",select: "select-sma-asset",label: "Signal from",text: "when {}",options: [{value: "qqq",label: "QQQ"},{value: "spy",label: "SPY"},{value: "tqqq",label: "TQQQ"},{value: "qld",label: "QLD"},{value: "sso",label: "SSO"},{value: "spxl",label: "SPXL"},{value: "sqqq",label: "SQQQ"},{value: "gld",label: "GLD"},{value: "soxl",label: "SOXL"},{value: "soxx",label: "SOXX"}]},
  {id: "window",select: "select-sma-window",label: "Average window (days)",text: "closes above its {}-day average price.",options: [5].concat(Array.from({ length: 18 }, (_, k) => 10 + 10 * k), Array.from({ length: 40 }, (_, k) => 181 + k), Array.from({ length: 22 }, (_, k) => 230 + 10 * k), Array.from({ length: 52 }, (_, k) => 449 + k))},
  {id: "entryBuf",select: "select-sma-entry-buf",label: "Buy buffer (%)",text: "Require at least {} above the average to buy,",unit: "%",options: Array.from({ length: 21 }, (_, k) => +(0.1 * k).toFixed(1)).concat([2.5, 3], Array.from({ length: 81 }, (_, k) => +(3.2 + 0.1 * k).toFixed(1)), Array.from({ length: 39 }, (_, k) => 12 + k))},
  {id: "exitBuf",select: "select-sma-exit-buf",label: "Sell buffer (%)",text: "and {} below it to sell.",unit: "%",options: Array.from({ length: 21 }, (_, k) => +(0.1 * k).toFixed(1)).concat(Array.from({ length: 6 }, (_, k) => +(2.5 + 0.5 * k).toFixed(1)), Array.from({ length: 7 }, (_, k) => 6 + k), Array.from({ length: 81 }, (_, k) => +(12.4 + 0.1 * k).toFixed(1)), Array.from({ length: 30 }, (_, k) => 21 + k))},
  {section: "Confirmation"},
  {id: "confirmBuy",select: "select-sma-confirm-buy",label: "Buy confirmation (days)",text: "Only buy after the signal holds for {} days,",options: [{ value: 0, label: "0 (instant)" }].concat(Array.from({ length: 100 }, (_, k) => 1 + k))},
  {id: "confirmSell",select: "select-sma-confirm-sell",label: "Sell confirmation (days)",text: "and sell after {} days.",options: [{ value: 0, label: "0 (instant)" }].concat(Array.from({ length: 100 }, (_, k) => 1 + k)),tip: "Stops jumpy in-and-out trading. The price must stay on the new side of the line this many days before you trade. Example: set to 3 — if QQQ dips below the line for a day then bounces, you don't sell. It must close below 3 days straight. 0 = trade the first day it crosses."},
  {id: "settleDays",select: "select-sma-settle",label: "Settlement days",text: "After any trade, wait {} trading days before the next.",fit: false,options: [{value: 0,label: "0 (instant)"},1,2,3,4,5],tip: "Cash-account settlement (T+N). After you buy or sell, the money/shares haven't settled yet — so you can't make the next trade for this many trading days. Models the real broker rule where selling too soon after a buy (or buying right after a sell) isn't allowed. Example: set to 2 — sell on Monday, you can't buy back until Wednesday. 0 = settles instantly (no restriction)."},
  {section: "RSI"},
  {id: "rsiSellWindow",select: "select-sma-rsi-oh-window",label: "RSI sell window (days)",text: "Also sell when RSI({})",options: Array.from({ length: 100 }, (_, k) => 2 + k),tip: "RSI is a 0–100 speed gauge: • above ~70 = ran up fast, often pulls back • below ~30 = beaten down, often bounces The number inside RSI( ) = how many days it looks back (2–30). 2 = twitchy, reacts to every wiggle. 30 = smooth and slow. 10 is a common middle. This is the sell-side RSI only — the buy rule below has its own."},
  {id: "rsiSell",select: "select-sma-rsi-oh",label: "RSI sell level",text: "is {}.",options: (Array.from({ length: 190 }, (_, k) => +(5 + 0.5 * k).toFixed(1))).map(v => ({ value: v, label: "above " + v })).concat([{ value: 0, label: "off — never force a sell" }])},
  {id: "rsiBuyWindow",select: "select-sma-rsi-cool-window",label: "RSI buy window (days)",text: "Only buy once RSI({})",options: Array.from({ length: 100 }, (_, k) => 2 + k)},
  {id: "rsiBuy",select: "select-sma-rsi-cool",label: "RSI buy level",text: "is {}.",options: (Array.from({ length: 190 }, (_, k) => +(5 + 0.5 * k).toFixed(1))).map(v => ({ value: v, label: "below " + v })).concat([{ value: 0, label: "at any level (off)" }]),tip: "After a buy signal, wait for the price to cool off instead of chasing. Example: set to 40 — you hold until RSI dips under 40 (a pullback), then buy. The number inside RSI( ) = look-back days (2–30). Off = buy as soon as the buy signal appears."},
  {section: "What to hold when you sell"},
  {id: "outAsset",select: "select-sma-out-asset",label: "Held when out",text: "When out of the market, hold {} instead.",options: ["cash",{value: "qqq",label: "QQQ"},{value: "spy",label: "SPY"},{value: "tqqq",label: "TQQQ"},{value: "qld",label: "QLD"},{value: "sso",label: "SSO"},{value: "spxl",label: "SPXL"},{value: "sqqq",label: "SQQQ"},{value: "gld",label: "GLD"},{value: "soxl",label: "SOXL"},{value: "soxx",label: "SOXX"}],tip: "What you hold after a sell. • cash — just waits, earning the interest rate below • QQQ / SPY — keeps your money in the plain, non-leveraged market: much safer than the 3× fund, but still grows if the market drifts up Example: sell TQQQ → sit in QQQ → jump back to TQQQ when the buy signal returns."},
  {id: "cashRate",select: "select-sma-cashrate",label: "Cash interest (%/yr)",text: "That cash earns {} a year.",fit: false,when: {outAsset: "cash"},options: [{value: 0,label: "0.0%"},{value: 0.5,label: "0.5%"},{value: 1,label: "1.0%"},{value: 1.5,label: "1.5%"},{value: 2,label: "2.0%"},{value: 2.5,label: "2.5%"},{value: 3,label: "3.0%"},{value: 3.5,label: "3.5%"},{value: 4,label: "4.0%"},{value: 4.5,label: "4.5%"},{value: 5,label: "5.0%"},{value: 5.5,label: "5.5%"},{value: 6,label: "6.0%"},{value: 6.5,label: "6.5%"},{value: 7,label: "7.0%"},{value: 7.5,label: "7.5%"},{value: 8,label: "8.0%"},{value: 8.5,label: "8.5%"},{value: 9,label: "9.0%"},{value: 9.5,label: "9.5%"},{value: 10,label: "10.0%"},{value: 10.5,label: "10.5%"},{value: 11,label: "11.0%"},{value: 11.5,label: "11.5%"},{value: 12,label: "12.0%"},{value: 12.5,label: "12.5%"},{value: 13,label: "13.0%"},{value: 14,label: "14.0%"},{value: 15,label: "15.0%"},{value: 16,label: "16.0%"},{value: 18,label: "18.0%"},{value: 20,label: "20.0%"}],tip: "While you're out of the market and sitting in cash, this is the yearly interest that cash earns — like a savings account or T-bills. Example: 4% = idle cash grows about 4% a year while you wait to buy back in."},
  {section: "Ease into your trades",tip: "By default every trade happens all at once. Here you can spread a buy across several months — a slice each month, so you're not betting everything on one day's price. Only buying is spread; every sell still happens the same day. Example: set the backup ease to 5 days — the day the strategy goes out it sells your primary fund to cash right away, then buys into the backup fund a slice each trading day for the next five days. Pick 2 months and it spreads that buy across roughly two months instead. If the buy signal comes back before it finishes, it stops and rotates into the primary fund."},
  {id: "easeIn",select: "select-sma-dca-in",label: "Ease in",text: "When you buy, ease into the primary fund over {}.",options: [{ value: 0, label: "instant" }].concat((Array.from({ length: 130 }, (_, k) => 1 + k).concat(Array.from({ length: 6 }, (_, k) => 147 + 21 * k))).map(v => ({ value: v, label: v >= 42 && v % 21 === 0 ? v / 21 + " months" : v + (v === 1 ? " day" : " days") })))},
  {id: "easeOut",select: "select-sma-dca-to-out",label: "Ease out",text: "When you sell, ease into your backup holding over {}.",options: [{ value: 0, label: "instant" }].concat((Array.from({ length: 130 }, (_, k) => 1 + k).concat(Array.from({ length: 6 }, (_, k) => 147 + 21 * k))).map(v => ({ value: v, label: v >= 42 && v % 21 === 0 ? v / 21 + " months" : v + (v === 1 ? " day" : " days") }))),tip: "Only matters if you park in QQQ/SPY instead of cash. On a sell it dumps the 3× fund right away, then eases into QQQ/SPY over this many months. Example: 6 = move a sixth of the money each month for six months. If the buy signal returns mid-way, it stops and switches back to the 3× fund."},
  {section: "Trading cost"},
  {id: "tradeCost",select: "select-sma-cost",label: "Trading cost (%)",text: "Each buy or sell costs {} in fees and slippage.",unit: "%",fit: false,options: [0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1],tip: "What each trade costs you — broker fees plus slippage (the gap between the price you expect and the price you actually get). Charged on every buy AND every sell, so switching funds pays it twice. Example: 0.1% turns a $10,000 buy into $9,990 of fund. A strategy that trades often pays it many times, so raising it shows how much real-world friction eats into the result."},
  {section: "Bubble insurance",tip: "A safety brake for bubbles. When the market has run far above its average line (think 1999 or late 2021), holding a 3× fund is extra risky — so this rule sells everything to cash early, no matter what the main buy/sell signal says. It measures how far the ticker you pick sits above its own moving average, and it's separate from \"What to hold when you sell\" above (that only decides where normal trend exits go)."},
  {id: "brakeAsset",select: "select-sma-bg-asset",label: "Bubble brake reads",text: "Sell everything to cash when {}",options: [{value: "qqq",label: "QQQ"},{value: "spy",label: "SPY"},{value: "tqqq",label: "TQQQ"},{value: "qld",label: "QLD"},{value: "sso",label: "SSO"},{value: "spxl",label: "SPXL"},{value: "sqqq",label: "SQQQ"},{value: "gld",label: "GLD"},{value: "soxl",label: "SOXL"},{value: "soxx",label: "SOXX"}]},
  {id: "brakePct",select: "select-sma-bg-gtfo",label: "Bubble brake level",text: "is {}",options: (Array.from({ length: 200 }, (_, k) => 1 + k)).map(v => ({ value: v, label: "+" + v + "%" })).concat([{ value: 0, label: "off" }])},
  {id: "brakeWindow",select: "select-sma-bg-window",label: "Bubble brake average (days)",text: "above its {}-day average.",options: [5].concat(Array.from({ length: 16 }, (_, k) => 10 + 10 * k), Array.from({ length: 81 }, (_, k) => 165 + k), Array.from({ length: 26 }, (_, k) => 250 + 10 * k))}
];
const SMA_PARAM_OF_SELECT = Object.fromEntries(SMA_SETTINGS.filter(s => s.id).map(s => [s.select, s.id]));

// The code of an SMA strategy whose settings default to `defaults` ({ id: value }).
function smaStrategyCode(name, defaults) {
  const params = SMA_SETTINGS.map(s => {
    if (!s.id) return s;
    const { select, ...p } = s;
    if (!(s.id in defaults)) throw new Error(`smaStrategyCode(${name}): no default for ${s.id}`);
    return Object.assign(p, { default: defaults[s.id] });
  });
  return `{
  name: ${JSON.stringify(name)},
  params: ${JSON.stringify(params, null, 1).replace(/\n\s*/g, ' ')},
  columns: [
    { key: "signalClose", label: "Signal", tip: "The signal fund's close, the price the rules compare with its average." },
    { key: "average", label: "Average", tip: "The signal fund's moving average over the window." },
    { key: "rsiSell", label: "RSI sell", tip: "RSI over the sell window: a close at or above the sell level sells." },
    { key: "rsiBuy", label: "RSI buy", tip: "RSI over the buy window: a buy waits until it is under the buy level." },
    { key: "brakeGauge", label: "Bubble gauge", tip: "How far the bubble brake's fund sits above its own average, in percent." } ],
  run(data, p) {
    // ---- The app's SMA engine and the tables it reads (js/data.js, js/simulate.js) ----
${SMA_ENGINE_SOURCE}
    // ---- Its inputs, rebuilt from the prices the way the page builds them (js/init.js) ----
    const daily = data.dates.map((date, i) => ({ date, tqqq: data.tqqq[i], qqq: data.qqq[i], spy: data.spy[i], qld: data.qld[i], sso: data.sso[i], spxl: data.spxl[i], sqqq: data.sqqq[i], gld: data.gld[i], soxl: data.soxl[i], soxx: data.soxx[i] }));
    const dailyDateToIdx = new Map(data.dates.map((d, i) => [d, i]));
    const quarterlyData = periodRows(daily, getQuarter), monthlyData = periodRows(daily, getMonth);
    let smaAtDailyByKey, smaAtMonthlyByKey, rsiAtDailyByKey, rsiAtMonthlyByKey, dailyRows;
    precomputeSMASeries();
    const entryDate = p.entryDate || data.dates[p.startIdx], exitDate = p.exitDate || data.dates[p.endIdx];
    // The call a saved SMA strategy's line made (js/saved-configs.js), its
    // window pinned to this run's first and last day and its deposits from p.
    // The quarter range only says where the line is sampled (every quarter end
    // inside the window, as on the page); trades and values come from the dates.
    const r = simulateSMA(p.initial, p.monthly, (+p.cashRate || 0) / 100, 0, quarterlyData.length - 1, p.annualRaise, {
      schedule: { byDate: new Map(Object.entries(p.contributions || {})) },
      entryDateOverride: entryDate, exitDateOverride: exitDate,
      smaAsset: p.signal || "qqq", smaWindow: +p.window || 200, underlyingCol: SMA_ASSET_COL[p.fund] || 1,
      entryBufferPct: +p.entryBuf || 0, exitBufferPct: +p.exitBuf || 0,
      rsiOverheatThreshold: +p.rsiSell || 0, rsiCoolThreshold: +p.rsiBuy || 0,
      outAsset: p.outAsset || "cash", dcaInMonths: +p.easeIn || 0, dcaToOutMonths: +p.easeOut || 0,
      bgGtfoPct: +p.brakePct || 0, bgAsset: p.brakeAsset || "qqq", bgWindow: +p.brakeWindow || 0, tradeCostPct: +p.tradeCost || 0,
      rsiOhWindow: +p.rsiSellWindow || 10, rsiCoolWindow: +p.rsiBuyWindow || 10, rebalanceCheck: "daily",
      confirmBuySteps: +p.confirmBuy || 0, confirmSellSteps: +p.confirmSell || 0, settleDays: +p.settleDays || 0,
      emitDD: true, sampleWeekly: !!p.weeklyDisplay,
    });
    return smaResult(r);

    // ---- The engine's result as this strategy's log, holdings, dashboard and lines ----
    function smaResult(r) {
      const sig = p.signal || "qqq", SIG = sig.toUpperCase(), FUND = String(p.fund || "tqqq").toUpperCase();
      const W = +p.window || 200, entryBuf = +p.entryBuf || 0, exitBuf = +p.exitBuf || 0;
      const rsiSellLvl = +p.rsiSell || 0, rsiBuyLvl = +p.rsiBuy || 0, brakeLvl = +p.brakePct || 0;
      const brakeAsset = p.brakeAsset || "qqq", brakeW = +p.brakeWindow || W;
      const avgArr = smaAtDailyByKey[sig + "_" + W] || [], brakeArr = smaAtDailyByKey[brakeAsset + "_" + brakeW] || [];
      const rsiS = rsiAtDailyByKey[sig + "_" + (+p.rsiSellWindow || 10)] || [], rsiB = rsiAtDailyByKey[sig + "_" + (+p.rsiBuyWindow || 10)] || [];
      const num = (v) => (typeof v === "number" && isFinite(v)) ? v : undefined;
      // The signal fund's close today that would put its RSI on a level, from
      // yesterday's Wilder averages (as the app's SMA panel draws it): the level
      // lines name it in brackets, for an order at a price.
      const rsiLevel = (prev, ag, al, n, x) => {
        if (!(x > 0 && x < 100) || !(prev > 0) || ag == null || al == null) return undefined;
        const rs = x / (100 - x), m = n - 1, rise = m * (rs * al - ag);
        return rise >= 0 ? prev + rise : prev - m * (ag / rs - al);
      };
      const wS = rsiSellLvl > 0 ? wilderAverages(data[sig], +p.rsiSellWindow || 10) : null, wB = rsiBuyLvl > 0 ? wilderAverages(data[sig], +p.rsiBuyWindow || 10) : null;
      const rsiLevelPx = (w, n, lvl, i) => w && i > 0 ? rsiLevel(data[sig][i - 1], w.ag[i - 1], w.al[i - 1], n, lvl) : undefined;
      // The readings every log row carries, for the columns and the signal chart.
      const reading = (i) => {
        const a = num(avgArr[i]), b = num(brakeArr[i]), o = { signalClose: data[sig][i] };
        if (a != null) { o.average = a; if (entryBuf > 0) o.buyLine = a * (1 + entryBuf / 100); if (exitBuf > 0) o.sellLine = a * (1 - exitBuf / 100); }
        if (num(rsiS[i]) != null) { o.rsiSell = rsiS[i]; if (rsiSellLvl > 0) { o.rsiSellLevel = rsiSellLvl; o.rsiSellLevelPx = rsiLevelPx(wS, +p.rsiSellWindow || 10, rsiSellLvl, i); } }
        if (num(rsiB[i]) != null) { o.rsiBuy = rsiB[i]; if (rsiBuyLvl > 0) { o.rsiBuyLevel = rsiBuyLvl; o.rsiBuyLevelPx = rsiLevelPx(wB, +p.rsiBuyWindow || 10, rsiBuyLvl, i); } }
        if (b != null && data[brakeAsset][i] > 0) { o.brakeGauge = (data[brakeAsset][i] / b - 1) * 100; o.brakePrice = data[brakeAsset][i]; if (brakeLvl > 0) { o.brakeLevel = brakeLvl; o.brakeLevelPx = b * (1 + brakeLvl / 100); } }
        return o;
      };
      const pct = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) + "%";
      // Why a trade fired, from the readings on its day, and the panel it marks.
      const why = (e, i, rd) => {
        const gap = rd.average ? (rd.signalClose / rd.average - 1) * 100 : null, vs = gap == null ? "" : SIG + " " + pct(gap) + " vs its " + W + "-day average";
        if (e.action === "BG-GTFO") return ["Sold to cash: the bubble brake, " + brakeAsset.toUpperCase() + " " + pct(rd.brakeGauge || 0) + " vs its " + brakeW + "-day average", "Bubble brake"];
        if (e.action === "BG-CLEAR") return ["Bought " + FUND + ": the bubble brake released, " + vs, "Bubble brake"];
        if (e.action === "EXIT") {
          if (rsiSellLvl > 0 && rd.rsiSell >= rsiSellLvl && !(gap != null && gap < -exitBuf)) return ["Sold " + FUND + ": RSI(" + (+p.rsiSellWindow || 10) + ") " + rd.rsiSell.toFixed(1) + " at or above " + rsiSellLvl, "RSI"];
          return ["Sold " + FUND + " to " + (e.held === "cash" ? "cash" : String(e.held).toUpperCase()) + ": " + vs, SIG + " trend"];
        }
        if (e.action === "ENTER") return ["Bought " + FUND + ": " + vs + (rsiBuyLvl > 0 && rd.rsiBuy != null ? ", RSI(" + (+p.rsiBuyWindow || 10) + ") " + rd.rsiBuy.toFixed(1) : ""), SIG + " trend"];
        if (e.action === "DCA-ADD") return ["Easing in: another slice of " + String(e.held).toUpperCase(), SIG + " trend"];
        return ["", null];
      };
      const ACTION = { START: "start", ENTER: "buy", EXIT: "sell", "BG-GTFO": "sell", "BG-CLEAR": "buy", "DCA-ADD": "ease-in", CONTRIB: "contribution", END: "end" };
      // Which of a day's events names its row: a sale or buy over easing in, over a deposit.
      const RANK = { "BG-GTFO": 5, EXIT: 5, ENTER: 4, "BG-CLEAR": 4, "DCA-ADD": 3, CONTRIB: 2, START: 1, END: 1 };
      const HELD = (h) => h === "cash" ? "CASH" : String(h).toUpperCase();
      const events = new Map();
      for (const e of r.smaLog || []) { if (!events.has(e.date)) events.set(e.date, []); events.get(e.date).push(e); }
      const points = new Map((r.smaPoints || []).map(pt => [pt.date, pt]));
      const holdAt = new Map((r.ddControls || []).map(c => [c.date, c]));
      const days = new Set([...events.keys(), ...points.keys()]);
      if (p.dailyDisplay) for (const c of r.ddControls || []) days.add(c.date);
      const valueOf = (c, i) => { let v = c.cash || 0; for (const a in c.h) v += c.h[a] * (data[a][i] || 0); return v; };
      const log = [];
      // One row per logged day, at the day's closing value: the engine's sampled
      // point, else its holdings after the day.
      for (const date of [...days].sort()) {
        const i = dailyDateToIdx.get(date), rd = reading(i), evs = events.get(date) || [];
        const pt = points.get(date), c = holdAt.get(date);
        const value = pt ? pt.value : c ? valueOf(c, i) : evs[evs.length - 1].total;
        if (!evs.length) { log.push(Object.assign({ date, value, action: "hold", note: "" }, rd)); continue; }
        // The day's events as one row: its main trade, the day's deposits and
        // fees, the holdings after its last event.
        const main = evs.reduce((a, b) => (RANK[b.action] || 0) > (RANK[a.action] || 0) ? b : a), last = evs[evs.length - 1];
        const [note, firedBy] = why(main, i, rd);
        const contributed = evs.reduce((s, e) => s + (e.action === "CONTRIB" ? e.contribAmt || 0 : 0), 0);
        const row = Object.assign({ date, value, action: main.action === "EXIT" && main.held !== "cash" ? "switch" : (ACTION[main.action] || "hold"), note,
          held: HELD(last.held), price: last.price, shares: last.shares, cash: last.cash, fee: evs.reduce((s, e) => s + (e.fee || 0), 0), invested: last.invested }, rd);
        if (contributed) row.contributed = contributed;
        if (firedBy) row.firedBy = firedBy;
        log.push(row);
      }
      const lines = [
        { key: "signalClose", label: SIG + " close", group: SIG + " trend" }, { key: "average", label: W + "-day average", group: SIG + " trend" } ];
      if (entryBuf > 0) lines.push({ key: "buyLine", label: "Buy above (+" + entryBuf + "%)", group: SIG + " trend" });
      if (exitBuf > 0) lines.push({ key: "sellLine", label: "Sell below (−" + exitBuf + "%)", group: SIG + " trend" });
      if (rsiSellLvl > 0 || rsiBuyLvl > 0) {
        if (rsiSellLvl > 0) lines.push({ key: "rsiSell", label: "RSI(" + (+p.rsiSellWindow || 10) + ")", unit: "num", group: "RSI", priceKey: "signalClose" }, { key: "rsiSellLevel", label: "Sell at " + rsiSellLvl, unit: "num", group: "RSI", priceKey: "rsiSellLevelPx" });
        if (rsiBuyLvl > 0) lines.push({ key: "rsiBuy", label: "RSI(" + (+p.rsiBuyWindow || 10) + ")", unit: "num", group: "RSI", priceKey: "signalClose" }, { key: "rsiBuyLevel", label: "Buy under " + rsiBuyLvl, unit: "num", group: "RSI", priceKey: "rsiBuyLevelPx" });
      }
      if (brakeLvl > 0) lines.push({ key: "brakeGauge", label: brakeAsset.toUpperCase() + " vs " + brakeW + "-day average", unit: "%", group: "Bubble brake", priceKey: "brakePrice" }, { key: "brakeLevel", label: "To cash at +" + brakeLvl + "%", unit: "%", group: "Bubble brake", priceKey: "brakeLevelPx" });
      return { log, holdings: r.ddControls || [], lines, signals: smaSignals() };
    }

    // ---- The dashboard: where each rule stands on the run's last day (as the built-in panel's) ----
    function smaSignals() {
      const di = p.endIdx, sig = p.signal || "qqq", AN = sig.toUpperCase(), W = +p.window || 200;
      const avg = (smaAtDailyByKey[sig + "_" + W] || [])[di];
      if (avg == null) return null;
      const price = data[sig][di], gap = (price / avg - 1) * 100, above = price > avg;
      const entryBuf = +p.entryBuf || 0, exitBuf = +p.exitBuf || 0, ohWin = +p.rsiSellWindow || 10, coolWin = +p.rsiBuyWindow || 10;
      const rsiOh = +p.rsiSell || 0, rsiCool = +p.rsiBuy || 0, bgAsset = p.brakeAsset || "qqq", bgGtfo = +p.brakePct || 0, bgWin = +p.brakeWindow || W;
      const arr = smaAtDailyByKey[sig + "_" + W];
      let runDays = 0;
      for (let j = di; j >= 0; j--) { const s = arr[j]; if (s == null) break; if ((data[sig][j] > s) === above) runDays++; else break; }
      const money = (v) => "$" + (v >= 100 ? v.toFixed(2) : v.toPrecision(4));
      const pctS = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) + "%";
      const rsiAt = (w) => { const a = rsiAtDailyByKey[sig + "_" + w]; return a && a[di] != null ? a[di] : null; };
      const ohV = rsiAt(ohWin), clV = rsiAt(coolWin);
      const bgArr = smaAtDailyByKey[bgAsset + "_" + bgWin], bgPct = bgArr && bgArr[di] != null ? (data[bgAsset][di] / bgArr[di] - 1) * 100 : null;
      const rsiCard = (label, w, v, thr, cmp) => ({ label: "RSI(" + w + ") · " + label, icon: "activity", value: v == null ? "—" : v.toFixed(1),
        sub: thr <= 0 ? "off" : v == null ? "" : cmp + " " + thr + ((cmp === "above" ? v >= thr : v <= thr) ? " · hit" : ""),
        tone: thr > 0 && v != null && (cmp === "above" ? v >= thr : v <= thr) ? "bad" : undefined,
        tip: "Relative Strength Index over " + w + " days on " + AN + ", a 0–100 momentum gauge. " + (cmp === "above" ? "Sell rule: exit when it climbs above the overheat level." : "Buy rule: wait until it cools below this level before re-entering.") });
      const cards = [
        { label: AN + " vs " + W + "-day avg", icon: above ? "trendUp" : "trendDown", value: (above ? "▲ " : "▼ ") + pctS(gap), tone: above ? "good" : "bad",
          sub: money(price) + " vs " + money(avg) + " avg", tip: "The signal ticker's latest close vs its " + W + "-day moving average. Above the average the trend rule leans in; below, out." },
        { label: "Days " + (above ? "above" : "below") + " avg", icon: "clock", value: String(runDays), sub: "since " + AN + " last crossed",
          tip: "How many trading days in a row " + AN + " has stayed on its current side of the moving average." } ];
      if (entryBuf > 0 || exitBuf > 0) cards.push({ label: "Buffer bands", icon: "sliders", value: "+" + entryBuf + "% / −" + exitBuf + "%",
        sub: "buy > " + money(avg * (1 + entryBuf / 100)) + " · sell < " + money(avg * (1 - exitBuf / 100)),
        tip: "You only buy once the price is " + entryBuf + "% above the average, and only sell once it is " + exitBuf + "% below." });
      cards.push(rsiCard("sell", ohWin, ohV, rsiOh, "above"), rsiCard("buy", coolWin, clV, rsiCool, "below"));
      if (bgPct != null) cards.push({ label: bgAsset.toUpperCase() + " vs " + bgWin + "-day avg", icon: "shield", value: pctS(bgPct),
        tone: bgGtfo > 0 && bgPct >= bgGtfo ? "bad" : bgPct >= 0 ? "good" : "bad", sub: bgGtfo > 0 && bgPct >= bgGtfo ? "armed — would sell to cash" : bgGtfo > 0 ? "to cash at +" + bgGtfo + "%" : "off",
        tip: "The bubble-insurance gauge: how far " + bgAsset.toUpperCase() + " sits above its own " + bgWin + "-day average." + (bgGtfo > 0 ? " At +" + bgGtfo + "% the brake sells everything to cash." : " The brake is off.") });
      const P = String(p.fund || "tqqq").toUpperCase(), backup = p.outAsset || "cash", B = backup === "cash" ? "cash" : backup.toUpperCase();
      const trendIn = gap > entryBuf, hot = rsiOh > 0 && ohV != null && ohV >= rsiOh, blocked = rsiCool > 0 && clV != null && clV >= rsiCool, armed = bgGtfo > 0 && bgPct != null && bgPct >= bgGtfo;
      const reasons = [{ name: "Trend", val: AN + " " + pctS(gap) + " vs " + W + "d", tag: trendIn ? "in · " + P : "out · " + B, lean: trendIn ? "buy" : "out" }];
      if (rsiOh > 0) reasons.push({ name: "Overheat", val: "RSI(" + ohWin + ") " + (ohV == null ? "—" : ohV.toFixed(1)), tag: hot ? "sell ≥" + rsiOh : "clear", lean: hot ? "out" : "buy" });
      if (rsiCool > 0) reasons.push({ name: "Re-entry", val: "RSI(" + coolWin + ") " + (clV == null ? "—" : clV.toFixed(1)), tag: blocked ? "wait <" + rsiCool : "open", lean: blocked ? "out" : "buy" });
      if (bgGtfo > 0) reasons.push({ name: "Bubble", val: bgAsset.toUpperCase() + " " + (bgPct == null ? "—" : pctS(bgPct)), tag: armed ? "cash +" + bgGtfo + "%" : "off", lean: armed ? "cash" : "buy" });
      const easeIn = +p.easeIn || 0;
      const decision = armed ? { action: "Move to cash", note: "the bubble brake overrides the trend", tone: "bad", reasons }
        : trendIn && !hot && !blocked ? { action: "Buy " + P, note: easeIn > 1 ? "eased in over " + easeIn + " trading days" : "all at once", tone: "good", reasons }
        : { action: B === "cash" ? "Stay in cash" : "Buy " + B, note: B === "cash" ? "buy signal is off" : "the backup fund — buy signal is off", tone: "bad", reasons };
      return { cards, decision };
    }
  }
}`;
}

// The library's SMA entries: the app's SMA 200 (#43) and the SMA overfit
// explorer's rows (#33-#38), each at its own settings (its former preset).
// SMA_LIBRARY_NUMBERS also tells js/saved-configs.js which entries a saved SMA
// strategy of the old kind can be a copy of (smaAsCodeConfig).
const SMA_LIBRARY = {
  43: ["SMA 200", {"fund": "tqqq", "signal": "qqq", "window": 200, "entryBuf": 0, "exitBuf": 0, "confirmBuy": 0, "confirmSell": 0, "settleDays": 1, "rsiSellWindow": 9, "rsiSell": 90, "rsiBuyWindow": 7, "rsiBuy": 80, "outAsset": "cash", "cashRate": 4, "easeIn": 15, "easeOut": 15, "tradeCost": 0.02, "brakeAsset": "tqqq", "brakePct": 40, "brakeWindow": 200}],
  33: ["SMA · max return 2010–2025", {"fund": "sso", "signal": "spy", "window": 280, "entryBuf": 5, "exitBuf": 1.9, "confirmBuy": 3, "confirmSell": 10, "settleDays": 5, "rsiSellWindow": 3, "rsiSell": 20, "rsiBuyWindow": 22, "rsiBuy": 55, "outAsset": "tqqq", "cashRate": 0, "easeIn": 10, "easeOut": 5, "tradeCost": 0.02, "brakeAsset": "tqqq", "brakePct": 55, "brakeWindow": 250}],
  34: ["SMA · min drawdown 2010–2025", {"fund": "tqqq", "signal": "qqq", "window": 30, "entryBuf": 0.1, "exitBuf": 3.5, "confirmBuy": 3, "confirmSell": 10, "settleDays": 1, "rsiSellWindow": 4, "rsiSell": 65, "rsiBuyWindow": 17, "rsiBuy": 65, "outAsset": "sso", "cashRate": 0, "easeIn": 7, "easeOut": 42, "tradeCost": 0.02, "brakeAsset": "sso", "brakePct": 35, "brakeWindow": 270}],
  35: ["SMA · max return 1990–2025", {"fund": "spy", "signal": "qqq", "window": 30, "entryBuf": 13, "exitBuf": 12, "confirmBuy": 0, "confirmSell": 10, "settleDays": 5, "rsiSellWindow": 6, "rsiSell": 80, "rsiBuyWindow": 16, "rsiBuy": 70, "outAsset": "tqqq", "cashRate": 0, "easeIn": 7, "easeOut": 25, "tradeCost": 0.02, "brakeAsset": "sso", "brakePct": 30, "brakeWindow": 270}],
  36: ["SMA · min drawdown 1990–2025", {"fund": "tqqq", "signal": "spxl", "window": 220, "entryBuf": 0, "exitBuf": 5, "confirmBuy": 0, "confirmSell": 10, "settleDays": 0, "rsiSellWindow": 2, "rsiSell": 15, "rsiBuyWindow": 8, "rsiBuy": 45, "outAsset": "cash", "cashRate": 0, "easeIn": 4, "easeOut": 12, "tradeCost": 0.02, "brakeAsset": "sso", "brakePct": 30, "brakeWindow": 270}],
  37: ["SMA · max return 1953–2025", {"fund": "tqqq", "signal": "spxl", "window": 20, "entryBuf": 0.4, "exitBuf": 0.4, "confirmBuy": 0, "confirmSell": 0, "settleDays": 0, "rsiSellWindow": 12, "rsiSell": 80, "rsiBuyWindow": 17, "rsiBuy": 0, "outAsset": "spy", "cashRate": 0, "easeIn": 1, "easeOut": 6, "tradeCost": 0.02, "brakeAsset": "qld", "brakePct": 35, "brakeWindow": 300}],
  38: ["SMA · min drawdown 1953–2025", {"fund": "qld", "signal": "spxl", "window": 20, "entryBuf": 0.5, "exitBuf": 0.3, "confirmBuy": 0, "confirmSell": 0, "settleDays": 1, "rsiSellWindow": 8, "rsiSell": 85, "rsiBuyWindow": 25, "rsiBuy": 75, "outAsset": "cash", "cashRate": 0, "easeIn": 0, "easeOut": 5, "tradeCost": 0.02, "brakeAsset": "qqq", "brakePct": 20, "brakeWindow": 250}]
};
const SMA_LIBRARY_NUMBERS = Object.keys(SMA_LIBRARY).map(Number);
for (const n of SMA_LIBRARY_NUMBERS) CODE[n] = smaStrategyCode(...SMA_LIBRARY[n]);

// ===== The 9sig strategy as code ============================================
// Same recipe as the SMA strategy above (the user, 2026-11-04: "when you
// complete sma, let's get started with 9sig too"): run() carries the app's own
// 9sig engine (js/simulate.js simulate) and the tables and calendars it reads
// (js/data.js, js/utils.js fmt) as their source text, rebuilds them from the
// prices as js/init.js does, and calls the engine the way a saved 9sig
// strategy's line was computed (js/saved-configs.js, type "9sig"). The
// library's 9sig entries (#42 and the overfit rows #27-#32) are this code with
// their own defaults.
if (typeof simulate === 'undefined' && typeof require === 'function') {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  if (typeof rollingSMA === 'undefined') vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'));
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'simulate.js'), 'utf8'));
}
if (typeof fmt === 'undefined' && typeof require === 'function') {
  // utils.js touches the window when it loads, so node takes only fmt from it.
  const src = require('fs').readFileSync(require('path').join(__dirname, 'utils.js'), 'utf8'), start = src.indexOf('function fmt(');
  let end = src.indexOf('{', start), depth = 0;
  for (; end < src.length; end++) { if (src[end] === '{') depth++; else if (src[end] === '}' && --depth === 0) break; }
  require('vm').runInThisContext(src.slice(start, end + 1));
}
const NINESIG_ENGINE_SOURCE = [simulate, buildFormulaSchedule, walkWeekEnds, isWeekEnd, _mondayOf, fmt, lastOfPeriod, getQuarter,
  getMonth, getWeek, getYear, periodRows, buildPeriodData, buildMonthsInPeriod, precomputePeriodSeries, precomputeMonthlyByQuarter,
  buildEnvelopeQData, buildExactRangeQData].map(String).join('\n')
  + `\nconst PERIOD_DAYS = ${JSON.stringify(PERIOD_DAYS)}, COL_TO_DAILY_KEY = ${JSON.stringify(COL_TO_DAILY_KEY)}, SMA_ASSET_COL = ${JSON.stringify(SMA_ASSET_COL)};`;

// The settings, from the built-in 9sig panel (index.html, its "what if" part
// included): values, labels and tips; `select` as for SMA_SETTINGS.
const NINESIG_SETTINGS = [
  {section: "Start"},
  {id: "cashPct",select: "select-9sig-cash",label: "Entry cash share (%)",text: "Divide the entry amount into {}",unit: "%",options: Array.from({ length: 101 }, (_, k) => k)},
  {id: "parkAsset",select: "select-9sig-park-asset",label: "Safety slice held in",text: "held as {}",options: ["cash",{value: "qqq",label: "QQQ"},{value: "spy",label: "SPY"},{value: "qld",label: "QLD"},{value: "tqqq",label: "TQQQ"},{value: "sso",label: "SSO"},{value: "spxl",label: "SPXL"},{value: "sqqq",label: "SQQQ"},{value: "gld",label: "GLD"},{value: "soxl",label: "SOXL"},{value: "soxx",label: "SOXX"}],tip: "By default the safety slice (your cash %) is held as cash, earning the rate below. Pick QQQ/SPY/etc. instead to hold that slice in that fund — new money and rebalances buy into it, and the cash interest stops applying. Picking a leveraged fund leverages both slices."},
  {id: "fund",select: "select-9sig-underlying",label: "Fund",text: "and use the rest to buy {}.",options: [{value: "tqqq",label: "TQQQ"},{value: "qld",label: "QLD"},{value: "sso",label: "SSO"},{value: "spxl",label: "SPXL"},{value: "sqqq",label: "SQQQ"},{value: "gld",label: "GLD"},{value: "soxl",label: "SOXL"},{value: "soxx",label: "SOXX"},{value: "qqq",label: "QQQ"},{value: "spy",label: "SPY"}]},
  {id: "cashRate",select: "select-9sig-cashrate",label: "Cash interest (%/yr)",text: "That parked cash earns {} a year.",fit: false,when: {parkAsset: "cash"},options: [{value: 0,label: "0.0%"},{value: 0.5,label: "0.5%"},{value: 1,label: "1.0%"},{value: 1.5,label: "1.5%"},{value: 2,label: "2.0%"},{value: 2.5,label: "2.5%"},{value: 3,label: "3.0%"},{value: 3.5,label: "3.5%"},{value: 4,label: "4.0%"},{value: 4.5,label: "4.5%"},{value: 5,label: "5.0%"},{value: 5.5,label: "5.5%"},{value: 6,label: "6.0%"},{value: 6.5,label: "6.5%"},{value: 7,label: "7.0%"},{value: 7.5,label: "7.5%"},{value: 8,label: "8.0%"},{value: 8.5,label: "8.5%"},{value: 9,label: "9.0%"},{value: 9.5,label: "9.5%"},{value: 10,label: "10.0%"},{value: 10.5,label: "10.5%"},{value: 11,label: "11.0%"},{value: 11.5,label: "11.5%"},{value: 12,label: "12.0%"},{value: 12.5,label: "12.5%"},{value: 13,label: "13.0%"},{value: 14,label: "14.0%"},{value: 15,label: "15.0%"},{value: 16,label: "16.0%"},{value: 18,label: "18.0%"},{value: 20,label: "20.0%"}],tip: "Annual interest the 9sig strategy's idle cash earns between rebalances. Independent of the SMA and Invested Compounded rates."},
  {section: "Target"},
  {id: "period",select: "select-9sig-period",label: "Rebalance every",text: "Rebalance {}",options: ["weekly","monthly","quarterly","yearly"],tip: "How often you rebalance. Classical 9sig is quarterly with a 9% per-quarter target, so the growth rate next to this is read as 'per chosen period' — quarterly + 9% means the target grows 9% every quarter."},
  {id: "growth",select: "select-9sig-growth",label: "Target growth (%)",text: "and grow the target by {}.",unit: "%",options: Array.from({ length: 6 }, (_, k) => +(0.5 + 0.1 * k).toFixed(1)).concat(Array.from({ length: 12 }, (_, k) => +(1.5 + 0.5 * k).toFixed(1)), Array.from({ length: 85 }, (_, k) => +(7.1 + 0.1 * k).toFixed(1)), Array.from({ length: 29 }, (_, k) => +(16 + 0.5 * k).toFixed(1)), Array.from({ length: 120 }, (_, k) => 31 + k)),tip: "A 9% target growth per quarter is the standard setting for 3× ETFs (TQQQ, SPXL) — drop it for 2× (QLD, SSO)."},
  {section: "Crash and rally"},
  {id: "crashDrop",select: "select-9sig-crashdrop",label: "Crash hold after a fall of (%)",text: "In a crash, hold instead of selling once the stock has fallen {}",unit: "%",options: Array.from({ length: 100 }, (_, k) => 1 + k).concat(Array.from({ length: 5 }, (_, k) => 110 + 10 * k), [180])},
  {id: "crashWindow",select: "select-9sig-crashwin",label: "Crash high over the past",text: "below its past {} high.",options: (Array.from({ length: 120 }, (_, k) => 1 + k)).map(v => ({ value: v, label: v % 12 === 0 && v >= 24 ? v / 12 + " years" : v % 3 === 0 ? v / 3 + (v === 3 ? " quarter" : " quarters") : v + (v === 1 ? " month" : " months") })),tip: "When the stock has fallen this far below its recent peak, skip the usual sell for up to two quarters in a row (standard 9sig is quarterly) so you don't dump at the bottom. The lookback window controls how far back 'recent peak' looks — standard 9sig uses 2 years."},
  {id: "spikeTarget",select: "select-9sig-spike-target",label: "Stock share after profits",text: "After a big rally, take profits back down to {}",unit: "%",options: Array.from({ length: 101 }, (_, k) => k)},
  {id: "spike",select: "select-9sig-spike",label: "Rally gain that takes profits (%)",text: "stock once gains hit {} in one period.",unit: "%",options: [{ value: 0, label: "off" }].concat([5, 10].concat(Array.from({ length: 106 }, (_, k) => 15 + k), Array.from({ length: 36 }, (_, k) => 125 + 5 * k), [350, 400, 500])),tip: "If the stock jumps this much in a single quarter (standard 9sig is quarterly), force a rebalance back to your starting stock weight so a runaway spike doesn't leave you too concentrated in the fund. Set to off to let a rally run."},
  {section: "Buying and costs"},
  {id: "buyPower",select: "select-9sig-buypower",label: "Largest buy, share of cash (%)",text: "A buy never spends more than {} of your cash.",unit: "%",options: Array.from({ length: 100 }, (_, k) => 1 + k),tip: "When the signal says buy, this caps how much of your cash goes in, so you always keep some spare cash. Standard 9sig spends 90% (keeps 10%). Set to 100% to spend all your cash on every buy."},
  {id: "tradeCost",select: "select-9sig-cost",label: "Trading cost (%)",text: "Each rebalance trade costs {} in fees and slippage.",unit: "%",fit: false,options: [0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1],tip: "Trading cost charged on the dollars traded at each rebalance — sells, buys, spike resets, and any contribution deployed straight into stock. 0.02% is a realistic retail estimate; raise it to see how much a wider spread costs."},
  {section: "What if"},
  {id: "deploy",select: "select-9sig-deploy",label: "Contributions straight into stock (%)",text: "Put {} of each contribution straight into stock.",unit: "%",options: [0].concat(Array.from({ length: 99 }, (_, k) => 2 + k)),tip: "Only affects monthly contributions (not the initial amount). At 0%, 9sig holds each contribution as cash until the next rebalance; a higher % buys that share of the fund at that month's price."},
  {id: "rebalancePoint",select: "select-9sig-rebalance-point",label: "Rebalance point (%)",text: "Rebalance {} of the way through each period.",unit: "%",fit: false,options: [0,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100],tip: "Where within each rebalance period the check happens: 0% = near the start of the period, 100% = near the end. Test how sensitive the strategy is to the exact rebalance day."},
  {id: "targetBase",select: "select-9sig-target-compound",label: "Target grows from",text: "Grow each period's target from the {}.",options: [{value: "holding",label: "prior holding"},{value: "target",label: "prior target"}],tip: "Example (9% growth): if last period's target was $10,000 but you only held $8,000, the next target is $8,720 (8,000 × 1.09) from the prior holding, or $10,900 (10,000 × 1.09) from the prior target."}
];
const NINESIG_PARAM_OF_SELECT = Object.fromEntries(NINESIG_SETTINGS.filter(s => s.id).map(s => [s.select, s.id]));

function nineSigStrategyCode(name, defaults) {
  const params = NINESIG_SETTINGS.map(s => {
    if (!s.id) return s;
    const { select, ...p } = s;
    if (!(s.id in defaults)) throw new Error(`nineSigStrategyCode(${name}): no default for ${s.id}`);
    return Object.assign(p, { default: defaults[s.id] });
  });
  return `{
  name: ${JSON.stringify(name)},
  params: ${JSON.stringify(params, null, 1).replace(/\n\s*/g, ' ')},
  columns: [
    { key: "holding", label: "Holding", tip: "What the fund side is worth after the day's trades." },
    { key: "target", label: "Target", tip: "The value the fund side is steered to: last target grown by the target growth, plus half of new money." },
    { key: "cashValue", label: "Cash side", tip: "The safety slice: cash, or the fund it is parked in." } ],
  series: [
    { key: "holding", label: "Holding", dash: "dot" }, { key: "target", label: "Target", dash: "dash" }, { key: "cashValue", label: "Cash", dash: "dashdot" } ],
  run(data, p) {
    // ---- The app's 9sig engine and what it reads (js/simulate.js, js/data.js, js/utils.js) ----
${NINESIG_ENGINE_SOURCE}
    // ---- Its inputs, rebuilt from the prices as the page builds them (js/init.js) ----
    const daily = data.dates.map((date, i) => ({ date, tqqq: data.tqqq[i], qqq: data.qqq[i], spy: data.spy[i], qld: data.qld[i], sso: data.sso[i], spxl: data.spxl[i], sqqq: data.sqqq[i], gld: data.gld[i], soxl: data.soxl[i], soxx: data.soxx[i] }));
    const dailyDateToIdx = new Map(data.dates.map((d, i) => [d, i]));
    const quarterlyData = periodRows(daily, getQuarter), monthlyData = periodRows(daily, getMonth);
    let weeklyData = null, yearlyData = null, periodDataByName = null, monthsInPeriodByName = null, monthlyByQuarter = null;
    precomputePeriodSeries();
    precomputeMonthlyByQuarter();
    const entryDate = p.entryDate || data.dates[p.startIdx], exitDate = p.exitDate || data.dates[p.endIdx];
    const period = p.period || "quarterly", cd = +p.crashDrop, sp = +p.spike;
    // A quarter window runs on its quarter rows; exact days (the chart's date
    // picker, p.exactWindow, or any window not on quarter ends) run on a calendar
    // of those days, as the page does.
    const qEntry = quarterlyData.findIndex(r => r[0] === entryDate), qExit = quarterlyData.findIndex(r => r[0] === exitDate);
    const exact = !!p.exactWindow || qEntry < 0 || qExit < 0;
    const qa = exact ? 0 : qEntry, qb = exact ? quarterlyData.length - 1 : qExit;
    const opts = {
      ...(exact ? { entryDateOverride: entryDate, exitDateOverride: exitDate } : {}),
      // A real transaction history arrives as dated deposits; the engine also reads
      // them by month. Formula deposits are rebuilt by the engine itself.
      ...(p.depositsFromHistory ? { schedule: historySchedule(p.contributions || {}) } : {}),
      qGrowth: (+p.growth) / 100 || 0.09, underlyingCol: SMA_ASSET_COL[p.fund] || 1,
      crashDropPct: Number.isFinite(cd) ? cd : 30, crashLookbackMonths: +p.crashWindow || 24,
      spikeTriggerPct: Number.isFinite(sp) ? sp : 100, rebalancePeriod: period,
      cashPct: (+p.cashPct || 0) / 100, contribDeployPct: +p.deploy === 1 ? 0.5 : (+p.deploy || 0) / 100,
      targetFromPrevTarget: ["target", "1"].includes(String(p.targetBase)),
      parkAsset: p.parkAsset || "cash", buyThrottlePct: +p.buyPower || 90,
      spikeResetPct: p.spikeTarget == null || p.spikeTarget === "" ? "auto" : String(p.spikeTarget), tradeCostPct: +p.tradeCost || 0,
      sampleQuarterly: p.displayGrain ? (p.displayGrain === "quarterly" && period === "yearly") : (period === "yearly"),
      sampleWeekly: p.displayGrain === "weekly" && period !== "weekly", skipBH: true,
    };
    const rp = +p.rebalancePoint || 0;
    if (rp > 0) { const q = buildEnvelopeQData(period, Math.round(rp / 100 * ((PERIOD_DAYS[period] || 63) - 1)), entryDate, exitDate); if (q && q.length >= 2) opts.qData = q; }
    if (!opts.qData && exact) { const q2 = buildExactRangeQData(period, entryDate, exitDate); if (q2 && q2.length >= 2) opts.qData = q2; }
    const r = simulate(p.initial, p.monthly, (+p.cashRate || 0) / 100, qa, qb, p.annualRaise, opts);
    return nineSigResult(r, opts);

    // Dated deposits in the shape a transaction history has (js/transactions.js).
    function historySchedule(byDateObj) {
      const byDate = new Map(), byMonth = new Map(), list = [], priceDateByMonth = new Map();
      for (const d of Object.keys(byDateObj).sort()) {
        const amount = byDateObj[d], month = d.slice(0, 7);
        byDate.set(d, amount); byMonth.set(month, (byMonth.get(month) || 0) + amount);
        list.push({ date: d, amount }); priceDateByMonth.set(month, d);
      }
      return { byDate, byMonth, list, priceDateByMonth };
    }

    // ---- The engine's result as this strategy's log, holdings, lines and explanation ----
    function nineSigResult(r, opts) {
      const FUND = String(p.fund || "tqqq").toUpperCase(), fundKey = String(p.fund || "tqqq"), PARK = p.parkAsset && p.parkAsset !== "cash" ? String(p.parkAsset).toUpperCase() : "cash";
      // The line: the engine's sample points when it samples, else its rebalance rows (as the page drew it).
      const sampling = opts.sampleQuarterly || opts.sampleWeekly;
      // On a rebalance day the row's values come from the line the page drew (the
      // sample point when sampling, taken after the day's deposit), its trade from the rebalance.
      const rows = new Map();
      for (const l of r.log || []) rows.set(l.date, { l, ev: l });
      for (const l of sampling ? (r.samplePoints || []) : []) { const at = rows.get(l.date); rows.set(l.date, { l, ev: at ? at.ev : null }); }
      const money = (v) => "$" + Math.round(Math.abs(v)).toLocaleString("en-US");
      const verb = (a) => /^BUY/.test(a) ? "buy" : /^SELL/.test(a) ? "sell" : /^RESET/.test(a) ? "reset" : /^START/.test(a) ? "start" : "hold";
      const why = (l) => {
        const a = String(l.action || "");
        if (/^START/.test(a)) return "Started: " + (100 - (+p.cashPct || 0)) + "% in " + FUND + ", " + (+p.cashPct || 0) + "% held as " + PARK;
        if (/^SELL/.test(a)) return "Sold " + a.replace(/^SELL\\s*/, "").replace(/ \\(30d expired\\)/, "") + " of " + FUND + ": above its target" + (/30d expired/.test(a) ? " (the crash hold ran out)" : "");
        if (/^BUY/.test(a)) return "Bought " + a.replace(/^BUY\\s*/, "").replace(/ \\(part\\)/, "") + " of " + FUND + ": under its target" + (/\\(part\\)/.test(a) ? ", capped by the buying power" : "");
        if (/^RESET/.test(a)) return "Took profits: " + FUND + " jumped past the rally level, sold " + a.replace(/^RESET\\s*/, "").replace(/ \\(spike\\)/, "");
        if (/^HOLD \\(30d/.test(a)) return "Held instead of selling: " + FUND + " is in a crash (" + a.replace(/^HOLD /, "") + ")";
        return a === "HOLD" ? "On target, nothing to trade" : "";
      };
      const ACTION = { buy: "rebalance", sell: "rebalance", reset: "rebalance", start: "start", hold: "hold" };
      const holdings = [], log = [];
      for (const date of [...rows.keys()].sort()) {
        const { l, ev } = rows.get(date), i = dailyDateToIdx.get(date);
        const row = { date, value: l.total, holding: l.tqqqVal, target: l.target, cashValue: l.cash, fundPrice: data[fundKey][i] };
        if (ev) Object.assign(row, { action: ACTION[verb(ev.action)], note: why(ev), held: FUND, price: ev.price, shares: ev.price > 0 ? ev.tqqqVal / ev.price : 0,
          cash: ev.cash, fee: ev.fee || 0, invested: ev.invested });
        else row.action = "hold";
        log.push(row);
      }
      // The drawdown the page measured: the fund's shares and the cash after each rebalance, revalued daily.
      for (const l of r.log || []) holdings.push({ date: l.date, h: { [fundKey]: l.price > 0 ? l.tqqqVal / l.price : 0 }, cash: l.cash });
      // The detail run behind the signal chart's zoom: every day, the holding at that day's close against the target.
      if (p.dailyDisplay && holdings.length) {
        const byDate = new Map(log.map(x => [x.date, x])), ctl = holdings;
        let k = 0, lastTarget = log.length ? log[0].target : null;
        for (let i = dailyDateToIdx.get(ctl[0].date); i <= p.endIdx; i++) {   // to the window's last day: after the last rebalance its holdings stand
          const d = data.dates[i];
          while (k + 1 < ctl.length && ctl[k + 1].date <= d) k++;
          if (byDate.has(d)) { lastTarget = byDate.get(d).target; continue; }
          const sh = ctl[k].h[fundKey], hv = sh * data[fundKey][i];
          byDate.set(d, { date: d, value: hv + ctl[k].cash, action: "hold", holding: hv, target: lastTarget, cashValue: ctl[k].cash, fundPrice: data[fundKey][i] });
        }
        log.length = 0; log.push(...[...byDate.values()].sort((a, b) => a.date < b.date ? -1 : 1));
      }
      const lines = [{ key: "holding", label: FUND + " holding" }, { key: "target", label: "Target" }];
      return { log, holdings, lines, explain: nineSigExplain() };
    }

    // ---- "9sig explained": the rules with the current settings (the built-in panel's block) ----
    function nineSigExplain() {
      const ul = String(p.fund || "tqqq").toUpperCase(), g = +p.growth || 9, cd = Number.isFinite(+p.crashDrop) ? +p.crashDrop : 30, spk = +p.spike;
      const cashP = +p.cashPct || 0, stockP = 100 - cashP, bp = +p.buyPower || 90;
      const crashRule = cd >= 100 ? "(30-down protection: off at " + cd + "%)"
        : "When " + ul + " is more than **" + cd + "%** below its 2-year high, **skip selling for up to two quarters in a row** — don't dump in a crash. After two skips, sell anyway.";
      const spikeRule = !(spk > 0) ? "(Spike-reset: off)"
        : "If " + ul + " **gains more than " + spk + "% in a single quarter** and you still hold ≥" + stockP + "% in it, hard-rebalance back to " + stockP + "/" + cashP + " — lock in the windfall.";
      return [
        "## 9sig explained",
        "**The idea:** each quarter, " + ul + " should grow by " + g + "%. If it grew faster, sell the excess to cash. If slower, buy more with cash. That's it.",
        "## How it actually works",
        "**1. Start.** Put " + stockP + "% of your money in " + ul + ", " + cashP + "% in cash. Write down the value of the " + ul + " side — that's your **target**.",
        "**2. Every quarter, before deciding anything:**",
        "- Grow the target by **" + g + "%**.",
        "- If you added new cash this quarter (monthly contributions), raise the target by **half** of that new cash too.",
        "**3. Now check " + ul + " against the target:**",
        "- **" + ul + " worth more than target?** Sell the excess back to cash.",
        "- **" + ul + " worth less than target?** Buy more from cash to close the gap.",
        "- **Equal?** Hold.",
        "## Safety rails",
        "- **" + bp + "% buying power.** A buy never spends more than " + bp + "% of your cash" + (bp < 100 ? " — you keep some spare cash" : "") + ".",
        "- **30-down no-sell.** " + crashRule,
        "- **Spike reset.** " + spikeRule,
        "Monthly contributions always go straight to cash (never directly into " + ul + ") — the quarterly rebalance is what moves money into stock. The target rising by half of new cash keeps it honest: half of every dollar you add is \\"expected\\" to flow into " + ul + " eventually.",
      ].join("\\n\\n");
    }
  }
}`;
}

// The library's 9sig entries: the app's 9sig (#42) and the 9sig overfit
// explorer's rows (#27-#32), each at its own settings (its former preset).
const NINESIG_LIBRARY = {
  42: ["9sig", {"cashPct": 40, "parkAsset": "cash", "fund": "tqqq", "cashRate": 4, "period": "quarterly", "growth": 9, "crashDrop": 30, "crashWindow": 24, "spikeTarget": 60, "spike": 100, "buyPower": 90, "tradeCost": 0.02, "deploy": 0, "rebalancePoint": 0, "targetBase": "holding"}],
  27: ["9sig · max return 2010–2025", {"cashPct": 90, "parkAsset": "cash", "fund": "tqqq", "cashRate": 4, "period": "monthly", "growth": 130, "crashDrop": 5, "crashWindow": 24, "spikeTarget": 0, "spike": 25, "buyPower": 100, "tradeCost": 0.02, "deploy": 75, "rebalancePoint": 10, "targetBase": "holding"}],
  28: ["9sig · min drawdown 2010–2025", {"cashPct": 70, "parkAsset": "qld", "fund": "tqqq", "cashRate": 4, "period": "yearly", "growth": 12, "crashDrop": 25, "crashWindow": 21, "spikeTarget": 0, "spike": 100, "buyPower": 70, "tradeCost": 0.02, "deploy": 0, "rebalancePoint": 10, "targetBase": "holding"}],
  29: ["9sig · max return 1990–2025", {"cashPct": 0, "parkAsset": "cash", "fund": "tqqq", "cashRate": 4, "period": "yearly", "growth": 150, "crashDrop": 5, "crashWindow": 36, "spikeTarget": 0, "spike": 200, "buyPower": 100, "tradeCost": 0.02, "deploy": 100, "rebalancePoint": 0, "targetBase": "holding"}],
  30: ["9sig · min drawdown 1990–2025", {"cashPct": 70, "parkAsset": "cash", "fund": "tqqq", "cashRate": 4, "period": "quarterly", "growth": 0.5, "crashDrop": 5, "crashWindow": 60, "spikeTarget": 0, "spike": 250, "buyPower": 70, "tradeCost": 0.02, "deploy": 50, "rebalancePoint": 30, "targetBase": "holding"}],
  31: ["9sig · max return 1953–2025", {"cashPct": 40, "parkAsset": "cash", "fund": "tqqq", "cashRate": 4, "period": "quarterly", "growth": 40, "crashDrop": 25, "crashWindow": 24, "spikeTarget": 0, "spike": 160, "buyPower": 85, "tradeCost": 0.02, "deploy": 100, "rebalancePoint": 30, "targetBase": "target"}],
  32: ["9sig · min drawdown 1953–2025", {"cashPct": 60, "parkAsset": "cash", "fund": "tqqq", "cashRate": 4, "period": "yearly", "growth": 15, "crashDrop": 20, "crashWindow": 48, "spikeTarget": 25, "spike": 50, "buyPower": 50, "tradeCost": 0.02, "deploy": 0, "rebalancePoint": 15, "targetBase": "holding"}]
};
const NINESIG_LIBRARY_NUMBERS = Object.keys(NINESIG_LIBRARY).map(Number);
for (const n of NINESIG_LIBRARY_NUMBERS) CODE[n] = nineSigStrategyCode(...NINESIG_LIBRARY[n]);

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
  Object.defineProperty(module.exports, 'SMA_LIBRARY_NUMBERS', { value: SMA_LIBRARY_NUMBERS });
  Object.defineProperty(module.exports, 'NINESIG_LIBRARY_NUMBERS', { value: NINESIG_LIBRARY_NUMBERS });
}
