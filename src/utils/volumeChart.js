import { BORD, TICK } from './chartHelpers';

export const VOLUME_AXIS_ID = 'volume';
const VOLUME_HEIGHT_RATIO = 0.75;
const VOLUME_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatVolume(value) {
  return VOLUME_FORMATTER.format(value);
}

export function addVolumeBars(chartData, volumes, label) {
  if (!chartData || !volumes?.some(value => Number.isFinite(value) && value > 0)) {
    return chartData;
  }

  return {
    ...chartData,
    datasets: [
      {
        type: 'bar',
        label,
        fullName: label,
        data: volumes,
        yAxisID: VOLUME_AXIS_ID,
        backgroundColor: 'rgba(56,189,248,.42)',
        borderColor: 'rgba(125,211,252,.78)',
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

export function volumeAxis(chartData) {
  const dataset = chartData?.datasets?.find(isVolumeDataset);
  if (!dataset) return null;
  const maxVolume = Math.max(
    0,
    ...dataset.data.filter(value => Number.isFinite(value) && value > 0)
  );
  if (maxVolume <= 0) return null;

  return {
    position: 'right',
    beginAtZero: true,
    min: 0,
    // Make the largest visible bar exactly 75% of the plotting height, leaving
    // the upper quarter clear for the relative-performance lines.
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
