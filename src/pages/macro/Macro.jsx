import { useMemo, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useData } from '../../context/DataContext';
import { baseOpts } from '../../utils/chartHelpers';
import MacroDateControls, { inDateRange, isoYearsAgo, todayIso } from './MacroDateControls';

const COLORS = ['#e8c547', '#56b4e9', '#5dd39e', '#ef8354', '#b48ead'];
// Matches --bg-card — used as the outline stroke behind on-chart value labels
// so they stay legible over gridlines/other series regardless of chart position.
const SURFACE = '#111419';
const COUNTRY_SHORT = { 'United States': 'US', China: 'CN', Japan: 'JP', 'United Kingdom': 'UK', Germany: 'DE' };

const PAGE_CHARTS = {
  'macro-yield': [
    ['United States', ['us2yYield', 'us10yYield', 'us30yYield'], ['2Y', '10Y', '30Y'], 'line', 2],
    ['10Y breakeven inflation & real yield', ['us10yBreakeven', 'us10yRealYield'], ['10Y breakeven inflation', '10Y real yield'], 'line', 2],
    ['10Y–2Y yield spread', ['us2y10ySpread'], ['10Y–2Y spread'], 'bar', 2],
    ['China', ['cn10yYield', 'cn30yYield'], ['10Y', '30Y'], 'line', 2],
    ['Japan', ['jp10yYield', 'jp30yYield'], ['10Y', '30Y'], 'line', 2],
    ['United Kingdom', ['uk10yYield', 'uk30yYield'], ['10Y', '30Y'], 'line', 2],
    ['Germany', ['de10yYield', 'de30yYield'], ['10Y', '30Y'], 'line', 2],
  ],
  'macro-us-inflation': [
    ['CPI YoY', ['usCpiYoy', 'usCoreCpiYoy'], ['Headline CPI', 'Core CPI']],
    ['CPI MoM', ['usCpiMom', 'usCoreCpiMom'], ['Headline CPI', 'Core CPI']],
    ['PPI YoY', ['usPpiYoy', 'usCorePpiYoy'], ['Headline PPI', 'Core PPI']],
    ['PPI MoM', ['usPpiMom', 'usCorePpiMom'], ['Headline PPI', 'Core PPI']],
    ['PCE YoY', ['usPceYoy', 'usCorePceYoy'], ['Headline PCE', 'Core PCE']],
    ['PCE MoM', ['usPceMom', 'usCorePceMom'], ['Headline PCE', 'Core PCE']],
  ],
  'macro-us-labor': [
    ['Non-farm payrolls', ['usNfp'], ['Monthly change']],
    ['ADP employment change — monthly', ['usAdpMonthly'], ['Monthly change']],
    ['ADP employment change — weekly', ['usAdpWeekly'], ['Weekly change'], 'line', undefined, { addRollingSum: { window: 4, label: '4-week rolling sum' } }],
    ['Initial jobless claims', ['usJoblessClaims'], ['Claims']],
    ['Unemployment rate', ['usUnemployment'], ['Unemployment rate']],
    ['Average hourly earnings', ['usEarningsYoy', 'usEarningsMom'], ['YoY', 'MoM']],
  ],
  'macro-us-pmi': [
    ['ISM Manufacturing PMI', ['usIsmMfg', 'usIsmMfgEmployment', 'usIsmMfgOrders', 'usIsmMfgPrices'], ['Headline', 'Employment', 'New orders', 'Prices'], 'line', 1],
    ['ISM Services PMI', ['usIsmServices', 'usIsmServicesEmployment', 'usIsmServicesOrders', 'usIsmServicesPrices'], ['Headline', 'Employment', 'New orders', 'Prices'], 'line', 1],
    ['Markit PMI', ['usSpMfg', 'usSpServices'], ['Manufacturing', 'Services'], 'line', 1],
  ],
  'macro-us-household': [
    ['University of Michigan consumer sentiment', ['usMichigan'], ['Sentiment']],
    ['Retail sales', ['usRetailSales'], ['MoM']],
    ['Personal spending', ['usPersonalSpending'], ['MoM']],
    ['Existing & New Home Sales', ['usExistingHomes', 'usNewHomes'], ['Existing home sales', 'New home sales'], 'bar', undefined, { unitSuffix: 'K' }],
  ],
  'macro-cn-inflation': [
    ['CPI YoY', ['cnCpiYoy'], ['CPI YoY']],
    ['CPI MoM', ['cnCpiMom'], ['CPI MoM']],
    ['PPI YoY', ['cnPpiYoy'], ['PPI YoY']],
    ['PPI MoM', ['cnPpiMom'], ['PPI MoM']],
  ],
  'macro-cn-pmi': [
    ['NBS PMI', ['cnNbsMfg', 'cnNbsNonMfg'], ['Manufacturing', 'Non-manufacturing']],
    ['RatingDog PMI', ['cnRatingDogMfg', 'cnRatingDogServices'], ['Manufacturing', 'Services']],
  ],
  'macro-cn-trade': [
    ['Exports & imports — YoY', ['cnExportsYoy', 'cnImportsYoy'], ['Exports', 'Imports']],
  ],
  'macro-cn-activity': [
    ['Retail sales', ['cnRetailSales'], ['YoY']],
    ['Industrial production', ['cnIndustrialProduction'], ['YoY']],
    ['Fixed asset investment', ['cnFixedAssetInvestment'], ['YTD YoY']],
    ['New yuan loans', ['cnNewLoans'], ['CNY']],
  ],
};

