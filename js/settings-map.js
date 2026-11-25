// ---- The settings map ----
// The user (2026-11-25), with a picture of a bubble chart split in four: "Is
// there a way to build CAGR & Drawdown graph for the strategy, similar to
// this, I'd imagine it will take some time, but many processes could be shared
// across so it is actually quicker".
//
// A "Map" button beside Fit opens a window with one dot for every set of the
// strategy's settings that has been run on the chart's period and money: its
// max drawdown across, its CAGR up (js/settings-map-chart.js draws it). Dashed
// lines through the settings as they are split the plot in four; a set up and
// to the left of them is better on both counts. The dots are the key's kept
// runs (fitRunStore in js/saved-configs.js): a fit's runs are on the map, and
// the map's runs make a later fit quicker. The settings frozen for Fit are
// frozen here too.
//
// Run fills the map for MAP_RUN_MS:
//   1. The settings as they are, then every setting at each of its values with
//      the others held.
//   2. Rounds of breeding and checking until the time is up.
//      Breeding: new sets made from the frontier (the sets no other beats on
//      both counts), one with one to three settings moved, or two mixed.
//      Settings drawn at random are of no use: on Late-week + overextended 400
//      of them had a median CAGR of 17% against 212% for the settings as they
//      were, and none beat those on both counts.
//      Checking: a set gets all its neighbours run, each setting at the
//      values within a tenth of its own, as a plateau fit counts them
//      (fitPlateauSetting). That says how the set holds with a setting a
//      little off. The checks take turns between a frontier set far from the
//      checked ones (mapNextCheck) and a step from a checked set away from its
//      weakest neighbour (mapNextSteadier): the sets on the frontier mostly
//      stand on a cliff (2026-11-25: of 24 frontier sets checked on Late-week
//      + overextended, the ones at a 40% drawdown had a neighbour at 71%).
// A checked set is drawn larger the better it holds (mapHolds). "Plateau"
// moves every checked set to the worst result among it and its neighbours and
// hides the rest, so the plot reads as a plateau fit judges. A picked dot
// lists what differs from the settings as they are, is checked if it was not,
// and "Use" sets it.
const MAP_RUN_MS = 60000;          // one Run, or one More
const MAP_BREED = 48;              // sets bred in one batch
const MAP_BREED_BATCHES = 2;       // batches between two checks: a check costs about as many runs
const MAP_BREED_TRIES = 20;        // draws at a set not run yet, for each set wanted
const MAP_MOVES = [0.7, 0.95];     // a bred set moves one setting up to the first share of the draws, two up to the second, else three
const MAP_MIX_SHARE = 0.35;        // bred sets mixed from two frontier sets
const MAP_NEAR_SHARE = 0.6;        // a number's moves that go to a value close by in its list; the rest go to any value
const MAP_REDRAW_MS = 400;         // the window follows a running map this often
const MAP_CHART_SHARE = 0.72;      // the chart's height against its width,
const MAP_CHART_MIN = 300;         // at least this many px (a phone's chart is narrow),
const MAP_CHART_SCREEN = 0.52;     // and at most this share of the screen's height
const MAP_HIT_PX = { fine: 14, coarse: 22 };   // how near a dot the pointer, or a finger, has to be
const MAP_VIEW_KEY = 'tqqq_map_view_v1';
const MAP_VIEW = { name: 'Shape', options: [['cliff', 'Cliff'], ['plateau', 'Plateau']],
  tip: 'Cliff: every set at its own CAGR and max drawdown. Plateau: only the checked sets, each at the worst result among it and its neighbours, the sets with one setting a tenth off either way.' };
const MAP_TIP = "Every dot is one set of settings on the chart's period and money: its max drawdown across, its CAGR up. The dashed lines cross at the settings as they are. "
  + 'Run tries every setting at each of its values, then for a minute breeds new sets from the best found and checks them: a checked set has all its neighbours run, the sets with one setting a tenth off either way. '
  + 'A larger dot holds better among its neighbours. The thin line joins the sets no other beats on both counts. Runs are shared with Fit, and the settings frozen there stay as they are here. '
  + 'Zoom with ⌘ or Ctrl and the wheel, or a pinch; drag to move.';
let _map = null;   // the open window: { el, key, view, picked, freezeOpen, chart, job, space, dots, byResult, failed, run }

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

