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

const MARKETS = {
  korea: {
    id: 'korea',
    label: 'Korea',
    endpoint: '/api/korea-leverage',
    // The API serves trillions of won, which is also how Korea quotes it.
    scale: 1,
    unit: 'T',
    unitName: 'trillions of won (KRW tn)',
    title: 'Korean retail leverage · three borrowed layers',
    // Each layer links to the exact table it is read from, not to a site root.
    layers: [
      {
        key: 'collateral', label: 'Securities-collateral loans', color: BLUE,
        srcLabel: 'KOFIA · 신용공여 잔고 추이 (예탁증권 담보융자 column)',
        srcUrl: 'https://freesis.kofia.or.kr/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=STATSCU0100000070',
      },
      {
        key: 'margin', label: 'Margin loans', color: ORANGE,
        srcLabel: 'KOFIA · 신용공여 잔고 추이 (신용거래융자 column)',
        srcUrl: 'https://freesis.kofia.or.kr/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=STATSCU0100000070',
      },
      {
        key: 'etf', label: '2× leveraged ETFs', color: PURPLE,
        srcLabel: 'Daum Finance · ETF listing (close × shares outstanding)',
        srcUrl: 'https://finance.daum.net/domestic/etf',
      },
    ],
    fundsTitle: 'Leveraged ETF layer · by fund',
    fundsSrc: 'Daum Finance · ETF listing',
    fundsSrcUrl: 'https://finance.daum.net/domestic/etf',
    note:
      'Margin loans are the KOFIA daily all-market 신용거래융자 balance; securities-collateral loans are 예탁증권 담보융자 from the '
      + 'same table — borrowing against pledged shares, which unlike margin can be drawn out of the account, so it is credit extended '
      + 'on the same collateral but not necessarily money in the market. The ETF layer is every 2× fund a Korean retail investor can '
      + 'buy — the two KOSPI200 leveraged funds, plus the single-stock (Samsung / SK Hynix) leveraged funds that opened on '
      + "2026-05-27 — and each fund's net assets are recomputed exactly as closing price × that day's shares outstanding, not "
      + 'estimated. CSOP 7709.HK (the HK-listed SK Hynix 2×) is excluded: no free daily AUM feed exists, and guessing it would put '
      + 'an estimate inside a measured layer. Cash layers (broker deposits, CMA) are not charted — they are dry powder, not leverage.',
    fundsNote:
      'Net assets = closing price × shares outstanding, per fund, per day. Single-stock 2× funds are the memory trade (Samsung '
      + 'Electronics / SK Hynix); index 2× funds track KOSPI200.',
  },
  taiwan: {
    id: 'taiwan',
    label: 'Taiwan',
    endpoint: '/api/taiwan-leverage',
    // The API serves 億元 (hundred-million NT$), the unit Taiwan quotes; the page
    // shows NT$ billions so both markets read in plain English units.
    scale: 0.1,
    unit: 'B',
    unitName: 'billions of NT$ (NT$ bn)',
    title: 'Taiwan retail leverage · margin loans + 2× ETFs',
    // The margin band is two exchanges summed, so it carries two links.
    layers: [
      {
        key: 'margin', label: 'Margin loans', color: ORANGE,
        srcLabel: 'TWSE · 信用交易統計 (MI_MARGN, 融資金額)',
        srcUrl: 'https://www.twse.com.tw/zh/trading/margin/mi-margn.html',
        srcExtra: {
          label: 'TPEx · 上櫃股票融資融券餘額 (融資金 summary row)',
          url: 'https://www.tpex.org.tw/zh-tw/mainboard/trading/margin-trading/transactions.html',
        },
      },
      {
        key: 'etf', label: '2× leveraged ETFs', color: PURPLE,
        srcLabel: 'Yuanta · 歷史淨值 (FUND_SIZE)',
        srcUrl: 'https://www.yuantaetfs.com/tradeInfo/comparison/00631L/historical',
      },
    ],
    fundsTitle: 'Leveraged ETF layer · by fund',
    fundsSrc: 'Yuanta · 歷史淨值 (FUND_SIZE)',
    fundsSrcUrl: 'https://www.yuantaetfs.com/tradeInfo/comparison/00631L/historical',
    note:
      'Margin loans are the whole borrowing market: the TWSE listed balance plus the TPEx OTC balance, both published daily in '
      + 'money terms. (OTC is about a quarter of Taiwan\'s margin debt — leaving it out understates the layer badly.) The ETF layer '
      + "is each fund's exact net assets (FUND_SIZE) from Yuanta's own API, daily and five years deep — not units × NAV, which only "
      + 'approximates it because published NAV is rounded. Short-sale balances are reported in lots, not money, so they are not '
      + 'stacked onto a money axis.',
    fundsNote:
      "Net assets as published by the issuer. Covers Yuanta's 2× funds — the largest issuer, and 00631L alone is about two thirds of "
      + "Taiwan's 2× assets. Cathay and Capital publish the same fields but expose no date-queryable endpoint, so their funds have no "
      + 'daily history to backfill.',
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

const pct = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

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
  return {
    ...payload,
    total: arr(payload.total),
    ...Object.fromEntries(market.layers.map(l => [l.key, arr(payload[l.key])])),
    funds: (payload.funds ?? []).map(f => ({ ...f, aum: f.aum * k })),
    etfMarket: payload.etfMarket ? { ...payload.etfMarket, total: payload.etfMarket.total * k } : null,
    latest: Object.fromEntries(Object.entries(payload.latest ?? {}).map(
      ([key, v]) => [key, key === 'date' || !Number.isFinite(v) ? v : v * k])),
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
  return { dates: cut(dates), total, layers, shown };
}

/**
 * The horizontal markers, derived from the data rather than hard-coded — a line
 * whose number is frozen in source stops meaning anything the day after it's
 * written. Each is a level this market has actually paid for before.
 */
function refLines(data, market, win) {
  if (!data?.dates?.length || !win?.dates?.length) return [];
  const shown = stackedLayers(data, market);
  const at = iso => {
    const i = data.dates.findIndex(d => d >= iso);
    return i < 0 ? null : shown.reduce((s, l) => s + (data[l.key][i] ?? 0), 0);
  };
  const year = data.dates[data.dates.length - 1].slice(0, 4);
  return [
    { label: `Window start · ${win.dates[0]}`, value: win.total[0], color: '#6b7280', dash: [1, 3] },
    { label: `Year open · ${year}-01`,          value: at(`${year}-01-01`), color: '#b58a2a', dash: [2, 4] },
    { label: `Q2 base · ${year}-04`,            value: at(`${year}-04-01`), color: '#c65d57', dash: [6, 4] },
  ].filter(r => Number.isFinite(r.value));
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
  const refs = useMemo(() => refLines(data, market, win), [data, market, win]);

  const chart = useMemo(() => {
    if (!win) return null;
    const long = win.dates.length > 200;
    return {
      labels: win.dates.map(long ? monthLabel : dayLabel),
      datasets: [
        ...win.shown.map(l => ({
          label: l.label,
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
  }, [win, refs, market]);

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
        filter: item => item.datasetIndex <= (win?.shown?.length ?? market.layers.length),
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
        ticks: { color: MUTED, callback: v => `${v}${market.unit}`, font: { size: 10 } },
      },
    },
  }), [market, win]);   // eslint-disable-line react-hooks/exhaustive-deps

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

  const { latest, funds, carriedFrom } = data;
  const first  = win.total[0];
  const latestTotal = win.total[win.total.length - 1];
  const chg = first ? ((latestTotal - first) / first) * 100 : null;

  // A layer measured but not yet stacked (see MIN_HISTORY) is still real money —
  // name it and its value rather than letting it vanish from the page.
  const pending = market.layers.filter(l => !win.shown.some(s => s.key === l.key));

  // KOFIA publishes 1–3 days behind the ETF layer; say which layers are showing
  // a carried-forward value rather than letting a flat line imply fresh data.
  const stale = market.layers.filter(l => carriedFrom?.[l.key]);
  const staleFrom = stale.length ? carriedFrom[stale[0].key] : null;
  const lag = stale.length
    ? `source publishes 1–3 days late — ${stale.map(l => l.label).join(', ')} carried forward from ${staleFrom}`
    : 'Same day';

  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          <Tile label="Total firepower" value={fmt(latestTotal)} sub={`${range.label} ${pct(chg)}`} color={INK} />
          {market.layers.map(l => (
            <Tile key={l.key} label={l.label} value={fmt(latest[l.key])} sub={tileSub(l, latest, data, fmt)} color={l.color} />
          ))}
        </div>
        {toggles}
      </div>

      <ChartCard
        chartId={`${market.id}-leverage-stack`}
        title={market.title}
        src={<SourceLinks layers={market.layers} />}
        freq="Daily"
        lag={lag}
        span2
        height={430}
        legend={[
          // The third slot is a link: each layer's swatch points at the table it
          // is read from, so the chart's provenance is one click from the series.
          ...win.shown.map(l => [l.label, l.color, l.srcUrl]),
          ['Total', INK],
          ...refs.map(r => [r.label, r.color]),
        ]}
        srcNote={
          `In ${market.unitName}, one point per trading day. ${market.note}`
          + (pending.length
            ? ` Not yet stacked: ${pending.map(l => `${l.label} (${fmt(latest[l.key])} today)`).join(', ')} — measured daily but with too little history to draw as a band; it joins the stack as collection accumulates.`
            : '')
        }
      >
        <Line data={chart} options={opts} />
      </ChartCard>

      <ChartCard
        chartId={`${market.id}-leverage-funds`}
        title={`${market.fundsTitle}${data.fundsDate ? ` · ${data.fundsDate}` : ''}`}
        src={market.fundsSrc}
        srcUrl={market.fundsSrcUrl}
        freq="Daily"
        span2
        fillBody
        height={Math.max(220, 34 + (funds?.length ?? 0) * 26)}
        srcNote={market.fundsNote}
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
                  <td className="lev-kind">{f.kind === 'single' ? 'Single-stock 2×' : 'Index 2×'}</td>
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
 * What the tile says under the number. Taiwan's margin is two markets summed, and
 * its ETF layer is one issuer out of several — both facts belong next to the
 * figure, not only in the footnote.
 */
function tileSub(layer, latest, data, fmt) {
  if (layer.key === 'margin' && Number.isFinite(latest.marginOtc)) {
    return `listed ${fmt(latest.marginListed)} + OTC ${fmt(latest.marginOtc)}`;
  }
  if (layer.key === 'etf' && data.etfMarket?.total > 0 && Number.isFinite(latest.etf)) {
    return `${((latest.etf / data.etfMarket.total) * 100).toFixed(0)}% of all listed 2× funds`;
  }
  return latest.date;
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

function Tile({ label, value, sub, color }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label"><span className="lev-dot" style={{ background: color }} />{label}</div>
      <div className="lev-tile-value">{value}</div>
      <div className="lev-tile-sub">{sub}</div>
    </div>
  );
}
