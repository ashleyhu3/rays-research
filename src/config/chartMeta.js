/**
 * Merges the per-category chart config files into a single lookup so that
 * components can resolve a chart's editorial text from its `chartId`.
 *
 * Maintainers edit the source-of-truth files, not this one:
 *   - chartText.js     → names (title) & descriptions (subtitle)
 *   - chartSources.js  → source label (src), link (srcUrl), cadence (freq)
 *   - chartInsights.js → highlighted insight & footnote (srcNote)
 */
import { CHART_TEXT } from './chartText';
import { CHART_SOURCES } from './chartSources';
import { CHART_INSIGHTS } from './chartInsights';

/** Resolve all centralized editorial text for one chart id. */
export function getChartMeta(chartId) {
  if (!chartId) return {};
  return {
    ...CHART_TEXT[chartId],
    ...CHART_SOURCES[chartId],
    ...CHART_INSIGHTS[chartId],
  };
}

/** Convenience: just the display title for a chart id (used by the registry). */
export function chartTitle(chartId) {
  return CHART_TEXT[chartId]?.title;
}
