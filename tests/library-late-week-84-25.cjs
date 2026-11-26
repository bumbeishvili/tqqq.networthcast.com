/*
 * Library strategy #75, "84-25 - Late-week + overextended SQQQ" (was "Late week 84-25 steady fit"): #73 (Late-week + overextended SQQQ) at the
 * settings of the user's copy after a pick on the map of 1984 to 2025 (the #75 section of
 * js/strategy-library-code.js). Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. its settings are #73's, in the same order, with the panel's ten defaults moved and no other;
 *   2. it trades as #73 does with those ten set by hand, row for row, with a lump sum, with
 *      contributions and a withdrawal, and with one trade per day;
 *   3. its texts are #73's but for its name and seven tips: the four that quoted a study of other
 *      settings are plain, and the line's three quote this strategy's own facts, which are checked
 *      here against its runs;
 *   4. it has the drawdowns the user's copy showed: 64.8% from 25 October 2022 to 9 May 2023 on a
 *      period from 2010, and 75.1% on 1984 to 2025 (the map's fit note).
 *
 *   node tests/library-late-week-84-25.cjs
 */
const { CODE, data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const OVER = 73, MINE = 75;
// The user's panel, where it differs from #73's defaults.
const MOVED = { trendUnder: -1.5, trendDays: 33, rsiFund: 'qqq', rsiLevel: 30.5, lagDays: 12, lagBy: 5.5, lagHold: 'weekend', overFund: 'soxx', overPct: 43, overWindow: 233 };
const TIPS = ['rsiLevel', 'lagTake', 'lagBy', 'lagHold', 'overTake', 'overPct', 'overHold'];
const { dates, sqqq: SQ } = data, at = d => dates.findIndex(x => x >= d);
const Y84 = at('1984-01-01') - 1, Y2010 = at('2010-01-04') - 1, END = at('2026-01-01') - 1, LAST = dates.length - 1;
const over = strategyOf(OVER), mine = strategyOf(MINE);
const run = (strategy, settings = {}, { contributions = {}, from = Y2010, to = END } = {}) =>
  strategy.run(data, { ...defaultsOf(strategy), ...settings, initial: 100000, contributions, startIdx: from, endIdx: to, dailyDisplay: true }).log;
const sameRows = (a, b) => a.length === b.length && a.every((row, k) => row.value === b[k].value && row.held === b[k].held && row.action === b[k].action && row.note === b[k].note);
const perYear = log => Math.pow(log[log.length - 1].value / log[0].value, 365.25 * 864e5 / (Date.parse(log[log.length - 1].date) - Date.parse(log[0].date))) - 1;
const fallOf = log => { let peak = 0, fall = 0, top = '', from = '', to = ''; log.forEach(r => { if (r.value > peak) { peak = r.value; top = r.date; } if (1 - r.value / peak > fall) { fall = 1 - r.value / peak; from = top; to = r.date; } }); return { fall, from, to }; };
const pct = v => (v * 100).toFixed(1) + '%';

// ---- 1. The settings ----
{
  ck('its name, the old one kept for saved copies', mine.name === '84-25 - Late-week + overextended SQQQ', mine.name);
  const ids = settingsOf(mine).map(p => p.id), theirs = settingsOf(over).map(p => p.id);
  ck('#73\'s settings, in the same order', ids.join() === theirs.join(), ids.join());
  const d = defaultsOf(mine), d73 = defaultsOf(over);
  const moved = ids.filter(id => JSON.stringify(d[id]) !== JSON.stringify(d73[id]));
  ck('the panel\'s ten defaults moved, and no other', moved.join() === Object.keys(MOVED).sort((a, b) => ids.indexOf(a) - ids.indexOf(b)).join() && moved.every(id => JSON.stringify(d[id]) === JSON.stringify(MOVED[id])),
    moved.map(id => `${id} ${JSON.stringify(d73[id])} -> ${JSON.stringify(d[id])}`).join(', '));
}

// ---- 2. It is #73 with the ten set by hand ----
{
  const monthly = Object.fromEntries(dates.slice(Y2010 + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, 4000]));
  const withMoney = { ...monthly, '2020-06-15': -50000 };
  ck('a lump sum from 1984: #73 with the ten, row for row', sameRows(run(mine, {}, { from: Y84 }), run(over, MOVED, { from: Y84 })));
  ck('contributions and a withdrawal: row for row', sameRows(run(mine, {}, { contributions: withMoney }), run(over, MOVED, { contributions: withMoney })));
  ck('one trade per day: row for row', sameRows(run(mine, { splitDays: true }), run(over, { ...MOVED, splitDays: true })));
}

