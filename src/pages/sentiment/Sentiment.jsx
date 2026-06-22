import { useMemo, useState, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, mkDs, dualAxisOpts, GRID, TICK, BORD } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

/* StockTwits posting-volume & sentiment vs stock price (methodology §10).
   Default view = aggregate charts (bull/bear, category rolling correlations for
   every metric, plus the cross-sectional scatters). A ticker search box isolates
   a single name's charts, mirroring the Options tab. */

const CAT_COLOR = {
  'Memory Semiconductors': '#378ADD',
  'Optics':                '#1D9E75',
  'Optics Equipment':      '#EF9F27',
  'Semi Equipment':        '#D85A30',
};

const monthLabel = iso =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function lsFit(xs, ys) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (x == null || y == null || !isFinite(x) || !isFinite(y)) continue;
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const d = n * sxx - sx * sx;
  if (n < 2 || d === 0) return null;
  const m = (n * sxy - sx * sy) / d;
  return { m, b: (sy - m * sx) / n };
}

function scatterOpts({ xTitle, yTitle, xFmt = v => v, yFmt = v => v, pointLabel }) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: { display: true, position: 'bottom', labels: { color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 10, boxWidth: 10 } },
      tooltip: {
        backgroundColor: '#1a1f2a', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
        callbacks: { label: c => (pointLabel ? pointLabel(c) : ` (${xFmt(c.parsed.x)}, ${yFmt(c.parsed.y)})`) },
      },
    },
    scales: {
      x: { type: 'linear', title: { display: !!xTitle, text: xTitle, color: '#b0b0a8', font: { size: 11 } }, grid: GRID, ticks: { ...TICK, callback: v => xFmt(v) }, border: BORD },
      y: { title: { display: !!yTitle, text: yTitle, color: '#b0b0a8', font: { size: 11 } }, grid: GRID, ticks: { ...TICK, callback: v => yFmt(v) }, border: BORD },
    },
  };
}

// Multi-line-by-category rolling chart from rolling.byMetric[metric].
function catRolling(byCat) {
  if (!byCat || !Object.keys(byCat).length) return null;
  const dateSet = new Set();
  Object.values(byCat).forEach(v => v.dates.forEach(d => dateSet.add(d)));
  const dates = [...dateSet].sort();
  const datasets = Object.entries(byCat).map(([cat, v]) => {
    const m = Object.fromEntries(v.dates.map((d, i) => [d, v.values[i]]));
    return { ...mkDs(cat, CAT_COLOR[cat] ?? C.slate, dates.map(d => (d in m ? m[d] : null)), false), spanGaps: true, pointRadius: 0 };
  });
  return { labels: dates.map(monthLabel), datasets };
}

// One scatter dataset per sector.
function sectorScatter(sd, xf, yf, metaf) {
  return Object.entries(sd.categories ?? {}).map(([cat, ts]) => {
    const data = ts.map(t => {
      const v = sd.tickers[t]; if (!v) return null;
      const x = xf(v), y = yf(v);
      if (x == null || y == null || !isFinite(x) || !isFinite(y)) return null;
      return { x, y, ...metaf(t, v) };
    }).filter(Boolean);
    return data.length
      ? { label: cat, data, showLine: false, pointRadius: 5, pointHoverRadius: 7, backgroundColor: fa(CAT_COLOR[cat] ?? C.slate, 0.7), borderColor: CAT_COLOR[cat] ?? C.slate }
      : null;
  }).filter(Boolean);
}

