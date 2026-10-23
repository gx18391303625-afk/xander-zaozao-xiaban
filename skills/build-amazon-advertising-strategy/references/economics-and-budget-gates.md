# Full-strategy economics and budget gates

Read [economics-calculation.md](economics-calculation.md) first for the common financial model. This reference adds complete-strategy scenario evidence, actual-performance lineage, approved spending/loss constraints, and traffic-readiness reconciliation. A standalone `ECONOMICS_ONLY` calculation does not require this file.

## New-product scenarios

For a traffic-ready new-product plan, use exactly one of each named role `PESSIMISTIC`, `BASE`, and `OPTIMISTIC`; `name` and `scenario_role` must be identical. Every scenario carries `scenario_confidence` (`LOW|MEDIUM|HIGH`) and non-empty `scenario_source_ids`, with at least one source beyond `HYPOTHESIS`. `HIGH` confidence requires first-party, verified-product, or seller-confirmed sources that actually cover both `CONVERSION_RATE` and `ATTRIBUTED_REVENUE`; an unrelated authoritative inventory/account source does not count. Store the calculator payload as `{common, scenarios[]}`, its output as `{scenarios[]}`, and name one existing result in `binding_scenario_name`.

Bind evidence by economic meaning, not by the mere presence of a source ID:

- `economics.input_evidence_source_ids` collectively covers `OFFER_AND_REVENUE`, `AMAZON_FEES_AND_TAX`, `PRODUCT_COSTS_AND_RETURNS`, and `INVENTORY` for the common inputs, using compatible artifact/data-class pairs that match marketplace, monetary currency, account when account-derived, and the exact strategy ASIN/SKU scope;
- every scenario's `scenario_source_ids` covers `CONVERSION_RATE` and `ATTRIBUTED_REVENUE` for the scenario-specific advertising assumptions;
- artifact types and `evidence_domains[]` must agree: keyword or competitor estimates may support a labeled traffic/CVR hypothesis, but cannot prove fees, unit costs, inventory, or actual ad performance; policy artifacts prove rules, not ordinary numeric economics; budget approvals prove only scoped cash/loss authority;
- a row labeled `ACTUAL` requires exact marketplace, currency, account, entity, ad-product, charge, interaction, sales-scope, and attribution-window first-party Amazon evidence.

The scenario advertising tolerance must be monotonic: target CPC, break-even CPC, target ACoS, operating break-even ACoS, and all-in break-even ACoS for `PESSIMISTIC` cannot exceed `BASE`, and `BASE` cannot exceed `OPTIMISTIC`. If a cost, return, or conversion assumption breaks the expected ordering, keep the evidence but rename/reorder the scenario roles or lower readiness; do not preserve a desired label over the arithmetic.

Vary at least:

- effective price and seller-funded discount;
- CVR and CPC;
- returns/loss allowance;
- variable Coupon/deal cost;
- inventory availability and replenishment timing;
- review/rating-count conversion disadvantage;
- fee/currency uncertainty where material.

Use first-party analogs when comparable. Otherwise use current market/competitor data or SellerSprite as `ESTIMATED`, with source and scope. Never label the optimistic scenario “expected” merely because it is the desired outcome.

The binding plan ceiling is normally the pessimistic or base case. Binding `OPTIMISTIC` requires `optimistic_binding_approved_by_user=true` and a `binding_scenario_approval_source_id` that resolves to a scoped first-party or seller-confirmed approval artifact. Only the binding scenario releases target-profit or break-even ceilings to target rows. Show which variable most quickly makes contribution non-positive.

## Existing-period structured-package evidence

The standalone estimate and period-reconciliation rules are in [economics-calculation.md](economics-calculation.md). The following gates apply when an existing-product result is bound into a structured strategy package.

The following `economics.performance_basis` and actual-business lineage gates describe the existing structured strategy-package contract, not prerequisites for every provisional estimate. If its validator currently accepts only a Business Report artifact for actual retail totals, a Data Kiosk result needs a supported, tested mapping before entering that package. Until then, keep a separately sourced analytical result and do not claim validator acceptance or change its evidence type to force a pass.

