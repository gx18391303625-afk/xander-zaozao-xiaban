# Policy, permissions, and onsite support

Treat this file as a source hierarchy and dated baseline, not permanent policy. Reverify current official sources and actual account state for every execution-ready plan.

Baseline checked: **2026-08-23**.

## Contents

1. Official-source hierarchy
2. Runtime policy and account snapshot
3. Amazon-only placement gate
4. Ad products and eligibility
5. Attribution and reporting
6. Review, Vine, and customer communication
7. Price, Coupon, and promotion support
8. Live-action authorization

## Official-source hierarchy

Use sources in this order:

1. current signed-in Amazon Ads/Seller Central account state and official help for the exact marketplace/account;
2. current Amazon Ads, Seller Central, or sell.amazon.com official documentation;
3. user-supplied account exports, fee records, invoices, and eligibility messages;
4. Amazon official community-manager clarifications when primary help is unavailable;
5. third-party tools and articles only as estimates or hypotheses.

Record scope, source URL/artifact ID, verification date, effective date when stated, and conflict status. An older screenshot or third-party recommendation cannot override the current account.

## Runtime policy and account snapshot

Capture:

```yaml
verified_at:
marketplace:
account_id_masked:
seller_or_vendor:
brand_registry_state:
advertised_asin_sku_offer:
ad_products:
  sponsored_products:
  sponsored_brands:
  display_ads_or_current_name:
amazon_only_placement_controls:
featured_offer_or_current_equivalent:
inventory_and_listing_eligibility:
budget_and_bidding_controls:
reporting_and_attribution:
coupon_or_deal_eligibility_and_fees:
vine_eligibility_and_fees:
request_a_review_current_native_rule:
official_sources: []
unverified_boundaries: []
```

Three execution-critical gates are required:

```text
placement_scope_verified = VERIFIED_CURRENT
attribution_schema_verified = VERIFIED_CURRENT
review_method_compliance_verified = VERIFIED_CURRENT
```

The machine package cites both official-policy and first-party account artifacts. Official artifacts collectively declare coverage for `PLACEMENT_SCOPE`, `ATTRIBUTION_SCHEMA`, and `REVIEW_METHOD_COMPLIANCE`; one unrelated policy page cannot stand in for all three gates.

Traffic readiness also resolves the current Featured Offer/current-equivalent requirement explicitly. Use `ELIGIBLE` when the exact offer is eligible. Use `NOT_REQUIRED_VERIFIED` only when a current official-policy artifact declares `FEATURED_OFFER_REQUIREMENT` and its `ad_products[]` covers every selected ad product. `UNKNOWN`, `INELIGIBLE`, or an unscoped exception remains blocked.

If any selected component lacks its applicable current verification, lower the plan to `PROVISIONAL` or exclude that component. Do not relabel uncertainty as a conservative setting.

The package validator applies internal freshness safeguards: policy and approval artifacts within 30 days; account eligibility/placement plus inventory artifacts within 24 hours of strategy capture; and the traffic-ready package itself within 24 hours of validation runtime. A prepared operation's first-party pre-change snapshot must be within one hour of package capture. An execution record must follow that snapshot by no more than one hour and must itself be no more than one hour old at validation runtime. These are conservative workflow controls, not Amazon-stated universal windows. Reverify sooner after any relevant policy, interface, account, offer, or eligibility change.

## Amazon-only placement gate

The user authorized Amazon onsite advertising only.

Current official Sponsored Products help states that reach can extend beyond Amazon and provides a `Limit reach to Amazon` control; the default or availability can change by marketplace/account. Verify and select the current Amazon-only option for every included structure. Do not assume Sponsored Products is automatically onsite-only.

