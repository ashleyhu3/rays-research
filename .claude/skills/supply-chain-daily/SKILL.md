---
name: supply-chain-daily
description: "Generate and publish one Global AI Hardware Supply Chain report (US Close or Asia Close) to the site. Runs the us-tech-daily/ pipeline end to end against the `chain` kind — 251 names across US/HK/A-share/Japan/Korea cut by supply-chain segment, twelve cross-market indices, a Taiwan anchor layer — pulls prices and news, authors the narrative half, lints every figure against the tape, renders HTML/Markdown/PDF, and publishes to Mongo. Trigger: /supply-chain-daily us-close or /supply-chain-daily asia-close."
---

# /supply-chain-daily

Drives `us-tech-daily/` end to end for one **supply-chain** report (`--kind chain`) and
publishes it to the site. Same pipeline, same scripts, different universe: this is the
only step that needs judgment — everything else (prices, aggregation, linting, rendering,
export) is deterministic code this skill calls, never reimplements.

This skill is a sibling of `/us-tech-daily`, not a replacement. That skill and its two
kinds (`us`, `asia`) are unchanged; do not edit them from here.

## What makes this kind different

`us-tech-daily` cuts by venue — one report per market. This one cuts by **supply-chain
segment**, so a single §3 subsection holds the HK line, the A-share line, the Japan line
and the US line of the same tier. That is the entire point: `PCB 产业链` tells you whether
the CCL/drill/copper-foil complex moved *as a complex* across six venues, which no
single-venue report can show. Four consequences you have to write around:

1. **Half the universe is always stale.** At the `asia-close` slot the US names carry
   their previous US close; at `us-close` the Asian names carry theirs. `pull_global_eod.py`
   lists them under `stale bars` and this is correct, expected output — not a failure.
   **Never describe a stale line as if it just traded.** Say "上一交易日收盘" or attribute
   the move to the session it actually happened in.
2. **Six currencies.** `收盘` is in the listing currency (¥, HK$, ¥, ₩, NT$, US$) — that
   is what a local quote means and it is not converted. `成交额(B$)` **is** converted to
   USD via `universe_chain.fx_pair()`. Never compare two `收盘` figures across venues as
   if they were the same unit; do compare turnover freely, that is what it is for.
3. **Dual listings are deliberate.** 立讯精密 is both `2475.HK` and `002475.SZ`; 圣邦股份,
   兆易创新, 澜起科技, 豪威集团, 华勤技术, 三环集团, 沃尔核材, 鼎泰高科, 广合科技, 胜宏科技
   and 生益 each appear twice. When the two lines diverge, that spread **is** a story
   (southbound flow, AH premium, index events). When they move together, quote one, not both.
4. **The anchor layer is Taiwan.** `ANCHOR_LABEL` is `台股锚` and the anchors are
   `2330.TW` / `2317.TW` / `3711.TW` — the locked list reaches Taiwan only through the
   `TSM` and `ASX` ADRs, so the Taiwan lines sit outside the equal-weight and carry the
   §1 sub-layer. The trigger is TSMC ±3%.

## Usage

```
/supply-chain-daily us-close      # kind=chain, slot=us-close    (fires ~07:00 HKT)
/supply-chain-daily asia-close    # kind=chain, slot=asia-close  (fires ~18:00 HKT)
```

Run from the repo root. Requires `MONGODB_URI` in the environment (set via `.env` locally,
or as a GitHub Actions secret in the scheduled workflows — see
`.github/workflows/supply-chain-daily-*.yml`) — every step below writes through
`us-tech-daily/store.py`, which is Mongo-mode with `MONGODB_URI` set and leaves **no files
on disk**. `ALPHA_VANTAGE_API_KEY` is optional (backs the EOD bad-bar repair path only,
and only for US symbols).

**First, `cd us-tech-daily`** — every command below assumes that as the working directory.

**Python interpreter**: use `analysis/.venv/bin/python` (relative to the repo root, i.e.
`../analysis/.venv/bin/python` from inside `us-tech-daily/`) if that path exists — this
repo's local convention. If it doesn't exist (e.g. the GitHub Actions runner, which has no
such venv), use plain `python` on `PATH` instead, after `pip install -r requirements.txt`.
Resolve this once at the start and call it `$PY` for the rest of these steps.

## Steps

### 1. Resolve the session

```
$PY session.py --kind chain --slot <slot>
```

Read `publish_date`, `session_date`, `is_fresh`, `reused_from` from the output.

The freshness probe is **per slot** for this kind (`universe_chain.SLOT_PROBE`): `^NDX` for
`us-close`, `^HSI` for `asia-close`. That is what lets one kind publish in both windows —
asking the Hang Seng whether the US session printed would call every us-close run stale.

- `is_fresh=True`: `session_date == publish_date`. Ordinary case.
- `is_fresh=False`: nothing has traded in that slot's probe market since the last report in
  this exact slot (a holiday, or a weekend firing). The tape is `reused_from` a prior
  session; only the narrative is new. **Not an error.** Carry `publish_date` and
  `session_date` through every command below exactly as printed.

### 2. Get the tape

