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
import universe_chain  # noqa: E402


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

# Wider Asia + global tape for the supply-chain kind, which trades six venues rather than
# one. The Taiwan and Korea vernacular feeds matter most here: the PCB/MLCC/OSAT tiers are
# reported in Chinese and Korean days before the English wires pick them up.
#
# Every feed below was probed on 2026-08-04 and returned a parseable, current RSS
# document. A dead feed is not fatal — fetch_top_news catches per-source failures and
# carries on — but it does silently shrink the evidence base, so re-probe before assuming
# a quiet news doc means a quiet tape.
#
# Four feeds in ASIA_NEWS_SOURCES above are dead as of 2026-08-04 and return nothing for
# either kind: Nikkei Asia (404), Yonhap Economy (404), Reuters Asia Markets (401 — Reuters
# closed its public RSS), Taipei Times Business (404). Two are replaced here by working
# URLs; Nikkei and Reuters have no free replacement, and Japan Times / Bloomberg / FT below
# are what stand in for them. ASIA_NEWS_SOURCES itself is left exactly as it was so the
# existing asia-close report's behaviour does not change underneath it.
CHAIN_ASIA_NEWS_SOURCES: list[NewsSource] = [
    NewsSource(name="Yonhap Markets", feed_url="https://en.yna.co.kr/RSS/news.xml",
               homepage="https://en.yna.co.kr/"),
    NewsSource(name="Korea Economic Daily Business", feed_url="https://www.kedglobal.com/rss/news.xml",
               homepage="https://www.kedglobal.com/"),
    NewsSource(name="CNYES Taiwan Markets", feed_url="https://news.cnyes.com/rss/v1/news/category/headline",
               homepage="https://news.cnyes.com/"),
    NewsSource(name="UDN Money Markets", feed_url="https://money.udn.com/rssfeed/news/1001/5591?ch=money",
               homepage="https://money.udn.com/"),
    NewsSource(name="Business Korea", feed_url="https://www.businesskorea.co.kr/rss/allArticle.xml",
               homepage="https://www.businesskorea.co.kr/"),
    NewsSource(name="Korea Times Business", feed_url="https://www.koreatimes.co.kr/www/rss/rss.xml",
               homepage="https://www.koreatimes.co.kr/"),
    NewsSource(name="Japan Times Business", feed_url="https://www.japantimes.co.jp/feed/",
               homepage="https://www.japantimes.co.jp/business/"),
    NewsSource(name="Straits Times Business", feed_url="https://www.straitstimes.com/news/business/rss.xml",
               homepage="https://www.straitstimes.com/business"),
    NewsSource(name="CNBC Asia Markets",
               feed_url="https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19832390",
               homepage="https://www.cnbc.com/asia-markets/"),
    NewsSource(name="Bloomberg Markets", feed_url="https://feeds.bloomberg.com/markets/news.rss",
               homepage="https://www.bloomberg.com/markets"),
    NewsSource(name="FT Asia-Pacific Markets", feed_url="https://www.ft.com/asia-pacific?format=rss",
               homepage="https://www.ft.com/asia-pacific"),
    NewsSource(name="Seeking Alpha Market News", feed_url="https://seekingalpha.com/market_currents.xml",
               homepage="https://seekingalpha.com/market-news"),
    NewsSource(name="Seeking Alpha Markets", feed_url="https://seekingalpha.com/feed.xml",
               homepage="https://seekingalpha.com/"),
    NewsSource(name="EE Times", feed_url="https://www.eetimes.com/feed/",
               homepage="https://www.eetimes.com/"),
    NewsSource(name="Tom's Hardware", feed_url="https://www.tomshardware.com/feeds/all",
               homepage="https://www.tomshardware.com/"),
]

# Independent research desks. These publish a thesis rather than a wire story, so they are
# the §4 catalyst source most likely to explain *why* a tier moved rather than that it
# did — but they are also opinion, and dated: several publish weekly, so a post can fall
# outside pull_news.py's window and legitimately produce no evidence for the session.
# Attribute them by name in the narrative; never present a newsletter thesis as a fact.
#
# Three names from the requested list have no public feed to subscribe to and are
# deliberately absent — see the skill's "news sources" note:
#   Quant GT (quantgt.io, gated product, no RSS)
#   Steve Eisman (no newsletter; podcast/TV only)
#   Seeking Alpha "Alpha Picks" (paid product; only the free SA feeds above are open)
RESEARCH_NEWS_SOURCES: list[NewsSource] = [
    NewsSource(name="SemiAnalysis", feed_url="https://newsletter.semianalysis.com/feed",
               homepage="https://semianalysis.com/", reliability="independent_research"),
    NewsSource(name="Citrini Research", feed_url="https://citrini.substack.com/feed",
               homepage="https://www.citrini.xyz/", reliability="independent_research"),
    NewsSource(name="FundaAI", feed_url="https://fundaai.substack.com/feed",
               homepage="https://fundaai.substack.com/", reliability="independent_research"),
    NewsSource(name="Gaetano (Crux Capital)", feed_url="https://cruxcapitalgroup.substack.com/feed",
               homepage="https://cruxcapitalgroup.substack.com/", reliability="independent_research"),
    NewsSource(name="MacroCharts", feed_url="https://macrocharts.substack.com/feed",
               homepage="https://macrocharts.substack.com/", reliability="independent_research"),
    NewsSource(name="Cassandra Unchained (Michael Burry)", feed_url="https://michaeljburry.substack.com/feed",
               homepage="https://michaeljburry.substack.com/", reliability="independent_research"),
    NewsSource(name="Doomberg", feed_url="https://doomberg.substack.com/feed",
               homepage="https://doomberg.substack.com/", reliability="independent_research"),
]

CHAIN_NEWS_SOURCES: list[NewsSource] = (
    ASIA_NEWS_SOURCES + CHAIN_ASIA_NEWS_SOURCES + RESEARCH_NEWS_SOURCES
)


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
    # Runs in both slots — the universe spans six venues, so both the 07:00 HKT US tape
    # and the 18:00 HKT Asia tape are a genuine session for it. tz is HKT because that is
    # the desk's day and what a dead-slot publish_date should be stamped in; the per-slot
    # freshness probe lives in universe_chain.SLOT_PROBE, not here.
    "chain": Kind(
        id="chain", label="Supply Chain",
        universe=universe_chain, tz=ZoneInfo("Asia/Hong_Kong"), open_time=(9, 30),
        news_sources=CHAIN_NEWS_SOURCES,
    ),
}


def get(kind: str) -> Kind:
    try:
        return KINDS[kind]
    except KeyError:
        raise SystemExit(f"unknown --kind {kind!r}; choose from {sorted(KINDS)}") from None
