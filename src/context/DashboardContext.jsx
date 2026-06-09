import { createContext, useContext, useState, useCallback } from 'react';
import { defaultPins } from '../config/charts';

const STORAGE_KEY = 'sector-pins-v1';

const SECTOR_IDS = ['dev', 'consumer', 'infra', 'tokens', 'overview'];

function buildDefaults() {
  return Object.fromEntries(SECTOR_IDS.map(s => [s, defaultPins(s)]));
}

function loadPins() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaults();
    const parsed = JSON.parse(raw);
    // Merge with defaults so newly-added charts appear
    const defaults = buildDefaults();
    return Object.fromEntries(
      SECTOR_IDS.map(s => [s, parsed[s] ?? defaults[s]])
    );
  } catch {
    return buildDefaults();
  }
}

const DashboardContext = createContext({
  sectorPins:        {},
  isPinned:          () => false,
  togglePin:         () => {},
  sectorOverviewMode: false,
  activeSector:      null,
  enterSector:       () => {},
  exitSector:        () => {},
});

export const useDashboard = () => useContext(DashboardContext);

export function DashboardProvider({ children }) {
  const [sectorPins, setSectorPins] = useState(loadPins);
  const [activeSector, setActiveSector] = useState(null);

  const isPinned = useCallback((chartId, sectorId) =>
    (sectorPins[sectorId] ?? []).includes(chartId),
  [sectorPins]);

  const togglePin = useCallback((chartId, sectorId) => {
    setSectorPins(prev => {
      const cur  = prev[sectorId] ?? [];
      const next = cur.includes(chartId)
        ? cur.filter(id => id !== chartId)
        : [...cur, chartId];
      const updated = { ...prev, [sectorId]: next };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const enterSector = useCallback((sectorId) => setActiveSector(sectorId), []);
  const exitSector  = useCallback(() => setActiveSector(null), []);

  return (
    <DashboardContext.Provider value={{
      sectorPins,
      isPinned,
      togglePin,
      sectorOverviewMode: activeSector !== null,
      activeSector,
      enterSector,
      exitSector,
    }}>
      {children}
    </DashboardContext.Provider>
  );
}
