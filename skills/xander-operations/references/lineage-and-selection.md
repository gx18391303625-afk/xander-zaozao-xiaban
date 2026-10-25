# 选品冻结与追溯规则（所有模块通用）

## 选品不在本插件里

选品（选什么产品、立项、产品可行性）已冻结，作者会另做独立插件。本插件只管在售商品的日常运营：竞品、关键词、Listing、广告、补货、利润。

- 用户问“这个产品值不值得做 / 选什么品”：说明本插件不做选品，可以帮他用现有模块看竞品格局、广告经济线、补货资金占用，但不给“做/不做”的立项结论。
- 方法文件里出现的 `$select-amazon-products`、“选品契约”“立项包”“选品交接 handoff.json”：如果用户手上真有选品插件的产出，就照常读取；没有就跳过，不要因此停下。
- 方法文件里“交回选品技能（handback to `$select-amazon-products`）”的地方：先区分日常运营与立项。利润口径、费用与期间差异交 `reconcile-amazon-profit`；在售库存续航、补货量与路线可行性交 `plan-amazon-replenishment`；必须由用户判断的产品定位、合规或是否继续经营问题使用 `PRODUCT_LEVEL_USER_REVIEW`，列清证据，不替用户作立项结论。没有对应模块的账户/平台阻塞保留 `EXTERNAL_OPERATIONAL_BLOCKER`。

## 上游 ID 怎么处理

模块之间靠稳定 ID 串起来：`project_id / selection_run_id / candidate_id`（选品阶段产生）→ `competitor_lock_run_id`（竞品锁定）→ `keyword_run_id`（词库）→ `listing_run_id / listing_version_id`（Listing）→ 广告的各个 ID。

- **选品阶段的三个 ID**（`project_id / selection_run_id / candidate_id`）：有就原样保留并核对一致；没有就留空，**不要编造**，也不需要写进缺口。正常独立运营路径不要求它们；历史 `FULL_WORKFLOW` 包仍按原完整链路校验。
- **其他上游 ID**：本阶段确实做过就原样保留；没做过（比如用户直接让你改 Listing，没建词库）就留空，并在 `unknowns` 里写一句原因（例如 `"keyword_run_id: 未建词库，关键词来自用户提供"`）。Listing 校验对“缺失且没说明”只给提醒，不阻断。
- 任何情况下都不要为了通过校验而编一个看起来像真的 ID。

## 广告策略包怎么选追溯模式

`validate_ad_strategy_package.py` 的 `lineage_mode`：

- `FULL_WORKFLOW`：要求从选品开始的完整链路。**选品冻结后不用于新建运营包。** 为读取或审计既有完整历史包保留；其中 `select-amazon-products` handback 仅保留历史审计意义并给出弃用提醒，不代表恢复选品功能。
- `INDEPENDENT_NEW`（新品）/ `INDEPENDENT_EXISTING`（老品）：用这两个。需要填 `independent_scope`：`reason`（为什么独立，比如“选品阶段已冻结”）、`source_scope_id`（本次范围，比如 ASIN 或 SKU 组）、`source_artifact_ids`（本次依据的数据来源 ID）。竞品锁定、词库、Listing 的上游快照有就照常绑定。中文填写没有问题。

独立只表示不要求不存在的选品链路，不会解除已提供的上游约束。存在经营上下文时，各已提供阶段快照的 context ID/hash 必须一致，经济模型的利润底线也必须逐项一致。不能删掉快照仍引用的上下文来解除约束；上下文确实从未存在的独立任务可以保持为空。

## 经营上下文哈希（原“选品契约”规则）

`operating_context_sha256` = `"sha256:"` + SHA-256（UTF-8 编码的规范 JSON），规范 JSON 指：键名排序、`separators=(",", ":")`、保留非 ASCII 字符（`ensure_ascii=False`）、禁止 NaN/Infinity。各校验脚本都按这个规则计算；旧输入缺哈希时可以按此补算，已有哈希不一致就停下来核对。
