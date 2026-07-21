import { Bar } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { dualAxisOpts, mkDs, mkBar } from '../../utils/chartHelpers';
import { orTokensWithGrowth, fmtTok } from '../../utils/openrouterProvider';
import { buildDailyModelMix, buildRevPerToken, fmtUsdPerM } from '../../utils/companyRevenue';
import ChartCard from './ChartCard';

const MODEL_COLORS = [
  '#0ea5e9', '#14b8a6', '#f59e0b', '#f97316', '#84cc16', '#ec4899',
  '#22c55e', '#f87171', '#8b5cf6', '#06b6d4', '#eab308', '#a78bfa',
];
const PROVIDER_SLUGS = {
  OpenAI: 'openai', Anthropic: 'anthropic', Google: 'google', DeepSeek: 'deepseek',
  'Alibaba (Qwen)': 'qwen', xAI: 'x-ai', MiniMax: 'minimax', 'Zhipu AI': 'z-ai',
  'Moonshot AI': 'moonshotai', Tencent: 'tencent', Xiaomi: 'xiaomi',
};

function dailyStackedOpts() {
  const opts = dualAxisOpts(fmtTok, fmtUsdPerM);
  opts.plugins.legend.display = false;
  opts.plugins.tooltip.filter = item => item.dataset.yAxisID === 'y1' || item.parsed.y > 0;
  opts.scales.x.stacked = true;
  opts.scales.x.ticks.maxTicksLimit = 9;
  opts.scales.y.stacked = true;
  return opts;
}

/**
 * Combined card: native daily OpenRouter token volume stacked by model (left
 * axis) with token-weighted input price as a line (right axis). Older cached
 * payloads temporarily fall back to the former weekly aggregate.
 * Deliberately a plain function, not a component: EditableGrid reads
 * chartId off its direct children, so the card must land in the children
 * array unwrapped. Returns null when rankings data is unavailable.
 */
export function orComboCard(ranks, provider, weeks, color, idPrefix, liveData) {
  const daily = buildDailyModelMix(ranks, liveData, provider, weeks);
  if (daily) {
    const barModels = [...daily.models].sort((a, b) => {
      if (a.slug === 'other') return 1;
      if (b.slug === 'other') return -1;
      return b.tokens.reduce((sum, v) => sum + v, 0) - a.tokens.reduce((sum, v) => sum + v, 0);
    });
    const datasets = barModels.map((model, i) => ({
      ...mkBar(
        model.name,
        model.slug === 'other' ? C.slate : MODEL_COLORS[i % MODEL_COLORS.length],
        model.tokens,
        model.slug === 'other' ? 0.45 : 0.82,
      ),
      yAxisID: 'y',
      order: 1,
      borderWidth: 0,
      borderRadius: 0,
      barPercentage: 0.92,
      categoryPercentage: 0.96,
    }));
    datasets.unshift({
      ...mkDs('Average token price', C.orange, daily.price),
      type: 'line', yAxisID: 'y1', order: 0, pointRadius: 0, pointHoverRadius: 4,
    });
    const slug = PROVIDER_SLUGS[provider] ?? provider.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    return (
      <ChartCard
        chartId={`${idPrefix}-or-combo`}
        title={`${provider} — daily OpenRouter tokens by model vs average token price`}
        src="openrouter.ai"
        srcUrl={`https://openrouter.ai/${slug}`}
        freq="daily"
        subtitle={`Daily token volume split by ${provider} model (stacked bars, left axis); the line is that day's token-weighted input price in $/M (right axis). Hover a day for the full model breakdown.`}
        height={300} span2 pinTop fillBody
      >
        <Bar data={{ labels: daily.labels, datasets }} options={dailyStackedOpts()} />
      </ChartCard>
    );
  }

  // Backward-compatible display while an older cached rankings payload awaits
  // its next refresh. New payloads always take the daily branch above.
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
