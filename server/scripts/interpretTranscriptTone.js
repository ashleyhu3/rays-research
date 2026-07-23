'use strict';

const fs = require('fs');
const axios = require('axios');
const { enrichmentPath, loadEnrichmentsForRun } = require('../transcripts/enrichmentStore');

// Optional --ticker/--period scope one run to a single transcript (read locally).
const argValue = name => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] || '') : null;
};
const RUN_TICKER = (argValue('--ticker') || '').toUpperCase() || null;
const RUN_PERIOD = (argValue('--period') || '').toUpperCase() || null;
const { STANCE_SCORES, attachCompositeTone } = require('../transcripts/tone');

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const FORCE = process.argv.includes('--force');
const BATCH_SIZE = 6;
const PACING_MS = GEMINI_KEY ? 4500 : 1800;
const STANCES = Object.keys(STANCE_SCORES);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function promptFor(chunks) {
  const records = chunks.map(chunk => ({
    id: chunk.id,
    speaker: chunk.speaker,
    text: chunk.text.slice(0, 1400),
  }));
  return [
    'Interpret each management answer as a skeptical public-markets investor.',
    'Classify stance as exactly one of: confident, careful, avoidant, defensive, transparent, overly_optimistic.',
    'Score from -1 (highly defensive/avoidant) to +1 (highly confident/transparent).',
    'Use careful when management is appropriately qualified but responsive.',
    'Use overly_optimistic only when confidence is weakly supported by specifics.',
    'Give one short evidence-based reason. Return every input id exactly once.',
    JSON.stringify(records),
  ].join('\n');
}

function normalizeRows(rows, chunks, model) {
  const expected = new Set(chunks.map(chunk => chunk.id));
  return (Array.isArray(rows) ? rows : [])
    .filter(row => expected.has(row?.id) && STANCES.includes(row?.stance))
    .map(row => ({
      id: row.id,
      stance: row.stance,
      score: Number.isFinite(Number(row.score))
        ? Math.max(-1, Math.min(1, Number(row.score)))
        : STANCE_SCORES[row.stance],
      reasoning: String(row.reasoning || '').slice(0, 320),
      confidence: Number.isFinite(Number(row.confidence))
        ? Math.max(0, Math.min(1, Number(row.confidence)))
        : 0.7,
      model,
      analyzedAt: new Date().toISOString(),
    }));
}

async function geminiInterpret(chunks) {
  if (!GEMINI_KEY) throw new Error('Gemini key unavailable');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptFor(chunks) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                stance: { type: 'STRING', enum: STANCES },
                score: { type: 'NUMBER' },
                reasoning: { type: 'STRING' },
                confidence: { type: 'NUMBER' },
              },
              required: ['id', 'stance', 'score', 'reasoning', 'confidence'],
            },
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  return normalizeRows(JSON.parse(text), chunks, `gemini:${GEMINI_MODEL}`);
}

async function groqInterpret(chunks) {
  if (!process.env.GROQ_API_KEY) throw new Error('Groq key unavailable');
  const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Return only JSON shaped as {"rows":[{"id":"...","stance":"...","score":0,"reasoning":"...","confidence":0.8}]}.',
        },
        { role: 'user', content: promptFor(chunks) },
      ],
    }, {
      timeout: 90000,
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  const payload = JSON.parse(response.data?.choices?.[0]?.message?.content || '{"rows":[]}');
  return normalizeRows(payload.rows, chunks, `groq:${GROQ_MODEL}`);
}

async function interpret(chunks) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await geminiInterpret(chunks);
    } catch (geminiError) {
      lastError = geminiError;
      console.warn(`[tone-llm] Gemini failed (attempt ${attempt}): ${geminiError.message}`);
    }
    try {
      return await groqInterpret(chunks);
    } catch (groqError) {
      lastError = groqError;
      console.warn(`[tone-llm] Groq failed (attempt ${attempt}): ${groqError.message}`);
    }
    if (attempt < 4) await wait(Math.min(2000 * (2 ** (attempt - 1)), 12000));
  }
  throw lastError || new Error('No LLM interpretation provider succeeded.');
}

async function main() {
  if (!GEMINI_KEY && !process.env.GROQ_API_KEY) {
    throw new Error('Set GEMINI_API_KEY or GROQ_API_KEY.');
  }

  const enrichments = (await loadEnrichmentsForRun({ ticker: RUN_TICKER, period: RUN_PERIOD }))
    .sort((a, b) => `${a.ticker}:${a.fiscal_period}`.localeCompare(`${b.ticker}:${b.fiscal_period}`));
  let interpreted = 0;
  let batches = 0;

  for (const enrichment of enrichments) {
    const eligible = enrichment.chunks.filter(chunk => (
      chunk.role === 'Management'
      && chunk.section === 'qa'
      && chunk.kind === 'answer'
      && (FORCE || !chunk.tone?.llm)
    ));
    for (let start = 0; start < eligible.length; start += BATCH_SIZE) {
      const batch = eligible.slice(start, start + BATCH_SIZE);
      const rows = await interpret(batch);
      const byId = new Map(rows.map(row => [row.id, row]));
      for (const chunk of batch) {
        const result = byId.get(chunk.id);
        if (result) {
          chunk.tone = { ...(chunk.tone || {}), llm: result };
          interpreted += 1;
        }
      }
      attachCompositeTone(enrichment);
      fs.writeFileSync(
        enrichmentPath(enrichment.ticker, enrichment.fiscal_period),
        `${JSON.stringify(enrichment, null, 2)}\n`,
      );
      batches += 1;
      console.log(
        `[tone-llm] ${enrichment.ticker}:${enrichment.fiscal_period} `
        + `${Math.min(start + batch.length, eligible.length)}/${eligible.length}`,
      );
      if (start + BATCH_SIZE < eligible.length) await wait(PACING_MS);
    }
  }
  console.log(`[tone-llm] complete: ${interpreted} answers interpreted in ${batches} batches`);
}

main().catch(error => {
  console.error('[tone-llm] fatal:', error.message);
  process.exit(1);
});
