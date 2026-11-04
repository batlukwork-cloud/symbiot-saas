from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services.embedding_provider import embedding_status
from app.services.rag_index import get_vector_status
from app.services.rag_index import search
from app.services.sqlite_store import ROOT


EVAL_SET_PATH = ROOT / "backend" / "evals" / "rag_semantic_eval_set.json"
THRESHOLDS_PATH = ROOT / "backend" / "evals" / "rag_eval_thresholds.json"
HISTORY_PATH = ROOT / "runtime_data" / "rag_eval_history.jsonl"


def load_eval_set() -> list[dict[str, Any]]:
    return json.loads(EVAL_SET_PATH.read_text(encoding="utf-8"))


def load_eval_thresholds() -> dict[str, Any]:
    return json.loads(THRESHOLDS_PATH.read_text(encoding="utf-8"))


def eval_history(limit: int = 20) -> list[dict[str, Any]]:
    if not HISTORY_PATH.exists():
        return []
    rows = [json.loads(line) for line in HISTORY_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    return rows[-limit:]


def evaluate_rag() -> dict[str, Any]:
    cases = load_eval_set()
    thresholds = load_eval_thresholds()
    results: list[dict[str, Any]] = []
    passed = 0
    reciprocal_rank_total = 0.0
    category_stats: dict[str, dict[str, int]] = {}
    for item in cases:
        response = search(query=item["query"], min_score=0.5)
        ranks = [chunk.document_id for chunk in response.chunks]
        expected = item["expected_document_id"]
        top = response.chunks[0] if response.chunks else None
        rank = ranks.index(expected) + 1 if expected in ranks else None
        hit = rank == 1 and top is not None and top.score >= item["min_score"]
        category = item.get("category", "uncategorized")
        category_stats.setdefault(category, {"total": 0, "passed": 0})
        category_stats[category]["total"] += 1
        if hit:
            passed += 1
            category_stats[category]["passed"] += 1
        if rank:
            reciprocal_rank_total += 1 / rank
        results.append(
            {
                "id": item["id"],
                "category": category,
                "query": item["query"],
                "requirement": item.get("requirement", ""),
                "expected_document_id": expected,
                "top_document_id": top.document_id if top else None,
                "top_score": top.score if top else 0,
                "rank": rank,
                "passed": hit,
                "index_mode": response.index_mode,
                "source_coverage": response.source_coverage,
            }
        )
    total = len(cases)
    pass_rate = round(passed / total, 3) if total else 0
    mrr = round(reciprocal_rank_total / total, 3) if total else 0
    status = embedding_status()
    vector_status = get_vector_status()
    previous = eval_history(limit=1)
    previous_pass_rate = previous[-1]["pass_rate"] if previous else None
    previous_mrr = previous[-1]["mrr"] if previous else None
    drift = {
        "previous_pass_rate": previous_pass_rate,
        "previous_mrr": previous_mrr,
        "pass_rate_delta": round(pass_rate - previous_pass_rate, 3) if previous_pass_rate is not None else None,
        "mrr_delta": round(mrr - previous_mrr, 3) if previous_mrr is not None else None,
        "warning": False,
    }
    if drift["pass_rate_delta"] is not None and drift["pass_rate_delta"] < -thresholds["drift_warning_drop"]:
        drift["warning"] = True
    if drift["mrr_delta"] is not None and drift["mrr_delta"] < -thresholds["drift_warning_drop"]:
        drift["warning"] = True
    category_report = {
        name: {
            **values,
            "pass_rate": round(values["passed"] / values["total"], 3) if values["total"] else 0,
        }
        for name, values in sorted(category_stats.items())
    }
    threshold_passed = (
        total >= thresholds["min_cases_before_client_pilot"]
        and pass_rate >= thresholds["min_pass_rate"]
        and mrr >= thresholds["min_mrr"]
        and vector_status.get("mode") == thresholds["allowed_index_mode"]
        and status.configured == thresholds["required_provider_configured"]
        and status.fallback_used == thresholds["required_provider_fallback_used"]
    )
    monitoring_event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider": status.provider,
        "model": status.model,
        "total": total,
        "passed": passed,
        "pass_rate": pass_rate,
        "mrr": mrr,
        "threshold_passed": threshold_passed,
        "index_mode": vector_status.get("mode"),
    }
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with HISTORY_PATH.open("a", encoding="utf-8") as file:
        file.write(json.dumps(monitoring_event, ensure_ascii=False) + "\n")
    return {
        "eval_set": str(EVAL_SET_PATH),
        "thresholds": thresholds,
        "provider": status.provider,
        "model": status.model,
        "provider_status": status.model_dump(),
        "vector_status": vector_status,
        "total": total,
        "passed": passed,
        "pass_rate": pass_rate,
        "mrr": mrr,
        "threshold_passed": threshold_passed,
        "category_report": category_report,
        "drift": drift,
        "results": results,
    }


def provider_governance_status() -> dict[str, Any]:
    status = embedding_status()
    vector_status = get_vector_status()
    eval_result = evaluate_rag()
    thresholds = load_eval_thresholds()
    client_data_ready = bool(
        eval_result["threshold_passed"]
        and vector_status.get("mode") == "pgvector_live"
        and status.configured
        and not status.fallback_used
    )
    return {
        "provider": status.provider,
        "model": status.model,
        "configured": status.configured,
        "fallback_used": status.fallback_used,
        "pgvector_live": vector_status.get("mode") == "pgvector_live",
        "eval_threshold_passed": eval_result["threshold_passed"],
        "pass_rate": eval_result["pass_rate"],
        "mrr": eval_result["mrr"],
        "eval_cases": eval_result["total"],
        "minimum_cases": thresholds["min_cases_before_client_pilot"],
        "drift_warning": eval_result["drift"]["warning"],
        "client_data_ready": False,
        "engineering_ready": client_data_ready,
        "nist_ai_rmf": {
            "govern": "provider owner, thresholds and residual risks are explicit",
            "map": "eval categories map OCR/RAG, standards, audit, runtime and quality sources",
            "measure": "pass rate, MRR, per-category pass rate and drift are recorded",
            "manage": "client-data readiness remains blocked until PII, approval and production provider governance are closed",
        },
        "residual_risks": [
            "client_data_ready=false until PII classifier and human approval are implemented",
            "external managed embedding provider is not configured",
            "eval set is expanded for engineering readiness but still small for production",
        ],
        "last_eval": eval_result,
    }
