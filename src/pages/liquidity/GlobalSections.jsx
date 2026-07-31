import GlobalPerformance from '../global-performance/GlobalPerformance';
import MaCross from '../global-performance/MaCross';
import MaDeviation from '../global-performance/MaDeviation';

/** Standalone Liquidity tabs — formerly the Breadth / Technical / Turnover
 * subtabs under Rotation → Global, each now reachable directly. */
export function LiquidityBreadth() {
  return <GlobalPerformance section="breadth" />;
}

const TECHNICAL_LABELS = {
  'ma-cross': 'Technical — MA Cross',
  deviation: 'Technical — Deviation from 200-day MA',
};

const TECHNICAL_VIEWS = { 'ma-cross': MaCross, deviation: MaDeviation };

/** Technical carries its own subtabs (see NAV_SECTIONS): the index-level RSI
 * chart, the per-constituent 5/20-day MA crossings, and each index's distance
 * from its 200-day average. `section` here is the subtab key, not
 * GlobalPerformance's own section name. */
export function LiquidityTechnical({ section = null }) {
  const View = TECHNICAL_VIEWS[section];
  if (View) {
    return (
      <>
        <div className="usp-section-label">{TECHNICAL_LABELS[section]}</div>
        <View />
      </>
    );
  }
  return <GlobalPerformance section="technical" />;
}

export function LiquidityTurnover() {
  return <GlobalPerformance section="turnover" />;
}
