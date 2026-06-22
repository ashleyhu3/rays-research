# Graph Report - .  (2026-06-22)

## Corpus Check
- 119 files · ~69,673 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 878 nodes · 1827 edges · 57 communities (52 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.72)
- Token cost: 24,253 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Chart Cards & CSV Export|Chart Cards & CSV Export]]
- [[_COMMUNITY_npmPyPI Fetch & RAG Sections|npm/PyPI Fetch & RAG Sections]]
- [[_COMMUNITY_OpenRouter Rankings Scraper|OpenRouter Rankings Scraper]]
- [[_COMMUNITY_MCP Backfill & Scrape Jobs|MCP Backfill & Scrape Jobs]]
- [[_COMMUNITY_Project Dependencies|Project Dependencies]]
- [[_COMMUNITY_Editable Grid & Static Tables|Editable Grid & Static Tables]]
- [[_COMMUNITY_AWS Spot Pricing Scraper|AWS Spot Pricing Scraper]]
- [[_COMMUNITY_Cloud GPU Price Aggregator|Cloud GPU Price Aggregator]]
- [[_COMMUNITY_Company Page Data Slices|Company Page Data Slices]]
- [[_COMMUNITY_Supply Chain Revenue View|Supply Chain Revenue View]]
- [[_COMMUNITY_Datacenter & Electricity View|Datacenter & Electricity View]]
- [[_COMMUNITY_DRAM Spot Price Scraper|DRAM Spot Price Scraper]]
- [[_COMMUNITY_StockTwits Selenium Scraper|StockTwits Selenium Scraper]]
- [[_COMMUNITY_Express Server & Routes|Express Server & Routes]]
- [[_COMMUNITY_StockTwits Methodology Docs|StockTwits Methodology Docs]]
- [[_COMMUNITY_Chart Card Primitives|Chart Card Primitives]]
- [[_COMMUNITY_OpenRouter Growth Cards|OpenRouter Growth Cards]]
- [[_COMMUNITY_Navigation & App Shell|Navigation & App Shell]]
- [[_COMMUNITY_Options Flow View|Options Flow View]]
- [[_COMMUNITY_GitHub Activity & MCP Scrapers|GitHub Activity & MCP Scrapers]]
- [[_COMMUNITY_Vast.ai GPU Price Scraper|Vast.ai GPU Price Scraper]]
- [[_COMMUNITY_Ask-the-Data Chat UI|Ask-the-Data Chat UI]]
- [[_COMMUNITY_MiniMax Company Page|MiniMax Company Page]]
- [[_COMMUNITY_Zhipu Company Page|Zhipu Company Page]]
- [[_COMMUNITY_Snapshot History Store|Snapshot History Store]]
- [[_COMMUNITY_GitHub Stars Backfill|GitHub Stars Backfill]]
- [[_COMMUNITY_Frontend Data Fetchers|Frontend Data Fetchers]]
- [[_COMMUNITY_Chart Registry & Pins|Chart Registry & Pins]]
- [[_COMMUNITY_UI Context & Navbar|UI Context & Navbar]]
- [[_COMMUNITY_GPU History Backfill|GPU History Backfill]]
- [[_COMMUNITY_Layout Context & Topbar|Layout Context & Topbar]]
- [[_COMMUNITY_SEC Filings Backfill|SEC Filings Backfill]]
- [[_COMMUNITY_Scraper Scheduler|Scraper Scheduler]]
- [[_COMMUNITY_Chinese LLM Company Page|Chinese LLM Company Page]]
- [[_COMMUNITY_Options Chain Fetcher|Options Chain Fetcher]]
- [[_COMMUNITY_Chart Config Metadata|Chart Config Metadata]]
- [[_COMMUNITY_Hacker News Scraper|Hacker News Scraper]]
- [[_COMMUNITY_HuggingFace Scraper|HuggingFace Scraper]]
- [[_COMMUNITY_Wikipedia Pageviews Scraper|Wikipedia Pageviews Scraper]]
- [[_COMMUNITY_Market Signals View|Market Signals View]]
- [[_COMMUNITY_GitHub StarsDeps Scraper|GitHub Stars/Deps Scraper]]
- [[_COMMUNITY_SEC EDGAR Scraper|SEC EDGAR Scraper]]
- [[_COMMUNITY_Google Trends Scraper|Google Trends Scraper]]
- [[_COMMUNITY_In-Memory Cache|In-Memory Cache]]
- [[_COMMUNITY_Snapshot File Store|Snapshot File Store]]
- [[_COMMUNITY_Frontend Data Cache|Frontend Data Cache]]
- [[_COMMUNITY_Docker Hub Scraper|Docker Hub Scraper]]
- [[_COMMUNITY_MOPS Revenue Scraper|MOPS Revenue Scraper]]
- [[_COMMUNITY_Options Serverless Handler|Options Serverless Handler]]
- [[_COMMUNITY_PyPI History Scraper|PyPI History Scraper]]
- [[_COMMUNITY_Dashboard Design Concepts|Dashboard Design Concepts]]
- [[_COMMUNITY_Vercel Deploy Config|Vercel Deploy Config]]
- [[_COMMUNITY_EIA Electricity Rates|EIA Electricity Rates]]
- [[_COMMUNITY_OpenRouter Pricing Scraper|OpenRouter Pricing Scraper]]
- [[_COMMUNITY_MongoDB Ping Util|MongoDB Ping Util]]

