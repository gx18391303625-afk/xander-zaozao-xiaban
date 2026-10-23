#!/usr/bin/env python3
"""Validate an Amazon onsite advertising strategy package.

Checks lineage, product-mode requirements, economics readiness, Amazon-only
placement scope, evidence-linked target roles, phase/rollback controls, review
compliance, and live-action authorization state. It does not authenticate data,
judge legal compliance, or mutate an advertising account.

Usage:
    python3 validate_ad_strategy_package.py advertising_strategy_plan.json
    python3 validate_ad_strategy_package.py - --format json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from pathlib import Path
from typing import Any

from calculate_ad_economics import calculate as calculate_economics
from calculate_ad_economics import expand_scenarios


def operating_context_sha256(value: dict[str, Any]) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


UPSTREAM_IDS = (
    "project_id",
    "selection_run_id",
    "candidate_id",
    "competitor_lock_run_id",
    "keyword_run_id",
    "listing_run_id",
    "listing_version_id",
)
AD_IDS = ("ad_economics_run_id", "ad_strategy_run_id", "ad_strategy_version_id")
STRATEGY_MODES = {"NEW_PRODUCT_LAUNCH", "EXISTING_PRODUCT_OPTIMIZATION"}
DELIVERABLE_MODES = {
    "ECONOMICS_ONLY",
    "PLAN",
    "AUDIT",
    "REFRESH",
    "PREPARE_CHANGES",
    "EXECUTE",
}
STRATEGY_STATUSES = {
    "BLOCKED",
    "PROVISIONAL",
    "ECONOMICS_READY",
    "PLAN_READY",
    "READY_FOR_EXECUTION_REVIEW",
    "EXECUTION_AUTHORIZED",
}
CONTENT_CHANGE_STATES = {"OPEN", "LOCKED", "PARTIAL", "UNKNOWN"}
CONTENT_CHANGE_SCOPES = {
    "TITLE",
    "ITEM_HIGHLIGHT",
    "BULLETS",
    "PRODUCT_DESCRIPTION",
    "SEARCH_TERMS",
    "IMAGES",
    "A_PLUS",
}
RISK_ACK_DECISIONS = {
    "ACKNOWLEDGED_FOR_OPERATION",
    "NOT_ACCEPTED",
    "REVIEW_REQUIRED",
}
RISK_OVERRIDE_KEYS = {
    "publication_status_override",
    "research_status_override",
    "claim_release",
    "library_role_override",
    "release_status_override",
}
SEASONALITY_CLASSIFICATIONS = {
    "SEASONAL",
    "EVERGREEN_WITH_PEAKS",
    "EVERGREEN",
    "UNKNOWN",
}
SEASONAL_PHASES = {"PRESEASON", "RAMP", "PEAK", "TAIL", "OFFSEASON", "UNKNOWN"}
SEASONAL_CONFIDENCE = {"HIGH", "MEDIUM", "LOW", "UNKNOWN"}
SEASONAL_GRANULARITIES = {"DAY", "WEEK", "MONTH", "QUARTER", "UNKNOWN"}
EXECUTION_AUTHORITIES = {"PLAN_ONLY", "PREPARE_CHANGES", "EXECUTION_AUTHORIZED"}
ALLOWED_REVIEW_METHODS = {"NONE", "VINE", "REQUEST_A_REVIEW", "ORGANIC_CUSTOMER_EXPERIENCE"}
SOURCE_DATA_CLASSES = {
    "FIRST_PARTY",
    "VERIFIED_PRODUCT",
    "SELLER_CONFIRMED",
    "USER_SUPPLIED_UNVERIFIED",
    "OFFICIAL_POLICY",
    "ESTIMATED",
    "HYPOTHESIS",
}
TARGET_DATA_CLASSES = SOURCE_DATA_CLASSES - {"OFFICIAL_POLICY"}
TARGET_SUPPORT_CLASSES = {
    "FIRST_PARTY": {"FIRST_PARTY"},
    "VERIFIED_PRODUCT": {"FIRST_PARTY", "VERIFIED_PRODUCT"},
    "SELLER_CONFIRMED": {"FIRST_PARTY", "SELLER_CONFIRMED"},
    "USER_SUPPLIED_UNVERIFIED": {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED", "USER_SUPPLIED_UNVERIFIED"},
    "ESTIMATED": {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED", "ESTIMATED"},
    "HYPOTHESIS": TARGET_DATA_CLASSES,
}
HAND_BACK_DESTINATIONS = {
    "write-amazon-listing",
    "build-amazon-keyword-library",
    "analyze-amazon-competitors",
    "select-amazon-products",
    "EXTERNAL_OPERATIONAL_BLOCKER",
}
BLOCKED_POSITIVE_KEYWORD_ROLES = {
    "HOLD_CLAIM",
    "BRAND_IP_ISOLATED",
    "WRONG_INTENT",
    "UNSUPPORTED",
    "MARKET_CONTEXT",
}
REVIEW_ONLY_KEYWORD_ROLES = {
    "RELEVANT_NEEDS_VALIDATION",
    "INDEXING_CANDIDATE",
}
BLOCKED_PRODUCT_TARGET_ROLES = {"KEYWORD_SOURCE_ONLY", "CONTEXT_ONLY", "IDENTITY_PENDING", "EXCLUDED_INVALID"}
NEW_PHASES = {"PREPARED", "LEARNING", "VALIDATING", "SCALING", "TRANSITIONING"}
ALLOWED_LIBRARY_ROLES = {
    "CORE_VERIFIED",
    "SECONDARY_VERIFIED",
    "RELEVANT_NEEDS_VALIDATION",
    "LATER_STAGE_RELEVANT",
    "INDEXING_CANDIDATE",
    "MARKET_CONTEXT",
    "BRAND_IP_ISOLATED",
    "HOLD_CLAIM",
    "WRONG_INTENT",
    "UNSUPPORTED",
    "NOT_PRESENT_FIRST_PARTY_QUERY",
}
ALLOWED_AD_ROLES = {
    "CORE_TEST",
    "CONTROLLED_DISCOVERY",
    "QUERY_VALIDATION",
    "EXACT_OR_TARGET_HARVEST",
    "PRODUCT_TARGET_TEST",
    "DEFENSE_CONDITIONAL",
    "EXPANSION_CANDIDATE",
    "OBSERVE",
    "EXCLUDE",
}
ALLOWED_CEILING_BASES = {"TARGET_PROFIT", "OPERATING_BREAK_EVEN", "APPROVED_LEARNING_LOSS", "UNAVAILABLE"}
COMPETITOR_SOURCE_ROLES = {"USER_SUPPLIED", "UPSTREAM_SELECTED", "RESEARCH_ADDED"}
COMPETITOR_PRIMARY_ROLES = {
    "LEADER",
    "LAUNCH_PEER",
    "DIRECT_PRICE_FORM",
    "NEW_ENTRANT",
    "DIFFERENTIATED_CHALLENGER",
    "ADJACENT_ALTERNATIVE",
}
COMPETITOR_LOCK_STATUSES = {
    "CORE_BENCHMARK",
    "BOUNDARY_REFERENCE",
    "DIFFERENTIATION_REFERENCE",
    "KEYWORD_SOURCE_ONLY",
    "CONTEXT_ONLY",
    "IDENTITY_PENDING",
    "EXCLUDED_INVALID",
}
READY_BLOCKING_ECONOMICS_REASONS = {
    "NEGATIVE_PRE_AD_CONTRIBUTION",
    "ZERO_PRE_AD_CONTRIBUTION",
    "TARGET_PROFIT_EXCEEDS_PRE_AD_CONTRIBUTION",
    "ZERO_TARGET_AD_CAPACITY",
    "PLANNED_UNITS_ZERO",
    "ATTRIBUTED_MIX_UNMAPPED",
    "ASSUMED_ZERO_COST_FIELDS",
    "UNVERIFIED_CORE_INPUTS",
    "VINE_OR_LOCKED_INVENTORY_EXCEEDS_SELLABLE",
    "STOCKOUT_RISK",
}
CHANGE_DOMAINS = {"AMAZON_ADS"}
ALLOWED_AD_ACTIONS = {"CREATE", "UPDATE", "ENABLE", "PAUSE", "ARCHIVE", "ADD_NEGATIVE", "REMOVE_NEGATIVE"}
ALLOWED_ACTIONS_BY_DOMAIN = {
    "AMAZON_ADS": ALLOWED_AD_ACTIONS,
}
PLACEMENT_ACCOUNT_ARTIFACT_TYPES = {"amazon_ads_account_snapshot"}
PERFORMANCE_ARTIFACT_TYPES = {"amazon_ads_report", "amazon_ads_api_snapshot"}
RAW_BUSINESS_ARTIFACT_TYPES = {"amazon_business_report"}
CONTRIBUTION_NORMALIZATION_ARTIFACT_TYPES = {"auditable_contribution_normalization_snapshot"}
ACTUAL_BUSINESS_METRIC_SOURCE_TYPES = {
    "actual_total_sales": RAW_BUSINESS_ARTIFACT_TYPES,
    "actual_attributed_contribution_total": CONTRIBUTION_NORMALIZATION_ARTIFACT_TYPES,
    "actual_total_contribution_before_ads": CONTRIBUTION_NORMALIZATION_ARTIFACT_TYPES,
}
APPROVAL_ARTIFACT_TYPES = {"seller_budget_approval", "amazon_budget_approval_snapshot"}
INVENTORY_ARTIFACT_TYPES = {
    "seller_inventory_snapshot",
    "amazon_inventory_snapshot",
    "seller_supply_route_snapshot",
}
ECONOMICS_EVIDENCE_DOMAINS = {
    "OFFER_AND_REVENUE",
    "AMAZON_FEES_AND_TAX",
    "PRODUCT_COSTS_AND_RETURNS",
    "CONVERSION_RATE",
    "ATTRIBUTED_REVENUE",
    "INVENTORY",
}
TARGET_EVIDENCE_DOMAINS = {"KEYWORD_TARGET_EVIDENCE", "PRODUCT_TARGET_EVIDENCE"}
ONSITE_EVIDENCE_DOMAINS = {"ONSITE_PRICE", "ONSITE_PROMOTION", "VINE_ELIGIBILITY", "REQUEST_REVIEW_ELIGIBILITY"}
ALL_EVIDENCE_DOMAINS = ECONOMICS_EVIDENCE_DOMAINS | TARGET_EVIDENCE_DOMAINS | ONSITE_EVIDENCE_DOMAINS
COMMON_ECONOMICS_EVIDENCE_DOMAINS = {
    "OFFER_AND_REVENUE",
    "AMAZON_FEES_AND_TAX",
    "PRODUCT_COSTS_AND_RETURNS",
    "INVENTORY",
}
SCENARIO_ECONOMICS_EVIDENCE_DOMAINS = {"CONVERSION_RATE", "ATTRIBUTED_REVENUE"}
ECONOMICS_DOMAIN_ARTIFACT_TYPES = {
    "economics_input_snapshot": ECONOMICS_EVIDENCE_DOMAINS,
    "seller_economics_input_snapshot": ECONOMICS_EVIDENCE_DOMAINS,
    "market_conversion_benchmark": {"CONVERSION_RATE", "ATTRIBUTED_REVENUE"},
    "amazon_business_report": {"OFFER_AND_REVENUE", "CONVERSION_RATE", "ATTRIBUTED_REVENUE"},
    "amazon_ads_report": {"CONVERSION_RATE", "ATTRIBUTED_REVENUE"},
    "amazon_ads_api_snapshot": {"CONVERSION_RATE", "ATTRIBUTED_REVENUE"},
    "amazon_fee_preview": {"AMAZON_FEES_AND_TAX"},
    "seller_cost_sheet": {"PRODUCT_COSTS_AND_RETURNS"},
    "seller_offer_snapshot": {"OFFER_AND_REVENUE"},
    "seller_inventory_snapshot": {"INVENTORY"},
    "amazon_inventory_snapshot": {"INVENTORY"},
    "seller_supply_route_snapshot": {"INVENTORY"},
}
ECONOMICS_ARTIFACT_DATA_CLASSES = {
    "economics_input_snapshot": {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED", "ESTIMATED"},
    "seller_economics_input_snapshot": {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED", "ESTIMATED"},
    "market_conversion_benchmark": {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED", "ESTIMATED"},
    "amazon_business_report": {"FIRST_PARTY"},
    "amazon_ads_report": {"FIRST_PARTY"},
    "amazon_ads_api_snapshot": {"FIRST_PARTY"},
    "amazon_fee_preview": {"FIRST_PARTY", "SELLER_CONFIRMED"},
    "seller_cost_sheet": {"VERIFIED_PRODUCT", "SELLER_CONFIRMED"},
    "seller_offer_snapshot": {"FIRST_PARTY", "SELLER_CONFIRMED"},
    "seller_inventory_snapshot": {"FIRST_PARTY", "SELLER_CONFIRMED"},
    "amazon_inventory_snapshot": {"FIRST_PARTY"},
    "seller_supply_route_snapshot": {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED", "ESTIMATED"},
}
TARGET_DOMAIN_ARTIFACT_TYPES = {
    "keyword_library": {"KEYWORD_TARGET_EVIDENCE"},
    "competitor_lock": {"PRODUCT_TARGET_EVIDENCE"},
    "amazon_ads_report": TARGET_EVIDENCE_DOMAINS,
    "amazon_ads_api_snapshot": TARGET_EVIDENCE_DOMAINS,
    "amazon_business_report": TARGET_EVIDENCE_DOMAINS,
    "amazon_search_term_report": {"KEYWORD_TARGET_EVIDENCE"},
    "amazon_product_targeting_report": {"PRODUCT_TARGET_EVIDENCE"},
}
ONSITE_DOMAIN_ARTIFACT_TYPES = {
    "economics_input_snapshot": {"ONSITE_PRICE", "ONSITE_PROMOTION"},
    "seller_economics_input_snapshot": {"ONSITE_PRICE", "ONSITE_PROMOTION"},
    "seller_offer_snapshot": {"ONSITE_PRICE"},
    "amazon_business_report": {"ONSITE_PRICE"},
    "amazon_promotion_snapshot": {"ONSITE_PRICE", "ONSITE_PROMOTION"},
    "seller_promotion_plan": {"ONSITE_PRICE", "ONSITE_PROMOTION"},
    "amazon_vine_eligibility_snapshot": {"VINE_ELIGIBILITY"},
    "seller_vine_eligibility_snapshot": {"VINE_ELIGIBILITY"},
    "amazon_request_review_eligibility_snapshot": {"REQUEST_REVIEW_ELIGIBILITY"},
    "amazon_order_eligibility_snapshot": {"REQUEST_REVIEW_ELIGIBILITY"},
}
SOURCE_DOMAIN_ARTIFACT_TYPES = {
    artifact_type: ECONOMICS_DOMAIN_ARTIFACT_TYPES.get(artifact_type, set()) | TARGET_DOMAIN_ARTIFACT_TYPES.get(artifact_type, set()) | ONSITE_DOMAIN_ARTIFACT_TYPES.get(artifact_type, set())
    for artifact_type in set(ECONOMICS_DOMAIN_ARTIFACT_TYPES) | set(TARGET_DOMAIN_ARTIFACT_TYPES) | set(ONSITE_DOMAIN_ARTIFACT_TYPES)
}
UPSTREAM_ARTIFACT_TYPES = {
    "selection": {"selection_handoff", "product_facts", "seller_product_snapshot"},
    "competitor_lock": {"competitor_lock"},
    "keyword_library": {"keyword_library"},
    "listing_release": {"listing_release"},
}
ALLOWED_AD_ENTITY_TYPES = {
    "CAMPAIGN",
    "AD_GROUP",
    "TARGET",
    "KEYWORD",
    "PRODUCT_TARGET",
    "NEGATIVE_KEYWORD",
    "NEGATIVE_PRODUCT_TARGET",
}
ALLOWED_ROUTING_RULE_TYPES = {
    "NEGATIVE_EXACT",
    "NEGATIVE_PHRASE",
    "NEGATIVE_PRODUCT",
    "QUERY_ROUTING",
    "MUTUAL_EXCLUSION",
}
TARGETING_TYPES_BY_AD_PRODUCT = {
    "SPONSORED_PRODUCTS": {"MANUAL_KEYWORD", "MANUAL_PRODUCT", "AUTOMATIC"},
    "SPONSORED_BRANDS": {"MANUAL_KEYWORD", "MANUAL_PRODUCT"},
    "SPONSORED_DISPLAY": {"MANUAL_PRODUCT", "AUDIENCE", "CONTEXTUAL_PRODUCT"},
}
SOURCE_TARGET_KIND_BY_TARGETING_TYPE = {
    "MANUAL_KEYWORD": "KEYWORD",
    "MANUAL_PRODUCT": "PRODUCT",
    "CONTEXTUAL_PRODUCT": "PRODUCT",
}
KEYWORD_TARGETING_EXPRESSIONS = {"BROAD", "PHRASE", "EXACT"}
REQUEST_REVIEW_ARTIFACT_TYPES = {"amazon_request_review_eligibility_snapshot", "amazon_order_eligibility_snapshot"}
CAMPAIGN_ARCHITECTURE_ALLOWED_FIELDS = {
    "campaign_plan_id",
    "ad_product",
    "objective",
    "targeting_type",
    "source_ad_target_ids",
    "onsite_scope",
    "placement_scope_verified",
    "placement_policy_source_id",
    "placement_account_source_id",
    "placement_verified_at",
    "budget_period",
    "proposed_budget",
    "phase_spend_cap",
    "learning_loss_allocations",
    "learning_loss_model",
    "bid_strategy",
    "entry_gates",
    "exit_gates",
    "rollback_conditions",
    "negative_routing_rule_ids",
    "evidence_ids",
}
PHASE_PLAN_ALLOWED_FIELDS = {
    "phase_id",
    "state",
    "objective",
    "entry_gates",
    "planned_actions",
    "data_sufficiency_rule_ids",
    "attribution_completion_requirement",
    "phase_spend_cap",
    "inventory_floor",
    "exit_gates",
    "rollback_conditions",
    "next_states",
}
PHASE_STATES_BY_MODE = {
    "NEW_PRODUCT_LAUNCH": ("PREPARED", "LEARNING", "VALIDATING", "SCALING", "TRANSITIONING"),
    "EXISTING_PRODUCT_OPTIMIZATION": ("AUDITING", "DIAGNOSING", "TESTING", "SCALING", "TRANSITIONING"),
}
PHASE_TRANSITIONS_BY_MODE = {
    mode: {state: ({states[index + 1]} if index + 1 < len(states) else set()) for index, state in enumerate(states)}
    for mode, states in PHASE_STATES_BY_MODE.items()
}
PERFORMANCE_ENTITY_SCOPES = {
    "campaign",
    "ad_group",
    "target",
    "search_term",
    "placement",
    "advertised_product",
}
CHANGE_PAYLOAD_SCHEMA_VERSION = "AMAZON_ADS_NORMALIZED_V1"
# Change payloads cross the local-plan/live-account trust boundary. They must be
# normalized to this closed key vocabulary before validation; raw API responses
# and undocumented fields fail closed instead of being guessed.
CHANGE_PAYLOAD_ALLOWED_KEYS = {
    "adgroupid",
    "adproduct",
    "amazononly",
    "amount",
    "asin",
    "asins",
    "bid",
    "bidding",
    "bidstrategy",
    "budget",
    "budgetamount",
    "budgettype",
    "campaignid",
    "currencycode",
    "dailybudget",
    "defaultbid",
    "dynamicbidding",
    "enabled",
    "enddate",
    "isoffamazon",
    "keywordid",
    "keywordtext",
    "limitreachtoamazon",
    "matchtype",
    "name",
    "negativeexpression",
    "negativekeywordtext",
    "offamazon",
    "offamazonenabled",
    "offamazonplacements",
    "offamazonsettings",
    "offsite",
    "offsiteenabled",
    "offsitesettings",
    "onsitescope",
    "placementadjustments",
    "placementscope",
    "producttargetid",
    "reachonamazononly",
    "reachscope",
    "scopeafter",
    "startdate",
    "state",
    "status",
    "strategy",
    "targetid",
    "targetingexpression",
    "targetingtype",
    "asinsameas",
    "categorysameas",
    "topofsearchpercentage",
    "productpagepercentage",
    "restofsearchpercentage",
    "otheronamazonpercentage",
}
CHANGE_PAYLOAD_CONTEXTS = {
    "amount": {"budget", "dailybudget", "budgetamount"},
    "currencycode": {"budget", "dailybudget", "budgetamount"},
    "budgettype": {"budget", "dailybudget", "budgetamount"},
    "strategy": {"bidding", "dynamicbidding"},
    "enabled": {
        "amazononly",
        "limitreachtoamazon",
        "reachonamazononly",
        "offamazon",
        "offamazonsettings",
        "offsite",
        "offsitesettings",
    },
    "asinsameas": {"targetingexpression", "negativeexpression"},
    "categorysameas": {"targetingexpression"},
    "topofsearchpercentage": {"placementadjustments"},
    "productpagepercentage": {"placementadjustments"},
    "restofsearchpercentage": {"placementadjustments"},
    "otheronamazonpercentage": {"placementadjustments"},
}
CHANGE_ENTITY_ID_FIELDS = {
    "CAMPAIGN": {"campaignid"},
    "AD_GROUP": {"campaignid", "adgroupid"},
    "TARGET": {"campaignid", "adgroupid", "targetid"},
    "KEYWORD": {"campaignid", "adgroupid", "keywordid"},
    "PRODUCT_TARGET": {"campaignid", "adgroupid", "targetid", "producttargetid"},
    "NEGATIVE_KEYWORD": {"campaignid", "adgroupid", "keywordid"},
    "NEGATIVE_PRODUCT_TARGET": {"campaignid", "adgroupid", "targetid", "producttargetid"},
}
CHANGE_ENTITY_MUTABLE_FIELDS = {
    "CAMPAIGN": {
        "name", "adproduct", "budget", "dailybudget", "budgetamount", "budgettype", "state", "status",
        "startdate", "enddate", "targetingtype", "bidding", "bidstrategy", "dynamicbidding", "placementadjustments",
        "amazononly", "limitreachtoamazon", "reachonamazononly", "offamazon", "offamazonenabled",
        "offamazonplacements", "offamazonsettings", "offsite", "offsiteenabled", "offsitesettings",
        "onsitescope", "placementscope", "reachscope", "scopeafter",
    },
    "AD_GROUP": {"name", "defaultbid", "state", "status", "targetingtype"},
    "TARGET": {"bid", "state", "status", "targetingexpression"},
    "KEYWORD": {"keywordtext", "matchtype", "bid", "state", "status"},
    "PRODUCT_TARGET": {"asin", "asins", "bid", "state", "status", "targetingexpression"},
    "NEGATIVE_KEYWORD": {"negativekeywordtext", "keywordtext", "matchtype", "state", "status"},
    "NEGATIVE_PRODUCT_TARGET": {"asin", "asins", "negativeexpression", "state", "status"},
}
CHANGE_ACTION_ENTITY_TYPES = {
    "CREATE": {"CAMPAIGN", "AD_GROUP", "TARGET", "KEYWORD", "PRODUCT_TARGET"},
    "UPDATE": {"CAMPAIGN", "AD_GROUP", "TARGET", "KEYWORD", "PRODUCT_TARGET"},
    "ENABLE": {"CAMPAIGN", "AD_GROUP", "TARGET", "KEYWORD", "PRODUCT_TARGET"},
    "PAUSE": {"CAMPAIGN", "AD_GROUP", "TARGET", "KEYWORD", "PRODUCT_TARGET"},
    "ARCHIVE": ALLOWED_AD_ENTITY_TYPES,
    "ADD_NEGATIVE": {"NEGATIVE_KEYWORD", "NEGATIVE_PRODUCT_TARGET"},
    "REMOVE_NEGATIVE": {"NEGATIVE_KEYWORD", "NEGATIVE_PRODUCT_TARGET"},
}
CHANGE_CREATE_REQUIRED_FIELDS = {
    "CAMPAIGN": {"name", "adproduct", "targetingtype"},
    "AD_GROUP": {"name", "campaignid"},
    "TARGET": {"targetingexpression", "bid"},
    "KEYWORD": {"keywordtext", "matchtype", "bid"},
    "PRODUCT_TARGET": {"bid"},
    "NEGATIVE_KEYWORD": {"matchtype"},
    "NEGATIVE_PRODUCT_TARGET": set(),
}
MAX_POLICY_AGE = timedelta(days=30)
MAX_ACCOUNT_SNAPSHOT_AGE = timedelta(days=1)
MAX_PRECHANGE_AUTH_AGE = timedelta(hours=1)
MAX_PRECHANGE_PACKAGE_AGE = timedelta(hours=1)
MAX_EXECUTION_AUTH_RUNTIME_AGE = timedelta(hours=1)
MAX_PERFORMANCE_SOURCE_AGE = timedelta(days=1)
MAX_CLOCK_SKEW = timedelta(minutes=5)
REQUIRED_POLICY_DOMAINS = {"PLACEMENT_SCOPE", "ATTRIBUTION_SCHEMA", "REVIEW_METHOD_COMPLIANCE"}
PLACEHOLDER_IDS = {"...", "UNKNOWN", "TBD", "N/A", "NA", "NONE", "NULL", "MISSING", "PLACEHOLDER", "DUMMY", "FAKE", "SAMPLE", "TEST"}
PLACEHOLDER_TOKEN_RE = re.compile(r"(?:^|[-_])(UNKNOWN|TBD|MISSING|PLACEHOLDER|DUMMY|FAKE|SAMPLE|TEST)(?:[-_]|$)", re.IGNORECASE)


@dataclass
class Finding:
    severity: str
    code: str
    location: str
    message: str


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def nonplaceholder(value: Any) -> bool:
    if not nonempty(value):
        return False
    normalized = str(value).strip().upper()
    alphanumeric = re.sub(r"[^A-Z0-9]", "", normalized)
    return (
        normalized not in PLACEHOLDER_IDS
        and PLACEHOLDER_TOKEN_RE.search(normalized) is None
        and bool(alphanumeric)
        and set(alphanumeric) != {"0"}
    )


def is_allowed(value: Any, allowed: set[str]) -> bool:
    """Return safe enum membership for untrusted JSON values."""
    return isinstance(value, str) and value in allowed


def meaningful_payload(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (dict, list, tuple, set)):
        return bool(value)
    if isinstance(value, str):
        return bool(value.strip())
    return True


def as_decimal(value: Any, location: str) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"{location} must be numeric, not boolean")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{location} must be numeric") from exc
    if not result.is_finite():
        raise ValueError(f"{location} must be finite")
    return result


def require_list(value: Any, add, code: str, location: str) -> list[Any]:
    if not isinstance(value, list):
        add("ERROR", code, location, f"{location} must be an array")
        return []
    return value


def require_dict(value: Any, add, code: str, location: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        add("ERROR", code, location, f"{location} must be an object")
        return {}
    return value


def manifest_hash(manifest: list[Any]) -> str:
    canonical = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_aware_timestamp(value: Any, location: str) -> datetime:
    if not nonempty(value):
        raise ValueError(f"{location} must be a non-empty ISO-8601 timestamp")
    normalized = str(value).replace("Z", "+00:00")
    try:
        result = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"{location} must be an ISO-8601 timestamp") from exc
    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError(f"{location} must include a timezone offset")
    return result


def parse_iso_date(value: Any, location: str) -> date:
    if not nonempty(value):
        raise ValueError(f"{location} must be a non-empty ISO-8601 date")
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise ValueError(f"{location} must be an ISO-8601 date") from exc


def deep_merge(base: Any, update: Any) -> Any:
    if not isinstance(base, dict) or not isinstance(update, dict):
        return update
    merged = dict(base)
    for key, value in update.items():
        merged[key] = deep_merge(merged.get(key), value) if key in merged else value
    return merged


def contains_offsite_change(value: Any, key: str = "") -> bool:
    normalized_key = re.sub(r"[^a-z0-9]", "", key.lower())
    if isinstance(value, dict):
        return any(contains_offsite_change(child, f"{key}.{child_key}" if key else str(child_key)) for child_key, child in value.items())
    if isinstance(value, list):
        return any(contains_offsite_change(child, key) for child in value)
    false_values = (False, 0, "false", "FALSE", "0", None)
    true_values = (True, 1, "true", "TRUE", "1")
    if ("offamazon" in normalized_key or "offsite" in normalized_key) and value not in false_values:
        return True
    if (
        "amazononly" in normalized_key
        or "reachtoamazon" in normalized_key
        or "reachonamazon" in normalized_key
    ) and value not in true_values:
        return True
    if normalized_key in {"onsitescope", "placementscope", "reachscope", "scopeafter"}:
        return str(value).upper() != "AMAZON_ONLY"
    if normalized_key in {"offamazon", "offsite", "offsiteenabled"} and value not in (False, 0, "false", "FALSE", None):
        return True
    if isinstance(value, str):
        normalized_value = re.sub(r"[^A-Z0-9]", "", value.upper())
        return any(token in normalized_value for token in ("OFFSITE", "OFFAMAZON", "BEYONDAMAZON", "EXTERNALSITE", "PARTNERSITE", "THIRDPARTY", "AMAZONANDPARTNER"))
    return False


def contains_amazon_only_assertion(value: Any, key: str = "") -> bool:
    normalized_key = re.sub(r"[^a-z0-9]", "", key.lower())
    if isinstance(value, dict):
        return any(contains_amazon_only_assertion(child, f"{key}.{child_key}" if key else str(child_key)) for child_key, child in value.items())
    if isinstance(value, list):
        return any(contains_amazon_only_assertion(child, key) for child in value)
    if (
        "amazononly" in normalized_key
        or "reachtoamazon" in normalized_key
        or "reachonamazon" in normalized_key
    ) and value in (True, 1, "true", "TRUE", "1"):
        return True
    return False


def unrecognized_scope_fields(value: Any, path: str = "") -> list[str]:
    """Find reach/supply/inventory fields that are outside the closed contract."""
    findings: list[str] = []
    if isinstance(value, dict):
        for raw_key, child in value.items():
            child_path = f"{path}.{raw_key}" if path else str(raw_key)
            normalized_key = re.sub(r"[^a-z0-9]", "", str(raw_key).lower())
            known_scope_key = (
                "offamazon" in normalized_key
                or "offsite" in normalized_key
                or "amazononly" in normalized_key
                or "reachtoamazon" in normalized_key
                or "reachonamazon" in normalized_key
                or normalized_key in {"onsitescope", "placementscope", "reachscope", "scopeafter"}
            )
            suspicious_unknown = (
                "reach" in normalized_key
                or "external" in normalized_key
                or "partnersite" in normalized_key
                or "publisher" in normalized_key
                or "supplysource" in normalized_key
                or "inventoryscope" in normalized_key
            )
            if suspicious_unknown and not known_scope_key:
                findings.append(child_path)
            findings.extend(unrecognized_scope_fields(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            findings.extend(unrecognized_scope_fields(child, f"{path}[{index}]"))
    return findings


def structured_offsite_plan_fields(value: Any, path: str = "") -> list[str]:
    """Find structured delivery/reach controls without scanning explanatory prose."""
    findings: list[str] = []
    if isinstance(value, dict):
        for raw_key, child in value.items():
            child_path = f"{path}.{raw_key}" if path else str(raw_key)
            normalized_key = re.sub(r"[^a-z0-9]", "", str(raw_key).lower())
            known_scope_key = (
                "offamazon" in normalized_key
                or "offsite" in normalized_key
                or "amazononly" in normalized_key
                or "reachtoamazon" in normalized_key
                or "reachonamazon" in normalized_key
                or normalized_key in {"onsitescope", "placementscope", "reachscope", "scopeafter"}
            )
            suspicious_structured_key = (
                "reach" in normalized_key
                or "external" in normalized_key
                or "partnersite" in normalized_key
                or "publisher" in normalized_key
                or "supplysource" in normalized_key
                or "inventoryscope" in normalized_key
                or normalized_key in {
                    "deliverynetwork",
                    "deliveryscope",
                    "adnetwork",
                    "networkscope",
                    "publishernetwork",
                    "placementnetwork",
                }
            )
            if known_scope_key:
                if contains_offsite_change(child, str(raw_key)):
                    findings.append(child_path)
            elif suspicious_structured_key:
                findings.append(child_path)
            findings.extend(structured_offsite_plan_fields(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            findings.extend(structured_offsite_plan_fields(child, f"{path}[{index}]"))
    return findings


def unallowed_change_payload_fields(value: Any, path: str = "", parent_key: str = "") -> list[str]:
    """Return payload paths outside the closed normalized Amazon Ads schema."""
    findings: list[str] = []
    if isinstance(value, dict):
        for raw_key, child in value.items():
            child_path = f"{path}.{raw_key}" if path else str(raw_key)
            normalized_key = re.sub(r"[^a-z0-9]", "", str(raw_key).lower())
            if normalized_key not in CHANGE_PAYLOAD_ALLOWED_KEYS or (
                normalized_key in CHANGE_PAYLOAD_CONTEXTS
                and parent_key not in CHANGE_PAYLOAD_CONTEXTS[normalized_key]
            ):
                findings.append(child_path)
            findings.extend(unallowed_change_payload_fields(child, child_path, normalized_key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            findings.extend(unallowed_change_payload_fields(child, f"{path}[{index}]", parent_key))
    return findings


def normalized_payload_root_keys(value: dict[str, Any]) -> set[str]:
    return {re.sub(r"[^a-z0-9]", "", str(key).lower()) for key in value}


def payload_scalar_semantics_invalid(value: Any, key: str = "", parent_key: str = "") -> bool:
    """Validate every allowed normalized payload field with a closed value schema."""
    normalized_key = re.sub(r"[^a-z0-9]", "", key.lower())
    normalized_parent = re.sub(r"[^a-z0-9]", "", parent_key.lower())

    def children_invalid(mapping: dict[str, Any], parent: str) -> bool:
        return any(
            payload_scalar_semantics_invalid(child, str(child_key), parent)
            for child_key, child in mapping.items()
        )

    if not normalized_key:
        return not isinstance(value, dict) or children_invalid(value, "")

    if normalized_key in {"campaignid", "adgroupid", "targetid", "keywordid", "producttargetid"}:
        return not nonplaceholder(value)
    if normalized_key in {"name", "keywordtext", "negativekeywordtext", "bidstrategy"}:
        return not nonplaceholder(value)
    if normalized_key == "strategy":
        return normalized_parent not in {"bidding", "dynamicbidding"} or not nonplaceholder(value)
    if normalized_key in {"state", "status"}:
        return not is_allowed(value, {"ABSENT", "ENABLED", "PAUSED", "ARCHIVED", "REMOVED"})
    if normalized_key == "adproduct":
        return not is_allowed(value, set(TARGETING_TYPES_BY_AD_PRODUCT))
    if normalized_key == "targetingtype":
        return not is_allowed(value, set().union(*TARGETING_TYPES_BY_AD_PRODUCT.values()))
    if normalized_key == "matchtype":
        return not is_allowed(value, {"BROAD", "PHRASE", "EXACT", "NEGATIVE_EXACT", "NEGATIVE_PHRASE"})
    if normalized_key == "budgettype":
        return not is_allowed(value, {"DAILY", "LIFETIME"})
    if normalized_key == "currencycode":
        return not (isinstance(value, str) and re.fullmatch(r"[A-Z]{3}", value.upper()) is not None)
    if normalized_key in {"startdate", "enddate"}:
        try:
            parse_iso_date(value, key)
        except ValueError:
            return True
        return False
    if normalized_key in {"onsitescope", "placementscope", "reachscope", "scopeafter"}:
        return value != "AMAZON_ONLY"
    if normalized_key in {"offamazonenabled", "offsiteenabled", "isoffamazon"}:
        return value is not False
    if normalized_key == "enabled":
        if normalized_parent in {"amazononly", "limitreachtoamazon", "reachonamazononly"}:
            return value is not True
        if normalized_parent in {"offamazon", "offamazonsettings", "offsite", "offsitesettings"}:
            return value is not False
        return True
    if normalized_key in {"amazononly", "limitreachtoamazon", "reachonamazononly"}:
        if isinstance(value, bool):
            return value is not True
        return not isinstance(value, dict) or set(normalized_payload_root_keys(value)) != {"enabled"} or children_invalid(value, normalized_key)
    if normalized_key in {"offamazon", "offsite"}:
        if isinstance(value, bool):
            return value is not False
        return not isinstance(value, dict) or set(normalized_payload_root_keys(value)) != {"enabled"} or children_invalid(value, normalized_key)
    if normalized_key in {"offamazonsettings", "offsitesettings"}:
        return not isinstance(value, dict) or set(normalized_payload_root_keys(value)) != {"enabled"} or children_invalid(value, normalized_key)
    if normalized_key == "offamazonplacements":
        return not isinstance(value, list) or bool(value)
    if normalized_key == "asins":
        return not (
            isinstance(value, list)
            and bool(value)
            and all(isinstance(item, str) and re.fullmatch(r"[A-Z0-9]{10}", item.upper()) is not None for item in value)
        )
    if normalized_key in {"asinsameas", "asin"}:
        return not (isinstance(value, str) and re.fullmatch(r"[A-Z0-9]{10}", value.upper()) is not None)
    if normalized_key == "categorysameas":
        return not (isinstance(value, (str, int)) and not isinstance(value, bool) and bool(str(value).strip()))
    if normalized_key in {"targetingexpression", "negativeexpression"}:
        return not isinstance(value, dict) or not value or children_invalid(value, normalized_key)
    if normalized_key in {"bidding", "dynamicbidding"}:
        return not isinstance(value, dict) or set(normalized_payload_root_keys(value)) != {"strategy"} or children_invalid(value, normalized_key)
    if normalized_key == "placementadjustments":
        allowed_adjustments = {"topofsearchpercentage", "productpagepercentage", "restofsearchpercentage", "otheronamazonpercentage"}
        child_keys = normalized_payload_root_keys(value) if isinstance(value, dict) else set()
        return not isinstance(value, dict) or not child_keys or not child_keys <= allowed_adjustments or children_invalid(value, normalized_key)
    if normalized_key in {"budget", "dailybudget", "budgetamount"}:
        if isinstance(value, dict):
            child_keys = normalized_payload_root_keys(value)
            return (
                not value
                or "amount" not in child_keys
                or not child_keys <= {"amount", "currencycode", "budgettype"}
                or children_invalid(value, normalized_key)
            )
        try:
            budget = as_decimal(value, key)
        except ValueError:
            return True
        return budget is None or budget < 0
    if normalized_key in {"bid", "defaultbid", "amount"}:
        try:
            amount = as_decimal(value, key)
        except ValueError:
            return True
        return amount is None or amount < 0
    if normalized_key in {"topofsearchpercentage", "productpagepercentage", "restofsearchpercentage", "otheronamazonpercentage"}:
        try:
            percentage = as_decimal(value, key)
        except ValueError:
            return True
        return percentage is None or percentage < 0
    return True


def change_payload_semantic_issues(
    action: Any,
    entity_type: Any,
    current_value: dict[str, Any],
    proposed_value: dict[str, Any],
    strategy_currency: Any = None,
) -> list[tuple[str, str]]:
    """Validate action/entity/root-field compatibility for normalized payloads."""
    issues: list[tuple[str, str]] = []
    if not is_allowed(action, ALLOWED_AD_ACTIONS) or not is_allowed(entity_type, ALLOWED_AD_ENTITY_TYPES):
        return issues
    if entity_type not in CHANGE_ACTION_ENTITY_TYPES.get(action, set()):
        issues.append(("CHANGE_ACTION_ENTITY_MISMATCH", f"{action} is not supported for {entity_type}"))
        return issues

    identity_fields = CHANGE_ENTITY_ID_FIELDS.get(entity_type, set())
    mutable_fields = CHANGE_ENTITY_MUTABLE_FIELDS.get(entity_type, set())
    allowed_fields = identity_fields | mutable_fields
    def normalized_map(payload: dict[str, Any]) -> dict[str, Any]:
        return {re.sub(r"[^a-z0-9]", "", str(key).lower()): value for key, value in payload.items()}

    def normalized_values(payload: Any, wanted_key: str) -> list[Any]:
        values: list[Any] = []
        if isinstance(payload, dict):
            for raw_key, child in payload.items():
                if re.sub(r"[^a-z0-9]", "", str(raw_key).lower()) == wanted_key:
                    values.append(child)
                values.extend(normalized_values(child, wanted_key))
        elif isinstance(payload, list):
            for child in payload:
                values.extend(normalized_values(child, wanted_key))
        return values

    def product_expression_issue(payload: dict[str, Any], product_entity: str) -> bool:
        payload_map = normalized_map(payload)
        representation_keys = (
            {"asin", "asins", "targetingexpression"}
            if product_entity in {"PRODUCT_TARGET", "TARGET"}
            else {"asin", "asins", "negativeexpression"}
        )
        present = representation_keys.intersection(payload_map)
        if len(present) > 1:
            return True
        expression_key = next((key for key in ("targetingexpression", "negativeexpression") if key in present), None)
        if expression_key is None:
            return False
        expression = payload_map[expression_key]
        if not isinstance(expression, dict):
            return True
        expression_keys = normalized_payload_root_keys(expression)
        return len(expression) != 1 or len(expression_keys) != 1

    current_keys = normalized_payload_root_keys(current_value)
    proposed_keys = normalized_payload_root_keys(proposed_value)
    if len(current_keys) != len(current_value) or len(proposed_keys) != len(proposed_value):
        issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Normalized payload keys must be unique after case and punctuation normalization"))
        return issues
    current_map = normalized_map(current_value)
    proposed_map = normalized_map(proposed_value)
    final_value = deep_merge(current_value, proposed_value)
    final_keys = normalized_payload_root_keys(final_value)
    if len(final_keys) != len(final_value):
        issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Current and proposed payloads cannot create duplicate normalized keys in the merged final state"))
    if not current_keys <= allowed_fields or not proposed_keys <= allowed_fields:
        issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Payload fields do not belong to the declared Amazon Ads entity type"))
        return issues

    current_changes = current_keys - identity_fields
    proposed_changes = proposed_keys - identity_fields
    if action == "UPDATE":
        if not proposed_changes or not proposed_changes <= current_changes:
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "UPDATE requires proposed mutable fields with matching exact current-state fields"))
        if proposed_changes.intersection({"state", "status"}):
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "UPDATE cannot mutate state/status; use the dedicated ENABLE, PAUSE, or ARCHIVE action"))
    elif action in {"ENABLE", "PAUSE", "ARCHIVE"}:
        state_fields = {"state", "status"}
        expected = {"ENABLE": "ENABLED", "PAUSE": "PAUSED", "ARCHIVE": "ARCHIVED"}[action]
        if not proposed_changes or not proposed_changes <= state_fields or not current_changes <= state_fields:
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", f"{action} may change only state/status fields"))
        else:
            proposed_states = [value for key, value in proposed_value.items() if re.sub(r"[^a-z0-9]", "", str(key).lower()) in state_fields]
            if not proposed_states or any(not isinstance(value, str) or value.upper() != expected for value in proposed_states):
                issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", f"{action} requires normalized proposed state/status={expected}"))
    elif action in {"CREATE", "ADD_NEGATIVE"}:
        state_values = [value for key, value in current_value.items() if re.sub(r"[^a-z0-9]", "", str(key).lower()) in {"state", "status"}]
        if current_changes - {"state", "status"} or not state_values or any(not isinstance(value, str) or value.upper() != "ABSENT" for value in state_values):
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", f"{action} current_value must be normalized as state/status=ABSENT"))
        required = CHANGE_CREATE_REQUIRED_FIELDS.get(entity_type, set())
        if not required <= proposed_keys:
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", f"{action} proposed_value is missing required normalized entity fields"))
        if entity_type in {"PRODUCT_TARGET", "NEGATIVE_PRODUCT_TARGET"} and not ({"asin", "asins", "targetingexpression", "negativeexpression"} & proposed_keys):
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", f"{action} product target requires an exact normalized ASIN expression"))
        if entity_type == "NEGATIVE_KEYWORD" and not ({"negativekeywordtext", "keywordtext"} & proposed_keys):
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "ADD_NEGATIVE keyword requires exact normalized keyword text"))
    elif action == "REMOVE_NEGATIVE":
        state_fields = {"state", "status"}
        proposed_states = [value for key, value in proposed_value.items() if re.sub(r"[^a-z0-9]", "", str(key).lower()) in state_fields]
        if not proposed_states or any(not isinstance(value, str) or value.upper() != "REMOVED" for value in proposed_states) or proposed_changes - state_fields:
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "REMOVE_NEGATIVE may only set normalized state/status=REMOVED"))

    if entity_type == "CAMPAIGN" and action in {"CREATE", "UPDATE"}:
        if action == "UPDATE" and proposed_changes.intersection({"adproduct", "targetingtype"}):
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Campaign adProduct and targetingType are CREATE-only in a prepared manifest; rebuild and revalidate the campaign architecture instead"))
        if action == "CREATE":
            effective_ad_product = proposed_map.get("adproduct", current_map.get("adproduct"))
            effective_targeting_type = proposed_map.get("targetingtype", current_map.get("targetingtype"))
            allowed_targeting_types = TARGETING_TYPES_BY_AD_PRODUCT.get(effective_ad_product, set()) if isinstance(effective_ad_product, str) else set()
            if not is_allowed(effective_targeting_type, allowed_targeting_types):
                issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Campaign CREATE requires a canonical adProduct and compatible targetingType"))

    match_types = [value for payload in (current_value, proposed_value) for value in normalized_values(payload, "matchtype")]
    if entity_type == "KEYWORD" and any(not is_allowed(value, {"BROAD", "PHRASE", "EXACT"}) for value in match_types):
        issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Positive KEYWORD operations allow only BROAD, PHRASE, or EXACT matchType"))
    if entity_type == "NEGATIVE_KEYWORD" and any(not is_allowed(value, {"NEGATIVE_EXACT", "NEGATIVE_PHRASE"}) for value in match_types):
        issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "NEGATIVE_KEYWORD operations allow only NEGATIVE_EXACT or NEGATIVE_PHRASE matchType"))

    if entity_type in {"PRODUCT_TARGET", "NEGATIVE_PRODUCT_TARGET", "TARGET"}:
        if any(product_expression_issue(payload, entity_type) for payload in (current_value, proposed_value, final_value)):
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Product targeting uses exactly one canonical ASIN representation and exactly one expression predicate"))

    final_map = normalized_map(final_value)
    if "startdate" in final_map and "enddate" in final_map:
        try:
            if parse_iso_date(final_map["startdate"], "startDate") > parse_iso_date(final_map["enddate"], "endDate"):
                issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Campaign startDate cannot be later than endDate"))
        except ValueError:
            pass

    for payload in (current_value, proposed_value, final_value):
        payload_map = normalized_map(payload)
        if "state" in payload_map and "status" in payload_map and payload_map["state"] != payload_map["status"]:
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "state and status cannot contradict each other in one normalized payload state"))
            break

    if isinstance(strategy_currency, str) and strategy_currency:
        currency_values = [value for payload in (current_value, proposed_value) for value in normalized_values(payload, "currencycode")]
        if any(not isinstance(value, str) or value.upper() != strategy_currency.upper() for value in currency_values):
            issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Payload currencyCode must match the strategy package currency"))

    if payload_scalar_semantics_invalid(current_value) or payload_scalar_semantics_invalid(proposed_value):
        issues.append(("CHANGE_PAYLOAD_SEMANTICS_INVALID", "Payload contains an invalid normalized scalar value"))
    return issues


def _validate(data: dict[str, Any]) -> dict[str, Any]:
    findings: list[Finding] = []
    runtime_now = datetime.now(timezone.utc)

    def add(severity: str, code: str, location: str, message: str) -> None:
        findings.append(Finding(severity, code, location, message))

    def number(value: Any, location: str) -> Decimal | None:
        try:
            return as_decimal(value, location)
        except ValueError as exc:
            add("ERROR", "NUMERIC_INVALID", location, str(exc))
            return None

    def timestamp(value: Any, location: str) -> datetime | None:
        try:
            return parse_aware_timestamp(value, location)
        except ValueError as exc:
            add("ERROR", "TIMESTAMP_INVALID", location, str(exc))
            return None

    if data.get("contract_version") != "1.0":
        add("ERROR", "CONTRACT_VERSION_INVALID", "contract_version", "contract_version must be 1.0")

    status = data.get("strategy_status")
    if not is_allowed(status, STRATEGY_STATUSES):
        add("ERROR", "STRATEGY_STATUS_INVALID", "strategy_status", "Unknown strategy status")
    traffic_ready_status = is_allowed(status, {"PLAN_READY", "READY_FOR_EXECUTION_REVIEW", "EXECUTION_AUTHORIZED"})

    def gap(code: str, location: str, message: str) -> None:
        add("ERROR" if traffic_ready_status else "WARNING", code, location, message)

    lineage_mode = data.get("lineage_mode")
    if not is_allowed(lineage_mode, {"FULL_WORKFLOW", "INDEPENDENT_EXISTING", "INDEPENDENT_NEW"}):
        add("ERROR", "LINEAGE_MODE_INVALID", "lineage_mode", "Use FULL_WORKFLOW, INDEPENDENT_EXISTING, or INDEPENDENT_NEW")

    strategy_mode = data.get("strategy_mode")
    if not is_allowed(strategy_mode, STRATEGY_MODES):
        add("ERROR", "STRATEGY_MODE_INVALID", "strategy_mode", "Unknown strategy mode")
    if lineage_mode == "INDEPENDENT_EXISTING" and strategy_mode != "EXISTING_PRODUCT_OPTIMIZATION":
        add("ERROR", "INDEPENDENT_MODE_MISMATCH", "lineage_mode", "INDEPENDENT_EXISTING is only for existing-product work")
    if lineage_mode == "INDEPENDENT_NEW" and strategy_mode != "NEW_PRODUCT_LAUNCH":
        add("ERROR", "INDEPENDENT_MODE_MISMATCH", "lineage_mode", "INDEPENDENT_NEW is only for new-product work")

    deliverable_mode = data.get("deliverable_mode")
    if not is_allowed(deliverable_mode, DELIVERABLE_MODES):
        add("ERROR", "DELIVERABLE_MODE_INVALID", "deliverable_mode", "Unknown deliverable mode")
    execution_authority = data.get("execution_authority")
    if not is_allowed(execution_authority, EXECUTION_AUTHORITIES):
        add("ERROR", "EXECUTION_AUTHORITY_INVALID", "execution_authority", "Unknown execution authority")

    strategy_bearing_zones = (
        "economics",
        "inventory",
        "onsite_support",
        "keyword_targets",
        "product_targets",
        "campaign_architecture",
        "routing_rules",
        "phase_plan",
        "decision_rules",
        "review_compliance",
        "handbacks",
        "change_manifest",
    )
    for zone in strategy_bearing_zones:
        suspicious_paths = sorted(set(structured_offsite_plan_fields(data.get(zone), zone)))
        if suspicious_paths:
            add(
                "ERROR",
                "OFFSITE_PLAN_FIELD_INVALID",
                zone,
                f"Structured off-Amazon or unknown delivery/reach controls fail closed: {', '.join(suspicious_paths)}",
            )

    if lineage_mode == "FULL_WORKFLOW":
        for field in UPSTREAM_IDS:
            if not nonplaceholder(data.get(field)):
                gap("STABLE_ID_GAP", field, f"A real {field} is required before traffic-plan readiness")
    else:
        independent = require_dict(data.get("independent_scope", {}), add, "INDEPENDENT_SCOPE_INVALID", "independent_scope")
        for field in ("reason", "source_scope_id"):
            if not nonplaceholder(independent.get(field)):
                add("ERROR", "INDEPENDENT_SCOPE_MISSING", f"independent_scope.{field}", f"{field} is required")
        source_ids = independent.get("source_artifact_ids")
        if not isinstance(source_ids, list) or not source_ids:
            add("ERROR", "INDEPENDENT_SOURCES_MISSING", "independent_scope.source_artifact_ids", "Independent scope requires traceable source artifacts")
    for field in AD_IDS:
        if not nonplaceholder(data.get(field)):
            add("ERROR", "AD_ID_MISSING", field, f"{field} is required")

    aliases = require_list(data.get("id_aliases", []), add, "ID_ALIASES_INVALID", "id_aliases")
    for index, row in enumerate(aliases):
        location = f"id_aliases[{index}]"
        if not isinstance(row, dict):
            add("ERROR", "ID_ALIAS_INVALID", location, "Alias row must be an object")
            continue
        if row.get("canonical_field") == "selection_run_id" and row.get("verified_same_identity") is not True:
            add("ERROR", "ID_ALIAS_UNVERIFIED", location, "run_id to selection_run_id mapping must be explicitly verified")
        canonical_field = row.get("canonical_field")
        canonical_field_valid = isinstance(canonical_field, str) and canonical_field in data
        if not isinstance(canonical_field, str):
            add("ERROR", "ID_ALIAS_FIELD_INVALID", location, "canonical_field must be a string")
        canonical_value = data.get(canonical_field) if canonical_field_valid else None
        if canonical_field_valid and row.get("source_value") != canonical_value:
            severity = "ERROR" if nonplaceholder(canonical_value) or traffic_ready_status else "WARNING"
            add(severity, "ID_ALIAS_MISMATCH", location, "Alias source value does not match the canonical top-level ID")

    source_artifacts = require_list(data.get("source_artifacts", []), add, "SOURCE_ARTIFACTS_INVALID", "source_artifacts")
    source_artifact_ids: set[str] = set()
    source_artifact_by_id: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(source_artifacts):
        location = f"source_artifacts[{index}]"
        if not isinstance(row, dict):
            add("ERROR", "SOURCE_ARTIFACT_INVALID", location, "Source artifact must be an object")
            continue
        source_id = row.get("source_artifact_id")
        if not nonplaceholder(source_id):
            add("ERROR", "SOURCE_ARTIFACT_ID_MISSING", location, "source_artifact_id is required")
        elif source_id in source_artifact_ids:
            add("ERROR", "SOURCE_ARTIFACT_ID_DUPLICATE", location, f"Duplicate source artifact ID {source_id!r}")
        else:
            source_artifact_ids.add(source_id)
            source_artifact_by_id[source_id] = row
        for field in ("artifact_type", "path_or_url", "version_or_captured_at"):
            if not nonplaceholder(row.get(field)):
                add("ERROR", "SOURCE_ARTIFACT_FIELD_MISSING", location, f"{field} is required")
        sha256 = row.get("sha256")
        if not isinstance(sha256, str) or re.fullmatch(r"sha256:[0-9a-fA-F]{64}", sha256) is None:
            add("ERROR", "SOURCE_ARTIFACT_HASH_INVALID", location, "sha256 must be a canonical 64-hex digest")
        if not is_allowed(row.get("data_class"), SOURCE_DATA_CLASSES):
            add("ERROR", "SOURCE_DATA_CLASS_INVALID", location, "Unknown source data_class")
        for field in ("marketplace", "currency", "account_id_masked", "scope_id"):
            if field in row and not nonplaceholder(row.get(field)):
                add("ERROR", "SOURCE_ARTIFACT_SCOPE_FIELD_INVALID", f"{location}.{field}", f"Optional source scope field {field} must be a non-placeholder string when supplied")
        evidence_domains = row.get("evidence_domains", [])
        if not isinstance(evidence_domains, list):
            add("ERROR", "SOURCE_EVIDENCE_DOMAINS_INVALID", location, "evidence_domains must be an array when supplied")
        else:
            normalized_domains = {str(domain) for domain in evidence_domains}
            unknown_domains = normalized_domains - ALL_EVIDENCE_DOMAINS
            if unknown_domains:
                add("ERROR", "SOURCE_EVIDENCE_DOMAIN_UNKNOWN", location, f"Unknown evidence domains: {', '.join(sorted(unknown_domains))}")
            permitted_domains = SOURCE_DOMAIN_ARTIFACT_TYPES.get(str(row.get("artifact_type")), set())
            unsupported_domains = normalized_domains - permitted_domains
            if unsupported_domains:
                add("ERROR", "SOURCE_EVIDENCE_DOMAIN_TYPE_MISMATCH", location, "Artifact type cannot support one or more declared economics evidence domains")

    def validate_gap_rows(value: Any, location: str, invalid_code: str, blocking_code: str) -> None:
        if not isinstance(value, list):
            add("ERROR", invalid_code, location, f"{location} must be an array of structured gap records")
            return
        for index, row in enumerate(value):
            row_location = f"{location}[{index}]"
            if not isinstance(row, dict):
                add("ERROR", invalid_code, row_location, "Gap records must be structured objects, not free text")
                continue
            domain = row.get("domain")
            status_value = row.get("status")
            readiness_impact = row.get("readiness_impact")
            source_ids_value = row.get("source_ids")
            if not nonplaceholder(domain) or not is_allowed(status_value, {"RESOLVED", "ACCEPTED_NON_BLOCKING", "UNRESOLVED"}) or not is_allowed(readiness_impact, {"BLOCKING", "NON_BLOCKING"}):
                add("ERROR", invalid_code, row_location, "Gap records require domain, canonical status, and readiness_impact")
            if not isinstance(source_ids_value, list) or not source_ids_value or any(source_id not in source_artifact_ids for source_id in source_ids_value):
                add("ERROR", invalid_code, row_location, "Gap records require one or more known source artifact IDs")
            if status_value == "ACCEPTED_NON_BLOCKING" and readiness_impact != "NON_BLOCKING":
                add("ERROR", invalid_code, row_location, "Accepted non-blocking gaps must explicitly use NON_BLOCKING impact")
            if traffic_ready_status and (status_value == "UNRESOLVED" or readiness_impact == "BLOCKING"):
                add("ERROR", blocking_code, row_location, "Traffic readiness cannot carry an unresolved or blocking gap")

    if traffic_ready_status and "unknowns" not in data:
        add("ERROR", "READINESS_UNKNOWN_INVALID", "unknowns", "Traffic-ready packages require an explicit structured unknowns array, even when empty")
    unknowns = data.get("unknowns", [])
    validate_gap_rows(unknowns, "unknowns", "READINESS_UNKNOWN_INVALID", "READINESS_UNKNOWN_UNRESOLVED")
    source_coverage = data.get("source_coverage", {})
    if not isinstance(source_coverage, dict):
        add("ERROR", "SOURCE_COVERAGE_INVALID", "source_coverage", "source_coverage must be a structured object")
    else:
        allowed_source_coverage_fields = {"gaps", "covered_domains"}
        if any(str(field) not in allowed_source_coverage_fields for field in source_coverage):
            add("ERROR", "SOURCE_COVERAGE_INVALID", "source_coverage", "Unknown source-coverage fields fail closed")
        coverage_gaps = source_coverage.get("gaps")
        if traffic_ready_status and not isinstance(coverage_gaps, list):
            add("ERROR", "SOURCE_COVERAGE_INVALID", "source_coverage.gaps", "Traffic-ready source_coverage requires an explicit gaps array")
        elif coverage_gaps is not None:
            validate_gap_rows(coverage_gaps, "source_coverage.gaps", "SOURCE_COVERAGE_INVALID", "SOURCE_COVERAGE_BLOCKING_GAP")
        covered_domains = source_coverage.get("covered_domains")
        if covered_domains is not None and (not isinstance(covered_domains, list) or any(not nonplaceholder(value) for value in covered_domains)):
            add("ERROR", "SOURCE_COVERAGE_INVALID", "source_coverage.covered_domains", "covered_domains must be an array of non-placeholder domain IDs")

    if is_allowed(lineage_mode, {"INDEPENDENT_EXISTING", "INDEPENDENT_NEW"}):
        for source_id in data.get("independent_scope", {}).get("source_artifact_ids", []):
            if source_id not in source_artifact_ids:
                add("ERROR", "INDEPENDENT_SOURCE_UNKNOWN", "independent_scope.source_artifact_ids", f"Unknown source artifact ID {source_id!r}")

    for field in ("marketplace", "currency", "timezone", "captured_at"):
        if not nonplaceholder(data.get(field)):
            add("ERROR", "SCOPE_FIELD_MISSING", field, f"{field} is required")
    package_captured_at = timestamp(data.get("captured_at"), "captured_at") if nonempty(data.get("captured_at")) else None
    if traffic_ready_status and package_captured_at is not None:
        package_runtime_age = runtime_now - package_captured_at.astimezone(timezone.utc)
        if package_runtime_age < -MAX_CLOCK_SKEW or package_runtime_age > MAX_ACCOUNT_SNAPSHOT_AGE:
            add("ERROR", "PACKAGE_SNAPSHOT_NOT_CURRENT", "captured_at", "Traffic-ready packages must be captured within the validator's 24-hour runtime safety window")

    def verify_source_freshness(source: dict[str, Any], location: str, maximum_age: timedelta, code: str) -> None:
        source_time = timestamp(source.get("version_or_captured_at"), f"{location}.version_or_captured_at")
        if package_captured_at is None or source_time is None:
            return
        age = package_captured_at - source_time
        if age < timedelta(0) or age > maximum_age:
            add("ERROR", code, location, "Source artifact is outside the validator's allowed freshness window")
    scope = require_dict(data.get("scope", {}), add, "SCOPE_INVALID", "scope")
    if not any(nonempty(scope.get(field)) for field in ("asin", "sku", "offer_scope")):
        add("ERROR", "ADVERTISED_ENTITY_MISSING", "scope", "ASIN, SKU, or an explicit offer_scope is required")
    if traffic_ready_status and not nonplaceholder(scope.get("account_id_masked")):
        add("ERROR", "ACCOUNT_SCOPE_IDENTITY_MISSING", "scope.account_id_masked", "Traffic-ready work requires a non-placeholder masked account identity")
    if strategy_mode == "NEW_PRODUCT_LAUNCH" and traffic_ready_status:
        for field in ("asin", "sku"):
            if not nonplaceholder(scope.get(field)):
                add("ERROR", "NEW_PRODUCT_IDENTITY_NOT_READY", f"scope.{field}", f"A traffic-ready new-product plan requires a real {field}")
    valid_scope_ids = {value for value in (scope.get("sku"), scope.get("asin")) if nonplaceholder(value)}

    operating_context_raw = data.get("operating_context")
    operating_context: dict[str, Any] = {}
    operating_context_id: Any = None
    computed_operating_context_hash: str | None = None
    if operating_context_raw is not None:
        operating_context = require_dict(operating_context_raw, add, "OPERATING_CONTEXT_INVALID", "operating_context")
        operating_context_id = operating_context.get("context_id")
        if not nonplaceholder(operating_context_id):
            add("ERROR", "OPERATING_CONTEXT_ID_MISSING", "operating_context.context_id", "A supplied operating_context requires a stable context_id")
        if operating_context:
            try:
                computed_operating_context_hash = operating_context_sha256(operating_context)
            except (TypeError, ValueError) as exc:
                add("ERROR", "OPERATING_CONTEXT_HASH_INPUT_INVALID", "operating_context", f"Operating context cannot be canonicalized: {exc}")
        supplied_context_hash = data.get("operating_context_sha256")
        if supplied_context_hash != computed_operating_context_hash:
            add(
                "ERROR" if traffic_ready_status or supplied_context_hash is not None else "WARNING",
                "OPERATING_CONTEXT_HASH_MISMATCH",
                "operating_context_sha256",
                "operating_context_sha256 must match canonical operating_context content",
            )
    elif traffic_ready_status and lineage_mode == "FULL_WORKFLOW":
        add("ERROR", "OPERATING_CONTEXT_MISSING", "operating_context", "A traffic-ready full-workflow plan must preserve the upstream operating_context envelope")
    elif data.get("operating_context_sha256") is not None:
        add("ERROR", "OPERATING_CONTEXT_HASH_WITHOUT_CONTEXT", "operating_context_sha256", "A context hash cannot be supplied without operating_context")

    if operating_context:
        def context_string_list(value: Any, location: str, *, required: bool = False) -> list[str]:
            if not isinstance(value, list) or any(not nonempty(item) for item in value):
                add("ERROR", "OPERATING_CONTEXT_STRING_LIST_INVALID", location, "Value must be an array of non-empty strings")
                return []
            normalized = [item.strip() for item in value]
            if required and not normalized:
                add("ERROR", "OPERATING_CONTEXT_STRING_LIST_EMPTY", location, "Value must not be empty")
            return normalized

        profit = operating_context.get("profit_objective", {})
        if not isinstance(profit, dict):
            add("ERROR", "PROFIT_OBJECTIVE_INVALID", "operating_context.profit_objective", "profit_objective must be an object")
            profit = {}
        margin_floor = number(
            profit.get("minimum_post_ads_contribution_rate"),
            "operating_context.profit_objective.minimum_post_ads_contribution_rate",
        )
        if margin_floor is not None and (margin_floor < 0 or margin_floor > 1):
            add("ERROR", "PROFIT_FLOOR_RATE_INVALID", "operating_context.profit_objective.minimum_post_ads_contribution_rate", "Contribution rate must be between 0 and 1")
        for field in ("target_profit_per_order", "risk_buffer_per_order"):
            amount = number(profit.get(field), f"operating_context.profit_objective.{field}")
            if amount is not None and amount < 0:
                add("ERROR", "PROFIT_FLOOR_AMOUNT_INVALID", f"operating_context.profit_objective.{field}", f"{field} cannot be negative")
        canonical_basis = profit.get("contribution_rate_basis")
        legacy_basis = profit.get("rate_basis")
        if legacy_basis is not None:
            if canonical_basis is not None and canonical_basis != legacy_basis:
                add("ERROR", "CONTRIBUTION_RATE_BASIS_CONFLICT", "operating_context.profit_objective", "contribution_rate_basis conflicts with legacy rate_basis")
            else:
                add("WARNING", "LEGACY_CONTRIBUTION_RATE_BASIS", "operating_context.profit_objective.rate_basis", "Legacy rate_basis was accepted; new outputs must use contribution_rate_basis")
                canonical_basis = legacy_basis
        if canonical_basis is not None and canonical_basis != "NET_SALES_REVENUE":
            add("ERROR", "CONTRIBUTION_RATE_BASIS_INVALID", "operating_context.profit_objective.contribution_rate_basis", "contribution_rate_basis must be NET_SALES_REVENUE")
        if margin_floor is not None and canonical_basis != "NET_SALES_REVENUE":
            add("ERROR", "CONTRIBUTION_RATE_BASIS_MISSING", "operating_context.profit_objective.contribution_rate_basis", "A rate-based profit floor requires contribution_rate_basis=NET_SALES_REVENUE")

        price_context = operating_context.get("price_context", {})
        if not isinstance(price_context, dict):
            add("ERROR", "PRICE_CONTEXT_INVALID", "operating_context.price_context", "price_context must be an object")
            price_context = {}
        current_price = price_context.get("current_observed")
        if current_price is not None:
            if not isinstance(current_price, dict):
                add("ERROR", "CURRENT_PRICE_INVALID", "operating_context.price_context.current_observed", "current_observed must be an object or null")
            else:
                current_amount = number(current_price.get("amount"), "operating_context.price_context.current_observed.amount")
                if current_amount is not None and current_amount < 0:
                    add("ERROR", "CURRENT_PRICE_AMOUNT_INVALID", "operating_context.price_context.current_observed.amount", "Observed price cannot be negative")
                if current_price.get("currency") != data.get("currency"):
                    add("ERROR", "CURRENT_PRICE_CURRENCY_MISMATCH", "operating_context.price_context.current_observed.currency", "Observed price currency must match the strategy")
                timestamp(current_price.get("observed_at"), "operating_context.price_context.current_observed.observed_at")
                context_string_list(current_price.get("evidence_ids"), "operating_context.price_context.current_observed.evidence_ids", required=True)
                if current_price.get("verification_status") != "OBSERVED":
                    add("ERROR", "CURRENT_PRICE_STATUS_INVALID", "operating_context.price_context.current_observed.verification_status", "current_observed must use OBSERVED")
        planned_phases = price_context.get("planned_phases", [])
        if not isinstance(planned_phases, list):
            add("ERROR", "PLANNED_PRICE_PHASES_INVALID", "operating_context.price_context.planned_phases", "planned_phases must be an array")
            planned_phases = []
        for index, phase in enumerate(planned_phases):
            location = f"operating_context.price_context.planned_phases[{index}]"
            if not isinstance(phase, dict):
                add("ERROR", "PLANNED_PRICE_PHASE_INVALID", location, "planned price phase must be an object")
                continue
            if not nonplaceholder(phase.get("phase_id")):
                add("ERROR", "PLANNED_PRICE_PHASE_ID_MISSING", f"{location}.phase_id", "phase_id is required")
            if phase.get("verification_status") != "PLANNED_UNVERIFIED":
                add("ERROR", "PLANNED_PRICE_STATUS_INVALID", f"{location}.verification_status", "planned price must remain PLANNED_UNVERIFIED")
            intended_price = phase.get("intended_price")
            if not isinstance(intended_price, dict):
                add("ERROR", "PLANNED_PRICE_INVALID", f"{location}.intended_price", "intended_price must be an object")
            else:
                intended_amount = number(intended_price.get("amount"), f"{location}.intended_price.amount")
                if intended_amount is not None and intended_amount < 0:
                    add("ERROR", "PLANNED_PRICE_AMOUNT_INVALID", f"{location}.intended_price.amount", "Planned price cannot be negative")
                if intended_price.get("currency") != data.get("currency"):
                    add("ERROR", "PLANNED_PRICE_CURRENCY_MISMATCH", f"{location}.intended_price.currency", "Planned price currency must match the strategy")
            context_string_list(phase.get("evidence_ids"), f"{location}.evidence_ids", required=True)

        current_stage = operating_context.get("current_stage")
        if current_stage is not None:
            if not isinstance(current_stage, dict):
                add("ERROR", "CURRENT_STAGE_INVALID", "operating_context.current_stage", "current_stage must be an object or null")
            else:
                if not nonplaceholder(current_stage.get("stage_id")):
                    add("ERROR", "CURRENT_STAGE_ID_MISSING", "operating_context.current_stage.stage_id", "stage_id is required")
                timestamp(current_stage.get("observed_at"), "operating_context.current_stage.observed_at")
                context_string_list(current_stage.get("evidence_ids"), "operating_context.current_stage.evidence_ids", required=True)
                if "planned_phase_id" in current_stage:
                    add("ERROR", "CURRENT_STAGE_USES_PLAN", "operating_context.current_stage.planned_phase_id", "A planned price phase cannot prove current stage")

        seasonality = operating_context.get("seasonality_context")
        if seasonality is not None:
            if not isinstance(seasonality, dict):
                add("ERROR", "SEASONALITY_CONTEXT_INVALID", "operating_context.seasonality_context", "seasonality_context must be an object or null")
            else:
                classification = seasonality.get("classification", "UNKNOWN")
                current_phase = seasonality.get("current_phase", "UNKNOWN")
                confidence = seasonality.get("confidence", "UNKNOWN")
                granularity = seasonality.get("source_granularity", "UNKNOWN")
                for field, value, allowed in (
                    ("classification", classification, SEASONALITY_CLASSIFICATIONS),
                    ("current_phase", current_phase, SEASONAL_PHASES),
                    ("confidence", confidence, SEASONAL_CONFIDENCE),
                    ("source_granularity", granularity, SEASONAL_GRANULARITIES),
                ):
                    if not is_allowed(value, allowed):
                        add("ERROR", "SEASONALITY_ENUM_INVALID", f"operating_context.seasonality_context.{field}", f"Invalid {field}")
                seasonal_evidence = context_string_list(seasonality.get("evidence_ids", []), "operating_context.seasonality_context.evidence_ids")
                if classification != "UNKNOWN" or current_phase != "UNKNOWN":
                    if not seasonal_evidence:
                        add("ERROR", "SEASONALITY_EVIDENCE_MISSING", "operating_context.seasonality_context.evidence_ids", "Non-UNKNOWN seasonality requires evidence IDs")
                    if not nonempty(seasonality.get("source_period")):
                        add("ERROR", "SEASONALITY_PERIOD_MISSING", "operating_context.seasonality_context.source_period", "Non-UNKNOWN seasonality requires source_period")
                    if granularity == "UNKNOWN":
                        add("ERROR", "SEASONALITY_GRANULARITY_MISSING", "operating_context.seasonality_context.source_granularity", "Non-UNKNOWN seasonality requires a known granularity")

        control = operating_context.get("content_change_control")
        if control is not None:
            if not isinstance(control, dict):
                add("ERROR", "CONTENT_CHANGE_CONTROL_INVALID", "operating_context.content_change_control", "content_change_control must be an object or null")
            else:
                if not nonplaceholder(control.get("decision_id")):
                    add("ERROR", "CONTENT_CHANGE_DECISION_ID_MISSING", "operating_context.content_change_control.decision_id", "decision_id is required")
                timestamp(control.get("decided_at"), "operating_context.content_change_control.decided_at")
                for field in ("copy_state", "asset_state"):
                    if not is_allowed(control.get(field, "UNKNOWN"), CONTENT_CHANGE_STATES):
                        add("ERROR", "CONTENT_CHANGE_STATE_INVALID", f"operating_context.content_change_control.{field}", f"Invalid {field}")
                scopes = context_string_list(control.get("locked_scopes", []), "operating_context.content_change_control.locked_scopes")
                invalid_scopes = sorted(set(scopes) - CONTENT_CHANGE_SCOPES)
                if invalid_scopes:
                    add("ERROR", "CONTENT_CHANGE_SCOPE_INVALID", "operating_context.content_change_control.locked_scopes", f"Invalid scopes: {', '.join(invalid_scopes)}")
                if (control.get("copy_state") in {"LOCKED", "PARTIAL"} or control.get("asset_state") in {"LOCKED", "PARTIAL"}) and not scopes:
                    add("ERROR", "CONTENT_CHANGE_SCOPE_MISSING", "operating_context.content_change_control.locked_scopes", "LOCKED/PARTIAL state requires explicit scopes")
                context_string_list(control.get("reopen_conditions", []), "operating_context.content_change_control.reopen_conditions")

        risks = operating_context.get("acknowledged_risks", [])
        if not isinstance(risks, list):
            add("ERROR", "ACKNOWLEDGED_RISKS_INVALID", "operating_context.acknowledged_risks", "acknowledged_risks must be an array")
            risks = []
        seen_risk_ids: set[str] = set()
        for index, risk in enumerate(risks):
            location = f"operating_context.acknowledged_risks[{index}]"
            if not isinstance(risk, dict):
                add("ERROR", "ACKNOWLEDGED_RISK_INVALID", location, "risk acknowledgement must be an object")
                continue
            risk_id = risk.get("risk_id")
            if not nonplaceholder(risk_id):
                add("ERROR", "ACKNOWLEDGED_RISK_ID_MISSING", f"{location}.risk_id", "risk_id is required")
            elif risk_id in seen_risk_ids:
                add("ERROR", "ACKNOWLEDGED_RISK_ID_DUPLICATE", f"{location}.risk_id", "risk_id must be unique")
            else:
                seen_risk_ids.add(risk_id)
            if not is_allowed(risk.get("decision"), RISK_ACK_DECISIONS):
                add("ERROR", "ACKNOWLEDGED_RISK_DECISION_INVALID", f"{location}.decision", "Invalid risk decision")
            for field in ("scope", "review_trigger"):
                if not nonempty(risk.get(field)):
                    add("ERROR", "ACKNOWLEDGED_RISK_FIELD_MISSING", f"{location}.{field}", f"{field} is required")
            if risk.get("does_not_change_evidence_or_publication_status") is not True:
                add("ERROR", "RISK_ACKNOWLEDGEMENT_MAY_NOT_RELEASE", location, "Risk acknowledgement must preserve evidence and publication status")
            forbidden = sorted(RISK_OVERRIDE_KEYS.intersection(risk))
            if forbidden:
                add("ERROR", "RISK_ACKNOWLEDGEMENT_OVERRIDE", location, f"Forbidden overrides: {', '.join(forbidden)}")

    upstream = require_dict(data.get("upstream_snapshots", {}), add, "UPSTREAM_INVALID", "upstream_snapshots")
    selection_snapshot = upstream.get("selection", {}) if isinstance(upstream.get("selection", {}), dict) else {}
    competitor_snapshot = upstream.get("competitor_lock", {}) if isinstance(upstream.get("competitor_lock", {}), dict) else {}
    keyword_snapshot = upstream.get("keyword_library", {}) if isinstance(upstream.get("keyword_library", {}), dict) else {}
    listing_release = require_dict(upstream.get("listing_release", {}), add, "LISTING_RELEASE_INVALID", "upstream_snapshots.listing_release")
    listing_status = listing_release.get("status")
    if not is_allowed(listing_status, {"READY", "PROVISIONAL", "BLOCKED"}):
        add("ERROR", "LISTING_STATUS_INVALID", "upstream_snapshots.listing_release.status", "Listing status is required")
    if not is_allowed(listing_release.get("integrity_status"), {"VERIFIED", "PARTIAL", "UNKNOWN"}):
        add("ERROR", "LISTING_INTEGRITY_INVALID", "upstream_snapshots.listing_release.integrity_status", "Use VERIFIED, PARTIAL, or UNKNOWN")

    if lineage_mode == "FULL_WORKFLOW":
        snapshot_checks = (
            (selection_snapshot, "selection", "selection_run_id", ("selection_run_id", "run_id")),
            (competitor_snapshot, "competitor_lock", "competitor_lock_run_id", ("competitor_lock_run_id",)),
            (keyword_snapshot, "keyword_library", "keyword_run_id", ("keyword_run_id",)),
            (listing_release, "listing_release", "listing_run_id", ("listing_run_id",)),
            (listing_release, "listing_release", "listing_version_id", ("listing_version_id",)),
        )
        for snapshot, snapshot_name, top_field, candidate_fields in snapshot_checks:
            snapshot_value = next((snapshot.get(field) for field in candidate_fields if nonplaceholder(snapshot.get(field))), None)
            if snapshot_value is None:
                gap("UPSTREAM_SNAPSHOT_ID_GAP", f"upstream_snapshots.{snapshot_name}", f"{top_field} is missing from the upstream snapshot")
            elif nonplaceholder(data.get(top_field)) and snapshot_value != data.get(top_field):
                add("ERROR", "UPSTREAM_ID_MISMATCH", f"upstream_snapshots.{snapshot_name}", f"{top_field} does not match the top-level lineage")
        for snapshot, snapshot_name in (
            (selection_snapshot, "selection"),
            (competitor_snapshot, "competitor_lock"),
            (keyword_snapshot, "keyword_library"),
            (listing_release, "listing_release"),
        ):
            for field in ("project_id", "candidate_id"):
                value = snapshot.get(field)
                location = f"upstream_snapshots.{snapshot_name}.{field}"
                if not nonplaceholder(value):
                    gap("UPSTREAM_SNAPSHOT_ID_GAP", location, f"Every full-workflow snapshot requires a non-placeholder {field}")
                elif value != data.get(field):
                    add("ERROR" if traffic_ready_status else "WARNING", "UPSTREAM_ID_MISMATCH", location, f"Upstream {field} does not match the top-level lineage")
        if nonplaceholder(operating_context_id):
            for snapshot, snapshot_name in (
                (selection_snapshot, "selection"),
                (competitor_snapshot, "competitor_lock"),
                (keyword_snapshot, "keyword_library"),
                (listing_release, "listing_release"),
            ):
                snapshot_context_id = snapshot.get("operating_context_id")
                location = f"upstream_snapshots.{snapshot_name}.operating_context_id"
                if not nonplaceholder(snapshot_context_id):
                    add("ERROR" if traffic_ready_status else "WARNING", "OPERATING_CONTEXT_LINEAGE_MISSING", location, "Every full-workflow snapshot must preserve operating_context_id")
                elif snapshot_context_id != operating_context_id:
                    add("ERROR", "OPERATING_CONTEXT_LINEAGE_MISMATCH", location, "Upstream operating_context_id does not match the strategy envelope")
                snapshot_context_hash = snapshot.get("operating_context_sha256")
                hash_location = f"upstream_snapshots.{snapshot_name}.operating_context_sha256"
                if not nonplaceholder(snapshot_context_hash):
                    add("ERROR" if traffic_ready_status else "WARNING", "OPERATING_CONTEXT_HASH_LINEAGE_MISSING", hash_location, "Every full-workflow snapshot must preserve operating_context_sha256")
                elif snapshot_context_hash != computed_operating_context_hash:
                    add("ERROR", "OPERATING_CONTEXT_HASH_LINEAGE_MISMATCH", hash_location, "Upstream operating_context_sha256 does not match the strategy envelope")

    if traffic_ready_status:
        if not nonplaceholder(listing_release.get("path")):
            add("ERROR", "LISTING_RELEASE_METADATA_INVALID", "upstream_snapshots.listing_release.path", "Traffic-ready Listing release requires a non-placeholder path")
        listing_captured_at = timestamp(listing_release.get("captured_at"), "upstream_snapshots.listing_release.captured_at") if nonempty(listing_release.get("captured_at")) else None
        if listing_captured_at is None:
            add("ERROR", "LISTING_RELEASE_METADATA_INVALID", "upstream_snapshots.listing_release.captured_at", "Traffic-ready Listing release requires a timezone-aware capture timestamp")
        elif package_captured_at is not None and listing_captured_at > package_captured_at + MAX_CLOCK_SKEW:
            add("ERROR", "LISTING_RELEASE_METADATA_INVALID", "upstream_snapshots.listing_release.captured_at", "Listing release cannot be captured after the strategy package")

    snapshots_for_source_binding = {
        "selection": selection_snapshot,
        "competitor_lock": competitor_snapshot,
        "keyword_library": keyword_snapshot,
        "listing_release": listing_release,
    }
    required_snapshot_names = set(snapshots_for_source_binding) if lineage_mode == "FULL_WORKFLOW" else {"listing_release"}
    for snapshot_name, snapshot in snapshots_for_source_binding.items():
        if snapshot_name not in required_snapshot_names:
            continue
        source_ids = snapshot.get("source_artifact_ids") if isinstance(snapshot, dict) else None
        location = f"upstream_snapshots.{snapshot_name}.source_artifact_ids"
        if not isinstance(source_ids, list) or not source_ids:
            gap("UPSTREAM_SOURCE_BINDING_MISSING", location, f"{snapshot_name} must bind to one or more hashed source artifacts")
            continue
        for source_id in source_ids:
            source = source_artifact_by_id.get(source_id)
            if source is None:
                add("ERROR", "UPSTREAM_SOURCE_UNKNOWN", location, f"Unknown upstream source artifact ID {source_id!r}")
            elif not is_allowed(source.get("artifact_type"), UPSTREAM_ARTIFACT_TYPES[snapshot_name]):
                add("ERROR", "UPSTREAM_SOURCE_TYPE_MISMATCH", location, f"Source artifact type does not prove {snapshot_name}")

    listing_bound_sources = listing_release.get("source_artifact_ids", []) if isinstance(listing_release, dict) else []
    if traffic_ready_status and isinstance(listing_bound_sources, list) and listing_bound_sources:
        listing_hash = listing_release.get("sha256")
        if not isinstance(listing_hash, str) or re.fullmatch(r"sha256:[0-9a-fA-F]{64}", listing_hash) is None:
            add("ERROR", "LISTING_RELEASE_HASH_MISSING", "upstream_snapshots.listing_release.sha256", "Ready Listing release must expose its canonical source hash")
        elif not any(source_artifact_by_id.get(source_id, {}).get("sha256") == listing_hash for source_id in listing_bound_sources):
            add("ERROR", "LISTING_RELEASE_HASH_MISMATCH", "upstream_snapshots.listing_release.sha256", "Listing release hash must match a bound listing source artifact")

    if lineage_mode == "INDEPENDENT_NEW" and traffic_ready_status:
        independent_source_rows = [source_artifact_by_id.get(source_id, {}) for source_id in data.get("independent_scope", {}).get("source_artifact_ids", [])]
        if not any(is_allowed(row.get("artifact_type"), UPSTREAM_ARTIFACT_TYPES["selection"]) for row in independent_source_rows):
            add("ERROR", "INDEPENDENT_NEW_PRODUCT_FACTS_MISSING", "independent_scope.source_artifact_ids", "Independent new-product readiness requires a hashed product-fact or selection artifact")

    upstream_keyword_by_id: dict[str, dict[str, Any]] = {}
    keyword_rows = keyword_snapshot.get("keywords", [])
    if keyword_rows is not None and not isinstance(keyword_rows, list):
        add("ERROR", "UPSTREAM_KEYWORDS_INVALID", "upstream_snapshots.keyword_library.keywords", "keywords must be an array")
        keyword_rows = []
    for index, row in enumerate(keyword_rows or []):
        location = f"upstream_snapshots.keyword_library.keywords[{index}]"
        if not isinstance(row, dict) or not nonplaceholder(row.get("source_keyword_id")):
            add("ERROR", "UPSTREAM_KEYWORD_INVALID", location, "Each upstream keyword requires source_keyword_id")
            continue
        keyword_id = row["source_keyword_id"]
        if keyword_id in upstream_keyword_by_id:
            add("ERROR", "UPSTREAM_KEYWORD_DUPLICATE", location, f"Duplicate source_keyword_id {keyword_id!r}")
        upstream_keyword_by_id[keyword_id] = row
        if not is_allowed(row.get("library_role"), ALLOWED_LIBRARY_ROLES - {"NOT_PRESENT_FIRST_PARTY_QUERY"}):
            add("ERROR", "UPSTREAM_KEYWORD_ROLE_INVALID", location, "Unknown upstream library_role")
        if not nonplaceholder(row.get("keyword_original")):
            gap("UPSTREAM_KEYWORD_TEXT_MISSING", f"{location}.keyword_original", "Every upstream keyword requires its original non-placeholder text")
        for field in ("source_ids", "evidence_ids"):
            values = row.get(field)
            if not isinstance(values, list) or not values or any(not nonplaceholder(value) for value in values):
                add("ERROR", "UPSTREAM_KEYWORD_EVIDENCE_MISSING", location, f"{field} must be a non-empty array of non-placeholder strings")

    upstream_competitor_by_asin: dict[str, dict[str, Any]] = {}
    upstream_competitor_orders: set[int] = set()
    competitor_rows = competitor_snapshot.get("competitors", [])
    if competitor_rows is not None and not isinstance(competitor_rows, list):
        add("ERROR", "UPSTREAM_COMPETITORS_INVALID", "upstream_snapshots.competitor_lock.competitors", "competitors must be an array")
        competitor_rows = []
    for index, row in enumerate(competitor_rows or []):
        location = f"upstream_snapshots.competitor_lock.competitors[{index}]"
        if not isinstance(row, dict) or not nonplaceholder(row.get("asin")):
            add("ERROR", "UPSTREAM_COMPETITOR_INVALID", location, "Each upstream competitor requires ASIN")
            continue
        asin = row["asin"]
        if asin in upstream_competitor_by_asin:
            add("ERROR", "UPSTREAM_COMPETITOR_DUPLICATE", location, f"Duplicate competitor ASIN {asin!r}")
        upstream_competitor_by_asin[asin] = row
        if not is_allowed(row.get("source_role"), COMPETITOR_SOURCE_ROLES) or not is_allowed(row.get("primary_role"), COMPETITOR_PRIMARY_ROLES):
            add("ERROR", "UPSTREAM_COMPETITOR_ROLE_INVALID", location, "Unknown source_role or primary_role")
        if not is_allowed(row.get("lock_status"), COMPETITOR_LOCK_STATUSES):
            add("ERROR", "UPSTREAM_COMPETITOR_LOCK_INVALID", location, "Unknown lock_status")
        source_order = row.get("source_order")
        if isinstance(source_order, bool) or not isinstance(source_order, int) or source_order < 1:
            add("ERROR", "UPSTREAM_COMPETITOR_SOURCE_ORDER_INVALID", location, "source_order must be a positive whole number")
        elif source_order in upstream_competitor_orders:
            add("ERROR", "UPSTREAM_COMPETITOR_SOURCE_ORDER_DUPLICATE", location, "source_order must be unique")
        else:
            upstream_competitor_orders.add(source_order)

    policy = require_dict(data.get("policy_snapshot", {}), add, "POLICY_INVALID", "policy_snapshot")
    policy_verified = policy.get("verified") is True
    policy_verified_at: datetime | None = None
    if not nonempty(policy.get("verified_at")):
        gap("POLICY_VERIFIED_AT_GAP", "policy_snapshot.verified_at", "Current policy verification time is required before traffic-plan readiness")
    else:
        policy_verified_at = timestamp(policy.get("verified_at"), "policy_snapshot.verified_at")
    policy_gates = {
        "placement_scope_verified": policy.get("placement_scope_verified"),
        "attribution_schema_verified": policy.get("attribution_schema_verified"),
        "review_method_compliance_verified": policy.get("review_method_compliance_verified"),
    }
    sources = policy.get("sources", [])
    if not isinstance(sources, list) or not sources:
        gap("POLICY_SOURCES_GAP", "policy_snapshot.sources", "Current official source artifact IDs are required before traffic-plan readiness")
        sources = []
    covered_policy_domains: set[str] = set()
    policy_source_classes: set[str] = set()
    attribution_policy_windows: set[str] = set()
    for source_id in sources:
        source = source_artifact_by_id.get(source_id)
        if source is None:
            add("ERROR", "POLICY_SOURCE_UNKNOWN", "policy_snapshot.sources", f"Unknown policy source artifact ID {source_id!r}")
        elif not is_allowed(source.get("data_class"), {"OFFICIAL_POLICY", "FIRST_PARTY"}):
            add("ERROR", "POLICY_SOURCE_CLASS_INVALID", "policy_snapshot.sources", "Policy sources must be official policy or current first-party account evidence")
        else:
            policy_source_classes.add(source.get("data_class"))
            if source.get("data_class") == "OFFICIAL_POLICY":
                if source.get("artifact_type") != "official_policy" or source.get("marketplace") not in (data.get("marketplace"), "GLOBAL"):
                    add("ERROR", "POLICY_SOURCE_SCOPE_INVALID", "policy_snapshot.sources", "Official policy source must use the official_policy type and match marketplace or GLOBAL scope")
                else:
                    verify_source_freshness(source, "policy_snapshot.sources", MAX_POLICY_AGE, "POLICY_SOURCE_STALE")
                domains = source.get("policy_domains", [])
                if not isinstance(domains, list):
                    add("ERROR", "POLICY_SOURCE_DOMAINS_INVALID", "policy_snapshot.sources", "Official policy source requires policy_domains[]")
                else:
                    covered_policy_domains.update(str(domain) for domain in domains)
                    if "ATTRIBUTION_SCHEMA" in domains:
                        declared_windows = source.get("attribution_windows")
                        if isinstance(declared_windows, list):
                            attribution_policy_windows.update(value for value in declared_windows if nonplaceholder(value))
            elif not is_allowed(source.get("artifact_type"), PLACEMENT_ACCOUNT_ARTIFACT_TYPES) or source.get("marketplace") != data.get("marketplace") or source.get("account_id_masked") != scope.get("account_id_masked"):
                add("ERROR", "POLICY_ACCOUNT_SOURCE_SCOPE_INVALID", "policy_snapshot.sources", "First-party policy/account source must match Amazon Ads account type, marketplace, and account")
            else:
                verify_source_freshness(source, "policy_snapshot.sources", MAX_ACCOUNT_SNAPSHOT_AGE, "POLICY_ACCOUNT_SOURCE_STALE")
    if traffic_ready_status:
        if not {"OFFICIAL_POLICY", "FIRST_PARTY"} <= policy_source_classes:
            add("ERROR", "POLICY_SOURCE_CLASSES_INCOMPLETE", "policy_snapshot.sources", "Ready strategy requires both official-policy and first-party account sources")
        missing_policy_domains = REQUIRED_POLICY_DOMAINS - covered_policy_domains
        if missing_policy_domains:
            add("ERROR", "POLICY_DOMAIN_COVERAGE_MISSING", "policy_snapshot.sources", f"Missing official policy domains: {', '.join(sorted(missing_policy_domains))}")
        unverified_boundaries = policy.get("unverified_boundaries")
        if not isinstance(unverified_boundaries, list):
            add("ERROR", "POLICY_BOUNDARY_INVALID", "policy_snapshot.unverified_boundaries", "unverified_boundaries must be an array")
        elif unverified_boundaries:
            add("ERROR", "POLICY_BOUNDARY_UNRESOLVED", "policy_snapshot.unverified_boundaries", "Traffic readiness requires every policy boundary to be resolved")

    account = require_dict(data.get("account_snapshot", {}), add, "ACCOUNT_INVALID", "account_snapshot")
    account_captured_at: datetime | None = None
    if not nonempty(account.get("captured_at")):
        gap("ACCOUNT_CAPTURED_AT_GAP", "account_snapshot.captured_at", "Current account snapshot time is required before traffic-plan readiness")
    else:
        account_captured_at = timestamp(account.get("captured_at"), "account_snapshot.captured_at")
    if account.get("read_only") is not True and execution_authority == "PLAN_ONLY":
        add("ERROR", "PLAN_NOT_READ_ONLY", "account_snapshot.read_only", "PLAN_ONLY account snapshot must be read-only")
    if not is_allowed(account.get("advertising_eligibility"), {"ELIGIBLE", "INELIGIBLE", "UNKNOWN"}):
        add("ERROR", "AD_ELIGIBILITY_INVALID", "account_snapshot.advertising_eligibility", "Advertising eligibility state is required")
    if not is_allowed(account.get("featured_offer_or_current_equivalent"), {"ELIGIBLE", "INELIGIBLE", "UNKNOWN", "NOT_REQUIRED_VERIFIED"}):
        add("ERROR", "FEATURED_OFFER_STATE_INVALID", "account_snapshot.featured_offer_or_current_equivalent", "Use ELIGIBLE, INELIGIBLE, UNKNOWN, or NOT_REQUIRED_VERIFIED")
    if traffic_ready_status and package_captured_at is not None:
        if policy_verified_at is not None:
            policy_age = package_captured_at - policy_verified_at
            if policy_age < timedelta(0) or policy_age > MAX_POLICY_AGE:
                add("ERROR", "POLICY_VERIFICATION_STALE", "policy_snapshot.verified_at", "Policy verification must be current within the validator's 30-day safety window")
        if account_captured_at is not None:
            account_age = package_captured_at - account_captured_at
            if account_age < timedelta(0) or account_age > MAX_ACCOUNT_SNAPSHOT_AGE:
                add("ERROR", "ACCOUNT_SNAPSHOT_STALE", "account_snapshot.captured_at", "Account eligibility and placement snapshot must be current within the validator's 24-hour safety window")

    economics = require_dict(data.get("economics", {}), add, "ECONOMICS_INVALID", "economics")
    performance_basis = economics.get("performance_basis", {})
    economics_input = require_dict(economics.get("input_snapshot", {}), add, "ECONOMICS_INPUT_INVALID", "economics.input_snapshot")
    calc = require_dict(economics.get("calculator_result", {}), add, "CALCULATOR_RESULT_INVALID", "economics.calculator_result")
    expanded_economics_inputs: list[dict[str, Any]] = []
    binding_calc: dict[str, Any] = {}
    binding_input: dict[str, Any] = {}
    scenario_mode = isinstance(economics_input.get("scenarios"), list)
    try:
        if scenario_mode:
            expanded_economics_inputs = expand_scenarios(economics_input)
            recomputed_calc: Any = {"scenarios": [calculate_economics(item) for item in expanded_economics_inputs]}
        else:
            expanded_economics_inputs = [economics_input]
            recomputed_calc = calculate_economics(economics_input)
    except (TypeError, ValueError) as exc:
        add("ERROR", "ECONOMICS_RECALCULATION_FAILED", "economics.input_snapshot", str(exc))
    else:
        if calc != recomputed_calc:
            add("ERROR", "CALCULATOR_RESULT_MISMATCH", "economics.calculator_result", "Calculator result does not exactly match the supplied input snapshot")
        if scenario_mode:
            binding_name = economics.get("binding_scenario_name")
            if not nonplaceholder(binding_name):
                add("ERROR", "BINDING_SCENARIO_MISSING", "economics.binding_scenario_name", "A binding scenario name is required")
            results = calc.get("scenarios", []) if isinstance(calc.get("scenarios"), list) else []
            for input_row, result_row in zip(expanded_economics_inputs, results):
                if result_row.get("name") == binding_name:
                    binding_input = input_row
                    binding_calc = result_row
                    break
            if not binding_calc:
                add("ERROR", "BINDING_SCENARIO_UNKNOWN", "economics.binding_scenario_name", "Binding scenario is not present in calculator_result.scenarios")
        else:
            binding_input = economics_input
            binding_calc = calc

    def economics_evidence_coverage(source_ids: Any, location: str) -> tuple[set[str], set[str], list[dict[str, Any]]]:
        if not isinstance(source_ids, list) or not source_ids:
            add("ERROR", "ECONOMICS_EVIDENCE_SOURCES_MISSING", location, "A non-empty economics evidence source list is required")
            return set(), set(), []
        domains: set[str] = set()
        classes: set[str] = set()
        rows: list[dict[str, Any]] = []
        for source_id in source_ids:
            source = source_artifact_by_id.get(source_id)
            if source is None:
                add("ERROR", "ECONOMICS_EVIDENCE_SOURCE_UNKNOWN", location, f"Unknown economics source artifact ID {source_id!r}")
                continue
            rows.append(source)
            artifact_type = str(source.get("artifact_type"))
            data_class = str(source.get("data_class"))
            permitted = ECONOMICS_DOMAIN_ARTIFACT_TYPES.get(artifact_type, set())
            raw_domains = source.get("evidence_domains", [])
            declared = {str(domain) for domain in raw_domains} if isinstance(raw_domains, list) else set()
            source_valid = True
            if data_class not in ECONOMICS_ARTIFACT_DATA_CLASSES.get(artifact_type, set()):
                add("ERROR", "ECONOMICS_EVIDENCE_SOURCE_CLASS_INVALID", location, f"Artifact type {artifact_type!r} cannot carry economics data_class {data_class!r}")
                source_valid = False
            if source.get("marketplace") != data.get("marketplace"):
                add("ERROR", "ECONOMICS_EVIDENCE_SOURCE_SCOPE_MISMATCH", location, "Economics evidence marketplace must match the strategy")
                source_valid = False
            if valid_scope_ids and not any(source.get("scope_id") == scope_id for scope_id in valid_scope_ids):
                add("ERROR", "ECONOMICS_EVIDENCE_SOURCE_SCOPE_MISMATCH", location, "Economics evidence scope_id must match the strategy ASIN or SKU")
                source_valid = False
            monetary_domains = declared & {"OFFER_AND_REVENUE", "AMAZON_FEES_AND_TAX", "PRODUCT_COSTS_AND_RETURNS", "ATTRIBUTED_REVENUE"}
            if monetary_domains and source.get("currency") != data.get("currency"):
                add("ERROR", "ECONOMICS_EVIDENCE_SOURCE_SCOPE_MISMATCH", location, "Monetary economics evidence currency must match the strategy")
                source_valid = False
            if data_class in {"FIRST_PARTY", "SELLER_CONFIRMED"} and source.get("account_id_masked") != scope.get("account_id_masked"):
                add("ERROR", "ECONOMICS_EVIDENCE_SOURCE_SCOPE_MISMATCH", location, "Account-derived economics evidence must match the strategy account")
                source_valid = False
            if source_valid:
                classes.add(data_class)
                domains.update(declared & permitted)
            verify_source_freshness(source, location, MAX_POLICY_AGE, "ECONOMICS_EVIDENCE_SOURCE_STALE")
        return domains, classes, rows

    common_evidence_ids = economics.get("input_evidence_source_ids")
    common_evidence_domains, _, _ = economics_evidence_coverage(common_evidence_ids, "economics.input_evidence_source_ids") if traffic_ready_status else (set(), set(), [])
    if traffic_ready_status:
        missing_common_domains = COMMON_ECONOMICS_EVIDENCE_DOMAINS - common_evidence_domains
        if missing_common_domains:
            add("ERROR", "ECONOMICS_EVIDENCE_DOMAIN_MISSING", "economics.input_evidence_source_ids", f"Missing common economics evidence domains: {', '.join(sorted(missing_common_domains))}")

    if strategy_mode == "NEW_PRODUCT_LAUNCH" and traffic_ready_status:
        if not scenario_mode:
            add("ERROR", "NEW_SCENARIOS_MISSING", "economics.input_snapshot", "A ready new-product plan requires pessimistic, base, and optimistic scenarios")
        else:
            roles = [str(item.get("scenario_role", "")).upper() for item in expanded_economics_inputs]
            role_counts = {role: roles.count(role) for role in {"PESSIMISTIC", "BASE", "OPTIMISTIC"}}
            missing_roles = {role for role, count in role_counts.items() if count == 0}
            duplicate_roles = {role for role, count in role_counts.items() if count > 1}
            invalid_roles = {role for role in roles if role not in role_counts}
            if missing_roles:
                add("ERROR", "NEW_SCENARIO_ROLES_MISSING", "economics.input_snapshot.scenarios", f"Missing scenario roles: {', '.join(sorted(missing_roles))}")
            if duplicate_roles or invalid_roles or len(expanded_economics_inputs) != 3:
                add("ERROR", "NEW_SCENARIO_ROLES_NOT_EXACT", "economics.input_snapshot.scenarios", "Use exactly one PESSIMISTIC, BASE, and OPTIMISTIC scenario")
            scenario_names: set[str] = set()
            for index, item in enumerate(expanded_economics_inputs):
                location = f"economics.input_snapshot.scenarios[{index}]"
                scenario_name = str(item.get("name", "")).upper()
                scenario_role = str(item.get("scenario_role", "")).upper()
                if scenario_name != scenario_role:
                    add("ERROR", "SCENARIO_NAME_ROLE_MISMATCH", location, "Scenario name and scenario_role must be the same canonical role")
                if scenario_name in scenario_names:
                    add("ERROR", "SCENARIO_NAME_DUPLICATE", location, "Scenario names must be unique")
                scenario_names.add(scenario_name)
                if not is_allowed(item.get("scenario_confidence"), {"LOW", "MEDIUM", "HIGH"}):
                    add("ERROR", "SCENARIO_CONFIDENCE_MISSING", location, "scenario_confidence must be LOW, MEDIUM, or HIGH")
                scenario_source_ids = item.get("scenario_source_ids")
                if not isinstance(scenario_source_ids, list) or not scenario_source_ids:
                    add("ERROR", "SCENARIO_SOURCES_MISSING", location, "scenario_source_ids must be non-empty")
                else:
                    scenario_domains, source_classes, scenario_sources = economics_evidence_coverage(scenario_source_ids, f"{location}.scenario_source_ids")
                    missing_scenario_domains = SCENARIO_ECONOMICS_EVIDENCE_DOMAINS - scenario_domains
                    if missing_scenario_domains:
                        add("ERROR", "SCENARIO_EVIDENCE_DOMAIN_MISSING", location, f"Missing scenario economics evidence domains: {', '.join(sorted(missing_scenario_domains))}")
                    declared_source_classes = {str(source.get("data_class")) for source in scenario_sources}
                    if declared_source_classes and declared_source_classes <= {"HYPOTHESIS"}:
                        add("ERROR", "SCENARIO_ONLY_HYPOTHETICAL", location, "A ready scenario requires at least one evidence source beyond a model hypothesis")
                    if item.get("scenario_confidence") == "HIGH":
                        authoritative_domains: set[str] = set()
                        for source in scenario_sources:
                            if not is_allowed(source.get("data_class"), {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED"}):
                                continue
                            permitted = ECONOMICS_DOMAIN_ARTIFACT_TYPES.get(str(source.get("artifact_type")), set())
                            declared = set(source.get("evidence_domains", [])) if isinstance(source.get("evidence_domains"), list) else set()
                            authoritative_domains.update(permitted & declared & SCENARIO_ECONOMICS_EVIDENCE_DOMAINS)
                        if authoritative_domains != SCENARIO_ECONOMICS_EVIDENCE_DOMAINS:
                            add("ERROR", "SCENARIO_HIGH_CONFIDENCE_UNSUPPORTED", location, "HIGH confidence requires authoritative sources that actually cover both conversion and attributed-revenue domains")
                    for data_class_field in ("conversion_data_class", "attributed_sales_data_class"):
                        if item.get(data_class_field) == "ACTUAL":
                            actual_sources = [
                                source for source in scenario_sources
                                if source.get("data_class") == "FIRST_PARTY"
                                and is_allowed(source.get("artifact_type"), {"amazon_business_report", "amazon_ads_report", "amazon_ads_api_snapshot"})
                                and source.get("marketplace") == data.get("marketplace")
                                and source.get("account_id_masked") == scope.get("account_id_masked")
                                and any(source.get("scope_id") == scope_id for scope_id in valid_scope_ids)
                            ]
                            if not actual_sources:
                                add("ERROR", "NEW_PRODUCT_ACTUAL_AUTHORITY_INVALID", location, f"{data_class_field}=ACTUAL requires exact-scope first-party Amazon performance evidence")

            result_by_role: dict[str, dict[str, Any]] = {}
            for input_row, result_row in zip(expanded_economics_inputs, calc.get("scenarios", []) if isinstance(calc.get("scenarios", []), list) else []):
                role = str(input_row.get("scenario_role", "")).upper()
                if role in {"PESSIMISTIC", "BASE", "OPTIMISTIC"}:
                    result_by_role[role] = result_row
            for lower_role, upper_role in (("PESSIMISTIC", "BASE"), ("BASE", "OPTIMISTIC")):
                lower_result = result_by_role.get(lower_role, {})
                upper_result = result_by_role.get(upper_role, {})
                for metric in ("target_cpc", "break_even_cpc", "target_acos", "operating_break_even_acos", "all_in_break_even_acos"):
                    lower_value = number(lower_result.get("ceilings", {}).get(metric), f"economics.calculator_result.{lower_role}.{metric}")
                    upper_value = number(upper_result.get("ceilings", {}).get(metric), f"economics.calculator_result.{upper_role}.{metric}")
                    if lower_value is not None and (upper_value is None or lower_value > upper_value):
                        add("ERROR", "NEW_SCENARIO_MONOTONICITY_INVALID", "economics.calculator_result.scenarios", f"{lower_role} {metric} cannot exceed {upper_role} or remain available when the upper scenario is unavailable")
            binding_role = str(binding_input.get("scenario_role", "")).upper()
            if binding_role == "OPTIMISTIC":
                approval_source = source_artifact_by_id.get(economics.get("binding_scenario_approval_source_id"))
                if economics.get("optimistic_binding_approved_by_user") is not True or approval_source is None or not is_allowed(approval_source.get("data_class"), {"FIRST_PARTY", "SELLER_CONFIRMED"}):
                    add("ERROR", "OPTIMISTIC_BINDING_NOT_APPROVED", "economics.binding_scenario_name", "An OPTIMISTIC binding scenario requires explicit user approval with a first-party or seller-confirmed source")
                elif not is_allowed(approval_source.get("artifact_type"), APPROVAL_ARTIFACT_TYPES) or approval_source.get("marketplace") != data.get("marketplace") or approval_source.get("currency") != data.get("currency") or approval_source.get("account_id_masked") != scope.get("account_id_masked"):
                    add("ERROR", "OPTIMISTIC_BINDING_APPROVAL_SCOPE_MISMATCH", "economics.binding_scenario_approval_source_id", "Optimistic binding approval must match budget-approval type, marketplace, currency, and account")
                else:
                    verify_source_freshness(approval_source, "economics.binding_scenario_approval_source_id", MAX_POLICY_AGE, "OPTIMISTIC_BINDING_APPROVAL_STALE")

    expected_data_mode = "NEW_PRODUCT" if strategy_mode == "NEW_PRODUCT_LAUNCH" else "EXISTING_PRODUCT"
    if traffic_ready_status and not valid_scope_ids:
        add("ERROR", "ECONOMICS_SCOPE_IDENTITY_MISSING", "scope", "Traffic-ready economics require a real ASIN or SKU scope")
    for index, item in enumerate(expanded_economics_inputs):
        location = f"economics.input_snapshot.scenarios[{index}]" if scenario_mode else "economics.input_snapshot"
        if item.get("marketplace") != data.get("marketplace"):
            add("ERROR", "ECONOMICS_MARKETPLACE_MISMATCH", location, "Economics marketplace must match strategy marketplace")
        if item.get("currency") != data.get("currency"):
            add("ERROR", "ECONOMICS_CURRENCY_MISMATCH", location, "Economics currency must match strategy currency")
        if item.get("data_mode") != expected_data_mode:
            add("ERROR", "ECONOMICS_MODE_MISMATCH", location, "Economics data_mode does not match strategy mode")
        if valid_scope_ids and item.get("scope_id") not in valid_scope_ids:
            add("ERROR", "ECONOMICS_SCOPE_MISMATCH", location, "Economics scope_id must match the strategy ASIN or SKU")
        if lineage_mode == "FULL_WORKFLOW" and operating_context:
            preserved_profit = operating_context.get("profit_objective")
            if isinstance(preserved_profit, dict):
                for field in ("minimum_post_ads_contribution_rate", "target_profit_per_order", "risk_buffer_per_order"):
                    context_value = number(preserved_profit.get(field), f"operating_context.profit_objective.{field}")
                    model_value = number(item.get(field), f"{location}.{field}")
                    if context_value != model_value:
                        gap("ECONOMICS_PROFIT_OBJECTIVE_MISMATCH", f"{location}.{field}", f"{field} must match the preserved operating-context profit objective; an updated objective needs a separately evidenced context revision")

    economics_status = binding_calc.get("overall_status")
    if not is_allowed(economics_status, {"READY_ACTUAL", "READY_ESTIMATED", "PROVISIONAL", "BLOCKED"}):
        add("ERROR", "ECONOMICS_STATUS_INVALID", "economics.calculator_result", "Unknown binding economics status")
    assumed_zero = binding_calc.get("assumed_zero_fields", [])
    if not isinstance(assumed_zero, list):
        add("ERROR", "ASSUMED_ZERO_INVALID", "economics.calculator_result", "assumed_zero_fields must be an array")
        assumed_zero = []
    approved_cash_exposure = number(economics.get("approved_cash_exposure"), "economics.approved_cash_exposure")
    strategy_total_spend_cap = number(economics.get("strategy_total_spend_cap"), "economics.strategy_total_spend_cap")
    if approved_cash_exposure is None:
        gap("CASH_EXPOSURE_GAP", "economics.approved_cash_exposure", "A broader approved promotion cash exposure is required before traffic-plan readiness")
    elif approved_cash_exposure < 0:
        add("ERROR", "CASH_EXPOSURE_INVALID", "economics.approved_cash_exposure", "Approved cash exposure cannot be negative")
    if strategy_total_spend_cap is None:
        gap("TOTAL_SPEND_CAP_GAP", "economics.strategy_total_spend_cap", "A strategy PPC spend cap is required before traffic-plan readiness")
    elif strategy_total_spend_cap < 0:
        add("ERROR", "TOTAL_SPEND_CAP_INVALID", "economics.strategy_total_spend_cap", "Strategy spend cap cannot be negative")
    if approved_cash_exposure is not None and strategy_total_spend_cap is not None and strategy_total_spend_cap > approved_cash_exposure:
        add("ERROR", "TOTAL_CAP_EXCEEDS_CASH", "economics.strategy_total_spend_cap", "Strategy spend cap cannot exceed approved cash exposure")
    for value_field, source_field in (
        ("approved_cash_exposure", "approved_cash_exposure_source_id"),
        ("strategy_total_spend_cap", "strategy_total_spend_cap_source_id"),
    ):
        if economics.get(value_field) is None:
            continue
        source_id = economics.get(source_field)
        source = source_artifact_by_id.get(source_id)
        if source is None or not is_allowed(source.get("data_class"), {"FIRST_PARTY", "SELLER_CONFIRMED"}):
            gap("ECONOMICS_APPROVAL_SOURCE_GAP", f"economics.{source_field}", f"{value_field} requires a seller-confirmed or first-party approval source")
        elif not is_allowed(source.get("artifact_type"), APPROVAL_ARTIFACT_TYPES) or source.get("marketplace") != data.get("marketplace") or source.get("currency") != data.get("currency") or source.get("account_id_masked") != scope.get("account_id_masked"):
            add("ERROR", "ECONOMICS_APPROVAL_SCOPE_MISMATCH", f"economics.{source_field}", "Approval source must match artifact type, marketplace, currency, and account scope")
        else:
            verify_source_freshness(source, f"economics.{source_field}", MAX_POLICY_AGE, "ECONOMICS_APPROVAL_SOURCE_STALE")
    calc_costs = require_dict(binding_calc.get("costs", {}), add, "CALCULATOR_COSTS_INVALID", "economics.calculator_result.binding.costs")
    fixed_launch_support = number(calc_costs.get("fixed_launch_support_total"), "economics.calculator_result.costs.fixed_launch_support_total")
    if (
        approved_cash_exposure is not None
        and strategy_total_spend_cap is not None
        and fixed_launch_support is not None
        and strategy_total_spend_cap + fixed_launch_support > approved_cash_exposure
    ):
        add("ERROR", "ALL_IN_EXPOSURE_EXCEEDS_CASH", "economics.approved_cash_exposure", "PPC cap plus fixed launch support exceeds approved cash exposure")
    calc_ceilings = require_dict(binding_calc.get("ceilings", {}), add, "CALCULATOR_CEILINGS_INVALID", "economics.calculator_result.binding.ceilings")
    calculator_target_cpc = number(calc_ceilings.get("target_cpc"), "economics.calculator_result.ceilings.target_cpc")
    calculator_break_even_cpc = number(calc_ceilings.get("break_even_cpc"), "economics.calculator_result.ceilings.break_even_cpc")
    planned_ppc_spend = number(binding_input.get("planned_ppc_spend"), "economics.input_snapshot.binding.planned_ppc_spend")
    if planned_ppc_spend is not None and strategy_total_spend_cap is not None and planned_ppc_spend > strategy_total_spend_cap:
        add("ERROR", "PLANNED_PPC_EXCEEDS_TOTAL_CAP", "economics.input_snapshot", "Binding planned PPC spend exceeds strategy total spend cap")
    economics_performance_ids = economics.get("performance_snapshot_ids", [])
    if not isinstance(economics_performance_ids, list):
        add("ERROR", "ECONOMICS_PERFORMANCE_IDS_INVALID", "economics.performance_snapshot_ids", "performance_snapshot_ids must be an array")
        economics_performance_ids = []
    envelopes = require_list(economics.get("approved_learning_loss_envelopes", []), add, "LEARNING_ENVELOPES_INVALID", "economics.approved_learning_loss_envelopes")
    envelope_ids: set[str] = set()
    envelope_by_id: dict[str, dict[str, Any]] = {}
    envelope_limits: dict[str, tuple[Decimal | None, Decimal | None]] = {}
    for index, envelope in enumerate(envelopes):
        location = f"economics.approved_learning_loss_envelopes[{index}]"
        if not isinstance(envelope, dict):
            add("ERROR", "LEARNING_ENVELOPE_INVALID", location, "Learning-loss envelope must be an object")
            continue
        envelope_id = envelope.get("learning_loss_envelope_id")
        if not nonplaceholder(envelope_id):
            add("ERROR", "LEARNING_ENVELOPE_ID_MISSING", location, "learning_loss_envelope_id is required")
        elif envelope_id in envelope_ids:
            add("ERROR", "LEARNING_ENVELOPE_ID_DUPLICATE", location, f"Duplicate envelope ID {envelope_id!r}")
        envelope_ids.add(envelope_id)
        if nonplaceholder(envelope_id):
            envelope_by_id[envelope_id] = envelope
        if envelope.get("approved_by_user") is not True:
            add("ERROR", "LEARNING_LOSS_NOT_APPROVED", location, "Learning loss requires explicit user risk approval")
        for field in ("approved_at", "data_or_time_gate", "reason", "approval_source_id"):
            if not nonempty(envelope.get(field)):
                add("ERROR", "LEARNING_ENVELOPE_FIELD_MISSING", location, f"{field} is required")
        learning_approved_at: datetime | None = None
        if nonempty(envelope.get("approved_at")):
            learning_approved_at = timestamp(envelope.get("approved_at"), f"{location}.approved_at")
        if learning_approved_at is not None and package_captured_at is not None:
            approval_age = package_captured_at - learning_approved_at
            if approval_age < -MAX_CLOCK_SKEW:
                add("ERROR", "LEARNING_APPROVAL_TIME_INVALID", f"{location}.approved_at", "Learning approval cannot occur after the strategy capture")
            elif approval_age > MAX_POLICY_AGE:
                add("ERROR", "LEARNING_APPROVAL_STALE", f"{location}.approved_at", "Learning approval is outside the validator's 30-day safety window")
        approval_source = source_artifact_by_id.get(envelope.get("approval_source_id"))
        if approval_source is None or not is_allowed(approval_source.get("data_class"), {"FIRST_PARTY", "SELLER_CONFIRMED"}):
            add("ERROR", "LEARNING_ENVELOPE_APPROVAL_SOURCE_INVALID", location, "Learning loss requires a first-party or seller-confirmed approval source")
        elif not is_allowed(approval_source.get("artifact_type"), APPROVAL_ARTIFACT_TYPES) or approval_source.get("marketplace") != data.get("marketplace") or approval_source.get("currency") != data.get("currency") or approval_source.get("account_id_masked") != scope.get("account_id_masked"):
            add("ERROR", "LEARNING_ENVELOPE_APPROVAL_SCOPE_MISMATCH", location, "Learning-loss approval source must match type, marketplace, currency, and account")
        else:
            verify_source_freshness(approval_source, f"{location}.approval_source_id", MAX_POLICY_AGE, "LEARNING_ENVELOPE_APPROVAL_STALE")
            approval_source_time = timestamp(approval_source.get("version_or_captured_at"), f"{location}.approval_source_id.version_or_captured_at")
            if learning_approved_at is not None and approval_source_time is not None and learning_approved_at > approval_source_time + MAX_CLOCK_SKEW:
                add("ERROR", "LEARNING_APPROVAL_TIME_INVALID", f"{location}.approved_at", "Learning approval timestamp must be supported by the cited approval artifact")
        for field in ("maximum_incremental_loss", "maximum_spend"):
            amount = number(envelope.get(field), f"{location}.{field}")
            if amount is None or amount < 0:
                add("ERROR", "LEARNING_ENVELOPE_AMOUNT_INVALID", location, f"{field} must be non-negative")
        maximum_spend = number(envelope.get("maximum_spend"), f"{location}.maximum_spend")
        maximum_loss = number(envelope.get("maximum_incremental_loss"), f"{location}.maximum_incremental_loss")
        if nonplaceholder(envelope_id):
            envelope_limits[envelope_id] = (maximum_spend, maximum_loss)
        if maximum_spend is not None and maximum_loss is not None and maximum_loss > maximum_spend:
            add("ERROR", "LEARNING_LOSS_EXCEEDS_ENVELOPE_SPEND", location, "Maximum incremental loss cannot exceed the envelope's maximum spend")
        if strategy_total_spend_cap is not None and maximum_spend is not None and maximum_spend > strategy_total_spend_cap:
            add("ERROR", "LEARNING_SPEND_EXCEEDS_TOTAL", location, "Learning-envelope spend cannot exceed the strategy spend cap")
        if approved_cash_exposure is not None and maximum_loss is not None and maximum_loss > approved_cash_exposure:
            add("ERROR", "LEARNING_LOSS_EXCEEDS_CASH", location, "Learning-loss cap cannot exceed approved cash exposure")
        if not envelope.get("stop_conditions") or not nonempty(envelope.get("rollback_action")):
            add("ERROR", "LEARNING_ENVELOPE_GATES_MISSING", location, "Stop conditions and rollback action are required")
        scope_target_ids = envelope.get("scope_ad_target_ids")
        if not isinstance(scope_target_ids, list) or not scope_target_ids:
            add("ERROR", "LEARNING_ENVELOPE_SCOPE_MISSING", location, "scope_ad_target_ids must list the exact covered targets")
        elif len(scope_target_ids) != len(set(scope_target_ids)) or any(not nonplaceholder(target_id) for target_id in scope_target_ids):
            add("ERROR", "LEARNING_ENVELOPE_SCOPE_INVALID", location, "scope_ad_target_ids must contain unique non-placeholder target IDs")

    target_decision_by_id: dict[str, str] = {}
    target_envelope_by_id: dict[str, str] = {}

    def relevant_target_sources(target: dict[str, Any], target_kind: str) -> list[dict[str, Any]]:
        domain = "KEYWORD_TARGET_EVIDENCE" if target_kind == "KEYWORD" else "PRODUCT_TARGET_EVIDENCE"
        scope_field = "keyword_scope_ids" if target_kind == "KEYWORD" else "asin_scope_ids"
        target_scope_value = target.get("source_keyword_id") if target_kind == "KEYWORD" else target.get("asin")
        relevant: list[dict[str, Any]] = []
        for source_id in target.get("source_ids", []) if isinstance(target.get("source_ids"), list) else []:
            if not nonplaceholder(source_id):
                continue
            source = source_artifact_by_id.get(source_id)
            if not isinstance(source, dict):
                continue
            permitted = TARGET_DOMAIN_ARTIFACT_TYPES.get(str(source.get("artifact_type")), set())
            declared = set(source.get("evidence_domains", [])) if isinstance(source.get("evidence_domains"), list) else set()
            scoped_values = source.get(scope_field)
            if domain not in permitted or domain not in declared or not isinstance(scoped_values, list) or target_scope_value not in scoped_values:
                continue
            if source.get("data_class") == "FIRST_PARTY" and valid_scope_ids and source.get("scope_id") not in valid_scope_ids:
                continue
            relevant.append(source)
        return relevant

    keyword_targets = require_list(data.get("keyword_targets", []), add, "KEYWORD_TARGETS_INVALID", "keyword_targets")
    keyword_target_ids: set[str] = set()
    source_keyword_target_ids: dict[str, list[str]] = {}
    for index, target in enumerate(keyword_targets):
        location = f"keyword_targets[{index}]"
        if not isinstance(target, dict):
            add("ERROR", "KEYWORD_TARGET_INVALID", location, "Keyword target must be an object")
            continue
        target_id = target.get("ad_target_id")
        if not nonplaceholder(target_id):
            add("ERROR", "AD_TARGET_ID_MISSING", location, "ad_target_id is required")
        elif target_id in keyword_target_ids:
            add("ERROR", "AD_TARGET_ID_DUPLICATE", location, f"Duplicate ad_target_id {target_id!r}")
        if nonplaceholder(target_id):
            keyword_target_ids.add(target_id)
        decision = target.get("ad_decision")
        role = target.get("library_role")
        if not is_allowed(decision, {"INCLUDE", "OBSERVE", "EXCLUDE"}):
            add("ERROR", "AD_DECISION_INVALID", location, "ad_decision must be INCLUDE, OBSERVE, or EXCLUDE")
        elif nonplaceholder(target_id):
            target_decision_by_id[target_id] = decision
        if not is_allowed(role, ALLOWED_LIBRARY_ROLES):
            add("ERROR", "LIBRARY_ROLE_INVALID", location, "Use a canonical preserved library_role")
        if not is_allowed(target.get("ad_role"), ALLOWED_AD_ROLES):
            add("ERROR", "AD_ROLE_INVALID", location, "Use a supported separate ad_role")
        elif (decision == "INCLUDE" and is_allowed(target.get("ad_role"), {"OBSERVE", "EXCLUDE"})) or (is_allowed(decision, {"OBSERVE", "EXCLUDE"}) and target.get("ad_role") != decision):
            add("ERROR", "AD_ROLE_DECISION_CONTRADICTION", location, "ad_role must agree with the INCLUDE, OBSERVE, or EXCLUDE decision")
        if not nonempty(target.get("decision_reason")):
            add("ERROR", "AD_DECISION_REASON_MISSING", location, "Every include/observe/exclude decision requires a reason")
        for field in ("keyword_original", "intent", "objective"):
            if not nonplaceholder(target.get(field)):
                add("ERROR", "KEYWORD_CONTENT_FIELD_MISSING", f"{location}.{field}", f"{field} must be a non-placeholder string")
        if not is_allowed(target.get("product_fit"), {"DIRECT", "CONDITIONAL", "WRONG"}):
            add("ERROR", "KEYWORD_PRODUCT_FIT_INVALID", f"{location}.product_fit", "product_fit must be DIRECT, CONDITIONAL, or WRONG")
        source_keyword_id = target.get("source_keyword_id")
        if not nonplaceholder(source_keyword_id):
            add("ERROR", "SOURCE_KEYWORD_ID_MISSING", location, "Every keyword decision requires source_keyword_id")
        elif nonplaceholder(target_id):
            source_keyword_target_ids.setdefault(source_keyword_id, []).append(target_id)
        for field in ("source_ids", "evidence_ids"):
            values = target.get(field)
            if not isinstance(values, list) or not values or any(not nonplaceholder(value) for value in values):
                add("ERROR", "TARGET_EVIDENCE_MISSING", location, f"{field} must be a non-empty array of non-placeholder strings for every decision")
        for source_id in target.get("source_ids", []) if isinstance(target.get("source_ids"), list) else []:
            if not nonplaceholder(source_id):
                continue
            if source_id not in source_artifact_ids:
                add("ERROR", "KEYWORD_SOURCE_UNKNOWN", location, f"Unknown source artifact ID {source_id!r}")
        declared_data_class = target.get("data_class")
        keyword_relevant_sources = relevant_target_sources(target, "KEYWORD")
        if not is_allowed(declared_data_class, TARGET_DATA_CLASSES):
            add("ERROR", "KEYWORD_DATA_CLASS_INVALID", location, "Use a supported target data_class")
        else:
            observed_source_classes = {source.get("data_class") for source in keyword_relevant_sources}
            if not observed_source_classes.intersection(TARGET_SUPPORT_CLASSES[declared_data_class]):
                add("ERROR", "TARGET_SOURCE_TYPE_IRRELEVANT", location, "No cited source is semantically and scope-compatible keyword-target evidence")
                add("ERROR", "KEYWORD_DATA_CLASS_UNSUPPORTED", location, "Declared keyword data_class is stronger than its relevant cited source artifacts")
        upstream_keyword = upstream_keyword_by_id.get(source_keyword_id)
        if role == "NOT_PRESENT_FIRST_PARTY_QUERY":
            if target.get("data_class") != "FIRST_PARTY" or not any(source.get("data_class") == "FIRST_PARTY" for source in keyword_relevant_sources):
                add("ERROR", "FIRST_PARTY_QUERY_SOURCE_INVALID", location, "A query absent from the library requires first-party query evidence")
        elif upstream_keyword is None:
            gap("UPSTREAM_KEYWORD_GAP", location, "Keyword target is not present in the upstream keyword manifest")
        elif upstream_keyword.get("library_role") != role:
            add("ERROR", "UPSTREAM_KEYWORD_ROLE_MISMATCH", location, "Downstream library_role differs from the upstream keyword manifest")
        elif not {
            value for value in upstream_keyword.get("source_ids", []) if nonplaceholder(value)
        }.issubset({
            value for value in target.get("source_ids", []) if nonplaceholder(value)
        }) or not {
            value for value in upstream_keyword.get("evidence_ids", []) if nonplaceholder(value)
        }.issubset({
            value for value in target.get("evidence_ids", []) if nonplaceholder(value)
        }):
            add("ERROR", "UPSTREAM_KEYWORD_EVIDENCE_MISMATCH", location, "Downstream keyword must preserve all upstream source and evidence IDs")
        if upstream_keyword is not None:
            for preserved_field in ("keyword_original", "eligibility_flags", "claim_gate", "eligible_for_visible_copy", "product_fit"):
                if preserved_field in upstream_keyword and target.get(preserved_field) != upstream_keyword.get(preserved_field):
                    add("ERROR", "UPSTREAM_KEYWORD_FIELD_MISMATCH", location, f"Downstream keyword changed preserved field {preserved_field}")
        if decision == "INCLUDE":
            if not is_allowed(target.get("targeting_expression"), KEYWORD_TARGETING_EXPRESSIONS):
                add("ERROR", "KEYWORD_TARGETING_EXPRESSION_INVALID", f"{location}.targeting_expression", "Included keyword targets require BROAD, PHRASE, or EXACT")
            if is_allowed(role, BLOCKED_POSITIVE_KEYWORD_ROLES):
                add("ERROR", "KEYWORD_ROLE_POSITIVE_BLOCKED", location, f"library_role {role!r} cannot be a positive ad target")
            if is_allowed(role, REVIEW_ONLY_KEYWORD_ROLES):
                if target.get("downstream_review_eligible") is not True or target.get("ad_eligibility_review") != "APPROVED_CONTROLLED_TEST":
                    add("ERROR", "KEYWORD_REVIEW_GATE_MISSING", location, f"{role} requires downstream eligibility and an approved controlled-test review")
            if role == "LATER_STAGE_RELEVANT":
                if target.get("current_stage_eligible") is not True or not target.get("current_stage_evidence_ids"):
                    add("ERROR", "LATER_STAGE_NOT_RELEASED", location, "Current-stage evidence is required")
            proposed_bid = number(target.get("proposed_bid"), f"{location}.proposed_bid")
            bid_ceiling = number(target.get("bid_ceiling"), f"{location}.bid_ceiling")
            basis = target.get("ceiling_basis")
            if not is_allowed(basis, ALLOWED_CEILING_BASES):
                add("ERROR", "KEYWORD_CEILING_BASIS_INVALID", location, "A supported ceiling_basis is required")
            if basis == "UNAVAILABLE":
                add("ERROR", "UNAVAILABLE_CEILING_CANNOT_INCLUDE", location, "UNAVAILABLE cannot authorize a positive target")
            if basis == "APPROVED_LEARNING_LOSS":
                envelope_id = target.get("learning_loss_envelope_id")
                envelope = envelope_by_id.get(envelope_id)
                if envelope is None or target_id not in envelope.get("scope_ad_target_ids", []):
                    add("ERROR", "LEARNING_ENVELOPE_TARGET_NOT_COVERED", location, "APPROVED_LEARNING_LOSS requires an approved envelope covering this exact target")
                else:
                    target_envelope_by_id[target_id] = envelope_id
                    maximum_spend, maximum_loss = envelope_limits.get(envelope_id, (None, None))
                    if maximum_spend is None or maximum_spend <= 0 or maximum_loss is None or maximum_loss <= 0:
                        add("ERROR", "LEARNING_ENVELOPE_ZERO_CAPACITY", location, "A positive bid requires positive maximum spend and incremental-loss capacity")
                    elif (proposed_bid is not None and proposed_bid > min(maximum_spend, maximum_loss)) or (bid_ceiling is not None and bid_ceiling > min(maximum_spend, maximum_loss)):
                        add("ERROR", "LEARNING_BID_EXCEEDS_ENVELOPE", location, "A single bid or ceiling cannot exceed the experiment's total spend or loss cap")
            if proposed_bid is not None and proposed_bid < 0:
                add("ERROR", "NEGATIVE_BID", location, "proposed_bid cannot be negative")
            if bid_ceiling is not None and bid_ceiling < 0:
                add("ERROR", "NEGATIVE_BID_CEILING", location, "bid_ceiling cannot be negative")
            if proposed_bid is not None and bid_ceiling is not None and proposed_bid > bid_ceiling:
                add("ERROR", "BID_EXCEEDS_CEILING", location, "Proposed bid cannot exceed its declared bounded ceiling")
            if basis == "TARGET_PROFIT" and (calculator_target_cpc is None or (bid_ceiling is not None and bid_ceiling > calculator_target_cpc)):
                add("ERROR", "TARGET_CEILING_NOT_RECONCILED", location, "Declared target-profit bid ceiling cannot exceed the calculator target CPC")
            if basis == "OPERATING_BREAK_EVEN" and (calculator_break_even_cpc is None or (bid_ceiling is not None and bid_ceiling > calculator_break_even_cpc)):
                add("ERROR", "BREAK_EVEN_CEILING_NOT_RECONCILED", location, "Declared break-even bid ceiling cannot exceed the calculator break-even CPC")

    product_targets = require_list(data.get("product_targets", []), add, "PRODUCT_TARGETS_INVALID", "product_targets")
    product_target_ids: set[str] = set()
    downstream_competitor_orders: set[int] = set()
    for index, target in enumerate(product_targets):
        location = f"product_targets[{index}]"
        if not isinstance(target, dict):
            add("ERROR", "PRODUCT_TARGET_INVALID", location, "Product target must be an object")
            continue
        target_id = target.get("ad_target_id")
        if nonplaceholder(target_id):
            if target_id in product_target_ids or target_id in keyword_target_ids:
                add("ERROR", "AD_TARGET_ID_DUPLICATE", location, f"Duplicate ad_target_id {target_id!r}")
            product_target_ids.add(target_id)
        else:
            add("ERROR", "AD_TARGET_ID_MISSING", location, "ad_target_id is required")
        decision = target.get("ad_decision")
        if not is_allowed(decision, {"INCLUDE", "OBSERVE", "EXCLUDE"}):
            add("ERROR", "PRODUCT_AD_DECISION_INVALID", location, "ad_decision must be INCLUDE, OBSERVE, or EXCLUDE")
        elif nonplaceholder(target_id):
            target_decision_by_id[target_id] = decision
        if not is_allowed(target.get("ad_role"), ALLOWED_AD_ROLES):
            add("ERROR", "PRODUCT_AD_ROLE_INVALID", location, "Use a supported separate ad_role")
        elif (decision == "INCLUDE" and is_allowed(target.get("ad_role"), {"OBSERVE", "EXCLUDE"})) or (is_allowed(decision, {"OBSERVE", "EXCLUDE"}) and target.get("ad_role") != decision):
            add("ERROR", "PRODUCT_AD_ROLE_DECISION_CONTRADICTION", location, "ad_role must agree with the INCLUDE, OBSERVE, or EXCLUDE decision")
        for field in ("competitor_source_role", "competitor_primary_role", "competitor_roles", "competitor_lock_status", "source_order"):
            if field not in target:
                add("ERROR", "COMPETITOR_AXIS_MISSING", location, f"Preserve upstream {field}")
        if target.get("competitor_roles") is not None and not isinstance(target.get("competitor_roles"), list):
            add("ERROR", "COMPETITOR_ROLES_INVALID", location, "competitor_roles must be an array")
        if not is_allowed(target.get("competitor_source_role"), COMPETITOR_SOURCE_ROLES):
            add("ERROR", "COMPETITOR_SOURCE_ROLE_INVALID", location, "Unknown competitor_source_role")
        if not is_allowed(target.get("competitor_primary_role"), COMPETITOR_PRIMARY_ROLES):
            add("ERROR", "COMPETITOR_PRIMARY_ROLE_INVALID", location, "Unknown competitor_primary_role")
        if any(not is_allowed(role, COMPETITOR_PRIMARY_ROLES) for role in target.get("competitor_roles", []) if isinstance(target.get("competitor_roles"), list)):
            add("ERROR", "COMPETITOR_ROLES_INVALID", location, "competitor_roles contains an unknown role")
        if not is_allowed(target.get("competitor_lock_status"), COMPETITOR_LOCK_STATUSES):
            add("ERROR", "COMPETITOR_LOCK_STATUS_INVALID", location, "Unknown competitor_lock_status")
        source_order = target.get("source_order")
        if isinstance(source_order, bool) or not isinstance(source_order, int) or source_order < 1:
            add("ERROR", "COMPETITOR_SOURCE_ORDER_INVALID", location, "source_order must be a positive whole number")
        elif source_order in downstream_competitor_orders:
            add("ERROR", "COMPETITOR_SOURCE_ORDER_DUPLICATE", location, "source_order must be unique")
        else:
            downstream_competitor_orders.add(source_order)
        if not nonplaceholder(target.get("asin")) or not nonempty(target.get("decision_reason")):
            add("ERROR", "PRODUCT_DECISION_TRACE_MISSING", location, "Every product-target decision requires ASIN and reason")
        for field in ("source_ids", "evidence_ids"):
            values = target.get(field)
            if not isinstance(values, list) or not values or any(not nonplaceholder(value) for value in values):
                add("ERROR", "PRODUCT_EVIDENCE_MISSING", location, f"{field} must be a non-empty array of non-placeholder strings for every decision")
        for source_id in target.get("source_ids", []) if isinstance(target.get("source_ids"), list) else []:
            if not nonplaceholder(source_id):
                continue
            if source_id not in source_artifact_ids:
                add("ERROR", "PRODUCT_SOURCE_UNKNOWN", location, f"Unknown source artifact ID {source_id!r}")
        declared_data_class = target.get("data_class")
        product_relevant_sources = relevant_target_sources(target, "PRODUCT")
        if not is_allowed(declared_data_class, TARGET_DATA_CLASSES):
            add("ERROR", "PRODUCT_DATA_CLASS_INVALID", location, "Use a supported target data_class")
        else:
            observed_source_classes = {source.get("data_class") for source in product_relevant_sources}
            if not observed_source_classes.intersection(TARGET_SUPPORT_CLASSES[declared_data_class]):
                add("ERROR", "TARGET_SOURCE_TYPE_IRRELEVANT", location, "No cited source is semantically and scope-compatible product-target evidence")
                add("ERROR", "PRODUCT_DATA_CLASS_UNSUPPORTED", location, "Declared product-target data_class is stronger than its relevant cited source artifacts")
        upstream_competitor = upstream_competitor_by_asin.get(target.get("asin"))
        if upstream_competitor is None:
            gap("UPSTREAM_COMPETITOR_GAP", location, "Product target is not present in the locked competitor manifest")
        else:
            comparisons = {
                "competitor_source_role": "source_role",
                "competitor_primary_role": "primary_role",
                "competitor_roles": "roles",
                "competitor_lock_status": "lock_status",
                "source_order": "source_order",
            }
            for downstream_field, upstream_field in comparisons.items():
                if target.get(downstream_field) != upstream_competitor.get(upstream_field):
                    add("ERROR", "UPSTREAM_COMPETITOR_AXIS_MISMATCH", location, f"{downstream_field} differs from competitor_lock")
        if decision == "INCLUDE":
            if is_allowed(target.get("competitor_lock_status"), BLOCKED_PRODUCT_TARGET_ROLES):
                add("ERROR", "PRODUCT_ROLE_POSITIVE_BLOCKED", location, "This competitor role is not a positive product-target source")
            for field in ("asin", "competitor_source_role", "competitor_primary_role", "competitor_lock_status", "ad_role", "decision_reason"):
                if not nonempty(target.get(field)):
                    add("ERROR", "INCLUDED_PRODUCT_FIELD_MISSING", location, f"{field} is required")
            proposed_bid = number(target.get("proposed_bid"), f"{location}.proposed_bid")
            bid_ceiling = number(target.get("bid_ceiling"), f"{location}.bid_ceiling")
            basis = target.get("ceiling_basis")
            if not is_allowed(basis, ALLOWED_CEILING_BASES):
                add("ERROR", "PRODUCT_CEILING_BASIS_INVALID", location, "A supported ceiling_basis is required")
            if basis == "UNAVAILABLE":
                add("ERROR", "PRODUCT_UNAVAILABLE_CEILING_CANNOT_INCLUDE", location, "UNAVAILABLE cannot authorize a positive product target")
            if basis == "APPROVED_LEARNING_LOSS":
                envelope_id = target.get("learning_loss_envelope_id")
                envelope = envelope_by_id.get(envelope_id)
                if envelope is None or target_id not in envelope.get("scope_ad_target_ids", []):
                    add("ERROR", "PRODUCT_LEARNING_ENVELOPE_NOT_COVERED", location, "APPROVED_LEARNING_LOSS requires an approved envelope covering this exact target")
                else:
                    target_envelope_by_id[target_id] = envelope_id
                    maximum_spend, maximum_loss = envelope_limits.get(envelope_id, (None, None))
                    if maximum_spend is None or maximum_spend <= 0 or maximum_loss is None or maximum_loss <= 0:
                        add("ERROR", "PRODUCT_LEARNING_ENVELOPE_ZERO_CAPACITY", location, "A positive bid requires positive maximum spend and incremental-loss capacity")
                    elif (proposed_bid is not None and proposed_bid > min(maximum_spend, maximum_loss)) or (bid_ceiling is not None and bid_ceiling > min(maximum_spend, maximum_loss)):
                        add("ERROR", "PRODUCT_LEARNING_BID_EXCEEDS_ENVELOPE", location, "A single bid or ceiling cannot exceed the experiment's total spend or loss cap")
            if proposed_bid is not None and proposed_bid < 0:
                add("ERROR", "NEGATIVE_PRODUCT_BID", location, "proposed_bid cannot be negative")
            if bid_ceiling is not None and bid_ceiling < 0:
                add("ERROR", "NEGATIVE_PRODUCT_BID_CEILING", location, "bid_ceiling cannot be negative")
            if proposed_bid is not None and bid_ceiling is not None and proposed_bid > bid_ceiling:
                add("ERROR", "PRODUCT_BID_EXCEEDS_CEILING", location, "Proposed product-target bid cannot exceed its declared bounded ceiling")
            if basis == "TARGET_PROFIT" and (calculator_target_cpc is None or (bid_ceiling is not None and bid_ceiling > calculator_target_cpc)):
                add("ERROR", "PRODUCT_TARGET_CEILING_NOT_RECONCILED", location, "Declared target-profit bid ceiling cannot exceed the calculator target CPC")
            if basis == "OPERATING_BREAK_EVEN" and (calculator_break_even_cpc is None or (bid_ceiling is not None and bid_ceiling > calculator_break_even_cpc)):
                add("ERROR", "PRODUCT_BREAK_EVEN_CEILING_NOT_RECONCILED", location, "Declared break-even bid ceiling cannot exceed the calculator break-even CPC")

    all_target_ids = keyword_target_ids | product_target_ids
    for envelope_id, envelope in envelope_by_id.items():
        for target_id in envelope.get("scope_ad_target_ids", []):
            if target_id not in all_target_ids:
                add("ERROR", "LEARNING_ENVELOPE_TARGET_UNKNOWN", "economics.approved_learning_loss_envelopes", f"Envelope {envelope_id!r} cites unknown target {target_id!r}")
    architecture = require_list(data.get("campaign_architecture", []), add, "ARCHITECTURE_INVALID", "campaign_architecture")
    selected_ad_products: set[str] = set()
    architecture_by_id: dict[str, dict[str, Any]] = {}
    campaign_cap_total = Decimal("0")
    target_campaign_owner: dict[str, str] = {}
    envelope_campaign_spend_totals: dict[str, Decimal] = {}
    envelope_campaign_loss_totals: dict[str, Decimal] = {}
    for index, row in enumerate(architecture):
        location = f"campaign_architecture[{index}]"
        if not isinstance(row, dict):
            add("ERROR", "CAMPAIGN_ROW_INVALID", location, "Campaign row must be an object")
            continue
        unknown_campaign_fields = set(row) - CAMPAIGN_ARCHITECTURE_ALLOWED_FIELDS
        if unknown_campaign_fields:
            add("ERROR", "CAMPAIGN_FIELD_NOT_ALLOWLISTED", location, f"Unknown campaign fields fail closed: {', '.join(sorted(str(field) for field in unknown_campaign_fields))}")
        if contains_offsite_change(row):
            add("ERROR", "CAMPAIGN_OFFSITE_SCOPE_INVALID", location, "Campaign architecture cannot contain or imply off-Amazon delivery")
        suspicious_campaign_scope_fields = unrecognized_scope_fields(row)
        if suspicious_campaign_scope_fields:
            add("ERROR", "CAMPAIGN_FIELD_NOT_ALLOWLISTED", location, f"Unknown reach/supply/inventory scope fields fail closed: {', '.join(suspicious_campaign_scope_fields)}")
        for field in ("campaign_plan_id", "ad_product", "objective", "budget_period"):
            if not nonempty(row.get(field)):
                add("ERROR", "CAMPAIGN_FIELD_MISSING", location, f"{field} is required")
        if not nonplaceholder(row.get("bid_strategy")):
            add("ERROR", "CAMPAIGN_BID_STRATEGY_INVALID", f"{location}.bid_strategy", "bid_strategy must be a non-placeholder normalized planning string")
        if not isinstance(row.get("evidence_ids"), list) or not row.get("evidence_ids") or any(not nonplaceholder(item) for item in row.get("evidence_ids", [])):
            add("ERROR", "CAMPAIGN_EVIDENCE_INVALID", f"{location}.evidence_ids", "Campaign rows require a non-empty array of evidence IDs")
        if not is_allowed(row.get("budget_period"), {"DAILY", "LIFETIME", "OTHER_VERIFIED"}):
            add("ERROR", "CAMPAIGN_BUDGET_PERIOD_INVALID", location, "Use DAILY, LIFETIME, or OTHER_VERIFIED")
        targeting_type = row.get("targeting_type")
        ad_product = row.get("ad_product")
        allowed_targeting_types = TARGETING_TYPES_BY_AD_PRODUCT.get(ad_product, set()) if isinstance(ad_product, str) else set()
        if not is_allowed(targeting_type, allowed_targeting_types):
            add("ERROR", "CAMPAIGN_TARGETING_TYPE_INVALID", f"{location}.targeting_type", "Use a canonical targeting type supported by the declared ad product")
        campaign_plan_id = row.get("campaign_plan_id")
        if not nonplaceholder(campaign_plan_id):
            add("ERROR", "CAMPAIGN_PLAN_ID_MISSING", location, "campaign_plan_id must be a non-placeholder stable ID")
        if nonplaceholder(campaign_plan_id):
            if campaign_plan_id in architecture_by_id:
                add("ERROR", "CAMPAIGN_PLAN_ID_DUPLICATE", location, f"Duplicate campaign_plan_id {campaign_plan_id!r}")
            architecture_by_id[campaign_plan_id] = row
        selected_ad_products.add(str(row.get("ad_product", "")))
        if row.get("onsite_scope") != "AMAZON_ONLY" or row.get("placement_scope_verified") != "VERIFIED_CURRENT":
            add("ERROR", "OFFSITE_SCOPE_NOT_BLOCKED", location, "Every included campaign must be verified Amazon-only")
        policy_source_id = row.get("placement_policy_source_id")
        account_source_id = row.get("placement_account_source_id")
        policy_source = source_artifact_by_id.get(policy_source_id)
        account_source = source_artifact_by_id.get(account_source_id)
        if policy_source is None or policy_source.get("data_class") != "OFFICIAL_POLICY" or policy_source.get("artifact_type") != "official_policy":
            add("ERROR", "PLACEMENT_POLICY_PROOF_INVALID", location, "Amazon-only placement requires a current official-policy source artifact")
        elif policy_source.get("marketplace") not in (data.get("marketplace"), "GLOBAL") or not isinstance(policy_source.get("ad_products"), list) or row.get("ad_product") not in policy_source.get("ad_products", []) or not isinstance(policy_source.get("policy_domains"), list) or "PLACEMENT_SCOPE" not in policy_source.get("policy_domains", []):
            add("ERROR", "PLACEMENT_POLICY_SCOPE_MISMATCH", location, "Placement policy proof must cover placement scope and apply to this marketplace and ad product")
        else:
            verify_source_freshness(policy_source, f"{location}.placement_policy_source_id", MAX_POLICY_AGE, "PLACEMENT_POLICY_SOURCE_STALE")
        if account_source is None or account_source.get("data_class") != "FIRST_PARTY" or not is_allowed(account_source.get("artifact_type"), PLACEMENT_ACCOUNT_ARTIFACT_TYPES):
            add("ERROR", "PLACEMENT_ACCOUNT_PROOF_INVALID", location, "Amazon-only placement requires a current first-party account source artifact")
        elif account_source.get("marketplace") != data.get("marketplace") or account_source.get("account_id_masked") != scope.get("account_id_masked"):
            add("ERROR", "PLACEMENT_ACCOUNT_SCOPE_MISMATCH", location, "Placement account proof must match marketplace and account scope")
        elif row.get("ad_product") not in account_source.get("ad_products", []) or not isinstance(account_source.get("onsite_only_controls"), dict) or account_source["onsite_only_controls"].get(row.get("ad_product")) != "VERIFIED_CURRENT":
            add("ERROR", "PLACEMENT_ACCOUNT_CONTROL_MISSING", location, "Account proof must explicitly contain the verified Amazon-only control for this ad product")
        else:
            verify_source_freshness(account_source, f"{location}.placement_account_source_id", MAX_ACCOUNT_SNAPSHOT_AGE, "PLACEMENT_ACCOUNT_SOURCE_STALE")
        if not nonempty(row.get("placement_verified_at")):
            add("ERROR", "PLACEMENT_VERIFICATION_TIME_MISSING", location, "placement_verified_at is required")
        else:
            placement_verified_at = timestamp(row.get("placement_verified_at"), f"{location}.placement_verified_at")
            if placement_verified_at is not None and package_captured_at is not None:
                placement_age = package_captured_at - placement_verified_at
                if placement_age < timedelta(0) or placement_age > MAX_ACCOUNT_SNAPSHOT_AGE:
                    add("ERROR", "PLACEMENT_VERIFICATION_STALE", location, "Campaign placement verification must be within the validator's 24-hour package safety window")
        source_target_ids = row.get("source_ad_target_ids", [])
        campaign_envelope_ids: set[str] = set()
        if not isinstance(source_target_ids, list):
            add("ERROR", "CAMPAIGN_TARGET_IDS_INVALID", location, "source_ad_target_ids must be an array")
        else:
            required_target_kind = SOURCE_TARGET_KIND_BY_TARGETING_TYPE.get(targeting_type) if isinstance(targeting_type, str) else None
            if required_target_kind is not None and not source_target_ids:
                add("ERROR", "MANUAL_CAMPAIGN_TARGETS_MISSING", location, "Keyword, product, and contextual-product campaigns require one or more exact source target IDs")
            if is_allowed(targeting_type, {"AUTOMATIC", "AUDIENCE"}) and source_target_ids:
                add("ERROR", "CAMPAIGN_TARGET_SCHEMA_UNSUPPORTED", location, "Automatic and audience campaigns cannot use keyword/product target IDs as executable target definitions")
            if any(not nonplaceholder(target_id) for target_id in source_target_ids):
                add("ERROR", "CAMPAIGN_TARGET_IDS_INVALID", location, "source_ad_target_ids must contain only non-placeholder stable string IDs")
            elif len(source_target_ids) != len(set(source_target_ids)):
                add("ERROR", "CAMPAIGN_TARGET_IDS_DUPLICATE", location, "source_ad_target_ids cannot contain duplicates")
            for target_id in source_target_ids:
                if not nonplaceholder(target_id):
                    continue
                target_is_compatible = True
                if target_id not in all_target_ids:
                    add("ERROR", "CAMPAIGN_TARGET_UNKNOWN", location, f"Unknown target ID {target_id!r}")
                    target_is_compatible = False
                elif target_decision_by_id.get(target_id) != "INCLUDE":
                    add("ERROR", "CAMPAIGN_TARGET_NOT_INCLUDED", location, f"Campaign cannot reference non-INCLUDE target {target_id!r}")
                    target_is_compatible = False
                elif required_target_kind == "KEYWORD" and target_id not in keyword_target_ids:
                    add("ERROR", "CAMPAIGN_TARGET_TYPE_MISMATCH", location, "MANUAL_KEYWORD campaigns may reference only keyword targets")
                    target_is_compatible = False
                elif required_target_kind == "PRODUCT" and target_id not in product_target_ids:
                    add("ERROR", "CAMPAIGN_TARGET_TYPE_MISMATCH", location, "Product and contextual-product campaigns may reference only product targets")
                    target_is_compatible = False
                elif required_target_kind is None:
                    add("ERROR", "CAMPAIGN_TARGET_SCHEMA_UNSUPPORTED", location, "This targeting type has no compatible keyword/product source-target schema")
                    target_is_compatible = False
                if target_is_compatible and target_id in target_campaign_owner and target_campaign_owner[target_id] != campaign_plan_id:
                    add("ERROR", "TARGET_CAMPAIGN_OWNERSHIP_CONFLICT", location, f"Target {target_id!r} already belongs to campaign {target_campaign_owner[target_id]!r}")
                elif target_is_compatible and nonplaceholder(campaign_plan_id):
                    target_campaign_owner[target_id] = campaign_plan_id
                if target_is_compatible and target_id in target_envelope_by_id:
                    campaign_envelope_ids.add(target_envelope_by_id[target_id])
        for field in ("entry_gates", "exit_gates", "rollback_conditions"):
            value = row.get(field)
            if not isinstance(value, list) or not value or any(not nonplaceholder(item) for item in value):
                add("ERROR", "CAMPAIGN_GATE_MISSING", location, f"{field} must be a non-empty array of non-placeholder gate strings")
        budget = number(row.get("proposed_budget"), f"{location}.proposed_budget")
        spend_cap = number(row.get("phase_spend_cap"), f"{location}.phase_spend_cap")
        if budget is not None and budget < 0:
            add("ERROR", "NEGATIVE_BUDGET", location, "proposed_budget cannot be negative")
        if spend_cap is None or spend_cap < 0:
            add("ERROR", "PHASE_SPEND_CAP_MISSING", location, "A non-negative phase_spend_cap is required")
        else:
            campaign_cap_total += spend_cap
        if budget is not None and spend_cap is not None and budget > spend_cap:
            add("ERROR", "BUDGET_EXCEEDS_PHASE_CAP", location, "Campaign budget cannot exceed its bounded phase spend cap")
        if spend_cap is not None:
            for envelope_id in campaign_envelope_ids:
                maximum_spend = envelope_limits.get(envelope_id, (None, None))[0]
                if maximum_spend is None or spend_cap > maximum_spend:
                    add("ERROR", "CAMPAIGN_CAP_EXCEEDS_LEARNING_ENVELOPE", location, f"Campaign phase cap exceeds learning envelope {envelope_id!r}")
                envelope_campaign_spend_totals[envelope_id] = envelope_campaign_spend_totals.get(envelope_id, Decimal("0")) + spend_cap
        allocations = row.get("learning_loss_allocations", {})
        if not isinstance(allocations, dict):
            add("ERROR", "LEARNING_LOSS_ALLOCATIONS_INVALID", location, "learning_loss_allocations must be an object")
            allocations = {}
        if set(allocations) != campaign_envelope_ids:
            add("ERROR", "LEARNING_LOSS_NOT_RECONCILED", location, "Learning campaigns must allocate a positive worst-case loss cap to every and only referenced envelope")
        learning_model = row.get("learning_loss_model")
        recomputed_conservative_loss: Decimal | None = None
        if campaign_envelope_ids:
            if len(campaign_envelope_ids) != 1:
                add("ERROR", "LEARNING_CAMPAIGN_MULTI_ENVELOPE_UNSUPPORTED", location, "One learning campaign may bind only one loss envelope under the conservative full-spend model")
            if not isinstance(learning_model, dict):
                add("ERROR", "LEARNING_LOSS_MODEL_MISSING", location, "Learning campaigns require a validator-recomputable loss model")
            else:
                if (
                    learning_model.get("model_version") != "CONSERVATIVE_FULL_SPEND_V1"
                    or learning_model.get("method") != "CONSERVATIVE_FULL_SPEND"
                    or learning_model.get("formula") != "modeled_loss_at_cap = phase_spend_cap"
                ):
                    add("ERROR", "LEARNING_LOSS_MODEL_MISSING", location, "Use the closed CONSERVATIVE_FULL_SPEND_V1 formula until another auditable model is implemented")
                modeled_spend = number(learning_model.get("modeled_spend_at_cap"), f"{location}.learning_loss_model.modeled_spend_at_cap")
                modeled_loss = number(learning_model.get("modeled_loss_at_cap"), f"{location}.learning_loss_model.modeled_loss_at_cap")
                if spend_cap is not None:
                    recomputed_conservative_loss = spend_cap
                    if modeled_spend != spend_cap or modeled_loss != spend_cap:
                        add("ERROR", "LEARNING_LOSS_NOT_RECONCILED", location, "Conservative modeled spend and loss must both equal the campaign phase spend cap")
                model_source_ids = learning_model.get("source_ids")
                expected_approval_sources = {envelope_by_id.get(envelope_id, {}).get("approval_source_id") for envelope_id in campaign_envelope_ids}
                model_source_set = {source_id for source_id in model_source_ids if nonplaceholder(source_id)} if isinstance(model_source_ids, list) else set()
                if (
                    not isinstance(model_source_ids, list)
                    or not model_source_ids
                    or len(model_source_set) != len(model_source_ids)
                    or any(source_id not in source_artifact_ids for source_id in model_source_set)
                    or not expected_approval_sources.issubset(model_source_set)
                ):
                    add("ERROR", "LEARNING_LOSS_MODEL_MISSING", location, "Loss model must cite every envelope's scoped approval source")
        elif learning_model not in (None, {}):
            add("ERROR", "LEARNING_LOSS_MODEL_UNSCOPED", location, "A campaign without learning targets cannot declare a learning-loss model")
        for envelope_id, raw_allocation in allocations.items():
            allocation = number(raw_allocation, f"{location}.learning_loss_allocations.{envelope_id}")
            maximum_loss = envelope_limits.get(envelope_id, (None, None))[1]
            if allocation is None or allocation <= 0 or spend_cap is None or allocation != recomputed_conservative_loss:
                add("ERROR", "LEARNING_LOSS_NOT_RECONCILED", location, "Each allocation must equal the validator-recomputed conservative full-spend loss")
            else:
                envelope_campaign_loss_totals[envelope_id] = envelope_campaign_loss_totals.get(envelope_id, Decimal("0")) + allocation
                if maximum_loss is None or allocation > maximum_loss:
                    add("ERROR", "LEARNING_LOSS_NOT_RECONCILED", location, f"Campaign loss allocation exceeds learning envelope {envelope_id!r}")
    if strategy_total_spend_cap is not None and campaign_cap_total > strategy_total_spend_cap:
        add("ERROR", "CAMPAIGN_CAPS_EXCEED_TOTAL", "campaign_architecture", "Sum of campaign phase caps exceeds the strategy total spend cap")
    for envelope_id, aggregate_spend in envelope_campaign_spend_totals.items():
        maximum_spend, maximum_loss = envelope_limits.get(envelope_id, (None, None))
        if maximum_spend is None or aggregate_spend > maximum_spend:
            add("ERROR", "LEARNING_ENVELOPE_AGGREGATE_SPEND_EXCEEDED", "campaign_architecture", f"Aggregate campaign caps exceed learning envelope {envelope_id!r}")
        aggregate_loss = envelope_campaign_loss_totals.get(envelope_id, Decimal("0"))
        if maximum_loss is None or aggregate_loss <= 0 or aggregate_loss > maximum_loss:
            add("ERROR", "LEARNING_ENVELOPE_AGGREGATE_LOSS_EXCEEDED", "campaign_architecture", f"Aggregate modeled loss must be positive and remain within learning envelope {envelope_id!r}")
    included_target_ids = {target_id for target_id, decision in target_decision_by_id.items() if decision == "INCLUDE"}
    missing_campaign_owners = sorted(included_target_ids - set(target_campaign_owner))
    if traffic_ready_status and missing_campaign_owners:
        add("ERROR", "INCLUDED_TARGET_CAMPAIGN_MISSING", "campaign_architecture", f"Included targets without exactly one campaign owner: {', '.join(missing_campaign_owners)}")

    routing_rules = require_list(data.get("routing_rules", []), add, "ROUTING_RULES_INVALID", "routing_rules")
    routing_rule_ids: set[str] = set()
    routing_rule_by_id: dict[str, dict[str, Any]] = {}
    for index, rule in enumerate(routing_rules):
        location = f"routing_rules[{index}]"
        if not isinstance(rule, dict):
            add("ERROR", "ROUTING_RULE_INVALID", location, "Routing rule must be an object")
            continue
        rule_id = rule.get("routing_rule_id")
        if not nonplaceholder(rule_id):
            add("ERROR", "ROUTING_RULE_ID_MISSING", location, "routing_rule_id must be a non-placeholder stable ID")
        elif rule_id in routing_rule_ids:
            add("ERROR", "ROUTING_RULE_ID_DUPLICATE", location, f"Duplicate routing rule ID {rule_id!r}")
        else:
            routing_rule_ids.add(rule_id)
            routing_rule_by_id[rule_id] = rule
        if not is_allowed(rule.get("rule_type"), ALLOWED_ROUTING_RULE_TYPES):
            add("ERROR", "ROUTING_RULE_TYPE_INVALID", location, "Unknown routing rule type")
        if not nonempty(rule.get("rationale")):
            add("ERROR", "ROUTING_RULE_RATIONALE_MISSING", location, "Routing rule requires a rationale")
        source_ids = rule.get("source_ad_target_ids")
        campaign_ids = rule.get("applies_to_campaign_plan_ids")
        evidence_ids = rule.get("evidence_ids")
        if not isinstance(source_ids, list) or not source_ids or any(target_id not in all_target_ids for target_id in source_ids):
            add("ERROR", "ROUTING_RULE_TARGETS_INVALID", location, "Routing rule requires valid source target IDs")
        if not isinstance(campaign_ids, list) or not campaign_ids or any(campaign_id not in architecture_by_id for campaign_id in campaign_ids):
            add("ERROR", "ROUTING_RULE_CAMPAIGNS_INVALID", location, "Routing rule requires valid campaign plan IDs")
        if not isinstance(evidence_ids, list) or not evidence_ids:
            add("ERROR", "ROUTING_RULE_EVIDENCE_MISSING", location, "Routing rule requires evidence IDs")
    for index, row in enumerate(architecture):
        if not isinstance(row, dict):
            continue
        refs = row.get("negative_routing_rule_ids")
        location = f"campaign_architecture[{index}].negative_routing_rule_ids"
        if not isinstance(refs, list):
            add("ERROR", "CAMPAIGN_ROUTING_REFS_INVALID", location, "negative_routing_rule_ids must be an array")
            continue
        for rule_id in refs:
            rule = routing_rule_by_id.get(rule_id)
            if rule is None:
                add("ERROR", "CAMPAIGN_ROUTING_RULE_UNKNOWN", location, f"Unknown routing rule ID {rule_id!r}")
            elif row.get("campaign_plan_id") not in rule.get("applies_to_campaign_plan_ids", []):
                add("ERROR", "CAMPAIGN_ROUTING_RULE_SCOPE_MISMATCH", location, "Routing rule does not apply to this campaign")
    for collection_name, targets in (("keyword_targets", keyword_targets), ("product_targets", product_targets)):
        for index, target in enumerate(targets):
            if not isinstance(target, dict):
                continue
            refs = target.get("negative_routing", [])
            if not isinstance(refs, list):
                add("ERROR", "TARGET_ROUTING_REFS_INVALID", f"{collection_name}[{index}].negative_routing", "negative_routing must be an array of routing rule IDs")
            else:
                for rule_id in refs:
                    if rule_id not in routing_rule_ids:
                        add("ERROR", "TARGET_ROUTING_RULE_UNKNOWN", f"{collection_name}[{index}].negative_routing", f"Unknown routing rule ID {rule_id!r}")
    for source_keyword_id, duplicated_target_ids in source_keyword_target_ids.items():
        if len(duplicated_target_ids) < 2:
            continue
        duplicate_target_set = set(duplicated_target_ids)
        owner_set = {target_campaign_owner.get(target_id) for target_id in duplicate_target_set}
        routing_contract_present = any(
            is_allowed(rule.get("rule_type"), {"QUERY_ROUTING", "MUTUAL_EXCLUSION"})
            and duplicate_target_set.issubset({value for value in rule.get("source_ad_target_ids", []) if nonplaceholder(value)})
            and owner_set.issubset({value for value in rule.get("applies_to_campaign_plan_ids", []) if nonplaceholder(value)})
            for rule in routing_rule_by_id.values()
            if isinstance(rule.get("source_ad_target_ids"), list) and isinstance(rule.get("applies_to_campaign_plan_ids"), list)
        )
        if not routing_contract_present:
            add("ERROR", "DUPLICATE_SOURCE_KEYWORD_ROUTING_MISSING", "keyword_targets", f"Repeated source_keyword_id {source_keyword_id!r} requires one explicit query-routing or mutual-exclusion contract across every owner")
    if strategy_mode == "EXISTING_PRODUCT_OPTIMIZATION" and traffic_ready_status:
        declared_performance_products = set(performance_basis.get("ad_products", [])) if isinstance(performance_basis, dict) and isinstance(performance_basis.get("ad_products"), list) else set()
        if declared_performance_products != selected_ad_products:
            add("ERROR", "PERFORMANCE_CAMPAIGN_PRODUCT_MISMATCH", "economics.performance_basis.ad_products", "Existing-product economics and the proposed campaign architecture must use the same ad-product set")

    ad_products = account.get("ad_products", {})
    if not isinstance(ad_products, dict):
        add("ERROR", "AD_PRODUCTS_INVALID", "account_snapshot.ad_products", "ad_products must be an object")
        ad_products = {}
    for ad_product in selected_ad_products:
        if ad_products.get(ad_product) != "ELIGIBLE":
            add("ERROR", "AD_PRODUCT_NOT_ELIGIBLE", "account_snapshot.ad_products", f"Selected ad product {ad_product!r} is not currently ELIGIBLE")
        onsite_controls = account.get("onsite_only_controls", {})
        if not isinstance(onsite_controls, dict) or onsite_controls.get(ad_product) != "VERIFIED_CURRENT":
            add("ERROR", "ACCOUNT_ONSITE_CONTROL_UNVERIFIED", "account_snapshot.onsite_only_controls", f"Amazon-only control for {ad_product!r} is not currently verified")

    phases = require_list(data.get("phase_plan", []), add, "PHASE_PLAN_INVALID", "phase_plan")
    phase_states: set[str] = set()
    phase_state_counts: dict[str, int] = {}
    phase_next_states_by_state: dict[str, set[str]] = {}
    allowed_phase_states = set(PHASE_STATES_BY_MODE.get(strategy_mode, ()))
    phase_ids: set[str] = set()
    phase_rule_refs: set[str] = set()
    phase_next_state_refs: set[str] = set()
    phase_cap_total = Decimal("0")
    for index, phase in enumerate(phases):
        location = f"phase_plan[{index}]"
        if not isinstance(phase, dict):
            add("ERROR", "PHASE_INVALID", location, "Phase must be an object")
            continue
        unknown_phase_fields = set(phase) - PHASE_PLAN_ALLOWED_FIELDS
        if unknown_phase_fields:
            add("ERROR", "PHASE_FIELD_NOT_ALLOWLISTED", location, f"Unknown phase fields fail closed: {', '.join(sorted(str(field) for field in unknown_phase_fields))}")
        if contains_offsite_change(phase) or unrecognized_scope_fields(phase):
            add("ERROR", "PHASE_FIELD_NOT_ALLOWLISTED", location, "Phase rows cannot contain off-Amazon or unknown delivery-scope controls")
        state = phase.get("state")
        if not is_allowed(state, allowed_phase_states):
            add("ERROR", "PHASE_STATE_INVALID", f"{location}.state", "Use a canonical phase state for the selected new-product or existing-product mode")
        else:
            phase_states.add(state)
            phase_state_counts[state] = phase_state_counts.get(state, 0) + 1
        for field in ("phase_id", "state", "objective"):
            if not nonempty(phase.get(field)):
                add("ERROR", "PHASE_FIELD_MISSING", location, f"{field} is required")
        phase_id = phase.get("phase_id")
        if not nonplaceholder(phase_id):
            add("ERROR", "PHASE_ID_MISSING", location, "phase_id must be a non-placeholder stable ID")
        if nonplaceholder(phase_id):
            if phase_id in phase_ids:
                add("ERROR", "PHASE_ID_DUPLICATE", location, f"Duplicate phase_id {phase_id!r}")
            phase_ids.add(phase_id)
        if not isinstance(phase.get("planned_actions"), list) or not phase.get("planned_actions") or any(not nonplaceholder(item) for item in phase.get("planned_actions", [])):
            add("ERROR", "PHASE_ACTIONS_MISSING", location, "planned_actions must be a non-empty array of non-placeholder action strings")
        if not nonempty(phase.get("attribution_completion_requirement")):
            add("ERROR", "PHASE_ATTRIBUTION_REQUIREMENT_MISSING", location, "attribution_completion_requirement is required")
        for field in ("entry_gates", "data_sufficiency_rule_ids", "exit_gates", "rollback_conditions", "next_states"):
            value = phase.get(field)
            if not isinstance(value, list) or (field != "next_states" and not value) or any(not nonplaceholder(item) for item in value if isinstance(value, list)):
                add("ERROR", "PHASE_GATE_MISSING", location, f"{field} must be an appropriate array of non-placeholder state/control IDs")
        if isinstance(phase.get("data_sufficiency_rule_ids"), list):
            phase_rule_refs.update(value for value in phase["data_sufficiency_rule_ids"] if nonplaceholder(value))
        if isinstance(phase.get("next_states"), list):
            valid_next_states = {value for value in phase["next_states"] if nonplaceholder(value)}
            phase_next_state_refs.update(valid_next_states)
            if is_allowed(state, allowed_phase_states):
                phase_next_states_by_state[state] = valid_next_states
        cap = number(phase.get("phase_spend_cap"), f"{location}.phase_spend_cap")
        if cap is None or cap < 0:
            add("ERROR", "PHASE_CAP_INVALID", location, "phase_spend_cap is required and non-negative")
        else:
            phase_cap_total += cap
        inventory_floor = number(phase.get("inventory_floor"), f"{location}.inventory_floor")
        if inventory_floor is None or inventory_floor < 0:
            add("ERROR", "PHASE_INVENTORY_FLOOR_INVALID", location, "inventory_floor is required and non-negative")
    if traffic_ready_status and is_allowed(deliverable_mode, {"PLAN", "REFRESH", "PREPARE_CHANGES", "EXECUTE"}):
        expected_states = set(PHASE_STATES_BY_MODE.get(strategy_mode, ()))
        if phase_states != expected_states or any(phase_state_counts.get(state, 0) != 1 for state in expected_states) or len(phases) != len(expected_states):
            add("ERROR", "PHASE_STATE_INVALID", "phase_plan", "Traffic-ready plans require exactly one row for every canonical phase state and no extras")
        allowed_transitions = PHASE_TRANSITIONS_BY_MODE.get(strategy_mode, {})
        for state in expected_states:
            declared_next = phase_next_states_by_state.get(state, set())
            expected_next = allowed_transitions.get(state, set())
            if expected_next and not declared_next:
                add("ERROR", "PHASE_NEXT_STATE_MISSING", "phase_plan", f"Non-terminal phase {state} requires its canonical next state")
            if declared_next != expected_next:
                add("ERROR", "PHASE_TRANSITION_INVALID", "phase_plan", f"Phase {state} must transition only to {', '.join(sorted(expected_next)) if expected_next else 'no next state'}")
    if strategy_total_spend_cap is not None and phase_cap_total > strategy_total_spend_cap:
        add("ERROR", "PHASE_CAPS_EXCEED_TOTAL", "phase_plan", "Sum of phase spend caps exceeds the strategy total spend cap")

    decision_rules = require_list(data.get("decision_rules", []), add, "DECISION_RULES_INVALID", "decision_rules")
    if deliverable_mode == "PLAN" and not decision_rules:
        add("ERROR", "DECISION_RULES_MISSING", "decision_rules", "A complete plan requires decision rules")
    decision_rule_ids: set[str] = set()
    for index, rule in enumerate(decision_rules):
        location = f"decision_rules[{index}]"
        if not isinstance(rule, dict):
            add("ERROR", "DECISION_RULE_INVALID", location, "Decision rule must be an object")
            continue
        for field in ("decision_rule_id", "scope", "metric_definition", "minimum_evidence", "financial_ceiling", "condition", "proposed_action", "rollback_condition"):
            if not nonempty(rule.get(field)):
                add("ERROR", "DECISION_RULE_FIELD_MISSING", location, f"{field} is required")
        rule_id = rule.get("decision_rule_id")
        if not nonplaceholder(rule_id):
            add("ERROR", "DECISION_RULE_ID_MISSING", location, "decision_rule_id must be a non-placeholder stable ID")
        if nonplaceholder(rule_id):
            if rule_id in decision_rule_ids:
                add("ERROR", "DECISION_RULE_ID_DUPLICATE", location, f"Duplicate decision_rule_id {rule_id!r}")
            decision_rule_ids.add(rule_id)
        if "source_snapshot_ids" not in rule or not isinstance(rule.get("source_snapshot_ids"), list):
            add("ERROR", "DECISION_RULE_SOURCES_INVALID", location, "source_snapshot_ids must be an array")
        if not nonempty(rule.get("attribution_requirement")):
            add("ERROR", "DECISION_RULE_ATTRIBUTION_MISSING", location, "attribution_requirement is required")
    for rule_id in phase_rule_refs:
        if rule_id not in decision_rule_ids:
            add("ERROR", "PHASE_RULE_REFERENCE_UNKNOWN", "phase_plan", f"Unknown decision rule ID {rule_id!r}")
    for state in phase_next_state_refs:
        if state not in phase_states:
            add("ERROR", "PHASE_NEXT_STATE_UNKNOWN", "phase_plan", f"Unknown next state {state!r}")

    if strategy_mode == "EXISTING_PRODUCT_OPTIMIZATION" and traffic_ready_status:
        performance_basis = require_dict(performance_basis, add, "PERFORMANCE_BASIS_INVALID", "economics.performance_basis")
        for field in ("charge_type", "interaction_scope", "sales_scope", "entity_scope", "attribution_window"):
            if not nonplaceholder(performance_basis.get(field)):
                add("ERROR", "PERFORMANCE_BASIS_FIELD_MISSING", f"economics.performance_basis.{field}", f"{field} is required")
        if not isinstance(performance_basis.get("ad_products"), list) or not performance_basis.get("ad_products"):
            add("ERROR", "PERFORMANCE_BASIS_AD_PRODUCTS_MISSING", "economics.performance_basis.ad_products", "Existing economics must declare its exact ad-product basis")
        if not is_allowed(performance_basis.get("entity_scope"), PERFORMANCE_ENTITY_SCOPES):
            add("ERROR", "PERFORMANCE_ENTITY_SCOPE_INVALID", "economics.performance_basis.entity_scope", "Use a canonical supported performance entity scope")
        if performance_basis.get("attribution_window") not in attribution_policy_windows:
            add("ERROR", "PERFORMANCE_ATTRIBUTION_WINDOW_UNVERIFIED", "economics.performance_basis.attribution_window", "The exact attribution window must be covered by the current attribution-policy artifact")
        if performance_basis.get("charge_type") != "CPC" or performance_basis.get("interaction_scope") != "CLICK" or performance_basis.get("sales_scope") != "PROMOTED":
            add("ERROR", "ECONOMICS_PERFORMANCE_BASIS_UNSUPPORTED", "economics.performance_basis", "The current calculator's actual CPC/CVR model supports only CPC, CLICK, PROMOTED performance")

    performance = require_list(data.get("performance_snapshots", []), add, "PERFORMANCE_INVALID", "performance_snapshots")
    complete_first_party = 0
    performance_ids: set[str] = set()
    complete_first_party_ids: set[str] = set()
    performance_by_id: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(performance):
        location = f"performance_snapshots[{index}]"
        if not isinstance(row, dict):
            add("ERROR", "PERFORMANCE_ROW_INVALID", location, "Performance snapshot must be an object")
            continue
        snapshot_id = row.get("performance_snapshot_id")
        if not nonplaceholder(snapshot_id):
            add("ERROR", "PERFORMANCE_ID_MISSING", location, "performance_snapshot_id is required")
        elif snapshot_id in performance_ids:
            add("ERROR", "PERFORMANCE_ID_DUPLICATE", location, f"Duplicate performance_snapshot_id {snapshot_id!r}")
        else:
            performance_ids.add(snapshot_id)
            performance_by_id[snapshot_id] = row
        for field in ("marketplace", "currency", "scope_id", "ad_product", "charge_type", "window_start", "window_end", "report_generated_at", "data_through_date", "attribution_window", "interaction_scope", "sales_scope", "entity_scope"):
            if not nonempty(row.get(field)):
                add("ERROR", "PERFORMANCE_FIELD_MISSING", location, f"{field} is required")
        parsed_dates: dict[str, date] = {}
        for field in ("window_start", "window_end", "data_through_date"):
            if nonempty(row.get(field)):
                try:
                    parsed_dates[field] = parse_iso_date(row.get(field), f"{location}.{field}")
                except ValueError as exc:
                    add("ERROR", "PERFORMANCE_DATE_INVALID", f"{location}.{field}", str(exc))
        report_generated_at = timestamp(row.get("report_generated_at"), f"{location}.report_generated_at") if nonempty(row.get("report_generated_at")) else None
        if "window_start" in parsed_dates and "window_end" in parsed_dates and parsed_dates["window_start"] > parsed_dates["window_end"]:
            add("ERROR", "PERFORMANCE_DATE_ORDER_INVALID", location, "window_start cannot follow window_end")
        if "window_end" in parsed_dates and "data_through_date" in parsed_dates and parsed_dates["window_end"] > parsed_dates["data_through_date"]:
            add("ERROR", "PERFORMANCE_DATE_ORDER_INVALID", location, "window_end cannot follow data_through_date")
        if report_generated_at is not None:
            if "data_through_date" in parsed_dates and parsed_dates["data_through_date"] > report_generated_at.date():
                add("ERROR", "PERFORMANCE_DATE_ORDER_INVALID", location, "data_through_date cannot follow report_generated_at")
            if package_captured_at is not None and report_generated_at > package_captured_at + MAX_CLOCK_SKEW:
                add("ERROR", "PERFORMANCE_REPORT_FUTURE", location, "Performance report cannot be generated after the strategy capture time")
            if snapshot_id in economics_performance_ids and package_captured_at is not None:
                report_age = package_captured_at - report_generated_at
                if report_age < timedelta(0) or report_age > MAX_PERFORMANCE_SOURCE_AGE:
                    add("ERROR", "PERFORMANCE_SOURCE_STALE", location, "Binding performance report must be generated within the validator's 24-hour package safety window")
        if row.get("marketplace") != data.get("marketplace") or row.get("currency") != data.get("currency"):
            add("ERROR", "PERFORMANCE_SCOPE_MISMATCH", location, "Performance marketplace and currency must match the strategy")
        if valid_scope_ids and row.get("scope_id") not in valid_scope_ids:
            add("ERROR", "PERFORMANCE_SOURCE_ENTITY_SCOPE_MISMATCH", location, "Performance row scope_id must match the strategy ASIN or SKU")
        if row.get("data_class") != "FIRST_PARTY":
            add("ERROR", "PERFORMANCE_DATA_CLASS_INVALID", location, "Performance snapshots used for optimization must be FIRST_PARTY")
        if not is_allowed(row.get("entity_scope"), PERFORMANCE_ENTITY_SCOPES):
            add("ERROR", "PERFORMANCE_ENTITY_SCOPE_INVALID", f"{location}.entity_scope", "Use a canonical supported performance entity scope")
        if not is_allowed(row.get("attribution_status"), {"COMPLETE", "PARTIAL", "UNKNOWN"}):
            add("ERROR", "PERFORMANCE_ATTRIBUTION_INVALID", location, "Use COMPLETE, PARTIAL, or UNKNOWN")
        source_ids = row.get("source_artifact_ids")
        source_classes_valid = isinstance(source_ids, list) and bool(source_ids)
        if not source_classes_valid:
            add("ERROR", "PERFORMANCE_SOURCES_MISSING", location, "Non-empty source_artifact_ids are required")
            source_ids = []
        attribution_window_source_verified = False
        for source_id in source_ids:
            source = source_artifact_by_id.get(source_id)
            if source is None:
                add("ERROR", "PERFORMANCE_SOURCE_UNKNOWN", location, f"Unknown source artifact ID {source_id!r}")
                source_classes_valid = False
            elif source.get("data_class") != "FIRST_PARTY":
                add("ERROR", "PERFORMANCE_SOURCE_NOT_FIRST_PARTY", location, "Performance evidence cannot use SellerSprite or other estimated sources")
                source_classes_valid = False
            elif not is_allowed(source.get("artifact_type"), PERFORMANCE_ARTIFACT_TYPES):
                add("ERROR", "PERFORMANCE_SOURCE_TYPE_INVALID", location, "Performance evidence requires an Amazon Ads report or API snapshot")
                source_classes_valid = False
            elif source.get("marketplace") != data.get("marketplace") or source.get("currency") != data.get("currency") or source.get("account_id_masked") != scope.get("account_id_masked"):
                add("ERROR", "PERFORMANCE_SOURCE_SCOPE_MISMATCH", location, "Performance source marketplace, currency, and account must match the strategy")
                source_classes_valid = False
            elif valid_scope_ids and source.get("scope_id") not in valid_scope_ids:
                add("ERROR", "PERFORMANCE_SOURCE_ENTITY_SCOPE_MISMATCH", location, "Performance source scope_id must match the strategy ASIN or SKU")
                source_classes_valid = False
            else:
                declared_windows = source.get("attribution_windows")
                if isinstance(declared_windows, list) and row.get("attribution_window") in declared_windows:
                    attribution_window_source_verified = True
                if snapshot_id in economics_performance_ids:
                    source_period = (source.get("window_start"), source.get("window_end"), source.get("data_through_date"))
                    row_period = (row.get("window_start"), row.get("window_end"), row.get("data_through_date"))
                    if source_period != row_period:
                        add("ERROR", "PERFORMANCE_SOURCE_PERIOD_MISMATCH", location, "Binding report source must declare the exact row window and data-through date")
                        source_classes_valid = False
                    if source.get("report_status") != "COMPLETED" or source.get("attribution_status") != "COMPLETE":
                        add("ERROR", "PERFORMANCE_SOURCE_MATURITY_INVALID", location, "Binding report source must confirm completed retrieval and complete attribution")
                        source_classes_valid = False
                    before_count = len(findings)
                    verify_source_freshness(source, location, MAX_PERFORMANCE_SOURCE_AGE, "PERFORMANCE_SOURCE_STALE")
                    if len(findings) > before_count:
                        source_classes_valid = False
        if strategy_mode == "EXISTING_PRODUCT_OPTIMIZATION" and traffic_ready_status:
            if not attribution_window_source_verified or row.get("attribution_window") not in attribution_policy_windows:
                add("ERROR", "PERFORMANCE_ATTRIBUTION_WINDOW_UNVERIFIED", location, "The exact attribution window must be declared by both the first-party report/API metadata and current attribution policy evidence")
        if not isinstance(row.get("metrics"), dict) or not row.get("metrics"):
            add("ERROR", "PERFORMANCE_METRICS_MISSING", location, "A non-empty metrics object is required")
        else:
            for metric in ("impressions", "clicks", "orders", "spend", "attributed_sales"):
                metric_value = number(row["metrics"].get(metric), f"{location}.metrics.{metric}")
                if metric_value is None:
                    add("ERROR", "PERFORMANCE_METRIC_MISSING", location, f"{metric} is required")
                elif metric_value < 0 or (metric in {"impressions", "clicks", "orders"} and metric_value != metric_value.to_integral_value()):
                    add("ERROR", "PERFORMANCE_METRIC_INVALID", location, f"{metric} must be non-negative and counts must be whole")
        for field in ("events_in_window", "coverage_gaps"):
            if not isinstance(row.get(field), list):
                add("ERROR", "PERFORMANCE_ARRAY_INVALID", location, f"{field} must be an array")
        if isinstance(row.get("coverage_gaps"), list):
            validate_gap_rows(
                row.get("coverage_gaps"),
                f"{location}.coverage_gaps",
                "PERFORMANCE_COVERAGE_GAP_INVALID",
                "PERFORMANCE_COVERAGE_GAP_UNRESOLVED",
            )
        if row.get("attribution_status") == "COMPLETE" and source_classes_valid and nonplaceholder(snapshot_id):
            complete_first_party += 1
            complete_first_party_ids.add(snapshot_id)

    if strategy_mode == "EXISTING_PRODUCT_OPTIMIZATION" and traffic_ready_status:
        if complete_first_party == 0:
            add("ERROR", "FIRST_PARTY_PERFORMANCE_MISSING", "performance_snapshots", "Existing-product readiness requires a complete first-party snapshot")
        if not economics_performance_ids or any(snapshot_id not in complete_first_party_ids for snapshot_id in economics_performance_ids):
            add("ERROR", "ECONOMICS_FIRST_PARTY_LINK_MISSING", "economics.performance_snapshot_ids", "Actual economics must cite complete first-party performance snapshots")
        referenced_rows = [row for row in performance if isinstance(row, dict) and row.get("performance_snapshot_id") in economics_performance_ids]
        binding_periods = {(row.get("window_start"), row.get("window_end"), row.get("data_through_date")) for row in referenced_rows}
        if len(binding_periods) != 1:
            add("ERROR", "ECONOMICS_PERFORMANCE_PERIOD_MISMATCH", "economics.performance_snapshot_ids", "Binding snapshots must use one exact report window and data-through date")
        rows_by_product: dict[str, list[dict[str, Any]]] = {}
        for row in referenced_rows:
            rows_by_product.setdefault(str(row.get("ad_product")), []).append(row)
        for rows in rows_by_product.values():
            if len(rows) > 1:
                entity_ids = [row.get("entity_id") for row in rows]
                if any(not nonplaceholder(entity_id) for entity_id in entity_ids) or len(entity_ids) != len(set(entity_ids)):
                    add("ERROR", "ECONOMICS_PERFORMANCE_OVERLAP_UNRESOLVED", "economics.performance_snapshot_ids", "Multiple rows for one ad product require distinct non-placeholder entity IDs to avoid double counting")
        basis_fields = ("charge_type", "interaction_scope", "sales_scope", "entity_scope", "attribution_window")
        for row in referenced_rows:
            if any(row.get(field) != performance_basis.get(field) for field in basis_fields):
                add("ERROR", "ECONOMICS_PERFORMANCE_BASIS_MISMATCH", "economics.performance_basis", "Every cited performance snapshot must match the declared charge, interaction, sales, entity, and attribution basis")
        observed_ad_products = {row.get("ad_product") for row in referenced_rows if nonplaceholder(row.get("ad_product"))}
        declared_ad_products = set(performance_basis.get("ad_products", [])) if isinstance(performance_basis.get("ad_products"), list) else set()
        if observed_ad_products != declared_ad_products:
            add("ERROR", "ECONOMICS_PERFORMANCE_BASIS_MISMATCH", "economics.performance_basis.ad_products", "Declared ad products must exactly match the cited performance snapshots")
        if binding_input.get("attributed_sales_scope") != performance_basis.get("sales_scope"):
            add("ERROR", "ECONOMICS_PERFORMANCE_BASIS_MISMATCH", "economics.input_snapshot.attributed_sales_scope", "Calculator attributed-sales scope must match the cited performance basis")
        metric_mapping = {
            "actual_impressions": "impressions",
            "actual_clicks": "clicks",
            "actual_attributed_orders": "orders",
            "actual_ad_spend": "spend",
            "actual_ad_attributed_sales": "attributed_sales",
        }
        for input_field, metric_field in metric_mapping.items():
            reported_values = [number(row.get("metrics", {}).get(metric_field), f"performance_snapshots.metrics.{metric_field}") for row in referenced_rows]
            if reported_values and all(value is not None for value in reported_values):
                reported_total = sum((value for value in reported_values if value is not None), Decimal("0"))
                input_value = number(binding_input.get(input_field), f"economics.input_snapshot.{input_field}")
                if input_value != reported_total:
                    add("ERROR", "ECONOMICS_PERFORMANCE_RECONCILIATION_MISMATCH", "economics.input_snapshot", f"{input_field} does not reconcile to cited first-party snapshots")
        supplied_business_fields = {
            field for field in ACTUAL_BUSINESS_METRIC_SOURCE_TYPES
            if binding_input.get(field) is not None
        }
        business_source_ids = economics.get("actual_business_source_ids")
        if supplied_business_fields and (not isinstance(business_source_ids, list) or not business_source_ids):
            add("ERROR", "ACTUAL_BUSINESS_SOURCE_MISSING", "economics.actual_business_source_ids", "Non-null actual total-sales or contribution fields require exact-period business evidence")
            business_source_ids = []
        elif business_source_ids is None:
            business_source_ids = []
        elif not isinstance(business_source_ids, list):
            add("ERROR", "ACTUAL_BUSINESS_SOURCE_MISSING", "economics.actual_business_source_ids", "actual_business_source_ids must be an array")
            business_source_ids = []
        elif any(not nonplaceholder(source_id) for source_id in business_source_ids):
            add("ERROR", "ACTUAL_BUSINESS_SOURCE_MISSING", "economics.actual_business_source_ids", "Business source IDs must be non-placeholder strings")
            business_source_ids = []
        elif len(business_source_ids) != len(set(business_source_ids)):
            add("ERROR", "ACTUAL_BUSINESS_SOURCE_AMBIGUOUS", "economics.actual_business_source_ids", "Business source IDs cannot contain duplicates")

        performance_periods = {
            (row.get("window_start"), row.get("window_end"), row.get("data_through_date"))
            for row in referenced_rows
        }
        binding_performance_source_ids = {
            source_id
            for row in referenced_rows
            for source_id in row.get("source_artifact_ids", [])
            if isinstance(row.get("source_artifact_ids"), list) and nonplaceholder(source_id)
        }
        valid_raw_business_source_ids: set[str] = set()
        business_values_by_field: dict[str, list[Decimal]] = {field: [] for field in ACTUAL_BUSINESS_METRIC_SOURCE_TYPES}
        ordered_business_source_ids = sorted(
            business_source_ids,
            key=lambda source_id: 0 if source_artifact_by_id.get(source_id, {}).get("artifact_type") in RAW_BUSINESS_ARTIFACT_TYPES else 1,
        )
        for source_id in ordered_business_source_ids:
            location = f"economics.actual_business_source_ids[{source_id!r}]"
            source_error_start = len(findings)
            source = source_artifact_by_id.get(source_id)
            if source is None:
                add("ERROR", "ACTUAL_BUSINESS_SOURCE_MISSING", location, "Unknown actual business source artifact ID")
                continue
            artifact_type = source.get("artifact_type")
            source_class_valid = (
                (artifact_type in RAW_BUSINESS_ARTIFACT_TYPES and source.get("data_class") == "FIRST_PARTY")
                or (
                    artifact_type in CONTRIBUTION_NORMALIZATION_ARTIFACT_TYPES
                    and is_allowed(source.get("data_class"), {"VERIFIED_PRODUCT", "SELLER_CONFIRMED"})
                )
            )
            if not source_class_valid:
                add("ERROR", "ACTUAL_BUSINESS_SOURCE_TYPE_INVALID", location, "Use a first-party Amazon Business Report for total sales or an auditable contribution normalization snapshot for contribution totals")
                continue
            if (
                source.get("marketplace") != data.get("marketplace")
                or source.get("currency") != data.get("currency")
                or source.get("account_id_masked") != scope.get("account_id_masked")
                or (valid_scope_ids and source.get("scope_id") not in valid_scope_ids)
            ):
                add("ERROR", "ACTUAL_BUSINESS_SOURCE_SCOPE_MISMATCH", location, "Business evidence must match marketplace, currency, account, and exact ASIN/SKU")
                continue
            source_period = (source.get("window_start"), source.get("window_end"), source.get("data_through_date"))
            if any(not nonempty(value) for value in source_period) or source_period not in performance_periods:
                add("ERROR", "ACTUAL_BUSINESS_SOURCE_PERIOD_MISMATCH", location, "Business evidence must use the exact binding advertising-report window and data-through date")
                continue
            before_count = len(findings)
            verify_source_freshness(source, location, MAX_PERFORMANCE_SOURCE_AGE, "ACTUAL_BUSINESS_SOURCE_STALE")
            if len(findings) > before_count:
                continue
            business_metrics = source.get("business_metrics")
            if not isinstance(business_metrics, dict) or not business_metrics:
                add("ERROR", "ACTUAL_BUSINESS_SOURCE_MISSING", location, "Business evidence requires a non-empty business_metrics object")
                continue
            unknown_business_fields = set(business_metrics) - set(ACTUAL_BUSINESS_METRIC_SOURCE_TYPES)
            if unknown_business_fields:
                add("ERROR", "ACTUAL_BUSINESS_SOURCE_TYPE_INVALID", location, "Unknown business metric fields fail closed")
            for field, raw_value in business_metrics.items():
                if field not in ACTUAL_BUSINESS_METRIC_SOURCE_TYPES:
                    continue
                if artifact_type not in ACTUAL_BUSINESS_METRIC_SOURCE_TYPES[field]:
                    add("ERROR", "ACTUAL_BUSINESS_SOURCE_TYPE_INVALID", location, f"Artifact type cannot prove {field}")
                    continue
                metric_value = number(raw_value, f"{location}.business_metrics.{field}")
                if metric_value is not None:
                    business_values_by_field[field].append(metric_value)
            if artifact_type in RAW_BUSINESS_ARTIFACT_TYPES and "actual_total_sales" in business_metrics and len(findings) == source_error_start:
                valid_raw_business_source_ids.add(source_id)
            if artifact_type in CONTRIBUTION_NORMALIZATION_ARTIFACT_TYPES:
                derived_source_ids = source.get("derived_source_ids")
                if (
                    not nonplaceholder(source.get("normalization_formula"))
                    or not isinstance(derived_source_ids, list)
                    or not derived_source_ids
                    or any(not nonplaceholder(derived_id) for derived_id in derived_source_ids)
                    or len(derived_source_ids) != len(set(derived_source_ids))
                    or any(derived_id not in source_artifact_by_id for derived_id in derived_source_ids)
                ):
                    add("ERROR", "ACTUAL_CONTRIBUTION_NORMALIZATION_INVALID", location, "Contribution normalization requires a formula and known derived source IDs")
                    continue
                valid_cost_source_ids: set[str] = set()
                for derived_id in derived_source_ids:
                    if derived_id in binding_performance_source_ids or derived_id in valid_raw_business_source_ids:
                        continue
                    derived_source = source_artifact_by_id[derived_id]
                    derived_period = (derived_source.get("window_start"), derived_source.get("window_end"), derived_source.get("data_through_date"))
                    cost_semantics_valid = (
                        is_allowed(derived_source.get("data_class"), {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED"})
                        and derived_source.get("artifact_type") in ECONOMICS_DOMAIN_ARTIFACT_TYPES
                        and isinstance(derived_source.get("evidence_domains"), list)
                        and "PRODUCT_COSTS_AND_RETURNS" in derived_source.get("evidence_domains", [])
                        and derived_source.get("marketplace") == data.get("marketplace")
                        and derived_source.get("currency") == data.get("currency")
                        and derived_source.get("account_id_masked") == scope.get("account_id_masked")
                        and (not valid_scope_ids or derived_source.get("scope_id") in valid_scope_ids)
                        and derived_period in performance_periods
                    )
                    if cost_semantics_valid:
                        before_count = len(findings)
                        verify_source_freshness(derived_source, location, MAX_PERFORMANCE_SOURCE_AGE, "ACTUAL_CONTRIBUTION_SOURCE_SEMANTICS_INVALID")
                        if len(findings) == before_count:
                            valid_cost_source_ids.add(derived_id)
                    else:
                        add("ERROR", "ACTUAL_CONTRIBUTION_SOURCE_SEMANTICS_INVALID", location, f"Derived source {derived_id!r} is neither a binding Ads source, a reconciled Business Report, nor exact-period current product-cost evidence")
                recognized_derived_ids = binding_performance_source_ids | valid_raw_business_source_ids | valid_cost_source_ids
                if any(derived_id not in recognized_derived_ids for derived_id in derived_source_ids):
                    add("ERROR", "ACTUAL_CONTRIBUTION_SOURCE_SEMANTICS_INVALID", location, "Every contribution derived source must pass its binding scope, class, period, and freshness contract")
                if not valid_cost_source_ids:
                    add("ERROR", "ACTUAL_CONTRIBUTION_NORMALIZATION_INVALID", location, "Contribution normalization requires exact-period current product-cost evidence")
                if "actual_attributed_contribution_total" in business_metrics and not set(derived_source_ids).intersection(binding_performance_source_ids):
                    add("ERROR", "ACTUAL_CONTRIBUTION_NORMALIZATION_INVALID", location, "Attributed contribution normalization requires a cited binding Amazon Ads report/API snapshot")
                if "actual_total_contribution_before_ads" in business_metrics and not set(derived_source_ids).intersection(valid_raw_business_source_ids):
                    add("ERROR", "ACTUAL_CONTRIBUTION_NORMALIZATION_INVALID", location, "Total contribution normalization requires a cited reconciled Amazon Business Report")

        for field in supplied_business_fields:
            source_values = business_values_by_field[field]
            if not source_values:
                add("ERROR", "ACTUAL_BUSINESS_SOURCE_MISSING", f"economics.input_snapshot.{field}", f"No semantically valid source proves {field}")
            elif len(source_values) != 1:
                add("ERROR", "ACTUAL_BUSINESS_SOURCE_AMBIGUOUS", f"economics.input_snapshot.{field}", f"Exactly one normalized source value must prove {field}")
            else:
                input_value = number(binding_input.get(field), f"economics.input_snapshot.{field}")
                if input_value != source_values[0]:
                    add("ERROR", "ACTUAL_BUSINESS_RECONCILIATION_MISMATCH", f"economics.input_snapshot.{field}", f"{field} does not reconcile to its exact-period evidence")
    for index, rule in enumerate(decision_rules):
        if not isinstance(rule, dict):
            continue
        rule_source_ids = rule.get("source_snapshot_ids", [])
        if not isinstance(rule_source_ids, list):
            continue
        for snapshot_id in rule_source_ids:
            if snapshot_id not in performance_ids:
                add("ERROR", "DECISION_RULE_SNAPSHOT_UNKNOWN", f"decision_rules[{index}]", f"Unknown performance snapshot ID {snapshot_id!r}")
                continue
            if strategy_mode == "EXISTING_PRODUCT_OPTIMIZATION" and traffic_ready_status:
                source_row = performance_by_id.get(snapshot_id, {})
                basis_fields = ("charge_type", "interaction_scope", "sales_scope", "entity_scope", "attribution_window")
                declared_products = performance_basis.get("ad_products", []) if isinstance(performance_basis, dict) else []
                if (
                    any(source_row.get(field) != performance_basis.get(field) for field in basis_fields)
                    or source_row.get("ad_product") not in declared_products
                ):
                    add(
                        "ERROR",
                        "DECISION_RULE_PERFORMANCE_BASIS_MISMATCH",
                        f"decision_rules[{index}]",
                        "Existing-product decision rules may cite only snapshots on the binding economics basis; incompatible diagnostics require a separate package",
                    )

    def valid_onsite_sources(source_ids: Any, required_domain: str, location: str) -> list[dict[str, Any]]:
        if not isinstance(source_ids, list) or not source_ids:
            add("ERROR", "ONSITE_SOURCE_SEMANTICS_INVALID", location, f"Current {required_domain} evidence sources are required")
            return []
        valid_rows: list[dict[str, Any]] = []
        for source_id in source_ids:
            source = source_artifact_by_id.get(source_id)
            if not isinstance(source, dict):
                add("ERROR", "ONSITE_SOURCE_SEMANTICS_INVALID", location, f"Unknown onsite source artifact ID {source_id!r}")
                continue
            permitted = ONSITE_DOMAIN_ARTIFACT_TYPES.get(str(source.get("artifact_type")), set())
            declared = set(source.get("evidence_domains", [])) if isinstance(source.get("evidence_domains"), list) else set()
            valid = required_domain in permitted and required_domain in declared
            valid = valid and is_allowed(source.get("data_class"), {"FIRST_PARTY", "SELLER_CONFIRMED"})
            valid = valid and source.get("marketplace") == data.get("marketplace")
            valid = valid and source.get("account_id_masked") == scope.get("account_id_masked")
            valid = valid and (not valid_scope_ids or any(source.get("scope_id") == scope_id for scope_id in valid_scope_ids))
            if required_domain in {"ONSITE_PRICE", "ONSITE_PROMOTION"}:
                valid = valid and source.get("currency") == data.get("currency")
            if not valid:
                add("ERROR", "ONSITE_SOURCE_SEMANTICS_INVALID", location, f"Source {source_id!r} does not prove current exact-scope {required_domain}")
                continue
            before_count = len(findings)
            verify_source_freshness(source, location, MAX_ACCOUNT_SNAPSHOT_AGE, "ONSITE_SOURCE_STALE")
            if len(findings) == before_count:
                valid_rows.append(source)
        return valid_rows

    onsite = require_dict(data.get("onsite_support", {}), add, "ONSITE_SUPPORT_INVALID", "onsite_support")
    if not is_allowed(onsite.get("economics_application"), {"BINDING", "PLANNED_NOT_IN_BINDING", "NOT_USED"}):
        add("ERROR", "ONSITE_ECONOMICS_APPLICATION_INVALID", "onsite_support.economics_application", "Use BINDING, PLANNED_NOT_IN_BINDING, or NOT_USED")
    if traffic_ready_status and onsite.get("economics_application") != "BINDING":
        add("ERROR", "ONSITE_SUPPORT_NOT_BOUND", "onsite_support.economics_application", "Traffic-ready onsite support must be fully included in the binding economics")

    effective_price = require_dict(onsite.get("effective_price", {}), add, "ONSITE_EFFECTIVE_PRICE_INVALID", "onsite_support.effective_price")
    valid_onsite_sources(effective_price.get("source_artifact_ids"), "ONSITE_PRICE", "onsite_support.effective_price.source_artifact_ids")
    effective_amount = number(effective_price.get("amount"), "onsite_support.effective_price.amount")
    expected_effective_amount = None
    if binding_input:
        price_components = [
            number(binding_input.get(field), f"economics.input_snapshot.binding.{field}")
            for field in ("selling_price", "seller_funded_discount", "coupon_discount_per_order", "other_seller_funded_discount")
        ]
        if all(value is not None for value in price_components):
            expected_effective_amount = price_components[0] - sum(price_components[1:], Decimal("0"))
    if effective_price.get("currency") != data.get("currency") or effective_price.get("price_includes_tax") != binding_input.get("price_includes_tax") or effective_amount != expected_effective_amount:
        add("ERROR", "ONSITE_PRICE_ECONOMICS_MISMATCH", "onsite_support.effective_price", "Effective price, currency, and tax basis must exactly reconcile to the binding price and seller-funded discounts")

    promotion_rows = require_list(onsite.get("coupons_or_deals", []), add, "ONSITE_PROMOTIONS_INVALID", "onsite_support.coupons_or_deals")
    promotion_totals = {
        "COUPON": {"discount": Decimal("0"), "fee": Decimal("0"), "fixed": Decimal("0")},
        "DEAL": {"discount": Decimal("0"), "fee": Decimal("0"), "fixed": Decimal("0")},
    }
    promotion_ids: set[str] = set()
    for index, promotion in enumerate(promotion_rows):
        location = f"onsite_support.coupons_or_deals[{index}]"
        if not isinstance(promotion, dict):
            add("ERROR", "ONSITE_PROMOTION_INVALID", location, "Promotion row must be an object")
            continue
        support_id = promotion.get("support_id")
        if not nonplaceholder(support_id):
            add("ERROR", "ONSITE_PROMOTION_ID_MISSING", location, "support_id must be a non-placeholder stable ID")
        elif support_id in promotion_ids:
            add("ERROR", "ONSITE_PROMOTION_ID_DUPLICATE", location, f"Duplicate support ID {support_id!r}")
        else:
            promotion_ids.add(support_id)
        support_type = promotion.get("support_type")
        if support_type not in promotion_totals:
            add("ERROR", "ONSITE_PROMOTION_TYPE_INVALID", location, "support_type must be COUPON or DEAL")
            continue
        if not is_allowed(promotion.get("status"), {"PLANNED", "ACTIVE"}) or not is_allowed(promotion.get("economics_application"), {"BINDING", "PLANNED_NOT_IN_BINDING"}):
            add("ERROR", "ONSITE_PROMOTION_NOT_BOUND", location, "Coupon/deal rows must be active/planned and explicitly BINDING or PLANNED_NOT_IN_BINDING")
        binding_promotion = promotion.get("economics_application") == "BINDING"
        for field in ("economic_discount_per_modeled_order", "fee_per_modeled_order", "fixed_fee", "planned_redemptions"):
            amount = number(promotion.get(field), f"{location}.{field}")
            if amount is None or amount < 0:
                add("ERROR", "ONSITE_PROMOTION_AMOUNT_INVALID", location, f"{field} must be non-negative")
            elif binding_promotion and field == "economic_discount_per_modeled_order":
                promotion_totals[support_type]["discount"] += amount
            elif binding_promotion and field == "fee_per_modeled_order":
                promotion_totals[support_type]["fee"] += amount
            elif binding_promotion and field == "fixed_fee":
                promotion_totals[support_type]["fixed"] += amount
        promotion_sources = promotion.get("source_artifact_ids")
        valid_onsite_sources(promotion_sources, "ONSITE_PROMOTION", f"{location}.source_artifact_ids")

    promotion_expected = {
        ("COUPON", "discount"): number(binding_input.get("coupon_discount_per_order"), "economics.input_snapshot.binding.coupon_discount_per_order"),
        ("COUPON", "fee"): number(binding_input.get("coupon_fee_per_order"), "economics.input_snapshot.binding.coupon_fee_per_order"),
        ("COUPON", "fixed"): number(binding_input.get("coupon_fixed_fee"), "economics.input_snapshot.binding.coupon_fixed_fee"),
        ("DEAL", "discount"): number(binding_input.get("other_seller_funded_discount"), "economics.input_snapshot.binding.other_seller_funded_discount"),
        ("DEAL", "fee"): number(binding_input.get("deal_fee_per_order"), "economics.input_snapshot.binding.deal_fee_per_order"),
        ("DEAL", "fixed"): number(binding_input.get("deal_fixed_fee"), "economics.input_snapshot.binding.deal_fixed_fee"),
    }
    for (support_type, metric), expected in promotion_expected.items():
        if expected is not None and promotion_totals[support_type][metric] != expected:
            add("ERROR", "ONSITE_PROMOTION_COST_UNMODELED", "onsite_support.coupons_or_deals", f"{support_type} {metric} does not reconcile to the binding economics")

    cost_ledger = onsite.get("cost_ledger")
    if not isinstance(cost_ledger, dict):
        add("ERROR", "ONSITE_COST_LEDGER_MISSING", "onsite_support.cost_ledger", "Separate PPC, discount, Coupon/deal, Vine, and inventory/cash ledgers are required")
    else:
        for field in ("ppc", "discount", "coupon_or_deal", "vine", "inventory_and_cash"):
            if field not in cost_ledger:
                add("ERROR", "ONSITE_COST_LEDGER_FIELD_MISSING", "onsite_support.cost_ledger", f"Missing {field} ledger")
        ledger_expectations = {
            "ppc": {"planned_spend": number(binding_input.get("planned_ppc_spend"), "economics.input_snapshot.binding.planned_ppc_spend")},
            "discount": {"price_discount_per_order": number(binding_input.get("seller_funded_discount"), "economics.input_snapshot.binding.seller_funded_discount")},
            "coupon_or_deal": {
                "discount_per_order": sum((promotion_totals[kind]["discount"] for kind in promotion_totals), Decimal("0")),
                "variable_fee_per_order": sum((promotion_totals[kind]["fee"] for kind in promotion_totals), Decimal("0")),
                "fixed_fee": sum((promotion_totals[kind]["fixed"] for kind in promotion_totals), Decimal("0")),
            },
        }
        for ledger_name, expected_fields in ledger_expectations.items():
            ledger = cost_ledger.get(ledger_name)
            if not isinstance(ledger, dict):
                add("ERROR", "ONSITE_LEDGER_INVALID", f"onsite_support.cost_ledger.{ledger_name}", "Ledger row must be an object")
                continue
            if ledger.get("currency") != data.get("currency"):
                add("ERROR", "ONSITE_LEDGER_CURRENCY_MISMATCH", f"onsite_support.cost_ledger.{ledger_name}", "Ledger currency must match strategy currency")
            for field, expected in expected_fields.items():
                if number(ledger.get(field), f"onsite_support.cost_ledger.{ledger_name}.{field}") != expected:
                    add("ERROR", "ONSITE_LEDGER_ECONOMICS_MISMATCH", f"onsite_support.cost_ledger.{ledger_name}.{field}", "Ledger value must exactly match binding economics")

    review = require_dict(data.get("review_compliance", {}), add, "REVIEW_COMPLIANCE_INVALID", "review_compliance")
    if review.get("review_manipulation_excluded") is not True or review.get("prohibited_methods_present") is not False:
        add("ERROR", "REVIEW_MANIPULATION_GATE_FAILED", "review_compliance", "Review manipulation must be explicitly excluded")
    methods = review.get("methods", [])
    if not isinstance(methods, list) or not methods or any(not is_allowed(method, ALLOWED_REVIEW_METHODS) for method in methods):
        add("ERROR", "REVIEW_METHOD_INVALID", "review_compliance.methods", "Only current compliant native/organic methods are allowed")
    if isinstance(methods, list) and "NONE" in methods and len(methods) > 1:
        add("ERROR", "REVIEW_METHOD_CONTRADICTION", "review_compliance.methods", "NONE cannot be combined with an active review-support method")
    if any(is_allowed(method, {"VINE", "REQUEST_A_REVIEW"}) for method in methods) and policy_gates["review_method_compliance_verified"] != "VERIFIED_CURRENT":
        add("ERROR", "REVIEW_METHOD_POLICY_UNVERIFIED", "policy_snapshot.review_method_compliance_verified", "Native review support requires current verification")
    if "VINE" in methods and require_dict(onsite.get("vine", {}), add, "VINE_INVALID", "onsite_support.vine").get("eligibility") != "VERIFIED_ELIGIBLE":
        add("ERROR", "VINE_NOT_ELIGIBLE", "onsite_support.vine.eligibility", "Vine use requires current verified eligibility")
    request_review_support = require_dict(onsite.get("request_a_review", {}), add, "REQUEST_REVIEW_INVALID", "onsite_support.request_a_review")
    allowed_request_review_fields = {"eligibility", "native_method", "source_artifact_ids", "eligible_order_scope_ids"}
    if set(request_review_support) - allowed_request_review_fields:
        add("ERROR", "REQUEST_REVIEW_SCHEMA_INVALID", "onsite_support.request_a_review", "Request a Review uses a closed native-only schema; custom channel, message, incentive, or unknown fields are forbidden")
    if not is_allowed(request_review_support.get("eligibility"), {"NOT_USED", "VERIFIED_ELIGIBLE", "RUNTIME_VERIFICATION_REQUIRED", "INELIGIBLE"}):
        add("ERROR", "REQUEST_REVIEW_NOT_ELIGIBLE", "onsite_support.request_a_review.eligibility", "Use a canonical Request a Review eligibility state")
    if "REQUEST_A_REVIEW" in methods:
        if request_review_support.get("eligibility") != "VERIFIED_ELIGIBLE" or request_review_support.get("native_method") != "AMAZON_REQUEST_A_REVIEW":
            add("ERROR", "REQUEST_REVIEW_NOT_ELIGIBLE", "onsite_support.request_a_review", "Active Request a Review requires current verified eligibility and the native Amazon method")
        eligible_order_scope_ids = request_review_support.get("eligible_order_scope_ids")
        if (
            not isinstance(eligible_order_scope_ids, list)
            or not eligible_order_scope_ids
            or any(not nonplaceholder(order_id) for order_id in eligible_order_scope_ids)
            or len(eligible_order_scope_ids) != len(set(eligible_order_scope_ids))
        ):
            add("ERROR", "REQUEST_REVIEW_SOURCE_INVALID", "onsite_support.request_a_review.eligible_order_scope_ids", "Active native review requests require explicit eligible order-scope IDs")
            eligible_order_scope_ids = []
        request_source_ids = request_review_support.get("source_artifact_ids")
        if (
            not isinstance(request_source_ids, list)
            or not request_source_ids
            or any(not nonplaceholder(source_id) for source_id in request_source_ids)
            or len(request_source_ids) != len(set(request_source_ids))
        ):
            add("ERROR", "REQUEST_REVIEW_SOURCE_MISSING", "onsite_support.request_a_review.source_artifact_ids", "Active Request a Review requires current first-party native eligibility evidence")
            request_source_ids = []
        valid_request_source = False
        for source_id in request_source_ids:
            source = source_artifact_by_id.get(source_id)
            source_orders = source.get("eligible_order_scope_ids") if isinstance(source, dict) else None
            if (
                source is None
                or source.get("data_class") != "FIRST_PARTY"
                or source.get("artifact_type") not in REQUEST_REVIEW_ARTIFACT_TYPES
                or source.get("marketplace") != data.get("marketplace")
                or source.get("account_id_masked") != scope.get("account_id_masked")
                or (valid_scope_ids and source.get("scope_id") not in valid_scope_ids)
                or not isinstance(source.get("evidence_domains"), list)
                or "REQUEST_REVIEW_ELIGIBILITY" not in source.get("evidence_domains", [])
                or not isinstance(source_orders, list)
                or not set(eligible_order_scope_ids).issubset({value for value in source_orders if nonplaceholder(value)})
            ):
                add("ERROR", "REQUEST_REVIEW_SOURCE_INVALID", "onsite_support.request_a_review.source_artifact_ids", "Request a Review evidence must be current first-party, native, exact-account/product scoped, and cover every eligible order scope")
                continue
            before_count = len(findings)
            verify_source_freshness(source, "onsite_support.request_a_review.source_artifact_ids", MAX_ACCOUNT_SNAPSHOT_AGE, "REQUEST_REVIEW_SOURCE_INVALID")
            if len(findings) == before_count:
                valid_request_source = True
        if not valid_request_source:
            add("ERROR", "REQUEST_REVIEW_SOURCE_MISSING", "onsite_support.request_a_review.source_artifact_ids", "No valid current native Request a Review eligibility source was found")
    elif request_review_support.get("eligibility") not in {"NOT_USED", "RUNTIME_VERIFICATION_REQUIRED"}:
        add("ERROR", "REQUEST_REVIEW_METHOD_STATE_MISMATCH", "onsite_support.request_a_review", "Verified or ineligible order-level Request a Review state cannot be active unless the method is declared")

    vine_support = require_dict(onsite.get("vine", {}), add, "VINE_INVALID", "onsite_support.vine")
    vine_fields = {
        "planned_units": "vine_units",
        "reserved_units": "vine_reserved_units",
        "enrollment_fee": "vine_enrollment_fee",
        "unit_landed_cost": "vine_unit_landed_cost",
        "unit_fulfillment_cost": "vine_unit_fulfillment_cost",
    }
    vine_support_values: dict[str, Decimal | None] = {}
    vine_input_values: dict[str, Decimal | None] = {}
    for support_field, input_field in vine_fields.items():
        vine_support_values[support_field] = number(vine_support.get(support_field), f"onsite_support.vine.{support_field}")
        vine_input_values[input_field] = number(binding_input.get(input_field), f"economics.input_snapshot.binding.{input_field}")
        if vine_support_values[support_field] != vine_input_values[input_field]:
            add("ERROR", "VINE_SUPPORT_ECONOMICS_MISMATCH", "onsite_support.vine", f"{support_field} must match binding {input_field}")
    modeled_vine_units = vine_input_values.get("vine_units")
    modeled_vine_reserved = vine_input_values.get("vine_reserved_units")
    if modeled_vine_units is not None and modeled_vine_units > 0:
        if "VINE" not in methods or "NONE" in methods:
            add("ERROR", "VINE_METHOD_STATE_MISMATCH", "review_compliance.methods", "Modeled Vine units require the VINE method and cannot use NONE")
        if vine_support.get("economics_application") != "BINDING" or vine_support.get("eligibility") != "VERIFIED_ELIGIBLE":
            add("ERROR", "VINE_METHOD_STATE_MISMATCH", "onsite_support.vine", "Modeled Vine units require binding support and current verified eligibility")
        if modeled_vine_reserved is None or modeled_vine_reserved < modeled_vine_units:
            add("ERROR", "VINE_UNIT_RESERVATION_MISMATCH", "economics.input_snapshot.binding.vine_reserved_units", "Vine-reserved inventory must cover every modeled Vine unit")
        vine_sources = vine_support.get("source_artifact_ids")
        valid_vine_eligibility = valid_onsite_sources(vine_sources, "VINE_ELIGIBILITY", "onsite_support.vine.source_artifact_ids")
        vine_cost_sources = [
            source_artifact_by_id.get(source_id, {})
            for source_id in vine_sources
            if nonplaceholder(source_id)
        ] if isinstance(vine_sources, list) else []
        valid_vine_cost = any(
            is_allowed(source.get("data_class"), {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED"})
            and "PRODUCT_COSTS_AND_RETURNS" in source.get("evidence_domains", [])
            and str(source.get("artifact_type")) in ECONOMICS_DOMAIN_ARTIFACT_TYPES
            and source.get("marketplace") == data.get("marketplace")
            and source.get("currency") == data.get("currency")
            and (not valid_scope_ids or any(source.get("scope_id") == scope_id for scope_id in valid_scope_ids))
            for source in vine_cost_sources
            if isinstance(source, dict) and isinstance(source.get("evidence_domains"), list)
        )
        if not valid_vine_eligibility or not valid_vine_cost:
            add("ERROR", "VINE_SUPPORT_SOURCES_INVALID", "onsite_support.vine.source_artifact_ids", "Modeled Vine support requires current exact-scope eligibility/fee evidence and a semantically valid product-cost source")
    elif vine_support.get("economics_application") != "NOT_USED" or vine_support.get("eligibility") != "NOT_USED" or "VINE" in methods:
        add("ERROR", "VINE_METHOD_STATE_MISMATCH", "onsite_support.vine", "Vine cannot be declared active when binding economics contains zero Vine units")
    if isinstance(cost_ledger, dict):
        vine_ledger = cost_ledger.get("vine")
        if not isinstance(vine_ledger, dict):
            add("ERROR", "ONSITE_LEDGER_INVALID", "onsite_support.cost_ledger.vine", "Vine ledger must be an object")
        else:
            if vine_ledger.get("currency") != data.get("currency"):
                add("ERROR", "ONSITE_LEDGER_CURRENCY_MISMATCH", "onsite_support.cost_ledger.vine", "Vine ledger currency must match strategy currency")
            vine_ledger_expected = {
                "planned_units": modeled_vine_units,
                "reserved_units": modeled_vine_reserved,
                "enrollment_fee": vine_input_values.get("vine_enrollment_fee"),
                "unit_landed_cost": vine_input_values.get("vine_unit_landed_cost"),
                "unit_fulfillment_cost": vine_input_values.get("vine_unit_fulfillment_cost"),
            }
            for field, expected in vine_ledger_expected.items():
                if number(vine_ledger.get(field), f"onsite_support.cost_ledger.vine.{field}") != expected:
                    add("ERROR", "ONSITE_LEDGER_ECONOMICS_MISMATCH", f"onsite_support.cost_ledger.vine.{field}", "Vine ledger must exactly match binding economics")

    inventory = require_dict(data.get("inventory", {}), add, "INVENTORY_INVALID", "inventory")
    inventory_captured_at = timestamp(inventory.get("captured_at"), "inventory.captured_at") if nonempty(inventory.get("captured_at")) else None
    if traffic_ready_status and (inventory_captured_at is None or package_captured_at is None or package_captured_at - inventory_captured_at < timedelta(0) or package_captured_at - inventory_captured_at > MAX_ACCOUNT_SNAPSHOT_AGE):
        add("ERROR", "INVENTORY_CAPTURE_STALE", "inventory.captured_at", "Inventory snapshot must be within the validator's 24-hour package safety window")
    inventory_numbers: dict[str, Decimal | None] = {}
    for field in ("sellable_units", "reserved_units", "safety_stock_units", "lead_time_days"):
        value = number(inventory.get(field), f"inventory.{field}")
        inventory_numbers[field] = value
        if value is not None and value < 0:
            add("ERROR", "INVENTORY_VALUE_NEGATIVE", f"inventory.{field}", f"{field} cannot be negative")
    inventory_replenishment_policy_raw = inventory.get("replenishment_policy")
    inventory_replenishment_policy: dict[str, Any] = {}
    if inventory_replenishment_policy_raw is not None:
        inventory_replenishment_policy = require_dict(
            inventory_replenishment_policy_raw,
            add,
            "INVENTORY_REPLENISHMENT_POLICY_INVALID",
            "inventory.replenishment_policy",
        )
    upstream_replenishment_policy = operating_context.get("replenishment_policy", {}) if operating_context else {}
    if upstream_replenishment_policy is None:
        upstream_replenishment_policy = {}
    if not isinstance(upstream_replenishment_policy, dict):
        add("ERROR", "OPERATING_REPLENISHMENT_POLICY_INVALID", "operating_context.replenishment_policy", "replenishment_policy must be an object")
        upstream_replenishment_policy = {}
    upstream_safety_days = number(
        upstream_replenishment_policy.get("safety_stock_days"),
        "operating_context.replenishment_policy.safety_stock_days",
    )
    binding_safety_days = number(
        inventory_replenishment_policy.get("safety_stock_days"),
        "inventory.replenishment_policy.safety_stock_days",
    )
    for value, location in (
        (upstream_safety_days, "operating_context.replenishment_policy.safety_stock_days"),
        (binding_safety_days, "inventory.replenishment_policy.safety_stock_days"),
    ):
        if value is not None and value < 0:
            add("ERROR", "SAFETY_STOCK_DAYS_INVALID", location, "safety_stock_days cannot be negative")
    if upstream_safety_days is not None:
        if binding_safety_days != upstream_safety_days:
            add("ERROR", "SAFETY_STOCK_POLICY_MISMATCH", "inventory.replenishment_policy.safety_stock_days", "Binding safety_stock_days must preserve the upstream policy")
        forecast_daily_orders = number(
            binding_input.get("forecast_daily_total_orders"),
            "economics.input_snapshot.binding.forecast_daily_total_orders",
        )
        if forecast_daily_orders is None or forecast_daily_orders < 0:
            gap("SAFETY_STOCK_CONVERSION_INPUT_MISSING", "economics.input_snapshot.binding.forecast_daily_total_orders", "Safety-stock days require a non-negative binding daily-order forecast")
        elif inventory_numbers["safety_stock_units"] is not None:
            expected_safety_units = (upstream_safety_days * forecast_daily_orders).to_integral_value(rounding=ROUND_CEILING)
            if inventory_numbers["safety_stock_units"] != expected_safety_units:
                add("ERROR", "SAFETY_STOCK_UNIT_CONVERSION_MISMATCH", "inventory.safety_stock_units", "safety_stock_units must equal ceil(safety_stock_days × binding forecast_daily_total_orders)")
    lead_time_components_raw = inventory.get("lead_time_components")
    lead_time_components: dict[str, Any] = {}
    lead_component_values: dict[str, Decimal | None] = {}
    if lead_time_components_raw is None:
        if traffic_ready_status and strategy_mode == "NEW_PRODUCT_LAUNCH":
            add(
                "ERROR",
                "LEAD_TIME_COMPONENTS_MISSING",
                "inventory.lead_time_components",
                "A traffic-ready new-product plan requires quantity-matched production, prep, transit, customs/local-delivery, FBA-receiving, and risk-buffer components",
            )
    else:
        lead_time_components = require_dict(
            lead_time_components_raw,
            add,
            "LEAD_TIME_COMPONENTS_INVALID",
            "inventory.lead_time_components",
        )
        component_fields = (
            "production_days",
            "qc_and_prep_days",
            "transit_days",
            "customs_or_local_delivery_days",
            "fba_receiving_days",
            "risk_buffer_days",
            "base_lead_days",
        )
        for field in component_fields:
            value = number(lead_time_components.get(field), f"inventory.lead_time_components.{field}")
            lead_component_values[field] = value
            if value is not None and value < 0:
                add("ERROR", "LEAD_TIME_COMPONENT_NEGATIVE", f"inventory.lead_time_components.{field}", f"{field} cannot be negative")
        required_components = component_fields[:-1]
        components_complete = all(lead_component_values.get(field) is not None for field in required_components)
        if traffic_ready_status and strategy_mode == "NEW_PRODUCT_LAUNCH" and not components_complete:
            add("ERROR", "LEAD_TIME_COMPONENTS_INCOMPLETE", "inventory.lead_time_components", "Unknown binding lead-time components keep a new-product traffic plan provisional")
        if components_complete:
            calculated_base_lead = sum(
                (lead_component_values[field] for field in required_components[:-1]),
                Decimal("0"),
            )
            if lead_component_values.get("base_lead_days") != calculated_base_lead:
                add("ERROR", "LEAD_TIME_COMPONENT_SUM_MISMATCH", "inventory.lead_time_components.base_lead_days", "base_lead_days must equal production + prep + transit + customs/local-delivery + FBA-receiving days")
            if inventory_numbers.get("lead_time_days") != calculated_base_lead:
                add("ERROR", "LEAD_TIME_TOTAL_MISMATCH", "inventory.lead_time_days", "lead_time_days must equal the selected route's base_lead_days; keep risk_buffer_days separate")
        if traffic_ready_status and strategy_mode == "NEW_PRODUCT_LAUNCH":
            if not nonplaceholder(lead_time_components.get("selected_route_id")):
                add("ERROR", "LEAD_TIME_ROUTE_ID_MISSING", "inventory.lead_time_components.selected_route_id", "A traffic-ready new-product plan requires a selected route ID")
            route_sources = lead_time_components.get("source_artifact_ids")
            if not isinstance(route_sources, list) or not route_sources or any(not nonplaceholder(item) for item in route_sources):
                add("ERROR", "LEAD_TIME_SOURCE_MISSING", "inventory.lead_time_components.source_artifact_ids", "A traffic-ready selected route requires source artifacts")
    sellable = inventory_numbers["sellable_units"]
    reserved = inventory_numbers["reserved_units"]
    safety = inventory_numbers["safety_stock_units"]
    reserved_breakdown = require_dict(inventory.get("reserved_breakdown", {}), add, "INVENTORY_RESERVED_BREAKDOWN_INVALID", "inventory.reserved_breakdown")
    breakdown_values: dict[str, Decimal | None] = {}
    for field in ("vine_units", "other_locked_units", "other_reserved_units"):
        breakdown_values[field] = number(reserved_breakdown.get(field), f"inventory.reserved_breakdown.{field}")
        if breakdown_values[field] is not None and breakdown_values[field] < 0:
            add("ERROR", "INVENTORY_VALUE_NEGATIVE", f"inventory.reserved_breakdown.{field}", f"{field} cannot be negative")
    breakdown_complete = all(value is not None for value in breakdown_values.values())
    if traffic_ready_status and not breakdown_complete:
        add("ERROR", "INVENTORY_RESERVED_BREAKDOWN_INCOMPLETE", "inventory.reserved_breakdown", "Traffic-ready inventory requires vine_units, other_locked_units, and other_reserved_units as explicit non-negative numbers")
    if reserved is not None and breakdown_complete:
        breakdown_total = sum((value for value in breakdown_values.values() if value is not None), Decimal("0"))
        if breakdown_total != reserved:
            add("ERROR", "INVENTORY_RESERVED_BREAKDOWN_MISMATCH", "inventory.reserved_breakdown", "Reserved breakdown must sum exactly to inventory.reserved_units")
    if sellable is not None and reserved is not None and safety is not None and reserved + safety > sellable:
        add("ERROR", "INVENTORY_RESERVES_EXCEED_SELLABLE", "inventory", "Reserved plus safety-stock units cannot exceed sellable units")
    if not is_allowed(inventory.get("stockout_risk"), {"LOW", "MEDIUM", "HIGH", "UNKNOWN"}):
        add("ERROR", "STOCKOUT_RISK_INVALID", "inventory.stockout_risk", "Use LOW, MEDIUM, HIGH, or UNKNOWN")
    if not nonplaceholder(inventory.get("reorder_state")):
        add("ERROR", "REORDER_STATE_INVALID", "inventory.reorder_state", "reorder_state must be a non-placeholder current-state string")
    inventory_source_ids = inventory.get("source_artifact_ids")
    inventory_sources_verified = isinstance(inventory_source_ids, list) and bool(inventory_source_ids)
    if not inventory_sources_verified:
        gap("INVENTORY_SOURCE_GAP", "inventory.source_artifact_ids", "Inventory values require current seller-confirmed or first-party source artifacts")
        inventory_source_ids = []
    for source_id in inventory_source_ids:
        source = source_artifact_by_id.get(source_id)
        if source is None or not is_allowed(source.get("data_class"), {"FIRST_PARTY", "SELLER_CONFIRMED"}):
            add("ERROR", "INVENTORY_SOURCE_INVALID", "inventory.source_artifact_ids", "Inventory source must be seller-confirmed or first-party")
        elif not is_allowed(source.get("artifact_type"), INVENTORY_ARTIFACT_TYPES) or source.get("marketplace") != data.get("marketplace") or source.get("account_id_masked") != scope.get("account_id_masked"):
            add("ERROR", "INVENTORY_SOURCE_SCOPE_MISMATCH", "inventory.source_artifact_ids", "Inventory source must match artifact type, marketplace, and account scope")
        else:
            verify_source_freshness(source, "inventory.source_artifact_ids", MAX_ACCOUNT_SNAPSHOT_AGE, "INVENTORY_SOURCE_STALE")
    if lead_time_components:
        route_source_ids = lead_time_components.get("source_artifact_ids")
        if isinstance(route_source_ids, list):
            for source_id in route_source_ids:
                source = source_artifact_by_id.get(source_id)
                location = "inventory.lead_time_components.source_artifact_ids"
                if source is None:
                    add("ERROR", "LEAD_TIME_SOURCE_UNKNOWN", location, f"Unknown route source artifact ID {source_id!r}")
                    continue
                declared_domains = source.get("evidence_domains", [])
                if (
                    source.get("artifact_type") not in INVENTORY_ARTIFACT_TYPES
                    or not isinstance(declared_domains, list)
                    or "INVENTORY" not in declared_domains
                    or source.get("marketplace") not in {data.get("marketplace"), "GLOBAL"}
                ):
                    add("ERROR", "LEAD_TIME_SOURCE_SCOPE_MISMATCH", location, "Route evidence must be an inventory/supply-route artifact for the strategy marketplace and declare the INVENTORY domain")
                if traffic_ready_status and source.get("data_class") not in {"FIRST_PARTY", "VERIFIED_PRODUCT", "SELLER_CONFIRMED"}:
                    add("ERROR", "LEAD_TIME_SOURCE_AUTHORITY_LOW", location, "Estimated or unverified route evidence keeps a traffic-ready lead-time plan provisional")
                verify_source_freshness(source, location, MAX_POLICY_AGE, "LEAD_TIME_SOURCE_STALE")
    if binding_input:
        inventory_reconciliation = {
            "sellable_inventory": sellable,
            "safety_stock_units": safety,
            "replenishment_lead_days": inventory_numbers["lead_time_days"],
        }
        for input_field, package_value in inventory_reconciliation.items():
            input_value = number(binding_input.get(input_field), f"economics.input_snapshot.binding.{input_field}")
            if input_value != package_value:
                gap("ECONOMICS_INVENTORY_RECONCILIATION_MISMATCH", "inventory", f"{input_field} does not match the package inventory snapshot")
        if lead_time_components:
            modeled_buffer = number(binding_input.get("inbound_buffer_days"), "economics.input_snapshot.binding.inbound_buffer_days")
            if modeled_buffer != lead_component_values.get("risk_buffer_days"):
                gap("ECONOMICS_INVENTORY_RECONCILIATION_MISMATCH", "inventory.lead_time_components.risk_buffer_days", "Calculator inbound_buffer_days must match the selected route risk_buffer_days")
        modeled_reserved = number(binding_input.get("vine_reserved_units"), "economics.input_snapshot.binding.vine_reserved_units")
        modeled_other_locked = number(binding_input.get("other_locked_units"), "economics.input_snapshot.binding.other_locked_units")
        if modeled_reserved is not None and modeled_other_locked is not None and reserved is not None and modeled_reserved + modeled_other_locked != reserved:
            gap("ECONOMICS_INVENTORY_RECONCILIATION_MISMATCH", "inventory.reserved_units", "Calculator reserved units do not match the package inventory snapshot")
        if modeled_reserved != breakdown_values.get("vine_units") or (
            modeled_other_locked is not None
            and breakdown_complete
            and modeled_other_locked != breakdown_values["other_locked_units"] + breakdown_values["other_reserved_units"]
        ) or (traffic_ready_status and not breakdown_complete):
            gap("ECONOMICS_INVENTORY_RECONCILIATION_MISMATCH", "inventory.reserved_breakdown", "Binding Vine and other locked units must match the reserved breakdown")
        planned_orders = number(binding_input.get("planned_orders"), "economics.input_snapshot.binding.planned_orders")
        if strategy_mode == "NEW_PRODUCT_LAUNCH" and traffic_ready_status and planned_orders is not None and sellable is not None and reserved is not None and safety is not None and planned_orders > sellable - reserved - safety:
            add("ERROR", "PLANNED_ORDERS_EXCEED_AVAILABLE_INVENTORY", "economics.input_snapshot.binding.planned_orders", "Planned orders exceed currently advertising-available inventory")
    if traffic_ready_status and is_allowed(inventory.get("stockout_risk"), {"HIGH", "UNKNOWN"}):
        add("ERROR", "READY_INVENTORY_RISK_UNRESOLVED", "inventory.stockout_risk", "A traffic-ready strategy requires LOW or MEDIUM stockout risk")
    if traffic_ready_status and sellable is not None and reserved is not None and safety is not None:
        available_before_safety = sellable - reserved
        for index, phase in enumerate(phases):
            if not isinstance(phase, dict):
                continue
            floor = number(phase.get("inventory_floor"), f"phase_plan[{index}].inventory_floor")
            if floor is not None and (floor < safety or floor > available_before_safety):
                add("ERROR", "PHASE_INVENTORY_FLOOR_INCONSISTENT", f"phase_plan[{index}].inventory_floor", "Inventory floor must preserve safety stock and be reachable from current unreserved inventory")
    if strategy_mode == "NEW_PRODUCT_LAUNCH" and deliverable_mode == "PLAN":
        for field in ("sellable_units", "reserved_units", "safety_stock_units", "lead_time_days"):
            if inventory.get(field) is None:
                gap("NEW_INVENTORY_GAP", f"inventory.{field}", f"{field} is required before launch-plan readiness")
    if isinstance(cost_ledger, dict):
        inventory_cash_ledger = cost_ledger.get("inventory_and_cash")
        if not isinstance(inventory_cash_ledger, dict):
            add("ERROR", "ONSITE_LEDGER_INVALID", "onsite_support.cost_ledger.inventory_and_cash", "Inventory/cash ledger must be an object")
        else:
            if inventory_cash_ledger.get("currency") != data.get("currency"):
                add("ERROR", "ONSITE_LEDGER_CURRENCY_MISMATCH", "onsite_support.cost_ledger.inventory_and_cash", "Inventory/cash ledger currency must match strategy currency")
            inventory_cash_expected = {
                "reserved_units": reserved,
                "safety_stock_units": safety,
                "approved_cash_exposure": approved_cash_exposure,
                "strategy_total_spend_cap": strategy_total_spend_cap,
            }
            for field, expected in inventory_cash_expected.items():
                if number(inventory_cash_ledger.get(field), f"onsite_support.cost_ledger.inventory_and_cash.{field}") != expected:
                    add("ERROR", "ONSITE_LEDGER_ECONOMICS_MISMATCH", f"onsite_support.cost_ledger.inventory_and_cash.{field}", "Inventory/cash ledger must match binding inventory and approvals")

    handbacks = require_list(data.get("handbacks", []), add, "HANDBACKS_INVALID", "handbacks")
    handback_ids: set[str] = set()
    for index, handback in enumerate(handbacks):
        location = f"handbacks[{index}]"
        if not isinstance(handback, dict):
            add("ERROR", "HANDBACK_INVALID", location, "Handback must be an object")
            continue
        handback_id = handback.get("handback_id")
        if not nonempty(handback_id):
            add("ERROR", "HANDBACK_ID_MISSING", location, "handback_id is required")
        elif handback_id in handback_ids:
            add("ERROR", "HANDBACK_ID_DUPLICATE", location, f"Duplicate handback ID {handback_id!r}")
        else:
            handback_ids.add(handback_id)
        if not is_allowed(handback.get("destination_skill"), HAND_BACK_DESTINATIONS):
            add("ERROR", "HANDBACK_DESTINATION_INVALID", location, "Unknown handback destination")
        for field in ("root_cause_class", "diagnosis", "requested_review", "advertising_interim_action", "status"):
            if not nonempty(handback.get(field)):
                add("ERROR", "HANDBACK_FIELD_MISSING", location, f"{field} is required")
        for field in ("source_ids", "evidence_ids"):
            if not isinstance(handback.get(field), list) or not handback.get(field):
                add("ERROR", "HANDBACK_EVIDENCE_MISSING", location, f"{field} must be a non-empty array")

    change_manifest = require_list(data.get("change_manifest", []), add, "CHANGE_MANIFEST_INVALID", "change_manifest")
    operation_ids: set[str] = set()
    for index, operation in enumerate(change_manifest):
        location = f"change_manifest[{index}]"
        if not isinstance(operation, dict):
            add("ERROR", "CHANGE_OPERATION_INVALID", location, "Change operation must be an object")
            continue
        operation_id = operation.get("operation_id")
        if not nonplaceholder(operation_id):
            add("ERROR", "CHANGE_OPERATION_ID_MISSING", location, "operation_id is required")
        elif operation_id in operation_ids:
            add("ERROR", "CHANGE_OPERATION_ID_DUPLICATE", location, f"Duplicate operation ID {operation_id!r}")
        else:
            operation_ids.add(operation_id)
        if change_manifest:
            for field in ("action", "change_domain", "entity_type", "entity_id", "current_value", "proposed_value", "rollback_action", "execution_status", "prechange_snapshot_id", "prechange_snapshot_hash", "prechange_captured_at"):
                if field not in operation or operation.get(field) is None or (isinstance(operation.get(field), str) and not operation.get(field).strip()):
                    add("ERROR", "CHANGE_OPERATION_FIELD_MISSING", location, f"{field} is required")
            for field in ("entity_id", "prechange_snapshot_id", "campaign_plan_id"):
                if not nonplaceholder(operation.get(field)):
                    add("ERROR", "CHANGE_OPERATION_IDENTITY_INVALID", f"{location}.{field}", f"{field} must be a non-placeholder stable identity")
            if not is_allowed(operation.get("entity_type"), ALLOWED_AD_ENTITY_TYPES):
                add("ERROR", "CHANGE_ENTITY_TYPE_INVALID", f"{location}.entity_type", "Unknown Amazon Ads entity_type")
            if operation.get("payload_schema_version") != CHANGE_PAYLOAD_SCHEMA_VERSION:
                add("ERROR", "CHANGE_PAYLOAD_SCHEMA_INVALID", f"{location}.payload_schema_version", f"Use the closed {CHANGE_PAYLOAD_SCHEMA_VERSION} payload contract")
            payload_objects_valid = True
            for field in ("current_value", "proposed_value"):
                payload_value = operation.get(field)
                if not isinstance(payload_value, dict):
                    add("ERROR", "CHANGE_PAYLOAD_TYPE_INVALID", f"{location}.{field}", f"{field} must be a normalized JSON object")
                    payload_objects_valid = False
                elif not payload_value:
                    add("ERROR", "CHANGE_OPERATION_VALUE_EMPTY", location, f"{field} must explicitly describe the exact state")
                    payload_objects_valid = False
                else:
                    unallowed_fields = unallowed_change_payload_fields(payload_value)
                    if unallowed_fields:
                        add("ERROR", "CHANGE_FIELD_NOT_ALLOWLISTED", f"{location}.{field}", f"Normalize or reject unrecognized payload paths: {', '.join(sorted(set(unallowed_fields)))}")
            if payload_objects_valid:
                for code, message in change_payload_semantic_issues(
                    operation.get("action"),
                    operation.get("entity_type"),
                    operation.get("current_value"),
                    operation.get("proposed_value"),
                    data.get("currency"),
                ):
                    add("ERROR", code, location, message)
            if not is_allowed(operation.get("change_domain"), CHANGE_DOMAINS):
                add("ERROR", "CHANGE_DOMAIN_INVALID", location, "Unknown change_domain")
            elif not is_allowed(operation.get("action"), ALLOWED_ACTIONS_BY_DOMAIN[operation.get("change_domain")]):
                add("ERROR", "CHANGE_ACTION_INVALID", location, "Action is not allowed for this change_domain")
            prechange_source = source_artifact_by_id.get(operation.get("prechange_snapshot_id"))
            if prechange_source is None or prechange_source.get("data_class") != "FIRST_PARTY" or not is_allowed(prechange_source.get("artifact_type"), PLACEMENT_ACCOUNT_ARTIFACT_TYPES):
                add("ERROR", "PRECHANGE_SNAPSHOT_INVALID", location, "A current first-party pre-change snapshot is required")
            elif prechange_source.get("marketplace") != data.get("marketplace") or prechange_source.get("account_id_masked") != scope.get("account_id_masked"):
                add("ERROR", "PRECHANGE_SNAPSHOT_SCOPE_MISMATCH", location, "Pre-change snapshot must match marketplace and account scope")
            elif prechange_source.get("sha256") != operation.get("prechange_snapshot_hash"):
                add("ERROR", "PRECHANGE_SNAPSHOT_HASH_MISMATCH", location, "Pre-change snapshot hash must match the source artifact")
            elif prechange_source.get("version_or_captured_at") != operation.get("prechange_captured_at"):
                add("ERROR", "PRECHANGE_SNAPSHOT_TIME_MISMATCH", location, "Pre-change snapshot time must match the cited first-party artifact")
            prechange_at = timestamp(operation.get("prechange_captured_at"), f"{location}.prechange_captured_at") if nonempty(operation.get("prechange_captured_at")) else None
            if prechange_at is not None and package_captured_at is not None:
                prechange_package_age = package_captured_at - prechange_at
                if prechange_package_age < timedelta(0) or prechange_package_age > MAX_PRECHANGE_PACKAGE_AGE:
                    add("ERROR", "PRECHANGE_SNAPSHOT_STALE_FOR_PACKAGE", location, "Prepared/executable changes require a pre-change snapshot within the validator's one-hour package safety window")
            if operation.get("change_domain") == "AMAZON_ADS":
                campaign_plan_id = operation.get("campaign_plan_id")
                campaign_row = architecture_by_id.get(campaign_plan_id)
                if campaign_row is None:
                    add("ERROR", "CHANGE_CAMPAIGN_PLAN_UNKNOWN", location, "Amazon Ads operation must reference a verified campaign_plan_id")
                elif campaign_row.get("onsite_scope") != "AMAZON_ONLY" or campaign_row.get("placement_scope_verified") != "VERIFIED_CURRENT":
                    add("ERROR", "CHANGE_CAMPAIGN_NOT_AMAZON_ONLY", location, "Referenced campaign plan is not verified Amazon-only")
                elif payload_objects_valid:
                    entity_type = operation.get("entity_type")
                    targeting_type = campaign_row.get("targeting_type")
                    keyword_entities = {"KEYWORD", "NEGATIVE_KEYWORD"}
                    product_entities = {"PRODUCT_TARGET", "NEGATIVE_PRODUCT_TARGET"}
                    if entity_type in keyword_entities and targeting_type != "MANUAL_KEYWORD":
                        add("ERROR", "CHANGE_CAMPAIGN_TARGET_KIND_MISMATCH", location, "Keyword operations require a MANUAL_KEYWORD campaign plan")
                    if entity_type in product_entities and targeting_type not in {"MANUAL_PRODUCT", "CONTEXTUAL_PRODUCT"}:
                        add("ERROR", "CHANGE_CAMPAIGN_TARGET_KIND_MISMATCH", location, "Product-target operations require a MANUAL_PRODUCT or CONTEXTUAL_PRODUCT campaign plan")
                    merged_operation_value = deep_merge(operation.get("current_value"), operation.get("proposed_value"))
                    if entity_type == "TARGET":
                        product_expression_keys = {"asin", "asins", "asinsameas", "categorysameas", "targetingexpression", "negativeexpression"}

                        def contains_product_expression(value: Any) -> bool:
                            if isinstance(value, dict):
                                for raw_key, child in value.items():
                                    if re.sub(r"[^a-z0-9]", "", str(raw_key).lower()) in product_expression_keys:
                                        return True
                                    if contains_product_expression(child):
                                        return True
                            elif isinstance(value, list):
                                return any(contains_product_expression(child) for child in value)
                            return False

                        if contains_product_expression(merged_operation_value) and targeting_type not in {"MANUAL_PRODUCT", "CONTEXTUAL_PRODUCT"}:
                            add("ERROR", "CHANGE_CAMPAIGN_TARGET_KIND_MISMATCH", location, "A generic TARGET carrying a product expression requires a product-targeting campaign plan")
                    for payload_field in ("current_value", "proposed_value"):
                        payload_value = operation.get(payload_field, {})
                        for raw_key, raw_value in payload_value.items():
                            normalized_key = re.sub(r"[^a-z0-9]", "", str(raw_key).lower())
                            if normalized_key == "adproduct" and raw_value != campaign_row.get("ad_product"):
                                add("ERROR", "CHANGE_PAYLOAD_SEMANTICS_INVALID", f"{location}.{payload_field}", "Payload adProduct must match the referenced campaign-plan ad product")
                            if normalized_key == "targetingtype" and raw_value != campaign_row.get("targeting_type"):
                                add("ERROR", "CHANGE_PAYLOAD_SEMANTICS_INVALID", f"{location}.{payload_field}", "Payload targetingType must match the referenced campaign-plan targeting type")
                    if entity_type == "CAMPAIGN" and operation.get("action") == "CREATE":
                        proposed_map = {
                            re.sub(r"[^a-z0-9]", "", str(key).lower()): value
                            for key, value in operation.get("proposed_value", {}).items()
                        }
                        if proposed_map.get("adproduct") != campaign_row.get("ad_product") or proposed_map.get("targetingtype") != campaign_row.get("targeting_type"):
                            add("ERROR", "CHANGE_CAMPAIGN_TARGET_KIND_MISMATCH", location, "Created campaign must exactly match the audited campaign-plan ad product and targeting type")
                if operation.get("onsite_scope_after") != "AMAZON_ONLY" or not is_allowed(operation.get("placement_scope_effect"), {"UNCHANGED_AMAZON_ONLY", "SET_AMAZON_ONLY"}):
                    add("ERROR", "CHANGE_WEAKENS_AMAZON_ONLY", location, "Every Amazon Ads operation must preserve or set Amazon-only scope")
                unrecognized_fields = unrecognized_scope_fields(operation.get("proposed_value"))
                if unrecognized_fields:
                    add("ERROR", "OFFSITE_FIELD_UNRECOGNIZED", location, f"Unrecognized reach/supply/inventory field paths must fail closed: {', '.join(sorted(set(unrecognized_fields)))}")
                if contains_offsite_change(operation.get("proposed_value")):
                    add("ERROR", "OFFSITE_CHANGE_PROPOSED", location, "Proposed value contains an off-Amazon reach change")
                final_value = deep_merge(operation.get("current_value"), operation.get("proposed_value"))
                unrecognized_final_fields = unrecognized_scope_fields(final_value)
                if unrecognized_final_fields:
                    add("ERROR", "OFFSITE_FIELD_UNRECOGNIZED", location, f"Merged final state contains unrecognized reach/supply/inventory fields: {', '.join(sorted(set(unrecognized_final_fields)))}")
                if contains_offsite_change(final_value):
                    add("ERROR", "OFFSITE_FINAL_STATE_PROPOSED", location, "The merged post-change state still enables or implies off-Amazon reach")
                before_control = operation.get("amazon_only_control_before")
                after_control = operation.get("amazon_only_control_after")
                if not isinstance(before_control, bool) or after_control is not True:
                    add("ERROR", "AMAZON_ONLY_CONTROL_STATE_INVALID", location, "Operations must declare the exact Amazon-only control before state and a true after state")
                elif before_control is False and (operation.get("placement_scope_effect") != "SET_AMAZON_ONLY" or not contains_amazon_only_assertion(operation.get("proposed_value"))):
                    add("ERROR", "AMAZON_ONLY_CONTROL_NOT_EXPLICITLY_SET", location, "Moving from broader reach requires an explicit Amazon-only control in the proposed payload")
        if execution_authority == "PREPARE_CHANGES" and operation.get("execution_status") != "NOT_AUTHORIZED":
            add("ERROR", "PREPARED_OPERATION_STATE_INVALID", location, "Prepared changes must remain NOT_AUTHORIZED")
        if execution_authority == "EXECUTION_AUTHORIZED" and operation.get("execution_status") != "NOT_STARTED":
            add("ERROR", "AUTHORIZED_OPERATION_STATE_INVALID", location, "Authorized manifest must remain immutable with NOT_STARTED state before execution")
    if execution_authority == "PLAN_ONLY":
        for index, operation in enumerate(change_manifest):
            if isinstance(operation, dict) and not is_allowed(operation.get("execution_status"), {"NOT_AUTHORIZED", "NOT_APPLICABLE"}):
                add("ERROR", "UNAUTHORIZED_OPERATION_STATE", f"change_manifest[{index}]", "PLAN_ONLY changes must remain NOT_AUTHORIZED")

    if deliverable_mode == "PREPARE_CHANGES" and execution_authority != "PREPARE_CHANGES":
        add("ERROR", "PREPARE_AUTHORITY_MISMATCH", "execution_authority", "PREPARE_CHANGES deliverable requires PREPARE_CHANGES authority state")
    if deliverable_mode == "EXECUTE" and execution_authority != "EXECUTION_AUTHORIZED":
        add("ERROR", "EXECUTE_NOT_AUTHORIZED", "execution_authority", "EXECUTE requires fresh exact authorization")
    if execution_authority == "EXECUTION_AUTHORIZED" and deliverable_mode != "EXECUTE":
        add("ERROR", "AUTHORIZED_MODE_MISMATCH", "deliverable_mode", "Execution authorization is valid only for EXECUTE mode")
    if is_allowed(execution_authority, {"PREPARE_CHANGES", "EXECUTION_AUTHORIZED"}) and not change_manifest:
        add("ERROR", "CHANGE_MANIFEST_EMPTY", "change_manifest", "Prepared or authorized execution requires an exact non-empty manifest")

    authorization = data.get("authorization_record", {})
    if execution_authority == "EXECUTION_AUTHORIZED":
        authorization = require_dict(authorization, add, "AUTHORIZATION_INVALID", "authorization_record")
        for field in ("confirmed_at", "account_id_masked", "marketplace", "manifest_hash", "prechange_snapshot_hash"):
            if not nonplaceholder(authorization.get(field)):
                add("ERROR", "AUTHORIZATION_FIELD_MISSING", f"authorization_record.{field}", f"{field} is required")
        if authorization.get("user_confirmed") is not True:
            add("ERROR", "AUTHORIZATION_NOT_CONFIRMED", "authorization_record.user_confirmed", "Fresh user confirmation is required")
        confirmed_at = timestamp(authorization.get("confirmed_at"), "authorization_record.confirmed_at") if nonempty(authorization.get("confirmed_at")) else None
        if confirmed_at is not None:
            runtime_authorization_age = runtime_now - confirmed_at.astimezone(timezone.utc)
            if runtime_authorization_age < -MAX_CLOCK_SKEW or runtime_authorization_age > MAX_EXECUTION_AUTH_RUNTIME_AGE:
                add("ERROR", "AUTHORIZATION_RUNTIME_EXPIRED", "authorization_record.confirmed_at", "Execution authorization must be confirmed within the validator's one-hour runtime safety window")
        for index, operation in enumerate(change_manifest):
            if not isinstance(operation, dict) or not nonempty(operation.get("prechange_captured_at")):
                continue
            prechange_at = timestamp(operation.get("prechange_captured_at"), f"change_manifest[{index}].prechange_captured_at")
            if confirmed_at is not None and prechange_at is not None and confirmed_at < prechange_at:
                add("ERROR", "AUTHORIZATION_PREDATES_SNAPSHOT", "authorization_record.confirmed_at", "Fresh authorization must occur after the cited pre-change snapshot")
            elif confirmed_at is not None and prechange_at is not None and confirmed_at - prechange_at > MAX_PRECHANGE_AUTH_AGE:
                add("ERROR", "AUTHORIZATION_SNAPSHOT_STALE", "authorization_record.confirmed_at", "Execution authorization requires a pre-change snapshot captured within the validator's one-hour safety window")
        allowed_ops = authorization.get("allowed_operation_ids")
        if not isinstance(allowed_ops, list) or not allowed_ops:
            add("ERROR", "AUTHORIZED_OPERATIONS_MISSING", "authorization_record.allowed_operation_ids", "Exact operation IDs are required")
        else:
            if any(not nonplaceholder(operation_id) for operation_id in allowed_ops) or len(allowed_ops) != len(set(allowed_ops)) or set(allowed_ops) != operation_ids:
                add("ERROR", "AUTHORIZED_OPERATION_SET_MISMATCH", "authorization_record.allowed_operation_ids", "Fresh authorization must cover exactly every operation in this manifest")
        if authorization.get("account_id_masked") != scope.get("account_id_masked") or authorization.get("marketplace") != data.get("marketplace"):
            add("ERROR", "AUTHORIZATION_SCOPE_MISMATCH", "authorization_record", "Authorization account and marketplace must match the strategy scope")
        if authorization.get("manifest_hash") != manifest_hash(change_manifest):
            add("ERROR", "AUTHORIZATION_MANIFEST_MISMATCH", "authorization_record.manifest_hash", "Authorization must match the exact canonical change manifest")
        manifest_snapshot_values = [operation.get("prechange_snapshot_hash") for operation in change_manifest if isinstance(operation, dict)]
        manifest_snapshot_hashes = {value for value in manifest_snapshot_values if nonplaceholder(value)}
        if len(manifest_snapshot_hashes) != len(manifest_snapshot_values):
            add("ERROR", "AUTHORIZATION_SNAPSHOT_MISMATCH", "authorization_record.prechange_snapshot_hash", "Every manifest pre-change snapshot hash must be a non-placeholder scalar identity")
        if len(manifest_snapshot_hashes) != 1 or authorization.get("prechange_snapshot_hash") not in manifest_snapshot_hashes:
            add("ERROR", "AUTHORIZATION_SNAPSHOT_MISMATCH", "authorization_record.prechange_snapshot_hash", "Authorization must bind the exact pre-change live snapshot")

    allowed_statuses_by_deliverable = {
        "ECONOMICS_ONLY": {"BLOCKED", "PROVISIONAL", "ECONOMICS_READY"},
        "PLAN": {"BLOCKED", "PROVISIONAL", "PLAN_READY"},
        "AUDIT": {"BLOCKED", "PROVISIONAL"},
        "REFRESH": {"BLOCKED", "PROVISIONAL", "PLAN_READY"},
        "PREPARE_CHANGES": {"BLOCKED", "PROVISIONAL", "READY_FOR_EXECUTION_REVIEW"},
        "EXECUTE": {"EXECUTION_AUTHORIZED"},
    }
    if is_allowed(deliverable_mode, set(allowed_statuses_by_deliverable)) and not is_allowed(status, allowed_statuses_by_deliverable[deliverable_mode]):
        add("ERROR", "DELIVERABLE_STATUS_MISMATCH", "strategy_status", "strategy_status is not valid for this deliverable mode")
    if status == "PLAN_READY" and execution_authority != "PLAN_ONLY":
        add("ERROR", "PLAN_READY_AUTHORITY_INVALID", "execution_authority", "PLAN_READY is plan-only and carries no live-action authorization")
    if status == "READY_FOR_EXECUTION_REVIEW" and execution_authority != "PREPARE_CHANGES":
        add("ERROR", "EXECUTION_REVIEW_AUTHORITY_INVALID", "execution_authority", "READY_FOR_EXECUTION_REVIEW is an unexecuted prepared manifest, not authorization")
    if status == "EXECUTION_AUTHORIZED" and (deliverable_mode != "EXECUTE" or execution_authority != "EXECUTION_AUTHORIZED"):
        add("ERROR", "EXECUTION_STATUS_AUTHORITY_INVALID", "execution_authority", "EXECUTION_AUTHORIZED requires EXECUTE mode and fresh exact authority")
    if status == "ECONOMICS_READY" and (not is_allowed(economics_status, {"READY_ACTUAL", "READY_ESTIMATED"}) or assumed_zero):
        add("ERROR", "ECONOMICS_READY_STATUS_INVALID", "strategy_status", "ECONOMICS_READY requires a complete non-provisional calculator result")

    if traffic_ready_status:
        if listing_status != "READY" or listing_release.get("integrity_status") != "VERIFIED":
            add("ERROR", "LISTING_NOT_READY", "upstream_snapshots.listing_release", "Ready strategy requires a verified READY Listing release")
        if not policy_verified:
            add("ERROR", "POLICY_UNVERIFIED", "policy_snapshot.verified", "Ready strategy requires current policy verification")
        for field, value in policy_gates.items():
            if value != "VERIFIED_CURRENT":
                add("ERROR", "POLICY_GATE_UNVERIFIED", f"policy_snapshot.{field}", f"{field} must be VERIFIED_CURRENT")
        if account.get("advertising_eligibility") != "ELIGIBLE":
            add("ERROR", "ACCOUNT_NOT_ELIGIBLE", "account_snapshot.advertising_eligibility", "Ready strategy requires current account/offer eligibility")
        featured_offer_state = account.get("featured_offer_or_current_equivalent")
        if featured_offer_state != "ELIGIBLE":
            verified_exception_products: set[str] = set()
            if featured_offer_state == "NOT_REQUIRED_VERIFIED":
                for source_id in policy.get("sources", []) if isinstance(policy.get("sources"), list) else []:
                    source = source_artifact_by_id.get(source_id, {})
                    if (
                        source.get("artifact_type") == "official_policy"
                        and source.get("data_class") == "OFFICIAL_POLICY"
                        and isinstance(source.get("policy_domains"), list)
                        and "FEATURED_OFFER_REQUIREMENT" in source.get("policy_domains", [])
                        and source.get("marketplace") in (data.get("marketplace"), "GLOBAL")
                        and isinstance(source.get("ad_products"), list)
                    ):
                        verified_exception_products.update(value for value in source.get("ad_products", []) if nonplaceholder(value))
            if featured_offer_state != "NOT_REQUIRED_VERIFIED" or not selected_ad_products <= verified_exception_products:
                add("ERROR", "FEATURED_OFFER_NOT_ELIGIBLE", "account_snapshot.featured_offer_or_current_equivalent", "Traffic readiness requires current Featured Offer/current-equivalent eligibility or an explicit current official-policy exception for every selected ad product")
        raw_reason_codes = binding_calc.get("reason_codes", [])
        reason_codes = {value for value in raw_reason_codes if isinstance(value, str)} if isinstance(raw_reason_codes, list) else set()
        if isinstance(raw_reason_codes, list) and len(reason_codes) != len(raw_reason_codes):
            add("ERROR", "CALCULATOR_REASON_CODES_INVALID", "economics.calculator_result.reason_codes", "Calculator reason codes must be unique scalar strings")
        if is_allowed(economics_status, {"PROVISIONAL", "BLOCKED"}) or assumed_zero or READY_BLOCKING_ECONOMICS_REASONS.intersection(reason_codes):
            add("ERROR", "ECONOMICS_NOT_READY", "economics.calculator_result", "Ready strategy requires non-provisional economics with no assumed-zero fields")
        contribution = binding_calc.get("contribution", {}) if isinstance(binding_calc.get("contribution", {}), dict) else {}
        if contribution.get("all_in_before_ads") is None:
            add("ERROR", "ALL_IN_CONTRIBUTION_UNAVAILABLE", "economics.calculator_result", "Ready traffic strategy requires allocated all-in contribution")
        if strategy_mode == "EXISTING_PRODUCT_OPTIMIZATION" and economics_status != "READY_ACTUAL":
            add("ERROR", "EXISTING_ECONOMICS_NOT_ACTUAL", "economics.calculator_result.overall_status", "Existing-product ready plan requires actual economics/report basis")
        requires_full_strategy = is_allowed(deliverable_mode, {"PLAN", "REFRESH", "PREPARE_CHANGES", "EXECUTE"})
        if requires_full_strategy and not architecture:
            add("ERROR", "READY_ARCHITECTURE_MISSING", "campaign_architecture", "Ready traffic work requires the complete verified architecture")
        if requires_full_strategy and not phases:
            add("ERROR", "READY_PHASE_PLAN_MISSING", "phase_plan", "Ready traffic work requires the complete phase plan")
        if requires_full_strategy and not decision_rules:
            add("ERROR", "READY_DECISION_RULES_MISSING", "decision_rules", "Ready traffic work requires decision rules")
        if requires_full_strategy:
            for index, row in enumerate(architecture):
                if isinstance(row, dict) and number(row.get("proposed_budget"), f"campaign_architecture[{index}].proposed_budget") is None:
                    add("ERROR", "READY_BUDGET_MISSING", f"campaign_architecture[{index}].proposed_budget", "A ready plan requires a proposed budget")
            for index, target in enumerate(keyword_targets):
                if isinstance(target, dict) and target.get("ad_decision") == "INCLUDE":
                    if number(target.get("proposed_bid"), f"keyword_targets[{index}].proposed_bid") is None or number(target.get("bid_ceiling"), f"keyword_targets[{index}].bid_ceiling") is None:
                        add("ERROR", "READY_KEYWORD_BID_MISSING", f"keyword_targets[{index}]", "An included target in a ready plan requires both proposed bid and bid ceiling")
            for index, target in enumerate(product_targets):
                if isinstance(target, dict) and target.get("ad_decision") == "INCLUDE":
                    if number(target.get("proposed_bid"), f"product_targets[{index}].proposed_bid") is None or number(target.get("bid_ceiling"), f"product_targets[{index}].bid_ceiling") is None:
                        add("ERROR", "READY_PRODUCT_BID_MISSING", f"product_targets[{index}]", "An included product target in a ready plan requires both proposed bid and bid ceiling")
        if requires_full_strategy:
            for field in ("sellable_units", "reserved_units", "safety_stock_units", "lead_time_days"):
                if inventory.get(field) is None:
                    add("ERROR", "READY_INVENTORY_GAP", f"inventory.{field}", f"{field} is required")
        if not source_artifacts:
            add("ERROR", "READY_SOURCES_MISSING", "source_artifacts", "A ready strategy requires traceable source artifacts")
        if lineage_mode == "FULL_WORKFLOW" and requires_full_strategy:
            if not selection_snapshot or not competitor_snapshot or not keyword_snapshot:
                add("ERROR", "READY_UPSTREAM_SNAPSHOTS_MISSING", "upstream_snapshots", "Full-workflow readiness requires selection, competitor-lock, and keyword manifests")
            downstream_keyword_source_ids = {target.get("source_keyword_id") for target in keyword_targets if isinstance(target, dict) and nonplaceholder(target.get("source_keyword_id"))}
            missing_keywords = sorted(set(upstream_keyword_by_id) - downstream_keyword_source_ids)
            if missing_keywords:
                add("ERROR", "UPSTREAM_KEYWORD_COVERAGE_MISSING", "keyword_targets", f"Upstream keywords missing from the ad audit trail: {', '.join(missing_keywords)}")
            downstream_asins = {target.get("asin") for target in product_targets if isinstance(target, dict) and nonplaceholder(target.get("asin"))}
            missing_competitors = sorted(set(upstream_competitor_by_asin) - downstream_asins)
            if missing_competitors:
                add("ERROR", "LOCKED_COMPETITOR_COVERAGE_MISSING", "product_targets", f"Locked competitors missing from the ad audit trail: {', '.join(missing_competitors)}")
        if strategy_mode == "EXISTING_PRODUCT_OPTIMIZATION":
            for index, rule in enumerate(decision_rules):
                if isinstance(rule, dict) and not rule.get("source_snapshot_ids"):
                    add("ERROR", "EXISTING_RULE_SOURCE_MISSING", f"decision_rules[{index}]", "Existing-product decision rules require first-party snapshot IDs")

    errors = [item for item in findings if item.severity == "ERROR"]
    structurally_valid = not errors
    plan_ready = structurally_valid and status == "PLAN_READY"
    execution_review_ready = (
        structurally_valid
        and status == "READY_FOR_EXECUTION_REVIEW"
        and deliverable_mode == "PREPARE_CHANGES"
        and execution_authority == "PREPARE_CHANGES"
    )
    authorization_record_structurally_valid = (
        structurally_valid
        and status == "EXECUTION_AUTHORIZED"
        and deliverable_mode == "EXECUTE"
        and execution_authority == "EXECUTION_AUTHORIZED"
    )
    return {
        "structurally_valid": structurally_valid,
        "economics_ready": structurally_valid and status == "ECONOMICS_READY",
        "plan_ready": plan_ready,
        "execution_review_ready": execution_review_ready,
        "authorization_record_structurally_valid": authorization_record_structurally_valid,
        "execution_authorized": False,
        "trusted_external_grant_required": authorization_record_structurally_valid,
        "summary": {
            "strategy_mode": strategy_mode,
            "deliverable_mode": deliverable_mode,
            "strategy_status": status,
            "keyword_targets": len(keyword_targets),
            "product_targets": len(product_targets),
            "campaign_rows": len(architecture),
            "phase_rows": len(phases),
            "decision_rules": len(decision_rules),
            "complete_first_party_snapshots": complete_first_party,
            "errors": len(errors),
        },
        "findings": [asdict(item) for item in findings],
        "limitations": [
            "Does not authenticate reports, fee records, account eligibility, or authorization identity; a structurally valid authorization record is never a trusted live-execution grant",
            "Does not replace current Amazon Ads/Seller Central policy or legal review",
            "Does not predict ranking, reviews, traffic, conversion, profitability, or incrementality",
            "Does not apply any live account change",
        ],
    }


def validate(data: dict[str, Any]) -> dict[str, Any]:
    """Fail closed on malformed but valid JSON instead of crashing the CLI."""
    try:
        return _validate(data)
    except Exception as exc:  # noqa: BLE001 - trust-boundary fail-closed wrapper
        strategy_mode = data.get("strategy_mode") if isinstance(data.get("strategy_mode"), str) else None
        deliverable_mode = data.get("deliverable_mode") if isinstance(data.get("deliverable_mode"), str) else None
        strategy_status = data.get("strategy_status") if isinstance(data.get("strategy_status"), str) else None
        return {
            "structurally_valid": False,
            "economics_ready": False,
            "plan_ready": False,
            "execution_review_ready": False,
            "authorization_record_structurally_valid": False,
            "execution_authorized": False,
            "trusted_external_grant_required": False,
            "summary": {
                "strategy_mode": strategy_mode,
                "deliverable_mode": deliverable_mode,
                "strategy_status": strategy_status,
                "keyword_targets": 0,
                "product_targets": 0,
                "campaign_rows": 0,
                "phase_rows": 0,
                "decision_rules": 0,
                "complete_first_party_snapshots": 0,
                "errors": 1,
            },
            "findings": [{
                "severity": "ERROR",
                "code": "MALFORMED_VALUE_TYPE",
                "location": "package",
                "message": f"Malformed JSON value type failed closed: {type(exc).__name__}: {exc}",
            }],
            "limitations": [
                "Malformed value types are rejected without attempting plan or execution readiness",
                "Does not authenticate data or grant live execution authority",
                "Does not apply any live account change",
            ],
        }


def render_text(result: dict[str, Any]) -> str:
    status = result["summary"]["strategy_status"] if result["structurally_valid"] else "INVALID"
    lines = [f"Advertising strategy package: {status}"]
    summary = result["summary"]
    lines.append(
        f"Mode={summary['strategy_mode']}; deliverable={summary['deliverable_mode']}; "
        f"targets={summary['keyword_targets'] + summary['product_targets']}; "
        f"campaigns={summary['campaign_rows']}; phases={summary['phase_rows']}; errors={summary['errors']}"
    )
    if result["findings"]:
        lines.append("Findings:")
        for finding in result["findings"]:
            lines.append(f"- {finding['severity']} {finding['code']} [{finding['location']}]: {finding['message']}")
    else:
        lines.append("Findings: none")
    lines.append("Limitations:")
    lines.extend(f"- {item}" for item in result["limitations"])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Path to UTF-8 JSON, or - for stdin")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        raw = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("top-level JSON value must be an object")
        result = validate(data)
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
