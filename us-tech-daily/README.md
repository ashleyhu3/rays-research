# us-tech-daily — 美股科技板块涨跌复盘 / 亚洲科技板块复盘

Two sector reviews a day, published to the site's **Report** page: **US Close**
(`--kind us`, the locked 92-name US tech universe × 12 sub-sectors + 3 indices + 3 Korea
anchors) and **Asia Close** (`--kind asia`, Taiwan/Korea/Japan/HK/China A-shares × 12
sub-sectors + 5 indices + 3 US mega-cap anchors — see `universe_asia.py`). Each produces a
single self-contained HTML report, plus Markdown and PDF exports.

```bash
./run.sh 2026-07-30            # US kind, today defaults to the ET session
./run.sh 2026-07-30 asia       # Asia kind, same date
open reports/2026-07-30_us_tech_daily.html
```

Set `MONGODB_URI` (see `../.env`) to run the whole pipeline against Mongo instead of local
files — see `store.py`. A scheduled run always does this and writes nothing to disk; the
`.claude/skills/us-tech-daily/SKILL.md` skill drives it end to end, including authoring the
narrative, and is what the two daily scheduled agents (07:00 / 18:00 HKT) invoke.

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
| `kinds.py` | Registry mapping `--kind` (`us` \| `asia`) → universe module, timezone, news sources |
| `universe.py` | US: the 92-name lock, 12 sub-sectors, indices, Korea anchors, thresholds |
| `universe_asia.py` | Asia: same shape, Taiwan/Korea/Japan/HK/China A-share universe |
| `store.py` | Dual-mode read/write for every doc below — local files, or Mongo when `MONGODB_URI` is set |
| `session.py` | Resolves each scheduled slot to a session date; freshness (see "Dead slots" below) |
| `pull_global_eod.py` | yfinance EOD pull → `eod` doc |
| `aggregate.py` | Sector means, up/down, highlight/extreme flags → `agg` doc |
| `aggregate_span.py` | Compounds N sessions into one tape → `agg_{START}_{END}` (US kind, file mode only) |
| `pull_news.py` | RSS scrape + per-ticker matching → `news` doc |
| `render_report.py` | `agg` + `narrative` → report HTML (pure `render()`, callable in-process too) |
| `export_report.py` | Same inputs → `.md`; the HTML → PDF bytes via Playwright (`export_pdf()`, no temp file) |
| `lint_narrative.py` | Checks every hand-written figure against the tape, across every kind/date on record |
| `publish.py` | Renders + writes the report/PDF/history-index docs to Mongo; `--backfill` imports old files |
| `narrative/_template.json` | Blank schema with the authoring rules |
| `run.sh` | Chains EOD → aggregate → news → lint → render → export for one kind; stops at the first failure |
| `vendor/news_fetcher.py` | Vendored copy of `emailai/PDF_summarizer/ingest/news_fetcher.py` (see below) |
| `.claude/skills/us-tech-daily/SKILL.md` | Drives a full run including narrative authoring; what the schedule calls |

## Reused from this repo

- **News scraping** uses `vendor/news_fetcher.py`, a vendored copy of
  `emailai/PDF_summarizer/ingest/news_fetcher.py` (that directory is gitignored, so the
  pipeline can't depend on it directly) — its RSS parsing, article-body extraction, finance
  triage and dedupe are already tuned. Nothing is written to a database; headlines go
  straight into the `news` doc. US feeds: CNBC, MarketWatch, WSJ Markets, Yahoo Finance,
  NYTimes Business, FT Markets. Asia feeds (see `kinds.ASIA_NEWS_SOURCES`): Nikkei Asia,
  SCMP Business, Korea Herald, Yonhap, DigiTimes Asia, Reuters Asia Markets, Taipei Times,
  CNA Business.
- **Price sourcing** follows the pattern in `server/scrapers/globalIndices.js` (Yahoo
  history, bounded concurrency, retry on rate limits), reimplemented in Python so the
  pipeline is one language end to end.
- **Alpha Vantage** (`ALPHA_VANTAGE_API_KEY` in the repo `.env`) is the bad-bar repair
  path (US kind only), matching the fallback role it plays in
  `server/alphaVantageEarningsDates.js`.
- **Mongo storage** (`store.py`) matches `server/storage.js`'s wire format exactly —
  gzip-json for compressed docs, `{_id,data}` for plain blobs — so the Node server reads
  what this pipeline writes with no translation layer. See `server/server.js`'s
  `/api/reports/*` routes.

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

## Dead slots (no weekend format)

There is no separate weekend report anymore. Each kind's schedule fires 7 days a week
(US Close 07:00 HKT, Asia Close 18:00 HKT) — but on a US holiday, a weekend `us-close` run,
or a Saturday/Sunday `asia-close` run, nothing new has actually traded. `session.py`
resolves this by asking the tape, not a calendar: it probes the kind's primary index for
the newest bar and compares it against the session the *previous* report in that exact
(kind, slot) used. No new bar → `is_fresh=False`, and the run:

- **skips** the EOD pull and aggregate step entirely — the prior session's `agg` doc is
  reused as-is (pass it to `render_report.py` / `export_report.py` / `lint_narrative.py`
  via `--session-date`, distinct from `--date`, the report's own publish date)
- **still** pulls fresh news and writes a new narrative — new prose, reused prices
- renders with an automatic "价格沿用 {reused session}" banner (`render_report.render()`'s
  `meta` parameter) so the reused tape is never presented as if it just happened

This is what `session.py --kind <k> --slot <s>` is for; the skill calls it first, every
run. See the skill's docstring for the exact command sequence including `--session-date`.

### Multi-session spans — `*_us_tech_daily` over a span

Where the week actually ended up, compounded across the last two sessions:

```bash
python aggregate_span.py --dates 2026-07-30 2026-07-31
python lint_narrative.py --date 2026-07-30_2026-07-31
python render_report.py   --date 2026-07-30_2026-07-31
python export_report.py   --date 2026-07-30_2026-07-31
```

`aggregate_span.py` builds a synthetic tape and hands it to the same `aggregate.build()`
the daily run uses, so sector means, flags, direction arrows and the Korea trigger are
computed by identical code. On the span tape:

- `pct` is **compounded**, `(1+r₁)(1+r₂)−1` — never summed
- `dollar_volume_b` is summed across the window
- `close` and `dist_52w_high_pct` are the last session's; point-in-time, never compounded
- a name missing a price in *any* session is dropped, so a compounded return can never
  silently describe a shorter window than the report claims

**Thresholds are deliberately not rescaled.** `|pct|>5%` over two sessions is a much
weaker statement than over one — 71 of 92 names cleared it over 7/30–7/31 against 14 on
7/31 alone. Section 7 says so in words rather than quietly moving the number, so the same
metric never means two different things across reports.

## Adding a session

`run.sh` stops before rendering if `narrative/{DATE}.json` is missing, having already
produced the price, aggregate and news JSON. Read `data/news_{DATE}.json`, top up thin
movers with a web search, copy a prior day's narrative file as the schema, and re-run.
Movers with no in-window evidence must be labelled beta — never invent a catalyst.
