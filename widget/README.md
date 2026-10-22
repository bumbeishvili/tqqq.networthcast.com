# Desktop widget

A macOS desktop widget with three charts: your portfolio from your transaction
sheet across the top, and TQQQ intraday and the strategy's signal chart side by
side below it. It runs in
[Übersicht](https://tracesof.net/uebersicht/) and shows the site's
`widget.html`, so the charts are the site's own, interactions included. The
installer copies that page from this checkout into the widget's folder, and the
page reads the live site's market data.

## Install

1. Install Übersicht and open it once, so it creates its widgets folder:
   ```
   brew install --cask ubersicht
   ```
   If no widget appears, quit Übersicht and open it again.
2. From the repo root:
   ```
   ./widget/install.sh
   ```
3. Fill in `config.json` (below). The widget reads it again every 20 seconds.

## config.json

It lives at
`~/Library/Application Support/Übersicht/widgets/tqqq.widget/config.json`,
outside the repo, because it holds your sheet link. Never copy it into the repo.

| Key | Meaning |
|---|---|
| `sheetUrl` | Your transaction sheet's published CSV link (Google Sheets: File, Share, Publish to web, CSV). |
| `sheetColumns` | Header names of the sheet's `date`, `amount` and portfolio `value` columns. |
| `shareLink` | The site's Share link. It supplies your strategy and its settings. Without one, the widget runs the buy-back strategy at its defaults. |
| `intraday` | The intraday chart's settings: `similarDaysOnly`; `from`, the period's first day as `YYYY-MM-DD` (the period ends at the latest day); `log`, a log scale instead of the default linear one. |
| `pageUrl` | The page the widget shows. Default: the copy the installer puts in the widget's `lib/site` folder. Set `https://tqqq.networthcast.com/widget.html` to show the deployed page instead; on the desktop that page answers hover only (see Troubleshooting). |
| `dataUrl` | Where the page reads the market data files. Default: `https://tqqq.networthcast.com/`. |
| `width` | Widget width in pixels. |

## Using it

- The top chart plots your sheet's portfolio value, what you had put in by
  each date, and the profit between the two, on a linear scale. The axis
  reaches below zero when the profit does.
- The percent beside the portfolio's value, above its name, is its change
  over the latest session. Your sheet holds no positions, so the figure is the strategy's
  move over that session. It assumes your account holds what the strategy
  holds.
- The signal chart covers the whole price history in the site's data, back
  to 1953. It rests on your portfolio's dates; ⌘ + scroll out or ⌘ + drag to
  see earlier years, and Reset or a double-click brings you back. Its trades
  come from one run of the strategy over that whole history on the site's
  default $10,000.
- The signal chart leaves out the strategy's center line, the 250-day median
  at the buy-back defaults, and names its lines without their percent
  settings.
- Hover any chart for its readout.
- On the portfolio and signal charts, ⌘ + scroll zooms and ⌘ + drag pans. A plain drag
  measures the change over a range. While zoomed, Reset and Latest sit in the
  chart's bottom-right corner; a double-click also resets.
- The page re-reads your sheet and the market data every 5 minutes. The site's
  data files update about once an hour during market hours.

## Changing it

- Run `./widget/install.sh` after changing the page (`widget.html`, `js/`,
  `styles.css`, `experiments/tqqq-intraday.html`) or
  `widget/tqqq.widget/index.jsx`. It copies them into the widget, and
  Übersicht reloads it. Nothing needs to be pushed first.
- The widget's position is the `bottom` and `left` values in that file's
  `className`. Change them there, then run the installer.

## Troubleshooting

- **404 or a blank frame:** run `./widget/install.sh`; the page copy is
  missing. With `pageUrl` on the live site, the page isn't deployed yet. The
  widget retries every 20 seconds.
- **Errors naming `.js` files:** Übersicht loads every `.js` file in its
  widgets folder as a widget, except under `lib/`, `src/` or `node_modules/`.
  Keep the page copy in `lib/site`.
- **Hover works, but scrolls, clicks and drags land on the desktop:**
  Übersicht passes the mouse to a widget only after its own page sees the
  pointer over that widget. The widget page reports its pointer moves to
  Übersicht's page for that, and only the local copy can. Keep `pageUrl` at its
  default and run `./widget/install.sh`.
- **Nothing responds, not even hover:** in Übersicht's menu-bar menu, check
  that the widget isn't set to the background.
- **"Getting Started" panel:** Übersicht's sample widget. Hide it from the
  menu-bar menu.
