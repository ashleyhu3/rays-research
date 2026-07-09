import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { baseOpts, mkDs, GRID, TICK, BORD } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';

// ── Static company list (mirrors server/scrapers/mops.js) ────────────────
const ALL_COMPANIES = [
  { id: '6442', ticker: '6442TT', group: 'fiber',  exchange: 'twse', name: '光聖'    },
  { id: '3081', ticker: '3081TT', group: 'optics', exchange: 'tpex', name: '聯亞光電' },
  { id: '3363', ticker: '3363TT', group: 'optics', exchange: 'tpex', name: '品興'    },
  { id: '3163', ticker: '3163TT', group: 'optics', exchange: 'tpex', name: '波若威'  },
  { id: '2383', ticker: '2383TT', group: 'ccl',    exchange: 'twse', name: '台光電'   },
  { id: '6274', ticker: '6274TT', group: 'ccl',    exchange: 'tpex', name: '台燿科技' },
  { id: '8358', ticker: '8358TT', group: 'ccl',    exchange: 'tpex', name: '金像電子' },
  { id: '2368', ticker: '2368TT', group: 'pcb',    exchange: 'twse', name: '金像電'   },
  { id: '4958', ticker: '4958TT', group: 'pcb',    exchange: 'twse', name: '臻鼎-KY'  },
  { id: '8021', ticker: '8021TT', group: 'pcb',    exchange: 'twse', name: '尖點'     },
  { id: '3037', ticker: '3037TT', group: 'abf',    exchange: 'twse', name: '欣興電子' },
  { id: '8046', ticker: '8046TT', group: 'abf',    exchange: 'twse', name: '南電'     },
  { id: '2327', ticker: '2327TT', group: 'mlcc',   exchange: 'twse', name: '國巨'    },
  { id: '2492', ticker: '2492TT', group: 'mlcc',   exchange: 'twse', name: '華新科'   },
  { id: '3026', ticker: '3026TT', group: 'mlcc',   exchange: 'twse', name: '禾伸堂'   },
];

const OPTICS = ALL_COMPANIES.filter(c => c.group === 'optics');
const FIBER  = ALL_COMPANIES.filter(c => c.group === 'fiber');
const CCL    = ALL_COMPANIES.filter(c => c.group === 'ccl');
const PCB    = ALL_COMPANIES.filter(c => c.group === 'pcb');
const ABF    = ALL_COMPANIES.filter(c => c.group === 'abf');
const MLCC   = ALL_COMPANIES.filter(c => c.group === 'mlcc');

const OPTICS_COLORS = [C.teal, C.anthropic, C.red, C.orange];
const FIBER_COLORS  = [C.xiaomi];
const CCL_COLORS    = [C.openai, C.deepseek, C.google];
const PCB_COLORS    = [C.mistral, C.zhipu, C.perplexity];
const ABF_COLORS    = [C.kimi, C.anthropic];
const MLCC_COLORS   = [C.minimax, C.baidu, C.qwen];

const GROUP_COLORS = { optics: OPTICS_COLORS, fiber: FIBER_COLORS, ccl: CCL_COLORS, pcb: PCB_COLORS, abf: ABF_COLORS, mlcc: MLCC_COLORS };
const GROUP_LABEL  = { optics: 'Optics', fiber: 'Fiber', ccl: 'CCL', pcb: 'PCB', abf: 'ABF', mlcc: 'MLCC' };

// Per-company colour = its position within its own group's palette. Derived
// from ALL_COMPANIES so the overview legend/datasets stay aligned regardless of
// how many companies each group has.
const _groupIdx = {};
const ALL_COLORS = ALL_COMPANIES.map(c => {
  const pal = GROUP_COLORS[c.group] ?? [C.slate];
  const i = (_groupIdx[c.group] = (_groupIdx[c.group] ?? 0));
  _groupIdx[c.group]++;
  return pal[i % pal.length];
});

// ── Helpers ──────────────────────────────────────────────────────────────
function mopsUrl(coId, exchange) {
  return `https://mops.twse.com.tw/mops/web/t05st10_ifrs?co_id=${coId}&TYPEK=${exchange === 'twse' ? 'sii' : 'otc'}&isnew=false`;
}

