import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';

/**
 * Retail leverage — the borrowed money behind an Asian market, stacked, one
 * point per trading day.
 *
 * Two layers, ordered by leverage: margin loans, then the 2× ETFs on top. Cash
 * layers (Korean broker deposits and CMA sweep balances) are deliberately not
 * here — they are dry powder, not leverage, and stacking them made the chart
 * about liquidity rather than about borrowing.
 *
 * The two markets do not disclose equally, and the page shows that rather than
 * papering over it — see each market's `note`.
 */

// Colours are validated for the dark chart surface (#111419): OKLCH lightness
// band, chroma floor, adjacent-pair CVD separation and ≥3:1 contrast all pass.
// Don't brighten these by eye — re-run the palette validator.
const TEAL = '#299682', BLUE = '#4577b4', ORANGE = '#ad622d', PURPLE = '#7864b4';
const RATIO = '#59c7b5';

// Keep collecting and rescaling the ratio series, but leave it off the chart
// until the comparison is ready to be shown again.
const SHOW_MARKET_CAP_RATIO = false;

/** Series hue as a translucent wash — stacked bands read as layered glass over
 * the grid rather than opaque blocks, while staying a distinct fill per layer. */
function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

const MARKETS = {
  korea: {
    id: 'korea',
    label: 'Korea',
    endpoint: '/api/korea-leverage',
    // The API serves trillions of won, which is also how Korea quotes it.
    scale: 1,
    unit: 'T',
    title: 'Korean retail leverage · three borrowed layers',
    // Each layer links to the exact table it is read from, not to a site root.
    layers: [
      {
        key: 'collateral', label: 'Securities-collateral loans', color: BLUE,
        srcLabel: 'KOFIA credit balances',
        srcUrl: 'https://freesis.kofia.or.kr/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=STATSCU0100000070',
      },
      {
        key: 'margin', label: 'Margin loans', color: ORANGE,
        srcLabel: 'KOFIA credit balances',
        srcUrl: 'https://freesis.kofia.or.kr/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=STATSCU0100000070',
      },
      {
        key: 'etf', label: '2× leveraged ETFs', color: PURPLE,
        srcLabel: 'Daum ETF data',
        srcUrl: 'https://finance.daum.net/domestic/etf',
        srcExtra: {
          label: 'HKEXnews filings',
          url: 'https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en',
        },
      },
    ],
    fundsTitle: 'Leveraged ETF layer · by fund',
  },
  taiwan: {
    id: 'taiwan',
    label: 'Taiwan',
    endpoint: '/api/taiwan-leverage',
    // The API serves 億元 (hundred-million NT$), the unit Taiwan quotes; the page
    // shows NT$ billions so both markets read in plain English units.
    scale: 0.1,
    unit: 'B',
    title: 'Taiwan retail leverage · margin loans + 2× ETFs',
    // The margin band is two exchanges summed, so it carries two links.
    layers: [
      {
        key: 'margin', label: 'Margin loans', color: ORANGE,
        srcLabel: 'TWSE margin data',
        srcUrl: 'https://www.twse.com.tw/zh/trading/margin/mi-margn.html',
        srcExtra: {
          label: 'TPEx margin data',
          url: 'https://www.tpex.org.tw/zh-tw/mainboard/trading/margin-trading/transactions.html',
        },
      },
      {
        key: 'etf', label: '2× leveraged ETFs', color: PURPLE,
        srcLabel: 'Yuanta fund data',
        srcUrl: 'https://www.yuantaetfs.com/tradeInfo/comparison/00631L/historical',
        srcExtra: {
          label: 'Fubon fund data',
          url: 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx?stkId=00675L',
        },
      },
    ],
    ratio: {
      key: 'leverageRatio',
      label: 'Margin + 2× ETFs / market cap',
      color: RATIO,
      sources: [
        {
          label: 'TWSE market cap',
          url: 'https://www.twse.com.tw/en/trading/statistics/week.html',
        },
        {
          label: 'TPEx market cap',
          url: 'https://www.tpex.org.tw/zh-tw/mainboard/trading/historical/market-value.html',
        },
      ],
    },
    fundsTitle: 'Leveraged ETF layer · by fund',
  },
};

const SURFACE = '#111419';
const INK     = '#e8e6e3';
const MUTED   = '#8a8a84';

const RANGES = [
  { id: '3m',  label: '3M',  days: 92 },
  { id: 'ytd', label: 'YTD', days: null },
  { id: '12m', label: '12M', days: 366 },
  { id: '5y',  label: '5Y',  days: 1830 },
];

