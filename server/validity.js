'use strict';

// Data Validity Terminal — merges the immutable SOURCE_REGISTRY with live
// telemetry from cache.js. Reads strictly from in-memory objects, so the route
// renders in well under a millisecond and never touches a live scraper.
const cache = require('./cache');
const { SOURCE_REGISTRY } = require('./sourceRegistry');

function buildRow(id) {
  const cfg = SOURCE_REGISTRY[id];
  const tel = cache.getTelemetry(id) || {};
  const m   = cache.meta(id);

  // lastSuccess: telemetry wins; else the cache's fetchedAt (covers boot-seeded
  // snapshots that never went through a live scrape this process).
  const lastSuccess = tel.lastSuccess ?? m?.fetchedAt ?? null;
  const pullAgeMs   = lastSuccess != null ? Date.now() - lastSuccess : null;

  // payloadBytes: telemetry value, else size of whatever is cached now.
  let payloadBytes = tel.payloadBytes;
  if (payloadBytes == null) {
    const data = cache.get(id);
    payloadBytes = data != null ? Buffer.byteLength(JSON.stringify(data)) : 0;
  }

  // Status: a recorded DOWN/RATE-LIMITED wins; otherwise OPERATIONAL, escalated
  // to STALE when OUR last successful pull is older than the critical threshold.
  let status = tel.status ?? (lastSuccess != null ? 'OPERATIONAL' : 'UNKNOWN');
  if (status === 'OPERATIONAL' && pullAgeMs != null && pullAgeMs > cfg.criticalLagThresholdMs) {
    status = 'STALE';
  }

  return {
    id,
    name: cfg.name,
    provider: cfg.provider,
    status,
    // Operational recency (how long since WE last pulled).
    lastSuccess,
    pullAgeSeconds: pullAgeMs != null ? Math.floor(pullAgeMs / 1000) : null,
    // Upstream data lag (inherent to how the SOURCE collects data).
    upstreamLagMs: cfg.upstreamLagMs,
    upstreamLagText: cfg.upstreamLagText,
    upstreamLagNote: cfg.upstreamLagNote,
    // Cadences.
    ourCadenceMs: cfg.ourCadenceMs,
    sourceCadence: cfg.sourceCadence,
    criticalLagThresholdMs: cfg.criticalLagThresholdMs,
    // Audit metadata.
    reliabilityGrade: cfg.reliabilityGrade,
    reliabilityNote: cfg.reliabilityNote,
    ragScope: cfg.ragScope,
    fallback: cfg.fallback,
    endpointUrl: cfg.endpointUrl,
    payloadBytes,
    payloadKB: payloadBytes != null ? `${(payloadBytes / 1024).toFixed(1)} KB` : '—',
    error: tel.error ?? null,
    successCount: tel.successCount ?? 0,
    failCount: tel.failCount ?? 0,
  };
}

function buildValidityState() {
  const sources = Object.keys(SOURCE_REGISTRY).map(buildRow);

  // System-wide SLA summary.
  const totalRuns = sources.reduce((n, s) => n + s.successCount + s.failCount, 0);
  const totalOk   = sources.reduce((n, s) => n + s.successCount, 0);
  const pipelineHealthPct = totalRuns > 0 ? +(totalOk / totalRuns * 100).toFixed(1) : null;

  // Volume-weighted average data age (by payload bytes) across live sources.
  let wSum = 0, w = 0;
  for (const s of sources) {
    if (s.pullAgeSeconds == null || !s.payloadBytes) continue;
    wSum += s.pullAgeSeconds * s.payloadBytes;
    w += s.payloadBytes;
  }
  const avgDataAgeSeconds = w > 0 ? Math.round(wSum / w) : null;

  const slaViolations = sources.filter(s => s.status !== 'OPERATIONAL').length;

  return {
    asOf: Date.now(),
    summary: {
      pipelineHealthPct,
      avgDataAgeSeconds,
      slaViolations,
      totalSources: sources.length,
      operational: sources.filter(s => s.status === 'OPERATIONAL').length,
    },
    sources,
  };
}

module.exports = { buildValidityState };
