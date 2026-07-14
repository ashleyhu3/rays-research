import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';

/**
 * Korean retail firepower — the four layers of household money behind the
 * KOSPI, stacked, one point per trading day.
 *
 * The layers are ordered by leverage, innermost first: CMA sweep cash, broker
 * deposits, margin loans, then 2× ETFs. That ordering is the point of the chart
 * — a de-levering cycle peels the stack from the outside in, so the top band
 * moving while the bottom two sit still says the core hasn't sold yet.
 */

// Validated for the dark chart surface (#111419): OKLCH lightness band, chroma
// floor, adjacent-pair CVD separation (worst ΔE 35 protan / 13 tritan) and ≥3:1
// contrast all pass. Don't brighten these by eye — re-run the palette validator.
const LAYERS = [
  { key: 'cma',     label: 'CMA 잔고',    en: 'CMA sweep cash', color: '#299682' },
  { key: 'deposit', label: '투자자예탁금', en: 'Broker deposits', color: '#4577b4' },
  { key: 'margin',  label: '신용거래융자', en: 'Margin loans',    color: '#ad622d' },
  { key: 'etf',     label: '레버리지 ETF', en: '2× leveraged ETFs', color: '#7864b4' },
];

const SURFACE = '#111419';
const INK     = '#e8e6e3';
const MUTED   = '#8a8a84';

const RANGES = [
  { id: '3m',  label: '3M',  days: 92 },
  { id: 'ytd', label: 'YTD', days: null },
  { id: '12m', label: '12M', days: 366 },
  { id: '5y',  label: '5Y',  days: 1830 },
];

