'use strict';

/**
 * LLM pass that turns metric-bearing facts into structured "key figures":
 *   • Tight binding — only figures genuinely ABOUT a focus keyword are kept
 *     (incidental numbers are dropped, not force-attached by regex).
 *   • Change-aware — each figure is normalized to prior → current with a
 *     direction (up / down / flat), a change type, and a delta where stated,
 *     so "CapEx from $175–185B to $180–190B" reads as a single raised guide,
 *     not four loose numbers.
 *
 * Writes enrichment.keyFigures and re-saves the processed transcript.
 *
 * Usage:
 *   node --env-file=.env server/scripts/extractKeyFigures.js
 *   node --env-file=.env server/scripts/extractKeyFigures.js --ticker GOOGL --force
 */

const fs = require('fs');
const axios = require('axios');
const { enrichmentPath, listLocalEnrichments } = require('../transcripts/enrichmentStore');

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const FORCE = process.argv.includes('--force');
const TICKER = (() => {
  const index = process.argv.indexOf('--ticker');
  return index !== -1 ? (process.argv[index + 1] || '').toUpperCase() : null;
})();
const BATCH_SIZE = 10;
const PACING_MS = GEMINI_KEY ? 4500 : 1800;

const FOCUS_TOPICS = [
  'CapEx', 'CapEx Guidance', 'Cloud Growth', 'Cloud Guidance', 'AI Revenue', 'AI Guidance',
];
const CHANGE_TYPES = ['raised', 'lowered', 'reaffirmed', 'increase', 'decrease', 'level', 'range'];
const DIRECTIONS = ['up', 'down', 'flat'];
const UNITS = ['usd', 'percent', 'multiple', 'power', 'count', 'time', 'other'];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function promptFor(candidates) {
  const records = candidates.map(fact => ({
    id: fact.id,
    topics: fact.focusTopics,
    statement: fact.statement.slice(0, 700),
  }));
  return [
    'You extract quantified financial figures from earnings-call statements.',
    `Only extract a figure when the number is genuinely ABOUT one of these topics: ${FOCUS_TOPICS.join(', ')}.`,
    'Ignore incidental numbers (dates, phone-book stats, unrelated counts). If a statement has no figure about those topics, omit its id entirely.',
    'Represent each figure as a CHANGE whenever the statement implies one:',
    '- current: the current/new value, compact (e.g. "$180–190B", "63%", "$20B", "9x").',
    '- prior: the previous value if the statement gives one (e.g. "$175–185B"), else null.',
    '- delta: short magnitude of the change if determinable (e.g. "+$5B midpoint", "+63% YoY", "tripled"), else null.',
    '- changeType: raised/lowered/reaffirmed for guidance revisions; increase/decrease for reported growth or decline; level for a single stated value; range for a stated range with no prior.',
    '- direction: up if the figure grew/was raised, down if it fell/was cut, flat if reaffirmed/unchanged.',
    '- label: <=6 words naming what the figure measures (e.g. "FY2026 CapEx guidance", "Cloud revenue growth").',
    '- keyword: the single best-matching topic from the list.',
    '- unit: usd | percent | multiple | power | count | time | other.',
    '- period: the fiscal period the figure refers to (e.g. "FY2026", "Q1 2026") or null.',
    '- forwardLooking: true if it is guidance/outlook, else false.',
    'Return every id at most once; pick the most important figure if a statement has several.',
    JSON.stringify(records),
  ].join('\n');
}

function normalizeRows(rows, candidates, model) {
  const byId = new Map(candidates.map(fact => [fact.id, fact]));
  return (Array.isArray(rows) ? rows : [])
    .filter(row => byId.has(row?.id)
      && FOCUS_TOPICS.includes(row?.keyword)
      && String(row?.current || '').trim())
    .map(row => {
      const fact = byId.get(row.id);
      const direction = DIRECTIONS.includes(row.direction) ? row.direction : 'flat';
      return {
        id: row.id,
        chunkId: fact.chunkId,
        keyword: row.keyword,
        label: String(row.label || row.keyword).slice(0, 80),
        changeType: CHANGE_TYPES.includes(row.changeType) ? row.changeType : 'level',
        direction,
        current: String(row.current).slice(0, 60),
        prior: row.prior ? String(row.prior).slice(0, 60) : null,
        delta: row.delta ? String(row.delta).slice(0, 60) : null,
        unit: UNITS.includes(row.unit) ? row.unit : 'other',
        period: row.period ? String(row.period).slice(0, 24) : null,
        forwardLooking: Boolean(row.forwardLooking),
        statement: fact.statement,
        speaker: fact.speaker || null,
        section: fact.section || null,
        sentiment: fact.sentiment
          ? { label: fact.sentiment.label, investorConfidence: fact.sentiment.investorConfidence }
          : null,
        model,
        analyzedAt: new Date().toISOString(),
      };
    });
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      keyword: { type: 'STRING', enum: FOCUS_TOPICS },
      label: { type: 'STRING' },
      changeType: { type: 'STRING', enum: CHANGE_TYPES },
      direction: { type: 'STRING', enum: DIRECTIONS },
      current: { type: 'STRING' },
      prior: { type: 'STRING', nullable: true },
      delta: { type: 'STRING', nullable: true },
      unit: { type: 'STRING', enum: UNITS },
      period: { type: 'STRING', nullable: true },
      forwardLooking: { type: 'BOOLEAN' },
    },
    required: ['id', 'keyword', 'label', 'changeType', 'direction', 'current', 'unit', 'forwardLooking'],
  },
};

