import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useResource } from '../../services/resourceCache';
import ChinaFlowNationalTeam from './ChinaFlowNationalTeam';
import ChinaStockConnect from './ChinaStockConnect';

const BLUE = '#4577b4';
const GOLD = '#c9a227';
const MUTED = '#8a8a84';

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
  const monthly = kind === 'm2Yoy';
  const color = monthly ? GOLD : BLUE;
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
  const display = monthly ? `${latest.value.toFixed(2)}%` : compactCny(latest.value);
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
        label: context => monthly ? ` ${context.raw.toFixed(2)}% YoY` : ` ${compactCny(context.raw)}`,
      } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: MUTED, maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } } },
      y: { grid: { color: 'rgba(255,255,255,.07)' }, ticks: {
        color: MUTED, font: { size: 10 }, callback: value => monthly ? `${value}%` : compactCny(Number(value)),
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
          freq={series.frequency} lag={monthly ? 'Published monthly' : 'End of trading day'}
          span2 height={360}
          srcNote={monthly
            ? 'Year-over-year growth is calculated from the stored monthly M2 level series.'
            : 'Daily total A-share market turnover (成交额), persisted by the scheduled collector.'}
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
  if (section === 'money-supply') return <LiquiditySeries kind="m2Yoy" />;
  return <ChinaFlowNationalTeam />;
}
