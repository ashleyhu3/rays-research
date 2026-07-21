export const CSI300_META = {
  ticker: '000300.SS',
  label: 'CSI300',
  name: 'CSI 300',
  color: '#eaeae0',
};

// Section 1 — broad indices, rebased together in an aggregate chart plus
// individual ratio-vs-CSI300 cards (mirrors the US page's Sector section).
// ChiNext and STAR50 are fetched server-side from East Money (not Yahoo,
// which has no daily history for those two raw index instruments).
export const HK_CHINA_INDEX_TICKERS = [
  { ticker: '000001.SS', label: '000001', name: 'SSE Composite',   color: '#3c8cdd' },
  { ticker: '399006.SZ', label: '399006', name: 'ChiNext',         color: '#da5a2f' },
  { ticker: '000688.SS', label: '000688', name: 'STAR50 (科创50)', color: '#198f5e' },
];

// Sections 2-8 — each a plain ratio-vs-CSI300 grid (mirrors the US page's
// Tech/Theme/Factor sections).
export const HK_CHINA_SECTIONS = [
  {
    title: 'TMT',
    tickers: [
      { ticker: '512480.SS', label: '512480', name: '全产业链半导体', color: '#3c8cdd' },
      { ticker: '159995.SZ', label: '159995', name: '芯片',           color: '#da5a2f' },
      { ticker: '562590.SS', label: '562590', name: '半导体设备',     color: '#198f5e' },
      { ticker: '515880.SS', label: '515880', name: '通信',           color: '#9c7c1c' },
      { ticker: '515050.SS', label: '515050', name: '5G',             color: '#8749df' },
      { ticker: '159819.SZ', label: '159819', name: 'AI 人工智能',    color: '#dc386e' },
      { ticker: '159336.SZ', label: '159336', name: '软件',           color: '#44981b' },
      { ticker: '516860.SS', label: '516860', name: '金融科技',       color: '#1f96ad' },
      { ticker: '159732.SZ', label: '159732', name: '消费电子',       color: '#dd40dd' },
    ],
  },
  {
    title: 'New Energy',
    tickers: [
      { ticker: '159796.SZ', label: '159796', name: '电池',    color: '#3c8cdd' },
      { ticker: '515790.SS', label: '515790', name: '光伏',    color: '#da5a2f' },
      { ticker: '159806.SZ', label: '159806', name: '新能源车', color: '#198f5e' },
      { ticker: '159613.SZ', label: '159613', name: '储能',    color: '#9c7c1c' },
      { ticker: '159615.SZ', label: '159615', name: '绿色电力', color: '#8749df' },
      { ticker: '159326.SZ', label: '159326', name: '电网设备', color: '#dc386e' },
    ],
  },
  {
    title: 'Healthcare',
    tickers: [
      { ticker: '512170.SS', label: '512170', name: '医疗',     color: '#3c8cdd' },
      { ticker: '159992.SZ', label: '159992', name: '创新药',   color: '#da5a2f' },
      { ticker: '562390.SS', label: '562390', name: '中药',     color: '#198f5e' },
      { ticker: '159883.SZ', label: '159883', name: '医疗器械', color: '#9c7c1c' },
    ],
  },
  {
    title: 'Consumer',
    tickers: [
      { ticker: '512690.SS', label: '512690', name: '白酒',     color: '#3c8cdd' },
      { ticker: '159843.SZ', label: '159843', name: '食品饮料', color: '#da5a2f' },
      { ticker: '159766.SZ', label: '159766', name: '旅游',     color: '#198f5e' },
    ],
  },
  {
    title: 'Cyclical',
    tickers: [
      { ticker: '512880.SS', label: '512880', name: '证券',       color: '#3c8cdd' },
      { ticker: '512800.SS', label: '512800', name: '银行',       color: '#da5a2f' },
      { ticker: '512160.SS', label: '512160', name: '保险',       color: '#198f5e' },
      { ticker: '512400.SS', label: '512400', name: '有色金属',   color: '#9c7c1c' },
      { ticker: '159608.SZ', label: '159608', name: '稀有金属/稀土', color: '#8749df' },
      { ticker: '515220.SS', label: '515220', name: '煤炭',       color: '#dc386e' },
      { ticker: '561360.SS', label: '561360', name: '石油',       color: '#44981b' },
      { ticker: '159865.SZ', label: '159865', name: '农业/畜牧',  color: '#1f96ad' },
      { ticker: '159607.SZ', label: '159607', name: '化工',       color: '#dd40dd' },
    ],
  },
  {
    title: 'Machinery',
    tickers: [
      { ticker: '512680.SS', label: '512680', name: '军工',     color: '#3c8cdd' },
      { ticker: '562500.SS', label: '562500', name: '机器人',   color: '#da5a2f' },
      { ticker: '159663.SZ', label: '159663', name: '机床',     color: '#198f5e' },
      { ticker: '159616.SZ', label: '159616', name: '工程机械', color: '#9c7c1c' },
    ],
  },
  {
    title: 'Factor',
    tickers: [
      { ticker: '512890.SS', label: '512890', name: '红利低波', color: '#3c8cdd' },
    ],
  },
];

export function hkChinaPerformanceViewId(ticker) {
  return `hk-china-performance-${ticker.toLowerCase()}`;
}
