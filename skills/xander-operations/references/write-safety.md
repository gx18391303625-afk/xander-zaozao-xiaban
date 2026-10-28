# 写入安全：开关、提案、执行、回读

## 三道闸

1. **开关**：每一类写入一个开关，默认全关。只有用户本人在 `xander panel`（或终端里手动确认的 `xander switch on`）能打开。你只能用 `xander_switches` 查看。不要尝试任何绕过方式（改 `switches.json`、在后台运行开关命令、调用面板接口）——这些都等于未经授权改动用户的账户。
2. **精确提案 + 明确批准**：`xander_prepare_change` 生成的表格原样给用户看；用户对这一份提案说“批准/确认执行/可以执行”才算批准。“优化一下”“你看着办”“开了开关”“连接成功”都不是批准。
3. **安全上限**：竞价、预算、售价单次改动超过面板里设的幅度，提案会直接被拒；需要大幅改动时让用户自己去面板调上限，并说明风险。

可选的第四道闸：用户在面板里选“面板审批”后，还必须在面板点“批准”。

## 可用的写入操作（op）

用 `xander_switches` 查看完整列表和参数。当前包括：

- SP 商品推广（Ads API v1）：活动开/停与日预算、广告组开/停与默认竞价、投放竞价与开/停（关键词、商品、类目、自动投放都是“投放 target”，用 targetId）、广告商品开/停（adId）、新增关键词、新增否定关键词（广告组级或活动级）。
- SB 品牌推广（Ads API v1）：活动开/停与日预算、投放竞价与开/停。
- SD 展示型（Beta，暂用原 SD 接口）：活动开/停与预算、投放竞价与开/停。
- Listing：标题/Item Highlights 亮点/五点/描述/后台词（`listing.attribute`）、售价（`listing.price`）、自发货库存（`listing.fbmQuantity`）。亮点对应 `title_differentiation`，标题对应 `item_name`；使用真实商品类型定义和 Amazon 预校验确认字段支持，不能互相替代。
- 紫鸟浏览器代操作（`ziniao.control`，单独开关）。

- FBA 入仓（`fba.inbound`，独立开关）：美国站计划、装箱/分仓、运输、窗口、跟踪与标签/提单，每份提案仅一个动作；具体边界见 [FBA 入仓](../../../docs/fba-inbound.md)。

修改字段只提交获批范围；创建或流程动作按对应接口的完整精确请求审批。归档、删除不提供。新建广告、广告位、预算、图片、A+ 和优惠券按 [实际能力](../../../docs/v2.3-features.md) 执行；优惠券仍为网页交接，不能假称接口写入。

## 提案怎么写

`changes` 每项一个对象，例如：

```json
{"op":"ads.sp.target.bid","targetId":"123456","value":0.85,"reason":"近14天ACoS 62%，高于盈亏线45%"}
{"op":"ads.sp.negativeKeyword.create","campaignId":"1","adGroupId":"2","keywordText":"cat bowl","matchType":"EXACT","reason":"花费$18无单，与产品无关"}
{"op":"ads.sp.campaign.budget","campaignId":"1","value":30,"reason":"…"}
{"op":"listing.attribute","sku":"BOWL-BLUE","attribute":"bullet_point","value":["…","…","…","…","…"],"reason":"…"}
{"op":"listing.attribute","sku":"BOWL-BLUE","attribute":"title_differentiation","languageTag":"en_US","value":"已批准的亮点原文","reason":"仅更新已批准的 Item Highlights"}
{"op":"listing.price","sku":"BOWL-BLUE","value":21.99,"reason":"…"}
```

一个提案里只要有一项不合格，整个提案都不生成（防止“部分改了部分没改”）。修正后重新提交。

文案变更限定为一个属性、目标站点及语言；保留同属性的其他站点/语言实例及其他属性。`xander_listing_get` 可独立读取当前值，无需提案或批准。准备文案提案会调用 Amazon `VALIDATION_PREVIEW`；亮点额外读取真实 PTD 确认字段支持与基础结构，完整条件规则交给 Amazon 预校验。准备阶段不正式写入；演练执行只记录 `DRY_RUN`。当前值与新内容一致时不生成提案，应报告“内容已一致”，不得擅自改文案制造差异或声称本次提交成功。字段映射、预校验和回读边界见 [文案属性流程](../../../docs/listing-attributes.md)。

## 结果状态

| 状态 | 意思 | 你该怎么做 |
|---|---|---|
| API_STATE_VERIFIED | 本次动作的接口状态已匹配 | 报告准确范围；FBA 不等于已发运、接收或可售，内容不等于买家页已显示 |
| SUBMITTED | 异步动作已受理、尚未完成 | 只核验原 operation，不重新提交 |
| PARTIALLY_SUCCEEDED | 已有部分结果或仍需核查影响范围 | 保留回执和防重锁，人工核对，不自动续跑 |
| AWAITING_READBACK | 已提交，回读还没变（Listing 常见） | 过一段时间 `xander_verify_change` |
| MISMATCH | 回读值与批准值不同 | 如实报告，别自行再改 |
| FAILED | 亚马逊明确拒绝 | 报告原因，修正后重新出提案 |
| OUTCOME_UNKNOWN | 超时/断网，不知道是否生效 | **绝不重发**，用 `xander_verify_change` 查清 |
| SKIPPED_STALE | 执行前发现原值已被改 | 重新读取、重新出提案 |
| DOCUMENT_NOT_SAVED | 文档生成响应已取得，本机没有可用 PDF | 不重发；重新获取需另行审批 |
| DRY_RUN | 演练模式 | 告诉用户这只是演练 |

“API 已生效”不等于买家页面已显示，也不等于效果已出现。效果复盘要等足够的数据窗口（广告一般 7–14 天）。

## 记录

每次执行都写进本机 `ledger.jsonl`，用户可以在面板或 `xander log` 查看。执行完把结论和复盘时间记到档案：`xander_archive_note` kind=decision 或 todo。
