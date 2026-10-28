# FBA 入仓流程（2.4）

本功能处于 Beta；真实账户已验证读取，真实写入需要在用户明确批准的首批货件上逐步验证。它把商品送进 Amazon FBA 仓库，和给消费者寄多渠道配送 MCF 订单是两条流程。写入仅开放 **NA 区域美国站、先装箱流程**；NA/EU/FE 的已配置站点可只读查询。暂不提供取消计划、采购下单、自动连续执行或未知结果重试。

## 接入和开关

SP-API 应用需要 **Amazon Fulfillment** 角色及目标卖家授权。已有库存/计划 GET 成功只能证明这些读接口可用；不证明所有写接口、商品资格或承运选项都可用。如实际请求返回权限不足，核对开发者角色审批、应用所选角色及卖家重新授权，通过本机 `xander setup` 更新，密钥不要贴进聊天。

在 `xander panel` 单独打开“创建与管理美国站 FBA 入仓计划和货件”。它默认关闭，不随“一键全开”启用；AI 不能代拨。开关打开不等于批准某批货件或某笔费用。每一步仍须生成精确提案、展示原值/目标/费用、获批、执行一次、独立回读。

## 开始前需要本批事实

先读档案及当前库存，再向用户补缺项：卖家与站点、发货名称、发货人/电话/完整地址、本批 SKU 与数量、贴标和预处理责任、逐箱内容/箱数/三边尺寸与单位/重量与单位、适用的有效期和批号、备货日期、实际运输方式及联系信息。托盘或合作承运的附加字段按方案要求补齐。不能假设历史箱规仍适用于本批，不能把未知运费当零。

美国站不接受 Amazon 代贴标或预处理；`SELLER` / `NONE` 必须来自事实，不能为了通过校验随意选择。创建计划要求本地唯一非空名称及完整官方请求体，不自动补默认值。

## 查询

`xander_fba_inbound` 参数为 `store`、`marketplace`、`resource`，按资源提供 `inboundPlanId`、`shipmentId`、`packingGroupId` 或 `operationId`；分页和选项筛选放在 `filters`。

| resource | 返回内容 |
|---|---|
| plans / plan | 计划列表 / 单个计划 |
| planItems / planBoxes | 全计划商品 / 箱子 |
| packingOptions / packingGroupItems / packingGroupBoxes | 装箱方案 / 分组商品 / 分组箱子 |
| placementOptions / transportationOptions | 分仓方案 / 运输方案与报价 |
| shipment / shipmentItems / shipmentBoxes / shipmentPallets | 货件 / 商品 / 箱子 / 托盘 |
| deliveryWindowOptions / operation | 到仓窗口 / 原异步任务状态 |

工具不会生成尚不存在的选项。`complete=false` 表示没有取得全量；从中途分页令牌开始也不代表完整范围。计划列表 API 是区域级，工具按每个计划的明确站点过滤；`rawPages` 仍保留区域原始证据，不能冒充单站点列表。

## 每份提案一个动作

统一 op 为 `fba.inbound`。路径 ID 放在改动顶层；官方请求体原样放 `body`；无请求体的动作不得传 body。每次只能准备一个 FBA 动作，不能和广告或其他动作混成一份提案。

| action | 所需内容与批准边界 |
|---|---|
| createInboundPlan | `body`：name、destinationMarketplaces、sourceAddress、items；只创建计划 |
| generatePackingOptions | inboundPlanId；生成装箱候选 |
| confirmPackingOption | inboundPlanId、packingOptionId；明确装箱分组、费用与折扣 |
| setPackingInformation | inboundPlanId；body.packageGroupings 包含完整箱规/重量/商品；本版只用 BOX_CONTENT_PROVIDED |
| generatePlacementOptions | inboundPlanId；美国站 body 为 `{}`；先完成全部装箱并核验 |
| confirmPlacementOption | inboundPlanId、placementOptionId；批准仓库/货件分配与分仓费，确认后不能切换 |
| generateTransportationOptions | inboundPlanId；body 中指定 placementOptionId 和全部货件的运输配置；仅生成候选报价 |
| generateDeliveryWindowOptions | inboundPlanId、shipmentId；生成候选到仓窗口 |
| confirmDeliveryWindowOptions | inboundPlanId、shipmentId、deliveryWindowOptionId；确认有效窗口 |
| confirmTransportationOptions | inboundPlanId；body.transportationSelections 覆盖全部选定货件；**合作承运会接受报价、授权扣费并请求承运** |
| updateShipmentTrackingDetails | inboundPlanId、shipmentId；body.trackingDetails；仅已确认自选承运，小包须覆盖全部独立箱号；仅支持小包与 FREIGHT 货运模式，海运跟踪暂不写入 |
| generateLabels | inboundPlanId、shipmentId；body 为打印参数；即使 HTTP GET 也需批准，只生成标签文件，不宣称 READY_TO_SHIP 或实际发运 |
| billOfLading | inboundPlanId、shipmentId；无 body；仅已确认合作承运的适用货运方式 |

