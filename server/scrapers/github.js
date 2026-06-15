const axios = require('axios');
const cheerio = require('cheerio');

const REPOS = [
  { owner: 'openai',      repo: 'openai-python',          label: 'openai/openai-python' },
  { owner: 'anthropics',  repo: 'anthropic-sdk-python',   label: 'anthropics/anthropic-sdk-python' },
  { owner: 'googleapis',  repo: 'python-genai',           label: 'googleapis/python-genai' },
  { owner: 'mistralai',   repo: 'client-python',          label: 'mistralai/client-python' },
];

const GH_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function getStars(owner, repo) {
  const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { 'User-Agent': 'signal-dashboard/1.0', Accept: 'application/vnd.github.v3+json' },
    timeout: 10000,
  });
  return data.stargazers_count ?? null;
}

async function getDependents(owner, repo) {
  const { data } = await axios.get(
    `https://github.com/${owner}/${repo}/network/dependents?dependent_type=REPOSITORY`,
    { headers: { 'User-Agent': GH_UA, Accept: 'text/html' }, timeout: 15000 }
  );
  const $ = cheerio.load(data);
  // The count appears in the tab link: "12,345\n  Repositories"
  let count = null;
  $('a[href*="/network/dependents"]').each((_, el) => {
    const txt = $(el).text().trim();
    const m = txt.replace(/\s+/g, ' ').match(/^([\d,]+)\s+Repositor/);
    if (m) count = parseInt(m[1].replace(/,/g, ''), 10);
  });
  return count;
}

async function getGitHubData() {
  const out = {};
  for (const { owner, repo, label } of REPOS) {
    const [stars, deps] = await Promise.allSettled([getStars(owner, repo), getDependents(owner, repo)]);
    out[label] = {
      stars:      stars.status === 'fulfilled' ? stars.value : null,
      dependents: deps.status  === 'fulfilled' ? deps.value  : null,
    };
    // Respect GitHub rate limits between requests
    await new Promise(r => setTimeout(r, 800));
  }
  return out;
}

module.exports = { getGitHubData };
