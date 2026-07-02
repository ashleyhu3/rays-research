#!/usr/bin/env python3
"""Run local FinBERT and emotion models over processed transcript chunks."""

from __future__ import annotations

import argparse
import gc
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPT_ROOT = ROOT / "data" / "transcripts"
PROCESSED_ROOT = TRANSCRIPT_ROOT / "processed"
MODEL_CACHE = TRANSCRIPT_ROOT / "embeddings" / "models"
FINBERT_MODEL = os.environ.get("FINBERT_MODEL", "ProsusAI/finbert")
EMOTION_MODEL = os.environ.get(
    "EMOTION_MODEL",
    "j-hartmann/emotion-english-distilroberta-base",
)


def load_payloads() -> tuple[list[dict[str, Any]], list[Path]]:
    files = sorted(PROCESSED_ROOT.glob("*/*.json"))
    payloads = [json.loads(file.read_text()) for file in files]
    if not payloads:
        raise RuntimeError(f"No processed transcript chunks found under {PROCESSED_ROOT}")
    return payloads, files


def load_classifier(model_name: str):
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            cache_dir=MODEL_CACHE,
            local_files_only=True,
        )
        model = AutoModelForSequenceClassification.from_pretrained(
            model_name,
            cache_dir=MODEL_CACHE,
            local_files_only=True,
        )
    except OSError:
        tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir=MODEL_CACHE)
        model = AutoModelForSequenceClassification.from_pretrained(
            model_name,
            cache_dir=MODEL_CACHE,
        )
    model.eval()
    model.to(device)
    return tokenizer, model, device


def classify(
    texts: list[str],
    model_name: str,
    batch_size: int,
) -> list[dict[str, float]]:
    import torch

    tokenizer, model, device = load_classifier(model_name)
    labels = {
        int(index): str(label).lower()
        for index, label in model.config.id2label.items()
    }
    results: list[dict[str, float]] = []
    print(f"[tone-local] model={model_name} device={device} chunks={len(texts)}", flush=True)
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
            probabilities = torch.softmax(model(**inputs).logits, dim=-1).cpu().tolist()
            for row in probabilities:
                results.append({
                    labels[index]: round(float(score), 6)
                    for index, score in enumerate(row)
                })
            print(
                f"[tone-local] {model_name.rsplit('/', 1)[-1]} "
                f"{min(start + len(batch), len(texts))}/{len(texts)}",
                flush=True,
            )
    del model
    del tokenizer
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    return results


def normalize_finbert(scores: dict[str, float]) -> dict[str, Any]:
    positive = scores.get("positive", scores.get("label_0", 0))
    negative = scores.get("negative", scores.get("label_1", 0))
    neutral = scores.get("neutral", scores.get("label_2", 0))
    label = max(
        {"positive": positive, "negative": negative, "neutral": neutral},
        key={"positive": positive, "negative": negative, "neutral": neutral}.get,
    )
    return {
        "model": FINBERT_MODEL,
        "label": label,
        "score": round(positive - negative, 6),
        "probabilities": {
            "positive": positive,
            "negative": negative,
            "neutral": neutral,
        },
    }


def normalize_emotion(scores: dict[str, float]) -> dict[str, Any]:
    known = {
        label: scores.get(label, 0)
        for label in ["anger", "disgust", "fear", "joy", "neutral", "sadness", "surprise"]
    }
    label = max(known, key=known.get)
    concern = max(known["fear"], known["sadness"], known["anger"], known["disgust"])
    return {
        "model": EMOTION_MODEL,
        "label": label,
        "score": known[label],
        "scores": known,
        "dimensions": {
            "confidence": round(max(0.0, known["joy"] + known["neutral"] * 0.35 - concern * 0.5), 6),
            "optimism": round(known["joy"], 6),
            "concern": round(concern, 6),
            "excitement": round(max(known["joy"], known["surprise"] * 0.75), 6),
            "uncertainty": round(min(1.0, known["surprise"] * 0.6 + known["fear"] * 0.4), 6),
            "fear": round(known["fear"], 6),
        },
    }


def write_payloads(payloads: list[dict[str, Any]], files: list[Path]) -> None:
    analyzed_at = datetime.now(timezone.utc).isoformat()
    for payload, file in zip(payloads, files, strict=True):
        payload["toneLocal"] = {
            "financialModel": FINBERT_MODEL,
            "emotionModel": EMOTION_MODEL,
            "analyzedAt": analyzed_at,
        }
        file.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    payloads, files = load_payloads()
    chunks = [chunk for payload in payloads for chunk in payload.get("chunks", [])]
    if not args.force and chunks and all(
        chunk.get("tone", {}).get("finbert", {}).get("model") == FINBERT_MODEL
        and chunk.get("tone", {}).get("emotion", {}).get("model") == EMOTION_MODEL
        for chunk in chunks
    ):
        print(json.dumps({"status": "current", "chunks": len(chunks)}, indent=2))
        return

    finbert_targets = [
        chunk for chunk in chunks
        if args.force or chunk.get("tone", {}).get("finbert", {}).get("model") != FINBERT_MODEL
    ]
    if finbert_targets:
        finbert_rows = classify(
            [chunk["text"] for chunk in finbert_targets],
            FINBERT_MODEL,
            args.batch_size,
        )
        for chunk, scores in zip(finbert_targets, finbert_rows, strict=True):
            chunk.setdefault("tone", {})["finbert"] = normalize_finbert(scores)
        write_payloads(payloads, files)

    emotion_targets = [
        chunk for chunk in chunks
        if args.force or chunk.get("tone", {}).get("emotion", {}).get("model") != EMOTION_MODEL
    ]
    if emotion_targets:
        emotion_rows = classify(
            [chunk["text"] for chunk in emotion_targets],
            EMOTION_MODEL,
            args.batch_size,
        )
        for chunk, scores in zip(emotion_targets, emotion_rows, strict=True):
            chunk.setdefault("tone", {})["emotion"] = normalize_emotion(scores)
        write_payloads(payloads, files)
    print(json.dumps({
        "status": "analyzed",
        "chunks": len(chunks),
        "financialModel": FINBERT_MODEL,
        "emotionModel": EMOTION_MODEL,
    }, indent=2))


if __name__ == "__main__":
    main()
