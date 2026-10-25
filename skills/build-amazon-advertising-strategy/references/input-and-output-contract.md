# Input and output contract

Use this contract to preserve evidence and identity across product selection, competitor locking, keyword research, Listing release, onsite advertising strategy, and the later promotion-exit review. It supports any Amazon product, marketplace, or category.

## Contents

1. Input sources and precedence
2. Stable lineage and aliases
3. Canonical strategy package
4. Target and campaign rows
5. Phase, decision, and handback rows
6. State and execution contract
7. Readiness integrity rules
8. Workbook and Stage 5 handoff

## Input sources and precedence

Prefer separate, source-traceable artifacts rather than copying values between sheets until their origin is lost.

Common inputs:

- current `listing_release.json` from `$write-amazon-listing`;
- first-stage selection `handoff.json` or a newer verified unit-economics artifact;
- `competitor_lock.json` and `listing_handoff.json` when the Listing release does not retain full grouped detail;
- current offer, price, promotion, inventory, fee, account-eligibility, and ad-placement-scope snapshots;
- approved cash exposure, profit objective, and replenishment constraints.

Preserve the upstream `operating_context` without upgrading its authority. It separates the current observed offer from planned price phases, evidence-based demand windows, content/asset locks, acknowledged risks, supply routes, and replenishment policy. Planned values stay planned; locks restrict change scope; acknowledged risks do not change evidence, publication, eligibility, or execution status. Refresh the binding current offer, inventory, account, and economics from first-party or seller-confirmed sources before traffic readiness.

Additional new-product inputs:

- pessimistic/base/optimistic CVR, CPC, price, returns, promotion, and inventory assumptions with source and confidence;
- SellerSprite or other third-party CPC/demand estimates, always labeled `ESTIMATED`;
- rating, ratings-count, price, pack, and offer barriers from the locked competitor groups.

Additional existing-product inputs:

- immutable Amazon Ads reports or API extracts for campaign, ad group, target, search term, placement, advertised product, budget, and change history as available;
- Business Reports or equivalent retail traffic/sales data;
- price, Coupon/deal, inventory, Listing, rating/review, Buy Box/Featured Offer, and operational event history aligned to the report windows;
- report-generation date, data-through date, attribution schema, promoted/halo scope, ad type, charge type, currency, and marketplace.

Data authority:

```text
current first-party account/report data
-> verified seller/product/fee/inventory records
-> current upstream research artifacts
-> SellerSprite and other third-party estimates
-> model hypotheses
```

Lower-authority data can fill a labeled scenario gap; it cannot overwrite a current first-party value silently.

## Stable lineage and aliases

Full-workflow packages preserve:

```text
project_id
selection_run_id
candidate_id
competitor_lock_run_id
keyword_run_id
listing_run_id
listing_version_id
```

Create:

```text
ad_economics_run_id
ad_strategy_run_id
ad_strategy_version_id
```

The first-stage selection artifact historically uses top-level `run_id`, while later stages use `selection_run_id`. Do not silently rename it. When they refer to the same run, preserve both:

```json
{
  "selection_run_id": "SEL-001",
  "id_aliases": [
    {
      "canonical_field": "selection_run_id",
      "source_artifact": "handoff.json",
      "source_field": "run_id",
      "source_value": "SEL-001",
      "verified_same_identity": true
    }
  ]
}
```

If both fields exist and differ, preserve both, mark the lineage `CONFLICT`, and block a workflow-linked execution plan until resolved.

Use `lineage_mode`:

- `FULL_WORKFLOW`: all upstream IDs are expected; retained for existing historical full-workflow packages, not newly created operations work after selection was frozen.
- `INDEPENDENT_EXISTING`: an existing ASIN/account audit began outside the workflow. Do not invent upstream IDs; require marketplace, account scope, ASIN/SKU IDs, report/source IDs, and a reason.
- `INDEPENDENT_NEW`: a new-product plan began outside the workflow but has a traceable verified product/offer/Listing/economics evidence package. Do not invent upstream IDs.

Every independent package includes `independent_scope.reason`, `source_scope_id`, and non-empty `source_artifact_ids`. `INDEPENDENT_EXISTING` is valid only with `EXISTING_PRODUCT_OPTIMIZATION`; `INDEPENDENT_NEW` is valid only with `NEW_PRODUCT_LAUNCH`.

Independent mode removes requirements for genuinely absent stages only. When an operating context exists, every supplied upstream snapshot preserves its context ID and canonical hash, and the economics inputs preserve its profit constraints. A snapshot that references an operating context cannot be reused while that envelope is omitted. These preservation checks also block `ECONOMICS_READY` when violated; they do not add traffic-plan input requirements to standalone economics. A genuinely standalone package with no prior context may omit it without inventing one.

## Canonical strategy package

Save `advertising_strategy_plan.json` using this minimum shape:

