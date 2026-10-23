# Existing-product optimization mode

Use this reference only for `EXISTING_PRODUCT_OPTIMIZATION`. Preserve working account structure and original Amazon entity IDs. Diagnose before proposing changes; do not rebuild an account from campaign names or aggregate screenshots.

For a narrow read-only memo, apply the evidence, scope and diagnostic guidance relevant to the question. The phase graph, full-plan output and exact change-manifest requirements below apply when that deliverable is requested; they do not turn a diagnostic question into change preparation. Follow the narrow-review route in [SKILL.md](../SKILL.md), without claiming full-package readiness.

## 1. Minimum evidence

A precise optimization plan requires source-qualified first-party data appropriate to the requested scope. Gather as available:

- campaign, ad group, advertised product, target, search term, placement, budget, and change-history reports or API data;
- Amazon retail traffic and total sales/orders for TACoS and conversion context;
- current and comparison windows;
- campaign, ad group, target, negative, portfolio, SKU, and ASIN IDs—not names alone;
- ad product, charge type, attribution window, interaction type, promoted/halo sales scope, report-generated time, and data-through date;
- price, Coupon/deal, Listing, rating/review, inventory, Featured Offer/Buy Box, suppression, and operational events aligned to the windows;
- current fees, unit economics, returns/losses, and cash/inventory constraints.
- compatible Brand Analytics Search Query Performance and Search Terms periods when the review assesses keyword ownership or link-promotion maturity.

If only screenshots or unsourced totals exist, produce a limited audit and request exports. Do not fabricate target-level optimization.

For `PLAN_READY`, every binding performance snapshot and its referenced `amazon_ads_report`/`amazon_ads_api_snapshot` artifact must be `FIRST_PARTY`, exact-account/marketplace/currency/ASIN-or-SKU scoped, captured/generated within the validator's 24-hour safety window, attribution-complete, and contain impressions, clicks, orders, spend, and attributed sales. Declare `economics.performance_basis` with the exact ad-product set, charge type, interaction scope, sales scope, canonical entity scope (`campaign | ad_group | target | search_term | placement | advertised_product`), and attribution window. The exact attribution-window label appears in both cited report/API metadata and a current official attribution-policy artifact. Every cited row and every decision-rule source must match that basis and the campaign architecture's exact ad-product set. The bundled actual CPC/CVR calculator supports only `CPC + CLICK + PROMOTED`; incompatible diagnostics or bases require a separate provisional package or auditable normalization/model. The calculator's advertising actuals reconcile to cited Ads snapshots. Optional total-sales and contribution actuals separately reconcile to an exact-period Amazon Business Report and one auditable normalization value per contribution field. That normalization declares a formula and unique derived source IDs; attributed contribution must include the binding Ads source, total contribution must include the reconciled Business Report, and both require exact-period current product-cost evidence matching marketplace, currency, account, ASIN/SKU, window, data-through date, class, and freshness. Otherwise those fields and their TACoS/contribution ratios remain null without blocking the rest of an evidence-complete ad plan.

Parse and validate `window_start`, `window_end`, `data_through_date`, and `report_generated_at`: the window must be ordered, data-through must fall within the supported reporting period, and no report or data-through date may be in the future. A `FIRST_PARTY` label without compatible dates, scope, and source artifact semantics is insufficient.

Every `coverage_gaps` row is structured with `domain`, `status`, `readiness_impact`, and known `source_ids`. `UNRESOLVED`, `BLOCKING`, or free-text coverage gaps prevent `PLAN_READY`; an accepted non-blocking gap stays explicit and source-linked.

## 2. Preserve and reconcile scope

Never merge or compare incompatible data silently:

- marketplace or currency;
- parent, child, SKU, offer, or portfolio;
- ad product or charge type;
- click, view, or mixed attribution;
- promoted-product, halo, or combined sales;
- attribution window or incomplete data-through date;
- performance-basis or exact campaign ad-product-set mismatch;
- materially different price, promotion, inventory, Listing, rating, or season.

Keep raw exports immutable. Create normalized tables with source-row IDs and a manifest. Record duplicates, missing pages/entities, filters, timezone conversions, and exclusions.

Campaign names are labels, not stable identity. Preserve Amazon object IDs and the last-known state for every proposed change.

## 3. Diagnose in layers

Use a funnel/economics diagnosis instead of treating ACoS as the only symptom.

### Eligibility and delivery

Questions:

- Is the advertised offer eligible, active, in stock, and able to win the current required offer state?
- Is the selected ad product and Amazon-only placement scope verified?
- Are campaigns constrained by budget, bid, policy, category, account, or target eligibility?
- Are reports complete enough to distinguish no delivery from delayed/partial data?

Do not fix an eligibility problem by increasing bids.

### Impression to click

Consider:

- query/target relevance and intent;
- main image, title, price, promotion, rating, ratings count, delivery promise, and competitive context;
- placement mix and ad format;
- impression quality rather than volume alone.

Low CTR can be an offer/creative/competitive problem. Create an upstream or operational handback when warranted; do not assume the bid is the cause.

### Click to order

Consider:

- search-term intent and target context;
- Listing/variation accuracy, conversion assets, price/pack, rating barrier, delivery, availability, and reviews;
- attribution completeness and sufficient evidence;
- new versus returning/halo scope where applicable.

Clicks without orders do not automatically justify a negative. The query may be relevant but the offer may fail to convert.

### Order to contribution

Reconcile:

- actual price/discount and Coupon/deal costs;
- ad spend and promoted-product attributed sales;
- fees, landed cost, returns/losses, and fixed support allocation;
- target-profit and break-even ceilings;
- halo/other-attributed sales separately.

A low ACoS campaign can still be all-in unprofitable; a higher ACoS experiment can be acceptable only inside a visible approved learning-loss envelope.

### Portfolio and total-sales context

Use TACoS, organic/total sales, brand/query data, and repeated-purchase context as diagnostics. Do not claim incrementality or causality from correlation alone. Separate defense from acquisition so branded efficiency does not mask weak prospecting.

When assessing whether promotion is building durable query position, read [keyword-share-and-link-maturity.md](keyword-share-and-link-maturity.md). Include the own ASIN's impression/click/cart-add/purchase shares and the market's top-three clicked ASIN context when available. Keep this layer distinct from Ads-attributed performance; absence from the reported top three is not zero share.

## 4. Root-cause classification

Assign one primary classification and evidence:

```text
ADVERTISING_PRIMARY
MIXED
NON_AD_PRIMARY
INSUFFICIENT_DATA
```

Possible advertising-primary causes include:

- uncontrolled target overlap;
- budget trapped in low-priority objectives;
- bids outside the approved economics envelope;
- poor query harvesting/isolation;
- unsupported target expansion;
- missing negative routing after sufficient evidence;
- placement or ad-format mix inconsistent with the objective.

Possible non-advertising causes include:

- negative unit economics or promotion cost;
- Listing/variation mismatch;
- price, rating, ratings-count, delivery, or competitor barrier;
- inventory, offer eligibility, suppression, or compliance;
- weak product-market fit or returns/quality issue.

Do not force every diagnosis into an advertising action.

## 5. Evidence-linked decisions

For every campaign, target, search term, placement, budget, or bid recommendation record:

```text
Amazon object ID
current value/state
proposed value/state
objective
source snapshot IDs
attribution status
minimum evidence rule
economics ceiling
reason
expected observation
rollback condition
execution status
```

Use decision labels that do not imply execution:

```text
KEEP
OBSERVE
CREATE_PROPOSAL
CHANGE_PROPOSAL
PAUSE_PROPOSAL
ARCHIVE_REVIEW_ONLY
HAND_BACK
```

Do not propose deletion when pause/archival review preserves recoverability. Never mark a proposal `APPLIED` without reading the post-change live state and recording the resulting object IDs/settings.

## 6. Search-term and negative routing

Search-term decisions require query-level first-party evidence and context.

- Preserve the original query, target, campaign/ad group, match/targeting context, marketplace, window, and report row/source ID.
- Distinguish an exact irrelevant query from a relevant token embedded in other phrases.
- Do not automatically negate every poor-converting query, `WRONG_INTENT` research row, or competitor brand.
- Check whether the failure is relevance, offer conversion, evidence quantity, attribution, or economics.
- Before moving/isolating a query, define its destination owner and negative routing to avoid uncontrolled duplication.
- Keep negative phrase/exact semantics aligned with the current supported interface and verify them at runtime.

## 7. Bids, budgets, and placements

Anchor bids to the current economics model and observed CVR. Amazon suggestions are delivery estimates, not profit ceilings.

- If the target-profit CPC is available, use it as the normal ceiling.
- If only the operating break-even CPC is available, expose the missing profit buffer.
- If a proposal exceeds break-even, require a user-approved learning-loss envelope.
- Separate daily budget, phase spend cap, total strategy cap, and cash reserve.
- Do not increase budget merely because it was exhausted; determine whether profitable/evidence-worthy demand was actually constrained.
- Do not lower bids mechanically across a campaign when targets have different CVR, intent, placement, or economics.
- Compare placement results only under compatible attribution and event context.
- For joint placement/rank/competitor questions, apply [placement-and-competitor-cross-diagnosis.md](placement-and-competitor-cross-diagnosis.md). Preserve native dimensions; same-campaign placement and query/target reports do not establish their joint distribution. Use genuine native joint reports only at their supported grain.
- Treat `HIGH` or `UNKNOWN` stockout risk as not traffic-ready; do not release positive exposure merely because historical ads were profitable.

### Placement completeness gate for a comprehensive review

A deliverable may be labeled a complete or comprehensive existing-product advertising review only after every in-scope campaign passes this gate. This is an analysis and delivery requirement, not authorization to change a bid, budget, placement, negative, or state. If the applicable ad product, account surface, or report does not expose a required field, keep the campaign row and record `NOT_APPLICABLE` or `UNAVAILABLE` with the reason and source gap; never omit the field or infer zero.

For every in-scope campaign, record:

- the current placement adjustment for `TOP_OF_SEARCH`, `REST_OF_SEARCH`, and `PRODUCT_PAGES`, preserving Amazon's source labels and the current API/UI value; where a placement is not adjustable for that campaign type, mark it explicitly rather than silently treating it as 0%;
- for each of those three placements where supported: impressions, clicks, spend, CTR, CPC, CVR, orders, attributed sales, and ACoS, together with the reporting window, attribution status, and source snapshot ID; preserve unmapped/mixed and off-Amazon labels separately, and reconcile placement totals to same-scope campaign totals with visible discrepancies;
- one explicit placement decision per placement: `KEEP`, `OBSERVE`, or `CHANGE_PROPOSAL`; use `KEEP` when no adjustment is recommended instead of omitting the placement;
- the campaign's base bid or relevant target-bid range, current dynamic-bidding strategy, placement adjustment, and combined bid exposure. Calculate the placement-adjusted static bid as `base bid × (1 + placement adjustment)` and then apply the current officially verified dynamic-bidding rule to show the possible effective auction-bid range or ceiling. If that rule or a needed input is unavailable, report the combined exposure as `UNKNOWN` and do not recommend a placement increase from base CPC alone;
- before any placement increase proposal: daily spend by date, current daily budget, relevant budget-change history, observed or estimated budget-exhaustion timing, and the risk that the higher placement multiplier causes early budget exhaustion. Keep daily budget distinct from cumulative spend, phase cap, and total approved loss exposure;
- concurrent changes inside the comparison or attribution window. If bids, budgets, negatives, targeting, Listing, price, promotion, or other material delivery/conversion variables were just changed, mark the proposed placement test `CONFOUNDED_RISK` and state the earliest interpretable review window. Do not attribute later movement to placement alone.

If any in-scope campaign or required placement field is missing, set the review status to `REVIEW_INCOMPLETE` and list the missing evidence. Partial findings may still be delivered, but the output must not say the advertising review is complete, finished, or optimized.

Verified `NOT_APPLICABLE` with current product/schema evidence satisfies the applicability check; unexplained absence or `UNAVAILABLE` does not. Do not invent three-placement support for every ad product. Current adjustment settings and historical performance are separate snapshots; use change history to establish which settings governed each window, not today's settings backfilled into past dates.

## 8. Multi-window and change control

Use the closed existing-product phase-row schema and state machine `AUDITING -> DIAGNOSING -> TESTING -> SCALING -> TRANSITIONING`. A traffic-ready plan contains each state exactly once, each nonterminal row names only its canonical successor, and the terminal row names none. Phase actions and all evidence/data/entry/exit/rollback controls use meaningful non-placeholder strings; unknown fields or hidden off-Amazon/delivery controls fail closed. This is intentionally different from the new-product launch graph.

Use windows long enough for the verified attribution and data delay, and short enough to remain relevant to the current offer. Avoid one universal duration.

For every comparison, record:

- current and baseline window;
- attribution completeness;
- weekday/season/event differences;
- price, Coupon, Listing, review/rating, inventory, and bid/budget changes;
- suppressed/out-of-stock periods;
- report schema and source coverage.

Prefer one interpretable change at a time. When operations require multiple simultaneous changes, mark the following window `CONFOUNDED` and do not attribute the result to one action.

Each immutable strategy version has a proposed change set. Each applied change later receives:

```text
change_id
authorization record
pre-change snapshot
applied_at
post-change verification
rollback state
first eligible review gate
```

`READY_FOR_EXECUTION_REVIEW` still means `NOT_AUTHORIZED`. Fresh execution authorization must bind the exact full operation-ID set, canonical manifest hash, account/marketplace, and current pre-change snapshot hash; any difference requires a new review.

## 9. Handbacks

When advertising is not the primary root cause, create an evidence-linked handback without modifying the upstream artifact:

- negative contribution, cost/price, compliance, supply, or product-market issue → tell the user it is a product-level decision outside this plugin (selection is frozen), with the evidence;
- changed competitor price/rating/ratings-count barrier → `$analyze-amazon-competitors`;
- query intent, coverage, source, or role problem → `$build-amazon-keyword-library`;
- Listing/variation/claim/conversion-message problem → `$write-amazon-listing`;
- account, inventory, Featured Offer/Buy Box, or operational eligibility without a matching Skill → `EXTERNAL_OPERATIONAL_BLOCKER`.

Set an interim advertising action such as `HOLD`, `REDUCE_EXPOSURE`, `OBSERVE`, or `NONE`, with an economics and risk reason. Do not prescribe an upstream fix outside this Skill's authority.

## 10. Existing-product output

For a complete optimization plan, the output must preserve current structure and proposed changes separately:

- 30-second diagnosis and primary root-cause class;
- reconciled economics and report coverage;
- current architecture map;
- target/search-term/placement decision table;
- query-share and link-maturity diagnosis, or an explicit `PARTIAL`/`UNAVAILABLE` source gap;
- keep/observe/change/pause proposals;
- negative-routing proposals;
- budget, loss, inventory, and rollback guardrails;
- open handbacks;
- exact change manifest with `NOT_AUTHORIZED` execution state;
- next evidence review gate.

Do not describe the account as optimized until approved changes are applied and measured in a sufficiently complete follow-up window.
