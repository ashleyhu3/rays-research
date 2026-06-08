import { useState } from 'react';
import { VIEW_META } from './config/navigation';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';

// ── View components (static imports for reliability) ─────────────────
import Overview      from './views/Overview';
import PyPI          from './views/PyPI';
import StackOverflow from './views/StackOverflow';
import GitHub        from './views/GitHub';
import Trends        from './views/Trends';
import Jobs          from './views/Jobs';
import AppStore      from './views/AppStore';
import Web           from './views/Web';
import Reddit        from './views/Reddit';
import HuggingFace   from './views/HuggingFace';
import GPU           from './views/GPU';
import Datacenter    from './views/Datacenter';
import Electricity   from './views/Electricity';
import Tokens        from './views/Tokens';
import Chinese       from './views/Chinese';

/** Map view id → React component */
const VIEW_COMPONENTS = {
  overview:      Overview,
  pypi:          PyPI,
  stackoverflow: StackOverflow,
  github:        GitHub,
  trends:        Trends,
  jobs:          Jobs,
  appstore:      AppStore,
  web:           Web,
  reddit:        Reddit,
  hf:            HuggingFace,
  gpu:           GPU,
  datacenter:    Datacenter,
  electricity:   Electricity,
  tokens:        Tokens,
  chinese:       Chinese,
};

export default function App() {
  const [currentView, setCurrentView] = useState('overview');
  const [weeks, setWeeks] = useState(12);

  const meta = VIEW_META[currentView] ?? { title: currentView.toUpperCase(), isNew: false };
  const ViewComponent = VIEW_COMPONENTS[currentView];

  return (
    <>
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />

      <main className="main">
        <Topbar
          title={meta.title}
          isNew={meta.isNew}
          weeks={weeks}
          onWeeksChange={setWeeks}
        />
        <div className="content">
          {ViewComponent && <ViewComponent weeks={weeks} />}
        </div>
      </main>
    </>
  );
}
