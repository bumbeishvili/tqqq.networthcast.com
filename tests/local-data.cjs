/*
 * Local-only series (data/local/, ignored by git) for the library tests: the
 * arrays the site adds to a custom strategy's data when the folder exists
 * (js/data.js loadLocalSeries + buildLocalDaily), and the library entries that
 * cannot run without them (js/strategy-library-code.js localData), which the
 * tests skip. Needs js/data.js already run in this context.
 */
const fs = require('fs');
const path = require('path');
function localDataFor(root, daily, code) {
  const dir = path.join(root, 'data', 'local'), indexFile = path.join(dir, 'index.json');
  const series = fs.existsSync(indexFile)
    ? Object.fromEntries(JSON.parse(fs.readFileSync(indexFile, 'utf8')).series.map(s => [s.key, parseDataFile(fs.readFileSync(path.join(dir, s.file), 'utf8'))]))
    : {};
  const arrays = buildLocalDaily(daily, series);
  const skipped = Object.entries(code.localData).filter(([, keys]) => !keys.every(k => arrays[k])).map(([n]) => +n);
  if (skipped.length) console.log(`skipped without data/local: #${skipped.join(', #')}`);
  return { arrays, skipped };
}
module.exports = { localDataFor };
