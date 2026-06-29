# Graph Report - .  (2026-06-28)

## Corpus Check
- 144 files · ~148,937 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1105 nodes · 2199 edges · 70 communities (61 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_NPM Scrapers & Chat Pipeline|NPM Scrapers & Chat Pipeline]]
- [[_COMMUNITY_GPU History Backfill Scripts|GPU History Backfill Scripts]]
- [[_COMMUNITY_AI Company Charts & Metrics|AI Company Charts & Metrics]]
- [[_COMMUNITY_Transcript Analysis & MongoDB|Transcript Analysis & MongoDB]]
- [[_COMMUNITY_Chart Configuration Registry|Chart Configuration Registry]]
- [[_COMMUNITY_Interactive Chat Charts|Interactive Chat Charts]]
- [[_COMMUNITY_AI Benchmark Data|AI Benchmark Data]]
- [[_COMMUNITY_Project Dependencies|Project Dependencies]]
- [[_COMMUNITY_Dashboard Context & Market Signals|Dashboard Context & Market Signals]]
- [[_COMMUNITY_AI Supply Chain Components|AI Supply Chain Components]]
- [[_COMMUNITY_Sentiment Analysis Pipeline|Sentiment Analysis Pipeline]]
- [[_COMMUNITY_DRAM Pricing Charts|DRAM Pricing Charts]]
- [[_COMMUNITY_AWS Spot Price Scrapers|AWS Spot Price Scrapers]]
- [[_COMMUNITY_Cloud GPU Price Scrapers|Cloud GPU Price Scrapers]]
- [[_COMMUNITY_Dashboard Grid & KPI Cards|Dashboard Grid & KPI Cards]]
- [[_COMMUNITY_Express API Server|Express API Server]]
- [[_COMMUNITY_SanDisk NAND Storage Filings|SanDisk NAND Storage Filings]]
- [[_COMMUNITY_DRAM Spot Price Scrapers|DRAM Spot Price Scrapers]]
- [[_COMMUNITY_StockTwits Selenium Scraper|StockTwits Selenium Scraper]]
- [[_COMMUNITY_Chart UI Components|Chart UI Components]]
- [[_COMMUNITY_LiteLLM Pricing Scraper|LiteLLM Pricing Scraper]]
- [[_COMMUNITY_StockTwits Methodology & Scripts|StockTwits Methodology & Scripts]]
- [[_COMMUNITY_Options Chain Charts|Options Chain Charts]]
- [[_COMMUNITY_GitHub Activity Scrapers|GitHub Activity Scrapers]]
- [[_COMMUNITY_GPU Pricing Scrapers|GPU Pricing Scrapers]]
- [[_COMMUNITY_Chat Interface Components|Chat Interface Components]]
- [[_COMMUNITY_Zhipu AI Benchmark Data|Zhipu AI Benchmark Data]]
- [[_COMMUNITY_Server History Store|Server History Store]]
- [[_COMMUNITY_GitHub Stars Backfill|GitHub Stars Backfill]]
- [[_COMMUNITY_Server Scheduler & Cron|Server Scheduler & Cron]]
- [[_COMMUNITY_Server Storage Layer|Server Storage Layer]]
- [[_COMMUNITY_Data Fetcher Services|Data Fetcher Services]]
- [[_COMMUNITY_OpenRouter Model Rankings|OpenRouter Model Rankings]]
- [[_COMMUNITY_MCP Backfill Scripts|MCP Backfill Scripts]]
- [[_COMMUNITY_Server Cache Layer|Server Cache Layer]]
- [[_COMMUNITY_Earnings Transcript Viewer|Earnings Transcript Viewer]]
- [[_COMMUNITY_SEC Filings Backfill|SEC Filings Backfill]]
- [[_COMMUNITY_Options Data Scraper|Options Data Scraper]]
- [[_COMMUNITY_SanDisk Q4 2025 Press Release|SanDisk Q4 2025 Press Release]]
- [[_COMMUNITY_Data Validity Inspector|Data Validity Inspector]]
- [[_COMMUNITY_Hacker News Scrapers|Hacker News Scrapers]]
- [[_COMMUNITY_HuggingFace Model Scrapers|HuggingFace Model Scrapers]]
- [[_COMMUNITY_Stock Price Scrapers|Stock Price Scrapers]]
- [[_COMMUNITY_Wikipedia Article Views|Wikipedia Article Views]]
- [[_COMMUNITY_Options Data Store|Options Data Store]]
- [[_COMMUNITY_Dashboard README Docs|Dashboard README Docs]]
- [[_COMMUNITY_GitHub Dependents Scraper|GitHub Dependents Scraper]]
- [[_COMMUNITY_Keyword Search Scraper|Keyword Search Scraper]]
- [[_COMMUNITY_SEC Filings Scraper|SEC Filings Scraper]]
- [[_COMMUNITY_Google Trends Scraper|Google Trends Scraper]]
- [[_COMMUNITY_Data Collection Scripts|Data Collection Scripts]]
- [[_COMMUNITY_Snapshot Store|Snapshot Store]]
- [[_COMMUNITY_Source Registry & Validity|Source Registry & Validity]]
- [[_COMMUNITY_Navigation & Sidebar Config|Navigation & Sidebar Config]]
- [[_COMMUNITY_Docker Image Scrapers|Docker Image Scrapers]]
- [[_COMMUNITY_MOPS Revenue Scraper|MOPS Revenue Scraper]]
- [[_COMMUNITY_Options API Handler|Options API Handler]]
- [[_COMMUNITY_App Entry & Chart Setup|App Entry & Chart Setup]]
- [[_COMMUNITY_PyPI Package Scrapers|PyPI Package Scrapers]]
- [[_COMMUNITY_MongoDB Seed Scripts|MongoDB Seed Scripts]]
- [[_COMMUNITY_Frontend Cache Service|Frontend Cache Service]]
- [[_COMMUNITY_Vercel Deployment Config|Vercel Deployment Config]]
- [[_COMMUNITY_EIA Electricity Rates|EIA Electricity Rates]]
- [[_COMMUNITY_OpenRouter Pricing Scraper|OpenRouter Pricing Scraper]]
- [[_COMMUNITY_MongoDB Ping Script|MongoDB Ping Script]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]

