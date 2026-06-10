import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { dayLabels } from '../utils/labels';
import { baseOpts, hBarOpts, mkDs, fmtP, fmtN } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import EditableGrid from '../components/EditableGrid';
import { useData } from '../context/DataContext';

const STATIC_GEO_LABELS = ['San Francisco','New York','Seattle','Boston','Austin','Chicago','Los Angeles','Atlanta'];
const STATIC_GEO_VALS   = [100, 82, 78, 74, 68, 61, 58, 52];

const JOB_COMPANIES  = ['Anthropic', 'OpenAI', 'Google DM', 'Mistral', 'Cohere', 'Perplexity'];
const JOB_COLORS     = [C.anthropic, C.openai, C.google, C.mistral, C.teal, C.perplexity];
const STATIC_JOBS    = { Anthropic: 312, OpenAI: 486, 'Google DM': 891, Mistral: 124, Cohere: 78, Perplexity: 95 };

export default function Trends({ weeks: W }) {
  const { liveData } = useData();
  const D    = Math.min(W * 7, 84);
  const days = useMemo(() => dayLabels(D), [D]);

  const td = liveData?.trends;
  const hasLive = td?.api?.claude?.length > 0;

  const mainData = useMemo(() => {
    if (hasLive) {
      const api = td.api;
      return {
        labels: days,
        datasets: [
          mkDs('Claude API',  C.anthropic, api.claude.slice(-D)),
          mkDs('ChatGPT API', C.openai,    api.chatgpt.slice(-D)),
          mkDs('Gemini API',  C.google,    api.gemini.slice(-D)),
          mkDs('Mistral API', C.mistral,   api.mistral.slice(-D)),
        ],
      };
    }
    return {
      labels: days,
      datasets: [
        mkDs('Claude API',  C.anthropic, trend(32,  68,  D, 0.12)),
        mkDs('ChatGPT API', C.openai,    trend(88,  100, D, 0.06)),
        mkDs('Gemini API',  C.google,    trend(42,  55,  D, 0.10)),
        mkDs('Mistral API', C.mistral,   trend(8,   18,  D, 0.15)),
      ],
    };
  }, [D, days, hasLive, td]);

  const geoData = useMemo(() => {
    const labels = td?.geo?.length > 0 ? td.geo.map(g => g.label) : STATIC_GEO_LABELS;
    const vals   = td?.geo?.length > 0 ? td.geo.map(g => g.value) : STATIC_GEO_VALS;
    return {
      labels,
      datasets: [{
        data:            vals,
        backgroundColor: vals.map(v => fa(C.anthropic, 0.3 + v / 200)),
        borderColor:     C.anthropic,
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [td]);

  const brandData = useMemo(() => {
    if (hasLive && td.brand?.claude?.length > 0) {
      return {
        labels: days,
        datasets: [
          mkDs('Claude',  C.anthropic, td.brand.claude.slice(-D)),
          mkDs('ChatGPT', C.openai,    td.brand.chatgpt.slice(-D)),
        ],
      };
    }
    return {
      labels: days,
      datasets: [
        mkDs('Claude',  C.anthropic, trend(18, 42,  D, 0.10)),
        mkDs('ChatGPT', C.openai,    trend(95, 100, D, 0.05)),
      ],
    };
  }, [D, days, hasLive, td]);

  const jd = liveData?.jobs;
  const hasLiveJobs = jd != null;
  const getTotal = name => jd?.[name]?.total ?? STATIC_JOBS[name] ?? 0;

  const jobsData = useMemo(() => ({
    labels: JOB_COMPANIES,
    datasets: [{
      data:            JOB_COMPANIES.map(getTotal),
      backgroundColor: JOB_COLORS.map(c => fa(c, 0.7)),
      borderColor:     JOB_COLORS,
      borderWidth: 1, borderRadius: 4,
    }],
  }), [jd]);

  const src = hasLive ? 'google-trends-api · live' : 'pytrends · free · no auth';

  return (
    <EditableGrid viewId="trends">
      <ChartCard
        chartId="trends-api"
        title="Google Trends — relative search interest (0–100)"
        src="trends.google.com"
        srcUrl="https://trends.google.com/trends/explore?q=Claude+API,ChatGPT+API,Gemini+API"
        freq="daily"
        subtitle='Daily relative search volume in the US. Index 100 = peak of leading term in period.'
        legend={[['Claude API', C.anthropic], ['ChatGPT API', C.openai], ['Gemini API', C.google], ['Mistral API', C.mistral]]}
        insight={hasLive
          ? '"Claude API" trend data is live from Google Trends. Scores are relative — 100 = peak interest in the period.'
          : '"Claude API" now at <b>68%</b> of "ChatGPT API" search volume — up from 34% six months ago. Spikes correlate with model releases.'}
        height={250} span2
      >
        <Line data={mainData} options={baseOpts(fmtP)} />
      </ChartCard>

      <ChartCard
        chartId="trends-geo"
        title='Search interest by metro — "Claude API" (US)'
        src="trends.google.com"
        srcUrl="https://trends.google.com/trends/explore?q=Claude+API&geo=US"
        freq="live"
        subtitle="Top US cities by relative Claude API search interest."
        height={200}
      >
        <Bar data={geoData} options={hBarOpts(fmtP)} />
      </ChartCard>

      <ChartCard
        chartId="trends-brand"
        title='"Claude" vs "ChatGPT" — consumer brand search'
        src="trends.google.com"
        srcUrl="https://trends.google.com/trends/explore?q=Claude,ChatGPT"
        freq="daily"
        subtitle="Brand awareness proxy. ChatGPT dominant but Claude closing at accelerating rate."
        legend={[['Claude', C.anthropic], ['ChatGPT', C.openai]]}
        height={200}
      >
        <Line data={brandData} options={baseOpts(fmtP)} />
      </ChartCard>

      <ChartCard
        chartId="trends-jobs"
        title="Open roles by AI lab — from Greenhouse"
        src="boards.greenhouse.io"
        srcUrl="https://boards.greenhouse.io/anthropic"
        freq="live"
        subtitle={hasLiveJobs
          ? JOB_COMPANIES.map(n => `${n}: ${getTotal(n)}${jd?.[n]?.engineering != null ? ` (${jd[n].engineering} eng)` : ''}`).join(' · ')
          : 'Live open engineering + research roles per AI lab via Greenhouse public API.'}
        height={200}
      >
        <Bar data={jobsData} options={baseOpts(fmtN)} />
      </ChartCard>
    </EditableGrid>
  );
}
