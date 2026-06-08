import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { hBarOpts } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import { useData } from '../context/DataContext';

// Static fallback — overridden when OpenRouter API data is available
const STATIC_MODELS = ['Claude Opus 4.6','GPT-4o','Gemini 1.5 Pro','GLM-5 (Zhipu)','Qwen-2.5 72B','DeepSeek V3.2','MiniMax M2.5','Kimi K2.5','MiMo-V2-Pro'];
const STATIC_PRICES = [5.00, 2.50, 1.25, 0.30, 0.40, 0.28, 0.30, 0.25, 0.30];
const STATIC_COLORS = [C.anthropic, C.openai, C.google, C.zhipu, C.deepseek, C.deepseek, C.minimax, C.kimi, C.xiaomi];

// Key model IDs in OpenRouter API — matched by prefix for version-agnostic lookup
const KEY_MODELS = [
  { match: 'anthropic/claude-opus',      label: 'Claude Opus 4.6', color: C.anthropic },
  { match: 'openai/gpt-4o',              label: 'GPT-4o',          color: C.openai    },
  { match: 'google/gemini-pro-1.5',      label: 'Gemini 1.5 Pro',  color: C.google    },
  { match: 'deepseek/deepseek-chat',     label: 'DeepSeek V3',     color: C.deepseek  },
  { match: 'qwen/qwen-2.5-72b',          label: 'Qwen 2.5 72B',    color: C.deepseek  },
  { match: 'minimax/minimax',            label: 'MiniMax',         color: C.minimax   },
  { match: 'moonshot/moonshot',          label: 'Kimi',            color: C.kimi      },
];

export default function Tokens({ weeks: W }) {
  void W;
  const { liveData } = useData();

  const costData = useMemo(() => {
    const models = liveData?.openrouter?.models;
    if (models?.length > 0) {
      const matched = [];
      KEY_MODELS.forEach(({ match, label, color }) => {
        const m = models.find(m => m.id.startsWith(match));
        if (m && m.pricing.prompt > 0) matched.push({ label, color, price: m.pricing.prompt });
      });
      if (matched.length >= 3) {
        matched.sort((a, b) => b.price - a.price);
        return {
          labels: matched.map(m => m.label),
          datasets: [{
            data:            matched.map(m => m.price),
            backgroundColor: matched.map(m => fa(m.color, 0.75)),
            borderColor:     matched.map(m => m.color),
            borderWidth: 1, borderRadius: 4,
          }],
        };
      }
    }
    return {
      labels: STATIC_MODELS,
      datasets: [{
        data:            STATIC_PRICES,
        backgroundColor: STATIC_COLORS.map(c => fa(c, 0.75)),
        borderColor:     STATIC_COLORS,
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [liveData]);

  const hasLive = (liveData?.openrouter?.models?.length ?? 0) > 0;
  const src = hasLive ? 'openrouter.ai/api/v1/models · live' : 'openrouter pricing API · provider docs';

  return (
    <div className="cgrid">
      <ChartCard
        title="Input token cost per million — top models ($)"
        src={src}
        subtitle="Live pricing from OpenRouter's public model API. Chinese models deliver near-parity quality at 10–17× lower cost — the primary driver of developer migration."
        insight="MiniMax and DeepSeek price at <b>$0.28–0.30/M tokens</b> vs Claude Opus at <b>$5+/M</b>. With near-parity SWE-bench scores, developer economics strongly favor Chinese models for high-volume agent runs."
        height={400} span2
      >
        <Bar data={costData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>
    </div>
  );
}
