#!/usr/bin/env python3
"""Regression tests for Amazon advertising economics and strategy validation."""

from __future__ import annotations

import copy
import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


SCRIPT_DIR = Path(__file__).resolve().parent
FIXTURE_NOW = datetime.now(timezone.utc).replace(microsecond=0)
FIXTURE_CAPTURED = FIXTURE_NOW - timedelta(minutes=10)
FIXTURE_AUTHORIZED = FIXTURE_NOW - timedelta(minutes=5)
FIXTURE_REPORT_GENERATED = FIXTURE_CAPTURED - timedelta(hours=1)


def iso(moment: datetime) -> str:
    return moment.isoformat()


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


economics = load_module("amazon_ad_economics", SCRIPT_DIR / "calculate_ad_economics.py")
validator = load_module("amazon_ad_strategy_validator", SCRIPT_DIR / "validate_ad_strategy_package.py")


def blank_economics() -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "base",
        "marketplace": "US",
        "currency": "USD",
        "scope_id": "SKU-001",
        "data_mode": "NEW_PRODUCT",
        "selling_price": 100,
        "price_includes_tax": False,
        "tax_rate": 0,
        "fees_verified": True,
        "costs_verified": True,
        "tax_basis_verified": True,
        "referral_fee": 0,
        "returns_mode": "NONE",
        "net_sales_already_refund_adjusted": False,
        "allow_revenue_proxy": False,
        "ad_attributed_sales_per_order": 100,
        "attributed_sales_data_class": "ESTIMATED",
        "attributed_sales_scope": "PROMOTED",
        "conversion_rate": 0.10,
        "conversion_data_class": "ESTIMATED",
        "vine_units": 0,
        "planned_orders": 100,
        "planned_ad_attributed_orders": 50,
        "sellable_inventory": 1000,
        "vine_reserved_units": 0,
        "safety_stock_units": 100,
        "other_locked_units": 0,
        "forecast_daily_total_orders": 10,
        "replenishment_lead_days": 30,
        "inbound_buffer_days": 5,
    }
    for field in economics.OPTIONAL_MONEY_FIELDS:
        payload[field] = 0
    return payload


def exact_economics() -> dict[str, Any]:
    payload = blank_economics()
    payload.update(
        {
            "seller_funded_discount": 10,
            "coupon_discount_per_order": 5,
            "referral_fee": 15,
            "cogs": 20,
            "packaging": 5,
            "fulfillment_fee": 5,
            "storage": 1,
            "other_amazon_fees": 1,
            "returns_mode": "ALLOWANCE_AMOUNT",
            "expected_refund_revenue_loss": 8.50,
            "return_nonrevenue_cost": 0,
            "ad_attributed_sales_per_order": 90,
            "target_profit_per_order": 10,
        }
    )
    return payload


def valid_strategy(existing: bool = False) -> dict[str, Any]:
    base_econ_input = exact_economics()
    if existing:
        base_econ_input.update(
            {
                "data_mode": "EXISTING_PRODUCT",
                "attributed_sales_data_class": "ACTUAL",
                "actual_impressions": 1000,
                "actual_clicks": 50,
                "actual_attributed_orders": 5,
                "actual_ad_spend": 90,
                "actual_ad_attributed_sales": 450,
                "actual_total_sales": 900,
                "actual_attributed_contribution_total": 147.5,
                "actual_total_contribution_before_ads": 295,
                "attribution_status": "COMPLETE",
            }
        )
        econ_input: dict[str, Any] = base_econ_input
        calc: dict[str, Any] = economics.calculate(econ_input)
        binding_scenario_name = None
    else:
        scenario_inputs = []
        for name, cvr in (("PESSIMISTIC", 0.08), ("BASE", 0.10), ("OPTIMISTIC", 0.12)):
            scenario = copy.deepcopy(base_econ_input)
            scenario.update({"name": name, "scenario_role": name, "scenario_confidence": "MEDIUM", "scenario_source_ids": ["SRC-CONVERSION-001"], "conversion_rate": cvr})
            scenario_inputs.append(scenario)
        econ_input = {"common": {}, "scenarios": scenario_inputs}
        calc = {"scenarios": [economics.calculate(item) for item in scenario_inputs]}
        binding_scenario_name = "BASE"
    stable = {
        "project_id": "PROJECT-001",
        "selection_run_id": "SELECT-001",
        "candidate_id": "CAND-001",
        "competitor_lock_run_id": "LOCK-001",
        "keyword_run_id": "KEYWORDS-001",
        "listing_run_id": "LISTING-001",
        "listing_version_id": "LISTING-001-V1",
    }
    phases = []
    states = (
        ["AUDITING", "DIAGNOSING", "TESTING", "SCALING", "TRANSITIONING"]
        if existing
        else ["PREPARED", "LEARNING", "VALIDATING", "SCALING", "TRANSITIONING"]
    )
    for index, state in enumerate(states, start=1):
        phases.append(
            {
                "phase_id": f"PH-{index:03d}",
                "state": state,
                "objective": f"Objective for {state}",
                "entry_gates": ["entry evidence"],
                "planned_actions": ["plan-only action"],
                "data_sufficiency_rule_ids": ["DR-001"],
                "attribution_completion_requirement": "verified runtime window",
                "phase_spend_cap": 100,
                "inventory_floor": 100,
                "exit_gates": ["exit evidence"],
                "rollback_conditions": ["economics or inventory failure"],
                "next_states": [] if state == "TRANSITIONING" else [states[index]],
            }
        )
    package: dict[str, Any] = {
        "contract_version": "1.0",
        "lineage_mode": "FULL_WORKFLOW",
        "strategy_mode": "EXISTING_PRODUCT_OPTIMIZATION" if existing else "NEW_PRODUCT_LAUNCH",
        "deliverable_mode": "PLAN",
        "execution_authority": "PLAN_ONLY",
        **stable,
        "ad_economics_run_id": "ECON-001",
        "ad_strategy_run_id": "ADS-001",
        "ad_strategy_version_id": "ADS-001-V1",
        "id_aliases": [
            {
                "canonical_field": "selection_run_id",
                "source_artifact": "handoff.json",
                "source_field": "run_id",
                "source_value": "SELECT-001",
                "verified_same_identity": True,
            }
        ],
        "source_artifacts": [
            {
                "source_artifact_id": "SRC-SELECT-001",
                "artifact_type": "selection_handoff",
                "path_or_url": "handoff.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
                "data_class": "VERIFIED_PRODUCT",
            },
            {
                "source_artifact_id": "SRC-LIST-001",
                "artifact_type": "listing_release",
                "path_or_url": "listing_release.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
                "data_class": "VERIFIED_PRODUCT",
            },
            {
                "source_artifact_id": "SRC-COMP-001",
                "artifact_type": "competitor_lock",
                "path_or_url": "competitor_lock.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
                "data_class": "ESTIMATED",
                "evidence_domains": ["PRODUCT_TARGET_EVIDENCE"],
                "asin_scope_ids": ["B098765432"],
            },
            {
                "source_artifact_id": "SRC-KW-001",
                "artifact_type": "keyword_library",
                "path_or_url": "keyword_library.xlsx",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:4444444444444444444444444444444444444444444444444444444444444444",
                "data_class": "ESTIMATED",
                "evidence_domains": ["KEYWORD_TARGET_EVIDENCE"],
                "keyword_scope_ids": ["KW-001"],
            },
            {
                "source_artifact_id": "SRC-ECON-001",
                "artifact_type": "seller_economics_input_snapshot",
                "path_or_url": "seller_economics_input_snapshot.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                "data_class": "SELLER_CONFIRMED",
                "marketplace": "US",
                "currency": "USD",
                "account_id_masked": "***001",
                "scope_id": "SKU-001",
                "window_start": (FIXTURE_REPORT_GENERATED.date() - timedelta(days=30)).isoformat(),
                "window_end": FIXTURE_REPORT_GENERATED.date().isoformat(),
                "data_through_date": FIXTURE_REPORT_GENERATED.date().isoformat(),
                "evidence_domains": ["OFFER_AND_REVENUE", "AMAZON_FEES_AND_TAX", "PRODUCT_COSTS_AND_RETURNS", "INVENTORY", "ONSITE_PRICE", "ONSITE_PROMOTION"],
            },
            {
                "source_artifact_id": "SRC-CONVERSION-001",
                "artifact_type": "market_conversion_benchmark",
                "path_or_url": "market_conversion_benchmark.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                "data_class": "ESTIMATED",
                "marketplace": "US",
                "currency": "USD",
                "scope_id": "SKU-001",
                "evidence_domains": ["CONVERSION_RATE", "ATTRIBUTED_REVENUE"],
            },
            {
                "source_artifact_id": "SRC-VINE-001",
                "artifact_type": "amazon_vine_eligibility_snapshot",
                "path_or_url": "amazon_vine_eligibility_snapshot.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                "data_class": "FIRST_PARTY",
                "marketplace": "US",
                "currency": "USD",
                "account_id_masked": "***001",
                "scope_id": "SKU-001",
                "evidence_domains": ["VINE_ELIGIBILITY"],
            },
            {
                "source_artifact_id": "SRC-PLACEMENT-001",
                "artifact_type": "official_policy",
                "path_or_url": "https://advertising.amazon.com/help/GYTD2Z3SYMAAMVXA",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:5555555555555555555555555555555555555555555555555555555555555555",
                "data_class": "OFFICIAL_POLICY",
                "marketplace": "GLOBAL",
                "ad_products": ["SPONSORED_PRODUCTS"],
                "policy_domains": ["PLACEMENT_SCOPE"],
            },
            {
                "source_artifact_id": "SRC-ATTRIBUTION-001",
                "artifact_type": "official_policy",
                "path_or_url": "https://advertising.amazon.com/help/attribution-fixture",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:9999999999999999999999999999999999999999999999999999999999999999",
                "data_class": "OFFICIAL_POLICY",
                "marketplace": "GLOBAL",
                "policy_domains": ["ATTRIBUTION_SCHEMA"],
                "attribution_windows": ["runtime-verified"],
            },
            {
                "source_artifact_id": "SRC-REVIEW-POLICY-001",
                "artifact_type": "official_policy",
                "path_or_url": "https://sellercentral.amazon.com/help/review-policy-fixture",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "data_class": "OFFICIAL_POLICY",
                "marketplace": "GLOBAL",
                "policy_domains": ["REVIEW_METHOD_COMPLIANCE"],
            },
            {
                "source_artifact_id": "SRC-APPROVAL-001",
                "artifact_type": "seller_budget_approval",
                "path_or_url": "seller_budget_approval.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:6666666666666666666666666666666666666666666666666666666666666666",
                "data_class": "SELLER_CONFIRMED",
                "marketplace": "US",
                "currency": "USD",
                "account_id_masked": "***001",
            },
            {
                "source_artifact_id": "SRC-INVENTORY-001",
                "artifact_type": "seller_inventory_snapshot",
                "path_or_url": "inventory_snapshot.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:7777777777777777777777777777777777777777777777777777777777777777",
                "data_class": "FIRST_PARTY",
                "marketplace": "US",
                "account_id_masked": "***001",
                "evidence_domains": ["INVENTORY"],
            },
            {
                "source_artifact_id": "SRC-ACCOUNT-001",
                "artifact_type": "amazon_ads_account_snapshot",
                "path_or_url": "amazon_ads_account_snapshot.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "data_class": "FIRST_PARTY",
                "marketplace": "US",
                "currency": "USD",
                "account_id_masked": "***001",
                "scope_id": "SKU-001",
                "ad_products": ["SPONSORED_PRODUCTS"],
                "onsite_only_controls": {"SPONSORED_PRODUCTS": "VERIFIED_CURRENT"},
            },
            {
                "source_artifact_id": "SRC-ADS-001",
                "artifact_type": "amazon_ads_report",
                "path_or_url": "amazon_ads_report.csv",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:8888888888888888888888888888888888888888888888888888888888888888",
                "data_class": "FIRST_PARTY",
                "marketplace": "US",
                "currency": "USD",
                "account_id_masked": "***001",
                "scope_id": "SKU-001",
                "evidence_domains": ["CONVERSION_RATE", "ATTRIBUTED_REVENUE", "KEYWORD_TARGET_EVIDENCE", "PRODUCT_TARGET_EVIDENCE"],
                "attribution_windows": ["runtime-verified"],
                "window_start": (FIXTURE_REPORT_GENERATED.date() - timedelta(days=30)).isoformat(),
                "window_end": FIXTURE_REPORT_GENERATED.date().isoformat(),
                "data_through_date": FIXTURE_REPORT_GENERATED.date().isoformat(),
                "report_status": "COMPLETED",
                "attribution_status": "COMPLETE",
                "keyword_scope_ids": ["KW-001"],
                "asin_scope_ids": ["B012345678"],
            },
            {
                "source_artifact_id": "SRC-BUSINESS-001",
                "artifact_type": "amazon_business_report",
                "path_or_url": "amazon_business_report.csv",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "data_class": "FIRST_PARTY",
                "marketplace": "US",
                "currency": "USD",
                "account_id_masked": "***001",
                "scope_id": "SKU-001",
                "window_start": (FIXTURE_REPORT_GENERATED.date() - timedelta(days=30)).isoformat(),
                "window_end": FIXTURE_REPORT_GENERATED.date().isoformat(),
                "data_through_date": FIXTURE_REPORT_GENERATED.date().isoformat(),
                "business_metrics": {"actual_total_sales": 900},
            },
            {
                "source_artifact_id": "SRC-CONTRIBUTION-001",
                "artifact_type": "auditable_contribution_normalization_snapshot",
                "path_or_url": "auditable_contribution_normalization_snapshot.json",
                "version_or_captured_at": iso(FIXTURE_CAPTURED),
                "sha256": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                "data_class": "SELLER_CONFIRMED",
                "marketplace": "US",
                "currency": "USD",
                "account_id_masked": "***001",
                "scope_id": "SKU-001",
                "window_start": (FIXTURE_REPORT_GENERATED.date() - timedelta(days=30)).isoformat(),
                "window_end": FIXTURE_REPORT_GENERATED.date().isoformat(),
                "data_through_date": FIXTURE_REPORT_GENERATED.date().isoformat(),
                "business_metrics": {
                    "actual_attributed_contribution_total": 147.5,
                    "actual_total_contribution_before_ads": 295,
                },
                "normalization_formula": "exact-period attributed and total orders multiplied by verified per-order contribution",
                "derived_source_ids": ["SRC-ADS-001", "SRC-BUSINESS-001", "SRC-ECON-001"],
            },
        ],
        "marketplace": "US",
        "currency": "USD",
        "timezone": "America/Los_Angeles",
        "captured_at": iso(FIXTURE_CAPTURED),
        "scope": {
            "account_id_masked": "***001",
            "asin": "B012345678",
            "sku": "SKU-001",
            "offer_scope": "one sellable two-pack offer",
        },
        "operating_context": {
            "context_id": "CTX-001",
            "profit_objective": {
                "objective": "MAXIMIZE_TOTAL_CONTRIBUTION_PROFIT",
                "minimum_post_ads_contribution_rate": None,
                "target_profit_per_order": 10,
                "risk_buffer_per_order": 0,
                "contribution_rate_basis": "NET_SALES_REVENUE",
                "evidence_ids": ["SRC-ECON-001"],
            },
            "price_context": {
                "current_observed": {
                    "amount": 85,
                    "currency": "USD",
                    "observed_at": iso(FIXTURE_CAPTURED),
                    "verification_status": "OBSERVED",
                    "evidence_ids": ["SRC-ECON-001"],
                },
                "planned_phases": [],
            },
            "demand_calendar": {"demand_pattern": "UNKNOWN"},
            "seasonality_context": {"classification": "UNKNOWN", "current_phase": "UNKNOWN"},
            "supply_routes": [],
            "replenishment_policy": {"safety_stock_days": 10},
            "content_change_control": None,
            "acknowledged_risks": [],
        },
        "upstream_snapshots": {
            "selection": {
                "project_id": "PROJECT-001",
                "run_id": "SELECT-001",
                "candidate_id": "CAND-001",
                "operating_context_id": "CTX-001",
                "source_artifact_ids": ["SRC-SELECT-001"],
            },
            "competitor_lock": {
                "project_id": "PROJECT-001",
                "candidate_id": "CAND-001",
                "competitor_lock_run_id": "LOCK-001",
                "operating_context_id": "CTX-001",
                "source_artifact_ids": ["SRC-COMP-001"],
                "competitors": [
                    {
                        "asin": "B098765432",
                        "source_role": "USER_SUPPLIED",
                        "primary_role": "LAUNCH_PEER",
                        "roles": ["LAUNCH_PEER", "DIRECT_PRICE_FORM"],
                        "lock_status": "CORE_BENCHMARK",
                        "source_order": 1,
                    }
                ],
            },
            "keyword_library": {
                "project_id": "PROJECT-001",
                "candidate_id": "CAND-001",
                "keyword_run_id": "KEYWORDS-001",
                "operating_context_id": "CTX-001",
                "source_artifact_ids": ["SRC-KW-001"],
                "keywords": [
                    {
                        "source_keyword_id": "KW-001",
                        "keyword_original": "portable cable organizer",
                        "library_role": "CORE_VERIFIED",
                        "source_ids": ["SRC-KW-001"],
                        "evidence_ids": ["E-KW-001"],
                    }
                ],
            },
            "listing_release": {
                "status": "READY",
                "integrity_status": "VERIFIED",
                "project_id": "PROJECT-001",
                "candidate_id": "CAND-001",
                "listing_run_id": "LISTING-001",
                "listing_version_id": "LISTING-001-V1",
                "operating_context_id": "CTX-001",
                "path": "listing_release.json",
                "captured_at": iso(FIXTURE_CAPTURED),
                "source_artifact_ids": ["SRC-LIST-001"],
                "sha256": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
            }
        },
        "policy_snapshot": {
            "verified": True,
            "verified_at": iso(FIXTURE_CAPTURED),
            "sources": ["SRC-PLACEMENT-001", "SRC-ATTRIBUTION-001", "SRC-REVIEW-POLICY-001", "SRC-ACCOUNT-001"],
            "placement_scope_verified": "VERIFIED_CURRENT",
            "attribution_schema_verified": "VERIFIED_CURRENT",
            "review_method_compliance_verified": "VERIFIED_CURRENT",
            "unverified_boundaries": [],
        },
        "account_snapshot": {
            "captured_at": iso(FIXTURE_CAPTURED),
            "read_only": True,
            "ad_products": {"SPONSORED_PRODUCTS": "ELIGIBLE"},
            "onsite_only_controls": {"SPONSORED_PRODUCTS": "VERIFIED_CURRENT"},
            "featured_offer_or_current_equivalent": "ELIGIBLE",
            "advertising_eligibility": "ELIGIBLE",
        },
        "economics": {
            "input_snapshot": econ_input,
            "calculator_result": calc,
            "binding_scenario_name": binding_scenario_name,
            "input_evidence_source_ids": ["SRC-ECON-001"],
            "performance_snapshot_ids": ["PS-001"] if existing else [],
            "actual_business_source_ids": ["SRC-BUSINESS-001", "SRC-CONTRIBUTION-001"] if existing else [],
            "performance_basis": ({
                "ad_products": ["SPONSORED_PRODUCTS"],
                "charge_type": "CPC",
                "interaction_scope": "CLICK",
                "sales_scope": "PROMOTED",
                "entity_scope": "target",
                "attribution_window": "runtime-verified",
            } if existing else {}),
            "approved_cash_exposure": 1000,
            "approved_cash_exposure_source_id": "SRC-APPROVAL-001",
            "strategy_total_spend_cap": 500,
            "strategy_total_spend_cap_source_id": "SRC-APPROVAL-001",
            "approved_learning_loss_envelopes": [],
        },
        "inventory": {
            "captured_at": iso(FIXTURE_CAPTURED),
            "sellable_units": 1000,
            "reserved_units": 0,
            "safety_stock_units": 100,
            "lead_time_days": 30,
            "lead_time_components": {
                "selected_route_id": "ROUTE-BASE-001",
                "order_quantity": 1000,
                "production_days": 10,
                "qc_and_prep_days": 2,
                "transit_days": 10,
                "customs_or_local_delivery_days": 3,
                "fba_receiving_days": 5,
                "risk_buffer_days": 5,
                "base_lead_days": 30,
                "source_artifact_ids": ["SRC-INVENTORY-001"],
            },
            "reserved_breakdown": {"vine_units": 0, "other_locked_units": 0, "other_reserved_units": 0},
            "replenishment_policy": {"safety_stock_days": 10},
            "reorder_state": "AVAILABLE",
            "stockout_risk": "LOW",
            "source_artifact_ids": ["SRC-INVENTORY-001"],
        },
        "onsite_support": {
            "economics_application": "BINDING",
            "effective_price": {"amount": 85, "currency": "USD", "price_includes_tax": False, "source_artifact_ids": ["SRC-ECON-001"]},
            "coupons_or_deals": [
                {
                    "support_id": "CPN-001",
                    "support_type": "COUPON",
                    "status": "PLANNED",
                    "economics_application": "BINDING",
                    "economic_discount_per_modeled_order": 5,
                    "fee_per_modeled_order": 0,
                    "fixed_fee": 0,
                    "planned_redemptions": 100,
                    "source_artifact_ids": ["SRC-ECON-001"],
                }
            ],
            "vine": {
                "economics_application": "NOT_USED",
                "eligibility": "NOT_USED",
                "planned_units": 0,
                "reserved_units": 0,
                "enrollment_fee": 0,
                "unit_landed_cost": 0,
                "unit_fulfillment_cost": 0,
                "source_artifact_ids": [],
            },
            "request_a_review": {"eligibility": "NOT_USED"},
            "cost_ledger": {
                "ppc": {"currency": "USD", "planned_spend": 0},
                "discount": {"currency": "USD", "price_discount_per_order": 10},
                "coupon_or_deal": {"currency": "USD", "discount_per_order": 5, "variable_fee_per_order": 0, "fixed_fee": 0},
                "vine": {"currency": "USD", "planned_units": 0, "reserved_units": 0, "enrollment_fee": 0, "unit_landed_cost": 0, "unit_fulfillment_cost": 0},
                "inventory_and_cash": {"currency": "USD", "reserved_units": 0, "safety_stock_units": 100, "approved_cash_exposure": 1000, "strategy_total_spend_cap": 500},
            },
        },
        "performance_snapshots": (
            [
                {
                    "performance_snapshot_id": "PS-001",
                    "data_class": "FIRST_PARTY",
                    "source_artifact_ids": ["SRC-ADS-001"],
                    "marketplace": "US",
                    "currency": "USD",
                    "scope_id": "SKU-001",
                    "ad_product": "SPONSORED_PRODUCTS",
                    "charge_type": "CPC",
                    "window_start": (FIXTURE_REPORT_GENERATED.date() - timedelta(days=30)).isoformat(),
                    "window_end": FIXTURE_REPORT_GENERATED.date().isoformat(),
                    "report_generated_at": iso(FIXTURE_REPORT_GENERATED),
                    "data_through_date": FIXTURE_REPORT_GENERATED.date().isoformat(),
                    "attribution_status": "COMPLETE",
                    "attribution_window": "runtime-verified",
                    "interaction_scope": "CLICK",
                    "sales_scope": "PROMOTED",
                    "entity_scope": "target",
                    "metrics": {"impressions": 1000, "clicks": 50, "orders": 5, "spend": 90, "attributed_sales": 450},
                    "events_in_window": [],
                    "coverage_gaps": [],
                }
            ]
            if existing
            else []
        ),
        "keyword_targets": [
            {
                "ad_target_id": "AT-KW-001",
                "source_keyword_id": "KW-001",
                "keyword_original": "portable cable organizer",
                "library_role": "CORE_VERIFIED",
                "ad_role": "CORE_TEST",
                "ad_decision": "INCLUDE",
                "product_fit": "DIRECT",
                "intent": "product",
                "data_class": "ESTIMATED" if not existing else "FIRST_PARTY",
                "source_ids": ["SRC-KW-001", "SRC-ADS-001"] if existing else ["SRC-KW-001"],
                "evidence_ids": ["E-KW-001"],
                "objective": "core validation",
                "targeting_expression": "EXACT",
                "proposed_bid": 1.50,
                "bid_ceiling": 1.95,
                "ceiling_basis": "TARGET_PROFIT",
                "learning_loss_envelope_id": None,
                "negative_routing": [],
                "decision_reason": "direct fit within target-profit ceiling",
            }
        ],
        "product_targets": [
            {
                "ad_target_id": "AT-ASIN-001",
                "asin": "B098765432",
                "competitor_source_role": "USER_SUPPLIED",
                "competitor_primary_role": "LAUNCH_PEER",
                "competitor_roles": ["LAUNCH_PEER", "DIRECT_PRICE_FORM"],
                "competitor_lock_status": "CORE_BENCHMARK",
                "source_order": 1,
                "ad_role": "OBSERVE",
                "ad_decision": "OBSERVE",
                "data_class": "ESTIMATED",
                "decision_reason": "preserved locked competitor; no positive product-target release yet",
                "source_ids": ["SRC-COMP-001"],
                "evidence_ids": ["E-ASIN-001"],
                "proposed_bid": None,
                "bid_ceiling": None,
                "ceiling_basis": "UNAVAILABLE",
            }
        ],
        "campaign_architecture": [
            {
                "campaign_plan_id": "CP-001",
                "ad_product": "SPONSORED_PRODUCTS",
                "objective": "CORE_VALIDATION",
                "targeting_type": "MANUAL_KEYWORD",
                "source_ad_target_ids": ["AT-KW-001"],
                "onsite_scope": "AMAZON_ONLY",
                "placement_scope_verified": "VERIFIED_CURRENT",
                "placement_policy_source_id": "SRC-PLACEMENT-001",
                "placement_account_source_id": "SRC-ACCOUNT-001",
                "placement_verified_at": iso(FIXTURE_CAPTURED),
                "budget_period": "DAILY",
                "proposed_budget": 10,
                "phase_spend_cap": 100,
                "learning_loss_allocations": {},
                "bid_strategy": "runtime-verified setting",
                "entry_gates": ["listing and economics ready"],
                "exit_gates": ["decision evidence complete"],
                "rollback_conditions": ["loss or inventory gate"],
                "negative_routing_rule_ids": [],
                "evidence_ids": ["E-KW-001"],
            }
        ],
        "routing_rules": [],
        "phase_plan": phases,
        "decision_rules": [
            {
                "decision_rule_id": "DR-001",
                "scope": "target",
                "metric_definition": "source-qualified conversion and contribution",
                "source_snapshot_ids": ["PS-001"] if existing else [],
                "attribution_requirement": "COMPLETE",
                "minimum_evidence": "runtime-derived from CVR and uncertainty",
                "financial_ceiling": "target CPC and approved spend cap",
                "condition": "evidence gate reached",
                "proposed_action": "keep observe or change proposal",
                "rollback_condition": "economics or inventory violation",
            }
        ],
        "review_compliance": {
            "review_manipulation_excluded": True,
            "prohibited_methods_present": False,
            "methods": ["NONE"],
        },
        "handbacks": [],
        "change_manifest": [],
        "source_coverage": {"gaps": []},
        "unknowns": [],
        "strategy_status": "PLAN_READY",
    }
    context_hash = validator.operating_context_sha256(package["operating_context"])
    package["operating_context_sha256"] = context_hash
    for snapshot in package["upstream_snapshots"].values():
        snapshot["operating_context_sha256"] = context_hash
    return package


