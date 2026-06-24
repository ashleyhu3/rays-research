# Graph Report - /Users/ashleyhu/Desktop/rays-research/Rays_Intern  (2026-06-23)

## Corpus Check
- 44 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 551 nodes · 934 edges · 46 communities (33 shown, 13 thin omitted)
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 173 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Client Canvas Layer|API Client Canvas Layer]]
- [[_COMMUNITY_Agent Run Requests|Agent Run Requests]]
- [[_COMMUNITY_Broker Context Cache|Broker Context Cache]]
- [[_COMMUNITY_Database Manager & Types|Database Manager & Types]]
- [[_COMMUNITY_Backend README Architecture|Backend README Architecture]]
- [[_COMMUNITY_Frontend Dependencies|Frontend Dependencies]]
- [[_COMMUNITY_TS App Config|TS App Config]]
- [[_COMMUNITY_TS Node Config|TS Node Config]]
- [[_COMMUNITY_Backend Dependency Injection|Backend Dependency Injection]]
- [[_COMMUNITY_RAG Query & Answer Pipeline|RAG Query & Answer Pipeline]]
- [[_COMMUNITY_Gemini Embedding & Extraction|Gemini Embedding & Extraction]]
- [[_COMMUNITY_Document Upload Routes|Document Upload Routes]]
- [[_COMMUNITY_Email Poller Ingest|Email Poller Ingest]]
- [[_COMMUNITY_RAG Context Building|RAG Context Building]]
- [[_COMMUNITY_PDF Ingest Testing|PDF Ingest Testing]]
- [[_COMMUNITY_PDF Processing & Pipeline|PDF Processing & Pipeline]]
- [[_COMMUNITY_Gemini RAG Pipeline Core|Gemini RAG Pipeline Core]]
- [[_COMMUNITY_Sourcing Tests|Sourcing Tests]]
- [[_COMMUNITY_Example Scripts|Example Scripts]]
- [[_COMMUNITY_Gemini Rate Limiter|Gemini Rate Limiter]]
- [[_COMMUNITY_Favicon Assets|Favicon Assets]]
- [[_COMMUNITY_FastAPI Main Entry|FastAPI Main Entry]]
- [[_COMMUNITY_RAG Page Expansion & Citation|RAG Page Expansion & Citation]]
- [[_COMMUNITY_Hero UI Design|Hero UI Design]]
- [[_COMMUNITY_Vite Logo Assets|Vite Logo Assets]]
- [[_COMMUNITY_TS Root Config|TS Root Config]]
- [[_COMMUNITY_Docling Sample|Docling Sample]]
- [[_COMMUNITY_React Brand|React Brand]]
- [[_COMMUNITY_React Logo|React Logo]]
- [[_COMMUNITY_Bluesky Icon|Bluesky Icon]]
- [[_COMMUNITY_Discord Icon|Discord Icon]]
- [[_COMMUNITY_Docs Icon|Docs Icon]]
- [[_COMMUNITY_GitHub Icon|GitHub Icon]]
- [[_COMMUNITY_Icon Set|Icon Set]]
- [[_COMMUNITY_Social Icon|Social Icon]]
- [[_COMMUNITY_X Icon|X Icon]]

## God Nodes (most connected - your core abstractions)
1. `GeminiRAGPipeline` - 46 edges
2. `DatabaseManager` - 45 edges
3. `PDFSummarizerPipeline` - 24 edges
4. `PDFDocument` - 21 edges
5. `RetrievalFilters` - 20 edges
6. `compilerOptions` - 20 edges
7. `compilerOptions` - 18 edges
8. `PDFChunk` - 15 edges
9. `useCanvasStore` - 15 edges
10. `PDF Summarizer RAG Pipeline (Docling + Gemini + pgvector)` - 14 edges

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

## Communities (46 total, 13 thin omitted)

### Community 0 - "API Client Canvas Layer"
Cohesion: 0.06
Nodes (59): askQuestion(), createCanvas(), deleteCanvas(), deleteDocument(), http, listCanvases(), listDocuments(), loadCanvas() (+51 more)

