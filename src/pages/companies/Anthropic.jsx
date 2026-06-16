import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels, dayLabels } from '../../utils/labels';
import { baseOpts, hBarOpts, stackedOpts, mkDs, mkBar, fmtM, fmtK, fmtP } from '../../utils/chartHelpers';
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
      mkBar('anthropic (PyPI)',     C.anthropic, pyVals),
      mkBar('@anthropic-ai/sdk (npm)', C.teal,   npVals),
    ],
  }), [wk, pyVals, npVals]);

  // Google Trends
  const td = ld?.trends;
  const trendsData = useMemo(() => {
    if (td?.api?.claude?.length > 0) {
      return {
        labels: days,
        datasets: [
          mkBar('Claude API',   C.anthropic, td.api.claude.slice(-D)),
          ...(td.brand?.claude?.length > 0 ? [mkBar('Claude brand', C.teal, td.brand.claude.slice(-D))] : []),
        ],
      };
    }
    return {
      labels: days,
      datasets: [
        mkBar('Claude API',   C.anthropic, trend(32, 68, D, 0.12)),
        mkBar('Claude brand', C.teal,      trend(18, 42, D, 0.10)),
      ],
    };
  }, [days, D, td]);

  // Daily snapshot history (server-accumulated) for point-in-time metrics
  const mh = ld?.metricsHistory;

  // Wikipedia pageviews
  const wikiArr  = ld?.wikipedia?.articles?.['Claude (language model)'] ?? [];
  const wikiData = useMemo(() => {
    const vals = wikiArr.length > 0 ? wikiArr.slice(-Math.min(W, 13)) : trend(180e3, 220e3, Math.min(W, 13), 0.10);
    return { labels: wkLabels(vals.length), datasets: [mkDs('Claude Wikipedia', C.anthropic, vals, true)] };
  }, [wikiArr, W]);

  const hnCl = ld?.hn?.perTerm?.Claude ?? 140;

  // OpenRouter rankings — Anthropic token volume, share, top models
  const orp = useMemo(() => orProviderSeries(ld?.openrouterRanks, 'Anthropic', W), [ld, W]);
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
        legend={[['anthropic (PyPI)', C.anthropic], ['@anthropic-ai/sdk (npm)', C.teal]]}
        height={240} span2
      >
        <Bar data={sdkData} options={stackedOpts(fmtM)} />
      </ChartCard>

      {orComboCard(ld?.openrouterRanks, 'Anthropic', W, C.anthropic, 'an')}

      {orShareData && (
        <ChartCard
          chartId="an-or-share"
          height={220} pinTop
        >
          <Line data={orShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
        </ChartCard>
      )}

      {orModelsData && (
        <ChartCard
          chartId="an-or-models"
          subtitle={`Week of ${orp.latestWeek}. Anthropic models ranked in OpenRouter's top 15 by token volume.`}
          height={220} pinTop
        >
          <Bar data={orModelsData} options={hBarOpts(fmtTok)} />
        </ChartCard>
      )}

      <ChartCard
        chartId="an-trends"
        legend={[['Claude API', C.anthropic], ['Claude brand', C.teal]]}
        height={220} span2
      >
        <Bar data={trendsData} options={stackedOpts(fmtP)} />
      </ChartCard>

      {metricTrendCard({
        chartId: 'an-stars',
        weeks: W,
        hist: mh?.github,
        series: [
          { metric: 'anthropics/anthropic-sdk-python.stars', label: 'Stars', color: C.anthropic },
        ],
        fmt: fmtK,
      })}

      {metricTrendCard({
        chartId: 'an-github',
        weeks: W,
        hist: mh?.github,
        series: [
          { metric: 'anthropics/anthropic-sdk-python.dependents', label: 'Dependent repos', color: C.teal },
        ],
        fmt: fmtK,
      })}

      {metricTrendCard({
        chartId: 'an-so',
        weeks: W,
        hist: mh?.stackoverflow,
        series: [
          { metric: 'claude.questions',   label: 'Questions all-time', color: C.anthropic },
          { metric: 'claude.newThisWeek', label: 'New this week',      color: C.teal },
        ],
        fmt: v => String(Math.round(v)),
      })}

      <ChartCard
        chartId="an-wiki"
        subtitle={`${hnCl.toLocaleString()} Hacker News story mentions (last 4 weeks) · ${(wikiArr.at(-1) ?? 220000).toLocaleString()} latest weekly Wikipedia views`}
        height={220} span2
      >
        <Line data={wikiData} options={baseOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