def finding_codes(result: dict[str, Any]) -> set[str]:
    return {row["code"] for row in result["findings"]}


def package_binding_result(package: dict[str, Any]) -> dict[str, Any]:
    result = package["economics"]["calculator_result"]
    if "scenarios" not in result:
        return result
    binding = package["economics"]["binding_scenario_name"]
    return next(row for row in result["scenarios"] if row["name"] == binding)


def recalculate_package_economics(package: dict[str, Any]) -> None:
    payload = package["economics"]["input_snapshot"]
    if "scenarios" in payload:
        expanded = economics.expand_scenarios(payload)
        package["economics"]["calculator_result"] = {"scenarios": [economics.calculate(row) for row in expanded]}
    else:
        package["economics"]["calculator_result"] = economics.calculate(payload)


def prepared_ad_operation(execution_status: str) -> dict[str, Any]:
    return {
        "operation_id": "OP-001",
        "action": "UPDATE",
        "change_domain": "AMAZON_ADS",
        "campaign_plan_id": "CP-001",
        "entity_type": "TARGET",
        "entity_id": "TARGET-001",
        "payload_schema_version": "AMAZON_ADS_NORMALIZED_V1",
        "current_value": {"bid": 1.0},
        "proposed_value": {"bid": 1.2},
        "rollback_action": "restore bid to 1.0",
        "execution_status": execution_status,
        "prechange_snapshot_id": "SRC-ACCOUNT-001",
        "prechange_snapshot_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "prechange_captured_at": iso(FIXTURE_CAPTURED),
        "onsite_scope_after": "AMAZON_ONLY",
        "placement_scope_effect": "UNCHANGED_AMAZON_ONLY",
        "amazon_only_control_before": True,
        "amazon_only_control_after": True,
    }


def authorized_strategy(operation: dict[str, Any] | None = None, confirmed_at: str | None = None) -> dict[str, Any]:
    package = valid_strategy()
    package["strategy_status"] = "EXECUTION_AUTHORIZED"
    package["deliverable_mode"] = "EXECUTE"
    package["execution_authority"] = "EXECUTION_AUTHORIZED"
    package["change_manifest"] = [operation or prepared_ad_operation("NOT_STARTED")]
    package["authorization_record"] = {
        "user_confirmed": True,
        "confirmed_at": confirmed_at or iso(FIXTURE_AUTHORIZED),
        "account_id_masked": "***001",
        "marketplace": "US",
        "manifest_hash": validator.manifest_hash(package["change_manifest"]),
        "prechange_snapshot_hash": package["change_manifest"][0]["prechange_snapshot_hash"],
        "allowed_operation_ids": [row["operation_id"] for row in package["change_manifest"]],
    }
    return package


def configure_vine(package: dict[str, Any], units: int, reserved_units: int, active_method: bool) -> None:
    scenarios = package["economics"]["input_snapshot"].get("scenarios")
    rows = scenarios if isinstance(scenarios, list) else [package["economics"]["input_snapshot"]]
    for row in rows:
        row.update(
            {
                "vine_units": units,
                "vine_reserved_units": reserved_units,
                "vine_enrollment_fee": 0,
                "vine_unit_landed_cost": 10,
                "vine_unit_fulfillment_cost": 5,
            }
        )
    recalculate_package_economics(package)
    package["inventory"]["reserved_units"] = reserved_units
    package["inventory"]["reserved_breakdown"] = {"vine_units": reserved_units, "other_locked_units": 0, "other_reserved_units": 0}
    package["onsite_support"]["vine"] = {
        "economics_application": "BINDING" if active_method else "NOT_USED",
        "eligibility": "VERIFIED_ELIGIBLE" if active_method else "NOT_USED",
        "planned_units": units,
        "reserved_units": reserved_units,
        "enrollment_fee": 0,
        "unit_landed_cost": 10,
        "unit_fulfillment_cost": 5,
        "source_artifact_ids": ["SRC-VINE-001", "SRC-ECON-001"] if active_method else [],
    }
    package["onsite_support"]["cost_ledger"]["vine"] = {
        "currency": "USD",
        "planned_units": units,
        "reserved_units": reserved_units,
        "enrollment_fee": 0,
        "unit_landed_cost": 10,
        "unit_fulfillment_cost": 5,
    }
    package["onsite_support"]["cost_ledger"]["inventory_and_cash"]["reserved_units"] = reserved_units
    package["review_compliance"]["methods"] = ["VINE"] if active_method else ["NONE"]


def conservative_learning_model(cap: int | float) -> dict[str, Any]:
    return {
        "model_version": "CONSERVATIVE_FULL_SPEND_V1",
        "method": "CONSERVATIVE_FULL_SPEND",
        "formula": "modeled_loss_at_cap = phase_spend_cap",
        "modeled_spend_at_cap": cap,
        "modeled_loss_at_cap": cap,
        "source_ids": ["SRC-APPROVAL-001"],
    }


def configure_keyword_learning(
    package: dict[str, Any],
    *,
    cap: int | float = 100,
    maximum_spend: int | float = 100,
    maximum_loss: int | float = 100,
    approved_at: str | None = None,
) -> None:
    package["economics"]["approved_learning_loss_envelopes"] = [
        {
            "learning_loss_envelope_id": "LL-001",
            "scope_ad_target_ids": ["AT-KW-001"],
            "approved_by_user": True,
            "approved_at": approved_at or iso(FIXTURE_CAPTURED),
            "approval_source_id": "SRC-APPROVAL-001",
            "maximum_incremental_loss": maximum_loss,
            "maximum_spend": maximum_spend,
            "data_or_time_gate": "one bounded review gate",
            "reason": "explicit test hypothesis",
            "stop_conditions": ["cap reached"],
            "rollback_action": "pause target",
        }
    ]
    package["keyword_targets"][0].update(
        {
            "ceiling_basis": "APPROVED_LEARNING_LOSS",
            "learning_loss_envelope_id": "LL-001",
            "proposed_bid": 1.5,
            "bid_ceiling": 1.5,
        }
    )
    package["campaign_architecture"][0].update(
        {
            "phase_spend_cap": cap,
            "learning_loss_allocations": {"LL-001": cap},
            "learning_loss_model": conservative_learning_model(cap),
        }
    )


