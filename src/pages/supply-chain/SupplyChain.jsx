import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { baseOpts, mkDs, GRID, TICK, BORD } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';

// ── Static company list (mirrors server/scrapers/mops.js) ────────────────
const ALL_COMPANIES = [
  // Fiber
  { id: '6442', ticker: '6442TT', group: 'fiber', exchange: 'twse', name: '光聖'    },
  // Optics
  { id: '3081', ticker: '3081TT', group: 'optics', exchange: 'tpex', name: '聯亞光電' },
  { id: '3363', ticker: '3363TT', group: 'optics', exchange: 'tpex', name: '上詮'    },
  { id: '3163', ticker: '3163TT', group: 'optics', exchange: 'tpex', name: '波若威'  },
  // PCB
  { id: '2383', ticker: '2383TT', group: 'pcb', exchange: 'twse', name: '台光電'   },
  { id: '2368', ticker: '2368TT', group: 'pcb', exchange: 'twse', name: '金像電'   },
  { id: '3037', ticker: '3037TT', group: 'pcb', exchange: 'twse', name: '欣興電子' },
  { id: '8046', ticker: '8046TT', group: 'pcb', exchange: 'twse', name: '南電'     },
  { id: '4958', ticker: '4958TT', group: 'pcb', exchange: 'twse', name: '臻鼎-KY'  },
  { id: '6274', ticker: '6274TT', group: 'pcb', exchange: 'tpex', name: '台燿科技' },
  { id: '8358', ticker: '8358TT', group: 'pcb', exchange: 'tpex', name: '金居'     },
  // MLCC
  { id: '2327', ticker: '2327TT', group: 'mlcc', exchange: 'twse', name: '國巨'   },
  { id: '2492', ticker: '2492TT', group: 'mlcc', exchange: 'twse', name: '華新科'  },
  { id: '3026', ticker: '3026TT', group: 'mlcc', exchange: 'twse', name: '禾伸堂'  },
  // Cooling
  { id: '3017', ticker: '3017TT', group: 'cooling', exchange: 'twse', name: '奇鋐'   },
  { id: '3653', ticker: '3653TT', group: 'cooling', exchange: 'twse', name: '健策'   },
  { id: '3324', ticker: '3324TT', group: 'cooling', exchange: 'tpex', name: '雙鴻'   },
  { id: '8996', ticker: '8996TT', group: 'cooling', exchange: 'twse', name: '高力'   },
  // Power
  { id: '2308', ticker: '2308TT', group: 'power', exchange: 'twse', name: '台達電'   },
  { id: '2301', ticker: '2301TT', group: 'power', exchange: 'twse', name: '光寶科'   },
  { id: '6415', ticker: '6415TT', group: 'power', exchange: 'twse', name: '矽力-KY'  },
  { id: '3665', ticker: '3665TT', group: 'power', exchange: 'twse', name: '貿聯-KY'  },
  // Equipment
  { id: '3131', ticker: '3131TT', group: 'equipment', exchange: 'tpex',     name: '弘塑' },
  { id: '6187', ticker: '6187TT', group: 'equipment', exchange: 'tpex',     name: '萬潤' },
  { id: '2467', ticker: '2467TT', group: 'equipment', exchange: 'twse',     name: '志聖' },
  { id: '3583', ticker: '3583TT', group: 'equipment', exchange: 'twse',     name: '辛耘' },
  { id: '7769', ticker: '7769TT', group: 'equipment', exchange: 'emerging', name: '鴻勁' },
  { id: '2360', ticker: '2360TT', group: 'equipment', exchange: 'twse',     name: '致茂' },
  // Memory
  { id: '2408', ticker: '2408TT', group: 'memory', exchange: 'twse', name: '南亞科' },
  { id: '2337', ticker: '2337TT', group: 'memory', exchange: 'twse', name: '旺宏'   },
  { id: '8299', ticker: '8299TT', group: 'memory', exchange: 'tpex', name: '群聯'   },
  { id: '2344', ticker: '2344TT', group: 'memory', exchange: 'twse', name: '華邦電' },
  // Foundry
  { id: '2330', ticker: '2330TT', group: 'foundry', exchange: 'twse', name: '台積電'   },
  { id: '2303', ticker: '2303TT', group: 'foundry', exchange: 'twse', name: '聯電'     },
  { id: '5347', ticker: '5347TT', group: 'foundry', exchange: 'tpex', name: '世界先進' },
];

/**
 * One entry per supply-chain tab. Each palette is hand-picked so that lines
 * sharing a chart sit far apart on the hue wheel — no two similar colours on
 * the same graph.
 */
