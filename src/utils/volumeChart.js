import { BORD, TICK } from './chartHelpers';

export const VOLUME_AXIS_ID = 'volume';
const VOLUME_HEIGHT_RATIO = 0.60;
const VOLUME_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatVolume(value) {
  return VOLUME_FORMATTER.format(value);
}

export function addVolumeBars(chartData, volumes, label) {
  const positive = volumes
    ?.filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b) ?? [];
  if (!chartData || !positive.length) {
    return chartData;
  }
  const ceilingIndex = positive.length < 20
    ? positive.length - 1
    : Math.floor((positive.length - 1) * 0.98);
  const volumeCeiling = positive[ceilingIndex];

  return {
    ...chartData,
    datasets: [
      {
        type: 'bar',
        label,
        fullName: label,
        // Keep one abnormal print from flattening every normal bar. Values
        // above the 98th-percentile ceiling saturate visually, while tooltips
        // continue to display the untouched observation from `rawVolumes`.
        data: volumes.map(value => (
          Number.isFinite(value) && value > 0 ? Math.min(value, volumeCeiling) : value
        )),
        rawVolumes: volumes,
        volumeCeiling,
        yAxisID: VOLUME_AXIS_ID,
        backgroundColor: 'rgba(71,85,105,.30)',
        borderColor: 'rgba(100,116,139,.46)',
        borderWidth: 1,
        barPercentage: 1,
        categoryPercentage: 1,
        maxBarThickness: 8,
        order: 10,
      },
      ...chartData.datasets,
    ],
  };
}

export function isVolumeDataset(dataset) {
  return dataset?.yAxisID === VOLUME_AXIS_ID;
}

export function rawVolumeAt(context) {
  return context.dataset?.rawVolumes?.[context.dataIndex] ?? context.parsed.y;
}

export function volumeAxis(chartData) {
  const dataset = chartData?.datasets?.find(isVolumeDataset);
  if (!dataset) return null;
  const maxVolume = dataset.volumeCeiling ?? Math.max(
    0,
    ...dataset.data.filter(value => Number.isFinite(value) && value > 0)
  );
  if (maxVolume <= 0) return null;

  return {
    position: 'right',
    beginAtZero: true,
    min: 0,
    // Make the largest visible bar exactly 60% of the plotting height, leaving
    // the upper 40% clear for the relative-performance lines.
    max: maxVolume / VOLUME_HEIGHT_RATIO,
    grid: { drawOnChartArea: false },
    ticks: {
      ...TICK,
      maxTicksLimit: 4,
      callback: formatVolume,
    },
    border: BORD,
  };
}
