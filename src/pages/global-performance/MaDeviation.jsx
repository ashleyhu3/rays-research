import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';
import { useResource } from '../../services/resourceCache';

/**
 * Liquidity → Technical → Deviation.
 *
 * How far a market trades from its own 200-day moving average, as a percentage
 * of that average — the ten indices the Breadth page covers, plus gold. Above
 * the average fills blue, below it fills red, and the dashed line at −10% marks
 * the level conventionally read as a discount.
 *
 * The whole payload (one date axis plus every series' history) arrives in a
 * single request, so switching series is instant; only the index closes and one
 * gold close per day are involved, which is a small response.
 */

const MA_WINDOW = 200;
const DISCOUNT_LEVEL = -10;

// Diverging pair: one cool pole above the average, one warm below, with the
// zero line itself neutral. Position already carries the sign, so the colours
// reinforce it rather than being the only cue.
const ABOVE = { line: '#3c8cdd', fill: 'rgba(60,140,221,.55)' };
const BELOW = { line: '#e05252', fill: 'rgba(224,82,82,.55)' };

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

function fmtAsOf(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const fmtPct = value => (value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`);
const fmtLevel = value => (value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 }));

function buildChartData(series, dates) {
  if (!series?.deviation?.length) return null;
  return {
    labels: dates.map(fmtDate),
    datasets: [
      {
        label: `${series.label} vs 200-day MA`,
        data: series.deviation,
        // Chart.js fills toward the zero baseline, taking the colour of the
        // side the value sits on — one dataset, two bands.
        fill: { target: 'origin', above: ABOVE.fill, below: BELOW.fill },
        borderColor: ABOVE.line,
        // The outline follows the sign too, so a stretch below the average is
        // not drawn with the "above" colour along its top edge.
        segment: {
          borderColor: ctx => (ctx.p0.parsed.y < 0 && ctx.p1.parsed.y < 0 ? BELOW.line : ABOVE.line),
        },
        borderWidth: 1,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHitRadius: 6,
        tension: 0.1,
        spanGaps: true,
      },
      {
        label: '10% discount',
        data: dates.map(() => DISCOUNT_LEVEL),
        borderColor: 'rgba(224,82,82,.5)',
        borderWidth: 1,
        borderDash: [5, 4],
        pointRadius: 0,
        pointHitRadius: 0,
        fill: false,
      },
    ],
  };
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 8, boxWidth: 10 },
      },
      // Neutral baseline: the average itself, the level both bands are read against.
      zeroLine: { color: 'rgba(200,200,192,.45)', dash: [3, 3] },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: {
          label: c => (c.parsed.y == null
            ? ` ${c.dataset.label}: —`
            : ` ${c.dataset.label}: ${c.parsed.y > 0 ? '+' : ''}${c.parsed.y.toFixed(2)}%`),
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 10, autoSkip: true }, border: BORD },
      y: {
        grid: GRID,
        ticks: { ...TICK, callback: v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%` },
        border: BORD,
      },
    },
  };
}

export default function MaDeviation() {
  const { data, error } = useResource('/api/ma-deviation');
  const [seriesKey, setSeriesKey] = useState(null);

  const series = data?.series ?? [];
  const dates = data?.dates ?? [];

  // Default to the first series once the payload lands, and recover if a key
  // ever disappears from it rather than charting nothing.
  useEffect(() => {
    if (!series.length) return;
    if (!series.some(s => s.key === seriesKey)) setSeriesKey(series[0].key);
  }, [series, seriesKey]);

  const active = series.find(s => s.key === seriesKey) ?? null;
  const chartData = useMemo(() => buildChartData(active, dates), [active, dates]);

  const picker = (
    <div className="mac-indexes">
      {series.map(item => (
        <button
          key={item.key}
          className={`mac-index${item.key === seriesKey ? ' active' : ''}`}
          onClick={() => setSeriesKey(item.key)}
          title={item.latest == null
            ? `${item.label} — not enough history for a ${MA_WINDOW}-day average yet`
            : `${item.label} closed ${fmtPct(item.latest)} ${item.latest < 0 ? 'below' : 'above'} its ${MA_WINDOW}-day average on ${fmtAsOf(item.asOf)}`}
        >
          {item.label}
          <span className={`dev-chip ${item.latest == null ? '' : item.latest < 0 ? 'below' : 'above'}`}>
            {fmtPct(item.latest)}
          </span>
        </button>
      ))}
    </div>
  );

  if (error || !data) {
    return (
      <>
        <div className="empty">
          {error
            ? `Could not load 200-day deviation data: ${error}`
            : 'Loading 200-day deviation data…'}
        </div>
      </>
    );
  }

  const discounted = series.filter(item => item.latest != null && item.latest <= DISCOUNT_LEVEL);
  const below = series.filter(item => item.latest != null && item.latest < 0);

  return (
    <>
      {picker}

      <div className="mac-level-note">
        {discounted.length
          ? <>At a 10% discount or deeper today: {discounted.map((item, i) => (
              <span key={item.key}>
                {i > 0 && ', '}
                <button className="mac-level-link" onClick={() => setSeriesKey(item.key)}>{item.label}</button>
                <span className="dev-chip below">{fmtPct(item.latest)}</span>
              </span>
            ))}</>
          : <>Nothing sits 10% or more below its {MA_WINDOW}-day average today
              — {below.length ? `${below.length} of ${series.length} trade below theirs` : `all ${series.length} trade above theirs`}.
            </>}
      </div>

      {active && chartData && (
        <div className="cgrid">
          <ChartCard
            title={`${active.label} — % above/below its ${MA_WINDOW}-day moving average`}
            src={active.key === 'gold' ? 'Yahoo Finance (COMEX gold futures)' : 'Yahoo Finance / Sina'}
            freq="Daily"
            span2
            height={420}
            srcNote={active.latest == null
              ? `${active.label} has no ${MA_WINDOW}-session history yet, so it carries no deviation.`
              : `${active.label} closed at ${fmtLevel(active.close)} on ${fmtAsOf(active.asOf)}, ${fmtPct(active.latest)} ${active.latest < 0 ? 'below' : 'above'} its ${MA_WINDOW}-day average of ${fmtLevel(active.ma200)}.`}
          >
            <Line data={chartData} options={chartOptions()} />
          </ChartCard>
        </div>
      )}

      <div className="src-note" style={{ marginTop: 12 }}>
        Each day&rsquo;s close measured against the simple average of the last {MA_WINDOW} trading sessions, as a
        percentage of that average: blue where price sits above its long-run average, red where it sits below. Coverage
        is the same ten indices the Breadth page tracks — S&amp;P 500, Nasdaq 100, SOX, Hang Seng, CSI 300, ChiNext,
        TAIEX, KOSPI 200, Nikkei 225 and TOPIX — from the index close series that also feeds the RSI and MA Cross
        charts, plus COMEX gold futures. The dashed line marks a 10% discount to the average. A series needs
        {' '}{MA_WINDOW} traded sessions before its average is defined, so each one begins about ten months after its
        history starts, and markets that were shut on a given date leave a gap rather than a carried-forward value.
      </div>
    </>
  );
}
