import { useEffect } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { chartsForSector } from '../../config/charts';

import PyPI            from '../sources/PyPI';
import GitHub          from '../sources/GitHub';
import Trends          from '../sources/Trends';
import DemandOpenRouter from '../market-signals/OpenRouter';
import DemandGeneral   from '../market-signals/InfrastructureOss';
import HuggingFace     from '../sources/HuggingFace';
import Pricing         from '../pricing/Pricing';
import Datacenter      from '../sources/Datacenter';
import Electricity     from '../sources/Electricity';
import Chinese         from '../sources/Chinese';

// The overview is one flat grid (no section headers). Pinned charts flow in the
// order their views are mounted here; per-chart width is set in CSS
// (.sector-overview [data-chart-id=...]). Views with nothing pinned render
// nothing — PyPI/GitHub/Pricing are mounted last only so the Customise dropdown
// can still surface their charts if a user pins one.
const OVERVIEW_VIEWS = [
  DemandOpenRouter,   // OpenRouter rankings (half-width, top)
  Trends,             // Google Trends (half)
  Chinese,            // Input token pricing (half)
  DemandGeneral,      // OSS signals (quarter each)
  HuggingFace,        // HuggingFace most-downloaded (quarter)
  Datacenter,         // Datacenter capex (half)
  Electricity,        // Electricity (half)
  PyPI, GitHub, Pricing,
];

export default function SectorOverview({ sectorId, weeks }) {
  const { enterSector, exitSector, isPinned } = useDashboard();

  useEffect(() => {
    enterSector(sectorId);
    return () => exitSector();
  }, [sectorId, enterSector, exitSector]);

  const totalPinned = Object.values(chartsForSector(sectorId))
    .flat()
    .filter(c => isPinned(c.id, sectorId)).length;

  return (
    <div className="sector-overview">
      {totalPinned === 0 && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--sec)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>
          No charts selected. Use <strong style={{ color: 'var(--text)' }}>Customise</strong> in the top right to add charts.
        </div>
      )}
      {OVERVIEW_VIEWS.map(Component => (
        <Component key={Component.name} weeks={weeks} />
      ))}
    </div>
  );
}
