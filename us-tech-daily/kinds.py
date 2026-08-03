"""Kind registry: maps a report kind ("us" | "asia") to its universe module, session
timezone, and news sources. Every pipeline script branches on this table via --kind
instead of hardcoding US assumptions, so adding a kind never touches the scripts.

Also resolves the vendored news scraper import (falling back to the emailai copy for a
local checkout that has it) — the one place that decision is made, so pull_news.py and any
other caller import the same module object regardless of which file backed it.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
_VENDOR_NEWS = ROOT / "vendor" / "news_fetcher.py"
_EMAILAI_NEWS_DIR = ROOT.parent / "emailai" / "PDF_summarizer" / "ingest"

if _VENDOR_NEWS.exists():
    sys.path.insert(0, str(_VENDOR_NEWS.parent))
elif _EMAILAI_NEWS_DIR.is_dir():
    sys.path.insert(0, str(_EMAILAI_NEWS_DIR))
else:
    raise SystemExit(
        f"news scraper not found: neither {_VENDOR_NEWS} nor {_EMAILAI_NEWS_DIR} exists"
    )

from news_fetcher import NewsSource, fetch_top_news  # noqa: E402

import universe as universe_us  # noqa: E402
import universe_asia  # noqa: E402


ASIA_NEWS_SOURCES: list[NewsSource] = [
    NewsSource(name="Nikkei Asia", feed_url="https://asia.nikkei.com/rss/feed",
               homepage="https://asia.nikkei.com/"),
    NewsSource(name="SCMP Business", feed_url="https://www.scmp.com/rss/92/feed",
               homepage="https://www.scmp.com/business"),
    NewsSource(name="Korea Herald Business", feed_url="https://www.koreaherald.com/rss/020000000000.xml",
               homepage="https://www.koreaherald.com/"),
    NewsSource(name="Yonhap Economy", feed_url="https://en.yna.co.kr/RSS/economy.xml",
               homepage="https://en.yna.co.kr/"),
    NewsSource(name="DigiTimes Asia", feed_url="https://www.digitimes.com/rss/daily.xml",
               homepage="https://www.digitimes.com/"),
    NewsSource(name="Reuters Asia Markets", feed_url="https://www.reuters.com/markets/asia/rss",
               homepage="https://www.reuters.com/markets/asia/"),
    NewsSource(name="Taipei Times Business", feed_url="https://www.taipeitimes.com/xml/business.xml",
               homepage="https://www.taipeitimes.com/News/biz"),
    NewsSource(name="CNA Business", feed_url="https://www.channelnewsasia.com/rssfeeds/8395986",
               homepage="https://www.channelnewsasia.com/business"),
]


@dataclass(frozen=True)
class Kind:
    id: str
    label: str                              # "US Close" / "Asia Close" — UI-facing
    universe: object                        # module with universe.py's public API
    tz: ZoneInfo                            # this kind's trading-day timezone
    open_time: tuple[int, int]              # (hour, minute) next local open — closes the news window
    news_sources: list[NewsSource] | None   # None -> vendor default (US) sources


KINDS: dict[str, Kind] = {
    "us": Kind(
        id="us", label="US Close",
        universe=universe_us, tz=ZoneInfo("America/New_York"), open_time=(9, 30),
        news_sources=None,
    ),
    "asia": Kind(
        id="asia", label="Asia Close",
        universe=universe_asia, tz=ZoneInfo("Asia/Hong_Kong"), open_time=(9, 30),
        news_sources=ASIA_NEWS_SOURCES,
    ),
}


def get(kind: str) -> Kind:
    try:
        return KINDS[kind]
    except KeyError:
        raise SystemExit(f"unknown --kind {kind!r}; choose from {sorted(KINDS)}") from None
