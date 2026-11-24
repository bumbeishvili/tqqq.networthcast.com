/*
 * The app's offline copy (registered by js/app-install.js; the manifest is
 * manifest.webmanifest). With it the site can be installed on a phone and opens with no
 * connection, on the files and prices of its last visit.
 *
 * Online it changes nothing a visitor can see: every request for one of the site's own files
 * goes to the network first, exactly as the page asked for it (the price files with
 * `cache: 'no-cache'`), and the answer is also kept. Only when the network fails is the kept
 * copy served. So a new release and the hourly prices arrive as they did before.
 *
 * One copy a file: one of the site's files is kept under its address without the query
 * string, so `js/data.js?v=572` and `?v=573` are the same entry and the newer replaces the
 * older, and a share link (index.html?...) opens offline on the kept page, which reads the
 * link itself.
 *
 * Files from outside are kept under their whole address and fetched readable (CORS), which
 * stores them at their real size; the opaque answer a script or style tag gets is counted as
 * several megabytes each. Two kinds:
 *   - FIXED: an address whose content never changes (the page's libraries at fixed versions
 *     on cdnjs, font files). Served from the kept copy once there is one.
 *   - the fonts' stylesheet, whose address stays while the font files it names can change:
 *     network first, as the site's own files.
 *
 * Analytics, live quotes and a linked spreadsheet are left alone: they go to the network and
 * fail offline, as they do for anyone whose connection drops.
 */
const KEPT = 'tqqq-app-1';   // raise the number to drop every kept file at the next visit
const FIXED = ['https://cdnjs.cloudflare.com/', 'https://fonts.gstatic.com/'];
const FONT_SHEETS = 'https://fonts.googleapis.com/';
// The app's page has two addresses, `/` and `/index.html`: a kept copy under either serves both.
const HOMES = ['', 'index.html'].map(page => new URL(page, self.registration.scope).href);
const namesOf = (name) => HOMES.includes(name) ? [name].concat(HOMES.filter(home => home !== name)) : [name];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys()
    .then(names => Promise.all(names.filter(name => name !== KEPT).map(name => caches.delete(name))))
    .then(() => self.clients.claim())));

// An outside file as it was asked for, but readable.
const readable = (request) => fetch(request.url, { mode: 'cors', credentials: 'omit', cache: request.cache });

// A whole answer (200, so never a part of a file) is kept under the name. The write runs beside
// the answer: the page gets its file at once, and a write that fails (a full disk) is the
// worker's own error, in its console, with the page's file untouched.
function keep(event, kept, name, response) {
  if (response.status === 200) event.waitUntil(kept.put(name, response.clone()));
}

// The first of the names that has a kept copy, in order.
async function firstKept(kept, names) {
  for (const name of names) {
    const copy = await kept.match(name);
    if (copy) return copy;
  }
}

// From the network, kept on the way; the kept copy when the network fails. With no copy the failure stands.
async function networkFirst(event, ask, names) {
  const kept = await caches.open(KEPT);
  let response;
  try {
    response = await ask();
  } catch (offline) {
    const copy = await firstKept(kept, names);
    if (copy) return copy;
    throw offline;
  }
  keep(event, kept, names[0], response);
  return response;
}

// The kept copy; with none, the network's answer, kept for next time.
async function keptFirst(event, ask, name) {
  const kept = await caches.open(KEPT), copy = await kept.match(name);
  if (copy) return copy;
  const response = await ask();
  keep(event, kept, name, response);
  return response;
}

// The answer to a request this worker looks after; null for one it leaves to the browser.
function answerFor(event, request) {
  const url = new URL(request.url);
  if (url.origin === self.location.origin) return networkFirst(event, () => fetch(request), namesOf(url.origin + url.pathname));
  if (url.href.startsWith(FONT_SHEETS)) return networkFirst(event, () => readable(request), [url.href]);
  if (FIXED.some(host => url.href.startsWith(host))) return keptFirst(event, () => readable(request), url.href);
  return null;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const answer = answerFor(event, event.request);
  if (answer) event.respondWith(answer);
});

// What the page loaded before this worker was in charge (the whole first visit, most of the
// time): the page names those files (js/app-install.js) and each is kept here. They are taken
// from the browser's own cache of that visit where it has them (`force-cache`): the very copy
// the page is running on, with no second download.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'keep') return;
  event.waitUntil(Promise.all(
    event.data.urls.map(url => answerFor(event, new Request(url, { cache: 'force-cache' }))).filter(Boolean)));
});
