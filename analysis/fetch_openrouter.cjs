// Fetch full daily OpenRouter per-model token rankings (dataset starts 2025-01-01),
// save raw daily rows + a weekly (ISO Mon) wide token table by provider and by model.
const fs = require('fs'), path = require('path');
const axios = require('axios');
const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'); const env = {};
for (const l of envTxt.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const KEY = env.OPENROUTER_API_KEY;
const OUT = path.join(__dirname, 'data');

const PROVIDER_NAMES = { openai:'OpenAI', anthropic:'Anthropic', google:'Google', 'meta-llama':'Meta', mistralai:'Mistral', deepseek:'DeepSeek', qwen:'Qwen', 'x-ai':'xAI', minimax:'MiniMax', thudm:'Zhipu', 'z-ai':'Zhipu', moonshotai:'Moonshot', cohere:'Cohere', amazon:'Amazon', perplexity:'Perplexity', tencent:'Tencent', xiaomi:'Xiaomi', openrouter:'OpenRouter', baidu:'Baidu', bytedance:'ByteDance', '01-ai':'01AI' };
const provOf = slug => { if (!slug || slug === 'other') return 'Other'; const p = slug.split('/')[0]; return PROVIDER_NAMES[p] ?? p; };
const fmt = d => d.toISOString().slice(0, 10);
function isoMon(dateStr) { const d = new Date(dateStr + 'T00:00:00Z'); const day = d.getUTCDay(); const diff = day === 0 ? -6 : 1 - day; const m = new Date(d); m.setUTCDate(d.getUTCDate() + diff); return m.toISOString().slice(0, 10); }

async function fetchChunk(s, e) {
  const { data } = await axios.get('https://openrouter.ai/api/v1/datasets/rankings-daily', {
    params: { start_date: s, end_date: e },
    headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': 'signal-dashboard/1.0' }, timeout: 60000,
  });
  return data.data ?? [];
}

(async () => {
  if (!KEY) { console.error('no OPENROUTER_API_KEY'); process.exit(2); }
  const today = new Date();
  const chunks = [['2025-01-01','2025-12-31'], ['2026-01-01', fmt(today)]];
  let rows = [];
  for (const [s, e] of chunks) {
    const r = await fetchChunk(s, e);
    console.log(`chunk ${s}..${e}: ${r.length} rows`);
    rows = rows.concat(r);
  }
  if (!rows.length) { console.error('no rows returned'); process.exit(3); }
  // raw daily rows (date, model_permaslug, total_tokens) — keep compact
  const raw = rows.map(r => ({ date: r.date, slug: r.model_permaslug, tok: parseInt(r.total_tokens, 10) || 0 }));
  fs.writeFileSync(path.join(OUT, 'or_daily_raw.json'), JSON.stringify(raw));

  // ----- daily totals + provider daily -----
  const days = [...new Set(raw.map(r => r.date))].sort();
  const dailyTotal = {}; const dailyProv = {};
  for (const r of raw) {
    dailyTotal[r.date] = (dailyTotal[r.date] || 0) + r.tok;
    (dailyProv[r.date] ??= {});
    const p = provOf(r.slug); dailyProv[r.date][p] = (dailyProv[r.date][p] || 0) + r.tok;
  }
  // model first-seen date (for launch-age adjustment)
  const firstSeen = {};
  for (const r of raw) { if (!firstSeen[r.slug] || r.date < firstSeen[r.slug]) firstSeen[r.slug] = r.date; }
  fs.writeFileSync(path.join(OUT, 'or_model_firstseen.json'), JSON.stringify(firstSeen));

  // ----- weekly buckets -----
  const wk = {}; // week -> {slug -> tok}
  const wkProv = {}; // week -> {prov -> tok}
  for (const r of raw) {
    const w = isoMon(r.date);
    (wk[w] ??= {}); wk[w][r.slug] = (wk[w][r.slug] || 0) + r.tok;
    (wkProv[w] ??= {}); const p = provOf(r.slug); wkProv[w][p] = (wkProv[w][p] || 0) + r.tok;
  }
  const weeks = Object.keys(wk).sort();
  // count days per week to flag partial weeks (first/last)
  const daysPerWeek = {}; for (const d of days) { const w = isoMon(d); daysPerWeek[w] = (daysPerWeek[w] || 0) + 1; }

  const provNames = [...new Set(raw.map(r => provOf(r.slug)))];
  // weekly provider wide CSV
  const totalByWeek = weeks.map(w => Object.values(wk[w]).reduce((a, b) => a + b, 0));
  const provHeader = ['monday', 'ndays', 'Total', ...provNames];
  const provLines = [provHeader.join(',')];
  weeks.forEach((w, i) => {
    const row = [w, daysPerWeek[w], totalByWeek[i], ...provNames.map(p => wkProv[w]?.[p] || 0)];
    provLines.push(row.join(','));
  });
  fs.writeFileSync(path.join(OUT, 'or_weekly_provider.csv'), provLines.join('\n') + '\n');

  // weekly per-model wide table for top-120 models by lifetime tokens (for launch-adjust + per-company)
  const life = {}; for (const r of raw) life[r.slug] = (life[r.slug] || 0) + r.tok;
  const topSlugs = Object.entries(life).filter(([s]) => s !== 'other').sort((a, b) => b[1] - a[1]).slice(0, 120).map(([s]) => s);
  const modelObj = { weeks, ndays: weeks.map(w => daysPerWeek[w]), firstSeen: {}, provider: {}, series: {} };
  for (const s of topSlugs) { modelObj.series[s] = weeks.map(w => wk[w]?.[s] || 0); modelObj.provider[s] = provOf(s); modelObj.firstSeen[s] = firstSeen[s]; }
  fs.writeFileSync(path.join(OUT, 'or_weekly_models.json'), JSON.stringify(modelObj));

  // daily total + provider for deseasonalization / event study
  fs.writeFileSync(path.join(OUT, 'or_daily_agg.json'), JSON.stringify({ days, dailyTotal, dailyProv }));

  console.log(`weeks: ${weeks[0]} .. ${weeks[weeks.length-1]} (n=${weeks.length}), full-7day weeks=${weeks.filter(w=>daysPerWeek[w]===7).length}`);
  console.log(`providers (${provNames.length}):`, provNames.join(', '));
  console.log(`top providers by lifetime tokens:`);
  const pl = {}; for (const r of raw) pl[provOf(r.slug)] = (pl[provOf(r.slug)] || 0) + r.tok;
  const g = Object.values(pl).reduce((a,b)=>a+b,0);
  Object.entries(pl).sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([p,t])=>console.log(`  ${p}: ${(100*t/g).toFixed(1)}%`));
  console.log('latest full week total tokens:', (totalByWeek[weeks.length-2]/1e12).toFixed(2)+'T');
})().catch(e => { console.error('ERR', e.response?.status, e.response?.data ? JSON.stringify(e.response.data).slice(0,300) : e.message); process.exit(1); });
