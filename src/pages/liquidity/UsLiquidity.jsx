import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useResource } from '../../services/resourceCache';
import { baseOpts, mkDs } from '../../utils/chartHelpers';

const BLUE = '#4577b4';
const GOLD = '#c9a227';
const GREEN = '#5a9f6b';
const RED = '#c65d57';
const PURPLE = '#7864b4';

function fmtUsdM(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}T`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}B`;
  return `$${value.toFixed(0)}M`;
}
function fmtUsdB(value) {
  if (!Number.isFinite(value)) return '—';
  return `$${value.toFixed(0)}B`;
}
function fmtPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}
function fmtBps(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}bp`;
}

function dateLabel(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const month = parsed.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} '${String(parsed.getUTCFullYear()).slice(-2)}`;
}

function windowed(points, years) {
  if (!points?.length || !years) return points ?? [];
  const cutoff = new Date(`${points.at(-1).date}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const start = cutoff.toISOString().slice(0, 10);
  return points.filter(point => point.date >= start);
}

function Tile({ label, value, color, fmt }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label"><span className="lev-dot" style={{ background: color }} />{label}</div>
      <div className="lev-tile-value">{fmt(value)}</div>
    </div>
  );
}

function SeriesChart({ payload, seriesKey, color, fmt, chartId, srcNote, height = 320, years = 0, span2 = false }) {
  const meta = payload?.series?.[seriesKey];
  const error = payload?.errors?.[seriesKey];
  const points = useMemo(() => windowed(meta?.data, years), [meta, years]);

  if (!meta && error) return <ChartCard chartId={chartId} title={seriesKey} height={height}><div className="empty">Data unavailable: {error}</div></ChartCard>;
  if (!points.length) return <ChartCard chartId={chartId} title={meta?.name ?? seriesKey} height={height}><div className="empty">No stored history yet. The daily collector will populate it.</div></ChartCard>;

  const data = {
    labels: points.map(point => dateLabel(point.date)),
    datasets: [{
      ...mkDs(meta.name, color, points.map(point => point.value), true),
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHitRadius: 8,
    }],
  };
  const options = baseOpts(fmt);
  options.plugins.tooltip.callbacks.title = items => points[items[0]?.dataIndex]?.date ?? '';

  return (
    <ChartCard
      chartId={chartId} title={meta.name}
      src={meta.source} srcUrl={meta.sourceUrl}
      freq={meta.frequency} height={height} span2={span2}
      srcNote={srcNote}
    >
      <Line data={data} options={options} />
    </ChartCard>
  );
}

function FedBalance({ payload }) {
  const latest = payload.series?.netAssets?.data?.at(-1)?.value;
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats"><Tile label="Fed net liquidity" value={latest} color={BLUE} fmt={fmtUsdM} /></div>
      </div>
      <div className="cgrid">
        <SeriesChart
          payload={payload} seriesKey="netAssets" color={BLUE} fmt={fmtUsdM}
          chartId="us-liquidity-net-assets" span2
          srcNote="Net Assets = Fed Total Assets − Treasury General Account − ON RRP award volume. Rising = reserves flowing into the banking system; falling = liquidity draining out."
        />
      </div>
      <div className="cgrid">
        <SeriesChart
          payload={payload} seriesKey="totalAssets" color={GOLD} fmt={fmtUsdM}
          chartId="us-liquidity-total-assets"
          srcNote="Federal Reserve total balance sheet assets — Wednesday level, published weekly."
        />
        <SeriesChart
          payload={payload} seriesKey="tga" color={PURPLE} fmt={fmtUsdM}
          chartId="us-liquidity-tga"
          srcNote="Treasury General Account balance held at the Fed. A falling TGA (e.g. after a debt-ceiling deal) injects reserves into the banking system; a rising TGA drains them."
        />
        <SeriesChart
          payload={payload} seriesKey="onRrp" color={GREEN} fmt={fmtUsdB}
          chartId="us-liquidity-onrrp"
          srcNote="Overnight Reverse Repurchase Agreement award volume — cash money-market funds park at the Fed overnight, withdrawn from the banking system."
        />
      </div>
    </>
  );
}

function Credit({ payload }) {
  const hy = payload.series?.hySpread?.data?.at(-1)?.value;
  const ig = payload.series?.igSpread?.data?.at(-1)?.value;
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          <Tile label="High Yield spread" value={hy} color={RED} fmt={fmtPct} />
          <Tile label="Investment Grade spread" value={ig} color={BLUE} fmt={fmtPct} />
        </div>
      </div>
      <div className="cgrid">
        <SeriesChart
          payload={payload} seriesKey="hySpread" color={RED} fmt={fmtPct}
          chartId="us-liquidity-hy-spread"
          srcNote="ICE BofA US High Yield Index Option-Adjusted Spread — the extra yield high-yield corporate bonds pay over Treasuries. Widening signals rising credit stress. FRED's public download of this ICE-licensed series is limited to roughly the trailing three years."
        />
        <SeriesChart
          payload={payload} seriesKey="igSpread" color={BLUE} fmt={fmtPct}
          chartId="us-liquidity-ig-spread"
          srcNote="ICE BofA US Corporate Index Option-Adjusted Spread — the investment-grade counterpart to the high-yield spread above."
        />
      </div>
    </>
  );
}

function Interbank({ payload }) {
  const sofrIorb = payload.series?.sofrIorbSpread?.data?.at(-1)?.value;
  const effrIorb = payload.series?.effrIorbSpread?.data?.at(-1)?.value;
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          <Tile label="SOFR − IORB" value={sofrIorb} color={GOLD} fmt={fmtBps} />
          <Tile label="EFFR − IORB" value={effrIorb} color={RED} fmt={fmtBps} />
        </div>
      </div>
      <div className="cgrid">
        <SeriesChart
          payload={payload} seriesKey="sofrIorbSpread" color={GOLD} fmt={fmtBps}
          chartId="us-liquidity-sofr-iorb"
          srcNote="SOFR minus IORB, in basis points. A rising/positive spread signals repo-market funding pressure relative to the rate the Fed pays banks on reserves — a classic sign of reserve scarcity."
        />
        <SeriesChart
          payload={payload} seriesKey="effrIorbSpread" color={RED} fmt={fmtBps}
          chartId="us-liquidity-effr-iorb"
          srcNote="EFFR minus IORB, in basis points. Tracks where fed funds actually trade relative to the administered IORB rate."
        />
      </div>
    </>
  );
}

export default function UsLiquidity({ section }) {
  // Loads once on first visit, then served from the shared cache on every
  // subsequent mount (stays loaded across navigation and refresh).
  const { data: payload, error } = useResource('/api/us-liquidity');

  if (error) return <div className="empty">US liquidity data unavailable: {error}</div>;
  if (!payload) return <div className="empty">Loading stored US liquidity history…</div>;

  if (section === 'credit') return <Credit payload={payload} />;
  if (section === 'interbank') return <Interbank payload={payload} />;
  return <FedBalance payload={payload} />;
}
