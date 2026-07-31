import GlobalPerformance from '../global-performance/GlobalPerformance';

/** Standalone Liquidity tabs — formerly the Breadth / Technical / Turnover
 * subtabs under Rotation → Global, each now reachable directly. */
export function LiquidityBreadth() {
  return <GlobalPerformance section="breadth" />;
}

export function LiquidityTechnical() {
  return <GlobalPerformance section="technical" />;
}

export function LiquidityTurnover() {
  return <GlobalPerformance section="turnover" />;
}
