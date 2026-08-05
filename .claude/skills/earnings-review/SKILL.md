---
name: earnings-review
description: >
  Post-earnings review / earnings summary skill. Triggers: earnings review, earnings
  summary, post-earnings review, "process this earnings report", 处理财报, 财报复盘.
  Builds a buy-side-style Chinese-language earnings review markdown from an earnings
  release, presentation slides (optional), and earnings call transcript.
---

# Earnings Review Skill

## Overview

Given earnings materials for a company (release, slides, transcript — local files or
found via web search), produce a buy-side-desk-style post-earnings review in Markdown,
in Chinese with English technical terms in parentheses.

Default paths: `PROJECT_ROOT` = current working directory. `RESEARCH_ROOT` =
`$PROJECT_ROOT/research`. `OUTPUT_ROOT` = `$PROJECT_ROOT/Output`.

Only create/append to derivative research/output artifacts under `research/{Ticker}/`.
Never move, rename, or delete original source materials.

## Input discovery

**Before asking the user for materials, scan `research/{Ticker}/` first.**

| Search path | Content | Glob |
|---|---|---|
| `research/{Ticker}/` root | Earnings release PDF/Excel, slides | `research/{Ticker}/*.{pdf,xlsx,xls,docx,md,htm,html}` |
| `research/{Ticker}/ER_File/` | Filed release / slides | `research/{Ticker}/ER_File/*` |
| `research/{Ticker}/ER+Conf/` or `ER+NDR/` | Filed transcript | `research/{Ticker}/ER+Conf/*` |
| `research/{Ticker}/SEC/8-K/` | Recent 8-K (contains release as Exhibit 99.1) | newest by date |
| `research/{Ticker}/SEC/10-Q/` or `10-K/` | Quarterly/annual financials | newest by date |

**The transcript is usually already staged for you.** When this skill is invoked from the
dashboard (the `earnings-review.yml` workflow, or `npm run earnings-review:prep` locally),
`server/scripts/prepareEarningsInputs.js` has already written the verbatim transcript to
`research/{Ticker}/ER+Conf/{TICKER}_{year}Q{q}_earnings_call_transcript.md` — sourced from
Alpha Vantage's `EARNINGS_CALL_TRANSCRIPT` endpoint, or from a transcript the user pasted
into the site. Read that file; do not re-fetch or web-search for a transcript when it
exists. An `ER_File/` that exists but is empty means only the transcript was staged and
the release is still yours to source.

If nothing local exists, search the web for the company's official investor-relations
earnings release, presentation, and call transcript for the requested fiscal period.
Prefer the company's own IR site and SEC filings (8-K/10-Q/10-K) over third-party
recaps. Save what you fetch into `research/{Ticker}/ER_File/` and
`research/{Ticker}/ER+Conf/` as markdown/text so re-runs don't refetch.

### File classification

| Keyword | Category → subfolder |
|---|---|
| transcript, call, conf, earnings call | `ER+Conf/` |
| release, press, presentation, slides, supplement, 8-k, 8k, exhibit | `ER_File/` |

PDF → convert to Markdown (pymupdf4llm or equivalent) and cache under the relevant
subfolder. HTML (SEC filings) → read directly, no conversion needed. Excel → parse
with pandas and extract the relevant tables.

## Multi-source data

**Priority: local filing/release → this repo's own data infra → public web search,
in that order.** This repo has no Bloomberg Terminal or Unusual Whales subscription —
do not invent `blp.sh`/`uw.sh` calls. It does have several real, live data sources
already wired up under `server/` that cover most of what those would have provided.
Check these before falling back to WebSearch/WebFetch, and always footnote which
source a number came from.

1. **Core financials** (Revenue/OI/NI/EPS/FCF/CapEx, segment data): from the earnings
   release / 8-K primarily. Backfill trailing-quarter trend data from FMP
   (`FMP_API_KEY` in `.env`): `https://financialmodelingprep.com/stable/income-statement
   ?symbol={TICKER}&period=quarter&limit=8&apikey=$FMP_API_KEY` (also
   `cash-flow-statement`, `balance-sheet-statement` with the same shape). Confirmed
   working and accurate (MSFT FY26Q4 revenue matched the filing to the dollar).
   `quote?symbol={TICKER}` gives a live price snapshot too. `analyst-estimates` is
   restricted on our plan — don't rely on it.