function dayLabel(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function monthLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(d.getUTCFullYear()).slice(-2)}`;
}

/**
 * Convert the payload into the market's display unit once, at the door, so the
 * chart, tiles, reference lines and fund table can never disagree about units.
 */
function rescale(payload, market) {
  const k = market.scale ?? 1;
  if (k === 1) return payload;
  const arr = a => (Array.isArray(a) ? a.map(v => (Number.isFinite(v) ? v * k : null)) : a);
  const moneyKeys = new Set([
    'total', 'marketSize', 'marketSizeListed', 'marketSizeOtc',
    ...market.layers.map(l => l.key),
  ]);
  return {
    ...payload,
    total: arr(payload.total),
    ...Object.fromEntries(market.layers.map(l => [l.key, arr(payload[l.key])])),
    marketSize: arr(payload.marketSize),
    marketSizeListed: arr(payload.marketSizeListed),
    marketSizeOtc: arr(payload.marketSizeOtc),
    funds: (payload.funds ?? []).map(f => ({ ...f, aum: f.aum * k })),
    etfMarket: payload.etfMarket ? { ...payload.etfMarket, total: payload.etfMarket.total * k } : null,
    latest: Object.fromEntries(Object.entries(payload.latest ?? {}).map(
      ([key, v]) => [key, moneyKeys.has(key) && Number.isFinite(v) ? v * k : v])),
  };
}

/**
 * A layer only earns a place in the stack once it has enough history to be a
 * shape rather than a spike — a band drawn from one observation is a vertical
 * cliff, and it drags the window's change with it. Both layers clear this today;
 * it stays as a guard for a newly-added fund or feed.
 */
const MIN_HISTORY = 20;

function stackedLayers(data, market) {
  return market.layers.filter(l => (data?.[l.key] ?? []).filter(Number.isFinite).length >= MIN_HISTORY);
}

/** Slice every series to the selected window. */
function windowed(data, market, range) {
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
  const cut = arr => (arr ?? []).slice(from);
  const shown = stackedLayers(data, market);
  const layers = Object.fromEntries(shown.map(l => [l.key, cut(data[l.key])]));
  // Total is summed from the layers actually drawn, so the line always equals
  // the top of the stack — it can't be inflated by a layer the chart is holding
  // back for want of history.
  const total = cut(dates).map((_, i) => shown.reduce((s, l) => s + (layers[l.key][i] ?? 0), 0));
  const ratio = market.ratio ? cut(data[market.ratio.key]) : [];
  return { dates: cut(dates), total, layers, shown, ratio };
}

export function LeverageKorea()  { return <Leverage marketId="korea" />; }
export function LeverageTaiwan() { return <Leverage marketId="taiwan" />; }

export default function Leverage({ marketId = 'korea' }) {
  const [rangeId, setRangeId] = useState('12m');
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  const market = MARKETS[marketId];
  const range = RANGES.find(r => r.id === rangeId) ?? RANGES[2];
  const fmt   = v => (v == null ? '—' : `${v.toFixed(1)}${market.unit}`);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(market.endpoint)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(j => { if (live) setData(rescale(j, market)); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [market]);

  const win  = useMemo(() => windowed(data, market, range), [data, market, range]);
  const ratioVisible = Boolean(
    SHOW_MARKET_CAP_RATIO && market.ratio && win?.ratio?.some(Number.isFinite)
  );

  const chart = useMemo(() => {
    if (!win) return null;
    const long = win.dates.length > 200;
    return {
      labels: win.dates.map(long ? monthLabel : dayLabel),
      datasets: [
        ...win.shown.map(l => ({
          label: l.label,
          data: win.layers[l.key],
          // A wash, not a saturated block — the grid stays legible through
          // the fill and the stack reads as layered glass, not stacked paint.
          backgroundColor: alpha(l.color, 0.55),
          // A 2px gap in the surface colour between stacked bands, so adjacent
          // fills read as separate volumes instead of one gradient.
          borderColor: SURFACE,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: l.color,
          pointHoverBorderColor: SURFACE,
          pointHoverBorderWidth: 2,
          tension: 0.25,
          fill: true,
          stack: 'firepower',
          order: 10,
        })),
        {
          label: 'Total',
          data: win.total,
          stack: 'total',
          borderColor: INK,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: INK,
          pointHoverBorderColor: SURFACE,
          pointHoverBorderWidth: 2,
          tension: 0.25,
          fill: false,
          order: 0,
        },
        ...(ratioVisible ? [{
          label: market.ratio.label,
          data: win.ratio,
          yAxisID: 'ratio',
          borderColor: market.ratio.color,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: market.ratio.color,
          pointHoverBorderColor: SURFACE,
          pointHoverBorderWidth: 2,
          tension: 0.25,
          fill: false,
          order: -1,
          isRatio: true,
        }] : []),
      ],
    };
  }, [win, market, ratioVisible]);

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
        callbacks: {
          title: items => (items.length ? win.dates[items[0].dataIndex] : ''),
          label: c => {
            const value = c.dataset.isRatio ? `${Number(c.raw).toFixed(2)}%` : fmt(c.raw);
            return ` ${c.dataset.label}: ${value}`;
          },
        },
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
        // Bumped from the usual hairline (.04) so the grid still reads through
        // the now-translucent fills instead of disappearing under the wash.
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: v => `${v}${market.unit}`, font: { size: 10 } },
      },
      ...(ratioVisible ? {
        ratio: {
          type: 'linear',
          position: 'right',
          beginAtZero: false,
          grace: '8%',
          grid: { drawOnChartArea: false },
          ticks: {
            color: market.ratio.color,
            maxTicksLimit: 7,
            callback: v => `${Number(v).toFixed(2)}%`,
            font: { size: 10 },
          },
        },
      } : {}),
    },
  }), [market, win, ratioVisible]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggles = (
    <div className="lev-toggles">
      <div className="view-toggle">
        {RANGES.map(r => (
          <button
            key={r.id}
            className={`vt-btn${r.id === rangeId ? ' active' : ''}`}
            onClick={() => setRangeId(r.id)}
          >{r.label}</button>
        ))}
      </div>
    </div>
  );

  if (error || !data || !win || !chart) {
    return (
      <>
        <div className="lev-head"><div />{toggles}</div>
        <div className="empty">
          {error
            ? `${market.label} leverage data unavailable: ${error}`
            : `Loading ${market.label} leverage data…`}
        </div>
      </>
    );
  }

  const { latest, funds } = data;
  const latestTotal = win.total[win.total.length - 1];
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          <Tile label="Total firepower" value={fmt(latestTotal)} color={INK} />
          {market.layers.map(l => (
            <Tile key={l.key} label={l.label} value={fmt(latest[l.key])} color={l.color} />
          ))}
        </div>
        {toggles}
      </div>

      <ChartCard
        chartId={`${market.id}-leverage-stack`}
        title={market.title}
        src={<SourceLinks layers={market.layers} />}
        freq="Daily"
        span2
        height={430}
        legend={[
          ...win.shown.map(l => [l.label, l.color]),
        ]}
      >
        <Line data={chart} options={opts} />
      </ChartCard>

      <ChartCard
        chartId={`${market.id}-leverage-funds`}
        title={market.fundsTitle}
        src={<SourceLinks layers={market.layers.filter(l => l.key === 'etf')} />}
        freq="Daily"
        span2
        fillBody
        height={Math.max(220, 34 + (funds?.length ?? 0) * 26)}
      >
        <table className="lev-table">
          <thead>
            <tr>
              <th>Fund</th>
              {marketId === 'korea' && <th>Type</th>}
              <th className="num">Net assets</th>
              <th className="num">Share of layer</th>
            </tr>
          </thead>
          <tbody>
            {(funds ?? []).map(f => (
              <tr key={f.code}>
                <td>{f.name} <span className="lev-code">{f.code}</span></td>
                {marketId === 'korea' && (
                  <td className="lev-kind">
                    {f.kind === 'hk' ? 'Single-stock 2× (HK)' : f.kind === 'single' ? 'Single-stock 2×' : 'Index 2×'}
                  </td>
                )}
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

/**
 * The source row under the chart: one link per table actually queried, rather
 * than a single link to a site's front door. Taiwan's margin band is two
 * exchanges summed, so it lists both.
 */
function SourceLinks({ layers }) {
  const entries = layers.flatMap(l => [
    { label: l.srcLabel, url: l.srcUrl, color: l.color },
    ...(l.srcExtra ? [{ label: l.srcExtra.label, url: l.srcExtra.url, color: l.color }] : []),
  ]);
  // Both Korean credit layers come out of one KOFIA table — list it once.
  const seen = new Set();
  const unique = entries.filter(e => (seen.has(e.label) ? false : seen.add(e.label)));

  return (
    <span className="lev-srcs">
      {unique.map(e => (
        <a key={e.label} className="ch-src" href={e.url} target="_blank" rel="noopener noreferrer">
          <span className="lev-dot" style={{ background: e.color }} />{e.label}
        </a>
      ))}
    </span>
  );
}

function Tile({ label, value, color }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label"><span className="lev-dot" style={{ background: color }} />{label}</div>
      <div className="lev-tile-value">{value}</div>
    </div>
  );
}
