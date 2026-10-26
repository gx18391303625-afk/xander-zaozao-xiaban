#!/usr/bin/env python3
"""Check a declared competitor timeline scope, without fetching or approving facts.

Input: {as_of, events: [{id, kind: SNAPSHOT|CHANGE, source_ref,
first_observed_at, actual_changed_at?, change_source_ref?, asin?, variant?,
marketplace?, pack_count?, currency?, region?, eligibility?, context?, values?}],
comparisons?: [{kind: CHANGE|NO_CHANGE|ASSOCIATION|EFFECT|CAUSAL,
before_event_id, after_event_id, field, action_event_id?,
followup_window?: {start, end}}]}.

Times are timezone-aware ISO 8601 strings. null means unknown. CHANGE comparisons
describe observed endpoint differences; they do not supply an actual change time.
Exact change times need a CHANGE event with a separate source locator. Comparison
context is a caller-supplied identifier covering metric definition, source surface,
parent/child scope and demand phase; identical labels are not independent proof.
PASS covers only the supplied observations/comparisons, never complete history,
source authenticity, experimental validity, outcome approval or causality.
Section, event, comparison and window field names are closed; put source locators
in source_ref/change_source_ref and comparison scope in context. values alone is
an open metric map. A comparison may also carry an optional string id.
"""

from __future__ import annotations

from datetime import datetime
import math
from typing import Any


IDENTITY_FIELDS = (
    "asin", "variant", "marketplace", "pack_count", "currency", "region",
    "eligibility", "context",
)
COMPARISON_KINDS = ("CHANGE", "NO_CHANGE", "ASSOCIATION", "EFFECT", "CAUSAL")
EVENT_FIELDS = set(IDENTITY_FIELDS) | {
    "id", "kind", "source_ref", "first_observed_at", "actual_changed_at",
    "change_source_ref", "values",
}
COMPARISON_FIELDS = {
    "id", "kind", "before_event_id", "after_event_id", "field",
    "action_event_id", "followup_window",
}


def _unknown(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip().upper() in ("", "UNKNOWN"))


def _text(value: Any) -> bool:
    return isinstance(value, str) and not _unknown(value)


def _value_kind(value: Any) -> str | None:
    if _unknown(value):
        return None
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        # Avoid converting arbitrarily large JSON integers to float.
        return "number" if isinstance(value, int) or math.isfinite(value) else "invalid"
    return "text" if isinstance(value, str) else "invalid"


