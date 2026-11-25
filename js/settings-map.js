// ---- The settings map ----
// The user (2026-11-25), with a picture of a bubble chart split in four: "Is
// there a way to build CAGR & Drawdown graph for the strategy, similar to
// this, I'd imagine it will take some time, but many processes could be shared
// across so it is actually quicker". And, on the first build, which had its
// own button and a Run for a minute: "i want that map button inside fit modal,
// and I want it to run itself and check all settings itself ... not just wait
// for fit button, but itself finding some new strategies".
//
// "Map" in the Fit window opens a window with one dot for every set of the
// strategy's settings that has been run on the chart's period and money: its
// max drawdown across, its CAGR up (js/settings-map-chart.js draws it). Dashed
// lines through the settings as they are split the plot in four; a set up and
// to the left of them is better on both counts. The dots are the key's kept
// runs (fitRunStore in js/saved-configs.js): a fit's runs are on the map, and
// the map's runs make a later fit quicker. The settings frozen in the Fit
// window stay as they are.
//
// The map fills itself from the moment it opens, and goes on until nothing new
// shows (mapFill):
//   1. The settings as they are, then every setting at each of its values with
//      the others held.
//   2. The search the Fit window is set to (its goal, limit, shape and
//      numbers), run here without setting anything: the set it ends on is
//      marked "Fit" on the plot. A window set to Cliff gets the same search
//      on a plateau as well, unmarked: a plateau fit finds steady sets far
//      better than the rounds below do (2026-11-25, Late-week + overextended:
//      after six minutes of rounds the checked sets' frontier held 187% at
//      66% and 192% at 68%, CAGR at drawdown, where a plateau fit had 191% at
//      60%). "Fewest settings" is left to Fit: it is many searches in a row.
//   3. Rounds, each of three steps.
//      Breeding: new sets made from the frontier (the sets no other beats on
//      both counts), one with one to three settings moved, or two mixed.
//      Settings drawn at random are of no use: on Late-week + overextended 400
//      of them had a median CAGR of 17% against 212% for the settings as they
//      were, and none beat those on both counts.
//      Checking a frontier set (mapNextCheck): all its neighbours are run,
//      each setting at the values within a tenth of its own, as a plateau fit
//      counts them (fitPlateauSetting). That says how the set holds with a
//      setting a little off. Every set on the frontier gets its check, the
//      frontier being read as the numbers show it, to a tenth of a point.
//      A step toward a steadier set (mapNextSteadier): from a checked set,
//      away from its weakest neighbour, and that set checked. The sets on the
//      frontier mostly stand on a cliff (2026-11-25: of 24 frontier sets
//      checked on Late-week + overextended, the ones at a 40% drawdown had a
//      neighbour at 71%).
//   It is done after MAP_STALL_ROUNDS rounds in a row that had nothing to
//   check and moved no frontier. Stop holds it, Resume goes on.
// A checked set is drawn larger the better it holds (mapHolds): a small dot
// stands on a cliff, a large one on a plateau; an unchecked one is pale. A
// picked dot is tied by a dotted line to its worst result among its
// neighbours, is checked ahead of the others if it was not, shows the whole
// strategy as its Settings read with each changed value struck through beside
// the new one, and "Use" sets it. CSV saves every dot with its settings.
//
// The user (2026-11-25), on the second build: "Remove the fuck the shape and
// its fucking slop language", "Remove plateau tab", "instead of saying pick a
// dot for its settings, just show it as minimal legend, small dot and big
// dot, also explain what connecting line is", "info icon on the map is also
// shit slop, use deslopped brief, nicely formatted small non alien human
// earthly text", and of More: "could not we do it by default". So: one view,
// a legend, no More (the map already runs to its end by itself), and every
// text the reader sees in short everyday words, one thought a line.
const MAP_BREED = 48;              // sets bred in a round
const MAP_BREED_TRIES = 20;        // draws at a set not run yet, for each set wanted
const MAP_MOVES = [0.7, 0.95];     // a bred set moves one setting up to the first share of the draws, two up to the second, else three
const MAP_MIX_SHARE = 0.35;        // bred sets mixed from two frontier sets
const MAP_NEAR_SHARE = 0.6;        // a number's moves that go to a value close by in its list; the rest go to any value
// Rounds in a row with nothing to check and no frontier moved, after which the map is done. With 12
// it was done too soon (2026-11-25, Late-week + overextended: the second and third More after
// "Done", 12 rounds each, still put new sets on both frontiers; the three after those did not).
const MAP_STALL_ROUNDS = 60;
const MAP_SHOWN = 10;              // two results differ from a tenth of a point on, as the numbers read
const MAP_PROGRESS = { star: 0.1, fit: 0.4, stall: 0.1 };   // the shares of the percentage for the first step, the search, and the quiet rounds at the end; the checks take the rest
const MAP_FIT_LABEL = 'Fit';       // the name on the plot of the set the search ended on
const MAP_WORST_LABEL = 'worst case';   // and of the end of a picked dot's dotted line
const MAP_REDRAW_MS = 400;         // the window follows a running map this often
const MAP_CHART_SHARE = 0.72;      // the chart's height against its width,
const MAP_CHART_MIN = 300;         // at least this many px (a phone's chart is narrow),
const MAP_CHART_SCREEN = 0.52;     // and at most this share of the screen's height
const MAP_HIT_PX = { fine: 14, coarse: 22 };   // how near a dot the pointer, or a finger, has to be
const MAP_PREVIEW_HEIGHT = { share: 0.72, min: 150, max: 400 };   // the picture in the Fit window: its height against its width, within these px
const MAP_FROZEN_TEXT = 'Every setting is frozen.';
// What the reader sees, in everyday words, a thought a line (a tip keeps its line breaks).
const MAP_NEAR_PCT = FIT_PLATEAU_REACH * 100;   // how far a setting is moved for a check, in percent
const MAP_TIP = [
  'Each dot is one combination of settings.',
  'Right: deeper max drawdown. Up: higher CAGR.',
  'Up and left of the dashed lines beats your settings now on both.',
  'The map tries new combinations by itself until it finds nothing better.',
  'Click a dot to see its settings. Use sets them.',
  'Fit marks what Run in the Fit window would pick.',
  'Zoom: ⌘ or Ctrl + scroll, or pinch. Drag to move.',
].join('\n');
const MAP_PLATEAU_TIP = [
  'Plateau: the result holds when a setting is a little off.',
  `Each setting is moved ${MAP_NEAR_PCT}% up and down, one at a time. The worst result counts.`,
  'The bigger the dot, the closer that worst result is to its own.',
  'Cliff: a small change makes it much worse.',
].join('\n');
const MAP_UNTESTED_TIP = 'Not tested yet with a setting a little off. Click it to test it now.';
const MAP_BEST_TIP = 'The line joins the best dots. For the same max drawdown, no dot has a higher CAGR.';
const MAP_WORST_TIP = [
  `Worst case: the lowest result when one setting is ${MAP_NEAR_PCT}% off.`,
  `Each setting is moved ${MAP_NEAR_PCT}% up and down, one at a time.`,
  'It shows only after you click a dot: a dotted line from the dot to its worst case.',
].join('\n');
const MAP_RUN_TIP = [
  `The map tries new combinations until ${MAP_STALL_ROUNDS} rounds in a row find nothing better. Then it stops.`,
  'Stop pauses it. Resume continues.',
].join('\n');
const MAP_CSV_TIP = "Download every dot as a CSV file: CAGR, max drawdown, and each setting's value.";
const MAP_LEGEND = [
  { mark: 'dot is-pale', name: 'not tested', tip: MAP_UNTESTED_TIP },
  { mark: 'dot is-small', name: 'cliff' },
  { mark: 'dot is-big', name: 'plateau', tip: MAP_PLATEAU_TIP },
  { mark: 'line', name: 'best', tip: MAP_BEST_TIP },
  { mark: 'link', name: 'worst case', tip: MAP_WORST_TIP },
];
let _map = null;   // the open window: { el, key, picked, chart, job, space, plans, floor, ask, doneKey, years, dots, byResult, twins, failed, version, places, fronts, most, drawn, run }

