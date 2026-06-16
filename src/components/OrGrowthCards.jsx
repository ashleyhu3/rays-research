import { Bar } from 'react-chartjs-2';
import { C } from '../config/colors';
import { dualAxisOpts, mkDs, mkBar } from '../utils/chartHelpers';
import { orTokensWithGrowth, fmtGrowthPct, fmtTok } from '../utils/openrouterProvider';
import ChartCard from './ChartCard';

/**
 * Combined card: weekly OpenRouter token volume as bars (left axis) with
 * YoY growth as a line (right axis), aligned on complete weeks.
 * Deliberately a plain function, not a component: EditableGrid reads
 * chartId off its direct children, so the card must land in the children
 * array unwrapped. Returns null when rankings data is unavailable.
 */
export function orComboCard(ranks, provider, weeks, color, idPrefix) {
  const s = orTokensWithGrowth(ranks, provider, weeks, 52);
  if (!s) return null;
  const data = {
    labels: s.labels,
    datasets: [
      // Lowest order draws last → line renders on top of the bars
      { ...mkDs('YoY growth (%)', C.orange, s.growth), type: 'line', yAxisID: 'y1', order: 0 },
      { ...mkBar('Weekly tokens', color, s.tokens), yAxisID: 'y', order: 1 },
    ],
  };
  return (
    <ChartCard
      chartId={`${idPrefix}-or-combo`}
      title={`${provider} — weekly OpenRouter tokens (bars) vs YoY growth (line)`}
      src="openrouter.ai/rankings"
      srcUrl="https://openrouter.ai/rankings"
      freq="daily"
      subtitle={`Bars show ${provider}'s weekly token volume (left axis); the line shows year-over-year growth in % (right axis), starting once 52 weeks of history exist. The in-progress week is excluded.`}
      height={260} span2 pinTop
    >
      <Bar data={data} options={dualAxisOpts(fmtTok, fmtGrowthPct)} />
    </ChartCard>
  );
}
