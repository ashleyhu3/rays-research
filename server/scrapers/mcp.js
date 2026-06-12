const axios = require('axios');

// MCP (Model Context Protocol) ecosystem growth via the GitHub Search API.
// Repo search matches name, description, topics and readme, so a quoted
// phrase query is a good proxy for "repos in the MCP ecosystem".
const QUERIES = {
  'mcp server':             '"mcp server"',
  'model context protocol': '"model context protocol"',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function headers() {
  const h = { 'User-Agent': 'signal-dashboard/1.0', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  return h;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function searchCount(q) {
  const { data } = await axios.get('https://api.github.com/search/repositories', {
    params: { q, per_page: 1 },
    headers: headers(),
    timeout: 20000,
  });
  return data.total_count ?? 0;
}

async function getMcpData() {
  const results = {};
  // Sequential with spacing — unauthenticated search allows 10 requests/min
  for (const [label, phrase] of Object.entries(QUERIES)) {
    const total  = await searchCount(phrase);
    await sleep(2500);
    const new7d  = await searchCount(`${phrase} created:>${daysAgo(7)}`);
    await sleep(2500);
    const new30d = await searchCount(`${phrase} created:>${daysAgo(30)}`);
    await sleep(2500);
    results[label] = { total, new7d, new30d };
  }

  // Official reference-servers repo as an ecosystem anchor
  let serversRepo = null;
  try {
    const { data } = await axios.get('https://api.github.com/repos/modelcontextprotocol/servers', {
      headers: headers(),
      timeout: 20000,
    });
    serversRepo = { stars: data.stargazers_count ?? 0, forks: data.forks_count ?? 0 };
  } catch { /* anchor is optional */ }

  return { queries: results, serversRepo, asOf: new Date().toISOString().slice(0, 10) };
}

module.exports = { getMcpData };