// A repeatable random source (mulberry32): the same kept runs breed the same sets.
function mapRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mapPick = (rand, list) => list[Math.floor(rand() * list.length)];

// A frontier: the items no other beats on both counts (a higher final value with no deeper
// drawdown). It is kept as its places from the smallest drawdown up, the final value rising with
// it: [{ item, at: { final, dd } }]. An item joins when no place has as small a drawdown with as
// high a final value, and the places it beats on both counts go. True when it joined. A map
// holds tens of thousands of dots and gains more every second, so its frontiers are kept up one
// dot at a time (mapSync) instead of being sorted out again.
function mapFrontAdd(front, item, at) {
  let lo = 0, hi = front.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (front[mid].at.dd <= at.dd) lo = mid + 1; else hi = mid; }
  // front[lo - 1]: the place with the deepest drawdown that is no deeper than the item's, and so the highest final value among those
  if (lo && front[lo - 1].at.final >= at.final) return false;
  const from = lo && front[lo - 1].at.dd === at.dd ? lo - 1 : lo;
  let to = lo;
  while (to < front.length && front[to].at.final <= at.final) to++;
  front.splice(from, to - from, { item, at });
  return true;
}
const mapFrontPlaces = (items, of) => { const front = []; items.forEach(item => mapFrontAdd(front, item, of(item))); return front; };
// The frontier of a list, from the smallest drawdown up. of(item) gives its { final, dd }.
const mapFrontier = (items, of) => mapFrontPlaces(items, of).map(place => place.item);

// A setting as the map moves it: with a plateau's neighbours (near, of fitPlateauSetting) and its
// numeric values in order.
function mapSetting(s) {
  const numbered = s.values.map(v => ({ v, x: s.number(v) })).filter(o => o.x != null).sort((a, b) => a.x - b.x);
  return Object.assign(fitPlateauSetting(Object.assign({ all: s.values }, s)), { numbered });
}
// Another value for a setting. A number mostly goes to one close by in its list, one place away
// half the time, two a quarter, and so on; else, and for a named choice, to any of the others.
function mapOtherValue(s, value, rand) {
  const others = s.values.filter(v => String(v) !== String(value));
  if (!others.length) return value;
  const x = s.number(value);
  if (x == null || s.numbered.length < 2 || rand() >= MAP_NEAR_SHARE) return mapPick(rand, others);
  const at = d3.leastIndex(s.numbered, o => Math.abs(o.x - x));
  let places = 1;
  while (rand() < 0.5) places++;
  const to = s.numbered[Math.max(0, Math.min(s.numbered.length - 1, at + (rand() < 0.5 ? -places : places)))].v;
  return String(to) === String(value) ? mapPick(rand, others) : to;
}
// A setting that does not show under a set of values has no say in its result, so it goes back to
// where it stands now: two sets that run the same are then one set. Twice over, for a setting
// shown by one that is itself hidden.
function mapSettled(space, cur, values) {
  const out = Object.assign({}, values);
  for (let pass = 0; pass < 2; pass++) space.forEach((s) => { if (!s.shown(out)) out[s.id] = cur[s.id]; });
  return out;
}
// One new set from the parents: one of them with one to three of its shown settings moved, or two
// of them mixed setting by setting, with one setting moved.
function mapChild(space, cur, parents, rand) {
  const a = mapPick(rand, parents).values, mixed = parents.length > 1 && rand() < MAP_MIX_SHARE;
  const child = Object.assign({}, a);
  if (mixed) { const b = mapPick(rand, parents).values; space.forEach((s) => { if (rand() < 0.5) child[s.id] = b[s.id]; }); }
  const draw = rand(), moves = mixed || draw < MAP_MOVES[0] ? 1 : draw < MAP_MOVES[1] ? 2 : 3, moved = new Set();
  for (let k = 0; k < moves; k++) {
    // A setting moves once: a second move could put it back.
    const open = space.filter(s => s.values.length > 1 && !moved.has(s.id) && s.shown(child));
    if (!open.length) break;
    const s = mapPick(rand, open);
    child[s.id] = mapOtherValue(s, child[s.id], rand);
    moved.add(s.id);
  }
  return mapSettled(space, cur, child);
}
// A set's neighbours as a plateau counts them, over the settings that show under it: each at the
// values near its own ({ s, v }), one at a time. A generator: a check mostly ends at the first
// neighbour not run yet.
function* mapMoves(space, values) {
  for (const s of space) {
    if (!s.shown(values)) continue;
    for (const v of s.near(values[s.id])) yield { s, v };
  }
}
// How well a checked set holds among its neighbours, from 0 to 1: the smaller of the share of its
// CAGR that the worst of them keeps, and of its max drawdown against the deepest of theirs.
function mapHolds(dot) {
  const cagrKept = dot.cagr > 0 ? Math.max(0, dot.flatCagr) / dot.cagr : 0;
  const ddKept = dot.flat.dd > 0 ? dot.r.dd / dot.flat.dd : 1;
  return Math.max(0, Math.min(1, cagrKept, ddKept));
}

