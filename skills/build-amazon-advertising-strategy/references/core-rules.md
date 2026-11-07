# 广告技能完整规则（原 SKILL.md 正文，内容未删改）

出正式方案（PLAN/REFRESH/结构化策略包）、准备或执行账户改动、或要声称 `PLAN_READY` / `READY_FOR_EXECUTION_REVIEW` 前，完整读本文件。窄问题（单个经济线、只读诊断）按 SKILL.md 路由读对应参考即可。

## 工具与接口细节

- 取数：广告对象 `xander_ads_list`（SP/SB 走 Ads API v1 统一接口：sp.campaigns / sp.adGroups / sp.ads / sp.targets / sp.keywords / sp.negativeKeywords / sb.*；SD 暂用原接口 sd.campaigns / sd.targets）；广告报表 `xander_ads_report`（Reporting API v1：preset campaigns、ad_groups、campaigns_summary 或自定 fields；搜索词 sp_search_terms、投放 sp_targeting、推广商品 sp_advertised_product 暂自动用 v3，2027-06-30 关停）；总销售与转化用 `xander_spapi_report` 的 GET_SALES_AND_TRAFFIC_REPORT。SP、SB、SD 分开统计。字段位置和口径见 [取数方法](../../xander-operations/references/data-workflow.md)。
- `campaigns_summary` 也按天返回，下载后不会自动汇总期间总计；先核对日期覆盖，再按账户/站点、广告产品、活动和币种聚合。期间比率用汇总后的分子和分母重算，详见 [取数方法](../../xander-operations/references/data-workflow.md)。
- 快速经济线：`xander_calc_ad_economics`；广告表现复核：先 `xander_ads_report` collect 得到日维度报表文件，再用 `xander_ads_report_rows`（传 file、entityType、current/baseline 窗口、profile 时区）自动汇总成 `reviewInput`，原样交给 `xander_review_ad_performance` 重算指标并形成待核行动；不要手工抄报表行，不自动调整账户。需要利润/库存判断时只在对应行补已核实的 economics/inventory。完整计算与策略包校验用本技能 scripts 里的 Python 脚本（宿主能执行代码时）。
- 未知数字是 null，不是 0；第三方估算标 ESTIMATED；模拟结果标 SIMULATED / NOT LIVE。用简洁中文回答。
- 改账户只走 [写入安全](../../xander-operations/references/write-safety.md)：`xander_prepare_change` → 用户批准这一份 → `xander_execute_change` → 回读。可用操作：SP 活动开停/日预算、广告组开停/默认竞价、投放竞价/开停（关键词、商品、自动投放统一用 targetId）、广告商品开停、新增关键词、新增否词（广告组级/活动级）；SB 活动开停/日预算、投放竞价/开停；SD 活动开停/预算、投放竞价/开停（原接口）。SP 新建、位置加价、预算规则和投资组合按 [当前工具范围](../../../docs/v2.3-features.md) 及 `xander_switches` 的实际参数使用。预算时间规则不等于分时竞价；本版没有排程 bid 的写入操作。开关只有用户能开。
- 选品已冻结：新建结构化策略包时 `lineage_mode` 用 `INDEPENDENT_NEW`（新品）或 `INDEPENDENT_EXISTING`（老品），不要新建 `FULL_WORKFLOW`；历史完整链路按原证据保留。旧“交回 `$select-amazon-products`”应按根因改路由：利润核算交 `reconcile-amazon-profit`，在售库存/补货交 `plan-amazon-replenishment`；超出这些运营范围的产品定位、合规或立项判断交用户复核，本插件不做选品（见 [追溯规则](../../xander-operations/references/lineage-and-selection.md)）。

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

## Loading rules

Load each applicable reference in full. A narrow result does not inherit a full-package status.

For standalone `ECONOMICS_ONLY`, read only the calculation reference plus context/policy only if they affect that calculation; a serialized strategy-contract economics package also needs the input/output contract. A narrow `AUDIT` or `REFRESH` loads its question-specific evidence modules. Full `PLAN`, full-plan `REFRESH`, and serialized strategy/change packages use the full workflow and its applicable dependencies. Incomplete packages cannot claim ready.

An exact supported scalar change follows the existing prepare/approval/execute/readback contract plus the evidence relevant to that action. It does not require a full architecture, five-phase strategy or unrelated Vine/review-support package. Bid/budget increases still need supported economics, effective bid exposure and applicable stock/cash limits; reducing exposure does not require inventing missing profitability. Do not claim full-package validation for this narrow route or use it to bypass the execution handler's checks.

Placement/competitor cross-diagnosis is a narrow Ads review: reuse dated keyword rank/SERP and competitor offer/page evidence where available, and request only missing relevant evidence. Their research roles and lists remain unchanged. Align source scopes; do not invent a query × placement × competitor attribution table. A complete existing-product review must pass the placement completeness gate in its product-mode reference; otherwise label it partial.

