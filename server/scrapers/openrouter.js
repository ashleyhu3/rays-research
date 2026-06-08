const axios = require('axios');

async function getOpenRouterData() {
  const { data } = await axios.get('https://openrouter.ai/api/v1/models', {
    headers: { 'User-Agent': 'signal-dashboard/1.0' },
    timeout: 15000,
  });

  const models = (data.data || []).map(m => ({
    id:      m.id,
    name:    m.name || m.id,
    context: m.context_length ?? null,
    pricing: {
      prompt:     parseFloat(m.pricing?.prompt     ?? 0) * 1e6, // convert to $/M tokens
      completion: parseFloat(m.pricing?.completion ?? 0) * 1e6,
    },
  }));

  return { models };
}

module.exports = { getOpenRouterData };