// The frontier of a list: the items no other beats on both counts (a higher final value with no
// deeper drawdown), from the smallest drawdown up. of(item) gives its { final, dd }.
function mapFrontier(items, of) {
  const sorted = items.slice().sort((a, b) => of(a).dd - of(b).dd || of(b).final - of(a).final);
  const front = [];
  let top = -Infinity;
  sorted.forEach((item) => { if (of(item).final > top) { front.push(item); top = of(item).final; } });
  return front;
}

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
// A dot: { id (the set's key in the store, fitRunKey), values, r: { final, dd }, cagr, differs (how many settings
// are not as they stand now), flat (its plateau judgement, fitFlatOf, once checked), flatCagr,
// waits (the first neighbour a check still lacks) }.
// What a search may not change stays as it is: a kept run with another value for a frozen setting
// is no dot. Two runs with the very same result are one dot, the one nearer to the settings as
// they are (a fit's runs can differ in a setting that does not show, which changes nothing).
function mapSync(map) {
  const { job, dots, byResult } = map;
  if (!job) { map.picked = null; return; }
  const { cur, store, cagrOf } = job, free = new Set(job.space.map(s => s.id)), held = Object.keys(cur).filter(id => !free.has(id));
  store.done.forEach((kept, id) => {
    if (dots.has(id) || map.twins.has(id) || !held.every(h => String(kept.values[h]) === String(cur[h]))) return;
    const differs = job.space.filter(s => String(kept.values[s.id]) !== String(cur[s.id])).length;
    const same = kept.r.final + '|' + kept.r.dd, twin = byResult.get(same);
    if (twin && twin.differs <= differs) { map.twins.add(id); return; }
    if (twin) { dots.delete(twin.id); map.twins.add(twin.id); }
    const dot = { id, values: kept.values, r: kept.r, cagr: cagrOf(kept.r.final), differs, flat: null, flatCagr: null, waits: null };
    dots.set(id, dot);
    byResult.set(same, dot);
  });
  dots.forEach(dot => mapCheckDot(map, dot));
  if (map.picked && !dots.has(map.picked)) map.picked = null;   // the picked dot gave way to its twin, or a setting it differs in was frozen
}
// A dot is checked once every neighbour of its set has been run, or has failed: it then has its
// plateau judgement. Until then it remembers the first neighbour it waits for.
function mapCheckDot(map, dot) {
  const { store, cagrOf } = map.job, known = (id) => store.done.has(id) || map.failed.has(id);
  if (dot.flat || (dot.waits && !known(dot.waits))) return;
  const moves = [];
  for (const move of mapMoves(map.space, dot.values)) {
    const id = fitRunKey(store, fitMoved(dot.values, move));
    if (!known(id)) { dot.waits = id; return; }
    moves.push(Object.assign(move, { r: store.done.has(id) ? store.done.get(id).r : null }));
  }
  dot.flat = fitFlatOf(dot.r, moves);
  dot.flatCagr = cagrOf(dot.flat.final);
  dot.waits = null;
}
const mapDotList = (map) => Array.from(map.dots.values());
const mapNowDot = (map) => (map.job ? map.dots.get(fitRunKey(map.job.store, map.job.cur)) : null) || null;
const mapOwn = (dot) => dot.r, mapFlat = (dot) => dot.flat;