If `is_fresh`:
```
$PY pull_global_eod.py --date <session_date> --kind chain
$PY aggregate.py --date <session_date> --kind chain
```

Expect roughly **265/266 resolved (~99.5%)**. Read the three diagnostic lines it prints:

- `fx to USD` — five pairs (CNY, HKD, JPY, KRW, TWD). If one is missing, that venue's
  turnover stayed in its listing currency and every `成交额` figure for it is wrong by
  orders of magnitude. Stop and say so rather than publishing it.
- `stale bars` — the other hemisphere, per point 1 above. Normal. Scan it anyway: a name
  from the *fresh* side appearing here is a genuine halt or suspension worth a §4 line.
- `failed` — a handful is tolerated by design. `0501.HK` (豪威集团 HK line) is a recent
  listing with too little history for a prev_close and has been failing since this kind
  was set up; it should start resolving on its own.

`pull_global_eod.py` aborts (exit 1) below a 95% fill rate rather than write a partial
tape — if that happens, stop and report it; do not retry with `--allow-low-fill` until
you have checked why so many symbols failed (a real Yahoo outage vs. a handful of
delisted/renamed tickers).

If **not** `is_fresh`, skip this step entirely — do not re-pull or re-aggregate.

### 3. Pull news

Always run this step, fresh or not:
```
$PY pull_news.py --date <publish_date> --kind chain --max-articles 160 --per-source-limit 12
```
The higher `--max-articles` is deliberate: this kind reads 30 sources against the default's
handful, and the default 120 truncates the tail — which is where the vernacular Taiwan and
Korea feeds sit. Keyed by `publish_date`, not `session_date`.

### 4. Read the evidence

Read the news doc and the agg doc before writing anything:
- `data/news_chain_{publish_date}.json` (file mode) or the `usTechNews:chain:{publish_date}`
  doc — `by_ticker` is the evidence list per mover; `articles` is everything pulled.
- `data/agg_chain_{session_date}.json` / `usTechAgg:chain:{session_date}` — sector means,
  mover list, highlight/extreme flags, the anchor-layer trigger.

In Mongo mode there is no file to read; use a one-liner, e.g.
`python -c "import store,json; print(json.dumps(store.read_json('agg','chain','2026-08-04')))"`.

**On the news sources** (`kinds.CHAIN_NEWS_SOURCES`, 30 feeds in three tiers):

- *Wires and exchanges* — SCMP, DigiTimes, CNA, Korea Herald, Yonhap, Korea Economic Daily,
  Business Korea, Korea Times, Japan Times, Straits Times, CNBC Asia, Bloomberg, FT
  Asia-Pacific, Seeking Alpha, EE Times, Tom's Hardware. Treat as fact.
- *Vernacular Taiwan/China* — CNYES (鉅亨網), UDN Money (經濟日報). These break
  supply-chain orders days before the English wires and are often the only source for a
  PCB/MLCC/OSAT move. Quote the Chinese headline and translate the claim.
- *Independent research* — SemiAnalysis, Citrini Research, FundaAI, Gaetano (Crux
  Capital), MacroCharts, Cassandra Unchained (Michael Burry), Doomberg. **These are
  opinion, not tape.** Attribute by name in the narrative ("SemiAnalysis 认为…"), never
  state a newsletter thesis as fact, and never let one supply a §4 `catalyst` on its own —
  a catalyst needs an event, and a newsletter is a reading of one. Several publish weekly,
  so an empty week is normal and is not evidence of anything.

Three requested sources are deliberately absent because they publish no public feed:
**Quant GT** (quantgt.io — gated product), **Steve Eisman** (no newsletter; podcast/TV
only), and **Seeking Alpha "Alpha Picks"** (paid product — only SA's free feeds are wired
up). If the narrative needs any of them, reach for them with WebSearch in this step and
cite the specific piece; do not pretend the feed carried it.

If the evidence for a mover is thin, top it up with WebSearch before writing the entry —
do not invent a catalyst.

### 5. Author the narrative

Write the narrative as a JSON object matching `narrative/_template.json`'s schema exactly.
**Read that file's `_README` block and follow it precisely.** The rules that matter most,
plus what this kind changes:

- Never restate a number the tables already carry unless the sentence needs it to make a
  point. **Every figure quoted must match the agg doc for `session_date`** (this is what
  `lint_narrative.py` checks in step 6).
- A mover with no in-window news evidence gets labelled `beta`. Never invent a catalyst.
- `s4` covers the largest movers with independent catalysts plus the reverse
  representatives — roughly 25-30 entries, in render order. With 251 names and both
  hemispheres in scope, bias selection toward **movers on the fresh side** of the tape;
  a stale US name is last session's story and usually belongs in §1, not §4.
- `s4[].ticker` must exist in `universe_chain`'s locked universe or `TAIWAN_ANCHORS` —
  price, pct and dollar volume are looked up automatically; never type them in by hand.
