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

export default function DemandGoogle({ weeks: W }) {
  const { liveData: ld } = useData();
  const wk   = useMemo(() => wkLabels(W), [W]);
  const D    = Math.min(W * 7, 84);
  const days = useMemo(() => dayLabels(D), [D]);

  // SDK downloads
  const pyVals = useMemo(() => pypiSlice(ld, 'google-generativeai',      W, 14e6,  18e6), [ld, W]);
  const npVals = useMemo(() => npmSlice(ld,  '@google/generative-ai',     W, 3.1e6, 4.2e6), [ld, W]);
  const sdkData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkBar('google-generativeai (PyPI)', C.google, pyVals),
      mkBar('@google/generative-ai (npm)', C.teal,  npVals),
    ],
  }), [wk, pyVals, npVals]);

  // Web traffic — gemini.google.com
  const webData = useMemo(() => ({
    labels: wk,
    datasets: [mkDs('gemini.google.com', C.google, trend(520e6, 640e6, W, 0.05), true)],
  }), [wk, W]);

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

  // Reddit
  const rd    = ld?.reddit;
  const gmVal = rd?.Gemini != null ? Math.round(rd.Gemini * 28) : 2600;
  const redditData = useMemo(() => ({
    labels: days,
    datasets: [mkDs('Gemini', C.google, trend(gmVal * 0.7, gmVal, D, 0.10), true)],
  }), [days, D, gmVal]);

  // Jobs
  const jd      = ld?.jobs;
  const gdTotal = jd?.['Google DM']?.total       ?? 891;
  const gdEng   = jd?.['Google DM']?.engineering ?? 420;
  const jobsData = useMemo(() => ({
    labels: ['Total roles', 'Engineering'],
    datasets: [{ data: [gdTotal, gdEng], backgroundColor: [fa(C.google, 0.7), fa(C.teal, 0.7)], borderColor: [C.google, C.teal], borderWidth: 1, borderRadius: 4 }],
  }), [gdTotal, gdEng]);

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

  return (
    <EditableGrid viewId="demand-google">
      <ChartCard
        chartId="goo-sdk"
        title="SDK weekly downloads — Google AI Python & JavaScript"
        src="pypistats.org · npmjs.com"
        srcUrl="https://pypistats.org/packages/google-generativeai"
        freq="weekly"
        subtitle="google-generativeai Python SDK (PyPI) and @google/generative-ai JS/TS SDK (npm) weekly installs."
        legend={[['google-generativeai (PyPI)', C.google], ['@google/generative-ai (npm)', C.teal]]}
        height={260} span2
      >
        <Bar data={sdkData} options={stackedOpts(fmtM)} />
      </ChartCard>

      {orComboCard(ld?.openrouterRanks, 'Google', W, C.google, 'goo')}

      {orShareData && (
        <ChartCard
          chartId="goo-or-share"
          title="Google — share of OpenRouter weekly tokens (%)"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle="Percentage of total weekly OpenRouter token throughput served by Google models."
          height={220}
        >
          <Line data={orShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
        </ChartCard>
      )}

      {orModelsData && (
        <ChartCard
          chartId="goo-or-models"
          title="Google models in OpenRouter top 15 — latest week tokens"
          src="openrouter.ai/rankings"
          srcUrl="https://openrouter.ai/rankings"
          freq="daily"
          subtitle={`Week of ${orp.latestWeek}. Google models ranked in OpenRouter's top 15 by token volume.`}
          height={220}
        >
          <Bar data={orModelsData} options={hBarOpts(fmtTok)} />
        </ChartCard>
      )}

      <ChartCard
        chartId="goo-web"
        title="gemini.google.com — monthly web visits"
        src="similarweb.com"
        srcUrl="https://www.similarweb.com/website/gemini.google.com/"
        freq="monthly"
        subtitle="Monthly unique visits to gemini.google.com. Google's consumer AI surface."
        height={220}
      >
        <Line data={webData} options={baseOpts(v => v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`)} />
      </ChartCard>

      <ChartCard
        chartId="goo-trends"
        title="Google Trends — Gemini API & brand search interest"
        src="trends.google.com"
        srcUrl="https://trends.google.com/trends/explore?q=Gemini+API,Gemini"
        freq="daily"
        subtitle="Relative search volume 0–100."
        legend={[['Gemini API', C.google], ['Gemini brand', C.teal]]}
        height={220} span2
      >
        <Bar data={trendsData} options={stackedOpts(fmtP)} />
      </ChartCard>

      <ChartCard
        chartId="goo-reddit"
        title="Reddit daily mentions — Gemini"
        src="reddit.com/search"
        srcUrl="https://www.reddit.com/search/?q=Gemini+AI&sort=new"
        freq="daily"
        subtitle={`~${gmVal.toLocaleString()} estimated daily mentions across AI-related subreddits.`}
        height={220}
      >
        <Line data={redditData} options={baseOpts(fmtK)} />
      </ChartCard>

      <ChartCard
        chartId="goo-jobs"
        title="Google DeepMind — open roles (Greenhouse)"
        src="boards.greenhouse.io"
        srcUrl="https://boards.greenhouse.io/deepmind"
        freq="live"
        subtitle={`${gdTotal} total open roles · ${gdEng} engineering`}
        height={220}
      >
        <Bar data={jobsData} options={hBarOpts(v => String(v))} />
      </ChartCard>

      <ChartCard
        chartId="goo-wiki"
        title="Wikipedia — Gemini article weekly pageviews"
        src="wikimedia.org"
        srcUrl="https://en.wikipedia.org/wiki/Gemini_(language_model)"
        freq="weekly"
        subtitle={`${hnGm.toLocaleString()} Hacker News story mentions (last 4 weeks) · ${(wikiArr.at(-1) ?? 140000).toLocaleString()} latest weekly Wikipedia views`}
        height={220} span2
      >
        <Line data={wikiData} options={baseOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
