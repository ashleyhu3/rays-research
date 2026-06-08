/**
 * Generate a noisy linear trend from start value s to end value e
 * over n data points with noise scale ns.
 */
export function trend(s, e, n, ns = 0.06) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(n - 1, 1);
    out.push(Math.round((s + (e - s) * t) * (1 + (Math.random() - 0.5) * ns)));
  }
  return out;
}

/**
 * Generate a random-walk series of n points starting at base value b
 * with per-step variance v.
 */
export function series(b, v = 0.04, n = 12) {
  const out = [b];
  for (let i = 1; i < n; i++) {
    out.push(Math.round(out[i - 1] * (1 + (Math.random() - 0.5) * v * 2)));
  }
  return out;
}
