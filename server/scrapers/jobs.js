const axios = require('axios');

const COMPANIES = {
  Anthropic:       'anthropic',
  OpenAI:          'openai',
  'Google DM':     'deepmind',
  Mistral:         'mistral',
  Cohere:          'cohere',
  Perplexity:      'perplexity-ai',
};

const ENG_KEYWORDS = /engineer|research|scientist|ml|infra|platform|product manager|data/i;

async function getGreenhouseJobs(slug) {
  const { data } = await axios.get(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    { timeout: 12000 }
  );
  const jobs = data.jobs || [];
  return {
    total:       jobs.length,
    engineering: jobs.filter(j => ENG_KEYWORDS.test(j.title || '')).length,
  };
}

async function getJobsData() {
  const entries = Object.entries(COMPANIES);
  const results = await Promise.allSettled(entries.map(([, slug]) => getGreenhouseJobs(slug)));
  const out = {};
  entries.forEach(([name], i) => {
    out[name] = results[i].status === 'fulfilled' ? results[i].value : null;
  });
  return out;
}

module.exports = { getJobsData };
