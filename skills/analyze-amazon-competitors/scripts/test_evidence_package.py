"""Integration boundary tests for the opt-in evidence checker."""

import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import validate_competitor_evidence as validator


class EvidencePackageTests(unittest.TestCase):
    def test_no_scope_cannot_silently_pass(self):
        for payload in (None, [], {}, {"schema_version": 1},
                        {"schema_version": True, "voc": {}},
                        {"schema_version": 2, "voc": {}},
                        {"schema_version": 1, "vco": {}},
                        {"schema_version": 1, "voc": {}, "offer": {}}):
            with self.subTest(payload=payload):
                self.assertEqual(validator.check(payload)["status"], "INVALID")

    def test_narrow_scope_does_not_run_unrelated_checks(self):
        response = {"status": "PASS", "issues": [], "summary": {}}
        with patch.dict(validator.CHECKERS, {"offers": lambda _: response,
                  "voc": lambda _: self.fail("VOC should not run"),
                  "timeline": lambda _: self.fail("timeline should not run")}):
            output = validator.check({"schema_version": 1, "offers": {}})
        self.assertEqual(output["status"], "PASS")
        self.assertEqual(output["checked_sections"], ["offers"])
        self.assertEqual(output["not_checked_sections"], ["voc", "timeline"])
        self.assertIn("不验证来源真实性", output["boundary"])

    def test_partial_section_does_not_erase_independent_results(self):
        good = {"status": "PASS", "issues": [], "summary": {"kept": True}}
        missing = {"status": "INCOMPLETE", "issues": [], "summary": {}}
        bad = {"status": "INVALID", "issues": [], "summary": {}}
        with patch.dict(validator.CHECKERS, {"offers": lambda _: good,
                  "voc": lambda _: missing, "timeline": lambda _: bad}):
            output = validator.check({"schema_version": 1, "offers": {}, "voc": {}})
            self.assertEqual(output["status"], "INCOMPLETE")
            self.assertEqual(output["sections"]["offers"], good)
            output = validator.check({"schema_version": 1, "offers": {}, "timeline": {}})
            self.assertEqual(output["status"], "INVALID")
            self.assertEqual(output["sections"]["offers"], good)

    def test_nonfinite_nested_number_is_invalid_before_computation(self):
        for value in (float("nan"), float("inf"), -float("inf")):
            output = validator.check({"schema_version": 1, "offers": {"quotes": [{"amount": value}]}})
            self.assertEqual(output["status"], "INVALID")
            self.assertIn("NONFINITE_NUMBER", [i["code"] for i in output["issues"]])

    def run_file(self, text, same_output=False):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.json"
            source.write_text(text, encoding="utf-8")
            args = ["--input", str(source)]
            if same_output:
                args += ["--output", str(source)]
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = validator.main(args)
            self.assertEqual(source.read_text(encoding="utf-8"), text)
            return code, stdout.getvalue(), stderr.getvalue()

    def test_cli_rejects_duplicate_keys_without_last_value_winning(self):
        code, output, error = self.run_file('{"schema_version":1,"voc":{},"voc":null}')
        self.assertEqual(code, 2)
        self.assertEqual(output, "")
        self.assertIn("重复 JSON 字段", error)

    def test_cli_rejects_nan_and_overflow(self):
        for value in ("NaN", "Infinity", "1e10000"):
            code, _, _ = self.run_file('{"schema_version":1,"offers":{"amount":' + value + '}}')
            self.assertEqual(code, 2)

    def test_cli_does_not_overwrite_source_evidence(self):
        code, _, error = self.run_file('{"schema_version":1,"voc":{}}', same_output=True)
        self.assertEqual(code, 2)
        self.assertIn("不能覆盖", error)

    def test_cli_returns_readable_errors_for_missing_or_bad_json(self):
        for text in ("not JSON", "{", "[]"):
            code, _, _ = self.run_file(text)
            self.assertEqual(code, 2)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(validator.main(["--input", "/nonexistent-evidence-input.json"]), 2)

    def test_supplied_unknown_section_remains_a_gap(self):
        # Explicit unknown is different from omitting an unrelated section.
        for name in validator.CHECKERS:
            output = validator.check({"schema_version": 1, name: None})
            self.assertEqual(output["status"], "INCOMPLETE")
            self.assertEqual(output["checked_sections"], [name])

    def test_realistic_fixtures_through_public_cli(self):
        fixture_dir = Path(__file__).parent / "fixtures"
        cases = [("voc", "24_8_0", 0), ("voc", "blocked", 1),
                 ("offers", "price_qualifications", 0), ("offers", "per_count", 0),
                 ("offers", "mixed_eligibility", 1), ("offers", "coupon_reflected", 2),
                 ("timeline", "snapshot", 0), ("timeline", "different_asin", 2)]
        for section, name, expected_code in cases:
            with self.subTest(section=section, name=name):
                data = json.loads((fixture_dir / f"evidence_{section}_{name}.json").read_text())
                code, text, error = self.run_file(json.dumps({"schema_version": 1, section: data}))
                self.assertEqual(code, expected_code, error)
                output = json.loads(text)
                self.assertEqual(output["checked_sections"], [section])
                self.assertEqual(output["sections"][section]["status"], output["status"])
                if section == "voc" and name == "24_8_0":
                    summary = output["sections"][section]["summary"]
                    self.assertEqual([summary[k] for k in ("raw_review_occurrences", "independent_raw_reviews", "target_reviews")], [24, 8, 0])

    def test_mixed_evidence_keeps_valid_prices_when_reviews_blocked(self):
        fixture_dir = Path(__file__).parent / "fixtures"
        payload = {"schema_version": 1,
                   "voc": json.loads((fixture_dir / "evidence_voc_blocked.json").read_text()),
                   "offers": json.loads((fixture_dir / "evidence_offers_price_qualifications.json").read_text())}
        output = validator.check(payload)
        self.assertEqual(output["status"], "INCOMPLETE")
        self.assertIsNone(output["sections"]["voc"]["summary"]["target_reviews"])
        self.assertEqual(output["sections"]["offers"]["status"], "PASS")
        self.assertTrue(output["sections"]["offers"]["summary"]["normalized_prices"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
