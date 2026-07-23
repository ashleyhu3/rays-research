// Rotation → Global tab: index metadata shared by the Breadth/Technical/
// Turnover sections. `breadthPhase` marks which indices already have a
// confirmed constituent source for the Breadth pipeline (Phase 1) vs. those
// still needing one (Phase 2 — see the plan for TAIEX/TOPIX's near-whole-
// market scale, and ChiNext/KOSPI200's ETF-holdings-proxy status).
export const GLOBAL_INDICES = [
  { key: 'sp500',     label: 'S&P 500',    name: 'S&P 500',            color: '#3c8cdd', breadthPhase: 1, turnoverSource: 'yahoo-volume' },
  { key: 'ndx',       label: 'Nasdaq 100', name: 'Nasdaq 100',         color: '#da5a2f', breadthPhase: 1, turnoverSource: 'yahoo-volume' },
  { key: 'sox',       label: 'SOX',        name: 'PHLX Semiconductor', color: '#198f5e', breadthPhase: 1, turnoverSource: 'constituents' },
  { key: 'hsi',       label: 'Hang Seng',  name: 'Hang Seng Index',    color: '#9c7c1c', breadthPhase: 1, turnoverSource: 'eastmoney' },
  { key: 'csi300',    label: 'CSI 300',    name: 'CSI 300',            color: '#8749df', breadthPhase: 1, turnoverSource: 'eastmoney' },
  { key: 'chinext',   label: 'ChiNext',    name: 'ChiNext Index',      color: '#dc386e', breadthPhase: 2, turnoverSource: 'eastmoney' },
  { key: 'taiex',     label: 'TAIEX',      name: 'Taiwan Weighted Index', color: '#44981b', breadthPhase: 2, turnoverSource: 'eastmoney' },
  { key: 'kospi200',  label: 'KOSPI 200',  name: 'KOSPI 200',          color: '#1f96ad', breadthPhase: 2, turnoverSource: null },
  { key: 'nikkei225', label: 'Nikkei 225', name: 'Nikkei 225',         color: '#dd40dd', breadthPhase: 1, turnoverSource: 'constituents' },
  { key: 'topix',     label: 'TOPIX',      name: 'TOPIX',              color: '#89931a', breadthPhase: 2, turnoverSource: null },
];

export const GLOBAL_INDEX_KEYS = GLOBAL_INDICES.map(idx => idx.key);
export const BREADTH_PHASE1_KEYS = GLOBAL_INDICES.filter(idx => idx.breadthPhase === 1).map(idx => idx.key);