function goodInfoUrl(coId) {
  return `https://goodinfo.tw/tw/ShowSaleMonChart.asp?STOCK_ID=${coId}`;
}

function mergeCompanyData(staticList, liveCompanies) {
  return staticList.map(c => {
    const live = liveCompanies?.[c.id];
    return { ...c, name: live?.name || c.name, srcUrl: live?.srcUrl || mopsUrl(c.id, c.exchange), monthly: live?.monthly ?? [] };
  });
}

function buildPeriods(companies, n) {
  const all = new Set();
  companies.forEach(c => c.monthly.forEach(r => all.add(r.period)));
  return [...all].sort().slice(-n);
}

function buildRevenueDatasets(companies, colors, periods) {
  return companies
    .filter(c => c.monthly.length > 0)
    .map((c, i) => {
      const byP = Object.fromEntries(c.monthly.map(r => [r.period, r.revenue]));
      return mkDs(`${c.ticker} ${c.name}`, colors[i % colors.length], periods.map(p => byP[p] ?? null));
    });
}

function buildYoyDatasets(companies, colors, periods) {
  return companies
    .filter(c => c.monthly.some(r => r.yoy != null))
    .map((c, i) => {
      const byP = Object.fromEntries(c.monthly.map(r => [r.period, r.yoy]));
      return mkDs(`${c.ticker} ${c.name}`, colors[i % colors.length], periods.map(p => byP[p] ?? null));
    });
}

function buildTotalRevenueDataset(companies, periods) {
  const data = periods.map(p => {
    let total = 0, hasAny = false;
    companies.forEach(c => {
      const v = c.monthly.find(r => r.period === p)?.revenue;
      if (v != null) { total += v; hasAny = true; }
    });
    return hasAny ? parseFloat(total.toFixed(2)) : null;
  });
  return mkDs('Total revenue', '#e2e8f0', data, true);
}

function buildMomDatasets(companies, colors, periods) {
  return companies
    .filter(c => c.monthly.some(r => r.mom != null))
    .map((c, i) => {
      const byP = Object.fromEntries(c.monthly.map(r => [r.period, r.mom]));
      return mkDs(`${c.ticker} ${c.name}`, colors[i % colors.length], periods.map(p => byP[p] ?? null));
    });
}

const revFmt = v => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1000) return `NT$${(v / 1000).toFixed(1)}B`;
  return `NT$${v.toFixed(0)}M`;
};

const pctFmt = v => `${v != null ? v.toFixed(1) : '—'}%`;

function withPointValueLabels(opts, yFmt) {
  return {
    ...opts,
    layout: {
      ...(opts.layout ?? {}),
      padding: {
        top: 18,
        right: 28,
        bottom: 4,
        left: 4,
        ...(opts.layout?.padding ?? {}),
      },
    },
    plugins: {
      ...opts.plugins,
      pointValueLabels: {
        display: true,
        formatter: yFmt,
      },
    },
  };
}

const revOpts = withPointValueLabels(baseOpts(revFmt), revFmt);

const pctOpts = withPointValueLabels({
  ...baseOpts(pctFmt),
  scales: {
    x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 8, autoSkip: true }, border: BORD },
    y: { grid: GRID, ticks: { ...TICK, callback: v => `${v}%` }, border: BORD, beginAtZero: false },
  },
}, pctFmt);


