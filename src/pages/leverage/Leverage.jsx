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

const MARKED_POINTS = {
  id: 'leverageMarkedPoints',
  afterDatasetsDraw(chart, _args, options) {
    const { ctx, chartArea } = chart;
    const points = chart.getDatasetMeta(0).data;
    const color = options.color ?? chart.data.datasets[0].borderColor;
    const marks = options.marks ?? [];
    const drawdowns = options.drawdowns ?? [];

    const VALUE_FONT = "700 11px 'Inter', sans-serif";
    const DATE_FONT = "700 10px 'Inter', sans-serif";
    const LINE_H = 13;

    ctx.save();

    // Guides + dots first, so every label paints on top of them.
    for (const mark of marks) {
      const point = points[mark.index];
      if (!point || point.skip) continue;
      // Bare marks (drawdown peak/trough) are just a dot — no guide/value/date.
      if (!mark.bare) {
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
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dashed peak→trough connectors, drawn under the labels.
    for (const drop of drawdowns) {
      const peak = points[drop.peakIndex];
      const trough = points[drop.troughIndex];
      if (!peak || !trough || peak.skip || trough.skip) continue;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(peak.x, peak.y);
      ctx.lineTo(trough.x, trough.y);
      ctx.stroke();
      ctx.restore();
    }

    // Collision-aware label placement. Labels reserve rectangles as they are
    // drawn; later ones nudge (values/percentages) or drop out (bottom dates)
    // rather than overlap. Higher-priority labels (latest, then %, then marked
    // dates) claim their spot first.
    const placed = [];
    const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const rectFor = (text, cx, cy, align, baseline, font) => {
      ctx.font = font;
      const w = ctx.measureText(text).width;
      let x0 = align === 'right' ? cx - w : align === 'center' ? cx - w / 2 : cx;
      x0 = Math.max(chartArea.left + 2, Math.min(x0, chartArea.right - 2 - w));
      const y1 = baseline === 'bottom' ? cy : baseline === 'top' ? cy + LINE_H : cy + LINE_H / 2;
      return { x0: x0 - 1, x1: x0 + w + 3, y0: y1 - LINE_H - 1, y1: y1 + 1, drawX: x0 };
    };
    const paint = (text, rect, cy, baseline, font) => {
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.textBaseline = baseline;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = SURFACE;
      ctx.strokeText(text, rect.drawX, cy);
      ctx.fillStyle = color;
      ctx.fillText(text, rect.drawX, cy);
      placed.push(rect);
    };

    // Split marks into their in-plot value labels and bottom-row date labels.
    const valueJobs = [];
    const dateJobs = [];
    for (const mark of marks) {
      const point = points[mark.index];
      if (!point || point.skip || mark.bare) continue;
      const isLatest = mark.anchor === 'right';
      const cx = isLatest ? point.x - 2 : point.x;
      const align = isLatest ? 'right' : 'center';
      const priority = isLatest ? 0 : 2;
      valueJobs.push({ priority, text: mark.value, cx, point, align });
      dateJobs.push({ priority, text: mark.date, cx, align });
    }
    const pctJobs = [];
    for (const drop of drawdowns) {
      const peak = points[drop.peakIndex];
      const trough = points[drop.troughIndex];
      if (!peak || !trough || peak.skip || trough.skip) continue;
      pctJobs.push({
        priority: 1,
        kind: 'pct',
        text: drop.label,
        cx: (peak.x + trough.x) / 2,
        cy: (peak.y + trough.y) / 2 - 12,
      });
    }

    const placeValue = job => {
      const above = job.point.y - chartArea.top > 25;
      const sides = above ? ['bottom', 'top'] : ['top', 'bottom'];
      for (const baseline of sides) {
        for (let step = 0; step < 4; step += 1) {
          const off = 7 + step * LINE_H;
          const cy = baseline === 'bottom' ? job.point.y - off : job.point.y + off;
          const rect = rectFor(job.text, job.cx, cy, job.align, baseline, VALUE_FONT);
          if (rect.y0 < chartArea.top || rect.y1 > chartArea.bottom) continue;
          if (placed.some(p => overlaps(p, rect))) continue;
          paint(job.text, rect, cy, baseline, VALUE_FONT);
          return;
        }
      }
      const cy = job.point.y - 7;
      paint(job.text, rectFor(job.text, job.cx, cy, job.align, 'bottom', VALUE_FONT), cy, 'bottom', VALUE_FONT);
    };

    const placePct = job => {
      for (let step = 0; step < 5; step += 1) {
        const cy = Math.max(chartArea.top + LINE_H, job.cy - step * LINE_H);
        const rect = rectFor(job.text, job.cx, cy, 'center', 'bottom', VALUE_FONT);
        if (placed.some(p => overlaps(p, rect))) continue;
        paint(job.text, rect, cy, 'bottom', VALUE_FONT);
        return;
      }
      const cy = Math.max(chartArea.top + LINE_H, job.cy);
      paint(job.text, rectFor(job.text, job.cx, cy, 'center', 'bottom', VALUE_FONT), cy, 'bottom', VALUE_FONT);
    };

    const inPlot = [...valueJobs, ...pctJobs].sort((a, b) => a.priority - b.priority);
    for (const job of inPlot) (job.kind === 'pct' ? placePct : placeValue)(job);

    // Bottom-row dates: keep higher-priority (latest) and drop any that would
    // collide, so compressed ranges never smear two dates together.
    const dateY = chartArea.bottom + 21;
    for (const job of dateJobs.sort((a, b) => a.priority - b.priority)) {
      const rect = rectFor(job.text, job.cx, dateY, job.align, 'top', DATE_FONT);
      if (placed.some(p => overlaps(p, rect))) continue;
      paint(job.text, rect, dateY, 'top', DATE_FONT);
    }

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
        lag: 'Typically T+2; T+1–T+3 observed',
        srcLabel: 'KOFIA credit balances',
        srcUrl: 'https://freesis.kofia.or.kr/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=STATSCU0100000070',
      },
      {
        key: 'margin', label: 'Margin loans', color: ORANGE,
        lag: 'Typically T+2; T+1–T+3 observed',
        srcLabel: 'KOFIA credit balances',
        srcUrl: 'https://freesis.kofia.or.kr/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=STATSCU0100000070',
      },
      {
        key: 'etf', label: '2× leveraged ETFs', color: PURPLE,
        lag: 'T+0 close',
        srcLabel: 'Daum ETF data',
        srcUrl: 'https://finance.daum.net/domestic/etf',
        srcExtras: [
          { label: 'HKEXnews filings', url: 'https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en' },
        ],
      },
    ],
    reverseLayer: {
      key: 'reverseEtf', label: 'Reverse 2× ETFs', color: REVERSE,
      lag: 'T+0 close',
      srcLabel: 'Daum ETF data',
      srcUrl: 'https://finance.daum.net/domestic/etf',
      srcExtras: [
        { label: 'HKEXnews filings', url: 'https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en' },
        { label: 'GraniteShares fund data', url: 'https://graniteshares.com/etfs/skdd/' },
      ],
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
        lag: 'T close; available by T+1 open',
        srcLabel: 'TWSE margin data',
        srcUrl: 'https://www.twse.com.tw/zh/trading/margin/mi-margn.html',
        srcExtras: [
          { label: 'TPEx margin data', url: 'https://www.tpex.org.tw/zh-tw/mainboard/trading/margin-trading/transactions.html' },
        ],
      },
      {
        key: 'etf', label: '2× leveraged ETFs', color: PURPLE,
        lag: 'T close; available by T+1 open',
        srcLabel: 'Yuanta fund data',
        srcUrl: 'https://www.yuantaetfs.com/tradeInfo/comparison/00631L/historical',
        srcExtras: [
          { label: 'Fubon fund data', url: 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx?stkId=00675L' },
        ],
      },
    ],
    // Taiwan's listed inverse products are -1×. Keep the label precise even
    // though this panel occupies the same place as Korea's reverse 2× panel.
    reverseLayer: {
      key: 'reverseEtf', label: 'Reverse ETFs (-1×)', color: REVERSE,
      lag: 'T close; available by T+1 open',
      srcLabel: 'Yuanta fund data',
      srcUrl: 'https://www.yuantaetfs.com/tradeInfo/comparison/00632R/historical',
      srcExtras: [
        { label: 'Fubon fund data', url: 'https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx?stkId=00676R' },
      ],
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
  { id: '18m', label: '18M', days: 548 },
  { id: '5y', label: '5Y', days: 1830 },
];

const MARKED_DATES = ['2025-04-07', '2026-03-30'];

// Peak→trough deleveraging episodes marked on the margin-loan panels. Each is a
// fixed historical peak/trough pair; a null trough tracks the latest datapoint
// (the current, still-unfolding drawdown). The decline % is computed from live
// series values at render time, so it self-updates as data is revised/extended.
const MARGIN_DRAWDOWNS = {
  korea: [
    { peak: '2024-07-15', trough: '2024-08-08' },
    { peak: '2025-03-05', trough: '2025-04-14' },
    { peak: '2026-06-24', trough: null },
  ],
  taiwan: [
    { peak: '2024-07-17', trough: '2024-08-06' },
    { peak: '2025-03-06', trough: '2025-04-28' },
    { peak: '2026-07-06', trough: null },
  ],
};

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

function layerMarks(win, layer, formatValue) {
  const values = win.layers[layer.key] ?? [];
  const marks = MARKED_DATES.map(target => {
    const index = sessionIndex(win.dates, target);
    if (index < 0 || !Number.isFinite(values[index])) return null;
    return {
      index,
      date: markedDate(win.dates[index]),
      value: formatValue(values[index]),
      anchor: 'center',
    };
  }).filter(Boolean);

  let latestIndex = values.length - 1;
  while (latestIndex >= 0 && !Number.isFinite(values[latestIndex])) latestIndex -= 1;
  if (latestIndex >= 0) {
    marks.push({
      index: latestIndex,
      date: markedDate(win.dates[latestIndex]),
      value: formatValue(values[latestIndex]),
      anchor: 'right',
    });
  }
  return marks;
}

/**
 * Extra peak→trough annotations for the margin panel, layered on top of the
 * standard marks. Returns bare `marks` (just a dot at each peak and trough)
 * alongside `drawdowns` describing the % drop label between each pair.
 */
function marginDrawdownMarks(win, values, episodes) {
  let latestIndex = values.length - 1;
  while (latestIndex >= 0 && !Number.isFinite(values[latestIndex])) latestIndex -= 1;

  const marks = [];
  const drawdowns = [];
  for (const episode of episodes ?? []) {
    const peakIndex = sessionIndex(win.dates, episode.peak);
    const troughIndex = episode.trough ? sessionIndex(win.dates, episode.trough) : latestIndex;
    if (peakIndex < 0 || troughIndex <= peakIndex) continue;
    if (!Number.isFinite(values[peakIndex]) || !Number.isFinite(values[troughIndex])) continue;

    marks.push({ index: peakIndex, bare: true });
    marks.push({ index: troughIndex, bare: true });
    const decline = (values[peakIndex] - values[troughIndex]) / values[peakIndex] * 100;
    drawdowns.push({ peakIndex, troughIndex, label: `−${decline.toFixed(1)}%` });
  }
  return { marks, drawdowns };
}

function layerChartOptions(win, market, layer, formatValue) {
  // Every layer keeps its original marks (MARKED_DATES + latest value/date).
  // The margin panel additionally overlays bare peak/trough dots and the % drop.
  const baseMarks = layerMarks(win, layer, formatValue);
  const drawdown = layer.key === 'margin'
    ? marginDrawdownMarks(win, win.layers[layer.key] ?? [], MARGIN_DRAWDOWNS[market.id])
    : { marks: [], drawdowns: [] };
  const marks = [...baseMarks, ...drawdown.marks];
  const { drawdowns } = drawdown;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 16, right: 8, bottom: 18 } },
    plugins: {
      legend: { display: false },
      leverageMarkedPoints: {
        marks,
        drawdowns,
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
          padding: 3,
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
  const [rangeId, setRangeId] = useState('18m');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const market = MARKETS[marketId];
  const range = RANGES.find(item => item.id === rangeId)
    ?? RANGES.find(item => item.id === '18m');
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
      plugins={[MARKED_POINTS]}
    />
  );

  return (
    <ChartCard
      chartId={`${market.id}-leverage-${layer.key}`}
      title={`${market.label} · ${layer.label}`}
      src={<SourceLinks layers={[layer]} />}
      freq="Daily"
      lag={layer.lag}
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
              formatValue={formatValue}
            />
          </div>
        </div>
      ) : chart}
    </ChartCard>
  );
}

function FundTable({ funds, layerTotal, marketId, formatValue }) {
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
              <td className="lev-kind">{fundKind(fund.kind)}</td>
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

function fundKind(kind) {
  switch (kind) {
    case 'reverse-index': return 'Index -2×';
    case 'reverse-single': return 'Single-stock -2×';
    case 'hk-reverse': return 'Single-stock -2× (HK)';
    case 'us-reverse': return 'Single-stock -2× (US, ADR)';
    case 'hk': return 'Single-stock 2× (HK)';
    case 'single': return 'Single-stock 2×';
    default: return 'Index 2×';
  }
}

function SourceLinks({ layers }) {
  const entries = layers.flatMap(layer => [
    { label: layer.srcLabel, url: layer.srcUrl, color: layer.color },
    ...(layer.srcExtras ?? []).map(extra => ({ label: extra.label, url: extra.url, color: layer.color })),
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
