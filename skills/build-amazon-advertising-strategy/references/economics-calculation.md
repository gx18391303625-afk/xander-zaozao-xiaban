# Advertising economics calculation

Read this for a standalone `ECONOMICS_ONLY` calculation, or before the full-strategy budget gates in [economics-and-budget-gates.md](economics-and-budget-gates.md). Use [calculate_ad_economics.py](../scripts/calculate_ad_economics.py) when available. Choose `ESTIMATE` or `RECONCILED` depth from [SKILL.md](../SKILL.md); a single metric needs only its supported inputs, not the full package schema.

## Calculator usage (read first)

- For a standalone break-even / target ACoS / CPC question, pass `"calculation_scope": "ECONOMICS_ONLY"`. Inventory, Vine, launch-support and planning counts are then out of scope: they are not assumed zero and missing inventory does not produce `BLOCKED`. Use the default `FULL` scope only inside a full strategy package.
- When the seller confirms a cost genuinely does not apply (no coupon, no duty, no prep), list it in `not_applicable_fields`. Those fields count as zero **by confirmation**, not as assumptions, so they no longer force `PROVISIONAL`. Never list a field just to clear the status; unknown is not the same as not applicable.
- Unknown or misspelled input fields are rejected (`UNKNOWN_INPUT_FIELDS`, with a suggested correction). Fix the name rather than dropping the value; put free-text notes in `x_`-prefixed fields.
- Explain the result to the user in plain words: `READY_ESTIMATED` = the economics are complete but CVR/attributed sales are estimates; `PROVISIONAL` = some cost was assumed zero (list which ones, and say the result is therefore optimistic); `BLOCKED` = no room for ads at this price/cost.

## Accounting scope

For an explicit `ESTIMATE`, use the smallest supported model and label assumptions, excluded costs and provisional output. Do not require all source systems, launch scenarios or final settlement merely to estimate order profit. For `RECONCILED`, align relevant first-party sales, orders, fees, refunds, Ads and costs by date, timezone, entity scope, definition, attribution window and backfill. Neither depth relaxes cost admission or live-change readiness.

Data Kiosk Economics may supply ASIN-level sales, refunds, referral/fulfillment fees and Net Proceeds where access is recorded. Its sales can differ from Business/salesAndTraffic sales. Preserve both definitions; do not substitute Economics sales into retail TACoS or treat Net Proceeds as final profit or order-level allocation. Identify fees, refunds and adjustments already included before adding costs. Consult Orders/Finances and settlement evidence as needed; do not guess discrepancy causes.

Record marketplace, currency, timezone, tax basis, ASIN/SKU/variation, pack and offer quantity, effective price/promotion dates, fee snapshot date and evidence class, per-order versus per-unit basis, and whether attributed sales are Amazon Ads reported value or an explicit net-sales proxy. The normalized model assumes `units_per_order=1`: one order means one sellable offer, including a multipack; normalize orders containing multiple offers before calculation. Do not merge materially different price, cost, tax, returns or offer quantities into one break-even ACoS; use item-level contributions for a portfolio-weighted model.

## Separate ledgers

Keep PPC (spend, attributed sales/orders, clicks, impressions, CPC, ACoS, ROAS), seller-funded price/discount, Coupon/deal discounts and fees, Vine/review support, and inventory/cash visible separately. Vine includes current enrollment fee, supplied units, landed and fulfillment costs and never guarantees a review/rating. Inventory/cash includes sellable stock, safety stock, replenishment, ad reserve, approved learning-loss reserve and total launch exposure. Do not hide non-PPC ledgers inside ACoS; show advertising efficiency and all-in promotion economics.

## Core formulas

Use exact Decimal arithmetic in this normalized per-order model:

```text
transaction_revenue_including_tax
  = selling_price + seller_retained_shipping
    - seller_funded_discount - coupon_discount_per_order
    - other_seller_funded_discount
transaction_revenue_before_tax
  = transaction_revenue_including_tax / (1 + tax_rate)
    if price_includes_tax=true; otherwise transaction_revenue_including_tax
net_sales_revenue
  = transaction_revenue_before_tax - expected_refund_revenue_loss
landed_cost
  = cogs + packaging + prep_and_label + quality_inspection
    + inbound_freight + duty
amazon_and_fulfillment_cost
  = referral_fee + fulfillment_fee + storage + other_amazon_fees
variable_onsite_promotion_cost
  = coupon_fee_per_order + deal_fee_per_order
    + other_onsite_promotion_cost_per_order
loss_allowances = return_nonrevenue_cost + other_variable_cost
operating_contribution_before_ads
  = net_sales_revenue - landed_cost - amazon_and_fulfillment_cost
    - variable_onsite_promotion_cost - loss_allowances
fixed_launch_support_total
  = vine_enrollment_fee
    + vine_units × (vine_unit_landed_cost + vine_unit_fulfillment_cost)
    + coupon_fixed_fee + deal_fixed_fee + other_launch_support_fixed
fixed_launch_support_per_planned_order
  = fixed_launch_support_total / planned_orders
all_in_contribution_before_ads
  = operating_contribution_before_ads - fixed_launch_support_per_planned_order
```

Refunded revenue reduces net sales; disposal, processing, unrecovered fulfillment and return freight are non-revenue costs. Never count the same return allowance twice. Coupon discount reduces revenue, while redemption and fixed fees remain costs. Do not deduct a refund again from already refund-adjusted net sales. A genuinely inapplicable amount is zero with a reason; unknown is `null`. The calculator may assume zero only in an explicitly listed `assumed_zero_fields` lower-bound/provisional model, including return components and fees. An omitted actual-period metric is unavailable, never observed zero. Referral fee may be exact or derived from a current verified rate; if both appear, state which controls, never silently select the lower.

