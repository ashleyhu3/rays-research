"""Roll two or more consecutive sessions into one tape, then aggregate it as usual.

The daily pipeline answers "what moved last night". Over a weekend the more useful
question is "where did the week end up", and that is not the same thing: a name can fall
18% and rebound 26% and finish up 4%, and only the compounded figure says so. This builds
a synthetic EOD tape whose `pct` is the **compounded** return across the span, then hands
it to `aggregate.build()` unchanged — so sector means, highlight/extreme flags, direction
arrows and the Korea trigger are all computed by exactly the same code that runs daily.

What each field means on a span tape:

  pct                 compounded across every session in the span, not summed
  close               the last session's close
  dollar_volume_b     summed across the span (turnover over the whole window)
  dist_52w_high_pct   the last session's — a point-in-time reading, never compounded
  prev_close          the close going into the first session, so pct is checkable

Thresholds are deliberately left alone. |pct|>5% means something different over two
sessions than over one, and §7 of the report is where that gets said in words rather than
by quietly moving the number.

    python aggregate_span.py --dates 2026-07-30 2026-07-31
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import aggregate
import universe

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"


def compound(pcts: list[float]) -> float:
    total = 1.0
    for p in pcts:
        total *= 1.0 + p / 100.0
    return (total - 1.0) * 100.0


def build_span_eod(dates: list[str]) -> dict:
    eods = []
    for d in dates:
        path = DATA_DIR / f"eod_{d}.json"
        if not path.exists():
            raise SystemExit(f"missing {path} — run pull_global_eod.py --date {d} first")
        eods.append(json.loads(path.read_text(encoding="utf-8")))

    first, last = eods[0], eods[-1]
    symbols = sorted({s for e in eods for s in e["quotes"]})

    quotes: dict[str, dict] = {}
    for sym in symbols:
        legs = [e["quotes"].get(sym) for e in eods]
        # A name must be present and priced in *every* session, or its compounded return
        # would silently describe a shorter window than the report claims to cover.
        if any(q is None or q.get("pct") is None for q in legs):
            continue
        tail = legs[-1]
        quotes[sym] = {
            "symbol": sym,
            "ok": True,
            "bar_date": tail.get("bar_date"),
            "stale": False,
            "close": tail.get("close"),
            "prev_close": legs[0].get("prev_close"),
            "session_low": None,
            "session_high": None,
            "coherent": True,
            "volume": sum(q.get("volume") or 0 for q in legs),
            "high_52w": tail.get("high_52w"),
            "source": "span of " + " + ".join(dates),
            "pct": compound([q["pct"] for q in legs]),
            "dollar_volume_b": sum(q.get("dollar_volume_b") or 0 for q in legs),
            "dist_52w_high_pct": tail.get("dist_52w_high_pct"),
        }

    return {
        "session": last["session"],
        "sessions": dates,
        "pulled_at": last.get("pulled_at"),
        "source": f"span tape compounded from {len(dates)} sessions ({aggregate.__name__})",
        "counts": {
            "requested": len(symbols),
            "resolved": len(quotes),
            "locked_universe": len(universe.locked_universe()),
        },
        "fill_rate": len(quotes) / len(symbols) if symbols else 0.0,
        "failed": [s for s in symbols if s not in quotes],
        "stale_bars": [],
        "repaired_bars": [b for e in eods for b in e.get("repaired_bars", [])],
        "unrepaired_bad_bars": [b for e in eods for b in e.get("unrepaired_bad_bars", [])],
        "quotes": quotes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dates", nargs="+", required=True,
                        help="sessions in chronological order, e.g. 2026-07-30 2026-07-31")
    args = parser.parse_args()

    dates = list(args.dates)
    if len(dates) < 2:
        raise SystemExit("a span needs at least two sessions")
    if dates != sorted(dates):
        raise SystemExit("--dates must be in chronological order")

    key = f"{dates[0]}_{dates[-1]}"
    eod = build_span_eod(dates)

    agg = aggregate.build(eod)
    agg["sessions"] = dates
    agg["session_end"] = dates[-1]
    agg["session_label"] = f"{dates[0]} → {dates[-1]}（{len(dates)} 个交易日合并）"

    (DATA_DIR / f"eod_{key}.json").write_text(
        json.dumps(eod, indent=2, ensure_ascii=False), encoding="utf-8")
    out = DATA_DIR / f"agg_{key}.json"
    out.write_text(json.dumps(agg, indent=2, ensure_ascii=False), encoding="utf-8")

    u = agg["universe"]
    print(f"span {agg['session_label']}: {u['scored_n']} names, "
          f"compounded equal-weight {u['mean_pct']:+.2f}%, {u['up']}/{u['down']} up/down, "
          f"{u['sectors_green']}/{u['sectors_total']} sub-sectors green")
    print(f"  highlight |pct|>{universe.HIGHLIGHT_ABS_PCT}%: {u['highlight_n']}   "
          f"extreme |pct|>{universe.EXTREME_ABS_PCT}%: {u['extreme_n']}")
    for s in agg["sectors"]:
        print(f"  {s['name']:<22} n={s['n']:<3} {s['mean_pct']:+7.2f}%  {s['up']}/{s['down']}  "
              f"hl={s['highlight_n']:<3} ex={s['extreme_n']:<3} {s['direction']}")
    k = agg["korea"]
    print(f"  韩国锚(非92)            n={len(k['rows'])}   {k['mean_pct']:+7.2f}%  "
          f"{k['up']}/{k['down']}  hl={k['highlight_n']} ex={k['extreme_n']}   "
          f"trigger={k['trigger_pct']:+.2f}% ({'FIRED' if k['triggered'] else 'quiet'})")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
