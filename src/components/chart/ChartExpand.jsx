import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Small icon button that triggers the expanded (fill-the-page) chart view.
export function ExpandButton({ onClick, className = 'ch-expand-btn' }) {
  return (
    <button className={className} title="Expand chart" aria-label="Expand chart" onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    </button>
  );
}

// Full-page overlay holding an expanded chart. Rendered into document.body so it
// escapes any parent overflow/stacking context; closing it (✕, Esc, or backdrop
// click) unmounts the overlay and leaves the page exactly as it was.
export function ChartModal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // lock background scroll while open
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="ch-modal-backdrop" onClick={onClose}>
      <div className="ch-modal" onClick={e => e.stopPropagation()}>
        <div className="ch-modal-head">
          <div className="ch-title">{title}</div>
          <button className="ch-modal-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="ch-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
