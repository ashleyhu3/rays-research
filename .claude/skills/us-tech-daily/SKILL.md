---
name: us-tech-daily
description: "Generate and publish one US Tech Daily report (US Close or Asia Close) to the site. Runs the us-tech-daily/ pipeline end to end: pulls prices and news, authors the narrative half, lints every figure against the tape, renders HTML/Markdown/PDF, and publishes to Mongo. Trigger: /us-tech-daily us-close or /us-tech-daily asia-close."
---

# /us-tech-daily

Drives `us-tech-daily/` end to end for one report and publishes it to the site. This is
the only step in the pipeline that needs judgment — everything else (prices, aggregation,
linting, rendering, export) is deterministic code this skill calls, never reimplements.

## Usage

```
/us-tech-daily us-close      # kind=us,   slot=us-close    (fires ~07:00 HKT)
/us-tech-daily asia-close    # kind=asia, slot=asia-close  (fires ~18:00 HKT)
```

Run from the repo root. Requires `MONGODB_URI` in the environment (set via `.env` locally,
or as a GitHub Actions secret in the scheduled workflows — see `.github/workflows/us-tech-daily-*.yml`)
— every step below writes through `us-tech-daily/store.py`, which is Mongo-mode with
`MONGODB_URI` set and leaves **no files on disk**. `ALPHA_VANTAGE_API_KEY` is optional
(backs the EOD bad-bar repair path only).

**First, `cd us-tech-daily`** — every command below assumes that as the working directory.

**Python interpreter**: use `analysis/.venv/bin/python` (relative to the repo root, i.e.
`../analysis/.venv/bin/python` from inside `us-tech-daily/`) if that path exists — this
repo's local convention. If it doesn't exist (e.g. the GitHub Actions runner, which has no
such venv), use plain `python` on `PATH` instead, after `pip install -r requirements.txt`.
Resolve this once at the start and call it `$PY` for the rest of these steps.

## Steps

### 1. Resolve the session

```
$PY session.py --kind <kind> --slot <slot>
```

Read `publish_date`, `session_date`, `is_fresh`, `reused_from` from the output.

- `is_fresh=True`: `session_date == publish_date`. This is the ordinary case — a new
  session just closed.
- `is_fresh=False`: nothing has traded since the last report in this exact slot (a
  holiday, or a slot firing on a day its market doesn't trade at all — e.g. `us-close` on
  a Sunday or Monday-after-Friday's-close, `asia-close` on a Saturday or Sunday). The tape
  is `reused_from` a prior session; only the narrative is new. **Do not treat this as an
  error** — it is an expected, designed-for outcome. Carry `publish_date` and
  `session_date` through every command below exactly as printed.

### 2. Get the tape

If `is_fresh`:
```
$PY pull_global_eod.py --date <session_date> --kind <kind>
$PY aggregate.py --date <session_date> --kind <kind>
```
`pull_global_eod.py` aborts (exit 1) below a 95% fill rate rather than write a partial
tape — if that happens, stop and report it; do not retry with `--allow-low-fill` unless
you have first checked why so many symbols failed (a real outage vs. a handful of
delisted/renamed tickers, especially likely for `--kind asia`).

If **not** `is_fresh`, skip this step entirely — do not re-pull or re-aggregate. The
`session_date` tape already exists in the store from the report that originally produced it.

### 3. Pull news

Always run this step, fresh or not — the narrative needs current headlines even when
prices are reused:
```
$PY pull_news.py --date <publish_date> --kind <kind>
```
Note this is keyed by `publish_date`, not `session_date`: a dead-slot report is new
content published today, so its news window should be today's, not the original
session's.

### 4. Read the evidence

Read the news doc and the agg doc before writing anything:
- `data/news_{key}.json` (file mode) or the `usTechNews:{kind}:{publish_date}` doc — the
  `by_ticker` map is the evidence list per mover; `articles` is everything pulled.
- `data/agg_{key}.json` / `usTechAgg:{kind}:{session_date}` — sector means, mover list,
  highlight/extreme flags, the anchor-layer trigger.

(`{key}` in file mode is the date for `us`, `asia_{date}` for `asia` — see
`store.session_key`. In Mongo mode there is no file to read directly; use a short Python
one-liner, e.g. `python -c "import store,json; print(json.dumps(store.read_json('agg','us','2026-07-31')))"`.)

If the evidence for a mover is thin, top it up with WebSearch before writing the entry —
do not invent a catalyst.

### 5. Author the narrative

Write the narrative as a JSON object matching `narrative/_template.json`'s schema exactly.
**Read that file's `_README` block and follow it precisely** — the rules that matter most:

- Never restate a number the tables already carry unless the sentence needs it to make a
  point. **Every figure quoted in the narrative must match the agg doc for `session_date`**
  (this is what `lint_narrative.py` checks in step 6).
- A mover with no in-window news evidence gets labelled `beta`. Never invent a catalyst.
- `s4` covers the largest movers with independent catalysts plus the reverse
  representatives — roughly 25-30 entries, in render order.
- `s4[].ticker` must exist in the kind's locked universe or its anchor list (`KOREA_ANCHORS`
  in `universe.py` / `universe_asia.py`) — price, pct and dollar volume are looked up
  automatically; never type them in by hand.
