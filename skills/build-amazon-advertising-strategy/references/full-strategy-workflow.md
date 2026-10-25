# Full strategy workflow and delivery

Read this reference when preparing, refreshing or auditing a full strategy/change package, or executing its separately approved manifest. It retains the detailed requirements for those outputs; a narrow read-only memo or standalone calculation follows the routes in [SKILL.md](../SKILL.md) and does not automatically run this whole workflow.

## Follow the workflow

### 1. Establish scope and authority

Record:

- product mode, deliverable mode, marketplace, currency, timezone, ASIN/SKU/variation and offer scope;
- whether the work is plan-only, read-only account inspection, change preparation, or separately authorized execution;
- available ad types and account/brand eligibility as observed now, not assumed;
- requested output files and whether the user wants a portfolio, parent, child, SKU, or single-offer scope.

One strategy package must not mix marketplaces, currencies, materially different offers, or unrelated ASIN economics. Split them or build an explicitly aggregated portfolio model.

### 2. Validate and preserve the upstream chain

Prefer the current `listing_release.json` and preserve:

```text
project_id
selection_run_id
candidate_id
competitor_lock_run_id
keyword_run_id
listing_run_id
listing_version_id
```

Product selection is frozen in this plugin: `project_id`, `selection_run_id` and `candidate_id` may be absent, so set `lineage_mode` to `INDEPENDENT_NEW` or `INDEPENDENT_EXISTING` with an `independent_scope`, and keep binding the competitor-lock, keyword and Listing snapshots that do exist (see xander-operations/references/lineage-and-selection.md).

Create new immutable IDs:

```text
ad_economics_run_id
ad_strategy_run_id
ad_strategy_version_id
```

A changed product, offer, marketplace, currency, or accounting scope requires a new economics and strategy run. A plan revision under the same scope requires a new strategy version. Never replace missing upstream IDs with invented lookalikes.

Require `upstream_snapshots.listing_release.status=READY` and `integrity_status=VERIFIED` for any traffic-ready result. Bind every full-workflow stage snapshot to its hashed semantic source artifact, repeat exact `project_id` and `candidate_id` plus the matching stage run/version IDs inside every snapshot, and bind the Listing release hash to the cited `listing_release` artifact. The traffic-ready Listing also carries a non-placeholder path and timezone-aware capture timestamp no later than the strategy package; a self-declared READY object is insufficient. A `PROVISIONAL` Listing can support scenario planning but not `PLAN_READY`; a `BLOCKED` Listing stops traffic-launch planning and produces a handback.

### 3. Verify current official and account-specific rules

Treat ad eligibility, formats, reporting definitions, attribution, fees, promotion rules, Vine eligibility, review-request rules, and account interfaces as time-sensitive.

- Verify current Amazon Ads and Seller Central official sources for the target marketplace.
- Inspect the actual account when account-specific availability matters.
- Record source URL, scope, verification date, effective date when stated, and unresolved conflicts.
- Never hardcode a universal fee, minimum budget, bid, attribution window, campaign limit, review-request window, or “good ACoS.”
- Mark third-party estimates, including SellerSprite CPC, volume, purchase rate, traffic share, and suggested bids, as `ESTIMATED`.

The user authorized Amazon onsite advertising only. Current Sponsored Products reach can extend beyond Amazon, so do not treat the format name as proof of onsite scope. Every included campaign must have a runtime-verified Amazon-only control—currently described by Amazon as `Limit reach to Amazon` where available—recorded in both the account snapshot and campaign row. Exclude Sponsored Products, Display, or any other format when that exact Amazon-only control cannot be verified for the marketplace/account.

Reuse current upstream SellerSprite evidence instead of recollecting it. When a material Stage 4 estimate gap must be refreshed and the paid SellerSprite MCP is available, use it first, preserve its raw source/coverage, and never substitute web estimates silently. First-party Amazon account/report data still outranks SellerSprite in existing-product mode.