const fmt = v => (v == null ? '—' : `${v.toFixed(1)}조`);
const pct = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function monthLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(d.getUTCFullYear()).slice(-2)}`;
}

/** Slice every series to the selected window. */
function windowed(data, range) {
  if (!data?.dates?.length) return null;
  const { dates } = data;
  let from = 0;
  if (range.id === 'ytd') {
    const year = dates[dates.length - 1].slice(0, 4);
    from = dates.findIndex(d => d >= `${year}-01-01`);
  } else if (range.days) {
    const cutoff = new Date(new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime() - range.days * 86400000)
      .toISOString().slice(0, 10);
    from = dates.findIndex(d => d >= cutoff);
  }
  if (from < 0) from = 0;
  const cut = arr => arr.slice(from);
  return {
    dates: cut(dates),
    total: cut(data.total),
    layers: Object.fromEntries(LAYERS.map(l => [l.key, cut(data[l.key] ?? [])])),
  };
}

/**
 * The horizontal markers, derived from the data rather than hard-coded — a line
 * whose number is frozen in source stops meaning anything the day after it's
 * written. Each one is a level the market has actually paid for before.
 */
function refLines(data, win) {
  if (!data?.dates?.length || !win?.dates?.length) return [];
  const at = iso => {
    const i = data.dates.findIndex(d => d >= iso);
    return i < 0 ? null : data.total[i];
  };
  const year = data.dates[data.dates.length - 1].slice(0, 4);
  const out = [
    { label: `Window start · ${win.dates[0]}`, value: win.total[0], color: '#6b7280', dash: [1, 3] },
    { label: `Year open · ${year}-01`,          value: at(`${year}-01-01`), color: '#b58a2a', dash: [2, 4] },
    { label: `Q2 base · ${year}-04`,            value: at(`${year}-04-01`), color: '#c65d57', dash: [6, 4] },
  ];
  return out.filter(r => Number.isFinite(r.value));
}

export default function Leverage() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [rangeId, setRangeId] = useState('12m');
  const range = RANGES.find(r => r.id === rangeId) ?? RANGES[2];

  useEffect(() => {
    let live = true;
    fetch('/api/korea-leverage')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(j => { if (live) setData(j); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const win  = useMemo(() => windowed(data, range), [data, range]);
  const refs = useMemo(() => refLines(data, win), [data, win]);

  const chart = useMemo(() => {
    if (!win) return null;
    const long = win.dates.length > 200;
    return {
      labels: win.dates.map(long ? monthLabel : dayLabel),
      datasets: [
        ...LAYERS.map(l => ({
          label: `${l.label} · ${l.en}`,
          data: win.layers[l.key],
          backgroundColor: l.color,
          // A 2px gap in the surface colour between stacked bands, so adjacent
          // fills read as separate volumes instead of one gradient.
          borderColor: SURFACE,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
          fill: true,
          stack: 'firepower',
        })),
        {
          label: 'Total',
          data: win.total,
          stack: 'total',
          borderColor: INK,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
          fill: false,
        },
        ...refs.map((r, i) => ({
          label: r.label,
          data: win.dates.map(() => r.value),
          stack: `ref${i}`,
          borderColor: r.color,
          borderWidth: 1.5,
          borderDash: r.dash,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
        })),
      ],
    };
  }, [win, refs]);

  const opts = useMemo(() => ({
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
        padding: 10,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        // Reference lines are context, not readings — keep them out of the hover.
        filter: item => item.datasetIndex <= LAYERS.length,
        callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: MUTED, maxTicksLimit: 12, autoSkip: true, maxRotation: 0, font: { size: 10 } },
      },
      y: {
        stacked: true,
        // A stacked area encodes each layer as a height, so the baseline has to
        // be zero — a cropped axis silently misstates every band's size.
        beginAtZero: true,
        grid: { color: 'rgba(255,255,255,.04)' },
        ticks: { color: MUTED, callback: v => `${v}조`, font: { size: 10 } },
      },
    },
  }), []);

  if (error) return <div className="empty">Leverage data unavailable: {error}</div>;
  if (!data || !win) return <div className="empty">Loading Korean leverage data…</div>;

  const { latest, funds, carriedFrom } = data;
  const first = win.total[0];
  const chg = first ? ((latest.total - first) / first) * 100 : null;

  // KOFIA publishes 1–3 days behind the ETF layer; say which layers are showing
  // a carried-forward value rather than letting a flat line imply fresh data.
  const stale = LAYERS.filter(l => carriedFrom?.[l.key]).map(l => l.en);

  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          <Tile label="Total firepower" value={fmt(latest.total)} sub={`${range.label} ${pct(chg)}`} color={INK} />
          {LAYERS.map(l => (
            <Tile key={l.key} label={l.en} value={fmt(latest[l.key])} sub={l.label} color={l.color} />
          ))}
        </div>
        <div className="view-toggle lev-range">
          {RANGES.map(r => (
            <button
              key={r.id}
              className={`vt-btn${r.id === rangeId ? ' active' : ''}`}
              onClick={() => setRangeId(r.id)}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <ChartCard
        chartId="korea-leverage-stack"
        title="Korean retail firepower · four leveraged layers"
        src="KOFIA FreeSIS (증시자금추이 · 신용공여 잔고추이 · CMA잔고 추이) + Daum Finance ETF net assets"
        srcUrl="https://freesis.kofia.or.kr/"
        freq="Daily"
        lag={stale.length ? `KOFIA publishes 1–3 days late — ${stale.join(', ')} carried forward from ${carriedFrom[LAYERS.find(l => carriedFrom[l.key]).key]}` : 'Same day'}
        span2
        height={430}
        legend={[
          ...LAYERS.map(l => [`${l.en} · ${l.label}`, l.color]),
          ['Total', INK],
          ...refs.map(r => [r.label, r.color]),
        ]}
        srcNote={
          'Trillions of won (조원), one point per trading day. Cash and credit layers are KOFIA daily actuals. ' +
          'The ETF layer is every 2× fund a Korean retail investor can buy — the two KOSPI200 leveraged funds, plus the ' +
          'single-stock (Samsung / SK Hynix) leveraged funds that opened on 2026-05-27 — and each fund\'s net assets are ' +
          'recomputed exactly as closing price × that day\'s shares outstanding, not estimated. CSOP 7709.HK (the HK-listed ' +
          'SK Hynix 2×) is excluded: no free daily AUM feed exists, and guessing it would put an estimate inside a measured layer.'
        }
      >
        <Line data={chart} options={opts} />
      </ChartCard>

      <ChartCard
        chartId="korea-leverage-funds"
        title={`Leveraged ETF layer · by fund${data.fundsDate ? ` · ${data.fundsDate}` : ''}`}
        src="Daum Finance"
        srcUrl="https://finance.daum.net/domestic/all_etfs"
        freq="Daily"
        span2
        fillBody
        height={Math.max(220, 34 + funds.length * 26)}
        srcNote="Net assets = closing price × shares outstanding, per fund, per day. Single-stock 2× funds are the memory trade (Samsung Electronics / SK Hynix); index 2× funds track KOSPI200."
      >
        <table className="lev-table">
          <thead>
            <tr><th>Fund</th><th>Type</th><th className="num">Net assets</th><th className="num">Share of layer</th></tr>
          </thead>
          <tbody>
            {funds.map(f => (
              <tr key={f.code}>
                <td>{f.name}</td>
                <td className="lev-kind">{f.kind === 'single' ? 'Single-stock 2×' : 'Index 2×'}</td>
                <td className="num">{fmt(f.aum)}</td>
                <td className="num">{latest.etf ? `${((f.aum / latest.etf) * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </>
  );
}

function Tile({ label, value, sub, color }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label"><span className="lev-dot" style={{ background: color }} />{label}</div>
      <div className="lev-tile-value">{value}</div>
      <div className="lev-tile-sub">{sub}</div>
    </div>
  );
}
