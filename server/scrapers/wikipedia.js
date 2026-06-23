const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'signal-dashboard/1.0' } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

const ARTICLES = [
  { key: 'ChatGPT',                 display: 'ChatGPT'                 },
  { key: 'Artificial_intelligence', display: 'Artificial intelligence' },
  { key: 'Large_language_model',    display: 'Large language model'    },
  { key: 'Claude_(language_model)', display: 'Claude (language model)' },
  { key: 'Gemini_(language_model)', display: 'Gemini (language model)' },
];

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}00`;
}

async function fetchArticleViews(articleKey) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 90);
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${articleKey}/daily/${fmtDate(start)}/${fmtDate(end)}`;
  const result = await fetchJson(url);
  if (result.status !== 200 || !result.data.items) return [];
  return result.data.items.map(item => item.views ?? 0);
}

function aggregateToWeekly(daily) {
  const weeks = [];
  for (let i = 0; i + 6 < daily.length; i += 7) {
    weeks.push(daily.slice(i, i + 7).reduce((s, v) => s + v, 0));
  }
  return weeks;
}

async function getWikipediaData() {
  const results = await Promise.allSettled(ARTICLES.map(a => fetchArticleViews(a.key)));
  const articles = {};
  ARTICLES.forEach((a, i) => {
    const daily = results[i].status === 'fulfilled' ? results[i].value : [];
    articles[a.display] = aggregateToWeekly(daily);
  });
  return { articles };
}

module.exports = { getWikipediaData };