If policy or account access is unavailable, continue only as `PROVISIONAL` and state what cannot be verified.

For validator readiness, policy and approval artifacts must be no older than 30 days; account eligibility/placement, inventory, binding performance rows, and their first-party report/API artifacts must be no older than 24 hours relative to the strategy capture time, and a traffic-ready package itself must be within 24 hours of validator runtime. Prepared changes use a pre-change snapshot no more than one hour older than the package; an execution confirmation must follow that snapshot within one hour and itself remain within one hour of validator runtime. These are internal safety windows, not Amazon policy claims; refresh sooner whenever the account or rule may have changed.

### 4. Normalize the financial model first

Use [calculate_ad_economics.py](../scripts/calculate_ad_economics.py) when local Python/script execution is available.

- Use the actual effective selling price after seller-funded discount.
- Separate retained revenue, non-retained tax, Amazon/fulfillment costs, landed cost, returns/loss allowances, and onsite-promotion costs.
- Keep PPC spend, discount investment, Coupon/deal fees, Vine/product cost, and other launch support in separate ledgers.
- Calculate operating and all-in contribution, break-even and target-profit ACoS/CPC, cash exposure, and existing-period ACoS/TACoS when the inputs support them.
- Optimize total contribution profit inside the user-approved minimum post-ads contribution floor, cash, inventory, and risk limits. A fixed TACoS/ACoS is an observed ratio or explicit constraint, not the default objective. When both a rate floor and per-order amount are supplied, use the stricter floor and keep the risk buffer separate.
- Recalculate economics for every materially different verified price/promotion phase; a planned price is not the current effective price and cannot release traffic readiness.
- Use pessimistic, base, and optimistic scenarios for a new product. Scenario labels do not make invented values acceptable. Common offer/fee/cost/inventory inputs and scenario-specific conversion/attributed-revenue assumptions must cite semantically compatible `evidence_domains`, artifact classes, marketplace, currency, account when applicable, and exact ASIN/SKU scope; keyword, policy, inventory, and budget artifacts cannot impersonate unrelated economics evidence.
- Use exactly one canonical `PESSIMISTIC`, `BASE`, and `OPTIMISTIC` role for a traffic-ready new product; name and role must agree and target CPC, break-even CPC, target ACoS, operating break-even ACoS, and all-in break-even ACoS must be monotonic from pessimistic through optimistic. Hypothesis-only scenarios remain provisional. `HIGH` confidence needs authoritative coverage of both conversion and attributed-revenue domains; `ACTUAL` labels require exact-scope first-party Amazon evidence. Binding `OPTIMISTIC` requires explicit user approval tied to a seller-confirmed or first-party source.
- Treat missing optional costs that are calculated as zero as explicit gaps, not confirmed zero costs.

If contribution before ads is not positive, the calculator returns `overall_status=BLOCKED` with a corresponding reason code; do not construct bids or budgets to make the offer appear viable. If CVR is unavailable, do not manufacture a CPC ceiling. A real zero capacity or observed zero CVR remains numeric zero; an unknown denominator remains `null`.

### 5. Apply the launch/optimization readiness gate

Check, as applicable:

- current Listing release and offer accuracy;
- ad eligibility, account state, and either current Featured Offer/Buy Box eligibility or an official current exception covering every selected ad product;
- effective price and promotion state;
- exact-offer currently fulfillable sellable inventory, explicit Vine/other-locked/other-reserved breakdown, quantity-matched lead-time components, replenishment risk, demand phase, and stockout consequences; inbound or FC-receiving units are not currently advertising-available;
- rating and ratings-count gap against `CORE_BENCHMARK` and `BOUNDARY_REFERENCE` competitors;
- verified fee snapshot, cash reserve, loss allowance, and approved total exposure;
- compliance, restricted-product, claim, trademark, variation, and review-policy boundaries;
- first-party performance coverage for existing-product optimization.

