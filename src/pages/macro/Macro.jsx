import { useMemo, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useData } from '../../context/DataContext';
import { baseOpts } from '../../utils/chartHelpers';
import MacroDateControls, { inDateRange, isoYearsAgo, todayIso } from './MacroDateControls';

const COLORS = ['#e8c547', '#56b4e9', '#5dd39e', '#ef8354', '#b48ead'];

const PAGE_CHARTS = {
  'macro-yield': [
    ['United States', ['us2yYield', 'us10yYield', 'us30yYield'], ['2Y', '10Y', '30Y']],
    ['10Y breakeven inflation & real yield', ['us10yBreakeven', 'us10yRealYield'], ['10Y breakeven inflation', '10Y real yield']],
    ['10Y–2Y yield spread', ['us2y10ySpread'], ['10Y–2Y spread'], 'bar', 2],
    ['China', ['cn10yYield', 'cn30yYield'], ['10Y', '30Y']],
    ['Japan', ['jp10yYield', 'jp30yYield'], ['10Y', '30Y']],
    ['United Kingdom', ['uk10yYield', 'uk30yYield'], ['10Y', '30Y']],
    ['Germany', ['de10yYield', 'de30yYield'], ['10Y', '30Y']],
  ],
  'macro-us-inflation': [
    ['CPI', ['usCpiYoy', 'usCoreCpiYoy'], ['Headline CPI', 'Core CPI']],
    ['CPI', ['usCpiMom', 'usCoreCpiMom'], ['Headline CPI', 'Core CPI']],
    ['PPI', ['usPpiYoy', 'usCorePpiYoy'], ['Headline PPI', 'Core PPI']],
    ['PPI', ['usPpiMom', 'usCorePpiMom'], ['Headline PPI', 'Core PPI']],
    ['PCE', ['usPceYoy', 'usCorePceYoy'], ['Headline PCE', 'Core PCE']],
    ['PCE', ['usPceMom', 'usCorePceMom'], ['Headline PCE', 'Core PCE']],
  ],
  'macro-us-labor': [
    ['Non-farm payrolls', ['usNfp'], ['Monthly change']],
    ['ADP employment change — monthly', ['usAdpMonthly'], ['Monthly change']],
    ['ADP employment change — weekly', ['usAdpWeekly'], ['Weekly change']],
    ['Initial jobless claims', ['usJoblessClaims'], ['Claims']],
    ['Unemployment rate', ['usUnemployment'], ['Unemployment rate']],
    ['Average hourly earnings', ['usEarningsYoy', 'usEarningsMom'], ['YoY', 'MoM']],
  ],
  'macro-us-pmi': [
    ['ISM manufacturing & subindices', ['usIsmMfg', 'usIsmMfgEmployment', 'usIsmMfgOrders', 'usIsmMfgPrices'], ['Headline', 'Employment', 'New orders', 'Prices']],
    ['ISM services & subindices', ['usIsmServices', 'usIsmServicesEmployment', 'usIsmServicesOrders', 'usIsmServicesPrices'], ['Headline', 'Employment', 'New orders', 'Prices']],
    ['S&P Global PMIs', ['usSpMfg', 'usSpServices'], ['Manufacturing', 'Services']],
  ],
  'macro-us-household': [
    ['University of Michigan consumer sentiment', ['usMichigan'], ['Sentiment']],
    ['Retail sales', ['usRetailSales'], ['MoM']],
    ['Personal spending', ['usPersonalSpending'], ['MoM']],
    ['Existing home sales', ['usExistingHomes'], ['Annualized rate']],
  ],
  'macro-cn-inflation': [
    ['Consumer prices — YoY', ['cnCpiYoy'], ['CPI YoY']],
    ['Consumer prices — MoM', ['cnCpiMom'], ['CPI MoM']],
    ['Producer prices — YoY', ['cnPpiYoy'], ['PPI YoY']],
    ['Producer prices — MoM', ['cnPpiMom'], ['PPI MoM']],
  ],
  'macro-cn-pmi': [
    ['NBS purchasing managers indices', ['cnNbsMfg', 'cnNbsNonMfg'], ['Manufacturing', 'Non-manufacturing']],
    ['RatingDog purchasing managers indices', ['cnRatingDogMfg', 'cnRatingDogServices'], ['Manufacturing', 'Services']],
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

function buildData(macro, keys, labels, startDate, endDate) {
  const available = keys.map(key => macro?.series?.[key]).filter(Boolean);
  const dates = [...new Set(available.flatMap(series => series.data
    .filter(point => inDateRange(point.date, startDate, endDate))
    .map(point => point.date)))].sort();
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const datasets = [];
  const latest = [];
  keys.forEach((key, seriesIndex) => {
    const series = macro?.series?.[key];
    if (!series) return;
    const values = Array(dates.length).fill(null);
    series.data.forEach(point => {
      const index = dateIndex.get(point.date);
      if (index != null) values[index] = point.value;
    });
    datasets.push({
      label: labels[seriesIndex], data: values,
      borderColor: COLORS[seriesIndex], backgroundColor: `${COLORS[seriesIndex]}55`,
      borderWidth: seriesIndex === 0 ? 2 : 1.7, pointRadius: 0, pointHoverRadius: 3,
      tension: 0.2, spanGaps: true,
    });
    latest.push(latestPoint(series));
  });
  return { labels: dates.map(fmtDate), datasets, available, latest };
}

function MacroChart({ definition, macro, errors, startDate, endDate }) {
  const [title, keys, labels, chartType = 'line', decimals] = definition;
  const built = useMemo(
    () => buildData(macro, keys, labels, startDate, endDate),
    [macro, keys, labels, startDate, endDate],
  );
  const chartData = useMemo(() => {
    if (chartType !== 'bar') return { labels: built.labels, datasets: built.datasets };
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
  // Legend chips double as a "latest reading" readout, appended per series.
  const latestText = useMemo(() => built.latest.map(point =>
    point ? `${compact(point.value, decimals)}${percentUnit ? '%' : ''}` : null,
  ), [built.latest, percentUnit, decimals]);
  const options = useMemo(() => {
    const opts = baseOpts(value => `${compact(value, decimals)}${percentUnit ? '%' : ''}`);
    opts.plugins.legend = {
      display: true,
      position: 'bottom',
      labels: {
        color: '#c8c8c0', boxWidth: 10, padding: 12, font: { size: 10 },
        generateLabels: chart => chart.data.datasets.map((dataset, index) => ({
          text: latestText[index] ? `${dataset.label}  ${latestText[index]}` : dataset.label,
          fillStyle: dataset.borderColor,
          strokeStyle: dataset.borderColor,
          hidden: !chart.isDatasetVisible(index),
          datasetIndex: index,
        })),
      },
    };
    opts.plugins.tooltip.callbacks.label = context =>
      ` ${context.dataset.label}: ${compact(context.parsed.y, decimals)}${percentUnit ? '%' : ''}`;
    opts.plugins.zeroLine = { display: true };
    return opts;
  }, [latestText, percentUnit, decimals]);
  const source = built.available[0];
  const missing = keys.filter(key => !macro?.series?.[key]);

  return (
    <ChartCard
      chartId={`macro-${keys.join('-')}`}
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
          ? <Bar data={chartData} options={options} />
          : <Line data={chartData} options={options} />
        : <div className="macro-empty">{errors ? 'Series temporarily unavailable from Trading Economics.' : 'Loading macro history…'}</div>}
    </ChartCard>
  );
}

export default function Macro({ viewId }) {
  const { liveData, loading } = useData();
  const [startDate, setStartDate] = useState(() => isoYearsAgo(1));
  const [endDate, setEndDate] = useState(() => todayIso());
  const macro = liveData?.macro;
  const charts = PAGE_CHARTS[viewId] || PAGE_CHARTS['macro-us-inflation'];
  return (
    <div className="macro-page">
      <MacroDateControls
        startDate={startDate}
        endDate={endDate}
        onStartDate={setStartDate}
        onEndDate={setEndDate}
      />
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
          />
        ))}
      </div>
    </div>
  );
}

export { PAGE_CHARTS };
