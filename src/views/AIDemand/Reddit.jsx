import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { hBarOpts, fmtN, fmtM } from '../../utils/chartHelpers';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';

const TERM_COLORS = { ChatGPT: C.openai, Claude: C.anthropic, Gemini: C.google, Mistral: C.mistral };
const SUB_COLORS  = {
  ChatGPT: C.openai, ClaudeAI: C.anthropic, LocalLLaMA: C.meta ?? C.mistral,
  singularity: C.teal, OpenAI: C.openai,
};

export default function Reddit() {
  const { liveData } = useData();

  const rd = liveData?.reddit; // { ChatGPT: n, Claude: n, ... } — weekly search-result counts
  const rc = liveData?.redditCommunities; // { subs: { ChatGPT: { subscribers, activeUsers }, ... } }

  const mentionsData = useMemo(() => {
    const entries = Object.entries(rd ?? {}).filter(([, v]) => v != null);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return {
      labels: entries.map(([k]) => k),
      datasets: [{
        label: 'Search results (past week)',
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([k]) => fa(TERM_COLORS[k] ?? C.slate, 0.75)),
        borderColor: entries.map(([k]) => TERM_COLORS[k] ?? C.slate),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [rd]);

  const subEntries = useMemo(() =>
    Object.entries(rc?.subs ?? {})
      .filter(([, v]) => v?.subscribers != null)
      .sort((a, b) => b[1].subscribers - a[1].subscribers),
  [rc]);

  const subscribersData = useMemo(() => subEntries.length === 0 ? null : {
    labels: subEntries.map(([k]) => `r/${k}`),
    datasets: [{
      label: 'Subscribers',
      data: subEntries.map(([, v]) => v.subscribers),
      backgroundColor: subEntries.map(([k]) => fa(SUB_COLORS[k] ?? C.slate, 0.75)),
      borderColor: subEntries.map(([k]) => SUB_COLORS[k] ?? C.slate),
      borderWidth: 1, borderRadius: 4,
    }],
  }, [subEntries]);

  const activeEntries = subEntries.filter(([, v]) => v.activeUsers != null);
  const activeData = useMemo(() => activeEntries.length === 0 ? null : {
    labels: activeEntries.map(([k]) => `r/${k}`),
    datasets: [{
      label: 'Active users right now',
      data: activeEntries.map(([, v]) => v.activeUsers),
      backgroundColor: activeEntries.map(([k]) => fa(SUB_COLORS[k] ?? C.slate, 0.75)),
      borderColor: activeEntries.map(([k]) => SUB_COLORS[k] ?? C.slate),
      borderWidth: 1, borderRadius: 4,
    }],
  }, [activeEntries]);

  const empty = !mentionsData && !subscribersData;

  return (
    <EditableGrid viewId="reddit">
      {mentionsData && (
        <ChartCard
          chartId="reddit-mentions"
          title="Reddit search results this week — by platform"
          src="reddit.com/search"
          srcUrl="https://www.reddit.com/search/?q=Claude&sort=new"
          freq="6-hourly"
          subtitle="Posts matching each platform in Reddit search over the past 7 days (public API; counts capped by Reddit at a few thousand)."
          height={240} span2
        >
          <Bar data={mentionsData} options={hBarOpts(fmtN)} />
        </ChartCard>
      )}

      {subscribersData && (
        <ChartCard
          chartId="reddit-subscribers"
          title="AI subreddit size — total subscribers"
          src="reddit.com about.json"
          srcUrl="https://www.reddit.com/r/ChatGPT/"
          freq="6-hourly"
          subtitle={`Community growth signal. As of ${rc?.asOf ?? 'latest scrape'}.`}
          height={240}
        >
          <Bar data={subscribersData} options={hBarOpts(fmtM)} />
        </ChartCard>
      )}

      {activeData && (
        <ChartCard
          chartId="reddit-active"
          title="AI subreddit activity — users active right now"
          src="reddit.com about.json"
          srcUrl="https://www.reddit.com/r/ChatGPT/"
          freq="6-hourly"
          subtitle="Concurrent active users per subreddit at scrape time."
          height={240}
        >
          <Bar data={activeData} options={hBarOpts(fmtN)} />
        </ChartCard>
      )}

      {empty && (
        <div style={{ padding: 24, color: 'var(--ter)' }}>
          No live Reddit data yet — click "Refresh Data" in the navbar. (The fabricated
          sentiment and Twitter charts that used to fill this page were removed.)
        </div>
      )}
    </EditableGrid>
  );
}