先装箱时，分仓确认前 packageGroupings 用 `packingGroupId`，确认后用 `shipmentId`，不能混用；必须覆盖当前方案的全部分组或货件。每箱商品数量乘相同箱子的 `quantity` 后必须和计划分组相符。

运输请求包含托盘时，本版要求完整托盘尺寸、重量、数量和可堆叠性；生成后回读逐项核验，不把缺字段当成功。

选项的到期时间、费用、币种、承运方式和前置条件须完整。运输方案要求 `CONFIRMED_DELIVERY_WINDOW` 时先确认窗口；不得跳过。确认运输前必须确认分仓，且一次覆盖选定方案的全部货件。开关或审批不能替代商品/承运资格。

打印使用保留的 v0 labels / billOfLading 端点及 `shipmentConfirmationId`（FBA 开头），不能把新版内部 shipmentId 当箱唛货件号。下载链接短时有效，插件取得后立即保存私有 PDF 文件并记录校验值；下载失败不自动重新生成；DOCUMENT_NOT_SAVED 表示平台已返回生成响应但本机没有保存可用文件，需另行批准再获取。[官方入仓指南](https://developer-docs.amazon.com/sp-api/docs/create-an-inbound-shipment) 明确说明：通过 getLabels 获取箱唛不会把货件变为 ready_to_ship，需在 Send to Amazon 中生成标签才能进入该状态。本版 UNIQUE 要求逐箱独立 boxId/quantity=1；不推造箱号。PALLET 的托盘数须明确批准，并与当前货件托盘清单数量匹配；缺数量不能假设为 1。支持的打印字段与限制以 `xander_switches` 参数和校验结果为准。

## 状态与恢复

每次发请求前持久化“正在发送”检查点，返回 operationId 后保存原回执。202 / SUBMITTED 只表示已受理；IN_PROGRESS 时用 `xander_verify_change` 只查原任务。SUCCESS 还必须独立读取计划、数量、箱规、方案或跟踪内容，与批准范围匹配后才报告 API_STATE_VERIFIED。

断网、超时、408/409/5xx、缺回执或部分成功一律保留防重。不能换名称、改数量、换提案重复创建；同一计划的待核验动作也阻止后续动作。创建回执缺计划/任务 ID 时，不能凭同名对象认领成功。异步失败仍需核对可能生成的对象，不能自动重跑或自动解锁。

计划/货件创建、标签准备、承运商实际揽收、到仓接收、可售分别报告。`READY_TO_SHIP` 不等于已发运；跟踪号录入不等于平台验证通过；第三方运费没有 Amazon 报价也不等于免费。

## 验证范围与官方依据

实现及合成测试固定官方模型提交 `6ff4ad1fddb377a8febd5a8a300575703d6ca93e`（2026-10-28）。测试覆盖请求结构、分页/归属、审批、防重、异步回执与独立回读，不替代真实批次资格及真实提交验证。

- [Fulfillment Inbound v2024-03-20 官方模型](https://github.com/amzn/selling-partner-api-models/blob/6ff4ad1fddb377a8febd5a8a300575703d6ca93e/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json)
- [保留的 v0 标签/提单官方模型](https://github.com/amzn/selling-partner-api-models/blob/6ff4ad1fddb377a8febd5a8a300575703d6ca93e/models/fulfillment-inbound-api-model/fulfillmentInboundV0.json)
