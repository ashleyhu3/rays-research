import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';
import { fa } from '../../config/colors';

const SAMPLES = ['2383', '2330', '2317', '2454', '3231', '2382'];

const MARGIN_COLOR = '#4577b4';   // 融資
const SHORT_COLOR  = '#c65d57';   // 融券
const PRICE_COLOR  = '#c9a227';   // stock price, shared across both charts

const RANGES = [
  { id: '3m', label: '3M', days: 92 },
  { id: '6m', label: '6M', days: 183 },
  { id: '1y', label: '1Y', days: 366 },
];

// Parse a comma/space-separated code string into an ordered, de-duplicated list.
function parseCodes(str) {
  const seen = new Set();
  const out = [];
  for (const raw of (str ?? '').split(/[,\s]+/)) {
    const t = raw.trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

function dayLabel(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

const fmtLots = v => (v == null ? '—' : `${Number(v).toLocaleString()} 張`);
const fmtRatio = v => (v == null ? '—' : `${Number(v).toFixed(2)}×`);
const fmtShares = v => (v == null ? '—' : Number(v).toLocaleString());
const fmtPrice = v => (v == null ? '—' : `NT$${Number(v).toFixed(2)}`);

// Slice a side's aligned series down to the selected trailing window.
function windowed(side, range) {
  if (!side?.dates?.length) return null;
  const { dates } = side;
  let from = 0;
  if (range.days) {
    const cutoff = new Date(
      new Date(`${dates.at(-1)}T00:00:00Z`).getTime() - range.days * 86400000,
    ).toISOString().slice(0, 10);
    from = dates.findIndex(d => d >= cutoff);
  }
  if (from < 0) from = 0;
  const cut = arr => (arr ?? []).slice(from);
  return {
    dates: cut(dates),
    balanceLots: cut(side.balanceLots),
    changeLots: cut(side.changeLots),
    dayVolume: cut(side.dayVolume),
    daysOfVolume: cut(side.daysOfVolume),
    close: cut(side.close),
  };
}

function chartData(win, color) {
  return {
    labels: win.dates.map(dayLabel),
    datasets: [
      {
        label: 'Balance ÷ daily volume',
        data: win.daysOfVolume,
        borderColor: color,
        backgroundColor: fa(color, 0.10),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color,
        tension: 0.25,
        fill: true,
        spanGaps: false,
        yAxisID: 'y',
      },
      {
        label: 'Stock price',
        data: win.close,
        borderColor: PRICE_COLOR,
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [4, 3],
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: PRICE_COLOR,
        tension: 0.25,
        fill: false,
        spanGaps: true,
        yAxisID: 'y1',
      },
    ],
  };
}

function chartOptions(win) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: { color: '#8a8a84', font: { size: 10, family: "'Inter',sans-serif" }, boxWidth: 10, padding: 8 },
      },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        padding: 10,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        callbacks: {
          title: items => (items.length ? win.dates[items[0].dataIndex] : ''),
          label: c => (c.dataset.yAxisID === 'y1'
            ? ` Price: ${fmtPrice(c.raw)}`
            : ` ${fmtRatio(c.raw)} daily volume`),
          afterBody: items => {
            const i = items[0]?.dataIndex;
            if (i == null) return '';
            return [
              `Balance: ${fmtLots(win.balanceLots[i])}`,
              `Volume: ${fmtShares(win.dayVolume[i])} shares`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { ...TICK, maxTicksLimit: 10, autoSkip: true, maxRotation: 0, font: { size: 10 } },
        border: BORD,
      },
      y: {
        position: 'left',
        beginAtZero: true,
        grace: '5%',
        grid: GRID,
        ticks: { ...TICK, callback: v => `${v}×`, font: { size: 10 } },
        border: BORD,
        title: { display: true, text: 'Balance ÷ daily volume', color: '#8a8a84', font: { size: 10, family: "'Inter',sans-serif" } },
      },
      y1: {
        position: 'right',
        grace: '5%',
        grid: { drawOnChartArea: false },
        ticks: { ...TICK, callback: v => `${v}`, font: { size: 10 } },
        border: BORD,
        title: { display: true, text: 'Price (NT$)', color: '#8a8a84', font: { size: 10, family: "'Inter',sans-serif" } },
      },
    },
  };
}

function SideChart({ title, side, color, range }) {
  const win = useMemo(() => windowed(side, range), [side, range]);
  if (!win || !win.dates.length) {
    return (
      <div className="tm-chart-block">
        <h4 className="tm-chart-title" style={{ color }}>{title}</h4>
        <div className="opts-loading">No data for this range.</div>
      </div>
    );
  }
  const latestBal = [...win.balanceLots].reverse().find(Number.isFinite);
  const latestRatio = [...win.daysOfVolume].reverse().find(Number.isFinite);
  return (
    <div className="tm-chart-block">
      <div className="tm-chart-head">
        <h4 className="tm-chart-title" style={{ color }}>{title}</h4>
        <div className="tm-chart-stat">
          {fmtLots(latestBal)} · <span style={{ color }}>{fmtRatio(latestRatio)}</span> daily volume
        </div>
      </div>
      <div className="tm-chart-canvas">
        <Line data={chartData(win, color)} options={chartOptions(win)} />
      </div>
    </div>
  );
}

/* One company's margin/short panel — owns its own fetch, so each code in a
   multi-code search behaves independently. */
export function MarginPanel({ code }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rangeId, setRangeId] = useState('6m');
  const range = RANGES.find(r => r.id === rangeId) ?? RANGES[1];

  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null); setLoading(true);
    fetch(`/api/taiwan-margin/${code}`)
      .then(async res => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then(json => { if (!cancelled) setData(json); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  if (error)            return <div className="opts-panel"><div className="opts-error">⚠ {code}: {error}</div></div>;
  if (!data && loading) return <div className="opts-panel"><div className="opts-loading">Fetching {code} margin balances…</div></div>;
  if (!data)            return null;

  return (
    <div className="opts-panel tm-panel">
      <div className="tm-header">
        <div>
          <span className="opts-ticker-sym">{data.code}</span>
          <span className="tm-name">{data.shortName}{data.category ? ` · ${data.category}` : ''}</span>
        </div>
        <div className="view-toggle">
          {RANGES.map(r => (
            <button
              key={r.id}
              className={`vt-btn${r.id === rangeId ? ' active' : ''}`}
              onClick={() => setRangeId(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="tm-charts">
        <SideChart title="融資 Margin balance" side={data.purchase} color={MARGIN_COLOR} range={range} />
        <SideChart title="融券 Short-sale balance" side={data.shortSale} color={SHORT_COLOR} range={range} />
      </div>
      <p className="opts-footer">
        Balance in 張 (1 張 = 1,000 shares) shown as a multiple of that day's traded shares · TWSE · 1-year history
      </p>
    </div>
  );
}

function WaveIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

/* Standalone "Taiwan individual" page — search any TWSE-listed stock code and
   see its 融資 / 融券 balance measured against that stock's own daily volume. */
export default function TaiwanIndividual() {
  const [input, setInput] = useState('');
  const [codes, setCodes] = useState([]);
  const inputRef = useRef(null);

  function search(raw) {
    const list = parseCodes(raw ?? input);
    if (!list.length) return;
    setInput(list.join(', '));
    setCodes(list);
  }

  const isEmpty = codes.length === 0;

  return (
    <div className="opts-page">
      <form className="opts-search-row" onSubmit={e => { e.preventDefault(); search(); }}>
        <input
          ref={inputRef}
          className="opts-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="TWSE stock code(s), comma-separated — 2383, 2330, 2317…"
          spellCheck={false}
          autoComplete="off"
        />
        <button className="opts-search-btn" type="submit" disabled={!input.trim()}>Search</button>
      </form>

      {isEmpty ? (
        <div className="opts-empty">
          <div className="opts-empty-icon"><WaveIcon /></div>
          <h2>Taiwan Individual</h2>
          <p>
            Per-stock 融資 (margin) and 融券 (short-sale) balances for any TWSE-listed code, shown
            as a multiple of that stock's own daily trading volume — how many sessions of volume the
            borrowed position represents. Search several codes at once (comma-separated). One year of history.
          </p>
          <div className="opts-samples">
            {SAMPLES.map(c => (
              <button key={c} className="opts-sample" onClick={() => search(c)}>{c}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="opts-multi tm-results">
          {codes.map(c => <MarginPanel key={c} code={c} />)}
        </div>
      )}
    </div>
  );
}
