/**
 * InlineLegend
 * @param {{ items: [label: string, color: string][] }} props
 */
export default function InlineLegend({ items }) {
  return (
    <div className="ileg">
      {items.map(([label, color]) => (
        <div key={label} className="il">
          <div className="il-dot" style={{ background: color }} />
          {label}
        </div>
      ))}
    </div>
  );
}
