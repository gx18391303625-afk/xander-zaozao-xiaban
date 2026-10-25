---
name: reconcile-amazon-profit
description: "核算亚马逊商品经营利润、期间费用与结算差异；区分日常预估、正式复盘和最终对账。不负责广告调价、采购或站外投放。"
---

## 数据与工具

- 本会话还没调过就先 `xander_status`；先 `xander_archive_overview` 读每个 SKU 的采购价、头程、其他单件成本（按生效日期取对应期间的值，`xander_archive_history` 可查历史）。
- 取数：财务交易 `xander_spapi_get` → `/finances/2024-06-19/transactions`（postedAfter/postedBefore 必须是有限期间；旧版 finances/v0 已弃用，插件会拒绝）；结算报表用 `xander_spapi_get` → `/reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2` 列出系统已生成的报表，再用 `xander_spapi_report` action=collect 下载；销售用 GET_SALES_AND_TRAFFIC_REPORT；广告费用 `xander_ads_report`。方法见 [取数方法](../xander-operations/references/data-workflow.md)。
- 快速利润桥：`xander_calc_profit`（逐项标 INCLUDED/NETTED/EXTRA_PAID/ESTIMATED/UNKNOWN/USER_EXCLUDED；缺核心项只给小计）。
- 本技能只读，不改账户。
- 未知数字是 null，不是 0；模拟结果标 SIMULATED / NOT LIVE。用简洁中文回答。

# 亚马逊经营利润与对账

回答用户实际问的问题。单项费用、单个 SKU 或粗算只做足以支持该结论的核查；不要因出现“利润”二字启动全账取数，也不新增强制运营阶段。先明确账户/站点、业务时区、期间及是否已闭合、币种、SKU/子 ASIN 与父体覆盖、销量/销售额口径；当日估算允许未闭合窗口但注明截止时点，不能冒充完整日。以原始证据为准，记录来源、采集时间和回填状态；项目状态文档是索引，历史报告不是当前数据。

按请求选一种交付深度：

| 模式 | 适用 | 可声称的结果 |
|---|---|---|
| `ESTIMATE` | 粗算、日常订单预估或用户指定情景 | 有依据的暂定订单利润；缺核心成本时仅为已知收支小计 |
| `REVIEW` | 正式期间利润复盘、SKU 比较、成本归属检查 | 期间经营利润或部分结果，逐项标明估算、未成熟和未对平差异 |
| `SETTLEMENT` | 最终利润、结账、打款/账单对账 | 仅在实际成本归属、交易生命周期和结算覆盖对平后给最终值 |

估算读[日常预估与计算入口](references/estimate.md)；正式期间复盘读[期间利润与分摊](references/period-review.md)；最终结算再读[结算与退款核销](references/settlement.md)。模式可逐级升级，但旧结论不因新模式请求自动变成实绩。明确的“预估利润”仍走 `ESTIMATE`。

当利润结果用于季节品放大、改价、促销或清货决策时，将对应价格/费用情景、利润底线、现金占用和回款时间交给[季节品共同决策与复盘](../xander-operations/references/seasonal-decision-review.md)联合核对。销售收入不等于可支用回款，旧价利润不能证明新促销仍可行；单项利润查询无需启动整套季节复盘。本模块提供财务依据，不据此批准或执行其他模块动作。

## 共同口径

- 金额用 Decimal 或整数最小货币单位计算；统一币种前保留原币、汇率来源/日期与换算过程。不得用 GMV ÷ 净销售额倒推汇率。区分订单销售、净销售、广告归因销售、Net Proceeds、结算打款及利润；比率写明同范围分母。销售/订单项/件数/去重订单不可互称。
- 每笔金额只进一个位置：`INCLUDED` 已计入，`NETTED` 已含在另一净额中，`EXTRA_PAID` 另有真实付款待归属，`ESTIMATED` 有依据的未结算估计，`UNKNOWN` 缺证据，`USER_EXCLUDED` 本次用户指定排除。记录交易/账单 ID、期间、SKU、原币、金额符号、证据与纳入位置。`NETTED` 不再扣；`EXTRA_PAID` 先核查是否已资本化或账内扣过；未知不是零。用户本次排除项不自动延续到最终总账。
- 成本只在匹配商品和期间后归属；库存采购付款是现金流，售出单位对应的采购及可资本化头程才是该期销售成本。入仓运费、服务费、广告账单及净回款先检查是否与其他分项重复。真实退款、退款处理费、实物退货、可售恢复和后续赔偿分开记。
- 先复用适用的已保存一方数据和完成结果；核对日期、范围、状态、版本及内容哈希。工具“可调用”与本次“已取得并核验数据”分开。异步报告保存申请 ID 并有限接续；`PENDING/PROCESSING`、空子表、未覆盖日或归因回填不能记作零。只读查询也按当次任务和项目专用取数限制执行。
- 核心收入、平台/履约费、广告、售出成本、退款或必要分摊缺失时，展示已知收支小计和缺口，不将小计、净回款或银行余额命名为利润。差额保留显式残差，绝不靠无来源调整凑平。按 SKU 给简表与合计，注明期间、币种、来源和状态；只在用户要求时制作或修改工作簿。

本 Skill 管利润与对账，不据此决定广告结构、出价、预算、售价、采购、库存或站外活动。分析不授权账户写入、付款、消息发送或发布；需要这些操作时按用户另行明确授权与对应工作流处理。

## 收尾

用户新确认的成本（含批次和生效日期）用 `xander_archive_set_fact` 记下；对账结论、未对平差异和追查待办用 `xander_archive_note` 记下。规则见 [店铺档案](../xander-operations/references/business-context.md)。
