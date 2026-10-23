# Operating context, price phases, and replenishment

Use this reference for both product modes whenever profit floors, price changes, seasonality, inventory, or replenishment can change the advertising decision. It is product-agnostic. Preserve unknown values as `null` or `UNKNOWN`; never borrow a lead time, sales window, margin, or transport mode from a previous product.

## 1. Operating objective

The preserved envelope is bound by a top-level `operating_context_sha256`, calculated with the shared canonical JSON rule from the selection handoff. Every full-workflow upstream snapshot repeats both the stable `context_id` and this hash. New observations live in timestamped strategy snapshots or append-only updates; they do not silently rewrite and rehash the upstream envelope.

The default business objective is to maximize total contribution profit inside verified cash, inventory, policy, and evidence limits. A fixed ACoS or TACoS is not the default optimization objective. It may be:

- an observed diagnostic ratio;
- a user-supplied constraint with an explicit denominator, source, and effective period; or
- a derived ceiling for one reconciled economics scenario.

Express the profit floor with one or both of:

```json
{
  "minimum_post_ads_contribution_rate": null,
  "target_profit_per_order": null,
  "risk_buffer_per_order": null,
  "contribution_rate_basis": "NET_SALES_REVENUE",
  "evidence_ids": []
}
```

The calculator converts the rate to `net_sales_revenue × minimum_post_ads_contribution_rate`. When both rate and amount are supplied, use the higher profit floor, then add the risk buffer. Recalculate the available ad spend, ACoS, and CPC ceilings whenever effective price, discount, tax, Amazon fees, landed cost, return allowance, CVR, or attribution basis changes.
In a full-workflow package, each economics scenario preserves the upstream objective's three numeric inputs exactly: minimum contribution rate, per-order profit floor, and per-order risk buffer. A missing upstream value stays missing; a changed floor needs an evidenced upstream context revision before a traffic-ready package can use it.

User willingness to accept risk does not change the arithmetic, authenticate evidence, release a claim, make inventory sellable, or grant execution authority. It can authorize only an explicitly bounded learning-loss envelope or a clearly scoped operational decision.

## 2. Observed price versus planned price phases

Keep the current observed offer separate from future intent:

```json
{
  "price_context": {
    "current_observed": {
      "amount": null,
      "currency": "...",
      "observed_at": "...",
      "verification_status": "OBSERVED",
      "evidence_ids": []
    },
    "planned_phases": [
      {
        "phase_id": "PRICE-PHASE-...",
        "trigger": {"type": "DATE | ELAPSED_SELLABLE_DAYS | PERFORMANCE_GATE | MANUAL_CONFIRMATION | OTHER", "value": "..."},
        "intended_price": {"amount": null, "currency": "..."},
        "verification_status": "PLANNED_UNVERIFIED",
        "source_type": "USER_CONFIRMED | SELLER_PLAN | UNKNOWN",
        "evidence_ids": []
      }
    ]
  }
}
```

A planned price never satisfies the current-price gate. `current_observed.verification_status` stays `OBSERVED`, and every future phase stays `PLANNED_UNVERIFIED` inside the preserved upstream envelope. When a planned phase actually becomes active or ends, capture a new timestamped observed-price source and record the transition in the current strategy snapshot or an append-only context update; do not rewrite the preserved plan to `VERIFIED_ACTIVE` or `ENDED`. Each materially different active price/promotion phase receives its own economics scenario or run and its own comparison window. Do not pool performance across phases without an explicit normalization. If price and advertising structure change in the same measurement window, mark the window `CONFOUNDED`; do not attribute the outcome to either change alone.

Price, Listing copy, and image locks constrain what this Skill may propose changing. They do not upgrade evidence or make a stale offer snapshot current. This Skill may preserve the lock and route a handback, but its executable manifest remains limited to Amazon Ads.

## 3. Inventory scope

For advertising readiness, `sellable_units` means the current exact-offer Amazon-fulfillable gross unit count before seller operating reserves and safety stock are deducted. It excludes inbound, in-transit, FC receiving, stranded, removal-bound, and other units that Amazon does not currently report as fulfillable for that exact marketplace, ASIN/SKU, variation, and offer. `reserved_units` and `safety_stock_units` are then deducted exactly once by the formula below.

