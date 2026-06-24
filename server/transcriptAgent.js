'use strict';
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');

/**
 * Earnings-transcript sentiment agent — whole-call LLM analysis.
 *
 * Quality strategy: instead of a cheap per-sentence lexicon screener (which
 * misses metric magnitude, defensive hedging, and tone relative to the whole
 * call), the primary engine makes ONE structured pass over the ENTIRE
 * transcript. The model scores every block's tone IN CONTEXT of the full call,
 * flags tone shifts against the whole arc, and extracts the exact metric /
 * catalyst behind each shift.
 *
 * Engine auto-selection (best free quality first):
 *   1. Gemini 2.5 Flash  — when GEMINI_API_KEY / GOOGLE_API_KEY is set. Native
 *      JSON schema + 1M-token context (whole 2-hour call + history at once).
 *   2. Groq Llama-3.3-70B — 128K context, fast, free; the default here.
 *   3. Lexicon fallback  — Loughran-McDonald scorer, used only if no LLM key or
 *      the LLM call fails, so the page still renders a tone trajectory + gap.
 */

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const AV_KEY = process.env.ALPHAVANTAGE_API_KEY || process.env.ALPHA_VANTAGE_API_KEY || '';
const MAX_BLOCKS = 140;

let groqInstance = null;
function makeGroq() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');
  if (!groqInstance) groqInstance = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqInstance;
}

// ── Speaker role classification (LLM may override) ──────────────────────────
const ANALYST_RX = /\banalyst\b|research|capital|securities|equity|equities|\bbank\b|partners|brothers|asset manage|advis|\bmarkets\b|\binvest|& co\b|\bllc\b|\bgroup\b/i;
const MGMT_RX    = /\b(ceo|cfo|coo|cto|cao|chief|president|\bvp\b|vice president|director|head of|investor relations|\bir\b|treasurer|founder|chair|officer|management)\b/i;

function classifySpeaker(name) {
  const s = (name || '').toLowerCase();
  if (/\boperator\b/.test(s)) return 'Operator';
  const titlePart = (/[(\-—–]\s*([^)]*)\)?\s*$/.exec(name || '')?.[1] || s);
  if (ANALYST_RX.test(titlePart) || ANALYST_RX.test(s)) return 'Analyst';
  if (MGMT_RX.test(titlePart) || MGMT_RX.test(s)) return 'Management';
  return 'Unknown';
}

// ── Lexicon fallback (curated Loughran-McDonald subset) ─────────────────────
const POSITIVE = new Set(['record','records','growth','grow','growing','grew','strong','stronger','strongest','strength','robust','solid','exceptional','excellent','outstanding','momentum','accelerate','accelerating','tailwind','tailwinds','beat','beats','exceeded','exceed','exceeding','outperform','outperformed','improve','improved','improving','improvement','expansion','expanding','expanded','gain','gains','gaining','upside','favorable','profitable','profitability','efficient','efficiency','resilient','resilience','leadership','leading','premium','demand','all-time','highs','optimistic','confident','confidence','upbeat','thrilled','pleased','healthy','recovery','recovering','rebound','surge','surging','breakout','best','rising','rose','higher','positive']);
const NEGATIVE = new Set(['decline','declined','declining','decrease','decreased','weak','weaker','weakness','soft','softer','softness','headwind','headwinds','pressure','pressured','compression','contraction','contracting','miss','missed','misses','shortfall','downturn','slowdown','slowing','slowed','slump','drop','dropped','dropping','fell','falling','lower','plunge','plunged','slashing','slash','cut','cuts','cutting','unfavorable','volatile','volatility','uncertain','uncertainty','risk','risks','risky','concern','concerns','concerned','cautious','caution','challenging','challenges','difficult','deteriorate','deteriorating','impairment','writedown','write-down','litigation','lawsuit','recall','inventory','glut','oversupply','digestion','destocking','overhang','erosion','eroding','dilution','dilutive','underperform','underperformed','disappointing','disappoint','negative','severe','severely','worse','worst','adverse','sluggish','stagnant','layoff','layoffs','restructuring','warning','warn']);
const NEGATORS = new Set(['not','no','never','without','hardly','barely','cannot',"can't","won't","doesn't","don't",'less','lack','lacking','fails','fail','failing','unable']);
const INTENSIFIERS = new Set(['very','severely','sharply','significantly','substantially','materially','dramatically','extremely','incredibly']);

