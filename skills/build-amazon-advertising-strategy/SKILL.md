---
name: build-amazon-advertising-strategy
description: "核算亚马逊站内广告盈亏线，设计或审计 SP/SB/SD 广告，交叉诊断广告位、关键词排名、同屏竞品和详情页证据；区分新品学习期与成熟期优化；经用户批准后可调整竞价、预算、开停和否词。Calculate Amazon onsite ad break-even, design or audit campaigns. 不做站外引流、Listing 文案或采购。"
---

## 数据与工具

- 本会话还没调过就先 `xander_status`；先 `xander_archive_overview` 读采购价、头程、利润底线、库存约束和过往广告决策。
- 取数：广告对象 `xander_ads_list`（sp.campaigns / sp.adGroups / sp.keywords / sp.targets / sp.productAds / sb.campaigns / sd.campaigns / sd.targets，自动翻页）；广告报表 `xander_ads_report`（preset：sp_campaigns、sp_search_terms、sp_targeting、sp_advertised_product、sb_campaigns、sd_campaigns，或自定 configuration）；总销售与转化用 `xander_spapi_report` 的 GET_SALES_AND_TRAFFIC_REPORT。SP、SB、SD 分开取、分开统计。方法见 [取数方法](../xander-operations/references/data-workflow.md)。
- 快速经济线：`xander_calc_ad_economics`；完整计算与策略包校验用本技能 scripts 里的 Python 脚本（宿主能执行代码时）。
- 改账户只走 [写入安全](../xander-operations/references/write-safety.md)：`xander_prepare_change` → 用户批准这一份 → `xander_execute_change` → 回读。可用操作：SP 活动开停/日预算、广告组开停/默认竞价、关键词竞价/开停、投放竞价/开停、广告商品开停、新增关键词、新增否词；SB 活动开停/预算；SD 活动开停/预算、投放竞价/开停。开关只有用户能开。
- 未知数字是 null，不是 0；第三方估算标 ESTIMATED；模拟结果标 SIMULATED / NOT LIVE。用简洁中文回答。

# Build Amazon Advertising Strategy

Determine whether an offer can afford Amazon onsite traffic, then plan or review the advertising decision at the user's requested depth. Keep launch learning separate from optimization with usable first-party history.

## Route the request

Start existing-project work from its current-state index, latest executed-change ledger (`xander_change_log`) and first-party readback. A completed report manifest supersedes its request receipt but does not prove populated metrics or complete days. Historical plans and user-adjusted bids are not current state. Keep product IDs, prices, profit floors, calendars and route durations in project context. Follow relevant `OPERATING_DATA_SOP.md` source, coverage and handoff rules where provided, and task-specific source/call limits.

Choose evidence depth independently of product and output mode. Explicit rough estimates use `ESTIMATE`: minimum sufficient supported inputs, formulas, assumptions, excluded costs and provisional label. Formal reconciliation or consequential operating judgments use `RECONCILED`: relevant first-party sources aligned by scope, definition and maturity. “Estimated profit” alone does not demand a full audit. Single-metric questions do not require a full review. Neither depth revives revoked costs or grants execution readiness.

Choose product mode: `NEW_PRODUCT_LAUNCH` when stable first-party advertising history is insufficient; use scenarios, readiness gates and controlled learning. Choose `EXISTING_PRODUCT_OPTIMIZATION` with usable first-party Ads and business history; preserve working structures and diagnose before changing. A new-product performance review remains launch mode merely because reports exist.

Choose the smallest deliverable:

- `ECONOMICS_ONLY`: contribution, break-even/target ACoS and CPC, support costs, cash exposure.
- `PLAN`: full architecture, targets, budgets, phase gates, onsite support and handoff.
- `AUDIT`: read-only diagnosis; `REFRESH`: compare newer evidence with an immutable strategy version.
- `PREPARE_CHANGES`: exact reviewable manifest via `xander_prepare_change`, no application.
- `EXECUTE`: the user's concrete current instruction or approved exact proposal, after fresh live readback and scope binding. “Optimize” or opening an Ads switch alone does not grant unlimited changes.

## Read the relevant detail

Load each applicable reference in full. A narrow result does not inherit a full-package status.

| Need | Reference |
|---|---|
| Standalone economics, costs, ACoS/CPC/TACoS, provisional period profit | [economics-calculation.md](references/economics-calculation.md) |
| Full strategy scenario evidence, actual-performance lineage, spend caps, learning-loss envelope and traffic readiness | [economics-and-budget-gates.md](references/economics-and-budget-gates.md), after economics calculation |
| Narrow read-only account review | [read-only-review.md](references/read-only-review.md) |
| Async reports, dated snapshots or shared input versions | [report-reuse-and-input-versions.md](references/report-reuse-and-input-versions.md) |
| Business Reports/Data Kiosk traffic, child-ASIN conversion, retail/Ads coverage | [business-traffic-and-coverage.md](references/business-traffic-and-coverage.md) |
| Profit floors, price phases, seasonality, inventory/replenishment, or full-plan operating context | [operating-context-and-replenishment.md](references/operating-context-and-replenishment.md) |
| New-product launch plan or promotion rhythm | [new-product-launch.md](references/new-product-launch.md) |
| Existing-product optimization plan/diagnosis | [existing-product-optimization.md](references/existing-product-optimization.md) |
| Recent 1–3 day/hourly pacing or Marketing Stream attribution | [hourly-data-and-attribution.md](references/hourly-data-and-attribution.md) |
| Brand Analytics keyword ownership/link maturity | [keyword-share-and-link-maturity.md](references/keyword-share-and-link-maturity.md) |
| Own/competitor exact-query CTR/CVR trends, query purchases and parent/child sales benchmarking | [keyword-share-and-link-maturity.md](references/keyword-share-and-link-maturity.md), including its performance-benchmarking handoff; keep estimates separate from actual Ads CVR |
| Placement, rank, same-screen competitor/product-page cross-diagnosis | [placement-and-competitor-cross-diagnosis.md](references/placement-and-competitor-cross-diagnosis.md) |
| AMC path, lag, overlap or frequency analysis | [amazon-marketing-cloud.md](references/amazon-marketing-cloud.md) |
| Current eligibility, placement, attribution, fees, promotions, Vine, reviews or authority | [policy-permissions-and-onsite-support.md](references/policy-permissions-and-onsite-support.md) |
| Structured package/schema, lineage or readiness claim | [input-and-output-contract.md](references/input-and-output-contract.md) |
| Complete plan/change package or authorized execution | [full-strategy-workflow.md](references/full-strategy-workflow.md), with applicable dependencies above |

