#!/usr/bin/env python3
"""Index and query semantic earnings-transcript chunks with local BGE + Chroma."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import chromadb
except ImportError as error:
    raise SystemExit(
        "chromadb is not installed. Run: "
        "server/.venv-transcripts/bin/pip install -r server/retrieval/requirements.txt"
    ) from error

ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPT_ROOT = ROOT / "data" / "transcripts"
PROCESSED_ROOT = TRANSCRIPT_ROOT / "processed"
EMBEDDING_ROOT = TRANSCRIPT_ROOT / "embeddings"
CHROMA_ROOT = EMBEDDING_ROOT / "chroma"
MODEL_CACHE = EMBEDDING_ROOT / "models"
MANIFEST_PATH = EMBEDDING_ROOT / "manifest.json"
REQUESTED_MODEL = os.environ.get("BGE_MODEL", "").strip()
FREE_DISK_BYTES = shutil.disk_usage(TRANSCRIPT_ROOT).free
MODEL_NAME = REQUESTED_MODEL or (
    "BAAI/bge-small-en-v1.5"
    if FREE_DISK_BYTES < 3 * 1024**3
    else "BAAI/bge-large-en-v1.5"
)
MODEL_SLUG = MODEL_NAME.rsplit("/", 1)[-1].replace(".", "_").replace("-", "_")
COLLECTION_NAME = f"earnings_transcript_chunks_{MODEL_SLUG}_v1"
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def load_chunks() -> tuple[list[dict[str, Any]], list[Path]]:
    files = sorted(PROCESSED_ROOT.glob("*/*.json"))
    chunks: list[dict[str, Any]] = []
    for file in files:
        payload = json.loads(file.read_text())
        chunks.extend(payload.get("chunks", []))
    if not chunks:
        raise RuntimeError(f"No processed transcript chunks found under {PROCESSED_ROOT}")
    return chunks, files


def content_digest(chunks: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for chunk in sorted(chunks, key=lambda item: item["id"]):
        digest.update(chunk["id"].encode())
        digest.update(b"\0")
        digest.update(chunk["text"].encode())
        digest.update(b"\0")
    return digest.hexdigest()


def load_model():
    import torch
    from transformers import AutoModel, AutoTokenizer

    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            MODEL_NAME,
            cache_dir=MODEL_CACHE,
            local_files_only=True,
        )
        model = AutoModel.from_pretrained(
            MODEL_NAME,
            cache_dir=MODEL_CACHE,
            local_files_only=True,
        )
    except OSError:
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, cache_dir=MODEL_CACHE)
        model = AutoModel.from_pretrained(MODEL_NAME, cache_dir=MODEL_CACHE)
    model.eval()
    model.to(device)
    return tokenizer, model, device


def encode(texts: list[str], tokenizer, model, device: str, batch_size: int) -> list[list[float]]:
    import torch

    vectors: list[list[float]] = []
    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            inputs = tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            inputs = {key: value.to(device) for key, value in inputs.items()}
            output = model(**inputs).last_hidden_state[:, 0]
            output = torch.nn.functional.normalize(output, p=2, dim=1)
            vectors.extend(output.cpu().tolist())
            print(f"[embed] encoded {min(start + len(batch), len(texts))}/{len(texts)}", flush=True)
    return vectors


def chroma_client():
    CHROMA_ROOT.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(CHROMA_ROOT))


def collection(client):
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine", "model": MODEL_NAME},
    )


def chroma_metadata(chunk: dict[str, Any]) -> dict[str, Any]:
    return {
        "ticker": chunk["ticker"],
        "quarter": chunk["quarter"],
        "year": int(chunk["year"]),
        "fiscal_period": chunk["fiscal_period"],
        "speaker": chunk["speaker"],
        "role": chunk["role"],
        "section": chunk["section"],
        "kind": chunk["kind"],
        "topic": chunk["topic"],
        "topics": "|".join(chunk.get("topics", [])),
        "token_count": int(chunk["tokenCount"]),
        "source_block_id": int(chunk["sourceBlockId"]),
    }


def update_processed_files(files: list[Path], indexed_at: str, dimension: int) -> None:
    for file in files:
        payload = json.loads(file.read_text())
        payload["embedding"] = {
            "provider": "local",
            "model": MODEL_NAME,
            "dimension": dimension,
            "normalized": True,
            "collection": COLLECTION_NAME,
            "indexedAt": indexed_at,
        }
        file.write_text(json.dumps(payload, indent=2) + "\n")


def index_chunks(args) -> None:
    chunks, files = load_chunks()
    digest = content_digest(chunks)
    client = chroma_client()
    target = collection(client)
    if MANIFEST_PATH.exists() and not args.force:
        manifest = json.loads(MANIFEST_PATH.read_text())
        if manifest.get("digest") == digest and target.count() == len(chunks):
            print(json.dumps({**manifest, "status": "current"}, indent=2))
            return

    tokenizer, model, device = load_model()
    print(f"[embed] model={MODEL_NAME} device={device} chunks={len(chunks)}", flush=True)
    vectors = encode([chunk["text"] for chunk in chunks], tokenizer, model, device, args.batch_size)

    current_ids = set(target.get(include=[])["ids"])
    incoming_ids = {chunk["id"] for chunk in chunks}
    stale_ids = sorted(current_ids - incoming_ids)
    if stale_ids:
        target.delete(ids=stale_ids)

    for start in range(0, len(chunks), 100):
        batch = chunks[start : start + 100]
        target.upsert(
            ids=[chunk["id"] for chunk in batch],
            embeddings=vectors[start : start + len(batch)],
            documents=[chunk["text"] for chunk in batch],
            metadatas=[chroma_metadata(chunk) for chunk in batch],
        )

    indexed_at = datetime.now(timezone.utc).isoformat()
    dimension = len(vectors[0])
    manifest = {
        "status": "indexed",
        "collection": COLLECTION_NAME,
        "model": MODEL_NAME,
        "dimension": dimension,
        "normalized": True,
        "chunks": len(chunks),
        "digest": digest,
        "indexedAt": indexed_at,
        "device": device,
        "freeDiskBytesAtStart": FREE_DISK_BYTES,
        "automaticLowDiskFallback": not REQUESTED_MODEL and MODEL_NAME.endswith("small-en-v1.5"),
    }
    EMBEDDING_ROOT.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    update_processed_files(files, indexed_at, dimension)
    print(json.dumps(manifest, indent=2))


def query_chunks(args) -> None:
    tokenizer, model, device = load_model()
    vector = encode([QUERY_PREFIX + args.query], tokenizer, model, device, 1)[0]
    filters = []
    if args.ticker:
        filters.append({"ticker": args.ticker.upper()})
    if args.period:
        filters.append({"fiscal_period": args.period.upper()})
    if args.topic:
        filters.append({"topic": args.topic})
    where = filters[0] if len(filters) == 1 else {"$and": filters} if filters else None

    result = collection(chroma_client()).query(
        query_embeddings=[vector],
        n_results=args.limit,
        where=where,
        include=["documents", "metadatas", "distances"],
    )
    rows = []
    for index, item_id in enumerate(result["ids"][0]):
        rows.append({
            "id": item_id,
            "distance": result["distances"][0][index],
            "metadata": result["metadatas"][0][index],
            "text": result["documents"][0][index],
        })
    print(json.dumps({"query": args.query, "results": rows}, indent=2))


def stats(_args) -> None:
    target = collection(chroma_client())
    manifest = json.loads(MANIFEST_PATH.read_text()) if MANIFEST_PATH.exists() else {}
    print(json.dumps({"count": target.count(), **manifest}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    index_parser = subparsers.add_parser("index")
    index_parser.add_argument("--batch-size", type=int, default=8)
    index_parser.add_argument("--force", action="store_true")
    index_parser.set_defaults(handler=index_chunks)

    query_parser = subparsers.add_parser("query")
    query_parser.add_argument("query")
    query_parser.add_argument("--ticker")
    query_parser.add_argument("--period")
    query_parser.add_argument("--topic")
    query_parser.add_argument("--limit", type=int, default=5)
    query_parser.set_defaults(handler=query_chunks)

    stats_parser = subparsers.add_parser("stats")
    stats_parser.set_defaults(handler=stats)

    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
