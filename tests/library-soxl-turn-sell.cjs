/*
 * The turn sell of library strategies #53 (the 1983 fit) and #71 (steady fit),
 * the second choice of how SOXL goes back to TQQQ: once its lead over SOXX has
 * turned down, where the default is a fixed lead level (withSoxlTurnSell in
 * js/strategy-library-code.js). The lead
 * rule holds SOXL from the first close with the lead under the buy level; the
 * turn sell ends that at the first close with the lead a set number of points
 * under its highest close since then, counted once that high has passed a level.
 * Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. the settings: the choice, with the level as the default; the level shown
 *      only with the level, the turn sell's two numbers only with the turn sell;
 *   2. the rule's state, worked out here from the SOXL and SOXX prices alone,
 *      against what the strategy's chart rows say: the sell line is drawn on
 *      exactly the closes where a sale can come, at the lead's high less the
 *      points, and the strategy never holds SOXL on a close where the state
 *      worked out here had it sold two closes ago or earlier;
 *   3. a sale by the turn says so, names the high, and happens under the line;
 *      one made with the lead still under the buy level is not undone by a buy
 *      at the next close;
 *   4. at the default, the level, the line and the notes are the level's.
 *
 *   node tests/library-soxl-turn-sell.cjs
 */
const { data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const START = data.dates.findIndex(d => d >= '2010-01-04'), END = data.dates.length - 1;
const TURN = { soxlSell: 'turn' };
const run = (n, settings = {}) => { const strategy = strategyOf(n); return strategy.run(data, { ...defaultsOf(strategy), ...settings, initial: 100000, contributions: {}, startIdx: START, endIdx: END, dailyDisplay: true }); };

// The rule, written again here from the prices: the lead at every close, and the turn sell's state.
// held[i]: the rule holds SOXL at close i; line[i]: the lead under which it sells at close i (NaN: none yet).
// A sale made with the lead still under the buy level is not bought back until the lead has closed at the
// buy level or over it once.
function turnState({ days, enter, points, from }) {
  const n = data.dates.length, lead = new Float64Array(n).fill(NaN), held = new Uint8Array(n), line = new Float64Array(n).fill(NaN);
  let on = false, high = -Infinity, soldUnder = false;
  for (let i = days; i < n; i++) {
    const s0 = data.soxl[i - days], x0 = data.soxx[i - days], s = data.soxl[i], x = data.soxx[i];
    if (!(s0 > 0 && x0 > 0 && s > 0 && x > 0)) { held[i] = on ? 1 : 0; continue; }
    lead[i] = ((s / s0) / (x / x0) - 1) * 100;
    if (!on) {
      if (lead[i] >= enter) soldUnder = false;
      else if (!soldUnder) { on = true; high = lead[i]; }
    } else {
      high = Math.max(high, lead[i]);
      if (high > from) { line[i] = high - points; if (lead[i] < line[i]) { on = false; soldUnder = lead[i] < enter; } }
    }
    held[i] = on ? 1 : 0;
  }
  return { lead, held, line };
}

for (const [n, name] of [[53, '#53'], [71, '#71']]) {
  const strategy = strategyOf(n), defaults = defaultsOf(strategy), byId = Object.fromEntries(settingsOf(strategy).map(param => [param.id, param]));

  // ---- 1. The settings ----
  ck(`${name} ships the level, with the turn sell set to 30 points, counted from 50%`, defaults.soxlSell === 'level' && defaults.soxlTrail === 30 && defaults.soxlTrailFrom === 50, JSON.stringify([defaults.soxlSell, defaults.soxlTrail, defaults.soxlTrailFrom]));
  ck(`${name} the choice offers the level and the turn`, byId.soxlSell.options.map(o => o.value).join() === 'level,turn');
  ck(`${name} the level shows only with the level, the turn sell's numbers only with the turn`,
    byId.soxlLeadExit.when.soxlSell === 'level' && byId.soxlTrail.when.soxlSell === 'turn' && byId.soxlTrailFrom.when.soxlSell === 'turn' && [byId.soxlLeadExit, byId.soxlTrail, byId.soxlTrailFrom, byId.soxlSell].every(param => param.when.soxlWhen === 'lead'));
  ck(`${name} the shipped numbers are among their options`, byId.soxlTrail.options.includes(30) && byId.soxlTrailFrom.options.includes(50));

  // ---- 2. The state worked out here against the strategy's chart rows ----
  // The shipped numbers, two others, and a buy level over the sell line's lowest place (40% against 50% − 30).
  [{}, { soxlTrail: 60, soxlTrailFrom: 100 }, { soxlTrail: 15, soxlTrailFrom: 0, soxlLeadEnter: -10 }, { soxlLeadEnter: 40 }].forEach(changed => {
    const settings = { ...defaults, ...changed }, tag = `${name} ${settings.soxlTrail} points from ${settings.soxlTrailFrom}%, bought under ${settings.soxlLeadEnter}%:`;
    const own = turnState({ days: settings.soxlLeadDays, enter: settings.soxlLeadEnter, points: settings.soxlTrail, from: settings.soxlTrailFrom });
    const log = run(n, { ...TURN, ...changed }).log;
    const rows = log.map(row => ({ row, i: data.dates.indexOf(row.date) }));
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    const leadOff = rows.filter(({ row, i }) => (row.soxlLead == null) !== !(own.lead[i] === own.lead[i]) || (row.soxlLead != null && !near(row.soxlLead, own.lead[i])));
    ck(`${tag} the lead in the rows is the lead worked out here`, rows.length > 4000 && leadOff.length === 0, `${leadOff.length} of ${rows.length} closes differ`);
    const lineOff = rows.filter(({ row, i }) => (row.soxlLeadOut == null) !== !(own.line[i] === own.line[i]) || (row.soxlLeadOut != null && !near(row.soxlLeadOut, own.line[i])));
    ck(`${tag} the sell line is there on the closes a sale can come, at the high less the points`, lineOff.length === 0 && rows.some(({ row }) => row.soxlLeadOut != null) && rows.some(({ row }) => row.soxlLeadOut == null),
      `${lineOff.length} closes differ, first ${lineOff.slice(0, 3).map(({ row }) => row.date).join(', ')}`);
    // A switch takes two days, so SOXL can still be in the account on the close the rule lets go, never two closes later.
    const late = rows.filter(({ row, i }) => row.held === 'SOXL' && !own.held[i] && !own.held[i - 1]);
    ck(`${tag} SOXL is never held two closes after the rule let it go`, late.length === 0, `${late.length} closes, first ${late.slice(0, 3).map(({ row }) => row.date).join(', ')}`);
    ck(`${tag} SOXL is held on many closes`, rows.filter(({ row }) => row.held === 'SOXL').length > 500);
  });

  // ---- 3. A sale by the turn ----
  {
    const log = run(n, TURN).log, sales = log.filter(row => row.action === 'sell' && /turned down/.test(row.note || ''));
    ck(`${name} some sales are the turn's, each under the line and naming the lead's high`, sales.length >= 3 && sales.every(row => row.soxlLeadOut != null && row.soxlLead < row.soxlLeadOut && /30 points or more under its high of [+−]\d+%/.test(row.note)),
      `${sales.length} sales; ${sales.slice(0, 2).map(row => row.date + ' ' + row.note).join(' | ')}`);
    const lines = run(n, TURN).lines.filter(line => /^soxlLeadOut/.test(line.key));
    ck(`${name} both panels call the line "Back to TQQQ under"`, lines.length === 2 && lines.every(line => line.label === 'Back to TQQQ under'), lines.map(line => line.label).join(' | '));
    // With the buy level over the sell line a sale leaves the lead under the buy level: it must not be undone at the next close.
    const high = run(n, { ...TURN, soxlLeadEnter: 40 }).log, turnSales = high.map((row, k) => ({ row, next: high[k + 1] })).filter(({ row }) => row.action === 'sell' && /turned down/.test(row.note || ''));
    const undone = turnSales.filter(({ next }) => next && next.action === 'buy' && next.held === 'SOXL');
    ck(`${name} a sale with the lead under the buy level is not bought back at the next close`, turnSales.length >= 10 && turnSales.some(({ row }) => row.soxlLead < 40) && undone.length === 0,
      `${turnSales.length} turn sales, ${turnSales.filter(({ row }) => row.soxlLead < 40).length} under the buy level, ${undone.length} bought back the next close: ${undone.slice(0, 2).map(({ row }) => row.date).join(', ')}`);
  }

  // ---- 4. At the default, the level ----
  {
    const result = run(n), level = defaults.soxlLeadExit;
    ck(`${name} at the level: the line is the level on every close with a lead`, result.log.every(row => (row.soxlLead == null) === (row.soxlLeadOut == null) && (row.soxlLeadOut == null || row.soxlLeadOut === level)));
    ck(`${name} at the level: sales say "back over", none says "turned down"`, result.log.some(row => new RegExp('back over ' + level + '%').test(row.note || '')) && !result.log.some(row => /turned down/.test(row.note || '')));
    const lines = result.lines.filter(line => /^soxlLeadOut/.test(line.key));
    ck(`${name} at the level: both panels call the line "Back to TQQQ over"`, lines.length === 2 && lines.every(line => line.label === 'Back to TQQQ over'), lines.map(line => line.label).join(' | '));
    const end = log => log[log.length - 1].value;
    ck(`${name} the two ways of selling end at different amounts`, end(result.log) !== end(run(n, TURN).log));
  }
}

console.log(failures ? `\n${failures} check(s) failed` : 'library SOXL turn sell: all checks passed');
process.exit(failures ? 1 : 0);
