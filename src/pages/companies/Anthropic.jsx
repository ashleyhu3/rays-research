import { useMemo } from 'react';
import { Bar, Scatter } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels } from '../../utils/labels';
import { stackedOpts, mkBar, fmtM, fmtK, GRID, TICK, BORD } from '../../utils/chartHelpers';
import { buildCompanyPriceBar, pricingBarOpts } from '../../utils/modelPricing';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import { metricTrendCard } from '../../components/chart/MetricTrendCard';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

function pypiSlice(ld, pkg, W, a, b) {
  const h = ld?.pypiHistory?.[pkg];
  if (h?.length >= W) return h.slice(-W);
  const s = ld?.pypi?.[pkg];
  return s ? trend(Math.round(s * 0.65), s, W, 0.06) : trend(a, b, W, 0.06);
}
function npmSlice(ld, pkg, W, a, b) {
  const arr = ld?.npm?.[pkg];
  return arr?.length >= W ? arr.slice(-W) : trend(a, b, W, 0.06);
}

const singleRevenueOpts = (color) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: ctx => {
          const date = new Date(ctx.raw.x).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
          return `$${ctx.raw.y.toFixed(1)}B ARR (${date})`;
        },
      },
    },
  },
  scales: {
    x: { type: 'linear', ticks: { ...TICK, maxTicksLimit: 6, callback: v => new Date(v).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) }, grid: GRID, border: BORD },
    y: { grid: GRID, ticks: { ...TICK, callback: v => `$${v}B` }, border: BORD, beginAtZero: true },
  },
});

export default function DemandAnthropic({ weeks: W }) {
  const { liveData: ld } = useData();
  const wk   = useMemo(() => wkLabels(W), [W]);

  // SDK downloads
  const pyVals = useMemo(() => pypiSlice(ld, 'anthropic',        W, 9e6,   16.2e6), [ld, W]);
  const npVals = useMemo(() => npmSlice(ld,  '@anthropic-ai/sdk', W, 1.8e6, 3.4e6), [ld, W]);
  const sdkData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkBar('anthropic (PyPI)',     C.anthropic, pyVals),
      mkBar('@anthropic-ai/sdk (npm)', C.teal,   npVals),
    ],
  }), [wk, pyVals, npVals]);

  // Daily snapshot history (server-accumulated) for point-in-time metrics
  const mh = ld?.metricsHistory;

  // Per-model input price bar (earliest → latest release)
  const priceBar = useMemo(() => buildCompanyPriceBar(ld, 'Anthropic'), [ld]);

  const antRevData = useMemo(() => {
    const pts = ld?.epochRevenue?.series?.['Anthropic'] ?? [];
    if (pts.length === 0) return null;
    return {
      datasets: [{
        label: 'Anthropic ARR',
        data: pts.map(p => ({ x: new Date(p.date + 'T00:00:00Z').getTime(), y: p.value })),
        borderColor: C.anthropic,
        backgroundColor: C.anthropic,
        pointBackgroundColor: C.anthropic,
        showLine: true,
        borderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0,
      }],
    };
  }, [ld?.epochRevenue]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <EditableGrid viewId="demand-anthropic">
      <ChartCard
        chartId="an-sdk"
        legend={[['anthropic (PyPI)', C.anthropic], ['@anthropic-ai/sdk (npm)', C.teal]]}
        height={240} span2
      >
        <Bar data={sdkData} options={stackedOpts(fmtM)} />
      </ChartCard>

      {orComboCard(ld?.openrouterRanks, 'Anthropic', W, C.anthropic, 'an')}

      {metricTrendCard({
        chartId: 'an-stars',
        weeks: W,
        hist: mh?.github,
        series: [
          { metric: 'anthropics/anthropic-sdk-python.stars', label: 'Stars', color: C.anthropic },
        ],
        fmt: fmtK,
      })}

      {metricTrendCard({
        chartId: 'an-github',
        weeks: W,
        hist: mh?.github,
        series: [
          { metric: 'anthropics/anthropic-sdk-python.dependents', label: 'Dependent repos', color: C.teal },
        ],
        fmt: fmtK,
      })}

      <ChartCard
        chartId="an-pricing"
        src={priceBar.src}
        height={260} span2
      >
        <Bar data={priceBar.data} options={pricingBarOpts} />
      </ChartCard>

      {antRevData && (
        <ChartCard
          chartId="ant-revenue"
          height={240} span2
        >
          <Scatter data={antRevData} options={singleRevenueOpts(C.anthropic)} />
        </ChartCard>
      )}

      {metricTrendCard({
        chartId: 'an-web-visits',
        weeks: W,
        hist: ld?.webTraffic?.history,
        series: [{ metric: 'anthropic.com.visits', label: 'Monthly visits', color: C.anthropic }],
        fmt: fmtM,
        height: 240,
        span2: true,
      })}
    </EditableGrid>
  );
}
