#!/usr/bin/env python3
"""Independent price counterexamples; all identities/sources are synthetic."""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evidence_offers import check


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def quote(qid="a", amount="22.88", **changes):
    return {"id": qid, "product_id": "ANON-" + qid, "selected_variant": "selected-blue",
        "source_ids": ["SYNTHETIC-PAGE-" + qid], "observed_at": "2026-10-25T17:30:00Z",
        "marketplace": "US", "region": "US-90060", "currency": "USD",
        "demand_phase": "RISING", "kind": "NORMAL", "amount": amount,
        "basis": "PACK", "unit_label": "hand-warmer", "pack_units": 2,
        "pack_status": "CONSISTENT", **changes}


def request(ids=None, **changes):
    return {"quote_ids": ids or ["a", "b"], "buyer": "PUBLIC", "conditions": [],
        "marketplace": "US", "region": "US-90060", "currency": "USD",
        "demand_phase": "RISING", "basis": "PACK",
        "window_start": "2026-10-25T17:00:00Z", "window_end": "2026-10-25T18:00:00Z", **changes}


def pair():
    return {"quotes": [quote(), quote("b", "19.99")], "comparison": request()}


def coupon_case():
    base = quote("base", "19.99")
    derived = {**base, "id": "coupon-price", "kind": "CONDITIONAL", "amount": "14.99",
        "required_buyer": "PUBLIC", "conditions": ["CLIPPED-25"], "eligibility": "VERIFIED",
        "discounts_reflected": ["coupon-25"],
        "calculation": {"base_quote_id": "base", "promotion_id": "coupon-25"}}
    promo = {"id": "coupon-25", "kind": "COUPON", "discount_type": "PERCENT", "value": "25",
        "conditions": ["CLIPPED-25"], "eligibility": "VERIFIED", "applies_to": ["base"]}
    return {"quotes": [base, derived], "promotions": [promo]}


