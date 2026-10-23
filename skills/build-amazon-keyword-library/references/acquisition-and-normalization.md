# 数据采集与标准化

目标是形成可复核的运行范围内全量快照，而不是只摘“看起来不错”的词。这里的全量仅指已记录 seed、全部用户指定 ASIN、所选月份及工具分页/返回上限内取得的全部原始行，不等于 Amazon 全站词宇宙。大盘词与竞品词必须分别采集、分别保存、在主库中合并；任何一个都不能替代另一个。

## 1. 先建采集台账

在调用数据源前建立对象表：

- 站点、币种、语言与采集日期；
- 市场 seed 列表及 seed 类型；
- 用户指定 ASIN、原始顺序、排序依据、父子体与目标变体；
- 上游 `project_id / candidate_id / competitor_lock_run_id`、统一角色、锁定状态与关键词采集范围；
- 计划使用的数据月份或近 30 天口径；
- 每个工具的页大小、返回字段、过滤条件与调用状态；
- 原始输出保存位置和稳定的 `source_run_id`。

如果用户给出有排名意义的 ASIN 顺序，保留 `input_rank`；它是动态快照，不自动代表市场份额。

## 2. Amazon 一方优先与 SellerSprite 补充

先检查授权工具或用户导出中可用的一方搜索数据，复用日期与范围适合的原始报表；工具名称、权限与参数按当次 schema 确认，不把 SP-API 接通等同于所有 Brand Analytics 报表可取。

- 热门搜索词：保留搜索频率排名、返回的点击领先 ASIN、点击/购买份额及报告周期；排名不是搜索量，点击份额不是 CTR，购买份额不是 CVR，未出现在领先 ASIN 中不等于自身份额为零。
- SQP：保留返回的品牌/ASIN 范围和查询漏斗指标，按原定义解释；不能与全市场热门搜索词或第三方估算直接拼接成同一序列。
- 广告搜索词：补充本账户付费查询表现，不代表全市场或自然需求。与产品形态/功能不匹配的高热度词仍隔离，不因热度进入正向库。
- 一方不可得时标明权限、周期或覆盖缺口；SellerSprite 可补充候选词，但其估算单列 `ESTIMATED_THIRD_PARTY`，不冒充缺失的一方指标。先对齐站点、原词、周期与指标定义再交叉验证；同一原始报告的转存不是独立验证。
- 记录请求周期与实际有效覆盖。完成状态不证明数据完整；每个来源保留观测/抓取时间与截断信息，排名与估算量分列，不平均或相加。

### SellerSprite MCP 路由

工具可用时按当前工具说明调用，不凭记忆猜参数。典型路由如下：

| 目的 | 首选工具 | 说明 |
|---|---|---|
| ASIN 身份、价格、评论、类目 | `mcp__sellersprite_mcp__asin_detail_with_coupon_trend` 或 `asin_detail` | 标价与 Coupon 后价分开；记录日期和变体 |
| ASIN 流量结构概览 | `mcp__sellersprite_mcp__traffic_keyword_stat` / `traffic_source` | 用于判断来源结构和预期明细规模，不替代明细 |
| 单 ASIN 流量词明细 | `mcp__sellersprite_mcp__traffic_keyword` | 对每个用户指定 ASIN 分页采集；保留自然、广告和推荐来源 |
| 多 ASIN 交集/扩展 | `mcp__sellersprite_mcp__traffic_extend` | 每批遵守工具 ASIN 上限；仅作联合扩展，不替代逐 ASIN 明细 |
| 大盘根词研究 | `mcp__sellersprite_mcp__keyword_research` / `keyword_miner` | 对多个 seed 分别采集，保留 seed 来源 |
| ABA 与趋势 | `mcp__sellersprite_mcp__aba_research_monthly`、`aba_research_weekly`、`keyword_research_trends` | 记录时间粒度；趋势不等于稳定需求 |
| 类目与节点确认 | `mcp__sellersprite_mcp__product_node` | 避免混入错误类目 |
| 竞品补充 | `mcp__sellersprite_mcp__asin_competitor` / `competitor_lookup` | 用户未要求补充时不替换用户 ASIN；新增对象要标 `RESEARCH_ADDED` |

第三方字段名称和可用性可能变化。先检查当次工具 schema，只请求实际存在的字段；不要为了统一模板编造空字段含义。

若 SellerSprite MCP 未安装、未连接、无权限或持续失败：先读取用户提供的 SellerSprite 导出和既有 RAW；仍无数据时继续产品事实、第一方数据与 Amazon 前台部分，并把运行状态设为 `PROVISIONAL`。用户可见说明：“大盘搜索量和竞品流量词暂缺；不会用普通网页搜索假装替代 SellerSprite 数据。”需要完整结论时再请用户连接 MCP 或提供导出，不因缺失而补造指标。

## 3. 大盘 seed 设计

至少覆盖下列适用层级，并在台账中说明哪些不适用：

1. 类目核心根词；
2. 同义词、常见词序、单复数和高频错拼；
3. 形态、套装数量、材质、动力/接口或兼容方式；
4. 已发布就绪的关键功能；
5. 人群、场景、问题和季节；
6. Amazon 前台纠错或建议中实际观察到的表达。

不要用品牌词、未支持功能或认证词充当市场 seed。高风险功能可以作为隔离查询验证市场存在，但必须标记门禁，不能因此进入已释放词库角色。

