import { useLayoutEffect } from 'react';
import { useDashboard } from '../../context/DashboardContext';

import DemandOpenRouter from './OpenRouter';
import DemandGeneral    from './InfrastructureOss';
import HuggingFace      from '../sources/HuggingFace';

// One consolidated page that pulls a curated set of charts out of three normal
// views via the dashboard's page-chart whitelist (so the charts keep their own
// data logic — nothing is duplicated). Only these ids render while mounted:
//   - OpenRouter: top-10 models, week-over-week token growth
//   - Infrastructure & OSS bar charts (excludes the GPU bars and the
//     line/trend charts: MCP, SEC filings, HN)
//   - Consumer (HuggingFace) bar charts, excluding "most-downloaded models"
const MARKET_CHARTS = [
  'or-top', 'or-growth',
  'gen-commits', 'gen-docker', 'gen-cnmarket',
  'hf-families', 'hf-categories', 'hf-uploads',
];

export default function MarketSignals({ weeks }) {
  const { enterPage, exitPage } = useDashboard();

  useLayoutEffect(() => {
    enterPage(MARKET_CHARTS);
    return () => exitPage();
  }, [enterPage, exitPage]);

  return (
    <>
      <DemandOpenRouter weeks={weeks} />
      <DemandGeneral weeks={weeks} />
      <HuggingFace weeks={weeks} />
    </>
  );
}
