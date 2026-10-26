#!/usr/bin/env python3
"""Check supplied offer evidence, never fetch prices or recommend a selling price.

Public API: check({quotes: [...], promotions?: [...], comparison?: {...}}).
Quotes: id, product_id, selected_variant, source_ids, observed_at (aware ISO),
marketplace, currency, kind NORMAL|PRIME|REFERENCE|CONDITIONAL, amount (JSON
number or decimal string), basis PACK|UNIT. Optional comparison metadata:
region, demand_phase, unit_label, pack_units, pack_status CONSISTENT|CONFLICT|
UNKNOWN, pack_evidence [{units, source_id}]. References need reference_type
LIST|TYPICAL|OTHER. Conditional quotes need required_buyer PUBLIC|PRIME,
conditions (stable eligibility labels), eligibility VERIFIED|UNKNOWN.
discounts_reflected lists promotion IDs already contained in a quote.
Optional calculation {base_quote_id, promotion_id} checks ONE discount only.
Promotions: id, kind COUPON|CHECKOUT|MULTIBUY, discount_type PERCENT|AMOUNT,
value, conditions, eligibility VERIFIED|UNKNOWN, applies_to (base quote IDs);
AMOUNT also needs currency. MULTIBUY needs minimum_quantity and is recorded,
but this one-offer checker does not compute a basket or stack discounts.
Comparison: quote_ids, buyer PUBLIC|PRIME, conditions (satisfied conditions),
marketplace, region, currency, demand_phase, aware window_start/window_end,
basis PACK|UNIT. All compared conditional prices must require the same
conditions. No comparison => no requirement to supply its region/phase/pack
metadata. Unknown evidence stays incomplete, never zero. Discount arithmetic
requires an original PACK total, including percentage discounts: a displayed
per-unit price may already be rounded. UNIT-to-PACK multiplication is likewise
gated; PACK-to-UNIT gives a derived average, not a single-unit purchase offer.
Monetary results use currency minor units and ROUND_HALF_UP; source amounts
are never replaced.
PASS means only that supplied structure/calculation passed these checks.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext


KINDS = {"NORMAL", "PRIME", "REFERENCE", "CONDITIONAL"}
QUOTE_FIELDS = {
    "id", "product_id", "selected_variant", "source_ids", "observed_at",
    "marketplace", "region", "currency", "demand_phase", "kind", "amount",
    "basis", "unit_label", "pack_units", "pack_status", "pack_evidence",
    "conditions", "required_buyer", "eligibility", "reference_type",
    "discounts_reflected", "calculation",
}
PROMO_FIELDS = {
    "id", "kind", "discount_type", "value", "conditions", "eligibility",
    "applies_to", "currency", "minimum_quantity",
}
COMPARISON_FIELDS = {
    "quote_ids", "buyer", "conditions", "marketplace", "region", "currency",
    "demand_phase", "window_start", "window_end", "basis",
}
MINOR_UNITS = {**dict.fromkeys(("USD", "EUR", "GBP", "CNY", "CAD", "AUD",
    "NZD", "SGD", "HKD", "MXN", "BRL", "INR", "AED", "SAR", "SEK",
    "PLN", "TRY", "ZAR"), 2), "JPY": 0, "KRW": 0, "KWD": 3,
    "BHD": 3, "OMR": 3}
UNKNOWN = (None, "", "UNKNOWN")


class Audit:
    def __init__(self):
        self.issues = []
        self.invalid = False

    def issue(self, code, path, message, invalid=False):
        self.issues.append({"code": code, "path": path, "message": message})
        self.invalid |= invalid

    def fields(self, obj, allowed, path):
        for key in obj:
            if key not in allowed:
                self.issue("UNKNOWN_FIELD", f"{path}.{key}", "Unsupported field; do not hide price conditions in extra fields.", True)

    def text(self, value, path, required=True):
        if value in UNKNOWN:
            if required:
                self.issue("MISSING_EVIDENCE", path, "A known non-empty value is required here.")
            return None
        if not isinstance(value, str) or not value.strip():
            self.issue("INVALID_TEXT", path, "Expected a non-empty string.", True)
            return None
        return value.strip()

    def enum(self, value, allowed, path, required=True):
        text = self.text(value, path, required)
        if text is not None and text not in allowed:
            self.issue("INVALID_ENUM", path, f"Expected one of {', '.join(sorted(allowed))}.", True)
            return None
        return text

    def strings(self, value, path, required=True):
        if value is None:
            if required:
                self.issue("MISSING_EVIDENCE", path, "Expected an explicit list; unknown is not an empty list.")
            return None
        if not isinstance(value, list):
            self.issue("INVALID_LIST", path, "Expected an array of unique strings.", True)
            return None
        parsed = [self.text(x, f"{path}[{i}]") for i, x in enumerate(value)]
        if any(x is None for x in parsed):
            return None
        if len(set(parsed)) != len(parsed):
            self.issue("DUPLICATE_VALUE", path, "Duplicate entries are not allowed.", True)
        return parsed

    def number(self, value, path, required=True, positive=False, integer=False):
        if value in UNKNOWN:
            if required:
                self.issue("MISSING_NUMBER", path, "Unknown is not zero.")
            return None
        if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
            self.issue("INVALID_NUMBER", path, "Expected a finite decimal number, not a boolean or container.", True)
            return None
        try:
            raw = str(value)
            if len(raw) > 120:
                raise ValueError()
            result = Decimal(raw)
            if not result.is_finite() or len(result.as_tuple().digits) > 60 or abs(result.as_tuple().exponent) > 40:
                raise ValueError()
            if result < 0 or (positive and result <= 0) or (integer and result != result.to_integral_value()):
                raise ValueError()
            return result
        except (InvalidOperation, ValueError, OverflowError):
            self.issue("INVALID_NUMBER", path, "Expected a finite, nonnegative decimal within supported precision (a positive whole number for pack quantities).", True)
            return None

    def timestamp(self, value, path):
        text = self.text(value, path)
        if text is None:
            return None
        try:
            result = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if result.tzinfo is None or result.utcoffset() is None:
                raise ValueError()
            return result
        except (ValueError, OverflowError):
            self.issue("INVALID_TIMESTAMP", path, "Expected an ISO timestamp with timezone.", True)
            return None

    def currency(self, value, path, required=True):
        text = self.text(value, path, required)
        if text is not None and not re.fullmatch(r"[A-Z]{3}", text):
            self.issue("INVALID_CURRENCY", path, "Use a three-letter uppercase currency code.", True)
            return None
        return text

    def round_money(self, value, currency, path):
        digits = MINOR_UNITS.get(currency)
        if digits is None:
            self.issue("CURRENCY_PRECISION_UNKNOWN", path, "Currency minor units are unsupported; no rounded comparison/calculation is released.")
            return None
        try:
            return value.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
        except InvalidOperation:
            self.issue("ARITHMETIC_RANGE_UNSUPPORTED", path, "Amount exceeds supported calculation precision.", True)
            return None


def check(data):
    """Return PASS/INCOMPLETE/INVALID plus issues and a non-authorizing summary."""
    with localcontext() as ctx:
        ctx.prec = 256
        return _check(data)


def _check(data):
    a = Audit()
    comparison_paths = set()
    summary = {"quote_count": 0, "promotion_count": 0, "comparison_requested": False,
        "comparison_status": "NOT_REQUESTED", "normalized_prices": [],
        "checked_calculations": [], "check_scope": "SUPPLIED_STRUCTURE_AND_ARITHMETIC_ONLY",
        "evidence_truth_verified": False, "execution_authorized": False,
        "pricing_recommendation": False}

    def affects(issue, paths):
        return any(issue["path"] == p or issue["path"].startswith(p + ".") or issue["path"].startswith(p + "[") for p in paths)

    def finish():
        if summary["comparison_requested"] and (summary["comparison_status"] != "CHECKED" or any(affects(i, comparison_paths | {"comparison"}) for i in a.issues)):
            summary["comparison_status"] = "GATED"
            summary["normalized_prices"] = []
        return {"status": "INVALID" if a.invalid else "INCOMPLETE" if a.issues else "PASS",
                "issues": a.issues, "summary": summary}

    if data is None:
        a.issue("MISSING_SECTION", "$", "No offer evidence supplied.")
        return finish()
    if not isinstance(data, dict):
        a.issue("INVALID_OBJECT", "$", "Offer section must be an object.", True)
        return finish()
    a.fields(data, {"quotes", "promotions", "comparison"}, "$")
    summary["comparison_requested"] = "comparison" in data
    raw_quotes = data.get("quotes")
    if raw_quotes is None:
        a.issue("MISSING_QUOTES", "quotes", "Supply the quotes being checked.")
        return finish()
    if not isinstance(raw_quotes, list):
        a.issue("INVALID_LIST", "quotes", "quotes must be an array.", True)
        return finish()
    if not raw_quotes:
        a.issue("MISSING_QUOTES", "quotes", "No quote evidence supplied.")
    quotes = {}
    duplicate_quote_ids = set()
    for index, q in enumerate(raw_quotes):
        path = f"quotes[{index}]"
        if not isinstance(q, dict):
            a.issue("INVALID_OBJECT", path, "Each quote must be an object.", True)
            continue
        a.fields(q, QUOTE_FIELDS, path)
        parsed = {"path": path, "raw": q}
        for field in ("id", "product_id", "selected_variant", "marketplace"):
            parsed[field] = a.text(q.get(field), f"{path}.{field}")
        for field in ("region", "demand_phase", "unit_label"):
            parsed[field] = a.text(q.get(field), f"{path}.{field}", False)
        parsed["currency"] = a.currency(q.get("currency"), f"{path}.currency")
        parsed["observed_at"] = a.timestamp(q.get("observed_at"), f"{path}.observed_at")
        sources = a.strings(q.get("source_ids"), f"{path}.source_ids")
        if sources == []:
            a.issue("MISSING_EVIDENCE", f"{path}.source_ids", "A supplied source reference is required, but is not verified by this checker.")
        parsed["kind"] = a.enum(q.get("kind"), KINDS, f"{path}.kind")
        parsed["amount"] = a.number(q.get("amount"), f"{path}.amount")
        parsed["basis"] = a.enum(q.get("basis"), {"PACK", "UNIT"}, f"{path}.basis")
        parsed["conditions"] = a.strings(q.get("conditions", []), f"{path}.conditions")
        parsed["reflected"] = a.strings(q.get("discounts_reflected", []), f"{path}.discounts_reflected")
        parsed["pack_units"] = a.number(q.get("pack_units"), f"{path}.pack_units", False, True, True)
        parsed["pack_status"] = a.enum(q.get("pack_status"), {"CONSISTENT", "CONFLICT"}, f"{path}.pack_status", False)
        parsed["buyer"] = "PRIME" if parsed["kind"] == "PRIME" else "PUBLIC"
        if parsed["kind"] == "REFERENCE":
            a.enum(q.get("reference_type"), {"LIST", "TYPICAL", "OTHER"}, f"{path}.reference_type")
        elif q.get("reference_type") is not None:
            a.issue("REFERENCE_KIND_CONFLICT", f"{path}.reference_type", "A reference label cannot be attached to a current-price kind.", True)
        if parsed["kind"] == "CONDITIONAL":
            parsed["buyer"] = a.enum(q.get("required_buyer"), {"PUBLIC", "PRIME"}, f"{path}.required_buyer")
            parsed["eligibility"] = a.enum(q.get("eligibility"), {"VERIFIED"}, f"{path}.eligibility")
            if not parsed["conditions"]:
                a.issue("MISSING_CONDITIONS", f"{path}.conditions", "Conditional prices require explicit eligibility conditions.")
        else:
            parsed["eligibility"] = None
            if parsed["conditions"] or parsed["reflected"] or q.get("calculation") is not None:
                a.issue("CONDITIONAL_PRICE_AS_UNIVERSAL", path, "Use CONDITIONAL for coupon/checkout-adjusted prices; NORMAL/PRIME cannot hide extra eligibility.", True)
            if q.get("required_buyer") is not None or q.get("eligibility") is not None:
                a.issue("UNEXPECTED_ELIGIBILITY", path, "Extra eligibility fields belong to CONDITIONAL quotes.", True)
        pack_evidence = q.get("pack_evidence", [])
        evidence_counts = set()
        if not isinstance(pack_evidence, list):
            a.issue("INVALID_LIST", f"{path}.pack_evidence", "Expected pack evidence rows.", True)
        else:
            for j, row in enumerate(pack_evidence):
                ep = f"{path}.pack_evidence[{j}]"
                if not isinstance(row, dict):
                    a.issue("INVALID_OBJECT", ep, "Expected units and source_id.", True)
                    continue
                a.fields(row, {"units", "source_id"}, ep)
                count = a.number(row.get("units"), f"{ep}.units", True, True, True)
                a.text(row.get("source_id"), f"{ep}.source_id")
                if count is not None:
                    evidence_counts.add(count)
        if parsed["pack_units"] is not None:
            evidence_counts.add(parsed["pack_units"])
        if len(evidence_counts) > 1 or parsed["pack_status"] == "CONFLICT":
            parsed["pack_status"] = "CONFLICT"
            a.issue("PACK_EVIDENCE_CONFLICT", path, "Pack evidence disagrees; no silent normalization or fixed two-pack assumption.")
        if parsed["id"] is not None:
            if parsed["id"] in quotes:
                duplicate_quote_ids.add(parsed["id"])
                a.issue("DUPLICATE_QUOTE_ID", f"{path}.id", "Quote IDs must be unique.", True)
            else:
                quotes[parsed["id"]] = parsed
    summary["quote_count"] = len(quotes)

    raw_promos = data.get("promotions", [])
    promos = {}
    duplicate_promo_ids = set()
    if not isinstance(raw_promos, list):
        a.issue("INVALID_LIST", "promotions", "promotions must be an array.", True)
        raw_promos = []
    for index, p in enumerate(raw_promos):
        path = f"promotions[{index}]"
        if not isinstance(p, dict):
            a.issue("INVALID_OBJECT", path, "Each promotion must be an object.", True)
            continue
        a.fields(p, PROMO_FIELDS, path)
        parsed = {"path": path, "id": a.text(p.get("id"), f"{path}.id"),
            "kind": a.enum(p.get("kind"), {"COUPON", "CHECKOUT", "MULTIBUY"}, f"{path}.kind"),
            "type": a.enum(p.get("discount_type"), {"PERCENT", "AMOUNT"}, f"{path}.discount_type"),
            "value": a.number(p.get("value"), f"{path}.value"),
            "conditions": a.strings(p.get("conditions"), f"{path}.conditions"),
            "eligibility": a.enum(p.get("eligibility"), {"VERIFIED"}, f"{path}.eligibility"),
            "applies_to": a.strings(p.get("applies_to"), f"{path}.applies_to")}
        if not parsed["conditions"] or not parsed["applies_to"]:
            a.issue("PROMOTION_SCOPE_MISSING", path, "Promotion conditions and applicable base quote IDs must be explicit.")
        parsed["currency"] = a.currency(p.get("currency"), f"{path}.currency", parsed["type"] == "AMOUNT")
        if parsed["type"] == "PERCENT" and parsed["value"] is not None and parsed["value"] > 100:
            a.issue("INVALID_DISCOUNT", f"{path}.value", "Percentage must be between 0 and 100.", True)
        if parsed["kind"] == "MULTIBUY":
            count = a.number(p.get("minimum_quantity"), f"{path}.minimum_quantity", True, True, True)
            if count is not None and count < 2:
                a.issue("INVALID_QUANTITY", f"{path}.minimum_quantity", "MULTIBUY requires at least two sellable offers.", True)
        elif p.get("minimum_quantity") is not None:
            a.issue("PROMOTION_QUANTITY_CONFLICT", path, "Quantity-gated discounts must be MULTIBUY.", True)
        for qid in parsed["applies_to"] or []:
            if qid not in quotes:
                a.issue("UNKNOWN_QUOTE", f"{path}.applies_to", f"Unknown quote ID {qid!r}.", True)
        if parsed["id"] is not None:
            if parsed["id"] in promos:
                duplicate_promo_ids.add(parsed["id"])
                a.issue("DUPLICATE_PROMOTION_ID", f"{path}.id", "Promotion IDs must be unique.", True)
            else:
                promos[parsed["id"]] = parsed
    summary["promotion_count"] = len(promos)

    for q in quotes.values():
        path, raw = q["path"], q["raw"]
        for pid in q["reflected"] or []:
            if pid not in promos:
                a.issue("PROMOTION_REFERENCE_MISSING", f"{path}.discounts_reflected", f"Supply metadata for reflected promotion {pid!r}.")
        if "calculation" not in raw:
            continue
        calculation = raw["calculation"]
        if not isinstance(calculation, dict):
            a.issue("INVALID_CALCULATION", f"{path}.calculation", "Expected one base_quote_id and one promotion_id.", True)
            continue
        a.fields(calculation, {"base_quote_id", "promotion_id"}, f"{path}.calculation")
        base_id = a.text(calculation.get("base_quote_id"), f"{path}.calculation.base_quote_id")
        promo_id = a.text(calculation.get("promotion_id"), f"{path}.calculation.promotion_id")
        base, promo = quotes.get(base_id), promos.get(promo_id)
        if base is None or promo is None:
            a.issue("CALCULATION_REFERENCE_MISSING", f"{path}.calculation", "Calculation references must resolve to supplied quote and promotion IDs.")
            continue
        if base_id in duplicate_quote_ids or q["id"] in duplicate_quote_ids or promo_id in duplicate_promo_ids:
            a.issue("AMBIGUOUS_CALCULATION_REFERENCE", f"{path}.calculation", "Duplicate IDs prevent identifying one base quote and one promotion.", True)
            continue
        if promo_id in (base["reflected"] or []):
            a.issue("DISCOUNT_ALREADY_REFLECTED", f"{path}.calculation", "This discount is already reflected in the base price; subtracting it again is invalid.", True)
        if base["kind"] not in {"NORMAL", "PRIME"} or base["reflected"] or "calculation" in base["raw"]:
            a.issue("UNSUPPORTED_STACK_OR_REFERENCE_BASE", f"{path}.calculation", "Use a current NORMAL/PRIME base without prior conditional discounts; reference prices and automatic stacking are not supported.", True)
            continue
        if base["basis"] != "PACK":
            a.issue("PACK_TOTAL_REQUIRED", f"{path}.calculation", "Discount arithmetic requires the original pack quote: a rounded per-unit display cannot establish the pack-level discount or checkout amount.")
            continue
        if promo["kind"] == "MULTIBUY":
            a.issue("BASKET_CALCULATION_REQUIRED", f"{path}.calculation", "A multi-offer basket cannot be applied automatically to one pack.")
            continue
        if base_id not in (promo["applies_to"] or []):
            a.issue("PROMOTION_SCOPE_MISMATCH", f"{path}.calculation", "Promotion does not apply to the chosen base quote.", True)
        for field in ("product_id", "selected_variant", "marketplace", "region", "currency", "observed_at", "demand_phase", "basis", "pack_units", "unit_label"):
            if q[field] != base[field]:
                a.issue("CALCULATION_CONTEXT_MISMATCH", f"{path}.{field}", "Derived quote must preserve its base quote's identity, snapshot, currency and quantity basis.", True)
        if q["buyer"] != base["buyer"] or set(q["conditions"] or []) != set(promo["conditions"] or []):
            a.issue("CALCULATION_CONDITIONS_MISMATCH", path, "Derived price must preserve base buyer qualification and the single promotion's conditions.", True)
        if q["reflected"] != [promo_id]:
            a.issue("CALCULATION_DISCOUNT_LEDGER_MISMATCH", f"{path}.discounts_reflected", "The derived quote must record exactly the applied promotion.", True)
        if promo["currency"] is not None and promo["currency"] != base["currency"]:
            a.issue("PROMOTION_CURRENCY_MISMATCH", f"{path}.calculation", "Discount and base quote currencies differ.", True)
        if None in (base["amount"], promo["value"], q["amount"]) or promo["type"] is None:
            continue
        if promo["type"] == "PERCENT" and promo["value"] > 100:
            continue
        result = base["amount"] * (1 - promo["value"] / 100) if promo["type"] == "PERCENT" else base["amount"] - promo["value"]
        if result < 0:
            a.issue("NEGATIVE_EFFECTIVE_PRICE", path, "Discount exceeds the base amount.", True)
            continue
        result = a.round_money(result, q["currency"], f"{path}.currency")
        if result is not None:
            if result != q["amount"]:
                a.issue("PRICE_CALCULATION_MISMATCH", f"{path}.amount", f"Single-discount arithmetic gives {result}; supplied amount differs.", True)
            elif not any(affects(i, {path, base["path"], promo["path"]}) for i in a.issues):
                summary["checked_calculations"].append({"quote_id": q["id"], "amount": str(result), "eligibility_verified_by_checker": False})

    if "comparison" not in data:
        return finish()
    summary["comparison_requested"] = True
    c = data["comparison"]
    if not isinstance(c, dict):
        a.issue("INVALID_COMPARISON", "comparison", "Expected a comparison request object.", True)
        return finish()
    a.fields(c, COMPARISON_FIELDS, "comparison")
    ids = a.strings(c.get("quote_ids"), "comparison.quote_ids")
    if ids is not None and len(ids) < 2:
        a.issue("COMPARISON_TOO_SMALL", "comparison.quote_ids", "A comparison needs at least two quotes.")
    buyer = a.enum(c.get("buyer"), {"PUBLIC", "PRIME"}, "comparison.buyer")
    conditions = a.strings(c.get("conditions"), "comparison.conditions")
    basis = a.enum(c.get("basis"), {"PACK", "UNIT"}, "comparison.basis")
    requested = {f: a.text(c.get(f), f"comparison.{f}") for f in ("marketplace", "region", "demand_phase")}
    requested["currency"] = a.currency(c.get("currency"), "comparison.currency")
    start = a.timestamp(c.get("window_start"), "comparison.window_start")
    end = a.timestamp(c.get("window_end"), "comparison.window_end")
    if start is not None and end is not None and end < start:
        a.issue("INVALID_WINDOW", "comparison.window_end", "Window end precedes start.", True)
    counts, labels, eligibility_sets = set(), set(), set()
    for qid in ids or []:
        q = quotes.get(qid)
        if q is None:
            a.issue("UNKNOWN_QUOTE", "comparison.quote_ids", f"Unknown quote ID {qid!r}.", True)
            continue
        path = q["path"]
        comparison_paths.add(path)
        if qid in duplicate_quote_ids:
            a.issue("AMBIGUOUS_COMPARISON_REFERENCE", "comparison.quote_ids", "A selected quote ID occurs more than once.", True)
        dependency_ids = list(q["reflected"] or [])
        calculation = q["raw"].get("calculation")
        if isinstance(calculation, dict):
            base_id = calculation.get("base_quote_id")
            if isinstance(base_id, str) and base_id in quotes:
                comparison_paths.add(quotes[base_id]["path"])
            if isinstance(calculation.get("promotion_id"), str):
                dependency_ids.append(calculation["promotion_id"])
        for pid in dependency_ids:
            if pid in promos:
                comparison_paths.add(promos[pid]["path"])
            if pid in duplicate_promo_ids:
                a.issue("AMBIGUOUS_COMPARISON_REFERENCE", "comparison.quote_ids", "A selected promotion ID occurs more than once.", True)
        if q["kind"] == "REFERENCE":
            a.issue("REFERENCE_NOT_PAYABLE", path, "List/Typical reference prices cannot stand in for current payable offers.")
        if q["buyer"] is None or (q["buyer"] == "PRIME" and buyer != "PRIME"):
            a.issue("BUYER_QUALIFICATION_MISMATCH", path, "The selected price is not available to the requested buyer qualification.")
        if q["kind"] == "CONDITIONAL" and q["eligibility"] != "VERIFIED":
            a.issue("ELIGIBILITY_UNVERIFIED", path, "An arithmetic candidate is not a verified eligible price.")
        required = set(q["conditions"] or [])
        eligibility_sets.add(tuple(sorted(required)))
        if conditions is None or not required.issubset(set(conditions)):
            a.issue("CONDITION_MISMATCH", path, "The request does not satisfy this quote's declared conditions.")
        for field, value in requested.items():
            if q[field] is None or value is None or q[field] != value:
                a.issue("COMPARISON_CONTEXT_MISMATCH", f"{path}.{field}", "Comparison requires the same known requested context; no implicit FX, region or demand-phase substitution.")
        if q["observed_at"] is None or start is None or end is None or not start <= q["observed_at"] <= end:
            a.issue("SNAPSHOT_OUTSIDE_WINDOW", f"{path}.observed_at", "Quote must fall within the explicitly requested snapshot window.")
        if q["unit_label"] is None:
            a.issue("UNIT_UNKNOWN", f"{path}.unit_label", "Define the physical unit before comparing.")
        else:
            labels.add(q["unit_label"])
        conversion_needed = basis is not None and q["basis"] is not None and basis != q["basis"]
        if basis == "PACK" and q["basis"] == "UNIT":
            a.issue("PACK_TOTAL_REQUIRED", path, "A rounded per-unit display cannot be multiplied into an exact pack quote; supply the original pack total.")
            continue
        if basis == "PACK" or conversion_needed:
            if q["pack_units"] is None or q["pack_status"] != "CONSISTENT":
                a.issue("PACK_UNRESOLVED", path, "A known consistent pack count is required; no automatic two-pack default.")
                continue
            if basis == "PACK":
                counts.add(q["pack_units"])
        value = q["amount"]
        if value is not None and conversion_needed:
            value = value / q["pack_units"] if basis == "UNIT" else value * q["pack_units"]
        if value is not None:
            rounded = a.round_money(value, q["currency"], f"{path}.currency")
            if rounded is not None:
                summary["normalized_prices"].append({"quote_id": qid, "amount": str(rounded), "currency": q["currency"], "basis": basis, "source_amount": str(q["amount"]), "unrounded_normalized_amount": str(value), "rounding": "ROUND_HALF_UP", "amount_semantics": "DERIVED_PER_UNIT_AVERAGE_NOT_SINGLE_UNIT_OFFER" if conversion_needed else "OBSERVED_PER_UNIT_DISPLAY" if basis == "UNIT" else "PACK_QUOTE"})
    if len(counts) > 1:
        a.issue("PACK_COUNTS_DIFFER", "comparison.basis", "Pack totals with different unit counts are not a like-for-like comparison; request UNIT explicitly if appropriate.")
    if len(labels) > 1:
        a.issue("UNIT_LABELS_DIFFER", "comparison.basis", "Physical units differ; no implicit reinterpretation.")
    if len(eligibility_sets) > 1:
        a.issue("MIXED_CONDITIONS", "comparison.conditions", "Do not mix unconditional and separately eligible prices in one price cohort.")
    summary["comparison_status"] = "CHECKED"
    return finish()
