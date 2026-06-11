import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, mkDs, fmtK, fmtN } from '../../utils/chartHelpers';
import ChartCard from '../../components/ChartCard';
import KpiCard from '../../components/KpiCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';

const CAT_COLORS = {
  'cs.AI': C.anthropic,
  'cs.LG': C.openai,
  'cs.CL': C.google,
  'cs.CV': C.mistral,
};

const CAT_LABELS = {
  'cs.AI': 'cs.AI — Artificial Intelligence',
  'cs.LG': 'cs.LG — Machine Learning',
  'cs.CL': 'cs.CL — Computation & Language',
  'cs.CV': 'cs.CV — Computer Vision',
};

// Static estimates while live data loads (~60s first fetch due to ArXiv rate limits)
const STATIC_MONTHLY = [
  { period: 'Jun 24', count: 16200 }, { period: 'Jul 24', count: 17100 },
  { period: 'Aug 24', count: 15800 }, { period: 'Sep 24', count: 18400 },
  { period: 'Oct 24', count: 19200 }, { period: 'Nov 24', count: 20100 },
  { period: 'Dec 24', count: 17600 }, { period: 'Jan 25', count: 21400 },
  { period: 'Feb 25', count: 22800 }, { period: 'Mar 25', count: 24100 },
  { period: 'Apr 25', count: 25600 }, { period: 'May 25', count: 26900 },
];
const STATIC_CATS = { 'cs.AI': 4200, 'cs.LG': 9800, 'cs.CL': 6100, 'cs.CV': 6800 };

function fmtDelta(pct) {
  if (pct == null || isNaN(pct)) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% MoM`;
}

export default function ArXiv() {
  const { liveData } = useData();
  const arxiv = liveData?.arxiv;

  const monthly      = arxiv?.monthly?.length > 0  ? arxiv.monthly      : STATIC_MONTHLY;
  const currentMonth = Object.keys(arxiv?.currentMonth ?? {}).length > 0 ? arxiv.currentMonth : STATIC_CATS;
  const isLive = arxiv != null;

  const labels  = monthly.map(m => m.period);
  const counts  = monthly.map(m => m.count);

  const latest    = counts.at(-1) ?? 0;
  const prevMonth = counts.at(-2) ?? 0;
  const momPct    = prevMonth > 0 ? ((latest - prevMonth) / prevMonth) * 100 : null;

  const trendData = useMemo(() => ({
    labels,
    datasets: [mkDs('AI/ML/NLP/CV papers', C.anthropic, counts, true)],
  }), [arxiv]);

  const catLabels = Object.keys(CAT_LABELS);
  const catCounts = catLabels.map(k => currentMonth[k] ?? 0);

  const catData = useMemo(() => ({
    labels: catLabels.map(k => CAT_LABELS[k]),
    datasets: [{
      label: 'Papers this month',
      data: catCounts,
      backgroundColor: catLabels.map(k => fa(CAT_COLORS[k], 0.75)),
      borderColor:     catLabels.map(k => CAT_COLORS[k]),
      borderWidth: 1, borderRadius: 4,
    }],
  }), [arxiv]);

  const totalYear  = counts.reduce((a, b) => a + b, 0);
  const topCatIdx  = catCounts.indexOf(Math.max(...catCounts));
  const topCatKey  = catLabels[topCatIdx] ?? '—';
  const topCatPct  = catCounts.reduce((a, b) => a + b, 0) > 0
    ? Math.round(catCounts[topCatIdx] / catCounts.reduce((a, b) => a + b, 0) * 100)
    : 0;

  const insight = isLive
    ? `Live arXiv data. Latest month: ${latest.toLocaleString()} papers${momPct != null ? ` (${momPct >= 0 ? '+' : ''}${momPct.toFixed(1)}% MoM)` : ''}.`
    : 'Showing estimates — live data loads ~60 s after server start (arXiv rate limit). Click Refresh Data to force update.';

  return (
    <>
      <div className="kpi-row">
        <KpiCard
          val={latest >= 1000 ? `${(latest / 1000).toFixed(1)}k` : String(latest)}
          label="Papers last month"
          delta={fmtDelta(momPct)}
          deltaClass={momPct == null ? 'nt' : momPct >= 0 ? 'up' : 'dn'}
          accentColor={C.anthropic}
        />
        <KpiCard
          val={`${(totalYear / 1000).toFixed(0)}k`}
          label="Total (12 months)"
          delta="cs.AI + LG + CL + CV"
          deltaClass="nt"
          accentColor={C.openai}
        />
        <KpiCard
          val={`${topCatPct}%`}
          label={`Top: ${topCatKey}`}
          delta="current month share"
          deltaClass="nt"
          accentColor={CAT_COLORS[topCatKey] ?? C.google}
        />
      </div>

      <EditableGrid viewId="arxiv">
        <ChartCard
          chartId="arxiv-monthly"
          title="arXiv monthly submissions — cs.AI + cs.LG + cs.CL + cs.CV"
          src="export.arxiv.org/api · monthly"
          srcUrl="https://arxiv.org/search/?searchtype=all&query="
          freq="daily"
          subtitle="Combined paper count across four AI-adjacent arXiv categories. Steady climb signals field growth; spikes follow major model releases."
          legend={[['AI/ML/NLP/CV', C.anthropic]]}
          insight={insight}
          height={260}
          span2
        >
          <Line data={trendData} options={baseOpts(fmtK)} />
        </ChartCard>

        <ChartCard
          chartId="arxiv-categories"
          title="Current month — papers by category"
          src="export.arxiv.org/api"
          srcUrl="https://arxiv.org/list/cs.AI/recent"
          freq="daily"
          subtitle="cs.LG (Machine Learning) typically leads; cs.CL surges during LLM research waves."
          legend={catLabels.map(k => [k, CAT_COLORS[k]])}
          height={220}
        >
          <Bar data={catData} options={hBarOpts(fmtN)} />
        </ChartCard>
      </EditableGrid>
    </>
  );
}
