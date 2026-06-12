const axios = require('axios');

const PKGS = ['openai', 'anthropic', 'google-generativeai', 'mistralai', 'langchain', 'langchain-community', 'llama-index-core', 'vllm'];
const WEEKS = 52;

async function getPkgHistory(pkg) {
  const { data } = await axios.get(
    `https://pypistats.org/api/packages/${pkg}/overall?mirrors=false`,
    { timeout: 20000 }
  );

  const oneYearAgo = Date.now() - 365 * 86400000;
  const days = (data.data || [])
    .filter(d => d.category === 'without_mirrors' && new Date(d.date).getTime() >= oneYearAgo)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Aggregate into full weeks of 7 days
  const weeks = [];
  for (let i = 0; i + 6 < days.length; i += 7)
    weeks.push(days.slice(i, i + 7).reduce((s, d) => s + d.downloads, 0));

  return weeks.slice(-WEEKS);
}

async function getPypiHistory() {
  const results = await Promise.allSettled(PKGS.map(getPkgHistory));
  return Object.fromEntries(
    PKGS.map((p, i) => [p, results[i].status === 'fulfilled' ? results[i].value : []])
  );
}

module.exports = { getPypiHistory };