### Community 1 - "Agent Run Requests"
Cohesion: 0.08
Nodes (44): AgentRunRequest, AskRequest, Agentic research system.  Given a high-level goal, the ResearchAgent:   1. Decom, Ask Gemini to synthesize all sub-answers into a final report., Run the full agentic pipeline.          Returns:             {                 ", Ask Gemini to break the goal into 3-5 specific sub-questions., ResearchAgent, Canvas (+36 more)

### Community 2 - "Broker Context Cache"
Cohesion: 0.06
Nodes (33): BrokerContextCache, _cache_key(), Broker-aware Gemini context caching for Agent 2 (Financial Schema Extractor).  E, Return the full cached system instruction for a given broker name., Stable, filesystem-safe key for a broker name., Manages per-broker Gemini context caches for Agent 2.      Thread-safe. Caches a, Return an active cache name for this broker, creating one if needed.          Re, _system_instruction_for() (+25 more)

### Community 3 - "Database Manager & Types"
Cohesion: 0.08
Nodes (27): Any, date_cls, Exception, DatabaseManager, PDFChunk, PDFDocument, Database module: Golden Schema for financial RAG.  Store verbalization for searc, Manages database connections and operations. (+19 more)

### Community 4 - "Backend README Architecture"
Cohesion: 0.06
Nodes (47): agent.py — Research agent goal decomposition + synthesis, canvas_db.py — Canvas + ReactFlow state persistence, dependencies.py — Shared singletons (DB manager, RAG pipeline), FastAPI Backend REST API, main.py — FastAPI app, CORS, router wiring, models.py — Pydantic DTOs (AskResponse, ChunkRef, etc.), routes/ — Feature-area routers (documents, queries, agent, canvas), Threadpool Async Wrapper for RAG pipeline (+39 more)

### Community 5 - "Frontend Dependencies"
Cohesion: 0.06
Nodes (31): dependencies, axios, react, react-dom, @xyflow/react, zustand, devDependencies, autoprefixer (+23 more)

### Community 6 - "TS App Config"
Cohesion: 0.09
Nodes (21): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+13 more)

### Community 7 - "TS Node Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 8 - "Backend Dependency Injection"
Cohesion: 0.13
Nodes (14): get_db(), get_pipeline(), get_rag(), Shared singletons for FastAPI dependency injection.  canvas_db is imported first, main(), PDFSummarizerPipeline, Main pipeline: Docling parse → Gemini verbalize → Store in Postgres.  Process PD, Process all PDFs in a directory, up to max_workers PDFs at a time.          Each (+6 more)

### Community 9 - "RAG Query & Answer Pipeline"
Cohesion: 0.12
Nodes (10): _is_content_enumeration(), True if any metadata filter scopes the search (company/ticker/sector/date/etc.)., Deterministic fallback for the model's is_underspecified judgment (used only if, Build a clarification response for an underspecified, filter-scoped query: state, Answer a question using RAG with optional conversation history.          Pipelin, True if the question asks to enumerate CONTENT (trends, risks, takeaways, ...) r, Single Gemini Flash call that simultaneously:           1. Extracts hard filters, Document-level citation check (no LLM call). The model reliably gets the *docume (+2 more)

### Community 10 - "Gemini Embedding & Extraction"
Cohesion: 0.16
Nodes (14): _apply_period_safety_net(), embed_text(), embed_texts_batch(), _extract_coverage_period(), _get_client(), _is_rate_limit(), main(), RAG pipeline: search on verbalized_summary, answer from raw_content.  Flow: Retu (+6 more)

### Community 11 - "Document Upload Routes"
Cohesion: 0.27
Nodes (13): DocumentOut, UploadResult, DatabaseManager, GeminiRAGPipeline, Path, PDFSummarizerPipeline, delete_document(), _extract_docs_from_eml() (+5 more)

### Community 12 - "Email Poller Ingest"
Cohesion: 0.19
Nodes (11): _install_cron(), poll(), Gmail IMAP poller — fetches unread research emails and ingests them into the pip, Print instructions and the crontab line to add., Fetch unread emails, ingest any that match the sender filter, return a summary., _sender_matches_filter(), extract_docs_from_eml(), ingest_emls() (+3 more)

