import GlobalPerformance from '../global-performance/GlobalPerformance';
import MaCross from '../global-performance/MaCross';

/** Standalone Liquidity tabs — formerly the Breadth / Technical / Turnover
 * subtabs under Rotation → Global, each now reachable directly. */
export function LiquidityBreadth() {
  return <GlobalPerformance section="breadth" />;
}

const TECHNICAL_LABELS = { 'ma-cross': 'Technical — MA Cross' };

/** Technical carries its own subtabs (see NAV_SECTIONS): the index-level RSI
 * chart, and the per-constituent 5/20-day MA crossings. `section` here is the
 * subtab key, not GlobalPerformance's own section name. */
export function LiquidityTechnical({ section = null }) {
  if (section === 'ma-cross') {
    return (
      <>
        <div className="usp-section-label">{TECHNICAL_LABELS['ma-cross']}</div>
        <MaCross />
      </>
    );
  }
  return <GlobalPerformance section="technical" />;
}

export function LiquidityTurnover() {
  return <GlobalPerformance section="turnover" />;
}
