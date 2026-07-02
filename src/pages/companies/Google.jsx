import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels } from '../../utils/labels';
import { stackedOpts, mkBar, fmtM, fmtK } from '../../utils/chartHelpers';
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
  return s ? trend(Math.round(s * 0.65), s, W, 0.05) : trend(a, b, W, 0.05);
}
function npmSlice(ld, pkg, W, a, b) {
  const arr = ld?.npm?.[pkg];
  return arr?.length >= W ? arr.slice(-W) : trend(a, b, W, 0.05);
}

export default function DemandGoogle({ weeks: W }) {
  const { liveData: ld } = useData();
  const wk   = useMemo(() => wkLabels(W), [W]);

  // SDK downloads
  const pyVals = useMemo(() => pypiSlice(ld, 'google-genai',      W, 14e6,  18e6), [ld, W]);
  const npVals = useMemo(() => npmSlice(ld,  '@google/genai',     W, 3.1e6, 4.2e6), [ld, W]);
  const sdkData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkBar('google-genai (PyPI)', C.google, pyVals),
      mkBar('@google/genai (npm)', C.teal,  npVals),
    ],
  }), [wk, pyVals, npVals]);

  // Daily snapshot history (server-accumulated) for point-in-time metrics
  const mh = ld?.metricsHistory;

  // Per-model input price bar (earliest → latest release)
  const priceBar = useMemo(() => buildCompanyPriceBar(ld, 'Google'), [ld]);

  return (
    <EditableGrid viewId="demand-google">
      <ChartCard
        chartId="goo-sdk"
        legend={[['google-genai (PyPI)', C.google], ['@google/genai (npm)', C.teal]]}
        height={260} span2
      >
        <Bar data={sdkData} options={stackedOpts(fmtM)} />
      </ChartCard>

      {orComboCard(ld?.openrouterRanks, 'Google', W, C.google, 'goo')}

      {metricTrendCard({
        chartId: 'goo-stars',
        weeks: W,
        hist: mh?.github,
        series: [
          { metric: 'googleapis/python-genai.stars', label: 'Stars', color: C.google },
        ],
        fmt: fmtK,
      })}

      {metricTrendCard({
        chartId: 'goo-github',
        weeks: W,
        hist: mh?.github,
        series: [
          { metric: 'googleapis/python-genai.dependents', label: 'Dependent repos', color: C.teal },
        ],
        fmt: fmtK,
      })}

      <ChartCard
        chartId="goo-pricing"
        src={priceBar.src}
        height={260} span2
      >
        <Bar data={priceBar.data} options={pricingBarOpts} />
      </ChartCard>

      {metricTrendCard({
        chartId: 'goo-hf',
        weeks: W,
        hist: mh?.huggingface,
        series: [
          { metric: 'Gemma.downloads', label: 'Gemma downloads', color: C.google },
        ],
        fmt: fmtM,
      })}

      {metricTrendCard({
        chartId: 'goo-web-visits',
        weeks: W,
        hist: ld?.webTraffic?.history,
        series: [{ metric: 'gemini.google.com.visits', label: 'Monthly visits', color: C.google }],
        fmt: fmtM,
        height: 240,
        span2: true,
      })}

    </EditableGrid>
  );
}