// ---- The window's dots ----
// A result's CAGR, worked out once and kept with the runs (store.cagrs, by final value). It is a
// money-weighted rate found by halving, and a map opens on thousands of results: 4,500 of them
// took 0.66 s on each opening (2026-11-25, Late-week + overextended).
function mapCagr(job, r) {
  const kept = job.store.cagrs || (job.store.cagrs = new Map());
  if (!kept.has(r.final)) kept.set(r.final, job.cagrOf(r.final));
  return kept.get(r.final);
}
// A dot: { id (the set's key in the store, fitRunKey), values, r: { final, dd }, cagr, differs (how many settings
// are not as they stand now), flat (its plateau judgement, fitFlatOf, once checked), flatCagr,
// waits (the first neighbour a check still lacks) }.
// What a search may not change stays as it is: a kept run with another value for a frozen setting
// is no dot. Two runs with the very same result are one dot, the one nearer to the settings as
// they are (a fit's runs can differ in a setting that does not show, which changes nothing).
function mapSync(map) {
  const { job, dots, byResult } = map;
  if (!job) { map.picked = null; return; }
  const { cur, store } = job, free = new Set(job.space.map(s => s.id)), held = Object.keys(cur).filter(id => !free.has(id));
  store.done.forEach((kept, id) => {
    if (dots.has(id) || map.twins.has(id) || !held.every(h => String(kept.values[h]) === String(cur[h]))) return;
    const differs = job.space.filter(s => String(kept.values[s.id]) !== String(cur[s.id])).length;
    const same = mapResultKey(kept.r), twin = byResult.get(same);
    if (twin && twin.differs <= differs) { map.twins.add(id); return; }
    if (twin) { dots.delete(twin.id); map.twins.add(twin.id); map.places = null; }   // a dot left: the frontiers are worked out again
    const dot = { id, values: kept.values, r: kept.r, cagr: mapCagr(job, kept.r), differs, flat: null, flatCagr: null, waits: null, away: null };
    dots.set(id, dot);
    byResult.set(same, dot);
    mapPlace(map, dot, false);
    map.version++;
  });
  dots.forEach((dot) => { if (mapCheckDot(map, dot)) { mapPlace(map, dot, true); map.version++; } });
  if (map.picked && !dots.has(map.picked)) map.picked = null;   // the picked dot gave way to its twin
}
// A dot is checked once every neighbour of its set has been run, or has failed: it then has its
// plateau judgement. Until then it remembers the first neighbour it waits for. True when this
// call checked it.
function mapCheckDot(map, dot) {
  const { store } = map.job, known = (id) => store.done.has(id) || map.failed.has(id);
  if (dot.flat || (dot.waits && !known(dot.waits))) return false;
  const moves = [];
  for (const move of mapMoves(map.space, dot.values)) {
    const id = fitRunKey(store, fitMoved(dot.values, move));
    if (!known(id)) { dot.waits = id; return false; }
    moves.push(Object.assign(move, { r: store.done.has(id) ? store.done.get(id).r : null }));
  }
  dot.flat = fitFlatOf(dot.r, moves);
  dot.flatCagr = mapCagr(map.job, dot.flat);
  dot.waits = null;
  return true;
}
const mapDotList = (map) => Array.from(map.dots.values());
const mapNowDot = (map) => (map.job ? map.dots.get(fitRunKey(map.job.store, map.job.cur)) : null) || null;
const mapOwn = (dot) => dot.r, mapFlat = (dot) => dot.flat;
// A dot's result, and its worst among its neighbours, as the numbers show them: in tenths of a
// point. Two sets that read the same are one place on the frontier.
const mapShownOwn = (dot) => ({ final: Math.round(dot.cagr * MAP_SHOWN), dd: Math.round(dot.r.dd * 100 * MAP_SHOWN) });
const mapShownFlat = (dot) => ({ final: Math.round(dot.flatCagr * MAP_SHOWN), dd: Math.round(dot.flat.dd * 100 * MAP_SHOWN) });
// The map's four frontiers: of every set by its own result (own) and of the checked sets by
// their worst (flat), each also as the numbers show it (shownOwn, shownFlat).
const MAP_FRONTS = { own: { of: mapOwn, checked: false }, shownOwn: { of: mapShownOwn, checked: false }, flat: { of: mapFlat, checked: true }, shownFlat: { of: mapShownFlat, checked: true } };
// A new dot takes its place on the frontiers of every set; a dot just checked, on those of the checked sets.
function mapPlace(map, dot, checked) {
  if (!map.places) return;   // being worked out again at the next reading (mapFronts)
  Object.entries(MAP_FRONTS).forEach(([name, front]) => { if (front.checked === checked) mapFrontAdd(map.places[name], dot, front.of(dot)); });
}
// The frontiers as lists of dots, read off once for each state of the dots (map.version).
function mapFronts(map) {
  if (!map.places) {
    const dots = mapDotList(map), checked = dots.filter(mapFlat);
    map.places = Object.fromEntries(Object.entries(MAP_FRONTS).map(([name, front]) => [name, mapFrontPlaces(front.checked ? checked : dots, front.of)]));
    map.fronts = null;
  }
  if (!map.fronts || map.fronts.version !== map.version) {
    map.fronts = Object.assign({ version: map.version }, Object.fromEntries(Object.entries(map.places).map(([name, front]) => [name, front.map(place => place.item)])));
  }
  return map.fronts;
}
// What the frontiers read as: it changes when a round has moved one of them by an amount that shows.
const mapFrontMark = (map) => { const fronts = mapFronts(map), mark = (front, of) => front.map((dot) => { const o = of(dot); return o.dd + ':' + o.final; }).join(' ');
  return mark(fronts.shownOwn, mapShownOwn) + ' | ' + mark(fronts.shownFlat, mapShownFlat); };

