import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useResource } from '../../services/resourceCache';
import ChinaFlowNationalTeam from './ChinaFlowNationalTeam';
import ChinaStockConnect from './ChinaStockConnect';

const BLUE = '#4577b4';
const GOLD = '#c9a227';
const GREEN = '#3a9e6b';
const MUTED = '#8a8a84';

/** Per-series presentation. `monthly` drives both the axis-label cadence and the
 * lookback: the daily series show a rolling year, M2 keeps its full history. */
const SERIES = {
  turnover: {
    color: BLUE, percent: false, monthly: false, lag: 'End of trading day',
    note: 'Daily total A-share market turnover (成交额), persisted by the scheduled collector.',
  },
  turnoverRate: {
    color: GREEN, percent: true, monthly: false, lag: 'End of trading day',
    note: 'Daily A-share turnover (成交额) divided by whole-market free-float market cap '
      + '(自由流通市值). The denominator is summed across the A-share universe from Tushare '
      + 'daily_basic as Σ(free_share × close) for each trade date.',
  },
  m2Yoy: {
    color: GOLD, percent: true, monthly: true, lag: 'Published monthly',
    note: 'Year-over-year growth is calculated from the stored monthly M2 level series.',
  },
};

function compactCny(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e12) return `¥${(value / 1e12).toFixed(2)}tn`;
  return `¥${(value / 1e8).toFixed(0)}亿`;
}

function dateLabel(date, monthly) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', year: monthly ? '2-digit' : undefined, day: monthly ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

function LiquiditySeries({ kind }) {
  // Loads once on first visit, then served from the shared cache on every
  // subsequent mount (stays loaded across navigation and refresh).
  const { data: payload, error } = useResource('/api/china-liquidity');

  const series = payload?.[kind];
  const { color, percent, monthly, lag, note } = SERIES[kind];
  const points = useMemo(() => {
    const all = series?.data ?? [];
    if (monthly) return all;
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
    const day = cutoff.toISOString().slice(0, 10);
    return all.filter(point => point.date >= day);
  }, [series, monthly]);

  if (error) return <div className="empty">China liquidity data unavailable: {error}</div>;
  if (!series) return <div className="empty">Loading stored China liquidity history…</div>;
  if (!points.length) return <div className="empty">No stored {series.name} history yet. The daily collector will populate it.</div>;

  const latest = points.at(-1);
  const display = percent ? `${latest.value.toFixed(2)}%` : compactCny(latest.value);
  const data = {
    labels: points.map(point => dateLabel(point.date, monthly)),
    datasets: [{
      label: series.name, data: points.map(point => point.value), borderColor: color,
      backgroundColor: `${color}24`, borderWidth: 2, pointRadius: monthly ? 2 : 0,
      pointHoverRadius: 4, tension: 0.2, fill: true,
    }],
  };
  const options = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: {
        title: items => points[items[0]?.dataIndex]?.date ?? '',
        label: context => percent
          ? ` ${context.raw.toFixed(2)}%${monthly ? ' YoY' : ''}`
          : ` ${compactCny(context.raw)}`,
      } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: MUTED, maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } } },
      y: { grid: { color: 'rgba(255,255,255,.07)' }, ticks: {
        color: MUTED, font: { size: 10 }, callback: value => percent ? `${value}%` : compactCny(Number(value)),
      } },
    },
  };

  return (
    <>
      <div className="lev-head">
        <div className="lev-stats"><div className="lev-tile">
          <div className="lev-tile-label"><span className="lev-dot" style={{ background: color }} />Latest</div>
          <div className="lev-tile-value">{display}</div>
        </div></div>
      </div>
      <div className="cgrid">
        <ChartCard
          chartId={`china-liquidity-${kind}`} title={`China · ${series.name}`}
          src={<a className="ch-src" href={series.sourceUrl} target="_blank" rel="noopener noreferrer">{series.source}</a>}
          freq={series.frequency} lag={lag}
          span2 height={360}
          srcNote={note}
        >
          <Line data={data} options={options} />
        </ChartCard>
      </div>
    </>
  );
}

export default function ChinaLiquidity({ section }) {
  if (section === 'stock-connect') return <ChinaStockConnect />;
  if (section === 'turnover') return <LiquiditySeries kind="turnover" />;
  if (section === 'turnover-rate') return <LiquiditySeries kind="turnoverRate" />;
  if (section === 'money-supply') return <LiquiditySeries kind="m2Yoy" />;
  return <ChinaFlowNationalTeam />;
}
