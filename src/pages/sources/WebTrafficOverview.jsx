import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { stackedOpts, mkBar, fmtM } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import { useData } from '../../context/DataContext';

const COMPANIES = [
  { domain: 'openai.com',         label: 'OpenAI',     color: C.openai    },
  { domain: 'anthropic.com',      label: 'Anthropic',  color: C.anthropic },
  { domain: 'gemini.google.com',  label: 'Google',     color: C.google    },
  { domain: 'hailuoai.com',       label: 'MiniMax',    color: C.minimax   },
  { domain: 'zhipuai.cn',         label: 'Zhipu',      color: C.zhipu     },
];

export default function WebTrafficOverview({ weeks }) {
  const { liveData: ld } = useData();
  const hist = ld?.webTraffic?.history;

  const chartData = useMemo(() => {
    if (!hist) return null;

    const allDates = new Set();
    for (const co of COMPANIES) {
      const pts = hist[`${co.domain}.visits`];
      if (pts) Object.keys(pts).forEach(d => allDates.add(d));
    }

    const dates = [...allDates].sort();
    if (dates.length === 0) return null;

    return {
      labels: dates,
      datasets: COMPANIES.map(co => {
        const pts = hist[`${co.domain}.visits`] ?? {};
        return mkBar(co.label, co.color, dates.map(d => pts[d] ?? null));
      }),
    };
  }, [hist, weeks]);

  if (!chartData) return null;

  return (
    <ChartCard
      chartId="web-visits-total"
      legend={COMPANIES.map(co => [co.label, co.color])}
      height={260} span2
    >
      <Bar data={chartData} options={stackedOpts(fmtM)} />
    </ChartCard>
  );
}