// ---- Filling the map ----
// The sets new ones are bred from: the frontier, and the frontier of the checked sets by their
// worst result, so the sets that hold have offspring too.
function mapParents(dots) {
  return [...new Set(mapFrontier(dots, mapOwn).concat(mapFrontier(dots.filter(mapFlat), mapFlat)))];
}
// Up to `count` sets not run yet, bred from the parents.
function mapBreed(map, rand, count) {
  const { job } = map, parents = mapParents(mapDotList(map)), sets = new Map();
  if (!parents.length) return [];
  for (let tries = 0; sets.size < count && tries < count * MAP_BREED_TRIES; tries++) {
    const child = mapChild(map.space, job.cur, parents, rand), id = fitRunKey(job.store, child);
    if (!job.store.done.has(id) && !map.failed.has(id)) sets.set(id, child);
  }
  return Array.from(sets.values());
}
// The next frontier set to check: an unchecked one; first those that beat the settings as they
// are on both counts; of them the one furthest on the plot from every checked set (each axis
// taken against the frontier's spread), so the checks spread over the frontier instead of
// piling up where it is crowded. null when the whole frontier is checked.
function mapNextCheck(map) {
  const dots = mapDotList(map), front = mapFrontier(dots, mapOwn), now = mapNowDot(map);
  const open = front.filter(dot => !dot.flat);
  if (!open.length) return null;
  const checked = dots.filter(mapFlat);
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
  const front = mapFrontier(mapDotList(map).filter(mapFlat), mapFlat).sort((a, b) => b.flat.final - a.flat.final);
  for (const dot of front) {
    for (const spot of [dot.flat.low, dot.flat.deep]) {
      const values = spot && mapStepAway(map, dot, spot), id = values && fitRunKey(map.job.store, values);
      if (id && !map.failed.has(id) && !map.twins.has(id) && !(map.dots.has(id) && map.dots.get(id).flat)) return values;
    }
  }
  return null;
}
// A set and its neighbours run, so that it can be checked (mapCheckDot).
const mapCheck = (map, values, measure) => Promise.all([measure(Object.assign({}, values))]
  .concat(Array.from(mapMoves(map.space, values), move => measure(fitMoved(values, move)))));
