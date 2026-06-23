const axios = require('axios');

const HF = 'https://huggingface.co/api/models';
const UA = { 'User-Agent': 'signal-dashboard/1.0' };

// Model-family orgs whose aggregate downloads proxy open-model demand.
// search narrows orgs that publish unrelated models (google → electra, bert…)
const FAMILIES = {
  Llama:    { author: 'meta-llama',  search: 'llama'    },
  Qwen:     { author: 'Qwen',        search: 'qwen'     },
  Gemma:    { author: 'google',      search: 'gemma'    },
  DeepSeek: { author: 'deepseek-ai', search: 'deepseek' },
  Mistral:  { author: 'mistralai',   search: 'mistral'  },
  GLM:      { author: 'zai-org',     search: 'glm'      },
  MiniMax:  { author: 'MiniMaxAI',   search: 'minimax'  },
};

async function getTopModels() {
  const { data } = await axios.get(HF, {
    params: { sort: 'downloads', direction: -1, limit: 100 },
    headers: UA,
    timeout: 20000,
  });
  return (data ?? []).map(m => ({
    id:           m.id,
    downloads:    m.downloads || 0,
    likes:        m.likes || 0,
    createdAt:    m.createdAt ?? null,
    pipeline_tag: m.pipeline_tag || 'other',
  }));
}

// Model creation rate — how many new models hit the Hub recently
async function getNewModelCounts() {
  const { data } = await axios.get(HF, {
    params: { sort: 'createdAt', direction: -1, limit: 1000 },
    headers: UA,
    timeout: 30000,
  });
  const models = (data ?? []).filter(m => m.createdAt);
  if (models.length < 2) return null;
  // The Hub gets >1000 new models per DAY (the API page cap), so window
  // counts saturate. Instead derive the creation rate from the time span the
  // newest N models cover: N models / span = models per hour.
  const newest = Date.parse(models[0].createdAt);
  const oldest = Date.parse(models[models.length - 1].createdAt);
  const spanHours = Math.max((newest - oldest) / 3600000, 0.01);
  const perDay = (models.length / spanHours) * 24;
  return {
    perDay:    Math.round(perDay),
    perWeekEst: Math.round(perDay * 7),
    sampled:   models.length,
    spanHours: +spanHours.toFixed(1),
  };
}

async function getFamilyDownloads() {
  const out = {};
  for (const [family, { author, search }] of Object.entries(FAMILIES)) {
    try {
      const { data } = await axios.get(HF, {
        params: { author, search, sort: 'downloads', direction: -1, limit: 100 },
        headers: UA,
        timeout: 20000,
      });
      const models = data ?? [];
      out[family] = {
        downloads: models.reduce((s, m) => s + (m.downloads || 0), 0),
        models:    models.length,
        top:       models[0]?.id ?? null,
      };
    } catch {
      out[family] = null;
    }
  }
  return out;
}

async function getHuggingFaceData() {
  const [models, newModels, families] = await Promise.allSettled([
    getTopModels(),
    getNewModelCounts(),
    getFamilyDownloads(),
  ]);

  const top = models.status === 'fulfilled' ? models.value : [];
  if (top.length === 0) return null;

  return {
    models:    top,
    newModels: newModels.status === 'fulfilled' ? newModels.value : null,
    families:  families.status === 'fulfilled' ? families.value : null,
    asOf:      new Date().toISOString().slice(0, 10),
  };
}

module.exports = { getHuggingFaceData };