完成后输出 seed 覆盖表：`seed → 页数 → 原始行数 → 唯一词数 → 新增唯一词数 → 状态`。如果连续多个 seed 只返回同一批词，仍保留来源，但可停止无增量的同义 seed 扩张并写明停止依据。

## 4. 全量分页协议

对所有支持分页的数据源执行：

1. 从第一页开始，使用工具允许的合理最大页大小；
2. 保存每页响应、页码、行数和行指纹；
3. 直到出现明确结束条件：空页、返回行数小于页大小、工具给出总页数且已到末页、或 API 明确的硬上限；
4. 若连续页指纹重复，停止并标 `PAGINATION_REPEAT`，避免无限循环；
5. 参数错误先按 schema 修正一次；短暂失败可重试一次；仍失败则记 `FETCH_FAILED`，不无限刷新；
6. 任何用户或工具上限都写入参数表和覆盖率，不能称为“全量”却不披露截断。

对 `traffic_extend` 等有批量 ASIN 上限的工具，按原顺序稳定分批，建立 `batch_id`，最后核对全部 ASIN 只出现一次或按预期重复。

## 5. 竞品全量协议

先读取 `competitor_lock.json`。提供锁定结果时不得重新选择或静默改写角色；只在身份/变体或当前快照与上游明确冲突时更新，并记录旧值、原因和证据。角色使用：`LEADER / LAUNCH_PEER / DIRECT_PRICE_FORM / NEW_ENTRANT / DIFFERENTIATED_CHALLENGER / ADJACENT_ALTERNATIVE`。

对每个 `keyword_acquisition_scope=FULL_TRAFFIC` 的 ASIN，以及全部身份有效的用户指定 ASIN：

1. 确认站点与 ASIN 身份；
2. 获取快照字段并保留上游 `primary_role / roles / lock_status`；
3. 获取流量词概览统计；
4. 分页获取流量词明细；
5. 保存每个关键词的自然排名、广告排名、来源、流量占比、搜索/购买/竞价等实际返回字段；
6. 成功但无明细写 `NO_ROWS`；无权限、超时或解析失败写 `FETCH_FAILED`；
7. 建立 ASIN 覆盖表并核对 `输入 ASIN 数 = 成功 + NO_ROWS + FETCH_FAILED + 身份无效`。

不要因为头部 ASIN 难打就不抓其词；也不要因为某个 `LAUNCH_PEER` 流量弱就把它从词库删除。前者提供大盘边界，后者可揭示直接竞品的真实弱词结构。

`CONTEXT_ONLY` 研究新增对象只用于市场语言、替代需求和污染背景，不把其词默认并入正向候选；`NO_QUERY` 对象不调用流量工具并写明身份或排除原因。用户指定对象即使最终为相邻角色，只要身份有效仍完整采集，避免静默丢失用户范围。

## 6. 原始层与标准化层

### 原始层

原始表只追加，不覆盖，至少保留：

- `source_run_id`、工具、站点、月份/日期、页码、seed 或 ASIN；
- 原始关键词与所有实际返回字段；
- 抓取状态、错误信息和原始行号；
- 是否自然、广告、推荐或其他来源。

原始层不做语义去重、不把空值填 0、不改写第三方字段。

### 标准化层

建立以下字段：

- `keyword_original`：原词；
- `keyword_normalized`：Unicode、大小写、首尾空白和重复空格标准化后的词；
- `keyword_family_id`：单复数、词序、错拼或轻微形态变体的家族；
- `language`、`token_count`、`brand_flag`；
- `source_market`、`source_competitor`、`source_product_inference`、`source_serp`；
- `source_asin_count` 与 `source_asins`；
- 每个指标的值、日期与缺失状态。

不要自动删除停用词；Amazon 查询中的介词、数量词和词序可能改变意图。近似变体可聚类，但原词和各自指标必须保留。

## 7. 合并与指标规则

- 同一数据源、同一月份、同一规范词出现多行时先判断是不同来源/变体，不能直接求和。
- 跨 seed 重复行以唯一数据记录为主，同时保留所有 `seed_lineage`。
- 跨 ASIN 的同词不合计搜索量；市场级搜索量通常是同一词的公共指标，只保留同月一致值并记录冲突。
- 竞品覆盖度可计算为 `出现该词且查询成功的 ASIN 数 / 查询成功 ASIN 数`，不能用全部输入数掩盖失败。
- 自然排名、广告排名和流量占比按 ASIN 分开；需要汇总时使用中位数、最好/最差和样本数，并保留明细。
- 不把 SellerSprite 购买率当我方第一方 CVR，也不据此推导任何下游执行策略。

## 8. 数据质量审计

至少检查：

- ASIN 输入覆盖率、成功率与空结果率；
- seed 覆盖和新增词递减；
- 分页是否截断或重复；
- 原始行数与主库来源回链是否一致；
- 同月同词的市场指标冲突；
- 数字、百分比、币种和日期类型；
- `MISSING/NO_ROWS/FETCH_FAILED/ZERO_OBSERVED` 是否混用；
- 品牌词、错误形态和未发布功能是否误进入 `CORE_VERIFIED / SECONDARY_VERIFIED / INDEXING_CANDIDATE`。

如果主要词源之一未取得，状态写 `PROVISIONAL` 并清楚说明“现阶段能判断什么、不能判断什么”，不因已有数据量很大就宣称完整。
