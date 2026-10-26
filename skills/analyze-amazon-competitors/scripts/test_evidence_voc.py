"""Offline regression tests for VOC provenance, scope and count semantics."""

from copy import deepcopy
import json
from pathlib import Path
import unittest

from evidence_voc import check


HERE = Path(__file__).resolve().parent


def sample():
    return {"targets": [{"marketplace": "US", "asin": "B000000001"}], "pages": [{
        "marketplace": "US", "host_asin": "B000000001", "access_status": "OBSERVED",
        "source_locator": "capture/page.html", "captured_at": "2026-10-25T12:00:00Z",
        "sampling": {"method": "detail-page visible reviews", "sort_order": "TOP"},
        "reviews": [{"review_id": "R001", "review_variant_asin": "B000000001",
                     "review_date": "2026-09-01", "source_locator": "capture/page.html#R001",
                     "evidence_kind": "RAW_REVIEW", "rating": 5}]}]}


class VocTests(unittest.TestCase):
    def assert_code(self, result, code, status=None):
        self.assertIn(code, {item["code"] for item in result["issues"]})
        if status:
            self.assertEqual(result["status"], status)

    def test_valid_target_and_no_input_mutation(self):
        data = sample(); before = deepcopy(data); r = check(data)
        self.assertEqual(r["status"], "PASS")
        self.assertEqual(r["summary"]["target_reviews"], 1)
        self.assertEqual(r["summary"]["target_count_status"], "OBSERVED_SAMPLE")
        self.assertEqual(data, before)

    def test_anonymized_24_8_0_fixture(self):
        r = check(json.loads((HERE / "fixtures/evidence_voc_24_8_0.json").read_text()))
        self.assertEqual(r["status"], "PASS")
        s = r["summary"]
        self.assertEqual((s["raw_review_occurrences"], s["deduplicated_raw_occurrences"], s["unique_review_ids"], s["independent_raw_reviews"], s["target_reviews"], s["non_target_reviews"]), (24, 24, 8, 8, 0, 8))

    def test_blocked_fixture_has_unknown_target_count(self):
        r = check(json.loads((HERE / "fixtures/evidence_voc_blocked.json").read_text()))
        self.assertEqual(r["status"], "INCOMPLETE")
        self.assertIsNone(r["summary"]["target_reviews"])
        self.assertEqual(r["summary"]["target_count_status"], "UNAVAILABLE")
        self.assertEqual(r["summary"]["unavailable_page_count"], 3)
        self.assertTrue(all(p["raw_review_count"] is None for p in r["summary"]["pages"]))
        self.assertEqual({i["code"] for i in r["issues"]}, {"LOGIN_REQUIRED", "PARSE_ERROR", "NOT_COLLECTED"})

    def test_observed_empty_is_verified_sample_zero(self):
        d = sample(); d["pages"][0].update(access_status="OBSERVED_EMPTY", reviews=[])
        r = check(d)
        self.assertEqual(r["status"], "PASS")
        self.assertEqual(r["summary"]["target_reviews"], 0)
        self.assertEqual(r["summary"]["pages"][0]["raw_review_count"], 0)

    def test_unspecified_empty_is_not_verified_zero(self):
        d = sample(); d["pages"][0]["reviews"] = []
        r = check(d); self.assert_code(r, "EMPTY_SAMPLE_UNCONFIRMED", "INCOMPLETE")
        self.assertIsNone(r["summary"]["target_reviews"])

    def test_blocked_or_empty_with_records_is_invalid(self):
        for state in ["LOGIN_REQUIRED", "PARSE_ERROR", "NOT_COLLECTED", "OBSERVED_EMPTY"]:
            with self.subTest(state=state):
                d = sample(); d["pages"][0]["access_status"] = state
                r = check(d)
                self.assertEqual(r["status"], "INVALID")
                self.assertIsNone(r["summary"]["target_reviews"])

    def test_partial_failure_preserves_other_page(self):
        d = sample(); failed = deepcopy(d["pages"][0]); failed.update(host_asin="B000000002", access_status="LOGIN_REQUIRED", reviews=[]); d["pages"].append(failed)
        r = check(d)
        self.assertEqual(r["status"], "INCOMPLETE")
        self.assertEqual(r["summary"]["target_reviews"], 1)
        self.assertEqual(r["summary"]["target_count_status"], "PARTIAL_SAMPLE")
        self.assertEqual([p["status"] for p in r["summary"]["pages"]], ["PASS", "INCOMPLETE"])

    def test_same_source_capture_cannot_be_both_observed_and_empty_or_blocked(self):
        for state in ["OBSERVED_EMPTY", "LOGIN_REQUIRED", "PARSE_ERROR"]:
            with self.subTest(state=state):
                d = sample(); other = deepcopy(d["pages"][0]); other.update(access_status=state, reviews=[]); d["pages"].append(other)
                r = check(d)
                self.assert_code(r, "CONFLICTING_CAPTURE_STATUS", "INVALID")
                self.assertEqual(r["summary"]["independent_raw_reviews"], 0)
                self.assertIsNone(r["summary"]["target_reviews"])

    def test_repeated_page_and_record_are_one_evidence_occurrence(self):
        d = sample(); d["pages"][0]["reviews"] *= 2; d["pages"].append(deepcopy(d["pages"][0]))
        r = check(d); s = r["summary"]
        self.assertEqual(r["status"], "PASS")
        self.assertEqual((s["raw_review_occurrences"], s["deduplicated_raw_occurrences"], s["duplicate_occurrences"], s["independent_raw_reviews"]), (4, 1, 3, 1))

    def test_same_id_in_different_marketplace_is_independent(self):
        d = sample(); other = deepcopy(d["pages"][0]); other["marketplace"] = "CA"; d["pages"].append(other)
        d["targets"].append({"marketplace": "CA", "asin": "B000000001"})
        r = check(d)
        self.assertEqual(r["status"], "PASS")
        self.assertEqual(r["summary"]["independent_raw_reviews"], 2)
        self.assertEqual(r["summary"]["target_reviews"], 2)

    def test_host_does_not_supply_review_variant(self):
        d = sample(); d["pages"][0]["reviews"][0]["review_variant_asin"] = None
        r = check(d)
        self.assertEqual(r["status"], "INCOMPLETE")
        self.assertEqual(r["summary"]["independent_raw_reviews"], 1)
        self.assertEqual(r["summary"]["unattributed_reviews"], 1)
        self.assertEqual(r["summary"]["target_reviews"], 0)
        self.assertEqual(r["summary"]["target_count_status"], "PARTIAL_SAMPLE")

    def test_missing_ids_are_not_independent_or_deduped_by_text_guess(self):
        d = sample(); rev = d["pages"][0]["reviews"][0]; del rev["review_id"]
        d["pages"][0]["reviews"].append({**rev, "source_locator": "capture/page.html#second"})
        r = check(d); s = r["summary"]
        self.assertEqual(r["status"], "INCOMPLETE")
        self.assertEqual((s["independent_raw_reviews"], s["unverified_occurrences"]), (0, 2))
        self.assertIsNone(s["target_reviews"])

    def test_non_raw_material_is_excluded(self):
        for kind in ["AI_SUMMARY", "APLUS_TESTIMONIAL"]:
            with self.subTest(kind=kind):
                d = sample(); d["pages"][0]["reviews"][0]["evidence_kind"] = kind
                r = check(d)
                self.assert_code(r, "NO_RAW_VOC", "INCOMPLETE")
                self.assertEqual(r["summary"]["independent_raw_reviews"], 0)
                self.assertEqual(r["summary"]["excluded_non_raw_occurrences"], 1)
                self.assertIsNone(r["summary"]["target_reviews"])

    def test_variant_conflict_excludes_all_occurrences_in_any_order(self):
        d = sample(); other = deepcopy(d["pages"][0]); other["captured_at"] = "2026-10-26T12:00:00Z"; other["reviews"][0]["review_variant_asin"] = "B000000002"; d["pages"].append(other)
        for pages in [d["pages"], list(reversed(d["pages"]))]:
            r = check({**d, "pages": pages})
            self.assert_code(r, "CONFLICTING_REVIEW_ID", "INVALID")
            self.assertEqual(r["summary"]["conflicting_review_ids"], 1)
            self.assertEqual(r["summary"]["independent_raw_reviews"], 0)
            self.assertTrue(all(p["status"] == "INVALID" for p in r["summary"]["pages"]))

    def test_same_capture_fingerprint_date_or_rating_conflict(self):
        for field, before, after in [("content_fingerprint", "a" * 64, "b" * 64), ("review_date", "2026-09-01", "2026-09-02"), ("rating", 5, 1)]:
            with self.subTest(field=field):
                d = sample(); d["pages"][0]["reviews"][0][field] = before
                other = deepcopy(d["pages"][0]); other["host_asin"] = "B000000002"; other["reviews"][0][field] = after; d["pages"].append(other)
                self.assert_code(check(d), "CONFLICTING_REVIEW_ID", "INVALID")

    def test_legitimate_later_edits_are_not_identity_conflicts(self):
        d = sample(); d["pages"][0]["reviews"][0]["content_fingerprint"] = "a" * 64
        other = deepcopy(d["pages"][0]); other["captured_at"] = "2026-10-26T12:00:00Z"
        other["reviews"][0].update(review_date="2026-10-26", rating=3, content_fingerprint="b" * 64)
        d["pages"].append(other); r = check(d)
        self.assertEqual(r["status"], "PASS")
        self.assertEqual(r["summary"]["independent_raw_reviews"], 1)
        self.assertEqual(r["summary"]["deduplicated_raw_occurrences"], 2)

    def test_richer_duplicate_does_not_use_arbitrary_first_record(self):
        d = sample(); other = deepcopy(d["pages"][0]); other["host_asin"] = "B000000002"
        d["pages"][0]["reviews"][0]["review_variant_asin"] = None; d["pages"].append(other)
        for pages in [d["pages"], list(reversed(d["pages"]))]:
            r = check({**d, "pages": pages})
            self.assertEqual(r["status"], "INCOMPLETE")
            self.assertEqual(r["summary"]["target_reviews"], 1)
            self.assertEqual(r["summary"]["unattributed_reviews"], 0)

    def test_timezone_equivalent_capture_deduplicates(self):
        d = sample(); other = deepcopy(d["pages"][0]); other["captured_at"] = "2026-10-25T20:00:00+08:00"; d["pages"].append(other)
        r = check(d)
        self.assertEqual(r["status"], "PASS")
        self.assertEqual(r["summary"]["deduplicated_raw_occurrences"], 1)

    def test_date_only_review_and_aware_timestamp_accepted(self):
        for value in ["2026-09-01", "2026-09-01T08:00:00+08:00"]:
            d = sample(); d["pages"][0]["reviews"][0]["review_date"] = value
            self.assertEqual(check(d)["status"], "PASS")

    def test_dates_reject_naive_capture_invalid_dates_and_gross_future(self):
        for value in ["2026-10-25", "2026-10-25T12:00:00", "2026-02-30T12:00:00Z", "0001-01-01T00:00:00+14:00"]:
            d = sample(); d["pages"][0]["captured_at"] = value
            self.assert_code(check(d), "INVALID_DATE", "INVALID")
        for value in ["2026-10-27", "2026-10-25T12:00:01Z"]:
            d = sample(); d["pages"][0]["reviews"][0]["review_date"] = value
            self.assert_code(check(d), "REVIEW_AFTER_CAPTURE", "INVALID")
        d = sample(); d["pages"][0]["reviews"][0]["review_date"] = "2026-10-26"
        self.assertEqual(check(d)["status"], "PASS")

    def test_missing_data_is_incomplete(self):
        for data in [None, {}, {"targets": [], "pages": []}]:
            self.assertEqual(check(data)["status"], "INCOMPLETE")
        for field in ["review_id", "review_date", "source_locator", "review_variant_asin", "evidence_kind"]:
            d = sample(); del d["pages"][0]["reviews"][0][field]
            self.assertEqual(check(d)["status"], "INCOMPLETE", field)

    def test_wrong_types_and_nonfinite_values_never_crash(self):
        bad = [True, False, 0, 1.1, float("nan"), float("inf"), "", " ", [], {}]
        for value in bad:
            if value != {}:
                self.assertEqual(check(value)["status"], "INVALID", repr(value))
            for field in ["review_id", "review_variant_asin", "review_date", "source_locator", "evidence_kind", "content_fingerprint", "rating"]:
                with self.subTest(field=field, value=repr(value)):
                    d = sample(); d["pages"][0]["reviews"][0][field] = value
                    result = check(d)
                    self.assertEqual(result["status"], "INVALID")
                    json.dumps(result, allow_nan=False)
        d = sample(); d["pages"][0]["reviews"][0]["rating"] = 10 ** 1000
        self.assert_code(check(d), "INVALID_RATING", "INVALID")

    def test_malformed_nested_containers(self):
        for field in ["targets", "pages"]:
            for value in [True, 4, "", {}, [None], [False]]:
                d = sample(); d[field] = value
                self.assertIn(check(d)["status"], {"INVALID", "INCOMPLETE"})
        for field in ["marketplace", "host_asin", "source_locator", "captured_at", "access_status", "sampling", "reviews"]:
            d = sample(); d["pages"][0][field] = False
            self.assertEqual(check(d)["status"], "INVALID", field)

    def test_unknown_fields_and_enums_fail_closed(self):
        for location in ["root", "page", "review"]:
            d = sample(); target = d if location == "root" else d["pages"][0] if location == "page" else d["pages"][0]["reviews"][0]
            target["sample_count"] = 100
            self.assert_code(check(d), "UNKNOWN_FIELD", "INVALID")
        d = sample(); d["pages"][0]["access_status"] = "EMPTY"
        self.assert_code(check(d), "INVALID_ACCESS_STATUS", "INVALID")


if __name__ == "__main__":
    unittest.main()
