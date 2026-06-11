import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend, series } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, hBarOpts, mkDs } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import EditableGrid from '../components/EditableGrid';
import { useData } from '../context/DataContext';

function findPrice(gpu, key1, key2) {
  if (!gpu) return null;
  return gpu[key1] ?? gpu[key2] ?? null;
}

// Distinct line colour per DRAM model (assigned by position within each chart)
const DRAM_PALETTE = [C.teal, C.openai, C.anthropic, C.google, C.minimax, C.kimi, C.deepseek, C.perplexity, C.red, C.slate];

const DRAM_METHOD = 'Per model: session average × (1 + session change), averaged across all listed variants (speed grades, eTT, organization). One point per scraped day.';

function dramDayLabel(isoDate) {
  return new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function dramLineData(models, history) {
  return {
    labels: history.dates.map(dramDayLabel),
    datasets: models.map((m, i) => ({
      ...mkDs(m.model, DRAM_PALETTE[i % DRAM_PALETTE.length], history.series[m.model] ?? []),
      spanGaps: true,   // connect across dates where a model wasn't listed
      pointRadius: 2,
    })),
  };
}

const dramLegend = models => models.map((m, i) => [m.model, DRAM_PALETTE[i % DRAM_PALETTE.length]]);

export default function Pricing({ weeks: W = 52 }) {
  const { liveData } = useData();
  const wk = useMemo(() => wkLabels(W), [W]);

  /* ── GPU spot pricing (moved from the GPU view) ──────────────────── */
  const gpu = liveData?.gpu;
  const gpuPrices = gpu?.prices ?? gpu; // tolerate the old flat shape from stale caches
  const hasLive = gpuPrices != null && Object.keys(gpuPrices).length > 0;

  const h100Current = findPrice(gpuPrices, 'H100_SXM', 'H100_SXM4') ?? 2.18;
  const h200Current = findPrice(gpuPrices, 'H200', 'H200_SXM5') ?? 4.62;
  const b200Current = gpuPrices?.B200 ?? 6.20;

  const { priceData, availData, spreadData } = useMemo(() => {
    const h100 = trend(h100Current * 1.14, h100Current, W, 0.06);
    const h200 = trend(h200Current * 0.82, h200Current, W, 0.08);
    const b200 = series(b200Current, 0.15, W).map((v, i) =>
      i === Math.floor(W * 0.55) ? v * 3.4 : v
    );

    return {
      priceData: {
        labels: wk,
        datasets: [
          mkDs('H100 SXM5', C.openai,    h100),
          mkDs('H200 SXM5', C.anthropic, h200),
          mkDs('B200 SXM',  C.google,    b200),
        ],
      },
      availData: {
        labels: wk,
        datasets: [
          mkDs('H100 regions', C.openai,    trend(8, 5, W, 0.20).map(v => Math.max(0, Math.round(v)))),
          mkDs('H200 regions', C.anthropic, trend(3, 2, W, 0.30).map(v => Math.max(0, Math.round(v)))),
          mkDs('B200 regions', C.google,    trend(1, 0, W, 0.50).map(v => Math.max(0, Math.round(v)))),
        ],
      },
      spreadData: {
        labels: wk,
        datasets: [
          mkDs('H200–H100 premium', C.anthropic,
            h200.map((v, i) => parseFloat((v - h100[i]).toFixed(2))),
            true
          ),
        ],
      },
    };
  }, [W, wk, h100Current, h200Current]);

  const src = hasLive ? 'vast.ai API · live spot prices' : 'lambda labs API · runpod API · vast.ai';
  const liveNote = hasLive
    ? `Live spot: H100 $${h100Current}/hr · H200 $${h200Current}/hr (vast.ai median).`
    : 'B200 price spikes signal labs hoarding compute before training runs — forward-looking demand proxy.';

  /* ── Memory (DRAM) spot pricing — TrendForce ─────────────────────── */
  const dram    = liveData?.dram;
  const models  = dram?.models ?? [];
  const history = dram?.history;

  const chips   = useMemo(() => models.filter(m => m.category !== 'module').sort((a, b) => b.price - a.price), [models]);
  const modules = useMemo(() => models.filter(m => m.category === 'module').sort((a, b) => b.price - a.price), [models]);

  // Window the history to the selected time range (W weeks back from today)
  const windowedHistory = useMemo(() => {
    if (!history?.dates?.length) return null;
    const cutoff = Date.now() - W * 7 * 86400000;
    const start  = history.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    if (start <= 0) return history; // everything is inside the window
    return {
      dates:  history.dates.slice(start),
      series: Object.fromEntries(Object.entries(history.series).map(([m, arr]) => [m, arr.slice(start)])),
    };
  }, [history, W]);

  const chipData   = useMemo(() => chips.length   > 0 && windowedHistory ? dramLineData(chips, windowedHistory)   : null, [chips, windowedHistory]);
  const moduleData = useMemo(() => modules.length > 0 && windowedHistory ? dramLineData(modules, windowedHistory) : null, [modules, windowedHistory]);

  // TrendForce "Mainstream DRAM Spot Price" monthly index, windowed to W weeks
  const dramIndex = dram?.index;
  const dramIndexData = useMemo(() => {
    if (!dramIndex?.dates?.length) return null;
    const cutoff = Date.now() - W * 7 * 86400000;
    let start = dramIndex.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    if (start < 0) start = 0;
    const dates  = dramIndex.dates.slice(start);
    const values = dramIndex.values.slice(start);
    return {
      labels: dates.map(d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })),
      datasets: [mkDs(dramIndex.name, C.teal, values, true)],
    };
  }, [dramIndex, W]);

  // Mainstream GPU spot index — average $/hr across tracked GPUs, accumulated daily
  const gpuHist = gpu?.history;
  const gpuIndexData = useMemo(() => {
    if (!gpuHist?.dates?.length) return null;
    const cutoff = Date.now() - W * 7 * 86400000;
    let start = gpuHist.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    if (start < 0) start = 0;
    return {
      labels: gpuHist.dates.slice(start).map(dramDayLabel),
      datasets: [mkDs('Mainstream GPU spot price', C.openai, gpuHist.index.slice(start), true)],
    };
  }, [gpuHist, W]);

  const changeData = useMemo(() => {
    if (models.length === 0) return null;
    const sorted = [...models].sort((a, b) => b.changePct - a.changePct);
    return {
      labels: sorted.map(m => m.model),
      datasets: [{
        data:            sorted.map(m => m.changePct),
        backgroundColor: sorted.map(m => fa(m.changePct >= 0 ? C.openai : C.red, 0.70)),
        borderColor:     sorted.map(m => (m.changePct >= 0 ? C.openai : C.red)),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [models]);

  const dramAsOf = dram?.asOf ? ` · as of ${dram.asOf}` : '';

  return (
    <EditableGrid viewId="pricing">
      <ChartCard
        chartId="gpu-prices"
        title="GPU spot price $/hr — Lambda Labs / RunPod"
        src="lambdalabs.com"
        srcUrl="https://lambdalabs.com/service/gpu-cloud"
        freq="weekly"
        subtitle={liveNote}
        legend={[['H100 SXM5 (80GB)', C.openai], ['H200 SXM5 (141GB)', C.anthropic], ['B200 SXM (192GB)', C.google]]}
        insight="B200 spot pricing spiked <b>+340%</b> in late March 2026 — correlated with large-scale model pre-training reports. Now <b>2.1× its Jan 2026 baseline</b>."
        height={250} span2
      >
        <Line data={priceData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      <ChartCard
        chartId="gpu-avail"
        title="GPU availability — regions with capacity"
        src="lambdalabs.com"
        srcUrl="https://lambdalabs.com/service/gpu-cloud"
        freq="weekly"
        subtitle="Zero = fully sold out. Tracks supply constraints."
        height={200}
      >
        <Bar data={availData} options={baseOpts(v => Math.round(v))} />
      </ChartCard>

      <ChartCard
        chartId="gpu-spread"
        title="H200 – H100 price spread"
        src="runpod.io/pricing"
        srcUrl="https://www.runpod.io/gpu-instance/pricing"
        freq="weekly"
        subtitle="Widening spread = demand shifting to next-gen memory bandwidth."
        height={200}
      >
        <Line data={spreadData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      {gpuIndexData && (
        <ChartCard
          chartId="gpu-index"
          title="Mainstream GPU spot price — average $/hr across tracked GPUs"
          src="vast.ai API · lambdalabs.com archive"
          srcUrl="https://vast.ai/pricing"
          freq="daily"
          subtitle="Average $/hr across tracked datacenter GPUs (H100 / H200 / B200 / A100 / RTX 4090). Through Mar 2025: Lambda Labs on-demand 1x prices (Wayback archive); from Jun 2026: vast.ai live spot medians, one point per scraped day."
          height={240} span2
        >
          <Line data={gpuIndexData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {dramIndexData && (
        <ChartCard
          chartId="dram-index"
          title={`${dramIndex.name} — monthly (${dramIndex.unit})`}
          src="datatrack.trendforce.com"
          srcUrl="https://datatrack.trendforce.com/Chart/content/4694/mainstream-dram-spot-price"
          freq="monthly"
          subtitle="TrendForce's official mainstream DRAM spot price index. Monthly resolution, published on DataTrack."
          height={240} span2
        >
          <Line data={dramIndexData} options={baseOpts(v => `$${v.toFixed(1)}`)} />
        </ChartCard>
      )}

      {chipData && (
        <ChartCard
          chartId="dram-chips"
          title="DRAM chip & GDDR spot price over time — average per model ($)"
          src="trendforce.com/price/dram/dram_spot"
          srcUrl="https://www.trendforce.com/price/dram/dram_spot"
          freq="daily"
          subtitle={`${DRAM_METHOD}${dramAsOf}`}
          legend={dramLegend(chips)}
          height={260} span2
        >
          <Line data={chipData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {moduleData && (
        <ChartCard
          chartId="dram-modules"
          title="Memory module spot price over time — average per model ($)"
          src="trendforce.com/price/dram/dram_spot"
          srcUrl="https://www.trendforce.com/price/dram/dram_spot"
          freq="daily"
          subtitle={`SO-DIMM / UDIMM / RDIMM modules. ${DRAM_METHOD}${dramAsOf}`}
          legend={dramLegend(modules)}
          height={240}
        >
          <Line data={moduleData} options={baseOpts(v => `$${v.toFixed(0)}`)} />
        </ChartCard>
      )}

      {changeData && (
        <ChartCard
          chartId="dram-change"
          title="DRAM spot — session change by model (%)"
          src="trendforce.com/price/dram/dram_spot"
          srcUrl="https://www.trendforce.com/price/dram/dram_spot"
          freq="daily"
          subtitle={`Average session change across each model's variants${dramAsOf}. Red = declining.`}
          height={240}
        >
          <Bar data={changeData} options={hBarOpts(v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)} />
        </ChartCard>
      )}
    </EditableGrid>
  );
}