## God Nodes (most connected - your core abstractions)
1. `useData()` - 60 edges
2. `baseOpts()` - 60 edges
3. `hBarOpts()` - 46 edges
4. `mkDs()` - 30 edges
5. `fa()` - 26 edges
6. `ChartCard()` - 24 edges
7. `EditableGrid()` - 23 edges
8. `C` - 23 edges
9. `metricTrendCard()` - 18 edges
10. `trend()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `fetchNpmPkg()` --calls--> `fmt()`  [INFERRED]
  src/services/fetchers.js → server/chat.js
- `Collect StockTwits data workflow` --conceptually_related_to--> `StockTwits collection methodology`  [INFERRED]
  .github/workflows/stocktwits-collect.yml → stocktwits/Stocktwits-Scraper-main/methodology.md
- `update_all.py incremental collector` --conceptually_related_to--> `update.py append/de-dupe`  [INFERRED]
  .github/workflows/stocktwits-collect.yml → stocktwits/Stocktwits-Scraper-main/README.md
- `getPkgHistory()` --calls--> `fmt()`  [INFERRED]
  server/scrapers/npm.js → server/chat.js
- `getOpenRouterRankings()` --calls--> `fmt()`  [INFERRED]
  server/scrapers/openrouterRankings.js → server/chat.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **StockTwits collection pipeline** — workflows_stocktwits_collect_updateall, scripts_scrape, scripts_update, src_stocktwits_api_scraper, stocktwits_scraper_main_tickers [INFERRED 0.85]
- **Scheduled GitHub Actions data collection** — workflows_collect_data_workflow, workflows_stocktwits_collect_workflow, workflows_collect_data_mongodb, workflows_stocktwits_collect_csvstate [INFERRED 0.75]

## Communities (57 total, 5 thin omitted)

### Community 0 - "Chart Cards & CSV Export"
Cohesion: 0.07
Nodes (66): ChartModal(), ExpandButton(), metricTrendCard(), AwsSpotMini(), chartToCSV(), CloudGpuMini(), CommunityMini(), COMPANIES (+58 more)

### Community 1 - "npm/PyPI Fetch & RAG Sections"
Cohesion: 0.06
Nodes (42): axios, getPkgHistory(), PKGS, agoText(), assembleContext(), buildDocker(), buildGitHub(), buildGithubCommits() (+34 more)

### Community 2 - "OpenRouter Rankings Scraper"
Cohesion: 0.06
Nodes (34): axios, getOpenRouterRankings(), path, PROVIDER_NAMES, providerFromSlug(), storage, STORE_FILE, BLOBS (+26 more)

### Community 3 - "MCP Backfill & Scrape Jobs"
Cohesion: 0.07
Nodes (31): Path, axios, cumulativeCount(), fs, headers(), HISTORY_FILE, iso(), main() (+23 more)

### Community 4 - "Project Dependencies"
Cohesion: 0.05
Nodes (37): dependencies, @aws-sdk/client-pricing, axios, chart.js, cheerio, cors, express, google-trends-api (+29 more)

### Community 5 - "Editable Grid & Static Tables"
Cohesion: 0.15
Nodes (18): EditableGrid(), KpiCard(), C, fa(), STATIC_HN_TERMS, STATIC_HN_WEEKLY, STATIC_WIKI_WEEKLY, TERM_COLORS (+10 more)

### Community 6 - "AWS Spot Pricing Scraper"
Cohesion: 0.11
Nodes (27): ACCEL, advisorStat(), axios, buildHistory(), dailyDates(), getAwsData(), HISTORY_FILE, isoDay() (+19 more)

### Community 7 - "Cloud GPU Price Aggregator"
Cohesion: 0.13
Nodes (24): AWS_INSTANCES, axios, AZURE_SKUS, BUCKETS, buildPayload(), dailyDates(), effectivePrices(), FALLBACK (+16 more)

### Community 8 - "Company Page Data Slices"
Cohesion: 0.20
Nodes (16): weeklyLineData(), npmSlice(), pypiSlice(), npmSlice(), pypiSlice(), npmSlice(), pypiSlice(), npmSlice() (+8 more)

### Community 9 - "Supply Chain Revenue View"
Cohesion: 0.10
Nodes (16): AISupplyOptics(), AISupplyOverview(), AISupplyPCB(), ALL_COLORS, ALL_COMPANIES, buildMomDatasets(), buildRevenueDatasets(), buildTotalRevenueDataset() (+8 more)

### Community 10 - "Datacenter & Electricity View"
Cohesion: 0.11
Nodes (17): CAPEX_YEARS, STATE_GW, STATE_LABELS, stateData, AI_TWH, EL_YEARS, NON_AI, RATE_YEARS (+9 more)

### Community 11 - "DRAM Spot Price Scraper"
Cohesion: 0.17
Nodes (16): axios, cheerio, getDramIndex(), getDramSpot(), HISTORY_FILE, loadHistory(), parseModels(), path (+8 more)

### Community 12 - "StockTwits Selenium Scraper"
Cohesion: 0.13
Nodes (11): ImprovedStockTwitsScraper, StockTwits Selenium Scraper - browser-based FALLBACK.  Drives a headless Chrome, Comprehensively scrape messages for a symbol within date range          Args:, Extract message data from a BeautifulSoup element, Parse message timestamp to date object, Save messages to CSV file, Initialize the improved StockTwits scraper          Args:             headless:, Setup Chrome WebDriver with optimized settings (+3 more)

### Community 13 - "Express Server & Routes"
Cohesion: 0.11
Nodes (16): app, cache, { chat }, cors, DATA_DIR, express, { getOptionsData }, history (+8 more)

### Community 14 - "StockTwits Methodology Docs"
Cohesion: 0.14
Nodes (18): Backward max-cursor pagination, Serial scraping to avoid rate limits, Self-reported Bullish/Bearish sentiment, scrape.py single-ticker entrypoint, update.py append/de-dupe, StockTwits API scraper (primary), StockTwits Selenium scraper (fallback), StockTwits collection methodology (+10 more)

### Community 15 - "Chart Card Primitives"
Cohesion: 0.18
Nodes (10): ChartCard(), InlineLegend(), InsightBox(), getChartMeta(), GPU_ACCENT, GPU_DISPLAY, MKT_COLORS, MKT_DATA (+2 more)

### Community 16 - "OpenRouter Growth Cards"
Cohesion: 0.23
Nodes (9): orComboCard(), PROV_COLOR, dualAxisOpts(), mkBar(), mkDs(), completeWeeks(), fmtGrowthPct(), fmtTok() (+1 more)

### Community 17 - "Navigation & App Shell"
Cohesion: 0.20
Nodes (10): NAV_SECTIONS, SECTOR_OVERVIEW_IDS, VIEW_META, DataProvider(), Sidebar(), Web(), App(), getModeForView() (+2 more)

### Community 18 - "Options Flow View"
Cohesion: 0.15
Nodes (7): fmtExpiry(), fmtUSD(), oiChartOpts, Options(), SAMPLES, TickerPanel(), topThree()

### Community 19 - "GitHub Activity & MCP Scrapers"
Cohesion: 0.20
Nodes (14): fetchCommitActivity(), fetchJson(), fetchNewRepoCount(), getGitHubActivity(), https, REPOS, sleep(), axios (+6 more)

### Community 20 - "Vast.ai GPU Price Scraper"
Cohesion: 0.20
Nodes (14): axios, buildHistoryPayload(), dailyDates(), getGpuPrices(), getVastPrices(), HISTORY_FILE, isoDay(), KEY_ALIASES (+6 more)

### Community 21 - "Ask-the-Data Chat UI"
Cohesion: 0.18
Nodes (8): Chat(), inlineBold(), isTableRow(), renderRich(), SOURCE_META, splitCells(), SUGGESTIONS, CHART_REGISTRY

### Community 22 - "MiniMax Company Page"
Cohesion: 0.18
Nodes (12): BENCH_COLORS, BENCH_MODELS, BENCH_VALS, benchData, benchOpts, QTR_LABELS, buildPriceData(), pickLive() (+4 more)

### Community 23 - "Zhipu Company Page"
Cohesion: 0.14
Nodes (13): BENCH_COLORS, BENCH_MODELS, BENCH_VALS, benchData, benchOpts, MKT_COLORS, MKT_DATA, MKT_LABELS (+5 more)

### Community 24 - "Snapshot History Store"
Cohesion: 0.21
Nodes (12): all(), EXTRACTORS, FILE, load(), path, persist(), PRICE_SPECS, record() (+4 more)

### Community 25 - "GitHub Stars Backfill"
Cohesion: 0.24
Nodes (12): axios, fs, getPage(), headers(), HISTORY_FILE, iso(), main(), monthlyAnchors() (+4 more)

### Community 26 - "Frontend Data Fetchers"
Cohesion: 0.26
Nodes (12): fetchAll(), fetchBackendAll(), fetchHF(), fetchJsonSafe(), fetchNpm(), fetchNpmPkg(), fetchPypi(), fetchPypiPkg() (+4 more)

### Community 27 - "Chart Registry & Pins"
Cohesion: 0.21
Nodes (10): CHART_BY_ID, CHART_REGISTRY, defaultPins(), DEMAND, REGISTRY, buildDefaults(), DashboardContext, DashboardProvider() (+2 more)

### Community 28 - "UI Context & Navbar"
Cohesion: 0.20
Nodes (7): UIContext, UIProvider(), useUI(), Navbar(), PRICING_VIEWS, SUPPLY_VIEWS, TOOL_VIEWS

### Community 29 - "GPU History Backfill"
Cohesion: 0.23
Nodes (11): axios, fatalAuthError(), fetchWindow(), fs, GPUS, HISTORY_FILE, KEY_ALIASES, main() (+3 more)

### Community 30 - "Layout Context & Topbar"
Cohesion: 0.22
Nodes (7): LayoutContext, LayoutProvider(), useLayout(), MONTH_OPTIONS, SUB_VIEW_LABELS, Topbar(), WEEK_OPTIONS

### Community 31 - "SEC Filings Backfill"
Cohesion: 0.29
Nodes (10): axios, countFilings(), fs, HISTORY_FILE, iso(), main(), monthlyAnchors(), path (+2 more)

### Community 32 - "Scraper Scheduler"
Cohesion: 0.18
Nodes (7): cache, cron, history, OPTIONS_BASKET, scrapers, snapshotStore, TTL

### Community 33 - "Chinese LLM Company Page"
Cohesion: 0.18
Nodes (10): BENCH_COLORS, BENCH_MODELS, BENCH_VALS, benchData, benchOpts, MKT_COLORS, MKT_DATA, MKT_LABELS (+2 more)

### Community 34 - "Options Chain Fetcher"
Cohesion: 0.31
Nodes (8): fetchChain(), fmtContract(), getOptionsData(), isoDate(), sleep(), withRetry(), captureOptionsOI(), warmOptions()

### Community 35 - "Chart Config Metadata"
Cohesion: 0.36
Nodes (4): CHART_INSIGHTS, chartTitle(), CHART_SOURCES, CHART_TEXT

### Community 36 - "Hacker News Scraper"
Cohesion: 0.29
Nodes (5): fetchJson(), https, PER_TERM_QUERIES, queryCount(), WEEKLY_TERMS

### Community 37 - "HuggingFace Scraper"
Cohesion: 0.36
Nodes (7): axios, FAMILIES, getFamilyDownloads(), getHuggingFaceData(), getNewModelCounts(), getTopModels(), UA

### Community 38 - "Wikipedia Pageviews Scraper"
Cohesion: 0.32
Nodes (5): ARTICLES, fetchArticleViews(), fetchJson(), fmtDate(), https

### Community 39 - "Market Signals View"
Cohesion: 0.38
Nodes (6): chartsForSector(), useDashboard(), CustomizeDropdown(), MARKET_CHARTS, MarketSignals(), SectorOverview()

### Community 40 - "GitHub Stars/Deps Scraper"
Cohesion: 0.38
Nodes (6): axios, cheerio, getDependents(), getGitHubData(), getStars(), REPOS

### Community 41 - "SEC EDGAR Scraper"
Cohesion: 0.38
Nodes (5): axios, getSecData(), isoDaysAgo(), sleep(), TERMS

### Community 42 - "Google Trends Scraper"
Cohesion: 0.38
Nodes (6): API_KEYWORDS, BRAND_KEYWORDS, getGeoData(), getTrendsData(), googleTrends, parseTimeline()

### Community 43 - "In-Memory Cache"
Cohesion: 0.33
Nodes (3): get(), meta(), store

### Community 44 - "Snapshot File Store"
Cohesion: 0.38
Nodes (6): FILE, load(), path, put(), seed(), storage

### Community 45 - "Frontend Data Cache"
Cohesion: 0.47
Nodes (3): DataContext, getCached(), setCached()

### Community 46 - "Docker Hub Scraper"
Cohesion: 0.40
Nodes (4): fetchImage(), fetchJson(), https, IMAGES

### Community 48 - "Options Serverless Handler"
Cohesion: 0.60
Nodes (3): handler(), sleep(), withRetry()

### Community 50 - "Dashboard Design Concepts"
Cohesion: 0.50
Nodes (4): React state navigation (no router), chartHelpers shared chart config, SIGNAL AI Demand Tracker dashboard, useMemo stable random data pattern

### Community 51 - "Vercel Deploy Config"
Cohesion: 0.50
Nodes (3): builds, routes, version

## Knowledge Gaps
- **292 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+287 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fmt()` connect `npm/PyPI Fetch & RAG Sections` to `OpenRouter Rankings Scraper`, `Frontend Data Fetchers`?**
  _High betweenness centrality (0.323) - this node is a cross-community bridge._
- **Why does `fetchNpmPkg()` connect `Frontend Data Fetchers` to `npm/PyPI Fetch & RAG Sections`?**
  _High betweenness centrality (0.318) - this node is a cross-community bridge._
- **Why does `Path` connect `MCP Backfill & Scrape Jobs` to `OpenRouter Rankings Scraper`, `AWS Spot Pricing Scraper`, `Cloud GPU Price Aggregator`, `DRAM Spot Price Scraper`, `Snapshot File Store`, `Express Server & Routes`, `Vast.ai GPU Price Scraper`, `Snapshot History Store`, `GitHub Stars Backfill`, `GPU History Backfill`, `SEC Filings Backfill`?**
  _High betweenness centrality (0.221) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _314 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Chart Cards & CSV Export` be split into smaller, more focused modules?**
  _Cohesion score 0.0687719298245614 - nodes in this community are weakly interconnected._
- **Should `npm/PyPI Fetch & RAG Sections` be split into smaller, more focused modules?**
  _Cohesion score 0.05513784461152882 - nodes in this community are weakly interconnected._
- **Should `OpenRouter Rankings Scraper` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._