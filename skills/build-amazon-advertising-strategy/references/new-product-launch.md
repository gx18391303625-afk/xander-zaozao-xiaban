# New-product launch mode

Use this reference only for `NEW_PRODUCT_LAUNCH`. The purpose is to acquire decision-quality onsite traffic inside a pre-approved financial envelope, not to force rank, sales, or reviews.

## 1. Preconditions

Before `PLAN_READY`, require:

- verified product/offer identity and marketplace;
- current Listing release `READY`;
- real ASIN and SKU plus current advertising eligibility for any traffic-ready plan/review/execute state;
- verified current effective price, any separate planned price phases, material fees, operating contribution, dynamic post-ads profit floor, and cash exposure;
- pessimistic/base/optimistic CVR and cost scenarios with sources;
- exact-offer fulfillable inventory, safety floor, quantity-matched production/transport/FBA lead-time components, evidence-based demand phase, reorder state, and stockout action;
- current ad-format and Amazon-only placement controls;
- competitor price/rating/ratings-count barrier snapshot;
- approved onsite support scope and review-compliance gate.

If the ASIN/SKU does not yet exist, build a `PROVISIONAL` architecture and data checklist, not an upload-ready or execution-ready plan.

If earlier workflow Skills were not used, route as `INDEPENDENT_NEW` and require a traceable independent product/offer/Listing/economics source package. Never borrow or invent upstream run IDs.

## 2. Scenario authority

A new ASIN normally lacks its own stable ad CVR, CPC, and search-term conversion history. Use data in this order:

1. closely comparable first-party ASIN or variation data with documented differences;
2. current first-party category/query data such as SQP or Brand Analytics when accessible;
3. locked competitor, SERP, and SellerSprite estimates labeled `ESTIMATED`;
4. explicit model hypotheses labeled `HYPOTHESIS`.

Do not treat SellerSprite purchase rate, suggested bid, CPC, sales, traffic share, or keyword volume as the new ASIN's future performance. Do not backsolve CVR from a desired CPC.

When Brand Analytics is used to judge whether launch promotion is establishing the ASIN on core queries, apply [keyword-share-and-link-maturity.md](keyword-share-and-link-maturity.md). Keep own-ASIN Search Query Performance shares separate from the market-leading ASIN rows in Search Terms, and keep both separate from Ads attribution.

For traffic readiness, the economics payload must contain exactly one each of `PESSIMISTIC`, `BASE`, and `OPTIMISTIC`; name and role agree, each has confidence and evidence beyond a pure hypothesis, and `binding_scenario_name` identifies one calculated result. Common evidence must semantically cover offer/revenue, Amazon fees/tax, product costs/returns, and inventory with compatible artifact class, marketplace, currency/account where applicable, and exact ASIN/SKU scope; each scenario's evidence must cover conversion rate and attributed-revenue basis. `HIGH` confidence requires authoritative evidence that actually covers both scenario domains. Keyword, policy, budget, or unrelated first-party inventory/account artifacts cannot impersonate economics evidence or elevate confidence. An `ACTUAL` label requires exact-scope first-party Amazon proof.

Only the binding result may release target CPC ceilings. Target and break-even ACoS/CPC tolerance must be monotonic from pessimistic through base to optimistic. If the arithmetic contradicts the scenario labels, correct the roles or lower readiness. `OPTIMISTIC` cannot bind without explicit scoped user approval.

Adjust scenario confidence for offer disadvantages such as:

- materially fewer ratings or weaker star rating than attainable `CORE_BENCHMARK` peers;
- price or pack mismatch;
- unresolved category/variation expectation;
- weak delivery promise or inventory uncertainty;
- missing conversion assets or unverified claims;
- seasonal timing or cold demand.

These are risk inputs, not excuses for review manipulation or unlimited spending.

## 3. Build the launch target map

Review each source keyword/ASIN for advertising separately. Preserve its upstream role and add:

```text
advertising eligibility
purpose
product fit
intent
data class
economics ceiling
stage eligibility
source/evidence IDs
decision reason
```

Typical purposes:

- `CONTROLLED_DISCOVERY`: learn actual queries or product contexts within a capped budget;
- `CORE_TEST`: test the most direct, evidence-backed product intent;
- `QUERY_VALIDATION`: isolate a query/target that has enough evidence to deserve clean measurement;
- `EXACT_OR_TARGET_HARVEST`: preserve a validated target in a controlled structure;
- `PRODUCT_TARGET_TEST`: test a locked ASIN/category context with a documented comparison rationale;
- `DEFENSE_CONDITIONAL`: defend genuine branded/ASIN demand when it exists and the ad format is eligible;
- `EXPANSION_CANDIDATE`: hold until the current-stage gate is met;
- `OBSERVE` or `EXCLUDE`: retain without buying traffic.

