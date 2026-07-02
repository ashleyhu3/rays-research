'use strict';

const { inferRole, normalizePeriod, parseTranscriptDocument } = require('./parser');

const ALPHA_VANTAGE_URL = 'https://www.alphavantage.co/query';
const QA_MARKER = /\b(?:before we (?:begin|start) (?:the )?q\s*&\s*a|begin (?:the )?q\s*&\s*a|open (?:the|this) call for questions|first question)\b/i;

function apiKey() {
  return process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY || '';
}

function normalizeSymbol(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '');
}

function findQaStart(segments) {
  const markerIndex = segments.findIndex(segment => QA_MARKER.test(String(segment?.content ?? '')));
  const analystIndex = segments.findIndex(segment => (
    inferRole(segment?.speaker, segment?.title) === 'Analyst'
  ));

  if (markerIndex >= 0 && (analystIndex < 0 || markerIndex <= analystIndex)) {
    return markerIndex;
  }
  if (analystIndex < 0) return segments.length;

  const previous = segments[analystIndex - 1];
  return previous && inferRole(previous.speaker, previous.title) === 'Operator'
    ? analystIndex - 1
    : analystIndex;
}

function transcriptFromResponse(payload, { ticker, quarter, year }) {
  const symbol = normalizeSymbol(payload?.symbol || ticker);
  const period = normalizePeriod(payload?.quarter || quarter, year);
  const segments = Array.isArray(payload?.transcript)
    ? payload.transcript.filter(segment => String(segment?.content ?? '').trim())
    : [];

  if (!segments.length) {
    throw new Error(`No Alpha Vantage transcript was returned for ${symbol} ${period.fiscalPeriod}.`);
  }

  const qaStart = findQaStart(segments);
  const normalized = segments.map(segment => ({
    speaker: String(segment.speaker || 'Unknown speaker').trim(),
    title: String(segment.title || '').trim(),
    role: inferRole(segment.speaker, segment.title),
    text: String(segment.content || '').trim(),
  }));

  return parseTranscriptDocument({
    ticker: symbol,
    quarter: period.quarter,
    year: period.year,
    prepared: normalized.slice(0, qaStart),
    qa: normalized.slice(qaStart),
    metadata: {
      provider: 'alphavantage',
      sourceQuarter: payload.quarter || period.fiscalPeriod,
      sourceSentimentAvailable: segments.some(segment => segment.sentiment != null),
      collectedAt: new Date().toISOString(),
    },
  });
}

async function collectFromAlphaVantage({ ticker, quarter, year }) {
  const key = apiKey();
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY is not set');

  const symbol = normalizeSymbol(ticker);
  if (!symbol) throw new Error('ticker is required');
  const period = normalizePeriod(quarter, year);
  const url = new URL(ALPHA_VANTAGE_URL);
  url.searchParams.set('function', 'EARNINGS_CALL_TRANSCRIPT');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('quarter', period.fiscalPeriod);
  url.searchParams.set('apikey', key);

  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    const error = new Error(`Alpha Vantage HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const serviceMessage = payload.Note || payload.Information || payload['Error Message'];
  if (serviceMessage) {
    const error = new Error(`Alpha Vantage: ${String(serviceMessage).slice(0, 300)}`);
    if (/rate|frequency|requests per day/i.test(serviceMessage)) error.status = 429;
    throw error;
  }

  return transcriptFromResponse(payload, {
    ticker: symbol,
    quarter: period.quarter,
    year: period.year,
  });
}

module.exports = {
  collectFromAlphaVantage,
  findQaStart,
  normalizeSymbol,
  transcriptFromResponse,
};
