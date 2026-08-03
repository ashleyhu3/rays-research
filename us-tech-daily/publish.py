"""Publish a rendered report + PDF + index entry to Mongo (requires MONGODB_URI).

Reads the agg/narrative docs the pipeline already wrote (via store.py), renders the
HTML/Markdown/PDF in memory using the same pure functions render_report.py and
export_report.py's own CLIs use — no temp files — and writes three things:

  usTechReport:{kind}:{date}      the report itself (gzip-json; see store.write_report)
  usTechReportPdf:{kind}:{date}   the PDF, base64 — pruned to the last 30 days every run
  usTechReportIndex               newest-first history list per kind, for the site's
                                   history sidebar and for session.py's freshness check

--date is the report's own publish date (what the skill is publishing under this run).
--session-date is the session whose tape it renders, and only differs from --date for a
dead-slot report (session.py resolved is_fresh=False) — see render_report.py's docstring
for the same distinction.

    python publish.py --kind us --date 2026-07-31 --slot us-close
    python publish.py --kind us --date 2026-08-01 --slot us-close --session-date 2026-07-31
    python publish.py --backfill     # one-time import of the reports already on disk
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

import export_report
import kinds
import render_report
import store


def publish(kind: str, date_str: str, slot: str, session_date: str | None = None) -> dict:
    if store.mode() != "mongo":
        raise SystemExit("publish.py requires MONGODB_URI — there is nothing to publish to in file mode")

    session_date = session_date or date_str
    is_fresh = session_date == date_str
    reused_from = None if is_fresh else session_date

    uni = kinds.get(kind).universe
    agg = store.read_json("agg", kind, session_date)
    nar = store.read_json("narrative", kind, date_str)
    if agg is None:
        raise SystemExit(f"no agg doc for kind={kind} date={session_date}")
    if nar is None:
        raise SystemExit(f"no narrative doc for kind={kind} date={date_str}")

    meta = {"is_fresh": is_fresh, "reused_from": reused_from}
    html = render_report.render(agg, nar, uni, meta)
    md = export_report.build_markdown(agg, nar, uni)
    pdf_bytes = export_report.export_pdf(html)

    generated_at = datetime.now(timezone.utc).isoformat()
    filename = f"{date_str}_{store.report_stem(kind)}.pdf"

    payload = {
        "kind": kind, "slot": slot, "sessionDate": session_date,
        "isFresh": is_fresh, "reusedFrom": reused_from,
        "title": nar["title"], "subtitle": nar.get("subtitle_extra", ""), "badge": nar["badge"],
        "generatedAt": generated_at, "html": html, "md": md,
    }
    store.write_report(kind, date_str, payload)
    store.write_report_pdf(kind, date_str, pdf_bytes, filename)
    pruned = store.prune_report_pdfs(days=30)

    _update_index(kind, date_str, slot, nar, is_fresh, reused_from, generated_at)

    print(f"published {kind}/{date_str} ({slot}, session={session_date}), "
          f"pdf {len(pdf_bytes) / 1024:.0f} KB, pruned {len(pruned)} old pdf(s)")
    return payload


def _update_index(kind: str, date_str: str, slot: str, nar: dict, is_fresh: bool,
                   reused_from: str | None, generated_at: str) -> None:
    index = store.read_report_index()
    entries = index.get(kind, [])
    entries = [e for e in entries if not (e.get("date") == date_str and e.get("slot") == slot)]
    entries.append({
        "date": date_str, "slot": slot, "title": nar["title"],
        "subtitle": nar.get("subtitle_extra", ""), "isFresh": is_fresh,
        "reusedFrom": reused_from, "generatedAt": generated_at, "hasPdf": True,
    })
    entries.sort(key=lambda e: (e["date"], e["slot"]), reverse=True)
    index[kind] = entries
    store.write_report_index(index)


# One-time import of the us_tech_daily reports already committed to reports/ before this
# rollout. The retired weekend brief (2026-08-02_us_tech_weekend.*) is not imported: its
# agg/narrative shape predates universe.py's SECTORS schema and does not fit the report
# doc format above, and the weekend format itself is retired going forward.
_BACKFILL_DATES = ["2026-07-29", "2026-07-30", "2026-07-31", "2026-07-30_2026-07-31"]


def backfill() -> None:
    if store.mode() != "mongo":
        raise SystemExit("--backfill requires MONGODB_URI")

    for date_str in _BACKFILL_DATES:
        html_path = store.REPORT_DIR / f"{date_str}_us_tech_daily.html"
        md_path = store.REPORT_DIR / f"{date_str}_us_tech_daily.md"
        pdf_path = store.REPORT_DIR / f"{date_str}_us_tech_daily.pdf"
        agg_path = store.DATA_DIR / f"agg_{date_str}.json"
        nar_path = store.NARRATIVE_DIR / f"{date_str}.json"
        if not (html_path.exists() and agg_path.exists() and nar_path.exists()):
            print(f"skip {date_str}: missing source file(s)")
            continue

        nar = json.loads(nar_path.read_text(encoding="utf-8"))
        html = html_path.read_text(encoding="utf-8")
        md = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
        generated_at = datetime.fromtimestamp(html_path.stat().st_mtime, tz=timezone.utc).isoformat()

        payload = {
            "kind": "us", "slot": "us-close", "sessionDate": date_str,
            "isFresh": True, "reusedFrom": None,
            "title": nar["title"], "subtitle": nar.get("subtitle_extra", ""), "badge": nar["badge"],
            "generatedAt": generated_at, "html": html, "md": md,
        }
        store.write_report("us", date_str, payload)
        if pdf_path.exists():
            store.write_report_pdf("us", date_str, pdf_path.read_bytes(),
                                    f"{date_str}_us_tech_daily.pdf")
        _update_index("us", date_str, "us-close", nar, True, None, generated_at)
        print(f"backfilled {date_str}")

    pruned = store.prune_report_pdfs(days=30)
    print(f"pruned {len(pruned)} old pdf(s)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=sorted(kinds.KINDS))
    parser.add_argument("--date", help="the report's own publish date")
    parser.add_argument("--session-date", help="the session this report covers; defaults to --date")
    parser.add_argument("--slot", choices=["us-close", "asia-close"])
    parser.add_argument("--backfill", action="store_true", help="import reports already on disk")
    args = parser.parse_args()

    if args.backfill:
        backfill()
        return 0

    if not (args.kind and args.date and args.slot):
        parser.error("--kind, --date and --slot are required unless --backfill is given")

    publish(args.kind, args.date, args.slot, session_date=args.session_date)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