```json
{
  "contract_version": "1.0",
  "lineage_mode": "FULL_WORKFLOW",
  "independent_scope": null,
  "strategy_mode": "NEW_PRODUCT_LAUNCH",
  "deliverable_mode": "PLAN",
  "execution_authority": "PLAN_ONLY",
  "project_id": "...",
  "selection_run_id": "...",
  "candidate_id": "...",
  "competitor_lock_run_id": "...",
  "keyword_run_id": "...",
  "listing_run_id": "...",
  "listing_version_id": "...",
  "ad_economics_run_id": "...",
  "ad_strategy_run_id": "...",
  "ad_strategy_version_id": "...",
  "id_aliases": [],
  "source_artifacts": [
    {
      "source_artifact_id": "SRC-001",
      "artifact_type": "listing_release",
      "path_or_url": "...",
      "version_or_captured_at": "...",
      "sha256": "sha256:64 hexadecimal characters",
      "data_class": "FIRST_PARTY | VERIFIED_PRODUCT | SELLER_CONFIRMED | USER_SUPPLIED_UNVERIFIED | OFFICIAL_POLICY | ESTIMATED | HYPOTHESIS",
      "marketplace": "US or GLOBAL when scope-relevant",
    "account_id_masked": "required when account-scoped",
    "ad_products": ["required when ad-product-scoped"],
    "attribution_windows": ["required for attribution-policy and performance artifacts"],
    "window_start": "required for binding Ads report/API artifacts",
    "window_end": "required for binding Ads report/API artifacts",
    "data_through_date": "required for binding Ads report/API artifacts",
    "report_status": "COMPLETED for binding Ads report/API artifacts",
    "attribution_status": "COMPLETE for binding Ads report/API artifacts",
      "scope_id": "exact strategy ASIN or SKU when entity-scoped",
      "keyword_scope_ids": ["required for KEYWORD_TARGET_EVIDENCE"],
      "asin_scope_ids": ["required for PRODUCT_TARGET_EVIDENCE"],
      "evidence_domains": ["OFFER_AND_REVENUE | AMAZON_FEES_AND_TAX | PRODUCT_COSTS_AND_RETURNS | CONVERSION_RATE | ATTRIBUTED_REVENUE | INVENTORY | KEYWORD_TARGET_EVIDENCE | PRODUCT_TARGET_EVIDENCE | ONSITE_PRICE | ONSITE_PROMOTION | VINE_ELIGIBILITY | REQUEST_REVIEW_ELIGIBILITY"]
    }
  ],
  "marketplace": "US",
  "currency": "USD",
  "timezone": "America/Los_Angeles",
  "captured_at": "ISO-8601 timestamp",
  "scope": {
    "account_id_masked": "...",
    "portfolio_id": null,
    "asin": "...",
    "sku": "...",
    "parent_asin": null,
    "variation": "...",
    "offer_scope": "single sellable offer"
  },
  "operating_context": {
    "context_id": "CTX-...",
    "profit_objective": {
      "objective": "MAXIMIZE_TOTAL_CONTRIBUTION_PROFIT",
      "minimum_post_ads_contribution_rate": null,
      "target_profit_per_order": null,
      "risk_buffer_per_order": null,
      "contribution_rate_basis": "NET_SALES_REVENUE",
      "evidence_ids": []
    },
    "price_context": {
      "current_observed": {},
      "planned_phases": []
    },
    "demand_calendar": {},
    "seasonality_context": {},
    "supply_routes": [],
    "replenishment_policy": {},
    "content_change_control": null,
    "acknowledged_risks": []
  },
  "operating_context_sha256": "sha256:<64 lowercase hex>",
  "upstream_snapshots": {
    "selection": {
      "project_id": "...",
      "candidate_id": "...",
      "selection_run_id": "...",
      "operating_context_id": "CTX-...",
      "operating_context_sha256": "sha256:<64 lowercase hex>",
      "source_artifact_ids": ["SRC-SELECTION-..."]
    },
    "competitor_lock": {
      "project_id": "...",
      "candidate_id": "...",
      "competitor_lock_run_id": "...",
      "operating_context_id": "CTX-...",
      "operating_context_sha256": "sha256:<64 lowercase hex>",
      "source_artifact_ids": ["SRC-COMPETITOR-..."]
    },
    "keyword_library": {
      "project_id": "...",
      "candidate_id": "...",
      "keyword_run_id": "...",
      "operating_context_id": "CTX-...",
      "operating_context_sha256": "sha256:<64 lowercase hex>",
      "source_artifact_ids": ["SRC-KEYWORD-..."]
    },
    "listing_release": {
      "project_id": "...",
      "candidate_id": "...",
      "listing_run_id": "...",
      "listing_version_id": "...",
      "operating_context_id": "CTX-...",
      "operating_context_sha256": "sha256:<64 lowercase hex>",
      "status": "READY",
      "integrity_status": "VERIFIED",
      "path": "...",
      "captured_at": "...",
      "source_artifact_ids": ["SRC-LISTING-..."],
      "sha256": "sha256:64 hexadecimal characters"
    }
  },
  "policy_snapshot": {
    "verified": true,
    "verified_at": "...",
    "sources": ["SRC-POLICY-PLACEMENT-...", "SRC-POLICY-ATTRIBUTION-...", "SRC-POLICY-REVIEW-...", "SRC-ACCOUNT-..."],
    "placement_scope_verified": "VERIFIED_CURRENT",
    "attribution_schema_verified": "VERIFIED_CURRENT",
    "review_method_compliance_verified": "VERIFIED_CURRENT",
    "unverified_boundaries": []
  },
  "account_snapshot": {
    "captured_at": "...",
    "read_only": true,
    "ad_products": {},
    "onsite_only_controls": {},
    "featured_offer_or_current_equivalent": "ELIGIBLE | INELIGIBLE | UNKNOWN | NOT_REQUIRED_VERIFIED",
    "advertising_eligibility": "ELIGIBLE | INELIGIBLE | UNKNOWN"
  },
  "economics": {
    "input_snapshot": {
      "common": {},
      "scenarios": [
        {
          "name": "PESSIMISTIC | BASE | OPTIMISTIC",
          "scenario_role": "PESSIMISTIC | BASE | OPTIMISTIC",
          "scenario_confidence": "LOW | MEDIUM | HIGH",
          "scenario_source_ids": ["SRC-..."]
        }
      ]
    },
    "calculator_result": {"scenarios": []},
    "binding_scenario_name": "BASE",
    "input_evidence_source_ids": ["SRC-ECONOMICS-..."],
    "optimistic_binding_approved_by_user": false,
    "binding_scenario_approval_source_id": null,
    "performance_snapshot_ids": [],
    "actual_business_source_ids": [],
    "performance_basis": {
      "ad_products": ["SPONSORED_PRODUCTS"],
      "charge_type": "CPC",
      "interaction_scope": "CLICK",
      "sales_scope": "PROMOTED",
      "entity_scope": "target",
      "attribution_window": "runtime-verified value"
    },
    "approved_cash_exposure": null,
    "approved_cash_exposure_source_id": null,
    "strategy_total_spend_cap": null,
    "strategy_total_spend_cap_source_id": null,
    "approved_learning_loss_envelopes": []
  },
  "inventory": {
    "captured_at": "...",
    "sellable_units": null,
    "reserved_units": null,
    "reserved_breakdown": {"vine_units": null, "other_locked_units": null, "other_reserved_units": null},
    "safety_stock_units": null,
    "lead_time_days": null,
    "lead_time_components": {
      "selected_route_id": null,
      "order_quantity": null,
      "production_days": null,
      "qc_and_prep_days": null,
      "transit_days": null,
      "customs_or_local_delivery_days": null,
      "fba_receiving_days": null,
      "risk_buffer_days": null,
      "base_lead_days": null,
      "source_artifact_ids": []
    },
    "replenishment_policy": {
      "inventory_position_scope": "CURRENT_FULFILLABLE_EXACT_OFFER",
      "safety_stock_days": null,
      "last_economic_fba_arrival_date": null,
      "primary_route_id": null,
      "bridge_route_id": null,
      "bridge_state": "NOT_EVALUATED | NOT_NEEDED | FEASIBLE | SERVICE_GAP_BEFORE_BRIDGE | UNECONOMIC | UNKNOWN"
    },
    "reorder_state": "...",
    "stockout_risk": "LOW | MEDIUM | HIGH | UNKNOWN",
    "source_artifact_ids": []
  },
  "onsite_support": {
    "economics_application": "BINDING | PLANNED_NOT_IN_BINDING | NOT_USED",
    "effective_price": {"amount": null, "currency": "USD", "price_includes_tax": false, "source_artifact_ids": []},
    "price_phases": [],
    "coupons_or_deals": [],
    "vine": {},
    "request_a_review": {
      "eligibility": "RUNTIME_VERIFICATION_REQUIRED",
      "native_method": null,
      "source_artifact_ids": [],
      "eligible_order_scope_ids": []
    },
    "cost_ledger": {"ppc": {}, "discount": {}, "coupon_or_deal": {}, "vine": {}, "inventory_and_cash": {}}
  },
  "performance_snapshots": [],
  "keyword_targets": [],
  "product_targets": [],
  "campaign_architecture": [],
  "routing_rules": [],
  "phase_plan": [],
  "decision_rules": [],
  "review_compliance": {},
  "handbacks": [],
  "change_manifest": [],
  "authorization_record": null,
  "source_coverage": {"gaps": [], "covered_domains": []},
  "unknowns": [],
  "strategy_status": "BLOCKED | PROVISIONAL | ECONOMICS_READY | PLAN_READY | READY_FOR_EXECUTION_REVIEW | EXECUTION_AUTHORIZED"
}
```

