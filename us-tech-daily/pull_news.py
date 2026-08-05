"""Same-session news pull for the section-4 catalyst attribution (US or Asia — kinds.py).

Uses the vendored scraper (vendor/news_fetcher.py, falling back to emailai's copy if that
vendored file is missing — see kinds.py) directly: its RSS parsing, article-body
extraction, finance triage and dedupe are already tuned. Writes nothing to a database;
headlines and bodies go through store.py (local data/news_{DATE}.json, or Mongo) for the
attribution pass to read.

Every headline is matched against the kind's locked universe (plus company aliases) so the
section-4 write-up starts from an evidence list per mover instead of from memory. A
mover with no in-window evidence must be labelled beta in the report, never invented.
"""

from __future__ import annotations

import argparse
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import kinds
import store
from kinds import fetch_top_news

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
    # Asia universe aliases.
    "2330.TW": ["TSMC", "Taiwan Semiconductor"], "2317.TW": ["Hon Hai", "Foxconn"],
    "2454.TW": ["MediaTek"], "2382.TW": ["Quanta Computer"], "6669.TW": ["Wiwynn"],
    "2308.TW": ["Delta Electronics"], "3711.TW": ["ASE Technology"],
    "2327.TW": ["Yageo"], "042700.KS": ["Hanmi Semiconductor"],
    "8035.T": ["Tokyo Electron"], "6857.T": ["Advantest"], "6146.T": ["Disco Corp", "DISCO"],
    "7735.T": ["SCREEN Holdings"], "6920.T": ["Lasertec"], "5803.T": ["Fujikura"],
    "0981.HK": ["SMIC", "Semiconductor Manufacturing International"],
    "1347.HK": ["Hua Hong Semiconductor", "Hua Hong"], "0700.HK": ["Tencent"],
    "9988.HK": ["Alibaba"], "1810.HK": ["Xiaomi"],
    "002371.SZ": ["NAURA", "Naura Technology"],
    "688012.SS": ["AMEC", "Advanced Micro-Fabrication Equipment"],
    "300308.SZ": ["Zhongji Innolight", "Innolight"], "601138.SS": ["Foxconn Industrial Internet", "FII"],
}

