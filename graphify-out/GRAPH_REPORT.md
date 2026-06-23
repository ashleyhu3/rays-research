# Graph Report - .  (2026-06-23)

## Corpus Check
- 118 files · ~54,943 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 859 nodes · 1574 edges · 75 communities (56 shown, 19 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 173 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_React Frontend App Core|React Frontend App Core]]
- [[_COMMUNITY_PDF Processing and Broker Cache|PDF Processing and Broker Cache]]
- [[_COMMUNITY_System Architecture Overview|System Architecture Overview]]
- [[_COMMUNITY_Backend Data Models and Canvas|Backend Data Models and Canvas]]
- [[_COMMUNITY_Frontend Package Config|Frontend Package Config]]
- [[_COMMUNITY_Database ORM and Document Schema|Database ORM and Document Schema]]
- [[_COMMUNITY_Dashboard Chart Views|Dashboard Chart Views]]
- [[_COMMUNITY_Dashboard Root and Sector View|Dashboard Root and Sector View]]
- [[_COMMUNITY_Server Package Config|Server Package Config]]
- [[_COMMUNITY_AI Supply Dashboard|AI Supply Dashboard]]
- [[_COMMUNITY_Data Scraping Server|Data Scraping Server]]
- [[_COMMUNITY_Package and Model Metrics Views|Package and Model Metrics Views]]
- [[_COMMUNITY_TypeScript App Config|TypeScript App Config]]
- [[_COMMUNITY_GitHub and Trends Dashboard Views|GitHub and Trends Dashboard Views]]
- [[_COMMUNITY_RAG Retrieval Engine|RAG Retrieval Engine]]
- [[_COMMUNITY_TypeScript Node Config|TypeScript Node Config]]
- [[_COMMUNITY_Dashboard Context and Charts|Dashboard Context and Charts]]
- [[_COMMUNITY_RAG Filter and Answer Logic|RAG Filter and Answer Logic]]
- [[_COMMUNITY_UI Components and Context|UI Components and Context]]
- [[_COMMUNITY_PDF Ingestion Pipeline|PDF Ingestion Pipeline]]
- [[_COMMUNITY_Agentic Research Module|Agentic Research Module]]
- [[_COMMUNITY_API Data Fetchers|API Data Fetchers]]
- [[_COMMUNITY_Chinese AI Benchmark View|Chinese AI Benchmark View]]
- [[_COMMUNITY_Document Upload API|Document Upload API]]
- [[_COMMUNITY_Email Ingestion Pipeline|Email Ingestion Pipeline]]
- [[_COMMUNITY_Gemini Embedding Service|Gemini Embedding Service]]
- [[_COMMUNITY_PDF Ingestion Tests|PDF Ingestion Tests]]
- [[_COMMUNITY_Pipeline Sourcing Tests|Pipeline Sourcing Tests]]
- [[_COMMUNITY_Data Context and Cache|Data Context and Cache]]
- [[_COMMUNITY_FastAPI Dependencies Layer|FastAPI Dependencies Layer]]
- [[_COMMUNITY_Document Search and Listing|Document Search and Listing]]
- [[_COMMUNITY_Pipeline Usage Examples|Pipeline Usage Examples]]
- [[_COMMUNITY_Query Analysis and Coverage|Query Analysis and Coverage]]
- [[_COMMUNITY_Gemini Rate Limiter|Gemini Rate Limiter]]
- [[_COMMUNITY_Chunk Metadata and Embeddings|Chunk Metadata and Embeddings]]
- [[_COMMUNITY_SIGNAL Dashboard Overview|SIGNAL Dashboard Overview]]
- [[_COMMUNITY_GitHub Data Scraper|GitHub Data Scraper]]
- [[_COMMUNITY_Google Trends Scraper|Google Trends Scraper]]
- [[_COMMUNITY_List Query Formatting|List Query Formatting]]
- [[_COMMUNITY_Document Removal Utils|Document Removal Utils]]
- [[_COMMUNITY_GPU Price Scraper|GPU Price Scraper]]
- [[_COMMUNITY_MOPS Financial Scraper|MOPS Financial Scraper]]
- [[_COMMUNITY_App Favicon Design|App Favicon Design]]
- [[_COMMUNITY_Job Listings Scraper|Job Listings Scraper]]
- [[_COMMUNITY_PyPI Package Scraper|PyPI Package Scraper]]
- [[_COMMUNITY_Reddit Data Scraper|Reddit Data Scraper]]
- [[_COMMUNITY_FastAPI App Entry Point|FastAPI App Entry Point]]
- [[_COMMUNITY_App Store Scraper|App Store Scraper]]
- [[_COMMUNITY_Hero Image Asset|Hero Image Asset]]
- [[_COMMUNITY_Vite Brand Asset|Vite Brand Asset]]
- [[_COMMUNITY_TypeScript Project References|TypeScript Project References]]
- [[_COMMUNITY_EIA Energy Data Scraper|EIA Energy Data Scraper]]
- [[_COMMUNITY_OpenRouter Model Scraper|OpenRouter Model Scraper]]
- [[_COMMUNITY_Docling Inspection Script|Docling Inspection Script]]
- [[_COMMUNITY_React Framework Concept|React Framework Concept]]
- [[_COMMUNITY_React Logo Asset|React Logo Asset]]
- [[_COMMUNITY_Bluesky Icon|Bluesky Icon]]
- [[_COMMUNITY_Discord Icon|Discord Icon]]
- [[_COMMUNITY_Documentation Icon|Documentation Icon]]
- [[_COMMUNITY_GitHub Icon|GitHub Icon]]
- [[_COMMUNITY_Icons SVG Sprite|Icons SVG Sprite]]
- [[_COMMUNITY_Social Icon|Social Icon]]
- [[_COMMUNITY_X (Twitter) Icon|X (Twitter) Icon]]

