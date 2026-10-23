#!/usr/bin/env python3
"""Regression tests for the Amazon Listing package and mechanical auditors."""

from __future__ import annotations

import importlib.util
import datetime as dt
import copy
import math
import sys
from pathlib import Path
from typing import Any, Callable


SCRIPT_DIR = Path(__file__).resolve().parent


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


package_validator = load_module(
    "listing_package_validator", SCRIPT_DIR / "validate_listing_package.py"
)
mechanical_auditor = load_module(
    "listing_mechanical_auditor", SCRIPT_DIR / "audit_listing.py"
)

FIXTURE_TIME = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
SYNTHETIC_ASIN = "B" + "0" * 9


def valid_release() -> dict[str, Any]:
    stable_ids = {
        "project_id": "P-001",
        "selection_run_id": "SEL-001",
        "candidate_id": "CAN-001",
        "competitor_lock_run_id": "COMP-001",
        "keyword_run_id": "KW-RUN-001",
    }
    return _valid_release_template(stable_ids)


def formal_phrase_release() -> dict[str, Any]:
    package = valid_release()
    fact = package["product"]["verified_facts"][1]
    fact["risk_class"] = "HIGH"
    fact["publication_status"] = "FORMAL_CLAIM_RELEASED"
    fact["approved_wording"] = ["Example Devices"]
    package["listing_copy"]["search_terms"] = ""
    package["claim_mappings"] = [m for m in package["claim_mappings"] if m["location"] != "search_terms"]
    package["keyword_placements"] = [p for p in package["keyword_placements"] if p["location"] != "search_terms"]
    package["claim_mappings"][1]["exact_text"] = "Example Devices"
    package["claim_mappings"][1]["fact_ids"] = ["F001"]
    package["claim_mappings"][1]["evidence_ids"] = ["E001"]
    package["claim_mappings"][1]["permission"] = "FORMAL_CLAIM_RELEASED"
    package["claim_mappings"].append({
        "mapping_id": "CM004", "location": "title", "exact_text": "2 Pack",
        "fact_ids": ["F002"], "evidence_ids": ["E002"],
        "risk_class": "LOW", "permission": "COPY_RELEASED",
    })
    return package