# Supply-chain universe (universe_chain.py). Numeric tickers never match a headline on
# their own — _matchers only builds a bare-word pattern for alphabetic symbols — so every
# non-US name here needs the English name the wires actually print. Same rule as above:
# only aliases whose mention is unambiguous. Dual listings (SG Micro, Luxshare, Woer,
# GigaDevice, Montage, Shengyi, Dtech, Delton, Victory Giant, OmniVision, Huaqin, Three-
# Circle) deliberately share one alias set across both lines — a headline about the
# company is evidence for both, and the report shows them as separate rows anyway.
ALIASES.update({
    # 模拟与功率
    "3661.HK": ["SG Micro"], "300661.SZ": ["SG Micro"],
    "0580.HK": ["Sun.King", "Sun King Technology"], "2577.HK": ["InnoScience"],
    "2726.HK": ["Epiworld"], "000811.SZ": ["Moon Environment"],
    "002851.SZ": ["Megmeet"], "300870.SZ": ["Honor Electronic"],
    "002837.SZ": ["Envicool"], "6963.T": ["ROHM", "Rohm Co"],
    "6723.T": ["Renesas"], "RNECY": ["Renesas"],
    "POWI": ["Power Integrations"], "AVT": ["Avnet"], "ARW": ["Arrow Electronics"],
    "NVTS": ["Navitas"], "TXN": ["Texas Instruments"], "NXPI": ["NXP Semiconductors", "NXP"],
    "MCHP": ["Microchip Technology"], "STM": ["STMicroelectronics"],
    "IFNNY": ["Infineon"], "DIOD": ["Diodes Incorporated"],
    "AOSL": ["Alpha and Omega Semiconductor"],
    # 线缆与连接
    "2475.HK": ["Luxshare"], "002475.SZ": ["Luxshare"],
    "9981.HK": ["Woer Heat-Shrinkable", "Woer"], "002130.SZ": ["Woer Heat-Shrinkable", "Woer"],
    "1729.HK": ["Time Interconnect"], "6088.HK": ["FIT Hon Teng"],
    "TEL": ["TE Connectivity"],
    # 下游与组件
    "6613.HK": ["Lens Technology"], "2382.HK": ["Sunny Optical"],
    "1415.HK": ["Cowell e Holdings", "Cowell"], "3296.HK": ["Huaqin"], "603296.SS": ["Huaqin"],
    "0285.HK": ["BYD Electronic"], "0992.HK": ["Lenovo"],
    "688036.SS": ["Transsion"], "FLEX": ["Flex Ltd", "Flextronics"], "HPQ": ["HP Inc"],
    "CLS": ["Celestica"], "SANM": ["Sanmina"], "JBL": ["Jabil"],
    # 半导体设备
    "0522.HK": ["ASMPT", "ASM Pacific"], "688082.SS": ["ACM Research"],
    "688808.SS": ["Semight"], "6590.T": ["Shibaura Mechatronics"],
    "6857.T": ["Advantest"], "ATEYY": ["Advantest"],
    "BESIY": ["BE Semiconductor", "Besi"], "VECO": ["Veeco"],
    "UCTT": ["Ultra Clean Holdings"], "MKSI": ["MKS Instruments", "MKS Inc"],
    "AEIS": ["Advanced Energy Industries"], "AEHR": ["Aehr Test"],
    "NVMI": ["Nova Ltd"], "CAMT": ["Camtek"],
    # IC 设计
    "0501.HK": ["OmniVision"], "603501.SS": ["OmniVision", "Will Semiconductor"],
    "6082.HK": ["Biren"], "300782.SZ": ["Maxscend"],
    "688795.SS": ["Moore Threads"], "688802.SS": ["MetaX"],
    "688041.SS": ["Hygon"], "688256.SS": ["Cambricon"],
    "CBRS": ["Cerebras"], "LSCC": ["Lattice Semiconductor"], "MXL": ["MaxLinear"],
    "SWKS": ["Skyworks"], "QRVO": ["Qorvo"],
    # 存储
    "6809.HK": ["Montage Technology"], "688008.SS": ["Montage Technology"],
    "3986.HK": ["GigaDevice"], "603986.SS": ["GigaDevice"],
    "001309.SZ": ["Techwinsemi"], "688825.SS": ["CXMT", "ChangXin Memory"],
    "688766.SS": ["Puya Semiconductor"], "688525.SS": ["Biwin", "BIWIN Storage"],
    "301666.SZ": ["DapuStor"], "301308.SZ": ["Longsys"],
    "285A.T": ["Kioxia"], "KXIAY": ["Kioxia"], "SKHY": ["SK Hynix", "SK hynix"],
    # DRAM is bare-match suppressed (see NO_BARE_MATCH), so the fund name is its only hook.
    "DRAM": ["Roundhill Memory"],
    "SIMO": ["Silicon Motion"], "SNDK": ["Sandisk", "SanDisk"],
    "009150.KS": ["Samsung Electro-Mechanics"],
    # MLCC 与被动元件
    "6951.HK": ["Three-Circle", "CCTC"], "300408.SZ": ["Three-Circle", "CCTC"],
    "0117.HK": ["Tianli Holdings"], "002975.SZ": ["Bojay"],
    "300975.SZ": ["Sunlord"], "002138.SZ": ["Sunlord"],
    "002859.SZ": ["Jiemei"], "605376.SS": ["Boqian New Materials"],
    "002484.SZ": ["Jianghai Capacitor"], "000636.SZ": ["Fenghua Advanced"],
    "6245.T": ["Hirano Tecseed"], "6762.T": ["TDK"], "6981.T": ["Murata"],
    "6976.T": ["Taiyo Yuden"],
    # 封测与测试
    "688820.SS": ["SJ Semiconductor"], "688362.SS": ["Forehope"],
    "002185.SZ": ["Huatian Technology"], "688661.SS": ["UIGreen"],
    "002156.SZ": ["Tongfu Microelectronics"], "600584.SS": ["JCET"],
    "FORM": ["FormFactor"], "AMKR": ["Amkor"],
    # PCB 产业链
    "1377.HK": ["Dtech"], "301377.SZ": ["Dtech"],
    "2476.HK": ["Victory Giant"], "300476.SZ": ["Victory Giant"],
    "1989.HK": ["Delton Technology"], "001389.SZ": ["Delton Technology"],
    "600183.SS": ["Shengyi Technology"], "688183.SS": ["Shengyi Electronics"],
    "3200.HK": ["Han's CNC"], "002008.SZ": ["Han's Laser"],
    "1888.HK": ["Kingboard Laminates"], "301526.SZ": ["Polycomp"],
    "002080.SZ": ["Sinoma Science"], "600176.SS": ["China Jushi"],
    "301511.SZ": ["Defu Technology"], "603256.SS": ["Grace Fabric"],
    "688603.SS": ["Skychem"], "000657.SZ": ["China Tungsten"],
    "300395.SZ": ["Feilihua"], "002436.SZ": ["Fastprint"],
    "688020.SS": ["Fangbang"], "002938.SZ": ["Avary Holding", "Avary"],
    "688630.SS": ["Circuit Fabology"], "301217.SZ": ["Tongguan Copper Foil"],
    "002203.SZ": ["Hailiang"], "002384.SZ": ["Dongshan Precision"],
    "002916.SZ": ["Shennan Circuits"], "603228.SS": ["Kinwong"],
    "002463.SZ": ["Wus Printed Circuit", "WUS"],
    "6752.T": ["Panasonic"], "4182.T": ["Mitsubishi Gas Chemical"],
    "4004.T": ["Resonac"], "2802.T": ["Ajinomoto"], "3110.T": ["Nitto Boseki"],
    "6278.T": ["Union Tool"], "5801.T": ["Furukawa Electric"],
    "5706.T": ["Mitsui Kinzoku", "Mitsui Mining & Smelting"],
    # M7 与 AI 权重 additions
    "GOOG": ["Alphabet", "Google"], "SPCX": ["SpaceX", "Space Exploration Technologies"],
})

