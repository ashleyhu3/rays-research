import { useEffect } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { chartsForSector } from '../config/charts';

import PyPI        from './PyPI';
import GitHub      from './GitHub';
import Trends      from './Trends';
import Reddit      from './Reddit';
import Web         from './Web';
import HuggingFace from './HuggingFace';
import GPU         from './GPU';
import Datacenter  from './Datacenter';
import Electricity from './Electricity';
import Chinese     from './Chinese';

const DEMAND_VIEWS = [
  { Component: PyPI        },
  { Component: GitHub      },
  { Component: Trends      },
  { Component: Reddit      },
  { Component: Web         },
  { Component: HuggingFace },
  { Component: GPU         },
  { Component: Datacenter  },
  { Component: Electricity },
  { Component: Chinese     },
];

const SECTOR_VIEWS = {
  overview:  DEMAND_VIEWS,
  dev:      [{ Component: PyPI }, { Component: GitHub }, { Component: Trends }],
  consumer: [{ Component: Reddit }, { Component: Web }, { Component: HuggingFace }],
  infra:    [{ Component: GPU }, { Component: Datacenter }, { Component: Electricity }],
  tokens:   [{ Component: Chinese }],
};

export default function SectorOverview({ sectorId, weeks }) {
  const { enterSector, exitSector, isPinned } = useDashboard();

  useEffect(() => {
    enterSector(sectorId);
    return () => exitSector();
  }, [sectorId, enterSector, exitSector]);

  const views = SECTOR_VIEWS[sectorId] ?? [];
  const totalPinned = Object.values(chartsForSector(sectorId))
    .flat()
    .filter(c => isPinned(c.id, sectorId)).length;

  return (
    <div>
      {totalPinned === 0 && (
        <div style={{ color: 'var(--sec)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>
          No charts selected. Use <strong style={{ color: 'var(--text)' }}>Customise</strong> in the top right to add charts.
        </div>
      )}
      {views.map(({ Component }) => (
        <Component key={Component.name} weeks={weeks} />
      ))}
    </div>
  );
}
