import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels, dayLabels } from '../../utils/labels';
import { baseOpts, hBarOpts, stackedOpts, mkDs, mkBar, fmtM, fmtK, fmtP } from '../../utils/chartHelpers';
import { companyPriceSeries, priceHistory } from '../../utils/modelPricing';
import { orProviderSeries, fmtTok } from '../../utils/openrouterProvider';
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
  const D    = Math.min(W * 7, 84);
  const days = useMemo(() => dayLabels(D), [D]);

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

  // Google Trends
  const td = ld?.trends;
  const trendsData = useMemo(() => {
    if (td?.api?.gemini?.length > 0) {
      return {
        labels: days,
        datasets: [mkBar('Gemini API', C.google, td.api.gemini.slice(-D))],
      };
    }
    return {
      labels: days,
      datasets: [
        mkBar('Gemini API',   C.google, trend(42, 55, D, 0.10)),
        mkBar('Gemini brand', C.teal,   trend(38, 50, D, 0.10)),
      ],
    };
  }, [days, D, td]);

  // Daily snapshot history (server-accumulated) for point-in-time metrics
  const mh = ld?.metricsHistory;

  // Wikipedia pageviews
  const wikiArr  = ld?.wikipedia?.articles?.['Gemini (language model)'] ?? [];
  const wikiData = useMemo(() => {
    const vals = wikiArr.length > 0 ? wikiArr.slice(-Math.min(W, 13)) : trend(90e3, 140e3, Math.min(W, 13), 0.10);
    return { labels: wkLabels(vals.length), datasets: [mkDs('Gemini Wikipedia', C.google, vals, true)] };
  }, [wikiArr, W]);

  const hnGm = ld?.hn?.perTerm?.Gemini ?? 95;

  // OpenRouter rankings — Google token volume, share, top models
  const orp = useMemo(() => orProviderSeries(ld?.openrouterRanks, 'Google', W), [ld, W]);
  const orShareData = useMemo(() => orp && ({
    labels: orp.labels,
    datasets: [mkDs('Share of platform tokens', C.google, orp.share)],
  }), [orp]);
  const orModelsData = useMemo(() => orp?.models?.length > 0 ? {
    labels: orp.models.map(m => m.name),
    datasets: [{ data: orp.models.map(m => m.tokens), backgroundColor: fa(C.google, 0.75), borderColor: C.google, borderWidth: 1, borderRadius: 4 }],
  } : null, [orp]);

  // Daily input-price history for Google's own models (live snapshot + history)
  const priceHist = useMemo(() => priceHistory(ld), [ld]);

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

      {orShareData && (
        <ChartCard
          chartId="goo-or-share"
          height={220} pinTop
        >
          <Line data={orShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
        </ChartCard>
      )}

      {orModelsData && (
        <ChartCard
          chartId="goo-or-models"
          subtitle={`Week of ${orp.latestWeek}. Google models ranked in OpenRouter's top 15 by token volume.`}
          height={220} pinTop
        >
          <Bar data={orModelsData} options={hBarOpts(fmtTok)} />
        </ChartCard>
      )}

      <ChartCard
        chartId="goo-trends"
        legend={[['Gemini API', C.google], ['Gemini brand', C.teal]]}
        height={220} span2
      >
        <Bar data={trendsData} options={stackedOpts(fmtP)} />
      </ChartCard>

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

      {metricTrendCard({
        chartId: 'goo-pricing',
        weeks: W,
        src: 'openrouter.ai/api/v1/models',
        freq: 'daily',
        hist: priceHist,
        series: companyPriceSeries('Google'),
        fmt: v => `$${v.toFixed(2)}`,
        height: 260, span2: true,
      })}

      {metricTrendCard({
        chartId: 'goo-hf',
        weeks: W,
        hist: mh?.huggingface,
        series: [
          { metric: 'Gemma.downloads', label: 'Gemma downloads', color: C.google },
        ],
        fmt: fmtM,
      })}

      <ChartCard
        chartId="goo-wiki"
        subtitle={`${hnGm.toLocaleString()} Hacker News story mentions (last 4 weeks) · ${(wikiArr.at(-1) ?? 140000).toLocaleString()} latest weekly Wikipedia views`}
        height={220} span2
      >
        <Line data={wikiData} options={baseOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
