/** Per-provider chart series derived from the openrouterRanks scrape */

export const fmtTok = v => {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(0)}M`;
  return String(v);
};

export function orWeekLabel(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Build token / share / model series for one provider over the last W weeks.
 * Returns null when rankings data (or this provider) is unavailable.
 */
export function orProviderSeries(ranks, provider, W) {
  const weekly = ranks?.providerWeekly?.[provider];
  if (!weekly?.length) return null;

  const labels = (ranks.weekLabels ?? []).slice(-W).map(orWeekLabel);
  const tokens = weekly.slice(-W);
  const totals = (ranks.weeklyTotals ?? []).slice(-W);
  const share  = tokens.map((t, i) => (totals[i] > 0 ? +(t / totals[i] * 100).toFixed(1) : 0));

  const latest = tokens.at(-1) ?? 0;
  const prev   = tokens.at(-2) ?? 0;
  const wow    = prev > 0 ? (latest - prev) / prev : null;

  return {
    labels,
    tokens,
    share,
    models: (ranks.topModels ?? []).filter(m => m.provider === provider),
    latest,
    wow,
    latestShare: share.at(-1) ?? 0,
    latestWeek:  orWeekLabel(ranks.latestWeek),
  };
}

/** Subtitle line for the weekly-tokens card */
export function orTokenSubtitle(orp) {
  const wow = orp.wow != null ? ` · ${orp.wow >= 0 ? '+' : ''}${(orp.wow * 100).toFixed(0)}% WoW` : '';
  return `Week of ${orp.latestWeek}: ${fmtTok(orp.latest)} tokens${wow} · ${orp.latestShare.toFixed(1)}% of platform traffic.`;
}
