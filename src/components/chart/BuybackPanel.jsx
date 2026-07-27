import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import ChartCard from './ChartCard';
import { useResource } from '../../services/resourceCache';

// One accent across all three markets: this is the same measure in three
// places, so the US, A-share, and Taiwan panels should read as one series
// rather than three unrelated charts.
const ANNOUNCED = '#4a9b6e';
const TRAILING = '#c9a227';
const SURFACE = '#111419';
const MUTED = '#8a8a84';

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function monthLabel(month) {
  const [year, monthNumber] = month.split('-');
  const name = new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1))
    .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${name} '${year.slice(-2)}`;
}

/**
 * Rolling 12-calendar-month sum. Null until a full year is behind it, and null
 * across any window containing an uncollected month — a rolling total built on
 * a hole reads as a real decline rather than as missing data.
 */
function trailingSum(months, amounts) {
  return months.map((month, index) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const cutoff = new Date(Date.UTC(year, monthNumber - 12, 1)).toISOString().slice(0, 7);
    let sum = 0;
    let reach = 0;
    for (let i = index; i >= 0 && months[i] > cutoff; i -= 1) {
      if (amounts[i] == null) return null;
      sum += amounts[i];
      reach += 1;
    }
    return reach >= 12 ? sum : null;
  });
}

/**
 * Announced share buybacks for one market, as monthly bars in that market's own
 * currency with a trailing-12-month line behind them. Announcements are lumpy —
 * a single mega-cap authorization can be most of a month — so the rolling line
 * is what carries the trend and the bars carry the events.
 */
export default function BuybackPanel({ market, startDate, endDate }) {
  const { data, error } = useResource('/api/buybacks');
  const series = data?.[market];

  const win = useMemo(() => {
    if (!series?.months?.length) return null;
    const from = String(startDate ?? '').slice(0, 7);
    const to = String(endDate ?? '9999-12').slice(0, 7);

    // The trailing line needs a year of run-up before the visible window, so
    // it is computed over the full history and only then sliced to the window.
    const trailing = trailingSum(series.months, series.amount);
    const keep = series.months
      .map((_, index) => index)
      .filter(index => series.months[index] >= from && series.months[index] <= to);
    if (!keep.length) return null;

    return {
      months: keep.map(i => series.months[i]),
      amount: keep.map(i => series.amount[i]),
      count: keep.map(i => series.count[i]),
      sharesOnly: keep.map(i => series.sharesOnly?.[i] ?? 0),
      trailing: keep.map(i => trailing[i]),
    };
  }, [series, startDate, endDate]);

  if (error || !series || !win) {
    return (
      <ChartCard
        chartId={`${market}-buybacks-announced`}
        title={`${series?.label ?? MARKET_TITLE[market]} · Announced buybacks`}
        span2
        height={320}
      >
        <div className="empty">
          {error
            ? `Announced buyback data unavailable: ${error}`
            : 'Loading announced buyback data...'}
        </div>
      </ChartCard>
    );
  }

  const { symbol, unit, label } = series;
  const fmt = value => (value == null ? '—' : `${symbol}${value.toFixed(1)}${unit}`);

  const chartData = {
    labels: win.months.map(monthLabel),
    datasets: [
      {
        type: 'bar',
        label: 'Announced',
        data: win.amount,
        backgroundColor: alpha(ANNOUNCED, 0.62),
        borderColor: ANNOUNCED,
        borderWidth: 1,
        borderRadius: 2,
        barPercentage: 1,
        categoryPercentage: 0.86,
        order: 2,
        yAxisID: 'y',
      },
      {
        type: 'line',
        label: 'Trailing 12M',
        data: win.trailing,
        borderColor: TRAILING,
        backgroundColor: TRAILING,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBorderColor: SURFACE,
        pointHoverBorderWidth: 2,
        tension: 0.25,
        spanGaps: false,
        order: 1,
        yAxisID: 'y1',
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 16, right: 8, bottom: 6 } },
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
          title: items => (items.length ? win.months[items[0].dataIndex] : ''),
          label: context => ` ${context.dataset.label}: ${fmt(context.raw)}`,
          afterBody: items => {
            if (!items.length) return '';
            const index = items[0].dataIndex;
            const announcements = win.count[index] ?? 0;
            const omitted = win.sharesOnly[index] ?? 0;
            const lines = [`${announcements} announcement${announcements === 1 ? '' : 's'}`];
            // Share-count-only programs carry no stated currency value, so they
            // are outside the bar rather than estimated into it.
            if (omitted) lines.push(`+${omitted} with no stated amount`);
            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: MUTED, maxTicksLimit: 12, autoSkip: true, maxRotation: 0,
          padding: 4, font: { size: 10 },
        },
      },
      y: {
        beginAtZero: true,
        grace: '5%',
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: {
          color: MUTED,
          callback: value => `${symbol}${Number(value).toLocaleString()}${unit}`,
          font: { size: 10 },
        },
      },
      y1: {
        position: 'right',
        beginAtZero: true,
        grace: '5%',
        grid: { display: false },
        ticks: {
          color: alpha(TRAILING, 0.85),
          callback: value => `${symbol}${Number(value).toLocaleString()}${unit}`,
          font: { size: 10 },
        },
      },
    },
  };

  return (
    <ChartCard
      chartId={`${market}-buybacks-announced`}
      title={`${label} · Announced buybacks`}
      src={
        <a className="ch-src" href={series.srcUrl} target="_blank" rel="noopener noreferrer">
          <span className="lev-dot" style={{ background: ANNOUNCED }} />{series.srcLabel}
        </a>
      }
      freq="Monthly"
      lag={LAG[market]}
      srcNote={NOTE[market]}
      span2
      height={320}
      legend={[['Announced (month)', ANNOUNCED], ['Trailing 12M', TRAILING]]}
    >
      <Bar data={chartData} options={options} />
    </ChartCard>
  );
}

const MARKET_TITLE = { us: 'US', cn: 'China A-share', tw: 'Taiwan' };

const LAG = {
  us: 'Filing date; EDGAR full-text index rebuilds daily',
  cn: 'Announcement date; table updates next morning',
  tw: 'Board-resolution date; MOPS posts on filing',
};

// Each market states an announcement differently, so what "announced value"
// means has to travel with the chart.
const NOTE = {
  us: 'Value authorized by new share-repurchase programs disclosed on Form 8-K, summed by '
    + 'filing month and counted once per company. Only amounts bound to a new authorization are '
    + 'included — cumulative since-inception totals are excluded. Programs authorized as a share '
    + 'count rather than a dollar amount have no stated value and are excluded from the bar '
    + '(shown in the tooltip), so this is a floor on announced value, not a ceiling.',
  cn: 'Sum of the ceiling of each announced A-share buyback plan, dated by the plan\'s '
    + 'announcement date. Plans that state only a share cap and a price cap are valued at the '
    + 'product of the two. Counted at announcement, so later cancellation or partial execution '
    + 'does not revise the month.',
  tw: 'Planned buyback shares × the top of the announced price band, for every TWSE and TPEx '
    + 'treasury-stock filing, dated by the board-resolution date. Taiwan filings state a share '
    + 'count and a price band rather than a total, so this is the "up to" figure. Counted at '
    + 'announcement, so partial execution does not revise the month.',
};