const CHAINS = {
  optics: {
    label: 'Optics',
    colors: ['#f87171', '#38bdf8', '#fbbf24'],
  },
  fiber: {
    label: 'Fiber',
    colors: ['#f43f5e'],
  },
  pcb: {
    label: 'PCB',
    colors: ['#ef4444', '#f97316', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#fca5c1'],
  },
  mlcc: {
    label: 'MLCC',
    colors: ['#34d399', '#c084fc', '#fb923c'],
  },
  cooling: {
    label: 'Cooling',
    colors: ['#f87171', '#fbbf24', '#4ade80', '#60a5fa'],
  },
  power: {
    label: 'Power',
    colors: ['#fb923c', '#22d3ee', '#e879f9', '#a3e635'],
  },
  equipment: {
    label: 'Equipment',
    colors: ['#f87171', '#fbbf24', '#4ade80', '#22d3ee', '#818cf8', '#f472b6'],
  },
  memory: {
    label: 'Memory',
    colors: ['#fbbf24', '#34d399', '#60a5fa', '#fb7185'],
  },
  foundry: {
    label: 'Foundry',
    colors: ['#38bdf8', '#fb923c', '#4ade80'],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────
function mopsUrl(coId, exchange) {
  const typek = exchange === 'twse' ? 'sii' : exchange === 'emerging' ? 'rotc' : 'otc';
  return `https://mops.twse.com.tw/mops/web/t05st10_ifrs?co_id=${coId}&TYPEK=${typek}&isnew=false`;
}

function goodInfoUrl(coId) {
  return `https://goodinfo.tw/tw/ShowSaleMonChart.asp?STOCK_ID=${coId}`;
}

function mergeCompanyData(staticList, liveCompanies) {
  return staticList.map(c => {
    const live = liveCompanies?.[c.id];
    // Static name wins — cached server snapshots may carry stale names.
    return { ...c, srcUrl: live?.srcUrl || mopsUrl(c.id, c.exchange), monthly: live?.monthly ?? [] };
  });
}

function buildPeriods(companies, n) {
  const all = new Set();
  companies.forEach(c => c.monthly.forEach(r => all.add(r.period)));
  return [...all].sort().slice(-n);
}

// Colour is assigned by the company's position in the full chain list (before
// dropping empty series) so lines always match the legend swatches.
function buildMetricDatasets(companies, colors, periods, metric) {
  return companies
    .map((c, i) => ({ c, color: colors[i % colors.length] }))
    .filter(({ c }) => c.monthly.some(r => r[metric] != null))
    .map(({ c, color }) => {
      const byP = Object.fromEntries(c.monthly.map(r => [r.period, r[metric]]));
      return mkDs(`${c.ticker} ${c.name}`, color, periods.map(p => byP[p] ?? null));
    });
}

// A period only gets a total once every company that had started reporting by
// then has a value for it — otherwise the trailing month (where only some
// companies have reported yet) shows a bogus cliff. Companies listed later
// (e.g. recent IPOs) don't block the earlier periods they predate.
function buildTotalRevenueDataset(companies, periods) {
  const reporting = companies
    .filter(c => c.monthly.length > 0)
    .map(c => ({ first: c.monthly[0].period, byP: Object.fromEntries(c.monthly.map(r => [r.period, r.revenue])) }));
  const data = periods.map(p => {
    let total = 0, hasAny = false;
    for (const { first, byP } of reporting) {
      const v = byP[p];
      if (v != null) { total += v; hasAny = true; }
      else if (p >= first) return null; // started reporting but missing this month
    }
    return hasAny ? parseFloat(total.toFixed(2)) : null;
  });
  return mkDs('Total revenue', '#e2e8f0', data, true);
}

const revOpts = baseOpts(v => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1000) return `NT$${(v / 1000).toFixed(1)}B`;
  return `NT$${v.toFixed(0)}M`;
});

const pctOpts = {
  ...baseOpts(v => `${v != null ? v.toFixed(1) : '—'}%`),
  scales: {
    x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 8, autoSkip: true }, border: BORD },
    y: { grid: GRID, ticks: { ...TICK, callback: v => `${v}%` }, border: BORD, beginAtZero: false },
  },
};

function NoData() {
  return (
    <div style={{ color: 'var(--ter)', fontSize: 12, padding: '16px 0' }}>
      No data yet — hit <b style={{ color: 'var(--sec)' }}>Refresh Data</b> to fetch from FinMind open data API.
    </div>
  );
}

