"""Export the rendered report to Markdown and/or PDF.

Both exports come off the same two inputs the HTML uses (agg + narrative), so the three
formats can never disagree about a number.

  Markdown  built from the data directly — pipe tables, `==highlight==` marks, real
            links. Diffable, and the natural format to hand-edit a narrative in.
  PDF       printed from the rendered HTML through Playwright, so it is the page as
            designed rather than a second re-implementation of the layout.

Usage:
    python export_report.py --date 2026-07-30            # both
    python export_report.py --date 2026-07-30 --md       # markdown only
    python export_report.py --date 2026-07-30 --pdf      # pdf only
"""

from __future__ import annotations

import argparse
import html as html_mod
import json
import re
from datetime import date
from pathlib import Path

import render_report as R

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
NARRATIVE_DIR = ROOT / "narrative"
REPORT_DIR = ROOT / "reports"


# ---------------------------------------------------------------- inline markup

def md(fragment: str) -> str:
    """Inline HTML from the narrative -> Markdown.

    `==text==` is the highlight convention these reports are authored in; it survives
    round-tripping back into the HTML renderer's <mark>.
    """
    s = fragment
    s = re.sub(r'<a href="([^"]+)">(.*?)</a>', r"[\2](\1)", s, flags=re.S)
    s = re.sub(r"<mark>(.*?)</mark>", r"==\1==", s, flags=re.S)
    s = re.sub(r"<b>(.*?)</b>", r"**\1**", s, flags=re.S)
    s = re.sub(r"<code>(.*?)</code>", r"`\1`", s, flags=re.S)
    # Colour spans carry emphasis, not meaning — keep the emphasis, drop the colour.
    s = re.sub(r'<span class="c-[a-z]+">(.*?)</span>', r"**\1**", s, flags=re.S)
    s = re.sub(r'<span[^>]*>(.*?)</span>', r"\1", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    s = html_mod.unescape(s)
    return re.sub(r"[ \t]+", " ", s).strip()


def pct(value: float | None, bold: bool = False) -> str:
    if value is None:
        return "—"
    txt = f"{value:+.2f}%".replace("-", "−")
    return f"**{txt}**" if bold else txt


def table(headers: list[str], rows: list[list[str]], right: set[int] = frozenset()) -> str:
    sep = ["---:" if i in right else "---" for i in range(len(headers))]
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(sep) + " |"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- markdown build

def build_markdown(agg: dict, nar: dict) -> str:
    u = agg["universe"]
    out: list[str] = []
    w = out.append

    w(f'# {nar["title"]}\n')
    w(f'> {agg["session"]} ET · {u["locked_n"]} 票 + {len(agg["indices"])} 指数 · '
      f'{u["sectors_total"]} 子赛道 · {nar["subtitle_extra"]}\n')
    w(f'> **⚡ 关键信号** — {md(nar["key_signal"])}\n')

    # -- §1
    w("## §1 当日大势\n")
    w(table(["指数", "收盘", "pct"],
            [[i["label"], f'{i["close"]:,.2f}', pct(i["pct"], True)] for i in agg["indices"]],
            right={1, 2}))
    w(f'**rotation 叙事**：{md(nar["s1"]["rotation"])}\n')
    w("**宏观三层底色**：\n")
    for n, layer in enumerate(nar["s1"]["macro_layers"], 1):
        w(f'{n}. {layer["icon"]} **{layer["label"]}**：{md(layer["body"])}\n')
    k = nar["s1"]["korea"]
    w(f'**{k["heading"]}**{md(k["lead"])}\n')
    for n, point in enumerate(k["points"], 1):
        w(f"{n}. {md(point)}\n")
    w(f'{md(k["stabilizer"])}\n')
    w(f'{md(k["sources"])}\n')
    w(f'{md(nar["s1"]["stacking"])}\n')
    w(f'{md(nar["s1"]["mechanical"])}\n')

    # -- §2
    w("## §2 板块速览（涨方 ↑ / 跌方 ↓ 双向）\n")
    rows = [[s["name"], str(s["n"]), pct(s["mean_pct"], s is agg["sectors"][0]),
             f'{s["up"]}/{s["down"]}', str(s["highlight_n"]), str(s["extreme_n"]), s["direction"]]
            for s in agg["sectors"]]
    kk = agg["korea"]
    rows.append(["**韩国锚（非 92 票）**", str(len(kk["rows"])), pct(kk["mean_pct"], True),
                 f'{kk["up"]}/{kk["down"]}', str(kk["highlight_n"]), str(kk["extreme_n"]), "↓"])
    w(table(["板块", "n", "等权均 pct", "上涨/下跌", "高亮", "极端", "方向"], rows,
            right={1, 2, 3, 4, 5}))
    w(f'{md(nar["s2_note"])}\n')

    # -- §3
    w(f'## §3 个股表 × {u["sectors_total"]} 子赛道\n')
    by_name = {s["name"]: s for s in agg["sectors"]}
    for i, name in enumerate(agg["sectors_ordered"], 1):
        s = by_name[name]
        suffix = "（拆 9 子链）" if name == "半导体硬件扩展" else ""
        w(f"### 3.{i} {name}{suffix}\n")
        rows = [[r["ticker"], f'{r["close"]:,.2f}',
                 pct(r["pct"], j in (0, len(s["rows"]) - 1)),
                 f'{r["dollar_volume_b"]:,.2f}' if r["dollar_volume_b"] is not None else "—",
                 pct(r["dist_52w_high_pct"]),
                 "★" if r["highlight"] else "", "●" if r["extreme"] else ""]
                for j, r in enumerate(s["rows"])]
        w(table(["Ticker", "收盘", "pct", "成交额(B$)", "距 52w 高", "高亮", "极端"],
                rows, right={1, 2, 3, 4}))
        if note := nar["s3_notes"].get(name):
            w(f"{md(note)}\n")
        for chain in nar.get("s3_chains", {}).get(name, []):
            w(f"- {md(chain)}\n")
        if nar.get("s3_chains", {}).get(name):
            w("")

    # -- §4
    w("## §4 高亮归因（聚焦 Top ~30 · 极端票 + 反向代表）\n")
    w(f'> {md(nar["s4_intro"])}\n')
    quotes = {r["ticker"]: r for r in agg["movers"]}
    for r in agg["korea"]["rows"]:
        quotes.setdefault(r["ticker"], r)
    for e in nar["s4"]:
        q = quotes.get(e["ticker"], {})
        close = f'{q["close"]:,.2f}' if q.get("close") is not None else "—"
        vol = q.get("dollar_volume_b")
        meta = (f"收 {close}" if e.get("tag") == "韩国锚"
                else f'收 {close} · 成交 {vol:,.2f}B$' if vol is not None else f"收 {close}")
        tag = f'｜{e["tag"]}' if e.get("tag") else ""
        srcs = " · ".join(f'[{s["label"]}]({s["url"]})' for s in e["sources"])
        w(f'### {e["name"]} {pct(q.get("pct"), True)}（{meta}）{tag}\n')
        w(f'- **catalyst**：{md(e["catalyst"])}')
        w(f'- **板块共振**：{md(e["resonance"])}')
        w(f"- **来源**：{srcs}\n")

    # -- §5
    w("## §5 主题强度双向 TOP3\n")
    for heading, key in (("§5.1 涨方 TOP3", "up_themes"), ("§5.2 反向 TOP3", "down_themes")):
        w(f"### {heading}\n")
        for t in nar["s5"][key]:
            w(f'#### {md(t["title"])}\n')
            for label, text in t["rows"]:
                w(f"- **{label}**：{md(text)}")
            w("")
    w("### §5.3 一句话 rotation 总结\n")
    w(f'{md(nar["s5"]["one_liner"])}\n')

    # -- §6
    w("## §6 A 股映射（按主题 · 共振强度评级）\n")
    for sec in nar["s6"]["sections"]:
        w(f'### {md(sec["title"])}\n')
        w(table(["方向", "标的（仅作方向）", "映射逻辑", "共振强度"],
                [[md(c) for c in row] for row in sec["rows"]]))
    w("### 6.7 §6 总结对照表\n")
    w(table(["美股主题", "共振强度", "最直接 A/H 股映射"],
            [[md(c) for c in row] for row in nar["s6"]["summary_table"]]))
    w(f'{md(nar["s6"]["caveat"])}\n')

    # -- §7
    w("## §7 数据说明\n")
    for note in nar["s7_notes"]:
        w(f"- {md(note)}")
    w("")

    stamp = date.fromisoformat(agg["session"]).strftime("%y%m%d")
    w("---\n")
    w(f'*{stamp}-市场-美股科技板块复盘 · {nar["framework"]}*  ')
    w(f'*yfinance EOD + RSS 新闻抓取 + WebSearch · {nar["vault"]}*')

    return "\n".join(out).replace("\n\n\n", "\n\n") + "\n"


# ---------------------------------------------------------------- pdf

# Print-only overrides: the screen layout is a single tall column on a tinted page,
# which wastes a third of every sheet and splits tables across page breaks.
PRINT_CSS = """
@page{size:A4;margin:14mm 12mm}
body{background:#fff;font-size:10.5pt}
.wrap{max-width:none}
.banner{padding:22px 24px;border-radius:0}
.banner h1{font-size:22pt}.banner .pill{margin-bottom:12px;font-size:9pt}
.banner .sub{font-size:9.5pt}
.body{padding:16px 4px 0}
h1.page{display:none}
.sec{box-shadow:none;border:1px solid #e3e8f0;margin-bottom:16px;break-inside:auto}
.sec>.hd{padding:12px 16px;break-after:avoid}
.sec>.hd .num{width:38px;height:38px;font-size:12pt}
.sec>.hd h2{font-size:15pt}
.sec>.bd{padding:16px}
h3,h4{break-after:avoid}
h3{font-size:12.5pt;margin-top:20px}h4{font-size:11pt}
table{font-size:9pt;break-inside:auto}
thead{display:table-header-group}
tr{break-inside:avoid}
th,td{padding:6px 8px}
.mv{break-inside:avoid}
.callout{break-inside:avoid;margin-bottom:20px}
.foot{border-radius:0;padding:16px}
a{text-decoration:none}
"""


def export_pdf(html_path: Path, out: Path) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(html_path.resolve().as_uri())
        page.add_style_tag(content=PRINT_CSS)
        page.emulate_media(media="print")
        page.wait_for_timeout(400)
        page.pdf(path=str(out), format="A4", print_background=True,
                 margin={"top": "14mm", "bottom": "14mm", "left": "12mm", "right": "12mm"})
        browser.close()


# ---------------------------------------------------------------- cli

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True)
    parser.add_argument("--md", action="store_true", help="markdown only")
    parser.add_argument("--pdf", action="store_true", help="pdf only")
    args = parser.parse_args()

    want_md = args.md or not args.pdf
    want_pdf = args.pdf or not args.md

    agg = json.loads((DATA_DIR / f"agg_{args.date}.json").read_text(encoding="utf-8"))
    nar = json.loads((NARRATIVE_DIR / f"{args.date}.json").read_text(encoding="utf-8"))
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    if want_md:
        out = REPORT_DIR / f"{args.date}_us_tech_daily.md"
        out.write_text(build_markdown(agg, nar), encoding="utf-8")
        print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")

    if want_pdf:
        html_path = REPORT_DIR / f"{args.date}_us_tech_daily.html"
        if not html_path.exists():
            html_path.write_text(R.render(agg, nar), encoding="utf-8")
            print(f"wrote {html_path} (regenerated for PDF)")
        out = REPORT_DIR / f"{args.date}_us_tech_daily.pdf"
        export_pdf(html_path, out)
        print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
