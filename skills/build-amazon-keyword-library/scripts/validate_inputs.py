#!/usr/bin/env python3
"""Validate inputs and capabilities for build-amazon-keyword-library."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
from typing import Any


STATIC_MARKETPLACES = {
    "US", "JP", "UK", "DE", "FR", "IT", "ES",
    "CA", "IN", "MX", "BR", "AU", "AE",
}
MODES = {
    "FULL_BUILD",
    "COMPETITOR_ACQUISITION",
    "PRODUCT_ASIN_ENRICHMENT",
    "SERP_ONLY",
    "AUDIT",
    "INCREMENTAL_REFRESH",
}
ASIN_ROLES = {"OUR_PRODUCT", "COMPETITOR", "UNKNOWN_ROLE"}
EVIDENCE_TYPES = {
    "OBSERVED_PRODUCT_SOURCE",
    "OBSERVED_COMPLIANCE_DOC",
    "OBSERVED_AMAZON_COPY",
    "OBSERVED_SERP",
    "USER_CONFIRMED",
    "FIRST_PARTY_PERFORMANCE",
    "ESTIMATED_THIRD_PARTY",
    "INFERRED",
    "UNKNOWN",
}
RISK_CLASSES = {
    "LOW_RISK_SPEC",
    "QUANTIFIED_PERFORMANCE",
    "CERTIFICATION_SAFETY",
    "MEDICAL_ENVIRONMENTAL_CHILDREN",
    "BRAND_IP",
}
RESEARCH_STATUSES = {"RESEARCH_USABLE", "RESEARCH_HOLD"}
PUBLICATION_STATUSES = {
    "COPY_RELEASED",
    "FORMAL_CLAIM_RELEASED",
    "HOLD_FEATURE",
    "CONTRADICTED",
    "NOT_SUPPORTED",
    "NOT_APPLICABLE",
}
DOCUMENT_TYPES = {
    "MSDS_SDS",
    "TEST_REPORT",
    "SDOC_DOC",
    "CERTIFICATE_LISTING",
    "MARK_AUTHORIZATION",
    "PENDING_NOTICE",
    "OWN_LISTING",
    "COMPETITOR_COPY",
}
DOCUMENT_VALID_STATUSES = {
    "ACTIVE", "VALID", "EXPIRED", "REVOKED", "SUSPENDED", "PENDING", "UNKNOWN",
}
RELEASE_VALID_STATUSES = {"ACTIVE", "VALID"}
DOCUMENT_REVIEW_STATUSES = {"PENDING", "APPROVED", "REJECTED"}
COVERAGE_LEVELS = {
    "whole_unit", "battery_pack", "cell", "component", "accessory",
}
DELIVERABLES = {
    "KEYWORD_LIBRARY",
    "SERP_VALIDATION",
    "SOURCE_COVERAGE",
    "EVIDENCE_AUDIT",
    "LISTING_HANDOFF",
}
OUT_OF_SCOPE_AD_DELIVERABLES = {
    "MATCH_TYPE_GUIDANCE",
    "EXACT_BID",
    "EXACT_DAILY_BUDGET",
    "STOP_LOSS",
}
DECISION_BASES = {"CURRENT", "TARGET_RANGE", "BOTH"}
QUANTIFIED_VALUE_TYPES = {"TYPICAL", "MAXIMUM", "GUARANTEED"}
CURRENCY_BY_MARKETPLACE = {
    "US": "USD", "JP": "JPY", "UK": "GBP", "DE": "EUR",
    "FR": "EUR", "IT": "EUR", "ES": "EUR", "CA": "CAD",
    "IN": "INR", "MX": "MXN", "BR": "BRL", "AU": "AUD",
    "AE": "AED",
}
SEED_PURPOSES = {
    "MARKET_DISCOVERY",
    "COMPETITOR_DISCOVERY",
    "SERP_VALIDATION",
    "ISOLATED_RISK_RESEARCH",
}
COMPETITOR_SOURCE_ROLES = {
    "USER_SUPPLIED", "UPSTREAM_SELECTED", "RESEARCH_ADDED",
}
COMPETITOR_ROLES = {
    "LEADER", "LAUNCH_PEER", "DIRECT_PRICE_FORM", "NEW_ENTRANT",
    "DIFFERENTIATED_CHALLENGER", "ADJACENT_ALTERNATIVE",
}
COMPETITOR_LOCK_STATUSES = {
    "CORE_BENCHMARK", "BOUNDARY_REFERENCE", "DIFFERENTIATION_REFERENCE",
    "KEYWORD_SOURCE_ONLY", "CONTEXT_ONLY", "IDENTITY_PENDING",
    "EXCLUDED_INVALID",
}
KEYWORD_ACQUISITION_SCOPES = {"FULL_TRAFFIC", "CONTEXT_ONLY", "NO_QUERY"}
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
CONTENT_CHANGE_STATES = {"OPEN", "LOCKED", "PARTIAL", "UNKNOWN"}
CONTENT_SCOPES = {
    "TITLE", "ITEM_HIGHLIGHT", "BULLETS", "PRODUCT_DESCRIPTION",
    "SEARCH_TERMS", "IMAGES", "A_PLUS",
}
RISK_ACK_DECISIONS = {
    "ACKNOWLEDGED_FOR_OPERATION", "NOT_ACCEPTED", "REVIEW_REQUIRED",
}
RISK_OVERRIDE_KEYS = {
    "publication_status_override", "research_status_override",
    "claim_release", "library_role_override", "release_status_override",
}

ASIN_PATTERN = re.compile(r"^[A-Z0-9]{10}$")
ASCII_COMPLIANCE_TOKEN = (
    r"(?<![A-Za-z0-9])(?:ul(?:\s*499)?|fcc|ce|rohs|msds|sds)"
    r"(?![A-Za-z0-9])"
)
ENGLISH_COMPLIANCE_TOKEN = (
    r"(?<![A-Za-z0-9])(?:certif(?:ied|ication)?|listed|approved|"
    r"compliant|compliance|medical|clinical(?:ly)?|safe(?:ty)?|"
    r"non[- ]?toxic|bpa[- ]?free|food[- ]?grade)(?![A-Za-z0-9])"
)
CHINESE_COMPLIANCE_TOKEN = (
    r"(?:认证|合规|符合(?:相关)?(?:标准|法规|认证要求|合规要求)|"
    r"安全|医疗(?:级|用途|器械|设备)?|临床|无毒|食品级)"
)
COMPLIANCE_OR_MEDICAL_PATTERN = (
    rf"(?:{ASCII_COMPLIANCE_TOKEN}|{ENGLISH_COMPLIANCE_TOKEN}|"
    rf"{CHINESE_COMPLIANCE_TOKEN})"
)
HIGH_RISK_TEXT = re.compile(
    rf"(?:{COMPLIANCE_OR_MEDICAL_PATTERN}|"
    r"(?<![A-Za-z0-9])(?:fastest|best|guaranteed)(?![A-Za-z0-9])|"
    r"最快|最佳|保证)",
    re.IGNORECASE,
)
COMPLIANCE_OR_MEDICAL_TEXT = re.compile(
    COMPLIANCE_OR_MEDICAL_PATTERN,
    re.IGNORECASE,
)
QUANTIFIED_CLAIM_TEXT = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:ms|msec|seconds?|secs?|minutes?|mins?|"
    r"hours?|hrs?|°\s*[cf]|degrees?\s*[cf]|watts?|w|percent|%)\b",
    re.IGNORECASE,
)
ORAL_OR_COPY_SOURCE = re.compile(
    r"factory|oral|口头|工厂|user said|用户确认|own listing|我方listing|"
    r"competitor|竞品",
    re.IGNORECASE,
)
CERTIFICATION_WORDS = re.compile(
    r"\b(certif(?:ied|ication)?|listed|approved)\b", re.IGNORECASE
)
MARK_WORDS = re.compile(r"\b(logo|mark)\b|徽标|标志", re.IGNORECASE)
MSDS_FORBIDDEN_WORDS = re.compile(
    r"\b(passed|certif(?:ied|ication)?|approved|safe(?:ty)?)\b",
    re.IGNORECASE,
)


def load_json(path: str) -> Any:
    if path == "-":
        return json.load(sys.stdin)
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def normalize_asin(value: Any) -> str:
    return value.strip().upper() if isinstance(value, str) else ""


def operating_context_sha256(value: dict[str, Any]) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def validate_enum(
    value: Any,
    allowed: set[str],
    label: str,
    errors: list[str],
    *,
    required: bool = True,
) -> str | None:
    if value is None:
        if required:
            errors.append(f"{label} 必填；允许值：{', '.join(sorted(allowed))}。")
        return None
    if not isinstance(value, str) or value not in allowed:
        errors.append(f"{label} 无效；允许值：{', '.join(sorted(allowed))}。")
        return None
    return value


def validate_nonnegative(
    container: dict[str, Any],
    key: str,
    label: str,
    errors: list[str],
    *,
    integer: bool = False,
) -> Any:
    value = container.get(key)
    if value is None:
        return None
    if not is_number(value) or value < 0:
        errors.append(f"{label} 必须是非负数字或 null。")
        return None
    if integer and int(value) != value:
        errors.append(f"{label} 必须是整数。")
        return None
    return value


def validate_iso_date(
    value: Any,
    label: str,
    errors: list[str],
    *,
    required: bool = False,
) -> dt.date | None:
    if value is None:
        if required:
            errors.append(f"{label} 必填，格式为 YYYY-MM-DD。")
        return None
    if not isinstance(value, str):
        errors.append(f"{label} 必须是 YYYY-MM-DD 字符串。")
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        errors.append(f"{label} 必须是有效的 YYYY-MM-DD 日期。")
        return None


def validate_iso_datetime(
    value: Any,
    label: str,
    errors: list[str],
    *,
    required: bool = False,
) -> dt.datetime | None:
    if value is None:
        if required:
            errors.append(f"{label} 必填，且必须是带时区的 ISO-8601 时间。")
        return None
    if not isinstance(value, str):
        errors.append(f"{label} 必须是带时区的 ISO-8601 字符串。")
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        errors.append(f"{label} 必须是有效的 ISO-8601 时间。")
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        errors.append(f"{label} 必须包含时区。")
        return None
    return parsed


def validate_string_list(
    value: Any,
    label: str,
    errors: list[str],
    *,
    required: bool = False,
    allowed: set[str] | None = None,
) -> list[str]:
    if value is None:
        if required:
            errors.append(f"{label} 必填，且必须是非空字符串 array。")
        return []
    if not isinstance(value, list) or any(
        not isinstance(item, str) or not item.strip() for item in value
    ):
        errors.append(f"{label} 必须是非空字符串组成的 array。")
        return []
    normalized = [item.strip() for item in value]
    if required and not normalized:
        errors.append(f"{label} 不能为空。")
    if allowed is not None:
        invalid = sorted(set(normalized) - allowed)
        if invalid:
            errors.append(f"{label} 含无效值：{', '.join(invalid)}。")
    return normalized


def validate_currency(
    value: Any,
    label: str,
    marketplace: str,
    errors: list[str],
) -> str | None:
    if not isinstance(value, str) or len(value.strip()) != 3:
        errors.append(f"{label} 必须是 3 位币种代码。")
        return None
    currency = value.strip().upper()
    expected = CURRENCY_BY_MARKETPLACE.get(marketplace)
    if expected and currency != expected:
        errors.append(f"{label}={currency} 与 {marketplace} 站默认币种 {expected} 不一致。")
    return currency


def validate_operating_context(
    value: Any,
    marketplace: str,
    errors: list[str],
    warnings: list[str],
) -> dict[str, Any]:
    """Validate optional operational context without turning it into ad advice."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        errors.append("operating_context 必须是 object 或 null。")
        return {}

    context_id = value.get("context_id")
    if not isinstance(context_id, str) or not context_id.strip():
        errors.append("提供 operating_context 时，context_id 必须是非空稳定 ID。")

    profit = value.get("profit_objective", {})
    if profit is None:
        profit = {}
    if not isinstance(profit, dict):
        errors.append("operating_context.profit_objective 必须是 object 或 null。")
        profit = {}
    contribution_rate = profit.get("minimum_post_ads_contribution_rate")
    if contribution_rate is not None and (
        not is_number(contribution_rate) or not 0 <= contribution_rate <= 1
    ):
        errors.append(
            "operating_context.profit_objective.minimum_post_ads_contribution_rate 必须在 0 到 1 之间。"
        )
    for field in ("target_profit_per_order", "risk_buffer_per_order"):
        amount = profit.get(field)
        if amount is not None and (not is_number(amount) or amount < 0):
            errors.append(
                f"operating_context.profit_objective.{field} 必须是非负数字。"
            )
    contribution_basis = profit.get("contribution_rate_basis")
    legacy_basis = profit.get("rate_basis")
    if legacy_basis is not None:
        if contribution_basis is not None and contribution_basis != legacy_basis:
            errors.append(
                "operating_context.profit_objective.contribution_rate_basis 与旧 rate_basis 冲突。"
            )
        else:
            contribution_basis = legacy_basis
            warnings.append(
                "旧 rate_basis 已兼容读取；新输出只写 contribution_rate_basis。"
            )
    if contribution_basis is not None and contribution_basis != "NET_SALES_REVENUE":
        errors.append(
            "operating_context.profit_objective.contribution_rate_basis 必须为 NET_SALES_REVENUE。"
        )
    if contribution_rate is not None and contribution_basis != "NET_SALES_REVENUE":
        errors.append(
            "比例利润底线必须声明 contribution_rate_basis=NET_SALES_REVENUE。"
        )

    price_context = value.get("price_context", {})
    if price_context is None:
        price_context = {}
    if not isinstance(price_context, dict):
        errors.append("operating_context.price_context 必须是 object 或 null。")
        price_context = {}

    current = price_context.get("current_observed")
    if current is not None:
        if not isinstance(current, dict):
            errors.append("operating_context.price_context.current_observed 必须是 object 或 null。")
        else:
            amount = current.get("amount")
            if not is_number(amount) or amount < 0:
                errors.append("operating_context.price_context.current_observed.amount 必须是非负数字。")
            validate_currency(
                current.get("currency"),
                "operating_context.price_context.current_observed.currency",
                marketplace,
                errors,
            )
            validate_iso_datetime(
                current.get("observed_at"),
                "operating_context.price_context.current_observed.observed_at",
                errors,
                required=True,
            )
            validate_string_list(
                current.get("evidence_ids"),
                "operating_context.price_context.current_observed.evidence_ids",
                errors,
                required=True,
            )
            validate_enum(
                current.get("verification_status"),
                {"OBSERVED"},
                "operating_context.price_context.current_observed.verification_status",
                errors,
            )

    planned_phases = price_context.get("planned_phases", [])
    if planned_phases is None:
        planned_phases = []
    if not isinstance(planned_phases, list):
        errors.append("operating_context.price_context.planned_phases 必须是 object array。")
        planned_phases = []
    seen_phase_ids: set[str] = set()
    for index, phase in enumerate(planned_phases, start=1):
        label = f"operating_context.price_context.planned_phases[{index}]"
        if not isinstance(phase, dict):
            errors.append(f"{label} 必须是 object。")
            continue
        phase_id = phase.get("phase_id")
        if not isinstance(phase_id, str) or not phase_id.strip():
            errors.append(f"{label}.phase_id 必填。")
        elif phase_id.strip() in seen_phase_ids:
            errors.append(f"{label}.phase_id 重复：{phase_id.strip()}。")
        else:
            seen_phase_ids.add(phase_id.strip())
        intended_price = phase.get("intended_price")
        if not isinstance(intended_price, dict):
            errors.append(f"{label}.intended_price 必须是 object。")
        else:
            amount = intended_price.get("amount")
            if not is_number(amount) or amount < 0:
                errors.append(f"{label}.intended_price.amount 必须是非负数字。")
            validate_currency(
                intended_price.get("currency"),
                f"{label}.intended_price.currency",
                marketplace,
                errors,
            )
        trigger = phase.get("trigger")
        if not isinstance(trigger, dict):
            errors.append(f"{label}.trigger 必须是 object。")
        else:
            validate_enum(
                trigger.get("type"), PRICE_TRIGGER_TYPES,
                f"{label}.trigger.type", errors,
            )
            if trigger.get("value") in (None, ""):
                errors.append(f"{label}.trigger.value 必填；其含义由 trigger.type 决定。")
        validate_enum(
            phase.get("verification_status"),
            {"PLANNED_UNVERIFIED"},
            f"{label}.verification_status",
            errors,
        )
        validate_enum(
            phase.get("source_type"),
            PRICE_PLAN_SOURCE_TYPES,
            f"{label}.source_type",
            errors,
        )
        validate_string_list(
            phase.get("evidence_ids"), f"{label}.evidence_ids", errors,
            required=True,
        )
    if planned_phases and current is None:
        warnings.append("存在计划价格但缺少当前观察价；计划价格不得被当作当前有效价或当前阶段证据。")

    current_stage = value.get("current_stage")
    if current_stage is not None:
        if not isinstance(current_stage, dict):
            errors.append("operating_context.current_stage 必须是 object 或 null。")
        else:
            if not isinstance(current_stage.get("stage_id"), str) or not current_stage.get("stage_id", "").strip():
                errors.append("operating_context.current_stage.stage_id 必填。")
            validate_iso_datetime(
                current_stage.get("observed_at"),
                "operating_context.current_stage.observed_at",
                errors,
                required=True,
            )
            validate_string_list(
                current_stage.get("evidence_ids"),
                "operating_context.current_stage.evidence_ids",
                errors,
                required=True,
            )
            if "planned_phase_id" in current_stage:
                errors.append("operating_context.current_stage 不得用 planned_phase_id 充当当前阶段证据。")

    seasonality = value.get("seasonality_context")
    if seasonality is not None:
        if not isinstance(seasonality, dict):
            errors.append("operating_context.seasonality_context 必须是 object 或 null。")
        else:
            classification = validate_enum(
                seasonality.get("classification", "UNKNOWN"),
                SEASONALITY_CLASSIFICATIONS,
                "operating_context.seasonality_context.classification",
                errors,
            )
            current_phase = validate_enum(
                seasonality.get("current_phase", "UNKNOWN"),
                SEASONAL_PHASES,
                "operating_context.seasonality_context.current_phase",
                errors,
            )
            validate_enum(
                seasonality.get("confidence", "UNKNOWN"),
                SEASONAL_CONFIDENCE,
                "operating_context.seasonality_context.confidence",
                errors,
            )
            granularity = validate_enum(
                seasonality.get("source_granularity", "UNKNOWN"),
                SEASONAL_GRANULARITIES,
                "operating_context.seasonality_context.source_granularity",
                errors,
            )
            seasonal_evidence = validate_string_list(
                seasonality.get("evidence_ids", []),
                "operating_context.seasonality_context.evidence_ids",
                errors,
            )
            if classification != "UNKNOWN" or current_phase != "UNKNOWN":
                if not seasonal_evidence:
                    errors.append("非 UNKNOWN 的季节结论必须有 evidence_ids。")
                if not isinstance(seasonality.get("source_period"), str) or not seasonality.get("source_period", "").strip():
                    errors.append("非 UNKNOWN 的季节结论必须有 source_period。")
                if granularity == "UNKNOWN":
                    errors.append("非 UNKNOWN 的季节结论必须有非 UNKNOWN 的 source_granularity。")
            validate_iso_date(
                seasonality.get("refresh_due_at"),
                "operating_context.seasonality_context.refresh_due_at",
                errors,
            )

    control = value.get("content_change_control")
    if control is not None:
        if not isinstance(control, dict):
            errors.append("operating_context.content_change_control 必须是 object 或 null。")
        else:
            for field in ("decision_id",):
                if not isinstance(control.get(field), str) or not control.get(field, "").strip():
                    errors.append(f"operating_context.content_change_control.{field} 必填。")
            validate_iso_datetime(
                control.get("decided_at"),
                "operating_context.content_change_control.decided_at",
                errors,
                required=True,
            )
            copy_state = validate_enum(
                control.get("copy_state", "UNKNOWN"), CONTENT_CHANGE_STATES,
                "operating_context.content_change_control.copy_state", errors,
            )
            asset_state = validate_enum(
                control.get("asset_state", "UNKNOWN"), CONTENT_CHANGE_STATES,
                "operating_context.content_change_control.asset_state", errors,
            )
            scopes = validate_string_list(
                control.get("locked_scopes", []),
                "operating_context.content_change_control.locked_scopes",
                errors,
                allowed=CONTENT_SCOPES,
            )
            validate_string_list(
                control.get("reopen_conditions", []),
                "operating_context.content_change_control.reopen_conditions",
                errors,
            )
            if (copy_state in {"LOCKED", "PARTIAL"} or asset_state in {"LOCKED", "PARTIAL"}) and not scopes:
                errors.append("LOCKED/PARTIAL 的内容控制必须列出 locked_scopes。")

    risks = value.get("acknowledged_risks", [])
    if risks is None:
        risks = []
    if not isinstance(risks, list):
        errors.append("operating_context.acknowledged_risks 必须是 object array。")
        risks = []
    seen_risk_ids: set[str] = set()
    for index, risk in enumerate(risks, start=1):
        label = f"operating_context.acknowledged_risks[{index}]"
        if not isinstance(risk, dict):
            errors.append(f"{label} 必须是 object。")
            continue
        risk_id = risk.get("risk_id")
        if not isinstance(risk_id, str) or not risk_id.strip():
            errors.append(f"{label}.risk_id 必填。")
        elif risk_id.strip() in seen_risk_ids:
            errors.append(f"{label}.risk_id 重复：{risk_id.strip()}。")
        else:
            seen_risk_ids.add(risk_id.strip())
        validate_enum(risk.get("decision"), RISK_ACK_DECISIONS, f"{label}.decision", errors)
        for field in ("scope", "review_trigger"):
            if not isinstance(risk.get(field), str) or not risk.get(field, "").strip():
                errors.append(f"{label}.{field} 必填。")
        if risk.get("does_not_change_evidence_or_publication_status") is not True:
            errors.append(f"{label}.does_not_change_evidence_or_publication_status 必须为 true。")
        forbidden = sorted(RISK_OVERRIDE_KEYS.intersection(risk))
        if forbidden:
            errors.append(f"{label} 不得包含证据/发布覆盖字段：{', '.join(forbidden)}。")

    return value


