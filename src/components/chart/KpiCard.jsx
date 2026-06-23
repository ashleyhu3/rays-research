/**
 * KpiCard — single metric tile in the overview row.
 * @param {{ val: string, label: string, delta: string, deltaClass: string, accentColor: string }} props
 */
export default function KpiCard({ val, label, delta, deltaClass = 'nt', accentColor }) {
  return (
    <div
      className="kpi"
      style={{ '--kpi-accent': accentColor }}
    >
      <div className="kpi-val" style={{ color: accentColor }}>{val}</div>
      <div className="kpi-lbl">{label}</div>
      <div className={`kpi-delta ${deltaClass}`}>{delta}</div>
    </div>
  );
}
