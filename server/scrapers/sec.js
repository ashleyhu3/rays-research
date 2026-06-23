const axios = require('axios');

// SEC EDGAR full-text search (efts.sec.gov) — counts filings mentioning AI
// terms in the trailing 90 days vs the prior 90 days. Free; SEC requires a
// descriptive User-Agent with contact info.
const TERMS = [
  'artificial intelligence',
  'large language model',
  'generative AI',
  'AI agent',
];

const UA = 'signal-dashboard/1.0 research contact: ashley_hu1@brown.edu';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function countFilings(term, startdt, enddt) {
  const { data } = await axios.get('https://efts.sec.gov/LATEST/search-index', {
    // 10-K/10-Q only: keeps broad terms like "artificial intelligence" under
    // the 10,000-hit cap and measures company disclosures, not boilerplate 8-Ks
    params: { q: `"${term}"`, forms: '10-K,10-Q', dateRange: 'custom', startdt, enddt },
    headers: { 'User-Agent': UA },
    timeout: 20000,
  });
  // value caps at 10000 ("relation":"gte") — still useful as a floor
  return {
    count:  data?.hits?.total?.value ?? 0,
    capped: data?.hits?.total?.relation === 'gte',
  };
}

async function getSecData() {
  const today = isoDaysAgo(0);
  const d90   = isoDaysAgo(90);
  const d180  = isoDaysAgo(180);

  const withRetry = async (...args) => {
    try { return await countFilings(...args); }
    catch { await sleep(2000); return countFilings(...args); }
  };

  const terms = {};
  for (const term of TERMS) {
    try {
      const current = await withRetry(term, d90, today);
      await sleep(1000); // EDGAR intermittently 500s under bursts; pace gently
      const prior   = await withRetry(term, d180, d90);
      await sleep(1000);
      terms[term] = {
        last90d:  current.count,
        prior90d: prior.count,
        capped:   current.capped || prior.capped,
      };
    } catch (e) {
      console.warn(`[sec] "${term}" failed:`, e.message);
      terms[term] = null;
    }
  }

  if (Object.values(terms).every(v => v == null)) return null;
  return { terms, windows: { current: [d90, today], prior: [d180, d90] }, asOf: today };
}

module.exports = { getSecData };
