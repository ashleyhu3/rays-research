import WebTrafficOverview from './WebTrafficOverview';
import { useData } from '../../context/DataContext';

export default function Web({ weeks }) {
  const { liveData: ld } = useData();
  const hasData = ld?.webTraffic?.history && Object.keys(ld.webTraffic.history).length > 0;

  return (
    <div>
      {hasData ? (
        <WebTrafficOverview weeks={weeks} />
      ) : (
        <div style={{ padding: '32px', maxWidth: 720 }}>
          <h2 style={{ marginBottom: 12 }}>Web traffic &amp; stickiness</h2>
          <p style={{ lineHeight: 1.7, color: 'var(--ter)' }}>
            Data is collected daily via SimilarWeb through Apify. The chart will appear
            once the first daily scrape has completed. Check back after the 03:00 UTC
            scheduled run.
          </p>
        </div>
      )}
    </div>
  );
}