export default function Sentiment() {
  const { liveData } = useData();
  const sd = liveData?.sentiment;
  const [input, setInput] = useState('');
  const [ticker, setTicker] = useState(null);
  const inputRef = useRef(null);

  const v = (sd && ticker && sd.tickers[ticker]) || null;
  const tkColor = v ? (CAT_COLOR[v.category] ?? C.openai) : C.openai;

  // ── Aggregate charts ──────────────────────────────────────────────────
  const aggData = useMemo(() => {
    const a = sd?.aggregate;
    if (!a?.dates?.length) return null;
    return {
      labels: a.dates.map(monthLabel),
      datasets: [
        { ...mkDs('Bullish %', C.openai, a.bullPct, true), spanGaps: true, pointRadius: 0 },
        { ...mkDs('Bearish %', C.red,    a.bearPct, true), spanGaps: true, pointRadius: 0 },
      ],
    };
  }, [sd]);

  const catVolPrice = useMemo(() => (sd ? catRolling(sd.rolling?.byMetric?.volPrice) : null), [sd]);
  const catVolNext  = useMemo(() => (sd ? catRolling(sd.rolling?.byMetric?.volNextR) : null), [sd]);
  const catSentNext = useMemo(() => (sd ? catRolling(sd.rolling?.byMetric?.sentNext) : null), [sd]);

  const levelReturns = useMemo(() => {
    if (!sd) return null;
    const ds = sectorScatter(sd, x => x.corr?.priceLevel?.r, y => y.corr?.currReturn?.r, t => ({ ticker: t }));
    return ds.length ? { datasets: ds } : null;
  }, [sd]);

  const significance = useMemo(() => {
    if (!sd) return null;
    const ds = sectorScatter(sd,
      x => x.daily?.volNextR?.r,
      y => { const p = y.daily?.volNextR?.p; return p == null ? null : -Math.log10(Math.max(p, 1e-6)); },
      (t, x) => ({ ticker: t, p: x.daily?.volNextR?.p }));
    if (!ds.length) return null;
    const xs = ds.flatMap(d => d.data.map(p => p.x));
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    for (const [lbl, p] of [['p=0.05', 0.05], ['p=0.01', 0.01]]) {
      const y = -Math.log10(p);
      ds.push({ label: lbl, data: [{ x: xmin, y }, { x: xmax, y }], showLine: true, pointRadius: 0, borderColor: fa(C.slate, 0.5), borderDash: [4, 4], borderWidth: 1, fill: false });
    }
    return { datasets: ds };
  }, [sd]);

  // ── Per-ticker charts ─────────────────────────────────────────────────
  const tkWeeklyVP = useMemo(() => {
    const w = v?.weekly; if (!w?.dates?.length) return null;
    return {
      labels: w.dates.map(monthLabel),
      datasets: [
        { ...mkDs('Weekly posts', tkColor, w.volume, false), yAxisID: 'y',  spanGaps: true, pointRadius: 0 },
        { ...mkDs('Close price', C.red,    w.price,  false), yAxisID: 'y1', spanGaps: true, pointRadius: 0 },
      ],
    };
  }, [v, tkColor]);

  const tkSentiment = useMemo(() => {
    const w = v?.weekly; if (!w?.dates?.length) return null;
    return {
      labels: w.dates.map(monthLabel),
      datasets: [
        { ...mkDs('Bullish %', C.openai, w.bullPct, true), spanGaps: true, pointRadius: 0 },
        { ...mkDs('Bearish %', C.red,    w.bearPct, true), spanGaps: true, pointRadius: 0 },
      ],
    };
  }, [v]);

  const tkLeadLag = useMemo(() => {
    const s = v?.scatter; if (!s?.count?.length) return null;
    const pts = s.count.map((c, i) => ({ x: c, y: s.ret[i] })).filter(p => isFinite(p.x) && isFinite(p.y));
    const ds = [{ label: `${ticker} days`, data: pts, showLine: false, pointRadius: 3, pointHoverRadius: 5, backgroundColor: fa(tkColor, 0.5), borderColor: tkColor }];
    const f = lsFit(s.count, s.ret);
    if (f) {
      const xmin = Math.min(...s.count), xmax = Math.max(...s.count);
      ds.push({ label: 'Trend', data: [{ x: xmin, y: f.m * xmin + f.b }, { x: xmax, y: f.m * xmax + f.b }], showLine: true, pointRadius: 0, borderColor: C.red, borderDash: [5, 4], borderWidth: 1.5, fill: false });
    }
    return { datasets: ds };
  }, [v, ticker, tkColor]);

  const tkRolling = useMemo(() => {
    const r = v?.rolling; if (!r?.dates?.length) return null;
    return {
      labels: r.dates.map(monthLabel),
      datasets: [
        { ...mkDs('Vol ↔ price level',       C.openai,    r.volPrice, false), spanGaps: true, pointRadius: 0 },
        { ...mkDs('Vol → next-day return',   C.anthropic, r.volNextR, false), spanGaps: true, pointRadius: 0 },
        { ...mkDs('Sentiment → next-day',    C.minimax,   r.sentNext, false), spanGaps: true, pointRadius: 0 },
      ],
    };
  }, [v]);

  function search(raw) {
    const t = (raw ?? input).trim().toUpperCase();
    if (!t) return;
    setInput(t);
    setTicker(t);
  }

  const corrTip = c => ` ${c.raw.ticker}: (${c.parsed.x?.toFixed(2)}, ${c.parsed.y?.toFixed(2)})`;
  const asOf = sd?.asOf ? ` · as of ${sd.asOf}` : '';
  const available = sd ? Object.keys(sd.tickers) : [];

  return (
    <div className="opts-page">
      {/* Search bar — one ticker isolates its charts; empty = aggregate view */}
      <form className="opts-search-row" onSubmit={e => { e.preventDefault(); search(); }}>
        <input
          ref={inputRef}
          className="opts-input"
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          placeholder="Enter a ticker to isolate — MU, SNDK, AAOI…"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
        />
        <button className="opts-search-btn" type="submit" disabled={!input.trim()}>Search</button>
        {ticker && (
          <button type="button" className="opts-search-btn" onClick={() => { setTicker(null); setInput(''); }}>
            ← Aggregate view
          </button>
        )}
      </form>

      {/* Quick-pick chips for the tracked universe */}
      {available.length > 0 && (
        <div className="opts-samples" style={{ marginTop: -4, marginBottom: 14 }}>
          {available.map(t => (
            <button key={t} className={`opts-sample${t === ticker ? ' active' : ''}`} onClick={() => search(t)}>{t}</button>
          ))}
        </div>
      )}

      {!sd ? (
        <div className="opts-loading">Loading StockTwits sentiment analysis…</div>
      ) : !ticker ? (
        /* ── Default: aggregate view ──────────────────────────────────── */
        <EditableGrid viewId="sentiment">
          {aggData && (
            <ChartCard chartId="sent-aggregate" subtitle={`Share of messages tagged Bullish vs Bearish, weekly, pooled across all tracked tickers${asOf}.`}
              legend={[['Bullish %', C.openai], ['Bearish %', C.red]]} height={240} span2>
              <Line data={aggData} options={baseOpts(v2 => `${v2.toFixed(0)}%`)} />
            </ChartCard>
          )}
          {catVolNext && (
            <ChartCard chartId="sent-cat-volnext" subtitle="20-day rolling correlation of posting volume → next-day return, averaged within each sector."
              legend={catVolNext.datasets.map(d => [d.label, d.borderColor])} height={240} span2>
              <Line data={catVolNext} options={baseOpts(v2 => v2.toFixed(2))} />
            </ChartCard>
          )}
          {catVolPrice && (
            <ChartCard chartId="sent-cat-volprice" subtitle="20-day rolling correlation of posting volume vs price level, averaged within each sector."
              legend={catVolPrice.datasets.map(d => [d.label, d.borderColor])} height={240} span2>
              <Line data={catVolPrice} options={baseOpts(v2 => v2.toFixed(2))} />
            </ChartCard>
          )}
          {catSentNext && (
            <ChartCard chartId="sent-cat-sentnext" subtitle="20-day rolling correlation of net sentiment (bull−bear) → next-day return, averaged within each sector."
              legend={catSentNext.datasets.map(d => [d.label, d.borderColor])} height={240} span2>
              <Line data={catSentNext} options={baseOpts(v2 => v2.toFixed(2))} />
            </ChartCard>
          )}
          {levelReturns && (
            <ChartCard chartId="sent-level-returns" subtitle={`Each ticker: volume↔price-LEVEL (x) vs volume↔weekly-RETURN (y). Level and returns are different relationships${asOf}.`}
              height={300} span2>
              <Line data={levelReturns} options={scatterOpts({ xTitle: 'r: volume vs price level', yTitle: 'r: volume vs weekly return', xFmt: v2 => v2.toFixed(1), yFmt: v2 => v2.toFixed(1), pointLabel: corrTip })} />
            </ChartCard>
          )}
          {significance && (
            <ChartCard chartId="sent-significance" subtitle="Each ticker: volume → next-day return correlation (x) vs significance −log10(p) (y). Above the dashed lines clears p<0.05 / p<0.01."
              height={300} span2>
              <Line data={significance} options={scatterOpts({ xTitle: 'Pearson r (volume → next-day return)', yTitle: 'significance −log10(p)', xFmt: v2 => v2.toFixed(2), yFmt: v2 => v2.toFixed(1), pointLabel: c => (c.raw.ticker ? ` ${c.raw.ticker}: r=${c.parsed.x?.toFixed(3)}, p=${c.raw.p ?? '–'}` : ` ${c.dataset.label}`) })} />
            </ChartCard>
          )}
        </EditableGrid>
      ) : !v ? (
        /* ── Invalid ticker ──────────────────────────────────────────── */
        <div className="opts-empty">
          <h2>No StockTwits data for {ticker}</h2>
          <p>Tracked tickers (semiconductor / optics supply chain):</p>
          <div className="opts-samples">
            {available.map(t => <button key={t} className="opts-sample" onClick={() => search(t)}>{t}</button>)}
          </div>
        </div>
      ) : (
        /* ── Per-ticker isolated view ─────────────────────────────────── */
        <EditableGrid viewId="sentiment-ticker" key={ticker}>
          {tkWeeklyVP && (
            <ChartCard chartId="sent-tk-weekly-vp" title={`Weekly Posting Volume vs Price — ${ticker}`}
              subtitle={`Weekly post count (left) against the week's closing price (right). ${v.category} · ${v.totalPosts.toLocaleString()} total posts.`}
              legend={[['Weekly posts', tkColor], ['Close price', C.red]]} height={260} span2>
              <Line data={tkWeeklyVP} options={dualAxisOpts(v2 => v2.toLocaleString(), v2 => `$${v2.toFixed(0)}`)} />
            </ChartCard>
          )}
          {tkSentiment && (
            <ChartCard chartId="sent-tk-sentiment" title={`Bullish vs Bearish — ${ticker}`}
              subtitle="Weekly share of this ticker's messages tagged Bullish vs Bearish."
              legend={[['Bullish %', C.openai], ['Bearish %', C.red]]} height={260} span2>
              <Line data={tkSentiment} options={baseOpts(v2 => `${v2.toFixed(0)}%`)} />
            </ChartCard>
          )}
          {tkLeadLag && (
            <ChartCard chartId="sent-tk-leadlag" title={`Daily Post Count vs Next-Day Return — ${ticker}`}
              subtitle={`Each point is one trading day. Dashed = fitted trend. r=${v.daily?.volNextR?.r ?? '–'} (p=${v.daily?.volNextR?.p ?? '–'}, n=${v.daily?.volNextR?.n ?? '–'}).`}
              height={300} span2>
              <Line data={tkLeadLag} options={scatterOpts({ xTitle: 'Daily post count', yTitle: 'Next-day return (%)', xFmt: v2 => v2.toLocaleString(), yFmt: v2 => `${v2.toFixed(0)}%`, pointLabel: c => ` (${c.parsed.x?.toLocaleString()} posts, ${c.parsed.y?.toFixed(2)}%)` })} />
            </ChartCard>
          )}
          {tkRolling && (
            <ChartCard chartId="sent-tk-rolling" title={`Rolling 20-Day Correlations — ${ticker}`}
              subtitle="This ticker's three rolling correlations over time: volume↔price level, volume→next-day return, and net sentiment→next-day return."
              legend={tkRolling.datasets.map(d => [d.label, d.borderColor])} height={280} span2>
              <Line data={tkRolling} options={baseOpts(v2 => v2.toFixed(2))} />
            </ChartCard>
          )}
        </EditableGrid>
      )}
    </div>
  );
}
