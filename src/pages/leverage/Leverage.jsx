import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';

const BLUE = '#4577b4';
const ORANGE = '#ad622d';
const PURPLE = '#7864b4';
const REVERSE = '#c65d57';

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

const LATEST_POINT_LABEL = {
  id: 'leverageLatestPointLabel',
  afterDatasetsDraw(chart, _args, options) {
    const datasetIndex = chart.data.datasets.findIndex((_, index) => chart.isDatasetVisible(index));
    if (datasetIndex < 0) return;

    const dataset = chart.data.datasets[datasetIndex];
    let pointIndex = dataset.data.length - 1;
    while (pointIndex >= 0 && !Number.isFinite(dataset.data[pointIndex])) pointIndex -= 1;
    if (pointIndex < 0) return;

    const point = chart.getDatasetMeta(datasetIndex).data[pointIndex];
    if (!point || point.skip) return;

    const { ctx, chartArea } = chart;
    const label = options.label ?? String(dataset.data[pointIndex]);
    const color = options.color ?? dataset.borderColor;
    const boxHeight = 22;
    const paddingX = 7;

    ctx.save();
    ctx.font = "600 11px 'Inter', sans-serif";
    const boxWidth = Math.ceil(ctx.measureText(label).width) + paddingX * 2;
    let x = point.x + 8;
    if (x + boxWidth > chartArea.right) x = point.x - boxWidth - 8;
    x = Math.max(chartArea.left + 4, Math.min(x, chartArea.right - boxWidth - 4));

    let y = point.y - boxHeight - 8;
    if (y < chartArea.top) y = point.y + 8;
    y = Math.max(chartArea.top + 4, Math.min(y, chartArea.bottom - boxHeight - 4));

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, 4);
    ctx.fillStyle = 'rgba(17,20,25,.96)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + boxWidth / 2, y + boxHeight / 2);
    ctx.restore();
  },
};

const MARKETS = {
  korea: {
    id: 'korea',
    label: 'Korea',
    endpoint: '/api/korea-leverage',
    scale: 1,
    unit: 'T',
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
    reverseLayer: {
      key: 'reverseEtf', label: 'Reverse 2× ETFs', color: REVERSE,
      srcLabel: 'Daum ETF data',
      srcUrl: 'https://finance.daum.net/domestic/etf',
    },
  },
  taiwan: {
    id: 'taiwan',
    label: 'Taiwan',
    endpoint: '/api/taiwan-leverage',
    // The API serves 億元 (hundred-million NT$); the page displays NT$ billions.
    scale: 0.1,
    unit: 'B',
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
    // Taiwan's listed inverse products are -1×. Keep the label precise even
    // though this panel occupies the same place as Korea's reverse 2× panel.
    reverseLayer: {
      key: 'reverseEtf', label: 'Reverse ETFs (-1×)', color: REVERSE,
      srcLabel: 'Yuanta fund data',
      srcUrl: 'https://www.yuantaetfs.com/tradeInfo/comparison/00632R/historical',
      srcExtra: {
        label: 'Fubon fund data',
        url: 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx?stkId=00676R',
      },
    },
  },
};

const SURFACE = '#111419';
const INK = '#e8e6e3';
const MUTED = '#8a8a84';

const RANGES = [
  { id: '3m', label: '3M', days: 92 },
  { id: 'ytd', label: 'YTD', days: null },
  { id: '12m', label: '12M', days: 366 },
  { id: '5y', label: '5Y', days: 1830 },
];

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

function allLayers(market) {
  return [...market.layers, market.reverseLayer].filter(Boolean);
}

