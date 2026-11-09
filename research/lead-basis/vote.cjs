'use strict';
// A lookback vote for the TQQQ-vs-QQQ lead, as text surgery on library #52 (research only, nothing
// shipped). The user (2026-11-09): the 2.2-year horizon might drift, so the strategy should not hang
// on one lookback. Modes, read off p like every other research knob:
//   p.voteMode       "off" (parity with #52), "median" (the engine's one lead = the median lead
//                    across the horizons), "majority" (one full state machine per horizon; the base
//                    want is their majority; the overlays - overextended, credit veto, SQQQ cap -
//                    apply once, as they are horizon-independent), "winner" (one machine per horizon;
//                    the base want is the machine whose virtual book earned most over the trailing
//                    p.voteSelWindow days, switched only when a rival beats it by p.voteSelHyst).
//   p.voteLookbacks  the horizons in trading days. Each keeps the shipped start-average ratio
//                    (±65 of 550), so a 650-day horizon averages its start over ±77 days.
//   p.voteNormalize  optional [{mul, add}] per horizon: each lead mapped onto the reference scale
//                    before any vote. Measured on 1953-2009 the map is near identity (medians 6-8,
//                    IQRs 61-74 across 380-880 days), so it is off in the study's runs.
//   p.leadShift      the luck test's circular shift: the voted lead in median mode, every horizon's
//                    lead coherently (same offset) in majority and winner modes.
// Majority ties: keep yesterday's majority if it is among the tied wants, else the central horizon's.
// Winner books: each machine's want (its base, one-day lag, no costs) applied to that fund's closes,
// cash earning the engine's dayRate; the replay warms books over the longest horizon plus the window,
// so a moved Entry never starts the selector blank.
const { CODE } = require('./harness.cjs');
const once = (text, find, repl, what) => {
  const at = text.indexOf(find);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(what + ' must appear exactly once');
  return text.slice(0, at) + repl + text.slice(at + find.length);
};
function withLeadVote(code) {
  let t = code;
  // 1. The lead computation: one array per horizon, the engine's `lead` = the voted one.
  t = once(t, `    for (let i = L + W; i < n; i++) {
      const a = i - L - W, b = i - L + W + 1;
      if (!(T[i] > 0 && Q[i] > 0) || priced[b] - priced[a] !== b - a) continue;
      baseT[i] = W ? Math.exp((logT[b] - logT[a]) / (b - a)) : T[i - L];
      baseQ[i] = W ? Math.exp((logQ[b] - logQ[a]) / (b - a)) : Q[i - L];
      gT[i] = T[i] / baseT[i]; gQ[i] = Q[i] / baseQ[i];
      lead[i] = (Math.exp(Math.log(gT[i]) - Math.log(gQ[i])) - 1) * 100;
    }
`, `    const leadArr = (Lk, Wk, main) => {
      const out = new Float64Array(n).fill(NaN);
      for (let i = Lk + Wk; i < n; i++) {
        const a = i - Lk - Wk, b = i - Lk + Wk + 1;
        if (!(T[i] > 0 && Q[i] > 0) || priced[b] - priced[a] !== b - a) continue;
        const bT = Wk ? Math.exp((logT[b] - logT[a]) / (b - a)) : T[i - Lk];
        const bQ = Wk ? Math.exp((logQ[b] - logQ[a]) / (b - a)) : Q[i - Lk];
        if (main) { baseT[i] = bT; baseQ[i] = bQ; gT[i] = T[i] / bT; gQ[i] = Q[i] / bQ; }
        out[i] = (Math.exp(Math.log(T[i] / bT) - Math.log(Q[i] / bQ)) - 1) * 100;
      }
      return out;
    };
    const VOTE_MODE = p.voteMode || "off";
    const VOTE_LS = VOTE_MODE !== "off" && p.voteLookbacks && p.voteLookbacks.length ? p.voteLookbacks.map(x => Math.round(+x)) : [L];
    const mainLead = leadArr(L, W, true);
    const voteLeads = VOTE_LS.map(Lk => Lk === L ? mainLead : leadArr(Lk, Math.round(W * Lk / L), false));
    if (p.voteNormalize && p.voteNormalize.length === VOTE_LS.length) p.voteNormalize.forEach((m, k) => {
      if (!m || (m.mul === 1 && m.add === 0)) return;
      const src = voteLeads[k], out = new Float64Array(n).fill(NaN);
      for (let i = 0; i < n; i++) { const v = src[i]; if (v === v) out[i] = v * m.mul + m.add; }
      voteLeads[k] = out;
    });
    const shiftArr = (arr) => { let s0 = 0; while (s0 < n && !(arr[s0] === arr[s0])) s0++; const m0 = n - s0; if (m0 < 2) return; const sh = ((Math.round(+p.leadShift) % m0) + m0) % m0; const copy = arr.slice(); for (let i = s0; i < n; i++) arr[i] = copy[s0 + ((i - s0 + sh) % m0)]; };
    if (p.leadShift && VOTE_MODE !== "median") voteLeads.filter((arr, k) => voteLeads.indexOf(arr) === k).forEach(shiftArr);
    if (VOTE_MODE === "median" && VOTE_LS.length > 1) {
      for (let i = 0; i < n; i++) {
        let all = true; const vs = [];
        for (const arr of voteLeads) { const v = arr[i]; if (v === v) vs.push(v); else { all = false; break; } }
        if (!all) continue;
        vs.sort((x, y) => x - y);
        lead[i] = vs.length % 2 ? vs[(vs.length - 1) >> 1] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
      }
    } else lead.set(mainLead);
    if (p.leadShift && VOTE_MODE === "median") shiftArr(lead);
`, 'the lead loop');
  // 2. One state machine per horizon (majority and winner modes): the factory's advance body is the
  // engine's own, extracted and rewritten onto a machine object, so a change to the engine reaches
  // the copies or breaks the anchors loudly.
  const mStart = t.indexOf('    let state = "in", days = 0, closes = 0, why = "", whyIdx = -1, deepPx = 0, deepPaused = false, releasedAt = -1;');
  if (mStart < 0) throw new Error('the machine head moved');
  const aHead = 'const advance = (i) => {';
  const aStart = t.indexOf(aHead, mStart);
  const endMark = '\n    };\n    // What the rules want to hold';
  const aEnd = t.indexOf(endMark, aStart);
  if (aStart < 0 || aEnd < 0) throw new Error('the advance body moved');
  const body = t.slice(aStart + aHead.length, aEnd)
    .replace(/\blead\[i\]/g, 'leadM[i]')
    .replace(/\bstate\b/g, 'M.state')
    .replace(/\bdays\b/g, 'M.days')
    .replace(/\bcloses\b/g, 'M.closes')
    .replace(/\bwhy\b/g, 'M.why')
    .replace(/\bwhyIdx\b/g, 'M.whyIdx')
    .replace(/\bdeepPx\b/g, 'M.deepPx')
    .replace(/\bdeepPaused\b/g, 'M.deepPaused')
    .replace(/\breleasedAt\b/g, 'M.releasedAt');
  const factory = `
    const makeMachine = (leadM) => {
      const M = { state: "in", days: 0, closes: 0, why: "", whyIdx: -1, deepPx: 0, deepPaused: false, releasedAt: -1, prevWant: null };
      M.advance = (i) => {${body}
      };
      return M;
    };
    const machines = VOTE_MODE === "majority" || VOTE_MODE === "winner" ? voteLeads.map(makeMachine) : [];
    const SELW = Math.max(21, Math.round(+p.voteSelWindow || 504)), SELH = +p.voteSelHyst || 1;
    const books = machines.map(() => new Float64Array(n).fill(NaN));
    let winnerK = (machines.length - 1) >> 1, winnerAt = -1;
    const retOf = (id, i) => id === "cash" || !data[id] || !(data[id][i] > 0) || !(data[id][i - 1] > 0) ? 1 + dayRate : data[id][i] / data[id][i - 1];
    const machineStep = (i) => {
      if (!machines.length) return;
      for (let k = 0; k < machines.length; k++) {
        const m = machines[k];
        if (VOTE_MODE === "winner") {
          const prevEq = i > 0 && books[k][i - 1] === books[k][i - 1] ? books[k][i - 1] : 1;
          books[k][i] = prevEq * (m.prevWant ? retOf(m.prevWant, i) : 1);
        }
        m.advance(i);
        m.prevWant = baseOf(m);
      }
      if (VOTE_MODE === "winner" && i !== winnerAt) {
        winnerAt = i;
        if (i - SELW >= 0 && books[0][i - SELW] === books[0][i - SELW]) {
          let bestK = winnerK, bestR = -Infinity;
          const curR = books[winnerK][i] / books[winnerK][i - SELW];
          for (let k = 0; k < machines.length; k++) { const r = books[k][i] / books[k][i - SELW]; if (r > bestR) { bestR = r; bestK = k; } }
          if (bestK !== winnerK && bestR > curR * SELH) winnerK = bestK;
        }
      }
      if (p.voteTrace) p.voteTrace[dates[i]] = VOTE_LS[winnerK];   // which horizon holds the wheel (research instrumentation)
    };
    const advanceAll = (i) => { machineStep(i); advance(i); };
`;
  t = t.slice(0, aEnd + 8) + factory + t.slice(aEnd + 8);   // 8 = '\n    };\n'.length: insert after the advance block
  // 3. The want: the winner machine's base, or the majority of the machines' bases; the overlays once.
  t = once(t, `    const decide = (i) => {`, `    const baseOf = (S) => S.state === "deep" && S.deepPaused ? "cash" : S.state === "in" || S.state === "deep" ? "tqqq"
      : S.state === "top" ? (topHold === "sqqq" && topDays && S.days >= topDays ? "cash" : topHold)
      : floorHold;
    let lastMaj = "tqqq";
    const majorityBase = () => {
      const counts = {};
      for (const m of machines) { const b = baseOf(m); counts[b] = (counts[b] || 0) + 1; }
      const most = Math.max(...Object.values(counts));
      const tied = Object.keys(counts).filter(k => counts[k] === most);
      lastMaj = tied.length === 1 ? tied[0] : tied.includes(lastMaj) ? lastMaj : baseOf(machines[(machines.length - 1) >> 1]);
      return lastMaj;
    };
    const decide = (i) => {`, 'the decide head');
  t = once(t, `      const base = state === "deep" && deepPaused ? "cash" : state === "in" || state === "deep" ? "tqqq"
        : state === "top" ? (topHold === "sqqq" && topDays && days >= topDays ? "cash" : topHold)
        : floorHold;   // no limit of its own: the crash defence caps every SQQQ stretch (sqqqMaxDays)
`, `      const base = machines.length ? (VOTE_MODE === "winner" ? baseOf(machines[winnerK]) : majorityBase()) : baseOf({ state, days, deepPaused });   // no limit of its own: the crash defence caps every SQQQ stretch (sqqqMaxDays)
`, 'the base want');
  // 4. The call sites: the replay warms every machine over the longest horizon (plus the selection
  // window in winner mode); the singleton and the caps keep their own window, so the vote off or a
  // band of [L] in majority mode reproduces #52 exactly.
  t = once(t, `    for (let i = Math.max(0, p.startIdx - L); i < p.startIdx; i++) { advance(i); capSq(i, wantNow(i)); triggerAt(i); }
`, `    const REPLAY_BACK = machines.length ? Math.max(L, ...VOTE_LS) + (VOTE_MODE === "winner" ? SELW + 10 : 0) : L;
    for (let i = Math.max(0, p.startIdx - REPLAY_BACK); i < p.startIdx; i++) {
      machineStep(i);
      if (i >= p.startIdx - L) { advance(i); capSq(i, wantNow(i)); triggerAt(i); }
    }
`, 'the replay loop');
  t = once(t, `      advance(i);
      const baseWant = capSq(i, wantNow(i));`, `      advanceAll(i);
      const baseWant = capSq(i, wantNow(i));`, 'the day loop advance');
  return t;
}
const VOTE_CODE = { 52: withLeadVote(CODE[52]) };
module.exports = { VOTE_CODE, withLeadVote };
if (require.main === module) {
  const { run, data } = require('./harness.cjs');
  const same = (a, b) => a.length === b.length && a.every((r, k) => r.value === b[k].value && r.held === b[k].held && r.action === b[k].action);
  const base = run(CODE[52], {}, '2010-01-01', '2025-12-31');
  for (const [tag, P] of [['off', {}], ['majority [550]', { voteMode: 'majority', voteLookbacks: [550] }], ['median [550]', { voteMode: 'median', voteLookbacks: [550] }]]) {
    const r = run(VOTE_CODE[52], P, '2010-01-01', '2025-12-31');
    console.log(`parity ${tag}: ${same(base.log, r.log) ? 'identical' : 'DIFFERENT'}  CAGR ${r.cagr.toFixed(2)} vs ${base.cagr.toFixed(2)}`);
  }
  const b53 = run(CODE[52], {}, '1953-01-02'), v53 = run(VOTE_CODE[52], { voteMode: 'majority', voteLookbacks: [550] }, '1953-01-02');
  console.log(`parity 1953 majority [550]: ${same(b53.log, v53.log) ? 'identical' : 'DIFFERENT'}`);
  const NARROW = [450, 475, 500, 525, 550, 575, 600, 625, 650];
  const med = run(VOTE_CODE[52], { voteMode: 'median', voteLookbacks: NARROW }, '2010-01-01', '2025-12-31');
  const bf = (i, Lk) => { const Wk = Math.round(65 * Lk / 550); let sT = 0, sQ = 0, c = 0; for (let j = i - Lk - Wk; j <= i - Lk + Wk; j++) { sT += Math.log(data.tqqq[j]); sQ += Math.log(data.qqq[j]); c++; } return ((data.tqqq[i] / Math.exp(sT / c)) / (data.qqq[i] / Math.exp(sQ / c)) - 1) * 100; };
  for (const d of ['2015-06-01', '2020-03-20', '2024-10-01']) {
    const i = data.dates.indexOf(d), vs = NARROW.map(Lk => bf(i, Lk)).sort((a, b) => a - b);
    const row = med.log.find(x => x.date === d);
    console.log(`${d} brute median ${vs[4].toFixed(2)} engine ${(+row.leadPct).toFixed(2)} ${Math.abs(vs[4] - row.leadPct) < 1e-6 ? 'ok' : 'MISMATCH'}`);
  }
  // Winner mode: a band of one machine must track #52 (only the longer replay may move an entry's warm-up).
  const w1 = run(VOTE_CODE[52], { voteMode: 'winner', voteLookbacks: [550], voteSelWindow: 504 }, '2010-01-01', '2025-12-31');
  const diff = base.log.filter((r, k) => r.held !== w1.log[k].held).length;
  console.log(`winner [550]: CAGR ${w1.cagr.toFixed(2)} vs ${base.cagr.toFixed(2)}, held differs on ${diff} of ${base.log.length} days`);
  const win = run(VOTE_CODE[52], { voteMode: 'winner', voteLookbacks: NARROW, voteSelWindow: 504, voteSelHyst: 1.02 }, '2010-01-01', '2025-12-31');
  const maj = run(VOTE_CODE[52], { voteMode: 'majority', voteLookbacks: NARROW }, '2010-01-01', '2025-12-31');
  console.log(`narrow at shipped thresholds: median ${med.cagr.toFixed(1)}/DD ${med.dd.toFixed(1)}  majority ${maj.cagr.toFixed(1)}/DD ${maj.dd.toFixed(1)}  winner ${win.cagr.toFixed(1)}/DD ${win.dd.toFixed(1)}  #52 ${base.cagr.toFixed(1)}/DD ${base.dd.toFixed(1)}`);
  const shw = run(VOTE_CODE[52], { voteMode: 'winner', voteLookbacks: NARROW, voteSelWindow: 504, voteSelHyst: 1.02, leadShift: 1200 }, '2010-01-01', '2025-12-31');
  console.log(`winner narrow shifted 1200: CAGR ${shw.cagr.toFixed(1)}`);
}
