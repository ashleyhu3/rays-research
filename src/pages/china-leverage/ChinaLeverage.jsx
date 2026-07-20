import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';

const SURFACE = '#111419';
const MUTED = '#8a8a84';

const BLUE = '#4577b4';
const ORANGE = '#ad622d';
const PURPLE = '#7864b4';
const GOLD = '#c9a227';
const RED = '#c65d57';

const ETF_COLOR = PURPLE;
// Fixed across all three stacked-layer charts, matching the SSE/SZSE dot
// colors already used in the source attribution below each chart.
const SSE_COLOR = BLUE;
const SZSE_COLOR = ORANGE;

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function round2(v) { return Math.round(v * 100) / 100; }

const MARKED_POINTS = {
  id: 'chinaLeverageMarkedPoints',
  afterDatasetsDraw(chart, _args, options) {
    const { ctx, chartArea } = chart;
    const dsIndex = options.datasetIndex ?? chart.data.datasets.length - 1;
    const points = chart.getDatasetMeta(dsIndex).data;
    const color = options.color ?? chart.data.datasets[dsIndex].borderColor;

    ctx.save();
    for (const mark of options.marks ?? []) {
      const point = points[mark.index];
      if (!point || point.skip) continue;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(point.x, chartArea.top);
      ctx.lineTo(point.x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = SURFACE;
      ctx.textAlign = mark.anchor === 'right' ? 'right' : 'center';
      const x = mark.anchor === 'right' ? point.x - 2 : point.x;

      const valueAbove = point.y - chartArea.top > 25;
      ctx.font = "700 11px 'Inter', sans-serif";
      ctx.textBaseline = valueAbove ? 'bottom' : 'top';
      const valueY = valueAbove ? point.y - 7 : point.y + 7;
      ctx.strokeText(mark.value, x, valueY);
      ctx.fillStyle = color;
      ctx.fillText(mark.value, x, valueY);

      ctx.font = "700 10px 'Inter', sans-serif";
      ctx.textBaseline = 'top';
      const dateY = chartArea.bottom + 21;
      ctx.strokeText(mark.date, x, dateY);
      ctx.fillStyle = color;
      ctx.fillText(mark.date, x, dateY);
    }
    ctx.restore();
  },
};

// Three daily metrics, each charted as separate SSE and SZSE panels side by
// side (`color` below is just the tile accent — the panels themselves always
// use SSE_COLOR/SZSE_COLOR). Balance/total-balance are trillion-yuan scale;
// lending balance is billion-yuan — so each gets its own formatter rather
// than one shared axis unit. (Margin purchase/repayment amount and
// securities lending volume are still computed and stored by the scraper —
// repayment is derived from purchase — just not charted here.)
const METRICS = [
  {
    key: 'balance', label: 'Margin Financing Balance', cn: '融资余额',
    color: BLUE, fmt: v => `${v.toFixed(2)}T`,
  },
  {
    key: 'lendBalance', label: 'Securities Lending Balance', cn: '融券余额',
    color: ORANGE, fmt: v => `${v.toFixed(1)}B`,
  },
  {
    key: 'totalBalance', label: 'Total Margin Balance', cn: '两融余额',
    color: RED, fmt: v => `${v.toFixed(2)}T`,
  },
];

const RANGES = [
  { id: '3m', label: '3M', days: 92 },
  { id: 'ytd', label: 'YTD', days: null },
  { id: '12m', label: '12M', days: 366 },
  { id: '18m', label: '18M', days: 548 },
  { id: '5y', label: '5Y', days: 1830 },
];

const MARKED_DATES = ['2025-04-07', '2026-03-30'];

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

function markedDate(iso) {
  const [year, month, day] = iso.split('-');
  return `${year.slice(-2)}/${month}/${day}`;
}

function sessionIndex(dates, target) {
  let found = -1;
  for (let index = 0; index < dates.length; index += 1) {
    if (dates[index] <= target) found = index;
    else break;
  }
  return found;
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

/** Slice the six metric series to the selected trailing window. */
function windowed(dates, seriesMap, range) {
  if (!dates?.length) return null;
  const from = rangeFrom(dates, range);
  const cut = arr => (arr ?? []).slice(from);
  return {
    dates: cut(dates),
    series: Object.fromEntries(Object.entries(seriesMap).map(([key, arr]) => [key, cut(arr)])),
  };
}

function metricMarks(win, metric) {
  const values = win.series[metric.key] ?? [];
  const marks = MARKED_DATES.map(target => {
    const index = sessionIndex(win.dates, target);
    if (index < 0 || !Number.isFinite(values[index])) return null;
    return {
      index,
      date: markedDate(win.dates[index]),
      value: metric.fmt(values[index]),
      anchor: 'center',
    };
  }).filter(Boolean);

  let latestIndex = values.length - 1;
  while (latestIndex >= 0 && !Number.isFinite(values[latestIndex])) latestIndex -= 1;
  if (latestIndex >= 0) {
    marks.push({
      index: latestIndex,
      date: markedDate(win.dates[latestIndex]),
      value: metric.fmt(values[latestIndex]),
      anchor: 'right',
    });
  }
  return marks;
}

function exchangeChartData(win, metric, label, color) {
  const long = win.dates.length > 200;
  return {
    labels: win.dates.map(long ? monthLabel : dayLabel),
    datasets: [{
      label,
      data: win.series[metric.key],
      backgroundColor: alpha(color, 0.38),
      borderColor: color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: color,
      pointHoverBorderColor: SURFACE,
      pointHoverBorderWidth: 2,
      tension: 0.25,
      fill: 'origin',
    }],
  };
}

function exchangeChartOptions(win, metric, color) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 16, right: 8, bottom: 18 } },
    plugins: {
      legend: { display: false },
      chinaLeverageMarkedPoints: { marks: metricMarks(win, metric), color },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        padding: 10,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        callbacks: {
          title: items => (items.length ? win.dates[items[0].dataIndex] : ''),
          label: context => ` ${context.dataset.label}: ${metric.fmt(context.raw)}`,
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
        beginAtZero: true,
        grace: '5%',
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: value => metric.fmt(Number(value)), font: { size: 10 } },
      },
    },
  };
}