function compact(value, decimals) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return Number(value).toFixed(decimals ?? (abs < 10 ? 1 : 0));
}

function fmtSeriesValue(value, decimals, percentUnit) {
  return `${compact(value, decimals)}${percentUnit ? '%' : ''}`;
}

function fmtDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day || 1).toLocaleDateString('en-US', {
    month: 'short', year: '2-digit', ...(day && day !== 1 ? { day: 'numeric' } : {}),
  });
}

// Latest reading uses the series' full history (not the date-range filter)
// so switching to a narrower window never hides "where are we now".
function latestPoint(series) {
  return (series?.data ?? []).reduce((best, point) =>
    Number.isFinite(point.value) && (!best || point.date > best.date) ? point : best, null);
}

// Trailing N-period sum, keyed to the last date in each window. Windows that
// aren't yet fully populated (start of history) are dropped rather than
// shown as a partial/misleading sum.
function rollingSum(data, window) {
  const sorted = [...data]
    .filter(point => Number.isFinite(point.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const result = [];
  for (let index = window - 1; index < sorted.length; index += 1) {
    const windowPoints = sorted.slice(index - window + 1, index + 1);
    result.push({ date: sorted[index].date, value: windowPoints.reduce((sum, point) => sum + point.value, 0) });
  }
  return result;
}

// `transforms` may be a single function (applied to every key) or an array
// aligned with `keys` by position — the latter lets the same underlying key
// appear twice with different transforms (e.g. raw value + its rolling sum).
function buildData(macro, keys, labels, startDate, endDate, transforms) {
  const entries = keys.map((key, index) => {
    const series = macro?.series?.[key];
    if (!series) return null;
    const transform = Array.isArray(transforms) ? transforms[index] : transforms;
    return { series, data: transform ? transform(series.data) : series.data };
  });
  const available = entries.filter(Boolean).map(entry => entry.series);
  const dates = [...new Set(entries.filter(Boolean).flatMap(entry => entry.data
    .filter(point => inDateRange(point.date, startDate, endDate))
    .map(point => point.date)))].sort();
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const datasets = [];
  keys.forEach((key, seriesIndex) => {
    const entry = entries[seriesIndex];
    if (!entry) return;
    const values = Array(dates.length).fill(null);
    entry.data.forEach(point => {
      const index = dateIndex.get(point.date);
      if (index != null) values[index] = point.value;
    });
    datasets.push({
      label: labels[seriesIndex], data: values,
      borderColor: COLORS[seriesIndex], backgroundColor: `${COLORS[seriesIndex]}55`,
      borderWidth: seriesIndex === 0 ? 2 : 1.7, pointRadius: 0, pointHoverRadius: 3,
      tension: 0.2, spanGaps: true,
    });
  });
  return { labels: dates.map(fmtDate), datasets, available };
}

// Draws each series' latest visible value directly next to its last plotted
// point, in that series' own (never black) color — used on the Yield page in
// place of a bottom legend. `options.macroPointMarks.fmt` formats the raw value.
const POINT_VALUE_MARKS = {
  id: 'macroPointMarks',
  afterDatasetsDraw(chart, _args, pluginOptions) {
    const fmt = pluginOptions?.fmt;
    if (!fmt) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      let index = dataset.data.length - 1;
      while (index >= 0 && dataset.data[index] == null) index -= 1;
      if (index < 0) return;
      const point = meta.data[index];
      if (!point) return;
      const color = Array.isArray(dataset.borderColor) ? dataset.borderColor[index] : dataset.borderColor;
      const text = fmt(dataset.data[index]);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();

      const valueAbove = point.y - chartArea.top > 20;
      ctx.font = "700 11px 'Inter', sans-serif";
      ctx.textAlign = 'right';
      ctx.textBaseline = valueAbove ? 'bottom' : 'top';
      const x = Math.min(point.x, chartArea.right - 2);
      const y = valueAbove ? point.y - 5 : point.y + 5;

      // Dark outline keeps the bright series color legible over gridlines.
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = SURFACE;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    });
    ctx.restore();
  },
};