Use these strategy states:

- `BLOCKED`: launching or precise optimization would be unsafe or materially misleading.
- `PROVISIONAL`: scenario/audit output is possible, but one or more execution-critical inputs remain unverified.
- `ECONOMICS_READY`: an `ECONOMICS_ONLY` deliverable has complete, non-provisional economics; it is not an advertising plan.
- `PLAN_READY`: the plan is financially and structurally valid but no live action is authorized.
- `READY_FOR_EXECUTION_REVIEW`: the exact change manifest, live snapshot, permissions, and rollback information are ready for the user to approve. This is not execution authorization.
- `EXECUTION_AUTHORIZED`: a fresh user authorization record is bound to the exact immutable manifest, account, marketplace, operation-ID set, and pre-change snapshot. It applies only to `EXECUTE` and expires when scope, state, or time changes. The local validator checks structure only; it never authenticates the person or grants live-write authority.

Use only these state combinations:

```text
ECONOMICS_ONLY -> BLOCKED | PROVISIONAL | ECONOMICS_READY
PLAN           -> BLOCKED | PROVISIONAL | PLAN_READY
AUDIT          -> BLOCKED | PROVISIONAL
REFRESH        -> BLOCKED | PROVISIONAL | PLAN_READY
PREPARE_CHANGES-> BLOCKED | PROVISIONAL | READY_FOR_EXECUTION_REVIEW
EXECUTE        -> EXECUTION_AUTHORIZED
```

`PLAN_READY` always carries `execution_authority=PLAN_ONLY`. `READY_FOR_EXECUTION_REVIEW` always carries `PREPARE_CHANGES`; its operations remain `NOT_AUTHORIZED`. Never reuse either state as permission to execute.

### 6. Add ad-specific roles without overwriting research roles

Preserve every keyword's `library_role`, eligibility flags, sources, and evidence IDs. Add a separate `ad_role` and `ad_decision`; never relabel the research library to make an advertising plan easier.

Possible ad roles include:

```text
CORE_TEST
CONTROLLED_DISCOVERY
QUERY_VALIDATION
EXACT_OR_TARGET_HARVEST
PRODUCT_TARGET_TEST
DEFENSE_CONDITIONAL
EXPANSION_CANDIDATE
OBSERVE
EXCLUDE
```

Every advertised keyword or ASIN requires a fresh advertising decision based on product fit, intent, evidence, reachability, economics, current stage, and policy. Preserve non-placeholder original keyword text; require meaningful keyword intent/objective, closed product fit, and non-empty meaningful-string source/evidence arrays for every keyword and product decision. Keyword evidence must declare `KEYWORD_TARGET_EVIDENCE` and cover the exact `source_keyword_id`; product-target evidence must declare `PRODUCT_TARGET_EVIDENCE` and cover the exact ASIN. An unrelated first-party inventory, account, or economics artifact cannot elevate a target's evidence class. `CORE_VERIFIED` is a strong candidate, not a mandatory campaign. `INDEXING_CANDIDATE`, `LATER_STAGE_RELEVANT`, competitor brand/IP terms, and high-volume generic terms do not receive automatic ad permission.

Preserve competitor roles. A `CORE_BENCHMARK` or verified `DIFFERENTIATION_REFERENCE` may become a product-target candidate; a high-rating-count `BOUNDARY_REFERENCE` is normally a barrier/context input, not an automatic target. `KEYWORD_SOURCE_ONLY` does not automatically become an ASIN target.

### 7. Build objective-led architecture

Separate traffic by decision purpose so performance and budgets remain interpretable:

- discovery and query collection;
- core intent or target validation;
- isolated harvest/scale;
- product targeting;
- brand/ASIN defense when real demand and eligibility justify it;
- controlled expansion;
- exclusions and negative routing.

Sponsored Products is the normal starting format, not a universal requirement. Use Sponsored Brands or Sponsored Display only when the current account, marketplace, brand status, creative assets, audience/product eligibility, and objective support them.

