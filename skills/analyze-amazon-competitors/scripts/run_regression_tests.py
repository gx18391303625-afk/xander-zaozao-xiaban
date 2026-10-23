#!/usr/bin/env python3
"""Regression tests for benchmark competitor locking."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

SAMPLE_IN_BAND_PRICE = 40.0
SAMPLE_OUT_OF_BAND_PRICE = 75.0

import score_benchmark_candidates as benchmark  # noqa: E402
import score_breakthroughs as breakthrough  # noqa: E402


class BreakthroughArithmeticTests(unittest.TestCase):
    def base(self):
        return {**{field: 4 for field in breakthrough.SCORE_FIELDS}, "risk_penalty": 7,
                "critical_fact_missing": False, "high_risk_claim_unmatched": False,
                "hard_blocker": False, "evidence_confidence": "high",
                "basis": "同屏 12 个竞品均未展示刻度", "evidence_ids": ["E-SERP-001"]}

    def test_low_or_unknown_confidence_cannot_be_primary(self):
        strong = {**self.base(), "risk_penalty": 0, **{f: 5 for f in breakthrough.SCORE_FIELDS}}
        self.assertEqual(breakthrough.score_item(strong, 1)["decision"], "primary-attack")
        low = breakthrough.score_item({**strong, "evidence_confidence": "低"}, 1)
        self.assertEqual(low["decision"], "supporting")
        self.assertIn("confidence_low", low["gate_reasons"])
        unknown = breakthrough.score_item({**strong, "evidence_confidence": "unknown"}, 1)
        self.assertEqual(unknown["decision"], "validate")
        missing = breakthrough.score_item({k: v for k, v in strong.items() if k != "evidence_confidence"}, 1)
        self.assertEqual(missing["decision"], "validate", "omitted confidence defaults to unknown")

    def test_items_without_basis_or_evidence_ids_are_gated(self):
        strong = {**self.base(), "risk_penalty": 0, **{f: 5 for f in breakthrough.SCORE_FIELDS}}
        for drop in ({"basis": ""}, {"evidence_ids": []}, {"evidence_ids": None}):
            with self.subTest(drop=drop):
                result = breakthrough.score_item({**strong, **drop}, 1)
                self.assertEqual(result["decision"], "validate")
                self.assertIn("evidence_missing", result["gate_reasons"])
        with self.assertRaises(ValueError):
            breakthrough.score_item({**strong, "evidence_ids": "E1"}, 1)

    def test_sorting_puts_decision_tier_before_score(self):
        strong = {**self.base(), "risk_penalty": 0, **{f: 5 for f in breakthrough.SCORE_FIELDS}}
        gated = breakthrough.score_item({**strong, "id": "A", "critical_fact_missing": True}, 1)
        real = breakthrough.score_item({**self.base(), "id": "B"}, 2)
        ordered = sorted([gated, real], key=lambda i: (breakthrough.DECISION_ORDER.index(i["decision"]), -i["adjusted_score"], i["id"]))
        self.assertEqual([i["id"] for i in ordered], ["B", "A"], "supporting 73 ranks above gated validate 100")

    def test_independent_weighted_score(self):
        result = breakthrough.score_item(self.base(), 1)
        self.assertEqual(result["raw_score"], 80)
        self.assertEqual(result["adjusted_score"], 73)
        self.assertEqual(result["decision"], "supporting")

    def test_high_score_cannot_bypass_evidence_or_hard_gate(self):
        for field, expected in [("critical_fact_missing", "validate"),
                                ("high_risk_claim_unmatched", "validate"), ("hard_blocker", "blocked")]:
            result = breakthrough.score_item({**self.base(), field: True, "risk_penalty": 0}, 1)
            self.assertEqual(result["decision"], expected)

    def test_nonfinite_boolean_and_out_of_range_scores_rejected(self):
        for bad in (float("nan"), float("inf"), True, -1, 6):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                breakthrough.score_item({**self.base(), "demand_strength": bad}, 1)
        with self.assertRaises(ValueError):
            breakthrough.score_item({**self.base(), "hard_blocker": "false"}, 1)


def candidate(asin: str, role: str, **overrides):
    dimensions = {
        "intent_match": 4,
        "form_spec_match": 4,
        "price_pack_match": 4,
        "ratings_count_match": 4,
        "star_rating_strength": 4,
        "audience_scenario_match": 4,
        "stage_attainability": 4,
        "market_relevance": 4,
        "evidence_quality": 4,
    }
    base = {
        "asin": asin,
        "source_role": "RESEARCH_ADDED",
        "primary_role": role,
        "roles": [role],
        **dimensions,
        "role_evidence": {
            "basis": f"observed role basis for {role}",
            "evidence_ids": ["E-ROLE"],
        },
        "dimension_evidence": {
            field: {
                "basis": f"observed basis for {field}",
                "evidence_ids": [f"E-{field.upper()}"],
            }
            for field in dimensions
        },
        "identity_evidence": {
            "basis": "ASIN, listing and selected variant were checked",
            "evidence_ids": ["E-IDENTITY"],
        },
        "identity_valid": True,
        "active_listing": True,
        "variant_resolved": True,
    }
    base.update(overrides)
    return base


def peer_bands(**overrides):
    base = {
        "basis": "USER_DEFINED",
        "derivation": "user selected attainable comparison stage",
        "evidence_ids": ["E-PEER-BAND"],
        "price_metric": "effective_price",
        "price_min": 30,
        "price_max": 50,
        "currency": "USD",
        "ratings_count_min": 100,
        "ratings_count_max": 3000,
        "star_rating_min": 4,
    }
    base.update(overrides)
    return base


def snapshot(**overrides):
    base = {
        "effective_price": SAMPLE_IN_BAND_PRICE,
        "currency": "USD",
        "star_rating": 4.5,
        "ratings_count": 800,
        "rating_scope": "PARENT",
        "observed_at": "2026-01-15",
    }
    base.update(overrides)
    return base


class BenchmarkLockingTests(unittest.TestCase):
    def test_unknown_band_currency_cannot_lock_numeric_price_as_core(self) -> None:
        result = benchmark.evaluate({"peer_bands": peer_bands(currency=None), "candidates": [
            candidate("B012345678", "LAUNCH_PEER", snapshot=snapshot())]})
        self.assertEqual(result["competitors"][0]["peer_band_result"]["status"], "UNKNOWN")
        self.assertNotEqual(result["competitors"][0]["lock_status"], "CORE_BENCHMARK")

    def test_invalid_and_future_observation_dates_cannot_lock_core(self) -> None:
        for stamp in ("not-a-date", "2099-01-01", "2026-02-30"):
            with self.subTest(stamp=stamp):
                result = benchmark.evaluate({"peer_bands": peer_bands(), "candidates": [
                    candidate("B012345678", "LAUNCH_PEER", snapshot=snapshot(observed_at=stamp))]})
                self.assertEqual(result["competitors"][0]["peer_band_result"]["status"], "UNKNOWN")

    def test_operating_context_is_preserved_verbatim_without_scoring(self) -> None:
        operating_context = {
            "context_id": "OC-1",
            "profit_objective": {
                "objective_id": "PO-1",
                "minimum_post_ads_contribution_rate": None,
                "contribution_rate_basis": "NET_SALES_REVENUE",
                "target_profit_per_order": None,
            },
            "price_context": {},
            "demand_calendar": {"calendar_id": "CAL-1", "demand_pattern": "UNKNOWN"},
            "supply_routes": [{"route_id": "ROUTE-1", "production_days": None}],
            "replenishment_policy": {"policy_id": "RP-1", "safety_stock_days": None},
            "content_change_control": None,
            "acknowledged_risks": [],
        }
        result = benchmark.evaluate(
            {
                "operating_context": operating_context,
                "competitor_context_updates": [],
                "candidates": [candidate("B012345670", "LAUNCH_PEER")],
            }
        )
        self.assertEqual(result["operating_context"], operating_context)
        self.assertEqual(
            result["operating_context_sha256"],
            benchmark.operating_context_sha256(operating_context),
        )
        self.assertEqual(result["competitor_context_updates"], [])
        self.assertNotIn("profit_objective", result["competitors"][0])

    def test_operating_context_hash_mismatch_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "operating_context_sha256"):
            benchmark.evaluate(
                {
                    "operating_context": {"context_id": "OC-1"},
                    "operating_context_sha256": "sha256:" + "0" * 64,
                    "candidates": [candidate("B012345672", "LAUNCH_PEER")],
                }
            )

    def test_supplied_operating_context_requires_context_id(self) -> None:
        with self.assertRaisesRegex(ValueError, "context_id"):
            benchmark.evaluate(
                {
                    "operating_context": {"demand_calendar": {}},
                    "candidates": [candidate("B012345671", "LAUNCH_PEER")],
                }
            )

    def test_direct_peer_becomes_core(self) -> None:
        result = benchmark.evaluate({"candidates": [candidate("B012345678", "LAUNCH_PEER")]})
        item = result["competitors"][0]
        self.assertEqual(item["lock_status"], "CORE_BENCHMARK")
        self.assertEqual(item["research_depth"], "DEEP")
        self.assertEqual(item["keyword_acquisition_scope"], "FULL_TRAFFIC")

    def test_leader_is_boundary_not_core(self) -> None:
        result = benchmark.evaluate({"candidates": [candidate("B012345679", "LEADER")]})
        self.assertEqual(result["competitors"][0]["lock_status"], "BOUNDARY_REFERENCE")

    def test_adjacent_user_asin_keeps_full_keyword_scope(self) -> None:
        result = benchmark.evaluate(
            {
                "candidates": [
                    candidate(
                        "B012345680",
                        "ADJACENT_ALTERNATIVE",
                        source_role="USER_SUPPLIED",
                    )
                ]
            }
        )
        item = result["competitors"][0]
        self.assertEqual(item["lock_status"], "CONTEXT_ONLY")
        self.assertEqual(item["keyword_acquisition_scope"], "FULL_TRAFFIC")

    def test_unresolved_variant_is_pending(self) -> None:
        result = benchmark.evaluate(
            {"candidates": [candidate("B012345681", "DIRECT_PRICE_FORM", variant_resolved=False)]}
        )
        item = result["competitors"][0]
        self.assertEqual(item["lock_status"], "IDENTITY_PENDING")
        self.assertIsNone(item["score"])

    def test_invalid_identity_needs_no_fake_role_or_score(self) -> None:
        result = benchmark.evaluate(
            {
                "candidates": [
                    {
                        "asin": "B012345683",
                        "source_role": "USER_SUPPLIED",
                        "identity_valid": False,
                        "active_listing": False,
                        "variant_resolved": False,
                        "identity_evidence": {
                            "basis": "ASIN identity check failed",
                            "evidence_ids": ["E-IDENTITY"],
                        },
                    }
                ]
            }
        )
        item = result["competitors"][0]
        self.assertEqual(item["lock_status"], "EXCLUDED_INVALID")
        self.assertIsNone(item["score"])
        self.assertIsNone(item.get("primary_role"))
        self.assertEqual(item["roles"], [])
        self.assertEqual(item["keyword_acquisition_scope"], "NO_QUERY")
        self.assertEqual(item["evidence_ids"], ["E-IDENTITY"])
        markdown = benchmark.render_markdown(result)
        self.assertIn("B012345683", markdown)
        self.assertIn("EXCLUDED_INVALID", markdown)

    def test_bare_scores_without_evidence_are_rejected(self) -> None:
        item = candidate("B012345684", "LAUNCH_PEER")
        item.pop("dimension_evidence")
        with self.assertRaisesRegex(ValueError, "dimension_evidence"):
            benchmark.evaluate({"candidates": [item]})

    def test_evidence_ids_are_aggregated_for_handoff(self) -> None:
        result = benchmark.evaluate({"candidates": [candidate("B012345685", "LAUNCH_PEER")]})
        evidence_ids = result["competitors"][0]["evidence_ids"]
        self.assertIn("E-ROLE", evidence_ids)
        self.assertIn("E-INTENT_MATCH", evidence_ids)

    def test_price_and_ratings_peer_band_can_define_core_group(self) -> None:
        result = benchmark.evaluate(
            {
                "peer_bands": peer_bands(),
                "candidates": [candidate("B012345686", "LAUNCH_PEER", snapshot=snapshot())],
            }
        )
        item = result["competitors"][0]
        self.assertEqual(item["peer_band_result"]["status"], "IN_BAND")
        self.assertEqual(item["lock_status"], "CORE_BENCHMARK")
        self.assertIn("E-PEER-BAND", item["evidence_ids"])

    def test_ratings_count_above_attainable_band_becomes_boundary(self) -> None:
        result = benchmark.evaluate(
            {
                "peer_bands": peer_bands(),
                "candidates": [
                    candidate(
                        "B012345687",
                        "LAUNCH_PEER",
                        snapshot=snapshot(ratings_count=18000),
                    )
                ],
            }
        )
        item = result["competitors"][0]
        self.assertTrue(item["peer_band_result"]["trust_barrier"])
        self.assertEqual(item["lock_status"], "BOUNDARY_REFERENCE")

    def test_price_outside_peer_band_cannot_enter_core(self) -> None:
        result = benchmark.evaluate(
            {
                "peer_bands": peer_bands(),
                "candidates": [
                    candidate(
                        "B012345688",
                        "DIRECT_PRICE_FORM",
                        snapshot=snapshot(effective_price=SAMPLE_OUT_OF_BAND_PRICE),
                    )
                ],
            }
        )
        item = result["competitors"][0]
        self.assertEqual(item["peer_band_result"]["status"], "OUTSIDE_BAND")
        self.assertEqual(item["lock_status"], "KEYWORD_SOURCE_ONLY")

    def test_missing_ratings_are_unknown_not_zero(self) -> None:
        current_snapshot = snapshot()
        current_snapshot.pop("ratings_count")
        result = benchmark.evaluate(
            {
                "peer_bands": peer_bands(),
                "candidates": [
                    candidate("B012345689", "LAUNCH_PEER", snapshot=current_snapshot)
                ],
            }
        )
        item = result["competitors"][0]
        self.assertEqual(item["peer_band_result"]["status"], "UNKNOWN")
        self.assertFalse(item["peer_band_result"]["core_eligible"])
        self.assertEqual(item["lock_status"], "KEYWORD_SOURCE_ONLY")

    def test_unknown_rating_scope_cannot_create_a_barrier_or_core_peer(self) -> None:
        result = benchmark.evaluate(
            {
                "peer_bands": peer_bands(),
                "candidates": [
                    candidate(
                        "B012345691",
                        "LAUNCH_PEER",
                        snapshot=snapshot(ratings_count=18000, rating_scope="UNKNOWN"),
                    )
                ],
            }
        )
        item = result["competitors"][0]
        self.assertEqual(item["peer_band_result"]["status"], "UNKNOWN")
        self.assertFalse(item["peer_band_result"]["trust_barrier"])
        self.assertEqual(item["lock_status"], "KEYWORD_SOURCE_ONLY")

    def test_rating_count_boundaries_must_be_whole_numbers(self) -> None:
        with self.assertRaisesRegex(ValueError, "whole number"):
            benchmark.evaluate(
                {
                    "peer_bands": peer_bands(ratings_count_max=3000.5),
                    "candidates": [
                        candidate("B012345692", "LAUNCH_PEER", snapshot=snapshot())
                    ],
                }
            )

    def test_scoring_weights_are_explicitly_overridable(self) -> None:
        weights = dict(benchmark.WEIGHTS)
        weights["intent_match"] -= 0.05
        weights["ratings_count_match"] += 0.05
        result = benchmark.evaluate(
            {
                "weights": weights,
                "candidates": [candidate("B012345693", "LAUNCH_PEER")],
            }
        )
        self.assertEqual(result["weights"], weights)

    def test_low_rating_count_match_score_cannot_enter_core(self) -> None:
        item = candidate("B012345690", "LAUNCH_PEER")
        for field in benchmark.WEIGHTS:
            item[field] = 5
        item["ratings_count_match"] = 1
        result = benchmark.evaluate(
            {"candidates": [item]}
        )
        scored = result["competitors"][0]
        self.assertGreaterEqual(scored["score"], result["thresholds"]["core_min"])
        self.assertNotEqual(scored["lock_status"], "CORE_BENCHMARK")

    def test_duplicate_asins_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unique"):
            benchmark.evaluate(
                {
                    "candidates": [
                        candidate("B012345682", "LAUNCH_PEER"),
                        candidate("b012345682", "LEADER"),
                    ]
                }
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