function tier1Sentiment(text) {
  const tokens = (text || '').toLowerCase().replace(/[^a-z0-9'\-\s]/g, ' ').split(/\s+/).filter(Boolean);
  let pos = 0, neg = 0;
  for (let i = 0; i < tokens.length; i++) {
    let polarity = POSITIVE.has(tokens[i]) ? 1 : NEGATIVE.has(tokens[i]) ? -1 : 0;
    if (!polarity) continue;
    let weight = 1;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (NEGATORS.has(tokens[j])) polarity *= -1;
      if (INTENSIFIERS.has(tokens[j])) weight = 1.5;
    }
    if (polarity > 0) pos += weight; else neg += weight;
  }
  const score = (pos + neg) === 0 ? 0 : Math.max(-1, Math.min(1, (pos - neg) / (pos + neg + 1.5)));
  return { score: +score.toFixed(3), label: score > 0.05 ? 'positive' : score < -0.05 ? 'negative' : 'neutral' };
}

// ── Whole-call LLM analysis ─────────────────────────────────────────────────
const ANALYST_SYSTEM =
  'You are a forensic financial analyst dissecting an earnings call. For EVERY speech block you: ' +
  '(1) assign tone_score from -1.00 (defensive/negative) to +1.00 (confident/positive), judged IN CONTEXT ' +
  'of the whole call — penalize hedging, deflection, and qualified guidance even when phrased positively, ' +
  'and reward specific, confident commitments; (2) set tone_shift=true when the block sharply departs from ' +
  'that speaker\'s prior tone or introduces a new risk; (3) name primary_catalyst — the SPECIFIC metric or ' +
  'driver (e.g. "NAND spot price -14%", "gross margin -250bps", "PC OEM build cuts") or "" if none; ' +
  '(4) list every concrete metric mentioned as numbers WITH units (%, bps, $, units, x); (5) rate severity ' +
  '0-5 for fundamental investors (0 = no concern, 5 = thesis-changing); (6) classify role as Management, ' +
  'Analyst, or Operator. Be precise, skeptical, and ground every catalyst in the actual words.';

const SCHEMA_HINT = 'Respond with ONLY a valid JSON object — no prose, no markdown, no trailing commas. EVERY string ' +
  'value (role, catalyst, each metric, summary) MUST be wrapped in double quotes. Match this exact shape:\n' +
  '{"blocks":[{"block_id":1,"role":"Analyst","tone_score":-0.70,"tone_shift":true,' +
  '"catalyst":"NAND spot price -14%, PC OEM build cuts","metrics":["-14%","250bps"],"severity":4,' +
  '"summary":"Analyst presses on margin compression from falling NAND spot prices."}]}';

function buildUserPrompt(blocks) {
  const body = blocks.map((b, i) => `[${i + 1}] (${classifySpeaker(b.speaker)}) ${b.speaker}: ${b.text}`).join('\n\n');
  return `Analyze this earnings-call transcript end to end. Return exactly one analysis object per block, ` +
    `with block_id matching the [N] markers.\n\n${body}`;
}

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    blocks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          block_id: { type: 'INTEGER' },
          role: { type: 'STRING', enum: ['Management', 'Analyst', 'Operator'] },
          tone_score: { type: 'NUMBER' },
          tone_shift: { type: 'BOOLEAN' },
          catalyst: { type: 'STRING' },
          metrics: { type: 'ARRAY', items: { type: 'STRING' } },
          severity: { type: 'INTEGER' },
          summary: { type: 'STRING' },
        },
        required: ['block_id', 'role', 'tone_score', 'tone_shift', 'severity', 'summary'],
      },
    },
  },
  required: ['blocks'],
};

async function geminiAnalyze(blocks) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: ANALYST_SYSTEM }] },
    contents: [{ parts: [{ text: buildUserPrompt(blocks) }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA },
  });
  // Retry transient 500/503 with backoff. Do NOT retry 429 here — let the
  // caller (analyzeStoredTranscripts) handle the full rate-limit wait so it
  // can pace across multiple transcripts without burning retry budget.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000), body });
    if (resp.ok) {
      const data = await resp.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      return JSON.parse(txt).blocks ?? [];
    }
    const t = (await resp.text()).slice(0, 160);
    lastErr = new Error(`Gemini HTTP ${resp.status}: ${t}`);
    // Propagate 429 immediately so the outer loop can wait the full reset window.
    if (resp.status === 429) throw lastErr;
    if ([500, 503].includes(resp.status) && attempt < 3) { await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
    throw lastErr;
  }
  throw lastErr;
}

