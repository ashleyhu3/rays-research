'use strict';

// Taiwan AI supply chain monthly revenue via FinMind open data API.
// FinMind covers TWSE and TPEX companies and allows anonymous access
// (300 req/hr). Set FINMIND_TOKEN env var for 600 req/hr.
//
// API docs: https://finmindtrade.com/analysis/#/data/document
// Dataset:  TaiwanStockMonthRevenue
// Response revenue unit: NT$ (raw) → divide by 1,000,000 for NT$M

const TOKEN = process.env.FINMIND_TOKEN || '';

const ALL_COMPANIES = [
  // Fiber supply chain — fiber-optic components for AI networking
  { id: '6442', ticker: '6442TT', group: 'fiber', exchange: 'twse', name: '光聖'    },
  // Optics supply chain — optical components for AI networking (800G+ transceivers)
  { id: '3081', ticker: '3081TT', group: 'optics', exchange: 'tpex', name: '聯亞光電' },
  { id: '3363', ticker: '3363TT', group: 'optics', exchange: 'tpex', name: '品興'    },
  { id: '3163', ticker: '3163TT', group: 'optics', exchange: 'tpex', name: '波若威'  },
  // CCL supply chain — copper-clad laminates for AI server boards
  { id: '2383', ticker: '2383TT', group: 'ccl', exchange: 'twse', name: '台光電'   },
  { id: '6274', ticker: '6274TT', group: 'ccl', exchange: 'tpex', name: '台燿科技' },
  { id: '8358', ticker: '8358TT', group: 'ccl', exchange: 'tpex', name: '金像電子' },
  // PCB supply chain — boards and drilling for AI servers
  { id: '2368', ticker: '2368TT', group: 'pcb', exchange: 'twse', name: '金像電'   },
  { id: '4958', ticker: '4958TT', group: 'pcb', exchange: 'twse', name: '臻鼎-KY'  },
  { id: '8021', ticker: '8021TT', group: 'pcb', exchange: 'twse', name: '尖點'     },
  // ABF substrate supply chain
  { id: '3037', ticker: '3037TT', group: 'abf', exchange: 'twse', name: '欣興電子' },
  { id: '8046', ticker: '8046TT', group: 'abf', exchange: 'twse', name: '南電'     },
  // MLCC supply chain — multilayer ceramic capacitors for AI servers / boards
  { id: '2327', ticker: '2327TT', group: 'mlcc', exchange: 'twse', name: '國巨'   },
  { id: '2492', ticker: '2492TT', group: 'mlcc', exchange: 'twse', name: '華新科'  },
  { id: '3026', ticker: '3026TT', group: 'mlcc', exchange: 'twse', name: '禾伸堂'  },
];

function mopsUrl(coId, exchange) {
  const typek = exchange === 'twse' ? 'sii' : 'otc';
  return `https://mops.twse.com.tw/mops/web/t05st10_ifrs?co_id=${coId}&TYPEK=${typek}&isnew=false`;
}

async function fetchCompany(id) {
  // Fetch ~2.5 years so we always have a full year of prior data for YoY
  const start = '2023-01-01';
  let url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=${id}&start_date=${start}`;
  if (TOKEN) url += `&token=${TOKEN}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 200) throw new Error(json.msg || 'FinMind error');
  return json.data ?? [];
}

function buildSeries(rows) {
  // Index by "YYYY/MM" for YoY lookup
  const byPeriod = {};
  rows.forEach(r => {
    const key = `${r.revenue_year}/${String(r.revenue_month).padStart(2, '0')}`;
    byPeriod[key] = r.revenue;
  });

  return rows.map(r => {
    const period = `${r.revenue_year}/${String(r.revenue_month).padStart(2, '0')}`;
    const rev    = r.revenue;

    const priorYoyKey = `${r.revenue_year - 1}/${String(r.revenue_month).padStart(2, '0')}`;
    const priorYoy    = byPeriod[priorYoyKey];
    const yoy = priorYoy > 0 ? parseFloat(((rev - priorYoy) / priorYoy * 100).toFixed(2)) : null;

    const prevMonth  = r.revenue_month === 1 ? 12 : r.revenue_month - 1;
    const prevYear   = r.revenue_month === 1 ? r.revenue_year - 1 : r.revenue_year;
    const priorMomKey = `${prevYear}/${String(prevMonth).padStart(2, '0')}`;
    const priorMom   = byPeriod[priorMomKey];
    const mom = priorMom > 0 ? parseFloat(((rev - priorMom) / priorMom * 100).toFixed(2)) : null;

    return {
      period,
      revenue: parseFloat((rev / 1e6).toFixed(2)), // NT$ → NT$M
      yoy,
      mom,
    };
  }).sort((a, b) => a.period.localeCompare(b.period));
}

async function getMopsRevenue() {
  const results = await Promise.allSettled(ALL_COMPANIES.map(c => fetchCompany(c.id)));

  const companies = {};
  let withData = 0;
  ALL_COMPANIES.forEach((c, i) => {
    const rows = results[i].status === 'fulfilled' ? results[i].value : [];
    if (results[i].status === 'rejected') {
      console.warn(`[mops] ${c.id}: ${results[i].reason?.message}`);
    }
    const monthly = buildSeries(rows);
    if (monthly.length > 0) withData += 1;
    companies[c.id] = {
      ...c,
      srcUrl:  mopsUrl(c.id, c.exchange),
      monthly,
    };
  });

  // Every company came back empty — almost always FinMind rate-limiting the
  // shared Render egress IP (anonymous access is 300 req/hr per IP; set
  // FINMIND_TOKEN to lift it). Throw instead of returning an all-empty payload
  // so cachedRoute keeps the last good snapshot rather than persisting empties
  // and silently blanking the supply-chain charts until the next restart.
  if (withData === 0) {
    throw new Error('FinMind returned no data for any company (likely rate-limited; set FINMIND_TOKEN)');
  }

  return { companies };
}

module.exports = { getMopsRevenue, ALL_COMPANIES };
