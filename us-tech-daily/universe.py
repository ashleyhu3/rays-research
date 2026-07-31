"""US tech sector review universe: 92 tickers x 12 sub-sectors, 3 indices, 3 Korea anchors.

The 92-name lock is the report's headline coverage claim, so the lists here are the
single source of truth for both the EOD pull and the section-3 tables. Korea anchors are
pulled and displayed but deliberately excluded from the 92-name equal-weight averages.
"""

from __future__ import annotations

# Ordered: section 3.1 ... 3.12. Order of the dict is the order of the 3.x subsections.
SECTORS: dict[str, list[str]] = {
    "MAG7": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"],
    "半导体核心": ["AMD", "AVGO", "TSM", "ARM", "MRVL", "MU"],
    "半导体硬件扩展": [
        "ASML", "AMAT", "LRCX", "KLAC", "TER", "INTC", "GFS", "ON", "ADI", "MPWR",
        "QCOM", "STX", "WDC", "SNDK", "RMBS", "VSH", "VICR", "TTMI", "ASX", "WOLF",
    ],
    "光通讯": ["COHR", "LITE", "AAOI", "CRDO", "CIEN", "FN", "GLW", "SMTC", "TSEM", "AXTI"],
    "AI 服务器/EMS": ["DELL", "SMCI", "HPE"],
    "AI 网络设备": ["ANET", "ALAB", "APH", "CSCO"],
    "AI infra/SaaS": [
        "ORCL", "PLTR", "SNOW", "DDOG", "NET", "CRWD", "NOW", "CRM", "APP", "TEM",
        "NBIS", "CRWV",
    ],
    "AI 电力 baseload": [
        "GEV", "VRT", "ETN", "PWR", "NRG", "VST", "CEG", "NEE", "OKLO", "SMR",
        "NNE", "BE", "FLNC",
    ],
    "数据中心 REIT": ["EQIX", "DLR", "GDS", "VNET"],
    "AI 量子/边缘": ["IONQ", "RGTI", "QBTS"],
    "前沿科技/流动性敏感": ["COIN", "HOOD", "MSTR", "RKLB", "ASTS", "JOBY", "PONY", "MBLY"],
    "中概 AI mega": ["BABA", "BIDU"],
}

# Sub-sectors whose equal-weight mean is reported separately rather than folded into the
# "AI full supply chain" read (still inside the 92, still in section 2).
STANDALONE_SECTORS = {"前沿科技/流动性敏感", "中概 AI mega"}

INDICES: list[tuple[str, str]] = [
    ("^NDX", "Nasdaq 100 (^NDX)"),
    ("^GSPC", "S&P 500 (^GSPC)"),
    ("^SOX", "Philadelphia Semi (^SOX)"),
]

# Korea sub-layer. Not counted in the 92 and not in the sector equal-weight averages.
KOREA_ANCHORS: list[tuple[str, str]] = [
    ("^KS11", "KOSPI (^KS11)"),
    ("005930.KS", "Samsung 005930.KS"),
    ("000660.KS", "SK Hynix 000660.KS"),
]

# Korea trigger: if the SK Hynix daily move breaches this, section 1 must carry the
# 3-point Korea sub-layer with hard numbers.
KOREA_TRIGGER_TICKER = "000660.KS"
KOREA_TRIGGER_ABS_PCT = 3.0

HIGHLIGHT_ABS_PCT = 2.5   # 高亮 threshold
EXTREME_ABS_PCT = 5.0     # 极端 threshold


def locked_universe() -> list[str]:
    """The 92 de-duplicated names the report claims to lock."""
    seen: dict[str, None] = {}
    for names in SECTORS.values():
        for name in names:
            seen.setdefault(name, None)
    return list(seen)


def all_quote_symbols() -> list[str]:
    """Every symbol the EOD pull needs: 92 names + 3 indices + 3 Korea anchors."""
    out = locked_universe()
    out += [sym for sym, _ in INDICES]
    out += [sym for sym, _ in KOREA_ANCHORS]
    return out


if __name__ == "__main__":
    locked = locked_universe()
    print(f"sub-sectors: {len(SECTORS)}")
    print(f"locked names: {len(locked)}")
    for name, members in SECTORS.items():
        print(f"  {name:<24} {len(members):>3}")
    print(f"quote symbols: {len(all_quote_symbols())}")
