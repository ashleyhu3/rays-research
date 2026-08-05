"""Render the tech sector review to HTML (US or Asia — see kinds.py).

Numbers come from the agg doc (never retyped by hand); prose and catalyst attribution
come from the narrative doc. Keeping the two apart is what stops the write-up from
drifting away from the tape — every figure in a table is computed, and every figure
quoted in prose is one a reader can check against the table above it.

Layout follows the house format: banner, 关键信号 callout, then sections 1-7 as numbered
cards. When `meta.is_fresh` is False (a dead slot reusing a prior session's tape — see
session.py), an additional callout says so before the key-signal one.
"""

from __future__ import annotations

import argparse
from datetime import date

import kinds
import store

# Section accent colours, in order 1-7.
ACCENTS = {
    1: "#1a4b8c", 2: "#1a4b8c", 3: "#6b3fd4",
    4: "#e0322a", 5: "#f07020", 6: "#0d8a9e", 7: "#26405f",
}

CSS = """
:root{
  --page:#eef1f7; --card:#fff; --ink:#1c2430; --muted:#5c6b7f; --rule:#e3e8f0;
  --head:#f5f7fb; --link:#1a56c4; --mark:#fdf0a8; --pos:#1c2430; --neg:#c0392b;
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);
  font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1000px;margin:0 auto;padding:0 0 0}
.banner{background:linear-gradient(105deg,#123a72 0%,#175a8e 55%,#0f7f95 100%);color:#fff;padding:44px 40px 40px}
.banner .pill{display:inline-block;background:rgba(255,255,255,.18);border-radius:999px;
  padding:6px 18px;font-size:14px;letter-spacing:.02em;margin-bottom:22px}
.banner h1{margin:0 0 14px;font-size:40px;line-height:1.25;font-weight:700;letter-spacing:-.01em}
.banner .sub{margin:0;font-size:16px;color:rgba(255,255,255,.82)}
.body{padding:28px 40px 48px}
.callout{background:#fdf3e3;border-left:5px solid #e8873b;border-radius:12px;padding:22px 26px;margin:0 0 34px}
.callout .lbl{color:#d2691e;font-weight:700;font-size:17px;margin-bottom:10px}
.callout.stale{background:#eef1f7;border-left:5px solid #5c6b7f}
.callout.stale .lbl{color:#3d4a5c}
h1.page{font-size:36px;line-height:1.3;margin:0 0 30px;font-weight:700}
.sec{background:var(--card);border-radius:14px;margin:0 0 26px;overflow:hidden;
  box-shadow:0 1px 3px rgba(20,40,80,.06)}
.sec>.hd{display:flex;align-items:center;gap:18px;background:var(--head);padding:20px 26px;
  border-left:5px solid var(--accent)}
.sec>.hd .num{flex:0 0 auto;width:52px;height:52px;border-radius:50%;background:var(--accent);
  color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px}
.sec>.hd h2{margin:0;font-size:24px;font-weight:700;color:var(--accent)}
.sec>.bd{padding:24px 26px 28px}
.sec>.bd>*:first-child{margin-top:0}
.sec>.bd>*:last-child{margin-bottom:0}
h3{font-size:20px;font-weight:700;color:#1a4b8c;margin:32px 0 14px;
  padding-bottom:10px;border-bottom:1px solid var(--rule)}
h4{font-size:17px;font-weight:700;margin:24px 0 10px}
p{margin:0 0 16px}
ul,ol{margin:0 0 16px;padding-left:26px}
li{margin:0 0 10px}
table{width:100%;border-collapse:collapse;margin:0 0 18px;font-size:15px}
th{background:var(--head);color:#1a4b8c;font-weight:700;text-align:right;padding:13px 14px;
  border-bottom:1px solid var(--rule);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th.l,td.l{text-align:left}
th.c,td.c{text-align:center}
td{text-align:right;padding:12px 14px;border-bottom:1px solid var(--rule)}
tbody tr:nth-child(even){background:#fafbfd}
tbody tr:last-child td{border-bottom:none}
tr.tot td{font-weight:700;border-top:2px solid var(--rule)}
mark{background:var(--mark);padding:.1em .18em;border-radius:2px}
a{color:var(--link)}
code{background:#eef1f7;padding:.1em .35em;border-radius:4px;font-size:.9em}
.neg{color:var(--neg)}
.lead{font-weight:700}
.note{background:#f2f5fa;border-left:4px solid #1a4b8c;border-radius:8px;padding:16px 20px;margin:0 0 22px}
.c-geo{color:#c0392b;font-weight:700}
.c-infl{color:#7b3fd4;font-weight:700}
.c-capex{color:#0e7fa6;font-weight:700}
.c-neg{color:var(--neg);font-weight:700}
.mv{margin:26px 0 0}
.mv h4{font-size:18px;color:#1a4b8c;margin:0 0 4px;padding-bottom:10px;border-bottom:1px solid var(--rule)}
.mv h4 .px{color:var(--ink)}
.mv ul{margin-top:14px}
.foot{background:#123a72;color:rgba(255,255,255,.9);text-align:center;padding:26px 40px 30px;font-size:14px}
.foot .sub{color:rgba(255,255,255,.6);font-size:13px;margin-top:6px}
@media (max-width:720px){
  .banner{padding:32px 20px}.banner h1{font-size:27px}
  .body{padding:22px 18px 34px}h1.page{font-size:25px}
  .sec>.hd{padding:16px}.sec>.hd h2{font-size:19px}.sec>.bd{padding:18px 16px 22px}
  .tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .tscroll table{min-width:620px}
}
@media print{
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
}
"""