```text
advertising_available_units
  = sellable_units
    - vine_reserved_units
    - other_locked_or_reserved_units
    - safety_stock_units
```

An inbound shipment can reduce future stockout risk only after its identity, quantity, route state, and expected sellable date are evidenced. It does not increase current advertising-available units until Amazon reports it as fulfillable for the exact offer.

## 4. Lead-time components and route selection

Preserve full upstream route options. For the binding plan, select one quantity-appropriate route and expose its components:

```json
{
  "selected_route_id": "ROUTE-...",
  "order_quantity": null,
  "production_days": null,
  "qc_and_prep_days": null,
  "transit_days": null,
  "customs_or_local_delivery_days": null,
  "fba_receiving_days": null,
  "risk_buffer_days": null,
  "base_lead_days": null,
  "evidence_class": "FIRST_PARTY | SELLER_CONFIRMED | ESTIMATED | UNKNOWN",
  "source_artifact_ids": []
}
```

```text
base_lead_days
  = production_days
    + qc_and_prep_days
    + transit_days
    + customs_or_local_delivery_days
    + fba_receiving_days
```

Use the production-time tier that matches the contemplated quantity. Map `base_lead_days` to calculator `replenishment_lead_days` and `risk_buffer_days` to `inbound_buffer_days`; do not add the same buffer twice. If any binding component is unknown, keep the total `null` and the traffic/replenishment decision provisional. Do not replace an unknown production or receiving duration with zero.

## 5. Reorder, seasonality, and bridge routes

Use evidence-based demand phases rather than fixed calendar months. Each phase records its marketplace, date window, low/base/high daily-order range, evidence class, source period, confidence, and refresh date.

Keep the shared objects distinct: `demand_calendar` is the full planning horizon and demand-scenario model; `seasonality_context` is a timestamped, sourced observation of the current seasonal phase; `current_stage` is the seller's evidenced operating stage. Advertising may use them together, but cannot copy a future calendar phase into a current snapshot or rewrite the preserved envelope.

```text
days_of_cover
  = advertising_available_units / season_adjusted_daily_orders

reorder_trigger_cover_days
  = selected_route_base_lead_days + risk_buffer_days

trigger reorder review when
  days_of_cover <= reorder_trigger_cover_days
```

`replenishment_policy.safety_stock_days` is the upstream policy target, while `inventory.safety_stock_units` is its binding snapshot conversion: `ceil(safety_stock_days × binding season-adjusted daily orders)`. Preserve the same day value, record the forecast source, and deduct the resulting units once from gross `sellable_units`. When safety stock is already subtracted from advertising-available units, do not add the same allowance again as days. Time-based route uncertainty remains a separate risk buffer.

A route is economically usable only when its expected FBA-sellable date is no later than the evidence-based `last_economic_fba_arrival_date`. That date is product- and market-specific; never infer it from another seasonal item.

Evaluate a faster bridge route only when the primary route would arrive after projected stockout and the faster route can become sellable earlier. Size the bridge to the evidenced demand gap until the primary route becomes sellable, then recalculate landed cost, contribution floor, cash exposure, and advertising capacity for the bridge units. If the faster route also arrives after projected stockout, return `SERVICE_GAP_BEFORE_BRIDGE`; do not describe the gap as solved.

Advertising response to unresolved replenishment risk is bounded: hold launch, reduce exposure, preserve inventory, or route an operational handback. This Skill does not create a purchase order, book freight, or count inbound stock as available.

## 6. Change and evidence boundaries

Preserve these states separately:

- `evidence_readiness`: whether facts, offer, economics, and account state are verified;
- `operator_change_state`: whether copy, assets, price, or campaign entities are open or locked for change;
- `acknowledged_risks`: what the user has accepted and when it must be reviewed again;
- `execution_authority`: whether an exact Amazon Ads manifest has fresh authorization.

A lock can prohibit an edit while evidence remains weak. A risk acknowledgement can permit a bounded business choice while the evidence stays provisional. Neither can convert `UNKNOWN`, `HOLD`, `BLOCKED`, or stale state into verified readiness.