Normalize campaign targeting before readiness checks. Sponsored Products accepts `MANUAL_KEYWORD`, `MANUAL_PRODUCT`, or `AUTOMATIC`; Sponsored Brands accepts `MANUAL_KEYWORD` or `MANUAL_PRODUCT`; Sponsored Display accepts `MANUAL_PRODUCT`, `AUDIENCE`, or `CONTEXTUAL_PRODUCT`. Every included manual keyword target also carries one canonical positive expression: `BROAD`, `PHRASE`, or `EXACT`. Manual keyword campaigns own only keyword targets; manual/contextual product campaigns own only product targets. The present schema does not model automatic-target or audience-target rows, so automatic/audience campaigns cannot cite keyword/product IDs as substitute definitions. These are internal contract values; verify the corresponding current account capability instead of inferring it from a remembered interface.

Campaign rows use the closed contract fields only. Reject hidden or unknown delivery/reach/supply/inventory controls, every value that implies off-Amazon delivery, placeholder gate/evidence members, and empty entry/exit/rollback arrays. Apply the structured Amazon-only scan to economics, inventory, onsite support, all target/campaign/routing/phase/decision rows, review compliance, handbacks, and change manifests too; moving an offsite instruction to a sibling object does not make it valid. For traffic-ready phase plans, use exactly one complete mode-specific linear graph: new product `PREPARED -> LEARNING -> VALIDATING -> SCALING -> TRANSITIONING`; existing product `AUDITING -> DIAGNOSING -> TESTING -> SCALING -> TRANSITIONING`. Each nonterminal state names only its canonical successor and every phase control/action member is meaningful.

Do not create one campaign per keyword mechanically, launch all keywords simultaneously, duplicate the same target across uncontrolled structures, or use fixed match-type templates without explaining the control purpose. If one `source_keyword_id` is intentionally represented by multiple target IDs/campaigns, require an explicit `QUERY_ROUTING` or `MUTUAL_EXCLUSION` contract covering every target owner. Attach each bid and budget to an economics ceiling, evidence basis, learning goal, phase cap, and rollback condition.

An intentional learning bid above the operating break-even ceiling requires a separately visible `APPROVED_LEARNING_LOSS` envelope with total loss cap, duration/data gate, rationale, and explicit user risk approval. Never hide planned loss inside a target ACoS.

The envelope must name every covered target, carry a scoped approval source, have positive spend and incremental-loss capacity, and bind a per-campaign `learning_loss_allocations` amount. Until another auditable loss model is implemented, each learning campaign uses one envelope and `CONSERVATIVE_FULL_SPEND_V1`: modeled spend, modeled worst-case loss, and the allocation all equal that campaign's `phase_spend_cap`. Aggregate campaign spend caps and modeled-loss allocations must remain within the envelope. Approval time must be current, no later than package capture, and supported by the cited approval artifact. One target has one campaign owner unless represented by a different explicit target ID and routing contract. A zero-cap, stale, unrelated, or self-reported low-loss envelope authorizes nothing.

### 8. Apply the product-mode playbook

For `NEW_PRODUCT_LAUNCH`, use the state-gated method in `new-product-launch.md`. Do not prescribe universal day-by-day increases; transition on evidence, attribution completeness, economics, inventory, and risk.

For `EXISTING_PRODUCT_OPTIMIZATION`, use the diagnostic method in `existing-product-optimization.md`. Preserve working campaign/entity IDs, compare compatible windows, distinguish traffic, creative/offer, conversion, economics, inventory, and attribution problems, and issue a handback when advertising is not the root cause.

### 9. Coordinate onsite support without mixing ledgers

Price, Coupon/deal support, Vine, neutral Amazon review requests, and inventory timing can materially affect conversion and cash. Plan them alongside advertising but account for them separately.

