import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
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

    ctx.save();
    ctx.font = options.font ?? "600 9px 'Inter', sans-serif";
    ctx.lineWidth = options.strokeWidth ?? 3;
    ctx.strokeStyle = options.strokeStyle ?? 'rgba(7,10,18,.82)';
    ctx.textAlign = 'center';

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;

      meta.data.forEach((point, dataIndex) => {
        if (!point || point.skip) return;
        const y = meta._parsed?.[dataIndex]?.y;
        if (y == null || Number.isNaN(y)) return;

        const label = formatter(y, { chart, dataset, datasetIndex, dataIndex });
        if (label == null || label === '') return;

        const color = Array.isArray(dataset.borderColor)
          ? dataset.borderColor[dataIndex]
          : dataset.borderColor;

        const drawAbove = y >= 0;
        let baseline = drawAbove ? 'bottom' : 'top';
        let labelY = point.y + (drawAbove ? -offset : offset);
        if (labelY < chartArea.top + 8) {
          baseline = 'top';
          labelY = point.y + offset;
        } else if (labelY > chartArea.bottom - 8) {
          baseline = 'bottom';
          labelY = point.y - offset;
        }

        const labelX = Math.max(chartArea.left + 10, Math.min(point.x, chartArea.right - 10));
        ctx.textBaseline = baseline;
        ctx.fillStyle = options.color ?? color ?? '#c8c8c0';
        ctx.strokeText(label, labelX, labelY);
        ctx.fillText(label, labelX, labelY);
      });
    });

    ctx.restore();
  },
};

ChartJS.register(
  CategoryScale,
  LinearScale,
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
);