def check(data: Any) -> dict[str, Any]:
    """Return PASS, INCOMPLETE or INVALID; malformed JSON-shaped inputs never raise."""
    issues: list[dict[str, str]] = []
    levels: list[str] = []
    summary: dict[str, Any] = {
        "scope": "SUPPLIED_TIMELINE_ONLY", "event_count": 0,
        "snapshot_count": 0, "comparison_count": 0,
        "observational_comparisons_checked": 0, "effect_claims": 0,
        "effect_evidence_status": "NOT_ESTABLISHED",
        "causality_approved": False, "complete_history_verified": False,
    }

    def issue(level: str, code: str, path: str, message: str) -> None:
        levels.append(level)
        issues.append({"code": code, "path": path, "message": message})

    def result() -> dict[str, Any]:
        return {"status": "INVALID" if "INVALID" in levels else "INCOMPLETE" if levels else "PASS",
                "issues": issues, "summary": summary}

    def fields(obj: dict[str, Any], allowed: set[str], path: str) -> None:
        for key in obj:
            if key not in allowed:
                issue("INVALID", "UNKNOWN_FIELD", f"{path}.{key}", "未知字段不能静默忽略；请使用约定字段保存来源、事件和比较。")

    def timestamp(value: Any, path: str, required: bool = False) -> datetime | None:
        if _unknown(value):
            if required:
                issue("INCOMPLETE", "MISSING_TIMESTAMP", path, "需要带时区的实际时间；缺失不能用当前系统时间补造。")
            return None
        if not isinstance(value, str):
            issue("INVALID", "TIMESTAMP_TYPE", path, "时间必须为带时区的 ISO 8601 字符串或 null。")
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError("timezone missing")
            return parsed
        except (ValueError, OverflowError):
            issue("INVALID", "INVALID_TIMESTAMP", path, "时间无效或缺少时区。")
            return None

    def locator(value: Any, path: str) -> None:
        if _unknown(value):
            issue("INCOMPLETE", "MISSING_SOURCE", path, "需要可定位原始证据的来源；本工具不核验来源内容。")
        elif not isinstance(value, str):
            issue("INVALID", "SOURCE_TYPE", path, "来源定位必须为非空字符串。")

    if data is None:
        issue("INCOMPLETE", "MISSING_TIMELINE", "$", "已请求时间线检查，但未提供时间线数据。")
        return result()
    if not isinstance(data, dict):
        issue("INVALID", "TIMELINE_TYPE", "$", "时间线必须为对象。")
        return result()
    fields(data, {"as_of", "events", "comparisons"}, "$")
    as_of = timestamp(data.get("as_of"), "$.as_of", required=True)
    events = data.get("events")
    if not isinstance(events, list):
        issue("INVALID", "EVENTS_TYPE", "$.events", "events 必须为数组。")
        return result()
    if not events:
        issue("INCOMPLETE", "NO_EVENTS", "$.events", "未提供任何快照或变更证据。")
    summary["event_count"] = len(events)
    records: dict[str, tuple[dict[str, Any], datetime | None, datetime | None]] = {}
    valid_records: dict[str, bool] = {}
    for i, event in enumerate(events):
        path = f"$.events[{i}]"
        event_initial_issues = len(issues)
        if not isinstance(event, dict):
            issue("INVALID", "EVENT_TYPE", path, "每个事件必须为对象。")
            continue
        fields(event, EVENT_FIELDS, path)
        event_id = event.get("id")
        if not _text(event_id):
            issue("INVALID", "EVENT_ID", path + ".id", "事件 ID 必须为唯一非空字符串。")
        elif event_id in records:
            issue("INVALID", "DUPLICATE_EVENT_ID", path + ".id", "事件 ID 重复，无法可靠引用。")
            valid_records[event_id] = False
        kind = event.get("kind")
        if not isinstance(kind, str) or kind not in ("SNAPSHOT", "CHANGE"):
            issue("INVALID", "EVENT_KIND", path + ".kind", "kind 只能是 SNAPSHOT 或 CHANGE。")
        if kind == "SNAPSHOT":
            summary["snapshot_count"] += 1
        locator(event.get("source_ref"), path + ".source_ref")
        observed = timestamp(event.get("first_observed_at"), path + ".first_observed_at", required=True)
        changed = timestamp(event.get("actual_changed_at"), path + ".actual_changed_at")
        if not _unknown(event.get("actual_changed_at")):
            if kind == "SNAPSHOT":
                issue("INVALID", "SNAPSHOT_HAS_CHANGE_TIME", path + ".actual_changed_at", "观察快照不能充当实际变更时间；独立证据应另列 CHANGE 事件。")
            locator(event.get("change_source_ref"), path + ".change_source_ref")
        if observed and as_of and observed > as_of:
            issue("INVALID", "OBSERVATION_AFTER_AS_OF", path + ".first_observed_at", "观察时间晚于声明的证据截止时间。")
        if changed and observed and changed > observed:
            issue("INVALID", "CHANGE_AFTER_OBSERVATION", path + ".actual_changed_at", "实际变更不能发生在其首次观察证据之后。")
        if changed and as_of and changed > as_of:
            issue("INVALID", "CHANGE_AFTER_AS_OF", path + ".actual_changed_at", "实际变更晚于证据截止时间。")
        for field in IDENTITY_FIELDS:
            value = event.get(field)
            if _unknown(value):
                continue
            if field == "pack_count":
                valid = isinstance(value, int) and not isinstance(value, bool) and value > 0
            else:
                valid = isinstance(value, str)
            if not valid:
                issue("INVALID", "CONTEXT_TYPE", path + "." + field, "口径字段须为文本；pack_count 须为正整数；未知用 null。")
        values = event.get("values")
        if values is not None and not isinstance(values, dict):
            issue("INVALID", "VALUES_TYPE", path + ".values", "values 必须为字段到原始值的对象或 null。")
        elif isinstance(values, dict):
            for key, value in values.items():
                if not _text(key) or _value_kind(value) == "invalid":
                    issue("INVALID", "VALUE_TYPE", path + ".values", "观测字段须为非空文本，值须为有限数值、文本、布尔值或 null。")
        if _text(event_id) and event_id not in records:
            records[event_id] = (event, observed, changed)
            valid_records[event_id] = len(issues) == event_initial_issues

    comparisons = data.get("comparisons", [])
    if not isinstance(comparisons, list):
        issue("INVALID", "COMPARISONS_TYPE", "$.comparisons", "comparisons 必须为数组；纯快照可省略或用空数组。")
        return result()
    summary["comparison_count"] = len(comparisons)
    for i, comp in enumerate(comparisons):
        path = f"$.comparisons[{i}]"
        initial_issues = len(issues)
        if not isinstance(comp, dict):
            issue("INVALID", "COMPARISON_TYPE", path, "每项比较必须为对象。")
            continue
        fields(comp, COMPARISON_FIELDS, path)
        if "id" in comp and not _text(comp["id"]):
            issue("INVALID", "COMPARISON_ID", path + ".id", "提供的比较 ID 须为非空字符串。")
        kind = comp.get("kind")
        if not isinstance(kind, str) or kind not in COMPARISON_KINDS:
            issue("INVALID", "COMPARISON_KIND", path + ".kind", "比较类型无效。")
            continue
        effect = kind in ("EFFECT", "CAUSAL")
        if effect:
            summary["effect_claims"] += 1
        endpoints = []
        for field in ("before_event_id", "after_event_id"):
            ref = comp.get(field)
            if not _text(ref) or ref not in records:
                issue("INVALID", "EVENT_REFERENCE", path + "." + field, "比较必须引用已提供且唯一的事件 ID。")
            else:
                endpoints.append(records[ref])
        if len(endpoints) != 2:
            continue
        before, after = endpoints
        if comp.get("before_event_id") == comp.get("after_event_id"):
            issue("INVALID", "SAME_ENDPOINT", path, "同一个快照不能证明变化或无变化。")
        if before[1] and after[1] and before[1] >= after[1]:
            issue("INVALID", "OBSERVATION_ORDER", path, "前后快照须有明确且严格递增的观察时间。")

        def comparable(left: dict[str, Any], right: dict[str, Any], at: str) -> None:
            for field in IDENTITY_FIELDS:
                a, b = left.get(field), right.get(field)
                if _unknown(a) or _unknown(b):
                    issue("INCOMPLETE", "UNKNOWN_COMPARISON_CONTEXT", at + "." + field, "比较身份或口径未知，不能视为一致。")
                elif a != b:
                    issue("INVALID", "COMPARISON_CONTEXT_MISMATCH", at + "." + field, "前后 ASIN、变体或比较口径不同，不能拼接成同对象历史。")

        comparable(before[0], after[0], path)
        field = comp.get("field")
        if not _text(field):
            issue("INVALID", "COMPARISON_FIELD", path + ".field", "需要明确比较的观测字段。")
        else:
            values = []
            for event, _, _ in endpoints:
                observed_values = event.get("values")
                value = observed_values.get(field) if isinstance(observed_values, dict) else None
                values.append(value)
            types = [_value_kind(v) for v in values]
            if None in types:
                issue("INCOMPLETE", "UNKNOWN_COMPARISON_VALUE", path + ".field", "缺失观测不能当零、无变化或已知结果。")
            elif "invalid" in types or types[0] != types[1]:
                issue("INVALID", "COMPARISON_VALUE_TYPE", path + ".field", "前后观测值类型不可比较。")
            elif kind == "CHANGE" and values[0] == values[1]:
                issue("INVALID", "NO_OBSERVED_DIFFERENCE", path, "两个已知值相同，不能声称已观察到变化。")
            elif kind == "NO_CHANGE" and values[0] != values[1]:
                issue("INVALID", "OBSERVED_DIFFERENCE", path, "两个已知值不同，不能声称观测值未变。")

        action = None
        if effect or "action_event_id" in comp:
            ref = comp.get("action_event_id")
            if not _text(ref) or ref not in records:
                issue("INCOMPLETE" if _unknown(ref) else "INVALID", "ACTION_REFERENCE", path + ".action_event_id", "效果判断需要独立变更事件，不能从观察时间猜测动作时间。")
            else:
                action = records[ref]
                comparable(before[0], action[0], path + ".action_event_id")
                if action[0].get("kind") != "CHANGE":
                    issue("INVALID", "ACTION_IS_SNAPSHOT", path + ".action_event_id", "观察快照不是已证实的动作事件。")
                if action[2] is None:
                    issue("INCOMPLETE", "UNKNOWN_ACTUAL_CHANGE_TIME", path + ".action_event_id", "动作实际发生时间未知，不能建立效果时间窗口。")
                elif before[1] and action[2] < before[1]:
                    issue("INVALID", "BASELINE_AFTER_ACTION", path, "所谓前置基线观察发生在动作之后。")
                if action[2] and after[1] and action[2] > after[1]:
                    issue("INVALID", "OUTCOME_BEFORE_ACTION", path, "结果观察早于实际动作。")
        window = comp.get("followup_window")
        if window is None:
            if effect:
                issue("INCOMPLETE", "MISSING_FOLLOWUP_WINDOW", path + ".followup_window", "效果判断缺少后续观察窗口。")
        elif not isinstance(window, dict):
            issue("INVALID", "FOLLOWUP_TYPE", path + ".followup_window", "后续观察窗口必须为 start/end 对象。")
        else:
            fields(window, {"start", "end"}, path + ".followup_window")
            start = timestamp(window.get("start"), path + ".followup_window.start", required=True)
            end = timestamp(window.get("end"), path + ".followup_window.end", required=True)
            anchor = action[2] if action and action[2] else before[2] or before[1]
            if start and end and start > end:
                issue("INVALID", "FOLLOWUP_ORDER", path + ".followup_window", "后续窗口结束早于开始。")
            if start and anchor and start < anchor:
                issue("INVALID", "FOLLOWUP_BEFORE_EVENT", path + ".followup_window.start", "后续窗口不能早于对应事件。")
            if end and as_of and end > as_of:
                issue("INCOMPLETE", "FOLLOWUP_PENDING", path + ".followup_window.end", "计划观察窗口尚未结束，不能宣称已完成效果观察。")
            if effect and end and after[1] and after[1] < end:
                issue("INCOMPLETE", "OUTCOME_WINDOW_NOT_COVERED", path + ".after_event_id", "结果快照尚未覆盖整个后续窗口。")
        if effect:
            issue("INCOMPLETE", "EFFECT_REQUIRES_INDEPENDENT_REVIEW", path,
                  "时间完整和同口径只支持时间线检查；动作效果及因果仍需对照、归因成熟度、混杂因素等独立审查。")
        elif (len(issues) == initial_issues and as_of is not None
              and valid_records.get(comp.get("before_event_id"), False)
              and valid_records.get(comp.get("after_event_id"), False)
              and ("action_event_id" not in comp
                   or valid_records.get(comp.get("action_event_id"), False))):
            summary["observational_comparisons_checked"] += 1
    return result()
