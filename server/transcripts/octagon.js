'use strict';

const { normalizePeriod, parseTranscriptDocument } = require('./parser');

const OCTAGON_URL = process.env.OCTAGON_BASE_URL
  || process.env.OCTAGON_API_BASE_URL
  || 'https://api.octagonagents.com/v1';
const OCTAGON_MODEL = process.env.OCTAGON_TRANSCRIPTS_MODEL || 'octagon-transcripts-agent';

function parseJsonContent(content) {
  if (content && typeof content === 'object') return content;
  const text = String(content ?? '').trim();
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
    throw new Error('Octagon returned a non-JSON transcript response.');
  }
}

function responseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const responseOutput = (payload?.output || []).flatMap(item => item?.content || [])
    .filter(item => item?.type === 'output_text' || typeof item?.text === 'string')
    .map(item => item?.text || '')
    .join('');
  if (responseOutput) return responseOutput;
  return payload?.choices?.[0]?.message?.content || '';
}

function looksLikeRawTranscript(content) {
  const text = String(content ?? '');
  const hasSections = /prepared remarks?|question-and-answer|questions?\s*(?:and|&)\s*answers?|q\s*&\s*a/i.test(text);
  const speakerLabels = text.match(/^[A-Z][^\n:]{1,100}(?:--|—|–|:)/gm) || [];
  return text.length > 1000 && hasSections && speakerLabels.length >= 3;
}

function collectionPrompt(ticker, period) {
  return [
    `Retrieve the complete earnings-call transcript for ${ticker}, fiscal ${period.quarter} ${period.year}.`,
    'This is a transcript collection request, not an analysis request.',
    'Return the verbatim available transcript without summarizing, interpreting, scoring sentiment, or omitting the Q&A.',
    'Return exactly one JSON object with this shape:',
    '{',
    '  "ticker": "TICKER",',
    `  "quarter": "${period.quarter}",`,
    `  "year": ${period.year},`,
    '  "earnings_date": "YYYY-MM-DD or null",',
    '  "speakers": [{"name":"...","title":"...","role":"Management|Analyst|Operator|Unknown"}],',
    '  "transcript": "complete raw transcript text",',
    '  "prepared": [{"speaker":"...","title":"...","role":"...","timestamp":null,"text":"verbatim paragraph"}],',
    '  "qa": [{"speaker":"...","title":"...","role":"...","timestamp":null,"text":"verbatim question or answer"}],',
    '  "metadata": {"provider":"octagon","source_url":null}',
    '}',
    'If no matching transcript exists, return {"error":"specific reason"} and nothing else.',
  ].join('\n');
}

async function collectFromOctagon({ ticker, quarter, year }) {
  const key = process.env.OCTAGON_API_KEY;
  if (!key) throw new Error('OCTAGON_API_KEY is not set');

  const symbol = String(ticker ?? '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!symbol) throw new Error('ticker is required');
  const period = normalizePeriod(quarter, year);

  const response = await fetch(`${OCTAGON_URL.replace(/\/$/, '')}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: OCTAGON_MODEL,
      input: collectionPrompt(symbol, period),
      stream: false,
      metadata: { feature: 'transcript-collection' },
    }),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    const error = new Error(`Octagon HTTP ${response.status}: ${details}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const content = responseText(payload);
  let result;
  try {
    result = parseJsonContent(content);
  } catch {
    if (looksLikeRawTranscript(content)) {
      result = { ticker: symbol, quarter: period.quarter, year: period.year, transcript: content };
    } else {
      throw new Error('Octagon did not return verbatim transcript content. Its Transcripts Agent may only expose cited analysis for this period.');
    }
  }
  if (result.error) throw new Error(`Octagon: ${result.error}`);

  const hasTranscript = typeof result.transcript === 'string'
    || Array.isArray(result.transcript)
    || Array.isArray(result.prepared)
    || Array.isArray(result.prepared_remarks)
    || Array.isArray(result.qa);
  if (!hasTranscript) {
    throw new Error('Octagon returned analysis instead of transcript content. Try another fiscal period.');
  }

  return parseTranscriptDocument({
    ...result,
    ticker: symbol,
    quarter: period.quarter,
    year: period.year,
    metadata: {
      ...(result.metadata || {}),
      provider: 'octagon',
      model: OCTAGON_MODEL,
      responseId: payload.id || null,
      citations: result.citations || [],
      usage: payload.usage || null,
      collectedAt: new Date().toISOString(),
    },
  });
}

module.exports = {
  collectFromOctagon,
  collectionPrompt,
  looksLikeRawTranscript,
  parseJsonContent,
  responseText,
};
