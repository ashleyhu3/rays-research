const https = require('https');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchXml(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'signal-dashboard/1.0' }, timeout: timeoutMs }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    // Without this a stalled socket never settles the promise and wedges the whole refresh
    req.on('timeout', () => req.destroy(new Error('arxiv request timed out')));
    req.on('error', reject);
  });
}

function parseTotal(xml) {
  const m = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
  return m ? parseInt(m[1], 10) : 0;
}

const COMBINED_QUERY = 'cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.CV';
const CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV'];

function padTwo(n) { return String(n).padStart(2, '0'); }

function monthRange(year, month) {
  const from = `${year}${padTwo(month)}01000000`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const to = `${year}${padTwo(month)}${padTwo(daysInMonth)}235959`;
  return { from, to };
}

async function queryCount(searchQuery, from, to) {
  const url = `https://export.arxiv.org/api/query?search_query=${searchQuery}+AND+submittedDate:[${from}+TO+${to}]&max_results=1`;
  const xml = await fetchXml(url);
  return parseTotal(xml);
}

async function getArxivData() {
  const now = new Date();
  const monthly = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const { from, to } = monthRange(year, month);

    if (i < 11) await sleep(3500);

    let count = 0;
    try {
      count = await queryCount(COMBINED_QUERY, from, to);
    } catch (e) {
      count = 0;
    }

    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    monthly.push({ period: label, count });
  }

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const { from: cFrom, to: cTo } = monthRange(currentYear, currentMonth);

  const currentMonth_data = {};
  for (const cat of CATEGORIES) {
    await sleep(3500);
    try {
      const catQuery = `cat:${cat}`;
      currentMonth_data[cat] = await queryCount(catQuery, cFrom, cTo);
    } catch (e) {
      currentMonth_data[cat] = 0;
    }
  }

  return { monthly, currentMonth: currentMonth_data };
}

module.exports = { getArxivData };
