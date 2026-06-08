import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { baseOpts, fmtN } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import { useData } from '../context/DataContext';

const COMPANIES  = ['Anthropic', 'OpenAI', 'Google DM', 'Mistral', 'Cohere', 'Perplexity'];
const COLORS     = [C.anthropic, C.openai, C.google, C.mistral, C.teal, C.perplexity];
const STATIC_JOBS = { Anthropic: 312, OpenAI: 486, 'Google DM': 891, Mistral: 124, Cohere: 78, Perplexity: 95 };

export default function Jobs({ weeks: W }) {
  void W;
  const { liveData } = useData();
  const jd = liveData?.jobs;
  const hasLive = jd != null;

  const getTotal = name => jd?.[name]?.total ?? STATIC_JOBS[name] ?? 0;
  const getEng   = name => jd?.[name]?.engineering ?? null;

  const openRolesData = useMemo(() => ({
    labels: COMPANIES,
    datasets: [{
      data:            COMPANIES.map(getTotal),
      backgroundColor: COLORS.map(c => fa(c, 0.7)),
      borderColor:     COLORS,
      borderWidth: 1, borderRadius: 4,
    }],
  }), [jd]);

  const subtitle = hasLive
    ? COMPANIES.map(n => {
        const eng = getEng(n);
        return `${n}: ${getTotal(n)}${eng != null ? ` (${eng} eng)` : ''}`;
      }).join(' · ')
    : 'Live open engineering + research roles per AI lab via Greenhouse public API.';

  return (
    <div className="cgrid">
      <ChartCard
        title="Open roles by AI lab — live from Greenhouse"
        src={hasLive ? 'greenhouse.io API · live' : 'greenhouse.io API'}
        subtitle={subtitle}
        height={300} span2
      >
        <Bar data={openRolesData} options={baseOpts(fmtN)} />
      </ChartCard>
    </div>
  );
}
