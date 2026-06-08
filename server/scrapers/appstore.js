const store = require('app-store-scraper');

function identifyApp(app) {
  const title = (app.title || '').toLowerCase();
  const dev   = (app.developer || '').toLowerCase();
  if (dev === 'openai' || title === 'chatgpt')                          return 'ChatGPT';
  if (dev === 'anthropic' || title.startsWith('claude'))                return 'Claude';
  if (dev.includes('perplexity') || title.startsWith('perplexity'))    return 'Perplexity';
  if (dev.includes('google') && title.includes('gemini'))               return 'Gemini';
  if (dev.includes('microsoft') && (title.includes('copilot') || title.includes('bing'))) return 'Copilot';
  return null;
}

async function getAppRankings() {
  const list = await store.list({
    collection: store.collection.TOP_FREE_IOS,
    category:   store.category.PRODUCTIVITY,
    country:    'us',
    num:        100,
  });

  const rankings = {};
  const scores   = {};

  list.forEach((app, idx) => {
    const name = identifyApp(app);
    if (name && !rankings[name]) {
      rankings[name] = idx + 1;
      scores[name]   = { score: app.score ?? null, reviews: app.reviews ?? null };
    }
  });

  return { rankings, ratings: scores };
}

module.exports = { getAppRankings };
