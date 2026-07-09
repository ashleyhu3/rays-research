# SIGNAL — AI Demand Tracker

A Vite + React dashboard for tracking AI model adoption across developer, consumer, infrastructure, and token-consumption signals.

## Quick start

```bash
npm install
npm run dev        # dev server → http://localhost:5173
npm run build      # production build → dist/
npm run preview    # preview the production build
```

## Project structure

```
signal-dashboard/
├── index.html                  # Vite HTML entry
├── vite.config.js
├── package.json
└── src/
    ├── main.jsx                # React root — mounts App, registers Chart.js
    ├── App.jsx                 # View router + top-level state (currentView, weeks)
    ├── index.css               # Global styles & CSS variables
    │
    ├── config/
    │   ├── colors.js           # Brand colour tokens (C) + rgba helper (fa)
    │   └── navigation.js       # Sidebar nav structure + VIEW_META titles
    │
    ├── utils/
    │   ├── chartSetup.js       # Chart.js component registration (run once)
    │   ├── chartHelpers.js     # baseOpts / stackedOpts / mkDs / mkBar / formatters
    │   ├── dataGenerators.js   # trend() and series() simulated data generators
    │   └── labels.js           # wkLabels() and dayLabels() x-axis generators
    │
    ├── components/
    │   ├── Sidebar.jsx         # Fixed left nav with section grouping and legend
    │   ├── Topbar.jsx          # Page title, week-range buttons, badges
    │   ├── ChartCard.jsx       # Reusable panel: heading / subtitle / legend / chart / insight
    │   ├── KpiCard.jsx         # Single metric tile (used in Overview)
    │   ├── InlineLegend.jsx    # Colour-dot legend row inside chart cards
    │   └── InsightBox.jsx      # Amber callout box (supports inline <b> HTML)
    │
    └── views/                  # One file per dashboard page
        ├── Overview.jsx
        ├── PyPI.jsx
        ├── StackOverflow.jsx
        ├── GitHub.jsx
        ├── Trends.jsx
        ├── Jobs.jsx
        ├── AppStore.jsx
        ├── Web.jsx
        ├── Reddit.jsx
        ├── HuggingFace.jsx
        ├── GPU.jsx
        ├── Datacenter.jsx      # "new" badge
        ├── Electricity.jsx     # "new" badge
        ├── Tokens.jsx          # "new" badge
        └── Chinese.jsx         # "new" badge
```

## Architecture decisions

| Concern | Solution |
|---|---|
| Chart lifecycle | `react-chartjs-2` wraps Chart.js; charts are destroyed automatically when a view unmounts |
| Stable random data | `useMemo([weeks])` in each view — data only regenerates when the week-range changes |
| Shared chart config | All axis tokens (GRID, TICK, BORD), formatters, and option builders live in `chartHelpers.js` |
| Navigation | Pure React state in `App.jsx`; no router library needed for a single-page dashboard |
| Styling | Vanilla CSS variables in `index.css`; no CSS-in-JS or Tailwind dependency |

## Daily options report

`npm run options-report:generate` generates `daily-options-data-YYYY-MM-DD.pdf`
and stores it as the latest report for the Alerts page, replacing the prior
stored PDF. The GitHub Actions workflow runs it every day at `00:00 UTC`, which
is `08:00 Asia/Hong_Kong`. The server also schedules the same generation at 8am
Hong Kong time when it is awake and a Chrome/Chromium binary is available.

Required secrets for the scheduled workflow: `MASSIVE_API_KEY` and
`MONGODB_URI`. Optional: `OPTIONS_REPORT_TICKERS` defaults to `TSM,ASML`.
No SMTP or email API account is needed for the Alerts page report.