## God Nodes (most connected - your core abstractions)
1. `GeminiRAGPipeline` - 46 edges
2. `DatabaseManager` - 45 edges
3. `baseOpts()` - 26 edges
4. `PDFSummarizerPipeline` - 24 edges
5. `useData()` - 23 edges
6. `PDFDocument` - 22 edges
7. `RetrievalFilters` - 20 edges
8. `compilerOptions` - 20 edges
9. `compilerOptions` - 18 edges
10. `mkDs()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `PDFSummarizerPipeline` --uses--> `PDFDocument`  [INFERRED]
  Rays_Intern/PDF_summarizer/pipeline.py → Rays_Intern/PDF_summarizer/database.py
- `GeminiRAGPipeline` --uses--> `PDFDocument`  [INFERRED]
  Rays_Intern/PDF_summarizer/rag_gemini.py → Rays_Intern/PDF_summarizer/database.py
- `RetrievalFilters` --uses--> `PDFDocument`  [INFERRED]
  Rays_Intern/PDF_summarizer/rag_gemini.py → Rays_Intern/PDF_summarizer/database.py
- `PDFChunk` --uses--> `PDFDocument`  [INFERRED]
  Rays_Intern/PDF_summarizer/rag_gemini.py → Rays_Intern/PDF_summarizer/database.py
- `DatabaseManager` --uses--> `PDFDocument`  [INFERRED]
  Rays_Intern/backend/routes/documents.py → Rays_Intern/PDF_summarizer/database.py

## Import Cycles
- 1-file cycle: `Rays_Intern/backend/routes/canvas.py -> Rays_Intern/backend/routes/canvas.py`

## Hyperedges (group relationships)
- **RAG Ingestion Pipeline Flow (Parse → Verbalize → Store → Embed)** — pdf_summarizer_readme_docling_parser, pdf_summarizer_readme_gemini_verbalization, pdf_summarizer_readme_pgvector_storage, pdf_summarizer_readme_gemini_embedding, pdf_summarizer_readme_three_chunk_hierarchy [EXTRACTED 1.00]
- **Backend Core Modules (main, models, dependencies, agent, canvas_db, routes)** — backend_readme_main_module, backend_readme_models_module, backend_readme_dependencies_module, backend_readme_agent_module, backend_readme_canvas_db_module, backend_readme_routes_dir [EXTRACTED 1.00]
- **Frontend State + UI Layer (ChatView, Sidebar, Toolbar, Zustand stores, API client)** — frontend_readme_chatview, frontend_readme_sidebar, frontend_readme_toolbar, frontend_readme_zustand_stores, frontend_readme_api_client [EXTRACTED 1.00]

## Communities (75 total, 19 thin omitted)

### Community 0 - "React Frontend App Core"
Cohesion: 0.06
Nodes (59): askQuestion(), createCanvas(), deleteCanvas(), deleteDocument(), http, listCanvases(), listDocuments(), loadCanvas() (+51 more)

### Community 1 - "PDF Processing and Broker Cache"
Cohesion: 0.06
Nodes (36): BrokerContextCache, _cache_key(), Broker-aware Gemini context caching for Agent 2 (Financial Schema Extractor).  E, Return the full cached system instruction for a given broker name., Stable, filesystem-safe key for a broker name., Manages per-broker Gemini context caches for Agent 2.      Thread-safe. Caches a, Return an active cache name for this broker, creating one if needed.          Re, _system_instruction_for() (+28 more)

### Community 2 - "System Architecture Overview"
Cohesion: 0.06
Nodes (47): agent.py — Research agent goal decomposition + synthesis, canvas_db.py — Canvas + ReactFlow state persistence, dependencies.py — Shared singletons (DB manager, RAG pipeline), FastAPI Backend REST API, main.py — FastAPI app, CORS, router wiring, models.py — Pydantic DTOs (AskResponse, ChunkRef, etc.), routes/ — Feature-area routers (documents, queries, agent, canvas), Threadpool Async Wrapper for RAG pipeline (+39 more)

### Community 3 - "Backend Data Models and Canvas"
Cohesion: 0.13
Nodes (36): AgentRunRequest, AskRequest, Canvas, CanvasState, Canvas persistence models.  Import this module before instantiating DatabaseMana, AgentResult, AgentRunRequest, AskRequest (+28 more)

### Community 4 - "Frontend Package Config"
Cohesion: 0.06
Nodes (31): dependencies, axios, react, react-dom, @xyflow/react, zustand, devDependencies, autoprefixer (+23 more)

### Community 5 - "Database ORM and Document Schema"
Cohesion: 0.13
Nodes (17): date_cls, Exception, DatabaseManager, PDFChunk, PDFDocument, Manages database connections and operations., Update extended metadata fields for an existing document.         Only overwrite, Return documents that need metadata extraction.          Args:             force (+9 more)

### Community 6 - "Dashboard Chart Views"
Cohesion: 0.11
Nodes (24): fa(), BORD, GRID, mkBar(), TICK, dayLabels(), CAPEX_YEARS, STATE_GW (+16 more)

### Community 7 - "Dashboard Root and Sector View"
Cohesion: 0.18
Nodes (23): NAV_SECTIONS, SECTOR_OVERVIEW_IDS, VIEW_META, useData(), getModeForView(), App(), VIEW_COMPONENTS, baseOpts() (+15 more)

### Community 8 - "Server Package Config"
Cohesion: 0.08
Nodes (23): dependencies, app-store-scraper, axios, chart.js, cheerio, cors, express, google-trends-api (+15 more)

### Community 9 - "AI Supply Dashboard"
Cohesion: 0.11
Nodes (17): mkDs(), AISupplyOptics(), AISupplyOverview(), AISupplyPCB(), ALL_COLORS, ALL_COMPANIES, buildMomDatasets(), buildRevenueDatasets() (+9 more)

### Community 10 - "Data Scraping Server"
Cohesion: 0.09
Nodes (13): store, cache, cron, scrapers, TTL, app, cache, cors (+5 more)

### Community 11 - "Package and Model Metrics Views"
Cohesion: 0.13
Nodes (16): KpiCard(), fmtK(), fmtM(), trend(), CAT_COLORS, CAT_DATA, CAT_LABELS, MODEL_PALETTE (+8 more)

### Community 12 - "TypeScript App Config"
Cohesion: 0.09
Nodes (21): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+13 more)

### Community 13 - "GitHub and Trends Dashboard Views"
Cohesion: 0.15
Nodes (15): C, fmtN(), fmtP(), series(), wkLabels(), REPO_KEYS, STATIC_DEPS, STATIC_STARS (+7 more)

### Community 14 - "RAG Retrieval Engine"
Cohesion: 0.15
Nodes (12): GeminiRAGPipeline, Spread retrieval across documents for breadth. Round-robins one chunk at a time, Promote diversity across sections and hierarchy levels.          Strategy:, RAG over verbalized pages (text + chart descriptions)., Vector search over verbalized_summary embeddings.          Expects `query` to al, Return (parent, prev_sibling, next_sibling) for a chunk using metadata IDs., Build context from the retrieved chunks: for each chunk include its metadata +, Format one retrieved chunk plus its parent and siblings (metadata + summary + co (+4 more)

### Community 15 - "TypeScript Node Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 16 - "Dashboard Context and Charts"
Cohesion: 0.16
Nodes (16): CustomizeDropdown(), MONTH_OPTIONS, SUB_VIEW_LABELS, Topbar(), CHART_BY_ID, CHART_REGISTRY, chartsForSector(), defaultPins() (+8 more)

### Community 17 - "RAG Filter and Answer Logic"
Cohesion: 0.15
Nodes (9): True if any metadata filter scopes the search (company/ticker/sector/date/etc.)., Deterministic fallback for the model's is_underspecified judgment (used only if, Build a clarification response for an underspecified, filter-scoped query: state, Answer a question using RAG with optional conversation history.          Pipelin, Convert an ISO date string from the LLM ('YYYY-MM-DD') to a datetime.date., Merge LLM-inferred hard filters with explicit caller-supplied filters.         E, Merge adjacent citations to the same document into one (no LLM call):         '(, Guarantee every numbered list item carries a citation (no LLM call). Run AFTER (+1 more)

### Community 18 - "UI Components and Context"
Cohesion: 0.17
Nodes (7): ChartCard(), InlineLegend(), InsightBox(), Navbar(), UIContext, UIProvider(), useUI()

### Community 19 - "PDF Ingestion Pipeline"
Cohesion: 0.17
Nodes (10): main(), PDFSummarizerPipeline, Main pipeline: Docling parse → Gemini verbalize → Store in Postgres.  Process PD, Process all PDFs in a directory, up to max_workers PDFs at a time.          Each, Re-extract extended metadata for documents that are missing it.          Runs bo, Parse PDFs with Docling, verbalize charts with Gemini, store in Postgres., Set parent_chunk_id, prev_sibling_chunk_id, next_sibling_chunk_id in each chunk', Get info about a processed document. (+2 more)

### Community 20 - "Agentic Research Module"
Cohesion: 0.15
Nodes (9): Agentic research system.  Given a high-level goal, the ResearchAgent:   1. Decom, Ask Gemini to synthesize all sub-answers into a final report., Run the full agentic pipeline.          Returns:             {                 ", Ask Gemini to break the goal into 3-5 specific sub-questions., ResearchAgent, GeminiRAGPipeline, RetrievalFilters, Agentic research routes. (+1 more)

### Community 21 - "API Data Fetchers"
Cohesion: 0.25
Nodes (14): fetchAll(), fetchBackendAll(), fetchHF(), fetchJsonSafe(), fetchNpm(), fetchNpmPkg(), fetchPypi(), fetchPypiPkg() (+6 more)

### Community 22 - "Chinese AI Benchmark View"
Cohesion: 0.13
Nodes (14): BENCH_COLORS, BENCH_MODELS, BENCH_VALS, benchData, benchOpts, MKT_COLORS, MKT_DATA, MKT_LABELS (+6 more)

### Community 23 - "Document Upload API"
Cohesion: 0.27
Nodes (13): DocumentOut, UploadResult, DatabaseManager, GeminiRAGPipeline, Path, PDFSummarizerPipeline, delete_document(), _extract_docs_from_eml() (+5 more)

### Community 24 - "Email Ingestion Pipeline"
Cohesion: 0.19
Nodes (11): _install_cron(), poll(), Gmail IMAP poller — fetches unread research emails and ingests them into the pip, Print instructions and the crontab line to add., Fetch unread emails, ingest any that match the sender filter, return a summary., _sender_matches_filter(), extract_docs_from_eml(), ingest_emls() (+3 more)

### Community 25 - "Gemini Embedding Service"
Cohesion: 0.22
Nodes (10): embed_text(), embed_texts_batch(), _get_client(), _is_rate_limit(), main(), RAG pipeline: search on verbalized_summary, answer from raw_content.  Flow: Retu, Embed a single text string. Returns [] if text is empty., Embed a batch of texts in one API call. Returns a parallel list of vectors; (+2 more)

### Community 26 - "PDF Ingestion Tests"
Cohesion: 0.26
Nodes (12): _find_pdf_path(), _get_chunk_by_id(), main(), _print_chunk(), print_ingested_document_and_chunks(), Simple test: ingest a single PDF through the full pipeline.  Default behavior: c, Resolve PDF: env var, or first PDF in test_PDFs/ or research_pdfs/., Resolve chunk by UUID string; return None if invalid or missing. (+4 more)

### Community 27 - "Pipeline Sourcing Tests"
Cohesion: 0.45
Nodes (10): build_pipeline(), failed(), make_chunk(), passed(), Tests that source citations (filename + page) flow correctly through the RAG pip, Construct a GeminiRAGPipeline with a mocked client and the given db., test_chunks_used_metadata(), test_context_contains_source() (+2 more)

### Community 28 - "Data Context and Cache"
Cohesion: 0.31
Nodes (4): DataContext, DataProvider(), getCached(), setCached()

### Community 29 - "FastAPI Dependencies Layer"
Cohesion: 0.25
Nodes (7): get_db(), get_pipeline(), get_rag(), Shared singletons for FastAPI dependency injection.  canvas_db is imported first, DatabaseManager, GeminiRAGPipeline, PDFSummarizerPipeline

### Community 30 - "Document Search and Listing"
Cohesion: 0.25
Nodes (5): Database module: Golden Schema for financial RAG.  Store verbalization for searc, Build a fuzzy, bidirectional substring filter on PDFDocument.sender_company., Vector search over verbalized_summary embeddings.          Args:             sim, Return all PDFDocument rows matching metadata filters, with no limit.          M, _sender_company_filter()

### Community 31 - "Pipeline Usage Examples"
Cohesion: 0.25
Nodes (7): example_directory(), example_query_database(), example_single_pdf(), Example usage of the Docling + Gemini verbalization pipeline., Process a single PDF from research_pdfs., Process all PDFs in research_pdfs., Query the database for processed documents and chunks.

### Community 32 - "Query Analysis and Coverage"
Cohesion: 0.25
Nodes (7): _apply_period_safety_net(), _extract_coverage_period(), _is_content_enumeration(), True if the question asks to enumerate CONTENT (trends, risks, takeaways, ...) r, Fill coverage_period_from/to deterministically when the question names a period, Single Gemini Flash call that simultaneously:           1. Extracts hard filters, Extract an explicitly-named period (quarter, half-year, month, or year) from the

### Community 33 - "Gemini Rate Limiter"
Cohesion: 0.32
Nodes (3): GeminiRateLimiter, Shared Gemini API rate limiter.  Enforces two limits:   - RPM: minimum gap betwe, Block until it is safe to make the next Gemini API call, then record it.

### Community 34 - "Chunk Metadata and Embeddings"
Cohesion: 0.24
Nodes (4): Any, Args:             database_url: postgresql+psycopg://user:pass@localhost/pdf_sum, Update the metadata JSONB for a chunk (merge with existing)., UUID

### Community 35 - "SIGNAL Dashboard Overview"
Cohesion: 0.29
Nodes (7): Chart.js via react-chartjs-2, Dashboard Views (Overview, PyPI, GitHub, etc.), Pure React State Navigation (no router), SIGNAL — AI Demand Tracker Dashboard, Simulated Data Generation (trend/series), Vanilla CSS Variables Styling, Vite + React Frontend Stack

### Community 36 - "GitHub Data Scraper"
Cohesion: 0.38
Nodes (6): axios, cheerio, getDependents(), getGitHubData(), getStars(), REPOS

### Community 37 - "Google Trends Scraper"
Cohesion: 0.38
Nodes (6): API_KEYWORDS, BRAND_KEYWORDS, getGeoData(), getTrendsData(), googleTrends, parseTimeline()

### Community 38 - "List Query Formatting"
Cohesion: 0.33
Nodes (3): Deterministically format a document inventory as markdown — no LLM call., Handle list-type queries: return all matching documents as an organised inventor, True if the query carries a concept worth semantic ranking, beyond the         m

### Community 39 - "Document Removal Utils"
Cohesion: 0.33
Nodes (4): main(), Remove a document (and all its chunks) from the database.  Usage:   # By file pa, get_file_hash(), Return SHA256 hash of a file.

### Community 40 - "GPU Price Scraper"
Cohesion: 0.47
Nodes (5): axios, cheerio, getGpuPrices(), getLambdaPrices(), getVastPrices()

### Community 42 - "App Favicon Design"
Cohesion: 0.50
Nodes (5): Blue Accent Color (#47bfff), Gaussian Blur Glow Effects, Favicon SVG Icon, Lightning Bolt / Zigzag Shape, Primary Purple Color (#863bff)

### Community 48 - "Hero Image Asset"
Cohesion: 0.67
Nodes (3): Layered Platform / Data Stack Design Concept, Hero Image (Isometric Layered Cards Illustration), Hero Section (Frontend UI)

### Community 49 - "Vite Brand Asset"
Cohesion: 1.00
Nodes (3): Vite (Build Tool Brand), Vite Logo, vite.svg Static Asset

## Knowledge Gaps
- **234 isolated node(s):** `Any`, `name`, `private`, `version`, `type` (+229 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GeminiRAGPipeline` connect `RAG Retrieval Engine` to `Query Analysis and Coverage`, `Backend Data Models and Canvas`, `Database ORM and Document Schema`, `List Query Formatting`, `RAG Filter and Answer Logic`, `PDF Ingestion Pipeline`, `Agentic Research Module`, `Document Upload API`, `Gemini Embedding Service`, `FastAPI Dependencies Layer`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `PDFSummarizerPipeline` connect `PDF Ingestion Pipeline` to `PDF Processing and Broker Cache`, `Database ORM and Document Schema`, `RAG Retrieval Engine`, `Document Upload API`, `Email Ingestion Pipeline`, `PDF Ingestion Tests`, `FastAPI Dependencies Layer`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `DatabaseManager` connect `Database ORM and Document Schema` to `Chunk Metadata and Embeddings`, `Backend Data Models and Canvas`, `RAG Retrieval Engine`, `RAG Filter and Answer Logic`, `PDF Ingestion Pipeline`, `Document Upload API`, `PDF Ingestion Tests`, `FastAPI Dependencies Layer`, `Document Search and Listing`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Are the 20 inferred relationships involving `GeminiRAGPipeline` (e.g. with `AgentRunRequest` and `AskRequest`) actually correct?**
  _`GeminiRAGPipeline` has 20 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `DatabaseManager` (e.g. with `CanvasCreateRequest` and `CanvasSaveRequest`) actually correct?**
  _`DatabaseManager` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `PDFSummarizerPipeline` (e.g. with `DatabaseManager` and `PDFDocument`) actually correct?**
  _`PDFSummarizerPipeline` has 15 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Broker-aware Gemini context caching for Agent 2 (Financial Schema Extractor).  E`, `Return the full cached system instruction for a given broker name.`, `Stable, filesystem-safe key for a broker name.` to the rest of the system?**
  _342 weakly-connected nodes found - possible documentation gaps or missing edges._