// ── Shared data hook ─────────────────────────────────────────────────────
function useSupplyData(months) {
  const { liveData } = useData();
  const { tableMode } = useUI();
  const liveCompanies = liveData?.mops?.companies ?? null;
  const all    = useMemo(() => mergeCompanyData(ALL_COMPANIES, liveCompanies), [liveCompanies]);
  const optics = useMemo(() => mergeCompanyData(OPTICS, liveCompanies), [liveCompanies]);
  const fiber  = useMemo(() => mergeCompanyData(FIBER,  liveCompanies), [liveCompanies]);
  const ccl    = useMemo(() => mergeCompanyData(CCL,    liveCompanies), [liveCompanies]);
  const pcb    = useMemo(() => mergeCompanyData(PCB,    liveCompanies), [liveCompanies]);
  const abf    = useMemo(() => mergeCompanyData(ABF,    liveCompanies), [liveCompanies]);
  const mlcc   = useMemo(() => mergeCompanyData(MLCC,   liveCompanies), [liveCompanies]);
  const hasLive = all.some(c => c.monthly.length > 0);
  return { all, optics, fiber, ccl, pcb, abf, mlcc, hasLive, tableMode, n: months };
}

function NoData() {
  return (
    <div style={{ color: 'var(--ter)', fontSize: 12, padding: '16px 0' }}>
      No data yet — hit <b style={{ color: 'var(--sec)' }}>Refresh Data</b> to fetch from FinMind open data API.
    </div>
  );
}

