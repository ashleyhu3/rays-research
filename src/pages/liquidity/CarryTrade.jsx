import { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useResource } from '../../services/resourceCache';
import { useData } from '../../context/DataContext';
import { baseOpts } from '../../utils/chartHelpers';
import LiquidityDateControls, {
  filterDateRange,
  useLiquidityDateRange,
} from './LiquidityDateControls';

const BLUE = '#4577b4';
const PURPLE = '#7864b4';
const GREEN = '#5a9f6b';
const RED = '#c65d57';
const MUTED = '#8a8a84';

const SERIES = [
  { key: 'jpy', short: 'JPY', color: BLUE },
  { key: 'chf', short: 'CHF', color: PURPLE },
];

const SPREADS = [
  { key: 'jpUs10ySpread', title: 'JP–US 10Y Spread', color: BLUE },
  { key: 'chUs10ySpread', title: 'CH–US 10Y Spread', color: PURPLE },
];

function fmtContracts(value, signed = false) {
  if (!Number.isFinite(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1e6) return `${sign}${(value / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${sign}${(value / 1e3).toFixed(1)}K`;
  return `${sign}${value.toLocaleString()}`;
}

function monthLabel(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const month = parsed.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} '${String(parsed.getUTCFullYear()).slice(-2)}`;
}

function chartData(points, color) {
  return {
    labels: points.map(point => monthLabel(point.date)),
    datasets: [{
      label: 'Net contracts',
      data: points.map(point => point.value),
      backgroundColor: points.map(point => `${point.value >= 0 ? GREEN : RED}c7`),
      borderColor: points.map(point => point.value >= 0 ? GREEN : RED),
      borderWidth: 1,
      borderRadius: 2,
      maxBarThickness: 12,
      hoverBackgroundColor: color,
    }],
  };
}

function chartOptions(points) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: {
        title: items => points[items[0]?.dataIndex]?.date ?? '',
        label: context => ` Net position: ${fmtContracts(context.raw, true)} contracts`,
      } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: MUTED, maxTicksLimit: 10, maxRotation: 0, font: { size: 10 } } },
      y: {
        grid: { color: context => context.tick.value === 0 ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: value => fmtContracts(Number(value)), font: { size: 10 } },
        title: { display: true, text: 'Net contracts', color: MUTED, font: { size: 10 } },
      },
    },
  };
}

function fmtPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}

function spreadChartData(points, color) {
  return {
    labels: points.map(point => monthLabel(point.date)),
    datasets: [{
      label: 'Yield spread',
      data: points.map(point => point.value),
      borderColor: color,
      backgroundColor: `${color}33`,
      borderWidth: 1.7,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.15,
      spanGaps: true,
    }],
  };
}

function spreadChartOptions(points) {
  const opts = baseOpts(fmtPct);
  opts.plugins.tooltip.callbacks.title = items => points[items[0]?.dataIndex]?.date ?? '';
  opts.plugins.tooltip.callbacks.label = context => ` Spread: ${fmtPct(context.parsed.y)}`;
  opts.scales.x.ticks.maxTicksLimit = 10;
  return opts;
}

function Tile({ label, point, color }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label"><span className="lev-dot" style={{ background: color }} />{label}</div>
      <div className="lev-tile-value">{fmtContracts(point?.value, true)}</div>
    </div>
  );
}

export default function CarryTrade() {
  const dateRange = useLiquidityDateRange();
  const { startDate, endDate } = dateRange;
  // Loads once on first visit, then served from the shared cache on every
  // subsequent mount (stays loaded across navigation and refresh).
  const { data: payload, error } = useResource('/api/carry-trade');
  const { liveData } = useData();
  const macro = liveData?.macro;

  const visible = useMemo(() => Object.fromEntries(SERIES.map(series => [
    series.key,
    filterDateRange(payload?.series?.[series.key]?.data, startDate, endDate),
  ])), [payload, startDate, endDate]);

  const spreadVisible = useMemo(() => Object.fromEntries(SPREADS.map(spread => [
    spread.key,
    filterDateRange(macro?.series?.[spread.key]?.data, startDate, endDate),
  ])), [macro, startDate, endDate]);

  if (error || !payload) {
    return (
      <>
        <LiquidityDateControls {...dateRange} />
        <div className="empty">{error ? `Carry Trade data unavailable: ${error}` : 'Loading CFTC carry-trade positioning…'}</div>
      </>
    );
  }

  if (SERIES.some(series => !visible[series.key]?.length)) {
    return (
      <>
        <LiquidityDateControls {...dateRange} />
        <div className="empty">No carry-trade history in the selected timeframe.</div>
      </>
    );
  }

  return (
    <>
      <LiquidityDateControls {...dateRange} />
      <div className="lev-head">
        <div className="lev-stats">
          {SERIES.map(series => {
            const point = visible[series.key].at(-1);
            return <Tile key={series.key} label={`${series.short} net position`} point={point} color={point.value >= 0 ? GREEN : RED} />;
          })}
        </div>
      </div>
      <div className="cgrid">
        {SERIES.map(series => {
          const meta = payload.series[series.key];
          const points = visible[series.key];
          return (
            <ChartCard
              key={series.key}
              chartId={`liquidity-carry-trade-${series.key}`}
              title={meta.name}
              src={<a className="ch-src" href={meta.sourceUrl} target="_blank" rel="noopener noreferrer">Investing.com / CFTC</a>}
              freq="Weekly"
              lag="Friday release; positions as of Tuesday"
              height={340}
              srcNote="Non-commercial futures longs minus shorts. Positive values indicate net long positioning; negative values indicate net short positioning. Chart dates are CFTC position dates."
            >
              <Bar data={chartData(points, series.color)} options={chartOptions(points)} />
            </ChartCard>
          );
        })}
      </div>
      <div className="cgrid">
        {SPREADS.map(spread => {
          const meta = macro?.series?.[spread.key];
          const points = spreadVisible[spread.key];
          return (
            <ChartCard
              key={spread.key}
              chartId={`liquidity-carry-trade-${spread.key}`}
              title={meta?.name ?? spread.title}
              src="Trading Economics"
              srcUrl={meta?.sourceUrl}
              freq={meta?.frequency || 'Daily'}
              lag="updated after release"
              height={340}
              srcNote="Positive values indicate the local 10Y yield trades above the US 10Y yield; negative values indicate it trades below — the carry incentive a JPY/CHF funding trade is compensating for."
            >
              {points?.length
                ? <Line data={spreadChartData(points, spread.color)} options={spreadChartOptions(points)} />
                : <div className="empty">{macro ? 'Yield spread data unavailable.' : 'Loading Trading Economics yield history…'}</div>}
            </ChartCard>
          );
        })}
      </div>
    </>
  );
}
