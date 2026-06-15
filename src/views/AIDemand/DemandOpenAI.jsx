import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels, dayLabels } from '../../utils/labels';
import { baseOpts, hBarOpts, stackedOpts, mkDs, mkBar, fmtM, fmtK, fmtP } from '../../utils/chartHelpers';
import { orProviderSeries, fmtTok } from '../../utils/openrouterProvider';
import { orComboCard } from '../../components/OrGrowthCards';
import { metricTrendCard } from '../../components/MetricTrendCard';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
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
  const D    = Math.min(W * 7, 84);
  const days = useMemo(() => dayLabels(D), [D]);

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

  // Google Trends
  const td = ld?.trends;
  const trendsData = useMemo(() => {
    if (td?.api?.chatgpt?.length > 0) {
      return {
        labels: days,
        datasets: [
          mkBar('ChatGPT API',   C.openai, td.api.chatgpt.slice(-D)),
          ...(td.brand?.chatgpt?.length > 0 ? [mkBar('ChatGPT brand', C.teal, td.brand.chatgpt.slice(-D))] : []),
        ],
      };
    }
    return {
      labels: days,
      datasets: [
        mkBar('ChatGPT API',   C.openai, trend(88, 100, D, 0.06)),
        mkBar('ChatGPT brand', C.teal,   trend(95, 100, D, 0.05)),
      ],
    };
  }, [days, D, td]);

  // Daily snapshot history (server-accumulated) for point-in-time metrics
  const mh = ld?.metricsHistory;

  // Wikipedia pageviews
  const wikiArr = ld?.wikipedia?.articles?.['ChatGPT'] ?? [];
  const wikiData = useMemo(() => {
    const vals   = wikiArr.length > 0 ? wikiArr.slice(-Math.min(W, 13)) : trend(720e3, 640e3, Math.min(W, 13), 0.08);
    return { labels: wkLabels(vals.length), datasets: [mkDs('ChatGPT Wikipedia', C.openai, vals, true)] };
  }, [wikiArr, W]);

  // HN
  const hnCG = ld?.hn?.perTerm?.ChatGPT ?? 262;

  // OpenRouter rankings — OpenAI token volume, share, top models
  const orp = useMemo(() => orProviderSeries(ld?.openrouterRanks, 'OpenAI', W), [ld, W]);
  const orShareData = useMemo(() => orp && ({
    labels: orp.labels,
    datasets: [mkDs('Share of platform tokens', C.openai, orp.share)],
  }), [orp]);
  const orModelsData = useMemo(() => orp?.models?.length > 0 ? {
    labels: orp.models.map(m => m.name),
    datasets: [{ data: orp.models.map(m => m.tokens), backgroundColor: fa(C.openai, 0.75), borderColor: C.openai, borderWidth: 1, borderRadius: 4 }],
  } : null, [orp]);

  return (
    <EditableGrid viewId="demand-openai">
      <ChartCard
        chartId="oa-sdk"
        title="SDK weekly downloads — openai Python & JavaScript"
        src="pypistats.org · npmjs.com"
        srcUrl="https://pypistats.org/packages/openai"
        freq="weekly"
        subtitle="openai Python SDK (PyPI) and openai JS/TS SDK (npm) weekly installs."
        legend={[['openai (PyPI)', C.openai], ['openai (npm)', C.teal]]}
        insight="The openai Python SDK is the most-downloaded AI SDK globally. npm installs track closely with Python, reflecting full-stack and serverless adoption."
        height={260} span2
      >
        <Bar data={sdkData} options={stackedOpts(fmtM)} />
      </ChartCard>

      {orComboCard(ld?.openrouterRanks, 'OpenAI', W, C.openai, 'oa')}

      {orShareData && (
        <ChartCard
          chartId="oa-or-share"
          title="OpenAI — share of OpenRouter weekly tokens (%)"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle="Percentage of total weekly OpenRouter token throughput served by OpenAI models."
          height={220}
        >
          <Line data={orShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
        </ChartCard>
      )}

      {orModelsData && (
        <ChartCard
          chartId="oa-or-models"
          title="OpenAI models in OpenRouter top 15 — latest week tokens"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle={`Week of ${orp.latestWeek}. OpenAI models ranked in OpenRouter's top 15 by token volume.`}
          height={220}
        >
          <Bar data={orModelsData} options={hBarOpts(fmtTok)} />
        </ChartCard>
      )}

      <ChartCard
        chartId="oa-trends"
        title="Google Trends — ChatGPT API & brand search interest"
        src="trends.google.com"
        srcUrl="https://trends.google.com/trends/explore?q=ChatGPT+API,ChatGPT"
        freq="daily"
        subtitle="Relative search volume 0–100. API intent (developer) vs brand (consumer)."
        legend={[['ChatGPT API', C.openai], ['ChatGPT brand', C.teal]]}
        height={220} span2
      >
        <Bar data={trendsData} options={stackedOpts(fmtP)} />
      </ChartCard>

      {metricTrendCard({
        chartId: 'oa-jobs',
        weeks: W,
        title: 'OpenAI — open roles (Greenhouse)',
        src: 'boards.greenhouse.io',
        srcUrl: 'https://boards.greenhouse.io/openai',
        subtitle: 'Hiring demand: total and engineering openings.',
        hist: mh?.jobs,
        series: [
          { metric: 'OpenAI.total',       label: 'Total roles', color: C.openai },
          { metric: 'OpenAI.engineering', label: 'Engineering', color: C.teal },
        ],
        fmt: v => String(Math.round(v)),
      })}

      {metricTrendCard({
        chartId: 'oa-github',
        weeks: W,
        title: 'openai-python — GitHub stars & dependent repos',
        src: 'github.com',
        srcUrl: 'https://github.com/openai/openai-python',
        subtitle: 'Production adoption: repos that depend on the SDK, plus stars.',
        hist: mh?.github,
        series: [
          { metric: 'openai/openai-python.dependents', label: 'Dependent repos', color: C.openai },
          { metric: 'openai/openai-python.stars',      label: 'Stars',           color: C.teal },
        ],
        fmt: fmtK,
      })}

      {metricTrendCard({
        chartId: 'oa-so',
        weeks: W,
        title: 'Stack Overflow — [openai-api] tag activity',
        src: 'stackexchange.com',
        srcUrl: 'https://stackoverflow.com/questions/tagged/openai-api',
        subtitle: 'Developer troubleshooting volume around the OpenAI API.',
        hist: mh?.stackoverflow,
        series: [
          { metric: 'openai-api.questions',   label: 'Questions all-time', color: C.openai },
          { metric: 'openai-api.newThisWeek', label: 'New this week',      color: C.teal },
        ],
        fmt: v => String(Math.round(v)),
      })}

      <ChartCard
        chartId="oa-wiki"
        title="Wikipedia — ChatGPT article weekly pageviews"
        src="wikimedia.org"
        srcUrl="https://en.wikipedia.org/wiki/ChatGPT"
        freq="weekly"
        subtitle={`${hnCG.toLocaleString()} Hacker News story mentions (last 4 weeks) · ${(wikiArr.at(-1) ?? 640000).toLocaleString()} latest weekly Wikipedia views`}
        height={220} span2
      >
        <Line data={wikiData} options={baseOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
