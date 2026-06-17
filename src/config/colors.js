/** Brand colour tokens */
export const C = {
  openai:     '#10b981',
  anthropic:  '#e8c547',
  google:     '#4285f4',
  mistral:    '#f59e0b',
  meta:       '#0866ff',
  perplexity: '#a78bfa',
  minimax:    '#e879f9',
  zhipu:      '#34d399',
  deepseek:   '#60a5fa',
  kimi:       '#fb923c',
  xiaomi:     '#f43f5e',
  baidu:      '#3b82f6',
  xai:        '#e5e7eb',
  qwen:       '#6366f1',
  red:        '#f87171',
  teal:       '#39d0b4',
  orange:     '#f0883e',
  slate:      '#94a3b8',
};

/** Convert a hex colour to rgba */
export const fa = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};
