"""
Reconstruct the weekly OpenRouter token series from the weekly-report SVG.

The report's bar charts render weekly token volume as <rect> bars on a fixed
viewBox: y=316 is zero, y=46 is the top gridline. So a bar of pixel `height`
encodes tokens = (height / 270) * V_max, where V_max is the top axis label
(e.g. "50.00T"). These heights are exact floats emitted by the chart code, so
the reconstruction is lossless to ~0.1px (<0.1% on the total series).

Output: analysis/data/token_weekly.csv  (index = ISO Monday, cols = series)
"""
import re, json, datetime as dt
from pathlib import Path

HERE = Path(__file__).parent
REPORT = HERE.parent / "ai-weekly-report-2026-07-10.html"
html = REPORT.read_text()

# Isolate the OpenRouter section (before the "Pricing" section-title)
start = html.index("OpenRouter Token Usage")
end = html.index("<h2 class=\"section-title\">Pricing")
section = html[start:end]

# Titles we care about (token charts only; skip the DRAM/GPU price charts which
# live in a later section anyway)
TITLE_MAP = {
    "Total weekly token usage": "Total",
    "MiniMax": "MiniMax",
    "Zhipu AI / GLM": "Zhipu",
    "DeepSeek": "DeepSeek",
    "OpenAI / ChatGPT": "OpenAI",
    "Anthropic / Claude": "Anthropic",
    "Google / Gemini": "Google",
    "xAI / Grok": "xAI",
}

# Split into individual chart-wrap blocks
blocks = section.split('<div class="chart-wrap">')
rect_re = re.compile(r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="#(93c5fd|3b82f6)"')
axis_val_re = re.compile(r'class="axis-text">([\d.]+)T<')

# First bar center corresponds to this Monday (from the x-axis "Dec 29" label)
FIRST_MONDAY = dt.date(2025, 12, 29)

series = {}       # name -> list of (monday, tokens, is_current)
for blk in blocks:
    m = re.search(r"<h3>([^<]+)</h3>", blk)
    if not m:
        continue
    title = m.group(1).strip()
    if title not in TITLE_MAP:
        continue
    name = TITLE_MAP[title]
    # Top axis value (max "N.NNT" label) -> V_max in tokens
    vals = [float(x) for x in axis_val_re.findall(blk)]
    if not vals:
        continue
    vmax = max(vals) * 1e12
    rects = rect_re.findall(blk)
    # sort bars left-to-right by x
    bars = sorted(((float(x), float(h), fill) for x, y, w, h, fill in rects), key=lambda t: t[0])
    pts = []
    for i, (x, h, fill) in enumerate(bars):
        monday = FIRST_MONDAY + dt.timedelta(days=7 * i)
        tokens = h / 270.0 * vmax
        is_current = (fill == "3b82f6")  # darker bar = in-progress week
        pts.append((monday.isoformat(), tokens, is_current))
    series[name] = pts

# Assemble a wide table aligned on Monday keys
all_mondays = sorted({p[0] for pts in series.values() for p in pts})
rows = []
current_weeks = set()
for name, pts in series.items():
    for mon, tok, cur in pts:
        if cur:
            current_weeks.add(mon)
header = ["monday"] + list(series.keys())
lines = [",".join(header)]
for mon in all_mondays:
    row = [mon]
    for name in series.keys():
        val = next((tok for (m, tok, c) in series[name] if m == mon), "")
        row.append(f"{val:.0f}" if val != "" else "")
    lines.append(",".join(row))

out = HERE / "data" / "token_weekly.csv"
out.write_text("\n".join(lines) + "\n")

# Report
print("Series extracted:", {k: len(v) for k, v in series.items()})
print("Week span:", all_mondays[0], "->", all_mondays[-1], f"({len(all_mondays)} weeks)")
print("In-progress (current) weeks flagged for drop:", sorted(current_weeks))
tot = series["Total"]
print("\nTotal weekly tokens (T):")
for mon, tok, cur in tot:
    print(f"  {mon}  {tok/1e12:6.2f}T {'(current)' if cur else ''}")
