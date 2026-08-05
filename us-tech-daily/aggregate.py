"""Turn the raw EOD tape into the section-2 / section-3 aggregates the report renders.

Conventions the report commits to in section 7, enforced here so the prose can never
drift from the tables:
  - sector means are equal-weight, never cap-weight
  - standalone sub-sectors (see universe.STANDALONE_SECTORS) roll up on their own
  - anchor names (universe.KOREA_ANCHORS) never enter the locked-universe average
  - 高亮 = |pct| > 2.5%, 极端 = |pct| > 5%

Same logic for every kind (see kinds.py) — only the universe module differs.
"""

from __future__ import annotations

import argparse

import kinds
import store


# A sector reads as two-way only when the minority side is substantial. A lone decliner
# inside 20 names is beta noise, not a split; 3-of-7 is a genuine internal divergence.
TWO_WAY_MINORITY_SHARE = 1 / 3


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _direction(up: int, down: int) -> str:
    total = up + down
    if not total:
        return "—"
    if min(up, down) / total >= TWO_WAY_MINORITY_SHARE:
        return "↑↓"
    return "↑" if up >= down else "↓"


def build(eod: dict, uni=None) -> dict:
    uni = uni or kinds.get("us").universe
    quotes = eod["quotes"]

    def row(symbol: str) -> dict:
        q = quotes.get(symbol, {})
        pct = q.get("pct")
        return {
            "ticker": symbol,
            "close": q.get("close"),
            "pct": pct,
            "dollar_volume_b": q.get("dollar_volume_b"),
            "dist_52w_high_pct": q.get("dist_52w_high_pct"),
            "highlight": pct is not None and abs(pct) > uni.HIGHLIGHT_ABS_PCT,
            "extreme": pct is not None and abs(pct) > uni.EXTREME_ABS_PCT,
        }

    sectors = []
    for name, members in uni.SECTORS.items():
        rows = sorted((row(t) for t in members), key=lambda r: (r["pct"] is None, -(r["pct"] or 0)))
        pcts = [r["pct"] for r in rows if r["pct"] is not None]
        up = sum(1 for p in pcts if p > 0)
        down = sum(1 for p in pcts if p <= 0)
        sectors.append({
            "name": name,
            "n": len(rows),
            "mean_pct": _mean(pcts),
            "up": up,
            "down": down,
            "highlight_n": sum(1 for r in rows if r["highlight"]),
            "extreme_n": sum(1 for r in rows if r["extreme"]),
            "direction": _direction(up, down),
            "standalone": name in uni.STANDALONE_SECTORS,
            "rows": rows,
        })

    locked = uni.locked_universe()
    locked_pcts = [quotes[t]["pct"] for t in locked if quotes.get(t, {}).get("pct") is not None]

    korea_rows = [dict(row(sym), label=label) for sym, label in uni.KOREA_ANCHORS]
    korea_pcts = [r["pct"] for r in korea_rows if r["pct"] is not None]
    trigger = quotes.get(uni.KOREA_TRIGGER_TICKER, {}).get("pct")

    indices = []
    for sym, label in uni.INDICES:
        q = quotes.get(sym, {})
        # An index whose vendor print is missing for a day it actually traded reports a
        # multi-day move in a one-day column (see pull_global_eod.mark_skipped_sessions).
        # Say so in the label — §1 renders the label verbatim, so this cannot be quoted
        # as a session move without the caveat travelling with it.
        skipped = q.get("skipped_sessions") or []
        if skipped:
            label = f"{label} · 跨 {len(skipped) + 1} 日"
        indices.append({"symbol": sym, "label": label, "close": q.get("close"),
                        "pct": q.get("pct"), "skipped_sessions": skipped})

    movers = sorted(
        (row(t) for t in locked),
        key=lambda r: (r["pct"] is None, -abs(r["pct"] or 0)),
    )

    return {
        "session": eod["session"],
        "kind": eod.get("kind", "us"),
        "source": eod["source"],
        "indices": indices,
        "sectors": sorted(sectors, key=lambda s: (s["mean_pct"] is None, -(s["mean_pct"] or 0))),
        "sectors_ordered": [s["name"] for s in sectors],
        "universe": {
            "locked_n": len(locked),
            "scored_n": len(locked_pcts),
            "mean_pct": _mean(locked_pcts),
            "up": sum(1 for p in locked_pcts if p > 0),
            "down": sum(1 for p in locked_pcts if p <= 0),
            "highlight_n": sum(1 for p in locked_pcts if abs(p) > uni.HIGHLIGHT_ABS_PCT),
            "extreme_n": sum(1 for p in locked_pcts if abs(p) > uni.EXTREME_ABS_PCT),
            "sectors_green": sum(1 for s in sectors if (s["mean_pct"] or 0) > 0),
            "sectors_total": len(sectors),
        },
        "korea": {
            "rows": korea_rows,
            "mean_pct": _mean(korea_pcts),
            "up": sum(1 for p in korea_pcts if p > 0),
            "down": sum(1 for p in korea_pcts if p <= 0),
            "highlight_n": sum(1 for r in korea_rows if r["highlight"]),
            "extreme_n": sum(1 for r in korea_rows if r["extreme"]),
            "direction": _direction(sum(1 for p in korea_pcts if p > 0),
                                    sum(1 for p in korea_pcts if p <= 0)),
            "trigger_ticker": uni.KOREA_TRIGGER_TICKER,
            "trigger_pct": trigger,
            "triggered": trigger is not None and abs(trigger) > uni.KOREA_TRIGGER_ABS_PCT,
        },
        "movers": movers,
        "thresholds": {
            "highlight_abs_pct": uni.HIGHLIGHT_ABS_PCT,
            "extreme_abs_pct": uni.EXTREME_ABS_PCT,
            "korea_trigger_abs_pct": uni.KOREA_TRIGGER_ABS_PCT,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True)
    parser.add_argument("--kind", default="us", choices=sorted(kinds.KINDS), help="us | asia")
    args = parser.parse_args()

    uni = kinds.get(args.kind).universe
    eod = store.read_json("eod", args.kind, args.date)
    if eod is None:
        raise SystemExit(f"no eod doc for kind={args.kind} date={args.date} — run pull_global_eod.py first")

    agg = build(eod, uni)
    store.write_json("agg", args.kind, args.date, agg)

    u = agg["universe"]
    print(f"[{args.kind}] session {agg['session']}: {u['scored_n']} names, equal-weight {u['mean_pct']:+.2f}%, "
          f"{u['up']}/{u['down']} up/down, {u['sectors_green']}/{u['sectors_total']} sub-sectors green")
    print(f"  highlight |pct|>{uni.HIGHLIGHT_ABS_PCT}%: {u['highlight_n']}   "
          f"extreme |pct|>{uni.EXTREME_ABS_PCT}%: {u['extreme_n']}")
    for s in agg["sectors"]:
        print(f"  {s['name']:<22} n={s['n']:<3} {s['mean_pct']:+7.2f}%  {s['up']}/{s['down']}  "
              f"hl={s['highlight_n']:<3} ex={s['extreme_n']:<3} {s['direction']}")
    k = agg["korea"]
    print(f"  {uni.ANCHOR_HEADER_LABEL:<22} n={len(k['rows'])}   {k['mean_pct']:+7.2f}%  {k['up']}/{k['down']}  "
          f"hl={k['highlight_n']} ex={k['extreme_n']}   trigger={k['trigger_pct']:+.2f}% "
          f"({'FIRED' if k['triggered'] else 'quiet'})")
    print(f"wrote agg doc ({store.mode()} mode, kind={args.kind}, session={agg['session']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
