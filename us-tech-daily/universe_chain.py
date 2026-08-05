"""Global AI-hardware supply-chain universe: mirrors universe.py's public API exactly
(SECTORS, STANDALONE_SECTORS, INDICES, KOREA_ANCHORS, thresholds, locked_universe(),
all_quote_symbols()) so aggregate.py and render_report.py work against this module with no
code change — only kinds.py picks which universe module a run uses.

Unlike the `us` and `asia` universes, this one is cut by **supply-chain segment** rather
than by venue: one sector holds the HK line, the A-share line, the Japan line and the US
line of the same tier, so a segment's equal-weight mean reads across all six venues at
once. Coverage: US, Hong Kong, China A (Shanghai + Shenzhen), Japan, Korea — plus Taiwan
at the index and anchor layer (see TAIWAN_ANCHORS below).

Three things follow from being multi-venue that the single-venue universes never had to
deal with, and each is opt-in via a module attribute the shared code reads with getattr,
so `us` and `asia` behave exactly as before:

  NAMES        §3/§4 tables print "300661.SZ" otherwise, which is unreadable for a mostly
               numeric-ticker universe. render_report/export_report look this up.
  fx_pair()    dollar volume is close x volume, and close is in the listing currency. A
               KRW or JPY figure under a "成交额(B$)" header is not a small error, it is
               three orders of magnitude. pull_global_eod converts via these pairs.
  SLOT_PROBE   this universe trades in both the us-close and asia-close windows, so
               session.py's freshness probe has to be per-slot rather than INDICES[0].

Ticker suffix mapping from the source sector CSVs to Yahoo symbols:
  .US -> bare      .HK -> 4-digit zero-padded .HK    .SH -> .SS    .SZ -> .SZ
  .JP -> .T        .KR -> .KS
Every symbol below was probed against Yahoo on 2026-08-04 and resolved to the intended
company. Names appear in more than one sector on purpose (VRT, KLAC, TER, NVDA, AAPL,
AVGO, MU, 002475.SZ...) — locked_universe() de-duplicates, so the headline count is names,
while each sector's equal-weight mean still sees every one of its own members.
"""

from __future__ import annotations

