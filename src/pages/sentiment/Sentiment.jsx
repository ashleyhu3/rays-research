import { useMemo, useState, useRef, useEffect } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, mkDs, dualAxisOpts, fmtM, GRID, TICK, BORD } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';
import { TickerPanel } from '../options/Options';

/* ── Short Interest Panel ─────────────────────────────────────────────
   Fetches price history + short-interest stats from /api/stocks/:ticker
   (Yahoo Finance) and renders the dual-panel chart: short interest ratio
   + closing price as two lines on shared X, with volume bars below.     */

const SHORT_BLUE  = '#4fc3f7';
const PRICE_GRAY  = '#90a4ae';
const VOL_TEAL    = '#26c6da';

function ShortInterestPanel({ ticker }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/stocks/${ticker}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) return <div className="opts-loading">Loading price &amp; short interest data…</div>;
  if (error)   return <div className="opts-empty" style={{ paddingTop: 6 }}><h2>Could not load data for {ticker}</h2><p style={{ fontSize: 13 }}>{error}</p></div>;
  if (!data)   return null;

  const lineData = {
    labels: data.labels,
    datasets: [
      {
        label: 'Short Interest Ratio',
        data: data.shortRatios,
        borderColor: SHORT_BLUE,
        backgroundColor: 'transparent',
        yAxisID: 'yLeft',
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.4,
        spanGaps: true,
      },
      {
        label: 'Closing Price',
        data: data.prices,
        borderColor: PRICE_GRAY,
        backgroundColor: 'transparent',
        yAxisID: 'yRight',
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 1.5,
        tension: 0.3,
        spanGaps: true,
      },
    ],
  };

  const barData = {
    labels: data.labels,
    datasets: [{
      label: 'Volume',
      data: data.volumes,
      backgroundColor: fa(VOL_TEAL, 0.55),
      borderColor: fa(VOL_TEAL, 0.8),
      borderWidth: 1,
      borderRadius: 2,
    }],
  };

  const lineOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont:  { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: {
          label: c => c.dataset.yAxisID === 'yLeft'
            ? ` ${c.dataset.label}: ${c.parsed.y?.toFixed(2)}d`
            : ` ${c.dataset.label}: $${c.parsed.y?.toFixed(2)}`,
        },
      },
    },
    scales: {
      x: { display: false },
      yLeft: {
        position: 'left',
        grid: GRID,
        ticks: { ...TICK, callback: v => `${v.toFixed(2)}d` },
        border: BORD,
      },
      yRight: {
        position: 'right',
        grid: { display: false },
        ticks: { ...TICK, callback: v => `$${v.toFixed(0)}` },
        border: BORD,
      },
    },
  };

  const barOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont:  { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: { label: c => ` Volume: ${fmtM(c.parsed.y)}` },
      },
    },
    scales: {
      x: {
        grid: GRID,
        ticks: { ...TICK, maxTicksLimit: 8, autoSkip: true },
        border: BORD,
      },
      y: {
        position: 'left',
        grid: GRID,
        ticks: { ...TICK, callback: v => fmtM(v) },
        border: BORD,
        beginAtZero: true,
      },
    },
  };

  const hasShortLine = data.shortRatios?.some(v => v != null);

  return (
    <div className="cbox span2">
      <div className="ch-head">
        <div className="ch-title">Short Interest — {data.name || ticker}</div>
        <div className="ch-meta">
          <span className="freq-badge freq-weekly">bi-monthly · FINRA</span>
          <span className="ch-src">Massive</span>
        </div>
      </div>

      {/* Legend row */}
      <div style={{ display: 'flex', gap: 18, marginBottom: 10, fontSize: 11, color: '#b0b0a8', fontFamily: "'Inter',sans-serif" }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 16, height: 2, background: SHORT_BLUE, display: 'inline-block', borderRadius: 1 }} />
          Days to Cover
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 16, height: 2, background: PRICE_GRAY, display: 'inline-block', borderRadius: 1 }} />
          Closing Price
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, background: fa(VOL_TEAL, 0.55), border: `1px solid ${fa(VOL_TEAL, 0.8)}`, display: 'inline-block', borderRadius: 2 }} />
          Volume
        </span>
      </div>

      {/* Top panel: short interest ratio (left axis) + price (right axis) */}
      <div style={{ position: 'relative', height: 200 }}>
        <Line data={lineData} options={lineOpts} />
        {!hasShortLine && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 11, color: '#6b7280', fontFamily: "'Inter',sans-serif" }}>
              Short interest data unavailable for this ticker
            </span>
          </div>
        )}
      </div>

      {/* Bottom panel: volume bars, shares the same X labels */}
      <div style={{ position: 'relative', height: 80, marginTop: 2 }}>
        <Bar data={barData} options={barOpts} />
      </div>

      {/* Summary row */}
      {(data.shortRatio != null || data.sharesShort != null) && (
        <div style={{ fontSize: 11, color: '#b0b0a8', marginTop: 8, fontFamily: "'Inter',sans-serif", display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {data.sharesShort != null && <span>Shares short: <strong style={{ color: '#e8e8e0' }}>{fmtM(data.sharesShort)}</strong></span>}
          {data.shortRatio  != null && <span>Days to cover: <strong style={{ color: '#e8e8e0' }}>{data.shortRatio.toFixed(1)}</strong></span>}
        </div>
      )}
    </div>
  );
}

