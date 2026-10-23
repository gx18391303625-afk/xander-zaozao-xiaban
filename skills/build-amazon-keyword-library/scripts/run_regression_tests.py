#!/usr/bin/env python3
"""Regression tests for locked-competitor keyword-library inputs."""

from __future__ import annotations

import json
import math
import subprocess
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
VALIDATOR = SCRIPT_DIR / "validate_inputs.py"
SYNTHETIC_ASIN = "B" + "0" * 9


def run_validator(payload: dict) -> tuple[int, dict]:
    completed = subprocess.run(
        [sys.executable, str(VALIDATOR), "-"],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
    )
    return completed.returncode, json.loads(completed.stdout)


def base_payload() -> dict:
    return {
        "mode": "FULL_BUILD",
        "project_id": "PROJECT-001",
        "selection_run_id": "SELECT-001",
        "candidate_id": "CAND-001",
        "competitor_lock_run_id": "LOCK-001",
        "marketplace": "US",
        "product": {
            "name": "Example Product",
            "category": "Example Category",
            "facts": [
                {
                    "name": "pack_count",
                    "value": 2,
                    "evidence_type": "USER_CONFIRMED",
                    "risk_class": "LOW_RISK_SPEC",
                    "research_status": "RESEARCH_USABLE",
                    "publication_status": "COPY_RELEASED",
                    "source": "user confirmed",
                }
            ],
            "compliance_documents": [],
        },
        "competitors": [
            {
                "input_instance_id": "INPUT-001",
                "asin": SYNTHETIC_ASIN,
                "rank": 1,
                "order_basis": "user_provided_order",
                "source_role": "USER_SUPPLIED",
                "primary_role": "LAUNCH_PEER",
                "roles": ["LAUNCH_PEER", "DIRECT_PRICE_FORM"],
                "lock_status": "CORE_BENCHMARK",
                "keyword_acquisition_scope": "FULL_TRAFFIC",
                "lock_run_id": "LOCK-001",
                "evidence_ids": ["E-001"],
            }
        ],
        "market_seeds": ["example keyword"],
        "requested_deliverables": [
            "KEYWORD_LIBRARY",
            "SOURCE_COVERAGE",
            "SERP_VALIDATION",
            "LISTING_HANDOFF",
        ],
        "output": {"workbook": True, "serp_validation": True},
    }


def valid_operating_context() -> dict:
    return {
        "context_id": "CTX-001",
        "price_context": {
            "current_observed": {
                "amount": 1.0,
                "currency": "USD",
                "observed_at": "2030-01-01T00:00:00+00:00",
                "verification_status": "OBSERVED",
                "evidence_ids": ["PRICE-SNAPSHOT-001"],
            },
            "planned_phases": [
                {
                    "phase_id": "PRICE-PHASE-001",
                    "trigger": {"type": "MANUAL_CONFIRMATION", "value": "seller confirms"},
                    "intended_price": {"amount": 1.0, "currency": "USD"},
                    "verification_status": "PLANNED_UNVERIFIED",
                    "source_type": "USER_CONFIRMED",
                    "evidence_ids": ["DECISION-001"],
                }
            ],
        },
        "current_stage": {
            "stage_id": "STAGE-001",
            "observed_at": "2030-01-01T00:00:00+00:00",
            "evidence_ids": ["STAGE-SNAPSHOT-001"],
        },
        "seasonality_context": {
            "classification": "EVERGREEN_WITH_PEAKS",
            "current_phase": "RAMP",
            "source_period": "source-defined observation window",
            "source_granularity": "WEEK",
            "evidence_ids": ["SEASON-001"],
            "confidence": "MEDIUM",
            "refresh_due_at": "2030-01-02",
        },
        "content_change_control": {
            "decision_id": "CHANGE-001",
            "decided_at": "2030-01-01T00:00:00+00:00",
            "copy_state": "LOCKED",
            "asset_state": "PARTIAL",
            "locked_scopes": ["TITLE", "BULLETS", "IMAGES"],
            "reopen_conditions": ["explicit seller authorization"],
        },
        "acknowledged_risks": [
            {
                "risk_id": "RISK-001",
                "decision": "ACKNOWLEDGED_FOR_OPERATION",
                "scope": "current operating decision",
                "review_trigger": "new policy or evidence state",
                "does_not_change_evidence_or_publication_status": True,
            }
        ],
        "profit_objective": {"status": "USER_DEFINED", "source_ids": ["DECISION-002"]},
        "demand_calendar": {"status": "UNKNOWN"},
        "supply_routes": [{"route_id": "ROUTE-001", "status": "USER_SUPPLIED"}],
        "replenishment_policy": {"status": "USER_DEFINED"},
    }


