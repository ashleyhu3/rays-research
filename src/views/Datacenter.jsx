import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { baseOpts, stackedOpts, hBarOpts, mkDs, GRID, TICK, BORD } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

/* ── Static / short-series data defined outside component ─────────── */
const CAPEX_YEARS  = ['2022','2023','2024','2025','2026e'];
const STATE_LABELS = ['Virginia','Texas','Oregon','Arizona','Georgia','Ohio','California','Washington'];
const STATE_GW     = [18.4, 12.2, 7.8, 6.4, 5.1, 4.9, 4.2, 3.8];

const stateData = {
  labels: STATE_LABELS,
  datasets: [{
    data:            STATE_GW,
    backgroundColor: STATE_GW.map(v => fa(C.anthropic, 0.3 + v / 30)),
    borderColor:     C.anthropic,
    borderWidth: 1, borderRadius: 4,
  }],
};

export default function Datacenter({ weeks: W }) {
  const qN  = Math.min(W, 9);
  const gwN  = Math.min(W, 13);
  const capN = Math.min(W, 5);

  const QTR_LABELS = ['Q1 24','Q2 24','Q3 24','Q4 24','Q1 25','Q2 25','Q3 25','Q4 25','Q1 26'];
  const GW_QTRS    = ['Q1 23','Q2 23','Q3 23','Q4 23','Q1 24','Q2 24','Q3 24','Q4 24','Q1 25','Q2 25','Q3 25','Q4 25','Q1 26'];

  const capexData = useMemo(() => ({
    labels: CAPEX_YEARS.slice(0, capN),
    datasets: [
      { label: 'Microsoft',    data: [27,48,62,85,110].slice(0,capN), backgroundColor: fa(C.openai,    0.7), borderRadius:4 },
      { label: 'Google',       data: [22,36,54,75,98 ].slice(0,capN), backgroundColor: fa(C.google,    0.7), borderRadius:4 },
      { label: 'Amazon AWS',   data: [32,52,68,92,120].slice(0,capN), backgroundColor: fa(C.anthropic, 0.7), borderRadius:4 },
      { label: 'Meta',         data: [11,28,38,65,84 ].slice(0,capN), backgroundColor: fa(C.meta,      0.7), borderRadius:4 },
      { label: 'Oracle+others',data: [8,14,22,40,68  ].slice(0,capN), backgroundColor: fa(C.slate,     0.6), borderRadius:4 },
    ],
  }), [W]);

  const gwData = useMemo(() => ({
    labels: GW_QTRS.slice(0, gwN),
    datasets: [mkDs('AI factory GW under construction', C.teal, trend(8, 82, gwN, 0.04), true)],
  }), [W]);

  const queueData = useMemo(() => ({
    labels: QTR_LABELS.slice(0, qN),
    datasets: [
      mkDs('PJM queue (GW)',  C.red,    trend(180, 310, qN, 0.04)),
      mkDs('MISO queue (GW)', C.orange, trend(90,  168, qN, 0.05)),
    ],
  }), [W]);

  const btmData = useMemo(() => ({
    labels: QTR_LABELS.slice(0, qN),
    datasets: [
      { label: 'Natural gas',   data: trend(800,  4200, qN, 0.08), backgroundColor: fa(C.orange, 0.7), borderRadius:3 },
      { label: 'Solar+storage', data: trend(400,  2800, qN, 0.07), backgroundColor: fa(C.zhipu,  0.7), borderRadius:3 },
      { label: 'Nuclear SMR',   data: trend(0,    180,  qN, 0.20), backgroundColor: fa(C.teal,   0.7), borderRadius:3 },
    ],
  }), [W]);

  const dealValues  = [18,22,26,31,38,44,52,31,39].slice(0, qN);
  const dealsData = {
    labels: QTR_LABELS.slice(0, qN),
    datasets: [{
      data:            dealValues,
      backgroundColor: QTR_LABELS.slice(0,qN).map((_,i) => fa(i===7 ? C.red : C.teal, 0.7)),
      borderColor:     QTR_LABELS.slice(0,qN).map((_,i) => i===7 ? C.red : C.teal),
      borderWidth: 1, borderRadius: 4,
    }],
  };

  const stackedCapexOpts = {
    ...stackedOpts(v => `$${v}B`),
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `$${v}B` }, border: BORD, stacked: true },
    },
  };

  const stackedBtmOpts = {
    ...stackedOpts(v => `${v} MW`),
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `${v} MW` }, border: BORD, stacked: true },
    },
  };

  return (
    <div className="cgrid">
      <ChartCard
        title="Hyperscaler capex committed to datacenter build ($B)"
        src="SEC filings · earnings calls · IEA 2026 report"
        subtitle="Annual capital expenditure dedicated to AI datacenter construction. The top 5 tech companies alone exceeded $400B in 2025 — more than global oil & gas investment. IEA projects a further 75% increase in 2026."
        legend={[['Microsoft', C.openai], ['Google', C.google], ['Amazon AWS', C.anthropic], ['Meta', C.meta], ['Oracle + others', C.slate]]}
        insight="Combined hyperscaler datacenter capex is projected to reach <b>$700B+ in 2026</b> — exceeding global investment in oil & gas for the second consecutive year. However, actual construction completion lags by 20–54 months."
        height={260} span2 isNew
      >
        <Bar data={capexData} options={stackedCapexOpts} />
      </ChartCard>

      <ChartCard
        title="US datacenter capacity under construction (GW)"
        src="satellite tracking (IEA) · CBRE · JLL"
        subtitle='AI "factory" datacenter capacity actually breaking ground, per IEA satellite-based tracking. "AI factories" tripled in capacity in the past 18 months. Of 240 GW announced, roughly one-third are under active construction.'
        srcNote="Sources: IEA Key Questions on Energy and AI (Apr 2026) · CBRE H1 2026 datacenter market report · Hiatt & Ryu, USC Energy Brief (Sep 2025)"
        height={200} isNew
      >
        <Line data={gwData} options={baseOpts(v => `${v} GW`)} />
      </ChartCard>

      <ChartCard
        title="Permitted capacity by US state (GW, top 8)"
        src="state PUC filings · EPRI · Hiatt & Ryu USC 2025"
        subtitle="States with the largest pipeline of permitted (not yet built) datacenter load. Virginia hosts 26% of current US datacenter electricity consumption. Texas and Oregon are the fastest-growing."
        height={200} isNew
      >
        <Bar data={stateData} options={hBarOpts(v => `${v} GW`)} />
      </ChartCard>

      <ChartCard
        title="Grid interconnection queue — large loads (GW, PJM + MISO)"
        src="FERC · PJM · MISO interconnection queues"
        subtitle="New datacenter load applications waiting for grid connection. PJM queue wait is now 8+ years for projects approved in 2025. A rising queue = rising demand but also rising supply constraint."
        legend={[['PJM queue (GW)', C.red], ['MISO queue (GW)', C.orange]]}
        insight="The PJM interconnection queue for large loads has grown <b>4× in 24 months</b>. Average wait time for approved 2025 projects is <b>8 years</b> — the single biggest bottleneck to datacenter power delivery."
        height={200} isNew
      >
        <Line data={queueData} options={baseOpts(v => `${v} GW`)} />
      </ChartCard>

      <ChartCard
        title="Behind-the-meter generation deployments (MW)"
        src="EIA form 860 · S&P Global · Wood Mackenzie"
        subtitle='On-site natural gas, solar, and nuclear power deployed directly at datacenter sites ("bring your own power"). Hyperscalers are bypassing the grid to avoid interconnection delays.'
        legend={[['Natural gas', C.orange], ['Solar + storage', C.zhipu], ['Nuclear SMR', C.teal]]}
        height={200} isNew
      >
        <Bar data={btmData} options={stackedBtmOpts} />
      </ChartCard>

      <ChartCard
        title="New datacenter deals signed per quarter"
        src="CBRE · JLL · Cushman & Wakefield leasing data"
        subtitle="Leasing activity is a leading indicator — signed deals become construction starts 6–18 months later. New deals fell 40%+ in Q4 2025 amid capital crunch concerns."
        insight="After a record Q3 2025, new datacenter deals dropped <b>40%+ in Q4 2025</b> (ITIF). The Stargate project stalled amid partner disputes. 2026 Q1 shows partial recovery but capex risk remains elevated."
        height={200} isNew
      >
        <Bar data={dealsData} options={baseOpts(v => `${v} deals`)} />
      </ChartCard>
    </div>
  );
}
