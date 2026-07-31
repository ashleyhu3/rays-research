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

const MA_LINE = { backgroundColor: 'transparent', pointRadius: 0, pointHoverRadius: 3, pointHitRadius: 6, tension: 0.15, spanGaps: true };

/** Close / 5-day / 20-day datasets — shared by the index-level and
 *  constituent charts so both read identically. */
function buildMaSeries(item) {
  if (!item?.dates?.length) return null;
  return {
    labels: item.dates.map(fmtDate),
    datasets: [
      { ...MA_LINE, label: 'Close', data: item.closes, borderColor: 'rgba(234,234,224,.45)', borderWidth: 1.25 },
      { ...MA_LINE, label: '5-day MA', data: item.sma5Series, borderColor: '#4ade80', borderWidth: 2 },
      { ...MA_LINE, label: '20-day MA', data: item.sma20Series, borderColor: '#e8c547', borderWidth: 2 },
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
  // Index-level crossings for all ten indices at once — small, and independent
  // of which index's constituents are loaded.
  const { data: levelData } = useResource('/api/ma-cross/index-level');
  const [selected, setSelected] = useState(null);

  // Each index caches under its own URL, so switching back to one already
  // viewed is instant. `crosses` is only ever the active index's list.
  const crosses = data?.index === indexKey ? data.crosses : [];

  // No constituent is selected by default: the page opens on the index-level
  // chart, and a per-ticker chart appears only once the user picks a name.
  // Switching index clears any previous pick so its chart cannot linger.
  useEffect(() => { setSelected(null); }, [indexKey]);

  // A selection is tied to one session's cross list. If that list refreshes
  // (new trading day) and no longer contains the pick, drop back to the
  // index-level view rather than silently charting a different name.
  useEffect(() => {
    if (selected != null && crosses.length && !crosses.some(c => c.ticker === selected)) {
      setSelected(null);
    }
  }, [crosses, selected]);

  const active = crosses.find(c => c.ticker === selected) ?? null;

  const levelByKey = new Map((levelData?.indexes ?? []).map(index => [index.key, index]));
  const activeLevel = levelByKey.get(indexKey) ?? null;
  const crossedIndexes = (levelData?.indexes ?? []).filter(index => index.direction);

  const chartData = useMemo(() => buildMaSeries(active), [active]);
  const levelChartData = useMemo(() => buildMaSeries(activeLevel), [activeLevel]);

  const goldenCount = crosses.filter(c => c.direction === 'golden').length;
  const deathCount = crosses.length - goldenCount;
  const indexLabel = MA_CROSS_INDEXES.find(i => i.key === indexKey)?.label ?? indexKey;
  const isLoaded = data?.index === indexKey;

  // An arrow on a picker button means the INDEX ITSELF crossed on its latest
  // session — distinct from the constituent crossings listed in the strip below.
  const indexPicker = (
    <div className="mac-indexes">
      {MA_CROSS_INDEXES.map(index => {
        const level = levelByKey.get(index.key);
        return (
          <button
            key={index.key}
            className={`mac-index${index.key === indexKey ? ' active' : ''}`}
            onClick={() => setIndexKey(index.key)}
            title={level?.direction
              ? `${index.label} index itself: ${DIRECTION_LABEL[level.direction]} on ${fmtAsOf(level.asOf)}`
              : level
                ? `${index.label} index itself: 5-day ${level.stance} the 20-day (no cross today)`
                : index.label}
          >
            {index.label}
            {level?.direction && (
              <span className={`mac-arrow ${level.direction}`}>{level.direction === 'golden' ? '▲' : '▼'}</span>
            )}
          </button>
        );
      })}
    </div>
  );

  const indexLevelSummary = levelData && (
    <div className="mac-level-note">
      {crossedIndexes.length
        ? <>Index level crossed today: {crossedIndexes.map((index, i) => (
            <span key={index.key}>
              {i > 0 && ', '}
              <button className="mac-level-link" onClick={() => setIndexKey(index.key)}>{index.label}</button>
              <span className={`mac-arrow ${index.direction}`}>{index.direction === 'golden' ? '▲' : '▼'}</span>
            </span>
          ))}</>
        : <>No index crossed its own 5/20-day averages today
            {activeLevel && <> — {indexLabel}&rsquo;s 5-day sits {activeLevel.stance} its 20-day
              ({activeLevel.sma5} vs {activeLevel.sma20}) as of {fmtAsOf(activeLevel.asOf)}</>}.
          </>}
    </div>
  );

  // The picker stays mounted while an index loads, so switching never blanks
  // the control the user just clicked.
  if (error || !isLoaded) {
    return (
      <>
        {indexPicker}
        {indexLevelSummary}
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
      {indexLevelSummary}
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
          <>
            <div className="mac-tickers">
              {crosses.map(c => (
                <button
                  key={c.ticker}
                  className={`mac-ticker${c.ticker === selected ? ' active' : ''}`}
                  // Clicking the selected name again clears it, returning the
                  // page to the index-level view it opens on.
                  onClick={() => setSelected(current => (current === c.ticker ? null : c.ticker))}
                  title={`${c.ticker} — ${DIRECTION_LABEL[c.direction]}`}
                >
                  {c.ticker}
                  <span className={`mac-arrow ${c.direction}`}>{c.direction === 'golden' ? '▲' : '▼'}</span>
                </button>
              ))}
            </div>
            <div className="mac-hint">
              {active
                ? <>Charting {active.ticker} below — click it again to return to the index-level view.</>
                : <>Select a name to chart its 5/20-day averages.</>}
            </div>
          </>
        ) : (
          <div className="mac-none">No 5/20-day crossings on this session.</div>
        )}
      </div>

      {levelChartData && (
        <div className="cgrid">
          <ChartCard
            title={`${indexLabel} index — 5-day vs 20-day MA`}
            src="Yahoo Finance / East Money"
            freq="Daily"
            span2
            height={340}
            srcNote={activeLevel.direction
              ? `The index itself: ${DIRECTION_LABEL[activeLevel.direction]} on ${fmtAsOf(activeLevel.asOf)} — close ${activeLevel.close}, 5-day MA ${activeLevel.sma5}, 20-day MA ${activeLevel.sma20}.`
              : `The index itself did not cross on ${fmtAsOf(activeLevel.asOf)} — its 5-day MA (${activeLevel.sma5}) sits ${activeLevel.stance} its 20-day MA (${activeLevel.sma20}).`}
          >
            <Line data={levelChartData} options={chartOptions()} />
          </ChartCard>
        </div>
      )}

      {active && chartData && (
        <div className="cgrid">
          <ChartCard
            title={`${active.ticker} (${indexLabel} constituent) — 5-day vs 20-day MA`}
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
        Simple moving averages of the daily closing price over the last 5 and 20 trading sessions, across the same
        ten indices the Breadth page covers — S&amp;P 500, Nasdaq 100, SOX, Hang Seng, CSI 300, ChiNext, TAIEX,
        KOSPI 200, Nikkei 225 and TOPIX. The top chart applies the test to the index&rsquo;s own level (from the index
        close series that also feeds the RSI chart); the ticker strip applies it per constituent (from the breadth
        price caches). A name — or an index — is listed only when its two averages crossed on its most recent
        session, so the list changes every day.
      </div>
    </>
  );
}
