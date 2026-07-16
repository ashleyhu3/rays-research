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
  { id: '3363', ticker: '3363TT', group: 'optics', exchange: 'tpex', name: '上詮'    },
  { id: '3163', ticker: '3163TT', group: 'optics', exchange: 'tpex', name: '波若威'  },
  // PCB materials / boards / substrates
  { id: '2383', ticker: '2383TT', group: 'ccl', exchange: 'twse', name: '台光電'   },
  { id: '6274', ticker: '6274TT', group: 'ccl', exchange: 'tpex', name: '台燿科技' },
  { id: '8358', ticker: '8358TT', group: 'ccl', exchange: 'tpex', name: '金居'     },
  { id: '2368', ticker: '2368TT', group: 'pcb', exchange: 'twse', name: '金像電'   },
  { id: '4958', ticker: '4958TT', group: 'pcb', exchange: 'twse', name: '臻鼎-KY'  },
  { id: '8021', ticker: '8021TT', group: 'pcb', exchange: 'twse', name: '尖點'     },
  { id: '3037', ticker: '3037TT', group: 'abf', exchange: 'twse', name: '欣興電子' },
  { id: '8046', ticker: '8046TT', group: 'abf', exchange: 'twse', name: '南電'     },
  // MLCC supply chain — multilayer ceramic capacitors for AI servers / boards
  { id: '2327', ticker: '2327TT', group: 'mlcc', exchange: 'twse', name: '國巨'   },
  { id: '2492', ticker: '2492TT', group: 'mlcc', exchange: 'twse', name: '華新科'  },
  { id: '3026', ticker: '3026TT', group: 'mlcc', exchange: 'twse', name: '禾伸堂'  },
  // Cooling supply chain — thermal solutions for AI servers (air / liquid cooling)
  { id: '3017', ticker: '3017TT', group: 'cooling', exchange: 'twse', name: '奇鋐'   },
  { id: '3653', ticker: '3653TT', group: 'cooling', exchange: 'twse', name: '健策'   },
  { id: '3324', ticker: '3324TT', group: 'cooling', exchange: 'tpex', name: '雙鴻'   },
  { id: '8996', ticker: '8996TT', group: 'cooling', exchange: 'twse', name: '高力'   },
  // Power supply chain — power supplies & power components for AI datacenters
  { id: '2308', ticker: '2308TT', group: 'power', exchange: 'twse', name: '台達電'   },
  { id: '2301', ticker: '2301TT', group: 'power', exchange: 'twse', name: '光寶科'   },
  { id: '6415', ticker: '6415TT', group: 'power', exchange: 'twse', name: '矽力-KY'  },
  { id: '3665', ticker: '3665TT', group: 'power', exchange: 'twse', name: '貿聯-KY'  },
  // Equipment supply chain — semiconductor process / test equipment
  { id: '3131', ticker: '3131TT', group: 'equipment', exchange: 'tpex',     name: '弘塑' },
  { id: '6187', ticker: '6187TT', group: 'equipment', exchange: 'tpex',     name: '萬潤' },
  { id: '2467', ticker: '2467TT', group: 'equipment', exchange: 'twse',     name: '志聖' },
  { id: '3583', ticker: '3583TT', group: 'equipment', exchange: 'twse',     name: '辛耘' },
  { id: '7769', ticker: '7769TT', group: 'equipment', exchange: 'emerging', name: '鴻勁' },
  { id: '2360', ticker: '2360TT', group: 'equipment', exchange: 'twse',     name: '致茂' },
  // Memory supply chain — DRAM / flash makers & controllers
  { id: '2408', ticker: '2408TT', group: 'memory', exchange: 'twse', name: '南亞科' },
  { id: '2337', ticker: '2337TT', group: 'memory', exchange: 'twse', name: '旺宏'   },
  { id: '8299', ticker: '8299TT', group: 'memory', exchange: 'tpex', name: '群聯'   },
  { id: '2344', ticker: '2344TT', group: 'memory', exchange: 'twse', name: '華邦電' },
  // Foundry supply chain — wafer fabrication
  { id: '2330', ticker: '2330TT', group: 'foundry', exchange: 'twse', name: '台積電'   },
  { id: '2303', ticker: '2303TT', group: 'foundry', exchange: 'twse', name: '聯電'     },
  { id: '5347', ticker: '5347TT', group: 'foundry', exchange: 'tpex', name: '世界先進' },
  // Trainium supply chain — custom AI ASIC design services
  { id: '3661', ticker: '3661TT', group: 'trainium', exchange: 'twse', name: '世芯-KY' },
  // CPU supply chain — CPU socket connectors, BMC controllers, HDI boards
  { id: '3533', ticker: '3533TT', group: 'cpu', exchange: 'twse', name: '嘉澤' },
  { id: '5274', ticker: '5274TT', group: 'cpu', exchange: 'tpex', name: '信驊' },
  { id: '3044', ticker: '3044TT', group: 'cpu', exchange: 'twse', name: '健鼎' },
  // ODM supply chain — AI server ODMs / system assemblers
  { id: '2317', ticker: '2317TT', group: 'odm', exchange: 'twse', name: '鴻海' },
  { id: '2382', ticker: '2382TT', group: 'odm', exchange: 'twse', name: '廣達' },
  { id: '3231', ticker: '3231TT', group: 'odm', exchange: 'twse', name: '緯創' },
  { id: '6669', ticker: '6669TT', group: 'odm', exchange: 'twse', name: '緯穎' },
];

function mopsUrl(coId, exchange) {
  const typek = exchange === 'twse' ? 'sii' : exchange === 'emerging' ? 'rotc' : 'otc';
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