## God Nodes (most connected - your core abstractions)
1. `useData()` - 62 edges
2. `baseOpts()` - 62 edges
3. `hBarOpts()` - 46 edges
4. `fa()` - 33 edges
5. `mkDs()` - 32 edges
6. `ChartCard()` - 25 edges
7. `C` - 25 edges
8. `EditableGrid()` - 24 edges
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
- **Scheduled GitHub Actions data collection** — workflows_collect_data_workflow, workflows_stocktwits_collect_workflow, workflows_collect_data_mongodb, workflows_stocktwits_collect_csvstate [INFERRED 0.75]
- **StockTwits collection pipeline** — workflows_stocktwits_collect_updateall, scripts_scrape, scripts_update, src_stocktwits_api_scraper, stocktwits_scraper_main_tickers [INFERRED 0.85]
- **SNDK Revenue Acceleration Arc: Q1-Q3 FY2026 driven by AI demand, BiCS8 ramp, and Datacenter mix shift** — transcripts_sndk_2025_11_06_8k_press_release_q1_2026_results, transcripts_sndk_2026_01_29_8k_press_release_q2_2026_results, transcripts_sndk_2026_04_30_8k_press_release_q3_2026_results, transcripts_sndk_2025_08_21_10_k_mdna_ai_inference_demand, transcripts_sndk_2025_11_06_8k_press_release_bics8_bit_production [INFERRED 0.85]
- **Flash Manufacturing Partnership Ecosystem (Flash Ventures, Kioxia, SDSS, Nanya)** — transcripts_sndk_2025_08_21_10_k_mdna_flash_ventures, transcripts_sndk_2025_08_21_10_k_mdna_kioxia, transcripts_sndk_2025_08_21_10_k_mdna_sdss_venture, transcripts_sndk_2026_05_01_10_q_mdna_nanya_investment [EXTRACTED 0.95]
- **Debt Deleveraging Journey: Term Loan Origination to Full Repayment and Net Cash Positive** — transcripts_sndk_2025_08_21_10_k_mdna_term_loan_facility, transcripts_sndk_2025_11_06_8k_press_release_net_cash_positive, transcripts_sndk_2026_05_01_10_q_mdna_term_loan_repaid, transcripts_sndk_2026_04_30_8k_press_release_zero_debt [INFERRED 0.95]

