#!/usr/bin/env python3
"""Mechanically audit Amazon visible Listing copy and backend Search Terms.

The caller must supply marketplace/category rules that were verified at runtime.
This script checks lengths, counts, configured prohibited content, repetition,
keyword coverage, and obvious duplication. It cannot verify factual evidence,
legal compliance, or conversion performance.

Input JSON example:
{
  "audit_scope": "full",
  "title": "Brand Product Type, 2 Pack, Key Attribute",
  "item_highlight": "Optional highlight",
  "bullets": ["...", "...", "...", "...", "..."],
  "product_description": "Optional only when the current schema supports it",
  "search_terms": "alternate name use case synonym",
  "seller_brand": "Brand",
  "competitor_brands": ["Competitor Brand"],
  "asins": ["BXXXXXXXXX"],
  "other_indexed_fields": ["Brand", "structured attribute value"],
  "search_term_exclusions": ["custom blocked term"],
  "keywords": ["product type", "key attribute"],
  "rules": {
    "title_max": 75,
    "item_highlight_max": 125,
    "product_description_max": 2000,
    "expected_bullet_count": 5,
    "bullet_min": 10,
    "bullet_max": 255,
    "title_forbidden_characters": ["!", "$", "?", "_", "{", "}", "^", "¬", "¦"],
    "title_max_word_repetition": 2,
    "title_repeat_exempt_words": ["a", "an", "and", "for", "of", "the", "to", "with"],
    "forbidden_phrases": ["free shipping", "money-back guarantee"],
    "search_terms_required": true,
    "search_terms_policy_verified": true,
    "search_terms_exclusions_verified": true,
    "policy_snapshot_verified": true,
    "evidence_mapping_verified": true,
    "search_terms_max_bytes": 249,
    "search_terms_require_lowercase": true,
    "search_terms_require_single_spaces": true,
    "search_terms_forbidden_phrases": ["on sale", "free shipping"],
    "search_terms_prohibited_token_exemptions": [],
    "search_terms_stop_words": ["a", "an", "and", "for", "of", "the", "with"]
  }
}
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


DEFAULT_RISK_PHRASES = (
    "#1",
    "amazon's choice",
    "amazon choice",
    "best seller",
    "bestseller",
    "free shipping",
    "limited time",
    "money-back",
    "money back",
    "100% safe",
    "guaranteed results",
    "certified safe",
    "cures ",
    "works with every",
    "waterproof forever",
    "best performance guaranteed",
    "risk-free",
)

URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
WORD_RE = re.compile(r"[^\W_]+(?:[-'][^\W_]+)*", re.UNICODE)
SEARCH_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)
ASIN_RE = re.compile(r"\bB0[A-Z0-9]{8}\b", re.IGNORECASE)
DEFAULT_SEARCH_TERM_PROHIBITED_TOKENS = frozenset(
    {
        "amazing",
        "best",
        "cheap",
        "cheapest",
        "current",
        "discounted",
        "effective",
        "fastest",
        "latest",
        "new",
        "popular",
        "sale",
        "trending",
    }
)


@dataclass
class Finding:
    severity: str
    code: str
    location: str
    message: str


def compact_space(value: str) -> str:
    return " ".join(value.split())


def normalize(value: str) -> str:
    return compact_space(value).casefold()


def tokens(value: str) -> list[str]:
    return [token.casefold() for token in WORD_RE.findall(value)]


def search_tokens(value: str) -> list[str]:
    """Tokenize for backend deduplication, splitting punctuation and hyphens."""
    return [token.casefold() for token in SEARCH_TOKEN_RE.findall(value)]


def similarity(left: str, right: str) -> float:
    left_tokens = set(tokens(left))
    right_tokens = set(tokens(right))
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def require_type(data: dict[str, Any], key: str, expected: type, default: Any) -> Any:
    value = data.get(key, default)
    if not isinstance(value, expected):
        raise ValueError(f"{key!r} must be {expected.__name__}")
    return value


def positive_int_or_none(rules: dict[str, Any], key: str) -> int | None:
    value = rules.get(key)
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"rules.{key} must be a positive integer or null")
    return value


def boolean_rule(rules: dict[str, Any], key: str, default: bool) -> bool:
    value = rules.get(key, default)
    if not isinstance(value, bool):
        raise ValueError(f"rules.{key} must be a boolean")
    return value


def contains_phrase(value: str, phrase: str) -> bool:
    value_tokens = search_tokens(value)
    phrase_tokens = search_tokens(phrase)
    if not phrase_tokens or len(phrase_tokens) > len(value_tokens):
        return False
    width = len(phrase_tokens)
    return any(value_tokens[index : index + width] == phrase_tokens for index in range(len(value_tokens) - width + 1))


def contains_all_terms(value: str, terms: str) -> bool:
    required = set(search_tokens(terms))
    return bool(required) and required <= set(search_tokens(value))


def normalize_identifier(value: str) -> str:
    return "".join(character.casefold() for character in value if character.isalnum())


def contains_identifier(value: str, identifier: str) -> bool:
    normalized_identifier = normalize_identifier(identifier)
    return bool(normalized_identifier) and normalized_identifier in normalize_identifier(value)


def audit(data: dict[str, Any]) -> dict[str, Any]:
    audit_scope = require_type(data, "audit_scope", str, "full")
    if audit_scope not in {"full", "search_terms_only"}:
        raise ValueError("'audit_scope' must be 'full' or 'search_terms_only'")

    title = require_type(data, "title", str, "")
    item_highlight = require_type(data, "item_highlight", str, "")
    bullets = require_type(data, "bullets", list, [])
    product_description = require_type(data, "product_description", str, "")
    search_terms = require_type(data, "search_terms", str, "")
    seller_brand = require_type(data, "seller_brand", str, "")
    competitor_brands = require_type(data, "competitor_brands", list, [])
    supplied_asins = require_type(data, "asins", list, [])
    other_indexed_fields = require_type(data, "other_indexed_fields", list, [])
    search_term_exclusions = require_type(data, "search_term_exclusions", list, [])
    keywords = require_type(data, "keywords", list, [])
    rules = require_type(data, "rules", dict, {})

    if any(not isinstance(item, str) for item in bullets):
        raise ValueError("every bullet must be a string")
    if any(not isinstance(item, str) for item in competitor_brands):
        raise ValueError("every competitor_brands item must be a string")
    if any(not isinstance(item, str) for item in supplied_asins):
        raise ValueError("every asins item must be a string")
    if any(not isinstance(item, str) for item in other_indexed_fields):
        raise ValueError("every other_indexed_fields item must be a string")
    if any(not isinstance(item, str) for item in search_term_exclusions):
        raise ValueError("every search_term_exclusions item must be a string")
    if any(not isinstance(item, str) for item in keywords):
        raise ValueError("every keyword must be a string")

    title_max = positive_int_or_none(rules, "title_max")
    item_highlight_max = positive_int_or_none(rules, "item_highlight_max")
    product_description_max = positive_int_or_none(rules, "product_description_max")
    bullet_min = positive_int_or_none(rules, "bullet_min")
    bullet_max = positive_int_or_none(rules, "bullet_max")
    expected_bullet_count = positive_int_or_none(rules, "expected_bullet_count")
    max_word_repetition = positive_int_or_none(rules, "title_max_word_repetition")
    search_terms_max_bytes = positive_int_or_none(rules, "search_terms_max_bytes")
    search_terms_required = boolean_rule(rules, "search_terms_required", True)
    search_terms_policy_verified = boolean_rule(rules, "search_terms_policy_verified", False)
    search_terms_exclusions_verified = boolean_rule(
        rules, "search_terms_exclusions_verified", False
    )
    policy_snapshot_verified = boolean_rule(
        rules, "policy_snapshot_verified", False
    )
    evidence_mapping_verified = boolean_rule(
        rules, "evidence_mapping_verified", False
    )
    search_terms_require_lowercase = boolean_rule(
        rules, "search_terms_require_lowercase", True
    )
    search_terms_require_single_spaces = boolean_rule(
        rules, "search_terms_require_single_spaces", True
    )

    forbidden_chars = rules.get("title_forbidden_characters", [])
    forbidden_phrases = rules.get("forbidden_phrases", [])
    exempt_words = rules.get("title_repeat_exempt_words", [])
    search_terms_forbidden_phrases = rules.get("search_terms_forbidden_phrases", [])
    search_terms_prohibited_token_exemptions = rules.get(
        "search_terms_prohibited_token_exemptions", []
    )
    search_terms_stop_words = rules.get("search_terms_stop_words", [])
    for field_name, values in (
        ("title_forbidden_characters", forbidden_chars),
        ("forbidden_phrases", forbidden_phrases),
        ("title_repeat_exempt_words", exempt_words),
        ("search_terms_forbidden_phrases", search_terms_forbidden_phrases),
        ("search_terms_prohibited_token_exemptions", search_terms_prohibited_token_exemptions),
        ("search_terms_stop_words", search_terms_stop_words),
    ):
        if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
            raise ValueError(f"rules.{field_name} must be an array of strings")

    findings: list[Finding] = []

    def add(severity: str, code: str, location: str, message: str) -> None:
        findings.append(Finding(severity, code, location, message))

    if audit_scope == "full":
        release_package = data.get("release_package")
        if not isinstance(release_package, dict):
            add("WARN", "RELEASE_PACKAGE_UNBOUND", "release_package", "A full mechanical PASS requires the exact release package to be validated")
        else:
            validator_path = Path(__file__).with_name("validate_listing_package.py")
            spec = importlib.util.spec_from_file_location("listing_release_validator_for_audit", validator_path)
            if spec is None or spec.loader is None:
                raise RuntimeError("Cannot load listing release validator")
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            release_result = module.validate(release_package)
            if not release_result["release_ready"]:
                add("FAIL", "RELEASE_PACKAGE_NOT_READY", "release_package", "The supplied release package did not pass its evidence and permission gate")
            release_copy = release_package.get("listing_copy", {})
            if not isinstance(release_copy, dict) or any(
                release_copy.get(key) != value
                for key, value in (
                    ("title", title), ("item_highlight", item_highlight),
                    ("bullets", bullets), ("product_description", product_description),
                    ("search_terms", search_terms),
                )
            ):
                add("FAIL", "RELEASE_COPY_MISMATCH", "release_package.listing_copy", "Audited copy must equal the validated release copy in every field")

    if audit_scope == "full":
        if not policy_snapshot_verified:
            add(
                "WARN",
                "POLICY_SNAPSHOT_UNVERIFIED",
                "rules.policy_snapshot_verified",
                "Mechanical checks cannot approve release without a current verified policy snapshot",
            )
        if not evidence_mapping_verified:
            add(
                "WARN",
                "EVIDENCE_MAPPING_UNVERIFIED",
                "rules.evidence_mapping_verified",
                "Mechanical checks cannot approve release without validated claim-to-fact mappings",
            )
        if not title.strip():
            add("FAIL", "TITLE_EMPTY", "title", "Title is empty")
        if title != title.strip() or "  " in title:
            add("WARN", "TITLE_SPACING", "title", "Trim leading/trailing or repeated spaces")
        if title_max is not None and len(title) > title_max:
            add("FAIL", "TITLE_LENGTH", "title", f"{len(title)} characters exceeds verified limit {title_max}")

        for char in forbidden_chars:
            if char and char in title:
                add("FAIL", "TITLE_FORBIDDEN_CHAR", "title", f"Contains configured forbidden character {char!r}")

        if max_word_repetition is not None:
            exemptions = {word.casefold() for word in exempt_words}
            counts: dict[str, int] = {}
            for word in tokens(title):
                if word in exemptions:
                    continue
                counts[word] = counts.get(word, 0) + 1
            for word, count in sorted(counts.items()):
                if count > max_word_repetition:
                    add(
                        "FAIL",
                        "TITLE_WORD_REPETITION",
                        "title",
                        f"Word {word!r} appears {count} times; configured maximum is {max_word_repetition}",
                    )

    if audit_scope == "full" and item_highlight:
        if item_highlight != item_highlight.strip() or "  " in item_highlight:
            add("WARN", "HIGHLIGHT_SPACING", "item_highlight", "Trim leading/trailing or repeated spaces")
        if item_highlight_max is not None and len(item_highlight) > item_highlight_max:
            add(
                "FAIL",
                "HIGHLIGHT_LENGTH",
                "item_highlight",
                f"{len(item_highlight)} characters exceeds verified limit {item_highlight_max}",
            )

    if audit_scope == "full" and product_description:
        if product_description != product_description.strip() or "  " in product_description:
            add(
                "WARN",
                "PRODUCT_DESCRIPTION_SPACING",
                "product_description",
                "Trim leading/trailing or repeated spaces",
            )
        if product_description_max is not None and len(product_description) > product_description_max:
            add(
                "FAIL",
                "PRODUCT_DESCRIPTION_LENGTH",
                "product_description",
                f"{len(product_description)} characters exceeds verified limit {product_description_max}",
            )

    if audit_scope == "full" and expected_bullet_count is not None and len(bullets) != expected_bullet_count:
        add(
            "FAIL",
            "BULLET_COUNT",
            "bullets",
            f"Found {len(bullets)} bullets; expected {expected_bullet_count}",
        )

    for index, bullet in enumerate(bullets, start=1):
        if audit_scope != "full":
            break
        location = f"bullet_{index}"
        if not bullet.strip():
            add("FAIL", "BULLET_EMPTY", location, "Bullet is empty")
            continue
        if bullet != bullet.strip() or "  " in bullet:
            add("WARN", "BULLET_SPACING", location, "Trim leading/trailing or repeated spaces")
        if bullet_min is not None and len(bullet) < bullet_min:
            add("FAIL", "BULLET_TOO_SHORT", location, f"{len(bullet)} characters is below verified minimum {bullet_min}")
        if bullet_max is not None and len(bullet) > bullet_max:
            add("FAIL", "BULLET_TOO_LONG", location, f"{len(bullet)} characters exceeds verified limit {bullet_max}")

    visible_fields = [("title", title), ("item_highlight", item_highlight)] + [
        (f"bullet_{index}", bullet) for index, bullet in enumerate(bullets, start=1)
    ] + [("product_description", product_description)]
    configured_phrases = [phrase for phrase in forbidden_phrases if phrase]

    for location, value in visible_fields:
        if audit_scope != "full":
            break
        lowered = normalize(value)
        if not lowered:
            continue
        if URL_RE.search(value):
            add("FAIL", "URL", location, "Contains a URL")
        if EMAIL_RE.search(value):
            add("FAIL", "EMAIL", location, "Contains an email address")
        for phrase in configured_phrases:
            if normalize(phrase) in lowered:
                add("FAIL", "CONFIGURED_FORBIDDEN_PHRASE", location, f"Contains configured phrase {phrase!r}")
        for phrase in DEFAULT_RISK_PHRASES:
            if phrase.casefold() in lowered:
                add("WARN", "RISK_PHRASE", location, f"Review potentially promotional or unsupported phrase {phrase!r}")

    for left_index in range(len(bullets)):
        if audit_scope != "full":
            break
        for right_index in range(left_index + 1, len(bullets)):
            score = similarity(bullets[left_index], bullets[right_index])
            if score >= 0.75:
                add(
                    "WARN",
                    "BULLET_DUPLICATION",
                    f"bullet_{left_index + 1}/bullet_{right_index + 1}",
                    f"High token overlap ({score:.0%}); verify that the bullets answer different buyer questions",
                )

    if search_terms_required and not search_terms.strip():
        add("FAIL", "SEARCH_TERMS_EMPTY", "search_terms", "Search Terms are required but empty")

    search_term_token_list = search_tokens(search_terms)
    search_term_byte_count = len(search_terms.encode("utf-8"))
    if search_terms:
        if search_terms_max_bytes is None:
            add(
                "WARN",
                "SEARCH_TERMS_LIMIT_UNVERIFIED",
                "search_terms",
                "No runtime-verified UTF-8 byte limit was supplied",
            )
        if not search_terms_policy_verified:
            add(
                "WARN",
                "SEARCH_TERMS_POLICY_UNVERIFIED",
                "search_terms",
                "Current field format and prohibited-content rules were not marked verified",
            )
        if not search_terms_exclusions_verified:
            add(
                "WARN",
                "SEARCH_TERMS_EXCLUSIONS_UNVERIFIED",
                "search_terms",
                "Seller brand, competitor brands, and ASIN exclusions were not marked complete",
            )
        if search_terms_require_single_spaces and search_terms != compact_space(search_terms):
            add(
                "WARN",
                "SEARCH_TERMS_SPACING",
                "search_terms",
                "Use one literal space between terms and remove leading, trailing, repeated, tab, or newline whitespace",
            )
        if search_terms_require_lowercase and search_terms != search_terms.lower():
            add("WARN", "SEARCH_TERMS_CASE", "search_terms", "Use lowercase unless the verified field requires otherwise")
        if search_terms_require_single_spaces and any(
            not (character.isalnum() or character == " ") for character in search_terms
        ):
            add("WARN", "SEARCH_TERMS_PUNCTUATION", "search_terms", "Use spaces instead of punctuation")
        if search_terms_max_bytes is not None and search_term_byte_count > search_terms_max_bytes:
            add(
                "FAIL",
                "SEARCH_TERMS_BYTES",
                "search_terms",
                f"{search_term_byte_count} UTF-8 bytes exceeds verified maximum {search_terms_max_bytes}",
            )
        if URL_RE.search(search_terms):
            add("FAIL", "SEARCH_TERMS_URL", "search_terms", "Contains a URL")
        if EMAIL_RE.search(search_terms):
            add("FAIL", "SEARCH_TERMS_EMAIL", "search_terms", "Contains an email address")
        if ASIN_RE.search(search_terms):
            add("FAIL", "SEARCH_TERMS_ASIN", "search_terms", "Contains an ASIN-like token")

        counts: dict[str, int] = {}
        for token in search_term_token_list:
            counts[token] = counts.get(token, 0) + 1
        repeated_tokens = sorted(token for token, count in counts.items() if count > 1)
        if repeated_tokens:
            add(
                "WARN",
                "SEARCH_TERMS_DUPLICATE",
                "search_terms",
                f"Repeated normalized terms: {', '.join(repeated_tokens)}",
            )

        visible_and_structured = " ".join([title, item_highlight, *bullets, product_description, *other_indexed_fields])
        indexed_token_set = set(search_tokens(visible_and_structured))
        redundant_tokens = sorted(set(search_term_token_list) & indexed_token_set)
        if redundant_tokens:
            add(
                "WARN",
                "SEARCH_TERMS_FRONTEND_REDUNDANCY",
                "search_terms",
                f"Already represented in visible or structured fields: {', '.join(redundant_tokens)}",
            )

        for phrase in search_terms_forbidden_phrases:
            if contains_all_terms(search_terms, phrase):
                add(
                    "FAIL",
                    "SEARCH_TERMS_FORBIDDEN_PHRASE",
                    "search_terms",
                    f"Contains configured prohibited phrase {phrase!r}",
                )
        exemption_tokens = {
            token.casefold() for token in search_terms_prohibited_token_exemptions
        }
        prohibited_tokens = sorted(
            (set(search_term_token_list) & DEFAULT_SEARCH_TERM_PROHIBITED_TOKENS)
            - exemption_tokens
        )
        if prohibited_tokens:
            add(
                "FAIL",
                "SEARCH_TERMS_PROHIBITED_TOKEN",
                "search_terms",
                f"Contains temporary or subjective prohibited terms: {', '.join(prohibited_tokens)}",
            )

        for brand in [seller_brand, *competitor_brands]:
            if contains_all_terms(search_terms, brand):
                add(
                    "FAIL",
                    "SEARCH_TERMS_BRAND",
                    "search_terms",
                    f"Contains seller or competitor brand terms {brand!r}",
                )
        for asin in supplied_asins:
            if contains_identifier(search_terms, asin):
                add(
                    "FAIL",
                    "SEARCH_TERMS_SUPPLIED_ASIN",
                    "search_terms",
                    f"Contains supplied ASIN or ISBN {asin!r}",
                )
        for phrase in search_term_exclusions:
            if contains_all_terms(search_terms, phrase):
                add(
                    "FAIL",
                    "SEARCH_TERMS_EXCLUSION",
                    "search_terms",
                    f"Contains excluded brand, ASIN, or term {phrase!r}",
                )

        stop_words = {token.casefold() for token in search_terms_stop_words}
        present_stop_words = sorted(set(search_term_token_list) & stop_words)
        if present_stop_words:
            add(
                "WARN",
                "SEARCH_TERMS_STOP_WORDS",
                "search_terms",
                f"Remove unnecessary stop words: {', '.join(present_stop_words)}",
            )

    visible_copy = normalize(" ".join([title, item_highlight, *bullets, product_description]))
    normalized_search_terms = normalize(search_terms)
    all_indexed_tokens = set(search_tokens(" ".join([title, item_highlight, *bullets, product_description, *other_indexed_fields, search_terms])))
    coverage = []
    for keyword in keywords:
        cleaned = normalize(keyword)
        if not cleaned:
            continue
        keyword_tokens = set(search_tokens(cleaned))
        exact_visible_phrase = contains_phrase(visible_copy, cleaned)
        exact_search_terms_phrase = contains_phrase(normalized_search_terms, cleaned)
        token_covered_across_fields = bool(keyword_tokens) and keyword_tokens <= all_indexed_tokens
        present = exact_visible_phrase or exact_search_terms_phrase or token_covered_across_fields
        coverage.append(
            {
                "keyword": keyword,
                "present": present,
                "exact_visible_phrase": exact_visible_phrase,
                "exact_search_terms_phrase": exact_search_terms_phrase,
                "token_covered_across_fields": token_covered_across_fields,
            }
        )
        if not present:
            add("WARN", "KEYWORD_MISSING", "all_fields", f"Keyword {keyword!r} is not mechanically covered")

    metrics = {
        "title_characters": len(title),
        "item_highlight_characters": len(item_highlight),
        "product_description_characters": len(product_description),
        "bullet_characters": [len(bullet) for bullet in bullets],
        "bullet_count": len(bullets),
        "search_terms_bytes": search_term_byte_count,
        "search_terms_tokens": len(search_term_token_list),
        "search_terms_unique_tokens": len(set(search_term_token_list)),
        "keywords_checked": len(coverage),
        "keywords_present": sum(1 for item in coverage if item["present"]),
    }
    fail_count = sum(1 for item in findings if item.severity == "FAIL")
    warn_count = sum(1 for item in findings if item.severity == "WARN")

    return {
        "status": "FAIL" if fail_count else ("WARN" if warn_count else "PASS"),
        "metrics": metrics,
        "keyword_coverage": coverage,
        "findings": [asdict(item) for item in findings],
        "limitations": [
            "Does not verify factual evidence or claim scope",
            "Does not replace current Amazon marketplace/category policy checks",
            "Does not provide legal, regulatory, trademark, or certification approval",
            "Does not predict ranking, traffic, or conversion",
            "Does not guarantee that Amazon will index any Search Term",
            "Cannot detect every trademark, inflection, semantic duplicate, or structured-field redundancy without caller-supplied exclusions",
        ],
    }


def render_text(result: dict[str, Any]) -> str:
    lines = [f"Listing audit: {result['status']}"]
    metrics = result["metrics"]
    lines.append(
        "Metrics: "
        f"title={metrics['title_characters']} chars; "
        f"highlight={metrics['item_highlight_characters']} chars; "
        f"product_description={metrics['product_description_characters']} chars; "
        f"bullets={metrics['bullet_count']} {metrics['bullet_characters']}; "
        f"search_terms={metrics['search_terms_bytes']} UTF-8 bytes/"
        f"{metrics['search_terms_tokens']} tokens/"
        f"{metrics['search_terms_unique_tokens']} unique"
    )
    if result["keyword_coverage"]:
        found = metrics["keywords_present"]
        checked = metrics["keywords_checked"]
        lines.append(f"Keyword mechanical coverage: {found}/{checked}")
    if result["findings"]:
        lines.append("Findings:")
        for finding in result["findings"]:
            lines.append(
                f"- {finding['severity']} {finding['code']} [{finding['location']}]: {finding['message']}"
            )
    else:
        lines.append("Findings: none")
    lines.append("Limitations:")
    lines.extend(f"- {item}" for item in result["limitations"])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Path to UTF-8 JSON input")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("top-level JSON value must be an object")
        result = audit(data)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Input error: {exc}", file=sys.stderr)
        return 2

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render_text(result))
    return 1 if result["status"] == "FAIL" else 0


if __name__ == "__main__":
    raise SystemExit(main())
