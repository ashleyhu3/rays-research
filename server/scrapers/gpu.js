const axios = require('axios');
const cheerio = require('cheerio');

// vast.ai public bundle API (no auth required for read-only spot prices)
async function getVastPrices() {
  const q = JSON.stringify({
    verified:  { eq: true },
    external:  { eq: false },
    rentable:  { eq: true },
    rented:    { eq: false },
    num_gpus:  { eq: 1 },
    gpu_name:  { in: ['H100_SXM4', 'H100_PCIE', 'H200_SXM5', 'A100_SXM4', 'RTX_4090'] },
  });
  const { data } = await axios.get(
    `https://console.vast.ai/api/v0/bundles/?q=${encodeURIComponent(q)}`,
    { timeout: 15000 }
  );

  const byGpu = {};
  (data.offers || []).forEach(o => {
    const g = o.gpu_name;
    if (!byGpu[g]) byGpu[g] = [];
    byGpu[g].push(o.dph_total);
  });

  const out = {};
  Object.entries(byGpu).forEach(([gpu, prices]) => {
    prices.sort((a, b) => a - b);
    out[gpu] = parseFloat(prices[Math.floor(prices.length / 2)].toFixed(2));
  });
  return out;
}

// Lambda Labs public pricing page scrape (fallback / additional data)
async function getLambdaPrices() {
  const { data } = await axios.get('https://lambdalabs.com/service/gpu-cloud', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; signal-dashboard/1.0)' },
    timeout: 15000,
  });
  const $ = cheerio.load(data);
  const prices = {};

  $('table tr, [data-gpu], .gpu-card').each((_, el) => {
    const text = $(el).text();
    const gpuMatch = text.match(/H100|H200|A100|B200|A10/i);
    const priceMatch = text.match(/\$\s*([\d.]+)\s*\/\s*hr/i);
    if (gpuMatch && priceMatch) {
      const gpu = gpuMatch[0].toUpperCase();
      prices[gpu] = parseFloat(priceMatch[1]);
    }
  });
  return prices;
}

async function getGpuPrices() {
  const [vast, lambda] = await Promise.allSettled([getVastPrices(), getLambdaPrices()]);
  const result = {};

  // Merge: Lambda prices take precedence for named H100/H200; vast.ai fills the rest
  if (vast.status === 'fulfilled') Object.assign(result, vast.value);
  if (lambda.status === 'fulfilled') {
    Object.entries(lambda.value).forEach(([k, v]) => {
      if (!result[k]) result[k] = v;
    });
  }

  return Object.keys(result).length > 0 ? result : null;
}

module.exports = { getGpuPrices };