## Communities (70 total, 9 thin omitted)

### Community 0 - "NPM Scrapers & Chat Pipeline"
Cohesion: 0.06
Nodes (42): axios, getPkgHistory(), PKGS, agoText(), assembleContext(), buildDocker(), buildGitHub(), buildGithubCommits() (+34 more)

### Community 1 - "GPU History Backfill Scripts"
Cohesion: 0.05
Nodes (42): Path, axios, fatalAuthError(), fetchWindow(), fs, GPUS, HISTORY_FILE, KEY_ALIASES (+34 more)

### Community 2 - "AI Company Charts & Metrics"
Cohesion: 0.12
Nodes (37): ChartCard(), metricTrendCard(), orComboCard(), DemandAnthropic(), npmSlice(), pypiSlice(), DemandGoogle(), npmSlice() (+29 more)

### Community 3 - "Transcript Analysis & MongoDB"
Cohesion: 0.07
Nodes (44): fetchTranscriptsForTicker(), getStoryText(), getToken(), searchEarningsTranscripts(), analyzeDoc(), connectMongo(), isDailyLimit(), isRateLimit() (+36 more)

### Community 4 - "Chart Configuration Registry"
Cohesion: 0.06
Nodes (30): CHART_INSIGHTS, chartTitle(), CHART_BY_ID, CHART_REGISTRY, chartsForSector(), defaultPins(), DEMAND, REGISTRY (+22 more)

### Community 5 - "Interactive Chat Charts"
Cohesion: 0.12
Nodes (37): AwsSpotMini(), chartToCSV(), CloudGpuMini(), CommunityMini(), COMPANIES, CompanyPricingMini(), CompanyShareMini(), DockerMini() (+29 more)

### Community 6 - "AI Benchmark Data"
Cohesion: 0.08
Nodes (31): BENCH_COLORS, BENCH_MODELS, BENCH_VALS, benchData, benchOpts, QTR_LABELS, C, BENCH_COLORS (+23 more)

### Community 7 - "Project Dependencies"
Cohesion: 0.05
Nodes (38): dependencies, @aws-sdk/client-pricing, axios, chart.js, cheerio, cors, express, google-trends-api (+30 more)

### Community 8 - "Dashboard Context & Market Signals"
Cohesion: 0.11
Nodes (21): DashboardContext, DashboardProvider(), SECTOR_IDS, useDashboard(), DemandGeneral(), MARKET_CHARTS, MarketSignals(), DemandOpenRouter() (+13 more)

### Community 9 - "AI Supply Chain Components"
Cohesion: 0.07
Nodes (25): AISupplyFiber(), AISupplyMLCC(), AISupplyOptics(), AISupplyOverview(), AISupplyPCB(), ALL_COLORS, ALL_COMPANIES, buildMomDatasets() (+17 more)

### Community 10 - "Sentiment Analysis Pipeline"
Cohesion: 0.12
Nodes (29): analyzeTicker(), betacf(), betai(), CATEGORIES, computeSentiment(), corr(), corrP(), dailyCloses() (+21 more)

### Community 11 - "DRAM Pricing Charts"
Cohesion: 0.10
Nodes (24): mhSeries(), mkLine(), weeklyLineData(), fa(), DRAM_PALETTE, dramDayLabel(), dramLegend(), dramLineData() (+16 more)

### Community 12 - "AWS Spot Price Scrapers"
Cohesion: 0.11
Nodes (27): ACCEL, advisorStat(), axios, buildHistory(), dailyDates(), getAwsData(), HISTORY_FILE, isoDay() (+19 more)

### Community 13 - "Cloud GPU Price Scrapers"
Cohesion: 0.13
Nodes (24): AWS_INSTANCES, axios, AZURE_SKUS, BUCKETS, buildPayload(), dailyDates(), effectivePrices(), FALLBACK (+16 more)

