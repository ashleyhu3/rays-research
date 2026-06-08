import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { dayLabels } from '../utils/labels';
import { baseOpts, mkDs, fmtP, GRID, TICK, BORD } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';

const RATING_LABELS = ['ChatGPT','Claude','Perplexity','Gemini','Copilot'];
const RATING_DATA   = [4.8, 4.7, 4.6, 4.4, 4.2];
const RATING_COLORS = [C.openai, C.anthropic, C.perplexity, C.google, C.slate];

const ratingData = {
  labels: RATING_LABELS,
  datasets: [{
    data:            RATING_DATA,
    backgroundColor: RATING_COLORS.map(c => fa(c, 0.7)),
    borderColor:     RATING_COLORS,
    borderWidth: 1, borderRadius: 4,
  }],
};

const ratingOpts = {
  ...baseOpts(v => v.toFixed(1)),
  scales: {
    x: { grid: GRID, ticks: TICK, border: BORD },
    y: { min: 3.5, max: 5, grid: GRID, ticks: { ...TICK, callback: v => v.toFixed(1) }, border: BORD },
  },
};

export default function AppStore({ weeks: W }) {
  const D    = Math.min(W * 7, 84);
  const days = useMemo(() => dayLabels(D), [D]);

  const rankOpts = useMemo(() => ({
    ...baseOpts(v => `#${Math.round(v)}`),
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 8, autoSkip: true }, border: BORD },
      y: {
        grid: GRID, border: BORD, reverse: true, min: 1, max: 20,
        ticks: { ...TICK, callback: v => `#${v}` },
      },
    },
  }), []);

  const rankData = useMemo(() => ({
    labels: days,
    datasets: [
      mkDs('ChatGPT',    C.openai,    trend(1, 1, D, 0.30).map(v => Math.max(1, Math.round(v)))),
      mkDs('Claude',     C.anthropic, trend(9, 4, D, 0.25).map(v => Math.max(1, Math.round(v)))),
      mkDs('Perplexity', C.perplexity,trend(7, 6, D, 0.30).map(v => Math.max(1, Math.round(v)))),
      mkDs('Gemini',     C.google,    trend(5, 7, D, 0.25).map(v => Math.max(1, Math.round(v)))),
    ],
  }), [D]);

  const dauData = useMemo(() => ({
    labels: days,
    datasets: [
      mkDs('ChatGPT',    C.openai,    trend(95, 100, D, 0.04)),
      mkDs('Claude',     C.anthropic, trend(18, 38,  D, 0.08)),
      mkDs('Perplexity', C.perplexity,trend(22, 32,  D, 0.07)),
    ],
  }), [D]);

  return (
    <div className="cgrid">
      <ChartCard
        title="iOS App Store rank — Productivity category (US)"
        src="appfollow API · sensor tower · lower = better"
        subtitle="Daily rank in Productivity. Rank spikes correlate with model releases and viral moments."
        legend={[['ChatGPT', C.openai], ['Claude', C.anthropic], ['Perplexity', C.perplexity], ['Gemini', C.google]]}
        insight="Claude peaked at <b>#2</b> during the Claude 3.7 launch week, now sustained at <b>#4</b> — its best run ever."
        height={250} span2
      >
        <Line data={rankData} options={rankOpts} />
      </ChartCard>

      <ChartCard
        title="DAU index (100 = ChatGPT peak)"
        src="sensor tower estimates"
        subtitle="Relative daily active users from download velocity and engagement signals."
        legend={[['ChatGPT', C.openai], ['Claude', C.anthropic], ['Perplexity', C.perplexity]]}
        height={200}
      >
        <Line data={dauData} options={baseOpts(fmtP)} />
      </ChartCard>

      <ChartCard
        title="App store rating"
        src="appfollow"
        subtitle="Average star rating. Product satisfaction signal."
        height={200}
      >
        <Bar data={ratingData} options={ratingOpts} />
      </ChartCard>
    </div>
  );
}
