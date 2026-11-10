'use strict';
// Browser check of the changes of 10 November 2026: the page loads, the data reaches 1953 for SOXL and SOXX, the
// library cards carry the new texts, the changed entries add and open with their new settings, no page errors.
const path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`  ${ok ? 'ok ' : 'BAD'} ${name}${detail ? '   ' + detail : ''}`); };
const until = async (page, fn, arg, what, ms = 180000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(250); } throw new Error('timed out waiting for ' + what); };
async function addAndOpen(page, n, search) {
  await page.evaluate(() => toggleStrategyLibrary()); await until(page, () => !document.getElementById('strategy-library-modal').hidden, null, 'library');
  await page.fill('#sl-search', search); await until(page, n => !!document.querySelector(`[data-sl-add="${n}"]`), n, 'card ' + n);
  const card = await page.evaluate(n => { const c = document.querySelector(`[data-sl-add="${n}"]`).closest('.sl-card'); return { title: c.querySelector('.sl-card-name').getAttribute('title') || '', eras: [...c.querySelectorAll('.sl-era-cagr, .sl-era-na')].map(x => x.textContent.trim()), dds: [...c.querySelectorAll('.sl-era-dd')].map(x => x.textContent.trim()) }; }, n);
  await page.click(`[data-sl-add="${n}"]`); await until(page, () => document.getElementById('strategy-library-modal').hidden, null, 'modal closed');
  await page.waitForTimeout(1200);
  const id = await page.evaluate(() => { const pills = document.querySelectorAll('.saved-config-pill'); return pills[pills.length - 1].getAttribute('data-config-id'); });
  await page.evaluate(id => openConfigForEdit(id), id);
  await until(page, id => document.getElementById('strategy-panel').getAttribute('aria-hidden') === 'false' && window._openCustomCfgId === id && !!(window._configMetrics || {})[id] && !!document.querySelector('#strategy-panel .cp-trigger'), id, 'panel ' + n);
  await page.waitForTimeout(500);
  return { id, card };
}
const triggers = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#strategy-panel .cp-trigger')].map(b => [b.dataset.cpId, b.querySelector('.pdrop-trigger-label').textContent.trim()])));
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await ctx.route('**/data/local/**', r => r.fulfill({ status: 404, body: '' })); await ctx.route('https://tqqq-quotes.dato-developer.workers.dev/**', r => r.abort());
  const page = await ctx.newPage(); const errors = [], consoleErrors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Live prices unavailable|net::ERR_FAILED/.test(m.text())) consoleErrors.push(m.text()); });   // the quotes worker is blocked on purpose in this check
  await page.goto('http://127.0.0.1:8766/index.html', { waitUntil: 'networkidle' });
  await until(page, () => { const c = document.getElementById('mainChart'); return c && c.width > 0; }, null, 'chart');
  const d = await page.evaluate(() => ({ first: daily[0].date, soxl0: daily[0].soxl, soxx0: daily[0].soxx, n: daily.length, soxl1994: daily.find(r => r.date === '1994-05-04').soxl, flat: daily[0].soxl === daily[2000].soxl, v: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => /\?v=/.test(s)).map(s => s.split('?v=')[1]).filter((x, i, a) => a.indexOf(x) === i) }));
  check('SOXL and SOXX reach the first day of the data and move there', d.first === '1953-01-02' && Math.abs(d.soxl0 - 5.7109) < 0.001 && Math.abs(d.soxx0 - 0.013993) < 0.00001 && !d.flat, JSON.stringify(d));
  const lib = await page.evaluate(() => { const e = n => STRATEGY_LIBRARY.find(x => x.n === n); const dflt = (n) => Object.fromEntries((new Function('return (' + CODE[n] + ')')()).params.filter(p => p.id).map(p => [p.id, p.default])); return { r45: e(45).rules, rep49: e(49).reported, rep53: e(53).reported, r53: e(53).rules, r47: e(47).rules, d49: dflt(49), d53: dflt(53), rep44: e(44).reported, r44: e(44).rules }; });
  check('buy-back card: sell line 3% below, five closes, buy-back 34% below', /Sell line: 3% below the median/.test(lib.r45) && /five closes in a row above it/.test(lib.r45) && /Buy-back line: 34% below/.test(lib.r45));
  check('buy-back + Monday defaults', lib.d49.exitPct === -3 && lib.d49.confirmDays === 5 && lib.d49.bbPct === -34 && lib.d49.bbSlice === 100, JSON.stringify([lib.d49.exitPct, lib.d49.confirmDays, lib.d49.bbPct, lib.d49.bbSlice]));
  check('Fit defaults', lib.d53.lookbackDays === 546 && lib.d53.startAvgDays === 60 && lib.d53.backLead === 28 && lib.d53.reentryLead === 35 && lib.d53.reentryCloses === 10 && lib.d53.deepLead === -30.5 && lib.d53.floorLead === 6, JSON.stringify([lib.d53.lookbackDays, lib.d53.startAvgDays, lib.d53.backLead, lib.d53.reentryLead, lib.d53.reentryCloses, lib.d53.deepLead, lib.d53.floorLead]));
  check('Fit card: rules and note carry the new numbers', /10 closes in a row at 35% ahead/.test(lib.r53) && /30\.5% behind/.test(lib.r53) && /Back to TQQQ at 28% ahead/.test(lib.r53) && /176\.0% a year/.test(lib.rep53) && /geometric mean/.test(lib.r53) && /geometric mean/.test(lib.r47));
  check('NFCI card: the 2007 date and the first-published note', /December 7, 2007/.test(lib.r44) && /first-published/.test(lib.rep44) && /114\.7% a year/.test(lib.rep49));
  // the first library page renders its cards with numbers
  await page.evaluate(() => toggleStrategyLibrary()); await until(page, () => document.querySelectorAll('.sl-card').length > 0, null, 'cards');
  const cards = await page.evaluate(() => [...document.querySelectorAll('.sl-card')].map(c => ({ name: c.querySelector('.sl-card-name').textContent.trim(), cagr: [...c.querySelectorAll('.sl-row-cagr td')].map(x => x.textContent.trim()), dd: [...c.querySelectorAll('.sl-row-dd td')].map(x => x.textContent.trim()) })));
  for (const c of cards) console.log('    card', c.name.padEnd(34), c.cagr.join('  '), '|', c.dd.join('  '));
  check('first page: eight cards', cards.length === 8, cards.length + ' cards');
  const four = []; for (const [n, q] of [[48, 'NFCI veto + Turnaround'], [49, 'Buy-back + Turnaround'], [50, 'TQQQ vs QQQ + Turnaround'], [53, '1983']]) { await page.fill('#sl-search', q); await until(page, n => !!document.querySelector('[data-sl-add="' + n + '"]'), n, 'card ' + n); await page.waitForTimeout(400); four.push(await page.evaluate(n => { const c = document.querySelector('[data-sl-add="' + n + '"]').closest('.sl-card'); return { n, name: c.querySelector('.sl-card-name').textContent.trim(), cagr: [...c.querySelectorAll('.sl-row-cagr td')].map(x => x.textContent.trim()), dd: [...c.querySelectorAll('.sl-row-dd td')].map(x => x.textContent.trim()) }; }, n)); }
  await page.fill('#sl-search', '');
  for (const c of four) console.log('    card', c.name.padEnd(34), c.cagr.join('  '), '|', c.dd.join('  '));
  check('the four cards show five CAGR cells that are numbers', four.every(c => c.cagr.length === 5 && c.cagr.every(x => /^[+−-]?\d/.test(x))));
  await page.evaluate(() => toggleStrategyLibrary());
  // Fit: add, open, read the settings and what it holds
  const fit = await addAndOpen(page, 53, '1983'); const t = await triggers(page);
  check('Fit panel shows the new settings', t.lookbackDays === '546' && t.startAvgDays === '60' && t.backLead === '28%' && t.reentryLead === '35%' && t.reentryCloses === '10' && t.deepLead === '-30.5%' && t.floorLead === '6%', JSON.stringify([t.lookbackDays, t.startAvgDays, t.backLead, t.reentryLead, t.reentryCloses, t.deepLead, t.floorLead]));
  const mfit = await page.evaluate(id => { const m = window._configMetrics[id], log = (window._customLogs || {})[id] || []; const last = log[log.length - 1] || {}; return { cagr: +m.cagr.toFixed(1), dd: +m.maxDD.toFixed(1), held: last.held, date: last.date }; }, fit.id);
  check('Fit runs on the chart and holds TQQQ on the latest day', mfit.cagr > 0 && mfit.held === 'TQQQ', JSON.stringify(mfit));
  // Buy-back + Monday and NFCI + Monday: add, open, settings, first row of the run
  const bb = await addAndOpen(page, 49, 'Buy-back'); const tb = await triggers(page);
  check('Buy-back + Monday panel shows -3%, 5, -34%', tb.exitPct === '-3%' && tb.confirmDays === '5' && tb.bbPct === '-34%', JSON.stringify([tb.exitPct, tb.confirmDays, tb.bbPct, tb.dipReentry]));
  const first49 = await page.evaluate(id => { const log = (window._customLogs || {})[id] || []; return log.length ? { date: log[0].date, action: log[0].action, held: log[0].held, note: String(log[0].note).slice(0, 90), rows: log.length } : null; }, bb.id);
  check('Buy-back + Monday: the first row is the entry with its carried-in state', first49 && first49.action === 'start' && /at the entry/.test(first49.note), JSON.stringify(first49));
  const nf = await addAndOpen(page, 48, 'NFCI'); const first48 = await page.evaluate(id => { const log = (window._customLogs || {})[id] || []; return log.length ? { date: log[0].date, action: log[0].action, held: log[0].held, note: String(log[0].note).slice(0, 90) } : null; }, nf.id);
  check('NFCI + Monday: the first row is the entry with its carried-in state', first48 && first48.action === 'start' && /at the entry/.test(first48.note), JSON.stringify(first48));
  check('asset version bumped to 532', d.v.length === 1 && d.v[0] === '532', JSON.stringify(d.v));
  check('no page errors, no console errors', errors.length === 0 && consoleErrors.length === 0, JSON.stringify(errors.concat(consoleErrors)).slice(0, 400));
  console.log(results.every(Boolean) ? `ALL ${results.length} CHECKS PASS` : `${results.filter(x => !x).length} of ${results.length} FAILED`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