async function geminiExtract(candidates) {
  if (!GEMINI_KEY) throw new Error('Gemini key unavailable');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptFor(candidates) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  return normalizeRows(JSON.parse(text), candidates, `gemini:${GEMINI_MODEL}`);
}

async function groqExtract(candidates) {
  if (!process.env.GROQ_API_KEY) throw new Error('Groq key unavailable');
  const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: GROQ_MODEL,
    temperature: 0,
    max_tokens: 2400,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return only JSON shaped as {"rows":[{"id":"...","keyword":"...","label":"...","changeType":"...","direction":"...","current":"...","prior":null,"delta":null,"unit":"...","period":null,"forwardLooking":true}]}.' },
      { role: 'user', content: promptFor(candidates) },
    ],
  }, {
    timeout: 90000,
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
  });
  const payload = JSON.parse(response.data?.choices?.[0]?.message?.content || '{"rows":[]}');
  return normalizeRows(payload.rows, candidates, `groq:${GROQ_MODEL}`);
}

async function extract(candidates) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await geminiExtract(candidates);
    } catch (geminiError) {
      lastError = geminiError;
      console.warn(`[figures] Gemini failed (attempt ${attempt}): ${geminiError.message}`);
    }
    try {
      return await groqExtract(candidates);
    } catch (groqError) {
      lastError = groqError;
      console.warn(`[figures] Groq failed (attempt ${attempt}): ${groqError.message}`);
    }
    if (attempt < 4) await wait(Math.min(2000 * (2 ** (attempt - 1)), 12000));
  }
  throw lastError || new Error('No LLM provider succeeded.');
}

function candidatesFrom(enrichment) {
  const seen = new Set();
  return (enrichment.facts || [])
    .filter(fact => fact.metrics?.length && fact.topics?.some(topic => FOCUS_TOPICS.includes(topic)))
    .map(fact => ({ ...fact, focusTopics: fact.topics.filter(topic => FOCUS_TOPICS.includes(topic)) }))
    .filter(fact => {
      const key = fact.statement.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function main() {
  if (!GEMINI_KEY && !process.env.GROQ_API_KEY) {
    throw new Error('Set GEMINI_API_KEY or GROQ_API_KEY.');
  }

  const enrichments = (await listLocalEnrichments())
    .filter(item => !TICKER || String(item.ticker || '').toUpperCase() === TICKER)
    .sort((a, b) => `${a.ticker}:${a.fiscal_period}`.localeCompare(`${b.ticker}:${b.fiscal_period}`));

  let totalFigures = 0;
  for (const enrichment of enrichments) {
    if (!FORCE && Array.isArray(enrichment.keyFigures) && enrichment.keyFigures.length) {
      console.log(`[figures] ${enrichment.ticker}:${enrichment.fiscal_period} already extracted (${enrichment.keyFigures.length}) — skipping`);
      continue;
    }
    const candidates = candidatesFrom(enrichment);
    const figures = [];
    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE);
      figures.push(...await extract(batch));
      console.log(`[figures] ${enrichment.ticker}:${enrichment.fiscal_period} ${Math.min(start + batch.length, candidates.length)}/${candidates.length}`);
      if (start + BATCH_SIZE < candidates.length) await wait(PACING_MS);
    }

    enrichment.keyFigures = figures;
    enrichment.keyFigureSummary = {
      total: figures.length,
      guidance: figures.filter(figure => figure.forwardLooking).length,
      raised: figures.filter(figure => figure.direction === 'up').length,
      lowered: figures.filter(figure => figure.direction === 'down').length,
      byKeyword: FOCUS_TOPICS.map(keyword => ({
        keyword,
        count: figures.filter(figure => figure.keyword === keyword).length,
      })),
      model: figures[0]?.model || null,
    };
    enrichment.keyFiguresAnalyzedAt = new Date().toISOString();
    fs.writeFileSync(
      enrichmentPath(enrichment.ticker, enrichment.fiscal_period),
      `${JSON.stringify(enrichment, null, 2)}\n`,
    );
    totalFigures += figures.length;
    console.log(`[figures] ${enrichment.ticker}:${enrichment.fiscal_period} → ${figures.length} key figures`);
  }
  console.log(`[figures] complete: ${enrichments.length} transcripts, ${totalFigures} key figures`);
}

main().catch(error => {
  console.error('[figures] fatal:', error.message);
  process.exit(1);
});
