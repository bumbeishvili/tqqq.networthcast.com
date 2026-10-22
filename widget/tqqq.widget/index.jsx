// Desktop widget for tqqq.networthcast.com (Übersicht). It frames the site's
// widget page (widget.html), which draws your portfolio, TQQQ intraday and your
// strategy's signal chart with the site's own code, interactions included.
// widget/install.sh copies this file into Übersicht's widgets folder and fills
// in the command, which prints the config.json next to it: your sheet (a
// published CSV link and the names of its date, amount and portfolio-value
// columns) and/or your Share link (your strategy and its settings), and
// optionally the page URL and the widget's width. config.json stays on this
// Mac; nothing in it goes into the repo.
export const command = '__RUN_SH__';
// Re-reads config.json, which also paces the retry below; the page refreshes
// its own data.
export const refreshFrequency = 20 * 1000;
// Each load of the widget asks for the page under its own address, so the
// desktop's browser cannot hand back a copy it kept from before (a 404 from
// before a deploy, say).
const LOADED_AT = Date.now();

const DEFAULTS = {
  // The copy of the site's widget page that widget/install.sh puts beside
  // this file (Übersicht serves it), reading the live site's data files.
  pageUrl: 'tqqq.widget/lib/site/widget.html',
  dataUrl: 'https://tqqq.networthcast.com/',
  width: 900,
  // The intraday chart: similar days only, any open and close, from this day
  // to the latest, on a linear scale.
  intraday: { similarDaysOnly: true, from: '2025-11-05', log: false },
};

export const className = `
  bottom: 20px;
  left: 20px;
  .message { width: 320px; padding: 12px 14px; border-radius: 12px; background: rgba(255, 255, 255, 0.92); color: #383874; font: 12px -apple-system, sans-serif; }
`;

// The page reports its height, so the frame fits it without a scrollbar. A
// page that never reports in (a deploy still on its way, the network down at
// load) is retried with each command run, under a fresh URL so no cached
// error page comes back.
export const initialState = { output: '', error: null, height: 520, ready: false, attempt: 0 };
export const init = dispatch => {
  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'tqqq-widget-size' && e.data.height > 0) dispatch({ type: 'SIZE', height: e.data.height });
  });
};
export const updateState = (event, prev) => (event.type === 'SIZE'
  ? { ...prev, height: event.height, ready: true }
  : { ...prev, output: event.output, error: event.error, attempt: prev.ready || !prev.output ? prev.attempt : prev.attempt + 1 });

export const render = ({ output, error, height, attempt }) => {
  let config;
  try { config = { ...DEFAULTS, ...JSON.parse(output) }; } catch (e) {
    return <div className="message">{error ? String(error) : output ? 'config.json could not be read.' : 'Loading…'}</div>;
  }
  // The Share link's query and fragment carry your strategy and deposits; a
  // fragment never leaves this Mac.
  let search = '', hash = '';
  if (config.shareLink) {
    try { const link = new URL(config.shareLink); search = link.search; hash = link.hash; } catch (e) {
      return <div className="message">The shareLink in config.json is not a link.</div>;
    }
  }
  const query = new URLSearchParams(search.replace(/^\?/, ''));
  query.set('load', LOADED_AT + (attempt ? '-' + attempt : ''));
  if (config.dataUrl) query.set('data', config.dataUrl);
  search = '?' + query.toString();
  // The live sheet rides the fragment too, next to the Share link's payloads.
  if (config.sheetUrl) {
    const columns = config.sheetColumns || {};
    const sheet = new URLSearchParams({ sheet: config.sheetUrl });
    for (const role of ['date', 'amount', 'value']) if (columns[role]) sheet.set(role, columns[role]);
    hash = hash ? hash + '&' + sheet.toString() : '#' + sheet.toString();
  }
  const intraday = { ...DEFAULTS.intraday, ...(config.intraday || {}) };
  const view = new URLSearchParams({ similar: intraday.similarDaysOnly ? '1' : '0', log: intraday.log ? '1' : '0' });
  if (intraday.from) view.set('from', intraday.from);
  hash = hash ? hash + '&' + view.toString() : '#' + view.toString();
  const src = config.pageUrl + search + hash;
  return <iframe src={src} title="TQQQ" style={{ display: 'block', width: config.width + 'px', height: height + 'px', border: 0, background: 'transparent' }} />;
};