/* ── Keyword frequency chart ──────────────────────────────────────────────
   Searches all StockTwits CSVs for a whole-word (case-insensitive) keyword
   and plots monthly mention count as a bar chart.                          */
const KW_COLOR = '#60a5fa'; // soft blue

function KeywordSearch() {
  const [kw, setKw]         = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const [searched, setSearched] = useState('');

  async function doSearch(e) {
    e?.preventDefault();
    const q = kw.trim();
    if (!q || loading) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await fetch(`/api/sentiment/keyword?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setResult(d);
      setSearched(q);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const fmtMonth = iso => {
    const [y, m] = iso.split('-');
    return new Date(parseInt(y), parseInt(m) - 1)
      .toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };

  const MOM_COLOR = '#fbbf24'; // amber for MoM line

  const chartData = result ? (() => {
    const counts = result.counts;
    const mom = counts.map((v, i) =>
      i === 0 || counts[i - 1] === 0 ? null
        : +((v - counts[i - 1]) / counts[i - 1] * 100).toFixed(1)
    );
    return {
      labels: result.months.map(fmtMonth),
      datasets: [
        {
          type: 'bar',
          label: 'Monthly mentions',
          data: counts,
          backgroundColor: fa(KW_COLOR, 0.55),
          borderColor: KW_COLOR,
          borderWidth: 1,
          borderRadius: 2,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'MoM growth %',
          data: mom,
          borderColor: MOM_COLOR,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.3,
          spanGaps: false,
          yAxisID: 'y1',
        },
      ],
    };
  })() : null;

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 10, boxWidth: 10 },
      },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont:  { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: {
          label: c => c.dataset.yAxisID === 'y1'
            ? ` MoM: ${c.parsed.y == null ? '—' : `${c.parsed.y > 0 ? '+' : ''}${c.parsed.y}%`}`
            : ` Mentions: ${c.parsed.y.toLocaleString()}`,
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD },
      y:  { position: 'left',  grid: GRID, ticks: { ...TICK, callback: v => v.toLocaleString() }, border: BORD, beginAtZero: true },
      y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { ...TICK, callback: v => `${v > 0 ? '+' : ''}${v}%` }, border: BORD },
    },
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, color: '#8a8f99', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
        Keyword frequency — across all tracked tickers
      </div>
      <form onSubmit={doSearch} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          className="opts-input"
          value={kw}
          onChange={e => setKw(e.target.value)}
          placeholder='Enter a keyword to count monthly mentions across all twits (e.g. "tariff", "AI", "earnings")…'
          spellCheck={false}
          autoComplete="off"
          style={{ textTransform: 'none' }}
        />
        <button className="opts-search-btn" type="submit" disabled={!kw.trim() || !!loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <div style={{ color: '#f87171', fontSize: 12.5, marginBottom: 10 }}>⚠ {error}</div>}
      {chartData && (
        <div style={{ background: 'rgba(14,17,22,.6)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: '14px 16px 8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>
              "{searched}" mentions per month
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              {result.total.toLocaleString()} total matches · full-word, case-insensitive
            </div>
          </div>
          <div style={{ height: 240 }}><Bar data={chartData} options={chartOpts} /></div>
        </div>
      )}
    </div>
  );
}

const SECTION_HDR = {
  fontSize: 13, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
  color: '#8a8f99', padding: '6px 2px', margin: '4px 0 10px',
  borderBottom: '1px solid rgba(255,255,255,.1)',
};

/* StockTwits posting-volume & sentiment vs stock price (methodology §10).
   Default view = aggregate charts (bull/bear, category rolling correlations for
   every metric, plus the cross-sectional scatters). A ticker search box isolates
   a single name's charts, mirroring the Options tab. */

const CAT_COLOR = {
  'Memory Semiconductors': '#378ADD',
  'Optics':                '#1D9E75',
  'Optics Equipment':      '#EF9F27',
  'Semi Equipment':        '#D85A30',
};

const monthLabel = iso =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function lsFit(xs, ys) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (x == null || y == null || !isFinite(x) || !isFinite(y)) continue;
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const d = n * sxx - sx * sx;
  if (n < 2 || d === 0) return null;
  const m = (n * sxy - sx * sy) / d;
  return { m, b: (sy - m * sx) / n };
}

function scatterOpts({ xTitle, yTitle, xFmt = v => v, yFmt = v => v, pointLabel }) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: { display: true, position: 'bottom', labels: { color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 10, boxWidth: 10 } },
      tooltip: {
        backgroundColor: '#1a1f2a', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
        callbacks: { label: c => (pointLabel ? pointLabel(c) : ` (${xFmt(c.parsed.x)}, ${yFmt(c.parsed.y)})`) },
      },
    },
    scales: {
      x: { type: 'linear', title: { display: !!xTitle, text: xTitle, color: '#b0b0a8', font: { size: 11 } }, grid: GRID, ticks: { ...TICK, callback: v => xFmt(v) }, border: BORD },
      y: { title: { display: !!yTitle, text: yTitle, color: '#b0b0a8', font: { size: 11 } }, grid: GRID, ticks: { ...TICK, callback: v => yFmt(v) }, border: BORD },
    },
  };
}

// Multi-line-by-category rolling chart from rolling.byMetric[metric].
function catRolling(byCat) {
  if (!byCat || !Object.keys(byCat).length) return null;
  const dateSet = new Set();
  Object.values(byCat).forEach(v => v.dates.forEach(d => dateSet.add(d)));
  const dates = [...dateSet].sort();
  const datasets = Object.entries(byCat).map(([cat, v]) => {
    const m = Object.fromEntries(v.dates.map((d, i) => [d, v.values[i]]));
    return { ...mkDs(cat, CAT_COLOR[cat] ?? C.slate, dates.map(d => (d in m ? m[d] : null)), false), spanGaps: true, pointRadius: 0 };
  });
  return { labels: dates.map(monthLabel), datasets };
}

// One scatter dataset per sector.
function sectorScatter(sd, xf, yf, metaf) {
  return Object.entries(sd.categories ?? {}).map(([cat, ts]) => {
    const data = ts.map(t => {
      const v = sd.tickers[t]; if (!v) return null;
      const x = xf(v), y = yf(v);
      if (x == null || y == null || !isFinite(x) || !isFinite(y)) return null;
      return { x, y, ...metaf(t, v) };
    }).filter(Boolean);
    return data.length
      ? { label: cat, data, showLine: false, pointRadius: 5, pointHoverRadius: 7, backgroundColor: fa(CAT_COLOR[cat] ?? C.slate, 0.7), borderColor: CAT_COLOR[cat] ?? C.slate }
      : null;
  }).filter(Boolean);
}

export default function Sentiment() {
  const { liveData } = useData();
  const sd = liveData?.sentiment;
  const [input, setInput] = useState('');
  const [ticker, setTicker] = useState(null);
  const inputRef = useRef(null);

  const v = (sd && ticker && sd.tickers[ticker]) || null;
  const tkColor = v ? (CAT_COLOR[v.category] ?? C.openai) : C.openai;

  // ── Aggregate charts ──────────────────────────────────────────────────
  const aggData = useMemo(() => {
    const a = sd?.aggregate;
    if (!a?.dates?.length) return null;
    return {
      labels: a.dates.map(monthLabel),
      datasets: [
        { ...mkDs('Bullish %', C.openai, a.bullPct, true), spanGaps: true, pointRadius: 0 },
        { ...mkDs('Bearish %', C.red,    a.bearPct, true), spanGaps: true, pointRadius: 0 },
      ],
    };
  }, [sd]);

  const catVolPrice = useMemo(() => (sd ? catRolling(sd.rolling?.byMetric?.volPrice) : null), [sd]);
  const catVolNext  = useMemo(() => (sd ? catRolling(sd.rolling?.byMetric?.volNextR) : null), [sd]);
  const catSentNext = useMemo(() => (sd ? catRolling(sd.rolling?.byMetric?.sentNext) : null), [sd]);

  const levelReturns = useMemo(() => {
    if (!sd) return null;
    const ds = sectorScatter(sd, x => x.corr?.priceLevel?.r, y => y.corr?.currReturn?.r, t => ({ ticker: t }));
    return ds.length ? { datasets: ds } : null;
  }, [sd]);

  const significance = useMemo(() => {
    if (!sd) return null;
    const ds = sectorScatter(sd,
      x => x.daily?.volNextR?.r,
      y => { const p = y.daily?.volNextR?.p; return p == null ? null : -Math.log10(Math.max(p, 1e-6)); },
      (t, x) => ({ ticker: t, p: x.daily?.volNextR?.p }));
    if (!ds.length) return null;
    const xs = ds.flatMap(d => d.data.map(p => p.x));
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    for (const [lbl, p] of [['p=0.05', 0.05], ['p=0.01', 0.01]]) {
      const y = -Math.log10(p);
      ds.push({ label: lbl, data: [{ x: xmin, y }, { x: xmax, y }], showLine: true, pointRadius: 0, borderColor: fa(C.slate, 0.5), borderDash: [4, 4], borderWidth: 1, fill: false });
    }
    return { datasets: ds };
  }, [sd]);

  // ── Per-ticker charts ─────────────────────────────────────────────────
  const tkWeeklyVP = useMemo(() => {
    const w = v?.weekly; if (!w?.dates?.length) return null;
    return {
      labels: w.dates.map(monthLabel),
      datasets: [
        { ...mkDs('Weekly posts', tkColor, w.volume, false), yAxisID: 'y',  spanGaps: true, pointRadius: 0 },
        { ...mkDs('Close price', C.red,    w.price,  false), yAxisID: 'y1', spanGaps: true, pointRadius: 0 },
      ],
    };
  }, [v, tkColor]);

  const tkDailyVP = useMemo(() => {
    const d = v?.daily30; if (!d?.dates?.length) return null;
    return {
      labels: d.dates.map(monthLabel),
      datasets: [
        { ...mkDs('Daily posts', tkColor, d.volume, false), yAxisID: 'y',  spanGaps: true, pointRadius: 3, pointHoverRadius: 5 },
        { ...mkDs('Close price', C.red,   d.price,  false), yAxisID: 'y1', spanGaps: true, pointRadius: 3, pointHoverRadius: 5 },
      ],
    };
  }, [v, tkColor]);

  const tkSentiment = useMemo(() => {
    const w = v?.weekly; if (!w?.dates?.length) return null;
    return {
      labels: w.dates.map(monthLabel),
      datasets: [
        { ...mkDs('Bullish %', C.openai, w.bullPct, true), spanGaps: true, pointRadius: 0 },
        { ...mkDs('Bearish %', C.red,    w.bearPct, true), spanGaps: true, pointRadius: 0 },
      ],
    };
  }, [v]);

  const tkLeadLag = useMemo(() => {
    const s = v?.scatter; if (!s?.count?.length) return null;
    const pts = s.count.map((c, i) => ({ x: c, y: s.ret[i] })).filter(p => isFinite(p.x) && isFinite(p.y));
    const ds = [{ label: `${ticker} days`, data: pts, showLine: false, pointRadius: 3, pointHoverRadius: 5, backgroundColor: fa(tkColor, 0.5), borderColor: tkColor }];
    const f = lsFit(s.count, s.ret);
    if (f) {
      const xmin = Math.min(...s.count), xmax = Math.max(...s.count);
      ds.push({ label: 'Trend', data: [{ x: xmin, y: f.m * xmin + f.b }, { x: xmax, y: f.m * xmax + f.b }], showLine: true, pointRadius: 0, borderColor: C.red, borderDash: [5, 4], borderWidth: 1.5, fill: false });
    }
    return { datasets: ds };
  }, [v, ticker, tkColor]);

  const tkRolling = useMemo(() => {
    const r = v?.rolling; if (!r?.dates?.length) return null;
    return {
      labels: r.dates.map(monthLabel),
      datasets: [
        { ...mkDs('Vol ↔ price level',       C.openai,    r.volPrice, false), spanGaps: true, pointRadius: 0 },
        { ...mkDs('Vol → next-day return',   C.anthropic, r.volNextR, false), spanGaps: true, pointRadius: 0 },
        { ...mkDs('Sentiment → next-day',    C.minimax,   r.sentNext, false), spanGaps: true, pointRadius: 0 },
      ],
    };
  }, [v]);

  function search(raw) {
    const t = (raw ?? input).trim().toUpperCase();
    if (!t) return;
    setInput(t);
    setTicker(t);
  }

  const corrTip = c => ` ${c.raw.ticker}: (${c.parsed.x?.toFixed(2)}, ${c.parsed.y?.toFixed(2)})`;
  const asOf = sd?.asOf ? ` · as of ${sd.asOf}` : '';
  const available = sd ? Object.keys(sd.tickers) : [];

  return (
    <div className="opts-page">
      {/* Search bar — one ticker isolates its charts; empty = aggregate view */}
      <form className="opts-search-row" onSubmit={e => { e.preventDefault(); search(); }}>
        <input
          ref={inputRef}
          className="opts-input"
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          placeholder="Search a ticker — options for any (NVDA, AAPL); sentiment for tracked names (MU, SNDK)…"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
        />
        <button className="opts-search-btn" type="submit" disabled={!input.trim()}>Search</button>
        {ticker && (
          <button type="button" className="opts-search-btn" onClick={() => { setTicker(null); setInput(''); }}>
            ← Aggregate view
          </button>
        )}
      </form>

      {/* Quick-pick chips for the tracked universe */}
      {available.length > 0 && (
        <div className="opts-samples" style={{ marginTop: -4, marginBottom: 14 }}>
          {available.map(t => (
            <button key={t} className={`opts-sample${t === ticker ? ' active' : ''}`} onClick={() => search(t)}>{t}</button>
          ))}
        </div>
      )}

      {!sd ? (
        <div className="opts-loading">Loading StockTwits sentiment analysis…</div>
      ) : !ticker ? (
        /* ── Default: aggregate view ──────────────────────────────────── */
        <>
        <KeywordSearch />
        <EditableGrid viewId="sentiment">
          {aggData && (
            <ChartCard chartId="sent-aggregate" subtitle={`Share of messages tagged Bullish vs Bearish, weekly, pooled across all tracked tickers${asOf}.`}
              legend={[['Bullish %', C.openai], ['Bearish %', C.red]]} height={240} span2>
              <Line data={aggData} options={baseOpts(v2 => `${v2.toFixed(0)}%`)} />
            </ChartCard>
          )}
          {catVolNext && (
            <ChartCard chartId="sent-cat-volnext" subtitle="20-day rolling correlation of posting volume → next-day return, averaged within each sector."
              legend={catVolNext.datasets.map(d => [d.label, d.borderColor])} height={240} span2>
              <Line data={catVolNext} options={baseOpts(v2 => v2.toFixed(2))} />
            </ChartCard>
          )}
          {catVolPrice && (
            <ChartCard chartId="sent-cat-volprice" subtitle="20-day rolling correlation of posting volume vs price level, averaged within each sector."
              legend={catVolPrice.datasets.map(d => [d.label, d.borderColor])} height={240} span2>
              <Line data={catVolPrice} options={baseOpts(v2 => v2.toFixed(2))} />
            </ChartCard>
          )}
          {catSentNext && (
            <ChartCard chartId="sent-cat-sentnext" subtitle="20-day rolling correlation of net sentiment (bull−bear) → next-day return, averaged within each sector."
              legend={catSentNext.datasets.map(d => [d.label, d.borderColor])} height={240} span2>
              <Line data={catSentNext} options={baseOpts(v2 => v2.toFixed(2))} />
            </ChartCard>
          )}
          {levelReturns && (
            <ChartCard chartId="sent-level-returns" subtitle={`Each ticker: volume↔price-LEVEL (x) vs volume↔weekly-RETURN (y). Level and returns are different relationships${asOf}.`}
              height={300} span2>
              <Line data={levelReturns} options={scatterOpts({ xTitle: 'r: volume vs price level', yTitle: 'r: volume vs weekly return', xFmt: v2 => v2.toFixed(1), yFmt: v2 => v2.toFixed(1), pointLabel: corrTip })} />
            </ChartCard>
          )}
          {significance && (
            <ChartCard chartId="sent-significance" subtitle="Each ticker: volume → next-day return correlation (x) vs significance −log10(p) (y). Above the dashed lines clears p<0.05 / p<0.01."
              height={300} span2>
              <Line data={significance} options={scatterOpts({ xTitle: 'Pearson r (volume → next-day return)', yTitle: 'significance −log10(p)', xFmt: v2 => v2.toFixed(2), yFmt: v2 => v2.toFixed(1), pointLabel: c => (c.raw.ticker ? ` ${c.raw.ticker}: r=${c.parsed.x?.toFixed(3)}, p=${c.raw.p ?? '–'}` : ` ${c.dataset.label}`) })} />
            </ChartCard>
          )}
        </EditableGrid>
        </>
      ) : (
        /* ── Per-ticker view: Short interest → Options flow → StockTwits sentiment ── */
        <>
          <div style={SECTION_HDR}>Options Flow — {ticker}</div>
          <TickerPanel key={`opt-${ticker}`} ticker={ticker} />

          <div style={{ ...SECTION_HDR, marginTop: 24 }}>Short Interest — {ticker}</div>
          <div className="cgrid">
            <ShortInterestPanel key={`si-${ticker}`} ticker={ticker} />
          </div>

          <div style={{ ...SECTION_HDR, marginTop: 30 }}>StockTwits Sentiment — {ticker}</div>
          {!v ? (
            <div className="opts-empty" style={{ paddingTop: 6 }}>
              <h2>No StockTwits sentiment tracked for {ticker}</h2>
              <p>Options flow is shown above. Sentiment coverage is the semiconductor / optics supply-chain universe:</p>
              <div className="opts-samples">
                {available.map(t => <button key={t} className="opts-sample" onClick={() => search(t)}>{t}</button>)}
              </div>
            </div>
          ) : (
          <EditableGrid viewId="sentiment-ticker" key={ticker}>
          {tkWeeklyVP && (
            <ChartCard chartId="sent-tk-weekly-vp" title={`Weekly Posting Volume vs Price — ${ticker}`}
              subtitle={`Weekly post count (left) against the week's closing price (right). ${v.category} · ${v.totalPosts.toLocaleString()} total posts.`}
              legend={[['Weekly posts', tkColor], ['Close price', C.red]]} height={260} span2>
              <Line data={tkWeeklyVP} options={dualAxisOpts(v2 => v2.toLocaleString(), v2 => `$${v2.toFixed(0)}`)} />
            </ChartCard>
          )}
          {tkDailyVP && (
            <ChartCard chartId="sent-tk-daily-vp" title={`Daily Posting Volume vs Price — ${ticker} (rolling 30 days)`}
              subtitle="Daily post count (left) against closing price (right) for the most recent 30 trading days with both price and post data."
              legend={[['Daily posts', tkColor], ['Close price', C.red]]} height={260} span2>
              <Line data={tkDailyVP} options={dualAxisOpts(v2 => v2.toLocaleString(), v2 => `$${v2.toFixed(2)}`)} />
            </ChartCard>
          )}
          {tkSentiment && (
            <ChartCard chartId="sent-tk-sentiment" title={`Bullish vs Bearish — ${ticker}`}
              subtitle="Weekly share of this ticker's messages tagged Bullish vs Bearish."
              legend={[['Bullish %', C.openai], ['Bearish %', C.red]]} height={260} span2>
              <Line data={tkSentiment} options={baseOpts(v2 => `${v2.toFixed(0)}%`)} />
            </ChartCard>
          )}
          {tkLeadLag && (
            <ChartCard chartId="sent-tk-leadlag" title={`Daily Post Count vs Next-Day Return — ${ticker}`}
              subtitle={`Each point is one trading day. Dashed = fitted trend. r=${v.daily?.volNextR?.r ?? '–'} (p=${v.daily?.volNextR?.p ?? '–'}, n=${v.daily?.volNextR?.n ?? '–'}).`}
              height={300} span2>
              <Line data={tkLeadLag} options={scatterOpts({ xTitle: 'Daily post count', yTitle: 'Next-day return (%)', xFmt: v2 => v2.toLocaleString(), yFmt: v2 => `${v2.toFixed(0)}%`, pointLabel: c => ` (${c.parsed.x?.toLocaleString()} posts, ${c.parsed.y?.toFixed(2)}%)` })} />
            </ChartCard>
          )}
          {tkRolling && (
            <ChartCard chartId="sent-tk-rolling" title={`Rolling 20-Day Correlations — ${ticker}`}
              subtitle="This ticker's three rolling correlations over time: volume↔price level, volume→next-day return, and net sentiment→next-day return."
              legend={tkRolling.datasets.map(d => [d.label, d.borderColor])} height={280} span2>
              <Line data={tkRolling} options={baseOpts(v2 => v2.toFixed(2))} />
            </ChartCard>
          )}
          </EditableGrid>
          )}
        </>
      )}
    </div>
  );
}
