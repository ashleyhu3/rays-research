'use strict';

const {
  listEnrichmentsForTicker,
  readAnalysisCacheForTicker,
  saveEnrichment,
} = require('./enrichmentStore');

const CACHE_VERSION = 1;
const READ_CACHE_TTL_MS = 5 * 60 * 1000;
const tickerReadCache = new Map();

const normalizeTicker = value => String(value || '')
  .toUpperCase()
  .replace(/[^A-Z0-9.-]/g, '');

const quarterOrder = enrichment => (Number(enrichment.year) || 0) * 10
  + (Number(String(enrichment.quarter || '').replace(/\D/g, '')) || 0);

const isCompleted = enrichment => Boolean(enrichment?.analysisCompletedAt);

function roleToneAverage(chunks, role) {
  const scores = (chunks || [])
    .filter(chunk => chunk.role === role && chunk.tone?.composite)
    .map(chunk => chunk.tone.composite.investorConfidence);
  return scores.length
    ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1))
    : null;
}

async function buildAnalysisSnapshot(enrichments, type) {
  const { runTranscriptManager } = await import('./manager.mjs');
  const ordered = enrichments.slice().sort((a, b) => quarterOrder(a) - quarterOrder(b));
  // The manager normalizes composite tone in place, so capture stored usage
  // metadata before report assembly mutates the supplied documents.
  const totalChunks = ordered.reduce(
    (sum, enrichment) => sum + (enrichment.toneSummary?.chunks || enrichment.stats?.chunks || 0),
    0,
  );
  const llmInterpreted = ordered.reduce(
    (sum, enrichment) => sum + (enrichment.toneSummary?.llmInterpreted || 0),
    0,
  );
  const result = await runTranscriptManager({ documents: ordered });
  const keyFigures = ordered
    .slice()
    .sort((a, b) => quarterOrder(b) - quarterOrder(a))
    .flatMap(enrichment => (enrichment.keyFigures || []).map(figure => ({
      ...figure,
      period: `${enrichment.year} ${enrichment.quarter}`,
      periodKey: quarterOrder(enrichment),
      fiscal_period: enrichment.fiscal_period,
    })));
  const toneByRole = ordered.map(enrichment => ({
    period: `${enrichment.year} ${enrichment.quarter}`,
    fiscal_period: enrichment.fiscal_period,
    investor: roleToneAverage(enrichment.chunks, 'Management'),
    analyst: roleToneAverage(enrichment.chunks, 'Analyst'),
  }));

  return {
    cacheVersion: CACHE_VERSION,
    type,
    ticker: normalizeTicker(ordered[0]?.ticker),
    periods: ordered.map(enrichment => enrichment.fiscal_period),
    cachedAt: new Date().toISOString(),
    analysis: result.analysis,
    reports: result.reports,
    keyFigures,
    toneByRole,
    execution: result.events,
    modelUsage: {
      deterministicPipeline: true,
      totalChunks,
      llmInterpreted,
      llmShare: totalChunks ? Number((llmInterpreted / totalChunks).toFixed(4)) : 0,
      scope: 'Optional qualitative tone interpretation on selected management answers only.',
    },
  };
}

async function completedEnrichmentsForTicker(ticker) {
  return (await listEnrichmentsForTicker(ticker, { completedOnly: true }))
    .filter(isCompleted)
    .sort((a, b) => quarterOrder(a) - quarterOrder(b));
}

// Called only when a transcript finishes its expensive analysis pipeline.
// Individual snapshots are immutable after completion. Cross-quarter snapshots
// are rebuilt from those stored results only when the ticker gains a quarter,
// then copied onto every analyzed transcript so all period views are consistent.
async function refreshAnalysisCacheForTicker(ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  tickerReadCache.delete(normalizedTicker);
  const enrichments = await completedEnrichmentsForTicker(ticker);
  if (!enrichments.length) return { transcriptCount: 0, crossQuarter: false };

  for (const enrichment of enrichments) {
    if (!enrichment.transcriptAnalysis) {
      enrichment.transcriptAnalysis = await buildAnalysisSnapshot([enrichment], 'transcript');
    }
  }

  const crossQuarterAnalysis = enrichments.length > 1
    ? await buildAnalysisSnapshot(enrichments, 'cross-quarter')
    : null;

  for (const enrichment of enrichments) {
    enrichment.crossQuarterAnalysis = crossQuarterAnalysis;
    await saveEnrichment(enrichment);
  }

  tickerReadCache.delete(normalizedTicker);
  return {
    transcriptCount: enrichments.length,
    crossQuarter: Boolean(crossQuarterAnalysis),
    periods: enrichments.map(enrichment => enrichment.fiscal_period),
  };
}

// Read-only request path. It deliberately never imports or invokes the manager:
// page navigation can load Mongo snapshots but cannot trigger analysis work.
async function readCachedAnalysis(ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  const inMemory = tickerReadCache.get(normalizedTicker);
  if (inMemory && Date.now() - inMemory.storedAt < READ_CACHE_TTL_MS) return inMemory.data;
  tickerReadCache.delete(normalizedTicker);

  const cached = await readAnalysisCacheForTicker(normalizedTicker);
  if (!cached) return null;
  const { latest, transcriptCount, transcripts } = cached;
  const crossQuarter = transcriptCount > 1 ? latest?.crossQuarterAnalysis : null;
  const snapshot = crossQuarter || latest?.transcriptAnalysis;
  if (!snapshot) return {
    pendingCache: true,
    ticker: normalizeTicker(ticker),
    transcriptCount,
  };
  const result = {
    ...snapshot,
    ticker: normalizedTicker,
    transcriptCount,
    hasCrossQuarter: Boolean(crossQuarter),
    transcripts,
  };
  tickerReadCache.set(normalizedTicker, { data: result, storedAt: Date.now() });
  return result;
}

module.exports = {
  buildAnalysisSnapshot,
  readCachedAnalysis,
  refreshAnalysisCacheForTicker,
};