def validate_legacy_claim_list(
    product: dict[str, Any],
    key: str,
    errors: list[str],
    warnings: list[str],
) -> None:
    if key not in product:
        return
    value = product.get(key)
    if not isinstance(value, list):
        errors.append(f"product.{key} 必须是 object array。")
        return
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            errors.append(f"product.{key}[{index}] 必须是 object。")
    warnings.append(
        f"product.{key} 是兼容旧字段；正式结构请把主张写入 facts 并使用独立门禁。"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="校验亚马逊关键词词库输入结构、主张门禁和运行能力。"
    )
    parser.add_argument("input", help="JSON 文件路径；使用 - 从标准输入读取。")
    args = parser.parse_args()

    errors: list[str] = []
    high_warnings: list[str] = []
    warnings: list[str] = []
    restricted_claims: list[str] = []

    try:
        data = load_json(args.input)
    except (OSError, json.JSONDecodeError) as exc:
        result = {
            "structurally_valid": False,
            "capabilities": {
                "runnable_for_acquisition": False,
                "runnable_for_keyword_classification": False,
                "released_roles_available": False,
                "released_roles_partially_restricted": False,
            },
            "errors": [f"无法读取有效 JSON：{exc}"],
            "high_priority_warnings": [],
            "warnings": [],
            "missing_for_capabilities": {},
            "normalized_summary": {},
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2

    if not isinstance(data, dict):
        result = {
            "structurally_valid": False,
            "capabilities": {
                "runnable_for_acquisition": False,
                "runnable_for_keyword_classification": False,
                "released_roles_available": False,
                "released_roles_partially_restricted": False,
            },
            "errors": ["顶层必须是 JSON object。"],
            "high_priority_warnings": [],
            "warnings": [],
            "missing_for_capabilities": {},
            "normalized_summary": {},
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2

    mode = data.get("mode", "FULL_BUILD")
    validate_enum(mode, MODES, "mode", errors)

    workflow_ids: dict[str, str | None] = {}
    for field in (
        "project_id",
        "selection_run_id",
        "candidate_id",
        "competitor_lock_run_id",
        "keyword_run_id",
    ):
        value = data.get(field)
        if value is None:
            workflow_ids[field] = None
        elif not isinstance(value, str) or not value.strip():
            errors.append(f"{field} 必须是非空字符串或 null。")
            workflow_ids[field] = None
        else:
            workflow_ids[field] = value.strip()
    # 选品阶段已冻结：project_id / selection_run_id / candidate_id 缺省是正常情况，不再提示。

    marketplace_raw = data.get("marketplace")
    marketplace = (
        marketplace_raw.strip().upper()
        if isinstance(marketplace_raw, str)
        else ""
    )
    if not marketplace:
        errors.append("marketplace 必填。")
    marketplace_static_supported = marketplace in STATIC_MARKETPLACES
    if marketplace and not marketplace_static_supported:
        warnings.append(
            f"marketplace={marketplace} 不在校验器静态列表；运行时必须按当前工具 schema 复核，不能仅凭静态列表拒绝。"
        )

    operating_context = validate_operating_context(
        data.get("operating_context"), marketplace, errors, warnings
    )
    try:
        computed_operating_context_hash = (
            operating_context_sha256(operating_context) if operating_context else None
        )
    except (TypeError, ValueError, OverflowError):
        errors.append("operating_context 含非有限数字或不可序列化值，不能计算可信哈希。")
        computed_operating_context_hash = None
    supplied_operating_context_hash = data.get("operating_context_sha256")
    if operating_context:
        if supplied_operating_context_hash is None:
            warnings.append(
                "旧交接缺少 operating_context_sha256；本次已按 canonical JSON 补算，新输出必须携带。"
            )
        elif supplied_operating_context_hash != computed_operating_context_hash:
            errors.append(
                "operating_context_sha256 与 operating_context canonical 内容不一致。"
            )
    elif supplied_operating_context_hash is not None:
        errors.append("没有 operating_context 时不得单独提供 operating_context_sha256。")

    product_raw = data.get("product", {})
    if product_raw is None:
        product_raw = {}
    if not isinstance(product_raw, dict):
        errors.append("product 必须是 object 或 null。")
        product: dict[str, Any] = {}
    else:
        product = product_raw

    product_name = product.get("name")
    category = product.get("category")
    product_asin = normalize_asin(product.get("asin"))
    if product.get("asin") is not None and not ASIN_PATTERN.fullmatch(product_asin):
        errors.append(f"product.asin 无效：{product.get('asin')!r}。")
        product_asin = ""
    asin_role = product.get("asin_role")
    if product_asin:
        asin_role = validate_enum(
            asin_role or "UNKNOWN_ROLE",
            ASIN_ROLES,
            "product.asin_role",
            errors,
        )
    elif asin_role is not None:
        validate_enum(asin_role, ASIN_ROLES, "product.asin_role", errors)

    documents_raw = product.get("compliance_documents", [])
    if documents_raw is None:
        documents_raw = []
    if not isinstance(documents_raw, list):
        errors.append("product.compliance_documents 必须是 object array。")
        documents_raw = []

    documents: dict[str, dict[str, Any]] = {}
    invalid_release_document_ids: set[str] = set()
    mark_authorization_document_ids: set[str] = set()
    for index, document in enumerate(documents_raw, start=1):
        label = f"product.compliance_documents[{index}]"
        if not isinstance(document, dict):
            errors.append(f"{label} 必须是 object。")
            continue
        document_id = document.get("document_id")
        if not isinstance(document_id, str) or not document_id.strip():
            errors.append(f"{label}.document_id 必填。")
            continue
        document_id = document_id.strip()
        if document_id in documents:
            errors.append(f"合规 document_id 重复：{document_id}。")
            continue
        doc_type = validate_enum(
            document.get("document_type"), DOCUMENT_TYPES,
            f"{label}.document_type", errors,
        )
        coverage = validate_enum(
            document.get("coverage_level"), COVERAGE_LEVELS,
            f"{label}.coverage_level", errors,
        )
        valid_status = validate_enum(
            document.get("valid_status"), DOCUMENT_VALID_STATUSES,
            f"{label}.valid_status", errors,
        )
        review_status = validate_enum(
            document.get("review_status"), DOCUMENT_REVIEW_STATUSES,
            f"{label}.review_status", errors,
        )
        issue_date_raw = document.get("issue_date")
        if issue_date_raw is None and document.get("date") is not None:
            issue_date_raw = document.get("date")
            warnings.append(f"{label}.date 是兼容旧字段；请改用 issue_date。")
        issue_date = validate_iso_date(
            issue_date_raw,
            f"{label}.issue_date",
            errors,
            required=doc_type != "PENDING_NOTICE",
        )
        expected_receipt_date = validate_iso_date(
            document.get("expected_receipt_date"),
            f"{label}.expected_receipt_date",
            errors,
        )
        received_at = validate_iso_date(
            document.get("received_at"), f"{label}.received_at", errors
        )
        reviewed_at = validate_iso_date(
            document.get("reviewed_at"), f"{label}.reviewed_at", errors
        )
        expiry_date = validate_iso_date(
            document.get("expiry_date"), f"{label}.expiry_date", errors
        )
        documents[document_id] = document
        approved_text = document.get("approved_claim_text")
        approved_text = approved_text if isinstance(approved_text, str) else ""
        if doc_type == "MSDS_SDS" and MSDS_FORBIDDEN_WORDS.search(approved_text):
            high_warnings.append(
                f"{label} 是 MSDS/SDS，却批准了 passed/certified/approved/safe 类措辞；必须冻结。"
            )
            invalid_release_document_ids.add(document_id)
        if doc_type == "TEST_REPORT" and CERTIFICATION_WORDS.search(approved_text):
            high_warnings.append(
                f"{label} 是测试报告，却批准了 certified/listed/approved；必须改为精确 tested-to 范围。"
            )
            invalid_release_document_ids.add(document_id)
        if doc_type == "SDOC_DOC" and CERTIFICATION_WORDS.search(approved_text):
            high_warnings.append(
                f"{label} 是 SDoC，却批准了 certified/listed/approved；最多只能按闭环范围写 complies with。"
            )
            invalid_release_document_ids.add(document_id)
        if doc_type in {"PENDING_NOTICE", "OWN_LISTING", "COMPETITOR_COPY"} and approved_text:
            high_warnings.append(
                f"{label} 的文档类型不能批准公开合规措辞。"
            )
            invalid_release_document_ids.add(document_id)
        if doc_type in {"PENDING_NOTICE", "OWN_LISTING", "COMPETITOR_COPY"}:
            invalid_release_document_ids.add(document_id)
        if doc_type == "MARK_AUTHORIZATION":
            mark_authorization_document_ids.add(document_id)
            required_mark_fields = (
                "path_or_source", "model", "issuer", "authorization_number",
                "authorized_mark", "authorization_scope",
            )
            missing_mark_fields = [
                key for key in required_mark_fields if not document.get(key)
            ]
            if missing_mark_fields:
                high_warnings.append(
                    f"{label} 是标志授权文件，但缺字段：{', '.join(missing_mark_fields)}。"
                )
                invalid_release_document_ids.add(document_id)
        if coverage and coverage != "whole_unit" and re.search(
            r"whole[- ]?unit|整机", approved_text, re.IGNORECASE
        ):
            high_warnings.append(
                f"{label} 覆盖层级为 {coverage}，却批准整机措辞。"
            )
            invalid_release_document_ids.add(document_id)
        if valid_status and valid_status not in RELEASE_VALID_STATUSES:
            high_warnings.append(
                f"{label}.valid_status={valid_status}，不能用于当前正式释放。"
            )
            invalid_release_document_ids.add(document_id)
        if review_status != "APPROVED":
            high_warnings.append(
                f"{label}.review_status={review_status}，未完成批准审查，不能正式释放。"
            )
            invalid_release_document_ids.add(document_id)
        if doc_type != "PENDING_NOTICE" and (received_at is None or reviewed_at is None):
            high_warnings.append(
                f"{label} 缺 received_at 或 reviewed_at，不能证明文件已收件并审查。"
            )
            invalid_release_document_ids.add(document_id)
        today = dt.date.today()
        if issue_date and issue_date > today:
            high_warnings.append(
                f"{label}.issue_date={issue_date.isoformat()} 在未来，不能提前释放。"
            )
            invalid_release_document_ids.add(document_id)
        if received_at and received_at > today:
            high_warnings.append(f"{label}.received_at 在未来，不能正式释放。")
            invalid_release_document_ids.add(document_id)
        if reviewed_at and reviewed_at > today:
            high_warnings.append(f"{label}.reviewed_at 在未来，不能正式释放。")
            invalid_release_document_ids.add(document_id)
        if received_at and reviewed_at and reviewed_at < received_at:
            errors.append(f"{label}.reviewed_at 不能早于 received_at。")
        if expected_receipt_date and received_at and expected_receipt_date > received_at:
            warnings.append(
                f"{label}.expected_receipt_date 晚于实际 received_at；预计日期仅作排期。"
            )
        if expiry_date and expiry_date < dt.date.today():
            high_warnings.append(f"{label} 已于 {expiry_date.isoformat()} 到期。")
            invalid_release_document_ids.add(document_id)
        if issue_date and expiry_date and issue_date > expiry_date:
            errors.append(f"{label}.issue_date 不能晚于 expiry_date。")

    validate_legacy_claim_list(product, "blocked_claims", errors, warnings)
    validate_legacy_claim_list(product, "pending_claims", errors, warnings)

    facts_raw = product.get("facts", [])
    if facts_raw is None:
        facts_raw = []
    if not isinstance(facts_raw, list):
        errors.append("product.facts 必须是 object array。")
        facts_raw = []

    usable_fact_count = 0
    valid_publication_ready_fact_count = 0
    for index, fact in enumerate(facts_raw, start=1):
        label = f"product.facts[{index}]"
        if not isinstance(fact, dict):
            errors.append(f"{label} 必须是 object。")
            continue
        restrictions_before = len(restricted_claims)
        fact_name_raw = fact.get("name")
        if not isinstance(fact_name_raw, str) or not fact_name_raw.strip():
            errors.append(f"{label}.name 必填。")
            fact_name = f"fact_{index}"
        else:
            fact_name = fact_name_raw.strip()
        if "value" not in fact:
            errors.append(f"{label}.value 必须存在，可为 null。")
        evidence_type = validate_enum(
            fact.get("evidence_type"), EVIDENCE_TYPES,
            f"{label}.evidence_type", errors,
        )
        risk_class = validate_enum(
            fact.get("risk_class"), RISK_CLASSES,
            f"{label}.risk_class", errors,
        )
        research_status = validate_enum(
            fact.get("research_status"), RESEARCH_STATUSES,
            f"{label}.research_status", errors,
        )
        publication_status = validate_enum(
            fact.get("publication_status"), PUBLICATION_STATUSES,
            f"{label}.publication_status", errors,
        )
        claim_scope = validate_enum(
            fact.get("claim_scope"), COVERAGE_LEVELS,
            f"{label}.claim_scope", errors, required=False,
        )
        claim_text_raw = fact.get("claim_text")
        claim_text = (
            claim_text_raw.strip()
            if isinstance(claim_text_raw, str) and claim_text_raw.strip()
            else None
        )
        claim_model_raw = fact.get("claim_model")
        claim_model = (
            claim_model_raw.strip()
            if isinstance(claim_model_raw, str) and claim_model_raw.strip()
            else None
        )
        source = fact.get("source")
        if not isinstance(source, str) or not source.strip():
            warnings.append(f"{label} 缺少 source，追溯性不足。")
            source_text = ""
        else:
            source_text = source.strip()

        if research_status == "RESEARCH_USABLE":
            usable_fact_count += 1
        text_to_check = f"{fact_name} {fact.get('value', '')} {claim_text or ''}"
        detected_high_risk = bool(HIGH_RISK_TEXT.search(text_to_check))
        detected_compliance_or_medical = bool(
            COMPLIANCE_OR_MEDICAL_TEXT.search(text_to_check)
        )
        detected_quantified = bool(QUANTIFIED_CLAIM_TEXT.search(text_to_check))
        is_high_risk = risk_class in {
            "QUANTIFIED_PERFORMANCE",
            "CERTIFICATION_SAFETY",
            "MEDICAL_ENVIRONMENTAL_CHILDREN",
            "BRAND_IP",
        } or detected_high_risk or detected_quantified

        released = publication_status in {
            "COPY_RELEASED", "FORMAL_CLAIM_RELEASED"
        }
        if (
            detected_compliance_or_medical
            and risk_class not in {
                "CERTIFICATION_SAFETY", "MEDICAL_ENVIRONMENTAL_CHILDREN"
            }
        ):
            high_warnings.append(
                f"{label}（{fact_name}）含认证/安全/医疗语义，但 risk_class={risk_class}；已冻结，不能靠误分类绕过。"
            )
            restricted_claims.append(fact_name)
        if detected_quantified and risk_class != "QUANTIFIED_PERFORMANCE":
            high_warnings.append(
                f"{label}（{fact_name}）含精确量化性能，但 risk_class={risk_class}；已冻结，需按 QUANTIFIED_PERFORMANCE 审查。"
            )
            restricted_claims.append(fact_name)
        if publication_status in {
            "HOLD_FEATURE", "CONTRADICTED", "NOT_SUPPORTED"
        }:
            restricted_claims.append(fact_name)
        if is_high_risk and publication_status == "NOT_APPLICABLE":
            high_warnings.append(
                f"{label}（{fact_name}）是实际高风险/量化事实，不能用 NOT_APPLICABLE 绕过门禁。"
            )
            restricted_claims.append(fact_name)
        if is_high_risk and publication_status == "COPY_RELEASED":
            high_warnings.append(
                f"{label}（{fact_name}）是高风险/量化主张，不能仅用 COPY_RELEASED；对应词必须保持 HOLD_CLAIM。"
            )
            restricted_claims.append(fact_name)

        if is_high_risk and released and ORAL_OR_COPY_SOURCE.search(source_text):
            high_warnings.append(
                f"{label}（{fact_name}）的释放依据是用户/工厂口头或 Listing/竞品文案；对应词必须保持 HOLD_CLAIM。"
            )
            restricted_claims.append(fact_name)

        document_id = fact.get("document_id")
        document = documents.get(document_id) if isinstance(document_id, str) else None
        if is_high_risk and publication_status == "FORMAL_CLAIM_RELEASED":
            if claim_scope is None:
                high_warnings.append(
                    f"{label}（{fact_name}）正式高风险主张缺 claim_scope，不能核对整机/部件范围。"
                )
                restricted_claims.append(fact_name)
            if claim_text is None or claim_model is None:
                high_warnings.append(
                    f"{label}（{fact_name}）正式高风险主张必须同时指定完整 claim_text 与 claim_model。"
                )
                restricted_claims.append(fact_name)
        if publication_status == "FORMAL_CLAIM_RELEASED" and (
            evidence_type == "OBSERVED_COMPLIANCE_DOC" or document_id is not None
        ):
            if document is None:
                high_warnings.append(
                    f"{label}（{fact_name}）声明使用合规文件，但 document_id 无有效匹配。"
                )
                restricted_claims.append(fact_name)
            else:
                if document_id in invalid_release_document_ids:
                    high_warnings.append(
                        f"{label}（{fact_name}）引用的文件已被判定为无效、过期、未审查、范围或措辞不合格。"
                    )
                    restricted_claims.append(fact_name)
                doc_type_generic = document.get("document_type")
                if doc_type_generic == "MARK_AUTHORIZATION":
                    high_warnings.append(
                        f"{label}（{fact_name}）不能把 MARK_AUTHORIZATION 当作唯一实质证据。"
                    )
                    restricted_claims.append(fact_name)
                if (
                    (risk_class == "QUANTIFIED_PERFORMANCE" or detected_quantified)
                    and doc_type_generic != "TEST_REPORT"
                ):
                    high_warnings.append(
                        f"{label}（{fact_name}）量化性能引用 {doc_type_generic}，不能替代 TEST_REPORT 或完整受控实测记录。"
                    )
                    restricted_claims.append(fact_name)
                approved_generic = document.get("approved_claim_text")
                approved_generic = (
                    approved_generic if isinstance(approved_generic, str) else ""
                )
                if (
                    claim_text
                    and approved_generic
                    and " ".join(claim_text.lower().split())
                    != " ".join(approved_generic.lower().split())
                ):
                    high_warnings.append(
                        f"{label}（{fact_name}）claim_text 与关联文件批准措辞不一致。"
                    )
                    restricted_claims.append(fact_name)
                doc_scope_generic = document.get("coverage_level")
                if claim_scope and doc_scope_generic and claim_scope != doc_scope_generic:
                    high_warnings.append(
                        f"{label}（{fact_name}）claim_scope={claim_scope} 与文件 coverage_level={doc_scope_generic} 不一致。"
                    )
                    restricted_claims.append(fact_name)
                models_generic_raw = document.get("model")
                if isinstance(models_generic_raw, str):
                    models_generic = {
                        item.strip().upper()
                        for item in re.split(r"[,;/]", models_generic_raw)
                        if item.strip()
                    }
                elif isinstance(models_generic_raw, list):
                    models_generic = {
                        str(item).strip().upper()
                        for item in models_generic_raw if str(item).strip()
                    }
                else:
                    models_generic = set()
                if claim_model and claim_model.upper() not in models_generic:
                    high_warnings.append(
                        f"{label}（{fact_name}）claim_model={claim_model} 不在关联文件型号范围内。"
                    )
                    restricted_claims.append(fact_name)
            if claim_text is None:
                high_warnings.append(
                    f"{label}（{fact_name}）正式高风险主张缺 claim_text。"
                )
                restricted_claims.append(fact_name)
            if claim_model is None:
                high_warnings.append(
                    f"{label}（{fact_name}）正式高风险主张缺 claim_model。"
                )
                restricted_claims.append(fact_name)
        if risk_class in {
            "CERTIFICATION_SAFETY",
            "MEDICAL_ENVIRONMENTAL_CHILDREN",
            "BRAND_IP",
        } and publication_status == "FORMAL_CLAIM_RELEASED":
            if evidence_type != "OBSERVED_COMPLIANCE_DOC" or document is None:
                high_warnings.append(
                    f"{label}（{fact_name}）标为 FORMAL_CLAIM_RELEASED，但未关联有效合规文件。"
                )
                restricted_claims.append(fact_name)
            else:
                required_doc_fields = {
                    "document_type": document.get("document_type"),
                    "path_or_source": document.get("path_or_source"),
                    "coverage_level": document.get("coverage_level"),
                    "model": document.get("model"),
                    "issuer": document.get("issuer"),
                    "standard_or_number": document.get("standard_or_number"),
                    "issue_date": document.get("issue_date") or document.get("date"),
                    "received_at": document.get("received_at"),
                    "reviewed_at": document.get("reviewed_at"),
                    "review_status": document.get("review_status"),
                    "valid_status": document.get("valid_status"),
                    "approved_claim_text": document.get("approved_claim_text"),
                }
                missing_doc = [
                    key for key, value in required_doc_fields.items()
                    if value is None or (isinstance(value, str) and not value.strip())
                ]
                if missing_doc:
                    high_warnings.append(
                        f"{label}（{fact_name}）的正式释放文件缺字段：{', '.join(missing_doc)}。"
                    )
                    restricted_claims.append(fact_name)
                if document.get("document_type") in {
                    "PENDING_NOTICE", "OWN_LISTING", "COMPETITOR_COPY"
                }:
                    high_warnings.append(
                        f"{label}（{fact_name}）关联的文档类型不能支持正式释放。"
                    )
                    restricted_claims.append(fact_name)
                if document_id in invalid_release_document_ids:
                    high_warnings.append(
                        f"{label}（{fact_name}）关联文件存在文档类型、措辞、有效状态或范围问题。"
                    )
                    restricted_claims.append(fact_name)
                doc_type = document.get("document_type")
                if doc_type == "MARK_AUTHORIZATION":
                    high_warnings.append(
                        f"{label}（{fact_name}）不能仅凭 MARK_AUTHORIZATION 释放认证/合规主张；还需实质合规文件。"
                    )
                    restricted_claims.append(fact_name)
                if doc_type in {"TEST_REPORT", "SDOC_DOC"} and CERTIFICATION_WORDS.search(text_to_check):
                    high_warnings.append(
                        f"{label}（{fact_name}）的 certified/listed/approved 措辞超出 {doc_type} 能支持的范围。"
                    )
                    restricted_claims.append(fact_name)
                if doc_type == "MSDS_SDS" and MSDS_FORBIDDEN_WORDS.search(text_to_check):
                    high_warnings.append(
                        f"{label}（{fact_name}）不能用 MSDS/SDS 支持 passed/certified/approved/safe。"
                    )
                    restricted_claims.append(fact_name)
                doc_scope = document.get("coverage_level")
                if claim_scope and doc_scope and claim_scope != doc_scope:
                    high_warnings.append(
                        f"{label}（{fact_name}）主张范围 {claim_scope} 与文件覆盖 {doc_scope} 不一致。"
                    )
                    restricted_claims.append(fact_name)
                approved_doc_text = document.get("approved_claim_text")
                approved_doc_text = (
                    approved_doc_text if isinstance(approved_doc_text, str) else ""
                )
                if (
                    claim_text
                    and approved_doc_text
                    and " ".join(claim_text.lower().split())
                    != " ".join(approved_doc_text.lower().split())
                ):
                    high_warnings.append(
                        f"{label}（{fact_name}）claim_text 与文件 approved_claim_text 不一致。"
                    )
                    restricted_claims.append(fact_name)
                document_models_raw = document.get("model")
                if isinstance(document_models_raw, str):
                    document_models = {
                        item.strip().upper()
                        for item in re.split(r"[,;/]", document_models_raw)
                        if item.strip()
                    }
                elif isinstance(document_models_raw, list):
                    document_models = {
                        str(item).strip().upper()
                        for item in document_models_raw if str(item).strip()
                    }
                else:
                    document_models = set()
                if claim_model and claim_model.upper() not in document_models:
                    high_warnings.append(
                        f"{label}（{fact_name}）claim_model={claim_model} 不在文件型号范围内。"
                    )
                    restricted_claims.append(fact_name)
                if (
                    MARK_WORDS.search(f"{text_to_check} {approved_doc_text}")
                    or fact.get("requested_mark") is not None
                ):
                    mark_doc_id = fact.get("mark_authorization_document_id")
                    if (
                        not isinstance(mark_doc_id, str)
                        or mark_doc_id not in mark_authorization_document_ids
                        or mark_doc_id in invalid_release_document_ids
                    ):
                        high_warnings.append(
                            f"{label}（{fact_name}）涉及徽标/标志，但缺有效 MARK_AUTHORIZATION 关联。"
                        )
                        restricted_claims.append(fact_name)
                    else:
                        requested_mark = fact.get("requested_mark")
                        mark_document = documents.get(mark_doc_id, {})
                        authorized_mark = mark_document.get("authorized_mark")
                        if (
                            not isinstance(requested_mark, str)
                            or not requested_mark.strip()
                            or not isinstance(authorized_mark, str)
                            or requested_mark.strip().lower()
                            != authorized_mark.strip().lower()
                        ):
                            high_warnings.append(
                                f"{label}（{fact_name}）requested_mark 与授权文件不一致。"
                            )
                            restricted_claims.append(fact_name)
                        mark_scope = mark_document.get("coverage_level")
                        authorization_scope = mark_document.get("authorization_scope")
                        if claim_scope and mark_scope != claim_scope:
                            high_warnings.append(
                                f"{label}（{fact_name}）标志授权覆盖 {mark_scope}，与主张范围 {claim_scope} 不一致。"
                            )
                            restricted_claims.append(fact_name)
                        if (
                            claim_scope
                            and isinstance(authorization_scope, str)
                            and claim_scope.lower() not in authorization_scope.lower()
                        ):
                            high_warnings.append(
                                f"{label}（{fact_name}）authorization_scope 未覆盖 {claim_scope}。"
                            )
                            restricted_claims.append(fact_name)
                        mark_models_raw = mark_document.get("model")
                        if isinstance(mark_models_raw, str):
                            mark_models = {
                                item.strip().upper()
                                for item in re.split(r"[,;/]", mark_models_raw)
                                if item.strip()
                            }
                        elif isinstance(mark_models_raw, list):
                            mark_models = {
                                str(item).strip().upper()
                                for item in mark_models_raw if str(item).strip()
                            }
                        else:
                            mark_models = set()
                        if claim_model and claim_model.upper() not in mark_models:
                            high_warnings.append(
                                f"{label}（{fact_name}）标志授权未覆盖 claim_model={claim_model}。"
                            )
                            restricted_claims.append(fact_name)

        if (risk_class == "QUANTIFIED_PERFORMANCE" or detected_quantified) and released:
            required_test_fields = (
                "production_model",
                "production_bom_revision",
                "firmware_revision",
                "test_method",
                "measurement_start_definition",
                "measurement_end_definition",
                "environment",
                "heat_level",
                "measurement_error",
                "report_date",
                "approved_at",
                "approved_by",
            )
            missing_test = [key for key in required_test_fields if not fact.get(key)]
            sample_size = fact.get("sample_size")
            if (
                not is_number(sample_size)
                or int(sample_size) != sample_size
                or sample_size <= 0
            ):
                missing_test.append("sample_size(正整数)")
            value_type = fact.get("value_type")
            if value_type not in QUANTIFIED_VALUE_TYPES:
                missing_test.append("value_type(TYPICAL/MAXIMUM/GUARANTEED)")
            report_date = validate_iso_date(
                fact.get("report_date"), f"{label}.report_date", errors
            )
            approved_at = validate_iso_date(
                fact.get("approved_at"), f"{label}.approved_at", errors
            )
            today = dt.date.today()
            if report_date and report_date > today:
                missing_test.append("report_date不得在未来")
            if approved_at and approved_at > today:
                missing_test.append("approved_at不得在未来")
            if report_date and approved_at and approved_at < report_date:
                errors.append(f"{label}.approved_at 不能早于 report_date。")
            production_model = fact.get("production_model")
            if (
                claim_model
                and isinstance(production_model, str)
                and production_model.strip().upper() != claim_model.upper()
            ):
                missing_test.append("production_model 与 claim_model 必须一致")
            if missing_test:
                high_warnings.append(
                    f"{label}（{fact_name}）量化性能释放缺失或无效：{', '.join(dict.fromkeys(missing_test))}。"
                )
                restricted_claims.append(fact_name)

        if publication_status == "FORMAL_CLAIM_RELEASED" and evidence_type in {
            "USER_CONFIRMED", "OBSERVED_AMAZON_COPY", "INFERRED", "UNKNOWN"
        }:
            high_warnings.append(
                f"{label}（{fact_name}）的 evidence_type={evidence_type} 不能单独支持正式释放。"
            )
            restricted_claims.append(fact_name)
        if (
            len(restricted_claims) == restrictions_before
            and publication_status in {"COPY_RELEASED", "FORMAL_CLAIM_RELEASED"}
        ):
            valid_publication_ready_fact_count += 1

    source_files_raw = data.get("source_files", [])
    if source_files_raw is None:
        source_files_raw = []
    if not isinstance(source_files_raw, list) or any(
        not isinstance(item, str) for item in source_files_raw
    ):
        errors.append("source_files 必须是字符串 array。")
        source_files_raw = []
    source_files = [item.strip() for item in source_files_raw if item.strip()]
    if len(source_files) < len(source_files_raw):
        warnings.append("source_files 中的空路径已忽略，不算有效事实来源。")
    accessible_source_files: list[str] = []
    for path in source_files:
        if not os.path.isabs(path):
            warnings.append(f"source_files 应由系统解析为绝对路径：{path}")
        if os.path.exists(path):
            accessible_source_files.append(path)
        else:
            warnings.append(f"source_files 当前不存在或不可访问：{path}")

    target_price_raw = data.get("target_price")
    price_min = price_max = currency = None
    if target_price_raw is None:
        warnings.append("缺少 target_price，价格竞争背景将标为暂定。")
    elif not isinstance(target_price_raw, dict):
        errors.append("target_price 必须是 object 或 null。")
    else:
        price_min = validate_nonnegative(
            target_price_raw, "min", "target_price.min", errors
        )
        price_max = validate_nonnegative(
            target_price_raw, "max", "target_price.max", errors
        )
        currency = target_price_raw.get("currency")
        if is_number(price_min) and is_number(price_max) and price_min > price_max:
            errors.append("target_price.min 不能大于 target_price.max。")
        if currency is not None and (
            not isinstance(currency, str) or len(currency.strip()) != 3
        ):
            errors.append("target_price.currency 应为 3 位币种代码。")

    review_raw = data.get("review_stage")
    review_current = review_min = review_max = decision_basis = None
    if review_raw is None:
        warnings.append("缺少 review_stage，评论阶段背景将标为暂定。")
    elif not isinstance(review_raw, dict):
        errors.append("review_stage 必须是 object 或 null。")
    else:
        review_current = validate_nonnegative(
            review_raw, "current", "review_stage.current", errors, integer=True
        )
        review_min = validate_nonnegative(
            review_raw, "target_min", "review_stage.target_min", errors, integer=True
        )
        review_max = validate_nonnegative(
            review_raw, "target_max", "review_stage.target_max", errors, integer=True
        )
        if is_number(review_min) and is_number(review_max) and review_min > review_max:
            errors.append("review_stage.target_min 不能大于 target_max。")
        decision_basis = validate_enum(
            review_raw.get("decision_basis_stage"),
            DECISION_BASES,
            "review_stage.decision_basis_stage",
            errors,
            required=False,
        )
        if decision_basis is None:
            warnings.append(
                "未给 decision_basis_stage；当前评论与目标评论窗口不得混用。"
            )

    competitors_raw = data.get("competitors", [])
    if competitors_raw is None:
        competitors_raw = []
    if not isinstance(competitors_raw, list):
        errors.append("competitors 必须是 array。")
        competitors_raw = []

    competitor_instances: list[dict[str, Any]] = []
    normalized_competitor_asins: list[str] = []
    locked_competitor_count = 0
    legacy_competitor_count = 0
    for index, competitor in enumerate(competitors_raw, start=1):
        label = f"competitors[{index}]"
        if isinstance(competitor, str):
            asin_raw = competitor
            rank = None
            order_basis = "user_provided_order"
            input_instance_id: Any = index
            source_role = "USER_SUPPLIED"
            primary_role = None
            roles: list[str] = []
            lock_status = None
            keyword_scope = "FULL_TRAFFIC"
            lock_run_id = None
            evidence_ids: list[str] = []
            legacy_competitor_count += 1
            warnings.append(f"{label} 建议使用 object；已保留输入顺序。")
        elif isinstance(competitor, dict):
            asin_raw = competitor.get("asin")
            rank = competitor.get("rank")
            order_basis = competitor.get("order_basis") or "user_provided_order"
            input_instance_id = competitor.get("input_instance_id", index)
            if rank is not None and (
                not is_number(rank) or int(rank) != rank or rank <= 0
            ):
                errors.append(f"{label}.rank 必须是正整数。")
            if not isinstance(input_instance_id, (str, int)) or isinstance(input_instance_id, bool):
                errors.append(f"{label}.input_instance_id 必须是字符串或整数。")

            source_role = competitor.get("source_role")
            primary_role = competitor.get("primary_role")
            roles_raw = competitor.get("roles", [])
            lock_status = competitor.get("lock_status")
            keyword_scope = competitor.get("keyword_acquisition_scope")
            lock_run_id = competitor.get("lock_run_id")
            evidence_ids_raw = competitor.get("evidence_ids", [])
            has_lock_fields = any(
                value is not None
                for value in (source_role, primary_role, lock_status, keyword_scope, lock_run_id)
            ) or bool(roles_raw)
            if has_lock_fields:
                locked_competitor_count += 1
                source_role = validate_enum(
                    source_role,
                    COMPETITOR_SOURCE_ROLES,
                    f"{label}.source_role",
                    errors,
                )
                lock_status = validate_enum(
                    lock_status,
                    COMPETITOR_LOCK_STATUSES,
                    f"{label}.lock_status",
                    errors,
                )
                identity_unready = lock_status in {"IDENTITY_PENDING", "EXCLUDED_INVALID"}
                primary_role = validate_enum(
                    primary_role,
                    COMPETITOR_ROLES,
                    f"{label}.primary_role",
                    errors,
                    required=not identity_unready,
                )
                if not isinstance(roles_raw, list):
                    errors.append(f"{label}.roles 必须是角色 array。")
                    roles = []
                else:
                    roles = []
                    for role_index, role in enumerate(roles_raw, start=1):
                        validated_role = validate_enum(
                            role,
                            COMPETITOR_ROLES,
                            f"{label}.roles[{role_index}]",
                            errors,
                        )
                        if validated_role:
                            roles.append(validated_role)
                    if not roles_raw and not identity_unready:
                        errors.append(f"{label}.roles 必须是非空角色 array。")
                if primary_role and primary_role not in roles:
                    errors.append(f"{label}.primary_role 必须同时出现在 roles。")
                keyword_scope = validate_enum(
                    keyword_scope,
                    KEYWORD_ACQUISITION_SCOPES,
                    f"{label}.keyword_acquisition_scope",
                    errors,
                )
                if lock_run_id is not None and (
                    not isinstance(lock_run_id, str) or not lock_run_id.strip()
                ):
                    errors.append(f"{label}.lock_run_id 必须是非空字符串或 null。")
                    lock_run_id = None
                elif isinstance(lock_run_id, str):
                    lock_run_id = lock_run_id.strip()
                if (
                    workflow_ids["competitor_lock_run_id"]
                    and lock_run_id
                    and workflow_ids["competitor_lock_run_id"] != lock_run_id
                ):
                    errors.append(f"{label}.lock_run_id 与顶层 competitor_lock_run_id 不一致。")
                if (
                    source_role == "USER_SUPPLIED"
                    and lock_status not in {"IDENTITY_PENDING", "EXCLUDED_INVALID"}
                    and keyword_scope != "FULL_TRAFFIC"
                ):
                    errors.append(
                        f"{label} 是 USER_SUPPLIED 且身份有效时必须保留 FULL_TRAFFIC；身份无效应另写状态和原因。"
                    )
                if lock_status in {"IDENTITY_PENDING", "EXCLUDED_INVALID"} and keyword_scope != "NO_QUERY":
                    errors.append(f"{label}.{lock_status} 必须使用 NO_QUERY。")
                if lock_status in {
                    "CORE_BENCHMARK",
                    "BOUNDARY_REFERENCE",
                    "DIFFERENTIATION_REFERENCE",
                    "KEYWORD_SOURCE_ONLY",
                } and keyword_scope != "FULL_TRAFFIC":
                    errors.append(f"{label}.{lock_status} 必须使用 FULL_TRAFFIC。")
            else:
                legacy_competitor_count += 1
                source_role = "USER_SUPPLIED"
                roles = []
                keyword_scope = "FULL_TRAFFIC"
            if not isinstance(evidence_ids_raw, list) or any(
                not isinstance(item, str) for item in evidence_ids_raw
            ):
                errors.append(f"{label}.evidence_ids 必须是字符串 array。")
                evidence_ids = []
            else:
                evidence_ids = [item for item in evidence_ids_raw if item]
        else:
            errors.append(f"{label} 必须是 ASIN 字符串或 object。")
            continue
        asin = normalize_asin(asin_raw)
        if not ASIN_PATTERN.fullmatch(asin):
            errors.append(f"{label} 的 ASIN 无效：{asin_raw!r}。")
            continue
        competitor_instances.append({
            "input_instance_id": input_instance_id,
            "asin": asin,
            "rank": rank,
            "order_basis": order_basis,
            "source_role": source_role,
            "primary_role": primary_role,
            "roles": roles,
            "lock_status": lock_status,
            "keyword_acquisition_scope": keyword_scope,
            "lock_run_id": lock_run_id,
            "evidence_ids": evidence_ids,
        })
        normalized_competitor_asins.append(asin)

    unique_competitor_asins = list(dict.fromkeys(normalized_competitor_asins))
    duplicate_asins = sorted({
        asin for asin in normalized_competitor_asins
        if normalized_competitor_asins.count(asin) > 1
    })
    if duplicate_asins:
        warnings.append(
            "重复 ASIN 将保留输入实例、仅查询一次：" + ", ".join(duplicate_asins)
        )
    if competitors_raw and legacy_competitor_count:
        warnings.append(
            f"{legacy_competitor_count} 个竞品没有完整锁定字段；可继续采集，但角色与下游交接为 PROVISIONAL。"
        )

    seeds_raw = data.get("market_seeds", [])
    if seeds_raw is None:
        seeds_raw = []
    if not isinstance(seeds_raw, list):
        errors.append("market_seeds 必须是字符串或 object array。")
        seeds_raw = []
    seeds: list[dict[str, str]] = []
    for index, seed in enumerate(seeds_raw, start=1):
        label = f"market_seeds[{index}]"
        if isinstance(seed, str):
            query = seed.strip()
            purpose = "MARKET_DISCOVERY"
            source = "user_provided"
        elif isinstance(seed, dict):
            query_raw = seed.get("query")
            query = query_raw.strip() if isinstance(query_raw, str) else ""
            purpose = seed.get("purpose", "MARKET_DISCOVERY")
            source = seed.get("source", "user_provided")
            validate_enum(purpose, SEED_PURPOSES, f"{label}.purpose", errors)
        else:
            errors.append(f"{label} 必须是字符串或 object。")
            continue
        if not query:
            warnings.append(f"{label} 为空，已忽略。")
            continue
        if HIGH_RISK_TEXT.search(query) and purpose != "ISOLATED_RISK_RESEARCH":
            high_warnings.append(
                f"{label} 包含认证/安全/医疗等高风险表达，只能标 ISOLATED_RISK_RESEARCH。"
            )
        seeds.append({"query": query, "purpose": purpose, "source": str(source)})
    unique_seed_queries = list(dict.fromkeys(seed["query"] for seed in seeds))

    default_deliverables = (
        ["KEYWORD_LIBRARY", "SOURCE_COVERAGE", "SERP_VALIDATION", "LISTING_HANDOFF"]
        if mode in {"FULL_BUILD", "INCREMENTAL_REFRESH"}
        else ["SERP_VALIDATION"]
        if mode == "SERP_ONLY"
        else ["KEYWORD_LIBRARY"]
    )
    deliverables_raw = data.get("requested_deliverables", default_deliverables)
    if not isinstance(deliverables_raw, list) or any(
        not isinstance(item, str) for item in deliverables_raw
    ):
        errors.append("requested_deliverables 必须是字符串 array。")
        deliverables_raw = []
    ad_deliverables = sorted(set(deliverables_raw) & OUT_OF_SCOPE_AD_DELIVERABLES)
    if ad_deliverables:
        high_warnings.append(
            "广告策略交付物不属于本 Skill，已忽略：" + ", ".join(ad_deliverables)
        )
    invalid_deliverables = sorted(
        set(deliverables_raw) - DELIVERABLES - OUT_OF_SCOPE_AD_DELIVERABLES
    )
    if invalid_deliverables:
        errors.append(
            "requested_deliverables 含未知值：" + ", ".join(invalid_deliverables)
        )
    deliverables = [item for item in deliverables_raw if item in DELIVERABLES]
    if not deliverables:
        deliverables = list(default_deliverables)
        warnings.append(
            "没有可用的词库交付物；已恢复当前模式的默认词库交付物。"
        )

    output_raw = data.get("output", {})
    if output_raw is None:
        output_raw = {}
    if not isinstance(output_raw, dict):
        errors.append("output 必须是 object 或 null。")
        output: dict[str, Any] = {}
    else:
        output = output_raw
    for flag in ("workbook", "serp_validation", "exact_bid_budget"):
        if flag in output and not isinstance(output[flag], bool):
            errors.append(f"output.{flag} 必须是 boolean，不能用字符串或数字代替。")
    if output.get("exact_bid_budget") is True:
        high_warnings.append(
            "output.exact_bid_budget 属于广告策略，已忽略；本 Skill 不生成出价或预算。"
        )
    if "economics" in data and data.get("economics") not in ({}, None):
        high_warnings.append(
            "economics 属于广告经济模型，已忽略；本 Skill 只保留 target_price 作为竞争背景。"
        )

    expected_marketplace_currency = CURRENCY_BY_MARKETPLACE.get(marketplace)
    normalized_target_currency = (
        currency.strip().upper() if isinstance(currency, str) else None
    )
    if (
        normalized_target_currency
        and expected_marketplace_currency
        and normalized_target_currency != expected_marketplace_currency
    ):
        errors.append(
            f"target_price.currency={normalized_target_currency} 与 {marketplace} 站默认币种 {expected_marketplace_currency} 不一致。"
        )

    inferred_seed_available = bool(
        isinstance(category, str) and category.strip() and not unique_seed_queries
    )
    acquisition_sources = (
        len(unique_competitor_asins)
        + len(unique_seed_queries)
        + (1 if product_asin else 0)
        + (1 if inferred_seed_available else 0)
        + (1 if mode == "AUDIT" and accessible_source_files else 0)
    )
    runnable_acquisition = bool(marketplace and acquisition_sources > 0 and not errors)

    product_identity_known = bool(
        (isinstance(product_name, str) and product_name.strip())
        or (isinstance(category, str) and category.strip())
        or (product_asin and asin_role == "OUR_PRODUCT")
    )
    product_evidence_known = bool(
        usable_fact_count > 0
        or accessible_source_files
        or (product_asin and asin_role == "OUR_PRODUCT")
    )
    runnable_keyword_classification = bool(
        runnable_acquisition and product_identity_known and product_evidence_known
    )
    restricted_claims = list(dict.fromkeys(restricted_claims))
    released_roles_available = bool(
        runnable_keyword_classification
        and valid_publication_ready_fact_count > 0
    )

    acquisition_missing: list[str] = []
    if not marketplace:
        acquisition_missing.append("marketplace")
    if acquisition_sources == 0:
        acquisition_missing.append("至少一个 ASIN、market seed 或可审计工作簿")
    classification_missing: list[str] = []
    if not product_identity_known:
        classification_missing.append("我方产品身份/品类")
    if not product_evidence_known:
        classification_missing.append(
            "至少一个可研究的我方事实、可读资料或 OUR_PRODUCT ASIN"
        )

    if not runnable_keyword_classification and runnable_acquisition:
        warnings.append(
            "当前可先做原始采集，但产品匹配与词库角色必须保持 UNKNOWN/PROVISIONAL。"
        )
    if not unique_competitor_asins:
        warnings.append("没有竞品 ASIN；完整建库仍需补齐竞品流量词源。")
    if not unique_seed_queries:
        if isinstance(category, str) and category.strip():
            warnings.append(
                "没有 market seed；可基于产品品类生成并标 INFERRED_FROM_PRODUCT。"
            )
        else:
            warnings.append("没有 market seed；完整建库仍需补齐大盘词源。")
    if mode == "INCREMENTAL_REFRESH" and not (
        workflow_ids["project_id"] or accessible_source_files
    ):
        warnings.append(
            "INCREMENTAL_REFRESH 缺 project_id 和可访问的既有文件；稳定 ID 与历史快照无法确认。"
        )

    result = {
        "structurally_valid": not errors,
        "capabilities": {
            "runnable_for_acquisition": runnable_acquisition,
            "runnable_for_keyword_classification": runnable_keyword_classification,
            "released_roles_available": released_roles_available,
            "released_roles_partially_restricted": bool(restricted_claims),
        },
        "errors": errors,
        "high_priority_warnings": list(dict.fromkeys(high_warnings)),
        "warnings": list(dict.fromkeys(warnings)),
        "missing_for_capabilities": {
            "acquisition": acquisition_missing,
            "keyword_classification": classification_missing,
        },
        "restricted_claims": restricted_claims,
        "normalized_summary": {
            "mode": mode,
            "project_id": workflow_ids["project_id"],
            "selection_run_id": workflow_ids["selection_run_id"],
            "candidate_id": workflow_ids["candidate_id"],
            "competitor_lock_run_id": workflow_ids["competitor_lock_run_id"],
            "keyword_run_id": workflow_ids["keyword_run_id"],
            "marketplace": marketplace or None,
            "marketplace_static_supported": marketplace_static_supported,
            "operating_context": operating_context,
            "operating_context_sha256": computed_operating_context_hash,
            "product_name": product_name.strip()
            if isinstance(product_name, str) and product_name.strip()
            else None,
            "product_asin": product_asin or None,
            "product_asin_role": asin_role,
            "fact_count": len(facts_raw),
            "usable_fact_count": usable_fact_count,
            "valid_publication_ready_fact_count": valid_publication_ready_fact_count,
            "compliance_document_count": len(documents),
            "source_file_count": len(source_files),
            "accessible_source_file_count": len(accessible_source_files),
            "target_price": {
                "min": price_min,
                "max": price_max,
                "currency": currency.strip().upper()
                if isinstance(currency, str) else None,
            },
            "review_stage": {
                "current": review_current,
                "target_min": review_min,
                "target_max": review_max,
                "decision_basis_stage": decision_basis,
            },
            "competitor_input_instance_count": len(competitor_instances),
            "competitor_unique_asin_count": len(unique_competitor_asins),
            "locked_competitor_count": locked_competitor_count,
            "competitor_asins": unique_competitor_asins,
            "competitors": competitor_instances,
            "market_seed_count": len(unique_seed_queries),
            "market_seeds": unique_seed_queries,
            "requested_deliverables": deliverables,
            "serp_validation": output.get(
                "serp_validation", mode in {"FULL_BUILD", "SERP_ONLY", "INCREMENTAL_REFRESH"}
            ),
            "workbook": output.get("workbook", mode in {"FULL_BUILD", "INCREMENTAL_REFRESH"}),
        },
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
