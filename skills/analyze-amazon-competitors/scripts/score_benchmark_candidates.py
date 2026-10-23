#!/usr/bin/env python3
"""Score and classify Amazon benchmark competitor candidates.

The script performs deterministic comparison only. It does not fetch Amazon or
SellerSprite data and does not decide whether the supplied evidence is true.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from datetime import date, datetime
from typing import Any


def operating_context_sha256(value: dict[str, Any]) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


WEIGHTS = {
    "intent_match": 0.20,
    "form_spec_match": 0.16,
    "price_pack_match": 0.14,
    "ratings_count_match": 0.14,
    "star_rating_strength": 0.08,
    "audience_scenario_match": 0.09,
    "stage_attainability": 0.07,
    "market_relevance": 0.07,
    "evidence_quality": 0.05,
}
ROLES = {
    "LEADER",
    "LAUNCH_PEER",
    "DIRECT_PRICE_FORM",
    "NEW_ENTRANT",
    "DIFFERENTIATED_CHALLENGER",
    "ADJACENT_ALTERNATIVE",
}
SOURCE_ROLES = {"USER_SUPPLIED", "UPSTREAM_SELECTED", "RESEARCH_ADDED"}
LOCK_STATUSES = {
    "CORE_BENCHMARK",
    "BOUNDARY_REFERENCE",
    "DIFFERENTIATION_REFERENCE",
    "KEYWORD_SOURCE_ONLY",
    "CONTEXT_ONLY",
    "IDENTITY_PENDING",
    "EXCLUDED_INVALID",
}
ASIN_PATTERN = re.compile(r"^[A-Z0-9]{10}$")
PEER_BAND_BASES = {"USER_DEFINED", "UPSTREAM_STAGE", "MARKET_DISTRIBUTION"}
PRICE_METRICS = {"effective_price", "unit_price"}
RATING_SCOPES = {"PARENT", "CHILD", "VARIATION_SHARED", "UNKNOWN"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path, help="JSON file path")
    source.add_argument("--json", help="inline JSON object")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    return parser.parse_args()


def load_payload(args: argparse.Namespace) -> dict[str, Any]:
    raw = args.input.read_text(encoding="utf-8") if args.input else args.json
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("input must be a JSON object")
    return payload


def score_value(item: dict[str, Any], field: str) -> float:
    if field not in item:
        raise ValueError(f"{item.get('asin', '<unknown>')}: missing '{field}'")
    value = item[field]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{item.get('asin', '<unknown>')}: '{field}' must be numeric")
    value = float(value)
    if not math.isfinite(value) or not 0 <= value <= 5:
        raise ValueError(f"{item.get('asin', '<unknown>')}: '{field}' must be between 0 and 5")
    return value


def bool_value(item: dict[str, Any], field: str) -> bool:
    if field not in item or not isinstance(item[field], bool):
        raise ValueError(f"{item.get('asin', '<unknown>')}: '{field}' must be true or false")
    return item[field]


def evidence_block(item: dict[str, Any], field: str, asin: str) -> dict[str, Any]:
    block = item.get(field)
    if not isinstance(block, dict):
        raise ValueError(f"{asin}: '{field}' must be an evidence object")
    basis = block.get("basis")
    if not isinstance(basis, str) or not basis.strip():
        raise ValueError(f"{asin}: '{field}.basis' must be a non-empty string")
    evidence_ids = block.get("evidence_ids")
    if (
        not isinstance(evidence_ids, list)
        or not evidence_ids
        or any(not isinstance(value, str) or not value.strip() for value in evidence_ids)
    ):
        raise ValueError(f"{asin}: '{field}.evidence_ids' must be a non-empty string array")
    return {
        **block,
        "basis": basis.strip(),
        "evidence_ids": [value.strip() for value in evidence_ids],
    }


def optional_number(value: Any, field: str, *, minimum: float, maximum: float | None = None) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be numeric or null")
    result = float(value)
    if not math.isfinite(result) or result < minimum or (maximum is not None and result > maximum):
        upper = f" and {maximum}" if maximum is not None else ""
        raise ValueError(f"{field} must be between {minimum}{upper}")
    return result


def peer_bands(payload: dict[str, Any]) -> dict[str, Any] | None:
    supplied = payload.get("peer_bands")
    if supplied is None:
        return None
    if not isinstance(supplied, dict):
        raise ValueError("peer_bands must be an object or null")
    basis = supplied.get("basis")
    if basis not in PEER_BAND_BASES:
        raise ValueError("peer_bands.basis must be USER_DEFINED, UPSTREAM_STAGE, or MARKET_DISTRIBUTION")
    derivation = supplied.get("derivation")
    if not isinstance(derivation, str) or not derivation.strip():
        raise ValueError("peer_bands.derivation must be a non-empty string")
    evidence_ids = supplied.get("evidence_ids")
    if (
        not isinstance(evidence_ids, list)
        or not evidence_ids
        or any(not isinstance(value, str) or not value.strip() for value in evidence_ids)
    ):
        raise ValueError("peer_bands.evidence_ids must be a non-empty string array")
    price_metric = supplied.get("price_metric")
    if price_metric not in PRICE_METRICS:
        raise ValueError("peer_bands.price_metric must be effective_price or unit_price")
    normalized = {
        **supplied,
        "basis": basis,
        "derivation": derivation.strip(),
        "evidence_ids": [value.strip() for value in evidence_ids],
        "price_metric": price_metric,
        "price_min": optional_number(supplied.get("price_min"), "peer_bands.price_min", minimum=0),
        "price_max": optional_number(supplied.get("price_max"), "peer_bands.price_max", minimum=0),
        "ratings_count_min": optional_number(
            supplied.get("ratings_count_min"),
            "peer_bands.ratings_count_min",
            minimum=0,
        ),
        "ratings_count_max": optional_number(
            supplied.get("ratings_count_max"),
            "peer_bands.ratings_count_max",
            minimum=0,
        ),
        "star_rating_min": optional_number(
            supplied.get("star_rating_min"),
            "peer_bands.star_rating_min",
            minimum=0,
            maximum=5,
        ),
        "star_rating_max": optional_number(
            supplied.get("star_rating_max"),
            "peer_bands.star_rating_max",
            minimum=0,
            maximum=5,
        ),
    }
    for prefix in ("price", "ratings_count", "star_rating"):
        lower = normalized[f"{prefix}_min"]
        upper = normalized[f"{prefix}_max"]
        if lower is not None and upper is not None and lower > upper:
            raise ValueError(f"peer_bands.{prefix}_min must be <= {prefix}_max")
    for field in ("ratings_count_min", "ratings_count_max"):
        value = normalized[field]
        if value is not None and not value.is_integer():
            raise ValueError(f"peer_bands.{field} must be a whole number")
    if normalized["price_min"] is None and normalized["price_max"] is None:
        raise ValueError("peer_bands requires at least one price boundary")
    if normalized["ratings_count_min"] is None and normalized["ratings_count_max"] is None:
        raise ValueError("peer_bands requires at least one ratings_count boundary")
    currency = supplied.get("currency")
    if currency is not None and (not isinstance(currency, str) or re.fullmatch(r"[A-Z]{3}", currency.strip().upper()) is None):
        raise ValueError("peer_bands.currency must be a three-letter currency code or null")
    normalized["currency"] = currency.strip().upper() if isinstance(currency, str) else None
    return normalized


def compare_to_peer_bands(item: dict[str, Any], bands: dict[str, Any] | None) -> dict[str, Any]:
    if bands is None:
        return {
            "active": False,
            "status": "NOT_APPLIED",
            "core_eligible": True,
            "trust_barrier": False,
            "checks": {},
            "reasons": [],
        }
    snapshot = item.get("snapshot")
    if not isinstance(snapshot, dict):
        snapshot = {}
    checks: dict[str, Any] = {}
    reasons: list[str] = []
    missing = False
    outside = False
    trust_barrier = False

    def compare(field: str, value: float | None, lower: float | None, upper: float | None) -> None:
        nonlocal missing, outside
        if value is None:
            checks[field] = "MISSING"
            reasons.append(f"{field} is missing")
            missing = True
            return
        in_band = (lower is None or value >= lower) and (upper is None or value <= upper)
        checks[field] = "IN_BAND" if in_band else "OUTSIDE_BAND"
        if not in_band:
            outside = True
            reasons.append(f"{field}={value:g} is outside the selected peer band")

    price_metric = bands["price_metric"]
    price_value = optional_number(snapshot.get(price_metric), f"{item['asin']}.snapshot.{price_metric}", minimum=0)
    compare("price", price_value, bands["price_min"], bands["price_max"])
    if bands["currency"]:
        currency = snapshot.get("currency")
        if not isinstance(currency, str) or currency.strip().upper() != bands["currency"]:
            checks["currency"] = "MISSING_OR_MISMATCHED"
            reasons.append("snapshot currency is missing or does not match peer_bands.currency")
            missing = True
        else:
            checks["currency"] = "MATCH"
    else:
        checks["currency"] = "UNKNOWN_PEER_CURRENCY"
        reasons.append("peer-band currency is unknown; numeric prices are not comparable")
        missing = True

    ratings_count = optional_number(
        snapshot.get("ratings_count"),
        f"{item['asin']}.snapshot.ratings_count",
        minimum=0,
    )
    if ratings_count is not None and not ratings_count.is_integer():
        raise ValueError(f"{item['asin']}.snapshot.ratings_count must be a whole number")
    rating_scope = snapshot.get("rating_scope", "UNKNOWN")
    if rating_scope not in RATING_SCOPES:
        raise ValueError(f"{item['asin']}.snapshot.rating_scope is invalid")
    if rating_scope == "UNKNOWN":
        checks["rating_scope"] = "UNKNOWN"
        reasons.append("parent/child rating scope is unknown")
        missing = True
    else:
        checks["rating_scope"] = rating_scope
    compare(
        "ratings_count",
        ratings_count,
        bands["ratings_count_min"],
        bands["ratings_count_max"],
    )
    if (
        rating_scope != "UNKNOWN"
        and ratings_count is not None
        and bands["ratings_count_max"] is not None
    ):
        trust_barrier = ratings_count > bands["ratings_count_max"]

    if bands["star_rating_min"] is not None or bands["star_rating_max"] is not None:
        star_rating = optional_number(
            snapshot.get("star_rating"),
            f"{item['asin']}.snapshot.star_rating",
            minimum=0,
            maximum=5,
        )
        compare(
            "star_rating",
            star_rating,
            bands["star_rating_min"],
            bands["star_rating_max"],
        )
        if (
            rating_scope != "UNKNOWN"
            and star_rating is not None
            and bands["star_rating_max"] is not None
        ):
            trust_barrier = trust_barrier or star_rating > bands["star_rating_max"]

    observed_at = snapshot.get("observed_at")
    if not isinstance(observed_at, str) or not observed_at.strip():
        checks["observed_at"] = "MISSING"
        reasons.append("snapshot observed_at is missing")
        missing = True
    else:
        try:
            observed_date = datetime.fromisoformat(observed_at.strip().replace("Z", "+00:00")).date()
            if observed_date > date.today():
                raise ValueError("future observation")
            checks["observed_at"] = observed_at.strip()
        except ValueError:
            checks["observed_at"] = "INVALID_OR_FUTURE"
            reasons.append("snapshot observed_at must be a valid, non-future ISO observation date")
            missing = True

    status = "UNKNOWN" if missing else ("OUTSIDE_BAND" if outside else "IN_BAND")
    return {
        "active": True,
        "basis": bands["basis"],
        "price_metric": price_metric,
        "status": status,
        "core_eligible": status == "IN_BAND",
        "trust_barrier": trust_barrier,
        "checks": checks,
        "reasons": reasons,
        "evidence_ids": bands["evidence_ids"],
    }


def thresholds(payload: dict[str, Any]) -> dict[str, float]:
    result = {"core_min": 75.0, "reference_min": 60.0, "context_min": 45.0}
    supplied = payload.get("thresholds", {})
    if supplied is None:
        supplied = {}
    if not isinstance(supplied, dict):
        raise ValueError("thresholds must be an object")
    for key in result:
        if key in supplied:
            value = supplied[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
                raise ValueError(f"thresholds.{key} must be between 0 and 100")
            result[key] = float(value)
    if not result["core_min"] >= result["reference_min"] >= result["context_min"]:
        raise ValueError("thresholds must satisfy core_min >= reference_min >= context_min")
    return result


def scoring_weights(payload: dict[str, Any]) -> dict[str, float]:
    supplied = payload.get("weights")
    if supplied is None:
        return dict(WEIGHTS)
    if not isinstance(supplied, dict):
        raise ValueError("weights must be an object or null")
    if set(supplied) != set(WEIGHTS):
        missing = sorted(set(WEIGHTS) - set(supplied))
        unknown = sorted(set(supplied) - set(WEIGHTS))
        details = []
        if missing:
            details.append("missing: " + ", ".join(missing))
        if unknown:
            details.append("unknown: " + ", ".join(unknown))
        raise ValueError("weights must contain exactly the canonical dimensions (" + "; ".join(details) + ")")
    result: dict[str, float] = {}
    for field, value in supplied.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"weights.{field} must be numeric")
        normalized = float(value)
        if not math.isfinite(normalized) or normalized < 0:
            raise ValueError(f"weights.{field} must be a finite non-negative number")
        result[field] = normalized
    if not math.isclose(sum(result.values()), 1.0, rel_tol=0, abs_tol=1e-9):
        raise ValueError("weights must sum to 1.0")
    return result


def classify(
    item: dict[str, Any],
    score: float | None,
    limits: dict[str, float],
    peer_band_result: dict[str, Any],
) -> str:
    if not bool_value(item, "identity_valid") or not bool_value(item, "active_listing"):
        return "EXCLUDED_INVALID"
    if not bool_value(item, "variant_resolved"):
        return "IDENTITY_PENDING"

    primary_role = item["primary_role"]
    if score is None or primary_role is None:
        raise ValueError(f"{item['asin']}: comparable candidates require role and score fields")
    intent_match = float(item["intent_match"])
    form_spec_match = float(item["form_spec_match"])
    price_pack_match = float(item["price_pack_match"])
    ratings_count_match = float(item["ratings_count_match"])
    if (
        primary_role in {"LAUNCH_PEER", "DIRECT_PRICE_FORM"}
        and peer_band_result["trust_barrier"]
        and score >= limits["reference_min"]
        and intent_match >= 3
        and form_spec_match >= 3
    ):
        return "BOUNDARY_REFERENCE"
    if (
        primary_role in {"LAUNCH_PEER", "DIRECT_PRICE_FORM"}
        and score >= limits["core_min"]
        and intent_match >= 3
        and form_spec_match >= 3
        and price_pack_match >= 3
        and ratings_count_match >= 3
        and peer_band_result["core_eligible"]
    ):
        return "CORE_BENCHMARK"
    if primary_role == "LEADER" and score >= limits["reference_min"]:
        return "BOUNDARY_REFERENCE"
    if (
        primary_role in {"NEW_ENTRANT", "DIFFERENTIATED_CHALLENGER"}
        and score >= limits["reference_min"]
    ):
        return "DIFFERENTIATION_REFERENCE"
    if primary_role != "ADJACENT_ALTERNATIVE" and score >= limits["context_min"]:
        return "KEYWORD_SOURCE_ONLY"
    return "CONTEXT_ONLY"


def scopes(item: dict[str, Any], lock_status: str) -> tuple[str, str]:
    if lock_status == "CORE_BENCHMARK":
        return "DEEP", "FULL_TRAFFIC"
    if lock_status in {"BOUNDARY_REFERENCE", "DIFFERENTIATION_REFERENCE"}:
        return "STANDARD", "FULL_TRAFFIC"
    if lock_status == "KEYWORD_SOURCE_ONLY":
        return "IDENTITY_AND_TRAFFIC", "FULL_TRAFFIC"
    if lock_status == "CONTEXT_ONLY":
        keyword_scope = "FULL_TRAFFIC" if item["source_role"] == "USER_SUPPLIED" else "CONTEXT_ONLY"
        return "SCAN", keyword_scope
    return "NONE", "NO_QUERY"


def score_candidate(
    item: dict[str, Any],
    index: int,
    limits: dict[str, float],
    bands: dict[str, Any] | None,
    weights: dict[str, float],
) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError(f"candidates[{index}] must be an object")
    asin = str(item.get("asin", "")).strip().upper()
    if ASIN_PATTERN.fullmatch(asin) is None:
        raise ValueError(f"candidates[{index}].asin must be a 10-character ASIN")
    source_role = item.get("source_role", "RESEARCH_ADDED")
    if source_role not in SOURCE_ROLES:
        raise ValueError(f"{asin}: invalid source_role")
    identity_valid = bool_value(item, "identity_valid")
    active_listing = bool_value(item, "active_listing")
    variant_resolved = bool_value(item, "variant_resolved")
    comparable_identity = identity_valid and active_listing and variant_resolved

    primary_role = item.get("primary_role")
    if primary_role is not None and primary_role not in ROLES:
        raise ValueError(f"{asin}: invalid primary_role")
    roles = item.get("roles", [primary_role] if primary_role else [])
    if not isinstance(roles, list) or any(role not in ROLES for role in roles):
        raise ValueError(f"{asin}: roles must be a list of canonical roles")
    if comparable_identity and (primary_role is None or not roles):
        raise ValueError(f"{asin}: comparable candidates require primary_role and roles")
    if primary_role is not None and primary_role not in roles:
        raise ValueError(f"{asin}: primary_role must also appear in roles")
    input_order = item.get("input_order", index)
    if (
        isinstance(input_order, bool)
        or not isinstance(input_order, int)
        or input_order <= 0
    ):
        raise ValueError(f"{asin}: input_order must be a positive whole number")

    normalized = {**item, "asin": asin, "source_role": source_role, "roles": roles}
    normalized["identity_valid"] = identity_valid
    normalized["active_listing"] = active_listing
    normalized["variant_resolved"] = variant_resolved
    snapshot = normalized.get("snapshot", {})
    if not isinstance(snapshot, dict):
        raise ValueError(f"{asin}: 'snapshot' must be an object")
    normalized["snapshot"] = snapshot
    if comparable_identity:
        normalized["role_evidence"] = evidence_block(normalized, "role_evidence", asin)
        dimension_evidence = normalized.get("dimension_evidence")
        if not isinstance(dimension_evidence, dict):
            raise ValueError(f"{asin}: 'dimension_evidence' must be an evidence object")
        normalized["dimension_evidence"] = {
            field: evidence_block(dimension_evidence, field, asin)
            for field in WEIGHTS
        }
    else:
        normalized["identity_evidence"] = evidence_block(normalized, "identity_evidence", asin)
    supplied_evidence_ids = normalized.get("evidence_ids", [])
    if (
        not isinstance(supplied_evidence_ids, list)
        or any(not isinstance(value, str) or not value.strip() for value in supplied_evidence_ids)
    ):
        raise ValueError(f"{asin}: 'evidence_ids' must be a string array")
    evidence_ids = [value.strip() for value in supplied_evidence_ids]
    if comparable_identity:
        evidence_ids.extend(normalized["role_evidence"]["evidence_ids"])
        for field in WEIGHTS:
            evidence_ids.extend(normalized["dimension_evidence"][field]["evidence_ids"])
    else:
        evidence_ids.extend(normalized["identity_evidence"]["evidence_ids"])
    normalized["evidence_ids"] = list(dict.fromkeys(evidence_ids))
    supplied_score_fields = [field for field in WEIGHTS if field in normalized]
    if comparable_identity and len(supplied_score_fields) != len(WEIGHTS):
        missing = [field for field in WEIGHTS if field not in normalized]
        raise ValueError(f"{asin}: missing score fields: {', '.join(missing)}")
    if comparable_identity:
        weighted = 0.0
        for field, weight in weights.items():
            normalized[field] = score_value(normalized, field)
            weighted += normalized[field] * weight
        score: float | None = round(weighted * 20, 1)
    else:
        score = None
    peer_band_result = compare_to_peer_bands(normalized, bands)
    normalized["evidence_ids"] = list(dict.fromkeys([
        *normalized["evidence_ids"],
        *peer_band_result.get("evidence_ids", []),
    ]))
    lock_status = classify(normalized, score, limits, peer_band_result)
    if lock_status not in LOCK_STATUSES:
        raise AssertionError("unexpected lock status")
    research_depth, keyword_scope = scopes(normalized, lock_status)
    if lock_status == "EXCLUDED_INVALID":
        reason = "ASIN identity is invalid or listing is inactive"
    elif lock_status == "IDENTITY_PENDING":
        reason = "parent-child or selected variant identity is unresolved"
    elif lock_status == "CORE_BENCHMARK":
        reason = "directly comparable across product, price and rating-count stage"
    elif lock_status == "BOUNDARY_REFERENCE":
        if peer_band_result["trust_barrier"]:
            reason = "directly relevant but rating strength exceeds the selected attainable peer band"
        else:
            reason = "leader retained as a market boundary reference"
    elif lock_status == "DIFFERENTIATION_REFERENCE":
        reason = "new or differentiated challenger retained for contrast"
    elif lock_status == "KEYWORD_SOURCE_ONLY":
        reason = "useful market or traffic source but not a core product benchmark"
    else:
        reason = "adjacent or weakly comparable; retain as context only"

    lock_reasons = [reason, *peer_band_result["reasons"]]
    exclusion_or_pending_reason = (
        reason if lock_status in {"EXCLUDED_INVALID", "IDENTITY_PENDING"} else None
    )
    return {
        **normalized,
        "input_instances": normalized.get("input_instances", []),
        "input_order": input_order,
        "score": score,
        "lock_status": lock_status,
        "research_depth": research_depth,
        "keyword_acquisition_scope": keyword_scope,
        "peer_band_result": peer_band_result,
        "lock_reason": reason,
        "lock_reasons": lock_reasons,
        "exclusion_or_pending_reason": exclusion_or_pending_reason,
        "snapshot": snapshot,
        "evidence_ids": normalized.get("evidence_ids", []),
    }


def evaluate(payload: dict[str, Any]) -> dict[str, Any]:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("candidates must be a non-empty list")
    limits = thresholds(payload)
    bands = peer_bands(payload)
    weights = scoring_weights(payload)
    operating_context = payload.get("operating_context", {})
    if not isinstance(operating_context, dict):
        raise ValueError("operating_context must be an object")
    if operating_context:
        context_id = operating_context.get("context_id")
        if not isinstance(context_id, str) or not context_id.strip():
            raise ValueError(
                "operating_context.context_id is required for a supplied operating context"
            )
    computed_context_hash = (
        operating_context_sha256(operating_context) if operating_context else None
    )
    supplied_context_hash = payload.get("operating_context_sha256")
    if supplied_context_hash is not None and supplied_context_hash != computed_context_hash:
        raise ValueError(
            "operating_context_sha256 does not match canonical operating_context content"
        )
    competitor_context_updates = payload.get("competitor_context_updates", [])
    if not isinstance(competitor_context_updates, list):
        raise ValueError("competitor_context_updates must be a list")
    results = [
        score_candidate(item, index, limits, bands, weights)
        for index, item in enumerate(candidates, 1)
    ]
    asins = [item["asin"] for item in results]
    if len(asins) != len(set(asins)):
        raise ValueError("candidate ASINs must be unique after normalization")
    results.sort(key=lambda item: (item["input_order"], item["asin"]))
    lock_run_id = payload.get("competitor_lock_run_id")
    if lock_run_id is not None and (
        not isinstance(lock_run_id, str) or not lock_run_id.strip()
    ):
        raise ValueError("competitor_lock_run_id must be a non-empty string when provided")
    if isinstance(lock_run_id, str):
        lock_run_id = lock_run_id.strip()
        for item in results:
            item.setdefault("lock_run_id", lock_run_id)
    recommended_core_order = [
        item["asin"]
        for item in sorted(
            results,
            key=lambda item: (
                -(item["score"] if item["score"] is not None else -1),
                item["input_order"],
            ),
        )
        if item["lock_status"] == "CORE_BENCHMARK"
    ]
    counts = {status: 0 for status in sorted(LOCK_STATUSES)}
    for item in results:
        counts[item["lock_status"]] += 1
    return {
        "schema_version": "1.1",
        "project_id": payload.get("project_id"),
        "selection_run_id": payload.get("selection_run_id"),
        "candidate_id": payload.get("candidate_id"),
        "competitor_lock_run_id": lock_run_id,
        "marketplace": payload.get("marketplace"),
        "captured_at": payload.get("captured_at"),
        "data_month": payload.get("data_month"),
        "target_context": payload.get("target_context", {}),
        "operating_context": operating_context,
        "operating_context_sha256": computed_context_hash,
        "competitor_context_updates": competitor_context_updates,
        "thresholds": limits,
        "weights": weights,
        "peer_bands": bands,
        "competitors": results,
        "recommended_core_order": recommended_core_order,
        "status_counts": counts,
        "coverage": payload.get("coverage", {}),
        "unknowns": payload.get("unknowns", []),
        "refresh_triggers": payload.get("refresh_triggers", []),
    }


def render_markdown(result: dict[str, Any]) -> str:
    lines = [
        "| 输入序 | ASIN | 主角色 | 到手/单件价 | 星级 | 评分数 | 同阶段带 | 分数 | 锁定状态 | 研究深度 | 关键词范围 | 理由 |",
        "|---:|---|---|---:|---:|---:|---|---:|---|---|---|---|",
    ]
    for item in result["competitors"]:
        reason = item["lock_reason"].replace("|", "\\|")
        primary_role = item.get("primary_role") or "-"
        score_text = f"{item['score']:.1f}" if item["score"] is not None else "-"
        snapshot = item.get("snapshot", {})
        price_metric = item["peer_band_result"].get("price_metric", "effective_price")
        price = snapshot.get(price_metric)
        price_text = f"{price:g}" if isinstance(price, (int, float)) and not isinstance(price, bool) else "-"
        star_rating = snapshot.get("star_rating")
        star_text = (
            f"{star_rating:g}"
            if isinstance(star_rating, (int, float)) and not isinstance(star_rating, bool)
            else "-"
        )
        ratings_count = snapshot.get("ratings_count")
        ratings_text = (
            f"{int(ratings_count)}"
            if isinstance(ratings_count, (int, float))
            and not isinstance(ratings_count, bool)
            and float(ratings_count).is_integer()
            else "-"
        )
        peer_status = item["peer_band_result"]["status"]
        lines.append(
            f"| {item['input_order']} | {item['asin']} | {primary_role} | {price_text} | "
            f"{star_text} | {ratings_text} | {peer_status} | {score_text} | "
            f"{item['lock_status']} | {item['research_depth']} | "
            f"{item['keyword_acquisition_scope']} | {reason} |"
        )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        result = evaluate(load_payload(args))
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    if args.format == "markdown":
        print(render_markdown(result))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
