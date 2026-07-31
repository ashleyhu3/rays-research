"""Check every figure hand-written into a narrative against the computed tape.

The narrative is the one place a number can be typed by hand, so it is the one place a
number can be wrong. This walks every `TICKER ±x.xx%` in narrative/{DATE}.json and:

  - matches it against that session's data           -> ok
  - matches it against a different session's data    -> cross-day reference; fine when
    the sentence labels the date (these reports routinely cite the next day to separate
    "it fell" from "it was news"), so it is reported but not fatal
  - matches nothing                                  -> error, exit 1

Sector means, index moves and the Korea anchors are checked the same way.

    python lint_narrative.py --date 2026-07-29
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
NARRATIVE_DIR = ROOT / "narrative"

TOLERANCE = 0.015  # both sides are rounded to 2dp before comparison
PAIR = re.compile(r"([A-Z]{2,6}|\^[A-Z0-9]+|\d{6}\.KS)\s*(?:</b>|</mark>|\s)*([+−-]\d+\.\d\d)%")


def price_map(agg: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for row in agg["movers"]:
        out[row["ticker"]] = row["pct"]
    for row in agg["korea"]["rows"]:
        out[row["ticker"]] = row["pct"]
    for idx in agg["indices"]:
        out[idx["symbol"]] = idx["pct"]
    for sector in agg["sectors"]:
        out[sector["name"]] = sector["mean_pct"]
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True)
    args = parser.parse_args()

    narrative_path = NARRATIVE_DIR / f"{args.date}.json"
    if not narrative_path.exists():
        print(f"no narrative at {narrative_path}")
        return 0

    sessions = {
        p.stem.removeprefix("agg_"): price_map(json.loads(p.read_text(encoding="utf-8")))
        for p in sorted(DATA_DIR.glob("agg_*.json"))
    }
    if args.date not in sessions:
        print(f"no aggregate for {args.date} — run aggregate.py first")
        return 1

    own = sessions[args.date]
    text = narrative_path.read_text(encoding="utf-8")

    checked = errors = 0
    cross: list[str] = []
    for match in PAIR.finditer(text):
        ticker, raw = match.group(1), match.group(2)
        if ticker not in own:
            continue
        value = float(raw.replace("−", "-"))
        checked += 1
        if abs(own[ticker] - value) <= TOLERANCE:
            continue
        elsewhere = [d for d, m in sessions.items()
                     if d != args.date and ticker in m and abs(m[ticker] - value) <= TOLERANCE]
        if elsewhere:
            cross.append(f"{ticker} {value:+.2f}% -> {', '.join(elsewhere)}")
        else:
            print(f"  ERROR {ticker}: narrative {value:+.2f}%, "
                  f"{args.date} tape {own[ticker]:+.2f}%, matches no other session")
            errors += 1

    print(f"{args.date}: checked {checked} figures, {errors} error(s), "
          f"{len(cross)} cross-day reference(s)")
    for line in cross:
        print(f"  cross-day  {line}")
    if errors:
        print("FAIL — a figure in the narrative matches no session's tape.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
