/**
 * ────────────────────────────────────────────────────────────────────────
 *  CHART INSIGHTS & FOOTNOTES  —  edit the highlighted takeaway text here.
 * ────────────────────────────────────────────────────────────────────────
 * One entry per chart, keyed by its `chartId`:
 *   insight — the highlighted "takeaway" box under the chart (allows simple
 *             HTML such as <b>…</b>)
 *   srcNote — small grey footnote line citing the underlying source(s)
 *
 * Only charts that have a fixed insight/footnote appear here. Charts whose
 * insight is computed from live data keep that text in the view file.
 */
export const CHART_INSIGHTS = {
  // ── Insights ──────────────────────────────────────────────────────────
  'pypi-installs': {
    insight: 'The <b>anthropic</b> package grew <b>+80% in 12 weeks</b>, the fastest of any major provider SDK. OpenAI leads in volume but growth is flat at ~+5% QoQ.',
  },
  'cn-mau': {
    insight: "MiniMax's consumer products scale to <b>20M+ MAU</b> with an average user age under 30. This positions MiniMax as the largest AI-native entertainment company by monthly active users outside the US.",
  },
  'cn-bench': {
    insight: "The benchmark gap has <b>effectively closed</b>. In Jan 2025, the best Chinese model scored ~45% on SWE-bench vs Claude's 70%+. By Apr 2026, the gap is under 1 percentage point — at a fraction of the price.",
  },
  'dc-capex': {
    insight: 'Combined hyperscaler datacenter capex is projected to reach <b>$700B+ in 2026</b> — exceeding global investment in oil & gas for the second consecutive year. However, actual construction completion lags by 20–54 months.',
  },
  'dc-grid': {
    insight: 'The PJM interconnection queue for large loads has grown <b>4× in 24 months</b>. Average wait time for approved 2025 projects is <b>8 years</b> — the single biggest bottleneck to datacenter power delivery.',
  },
  'dc-deals': {
    insight: 'After a record Q3 2025, new datacenter deals dropped <b>40%+ in Q4 2025</b> (ITIF). The Stargate project stalled amid partner disputes. 2026 Q1 shows partial recovery but capex risk remains elevated.',
  },
  'elec-consumption': {
    insight: 'US datacenters now account for <b>50% of all new US electricity demand growth</b> — far outpacing residential, industrial, and transport sectors combined (IEA, April 2026).',
  },
  'elec-rates': {
    insight: "Virginia ratepayers face a <b>+$8.51/month</b> increase in 2026 — the state's first base-rate rise since 1992 — tied directly to datacenter grid infrastructure investment (Dominion Energy, Feb 2025).",
  },
  'zh-bench': {
    insight: "In Jan 2025, the best Chinese model scored ~45% on SWE-bench vs Claude's 70%+. By mid-2026, GLM-5 at <b>77.8%</b> vs Claude Opus at <b>80.9%</b> — a gap of just 3.1 points.",
  },
  'mm-mau': {
    insight: 'Talkie reached <b>20M MAU</b> in the first 9 months of 2025 — among the fastest-growing AI apps globally. Average user age under 30.',
  },
  'mm-bench': {
    insight: 'MiniMax M2.5 is the only Chinese model to reach near-parity with the current US frontier on software engineering. At $0.30/M tokens vs $15/M for Claude Opus, the cost-quality ratio is exceptional.',
  },
  'oa-sdk': {
    insight: 'The openai Python SDK is the most-downloaded AI SDK globally. npm installs track closely with Python, reflecting full-stack and serverless adoption.',
  },

  // ── Footnotes (srcNote) ───────────────────────────────────────────────
  'cn-market': {
    srcNote: 'Source: Zhipu AI HK IPO prospectus (Jan 2026) · IDC China AI Platform Tracker 2024',
  },
  'dc-capacity': {
    srcNote: 'Sources: IEA Key Questions on Energy and AI (Apr 2026) · CBRE H1 2026 datacenter market report · Hiatt & Ryu, USC Energy Brief (Sep 2025)',
  },
  'zh-revenue': {
    srcNote: 'Source: Zhipu AI HK IPO prospectus (Jan 2026) · IDC China AI Platform Tracker 2024',
  },
  'zh-market': {
    srcNote: 'Source: Zhipu AI HK IPO prospectus · IDC China AI Platform Tracker 2024',
  },
  'gen-cnmarket': {
    srcNote: 'Source: Zhipu AI HK IPO prospectus (Jan 2026) · IDC China AI Platform Tracker 2024',
  },
};
