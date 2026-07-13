import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels } from '../../utils/labels';
import { stackedOpts, mkBar, fmtM, fmtK } from '../../utils/chartHelpers';
import { buildCompanyPriceBar, pricingBarOpts } from '../../utils/modelPricing';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import { metricTrendCard } from '../../components/chart/MetricTrendCard';
import ChartCard from '../../components/chart/ChartCard';
import ArrTrajectoryCard from '../../components/chart/ArrTrajectoryCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

function pypiSlice(ld, pkg, W, a, b) {
  const h = ld?.pypiHistory?.[pkg];
  if (h?.length >= W) return h.slice(-W);
  const s = ld?.pypi?.[pkg];
  return s ? trend(Math.round(s * 0.65), s, W, 0.05) : trend(a, b, W, 0.05);
}
function npmSlice(ld, pkg, W, a, b) {
  const arr = ld?.npm?.[pkg];
  return arr?.length >= W ? arr.slice(-W) : trend(a, b, W, 0.05);
}

export default function DemandOpenAI({ weeks: W }) {
  const { liveData: ld } = useData();
  const wk   = useMemo(() => wkLabels(W), [W]);

  // SDK downloads
  const pyVals = useMemo(() => pypiSlice(ld, 'openai', W, 38e6, 42e6), [ld, W]);
  const npVals = useMemo(() => npmSlice(ld, 'openai', W, 9.2e6, 9.8e6), [ld, W]);
  const sdkData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkBar('openai (PyPI)', C.openai, pyVals),
      mkBar('openai (npm)',  C.teal,   npVals),
    ],
  }), [wk, pyVals, npVals]);

  // Daily snapshot history (server-accumulated) for point-in-time metrics
  const mh = ld?.metricsHistory;

  // Per-model input price bar (earliest → latest release)
  const priceBar = useMemo(() => buildCompanyPriceBar(ld, 'OpenAI'), [ld]);

  const arrSeries = ld?.epochRevenue?.series?.['OpenAI'];

  return (
    <EditableGrid viewId="demand-openai">
      {arrSeries?.length > 1 && (
        <ArrTrajectoryCard
          chartId="oa-arr"
          series={arrSeries}
          color={C.openai}
          name="OpenAI"
          height={300}
          pinTop
          defaultCol="left"
        />
      )}

      <ChartCard
        chartId="oa-sdk"
        legend={[['openai (PyPI)', C.openai], ['openai (npm)', C.teal]]}
        height={260} span2
      >
        <Bar data={sdkData} options={stackedOpts(fmtM)} />
      </ChartCard>

      {orComboCard(ld?.openrouterRanks, 'OpenAI', W, C.openai, 'oa')}

      <RevPerTokenCard
        chartId="oa-revtoken"
        provider="OpenAI"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.openai}
      />

      {metricTrendCard({
        chartId: 'oa-stars',
        weeks: W,
        alwaysLine: true,
        hist: mh?.github,
        series: [
          { metric: 'openai/openai-python.stars', label: 'Stars', color: C.openai },
        ],
        fmt: fmtK,
      })}

      <ChartCard
        chartId="oa-pricing"
        src={priceBar.src}
        height={260} span2
      >
        <Bar data={priceBar.data} options={pricingBarOpts} />
      </ChartCard>

      {metricTrendCard({
        chartId: 'oa-web-visits',
        weeks: W,
        hist: ld?.webTraffic?.history,
        series: [{ metric: 'openai.com.visits', label: 'Monthly visits', color: C.openai }],
        fmt: fmtM,
        height: 240,
        span2: true,
      })}
    </EditableGrid>
  );
}
