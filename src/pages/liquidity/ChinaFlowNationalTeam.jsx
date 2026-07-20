import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';

// Same five-colour set china-leverage.jsx already uses for this "China"
// family of pages — kept identical here for visual consistency.
const BLUE = '#4577b4';
const ORANGE = '#ad622d';
const PURPLE = '#7864b4';
const GOLD = '#c9a227';
const RED = '#c65d57';
const MUTED = '#8a8a84';

const GROUP_COLOR = {
  '沪深300': BLUE,
  '中证500': ORANGE,
  '中证1000': PURPLE,
  '科创': GOLD,
  '创业板': RED,
};
const GROUP_KEYS = Object.keys(GROUP_COLOR);

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

const RANGES = [
  { id: '1m', label: '1M', days: 31 },
  { id: '3m', label: '3M', days: 92 },
  { id: 'ytd', label: 'YTD', days: null },
  { id: '12m', label: '12M', days: 366 },
];

const fmtYi = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}亿`);

function dayLabel(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function monthLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} '${String(d.getUTCFullYear()).slice(-2)}`;
}

function rangeFrom(dates, range) {
  if (!dates.length) return 0;
  if (range.id === 'ytd') {
    const year = dates.at(-1).slice(0, 4);
    const idx = dates.findIndex(d => d >= `${year}-01-01`);
    return idx < 0 ? 0 : idx;
  }
  if (range.days) {
    const cutoff = new Date(
      new Date(`${dates.at(-1)}T00:00:00Z`).getTime() - range.days * 86400000,
    ).toISOString().slice(0, 10);
    const idx = dates.findIndex(d => d >= cutoff);
    return idx < 0 ? 0 : idx;
  }
  return 0;
}

/** Slice every group's series to the selected trailing window. */
function windowed(dates, groups, range) {
  if (!dates?.length) return null;
  const from = rangeFrom(dates, range);
  const cut = arr => (arr ?? []).slice(from);
  return {
    dates: cut(dates),
    groups: Object.fromEntries(Object.entries(groups).map(([key, arr]) => [key, cut(arr)])),
  };
}

function chartData(win) {
  const long = win.dates.length > 90;
  return {
    labels: win.dates.map(long ? monthLabel : dayLabel),
    datasets: GROUP_KEYS.map(group => ({
      label: group,
      data: win.groups[group],
      backgroundColor: alpha(GROUP_COLOR[group], 0.75),
      borderColor: GROUP_COLOR[group],
      borderWidth: 1,
      borderRadius: 2,
      maxBarThickness: 14,
    })),
  };
}

function chartOptions(win) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 8, right: 8, bottom: 4 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        padding: 10,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        callbacks: {
          title: items => (items.length ? win.dates[items[0].dataIndex] : ''),
          label: context => (context.raw == null ? null : ` ${context.dataset.label}: ${fmtYi(context.raw)}`),
          footer: items => {
            const i = items[0]?.dataIndex;
            if (i == null) return '';
            const total = GROUP_KEYS.reduce((sum, group) => {
              const v = win.groups[group][i];
              return Number.isFinite(v) ? sum + v : sum;
            }, 0);
            return `Total: ${fmtYi(total)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: MUTED, maxTicksLimit: 12, autoSkip: true, maxRotation: 0, padding: 3, font: { size: 10 },
        },
      },
      y: {
        grace: '8%',
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: value => fmtYi(Number(value)), font: { size: 10 } },
        title: { display: true, text: 'Estimated Flow (亿元)', color: MUTED, font: { size: 10, family: "'Inter',sans-serif" } },
      },
    },
  };
}

function SourceLinks() {
  return (
    <span className="lev-srcs">
      <a className="ch-src" href="https://www.sse.com.cn/assortment/fund/list/etfinfo/basic/index.shtml" target="_blank" rel="noopener noreferrer">
        <span className="lev-dot" style={{ background: BLUE }} />SSE fund size
      </a>
      <a className="ch-src" href="https://fund.szse.cn/marketdata/etf/index.html" target="_blank" rel="noopener noreferrer">
        <span className="lev-dot" style={{ background: ORANGE }} />SZSE fund size
      </a>
    </span>
  );
}

function Tile({ label, value, color }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label">
        <span className="lev-dot" style={{ background: color }} />{label}
      </div>
      <div className="lev-tile-value">{value}</div>
    </div>
  );
}

const SRC_NOTE = 'Estimated, not reported directly: share_change (creations minus redemptions, from each '
  + 'exchange\'s own daily fund-size report) × that day\'s previous close (the price the basket was struck '
  + 'at). A ticker\'s first stored day has no prior share count to diff against and is dropped. A date with '
  + 'no computable value for a ticker is left out of that group\'s total for the day rather than counted as '
  + 'zero flow.';

export default function ChinaFlowNationalTeam() {
  const [rangeId, setRangeId] = useState('3m');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const range = RANGES.find(item => item.id === rangeId) ?? RANGES.find(item => item.id === '3m');

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch('/api/china-national-team-flow')
      .then(response => (response.ok
        ? response.json()
        : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then(payload => { if (live) setData(payload); })
      .catch(fetchError => { if (live) setError(fetchError.message); });
    return () => { live = false; };
  }, []);

  const win = useMemo(() => (data ? windowed(data.dates, data.groups, range) : null), [data, range]);

  const toggles = (
    <div className="lev-toggles">
      <div className="view-toggle">
        {RANGES.map(item => (
          <button
            key={item.id}
            className={`vt-btn${item.id === rangeId ? ' active' : ''}`}
            onClick={() => setRangeId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (error || !data || !win) {
    return (
      <>
        <div className="lev-head"><div />{toggles}</div>
        <div className="empty">
          {error
            ? `China national-team flow data unavailable: ${error}`
            : 'Loading China national-team flow data...'}
        </div>
      </>
    );
  }

  const latestByGroup = GROUP_KEYS.map(group => {
    const series = data.groups[group] ?? [];
    const idx = [...series].reverse().findIndex(Number.isFinite);
    const value = idx < 0 ? null : series[series.length - 1 - idx];
    return { group, value };
  });

  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          {latestByGroup.map(({ group, value }) => (
            <Tile key={group} label={group} value={fmtYi(value)} color={GROUP_COLOR[group]} />
          ))}
        </div>
        {toggles}
      </div>

      <ChartCard
        chartId="china-national-team-flow"
        title="China · Flow — National Team"
        src={<SourceLinks />}
        freq="Daily"
        lag="SSE same-evening; SZSE T+1 morning"
        span2
        height={340}
        legend={GROUP_KEYS.map(group => [group, GROUP_COLOR[group]])}
        srcNote={SRC_NOTE}
      >
        <Bar data={chartData(win)} options={chartOptions(win)} />
      </ChartCard>
    </>
  );
}
