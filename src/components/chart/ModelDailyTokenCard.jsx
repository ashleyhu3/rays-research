import { Bar } from 'react-chartjs-2';
import ChartCard from './ChartCard';
import { baseOpts, mkBar } from '../../utils/chartHelpers';
import { fmtTok, orModelDailySeries } from '../../utils/openrouterProvider';

/** Plain card factory so EditableGrid sees chartId on the direct child. */
export function modelDailyTokenCard({
  ranks, provider, modelMatch, displayName, chartId, color, srcUrl,
}) {
  const series = orModelDailySeries(ranks, provider, modelMatch);
  if (!series) return null;

  const data = {
    labels: series.labels,
    datasets: [{
      ...mkBar(`${displayName} tokens`, color, series.tokens, 0.82),
      borderWidth: 0,
      borderRadius: 2,
      barPercentage: 0.9,
      categoryPercentage: 0.94,
    }],
  };
  const options = baseOpts(fmtTok);
  options.scales.y.beginAtZero = true;
  options.scales.x.ticks.maxTicksLimit = 9;
  options.plugins.tooltip.callbacks.label = c =>
    ` ${displayName}: ${c.parsed.y == null ? 'No reported usage' : fmtTok(c.parsed.y)}`;

  return (
    <ChartCard
      chartId={chartId}
      title={`${displayName} — daily OpenRouter token usage`}
      src="openrouter.ai"
      srcUrl={srcUrl}
      freq="daily"
      subtitle={`All available daily token usage beginning with ${displayName}'s first observed day. Missing or zero-volume dates are intentionally left blank.`}
      height={280}
      span2
      fillBody
    >
      <Bar data={data} options={options} />
    </ChartCard>
  );
}
