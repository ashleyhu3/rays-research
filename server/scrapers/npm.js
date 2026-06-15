const axios = require('axios');

// Mirrors NPM_PKGS in src/services/fetchers.js so the Ask tab sees the same
// packages the dashboard charts.
const PKGS = [
  'openai',
  'anthropic',
  'mistralai',
  '@anthropic-ai/sdk',
  '@google/genai',
  'langchain',
  '@langchain/core',
  'llamaindex',
  'ai',
  '@huggingface/inference',
];
const WEEKS = 52;

async function getPkgHistory(pkg) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 365);
  const fmt = d => d.toISOString().slice(0, 10);

  const { data } = await axios.get(
    `https://api.npmjs.org/downloads/range/${fmt(start)}:${fmt(end)}/${encodeURIComponent(pkg)}`,
    { timeout: 20000 }
  );

  const days = data.downloads ?? [];
  const weeks = [];
  for (let i = 0; i + 6 < days.length; i += 7)
    weeks.push(days.slice(i, i + 7).reduce((s, d) => s + d.downloads, 0));

  return weeks.slice(-WEEKS);
}

async function getNpmHistory() {
  const results = await Promise.allSettled(PKGS.map(getPkgHistory));
  return Object.fromEntries(
    PKGS.map((p, i) => [p, results[i].status === 'fulfilled' ? results[i].value : []])
  );
}

module.exports = { getNpmHistory };