The expanded `operating_context` above shows field shape only. In a real full-workflow package, copy the upstream object verbatim and verify its supplied hash; do not normalize omitted fields into `{}`, convert `{}` to `null`, add defaults, reorder arrays, or otherwise rebuild the envelope before hashing.

Artifact type is semantic, not decorative. Amazon-only account proof uses `amazon_ads_account_snapshot` and explicitly records `ad_products[]` plus `onsite_only_controls`; existing performance uses `amazon_ads_report` or `amazon_ads_api_snapshot`; cash approval uses `seller_budget_approval` or `amazon_budget_approval_snapshot`; current inventory uses `seller_inventory_snapshot` or `amazon_inventory_snapshot`; a quantity-matched production/transport/FBA route may use `seller_supply_route_snapshot`. Account-scoped artifacts match `marketplace` and `account_id_masked`; approval artifacts also match `currency`. Official-policy artifacts use `artifact_type=official_policy` and collectively cover `PLACEMENT_SCOPE`, `ATTRIBUTION_SCHEMA`, and `REVIEW_METHOD_COMPLIANCE` through `policy_domains[]`. A `NOT_REQUIRED_VERIFIED` Featured Offer state additionally requires a current official `FEATURED_OFFER_REQUIREMENT` exception whose `ad_products[]` covers every selected ad product. Economics sources declare only domains their artifact type and data class can support and match the strategy marketplace, currency when monetary, account when account-derived, and exact ASIN/SKU `scope_id`. Policy and budget approval cannot prove CVR or unit cost, keyword libraries cannot prove fees or actual performance, and inventory/supply artifacts cannot prove revenue. Placeholder paths, identities, versions, or hashes are invalid, including tokenized placeholders such as `TBD-001` or `SAMPLE-ID`, punctuation-only values, and all-zero IDs. Malformed but valid JSON types fail closed. The validator checks canonical hash shape and cross-references, but it does not authenticate file contents.

For `FULL_WORKFLOW`, every upstream snapshot repeats the exact top-level `project_id` and `candidate_id`, plus its own matching run/version ID, the same `operating_context_id`, and the same `operating_context_sha256`. The validator independently hashes the actual envelope, so a reused ID cannot conceal a silent change to profit, price, routes, locks, or risks. Traffic-ready Listing metadata also requires a non-placeholder `path` and timezone-aware `captured_at` no later than the strategy capture. Missing or mismatched nested lineage cannot be repaired by a top-level ID alone.

The context ID/hash and profit-constraint checks also apply to supplied upstream artifacts in both independent modes. The selection-stage ID requirement remains specific to historical full-workflow packages.

### Readiness gaps

Traffic-ready packages use explicit arrays for `unknowns`, `source_coverage.gaps`, and each performance row's `coverage_gaps`; `policy_snapshot.unverified_boundaries` must be empty. Gap rows are structured and source-linked:

```json
{
  "domain": "TARGET_COVERAGE",
  "status": "RESOLVED | ACCEPTED_NON_BLOCKING | UNRESOLVED",
  "readiness_impact": "NON_BLOCKING | BLOCKING",
  "source_ids": ["SRC-..."]
}
```

Any `UNRESOLVED` or `BLOCKING` record prevents traffic readiness. A non-blocking exception must explicitly use `ACCEPTED_NON_BLOCKING + NON_BLOCKING`; free-text gaps and undeclared source-coverage keys fail closed. Do not move a known gap into notes to bypass the gate.

For a traffic-ready new product, `input_evidence_source_ids` covers common offer/revenue, fees/tax, product-cost/returns, and inventory domains. Each scenario's `scenario_source_ids` covers conversion rate and attributed revenue. The scenario list contains exactly one each of `PESSIMISTIC`, `BASE`, and `OPTIMISTIC`; `name` equals `scenario_role`, every row has evidence beyond a pure hypothesis, and target/break-even CPC plus target/operating/all-in ACoS tolerance is monotonic from pessimistic to optimistic. `HIGH` confidence requires authoritative evidence that actually covers both scenario domains; an unrelated first-party artifact cannot elevate confidence. `ACTUAL` requires exact-scope first-party Amazon performance evidence. Only the named binding result releases ceilings. Binding `OPTIMISTIC` requires the explicit approval boolean and a scoped first-party or seller-confirmed approval source.

The same traffic-ready new-product package includes a quantity-matched `inventory.lead_time_components` block. Its production, prep, transit, customs/local-delivery, and FBA-receiving components sum to `base_lead_days`, which equals `inventory.lead_time_days` and the calculator's `replenishment_lead_days`; `risk_buffer_days` separately equals calculator `inbound_buffer_days`. A missing component, route ID, or source keeps the plan below traffic readiness. `sellable_units` is the current exact-offer Amazon-fulfillable gross count before the package deducts `reserved_units` and `safety_stock_units` exactly once; it excludes inbound, in-transit, and FC-receiving stock.

When upstream `replenishment_policy.safety_stock_days` is set, the binding inventory snapshot preserves the same value and converts it once using `safety_stock_units = ceil(safety_stock_days × binding forecast_daily_total_orders)`. The units are then deducted once from gross `sellable_units`. If no days-based policy exists, a directly seller-confirmed unit reserve is allowed with its own current source; never maintain unrelated day and unit reserves in parallel.