// ---- Filling the map ----
// The sets new ones are bred from: the frontier, and the frontier of the checked sets by their
// worst result, so the sets that hold have offspring too.
const mapParents = (map) => { const fronts = mapFronts(map); return [...new Set(fronts.own.concat(fronts.flat))]; };
// Up to `count` sets not run yet, bred from the parents.
function mapBreed(map, rand, count) {
  const { job } = map, parents = mapParents(map), sets = new Map();
  if (!parents.length) return [];
  for (let tries = 0; sets.size < count && tries < count * MAP_BREED_TRIES; tries++) {
    const child = mapChild(map.space, job.cur, parents, rand), id = fitRunKey(job.store, child);
    if (!job.store.done.has(id) && !map.failed.has(id)) sets.set(id, child);
  }
  return Array.from(sets.values());
}
// The next frontier set to check: an unchecked one of the frontier as the numbers show it; first
// those that beat the settings as they are on both counts; of them the one furthest on the plot
// from every checked set (each axis taken against the frontier's spread), so the checks spread
// over the frontier before they fill it in. null when the whole frontier is checked.
function mapNextCheck(map) {
  const front = mapFronts(map).shownOwn, now = mapNowDot(map);
  const open = front.filter(dot => !dot.flat);
  if (!open.length) return null;
  const checked = mapDotList(map).filter(mapFlat);
  const spread = (of) => Math.max(d3.max(front, of) - d3.min(front, of), 1e-9), across = spread(d => d.r.dd), up = spread(d => d.cagr);
  const gap = (dot) => (checked.length ? d3.min(checked, c => Math.hypot((dot.r.dd - c.r.dd) / across, (dot.cagr - c.cagr) / up)) : Infinity);
  const beats = now ? open.filter(dot => dot.r.final > now.r.final && dot.r.dd < now.r.dd) : [];
  return d3.greatest(beats.length ? beats : open, gap);
}
// A step from a checked set toward a steadier one: the setting its weakest neighbour moved
// (spot: flat.low or flat.deep), put at its nearest value from which that weak value is out of
// reach, on the far side of the set's own value. null when the setting has no such value.
function mapStepAway(map, dot, spot) {
  const s = map.space.find(o => o.id === spot.id), own = s.number(dot.values[s.id]), weak = s.number(spot.value);
  const far = s.numbered.filter(o => (own > weak ? o.x > own : o.x < own) && !s.near(o.v).some(v => String(v) === String(spot.value)));
  const to = d3.least(far, o => Math.abs(o.x - own));
  return to ? mapSettled(map.space, map.job.cur, Object.assign({}, dot.values, { [s.id]: to.v })) : null;
}
// The next set to check for the checked sets' own frontier (the one "Plateau" draws): a step
// away from the weakest neighbour of a set on it, the sets with the highest worst CAGR first.
// Values alone, as the set may not have been run. null when every such step has been checked.
function mapNextSteadier(map) {
  const front = mapFronts(map).shownFlat.slice().sort((a, b) => b.flat.final - a.flat.final);
  for (const dot of front) {
    // A set's two steps are worked out once: they follow from its check alone.
    dot.away = dot.away || [dot.flat.low, dot.flat.deep].map((spot) => { const values = spot && mapStepAway(map, dot, spot); return values && { values, id: fitRunKey(map.job.store, values) }; }).filter(Boolean);
    const step = dot.away.find(({ id }) => !map.failed.has(id) && !map.twins.has(id) && !(map.dots.has(id) && map.dots.get(id).flat));
    if (step) return step.values;
  }
  return null;
}
// A set and its neighbours run, so that it can be checked (mapCheckDot).
const mapCheck = (map, values, measure) => Promise.all([measure(Object.assign({}, values))]
  .concat(Array.from(mapMoves(map.space, values), move => measure(fitMoved(values, move)))));