Do not automatically advertise every `CORE_VERIFIED` term. Do not automatically negate `WRONG_INTENT`; first verify whether it is an exact query, a token inside a relevant phrase, or merely a research classification. Do not advertise `HOLD_CLAIM` or `UNSUPPORTED` content as a way to bypass Listing evidence gates.

## 4. Objective-led architecture

Use only the components that the product needs:

### Controlled discovery

Purpose: learn real search terms or product contexts.

- use a current supported automatic, keyword, category, or product-targeting mechanism appropriate to the account;
- cap spend and prevent uncontrolled overlap;
- give every included target one campaign owner and reconcile all learning campaigns to per-campaign loss allocations plus aggregate envelope spend/loss caps;
- define what qualifies a discovered query for review;
- do not move a query merely because it received one order.
- verify negative routing at every supported scope used by the account. Read campaign-level and ad-group-level negative keyword and negative product entities separately; an empty ad-group view does not prove that campaign-level negatives are absent.
- preserve the declared scope and purpose of each negative. Use exact negatives to route an exact query to its manual owner when appropriate, and phrase negatives only for unambiguous wrong-intent families; do not duplicate negatives mechanically across isolated exact or product-target campaigns.

In `LEARNING`, explicitly document controlled overlap when relevant Auto, Broad and manual entries are needed to obtain decision-quality volume. Separate target IDs and source ownership do not require immediate exact-negative routing. Do not infer self-bidding or CPC inflation merely from overlapping eligibility. Reserve clean-query isolation for a supported validation objective; tiny samples or one order alone do not justify harvesting or closing useful discovery routes.

### Core validation

Purpose: measure direct product-intent candidates cleanly.

- isolate targets when overlap would obscure the decision;
- keep bids within the selected economics ceiling or a separately approved learning-loss envelope;
- attach exit and rollback gates.

### Product targeting

Purpose: test attainable competitor/detail-page contexts.

- prioritize fit, price/pack, rating barrier, offer differentiation, and observed context;
- do not target a boundary leader solely because it has high sales;
- do not assume a competitor ASIN's traffic or conversion transfers to this offer.

### Defense

Purpose: protect existing branded/ASIN traffic or key placements.

- include only when there is actual defendable demand and current ad eligibility;
- separate defense economics from acquisition so a low ACoS defense campaign does not disguise weak prospecting.

### Controlled expansion

Purpose: extend beyond proven intent after the product earns the right to scale.

- require stage, CVR, contribution, inventory, and relevance gates;
- keep generic audiences/use cases evidence-bound;
- never convert `LATER_STAGE_RELEVANT` into current traffic without documenting the changed stage evidence.

## 5. State-gated launch rhythm

Do not hardcode universal day ranges. Build each phase with entry, evidence, spend, inventory, exit, and rollback gates.

The state machine and phase-row field set are closed and linear: `PREPARED -> LEARNING -> VALIDATING -> SCALING -> TRANSITIONING`. All five states remain required exactly once for `PLAN_READY`, `READY_FOR_EXECUTION_REVIEW`, and `EXECUTION_AUTHORIZED`; each nonterminal row names only its canonical successor and the terminal row names none. Every action, entry/exit/rollback gate, and data-sufficiency reference is a meaningful non-placeholder string. Unknown phase fields or hidden off-Amazon/delivery controls fail closed. Preparing a manifest does not permit dropping later inventory, attribution, or transition controls.

### `PREPARED`

Goal: prove the offer can safely enter traffic testing.

Required evidence:

- Listing and ad eligibility;
- verified economics or explicitly approved provisional scenario;
- Amazon-only placement control;
- inventory and cash limits;
- compliant onsite support plan;
- target and routing map.

Exit: all hard gates pass. Otherwise remain blocked or provisional.

### `LEARNING`

Goal: collect interpretable first-party query/target and conversion evidence.

Controls:

- limited objectives and targets;
- phase spend and loss caps;
- no automatic scaling from impressions or clicks alone;
- attribution completion rule;
- inventory floor.

For early delivery diagnosis, anchor every observation to the live account timezone and exact launch instant. Do not treat a few hours of zero visible metrics—especially an overnight interval—as proof of a low bid. First distinguish metric-population delay from verified zero impressions, then separate zero impressions, impressions without clicks, and clicks without orders. A no-impression time marker triggers review only; any target-level bid test remains bounded, reversible, and separately authorized. Use own-campaign or own-ASIN hourly evidence when available, and never relabel it as Amazon-wide real-time shopping traffic.