// Two-tier path (Groq free tier ≈ 12K tokens/min, so a whole call won't fit in
// one request): the lexicon flags anomalies and we investigate ONLY those, one
// small request per block. Returns the catalyst breakdown for a single block.
const BLOCK_SCHEMA = 'Return ONLY valid JSON, every string value double-quoted: ' +
  '{"tone_shift":<bool>,"catalyst":"<specific metric/driver or empty>","metrics":["<figure with unit>"],' +
  '"severity":<int 0-5>,"summary":"<one sentence>"}';

async function investigateBlock({ block, role, score, contextLine }) {
  const groq = makeGroq();
  const text = (block.text || '').slice(0, 1600); // bound tokens for the free TPM
  const user = `Recent call tone: ${contextLine}\nSpeaker (${role}): ${block.speaker}\n` +
    `Tier-1 tone score: ${score.toFixed(2)}\nText: ${text}\n\n` +
    `Identify the specific metric/driver behind this block's tone and whether it's a shift. ${BLOCK_SCHEMA}`;
  let lastErr;
  for (const temperature of [0, 0.5]) {
    try {
      const resp = await groq.chat.completions.create({
        model: MODEL, temperature, max_tokens: 300, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: ANALYST_SYSTEM }, { role: 'user', content: user }],
      }, { timeout: 20000 });
      const p = JSON.parse(resp.choices[0]?.message?.content ?? '{}');
      return {
        tone_shift: !!p.tone_shift,
        catalyst: (typeof p.catalyst === 'string' && p.catalyst.trim()) ? p.catalyst.trim() : null,
        metrics: Array.isArray(p.metrics) ? p.metrics.filter(Boolean).slice(0, 8) : [],
        severity: Number.isFinite(p.severity) ? Math.max(0, Math.min(5, Math.round(p.severity))) : 0,
        summary: typeof p.summary === 'string' ? p.summary.trim() : '',
      };
    } catch (e) {
      lastErr = e;
      if (e?.status === 429 || e?.status === 413) throw e; // TPM/quota — stop, don't burn retries
    }
  }
  throw lastErr || new Error('investigate failed');
}

// ── Raw transcript → speech blocks ──────────────────────────────────────────
function parseTranscript(text) {
  const blocks = [];
  const speakerRx = /^\s*([A-Z][^:]{1,80}?)\s*:\s*(.*)$/;
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = speakerRx.exec(line);
    if (m && m[1].length <= 80 && /[A-Za-z]/.test(m[1]) && m[1].split(' ').length <= 9) {
      if (cur) blocks.push(cur);
      cur = { speaker: m[1].trim(), text: m[2].trim() };
    } else if (cur) {
      cur.text += (cur.text ? ' ' : '') + line.trim();
    }
  }
  if (cur) blocks.push(cur);
  return blocks.filter(b => b.text);
}

