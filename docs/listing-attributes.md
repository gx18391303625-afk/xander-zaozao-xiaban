# Listing 文案属性：亮点、预校验与回读

`listing.attribute` 一次只修改指定 SKU 的一个文案属性。Item Highlights（亮点）使用 Amazon 属性 `title_differentiation`，不写入标题或五点。该能力沿用现有 `listing.attribute` 开关和审批方式；升级不会打开开关或关闭演练。

| 文案字段 | Amazon 属性 | 输入 |
|---|---|---|
| 标题 | `item_name` | 一条字符串 |
| Item Highlights 亮点 | `title_differentiation` | 一条字符串 |
| 五点 | `bullet_point` | 字符串数组，数量还受实际 PTD 限制 |
| 产品描述 | `product_description` | 字符串或字符串数组，受实际 PTD 限制 |
| 后台搜索词 | `generic_keyword` | 字符串或字符串数组，受实际 PTD 限制 |

Listing 发布包里的 `item_highlight` 是文案交接字段名；调用 Amazon 操作时必须映射为 `title_differentiation`。

## 读取与准备

`xander_listing_get` 以 `store`、`sku`、`marketplace` 读取 Listing。亮点在返回值 `attributes.title_differentiation`，每条保留 `value`、`marketplace_id`、`language_tag` 等结构。读取是独立操作，不需要生成或执行提案。字段为空只说明当前没有读到卖家贡献，不能据此判定 Amazon 不支持。

准备示例（将示例内容替换为已批准的确切原文）：

```json
{
  "marketplace": "US",
  "changes": [
    {
      "op": "listing.attribute",
      "sku": "BOWL-BLUE",
      "attribute": "title_differentiation",
      "languageTag": "en_US",
      "value": "已批准的亮点原文",
      "reason": "仅更新已批准的 Item Highlights"
    }
  ]
}
```

使用 `languageTag` 明确目标语言。补丁只改变目标站点和语言的该属性值，保留同属性的其他站点/语言实例及其他未授权属性。存在无法明确定位的多语言数据时，应使用明确语言重新准备，不扩大修改范围。

`xander_prepare_change` 会读取 SKU 的 `productType`。亮点变更额外读取实际 Product Type Definition（PTD），确认 `title_differentiation` 存在并检查基础结构；这不是完整的本地 JSON Schema 校验器。全部文案属性仍调用 Amazon `patchListingsItem` 的 `mode=VALIDATION_PREVIEW`，由 Amazon 检查完整条件规则。预校验必须为 `VALID` 且没有 `ERROR`。字段不受支持、无法获得亮点所需定义、内容不合规或预校验失败时不生成可执行提案；不把 HTTP 成功当作校验通过，也不使用固定通用字数代替实际定义。

新内容与当前内容一致时不生成提案，报告“内容已一致”。这不是新提交成功，也不应通过增删字符来制造演练差异。任一项失败时整个提案不生成，应逐项报告原因。

## 批准、演练、正式提交

1. 准备阶段生成本地提案编号、哈希与新旧值对照；不会正式改动 Amazon 商品。
2. 用户批准这份精确提案，且相关开关已由用户打开。选择面板审批时，还必须在面板批准该提案；对话中的批准不能替代它。
3. `dryRun=true` 时执行只记录 `DRY_RUN`，不调用正式 PATCH。准备阶段的读取与 `VALIDATION_PREVIEW` 仍可能访问 Amazon。
4. 只有已获正式执行授权、满足现有审批条件且演练关闭时，执行流程才发送正式 PATCH。执行前再次检查当前属性，发生并发变化时跳过旧提案，重新准备。
5. 正式提交后的自动回读，以及 `xander_verify_change` 的独立重新核验，比较同一站点/语言的目标属性。`ACCEPTED` 仅表示 Amazon 接受处理；接口回读一致仍不证明买家详情页已展示。

`AWAITING_READBACK` 或 `OUTCOME_UNKNOWN` 应通过 `xander_verify_change` 查清，不自动重复提交。没有已执行提案时，可随时用 `xander_listing_get` 独立读取当前字段；演练提案不应被解释为线上修改凭据。