// The key of a result among the dots (two sets with the very same result are one dot).
const mapResultKey = (r) => r.final + '|' + r.dd;
// What a search's result is kept under, with the runs (store.mapFits): the settings it could
// change, where each stood when it started, and the plan. A fit starts from the settings as they
// are, so one from another start is another search.
const mapPlanKey = (job, plan) => JSON.stringify([job.space.map(s => [s.id, job.cur[s.id]]), plan]);
// The results of the searches run so far on these runs, by mapPlanKey: a result's key among the
// dots (mapResultKey), or null where nothing met the limit.
const mapFitsOf = (job) => job.store.mapFits || (job.store.mapFits = {});
const mapSearched = (map, plan) => mapPlanKey(map.job, plan) in mapFitsOf(map.job);
// The dot of the set the Fit window's own search (map.plans[0]) ended on, if it ran and ended within its limit.
function mapFitDot(map) {
  const fit = map.job ? mapFitsOf(map.job)[mapPlanKey(map.job, map.plans[0])] : null;
  return (fit && map.byResult.get(fit)) || null;
}
// One of the map's searches (map.plans), run on its own runs with nothing set on the strategy.
// Its result is kept with the runs, so a window opened later on the same choices has it without
// searching. run.fit is what fitSearch keeps its progress in; it stops with the map.
async function mapFitStage(map, measure, plan) {
  const { job, run } = map, rule = fitRuleOf(plan, map.floor), space = fitSpaceOf(plan, job.space), cur = Object.assign({}, job.cur);
  if (plan.round) space.forEach((s) => { cur[s.id] = s.snap(cur[s.id]); });
  run.fit = { get stopped() { return run.stopped; }, stage: 1, stages: plan.goal === 'dd' ? 2 : 1, phase: 'rounds', round: 1, done: 0, total: 0, base: 0, span: 1 };
  const best = await fitSearch(run.fit, space, cur, { rule, measure, cagrOf: job.cagrOf });
  if (run.stopped) return;
  mapSync(map);
  // Nothing met the limit: there is no result to mark.
  mapFitsOf(job)[mapPlanKey(job, plan)] = fitReached(rule, best) ? mapResultKey(job.store.done.get(fitRunKey(job.store, cur)).r) : null;
}
// The map filling itself: see the head of this file. over() says when to hold: Stop, or the
// window closed. Resolves to true when it is done: nothing left to check and no frontier moved
// for MAP_STALL_ROUNDS rounds, or every set there is has been run. map.run carries what the
// progress reads: step ('star', 'fit', 'rounds'), star { done, all }, searched, fit and stalled.
async function mapFill(map, measure, over) {
  const { job, space, run } = map, { cur } = job, rand = mapRandom(job.store.done.size + 1);
  run.step = 'star';
  await measure(Object.assign({}, cur));
  const star = space.filter(s => s.shown(cur)).map(s => s.values.filter(v => String(v) !== String(cur[s.id])).map(v => Object.assign({}, cur, { [s.id]: v })));
  run.star = { done: 0, all: d3.sum(star, sets => sets.length) };
  for (const sets of star) {
    if (over()) return false;
    await Promise.all(sets.map(measure));
    run.star.done += sets.length;
  }
  if (map.ask) {
    run.step = 'fit';
    run.searched = 0;
    for (const plan of map.plans) {
      if (!mapSearched(map, plan)) await mapFitStage(map, measure, plan);
      if (over()) return false;
      run.searched++;   // the first is the one the Fit window asked for: its result is marked "Fit", and picked only by a click
    }
  }
  // The rounds below came to their end before on these settings and this plan (in its other shape, or from another start): only the searches were missing.
  if (job.store.mapDone === map.doneKey) return true;
  run.step = 'rounds';
  while (!over()) {
    mapSync(map);
    const before = mapFrontMark(map);
    // A picked dot is checked ahead of everything else.
    const picked = map.picked ? map.dots.get(map.picked) : null;
    if (picked && !picked.flat) await mapCheck(map, picked.values, measure);
    if (over()) return false;
    const sets = mapBreed(map, rand, MAP_BREED);
    await Promise.all(sets.map(measure));
    if (over()) return false;
    mapSync(map);
    const onFrontier = mapNextCheck(map);
    if (onFrontier) await mapCheck(map, onFrontier.values, measure);
    if (over()) return false;
    mapSync(map);
    const steadier = mapNextSteadier(map);
    if (steadier) await mapCheck(map, steadier, measure);
    if (over()) return false;
    mapSync(map);
    const quiet = !onFrontier && !steadier && mapFrontMark(map) === before;
    run.stalled = quiet ? run.stalled + 1 : 0;
    if (run.stalled >= MAP_STALL_ROUNDS || (quiet && !sets.length)) return true;   // no set left to breed: every set there is has been run
  }
  return false;
}
// How far a map filling itself has come, in percent: the first step, the search, then the share
// of the frontier that is checked and the quiet rounds that end it. It never goes back (map.most).
function mapPercent(map) {
  const { run } = map, P = MAP_PROGRESS;
  const star = !run.star ? 0 : run.star.all ? run.star.done / run.star.all : 1;
  const share = () => {
    if (run.step === 'star') return P.star * star;
    if (run.step === 'fit') return P.star + P.fit * (run.searched + (run.fit ? fitPercent(run.fit) / 100 : 0)) / map.plans.length;
    const front = mapFronts(map).shownOwn, checks = front.length ? front.filter(mapFlat).length / front.length : 1;
    return P.star + P.fit + (1 - P.star - P.fit - P.stall) * checks + P.stall * run.stalled / MAP_STALL_ROUNDS;
  };
  map.most = Math.max(map.most, Math.min(99, Math.floor(100 * share())));
  return map.most;
}
// Work on the open window's map: it filling itself ('fill'), or the check of a picked dot while
// it is held ('check'). It opens the job's runs, keeps the window following them and closes
// them at the end. A run that fails while the work goes on is remembered (map.failed), so a
// check does not wait for it.
async function mapWork(map, kind, work) {
  if (map.run || _fit || !map.job) return;
  const { job } = map, run = map.run = { kind, stopped: false, step: null, star: null, searched: 0, fit: null, stalled: 0, measure: null, close: null, ended: null };
  const runs = job.start(() => !run.stopped);
  run.close = runs.close;
  run.measure = (values) => runs.measure(values).then((r) => { if (!r && !run.stopped) map.failed.add(fitRunKey(job.store, values)); return r; });
  const ticker = setInterval(() => { mapSync(map); showMap(); }, MAP_REDRAW_MS);
  run.ended = work(run.measure, () => run.stopped).catch((e) => { console.error('Map: the run stopped on an error', e); }).then(() => {
    clearInterval(ticker);
    runs.close();
    map.run = null;
    if (_map !== map) return;
    mapSync(map);
    showMap();
  });
  showMap();
  await run.ended;
}
// The map fills itself; a map that comes to its end is marked as done for the settings that were free and the search it ran (map.doneKey).
const startMapFill = (map) => mapWork(map, 'fill', async (measure, over) => { if (await mapFill(map, measure, over)) map.job.store.mapDone = map.doneKey; });
// Done: the rounds came to their end (store.mapDone), and every search of this window has its result.
const mapIsDone = (map) => !!map.job && map.job.store.mapDone === map.doneKey && (!map.ask || map.plans.every(plan => mapSearched(map, plan)));
// Stop the window's work and wait for it to wind down.
function stopMapWork(map) {
  const { run } = map;
  if (!run) return Promise.resolve();
  run.stopped = true;
  run.close();
  return run.ended;
}

