#!/usr/bin/env bash
# End-to-end daily run: EOD pull -> aggregate -> news -> render -> export md + pdf.
#
#   ./run.sh                # today's ET session
#   ./run.sh 2026-07-30     # a specific session
#
# Stops at the first failed stage: a partial tape must never reach a published report.
set -euo pipefail

cd "$(dirname "$0")"

DATE="${1:-$(TZ=America/New_York date +%F)}"
PY="${PY:-../analysis/.venv/bin/python}"

if [ ! -x "$PY" ]; then
  echo "python interpreter not found at $PY (override with PY=/path/to/python)" >&2
  exit 1
fi

# ALPHA_VANTAGE_API_KEY backs the bad-bar repair path in pull_global_eod.py.
if [ -f ../.env ]; then set -a; . ../.env; set +a; fi

echo "==> [1/5] EOD pull            $DATE"
"$PY" pull_global_eod.py --date "$DATE"

echo "==> [2/5] aggregate           $DATE"
"$PY" aggregate.py --date "$DATE"

echo "==> [3/5] news scrape         $DATE"
"$PY" pull_news.py --date "$DATE" 2>&1 | grep -v '^\[news\] skipped' || true

if [ ! -f "narrative/$DATE.json" ]; then
  cat >&2 <<EOF

==> [4/5] render               SKIPPED

narrative/$DATE.json does not exist yet.

Stages 1-3 produced the machine-checkable half of the report:
  data/eod_$DATE.json    prices, dollar volume, 52w distance
  data/agg_$DATE.json    sector equal-weight means, highlight/extreme flags
  data/news_$DATE.json   in-window headlines, matched per ticker

The catalyst attribution (sections 1, 4, 5, 6, 7) is written by hand against that
evidence — read data/news_$DATE.json, top up thin movers with a web search, then write
narrative/$DATE.json (copy a prior day as the schema) and re-run.
EOF
  exit 2
fi

echo "==> [4/5] lint + render       $DATE"
"$PY" lint_narrative.py --date "$DATE"
"$PY" render_report.py --date "$DATE"

echo "==> [5/5] export md + pdf     $DATE"
"$PY" export_report.py --date "$DATE"