Scheduled review checkpoints are not mandatory waiting gates. Reported zero orders with immature attribution or little relevant traffic does not establish a stable zero CVR. Learning can include bounded delivery or relevance tests while conversion matures, but it cannot bypass economic/exposure approval. Do not let a planned calendar, repeated bid increases or the desire for clean architecture replace a stated learning question and stop condition.

Exit: enough source-qualified evidence exists to validate, hold, or exclude candidates without exceeding the approved exposure.

### `VALIDATING`

Goal: isolate candidates with credible order/relevance evidence and test whether performance holds.

Controls:

- clean target ownership and negative routing;
- repeatability across a sufficient window/sample;
- promoted-product economics rather than blended halo alone;
- price, Coupon, Listing, rating, and inventory event tracking.

Exit: targets meet the defined economic and evidence gates, or are held/returned for diagnosis.

### `SCALING`

Goal: expand proven traffic without exceeding cash, contribution, or inventory capacity.

Controls:

- increase exposure in bounded steps justified by observed delivery and economics;
- preserve an unchanged comparison window when possible;
- monitor marginal, not only blended, performance;
- maintain a rollback point and inventory floor.

Exit: the launch portfolio is stable enough to begin transition, or deteriorates and rolls back.

### `TRANSITIONING`

Goal: move from launch experimentation to repeatable steady-state operation and prepare Stage 5 review.

Evidence:

- target/query role stability;
- comparable-period query impression, click, cart-add and purchase-share maturity when first-party Brand Analytics is accessible;
- contribution and cash state;
- organic/total-sales context without claiming causality;
- inventory/replenishment reliability;
- resolved or explicitly accepted handbacks;
- current review/rating state with no guaranteed target.

Output `promotion_handoff.json` with every exit criterion marked `MET`, `NOT_MET`, `UNKNOWN`, or `NOT_APPLICABLE`.

## 6. Onsite support coordination

Price/Coupon, Vine, review requests, and inventory timing influence conversion but remain separate from PPC controls.

- Record the no-promotion price and effective promoted price.
- Model Coupon/deal discounts and fees separately from ad spend.
- Model Vine fees, supplied-unit landed cost, and fulfillment impact separately.
- Use only current Amazon-native neutral review-request capability when eligible; bind every eligible order scope to a current first-party native eligibility snapshot from the same marketplace/account/product, and do not generate custom persuasive review messages.
- Treat review count and rating as observed outcomes, not controllable deliverables.
- Stop or reduce traffic when stockout risk would destroy the test or the offer state becomes unreliable.
- Reconcile sellable/reserved/safety-stock/lead-time values to the binding economics input. For traffic readiness, all three reserved-breakdown fields—Vine, other locked, and other reserved units—are explicit non-negative numbers and sum exactly to total reserved units. Planned launch orders must fit current advertising-available units, and every phase inventory floor must preserve safety stock.
- Count only currently fulfillable exact-offer units as sellable. Inbound, in-transit, FC-receiving, reserved, and safety-stock units do not increase current advertising availability.
- Trigger replenishment review from evidence-based days of cover versus the selected route's production, prep, transit, customs/local-delivery, FBA-receiving, and buffer days. A fast bridge route is valid only if it becomes sellable before the projected gap and remains economical after its own landed cost is recalculated.
- For binding onsite support, reconcile effective price/currency/tax basis, every Coupon/deal discount and fee, all five ledgers, Vine method/eligibility/planned units/costs, and the reserved-inventory breakdown exactly to the calculator. Future or unverified support remains `PLANNED_NOT_IN_BINDING`.

Do not change price and advertising structure simultaneously unless the test explicitly accepts confounding and records it. When multiple changes are necessary for operations, label the period non-comparable.

## 7. Exit and stop conditions

Every plan defines both success and failure/hold conditions. Examples of condition families—not universal thresholds—include:

- operating/all-in contribution and approved learning loss;
- target-level relevance and conversion evidence;
- attribution completion and data sufficiency;
- price/rating/ratings-count disadvantage;
- inventory floor and replenishment uncertainty;
- Buy Box/Featured Offer, suppression, policy, or account eligibility change;
- return reasons, customer questions, or Listing mismatch;
- seasonality window or cash limit.

Do not continue spending solely because the planned calendar is unfinished. Do not declare success solely because revenue or rank increased while all-in contribution, inventory, attribution, or source quality remains unknown.
