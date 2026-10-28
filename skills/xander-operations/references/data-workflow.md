# 取数方法与六模块验收

默认自动取数：先读已连接账户和档案，再按问题范围拉数据。不要把“导出报表发给我”当常规路径；只有接口给不了、或用户主动选择文件时才走文件导入。

## 工具速查

| 要什么 | 用什么 |
|---|---|
| 连接状态、已开开关 | `xander_status`（check=true 实测令牌） |
| 任意卖家接口 GET | `xander_spapi_get`（自动补站点参数；有 nextToken/paginationToken 就继续翻页；已弃用的旧版本会被拒绝并提示新路径） |
| 单个 SKU 的 Listing | `xander_listing_get` |
| 卖家报表 | `xander_spapi_report` action=request → 记下 reportId → action=collect |
| 广告对象列表 | `xander_ads_list`（SP/SB 走 Ads API v1 统一接口，SD 暂用原接口；自动翻页，返回 complete 标记） |
| 广告报表 | `xander_ads_report` action=request（v1 的 preset 或 fields；搜索词/投放/推广商品暂用 v3）→ action=collect |
| 档案（成本、箱规、交期、决策） | `xander_archive_overview` / `xander_archive_history` |
| 快速计算 | `xander_calc_ad_economics` / `xander_calc_replenishment` / `xander_calc_profit` |

大结果会自动存成本地文件并返回路径。**用代码读文件计算**（Codex/Claude Code 有执行环境），不要只看返回的开头部分就下结论。

## 常用卖家接口（只用最新版本，2026-10 核对）

- 库存：`/fba/inventory/v1/summaries`（details=true 看可售/预留/入库）；自发货看 Listing 的 fulfillmentAvailability。
- 订单：`/orders/2026-01-01/orders`（searchOrders：createdAfter 或 lastUpdatedAfter、fulfillmentStatuses、maxResultsPerPage、paginationToken；includedData 按需选 PROCEEDS/EXPENSE/FULFILLMENT/PROMOTION 等，BUYER/RECIPIENT 属受限个人信息，非必要不取）；单个订单 `/orders/2026-01-01/orders/{orderId}`。Orders v0 已弃用（2027-03-27 下线），插件会拒绝调用。
- 商品目录：`/catalog/2022-04-01/items/{asin}`（includedData=summaries,attributes,salesRanks）。
- 财务：`/finances/2024-06-19/transactions`（postedAfter/postedBefore 必须是有限期间，marketplaceId，transactionStatus）；余额 `/finances/2024-06-19/balances`、汇总 `/finances/2024-06-19/summary`。Finances v0 已弃用（2027-08-27 下线），插件会拒绝调用。
- FBA 入库：优先 `xander_fba_inbound`，按 resource 查计划、装箱/分仓/运输方案、货件、箱内商品和异步 operation；`complete=false` 不能当全量。区域计划列表按明确的 marketplaceIds 过滤到所选站点，原始页保留区域范围。箱唛/提单虽使用保留的 v0 GET，仍走 `fba.inbound` 审批，不能通用 GET 绕过。流程见 [FBA 入仓](../../../docs/fba-inbound.md)。
- 销售与流量：报表 `GET_SALES_AND_TRAFFIC_REPORT`（reportOptions: dateGranularity=DAY, asinGranularity=CHILD）。
- 搜索查询表现（品牌卖家）：`GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT`（reportOptions: reportPeriod=WEEK/MONTH/QUARTER, asin=空格分隔），必须是完整的自然周/月。
- 库存明细报表：`GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA`；全部 Listing：`GET_MERCHANT_LISTINGS_ALL_DATA`。

报表规则：同参数 12 小时内自动复用。`IN_QUEUE/IN_PROGRESS` 时隔几分钟再 collect，一次任务最多跟 3 次或 5 分钟，然后先交付已知部分并告诉用户 reportId。`CANCELLED` 通常是该期间没数据，`FATAL` 是失败——都不能当 0。

## 广告数据（2026-10 核对）