2. **Valuation / ratings / analyst-target snapshot (Bloomberg-equivalent) — use Yahoo
   Finance, don't mark N/A**: `yahoo-finance2` is already a repo dependency (see
   `api/options.js` for the client-setup pattern: real browser User-Agent header to
   avoid the 429/crumb throttle). Call `quoteSummary(ticker, { modules: ['price',
   'summaryDetail', 'defaultKeyStatistics', 'financialData', 'recommendationTrend'] })`
   for a free, live substitute for most of Bloomberg's `BEST_*`/`PE_RATIO` fields:
   - `price.regularMarketPrice` / `regularMarketChangePercent` / `marketCap` ↔
     `PX_LAST` / `CHG_PCT_1D` / `CUR_MKT_CAP`
   - `summaryDetail.trailingPE` / `forwardPE` / `dividendYield` ↔ `PE_RATIO` /
     `BEST_PE_RATIO` / `BEST_DIV_YLD` (forward PE here is Yahoo's own derived figure,
     not identical methodology to Bloomberg's BEST consensus, but a reasonable
     substitute — note it as "Yahoo forward P/E" rather than implying it's Bloomberg's)
   - `financialData.targetMeanPrice` / `targetMedianPrice` / `recommendationMean` /
     `recommendationKey` / `returnOnEquity` ↔ `BEST_TARGET_PRICE` /
     `BEST_TARGET_MEDIAN` / `BEST_ANALYST_RATING` / `BEST_ROE`
   - `recommendationTrend.trend[0]` (`{strongBuy, buy, hold, sell, strongSell}`) ↔
     `TOT_BUY_REC` / `TOT_HOLD_REC` / `TOT_SELL_REC` — sum strongBuy+buy for the buy
     bucket, strongSell+sell for the sell bucket.
   Confirmed live and working (tested MSFT: trailingPE 27.2, forwardPE 20.8, target
   mean $563, recommendationKey "strong_buy", 14 strong-buy/40 buy/3 hold/0 sell).
3. **Consensus EPS/Revenue estimate + segment-level beat/miss**: this is the one
   category Yahoo's free `quoteSummary` doesn't reliably give you (it has
   `epsTrend`/`epsRevisions` in `defaultKeyStatistics`/`earningsTrend` modules —
   check those first, they sometimes carry a usable next-quarter consensus EPS/
   revenue figure). If neither that nor FMP's gated `analyst-estimates` gives a
   number, web search for "[Company] Q[X] [Year] earnings consensus estimate revenue
   EPS beat miss" as the last resort. If no reliable number is found, mark the cell
   "N/A" rather than guessing.
