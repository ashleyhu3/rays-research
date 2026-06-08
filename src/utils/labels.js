const BASE_DATE = '2026-05-05';

/** Generate n weekly labels ending at BASE_DATE */
export function wkLabels(n) {
  const labels = [];
  const end = new Date(BASE_DATE);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i * 7);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  return labels;
}

/** Generate n daily labels ending at BASE_DATE */
export function dayLabels(n) {
  const labels = [];
  const end = new Date(BASE_DATE);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  return labels;
}
