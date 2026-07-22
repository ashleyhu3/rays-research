import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';

const BLUE = '#4577b4';
const GREEN = '#5a9f6b';
const RED = '#c65d57';
const MUTED = '#8a8a84';
const SOURCE_URL = 'https://data.eastmoney.com/hsgt/hsgtV2.html';

const RANGES = [
  { id: '1m', label: '1M', days: 31 },
  { id: '3m', label: '3M', days: 92 },
  { id: 'ytd', label: 'YTD' },
  { id: '12m', label: '12M', days: 366 },
];

function fmtYi(value, signed = false) {
  if (!Number.isFinite(value)) return '—';
  return `${signed && value > 0 ? '+' : ''}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}亿`;
}

function dateLabel(date, long) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: long ? undefined : 'numeric', year: long ? '2-digit' : undefined,
    timeZone: 'UTC',
  });
}

function windowed(points, range) {
  if (!points?.length) return [];
  const last = points.at(-1).date;
  let cutoff;
  if (range.id === 'ytd') cutoff = `${last.slice(0, 4)}-01-01`;
  else cutoff = new Date(new Date(`${last}T00:00:00Z`).getTime() - range.days * 86400000)
    .toISOString().slice(0, 10);
  return points.filter(point => point.date >= cutoff);
}

function barData(points, color, signed) {
  const long = points.length > 90;
  return {
    labels: points.map(point => dateLabel(point.date, long)),
    datasets: [{
      label: 'RMB 100m',
      data: points.map(point => point.value),
      backgroundColor: points.map(point => signed
        ? `${point.value >= 0 ? GREEN : RED}cc`
        : `${color}cc`),
      borderColor: points.map(point => signed ? (point.value >= 0 ? GREEN : RED) : color),
      borderWidth: 1,
      borderRadius: 2,
      maxBarThickness: 18,
    }],
  };
}

function barOptions(points, signed) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: {
        title: items => points[items[0]?.dataIndex]?.date ?? '',
        label: context => ` ${fmtYi(context.raw, signed)}`,
      } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: MUTED, maxTicksLimit: 10, maxRotation: 0, font: { size: 10 } } },
      y: {
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: value => fmtYi(Number(value)), font: { size: 10 } },
        title: { display: true, text: 'RMB 100m (亿元)', color: MUTED, font: { size: 10 } },
      },
    },
  };
}

function Tile({ label, value, color }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label"><span className="lev-dot" style={{ background: color }} />{label}</div>
      <div className="lev-tile-value">{value}</div>
    </div>
  );
}

export default function ChinaStockConnect() {
  const [rangeId, setRangeId] = useState('3m');
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const range = RANGES.find(item => item.id === rangeId) ?? RANGES[1];

  useEffect(() => {
    let live = true;
    fetch('/api/china-liquidity')
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(data => { if (live) setPayload(data.stockConnect); })
      .catch(fetchError => { if (live) setError(fetchError.message); });
    return () => { live = false; };
  }, []);

  const southbound = useMemo(
    () => windowed(payload?.southboundNetFlow?.data, range),
    [payload, range],
  );
  const northbound = useMemo(
    () => windowed(payload?.northboundTurnover?.data, range),
    [payload, range],
  );

  const toggles = (
    <div className="lev-toggles"><div className="view-toggle">
      {RANGES.map(item => (
        <button key={item.id} className={`vt-btn${item.id === rangeId ? ' active' : ''}`} onClick={() => setRangeId(item.id)}>
          {item.label}
        </button>
      ))}
    </div></div>
  );

  if (error || !payload) {
    return (
      <>
        <div className="lev-head"><div />{toggles}</div>
        <div className="empty">{error ? `Stock Connect data unavailable: ${error}` : 'Loading Stock Connect history…'}</div>
      </>
    );
  }

  if (!southbound.length || !northbound.length) {
    return (
      <>
        <div className="lev-head"><div />{toggles}</div>
        <div className="empty">No stored Stock Connect history yet. The daily collector will populate it.</div>
      </>
    );
  }

  const source = <a className="ch-src" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">East Money</a>;
  const southLatest = southbound.at(-1);
  const northLatest = northbound.at(-1);

  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          <Tile label="Southbound Net Flow" value={fmtYi(southLatest.value, true)} color={southLatest.value >= 0 ? GREEN : RED} />
          <Tile label="Northbound Turnover" value={fmtYi(northLatest.value)} color={BLUE} />
        </div>
        {toggles}
      </div>
      <div className="cgrid">
        <ChartCard
          chartId="china-stock-connect-southbound-net-flow"
          title="China · Stock Connect — Southbound Net Flow"
          src={source}
          freq="Daily"
          lag="After market close"
          height={320}
          srcNote="Daily aggregate net buy amount across Shanghai- and Shenzhen-Hong Kong Stock Connect, shown in RMB 100m (亿元)."
        >
          <Bar data={barData(southbound, GREEN, true)} options={barOptions(southbound, true)} />
        </ChartCard>
        <ChartCard
          chartId="china-stock-connect-northbound-turnover"
          title="China · Stock Connect — Northbound Turnover"
          src={source}
          freq="Daily"
          lag="After market close"
          height={320}
          srcNote="Daily aggregate turnover across Shanghai- and Shenzhen-Hong Kong Stock Connect. Northbound net-buy disclosure was discontinued, so turnover is shown instead."
        >
          <Bar data={barData(northbound, BLUE, false)} options={barOptions(northbound, false)} />
        </ChartCard>
      </div>
    </>
  );
}
