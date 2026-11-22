/*
 * The site's funds are listed in four places that cannot read one another: the main app's live funds
 * (js/data.js), the quotes worker's symbols (cloudflare/quotes/src/worker.mjs), the intraday page's
 * dropdown (experiments/tqqq-intraday.html) and the 5-minute history pull (scripts/update_intraday.py).
 * A fund added to one and not the others would be quoted but have no intraday history, or sit in the
 * dropdown with no file. This holds the four lists to each other.
 *
 *   node tests/fund-lists.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Each list: the file, and the source text just before its opening bracket.
const LISTS = [
  { file: 'js/data.js', opens: 'const LIVE_FUNDS = [' },
  { file: 'cloudflare/quotes/src/worker.mjs', opens: 'const SYMBOLS = [' },
  { file: 'experiments/tqqq-intraday.html', opens: 'const TICKERS = [' },
  { file: 'scripts/update_intraday.py', opens: '\nTICKERS = [' },
];
function fundsOf({ file, opens }) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const from = text.indexOf(opens);
  if (from < 0) throw new Error(`${file}: no "${opens.trim()}"`);
  const body = text.slice(from + opens.length, text.indexOf(']', from));
  return body.split(',').map(name => name.trim().replace(/['"]/g, '').toUpperCase()).filter(Boolean);
}

const lists = LISTS.map(list => ({ file: list.file, funds: fundsOf(list) }));
const reference = lists[0];
let failed = 0;
lists.forEach(({ file, funds }) => {
  const same = funds.length === reference.funds.length && funds.every((fund, i) => fund === reference.funds[i]);
  if (!same) failed++;
  console.log(`${same ? 'ok  ' : 'FAIL'}  ${file}: ${funds.join(' ')}`);
});
console.log(failed ? `${failed} of ${lists.length} lists differ from ${reference.file}'s` : `fund lists: all ${lists.length} agree (${reference.funds.length} funds)`);
process.exit(failed ? 1 : 0);
