'use strict';

const path = require('path');
const DATA_DIR = path.join(__dirname, 'data');
const blob = (name, filename = `${name}.json`) => ({ name, file: path.join(DATA_DIR, filename) });

// Shared by the web server and one-shot collector. Initializing every scraper
// blob before a scrape prevents an empty local fallback from replacing a
// populated Mongo history with only the latest top-up window.
module.exports = [
  blob('metricsHistory'), blob('gpuHistory'), blob('dramHistory'),
  blob('nandHistory'), blob('tftLcdHistory'), blob('awsHistory'),
  blob('cpuHistory'), blob('tpuHistory'), blob('cloudGpuHistory'),
  blob('optionsOI'), blob('shortInterestHistory'),
  blob('sentimentData', 'sentiment.json'),
  blob('koreaLeverageHistory'), blob('taiwanLeverageHistory'),
  blob('chinaLeverageHistory'), blob('chinaNationalTeamFlowHistory'),
  blob('chinaLiquidityHistory'),
  blob('carryTradeHistory'),
  blob('japanLeverageHistory'), blob('usLeverageHistory'),
  blob('usPerformanceHistory'), blob('hkChinaPerformanceHistory'),
  blob('hkPerformanceHistory'), blob('chinaEtfPremiumHistory'),
  blob('dailyOptionsReport'), blob('optionsPriorYearVolume'),
  blob('earningsDates'), blob('techEarningsCalendar'), blob('latestSnapshots'),
];
