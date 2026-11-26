/*
 * Library strategy #76, "84-25 - SOXL, TQQQ, QQQ" (was "SOXL, TQQQ, QQQ - 1984-2025 fit"): #53 (the 1983 fit) at the 28 settings of the user's
 * copy after two picks on the map of 1984 to 2025, the second set as the defaults on 26 November 2026 (the #76 section of
 * js/strategy-library-code.js).
 * Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. its settings are #53's, in the same order, with the 28 defaults moved and no other;
 *   2. it trades as #53 does with those 28 set by hand, row for row, with a lump sum, with contributions
 *      and a withdrawal, and with one trade per day;
 *   3. its texts are #53's but for its name and the three late-week texts that state facts of a strategy's
 *      own trades, and those facts are this strategy's;
 *   4. it has the drawdowns of the user's notes on 1984 to 2025: 87.1% for #53, 54.7% for it;
 *   5. what its card says of SOXL: held only at closes over its 100-day average, and sold once the lead turns down.
 *
 *   node tests/library-1984-2025-fit.cjs
 */
const { CODE, data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const FIT = 53, MINE = 76;
// The 28 settings that differ from #53's: the second pick's 20 and the first pick's others.
const MOVED = {
  lookbackDays: 555, startAvgDays: 49, topLead: 132, topDays: 63, backLead: 27, bearUnder: 29.5, bearSlope: 10, bearCloses: 7, overPct: 67.5, overWindow: 249,
  sqqqMaxDays: 3, nfciVeto: 0.27, soxlLeadDays: 220, soxlLeadEnter: 10, soxlSell: 'turn', soxlTrail: 65, soxlTrailFrom: -15, soxlConfirm: 100, bigRise: 14.5, bigDrop: 21.5,
  dipUnder: 33, dipUnderMax: 68, dipSellDay: 1, lateRsiSkip: true, lateRsiLevel: 29.5, lateLagDays: 11, lateLagBy: 4.5, lateTrendDays: 38,
};
const { dates, tqqq: T, soxl: SOXL } = data, at = d => dates.findIndex(x => x >= d);
const Y84 = at('1984-01-01') - 1, Y2010 = at('2010-01-04') - 1, END = at('2026-01-01') - 1;
const fit = strategyOf(FIT), mine = strategyOf(MINE);
const run = (strategy, settings = {}, { contributions = {}, from = Y2010, to = END } = {}) =>
  strategy.run(data, { ...defaultsOf(strategy), ...settings, initial: 100000, contributions, startIdx: from, endIdx: to, dailyDisplay: true }).log;
const sameRows = (a, b) => a.length === b.length && a.every((row, k) => row.value === b[k].value && row.held === b[k].held && row.action === b[k].action && row.note === b[k].note);
const fallOf = log => { let peak = 0, fall = 0; log.forEach(r => { peak = Math.max(peak, r.value); fall = Math.max(fall, 1 - r.value / peak); }); return fall; };
const pct = v => (v * 100).toFixed(1) + '%';

// ---- 1. The settings ----
{
  ck('its name, the old one kept for saved copies', mine.name === '84-25 - SOXL, TQQQ, QQQ', mine.name);
  const ids = settingsOf(mine).map(p => p.id);
  ck('#53\'s settings, in the same order', ids.join() === settingsOf(fit).map(p => p.id).join(), ids.join());
  const d = defaultsOf(mine), d53 = defaultsOf(fit);
  const moved = ids.filter(id => JSON.stringify(d[id]) !== JSON.stringify(d53[id]));
  ck('the 28 defaults moved, and no other', moved.length === 28 && moved.slice().sort().join() === Object.keys(MOVED).sort().join() && moved.every(id => d[id] === MOVED[id]),
    moved.map(id => `${id} ${JSON.stringify(d53[id])} -> ${JSON.stringify(d[id])}`).join(', '));
  const byId = Object.fromEntries(settingsOf(mine).map(p => [p.id, p]));
  ck('each of them is one of its setting\'s own choices', Object.entries(MOVED).every(([id, v]) => byId[id].options.some(o => (o && typeof o === 'object' ? o.value : o) === v)));
}

// ---- 2. It is #53 with the 26 set by hand ----
{
  const monthly = Object.fromEntries(dates.slice(Y2010 + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, 4000]));
  const withMoney = { ...monthly, '2020-06-15': -50000 };
  ck('a lump sum from 1984: #53 with the 28, row for row', sameRows(run(mine, {}, { from: Y84 }), run(fit, MOVED, { from: Y84 })));
  ck('contributions and a withdrawal: row for row', sameRows(run(mine, {}, { contributions: withMoney }), run(fit, MOVED, { contributions: withMoney })));
  ck('one trade per day: row for row', sameRows(run(mine, { splitDays: true }), run(fit, { ...MOVED, splitDays: true })));
  ck('and the two differ at their defaults, so the checks above can fail', !sameRows(run(mine), run(fit)));
}

