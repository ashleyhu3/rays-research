"""EOD pull for the tech sector review (US or Asia — see kinds.py).

Mirrors the sourcing pattern already used by server/scrapers/globalIndices.js (Yahoo
chart history, bounded concurrency, retry on 429) but in Python so the report pipeline
stays self-contained.

Per symbol it resolves, for the requested session date:
  close, prev_close, pct, volume, dollar volume (close x volume), 52-week high,
  distance to that high.

Dollar volume is USD-normalised when the universe module exposes an `fx_pair(symbol)`
resolver (universe_chain does; universe/universe_asia do not, and are unaffected). Without
it a KRW or JPY line reports its turnover in won or yen under a header that says B$ —
which is not a rounding error but three orders of magnitude, and it silently reorders
every "biggest mover by turnover" judgement the narrative makes.

Every bar is range-checked (low <= close <= high). Yahoo does serve daily bars whose
close falls outside the session range — QBTS on 2026-07-30 closed 17.98 but Yahoo
reported 16.21, below its own 16.71 low, which alone moved the 92-name equal-weight
average by 12bp. Those bars are repaired from Alpha Vantage rather than trusted.

Writes through store.py (local data/eod_{DATE}.json, or Mongo when MONGODB_URI is set).
Fails loudly on a low fill rate rather than silently carrying yesterday's tape forward.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import requests
import yfinance as yf

import kinds
import store

# A session is only usable if this share of the universe resolved.
MIN_FILL_RATE = 0.95

ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"
# Alpha Vantage's free tier is tightly rate limited, so it is a repair path only.
ALPHA_VANTAGE_MAX_REPAIRS = 20


def _pct(cur: float, prev: float) -> float | None:
    if prev in (None, 0) or cur is None:
        return None
    return (cur / prev - 1.0) * 100.0


def _finite(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def alpha_vantage_daily(symbol: str, timeout: float = 15.0) -> dict[str, dict[str, float]]:
    """{iso_date: {open, high, low, close, volume}} from Alpha Vantage, or {} if unusable."""
    key = os.getenv("ALPHA_VANTAGE_API_KEY")
    if not key:
        return {}
    try:
        resp = requests.get(
            ALPHA_VANTAGE_URL,
            params={
                "function": "TIME_SERIES_DAILY",
                "symbol": symbol,
                "outputsize": "compact",
                "apikey": key,
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        series = resp.json().get("Time Series (Daily)")
    except Exception as exc:
        print(f"[eod] alpha vantage lookup failed for {symbol}: {exc}")
        return {}
    if not series:
        return {}
    return {
        day: {
            "open": float(bar["1. open"]),
            "high": float(bar["2. high"]),
            "low": float(bar["3. low"]),
            "close": float(bar["4. close"]),
            "volume": float(bar["5. volume"]),
        }
        for day, bar in series.items()
    }


def _bar_is_coherent(low: float | None, high: float | None, close: float | None) -> bool:
    """A close outside its own session range means the vendor bar is broken."""
    if close is None or low is None or high is None:
        return True
    tolerance = max(abs(close) * 1e-4, 1e-6)
    return (low - tolerance) <= close <= (high + tolerance)


def fetch_symbol(symbol: str, session: date) -> dict:
    """One symbol, one session. 400 calendar days of history covers the 52w window."""
    start = session - timedelta(days=400)
    end = session + timedelta(days=4)
    frame = yf.Ticker(symbol).history(
        start=start.isoformat(),
        end=end.isoformat(),
        interval="1d",
        auto_adjust=False,
        raise_errors=False,
    )
    if frame is None or frame.empty:
        return {"symbol": symbol, "ok": False, "error": "no history"}

    frame = frame[~frame.index.duplicated(keep="last")]
    dates = [d.date() for d in frame.index]

    closes = [_finite(v) for v in frame["Close"].tolist()]
    highs = [_finite(v) for v in frame["High"].tolist()]
    lows = [_finite(v) for v in frame["Low"].tolist()]
    volumes = [_finite(v) for v in frame["Volume"].tolist()]

    # Last *settled* bar at or before the session date. Two things force the "settled"
    # qualifier rather than just taking the last row:
    #   - Non-US venues settle a day apart, so anchoring on "<= session" keeps them
    #     aligned instead of dropping them (this is the original rule).
    #   - Yahoo also emits a row for a session that has not printed a close yet, with a
    #     NaN close. Taking it shadows the last real close and reports the symbol as
    #     unresolvable. That is invisible for a single-venue universe — its own session
    #     is by definition settled — but for a universe spanning both trading windows it
    #     silently drops every name on whichever side of the world is mid-session.
    settled = [i for i, d in enumerate(dates) if d <= session and closes[i] is not None]
    if len(settled) < 2:
        return {"symbol": symbol, "ok": False, "error": f"no settled bar with a prior close on/before {session}"}
    idx, prev_idx = settled[-1], settled[-2]

    close = closes[idx]
    prev_close = closes[prev_idx]

    window_start = dates[idx] - timedelta(days=365)
    window_highs = [h for d, h in zip(dates[: idx + 1], highs[: idx + 1]) if h is not None and d >= window_start]
    high_52w = max(window_highs) if window_highs else None

    return {
        "symbol": symbol,
        "ok": True,
        "bar_date": dates[idx].isoformat(),
        "prev_bar_date": dates[prev_idx].isoformat(),
        "stale": dates[idx] != session,
        "close": close,
        "prev_close": prev_close,
        "session_low": lows[idx],
        "session_high": highs[idx],
        "coherent": _bar_is_coherent(lows[idx], highs[idx], close),
        "volume": volumes[idx],
        "high_52w": high_52w,
        "source": "yfinance",
    }


def repair_symbol(row: dict, session: date) -> dict:
    """Replace an incoherent Yahoo bar with the Alpha Vantage print for the same session."""
    series = alpha_vantage_daily(row["symbol"])
    bar = series.get(row["bar_date"])
    if not bar or not _bar_is_coherent(bar["low"], bar["high"], bar["close"]):
        row["repair"] = "unavailable"
        return row

    prev_days = sorted(d for d in series if d < row["bar_date"])
    prev_close = series[prev_days[-1]]["close"] if prev_days else row["prev_close"]

    row.update({
        "close": bar["close"],
        "prev_close": prev_close,
        "session_low": bar["low"],
        "session_high": bar["high"],
        "volume": bar["volume"],
        "coherent": True,
        "source": "alphavantage (repaired)",
        "repair": f"yahoo close {row['close']} outside session range "
                  f"[{row['session_low']}, {row['session_high']}]",
    })
    # 52w high is a max of highs, so a single bad close never moves it; keep Yahoo's.
    if row.get("high_52w") is not None:
        row["high_52w"] = max(row["high_52w"], bar["high"])
    return row


def fetch_fx_rates(pairs: list[str], session: date, workers: int = 4) -> dict[str, float]:
    """{pair: units of USD per 1 unit of the listing currency} on/near the session.

    Reuses fetch_symbol so an FX pair is resolved by exactly the same "last bar at or
    before the session" rule as an equity — FX prints on days some cash markets are shut,
    and anchoring on "<= session" is what keeps the two aligned.
    """
    if not pairs:
        return {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        rows = list(pool.map(lambda p: fetch_symbol(p, session), pairs))
    out = {}
    for row in rows:
        if row.get("ok") and row.get("close"):
            out[row["symbol"]] = row["close"]
        else:
            print(f"[eod] WARNING no FX rate for {row['symbol']} — leaving that venue's "
                  f"dollar volume in its listing currency")
    return out


def derive(row: dict, fx: dict[str, float] | None = None, fx_pair=None) -> dict:
    """Attach the derived fields the report renders, once the bar is final.

    `fx_pair` is the universe module's optional symbol -> FX-pair resolver. A universe
    that quotes in one currency (us, asia) does not define it, and dollar volume is then
    exactly what it always was: close x volume in the listing currency.
    """
    if not row.get("ok"):
        return row
    close, volume = row["close"], row.get("volume")
    dollar_volume = close * volume if volume is not None else None

    pair = fx_pair(row["symbol"]) if fx_pair else None
    rate = (fx or {}).get(pair) if pair else None
    if pair:
        # Record the attempt either way: a None rate on a non-USD line is why a dollar
        # volume looks 1000x wrong, and that has to be visible in the tape, not inferred.
        row["fx_pair"] = pair
        row["fx_to_usd"] = rate
    if rate and dollar_volume is not None:
        dollar_volume *= rate

    row["pct"] = _pct(close, row["prev_close"])
    row["dollar_volume_b"] = dollar_volume / 1e9 if dollar_volume is not None else None
    row["dist_52w_high_pct"] = _pct(close, row["high_52w"]) if row.get("high_52w") else None
    return row


def mark_skipped_sessions(rows: list[dict]) -> None:
    """Flag any row whose pct silently spans more than one session.

    pct is close/prev_close-1, which is a *one-day* move only if prev_bar_date really is
    the bar before bar_date. When the vendor is missing a print, it isn't — and the row
    reports a multi-day move under a one-day header with nothing to show for it. Yahoo
    did exactly this on 2026-08-03: every index symbol (^KS11, ^TWII, ^N225, ^HSI,
    000300.SS) skipped that session while every single stock on the same venues had it,
    so KOSPI rendered -3.59% for a day Yonhap reported closing +1.62%.

    Detected from the tape rather than from a market calendar, in keeping with
    session.py's "ask the tape, don't model the calendar": the union of every bar date
    the pull saw IS the set of days these venues traded, so a known trading date strictly
    inside a row's own (prev_bar_date, bar_date) interval is a session that row skipped.
    """
    known = sorted({d for r in rows if r.get("ok")
                    for d in (r.get("bar_date"), r.get("prev_bar_date")) if d})
    for row in rows:
        if not row.get("ok"):
            continue
        lo, hi = row.get("prev_bar_date"), row.get("bar_date")
        if not lo or not hi:
            continue
        row["skipped_sessions"] = [d for d in known if lo < d < hi]


def pull(session: date, kind: str = "us", workers: int = 8) -> dict:
    uni = kinds.get(kind).universe
    symbols = uni.all_quote_symbols()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        rows = list(pool.map(lambda s: fetch_symbol(s, session), symbols))

    fx_pair = getattr(uni, "fx_pair", None)
    fx = fetch_fx_rates(sorted({p for s in symbols if (p := fx_pair(s))}), session) if fx_pair else {}

    # Repair serially: Alpha Vantage's free tier will not tolerate parallel bursts.
    incoherent = [r for r in rows if r.get("ok") and not r.get("coherent")][:ALPHA_VANTAGE_MAX_REPAIRS]
    for i, row in enumerate(incoherent):
        print(f"[eod] incoherent bar for {row['symbol']}: close {row['close']} outside "
              f"[{row['session_low']}, {row['session_high']}] — repairing from Alpha Vantage")
        repair_symbol(row, session)
        if i < len(incoherent) - 1:
            time.sleep(1.0)

    rows = [derive(r, fx, fx_pair) for r in rows]
    mark_skipped_sessions(rows)

    quotes = {row["symbol"]: row for row in rows}
    failed = [row["symbol"] for row in rows if not row["ok"]]
    stale = [row["symbol"] for row in rows if row.get("stale")]
    gapped = [row["symbol"] for row in rows if row.get("skipped_sessions")]
    repaired = [row["symbol"] for row in rows if row.get("repair") and row.get("coherent")]
    unrepaired = [row["symbol"] for row in rows if row.get("ok") and not row.get("coherent")]
    fill_rate = 1.0 - len(failed) / len(rows)

    return {
        "session": session.isoformat(),
        "kind": kind,
        "pulled_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "yfinance EOD (pull_global_eod.py)",
        "counts": {
            "requested": len(rows),
            "resolved": len(rows) - len(failed),
            "locked_universe": len(uni.locked_universe()),
        },
        "fill_rate": round(fill_rate, 4),
        "fx_to_usd": fx,
        "failed": failed,
        "stale_bars": stale,
        "gapped_bars": gapped,
        "repaired_bars": repaired,
        "unrepaired_bad_bars": unrepaired,
        "quotes": quotes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=date.today().isoformat(), help="session date (local to --kind), YYYY-MM-DD")
    parser.add_argument("--kind", default="us", choices=sorted(kinds.KINDS), help="us | asia")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--allow-low-fill", action="store_true", help="write output even below the fill-rate floor")
    args = parser.parse_args()

    session = date.fromisoformat(args.date)
    payload = pull(session, args.kind, workers=args.workers)

    counts = payload["counts"]
    print(f"[{args.kind}] session {payload['session']}: resolved {counts['resolved']}/{counts['requested']} "
          f"(fill {payload['fill_rate']:.1%})")
    if payload["fx_to_usd"]:
        print("  fx to USD: " + ", ".join(f"{p}={r:.6g}" for p, r in sorted(payload["fx_to_usd"].items())))
    if payload["failed"]:
        print(f"  failed: {', '.join(payload['failed'])}")
    if payload["stale_bars"]:
        print(f"  stale bars (last trade before session): {', '.join(payload['stale_bars'])}")
    if payload["gapped_bars"]:
        print(f"  WARNING pct spans a skipped session (vendor missing a print): "
              f"{', '.join(payload['gapped_bars'])}")
    if payload["repaired_bars"]:
        print(f"  repaired from Alpha Vantage: {', '.join(payload['repaired_bars'])}")
    if payload["unrepaired_bad_bars"]:
        print(f"  WARNING incoherent bars left unrepaired: {', '.join(payload['unrepaired_bad_bars'])}")

    if payload["fill_rate"] < MIN_FILL_RATE and not args.allow_low_fill:
        print(f"ABORT: fill rate below {MIN_FILL_RATE:.0%}. Refusing to write a partial tape.", file=sys.stderr)
        return 1

    store.write_json("eod", args.kind, payload["session"], payload)
    print(f"wrote eod doc ({store.mode()} mode, kind={args.kind}, session={payload['session']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