4. **Options positioning (Bloomberg-equivalent) — use this repo's live options chain,
   don't mark it N/A**: `server/scrapers/options.js` exports `getOptionsData(ticker,
   dateStr)`, backed by the Massive.com API (`MASSIVE_API_KEY`). It returns the live
   spot price + change vs. prior close, and the full calls/puts chain (strike,
   OI, volume, IV, greeks) for a chosen expiration. From this you can compute, for
   real, per-ticker:
   - **Price reaction**: `price`, `priceChange`, `changePct` — this is the live
     substitute for Bloomberg's `PX_LAST`/`CHG_PCT_1D`.
   - **P/C OI ratio** and **P/C volume ratio**: sum `openInterest`/`volume` across
     `calls` vs `puts` for an expiration and divide put-side by call-side.
   - **ATM IV**: find the strike closest to spot, read its `impliedVolatility`.
     Repeat across 2-3 near-term expirations (loop `d.expirations`) to build a rough
     IV term-structure in place of Bloomberg's `IVOL_SURFACE_ATM_30D/60D/90D`.
   - **Max pain / key OI strikes**: the strike(s) with the largest OI on each side.
   If a chain comes back with OI: 0 across the board, that's an intraday snapshot taken
   before OI settles — re-fetch after settlement, or fall back to the last nonzero
   snapshot in the Mongo `optionsOI` blob, and say which one you used.
   What this does **not** give you: Bloomberg's standardized `ACTUAL_Q_EPS_SURPRISE`,
   analyst consensus, or Unusual Whales-style flow signals (sweep detection,
   ask-side aggressor, opening-vs-closing trades) — those need tick-level trade data
   this repo doesn't have. Leave those specific sub-fields N/A; don't approximate
   sweep/flow direction from a static OI/volume snapshot.
   `DEFAULT_TICKERS` in `server/scripts/generateDailyOptionsReport.js` already
   includes MSFT and GOOG, so both are already in the repo's regular options-tracking
   rotation — check `server/data/` / the Mongo `optionsOI`/`optionsPriorYearVolume`
   blobs for a cached same-day chain before hitting Massive fresh.
5. **Price action** (headline "shares moved ±X%" for the report's top blockquote):
   covered by the same `getOptionsData()` call above (spot + prior close). If you
   need after-hours-specific pricing separate from the options snapshot, FMP's
   `aftermarket-quote?symbol={TICKER}` is the fallback; only go to web search for the
   qualitative "why" behind a move.

## Workflow

### Step 0: Local file discovery + PDF pre-processing

0.1 Confirm company name / ticker with the user if ambiguous.
0.2 Glob-scan all local paths above in parallel before fetching anything externally.
0.3 Classify files by keyword (see table above); ask the user only if classification
    is ambiguous and unresolved.
0.4 Create `research/{Ticker}/ER_File/` and `research/{Ticker}/ER+Conf/` if missing;
    convert any un-converted PDFs into them.
0.5 Read: PDF → converted markdown; HTML → Read tool directly; Excel → pandas.

### Step 0.6: Gather multi-source data (parallel)

Fetch consensus/estimates, historical trend backfill, and price-action data
concurrently where possible. Cross-check any headline surprise % against the
release's own numbers; if sources disagree, trust the filing and footnote the
discrepancy.

### Step 1: Extract core financials

From the release: Revenue, Gross Margin, Operating Income, Net Income, EPS
(GAAP & non-GAAP), FCF, CapEx, segment revenue/OI, and guidance (next quarter + FY).
Backfill 3 trailing quarters into the trend table from the release's own comparative
tables / YTD math where possible; mark "—" where truly unavailable.

### Step 2: Parse the transcript

Read `references/transcript-coverage-gate.md` in full before starting, and keep a
coverage ledger (see that file) so no prepared-remarks speaker segment and no Q&A
exchange gets silently dropped.

- **Prepared remarks**: organize by speaker (CEO/CFO/other), grouped under `####`
  subheadings by theme. Preserve material claims, numbers, hedges, and causal
  mechanisms in full — do not summarize away qualifiers like "selectively",
  "early innings", "not yet".
- **Q&A**: cover every question asked, in order. For each: who asked (name + firm),
  question gist, management's answer gist — mechanism, hedges, and any part left
  unanswered. Q&A is a factual record only — no buy-side interpretation here (that
  belongs in the "trading signals" chapter).

### Step 3: Fill the template

Use `references/output-template.md`. Populate every section; omit sections that
truly don't apply (e.g., no CapEx-heavy debate this quarter) rather than leaving
placeholders.

### Step 4: Output

Write exactly one file, at exactly this path — the publisher in step 5 looks for it there:

```
research/{Ticker}/Earnings_Review/{Ticker}_FY{year}Q{q}_EarningReview.md
```

e.g. `research/GOOG/Earnings_Review/GOOG_FY2026Q2_EarningReview.md`. `{Ticker}` is the
directory key used for the inputs (a plain ticker — `GOOG`, `MSFT`), even when the filings
themselves are named for a different share class.

### Step 5: Publish

When `MONGODB_URI` is set, publish the review to the dashboard:

```
node --env-file-if-exists=.env server/scripts/publishEarningsReview.js \
  --ticker {TICKER} --quarter Q{q} --year {year}
```

This renders the markdown to HTML + PDF and writes the `earningsReview:*` blobs the site
reads. It is an idempotent upsert, so re-running it is safe. Skip this step when
`MONGODB_URI` is unset — there is nothing to publish to, and the markdown on disk is then
the whole deliverable.

## Key conventions

1. **Language**: Chinese prose; keep standard finance terms in English in parens on
   first use, e.g. 经常性收入(recurring revenue)、自由现金流(FCF)、每股收益(EPS)。
