# us-tech-daily — 美股科技板块涨跌复盘

Daily US tech sector review over a locked universe of **92 names × 12 sub-sectors**, plus
3 indices and 3 Korea anchors. Produces a single self-contained HTML report.

```bash
./run.sh 2026-07-30        # or ./run.sh for today's ET session
open reports/2026-07-30_us_tech_daily.html
```

Each run produces the report in three formats, all off the same inputs:

| Format | Use |
| --- | --- |
| `.html` | The canonical layout — read in a browser |
| `.md` | Diffable, and the natural format to hand-edit prose in (`==highlight==`) |
| `.pdf` | A4 print, ~21pp, table headers repeat and rows never split across pages |

## Design

The pipeline deliberately splits into a **computed half** and a **written half**.

Everything numeric — closes, percentages, dollar volume, distance to the 52-week high,
sector equal-weight means, highlight/extreme counts — is derived from the tape and
rendered straight from JSON. Nothing in a table is ever retyped by hand. The prose in
sections 1, 4, 5, 6 and 7 is written against the scraped news evidence and stored
separately in `narrative/{DATE}.json`. The renderer joins the two. This is what keeps the
write-up from drifting: every figure quoted in a sentence is one the reader can check
against the table directly above it.

## Files

| File | Role |
| --- | --- |
| `universe.py` | The 92-name lock, 12 sub-sectors, indices, Korea anchors, thresholds |
| `pull_global_eod.py` | yfinance EOD pull → `data/eod_{DATE}.json` |
| `aggregate.py` | Sector means, up/down, highlight/extreme flags → `data/agg_{DATE}.json` |
| `pull_news.py` | RSS scrape + per-ticker matching → `data/news_{DATE}.json` |
| `render_report.py` | `agg` + `narrative` → `reports/{DATE}_us_tech_daily.html` |
| `export_report.py` | Same inputs → `.md`; the HTML → `.pdf` via Playwright |
| `lint_narrative.py` | Checks every hand-written figure against the tape |
| `narrative/_template.json` | Blank schema with the authoring rules |
| `run.sh` | Chains all five; stops at the first failure |

## Reused from this repo

- **News scraping** imports `emailai/PDF_summarizer/ingest/news_fetcher.py` directly —
  its RSS parsing, article-body extraction, finance triage and dedupe are already tuned.
  Unlike emailai, nothing is written to a database; headlines go straight to JSON.
  Feeds: CNBC, MarketWatch, WSJ Markets, Yahoo Finance, NYTimes Business, FT Markets.
- **Price sourcing** follows the pattern in `server/scrapers/globalIndices.js` (Yahoo
  history, bounded concurrency, retry on rate limits), reimplemented in Python so the
  pipeline is one language end to end.
- **Alpha Vantage** (`ALPHA_VANTAGE_API_KEY` in the repo `.env`) is the bad-bar repair
  path, matching the fallback role it plays in `server/alphaVantageEarningsDates.js`.

## Data integrity

Two guards, both of which have already caught real problems:

**Fill rate.** The run aborts below 95% resolution rather than writing a partial tape.

**OHLC coherence.** Every bar is checked for `low ≤ close ≤ high`. Yahoo does serve daily
bars that fail this. On 2026-07-30, QBTS came back with a close of 16.21 against a session
low of 16.71 — the true close was 17.98. That single bad bar moved the 92-name
equal-weight average by 12bp and its sub-sector average by 364bp. Failing bars are
repaired from Alpha Vantage and the substitution is recorded in the report's section 7.

And one guard on the written half:

**Narrative lint.** `lint_narrative.py` walks every `TICKER ±x.xx%` in the narrative and
matches it against the tape. A figure that matches a *different* session is reported as a
cross-day reference — these reports routinely cite the next day to separate "it fell" from
"it was news" — but a figure matching no session at all fails the run. `run.sh` calls it
before rendering.

## Conventions

- Sector means are **equal-weight**, never cap-weight.
- 前沿科技/流动性敏感 and 中概 AI mega roll up separately.
- Korea anchors are pulled and displayed but **never** enter the 92-name average.
- 高亮 = `|pct| > 2.5%`; 极端 = `|pct| > 5%`.
- Direction reads ↑↓ only when the minority side is ≥ 1/3 of the sector — a lone decliner
  among 20 names is beta noise, not a split.
- The Korea sub-layer in section 1 is mandatory when SK Hynix moves more than 3%.
- The news window closes at the next ET open, so post-close earnings land in the session
  the market actually traded them on.

## Adding a session

`run.sh` stops before rendering if `narrative/{DATE}.json` is missing, having already
produced the price, aggregate and news JSON. Read `data/news_{DATE}.json`, top up thin
movers with a web search, copy a prior day's narrative file as the schema, and re-run.
Movers with no in-window evidence must be labelled beta — never invent a catalyst.
