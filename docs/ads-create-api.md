# SP 创建与竞价设置

核对日期：2026-10-23。实现：`lib/ops-ads-create.js`。本页说明 API 能力和软件验证范围，不代表某个真实账户已通过写权限或商品投放资格验证。

## 官方接口与资格

使用 Amazon 官方仓库的 [SP 统一接口 OpenAPI 固定版本](https://github.com/amzn/ads-advanced-tools-docs/blob/88b498089c5d2f12944bdf4f5b895e53e11ed926/unified-campaign-management-migration-skills/api-specs/unified-api-sp.json)，该文件最近一次变更为 2026-08-27。三个区域端点分别是 `advertising-api.amazon.com`、`advertising-api-eu.amazon.com`、`advertising-api-fe.amazon.com`，沿用已有店铺区域与 profile 授权。

| 动作 | 方法和路径 | 必要权限之一 |
| --- | --- | --- |
| 创建活动 | `POST /adsApi/v1/create/campaigns` | `advertiser_campaign_edit` / `campaign_edit` / `dsp_campaign_edit` |
| 创建广告组 | `POST /adsApi/v1/create/adGroups` | 同活动 |
| 创建广告商品 | `POST /adsApi/v1/create/ads` | `advertiser_campaign_edit` / `creatives_edit` |
| 修改策略、广告位 | `POST /adsApi/v1/update/campaigns` | 同活动 |
| 查重与回读 | `POST /adsApi/v1/query/{campaigns,adGroups,ads}` | 相应 view 或 edit 权限 |

上述接口的 OAuth scope 均为 `advertising::campaign_management`。profile 可读取只能证明当前授权能访问该 profile，不能证明拥有上述全部编辑权限。平台明确返回拒绝时保留错误；不会把配置存在认作写权限验证成功。

官方 SP 枚举包括 AE、AU、BE、BR、CA、DE、EG、ES、FR、GB、IE、IN、IT、JP、MX、NL、PL、SA、SE、SG、TR、US、ZA。插件当前只开放已有 `regions.js` 映射的站点（UK 转换为 API 的 GB；IE、ZA 尚无本地站点映射）。本流程只创建单站点活动，不创建全球多站点活动。

[Amazon Sponsored Products 官方说明](https://advertising.amazon.com/solutions/products/sponsored-products)列出专业卖家、Vendor、图书 Vendor 和 KDP 等可用主体；商品还需符合类别和 Featured Offer 等资格。创建前读取 `/v2/profiles` 核对当前 profile、国家、币种及账户类型；seller 仅接受 SKU，vendor/KDP 接受 ASIN。软件不以只读 profile 检查替代商品资格、付款状态和最终投放审核。

## `ads.sp.campaign.create`

一个写入开关覆盖三个明确模式，所有新对象强制为 `PAUSED`。启用必须另外审批既有 state 操作。手动活动的关键词或商品投放须另行添加；创建结构完成不是已经投放。

| mode | 创建范围 | 已有父级 |
| --- | --- | --- |
| `campaign`（默认） | 一个活动 → 一个广告组 → 1–20 个广告商品 | 无 |
| `adGroup` | 一个广告组 → 1–20 个广告商品 | 必填 `campaignId` |
| `ads` | 1–20 个广告商品 | 必填 `adGroupId`；可用 `campaignId` 交叉核对 |

整链提案示例（全部为虚构资料）：

```json
{
  "op": "ads.sp.campaign.create",
  "marketplace": "US",
  "mode": "campaign",
  "campaignName": "Example SP manual",
  "adGroupName": "Example group",
  "dailyBudget": 5,
  "defaultBid": 0.8,
  "targetingType": "MANUAL",
  "startDateTime": "2030-11-01T00:00:00-07:00",
  "bidStrategy": "SALES_DOWN_ONLY",
  "placementBidAdjustments": [{ "placement": "TOP_OF_SEARCH", "percentage": 0 }],
  "products": [{ "sku": "EXAMPLE-SKU" }]
}
```

日期必须包含时区；没有自动替换成执行时间。可选 `endDateTime` 必须晚于开始时间。金额最多两位小数，不静默四舍五入。`targetingType=AUTO` 对应 `autoCreationSettings.autoCreateTargets=true`，MANUAL 对应 false；`autoManageCampaign=false`。默认策略为 `SALES_DOWN_ONLY`。

活动 API 请求包含 `marketplaceScope=SINGLE_MARKETPLACE`、站点、`startDateTime`、`autoCreationSettings` 和完整日预算结构；广告组通过返回的 campaignId 建立；广告商品采用官方结构：

```json
{
  "adProduct": "SPONSORED_PRODUCTS",
  "adType": "PRODUCT_AD",
  "adGroupId": "上一步确认的广告组 ID",
  "state": "PAUSED",
  "creative": {
    "productCreative": {
      "productCreativeSettings": {
        "advertisedProduct": { "productIdType": "SKU", "productId": "EXAMPLE-SKU" }
      }
    }
  }
}
```

提案同时固定每一步的请求及唯一 `xander-operation` 标签。这个标签只包含本次随机操作标识，不包含密钥或用户个人资料。模板中的父级占位符只允许替换为本次已获确认的 ID。

### 重试与部分成功

- 所有查重都完整处理 `nextToken`；分页异常、循环或超过上限时禁止写入。同名活动/同活动同名广告组按忽略大小写比对，包含归档对象；同组重复商品也拦截。
- 创建前再次查重；父层执行锁与稳定 `creationIdentity` 防止未解决提案通过修改预算、随机标识或商品清单再次创建。同组商品新增的未解决提案互相排斥，避免商品清单交叉重复。
- 每个 HTTP 创建前持久化 `OUTCOME_UNKNOWN` 阶段，成功收到 ID 后立即保存。必须提供持久化 `checkpoint`；没有 checkpoint 时禁止创建。
- 明确拒绝后停止后续步骤。已成功对象保留暂停状态；不自动删除、归档或回滚。若前序成功，返回 `PARTIALLY_SUCCEEDED` 及已知 ID。
- 断网、5xx、缺少成功 ID 或模糊回执返回 `OUTCOME_UNKNOWN`。不重新发送创建。回读按已知 ID，或唯一操作标签与父级/商品定位；同名但标签不属于本次操作的对象不能认领。
- 暂时查询不到或字段不一致不能证明创建失败。只有全部批准值核验一致才标为 `API_STATE_VERIFIED`；这仍不代表商品已获准投放或广告已产生流量。
- 部分成功后，先核对前序对象。只有所有已尝试步骤已明确拒绝或精确回读匹配，才返回 `reconciled: true`；这允许解除未解决创建的阻塞。确定剩余步骤被拒绝或从未发送、没有未知结果后，以已有 `campaignId`/`adGroupId` 提交 `adGroup`/`ads` 新提案补建。不会自动续跑原提案。

## `ads.sp.placement`

支持 `MANUAL`（固定竞价）、`SALES_DOWN_ONLY`、`SALES_UP_AND_DOWN` 三种策略。`RULE_BASED` 虽然在官方枚举内，但还涉及账户资格和独立规则，本动作不负责新设规则竞价；对已使用 RULE_BASED 的活动只改广告位时保留原策略。

```json
{
  "op": "ads.sp.placement",
  "campaignId": "EXAMPLE-CAMPAIGN-ID",
  "bidStrategy": "SALES_DOWN_ONLY",
  "placementBidAdjustments": [
    { "placement": "TOP_OF_SEARCH", "percentage": 20 },
    { "placement": "PRODUCT_PAGE", "percentage": 0 }
  ]
}
```

`bidStrategy` 与 `placementBidAdjustments` 至少给一项。数组只修改列出的广告位，其他广告位、受众加价和创意加价从已读值保留，并进入精确提案及回读比较。清零须明确给 `percentage: 0`，空数组不会隐式清空所有位置。支持的广告位枚举为 TOP_OF_SEARCH、REST_OF_SEARCH、PRODUCT_PAGE、SITE_AMAZON_BUSINESS。

百分比须为 0–900 整数；[官方普通广告位加价说明](https://advertising.amazon.com/resources/whats-new/improve-campaign-performance)与 [Amazon Business 官方开发者说明](https://m.media-amazon.com/images/G/01/US_B2B_3PI_Team/API_Developer_Guide_AB-Bid-Adjustment-And-Reporting_Sponsored-Products.pdf)分别说明其上限。可用广告位仍以对应账户和站点实际 API 回执为准。

沿用竞价安全上限，按最终广告位倍数的变化计算：`((100 + 新百分比) / (100 + 原百分比) - 1) × 100`。例如 0% → 20% 是倍数增加 20%；0% → 900% 会被默认安全上限阻止。策略改变会明确显示，动态提高/降低的叠加影响列入提案提醒。更新只发送 `optimizations.bidSettings`，不改活动预算或状态。

## 验证与未实测边界

`node --test test/ads-create.test.js` 使用独立的本地 HTTP 服务及虚构凭据，覆盖官方字段结构、正确父子顺序、每次写入前后持久化、全部暂停、完整分页、重复与归档对象、profile 国家/币种、父级归属、部分失败、5xx 已应用/未应用、响应无 ID、操作标签回查、读取不一致、受众/创意设置保留、百分比与安全上限。

本次软件开发没有向真实账户创建广告或修改竞价。尚未实测真实编辑权限、具体商品资格、跨区域写入、平台一致性延迟和最终投放状态。任何真实业务写入仍需对应开关、关闭演练和精确提案审批。
