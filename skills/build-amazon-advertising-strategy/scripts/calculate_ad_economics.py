#!/usr/bin/env python3
"""Calculate Amazon onsite advertising economics from explicit inputs.

The calculator separates transaction revenue, operating contribution, PPC,
fixed launch support, and inventory/cash exposure. It never fetches fees or
creates campaign recommendations. Unknown optional amounts may be modeled as
zero only when returned in assumed_zero_fields; such a result is provisional.

Usage:
    python3 calculate_ad_economics.py --input economics.json
    python3 calculate_ad_economics.py --input -
    python3 calculate_ad_economics.py --json '{...}'
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP
from pathlib import Path
from typing import Any


ZERO = Decimal("0")
ONE = Decimal("1")

OPTIONAL_MONEY_FIELDS = (
    "seller_retained_shipping",
    "seller_funded_discount",
    "coupon_discount_per_order",
    "other_seller_funded_discount",
    "cogs",
    "packaging",
    "prep_and_label",
    "quality_inspection",
    "inbound_freight",
    "duty",
    "fulfillment_fee",
    "storage",
    "other_amazon_fees",
    "other_variable_cost",
    "coupon_fee_per_order",
    "deal_fee_per_order",
    "other_onsite_promotion_cost_per_order",
    "vine_enrollment_fee",
    "vine_unit_landed_cost",
    "vine_unit_fulfillment_cost",
    "coupon_fixed_fee",
    "deal_fixed_fee",
    "other_launch_support_fixed",
    "target_profit_per_order",
    "risk_buffer_per_order",
    "planned_ppc_spend",
)

RATE_FIELDS = (
    "tax_rate",
    "referral_fee_rate",
    "conversion_rate",
    "return_rate",
    "minimum_post_ads_contribution_rate",
)
COUNT_FIELDS = (
    "vine_units",
    "planned_orders",
    "planned_ad_attributed_orders",
    "sellable_inventory",
    "vine_reserved_units",
    "safety_stock_units",
    "other_locked_units",
    "forecast_daily_total_orders",
    "replenishment_lead_days",
    "inbound_buffer_days",
    "actual_impressions",
    "actual_clicks",
    "actual_attributed_orders",
)

PLANNING_COUNT_FIELDS = (
    "vine_units",
    "planned_orders",
    "planned_ad_attributed_orders",
    "sellable_inventory",
    "vine_reserved_units",
    "safety_stock_units",
    "other_locked_units",
    "forecast_daily_total_orders",
    "replenishment_lead_days",
    "inbound_buffer_days",
)

RETURN_RATE_MONEY_FIELDS = (
    "average_refunded_pretax_revenue",
    "return_processing_fee",
    "return_shipping_cost",
    "nonrefundable_platform_fee",
    "disposal_removal_cost",
    "platform_reimbursement",
    "resellable_inventory_recovery",
)

RETURN_ALLOWANCE_MONEY_FIELDS = (
    "expected_refund_revenue_loss",
    "return_nonrevenue_cost",
)

ACTUAL_MONEY_FIELDS = (
    "actual_ad_spend",
    "actual_ad_attributed_sales",
    "actual_total_sales",
    "actual_attributed_contribution_total",
    "actual_total_contribution_before_ads",
)
# 只算单位经济线时不需要的字段（库存、投放计划、新品固定投入）
ECONOMICS_ONLY_OUT_OF_SCOPE = (
    "vine_units", "planned_orders", "planned_ad_attributed_orders", "sellable_inventory",
    "vine_reserved_units", "safety_stock_units", "other_locked_units", "forecast_daily_total_orders",
    "replenishment_lead_days", "inbound_buffer_days", "planned_ppc_spend",
    "vine_enrollment_fee", "vine_unit_landed_cost", "vine_unit_fulfillment_cost",
    "coupon_fixed_fee", "deal_fixed_fee", "other_launch_support_fixed",
)
OTHER_INPUT_FIELDS = (
    "marketplace", "scope_id", "currency", "data_mode", "units_per_order", "price_includes_tax",
    "fees_verified", "costs_verified", "tax_basis_verified", "allow_revenue_proxy", "selling_price",
    "referral_fee", "referral_fee_rate", "referral_fee_basis_amount", "referral_fee_control",
    "returns_mode", "net_sales_already_refund_adjusted", "ad_attributed_sales_per_order",
    "attributed_sales_data_class", "attributed_sales_scope", "attributed_mix_contribution_per_order",
    "conversion_data_class", "attribution_status", "name",
    "calculation_scope", "not_applicable_fields", "notes", "source_ids", "evidence_ids",
)


def known_input_fields() -> set[str]:
    return set(
        OPTIONAL_MONEY_FIELDS + RATE_FIELDS + COUNT_FIELDS + PLANNING_COUNT_FIELDS
        + RETURN_RATE_MONEY_FIELDS + RETURN_ALLOWANCE_MONEY_FIELDS + ACTUAL_MONEY_FIELDS
        + OTHER_INPUT_FIELDS
    )


def reject_unknown_fields(raw: dict[str, Any]) -> None:
    """拼错的字段名不能被静默忽略（否则会被当成 0，结果偏乐观）。"""
    import difflib
    known = known_input_fields()
    unknown = [
        key for key in raw
        if key not in known
        and not key.startswith(("scenario_", "x_"))
        and not key.endswith(("_source_ids", "_evidence_ids"))
    ]
    if unknown:
        hints = []
        for key in sorted(unknown):
            close = difflib.get_close_matches(key, sorted(known), n=1, cutoff=0.75)
            hints.append(f"{key}（是不是 {close[0]}？）" if close else key)
        raise ValueError(
            "UNKNOWN_INPUT_FIELDS: " + ", ".join(hints)
            + "。不认识的字段不会被计算；请改正字段名，备注类字段请加 x_ 前缀。"
        )


OPTIONAL_ACTUAL_BUSINESS_MONEY_FIELDS = {
    "actual_total_sales",
    "actual_attributed_contribution_total",
    "actual_total_contribution_before_ads",
}


def decimal_value(value: Any, field: str) -> Decimal:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be numeric, not boolean")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"{field} must be numeric") from exc
    if not result.is_finite():
        raise ValueError(f"{field} must be finite")
    return result


def strict_bool(raw: dict[str, Any], field: str, required: bool = False) -> bool | None:
    if field not in raw:
        if required:
            raise ValueError(f"{field} is required and must be boolean")
        return None
    value = raw[field]
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be boolean")
    return value


def money(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def money_ceiling(value: Decimal | None) -> str | None:
    """An actionable positive CPC ceiling must never round above capacity."""
    if value is None:
        return None
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_DOWN))


def ratio(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return str(value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def number(value: Decimal | None) -> str | None:
    if value is None:
        return None
    if value == value.to_integral_value():
        return str(int(value))
    return format(value.normalize(), "f")


def safe_divide(numerator: Decimal | None, denominator: Decimal | None) -> Decimal | None:
    return numerator / denominator if numerator is not None and denominator is not None and denominator > ZERO else None


def nonnegative(raw: dict[str, Any], field: str, default: Decimal = ZERO) -> Decimal:
    value = decimal_value(raw.get(field, default), field)
    if value < ZERO:
        raise ValueError(f"{field} must not be negative")
    return value


def optional_nonnegative(raw: dict[str, Any], field: str) -> Decimal | None:
    if field not in raw or raw.get(field) is None:
        return None
    return nonnegative(raw, field)


def optional_whole_nonnegative(raw: dict[str, Any], field: str) -> Decimal | None:
    if field not in raw or raw.get(field) is None:
        return None
    return whole_nonnegative(raw, field)


def rate(raw: dict[str, Any], field: str, default: Decimal = ZERO) -> Decimal:
    value = nonnegative(raw, field, default)
    if value > ONE:
        raise ValueError(f"{field} must be between 0 and 1; use 0.20 for 20%")
    return value


def whole_nonnegative(raw: dict[str, Any], field: str, default: Decimal = ZERO) -> Decimal:
    value = nonnegative(raw, field, default)
    if value != value.to_integral_value():
        raise ValueError(f"{field} must be a non-negative whole number")
    return value


def validate_identity(raw: dict[str, Any]) -> None:
    for field in ("marketplace", "scope_id"):
        value = raw.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field} must be a non-empty string")
    currency = raw.get("currency")
    if not isinstance(currency, str) or re.fullmatch(r"[A-Z]{3}", currency) is None:
        raise ValueError("currency must be a three-letter uppercase code")
    if raw.get("data_mode") not in {"NEW_PRODUCT", "EXISTING_PRODUCT"}:
        raise ValueError("data_mode must be NEW_PRODUCT or EXISTING_PRODUCT")


def return_model(raw: dict[str, Any]) -> tuple[Decimal, Decimal, list[str]]:
    mode = raw.get("returns_mode", "NONE")
    if mode not in {"NONE", "ALLOWANCE_AMOUNT", "RATE_MODEL"}:
        raise ValueError("returns_mode must be NONE, ALLOWANCE_AMOUNT, or RATE_MODEL")
    reason_codes: list[str] = []
    already_adjusted = strict_bool(raw, "net_sales_already_refund_adjusted") or False
    if mode == "NONE":
        if any(field in raw for field in RETURN_ALLOWANCE_MONEY_FIELDS + RETURN_RATE_MONEY_FIELDS + ("return_rate",)):
            raise ValueError("return inputs were supplied while returns_mode is NONE")
        return ZERO, ZERO, reason_codes
    if already_adjusted:
        raise ValueError("RETURN_DOUBLE_COUNT: net sales is already refund-adjusted and a return model was also supplied")
    if mode == "ALLOWANCE_AMOUNT":
        if any(field in raw for field in RETURN_RATE_MONEY_FIELDS + ("return_rate",)):
            raise ValueError("RETURN_DOUBLE_COUNT: allowance and rate-model return inputs cannot be combined")
        revenue_loss = nonnegative(raw, "expected_refund_revenue_loss")
        nonrevenue_cost = nonnegative(raw, "return_nonrevenue_cost")
        return revenue_loss, nonrevenue_cost, reason_codes

    if any(field in raw for field in RETURN_ALLOWANCE_MONEY_FIELDS):
        raise ValueError("RETURN_DOUBLE_COUNT: rate model and allowance inputs cannot be combined")
    return_rate = rate(raw, "return_rate")
    values = {field: nonnegative(raw, field) for field in RETURN_RATE_MONEY_FIELDS}
    revenue_loss = return_rate * values["average_refunded_pretax_revenue"]
    nonrevenue_cost = return_rate * (
        values["return_processing_fee"]
        + values["return_shipping_cost"]
        + values["nonrefundable_platform_fee"]
        + values["disposal_removal_cost"]
        - values["platform_reimbursement"]
        - values["resellable_inventory_recovery"]
    )
    if nonrevenue_cost < ZERO:
        raise ValueError("RETURN_MODEL_NET_CREDIT_UNSUPPORTED: reimbursements and recoveries cannot increase unit contribution; verify any credit in a separate evidence-ledger model")
    return revenue_loss, nonrevenue_cost, reason_codes


def referral_fee(raw: dict[str, Any], transaction_revenue: Decimal) -> tuple[Decimal, str]:
    has_amount = "referral_fee" in raw
    has_rate = "referral_fee_rate" in raw
    if not has_amount and not has_rate:
        raise ValueError("provide referral_fee or referral_fee_rate with referral_fee_basis_amount")
    if has_amount:
        amount = nonnegative(raw, "referral_fee")
        if has_rate and raw.get("referral_fee_control") not in {"AMOUNT", "RATE"}:
            raise ValueError("both referral_fee and referral_fee_rate were supplied; set referral_fee_control")
        if has_rate:
            rate(raw, "referral_fee_rate")
            if "referral_fee_basis_amount" in raw:
                nonnegative(raw, "referral_fee_basis_amount")
        if not has_rate or raw.get("referral_fee_control") == "AMOUNT":
            return amount, "EXPLICIT_AMOUNT"
    fee_rate = rate(raw, "referral_fee_rate")
    if "referral_fee_basis_amount" not in raw:
        raise ValueError("referral_fee_basis_amount is required when using referral_fee_rate")
    basis = nonnegative(raw, "referral_fee_basis_amount")
    if basis == ZERO and transaction_revenue > ZERO:
        raise ValueError("referral_fee_basis_amount is zero while transaction revenue is positive")
    return basis * fee_rate, "RATE_X_EXPLICIT_BASIS"


def calculate(raw: dict[str, Any]) -> dict[str, Any]:
    reject_unknown_fields(raw)
    validate_identity(raw)
    calculation_scope = raw.get("calculation_scope", "FULL")
    if calculation_scope not in {"FULL", "ECONOMICS_ONLY"}:
        raise ValueError("calculation_scope must be FULL or ECONOMICS_ONLY")
    economics_only = calculation_scope == "ECONOMICS_ONLY"
    not_applicable = raw.get("not_applicable_fields", [])
    if not isinstance(not_applicable, list) or not all(isinstance(x, str) for x in not_applicable):
        raise ValueError("not_applicable_fields must be an array of field names")
    allowed_na = set(OPTIONAL_MONEY_FIELDS + RETURN_RATE_MONEY_FIELDS + RETURN_ALLOWANCE_MONEY_FIELDS)
    bad_na = sorted(set(not_applicable) - allowed_na)
    if bad_na:
        raise ValueError(f"not_applicable_fields may only list optional money fields: {', '.join(bad_na)}")
    both = sorted(field for field in not_applicable if field in raw)
    if both:
        raise ValueError(f"field both supplied and declared not applicable: {', '.join(both)}")
    units_per_order = whole_nonnegative(raw, "units_per_order", ONE)
    if units_per_order != ONE:
        raise ValueError("units_per_order must be 1 sellable offer; normalize multi-offer orders before calculating")
    price_includes_tax = strict_bool(raw, "price_includes_tax", required=True)
    fees_verified = strict_bool(raw, "fees_verified", required=True)
    costs_verified = strict_bool(raw, "costs_verified", required=True)
    tax_basis_verified = strict_bool(raw, "tax_basis_verified", required=True)
    allow_revenue_proxy = strict_bool(raw, "allow_revenue_proxy") or False

    selling_price = nonnegative(raw, "selling_price")
    if selling_price <= ZERO:
        raise ValueError("selling_price must be greater than zero")
    optional_values = {field: nonnegative(raw, field) for field in OPTIONAL_MONEY_FIELDS}
    tax_rate = rate(raw, "tax_rate")
    if price_includes_tax and "tax_rate" not in raw:
        raise ValueError("tax_rate is required when price_includes_tax is true")

    assumed_zero_fields = [field for field in OPTIONAL_MONEY_FIELDS if field not in raw]
    assumed_zero_fields.extend(field for field in PLANNING_COUNT_FIELDS if field not in raw)
    if raw.get("returns_mode") == "RATE_MODEL":
        if "return_rate" not in raw:
            raise ValueError("return_rate is required for RATE_MODEL")
        assumed_zero_fields.extend(field for field in RETURN_RATE_MONEY_FIELDS if field not in raw)
    elif raw.get("returns_mode") == "ALLOWANCE_AMOUNT":
        assumed_zero_fields.extend(field for field in RETURN_ALLOWANCE_MONEY_FIELDS if field not in raw)
    if "minimum_post_ads_contribution_rate" in raw and "target_profit_per_order" not in raw:
        # A rate-based floor is an explicit alternative to an amount-based floor.
        assumed_zero_fields.remove("target_profit_per_order")
    if not price_includes_tax and "tax_rate" not in raw:
        assumed_zero_fields.append("tax_rate")
    # 用户明确声明“不适用”的字段按 0 计，但不再算作假设；只算经济线时，库存/计划/新品固定投入不在范围内
    excluded_from_assumed = set(not_applicable)
    if economics_only:
        excluded_from_assumed |= set(ECONOMICS_ONLY_OUT_OF_SCOPE)
    if not price_includes_tax:
        # 不含税站点（如美国）售价本身不含税，tax_rate 不适用
        excluded_from_assumed.add("tax_rate")
    assumed_zero_fields = [field for field in assumed_zero_fields if field not in excluded_from_assumed]

    transaction_revenue_including_tax = (
        selling_price
        + optional_values["seller_retained_shipping"]
        - optional_values["seller_funded_discount"]
        - optional_values["coupon_discount_per_order"]
        - optional_values["other_seller_funded_discount"]
    )
    if transaction_revenue_including_tax <= ZERO:
        raise ValueError("discounts must leave positive transaction revenue")
    pretax_transaction_revenue = (
        transaction_revenue_including_tax / (ONE + tax_rate)
        if price_includes_tax
        else transaction_revenue_including_tax
    )

    refund_revenue_loss, return_nonrevenue_cost, return_reason_codes = return_model(raw)
    net_sales_revenue = pretax_transaction_revenue - refund_revenue_loss
    if net_sales_revenue < ZERO:
        raise ValueError("expected refund revenue loss exceeds pretax transaction revenue")

    fee_amount, fee_basis = referral_fee(raw, transaction_revenue_including_tax)
    landed_cost = sum(
        optional_values[field]
        for field in (
            "cogs",
            "packaging",
            "prep_and_label",
            "quality_inspection",
            "inbound_freight",
            "duty",
        )
    )
    amazon_and_fulfillment_cost = (
        fee_amount
        + optional_values["fulfillment_fee"]
        + optional_values["storage"]
        + optional_values["other_amazon_fees"]
    )
    variable_onsite_promotion_cost = (
        optional_values["coupon_fee_per_order"]
        + optional_values["deal_fee_per_order"]
        + optional_values["other_onsite_promotion_cost_per_order"]
    )
    other_losses = optional_values["other_variable_cost"] + return_nonrevenue_cost
    operating_contribution = (
        net_sales_revenue
        - landed_cost
        - amazon_and_fulfillment_cost
        - variable_onsite_promotion_cost
        - other_losses
    )

    vine_units = whole_nonnegative(raw, "vine_units")
    planned_orders = whole_nonnegative(raw, "planned_orders")
    planned_ad_orders = whole_nonnegative(raw, "planned_ad_attributed_orders")
    fixed_launch_support_total = (
        optional_values["vine_enrollment_fee"]
        + vine_units
        * (
            optional_values["vine_unit_landed_cost"]
            + optional_values["vine_unit_fulfillment_cost"]
        )
        + optional_values["coupon_fixed_fee"]
        + optional_values["deal_fixed_fee"]
        + optional_values["other_launch_support_fixed"]
    )
    fixed_per_planned_order = (
        fixed_launch_support_total / planned_orders
        if planned_orders > ZERO
        else (ZERO if fixed_launch_support_total == ZERO else None)
    )
    all_in_contribution = (
        operating_contribution - fixed_per_planned_order
        if fixed_per_planned_order is not None
        else None
    )

    attributed_sales_per_order: Decimal | None
    attributed_data_class = raw.get("attributed_sales_data_class")
    if "ad_attributed_sales_per_order" in raw:
        attributed_sales_per_order = nonnegative(raw, "ad_attributed_sales_per_order")
        if attributed_sales_per_order <= ZERO:
            attributed_sales_per_order = None
        if attributed_data_class not in {"ACTUAL", "ESTIMATED", "PROXY"}:
            raise ValueError("attributed_sales_data_class must be ACTUAL, ESTIMATED, or PROXY")
    elif allow_revenue_proxy:
        attributed_sales_per_order = transaction_revenue_including_tax
        attributed_data_class = "PROXY"
    else:
        attributed_sales_per_order = None
        attributed_data_class = "UNAVAILABLE"

    attributed_sales_scope = raw.get("attributed_sales_scope", "PROMOTED")
    if attributed_sales_scope not in {"PROMOTED", "HALO", "COMBINED", "UNKNOWN"}:
        raise ValueError("attributed_sales_scope must be PROMOTED, HALO, COMBINED, or UNKNOWN")
    contribution_for_attribution = operating_contribution
    if attributed_sales_scope != "PROMOTED":
        if "attributed_mix_contribution_per_order" in raw:
            contribution_for_attribution = decimal_value(
                raw["attributed_mix_contribution_per_order"],
                "attributed_mix_contribution_per_order",
            )
        else:
            contribution_for_attribution = None

    minimum_post_ads_contribution_rate: Decimal | None = None
    rate_based_profit_floor = ZERO
    if "minimum_post_ads_contribution_rate" in raw:
        minimum_post_ads_contribution_rate = rate(raw, "minimum_post_ads_contribution_rate")
        rate_based_profit_floor = net_sales_revenue * minimum_post_ads_contribution_rate
    amount_based_profit_floor = optional_values["target_profit_per_order"]
    target_profit_floor = max(amount_based_profit_floor, rate_based_profit_floor)
    if "minimum_post_ads_contribution_rate" in raw and "target_profit_per_order" in raw:
        target_profit_basis = "MAX_OF_AMOUNT_AND_NET_SALES_RATE"
    elif "minimum_post_ads_contribution_rate" in raw:
        target_profit_basis = "NET_SALES_RATE"
    elif "target_profit_per_order" in raw:
        target_profit_basis = "AMOUNT_PER_ORDER"
    else:
        target_profit_basis = "ASSUMED_ZERO"
    target_profit = target_profit_floor + optional_values["risk_buffer_per_order"]
    target_capacity = (
        contribution_for_attribution - target_profit
        if contribution_for_attribution is not None
        else None
    )
    operating_break_even_acos = (
        safe_divide(contribution_for_attribution, attributed_sales_per_order)
        if contribution_for_attribution is not None and contribution_for_attribution >= ZERO and attributed_sales_per_order is not None
        else None
    )
    attributed_all_in_contribution = (
        contribution_for_attribution - fixed_per_planned_order
        if contribution_for_attribution is not None and fixed_per_planned_order is not None
        else None
    )
    all_in_break_even_acos = (
        safe_divide(attributed_all_in_contribution, attributed_sales_per_order)
        if attributed_all_in_contribution is not None
        and attributed_all_in_contribution >= ZERO
        and attributed_sales_per_order is not None
        else None
    )
    target_acos = (
        safe_divide(target_capacity, attributed_sales_per_order)
        if target_capacity is not None and target_capacity >= ZERO and attributed_sales_per_order is not None
        else None
    )

    conversion_rate: Decimal | None = None
    conversion_data_class = raw.get("conversion_data_class")
    if "conversion_rate" in raw:
        conversion_rate = rate(raw, "conversion_rate")
        if conversion_data_class not in {"ACTUAL", "ESTIMATED", "ASSUMPTION"}:
            raise ValueError("conversion_data_class must be ACTUAL, ESTIMATED, or ASSUMPTION")

    actual_impressions = optional_whole_nonnegative(raw, "actual_impressions")
    actual_clicks = optional_whole_nonnegative(raw, "actual_clicks")
    actual_orders = optional_whole_nonnegative(raw, "actual_attributed_orders")
    if actual_clicks == ZERO and actual_orders is not None and actual_orders > ZERO:
        raise ValueError("ATTRIBUTION_SCOPE_MISMATCH: actual orders cannot be positive when actual clicks are zero")
    observed_cvr: Decimal | None = safe_divide(actual_orders, actual_clicks)
    if raw.get("data_mode") == "EXISTING_PRODUCT" and "actual_clicks" in raw and "actual_attributed_orders" in raw:
        conversion_rate = observed_cvr
        conversion_data_class = "ACTUAL" if observed_cvr is not None else "UNAVAILABLE"

    break_even_cpc = (
        contribution_for_attribution * conversion_rate
        if contribution_for_attribution is not None
        and contribution_for_attribution >= ZERO
        and conversion_rate is not None
        else None
    )
    target_cpc = (
        target_capacity * conversion_rate
        if target_capacity is not None and target_capacity >= ZERO and conversion_rate is not None
        else None
    )

    actual_values = {
        field: optional_nonnegative(raw, field)
        for field in ACTUAL_MONEY_FIELDS
    }
    actual_acos = safe_divide(actual_values["actual_ad_spend"], actual_values["actual_ad_attributed_sales"])
    actual_roas = safe_divide(actual_values["actual_ad_attributed_sales"], actual_values["actual_ad_spend"])
    actual_tacos = safe_divide(actual_values["actual_ad_spend"], actual_values["actual_total_sales"])
    actual_cpc = safe_divide(actual_values["actual_ad_spend"], actual_clicks)
    actual_ctr = safe_divide(actual_clicks, actual_impressions)
    actual_cpa = safe_divide(actual_values["actual_ad_spend"], actual_orders)
    actual_period_break_even_acos = safe_divide(
        actual_values["actual_attributed_contribution_total"],
        actual_values["actual_ad_attributed_sales"],
    )
    actual_period_break_even_tacos = safe_divide(
        actual_values["actual_total_contribution_before_ads"],
        actual_values["actual_total_sales"],
    )

    sellable_inventory = whole_nonnegative(raw, "sellable_inventory")
    vine_reserved = whole_nonnegative(raw, "vine_reserved_units")
    safety_stock = whole_nonnegative(raw, "safety_stock_units")
    other_locked = whole_nonnegative(raw, "other_locked_units")
    advertising_available_inventory = sellable_inventory - vine_reserved - safety_stock - other_locked
    forecast_daily_orders = nonnegative(raw, "forecast_daily_total_orders")
    days_of_supply = (
        advertising_available_inventory / forecast_daily_orders
        if advertising_available_inventory >= ZERO and forecast_daily_orders > ZERO
        else None
    )
    required_cover_days = nonnegative(raw, "replenishment_lead_days") + nonnegative(raw, "inbound_buffer_days")

    discount_investment = (
        (
            optional_values["seller_funded_discount"]
            + optional_values["coupon_discount_per_order"]
            + optional_values["other_seller_funded_discount"]
        )
        * planned_orders
        if planned_orders > ZERO
        else None
    )
    variable_promotion_investment = (
        variable_onsite_promotion_cost * planned_orders if planned_orders > ZERO else None
    )
    total_launch_investment = (
        optional_values["planned_ppc_spend"]
        + fixed_launch_support_total
        + (discount_investment or ZERO)
        + (variable_promotion_investment or ZERO)
        if planned_orders > ZERO
        else None
    )
    planned_profit_after_ads = (
        operating_contribution * planned_orders
        - optional_values["planned_ppc_spend"]
        - fixed_launch_support_total
        if planned_orders > ZERO
        else None
    )
    max_operating_ppc_for_planned_ad_orders = (
        max(contribution_for_attribution, ZERO) * planned_ad_orders
        if contribution_for_attribution is not None and planned_ad_orders > ZERO
        else None
    )

    reason_codes = list(return_reason_codes)
    if operating_contribution < ZERO:
        reason_codes.append("NEGATIVE_PRE_AD_CONTRIBUTION")
    elif operating_contribution == ZERO:
        reason_codes.append("ZERO_PRE_AD_CONTRIBUTION")
    if fixed_launch_support_total > ZERO and planned_orders == ZERO:
        reason_codes.append("PLANNED_UNITS_ZERO")
    if target_capacity is not None and target_capacity < ZERO:
        reason_codes.append("TARGET_PROFIT_EXCEEDS_PRE_AD_CONTRIBUTION")
    elif target_capacity == ZERO:
        reason_codes.append("ZERO_TARGET_AD_CAPACITY")
    if conversion_rate is None:
        reason_codes.append("CVR_MISSING")
    elif conversion_data_class in {"ESTIMATED", "ASSUMPTION"}:
        reason_codes.append("CVR_ESTIMATED")
    elif conversion_rate == ZERO and actual_clicks is not None and actual_clicks > ZERO:
        reason_codes.append("CVR_OBSERVED_ZERO")
    if attributed_sales_per_order is None:
        reason_codes.append("ATTRIBUTED_SALES_ZERO_OR_MISSING")
    elif attributed_data_class == "PROXY":
        reason_codes.append("REVENUE_BASIS_PROXY")
    if attributed_sales_scope != "PROMOTED" and contribution_for_attribution is None:
        reason_codes.append("ATTRIBUTED_MIX_UNMAPPED")
    if assumed_zero_fields:
        reason_codes.append("ASSUMED_ZERO_COST_FIELDS")
    if not (fees_verified and costs_verified and tax_basis_verified):
        reason_codes.append("UNVERIFIED_CORE_INPUTS")
    if economics_only:
        reason_codes.append("INVENTORY_NOT_IN_SCOPE")
    elif advertising_available_inventory < ZERO:
        reason_codes.append("VINE_OR_LOCKED_INVENTORY_EXCEEDS_SELLABLE")
    elif advertising_available_inventory == ZERO:
        reason_codes.append("NO_ADVERTISING_AVAILABLE_INVENTORY")
    elif days_of_supply is not None and required_cover_days > ZERO and days_of_supply < required_cover_days:
        reason_codes.append("STOCKOUT_RISK")
    if raw.get("data_mode") == "EXISTING_PRODUCT" and raw.get("attribution_status") != "COMPLETE":
        reason_codes.append("ATTRIBUTION_WINDOW_OPEN_OR_UNKNOWN")
    actual_ads_fields = ("actual_impressions", "actual_clicks", "actual_attributed_orders", "actual_ad_spend", "actual_ad_attributed_sales")
    if raw.get("data_mode") == "EXISTING_PRODUCT" and any(raw.get(field) is None for field in actual_ads_fields):
        reason_codes.append("ACTUAL_PERIOD_METRICS_INCOMPLETE")

    inventory_blocks = (not economics_only) and advertising_available_inventory <= ZERO
    if operating_contribution <= ZERO or inventory_blocks:
        overall_status = "BLOCKED"
    elif target_capacity is not None and target_capacity <= ZERO:
        overall_status = "BLOCKED"
    elif all_in_contribution is not None and all_in_contribution <= ZERO:
        overall_status = "BLOCKED"
    elif fixed_launch_support_total > ZERO and planned_orders == ZERO:
        overall_status = "PROVISIONAL"
    elif attributed_sales_scope != "PROMOTED" and contribution_for_attribution is None:
        overall_status = "PROVISIONAL"
    elif "STOCKOUT_RISK" in reason_codes and not economics_only:
        overall_status = "PROVISIONAL"
    elif assumed_zero_fields or not (fees_verified and costs_verified and tax_basis_verified):
        overall_status = "PROVISIONAL"
    elif raw.get("data_mode") == "EXISTING_PRODUCT" and raw.get("attribution_status") != "COMPLETE":
        overall_status = "PROVISIONAL"
    elif "ACTUAL_PERIOD_METRICS_INCOMPLETE" in reason_codes:
        overall_status = "PROVISIONAL"
    elif attributed_data_class == "ACTUAL" and conversion_data_class == "ACTUAL":
        overall_status = "READY_ACTUAL"
    elif attributed_sales_per_order is not None:
        overall_status = "READY_ESTIMATED"
    else:
        overall_status = "PROVISIONAL"

    metric_status = {
        "operating_break_even_acos": (
            "BLOCKED_NEGATIVE_PRE_AD_CONTRIBUTION"
            if operating_contribution < ZERO
            else "ZERO_AD_CAPACITY"
            if operating_contribution == ZERO
            else "UNAVAILABLE_MISSING_INPUT"
            if operating_break_even_acos is None
            else "AVAILABLE_ACTUAL"
            if attributed_data_class == "ACTUAL"
            else "AVAILABLE_ESTIMATED"
        ),
        "target_acos": (
            "BLOCKED_TARGET_UNATTAINABLE"
            if target_capacity is not None and target_capacity < ZERO
            else "UNAVAILABLE_MISSING_INPUT"
            if target_acos is None
            else "AVAILABLE_ACTUAL"
            if attributed_data_class == "ACTUAL"
            else "AVAILABLE_ESTIMATED"
        ),
        "break_even_cpc": (
            "BLOCKED_NEGATIVE_PRE_AD_CONTRIBUTION"
            if operating_contribution < ZERO
            else "ZERO_AD_CAPACITY"
            if operating_contribution == ZERO or conversion_rate == ZERO
            else "UNAVAILABLE_MISSING_INPUT"
            if break_even_cpc is None
            else "AVAILABLE_ACTUAL"
            if conversion_data_class == "ACTUAL"
            else "AVAILABLE_ESTIMATED"
        ),
    }

    return {
        "name": raw.get("name", "scenario"),
        "marketplace": raw["marketplace"],
        "currency": raw["currency"],
        "scope_id": raw["scope_id"],
        "data_mode": raw["data_mode"],
        "model_basis": {"units_per_order": number(units_per_order), "order_unit": "ONE_SELLABLE_OFFER"},
        "overall_status": overall_status,
        "reason_codes": sorted(set(reason_codes)),
        "metric_status": metric_status,
        "revenue": {
            "selling_price": money(selling_price),
            "transaction_revenue_including_tax": money(transaction_revenue_including_tax),
            "pretax_transaction_revenue": money(pretax_transaction_revenue),
            "expected_refund_revenue_loss": money(refund_revenue_loss),
            "net_sales_revenue": money(net_sales_revenue),
            "attributed_sales_per_order": money(attributed_sales_per_order),
            "attributed_sales_data_class": attributed_data_class,
            "attributed_sales_scope": attributed_sales_scope,
        },
        "costs": {
            "referral_fee": money(fee_amount),
            "referral_fee_basis": fee_basis,
            "landed_cost": money(landed_cost),
            "amazon_and_fulfillment_cost": money(amazon_and_fulfillment_cost),
            "variable_onsite_promotion_cost": money(variable_onsite_promotion_cost),
            "return_nonrevenue_cost": money(return_nonrevenue_cost),
            "other_losses": money(other_losses),
            "fixed_launch_support_total": money(fixed_launch_support_total),
            "fixed_launch_support_per_planned_order": money(fixed_per_planned_order),
        },
        "contribution": {
            "operating_before_ads": money(operating_contribution),
            "all_in_before_ads": money(all_in_contribution),
            "minimum_post_ads_contribution_rate": ratio(minimum_post_ads_contribution_rate),
            "target_profit_floor_basis": target_profit_basis,
            "target_profit_floor_per_order": money(target_profit_floor),
            "risk_buffer_per_order": money(optional_values["risk_buffer_per_order"]),
            "target_profit_and_risk_buffer_per_order": money(target_profit),
            "target_ad_spend_capacity_per_order": money(target_capacity),
        },
        "ceilings": {
            "operating_break_even_acos": ratio(operating_break_even_acos),
            "all_in_break_even_acos": ratio(all_in_break_even_acos),
            "target_acos": ratio(target_acos),
            "break_even_cpc": money_ceiling(break_even_cpc),
            "target_cpc": money_ceiling(target_cpc),
            "conversion_rate": ratio(conversion_rate),
            "conversion_data_class": conversion_data_class or "UNAVAILABLE",
        },
        "actual_period": {
            "acos": ratio(actual_acos),
            "roas": ratio(actual_roas),
            "tacos": ratio(actual_tacos),
            "cpc": money(actual_cpc),
            "ctr": ratio(actual_ctr),
            "cvr": ratio(observed_cvr),
            "cpa": money(actual_cpa),
            "break_even_acos": ratio(actual_period_break_even_acos),
            "break_even_tacos": ratio(actual_period_break_even_tacos),
        },
        "inventory": {
            "advertising_available_units": number(advertising_available_inventory),
            "forecast_days_of_supply": ratio(days_of_supply),
            "required_cover_days": number(required_cover_days),
        },
        "launch_investment": {
            "planned_ppc_spend": money(optional_values["planned_ppc_spend"]),
            "discount_investment": money(discount_investment),
            "variable_promotion_investment": money(variable_promotion_investment),
            "fixed_launch_support_total": money(fixed_launch_support_total),
            "total_launch_investment": money(total_launch_investment),
            "planned_profit_after_ads_and_fixed_support": money(planned_profit_after_ads),
            "max_operating_ppc_for_planned_ad_orders": money(max_operating_ppc_for_planned_ad_orders),
        },
        "assumed_zero_fields": sorted(set(assumed_zero_fields)),
        "not_applicable_fields": sorted(set(not_applicable)),
        "calculation_scope": calculation_scope,
        "warnings": [
            "All fees, costs, tax, attributed-sales, and conversion inputs must be verified for their marketplace, date, and scope.",
            "ACoS uses ad-attributed sales; contribution uses transaction economics. They are not interchangeable.",
            "Vine, discounts, Coupon/deal costs, PPC, and inventory/cash exposure are maintained in separate ledgers.",
            "This calculator does not authorize bids, budgets, campaign changes, or review-generation actions.",
        ],
    }


def load_payload(args: argparse.Namespace) -> dict[str, Any]:
    if args.json is not None:
        value = json.loads(args.json)
    elif args.input == "-":
        value = json.load(sys.stdin)
    else:
        value = json.loads(Path(args.input).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("input must be a JSON object")
    return value


def expand_scenarios(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if "scenarios" not in payload:
        return [payload]
    common = payload.get("common", {})
    scenarios = payload.get("scenarios")
    if not isinstance(common, dict) or not isinstance(scenarios, list) or not scenarios:
        raise ValueError("common must be an object and scenarios a non-empty array")
    expanded: list[dict[str, Any]] = []
    for item in scenarios:
        if not isinstance(item, dict):
            raise ValueError("every scenario must be an object")
        expanded.append({**common, **item})
    marketplaces = {item.get("marketplace") for item in expanded}
    currencies = {item.get("currency") for item in expanded}
    if len(marketplaces) > 1 or len(currencies) > 1:
        raise ValueError("CURRENCY_MISMATCH: scenarios must share marketplace and currency; convert in a separate verified FX model")
    return expanded


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", help="JSON file path, or - for stdin")
    source.add_argument("--json", help="inline JSON object")
    args = parser.parse_args()
    try:
        payload = load_payload(args)
        results = [calculate(item) for item in expand_scenarios(payload)]
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    output: Any = results[0] if len(results) == 1 else {"scenarios": results}
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