class OfferEvidenceTests(unittest.TestCase):
    def assert_issue(self, result, code, status=None):
        self.assertIn(code, [i["code"] for i in result["issues"]], result)
        if status:
            self.assertEqual(result["status"], status, result)
        self.assertFalse(result["summary"]["execution_authorized"])

    def test_anonymized_fixture_regressions(self):
        for name, expected in [
            ("evidence_offers_price_qualifications.json", "PASS"),
            ("evidence_offers_per_count.json", "PASS"),
            ("evidence_offers_mixed_eligibility.json", "INCOMPLETE"),
            ("evidence_offers_coupon_reflected.json", "INVALID"),
        ]:
            with self.subTest(name=name):
                result = check(json.loads((FIXTURES / name).read_text()))
                self.assertEqual(result["status"], expected, result)

    def test_own_prime_is_849_per_unit_not_1698_vs_900(self):
        result = check(json.loads((FIXTURES / "evidence_offers_per_count.json").read_text()))
        self.assertEqual([p["amount"] for p in result["summary"]["normalized_prices"]], ["8.49", "9.00"])
        self.assertFalse(result["summary"]["pricing_recommendation"])
        self.assertFalse(result["summary"]["evidence_truth_verified"])

    def test_qualifications_are_not_universal(self):
        data = pair()
        data["quotes"][1]["kind"] = "PRIME"
        self.assert_issue(check(data), "BUYER_QUALIFICATION_MISMATCH", "INCOMPLETE")
        data["comparison"]["buyer"] = "PRIME"
        self.assertEqual(check(data)["status"], "PASS")

    def test_reference_price_is_not_current_payable(self):
        data = pair()
        data["quotes"][1].update(kind="REFERENCE", reference_type="TYPICAL")
        result = check(data)
        self.assert_issue(result, "REFERENCE_NOT_PAYABLE", "INCOMPLETE")
        self.assertEqual(result["summary"]["normalized_prices"], [])

    def test_no_comparison_does_not_require_region_phase_or_pack(self):
        q = quote()
        for field in ("region", "demand_phase", "pack_units", "pack_status", "unit_label"):
            q.pop(field)
        result = check({"quotes": [q]})
        self.assertEqual(result["status"], "PASS", result)
        self.assertEqual(result["summary"]["comparison_status"], "NOT_REQUESTED")

    def test_contexts_and_time_are_not_silently_joined(self):
        for field, value in [("region", "US-10001"), ("marketplace", "CA"), ("currency", "CAD"),
                ("demand_phase", "DECLINING"), ("observed_at", "2026-10-26T17:30:00Z")]:
            with self.subTest(field=field):
                data = pair()
                data["quotes"][1][field] = value
                result = check(data)
                self.assertEqual(result["status"], "INCOMPLETE", result)
                self.assertEqual(result["summary"]["normalized_prices"], [])

    def test_null_is_never_zero_and_zero_price_is_explicit(self):
        for unknown in (None, "UNKNOWN", ""):
            with self.subTest(value=unknown):
                self.assert_issue(check({"quotes": [quote(amount=unknown)]}), "MISSING_NUMBER", "INCOMPLETE")
        self.assertEqual(check({"quotes": [quote(amount=0)]})["status"], "PASS")

    def test_bad_numbers_shapes_and_naive_dates_are_graceful(self):
        for value in (True, False, -1, float("nan"), float("inf"), "NaN", "-Infinity", {}, [], "1e100000"):
            with self.subTest(value=value):
                self.assertEqual(check({"quotes": [quote(amount=value)]})["status"], "INVALID")
        self.assertEqual(check(None)["status"], "INCOMPLETE")
        for data in ([], "quotes", {"quotes": {}}, {"quotes": [None]},
                {"quotes": [quote()], "promotions": {}}, {"quotes": [quote()], "comparison": []}):
            with self.subTest(data=data):
                self.assertEqual(check(data)["status"], "INVALID")
        self.assert_issue(check({"quotes": [quote(observed_at="2026-10-25T17:30:00")]}), "INVALID_TIMESTAMP", "INVALID")

    def test_duplicate_ids_and_unknown_references(self):
        self.assert_issue(check({"quotes": [quote(), quote()]}), "DUPLICATE_QUOTE_ID", "INVALID")
        data = pair()
        data["comparison"]["quote_ids"][1] = "absent"
        self.assert_issue(check(data), "UNKNOWN_QUOTE", "INVALID")

    def test_unit_price_needs_known_pack_when_comparing_pack_totals(self):
        data = pair()
        data["quotes"][1].update(amount="9.00", basis="UNIT", pack_units=None)
        self.assert_issue(check(data), "PACK_TOTAL_REQUIRED", "INCOMPLETE")
        data["comparison"]["basis"] = "UNIT"
        self.assertEqual(check(data)["status"], "PASS")

    def test_pack_disagreement_cannot_be_hidden_by_consistent_label(self):
        data = pair()
        data["quotes"][1]["pack_evidence"] = [
            {"units": 1, "source_id": "CATALOG"}, {"units": 2, "source_id": "PACKAGING"}]
        result = check(data)
        self.assert_issue(result, "PACK_EVIDENCE_CONFLICT", "INCOMPLETE")
        self.assertEqual(result["summary"]["normalized_prices"], [])

    def test_different_packs_need_explicit_per_unit_comparison(self):
        data = pair()
        data["quotes"][1]["pack_units"] = 1
        self.assert_issue(check(data), "PACK_COUNTS_DIFFER", "INCOMPLETE")
        data["comparison"]["basis"] = "UNIT"
        result = check(data)
        self.assertEqual(result["status"], "PASS", result)
        self.assertEqual([p["amount"] for p in result["summary"]["normalized_prices"]], ["11.44", "19.99"])

    def test_coupon_independent_decimal_arithmetic(self):
        data = coupon_case()
        result = check(data)
        self.assertEqual(result["status"], "PASS", result)
        self.assertEqual(result["summary"]["checked_calculations"][0]["amount"], "14.99")
        data["quotes"][1]["amount"] = "14.98"
        self.assert_issue(check(data), "PRICE_CALCULATION_MISMATCH", "INVALID")

    def test_coupon_already_reflected_is_not_subtracted_again(self):
        data = coupon_case()
        data["quotes"].append({**data["quotes"][1], "id": "double-subtracted", "amount": "11.24",
            "calculation": {"base_quote_id": "coupon-price", "promotion_id": "coupon-25"}})
        self.assert_issue(check(data), "DISCOUNT_ALREADY_REFLECTED", "INVALID")

    def test_different_discount_cannot_stack_through_a_derived_quote(self):
        data = coupon_case()
        data["promotions"].append({**data["promotions"][0], "id": "checkout", "kind": "CHECKOUT",
            "value": "26", "conditions": ["CHECKOUT-26"], "applies_to": ["coupon-price"]})
        data["quotes"].append({**data["quotes"][1], "id": "stacked", "amount": "11.09",
            "discounts_reflected": ["checkout"], "conditions": ["CHECKOUT-26"],
            "calculation": {"base_quote_id": "coupon-price", "promotion_id": "checkout"}})
        self.assert_issue(check(data), "UNSUPPORTED_STACK_OR_REFERENCE_BASE", "INVALID")

    def test_derived_price_cannot_shed_conditions_or_move_to_other_variant(self):
        for changes, code in [({"kind": "NORMAL"}, "CONDITIONAL_PRICE_AS_UNIVERSAL"),
                ({"selected_variant": "other"}, "CALCULATION_CONTEXT_MISMATCH"),
                ({"conditions": []}, "CALCULATION_CONDITIONS_MISMATCH")]:
            data = coupon_case()
            data["quotes"][1].update(changes)
            self.assert_issue(check(data), code, "INVALID")

    def test_unknown_coupon_eligibility_cannot_become_verified(self):
        data = coupon_case()
        data["promotions"][0]["eligibility"] = "UNKNOWN"
        self.assertEqual(check(data)["status"], "INCOMPLETE")

    def test_mixed_conditional_and_ordinary_cohort_is_gated(self):
        data = coupon_case()
        data["comparison"] = request(["base", "coupon-price"], conditions=["CLIPPED-25"])
        self.assert_issue(check(data), "MIXED_CONDITIONS", "INCOMPLETE")

    def test_multibuy_is_not_a_single_offer_discount(self):
        data = coupon_case()
        data["promotions"][0].update(kind="MULTIBUY", minimum_quantity=2)
        self.assert_issue(check(data), "BASKET_CALCULATION_REQUIRED", "INCOMPLETE")

    def test_fixed_discount_currency_and_discount_bounds(self):
        data = coupon_case()
        data["promotions"][0].update(discount_type="AMOUNT", value="5", currency="EUR")
        self.assert_issue(check(data), "PROMOTION_CURRENCY_MISMATCH", "INVALID")
        data = coupon_case()
        data["promotions"][0]["value"] = "101"
        self.assert_issue(check(data), "INVALID_DISCOUNT", "INVALID")
        data = coupon_case()
        data["promotions"][0].update(discount_type="AMOUNT", value="20", currency="USD")
        self.assert_issue(check(data), "NEGATIVE_EFFECTIVE_PRICE", "INVALID")

    def test_input_is_unchanged_and_result_serializes_without_nan(self):
        data = coupon_case()
        original = copy.deepcopy(data)
        result = check(data)
        self.assertEqual(data, original)
        json.dumps(result, allow_nan=False)

    def test_unselected_unknown_quote_does_not_erase_scoped_comparison(self):
        data = pair()
        data["quotes"].append(quote("unused", None, region=None))
        result = check(data)
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertEqual(result["summary"]["comparison_status"], "CHECKED")
        self.assertEqual(len(result["summary"]["normalized_prices"]), 2)

    def test_invalid_identity_cannot_be_reported_as_checked_calculation(self):
        data = coupon_case()
        data["quotes"][1]["selected_variant"] = "other-variant"
        result = check(data)
        self.assertEqual(result["status"], "INVALID")
        self.assertEqual(result["summary"]["checked_calculations"], [])

    def test_duplicate_selected_quote_never_releases_comparison(self):
        data = pair()
        data["quotes"].append(quote("a", "1.00"))
        result = check(data)
        self.assertEqual(result["summary"]["comparison_status"], "GATED")

    def test_rounded_unit_display_does_not_prove_pack_checkout(self):
        data = pair()
        data["quotes"][1].update(amount="9.00", basis="UNIT", pack_units=2)
        result = check(data)
        self.assert_issue(result, "PACK_TOTAL_REQUIRED", "INCOMPLETE")
        self.assertEqual(result["summary"]["normalized_prices"], [])
        data["quotes"][1].update(amount="17.99", basis="PACK")
        data["comparison"]["basis"] = "UNIT"
        result = check(data)
        self.assertEqual(result["status"], "PASS")
        row = result["summary"]["normalized_prices"][1]
        self.assertEqual(row["amount"], "9.00")
        self.assertEqual(row["unrounded_normalized_amount"], "8.995")
        self.assertEqual(row["amount_semantics"], "DERIVED_PER_UNIT_AVERAGE_NOT_SINGLE_UNIT_OFFER")

    def test_pack_coupon_cannot_be_subtracted_from_unit_display(self):
        # A $5-per-pack coupon on 2 x $10 means $15 per pack / $7.50 per unit,
        # not $5 per unit. Without the original PACK price, both guesses gate.
        for amount in ("5", "7.50"):
            data = coupon_case()
            data["quotes"][0].update(amount="10", basis="UNIT")
            data["quotes"][1].update(amount=amount, basis="UNIT")
            data["promotions"][0].update(discount_type="AMOUNT", value="5", currency="USD")
            result = check(data)
            self.assert_issue(result, "PACK_TOTAL_REQUIRED", "INCOMPLETE")
            self.assertEqual(result["summary"]["checked_calculations"], [])
        data["quotes"][0].update(amount="20", basis="PACK")
        data["quotes"][1].update(amount="15", basis="PACK")
        self.assertEqual(check(data)["status"], "PASS")

    def test_percent_coupon_also_needs_original_pack_price(self):
        data = coupon_case()
        data["quotes"][0].update(amount="9.00", basis="UNIT")
        data["quotes"][1].update(amount="6.75", basis="UNIT")
        result = check(data)
        self.assert_issue(result, "PACK_TOTAL_REQUIRED", "INCOMPLETE")
        self.assertEqual(result["summary"]["checked_calculations"], [])


if __name__ == "__main__":
    unittest.main()
