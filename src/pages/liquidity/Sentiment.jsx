import UsPerformance from '../us-performance/UsPerformance';
import HkChinaPerformance from '../hk-china-performance/HkChinaPerformance';

/** Consolidated Sentiment tab — combines the US and China sentiment
 * sections previously reachable as subtabs under Rotation → US / China. */
export default function LiquiditySentiment() {
  return (
    <>
      <div className="usp-section-label">US</div>
      <UsPerformance section="sentiment" />
      <div className="usp-section-label">China</div>
      <HkChinaPerformance section="sentiment" />
    </>
  );
}
