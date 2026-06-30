import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, fmtN } from '../../utils/chartHelpers';
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

// Static fallback data
const STATIC_HN_WEEKLY  = [310, 340, 295, 380, 360, 420, 390, 410];
const STATIC_HN_TERMS   = { 'ChatGPT': 520, 'Claude': 340, 'Gemini': 280, 'LLM': 610, 'AI agents': 490 };

export default function Community() {
  const { liveData } = useData();
  const hn   = liveData?.hn;

  const HN_WEEKS = 8;

  const hnLabels = useMemo(() => wkLabels(HN_WEEKS), []);

  // Use live data if present and non-zero, else static
  const rawHnWeekly = hn?.weekly ?? [];
  const hasLiveHN   = rawHnWeekly.some(v => v > 0);
  const hnWeekly    = hasLiveHN ? rawHnWeekly.slice(-HN_WEEKS) : STATIC_HN_WEEKLY;

  const rawPerTerm = hn?.perTerm ?? {};
  const hasTerms   = Object.values(rawPerTerm).some(v => v > 0);
  const hnPerTerm  = hasTerms ? rawPerTerm : STATIC_HN_TERMS;

  const isLiveHN = hasLiveHN;

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
      </EditableGrid>
    </>
  );
}
