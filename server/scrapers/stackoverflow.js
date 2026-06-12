const axios = require('axios');

// Mirrors SO_TAGS in src/services/fetchers.js
const TAGS = ['openai-api', 'anthropic-claude', 'google-gemini-api', 'langchain', 'mistral-ai'];

async function getTagTotals() {
  const { data } = await axios.get(
    `https://api.stackexchange.com/2.3/tags/${TAGS.join(';')}/info`,
    { params: { site: 'stackoverflow' }, timeout: 20000 }
  );
  return Object.fromEntries((data.items ?? []).map(t => [t.name, t.count]));
}

async function getTagWeekly(tag) {
  const now  = Math.floor(Date.now() / 1000);
  const week = now - 7 * 86400;
  const { data } = await axios.get('https://api.stackexchange.com/2.3/questions', {
    params: { tagged: tag, site: 'stackoverflow', fromdate: week, todate: now, pagesize: 1, filter: 'total' },
    timeout: 20000,
  });
  return data.total ?? null;
}

async function getStackOverflowData() {
  const [totals, ...weekly] = await Promise.allSettled([
    getTagTotals(),
    ...TAGS.map(getTagWeekly),
  ]);

  return {
    totals: totals.status === 'fulfilled' ? totals.value : {},
    weekly: Object.fromEntries(
      TAGS.map((t, i) => [t, weekly[i].status === 'fulfilled' ? weekly[i].value : null])
    ),
  };
}

module.exports = { getStackOverflowData };