function MacroChart({ definition, macro, errors, startDate, endDate, isYield }) {
  const [title, baseKeys, baseLabels, chartType = 'line', decimals, chartOptions] = definition;
  const addRollingSum = chartOptions?.addRollingSum;
  // Appends a derived series — the rolling sum of the last base key — as its
  // own line, so a chart can show the raw reading and its rolling sum side
  // by side instead of replacing one with the other.
  const keys = addRollingSum ? [...baseKeys, baseKeys[baseKeys.length - 1]] : baseKeys;
  const labels = addRollingSum
    ? [...baseLabels, addRollingSum.label ?? `${addRollingSum.window}-period rolling sum`]
    : baseLabels;
  const transforms = addRollingSum
    ? baseKeys.map(() => undefined).concat(data => rollingSum(data, addRollingSum.window))
    : undefined;
  const built = useMemo(
    () => buildData(macro, keys, labels, startDate, endDate, transforms),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [macro, keys.join('|'), labels.join('|'), startDate, endDate, addRollingSum?.window],
  );
  const chartData = useMemo(() => {
    if (chartType !== 'bar') return { labels: built.labels, datasets: built.datasets };
    // A single-series bar (e.g. the yield spread) recolors bars red/green by
    // sign. Grouped multi-series bars (e.g. home sales) keep each series'
    // own color instead, or the sign recolor would make every series green.
    if (built.datasets.length > 1) {
      return { labels: built.labels, datasets: built.datasets.map(dataset => ({ ...dataset, borderWidth: 0 })) };
    }
    return {
      labels: built.labels,
      datasets: built.datasets.map(dataset => ({
        ...dataset,
        borderWidth: 0,
        borderColor: dataset.data.map(value => value != null && value < 0 ? '#ef8354' : '#5dd39e'),
        backgroundColor: dataset.data.map(value => value != null && value < 0 ? '#ef8354bb' : '#5dd39ebb'),
      })),
    };
  }, [built.datasets, built.labels, chartType]);
  const unit = built.available[0]?.unit || '';
  const percentUnit = /percent|%/i.test(unit);
  // Some series (e.g. home sales) are already reported in a fixed unit
  // (Thousand) rather than a raw count — compact()'s auto B/M/K scaling
  // would re-divide an already-scaled number, so unitSuffix formats the
  // value as-is with an explicit "K" instead.
  const unitSuffix = chartOptions?.unitSuffix;
  const formatValue = value => unitSuffix
    ? `${Math.round(value).toLocaleString()}${unitSuffix}`
    : fmtSeriesValue(value, decimals, percentUnit);
  const options = useMemo(() => {
    const opts = baseOpts(formatValue);
    if (isYield) {
      // Yield page shows latest values as on-chart point marks + top summary
      // cards instead, so the bottom legend would just be duplicate text.
      opts.plugins.legend = { display: false };
    } else {
      opts.plugins.legend = {
        display: built.datasets.length > 1,
        position: 'bottom',
        labels: { color: '#c8c8c0', boxWidth: 10, padding: 12, font: { size: 10 } },
      };
    }
    // All macro charts (Yield, US, China) mark each series' latest visible
    // reading directly on the chart, so "where are we now" never requires
    // hunting through a legend or tooltip.
    opts.plugins.macroPointMarks = { fmt: formatValue };
    opts.plugins.tooltip.callbacks.label = context =>
      ` ${context.dataset.label}: ${formatValue(context.parsed.y)}`;
    opts.plugins.zeroLine = { display: true };
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYield, built.datasets.length, percentUnit, decimals, unitSuffix]);
  const source = built.available[0];
  const missing = [...new Set(baseKeys)].filter(key => !macro?.series?.[key]);
  const chartPlugins = [POINT_VALUE_MARKS];

  return (
    <ChartCard
      chartId={`macro-${baseKeys.join('-')}`}
      title={title}
      src={source?.source || 'Trading Economics'}
      srcUrl={source?.sourceUrl || 'https://tradingeconomics.com'}
      freq={source?.frequency || undefined}
      lag="updated after release"
      height={250}
      srcNote={missing.length ? `${missing.length} series temporarily unavailable` : undefined}
    >
      {built.datasets.length
        ? chartType === 'bar'
          ? <Bar data={chartData} options={options} plugins={chartPlugins} />
          : <Line data={chartData} options={options} plugins={chartPlugins} />
        : <div className="macro-empty">{errors ? 'Series temporarily unavailable from Trading Economics.' : 'Loading macro history…'}</div>}
    </ChartCard>
  );
}

