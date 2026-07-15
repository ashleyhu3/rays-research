#!/usr/bin/env python3
"""
Extract daily GPU $/GPU-hr points from an Ornn OCPI chart image and optionally
merge them into server/data/gpuHistory.json.

Preferred path:

  python3 server/scripts/extract_ornn_ocpi_chart.py \
    --image /path/to/ornn_ocpi_gpu_prices.png \
    --merge-gpu-history server/data/gpuHistory.json

The screenshot from the chat is not present as a repo file, so the script also
has --seed-visible-chart. That mode uses manually read anchor points from the
visible screenshot and interpolates them to daily values. Re-run with --image
when the original PNG is available for pixel-level extraction.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import cv2
import numpy as np


DAY = timedelta(days=1)


@dataclass(frozen=True)
class Model:
    key: str
    label: str
    rgb: Tuple[int, int, int]


MODELS = OrderedDict(
    [
        ("H100_SXM", Model("H100_SXM", "H100 SXM", (226, 160, 35))),
        ("H200", Model("H200", "H200", (235, 110, 35))),
        ("B200", Model("B200", "B200", (219, 65, 49))),
        ("A100_SXM", Model("A100_SXM", "A100 SXM4", (139, 127, 111))),
        ("RTX_5090", Model("RTX_5090", "RTX 5090", (46, 181, 203))),
    ]
)

DEFAULT_LEFT = 59
DEFAULT_RIGHT = 1160
DEFAULT_TOP = 75
DEFAULT_BOTTOM = 368
DEFAULT_YMAX = 8.0
DEFAULT_START = "2026-02-01"
DEFAULT_END = "2026-07-07"


VISIBLE_CHART_ANCHORS = {
    "H100_SXM": [
        ("2026-04-06", 1.72), ("2026-04-16", 1.74), ("2026-04-27", 1.82),
        ("2026-05-02", 1.95), ("2026-05-06", 2.35), ("2026-05-12", 2.70),
        ("2026-05-18", 2.78), ("2026-05-24", 3.12), ("2026-05-29", 3.00),
        ("2026-06-03", 2.82), ("2026-06-07", 2.95), ("2026-06-11", 2.70),
        ("2026-06-15", 3.12), ("2026-06-20", 2.65), ("2026-06-26", 2.32),
        ("2026-07-02", 2.45), ("2026-07-07", 2.58),
    ],
    "H200": [
        ("2026-02-01", 2.20), ("2026-02-09", 2.26), ("2026-02-17", 2.18),
        ("2026-03-01", 2.27), ("2026-03-14", 2.43), ("2026-03-22", 2.58),
        ("2026-03-29", 2.45), ("2026-04-09", 2.58), ("2026-04-16", 2.62),
        ("2026-04-23", 3.78), ("2026-04-28", 3.18), ("2026-05-04", 4.00),
        ("2026-05-11", 4.02), ("2026-05-17", 4.20), ("2026-05-22", 5.00),
        ("2026-05-24", 6.45), ("2026-05-25", 7.00), ("2026-05-27", 4.72),
        ("2026-05-30", 5.72), ("2026-06-03", 3.92), ("2026-06-07", 4.88),
        ("2026-06-10", 3.88), ("2026-06-14", 4.62), ("2026-06-18", 3.78),
        ("2026-06-25", 3.48), ("2026-06-29", 3.02), ("2026-07-02", 3.55),
        ("2026-07-05", 3.82), ("2026-07-07", 4.00),
    ],
    "B200": [
        ("2026-02-08", 2.80), ("2026-02-13", 3.12), ("2026-02-23", 2.90),
        ("2026-03-03", 3.00), ("2026-03-12", 3.34), ("2026-03-20", 3.50),
        ("2026-03-28", 4.65), ("2026-04-05", 4.05), ("2026-04-17", 4.18),
        ("2026-04-24", 4.10), ("2026-04-30", 4.85), ("2026-05-05", 5.10),
        ("2026-05-11", 5.28), ("2026-05-17", 3.85), ("2026-05-22", 5.45),
        ("2026-05-27", 5.90), ("2026-06-01", 5.35), ("2026-06-04", 6.08),
        ("2026-06-10", 5.25), ("2026-06-15", 4.70), ("2026-06-22", 4.35),
        ("2026-06-27", 4.22), ("2026-07-01", 4.45), ("2026-07-03", 5.10),
        ("2026-07-07", 5.10),
    ],
    "A100_SXM": [
        ("2026-04-06", 1.00), ("2026-04-10", 1.08), ("2026-04-21", 1.04),
        ("2026-05-01", 1.10), ("2026-05-10", 1.15), ("2026-05-20", 1.18),
        ("2026-05-31", 1.22), ("2026-06-06", 1.13), ("2026-06-14", 1.08),
        ("2026-06-25", 1.02), ("2026-07-07", 0.98),
    ],
    "RTX_5090": [
        ("2026-04-06", 0.45), ("2026-04-20", 0.45), ("2026-05-04", 0.44),
        ("2026-05-14", 0.52), ("2026-05-22", 0.70), ("2026-05-27", 0.86),
        ("2026-06-01", 1.30), ("2026-06-05", 1.15), ("2026-06-10", 0.88),
        ("2026-06-17", 0.68), ("2026-06-25", 0.56), ("2026-07-07", 0.50),
    ],
}


def parse_day(value: str) -> date:
    return date.fromisoformat(value)


def days_between(start: date, end: date) -> Iterable[date]:
    cur = start
    while cur <= end:
        yield cur
        cur += DAY


def linear_series_from_anchors(anchors: List[Tuple[str, float]], start: date, end: date) -> Dict[str, Optional[float]]:
    parsed = sorted((parse_day(d), float(v)) for d, v in anchors)
    out = {d.isoformat(): None for d in days_between(start, end)}
    for (d0, v0), (d1, v1) in zip(parsed, parsed[1:]):
        if d1 < start or d0 > end:
            continue
        span = max(1, (d1 - d0).days)
        for i in range(span + 1):
            d = d0 + timedelta(days=i)
            if start <= d <= end:
                out[d.isoformat()] = round(v0 + (v1 - v0) * (i / span), 2)
    return out


def x_for_day(d: date, start: date, end: date, left: int, right: int) -> int:
    total = max(1, (end - start).days)
    return round(left + ((d - start).days / total) * (right - left))


def y_to_value(y: float, top: int, bottom: int, ymax: float) -> float:
    return (bottom - y) / (bottom - top) * ymax


def interpolate_short_gaps(vals: List[Optional[float]], max_gap: int) -> List[Optional[float]]:
    out = vals[:]
    i = 0
    while i < len(out):
        if out[i] is not None:
            i += 1
            continue
        j = i
        while j < len(out) and out[j] is None:
            j += 1
        if i > 0 and j < len(out) and (j - i) <= max_gap and out[i - 1] is not None and out[j] is not None:
            span = j - (i - 1)
            for k in range(i, j):
                out[k] = round(out[i - 1] + (out[j] - out[i - 1]) * ((k - (i - 1)) / span), 2)
        i = j
    return out


def extract_from_image(args: argparse.Namespace, start: date, end: date) -> Dict[str, Dict[str, Optional[float]]]:
    image = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"Could not read image: {args.image}")
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    dates = list(days_between(start, end))
    out: Dict[str, Dict[str, Optional[float]]] = {}
    for key, model in MODELS.items():
        target = np.array(model.rgb, dtype=np.float32)
        values: List[Optional[float]] = []
        for d in dates:
            x = x_for_day(d, start, end, args.left, args.right)
            x0 = max(args.left, x - args.stripe_px)
            x1 = min(args.right, x + args.stripe_px)
            crop = rgb[args.top : args.bottom + 1, x0 : x1 + 1, :].astype(np.float32)
            dist = np.linalg.norm(crop - target, axis=2)
            ys, _ = np.where(dist <= args.color_tolerance)
            if len(ys) == 0:
                values.append(None)
                continue
            value = y_to_value(float(np.median(ys + args.top)), args.top, args.bottom, args.ymax)
            values.append(round(value, 2) if math.isfinite(value) and value >= 0 else None)
        out[key] = {d.isoformat(): v for d, v in zip(dates, interpolate_short_gaps(values, args.max_gap_days))}
    return out


def build_payload(args: argparse.Namespace) -> dict:
    start, end = parse_day(args.start_date), parse_day(args.end_date)
    if args.seed_visible_chart:
        series = {key: linear_series_from_anchors(anchors, start, end) for key, anchors in VISIBLE_CHART_ANCHORS.items()}
        method = "visible_screenshot_anchor_interpolation"
    else:
        if not args.image:
            raise SystemExit("Provide --image or use --seed-visible-chart.")
        series = extract_from_image(args, start, end)
        method = "pixel_color_digitization"
    return {
        "meta": {
            "source": "Ornn OCPI chart screenshot",
            "unit": "$/GPU-hr",
            "method": method,
            "quality": "estimate_from_visible_prompt" if args.seed_visible_chart else "pixel_extracted",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "dateRange": {"start": args.start_date, "end": args.end_date},
            "models": {key: model.label for key, model in MODELS.items()},
        },
        "series": {key: {"label": MODELS[key].label, "values": values} for key, values in series.items()},
    }


def write_csv(payload: dict, path: Path) -> None:
    dates = sorted({d for model in payload["series"].values() for d, v in model["values"].items() if v is not None})
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["date", *MODELS.keys()])
        for d in dates:
            writer.writerow([d, *[payload["series"][key]["values"].get(d) for key in MODELS]])


def merge_gpu_history(payload: dict, history_path: Path, overwrite_chart: bool = False) -> Tuple[int, int]:
    try:
        history = json.loads(history_path.read_text())
    except FileNotFoundError:
        history = {}
    wrote = 0
    skipped = 0
    for key, model in payload["series"].items():
        for d, value in model["values"].items():
            if value is None:
                continue
            day = history.setdefault(d, {})
            entry = day.setdefault(key, {})
            if not isinstance(entry, dict):
                entry = {"od": entry}
                day[key] = entry
            has_spot = isinstance(entry.get("spot"), (int, float))
            is_chart = entry.get("src") == "ornn_ocpi_chart"
            if has_spot and not (overwrite_chart and is_chart):
                skipped += 1
                continue
            entry["spot"] = round(float(value), 2)
            entry["src"] = "ornn_ocpi_chart"
            entry["quality"] = payload["meta"]["quality"]
            wrote += 1
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_path.write_text(json.dumps(history, separators=(",", ":")))
    return wrote, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path)
    parser.add_argument("--out", type=Path, default=Path("server/data/ornnOcpiGpuSpotExtract.json"))
    parser.add_argument("--csv-out", type=Path, default=Path("server/data/ornnOcpiGpuSpotExtract.csv"))
    parser.add_argument("--merge-gpu-history", type=Path)
    parser.add_argument("--overwrite-chart", action="store_true")
    parser.add_argument("--seed-visible-chart", action="store_true")
    parser.add_argument("--start-date", default=DEFAULT_START)
    parser.add_argument("--end-date", default=DEFAULT_END)
    parser.add_argument("--left", type=int, default=DEFAULT_LEFT)
    parser.add_argument("--right", type=int, default=DEFAULT_RIGHT)
    parser.add_argument("--top", type=int, default=DEFAULT_TOP)
    parser.add_argument("--bottom", type=int, default=DEFAULT_BOTTOM)
    parser.add_argument("--ymax", type=float, default=DEFAULT_YMAX)
    parser.add_argument("--stripe-px", type=int, default=3)
    parser.add_argument("--color-tolerance", type=float, default=42.0)
    parser.add_argument("--max-gap-days", type=int, default=3)
    args = parser.parse_args()

    payload = build_payload(args)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2))
    write_csv(payload, args.csv_out)
    points = sum(1 for model in payload["series"].values() for value in model["values"].values() if value is not None)
    print(f"Wrote {points} extracted OCPI points to {args.out} and {args.csv_out}")
    if args.merge_gpu_history:
        wrote, skipped = merge_gpu_history(payload, args.merge_gpu_history, args.overwrite_chart)
        print(f"Merged {wrote} points into {args.merge_gpu_history} ({skipped} existing spot points preserved)")


if __name__ == "__main__":
    main()
