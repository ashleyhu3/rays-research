import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  BubbleController,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

const PointValueLabels = {
  id: 'pointValueLabels',
  afterDatasetsDraw(chart, _args, options) {
    if (!options || options.display !== true) return;

    const { ctx, chartArea } = chart;
    const formatter = options.formatter ?? (value => String(value));
    const offset = options.offset ?? 7;
    const padding = options.padding ?? 4;
    const rectGap = options.rectGap ?? 2;

    ctx.save();
    ctx.font = options.font ?? "600 9px 'Inter', sans-serif";
    ctx.lineWidth = options.strokeWidth ?? 3;
    ctx.strokeStyle = options.strokeStyle ?? 'rgba(7,10,18,.82)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const fontSize = parseFontSize(ctx.font);
    const labelHeight = options.labelHeight ?? Math.ceil(fontSize + 3);
    const rowHeight = Math.max(labelHeight + 1, options.rowHeight ?? 12);
    const groups = new Map();

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;

      meta.data.forEach((point, dataIndex) => {
        if (!point || point.skip) return;
        const y = meta._parsed?.[dataIndex]?.y;
        if (y == null || Number.isNaN(y)) return;
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

        const label = formatter(y, { chart, dataset, datasetIndex, dataIndex });
        if (label == null || label === '') return;

        const color = Array.isArray(dataset.borderColor)
          ? dataset.borderColor[dataIndex]
          : dataset.borderColor;

        const width = Math.ceil(ctx.measureText(label).width) + 4;
        const key = options.groupBy === 'x'
          ? Math.round(point.x)
          : dataIndex;
        const item = {
          key,
          dataset,
          datasetIndex,
          dataIndex,
          pointX: point.x,
          pointY: point.y,
          value: y,
          label,
          color: options.color ?? color ?? '#c8c8c0',
          width,
          height: labelHeight,
        };

        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
    });

    const minCenterY = chartArea.top + padding + labelHeight / 2;
    const maxCenterY = chartArea.bottom - padding - labelHeight / 2;
    const placedRects = [];
    const drawItems = [];

    [...groups.values()]
      .sort((a, b) => Math.min(...a.map(item => item.pointX)) - Math.min(...b.map(item => item.pointX)))
      .forEach(group => {
        group.sort((a, b) => b.value - a.value || a.datasetIndex - b.datasetIndex);

        const available = Math.max(0, maxCenterY - minCenterY);
        const stackGap = group.length > 1 ? Math.min(rowHeight, available / (group.length - 1)) : rowHeight;
        let centers = group.map(item => clamp(item.pointY - offset, minCenterY, maxCenterY));

        for (let i = 1; i < centers.length; i += 1) {
          centers[i] = Math.max(centers[i], centers[i - 1] + stackGap);
        }

        const overflow = centers.at(-1) - maxCenterY;
        if (overflow > 0) centers = centers.map(y => y - overflow);

        const underflow = minCenterY - centers[0];
        if (underflow > 0) centers = centers.map(y => y + underflow);

        const maxWidth = Math.max(...group.map(item => item.width));
        const baseX = clamp(
          group.reduce((sum, item) => sum + item.pointX, 0) / group.length,
          chartArea.left + padding + maxWidth / 2,
          chartArea.right - padding - maxWidth / 2,
        );

        const xStep = options.collisionXOffset ?? 10;
        const yStep = options.collisionYOffset ?? 5;
        const maxYShift = options.maxVerticalShift ?? 28;
        const xOffsets = [0, -xStep, xStep, -2 * xStep, 2 * xStep];
        const yOffsets = [0];
        for (let s = yStep; s <= maxYShift; s += yStep) {
          yOffsets.push(-s, s);
        }

        let best = null;
        xOffsets.forEach(xOffset => {
          const x = clamp(
            baseX + xOffset,
            chartArea.left + padding + maxWidth / 2,
            chartArea.right - padding - maxWidth / 2,
          );
          yOffsets.forEach(yOffset => {
            const shifted = centers.map(y => y + yOffset);
            if (shifted[0] < minCenterY || shifted.at(-1) > maxCenterY) return;
            const rects = group.map((item, i) => labelRect(x, shifted[i], item.width, item.height));
            const collisions = rects.reduce(
              (count, rect) => count + placedRects.filter(other => overlaps(rect, other, rectGap)).length,
              0,
            );
            const score = collisions * 10000 + Math.abs(xOffset) * 8 + Math.abs(yOffset);
            if (!best || score < best.score) best = { x, shifted, rects, score };
          });
        });

        const placement = best ?? {
          x: baseX,
          shifted: centers,
          rects: group.map((item, i) => labelRect(baseX, centers[i], item.width, item.height)),
        };

        placement.rects.forEach(rect => placedRects.push(rect));
        group.forEach((item, i) => drawItems.push({ ...item, x: placement.x, y: placement.shifted[i] }));
      });

    drawItems.forEach(item => {
      ctx.fillStyle = item.color;
      ctx.strokeText(item.label, item.x, item.y);
      ctx.fillText(item.label, item.x, item.y);
    });

    ctx.restore();
  },
};

const ZeroLine = {
  id: 'zeroLine',
  afterDraw(chart) {
    const opts = chart.options?.plugins?.zeroLine;
    if (!opts || opts.display === false) return;

    const yScale = chart.scales?.y;
    if (!yScale || yScale.min > 0 || yScale.max < 0) return;

    const { ctx, chartArea } = chart;
    const y = yScale.getPixelForValue(0);

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash(opts.dash ?? [4, 4]);
    ctx.lineWidth = opts.width ?? 1;
    ctx.strokeStyle = opts.color ?? 'rgba(160,160,160,.5)';
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.restore();
  },
};

function clamp(value, min, max) {
  if (max < min) return (min + max) / 2;
  return Math.max(min, Math.min(value, max));
}

function parseFontSize(font) {
  const match = String(font).match(/(\d+(?:\.\d+)?)px/);
  return match ? Number(match[1]) : 9;
}

function labelRect(x, y, width, height) {
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

function overlaps(a, b, gap = 0) {
  return !(
    a.right + gap < b.left ||
    a.left - gap > b.right ||
    a.bottom + gap < b.top ||
    a.top - gap > b.bottom
  );
}

ChartJS.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  BubbleController,
  Title,
  Tooltip,
  Legend,
  Filler,
  PointValueLabels,
  ZeroLine,
);