// ---- 3. The texts ----
{
  const texts = strategy => strategy.params.map(p => [p.id || 'section', p.section || p.label, p.text || '', p.tip || '']);
  const a = texts(mine), b = texts(fit);
  const changed = a.map((row, k) => (row.join('|') === b[k].join('|') ? null : row[0] === 'section' ? 'section ' + row[1] : row[0])).filter(Boolean);
  ck('only the late-week section, its weekend check and its down trend read differently from #53\'s', changed.join() === 'section Late-week SQQQ,lateWeekend,lateTrend', changed.join());
  ck('the code is #53\'s but for its name, its defaults and those three', (() => {
    const strip = t => t.replace(/, default: [^,}]+/g, '').replace(/tip: "[^"]*"/g, 'tip');
    return strip(CODE[FIT].replace('"SOXL, TQQQ, QQQ - 1983 fit"', '"84-25 - SOXL, TQQQ, QQQ"')) === strip(CODE[MINE]);
  })());
  // The facts the three state, from this strategy's own run, Q1 2010 to Q4 2025.
  const log = run(mine), late = []; let open = null;
  log.forEach((r, k) => { if (r.lateTrade && !open) open = { from: k, date: r.date }; if (!r.lateTrade && open) { late.push({ ...open, to: k }); open = null; } });
  const g = late.map(t => data.sqqq[at(log[t.to].date)] / data.sqqq[at(log[t.from].date)] - 1);
  const avg = (100 * g.reduce((s, v) => s + v, 0) / g.length).toFixed(1), up = Math.round(100 * g.filter(v => v > 0).length / g.length);
  const section = mine.params.find(p => p.section === 'Late-week SQQQ'), byId = Object.fromEntries(settingsOf(mine).map(p => [p.id, p]));
  ck(`the section counts its own trades: ${late.length}, ${up}% up, ${avg}% each`, section.tip.includes(`${late.length} trades, ${up}% of them up, ${avg}% each on average`), section.tip);
  const wd = dates.map(ds => new Date(ds + 'T12:00:00Z').getUTCDay()), rows = new Map(run(mine, { lateWeekend: false }).map(r => [r.date, r])), under = [], over = [];
  for (let i = Y2010; i < END; i++) if (wd[i] === 3 && rows.get(dates[i]) && rows.get(dates[i]).lateTrade && wd[i + 1] === 4 && wd[i + 2] === 5 && wd[i + 3] === 1) (T[i + 2] < T[i] ? under : over).push(T[i + 3] / T[i + 2] - 1);
  const mean = xs => 100 * xs.reduce((s, v) => s + v, 0) / xs.length, signed = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  ck(`the weekend check's Mondays are its own: ${mean(under).toFixed(2)}%, ${mean(over).toFixed(2)}%`,
    byId.lateWeekend.tip.includes(`TQQQ fell ${(-mean(under)).toFixed(2)}% on average on the Monday after such a close and moved ${signed(mean(over))} after the others.`), byId.lateWeekend.tip);
  ck('the down trend\'s tip names its 38 days', /On here, at 38 days\.$/.test(byId.lateTrend.tip), byId.lateTrend.tip);
  ck('#53\'s text keeps its own facts', /122 trades, 47% of them up/.test(CODE[FIT]) && !/83 trades/.test(CODE[FIT]));
}

// ---- 4. The user's note ----
{
  ck('1984 to 2025: #53\'s max drawdown 87.1%, as the note\'s "before"', pct(fallOf(run(fit, {}, { from: Y84 }))) === '87.1%', pct(fallOf(run(fit, {}, { from: Y84 }))));
  ck('and its own 54.7%, as the second note\'s "after"', pct(fallOf(run(mine, {}, { from: Y84 }))) === '54.7%', pct(fallOf(run(mine, {}, { from: Y84 }))));
}

// ---- 5. SOXL, as the card says ----
{
  const log = run(mine, {}, { from: Y84 }), avg100 = i => SOXL.slice(i - 99, i + 1).reduce((s, v) => s + v, 0) / 100;
  const inSoxl = log.filter(r => r.held === 'SOXL');
  ck('SOXL is held, and only at closes over its 100-day average', inSoxl.length > 100 && inSoxl.every(r => { const i = at(r.date); return SOXL[i] > avg100(i); }), `${inSoxl.length} closes`);
  const level = run(mine, { soxlSell: 'level' }, { from: Y84 });
  ck('it sells SOXL once the lead turns down: with the level sale it trades otherwise', !sameRows(log, level));
}

console.log(failures ? `\n${failures} check(s) failed` : 'library 1984-2025 fit: all checks passed');
process.exit(failures ? 1 : 0);