# ---------------------------------------------------------------- formatting

def pct(value: float | None, bold: bool = False) -> str:
    if value is None:
        return "—"
    txt = f"{value:+.2f}%".replace("-", "−")
    cls = ' class="neg"' if value < 0 else ""
    return f"<b{cls}>{txt}</b>" if bold else f"<span{cls}>{txt}</span>"


def num(value: float | None, places: int = 2) -> str:
    return "—" if value is None else f"{value:,.{places}f}"


def table(headers: list[tuple[str, str]], rows: list[list[str]], klass: str = "") -> str:
    head = "".join(f'<th class="{align}">{label}</th>' for label, align in headers)
    body = "".join(
        "<tr" + (f' class="{klass}"' if klass and i == len(rows) - 1 else "") + ">"
        + "".join(cell for cell in row) + "</tr>"
        for i, row in enumerate(rows)
    )
    return f'<div class="tscroll"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def korea_direction(korea: dict) -> str:
    """The anchor total row reads its own direction, same rule as a sector.

    Older agg files predate the field, so fall back to recomputing it from up/down
    rather than assuming a direction the tape may contradict.
    """
    if korea.get("direction"):
        return korea["direction"]
    up, down = korea["up"], korea["down"]
    total = up + down
    if not total:
        return "—"
    if min(up, down) / total >= 1 / 3:
        return "↑↓"
    return "↑" if up >= down else "↓"


def section(number: int, title: str, body: str) -> str:
    accent = ACCENTS[number]
    return (
        f'<section class="sec" style="--accent:{accent}">'
        f'<div class="hd"><div class="num">§{number}</div><h2>{title}</h2></div>'
        f'<div class="bd">{body}</div></section>'
    )


# ---------------------------------------------------------------- sections

def render_s1(agg: dict, nar: dict) -> str:
    rows = [
        [f'<td class="l">{i["label"]}</td>', f"<td>{num(i['close'])}</td>",
         f"<td>{pct(i['pct'], bold=True)}</td>"]
        for i in agg["indices"]
    ]
    out = [table([("指数", "l"), ("收盘", "r"), ("pct", "r")], rows)]
    out.append(f'<p><span class="lead">rotation 叙事</span>：{nar["s1"]["rotation"]}</p>')

    out.append("<p><b>宏观三层底色</b>：</p><ol>")
    for layer in nar["s1"]["macro_layers"]:
        out.append(
            f'<li>{layer["icon"]} <span class="c-{layer["color"]}">{layer["label"]}</span>：{layer["body"]}</li>'
        )
    out.append("</ol>")

    k = nar["s1"]["korea"]
    out.append(f'<p><b>{k["heading"]}</b>{k["lead"]}</p><ol>')
    out += [f"<li>{p}</li>" for p in k["points"]]
    out.append("</ol>")
    out.append(f'<p>{k["stabilizer"]}</p>')
    out.append(f'<p>{k["sources"]}</p>')

    out.append(f'<p>{nar["s1"]["stacking"]}</p>')
    out.append(f'<p>{nar["s1"]["mechanical"]}</p>')
    return "".join(out)