For an existing product, `economics.input_snapshot` is normally one actual input object rather than a scenario wrapper. Its `economics.performance_snapshot_ids` must cite complete first-party snapshots whose impressions, clicks, orders, spend, and attributed sales reconcile to the calculator's advertising actuals. Optional `actual_business_source_ids` separately binds total sales and contribution totals when those fields are non-null. `performance_basis` must exactly match every cited row and the campaign ad-product set. The current calculator's actual CPC/CVR model accepts only compatible `CPC + CLICK + PROMOTED` rows; use a separate auditable normalization/model for other charge, interaction, or sales scopes.
The per-order calculator models one sellable offer per order (`units_per_order=1`); a multipack is one sellable offer. Normalize multi-offer orders before supplying per-order revenue, cost, conversion, and attributed-sales inputs. Omitted actual metrics remain `null` in derived ratios and prevent actual readiness.

For `EXISTING_PRODUCT_OPTIMIZATION`, include at least one first-party performance snapshot for a precise `PLAN_READY` optimization. A strategy based only on screenshots, totals without scope, or third-party estimates remains `PROVISIONAL`.

### Performance snapshot

Each snapshot records its measurement basis:

```json
{
  "performance_snapshot_id": "PS-001",
  "data_class": "FIRST_PARTY",
  "source_artifact_ids": ["SRC-ADS-001"],
  "marketplace": "US",
  "currency": "USD",
  "scope_id": "exact strategy ASIN or SKU",
  "ad_product": "SPONSORED_PRODUCTS",
  "charge_type": "CPC",
  "window_start": "YYYY-MM-DD",
  "window_end": "YYYY-MM-DD",
  "report_generated_at": "ISO-8601 timestamp",
  "data_through_date": "YYYY-MM-DD",
  "attribution_status": "COMPLETE | PARTIAL | UNKNOWN",
  "attribution_window": "runtime-verified value",
  "interaction_scope": "CLICK | VIEW | MIXED | UNKNOWN",
  "sales_scope": "PROMOTED | HALO | COMBINED | UNKNOWN",
  "entity_scope": "campaign | ad_group | target | search_term | placement | advertised_product",
  "entity_id": "required when multiple binding rows share an ad product",
  "metrics": {},
  "events_in_window": [],
  "coverage_gaps": []
}
```

Every performance source artifact must itself be `FIRST_PARTY`, use `amazon_ads_report` or `amazon_ads_api_snapshot`, and match strategy marketplace, currency, account, and exact ASIN/SKU `scope_id`. Binding row `report_generated_at` and the source artifact capture time must each fall within the validator's 24-hour package safety window. `entity_scope` uses one canonical value from `campaign | ad_group | target | search_term | placement | advertised_product`. The exact `attribution_window` must appear in both the report/API artifact's `attribution_windows[]` metadata and a current official `ATTRIBUTION_SCHEMA` source. A row that merely labels itself first-party is insufficient. A complete snapshot has non-empty metrics for impressions, clicks, orders, spend, and attributed sales plus explicit event and coverage-gap arrays. Existing decision rules may cite only rows that match the declared binding `performance_basis`; incompatible diagnostics belong in a separate provisional package or explicit normalization model.
The binding source declares the same exact window and data-through date as its row, plus `report_status=COMPLETED` and `attribution_status=COMPLETE`. All binding rows share one exact window. Counts are non-negative whole numbers; spend and attributed sales are non-negative. If multiple rows share an ad product, give each a distinct real `entity_id` under the declared entity scope to avoid summing overlapping totals.

Actual business totals are a separate evidence contract. If `actual_total_sales`, `actual_attributed_contribution_total`, or `actual_total_contribution_before_ads` is non-null, `economics.actual_business_source_ids[]` is mandatory. Total sales reconciles to exactly one current, first-party `amazon_business_report`; each contribution total reconciles to exactly one `VERIFIED_PRODUCT` or `SELLER_CONFIRMED` `auditable_contribution_normalization_snapshot` with a non-placeholder formula and unique known `derived_source_ids`. Every derived source must itself pass the exact marketplace, currency, account, ASIN/SKU, advertising window, data-through date, class, artifact-domain, and 24-hour freshness contract. Attributed contribution cites a binding Amazon Ads report/API source plus exact-period `PRODUCT_COSTS_AND_RETURNS` evidence; total contribution cites the already reconciled Amazon Business Report plus the same class of exact-period cost evidence. Wrong-scope cost proof or a merely listed, nonbinding Ads/Business artifact cannot satisfy the chain. When this evidence is absent, leave the optional fields null so TACoS and period contribution ratios remain unavailable; do not estimate them inside an `ACTUAL` package.

Never merge reports with different attribution, charge, sales, marketplace, currency, or entity scope without a documented normalization.

### Binding onsite support

Traffic-ready onsite support uses `economics_application=BINDING`. Effective price equals `selling_price - seller_funded_discount - coupon_discount_per_order - other_seller_funded_discount`, and currency plus tax basis match the binding input.

```json
{
  "support_id": "CPN-001",
  "support_type": "COUPON | DEAL",
  "status": "PLANNED | ACTIVE",
  "economics_application": "BINDING | PLANNED_NOT_IN_BINDING",
  "economic_discount_per_modeled_order": 5,
  "fee_per_modeled_order": 0,
  "fixed_fee": 0,
  "planned_redemptions": 100,
  "source_artifact_ids": ["SRC-..."]
}
```

Coupon and deal discounts, per-order fees, and fixed fees aggregate exactly to their binding calculator fields. A future `PLANNED_NOT_IN_BINDING` row remains visible but contributes zero to those binding totals. Price/promotion evidence must use a compatible exact-scope `ONSITE_PRICE`/`ONSITE_PROMOTION` source; a keyword or unrelated report cannot prove it. The five separate ledgers reconcile PPC, price discount, Coupon/deal, Vine, and inventory/cash values in both directions.

```json
{
  "economics_application": "BINDING | NOT_USED",
  "eligibility": "VERIFIED_ELIGIBLE | NOT_USED",
  "planned_units": 0,
  "reserved_units": 0,
  "enrollment_fee": 0,
  "unit_landed_cost": 0,
  "unit_fulfillment_cost": 0,
  "source_artifact_ids": []
}
```

When binding `vine_units>0`, the method includes `VINE`, eligibility is current, planned units and every cost match the model, and `reserved_units >= planned_units`. Eligibility requires a compatible exact-scope `VINE_ELIGIBILITY` artifact and costs require a semantically valid product-cost source. For traffic readiness, `inventory.reserved_breakdown.vine_units`, `other_locked_units`, and `other_reserved_units` are all explicit non-negative numbers; the three fields sum exactly to total reserved inventory and reconcile Vine plus other locked units to the binding input.

Native Request a Review support uses only this closed object:

```json
{
  "eligibility": "NOT_USED | VERIFIED_ELIGIBLE | RUNTIME_VERIFICATION_REQUIRED | INELIGIBLE",
  "native_method": "null | AMAZON_REQUEST_A_REVIEW",
  "source_artifact_ids": ["SRC-REQUEST-REVIEW-001"],
  "eligible_order_scope_ids": ["ORDER-SCOPE-001"]
}
```

