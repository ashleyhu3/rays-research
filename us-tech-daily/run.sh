#!/usr/bin/env bash
# End-to-end run: EOD pull -> aggregate -> news -> lint + render -> export md + pdf.
#
#   ./run.sh                    # today's ET session, kind=us
#   ./run.sh 2026-07-30         # a specific session, kind=us
#   ./run.sh 2026-07-30 asia    # a specific session, kind=asia
#
# Set MONGODB_URI (e.g. via ../.env) to run against Mongo instead of local files — see
# store.py. Stops at the first failed stage: a partial tape must never reach a published
# report. This wrapper is for manual/local runs; the scheduled skill calls the same
# scripts directly so it can act on session.py's freshness result between stages.
set -euo pipefail

cd "$(dirname "$0")"

DATE="${1:-$(TZ=America/New_York date +%F)}"
KIND="${2:-us}"
PY="${PY:-../analysis/.venv/bin/python}"

if [ ! -x "$PY" ]; then
  echo "python interpreter not found at $PY (override with PY=/path/to/python)" >&2
  exit 1
fi

# ALPHA_VANTAGE_API_KEY backs the bad-bar repair path in pull_global_eod.py; MONGODB_URI
# switches store.py into Mongo mode.
if [ -f ../.env ]; then set -a; . ../.env; set +a; fi

if [ "$KIND" = "us" ]; then
  NARRATIVE_KEY="$DATE"
else
  NARRATIVE_KEY="${KIND}_${DATE}"
fi

echo "==> [1/5] EOD pull            $DATE ($KIND)"
"$PY" pull_global_eod.py --date "$DATE" --kind "$KIND"

echo "==> [2/5] aggregate           $DATE ($KIND)"
"$PY" aggregate.py --date "$DATE" --kind "$KIND"

echo "==> [3/5] news scrape         $DATE ($KIND)"
"$PY" pull_news.py --date "$DATE" --kind "$KIND" 2>&1 | grep -v '^\[news\] skipped' || true

NARRATIVE_FILE="narrative/${NARRATIVE_KEY}.json"
if [ -z "${MONGODB_URI:-}" ] && [ ! -f "$NARRATIVE_FILE" ]; then
  cat >&2 <<EOF

==> [4/5] render               SKIPPED

$NARRATIVE_FILE does not exist yet.

Stages 1-3 produced the machine-checkable half of the report:
  data/eod_${NARRATIVE_KEY}.json    prices, dollar volume, 52w distance
  data/agg_${NARRATIVE_KEY}.json    sector equal-weight means, highlight/extreme flags
  data/news_${NARRATIVE_KEY}.json   in-window headlines, matched per ticker

The catalyst attribution (sections 1, 4, 5, 6, 7) is written by hand against that
evidence — read data/news_${NARRATIVE_KEY}.json, top up thin movers with a web search, then write
$NARRATIVE_FILE (copy a prior day as the schema) and re-run.
EOF
  exit 2
fi

echo "==> [4/5] lint + render       $DATE ($KIND)"
"$PY" lint_narrative.py --date "$DATE" --kind "$KIND"
"$PY" render_report.py --date "$DATE" --kind "$KIND"

echo "==> [5/5] export md + pdf     $DATE ($KIND)"
"$PY" export_report.py --date "$DATE" --kind "$KIND"