function MarginSourceLinks({ exchange }) {
  return (
    <span className="lev-srcs">
      {exchange === 'SSE' && (
        <a className="ch-src" href="https://www.sse.com.cn/market/othersdata/margin/sum/" target="_blank" rel="noopener noreferrer">
          <span className="lev-dot" style={{ background: BLUE }} />SSE margin data
        </a>
      )}
      {exchange === 'SZSE' && (
        <a className="ch-src" href="https://www.szse.cn/disclosure/margin/margin/index.html" target="_blank" rel="noopener noreferrer">
          <span className="lev-dot" style={{ background: ORANGE }} />SZSE margin data
        </a>
      )}
    </span>
  );
}

function ExchangePanel({ metric, exchange, win, color }) {
  const chart = (
    <Line
      data={exchangeChartData(win, metric, exchange, color)}
      options={exchangeChartOptions(win, metric, color)}
      plugins={[MARKED_POINTS]}
    />
  );
  return (
    <ChartCard
      chartId={`china-leverage-${metric.key}-${exchange.toLowerCase()}`}
      title={`${exchange} · ${metric.label} (${metric.cn})`}
      src={<MarginSourceLinks exchange={exchange} />}
      freq="Daily"
      lag={exchange === 'SSE' ? 'Same-evening' : 'T+1 morning'}
      height={300}
      legend={[[exchange, color]]}
    >
      {chart}
    </ChartCard>
  );
}

/* ── ETF panel: net assets (AUM) of the four real listed 2× products, summed
   into one CNY total — same chart + fund-table format as Leverage.jsx's
   LayerPanel/FundTable for Korea's "2× leveraged ETFs" layer. Only 2 of the
   6 requested indices have a real listed 2× daily product; CSI 300 has three
   separate listings, ChiNext has one — see the srcNote below for the gap and
   each product's data-source caveats. */

const ETF_FMT = v => (v == null ? '—' : `${v.toFixed(v < 0.1 ? 3 : 2)}B`);

function etfChartData(win) {
  const long = win.dates.length > 200;
  return {
    labels: win.dates.map(long ? monthLabel : dayLabel),
    datasets: [{
      label: 'Net assets',
      data: win.series.total,
      backgroundColor: alpha(ETF_COLOR, 0.38),
      borderColor: ETF_COLOR,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: ETF_COLOR,
      pointHoverBorderColor: SURFACE,
      pointHoverBorderWidth: 2,
      tension: 0.25,
      fill: 'origin',
    }],
  };
}

