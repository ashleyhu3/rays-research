import { Line, Bar } from 'react-chartjs-2';
import { fa } from '../../config/colors';
import { baseOpts, hBarOpts, mkDs } from '../../utils/chartHelpers';
import { getChartMeta } from '../../config/chartMeta';
import ChartCard from './ChartCard';

/**
 * Chart card for snapshot metrics tracked by the server's daily history
 * store. Renders a Line of the accumulated daily values once two or more
 * days exist; until then falls back to a Bar of the latest values, so the
 * card is honest about having one data point rather than faking a curve.
 * Callers can set alwaysLine for metrics that should retain a date x-axis
 * even while history contains only one snapshot.
 *
 * Plain function (not a component) for the same reason as orComboCard:
 * EditableGrid reads chartId off its direct children.
 *
 * series: [{ metric: 'anthropics/anthropic-sdk-python.stars', label: 'Stars', color }]
 * hist:   liveData.metricsHistory[source] — { metric: { date: value } }
 */
export function metricTrendCard({
  chartId, title, src, srcUrl, freq, subtitle, hist, series, fmt,
  height = 220, span2 = false, weeks, alwaysLine = false,
}) {
  const present = series
    .map(s => ({ ...s, points: hist?.[s.metric] ?? null }))
    .filter(s => s.points && Object.keys(s.points).length > 0);
  if (present.length === 0) return null;

  // Respond to the global time toggle: keep only the most recent `weeks * 7`
  // daily snapshots. `weeks` undefined → show the full accumulated history.
  let allDates = [...new Set(present.flatMap(s => Object.keys(s.points)))].sort();
  if (weeks > 0) allDates = allDates.slice(-weeks * 7);
  const isTrend = alwaysLine || allDates.length >= 2;

  const data = isTrend
    ? {
        labels: allDates,
        datasets: present.map(s => mkDs(s.label, s.color, allDates.map(d => s.points[d] ?? null))),
      }
    : {
        labels: present.map(s => s.label),
        datasets: [{
          label: 'Latest',
          data: present.map(s => s.points[allDates[0]]),
          backgroundColor: present.map(s => fa(s.color, 0.75)),
          borderColor: present.map(s => s.color),
          borderWidth: 1, borderRadius: 4,
        }],
      };

  const note = isTrend
    ? `Daily snapshots since ${allDates[0]}.`
    : 'Daily trend line appears as snapshots accumulate (first snapshot today).';

  // Base description comes from chartText.js unless the caller passes a
  // computed subtitle; the dynamic snapshot note is always appended.
  const baseSub = subtitle ?? getChartMeta(chartId).subtitle ?? '';

  return (
    <ChartCard
      chartId={chartId}
      title={title}
      src={src}
      srcUrl={srcUrl}
      freq={freq}
      subtitle={`${baseSub} ${note}`.trim()}
      legend={isTrend ? present.map(s => [s.label, s.color]) : undefined}
      height={height}
      span2={span2}
    >
      {isTrend
        ? <Line data={data} options={baseOpts(fmt)} />
        : <Bar  data={data} options={hBarOpts(fmt)} />}
    </ChartCard>
  );
}