// Top-of-page "latest reading" cards for the Yield page — same card format as
// the Liquidity pages' .lev-tile row, one tile per series across all charts.
function SummaryTiles({ charts, macro }) {
  const tiles = useMemo(() => {
    if (!macro) return [];
    return charts.flatMap(([chartTitle, keys, labels, , decimals]) => {
      const short = COUNTRY_SHORT[chartTitle];
      return keys.flatMap((key, seriesIndex) => {
        const series = macro.series?.[key];
        const point = latestPoint(series);
        if (!point) return [];
        const percentUnit = /percent|%/i.test(series.unit || '');
        return [{
          key,
          label: short ? `${short} ${labels[seriesIndex]}` : labels[seriesIndex],
          color: COLORS[seriesIndex % COLORS.length],
          text: fmtSeriesValue(point.value, decimals, percentUnit),
        }];
      });
    });
  }, [charts, macro]);

  if (!tiles.length) return null;
  return (
    <div className="lev-head">
      <div className="lev-stats">
        {tiles.map(tile => (
          <div className="lev-tile" key={tile.key}>
            <div className="lev-tile-label"><span className="lev-dot" style={{ background: tile.color }} />{tile.label}</div>
            <div className="lev-tile-value">{tile.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Macro({ viewId }) {
  const { liveData, loading } = useData();
  const [startDate, setStartDate] = useState(() => isoYearsAgo(1));
  const [endDate, setEndDate] = useState(() => todayIso());
  const macro = liveData?.macro;
  const charts = PAGE_CHARTS[viewId] || PAGE_CHARTS['macro-us-inflation'];
  const isYield = viewId === 'macro-yield';
  return (
    <div className="macro-page">
      <MacroDateControls
        startDate={startDate}
        endDate={endDate}
        onStartDate={setStartDate}
        onEndDate={setEndDate}
      />
      {isYield && <SummaryTiles charts={charts} macro={macro} />}
      {macro?.fetchedAt && (
        <div className="macro-update">Trading Economics history · refreshed {new Date(macro.fetchedAt).toLocaleString()}</div>
      )}
      {!macro && !loading && <div className="macro-banner">Macro data is unavailable. Use Refresh Data to retry Trading Economics.</div>}
      <div className="cgrid">
        {charts.map(definition => (
          <MacroChart
            key={definition[1].join('-')}
            definition={definition}
            macro={macro}
            errors={macro?.errors}
            startDate={startDate}
            endDate={endDate}
            isYield={isYield}
          />
        ))}
      </div>
    </div>
  );
}

export { PAGE_CHARTS };
