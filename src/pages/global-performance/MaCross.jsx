import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { GLOBAL_INDICES, BREADTH_PHASE1_KEYS } from '../../config/globalIndices';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';
import { useResource } from '../../services/resourceCache';

/**
 * Liquidity → Technical → MA Cross.
 *
 * The strip under the page title lists only the names whose 5-day SMA crossed
 * their 20-day SMA on the most recent session — a green ▲ where the 5-day moved
 * up through the 20-day, a red ▼ where it dropped below. The server recomputes
 * that set from the latest session each time the breadth raw-price cache
 * refreshes, so the names turn over daily.
 *
 * Coverage matches the Breadth page: every index whose constituents the breadth
 * job already caches. One index is loaded at a time, since the underlying raw
 * caches are large (TOPIX alone carries ~1,600 tickers).
 */

const INDEX_BY_KEY = new Map(GLOBAL_INDICES.map(index => [index.key, index]));
const MA_CROSS_INDEXES = BREADTH_PHASE1_KEYS.map(key => ({
  key,
  label: INDEX_BY_KEY.get(key)?.label ?? key,
}));

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

function fmtAsOf(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const DIRECTION_LABEL = {
  golden: '5-day moved above the 20-day',
  death: '5-day dropped below the 20-day',
};

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
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: {
          label: c => (c.parsed.y == null ? ` ${c.dataset.label}: —` : ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)}`),
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 8, autoSkip: true }, border: BORD },
      y: { grid: GRID, ticks: { ...TICK, callback: v => v.toFixed(0) }, border: BORD },
    },
  };
}

export default function MaCross() {
  const [indexKey, setIndexKey] = useState(MA_CROSS_INDEXES[0]?.key ?? 'sp500');
  const { data, error } = useResource(`/api/ma-cross?index=${indexKey}`);
  const [selected, setSelected] = useState(null);

  // Each index caches under its own URL, so switching back to one already
  // viewed is instant. `crosses` is only ever the active index's list.
  const crosses = data?.index === indexKey ? data.crosses : [];

  // The selected name is keyed to a session's cross list. When that list
  // refreshes and no longer contains it, fall back to the first name rather
  // than rendering an empty chart.
  useEffect(() => {
    if (!crosses.length) {
      if (selected !== null) setSelected(null);
    } else if (!crosses.some(c => c.ticker === selected)) {
      setSelected(crosses[0].ticker);
    }
  }, [crosses, selected]);

  const active = crosses.find(c => c.ticker === selected) ?? null;

  const chartData = useMemo(() => {
    if (!active) return null;
    return {
      labels: active.dates.map(fmtDate),
      datasets: [
        {
          label: 'Close',
          data: active.closes,
          borderColor: 'rgba(234,234,224,.45)',
          backgroundColor: 'transparent',
          borderWidth: 1.25,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointHitRadius: 6,
          tension: 0.15,
          spanGaps: true,
        },
        {
          label: '5-day MA',
          data: active.sma5Series,
          borderColor: '#4ade80',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointHitRadius: 6,
          tension: 0.15,
          spanGaps: true,
        },
        {
          label: '20-day MA',
          data: active.sma20Series,
          borderColor: '#e8c547',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointHitRadius: 6,
          tension: 0.15,
          spanGaps: true,
        },
      ],
    };
  }, [active]);

  const goldenCount = crosses.filter(c => c.direction === 'golden').length;
  const deathCount = crosses.length - goldenCount;
  const indexLabel = MA_CROSS_INDEXES.find(i => i.key === indexKey)?.label ?? indexKey;
  const isLoaded = data?.index === indexKey;

  const indexPicker = (
    <div className="mac-indexes">
      {MA_CROSS_INDEXES.map(index => (
        <button
          key={index.key}
          className={`mac-index${index.key === indexKey ? ' active' : ''}`}
          onClick={() => setIndexKey(index.key)}
        >
          {index.label}
        </button>
      ))}
    </div>
  );

  // The picker stays mounted while an index loads, so switching never blanks
  // the control the user just clicked.
  if (error || !isLoaded) {
    return (
      <>
        {indexPicker}
        <div className="empty">
          {error
            ? `Could not load MA cross data for ${indexLabel}: ${error}`
            : `Loading ${indexLabel} MA cross data…`}
        </div>
      </>
    );
  }

  return (
    <>
      {indexPicker}
      <div className="mac-bar">
        <div className="mac-bar-head">
          <span className="mac-asof">{indexLabel} — crossings on {fmtAsOf(data.asOf)}</span>
          <span className="mac-counts">
            <span className="mac-arrow golden">▲</span> {goldenCount}
            <span className="mac-arrow death">▼</span> {deathCount}
            <span className="mac-universe">of {data.tickerCount} constituents</span>
          </span>
        </div>
        {crosses.length ? (
          <div className="mac-tickers">
            {crosses.map(c => (
              <button
                key={c.ticker}
                className={`mac-ticker${c.ticker === selected ? ' active' : ''}`}
                onClick={() => setSelected(c.ticker)}
                title={`${c.ticker} — ${DIRECTION_LABEL[c.direction]}`}
              >
                {c.ticker}
                <span className={`mac-arrow ${c.direction}`}>{c.direction === 'golden' ? '▲' : '▼'}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mac-none">No 5/20-day crossings on this session.</div>
        )}
      </div>

      {active && chartData && (
        <div className="cgrid">
          <ChartCard
            title={`${active.ticker} (${indexLabel}) — 5-day vs 20-day MA`}
            src="Yahoo Finance"
            srcUrl="https://finance.yahoo.com"
            freq="Daily"
            span2
            height={420}
            srcNote={`${DIRECTION_LABEL[active.direction]} on ${fmtAsOf(data.asOf)} — close ${active.close}, 5-day MA ${active.sma5}, 20-day MA ${active.sma20}.`}
          >
            <Line data={chartData} options={chartOptions()} />
          </ChartCard>
        </div>
      )}

      <div className="src-note" style={{ marginTop: 12 }}>
        Simple moving averages of the daily closing price over the last 5 and 20 trading sessions, computed per
        constituent from the same per-index price caches that feed the Breadth page — S&amp;P 500, Nasdaq 100, SOX,
        Hang Seng, CSI 300, ChiNext, TAIEX, KOSPI 200, Nikkei 225 and TOPIX. A name is listed only when its two
        averages crossed on the most recent session, so the list changes every day.
      </div>
    </>
  );
}
