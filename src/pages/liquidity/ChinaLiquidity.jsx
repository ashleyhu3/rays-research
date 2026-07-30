import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useResource } from '../../services/resourceCache';
import ChinaFlowNationalTeam from './ChinaFlowNationalTeam';
import ChinaStockConnect from './ChinaStockConnect';
import LiquidityDateControls, {
  filterDateRange,
  useLiquidityDateRange,
} from './LiquidityDateControls';

const BLUE = '#4577b4';
const GOLD = '#c9a227';
const GREEN = '#3a9e6b';
const RED = '#c65d57';
const MUTED = '#8a8a84';

function compactCny(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e12) return `¥${(value / 1e12).toFixed(2)}tn`;
  return `¥${(value / 1e8).toFixed(0)}亿`;
}

const percent = value => `${value.toFixed(2)}%`;
// The spread is a difference of two growth rates, so it reads in percentage
// points and the sign carries the whole signal — keep it explicit.
const spreadPoints = value => `${value > 0 ? '+' : ''}${value.toFixed(2)}pp`;

/** Per-series presentation. `monthly` drives both the axis-label cadence and the
 * lookback: the daily series show a rolling year, the money-supply series keep
 * their full history. `unit` is the axis suffix — null means the CNY axis. */
const SERIES = {
  turnover: {
    color: BLUE, fmt: compactCny, unit: null, monthly: false, fill: true,
    lag: 'End of trading day',
    note: 'Daily total A-share market turnover (成交额), persisted by the scheduled collector.',
  },
  turnoverRate: {
    color: GREEN, fmt: percent, unit: '%', monthly: false, fill: true,
    lag: 'End of trading day',
    note: 'Daily turnover rate (换手率) for the East Money All-A (Shanghai, Shenzhen, and '
      + 'Beijing) market index, persisted alongside the total-market turnover history.',
  },
  m1Yoy: {
    color: RED, fmt: percent, unit: '%', monthly: true, fill: false,
    lag: 'Published monthly',
    note: 'Year-over-year growth calculated from the stored monthly M1 level series. '
      + 'M1 is the narrow aggregate — currency in circulation plus demand deposits — so it '
      + 'tracks money that is ready to be spent.',
  },
  m2Yoy: {
    color: GOLD, fmt: percent, unit: '%', monthly: true, fill: false,
    lag: 'Published monthly',
    note: 'Year-over-year growth is calculated from the stored monthly M2 level series.',
  },
  m1M2Spread: {
    color: BLUE, fmt: spreadPoints, unit: 'pp', monthly: true,
    // Diverging fill against the zero line: the sign of the 剪刀差 is the point.
    fill: { target: 'origin', above: `${GREEN}2e`, below: `${RED}2e` },
    lag: 'Published monthly',
    note: 'M1 growth minus M2 growth (剪刀差), in percentage points. A widening positive '
      + 'gap means deposits are shifting into spendable demand money — historically an '
      + 'early signal of reflating activity; a negative gap means money is sitting in time '
      + 'deposits instead.',
  },
};

/** Chart layout per page section. Each entry is one card; a card listing several
 * kinds plots them on shared axes (M1 and M2 growth belong on one chart). The
 * money-supply pair is stacked full-width so the spread reads directly under the
 * two growth lines it is derived from, on the same x positions. */
const CARDS = {
  'money-supply': [
    { title: 'Money Supply Growth — M1 vs M2', kinds: ['m1Yoy', 'm2Yoy'], span2: true },
    { title: 'M1–M2 Spread (剪刀差)', kinds: ['m1M2Spread'], span2: true },
  ],
  turnover: [{ kinds: ['turnover'] }, { kinds: ['turnoverRate'] }],
};

/** Chart.js walks its tick values by repeated float addition, so they routinely
 * arrive with noise: an axis starting at 1.4 in steps of 0.2 yields 1.4000000000000001.
 * Its built-in formatter rounds that away, but a custom tick callback bypasses the
 * formatter entirely — printing the raw number puts `1.4000000000000001%` on the
 * axis. Take the precision from the step instead, since that is what decides how
 * many decimals the axis actually needs, and render every label at that width so
 * whole-number ticks (`2.0%`) still line up with fractional ones. */
function stepDecimals(ticks) {
  const step = ticks?.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) : 0;
  if (!Number.isFinite(step) || step <= 0) return 0;
  // Round off the accumulated noise before counting, or the step itself reads as
  // 0.19999999999999996. Sub-microscopic steps fall back to the cap.
  const text = Number(step.toPrecision(12)).toString();
  if (text.includes('e')) return 4;
  const [, fraction = ''] = text.split('.');
  return Math.min(fraction.length, 4);
}

function unitTick(value, ticks, unit) {
  return `${Number(value).toFixed(stepDecimals(ticks))}${unit}`;
}

function dateLabel(date, monthly) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', year: monthly ? '2-digit' : undefined, day: monthly ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

