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
  { ticker: 'XLU',  label: 'XLU',  name: 'Utilities', color: '#da2f2f' },
];

export const SPX_META = {
  ticker: '^GSPC',
  label: 'SPX',
  name: 'S&P 500',
  color: '#eaeae0',
};

// Tickers used only by the Tech / Theme / Factor ratio sections (not part of
// the sector-rotation overview chart), keyed by display label.
export const EXTRA_TICKERS = {
  RSP:  { ticker: 'RSP',  label: 'RSP',  name: 'Equal Weight', color: '#f2b134' },

  SOX:  { ticker: '^SOX', label: 'SOX',  name: 'Semiconductors', color: '#3c8cdd' },
  IGV:  { ticker: 'IGV',  label: 'IGV',  name: 'Software', color: '#da5a2f' },
  MAGS: { ticker: 'MAGS', label: 'MAGS', name: 'Magnificent Seven', color: '#198f5e' },
  CIBR: { ticker: 'CIBR', label: 'CIBR', name: 'Cybersecurity', color: '#9c7c1c' },
  NDX:  { ticker: '^NDX', label: 'NDX',  name: 'Nasdaq 100', color: '#dc386e' },
  KWEB: { ticker: 'KWEB', label: 'KWEB', name: 'China Internet (KWEB)', color: '#8749df' },

  XBI:  { ticker: 'XBI',  label: 'XBI',  name: 'Biotechnology', color: '#3c8cdd' },
  IHI:  { ticker: 'IHI',  label: 'IHI',  name: 'Medical Devices', color: '#da5a2f' },
  ITA:  { ticker: 'ITA',  label: 'ITA',  name: 'Aerospace & Defense', color: '#198f5e' },
  GDX:  { ticker: 'GDX',  label: 'GDX',  name: 'Gold Miners', color: '#9c7c1c' },
  COPX: { ticker: 'COPX', label: 'COPX', name: 'Copper Miners', color: '#8749df' },
  XHB:  { ticker: 'XHB',  label: 'XHB',  name: 'Homebuilders', color: '#dc386e' },
  XRT:  { ticker: 'XRT',  label: 'XRT',  name: 'Retail', color: '#44981b' },
  OIH:  { ticker: 'OIH',  label: 'OIH',  name: 'Oil Services', color: '#1f96ad' },
  KBE:  { ticker: 'KBE',  label: 'KBE',  name: 'Banks', color: '#dd40dd' },
  MOO:  { ticker: 'MOO',  label: 'MOO',  name: 'Agribusiness', color: '#89931a' },
  BOTZ: { ticker: 'BOTZ', label: 'BOTZ', name: 'Robotics & AI', color: '#da2f2f' },

  MTUM: { ticker: 'MTUM', label: 'MTUM', name: 'Momentum Factor', color: '#3c8cdd' },
  VLUE: { ticker: 'VLUE', label: 'VLUE', name: 'Value Factor', color: '#da5a2f' },
  QUAL: { ticker: 'QUAL', label: 'QUAL', name: 'Quality Factor', color: '#198f5e' },
  USMV: { ticker: 'USMV', label: 'USMV', name: 'Min Volatility Factor', color: '#9c7c1c' },
};

// [numerator, denominator] label pairs for the Tech section's ratio charts.
export const TECH_PAIRS = [
  ['SOX', 'SPX'],
  ['SOX', 'IGV'],
  ['SOX', 'MAGS'],
  ['MAGS', 'SPX'],
  ['IGV', 'SPX'],
  ['CIBR', 'IGV'],
];

// Theme and Factor sections are each ticker vs SPX.
export const THEME_TICKERS = ['XBI', 'IHI', 'ITA', 'GDX', 'COPX', 'XHB', 'XRT', 'OIH', 'KBE', 'MOO', 'BOTZ'];
export const FACTOR_TICKERS = ['MTUM', 'VLUE', 'QUAL', 'USMV'];

// [seriesA, seriesB] label pairs for the Correlation section's rolling
// Pearson-correlation charts.
export const SOX_CORRELATION_PAIRS = [
  ['SOX', 'NDX'],
  ['SOX', 'MAGS'],
  ['SOX', 'IGV'],
];
export const KWEB_CORRELATION_PAIRS = [
  ['KWEB', 'SOX'],
  ['KWEB', 'NDX'],
  ['KWEB', 'IGV'],
];

export function usPerformanceViewId(ticker) {
  return `us-performance-${ticker.toLowerCase()}`;
}
