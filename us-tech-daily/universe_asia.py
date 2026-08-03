"""Asia tech sector review universe: mirrors universe.py's public API exactly (SECTORS,
STANDALONE_SECTORS, INDICES, KOREA_ANCHORS, thresholds, locked_universe(),
all_quote_symbols()) so aggregate.py and render_report.py work against this module with
no code change — only kinds.py picks which universe module a run uses.

Coverage: Taiwan (.TW), Korea (.KS), Japan (.T), Hong Kong (.HK), and China A-shares
(.SS/.SZ) — the five venues that have just closed by 18:00 HKT. The KOREA_ANCHORS name is
kept for code compatibility with aggregate.py/render_report.py's Korea-specific fields;
here it holds the three US AI mega-caps (NVDA/AMD/AVGO) that Asia's session is reacting to
overnight — displayed but, like the US report's Korea anchors, excluded from the
equal-weight. See ANCHOR_LABEL / ANCHOR_HEADER_LABEL for the Chinese labels that follow.

THIS IS A STARTING LOCK, NOT A FROZEN ONE. Per the rollout plan: run
`pull_global_eod.py --kind asia` once and check the fill rate before treating this list as
authoritative — Asian tickers change suffix and delist more often than US ones.
"""

from __future__ import annotations

# Ordered: section 3.1 ... 3.12. Order of the dict is the order of the 3.x subsections.
SECTORS: dict[str, list[str]] = {
    "晶圆代工": ["2330.TW", "0981.HK", "1347.HK"],
    "存储": ["005930.KS", "000660.KS"],
    "半导体设备": ["8035.T", "6857.T", "6146.T", "7735.T", "6920.T", "042700.KS"],
    "封测/基板": ["3711.TW"],
    "光模块/CPO": ["300308.SZ"],
    "服务器/EMS": ["2317.TW", "2382.TW", "6669.TW", "601138.SS"],
    "网络/连接器": ["5803.T"],
    "面板/被动元件": ["2327.TW"],
    "互联网平台": ["0700.HK", "9988.HK"],
    "电力/散热": ["2308.TW"],
    "消费电子/终端": ["1810.HK"],
    "中国自主可控": ["002371.SZ", "688012.SS"],
}

# Sub-sectors whose equal-weight mean is reported separately rather than folded into the
# "AI full supply chain" read (still inside the locked universe, still in section 2).
STANDALONE_SECTORS = {"中国自主可控", "消费电子/终端"}

INDICES: list[tuple[str, str]] = [
    ("^TWII", "TAIEX (^TWII)"),
    ("^KS11", "KOSPI (^KS11)"),
    ("^N225", "Nikkei 225 (^N225)"),
    ("^HSI", "Hang Seng (^HSI)"),
    ("000300.SS", "CSI 300 (000300.SS)"),
]

# See module docstring: this is the "overnight US read" layer, not Korea — kept under the
# KOREA_* names purely so aggregate.py/render_report.py need no branch for it.
KOREA_ANCHORS: list[tuple[str, str]] = [
    ("NVDA", "Nvidia NVDA"),
    ("AMD", "AMD AMD"),
    ("AVGO", "Broadcom AVGO"),
]

# Trigger: if Nvidia's overnight move breaches this, section 1 must carry the 3-point
# US-anchor sub-layer with hard numbers (same role SK Hynix plays in the US report).
KOREA_TRIGGER_TICKER = "NVDA"
KOREA_TRIGGER_ABS_PCT = 3.0

HIGHLIGHT_ABS_PCT = 2.5   # 高亮 threshold
EXTREME_ABS_PCT = 5.0     # 极端 threshold

ANCHOR_LABEL = "美股锚"
ANCHOR_HEADER_LABEL = "美股锚（非成分股）"


def locked_universe() -> list[str]:
    """The de-duplicated names this report claims to lock."""
    seen: dict[str, None] = {}
    for names in SECTORS.values():
        for name in names:
            seen.setdefault(name, None)
    return list(seen)


def all_quote_symbols() -> list[str]:
    """Every symbol the EOD pull needs: locked names + indices + US anchors."""
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