// One Run: see the head of this file. over() says when to end: the time is up, or Stop.
async function mapFill(map, measure, over) {
  const { job, space } = map, { cur } = job, rand = mapRandom(job.store.done.size + 1);
  await measure(Object.assign({}, cur));
  for (const s of space) {
    if (over()) return;
    if (s.shown(cur)) await Promise.all(s.values.filter(v => String(v) !== String(cur[s.id])).map(v => measure(Object.assign({}, cur, { [s.id]: v }))));
  }
  job.store.mapped = true;
  let steady = false;
  while (!over()) {
    let bred = 0;
    for (let batch = 0; batch < MAP_BREED_BATCHES && !over(); batch++) {
      mapSync(map);
      const sets = mapBreed(map, rand, MAP_BREED);
      bred += sets.length;
      await Promise.all(sets.map(measure));
    }
    if (over()) return;
    mapSync(map);
    // The checks take turns: a frontier set, then a step toward a steadier set; one takes the other's turn when it has none.
    const onFrontier = mapNextCheck(map), steadier = mapNextSteadier(map);
    const next = (steady ? [steadier, onFrontier && onFrontier.values] : [onFrontier && onFrontier.values, steadier]).find(Boolean);
    steady = !steady;
    if (next) await mapCheck(map, next, measure);
    else if (!bred) return;   // nothing left to breed or to check: every set there is has been run
  }
}
// Work on the open window's map: a Run ('fill') or the check of a picked dot ('check'). It opens
// the job's runs, keeps the window following them and closes them at the end. A run that fails
// while the work goes on is remembered (map.failed), so a check does not wait for it.
async function mapWork(map, kind, work) {
  if (map.run || _fit || !map.job) return;
  const { job } = map, run = map.run = { kind, stopped: false, began: performance.now(), close: null, ended: null };
  const runs = job.start(() => !run.stopped);
  run.close = runs.close;
  const measure = (values) => runs.measure(values).then((r) => { if (!r && !run.stopped) map.failed.add(fitRunKey(job.store, values)); return r; });
  const over = () => run.stopped || (kind === 'fill' && performance.now() - run.began >= MAP_RUN_MS);
  const ticker = setInterval(() => { mapSync(map); showMap(); }, MAP_REDRAW_MS);
  run.ended = work(measure, over).catch((e) => { console.error('Map: the run stopped on an error', e); }).then(() => {
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
// Stop the window's work and wait for it to wind down.
function stopMapWork(map) {
  const { run } = map;
  if (!run) return Promise.resolve();
  run.stopped = true;
  run.close();
  return run.ended;
}

// ---- The window ----
function mapView() {
  let kept = null;
  try { kept = localStorage.getItem(MAP_VIEW_KEY); } catch (e) {}
  return MAP_VIEW.options.some(([id]) => id === kept) ? kept : MAP_VIEW.options[0][0];
}
// The window's job and dots, from the settings, the frozen ones and the kept runs as they are now.
// found: what fitJobFor gave for the key, when the caller has just asked.
function setMapJob(map, found = fitJobFor(map.key) || {}) {
  Object.assign(map, { job: found.job || null, frozen: !!found.frozen, space: found.job ? found.job.space.map(mapSetting) : [],
    dots: new Map(), byResult: new Map(), twins: new Set(), failed: new Set() });
  mapSync(map);
}
// The Map button beside Fit.
function buildMapButtonHtml(key) {
  const tip = "Opens the map: every set of settings that has been run on the chart's current period and money as a dot, by its max drawdown and its CAGR.";
  return `<span class="settings-fit-wrap"><button type="button" class="settings-reset-btn" data-map-key="${_escHtml(key)}">Map</button>`
    + `<span class="info-icon" tabindex="0" data-tip="${_escHtml(tip)}">ⓘ</span></span>`;
}
const mapTipIcon = (tip) => `<span class="info-icon" tabindex="0" data-tip-below data-tip-wide data-tip="${_escHtml(tip)}">ⓘ</span>`;
function buildMapWindowHtml(key) {
  return `<div class="modal-backdrop" data-map-close></div>`
    + `<div class="modal-content fit-window map-window" role="dialog" aria-modal="true" aria-label="Map">`
    + `<div class="fit-window-head"><h3>Map</h3>${mapTipIcon(MAP_TIP)}<span class="fit-window-name">${_escHtml(fitKeyName(key))}</span><button type="button" class="modal-close" data-map-close aria-label="Close">×</button></div>`
    + `<div class="fit-window-body"><div class="map-freeze"></div><div class="map-view"></div><div class="map-chart"></div><div class="map-detail"></div></div>`
    + `<div class="fit-window-foot map-foot"><span class="map-count"></span><button type="button" class="fit-run-btn map-run-btn" data-map-run></button></div></div>`
    + `<div class="map-tip" hidden></div>`;
}
function openMapWindow(key) {
  const found = fitJobFor(key);
  if (!found) return;   // nothing to map yet: no such strategy, no setting with a choice, or the chart not drawn
  closeMapWindow();
  const el = document.createElement('div');
  el.className = 'modal fit-modal map-modal';
  const map = _map = { el, key, view: mapView(), picked: null, freezeOpen: false, chart: null, run: null };
  el.innerHTML = buildMapWindowHtml(key);
  document.body.appendChild(el);
  document.body.classList.add('modal-open');
  el.addEventListener('click', onMapWindowClick);
  // A tick in the Freeze list changes what may move: the work under way ends, and the dots are read again.
  el.addEventListener('change', (e) => { if (fitFreezeTicked(el, key, e.target)) mapFreezeChanged(map); });
  document.addEventListener('keydown', _mapWindowKey, true);
  setMapJob(map, found);
  showMapFreeze();
  showMapView();
  showMap();
}
async function closeMapWindow() {
  const map = _map;
  if (!map) return;
  _map = null;
  map.el.remove();
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', _mapWindowKey, true);
  await stopMapWork(map);
}
// Escape closes the window alone: the key stops here, so the panel under it stays open.
function _mapWindowKey(e) {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  closeMapWindow();
}
async function mapFreezeChanged(map) {
  await stopMapWork(map);
  if (_map !== map) return;
  setMapJob(map);
  showMap();
}
function onMapWindowClick(e) {
  const map = _map, on = (selector) => e.target.closest(selector);
  if (!map) return;
  if (on('[data-map-close]')) { closeMapWindow(); return; }
  if (on('[data-fit-freeze-toggle]')) { map.freezeOpen = !map.freezeOpen; showMapFreeze(); return; }
  if (on('[data-fit-freeze-reset]')) { setFitFreezeChoices(map.key, {}); showMapFreeze(); mapFreezeChanged(map); return; }
  const view = on('[data-map-view]');
  if (view) {
    map.view = view.getAttribute('data-map-view');
    try { localStorage.setItem(MAP_VIEW_KEY, map.view); } catch (err) {}
    showMapView();
    showMap();
    return;
  }
  if (on('[data-map-run]')) { if (map.run) stopMapWork(map); else mapWork(map, 'fill', (measure, over) => mapFill(map, measure, over)); return; }
  if (on('[data-map-use]')) useMapDot(map);
}
// A dot picked on the chart (null: none). Unchecked, it gets its neighbours run when no Run is
// under way; a check still going for another dot gives way.
async function pickMapDot(id) {
  const map = _map;
  map.picked = id;
  hideMapTip();
  showMap();
  if (map.run && map.run.kind === 'check') await stopMapWork(map);
  const dot = id && _map === map && map.picked === id ? map.dots.get(id) : null;
  if (!dot || dot.flat) return;
  await mapWork(map, 'check', measure => mapCheck(map, dot.values, measure));
}
// The picked set put on the strategy, with a note under Settings as a fit leaves one.
function useMapDot(map) {
  const { job } = map, dot = map.dots.get(map.picked), now = mapNowDot(map);
  const changed = job.space.filter(s => String(dot.values[s.id]) !== String(job.cur[s.id]));
  if (!changed.length) return;
  const one = (text, was) => (was ? was + ' → ' : '') + text;
  const moved = `CAGR ${one(fitCagrText(job.cagrOf, dot.r), now && fitCagrText(job.cagrOf, now.r))}, max drawdown ${one(fitDdText(dot.r), now && fitDdText(now.r))}`;
  _fitNotes[job.key] = { text: `From the map: ${changed.length} setting${changed.length > 1 ? 's' : ''} changed. ${moved}.${dot.flat ? ' ' + fitNearText(job.cagrOf, dot.flat) : ''}`,
    changes: fitChangesOf(job.space, job.cur, dot.values) };
  job.apply(dot.values, changed);
  closeMapWindow();
  render();
}

// ---- What the window shows ----
function showMapFreeze() {
  _map.el.querySelector('.map-freeze').innerHTML = buildFitFreezeHtml(_map.key, _map.freezeOpen);
}
function showMapView() {
  const { el, view } = _map;
  el.querySelector('.map-view').innerHTML = `<div class="fit-row"><span class="fit-row-name">${MAP_VIEW.name}${mapTipIcon(MAP_VIEW.tip)}</span>`
    + `<span class="fit-seg" role="group" aria-label="${MAP_VIEW.name}">${MAP_VIEW.options.map(([id, label]) =>
      `<button type="button" class="fit-seg-btn${view === id ? ' on' : ''}" data-map-view="${id}" aria-pressed="${view === id}">${label}</button>`).join('')}</span></div>`;
}
// The chart, the picked dot's lines and the foot: all that moves while a map fills.
function showMap() {
  drawMap();
  showMapDetail();
  showMapFoot();
}
// Where a dot stands in each view, in percent.
const mapOwnAt = (dot) => ({ x: dot.r.dd * 100, y: dot.cagr });
const mapFlatAt = (dot) => ({ x: dot.flat.dd * 100, y: dot.flatCagr });
function drawMap() {
  const map = _map, box = map.el.querySelector('.map-chart'), plateau = map.view === 'plateau';
  if (!map.chart) {
    map.chart = new SettingsMapChart().container(box)
      .hitRadius(window.matchMedia('(pointer: coarse)').matches ? MAP_HIT_PX.coarse : MAP_HIT_PX.fine)
      .onHover(showMapTip).onLeave(hideMapTip).onPick(dot => pickMapDot(dot ? dot.id : null));
  }
  const at = plateau ? mapFlatAt : mapOwnAt, shown = mapDotList(map).filter(dot => !plateau || dot.flat);
  const inView = (dot) => (dot && (!plateau || dot.flat) ? dot : null);
  const now = inView(mapNowDot(map)), picked = inView(map.picked ? map.dots.get(map.picked) : null);
  const width = box.getBoundingClientRect().width;
  map.chart
    .svgHeight(Math.round(Math.min(Math.max(MAP_CHART_MIN, width * MAP_CHART_SHARE), window.innerHeight * MAP_CHART_SCREEN)))
    .data(shown.map(dot => Object.assign({ id: dot.id, size: dot.flat ? mapHolds(dot) : null }, at(dot))))
    .frontier(mapFrontier(shown, plateau ? mapFlat : mapOwn).map(at))
    .now(now ? at(now) : null)
    .picked(picked ? picked.id : null)
    // The picked set tied to where it stands in the other view: its worst among the neighbours, or its own result.
    .link(picked && picked.flat ? (plateau ? mapOwnAt(picked) : mapFlatAt(picked)) : null)
    .emptyText(map.frozen ? 'Every setting is frozen.' : !map.dots.size ? 'Run fills the map. It takes a minute.' : 'No set is checked yet.')
    .render();
}
// A dot's numbers on hover: its own, the worst among its neighbours once checked, and how far it is from the settings as they are.
function showMapTip(point, event) {
  const map = _map, dot = map.dots.get(point.id), tip = map.el.querySelector('.map-tip'), { cagrOf } = map.job;
  tip.innerHTML = `<b>CAGR ${fitCagrText(cagrOf, dot.r)} · max drawdown ${fitDdText(dot.r)}</b>`
    + (dot.flat ? `<span>a tenth off: ${fitCagrText(cagrOf, dot.flat)} · ${fitDdText(dot.flat)}</span>` : '')
    + `<span>${dot.differs ? dot.differs + ' setting' + (dot.differs > 1 ? 's differ' : ' differs') : 'the settings as they are'}</span>`;
  tip.hidden = false;
  const GAP = 14, box = tip.getBoundingClientRect();
  const left = event.clientX + GAP + box.width > window.innerWidth ? event.clientX - GAP - box.width : event.clientX + GAP;
  tip.style.left = Math.max(4, left) + 'px';
  tip.style.top = Math.max(4, Math.min(window.innerHeight - box.height - 4, event.clientY + GAP)) + 'px';
}
function hideMapTip() {
  if (_map) _map.el.querySelector('.map-tip').hidden = true;
}
// Under the chart: the picked set's numbers, how it holds among its neighbours, what differs from
// the settings as they are, and Use. Written only when it changes: it is asked for many times a
// second while a map fills, and a button rebuilt under the pointer would lose its click.
function showMapDetail() {
  const map = _map, box = map.el.querySelector('.map-detail'), html = mapDetailHtml(map);
  if (map.detailHtml === html) return;
  map.detailHtml = html;
  box.innerHTML = html;
}
function mapDetailHtml(map) {
  const { job } = map, dot = map.picked ? map.dots.get(map.picked) : null;
  if (!dot) return map.dots.size ? '<div class="map-hint">Pick a dot for its settings.</div>' : '';
  const changes = fitChangesOf(job.space, job.cur, dot.values);
  const near = dot.flat ? fitNearText(job.cagrOf, dot.flat) : map.run && map.run.kind === 'check' ? 'Checking it a tenth off…' : '';
  return `<div class="map-detail-head"><span>CAGR <b>${fitCagrText(job.cagrOf, dot.r)}</b>, max drawdown <b>${fitDdText(dot.r)}</b></span>`
    + (changes.length ? '<button type="button" class="map-use-btn" data-map-use>Use</button>' : '') + '</div>'
    + (near ? `<div class="map-near">${_escHtml(near)}</div>` : '')
    + `<div class="map-differs">${changes.length ? changes.length + ' setting' + (changes.length > 1 ? 's differ' : ' differs') + ' from now:' : 'The settings as they are.'}</div>`
    + buildFitChangesHtml(changes);
}
// The foot: how many sets are on the map and how many are checked, and the button: Run, More
// once the map has been filled, and while it fills its progress, which stops it.
function showMapFoot() {
  const map = _map, button = map.el.querySelector('[data-map-run]'), dots = mapDotList(map), filling = !!map.run && map.run.kind === 'fill';
  const checked = dots.filter(mapFlat).length, count = (n) => n.toLocaleString('en-US');
  map.el.querySelector('.map-count').textContent = dots.length ? `${count(dots.length)} set${dots.length > 1 ? 's' : ''}, ${count(checked)} checked` : '';
  const pct = filling ? Math.min(99, Math.floor(100 * (performance.now() - map.run.began) / MAP_RUN_MS)) : 0;
  button.textContent = filling ? `Mapping ${pct}% · Stop` : map.job && map.job.store.mapped ? 'More' : 'Run';
  button.classList.toggle('running', filling);
  button.style.setProperty('--fit-pct', pct + '%');
  button.disabled = !map.job || !!_fit || (!!map.run && !filling);
  button.title = _fit ? 'A fit is running.' : '';
}

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-map-key]');
  if (button) openMapWindow(button.getAttribute('data-map-key'));
});
