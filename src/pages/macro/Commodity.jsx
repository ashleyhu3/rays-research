import { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useData } from '../../context/DataContext';
import { baseOpts } from '../../utils/chartHelpers';
import MacroDateControls, { inDateRange, isoYearsAgo, todayIso } from './MacroDateControls';

export const COMMODITY_SECTIONS = [
  { key: 'precious-rare', label: 'Precious & Rare Metal', commodities: ['Gold', 'Silver', 'Rare Earth (Neodymium)', 'Tungsten'] },
  { key: 'industrial', label: 'Industrial Metal', commodities: ['Copper', 'Aluminum', 'Lithium', 'Nickel'] },
  { key: 'oil-gas', label: 'Oil & Gas', commodities: ['Crude Oil', 'Natural Gas', 'Fuel Oil', 'LPG'] },
  { key: 'ferrous', label: 'Ferrous Metal', commodities: ['Coal', 'Glass', 'Iron Ore', 'Rebar'] },
  { key: 'agriculture', label: 'Agriculture Product', commodities: ['Hog', 'Soybean Meal', 'Rubber', 'Palm Oil', 'Corn', 'Sugar', 'Coffee', 'Cocoa'] },
  { key: 'chemical', label: 'Chemical', commodities: ['Silicon', 'Methanol', 'PTA', 'PP', 'PVC', 'Soda Ash', 'Urea'] },
];

function compact(value) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

const CandleRenderer = {
  id: 'commodityCandles',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!dataset.candles) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      const width = Math.max(1, Math.min(8, (chartArea.width / Math.max(dataset.candles.length, 1)) * 0.68));
      ctx.save();
      dataset.candles.forEach((candle, index) => {
        const element = meta.data[index];
        if (!element || [candle.open, candle.high, candle.low, candle.close].some(v => !Number.isFinite(v))) return;
        const rising = candle.close >= candle.open;
        const color = rising ? '#5dd39e' : '#ef6f6c';
        const x = element.x;
        const yHigh = scales.y.getPixelForValue(candle.high);
        const yLow = scales.y.getPixelForValue(candle.low);
        const yOpen = scales.y.getPixelForValue(candle.open);
        const yClose = scales.y.getPixelForValue(candle.close);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yHigh);
        ctx.lineTo(x, yLow);
        ctx.stroke();
        const top = Math.min(yOpen, yClose);
        const height = Math.max(1, Math.abs(yClose - yOpen));
        ctx.fillRect(x - width / 2, top, width, height);
      });
      ctx.restore();
    });
  },
};

function CommodityCandle({ series }) {
  const chart = useMemo(() => ({
    labels: series.data.map(point => fmtDate(point.date)),
    datasets: [{
      label: `${series.market} · ${series.name}`,
      data: series.data.map(point => point.close),
      candles: series.data,
      borderColor: '#5dd39e',
      backgroundColor: '#5dd39e',
      borderWidth: 0,
      pointRadius: 0,
      pointHoverRadius: 0,
      showLine: false,
    }],
  }), [series]);

  const options = useMemo(() => {
    const opts = baseOpts(value => compact(value));
    const lows = series.data.map(point => point.low).filter(Number.isFinite);
    const highs = series.data.map(point => point.high).filter(Number.isFinite);
    const low = Math.min(...lows);
    const high = Math.max(...highs);
    const padding = Math.max((high - low) * 0.04, Math.abs(high || low) * 0.01, 1e-6);
    opts.scales.y.min = low - padding;
    opts.scales.y.max = high + padding;
    opts.plugins.legend = { display: false };
    opts.plugins.zeroLine = { display: false };
    opts.plugins.tooltip.callbacks = {
      title: items => series.data[items[0]?.dataIndex]?.date || '',
      label: context => {
        const candle = series.data[context.dataIndex];
        return [
          ` Open: ${compact(candle.open)} ${series.unit}`,
          ` High: ${compact(candle.high)} ${series.unit}`,
          ` Low: ${compact(candle.low)} ${series.unit}`,
          ` Close: ${compact(candle.close)} ${series.unit}`,
        ];
      },
    };
    opts.scales.x.ticks.maxTicksLimit = 7;
    return opts;
  }, [series]);

  return (
    <ChartCard
      chartId={`commodity-${series.id}`}
      title={`${series.commodity} — ${series.market}: ${series.name} [${series.unit}]`}
      src={series.source}
      srcUrl={series.sourceUrl}
      freq={series.frequency}
      lag="latest available close"
      height={285}
    >
      <Line data={chart} options={options} plugins={[CandleRenderer]} />
    </ChartCard>
  );
}

export default function Commodity({ section = 'precious-rare' }) {
  const { liveData, loading } = useData();
  const [startDate, setStartDate] = useState(() => isoYearsAgo(1));
  const [endDate, setEndDate] = useState(() => todayIso());
  const payload = liveData?.commodities;
  const definition = COMMODITY_SECTIONS.find(item => item.key === section) || COMMODITY_SECTIONS[0];
  const order = new Map(definition.commodities.map((commodity, index) => [commodity, index]));
  const series = Object.values(payload?.series || {})
    .filter(item => item.section === definition.key)
    .sort((a, b) => (order.get(a.commodity) - order.get(b.commodity))
      || (a.market === 'Global' ? -1 : b.market === 'Global' ? 1 : 0)
      || a.name.localeCompare(b.name))
    .map(item => ({ ...item, data: item.data.filter(point => inDateRange(point.date, startDate, endDate)) }))
    .filter(item => item.data.length);

  return (
    <div className="macro-page">
      <MacroDateControls
        startDate={startDate}
        endDate={endDate}
        onStartDate={setStartDate}
        onEndDate={setEndDate}
      />
      {payload?.fetchedAt && (
        <div className="macro-update">Commodity OHLC history · refreshed {new Date(payload.fetchedAt).toLocaleString()}</div>
      )}
      {!payload && !loading && <div className="macro-banner">Commodity data is unavailable. Use Refresh Data to retry the upstream sources.</div>}
      <div className="cgrid">
        {series.map(item => <CommodityCandle key={item.id} series={item} />)}
      </div>
      {!series.length && <div className="macro-empty">{loading ? 'Loading commodity candles…' : 'No commodity series are currently available for this section.'}</div>}
    </div>
  );
}