## ACoS, TACoS, CPC, and CVR

Amazon Ads ACoS uses attributed sales; contribution uses the model above. Keep denominators explicit:

```text
operating_break_even_ad_spend_per_order = operating_contribution_before_ads
all_in_break_even_ad_spend_per_order = all_in_contribution_before_ads
operating_break_even_acos
  = operating_contribution_before_ads / ad_attributed_sales_per_order
all_in_break_even_acos
  = all_in_contribution_before_ads / ad_attributed_sales_per_order
target_profit_acos
  = (operating_contribution_before_ads - target_profit_floor_per_order
     - risk_buffer_per_order) / ad_attributed_sales_per_order
operating_break_even_cpc = operating_contribution_before_ads × conversion_rate
target_profit_cpc
  = (operating_contribution_before_ads - target_profit_floor_per_order
     - risk_buffer_per_order) × conversion_rate
rate_based_profit_floor_per_order
  = net_sales_revenue × minimum_post_ads_contribution_rate
target_profit_floor_per_order
  = max(target_profit_per_order, rate_based_profit_floor_per_order)
```

`minimum_post_ads_contribution_rate` uses `NET_SALES_REVENUE` as denominator. Either rate or per-order floor may be absent; when both exist the stricter floor controls, and the risk buffer is additional. If the floor plus buffer exactly consumes contribution, target ACoS/CPC is numeric zero and positive ad capacity is blocked; if it exceeds contribution, the ceiling is unavailable and economics are blocked. Missing CVR means `null`, observed or explicitly modeled zero CVR means numeric zero. Round displayed actionable CPC ceilings down to the currency cent; keep underlying Decimal values for audit. Other money displays use conventional rounding.

Existing-period ratios: `ACoS=ad_spend/ad_attributed_sales`, `ROAS=ad_attributed_sales/ad_spend`, `TACoS=ad_spend/total_retail_sales`, `CPC=ad_spend/clicks`, `CTR=clicks/impressions`, `ad_CVR=attributed_orders/clicks`. A zero or unknown denominator, or unknown numerator, yields `null`; unknown spend cannot become zero ACoS/TACoS. Separate promoted from halo/other attributed sales where reported. Do not compare ACoS/ROAS across incompatible attribution windows, interactions, ad products, charge types, marketplaces, currencies or sales scopes without normalization. TACoS is a management ratio, not proof of incremental impact.

## Standalone estimate and existing-period reconciliation

Daily order-profit estimates differ from planning scenarios and settled profit. Use scope-matched observed order-fee samples and supported purchase/freight estimates with date, allocation basis and provisional status. An unverified historical placeholder is not an admissible deduction, reserve, lower bound or current break-even cost merely because it says `estimated`; list it as not included/unknown, never confirmed zero. Put user-requested hypotheticals in a separate result. Use a project cost-admission calculator if supplied and inspect the underlying evidence. A financial record does not prove payment release or settlement.

An idealized workbook remains an immutable scenario baseline, not a booked-profit ledger. Reconcile charges/credits, refunds, promotion funding, landed costs and period before calling profit actual. Do not double count Ads reports with invoices or capitalized freight with service fees; classify debt settlement and cash transfers before inclusion. Final settled profit needs corresponding Settlement reconciliation. Otherwise show the unresolved amount and provisional status.

Label retail-sales TACoS and finance-ledger net-sales ratios separately. Use a shorter complete common window only as a separate diagnostic, leaving the requested full-window ratio unavailable. Preserve the user's profit floor and buffer independently. For a `RECONCILED` existing-ASIN review, align Ads spend/attributed sales, retail sales/traffic, refunds/promotions, price/fee/inventory/Listing/review/campaign changes, promoted versus halo mix, and attribution maturity as applicable. For mixed-ASIN or halo results, use item-level contribution; if the mix cannot be mapped, ACoS can be reported but exact break-even profit and scaling permission remain unavailable. Do not call profit exact when sales cannot reconcile to modeled orders/units.

Modeled operating profit after ads equals modeled operating contribution total minus ad spend. Modeled all-in profit after ads also subtracts allocated fixed launch support. When `HALO`, `COMBINED` or `UNKNOWN` attributed-sales scope lacks `attributed_mix_contribution_per_order`, its operating and all-in ACoS/CPC ceilings are unavailable.

## Cash exposure for a standalone calculation

Show PPC planned spend, fixed launch support, variable promotion costs, ad cash reserve, inventory commitment and any approved learning-loss reserve separately. A daily campaign budget controls delivery; it is neither a spend promise nor a total loss cap. Do not count a per-order Coupon discount or fee both in contribution and again as fixed support. If a user has not approved a total cash or learning-loss envelope, report the proposed exposure as unapproved, not available capacity. A calculation can show break-even economics without authorizing a bid, campaign budget or above-break-even experiment. Full-strategy cap binding, allocation and approval-source checks are in [economics-and-budget-gates.md](economics-and-budget-gates.md).

The calculator's `overall_status` is `BLOCKED`, `PROVISIONAL`, `READY_ACTUAL` or `READY_ESTIMATED`; inspect `reason_codes`. Missing costs/estimated denominators, unmapped mix, incomplete actual-period metrics or attribution, zero planned orders, and inventory gaps cannot be silently promoted to readiness. `NO_ADVERTISING_AVAILABLE_INVENTORY` blocks zero available units. `ACTUAL_PERIOD_METRICS_INCOMPLETE` applies until impressions, clicks, attributed orders, spend and attributed sales are all present. `ECONOMICS_READY` is a strategy-package status for complete non-provisional `ECONOMICS_ONLY`, not a calculator status and never execution permission. Return costs are nonnegative; verified recovery can reduce them to zero but not create an invented contribution credit. Never call a missing-cost lower bound conservative when omission makes it optimistic.