# Symbols whose bare-ticker pattern would match ordinary industry prose rather than the
# instrument. DRAM is the whole point: as a ticker it is one memory ETF, but as a word it
# appears in every memory headline the report pulls, which would attach the sector's news
# to a single fund and starve the names that actually made it. These match on alias only.
NO_BARE_MATCH = {"DRAM"}

# Korea sub-layer names carry their own headline evidence.
KOREA_ALIASES = {
    "005930.KS": ["Samsung Electronics", "Samsung"],
    "000660.KS": ["SK Hynix", "SK hynix"],
    "^KS11": ["Kospi", "KOSPI"],
}


def _matchers(symbol: str, aliases: list[str]) -> list[re.Pattern]:
    out = []
    if symbol.isalpha() and len(symbol) >= 2 and symbol not in NO_BARE_MATCH:
        # Ticker form: bare word, or the "(TICK)" / "$TICK" conventions.
        out.append(re.compile(rf"(?<![A-Za-z]){re.escape(symbol)}(?![A-Za-z])"))
    for alias in aliases:
        # Anchored on word boundaries, not a bare substring: "Avary" otherwise matches
        # inside "Savary", "Besi" inside "besides", and "Meta" inside "MetaX" — each of
        # which attaches a real headline to the wrong company, which is exactly the
        # invented catalyst the report's evidence rule exists to prevent.
        out.append(re.compile(rf"(?<!\w){re.escape(alias.strip())}(?!\w)", re.I))
    return out


def _in_window(published: datetime | None, session: date, lookback_hours: int,
                tz: ZoneInfo, open_time: tuple[int, int]) -> bool:
    if published is None:
        return False
    # Window closes at the next local open so post-close catalysts land in the right session.
    hour, minute = open_time
    close = datetime.combine(session + timedelta(days=1), time(hour, minute), tzinfo=tz)
    return (close - timedelta(hours=lookback_hours)) <= published.astimezone(tz) <= close


def pull(session: date, kind: str, max_articles: int, per_source_limit: int, lookback_hours: int) -> dict:
    k = kinds.get(kind)
    articles = fetch_top_news(max_articles=max_articles, per_source_limit=per_source_limit,
                               sources=k.news_sources)

    targets = {t: ALIASES.get(t, []) for t in k.universe.locked_universe()}
    # The anchor layer sits outside the locked universe but still gets a §4 write-up, so
    # it needs its own evidence — whichever layer this kind's universe happens to anchor
    # on (Korea for us, US mega-caps for asia, Taiwan for chain).
    targets.update({sym: ALIASES.get(sym, []) for sym, _ in k.universe.KOREA_ANCHORS})
    targets.update(KOREA_ALIASES)
    patterns = {sym: _matchers(sym, aliases) for sym, aliases in targets.items()}

    rows, by_ticker, out_of_window = [], {}, 0
    for article in articles:
        in_window = _in_window(article.published_at, session, lookback_hours, k.tz, k.open_time)
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
        "kind": kind,
        "pulled_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "scraper": "vendor/news_fetcher.py (fetch_top_news)",
        "window": {
            "lookback_hours": lookback_hours,
            "closes_at": datetime.combine(session + timedelta(days=1),
                                           time(*k.open_time), tzinfo=k.tz).isoformat(),
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
    parser.add_argument("--kind", default="us", choices=sorted(kinds.KINDS), help="us | asia")
    parser.add_argument("--max-articles", type=int, default=120)
    parser.add_argument("--per-source-limit", type=int, default=25)
    parser.add_argument("--lookback-hours", type=int, default=36)
    args = parser.parse_args()

    payload = pull(
        date.fromisoformat(args.date),
        args.kind,
        args.max_articles,
        args.per_source_limit,
        args.lookback_hours,
    )

    store.write_json("news", args.kind, payload["session"], payload)

    c = payload["counts"]
    print(f"[{args.kind}] session {payload['session']}: {c['articles']} articles, {c['in_window']} in window, "
          f"{c['tickers_with_evidence']} universe names with evidence")
    for sym, items in sorted(payload["by_ticker"].items(), key=lambda kv: -len(kv[1])):
        print(f"  {sym:<10} {len(items)}  {items[0]['title'][:80]}")
    print(f"wrote news doc ({store.mode()} mode, kind={args.kind}, session={payload['session']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
