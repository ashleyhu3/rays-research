"""Same-session news pull for the section-4 catalyst attribution.

Reuses emailai's trusted-feed scraper (emailai/PDF_summarizer/ingest/news_fetcher.py)
directly — its RSS parsing, article-body extraction, finance triage and dedupe are
already tuned. Unlike emailai it writes nothing to a database; headlines and bodies go
straight to data/news_{DATE}.json for the attribution pass to read.

Every headline is matched against the 92-name universe (plus company aliases) so the
section-4 write-up starts from an evidence list per mover instead of from memory. A
mover with no in-window evidence must be labelled beta in the report, never invented.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
EMAILAI_INGEST = ROOT.parent / "emailai" / "PDF_summarizer" / "ingest"

if not EMAILAI_INGEST.is_dir():
    raise SystemExit(f"emailai news scraper not found at {EMAILAI_INGEST}")
sys.path.insert(0, str(EMAILAI_INGEST))

from news_fetcher import fetch_top_news  # noqa: E402

import universe  # noqa: E402

ET = ZoneInfo("America/New_York")

# Company names that would not be caught by a bare ticker match. Only names whose
# headline mention is unambiguous — no "Arm" (English word), no "ON" (preposition).
ALIASES: dict[str, list[str]] = {
    "AAPL": ["Apple"], "MSFT": ["Microsoft"], "GOOGL": ["Alphabet", "Google"],
    "AMZN": ["Amazon"], "NVDA": ["Nvidia", "NVIDIA"], "META": ["Meta Platforms", "Meta"],
    "TSLA": ["Tesla"], "AMD": ["Advanced Micro"], "AVGO": ["Broadcom"],
    "TSM": ["TSMC", "Taiwan Semiconductor"], "MRVL": ["Marvell"], "MU": ["Micron"],
    "ASML": ["ASML"], "AMAT": ["Applied Materials"], "LRCX": ["Lam Research"],
    "KLAC": ["KLA Corp", "KLA-Tencor"], "TER": ["Teradyne"], "INTC": ["Intel"],
    "GFS": ["GlobalFoundries"], "ADI": ["Analog Devices"], "MPWR": ["Monolithic Power"],
    "QCOM": ["Qualcomm"], "STX": ["Seagate"], "WDC": ["Western Digital"],
    "SNDK": ["SanDisk"], "RMBS": ["Rambus"], "VSH": ["Vishay"], "VICR": ["Vicor"],
    "TTMI": ["TTM Technologies"], "ASX": ["ASE Technology"], "WOLF": ["Wolfspeed"],
    "COHR": ["Coherent"], "LITE": ["Lumentum"], "AAOI": ["Applied Optoelectronics"],
    "CRDO": ["Credo Technology"], "CIEN": ["Ciena"], "FN": ["Fabrinet"],
    "GLW": ["Corning"], "SMTC": ["Semtech"], "TSEM": ["Tower Semiconductor"],
    "AXTI": ["AXT Inc", "AXT "], "DELL": ["Dell"], "SMCI": ["Super Micro", "Supermicro"],
    "HPE": ["Hewlett Packard Enterprise"], "ANET": ["Arista"], "ALAB": ["Astera Labs"],
    "APH": ["Amphenol"], "CSCO": ["Cisco"], "ORCL": ["Oracle"], "PLTR": ["Palantir"],
    "SNOW": ["Snowflake"], "DDOG": ["Datadog"], "NET": ["Cloudflare"],
    "CRWD": ["CrowdStrike"], "NOW": ["ServiceNow"], "CRM": ["Salesforce"],
    "APP": ["AppLovin"], "TEM": ["Tempus AI"], "NBIS": ["Nebius"], "CRWV": ["CoreWeave"],
    "GEV": ["GE Vernova"], "VRT": ["Vertiv"], "ETN": ["Eaton"], "PWR": ["Quanta Services"],
    "NRG": ["NRG Energy"], "VST": ["Vistra"], "CEG": ["Constellation Energy"],
    "NEE": ["NextEra"], "OKLO": ["Oklo"], "SMR": ["NuScale"], "NNE": ["Nano Nuclear"],
    "BE": ["Bloom Energy"], "FLNC": ["Fluence Energy"], "EQIX": ["Equinix"],
    "DLR": ["Digital Realty"], "GDS": ["GDS Holdings"], "VNET": ["VNET Group", "21Vianet"],
    "IONQ": ["IonQ"], "RGTI": ["Rigetti"], "QBTS": ["D-Wave"], "COIN": ["Coinbase"],
    "HOOD": ["Robinhood"], "MSTR": ["MicroStrategy", "Strategy Inc"],
    "RKLB": ["Rocket Lab"], "ASTS": ["AST SpaceMobile"], "JOBY": ["Joby"],
    "PONY": ["Pony.ai"], "MBLY": ["Mobileye"], "BABA": ["Alibaba"], "BIDU": ["Baidu"],
}

# Korea sub-layer names carry their own headline evidence.
KOREA_ALIASES = {
    "005930.KS": ["Samsung Electronics", "Samsung"],
    "000660.KS": ["SK Hynix", "SK hynix"],
    "^KS11": ["Kospi", "KOSPI"],
}


def _matchers(symbol: str, aliases: list[str]) -> list[re.Pattern]:
    out = []
    if symbol.isalpha() and len(symbol) >= 2:
        # Ticker form: bare word, or the "(TICK)" / "$TICK" conventions.
        out.append(re.compile(rf"(?<![A-Za-z]){re.escape(symbol)}(?![A-Za-z])"))
    for alias in aliases:
        out.append(re.compile(re.escape(alias.strip()), re.I))
    return out


def _in_window(published: datetime | None, session: date, lookback_hours: int) -> bool:
    if published is None:
        return False
    # Window closes at the next ET open so post-close earnings land in the right session.
    close = datetime.combine(session + timedelta(days=1), time(9, 30), tzinfo=ET)
    return (close - timedelta(hours=lookback_hours)) <= published.astimezone(ET) <= close


def pull(session: date, max_articles: int, per_source_limit: int, lookback_hours: int) -> dict:
    articles = fetch_top_news(max_articles=max_articles, per_source_limit=per_source_limit)

    targets = {t: ALIASES.get(t, []) for t in universe.locked_universe()}
    targets.update(KOREA_ALIASES)
    patterns = {sym: _matchers(sym, aliases) for sym, aliases in targets.items()}

    rows, by_ticker, out_of_window = [], {}, 0
    for article in articles:
        in_window = _in_window(article.published_at, session, lookback_hours)
        if not in_window:
            out_of_window += 1
        hay = f"{article.title}\n{article.summary}\n{article.body_text[:4000]}"
        hits = [sym for sym, pats in patterns.items() if any(p.search(hay) for p in pats)]
        row = {
            "title": article.title,
            "url": article.url,
            "source": article.source.name,
            "published_at": article.published_at.isoformat() if article.published_at else None,
            "in_window": in_window,
            "summary": article.summary[:600],
            "body_excerpt": article.body_text[:1500],
            "tickers": hits,
        }
        rows.append(row)
        if in_window:
            for sym in hits:
                by_ticker.setdefault(sym, []).append({
                    "title": row["title"], "url": row["url"], "source": row["source"],
                    "published_at": row["published_at"],
                })

    return {
        "session": session.isoformat(),
        "pulled_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "scraper": "emailai/PDF_summarizer/ingest/news_fetcher.py (fetch_top_news)",
        "window": {
            "lookback_hours": lookback_hours,
            "closes_at": datetime.combine(session + timedelta(days=1), time(9, 30), tzinfo=ET).isoformat(),
        },
        "counts": {
            "articles": len(rows),
            "in_window": len(rows) - out_of_window,
            "tickers_with_evidence": len(by_ticker),
        },
        "by_ticker": by_ticker,
        "articles": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True)
    parser.add_argument("--max-articles", type=int, default=120)
    parser.add_argument("--per-source-limit", type=int, default=25)
    parser.add_argument("--lookback-hours", type=int, default=36)
    args = parser.parse_args()

    payload = pull(
        date.fromisoformat(args.date),
        args.max_articles,
        args.per_source_limit,
        args.lookback_hours,
    )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = DATA_DIR / f"news_{payload['session']}.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    c = payload["counts"]
    print(f"session {payload['session']}: {c['articles']} articles, {c['in_window']} in window, "
          f"{c['tickers_with_evidence']} universe names with evidence")
    for sym, items in sorted(payload["by_ticker"].items(), key=lambda kv: -len(kv[1])):
        print(f"  {sym:<10} {len(items)}  {items[0]['title'][:80]}")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
