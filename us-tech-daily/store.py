"""Dual-mode store for the us-tech-daily pipeline.

  MONGODB_URI unset  -> local JSON files under data/ / narrative/ / reports/, exactly the
                         layout the pipeline has always used. This is the manual/local path.
  MONGODB_URI set     -> MongoDB, collection "blobs". A scheduled run uses this mode and
                         writes nothing to local disk.

Mongo wire format matches server/storage.js exactly so the Node server can read what this
module writes, and vice versa:
  compressed docs  {_id, compressed: gzip(json_utf8), encoding: "gzip-json", updatedAt}
  plain blob docs  {_id, data, updatedAt}

Every pipeline stage (EOD/aggregate/news/narrative) is a "session doc" keyed by
(doc_type, kind, date). Reports and their PDFs are a separate, smaller set of documents
publish.py writes directly — see write_report / write_report_pdf below.
"""

from __future__ import annotations

import base64
import gzip
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
NARRATIVE_DIR = ROOT / "narrative"
REPORT_DIR = ROOT / "reports"

_ID_RE = re.compile(r"^[A-Za-z0-9:_-]+$")

_client = None
_collection = None


def mode() -> str:
    return "mongo" if os.getenv("MONGODB_URI") else "file"


def _collection_handle():
    global _client, _collection
    if _collection is not None:
        return _collection
    from pymongo import MongoClient  # deferred: file mode never needs pymongo installed

    uri = os.environ["MONGODB_URI"]
    _client = MongoClient(uri, serverSelectionTimeoutMS=10000)
    db_name = os.getenv("MONGODB_DB")
    db = _client[db_name] if db_name else _client.get_default_database()
    _collection = db["blobs"]
    return _collection


def session_key(kind: str, date_str: str) -> str:
    """us -> the bare date (matches every filename the pipeline has written until now);
    any other kind gets a "{kind}_" prefix so it can never collide with a US file/id."""
    return date_str if kind == "us" else f"{kind}_{date_str}"


def _require_id(doc_id: str) -> str:
    if not _ID_RE.match(doc_id):
        raise ValueError(f"invalid store id: {doc_id!r}")
    return doc_id


# ---------------------------------------------------------------- session docs (gzip-json)

# doc_type -> (dir, filename prefix, filename suffix, mongo id prefix)
_DOC_SPEC = {
    "eod":       (DATA_DIR, "eod_", ".json", "usTechEod"),
    "agg":       (DATA_DIR, "agg_", ".json", "usTechAgg"),
    "news":      (DATA_DIR, "news_", ".json", "usTechNews"),
    "narrative": (NARRATIVE_DIR, "", ".json", "usTechNarrative"),
}


def _file_path(doc_type: str, kind: str, date_str: str) -> Path:
    dir_, prefix, suffix, _ = _DOC_SPEC[doc_type]
    return dir_ / f"{prefix}{session_key(kind, date_str)}{suffix}"


def _mongo_id(doc_type: str, kind: str, date_str: str) -> str:
    _, _, _, mongo_prefix = _DOC_SPEC[doc_type]
    return _require_id(f"{mongo_prefix}:{kind}:{date_str}")


def read_json(doc_type: str, kind: str, date_str: str) -> dict | None:
    if mode() == "file":
        path = _file_path(doc_type, kind, date_str)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    doc = _collection_handle().find_one({"_id": _mongo_id(doc_type, kind, date_str)})
    if not doc or not doc.get("compressed"):
        return None
    return json.loads(gzip.decompress(bytes(doc["compressed"])).decode("utf-8"))


def write_json(doc_type: str, kind: str, date_str: str, obj: dict) -> None:
    if mode() == "file":
        path = _file_path(doc_type, kind, date_str)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
        return

    payload = gzip.compress(json.dumps(obj, ensure_ascii=False).encode("utf-8"), compresslevel=6)
    _collection_handle().update_one(
        {"_id": _mongo_id(doc_type, kind, date_str)},
        {"$set": {"compressed": payload, "encoding": "gzip-json", "updatedAt": datetime.now(timezone.utc)}},
        upsert=True,
    )


def list_sessions(doc_type: str) -> dict[str, dict]:
    """{session_key: parsed_json} across every kind and date on record.

    File mode mirrors what `DATA_DIR.glob("agg_*.json")` already returns — the session key
    is the filename stem with the doc_type prefix stripped, e.g. "2026-07-31" or
    "asia_2026-07-31". lint_narrative.py's cross-session check relies on this shape.
    """
    dir_, prefix, suffix, mongo_prefix = _DOC_SPEC[doc_type]

    if mode() == "file":
        out: dict[str, dict] = {}
        for path in sorted(dir_.glob(f"{prefix}*{suffix}")):
            key = path.name[len(prefix): -len(suffix)] if suffix else path.name[len(prefix):]
            out[key] = json.loads(path.read_text(encoding="utf-8"))
        return out

    out = {}
    for doc in _collection_handle().find({"_id": {"$regex": f"^{re.escape(mongo_prefix)}:"}}):
        _, kind, date_str = doc["_id"].split(":", 2)
        if not doc.get("compressed"):
            continue
        out[session_key(kind, date_str)] = json.loads(gzip.decompress(bytes(doc["compressed"])).decode("utf-8"))
    return out


