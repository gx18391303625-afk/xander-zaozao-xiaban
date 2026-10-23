#!/usr/bin/env python3
"""Validate a Stage 3 Amazon Listing intake or release package.

This validator checks lineage, upstream role continuity, field eligibility,
claim-to-fact mappings, release permissions, and release-state consistency. It
does not verify whether the source documents are genuine, whether the copy is
legally compliant, or whether Amazon will accept or index the submitted value.

Usage:
    python3 validate_listing_package.py listing_handoff.json
    python3 validate_listing_package.py listing_release.json
    python3 validate_listing_package.py - --format text
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
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


STABLE_IDS = (
    "project_id",
    "selection_run_id",
    "candidate_id",
    "competitor_lock_run_id",
    "keyword_run_id",
)
# 选品阶段已冻结（另做独立插件）：它产出的 ID 不再要求，有就保留并核对一致。
SELECTION_STAGE_IDS = ("project_id", "selection_run_id", "candidate_id")
LISTING_IDS = ("listing_run_id", "listing_version_id")
VISIBLE_LOCATIONS = {
    "title",
    "item_highlight",
    "product_description",
    "bullet_1",
    "bullet_2",
    "bullet_3",
    "bullet_4",
    "bullet_5",
}
ALL_LOCATIONS = VISIBLE_LOCATIONS | {"search_terms"}
VISIBLE_ALLOWED_ROLES = {"CORE_VERIFIED", "SECONDARY_VERIFIED"}
BACKEND_ALLOWED_ROLES = {
    "CORE_VERIFIED",
    "SECONDARY_VERIFIED",
    "INDEXING_CANDIDATE",
}
BLOCKED_ROLES = {
    "RELEVANT_NEEDS_VALIDATION",
    "MARKET_CONTEXT",
    "HOLD_CLAIM",
    "BRAND_IP_ISOLATED",
    "WRONG_INTENT",
    "UNSUPPORTED",
}
RELEASED_PUBLICATION_STATUSES = {
    "COPY_RELEASED",
    "FORMAL_CLAIM_RELEASED",
}
WITHHELD_PUBLICATION_STATUSES = {
    "HOLD_FEATURE",
    "HOLD_CLAIM",
    "WITHHELD",
    "CONTRADICTED",
    "PENDING",
    "UNKNOWN",
    "",
}
SENSITIVE_WORDING_RE = re.compile(
    r"(?:\bcur(?:e|es|ed|ing)\b|\btreat(?:s|ed|ing)?\b|"
    r"\breliev(?:e|es|ed|ing)\b.{0,24}\bpain\b|"
    r"\bcertified\s+safe\b|\b100\s*%\s*safe\b|"
    r"\bwaterproof\s+forever\b|\bworks?\s+with\s+every\b|"
    r"\b(?:best|fastest|longest|number\s*one|no\.?\s*1)\b|"
    r"\bguarante(?:e|ed|es)\b|\bclinical(?:ly)?\b|"
    r"\bprevent(?:s|ed|ing)?\b.{0,32}\b(?:burns?|injur(?:y|ies)|disease)\b)",
    re.IGNORECASE,
)
PRICE_PLAN_STATUSES = {"PLANNED_UNVERIFIED"}
PRICE_PLAN_SOURCE_TYPES = {"USER_CONFIRMED", "SELLER_PLAN", "UNKNOWN"}
PRICE_TRIGGER_TYPES = {
    "DATE", "ELAPSED_SELLABLE_DAYS", "PERFORMANCE_GATE",
    "MANUAL_CONFIRMATION", "OTHER",
}
SEASONALITY_CLASSIFICATIONS = {
    "SEASONAL", "EVERGREEN_WITH_PEAKS", "EVERGREEN", "UNKNOWN",
}
SEASONAL_PHASES = {
    "PRESEASON", "RAMP", "PEAK", "TAIL", "OFFSEASON", "UNKNOWN",
}
SEASONAL_CONFIDENCE = {"HIGH", "MEDIUM", "LOW", "UNKNOWN"}
SEASONAL_GRANULARITIES = {"DAY", "WEEK", "MONTH", "QUARTER", "UNKNOWN"}
CHANGE_STATES = {"OPEN", "LOCKED", "PARTIAL", "UNKNOWN"}
CHANGE_SCOPES = {
    "TITLE", "ITEM_HIGHLIGHT", "BULLETS", "PRODUCT_DESCRIPTION",
    "SEARCH_TERMS", "IMAGES", "A_PLUS",
}
COPY_SCOPE_FIELDS = {
    "TITLE": "title",
    "ITEM_HIGHLIGHT": "item_highlight",
    "BULLETS": "bullets",
    "PRODUCT_DESCRIPTION": "product_description",
    "SEARCH_TERMS": "search_terms",
}
RISK_ACK_DECISIONS = {
    "ACKNOWLEDGED_FOR_OPERATION", "NOT_ACCEPTED", "REVIEW_REQUIRED",
}
RISK_OVERRIDE_KEYS = {
    "publication_status_override", "research_status_override",
    "claim_release", "library_role_override", "release_status_override",
}
CURRENCY_BY_MARKETPLACE = {
    "US": "USD", "JP": "JPY", "UK": "GBP", "DE": "EUR",
    "FR": "EUR", "IT": "EUR", "ES": "EUR", "CA": "CAD",
    "IN": "INR", "MX": "MXN", "BR": "BRL", "AU": "AUD",
    "AE": "AED",
}
PROMOTION_ACTION_KEYS = {
    "campaign", "campaigns", "campaign_structure", "ad_group", "ad_groups",
    "match_type", "match_types", "bid", "bids", "budget", "daily_budget",
    "acos", "tacos", "negative_keyword", "negative_keywords",
    "placement_adjustment", "placement_adjustments", "targeting_expression",
    "target", "targets", "keyword_targets", "product_targets", "routing",
    "stop_loss", "spend_cap", "scale_rule", "phase_plan",
}
PROMOTION_PRICE_KEYS = {
    "effective_price", "selling_price", "current_price", "planned_price",
    "intended_price", "price_context",
}
PROMOTION_DUPLICATED_CONTEXT_KEYS = {
    "profit_objective", "demand_calendar", "seasonality_context",
    "supply_routes", "replenishment_policy", "content_change_control",
    "acknowledged_risks",
}


@dataclass
class Finding:
    severity: str
    code: str
    location: str
    message: str


def is_nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def normalized(value: str) -> str:
    return " ".join(value.casefold().split())


CLAIM_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)


def claim_tokens(value: str) -> list[str]:
    return [match.group().casefold() for match in CLAIM_TOKEN_RE.finditer(value)]


def covered_claim_tokens(field_text: str, mapped_texts: list[str]) -> tuple[list[str], list[str]]:
    """Return unmapped words and mappings absent as a contiguous token sequence."""
    tokens = claim_tokens(field_text)
    covered = [False] * len(tokens)
    absent: list[str] = []
    for mapped_text in mapped_texts:
        mapped = claim_tokens(mapped_text)
        starts = [index for index in range(len(tokens) - len(mapped) + 1)
                  if mapped and tokens[index:index + len(mapped)] == mapped]
        if not starts:
            absent.append(mapped_text)
        for start in starts:
            covered[start:start + len(mapped)] = [True] * len(mapped)
    return [token for token, is_covered in zip(tokens, covered) if not is_covered], absent


def parse_iso_datetime(value: Any) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed


def nonempty_string_list(value: Any) -> list[str] | None:
    if not isinstance(value, list) or any(
        not is_nonempty_string(item) for item in value
    ):
        return None
    return [item.strip() for item in value]


def recursive_keys(value: Any, prefix: str = "") -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            found.append((str(key).casefold(), path))
            found.extend(recursive_keys(child, path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(recursive_keys(child, f"{prefix}[{index}]"))
    return found


def get_bool(row: dict[str, Any], key: str) -> bool:
    value = row.get(key)
    if value is None and isinstance(row.get("eligibility"), dict):
        value = row["eligibility"].get(key)
    return value is True


def keyword_role(row: dict[str, Any]) -> Any:
    return row.get("library_role", row.get("role", row.get("_group_role")))


def flatten_keyword_library(value: Any, add) -> list[dict[str, Any]]:
    """Accept the canonical grouped Stage 2 library or a normalized row array."""
    if isinstance(value, list):
        return value
    if not isinstance(value, dict):
        add("ERROR", "KEYWORDS_INVALID", "keyword_library", "keyword_library must be an object of role groups or an array")
        return []
    group_roles = {
        "core_verified": "CORE_VERIFIED",
        "secondary_verified": "SECONDARY_VERIFIED",
        "relevant_needs_validation": "RELEVANT_NEEDS_VALIDATION",
        "later_stage_relevant": "LATER_STAGE_RELEVANT",
        "indexing_candidates": "INDEXING_CANDIDATE",
        "market_context": "MARKET_CONTEXT",
    }
    rows: list[dict[str, Any]] = []
    for group, group_value in value.items():
        if group == "isolated_or_blocked":
            default_role = None
        else:
            default_role = group_roles.get(group)
        if group in {"coverage", "summary"}:
            continue
        if not isinstance(group_value, list):
            add("ERROR", "KEYWORD_GROUP_INVALID", f"keyword_library.{group}", "keyword group must be an array")
            continue
        for item in group_value:
            if isinstance(item, dict):
                copied = dict(item)
                if default_role and not copied.get("library_role") and not copied.get("role"):
                    copied["_group_role"] = default_role
                rows.append(copied)
            else:
                rows.append(item)
    return rows


def field_values(listing_copy: dict[str, Any]) -> dict[str, str]:
    values = {
        "title": listing_copy.get("title", ""),
        "item_highlight": listing_copy.get("item_highlight", ""),
        "product_description": listing_copy.get("product_description", ""),
        "search_terms": listing_copy.get("search_terms", ""),
    }
    bullets = listing_copy.get("bullets", [])
    if isinstance(bullets, list):
        for index, bullet in enumerate(bullets, start=1):
            values[f"bullet_{index}"] = bullet
    return {key: value for key, value in values.items() if isinstance(value, str)}


def read_input(path: str) -> dict[str, Any]:
    if path == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(path).read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("top-level JSON value must be an object")
    return data


def validate_operating_context(
    value: Any,
    marketplace: Any,
    add,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "context": {},
        "context_id": None,
        "current_stage_id": None,
        "current_stage_evidence_ids": set(),
        "risk_ids": set(),
        "content_change_control": None,
    }
    if value is None:
        return result
    if not isinstance(value, dict):
        add("ERROR", "OPERATING_CONTEXT_INVALID", "operating_context", "operating_context must be an object")
        return result
    result["context"] = value

    context_id = value.get("context_id")
    if not is_nonempty_string(context_id):
        add("ERROR", "OPERATING_CONTEXT_ID_MISSING", "operating_context.context_id", "A supplied operating_context requires a stable context_id")
    else:
        result["context_id"] = context_id.strip()

    profit = value.get("profit_objective", {})
    if profit is None:
        profit = {}
    if not isinstance(profit, dict):
        add("ERROR", "PROFIT_OBJECTIVE_INVALID", "operating_context.profit_objective", "profit_objective must be an object or null")
        profit = {}
    contribution_rate = profit.get("minimum_post_ads_contribution_rate")
    if contribution_rate is not None and (
        not is_number(contribution_rate) or contribution_rate < 0 or contribution_rate > 1
    ):
        add("ERROR", "PROFIT_FLOOR_RATE_INVALID", "operating_context.profit_objective.minimum_post_ads_contribution_rate", "minimum_post_ads_contribution_rate must be between 0 and 1")
    for field in ("target_profit_per_order", "risk_buffer_per_order"):
        amount = profit.get(field)
        if amount is not None and (not is_number(amount) or amount < 0):
            add("ERROR", "PROFIT_FLOOR_AMOUNT_INVALID", f"operating_context.profit_objective.{field}", f"{field} must be non-negative")
    contribution_basis = profit.get("contribution_rate_basis")
    legacy_basis = profit.get("rate_basis")
    if legacy_basis is not None:
        if contribution_basis is not None and contribution_basis != legacy_basis:
            add("ERROR", "CONTRIBUTION_RATE_BASIS_CONFLICT", "operating_context.profit_objective", "contribution_rate_basis conflicts with legacy rate_basis")
        else:
            contribution_basis = legacy_basis
            add("WARNING", "LEGACY_CONTRIBUTION_RATE_BASIS", "operating_context.profit_objective.rate_basis", "Legacy rate_basis was accepted; new outputs must use contribution_rate_basis")
    if contribution_basis is not None and contribution_basis != "NET_SALES_REVENUE":
        add("ERROR", "CONTRIBUTION_RATE_BASIS_INVALID", "operating_context.profit_objective.contribution_rate_basis", "contribution_rate_basis must be NET_SALES_REVENUE")
    if contribution_rate is not None and contribution_basis != "NET_SALES_REVENUE":
        add("ERROR", "CONTRIBUTION_RATE_BASIS_MISSING", "operating_context.profit_objective.contribution_rate_basis", "A rate-based floor requires contribution_rate_basis=NET_SALES_REVENUE")

    expected_currency = CURRENCY_BY_MARKETPLACE.get(str(marketplace).upper())
    price_context = value.get("price_context", {})
    if price_context is None:
        price_context = {}
    if not isinstance(price_context, dict):
        add("ERROR", "PRICE_CONTEXT_INVALID", "operating_context.price_context", "price_context must be an object")
        price_context = {}
    current = price_context.get("current_observed")
    if current is not None:
        location = "operating_context.price_context.current_observed"
        if not isinstance(current, dict):
            add("ERROR", "CURRENT_PRICE_INVALID", location, "current_observed must be an object")
        else:
            amount = current.get("amount")
            if not is_number(amount) or amount < 0:
                add("ERROR", "CURRENT_PRICE_AMOUNT_INVALID", f"{location}.amount", "amount must be a nonnegative number")
            currency = current.get("currency")
            if not is_nonempty_string(currency) or len(currency.strip()) != 3:
                add("ERROR", "CURRENT_PRICE_CURRENCY_INVALID", f"{location}.currency", "currency must be a three-letter code")
            elif expected_currency and currency.strip().upper() != expected_currency:
                add("ERROR", "CURRENT_PRICE_CURRENCY_MISMATCH", f"{location}.currency", "currency does not match the marketplace")
            if parse_iso_datetime(current.get("observed_at")) is None:
                add("ERROR", "CURRENT_PRICE_TIME_INVALID", f"{location}.observed_at", "observed_at must be a timezone-aware ISO-8601 timestamp")
            evidence_ids = nonempty_string_list(current.get("evidence_ids"))
            if not evidence_ids:
                add("ERROR", "CURRENT_PRICE_EVIDENCE_MISSING", f"{location}.evidence_ids", "current observed price requires evidence_ids")
            if current.get("verification_status") != "OBSERVED":
                add("ERROR", "CURRENT_PRICE_STATUS_INVALID", f"{location}.verification_status", "current_observed must use OBSERVED")

    planned_phases = price_context.get("planned_phases", [])
    if planned_phases is None:
        planned_phases = []
    if not isinstance(planned_phases, list):
        add("ERROR", "PLANNED_PRICE_PHASES_INVALID", "operating_context.price_context.planned_phases", "planned_phases must be an array")
        planned_phases = []
    seen_phase_ids: set[str] = set()
    for index, phase in enumerate(planned_phases):
        location = f"operating_context.price_context.planned_phases[{index}]"
        if not isinstance(phase, dict):
            add("ERROR", "PLANNED_PRICE_PHASE_INVALID", location, "planned price phase must be an object")
            continue
        phase_id = phase.get("phase_id")
        if not is_nonempty_string(phase_id):
            add("ERROR", "PLANNED_PRICE_PHASE_ID_MISSING", f"{location}.phase_id", "phase_id is required")
        elif phase_id.strip() in seen_phase_ids:
            add("ERROR", "PLANNED_PRICE_PHASE_ID_DUPLICATE", f"{location}.phase_id", "phase_id must be unique")
        else:
            seen_phase_ids.add(phase_id.strip())
        if phase.get("verification_status") not in PRICE_PLAN_STATUSES:
            add("ERROR", "PLANNED_PRICE_STATUS_INVALID", f"{location}.verification_status", "planned price must remain PLANNED_UNVERIFIED")
        intended = phase.get("intended_price")
        if not isinstance(intended, dict):
            add("ERROR", "PLANNED_PRICE_INVALID", f"{location}.intended_price", "intended_price must be an object")
        else:
            amount = intended.get("amount")
            if not is_number(amount) or amount < 0:
                add("ERROR", "PLANNED_PRICE_AMOUNT_INVALID", f"{location}.intended_price.amount", "amount must be a nonnegative number")
            currency = intended.get("currency")
            if not is_nonempty_string(currency) or len(currency.strip()) != 3:
                add("ERROR", "PLANNED_PRICE_CURRENCY_INVALID", f"{location}.intended_price.currency", "currency must be a three-letter code")
            elif expected_currency and currency.strip().upper() != expected_currency:
                add("ERROR", "PLANNED_PRICE_CURRENCY_MISMATCH", f"{location}.intended_price.currency", "currency does not match the marketplace")
        trigger = phase.get("trigger")
        if not isinstance(trigger, dict):
            add("ERROR", "PLANNED_PRICE_TRIGGER_INVALID", f"{location}.trigger", "planned price requires a structured trigger")
        else:
            if trigger.get("type") not in PRICE_TRIGGER_TYPES:
                add("ERROR", "PLANNED_PRICE_TRIGGER_TYPE_INVALID", f"{location}.trigger.type", "invalid planned-price trigger type")
            if trigger.get("value") in (None, ""):
                add("ERROR", "PLANNED_PRICE_TRIGGER_VALUE_MISSING", f"{location}.trigger.value", "planned-price trigger requires a type-specific value")
        if phase.get("source_type") not in PRICE_PLAN_SOURCE_TYPES:
            add("ERROR", "PLANNED_PRICE_SOURCE_INVALID", f"{location}.source_type", "invalid planned-price source_type")
        if not nonempty_string_list(phase.get("evidence_ids")):
            add("ERROR", "PLANNED_PRICE_EVIDENCE_MISSING", f"{location}.evidence_ids", "planned price requires decision or source IDs")

    current_stage = value.get("current_stage")
    if current_stage is not None:
        location = "operating_context.current_stage"
        if not isinstance(current_stage, dict):
            add("ERROR", "CURRENT_STAGE_INVALID", location, "current_stage must be an object")
        else:
            stage_id = current_stage.get("stage_id")
            if not is_nonempty_string(stage_id):
                add("ERROR", "CURRENT_STAGE_ID_MISSING", f"{location}.stage_id", "stage_id is required")
            else:
                result["current_stage_id"] = stage_id.strip()
            if parse_iso_datetime(current_stage.get("observed_at")) is None:
                add("ERROR", "CURRENT_STAGE_TIME_INVALID", f"{location}.observed_at", "observed_at must be a timezone-aware ISO-8601 timestamp")
            stage_evidence = nonempty_string_list(current_stage.get("evidence_ids"))
            if not stage_evidence:
                add("ERROR", "CURRENT_STAGE_EVIDENCE_MISSING", f"{location}.evidence_ids", "current_stage requires current-state evidence_ids")
            else:
                result["current_stage_evidence_ids"] = set(stage_evidence)
            if "planned_phase_id" in current_stage:
                add("ERROR", "PLANNED_PRICE_AS_CURRENT_STAGE", f"{location}.planned_phase_id", "a planned price phase cannot prove current-stage eligibility")

    seasonality = value.get("seasonality_context")
    if seasonality is not None:
        location = "operating_context.seasonality_context"
        if not isinstance(seasonality, dict):
            add("ERROR", "SEASONALITY_CONTEXT_INVALID", location, "seasonality_context must be an object")
        else:
            classification = seasonality.get("classification", "UNKNOWN")
            phase = seasonality.get("current_phase", "UNKNOWN")
            confidence = seasonality.get("confidence", "UNKNOWN")
            granularity = seasonality.get("source_granularity", "UNKNOWN")
            if classification not in SEASONALITY_CLASSIFICATIONS:
                add("ERROR", "SEASONALITY_CLASS_INVALID", f"{location}.classification", "invalid seasonality classification")
            if phase not in SEASONAL_PHASES:
                add("ERROR", "SEASONALITY_PHASE_INVALID", f"{location}.current_phase", "invalid seasonal phase")
            if confidence not in SEASONAL_CONFIDENCE:
                add("ERROR", "SEASONALITY_CONFIDENCE_INVALID", f"{location}.confidence", "invalid seasonality confidence")
            if granularity not in SEASONAL_GRANULARITIES:
                add("ERROR", "SEASONALITY_GRANULARITY_INVALID", f"{location}.source_granularity", "invalid seasonality source granularity")
            if classification != "UNKNOWN" or phase != "UNKNOWN":
                if not nonempty_string_list(seasonality.get("evidence_ids")):
                    add("ERROR", "SEASONALITY_EVIDENCE_MISSING", f"{location}.evidence_ids", "non-UNKNOWN seasonality requires evidence_ids")
                if not is_nonempty_string(seasonality.get("source_period")):
                    add("ERROR", "SEASONALITY_PERIOD_MISSING", f"{location}.source_period", "non-UNKNOWN seasonality requires source_period")
                if granularity == "UNKNOWN":
                    add("ERROR", "SEASONALITY_GRANULARITY_MISSING", f"{location}.source_granularity", "non-UNKNOWN seasonality requires a known source granularity")

    control = value.get("content_change_control")
    if control is not None:
        location = "operating_context.content_change_control"
        if not isinstance(control, dict):
            add("ERROR", "UPSTREAM_CHANGE_CONTROL_INVALID", location, "content_change_control must be an object")
        else:
            result["content_change_control"] = control
            if not is_nonempty_string(control.get("decision_id")):
                add("ERROR", "UPSTREAM_CHANGE_DECISION_ID_MISSING", f"{location}.decision_id", "decision_id is required")
            if parse_iso_datetime(control.get("decided_at")) is None:
                add("ERROR", "UPSTREAM_CHANGE_TIME_INVALID", f"{location}.decided_at", "decided_at must be timezone-aware")
            for field in ("copy_state", "asset_state"):
                if control.get(field, "UNKNOWN") not in CHANGE_STATES:
                    add("ERROR", "UPSTREAM_CHANGE_STATE_INVALID", f"{location}.{field}", f"{field} is invalid")
            scopes = nonempty_string_list(control.get("locked_scopes", []))
            if scopes is None:
                add("ERROR", "UPSTREAM_LOCKED_SCOPES_INVALID", f"{location}.locked_scopes", "locked_scopes must be a string array")
                scopes = []
            invalid_scopes = sorted(set(scopes) - CHANGE_SCOPES)
            if invalid_scopes:
                add("ERROR", "UPSTREAM_LOCKED_SCOPE_INVALID", f"{location}.locked_scopes", f"invalid scopes: {', '.join(invalid_scopes)}")
            if (
                control.get("copy_state") in {"LOCKED", "PARTIAL"}
                or control.get("asset_state") in {"LOCKED", "PARTIAL"}
            ) and not scopes:
                add("ERROR", "UPSTREAM_LOCKED_SCOPES_MISSING", f"{location}.locked_scopes", "LOCKED or PARTIAL control requires explicit scopes")
            if nonempty_string_list(control.get("reopen_conditions", [])) is None:
                add("ERROR", "UPSTREAM_REOPEN_CONDITIONS_INVALID", f"{location}.reopen_conditions", "reopen_conditions must be a string array")

    risks = value.get("acknowledged_risks", [])
    if risks is None:
        risks = []
    if not isinstance(risks, list):
        add("ERROR", "ACKNOWLEDGED_RISKS_INVALID", "operating_context.acknowledged_risks", "acknowledged_risks must be an array")
        risks = []
    for index, risk in enumerate(risks):
        location = f"operating_context.acknowledged_risks[{index}]"
        if not isinstance(risk, dict):
            add("ERROR", "ACKNOWLEDGED_RISK_INVALID", location, "risk acknowledgement must be an object")
            continue
        risk_id = risk.get("risk_id")
        if not is_nonempty_string(risk_id):
            add("ERROR", "ACKNOWLEDGED_RISK_ID_MISSING", f"{location}.risk_id", "risk_id is required")
        elif risk_id.strip() in result["risk_ids"]:
            add("ERROR", "ACKNOWLEDGED_RISK_ID_DUPLICATE", f"{location}.risk_id", "risk_id must be unique")
        else:
            result["risk_ids"].add(risk_id.strip())
        if risk.get("decision") not in RISK_ACK_DECISIONS:
            add("ERROR", "ACKNOWLEDGED_RISK_DECISION_INVALID", f"{location}.decision", "invalid risk decision")
        for field in ("scope", "review_trigger"):
            if not is_nonempty_string(risk.get(field)):
                add("ERROR", "ACKNOWLEDGED_RISK_FIELD_MISSING", f"{location}.{field}", f"{field} is required")
        if risk.get("does_not_change_evidence_or_publication_status") is not True:
            add("ERROR", "RISK_ACKNOWLEDGEMENT_MAY_NOT_RELEASE", location, "risk acknowledgement must explicitly preserve evidence and publication status")
        forbidden = sorted(RISK_OVERRIDE_KEYS.intersection(risk))
        if forbidden:
            add("ERROR", "RISK_ACKNOWLEDGEMENT_OVERRIDE", location, f"risk acknowledgement contains forbidden overrides: {', '.join(forbidden)}")
    return result


def validate_change_control(
    value: Any,
    upstream_control: Any,
    listing_copy: dict[str, Any],
    add,
) -> dict[str, Any]:
    if value is None:
        if upstream_control is not None:
            add("ERROR", "CHANGE_CONTROL_NOT_PRESERVED", "change_control", "a release must preserve upstream content_change_control")
        return {}
    if not isinstance(value, dict):
        add("ERROR", "CHANGE_CONTROL_INVALID", "change_control", "change_control must be an object")
        return {}

    for field in ("decision_id", "copy_state", "asset_state", "operator_change_state"):
        if field == "decision_id":
            if not is_nonempty_string(value.get(field)):
                add("ERROR", "CHANGE_CONTROL_FIELD_MISSING", f"change_control.{field}", f"{field} is required")
        elif value.get(field, "UNKNOWN") not in CHANGE_STATES:
            add("ERROR", "CHANGE_CONTROL_STATE_INVALID", f"change_control.{field}", f"{field} is invalid")
    if parse_iso_datetime(value.get("decided_at")) is None:
        add("ERROR", "CHANGE_CONTROL_TIME_INVALID", "change_control.decided_at", "decided_at must be a timezone-aware ISO-8601 timestamp")
    review_triggers = nonempty_string_list(value.get("reopen_conditions", []))
    if review_triggers is None:
        add("ERROR", "CHANGE_REOPEN_CONDITIONS_INVALID", "change_control.reopen_conditions", "reopen_conditions must be a string array")
    scopes = nonempty_string_list(value.get("locked_scopes", []))
    if scopes is None:
        add("ERROR", "LOCKED_SCOPES_INVALID", "change_control.locked_scopes", "locked_scopes must be a string array")
        scopes = []
    invalid_scopes = sorted(set(scopes) - CHANGE_SCOPES)
    if invalid_scopes:
        add("ERROR", "LOCKED_SCOPE_INVALID", "change_control.locked_scopes", f"invalid scopes: {', '.join(invalid_scopes)}")
    if (
        value.get("copy_state") in {"LOCKED", "PARTIAL"}
        or value.get("asset_state") in {"LOCKED", "PARTIAL"}
    ) and value.get("operator_change_state") == "OPEN":
        add("ERROR", "OPERATOR_CHANGE_STATE_MISMATCH", "change_control.operator_change_state", "operator_change_state cannot be OPEN while any scope remains LOCKED or PARTIAL")

    if isinstance(upstream_control, dict):
        for field in ("decision_id", "decided_at", "copy_state", "asset_state", "locked_scopes", "reopen_conditions"):
            upstream_value = upstream_control.get(field, [] if field in {"locked_scopes", "reopen_conditions"} else None)
            release_value = value.get(field, [] if field in {"locked_scopes", "reopen_conditions"} else None)
            if field in {"locked_scopes", "reopen_conditions"}:
                upstream_value = sorted(upstream_value) if isinstance(upstream_value, list) else upstream_value
                release_value = sorted(release_value) if isinstance(release_value, list) else release_value
            if release_value != upstream_value:
                add("ERROR", "CHANGE_CONTROL_MISMATCH", f"change_control.{field}", f"{field} does not preserve upstream content_change_control")

    authorizations = value.get("explicit_change_authorizations", [])
    if authorizations is None:
        authorizations = []
    if not isinstance(authorizations, list):
        add("ERROR", "CHANGE_AUTHORIZATIONS_INVALID", "change_control.explicit_change_authorizations", "explicit_change_authorizations must be an array")
        authorizations = []
    authorized_scopes: set[str] = set()
    for index, authorization in enumerate(authorizations):
        location = f"change_control.explicit_change_authorizations[{index}]"
        if not isinstance(authorization, dict):
            add("ERROR", "CHANGE_AUTHORIZATION_INVALID", location, "authorization must be an object")
            continue
        if not is_nonempty_string(authorization.get("authorization_id")):
            add("ERROR", "CHANGE_AUTHORIZATION_ID_MISSING", f"{location}.authorization_id", "authorization_id is required")
        authorization_scopes = nonempty_string_list(authorization.get("scopes"))
        if not authorization_scopes:
            add("ERROR", "CHANGE_AUTHORIZATION_SCOPES_MISSING", f"{location}.scopes", "authorization requires one or more scopes")
            authorization_scopes = []
        invalid = sorted(set(authorization_scopes) - CHANGE_SCOPES)
        if invalid:
            add("ERROR", "CHANGE_AUTHORIZATION_SCOPE_INVALID", f"{location}.scopes", f"invalid scopes: {', '.join(invalid)}")
        authorized_scopes.update(authorization_scopes)
        if parse_iso_datetime(authorization.get("authorized_at")) is None:
            add("ERROR", "CHANGE_AUTHORIZATION_TIME_INVALID", f"{location}.authorized_at", "authorized_at must be timezone-aware")
        if not is_nonempty_string(authorization.get("source")):
            add("ERROR", "CHANGE_AUTHORIZATION_SOURCE_MISSING", f"{location}.source", "source is required")

    baseline = value.get("baseline_listing_copy", {})
    if baseline is None:
        baseline = {}
    if not isinstance(baseline, dict):
        add("ERROR", "CHANGE_BASELINE_INVALID", "change_control.baseline_listing_copy", "baseline_listing_copy must be an object")
        baseline = {}
    for scope in scopes:
        field = COPY_SCOPE_FIELDS.get(scope)
        if field is None:
            continue
        if field not in baseline:
            add("ERROR", "LOCKED_BASELINE_MISSING", f"change_control.baseline_listing_copy.{field}", f"locked scope {scope} requires a baseline value")
            continue
        if baseline.get(field) != listing_copy.get(field) and scope not in authorized_scopes:
            add("ERROR", "LOCKED_SCOPE_CHANGED", f"listing_copy.{field}", f"locked scope {scope} changed without explicit authorization")
    return value


def validate_promotion_handoff(
    value: Any,
    data: dict[str, Any],
    operating: dict[str, Any],
    operating_context_hash: str | None,
    change_control: dict[str, Any],
    add,
) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        add("ERROR", "PROMOTION_HANDOFF_INVALID", "promotion_handoff", "promotion_handoff must be an object")
        return
    if value.get("handoff_type") != "NEUTRAL_PROMOTION_INPUT":
        add("ERROR", "PROMOTION_HANDOFF_TYPE_INVALID", "promotion_handoff.handoff_type", "handoff_type must be NEUTRAL_PROMOTION_INPUT")
    if not is_nonempty_string(value.get("operating_context_id")):
        add("ERROR", "PROMOTION_CONTEXT_MISSING", "promotion_handoff.operating_context_id", "neutral promotion handoff requires an operating_context reference")
    elif value.get("operating_context_id") != operating.get("context_id"):
        add("ERROR", "PROMOTION_CONTEXT_MISMATCH", "promotion_handoff.operating_context_id", "operating_context_id must match the preserved context")
    if value.get("operating_context_sha256") != operating_context_hash:
        add("ERROR", "PROMOTION_CONTEXT_HASH_MISMATCH", "promotion_handoff.operating_context_sha256", "operating_context_sha256 must match the preserved context")
    release_ref = value.get("listing_release_ref")
    if not isinstance(release_ref, dict):
        add("ERROR", "PROMOTION_LISTING_REF_INVALID", "promotion_handoff.listing_release_ref", "listing_release_ref must be an object")
    else:
        for field in ("listing_run_id", "listing_version_id", "release_status", "snapshot_at"):
            if release_ref.get(field) != data.get(field):
                add("ERROR", "PROMOTION_LISTING_REF_MISMATCH", f"promotion_handoff.listing_release_ref.{field}", f"{field} must match the release package")
    refresh = nonempty_string_list(value.get("refresh_requirements"))
    if not refresh:
        add("ERROR", "PROMOTION_REFRESH_REQUIREMENTS_MISSING", "promotion_handoff.refresh_requirements", "neutral promotion handoff requires explicit live refresh requirements")
    decision_id = change_control.get("decision_id") if isinstance(change_control, dict) else None
    if not is_nonempty_string(value.get("change_control_decision_id")):
        add("ERROR", "PROMOTION_CHANGE_CONTROL_MISSING", "promotion_handoff.change_control_decision_id", "neutral promotion handoff requires a change-control decision reference")
    elif value.get("change_control_decision_id") != decision_id:
        add("ERROR", "PROMOTION_CHANGE_CONTROL_MISMATCH", "promotion_handoff.change_control_decision_id", "change control reference must match the release")
    risk_ids = nonempty_string_list(value.get("risk_acknowledgement_ids", []))
    if risk_ids is None:
        add("ERROR", "PROMOTION_RISK_REFS_INVALID", "promotion_handoff.risk_acknowledgement_ids", "risk references must be a string array")
    else:
        unknown = sorted(set(risk_ids) - operating.get("risk_ids", set()))
        if unknown:
            add("ERROR", "PROMOTION_RISK_REF_UNKNOWN", "promotion_handoff.risk_acknowledgement_ids", f"unknown risk IDs: {', '.join(unknown)}")
    constraints = value.get("user_business_constraints", [])
    if constraints is None:
        constraints = []
    if not isinstance(constraints, list):
        add("ERROR", "PROMOTION_CONSTRAINTS_INVALID", "promotion_handoff.user_business_constraints", "user_business_constraints must be an array")
    else:
        for index, constraint in enumerate(constraints):
            location = f"promotion_handoff.user_business_constraints[{index}]"
            if not isinstance(constraint, dict):
                add("ERROR", "PROMOTION_CONSTRAINT_INVALID", location, "constraint must be an object")
                continue
            for field in ("constraint_id", "metric", "source"):
                if not is_nonempty_string(constraint.get(field)):
                    add("ERROR", "PROMOTION_CONSTRAINT_FIELD_MISSING", f"{location}.{field}", f"{field} is required")
            if constraint.get("status") != "USER_DIRECTIVE_NOT_EVIDENCE":
                add("ERROR", "PROMOTION_CONSTRAINT_STATUS_INVALID", f"{location}.status", "seller constraints must remain USER_DIRECTIVE_NOT_EVIDENCE")
            metric = str(constraint.get("metric", "")).casefold().replace(" ", "_")
            if metric in PROMOTION_ACTION_KEYS:
                add("ERROR", "PROMOTION_CONSTRAINT_NOT_NEUTRAL", f"{location}.metric", "a Listing handoff cannot encode an advertising action as a business constraint")
    for key, path in recursive_keys(value):
        if key in PROMOTION_ACTION_KEYS:
            add("ERROR", "PROMOTION_HANDOFF_NOT_NEUTRAL", f"promotion_handoff.{path}", f"advertising action field {key!r} is not allowed in the Listing handoff")
        if key in PROMOTION_PRICE_KEYS:
            add("ERROR", "PROMOTION_PRICE_DUPLICATED", f"promotion_handoff.{path}", "price values must stay in operating_context so planned and observed states cannot be conflated")
        if key in PROMOTION_DUPLICATED_CONTEXT_KEYS:
            add("ERROR", "PROMOTION_CONTEXT_DUPLICATED", f"promotion_handoff.{path}", "operating context must be referenced by context_id, not duplicated under promotion_handoff")


def validate(data: dict[str, Any]) -> dict[str, Any]:
    findings: list[Finding] = []

    def add(severity: str, code: str, location: str, message: str) -> None:
        findings.append(Finding(severity, code, location, message))

    inferred_stage2_intake = "schema_version" in data and "listing_run_id" not in data
    mode = data.get("mode", "INTAKE" if inferred_stage2_intake else "")
    if mode not in {"INTAKE", "RELEASE"}:
        add("ERROR", "MODE_INVALID", "mode", "mode must be INTAKE or RELEASE")

    version = data.get("contract_version", data.get("schema_version") if mode == "INTAKE" else None)
    if version != "1.0":
        add(
            "ERROR",
            "CONTRACT_VERSION_INVALID",
            "contract_version" if mode == "RELEASE" else "schema_version",
            "Stage 2 schema_version or Stage 3 contract_version must be 1.0",
        )

    declared_unknowns = json.dumps(data.get("unknowns", []), ensure_ascii=False)
    for key in STABLE_IDS:
        value = data.get(key)
        if value is None or value == "":
            # 缺失的上游 ID：不能编造。选品阶段的 ID 可直接缺省；其余缺失要在 unknowns 里说明。
            if key not in SELECTION_STAGE_IDS and key not in declared_unknowns:
                add("WARNING", "LINEAGE_GAP_UNDECLARED", key, f"{key} is absent; list it in unknowns instead of inventing an ID")
        elif not is_nonempty_string(value):
            add("ERROR", "STABLE_ID_INVALID", key, f"{key} must be a non-empty string when present")

    if mode == "RELEASE":
        for key in LISTING_IDS:
            if not is_nonempty_string(data.get(key)):
                add("ERROR", "LISTING_ID_MISSING", key, f"{key} is required for a release package")
        for key in ("marketplace", "output_locale", "product_type", "snapshot_at"):
            if not is_nonempty_string(data.get(key)):
                add("ERROR", "RELEASE_CONTEXT_MISSING", key, f"{key} is required for a release package")

    upstream = data.get("upstream_snapshot", {})
    if mode == "RELEASE" and not isinstance(upstream, dict):
        add("ERROR", "UPSTREAM_INVALID", "upstream_snapshot", "upstream_snapshot must be an object")
        upstream = {}
    upstream_integrity = upstream.get("integrity_status", "UNKNOWN") if isinstance(upstream, dict) else "UNKNOWN"
    if upstream_integrity not in {"VERIFIED", "PARTIAL", "UNKNOWN"}:
        add("ERROR", "UPSTREAM_STATUS_INVALID", "upstream_snapshot.integrity_status", "Use VERIFIED, PARTIAL, or UNKNOWN")
    upstream_ids = upstream.get("stable_ids", {}) if isinstance(upstream, dict) else {}
    if upstream_ids and not isinstance(upstream_ids, dict):
        add("ERROR", "UPSTREAM_IDS_INVALID", "upstream_snapshot.stable_ids", "stable_ids must be an object")
        upstream_ids = {}
    if isinstance(upstream_ids, dict):
        for key in STABLE_IDS:
            if key in upstream_ids and upstream_ids[key] != data.get(key):
                add("ERROR", "STABLE_ID_MISMATCH", key, f"{key} does not match upstream_snapshot.stable_ids")

    operating = validate_operating_context(
        data.get("operating_context"), data.get("marketplace"), add
    )
    try:
        computed_operating_context_hash = (
            operating_context_sha256(operating["context"])
            if operating["context"]
            else None
        )
    except (TypeError, ValueError, OverflowError):
        add("ERROR", "OPERATING_CONTEXT_HASH_INVALID", "operating_context", "Context contains a non-finite number or cannot be canonically hashed")
        computed_operating_context_hash = None
    supplied_operating_context_hash = data.get("operating_context_sha256")
    if operating["context"]:
        if supplied_operating_context_hash != computed_operating_context_hash:
            add(
                "ERROR",
                "OPERATING_CONTEXT_HASH_MISMATCH",
                "operating_context_sha256",
                "operating_context_sha256 must match canonical operating_context content",
            )
    elif supplied_operating_context_hash is not None:
        add(
            "ERROR",
            "OPERATING_CONTEXT_HASH_WITHOUT_CONTEXT",
            "operating_context_sha256",
            "operating_context_sha256 cannot be supplied without operating_context",
        )
    if mode == "RELEASE" and operating["context_id"] is not None:
        if upstream.get("operating_context_id") != operating["context_id"]:
            add(
                "ERROR",
                "OPERATING_CONTEXT_NOT_PRESERVED",
                "upstream_snapshot.operating_context_id",
                "release operating_context_id must match the upstream handoff reference",
            )
        if upstream.get("operating_context_sha256") != computed_operating_context_hash:
            add(
                "ERROR",
                "OPERATING_CONTEXT_HASH_NOT_PRESERVED",
                "upstream_snapshot.operating_context_sha256",
                "release operating_context_sha256 must match the upstream handoff reference",
            )

    product = data.get("product", {})
    if not isinstance(product, dict):
        add("ERROR", "PRODUCT_INVALID", "product", "product must be an object")
        product = {}
    facts = product.get("verified_facts", [])
    if not isinstance(facts, list):
        add("ERROR", "FACTS_INVALID", "product.verified_facts", "verified_facts must be an array")
        facts = []
    fact_by_id: dict[str, dict[str, Any]] = {}
    evidence_ids: set[str] = set()
    for index, fact in enumerate(facts):
        location = f"product.verified_facts[{index}]"
        if not isinstance(fact, dict):
            add("ERROR", "FACT_INVALID", location, "fact must be an object")
            continue
        fact_id = fact.get("fact_id")
        if not is_nonempty_string(fact_id):
            add("ERROR", "FACT_ID_MISSING", location, "fact_id is required")
            continue
        if fact_id in fact_by_id:
            add("ERROR", "FACT_ID_DUPLICATE", location, f"duplicate fact_id {fact_id!r}")
        fact_by_id[fact_id] = fact
        raw_evidence_ids = fact.get("evidence_ids", [])
        if not isinstance(raw_evidence_ids, list) or any(not is_nonempty_string(item) for item in raw_evidence_ids):
            add("ERROR", "FACT_EVIDENCE_IDS_INVALID", location, "evidence_ids must be an array of non-empty strings")
        else:
            evidence_ids.update(raw_evidence_ids)

    keywords = flatten_keyword_library(data.get("keyword_library", []), add)
    keyword_by_id: dict[str, dict[str, Any]] = {}
    for index, keyword in enumerate(keywords):
        location = f"keyword_library[{index}]"
        if not isinstance(keyword, dict):
            add("ERROR", "KEYWORD_INVALID", location, "keyword row must be an object")
            continue
        keyword_id = keyword.get("keyword_id")
        if not is_nonempty_string(keyword_id):
            add("ERROR", "KEYWORD_ID_MISSING", location, "keyword_id is required")
            continue
        if keyword_id in keyword_by_id:
            add("ERROR", "KEYWORD_ID_DUPLICATE", location, f"duplicate keyword_id {keyword_id!r}")
        keyword_by_id[keyword_id] = keyword
        for flag in ("front_end_copy_eligible", "listing_indexing_eligible", "current_stage_eligible"):
            flag_value = keyword.get(flag, keyword.get("eligibility", {}).get(flag) if isinstance(keyword.get("eligibility"), dict) else None)
            if flag_value is not None and not isinstance(flag_value, bool):
                add("ERROR", "KEYWORD_ELIGIBILITY_INVALID", f"{location}.{flag}", f"{flag} must be a boolean or null")
        role = keyword_role(keyword)
        # 上游给的角色和资格标记互相矛盾时，不能靠“哪个先被检查”来决定能不能放进文案
        if role in BLOCKED_ROLES:
            for flag in ("front_end_copy_eligible", "listing_indexing_eligible"):
                if get_bool(keyword, flag):
                    add("ERROR", "KEYWORD_ROLE_ELIGIBILITY_CONFLICT", f"{location}.{flag}",
                        f"role {role!r} is blocked but {flag}=true; resolve upstream before drafting")
        if role == "INDEXING_CANDIDATE" and get_bool(keyword, "front_end_copy_eligible"):
            add("ERROR", "KEYWORD_ROLE_ELIGIBILITY_CONFLICT", f"{location}.front_end_copy_eligible",
                "INDEXING_CANDIDATE is backend-only but front_end_copy_eligible=true; resolve upstream before drafting")
        if role == "LATER_STAGE_RELEVANT" and get_bool(keyword, "current_stage_eligible"):
            basis = keyword.get("stage_eligibility_basis")
            if not isinstance(basis, dict):
                add("ERROR", "KEYWORD_STAGE_BASIS_MISSING", location, "current-stage LATER_STAGE_RELEVANT requires stage_eligibility_basis")
                continue
            if basis.get("basis_type") != "CURRENT_OBSERVED_STAGE":
                add("ERROR", "KEYWORD_STAGE_BASIS_TYPE_INVALID", f"{location}.stage_eligibility_basis.basis_type", "basis_type must be CURRENT_OBSERVED_STAGE")
            if basis.get("stage_id") != operating["current_stage_id"]:
                add("ERROR", "KEYWORD_STAGE_ID_MISMATCH", f"{location}.stage_eligibility_basis.stage_id", "stage_id must match operating_context.current_stage")
            if basis.get("operating_context_id") != operating["context_id"]:
                add("ERROR", "KEYWORD_STAGE_CONTEXT_MISMATCH", f"{location}.stage_eligibility_basis.operating_context_id", "operating_context_id must match the preserved context")
            if parse_iso_datetime(basis.get("evaluated_at")) is None:
                add("ERROR", "KEYWORD_STAGE_TIME_INVALID", f"{location}.stage_eligibility_basis.evaluated_at", "evaluated_at must be a timezone-aware ISO-8601 timestamp")
            basis_evidence = nonempty_string_list(basis.get("evidence_ids"))
            if not basis_evidence:
                add("ERROR", "KEYWORD_STAGE_EVIDENCE_MISSING", f"{location}.stage_eligibility_basis.evidence_ids", "current-stage eligibility requires evidence_ids")
            elif not set(basis_evidence) <= operating["current_stage_evidence_ids"]:
                add("ERROR", "KEYWORD_STAGE_EVIDENCE_MISMATCH", f"{location}.stage_eligibility_basis.evidence_ids", "stage basis must cite current-stage evidence, not a planned state")

    if mode == "INTAKE":
        errors = [item for item in findings if item.severity == "ERROR"]
        return {
            "mode": mode,
            "structurally_valid": not errors,
            "release_ready": False,
            "summary": {
                "stable_ids_present": sum(is_nonempty_string(data.get(key)) for key in STABLE_IDS),
                "facts": len(fact_by_id),
                "keywords": len(keyword_by_id),
            },
            "findings": [asdict(item) for item in findings],
        }

    policy = data.get("policy_snapshot", {})
    if not isinstance(policy, dict):
        add("ERROR", "POLICY_INVALID", "policy_snapshot", "policy_snapshot must be an object")
        policy = {}
    policy_verified = policy.get("verified") is True
    if not policy_verified:
        add("ERROR", "POLICY_UNVERIFIED", "policy_snapshot.verified", "A release cannot be READY without current official policy verification")
    for key in ("verified_at", "marketplace", "product_type", "sources", "field_rules"):
        if key not in policy:
            add("ERROR", "POLICY_FIELD_MISSING", f"policy_snapshot.{key}", f"policy_snapshot.{key} is required")
    for key in ("marketplace", "product_type"):
        if key in policy and policy[key] != data.get(key):
            add("ERROR", "POLICY_SCOPE_MISMATCH", f"policy_snapshot.{key}", f"policy {key} must match the release {key}")
    verified_at = parse_iso_datetime(policy.get("verified_at"))
    if verified_at is None:
        add("ERROR", "POLICY_TIME_INVALID", "policy_snapshot.verified_at", "verified_at must be a timezone-aware ISO-8601 timestamp")
    else:
        now = dt.datetime.now(dt.timezone.utc)
        if verified_at > now:
            add("ERROR", "POLICY_TIME_FUTURE", "policy_snapshot.verified_at", "verified_at cannot be in the future")
        refresh_due_value = policy.get("refresh_due_at")
        if refresh_due_value is not None:
            refresh_due_at = parse_iso_datetime(refresh_due_value)
            if refresh_due_at is None or refresh_due_at < verified_at:
                add("ERROR", "POLICY_REFRESH_DUE_INVALID", "policy_snapshot.refresh_due_at", "refresh_due_at must be a timezone-aware ISO-8601 timestamp at or after verified_at")
            elif refresh_due_at < now:
                add("ERROR", "POLICY_REFRESH_OVERDUE", "policy_snapshot.refresh_due_at", "Policy review is overdue; verify the current rule before READY")
    sources = policy.get("sources", [])
    if not isinstance(sources, list) or not sources:
        add("ERROR", "POLICY_SOURCES_MISSING", "policy_snapshot.sources", "At least one current official source is required")

    copy_plan = data.get("copy_plan", [])
    if not isinstance(copy_plan, list) or not copy_plan:
        add("ERROR", "COPY_PLAN_MISSING", "copy_plan", "A non-empty evidence-to-field copy plan is required")
    else:
        required_plan_keys = {
            "plan_item_id",
            "buyer_question",
            "own_fact_ids",
            "target_field",
            "prohibited_wording",
            "decision",
        }
        for index, row in enumerate(copy_plan):
            location = f"copy_plan[{index}]"
            if not isinstance(row, dict):
                add("ERROR", "COPY_PLAN_ROW_INVALID", location, "copy plan row must be an object")
                continue
            missing = sorted(key for key in required_plan_keys if key not in row)
            if missing:
                add("ERROR", "COPY_PLAN_FIELDS_MISSING", location, f"missing fields: {', '.join(missing)}")
            if row.get("decision") not in {"USE", "HOLD", "OMIT"}:
                add("ERROR", "COPY_PLAN_DECISION_INVALID", location, "decision must be USE, HOLD, or OMIT")
            if row.get("decision") == "USE":
                own_fact_ids = row.get("own_fact_ids", [])
                if not isinstance(own_fact_ids, list) or not own_fact_ids:
                    add("ERROR", "COPY_PLAN_FACTS_MISSING", location, "USE rows require own_fact_ids")
                else:
                    for fact_id in own_fact_ids:
                        if fact_id not in fact_by_id:
                            add("ERROR", "COPY_PLAN_FACT_UNKNOWN", location, f"unknown fact_id {fact_id!r}")

    listing_copy = data.get("listing_copy", {})
    if not isinstance(listing_copy, dict):
        add("ERROR", "LISTING_COPY_INVALID", "listing_copy", "listing_copy must be an object")
        listing_copy = {}
    for key in ("title", "item_highlight", "bullets", "product_description", "search_terms"):
        if key not in listing_copy:
            add("ERROR", "LISTING_FIELD_MISSING", f"listing_copy.{key}", f"listing_copy.{key} must be present, even when empty")
    bullets = listing_copy.get("bullets", [])
    if not isinstance(bullets, list) or any(not isinstance(item, str) for item in bullets):
        add("ERROR", "BULLETS_INVALID", "listing_copy.bullets", "bullets must be an array of strings")
    fields = field_values(listing_copy)
    change_control = validate_change_control(
        data.get("change_control"), operating["content_change_control"],
        listing_copy, add,
    )

    mappings = data.get("claim_mappings", [])
    if not isinstance(mappings, list):
        add("ERROR", "CLAIM_MAPPINGS_INVALID", "claim_mappings", "claim_mappings must be an array")
        mappings = []
    mapped_locations: set[str] = set()
    mapped_texts: dict[str, list[str]] = {location: [] for location in ALL_LOCATIONS}
    for index, mapping in enumerate(mappings):
        location = f"claim_mappings[{index}]"
        if not isinstance(mapping, dict):
            add("ERROR", "CLAIM_MAPPING_INVALID", location, "claim mapping must be an object")
            continue
        claim_location = mapping.get("location")
        if claim_location not in ALL_LOCATIONS:
            add("ERROR", "CLAIM_LOCATION_INVALID", location, "claim mapping location must be a Listing field")
            continue
        mapped_locations.add(claim_location)
        exact_text = mapping.get("exact_text")
        field_text = fields.get(claim_location, "")
        if not is_nonempty_string(exact_text):
            add("ERROR", "CLAIM_TEXT_MISSING", location, "exact_text is required")
        else:
            mapped_texts[claim_location].append(exact_text)
        fact_ids = mapping.get("fact_ids", [])
        if not isinstance(fact_ids, list) or not fact_ids:
            add("ERROR", "CLAIM_FACTS_MISSING", location, "fact_ids must contain at least one own-product fact")
            fact_ids = []
        mapping_evidence_ids = mapping.get("evidence_ids", [])
        if not isinstance(mapping_evidence_ids, list) or not mapping_evidence_ids:
            add("ERROR", "CLAIM_EVIDENCE_MISSING", location, "evidence_ids must contain at least one source ID")
            mapping_evidence_ids = []
        for evidence_id in mapping_evidence_ids:
            if evidence_id not in evidence_ids:
                add("ERROR", "CLAIM_EVIDENCE_UNKNOWN", location, f"evidence_id {evidence_id!r} is not attached to a verified fact")
        mapped_facts: list[dict[str, Any]] = []
        mapping_permission = mapping.get("permission")
        if mapping_permission not in RELEASED_PUBLICATION_STATUSES:
            add("ERROR", "CLAIM_PERMISSION_INVALID", location, "permission must be COPY_RELEASED or FORMAL_CLAIM_RELEASED")
        for fact_id in fact_ids:
            fact = fact_by_id.get(fact_id)
            if fact is None:
                add("ERROR", "CLAIM_FACT_UNKNOWN", location, f"unknown fact_id {fact_id!r}")
                continue
            mapped_facts.append(fact)
            status = str(fact.get("publication_status", ""))
            risk_class = str(fact.get("risk_class", fact.get("risk_level", ""))).upper()
            is_high_risk = "HIGH" in risk_class
            if status in WITHHELD_PUBLICATION_STATUSES or status not in RELEASED_PUBLICATION_STATUSES:
                add("ERROR", "CLAIM_FACT_WITHHELD", location, f"fact {fact_id!r} has non-released publication_status {status!r}")
            if mapping_permission == "FORMAL_CLAIM_RELEASED" and status != "FORMAL_CLAIM_RELEASED":
                add("ERROR", "CLAIM_PERMISSION_MISMATCH", location, f"mapping claims formal release but fact {fact_id!r} is {status!r}")
            if is_high_risk and status != "FORMAL_CLAIM_RELEASED":
                add("ERROR", "HIGH_RISK_NOT_FORMALLY_RELEASED", location, f"high-risk fact {fact_id!r} requires FORMAL_CLAIM_RELEASED")
            if is_high_risk:
                approved = fact.get("approved_wording", fact.get("claim_text", []))
                if isinstance(approved, str):
                    approved = [approved]
                if not isinstance(approved, list) or not approved:
                    add("ERROR", "HIGH_RISK_WORDING_MISSING", location, f"high-risk fact {fact_id!r} requires approved_wording")
                elif is_nonempty_string(exact_text) and not any(
                    normalized(item) == normalized(exact_text)
                    for item in approved
                    if is_nonempty_string(item)
                ):
                    add("ERROR", "HIGH_RISK_WORDING_MISMATCH", location, f"exact_text must equal a complete approved wording for high-risk fact {fact_id!r}")
            fact_evidence = fact.get("evidence_ids", [])
            if isinstance(fact_evidence, list) and not set(mapping_evidence_ids) & set(fact_evidence):
                add("ERROR", "CLAIM_FACT_EVIDENCE_MISMATCH", location, f"mapping evidence does not connect to fact {fact_id!r}")
        if is_nonempty_string(exact_text) and SENSITIVE_WORDING_RE.search(exact_text):
            if not mapped_facts or any(
                "HIGH" not in str(fact.get("risk_class", fact.get("risk_level", ""))).upper()
                or fact.get("publication_status") != "FORMAL_CLAIM_RELEASED"
                for fact in mapped_facts
            ):
                add(
                    "ERROR",
                    "SENSITIVE_WORDING_NOT_FORMALLY_RELEASED",
                    location,
                    "Sensitive, absolute, medical, or superlative wording requires a high-risk fact with FORMAL_CLAIM_RELEASED",
                )

    for location in sorted(ALL_LOCATIONS):
        field_text = fields.get(location, "")
        if is_nonempty_string(field_text) and location not in mapped_locations:
            add("ERROR", "FIELD_UNMAPPED", location, "Every non-empty Listing field requires claim mappings")
        uncovered, absent = covered_claim_tokens(field_text, mapped_texts[location])
        for mapped_text in absent:
            add("ERROR", "CLAIM_TEXT_NOT_FOUND", location, f"mapped exact_text was not found as a complete phrase: {mapped_text!r}")
        if uncovered:
            add("ERROR", "FIELD_CLAIM_UNCOVERED", location, f"Claim mappings leave these field words unreviewed: {' '.join(uncovered)}")

    placements = data.get("keyword_placements", [])
    if not isinstance(placements, list):
        add("ERROR", "KEYWORD_PLACEMENTS_INVALID", "keyword_placements", "keyword_placements must be an array")
        placements = []
    backend_placed_texts: list[str] = []
    for index, placement in enumerate(placements):
        location = f"keyword_placements[{index}]"
        if not isinstance(placement, dict):
            add("ERROR", "KEYWORD_PLACEMENT_INVALID", location, "keyword placement must be an object")
            continue
        field_location = placement.get("location")
        if field_location not in ALL_LOCATIONS:
            add("ERROR", "KEYWORD_LOCATION_INVALID", location, "keyword placement location is invalid")
            continue
        keyword_id = placement.get("keyword_id")
        keyword = keyword_by_id.get(keyword_id)
        if keyword is None:
            add("ERROR", "KEYWORD_UNKNOWN", location, f"unknown keyword_id {keyword_id!r}")
            continue
        exact_text = placement.get("exact_text", placement.get("term", ""))
        if not is_nonempty_string(exact_text) or normalized(exact_text) not in normalized(fields.get(field_location, "")):
            add("ERROR", "KEYWORD_TEXT_NOT_FOUND", location, "placed exact_text was not found in the target field")
        keyword_text = keyword.get("keyword_original", keyword.get("term"))
        if not is_nonempty_string(keyword_text) or claim_tokens(exact_text) != claim_tokens(keyword_text):
            add("ERROR", "KEYWORD_TEXT_MISMATCH", location, "placed exact_text must equal the upstream keyword, not an added claim")
        role = keyword_role(keyword)
        if role in BLOCKED_ROLES:
            add("ERROR", "KEYWORD_ROLE_BLOCKED", location, f"role {role!r} cannot be placed in Listing copy")
        if role == "LATER_STAGE_RELEVANT" and not get_bool(keyword, "current_stage_eligible"):
            add("ERROR", "KEYWORD_LATER_STAGE_BLOCKED", location, "LATER_STAGE_RELEVANT requires current_stage_eligible=true")
        if field_location == "search_terms":
            if is_nonempty_string(exact_text):
                backend_placed_texts.append(exact_text)
            fact_ids = placement.get("fact_ids")
            if not isinstance(fact_ids, list) or not fact_ids:
                add("ERROR", "BACKEND_FACTS_MISSING", location, "Search Terms placement requires own-product fact_ids")
                fact_ids = []
            for fact_id in fact_ids:
                fact = fact_by_id.get(fact_id)
                if fact is None:
                    add("ERROR", "BACKEND_FACT_UNKNOWN", location, f"unknown own-product fact {fact_id!r}")
                    continue
                status = fact.get("publication_status")
                if status not in RELEASED_PUBLICATION_STATUSES:
                    add("ERROR", "BACKEND_FACT_WITHHELD", location, f"fact {fact_id!r} is not released")
                risk_class = str(fact.get("risk_class", fact.get("risk_level", ""))).upper()
                if "HIGH" in risk_class:
                    approved = fact.get("approved_wording", [])
                    if status != "FORMAL_CLAIM_RELEASED" or not isinstance(approved, list) or not any(
                        is_nonempty_string(item) and normalized(item) == normalized(exact_text)
                        for item in approved
                    ):
                        add("ERROR", "BACKEND_FORMAL_WORDING_MISMATCH", location, f"high-risk fact {fact_id!r} requires its exact formal wording")
            if role not in BACKEND_ALLOWED_ROLES and role != "LATER_STAGE_RELEVANT":
                add("ERROR", "KEYWORD_ROLE_BACKEND_INVALID", location, f"role {role!r} is not eligible for Search Terms")
            if not get_bool(keyword, "listing_indexing_eligible"):
                add("ERROR", "KEYWORD_INDEXING_INELIGIBLE", location, "Search Terms placement requires listing_indexing_eligible=true")
        else:
            if role == "INDEXING_CANDIDATE":
                add("ERROR", "INDEXING_CANDIDATE_VISIBLE", location, "INDEXING_CANDIDATE is backend-only")
            elif role not in VISIBLE_ALLOWED_ROLES and role != "LATER_STAGE_RELEVANT":
                add("ERROR", "KEYWORD_ROLE_VISIBLE_INVALID", location, f"role {role!r} is not eligible for visible copy")
            if not get_bool(keyword, "front_end_copy_eligible"):
                add("ERROR", "KEYWORD_FRONTEND_INELIGIBLE", location, "Visible placement requires front_end_copy_eligible=true")

    if is_nonempty_string(fields.get("search_terms", "")):
        uncovered, absent = covered_claim_tokens(fields["search_terms"], backend_placed_texts)
        if uncovered:
            add("ERROR", "BACKEND_KEYWORD_UNCOVERED", "search_terms", f"Unplaced Search Terms words: {' '.join(uncovered)}")
        if absent:
            add("ERROR", "BACKEND_KEYWORD_TEXT_NOT_FOUND", "search_terms", "One or more backend placements do not occur as a complete phrase")

    release_status = data.get("release_status")
    if release_status not in {"READY", "PROVISIONAL", "BLOCKED"}:
        add("ERROR", "RELEASE_STATUS_INVALID", "release_status", "release_status must be READY, PROVISIONAL, or BLOCKED")
    if release_status == "READY" and upstream_integrity != "VERIFIED":
        add("ERROR", "UPSTREAM_NOT_VERIFIED", "upstream_snapshot.integrity_status", "READY requires VERIFIED upstream integrity")

    validate_promotion_handoff(
        data.get("promotion_handoff"),
        data,
        operating,
        computed_operating_context_hash,
        change_control,
        add,
    )

    errors = [item for item in findings if item.severity == "ERROR"]
    release_ready = (
        mode == "RELEASE"
        and release_status == "READY"
        and not errors
        and policy_verified
        and upstream_integrity == "VERIFIED"
    )
    return {
        "mode": mode,
        "structurally_valid": not errors,
        "release_ready": release_ready,
        "summary": {
            "stable_ids_present": sum(is_nonempty_string(data.get(key)) for key in STABLE_IDS),
            "facts": len(fact_by_id),
            "keywords": len(keyword_by_id),
            "copy_plan_rows": len(copy_plan) if isinstance(copy_plan, list) else 0,
            "claim_mappings": len(mappings),
            "keyword_placements": len(placements),
            "visible_fields_mapped": len(mapped_locations),
            "errors": len(errors),
            "warnings": sum(item.severity == "WARNING" for item in findings),
        },
        "findings": [asdict(item) for item in findings],
        "limitations": [
            "Does not authenticate evidence files or verify that tests match the sold model",
            "Cannot prove that a paraphrase faithfully describes its cited fact or detect every sensitive claim; review each mapped phrase and scope against the source",
            "Does not replace current Amazon policy, legal, trademark, regulatory, or seller review",
            "Does not judge copy quality, buyer persuasion, or keyword demand",
            "Does not guarantee submission, indexing, ranking, traffic, or conversion",
        ],
    }


def render_text(result: dict[str, Any]) -> str:
    status = "READY" if result["release_ready"] else ("VALID" if result["structurally_valid"] else "INVALID")
    lines = [f"Listing package: {status}"]
    summary = result["summary"]
    lines.append(
        "Summary: "
        f"stable_ids={summary['stable_ids_present']}/{len(STABLE_IDS)}; "
        f"facts={summary['facts']}; keywords={summary['keywords']}; "
        f"claim_mappings={summary.get('claim_mappings', 0)}; "
        f"keyword_placements={summary.get('keyword_placements', 0)}"
    )
    if result["findings"]:
        lines.append("Findings:")
        for finding in result["findings"]:
            lines.append(f"- {finding['severity']} {finding['code']} [{finding['location']}]: {finding['message']}")
    else:
        lines.append("Findings: none")
    lines.append("Limitations:")
    lines.extend(f"- {item}" for item in result.get("limitations", []))
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Path to UTF-8 JSON input, or - for stdin")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = validate(read_input(args.input))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Input error: {exc}", file=sys.stderr)
        return 2
    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render_text(result))
    return 0 if result["structurally_valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
