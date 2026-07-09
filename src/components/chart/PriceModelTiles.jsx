/**
 * Reference-style per-model price tiles shown above a spot-price line chart
 * (modelled on the Ornn OCPI GPU-rental layout: one small card per model with
 * its latest price and 7-day / 30-day change).
 *
 * Each tile is colour-matched to the same model's line in the chart directly
 * below — the dot and accent bar reuse the line's palette colour, while the
 * value and labels stay in ink/status tokens. The displayed price is the last
 * point of the very series the chart plots, so the tile and the line always
 * agree on "where the line ends now".
 *
 * tiles: [{ model, color, price, chg7d, chg30d, variants, stale }]
 * fmt:   value formatter shared with the chart's y-axis (e.g. v => `$${v.toFixed(2)}`)
 * unit:  optional suffix rendered after the price (e.g. '/hr')
 */
function pctClass(v) { return v == null ? 'nt' : v > 0.05 ? 'up' : v < -0.05 ? 'dn' : 'nt'; }
function pctText(v)  { return v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`; }

export default function PriceModelTiles({ tiles, fmt, unit }) {
  if (!tiles?.length) return null;
  return (
    <div className="pm-tiles">
      {tiles.map(t => (
        <div
          key={t.model}
          className="pm-tile"
          style={{ '--pm-accent': t.color }}
          title={
            t.stale ? `${t.model} — last live quote ${t.stale}; carried forward`
            : t.variants ? `${t.model} — aggregate of ${t.variants} variant${t.variants > 1 ? 's' : ''}`
            : t.model
          }
        >
          <div className="pm-tile-hd">
            <span className="pm-dot" style={{ background: t.color }} />
            <span className="pm-name">{t.model}</span>
            {t.stale && <span className="pm-stale" title={`No live quote since ${t.stale} — value carried forward`}>·{t.stale}</span>}
          </div>
          <div className="pm-price" style={{ color: t.color }}>{fmt(t.price)}{unit && <span className="pm-unit">{unit}</span>}</div>
          <div className="pm-deltas">
            <span className="pm-d-grp"><span className="pm-d-lbl">7d</span><span className={pctClass(t.chg7d)}>{pctText(t.chg7d)}</span></span>
            <span className="pm-d-grp"><span className="pm-d-lbl">30d</span><span className={pctClass(t.chg30d)}>{pctText(t.chg30d)}</span></span>
          </div>
        </div>
      ))}
    </div>
  );
}
