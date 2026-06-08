import { useState } from 'react';
import { VIEW_META } from './config/navigation';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';

import Overview      from './views/Overview';
import PyPI          from './views/PyPI';
import StackOverflow from './views/StackOverflow';
import Trends        from './views/Trends';
import Jobs          from './views/Jobs';
import AppStore      from './views/AppStore';
import Tokens        from './views/Tokens';

const VIEW_COMPONENTS = {
  overview:      Overview,
  pypi:          PyPI,
  stackoverflow: StackOverflow,
  trends:        Trends,
  jobs:          Jobs,
  appstore:      AppStore,
  tokens:        Tokens,
};

export default function App() {
  const [currentSection, setCurrentSection] = useState('ai-demand');
  const [currentView, setCurrentView] = useState('overview');
  const [weeks, setWeeks] = useState(12);

  const meta = VIEW_META[currentView] ?? { title: currentView.toUpperCase(), isNew: false };
  const ViewComponent = VIEW_COMPONENTS[currentView];

  function handleSectionChange(section) {
    setCurrentSection(section);
    if (section === 'ai-demand') setCurrentView('overview');
  }

  return (
    <>
      <Navbar currentSection={currentSection} onSectionChange={handleSectionChange} />
      <div className="app-body">
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
      </div>
    </>
  );
}
