import React, { useEffect, useRef, useState } from 'react';
import { useUI } from '../context/UIContext';
import { useDashboard } from '../context/DashboardContext';
import InlineLegend from './InlineLegend';
import InsightBox from './InsightBox';

function fmtCell(v) {
  if (v == null) return '—';
  if (typeof v !== 'number') return String(v);
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (!Number.isInteger(v)) return v.toFixed(2);
  return v.toLocaleString();
}


export default function ChartCard({
  chartId,
  title, src, srcUrl, freq, subtitle, legend, insight, srcNote,
  isNew, span2, height = 200, children,
  transposed = false, rowLinks = [], colLinks = [], colorPct = false, clean = false,
}) {
  const { tableMode } = useUI();
  const { sectorOverviewMode, activeSector, isPinned, pageCharts } = useDashboard();

  // Series filter: any chart with 2+ labeled datasets gets a dropdown to
  // toggle individual series on/off (hidden labels are card-local state)
  const [hiddenSeries, setHiddenSeries] = useState([]);
  const [filterOpen, setFilterOpen]     = useState(false);
  const filterRef = useRef(null);

  useEffect(() => {
    if (!filterOpen) return;
    const close = e => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterOpen]);

  if (sectorOverviewMode && chartId && !isPinned(chartId, activeSector)) return null;
  if (pageCharts && chartId && !pageCharts.has(chartId)) return null;
  const cls = ['cbox', isNew && 'new', span2 && 'span2'].filter(Boolean).join(' ');

  const chartChild = React.Children.toArray(children)[0];
  const rawData    = chartChild?.props?.data;

  const filterable = rawData?.datasets?.length > 1 && rawData.datasets.every(d => d.label);
  const hidden     = new Set(hiddenSeries);
  const chartData  = filterable && hiddenSeries.length > 0
    ? { ...rawData, datasets: rawData.datasets.filter(d => !hidden.has(d.label)) }
    : rawData;
  const content = filterable && chartData !== rawData
    ? React.cloneElement(chartChild, { data: chartData })
    : children;

  const toggleSeries = label => {
    setHiddenSeries(prev => {
      const next = prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label];
      // Never allow hiding the last visible series
      return next.length >= rawData.datasets.length ? prev : next;
    });
  };

  const seriesFilter = filterable && (
    <div className="ch-filter" ref={filterRef}>
      <button
        className={`ch-filter-btn${hiddenSeries.length > 0 ? ' ch-filter-btn--active' : ''}`}
        title="Filter series"
        onClick={() => setFilterOpen(o => !o)}
      >
        {hiddenSeries.length > 0
          ? `${rawData.datasets.length - hiddenSeries.length}/${rawData.datasets.length} series ▾`
          : 'series ▾'}
      </button>
      {filterOpen && (
        <div className="ch-filter-menu">
          {rawData.datasets.map(ds => (
            <label key={ds.label} className="ch-filter-item">
              <input
                type="checkbox"
                checked={!hidden.has(ds.label)}
                onChange={() => toggleSeries(ds.label)}
              />
              <span
                className="ch-filter-dot"
                style={{ background: ds.borderColor ?? ds.backgroundColor }}
              />
              {ds.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );

  const showTable = tableMode && chartData?.labels?.length > 0 && chartData?.datasets?.length > 0;

  const STICKY_W = 180;
  const TH_PAD   = '7px 12px';
  const TD_PAD   = '6px 12px';
  const TABLE_FS = '14px';

  return (
    <div className={cls}>
      {clean ? (
        <>
          <div style={{ textAlign: 'center', marginBottom: 12, position: 'relative' }}>
            <div className="ch-title">{title}</div>
            {seriesFilter && <div style={{ position: 'absolute', right: 0, top: 0 }}>{seriesFilter}</div>}
          </div>
          {legend && !showTable && <InlineLegend items={legend} />}
        </>
      ) : (
        <>
          <div className="ch-head">
            <div className="ch-title">{title}</div>
            <div className="ch-meta">
              {seriesFilter}
              {freq && <span className={`freq-badge freq-${freq}`}>{freq}</span>}
              {src && (
                srcUrl
                  ? <a className="ch-src" href={srcUrl} target="_blank" rel="noopener noreferrer">{src}</a>
                  : <span className="ch-src">{src}</span>
              )}
            </div>
          </div>
          {subtitle && <div className="ch-sub">{subtitle}</div>}
          {legend && <InlineLegend items={legend} />}
        </>
      )}

      {showTable && transposed ? (
        <div className="ch-table-wrap" style={{ maxHeight: Math.max(height, 320) }}>
          <table className="ch-table" style={{ width: 'max-content', minWidth: '100%', fontSize: TABLE_FS }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, zIndex: 2, background: 'rgba(17,20,25,.98)', textAlign: 'left', padding: TH_PAD, minWidth: STICKY_W }}>
                  Ticker
                </th>
                {chartData.labels.map((label, i) => (
                  <th key={i} style={{ padding: TH_PAD }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartData.datasets.map((ds, i) => (
                <tr key={i}>
                  <td style={{ position: 'sticky', left: 0, zIndex: 1, background: 'rgba(17,20,25,.97)', textAlign: 'left', whiteSpace: 'nowrap', padding: TD_PAD }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: ds.borderColor, marginRight: 6, flexShrink: 0, verticalAlign: 'middle' }} />
                    {rowLinks[i] ? (
                      <a href={rowLinks[i]} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--text)', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,.2)' }}>
                        {ds.label}
                      </a>
                    ) : ds.label}
                  </td>
                  {chartData.labels.map((_, j) => {
                    const v = ds.data[j];
                    const color = colorPct && typeof v === 'number' ? (v > 0 ? '#4ade80' : v < 0 ? '#f87171' : undefined) : undefined;
                    return <td key={j} style={{ padding: TD_PAD, color }}>{fmtCell(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : showTable ? (
        <div className="ch-table-wrap" style={{ maxHeight: height }}>
          <table className="ch-table">
            <thead>
              <tr>
                <th></th>
                {chartData.datasets.map((ds, i) => {
                  const label = ds.label ?? (chartData.datasets.length === 1 ? 'Value' : `Series ${i + 1}`);
                  const url   = colLinks[i];
                  return (
                    <th key={i}>
                      {url
                        ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,.2)' }}>{label}</a>
                        : label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {chartData.labels.map((label, i) => (
                <tr key={i}>
                  <td>{label}</td>
                  {chartData.datasets.map((ds, j) => {
                    const v = ds.data[i];
                    const color = colorPct && typeof v === 'number' ? (v > 0 ? '#4ade80' : v < 0 ? '#f87171' : undefined) : undefined;
                    return <td key={j} style={{ color }}>{fmtCell(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: 'relative', height }}>{content}</div>
      )}

      {insight && <InsightBox html={insight} />}
      {srcNote && <div className="src-note">{srcNote}</div>}
    </div>
  );
}