// ── Company directory (used on Overview page) ────────────────────────────
function CompanyDirectory({ companies }) {
  const all = companies;

  return (
    <div className="cbox span2">
      <div className="ch-head">
        <div className="ch-title">Company directory — AI supply chain</div>
        <div className="ch-meta">
          <a className="ch-src" href="https://mops.twse.com.tw/" target="_blank" rel="noopener noreferrer">mops.twse.com.tw</a>
        </div>
      </div>
      <div className="ch-sub">Click a company name to open its monthly revenue history on MOPS.</div>
      <div className="ch-table-wrap" style={{ maxHeight: 420, marginTop: 10 }}>
        <table className="ch-table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Ticker</th><th>Company</th><th>Group</th>
              <th>Latest rev (NT$M)</th><th>YoY (%)</th><th>MoM (%)</th>
            </tr>
          </thead>
          <tbody>
            {all.map(c => {
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
                  <td style={{ color: 'var(--ter)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '.06em' }}>
                    {GROUP_LABEL[c.group] ?? c.group}
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

// ── Page 1: Overview ─────────────────────────────────────────────────────
export default function AISupplyOverview({ months = 12 }) {
  const { all, hasLive, tableMode, n } = useSupplyData(months);

  const allCompanies = all;
  const allPeriods   = useMemo(() => buildPeriods(allCompanies, n), [allCompanies, n]);

  const allRevData = useMemo(() => ({
    labels: allPeriods,
    datasets: buildRevenueDatasets(allCompanies, ALL_COLORS, allPeriods),
  }), [allCompanies, allPeriods]);

  const totalRevData = useMemo(() => ({
    labels: allPeriods,
    datasets: [buildTotalRevenueDataset(allCompanies, allPeriods)],
  }), [allCompanies, allPeriods]);

  const allYoyData = useMemo(() => ({
    labels: allPeriods,
    datasets: buildYoyDatasets(allCompanies, ALL_COLORS, allPeriods),
  }), [allCompanies, allPeriods]);

  const allMomData = useMemo(() => ({
    labels: allPeriods,
    datasets: buildMomDatasets(allCompanies, ALL_COLORS, allPeriods),
  }), [allCompanies, allPeriods]);

  const allLegend   = ALL_COMPANIES.map((c, i) => [`${c.ticker} ${c.name}`, ALL_COLORS[i], goodInfoUrl(c.id)]);
  const allColLinks = ALL_COMPANIES.map(c => goodInfoUrl(c.id));

  return (
    <>
      <EditableGrid viewId="ai-supply">
        <ChartCard chartId="supply-all-yoy"
          legend={allLegend} colLinks={allColLinks} height={360} isNew span2={tableMode} colorPct clean>
          {hasLive && allYoyData.datasets.length > 0 ? <Line data={allYoyData} options={pctOpts} /> : <NoData />}
        </ChartCard>

        <ChartCard chartId="supply-all-mom"
          legend={allLegend} colLinks={allColLinks} height={360} isNew span2={tableMode} colorPct clean>
          {hasLive && allMomData.datasets.length > 0 ? <Line data={allMomData} options={pctOpts} /> : <NoData />}
        </ChartCard>

        {!tableMode && (
          <ChartCard chartId="supply-total-rev"
            height={300} span2 isNew clean>
            {hasLive && totalRevData.datasets[0]?.data.some(v => v != null) ? <Line data={totalRevData} options={revOpts} /> : <NoData />}
          </ChartCard>
        )}

        <ChartCard chartId="supply-all-rev"
          legend={allLegend} colLinks={allColLinks} height={360} span2 isNew clean>
          {hasLive && allRevData.datasets.length > 0 ? <Line data={allRevData} options={revOpts} /> : <NoData />}
        </ChartCard>
      </EditableGrid>

      <div className="cgrid">
        <CompanyDirectory companies={all} />
      </div>
    </>
  );
}

// ── Page 2: Optics supply chain ──────────────────────────────────────────
export function AISupplyOptics({ months = 12 }) {
  const { optics, hasLive, tableMode, n } = useSupplyData(months);

  const periods = useMemo(() => buildPeriods(optics, n), [optics, n]);

  const revData = useMemo(() => ({ labels: periods, datasets: buildRevenueDatasets(optics, OPTICS_COLORS, periods) }), [optics, periods]);
  const yoyData = useMemo(() => ({ labels: periods, datasets: buildYoyDatasets(optics, OPTICS_COLORS, periods) }), [optics, periods]);
  const momData = useMemo(() => ({ labels: periods, datasets: buildMomDatasets(optics, OPTICS_COLORS, periods) }), [optics, periods]);

  const legend   = OPTICS.map((c, i) => [`${c.ticker} ${c.name}`, OPTICS_COLORS[i], goodInfoUrl(c.id)]);
  const colLinks = OPTICS.map(c => goodInfoUrl(c.id));

  return (
    <EditableGrid viewId="ai-supply-optics">
      <ChartCard chartId="supply-optics-yoy"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && yoyData.datasets.length > 0 ? <Line data={yoyData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-optics-mom"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && momData.datasets.length > 0 ? <Line data={momData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-optics-rev"
        legend={legend} colLinks={colLinks} height={360} span2 isNew clean>
        {hasLive && revData.datasets.length > 0 ? <Line data={revData} options={revOpts} /> : <NoData />}
      </ChartCard>
    </EditableGrid>
  );
}

function SupplySegmentPage({ months, dataKey, staticCompanies, colors, viewId, chartPrefix }) {
  const supply = useSupplyData(months);
  const companies = supply[dataKey];
  const { hasLive, tableMode, n } = supply;

  const periods = useMemo(() => buildPeriods(companies, n), [companies, n]);

  const revData = useMemo(() => ({ labels: periods, datasets: buildRevenueDatasets(companies, colors, periods) }), [companies, colors, periods]);
  const yoyData = useMemo(() => ({ labels: periods, datasets: buildYoyDatasets(companies, colors, periods) }), [companies, colors, periods]);
  const momData = useMemo(() => ({ labels: periods, datasets: buildMomDatasets(companies, colors, periods) }), [companies, colors, periods]);

  const legend   = staticCompanies.map((c, i) => [`${c.ticker} ${c.name}`, colors[i], goodInfoUrl(c.id)]);
  const colLinks = staticCompanies.map(c => goodInfoUrl(c.id));

  return (
    <EditableGrid viewId={viewId}>
      <ChartCard chartId={`${chartPrefix}-yoy`}
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && yoyData.datasets.length > 0 ? <Line data={yoyData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId={`${chartPrefix}-mom`}
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && momData.datasets.length > 0 ? <Line data={momData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId={`${chartPrefix}-rev`}
        legend={legend} colLinks={colLinks} height={360} span2 isNew clean>
        {hasLive && revData.datasets.length > 0 ? <Line data={revData} options={revOpts} /> : <NoData />}
      </ChartCard>
    </EditableGrid>
  );
}

// ── Page 3: CCL supply chain ─────────────────────────────────────────────
export function AISupplyCCL({ months = 12 }) {
  return (
    <SupplySegmentPage
      months={months}
      dataKey="ccl"
      staticCompanies={CCL}
      colors={CCL_COLORS}
      viewId="ai-supply-ccl"
      chartPrefix="supply-ccl"
    />
  );
}

// ── Page 4: PCB supply chain ─────────────────────────────────────────────
export function AISupplyPCB({ months = 12 }) {
  return (
    <SupplySegmentPage
      months={months}
      dataKey="pcb"
      staticCompanies={PCB}
      colors={PCB_COLORS}
      viewId="ai-supply-pcb"
      chartPrefix="supply-pcb"
    />
  );
}

// ── Page 5: ABF supply chain ─────────────────────────────────────────────
export function AISupplyABF({ months = 12 }) {
  return (
    <SupplySegmentPage
      months={months}
      dataKey="abf"
      staticCompanies={ABF}
      colors={ABF_COLORS}
      viewId="ai-supply-abf"
      chartPrefix="supply-abf"
    />
  );
}

// ── Page 6: MLCC supply chain ────────────────────────────────────────────
export function AISupplyMLCC({ months = 12 }) {
  const { mlcc, hasLive, tableMode, n } = useSupplyData(months);

  const periods = useMemo(() => buildPeriods(mlcc, n), [mlcc, n]);

  const revData = useMemo(() => ({ labels: periods, datasets: buildRevenueDatasets(mlcc, MLCC_COLORS, periods) }), [mlcc, periods]);
  const yoyData = useMemo(() => ({ labels: periods, datasets: buildYoyDatasets(mlcc, MLCC_COLORS, periods) }), [mlcc, periods]);
  const momData = useMemo(() => ({ labels: periods, datasets: buildMomDatasets(mlcc, MLCC_COLORS, periods) }), [mlcc, periods]);

  const legend   = MLCC.map((c, i) => [`${c.ticker} ${c.name}`, MLCC_COLORS[i], goodInfoUrl(c.id)]);
  const colLinks = MLCC.map(c => goodInfoUrl(c.id));

  return (
    <EditableGrid viewId="ai-supply-mlcc">
      <ChartCard chartId="supply-mlcc-yoy"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && yoyData.datasets.length > 0 ? <Line data={yoyData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-mlcc-mom"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && momData.datasets.length > 0 ? <Line data={momData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-mlcc-rev"
        legend={legend} colLinks={colLinks} height={360} span2 isNew clean>
        {hasLive && revData.datasets.length > 0 ? <Line data={revData} options={revOpts} /> : <NoData />}
      </ChartCard>
    </EditableGrid>
  );
}

// ── Page 7: Fiber supply chain ───────────────────────────────────────────
export function AISupplyFiber({ months = 12 }) {
  const { fiber, hasLive, tableMode, n } = useSupplyData(months);

  const periods = useMemo(() => buildPeriods(fiber, n), [fiber, n]);

  const revData = useMemo(() => ({ labels: periods, datasets: buildRevenueDatasets(fiber, FIBER_COLORS, periods) }), [fiber, periods]);
  const yoyData = useMemo(() => ({ labels: periods, datasets: buildYoyDatasets(fiber, FIBER_COLORS, periods) }), [fiber, periods]);
  const momData = useMemo(() => ({ labels: periods, datasets: buildMomDatasets(fiber, FIBER_COLORS, periods) }), [fiber, periods]);

  const legend   = FIBER.map((c, i) => [`${c.ticker} ${c.name}`, FIBER_COLORS[i], goodInfoUrl(c.id)]);
  const colLinks = FIBER.map(c => goodInfoUrl(c.id));

  return (
    <EditableGrid viewId="ai-supply-fiber">
      <ChartCard chartId="supply-fiber-yoy"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && yoyData.datasets.length > 0 ? <Line data={yoyData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-fiber-mom"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && momData.datasets.length > 0 ? <Line data={momData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-fiber-rev"
        legend={legend} colLinks={colLinks} height={360} span2 isNew clean>
        {hasLive && revData.datasets.length > 0 ? <Line data={revData} options={revOpts} /> : <NoData />}
      </ChartCard>
    </EditableGrid>
  );
}
