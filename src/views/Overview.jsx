import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, stackedOpts, mkDs, fmtM } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import KpiCard from '../components/KpiCard';

const KPI_ITEMS = [
  { val: '16.2M', label: 'PyPI anthropic downloads / wk',          delta: '+18% MoM',             cls: 'up', color: C.anthropic },
  { val: '412',   label: 'SO questions (anthropic-claude) / wk',    delta: '+24% MoM',             cls: 'up', color: C.anthropic },
  { val: '18.4k', label: 'GitHub repos depend on anthropic SDK',     delta: '+31% MoM',             cls: 'up', color: C.anthropic },
  { val: '45%',   label: 'Chinese model share of OpenRouter tokens', delta: '↑ from <2% (Apr 2025)',cls: 'up', color: C.minimax   },
  { val: '325',   label: 'US datacenter TWh demand projected 2028',  delta: '↑ from 183 TWh in 2024',cls:'up', color: C.teal      },
];

const ELEC_LABELS = ['2017','2018','2019','2020','2021','2022','2023','2024','2025e','2026e','2027e','2028e'];
const ELEC_VALS   = [90, 100, 112, 120, 130, 148, 162, 183, 220, 268, 295, 340];

export default function Overview({ weeks: W }) {
  const wk = useMemo(() => wkLabels(W), [W]);

  const pypiData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('openai',              C.openai,    trend(38e6,  42e6,   W, 0.05)),
      mkDs('anthropic',           C.anthropic, trend(9e6,   16.2e6, W, 0.06), true),
      mkDs('google-generativeai', C.google,    trend(14e6,  18e6,   W, 0.05)),
      mkDs('mistralai',           C.mistral,   trend(3.2e6, 5.1e6,  W, 0.07)),
    ],
  }), [W]);

  const tokenData = useMemo(() => ({
    labels: wk,
    datasets: [
      { label: 'US models',      data: trend(11e12, 11e12, W, 0.05), backgroundColor: fa(C.openai,  0.6), borderRadius: 3 },
      { label: 'Chinese models', data: trend(1e12,  10e12, W, 0.08), backgroundColor: fa(C.minimax, 0.7), borderRadius: 3 },
      { label: 'EU/other',       data: trend(500e9, 900e9, W, 0.06), backgroundColor: fa(C.slate,   0.5), borderRadius: 3 },
    ],
  }), [W]);

  const elN = Math.min(W, 12);
  const elecData = useMemo(() => ({
    labels: ELEC_LABELS.slice(0, elN),
    datasets: [mkDs('US DC electricity (TWh)', C.teal, ELEC_VALS.slice(0, elN), true)],
  }), [W]);

  return (
    <>
      {/* KPI row */}
      <div className="kpi-row">
        {KPI_ITEMS.map((k) => (
          <KpiCard
            key={k.label}
            val={k.val}
            label={k.label}
            delta={k.delta}
            deltaClass={k.cls}
            accentColor={k.color}
          />
        ))}
      </div>

      <div className="cgrid">
        <ChartCard
          title="PyPI weekly downloads — Python SDK installs"
          src="pypistats.org · free · no auth"
          subtitle="Weekly installs for each AI provider SDK. The most direct, automatable developer-adoption signal at zero cost."
          legend={[['openai', C.openai], ['anthropic', C.anthropic], ['google-generativeai', C.google], ['mistralai', C.mistral]]}
          height={230} span2
        >
          <Line data={pypiData} options={baseOpts(fmtM)} />
        </ChartCard>

        <ChartCard
          title="OpenRouter weekly tokens — by provider origin"
          src="openrouter.ai/rankings (public)"
          subtitle="Real token throughput on OpenRouter. Chinese models now rival US incumbents by volume."
          legend={[['US models', C.openai], ['Chinese models', C.minimax], ['EU / other', C.slate]]}
          height={200}
        >
          <Bar data={tokenData} options={stackedOpts(fmtM)} />
        </ChartCard>

        <ChartCard
          title="US datacenter electricity demand (TWh / yr)"
          src="IEA · EIA · Lawrence Berkeley Lab"
          subtitle="AI-driven power demand is now 50% of all new US electricity growth. Heading to 325–580 TWh by 2028."
          height={200}
        >
          <Line data={elecData} options={baseOpts(v => `${v} TWh`)} />
        </ChartCard>
      </div>
    </>
  );
}