# ---------------------------------------------------------------- report + pdf + index

_REPORT_STEM = {"us": "us_tech_daily", "asia": "asia_tech_daily"}


def report_stem(kind: str) -> str:
    return _REPORT_STEM.get(kind, f"{kind}_tech_daily")


def report_file_paths(kind: str, date_str: str) -> dict[str, Path]:
    """File-mode-only paths, in today's exact naming convention. Used by render_report.py /
    export_report.py's own CLI writers, which stay file-based regardless of store mode —
    publish.py is what puts a report into Mongo (see write_report below)."""
    base = REPORT_DIR / f"{date_str}_{report_stem(kind)}"
    return {"html": base.with_suffix(".html"), "md": base.with_suffix(".md"), "pdf": base.with_suffix(".pdf")}


def write_report(kind: str, date_str: str, payload: dict) -> None:
    """payload: {kind, slot, sessionDate, isFresh, reusedFrom, title, subtitle, badge,
    generatedAt, html, md}"""
    doc_id = _require_id(f"usTechReport:{kind}:{date_str}")
    if mode() == "file":
        _collection_handle_noop()
    payload_bytes = gzip.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"), compresslevel=6)
    _collection_handle().update_one(
        {"_id": doc_id},
        {"$set": {"compressed": payload_bytes, "encoding": "gzip-json", "updatedAt": datetime.now(timezone.utc)}},
        upsert=True,
    )


def read_report(kind: str, date_str: str) -> dict | None:
    doc = _collection_handle().find_one({"_id": f"usTechReport:{kind}:{date_str}"})
    if not doc or not doc.get("compressed"):
        return None
    return json.loads(gzip.decompress(bytes(doc["compressed"])).decode("utf-8"))


def write_report_pdf(kind: str, date_str: str, pdf_bytes: bytes, filename: str) -> None:
    doc_id = _require_id(f"usTechReportPdf:{kind}:{date_str}")
    _collection_handle().update_one(
        {"_id": doc_id},
        {"$set": {
            "date": date_str,
            "kind": kind,
            "filename": filename,
            "contentType": "application/pdf",
            "size": len(pdf_bytes),
            "base64": base64.b64encode(pdf_bytes).decode("ascii"),
            "updatedAt": datetime.now(timezone.utc),
        }},
        upsert=True,
    )


def prune_report_pdfs(days: int = 30) -> list[str]:
    """Delete usTechReportPdf:* docs older than `days`. Returns the pruned ids."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    col = _collection_handle()
    stale_ids = [
        doc["_id"] for doc in col.find(
            {"_id": {"$regex": "^usTechReportPdf:"}, "updatedAt": {"$lt": cutoff}},
            {"_id": 1},
        )
    ]
    if stale_ids:
        col.delete_many({"_id": {"$in": stale_ids}})
    return stale_ids


def read_report_index() -> dict:
    """{"us": [entry...], "asia": [entry...]}, newest-first. Plain blob shape ({_id, data})
    so server/storage.js's requireStorageBlobs + storage.read() work unchanged."""
    if mode() == "file":
        path = DATA_DIR / "reportIndex.json"
        if not path.exists():
            return {"us": [], "asia": []}
        return json.loads(path.read_text(encoding="utf-8"))

    doc = _collection_handle().find_one({"_id": "usTechReportIndex"})
    return doc["data"] if doc and doc.get("data") else {"us": [], "asia": []}


def write_report_index(data: dict) -> None:
    if mode() == "file":
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        (DATA_DIR / "reportIndex.json").write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return

    _collection_handle().update_one(
        {"_id": "usTechReportIndex"},
        {"$set": {"data": data, "updatedAt": datetime.now(timezone.utc)}},
        upsert=True,
    )


def _collection_handle_noop():
    """File mode never touches Mongo; write_report/write_report_pdf/prune/index-in-mongo
    are Mongo-only operations by design (publish.py requires MONGODB_URI to run)."""
    raise RuntimeError(
        "write_report / write_report_pdf / prune_report_pdfs need MONGODB_URI. "
        "In file mode, publish.py has nothing to publish to — reports stay on local disk."
    )
