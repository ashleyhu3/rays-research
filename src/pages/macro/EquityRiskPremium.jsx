import { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useData } from '../../context/DataContext';
import { baseOpts } from '../../utils/chartHelpers';
import MacroDateControls, { inDateRange, isoYearsAgo, todayIso } from './MacroDateControls';

const ERP_COLOR = '#e8c547';
const ZERO_COLOR = 'rgba(200,200,192,.34)';

function fmtDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day || 1).toLocaleDateString('en-US', {
    month: 'short', year: '2-digit',
  });
}

function points(series) {
  return (series?.data || [])
    .filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.value))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Carry the most recent bond yield into a PE observation. The maximum gap
// prevents stale yield snapshots from being presented as a current ERP.
export function calculateErp(peSeries, usYieldSeries, cnYieldSeries, chinaWeight = 0, maxGapDays = 10) {
  const pe = points(peSeries);
  const us = points(usYieldSeries);
  const cn = points(cnYieldSeries);
  let usIndex = -1;
  let cnIndex = -1;
  const weight = Math.max(0, Math.min(100, Number(chinaWeight) || 0)) / 100;

  return pe.flatMap(observation => {
    while (usIndex + 1 < us.length && us[usIndex + 1].date <= observation.date) usIndex += 1;
    while (cnIndex + 1 < cn.length && cn[cnIndex + 1].date <= observation.date) cnIndex += 1;
    const usPoint = us[usIndex];
    const cnPoint = cn[cnIndex];
    if (!usPoint || (weight > 0 && !cnPoint)) return [];
    const used = weight > 0 ? [usPoint, cnPoint] : [usPoint];
    // Both legs of a blended yield must be fresh, so measure the gap from the
    // older of the matched observations.
    const oldestYieldDate = used.reduce(
      (oldest, point) => !oldest || point.date < oldest ? point.date : oldest,
      '',
    );
    const gapDays = (new Date(`${observation.date}T00:00:00Z`) - new Date(`${oldestYieldDate}T00:00:00Z`)) / 86400000;
    if (gapDays < 0 || gapDays > maxGapDays || observation.value <= 0) return [];
    const bondYield = weight > 0
      ? usPoint.value * (1 - weight) + cnPoint.value * weight
      : usPoint.value;
    const earningsYield = 100 / observation.value;
    return [{
      date: observation.date,
      value: earningsYield - bondYield,
      pe: observation.value,
      earningsYield,
      bondYield,
    }];
  });
}

function latest(data) {
  return data.length ? data[data.length - 1] : null;
}

function ErpChart({ title, peSeries, usYield, cnYield, chinaWeight, startDate, endDate, unavailable }) {
  const data = useMemo(
    () => calculateErp(peSeries, usYield, cnYield, chinaWeight)
      .filter(point => inDateRange(point.date, startDate, endDate)),
    [peSeries, usYield, cnYield, chinaWeight, startDate, endDate],
  );
  const last = latest(data);
  const chartData = useMemo(() => ({
    labels: data.map(point => fmtDate(point.date)),
    datasets: [{
      label: 'Equity risk premium',
      data: data.map(point => point.value),
      borderColor: ERP_COLOR,
      backgroundColor: `${ERP_COLOR}24`,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.18,
      fill: true,
    }],
  }), [data]);
  const options = useMemo(() => {
    const opts = baseOpts(value => `${Number(value).toFixed(2)}%`);
    opts.plugins.legend = { display: false };
    opts.plugins.tooltip.callbacks.label = context => {
      const point = data[context.dataIndex];
      return [
        ` ERP: ${point.value.toFixed(2)}%`,
        ` Earnings yield: ${point.earningsYield.toFixed(2)}%`,
        ` Bond yield: ${point.bondYield.toFixed(2)}%`,
        ` P/E: ${point.pe.toFixed(2)}x`,
      ];
    };
    opts.plugins.zeroLine = { display: true, color: ZERO_COLOR };
    return opts;
  }, [data]);
  const peBasis = peSeries?.peBasis || 'NTM';

  return (
    <ChartCard
      chartId={`equity-risk-premium-${title.toLowerCase().replace(/\s+/g, '-')}`}
      title={`${title} · ${last ? `${last.value.toFixed(2)}%` : 'unavailable'}`}
      src={peSeries?.source || 'Valuation source required'}
      srcUrl={peSeries?.sourceUrl}
      freq={peSeries?.frequency}
      lag="yield matched to nearest prior observation"
      height={280}
      srcNote={`ERP = 1 / ${peBasis} P/E − government bond yield. Values shown in percentage points.${unavailable ? ` ${unavailable}` : ''}`}
    >
      {data.length
        ? <Line data={chartData} options={options} />
        : <div className="macro-empty">{unavailable || 'No aligned P/E and yield observations in this date range.'}</div>}
    </ChartCard>
  );
}

export default function EquityRiskPremium() {
  const { liveData, loading } = useData();
  const [startDate, setStartDate] = useState(() => isoYearsAgo(5));
  const [endDate, setEndDate] = useState(() => todayIso());
  const [hkChinaWeight, setHkChinaWeight] = useState(50);
  const macro = liveData?.macro;
  const series = macro?.series || {};

  return (
    <div className="macro-page">
      <div className="erp-toolbar">
        <MacroDateControls
          startDate={startDate}
          endDate={endDate}
          onStartDate={setStartDate}
          onEndDate={setEndDate}
        />
        <label className="erp-mix">
          <span>HK bond-yield mix</span>
          <span className="erp-mix-input">
            China
            <input
              type="number"
              min="0"
              max="100"
              step="5"
              value={hkChinaWeight}
              onChange={event => setHkChinaWeight(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
            />
            %
          </span>
          <span className="erp-mix-result">US {100 - hkChinaWeight}% · China {hkChinaWeight}%</span>
        </label>
      </div>
      <div className="macro-update">
        {macro?.fetchedAt
          ? `Valuation + government-yield history · refreshed ${new Date(macro.fetchedAt).toLocaleString()}`
          : loading ? 'Loading valuation and yield history…' : 'Valuation history unavailable'}
      </div>
      <div className="cgrid erp-grid">
        <ErpChart
          title="United States"
          peSeries={series.usForwardPe}
          usYield={series.us10yYield}
          chinaWeight={0}
          startDate={startDate}
          endDate={endDate}
          unavailable={macro?.errors?.usForwardPe}
        />
        <ErpChart
          title="China"
          peSeries={series.cnForwardPe}
          usYield={series.cn10yYield}
          chinaWeight={0}
          startDate={startDate}
          endDate={endDate}
          unavailable={macro?.errors?.cnForwardPe}
        />
        <ErpChart
          title="Hong Kong"
          peSeries={series.hkPe}
          usYield={series.us10yYield}
          cnYield={series.cn10yYield}
          chinaWeight={hkChinaWeight}
          startDate={startDate}
          endDate={endDate}
          unavailable={macro?.errors?.hkPe}
        />
      </div>
    </div>
  );
}
