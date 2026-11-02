# Local-only data and strategies

The series in this folder are ignored by git: they are never committed,
deployed or touched by the daily data updater. Only this README and
`fetch.cjs` are tracked. The folder holds extra series for trying strategies on
a local copy of the site.

- `fetch.cjs` downloads 18 series from Yahoo, each from its first trading day:
  VIX, VVIX, GLD, SLV, IWM, TLT, BTAL, HYG, MTUM, XLF, XLK, XLE, SPMO, UVXY,
  SOXL, TECL, UGL and BIL. Funds are adjusted for dividends and splits. It writes
  one `<key>.tsv` per series plus `index.json`. Rerun it to refresh:
  `node data/local/fetch.cjs`
- When `index.json` exists, the site (js/data.js `loadLocalSeries`) loads the
  series and hands them to custom strategies as `data.gld`, `data.vix` and so
  on. Before a series starts its values are NaN. A day the series skipped
  repeats its last close.
- The Strategy Library's ALLWEATHER V15 (entry 51) reads these series. With
  the folder loaded its card has a Try button; on the live site, which has no
  folder, the card says it needs local data. Set Entry to 2016 or later: SPMO
  starts in October 2015, and until every signal has data it holds cash.
