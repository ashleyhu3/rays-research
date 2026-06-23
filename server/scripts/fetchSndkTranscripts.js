/**
 * Pull SanDisk (SNDK) earnings-related qualitative text for the last N quarters
 * from SEC EDGAR — the free, reliable, no-bot-detection path.
 *
 * NOTE: verbatim earnings-CALL transcripts (with analyst Q&A) are NOT filed with
 * the SEC — those live behind Seeking Alpha (Cloudflare) or paid APIs (FMP /
 * Polygon). What EDGAR DOES give for free, per quarter:
 *   • 8-K Item 2.02 → EX-99.1 earnings press release (management commentary +
 *     CEO/CFO quotes + outlook), filed the day of the call.
 *   • 10-Q Item 2  → MD&A (Management's Discussion & Analysis) narrative.
 * Both are management-only (no analyst Q&A), which is the documented free
 * substitute. This script pulls both for the last 4 quarters and saves clean
 * text under server/data/transcripts/.
 *
 * Usage: node server/scripts/fetchSndkTranscripts.js [quarters=4]
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const UA = 'signal-dashboard/1.0 research contact: ashley_hu1@brown.edu';
const CIK_PAD = '0002023554';   // SanDisk Corp
const CIK_NUM = '2023554';
const QUARTERS = Math.max(1, parseInt(process.argv[2], 10) || 4);
const OUT = path.join(__dirname, '..', 'data', 'transcripts');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, json = false) {
  const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 25000, responseType: json ? 'json' : 'text' });
  return data;
}

// Strip an EDGAR HTML exhibit to clean narrative text (drop tables = financial
// statements, keep the management commentary paragraphs).
function htmlToText(html, { dropTables = true } = {}) {
  const $ = cheerio.load(html);
  $('script, style, ix\\:header').remove();
  if (dropTables) $('table').remove();
  return $('body').text()
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n').map(l => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function filingFiles(accession) {
  const accNo = accession.replace(/-/g, '');
  const idx = await get(`https://www.sec.gov/Archives/edgar/data/${CIK_NUM}/${accNo}/index.json`, true);
  return { accNo, files: (idx.directory?.item ?? []).map(f => f.name) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sub = await get(`https://data.sec.gov/submissions/CIK${CIK_PAD}.json`, true);
  const r = sub.filings.recent;

  const earnings8k = [];
  const tenQ = [];
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === '8-K' && (r.items[i] || '').includes('2.02')) earnings8k.push({ date: r.filingDate[i], acc: r.accessionNumber[i] });
    if (r.form[i] === '10-Q' || r.form[i] === '10-K') tenQ.push({ date: r.filingDate[i], acc: r.accessionNumber[i], form: r.form[i], doc: r.primaryDocument[i] });
  }

  const last = earnings8k.slice(0, QUARTERS);
  console.log(`[sndk] ${sub.name} — pulling last ${last.length} earnings 8-Ks + matching MD&A\n`);
  const manifest = [];

  for (const e of last) {
    // 1) 8-K EX-99.1 earnings press release
    try {
      const { accNo, files } = await filingFiles(e.acc);
      let ex = files.find(f => /\.htm$/i.test(f) && /(ex.?99.*1|ex991|press.?rel)/i.test(f))
            || files.find(f => /\.htm$/i.test(f) && /ex.?99/i.test(f));
      if (ex) {
        const html = await get(`https://www.sec.gov/Archives/edgar/data/${CIK_NUM}/${accNo}/${ex}`);
        const text = htmlToText(html);
        const file = path.join(OUT, `sndk_${e.date}_8k_press-release.txt`);
        fs.writeFileSync(file, text);
        manifest.push({ date: e.date, type: '8-K EX-99.1 (press release)', doc: ex, chars: text.length, file: path.basename(file) });
        console.log(`8-K  ${e.date}  ${ex}  → ${(text.length / 1024).toFixed(1)}KB`);
      } else {
        console.warn(`8-K  ${e.date}  no EX-99.1 found (${files.join(', ')})`);
      }
    } catch (err) { console.warn(`8-K  ${e.date}  failed: ${err.message}`); }
    await sleep(400);

    // 2) matching 10-Q/10-K MD&A — the NEAREST periodic filing on/after the 8-K
    // (the 10-Q is filed a few days after the earnings call), else nearest before.
    const after = tenQ.filter(q => q.date >= e.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    const before = tenQ.filter(q => q.date < e.date).sort((a, b) => b.date.localeCompare(a.date))[0];
    const periodic = after || before;
    if (periodic && periodic.doc) {
      try {
        const accNo = periodic.acc.replace(/-/g, '');
        const html = await get(`https://www.sec.gov/Archives/edgar/data/${CIK_NUM}/${accNo}/${periodic.doc}`);
        let text = htmlToText(html, { dropTables: true });
        // Slice out the MD&A section (Item 2) when present, else keep full text.
        const mdaStart = text.search(/management['’]s discussion and analysis/i);
        const qRisk = text.search(/quantitative and qualitative disclosures about market risk/i);
        if (mdaStart > -1) text = text.slice(mdaStart, qRisk > mdaStart ? qRisk : undefined).trim();
        const file = path.join(OUT, `sndk_${periodic.date}_${periodic.form}_mdna.txt`);
        fs.writeFileSync(file, text);
        manifest.push({ date: periodic.date, type: `${periodic.form} MD&A (Item 2)`, doc: periodic.doc, chars: text.length, file: path.basename(file) });
        console.log(`${periodic.form} ${periodic.date}  ${periodic.doc}  → MD&A ${(text.length / 1024).toFixed(1)}KB`);
      } catch (err) { console.warn(`10-Q ${periodic.date}  failed: ${err.message}`); }
    }
    await sleep(400);
  }

  fs.writeFileSync(path.join(OUT, 'sndk_manifest.json'), JSON.stringify({ entity: sub.name, cik: CIK_NUM, pulledAt: new Date().toISOString(), documents: manifest }, null, 2));
  console.log(`\n[sndk] saved ${manifest.length} documents → ${OUT}`);
}

main().catch(e => { console.error('[sndk] fatal:', e.message); process.exit(1); });
