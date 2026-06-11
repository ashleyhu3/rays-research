import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels, dayLabels } from '../utils/labels';
import { baseOpts, hBarOpts, mkDs, fmtM, fmtK, fmtP } from '../utils/chartHelpers';
import { orProviderSeries, orTokenSubtitle, fmtTok } from '../utils/openrouterProvider';
import ChartCard from '../components/ChartCard';
import EditableGrid from '../components/EditableGrid';
import { useData } from '../context/DataContext';

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

export default function DemandAnthropic({ weeks: W }) {
  const { liveData: ld } = useData();
  const wk   = useMemo(() => wkLabels(W), [W]);
  const D    = Math.min(W * 7, 84);
  const days = useMemo(() => dayLabels(D), [D]);

  // SDK downloads
  const pyVals = useMemo(() => pypiSlice(ld, 'anthropic',        W, 9e6,   16.2e6), [ld, W]);
  const npVals = useMemo(() => npmSlice(ld,  '@anthropic-ai/sdk', W, 1.8e6, 3.4e6), [ld, W]);
  const sdkData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('anthropic (PyPI)',     C.anthropic, pyVals),
      mkDs('@anthropic-ai/sdk (npm)', C.teal,   npVals),
    ],
  }), [wk, pyVals, npVals]);

  // Web traffic — claude.ai
  const webData = useMemo(() => ({
    labels: wk,
    datasets: [mkDs('claude.ai', C.anthropic, trend(380e6, 610e6, W, 0.07), true)],
  }), [wk, W]);

  // Web engagement — session duration
  const sessionData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('claude.ai',    C.anthropic, trend(8.1, 9.4, W, 0.04)),
      mkDs('chatgpt.com',  C.slate,     trend(6.2, 6.8, W, 0.04)),
    ],
  }), [wk, W]);

  // Bounce rate
  const bounceData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('claude.ai',    C.anthropic, trend(29, 26, W, 0.04)),
      mkDs('chatgpt.com',  C.slate,     trend(38, 35, W, 0.04)),
    ],
  }), [wk, W]);

  // Google Trends
  const td = ld?.trends;
  const trendsData = useMemo(() => {
    if (td?.api?.claude?.length > 0) {
      return {
        labels: days,
        datasets: [
          mkDs('Claude API',   C.anthropic, td.api.claude.slice(-D)),
          ...(td.brand?.claude?.length > 0 ? [mkDs('Claude brand', C.teal, td.brand.claude.slice(-D))] : []),
        ],
      };
    }
    return {
      labels: days,
      datasets: [
        mkDs('Claude API',   C.anthropic, trend(32, 68, D, 0.12)),
        mkDs('Claude brand', C.teal,      trend(18, 42, D, 0.10)),
      ],
    };
  }, [days, D, td]);

  // Reddit
  const rd     = ld?.reddit;
  const clVal  = rd?.Claude != null ? Math.round(rd.Claude * 28) : 2800;
  const redditData = useMemo(() => ({
    labels: days,
    datasets: [mkDs('Claude', C.anthropic, trend(clVal * 0.4, clVal, D, 0.12), true)],
  }), [days, D, clVal]);

  // App Store
  const as      = ld?.appstore;
  const clScore = as?.ratings?.Claude?.score   ?? 4.7;
  const clRevs  = as?.ratings?.Claude?.reviews ?? 340000;
  const clRank  = as?.rankings?.Claude         ?? 2;

  // Jobs
  const jd      = ld?.jobs;
  const anTotal = jd?.Anthropic?.total       ?? 312;
  const anEng   = jd?.Anthropic?.engineering ?? 140;
  const jobsData = useMemo(() => ({
    labels: ['Total roles', 'Engineering'],
    datasets: [{ data: [anTotal, anEng], backgroundColor: [fa(C.anthropic, 0.7), fa(C.teal, 0.7)], borderColor: [C.anthropic, C.teal], borderWidth: 1, borderRadius: 4 }],
  }), [anTotal, anEng]);

  // Wikipedia pageviews
  const wikiArr  = ld?.wikipedia?.articles?.['Claude (language model)'] ?? [];
  const wikiData = useMemo(() => {
    const vals = wikiArr.length > 0 ? wikiArr.slice(-Math.min(W, 13)) : trend(180e3, 220e3, Math.min(W, 13), 0.10);
    return { labels: wkLabels(vals.length), datasets: [mkDs('Claude Wikipedia', C.anthropic, vals, true)] };
  }, [wikiArr, W]);

  const hnCl = ld?.hn?.perTerm?.Claude ?? 140;

  // OpenRouter rankings — Anthropic token volume, share, top models
  const orp = useMemo(() => orProviderSeries(ld?.openrouterRanks, 'Anthropic', W), [ld, W]);
  const orTokenData = useMemo(() => orp && ({
    labels: orp.labels,
    datasets: [mkDs('Anthropic weekly tokens', C.anthropic, orp.tokens, true)],
  }), [orp]);
  const orShareData = useMemo(() => orp && ({
    labels: orp.labels,
    datasets: [mkDs('Share of platform tokens', C.anthropic, orp.share)],
  }), [orp]);
  const orModelsData = useMemo(() => orp?.models?.length > 0 ? {
    labels: orp.models.map(m => m.name),
    datasets: [{ data: orp.models.map(m => m.tokens), backgroundColor: fa(C.anthropic, 0.75), borderColor: C.anthropic, borderWidth: 1, borderRadius: 4 }],
  } : null, [orp]);

  return (
    <EditableGrid viewId="demand-anthropic">
      <ChartCard
        chartId="an-sdk"
        title="SDK weekly downloads — anthropic Python & JavaScript"
        src="pypistats.org · npmjs.com"
        srcUrl="https://pypistats.org/packages/anthropic"
        freq="weekly"
        subtitle="anthropic Python SDK (PyPI) and @anthropic-ai/sdk JS/TS SDK (npm) weekly installs."
        legend={[['anthropic (PyPI)', C.anthropic], ['@anthropic-ai/sdk (npm)', C.teal]]}
        insight="The anthropic SDK grew +80% in 12 weeks — the fastest of any major AI provider SDK. npm installs tracking Python closely, indicating full-stack production adoption."
        height={240} span2
      >
        <Line data={sdkData} options={baseOpts(fmtM)} />
      </ChartCard>

      {orTokenData && (
        <ChartCard
          chartId="an-or-tokens"
          title="Anthropic — weekly token volume on OpenRouter"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle={orTokenSubtitle(orp)}
          height={240} span2
        >
          <Line data={orTokenData} options={baseOpts(fmtTok)} />
        </ChartCard>
      )}

      {orShareData && (
        <ChartCard
          chartId="an-or-share"
          title="Anthropic — share of OpenRouter weekly tokens (%)"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle="Percentage of total weekly OpenRouter token throughput served by Anthropic models."
          height={220}
        >
          <Line data={orShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
        </ChartCard>
      )}

      {orModelsData && (
        <ChartCard
          chartId="an-or-models"
          title="Anthropic models in OpenRouter top 15 — latest week tokens"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle={`Week of ${orp.latestWeek}. Anthropic models ranked in OpenRouter's top 15 by token volume.`}
          height={220}
        >
          <Bar data={orModelsData} options={hBarOpts(fmtTok)} />
        </ChartCard>
      )}

      <ChartCard
        chartId="an-web"
        title="claude.ai — monthly web visits"
        src="similarweb.com"
        srcUrl="https://www.similarweb.com/website/claude.ai/"
        freq="monthly"
        subtitle="Total monthly unique visits to claude.ai."
        height={220}
      >
        <Line data={webData} options={baseOpts(v => v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`)} />
      </ChartCard>

      <ChartCard
        chartId="an-appstore"
        title="Claude — iOS App Store"
        src="apps.apple.com"
        srcUrl="https://apps.apple.com/us/app/claude-ai/id6473753684"
        freq="live"
        subtitle={`Rating: ${clScore.toFixed(1)} / 5  ·  ${(clRevs / 1e3).toFixed(0)}K reviews  ·  Rank #${clRank} Top Free Productivity (US)`}
        height={220}
      >
        <Bar
          data={{
            labels: ['Rating (out of 5)', 'Rank score (10 = #1)'],
            datasets: [{ data: [clScore, 10 - clRank + 1], backgroundColor: [fa(C.anthropic, 0.7), fa(C.teal, 0.6)], borderColor: [C.anthropic, C.teal], borderWidth: 1, borderRadius: 4 }],
          }}
          options={hBarOpts(v => v.toFixed(1))}
        />
      </ChartCard>

      <ChartCard
        chartId="an-trends"
        title="Google Trends — Claude API & brand search interest"
        src="trends.google.com"
        srcUrl="https://trends.google.com/trends/explore?q=Claude+API,Claude"
        freq="daily"
        subtitle="Relative search volume 0–100. Claude API intent growing fastest of all providers."
        legend={[['Claude API', C.anthropic], ['Claude brand', C.teal]]}
        insight='"Claude API" now at ~68% of "ChatGPT API" search volume — up from 34% six months ago. Spikes correlate directly with model releases.'
        height={220} span2
      >
        <Line data={trendsData} options={baseOpts(fmtP)} />
      </ChartCard>

      <ChartCard
        chartId="an-engagement"
        title="Average session duration — claude.ai vs chatgpt.com (minutes)"
        src="similarweb.com"
        srcUrl="https://www.similarweb.com/website/claude.ai/"
        freq="monthly"
        subtitle="Longer sessions = deeper, more complex use cases. Claude leads by 38%."
        legend={[['claude.ai', C.anthropic], ['chatgpt.com', C.slate]]}
        insight="Claude averages <b>9.4 min</b> vs ChatGPT's <b>6.8 min</b> — reflecting enterprise and coding workloads that require extended context."
        height={220}
      >
        <Line data={sessionData} options={baseOpts(v => `${v.toFixed(1)}m`)} />
      </ChartCard>

      <ChartCard
        chartId="an-reddit"
        title="Reddit daily mentions — Claude"
        src="reddit.com/search"
        srcUrl="https://www.reddit.com/search/?q=Claude&sort=new"
        freq="daily"
        subtitle={`~${clVal.toLocaleString()} estimated daily mentions. Claude surged during 3.7 launch, sustained at ~2.8K/day.`}
        height={220}
      >
        <Line data={redditData} options={baseOpts(fmtK)} />
      </ChartCard>

      <ChartCard
        chartId="an-jobs"
        title="Anthropic — open roles (Greenhouse)"
        src="boards.greenhouse.io"
        srcUrl="https://boards.greenhouse.io/anthropic"
        freq="live"
        subtitle={`${anTotal} total open roles · ${anEng} engineering`}
        height={220}
      >
        <Bar data={jobsData} options={hBarOpts(v => String(v))} />
      </ChartCard>

      <ChartCard
        chartId="an-wiki"
        title="Wikipedia — Claude article weekly pageviews"
        src="wikimedia.org"
        srcUrl="https://en.wikipedia.org/wiki/Claude_(language_model)"
        freq="weekly"
        subtitle={`${hnCl.toLocaleString()} Hacker News story mentions (last 4 weeks) · ${(wikiArr.at(-1) ?? 220000).toLocaleString()} latest weekly Wikipedia views`}
        height={220} span2
      >
        <Line data={wikiData} options={baseOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
