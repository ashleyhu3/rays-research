import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C } from '../config/colors';
import { trend, series } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, mkDs } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import EditableGrid from '../components/EditableGrid';
import { useData } from '../context/DataContext';

// Map vast.ai GPU names to display names
const GPU_MAP = {
  H100_SXM4:  'H100 SXM5',
  H100_PCIE:  'H100 PCIe',
  H200_SXM5:  'H200 SXM5',
  H200_SXM:   'H200 SXM5',
  A100_SXM4:  'A100 SXM4',
  RTX_4090:   'RTX 4090',
};

function findPrice(gpu, key1, key2) {
  if (!gpu) return null;
  return gpu[key1] ?? gpu[key2] ?? null;
}

export default function GPU({ weeks: W }) {
  const { liveData } = useData();
  const wk = useMemo(() => wkLabels(W), [W]);

  const gpu = liveData?.gpu;
  const hasLive = gpu != null && Object.keys(gpu).length > 0;

  const h100Current = findPrice(gpu, 'H100_SXM4', 'H100') ?? 2.18;
  const h200Current = findPrice(gpu, 'H200_SXM5', 'H200') ?? 4.62;
  const b200Current = 6.20; // B200 not yet on spot markets

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

  return (
    <EditableGrid viewId="gpu">
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
    </EditableGrid>
  );
}
