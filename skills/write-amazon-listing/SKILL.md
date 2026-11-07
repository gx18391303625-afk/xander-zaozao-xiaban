---
name: write-amazon-listing
description: "撰写、改写或审计有证据支撑的亚马逊 Listing 文案与后台搜索词（标题、Item Highlights 亮点、五点、描述、Search Terms），包括单字段修改和发布交接；经用户批准后可通过官方接口提交。Create, rewrite, or audit evidence-based Amazon Listing copy and backend Search Terms. 不用于选品、A+、品牌旗舰店或广告策略。"
---

# 亚马逊 Listing 文案

写目标站点语言的、每句话都有产品事实撑腰的文案。默认给一个推荐版本；先给可直接粘贴的文案，再给简短审计。用简洁中文沟通。

## 开始

1. 本会话没调过就先 `xander_status`；再 `xander_archive_overview`（传 sku/asin）读已确认事实、认证、内容锁定、上次批准的版本和最近改动。
2. 改写或审计前用 `xander_listing_get` 读线上内容（亮点在 `attributes.title_differentiation`，和标题 `item_name` 分开）。
3. 选最小模式（新建 / 全量或单字段改写 / 只读审计 / 只做后台词 / 准备输入 / 改后复盘 / Stage 3 交接），只读需要的参考：

| 要做的事 | 读 |
|---|---|
| 单字段草稿或只做 Search Terms，产品事实够用 | [field-writing.md](references/field-writing.md) |
| 准备输入、事实冲突、复杂型号/测试证据 | [input-and-evidence.md](references/input-and-evidence.md) |
| 敏感主张、政策审计、核实最新规则 | [policy-and-claims.md](references/policy-and-claims.md) |
| 关键词/竞品布局或差异化审计 | [copy-and-keywords.md](references/copy-and-keywords.md) |
| 完整新建/改写 | 上面四份都读，再读下面两行 |
| 发布包、版本变更、内容锁定、Stage 3、要给出 READY | 先完整读 [core-rules.md](references/core-rules.md)，再读 [workflow-and-release-contract.md](references/workflow-and-release-contract.md) |
| 完整交付格式与质量评分 | [delivery-format.md](references/delivery-format.md) |
| 改后效果复盘 | [post-change-review.md](references/post-change-review.md) |

## 底线

- 只有我方产品证据能支撑产品主张；关键词证据决定用词和优先级，竞品/评论证据决定回答哪些买家问题，三者不能互相替代。不推断数量、容量、续航、功能、认证、兼容性或效果。
- 认证、安全、医疗、量化性能、儿童、环保、法律、对比类主张必须有匹配范围的正式证据；没有就不写，包括后台词。卖家说不知道的，直接省略对应主张，不反复追问。
- 字数/字节等规则按当前站点、类目、商品类型核实，不跨类目套用；没法实时核实就标 PROVISIONAL。
- 状态只用三种：`BLOCKED`（身份/报价/兼容/合规的核心事实缺失或冲突，只给已确认事实和最多 5 个关键问题）、`PROVISIONAL`（可写保守文案，但证据或核验不全）、`READY`（必须按 [core-rules.md](references/core-rules.md) 跑完两个校验脚本）。
- 不承诺排名、流量或转化；只改用户要求的字段，审计不等于授权改写，内容锁定的字段要单独授权。

## 提交到亚马逊

卖家批准这段确切文字后，才用 `xander_prepare_change`（op=`listing.attribute`）出提案；亚马逊预校验通过不等于已发布。用户对这一份提案说“批准”再 `xander_execute_change`，`AWAITING_READBACK` 时稍后 `xander_verify_change`。和线上一致的内容不出提案，直接说“已一致”。`BLOCKED` 或未批准的文案绝不提交。流程细节见 [写入安全](../xander-operations/references/write-safety.md) 和 [core-rules.md](references/core-rules.md)。

## 收尾

批准的文案版本、提交结果和复盘日期用 `xander_archive_note` 记下；新确认的产品事实用 `xander_archive_set_fact`。规则见 [店铺档案](../xander-operations/references/business-context.md)。