Preserve the upstream `operating_context.context_id` and verify `operating_context_sha256` across every full-workflow snapshot. Keep its observed/planned price phases, current season/stage snapshots, content/asset locks, acknowledged risks, demand windows, supply routes, and replenishment policy unchanged. These are operating context, not permission to alter Listing assets, price, inventory, or evidence state. A lock limits the proposed change scope; risk acceptance never upgrades evidence, Listing release, ad eligibility, or current offer/inventory verification.

- Never guarantee positive reviews, a review count, or a star rating.
- Never include fake orders, reimbursement, rebates for reviews, review gating, positive-review requests, family/friend/employee reviews, competitor sabotage, or requests to remove/change a negative review.
- Verify current Vine, promotion, and review-request eligibility in the actual marketplace/account before calling the support plan executable. Active Request a Review support uses only `AMAZON_REQUEST_A_REVIEW` and cites current first-party native eligibility proof covering every declared order scope; custom channels, messages, incentives, or extra fields fail closed.
- Treat a rating-count or price disadvantage as a CVR/economics risk, not justification for prohibited behavior or unlimited bidding.
- Reconcile effective price/currency/tax basis, every binding Coupon/deal discount and fee, Vine units/costs, separate ledgers, all three explicit non-null reserved-inventory breakdown fields, and approved cash caps to the binding calculator input. `vine_units>0` requires verified Vine eligibility, the `VINE` method, and sufficient dedicated reserve.

### 10. Monitor, decide, and hand back when needed

For a narrow read-only performance review, report the scoped portfolio first, then new campaign/ad-group slices; use complete account-local days and label launch-day fragments separately. Diagnose eligibility, budget, bid and reach before impressions, CTR, query quality/conversion, and economics. Keep report-level coverage and cross-report discrepancies visible rather than forcing joins or sums. Refresh user-adjusted live settings before proposing changes; never restore an old baseline merely to match a saved plan.

Use source-qualified first-party reports for existing performance. Keep campaign, ad group, target, search term, placement, advertised product, order/sales, business traffic, price/promotion, inventory, and change-history scopes distinct. A binding performance row and its source artifact must match the exact strategy ASIN/SKU and be current within the 24-hour safety window. Use only canonical entity scopes, and require the exact attribution-window value to appear in both the report/API metadata and a current attribution-policy artifact. Existing-product decision rules may cite only snapshots on the declared binding performance basis; incompatible diagnostic scopes require a separate package or normalization contract.

Do not self-report actual business totals. A non-null total-sales value reconciles to an exact-period first-party Amazon Business Report. Each contribution value reconciles to one `VERIFIED_PRODUCT` or `SELLER_CONFIRMED`, formula-declared normalization whose unique derived sources are all current and exact-scope: attributed contribution binds the package's actual Ads source, total contribution binds the already reconciled Business Report, and both bind semantically valid product-cost evidence for the identical marketplace/account/product/currency/window/data-through date. If those sources are unavailable, keep TACoS and period contribution ratios unavailable instead of inventing inputs.

Do not overreact to partial attribution or tiny samples. Each decision rule must state:

```text
metric and scope
observation window and attribution status
minimum evidence/data sufficiency
financial ceiling
action
rollback condition
source IDs
```

If evidence points to another root cause, do not compensate with bids. Create a handback to:

- `$write-amazon-listing` for Listing/offer-message problems;
- `$build-amazon-keyword-library` for query-role or relevance gaps;
- `$analyze-amazon-competitors` for competitor/price/rating-barrier changes;
- `$reconcile-amazon-profit` for cost, fee, contribution-basis, or period-reconciliation questions;
- `$plan-amazon-replenishment` for current-offer coverage, replenishment quantity, or route-feasibility questions;
- `PRODUCT_LEVEL_USER_REVIEW` for product positioning, compliance, or continuation decisions outside those operational scopes. Selection is frozen; explain the evidence to the user without making a product-entry decision.

The handback diagnoses and cites evidence; it does not modify the upstream artifact itself.

