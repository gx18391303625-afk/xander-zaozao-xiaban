#!/usr/bin/env python3
"""Validate a bounded VOC sample; never fetch data or infer population counts.

Input (all field names below are closed):
  {"targets": [{"marketplace": "US", "asin": "B000000001"}], "pages": [{
    "marketplace": "US", "host_asin": "B000000001",
    "access_status": "OBSERVED", "source_locator": "saved/page.html",
    "captured_at": "2026-10-25T17:00:00Z",
    "sampling": {"method": "visible detail-page reviews", "sort_order": "TOP"},
    "reviews": [{"review_id": "R001", "review_variant_asin": "B000000002",
      "review_date": "2026-09-01", "source_locator": "saved/page.html#R001",
      "evidence_kind": "RAW_REVIEW", "content_fingerprint": "<optional SHA256>",
      "rating": 5}]}]}

Access: OBSERVED, OBSERVED_EMPTY, LOGIN_REQUIRED, PARSE_ERROR, NOT_COLLECTED.
Only an explicit OBSERVED_EMPTY with an empty reviews array establishes a zero
observed sample. Blocked/uncollected pages have null counts, never inferred zero.
Evidence kinds: RAW_REVIEW, AI_SUMMARY, APLUS_TESTIMONIAL. The latter two are
excluded from raw VOC. Missing IDs are unverified, not independent reviews.
Review dates accept YYYY-MM-DD or timezone-aware ISO timestamps; capture times
require a timezone. Variant ASIN may be unknown (null), without inventing host
ownership. Scope is marketplace + ASIN; review identity is marketplace + ID.
Date-only reviews have a one-day future tolerance for differing display/capture
timezones; timestamped reviews must not occur after capture.

check(data) returns status, issues[{code,path,message}], and summary. PASS means
this sample's metadata is consistent, not representative or factually verified.
INCOMPLETE denotes missing/blocked evidence; INVALID denotes malformed input or
contradictions. Per-page results and usable unaffected reviews remain visible.
target_reviews is null without a usable sample; PARTIAL_SAMPLE counts are known
matches only, not complete target totals. Content/date/rating edits across capture
times are permitted; contradictory variants or same-capture values are rejected.
This module exposes check(data); use validate_competitor_evidence.py for the CLI.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import math
import re
from typing import Any


ACCESS = {"OBSERVED", "OBSERVED_EMPTY", "LOGIN_REQUIRED", "PARSE_ERROR", "NOT_COLLECTED"}
KINDS = {"RAW_REVIEW", "AI_SUMMARY", "APLUS_TESTIMONIAL"}
ASIN = re.compile(r"[A-Z0-9]{10}\Z")
LEVEL = {"PASS": 0, "INCOMPLETE": 1, "INVALID": 2}


def check(data: Any) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    levels: list[str] = []
    summary: dict[str, Any] = {
        "scope": "observed sample only; no population or sentiment-frequency inference",
        "records_seen": 0, "raw_review_occurrences": 0,
        "deduplicated_raw_occurrences": 0, "duplicate_occurrences": 0,
        "unique_review_ids": 0, "independent_raw_reviews": 0,
        "target_reviews": None, "non_target_reviews": None,
        "unattributed_reviews": 0, "conflicting_review_ids": 0,
        "unverified_occurrences": 0, "excluded_non_raw_occurrences": 0,
        "target_scope_complete": False, "target_count_status": "UNAVAILABLE",
        "observed_page_count": 0, "unavailable_page_count": 0, "pages": [],
    }

    def add(code: str, path: str, message: str, level: str = "INVALID") -> None:
        issues.append({"code": code, "path": path, "message": message})
        levels.append(level)

    def output() -> dict[str, Any]:
        return {"status": max(levels, key=LEVEL.get, default="PASS"),
                "issues": issues, "summary": summary}

    def missing(path: str) -> None:
        add("MISSING_EVIDENCE", path, "Evidence is missing; do not substitute zero or host ownership.", "INCOMPLETE")

    def obj(value: Any, path: str, fields: set[str]) -> bool:
        if value is None:
            missing(path)
            return False
        if not isinstance(value, dict):
            add("INVALID_TYPE", path, "Expected an object.")
            return False
        for key in value:
            if key not in fields:
                add("UNKNOWN_FIELD", path, f"Unexpected field: {key!r}.")
        return True

    def text(value: Any, path: str, required: bool = True) -> str | None:
        if value is None:
            if required:
                missing(path)
            return None
        if not isinstance(value, str) or not value.strip():
            add("INVALID_TEXT", path, "Expected a nonblank string.")
            return None
        return value.strip()

    def asin(value: Any, path: str) -> str | None:
        value = text(value, path)
        if value is not None and not ASIN.fullmatch(value):
            add("INVALID_ASIN", path, "Expected a 10-character uppercase ASIN.")
            return None
        return value

    def market(value: Any, path: str) -> str | None:
        value = text(value, path)
        if value is not None:
            value = value.upper()
            if not re.fullmatch(r"[A-Z][A-Z0-9_-]{1,24}", value):
                add("INVALID_MARKETPLACE", path, "Use a stable marketplace code or ID consistently.")
                return None
        return value

    def when(value: Any, path: str, date_allowed: bool = False) -> date | datetime | None:
        value = text(value, path)
        if value is None:
            return None
        try:
            if date_allowed and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                return date.fromisoformat(value)
            result = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if result.tzinfo is None or result.utcoffset() is None:
                raise ValueError("timezone required")
            result.astimezone(timezone.utc)  # Validate that UTC normalization is representable.
            return result
        except (ValueError, OverflowError):
            add("INVALID_DATE", path, "Use an ISO date for review_date or a timezone-aware ISO timestamp.")
            return None

    def array(value: Any, path: str) -> list[Any] | None:
        if value is None:
            missing(path)
            return None
        if not isinstance(value, list):
            add("INVALID_TYPE", path, "Expected an array.")
            return None
        return value

    if not obj(data, "$", {"targets", "pages"}):
        return output()
    targets = array(data.get("targets"), "$.targets")
    target_keys: set[tuple[str, str]] = set()
    target_start = len(issues)
    if targets == []:
        missing("$.targets")
    for index, target in enumerate(targets or []):
        path = f"$.targets[{index}]"
        if not obj(target, path, {"marketplace", "asin"}):
            continue
        m = market(target.get("marketplace"), path + ".marketplace")
        a = asin(target.get("asin"), path + ".asin")
        if m and a:
            target_keys.add((m, a))
    summary["target_scope_complete"] = bool(target_keys) and len(issues) == target_start and targets is not None
    if target_keys:
        summary["target_reviews"] = 0
        if summary["target_scope_complete"]:
            summary["non_target_reviews"] = 0
    pages = array(data.get("pages"), "$.pages")
    if pages == []:
        missing("$.pages")
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    occurrences: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    excluded_keys: set[tuple[Any, ...]] = set()
    capture_claims: dict[tuple[str, ...], list[dict[str, Any]]] = {}

    for index, page in enumerate(pages or []):
        path = f"$.pages[{index}]"
        start = len(levels)
        page_result: dict[str, Any] = {"path": path, "status": "PASS", "raw_review_count": None}
        summary["pages"].append(page_result)
        fields = {"marketplace", "host_asin", "access_status", "source_locator", "captured_at", "sampling", "reviews"}
        if not obj(page, path, fields):
            page_result["status"] = max(levels[start:], key=LEVEL.get)
            continue
        m = market(page.get("marketplace"), path + ".marketplace")
        host = asin(page.get("host_asin"), path + ".host_asin")
        locator = text(page.get("source_locator"), path + ".source_locator")
        captured = when(page.get("captured_at"), path + ".captured_at")
        access = text(page.get("access_status"), path + ".access_status")
        page_result.update(marketplace=m, host_asin=host, access_status=access)
        if m and host and locator and isinstance(captured, datetime):
            capture_key = (m, host, locator, captured.astimezone(timezone.utc).isoformat())
            capture_claims.setdefault(capture_key, []).append(page_result)
        if access is not None and access not in ACCESS:
            add("INVALID_ACCESS_STATUS", path + ".access_status", "Unknown review-access status.")
        reviews = array(page.get("reviews"), path + ".reviews")
        if access in {"LOGIN_REQUIRED", "PARSE_ERROR", "NOT_COLLECTED"}:
            add(access, path, "Review sample is unavailable in this capture; its count remains unknown.", "INCOMPLETE")
            if reviews:
                add("ACCESS_RECORD_CONFLICT", path + ".reviews", "Unavailable/failed capture cannot assert retrieved review records.")
        elif access == "OBSERVED_EMPTY" and reviews:
            add("EMPTY_RECORD_CONFLICT", path + ".reviews", "OBSERVED_EMPTY requires an explicitly empty reviews array.")
        elif access == "OBSERVED" and reviews == []:
            add("EMPTY_SAMPLE_UNCONFIRMED", path + ".reviews", "Use OBSERVED_EMPTY only after verifying the source contains no sample.", "INCOMPLETE")

        page_good = len(levels) == start
        if access in {"OBSERVED", "OBSERVED_EMPTY"}:
            sampling = page.get("sampling")
            if obj(sampling, path + ".sampling", {"method", "sort_order"}):
                text(sampling.get("method"), path + ".sampling.method")
                text(sampling.get("sort_order"), path + ".sampling.sort_order")
            page_good = page_good and len(levels) == start
        if access == "OBSERVED_EMPTY" and reviews == [] and page_good:
            page_result["raw_review_count"] = 0
        if access != "OBSERVED" or reviews is None:
            page_result["status"] = max(levels[start:], key=LEVEL.get, default="PASS")
            continue

        raw_count = 0
        for ri, review in enumerate(reviews):
            rp = f"{path}.reviews[{ri}]"
            record_start = len(levels)
            summary["records_seen"] += 1
            if not obj(review, rp, {"review_id", "review_variant_asin", "review_date", "source_locator", "evidence_kind", "content_fingerprint", "rating"}):
                continue
            kind = text(review.get("evidence_kind"), rp + ".evidence_kind")
            if kind not in KINDS:
                if kind is not None:
                    add("INVALID_EVIDENCE_KIND", rp + ".evidence_kind", "Unknown evidence kind; do not assume RAW_REVIEW.")
                continue
            review_locator = text(review.get("source_locator"), rp + ".source_locator")
            stamp = captured.astimezone(timezone.utc).isoformat() if isinstance(captured, datetime) else None
            if kind != "RAW_REVIEW":
                excluded_keys.add((m, host, stamp, kind, review_locator) if m and host and stamp and review_locator else (rp,))
                continue
            raw_count += 1
            summary["raw_review_occurrences"] += 1
            rid = text(review.get("review_id"), rp + ".review_id")
            reviewed = when(review.get("review_date"), rp + ".review_date", date_allowed=True)
            fingerprint = text(review.get("content_fingerprint"), rp + ".content_fingerprint", required=False)
            if fingerprint is not None:
                if not re.fullmatch(r"[a-fA-F0-9]{64}", fingerprint):
                    add("INVALID_FINGERPRINT", rp + ".content_fingerprint", "Expected a SHA256 hex digest.")
                fingerprint = fingerprint.lower()
            rating = review.get("rating")
            if rating is not None and (isinstance(rating, bool) or not isinstance(rating, (int, float)) or (isinstance(rating, float) and not math.isfinite(rating)) or rating not in {1, 2, 3, 4, 5}):
                add("INVALID_RATING", rp + ".rating", "Rating must be a finite integer from 1 to 5.")
                rating = None
            if captured is not None and reviewed is not None:
                future = reviewed > captured if isinstance(reviewed, datetime) else (reviewed - captured.date()).days > 1
                if future:
                    add("REVIEW_AFTER_CAPTURE", rp + ".review_date", "Review date is later than this source capture.")
            eligible = page_good and len(levels) == record_start
            variant_start = len(levels)
            variant = asin(review.get("review_variant_asin"), rp + ".review_variant_asin")
            if "INVALID" in levels[variant_start:]:
                eligible = False
            entry = {"path": rp, "page": page_result, "variant": variant, "date": reviewed,
                     "fingerprint": fingerprint, "rating": rating, "captured": stamp,
                     "eligible": eligible, "identity": (m, rid) if m and rid else None}
            occurrence_key = (m, host, stamp, review_locator, rid) if m and host and stamp and review_locator else (rp,)
            occurrences.setdefault(occurrence_key, []).append(entry)
            if m and rid:
                groups.setdefault((m, rid), []).append(entry)
        if page_good:
            page_result["raw_review_count"] = raw_count
        if reviews and raw_count == 0:
            add("NO_RAW_VOC", path, "No raw VOC was obtained; summaries/testimonials cannot replace reviews.", "INCOMPLETE")
        page_result["status"] = max(levels[start:], key=LEVEL.get, default="PASS")

    def compatible_dates(left: date | datetime, right: date | datetime) -> bool:
        if isinstance(left, datetime) and isinstance(right, datetime):
            return left == right
        return (left.date() if isinstance(left, datetime) else left) == (right.date() if isinstance(right, datetime) else right)

    conflicts: set[tuple[str, str]] = set()
    invalid_captures: set[str] = set()
    for claims in capture_claims.values():
        states = {claim["access_status"] for claim in claims if claim["access_status"] in ACCESS}
        if len(states) > 1 and states & {"OBSERVED", "OBSERVED_EMPTY"}:
            add("CONFLICTING_CAPTURE_STATUS", claims[0]["path"], "The same source capture is both observed and empty/unavailable; resolve its access state.")
            for claim in claims:
                invalid_captures.add(claim["path"])
                claim.update(status="INVALID", raw_review_count=None)
    for identity, entries in groups.items():
        conflicting = []
        if len({entry["variant"] for entry in entries if entry["variant"] is not None}) > 1:
            conflicting.append("variant")
        captures: dict[str, list[dict[str, Any]]] = {}
        for entry in entries:
            if entry["captured"] is not None:
                captures.setdefault(entry["captured"], []).append(entry)
        for captured_entries in captures.values():
            for key in ("fingerprint", "rating"):
                if len({entry[key] for entry in captured_entries if entry[key] is not None}) > 1:
                    conflicting.append(key)
            dates = [entry["date"] for entry in captured_entries if entry["date"] is not None]
            if any(not compatible_dates(a, b) for i, a in enumerate(dates) for b in dates[i + 1:]):
                conflicting.append("review_date")
        if conflicting:
            conflicts.add(identity)
            for entry in entries:
                entry["page"]["status"] = "INVALID"
            add("CONFLICTING_REVIEW_ID", entries[0]["path"], f"Same marketplace/review ID has contradictory {', '.join(conflicting)}; all occurrences are excluded from independent/target counts.")
            continue
        usable = [entry for entry in entries if entry["eligible"] and entry["page"]["path"] not in invalid_captures]
        if not usable:
            continue
        summary["independent_raw_reviews"] += 1
        variants = {entry["variant"] for entry in usable if entry["variant"] is not None}
        if not variants:
            summary["unattributed_reviews"] += 1
        elif target_keys:
            if (identity[0], next(iter(variants))) in target_keys:
                summary["target_reviews"] += 1
            elif summary["target_scope_complete"]:
                summary["non_target_reviews"] += 1

    summary["deduplicated_raw_occurrences"] = len(occurrences)
    summary["duplicate_occurrences"] = summary["raw_review_occurrences"] - len(occurrences)
    summary["unique_review_ids"] = len(groups)
    summary["conflicting_review_ids"] = len(conflicts)
    summary["excluded_non_raw_occurrences"] = len(excluded_keys)
    summary["unverified_occurrences"] = sum(not any(e["eligible"] and e["identity"] not in conflicts and e["page"]["path"] not in invalid_captures for e in entries) for entries in occurrences.values())
    summary["observed_page_count"] = sum(p["raw_review_count"] is not None for p in summary["pages"])
    summary["unavailable_page_count"] = len(summary["pages"]) - summary["observed_page_count"]
    usable_sample = summary["independent_raw_reviews"] > 0 or any(
        p.get("access_status") == "OBSERVED_EMPTY" and p["raw_review_count"] == 0 for p in summary["pages"])
    if target_keys and usable_sample:
        summary["target_count_status"] = "PARTIAL_SAMPLE" if levels else "OBSERVED_SAMPLE"
    else:
        summary["target_reviews"] = None
        summary["non_target_reviews"] = None
    return output()