class LockedCompetitorInputTests(unittest.TestCase):
    def test_locked_competitor_and_listing_handoff_are_accepted(self) -> None:
        code, result = run_validator(base_payload())
        self.assertEqual(code, 0)
        self.assertTrue(result["structurally_valid"])
        self.assertEqual(result["normalized_summary"]["locked_competitor_count"], 1)
        self.assertIn("LISTING_HANDOFF", result["normalized_summary"]["requested_deliverables"])
        self.assertEqual(result["normalized_summary"]["competitors"][0]["lock_status"], "CORE_BENCHMARK")

    def test_legacy_asin_list_remains_compatible(self) -> None:
        payload = base_payload()
        payload.pop("competitor_lock_run_id")
        payload["competitors"] = [SYNTHETIC_ASIN]
        code, result = run_validator(payload)
        self.assertEqual(code, 0)
        self.assertTrue(result["structurally_valid"])
        self.assertEqual(result["normalized_summary"]["locked_competitor_count"], 0)
        self.assertTrue(any("PROVISIONAL" in item for item in result["warnings"]))

    def test_invalid_canonical_role_is_rejected(self) -> None:
        payload = base_payload()
        payload["competitors"][0]["primary_role"] = "DIRECT"
        payload["competitors"][0]["roles"] = ["DIRECT"]
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertFalse(result["structurally_valid"])
        self.assertTrue(any("primary_role" in item or "roles" in item for item in result["errors"]))

    def test_user_supplied_valid_asin_cannot_be_silently_skipped(self) -> None:
        payload = base_payload()
        payload["competitors"][0]["lock_status"] = "CONTEXT_ONLY"
        payload["competitors"][0]["keyword_acquisition_scope"] = "CONTEXT_ONLY"
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertTrue(any("FULL_TRAFFIC" in item for item in result["errors"]))

    def test_incremental_refresh_mode_is_supported(self) -> None:
        payload = base_payload()
        payload["mode"] = "INCREMENTAL_REFRESH"
        code, result = run_validator(payload)
        self.assertEqual(code, 0)
        self.assertEqual(result["normalized_summary"]["mode"], "INCREMENTAL_REFRESH")
        self.assertTrue(result["normalized_summary"]["workbook"])

    def test_invalid_identity_needs_no_fake_role(self) -> None:
        payload = base_payload()
        payload["competitors"][0].update(
            {
                "primary_role": None,
                "roles": [],
                "lock_status": "EXCLUDED_INVALID",
                "keyword_acquisition_scope": "NO_QUERY",
            }
        )
        code, result = run_validator(payload)
        self.assertEqual(code, 0)
        self.assertTrue(result["structurally_valid"])
        competitor = result["normalized_summary"]["competitors"][0]
        self.assertIsNone(competitor["primary_role"])
        self.assertEqual(competitor["roles"], [])
        self.assertEqual(competitor["keyword_acquisition_scope"], "NO_QUERY")

    def test_advertising_requests_are_ignored_not_delivered(self) -> None:
        payload = base_payload()
        payload["requested_deliverables"].extend(["EXACT_BID", "STOP_LOSS"])
        payload["output"]["exact_bid_budget"] = True
        payload["economics"] = {"target_acos": "out-of-scope-placeholder"}
        code, result = run_validator(payload)
        self.assertEqual(code, 0)
        self.assertNotIn("EXACT_BID", result["normalized_summary"]["requested_deliverables"])
        self.assertNotIn("STOP_LOSS", result["normalized_summary"]["requested_deliverables"])
        self.assertTrue(any("广告策略" in item for item in result["high_priority_warnings"]))

    def test_operating_context_is_validated_and_preserved(self) -> None:
        payload = base_payload()
        payload["operating_context"] = valid_operating_context()
        code, result = run_validator(payload)
        self.assertEqual(code, 0, result["errors"])
        self.assertEqual(
            result["normalized_summary"]["operating_context"],
            payload["operating_context"],
        )
        self.assertTrue(
            result["normalized_summary"]["operating_context_sha256"].startswith(
                "sha256:"
            )
        )

    def test_operating_context_hash_mismatch_is_rejected(self) -> None:
        payload = base_payload()
        payload["operating_context"] = valid_operating_context()
        payload["operating_context_sha256"] = "sha256:" + "0" * 64
        code, result = run_validator(payload)
        self.assertNotEqual(code, 0)
        self.assertTrue(
            any("operating_context_sha256" in item for item in result["errors"])
        )

    def test_planned_price_cannot_impersonate_current_stage(self) -> None:
        payload = base_payload()
        payload["operating_context"] = valid_operating_context()
        payload["operating_context"]["price_context"]["planned_phases"][0]["verification_status"] = "OBSERVED"
        payload["operating_context"]["current_stage"]["planned_phase_id"] = "PRICE-PHASE-001"
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertTrue(any("PLANNED_UNVERIFIED" in item for item in result["errors"]))
        self.assertTrue(any("planned_phase_id" in item for item in result["errors"]))

    def test_seasonality_requires_evidence_when_not_unknown(self) -> None:
        payload = base_payload()
        payload["operating_context"] = valid_operating_context()
        payload["operating_context"]["seasonality_context"]["evidence_ids"] = []
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertTrue(any("季节结论" in item for item in result["errors"]))

    def test_invalid_seasonality_refresh_date_is_rejected(self) -> None:
        payload = base_payload()
        payload["operating_context"] = valid_operating_context()
        payload["operating_context"]["seasonality_context"]["refresh_due_at"] = "not-a-date"
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertTrue(any("refresh_due_at" in item for item in result["errors"]))

    def test_risk_acknowledgement_cannot_override_release_state(self) -> None:
        payload = base_payload()
        payload["operating_context"] = valid_operating_context()
        risk = payload["operating_context"]["acknowledged_risks"][0]
        risk["publication_status_override"] = "FORMAL_CLAIM_RELEASED"
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertTrue(any("覆盖字段" in item for item in result["errors"]))

    def test_locked_content_requires_explicit_scopes(self) -> None:
        payload = base_payload()
        payload["operating_context"] = valid_operating_context()
        payload["operating_context"]["content_change_control"]["locked_scopes"] = []
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertTrue(any("locked_scopes" in item for item in result["errors"]))

    def test_nonfinite_price_and_review_values_are_rejected(self) -> None:
        payload = base_payload()
        payload["target_price"] = {"min": math.nan, "max": 9, "currency": "USD"}
        payload["review_stage"] = {"current": math.inf}
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertTrue(any("target_price.min" in item for item in result["errors"]))
        self.assertTrue(any("review_stage.current" in item for item in result["errors"]))

    def test_nonfinite_context_is_reported_without_crashing(self) -> None:
        payload = base_payload()
        payload["operating_context"] = valid_operating_context()
        payload["operating_context"]["price_context"]["current_observed"]["amount"] = math.nan
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertTrue(any("operating_context" in item for item in result["errors"]))

    def test_output_string_boolean_does_not_become_enabled(self) -> None:
        payload = base_payload()
        payload["output"]["workbook"] = "false"
        code, result = run_validator(payload)
        self.assertEqual(code, 2)
        self.assertTrue(any("output.workbook" in item for item in result["errors"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
