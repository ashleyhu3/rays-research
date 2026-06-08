import { C } from '../config/colors';
import { NAV_SECTIONS } from '../config/navigation';

const LEGEND_ITEMS = [
  { color: C.openai,    label: 'OpenAI / ChatGPT' },
  { color: C.anthropic, label: 'Anthropic / Claude' },
  { color: C.google,    label: 'Google / Gemini' },
  { color: C.minimax,   label: 'MiniMax' },
  { color: C.zhipu,     label: 'Zhipu / GLM' },
  { color: C.deepseek,  label: 'DeepSeek' },
];

export default function Sidebar({ currentView, onNavigate }) {
  return (
    <aside className="sidebar">
      {/* Navigation sections */}
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="nav-sec">
          <div className="nav-lbl">{section.label}</div>
          {section.items.map((item) => (
            <button
              key={item.id}
              className={`nav-item${currentView === item.id ? ' active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="nav-ico">{item.icon}</span>
              {item.label}
              {item.tag && <span className="utag">{item.tag}</span>}
            </button>
          ))}
        </div>
      ))}

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="last-upd">
          Refreshed: <b>May 11, 2026 · 09:14 ET</b>
        </div>
        <div className="leg-block">
          {LEGEND_ITEMS.map(({ color, label }) => (
            <div key={label} className="leg">
              <div className="leg-dot" style={{ background: color }} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
