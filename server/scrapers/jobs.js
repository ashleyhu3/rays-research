const axios = require('axios');

// board: greenhouse | ashby | lever — all expose free unauthenticated JSON.
// OpenAI/Cohere/Perplexity moved to Ashby; Mistral is on Lever (verified 2026-06).
const COMPANIES = {
  Anthropic:       { board: 'greenhouse', slug: 'anthropic' },
  OpenAI:          { board: 'ashby',      slug: 'openai' },
  'Google DM':     { board: 'greenhouse', slug: 'deepmind' },
  Mistral:         { board: 'lever',      slug: 'mistral' },
  Cohere:          { board: 'ashby',      slug: 'cohere' },
  Perplexity:      { board: 'ashby',      slug: 'perplexity' },
};

const ENG_KEYWORDS = /engineer|research|scientist|ml|infra|platform|product manager|data/i;

function summarize(jobs) {
  return {
    total:       jobs.length,
    engineering: jobs.filter(j => ENG_KEYWORDS.test(j.title || '')).length,
  };
}

async function getGreenhouseJobs(slug) {
  const { data } = await axios.get(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    { timeout: 12000 }
  );
  return summarize(data.jobs || []);
}

async function getAshbyJobs(slug) {
  const { data } = await axios.get(
    `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    { timeout: 12000 }
  );
  return summarize(data.jobs || []);
}

async function getLeverJobs(slug) {
  const { data } = await axios.get(
    `https://api.lever.co/v0/postings/${slug}?mode=json`,
    { timeout: 12000 }
  );
  // Lever uses `text` for the job title
  return summarize((Array.isArray(data) ? data : []).map(j => ({ title: j.text })));
}

function fetchBoard({ board, slug }) {
  if (board === 'ashby') return getAshbyJobs(slug);
  if (board === 'lever') return getLeverJobs(slug);
  return getGreenhouseJobs(slug);
}

async function getJobsData() {
  const entries = Object.entries(COMPANIES);
  const results = await Promise.allSettled(entries.map(([, cfg]) => fetchBoard(cfg)));
  const out = {};
  entries.forEach(([name], i) => {
    out[name] = results[i].status === 'fulfilled' ? results[i].value : null;
  });
  return out;
}

module.exports = { getJobsData };
