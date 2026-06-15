import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { baseOpts, mkDs, GRID, TICK, BORD } from '../../utils/chartHelpers';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';

// ── Static company list (mirrors server/scrapers/mops.js) ────────────────
const ALL_COMPANIES = [
  { id: '6442', ticker: '6442TT', group: 'optics', exchange: 'twse', name: '光聖'    },
  { id: '3081', ticker: '3081TT', group: 'optics', exchange: 'tpex', name: '聯亞光電' },
  { id: '3363', ticker: '3363TT', group: 'optics', exchange: 'tpex', name: '品興'    },
  { id: '3163', ticker: '3163TT', group: 'optics', exchange: 'tpex', name: '波若威'  },
  { id: '2383', ticker: '2383TT', group: 'pcb',    exchange: 'twse', name: '台光電'   },
  { id: '2368', ticker: '2368TT', group: 'pcb',    exchange: 'twse', name: '金像電'   },
  { id: '3037', ticker: '3037TT', group: 'pcb',    exchange: 'twse', name: '欣興電子' },
  { id: '8046', ticker: '8046TT', group: 'pcb',    exchange: 'twse', name: '南電'     },
  { id: '4958', ticker: '4958TT', group: 'pcb',    exchange: 'twse', name: '臻鼎-KY'  },
  { id: '6274', ticker: '6274TT', group: 'pcb',    exchange: 'tpex', name: '台燿科技' },
  { id: '8358', ticker: '8358TT', group: 'pcb',    exchange: 'tpex', name: '金像電子' },
];

const OPTICS = ALL_COMPANIES.filter(c => c.group === 'optics');
const PCB    = ALL_COMPANIES.filter(c => c.group === 'pcb');

const OPTICS_COLORS = [C.teal, C.anthropic, C.red, C.orange];
const PCB_COLORS    = [C.openai, C.deepseek, C.google, C.mistral, C.zhipu, C.perplexity, C.kimi];
const ALL_COLORS    = [...OPTICS_COLORS, ...PCB_COLORS];

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


// ── Shared data hook ─────────────────────────────────────────────────────
function useSupplyData(months) {
  const { liveData } = useData();
  const { tableMode } = useUI();
  const liveCompanies = liveData?.mops?.companies ?? null;
  const optics = useMemo(() => mergeCompanyData(OPTICS, liveCompanies), [liveCompanies]);
  const pcb    = useMemo(() => mergeCompanyData(PCB,    liveCompanies), [liveCompanies]);
  const hasLive = optics.some(c => c.monthly.length > 0) || pcb.some(c => c.monthly.length > 0);
  return { optics, pcb, hasLive, tableMode, n: months };
}

function NoData() {
  return (
    <div style={{ color: 'var(--ter)', fontSize: 12, padding: '16px 0' }}>
      No data yet — hit <b style={{ color: 'var(--sec)' }}>Refresh Data</b> to fetch from FinMind open data API.
    </div>
  );
}

// ── Company directory (used on Overview page) ────────────────────────────
function CompanyDirectory({ optics, pcb }) {
  const all = [...optics, ...pcb];

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
                    {c.group === 'optics' ? 'Optics' : 'PCB'}
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
  const { optics, pcb, hasLive, tableMode, n } = useSupplyData(months);

  const allCompanies = useMemo(() => [...optics, ...pcb], [optics, pcb]);
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
        <ChartCard chartId="supply-all-yoy" title="YoY growth (%) — All companies"
          legend={allLegend} colLinks={allColLinks} height={360} isNew span2={tableMode} colorPct clean>
          {hasLive && allYoyData.datasets.length > 0 ? <Line data={allYoyData} options={pctOpts} /> : <NoData />}
        </ChartCard>

        <ChartCard chartId="supply-all-mom" title="MoM growth (%) — All companies"
          legend={allLegend} colLinks={allColLinks} height={360} isNew span2={tableMode} colorPct clean>
          {hasLive && allMomData.datasets.length > 0 ? <Line data={allMomData} options={pctOpts} /> : <NoData />}
        </ChartCard>

        {!tableMode && (
          <ChartCard chartId="supply-total-rev" title="Total monthly revenue (NT$M) — All companies"
            height={300} span2 isNew clean>
            {hasLive && totalRevData.datasets[0]?.data.some(v => v != null) ? <Line data={totalRevData} options={revOpts} /> : <NoData />}
          </ChartCard>
        )}

        <ChartCard chartId="supply-all-rev" title="Monthly revenue (NT$M) — All companies"
          legend={allLegend} colLinks={allColLinks} height={360} span2 isNew clean>
          {hasLive && allRevData.datasets.length > 0 ? <Line data={allRevData} options={revOpts} /> : <NoData />}
        </ChartCard>
      </EditableGrid>

      <div className="cgrid">
        <CompanyDirectory optics={optics} pcb={pcb} />
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
      <ChartCard chartId="supply-optics-yoy" title="YoY growth (%) — Optics"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && yoyData.datasets.length > 0 ? <Line data={yoyData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-optics-mom" title="MoM growth (%) — Optics"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && momData.datasets.length > 0 ? <Line data={momData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-optics-rev" title="Monthly revenue (NT$M) — Optics"
        legend={legend} colLinks={colLinks} height={360} span2 isNew clean>
        {hasLive && revData.datasets.length > 0 ? <Line data={revData} options={revOpts} /> : <NoData />}
      </ChartCard>
    </EditableGrid>
  );
}

// ── Page 3: PCB supply chain ─────────────────────────────────────────────
export function AISupplyPCB({ months = 12 }) {
  const { pcb, hasLive, tableMode, n } = useSupplyData(months);

  const periods = useMemo(() => buildPeriods(pcb, n), [pcb, n]);

  const revData = useMemo(() => ({ labels: periods, datasets: buildRevenueDatasets(pcb, PCB_COLORS, periods) }), [pcb, periods]);
  const yoyData = useMemo(() => ({ labels: periods, datasets: buildYoyDatasets(pcb, PCB_COLORS, periods) }), [pcb, periods]);
  const momData = useMemo(() => ({ labels: periods, datasets: buildMomDatasets(pcb, PCB_COLORS, periods) }), [pcb, periods]);

  const legend   = PCB.map((c, i) => [`${c.ticker} ${c.name}`, PCB_COLORS[i], goodInfoUrl(c.id)]);
  const colLinks = PCB.map(c => goodInfoUrl(c.id));

  return (
    <EditableGrid viewId="ai-supply-pcb">
      <ChartCard chartId="supply-pcb-yoy" title="YoY growth (%) — PCB"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && yoyData.datasets.length > 0 ? <Line data={yoyData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-pcb-mom" title="MoM growth (%) — PCB"
        legend={legend} colLinks={colLinks} height={360} isNew span2={tableMode} colorPct clean>
        {hasLive && momData.datasets.length > 0 ? <Line data={momData} options={pctOpts} /> : <NoData />}
      </ChartCard>

      <ChartCard chartId="supply-pcb-rev" title="Monthly revenue (NT$M) — PCB"
        legend={legend} colLinks={colLinks} height={360} span2 isNew clean>
        {hasLive && revData.datasets.length > 0 ? <Line data={revData} options={revOpts} /> : <NoData />}
      </ChartCard>
    </EditableGrid>
  );
}