### 11. Validate before delivery

Run [validate_ad_strategy_package.py](../scripts/validate_ad_strategy_package.py) on a full strategy/change JSON package. A narrow read-only snapshot or performance memo instead needs source, scope, arithmetic, pagination and attribution QA; it is not the full strategy schema and cannot claim `PLAN_READY` or execution readiness. A `PLAN_READY` package must have:

- complete stable lineage or an explicitly non-workflow independent scope;
- valid economics with no hidden zero-cost claims;
- complete upstream keyword/locked-ASIN audit coverage, preserved research roles/source/evidence/order, plus separate ad roles;
- campaign/target decisions tied to evidence and financial ceilings;
- phase gates, spend caps, inventory controls reconciled to the binding economics scenario, and rollback rules;
- current policy/eligibility coverage or a visible provisional state;
- explicit structured unknowns, source-coverage gaps, policy boundaries, and performance coverage gaps; any `UNRESOLVED` or `BLOCKING` record prevents traffic readiness, while accepted non-blocking gaps remain source-linked;
- compliant review support;
- `PLAN_ONLY` execution authority.

For `PREPARE_CHANGES`, bind each proposed operation to a verified campaign-plan row, current first-party pre-change snapshot/hash/time, exact current and proposed values, explicit Amazon-only control before/after state, and rollback action. Normalize both payloads to non-empty JSON objects under `payload_schema_version=AMAZON_ADS_NORMALIZED_V1`; unknown payload fields, especially reach, publisher, external-site, supply-source, inventory-scope, or generic `type/value` discriminators, fail closed. Enforce closed leaf types/enums, cross-field combinations, action/entity matrix, and campaign ownership: positive/negative match types cannot cross, product representations cannot conflict, dates are ordered, payload currency matches the package, state/status cannot conflict, state changes use dedicated actions, campaign ad product/targeting are create-only and match the audited row, and each keyword/product operation matches that row's targeting kind. Merge current and proposed payloads and reject any final off-Amazon state, including camelCase aliases. For `EXECUTE`, require a fresh authorization record whose manifest hash and allowed operation-ID set match the entire immutable manifest exactly. Any changed account state, operation, scope, value, hash, or freshness window voids that record and requires a new review.

The executable `change_manifest` in this Skill is limited to `AMAZON_ADS`. Price/Coupon, Vine, and inventory remain separately costed onsite-support plans or operational handoffs; do not mutate those domains through an advertising authorization. The execution confirmation must follow a matching first-party pre-change snapshot captured within one hour.

Fix hard failures or lower the status. `authorization_record_structurally_valid=true` means only that the local record passes contract checks. This validator deliberately returns `execution_authorized=false`; a trusted external executor must independently authenticate the current user grant and re-read live state before any mutation.

## Deliver the result

For a complete plan, return:

1. a short decision summary: whether the product should buy traffic now, the binding financial ceiling, largest risk, and next gate;
2. a Chinese `.xlsx` with source/coverage and formula transparency;
3. `advertising_strategy_plan.json` following the contract reference;
4. for an active promotion refresh, `promotion_state.json` and a change/decision ledger;
5. when ready for Stage 5 review, `promotion_handoff.json` containing evidence and exit-condition state, not a claim that promotion succeeded.

Recommended workbook sheets:

```text
00_决策摘要
01_输入与来源
02_单位经济与盈亏线
03_三情景与敏感度
04_关键词广告角色
05_ASIN投放角色
06_广告架构
07_预算与亏损上限
08_新品节奏 or 老品诊断
09_站内促销与库存
10_搜索词与否定路由
11_决策日志与回滚
12_覆盖缺口与QA
13_第五步交接
```

Use fewer sheets for narrow requests, but do not remove sources, economics assumptions, costs, permission state, or gaps. Call the output a strategy candidate or reviewed plan, never a guaranteed profitable or guaranteed ranking plan.
