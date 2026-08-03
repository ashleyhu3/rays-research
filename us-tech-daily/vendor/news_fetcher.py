"""
Trusted financial news ingestion.

Fetches the top items from an allowlisted set of financial/business RSS feeds,
extracts article text when the page is accessible, and returns normalized article
objects ready for the same document/chunk storage used by email ingestion.

Vendored copy of emailai/PDF_summarizer/ingest/news_fetcher.py. us-tech-daily/pull_news.py
imports this file directly so the report pipeline has no dependency on the (gitignored)
emailai/ tree — it is otherwise self-contained (stdlib + requests + beautifulsoup4). Keep
in sync with the emailai original by hand; do not fork the logic.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Iterable, List, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup


USER_AGENT = os.getenv(
    "NEWS_USER_AGENT",
    "RaysResearchBot/1.0 (financial research ingestion)",
)


@dataclass(frozen=True)
class NewsSource:
    name: str
    feed_url: str
    homepage: str
    reliability: str = "major_financial_news"


@dataclass
class NewsArticle:
    source: NewsSource
    title: str
    url: str
    published_at: Optional[datetime]
    summary: str
    body_text: str
    feed_position: int
    triage_reason: str = ""

    @property
    def stable_id(self) -> str:
        key = self.url or f"{self.source.name}:{self.title}:{self.published_at}"
        return hashlib.sha256(f"news|{key}".encode("utf-8")).hexdigest()

    @property
    def html_body(self) -> str:
        date_label = self.published_at.isoformat() if self.published_at else ""
        body = self.body_text or self.summary
        paragraphs = [
            p.strip()
            for p in re.split(r"\n{2,}", body)
            if p.strip()
        ]
        if not paragraphs and body.strip():
            paragraphs = [body.strip()]
        para_html = "\n".join(f"<p>{html.escape(p)}</p>" for p in paragraphs)
        summary_html = (
            f"<p><strong>Feed summary:</strong> {html.escape(self.summary)}</p>"
            if self.summary and self.summary not in body
            else ""
        )
        return (
            "<article>"
            f"<h1>{html.escape(self.title)}</h1>"
            f"<p><strong>Source:</strong> {html.escape(self.source.name)}"
            f"{' | <strong>Published:</strong> ' + html.escape(date_label) if date_label else ''}"
            f" | <a href=\"{html.escape(self.url)}\">Original article</a></p>"
            f"{summary_html}"
            f"{para_html}"
            "</article>"
        )


DEFAULT_NEWS_SOURCES: List[NewsSource] = [
    NewsSource(
        name="CNBC Top News",
        feed_url="https://www.cnbc.com/id/100003114/device/rss/rss.html",
        homepage="https://www.cnbc.com/",
    ),
    NewsSource(
        name="MarketWatch Top Stories",
        feed_url="https://feeds.marketwatch.com/marketwatch/topstories/",
        homepage="https://www.marketwatch.com/",
    ),
    NewsSource(
        name="WSJ Markets",
        feed_url="https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
        homepage="https://www.wsj.com/news/markets",
    ),
    NewsSource(
        name="Yahoo Finance",
        feed_url="https://finance.yahoo.com/news/rssindex",
        homepage="https://finance.yahoo.com/",
    ),
    NewsSource(
        name="NYTimes Business",
        feed_url="https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
        homepage="https://www.nytimes.com/section/business",
    ),
    NewsSource(
        name="Financial Times Markets",
        feed_url="https://www.ft.com/markets?format=rss",
        homepage="https://www.ft.com/markets",
    ),
]


def load_news_sources() -> List[NewsSource]:
    """Load NEWS_RSS_FEEDS if provided; otherwise use curated defaults.

    NEWS_RSS_FEEDS accepts either:
      - JSON list: [{"name": "Reuters", "feed_url": "...", "homepage": "..."}]
      - line/semicolon separated entries: Name|feed_url|homepage
    """
    raw = os.getenv("NEWS_RSS_FEEDS", "").strip()
    if not raw:
        return DEFAULT_NEWS_SOURCES

    try:
        parsed = json.loads(raw)
        sources = [
            NewsSource(
                name=str(item["name"]).strip(),
                feed_url=str(item["feed_url"]).strip(),
                homepage=str(item.get("homepage") or item["feed_url"]).strip(),
                reliability=str(item.get("reliability") or "configured_financial_news"),
            )
            for item in parsed
            if item.get("name") and item.get("feed_url")
        ]
        if sources:
            return sources
    except Exception:
        pass

    sources: List[NewsSource] = []
    for line in re.split(r"[\n;]+", raw):
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 2 and parts[0] and parts[1]:
            sources.append(NewsSource(
                name=parts[0],
                feed_url=parts[1],
                homepage=parts[2] if len(parts) >= 3 and parts[2] else parts[1],
                reliability="configured_financial_news",
            ))
    return sources or DEFAULT_NEWS_SOURCES


def fetch_top_news(
    max_articles: Optional[int] = None,
    per_source_limit: Optional[int] = None,
    sources: Optional[Iterable[NewsSource]] = None,
) -> List[NewsArticle]:
    max_articles = max_articles or int(os.getenv("NEWS_MAX_ARTICLES", "25"))
    per_source_limit = per_source_limit or int(os.getenv("NEWS_PER_SOURCE_LIMIT", "5"))
    scan_multiplier = max(1, int(os.getenv("NEWS_SOURCE_SCAN_MULTIPLIER", "4")))
    timeout = float(os.getenv("NEWS_FETCH_TIMEOUT_SECONDS", "12"))
    include_body = os.getenv("NEWS_FETCH_ARTICLE_BODY", "1").strip().lower() not in {"0", "false", "no"}

    articles: List[NewsArticle] = []
    for source in sources or load_news_sources():
        try:
            feed_xml = _http_get_text(source.feed_url, timeout=timeout)
            items = _parse_feed(feed_xml, source)[:per_source_limit * scan_multiplier]
            accepted_for_source = 0
            for item in items:
                accepted, reason = is_financial_news_article(item, include_body=False)
                if not accepted:
                    print(f"[news] skipped non-finance article ({reason}): {source.name} — {item.title[:90]}")
                    continue
                item.triage_reason = reason
                if include_body and item.url:
                    item.body_text = _fetch_article_body(item.url, timeout=timeout) or item.body_text
                    accepted, reason = is_financial_news_article(item, include_body=True)
                    if not accepted:
                        print(f"[news] skipped non-finance article after body check ({reason}): {source.name} — {item.title[:90]}")
                        continue
                    item.triage_reason = reason
                articles.append(item)
                accepted_for_source += 1
                if accepted_for_source >= per_source_limit:
                    break
        except Exception as exc:
            print(f"[news] {source.name} feed failed: {exc}")

    deduped = _dedupe_articles(articles)
    deduped.sort(
        key=lambda a: (
            a.published_at or datetime.fromtimestamp(0, tz=timezone.utc),
            -a.feed_position,
        ),
        reverse=True,
    )
    return deduped[:max_articles]


_FINANCE_STRONG_RE = re.compile(
    r"\b("
    r"markets?|stocks?|shares?|equities|bonds?|treasur(?:y|ies)|yield(?:s)?|"
    r"rates?|fed|federal reserve|central bank|inflation|gdp|recession|econom(?:y|ic)|"
    r"cost of living|cost-saver|funflation|wealth fund|layoffs?|"
    r"oil|crude|gas prices?|gold|commodit(?:y|ies)|currency|currencies|dollar|yen|euro|"
    r"bitcoin|crypto|tariffs?|trade war|exports?|imports?|supply chain|"
    r"earnings?|revenue|profits?|margins?|guidance|forecast|outlook|"
    r"ipo|spac|merger|acquisition|takeover|buyout|stake|investment|fundraising|"
    r"private equity|venture capital|hedge fund|asset manager|bank(?:s|ing)?|"
    r"bankrupt(?:cy)?|chapter 11|debt|credit|loan|mortgage|tax(?:es)?|"
    r"price target|analyst|rating|upgrade|downgrade|valuation|market cap"
    r")\b",
    re.I,
)

_FINANCE_WEAK_RE = re.compile(
    r"\b("
    r"business|company|companies|corporate|industry|consumer|retail(?:er|ers|ing)?|"
    r"restaurant|franchise|commercial|real estate|housing|box office|lawsuit|"
    r"antitrust|regulator(?:s|y)?|ai|semiconductor|chip(?:s)?|data center|"
    r"platform|product|governance|warehouse|optimization"
    r")\b",
    re.I,
)

_BUSINESS_ENTITY_RE = re.compile(
    r"\b("
    r"apple|openai|microsoft|nvidia|amazon|meta|alphabet|google|tesla|salesforce|"
    r"disney|paramount|warner|lionsgate|citigroup|jpmorgan|goldman|cognizant|"
    r"costar|symbotic|coreweave|oracle|broadcom|amd|intel|tsmc"
    r")\b|"
    r"\([A-Z]{1,6}\)",
    re.I,
)

_NON_FINANCE_HARD_RE = re.compile(
    r"\b("
    r"senator|sen\.|congress|gop|democrat(?:s|ic)?|republican(?:s)?|election|"
    r"senate|house seat|lawmaker|campaign|foreign policy|ukraine|"
    r"dies|death|illness|health update|funeral|obituary|sports|celebrity"
    r")\b",
    re.I,
)


def is_financial_news_article(article: NewsArticle, include_body: bool = False) -> tuple[bool, str]:
    """Cheap deterministic gate for business/finance relevance.

    This mirrors the email invite/report triage philosophy: obvious non-finance
    items from broad feeds are rejected before article crawling, DB writes, or
    embedding. Finance/business feeds get a small source prior, while broad feeds
    must prove relevance through market/company/business keywords.
    """
    text_parts = [article.title or "", article.summary or ""]
    if include_body:
        text_parts.append(article.body_text or "")
    text = " ".join(text_parts)

    strong_hits = _unique_matches(_FINANCE_STRONG_RE, text)
    weak_hits = _unique_matches(_FINANCE_WEAK_RE, text)
    entity_hits = _unique_matches(_BUSINESS_ENTITY_RE, text)
    source_score = _source_finance_score(article.source)
    hard_non_finance = bool(_NON_FINANCE_HARD_RE.search(text))

    if hard_non_finance and not (strong_hits or entity_hits):
        return False, "politics/obituary/non-business signal without finance terms"

    if strong_hits:
        return True, f"finance keywords: {', '.join(strong_hits[:4])}"

    if entity_hits and (weak_hits or source_score > 0):
        return True, f"business entity signal: {', '.join(entity_hits[:3])}"

    if source_score >= 2 and not hard_non_finance:
        return True, "trusted finance/business feed"

    if source_score > 0 and weak_hits:
        return True, f"business keywords: {', '.join(weak_hits[:4])}"

    return False, "no finance/business relevance signal"


def _source_finance_score(source: NewsSource) -> int:
    source_text = f"{source.name} {source.feed_url} {source.homepage}".lower()
    if "cnbc top news" in source_text:
        return 0
    if any(token in source_text for token in (
        "market", "markets", "finance", "financial", "business", "wsj",
        "marketwatch", "ft.com/markets", "yahoo finance",
    )):
        return 2
    return 0


def _unique_matches(pattern: re.Pattern, text: str) -> List[str]:
    seen = set()
    out = []
    for match in pattern.finditer(text or ""):
        value = next((g for g in match.groups() if g), match.group(0))
        value = value.strip()
        key = value.lower()
        if key not in seen:
            seen.add(key)
            out.append(value)
    return out


def _http_get_text(url: str, timeout: float) -> str:
    resp = requests.get(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8",
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.text


def _parse_feed(xml_text: str, source: NewsSource) -> List[NewsArticle]:
    root = ET.fromstring(xml_text.encode("utf-8"))
    root_name = _local_name(root.tag).lower()
    if root_name == "feed":
        entries = [child for child in root if _local_name(child.tag) == "entry"]
        return [_article_from_atom(entry, source, i) for i, entry in enumerate(entries)]

    items = [
        node
        for node in root.iter()
        if _local_name(node.tag) == "item"
    ]
    return [_article_from_rss(item, source, i) for i, item in enumerate(items)]


def _article_from_rss(item: ET.Element, source: NewsSource, position: int) -> NewsArticle:
    title = _clean_text(_child_text(item, "title"))
    link = _normalize_url(_child_text(item, "link") or _child_text(item, "guid"))
    published = _parse_date(
        _child_text(item, "pubDate")
        or _child_text(item, "published")
        or _child_text(item, "updated")
        or _child_text(item, "date")
    )
    summary = _clean_html(
        _child_text(item, "description")
        or _child_text(item, "summary")
        or _child_text(item, "encoded")
    )
    return NewsArticle(
        source=source,
        title=title or "(untitled)",
        url=link,
        published_at=published,
        summary=summary,
        body_text=summary,
        feed_position=position,
    )


def _article_from_atom(entry: ET.Element, source: NewsSource, position: int) -> NewsArticle:
    title = _clean_text(_child_text(entry, "title"))
    link = ""
    for child in entry:
        if _local_name(child.tag) == "link":
            rel = (child.attrib.get("rel") or "alternate").lower()
            href = child.attrib.get("href")
            if href and rel == "alternate":
                link = href
                break
            if href and not link:
                link = href
    published = _parse_date(
        _child_text(entry, "published")
        or _child_text(entry, "updated")
        or _child_text(entry, "date")
    )
    summary = _clean_html(
        _child_text(entry, "summary")
        or _child_text(entry, "content")
    )
    return NewsArticle(
        source=source,
        title=title or "(untitled)",
        url=_normalize_url(link),
        published_at=published,
        summary=summary,
        body_text=summary,
        feed_position=position,
    )


def _fetch_article_body(url: str, timeout: float) -> str:
    try:
        resp = requests.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
            },
            timeout=timeout,
        )
        resp.raise_for_status()
    except Exception:
        return ""

    content_type = resp.headers.get("content-type", "")
    if "html" not in content_type.lower() and "<html" not in resp.text[:1000].lower():
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "form", "nav", "footer", "aside"]):
        tag.decompose()

    container = (
        soup.find("article")
        or soup.select_one("[role='main']")
        or soup.select_one(".article-body, .ArticleBody, .story-body, .StoryBody")
        or soup.body
    )
    if not container:
        return ""

    paragraphs = []
    noise = re.compile(
        r"^(sign up|subscribe|advertisement|read more|watch live|all rights reserved)\b",
        re.I,
    )
    for p in container.find_all(["p", "li"]):
        text = _clean_text(p.get_text(" ", strip=True))
        if len(text.split()) < 5 or noise.search(text):
            continue
        paragraphs.append(text)
        if sum(len(x) for x in paragraphs) > int(os.getenv("NEWS_ARTICLE_MAX_CHARS", "10000")):
            break

    return "\n\n".join(paragraphs)


def _dedupe_articles(articles: Iterable[NewsArticle]) -> List[NewsArticle]:
    out: List[NewsArticle] = []
    seen = set()
    for article in articles:
        key = article.url or f"{article.source.name}:{article.title}"
        if key in seen:
            continue
        seen.add(key)
        out.append(article)
    return out


def _child_text(node: ET.Element, local_name: str) -> str:
    for child in node:
        if _local_name(child.tag) == local_name:
            return "".join(child.itertext()).strip()
    return ""


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_date(value: str) -> Optional[datetime]:
    value = (value or "").strip()
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except Exception:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalize_url(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    parts = urlparse(value)
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith("utm_")
        and k.lower() not in {"cmpid", "mod", "ref", "source"}
    ]
    return urlunparse(parts._replace(query=urlencode(query), fragment=""))


def _clean_html(value: str) -> str:
    if not value:
        return ""
    soup = BeautifulSoup(value, "html.parser")
    return _clean_text(soup.get_text(" ", strip=True))


def _clean_text(value: str) -> str:
    value = html.unescape(value or "")
    value = re.sub(r"\s+", " ", value)
    return value.strip()