For standalone `ECONOMICS_ONLY`, read only the calculation reference plus context/policy only if they affect that calculation; a serialized strategy-contract economics package also needs the input/output contract. A narrow `AUDIT` or `REFRESH` loads its question-specific evidence modules. Full `PLAN`, full-plan `REFRESH`, `PREPARE_CHANGES` and `EXECUTE` require applicable economics, context, policy, schema and selected-product checks. Incomplete packages cannot claim ready.

Placement/competitor cross-diagnosis is a narrow Ads review: reuse dated keyword rank/SERP and competitor offer/page evidence where available, and request only missing relevant evidence. Their research roles and lists remain unchanged. Align source scopes; do not invent a query × placement × competitor attribution table. A complete existing-product review must pass the placement completeness gate in its product-mode reference; otherwise label it partial.

## Shared constraints

- State marketplace, currency, timezone, ASIN/SKU/variation, offer and reporting window. Keep missing values `null`, not zero, and avoid merging incompatible scopes or inventing IDs/costs. First-party account/report evidence outranks estimates. Reuse compatible upstream SellerSprite evidence; for a material estimate gap use its paid MCP first when available and allowed, preserving raw scope and `ESTIMATED` label. Do not silently substitute another source.
- Separate Brand Analytics query/market share from Ads attribution. Neither proves advertising caused organic or total-sales change. Separate current effective from planned price, and PPC from discounts, promotion/Vine costs and cash/inventory. No CPC ceiling without CVR; no profit claim without complete costs.
- Optimize contribution within the user's profit floor, approved cash/loss capacity and stock constraints; fixed ACoS/TACoS is not a default objective. Above-break-even learning loss needs explicit scoped approval. A daily budget is not a total-loss cap. Preserve upstream evidence IDs, research roles, operating-context hashes and content locks; add advertising decisions separately. Risk acceptance does not make evidence, eligibility, Listing or inventory ready.
- Amazon onsite scope requires actual account-level Amazon-only delivery control and current official support for each included format. An ad-product name alone is insufficient. Exclude an unverified format from a ready plan. Never propose fake orders, review incentives/gating, positive-review requests, family/friend/employee reviews, competitor sabotage or changing/removing negative reviews; never guarantee reviews, ranking or profit. Verify current Vine/native Request a Review eligibility when used.
- This Skill's executable changes are Amazon Ads only. Ads permission does not authorize Listing, price/Coupon, Vine, stock, purchasing, freight or off-Amazon actions.

## Authority and completion

Default analysis/planning to `PLAN_ONLY`; reading reports or an opened switch does not authorize mutation. A current exact user instruction or approval of a displayed exact proposal authorizes execution of that proposal only. Bind it to current account/marketplace, entities, old/new values and safety limits; ask only for material missing, changed or expired scope. Archive/delete is not offered by this plugin.

Each change edits one field of one entity. Do not pause/re-enable as an implementation shortcut; enabling, pausing and creation need their own explicit scope. If the needed action is not in `xander_switches` (e.g. new campaigns, placement adjustments, budget rules, portfolios), say it is not implemented yet and give the user an exact manual checklist instead; do not improvise another channel without the user's choice (see [紫鸟兜底](../xander-operations/references/ziniao-fallback.md)).

For supported math use [calculate_ad_economics.py](scripts/calculate_ad_economics.py); for full strategy/change JSON use [validate_ad_strategy_package.py](scripts/validate_ad_strategy_package.py). Narrow output needs applicable evidence, arithmetic and scope QA. Full packages must fix hard failures or lower status; do not call an incomplete package a memo while claiming readiness. `PLAN_READY` is plan-only; `READY_FOR_EXECUTION_REVIEW` is unexecuted. The local validator returns `execution_authorized=false` even if structure passes: execution still requires the user's approval of the exact `xander_prepare_change` proposal, the matching switch turned on by the user, and post-change readback.

## Complete advertising coverage

Read SP, SB and SD separately and keep per-product coverage and enabled/paused/archived counts separate; counts belong to the selected profile (one marketplace), not all countries. `xander_ads_list` reports `complete=false` when pages remain — then the conclusion is partial. Request campaign reports separately per ad product and preserve attribution differences (SP 7-day `purchases7d/sales7d`; SB/SD differ). A pending or failed report is unknown, never zero. The last 1–3 days are still backfilling.

## 收尾

执行过的改动、复盘时间（一般 7–14 天后）和回退条件用 `xander_archive_note` 记下；新确认的成本或利润底线用 `xander_archive_set_fact` 记下。规则见 [店铺档案](../xander-operations/references/business-context.md)。