# Ordered: section 3.1 ... 3.10. Order of the dict is the order of the 3.x subsections.
SECTORS: dict[str, list[str]] = {
    "M7 与 AI 权重": [
        "MU", "SPCX", "TSM", "TSLA", "AMZN", "MSFT", "AAPL", "META", "GOOG", "NVDA", "AVGO",
    ],
    "IC 设计": [
        "0501.HK", "6082.HK", "603501.SS", "300782.SZ", "688795.SS", "688802.SS",
        "688041.SS", "688256.SS", "QCOM", "CBRS", "LSCC", "MXL", "ARM", "INTC", "NVDA",
        "AVGO", "AMD", "AAPL", "MRVL", "SWKS", "QRVO",
    ],
    "存储": [
        "6809.HK", "3986.HK", "7747.HK", "7709.HK", "000660.KS", "005930.KS", "001309.SZ",
        "688825.SS", "688766.SS", "688008.SS", "688525.SS", "301666.SZ", "301308.SZ",
        "603986.SS", "285A.T", "SKHY", "DRAM", "SIMO", "MU", "SNDK", "WDC", "STX", "RMBS",
        "KXIAY",
    ],
    "半导体设备": [
        "0522.HK", "688082.SS", "688808.SS", "688012.SS", "002371.SZ", "6590.T", "8035.T",
        "6857.T", "BESIY", "VECO", "UCTT", "MKSI", "AEIS", "AEHR", "VIAV", "KEYS", "ASML",
        "LRCX", "AMAT", "KLAC", "TER", "KLIC", "NVMI", "CAMT", "ONTO", "ATEYY",
    ],
    "封测与测试": [
        "688820.SS", "688362.SS", "002185.SZ", "688661.SS", "002156.SZ", "600584.SS",
        "KEYS", "VIAV", "FORM", "CAMT", "KLAC", "KLIC", "ONTO", "TER", "ASX", "AMKR",
    ],
    "模拟与功率": [
        "3661.HK", "0580.HK", "2577.HK", "2726.HK", "300661.SZ", "000811.SZ", "002851.SZ",
        "300870.SZ", "002837.SZ", "6963.T", "6723.T", "POWI", "AVT", "ARW", "VRT", "VICR",
        "NVTS", "TXN", "ADI", "NXPI", "MPWR", "MCHP", "ON", "STM", "IFNNY", "RNECY",
        "DIOD", "AOSL", "VSH", "WOLF",
    ],
    "PCB 产业链": [
        "1377.HK", "2476.HK", "3200.HK", "1989.HK", "1888.HK", "301526.SZ", "002080.SZ",
        "600176.SS", "301511.SZ", "603256.SS", "301377.SZ", "002008.SZ", "688603.SS",
        "000657.SZ", "300395.SZ", "002436.SZ", "001389.SZ", "688020.SS", "002938.SZ",
        "688630.SS", "301217.SZ", "002203.SZ", "600183.SS", "002384.SZ", "688183.SS",
        "002916.SZ", "603228.SS", "002463.SZ", "300476.SZ", "6752.T", "4182.T", "4004.T",
        "2802.T", "3110.T", "6278.T", "5801.T", "5706.T", "TTMI",
    ],
    "MLCC 与被动元件": [
        "6951.HK", "0117.HK", "009150.KS", "002975.SZ", "300975.SZ", "002859.SZ",
        "605376.SS", "002138.SZ", "002484.SZ", "000636.SZ", "300408.SZ", "6245.T",
        "6762.T", "6981.T", "6976.T",
    ],
    "线缆与连接": [
        "2475.HK", "9981.HK", "1729.HK", "6088.HK", "002130.SZ", "002475.SZ", "SMTC",
        "TEL", "APH", "CRDO", "ALAB",
    ],
    "下游与组件": [
        "6613.HK", "2382.HK", "1415.HK", "3296.HK", "0285.HK", "1810.HK", "0992.HK",
        "002475.SZ", "603296.SS", "688036.SS", "601138.SS", "DELL", "FN", "VRT", "CSCO",
        "ANET", "FLEX", "HPQ", "CLS", "SMCI", "SANM", "JBL", "HPE",
    ],
}

# Sub-sectors whose equal-weight mean is reported separately rather than folded into the
# supply-chain read. "M7 与 AI 权重" is index-level demand, not chain supply — letting it
# into the chain average would just re-report the Nasdaq. "下游与组件" is the consumer/
# brand tier, which trades on units rather than on the AI build.
STANDALONE_SECTORS = {"M7 与 AI 权重", "下游与组件"}

# Six venues, so the index block is the report's cross-market backdrop rather than a
# single benchmark. Each market gets its broad benchmark plus its growth/tech benchmark —
# the S&P-500-vs-Nasdaq-100 pair, repeated per market — except Taiwan, which publishes no
# separate tech index on this feed (TAIEX is ~35% TSMC, so it already is the tech read).
#
# Three of those growth benchmarks are held as their tracking fund rather than the index
# itself: Yahoo serves exactly one bar of history for HSTECH.HK, 000688.SS and 399006.SZ
# (re-probed 2026-08-04), and one bar cannot produce a prev_close, so the index line would
# be permanently blank. The funds below track the same indices, carry full history, and
# their daily pct is the index's to within tracking error — but they ARE funds, so label
# them as such in the narrative and never quote one as "the ChiNext closed at".
INDICES: list[tuple[str, str]] = [
    ("^NDX", "Nasdaq 100 (^NDX)"),
    ("^SOX", "Philadelphia Semi (^SOX)"),
    ("^GSPC", "S&P 500 (^GSPC)"),
    ("^HSI", "Hang Seng (^HSI)"),
    ("3033.HK", "Hang Seng TECH tracker (3033.HK ETF)"),
    ("^TWII", "TAIEX (^TWII)"),
    ("000300.SS", "CSI 300 (000300.SS)"),
    ("588000.SS", "STAR 50 tracker (588000.SS ETF)"),
    ("159915.SZ", "ChiNext tracker (159915.SZ ETF)"),
    ("^KS11", "KOSPI (^KS11)"),
    ("^KQ11", "KOSDAQ (^KQ11)"),
    ("^N225", "Nikkei 225 (^N225)"),
]

