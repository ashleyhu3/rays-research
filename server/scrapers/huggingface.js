const axios = require('axios');

// Mirrors fetchHF in src/services/fetchers.js — top models by all-time downloads
async function getHuggingFaceData() {
  const { data } = await axios.get('https://huggingface.co/api/models', {
    params: { sort: 'downloads', direction: -1, limit: 30 },
    headers: { 'User-Agent': 'signal-dashboard/1.0' },
    timeout: 20000,
  });

  return {
    models: (data ?? []).map(m => ({
      id:           m.id,
      downloads:    m.downloads || 0,
      pipeline_tag: m.pipeline_tag || 'other',
    })),
  };
}

module.exports = { getHuggingFaceData };