// ---- The window ----
// The window's job and dots, from the settings, the frozen ones and the kept runs as they are now,
// and the searches it will run (setMapPlan). found: what fitJobFor gave for the key; period: the
// Fit window's years where they are set (fitPeriodOf), which the job was made for.
function setMapJob(map, found, period) {
  const job = found.job || null;
  Object.assign(map, { job, frozen: !!found.frozen, space: job ? job.space.map(mapSetting) : [], years: period ? period.text : null,
    dots: new Map(), byResult: new Map(), twins: new Set(), failed: new Set(), version: 0, places: null, fronts: null, most: 0, drawn: null });
  setMapPlan(map, period);
  mapSync(map);
}
// The searches a map runs, from the Fit window's choices as they are now: its plan without
// "fewest settings", and for a window set to Cliff the same plan on a plateau after it.
function setMapPlan(map, period) {
  const { job } = map, plan = Object.assign(fitPlanOf(fitChoices()), { fewest: false });
  const floor = job ? fitFloorFor(map.key, plan, job.cagrOf, period) : { lacking: true };
  Object.assign(map, { floor: floor.floor || null, ask: !floor.lacking,
    // What a done map goes with: the settings that were free, and the plan whatever its shape (the rounds do not depend on the shape).
    doneKey: job ? job.space.map(s => s.id).join(',') + '|' + JSON.stringify(Object.assign({}, plan, { plateau: null })) : '',
    plans: plan.plateau ? [plan] : [plan, Object.assign({}, plan, { plateau: true })] });
}
const mapTipIcon = (tip) => `<span class="info-icon" tabindex="0" data-tip-wide data-tip="${_escHtml(tip)}">ⓘ</span>`;
// years: the Fit window's years when the map is for them (fitPeriodOf's text), named after the strategy.
function buildMapWindowHtml(key, years) {
  return `<div class="modal-backdrop" data-map-close></div>`
    + `<div class="modal-content fit-window map-window" role="dialog" aria-modal="true" aria-label="Map">`
    + `<div class="fit-window-head"><h3>Map</h3>${mapTipIcon(MAP_TIP)}<span class="fit-window-name">${_escHtml(fitKeyName(key) + (years ? ', ' + years : ''))}</span><button type="button" class="modal-close" data-map-close aria-label="Close">×</button></div>`
    + `<div class="fit-window-body map-body"><div class="map-main"><div class="map-chart"></div>`
    + `<div class="map-legend">${MAP_LEGEND.map(key => `<span class="map-key"><i class="map-key-${key.mark}"></i>${key.name}${key.tip ? mapTipIcon(key.tip) : ''}</span>`).join('')}</div></div>`
    + `<div class="map-side"><div class="map-detail"></div></div></div>`
    + `<div class="fit-window-foot map-foot"><span class="map-status"><span class="map-count"></span>${mapTipIcon(MAP_RUN_TIP)}</span>`
    + `<button type="button" class="map-csv-btn" data-map-csv title="${_escHtml(MAP_CSV_TIP)}">CSV</button>`
    + `<button type="button" class="fit-run-btn map-run-btn" data-map-run></button></div></div>`
    + `<div class="map-tip" hidden></div>`;
}
// Opened from the Fit window. It starts filling itself at once, unless it was done before on the same choices.
function openMapWindow(key) {
  const period = fitPeriodOf(fitChoices()), found = fitJobFor(key, period);
  if (!found) return;   // nothing to map: no such strategy, no setting with a choice, or the chart not drawn yet
  closeMapWindow(false);
  const el = document.createElement('div');
  el.className = 'modal fit-modal map-modal';
  const map = _map = { el, key, picked: null, chart: null, run: null };
  el.innerHTML = buildMapWindowHtml(key, period ? period.text : null);
  document.body.appendChild(el);
  document.body.classList.add('modal-open');
  el.addEventListener('click', onMapWindowClick);
  document.addEventListener('keydown', _mapWindowKey, true);
  setMapJob(map, found, period);
  showMap();
  if (!mapIsDone(map)) startMapFill(map);
}
// back: the reader closed it, so the Fit window it was opened from comes back.
async function closeMapWindow(back) {
  const map = _map;
  if (!map) return;
  _map = null;
  map.el.remove();
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', _mapWindowKey, true);
  if (back) openFitWindow(map.key);
  await stopMapWork(map);
}
// Escape closes the window alone: the key stops here, so the panel under it stays open.
function _mapWindowKey(e) {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  closeMapWindow(true);
}
function onMapWindowClick(e) {
  const map = _map, on = (selector) => e.target.closest(selector);
  if (!map) return;
  if (on('[data-map-close]')) { closeMapWindow(true); return; }
  if (on('[data-map-run]')) { if (map.run) stopMapWork(map); else startMapFill(map); return; }
  if (on('[data-map-csv]')) { downloadMapCsv(map); return; }
  if (on('[data-map-clear]')) { pickMapDot(null); return; }
  if (on('[data-map-use]')) useMapDot(map);
}
// A dot picked on the chart (null: none). Unchecked, it is checked ahead of the others: a map
// filling itself takes its neighbours into its queue at once; a held one runs them alone.
async function pickMapDot(id) {
  const map = _map, dot = id ? map.dots.get(id) : null;
  map.picked = id;
  hideMapTip();
  if (dot && !dot.flat && map.run && map.run.kind === 'fill') mapCheck(map, dot.values, map.run.measure);
  showMap();
  if (map.run && map.run.kind === 'check') await stopMapWork(map);
  if (!dot || dot.flat || _map !== map || map.picked !== id) return;
  await mapWork(map, 'check', measure => mapCheck(map, dot.values, measure));
}
// The picked set put on the strategy, with a note under Settings as a fit leaves one.
function useMapDot(map) {
  const { job } = map, dot = map.dots.get(map.picked), now = mapNowDot(map);
  const changed = job.space.filter(s => String(dot.values[s.id]) !== String(job.cur[s.id]));
  if (!changed.length) return;
  const one = (text, was) => (was ? was + ' → ' : '') + text;
  const moved = `CAGR ${one(fitCagrText(job.cagrOf, dot.r), now && fitCagrText(job.cagrOf, now.r))}, max drawdown ${one(fitDdText(dot.r), now && fitDdText(now.r))}`;
  _fitNotes[job.key] = { text: `${fitYearsNote(map.years)}From the map: ${changed.length} setting${changed.length > 1 ? 's' : ''} changed. ${moved}.${dot.flat ? ' ' + mapWorstText(job, dot) : ''}`,
    changes: fitChangesOf(job.space, job.cur, dot.values) };
  job.apply(dot.values, changed);
  closeMapWindow(false);
  render();
}