/** Convert monetary series into the market's display unit at the API boundary. */
function rescale(payload, market) {
  const k = market.scale ?? 1;
  if (k === 1) return payload;

  const arr = values => (Array.isArray(values)
    ? values.map(value => (Number.isFinite(value) ? value * k : null))
    : values);
  const moneyKeys = new Set([
    'total', 'marketSize', 'marketSizeListed', 'marketSizeOtc',
    ...allLayers(market).map(layer => layer.key),
  ]);

  return {
    ...payload,
    total: arr(payload.total),
    ...Object.fromEntries(allLayers(market).map(layer => [layer.key, arr(payload[layer.key])])),
    marketSize: arr(payload.marketSize),
    marketSizeListed: arr(payload.marketSizeListed),
    marketSizeOtc: arr(payload.marketSizeOtc),
    funds: (payload.funds ?? []).map(fund => ({ ...fund, aum: fund.aum * k })),
    reverseFunds: (payload.reverseFunds ?? []).map(fund => ({ ...fund, aum: fund.aum * k })),
    etfMarket: payload.etfMarket
      ? { ...payload.etfMarket, total: payload.etfMarket.total * k }
      : null,
    latest: Object.fromEntries(Object.entries(payload.latest ?? {}).map(([key, value]) => [
      key,
      moneyKeys.has(key) && Number.isFinite(value) ? value * k : value,
    ])),
  };
}

const MIN_HISTORY = 20;

function visibleLayers(data, market) {
  return allLayers(market).filter(layer => (
    data?.[layer.key] ?? []
  ).filter(Number.isFinite).length >= MIN_HISTORY);
}

/** Slice every series to the selected window while keeping each layer separate. */
function windowed(data, market, range) {
  if (!data?.dates?.length) return null;

  const { dates } = data;
  let from = 0;
  if (range.id === 'ytd') {
    const year = dates.at(-1).slice(0, 4);
    from = dates.findIndex(date => date >= `${year}-01-01`);
  } else if (range.days) {
    const cutoff = new Date(
      new Date(`${dates.at(-1)}T00:00:00Z`).getTime() - range.days * 86400000,
    ).toISOString().slice(0, 10);
    from = dates.findIndex(date => date >= cutoff);
  }
  if (from < 0) from = 0;

  const cut = values => (values ?? []).slice(from);
  const shown = visibleLayers(data, market);
  const layers = Object.fromEntries(shown.map(layer => [layer.key, cut(data[layer.key])]));
  const longLayers = shown.filter(layer => market.layers.some(item => item.key === layer.key));
  const shownDates = cut(dates);
  const total = shownDates.map((_, index) => longLayers.reduce(
    (sum, layer) => sum + (layers[layer.key][index] ?? 0),
    0,
  ));

  return { dates: shownDates, total, layers, shown };
}

function layerChartData(win, layer) {
  const long = win.dates.length > 200;
  return {
    labels: win.dates.map(long ? monthLabel : dayLabel),
    datasets: [{
      label: layer.label,
      data: win.layers[layer.key],
      backgroundColor: alpha(layer.color, 0.38),
      borderColor: layer.color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: layer.color,
      pointHoverBorderColor: SURFACE,
      pointHoverBorderWidth: 2,
      tension: 0.25,
      fill: 'origin',
    }],
  };
}