# session.py probes one index for "has a new bar printed since the last report in this
# slot". This universe trades in both windows, so the probe has to follow the slot: at
# 07:00 HKT the fresh tape is the US one, at 18:00 HKT it is Hong Kong's. Universes
# without this attribute keep using INDICES[0][0].
SLOT_PROBE: dict[str, str] = {
    "us-close": "^NDX",
    "asia-close": "^HSI",
}

# The locked list carries no Taiwan-listed name (it reaches Taiwan through TSM/ASX ADRs
# only), so the anchor layer — the same mechanism the US report uses for Korea — carries
# the three Taiwan lines that actually set the chain's tone. Pulled and displayed, never
# folded into the equal-weight.
TAIWAN_ANCHORS: list[tuple[str, str]] = [
    ("2330.TW", "TSMC 2330.TW"),
    ("2317.TW", "Hon Hai 2317.TW"),
    ("3711.TW", "ASE 3711.TW"),
]
# aggregate.py / render_report.py read the anchor layer under the KOREA_* names (see
# universe_asia.py's docstring for the same aliasing). TAIWAN_ANCHORS is the name to read.
KOREA_ANCHORS = TAIWAN_ANCHORS

# Trigger: if TSMC's Taiwan line breaches this, section 1 must carry the 3-point anchor
# sub-layer with hard numbers (the role SK Hynix plays in the US report).
KOREA_TRIGGER_TICKER = "2330.TW"
KOREA_TRIGGER_ABS_PCT = 3.0

HIGHLIGHT_ABS_PCT = 2.5   # 高亮 threshold
EXTREME_ABS_PCT = 5.0     # 极端 threshold

ANCHOR_LABEL = "台股锚"
ANCHOR_HEADER_LABEL = "台股锚（非成分股）"

# Listing currency -> Yahoo FX pair, keyed by ticker suffix. A bare (US) ticker is already
# USD and has no entry. pull_global_eod.py multiplies dollar volume by the pair's close so
# the §3 "成交额(B$)" column is comparable across all six venues; the 收盘 column stays in
# the listing currency, which is what a local quote means.
FX_PAIR_BY_SUFFIX: dict[str, str] = {
    ".HK": "HKDUSD=X",
    ".SS": "CNYUSD=X",
    ".SZ": "CNYUSD=X",
    ".T": "JPYUSD=X",
    ".KS": "KRWUSD=X",
    ".TW": "TWDUSD=X",
}


def fx_pair(symbol: str) -> str | None:
    """The Yahoo FX pair converting `symbol`'s listing currency to USD, or None if it
    already quotes in USD. Index symbols have no volume worth converting, so they are
    left alone."""
    if symbol.startswith("^") or symbol.endswith("=X"):
        return None
    dot = symbol.rfind(".")
    if dot == -1:
        return None
    return FX_PAIR_BY_SUFFIX.get(symbol[dot:])


