---
name: build-amazon-advertising-strategy
description: "核算亚马逊站内广告盈亏线，设计或审计 SP/SB/SD 广告，交叉诊断广告位、关键词排名、同屏竞品和详情页证据；区分新品学习期与成熟期优化；经用户批准后可调整竞价、预算、开停和否词。Calculate Amazon onsite ad break-even, design or audit campaigns. 不做站外引流、Listing 文案或采购。"
---

## 数据与工具

- 本会话还没调过就先 `xander_status`；先 `xander_archive_overview` 读采购价、头程、利润底线、库存约束和过往广告决策。
- 取数：广告对象 `xander_ads_list`（SP/SB 走 Ads API v1 统一接口：sp.campaigns / sp.adGroups / sp.ads / sp.targets / sp.keywords / sp.negativeKeywords / sb.*；SD 暂用原接口 sd.campaigns / sd.targets）；广告报表 `xander_ads_report`（Reporting API v1：preset campaigns、ad_groups、campaigns_summary 或自定 fields；搜索词 sp_search_terms、投放 sp_targeting、推广商品 sp_advertised_product 暂自动用 v3，2027-06-30 关停）；总销售与转化用 `xander_spapi_report` 的 GET_SALES_AND_TRAFFIC_REPORT。SP、SB、SD 分开统计。字段位置和口径见 [取数方法](../xander-operations/references/data-workflow.md)。
- 快速经济线：`xander_calc_ad_economics`；完整计算与策略包校验用本技能 scripts 里的 Python 脚本（宿主能执行代码时）。
- 改账户只走 [写入安全](../xander-operations/references/write-safety.md)：`xander_prepare_change` → 用户批准这一份 → `xander_execute_change` → 回读。可用操作：SP 活动开停/日预算、广告组开停/默认竞价、投放竞价/开停（关键词、商品、自动投放统一用 targetId）、广告商品开停、新增关键词、新增否词（广告组级/活动级）；SB 活动开停/日预算、投放竞价/开停；SD 活动开停/预算、投放竞价/开停（原接口）。SP 新建、位置加价、预算规则和投资组合按 [当前工具范围](../../docs/v2.3-features.md) 及 `xander_switches` 的实际参数使用。预算时间规则不等于分时竞价；本版没有排程 bid 的写入操作。开关只有用户能开。
- 选品已冻结：做结构化策略包时 `lineage_mode` 用 `INDEPENDENT_NEW`（新品）或 `INDEPENDENT_EXISTING`（老品），不要用 `FULL_WORKFLOW`；方法文件里“交回 `$select-amazon-products`”的情况改为向用户说明这是产品层面问题、本插件不做立项判断（见 [追溯规则](../xander-operations/references/lineage-and-selection.md)）。
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
| Own/competitor exact-query CTR/CVR trends, query purchases and parent/child sales benchmarking | Not done here: the benchmark itself belongs to `analyze-amazon-competitors` ([表现对标](../analyze-amazon-competitors/references/query-performance-benchmarking.md)). This skill only consumes its finished handoff through [keyword-share-and-link-maturity.md](references/keyword-share-and-link-maturity.md) when an ad decision needs it; keep estimates separate from actual Ads CVR |
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

Each operation must follow its actual handler contract and the exact approved proposal. Ordinary scalar edits change one field of one entity; supported composite operations such as placement settings, budget rules and campaign creation may contain several explicitly approved fields or dependent entities. Preserve unspecified state and expose all affected scope. A proposal containing a target-bid change and a placement change is not an atomic transaction: inspect execution/readback results before treating the intended combination as applied. Do not pause/re-enable as an implementation shortcut; enabling, pausing and creation need their own explicit scope. If the needed action is absent from the actual `xander_switches` capability list (for example scheduled bid changes), state that limitation and provide a concrete handoff; do not improvise another channel without the user's choice (see [紫鸟兜底](../xander-operations/references/ziniao-fallback.md)).

For supported math use [calculate_ad_economics.py](scripts/calculate_ad_economics.py); for full strategy/change JSON use [validate_ad_strategy_package.py](scripts/validate_ad_strategy_package.py). Narrow output needs applicable evidence, arithmetic and scope QA. Full packages must fix hard failures or lower status; do not call an incomplete package a memo while claiming readiness. `PLAN_READY` is plan-only; `READY_FOR_EXECUTION_REVIEW` is unexecuted. The local validator returns `execution_authorized=false` even if structure passes: execution still requires the user's approval of the exact `xander_prepare_change` proposal, the matching switch turned on by the user, and post-change readback.

## Complete advertising coverage

Read SP, SB and SD separately and keep per-product coverage and enabled/paused/archived counts separate; counts belong to the selected profile (one marketplace), not all countries. `xander_ads_list` reports `complete=false` when pages remain — then the conclusion is partial. Reporting API v1 returns SP/SB/SD together; split rows by `adProduct.value` and never add different currencies. Keep v1 metrics (`metric.purchases/sales`) and any v3 fallback metrics (SP 7-day `purchases7d/sales7d`) apart, and state which API and attribution each number comes from. A pending or failed report is unknown, never zero. The last 1–3 days are still backfilling. If the user runs Amazon Marketing Stream, it must be v2 (v1 sunsets 2027-06-30).

## 收尾

执行过的改动、复盘时间（一般 7–14 天后）和回退条件用 `xander_archive_note` 记下；新确认的成本或利润底线用 `xander_archive_set_fact` 记下。规则见 [店铺档案](../xander-operations/references/business-context.md)。