// ── Company directory (per supply chain) ─────────────────────────────────
function CompanyDirectory({ companies, label }) {
  return (
    <div className="cbox span2">
      <div className="ch-head">
        <div className="ch-title">Company directory — {label} supply chain</div>
        <div className="ch-meta">
          <a className="ch-src" href="https://mops.twse.com.tw/" target="_blank" rel="noopener noreferrer">mops.twse.com.tw</a>
        </div>
      </div>
      <div className="ch-sub">Click a company name to open its monthly revenue history on MOPS.</div>
      <div className="ch-table-wrap" style={{ maxHeight: 420, marginTop: 10 }}>
        <table className="ch-table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Ticker</th><th>Company</th>
              <th>Latest rev (NT$M)</th><th>YoY (%)</th><th>MoM (%)</th>
            </tr>
          </thead>
          <tbody>
            {companies.map(c => {
              const last = c.monthly.at(-1);
              return (
                <tr key={c.ticker}>
                  <td style={{ fontFamily: 'var(--font-m)', color: 'var(--accent)' }}>{c.ticker}</td>
                  <td>
                    <a href={c.srcUrl} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--text)', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,.25)' }}>
                      {c.name}
                    </a>
                  </td>
                  <td>{last ? last.revenue.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</td>
                  <td style={{ color: last?.yoy > 0 ? '#4ade80' : last?.yoy < 0 ? '#f87171' : 'inherit' }}>
                    {last?.yoy != null ? `${last.yoy > 0 ? '+' : ''}${last.yoy.toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ color: last?.mom > 0 ? '#4ade80' : last?.mom < 0 ? '#f87171' : 'inherit' }}>
                    {last?.mom != null ? `${last.mom > 0 ? '+' : ''}${last.mom.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Generic supply-chain page ────────────────────────────────────────────
function SupplyChainPage({ chain, months = 12 }) {
  const { label, colors } = CHAINS[chain];
  const { liveData } = useData();
  const { tableMode } = useUI();
  const liveCompanies = liveData?.mops?.companies ?? null;

  const staticList = useMemo(() => ALL_COMPANIES.filter(c => c.group === chain), [chain]);
  const companies  = useMemo(() => mergeCompanyData(staticList, liveCompanies), [staticList, liveCompanies]);
  const hasLive    = companies.some(c => c.monthly.length > 0);

  const periods = useMemo(() => buildPeriods(companies, months), [companies, months]);

  const revData = useMemo(() => ({ labels: periods, datasets: buildMetricDatasets(companies, colors, periods, 'revenue') }), [companies, colors, periods]);
  const yoyData = useMemo(() => ({ labels: periods, datasets: buildMetricDatasets(companies, colors, periods, 'yoy') }), [companies, colors, periods]);
  const momData = useMemo(() => ({ labels: periods, datasets: buildMetricDatasets(companies, colors, periods, 'mom') }), [companies, colors, periods]);

  const totalRevData = useMemo(() => ({
    labels: periods,
    datasets: [buildTotalRevenueDataset(companies, periods)],
  }), [companies, periods]);

  const legend   = staticList.map((c, i) => [`${c.ticker} ${c.name}`, colors[i % colors.length], goodInfoUrl(c.id)]);
  const colLinks = staticList.map(c => goodInfoUrl(c.id));

  return (
    <>
      <EditableGrid viewId={`ai-supply-${chain}`}>
        <ChartCard chartId={`supply-${chain}-yoy`}
          legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
          {hasLive && yoyData.datasets.length > 0 ? <Line data={yoyData} options={pctOpts} /> : <NoData />}
        </ChartCard>

        <ChartCard chartId={`supply-${chain}-mom`}
          legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
          {hasLive && momData.datasets.length > 0 ? <Line data={momData} options={pctOpts} /> : <NoData />}
        </ChartCard>

        {!tableMode && (
          <ChartCard chartId={`supply-${chain}-total-rev`}
            height={300} span2 isNew clean>
            {hasLive && totalRevData.datasets[0]?.data.some(v => v != null) ? <Line data={totalRevData} options={revOpts} /> : <NoData />}
          </ChartCard>
        )}

        <ChartCard chartId={`supply-${chain}-rev`}
          legend={legend} colLinks={colLinks} height={360} span2 isNew clean>
          {hasLive && revData.datasets.length > 0 ? <Line data={revData} options={revOpts} /> : <NoData />}
        </ChartCard>
      </EditableGrid>

      <div className="cgrid">
        <CompanyDirectory companies={companies} label={label} />
      </div>
    </>
  );
}

export function AISupplyOptics(props)    { return <SupplyChainPage chain="optics"    {...props} />; }
export function AISupplyFiber(props)     { return <SupplyChainPage chain="fiber"     {...props} />; }
export function AISupplyPCB(props)       { return <SupplyChainPage chain="pcb"       {...props} />; }
export function AISupplyMLCC(props)      { return <SupplyChainPage chain="mlcc"      {...props} />; }
export function AISupplyCooling(props)   { return <SupplyChainPage chain="cooling"   {...props} />; }
export function AISupplyPower(props)     { return <SupplyChainPage chain="power"     {...props} />; }
export function AISupplyEquipment(props) { return <SupplyChainPage chain="equipment" {...props} />; }
export function AISupplyMemory(props)    { return <SupplyChainPage chain="memory"    {...props} />; }
export function AISupplyFoundry(props)   { return <SupplyChainPage chain="foundry"   {...props} />; }