// ---- 3. The texts ----
{
  const byId = s => Object.fromEntries(settingsOf(s).map(p => [p.id, p]));
  const a = byId(mine), b = byId(over);
  const swapped = Object.keys(a).filter(id => a[id].tip !== b[id].tip);
  ck('seven tips swapped, the rest #73\'s', swapped.join() === TIPS.join(), swapped.join());
  ck('no swapped tip quotes #73\'s settings or the studies of other settings', TIPS.every(id => !/\b54%|242|255|20 days with 2%|most at 40|TQQQ closed/.test(a[id].tip)), TIPS.map(id => a[id].tip).find(t => /\b54%|242|255|20 days with 2%|most at 40|TQQQ closed/.test(t)));
  ck('the code is #73\'s but for its name, its defaults and those tips', (() => {
    let t = CODE[OVER].replace('"Late-week + overextended SQQQ"', '"84-25 - Late-week + overextended SQQQ"');
    for (const id of Object.keys(a)) { if (a[id].tip !== b[id].tip) t = t.replace(JSON.stringify(b[id].tip), JSON.stringify(a[id].tip)); }
    return t.replace(/, default: [^,}]+/g, '') === CODE[MINE].replace(/, default: [^,}]+/g, '');
  })());
  // The line's facts its tips quote, from its own runs (1984 to 2025, $100K).
  const cagr = settings => pct(perYear(run(mine, settings, { from: Y84 })));
  const own = cagr({});
  ck(`the level's tip: 40% ${cagr({ overPct: 40 })}, 43% ${own}, 45% ${cagr({ overPct: 45 })}, 50% ${cagr({ overPct: 50 })}`, a.overPct.tip.includes(`40% made ${cagr({ overPct: 40 })} a year, 43% ${own}, 45% ${cagr({ overPct: 45 })}, 50% ${cagr({ overPct: 50 })}`), a.overPct.tip);
  const since = [35, 40, 43, 45, 50, 55].map(l => perYear(run(mine, { overPct: l })) * 100);
  ck('and since 2010 every level from 35% to 55% makes 107% to 111%', since.every(v => Math.round(v) >= 107 && Math.round(v) <= 111), since.map(v => v.toFixed(1)).join(', '));
  ck(`the held fund's tip: cash ${cagr({ overHold: 'cash' })} against ${own}`, a.overHold.tip.includes(`made ${cagr({ overHold: 'cash' })} a year in 1984-2025 against ${own}`), a.overHold.tip);
  const stays = (from, to) => { const log = run(mine, {}, { from, to }), out = []; let s = -1;
    log.forEach((r, k) => { const on = r.overRel > MOVED.overPct; if (on && s < 0) s = k; if (!on && s >= 0) { out.push(SQ[at(log[k].date)] / SQ[at(log[s].date)] > 1); s = -1; } }); return out; };
  const all = stays(Y84, END), recent = stays(Y2010, END);
  ck(`the rule's tip: ${all.length} stretches since 1984, SQQQ up over ${all.filter(Boolean).length}; ${recent.length} since 2010, up over ${recent.filter(Boolean).length}`,
    a.overTake.tip.includes(`in ${all.length} stretches, and SQQQ rose over ${all.filter(Boolean).length} of them; since 2010 in ${recent.length}, and SQQQ rose over ${recent.filter(Boolean).length}.`), a.overTake.tip);
}

// ---- 4. The user's copy ----
{
  const since2010 = fallOf(run(mine, {}, { to: LAST })), fit = fallOf(run(mine, {}, { from: Y84 }));
  ck('from 2010: a max drawdown of 64.8%, 25 October 2022 to 9 May 2023, as the panel showed', pct(since2010.fall) === '64.8%' && since2010.from === '2022-10-25' && since2010.to === '2023-05-09', `${pct(since2010.fall)} ${since2010.from} to ${since2010.to}`);
  ck('1984 to 2025: 75.1%, as the fit note said', pct(fit.fall) === '75.1%', pct(fit.fall));
}

console.log(failures ? `\n${failures} check(s) failed` : 'library late week 84-25 steady fit: all checks passed');
process.exit(failures ? 1 : 0);
