export default function InlineLegend({ items }) {
  return (
    <div className="ileg">
      {items.map(([label, color, url]) => (
        <div key={label} className="il">
          <div className="il-dot" style={{ background: color }} />
          {url
            ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,.2)' }}>{label}</a>
            : label}
        </div>
      ))}
    </div>
  );
}