### Community 14 - "Dashboard Grid & KPI Cards"
Cohesion: 0.13
Nodes (15): EditableGrid(), KpiCard(), DataContext, STATIC_HN_TERMS, STATIC_HN_WEEKLY, STATIC_WIKI_WEEKLY, TERM_COLORS, WIKI_COLORS (+7 more)

### Community 15 - "Express API Server"
Cohesion: 0.09
Nodes (20): app, { buildValidityState }, cache, { chat }, cors, DATA_DIR, express, { getOptionsData } (+12 more)

### Community 16 - "SanDisk NAND Storage Filings"
Cohesion: 0.12
Nodes (23): AI Infrastructure Demand for NAND Storage, Datacenter End Market (Cloud), Flash Ventures (Sandisk-Kioxia JV), Kioxia Corporation (Strategic Partner), NAND Flash Technology, SanDisk Semiconductor Shanghai (SDSS) Venture, Tariff and Trade Policy Risk, Term Loan Facility ($2B, 2025) (+15 more)

### Community 17 - "DRAM Spot Price Scrapers"
Cohesion: 0.17
Nodes (16): axios, cheerio, getDramIndex(), getDramSpot(), HISTORY_FILE, loadHistory(), parseModels(), path (+8 more)

### Community 18 - "StockTwits Selenium Scraper"
Cohesion: 0.13
Nodes (11): ImprovedStockTwitsScraper, StockTwits Selenium Scraper - browser-based FALLBACK.  Drives a headless Chrome, Comprehensively scrape messages for a symbol within date range          Args:, Extract message data from a BeautifulSoup element, Parse message timestamp to date object, Save messages to CSV file, Initialize the improved StockTwits scraper          Args:             headless:, Setup Chrome WebDriver with optimized settings (+3 more)

### Community 19 - "Chart UI Components"
Cohesion: 0.13
Nodes (13): ChartModal(), ExpandButton(), InlineLegend(), InsightBox(), AI_TWH, EL_YEARS, NON_AI, RATE_YEARS (+5 more)

### Community 20 - "LiteLLM Pricing Scraper"
Cohesion: 0.16
Nodes (17): axios, getLitellmPricing(), pick(), selectModels(), SPECS, axios, DAYS, fileAt() (+9 more)

### Community 21 - "StockTwits Methodology & Scripts"
Cohesion: 0.14
Nodes (18): Backward max-cursor pagination, Serial scraping to avoid rate limits, Self-reported Bullish/Bearish sentiment, scrape.py single-ticker entrypoint, update.py append/de-dupe, StockTwits API scraper (primary), StockTwits Selenium scraper (fallback), StockTwits collection methodology (+10 more)

### Community 22 - "Options Chain Charts"
Cohesion: 0.15
Nodes (7): fmtExpiry(), fmtUSD(), oiChartOpts, Options(), SAMPLES, TickerPanel(), topThree()

### Community 23 - "GitHub Activity Scrapers"
Cohesion: 0.20
Nodes (14): fetchCommitActivity(), fetchJson(), fetchNewRepoCount(), getGitHubActivity(), https, REPOS, sleep(), axios (+6 more)

### Community 24 - "GPU Pricing Scrapers"
Cohesion: 0.20
Nodes (14): axios, buildHistoryPayload(), dailyDates(), getGpuPrices(), getVastPrices(), HISTORY_FILE, isoDay(), KEY_ALIASES (+6 more)

### Community 25 - "Chat Interface Components"
Cohesion: 0.18
Nodes (8): Chat(), inlineBold(), isTableRow(), renderRich(), SOURCE_META, splitCells(), SUGGESTIONS, CHART_REGISTRY

### Community 26 - "Zhipu AI Benchmark Data"
Cohesion: 0.14
Nodes (13): BENCH_COLORS, BENCH_MODELS, BENCH_VALS, benchData, benchOpts, MKT_COLORS, MKT_DATA, MKT_LABELS (+5 more)