def render_s2(agg: dict, nar: dict, uni) -> str:
    rows = []
    for s in agg["sectors"]:
        rows.append([
            f'<td class="l">{s["name"]}</td>',
            f'<td>{s["n"]}</td>',
            f'<td>{pct(s["mean_pct"], bold=s is agg["sectors"][0])}</td>',
            f'<td>{s["up"]}/{s["down"]}</td>',
            f'<td>{s["highlight_n"]}</td>',
            f'<td>{s["extreme_n"]}</td>',
            f'<td class="c">{s["direction"]}</td>',
        ])
    k = agg["korea"]
    rows.append([
        f'<td class="l"><b>{uni.ANCHOR_HEADER_LABEL}</b></td>',
        f'<td>{len(k["rows"])}</td>',
        f'<td>{pct(k["mean_pct"], bold=True)}</td>',
        f'<td>{k["up"]}/{k["down"]}</td>',
        f'<td>{k["highlight_n"]}</td>',
        f'<td>{k["extreme_n"]}</td>',
        f'<td class="c">{korea_direction(k)}</td>',
    ])
    headers = [("板块", "l"), ("n", "r"), ("等权均 pct", "r"), ("上涨/下跌", "r"),
               ("高亮", "r"), ("极端", "r"), ("方向", "c")]
    return table(headers, rows, klass="tot") + f'<p>{nar["s2_note"]}</p>'


def ticker_label(uni, ticker: str) -> str:
    """"300661.SZ" alone is unreadable in a mostly numeric-ticker universe. A universe
    that defines NAMES gets "圣邦股份 300661.SZ"; one that does not (us, asia) renders
    exactly the bare ticker it always did."""
    name = getattr(uni, "NAMES", {}).get(ticker)
    return f'{name} <span class="px">{ticker}</span>' if name else ticker


def render_s3(agg: dict, nar: dict, uni) -> str:
    by_name = {s["name"]: s for s in agg["sectors"]}
    headers = [("Ticker", "l"), ("收盘", "r"), ("pct", "r"), ("成交额(B$)", "r"),
               ("距 52w 高", "r"), ("高亮", "c"), ("极端", "c")]
    out = []
    for i, name in enumerate(agg["sectors_ordered"], 1):
        s = by_name[name]
        # The chain count is whatever this session's narrative actually breaks out.
        n_chains = len(nar.get("s3_chains", {}).get(name) or [])
        suffix = f"（拆 {n_chains} 子链）" if n_chains else ""
        out.append(f"<h3>3.{i} {name}{suffix}</h3>")
        rows = []
        for j, r in enumerate(s["rows"]):
            rows.append([
                f'<td class="l">{ticker_label(uni, r["ticker"])}</td>',
                f'<td>{num(r["close"])}</td>',
                f'<td>{pct(r["pct"], bold=(j == 0 or j == len(s["rows"]) - 1))}</td>',
                f'<td>{num(r["dollar_volume_b"])}</td>',
                f'<td>{pct(r["dist_52w_high_pct"])}</td>',
                f'<td class="c">{"★" if r["highlight"] else ""}</td>',
                f'<td class="c">{"●" if r["extreme"] else ""}</td>',
            ])
        out.append(table(headers, rows))
        note = nar["s3_notes"].get(name)
        if note:
            out.append(f"<p>{note}</p>")
        chains = nar.get("s3_chains", {}).get(name)
        if chains:
            out.append("<ul>" + "".join(f"<li>{c}</li>" for c in chains) + "</ul>")
    return "".join(out)


def render_s4(agg: dict, nar: dict, uni) -> str:
    quotes = {r["ticker"]: r for r in agg["movers"]}
    for r in agg["korea"]["rows"]:
        quotes.setdefault(r["ticker"], r)

    out = [f'<div class="note">{nar["s4_intro"]}</div>']
    for entry in nar["s4"]:
        q = quotes.get(entry["ticker"], {})
        close = num(q.get("close"))
        vol = q.get("dollar_volume_b")
        # Anchor names (Korea for US, US mega-caps for Asia) quote off-currency or off the
        # locked universe; a dollar-volume figure there would be misleading.
        meta = f"收 {close}" if entry.get("tag") == uni.ANCHOR_LABEL else f"收 {close} · 成交 {num(vol)}B$"
        tag = f' <span style="color:#5c6b7f">｜{entry["tag"]}</span>' if entry.get("tag") else ""
        srcs = " · ".join(f'<a href="{s["url"]}">{s["label"]}</a>' for s in entry["sources"])
        out.append(
            f'<div class="mv"><h4>{entry["name"]} {pct(q.get("pct"), bold=True)} '
            f'<span class="px">（{meta}）</span>{tag}</h4><ul>'
            f'<li><b>catalyst</b>：{entry["catalyst"]}</li>'
            f'<li><b>板块共振</b>：{entry["resonance"]}</li>'
            f'<li><b>来源</b>：{srcs}</li></ul></div>'
        )
    return "".join(out)


def render_s5(nar: dict) -> str:
    def block(themes: list[dict]) -> str:
        out = []
        for t in themes:
            out.append(f'<h4>{t["title"]}</h4><ul>')
            out += [f"<li><b>{label}</b>：{text}</li>" for label, text in t["rows"]]
            out.append("</ul>")
        return "".join(out)

    s5 = nar["s5"]
    return (
        "<h3>§5.1 涨方 TOP3</h3>" + block(s5["up_themes"])
        + "<h3>§5.2 反向 TOP3</h3>" + block(s5["down_themes"])
        + "<h3>§5.3 一句话 rotation 总结</h3>" + f'<p>{s5["one_liner"]}</p>'
    )


