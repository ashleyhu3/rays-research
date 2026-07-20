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

// Lighten a base colour towards white by `t` (0 = base, 1 = white) — used to
// give each ticker within a group its own shade of that group's colour.
function lighten(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - t) + 255 * t);
  const g = Math.round(((n >> 8) & 255) * (1 - t) + 255 * t);
  const b = Math.round((n & 255) * (1 - t) + 255 * t);
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** One shade per ticker in a group, darkest (base colour) first. */
function tickerShades(baseHex, count) {
  if (count <= 1) return [baseHex];
  return Array.from({ length: count }, (_, i) => lighten(baseHex, (i / (count - 1)) * 0.55));
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

/** Slice every group total and every ticker's series to the selected trailing window. */
function windowed(dates, groups, tickerSeries, range) {
  if (!dates?.length) return null;
  const from = rangeFrom(dates, range);
  const cut = arr => (arr ?? []).slice(from);
  return {
    dates: cut(dates),
    groups: Object.fromEntries(Object.entries(groups ?? {}).map(([key, arr]) => [key, cut(arr)])),
    tickerSeries: Object.fromEntries(Object.entries(tickerSeries ?? {}).map(([key, arr]) => [key, cut(arr)])),
  };
}

function groupChartData(win, group, tickers) {
  const long = win.dates.length > 90;
  const shades = tickerShades(GROUP_COLOR[group], tickers.length);
  return {
    labels: win.dates.map(long ? monthLabel : dayLabel),
    datasets: tickers.map((ticker, i) => ({
      label: ticker,
      data: win.tickerSeries[ticker] ?? [],
      backgroundColor: alpha(shades[i], 0.8),
      borderColor: shades[i],
      borderWidth: 1,
      borderRadius: 2,
      maxBarThickness: 14,
    })),
  };
}

function groupChartOptions(win, group, tickers) {
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
            const total = tickers.reduce((sum, ticker) => {
              const v = win.tickerSeries[ticker]?.[i];
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

function GroupPanel({ group, tickers, win }) {
  return (
    <ChartCard
      chartId={`china-national-team-flow-${group}`}
      title={`China · Flow — ${group}`}
      src={<SourceLinks />}
      freq="Daily"
      lag="SSE same-evening; SZSE T+1 morning"
      span2
      height={300}
      legend={tickers.map((ticker, i) => [ticker, tickerShades(GROUP_COLOR[group], tickers.length)[i]])}
      srcNote={SRC_NOTE}
    >
      <Bar data={groupChartData(win, group, tickers)} options={groupChartOptions(win, group, tickers)} />
    </ChartCard>
  );
}

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

  const win = useMemo(
    () => (data ? windowed(data.dates, data.groups, data.tickerSeries, range) : null),
    [data, range],
  );

  const tickerGroups = data?.tickerGroups ?? {};

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

      <div className="cgrid">
        {GROUP_KEYS.map(group => (
          <GroupPanel key={group} group={group} tickers={tickerGroups[group] ?? []} win={win} />
        ))}
      </div>
    </>
  );
}