### Community 27 - "Server History Store"
Cohesion: 0.21
Nodes (12): all(), EXTRACTORS, FILE, load(), path, persist(), PRICE_SPECS, record() (+4 more)

### Community 28 - "GitHub Stars Backfill"
Cohesion: 0.24
Nodes (12): axios, fs, getPage(), headers(), HISTORY_FILE, iso(), main(), monthlyAnchors() (+4 more)

### Community 29 - "Server Scheduler & Cron"
Cohesion: 0.15
Nodes (9): AI_MEGACAPS, cache, cron, history, OPTIONS_BASKET, scrapers, SENTIMENT_TICKERS, snapshotStore (+1 more)

### Community 30 - "Server Storage Layer"
Cohesion: 0.24
Nodes (11): cache, close(), flush(), fs, init(), pending, read(), readFileBlob() (+3 more)

### Community 31 - "Data Fetcher Services"
Cohesion: 0.26
Nodes (12): fetchAll(), fetchBackendAll(), fetchHF(), fetchJsonSafe(), fetchNpm(), fetchNpmPkg(), fetchPypi(), fetchPypiPkg() (+4 more)

### Community 32 - "OpenRouter Model Rankings"
Cohesion: 0.18
Nodes (7): axios, getOpenRouterRankings(), path, PROVIDER_NAMES, providerFromSlug(), storage, STORE_FILE

### Community 33 - "MCP Backfill Scripts"
Cohesion: 0.26
Nodes (11): axios, cumulativeCount(), fs, headers(), HISTORY_FILE, iso(), main(), monthlyAnchors() (+3 more)

### Community 34 - "Server Cache Layer"
Cohesion: 0.24
Nodes (8): get(), getTelemetry(), meta(), recordFailure(), recordSuccess(), store, telemetry, updateTelemetry()

### Community 35 - "Earnings Transcript Viewer"
Cohesion: 0.21
Nodes (8): CatalystCard(), ENGINE_LABEL, ROLE_COLOR, SeriesResult(), sevColor(), toneScale(), Trajectory(), Transcripts()

### Community 36 - "SEC Filings Backfill"
Cohesion: 0.29
Nodes (10): axios, countFilings(), fs, HISTORY_FILE, iso(), main(), monthlyAnchors(), path (+2 more)

### Community 37 - "Options Data Scraper"
Cohesion: 0.31
Nodes (8): fetchChain(), fmtContract(), getOptionsData(), isoDate(), sleep(), withRetry(), captureOptionsOI(), warmOptions()

### Community 38 - "SanDisk Q4 2025 Press Release"
Cohesion: 0.25
Nodes (9): BiCS8 NAND Flash Technology, Goodwill Impairment Charge ($1.8B, Q3 FY2025), High Bandwidth Flash (HBF), Q4 FY2025 Financial Results (8-K Press Release), Sandisk Corporation (SNDK), WDC Separation (Spin-off, Feb 21 2025), BiCS8 Bit Production Ramp (15% of bits Q1 FY2026), Net Cash Positive Milestone (Q1 FY2026) (+1 more)

### Community 39 - "Data Validity Inspector"
Cohesion: 0.36
Nodes (5): AuditInspector(), DataValidity(), fmtAge(), fmtDur(), STATUS_COLOR

### Community 40 - "Hacker News Scrapers"
Cohesion: 0.29
Nodes (5): fetchJson(), https, PER_TERM_QUERIES, queryCount(), WEEKLY_TERMS

### Community 41 - "HuggingFace Model Scrapers"
Cohesion: 0.36
Nodes (7): axios, FAMILIES, getFamilyDownloads(), getHuggingFaceData(), getNewModelCounts(), getTopModels(), UA

### Community 42 - "Stock Price Scrapers"
Cohesion: 0.39
Nodes (5): genShortRatios(), getStockHistory(), getYF(), sleep(), withRetry()

### Community 43 - "Wikipedia Article Views"
Cohesion: 0.32
Nodes (5): ARTICLES, fetchArticleViews(), fetchJson(), fmtDate(), https

### Community 44 - "Options Data Store"
Cohesion: 0.36
Nodes (7): backfill(), FILE, load(), path, record(), storage, today()

