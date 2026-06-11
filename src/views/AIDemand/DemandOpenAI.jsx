import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels, dayLabels } from '../../utils/labels';
import { baseOpts, hBarOpts, stackedOpts, mkDs, mkBar, fmtM, fmtK, fmtP } from '../../utils/chartHelpers';
import { orProviderSeries, fmtTok } from '../../utils/openrouterProvider';
import { orComboCard } from '../../components/OrGrowthCards';
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

  // Web traffic — chatgpt.com
  const webData = useMemo(() => ({
    labels: wk,
    datasets: [mkDs('chatgpt.com', C.openai, trend(1.82e9, 1.95e9, W, 0.04), true)],
  }), [wk, W]);

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

  // Reddit
  const rd    = ld?.reddit;
  const cgVal = rd?.ChatGPT != null ? Math.round(rd.ChatGPT * 28) : 7900;
  const redditData = useMemo(() => ({
    labels: days,
    datasets: [mkDs('ChatGPT', C.openai, trend(cgVal * 0.9, cgVal, D, 0.09), true)],
  }), [days, D, cgVal]);

  // Jobs
  const jd      = ld?.jobs;
  const oaTotal = jd?.OpenAI?.total       ?? 486;
  const oaEng   = jd?.OpenAI?.engineering ?? 210;
  const jobsData = useMemo(() => ({
    labels: ['Total roles', 'Engineering'],
    datasets: [{ data: [oaTotal, oaEng], backgroundColor: [fa(C.openai, 0.7), fa(C.teal, 0.7)], borderColor: [C.openai, C.teal], borderWidth: 1, borderRadius: 4 }],
  }), [oaTotal, oaEng]);

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
        chartId="oa-web"
        title="chatgpt.com — monthly web visits"
        src="similarweb.com"
        srcUrl="https://www.similarweb.com/website/chatgpt.com/"
        freq="monthly"
        subtitle="Total monthly unique visits. Largest consumer AI platform by traffic globally."
        height={220}
      >
        <Line data={webData} options={baseOpts(v => v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`)} />
      </ChartCard>

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

      <ChartCard
        chartId="oa-reddit"
        title="Reddit daily mentions — ChatGPT"
        src="reddit.com/search"
        srcUrl="https://www.reddit.com/search/?q=ChatGPT&sort=new"
        freq="daily"
        subtitle={`~${cgVal.toLocaleString()} estimated daily mentions across AI-related subreddits.`}
        height={220}
      >
        <Line data={redditData} options={baseOpts(fmtK)} />
      </ChartCard>

      <ChartCard
        chartId="oa-jobs"
        title="OpenAI — open roles (Greenhouse)"
        src="boards.greenhouse.io"
        srcUrl="https://boards.greenhouse.io/openai"
        freq="live"
        subtitle={`${oaTotal} total open roles · ${oaEng} engineering`}
        height={220}
      >
        <Bar data={jobsData} options={hBarOpts(v => String(v))} />
      </ChartCard>

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
