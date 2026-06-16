import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { hBarOpts, fmtM, fmtN } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

const FAMILY_COLORS = { Llama: C.meta, Qwen: C.deepseek, Gemma: C.google, DeepSeek: C.deepseek, Mistral: C.mistral };

function modelColor(id) {
  const l = id.toLowerCase();
  if (l.includes('llama') || l.includes('meta-llama')) return C.meta;
  if (l.includes('qwen'))     return C.deepseek;
  if (l.includes('deepseek')) return C.deepseek;
  if (l.includes('mistral'))  return C.mistral;
  if (l.includes('gemma') || l.includes('google')) return C.google;
  if (l.includes('phi') || l.includes('microsoft')) return C.openai;
  if (l.includes('claude') || l.includes('anthropic')) return C.anthropic;
  return C.slate;
}

function shortName(id) {
  const parts = id.split('/');
  return parts[parts.length - 1];
}

export default function HuggingFace() {
  const { liveData } = useData();

  // Browser-direct top models (downloads) + server-side extras (likes, rate, families)
  const hfList   = liveData?.hf ?? [];
  const hfServer = liveData?.hfServer;

  const top10 = useMemo(() => hfList.slice(0, 10), [hfList]);

  const downloadsData = useMemo(() => top10.length === 0 ? null : {
    labels: top10.map(m => shortName(m.id)),
    datasets: [{
      label: 'All-time downloads',
      data: top10.map(m => m.downloads),
      backgroundColor: top10.map(m => fa(modelColor(m.id), 0.75)),
      borderColor: top10.map(m => modelColor(m.id)),
      borderWidth: 1, borderRadius: 4,
    }],
  }, [top10]);

  // Pipeline-tag breakdown computed from the real top-30 list
  const catData = useMemo(() => {
    if (hfList.length === 0) return null;
    const byTag = {};
    for (const m of hfList) byTag[m.pipeline_tag] = (byTag[m.pipeline_tag] ?? 0) + 1;
    const entries = Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 7);
    const palette = [C.openai, C.anthropic, C.google, C.mistral, C.meta, C.perplexity, C.teal];
    return {
      labels: entries.map(([tag]) => tag),
      datasets: [{
        data:            entries.map(([, n]) => n),
        backgroundColor: entries.map((_, i) => fa(palette[i % palette.length], 0.75)),
        borderColor:     '#111419',
        borderWidth:     3,
      }],
    };
  }, [hfList]);

  const familyEntries = useMemo(() =>
    Object.entries(hfServer?.families ?? {})
      .filter(([, v]) => v)
      .sort((a, b) => b[1].downloads - a[1].downloads),
  [hfServer]);

  const familyData = useMemo(() => familyEntries.length === 0 ? null : {
    labels: familyEntries.map(([k]) => k),
    datasets: [{
      label: 'Downloads (top 100 models per family)',
      data: familyEntries.map(([, v]) => v.downloads),
      backgroundColor: familyEntries.map(([k]) => fa(FAMILY_COLORS[k] ?? C.slate, 0.75)),
      borderColor: familyEntries.map(([k]) => FAMILY_COLORS[k] ?? C.slate),
      borderWidth: 1, borderRadius: 4,
    }],
  }, [familyEntries]);

  const rate = hfServer?.newModels;

  return (
    <EditableGrid viewId="hf">
      {downloadsData && (
        <ChartCard
          chartId="hf-downloads"
          height={260} span2
        >
          <Bar data={downloadsData} options={hBarOpts(fmtM)} />
        </ChartCard>
      )}

      {familyData && (
        <ChartCard
          chartId="hf-families"
          subtitle={`Cumulative downloads of each family's top 100 models. Top model: ${familyEntries[0]?.[1]?.top ?? '—'}.`}
          height={240}
        >
          <Bar data={familyData} options={hBarOpts(fmtM)} />
        </ChartCard>
      )}

      {catData && (
        <ChartCard
          chartId="hf-categories"
          height={240}
        >
          <Bar data={catData} options={hBarOpts(fmtN)} />
        </ChartCard>
      )}

      {rate?.perDay && (
        <ChartCard
          chartId="hf-uploads"
          subtitle={`Measured from the timestamps of the ${rate.sampled} newest models (${rate.spanHours}h span).`}
          height={240}
        >
          <Bar
            data={{
              labels: ['New models / day', 'New models / week (est.)'],
              datasets: [{
                label: 'Models',
                data: [rate.perDay, rate.perWeekEst],
                backgroundColor: [fa(C.anthropic, 0.75), fa(C.teal, 0.75)],
                borderColor: [C.anthropic, C.teal],
                borderWidth: 1, borderRadius: 4,
              }],
            }}
            options={hBarOpts(fmtN)}
          />
        </ChartCard>
      )}
    </EditableGrid>
  );
}
