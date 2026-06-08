const axios = require('axios');

const QUERIES = {
  ChatGPT:  'ChatGPT',
  Claude:   'claude anthropic',
  Gemini:   'google gemini AI',
  Mistral:  'mistral AI',
};

const UA = 'signal-dashboard/1.0 (research; no scraping; public search only)';

async function searchCount(query, period = 'week') {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=${period}&limit=100`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': UA },
    timeout: 12000,
  });
  // dist = total matches (approx), but capped at a few thousand by Reddit
  return data.data.dist ?? data.data.children.length;
}

async function getRedditData() {
  const results = await Promise.allSettled(
    Object.entries(QUERIES).map(([, q]) => searchCount(q, 'week'))
  );
  const out = {};
  Object.keys(QUERIES).forEach((name, i) => {
    out[name] = results[i].status === 'fulfilled' ? results[i].value : null;
  });
  return out;
}

module.exports = { getRedditData };