function etfMarks(win) {
  const values = win.series.total ?? [];
  const marks = MARKED_DATES.map(target => {
    const index = sessionIndex(win.dates, target);
    if (index < 0 || !Number.isFinite(values[index])) return null;
    return { index, date: markedDate(win.dates[index]), value: ETF_FMT(values[index]), anchor: 'center' };
  }).filter(Boolean);

  let latestIndex = values.length - 1;
  while (latestIndex >= 0 && !Number.isFinite(values[latestIndex])) latestIndex -= 1;
  if (latestIndex >= 0) {
    marks.push({ index: latestIndex, date: markedDate(win.dates[latestIndex]), value: ETF_FMT(values[latestIndex]), anchor: 'right' });
  }
  return marks;
}

function etfChartOptions(win) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 16, right: 8, bottom: 18 } },
    plugins: {
      legend: { display: false },
      chinaLeverageMarkedPoints: { marks: etfMarks(win), color: ETF_COLOR },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        padding: 10,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        callbacks: {
          title: items => (items.length ? win.dates[items[0].dataIndex] : ''),
          label: context => ` Net assets: ${ETF_FMT(context.raw)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: MUTED, maxTicksLimit: 12, autoSkip: true, maxRotation: 0, padding: 3, font: { size: 10 } },
      },
      y: {
        beginAtZero: true,
        grace: '5%',
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: value => ETF_FMT(Number(value)), font: { size: 10 } },
      },
    },
  };
}

function EtfFundTable({ funds, layerTotal }) {
  return (
    <table className="lev-table">
      <thead>
        <tr>
          <th>Fund</th>
          <th>Market</th>
          <th className="num">Net assets</th>
          <th className="num">Share of total</th>
        </tr>
      </thead>
      <tbody>
        {funds.map(fund => (
          <tr key={fund.key}>
            <td>{fund.label} <span className="lev-code">{fund.code}</span></td>
            <td className="lev-kind">{fund.market}</td>
            <td className="num">{fund.approx ? '≈' : ''}{ETF_FMT(fund.aum)}</td>
            <td className="num">
              {layerTotal ? `${((fund.aum / layerTotal) * 100).toFixed(1)}%` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EtfSourceLinks() {
  return (
    <span className="lev-srcs">
      <a className="ch-src" href="https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en" target="_blank" rel="noopener noreferrer">
        <span className="lev-dot" style={{ background: BLUE }} />HKEXnews L&amp;I disclosures
      </a>
      <a className="ch-src" href="https://finance.daum.net/domestic/etf" target="_blank" rel="noopener noreferrer">
        <span className="lev-dot" style={{ background: PURPLE }} />Daum ETF data
      </a>
      <a className="ch-src" href="https://www.nasdaq.com/market-activity/etf/chau" target="_blank" rel="noopener noreferrer">
        <span className="lev-dot" style={{ background: GOLD }} />Nasdaq fund data
      </a>
    </span>
  );
}

const ETF_NOTE = 'Only 2 of the 6 major A-share indices have a real listed 2× daily product — mainland '
  + 'China bans onshore leveraged ETFs, and no offshore issuer has brought one to market for SSE 50, '
  + 'CSI 500, STAR 50, or CSI 1000. CSI 300 has three listings (CSOP/HK, Mirae TIGER/Korea, Direxion/US); '
  + 'ChiNext has one (Bosera/HK). Net assets are converted to CNY and summed into the total above. '
  + 'CHAU (≈ marked) has no free source for historical shares outstanding — its net assets are '
  + "today's Nasdaq-disclosed figure divided by today's price, applied across historical prices, "
  + 'refreshed on every scrape; the other three are exact daily disclosures.';

function EtfPanel({ win, funds, fundsDate, layerTotal }) {
  const rows = funds?.length ?? 0;

  if (!win || !win.dates.length) {
    return (
      <ChartCard
        chartId="china-leverage-etf"
        title="China A-shares · 2× Leveraged ETF Net Assets"
        src={<EtfSourceLinks />}
        freq="Daily"
        lag="HKEXnews same-evening; Daum/Nasdaq live"
        span2
        height={320}
        srcNote={ETF_NOTE}
      >
        <div className="empty">Loading 2× ETF data...</div>
      </ChartCard>
    );
  }

  const chart = (
    <Line data={etfChartData(win)} options={etfChartOptions(win)} plugins={[MARKED_POINTS]} />
  );

  return (
    <ChartCard
      chartId="china-leverage-etf"
      title="China A-shares · 2× Leveraged ETF Net Assets"
      src={<EtfSourceLinks />}
      freq="Daily"
      lag="HKEXnews same-evening; Daum/Nasdaq live"
      span2
      height={Math.max(430, 340 + rows * 32)}
      legend={[['Net assets', ETF_COLOR]]}
      srcNote={ETF_NOTE}
    >
      <div className="lev-chart-table">
        <div className="lev-layer-chart">{chart}</div>
        <div className="lev-table-wrap">
          <EtfFundTable funds={funds ?? []} layerTotal={layerTotal} />
        </div>
      </div>
      {fundsDate && <p className="opts-footer">Fund table as of {fundsDate}</p>}
    </ChartCard>
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

export default function ChinaLeverage() {
  const [rangeId, setRangeId] = useState('18m');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [backfill, setBackfill] = useState({ running: false, error: null, note: null });

  const range = RANGES.find(item => item.id === rangeId) ?? RANGES.find(item => item.id === '18m');

  const loadData = () => {
    fetch('/api/china-leverage')
      .then(response => (response.ok
        ? response.json()
        : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then(payload => setData(payload))
      .catch(fetchError => setError(fetchError.message));
  };

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch('/api/china-leverage')
      .then(response => (response.ok
        ? response.json()
        : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then(payload => { if (live) setData(payload); })
      .catch(fetchError => { if (live) setError(fetchError.message); });
    return () => { live = false; };
  }, []);

  // SZSE (Shenzhen) only answers requests from wherever this app is actually
  // deployed — it isn't reachable from a local dev machine — so the 5-year
  // history backfill has to run from the live site itself. This button kicks
  // it off in the background (~1200 SZSE requests at a polite pace, a few
  // minutes) and polls for completion, since the request itself returns
  // immediately rather than blocking for the full run.
  const startBackfill = () => {
    setBackfill({ running: true, error: null, note: null });
    fetch('/api/china-leverage/backfill', { method: 'POST' })
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error || `HTTP ${response.status}`)))))
      .then(() => {
        const poll = () => {
          fetch('/api/china-leverage/backfill')
            .then(r => r.json())
            .then(status => {
              if (status.running) { setTimeout(poll, 5000); return; }
              if (status.error) { setBackfill({ running: false, error: status.error, note: null }); return; }
              setBackfill({ running: false, error: null, note: `Backfilled ${status.dates} trading days` });
              loadData();
            })
            .catch(pollError => setBackfill({ running: false, error: pollError.message, note: null }));
        };
        poll();
      })
      .catch(startError => setBackfill({ running: false, error: startError.message, note: null }));
  };

  const sseWin = useMemo(() => (data ? windowed(data.dates, data.bySse, range) : null), [data, range]);
  const szseWin = useMemo(() => (data ? windowed(data.dates, data.bySzse, range) : null), [data, range]);
  const etfWin = useMemo(
    () => (data?.etf ? windowed(data.etf.dates, { total: data.etf.total }, range) : null),
    [data, range],
  );

  const toggles = (
    <div className="lev-toggles">
      <button
        className="lev-backfill-btn"
        onClick={startBackfill}
        disabled={backfill.running}
        title="Backfill 5 years of SSE/SZSE margin history (runs on the server, a few minutes)"
      >
        {backfill.running ? 'Backfilling 5y history…' : 'Backfill 5y history'}
      </button>
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

  const backfillNote = backfill.error
    ? <div className="lev-backfill-note lev-backfill-note-error">Backfill failed: {backfill.error}</div>
    : backfill.note
    ? <div className="lev-backfill-note">{backfill.note}</div>
    : null;

  if (error || !data || !sseWin || !szseWin) {
    return (
      <>
        <div className="lev-head"><div />{toggles}</div>
        <div className="empty">
          {error
            ? `China A-share leverage data unavailable: ${error}`
            : 'Loading China A-share leverage data...'}
        </div>
      </>
    );
  }

  const latest = data.latest ?? {};
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          {METRICS.map(metric => (
            <Tile
              key={metric.key}
              label={metric.label}
              value={latest[metric.key] != null ? metric.fmt(latest[metric.key]) : '—'}
              color={metric.color}
            />
          ))}
        </div>
        {toggles}
      </div>
      {backfillNote}

      {METRICS.map(metric => (
        <div className="cgrid" key={metric.key}>
          <ExchangePanel metric={metric} exchange="SSE" win={sseWin} color={SSE_COLOR} />
          <ExchangePanel metric={metric} exchange="SZSE" win={szseWin} color={SZSE_COLOR} />
        </div>
      ))}
      <EtfPanel
        win={etfWin}
        funds={data.etf?.funds}
        fundsDate={data.etf?.fundsDate}
        layerTotal={data.etf?.total?.at(-1)}
      />
    </>
  );
}
