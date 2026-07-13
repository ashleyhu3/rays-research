import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { baseOpts, dualAxisOpts, mkDs } from '../../utils/chartHelpers';
import { buildRevPerToken, fmtUsdPerM } from '../../utils/companyRevenue';
import ChartCard from './ChartCard';

const PRICE_GRAY = '#90a4ae';

const fmtShare = v => (v == null ? '—' : `$${v.toFixed(v >= 100 ? 0 : 2)}`);

// ISO Monday that starts the week containing `iso` — the key the OpenRouter
// week labels use, so weekly stock closes can be joined onto them.
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * RevPerTokenCard — one company's blended realised price (estimated weekly
 * revenue ÷ that company's weekly OpenRouter tokens, in $/M) with its share
 * price on the right axis.
 *
 * `ticker` is optional: OpenAI and Anthropic are private, so their card shows
 * the revenue-per-token line alone rather than a proxy equity that would imply
 * a relationship the data does not support.
 */
export default function RevPerTokenCard({
  chartId, provider, ranks, liveData, weeks: W, color = C.accent, ticker = null, span2 = true,
}) {
  const [stock, setStock] = useState(null);

  useEffect(() => {
    if (!ticker) { setStock(null); return; }
    let cancelled = false;
    fetch(`/api/stocks/${ticker}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && !d.error) setStock(d); })
      .catch(() => { /* price line is optional — the $/M line still renders */ });
    return () => { cancelled = true; };
  }, [ticker]);

  const series = useMemo(() => buildRevPerToken(ranks, liveData, provider, W), [ranks, liveData, provider, W]);

  // Weekly closes keyed by the Monday of their week, then read off in the
  // order of our week labels. /api/stocks only returns ~1 year, so earlier
  // weeks stay null and the line simply starts later (spanGaps).
  const shareData = useMemo(() => {
    if (!stock?.dates?.length || !series) return null;
    const byWeek = new Map();
    stock.dates.forEach((d, i) => {
      const close = stock.prices[i];
      if (close != null) byWeek.set(mondayOf(d), close);
    });
    const vals = series.isoWeeks.map(w => byWeek.get(w) ?? null);
    return vals.some(v => v != null) ? vals : null;
  }, [stock, series]);

  if (!series) return null;

  const data = {
    labels: series.labels,
    datasets: [
      { ...mkDs('Revenue per M tokens', color, series.price), yAxisID: 'y', spanGaps: true, pointRadius: 0 },
      ...(shareData
        ? [{ ...mkDs(`${ticker} share price`, PRICE_GRAY, shareData), yAxisID: 'y1', spanGaps: true, pointRadius: 0 }]
        : []),
    ],
  };

  return (
    <ChartCard
      chartId={chartId}
      title={`${provider} — revenue per million tokens${shareData ? ` vs ${ticker} share price` : ''}`}
      src={ticker ? 'openrouter.ai/rankings + /models pricing · Yahoo Finance' : 'openrouter.ai/rankings + /models pricing'}
      srcUrl="https://openrouter.ai/rankings"
      freq="weekly"
      subtitle={
        `${provider}'s estimated weekly revenue divided by its total weekly OpenRouter tokens — the blended $/M it realises across its own model mix (left axis). `
        + (ticker
          ? `The line on the right axis is the weekly close of ${ticker}.`
          : `${provider} is private, so there is no share price to plot against it.`)
      }
      height={260} span2={span2} fillBody
    >
      <Line
        data={data}
        options={shareData ? dualAxisOpts(fmtUsdPerM, fmtShare) : baseOpts(fmtUsdPerM)}
      />
    </ChartCard>
  );
}
