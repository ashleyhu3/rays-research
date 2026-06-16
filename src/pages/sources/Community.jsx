import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, mkDs, fmtK, fmtN } from '../../utils/chartHelpers';
import { wkLabels } from '../../utils/labels';
import ChartCard from '../../components/chart/ChartCard';
import KpiCard from '../../components/chart/KpiCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

const TERM_COLORS = {
  'ChatGPT':   C.openai,
  'Claude':    C.anthropic,
  'Gemini':    C.google,
  'LLM':       C.mistral,
  'AI agents': C.teal,
};

const WIKI_COLORS = {
  'ChatGPT':                 C.openai,
  'Artificial intelligence': C.google,
  'Large language model':    C.mistral,
  'Claude (language model)': C.anthropic,
  'Gemini (language model)': C.teal,
};

// Static fallback data
const STATIC_HN_WEEKLY  = [310, 340, 295, 380, 360, 420, 390, 410];
const STATIC_HN_TERMS   = { 'ChatGPT': 520, 'Claude': 340, 'Gemini': 280, 'LLM': 610, 'AI agents': 490 };
const STATIC_WIKI_WEEKLY = {
  'ChatGPT':                 [82000, 78000, 91000, 85000, 95000, 88000, 102000, 97000, 90000, 110000, 105000, 98000],
  'Artificial intelligence': [145000, 138000, 152000, 141000, 158000, 150000, 162000, 155000, 148000, 168000, 160000, 155000],
  'Large language model':    [42000, 39000, 46000, 44000, 50000, 48000, 54000, 51000, 47000, 58000, 55000, 52000],
  'Claude (language model)': [18000, 16000, 21000, 19000, 24000, 22000, 27000, 25000, 22000, 30000, 28000, 26000],
  'Gemini (language model)': [22000, 20000, 26000, 24000, 28000, 26000, 31000, 29000, 26000, 34000, 32000, 29000],
};

export default function Community() {
  const { liveData } = useData();
  const hn   = liveData?.hn;
  const wiki = liveData?.wikipedia;

  const HN_WEEKS   = 8;
  const WIKI_WEEKS = 12;

  const hnLabels   = useMemo(() => wkLabels(HN_WEEKS),  []);
  const wikiLabels = useMemo(() => wkLabels(WIKI_WEEKS), []);

  // Use live data if present and non-zero, else static
  const rawHnWeekly = hn?.weekly ?? [];
  const hasLiveHN   = rawHnWeekly.some(v => v > 0);
  const hnWeekly    = hasLiveHN ? rawHnWeekly.slice(-HN_WEEKS) : STATIC_HN_WEEKLY;

  const rawPerTerm = hn?.perTerm ?? {};
  const hasTerms   = Object.values(rawPerTerm).some(v => v > 0);
  const hnPerTerm  = hasTerms ? rawPerTerm : STATIC_HN_TERMS;

  const rawWikiArts   = wiki?.articles ?? {};
  const hasLiveWiki   = Object.values(rawWikiArts).some(a => (a ?? []).some(v => v > 0));
  const wikiArts      = hasLiveWiki ? rawWikiArts : STATIC_WIKI_WEEKLY;

  const isLiveHN   = hasLiveHN;
  const isLiveWiki = hasLiveWiki;

  const hnTotalLast = hnWeekly.at(-1) ?? 0;
  const hnPrev      = hnWeekly.at(-2) ?? 0;
  const hnDelta     = hnPrev > 0 ? ((hnTotalLast - hnPrev) / hnPrev * 100) : null;

  const hnVolumeData = useMemo(() => ({
    labels: hnLabels,
    datasets: [{
      label: 'AI stories/week',
      data:  hnWeekly,
      backgroundColor: fa(C.anthropic, 0.65),
      borderColor: C.anthropic,
      borderWidth: 1, borderRadius: 4,
    }],
  }), [hn, hnLabels]);

  const hnTermsData = useMemo(() => {
    const terms  = Object.keys(TERM_COLORS);
    const counts = terms.map(t => hnPerTerm[t] ?? 0);
    return {
      labels: terms,
      datasets: [{
        label: 'Stories (last 4 weeks)',
        data: counts,
        backgroundColor: terms.map(t => fa(TERM_COLORS[t], 0.75)),
        borderColor:     terms.map(t => TERM_COLORS[t]),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [hn]);

  const wikiData = useMemo(() => {
    const articles = Object.keys(WIKI_COLORS);
    return {
      labels: wikiLabels,
      datasets: articles.map(name => {
        const weekly = wikiArts[name] ?? [];
        const slice  = weekly.length >= WIKI_WEEKS
          ? weekly.slice(-WIKI_WEEKS)
          : [...Array(WIKI_WEEKS - weekly.length).fill(0), ...weekly];
        return mkDs(name.replace(' (language model)', ''), WIKI_COLORS[name], slice);
      }),
    };
  }, [wiki, wikiLabels]);

  const topWikiEntry = Object.entries(wikiArts)
    .map(([name, weeks]) => ({ name, total: (weeks ?? []).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)[0];

  return (
    <>
      <div className="kpi-row">
        <KpiCard
          val={hnTotalLast.toLocaleString()}
          label="HN AI stories this week"
          delta={hnDelta != null ? `${hnDelta >= 0 ? '+' : ''}${hnDelta.toFixed(1)}% WoW` : 'Hacker News'}
          deltaClass={hnDelta == null ? 'nt' : hnDelta >= 0 ? 'up' : 'dn'}
          accentColor={C.anthropic}
        />
        <KpiCard
          val={topWikiEntry ? fmtK(topWikiEntry.total) : '—'}
          label={`Top wiki: ${topWikiEntry?.name?.replace(' (language model)', '') ?? '—'}`}
          delta="total views (12 weeks)"
          deltaClass="nt"
          accentColor={WIKI_COLORS[topWikiEntry?.name] ?? C.openai}
        />
        <KpiCard
          val={(hnPerTerm['AI agents'] ?? 0).toLocaleString()}
          label="HN 'AI agents' stories"
          delta="last 4 weeks"
          deltaClass="nt"
          accentColor={C.teal}
        />
      </div>

      <EditableGrid viewId="community">
        <ChartCard
          chartId="hn-volume"
          legend={[['AI stories/week', C.anthropic]]}
          insight={isLiveHN ? `Live HN data. This week: ${hnTotalLast.toLocaleString()} stories.` : 'Showing estimates — live data updates hourly via HN Algolia API.'}
          height={220}
        >
          <Bar data={hnVolumeData} options={baseOpts(fmtN)} />
        </ChartCard>

        <ChartCard
          chartId="hn-terms"
          legend={Object.entries(TERM_COLORS).map(([l, c]) => [l, c])}
          height={220}
        >
          <Bar data={hnTermsData} options={hBarOpts(fmtN)} />
        </ChartCard>

        <ChartCard
          chartId="wiki-views"
          legend={Object.entries(WIKI_COLORS).map(([l, c]) => [l.replace(' (language model)', ''), c])}
          insight={isLiveWiki ? `Live Wikipedia data. Top article: ${topWikiEntry?.name?.replace(' (language model)', '') ?? '—'}.` : 'Showing estimates — live data loads on first Refresh Data click.'}
          height={260}
          span2
        >
          <Line data={wikiData} options={baseOpts(fmtK)} />
        </ChartCard>
      </EditableGrid>
    </>
  );
}
