/** Per-view refresh wiring for pages that fetch their own dedicated
 * resource(s) instead of going through the shared DataContext/liveData pool
 * (that pool — AI Demand, Pricing, AI Supply, Macro — uses the simpler
 * DEMAND_REFRESH_KEYS path in DataContext.jsx/Topbar.jsx instead).
 *
 * `keys` are server/scheduler.js scraper keys re-scraped via POST /api/refresh.
 * `prefixes` are resourceCache URL prefixes to invalidate afterward, so the
 * page's own useResource()/fetch() picks up the fresh data on remount. */
export const VIEW_REFRESH = {
  // Rotation
  'us-performance':       { keys: ['usPerformance', 'aaiiSentiment', 'spxPutCallRatio'], prefixes: ['/api/us-performance', '/api/aaii-sentiment', '/api/spx-put-call-ratio'] },
  'hk-china-performance': { keys: ['hkChinaPerformance', 'chinaEtfPremium'], prefixes: ['/api/hk-china-performance', '/api/china-etf-premium'] },
  'hk-performance':       { keys: ['hkPerformance'], prefixes: ['/api/hk-performance'] },

  // Leverage
  'leverage-korea':      { keys: ['koreaLeverage'], prefixes: ['/api/korea-leverage'] },
  'korea-investor-flow': { keys: ['koreaInvestorFlow'], prefixes: ['/api/korea-investor-flow'] },
  'leverage-taiwan':     { keys: ['taiwanLeverage'], prefixes: ['/api/taiwan-leverage'] },
  'taiwan-individual':   { keys: ['taiwanLeverage'], prefixes: ['/api/taiwan-margin'] },
  'leverage-china':      { keys: ['chinaLeverage', 'chinaNationalTeamFlow'], prefixes: ['/api/china-leverage'] },
  'leverage-japan':      { keys: ['japanLeverage'], prefixes: ['/api/japan-leverage'] },
  'leverage-us':         { keys: ['usLeverage'], prefixes: ['/api/us-leverage'] },

  // Liquidity
  'liquidity-china-flow':  { keys: ['chinaLiquidity'], prefixes: ['/api/china-liquidity'] },
  'liquidity-us':          { keys: ['usLiquidity'], prefixes: ['/api/us-liquidity'] },
  'liquidity-carry-trade': { keys: ['carryTrade'], prefixes: ['/api/carry-trade'] },
  'liquidity-sentiment':   { keys: ['usPerformance', 'hkChinaPerformance'], prefixes: ['/api/us-performance', '/api/hk-china-performance'] },
  'liquidity-breadth':     { keys: ['indexBreadth'], prefixes: ['/api/index-breadth'] },
  'liquidity-technical':   { keys: ['globalIndices', 'goldPrice'], prefixes: ['/api/global-indices', '/api/ma-cross', '/api/ma-deviation'] },
  'liquidity-turnover':    { keys: ['globalIndices'], prefixes: ['/api/global-indices'] },
};