When `review_compliance.methods` includes `REQUEST_A_REVIEW`, eligibility is `VERIFIED_ELIGIBLE`, the method is exactly `AMAZON_REQUEST_A_REVIEW`, and every eligible order-scope ID is covered by a current first-party `amazon_request_review_eligibility_snapshot` or `amazon_order_eligibility_snapshot` from the same marketplace, account, and ASIN/SKU with `REQUEST_REVIEW_ELIGIBILITY`. Custom channel, message, incentive, or any additional field fails closed. When the method is not active, use `NOT_USED` or `RUNTIME_VERIFICATION_REQUIRED`; do not store a supposedly verified order-level state without declaring the method.

## Target and campaign rows

### Keyword target

```json
{
  "ad_target_id": "AT-KW-001",
  "source_keyword_id": "KW-001",
  "keyword_original": "portable cable organizer",
  "library_role": "CORE_VERIFIED",
  "ad_role": "CORE_TEST",
  "ad_decision": "INCLUDE | OBSERVE | EXCLUDE",
  "product_fit": "DIRECT | CONDITIONAL | WRONG",
  "intent": "direct product intent",
  "data_class": "FIRST_PARTY | VERIFIED_PRODUCT | SELLER_CONFIRMED | USER_SUPPLIED_UNVERIFIED | ESTIMATED | HYPOTHESIS",
  "source_ids": ["SRC-KEYWORD-001"],
  "evidence_ids": ["EVIDENCE-KEYWORD-001"],
  "objective": "core validation",
  "targeting_expression": "BROAD | PHRASE | EXACT",
  "proposed_bid": null,
  "bid_ceiling": null,
  "ceiling_basis": "TARGET_PROFIT | OPERATING_BREAK_EVEN | APPROVED_LEARNING_LOSS | UNAVAILABLE",
  "learning_loss_envelope_id": null,
  "negative_routing": [],
  "decision_reason": "..."
}
```

Keep `library_role`, upstream source/evidence IDs, original text, and any upstream eligibility/claim fields unchanged. Every upstream keyword row carries non-placeholder `keyword_original`, and every downstream keyword decision carries non-placeholder `keyword_original`, `intent`, and `objective` plus closed `product_fit= DIRECT | CONDITIONAL | WRONG`. Both `source_ids` and `evidence_ids` are non-empty arrays of meaningful strings; nulls, objects, arrays, and placeholders are invalid members. `ad_role` is a downstream decision, not a correction to the keyword library. Every included keyword target uses exactly one canonical positive match expression: `BROAD`, `PHRASE`, or `EXACT`; missing, placeholder, negative, object, and array values are invalid. The declared target `data_class` cannot outrank its semantically relevant cited artifacts: keyword evidence declares `KEYWORD_TARGET_EVIDENCE` and lists the exact `source_keyword_id` in `keyword_scope_ids`; product evidence declares `PRODUCT_TARGET_EVIDENCE` and lists the exact ASIN in `asin_scope_ids`. An unrelated first-party account, inventory, or economics source cannot elevate the target class.

The canonical preserved eligibility fields are `listing_indexing_eligible`, `front_end_copy_eligible`, `downstream_review_eligible`, `current_stage_eligible`, and `stage_eligibility_basis`. Eligibility flags are booleans or null; every supplied field must remain present downstream with the same value, including an explicit null, and cannot be upgraded. A controlled test of a review-only keyword requires upstream and downstream `downstream_review_eligible=true` plus the separate advertising review. An included `LATER_STAGE_RELEVANT` term requires upstream and downstream `current_stage_eligible=true` with identical canonical `stage_eligibility_basis`: `basis_type=CURRENT_OBSERVED_STAGE`, the matching context and current stage IDs, a timezone-aware evaluation after the current observation and no later than capture, and non-empty evidence IDs present in `operating_context.current_stage.evidence_ids`. An unknown evidence label or a planned phase cannot release it. Legacy `current_stage_evidence_ids` may remain only as an exact mirror of the canonical evidence list, with a warning; it is not an alternate release mechanism.

### Product target

```json
{
  "ad_target_id": "AT-ASIN-001",
  "asin": "B012345678",
  "competitor_source_role": "USER_SUPPLIED",
  "competitor_primary_role": "LAUNCH_PEER",
  "competitor_roles": ["LAUNCH_PEER", "DIRECT_PRICE_FORM"],
  "competitor_lock_status": "CORE_BENCHMARK",
  "source_order": 1,
  "ad_role": "PRODUCT_TARGET_TEST",
  "ad_decision": "INCLUDE | OBSERVE | EXCLUDE",
  "data_class": "FIRST_PARTY | VERIFIED_PRODUCT | SELLER_CONFIRMED | USER_SUPPLIED_UNVERIFIED | ESTIMATED | HYPOTHESIS",
  "price_rating_barrier_snapshot": {},
  "verified_advantage_fact_ids": [],
  "source_ids": ["SRC-COMPETITOR-001"],
  "evidence_ids": ["EVIDENCE-ASIN-001"],
  "proposed_bid": null,
  "bid_ceiling": null,
  "ceiling_basis": "...",
  "decision_reason": "..."
}
```

Preserve `source_role`, `primary_role`, `roles[]`, and `lock_status` as separate upstream axes. Preserve every supplied ASIN and its original order in the audit trail even when the ad decision is `OBSERVE` or `EXCLUDE`. Product-target `source_ids` and `evidence_ids` follow the same non-empty meaningful-string rule as keyword targets.

### Approved learning-loss envelope

```json
{
  "learning_loss_envelope_id": "LL-001",
  "scope_ad_target_ids": ["AT-KW-001"],
  "approved_by_user": true,
  "approved_at": "timezone-aware ISO-8601 timestamp",
  "approval_source_id": "SRC-APPROVAL-001",
  "maximum_incremental_loss": 50,
  "maximum_spend": 100,
  "data_or_time_gate": "...",
  "reason": "specific hypothesis",
  "stop_conditions": ["..."],
  "rollback_action": "..."
}
```

For an included target, both caps are positive, incremental loss does not exceed spend, the target bid/ceiling cannot exceed either total cap, and every referencing campaign's phase cap stays within `maximum_spend`. Approval time is timezone-aware, within 30 days, no later than package capture, and supported by the cited artifact time. Each learning campaign binds exactly one envelope and uses the validator-recomputed conservative model shown below; self-reported lower loss is invalid. Across all campaigns that reference the same envelope, the sum of campaign phase caps cannot exceed `maximum_spend`, and the sum of recomputed allocations cannot exceed `maximum_incremental_loss`. The approval artifact matches marketplace, currency, account, and an accepted budget-approval type.