### Community 13 - "RAG Context Building"
Cohesion: 0.21
Nodes (7): Spread retrieval across documents for breadth. Round-robins one chunk at a time, Promote diversity across sections and hierarchy levels.          Strategy:, Vector search over verbalized_summary embeddings.          Expects `query` to al, Return (parent, prev_sibling, next_sibling) for a chunk using metadata IDs., Build context from the retrieved chunks: for each chunk include its metadata +, Format one retrieved chunk plus its parent and siblings (metadata + summary + co, PDFChunk

### Community 14 - "PDF Ingest Testing"
Cohesion: 0.26
Nodes (12): _find_pdf_path(), _get_chunk_by_id(), main(), _print_chunk(), print_ingested_document_and_chunks(), Simple test: ingest a single PDF through the full pipeline.  Default behavior: c, Resolve PDF: env var, or first PDF in test_PDFs/ or research_pdfs/., Resolve chunk by UUID string; return None if invalid or missing. (+4 more)

### Community 15 - "PDF Processing & Pipeline"
Cohesion: 0.17
Nodes (8): get_token_usage(), Return a snapshot of token usage accumulated this session, keyed by model., Set parent_chunk_id, prev_sibling_chunk_id, next_sibling_chunk_id in each chunk', Process a single PDF: Docling parse → Gemini verbalize → store pages., main(), Remove a document (and all its chunks) from the database.  Usage:   # By file pa, get_file_hash(), Return SHA256 hash of a file.

### Community 16 - "Gemini RAG Pipeline Core"
Cohesion: 0.21
Nodes (7): GeminiRAGPipeline, Deterministically format a document inventory as markdown — no LLM call., Handle list-type queries: return all matching documents as an organised inventor, RAG over verbalized pages (text + chart descriptions)., Convert an ISO date string from the LLM ('YYYY-MM-DD') to a datetime.date., Merge LLM-inferred hard filters with explicit caller-supplied filters.         E, True if the query carries a concept worth semantic ranking, beyond the         m

### Community 17 - "Sourcing Tests"
Cohesion: 0.45
Nodes (10): build_pipeline(), failed(), make_chunk(), passed(), Tests that source citations (filename + page) flow correctly through the RAG pip, Construct a GeminiRAGPipeline with a mocked client and the given db., test_chunks_used_metadata(), test_context_contains_source() (+2 more)

### Community 18 - "Example Scripts"
Cohesion: 0.25
Nodes (7): example_directory(), example_query_database(), example_single_pdf(), Example usage of the Docling + Gemini verbalization pipeline., Process a single PDF from research_pdfs., Process all PDFs in research_pdfs., Query the database for processed documents and chunks.

### Community 19 - "Gemini Rate Limiter"
Cohesion: 0.32
Nodes (3): GeminiRateLimiter, Shared Gemini API rate limiter.  Enforces two limits:   - RPM: minimum gap betwe, Block until it is safe to make the next Gemini API call, then record it.

### Community 20 - "Favicon Assets"
Cohesion: 0.50
Nodes (5): Blue Accent Color (#47bfff), Gaussian Blur Glow Effects, Favicon SVG Icon, Lightning Bolt / Zigzag Shape, Primary Purple Color (#863bff)

### Community 23 - "Hero UI Design"
Cohesion: 0.67
Nodes (3): Layered Platform / Data Stack Design Concept, Hero Image (Isometric Layered Cards Illustration), Hero Section (Frontend UI)

### Community 24 - "Vite Logo Assets"
Cohesion: 1.00
Nodes (3): Vite (Build Tool Brand), Vite Logo, vite.svg Static Asset

## Knowledge Gaps
- **111 isolated node(s):** `Any`, `name`, `private`, `version`, `type` (+106 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GeminiRAGPipeline` connect `Gemini RAG Pipeline Core` to `Agent Run Requests`, `Database Manager & Types`, `Backend Dependency Injection`, `RAG Query & Answer Pipeline`, `Gemini Embedding & Extraction`, `Document Upload Routes`, `RAG Context Building`, `RAG Page Expansion & Citation`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `PDFSummarizerPipeline` connect `Backend Dependency Injection` to `Broker Context Cache`, `Database Manager & Types`, `Document Upload Routes`, `Email Poller Ingest`, `PDF Ingest Testing`, `PDF Processing & Pipeline`, `Gemini RAG Pipeline Core`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `DatabaseManager` connect `Database Manager & Types` to `Agent Run Requests`, `Backend Dependency Injection`, `Document Upload Routes`, `RAG Context Building`, `PDF Ingest Testing`, `Gemini RAG Pipeline Core`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Are the 20 inferred relationships involving `GeminiRAGPipeline` (e.g. with `AgentRunRequest` and `AskRequest`) actually correct?**
  _`GeminiRAGPipeline` has 20 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `DatabaseManager` (e.g. with `CanvasCreateRequest` and `CanvasSaveRequest`) actually correct?**
  _`DatabaseManager` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `PDFSummarizerPipeline` (e.g. with `DatabaseManager` and `PDFDocument`) actually correct?**
  _`PDFSummarizerPipeline` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `PDFDocument` (e.g. with `date_cls` and `Exception`) actually correct?**
  _`PDFDocument` has 15 INFERRED edges - model-reasoned connections that need verification._