### Community 45 - "Dashboard README Docs"
Cohesion: 0.29
Nodes (7): Chart.js via react-chartjs-2, Dashboard Views (Overview, PyPI, GitHub, etc.), Pure React State Navigation (no router), SIGNAL — AI Demand Tracker Dashboard, Simulated Data Generation (trend/series), Vanilla CSS Variables Styling, Vite + React Frontend Stack

### Community 46 - "GitHub Dependents Scraper"
Cohesion: 0.38
Nodes (6): axios, cheerio, getDependents(), getGitHubData(), getStars(), REPOS

### Community 47 - "Keyword Search Scraper"
Cohesion: 0.33
Nodes (6): DATA_DIR, fs, parseCsv(), path, searchKeyword(), TICKERS

### Community 48 - "SEC Filings Scraper"
Cohesion: 0.38
Nodes (5): axios, getSecData(), isoDaysAgo(), sleep(), TERMS

### Community 49 - "Google Trends Scraper"
Cohesion: 0.38
Nodes (6): API_KEYWORDS, BRAND_KEYWORDS, getGeoData(), getTrendsData(), googleTrends, parseTimeline()

### Community 50 - "Data Collection Scripts"
Cohesion: 0.29
Nodes (5): BLOBS, DATA_DIR, path, scheduler, storage

### Community 51 - "Snapshot Store"
Cohesion: 0.38
Nodes (6): FILE, load(), path, put(), seed(), storage

### Community 52 - "Source Registry & Validity"
Cohesion: 0.33
Nodes (4): SOURCE_REGISTRY, buildValidityState(), cache, { SOURCE_REGISTRY }

### Community 53 - "Navigation & Sidebar Config"
Cohesion: 0.40
Nodes (4): NAV_SECTIONS, SECTOR_OVERVIEW_IDS, VIEW_META, Sidebar()

### Community 54 - "Docker Image Scrapers"
Cohesion: 0.40
Nodes (4): fetchImage(), fetchJson(), https, IMAGES

### Community 56 - "Options API Handler"
Cohesion: 0.60
Nodes (3): handler(), sleep(), withRetry()

### Community 57 - "App Entry & Chart Setup"
Cohesion: 0.40
Nodes (3): DataProvider(), App(), getModeForView()

### Community 59 - "MongoDB Seed Scripts"
Cohesion: 0.40
Nodes (4): BLOBS, DATA_DIR, path, storage

### Community 61 - "Vercel Deployment Config"
Cohesion: 0.50
Nodes (3): builds, routes, version

## Knowledge Gaps
- **374 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+369 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fmt()` connect `NPM Scrapers & Chat Pipeline` to `OpenRouter Model Rankings`, `Data Fetcher Services`?**
  _High betweenness centrality (0.326) - this node is a cross-community bridge._
- **Why does `fetchNpmPkg()` connect `Data Fetcher Services` to `NPM Scrapers & Chat Pipeline`?**
  _High betweenness centrality (0.319) - this node is a cross-community bridge._
- **Why does `Path` connect `GPU History Backfill Scripts` to `OpenRouter Model Rankings`, `MCP Backfill Scripts`, `Transcript Analysis & MongoDB`, `SEC Filings Backfill`, `Server History Store`, `Sentiment Analysis Pipeline`, `AWS Spot Price Scrapers`, `Cloud GPU Price Scrapers`, `Options Data Store`, `Keyword Search Scraper`, `Express API Server`, `DRAM Spot Price Scrapers`, `Data Collection Scripts`, `Snapshot Store`, `LiteLLM Pricing Scraper`, `GPU Pricing Scrapers`, `MongoDB Seed Scripts`, `GitHub Stars Backfill`?**
  _High betweenness centrality (0.278) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _396 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `NPM Scrapers & Chat Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.05513784461152882 - nodes in this community are weakly interconnected._
- **Should `GPU History Backfill Scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.05185185185185185 - nodes in this community are weakly interconnected._
- **Should `AI Company Charts & Metrics` be split into smaller, more focused modules?**
  _Cohesion score 0.12326530612244897 - nodes in this community are weakly interconnected._