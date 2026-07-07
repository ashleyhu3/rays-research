/**
 * Direction of a pricing page's headline value vs the previous datapoint, for
 * the sidebar arrow. Returns 'up' | 'down' | 'flat' | null. 'flat' means the
 * value is genuinely unchanged; null means there is no data to compare (so the
 * sidebar can show a neutral "no change" mark only in the real flat case).
 *
 * Each page has one representative series:
 *   memory → TrendForce mainstream DRAM spot index (monthly)
 *   gpu    → vast.ai mainstream GPU rental benchmark index
 *   cpu    → mean of the AWS CPU spot series
 *   tpu    → mean of the GCP TPU preemptible series
 */

function trendFromSeries(arr) {
  if (!Array.isArray(arr)) return null;
  const finite = arr.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const latest = finite[finite.length - 1];
  const prev   = finite[finite.length - 2];
  if (latest > prev) return 'up';
  if (latest < prev) return 'down';
  return 'flat';
}

// Average across all series at each index, skipping gaps. NaN where no series
// reported so trendFromSeries drops it and compares the last two real points.
function meanSeries(spotSeries) {
  const series = Object.values(spotSeries ?? {});
  if (!series.length) return [];
  const n = Math.max(...series.map(s => s.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    const vals = series.map(s => s[i]).filter(Number.isFinite);
    out.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN);
  }
  return out;
}

export function pricingTrend(liveData, viewId) {
  switch (viewId) {
    case 'pricing-memory': return trendFromSeries(liveData?.dram?.index?.values);
    case 'pricing-gpu':    return trendFromSeries(liveData?.gpu?.history?.index);
    case 'pricing-cpu':    return trendFromSeries(meanSeries(liveData?.cpu?.history?.spotSeries));
    case 'pricing-tpu':    return trendFromSeries(meanSeries(liveData?.tpu?.history?.spotSeries));
    default:               return null;
  }
}
