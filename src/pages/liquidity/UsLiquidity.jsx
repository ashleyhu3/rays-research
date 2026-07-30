import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useResource } from '../../services/resourceCache';
import { baseOpts, mkDs, GRID } from '../../utils/chartHelpers';
import LiquidityDateControls, {
  filterDateRange,
  useLiquidityDateRange,
} from './LiquidityDateControls';

const BLUE = '#4577b4';
const GOLD = '#c9a227';
const GREEN = '#5a9f6b';
const RED = '#c65d57';
const PURPLE = '#7864b4';

function fmtUsdM(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}T`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}B`;
  return `$${value.toFixed(0)}M`;
}
function fmtUsdB(value) {
  if (!Number.isFinite(value)) return '—';
  return `$${value.toFixed(0)}B`;
}
function fmtPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}
function fmtBps(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}bp`;
}
function fmtNfci(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function dateLabel(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const month = parsed.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} '${String(parsed.getUTCFullYear()).slice(-2)}`;
}

function Tile({ label, value, color, fmt }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label"><span className="lev-dot" style={{ background: color }} />{label}</div>
      <div className="lev-tile-value">{fmt(value)}</div>
    </div>
  );
}

function SeriesChart({ payload, seriesKey, color, fmt, chartId, srcNote, height = 320, startDate, endDate, span2 = false }) {
  const meta = payload?.series?.[seriesKey];
  const error = payload?.errors?.[seriesKey];
  const points = useMemo(
    () => filterDateRange(meta?.data, startDate, endDate),
    [meta, startDate, endDate],
  );

  if (!meta && error) return <ChartCard chartId={chartId} title={seriesKey} height={height}><div className="empty">Data unavailable: {error}</div></ChartCard>;
  if (!points.length) return <ChartCard chartId={chartId} title={meta?.name ?? seriesKey} height={height}><div className="empty">No history in the selected timeframe.</div></ChartCard>;

  const data = {
    labels: points.map(point => dateLabel(point.date)),
    datasets: [{
      ...mkDs(meta.name, color, points.map(point => point.value), true),
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHitRadius: 8,
    }],
  };
  const options = baseOpts(fmt);
  options.plugins.tooltip.callbacks.title = items => points[items[0]?.dataIndex]?.date ?? '';

  return (
    <ChartCard
      chartId={chartId} title={meta.name}
      src={meta.source} srcUrl={meta.sourceUrl}
      freq={meta.frequency} height={height} span2={span2}
      srcNote={srcNote}
    >
      <Line data={data} options={options} />
    </ChartCard>
  );
}

function FedBalance({ payload, startDate, endDate }) {
  const latest = filterDateRange(payload.series?.netAssets?.data, startDate, endDate).at(-1)?.value;
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats"><Tile label="Fed net liquidity" value={latest} color={BLUE} fmt={fmtUsdM} /></div>
      </div>
      <div className="cgrid">
        <SeriesChart
          payload={payload} seriesKey="netAssets" color={BLUE} fmt={fmtUsdM}
          startDate={startDate} endDate={endDate}
          chartId="us-liquidity-net-assets"
          srcNote="Net Assets = Fed Total Assets − Treasury General Account − ON RRP award volume. Rising = reserves flowing into the banking system; falling = liquidity draining out."
        />
        <SeriesChart
          payload={payload} seriesKey="totalAssets" color={GOLD} fmt={fmtUsdM}
          startDate={startDate} endDate={endDate}
          chartId="us-liquidity-total-assets"
          srcNote="Federal Reserve total balance sheet assets — Wednesday level, published weekly."
        />
        <SeriesChart
          payload={payload} seriesKey="tga" color={PURPLE} fmt={fmtUsdM}
          startDate={startDate} endDate={endDate}
          chartId="us-liquidity-tga"
          srcNote="Treasury General Account balance held at the Fed. A falling TGA (e.g. after a debt-ceiling deal) injects reserves into the banking system; a rising TGA drains them."
        />
        <SeriesChart
          payload={payload} seriesKey="onRrp" color={GREEN} fmt={fmtUsdB}
          startDate={startDate} endDate={endDate}
          chartId="us-liquidity-onrrp"
          srcNote="Overnight Reverse Repurchase Agreement award volume — cash money-market funds park at the Fed overnight, withdrawn from the banking system."
        />
      </div>
    </>
  );
}

