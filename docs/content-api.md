# Listing 图片与 A+ 内容

核对日期：2026-10-23。实现位于 `lib/ops-content.js`，契约测试位于 `test/content.test.js`。这两项能力走官方 SP-API，不依赖紫鸟。默认写入开关仍关闭；每一步都经过精确提案、审批、演练、提交和回读。

## 资格与区域

- Listing 图片、Product Type Definitions（PTD）和 A+ Content 都要求应用及开发者档案具备 **Product Listing** 角色，并获得相应卖家授权。Brand Analytics 不是这些操作所需的 SP-API 角色。[官方 Listing 预校验前提](https://developer-docs.amazon.com/sp-api/docs/preview-errors-before-partially-updating-a-listing)、[A+ API 前提](https://developer-docs.amazon.com/sp-api/docs/create-edit-publish-aplus-content)
- 账户是否能使用 A+ 是另一层资格。Amazon 美国站公开说明目前包括 Professional 账户，以及相应 Brand Registry 品牌的 Brand Representative / Reseller 角色或目录内的 generic products；不能据此假定所有站点、ASIN、Premium 模块都可用。每次提案通过官方内容/ASIN 校验核实具体权限，403 或资格错误直接阻止提案，不把已有 SP-API 连接当成 A+ 写权限证明。[Amazon A+ 资格说明](https://sell.amazon.com/tools/a-content)
- 使用既有 NA、EU、FE SP-API 区域配置，代码拒绝店铺区域和目标 marketplace 不一致。某个区域端点存在，不代表每个站点、商品类型、账户都支持相同能力；PTD 与 A+ 校验的实时结果优先。
- 本次仅使用合成 fixture 和 mock 测试；没有替任何真实店铺创建内容、改图、关联 ASIN 或提交审核。用户账户的实际业务写入权限尚未通过真实写入验证。

## 修改图片

先用 `xander_content_check` 的 `action=imageRequirements` 查询 SKU 的实时 productType 和 PTD 图片属性。图片必须已经有 Amazon 可匿名访问的 HTTPS URL；工具不托管图片，不上传本机文件，不会把本机路径转换为公开地址。

提案例子：

```json
{
  "op": "listing.images",
  "sku": "YOUR-SKU",
  "images": {
    "main_product_image_locator": "https://your-image-host.example/main.jpg",
    "other_product_image_locator_1": "https://your-image-host.example/secondary.jpg"
  }
}
```

只修改给定的图片属性，保留其他属性和可见的其他站点贡献。附图槽位以该卖家、站点、商品类型的实时 PTD 为准，不硬编码“任何商品都可写第九张”。请求使用 `media_location`，并对整项属性执行 JSON Patch，而不是对数组内部路径打补丁。[官方图片属性映射](https://developer-docs.amazon.com/sp-api/docs/mapping-product-attributes)

执行过程：读取 SKU → 获取并校验 PTD schema → 检查目标图片属性 → `patchListingsItem` 的 `mode=VALIDATION_PREVIEW` → 生成提案 → 用户审批 → 正式 PATCH → 回读卖家贡献和错误。预校验状态必须为 `VALID` 且没有 ERROR；不把 HTTP 200 本身当成通过。[官方预校验](https://developer-docs.amazon.com/sp-api/docs/preview-errors-before-partially-updating-a-listing)

结果 `IMAGES_ACCEPTED` 仅表示 Amazon 接受处理；`IMAGE_CONTRIBUTION_VERIFIED` 表示提交的卖家属性已回读一致。Listings Items 的 attributes 是卖家贡献，Amazon 仍可能延迟处理或选用其他贡献，因此两种状态都不证明买家详情页已经换图。[Listings Items 的结果与属性边界](https://developer-docs.amazon.com/sp-api/docs/listings-items-api)

## A+ 的四个独立步骤

一个 `aplus.content` 提案只执行一个动作；不会在创建后未经审批自动关联或提交。每次正式调用均为官方模型中的 POST：[官方 A+ OpenAPI 模型](https://github.com/amzn/selling-partner-api-models/blob/main/models/aplus-content-api-model/aplusContent_2020-11-01.json)

| action | 必填内容 | 官方路径（前缀 `/aplus/2020-11-01`） | 成功范围 |
| --- | --- | --- | --- |
| `create` | `contentDocument` | `/contentDocuments` | 保存草稿并持久化返回的 contentReferenceKey |
| `update` | `contentReferenceKey`、完整 `contentDocument` | `/contentDocuments/{key}` | 保存文档内容，不自动提交审核 |
| `associate` | `contentReferenceKey`、完整非空 `asinSet` | `/contentDocuments/{key}/asins` | 替换全部关联 ASIN；不是增量添加 |
| `submit` | `contentReferenceKey` | `/contentDocuments/{key}/approvalSubmissions` | 将已关联内容提交审核 |

卖家基础文档使用 `contentType: "EBC"`，语言使用 `en-US` 格式；`EMC` 对应供应商，`BrandStory` 对应品牌故事。以下仅展示合成文本结构，真实内容需独立准备和批准：

```json
{
  "op": "aplus.content",
  "action": "create",
  "contentDocument": {
    "name": "A unique draft name",
    "contentType": "EBC",
    "locale": "en-US",
    "contentModuleList": [{
      "contentModuleType": "STANDARD_TEXT",
      "standardText": {
        "body": {"textList": [{"value": "Approved product text", "decoratorSet": []}]}
      }
    }]
  },
  "asinSet": ["B000000001"]
}
```

`create` / `update` 中的 `asinSet` **只用于资格校验**，不执行关联。拿到返回的 key 后，分别准备 `associate` 和 `submit` 提案。关联操作会替换全部 ASIN，界面会列出删除项；删除关联可能使现有 A+ 下线，给已批准内容新增关联可能使内容展示到新 ASIN。[官方管理与关联说明](https://developer-docs.amazon.com/sp-api/docs/manage-aplus-content)

所有动作都先调用 `POST /contentAsinValidations`。HTTP 200 内仍可能含 errors；只要有 errors 就拒绝提案，submit 还要求先解决 warnings。提交时已有 `SUBMITTED` / `APPROVED` 状态会阻止重复提交。完整模块结构及账户特定限制由 Amazon 实时校验。[官方创建与审核流程](https://developer-docs.amazon.com/sp-api/docs/create-edit-publish-aplus-content)

### A+ 图片素材交接

当前支持已上传素材的 `uploadDestinationId`、`imageCropSpecification` 和 `altText`。A+ 不直接接受 Listing 的公开 URL，也不能把本机文件路径当素材 ID。没有已上传素材时，按官方 Uploads API 的 `createUploadDestinationForResource` 获取目标、上传图片并确认 2xx 后，才能在内容里引用 ID；本版没有自动上传本机素材的写入动作。也可由用户在 A+ Content Manager 准备素材，再用内容查询读取现有文档中的有效素材引用。需要网页登录时先协调时间，不抢占前台窗口。[官方素材上传步骤](https://developer-docs.amazon.com/sp-api/docs/create-edit-publish-aplus-content)

## 状态、去重和核验

- `DRAFT_CREATED` / `CONTENT_UPDATED`：内容保存；`ASINS_ASSOCIATED`：关联集合回读；`SUBMITTED_FOR_REVIEW`：提交审核回执；`APPROVED` / `REJECTED`：Amazon 审核状态。它们不是同一件事。
- `getAplusStatus` 分别返回审核状态、关联 ASIN、发布记录。发布记录没有修订号，所以即使 `publicationRecordFound=true`，`currentRevisionPublished` 仍为 `null`，并标记 `REFERENCE_ONLY_NO_REVISION`。旧的发布记录可能和新的未通过修订同时存在。
- 审核状态按每文档至少一小时复查。提交冷却和查询缓存保存在本机私有 `aplus-review-cache` 文件夹，重启后仍生效；缓存带明确查询时间，不伪装成实时读数。内容和关联发生改动时使缓存失效。
- 创建前完整分页查找同名文档；同名则要求核验现有 key，使用 update。正式提交前后用 checkpoint 持久化阶段和 ID；HTTP 超时、断网或 5xx 不自动重发。丢失创建回执时只能给出同名候选，保持 `OUTCOME_UNKNOWN`，不能靠名称认领成功。
- 部分回执带 warnings/errors 时保留 ID 和 `PARTIALLY_SUCCEEDED`，随后只核验；只有实际回读一致才能提升对应步骤的状态。回读不一致的未知请求仍保持未知。

只读/校验导出：`getListingImageRequirements`、`listAplusDocuments`、`validateAplusContent`、`getAplusStatus`。其中校验使用 POST，但不创建、关联或提交文档。

测试覆盖实时属性限制、图片预校验及回读错误、A+ 四步独立动作、200 内校验错误、警告、关联替换、多页去重、丢失创建回执、部分成功 ID 持久化、审核等待、重启后查询间隔、审核批准与版本发布证据的区别。未覆盖真实账户写入、Amazon 实际审核结果或买家页面视觉验收。
