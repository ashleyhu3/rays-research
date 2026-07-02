# Local transcript retrieval

Stages 3 and 5 run in Node:

```bash
npm run enrich:transcripts
```

This writes topic-aware semantic chunks to
`server/data/transcripts/processed/` and, when MongoDB is configured,
upserts `transcript_enrichments` and `transcript_chunks`.

Stage 4 uses a persistent local Chroma collection. It selects the recommended
`BAAI/bge-large-en-v1.5` model when at least 3 GB is free and automatically
falls back to `BAAI/bge-small-en-v1.5` on low-disk machines. Set `BGE_MODEL`
to override this:

```bash
python3 -m venv --system-site-packages server/.venv-transcripts
server/.venv-transcripts/bin/pip install -r server/retrieval/requirements.txt
npm run embed:transcripts
```

The index is resumable and stored under
`server/data/transcripts/embeddings/`. Re-running the command skips encoding
when the chunk digest and Chroma record count are current.

Query the local index:

```bash
npm run query:transcripts -- "What did management say about AI capex?" --ticker GOOGL --limit 5
```

Documents are embedded without a prompt. Retrieval queries use BGE's
recommended English prefix: `Represent this sentence for searching relevant passages:`.

Stages 6 and 7:

```bash
# Local financial sentiment + emotion signals
npm run tone:transcripts:local

# Selective qualitative interpretation of management Q&A answers
npm run tone:transcripts:llm

# Merge tone signals, extract facts, and persist MongoDB records
npm run facts:transcripts
```

The local tone pass uses `ProsusAI/finbert` and
`j-hartmann/emotion-english-distilroberta-base`. The LLM pass only receives
management answer chunks, not whole transcripts. Each extracted fact retains
its exact source statement, speaker, section, quarter, chunk ID, topic tags,
metrics, forward-looking flag, and merged tone.
