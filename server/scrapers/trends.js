const googleTrends = require('google-trends-api');

const API_KEYWORDS = ['Claude API', 'ChatGPT API', 'Gemini API', 'Mistral API'];
const BRAND_KEYWORDS = ['Claude', 'ChatGPT'];
const DAYS = 84;

function parseTimeline(jsonStr, keyMap) {
  const data = JSON.parse(jsonStr);
  const timeline = data.default?.timelineData ?? [];
  const out = Object.fromEntries(Object.values(keyMap).map(k => [k, []]));
  timeline.forEach(point => {
    Object.keys(keyMap).forEach((_, i) => {
      out[Object.values(keyMap)[i]].push(point.value[i] ?? 0);
    });
  });
  // Pad / trim to exactly DAYS
  Object.keys(out).forEach(k => {
    const arr = out[k];
    if (arr.length >= DAYS) {
      out[k] = arr.slice(-DAYS);
    } else {
      out[k] = [...Array(DAYS - arr.length).fill(0), ...arr];
    }
  });
  return out;
}

async function getGeoData() {
  try {
    const result = await googleTrends.interestByRegion({
      keyword: 'Claude API',
      resolution: 'CITY',
      geo: 'US',
      startTime: new Date(Date.now() - 30 * 86400000),
      endTime: new Date(),
    });
    const data = JSON.parse(result);
    return (data.default?.geoMapData ?? [])
      .filter(r => r.value[0] > 0)
      .sort((a, b) => b.value[0] - a.value[0])
      .slice(0, 8)
      .map(r => ({ label: r.geoName, value: r.value[0] }));
  } catch {
    return [];
  }
}

async function getTrendsData() {
  const startTime = new Date(Date.now() - DAYS * 86400000);
  const endTime = new Date();

  const [apiResult, brandResult] = await Promise.all([
    googleTrends.interestOverTime({ keyword: API_KEYWORDS, startTime, endTime, geo: 'US' }),
    googleTrends.interestOverTime({ keyword: BRAND_KEYWORDS, startTime, endTime, geo: 'US' }),
  ]);

  const api = parseTimeline(apiResult, {
    0: 'claude', 1: 'chatgpt', 2: 'gemini', 3: 'mistral',
  });
  const brand = parseTimeline(brandResult, { 0: 'claude', 1: 'chatgpt' });
  const geo = await getGeoData();

  return { api, brand, geo };
}

module.exports = { getTrendsData };