function layerChartOptions(win, market, layer, formatValue) {
  const values = win.layers[layer.key] ?? [];
  const latest = [...values].reverse().find(Number.isFinite);
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      leverageLatestPointLabel: {
        label: formatValue(latest),
        color: layer.color,
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
          label: context => ` ${context.dataset.label}: ${formatValue(context.raw)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: MUTED,
          maxTicksLimit: 12,
          autoSkip: true,
          maxRotation: 0,
          font: { size: 10 },
        },
      },
      y: {
        beginAtZero: true,
        grace: '5%',
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: {
          color: MUTED,
          callback: value => `${Number(value).toLocaleString()}${market.unit}`,
          font: { size: 10 },
        },
      },
    },
  };
}

export function LeverageKorea() { return <Leverage marketId="korea" />; }
export function LeverageTaiwan() { return <Leverage marketId="taiwan" />; }

export default function Leverage({ marketId = 'korea' }) {
  const [rangeId, setRangeId] = useState('12m');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const market = MARKETS[marketId];
  const range = RANGES.find(item => item.id === rangeId) ?? RANGES[2];
  const formatValue = value => (value == null ? '—' : `${value.toFixed(1)}${market.unit}`);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(market.endpoint)
      .then(response => (response.ok
        ? response.json()
        : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then(payload => { if (live) setData(rescale(payload, market)); })
      .catch(fetchError => { if (live) setError(fetchError.message); });
    return () => { live = false; };
  }, [market]);

  const win = useMemo(() => windowed(data, market, range), [data, market, range]);

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
            ? `${market.label} leverage data unavailable: ${error}`
            : `Loading ${market.label} leverage data...`}
        </div>
      </>
    );
  }

  const latest = data.latest ?? {};
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          <Tile label="Total firepower" value={formatValue(latest.total ?? win.total.at(-1))} color={INK} />
          {allLayers(market).map(layer => (
            <Tile
              key={layer.key}
              label={layer.label}
              value={formatValue(latest[layer.key])}
              color={layer.color}
            />
          ))}
        </div>
        {toggles}
      </div>

      {win.shown.map(layer => (
        <LayerPanel
          key={layer.key}
          market={market}
          marketId={marketId}
          layer={layer}
          win={win}
          data={data}
          formatValue={formatValue}
        />
      ))}
    </>
  );
}

function LayerPanel({ market, marketId, layer, win, data, formatValue }) {
  const isLongEtf = layer.key === 'etf';
  const isReverseEtf = layer.key === 'reverseEtf';
  const hasTable = isLongEtf || isReverseEtf;
  const funds = isReverseEtf ? (data.reverseFunds ?? []) : (data.funds ?? []);
  const layerTotal = data.latest?.[layer.key];
  const chart = (
    <Line
      data={layerChartData(win, layer)}
      options={layerChartOptions(win, market, layer, formatValue)}
      plugins={[LATEST_POINT_LABEL]}
    />
  );

  return (
    <ChartCard
      chartId={`${market.id}-leverage-${layer.key}`}
      title={`${market.label} · ${layer.label}`}
      src={<SourceLinks layers={[layer]} />}
      freq="Daily"
      span2
      height={hasTable ? Math.max(430, 340 + funds.length * 32) : 320}
      legend={[[layer.label, layer.color]]}
    >
      {hasTable ? (
        <div className="lev-chart-table">
          <div className="lev-layer-chart">{chart}</div>
          <div className="lev-table-wrap">
            <FundTable
              funds={funds}
              layerTotal={layerTotal}
              marketId={marketId}
              reverse={isReverseEtf}
              formatValue={formatValue}
            />
          </div>
        </div>
      ) : chart}
    </ChartCard>
  );
}

function FundTable({ funds, layerTotal, marketId, reverse, formatValue }) {
  const formatFundValue = value => {
    if (!Number.isFinite(value)) return '—';
    const precision = Math.abs(value) < 0.1 ? 2 : 1;
    return `${value.toFixed(precision)}${marketId === 'korea' ? 'T' : 'B'}`;
  };

  return (
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
        {funds.map(fund => (
          <tr key={fund.code}>
            <td>{fund.name} <span className="lev-code">{fund.code}</span></td>
            {marketId === 'korea' && (
              <td className="lev-kind">{fundKind(fund.kind, reverse)}</td>
            )}
            <td className="num">{formatFundValue(fund.aum)}</td>
            <td className="num">
              {layerTotal
                ? `${((fund.aum / layerTotal) * 100).toFixed(1)}%`
                : formatValue(null)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fundKind(kind, reverse) {
  if (reverse || kind === 'reverse-index') return 'Index -2×';
  if (kind === 'hk') return 'Single-stock 2× (HK)';
  if (kind === 'single') return 'Single-stock 2×';
  return 'Index 2×';
}

function SourceLinks({ layers }) {
  const entries = layers.flatMap(layer => [
    { label: layer.srcLabel, url: layer.srcUrl, color: layer.color },
    ...(layer.srcExtra
      ? [{ label: layer.srcExtra.label, url: layer.srcExtra.url, color: layer.color }]
      : []),
  ]);
  const seen = new Set();
  const unique = entries.filter(entry => (
    seen.has(entry.label) ? false : seen.add(entry.label)
  ));

  return (
    <span className="lev-srcs">
      {unique.map(entry => (
        <a
          key={entry.label}
          className="ch-src"
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="lev-dot" style={{ background: entry.color }} />{entry.label}
        </a>
      ))}
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