Declare one explicit `economics.performance_basis` and require every cited performance row to match it. The bundled actual CPC/CVR calculator accepts `CPC + CLICK + PROMOTED` rows and requires the exact campaign ad-product set plus matching marketplace, currency, account, ASIN/SKU `scope_id`, canonical entity scope, and attribution window. The exact attribution-window value must be declared by both the cited report/API metadata and a current official attribution-policy artifact. Binding row report time and the cited first-party artifact capture time must each be within 24 hours of package capture. Parse and order `window_start`, `window_end`, `data_through_date`, and `report_generated_at`; future reports or data-through dates are invalid. Decision rules may cite only snapshots on this same basis. A different charge, interaction, halo/combined sales, or entity basis requires a separate auditable normalization/model and otherwise remains provisional. Structured `coverage_gaps` with `UNRESOLVED` or `BLOCKING` impact also prevent readiness.
For binding rows, the report source also declares the exact measurement window and data-through date, `report_status=COMPLETED`, and `attribution_status=COMPLETE`. Aggregate only one exact window. Multiple rows for one ad product need distinct entity IDs under the common entity scope; otherwise overlap cannot be ruled out.

Treat total retail sales and contribution totals as optional actual-business fields, not Ads-report metrics. When present, total sales reconciles to exactly one same-window first-party Amazon Business Report. Each contribution field reconciles to exactly one `VERIFIED_PRODUCT` or `SELLER_CONFIRMED` formula-declared normalization snapshot whose unique `derived_source_ids` all resolve. Attributed contribution includes the binding Amazon Ads report/API source; total contribution includes the already reconciled Amazon Business Report; both include current `PRODUCT_COSTS_AND_RETURNS` evidence. Every derived source matches the exact marketplace, currency, account, ASIN/SKU, report window, data-through date, permitted class/artifact semantics, and 24-hour freshness window. A wrong-scope or merely adjacent source proves nothing. Without that chain, leave actual TACoS and period break-even contribution ratios null. TACoS remains a diagnostic management ratio; do not treat a fixed value as the profit objective unless the user explicitly supplied it as a scoped constraint.

Calculate both:

```text
modeled operating profit after ads
  = total modeled operating contribution - ad_spend

modeled all-in profit after ads
  = total modeled operating contribution
    - ad_spend - allocated fixed launch support
```

For a mixed-ASIN or halo period, use item-level actual contribution where possible. If the attributed-sales mix cannot be mapped to the contribution model, ACoS may still be reported but exact break-even profit and scaling permission remain unavailable.

Do not claim exact profit if the report sales scope cannot be reconciled to modeled orders/units. State the mismatch and use a bounded estimate.

## Budget and approved learning loss

A daily campaign budget is a delivery control, not a promise of spend and not the total risk limit. Record separately:

```text
campaign daily/lifetime budget
phase spend cap
strategy total spend cap
approved learning-loss cap
ad cash reserve
all-in launch investment cap
inventory floor
```

`strategy total spend cap` is the PPC ceiling across the strategy phases. `approved cash exposure` is the broader user-approved promotion cash envelope and must cover that PPC ceiling plus applicable fixed launch support such as Vine enrollment/units and fixed Coupon/deal fees. Do not count the same variable Coupon discount or fee both inside per-order contribution and again as fixed cash exposure.

Both caps require a current `FIRST_PARTY` or `SELLER_CONFIRMED` approval source. The binding scenario's `planned_ppc_spend`, the sum of campaign phase caps, and the sum of phase-plan caps must each stay within `strategy_total_spend_cap`. The PPC cap plus fixed launch support must stay within `approved_cash_exposure`.

Budget allocation must follow objective and evidence, not equal splitting.

Keep proposed bids at or below the applicable target-profit or operating break-even CPC ceiling unless the user explicitly approves an `APPROVED_LEARNING_LOSS` envelope:

```json
{
  "learning_loss_envelope_id": "LL-001",
  "scope_ad_target_ids": ["AT-KW-001"],
  "approved_by_user": true,
  "approved_at": "...",
  "approval_source_id": "SRC-APPROVAL-001",
  "maximum_incremental_loss": 100,
  "maximum_spend": 300,
  "data_or_time_gate": "...",
  "reason": "specific hypothesis",
  "stop_conditions": [],
  "rollback_action": "..."
}
```

An envelope authorizes a bounded experiment, not unlimited bidding. Do not infer approval from a general desire to rank, launch, or gain reviews.

The approval source must match marketplace, currency, account, and the approved-budget artifact type. Both `maximum_spend` and `maximum_incremental_loss` must be positive for an included target; incremental loss cannot exceed spend. The target bid/ceiling cannot exceed either total cap, and every campaign referencing the target must keep its phase cap within the envelope's maximum spend.

Every learning campaign binds exactly one envelope and supplies the following closed model until another validator-recomputable model is implemented:

```json
{
  "model_version": "CONSERVATIVE_FULL_SPEND_V1",
  "method": "CONSERVATIVE_FULL_SPEND",
  "formula": "modeled_loss_at_cap = phase_spend_cap",
  "modeled_spend_at_cap": 100,
  "modeled_loss_at_cap": 100,
  "source_ids": ["SRC-APPROVAL-001"]
}
```

The campaign's modeled spend, modeled worst-case loss, and `learning_loss_allocations[learning_loss_envelope_id]` must each equal its `phase_spend_cap`; the validator recomputes this rather than trusting a lower self-reported loss. Across all campaigns tied to one envelope, aggregate phase caps cannot exceed `maximum_spend`, and aggregate loss allocations must be positive and cannot exceed `maximum_incremental_loss`. The approval timestamp must be within 30 days, cannot occur after package capture, and cannot be later than the cited approval artifact beyond clock skew. Count each campaign once per envelope. Every included target has exactly one campaign owner; use a new target ID and explicit routing contract when a genuinely distinct test requires separate ownership.

Data sufficiency should depend on expected CVR, observed variance, attribution completeness, target economics, and the cost of another observation. Avoid universal rules such as “pause after 10 clicks” or “increase budget every three days.”

## Readiness and failure states

The calculator's `overall_status` is one of:

- `BLOCKED`: contribution, target capacity, allocated all-in contribution, or usable inventory is non-positive/invalid.
- `PROVISIONAL`: material fields were assumed zero or unverified, fixed support cannot be allocated because planned orders are zero, a non-promoted attribution mix is unmapped, inventory coverage is below lead-time plus buffer, or an existing attribution window is incomplete.
- `READY_ACTUAL`: complete verified inputs use actual attributed-sales and actual conversion data.
- `READY_ESTIMATED`: the model is complete but one or both advertising denominators are estimated/proxy rather than actual.

Detailed conditions remain in `reason_codes`, including `NEGATIVE_PRE_AD_CONTRIBUTION`, `ZERO_PRE_AD_CONTRIBUTION`, `PLANNED_UNITS_ZERO`, `TARGET_PROFIT_EXCEEDS_PRE_AD_CONTRIBUTION`, `ZERO_TARGET_AD_CAPACITY`, `CVR_MISSING`, `CVR_ESTIMATED`, `CVR_OBSERVED_ZERO`, `REVENUE_BASIS_PROXY`, `ATTRIBUTED_MIX_UNMAPPED`, `ASSUMED_ZERO_COST_FIELDS`, `UNVERIFIED_CORE_INPUTS`, inventory risk, and attribution-window warnings. `ECONOMICS_READY` is the strategy-package status for a complete `ECONOMICS_ONLY` deliverable; it is not a calculator status.
`NO_ADVERTISING_AVAILABLE_INVENTORY` blocks zero currently available units. `ACTUAL_PERIOD_METRICS_INCOMPLETE` keeps an existing-product calculation provisional until impressions, clicks, attributed orders, spend, and attributed sales are all present.

For `HALO`, `COMBINED`, or `UNKNOWN` attributed-sales scope, provide `attributed_mix_contribution_per_order`. Without it, both operating and all-in ACoS/CPC ceilings that depend on that mix remain unavailable.

Missing optional money fields and planning counts may be modeled as zero only when they appear in `assumed_zero_fields`; that forces provisional readiness. `return_nonrevenue_cost` and all other costs are non-negative. In the rate model, reimbursements/recoveries may reduce return costs to zero but cannot create a net credit that inflates unit contribution; model any genuinely verified credit in a separate evidence-ledger model.

For traffic readiness, the binding calculator inventory must reconcile to the package snapshot: current exact-offer fulfillable sellable units, reserved/locked units, safety stock, and lead time. Inbound, in-transit, or FC-receiving units are not current sellable inventory. `inventory.reserved_units` equals Vine plus other locked/reserved breakdown units. A new-product plan also reconciles the selected quantity-matched route: production + prep + transit + customs/local delivery + FBA receiving equals base lead time, while route risk buffer remains separate. Binding Vine units, reserve, eligibility, method, enrollment fee, landed cost, and fulfillment cost reconcile exactly to the onsite plan and calculator. Effective price, currency, tax basis, every binding Coupon/deal discount and fee, and all five cost ledgers also reconcile in both directions. New-product planned orders cannot exceed currently advertising-available inventory, phase inventory floors must preserve safety stock and be reachable, and `HIGH` or `UNKNOWN` stockout risk is not traffic-ready.

Never turn a null into zero in the workbook. Never call a lower-bound model “conservative” when missing costs actually make it optimistic.
