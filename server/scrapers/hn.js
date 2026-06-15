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

// Algolia's `query` param does full-text matching, not boolean OR — a query
// like '"AI" OR "LLM"' is parsed literally and matches nothing. To approximate
// "AI story volume" we sum the counts of these individual terms per week. A
// story mentioning two terms is counted twice, but as a week-over-week
// attention proxy the relative trend is what matters.
const WEEKLY_TERMS = ['LLM', 'ChatGPT', 'Claude', 'Gemini', 'AI agents'];
const PER_TERM_QUERIES = ['ChatGPT', 'Claude', 'Gemini', 'LLM', 'AI agents'];

function weekBounds(weeksAgo) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - (weeksAgo + 1) * 7 * 86400;
  const to   = now - weeksAgo * 7 * 86400;
  return { from, to };
}

async function queryCount(query, from, to) {
  const encoded = encodeURIComponent(query);
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encoded}&tags=story&numericFilters=created_at_i>${from},created_at_i<${to}&hitsPerPage=0`;
  const result = await fetchJson(url);
  if (result.status !== 200) return 0;
  return result.data.nbHits ?? 0;
}

async function getHNData() {
  // Per week: sum hits across the brand terms (Algolia has no boolean OR).
  const weeklyPromises = Array.from({ length: 8 }, async (_, i) => {
    const { from, to } = weekBounds(7 - i);
    const counts = await Promise.all(WEEKLY_TERMS.map(t => queryCount(t, from, to)));
    return counts.reduce((a, b) => a + b, 0);
  });

  const now = Math.floor(Date.now() / 1000);
  const fourWeeksAgo = now - 4 * 7 * 86400;
  const perTermPromises = PER_TERM_QUERIES.map(term =>
    queryCount(term, fourWeeksAgo, now)
  );

  const [weeklyResults, perTermResults] = await Promise.all([
    Promise.allSettled(weeklyPromises),
    Promise.allSettled(perTermPromises),
  ]);

  const weekly = weeklyResults.map(r => r.status === 'fulfilled' ? r.value : 0);
  const perTerm = {};
  PER_TERM_QUERIES.forEach((term, i) => {
    perTerm[term] = perTermResults[i].status === 'fulfilled' ? perTermResults[i].value : 0;
  });

  return { weekly, perTerm };
}

module.exports = { getHNData };
