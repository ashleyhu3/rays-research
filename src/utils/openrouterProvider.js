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

/**
 * Weekly token series for a provider (or platform totals when provider is
 * null) with the in-progress ISO week dropped — its partial total would
 * read as a fake drop in any week-to-week comparison.
 */
function completeWeeks(ranks, provider) {
  const weekly = provider ? ranks?.providerWeekly?.[provider] : ranks?.weeklyTotals;
  if (!weekly?.length) return null;

  const allLabels  = ranks.weekLabels ?? [];
  const lastMonday = allLabels[allLabels.length - 1];
  const weekEnd    = lastMonday ? new Date(new Date(lastMonday + 'T00:00:00Z').getTime() + 6 * 86400000) : null;
  const partial    = weekEnd && ranks.asOf ? new Date(ranks.asOf + 'T00:00:00Z') < weekEnd : false;

  return {
    totals: partial ? weekly.slice(0, -1) : weekly,
    labels: allLabels.slice(0, partial ? -1 : undefined).map(orWeekLabel),
  };
}

/**
 * Aligned weekly tokens + % growth vs `lag` weeks earlier (1 = WoW,
 * 52 = YoY) over the last W complete weeks, for combined volume-bar /
 * growth-line charts. Growth is null where there is no week far enough
 * back to compare against. Returns null without data.
 */
export function orTokensWithGrowth(ranks, provider, W, lag = 1) {
  const cw = completeWeeks(ranks, provider);
  if (!cw) return null;
  const { totals, labels } = cw;
  const growth = totals.map((v, i) =>
    i >= lag && totals[i - lag] > 0 ? +((v / totals[i - lag] - 1) * 100).toFixed(1) : null
  );
  const w = Math.min(W, totals.length);
  return { labels: labels.slice(-w), tokens: totals.slice(-w), growth: growth.slice(-w) };
}

/** y-axis / tooltip formatter for growth percentages */
export const fmtGrowthPct = v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`;

/**
 * Direction of the most recent complete week's token volume vs the prior
 * complete week for one provider: 'up', 'down', 'flat' (genuinely unchanged),
 * or null (no data to compare). The in-progress week is dropped so a partial
 * total can't read as a fake drop.
 */
export function orWeeklyTrend(ranks, provider) {
  const cw = completeWeeks(ranks, provider);
  if (!cw || cw.totals.length < 2) return null;
  const latest = cw.totals.at(-1);
  const prev   = cw.totals.at(-2);
  if (!(prev > 0)) return null;
  if (latest > prev) return 'up';
  if (latest < prev) return 'down';
  return 'flat';
}
