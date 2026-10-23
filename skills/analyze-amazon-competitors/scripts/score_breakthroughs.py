#!/usr/bin/env python3
"""Score and rank Amazon competitor breakthrough opportunities.

The script performs deterministic arithmetic only. It does not fetch Amazon data
or decide whether the underlying evidence is true.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


SCORE_FIELDS = {
    "demand_strength": 0.25,
    "competitor_gap": 0.20,
    "proof_strength": 0.20,
    "visual_clarity": 0.15,
    "commercial_impact": 0.10,
    "feasibility_speed": 0.10,
}

CONFIDENCE_ALIASES = {
    "high": "high",
    "medium": "medium",
    "low": "low",
    "unknown": "unknown",
    "高": "high",
    "中": "medium",
    "低": "low",
    "未知": "unknown",
}

CONFIDENCE_LABELS_ZH = {
    "high": "高",
    "medium": "中",
    "low": "低",
    "unknown": "未知",
}

DECISION_LABELS_ZH = {
    "primary-attack": "主攻候选",
    "supporting": "辅助候选",
    "validate": "待验证",
    "deprioritize": "降级",
    "blocked": "阻断",
}

GATE_LABELS_ZH = {
    "proof_strength_below_3": "我方证明强度低于3",
    "critical_fact_missing": "关键事实缺失",
    "high_risk_claim_unmatched": "高风险主张缺少匹配证据",
    "hard_blocker": "硬红线",
    "evidence_missing": "缺少依据或证据ID",
    "confidence_low": "证据置信度低（最高辅助候选）",
    "confidence_unknown": "证据置信度未知（最高待验证）",
}

# 决策档位：先按档位排序，再按分数。被闸门压档的高分项不会排在真正的主攻候选前面。
DECISION_ORDER = ["primary-attack", "supporting", "validate", "deprioritize", "blocked"]
# 置信度封顶：低 → 最高辅助；未知 → 最高待验证
CONFIDENCE_CAP = {"high": "primary-attack", "medium": "primary-attack", "low": "supporting", "unknown": "validate"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score Amazon breakthrough opportunities from JSON input."
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path, help="Path to a JSON array or object with an opportunities array")
    source.add_argument("--json", help="Inline JSON array or object with an opportunities array")
    parser.add_argument(
        "--format",
        choices=("json", "markdown"),
        default="json",
        help="Output format (default: json)",
    )
    return parser.parse_args()


def load_payload(args: argparse.Namespace) -> list[dict[str, Any]]:
    raw = args.input.read_text(encoding="utf-8") if args.input else args.json
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if isinstance(payload, dict):
        payload = payload.get("opportunities")
    if not isinstance(payload, list) or not payload:
        raise ValueError("Input must be a non-empty JSON array or contain a non-empty 'opportunities' array")
    if not all(isinstance(item, dict) for item in payload):
        raise ValueError("Every opportunity must be a JSON object")
    return payload


def number_in_range(item: dict[str, Any], field: str, low: float, high: float) -> float:
    if field not in item:
        raise ValueError(f"{item.get('id', '<unknown>')}: missing '{field}'")
    value = item[field]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{item.get('id', '<unknown>')}: '{field}' must be a number")
    value = float(value)
    if not low <= value <= high:
        raise ValueError(
            f"{item.get('id', '<unknown>')}: '{field}' must be between {low:g} and {high:g}"
        )
    return value


def boolean_field(item: dict[str, Any], field: str) -> bool:
    if field not in item:
        raise ValueError(f"{item.get('id', '<unknown>')}: missing '{field}'")
    value = item[field]
    if not isinstance(value, bool):
        raise ValueError(f"{item.get('id', '<unknown>')}: '{field}' must be true or false")
    return value


def classify(score: float) -> str:
    if score >= 75:
        return "primary-attack"
    if score >= 60:
        return "supporting"
    if score >= 45:
        return "validate"
    return "deprioritize"


def cap(decision: str, ceiling: str) -> str:
    return decision if DECISION_ORDER.index(decision) >= DECISION_ORDER.index(ceiling) else ceiling


def has_evidence(item: dict[str, Any]) -> bool:
    basis = item.get("basis")
    ids = item.get("evidence_ids")
    ok_basis = isinstance(basis, str) and basis.strip() != ""
    ok_ids = isinstance(ids, list) and any(isinstance(x, str) and x.strip() for x in ids)
    if ids is not None and not isinstance(ids, list):
        raise ValueError(f"{item.get('id', '<unknown>')}: 'evidence_ids' must be a list of strings")
    return ok_basis and ok_ids


def score_item(item: dict[str, Any], index: int) -> dict[str, Any]:
    opportunity_id = str(item.get("id") or f"O{index:02d}")
    name = str(item.get("name") or opportunity_id)
    normalized = dict(item)
    normalized["id"] = opportunity_id
    normalized["name"] = name

    weighted = 0.0
    for field, weight in SCORE_FIELDS.items():
        weighted += number_in_range(normalized, field, 0, 5) * weight

    risk_penalty = number_in_range(normalized, "risk_penalty", 0, 20)
    raw_score = round(weighted * 20, 1)
    adjusted_score = round(max(0.0, min(100.0, raw_score - risk_penalty)), 1)
    decision = classify(adjusted_score)

    gate_reasons: list[str] = []
    if float(normalized["proof_strength"]) < 3:
        gate_reasons.append("proof_strength_below_3")
    critical_fact_missing = boolean_field(normalized, "critical_fact_missing")
    high_risk_claim_unmatched = boolean_field(normalized, "high_risk_claim_unmatched")
    hard_blocker = boolean_field(normalized, "hard_blocker")
    normalized["critical_fact_missing"] = critical_fact_missing
    normalized["high_risk_claim_unmatched"] = high_risk_claim_unmatched
    normalized["hard_blocker"] = hard_blocker
    if critical_fact_missing:
        gate_reasons.append("critical_fact_missing")
    if high_risk_claim_unmatched:
        gate_reasons.append("high_risk_claim_unmatched")
    if hard_blocker:
        gate_reasons.append("hard_blocker")
    if not has_evidence(normalized):
        gate_reasons.append("evidence_missing")
    if gate_reasons:
        decision = "blocked" if "hard_blocker" in gate_reasons else cap(decision, "validate")

    raw_confidence = str(normalized.get("evidence_confidence", "unknown")).strip().lower()
    confidence = CONFIDENCE_ALIASES.get(raw_confidence)
    if confidence is None:
        raise ValueError(
            f"{opportunity_id}: 'evidence_confidence' must be high/medium/low/unknown or 高/中/低/未知"
        )
    capped = cap(decision, CONFIDENCE_CAP[confidence])
    if capped != decision:
        gate_reasons.append(f"confidence_{confidence}")
        decision = capped

    return {
        **normalized,
        "raw_score": raw_score,
        "adjusted_score": adjusted_score,
        "decision": decision,
        "evidence_confidence": confidence,
        "gate_reasons": gate_reasons,
    }


def render_markdown(results: list[dict[str, Any]]) -> str:
    lines = [
        "| ID | 机会 | D | G | P | V | B | F | 原始分 | 风险扣分 | 调整分 | 置信度 | 决策 | 闸门 |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|",
    ]
    for item in results:
        safe_name = str(item["name"]).replace("|", "\\|").replace("\n", " ")
        gate = "、".join(GATE_LABELS_ZH[value] for value in item["gate_reasons"]) or "-"
        confidence = CONFIDENCE_LABELS_ZH[item["evidence_confidence"]]
        decision = DECISION_LABELS_ZH[item["decision"]]
        lines.append(
            f"| {item['id']} | {safe_name} | {float(item['demand_strength']):.1f} | "
            f"{float(item['competitor_gap']):.1f} | {float(item['proof_strength']):.1f} | "
            f"{float(item['visual_clarity']):.1f} | {float(item['commercial_impact']):.1f} | "
            f"{float(item['feasibility_speed']):.1f} | {item['raw_score']:.1f} | "
            f"{float(item['risk_penalty']):.1f} | {item['adjusted_score']:.1f} | "
            f"{confidence} | {decision} | {gate} |"
        )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        opportunities = load_payload(args)
        results = [score_item(item, index) for index, item in enumerate(opportunities, 1)]
        result_ids = [item["id"] for item in results]
        if len(result_ids) != len(set(result_ids)):
            raise ValueError("Opportunity IDs must be unique")
        results.sort(key=lambda item: (DECISION_ORDER.index(item["decision"]), -item["adjusted_score"], item["id"]))
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.format == "markdown":
        print(render_markdown(results))
    else:
        print(json.dumps({"opportunities": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
