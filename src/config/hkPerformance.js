export const HSCI_META = {
  ticker: '800701',
  label: '800701',
  name: 'HSCI',
  color: '#eaeae0',
};

// Sections mirror the HK/China page's pattern — each a plain ratio-vs-HSCI
// grid (no combined "aggregate" overview chart for this tab).
export const HK_SECTIONS = [
  {
    title: 'Sector',
    tickers: [
      { ticker: '800706', label: '800706', name: 'Information Tech',        color: '#3c8cdd' },
      { ticker: '800704', label: '800704', name: 'Healthcare',              color: '#da5a2f' },
      { ticker: '800702', label: '800702', name: 'Consumer Discretionary',  color: '#198f5e' },
      { ticker: '800703', label: '800703', name: 'Consumer Staples',        color: '#9c7c1c' },
      { ticker: '800712', label: '800712', name: 'Materials',               color: '#8749df' },
      { ticker: '800713', label: '800713', name: 'Energy',                  color: '#dc386e' },
      { ticker: '800708', label: '800708', name: 'Financials',              color: '#44981b' },
      { ticker: '800711', label: '800711', name: 'Industrials',             color: '#1f96ad' },
      { ticker: '800710', label: '800710', name: 'Telecom',                 color: '#dd40dd' },
      { ticker: '800709', label: '800709', name: 'Utilities',               color: '#c9a227' },
      { ticker: '800705', label: '800705', name: 'Conglomerates',           color: '#6b8cae' },
    ],
  },
  {
    title: 'Market Cap',
    tickers: [
      { ticker: '800714', label: '800714', name: 'Large Cap', color: '#3c8cdd' },
      { ticker: '800715', label: '800715', name: 'Mid Cap',   color: '#da5a2f' },
      { ticker: '800716', label: '800716', name: 'Small Cap', color: '#198f5e' },
    ],
  },
];