- `s3_notes` keys must match `universe_chain.SECTORS` **exactly** — all eleven of:
  `M7 与 AI 权重`, `IC 设计`, `存储`, `半导体设备`, `封测与测试`, `模拟与功率`,
  `PCB 产业链`, `MLCC 与被动元件`, `光模块与光器件`, `线缆与连接`, `下游与组件`.
  (These differ from both other kinds. Check the module, don't copy from a `us` narrative.)
- The anchor tag (`s4[].tag`) for the Taiwan layer is `universe_chain.ANCHOR_LABEL` —
  `"台股锚"`. Get this right or the report shows a dollar-volume figure for a name that
  doesn't have one (see `render_report.render_s4`).
- **Three of the twelve §1 indices are tracking funds, not indices**: `3033.HK`
  (Hang Seng TECH), `588000.SS` (STAR 50), `159915.SZ` (ChiNext). Yahoo serves only one bar
  of history for the underlying index symbols, so the fund stands in. Their daily pct is
  the index's to within tracking error — but write "创业板 ETF 涨 4.33%", never
  "创业板指收于 3.51".
- For style and tone, read the two most recently published `chain` reports (via the index,
  or the two most recent `narrative/chain_*.json` files in file mode). If there are none
  yet, read the most recent `us` and `asia` reports instead — same framework, same voice.
- **If `is_fresh` is False**: do not rewrite §2/§3 (the tables render themselves from the
  reused agg doc). Focus on what's changed since the last report. The rendered report
  carries an automatic banner stating the tape is reused; write honestly against what
  actually happened, and do not describe stale prices as if they just happened.

Write the result with:
```
$PY -c "
import json, store
nar = json.load(open('/tmp/narrative.json', encoding='utf-8'))
store.write_json('narrative', 'chain', '<publish_date>', nar)
"
```

### 6. Lint

```
$PY lint_narrative.py --date <publish_date> --session-date <session_date> --kind chain
```
(Omit `--session-date` when `is_fresh`.)

On failure the output names the exact ticker and figure that doesn't match. Fix that one
line, re-write the narrative (step 5's write command), and re-lint. **Retry at most 3
times.** If it still fails on the 4th attempt, stop and report — do not publish an
unverified figure, and do not bend the narrative to whatever the lint wants without
checking which one is actually right.

### 7. Render and export

```
$PY render_report.py --date <publish_date> --session-date <session_date> --kind chain
$PY export_report.py --date <publish_date> --session-date <session_date> --kind chain
```
(Omit `--session-date` when `is_fresh`.) In Mongo mode these still write local
`reports/*.html` — expected local scratch from these two CLIs; `publish.py` renders
independently from the store docs rather than reading these files back.

### 8. Publish

```
$PY publish.py --kind chain --date <publish_date> --slot <slot> --session-date <session_date>
```
(Omit `--session-date` when `is_fresh`.) Writes the report doc, the PDF (pruning anything
older than 30 days), and the history index the site reads. It lands under the **Supply
Chain** tab on the Reports page; both slots share that tab and are told apart by the
per-entry slot label.

### 9. Report back

State: slot, publish_date, session_date, is_fresh (and reused_from if applicable), the
fill rate and any `failed` symbols, and the PDF size printed by `publish.py`. If
`lint_narrative.py` needed more than one attempt, say how many and what was wrong.

## Where this kind is defined

| Concern | File |
| --- | --- |
| Universe, sectors, indices, anchors, FX, display names | `us-tech-daily/universe_chain.py` |
| Kind registration + the 30 news feeds | `us-tech-daily/kinds.py` |
| Headline aliases for the Asian names | `us-tech-daily/pull_news.py` |
| Report filename stem (`supply_chain_daily`) | `us-tech-daily/store.py` |
| API kind allowlist | `server/server.js` (`REPORT_KINDS`) |
| Reports page tab | `src/pages/reports/Reports.jsx` (`TABS`) |

The shared scripts branch on `--kind` alone. Everything this kind needs that the others
don't (`NAMES`, `fx_pair`, `SLOT_PROBE`) is read with `getattr` and absent from the `us`
and `asia` universes, so those two behave exactly as they did before this kind existed.
Keep it that way: **add a module attribute, don't add a branch on `kind`.**

## Scheduling

Two GitHub Actions workflows run this skill twice a day —
`.github/workflows/supply-chain-daily-us-close.yml` (07:13 HKT) and
`.github/workflows/supply-chain-daily-asia-close.yml` (18:17 HKT), each offset ten minutes
after the corresponding `us-tech-daily` workflow so the two never contend for Yahoo.
Each installs Python deps + Playwright Chromium, then runs `anthropics/claude-code-action`
with the prompt `/supply-chain-daily us-close` / `/supply-chain-daily asia-close`.
Authentication is a **Claude Code OAuth token** (`CLAUDE_CODE_OAUTH_TOKEN`, from
`claude setup-token`, tied to the account's Pro/Max subscription) — never
`ANTHROPIC_API_KEY` for this project. Both secrets (`CLAUDE_CODE_OAUTH_TOKEN`,
`MONGODB_URI`) are already configured for the `us-tech-daily` workflows and are reused
as-is; no new setup is required beyond triggering each workflow once manually
(`workflow_dispatch`) and reading the run before trusting the schedule.
