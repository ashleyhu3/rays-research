import { useState, useRef, useEffect } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { useLayout } from '../../context/LayoutContext';
import { useUI } from '../../context/UIContext';
import { chartsForSector } from '../../config/charts';

const WEEK_OPTIONS = [
  { value: 13,  label: '3M' },
  { value: 26,  label: '6M' },
  { value: 39,  label: '9M' },
  { value: 52,  label: '1Y' },
  { value: 104, label: '2Y' },
];

const MONTH_OPTIONS = [
  { value: 6,  label: '6M' },
  { value: 12, label: '1Y' },
  { value: 24, label: '2Y' },
];

const SUB_VIEW_LABELS = {
  pypi:        'PyPI / npm',
  github:      'GitHub dependents',
  openrouter:  'OpenRouter rankings',
  general:     'Infrastructure & OSS',
  web:         'Web traffic & stickiness',
  hf:          'HuggingFace downloads',
  gpu:         'GPU spot pricing',
  datacenter:  'US datacenter build',
  electricity: 'AI electricity demand',
  chinese:     'Chinese LLM usage',
};

function CustomizeDropdown({ sectorId }) {
  const { isPinned, togglePin } = useDashboard();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const chartGroups = chartsForSector(sectorId);

  return (
    <div className="cust-wrap" ref={ref}>
      <button
        className={`rbtn cust-btn${open ? ' active' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ marginRight: 5, verticalAlign: 'middle' }}>
          <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        </svg>
        Customise
      </button>

      {open && (
        <div className="cust-drop">
          {Object.entries(chartGroups).map(([subView, charts]) => (
            <div key={subView} className="cust-group">
              <div className="cust-group-label">{SUB_VIEW_LABELS[subView] ?? subView}</div>
              {charts.map(chart => (
                <label key={chart.id} className="cust-item">
                  <input
                    type="checkbox"
                    className="cust-check"
                    checked={isPinned(chart.id, sectorId)}
                    onChange={() => togglePin(chart.id, sectorId)}
                  />
                  <span>{chart.title}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Topbar({ title, titleContent, weeks, onWeeksChange, months, onMonthsChange, sectorId, viewId, layoutEditable }) {
  const { editMode, setEditMode } = useUI();
  const { resetLayout } = useLayout();

  return (
    <div className="topbar">
      {titleContent ?? <h1>{title}</h1>}
      <div className="topbar-r">
        {onWeeksChange && WEEK_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`rbtn${weeks === opt.value ? ' active' : ''}`}
            onClick={() => onWeeksChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        {onMonthsChange && MONTH_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`rbtn${months === opt.value ? ' active' : ''}`}
            onClick={() => onMonthsChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        {sectorId && <CustomizeDropdown sectorId={sectorId} />}
        {layoutEditable && editMode && (
          <button
            className="rbtn"
            title="Reset this page's layout to default"
            onClick={() => resetLayout(viewId)}
          >
            Reset Layout
          </button>
        )}
        {layoutEditable && (
          <button
            className={`rbtn${editMode ? ' active' : ''}`}
            title={editMode ? 'Exit layout editing' : 'Rearrange charts on this page'}
            onClick={() => setEditMode(v => !v)}
          >
            {editMode ? 'Done' : 'Edit Layout'}
          </button>
        )}
      </div>
    </div>
  );
}
