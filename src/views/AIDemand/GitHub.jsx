import { C } from '../../config/colors';
import { fmtK } from '../../utils/chartHelpers';
import { metricTrendCard } from '../../components/MetricTrendCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';

// Repos tracked by server/scrapers/github.js. Star history is backfilled two
// years by server/scripts/backfillGithubStars.js (from stargazer timestamps)
// and extended daily by the scheduler; dependent-repo counts have no historical
// API, so that series builds forward from first run. Both honour the toggle.
const REPOS = [
  { key: 'openai/openai-python',            label: 'openai-python',          color: C.openai    },
  { key: 'anthropics/anthropic-sdk-python', label: 'anthropic-sdk-python',   color: C.anthropic },
  { key: 'googleapis/python-genai',         label: 'google-genai',           color: C.google    },
  { key: 'mistralai/client-python',         label: 'mistralai',              color: C.mistral   },
];

export default function GitHub({ weeks: W }) {
  const { liveData } = useData();
  const mh = liveData?.metricsHistory;

  return (
    <EditableGrid viewId="github">
      {metricTrendCard({
        chartId: 'github-stars',
        weeks: W,
        title: 'GitHub stars per SDK repository — over time',
        src: 'github.com',
        srcUrl: 'https://github.com/openai/openai-python',
        freq: 'daily',
        subtitle: 'Developer mindshare. Stars accumulate; rising slope = accelerating adoption.',
        hist: mh?.github,
        series: REPOS.map(r => ({ metric: `${r.key}.stars`, label: r.label, color: r.color })),
        fmt: fmtK,
        span2: true,
      })}

      {metricTrendCard({
        chartId: 'github-deps',
        weeks: W,
        title: 'GitHub "Used By" — repositories depending on each SDK',
        src: 'github.com/network/dependents',
        srcUrl: 'https://github.com/anthropics/anthropic-sdk-python/network/dependents',
        freq: 'daily',
        subtitle: 'Production adoption signal — separates code that ships from code that demos.',
        hist: mh?.github,
        series: REPOS.map(r => ({ metric: `${r.key}.dependents`, label: r.label, color: r.color })),
        fmt: fmtK,
        span2: true,
      })}
    </EditableGrid>
  );
}
