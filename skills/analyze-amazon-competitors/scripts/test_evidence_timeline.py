#!/usr/bin/env python3
"""Focused timeline regressions; synthetic local evidence, no network or account."""

import copy
import json
from pathlib import Path
import unittest

from evidence_timeline import check, IDENTITY_FIELDS


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def fixture(name):
    return json.loads((FIXTURES / f"evidence_timeline_{name}.json").read_text(encoding="utf-8"))


def comparable_change():
    data = fixture("different_asin")
    data["events"][1]["asin"] = data["events"][0]["asin"]
    return data


def effect_claim(kind="EFFECT"):
    data = comparable_change()
    action = copy.deepcopy(data["events"][0])
    action.update(id="action-1", kind="CHANGE", source_ref="capture/action.json",
                  first_observed_at="2026-10-24T01:00:00+08:00",
                  actual_changed_at="2026-10-24T00:00:00+08:00",
                  change_source_ref="capture/action.json#effective-date", values={})
    data["events"].append(action)
    data["comparisons"][0].update(kind=kind, action_event_id="action-1", followup_window={
        "start": "2026-10-24T00:00:00+08:00", "end": "2026-10-25T23:00:00+08:00"})
    return data


class EvidenceTimelineTests(unittest.TestCase):
    def assert_code(self, data, status, code):
        result = check(data)
        self.assertEqual(result["status"], status, result)
        self.assertIn(code, [item["code"] for item in result["issues"]], result)
        return result

    def test_snapshot_only_passes_without_inventing_history_or_effect(self):
        data = fixture("snapshot")
        before = copy.deepcopy(data)
        result = check(data)
        self.assertEqual(result["status"], "PASS", result)
        self.assertEqual(data, before)
        self.assertEqual(result["summary"]["effect_evidence_status"], "NOT_ESTABLISHED")
        self.assertFalse(result["summary"]["complete_history_verified"])
        self.assertFalse(result["summary"]["causality_approved"])

    def test_historical_other_model_cannot_become_price_drop(self):
        result = self.assert_code(fixture("different_asin"), "INVALID", "COMPARISON_CONTEXT_MISMATCH")
        self.assertEqual(result["issues"][0]["path"], "$.comparisons[0].asin")

    def test_observed_difference_needs_no_precise_change_time(self):
        result = check(comparable_change())
        self.assertEqual(result["status"], "PASS", result)
        self.assertEqual(result["summary"]["observational_comparisons_checked"], 1)
        self.assertEqual(result["summary"]["effect_evidence_status"], "NOT_ESTABLISHED")

    def test_unknown_actual_change_event_is_allowed_without_effect_claim(self):
        data = fixture("snapshot")
        data["events"][0]["kind"] = "CHANGE"
        self.assertEqual(check(data)["status"], "PASS")

    def test_snapshot_cannot_promote_capture_to_precise_change_time(self):
        data = fixture("snapshot")
        data["events"][0]["actual_changed_at"] = data["events"][0]["first_observed_at"]
        self.assert_code(data, "INVALID", "SNAPSHOT_HAS_CHANGE_TIME")

    def test_exact_change_time_needs_source_locator(self):
        data = effect_claim()
        del data["events"][2]["change_source_ref"]
        self.assert_code(data, "INCOMPLETE", "MISSING_SOURCE")

    def test_all_comparison_contexts_are_checked(self):
        for field in IDENTITY_FIELDS:
            with self.subTest(field=field):
                data = comparable_change()
                data["events"][1][field] = 3 if field == "pack_count" else "different"
                self.assert_code(data, "INVALID", "COMPARISON_CONTEXT_MISMATCH")

    def test_unknown_context_even_when_both_unknown_is_incomplete(self):
        for missing in (None, "UNKNOWN", ""):
            with self.subTest(missing=missing):
                data = comparable_change()
                for event in data["events"]:
                    event["eligibility"] = missing
                self.assert_code(data, "INCOMPLETE", "UNKNOWN_COMPARISON_CONTEXT")

    def test_missing_values_not_zero_or_no_change(self):
        for kind in ("CHANGE", "NO_CHANGE", "ASSOCIATION"):
            data = comparable_change()
            data["comparisons"][0]["kind"] = kind
            data["events"][1]["values"] = {"price": None}
            self.assert_code(data, "INCOMPLETE", "UNKNOWN_COMPARISON_VALUE")

    def test_known_zero_is_valid_and_not_unknown(self):
        data = comparable_change()
        data["events"][1]["values"]["price"] = 0
        self.assertEqual(check(data)["status"], "PASS")

    def test_equal_values_cannot_claim_observed_change(self):
        data = comparable_change()
        data["events"][1]["values"] = copy.deepcopy(data["events"][0]["values"])
        self.assert_code(data, "INVALID", "NO_OBSERVED_DIFFERENCE")
        data["comparisons"][0]["kind"] = "NO_CHANGE"
        self.assertEqual(check(data)["status"], "PASS")

    def test_different_values_cannot_claim_no_change(self):
        data = comparable_change()
        data["comparisons"][0]["kind"] = "NO_CHANGE"
        self.assert_code(data, "INVALID", "OBSERVED_DIFFERENCE")

    def test_boolean_is_not_numeric_zero(self):
        data = comparable_change()
        data["events"][0]["values"]["price"] = False
        data["events"][1]["values"]["price"] = 0
        self.assert_code(data, "INVALID", "COMPARISON_VALUE_TYPE")

    def test_effect_and_causality_never_approved_by_dates_alone(self):
        for kind in ("EFFECT", "CAUSAL"):
            result = self.assert_code(effect_claim(kind), "INCOMPLETE", "EFFECT_REQUIRES_INDEPENDENT_REVIEW")
            self.assertEqual(result["summary"]["effect_claims"], 1)
            self.assertFalse(result["summary"]["causality_approved"])

    def test_effect_without_actual_time_remains_incomplete(self):
        data = effect_claim()
        data["events"][2]["actual_changed_at"] = None
        self.assert_code(data, "INCOMPLETE", "UNKNOWN_ACTUAL_CHANGE_TIME")

    def test_effect_cannot_use_snapshot_as_action(self):
        data = effect_claim()
        data["comparisons"][0]["action_event_id"] = data["events"][0]["id"]
        self.assert_code(data, "INVALID", "ACTION_IS_SNAPSHOT")

    def test_followup_cannot_precede_event(self):
        data = effect_claim()
        data["comparisons"][0]["followup_window"]["start"] = "2026-10-23T23:59:00+08:00"
        self.assert_code(data, "INVALID", "FOLLOWUP_BEFORE_EVENT")

    def test_reversed_followup_is_invalid(self):
        data = effect_claim()
        data["comparisons"][0]["followup_window"]["end"] = "2026-10-23T23:59:00+08:00"
        self.assert_code(data, "INVALID", "FOLLOWUP_ORDER")

    def test_pending_window_does_not_become_observed_result(self):
        data = effect_claim()
        data["comparisons"][0]["followup_window"]["end"] = "2026-10-27T01:00:00+08:00"
        self.assert_code(data, "INCOMPLETE", "FOLLOWUP_PENDING")
        self.assert_code(data, "INCOMPLETE", "OUTCOME_WINDOW_NOT_COVERED")

    def test_change_after_capture_is_invalid(self):
        data = effect_claim()
        data["events"][2]["actual_changed_at"] = "2026-10-24T02:00:00+08:00"
        self.assert_code(data, "INVALID", "CHANGE_AFTER_OBSERVATION")

    def test_observation_after_explicit_cutoff_is_invalid(self):
        data = fixture("snapshot")
        data["as_of"] = "2026-10-25T00:00:00Z"
        self.assert_code(data, "INVALID", "OBSERVATION_AFTER_AS_OF")

    def test_as_of_and_observation_are_required(self):
        for field in ("as_of", "first_observed_at"):
            data = fixture("snapshot")
            del (data if field == "as_of" else data["events"][0])[field]
            self.assert_code(data, "INCOMPLETE", "MISSING_TIMESTAMP")

    def test_timezone_comparison_uses_instants_not_string_order(self):
        data = comparable_change()
        data["events"][0]["first_observed_at"] = "2026-10-25T18:00:00+02:00"
        data["events"][1]["first_observed_at"] = "2026-10-26T01:30:00+08:00"
        self.assertEqual(check(data)["status"], "PASS")

    def test_same_or_reversed_endpoints_invalid(self):
        for same in (False, True):
            data = comparable_change()
            data["events"][1]["first_observed_at"] = data["events"][0]["first_observed_at"]
            if not same:
                data["events"][1]["first_observed_at"] = "2026-10-20T00:00:00Z"
            self.assert_code(data, "INVALID", "OBSERVATION_ORDER")

    def test_duplicate_and_missing_event_ids_rejected(self):
        data = comparable_change()
        data["events"].append(copy.deepcopy(data["events"][0]))
        self.assert_code(data, "INVALID", "DUPLICATE_EVENT_ID")
        data = comparable_change()
        data["comparisons"][0]["after_event_id"] = "not-in-events"
        self.assert_code(data, "INVALID", "EVENT_REFERENCE")

    def test_snapshot_source_required(self):
        data = fixture("snapshot")
        del data["events"][0]["source_ref"]
        self.assert_code(data, "INCOMPLETE", "MISSING_SOURCE")

    def test_malformed_top_level_and_collections_do_not_raise(self):
        for bad in ([], "UNKNOWN", True, 0):
            self.assertEqual(check(bad)["status"], "INVALID")
        for field in ("events", "comparisons"):
            for bad in (None, {}, "events", 1, True):
                data = fixture("snapshot")
                data[field] = bad
                self.assertEqual(check(data)["status"], "INVALID")

    def test_explicit_null_timeline_is_incomplete(self):
        self.assert_code(None, "INCOMPLETE", "MISSING_TIMELINE")

    def test_misspelled_comparisons_cannot_silently_pass_as_snapshots(self):
        data = fixture("different_asin")
        data["comparisions"] = data.pop("comparisons")
        self.assert_code(data, "INVALID", "UNKNOWN_FIELD")

    def test_unknown_fields_rejected_in_events_comparisons_and_windows(self):
        for scope, field in (("event", "actual_change_at"), ("comparison", "after_event"),
                             ("window", "until")):
            data = effect_claim()
            target = (data["events"][0] if scope == "event" else data["comparisons"][0]
                      if scope == "comparison" else data["comparisons"][0]["followup_window"])
            target[field] = None
            with self.subTest(scope=scope):
                self.assert_code(data, "INVALID", "UNKNOWN_FIELD")

    def test_comparison_id_and_open_metric_names_preserved(self):
        data = comparable_change()
        data["comparisons"][0]["id"] = "comparison-1"
        data["comparisons"][0]["field"] = "custom_observed_metric"
        for i, event in enumerate(data["events"]):
            event["values"]["custom_observed_metric"] = i
        self.assertEqual(check(data)["status"], "PASS")
        data["comparisons"][0]["id"] = []
        self.assert_code(data, "INVALID", "COMPARISON_ID")

    def test_invalid_or_incomplete_endpoint_not_counted_as_checked(self):
        for field, value in (("source_ref", None), ("first_observed_at", None),
                             ("first_observed_at", "invalid"), ("values", [])):
            with self.subTest(field=field, value=value):
                data = comparable_change()
                data["events"][0][field] = value
                result = check(data)
                self.assertNotEqual(result["status"], "PASS")
                self.assertEqual(result["summary"]["observational_comparisons_checked"], 0)

    def test_referenced_action_missing_source_not_counted_as_checked(self):
        for field in ("source_ref", "change_source_ref"):
            with self.subTest(field=field):
                data = effect_claim("ASSOCIATION")
                data["events"][2][field] = None
                result = self.assert_code(data, "INCOMPLETE", "MISSING_SOURCE")
                self.assertEqual(result["summary"]["observational_comparisons_checked"], 0)

    def test_duplicate_id_and_missing_cutoff_not_counted_as_checked(self):
        data = comparable_change()
        data["events"].append(copy.deepcopy(data["events"][0]))
        self.assertEqual(check(data)["summary"]["observational_comparisons_checked"], 0)
        data = comparable_change()
        del data["as_of"]
        self.assertEqual(check(data)["summary"]["observational_comparisons_checked"], 0)

    def test_unhashable_or_bad_event_fields_do_not_raise(self):
        for field in ("id", "kind", "first_observed_at", "actual_changed_at", "source_ref", "asin", "pack_count", "values"):
            for bad in ([], {}, True, 1):
                if field == "pack_count" and bad == 1 and not isinstance(bad, bool):
                    continue
                if field == "values" and bad == {}:
                    continue
                data = fixture("snapshot")
                data["events"][0][field] = bad
                with self.subTest(field=field, bad=bad):
                    self.assertEqual(check(data)["status"], "INVALID")

    def test_unhashable_or_bad_comparison_fields_do_not_raise(self):
        for field in ("kind", "before_event_id", "after_event_id", "field", "action_event_id", "followup_window"):
            for bad in ([], {}, True, 1):
                data = comparable_change()
                data["comparisons"][0][field] = bad
                with self.subTest(field=field, bad=bad):
                    result = check(data)
                    self.assertNotEqual(result["status"], "PASS")

    def test_timezone_missing_and_nonfinite_values_rejected(self):
        for bad in ("2026-10-26", "2026-10-26T01:30:00", "invalid", "2026-99-99T99:99:99Z"):
            data = fixture("snapshot")
            data["events"][0]["first_observed_at"] = bad
            self.assert_code(data, "INVALID", "INVALID_TIMESTAMP")
        for bad in (float("nan"), float("inf"), -float("inf"), [], {}):
            data = fixture("snapshot")
            data["events"][0]["values"]["price"] = bad
            self.assert_code(data, "INVALID", "VALUE_TYPE")


if __name__ == "__main__":
    unittest.main()