// ---- What the window shows ----
// The chart, the picked dot's lines and the foot: all that moves while a map fills.
function showMap() {
  drawMap();
  showMapDetail();
  showMapFoot();
}
// Where a dot stands, and where its worst result among its neighbours does, in percent.
const mapOwnAt = (dot) => ({ x: dot.r.dd * 100, y: dot.cagr });
const mapFlatAt = (dot) => ({ x: dot.flat.dd * 100, y: dot.flatCagr });
function drawMap() {
  const map = _map, box = map.el.querySelector('.map-chart');
  if (!map.chart) {
    map.chart = new SettingsMapChart().container(box).linkLabel(MAP_WORST_LABEL)
      .hitRadius(window.matchMedia('(pointer: coarse)').matches ? MAP_HIT_PX.coarse : MAP_HIT_PX.fine)
      .onHover(showMapTip).onLeave(hideMapTip)
      // A click on a dot picks it. A click on empty plot does nothing: a pick is let go with the column's Clear
      // (the user, 2026-11-25: "make sure click can be discarded explicitly via button and not by empty area click on chart").
      .onPick((dot) => { if (dot) pickMapDot(dot.id); });
  }
  // Asked for many times a second while the map fills itself: drawn again only when the dots, the pick, the mark or the room changed.
  const width = box.getBoundingClientRect().width, fit = mapFitDot(map);
  const state = [map.version, map.picked, fit ? fit.id : '', width, window.innerHeight, map.frozen].join('|');
  if (map.drawn === state) return;
  map.drawn = state;
  const picked = map.picked ? map.dots.get(map.picked) : null;
  mapPlot(map, map.chart)
    .svgHeight(Math.round(Math.min(Math.max(MAP_CHART_MIN, width * MAP_CHART_SHARE), window.innerHeight * MAP_CHART_SCREEN)))
    .picked(picked ? picked.id : null)
    // The picked set tied to its worst result among its neighbours.
    .link(picked && picked.flat ? mapFlatAt(picked) : null)
    .emptyText(map.frozen ? MAP_FROZEN_TEXT : 'Mapping…')
    .render();
}
// A map on a chart: its dots (a tested one sized by how it holds), the line through the best
// ones, the settings as they are and the Fit mark. The window's chart, and the picture of the
// map in the Fit window.
function mapPlot(map, chart) {
  const now = mapNowDot(map), fit = mapFitDot(map);
  return chart
    .data(mapDotList(map).map(dot => Object.assign({ id: dot.id, size: dot.flat ? mapHolds(dot) : null }, mapOwnAt(dot))))
    .frontier(mapFronts(map).own.map(mapOwnAt))
    .now(now ? mapOwnAt(now) : null)
    .flags(fit ? [Object.assign({ id: 'fit', label: MAP_FIT_LABEL }, mapOwnAt(fit))] : []);
}
// ---- The map's picture in the Fit window ----
// The map as it stands, from the runs kept so far and with nothing run, drawn into `box`: what a
// map opened now on the same years and frozen settings starts from. Gives back what the card
// says beside it ({ tried, done }), or null when there is nothing to map. view: the caller's own
// holder for the picture ({} at first), one for as long as its window is open: a window drawn
// again draws on the chart it has, and the dots are read off the kept runs only when the years
// or the frozen settings they stand on changed (the Fit mark follows every other choice).
function showMapPreview(view, box, key, period) {
  const free = fitFreeIds(key), stands = [period ? period.text : '', free ? Array.from(free).join(',') : ''].join('|');
  if (view.map && view.stands === stands) setMapPlan(view.map, period);
  else {
    const found = fitJobFor(key, period, true);
    Object.assign(view, { stands, map: found ? { key, picked: null } : null });
    if (found) setMapJob(view.map, found, period);
  }
  const { map } = view;
  if (!map) return null;
  view.chart = view.chart || new SettingsMapChart().interactive(false);
  const width = box.getBoundingClientRect().width, H = MAP_PREVIEW_HEIGHT;
  mapPlot(map, view.chart.container(box))
    .svgHeight(map.dots.size ? Math.round(Math.min(Math.max(H.min, width * H.share), H.max)) : H.min)   // a map with nothing on it yet takes the least room
    .emptyText(map.frozen ? MAP_FROZEN_TEXT : 'Not mapped yet')
    .render();
  return { tried: map.dots.size, done: mapIsDone(map) };
}
// A set's worst result among its neighbours, in the words the window uses.
const mapWorstText = (job, dot) => `Worst case with one setting ${MAP_NEAR_PCT}% off: CAGR ${fitCagrText(job.cagrOf, dot.flat)}, max drawdown ${fitDdText(dot.flat)}.`;
// A dot's numbers on hover: its own, its worst case once checked, and how many settings it changes.
function showMapTip(point, event) {
  const map = _map, dot = map.dots.get(point.id), tip = map.el.querySelector('.map-tip'), { cagrOf } = map.job;
  tip.innerHTML = `<b>CAGR ${fitCagrText(cagrOf, dot.r)} · max drawdown ${fitDdText(dot.r)}</b>`
    + (dot.flat ? `<span>worst case: ${fitCagrText(cagrOf, dot.flat)} · ${fitDdText(dot.flat)}</span>` : '')
    + `<span>${dot.differs ? dot.differs + ' setting' + (dot.differs > 1 ? 's' : '') + ' changed' : 'your settings now'}</span>`;
  tip.hidden = false;
  const GAP = 14, box = tip.getBoundingClientRect();
  const left = event.clientX + GAP + box.width > window.innerWidth ? event.clientX - GAP - box.width : event.clientX + GAP;
  tip.style.left = Math.max(4, left) + 'px';
  tip.style.top = Math.max(4, Math.min(window.innerHeight - box.height - 4, event.clientY + GAP)) + 'px';
}
function hideMapTip() {
  if (_map) _map.el.querySelector('.map-tip').hidden = true;
}
// Beside the chart, in a column that scrolls by itself (under it on a narrow screen): a set's
// numbers, its worst case, and the whole strategy as its Settings read. The set is the dot that
// was clicked, a value it changes struck through with the new one beside it, with Use and Clear
// (which lets the dot go); until one is clicked, the settings as they are. The user (2026-11-25), of the search's result picked for
// the reader when it came in: "make sure this does not open without clicking, it appeared
// sudden", and "display clicked strategy it's own scrollable container on the right". Written
// only when it changes: it is asked for many times a second while a map fills, and a button
// rebuilt under the pointer would lose its click.
function showMapDetail() {
  const map = _map, box = map.el.querySelector('.map-detail'), html = mapDetailHtml(map);
  if (map.detailHtml === html) return;
  map.detailHtml = html;
  box.innerHTML = html;
}
function mapDetailHtml(map) {
  const { job } = map;
  if (!job) return '';   // every setting is frozen: there is no set to show
  const picked = map.picked ? map.dots.get(map.picked) : null, dot = picked || mapNowDot(map);   // no dot at all before the first run comes in
  const free = new Map(job.space.map(s => [s.id, s]));
  // A value the dot changes: the one it has now struck through, the dot's beside it. Any other: as it is.
  const value = (slot) => {
    const s = free.get(slot.id);
    if (!dot || !s || String(dot.values[s.id]) === String(job.cur[s.id])) return `<span class="map-value">${_escHtml(slot.value)}</span>`;
    return `<s class="map-old">${_escHtml(slot.value)}</s> <b class="map-new">${_escHtml(s.text(dot.values[s.id]))}</b>`;
  };
  const notes = !dot ? [] : [dot.differs ? '' : 'Your settings now.',
    dot === mapFitDot(map) ? `${MAP_FIT_LABEL}: what Run in the Fit window would pick.` : '',
    dot.flat ? mapWorstText(job, dot) : picked && map.run ? `Testing it with each setting ${MAP_NEAR_PCT}% off…` : ''].filter(Boolean);
  return (dot ? `<div class="map-detail-head"><span>CAGR <b>${fitCagrText(job.cagrOf, dot.r)}</b>, max drawdown <b>${fitDdText(dot.r)}</b></span>`
    + (dot.differs ? '<button type="button" class="map-use-btn" data-map-use>Use</button>' : '')
    + (picked ? '<button type="button" class="map-clear-btn" data-map-clear>Clear</button>' : '') + '</div>' : '')
    + notes.map(note => `<div class="map-near">${_escHtml(note)}</div>`).join('')
    + `<div class="map-strategy">${buildFitStrategyHtml(map.key, value)}</div>`;
}
// The map as a file: a row a dot, the highest CAGR first. The settings' columns carry the
// strategy's own names for them and the values as its dropdowns read (the user, 2026-11-25:
// "try the column names to match with the strategy ... and don't rename them as you'd like").
// A name two settings share gets the setting's id after it, so no two columns read alike.
function mapCsv(map) {
  const { job } = map, { settings } = job;
  const shared = new Set(settings.map(s => s.name).filter((name, i, all) => all.indexOf(name) !== i));
  const worst = `with one setting ${MAP_NEAR_PCT}% off`;
  const head = ['CAGR %', 'Max drawdown %', `CAGR % ${worst}`, `Max drawdown % ${worst}`].concat(settings.map(s => (shared.has(s.name) ? `${s.name} (${s.id})` : s.name)));
  const percent = (v) => v.toFixed(2);
  const rows = mapDotList(map).sort((a, b) => b.cagr - a.cagr).map(dot => [percent(dot.cagr), percent(dot.r.dd * 100),
    dot.flat ? percent(dot.flatCagr) : '', dot.flat ? percent(dot.flat.dd * 100) : '']
    .concat(settings.map(s => s.text(s.id in dot.values ? dot.values[s.id] : s.now))));
  return rowsToCsv([head].concat(rows));
}
function downloadMapCsv(map) {
  if (!map.job || !map.dots.size) return;
  const slug = fitKeyName(map.key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  downloadTextFile(mapCsv(map), `tqqq-map-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
}
// The foot: how many combinations the map has tried, and the button. While the map fills itself
// it shows the progress and stops it; a held map reads Resume; a done one has no button, since
// the map ran to its own end.
function showMapFoot() {
  const map = _map, button = map.el.querySelector('[data-map-run]'), tried = map.dots.size, filling = !!map.run && map.run.kind === 'fill', done = mapIsDone(map) && !filling;
  map.el.querySelector('.map-count').textContent = tried ? `${tried.toLocaleString('en-US')} tried${done ? '. Done.' : ''}` : '';
  const pct = filling ? mapPercent(map) : 0;
  button.textContent = filling ? `Mapping ${pct}% · Stop` : 'Resume';
  button.classList.toggle('running', filling);
  button.style.setProperty('--fit-pct', pct + '%');
  button.hidden = !map.job || done;
  button.disabled = !!_fit || (!!map.run && !filling);
  map.el.querySelector('[data-map-csv]').disabled = !tried;
}
