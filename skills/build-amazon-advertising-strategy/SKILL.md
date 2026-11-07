---
name: build-amazon-advertising-strategy
description: "核算亚马逊站内广告盈亏线，设计或审计 SP/SB/SD 广告，交叉诊断广告位、关键词排名、同屏竞品和详情页证据；区分新品学习期与成熟期优化；经用户批准后可调整竞价、预算、开停和否词。Calculate Amazon onsite ad break-even, design or audit campaigns. 不做站外引流、Listing 文案或采购。"
---

# 亚马逊站内广告

先判断这个产品付不付得起广告，再按用户要的深度做方案或复盘。用简洁中文，先给结论。

## 开始

1. 本会话没调过就先 `xander_status`；再 `xander_archive_overview`（传 sku/asin）读采购价、头程、利润底线、库存约束、上次的广告决策和最近执行过的改动，档案有的不再问。
2. 按问题选最小交付，只读需要的参考：

| 用户要的 | 怎么做 / 读什么 |
|---|---|
| 能不能做广告、盈亏 ACoS/CPC | `xander_calc_ad_economics`；细节见 [economics-calculation.md](references/economics-calculation.md) |
| 广告表现复盘（变好/变差、哪里亏） | `xander_ads_report` 申请并 collect → `xander_ads_report_rows` 汇总 → 原样交 `xander_review_ad_performance`；解读见 [performance-diagnosis.md](references/performance-diagnosis.md)，只读审计见 [read-only-review.md](references/read-only-review.md) |
| 老品优化方案/诊断 | [existing-product-optimization.md](references/existing-product-optimization.md) |
| 新品推广方案、节奏 | [new-product-launch.md](references/new-product-launch.md) |
| 广告位、排名、同屏竞品联查 | [placement-and-competitor-cross-diagnosis.md](references/placement-and-competitor-cross-diagnosis.md) |
| 预算上限、学习亏损、流量就绪 | [economics-and-budget-gates.md](references/economics-and-budget-gates.md)（先算经济线） |
| 利润底线、价格阶段、库存/补货约束 | [operating-context-and-replenishment.md](references/operating-context-and-replenishment.md) |
| 季节窗口、季末消化 | [季节决策复核](../xander-operations/references/seasonal-decision-review.md) |
| 近 1–3 天/分时、Marketing Stream | [hourly-data-and-attribution.md](references/hourly-data-and-attribution.md) |
| 品牌分析关键词份额、链接成熟度 | [keyword-share-and-link-maturity.md](references/keyword-share-and-link-maturity.md)；我方与竞品同词表现对标交 `analyze-amazon-competitors` |
| 自然流量、子 ASIN 转化、零售与广告覆盖 | [business-traffic-and-coverage.md](references/business-traffic-and-coverage.md) |
| 报表复用、快照与输入版本 | [report-reuse-and-input-versions.md](references/report-reuse-and-input-versions.md) |
| AMC 路径/重叠/频次 | [amazon-marketing-cloud.md](references/amazon-marketing-cloud.md) |
| 资格、费用、促销、Vine、评论政策 | [policy-permissions-and-onsite-support.md](references/policy-permissions-and-onsite-support.md) |
| 跨模块 ASIN 诊断、实验复盘 | [诊断与行动复盘](../xander-operations/references/diagnostic-action-review.md) |
| **正式完整方案、结构化策略包、准备/执行账户改动、声称 READY** | 先完整读 [core-rules.md](references/core-rules.md)，再按需读 [full-strategy-workflow.md](references/full-strategy-workflow.md)、[input-and-output-contract.md](references/input-and-output-contract.md) |

窄问题不要求完整方案；单个调价/否词只需该动作相关的证据，加价/加预算仍需经济线和库存依据，降暴露不必补齐盈利证明。

## 底线

- 缺的数字是 null 不是 0；生成中或失败的报表是“未知”。最近 1–3 天还在回填。第三方估算标 ESTIMATED，模拟标 SIMULATED / NOT LIVE。
- SP、SB、SD 分开；不同站点、币种、v1 与 v3 指标不相加不对比，写明每个数来自哪个接口和归因口径。列表 `complete=false` 时结论只算部分。
- 目标是在利润底线、可承受亏损和库存约束内多赚贡献利润，不是固定 ACoS。没有转化率不给 CPC 上限，成本不全不下盈利结论。日预算不是总亏损上限。
- 0 单不等于该否词：先看搜索词相关性和商品转化问题。低 ACoS 不等于该放量：先看库存和利润。
- 不建议刷单、索评、操纵或删除差评、攻击竞品；不保证排名、评论或利润。
- 只改广告；不借广告权限改 Listing、价格、优惠券、库存或采购。

## 改账户

只走一条路（[写入安全](../xander-operations/references/write-safety.md)）：`xander_prepare_change` 出精确提案 → 把新旧值表完整给用户 → 用户对这一份说“批准” → `xander_execute_change` → 看回读。“帮我优化一下”或开关已打开都不算批准；开关只有用户能开。`xander_switches` 里没有的动作（例如分时调价）直接说做不了并给手动步骤。可用操作和组合提案规则见 [core-rules.md](references/core-rules.md)。

## 收尾

执行过的改动、最早复盘日期和回退条件用 `xander_archive_note` 记下；用户手动改的也记下理由（不知道就不编）。新确认的成本或利润底线用 `xander_archive_set_fact`。完整收尾规则见 [core-rules.md](references/core-rules.md#收尾完整)。