# Display names for the §3/§4 tables. A table of bare numeric codes is unreadable, and
# these are the names the sector source lists use.
NAMES: dict[str, str] = {
    # M7 与 AI 权重
    "MU": "美光科技", "SPCX": "SpaceX", "TSM": "台积电", "TSLA": "特斯拉",
    "AMZN": "亚马逊", "MSFT": "微软", "AAPL": "苹果", "META": "Meta",
    "GOOG": "谷歌-C", "NVDA": "英伟达", "AVGO": "博通",
    # IC 设计
    "0501.HK": "豪威集团", "6082.HK": "壁仞科技", "603501.SS": "豪威集团",
    "300782.SZ": "卓胜微", "688795.SS": "摩尔线程-U", "688802.SS": "沐曦股份-U",
    "688041.SS": "海光信息", "688256.SS": "寒武纪", "QCOM": "高通",
    "CBRS": "Cerebras", "LSCC": "莱迪思半导体", "MXL": "MaxLinear",
    "ARM": "Arm Holdings", "INTC": "英特尔", "AMD": "美国超微", "MRVL": "迈威尔科技",
    "SWKS": "思佳讯", "QRVO": "Qorvo",
    # 存储
    "6809.HK": "澜起科技", "3986.HK": "兆易创新", "7747.HK": "南方两倍做多三星电子",
    "7709.HK": "南方两倍做多海力士", "000660.KS": "SK海力士", "005930.KS": "三星电子",
    "001309.SZ": "德明利", "688825.SS": "长鑫科技", "688766.SS": "普冉股份",
    "688008.SS": "澜起科技", "688525.SS": "佰维存储", "301666.SZ": "大普微-UW",
    "301308.SZ": "江波龙", "603986.SS": "兆易创新", "285A.T": "铠侠",
    "SKHY": "SK海力士(US)", "DRAM": "Roundhill Memory ETF", "SIMO": "慧荣科技",
    "SNDK": "闪迪", "WDC": "西部数据", "STX": "希捷科技", "RMBS": "Rambus",
    "KXIAY": "铠侠ADR",
    # 半导体设备
    "0522.HK": "ASMPT", "688082.SS": "盛美上海", "688808.SS": "联讯仪器",
    "688012.SS": "中微公司", "002371.SZ": "北方华创", "6590.T": "芝浦机电",
    "8035.T": "东京电子", "6857.T": "爱德万测试", "BESIY": "BE Semiconductor",
    "VECO": "维易科精密仪器", "UCTT": "超科林半导体", "MKSI": "MKS仪器",
    "AEIS": "先进能源工业", "AEHR": "Aehr Test Systems", "VIAV": "Viavi Solutions",
    "KEYS": "Keysight", "ASML": "阿斯麦", "LRCX": "泛林集团", "AMAT": "应用材料",
    "KLAC": "科磊", "TER": "泰瑞达", "KLIC": "库力索法半导体", "NVMI": "Nova",
    "CAMT": "康特科技", "ONTO": "Onto Innovation", "ATEYY": "爱德万测试ADR",
    # 封测与测试
    "688820.SS": "盛合晶微", "688362.SS": "甬矽电子", "002185.SZ": "华天科技",
    "688661.SS": "和林微纳", "002156.SZ": "通富微电", "600584.SS": "长电科技",
    "FORM": "FormFactor", "ASX": "日月光半导体", "AMKR": "艾马克技术",
    # 模拟与功率
    "3661.HK": "圣邦股份", "0580.HK": "赛晶科技", "2577.HK": "英诺赛科",
    "2726.HK": "瀚天天成", "300661.SZ": "圣邦股份", "000811.SZ": "冰轮环境",
    "002851.SZ": "麦格米特", "300870.SZ": "欧陆通", "002837.SZ": "英维克",
    "6963.T": "罗姆半导体", "6723.T": "瑞萨电子", "POWI": "帕沃英蒂格盛",
    "AVT": "安富利", "ARW": "艾睿", "VRT": "Vertiv", "VICR": "Vicor电子",
    "NVTS": "纳微半导体", "TXN": "德州仪器", "ADI": "亚德诺", "NXPI": "恩智浦",
    "MPWR": "Monolithic Power", "MCHP": "微芯科技", "ON": "安森美半导体",
    "STM": "意法半导体", "IFNNY": "英飞凌ADR", "RNECY": "瑞萨电子ADR",
    "DIOD": "Diodes", "AOSL": "阿尔法和欧米伽半导体", "VSH": "威世科技",
    "WOLF": "Wolfspeed",
    # PCB 产业链
    "1377.HK": "鼎泰高科", "2476.HK": "胜宏科技", "3200.HK": "大族数控",
    "1989.HK": "广合科技", "1888.HK": "建滔积层板", "301526.SZ": "国际复材",
    "002080.SZ": "中材科技", "600176.SS": "中国巨石", "301511.SZ": "德福科技",
    "603256.SS": "宏和科技", "301377.SZ": "鼎泰高科", "002008.SZ": "大族激光",
    "688603.SS": "天承科技", "000657.SZ": "中钨高新", "300395.SZ": "菲利华",
    "002436.SZ": "兴森科技", "001389.SZ": "广合科技", "688020.SS": "方邦股份",
    "002938.SZ": "鹏鼎控股", "688630.SS": "芯碁微装", "301217.SZ": "铜冠铜箔",
    "002203.SZ": "海亮股份", "600183.SS": "生益科技", "002384.SZ": "东山精密",
    "688183.SS": "生益电子", "002916.SZ": "深南电路", "603228.SS": "景旺电子",
    "002463.SZ": "沪电股份", "300476.SZ": "胜宏科技", "6752.T": "松下",
    "4182.T": "三菱瓦斯化学", "4004.T": "Resonac控股", "2802.T": "味之素",
    "3110.T": "日东纺织", "6278.T": "佑能工具", "5801.T": "古河电气工业",
    "5706.T": "三井金属", "TTMI": "TTM科技",
    # MLCC 与被动元件
    "6951.HK": "三环集团", "0117.HK": "天利控股集团", "009150.KS": "三星电机",
    "002975.SZ": "博杰股份", "300975.SZ": "商络电子", "002859.SZ": "洁美科技",
    "605376.SS": "博迁新材", "002138.SZ": "顺络电子", "002484.SZ": "江海股份",
    "000636.SZ": "风华高科", "300408.SZ": "三环集团", "6245.T": "Hirano Tecseed",
    "6762.T": "TDK", "6981.T": "村田制作所", "6976.T": "太阳诱电",
    # 线缆与连接
    "2475.HK": "立讯精密", "9981.HK": "沃尔核材", "1729.HK": "汇聚科技",
    "6088.HK": "鸿腾精密", "002130.SZ": "沃尔核材", "002475.SZ": "立讯精密",
    "SMTC": "先科电子", "TEL": "泰科电子", "APH": "安费诺", "CRDO": "Credo",
    "ALAB": "Astera Labs",
    # 下游与组件
    "6613.HK": "蓝思科技", "2382.HK": "舜宇光学科技", "1415.HK": "高伟电子",
    "3296.HK": "华勤技术", "0285.HK": "比亚迪电子", "1810.HK": "小米集团-W",
    "0992.HK": "联想集团", "603296.SS": "华勤技术", "688036.SS": "传音控股",
    "601138.SS": "工业富联", "DELL": "戴尔科技", "FN": "Fabrinet", "CSCO": "思科",
    "ANET": "Arista Networks", "FLEX": "伟创力", "HPQ": "惠普", "CLS": "天弘科技",
    "SMCI": "超微电脑", "SANM": "新美亚电子", "JBL": "捷普科技", "HPE": "慧与科技",
    # 台股锚
    "2330.TW": "台积电", "2317.TW": "鸿海精密", "3711.TW": "日月光投控",
}


def locked_universe() -> list[str]:
    """The de-duplicated names this report claims to lock."""
    seen: dict[str, None] = {}
    for names in SECTORS.values():
        for name in names:
            seen.setdefault(name, None)
    return list(seen)


def all_quote_symbols() -> list[str]:
    """Every symbol the EOD pull needs: locked names + indices + Taiwan anchors."""
    out = locked_universe()
    out += [sym for sym, _ in INDICES]
    out += [sym for sym, _ in KOREA_ANCHORS]
    return out


if __name__ == "__main__":
    locked = locked_universe()
    print(f"sub-sectors: {len(SECTORS)}")
    print(f"locked names: {len(locked)}")
    for name, members in SECTORS.items():
        print(f"  {name:<18} {len(members):>3}")
    print(f"quote symbols: {len(all_quote_symbols())}")
    missing = [t for t in all_quote_symbols() if t not in NAMES]
    print(f"names missing: {missing}")
    pairs = sorted({fx_pair(t) for t in all_quote_symbols() if fx_pair(t)})
    print(f"fx pairs: {pairs}")
