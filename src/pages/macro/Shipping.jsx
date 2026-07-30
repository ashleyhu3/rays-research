import { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useData } from '../../context/DataContext';
import { baseOpts } from '../../utils/chartHelpers';
import MacroDateControls, { inDateRange, isoYearsAgo, todayIso } from './MacroDateControls';

// One colour per group, so every chart in a section reads as the same family.
const GROUP_COLOR = {
  hormuz: '#56b4e9',
  tankers: '#ef8354',
  'dry-bulk': '#e8c547',
  container: '#5dd39e',
};
// Matches --bg-card; outlines annotation labels so they stay legible over the line.
const SURFACE = '#111419';
const ANNOTATION_COLOR = 'rgba(200,200,192,.45)';

function fmtValue(value) {
  const abs = Math.abs(value);
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: abs >= 100 ? 0 : 2,
  });
}

function fmtDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// The Hormuz feed publishes an event-driven point whenever throughput moves,
// so its observations are days apart early on and daily since mid-July. A
// category axis would spread those unevenly-spaced readings evenly and flatten
// the timeline, so that one chart plots against a linear day axis instead.
// (Chart.js' time scale would need a date adapter this app doesn't ship.)
function dayNumber(iso) {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
}

function dayNumberToIso(value) {
  return new Date(Math.round(value) * 86400000).toISOString().slice(0, 10);
}

/** Vertical dashed markers for the crisis timeline the Hormuz monitor publishes
 *  alongside its throughput series. */
const EVENT_MARKS = {
  id: 'shippingEventMarks',
  afterDatasetsDraw(chart, _args, pluginOptions) {
    const marks = pluginOptions?.marks;
    if (!marks?.length) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    marks.forEach(mark => {
      const x = scales.x.getPixelForValue(mark.x);
      if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
      ctx.strokeStyle = ANNOTATION_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.translate(x, chartArea.top + 4);
      ctx.rotate(Math.PI / 2);
      ctx.font = "600 9px 'Inter', sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = SURFACE;
      ctx.strokeText(mark.label, 4, 0);
      ctx.fillStyle = ANNOTATION_COLOR;
      ctx.fillText(mark.label, 4, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    });
    ctx.restore();
  },
};

function ShippingChart({ series, annotations, error, startDate, endDate, loading }) {
  const data = useMemo(
    () => (series?.data ?? []).filter(point => inDateRange(point.date, startDate, endDate)),
    [series, startDate, endDate],
  );
  const isHormuz = series?.group === 'hormuz';
  const color = GROUP_COLOR[series?.group] ?? GROUP_COLOR.container;

  const chartData = useMemo(() => ({
    ...(isHormuz ? {} : { labels: data.map(point => fmtDate(point.date)) }),
    datasets: [{
      label: series?.name ?? '',
      data: isHormuz
        ? data.map(point => ({ x: dayNumber(point.date), y: point.value }))
        : data.map(point => point.value),
      borderColor: color,
      backgroundColor: `${color}24`,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.18,
      fill: isHormuz,
      spanGaps: true,
    }],
  }), [data, series?.name, color, isHormuz]);

  const marks = useMemo(() => {
    if (!isHormuz || !data.length) return [];
    const first = data[0].date;
    const last = data[data.length - 1].date;
    return (annotations ?? [])
      .filter(item => item.date >= first && item.date <= last)
      .map(item => ({ x: dayNumber(item.date), label: item.label }));
  }, [isHormuz, annotations, data]);

  const options = useMemo(() => {
    const opts = baseOpts(value => (isHormuz ? `${fmtValue(value)}%` : fmtValue(value)));
    opts.plugins.legend = { display: false };
    opts.plugins.zeroLine = { display: false };
    if (isHormuz) {
      opts.scales.y.min = 0;
      opts.scales.y.max = 100;
      opts.scales.x.type = 'linear';
      opts.scales.x.ticks.callback = value => fmtDate(dayNumberToIso(value));
      if (data.length) {
        // Pin the axis to the observed range; a linear scale would otherwise
        // round out to the next tick and leave the series stranded mid-chart.
        opts.scales.x.min = dayNumber(data[0].date);
        opts.scales.x.max = dayNumber(data[data.length - 1].date);
      }
      opts.plugins.shippingEventMarks = { marks };
    }
    opts.scales.x.ticks.maxTicksLimit = 7;
    opts.plugins.tooltip.callbacks = {
      title: items => data[items[0]?.dataIndex]?.date ?? '',
      label: context => {
        const point = data[context.dataIndex];
        const lines = [` ${fmtValue(point.value)}${isHormuz ? '% of pre-war baseline' : ` ${series.unit}`}`];
        if (point.vessels != null) lines.push(` Transits: ${point.vessels}`);
        if (point.note) lines.push(` ${point.note}`);
        return lines;
      },
    };
    return opts;
  }, [data, isHormuz, marks, series?.unit]);

  const latest = data.length ? data[data.length - 1] : null;

  return (
    <ChartCard
      chartId={`shipping-${series.id}`}
      title={latest ? `${series.name} · ${fmtValue(latest.value)}${isHormuz ? '%' : ''}` : series.name}
      src={series.source}
      srcUrl={series.sourceUrl}
      freq={series.frequency}
      lag={isHormuz ? 'updated through the latest transit count' : 'latest published settlement'}
      height={isHormuz ? 320 : 260}
      span2={isHormuz}
    >
      {data.length
        ? <Line data={chartData} options={options} plugins={isHormuz ? [EVENT_MARKS] : undefined} />
        : (
          <div className="macro-empty">
            {loading ? 'Loading shipping history…'
              : error ? `Unavailable — ${error}`
                : 'No observations for this series in the selected date range.'}
          </div>
        )}
    </ChartCard>
  );
}

export default function Shipping() {
  const { liveData, loading } = useData();
  const [startDate, setStartDate] = useState(() => isoYearsAgo(1));
  const [endDate, setEndDate] = useState(() => todayIso());
  const payload = liveData?.shipping;
  const groups = payload?.groups ?? [];

  return (
    <div className="macro-page">
      <MacroDateControls
        startDate={startDate}
        endDate={endDate}
        onStartDate={setStartDate}
        onEndDate={setEndDate}
      />
      {payload?.updatedAt && (
        <div className="macro-update">
          Hormuz transits, Baltic settlements and container freight indices · refreshed {new Date(payload.updatedAt).toLocaleString()}
        </div>
      )}
      {!payload && (
        loading
          ? <div className="macro-empty">Loading shipping history…</div>
          : <div className="macro-banner">Shipping data is unavailable. Use Refresh Data to retry the upstream sources.</div>
      )}
      {groups.map(group => {
        const series = (payload?.order ?? [])
          .map(id => payload.series?.[id])
          .filter(item => item?.group === group.key);
        if (!series.length) return null;
        return (
          <section key={group.key}>
            <div className="macro-section">{group.label}</div>
            <div className="cgrid">
              {series.map(item => (
                <ShippingChart
                  key={item.id}
                  series={item}
                  annotations={payload.annotations}
                  error={payload.errors?.[item.id]}
                  startDate={startDate}
                  endDate={endDate}
                  loading={loading}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
