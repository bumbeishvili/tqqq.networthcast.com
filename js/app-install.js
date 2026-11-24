// The site as an app (the user, 2026-11-24: "Any chance of creating mobile android app?", then
// "Ok do the first option"): it can be installed from the browser, opens in a window of its own
// and works with no connection on the files of its last visit. Three parts: the manifest
// (manifest.webmanifest, linked from index.html), the offline copy (sw.js) and this file, which
// starts the offline copy and offers the installation in the Resources menu.
(function () {
  const worker = navigator.serviceWorker;
  if (!worker) return;   // a browser without service workers (some in-app ones) shows the site as before

  worker.register('sw.js');
  // The first visit loads before the worker is in charge, so nothing of it would be kept. Every
  // file the page asked for before the worker took over is named to it, and it fetches and keeps
  // them. A load is reported when it ends, so one that began before the takeover (a price file
  // still on its way) can arrive after it: the watch stays on and goes by when a load began.
  if (!worker.controller) {
    let inCharge = Infinity;   // when the worker took over, on the page's clock
    worker.addEventListener('controllerchange', () => { inCharge = performance.now(); });
    const keep = (urls) => worker.ready.then(registration => registration.active.postMessage({ type: 'keep', urls }));
    const loads = new PerformanceObserver((list) => {
      const early = list.getEntries().filter(entry => entry.startTime < inCharge).map(entry => entry.name);
      if (early.length) keep(early);
    });
    keep([location.href]);
    loads.observe({ type: 'resource', buffered: true });
  }

  // The browser's offer to install (Chrome and Edge make one once the manifest and the worker
  // are in place; it is theirs to make, and a browser that makes none leaves the entry hidden).
  const entry = document.getElementById('install-app');
  let offer = null;
  window.addEventListener('beforeinstallprompt', (event) => { offer = event; entry.hidden = false; });
  window.addEventListener('appinstalled', () => { entry.hidden = true; });
  entry.addEventListener('click', () => { offer.prompt(); entry.hidden = true; });
})();