def render_s6(nar: dict) -> str:
    headers = [("方向", "l"), ("标的（仅作方向）", "l"), ("映射逻辑", "l"), ("共振强度", "l")]
    out = []
    for sec in nar["s6"]["sections"]:
        out.append(f'<h3>{sec["title"]}</h3>')
        rows = [[f'<td class="l">{c}</td>' for c in row] for row in sec["rows"]]
        out.append(table(headers, rows))
    out.append("<h3>6.7 §6 总结对照表</h3>")
    summary = [[f'<td class="l">{c}</td>' for c in row] for row in nar["s6"]["summary_table"]]
    out.append(table([("美股主题", "l"), ("共振强度", "l"), ("最直接 A/H 股映射", "l")], summary))
    out.append(f'<p>{nar["s6"]["caveat"]}</p>')
    return "".join(out)


def render_s7(nar: dict) -> str:
    return "<ul>" + "".join(f"<li>{n}</li>" for n in nar["s7_notes"]) + "</ul>"


# ---------------------------------------------------------------- page

def render(agg: dict, nar: dict, uni=None, meta: dict | None = None) -> str:
    uni = uni or kinds.get("us").universe
    u = agg["universe"]
    # A multi-session tape stamps itself with the last session it covers and carries a
    # human label for the span; a single session has neither and reads as before.
    session = date.fromisoformat(agg.get("session_end", agg["session"]))
    subtitle = (f'{agg.get("session_label", agg["session"])} ET · {u["locked_n"]} 票 + '
                f'{len(agg["indices"])} 指数 · '
                f'{u["sectors_total"]} 子赛道 · {nar["subtitle_extra"]}')
    title = nar["title"]

    stale_banner = ""
    if meta and not meta.get("is_fresh", True):
        reused = meta.get("reused_from", "")
        stale_banner = (
            '<div class="callout stale"><div class="lbl">⏸ 价格沿用</div>'
            f'<p>本场次无新增 session — 价格沿用 {reused} 收盘；'
            '本报告仅更新叙事层（§1/§4/§5/§6）。</p></div>'
        )

    body = "".join([
        stale_banner,
        f'<div class="callout"><div class="lbl">⚡ 关键信号</div><p>{nar["key_signal"]}</p></div>',
        f'<h1 class="page">{title}</h1>',
        section(1, "当日大势", render_s1(agg, nar)),
        section(2, "板块速览（涨方 ↑ / 跌方 ↓ 双向）", render_s2(agg, nar, uni)),
        section(3, f'个股表 × {u["sectors_total"]} 子赛道', render_s3(agg, nar, uni)),
        section(4, "高亮归因（聚焦 Top ~30 · 极端票 + 反向代表）", render_s4(agg, nar, uni)),
        section(5, "主题强度双向 TOP3", render_s5(nar)),
        section(6, "A 股映射（按主题 · 共振强度评级）", render_s6(nar)),
        section(7, "数据说明", render_s7(nar)),
    ])

    stamp = session.strftime("%y%m%d")
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>{CSS}</style></head>
<body><div class="wrap">
<header class="banner"><div class="pill">{nar["badge"]}</div>
<h1>{title}</h1><p class="sub">{subtitle}</p></header>
<main class="body">{body}</main>
<footer class="foot"><div>{stamp}-市场-美股科技板块复盘 · {nar["framework"]}</div>
<div class="sub">yfinance EOD + RSS 新闻抓取 + WebSearch · {nar["vault"]}</div></footer>
</div></body></html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, help="the report's own publish date")
    parser.add_argument("--session-date", help="the session whose tape this report renders; "
                                                 "defaults to --date (differs only for a dead-slot report)")
    parser.add_argument("--kind", default="us", choices=sorted(kinds.KINDS), help="us | asia")
    args = parser.parse_args()
    session_date = args.session_date or args.date

    uni = kinds.get(args.kind).universe
    agg = store.read_json("agg", args.kind, session_date)
    nar = store.read_json("narrative", args.kind, args.date)
    if agg is None:
        raise SystemExit(f"no agg doc for kind={args.kind} date={session_date} — run aggregate.py first")
    if nar is None:
        raise SystemExit(f"no narrative doc for kind={args.kind} date={args.date}")

    meta = None if session_date == args.date else {"is_fresh": False, "reused_from": session_date}
    html = render(agg, nar, uni, meta)
    out = store.report_file_paths(args.kind, args.date)["html"]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
