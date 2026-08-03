"""Check every figure hand-written into a narrative against the computed tape (US or
Asia — see kinds.py).

The narrative is the one place a number can be typed by hand, so it is the one place a
number can be wrong. This walks every `TICKER ±x.xx%` in the narrative doc and:

  - matches it against that session's data           -> ok
  - matches it against a different session's data    -> cross-day reference; fine when
    the sentence labels the date (these reports routinely cite the next day to separate
    "it fell" from "it was news"), so it is reported but not fatal
  - matches nothing                                  -> error, exit 1

Sector means, index moves and the anchor names are checked the same way. Cross-session
matching runs across every kind on record, so a dead-slot narrative that reuses a prior
session's tape (see session.py) still lints clean — that agg doc is still in the store.

    python lint_narrative.py --date 2026-07-29
    python lint_narrative.py --date 2026-07-31 --kind asia

--date names the narrative doc (the report's own publish date). --session-date names the
agg doc to validate figures against, and defaults to --date. They differ only for a
dead-slot report (see session.py): its narrative is new prose published today, but every
figure in it must still match a prior session's tape, because that is the tape the report
is reusing verbatim.

    python lint_narrative.py --date 2026-08-02 --session-date 2026-07-31
"""

from __future__ import annotations

import argparse
import json
import re

import kinds
import store

TOLERANCE = 0.015  # both sides are rounded to 2dp before comparison
# Futures and FX pairs (ES=F, JPY=X) come first: the bare-ticker branch would otherwise
# swallow their leading letters and never reach the percentage. The suffixed-ticker
# alternative covers every non-US venue in play: Korea (.KS), Taiwan (.TW), Japan (.T),
# Hong Kong (.HK), and China A-shares (.SS/.SZ).
PAIR = re.compile(
    r"([A-Z]{2,3}=[FX]|[A-Z]{2,6}|\^[A-Z0-9]+|\d{4,6}\.(?:KS|TW|T|HK|SS|SZ))"
    r"\s*(?:</b>|</mark>|\s)*([+−-]\d+\.\d\d)%")


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
    parser.add_argument("--date", required=True, help="the narrative/report's own publish date")
    parser.add_argument("--session-date", help="the session to validate against; defaults to --date")
    parser.add_argument("--kind", default="us", choices=sorted(kinds.KINDS), help="us | asia")
    args = parser.parse_args()
    session_date = args.session_date or args.date

    nar = store.read_json("narrative", args.kind, args.date)
    if nar is None:
        print(f"no narrative for kind={args.kind} date={args.date}")
        return 0

    sessions = {key: price_map(agg) for key, agg in store.list_sessions("agg").items()}
    own_key = store.session_key(args.kind, session_date)
    if own_key not in sessions:
        print(f"no aggregate for kind={args.kind} date={session_date} — run aggregate.py first")
        return 1

    own = sessions[own_key]
    text = json.dumps(nar, ensure_ascii=False)

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
                     if d != own_key and ticker in m and abs(m[ticker] - value) <= TOLERANCE]
        if elsewhere:
            cross.append(f"{ticker} {value:+.2f}% -> {', '.join(elsewhere)}")
        else:
            print(f"  ERROR {ticker}: narrative {value:+.2f}%, "
                  f"{own_key} tape {own[ticker]:+.2f}%, matches no other session")
            errors += 1

    print(f"{own_key}: checked {checked} figures, {errors} error(s), "
          f"{len(cross)} cross-day reference(s)")
    for line in cross:
        print(f"  cross-day  {line}")
    if errors:
        print("FAIL — a figure in the narrative matches no session's tape.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