### Campaign architecture row

```json
{
  "campaign_plan_id": "CP-001",
  "ad_product": "SPONSORED_PRODUCTS",
  "objective": "CONTROLLED_DISCOVERY",
  "targeting_type": "MANUAL_KEYWORD",
  "source_ad_target_ids": ["AT-KW-001"],
  "onsite_scope": "AMAZON_ONLY",
  "placement_scope_verified": "VERIFIED_CURRENT",
  "placement_policy_source_id": "SRC-OFFICIAL-PLACEMENT-001",
  "placement_account_source_id": "SRC-ACCOUNT-001",
  "placement_verified_at": "ISO-8601 timestamp",
  "budget_period": "DAILY | LIFETIME | OTHER_VERIFIED",
  "proposed_budget": null,
  "phase_spend_cap": null,
  "learning_loss_allocations": {"LL-001": null},
  "learning_loss_model": {
    "model_version": "CONSERVATIVE_FULL_SPEND_V1",
    "method": "CONSERVATIVE_FULL_SPEND",
    "formula": "modeled_loss_at_cap = phase_spend_cap",
    "modeled_spend_at_cap": null,
    "modeled_loss_at_cap": null,
    "source_ids": ["SRC-APPROVAL-001"]
  },
  "bid_strategy": "SALES_DOWN_ONLY",
  "entry_gates": ["GATE-ENTRY-001"],
  "exit_gates": ["GATE-EXIT-001"],
  "rollback_conditions": ["ROLLBACK-001"],
  "negative_routing_rule_ids": [],
  "evidence_ids": ["EVIDENCE-001"]
}
```

The campaign architecture row is a closed schema. Unknown fields, hidden delivery/reach/supply/inventory controls, or any nested value that enables or implies off-Amazon delivery fail closed. `campaign_plan_id`, objective, bid strategy, policy/account source IDs, and `evidence_ids` use meaningful non-placeholder strings. `entry_gates`, `exit_gates`, and `rollback_conditions` are non-empty arrays of meaningful control IDs or statements; evidence arrays cannot be filled with nulls, objects, or placeholders.

For Sponsored Products, new settings use the executor-supported canonical strategies `MANUAL`, `SALES_DOWN_ONLY`, or `SALES_UP_AND_DOWN`. Existing-product plans may describe preservation of an already verified `RULE_BASED` strategy; a manifest may preserve that current value unchanged or leave it for one of the three supported strategies, but cannot create it or change another value into it. These checks cover `bidStrategy`, `bidding.strategy`, and `dynamicBidding.strategy`; contradictory aliases and free-text instructions are invalid. SB/SD retain their separately verified product-specific strategy contract, not the SP enum. Placement and daypart instructions must not be hidden inside a strategy string.

The user requested Amazon onsite only. Sponsored Products itself is not proof of onsite scope: its reach may extend beyond Amazon unless the current account exposes and applies the Amazon-only control. Every campaign therefore needs both (a) an `official_policy` artifact scoped to the marketplace/ad product and (b) a first-party `amazon_ads_account_snapshot` scoped to the exact marketplace/account that explicitly records the selected ad product and its verified Amazon-only control, plus a verification timestamp. If either is missing, exclude that structure rather than calling it onsite. `placement_verified_at` must fall within the 24-hour package safety window.

`targeting_type` is a closed normalized planning value, not a guess about the current UI. The allowed combinations are: Sponsored Products = `MANUAL_KEYWORD | MANUAL_PRODUCT | AUTOMATIC`; Sponsored Brands = `MANUAL_KEYWORD | MANUAL_PRODUCT`; Sponsored Display = `MANUAL_PRODUCT | AUDIENCE | CONTEXTUAL_PRODUCT`. The exact feature and account eligibility still require current first-party/account and official-policy verification. `source_ad_target_ids` may reference only downstream `INCLUDE` rows; `OBSERVE` and `EXCLUDE` remain in the audit trail but cannot enter a campaign. Every included target has exactly one compatible campaign owner: `MANUAL_KEYWORD` accepts only keyword-target IDs; `MANUAL_PRODUCT` and `CONTEXTUAL_PRODUCT` accept only product-target IDs. Manifest keyword/negative-keyword operations bind only to `MANUAL_KEYWORD`; product/negative-product operations bind only to `MANUAL_PRODUCT` or `CONTEXTUAL_PRODUCT`; a generic `TARGET` carrying an ASIN/product expression follows the product rule. The current contract has no automatic-target or audience-target row schema, so `AUTOMATIC` and `AUDIENCE` cannot cite keyword/product IDs as fake executable definitions. Reusing the same target ID in multiple campaigns is invalid. If multiple target IDs represent the same `source_keyword_id`, an explicit `QUERY_ROUTING` or `MUTUAL_EXCLUSION` rule must cover every target and campaign owner.

### Routing rule

```json
{
  "routing_rule_id": "RR-001",
  "rule_type": "NEGATIVE_EXACT | NEGATIVE_PHRASE | NEGATIVE_PRODUCT | QUERY_ROUTING | MUTUAL_EXCLUSION",
  "source_ad_target_ids": ["AT-KW-001"],
  "applies_to_campaign_plan_ids": ["CP-001"],
  "evidence_ids": ["EVIDENCE-001"],
  "rationale": "Prevent overlap while preserving the chosen campaign owner"
}
```

Every routing rule has a non-placeholder stable ID, a supported rule type, a rationale, valid target IDs, valid campaign IDs, and evidence. A campaign's `negative_routing_rule_ids` may cite only rules whose `applies_to_campaign_plan_ids` includes that campaign.

## Phase, decision, and handback rows

### Phase row

```json
{
  "phase_id": "PH-001",
  "state": "PREPARED",
  "objective": "Verify readiness before traffic",
  "entry_gates": ["GATE-PHASE-ENTRY-001"],
  "planned_actions": ["ACTION-VERIFY-READINESS"],
  "data_sufficiency_rule_ids": ["DR-001"],
  "attribution_completion_requirement": "Verified current attribution contract",
  "phase_spend_cap": null,
  "inventory_floor": null,
  "exit_gates": ["GATE-PHASE-EXIT-001"],
  "rollback_conditions": ["ROLLBACK-HOLD-TRAFFIC"],
  "next_states": ["LEARNING"]
}
```

The phase schema and transition graph are closed and mode-specific:

```text
NEW_PRODUCT_LAUNCH:
PREPARED -> LEARNING -> VALIDATING -> SCALING -> TRANSITIONING

EXISTING_PRODUCT_OPTIMIZATION:
AUDITING -> DIAGNOSING -> TESTING -> SCALING -> TRANSITIONING
```