- [Amazon Ads: Sponsored Products reach controls](https://advertising.amazon.com/help/GYTD2Z3SYMAAMVXA)

Display formats may serve on and off Amazon. Include Display only when the current account exposes a verifiable Amazon-only configuration for the exact tactic. Otherwise exclude it. Apply the same rule to any current or future ad format that can extend off Amazon.

- [Amazon Ads: Display placements](https://advertising.amazon.com/help/GPKPWTLW6B8T683N)
- [Amazon Ads: Display ads](https://advertising.amazon.com/products/display-ads)

Every campaign architecture row records:

```text
onsite_scope = AMAZON_ONLY
placement_scope_verified = VERIFIED_CURRENT
placement_policy_source_id = current OFFICIAL_POLICY artifact for this marketplace/ad product
placement_account_source_id = current FIRST_PARTY account artifact for this marketplace/account
placement_verified_at
```

The campaign row itself is closed: unknown fields, nested off-Amazon values, and unrecognized reach, publisher, supply-source, or inventory-scope controls fail closed. Stable IDs and evidence members are meaningful non-placeholder strings; entry, exit, and rollback gate arrays are non-empty. Do not hide delivery scope in a note or extension field.

For a prepared operation, record `amazon_only_control_before` and `amazon_only_control_after` as exact booleans. Normalize both current and proposed values as non-empty JSON objects under `payload_schema_version=AMAZON_ADS_NORMALIZED_V1`; unknown fields and generic raw discriminators fail closed, including unknown reach, external-site, publisher-network, supply-source, and inventory-scope paths. Enforce the closed action/entity and cross-field semantics before authorization: positive/negative match types cannot cross; a product target chooses exactly one ASIN representation, and only an expression object must contain exactly one predicate; dates are ordered; currency matches the package; and state/status cannot conflict. State changes use dedicated actions; campaign `adProduct` and `targetingType` are create-only in a manifest, and a create must exactly match the audited campaign row. Every keyword/product operation must match that row's targeting kind. Deep-merge the stored current state with the proposed patch and validate the final state; checking only changed keys is insufficient. Reject snake_case or camelCase fields that enable or imply off-Amazon reach. Apply the same structured-field scan across every strategy-bearing sibling zone so moving a delivery/reach/network instruction outside the campaign row cannot bypass Amazon-only scope. When the before state is broader reach, the proposed payload must explicitly set the current account's verified Amazon-only control and declare `placement_scope_effect=SET_AMAZON_ONLY`.

## Ad products and eligibility

Never infer eligibility from the existence of a UI label or another marketplace.

### Sponsored Products

Verify current seller/account, product/category, Listing, inventory, offer, marketplace, and placement-scope requirements.

- [Sponsored Products eligibility](https://advertising.amazon.com/help/GMJYF5GN8RNYB6HD)
- [Sponsored Products overview](https://advertising.amazon.com/solutions/products/sponsored-products)
- [Featured Offer eligibility](https://advertising.amazon.com/help/GYVDGT5WNNW23LJ5)

### Sponsored Brands

Verify current professional seller/vendor, Brand Registry, marketplace, product, creative, landing destination, and feature requirements.

- [Sponsored Brands eligibility](https://advertising.amazon.com/help/G5DAD7ZM3N639QF4)
- [Sponsored Brands overview](https://advertising.amazon.com/solutions/products/sponsored-brands)

### Display Ads / Sponsored Display

Amazon product names, interfaces, charge types, targeting, and eligibility evolve. Inspect the current account and documentation; do not hardcode legacy Sponsored Display behavior.

- [Display eligibility](https://advertising.amazon.com/help/GBLW5Z48RQHEDCW5)
- [Display ads product page](https://advertising.amazon.com/products/display-ads)

Keep Sponsored Products as the normal first consideration, not an obligation. A product that cannot pass current eligibility remains blocked regardless of its forecast.

## Attribution and reporting

Amazon Ads defines:

```text
ACoS = ad spend / ad-attributed sales
ROAS = ad-attributed sales / ad spend
```

There is no universal good ACoS; connect the target to the product's contribution and objective.

- [Amazon Ads: ACoS and ROAS](https://advertising.amazon.com/library/guides/acos-advertising-cost-of-sales)

Attribution rules, conversion delay, interaction type, sales scope, and field availability vary. Before analysis, record:

```text
report_generated_at
data_through_date
ad product
seller/vendor type
charge type
attribution window
click/view/mixed interaction scope
promoted/halo/combined sales scope
marketplace
currency
```

Do not treat today's or yesterday's missing conversions as final when the verified window remains open. Conversions may be backfilled against the interaction date. Do not mix promoted and halo economics without item-level contribution mapping.

- [Amazon Ads: attribution rules](https://advertising.amazon.com/help/GX7KDKHMWQYMJ385)
- [Amazon Ads: ACoS data timing](https://advertising.amazon.com/help/G96BDERJLNQGW2Y3)
- [Amazon Ads: reporting and promoted/halo scope](https://advertising.amazon.com/help/GMH8A8AJSH4ATV6T)
- [Amazon Ads: campaign reporting and attribution](https://advertising.amazon.com/library/guides/intro-attribution-campaign-reporting)

### Intraday delivery and zero-data diagnosis

Treat an empty or zeroed Campaign Manager view as an observation about the visible report surface, not immediate proof that the campaign received no traffic. Reverify the current official data-population and troubleshooting guidance, record whether the campaign is live/delivering, and record both the report's `data_through` time and the account timezone before interpreting elapsed hours.

- Preserve `launch_at_utc`, `launch_at_account_local`, `account_timezone`, and the exact local observation window. A few wall-clock hours that mostly cover the account's overnight period are weak evidence of insufficient bids.
- Separate four states: live entities with metrics not yet populated; verified zero impressions; impressions with zero clicks; and clicks with zero orders. They have different likely causes and must not share one automatic bid action.
- A no-impression hour threshold is a diagnostic-review gate only. Before proposing a bid change, rule out report delay or service incidents, campaign/product-ad eligibility, offer and inventory drift, budget exhaustion, targeting or relevance problems, negative-routing conflicts, and an unrepresentative local-time window.
- Use first-party hourly campaign data such as an eligible hourly Campaign report or Amazon Marketing Stream, and exact-ASIN retail traffic such as Rapid Retail Analytics when the account is subscribed. An ordinary Ads API or SP-API connection does not prove that either stream has been configured.
- Do not claim access to Amazon-wide real-time shopper counts or total search traffic unless Amazon exposes and the account actually provides that exact dataset. Own-campaign and own-ASIN hourly metrics are not sitewide traffic; frontend ad density is qualitative context only.
- If evidence supports a bid test, isolate the affected target, keep the step bounded by economics and approved exposure, and preserve a rollback window. Never raise a portfolio merely because a new campaign shows zero data for a few hours. A monitoring rule or read-only automation does not authorize the write.

Current official starting points; reverify them at runtime:

- [Amazon Ads: Create a Sponsored Products campaign](https://advertising.amazon.com/help/GKLSYGFS2YD33FER)
- [Amazon Ads: Troubleshoot your campaign for impressions](https://advertising.amazon.com/help/G8WCYU3FQKFVSMR4)
- [Amazon Ads: Sponsored Products campaign report](https://advertising.amazon.com/help/G4KJE82E7LDKAHZX)
- [Amazon Marketing Stream](https://advertising.amazon.com/solutions/products/amazon-marketing-stream)
- [Rapid Retail Analytics](https://advertising.amazon.com/measurement-analytics/rapid-retail-analytics)

Amazon budgets and suggested bids are delivery inputs, not profit authorization. A daily budget may be consumed unevenly and is not the same as a phase or total loss cap. Reverify current budget behavior and any overdelivery rule at runtime.

- [Sponsored Products budget guidance](https://advertising.amazon.com/library/guides/sponsored-products-budget-best-practices)

## Review, Vine, and customer communication

Advertising strategy may coordinate compliant review support, but it cannot promise reviews or alter their outcome.

Block:

- seller, employee, family, friend, agent, or related-party reviews of the seller's or competitor's product;
- payment, discount, free product outside an authorized program, refund, reimbursement, rebate, or other compensation for a review;
- requests for a positive review or a specific star rating;
- review gating, routing unhappy customers away from Amazon, or contacting only satisfied buyers;
- requests to remove, revise, or condition issue resolution on changing a negative review;
- package inserts, third-party services, groups, messages, or off-platform contact that bypass the policy;
- competitor review manipulation or sabotage.

- [Amazon Customer Product Reviews Policies](https://sellercentral.amazon.com/help/hub/reference/GYRKB5RU3FS5TURN)
- [Amazon Communication Guidelines](https://sellercentral.amazon.com/help/hub/reference/G1701)

### Request a Review

Use only the current native Amazon capability, standardized language, and eligible window exposed in the account. Do not hardcode a day range: Amazon materials have differed over time, and the current account is authoritative. Do not generate a custom persuasive review message.

Use the closed native-only package shape:

```yaml
eligibility: NOT_USED | VERIFIED_ELIGIBLE | RUNTIME_VERIFICATION_REQUIRED | INELIGIBLE
native_method: null | AMAZON_REQUEST_A_REVIEW
source_artifact_ids: []
eligible_order_scope_ids: []
```

If `REQUEST_A_REVIEW` is active, the method and `VERIFIED_ELIGIBLE` state are mandatory. Every declared eligible order scope must be covered by a first-party `amazon_request_review_eligibility_snapshot` or `amazon_order_eligibility_snapshot` captured within the package's 24-hour account-snapshot safety window, from the same marketplace, account, and ASIN/SKU, carrying `REQUEST_REVIEW_ELIGIBILITY`. No custom channel, copy, incentive, selector, or extra field belongs in this object. Without that chain, use `RUNTIME_VERIFICATION_REQUIRED` or `NOT_USED`; do not call the action eligible or executable.

- [Amazon: Request a Review](https://sellercentral.amazon.com/help/hub/reference/698QJEQJZFEXSAT)

### Vine

Verify current marketplace, Brand Registry/account, product, review-count/offer, inventory, variation, fee, unit, and cancellation eligibility. Vine Voices give independent opinions; do not call Vine a positive-review purchase.

Keep separate:

```text
Vine enrollment/current fee
units reserved/supplied
landed product cost
fulfillment or other nonrecoverable cost
inventory and cash impact
actual reviews observed, without outcome guarantee
```

For binding economics, record `economics_application`, current eligibility, `planned_units`, `reserved_units`, enrollment fee, unit landed cost, unit fulfillment cost, and source IDs. If modeled Vine units are positive, `review_compliance.methods` includes `VINE`, eligibility is `VERIFIED_ELIGIBLE`, planned units and every cost equal the calculator inputs, and dedicated Vine reserve is at least the planned units. Traffic-ready inventory supplies explicit non-negative values for `reserved_breakdown.vine_units`, `other_locked_units`, and `other_reserved_units`; their sum equals total reserved inventory and reconciles to the binding model. A future or unverified Vine idea stays `PLANNED_NOT_IN_BINDING` and cannot release a traffic-ready plan.

- [Amazon Vine](https://sell.amazon.com/programs/vine)

## Price, Coupon, and promotion support

Verify current eligibility, fee, duration, budget, redemption, display, and stacking rules in the target marketplace/account.

- Seller-funded discount reduces transaction revenue.
- Coupon/deal variable and fixed fees remain separate from PPC spend.
- Do not count the same discount in both price and Coupon inputs.
- Record a no-promotion baseline and every effective-date change.
- A promotion can support conversion but cannot make an economically negative offer viable by definition.

For binding support:

```text
effective_price
  = selling_price
    - seller_funded_discount
    - coupon_discount_per_order
    - other_seller_funded_discount
```

Effective price currency and tax basis must match the binding calculator. Every Coupon/deal row records its status, economics application, economic discount per modeled order, per-order fee, fixed fee, planned redemptions, and source IDs. Aggregate binding rows must equal the corresponding calculator discount and fee fields. If only a share of orders is expected to redeem, use `face discount × expected redemption share`; do not charge the face value to every modeled order. Reconcile PPC, price discount, Coupon/deal, Vine, and inventory/cash as five separate ledgers in both directions.

Do not hardcode Coupon/Vine/ad fees or reuse another marketplace's values.

## Live-action authorization

For an existing campaign, ad group, keyword or target, a supported non-state optimization may preserve either `ENABLED` or `PAUSED`; do not impose `PAUSED` on the parent as a universal prerequisite. Bind the observed parent/child states and exact ownership to the pre-change snapshot, preserve unapproved fields, and verify both values and states afterward. A local paused-launch executor must not be reused by first pausing a live campaign. If the exact field/ad-product operation is unsupported, report that capability gap without claiming a platform-wide pause requirement. This rule does not authorize a status transition, new entity, larger spend scope or reuse of a historical approval.

Default state:

```json
{
  "account_access": "READ_ONLY",
  "write_authorization": "NOT_GRANTED",
  "execution_status": "NOT_AUTHORIZED"
}
```

Approval to create this Skill, calculate economics, audit reports, inspect an account, or prepare a plan is not live-write authorization.

Keep the states distinct:

```text
PLAN_READY                    -> PLAN_ONLY; no mutation permission
READY_FOR_EXECUTION_REVIEW    -> PREPARE_CHANGES; operations remain NOT_AUTHORIZED
EXECUTION_AUTHORIZED          -> EXECUTE only; every operation remains NOT_STARTED until applied
```

Each prepared Amazon Ads operation must include its exact operation ID, allowed action, campaign-plan ID, entity type/ID, `AMAZON_ADS_NORMALIZED_V1` payload version, non-empty closed-schema current value, non-empty closed-schema proposed value, rollback action, current first-party Amazon Ads account snapshot ID/hash/time, exact Amazon-only control before/after states, and proof that the merged post-change state remains `AMAZON_ONLY`. Payload fields, leaves, cross-field combinations, and campaign ownership are closed: normalized duplicate keys, wrong JSON types, positive/negative match crossover, contradictory product expressions, reversed dates, currency mismatch, contradictory state/status, entity-incompatible fields, and a target kind that disagrees with the audited campaign all fail closed. Campaign `adProduct`/`targetingType` changes require rebuilding and revalidating the architecture rather than an `UPDATE`. The authorization record must bind the account, marketplace, canonical manifest hash, exact set of all operation IDs, and the same pre-change snapshot hash. Its confirmation timestamp must follow that snapshot by no more than one hour and be within the runtime safety window. A partial operation list does not authorize the manifest.

The local validator can confirm only that this record is structurally consistent. It deliberately returns `execution_authorized=false`; it cannot authenticate who granted the record or confer live authority. A trusted external executor must independently verify the current user grant, re-read live state, and confirm no manifest or snapshot drift immediately before any mutation.

This Skill's executable manifest supports `AMAZON_ADS` only. Price/Coupon, Vine, and inventory are coordinated in separate ledgers and operational handoffs; their live mutation is not inherited from an Amazon Ads authorization.

Immediately before mutation:

1. read the current live account and resolve exact IDs;
2. show the user account/marketplace, object IDs/names, current values, proposed values, action order, expected scope, and rollback plan;
3. bind the current explicit instruction or approval to that exact manifest; ask only when scope is missing, materially changed or expired, and obtain final confirmation after showing the exact consequences of irreversible archive/delete actions;
4. apply only approved items;
5. stop on identity conflict, unapproved expansion, unexpected interface state, or material price/eligibility/policy change;
6. verify post-change state and record applied/failed/skipped items separately.

Never delete, archive, pause, create, change budgets/bids/placements, or edit negatives merely because the plan validator passes.