def run() -> int:
    tests: list[tuple[str, Callable[[], None]]] = []

    def test(name: str):
        def decorator(function: Callable[[], None]) -> Callable[[], None]:
            tests.append((name, function))
            return function
        return decorator

    def economics_only_input(**overrides):
        base = {
            "marketplace": "US", "scope_id": "BOWL", "currency": "USD", "data_mode": "NEW_PRODUCT",
            "calculation_scope": "ECONOMICS_ONLY", "price_includes_tax": False,
            "fees_verified": True, "costs_verified": True, "tax_basis_verified": True,
            "selling_price": "29.99", "referral_fee_rate": "0.15", "referral_fee_basis_amount": "29.99",
            "fulfillment_fee": "5.2", "cogs": "4.1", "inbound_freight": "1.3",
            "ad_attributed_sales_per_order": "29.99", "attributed_sales_data_class": "ESTIMATED",
            "conversion_rate": "0.12", "conversion_data_class": "ESTIMATED",
            "returns_mode": "ALLOWANCE_AMOUNT", "expected_refund_revenue_loss": "0.6", "return_nonrevenue_cost": "0.4",
            "not_applicable_fields": [
                "seller_retained_shipping", "seller_funded_discount", "coupon_discount_per_order",
                "other_seller_funded_discount", "packaging", "prep_and_label", "quality_inspection", "duty",
                "storage", "other_amazon_fees", "other_variable_cost", "coupon_fee_per_order",
                "deal_fee_per_order", "other_onsite_promotion_cost_per_order", "target_profit_per_order",
                "risk_buffer_per_order",
            ],
        }
        base.update(overrides)
        return base

    @test("misspelled input field is rejected instead of silently treated as zero")
    def _() -> None:
        bad = economics_only_input()
        bad["inbound_frieght"] = bad.pop("inbound_freight")
        try:
            economics.calculate(bad)
        except ValueError as exc:
            assert "UNKNOWN_INPUT_FIELDS" in str(exc) and "inbound_freight" in str(exc), exc
        else:
            raise AssertionError("misspelled field was accepted")

    @test("annotation fields with x_ prefix are allowed")
    def _() -> None:
        result = economics.calculate(economics_only_input(x_note="来自工厂报价 PI-1"))
        assert result["overall_status"] == "READY_ESTIMATED", result["reason_codes"]

    @test("ECONOMICS_ONLY is not blocked by missing inventory or launch planning fields")
    def _() -> None:
        result = economics.calculate(economics_only_input())
        assert result["overall_status"] == "READY_ESTIMATED", result["reason_codes"]
        assert result["assumed_zero_fields"] == [], result["assumed_zero_fields"]
        assert "INVENTORY_NOT_IN_SCOPE" in result["reason_codes"]
        assert "NO_ADVERTISING_AVAILABLE_INVENTORY" not in result["reason_codes"]

    @test("not_applicable_fields cannot hide a supplied value or unknown names")
    def _() -> None:
        for overrides in ({"duty": "0.5"}, {"not_applicable_fields": ["cogs_typo"]}):
            payload = economics_only_input(**overrides)
            try:
                economics.calculate(payload)
            except ValueError:
                pass
            else:
                raise AssertionError(overrides)

    @test("FULL scope still requires advertising-available inventory")
    def _() -> None:
        payload = economics_only_input()
        payload.pop("calculation_scope")
        result = economics.calculate(payload)
        assert result["overall_status"] == "BLOCKED"
        assert "NO_ADVERTISING_AVAILABLE_INVENTORY" in result["reason_codes"]

    @test("exact operating economics and target ceilings")
    def _() -> None:
        result = economics.calculate(exact_economics())
        assert result["revenue"]["transaction_revenue_including_tax"] == "85.00"
        assert result["revenue"]["expected_refund_revenue_loss"] == "8.50"
        assert result["revenue"]["net_sales_revenue"] == "76.50"
        assert result["contribution"]["operating_before_ads"] == "29.50"
        assert result["ceilings"]["operating_break_even_acos"] == "0.3278"
        assert result["ceilings"]["target_acos"] == "0.2167"
        assert result["ceilings"]["break_even_cpc"] == "2.95"
        assert result["ceilings"]["target_cpc"] == "1.95"

    @test("rate-based post-ads contribution floor derives dynamic capacity")
    def _() -> None:
        payload = exact_economics()
        payload.pop("target_profit_per_order")
        payload["minimum_post_ads_contribution_rate"] = 0.10
        result = economics.calculate(payload)
        assert result["contribution"]["target_profit_floor_basis"] == "NET_SALES_RATE"
        assert result["contribution"]["target_profit_floor_per_order"] == "7.65"
        assert result["contribution"]["target_ad_spend_capacity_per_order"] == "21.85"
        assert result["ceilings"]["target_acos"] == "0.2428"
        assert result["ceilings"]["target_cpc"] == "2.18"
        assert "target_profit_per_order" not in result["assumed_zero_fields"]

    @test("amount and rate profit floors use the stricter value")
    def _() -> None:
        payload = exact_economics()
        payload["target_profit_per_order"] = 5
        payload["minimum_post_ads_contribution_rate"] = 0.10
        result = economics.calculate(payload)
        assert result["contribution"]["target_profit_floor_basis"] == "MAX_OF_AMOUNT_AND_NET_SALES_RATE"
        assert result["contribution"]["target_profit_floor_per_order"] == "7.65"

    @test("risk buffer remains separate from the profit floor")
    def _() -> None:
        payload = exact_economics()
        payload["target_profit_per_order"] = 0
        payload["minimum_post_ads_contribution_rate"] = 0.10
        payload["risk_buffer_per_order"] = 2
        result = economics.calculate(payload)
        assert result["contribution"]["target_profit_floor_per_order"] == "7.65"
        assert result["contribution"]["risk_buffer_per_order"] == "2.00"
        assert result["contribution"]["target_profit_and_risk_buffer_per_order"] == "9.65"

    @test("invalid post-ads contribution rate is rejected")
    def _() -> None:
        payload = exact_economics()
        payload["minimum_post_ads_contribution_rate"] = 1.01
        try:
            economics.calculate(payload)
        except ValueError as exc:
            assert "minimum_post_ads_contribution_rate" in str(exc)
        else:
            raise AssertionError("Expected invalid rate rejection")

    @test("actual ACoS TACoS CPC CVR and CPA stay distinct")
    def _() -> None:
        payload = exact_economics()
        payload.update({"data_mode": "EXISTING_PRODUCT", "attributed_sales_data_class": "ACTUAL", "actual_ad_spend": 90, "actual_ad_attributed_sales": 450, "actual_total_sales": 900, "actual_impressions": 1000, "actual_clicks": 50, "actual_attributed_orders": 5, "attribution_status": "COMPLETE"})
        result = economics.calculate(payload)["actual_period"]
        assert result["acos"] == "0.2000"
        assert result["tacos"] == "0.1000"
        assert result["cpc"] == "1.80"
        assert result["cvr"] == "0.1000"
        assert result["cpa"] == "18.00"

    @test("Coupon discount and per-order fee are separate")
    def _() -> None:
        base = economics.calculate(exact_economics())
        payload = exact_economics()
        payload["coupon_fee_per_order"] = 2
        changed = economics.calculate(payload)
        assert base["revenue"]["transaction_revenue_including_tax"] == changed["revenue"]["transaction_revenue_including_tax"]
        assert changed["costs"]["variable_onsite_promotion_cost"] == "2.00"
        assert changed["contribution"]["operating_before_ads"] == "27.50"

    @test("fixed Coupon fee affects all-in but not operating ACoS")
    def _() -> None:
        payload = exact_economics()
        payload["coupon_fixed_fee"] = 100
        payload["planned_orders"] = 100
        result = economics.calculate(payload)
        assert result["ceilings"]["operating_break_even_acos"] == "0.3278"
        assert result["ceilings"]["all_in_break_even_acos"] == "0.3167"

    @test("Vine remains outside PPC and reduces inventory")
    def _() -> None:
        payload = exact_economics()
        payload.update({"vine_enrollment_fee": 50, "vine_units": 10, "vine_unit_landed_cost": 20, "vine_unit_fulfillment_cost": 5, "vine_reserved_units": 10})
        result = economics.calculate(payload)
        assert result["costs"]["fixed_launch_support_total"] == "300.00"
        assert result["inventory"]["advertising_available_units"] == "890"
        assert result["ceilings"]["operating_break_even_acos"] == "0.3278"

    @test("Vine or locked inventory cannot exceed sellable inventory")
    def _() -> None:
        payload = exact_economics()
        payload.update({"sellable_inventory": 10, "vine_reserved_units": 11})
        result = economics.calculate(payload)
        assert result["overall_status"] == "BLOCKED"
        assert "VINE_OR_LOCKED_INVENTORY_EXCEEDS_SELLABLE" in result["reason_codes"]

    @test("return double counting is rejected")
    def _() -> None:
        payload = exact_economics()
        payload["net_sales_already_refund_adjusted"] = True
        try:
            economics.calculate(payload)
        except ValueError as exc:
            assert "RETURN_DOUBLE_COUNT" in str(exc)
        else:
            raise AssertionError("Expected return double-count rejection")

    @test("return recovery reduces nonrevenue return cost")
    def _() -> None:
        payload = blank_economics()
        payload.update({"returns_mode": "RATE_MODEL", "return_rate": 0.10, "average_refunded_pretax_revenue": 0, "return_processing_fee": 20, "return_shipping_cost": 40, "nonrefundable_platform_fee": 40, "disposal_removal_cost": 0, "platform_reimbursement": 0, "resellable_inventory_recovery": 40})
        result = economics.calculate(payload)
        assert result["costs"]["return_nonrevenue_cost"] == "6.00"

    @test("negative pre-ad contribution blocks all capacity")
    def _() -> None:
        payload = exact_economics()
        payload["other_variable_cost"] = 30
        result = economics.calculate(payload)
        assert result["overall_status"] == "BLOCKED"
        assert result["ceilings"]["operating_break_even_acos"] is None
        assert result["ceilings"]["break_even_cpc"] is None

    @test("zero contribution is distinct from missing capacity")
    def _() -> None:
        payload = exact_economics()
        payload["other_variable_cost"] = 29.5
        result = economics.calculate(payload)
        assert result["ceilings"]["operating_break_even_acos"] == "0.0000"
        assert result["ceilings"]["break_even_cpc"] == "0.00"
        assert result["metric_status"]["break_even_cpc"] == "ZERO_AD_CAPACITY"

    @test("target profit above contribution has no target ceiling")
    def _() -> None:
        payload = exact_economics()
        payload["target_profit_per_order"] = 30
        result = economics.calculate(payload)
        assert result["ceilings"]["target_acos"] is None
        assert result["ceilings"]["target_cpc"] is None

    @test("target profit equal to contribution yields zero target")
    def _() -> None:
        payload = exact_economics()
        payload["target_profit_per_order"] = 29.5
        result = economics.calculate(payload)
        assert result["ceilings"]["target_acos"] == "0.0000"
        assert result["ceilings"]["target_cpc"] == "0.00"

    @test("missing CVR leaves CPC null while ACoS remains")
    def _() -> None:
        payload = exact_economics()
        payload.pop("conversion_rate")
        payload.pop("conversion_data_class")
        result = economics.calculate(payload)
        assert result["ceilings"]["break_even_cpc"] is None
        assert result["ceilings"]["operating_break_even_acos"] == "0.3278"

    @test("observed zero CVR is zero rather than missing")
    def _() -> None:
        payload = exact_economics()
        payload.update({"data_mode": "EXISTING_PRODUCT", "attributed_sales_data_class": "ACTUAL", "actual_clicks": 50, "actual_attributed_orders": 0, "attribution_status": "COMPLETE"})
        result = economics.calculate(payload)
        assert result["actual_period"]["cvr"] == "0.0000"
        assert result["ceilings"]["break_even_cpc"] == "0.00"

    @test("zero clicks makes observed CVR undefined")
    def _() -> None:
        payload = exact_economics()
        payload.update({"data_mode": "EXISTING_PRODUCT", "attributed_sales_data_class": "ACTUAL", "actual_clicks": 0, "actual_attributed_orders": 0, "attribution_status": "COMPLETE"})
        result = economics.calculate(payload)
        assert result["actual_period"]["cvr"] is None
        assert result["ceilings"]["break_even_cpc"] is None

    @test("orders with zero clicks expose attribution conflict")
    def _() -> None:
        payload = exact_economics()
        payload.update({"data_mode": "EXISTING_PRODUCT", "actual_clicks": 0, "actual_attributed_orders": 1})
        try:
            economics.calculate(payload)
        except ValueError as exc:
            assert "ATTRIBUTION_SCOPE_MISMATCH" in str(exc)
        else:
            raise AssertionError("Expected attribution mismatch")

    @test("zero actual sales denominators return null")
    def _() -> None:
        payload = exact_economics()
        payload.update({"actual_ad_spend": 10, "actual_ad_attributed_sales": 0, "actual_total_sales": 0})
        result = economics.calculate(payload)["actual_period"]
        assert result["acos"] is None and result["tacos"] is None

    @test("positive fixed support with zero planned orders is unallocated")
    def _() -> None:
        payload = exact_economics()
        payload.update({"vine_enrollment_fee": 100, "planned_orders": 0})
        result = economics.calculate(payload)
        assert result["costs"]["fixed_launch_support_per_planned_order"] is None
        assert "PLANNED_UNITS_ZERO" in result["reason_codes"]

    @test("zero fixed support with zero planned orders is not applicable")
    def _() -> None:
        payload = exact_economics()
        payload["planned_orders"] = 0
        result = economics.calculate(payload)
        assert result["costs"]["fixed_launch_support_per_planned_order"] == "0.00"

    @test("tax-inclusive revenue is normalized exactly")
    def _() -> None:
        payload = blank_economics()
        payload.update({"selling_price": 119, "price_includes_tax": True, "tax_rate": 0.19, "ad_attributed_sales_per_order": 119})
        result = economics.calculate(payload)
        assert result["revenue"]["pretax_transaction_revenue"] == "100.00"

    @test("tax-inclusive discount is normalized before economics")
    def _() -> None:
        payload = blank_economics()
        payload.update({"selling_price": 119, "seller_funded_discount": 11.90, "price_includes_tax": True, "tax_rate": 0.19, "ad_attributed_sales_per_order": 107.10})
        result = economics.calculate(payload)
        assert result["revenue"]["pretax_transaction_revenue"] == "90.00"

    @test("string false cannot masquerade as boolean")
    def _() -> None:
        payload = blank_economics()
        payload["price_includes_tax"] = "false"
        try:
            economics.calculate(payload)
        except ValueError as exc:
            assert "boolean" in str(exc)
        else:
            raise AssertionError("Expected strict boolean error")

    @test("mixed currencies cannot be compared without verified FX")
    def _() -> None:
        left = blank_economics()
        right = blank_economics()
        right["currency"] = "EUR"
        try:
            economics.expand_scenarios({"scenarios": [left, right]})
        except ValueError as exc:
            assert "CURRENCY_MISMATCH" in str(exc)
        else:
            raise AssertionError("Expected currency mismatch")

    @test("halo contribution must be mapped")
    def _() -> None:
        payload = exact_economics()
        payload["attributed_sales_scope"] = "COMBINED"
        result = economics.calculate(payload)
        assert result["ceilings"]["operating_break_even_acos"] is None
        assert "ATTRIBUTED_MIX_UNMAPPED" in result["reason_codes"]

    @test("open existing attribution window stays provisional")
    def _() -> None:
        payload = exact_economics()
        payload.update({"data_mode": "EXISTING_PRODUCT", "attributed_sales_data_class": "ACTUAL", "actual_clicks": 50, "actual_attributed_orders": 5, "attribution_status": "PARTIAL"})
        assert economics.calculate(payload)["overall_status"] == "PROVISIONAL"

    @test("estimated SellerSprite inputs never become READY_ACTUAL")
    def _() -> None:
        result = economics.calculate(exact_economics())
        assert result["overall_status"] == "READY_ESTIMATED"

    @test("NaN and boolean numeric inputs are rejected")
    def _() -> None:
        for bad in ("NaN", True):
            payload = blank_economics()
            payload["selling_price"] = bad
            try:
                economics.calculate(payload)
            except ValueError:
                pass
            else:
                raise AssertionError(f"Expected rejection for {bad!r}")

    @test("missing actual numerators remain unavailable rather than zero")
    def _() -> None:
        payload = exact_economics()
        payload.update({"data_mode": "EXISTING_PRODUCT", "actual_ad_attributed_sales": 450, "actual_total_sales": 900, "actual_impressions": 1000, "attribution_status": "COMPLETE"})
        result = economics.calculate(payload)
        assert result["actual_period"]["acos"] is None
        assert result["actual_period"]["tacos"] is None
        assert result["actual_period"]["ctr"] is None
        assert result["overall_status"] == "PROVISIONAL"
        assert "ACTUAL_PERIOD_METRICS_INCOMPLETE" in result["reason_codes"]

    @test("zero available inventory blocks advertising readiness")
    def _() -> None:
        payload = exact_economics()
        payload.update({"sellable_inventory": 100, "safety_stock_units": 100})
        result = economics.calculate(payload)
        assert result["inventory"]["advertising_available_units"] == "0"
        assert result["overall_status"] == "BLOCKED"
        assert "NO_ADVERTISING_AVAILABLE_INVENTORY" in result["reason_codes"]

    @test("one sellable offer per modeled order is enforced")
    def _() -> None:
        payload = exact_economics()
        assert economics.calculate(payload)["model_basis"]["units_per_order"] == "1"
        payload["units_per_order"] = 2
        try:
            economics.calculate(payload)
        except ValueError as exc:
            assert "units_per_order" in str(exc)
        else:
            raise AssertionError("Multi-offer order must first be normalized")

    @test("CPC ceiling rounds downward and never exceeds exact Decimal capacity")
    def _() -> None:
        from decimal import Decimal
        payload = exact_economics()
        payload["target_profit_per_order"] = 7.65
        exact_capacity = Decimal("29.50") - Decimal("7.65")
        exact_cpc = exact_capacity * Decimal("0.10")
        result = economics.calculate(payload)
        assert Decimal(result["ceilings"]["target_cpc"]) <= exact_cpc
        assert result["ceilings"]["target_cpc"] == "2.18"

    @test("independent Decimal ledger reconciles tax discount refund support and profit floor")
    def _() -> None:
        from decimal import Decimal
        payload = blank_economics()
        payload.update({
            "selling_price": "119", "price_includes_tax": True, "tax_rate": "0.19",
            "seller_funded_discount": "11.90", "coupon_discount_per_order": "5.95",
            "returns_mode": "ALLOWANCE_AMOUNT", "expected_refund_revenue_loss": "4",
            "return_nonrevenue_cost": "3", "cogs": "20", "packaging": "2",
            "inbound_freight": "3", "referral_fee": "10", "fulfillment_fee": "5",
            "coupon_fee_per_order": "2", "coupon_fixed_fee": "100", "planned_orders": 100,
            "minimum_post_ads_contribution_rate": "0.20", "target_profit_per_order": "10",
            "risk_buffer_per_order": "2", "ad_attributed_sales_per_order": "101.15",
            "conversion_rate": "0.075",
        })
        transaction = Decimal("119") - Decimal("11.90") - Decimal("5.95")
        net = transaction / Decimal("1.19") - Decimal("4")
        operating = net - (Decimal("20") + Decimal("2") + Decimal("3")) - (Decimal("10") + Decimal("5")) - Decimal("2") - Decimal("3")
        all_in = operating - Decimal("100") / Decimal("100")
        capacity = operating - max(Decimal("10"), net * Decimal("0.20")) - Decimal("2")
        result = economics.calculate(payload)
        assert transaction == Decimal("101.15") and net == Decimal("81")
        assert operating == Decimal("36") and all_in == Decimal("35") and capacity == Decimal("17.8")
        assert result["revenue"]["net_sales_revenue"] == "81.00"
        assert result["contribution"]["operating_before_ads"] == "36.00"
        assert result["contribution"]["all_in_before_ads"] == "35.00"
        assert result["contribution"]["target_ad_spend_capacity_per_order"] == "17.80"
        assert result["ceilings"]["target_acos"] == "0.1760"
        assert result["ceilings"]["target_cpc"] == "1.33"

    @test("return rate missing components force provisional status")
    def _() -> None:
        payload = blank_economics()
        payload.update({"returns_mode": "RATE_MODEL", "return_rate": "0.10", "average_refunded_pretax_revenue": "20"})
        result = economics.calculate(payload)
        assert "return_shipping_cost" in result["assumed_zero_fields"]
        assert result["overall_status"] == "PROVISIONAL"

    @test("unused referral rate must still be finite")
    def _() -> None:
        payload = exact_economics()
        payload.update({"referral_fee_rate": "NaN", "referral_fee_control": "AMOUNT"})
        try:
            economics.calculate(payload)
        except ValueError as exc:
            assert "referral_fee_rate" in str(exc)
        else:
            raise AssertionError("Invalid alternate fee rate must not be hidden")

    @test("valid new-product strategy is plan ready")
    def _() -> None:
        result = validator.validate(valid_strategy(False))
        assert result["plan_ready"] is True, result["findings"]
        assert result["execution_review_ready"] is False

    @test("valid existing-product strategy requires actual data")
    def _() -> None:
        result = validator.validate(valid_strategy(True))
        assert result["plan_ready"] is True, result["findings"]

    @test("operating context ID stays stable across the full workflow")
    def _() -> None:
        package = valid_strategy(False)
        package["upstream_snapshots"]["keyword_library"]["operating_context_id"] = "CTX-OTHER"
        assert "OPERATING_CONTEXT_LINEAGE_MISMATCH" in finding_codes(validator.validate(package))

    @test("operating context hash detects silent cross-stage mutation")
    def _() -> None:
        package = valid_strategy(False)
        package["operating_context"]["profit_objective"]["target_profit_per_order"] = 1
        codes = finding_codes(validator.validate(package))
        assert "OPERATING_CONTEXT_HASH_MISMATCH" in codes

    @test("every full-workflow snapshot preserves the operating context hash")
    def _() -> None:
        package = valid_strategy(False)
        package["upstream_snapshots"]["listing_release"]["operating_context_sha256"] = "sha256:" + "0" * 64
        assert "OPERATING_CONTEXT_HASH_LINEAGE_MISMATCH" in finding_codes(validator.validate(package))

    @test("new-product readiness requires lead-time components")
    def _() -> None:
        package = valid_strategy(False)
        package["inventory"].pop("lead_time_components")
        assert "LEAD_TIME_COMPONENTS_MISSING" in finding_codes(validator.validate(package))

    @test("safety-stock days reconcile once to binding units")
    def _() -> None:
        package = valid_strategy(False)
        package["inventory"]["safety_stock_units"] = 99
        assert "SAFETY_STOCK_UNIT_CONVERSION_MISMATCH" in finding_codes(validator.validate(package))

    @test("lead-time components must sum and reconcile to economics")
    def _() -> None:
        package = valid_strategy(False)
        package["inventory"]["lead_time_components"]["fba_receiving_days"] = 6
        codes = finding_codes(validator.validate(package))
        assert "LEAD_TIME_COMPONENT_SUM_MISMATCH" in codes
        assert "LEAD_TIME_TOTAL_MISMATCH" in codes

    @test("route risk buffer must reconcile to calculator input")
    def _() -> None:
        package = valid_strategy(False)
        package["inventory"]["lead_time_components"]["risk_buffer_days"] = 6
        assert "ECONOMICS_INVENTORY_RECONCILIATION_MISMATCH" in finding_codes(validator.validate(package))

    @test("selected supply route requires a known scoped source")
    def _() -> None:
        package = valid_strategy(False)
        package["inventory"]["lead_time_components"]["source_artifact_ids"] = ["SRC-UNKNOWN-ROUTE"]
        assert "LEAD_TIME_SOURCE_UNKNOWN" in finding_codes(validator.validate(package))

    @test("off-Amazon or unverified placement is rejected")
    def _() -> None:
        package = valid_strategy()
        package["campaign_architecture"][0]["onsite_scope"] = "AMAZON_AND_OFFSITE"
        assert "OFFSITE_SCOPE_NOT_BLOCKED" in finding_codes(validator.validate(package))

    @test("blocked research role cannot become a positive target")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0]["library_role"] = "HOLD_CLAIM"
        assert "KEYWORD_ROLE_POSITIVE_BLOCKED" in finding_codes(validator.validate(package))

    @test("indexing candidate needs controlled ad review")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0]["library_role"] = "INDEXING_CANDIDATE"
        assert "KEYWORD_REVIEW_GATE_MISSING" in finding_codes(validator.validate(package))

    @test("later-stage term needs current-stage evidence")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0]["library_role"] = "LATER_STAGE_RELEVANT"
        assert "LATER_STAGE_NOT_RELEASED" in finding_codes(validator.validate(package))

    @test("bid above ceiling needs approved loss envelope")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0]["proposed_bid"] = 3
        assert "BID_EXCEEDS_CEILING" in finding_codes(validator.validate(package))

    @test("keyword-source-only competitor cannot become automatic product target")
    def _() -> None:
        package = valid_strategy()
        package["product_targets"] = [{"ad_target_id": "AT-ASIN-001", "asin": "B012345678", "competitor_source_role": "USER_SUPPLIED", "competitor_primary_role": "DIRECT_PRICE_FORM", "competitor_roles": ["DIRECT_PRICE_FORM"], "competitor_lock_status": "KEYWORD_SOURCE_ONLY", "source_order": 1, "ad_role": "PRODUCT_TARGET_TEST", "ad_decision": "INCLUDE", "decision_reason": "automatic", "source_ids": ["SRC-KW-001"], "evidence_ids": ["E-ASIN-001"]}]
        assert "PRODUCT_ROLE_POSITIVE_BLOCKED" in finding_codes(validator.validate(package))

    @test("review manipulation gate is mandatory")
    def _() -> None:
        package = valid_strategy()
        package["review_compliance"]["review_manipulation_excluded"] = False
        assert "REVIEW_MANIPULATION_GATE_FAILED" in finding_codes(validator.validate(package))

    @test("ready plan requires current policy gates")
    def _() -> None:
        package = valid_strategy()
        package["policy_snapshot"]["placement_scope_verified"] = "UNKNOWN"
        assert "POLICY_GATE_UNVERIFIED" in finding_codes(validator.validate(package))

    @test("provisional Listing cannot support PLAN_READY")
    def _() -> None:
        package = valid_strategy()
        package["upstream_snapshots"]["listing_release"]["status"] = "PROVISIONAL"
        assert "LISTING_NOT_READY" in finding_codes(validator.validate(package))

    @test("old product without complete first-party data is rejected")
    def _() -> None:
        package = valid_strategy(True)
        package["performance_snapshots"] = []
        assert "FIRST_PARTY_PERFORMANCE_MISSING" in finding_codes(validator.validate(package))

    @test("PLAN_ONLY manifest cannot claim applied changes")
    def _() -> None:
        package = valid_strategy()
        package["change_manifest"] = [{"operation_id": "OP-001", "execution_status": "APPLIED"}]
        codes = finding_codes(validator.validate(package))
        assert "UNAUTHORIZED_OPERATION_STATE" in codes and "CHANGE_OPERATION_FIELD_MISSING" in codes

    @test("prepared exact manifest is ready for user execution review")
    def _() -> None:
        package = valid_strategy()
        package["strategy_status"] = "READY_FOR_EXECUTION_REVIEW"
        package["deliverable_mode"] = "PREPARE_CHANGES"
        package["execution_authority"] = "PREPARE_CHANGES"
        package["change_manifest"] = [prepared_ad_operation("NOT_AUTHORIZED")]
        result = validator.validate(package)
        assert result["execution_review_ready"] is True, result["findings"]
        assert result["execution_authorized"] is False
        assert result["plan_ready"] is False

    @test("fresh exact authorization is scoped to execute manifest")
    def _() -> None:
        package = valid_strategy()
        package["strategy_status"] = "EXECUTION_AUTHORIZED"
        package["deliverable_mode"] = "EXECUTE"
        package["execution_authority"] = "EXECUTION_AUTHORIZED"
        package["change_manifest"] = [prepared_ad_operation("NOT_STARTED")]
        package["authorization_record"] = {
            "user_confirmed": True,
            "confirmed_at": iso(FIXTURE_AUTHORIZED),
            "account_id_masked": "***001",
            "marketplace": "US",
            "manifest_hash": validator.manifest_hash(package["change_manifest"]),
            "prechange_snapshot_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "allowed_operation_ids": ["OP-001"],
        }
        result = validator.validate(package)
        assert result["authorization_record_structurally_valid"] is True, result["findings"]
        assert result["execution_authorized"] is False
        assert result["trusted_external_grant_required"] is True
        assert result["plan_ready"] is False

    @test("pre-change timestamp must match cited live snapshot")
    def _() -> None:
        package = valid_strategy()
        package["strategy_status"] = "READY_FOR_EXECUTION_REVIEW"
        package["deliverable_mode"] = "PREPARE_CHANGES"
        package["execution_authority"] = "PREPARE_CHANGES"
        operation = prepared_ad_operation("NOT_AUTHORIZED")
        operation["prechange_captured_at"] = iso(FIXTURE_CAPTURED + timedelta(minutes=1))
        package["change_manifest"] = [operation]
        assert "PRECHANGE_SNAPSHOT_TIME_MISMATCH" in finding_codes(validator.validate(package))

    @test("fresh authorization cannot predate live snapshot")
    def _() -> None:
        package = valid_strategy()
        package["strategy_status"] = "EXECUTION_AUTHORIZED"
        package["deliverable_mode"] = "EXECUTE"
        package["execution_authority"] = "EXECUTION_AUTHORIZED"
        operation = prepared_ad_operation("NOT_STARTED")
        operation["prechange_captured_at"] = iso(FIXTURE_AUTHORIZED + timedelta(minutes=1))
        account_source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ACCOUNT-001")
        account_source["version_or_captured_at"] = operation["prechange_captured_at"]
        package["change_manifest"] = [operation]
        package["authorization_record"] = {
            "user_confirmed": True,
            "confirmed_at": iso(FIXTURE_AUTHORIZED),
            "account_id_masked": "***001",
            "marketplace": "US",
            "manifest_hash": validator.manifest_hash(package["change_manifest"]),
            "prechange_snapshot_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "allowed_operation_ids": ["OP-001"],
        }
        assert "AUTHORIZATION_PREDATES_SNAPSHOT" in finding_codes(validator.validate(package))

    @test("strategy spend cap cannot exceed approved cash")
    def _() -> None:
        package = valid_strategy()
        package["economics"]["strategy_total_spend_cap"] = 1001
        assert "TOTAL_CAP_EXCEEDS_CASH" in finding_codes(validator.validate(package))

    @test("phase caps cannot exceed strategy total")
    def _() -> None:
        package = valid_strategy()
        package["economics"]["strategy_total_spend_cap"] = 499
        assert "PHASE_CAPS_EXCEED_TOTAL" in finding_codes(validator.validate(package))

    @test("placement verification needs source and timestamp")
    def _() -> None:
        package = valid_strategy()
        package["campaign_architecture"][0].pop("placement_policy_source_id")
        package["campaign_architecture"][0].pop("placement_account_source_id")
        package["campaign_architecture"][0].pop("placement_verified_at")
        codes = finding_codes(validator.validate(package))
        assert {"PLACEMENT_POLICY_PROOF_INVALID", "PLACEMENT_ACCOUNT_PROOF_INVALID", "PLACEMENT_VERIFICATION_TIME_MISSING"} <= codes

    @test("ready plan needs traceable source artifacts")
    def _() -> None:
        package = valid_strategy()
        package["source_artifacts"] = []
        assert "READY_SOURCES_MISSING" in finding_codes(validator.validate(package))

    @test("handback requires a known destination and evidence")
    def _() -> None:
        package = valid_strategy()
        package["handbacks"] = [{"handback_id": "HB-001", "destination_skill": "unknown"}]
        codes = finding_codes(validator.validate(package))
        assert "HANDBACK_DESTINATION_INVALID" in codes and "HANDBACK_EVIDENCE_MISSING" in codes

    @test("authorization hash must match exact manifest")
    def _() -> None:
        package = valid_strategy()
        package["strategy_status"] = "EXECUTION_AUTHORIZED"
        package["deliverable_mode"] = "EXECUTE"
        package["execution_authority"] = "EXECUTION_AUTHORIZED"
        package["change_manifest"] = [prepared_ad_operation("NOT_STARTED")]
        package["authorization_record"] = {"user_confirmed": True, "confirmed_at": iso(FIXTURE_AUTHORIZED), "account_id_masked": "***001", "marketplace": "US", "manifest_hash": "sha256:wrong", "prechange_snapshot_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "allowed_operation_ids": ["OP-001"]}
        assert "AUTHORIZATION_MANIFEST_MISMATCH" in finding_codes(validator.validate(package))

    @test("calculator result cannot be edited independently of its input")
    def _() -> None:
        package = valid_strategy()
        package_binding_result(package)["ceilings"]["target_cpc"] = "99.00"
        assert "CALCULATOR_RESULT_MISMATCH" in finding_codes(validator.validate(package))

    @test("declared bid ceiling cannot exceed calculator target CPC")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0]["bid_ceiling"] = 2.50
        package["keyword_targets"][0]["proposed_bid"] = 2.00
        assert "TARGET_CEILING_NOT_RECONCILED" in finding_codes(validator.validate(package))

    @test("ready included target cannot omit bid and ceiling")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0]["proposed_bid"] = None
        package["keyword_targets"][0]["bid_ceiling"] = None
        assert "READY_KEYWORD_BID_MISSING" in finding_codes(validator.validate(package))

    @test("ready campaign cannot omit its budget")
    def _() -> None:
        package = valid_strategy()
        package["campaign_architecture"][0]["proposed_budget"] = None
        assert "READY_BUDGET_MISSING" in finding_codes(validator.validate(package))

    @test("negative inventory cannot pass launch readiness")
    def _() -> None:
        package = valid_strategy()
        package["inventory"]["sellable_units"] = -1
        assert "INVENTORY_VALUE_NEGATIVE" in finding_codes(validator.validate(package))

    @test("PPC plus fixed support must fit approved cash exposure")
    def _() -> None:
        package = valid_strategy()
        for scenario in package["economics"]["input_snapshot"]["scenarios"]:
            scenario["vine_enrollment_fee"] = 600
        recalculate_package_economics(package)
        assert "ALL_IN_EXPOSURE_EXCEEDS_CASH" in finding_codes(validator.validate(package))

    @test("malformed numeric fields become findings instead of crashes")
    def _() -> None:
        package = valid_strategy()
        package["economics"]["strategy_total_spend_cap"] = True
        assert "NUMERIC_INVALID" in finding_codes(validator.validate(package))

    @test("negative return allowance cannot inflate contribution")
    def _() -> None:
        payload = exact_economics()
        payload["return_nonrevenue_cost"] = -100
        try:
            economics.calculate(payload)
        except ValueError as exc:
            assert "must not be negative" in str(exc)
        else:
            raise AssertionError("Expected negative return-cost rejection")

    @test("unallocated fixed support lowers economics readiness")
    def _() -> None:
        payload = exact_economics()
        payload.update({"vine_enrollment_fee": 100, "planned_orders": 0})
        result = economics.calculate(payload)
        assert result["overall_status"] == "PROVISIONAL"
        assert result["contribution"]["all_in_before_ads"] is None

    @test("unmapped halo mix has no all-in ceiling")
    def _() -> None:
        payload = exact_economics()
        payload["attributed_sales_scope"] = "COMBINED"
        result = economics.calculate(payload)
        assert result["ceilings"]["all_in_break_even_acos"] is None
        assert result["overall_status"] == "PROVISIONAL"

    @test("arbitrary keyword ceiling basis cannot authorize a bid")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0].update({"ceiling_basis": "MAGIC", "proposed_bid": 999, "bid_ceiling": 999})
        assert "KEYWORD_CEILING_BASIS_INVALID" in finding_codes(validator.validate(package))

    @test("approved learning loss must cover exact keyword target")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0].update({"ceiling_basis": "APPROVED_LEARNING_LOSS", "proposed_bid": 1.5, "bid_ceiling": 1.5, "learning_loss_envelope_id": None})
        assert "LEARNING_ENVELOPE_TARGET_NOT_COVERED" in finding_codes(validator.validate(package))

    @test("approved learning loss must cover exact product target")
    def _() -> None:
        package = valid_strategy()
        target = package["product_targets"][0]
        target.update({"ad_role": "PRODUCT_TARGET_TEST", "ad_decision": "INCLUDE", "ceiling_basis": "APPROVED_LEARNING_LOSS", "proposed_bid": 1.5, "bid_ceiling": 1.5, "learning_loss_envelope_id": None})
        assert "PRODUCT_LEARNING_ENVELOPE_NOT_COVERED" in finding_codes(validator.validate(package))

    @test("audit cannot claim PLAN_READY")
    def _() -> None:
        package = valid_strategy()
        package["deliverable_mode"] = "AUDIT"
        assert "DELIVERABLE_STATUS_MISMATCH" in finding_codes(validator.validate(package))

    @test("execute cannot reuse PLAN_READY status")
    def _() -> None:
        package = valid_strategy()
        package["deliverable_mode"] = "EXECUTE"
        package["execution_authority"] = "EXECUTION_AUTHORIZED"
        package["change_manifest"] = [prepared_ad_operation("NOT_STARTED")]
        assert "DELIVERABLE_STATUS_MISMATCH" in finding_codes(validator.validate(package))

    @test("estimated artifact cannot support first-party performance")
    def _() -> None:
        package = valid_strategy(True)
        next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ADS-001")["data_class"] = "ESTIMATED"
        assert "PERFORMANCE_SOURCE_NOT_FIRST_PARTY" in finding_codes(validator.validate(package))

    @test("empty first-party performance claim is rejected")
    def _() -> None:
        package = valid_strategy(True)
        package["performance_snapshots"] = [{"performance_snapshot_id": "PS-001", "data_class": "FIRST_PARTY", "source_artifact_ids": ["SRC-ADS-001"], "attribution_status": "COMPLETE"}]
        codes = finding_codes(validator.validate(package))
        assert "PERFORMANCE_FIELD_MISSING" in codes and "PERFORMANCE_METRICS_MISSING" in codes

    @test("new-product ready plan requires three scenarios")
    def _() -> None:
        package = valid_strategy()
        single = exact_economics()
        package["economics"]["input_snapshot"] = single
        package["economics"]["calculator_result"] = economics.calculate(single)
        package["economics"]["binding_scenario_name"] = None
        assert "NEW_SCENARIOS_MISSING" in finding_codes(validator.validate(package))

    @test("economics scope must match strategy scope")
    def _() -> None:
        package = valid_strategy()
        for scenario in package["economics"]["input_snapshot"]["scenarios"]:
            scenario.update({"marketplace": "DE", "currency": "EUR", "scope_id": "OTHER-SKU", "data_mode": "EXISTING_PRODUCT", "attributed_sales_data_class": "ACTUAL", "attribution_status": "COMPLETE"})
        recalculate_package_economics(package)
        codes = finding_codes(validator.validate(package))
        assert {"ECONOMICS_MARKETPLACE_MISMATCH", "ECONOMICS_CURRENCY_MISMATCH", "ECONOMICS_SCOPE_MISMATCH", "ECONOMICS_MODE_MISMATCH"} <= codes

    @test("downstream keyword role cannot differ from upstream")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0]["library_role"] = "HOLD_CLAIM"
        assert "UPSTREAM_KEYWORD_ROLE_MISMATCH" in finding_codes(validator.validate(package))

    @test("downstream competitor axes cannot differ from lock manifest")
    def _() -> None:
        package = valid_strategy()
        package["product_targets"][0]["source_order"] = 2
        assert "UPSTREAM_COMPETITOR_AXIS_MISMATCH" in finding_codes(validator.validate(package))

    @test("every locked competitor stays in downstream audit trail")
    def _() -> None:
        package = valid_strategy()
        package["upstream_snapshots"]["competitor_lock"]["competitors"].append(
            {
                "asin": "B011111111",
                "source_role": "RESEARCH_ADDED",
                "primary_role": "NEW_ENTRANT",
                "roles": ["NEW_ENTRANT"],
                "lock_status": "BOUNDARY_REFERENCE",
                "source_order": 2,
            }
        )
        assert "LOCKED_COMPETITOR_COVERAGE_MISSING" in finding_codes(validator.validate(package))

    @test("actual economics reconciles to cited first-party snapshots")
    def _() -> None:
        package = valid_strategy(existing=True)
        package["economics"]["input_snapshot"]["actual_ad_spend"] = 91
        recalculate_package_economics(package)
        assert "ECONOMICS_PERFORMANCE_RECONCILIATION_MISMATCH" in finding_codes(validator.validate(package))

    @test("observed keyword still requires traceable source identity")
    def _() -> None:
        package = valid_strategy()
        target = package["keyword_targets"][0]
        target["ad_decision"] = "OBSERVE"
        target["ad_role"] = "OBSERVE"
        target.pop("source_keyword_id")
        target.pop("source_ids")
        target.pop("evidence_ids")
        codes = finding_codes(validator.validate(package))
        assert "SOURCE_KEYWORD_ID_MISSING" in codes and "TARGET_EVIDENCE_MISSING" in codes

    @test("product decision enum rejects execution-like values")
    def _() -> None:
        package = valid_strategy()
        package["product_targets"][0]["ad_decision"] = "APPLIED"
        assert "PRODUCT_AD_DECISION_INVALID" in finding_codes(validator.validate(package))

    @test("SellerSprite cannot prove Amazon-only placement")
    def _() -> None:
        package = valid_strategy()
        next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-PLACEMENT-001")["data_class"] = "ESTIMATED"
        assert "PLACEMENT_POLICY_PROOF_INVALID" in finding_codes(validator.validate(package))

    @test("placement policy proof must match marketplace and ad product")
    def _() -> None:
        package = valid_strategy()
        next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-PLACEMENT-001")["marketplace"] = "DE"
        assert "PLACEMENT_POLICY_SCOPE_MISMATCH" in finding_codes(validator.validate(package))

    @test("placement account proof must match exact account scope")
    def _() -> None:
        package = valid_strategy()
        next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ACCOUNT-001")["account_id_masked"] = "***999"
        assert "PLACEMENT_ACCOUNT_SCOPE_MISMATCH" in finding_codes(validator.validate(package))

    @test("decision rule requires sources and attribution contract")
    def _() -> None:
        package = valid_strategy()
        package["decision_rules"][0].pop("source_snapshot_ids")
        package["decision_rules"][0].pop("attribution_requirement")
        codes = finding_codes(validator.validate(package))
        assert "DECISION_RULE_SOURCES_INVALID" in codes and "DECISION_RULE_ATTRIBUTION_MISSING" in codes

    @test("phase requires actions attribution and inventory floor")
    def _() -> None:
        package = valid_strategy()
        phase = package["phase_plan"][0]
        phase.pop("planned_actions")
        phase.pop("attribution_completion_requirement")
        phase.pop("inventory_floor")
        codes = finding_codes(validator.validate(package))
        assert {"PHASE_ACTIONS_MISSING", "PHASE_ATTRIBUTION_REQUIREMENT_MISSING", "PHASE_INVENTORY_FLOOR_INVALID"} <= codes

    @test("binding planned PPC cannot exceed strategy cap")
    def _() -> None:
        package = valid_strategy()
        for scenario in package["economics"]["input_snapshot"]["scenarios"]:
            scenario["planned_ppc_spend"] = 900
        recalculate_package_economics(package)
        assert "PLANNED_PPC_EXCEEDS_TOTAL_CAP" in finding_codes(validator.validate(package))

    @test("authorized manifest cannot propose off-Amazon reach")
    def _() -> None:
        package = valid_strategy()
        package["strategy_status"] = "EXECUTION_AUTHORIZED"
        package["deliverable_mode"] = "EXECUTE"
        package["execution_authority"] = "EXECUTION_AUTHORIZED"
        operation = prepared_ad_operation("NOT_STARTED")
        operation["proposed_value"] = {"onsite_scope": "AMAZON_AND_OFFSITE"}
        package["change_manifest"] = [operation]
        package["authorization_record"] = {"user_confirmed": True, "confirmed_at": iso(FIXTURE_AUTHORIZED), "account_id_masked": "***001", "marketplace": "US", "manifest_hash": validator.manifest_hash(package["change_manifest"]), "prechange_snapshot_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "allowed_operation_ids": ["OP-001"]}
        assert "OFFSITE_CHANGE_PROPOSED" in finding_codes(validator.validate(package))

    @test("authorization must cover every manifest operation")
    def _() -> None:
        package = valid_strategy()
        package["strategy_status"] = "EXECUTION_AUTHORIZED"
        package["deliverable_mode"] = "EXECUTE"
        package["execution_authority"] = "EXECUTION_AUTHORIZED"
        first = prepared_ad_operation("NOT_STARTED")
        second = copy.deepcopy(first)
        second.update({"operation_id": "OP-002", "entity_id": "TARGET-002"})
        package["change_manifest"] = [first, second]
        package["authorization_record"] = {"user_confirmed": True, "confirmed_at": iso(FIXTURE_AUTHORIZED), "account_id_masked": "***001", "marketplace": "US", "manifest_hash": validator.manifest_hash(package["change_manifest"]), "prechange_snapshot_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "allowed_operation_ids": ["OP-001"]}
        assert "AUTHORIZED_OPERATION_SET_MISMATCH" in finding_codes(validator.validate(package))

    @test("camelCase off-Amazon controls cannot bypass authorization")
    def _() -> None:
        operation = prepared_ad_operation("NOT_STARTED")
        operation["proposed_value"] = {"limitReachToAmazon": False}
        assert "OFFSITE_CHANGE_PROPOSED" in finding_codes(validator.validate(authorized_strategy(operation)))

    @test("unsupported non-advertising mutation domains are rejected")
    def _() -> None:
        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({"change_domain": "INVENTORY_OPERATION", "action": "DELETE_ALL_INVENTORY"})
        assert "CHANGE_DOMAIN_INVALID" in finding_codes(validator.validate(authorized_strategy(operation)))

    @test("exact change operations cannot hide empty old and new values")
    def _() -> None:
        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({"current_value": {}, "proposed_value": {}})
        assert "CHANGE_OPERATION_VALUE_EMPTY" in finding_codes(validator.validate(authorized_strategy(operation)))

    @test("zero-capacity learning envelope cannot release a bid")
    def _() -> None:
        package = valid_strategy()
        package["economics"]["approved_learning_loss_envelopes"] = [
            {
                "learning_loss_envelope_id": "LL-001",
                "scope_ad_target_ids": ["AT-KW-001"],
                "approved_by_user": True,
                "approved_at": iso(FIXTURE_CAPTURED),
                "approval_source_id": "SRC-APPROVAL-001",
                "maximum_incremental_loss": 0,
                "maximum_spend": 0,
                "data_or_time_gate": "one bounded review gate",
                "reason": "explicit test hypothesis",
                "stop_conditions": ["cap reached"],
                "rollback_action": "pause target",
            }
        ]
        package["keyword_targets"][0].update({"ceiling_basis": "APPROVED_LEARNING_LOSS", "learning_loss_envelope_id": "LL-001", "proposed_bid": 999, "bid_ceiling": 999})
        package["campaign_architecture"][0]["learning_loss_allocations"] = {"LL-001": 100}
        package["campaign_architecture"][0]["learning_loss_model"] = conservative_learning_model(100)
        codes = finding_codes(validator.validate(package))
        assert "LEARNING_ENVELOPE_ZERO_CAPACITY" in codes and "CAMPAIGN_CAP_EXCEEDS_LEARNING_ENVELOPE" in codes

    @test("positive exact learning envelope can release only its bounded target")
    def _() -> None:
        package = valid_strategy()
        package["economics"]["approved_learning_loss_envelopes"] = [
            {
                "learning_loss_envelope_id": "LL-001",
                "scope_ad_target_ids": ["AT-KW-001"],
                "approved_by_user": True,
                "approved_at": iso(FIXTURE_CAPTURED),
                "approval_source_id": "SRC-APPROVAL-001",
                "maximum_incremental_loss": 50,
                "maximum_spend": 100,
                "data_or_time_gate": "one bounded review gate",
                "reason": "explicit test hypothesis",
                "stop_conditions": ["cap reached"],
                "rollback_action": "pause target",
            }
        ]
        package["keyword_targets"][0].update({"ceiling_basis": "APPROVED_LEARNING_LOSS", "learning_loss_envelope_id": "LL-001", "proposed_bid": 1.5, "bid_ceiling": 1.5})
        package["campaign_architecture"][0]["phase_spend_cap"] = 50
        package["campaign_architecture"][0]["learning_loss_allocations"] = {"LL-001": 50}
        package["campaign_architecture"][0]["learning_loss_model"] = conservative_learning_model(50)
        result = validator.validate(package)
        assert result["plan_ready"] is True, result["findings"]

    @test("campaign cannot reference an excluded target")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0].update({"ad_decision": "EXCLUDE", "ad_role": "EXCLUDE", "proposed_bid": None, "bid_ceiling": None, "ceiling_basis": "UNAVAILABLE"})
        assert "CAMPAIGN_TARGET_NOT_INCLUDED" in finding_codes(validator.validate(package))

    @test("launch orders cannot exceed advertising-available inventory")
    def _() -> None:
        package = valid_strategy()
        package["inventory"].update({"sellable_units": 1, "reserved_units": 0, "safety_stock_units": 0, "stockout_risk": "HIGH"})
        for phase in package["phase_plan"]:
            phase["inventory_floor"] = 0
        for scenario in package["economics"]["input_snapshot"]["scenarios"]:
            scenario.update({"sellable_inventory": 1, "safety_stock_units": 0})
        recalculate_package_economics(package)
        codes = finding_codes(validator.validate(package))
        assert "PLANNED_ORDERS_EXCEED_AVAILABLE_INVENTORY" in codes and "READY_INVENTORY_RISK_UNRESOLVED" in codes

    @test("ordinary ad report cannot prove Amazon-only account control")
    def _() -> None:
        package = valid_strategy()
        package["campaign_architecture"][0]["placement_account_source_id"] = "SRC-ADS-001"
        assert "PLACEMENT_ACCOUNT_PROOF_INVALID" in finding_codes(validator.validate(package))

    @test("existing performance cannot use another account report")
    def _() -> None:
        package = valid_strategy(existing=True)
        next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ADS-001")["account_id_masked"] = "***999"
        assert "PERFORMANCE_SOURCE_SCOPE_MISMATCH" in finding_codes(validator.validate(package))

    @test("target data class cannot outrank its cited sources")
    def _() -> None:
        package = valid_strategy(existing=True)
        package["keyword_targets"][0]["source_ids"] = ["SRC-KW-001"]
        assert "KEYWORD_DATA_CLASS_UNSUPPORTED" in finding_codes(validator.validate(package))

    @test("return reimbursement cannot inflate contribution beyond return costs")
    def _() -> None:
        payload = blank_economics()
        payload.update({"returns_mode": "RATE_MODEL", "return_rate": 0.1, "platform_reimbursement": 1000})
        try:
            economics.calculate(payload)
        except ValueError as exc:
            assert "RETURN_MODEL_NET_CREDIT_UNSUPPORTED" in str(exc)
        else:
            raise AssertionError("Expected return net-credit rejection")

    @test("optimistic binding scenario needs explicit scoped approval")
    def _() -> None:
        package = valid_strategy()
        package["economics"]["binding_scenario_name"] = "OPTIMISTIC"
        assert "OPTIMISTIC_BINDING_NOT_APPROVED" in finding_codes(validator.validate(package))

    @test("optimistic binding can use an exact seller-approved source")
    def _() -> None:
        package = valid_strategy()
        package["economics"].update({"binding_scenario_name": "OPTIMISTIC", "optimistic_binding_approved_by_user": True, "binding_scenario_approval_source_id": "SRC-APPROVAL-001"})
        result = validator.validate(package)
        assert result["plan_ready"] is True, result["findings"]

    @test("hypothesis-only scenario cannot claim traffic readiness")
    def _() -> None:
        package = valid_strategy()
        next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-CONVERSION-001")["data_class"] = "HYPOTHESIS"
        assert "SCENARIO_ONLY_HYPOTHETICAL" in finding_codes(validator.validate(package))

    @test("budget approval must match marketplace currency and account")
    def _() -> None:
        package = valid_strategy()
        next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-APPROVAL-001")["marketplace"] = "DE"
        assert "ECONOMICS_APPROVAL_SCOPE_MISMATCH" in finding_codes(validator.validate(package))

    @test("campaign budget period is mandatory")
    def _() -> None:
        package = valid_strategy()
        package["campaign_architecture"][0].pop("budget_period")
        codes = finding_codes(validator.validate(package))
        assert "CAMPAIGN_FIELD_MISSING" in codes and "CAMPAIGN_BUDGET_PERIOD_INVALID" in codes

    @test("new-product execution review keeps the complete phase state machine")
    def _() -> None:
        package = valid_strategy()
        package.update({"strategy_status": "READY_FOR_EXECUTION_REVIEW", "deliverable_mode": "PREPARE_CHANGES", "execution_authority": "PREPARE_CHANGES"})
        package["phase_plan"] = package["phase_plan"][:1]
        package["change_manifest"] = [prepared_ad_operation("NOT_AUTHORIZED")]
        assert "PHASE_STATE_INVALID" in finding_codes(validator.validate(package))

    @test("every upstream keyword remains in the ad audit trail")
    def _() -> None:
        package = valid_strategy()
        package["upstream_snapshots"]["keyword_library"]["keywords"].append({"source_keyword_id": "KW-002", "library_role": "SECONDARY_VERIFIED", "source_ids": ["SRC-KW-001"], "evidence_ids": ["E-KW-002"]})
        assert "UPSTREAM_KEYWORD_COVERAGE_MISSING" in finding_codes(validator.validate(package))

    @test("downstream keyword cannot replace upstream evidence")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0].update({"source_ids": ["SRC-LIST-001"], "evidence_ids": ["OTHER-EVIDENCE"]})
        assert "UPSTREAM_KEYWORD_EVIDENCE_MISMATCH" in finding_codes(validator.validate(package))

    @test("traffic-ready new product needs real ASIN and SKU")
    def _() -> None:
        package = valid_strategy()
        package["scope"].update({"asin": None, "sku": None})
        assert "NEW_PRODUCT_IDENTITY_NOT_READY" in finding_codes(validator.validate(package))

    @test("source artifact hashes cannot be placeholders")
    def _() -> None:
        package = valid_strategy()
        package["source_artifacts"][0]["sha256"] = "sha256:x"
        assert "SOURCE_ARTIFACT_HASH_INVALID" in finding_codes(validator.validate(package))

    @test("policy and account snapshots cannot be ancient")
    def _() -> None:
        package = valid_strategy()
        package["policy_snapshot"]["verified_at"] = "1970-01-01T00:00:00+00:00"
        package["account_snapshot"]["captured_at"] = "1970-01-01T00:00:00+00:00"
        codes = finding_codes(validator.validate(package))
        assert "POLICY_VERIFICATION_STALE" in codes and "ACCOUNT_SNAPSHOT_STALE" in codes

    @test("official policy sources cover all critical domains")
    def _() -> None:
        package = valid_strategy()
        package["policy_snapshot"]["sources"].remove("SRC-REVIEW-POLICY-001")
        assert "POLICY_DOMAIN_COVERAGE_MISSING" in finding_codes(validator.validate(package))

    @test("inventory and cash approval artifacts must be current")
    def _() -> None:
        package = valid_strategy()
        next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-INVENTORY-001")["version_or_captured_at"] = "1970-01-01T00:00:00+00:00"
        next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-APPROVAL-001")["version_or_captured_at"] = "1970-01-01T00:00:00+00:00"
        codes = finding_codes(validator.validate(package))
        assert "INVENTORY_SOURCE_STALE" in codes and "ECONOMICS_APPROVAL_SOURCE_STALE" in codes

    @test("execution approval requires a fresh pre-change snapshot")
    def _() -> None:
        package = authorized_strategy(confirmed_at=iso(FIXTURE_CAPTURED + timedelta(hours=2, seconds=1)))
        assert "AUTHORIZATION_SNAPSHOT_STALE" in finding_codes(validator.validate(package))

    @test("new-product scenario risk order is monotonic")
    def _() -> None:
        package = valid_strategy()
        pessimistic = next(row for row in package["economics"]["input_snapshot"]["scenarios"] if row["scenario_role"] == "PESSIMISTIC")
        pessimistic["conversion_rate"] = 0.99
        recalculate_package_economics(package)
        assert "NEW_SCENARIO_MONOTONICITY_INVALID" in finding_codes(validator.validate(package))

    @test("scenario evidence domains reject irrelevant keyword sources")
    def _() -> None:
        package = valid_strategy()
        for scenario in package["economics"]["input_snapshot"]["scenarios"]:
            scenario["scenario_source_ids"] = ["SRC-KW-001"]
        assert "SCENARIO_EVIDENCE_DOMAIN_MISSING" in finding_codes(validator.validate(package))

    @test("new-product ACTUAL labels need exact-scope first-party authority")
    def _() -> None:
        package = valid_strategy()
        for scenario in package["economics"]["input_snapshot"]["scenarios"]:
            scenario.update({"conversion_data_class": "ACTUAL", "attributed_sales_data_class": "ACTUAL"})
        recalculate_package_economics(package)
        assert "NEW_PRODUCT_ACTUAL_AUTHORITY_INVALID" in finding_codes(validator.validate(package))

    @test("pre-change snapshot must be fresh relative to prepared package")
    def _() -> None:
        package = valid_strategy()
        package.update({"strategy_status": "READY_FOR_EXECUTION_REVIEW", "deliverable_mode": "PREPARE_CHANGES", "execution_authority": "PREPARE_CHANGES"})
        old_time = iso(FIXTURE_CAPTURED - timedelta(hours=2))
        source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ACCOUNT-001")
        source["version_or_captured_at"] = old_time
        operation = prepared_ad_operation("NOT_AUTHORIZED")
        operation["prechange_captured_at"] = old_time
        package["change_manifest"] = [operation]
        assert "PRECHANGE_SNAPSHOT_STALE_FOR_PACKAGE" in finding_codes(validator.validate(package))

    @test("learning envelope aggregates campaign delivery caps")
    def _() -> None:
        package = valid_strategy()
        second_upstream = {"source_keyword_id": "KW-002", "library_role": "CORE_VERIFIED", "source_ids": ["SRC-KW-001"], "evidence_ids": ["E-KW-002"]}
        package["upstream_snapshots"]["keyword_library"]["keywords"].append(second_upstream)
        second_target = copy.deepcopy(package["keyword_targets"][0])
        second_target.update({"ad_target_id": "AT-KW-002", "source_keyword_id": "KW-002", "evidence_ids": ["E-KW-002"], "learning_loss_envelope_id": "LL-001", "ceiling_basis": "APPROVED_LEARNING_LOSS", "proposed_bid": 1.5, "bid_ceiling": 1.5})
        package["keyword_targets"].append(second_target)
        package["keyword_targets"][0].update({"learning_loss_envelope_id": "LL-001", "ceiling_basis": "APPROVED_LEARNING_LOSS", "proposed_bid": 1.5, "bid_ceiling": 1.5})
        package["economics"]["approved_learning_loss_envelopes"] = [{"learning_loss_envelope_id": "LL-001", "scope_ad_target_ids": ["AT-KW-001", "AT-KW-002"], "approved_by_user": True, "approved_at": iso(FIXTURE_CAPTURED), "approval_source_id": "SRC-APPROVAL-001", "maximum_incremental_loss": 50, "maximum_spend": 100, "data_or_time_gate": "bounded test", "reason": "explicit learning test", "stop_conditions": ["cap reached"], "rollback_action": "pause targets"}]
        first_campaign = package["campaign_architecture"][0]
        first_campaign.update({"phase_spend_cap": 60, "learning_loss_allocations": {"LL-001": 60}, "learning_loss_model": conservative_learning_model(60)})
        second_campaign = copy.deepcopy(first_campaign)
        second_campaign.update({"campaign_plan_id": "CP-002", "source_ad_target_ids": ["AT-KW-002"]})
        package["campaign_architecture"].append(second_campaign)
        assert "LEARNING_ENVELOPE_AGGREGATE_SPEND_EXCEEDED" in finding_codes(validator.validate(package))

    @test("one ad target cannot silently belong to two campaigns")
    def _() -> None:
        package = valid_strategy()
        second = copy.deepcopy(package["campaign_architecture"][0])
        second["campaign_plan_id"] = "CP-002"
        package["campaign_architecture"].append(second)
        assert "TARGET_CAMPAIGN_OWNERSHIP_CONFLICT" in finding_codes(validator.validate(package))

    @test("existing economics rejects incompatible performance bases")
    def _() -> None:
        mutations = {"charge_type": "VCPM", "interaction_scope": "VIEW", "ad_product": "SPONSORED_DISPLAY", "sales_scope": "COMBINED"}
        for field, value in mutations.items():
            package = valid_strategy(existing=True)
            package["performance_snapshots"][0][field] = value
            codes = finding_codes(validator.validate(package))
            assert "ECONOMICS_PERFORMANCE_BASIS_MISMATCH" in codes or "PERFORMANCE_CAMPAIGN_PRODUCT_MISMATCH" in codes, (field, codes)

    @test("performance dates must be parseable and ordered")
    def _() -> None:
        package = valid_strategy(existing=True)
        package["performance_snapshots"][0].update({"window_start": "not-a-date", "window_end": "2099-01-01"})
        codes = finding_codes(validator.validate(package))
        assert "PERFORMANCE_DATE_INVALID" in codes and "PERFORMANCE_DATE_ORDER_INVALID" in codes

    @test("Vine units require enough reserved inventory")
    def _() -> None:
        package = valid_strategy()
        configure_vine(package, units=10, reserved_units=5, active_method=True)
        assert "VINE_UNIT_RESERVATION_MISMATCH" in finding_codes(validator.validate(package))

    @test("Vine units require matching compliant method state")
    def _() -> None:
        package = valid_strategy()
        configure_vine(package, units=10, reserved_units=10, active_method=False)
        assert "VINE_METHOD_STATE_MISMATCH" in finding_codes(validator.validate(package))

    @test("onsite price and Coupon rows reconcile to binding economics")
    def _() -> None:
        package = valid_strategy()
        package["onsite_support"]["effective_price"].update({"amount": 1, "currency": "CAD"})
        package["onsite_support"]["coupons_or_deals"][0]["economic_discount_per_modeled_order"] = 80
        codes = finding_codes(validator.validate(package))
        assert "ONSITE_PRICE_ECONOMICS_MISMATCH" in codes and "ONSITE_PROMOTION_COST_UNMODELED" in codes

    @test("campaign placement verification timestamp cannot be ancient")
    def _() -> None:
        package = valid_strategy()
        package["campaign_architecture"][0]["placement_verified_at"] = "1970-01-01T00:00:00+00:00"
        assert "PLACEMENT_VERIFICATION_STALE" in finding_codes(validator.validate(package))

    @test("off-Amazon camelCase aliases cannot bypass final-state checks")
    def _() -> None:
        for proposed in ({"offAmazonEnabled": True}, {"limitReachToAmazonEnabled": False}, {"reachOnAmazonOnly": False}, {"isOffAmazon": True}):
            operation = prepared_ad_operation("NOT_STARTED")
            operation["proposed_value"] = proposed
            codes = finding_codes(validator.validate(authorized_strategy(operation)))
            assert "OFFSITE_CHANGE_PROPOSED" in codes, (proposed, codes)

    @test("nested off-Amazon control payloads are rejected without crashing")
    def _() -> None:
        for proposed in ({"offAmazonSettings": {"enabled": True}}, {"limitReachToAmazonEnabled": [False]}):
            operation = prepared_ad_operation("NOT_STARTED")
            operation["proposed_value"] = proposed
            result = validator.validate(authorized_strategy(operation))
            assert "OFFSITE_CHANGE_PROPOSED" in finding_codes(result), (proposed, result)

    @test("bid-only change cannot inherit an off-Amazon current state")
    def _() -> None:
        operation = prepared_ad_operation("NOT_STARTED")
        operation["current_value"] = {"bid": 1.0, "limitReachToAmazon": False}
        assert "OFFSITE_FINAL_STATE_PROPOSED" in finding_codes(validator.validate(authorized_strategy(operation)))

    @test("old authorization expires against validator runtime")
    def _() -> None:
        package = authorized_strategy(confirmed_at=iso(FIXTURE_NOW - timedelta(hours=2)))
        assert "AUTHORIZATION_RUNTIME_EXPIRED" in finding_codes(validator.validate(package))

    @test("placeholder account and entity identities are rejected")
    def _() -> None:
        package = valid_strategy()
        package["scope"]["account_id_masked"] = "..."
        for source in package["source_artifacts"]:
            if source.get("account_id_masked") == "***001":
                source["account_id_masked"] = "..."
        assert "ACCOUNT_SCOPE_IDENTITY_MISSING" in finding_codes(validator.validate(package))
        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({"operation_id": "...", "entity_id": "..."})
        codes = finding_codes(validator.validate(authorized_strategy(operation)))
        assert "CHANGE_OPERATION_ID_MISSING" in codes and "CHANGE_OPERATION_IDENTITY_INVALID" in codes

    @test("full-workflow source manifests and Listing hash are mandatory")
    def _() -> None:
        package = valid_strategy()
        package["upstream_snapshots"]["selection"]["source_artifact_ids"] = []
        package["upstream_snapshots"]["listing_release"]["sha256"] = "sha256:" + "f" * 64
        codes = finding_codes(validator.validate(package))
        assert "UPSTREAM_SOURCE_BINDING_MISSING" in codes and "LISTING_RELEASE_HASH_MISMATCH" in codes

    @test("manual campaigns need targets and coherent ad roles")
    def _() -> None:
        package = valid_strategy()
        package["campaign_architecture"][0]["source_ad_target_ids"] = []
        package["keyword_targets"][0]["ad_role"] = "EXCLUDE"
        codes = finding_codes(validator.validate(package))
        assert "MANUAL_CAMPAIGN_TARGETS_MISSING" in codes and "AD_ROLE_DECISION_CONTRADICTION" in codes

    @test("routing references must resolve to auditable rules")
    def _() -> None:
        package = valid_strategy()
        package["campaign_architecture"][0]["negative_routing_rule_ids"] = ["RR-MISSING"]
        package["keyword_targets"][0]["negative_routing"] = ["RR-MISSING"]
        codes = finding_codes(validator.validate(package))
        assert "CAMPAIGN_ROUTING_RULE_UNKNOWN" in codes and "TARGET_ROUTING_RULE_UNKNOWN" in codes

    @test("local validator never authenticates a live execution grant")
    def _() -> None:
        result = validator.validate(authorized_strategy())
        assert result["authorization_record_structurally_valid"] is True, result["findings"]
        assert result["execution_authorized"] is False and result["trusted_external_grant_required"] is True

    @test("provisional package keeps real gaps as warnings")
    def _() -> None:
        package = valid_strategy()
        package["strategy_status"] = "PROVISIONAL"
        for field in validator.UPSTREAM_IDS:
            package[field] = None
        package["economics"]["approved_cash_exposure"] = None
        package["economics"]["approved_cash_exposure_source_id"] = None
        package["inventory"]["reserved_units"] = None
        package["onsite_support"]["cost_ledger"]["inventory_and_cash"]["reserved_units"] = None
        package["onsite_support"]["cost_ledger"]["inventory_and_cash"]["approved_cash_exposure"] = None
        result = validator.validate(package)
        codes = finding_codes(result)
        assert result["structurally_valid"] is True, result["findings"]
        assert result["plan_ready"] is False
        assert {"STABLE_ID_GAP", "CASH_EXPOSURE_GAP", "NEW_INVENTORY_GAP"} <= codes
        assert all(row["severity"] == "WARNING" for row in result["findings"] if row["code"] in {"STABLE_ID_GAP", "CASH_EXPOSURE_GAP", "NEW_INVENTORY_GAP"})

    @test("selection run alias mismatch is rejected")
    def _() -> None:
        package = valid_strategy()
        package["id_aliases"][0]["source_value"] = "OTHER-RUN"
        assert "ID_ALIAS_MISMATCH" in finding_codes(validator.validate(package))

    @test("unknown reach supply and inventory payload fields fail closed")
    def _() -> None:
        payloads = (
            {"reachBeyondAmazon": True},
            {"externalSitesEnabled": True},
            {"supplySource": "THIRD_PARTY"},
            {"inventoryScope": "AMAZON_AND_PARTNER_SITES"},
            {"settings": {"publisherNetwork": "PARTNER_SITES"}},
        )
        for payload in payloads:
            operation = prepared_ad_operation("NOT_STARTED")
            operation["proposed_value"] = payload
            codes = finding_codes(validator.validate(authorized_strategy(operation)))
            assert "CHANGE_FIELD_NOT_ALLOWLISTED" in codes and ("OFFSITE_FIELD_UNRECOGNIZED" in codes or "OFFSITE_CHANGE_PROPOSED" in codes), (payload, codes)

    @test("safe normalized Amazon-only nested controls remain valid")
    def _() -> None:
        payloads = (
            {"offAmazonSettings": {"enabled": False}},
            {"limitReachToAmazon": {"enabled": True}},
            {"offAmazonPlacements": []},
        )
        for payload in payloads:
            operation = prepared_ad_operation("NOT_STARTED")
            operation.update({"entity_type": "CAMPAIGN", "entity_id": "CAMPAIGN-001", "current_value": copy.deepcopy(payload)})
            operation["proposed_value"] = payload
            result = validator.validate(authorized_strategy(operation))
            assert result["authorization_record_structurally_valid"] is True, (payload, result["findings"])

    @test("prepared operations require the closed payload schema version")
    def _() -> None:
        operation = prepared_ad_operation("NOT_STARTED")
        operation.pop("payload_schema_version")
        assert "CHANGE_PAYLOAD_SCHEMA_INVALID" in finding_codes(validator.validate(authorized_strategy(operation)))

    @test("learning loss cannot be self-reported below full campaign spend")
    def _() -> None:
        package = valid_strategy()
        configure_keyword_learning(package, cap=100, maximum_spend=100, maximum_loss=1)
        package["campaign_architecture"][0]["learning_loss_allocations"] = {"LL-001": 1}
        package["campaign_architecture"][0]["learning_loss_model"].update({"modeled_spend_at_cap": 1, "modeled_loss_at_cap": 1})
        assert "LEARNING_LOSS_NOT_RECONCILED" in finding_codes(validator.validate(package))

    @test("learning loss model version and single-envelope contract are mandatory")
    def _() -> None:
        package = valid_strategy()
        configure_keyword_learning(package)
        package["campaign_architecture"][0]["learning_loss_model"].pop("model_version")
        assert "LEARNING_LOSS_MODEL_MISSING" in finding_codes(validator.validate(package))

        package = valid_strategy()
        keyword_source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-KW-001")
        keyword_source["keyword_scope_ids"].append("KW-002")
        package["upstream_snapshots"]["keyword_library"]["keywords"].append({"source_keyword_id": "KW-002", "library_role": "CORE_VERIFIED", "source_ids": ["SRC-KW-001"], "evidence_ids": ["E-KW-002"]})
        second_target = copy.deepcopy(package["keyword_targets"][0])
        second_target.update({"ad_target_id": "AT-KW-002", "source_keyword_id": "KW-002", "evidence_ids": ["E-KW-002"], "ceiling_basis": "APPROVED_LEARNING_LOSS", "learning_loss_envelope_id": "LL-002"})
        package["keyword_targets"].append(second_target)
        configure_keyword_learning(package)
        package["economics"]["approved_learning_loss_envelopes"].append({
            "learning_loss_envelope_id": "LL-002", "scope_ad_target_ids": ["AT-KW-002"], "approved_by_user": True,
            "approved_at": iso(FIXTURE_CAPTURED), "approval_source_id": "SRC-APPROVAL-001", "maximum_incremental_loss": 100,
            "maximum_spend": 100, "data_or_time_gate": "bounded", "reason": "test", "stop_conditions": ["cap"], "rollback_action": "pause",
        })
        package["campaign_architecture"][0]["source_ad_target_ids"] = ["AT-KW-001", "AT-KW-002"]
        package["campaign_architecture"][0]["learning_loss_allocations"] = {"LL-001": 100, "LL-002": 100}
        assert "LEARNING_CAMPAIGN_MULTI_ENVELOPE_UNSUPPORTED" in finding_codes(validator.validate(package))

    @test("learning approval timestamps must be current and artifact-supported")
    def _() -> None:
        package = valid_strategy()
        configure_keyword_learning(package, approved_at="1970-01-01T00:00:00+00:00")
        assert "LEARNING_APPROVAL_STALE" in finding_codes(validator.validate(package))

        package = valid_strategy()
        configure_keyword_learning(package, approved_at=iso(FIXTURE_CAPTURED + timedelta(hours=1)))
        assert "LEARNING_APPROVAL_TIME_INVALID" in finding_codes(validator.validate(package))

        package = valid_strategy()
        approval_source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-APPROVAL-001")
        approval_source["version_or_captured_at"] = iso(FIXTURE_CAPTURED - timedelta(hours=2))
        configure_keyword_learning(package, approved_at=iso(FIXTURE_CAPTURED))
        assert "LEARNING_APPROVAL_TIME_INVALID" in finding_codes(validator.validate(package))

    @test("binding existing performance requires exact scope and 24-hour freshness")
    def _() -> None:
        package = valid_strategy(existing=True)
        package["performance_snapshots"][0]["scope_id"] = "OTHER-SKU"
        assert "PERFORMANCE_SOURCE_ENTITY_SCOPE_MISMATCH" in finding_codes(validator.validate(package))

        package = valid_strategy(existing=True)
        source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ADS-001")
        source["scope_id"] = "OTHER-SKU"
        assert "PERFORMANCE_SOURCE_ENTITY_SCOPE_MISMATCH" in finding_codes(validator.validate(package))

        package = valid_strategy(existing=True)
        package["performance_snapshots"][0]["report_generated_at"] = iso(FIXTURE_CAPTURED - timedelta(days=2))
        assert "PERFORMANCE_SOURCE_STALE" in finding_codes(validator.validate(package))

        package = valid_strategy(existing=True)
        source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ADS-001")
        source["version_or_captured_at"] = iso(FIXTURE_CAPTURED - timedelta(days=2))
        assert "PERFORMANCE_SOURCE_STALE" in finding_codes(validator.validate(package))

    @test("irrelevant first-party sources cannot elevate target evidence")
    def _() -> None:
        package = valid_strategy()
        package["keyword_targets"][0].update({"data_class": "FIRST_PARTY", "source_ids": ["SRC-KW-001", "SRC-INVENTORY-001"]})
        assert "KEYWORD_DATA_CLASS_UNSUPPORTED" in finding_codes(validator.validate(package))

        package = valid_strategy()
        package["product_targets"][0].update({"data_class": "FIRST_PARTY", "source_ids": ["SRC-COMP-001", "SRC-INVENTORY-001"]})
        assert "PRODUCT_DATA_CLASS_UNSUPPORTED" in finding_codes(validator.validate(package))

    @test("irrelevant first-party inventory cannot elevate scenario confidence")
    def _() -> None:
        package = valid_strategy()
        for scenario in package["economics"]["input_snapshot"]["scenarios"]:
            scenario.update({"scenario_confidence": "HIGH", "scenario_source_ids": ["SRC-CONVERSION-001", "SRC-INVENTORY-001"]})
        assert "SCENARIO_HIGH_CONFIDENCE_UNSUPPORTED" in finding_codes(validator.validate(package))

    @test("economics evidence enforces scope and artifact-class pairing")
    def _() -> None:
        package = valid_strategy()
        source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ECON-001")
        source["scope_id"] = "OTHER-SKU"
        assert "ECONOMICS_EVIDENCE_SOURCE_SCOPE_MISMATCH" in finding_codes(validator.validate(package))

        package = valid_strategy()
        source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ECON-001")
        source["data_class"] = "OFFICIAL_POLICY"
        assert "ECONOMICS_EVIDENCE_SOURCE_CLASS_INVALID" in finding_codes(validator.validate(package))

    @test("keyword evidence cannot impersonate price promotion or Vine proof")
    def _() -> None:
        package = valid_strategy()
        package["onsite_support"]["effective_price"]["source_artifact_ids"] = ["SRC-KW-001"]
        package["onsite_support"]["coupons_or_deals"][0]["source_artifact_ids"] = ["SRC-KW-001"]
        assert "ONSITE_SOURCE_SEMANTICS_INVALID" in finding_codes(validator.validate(package))

        package = valid_strategy()
        configure_vine(package, units=10, reserved_units=10, active_method=True)
        package["onsite_support"]["vine"]["source_artifact_ids"] = ["SRC-KW-001", "SRC-ECON-001"]
        assert "VINE_SUPPORT_SOURCES_INVALID" in finding_codes(validator.validate(package))

    @test("all-in break-even ACoS participates in scenario monotonicity")
    def _() -> None:
        package = valid_strategy()
        base = next(row for row in package["economics"]["input_snapshot"]["scenarios"] if row["scenario_role"] == "BASE")
        base["coupon_fixed_fee"] = 1000
        recalculate_package_economics(package)
        assert "NEW_SCENARIO_MONOTONICITY_INVALID" in finding_codes(validator.validate(package))

    @test("cloned source keyword requires explicit cross-campaign routing")
    def _() -> None:
        package = valid_strategy()
        second_target = copy.deepcopy(package["keyword_targets"][0])
        second_target["ad_target_id"] = "AT-KW-002"
        package["keyword_targets"].append(second_target)
        second_campaign = copy.deepcopy(package["campaign_architecture"][0])
        second_campaign.update({"campaign_plan_id": "CP-002", "source_ad_target_ids": ["AT-KW-002"]})
        package["campaign_architecture"].append(second_campaign)
        assert "DUPLICATE_SOURCE_KEYWORD_ROUTING_MISSING" in finding_codes(validator.validate(package))

    @test("future planned nonbinding Coupon does not alter binding economics")
    def _() -> None:
        package = valid_strategy()
        future_row = copy.deepcopy(package["onsite_support"]["coupons_or_deals"][0])
        future_row.update({
            "support_id": "CPN-FUTURE-001", "economics_application": "PLANNED_NOT_IN_BINDING",
            "economic_discount_per_modeled_order": 50, "fee_per_modeled_order": 2, "fixed_fee": 100,
            "planned_start_at": "2099-01-01T00:00:00+00:00",
        })
        package["onsite_support"]["coupons_or_deals"].append(future_row)
        result = validator.validate(package)
        assert result["plan_ready"] is True, result["findings"]

    @test("independent lineage reaches plan readiness without frozen selection-stage IDs")
    def _() -> None:
        package = valid_strategy()
        package["lineage_mode"] = "INDEPENDENT_NEW"
        for key in ("project_id", "selection_run_id", "candidate_id"):
            package.pop(key, None)
        package["upstream_snapshots"].pop("selection", None)
        for snapshot in package["upstream_snapshots"].values():
            if isinstance(snapshot, dict):
                for key in ("project_id", "selection_run_id", "candidate_id"):
                    snapshot.pop(key, None)
        package["independent_scope"] = {
            "reason": "选品阶段已冻结，按独立范围制定",
            "source_scope_id": "范围-狗碗-蓝",
            "source_artifact_ids": [package["source_artifacts"][0]["source_artifact_id"]],
        }
        result = validator.validate(package)
        assert result["plan_ready"] is True, result["findings"]

    @test("Chinese free text is not mistaken for a placeholder")
    def _() -> None:
        assert validator.nonplaceholder("选品阶段已冻结") is True
        assert validator.nonplaceholder("——") is False
        assert validator.nonplaceholder("000") is False

    @test("expanded placeholder identities are rejected")
    def _() -> None:
        for placeholder in ("TBD-001", "???", "---", "***", "000", "SAMPLE-ID"):
            package = valid_strategy()
            package["project_id"] = placeholder
            assert "STABLE_ID_GAP" in finding_codes(validator.validate(package)), placeholder

    @test("malformed valid JSON types always fail closed without authority")
    def _() -> None:
        cases = (
            (("strategy_status",), {}),
            (("deliverable_mode",), []),
            (("source_artifacts", 0, "source_artifact_id"), {}),
            (("keyword_targets", 0, "source_keyword_id"), []),
            (("campaign_architecture", 0, "source_ad_target_ids", 0), {}),
            (("economics", "input_evidence_source_ids", 0), []),
            (("review_compliance", "methods"), {}),
            (("source_artifacts", 0, "marketplace"), {}),
            (("inventory", "reorder_state"), []),
        )

        def set_path(value: dict[str, Any], path: tuple[Any, ...], replacement: Any) -> None:
            cursor: Any = value
            for key in path[:-1]:
                cursor = cursor[key]
            cursor[path[-1]] = replacement

        for path, replacement in cases:
            package = valid_strategy(existing=True)
            set_path(package, path, copy.deepcopy(replacement))
            result = validator.validate(package)
            assert result["structurally_valid"] is False, (path, result)
            assert result["plan_ready"] is False and result["execution_review_ready"] is False
            assert result["authorization_record_structurally_valid"] is False and result["execution_authorized"] is False

    @test("campaign targeting type must be canonical for its ad product")
    def _() -> None:
        for targeting_type in ({}, [], None, "AUDIENCE"):
            package = valid_strategy()
            package["campaign_architecture"][0]["targeting_type"] = copy.deepcopy(targeting_type)
            result = validator.validate(package)
            assert "CAMPAIGN_TARGETING_TYPE_INVALID" in finding_codes(result), (targeting_type, result)
            assert result["plan_ready"] is False and result["execution_authorized"] is False

    @test("included keyword targets require a canonical targeting expression")
    def _() -> None:
        for targeting_expression in ({}, [], None, "NEGATIVE_EXACT"):
            package = valid_strategy()
            package["keyword_targets"][0]["targeting_expression"] = copy.deepcopy(targeting_expression)
            result = validator.validate(package)
            assert "KEYWORD_TARGETING_EXPRESSION_INVALID" in finding_codes(result), (targeting_expression, result)
            assert result["plan_ready"] is False and result["execution_authorized"] is False

    @test("campaign target ownership must match targeting schema")
    def _() -> None:
        cases = (
            ("SPONSORED_PRODUCTS", "AUTOMATIC"),
            ("SPONSORED_DISPLAY", "AUDIENCE"),
            ("SPONSORED_DISPLAY", "CONTEXTUAL_PRODUCT"),
        )
        for ad_product, targeting_type in cases:
            package = valid_strategy()
            campaign = package["campaign_architecture"][0]
            campaign.update({"ad_product": ad_product, "targeting_type": targeting_type})
            for source_id in ("SRC-PLACEMENT-001", "SRC-ACCOUNT-001"):
                source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == source_id)
                source["ad_products"] = [ad_product]
                if source_id == "SRC-ACCOUNT-001":
                    source["onsite_only_controls"] = {ad_product: "VERIFIED_CURRENT"}
            package["account_snapshot"]["ad_products"] = {ad_product: "ELIGIBLE"}
            package["account_snapshot"]["onsite_only_controls"] = {ad_product: "VERIFIED_CURRENT"}
            result = validator.validate(package)
            expected = "CAMPAIGN_TARGET_TYPE_MISMATCH" if targeting_type == "CONTEXTUAL_PRODUCT" else "CAMPAIGN_TARGET_SCHEMA_UNSUPPORTED"
            assert expected in finding_codes(result), (ad_product, targeting_type, result)
            assert "INCLUDED_TARGET_CAMPAIGN_MISSING" in finding_codes(result), (ad_product, targeting_type, result)
            assert result["plan_ready"] is False and result["execution_authorized"] is False

    @test("optional source scope fields and inventory state reject malformed types")
    def _() -> None:
        for source_value in ({}, [], None):
            package = valid_strategy()
            package["source_artifacts"][0]["marketplace"] = copy.deepcopy(source_value)
            assert "SOURCE_ARTIFACT_SCOPE_FIELD_INVALID" in finding_codes(validator.validate(package)), source_value
        for reorder_state in ({}, [], None):
            package = valid_strategy()
            package["inventory"]["reorder_state"] = copy.deepcopy(reorder_state)
            assert "REORDER_STATE_INVALID" in finding_codes(validator.validate(package)), reorder_state

    @test("existing decision rules cannot cite an incompatible performance basis")
    def _() -> None:
        package = valid_strategy(existing=True)
        diagnostic = copy.deepcopy(package["performance_snapshots"][0])
        diagnostic.update({"performance_snapshot_id": "PS-002", "charge_type": "VCPM", "interaction_scope": "VIEW"})
        package["performance_snapshots"].append(diagnostic)
        package["decision_rules"][0]["source_snapshot_ids"] = ["PS-002"]
        assert "DECISION_RULE_PERFORMANCE_BASIS_MISMATCH" in finding_codes(validator.validate(package))

    @test("actual business totals require exact-period evidence and reconciliation")
    def _() -> None:
        for field in ("actual_total_sales", "actual_attributed_contribution_total", "actual_total_contribution_before_ads"):
            package = valid_strategy(existing=True)
            package["economics"]["input_snapshot"][field] = 999999999
            package["economics"]["calculator_result"] = economics.calculate(package["economics"]["input_snapshot"])
            result = validator.validate(package)
            assert "ACTUAL_BUSINESS_RECONCILIATION_MISMATCH" in finding_codes(result), (field, result)
            assert result["plan_ready"] is False

        package = valid_strategy(existing=True)
        package["economics"]["actual_business_source_ids"] = []
        assert "ACTUAL_BUSINESS_SOURCE_MISSING" in finding_codes(validator.validate(package))

        package = valid_strategy(existing=True)
        contribution_source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-CONTRIBUTION-001")
        contribution_source["derived_source_ids"] = ["SRC-BUSINESS-001"]
        assert "ACTUAL_CONTRIBUTION_NORMALIZATION_INVALID" in finding_codes(validator.validate(package))

    @test("optional actual business totals may remain unavailable without invented evidence")
    def _() -> None:
        package = valid_strategy(existing=True)
        for field in ("actual_total_sales", "actual_attributed_contribution_total", "actual_total_contribution_before_ads"):
            package["economics"]["input_snapshot"][field] = None
        package["economics"]["actual_business_source_ids"] = []
        package["economics"]["calculator_result"] = economics.calculate(package["economics"]["input_snapshot"])
        result = validator.validate(package)
        assert result["plan_ready"] is True, result["findings"]
        assert result["execution_authorized"] is False

    @test("change payloads must be normalized JSON objects")
    def _() -> None:
        for current_value, proposed_value in ((1, 2), ("old", "new"), (True, False), ([1], [2])):
            operation = prepared_ad_operation("NOT_STARTED")
            operation.update({"current_value": current_value, "proposed_value": proposed_value})
            result = validator.validate(authorized_strategy(operation))
            assert "CHANGE_PAYLOAD_TYPE_INVALID" in finding_codes(result), (current_value, proposed_value, result)
            assert result["authorization_record_structurally_valid"] is False

    @test("generic discriminator payloads cannot encode unknown networks")
    def _() -> None:
        operation = prepared_ad_operation("NOT_STARTED")
        operation["proposed_value"] = {"type": "INVENTORY_DISTRIBUTION", "value": "EXTERNAL_PUBLISHERS"}
        result = validator.validate(authorized_strategy(operation))
        assert "CHANGE_FIELD_NOT_ALLOWLISTED" in finding_codes(result)
        assert result["authorization_record_structurally_valid"] is False

    @test("change action entity and payload matrix fails closed")
    def _() -> None:
        cases = (
            ("ADD_NEGATIVE", "CAMPAIGN", {"bid": 1.2}, "CHANGE_ACTION_ENTITY_MISMATCH"),
            ("REMOVE_NEGATIVE", "TARGET", {"bid": 1.2}, "CHANGE_ACTION_ENTITY_MISMATCH"),
            ("ARCHIVE", "NEGATIVE_KEYWORD", {"bid": 1.2}, "CHANGE_PAYLOAD_SEMANTICS_INVALID"),
            ("CREATE", "TARGET", {"bid": 1.2}, "CHANGE_PAYLOAD_SEMANTICS_INVALID"),
            ("UPDATE", "CAMPAIGN", {"keywordText": "warmers"}, "CHANGE_PAYLOAD_SEMANTICS_INVALID"),
        )
        for action, entity_type, proposed_value, expected_code in cases:
            operation = prepared_ad_operation("NOT_STARTED")
            operation.update({"action": action, "entity_type": entity_type, "current_value": {"bid": 1.0}, "proposed_value": proposed_value})
            result = validator.validate(authorized_strategy(operation))
            assert expected_code in finding_codes(result), (action, entity_type, result)
            assert result["authorization_record_structurally_valid"] is False

    @test("closed change matrix accepts only normalized supported operations")
    def _() -> None:
        cases = (
            ("ENABLE", "CAMPAIGN", {"state": "PAUSED"}, {"state": "ENABLED"}),
            ("CREATE", "KEYWORD", {"state": "ABSENT"}, {"keywordText": "portable cable organizer", "matchType": "EXACT", "bid": 1.2}),
            ("CREATE", "PRODUCT_TARGET", {"state": "ABSENT"}, {"targetingExpression": {"asinSameAs": "B098765432"}, "bid": 1.2}),
            ("ADD_NEGATIVE", "NEGATIVE_KEYWORD", {"state": "ABSENT"}, {"negativeKeywordText": "free", "matchType": "NEGATIVE_EXACT"}),
            ("REMOVE_NEGATIVE", "NEGATIVE_KEYWORD", {"negativeKeywordText": "free", "matchType": "NEGATIVE_EXACT"}, {"status": "REMOVED"}),
            ("ARCHIVE", "NEGATIVE_KEYWORD", {"status": "ENABLED"}, {"status": "ARCHIVED"}),
        )
        for index, (action, entity_type, current_value, proposed_value) in enumerate(cases, start=1):
            operation = prepared_ad_operation("NOT_STARTED")
            operation.update({
                "operation_id": f"OP-{index:03d}", "action": action, "entity_type": entity_type,
                "entity_id": f"ENTITY-{index:03d}", "current_value": current_value, "proposed_value": proposed_value,
            })
            package = authorized_strategy(operation)
            if entity_type == "PRODUCT_TARGET":
                package["keyword_targets"][0].update({
                    "ad_role": "OBSERVE",
                    "ad_decision": "OBSERVE",
                    "proposed_bid": None,
                    "bid_ceiling": None,
                    "ceiling_basis": "UNAVAILABLE",
                })
                package["product_targets"][0].update({
                    "ad_role": "PRODUCT_TARGET_TEST",
                    "ad_decision": "INCLUDE",
                    "proposed_bid": 1.2,
                    "bid_ceiling": 1.95,
                    "ceiling_basis": "TARGET_PROFIT",
                })
                package["campaign_architecture"][0].update({
                    "targeting_type": "MANUAL_PRODUCT",
                    "source_ad_target_ids": ["AT-ASIN-001"],
                })
            result = validator.validate(package)
            assert result["authorization_record_structurally_valid"] is True, (action, entity_type, result["findings"])

    @test("performance entity scope and attribution window use closed verified values")
    def _() -> None:
        package = valid_strategy(existing=True)
        package["economics"]["performance_basis"]["entity_scope"] = "UNICORN"
        package["performance_snapshots"][0]["entity_scope"] = "UNICORN"
        assert "PERFORMANCE_ENTITY_SCOPE_INVALID" in finding_codes(validator.validate(package))

        package = valid_strategy(existing=True)
        package["economics"]["performance_basis"]["attribution_window"] = "FOREVER"
        package["performance_snapshots"][0]["attribution_window"] = "FOREVER"
        assert "PERFORMANCE_ATTRIBUTION_WINDOW_UNVERIFIED" in finding_codes(validator.validate(package))

    @test("declared readiness gaps cannot hide inside PLAN_READY")
    def _() -> None:
        package = valid_strategy()
        package["policy_snapshot"]["unverified_boundaries"] = ["Amazon-only control unavailable"]
        assert "POLICY_BOUNDARY_UNRESOLVED" in finding_codes(validator.validate(package))

        package = valid_strategy()
        package["unknowns"] = ["Unit cost unknown"]
        assert "READINESS_UNKNOWN_INVALID" in finding_codes(validator.validate(package))

        package = valid_strategy()
        package["unknowns"] = [{"domain": "UNIT_COST", "status": "UNRESOLVED", "readiness_impact": "BLOCKING", "source_ids": ["SRC-ECON-001"]}]
        assert "READINESS_UNKNOWN_UNRESOLVED" in finding_codes(validator.validate(package))

        package = valid_strategy()
        package["source_coverage"] = {"missing": ["half the targets"]}
        assert "SOURCE_COVERAGE_INVALID" in finding_codes(validator.validate(package))

        package = valid_strategy(existing=True)
        package["performance_snapshots"][0]["coverage_gaps"] = ["half targets missing"]
        assert "PERFORMANCE_COVERAGE_GAP_INVALID" in finding_codes(validator.validate(package))

        package = valid_strategy(existing=True)
        package["performance_snapshots"][0]["coverage_gaps"] = [{"domain": "TARGET_COVERAGE", "status": "UNRESOLVED", "readiness_impact": "BLOCKING", "source_ids": ["SRC-ADS-001"]}]
        assert "PERFORMANCE_COVERAGE_GAP_UNRESOLVED" in finding_codes(validator.validate(package))

    @test("accepted nonblocking structured gaps remain auditable")
    def _() -> None:
        package = valid_strategy()
        package["unknowns"] = [{"domain": "OPTIONAL_NOTE", "status": "ACCEPTED_NON_BLOCKING", "readiness_impact": "NON_BLOCKING", "source_ids": ["SRC-ECON-001"]}]
        package["source_coverage"]["gaps"] = [{"domain": "OPTIONAL_CONTEXT", "status": "ACCEPTED_NON_BLOCKING", "readiness_impact": "NON_BLOCKING", "source_ids": ["SRC-KW-001"]}]
        result = validator.validate(package)
        assert result["plan_ready"] is True, result["findings"]

    @test("change payload leaf values and campaign targeting compatibility are closed")
    def _() -> None:
        malformed_updates = (
            ("state", {}, []),
            ("status", [], {}),
            ("name", {}, []),
            ("targetingType", {}, []),
            ("onsiteScope", [], {}),
            ("placementScope", {}, []),
            ("reachScope", [], {}),
            ("offAmazonEnabled", {}, []),
            ("startDate", {}, []),
            ("bidStrategy", {}, []),
        )
        for field, current_value, proposed_value in malformed_updates:
            operation = prepared_ad_operation("NOT_STARTED")
            operation.update({
                "entity_type": "CAMPAIGN",
                "entity_id": "CAMPAIGN-001",
                "current_value": {field: current_value},
                "proposed_value": {field: proposed_value},
            })
            result = validator.validate(authorized_strategy(operation))
            assert "CHANGE_PAYLOAD_SEMANTICS_INVALID" in finding_codes(result), (field, result)
            assert result["authorization_record_structurally_valid"] is False

        for proposed in (
            {"name": "x", "adProduct": "SPONSORED_PRODUCTS", "targetingType": "AUDIENCE"},
            {"name": "x", "adProduct": "SPONSORED_PRODUCTS", "targetingType": "UNICORN"},
            {"name": [], "adProduct": "SPONSORED_PRODUCTS", "targetingType": "MANUAL_KEYWORD"},
            {"name": "x", "adProduct": "SPONSORED_PRODUCTS", "targetingType": {}},
        ):
            operation = prepared_ad_operation("NOT_STARTED")
            operation.update({
                "action": "CREATE",
                "entity_type": "CAMPAIGN",
                "entity_id": "CAMPAIGN-NEW",
                "current_value": {"state": "ABSENT"},
                "proposed_value": proposed,
            })
            result = validator.validate(authorized_strategy(operation))
            assert "CHANGE_PAYLOAD_SEMANTICS_INVALID" in finding_codes(result), (proposed, result)
            assert result["authorization_record_structurally_valid"] is False

        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({
            "action": "CREATE",
            "entity_type": "CAMPAIGN",
            "entity_id": "CAMPAIGN-NEW",
            "current_value": {"state": "ABSENT"},
            "proposed_value": {"name": "launch", "adProduct": "SPONSORED_PRODUCTS", "targetingType": "MANUAL_KEYWORD"},
        })
        assert validator.validate(authorized_strategy(operation))["authorization_record_structurally_valid"] is True

    @test("full workflow snapshots require nested lineage and Listing metadata")
    def _() -> None:
        snapshot_names = ("selection", "competitor_lock", "keyword_library", "listing_release")
        for snapshot_name in snapshot_names:
            for field in ("project_id", "candidate_id"):
                for malformed in ({}, [], None):
                    package = valid_strategy()
                    package["upstream_snapshots"][snapshot_name][field] = copy.deepcopy(malformed)
                    assert "UPSTREAM_SNAPSHOT_ID_GAP" in finding_codes(validator.validate(package)), (snapshot_name, field, malformed)
        for field in ("path", "captured_at"):
            for malformed in ({}, [], None):
                package = valid_strategy()
                package["upstream_snapshots"]["listing_release"][field] = copy.deepcopy(malformed)
                assert "LISTING_RELEASE_METADATA_INVALID" in finding_codes(validator.validate(package)), (field, malformed)

    @test("campaign and phase control arrays require meaningful string members")
    def _() -> None:
        for field in ("entry_gates", "exit_gates", "rollback_conditions"):
            for malformed in ({}, [], None):
                package = valid_strategy()
                package["campaign_architecture"][0][field] = [copy.deepcopy(malformed)]
                assert "CAMPAIGN_GATE_MISSING" in finding_codes(validator.validate(package)), (field, malformed)
        for field, expected_code in (
            ("planned_actions", "PHASE_ACTIONS_MISSING"),
            ("entry_gates", "PHASE_GATE_MISSING"),
            ("data_sufficiency_rule_ids", "PHASE_GATE_MISSING"),
            ("exit_gates", "PHASE_GATE_MISSING"),
            ("rollback_conditions", "PHASE_GATE_MISSING"),
        ):
            for malformed in ({}, [], None):
                package = valid_strategy()
                package["phase_plan"][0][field] = [copy.deepcopy(malformed)]
                assert expected_code in finding_codes(validator.validate(package)), (field, malformed)

    @test("Request a Review is native-only and source-qualified")
    def _() -> None:
        package = valid_strategy()
        package["review_compliance"]["methods"] = ["REQUEST_A_REVIEW"]
        package["onsite_support"]["request_a_review"] = {"eligibility": "VERIFIED_ELIGIBLE"}
        assert "REQUEST_REVIEW_SOURCE_MISSING" in finding_codes(validator.validate(package))

        package = valid_strategy()
        package["review_compliance"]["methods"] = ["REQUEST_A_REVIEW"]
        package["onsite_support"]["request_a_review"] = {
            "eligibility": "VERIFIED_ELIGIBLE",
            "channel": "OFF_AMAZON_EMAIL",
            "custom_message": "Leave a five-star review for a free gift",
        }
        assert "REQUEST_REVIEW_SCHEMA_INVALID" in finding_codes(validator.validate(package))

        package = valid_strategy()
        package["source_artifacts"].append({
            "source_artifact_id": "SRC-REVIEW-ELIG-001",
            "artifact_type": "amazon_request_review_eligibility_snapshot",
            "path_or_url": "amazon_request_review_eligibility_snapshot.json",
            "version_or_captured_at": iso(FIXTURE_CAPTURED),
            "sha256": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            "data_class": "FIRST_PARTY",
            "marketplace": "US",
            "account_id_masked": "***001",
            "scope_id": "SKU-001",
            "evidence_domains": ["REQUEST_REVIEW_ELIGIBILITY"],
            "eligible_order_scope_ids": ["ORDER-001"],
        })
        package["review_compliance"]["methods"] = ["REQUEST_A_REVIEW"]
        package["onsite_support"]["request_a_review"] = {
            "eligibility": "VERIFIED_ELIGIBLE",
            "native_method": "AMAZON_REQUEST_A_REVIEW",
            "source_artifact_ids": ["SRC-REVIEW-ELIG-001"],
            "eligible_order_scope_ids": ["ORDER-001"],
        }
        result = validator.validate(package)
        assert result["plan_ready"] is True, result["findings"]

    @test("Featured Offer gate is explicit or officially exempted")
    def _() -> None:
        for state in ("INELIGIBLE", "UNKNOWN", None, {}, [], True):
            package = valid_strategy()
            package["account_snapshot"]["featured_offer_or_current_equivalent"] = copy.deepcopy(state)
            result = validator.validate(package)
            assert {"FEATURED_OFFER_STATE_INVALID", "FEATURED_OFFER_NOT_ELIGIBLE"}.intersection(finding_codes(result)), (state, result)
            assert result["plan_ready"] is False

        package = valid_strategy()
        package["account_snapshot"]["featured_offer_or_current_equivalent"] = "NOT_REQUIRED_VERIFIED"
        assert "FEATURED_OFFER_NOT_ELIGIBLE" in finding_codes(validator.validate(package))
        placement_policy = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-PLACEMENT-001")
        placement_policy["policy_domains"].append("FEATURED_OFFER_REQUIREMENT")
        result = validator.validate(package)
        assert result["plan_ready"] is True, result["findings"]

    @test("traffic-ready reserved inventory breakdown is complete")
    def _() -> None:
        for field in ("vine_units", "other_locked_units", "other_reserved_units"):
            package = valid_strategy()
            package["inventory"]["reserved_breakdown"][field] = None
            result = validator.validate(package)
            assert "INVENTORY_RESERVED_BREAKDOWN_INCOMPLETE" in finding_codes(result), (field, result)
            assert result["plan_ready"] is False

    @test("campaign architecture rejects hidden offsite and unknown delivery fields")
    def _() -> None:
        variants = (
            {"delivery_network": "OFF_AMAZON"},
            {"reach_beyond_amazon": True},
            {"deliveryNetwork": "OFF_AMAZON"},
            {"learning_loss_model": {"settings": {"publisherNetwork": "PARTNER_SITES"}}},
        )
        for variant in variants:
            package = valid_strategy()
            package["campaign_architecture"][0].update(copy.deepcopy(variant))
            result = validator.validate(package)
            assert {"CAMPAIGN_FIELD_NOT_ALLOWLISTED", "CAMPAIGN_OFFSITE_SCOPE_INVALID"}.intersection(finding_codes(result)), (variant, result)
            assert result["plan_ready"] is False

    @test("phase state machines use exact mode-specific states and transitions")
    def _() -> None:
        package = valid_strategy()
        for phase in package["phase_plan"]:
            phase["next_states"] = []
        codes = finding_codes(validator.validate(package))
        assert "PHASE_NEXT_STATE_MISSING" in codes and "PHASE_TRANSITION_INVALID" in codes

        package = valid_strategy()
        package["phase_plan"][0]["next_states"] = ["TRANSITIONING"]
        assert "PHASE_TRANSITION_INVALID" in finding_codes(validator.validate(package))

        package = valid_strategy()
        package["phase_plan"][0]["state"] = "OFF_AMAZON_SCALING"
        assert "PHASE_STATE_INVALID" in finding_codes(validator.validate(package))

        package = valid_strategy(existing=True)
        package["phase_plan"] = [{
            "phase_id": "PH-X", "state": "OFF_AMAZON_SCALING", "objective": "bad",
            "entry_gates": ["x"], "planned_actions": ["x"], "data_sufficiency_rule_ids": ["DR-001"],
            "attribution_completion_requirement": "complete", "phase_spend_cap": 0, "inventory_floor": 100,
            "exit_gates": ["x"], "rollback_conditions": ["x"], "next_states": [],
        }]
        assert "PHASE_STATE_INVALID" in finding_codes(validator.validate(package))

    @test("contribution normalization rejects nonbinding wrong-scope cost proof")
    def _() -> None:
        package = valid_strategy(existing=True)
        package["source_artifacts"].append({
            "source_artifact_id": "SRC-COST-WRONG",
            "artifact_type": "seller_cost_sheet",
            "path_or_url": "wrong_cost.csv",
            "version_or_captured_at": iso(FIXTURE_CAPTURED),
            "sha256": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            "data_class": "HYPOTHESIS",
            "marketplace": "CA",
            "currency": "CAD",
            "account_id_masked": "***OTHER",
            "scope_id": "OTHER-SKU",
            "window_start": (FIXTURE_REPORT_GENERATED.date() - timedelta(days=30)).isoformat(),
            "window_end": FIXTURE_REPORT_GENERATED.date().isoformat(),
            "data_through_date": FIXTURE_REPORT_GENERATED.date().isoformat(),
            "evidence_domains": ["PRODUCT_COSTS_AND_RETURNS"],
        })
        contribution_source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-CONTRIBUTION-001")
        contribution_source["derived_source_ids"] = ["SRC-ADS-001", "SRC-BUSINESS-001", "SRC-COST-WRONG"]
        result = validator.validate(package)
        assert "ACTUAL_CONTRIBUTION_SOURCE_SEMANTICS_INVALID" in finding_codes(result), result
        assert result["plan_ready"] is False

    @test("change payload cross-field combinations fail closed")
    def _() -> None:
        operations: list[dict[str, Any]] = []

        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({
            "action": "CREATE", "entity_type": "KEYWORD", "entity_id": "KEYWORD-NEW",
            "current_value": {"state": "ABSENT"},
            "proposed_value": {"keywordText": "warmers", "matchType": "NEGATIVE_EXACT", "bid": 1.2},
        })
        operations.append(operation)

        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({
            "action": "ADD_NEGATIVE", "entity_type": "NEGATIVE_KEYWORD", "entity_id": "NEGATIVE-NEW",
            "current_value": {"state": "ABSENT"},
            "proposed_value": {"negativeKeywordText": "free", "matchType": "EXACT"},
        })
        operations.append(operation)

        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({
            "entity_type": "KEYWORD", "entity_id": "KEYWORD-001",
            "current_value": {"keywordText": "warmers", "matchType": "EXACT"},
            "proposed_value": {"matchType": "NEGATIVE_EXACT"},
        })
        operations.append(operation)

        for proposed in (
            {"targetingExpression": {"asinSameAs": "B098765432", "categorySameAs": "123"}, "bid": 1.2},
            {"asin": "B098765432", "asins": ["B012345678"], "targetingExpression": {"asinSameAs": "B098765432"}, "bid": 1.2},
        ):
            operation = prepared_ad_operation("NOT_STARTED")
            operation.update({
                "action": "CREATE", "entity_type": "PRODUCT_TARGET", "entity_id": "PRODUCT-TARGET-NEW",
                "current_value": {"state": "ABSENT"}, "proposed_value": proposed,
            })
            operations.append(operation)

        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({
            "action": "CREATE", "entity_type": "CAMPAIGN", "entity_id": "CAMPAIGN-NEW",
            "current_value": {"state": "ABSENT"},
            "proposed_value": {
                "name": "launch", "adProduct": "SPONSORED_PRODUCTS", "targetingType": "MANUAL_KEYWORD",
                "startDate": "2030-01-01", "endDate": "2020-01-01",
            },
        })
        operations.append(operation)

        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({
            "entity_type": "CAMPAIGN", "entity_id": "CAMPAIGN-001",
            "current_value": {"budget": {"amount": 10, "currencyCode": "USD", "budgetType": "DAILY"}},
            "proposed_value": {"budget": {"amount": 12, "currencyCode": "CAD", "budgetType": "DAILY"}},
        })
        operations.append(operation)

        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({
            "entity_type": "CAMPAIGN", "entity_id": "CAMPAIGN-001",
            "current_value": {"state": "PAUSED", "status": "PAUSED"},
            "proposed_value": {"state": "ENABLED", "status": "ARCHIVED"},
        })
        operations.append(operation)

        for operation in operations:
            result = validator.validate(authorized_strategy(operation))
            assert "CHANGE_PAYLOAD_SEMANTICS_INVALID" in finding_codes(result), (operation, result)
            assert result["authorization_record_structurally_valid"] is False

    @test("manifest operations must match the audited campaign target kind")
    def _() -> None:
        for entity_type, proposed_value in (
            ("PRODUCT_TARGET", {"targetingExpression": {"asinSameAs": "B098765432"}, "bid": 1.2}),
            ("TARGET", {"targetingExpression": {"asinSameAs": "B098765432"}, "bid": 1.2}),
        ):
            operation = prepared_ad_operation("NOT_STARTED")
            operation.update({
                "action": "CREATE", "entity_type": entity_type, "entity_id": f"{entity_type}-NEW",
                "current_value": {"state": "ABSENT"}, "proposed_value": proposed_value,
            })
            result = validator.validate(authorized_strategy(operation))
            assert "CHANGE_CAMPAIGN_TARGET_KIND_MISMATCH" in finding_codes(result), (entity_type, result)
            assert result["authorization_record_structurally_valid"] is False

        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({
            "entity_type": "CAMPAIGN", "entity_id": "CAMPAIGN-001",
            "current_value": {"targetingType": "MANUAL_KEYWORD"},
            "proposed_value": {"targetingType": "MANUAL_PRODUCT"},
        })
        result = validator.validate(authorized_strategy(operation))
        assert "CHANGE_PAYLOAD_SEMANTICS_INVALID" in finding_codes(result)
        assert result["authorization_record_structurally_valid"] is False

        operation = prepared_ad_operation("NOT_STARTED")
        operation.update({
            "action": "CREATE", "entity_type": "CAMPAIGN", "entity_id": "CAMPAIGN-NEW",
            "current_value": {"state": "ABSENT"},
            "proposed_value": {"name": "product campaign", "adProduct": "SPONSORED_PRODUCTS", "targetingType": "MANUAL_PRODUCT"},
        })
        result = validator.validate(authorized_strategy(operation))
        assert "CHANGE_CAMPAIGN_TARGET_KIND_MISMATCH" in finding_codes(result)
        assert result["authorization_record_structurally_valid"] is False

    @test("offsite controls cannot move into sibling strategy zones")
    def _() -> None:
        mutations = {
            "keyword_targets": lambda package: package["keyword_targets"][0].update({"delivery_network": "OFF_AMAZON"}),
            "product_targets": lambda package: package["product_targets"][0].update({"reach_beyond_amazon": True}),
            "decision_rules": lambda package: package["decision_rules"][0].update({"delivery_network": "OFF_AMAZON"}),
            "onsite_support": lambda package: package["onsite_support"].update({"reach_beyond_amazon": True}),
            "review_compliance": lambda package: package["review_compliance"].update({"delivery_network": "OFF_AMAZON"}),
            "inventory": lambda package: package["inventory"].update({"reach_beyond_amazon": True}),
            "economics": lambda package: package["economics"].update({"delivery_network": "OFF_AMAZON"}),
        }
        for zone, mutate in mutations.items():
            package = valid_strategy()
            mutate(package)
            result = validator.validate(package)
            assert "OFFSITE_PLAN_FIELD_INVALID" in finding_codes(result), (zone, result)
            assert result["plan_ready"] is False

    @test("keyword content and target evidence members are meaningful")
    def _() -> None:
        for field in ("keyword_original", "intent", "objective"):
            for malformed in ({}, [], None):
                package = valid_strategy()
                package["keyword_targets"][0][field] = copy.deepcopy(malformed)
                result = validator.validate(package)
                assert "KEYWORD_CONTENT_FIELD_MISSING" in finding_codes(result), (field, malformed, result)
                assert result["plan_ready"] is False

        for malformed in ({}, [], None, "MAYBE"):
            package = valid_strategy()
            package["keyword_targets"][0]["product_fit"] = copy.deepcopy(malformed)
            result = validator.validate(package)
            assert "KEYWORD_PRODUCT_FIT_INVALID" in finding_codes(result), (malformed, result)
            assert result["plan_ready"] is False

        for target_zone, code in (("keyword_targets", "TARGET_EVIDENCE_MISSING"), ("product_targets", "PRODUCT_EVIDENCE_MISSING")):
            for field in ("source_ids", "evidence_ids"):
                for malformed in ({}, [], None):
                    package = valid_strategy()
                    package[target_zone][0][field] = [copy.deepcopy(malformed)]
                    result = validator.validate(package)
                    assert code in finding_codes(result), (target_zone, field, malformed, result)
                    assert result["plan_ready"] is False

        package = valid_strategy()
        package["upstream_snapshots"]["keyword_library"]["keywords"][0]["keyword_original"] = "different term"
        assert "UPSTREAM_KEYWORD_FIELD_MISMATCH" in finding_codes(validator.validate(package))

    @test("binding Ads source period and maturity must match the claimed row")
    def _() -> None:
        for change, expected in (
            ({"window_end": "2024-01-01"}, "PERFORMANCE_SOURCE_PERIOD_MISMATCH"),
            ({"report_status": "PROCESSING"}, "PERFORMANCE_SOURCE_MATURITY_INVALID"),
            ({"attribution_status": "PARTIAL"}, "PERFORMANCE_SOURCE_MATURITY_INVALID"),
        ):
            package = valid_strategy(existing=True)
            source = next(row for row in package["source_artifacts"] if row["source_artifact_id"] == "SRC-ADS-001")
            source.update(change)
            result = validator.validate(package)
            assert expected in finding_codes(result), (change, result)
            assert result["plan_ready"] is False

    @test("ready economics cannot silently lower preserved profit floor")
    def _() -> None:
        package = valid_strategy()
        for scenario in package["economics"]["input_snapshot"]["scenarios"]:
            scenario["target_profit_per_order"] = 1
        package["economics"]["calculator_result"] = {
            "scenarios": [economics.calculate(row) for row in package["economics"]["input_snapshot"]["scenarios"]]
        }
        result = validator.validate(package)
        assert "ECONOMICS_PROFIT_OBJECTIVE_MISMATCH" in finding_codes(result)
        assert result["plan_ready"] is False

    @test("binding Ads windows cannot be summed across distinct periods")
    def _() -> None:
        package = valid_strategy(existing=True)
        second = copy.deepcopy(package["performance_snapshots"][0])
        second["performance_snapshot_id"] = "PS-002"
        second["window_start"] = (FIXTURE_REPORT_GENERATED.date() - timedelta(days=15)).isoformat()
        second["entity_id"] = "TARGET-002"
        package["performance_snapshots"][0]["entity_id"] = "TARGET-001"
        package["performance_snapshots"].append(second)
        package["economics"]["performance_snapshot_ids"].append("PS-002")
        assert "ECONOMICS_PERFORMANCE_PERIOD_MISMATCH" in finding_codes(validator.validate(package))

    @test("duplicate ad-product rows need disjoint entity identity")
    def _() -> None:
        package = valid_strategy(existing=True)
        second = copy.deepcopy(package["performance_snapshots"][0])
        second["performance_snapshot_id"] = "PS-002"
        package["performance_snapshots"].append(second)
        package["economics"]["performance_snapshot_ids"].append("PS-002")
        assert "ECONOMICS_PERFORMANCE_OVERLAP_UNRESOLVED" in finding_codes(validator.validate(package))

    @test("negative or fractional report metrics cannot reconcile")
    def _() -> None:
        for field, bad in (("spend", -1), ("orders", "1.5")):
            package = valid_strategy(existing=True)
            package["performance_snapshots"][0]["metrics"][field] = bad
            assert "PERFORMANCE_METRIC_INVALID" in finding_codes(validator.validate(package))

    failures: list[str] = []
    for name, function in tests:
        try:
            function()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001 - standalone harness
            failures.append(name)
            print(f"FAIL {name}: {exc}")
    print(f"\n{len(tests) - len(failures)}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(run())