- **广告管理用 Amazon Ads API v1 统一接口**（SP、SB；官方正式版）。对象：`sp.campaigns / sp.adGroups / sp.ads / sp.targets / sb.campaigns / sb.adGroups / sb.ads / sb.targets`，快捷方式 `sp.keywords`（关键词投放）、`sp.negativeKeywords`（否定关键词）。v1 里关键词、商品、类目、自动投放、否定词都是 “target”，用 targetType 和 negative 区分；关键词文字在 `targetDetails.keywordTarget.keyword`，投放竞价在 `bid.bid`，广告组默认竞价在 `bid.defaultBid`，活动日预算在 `budgets[0].budgetValue.monetaryBudgetValue.monetaryBudget.value`。
- **SD 展示型**：官方还没发布 SD 的统一接口迁移资料，暂用原接口 `sd.campaigns / sd.targets`。
- SP/SB/SD 分开取、分开统计；一个 profile 只代表一个站点。
- **报表用 Reporting API v1**（官方仍标为测试版）：preset `campaigns`（按天、按活动）、`ad_groups`（按天、按广告组）、`campaigns_summary`（期间汇总），或自己传 `fields`（如 `campaign.id`、`adGroup.id`、`date.value`、`adProduct.value`、`budgetCurrency.value`、`metric.impressions/clicks/totalCost/purchases/sales/unitsSold`）。v1 报表一次覆盖 SP/SB/SD，用 `adProduct.value` 区分；如果提示是“全球广告账户”，结果可能含多个站点，按币种区分，不同币种不要相加。
- **搜索词、投放、推广商品报表**：v1 的字段名官方还没公开，preset `sp_search_terms / sp_targeting / sp_advertised_product` 会自动用 v3 报表并注明（v3 报表 2027-06-30 关停，届时插件会更新）。SD 没有搜索词报表，不要填 0。v3 的 SP 默认 7 天归因（purchases7d/sales7d）；v1 的 metric.purchases/sales 口径以官方说明为准，两者不要直接相加或对比。
- 最近 1–3 天的广告数据还在回填，不能当最终值。
- 字段被亚马逊拒绝（400）时，把错误原文告诉用户，按提示改 fields 重试一次；不要换成别的数据源硬凑。
- Amazon Marketing Stream 本插件不配置；如果用户自己要接，用 v2（v1 将于 2027-06-30 关停）。

## 跨模块对齐

retail 销量/会话、广告归因转化、SQP 购买/点击是三种不同指标。采购成本、头程、交期、站外费用、银行到账不在接口里——用档案里的有效记录，缺的单独列出。

## 六模块必须交付（工具输出之后继续做）

| 模块 | 必须交付 | 不能冒充完成的缺口 |
|---|---|---|
| 竞品 | 锁定可比变体/套装与价格日期；来源表；对比矩阵；买家问题与图片/详情页差异；有证据的机会 + 待核实项。用竞品技能的评分脚本。 | 只有价格差或评分数不等于完整竞品研究；没有页面证据标未完成。 |
| 关键词 | 原始来源与去重映射；意图/相关性/证据角色；核心、辅助、后台或待核实的依据；Listing 交接。用词库校验脚本。 | 搜索量重复不相加；候选词不凭空升格核心词；不同来源冲突保留。 |
| Listing | 按请求范围交付可复制稿件；买家问题→自有事实→词→字段对应表；保留/移除的主张；字数/字节/覆盖与规则审计。完整重写或 READY 必须跑技能的两个发布校验脚本。 | 没有类目规则和自有事实只能 PROVISIONAL/BLOCKED；没有主张清单不等于没风险。 |
| 广告 | 实际归因窗口/成熟状态；异常定位；完整成本经济线；活动/投放/广告位方案；精确动作、预算风险、验证窗口与回退条件。 | 只算 ACoS 不能下盈亏结论；缺搜索词/广告位数据不能臆造否词/调价；空输入必须列缺口。 |
| 补货 | 按 SKU/颜色的续航；到货前缺口时间线；可售在途依据；整箱数量、MOQ、分批/加急方案、采购现金占用和需求敏感性。 | 无单价时现金占用未知；无箱规不编箱数；不把在途当现货。 |
| 利润 | 收入→费用→经营利润桥接；净额重复抵扣检查；预估与最终结算分开；缺失凭据；结算/到账差异与追查顺序。 | 基础费用缺项只能叫小计；没有结算/银行记录不能说已对账。 |

每个模块的完成状态由实际输出和证据决定，不因工具调用成功而填“完整”。数据不足时完成结构和已知部分，列出具体未完成项。