// Three price scales ($79 vs 4,800 vs 7,400) cannot share an axis, and simply
// rebasing them to 100 does not help either: HYG is a coupon-bearing bond ETF
// that trades in a $70–85 band, so next to two compounding equity indices its
// line flattens out. Each series is therefore standardized against its own
// window — (price − mean) / standard deviation — which is a per-series linear
// rescale, so every line keeps its true shape while the three swing at a
// comparable amplitude and their turning points can be read against each other.
const PRICE_SERIES = [
  { key: 'hygPrice', label: 'HYG', color: RED, fmt: value => `$${value.toFixed(2)}` },
  { key: 'msciWorldPrice', label: 'MSCI World', color: GOLD, fmt: value => value.toLocaleString('en-US', { maximumFractionDigits: 0 }) },
  { key: 'spxPrice', label: 'S&P 500', color: BLUE, fmt: value => value.toLocaleString('en-US', { maximumFractionDigits: 0 }) },
];

function fmtSigma(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}σ`;
}

function fmtIndex(value) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(1);
}

// Population standard deviation of the visible window — the window is the
// whole population being compared here, not a sample drawn from a longer one.
function standardize(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance);
  // A perfectly flat window would divide by zero; render it as the mean line.
  if (!deviation) return values.map(() => 0);
  return values.map(value => (value - mean) / deviation);
}

function PriceComparisonChart({ payload, startDate, endDate }) {
  const { dates, series } = useMemo(() => {
    const byKey = Object.fromEntries(PRICE_SERIES.map(entry => [
      entry.key,
      new Map((payload.series?.[entry.key]?.data ?? []).map(point => [point.date, point.value])),
    ]));
    // Only dates every series traded on — the three feeds keep slightly
    // different calendars, and a standardized line must not step over a gap.
    const first = byKey[PRICE_SERIES[0].key];
    let common = [...first.keys()].filter(date => PRICE_SERIES.every(entry => byKey[entry.key].has(date))).sort();
    common = common.filter(date => date >= startDate && date <= endDate);
    return {
      dates: common,
      series: PRICE_SERIES.map(entry => ({
        ...entry,
        raw: common.map(date => byKey[entry.key].get(date)),
      })),
    };
  }, [payload, startDate, endDate]);

  const legend = PRICE_SERIES.map(entry => [entry.label, entry.color]);
  const title = 'HYG vs MSCI World vs S&P 500 — volatility-normalized';

  if (!dates.length) {
    return (
      <ChartCard chartId="us-liquidity-credit-vs-equities" title={title} height={360} span2>
        <div className="empty">No stored price history yet. The daily collector will populate it.</div>
      </ChartCard>
    );
  }

  const data = {
    labels: dates.map(dateLabel),
    datasets: series.map(entry => ({
      ...mkDs(entry.label, entry.color, standardize(entry.raw)),
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHitRadius: 8,
      borderWidth: 1.8,
      tension: 0.15,
    })),
  };

  const options = baseOpts(fmtSigma);
  options.plugins.tooltip.callbacks.title = items => dates[items[0]?.dataIndex] ?? '';
  // The normalized value answers "where in its own range is it"; the quote and
  // the rebased index keep the actual price and the actual return in reach.
  options.plugins.tooltip.callbacks.label = context => {
    const entry = series.find(item => item.label === context.dataset.label);
    const raw = entry?.raw[context.dataIndex];
    if (!Number.isFinite(raw)) return ` ${context.dataset.label}: —`;
    const rebased = (raw / entry.raw[0]) * 100;
    return ` ${context.dataset.label}: ${fmtSigma(context.parsed.y)}  ·  ${entry.fmt(raw)}  ·  ${fmtIndex(rebased)}`;
  };
  options.scales.x.ticks.maxTicksLimit = 10;
  // The zero line is each series' own window mean — the reference every line
  // shares — so it reads brighter than the rest of the grid.
  options.scales.y.grid = {
    color: context => (context.tick.value === 0 ? 'rgba(255,255,255,.22)' : GRID.color),
  };

  return (
    <ChartCard
      chartId="us-liquidity-credit-vs-equities"
      title={title}
      src="Yahoo Finance"
      srcUrl={payload.series?.hygPrice?.sourceUrl}
      freq="Daily" height={360} span2 legend={legend}
      srcNote="Closing prices for HYG (the high-yield corporate bond ETF), the MSCI World index and the S&P 500, each expressed in standard deviations from its own mean over the selected window. That rescaling is linear, so every line keeps its true shape, but HYG — a $70–85 bond ETF next to two compounding equity indices — swings at a readable amplitude instead of flattening out. Zero is each series' own window average; the axis is not a return. Hover for the underlying quote and the rebased index (first date in view = 100). All three are price lines and exclude income, so HYG's coupon is not reflected. When credit spreads widen, HYG typically rolls over ahead of — or alongside — equities; lines pulling apart is credit and equity risk appetite diverging."
    >
      <Line data={data} options={options} />
    </ChartCard>
  );
}

function Credit({ payload, startDate, endDate }) {
  const hy = filterDateRange(payload.series?.hySpread?.data, startDate, endDate).at(-1)?.value;
  const ig = filterDateRange(payload.series?.igSpread?.data, startDate, endDate).at(-1)?.value;
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          <Tile label="High Yield spread" value={hy} color={RED} fmt={fmtPct} />
          <Tile label="Investment Grade spread" value={ig} color={BLUE} fmt={fmtPct} />
        </div>
      </div>
      <div className="cgrid">
        <PriceComparisonChart payload={payload} startDate={startDate} endDate={endDate} />
        <SeriesChart
          payload={payload} seriesKey="hySpread" color={RED} fmt={fmtPct}
          startDate={startDate} endDate={endDate}
          chartId="us-liquidity-hy-spread"
          srcNote="ICE BofA US High Yield Index Option-Adjusted Spread — the extra yield high-yield corporate bonds pay over Treasuries. Widening signals rising credit stress. FRED's public download of this ICE-licensed series is limited to roughly the trailing three years."
        />
        <SeriesChart
          payload={payload} seriesKey="igSpread" color={BLUE} fmt={fmtPct}
          startDate={startDate} endDate={endDate}
          chartId="us-liquidity-ig-spread"
          srcNote="ICE BofA US Corporate Index Option-Adjusted Spread — the investment-grade counterpart to the high-yield spread above."
        />
      </div>
    </>
  );
}

function Interbank({ payload, startDate, endDate }) {
  const sofrIorb = filterDateRange(payload.series?.sofrIorbSpread?.data, startDate, endDate).at(-1)?.value;
  const effrIorb = filterDateRange(payload.series?.effrIorbSpread?.data, startDate, endDate).at(-1)?.value;
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          <Tile label="SOFR − IORB" value={sofrIorb} color={GOLD} fmt={fmtBps} />
          <Tile label="EFFR − IORB" value={effrIorb} color={RED} fmt={fmtBps} />
        </div>
      </div>
      <div className="cgrid">
        <SeriesChart
          payload={payload} seriesKey="sofrIorbSpread" color={GOLD} fmt={fmtBps}
          startDate={startDate} endDate={endDate}
          chartId="us-liquidity-sofr-iorb"
          srcNote="SOFR minus IORB, in basis points. A rising/positive spread signals repo-market funding pressure relative to the rate the Fed pays banks on reserves — a classic sign of reserve scarcity."
        />
        <SeriesChart
          payload={payload} seriesKey="effrIorbSpread" color={RED} fmt={fmtBps}
          startDate={startDate} endDate={endDate}
          chartId="us-liquidity-effr-iorb"
          srcNote="EFFR minus IORB, in basis points. Tracks where fed funds actually trade relative to the administered IORB rate."
        />
      </div>
    </>
  );
}

function FinancialCondition({ payload, startDate, endDate }) {
  const latest = filterDateRange(payload.series?.nfci?.data, startDate, endDate).at(-1)?.value;
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats"><Tile label="NFCI" value={latest} color={GOLD} fmt={fmtNfci} /></div>
      </div>
      <div className="cgrid">
        <SeriesChart
          payload={payload} seriesKey="nfci" color={GOLD} fmt={fmtNfci}
          startDate={startDate} endDate={endDate}
          chartId="us-liquidity-nfci"
          span2
          srcNote="Chicago Fed National Financial Conditions Index — a weekly z-score summary of over 100 measures of money markets, debt/equity markets and shadow banking. Zero is the historical average; positive values mean financial conditions are tighter than average, negative values looser."
        />
      </div>
    </>
  );
}

export default function UsLiquidity({ section }) {
  const dateRange = useLiquidityDateRange();
  // Loads once on first visit, then served from the shared cache on every
  // subsequent mount (stays loaded across navigation and refresh).
  const { data: payload, error } = useResource('/api/us-liquidity');

  let content;
  if (error) content = <div className="empty">US liquidity data unavailable: {error}</div>;
  else if (!payload) content = <div className="empty">Loading stored US liquidity history…</div>;
  else if (section === 'credit') content = <Credit payload={payload} {...dateRange} />;
  else if (section === 'interbank') content = <Interbank payload={payload} {...dateRange} />;
  else if (section === 'financial-condition') content = <FinancialCondition payload={payload} {...dateRange} />;
  else content = <FedBalance payload={payload} {...dateRange} />;

  return (
    <>
      <LiquidityDateControls {...dateRange} />
      {content}
    </>
  );
}
