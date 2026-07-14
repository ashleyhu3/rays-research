import { Bar } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { dualAxisOpts, mkDs, mkBar } from '../../utils/chartHelpers';
import { orTokensWithGrowth, fmtTok } from '../../utils/openrouterProvider';
import { buildRevPerToken, fmtUsdPerM } from '../../utils/companyRevenue';
import ChartCard from './ChartCard';

/**
 * Combined card: weekly OpenRouter token volume as bars (left axis) with
 * average token price (blended revenue per million tokens) as a line (right
 * axis), aligned on complete weeks.
 * Deliberately a plain function, not a component: EditableGrid reads
 * chartId off its direct children, so the card must land in the children
 * array unwrapped. Returns null when rankings data is unavailable.
 */
export function orComboCard(ranks, provider, weeks, color, idPrefix, liveData) {
  const s = orTokensWithGrowth(ranks, provider, weeks, 52);
  if (!s) return null;
  const rpt = buildRevPerToken(ranks, liveData, provider, weeks);
  const price = rpt?.price ?? s.tokens.map(() => null);
  const data = {
    labels: s.labels,
    datasets: [
      // Lowest order draws last → line renders on top of the bars
      { ...mkDs('Average token price', C.orange, price), type: 'line', yAxisID: 'y1', order: 0 },
      { ...mkBar('Weekly tokens', color, s.tokens), yAxisID: 'y', order: 1 },
    ],
  };
  return (
    <ChartCard
      chartId={`${idPrefix}-or-combo`}
      title={`${provider} — weekly OpenRouter tokens (bars) vs average token price (line)`}
      src="openrouter.ai/rankings"
      srcUrl="https://openrouter.ai/rankings"
      freq="daily"
      subtitle={`Bars show ${provider}'s weekly token volume (left axis); the line shows the blended $/M tokens realised that week — estimated weekly revenue divided by weekly tokens (right axis). The in-progress week is excluded.`}
      height={260} span2 pinTop fillBody
    >
      <Bar data={data} options={dualAxisOpts(fmtTok, fmtUsdPerM)} />
    </ChartCard>
  );
}