function SeriesCard({ card, entries, span2 }) {
  const { monthly, lag, unit } = SERIES[card.kinds[0]];
  const lead = entries[0]?.series;

  if (entries.some(entry => !entry.series)) return <div className={`cbox${span2 ? ' span2' : ''}`}><div className="empty">Loading stored China liquidity history…</div></div>;
  if (entries.every(entry => !entry.points.length)) return <div className={`cbox${span2 ? ' span2' : ''}`}><div className="empty">No {card.title ?? lead.name} history in the selected timeframe.</div></div>;

  // Grouped series are published together but can land a month apart mid-release,
  // so plot against the union of their dates rather than assuming a shared index.
  const dates = [...new Set(entries.flatMap(entry => entry.points.map(point => point.date)))].sort();
  const data = {
    labels: dates.map(date => dateLabel(date, monthly)),
    datasets: entries.map(({ kind, series, points }) => {
      const byDate = new Map(points.map(point => [point.date, point.value]));
      const { color, fill } = SERIES[kind];
      return {
        label: series.name, data: dates.map(date => byDate.get(date) ?? null),
        borderColor: color, backgroundColor: `${color}24`, borderWidth: 2,
        pointRadius: monthly ? 2 : 0, pointHoverRadius: 4, tension: 0.2,
        fill, spanGaps: true,
      };
    }),
  };
  const options = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: entries.length > 1
        ? { display: true, position: 'bottom', labels: { color: MUTED, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'line', font: { size: 10 } } }
        : { display: false },
      tooltip: { callbacks: {
        title: items => dates[items[0]?.dataIndex] ?? '',
        label: context => ` ${entries.length > 1 ? `${context.dataset.label}: ` : ''}`
          + `${SERIES[card.kinds[context.datasetIndex]].fmt(context.raw)}`,
      } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: MUTED, maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } } },
      y: {
        // A series that crosses zero needs the baseline to read differently from
        // the other gridlines — otherwise the sign of the spread is guesswork.
        grid: { color: context => (context.tick.value === 0 ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.07)') },
        ticks: {
          color: MUTED, font: { size: 10 },
          callback: (value, _index, ticks) => (unit
            ? unitTick(value, ticks, unit)
            : compactCny(Number(value))),
        },
      },
    },
  };

  return (
    <ChartCard
      chartId={`china-liquidity-${card.kinds.join('-')}`}
      title={`China · ${card.title ?? lead.name}`}
      src={<a className="ch-src" href={lead.sourceUrl} target="_blank" rel="noopener noreferrer">{lead.source}</a>}
      freq={lead.frequency} lag={lag}
      span2={span2} height={360}
      srcNote={card.kinds.map(kind => SERIES[kind].note).join(' ')}
    >
      <Line data={data} options={options} />
    </ChartCard>
  );
}

function LiquiditySeries({ cards, startDate, endDate }) {
  // Loads once on first visit, then served from the shared cache on every
  // subsequent mount (stays loaded across navigation and refresh).
  const { data: payload, error } = useResource('/api/china-liquidity');
  const resolved = useMemo(
    () => cards.map(card => ({
      card,
      entries: card.kinds.map(kind => {
        const series = payload?.[kind];
        return { kind, series, points: filterDateRange(series?.data, startDate, endDate) };
      }),
    })),
    [payload, startDate, endDate, cards],
  );
  const tiles = resolved.flatMap(({ entries }) => entries);

  if (error) return <div className="empty">China liquidity data unavailable: {error}</div>;

  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          {tiles.map(({ kind, series, points }) => {
            const latest = points.at(-1);
            if (!series || !latest) return null;
            const { color, fmt } = SERIES[kind];
            return (
              <div className="lev-tile" key={kind}>
                <div className="lev-tile-label">
                  <span className="lev-dot" style={{ background: color }} />
                  {tiles.length > 1 ? series.name : 'Latest'}
                </div>
                <div className="lev-tile-value">{fmt(latest.value)}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="cgrid">
        {resolved.map(({ card, entries }) => (
          <SeriesCard
            key={card.kinds.join('-')} card={card} entries={entries}
            span2={card.span2 ?? resolved.length === 1}
          />
        ))}
      </div>
    </>
  );
}

export default function ChinaLiquidity({ section }) {
  const dateRange = useLiquidityDateRange();
  let content;
  if (section === 'stock-connect') content = <ChinaStockConnect {...dateRange} />;
  else if (section === 'turnover' || section === 'turnover-rate') {
    content = <LiquiditySeries cards={CARDS.turnover} {...dateRange} />;
  } else if (section === 'money-supply') content = <LiquiditySeries cards={CARDS['money-supply']} {...dateRange} />;
  else content = <ChinaFlowNationalTeam {...dateRange} />;

  return (
    <>
      <LiquidityDateControls {...dateRange} />
      {content}
    </>
  );
}
