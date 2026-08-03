"""Session/slot resolution for the twice-daily report schedule.

Two fixed slots, firing once a day regardless of weekday:
  us-close    07:00 HKT — the US cash session that closed ~3h earlier (ET evening)
  asia-close  18:00 HKT — Korea/Taiwan/Japan/China/HK, just shut

"Ask the tape, don't model the calendar": resolve() probes the kind's own primary index
via yfinance for the newest available bar. If it is newer than the session the *previous*
report in this exact (kind, slot) used (read from the usTechReportIndex, see store.py),
the slot is fresh. Otherwise nothing new has printed and the prior session's date is
reused with is_fresh=False — this is what happens on a US holiday, a weekend 07:00 HKT
run, or an Asia-shut Saturday/Sunday 18:00 HKT run. No market-calendar dependency: every
holiday is handled by the same "no new bar since last time" check.

This absorbs pull_weekend_snapshot.py's MARKET_HOURS / is_open() (kept as a diagnostic —
see market_open_now below). The weekend report format itself (render_weekend.py,
pull_weekend_snapshot.py's INSTRUMENTS snapshot) is retired: a dead slot now reuses the
regular kind universe's own agg doc rather than a separate non-92-name instrument list.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import yfinance as yf

import kinds
import store

SLOTS = {"us-close", "asia-close"}

# Local clock ranges in which an exchange is mid-session — a diagnostic only: it flags a
# probe that ran before that day's close has actually posted (e.g. a slow HSI afternoon
# auction still running at 18:00 HKT). is_fresh does not depend on this; it is driven
# purely by whether yfinance has produced a bar newer than the prior report's.
MARKET_HOURS: dict[str, tuple[tuple[int, int], tuple[int, int]]] = {
    "America/New_York": ((9, 30), (16, 0)),
    "Asia/Hong_Kong": ((9, 30), (16, 0)),
}


def is_open(tz: ZoneInfo, now_utc: datetime) -> bool:
    key = getattr(tz, "key", str(tz))
    if key not in MARKET_HOURS:
        return False
    local = now_utc.astimezone(tz)
    if local.weekday() >= 5:
        return False
    (oh, om), (ch, cm) = MARKET_HOURS[key]
    return (oh, om) <= (local.hour, local.minute) < (ch, cm)


@dataclass(frozen=True)
class Resolution:
    kind: str
    slot: str
    publish_date: str    # what to pass as --date / publish.py's --date (this run's own identity)
    session_date: str    # what to pass as --session-date (the tape this run renders)
    is_fresh: bool
    reused_from: str | None
    probe_symbol: str
    market_open_now: bool
    label: str


def _probe_symbol(kind: str) -> str:
    """The kind's first index — the single highest-liquidity anchor used to ask
    "is there a new bar yet"."""
    return kinds.get(kind).universe.INDICES[0][0]


def _latest_bar_date(symbol: str):
    hist = yf.Ticker(symbol).history(period="1mo", auto_adjust=False)
    if hist is None or hist.empty:
        return None
    hist = hist.dropna(subset=["Close"])
    if hist.empty:
        return None
    return hist.index[-1].date()


def _last_report_session(kind: str, slot: str) -> str | None:
    """The session the most recent report in this exact (kind, slot) covered. Index
    entries (see publish.py) don't carry a separate "sessionDate" field — a fresh report's
    session is its own publish date; a dead-slot report's is reusedFrom. The index is
    newest-first per kind, so the first matching slot wins."""
    index = store.read_report_index()
    for entry in index.get(kind, []):
        if entry.get("slot") == slot:
            return entry.get("reusedFrom") or entry.get("date")
    return None


def resolve(kind: str, slot: str, now: datetime | None = None) -> Resolution:
    if slot not in SLOTS:
        raise ValueError(f"unknown slot {slot!r}; choose from {sorted(SLOTS)}")

    k = kinds.get(kind)
    now = now or datetime.now(ZoneInfo("UTC"))
    symbol = _probe_symbol(kind)
    latest = _latest_bar_date(symbol)
    if latest is None:
        raise RuntimeError(f"could not resolve a bar for probe symbol {symbol} (kind={kind})")

    prior_session = _last_report_session(kind, slot)
    market_open_now = is_open(k.tz, now)
    is_fresh = prior_session is None or latest.isoformat() > prior_session

    if is_fresh:
        # A fresh report's own identity IS the session it covers — no divergence, same as
        # every report before this rollout.
        session_date = latest.isoformat()
        return Resolution(
            kind=kind, slot=slot, publish_date=session_date, session_date=session_date,
            is_fresh=True, reused_from=None, probe_symbol=symbol, market_open_now=market_open_now,
            label=f"{kind}/{slot}: fresh session {session_date}",
        )

    # Dead slot: this run is new content published today, but it renders a prior session's
    # tape — the two dates diverge, which is exactly what --session-date is for.
    publish_date = now.astimezone(k.tz).date().isoformat()
    return Resolution(
        kind=kind, slot=slot, publish_date=publish_date, session_date=prior_session,
        is_fresh=False, reused_from=prior_session, probe_symbol=symbol, market_open_now=market_open_now,
        label=f"{kind}/{slot}: no new session since last report — publishing {publish_date} "
              f"reusing {prior_session}",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", required=True, choices=sorted(kinds.KINDS))
    parser.add_argument("--slot", required=True, choices=sorted(SLOTS))
    parser.add_argument("--now", help="ISO 8601 timestamp, for the market_open_now diagnostic only "
                                       "(is_fresh always reflects real yfinance data)")
    args = parser.parse_args()

    now = datetime.fromisoformat(args.now) if args.now else None
    r = resolve(args.kind, args.slot, now=now)
    print(r.label)
    print(f"publish_date={r.publish_date} session_date={r.session_date} is_fresh={r.is_fresh} "
          f"reused_from={r.reused_from or '-'} market_open_now={r.market_open_now}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