- `s3_notes` keys must match the kind's `SECTORS` names exactly (`universe.SECTORS` for
  `us`, `universe_asia.SECTORS` for `asia` — the Chinese section names differ between
  kinds; check the right module).
- The anchor tag (`s4[].tag`) for the layer that isn't part of the locked universe is
  `universe.ANCHOR_LABEL` — `"韩国锚"` for `us`, `"美股锚"` for `asia`. Get this right or
  the report will show a dollar-volume figure for a name that doesn't have one (see
  `render_report.render_s4`).
- For style and tone, read the two most recently published reports for this kind as a
  reference (via the index, or the two most recent `narrative/*.json` files in file mode).
- **If `is_fresh` is False**: do not rewrite §2/§3 (the tables render themselves from the
  reused agg doc regardless). Focus the narrative on what's changed since the last
  report — new headlines, developing stories, anything that recontextualizes the reused
  tape. The rendered report will carry an automatic banner stating the tape is reused; you
  do not need to add your own disclaimer text, just write honestly against what actually
  happened since the last report (do not describe stale prices as if they just happened).

Write the result with:
```
$PY -c "
import json, store
nar = json.load(open('/tmp/narrative.json', encoding='utf-8'))  # whatever you drafted it to
store.write_json('narrative', '<kind>', '<publish_date>', nar)
"
```
(Or write the JSON directly via any means — the point is it must end up written through
`store.write_json('narrative', kind, publish_date, nar)`.)

### 6. Lint

```
$PY lint_narrative.py --date <publish_date> --session-date <session_date> --kind <kind>
```
(Omit `--session-date` when `is_fresh` — it defaults to `--date`.)

On failure, the output names the exact ticker and the exact figure that doesn't match.
Fix that one line in the narrative, re-write it (step 5's write command), and re-lint.
**Retry at most 3 times.** If it still fails on the 4th attempt, stop and report the
failure — do not publish a report with an unverified figure, and do not weaken the
narrative's numbers to whatever the lint wants without checking which one is actually
right (occasionally the bug is a stale news headline, not the narrative).

### 7. Render and export

```
$PY render_report.py --date <publish_date> --session-date <session_date> --kind <kind>
$PY export_report.py --date <publish_date> --session-date <session_date> --kind <kind>
```
(Again, omit `--session-date` when `is_fresh`.) In Mongo mode these still write local
`reports/*.html` — that's expected local scratch output from these two CLIs specifically;
publish.py (next step) is what actually reaches Mongo, and it renders independently from
the store docs rather than reading these files back.

### 8. Publish

```
$PY publish.py --kind <kind> --date <publish_date> --slot <slot> --session-date <session_date>
```
(Omit `--session-date` when `is_fresh`.) This is the step that writes to Mongo: the
report doc, the PDF (pruning anything older than 30 days), and the history index the site
reads.

### 9. Report back

State: kind, slot, publish_date, session_date, is_fresh (and reused_from if applicable),
and the PDF size printed by `publish.py`. If `lint_narrative.py` needed more than one
attempt, say how many and what was wrong.

## Scheduling

Two GitHub Actions workflows run this skill twice a day — `.github/workflows/us-tech-daily-us-close.yml`
(07:03 HKT) and `.github/workflows/us-tech-daily-asia-close.yml` (18:07 HKT). Each installs
Python deps + Playwright Chromium, then runs `anthropics/claude-code-action` with the
prompt `/us-tech-daily us-close` / `/us-tech-daily asia-close`. Authentication is a
**Claude Code OAuth token** (`claude setup-token`, tied to the account's existing Pro/Max
subscription — draws from the plan's included Agent SDK credit, not a separate
pay-per-token API key) — never `ANTHROPIC_API_KEY` for this project.

### First-time setup (once, before the first scheduled run)

- Run `claude setup-token` locally (needs a Pro/Max/Team/Enterprise plan) and add the
  resulting token as the GitHub repo secret `CLAUDE_CODE_OAUTH_TOKEN`. It's valid ~1 year —
  re-run and update the secret when it's about to expire.
- Confirm `MONGODB_URI` is a repo secret (optionally `MONGODB_DB`, `ALPHA_VANTAGE_API_KEY`
  — the latter only backs the US kind's bad-bar repair path).
- No local files are required beyond the repo checkout — `us-tech-daily/vendor/news_fetcher.py`
  is committed, so there is no dependency on the gitignored `emailai/` tree. Each workflow
  run installs `us-tech-daily/requirements.txt` and `playwright install --with-deps chromium`
  itself — nothing needs to be pre-provisioned on the runner.
- Trigger each workflow once manually (`workflow_dispatch`, or "Run workflow" in the
  Actions tab) and read the run before trusting the schedule.
