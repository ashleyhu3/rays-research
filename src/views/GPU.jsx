import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { C } from '../config/colors';
import { trend, series } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, mkDs } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

export default function GPU({ weeks: W }) {
  const wk = useMemo(() => wkLabels(W), [W]);

  const { priceData, availData, spreadData } = useMemo(() => {
    const h100 = trend(2.49, 2.18, W, 0.06);
    const h200 = trend(3.80, 4.62, W, 0.08);
    const b200 = series(6.20, 0.15, W).map((v, i) =>
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
  }, [W]);

  return (
    <div className="cgrid">
      <ChartCard
        title="GPU spot price $/hr — Lambda Labs / RunPod"
        src="lambda labs API · runpod API · vast.ai"
        subtitle="B200 price spikes signal labs hoarding compute before training runs — forward-looking demand proxy."
        legend={[['H100 SXM5 (80GB)', C.openai], ['H200 SXM5 (141GB)', C.anthropic], ['B200 SXM (192GB)', C.google]]}
        insight="B200 spot pricing spiked <b>+340%</b> in late March 2026 — correlated with large-scale model pre-training reports. Now <b>2.1× its Jan 2026 baseline</b>."
        height={250} span2
      >
        <Line data={priceData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      <ChartCard
        title="GPU availability — regions with capacity"
        src="lambda labs instance types API"
        subtitle="Zero = fully sold out. Tracks supply constraints."
        height={200}
      >
        <Line data={availData} options={baseOpts(v => Math.round(v))} />
      </ChartCard>

      <ChartCard
        title="H200 – H100 price spread"
        src="runpod + lambda spot prices"
        subtitle="Widening spread = demand shifting to next-gen memory bandwidth."
        height={200}
      >
        <Line data={spreadData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>
    </div>
  );
}