Own/competitor exact-query CTR/CVR trends, query purchases and parent/child sales benchmarking are not done here: the benchmark itself belongs to `analyze-amazon-competitors` ([表现对标](../../analyze-amazon-competitors/references/query-performance-benchmarking.md)). This skill only consumes its finished handoff through [keyword-share-and-link-maturity.md](keyword-share-and-link-maturity.md) when an ad decision needs it; keep estimates separate from actual Ads CVR. Cross-module ASIN diagnosis reuses this skill's original evidence, economics and strategy IDs, not a replacement strategy schema. Seasonal reviews reuse existing product-mode stages and package fields.

## Shared constraints

- State marketplace, currency, timezone, ASIN/SKU/variation, offer and reporting window. Keep missing values `null`, not zero, and avoid merging incompatible scopes or inventing IDs/costs. First-party account/report evidence outranks estimates. Reuse compatible upstream SellerSprite evidence; for a material estimate gap use its paid MCP first when available and allowed, preserving raw scope and `ESTIMATED` label. Do not silently substitute another source.
- Separate Brand Analytics query/market share from Ads attribution. Neither proves advertising caused organic or total-sales change. Separate current effective from planned price, and PPC from discounts, promotion/Vine costs and cash/inventory. No CPC ceiling without CVR; no profit claim without complete costs.
- Optimize contribution within the user's profit floor, approved cash/loss capacity and stock constraints; fixed ACoS/TACoS is not a default objective. Above-break-even learning loss needs explicit scoped approval. A daily budget is not a total-loss cap. Preserve upstream evidence IDs, research roles, operating-context hashes and content locks; add advertising decisions separately. Risk acceptance does not make evidence, eligibility, Listing or inventory ready.
- Amazon onsite scope requires actual account-level Amazon-only delivery control and current official support for each included format. An ad-product name alone is insufficient. Exclude an unverified format from a ready plan. Never propose fake orders, review incentives/gating, positive-review requests, family/friend/employee reviews, competitor sabotage or changing/removing negative reviews; never guarantee reviews, ranking or profit. Verify current Vine/native Request a Review eligibility when used.
- This Skill's executable changes are Amazon Ads only. Ads permission does not authorize Listing, price/Coupon, Vine, stock, purchasing, freight or off-Amazon actions.

## Authority and completion

Default analysis/planning to `PLAN_ONLY`; reading reports or an opened switch does not authorize mutation. A current exact user instruction or approval of a displayed exact proposal authorizes execution of that proposal only. Bind it to current account/marketplace, entities, old/new values and safety limits; ask only for material missing, changed or expired scope. Archive/delete is not offered by this plugin.

Each operation must follow its actual handler contract and the exact approved proposal. Ordinary scalar edits change one field of one entity; supported composite operations such as placement settings, budget rules and campaign creation may contain several explicitly approved fields or dependent entities. Preserve unspecified state and expose all affected scope. A proposal containing a target-bid change and a placement change is not an atomic transaction: inspect execution/readback results before treating the intended combination as applied. Do not pause/re-enable as an implementation shortcut; enabling, pausing and creation need their own explicit scope. If the needed action is absent from the actual `xander_switches` capability list (for example scheduled bid changes), state that limitation and provide a concrete handoff; do not improvise another channel without the user's choice (see [紫鸟兜底](../../xander-operations/references/ziniao-fallback.md)).

For supported math use [calculate_ad_economics.py](../scripts/calculate_ad_economics.py); for full strategy/change JSON use [validate_ad_strategy_package.py](../scripts/validate_ad_strategy_package.py). Narrow output needs applicable evidence, arithmetic and scope QA. Full packages must fix hard failures or lower status; do not call an incomplete package a memo while claiming readiness. `PLAN_READY` is plan-only; `READY_FOR_EXECUTION_REVIEW` is unexecuted. The local validator returns `execution_authorized=false` even if structure passes: execution still requires the user's approval of the exact `xander_prepare_change` proposal, the matching switch turned on by the user, and post-change readback.

## Complete advertising coverage

Read SP, SB and SD separately and keep per-product coverage and enabled/paused/archived counts separate; counts belong to the selected profile (one marketplace), not all countries. `xander_ads_list` reports `complete=false` when pages remain — then the conclusion is partial. Reporting API v1 returns SP/SB/SD together; split rows by `adProduct.value` and never add different currencies. Keep v1 metrics (`metric.purchases/sales`) and any v3 fallback metrics (SP 7-day `purchases7d/sales7d`) apart, and state which API and attribution each number comes from. A pending or failed report is unknown, never zero. The last 1–3 days are still backfilling. If the user runs Amazon Marketing Stream, it must be v2 (v1 sunsets 2027-06-30).

## 收尾（完整）

执行过的改动、按样本积累/归因回填/报表可得时间确定的最早复盘时点与回退条件，用 `xander_archive_note` 简记。用户手动改价、改图、改广告也记录其明示理由、取舍、时间、实际证据及后续结果；未知理由不编造，不补成工具执行回执。需要关联诊断与动作的追加式复盘时，按 [诊断与行动复盘](../../xander-operations/references/diagnostic-action-review.md) 使用本地账本，分开记录平台回读和描述式经营结果，不因经过固定天数就宣称效果已验证。日期记录不会创建监控；恢复原值仍需新的当前精确审批。新确认的成本或利润底线用 `xander_archive_set_fact` 记下，规则见 [店铺档案](../../xander-operations/references/business-context.md)。
