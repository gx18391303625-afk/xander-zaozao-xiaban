# 预算规则与投资组合

本模块包含两个默认关闭的操作开关：`ads.budgetRules` 与 `ads.portfolio`。两者接入同一套精确提案、审批、演练、执行日志和独立回读。开发测试没有修改任何真实广告账户。

## 已实现范围

| 操作 | action | 实际行为 |
|---|---|---|
| `ads.budgetRules` | `create` | 创建 SP 预算规则；可随后依次关联最多 25 个指定活动 |
| `ads.budgetRules` | `update` | 完整编辑规则详情或调整 `ACTIVE` / `PAUSED`；提案列出现有关联活动 |
| `ads.budgetRules` | `associate` / `disassociate` | 已有规则与指定 SP 活动建立或解除关联 |
| `ads.portfolio` | `create` | 创建投资组合；可随后把指定 SP 活动归入新组合 |
| `ads.portfolio` | `update` | 修改名称或预算上限：`DATE_RANGE`、`MONTHLY_RECURRING`、`NO_CAP` |
| `ads.portfolio` | `assign` | SP 活动转移到已有组合；明确传 `portfolioId:null` 则移出组合 |

规则支持日期范围、`DAILY` 频率、按百分比增加预算，以及 `SCHEDULE` / `PERFORMANCE` 两种类型。SP 绩效指标支持 `ACOS`、`CTR`、`CVR`、`ROAS`。日内时段仅支持 US、CA、UK、IN、JP 的时间规则。绩效或日内规则能否被评估还受最低预算和数据资格影响，提交成功不能证明规则已经触发。[官方绩效规则指南](https://advertising.amazon.com/API/docs/en-us/guides/rules/budget-rules/performance-based)、[官方时间规则指南](https://advertising.amazon.com/API/docs/en-us/guides/rules/budget-rules/schedule-based)

不支持的输入会被明确拒绝：SB/SD 规则、全球托管活动、推荐事件规则、每周规则、组合归档、余额共享设置。官方 SP 合约当前将 `RecurrenceType` 枚举为 `DAILY`，但指南仍有 `WEEKLY` 示例；本版遵循可核实合约，不试发冲突字段。这些范围可交给广告后台人工完成，不依赖紫鸟。投资组合预算影响组合内全部广告类型；本模块修改活动归属的范围为 SP。

组合编辑会完整查询 SP、SB、SD 的关联活动，将全部名单加入审批内容；任何一类权限失败或分页不完整都会阻止编辑提案。执行前及执行后核对影响范围，出现新增/移出活动时不能把旧审批范围标为已验证。SD 查询使用官方 `GET /sd/campaigns` 的 `portfolioIdFilter`、`startIndex`、`count`。[SD 官方合约](https://d3a0d0y2hgofx6.cloudfront.net/openapi/en-us/sponsored-display/3-0/openapi.yaml)

### 活动查询分页（2026-10-26 修复）

统一接口的 `campaigns`、`adGroups`、`ads` 查询按广告类型限制 `maxResults`：SP 最大 1000，SB 最大 100。组合范围查询分别使用对应页长；普通列表原有的 100 条默认页长保留，小于上限的指定页长也保留。共享参数构造同时处理显式参数和 `filters.maxResults`，多广告类型查询取较小上限。以上采用固定版本的 [SP OpenAPI](https://github.com/amzn/ads-advanced-tools-docs/blob/e25aace0ec07997c113dac48f333298472243558/unified-campaign-management-migration-skills/api-specs/unified-api-sp.json) 与 [SB OpenAPI](https://github.com/amzn/ads-advanced-tools-docs/blob/e25aace0ec07997c113dac48f333298472243558/unified-campaign-management-migration-skills/api-specs/unified-api-sb.json)。SD 仍用 `count:100` 与递增 `startIndex`。

SP/SB 必须继续读取到 `nextToken` 消失，不能按本页条数提前结束；SD 读取至返回不足 100 条。任何后续页异常都会阻止组合编辑。每页数量是 Amazon 查询参数，与用户的每份提案项数上限无关。`action:update` 配合 `budget.policy:NO_CAP` 仍只构造组合预算更新，不构造活动移出请求。

## 官方接口核实（2026-10-23）

以下下载地址由 Amazon 官方开发者门户的 [导航清单](https://d3a0d0y2hgofx6.cloudfront.net/en-us/toc2.json) 引用，不是第三方 SDK 推测。

| 接口 | 用途与请求 |
|---|---|
| `GET /sp/budgetRules?pageSize=30` | 列出全部规则；遍历 `nextToken` 后查同名重复 |
| `GET /sp/budgetRules/{budgetRuleId}` | 回读 `budgetRule` |
| `POST /sp/budgetRules` | `{budgetRulesDetails:[ruleDetails]}` 创建 |
| `PUT /sp/budgetRules` | `{budgetRulesDetails:[{ruleId,ruleDetails?,ruleState?}]}` 修改 |
| `GET /sp/budgetRules/{budgetRuleId}/campaigns` | 分页查规则现有关联活动 |
| `GET/POST /sp/campaigns/{campaignId}/budgetRules` | 查关联；关联请求 `{budgetRuleIds:[ruleId]}` |
| `DELETE /sp/campaigns/{campaignId}/budgetRules/{budgetRuleId}` | 解除关联 |
| `POST /portfolios/list` | 列表与按 ID 回读；遍历 `nextToken` |
| `POST/PUT /portfolios` | `{portfolios:[portfolio]}`；修改包含 `portfolioId` |
| `POST /adsApi/v1/query/campaigns` | 按 SP 类型及 ID 查询活动/原归属 |
| `POST /adsApi/v1/update/campaigns` | `{campaigns:[{campaignId,portfolioId}]}`；`portfolioId` 可为 null |

SP 专用预算接口使用 `application/json`，其 207 回执为 `responses:[{code:"Ok",ruleId}]`。组合接口使用 **`application/vnd.spPortfolio.v3+json`**，207 回执位于 `portfolios.success/error`；不会把 HTTP 207 本身当作全部成功。[SP 官方合约](https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/dest/SponsoredProducts_prod_3p.json)、[组合官方合约](https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/dest/Portfolios_prod_3p.json)

活动归属使用官方统一 SP `SPCampaignUpdate.portfolioId` 字段（允许 null）。组合预算的 `NO_CAP` 请求明确把 `amount`、`startDate`、`endDate` 设为 null；币种必须与站点一致。组合当前 `EntityState` 合约只有 `ENABLED`，所以不会编造暂停/归档状态。[统一 SP 官方合约](https://github.com/amzn/ads-advanced-tools-docs/blob/main/unified-campaign-management-migration-skills/api-specs/unified-api-sp.json)、[组合指南](https://advertising.amazon.com/API/docs/en-us/guides/portfolios/get-started)

本次读取的合约 SHA-256：

```text
SponsoredProducts_prod_3p.json 9ce8a6b6bc8b33d34d04b7ee416fd78be787699e932075d101941176a215df2e
Portfolios_prod_3p.json        4ec356bffd6c2e7b1611c8c57869e8065d7982e301285e035e1a4a41edf201db
unified-api-sp.json           2a88b88d78494245143378dffccb9dd1b6cf790001c9923e359da167b5b185f2
```

## 区域、账户和权限

使用店铺绑定的 NA/EU/FE Ads 端点与站点 profile；代码拒绝 profile 站点与店铺区域不一致的请求。请求继续携带 LWA 令牌、ClientId、`Amazon-Advertising-API-Scope`。账户需要 Ads API 接入与 `advertising::campaign_management` 授权；写接口要求 `advertiser_campaign_edit`。读接口有 view 权限即可成功，所以只读成功**不证明**有写权限。Amazon 仍可能因账户资格或活动约束拒绝业务动作。[SP API 参考](https://advertising.amazon.com/API/docs/en-us/sponsored-products/3-0/openapi/prod)、[组合 API 参考](https://advertising.amazon.com/API/docs/en-us/reference/portfolios)

本版未用真实业务写入验证账户权限、规则最低预算、审核/处理延迟或实际花费变化。新增功能可生成可审阅的请求，只有用户另行批准具体业务提案并打开对应开关后才会提交。

## 提案示例

示例 ID 和内容均为合成数据；日期需换成实际计划日期。`prepare` 只生成提案，不能代替批准。

```json
{
  "op": "ads.budgetRules",
  "action": "create",
  "campaignIds": ["101"],
  "ruleDetails": {
    "name": "Example January schedule",
    "ruleType": "SCHEDULE",
    "duration": {"dateRangeTypeRuleDuration": {"startDate": "20300101", "endDate": "20300131"}},
    "recurrence": {"type": "DAILY"},
    "budgetIncreaseBy": {"type": "PERCENT", "value": 20}
  }
}
```

```json
{
  "op": "ads.portfolio",
  "action": "create",
  "campaignIds": ["101"],
  "portfolio": {
    "name": "Example product group",
    "state": "ENABLED",
    "budget": {"policy": "MONTHLY_RECURRING", "amount": 100, "currencyCode": "USD"}
  }
}
```

## 失败恢复与验证

创建前完成所有分页查重；重复或不完整分页直接阻止提案。创建身份按规范化名称与店铺/站点范围判断，不因改预算或重生成提案而绕过未决创建保护。

每个网络写入之前持久化 `SUBMITTING` 标记，之后保存对象 ID 与该步骤回执。创建成功但某项关联明确失败时返回 `PARTIALLY_SUCCEEDED`，保留已创建对象及成功关联，停止后续请求。超时、5xx、缺失/畸形成功回执返回 `OUTCOME_UNKNOWN`，不重发、不自动删除已创建对象。

全部已尝试步骤都有明确成功/失败回执，并且所有成功步骤回读一致后，`reconciled:true` 表示结果已核清；部分成功本身仍不会改成全部成功。之后可使用已有对象 ID，针对失败或未执行的关联单独创建新提案。任何尚未核清的步骤继续锁定，不能重建对象。

回读只发送查询：有回执 ID 时按 ID 查；创建回执丢失时完整分页查询同名候选，仅供人工核对。即使只有一个同名同内容对象，也无法排除外部并发创建，仍保持 `OUTCOME_UNKNOWN`，不认定本请求成功。未找到对象或未知关联还未显示时保持未知，不把暂时未出现当成创建失败。有本请求回执 ID、全部批准内容和关联一致才标记 `API_STATE_VERIFIED`；该状态仅表示接口配置一致，不表示规则触发或产生花费。

`test/ads-budget.test.js` 使用注入的合成 API 服务验证真实请求结构、v3 媒体类型、分页查重、规则与组合完整生命周期、部分成功、超时后恢复、畸形 207、持久化失败和只读核验不重发。没有读取本机秘密，也没有连接真实 Amazon 账户。
