export const US_PERFORMANCE_ETFS = [
  { ticker: 'XLC',  label: 'XLC',  name: 'Communication Services', color: '#3c8cdd' },
  { ticker: 'XLY',  label: 'XLY',  name: 'Consumer Discretionary', color: '#da5a2f' },
  { ticker: 'XLP',  label: 'XLP',  name: 'Consumer Staples', color: '#198f5e' },
  { ticker: 'XLE',  label: 'XLE',  name: 'Energy', color: '#9c7c1c' },
  { ticker: 'XLF',  label: 'XLF',  name: 'Financial', color: '#8749df' },
  { ticker: 'XLV',  label: 'XLV',  name: 'Health Care', color: '#dc386e' },
  { ticker: 'XLI',  label: 'XLI',  name: 'Industrial', color: '#44981b' },
  { ticker: 'XLB',  label: 'XLB',  name: 'Materials', color: '#1f96ad' },
  { ticker: 'XLRE', label: 'XLRE', name: 'Real Estate', color: '#dd40dd' },
  { ticker: 'XLK',  label: 'XLK',  name: 'Technology', color: '#89931a' },
  { ticker: 'XLSR', label: 'XLSR', name: 'US Sector Rotation', color: '#4551de' },
  { ticker: 'XLU',  label: 'XLU',  name: 'Utilities', color: '#da2f2f' },
];

export const SPX_META = {
  ticker: '^GSPC',
  label: 'SPX',
  name: 'S&P 500',
  color: '#eaeae0',
};

export function usPerformanceViewId(ticker) {
  return `us-performance-${ticker.toLowerCase()}`;
}
