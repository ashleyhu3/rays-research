import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { baseOpts, GRID, TICK, BORD } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import { useData } from '../context/DataContext';

const APPS          = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini', 'Copilot'];
const COLORS        = [C.openai, C.anthropic, C.perplexity, C.google, C.slate];
const STATIC_SCORES = { ChatGPT: 4.8, Claude: 4.7, Perplexity: 4.6, Gemini: 4.4, Copilot: 4.2 };
const STATIC_REVS   = { ChatGPT: '2.1M', Claude: '340k', Perplexity: '280k', Gemini: '520k', Copilot: '180k' };

const ratingOpts = {
  ...baseOpts(v => v.toFixed(1)),
  scales: {
    x: { grid: GRID, ticks: TICK, border: BORD },
    y: { min: 3.5, max: 5, grid: GRID, ticks: { ...TICK, callback: v => v.toFixed(1) }, border: BORD },
  },
};

export default function AppStore({ weeks: W }) {
  void W;
  const { liveData } = useData();
  const as = liveData?.appstore;
  const hasLive = as?.ratings != null;

  const scores = useMemo(() =>
    APPS.map(n => as?.ratings?.[n]?.score ?? STATIC_SCORES[n]),
    [as]
  );

  const ratingData = useMemo(() => ({
    labels: APPS,
    datasets: [{
      data:            scores,
      backgroundColor: COLORS.map(c => fa(c, 0.7)),
      borderColor:     COLORS,
      borderWidth: 1, borderRadius: 4,
    }],
  }), [scores]);

  const subtitle = hasLive
    ? APPS.map(n => `${n}: ${as.ratings[n]?.score?.toFixed(1) ?? '—'} (${as.ratings[n]?.reviews?.toLocaleString() ?? '—'} reviews)`).join(' · ')
    : APPS.map(n => `${n}: ${STATIC_SCORES[n]} (${STATIC_REVS[n]} reviews)`).join(' · ');

  return (
    <div className="cgrid">
      <ChartCard
        title="iOS App Store star rating — AI assistant apps (US)"
        src={hasLive ? 'app-store-scraper · live · iTunes API' : 'app-store-scraper · iTunes API'}
        subtitle={subtitle}
        height={300} span2
      >
        <Bar data={ratingData} options={ratingOpts} />
      </ChartCard>
    </div>
  );
}
