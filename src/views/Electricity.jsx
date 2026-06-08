import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { baseOpts, stackedOpts, hBarOpts, mkDs, GRID, TICK, BORD } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

const EL_YEARS  = ['2020','2021','2022','2023','2024','2025e','2026e','2027e','2028e'];
const TOT_TWH   = [120, 132, 148, 162, 183, 220, 268, 295, 340];
const AI_TWH    = [22,  32,  48,  68,  95,  138, 192, 228, 278];
const NON_AI    = TOT_TWH.map((t, i) => t - AI_TWH[i]);

const RATE_YEARS = ['2021','2022','2023','2024','2025','2026e'];

const STATE_LABELS = ['Virginia','Texas','Oregon','Arizona','Georgia','N. Dakota','Nebraska','Iowa'];
const STATE_VALS   = [26, 14, 11, 8, 6, 15, 12, 11];

const stateData = {
  labels: STATE_LABELS,
  datasets: [{
    data:            STATE_VALS,
    backgroundColor: STATE_VALS.map(v => fa(C.red, 0.3 + v / 50)),
    borderColor:     C.red,
    borderWidth: 1, borderRadius: 4,
  }],
};

export default function Electricity({ weeks: W }) {
  const n  = Math.min(W, 9);
  const r  = Math.min(W, 6);

  const totalData = useMemo(() => ({
    labels: EL_YEARS.slice(0, n),
    datasets: [
      { label: 'AI-specific',    data: AI_TWH.slice(0, n),  backgroundColor: fa(C.anthropic, 0.75), borderRadius:4 },
      { label: 'Non-AI compute', data: NON_AI.slice(0, n),  backgroundColor: fa(C.slate,     0.5),  borderRadius:4 },
    ],
  }), [W]);

  const shareData = useMemo(() => ({
    labels: EL_YEARS.slice(0, n),
    datasets: [
      mkDs('Base case',     C.teal, [0.9,1.1,1.4,1.8,2.4,3.2,4.4,5.8,7.1].slice(0,n), true),
      mkDs('High scenario', C.red,  [1.0,1.3,1.8,2.4,3.4,5.0,7.2,9.8,12.0].slice(0,n)),
    ],
  }), [W]);

  const rateData = useMemo(() => ({
    labels: RATE_YEARS.slice(0, r),
    datasets: [
      mkDs('Virginia', C.red,   [10.2,11.8,12.4,13.1,14.6,16.2].slice(0,r)),
      mkDs('US avg',   C.slate, [11.0,12.4,13.0,13.5,14.0,14.5].slice(0,r)),
      mkDs('Texas',    C.orange,[9.8,11.2,12.0,12.6,13.0,13.4].slice(0,r)),
    ],
  }), [W]);

  const mixData = useMemo(() => ({
    labels: EL_YEARS.slice(0, n),
    datasets: [
      { label: 'Renewables+nuclear', data:[18,20,22,24,27,31,36,41,46].slice(0,n), backgroundColor:fa(C.zhipu,  0.7), borderRadius:4 },
      { label: 'Natural gas',        data:[42,44,44,42,40,38,35,32,29].slice(0,n), backgroundColor:fa(C.orange, 0.7), borderRadius:4 },
      { label: 'Grid mix/coal',      data:[40,36,34,34,33,31,29,27,25].slice(0,n), backgroundColor:fa(C.slate,  0.5), borderRadius:4 },
    ],
  }), [W]);

  const pueData = useMemo(() => ({
    labels: EL_YEARS.slice(0, n),
    datasets: [
      mkDs('Hyperscaler avg', C.openai, [1.18,1.16,1.15,1.14,1.13,1.13,1.12,1.12,1.11].slice(0,n)),
      mkDs('Industry avg',    C.slate,  [1.56,1.52,1.48,1.46,1.44,1.42,1.40,1.38,1.36].slice(0,n)),
      mkDs('AI-dense',        C.red,    [1.35,1.38,1.42,1.45,1.48,1.50,1.52,1.54,1.55].slice(0,n)),
    ],
  }), [W]);

  const stackedElOpts = {
    ...stackedOpts(v => `${v} TWh`),
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `${v} TWh` }, border: BORD, stacked: true },
    },
  };

  const stackedMixOpts = {
    ...stackedOpts(v => `${v}%`),
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `${v}%` }, border: BORD, stacked: true },
    },
  };

  return (
    <div className="cgrid">
      <ChartCard
        title="US datacenter electricity consumption (TWh / year)"
        src="IEA · EIA · Lawrence Berkeley National Lab · Pew Research"
        subtitle="Annual US datacenter electricity demand. At 183 TWh in 2024, datacenters consumed ~4.4% of total US electricity — equivalent to Pakistan's entire national demand. IEA projects 325–580 TWh by 2028, driven almost entirely by AI workloads."
        legend={[['Total datacenter (TWh)', C.teal], ['AI-specific estimate (TWh)', C.anthropic], ['Non-AI compute (TWh)', C.slate]]}
        insight="US datacenters now account for <b>50% of all new US electricity demand growth</b> — far outpacing residential, industrial, and transport sectors combined (IEA, April 2026)."
        height={260} span2 isNew
      >
        <Bar data={totalData} options={stackedElOpts} />
      </ChartCard>

      <ChartCard
        title="State share of national datacenter electricity (%)"
        src="EPRI · EIA state-level estimates"
        subtitle="Virginia alone consumes 26% of US datacenter electricity — a single-state concentration risk. Northern Virginia is the world's largest datacenter cluster."
        height={200} isNew
      >
        <Bar data={stateData} options={hBarOpts(v => `${v}%`)} />
      </ChartCard>

      <ChartCard
        title="AI electricity as % of US total consumption"
        src="IEA 2026 · EIA annual energy outlook"
        subtitle="AI compute's growing share of the US grid. Was under 1% in 2020; on track for 8–12% by 2028 in the high-growth scenario."
        legend={[['Base case (%)', C.teal], ['High scenario (%)', C.red]]}
        height={200} isNew
      >
        <Line data={shareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
      </ChartCard>

      <ChartCard
        title="Average household electricity rate impact (¢/kWh)"
        src="EIA · state PUC rate filings · Dominion Energy"
        subtitle="Grid infrastructure upgrades for datacenters are being passed to ratepayers. Virginia's Dominion Energy proposed its first base-rate increase since 1992 in Feb 2025, partly attributable to datacenter load growth."
        legend={[['Virginia avg rate', C.red], ['US national avg', C.slate], ['Texas avg', C.orange]]}
        insight="Virginia ratepayers face a <b>+$8.51/month</b> increase in 2026 — the state's first base-rate rise since 1992 — tied directly to datacenter grid infrastructure investment (Dominion Energy, Feb 2025)."
        height={200} isNew
      >
        <Line data={rateData} options={baseOpts(v => `${v.toFixed(1)}¢`)} />
      </ChartCard>

      <ChartCard
        title="Renewable vs fossil share of datacenter power"
        src="IEA · S&P Global · Wood Mackenzie"
        subtitle="Renewables currently supply ~27% of datacenter electricity globally. Hyperscalers are signing PPAs faster than the grid can deliver, forcing gas turbine bridging."
        legend={[['Renewables + nuclear', C.zhipu], ['Natural gas', C.orange], ['Grid mix / coal', C.slate]]}
        height={200} isNew
      >
        <Bar data={mixData} options={stackedMixOpts} />
      </ChartCard>

      <ChartCard
        title="Power Usage Effectiveness (PUE) — industry trend"
        src="Uptime Institute · Google · Microsoft sustainability reports"
        subtitle="PUE = total facility power ÷ IT equipment power. Lower is better (1.0 = perfect). AI GPU clusters run hotter than traditional compute — driving PUE higher at cutting-edge facilities."
        legend={[['Hyperscaler avg PUE', C.openai], ['Industry avg PUE', C.slate], ['AI-dense facility PUE', C.red]]}
        height={200} isNew
      >
        <Line data={pueData} options={baseOpts(v => v.toFixed(2))} />
      </ChartCard>
    </div>
  );
}