2. **Currency**: whatever the filing reports in — do not convert.
3. **Percentages**: one decimal place.
4. **Management commentary**: group by speaker, `####` per theme, preserve hedges and
   mechanism — don't collapse into a single boosterish sentence, and don't mix in
   Q&A or buy-side judgment.
5. **Q&A**: cover every exchange, attribute analyst + firm, stay factual.
6. **Guidance**: report as the range management gave; don't invent a midpoint unless
   management gave one.
7. **Non-GAAP adjustments**: call out what's being added back/excluded and flag
   anything unusual.
8. **Segment color**: drivers behind each segment line (volume vs. price, mix shift).
9. **Beat/Miss verdict**: state Beat-and-Raise / In-line / Miss / Mixed at the top.
10. **Length**: don't compress management commentary or Q&A for brevity — completeness
    over concision there; keep other chapters tight.
11. **Structure**: `##` = major chapter, `###` = subsection (segment name / speaker),
    `####` = theme grouping under a speaker. Tables get a 1-2 sentence `>` blockquote
    takeaway underneath, not paragraphs of prose.
12. **Material customer/partner concentration**: if the company's numbers are
    materially driven by one counterparty (a la MSFT-OpenAI, NVDA-hyperscaler
    concentration), give it its own paragraph in the operating-metrics chapter,
    quantifying underlying-vs-headline growth deltas.
13. **High-signal management framing**: when management invokes a book/historical
    analogy or gives an explicit strategic framework, preserve it verbatim (with
    translation) everywhere it recurs — prepared remarks, Q&A, and the trading-signals
    chapter — but keep buy-side judgment confined to the trading-signals chapter only.

## Deep-dive modules (mirror in the corresponding chapter)

1. **EPS bridge** (chapter 1, right after the headline table) — when one-time items
   materially separate GAAP from adjusted EPS, show the walk: GAAP EPS → adjustments
   → Adj. EPS → vs. consensus → beat %.
2. **Revenue driver decomposition** (chapter 2, primary segment) — volume × price
   trend table, 5 quarters, plus a monetization-improvement table translating specific
   product initiatives into revenue impact.
3. **Margin trend** (chapter 2) — 5-quarter segment OPM trend + driver commentary
   (opex growth vs. revenue growth, mix shift, scale).
4. **Operating-metric deep dive** (chapter 3) — industry-appropriate: SaaS → NRR/RPO;
   platform → ARPU/engagement gap; hardware → backlog days vs. cycle position.
5. **CapEx / investment cycle** (chapter 4, near guidance) — Base/High FCF scenario
   table when CapEx is the market's focal point.
6. **Call key-signal callouts** (chapter 7 opener) — 2-4 signals from the call, each
   with quote, plain-English translation of stakes, and tie-back to the numbers;
   distinguish management's own framing from your own inference.
7. **Valuation bull/bear framework** (chapter 7) — reasons to pay up / reasons to
   discount / one-paragraph verdict / key confirming datapoint to watch next quarter.
8. **Options positioning** (chapter 7) — pull real price reaction, P/C OI/volume
   ratio, ATM IV, and key OI strikes from `getOptionsData()` per the Multi-source
   data section above. Leave only the flow/sweep-specific sub-fields (no tick data
   available) marked N/A — don't blend a real positioning snapshot with an invented
   flow narrative.

## Industry-specific operating metrics

| Industry | Key metrics |
|---|---|
| SaaS | ARR, NRR, RPO, customer count, DBNRR |
| Semis | shipment volume, ASP, utilization, days of inventory, product-cycle transition effects |
| Internet/platform | MAU/DAU, ARPU, GMV, take rate, ad revenue |
| Power/energy | installed capacity, utilization hours, spot price, projects under construction |
| Industrials | book-to-bill, backlog, capacity utilization |

For hardware companies specifically: when management describes a product-mix shift
(new node ramp, packaging transition), explain the mechanism to the financial line
(e.g. "HBM capacity ramp → BOM cost up → GM pressure"), not just restate management's
words.

## Batch invocation notes

When called across multiple periods for the same ticker (e.g. building an 8-quarter
history): one fiscal period per sub-task, run sub-tasks in parallel, never skip
prepared remarks or Q&A to save time, and do a completeness check per output (every
required chapter present, coverage ledger fully checked off) before considering a
period done.
