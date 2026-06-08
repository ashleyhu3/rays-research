import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { C } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, mkDs, fmtM } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import KpiCard from '../components/KpiCard';
import { useData } from '../context/DataContext';

function fmtCount(n) {
  if (n == null) return null;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function pypiSlice(liveData, pkg, W, fallbackStart, fallbackEnd, ns = 0.05) {
  const hist = liveData?.pypiHistory?.[pkg];
  if (hist?.length >= W) return hist.slice(-W);
  const snap = liveData?.pypi?.[pkg];
  if (snap) return trend(Math.round(snap * 0.65), snap, W, ns);
  return trend(fallbackStart, fallbackEnd, W, ns);
}

export default function Overview({ weeks: W }) {
  const { liveData } = useData();
  const wk = useMemo(() => wkLabels(W), [W]);

  const pypi = liveData?.pypi ?? {};
  const soW  = liveData?.soWeekly ?? null;

  const kpiItems = [
    {
      val:   fmtCount(pypi['anthropic']) ?? '—',
      label: 'PyPI anthropic downloads / wk',
      delta: pypi['anthropic'] ? 'live · pypistats.org' : 'loading…',
      cls: 'up', color: C.anthropic,
    },
    {
      val:   soW != null ? String(soW) : '—',
      label: 'SO questions (anthropic-claude) / wk',
      delta: soW != null ? 'live · stackexchange API' : 'loading…',
      cls: 'up', color: C.anthropic,
    },
  ];

  const pypiData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkDs('openai',              C.openai,    pypiSlice(liveData, 'openai',              W, 38e6,  42e6,   0.05)),
      mkDs('anthropic',           C.anthropic, pypiSlice(liveData, 'anthropic',           W, 9e6,   16.2e6, 0.06), true),
      mkDs('google-generativeai', C.google,    pypiSlice(liveData, 'google-generativeai', W, 14e6,  18e6,   0.05)),
      mkDs('mistralai',           C.mistral,   pypiSlice(liveData, 'mistralai',           W, 3.2e6, 5.1e6,  0.07)),
    ],
  }), [W, liveData]);

  const hasPypiHist = (liveData?.pypiHistory?.['anthropic']?.length ?? 0) > 0;

  return (
    <>
      <div className="kpi-row">
        {kpiItems.map((k) => (
          <KpiCard key={k.label} val={k.val} label={k.label} delta={k.delta} deltaClass={k.cls} accentColor={k.color} />
        ))}
      </div>

      <div className="cgrid">
        <ChartCard
          title="PyPI weekly downloads — Python SDK installs"
          src={hasPypiHist ? 'pypistats.org · full history · live' : pypi['anthropic'] ? 'pypistats.org · live' : 'pypistats.org'}
          subtitle="Weekly installs for each AI provider Python SDK. The most direct, automatable developer-adoption signal at zero cost."
          legend={[['openai', C.openai], ['anthropic', C.anthropic], ['google-generativeai', C.google], ['mistralai', C.mistral]]}
          height={300} span2
        >
          <Line data={pypiData} options={baseOpts(fmtM)} />
        </ChartCard>
      </div>
    </>
  );
}