// ── Transcript source: Alpha Vantage (free, speaker-segmented + Q&A) ────────
// EARNINGS_CALL_TRANSCRIPT returns segments of {speaker, title, content,
// sentiment}. We fold title into the speaker label so classifySpeaker can tell
// Management from Analyst, giving the agent real analyst Q&A. Free tier: 25
// req/day with a key; the public `demo` key only serves IBM 2024Q1.
async function fetchTranscript(symbol, quarter) {
  const key = AV_KEY || 'demo';
  const sym = String(symbol || '').toUpperCase().replace(/[^A-Z.\-]/g, '');
  const q = String(quarter || '').toUpperCase().replace(/[^0-9Q]/g, '');
  if (!sym || !/^\d{4}Q[1-4]$/.test(q)) throw new Error('symbol and quarter (e.g. 2025Q4) are required');
  const url = `https://www.alphavantage.co/query?function=EARNINGS_CALL_TRANSCRIPT&symbol=${sym}&quarter=${q}&apikey=${key}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(25000) });
  const data = await resp.json();
  if (data.Note || data.Information) throw new Error(String(data.Note || data.Information).slice(0, 200));
  const seg = data.transcript;
  if (!Array.isArray(seg) || seg.length === 0) {
    throw new Error(AV_KEY
      ? `No Alpha Vantage transcript for ${sym} ${q} (coverage may not include this name/quarter).`
      : `No data with the demo key — only IBM 2024Q1 works without a key. Set ALPHAVANTAGE_API_KEY for ${sym}.`);
  }
  const blocks = seg.map(s => ({
    speaker: s.title ? `${s.speaker} (${s.title})` : (s.speaker || 'Speaker'),
    text: s.content || '',
    avSentiment: s.sentiment != null ? Number(s.sentiment) : null,
  }));
  return { symbol: data.symbol || sym, quarter: data.quarter || q, source: 'alphavantage', usingKey: !!AV_KEY, blocks };
}

// ── Engine ──────────────────────────────────────────────────────────────────
const MAX_INVESTIGATIONS = 10;   // cap Groq per-block calls (free TPM/RPM)
const INVESTIGATE_PACING_MS = 2500;

async function runTranscriptAgent(transcript, { anomalyThreshold = 0.3, maxInvestigations = MAX_INVESTIGATIONS, pacingMs = INVESTIGATE_PACING_MS } = {}) {
  const blocks = Array.isArray(transcript) ? transcript.slice(0, MAX_BLOCKS) : [];
  if (blocks.length === 0) return { blocks: [], summary: { blockCount: 0, engine: 'none' }, catalysts: [] };

  const lex = blocks.map(b => tier1Sentiment(b.text || ''));

  // Path A — Gemini whole-call (best quality; 1M context + constrained JSON).
  let engine = 'lexicon', llmError = null, geminiRows = [];
  if (GEMINI_KEY) {
    try {
      geminiRows = await geminiAnalyze(blocks);
      if (geminiRows.length) engine = 'gemini-2.5-flash';
      else llmError = 'Gemini returned no blocks';
    } catch (e) {
      llmError = e?.status === 429 ? 'rate-limited' : (e.message || 'Gemini error');
      console.warn('[transcript] gemini failed:', llmError);
    }
  }
  const gemById = new Map(geminiRows.map(r => [Number(r.block_id), r]));

  // Base records from Gemini (if any) else the lexicon.
  const records = blocks.map((b, i) => {
    const g = gemById.get(i + 1);
    const speaker = b.speaker || `Speaker ${i + 1}`;
    let role = g?.role || classifySpeaker(speaker);
    if (role === 'Unknown') role = 'Management';
    const score = g && Number.isFinite(g.tone_score) ? Math.max(-1, Math.min(1, +g.tone_score)) : lex[i].score;
    return {
      block_id: i + 1, speaker, role,
      finbert_score: +score.toFixed(3),
      lexicon_score: lex[i].score,
      label: score > 0.05 ? 'positive' : score < -0.05 ? 'negative' : 'neutral',
      flagged: false,
      investigated: !!g,
      tone_shift_detected: !!g?.tone_shift,
      catalyst: (typeof g?.catalyst === 'string' && g.catalyst.trim()) ? g.catalyst.trim() : null,
      severity: g && Number.isFinite(g.severity) ? Math.max(0, Math.min(5, Math.round(g.severity))) : 0,
      metrics: Array.isArray(g?.metrics) ? g.metrics.filter(Boolean).slice(0, 8) : [],
      summary: (typeof g?.summary === 'string' && g.summary.trim()) || (b.text.length > 90 ? b.text.slice(0, 90) + '…' : b.text),
      text: (b.text || '').slice(0, 1500), // verbatim script behind the block (drives "what caused the flag")
    };
  });

  // Rolling management baseline / deviation (drives flagging + display).
  const mgmtRun = [];
  for (const r of records) {
    if (r.role === 'Management') mgmtRun.push(r.finbert_score);
    const recent = mgmtRun.slice(-3);
    const baseline = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    r.baseline = +baseline.toFixed(3);
    r.deviation = +Math.abs(r.finbert_score - baseline).toFixed(3);
    r.flagged = r.tone_shift_detected || r.severity >= 3 || (r.role === 'Analyst' && r.finbert_score < -0.3) || r.deviation >= anomalyThreshold;
  }

  // Path B — Groq two-tier: a whole call exceeds Groq's free 12K-token/min cap,
  // so investigate ONLY the flagged blocks, one small paced request each.
  let investigated = geminiRows.length;
  if (engine !== 'gemini-2.5-flash' && process.env.GROQ_API_KEY) {
    // Prioritize the MOST anomalous flagged blocks (big deviation, negative
    // tone, analyst pushback) so the budget isn't spent on benign positives.
    const priority = r => r.deviation + (r.finbert_score < -0.2 ? 0.4 : 0) + (r.role === 'Analyst' && r.finbert_score < 0 ? 0.4 : 0);
    const targets = records.filter(r => r.flagged).sort((a, b) => priority(b) - priority(a)).slice(0, maxInvestigations);
    let stop = false;
    for (const r of targets) {
      if (stop) break;
      const i = r.block_id - 1;
      try {
        const ctx = records.slice(Math.max(0, i - 2), i).map(x => `${x.role} ${x.finbert_score.toFixed(1)}`).join(', ') || 'call open';
        const inv = await investigateBlock({ block: blocks[i], role: r.role, score: r.finbert_score, contextLine: ctx });
        if (inv) {
          Object.assign(r, {
            investigated: true,
            tone_shift_detected: inv.tone_shift || r.tone_shift_detected,
            catalyst: inv.catalyst, severity: inv.severity, metrics: inv.metrics,
            summary: inv.summary || r.summary,
          });
          investigated++;
          engine = 'groq-llama-3.3-70b (two-tier)';
        }
      } catch (e) {
        if (e?.status === 413 || e?.status === 429) {
          llmError = e?.status === 413 ? 'request too large (Groq 12K TPM)' : 'rate-limited';
          stop = true; // TPM/quota — stop, keep what we have
        } else {
          llmError = e?.message || 'investigate error'; // a single timeout: skip, continue
        }
        console.warn('[transcript] investigate:', llmError);
      }
      await new Promise(res => setTimeout(res, pacingMs));
    }
    if (investigated === 0) engine = 'lexicon';
  }

  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const mgmt = avg(records.filter(r => r.role === 'Management').map(r => r.finbert_score));
  const analyst = avg(records.filter(r => r.role === 'Analyst').map(r => r.finbert_score));
  const gap = mgmt != null && analyst != null ? +(mgmt - analyst).toFixed(3) : null;

  let gapState = 'Insufficient data', gapImplication = '';
  if (mgmt != null && analyst != null) {
    if (mgmt > 0.15 && analyst < -0.05) { gapState = 'High mgmt tone / low analyst tone'; gapImplication = 'High risk — analysts skeptical of execution; watch for downward revisions.'; }
    else if (mgmt > 0.1 && analyst > 0.1) { gapState = 'Aligned high tone'; gapImplication = 'Bullish continuation — fundamental breakout.'; }
    else if (mgmt < -0.05 && analyst < -0.05) { gapState = 'Aligned low tone'; gapImplication = 'Possible kitchen-sink quarter / bottoming pattern.'; }
    else { gapState = 'Mixed'; gapImplication = 'No clear management–analyst divergence.'; }
  }

  const catalysts = records.filter(r => r.catalyst).map(r => ({
    block_id: r.block_id, speaker: r.speaker, role: r.role, severity: r.severity,
    catalyst: r.catalyst, metrics: r.metrics, summary: r.summary, text: r.text,
  })).sort((a, b) => b.severity - a.severity);

  return {
    blocks: records,
    summary: {
      blockCount: records.length,
      engine, llmError,
      llmCovered: investigated,
      rateLimited: llmError === 'rate-limited',
      tier2Used: investigated,
      mgmtAvg: mgmt != null ? +mgmt.toFixed(3) : null,
      analystAvg: analyst != null ? +analyst.toFixed(3) : null,
      sentimentGap: gap,
      gapState, gapImplication,
      flaggedCount: records.filter(r => r.flagged).length,
      topSeverity: catalysts[0]?.severity ?? 0,
    },
    catalysts,
  };
}

// ── Multi-quarter series (SNDK) ─────────────────────────────────────────────
// Combines the one quarter free APIs cover (Alpha Vantage, full Q&A) with the
// older quarters' SEC EDGAR press releases (management-only) so all four can be
// analyzed and compared. EDGAR docs were pulled by scripts/fetchSndkTranscripts.
const TRANSCRIPT_DIR = path.join(__dirname, 'data', 'transcripts');

const SNDK_SERIES = [
  { label: 'FQ3 FY26', period: 'Mar 2026 qtr', date: '2026-04-30', source: 'av',    avQuarter: '2026Q1' },
  { label: 'FQ2 FY26', period: 'Dec 2025 qtr', date: '2026-01-29', source: 'edgar', file: 'sndk_2026-01-29_8k_press-release.txt' },
  { label: 'FQ1 FY26', period: 'Sep 2025 qtr', date: '2025-11-06', source: 'edgar', file: 'sndk_2025-11-06_8k_press-release.txt' },
  { label: 'FQ4 FY25', period: 'Jun 2025 qtr', date: '2025-08-14', source: 'edgar', file: 'sndk_2025-08-14_8k_press-release.txt' },
];

// Split a press release into management "blocks" (narrative paragraphs/bullets),
// dropping boilerplate so the agent scores real commentary, not legal text.
const PR_BOILER = /forward-looking|safe harbor|risks? and uncertaint|about sandisk|conference call|webcast|reconciliation|gaap to non-gaap|trademark|all rights reserved|investor relations|media contact|©|sec\.gov|condensed consolidated|unaudited|in millions|press release|exhibit 99/i;
function pressReleaseBlocks(text) {
  const parts = String(text || '').split(/\n{2,}|•|•/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const blocks = [];
  for (const p of parts) {
    if (p.length < 60 || p.length > 1600) continue;
    if (PR_BOILER.test(p)) continue;
    if (!/[a-z]/.test(p) || !/[.,%$]/.test(p)) continue;
    blocks.push({ speaker: 'Management (press release)', text: p });
    if (blocks.length >= 16) break;
  }
  return blocks;
}

async function crossNarrative(orderedOldToNew) {
  const lines = orderedOldToNew.map(q =>
    `${q.label} (${q.period}): management tone ${q.mgmtAvg ?? 'n/a'}` +
    (q.hasQA ? `, analyst ${q.analystAvg}, gap ${q.gap}` : ' (management-only)') +
    `; catalysts: ${q.topCatalysts.map(c => c.catalyst).filter(Boolean).join('; ') || 'none flagged'}`
  ).join('\n');
  const groq = makeGroq();
  const resp = await groq.chat.completions.create({
    model: MODEL, temperature: 0.2, max_tokens: 320,
    messages: [
      { role: 'system', content: 'You are an equity analyst. In 3-5 sentences, describe how management TONE and the key CATALYSTS evolved across these consecutive quarters (oldest to newest). Call out consistent improvement/deterioration, recurring themes, and the single most important inflection. Be specific; plain text, no preamble.' },
      { role: 'user', content: lines },
    ],
  }, { timeout: 20000 });
  return resp.choices[0]?.message?.content?.trim() ?? '';
}

async function analyzeSeries(symbol) {
  if (String(symbol || '').toUpperCase() !== 'SNDK') {
    throw new Error('Four-quarter series is preconfigured for SNDK (AV newest quarter + SEC EDGAR for the older three).');
  }
  const quarters = [];
  for (const q of SNDK_SERIES) {
    let blocks = null, sourceLabel = '', note = null, hasQA = false;
    if (q.source === 'av') {
      try { const t = await fetchTranscript(symbol, q.avQuarter); blocks = t.blocks; hasQA = true; sourceLabel = 'Alpha Vantage — full transcript (Q&A)'; }
      catch (e) { note = `Alpha Vantage unavailable: ${e.message}`; }
    }
    if (!blocks && q.file) {
      try { blocks = pressReleaseBlocks(fs.readFileSync(path.join(TRANSCRIPT_DIR, q.file), 'utf8')); sourceLabel = 'SEC EDGAR — earnings press release (management only)'; }
      catch (e) { note = `EDGAR file missing: ${e.message}`; }
    }
    let result = null;
    if (blocks && blocks.length) {
      result = await runTranscriptAgent(blocks, { maxInvestigations: hasQA ? 8 : 4, pacingMs: 2500 });
    }
    quarters.push({ label: q.label, period: q.period, date: q.date, source: sourceLabel, hasQA, note, result });
  }

  // Cross-quarter trend (newest first in array; reverse for the narrative).
  const trend = quarters.map(q => ({
    label: q.label, period: q.period, date: q.date, hasQA: q.hasQA,
    mgmtAvg: q.result?.summary?.mgmtAvg ?? null,
    analystAvg: q.result?.summary?.analystAvg ?? null,
    gap: q.result?.summary?.sentimentGap ?? null,
    topSeverity: q.result?.summary?.topSeverity ?? 0,
    catalystCount: q.result?.catalysts?.length ?? 0,
    topCatalysts: (q.result?.catalysts ?? []).slice(0, 4).map(c => ({ catalyst: c.catalyst, severity: c.severity, metrics: c.metrics })),
  }));
  let narrative = '';
  try { narrative = await crossNarrative([...trend].reverse()); } catch (e) { console.warn('[series] narrative failed:', e.message); }

  return { symbol: 'SNDK', quarters, cross: { trend, narrative } };
}

module.exports = { runTranscriptAgent, parseTranscript, classifySpeaker, tier1Sentiment, fetchTranscript, analyzeSeries };