def valid_operating_context() -> dict[str, Any]:
    return {
        "context_id": "CTX-001",
        "price_context": {
            "current_observed": {
                "amount": 1.0,
                "currency": "USD",
                "observed_at": FIXTURE_TIME,
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
            "observed_at": FIXTURE_TIME,
            "evidence_ids": ["STAGE-SNAPSHOT-001"],
        },
        "seasonality_context": {
            "classification": "UNKNOWN",
            "current_phase": "UNKNOWN",
            "source_period": "",
            "source_granularity": "UNKNOWN",
            "evidence_ids": [],
            "confidence": "UNKNOWN",
        },
        "content_change_control": {
            "decision_id": "CHANGE-001",
            "decided_at": FIXTURE_TIME,
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


def attach_change_control(package: dict[str, Any]) -> None:
    context = valid_operating_context()
    package["operating_context"] = context
    context_hash = package_validator.operating_context_sha256(context)
    package["operating_context_sha256"] = context_hash
    package["upstream_snapshot"]["operating_context_id"] = context["context_id"]
    package["upstream_snapshot"]["operating_context_sha256"] = context_hash
    upstream = context["content_change_control"]
    package["change_control"] = {
        **copy.deepcopy(upstream),
        "operator_change_state": "LOCKED",
        "baseline_listing_copy": {
            "title": package["listing_copy"]["title"],
            "bullets": copy.deepcopy(package["listing_copy"]["bullets"]),
        },
        "explicit_change_authorizations": [],
    }


def neutral_promotion_handoff(package: dict[str, Any]) -> dict[str, Any]:
    return {
        "handoff_type": "NEUTRAL_PROMOTION_INPUT",
        "operating_context_id": package["operating_context"]["context_id"],
        "operating_context_sha256": package["operating_context_sha256"],
        "listing_release_ref": {
            "listing_run_id": package["listing_run_id"],
            "listing_version_id": package["listing_version_id"],
            "release_status": package["release_status"],
            "snapshot_at": package["snapshot_at"],
        },
        "change_control_decision_id": package["change_control"]["decision_id"],
        "risk_acknowledgement_ids": ["RISK-001"],
        "refresh_requirements": [
            "current offer state",
            "inventory and advertising eligibility",
            "binding economics",
        ],
        "user_business_constraints": [
            {
                "constraint_id": "CONSTRAINT-001",
                "metric": "seller-defined operating floor",
                "source": "explicit seller direction",
                "status": "USER_DIRECTIVE_NOT_EVIDENCE",
            }
        ],
    }


def _valid_release_template(stable_ids: dict[str, str]) -> dict[str, Any]:
    return {
        "mode": "RELEASE",
        "contract_version": "1.0",
        **stable_ids,
        "listing_run_id": "LIST-001",
        "listing_version_id": "LIST-001-V1",
        "marketplace": "US",
        "output_locale": "en-US",
        "category_path": "Example Category",
        "product_type": "EXAMPLE_PRODUCT",
        "snapshot_at": FIXTURE_TIME,
        "upstream_snapshot": {
            "listing_handoff_path": "listing_handoff.json",
            "received_at": FIXTURE_TIME,
            "integrity_status": "VERIFIED",
            "stable_ids": stable_ids,
        },
        "product": {
            "verified_facts": [
                {
                    "fact_id": "F000",
                    "attribute": "brand",
                    "value": "Brand",
                    "scope": "all_variations",
                    "evidence_ids": ["E000"],
                    "evidence_type": "PACKAGE",
                    "risk_class": "LOW",
                    "research_status": "VERIFIED",
                    "publication_status": "COPY_RELEASED",
                },
                {
                    "fact_id": "F001",
                    "attribute": "product_identity",
                    "value": "example device",
                    "scope": "all_variations",
                    "evidence_ids": ["E001"],
                    "evidence_type": "PACKAGE",
                    "risk_class": "LOW",
                    "research_status": "VERIFIED",
                    "publication_status": "COPY_RELEASED",
                },
                {
                    "fact_id": "F002",
                    "attribute": "offer_quantity",
                    "value": "2",
                    "scope": "per_package",
                    "evidence_ids": ["E002"],
                    "evidence_type": "PACKAGE",
                    "risk_class": "LOW",
                    "research_status": "VERIFIED",
                    "publication_status": "COPY_RELEASED",
                },
            ],
            "claim_gates": [],
            "forbidden_or_unsupported_claims": [],
        },
        "competitor_set": [
            {
                "competitor_id": "C001",
                "asin": SYNTHETIC_ASIN,
                "role": "CORE_BENCHMARK",
                "rating_snapshot": 4.4,
                "ratings_count_snapshot": 850,
            }
        ],
        "keyword_library": [
            {
                "keyword_id": "KW001",
                "term": "example devices",
                "role": "CORE_VERIFIED",
                "front_end_copy_eligible": True,
                "listing_indexing_eligible": True,
                "downstream_review_eligible": True,
            },
            {
                "keyword_id": "KW002",
                "term": "portable example units",
                "role": "INDEXING_CANDIDATE",
                "front_end_copy_eligible": False,
                "listing_indexing_eligible": True,
                "downstream_review_eligible": True,
            },
        ],
        "policy_snapshot": {
            "verified": True,
            "verified_at": FIXTURE_TIME,
            "marketplace": "US",
            "product_type": "EXAMPLE_PRODUCT",
            "sources": ["https://sellercentral.amazon.com/help/example"],
            "field_rules": {"title_max": 75, "search_terms_max_bytes": 249},
        },
        "copy_plan": [
            {
                "plan_item_id": "CP001",
                "buyer_question": "What is included?",
                "own_fact_ids": ["F001", "F002"],
                "keyword_ids": ["KW001"],
                "competitor_context_ids": ["C001"],
                "target_field": "title",
                "message_scope_or_condition": "two units per package",
                "prohibited_wording": ["best"],
                "decision": "USE",
            }
        ],
        "listing_copy": {
            "title": "Brand Example Devices, 2 Pack",
            "item_highlight": "",
            "bullets": ["Two compact example units are included in this set"],
            "product_description": "",
            "search_terms": "portable example units",
        },
        "claim_mappings": [
            {
                "mapping_id": "CM000",
                "location": "title",
                "exact_text": "Brand",
                "fact_ids": ["F000"],
                "evidence_ids": ["E000"],
                "risk_class": "LOW",
                "permission": "COPY_RELEASED",
            },
            {
                "mapping_id": "CM001",
                "location": "title",
                "exact_text": "Example Devices, 2 Pack",
                "fact_ids": ["F001", "F002"],
                "evidence_ids": ["E001", "E002"],
                "risk_class": "LOW",
                "permission": "COPY_RELEASED",
            },
            {
                "mapping_id": "CM002",
                "location": "bullet_1",
                "exact_text": "Two compact example units are included in this set",
                "fact_ids": ["F002"],
                "evidence_ids": ["E002"],
                "risk_class": "LOW",
                "permission": "COPY_RELEASED",
            },
            {
                "mapping_id": "CM003",
                "location": "search_terms",
                "exact_text": "portable example units",
                "fact_ids": ["F001"],
                "evidence_ids": ["E001"],
                "risk_class": "LOW",
                "permission": "COPY_RELEASED",
            },
        ],
        "keyword_placements": [
            {
                "placement_id": "KP001",
                "keyword_id": "KW001",
                "term": "example devices",
                "location": "title",
                "exact_text": "Example Devices",
            },
            {
                "placement_id": "KP002",
                "keyword_id": "KW002",
                "term": "portable example units",
                "location": "search_terms",
                "exact_text": "portable example units",
                "fact_ids": ["F001"],
            },
        ],
        "withheld_items": [],
        "release_status": "READY",
        "release_notes": [],
    }


def mechanical_input(policy_verified: bool, evidence_verified: bool) -> dict[str, Any]:
    return {
        "audit_scope": "full",
        "title": "Brand Example Devices, 2 Pack",
        "item_highlight": "",
        "bullets": [
            "Two separate example units are included",
            "Compact shape supports convenient storage",
            "Simple controls support everyday operation",
            "Package contents are listed for easy checking",
            "Store both units together between uses",
        ],
        "product_description": "",
        "search_terms": "",
        "seller_brand": "Brand",
        "competitor_brands": [],
        "asins": [],
        "other_indexed_fields": [],
        "search_term_exclusions": [],
        "keywords": [],
        "rules": {
            "title_max": 75,
            "item_highlight_max": 125,
            "product_description_max": 2000,
            "expected_bullet_count": 5,
            "bullet_min": 10,
            "bullet_max": 255,
            "title_forbidden_characters": ["!", "$", "?", "_", "{", "}"],
            "title_max_word_repetition": 2,
            "title_repeat_exempt_words": ["a", "an", "and", "for", "of", "the", "to", "with"],
            "forbidden_phrases": [],
            "search_terms_required": False,
            "search_terms_policy_verified": True,
            "search_terms_exclusions_verified": True,
            "policy_snapshot_verified": policy_verified,
            "evidence_mapping_verified": evidence_verified,
        },
    }


def codes(result: dict[str, Any]) -> set[str]:
    return {item["code"] for item in result["findings"]}


def run() -> int:
    tests: list[tuple[str, Callable[[], None]]] = []

    def test(name: str):
        def decorator(function: Callable[[], None]) -> Callable[[], None]:
            tests.append((name, function))
            return function
        return decorator

    @test("valid intake preserves all stable IDs")
    def _() -> None:
        release = valid_release()
        intake = {
            "mode": "INTAKE",
            "contract_version": "1.0",
            **{key: release[key] for key in package_validator.STABLE_IDS},
            "product": release["product"],
            "keyword_library": release["keyword_library"],
        }
        result = package_validator.validate(intake)
        assert result["structurally_valid"] is True

    @test("raw Stage 2 listing_handoff is inferred as INTAKE")
    def _() -> None:
        release = valid_release()
        handoff = {
            "schema_version": "1.0",
            **{key: release[key] for key in package_validator.STABLE_IDS},
            "marketplace": "US",
            "language": "en-US",
            "run_status": "COMPLETE",
            "product": release["product"],
            "competitor_set": {"core_benchmarks": release["competitor_set"]},
            "keyword_library": {
                "core_verified": [release["keyword_library"][0]],
                "indexing_candidates": [release["keyword_library"][1]],
            },
        }
        result = package_validator.validate(handoff)
        assert result["mode"] == "INTAKE"
        assert result["structurally_valid"] is True, result["findings"]

    @test("valid release is READY")
    def _() -> None:
        result = package_validator.validate(valid_release())
        assert result["structurally_valid"] is True
        assert result["release_ready"] is True

    @test("blocked keyword role is rejected")
    def _() -> None:
        package = valid_release()
        package["keyword_library"][0]["role"] = "HOLD_CLAIM"
        assert "KEYWORD_ROLE_BLOCKED" in codes(package_validator.validate(package))

    @test("INDEXING_CANDIDATE is rejected in visible copy")
    def _() -> None:
        package = valid_release()
        package["keyword_library"][0]["role"] = "INDEXING_CANDIDATE"
        assert "INDEXING_CANDIDATE_VISIBLE" in codes(package_validator.validate(package))

    @test("high-risk fact requires formal release")
    def _() -> None:
        package = valid_release()
        fact = package["product"]["verified_facts"][1]
        fact["risk_class"] = "HIGH"
        fact["approved_wording"] = ["Example Devices"]
        assert "HIGH_RISK_NOT_FORMALLY_RELEASED" in codes(package_validator.validate(package))

    @test("unmapped visible field is rejected")
    def _() -> None:
        package = valid_release()
        package["claim_mappings"] = [m for m in package["claim_mappings"] if m["location"] != "bullet_1"]
        assert "FIELD_UNMAPPED" in codes(package_validator.validate(package))

    @test("missing policy prevents READY")
    def _() -> None:
        package = valid_release()
        package["policy_snapshot"]["verified"] = False
        result = package_validator.validate(package)
        assert result["release_ready"] is False
        assert "POLICY_UNVERIFIED" in codes(result)

    @test("policy marketplace must match release")
    def _() -> None:
        package = valid_release()
        package["policy_snapshot"]["marketplace"] = "UK"
        result = package_validator.validate(package)
        assert result["release_ready"] is False
        assert "POLICY_SCOPE_MISMATCH" in codes(result)

    @test("policy product type must match release")
    def _() -> None:
        package = valid_release()
        package["policy_snapshot"]["product_type"] = "UNRELATED_TYPE"
        result = package_validator.validate(package)
        assert result["release_ready"] is False
        assert "POLICY_SCOPE_MISMATCH" in codes(result)

    @test("invalid policy verification timestamp prevents READY")
    def _() -> None:
        package = valid_release()
        package["policy_snapshot"]["verified_at"] = "yesterday"
        result = package_validator.validate(package)
        assert result["release_ready"] is False
        assert "POLICY_TIME_INVALID" in codes(result)

    @test("future policy verification timestamp prevents READY")
    def _() -> None:
        package = valid_release()
        package["policy_snapshot"]["verified_at"] = (
            dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
        ).isoformat()
        result = package_validator.validate(package)
        assert result["release_ready"] is False
        assert "POLICY_TIME_FUTURE" in codes(result)

    @test("older policy verification is not rejected by age alone")
    def _() -> None:
        package = valid_release()
        package["policy_snapshot"]["verified_at"] = (
            dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)
        ).isoformat()
        result = package_validator.validate(package)
        assert result["release_ready"] is True, result["findings"]

        package["policy_snapshot"]["refresh_due_at"] = (
            dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
        ).isoformat()
        result = package_validator.validate(package)
        assert result["release_ready"] is True, result["findings"]

        package["policy_snapshot"]["refresh_due_at"] = (
            dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
        ).isoformat()
        result = package_validator.validate(package)
        assert result["release_ready"] is False
        assert "POLICY_REFRESH_OVERDUE" in codes(result)

    @test("conditional Product Description is evidence-mapped")
    def _() -> None:
        package = valid_release()
        package["listing_copy"]["product_description"] = "Example devices for ordinary use"
        package["claim_mappings"].append(
            {
                "mapping_id": "CM003",
                "location": "product_description",
                "exact_text": "Example devices for ordinary use",
                "fact_ids": ["F001"],
                "evidence_ids": ["E001"],
                "risk_class": "LOW",
                "permission": "COPY_RELEASED",
            }
        )
        assert package_validator.validate(package)["release_ready"] is True

    @test("mechanical audit warns when policy or evidence gate is absent")
    def _() -> None:
        result = mechanical_auditor.audit(mechanical_input(False, False))
        assert result["status"] == "WARN"
        assert {"POLICY_SNAPSHOT_UNVERIFIED", "EVIDENCE_MAPPING_UNVERIFIED"} <= codes(result)

    @test("mechanical audit cannot PASS from caller booleans alone")
    def _() -> None:
        result = mechanical_auditor.audit(mechanical_input(True, True))
        assert result["status"] == "WARN", result["findings"]
        assert "RELEASE_PACKAGE_UNBOUND" in codes(result)

    @test("mechanical audit PASS binds to an identical READY release")
    def _() -> None:
        package = valid_release()
        package["listing_copy"]["search_terms"] = ""
        package["claim_mappings"] = [m for m in package["claim_mappings"] if m["location"] != "search_terms"]
        package["keyword_placements"] = [p for p in package["keyword_placements"] if p["location"] != "search_terms"]
        audit_input = mechanical_input(True, True)
        audit_input.update(package["listing_copy"])
        audit_input["rules"]["expected_bullet_count"] = 1
        audit_input["release_package"] = package
        result = mechanical_auditor.audit(audit_input)
        assert result["status"] == "PASS", result["findings"]

    @test("stable ID mismatch is rejected")
    def _() -> None:
        package = valid_release()
        package["candidate_id"] = "CAN-OTHER"
        assert "STABLE_ID_MISMATCH" in codes(package_validator.validate(package))

    @test("canonical grouped Stage 2 handoff is accepted without relabeling")
    def _() -> None:
        package = valid_release()
        core = package["keyword_library"][0]
        core["keyword_original"] = core.pop("term")
        core["library_role"] = core.pop("role")
        indexing = package["keyword_library"][1]
        indexing["keyword_original"] = indexing.pop("term")
        indexing["library_role"] = indexing.pop("role")
        package["keyword_library"] = {
            "core_verified": [core],
            "secondary_verified": [],
            "relevant_needs_validation": [],
            "later_stage_relevant": [],
            "indexing_candidates": [indexing],
            "market_context": [],
            "isolated_or_blocked": [],
        }
        package["product"]["verified_facts"][1]["risk_class"] = "LOW_RISK_SPEC"
        result = package_validator.validate(package)
        assert result["release_ready"] is True, result["findings"]

    @test("sensitive wording cannot hide behind a low-risk fact")
    def _() -> None:
        package = valid_release()
        package["listing_copy"]["title"] = "Brand Example Device Cures Pain Instantly"
        package["claim_mappings"][1]["exact_text"] = "Example Device Cures Pain Instantly"
        result = package_validator.validate(package)
        assert "SENSITIVE_WORDING_NOT_FORMALLY_RELEASED" in codes(result)

    @test("formal approved prefix cannot authorize an added clinical suffix")
    def _() -> None:
        package = formal_phrase_release()
        package["listing_copy"]["bullets"][0] = "Example Devices and clinically proven to prevent burns"
        package["claim_mappings"][2].update({
            "exact_text": package["listing_copy"]["bullets"][0],
            "fact_ids": ["F001"], "evidence_ids": ["E001"],
            "permission": "FORMAL_CLAIM_RELEASED",
        })
        result = package_validator.validate(package)
        assert result["release_ready"] is False
        assert "HIGH_RISK_WORDING_MISMATCH" in codes(result)

    @test("an unmapped suffix cannot ride on one approved phrase")
    def _() -> None:
        package = formal_phrase_release()
        package["listing_copy"]["bullets"][0] = "Example Devices and clinically proven to prevent burns"
        package["claim_mappings"][2].update({
            "exact_text": "Example Devices", "fact_ids": ["F001"],
            "evidence_ids": ["E001"], "permission": "FORMAL_CLAIM_RELEASED",
        })
        result = package_validator.validate(package)
        assert "FIELD_CLAIM_UNCOVERED" in codes(result)

    @test("ordinary and exact formal wording may coexist with separate facts")
    def _() -> None:
        package = formal_phrase_release()
        package["listing_copy"]["bullets"][0] = "Example Devices, 2 Pack"
        package["claim_mappings"][2].update({
            "exact_text": "Example Devices", "fact_ids": ["F001"],
            "evidence_ids": ["E001"], "permission": "FORMAL_CLAIM_RELEASED",
        })
        package["claim_mappings"].append({
            "mapping_id": "CM005", "location": "bullet_1", "exact_text": "2 Pack",
            "fact_ids": ["F002"], "evidence_ids": ["E002"],
            "risk_class": "LOW", "permission": "COPY_RELEASED",
        })
        result = package_validator.validate(package)
        assert result["release_ready"] is True, result["findings"]

    @test("formal numeric range is not interchangeable with a decimal")
    def _() -> None:
        package = formal_phrase_release()
        package["product"]["verified_facts"][1]["approved_wording"].append("1-5 hours")
        bullet_mapping = package["claim_mappings"][2]
        bullet_mapping.update({
            "exact_text": "1.5 hours", "fact_ids": ["F001"],
            "evidence_ids": ["E001"], "permission": "FORMAL_CLAIM_RELEASED",
        })
        package["listing_copy"]["bullets"][0] = "1.5 hours"
        assert "HIGH_RISK_WORDING_MISMATCH" in codes(package_validator.validate(package))
        package["listing_copy"]["bullets"][0] = "1-5 hours"
        bullet_mapping["exact_text"] = "1-5 hours"
        assert package_validator.validate(package)["release_ready"] is True

        package["keyword_library"].append({
            "keyword_id": "KW003", "term": "1.5 hours", "role": "INDEXING_CANDIDATE",
            "front_end_copy_eligible": False, "listing_indexing_eligible": True,
        })
        package["listing_copy"]["search_terms"] = "1.5 hours"
        package["claim_mappings"].append({
            "mapping_id": "CM006", "location": "search_terms", "exact_text": "1.5 hours",
            "fact_ids": ["F001"], "evidence_ids": ["E001"],
            "risk_class": "HIGH", "permission": "FORMAL_CLAIM_RELEASED",
        })
        package["keyword_placements"].append({
            "placement_id": "KP003", "keyword_id": "KW003", "location": "search_terms",
            "exact_text": "1.5 hours", "fact_ids": ["F001"],
        })
        backend_result = package_validator.validate(package)
        assert "BACKEND_FORMAL_WORDING_MISMATCH" in codes(backend_result)
        package["keyword_library"][-1]["term"] = "1-5 hours"
        package["listing_copy"]["search_terms"] = "1-5 hours"
        package["claim_mappings"][-1]["exact_text"] = "1-5 hours"
        package["keyword_placements"][-1]["exact_text"] = "1-5 hours"
        assert package_validator.validate(package)["release_ready"] is True

    @test("low-risk mapping cannot hide a clinical assertion")
    def _() -> None:
        package = valid_release()
        package["listing_copy"]["bullets"][0] = "Example Devices and clinically proven to prevent burns"
        package["claim_mappings"][2]["exact_text"] = package["listing_copy"]["bullets"][0]
        result = package_validator.validate(package)
        assert "SENSITIVE_WORDING_NOT_FORMALLY_RELEASED" in codes(result)

    @test("Search Terms cannot carry an unplaced hidden claim")
    def _() -> None:
        package = valid_release()
        package["listing_copy"]["search_terms"] += " clinically proven"
        package["claim_mappings"][3]["exact_text"] = package["listing_copy"]["search_terms"]
        result = package_validator.validate(package)
        assert "BACKEND_KEYWORD_UNCOVERED" in codes(result)

    @test("a backend keyword needs a released product fact")
    def _() -> None:
        package = valid_release()
        package["keyword_placements"][1]["fact_ids"] = ["F-NOT-FOUND"]
        assert "BACKEND_FACT_UNKNOWN" in codes(package_validator.validate(package))

    @test("unknown eligibility type cannot be silently treated as false")
    def _() -> None:
        package = valid_release()
        package["keyword_library"][0]["front_end_copy_eligible"] = "true"
        assert "KEYWORD_ELIGIBILITY_INVALID" in codes(package_validator.validate(package))

    @test("non-finite context amount is reported without crashing")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        package["operating_context"]["price_context"]["current_observed"]["amount"] = math.nan
        result = package_validator.validate(package)
        assert result["release_ready"] is False
        assert "CURRENT_PRICE_AMOUNT_INVALID" in codes(result)
        assert "OPERATING_CONTEXT_HASH_INVALID" in codes(result)

    @test("mechanical audit fails when bound release is invalid")
    def _() -> None:
        package = valid_release()
        package["listing_copy"]["bullets"][0] += " clinically proven to prevent burns"
        audit_input = mechanical_input(True, True)
        audit_input.update(package["listing_copy"])
        audit_input["rules"]["expected_bullet_count"] = 1
        audit_input["release_package"] = package
        result = mechanical_auditor.audit(audit_input)
        assert result["status"] == "FAIL"
        assert "RELEASE_PACKAGE_NOT_READY" in codes(result)

    @test("operating context and locked content pass through unchanged")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        before = copy.deepcopy(package["operating_context"])
        result = package_validator.validate(package)
        assert result["release_ready"] is True, result["findings"]
        assert package["operating_context"] == before

    @test("operating context hash detects silent envelope mutation")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        package["operating_context"]["demand_calendar"] = {
            "status": "silently changed"
        }
        result = package_validator.validate(package)
        assert "OPERATING_CONTEXT_HASH_MISMATCH" in codes(result)

    @test("locked copy cannot change without explicit authorization")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        package["change_control"]["baseline_listing_copy"]["title"] = "Old " + package["listing_copy"]["title"]
        result = package_validator.validate(package)
        assert "LOCKED_SCOPE_CHANGED" in codes(result)

    @test("explicit scoped authorization permits a locked-field revision")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        package["change_control"]["baseline_listing_copy"]["title"] = "Old " + package["listing_copy"]["title"]
        package["change_control"]["explicit_change_authorizations"] = [
            {
                "authorization_id": "AUTH-001",
                "scopes": ["TITLE"],
                "authorized_at": FIXTURE_TIME,
                "source": "explicit seller authorization",
            }
        ]
        result = package_validator.validate(package)
        assert result["release_ready"] is True, result["findings"]

    @test("risk acknowledgement cannot release a held fact")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        package["product"]["verified_facts"][1]["publication_status"] = "HOLD_CLAIM"
        result = package_validator.validate(package)
        assert "CLAIM_FACT_WITHHELD" in codes(result)
        assert result["release_ready"] is False

    @test("planned price cannot impersonate an observed price")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        planned = package["operating_context"]["price_context"]["planned_phases"][0]
        planned["verification_status"] = "OBSERVED"
        result = package_validator.validate(package)
        assert "PLANNED_PRICE_STATUS_INVALID" in codes(result)

    @test("later-stage keyword requires traceable current-stage basis")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        keyword = package["keyword_library"][1]
        keyword["role"] = "LATER_STAGE_RELEVANT"
        keyword["current_stage_eligible"] = True
        result = package_validator.validate(package)
        assert "KEYWORD_STAGE_BASIS_MISSING" in codes(result)

    @test("later-stage keyword accepts only current observed stage evidence")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        keyword = package["keyword_library"][1]
        keyword["role"] = "LATER_STAGE_RELEVANT"
        keyword["current_stage_eligible"] = True
        keyword["stage_eligibility_basis"] = {
            "stage_id": "STAGE-001",
            "evaluated_at": FIXTURE_TIME,
            "basis_type": "CURRENT_OBSERVED_STAGE",
            "evidence_ids": ["STAGE-SNAPSHOT-001"],
            "operating_context_id": "CTX-001",
        }
        result = package_validator.validate(package)
        assert result["release_ready"] is True, result["findings"]

    @test("planned-stage evidence cannot release a later-stage keyword")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        keyword = package["keyword_library"][1]
        keyword["role"] = "LATER_STAGE_RELEVANT"
        keyword["current_stage_eligible"] = True
        keyword["stage_eligibility_basis"] = {
            "stage_id": "STAGE-001",
            "evaluated_at": FIXTURE_TIME,
            "basis_type": "CURRENT_OBSERVED_STAGE",
            "evidence_ids": ["DECISION-001"],
            "operating_context_id": "CTX-001",
        }
        result = package_validator.validate(package)
        assert "KEYWORD_STAGE_EVIDENCE_MISMATCH" in codes(result)

    @test("neutral promotion handoff is accepted")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        package["promotion_handoff"] = neutral_promotion_handoff(package)
        result = package_validator.validate(package)
        assert result["release_ready"] is True, result["findings"]

    @test("promotion handoff rejects advertising actions")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        package["promotion_handoff"] = neutral_promotion_handoff(package)
        package["promotion_handoff"]["campaigns"] = []
        result = package_validator.validate(package)
        assert "PROMOTION_HANDOFF_NOT_NEUTRAL" in codes(result)

    @test("promotion handoff cannot duplicate or relabel price state")
    def _() -> None:
        package = valid_release()
        attach_change_control(package)
        package["promotion_handoff"] = neutral_promotion_handoff(package)
        package["promotion_handoff"]["effective_price"] = {"amount": 1.0}
        result = package_validator.validate(package)
        assert "PROMOTION_PRICE_DUPLICATED" in codes(result)

    failures: list[str] = []
    for name, function in tests:
        try:
            function()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001 - compact standalone harness
            failures.append(name)
            print(f"FAIL {name}: {exc}")
    print(f"\n{len(tests) - len(failures)}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(run())