For a traffic-ready plan, include exactly one row for each of the selected mode's five states and no extras. Each nonterminal `next_states` contains only its single canonical successor; the terminal row uses an empty array. `planned_actions` is non-empty, while every entry/exit/rollback gate and data-sufficiency reference is a non-empty array whose members are meaningful non-placeholder strings. Unknown phase fields and any hidden off-Amazon/delivery-scope controls fail closed. Dates may be estimated for planning, but transitions depend on evidence gates rather than elapsed days alone.

### Decision rule

```json
{
  "decision_rule_id": "DR-001",
  "scope": "search term/target/campaign/placement/offer/inventory",
  "metric_definition": "...",
  "source_snapshot_ids": [],
  "attribution_requirement": "COMPLETE",
  "minimum_evidence": "...",
  "financial_ceiling": "...",
  "condition": "...",
  "proposed_action": "...",
  "rollback_condition": "..."
}
```

### Handback

```json
{
  "handback_id": "HB-001",
  "destination_skill": "write-amazon-listing",
  "root_cause_class": "LISTING | KEYWORD | COMPETITOR | PRODUCT_ECONOMICS | INVENTORY | COMPLIANCE",
  "diagnosis": "...",
  "source_ids": [],
  "evidence_ids": [],
  "requested_review": "...",
  "advertising_interim_action": "HOLD | REDUCE_EXPOSURE | OBSERVE | NONE",
  "status": "OPEN"
}
```

The advertising Skill does not rewrite or mutate the upstream artifact.

Current handback destinations are `write-amazon-listing`, `build-amazon-keyword-library`, `analyze-amazon-competitors`, `reconcile-amazon-profit`, `plan-amazon-replenishment`, `PRODUCT_LEVEL_USER_REVIEW`, and `EXTERNAL_OPERATIONAL_BLOCKER`. Use the profit and replenishment Skills for their existing operational scopes; use user review for product-level positioning, compliance, or continuation decisions outside those scopes. `select-amazon-products` is accepted with a deprecation warning only when auditing a historical `FULL_WORKFLOW` package with its actual selection lineage; it is invalid in new independent packages and does not authorize invoking selection.

## State and execution contract

The only legal deliverable/status combinations are:

```text
ECONOMICS_ONLY -> BLOCKED | PROVISIONAL | ECONOMICS_READY
PLAN           -> BLOCKED | PROVISIONAL | PLAN_READY
AUDIT          -> BLOCKED | PROVISIONAL
REFRESH        -> BLOCKED | PROVISIONAL | PLAN_READY
PREPARE_CHANGES-> BLOCKED | PROVISIONAL | READY_FOR_EXECUTION_REVIEW
EXECUTE        -> EXECUTION_AUTHORIZED
```

Authority is equally strict:

```text
PLAN_READY                 -> PLAN_ONLY
READY_FOR_EXECUTION_REVIEW -> PREPARE_CHANGES
EXECUTION_AUTHORIZED       -> EXECUTION_AUTHORIZED
```

`READY_FOR_EXECUTION_REVIEW` means the user can inspect an exact manifest; it is not mutation permission. A prepared operation remains `NOT_AUTHORIZED`. An authorized operation remains `NOT_STARTED` in the immutable manifest until the executor attempts it and writes results to a separate execution ledger.

Validator booleans are deliberately conservative: `plan_ready=true` only for `PLAN_READY`, and `execution_review_ready=true` only for `READY_FOR_EXECUTION_REVIEW`. For an `EXECUTION_AUTHORIZED` package, `authorization_record_structurally_valid=true` means only that the local authorization record passes the file-contract checks. The local validator always returns `execution_authorized=false`; when the structural record passes it also returns `trusted_external_grant_required=true`. Only a trusted executor that can authenticate the current user, re-read live state, and verify the exact fresh grant may authorize or perform the mutation.

Canonical prepared Amazon Ads operation:

```json
{
  "operation_id": "OP-001",
  "action": "CREATE | UPDATE | ENABLE | PAUSE | ARCHIVE | ADD_NEGATIVE | REMOVE_NEGATIVE",
  "change_domain": "AMAZON_ADS",
  "campaign_plan_id": "CP-001",
  "entity_type": "TARGET",
  "entity_id": "runtime-resolved stable ID",
  "payload_schema_version": "AMAZON_ADS_NORMALIZED_V1",
  "current_value": {"bid": 1.0},
  "proposed_value": {"bid": 1.2},
  "rollback_action": "...",
  "execution_status": "NOT_AUTHORIZED | NOT_STARTED",
  "prechange_snapshot_id": "SRC-ACCOUNT-001",
  "prechange_snapshot_hash": "sha256:...",
  "prechange_captured_at": "ISO-8601 timestamp",
  "onsite_scope_after": "AMAZON_ONLY",
  "placement_scope_effect": "UNCHANGED_AMAZON_ONLY | SET_AMAZON_ONLY",
  "amazon_only_control_before": true,
  "amazon_only_control_after": true
}
```

The executable domain is `AMAZON_ADS` only. Price/Coupon, Vine, and inventory remain separate planned ledgers/operational handoffs. The pre-change source must be a first-party `amazon_ads_account_snapshot`; its marketplace, account, stored canonical hash, and captured time must match the operation exactly, and the snapshot must be no more than one hour older than the package capture. Current and proposed payloads are non-empty JSON objects under the closed `AMAZON_ADS_NORMALIZED_V1` field vocabulary. Raw API payloads, generic `type/value/expression/predicate` discriminators, or unknown fields—including unknown reach, publisher, external-site, supply-source, or inventory-scope fields—fail closed. Every leaf also has a closed value contract: IDs/names are meaningful strings; money/bids/percentages are finite non-negative numbers rather than booleans; dates are ISO dates; states, match types, budget types, ad products, and targeting types use canonical enums; ASIN expressions use exact normalized shapes; and duplicate keys after case/punctuation normalization are invalid. Cross-field semantics are closed too: positive keywords use only positive match types; negative keywords use only negative match types; a product target chooses exactly one ASIN representation (`asin`, `asins`, or the applicable expression object), and an expression object—when chosen—contains exactly one predicate; `startDate <= endDate`; payload currency equals package currency; and `state` cannot contradict `status`. The action/entity matrix is closed: `UPDATE` supplies matching old/new fields but cannot change state/status, `adProduct`, or `targetingType`; use dedicated state actions, or rebuild and revalidate architecture for a targeting change. `ENABLE|PAUSE|ARCHIVE` changes only normalized state/status; `CREATE|ADD_NEGATIVE` begins from `ABSENT`; `REMOVE_NEGATIVE` uses a negative entity and ends at `REMOVED`. Entity-incompatible fields fail. A campaign `CREATE` must exactly match the audited campaign row's canonical `adProduct` and `targetingType`. Timestamps are timezone-aware ISO-8601 values.

