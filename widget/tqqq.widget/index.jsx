// Desktop widget for tqqq.networthcast.com (Übersicht). It frames the site's
// widget page (widget.html), which draws your portfolio, TQQQ intraday and your
// strategy's signal chart with the site's own code, interactions included.
// widget/install.sh copies this file into Übersicht's widgets folder and fills
// in the command, which prints the config.json next to it: your Share link,
// and optionally the page URL and the widget's width.
export const command = '__RUN_SH__';
// Re-reads config.json; the page refreshes its own data.
export const refreshFrequency = 60 * 1000;

const DEFAULTS = { pageUrl: 'https://tqqq.networthcast.com/widget.html', width: 900 };

export const className = `
  top: 30px;
  right: 20px;
  .message { width: 320px; padding: 12px 14px; border-radius: 12px; background: rgba(255, 255, 255, 0.92); color: #383874; font: 12px -apple-system, sans-serif; }
`;

// The page reports its height, so the frame fits it without a scrollbar.
export const initialState = { output: '', error: null, height: 520 };
export const init = dispatch => {
  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'tqqq-widget-size' && e.data.height > 0) dispatch({ type: 'SIZE', height: e.data.height });
  });
};
export const updateState = (event, prev) => (event.type === 'SIZE'
  ? { ...prev, height: event.height }
  : { ...prev, output: event.output, error: event.error });

export const render = ({ output, error, height }) => {
  let config;
  try { config = { ...DEFAULTS, ...JSON.parse(output) }; } catch (e) {
    return <div className="message">{error ? String(error) : output ? 'config.json could not be read.' : 'Loading…'}</div>;
  }
  // The Share link's query and fragment carry your strategy and deposits; a
  // fragment never leaves this Mac.
  let src = config.pageUrl;
  if (config.shareLink) {
    try { const link = new URL(config.shareLink); src = config.pageUrl + link.search + link.hash; } catch (e) {
      return <div className="message">The shareLink in config.json is not a link.</div>;
    }
  }
  return <iframe src={src} title="TQQQ" style={{ display: 'block', width: config.width + 'px', height: height + 'px', border: 0, background: 'transparent' }} />;
};