For Amazon-only enforcement, first reject every field outside the closed normalized payload vocabulary, then deep-merge `current_value` and `proposed_value` and validate the resulting final state, not only the patch. Reject any snake_case or camelCase field that enables or implies off-Amazon reach. Every operation declares the exact boolean Amazon-only control before and after the change. If the before state is broader reach, `placement_scope_effect=SET_AMAZON_ONLY` and `proposed_value` must explicitly set the account's verified Amazon-only control; inheritance or omission is not sufficient.

The Amazon-only gate also scans every strategy-bearing zone—economics, inventory, onsite support, keyword/product targets, campaign/routing/phase/decision rows, review compliance, handbacks, and the change manifest—for structured off-Amazon or unknown delivery/reach/network/publisher/supply/inventory-scope controls. Moving the same instruction into a sibling object does not bypass the gate. Source metadata and explanatory gap text are not searched as free prose, avoiding false positives from a source that merely discusses the boundary.

Fresh exact authorization:

```json
{
  "user_confirmed": true,
  "confirmed_at": "ISO-8601 timestamp",
  "account_id_masked": "...",
  "marketplace": "US",
  "manifest_hash": "sha256 of canonical complete change_manifest",
  "prechange_snapshot_hash": "sha256:...",
  "allowed_operation_ids": ["OP-001"]
}
```

The allowed operation-ID set must equal the complete manifest operation-ID set, with no subset or extras. The account, marketplace, canonical manifest hash, and pre-change snapshot hash must all match. `confirmed_at` must occur after the cited pre-change snapshot by no more than one hour and must itself be no more than one hour old at validation runtime. Any edit or newer conflicting live state invalidates the record. This local record proves only structural consistency; it never authenticates the user or grants live execution authority.

## Readiness integrity rules

- A traffic-ready package was captured within 24 hours of validation runtime, has a non-placeholder account identity, and uses non-placeholder stable IDs for targets, campaigns, phases, rules, operations, and referenced account entities. A `FULL_WORKFLOW` package repeats exact `project_id`, `candidate_id`, and matching stage run/version IDs inside every upstream snapshot; the Listing path and timezone-aware capture timestamp are present and valid.
- A ready new-product plan has exactly one canonical pessimistic/base/optimistic scenario, one permitted binding scenario, real ASIN and SKU, the exact new-product phase graph, verified inventory sources, and a verified READY Listing. A ready existing-product plan uses the separate exact existing-product phase graph. Common and scenario economics inputs cite semantically compatible evidence domains and scope; `HIGH` confidence covers both scenario domains with authoritative evidence; `ACTUAL` uses exact-scope first-party Amazon evidence; target/break-even CPC and target/operating/all-in ACoS tolerance is monotonic from pessimistic through optimistic.
- A ready existing-product plan cites complete first-party Amazon Ads performance artifacts from the same account and exact ASIN/SKU, with both row and source capture inside the 24-hour safety window, and reconciles the calculator's actual impressions, clicks, orders, spend, and attributed sales to them. Report dates parse, order correctly, are not future-dated, and every cited row and decision-rule source matches the declared ad product, CPC charge, CLICK interaction, PROMOTED sales, entity scope, attribution window, marketplace, currency, and exact campaign ad-product set.
- Every upstream keyword appears downstream and keeps the same `library_role`, source/evidence IDs, and supplied eligibility fields. Every locked competitor keeps `source_role`, `primary_role`, `roles[]`, `lock_status`, and unique `source_order`; every locked ASIN appears in the downstream audit trail, including `OBSERVE` and `EXCLUDE` rows.
- All strategy-bearing zones reject structured off-Amazon or unknown delivery/reach controls even when moved outside campaign/phase rows. Campaign and phase rows use only their closed fields and contain meaningful gate/action/evidence members. Keyword text/intent/objective/product-fit and every target source/evidence member pass their content/type contract. `TARGET_PROFIT` and `OPERATING_BREAK_EVEN` target ceilings cannot exceed the binding calculator CPC. `APPROVED_LEARNING_LOSS` requires a positive, current, artifact-supported envelope bound to the exact target and one campaign; `CONSERVATIVE_FULL_SPEND_V1` recomputes modeled spend, worst-case loss, and allocation as the full phase cap before aggregate checks. Every included target and manifest target operation has one exact type-compatible campaign owner. `UNAVAILABLE` cannot authorize an included target.
- `approved_cash_exposure`, `strategy_total_spend_cap`, and inventory values cite current, semantically correct `FIRST_PARTY` or `SELLER_CONFIRMED` artifacts from the same marketplace/account; approval sources also match currency.
- Policy verification and every cited official/approval source must be within 30 days; account eligibility/placement and inventory sources must be within 24 hours of the strategy capture under the validator's internal safety windows. Prepared changes require a first-party pre-change snapshot within one hour of package capture; an execution record additionally requires authorization after that snapshot and within one hour of validation runtime.
- Traffic readiness requires Featured Offer/current-equivalent `ELIGIBLE`, or `NOT_REQUIRED_VERIFIED` backed by a current official exception covering every selected ad product. Active Request a Review support is native-only and bound to current first-party eligibility proof for every declared order scope.
- Binding onsite support reconciles effective price, currency, tax basis, every Coupon/deal discount and fee, all five cost ledgers, Vine method/eligibility/units/costs, and all three explicit non-null reserved-inventory breakdown fields to the binding calculator input. Package inventory reconciles to the binding economics input. Planned launch orders fit advertising-available units; phase floors preserve safety stock; `HIGH` or `UNKNOWN` stockout risk is not traffic-ready.
- Missing real values remain `null` and produce explicit gaps in `PROVISIONAL`; do not fill fake stable IDs, cash approval, inventory, or source records to satisfy shape checks.

## Workbook and Stage 5 handoff

The workbook mirrors the JSON IDs, roles, formulas, source coverage, and gaps. Keep formula cells separate from supplied inputs and show whether each number is first-party, seller-confirmed, official-fee, estimated, proxy, or hypothetical.

`promotion_state.json` records observed execution without overwriting the plan:

```text
promotion_run_id
ad_strategy_run_id
ad_strategy_version_id
current_phase
account_snapshot_id
performance_snapshot_ids
applied_change_ids
unapplied_change_ids
spend_and_loss_state
inventory_state
open_handbacks
next_review_gate
```

`promotion_handoff.json` for Stage 5 preserves the same lineage and reports whether each exit criterion is `MET`, `NOT_MET`, `UNKNOWN`, or `NOT_APPLICABLE`. Stage 4 can document the evidence; it must not claim that promotion succeeded merely because the planned calendar ended.
