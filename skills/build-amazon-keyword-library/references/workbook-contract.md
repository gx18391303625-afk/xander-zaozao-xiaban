# Excel 词库交付契约

完整建库默认使用电子表格能力创建 `.xlsx`，再计算、重新打开、渲染和目视检查。工作簿必须让用户一打开就先看到“词库如何分层、依据是什么、还缺什么证据”，同时允许追溯到全部原始数据。

## 1. 必备工作表

工作表名控制在 Excel 限制内，默认按以下顺序：

1. `00_结论与词库分层`
2. `01_产品事实_门禁`
3. `02_关键词主库`
4. `03_大盘全量_RAW`
5. `04_竞品全量_RAW`
6. `05_ASIN覆盖_竞品地图`
7. `06_前台反向验证`
8. `07_阶段背景`
9. `08_隔离与排除`
10. `09_季节趋势`
11. `10_参数与口径`
12. `11_QA看板`
13. `12_文案交接`

如果已有工作簿使用稳定表名和下游公式，增量更新时优先保留原表名并建立映射，不能为了符合模板破坏用户现有引用。

## 2. `00_结论与词库分层`

置顶写：站点、产品、快照日期、目标售价、当前评论数、目标评论窗口、`decision_basis_stage` 和运行状态 `COMPLETE / PROVISIONAL / RUN_BLOCKED`。

首页先给三步导航：

1. 本页看关键词分层和主要证据；
2. `08_隔离与排除` 查看品牌/IP、错误意图和不支持词；
3. `02_关键词主库` 查看全部词与理由；RAW 和 QA 只用于追溯。

紧接着用卖家语言展示分项覆盖，不能合成一个总百分比：

- 输入 ASIN 行数、唯一 ASIN 数、身份成功/无数据/失败；
- 竞品流量明细成功/无行/失败及 RAW 行数；
- 大盘 seed 数、清单、已完成分页与 RAW 行数；
- 主库词数、进入前台验证的词数、计划/实扫页数；
- 工具月份、分页上限、分片/外置 RAW 和未覆盖项。

首页明确：“全量”是本次 seed、全部指定 ASIN 和已披露工具边界内取得的全部原始行，不等于 Amazon 全站所有关键词。

核心分层表至少包含：

- 词族/代表词；
- 词库角色；
- 与我的产品是否匹配；
- 是否有流量依据；
- Amazon 搜索结果相关度；
- 当前价格和评论对应的竞争背景；
- 主要理由；
- 还缺什么证据；
- 下一步研究动作；
- 判断依据编号；
- 是否需用户确认。

按 `核心已验证 → 次级已验证 → 相关待验证 → 后续阶段相关 → 收录候选 → 市场背景 → 隔离/冻结/排除` 排序。不要只展示搜索量最高词。用户可见角色先写中文，内部代码放次级列：

| 用户可见角色 | 内部代码 |
|---|---|
| 核心已验证 | `CORE_VERIFIED` |
| 次级已验证 | `SECONDARY_VERIFIED` |
| 相关但仍需验证 | `RELEVANT_NEEDS_VALIDATION` |
| 后续阶段相关 | `LATER_STAGE_RELEVANT` |
| 收录候选 | `INDEXING_CANDIDATE` |
| 市场背景词 | `MARKET_CONTEXT` |
| 品牌/IP 隔离 | `BRAND_IP_ISOLATED` |
| 主张证据未释放 | `HOLD_CLAIM` |
| 错误购买意图 | `WRONG_INTENT` |
| 产品不支持 | `UNSUPPORTED` |

对 `PROVISIONAL / MISSING / NO_ROWS / FETCH_FAILED / UNKNOWN` 提供中文图例。

## 3. `01_产品事实_门禁`

至少包含：

- `fact_id`、字段、值、单位、适用变体和 `coverage_level`；
- 来源文件/页面/用户确认与位置，合规文件另列类型、签发主体、标准/编号、签发日、预计到件日、收件日、审查日、审查状态和有效状态；
- `evidence_type`、`risk_class`、`research_status`、`publication_status`、`claim_modifier_id` 和冲突 ID；
- `research_eligible`、`listing_indexing_eligible`、`front_end_copy_eligible`、`logo_mark_eligible`、`downstream_review_eligible`；
- `approved_claim_text` 与 `approved_claim_scope`；
- 禁用措辞；
- 释放条件与负责人/预计日期（若用户提供）。

认证、测试、安全、医疗、环保与量化性能单独成组。预计日期只用于排期，日期到达不改变 `HOLD_FEATURE/PENDING`；只有收到并审查新证据才能释放。

## 4. `02_关键词主库`

至少包含以下列组；可根据数据源增加字段，但不能删除来源与门禁字段。冻结的左侧操作区依次放：原关键词、中文意图/词族、词库角色、主要理由、与产品是否匹配、需求证据、Amazon 相关度、竞争背景、证据缺口、释放条件和下一步研究动作。技术 ID、原始指标和审计字段放右侧，可用列组折叠。

### 身份与来源

- `keyword_id`、`keyword_original`、`keyword_normalized`、`keyword_family_id`、`claim_modifier_id`；
- 语言、词数、主意图、副意图；
- `source_market / source_competitor / source_product_inference / source_serp`；
- 市场 seeds、源 ASIN 数、源 ASIN 列表、ASIN 角色分布；
- 数据月份、采集日期、证据 ID。

### 原始需求与竞争指标

- 搜索量、购买量、`SellerSprite购买率_第三方估算`、ABA/搜索排名；
- 数据源返回的竞价范围、广告竞品数、商品数、供需比、标题密度、点击集中度；
- 自然/广告排名摘要、流量占比摘要；
- 每项指标的来源、样本数和缺失状态。

只放数据源实际提供的值。字段不可用时状态写 `MISSING`，不造列含义。竞价、广告竞品数和广告排名只能作为带来源与日期的原始市场信号，不能被转写成匹配方式、出价、预算或投放建议。

### 产品与前台

- 产品匹配、研究资格、发布资格、收录/前台资格、下游复核资格、品牌/IP、错误形态；
- 首页与全扫描的直相关率、同形态率、污染率；
- 首页与全扫描可比价格/评论统计；
- `competition_context = CURRENTLY_COMPARABLE / CHALLENGING / LATER_STAGE / NOT_COMPARABLE / UNKNOWN`、SERP 快照日期和验证覆盖。

### 词库分类与研究交接

- `library_role`、隔离组、阶段背景；
- 一行理由、风险、证据缺口和释放条件；
- `next_research_step`、用户确认项、分析置信度、`downstream_review_eligible`；
- 事实/估算/推断标签。

不要只保留高优先级词；主库应包含候选全集及当前角色，以便审计为什么被验证、后置、隔离或排除。`SellerSprite购买率_第三方估算` 与 `first_party_cvr` 必须分列，前者只能作为第三方需求信号，不能被转写成我方表现或广告策略。

稳定 ID 使用确定性规则并在参数表记录版本：`keyword_id = marketplace + keyword_normalized_exact`；`keyword_family_id` 独立维护词族规则版本；`source_run_id/evidence_id` 属于采集批次，不与关键词身份混用。

## 5. RAW 表

`03_大盘全量_RAW` 和 `04_竞品全量_RAW` 只追加原始行，不做语义去重，不用公式改写源值。包含 `source_run_id`、工具、查询参数摘要、seed/ASIN、页码、原始行号、抓取状态和全部实际返回字段。

若原始 JSON 太宽，可保留关键原始列和外部原始文件链接，但必须保证一行可回溯到原响应。禁止静默截断：

- 达到工作表安全行数前自动分片为 `_RAW_001`、`_RAW_002` 等；
- 接近 Excel 单元格 32,767 字符上限的 payload 外置为 UTF-8 CSV/JSONL/Parquet，不塞入单元格；
- 工作簿建立 manifest，记录文件/工作表、`source_run_id`、行数、字节数、校验和与路径；
- QA 必须满足 `API原始行数 = 工作簿RAW行数 + 外置RAW行数`，并验证所有页可回链。

来自 Amazon、第三方工具和错误信息的外部文本一律按纯字符串写入；以 `= + - @` 开头的值必须转义，只有受控公式列可成为 Excel 公式。

## 6. `05_ASIN覆盖_竞品地图`

每个用户输入位置保留一个 `input_instance_id`，每个唯一规范 ASIN 保留一个查询对象；重复 ASIN 不能让查询重复，但输入行不能消失。分别核对输入行覆盖和唯一 ASIN 查询覆盖。

每个输入 ASIN 至少保留：

- 输入顺序和排序依据；
- ASIN、父子体/变体、标题、品牌；
- 标价、Coupon 后价、套装归一化价格；
- 星级、评论数、类目/BSR 快照；
- 形态、套装、核心可见功能；
- `source_role`、`primary_role` 与 `roles[]`；统一角色为 `LEADER / LAUNCH_PEER / DIRECT_PRICE_FORM / NEW_ENTRANT / DIFFERENTIATED_CHALLENGER / ADJACENT_ALTERNATIVE`；
- `lock_status`、锁定分数/理由、研究深度、关键词采集范围、`competitor_lock_run_id` 和角色变化记录；
- 详情状态、流量统计状态、流量明细页数、原始行数；
- `SUCCESS / NO_ROWS / FETCH_FAILED / INVALID_IDENTITY`；
- 错误/缺口与证据 ID。

顶部给出两套覆盖恒等式：输入实例覆盖；唯一有效 ASIN 的身份与流量查询覆盖。竞品关键词覆盖度分母使用查询成功 ASIN 数，同时并列展示全部输入数和失败数。

## 7. `06_前台反向验证`

建议分为“关键词汇总”和“卡片明细”两个表区，或拆成两张表但保持导航清晰。至少包含：

- 查询词、纠正词、站点、时间、地区、计划页/已扫页；
- 首页和全扫描结果数、直相关率、同形态率、污染率、Sponsored 密度；
- 可比价格与评论统计；
- 主要污染、指定 ASIN 位置、详情页核验数；
- 对词库角色的影响和证据 ID。

若保存卡片明细，包含页码、位置、ASIN、Sponsored/Organic、标题、价格、评论、关系判定和原因。

## 8. 阶段背景、隔离与趋势

`07_阶段背景` 按用户自定义阶段列出 `operating_context_id`、当前观察价、计划价格阶段、`current_reviews`、`target_review_range`、`decision_basis_stage`、阶段假设、词族、竞争背景、依赖数据和重新评估条件。当前观察状态与目标/计划状态不能混成一个阶段；计划价格始终标 `PLANNED_UNVERIFIED`。若 `LATER_STAGE_RELEVANT.current_stage_eligible=true`，本表同时列出 `stage_id / evaluated_at / basis_type / evidence_ids`。本表不写预算、出价、放量时间或活动安排。

`08_隔离与排除` 至少包含隔离原因、品牌/IP 状态、错误意图、不支持事实、证据、可能误伤的相关词族和复核日期。品牌词列 `BRAND_IP_ISOLATED`；错误意图列 `WRONG_INTENT`；产品不支持列 `UNSUPPORTED`。本表不是广告否定词清单，不指定 Exact/Phrase 或适用活动。

`09_季节趋势` 记录数据源、观察周期、时间粒度、需求阶段、提前量、趋势结论、证据 ID、置信度和刷新日期。无可靠数据时表首明确写“本次未取得可靠趋势数据，暂不用于决策”，并将分类/当前阶段保持 `UNKNOWN`，不画假趋势线或按品类名称补造固定月份。

## 9. 参数、口径与 QA

`10_参数与口径` 保存：工具、月份、页大小、分页上限、seed、ASIN 批次、汇率/币种、可比套装规则、阈值、权重、用户约束、分析师假设和版本记录。

`11_QA看板` 至少检查：

- ASIN 覆盖恒等式；
- 上游项目 ID、竞品锁定运行 ID、统一角色、锁定状态和关键词采集范围是否完整；角色变化是否有旧值、原因和证据；
- 市场/竞品两类 RAW 行数；
- 各状态数量和空结果/失败数量；
- 主库每行是否有来源、产品门禁、词库角色和理由；
- 缺失值是否误填 0；
- `D4_SERP_ONLY/D5_INFERRED_ONLY` 是否被误标高流量，D4-only 是否错误进入 `CORE_VERIFIED`；
- SellerSprite 购买率是否被误写为我方第一方表现；
- 高风险词 `publication_status` 未释放却进入 `RELEASED_LIBRARY_ROLES = CORE_VERIFIED, SECONDARY_VERIFIED, LATER_STAGE_RELEVANT, INDEXING_CANDIDATE`；后置角色也不得代替 `HOLD_CLAIM`；
- `MSDS_SDS` 是否错误允许 passed/certified/safe；`TEST_REPORT` 是否错误允许 certified/listed/approved；
- `coverage_level != whole_unit` 是否错误释放整机认证词；
- `claim_text / claim_scope / claim_model` 是否与批准措辞、文件层级和型号一致；徽标是否另有有效且范围匹配的 `MARK_AUTHORIZATION`；
- 高风险释放依据是否只有用户、工厂、我方 Listing 或竞品文案；
- `FORMAL_CLAIM_RELEASED` 是否缺编号、型号、签发主体、标准、批准措辞、范围、非未来签发日、收件日、审查日或 `review_status=APPROVED`；
- `PENDING/HOLD_FEATURE` 是否因预计日期到达被自动释放；预计日期不得替代签发、收件和审查字段；
- 精确量化主张是否缺 BOM/固件、测试方法、测量起止、环境/档位、误差、正整数样本、值类型和非未来批准日期；
- 带认证/安全/量化修饰词的原词是否错误继承基础词角色；
- 品牌/IP、错误意图、不支持词是否分别进入正确的隔离或排除角色；
- 是否出现本技能禁止的活动结构、匹配方式、出价、预算、ACoS、止损、放量或广告否定规则；
- 首页与深页是否分开；
- 公式错误、坏链接、重复 ID 和未解析冲突；
- 外部文本是否触发公式注入，RAW 是否分片/外置且行数与校验和闭环；
- 工作簿版本、生成时间和渲染检查结果。

## 10. `12_文案交接`

按 [downstream-handoff.md](downstream-handoff.md) 汇总交给 `$write-amazon-listing` 的研究输入：

- `project_id / selection_run_id / candidate_id / competitor_lock_run_id / keyword_run_id`；
- 已证实产品事实、允许措辞、冻结主张和证据 ID；
- 当前观察价与计划价格阶段、证据化季节上下文、内容/素材锁定和风险确认；
- 锁定竞品、角色、主要承诺、VOC、护城河与已证实差异；
- `CORE_VERIFIED / SECONDARY_VERIFIED / INDEXING_CANDIDATE` 及对应门禁、理由和证据；
- 相关待验证、后续阶段、市场背景、品牌/IP、错误意图和不支持词；
- 未知项、数据缺口、来源工作簿和 RAW manifest。

该表与 `listing_handoff.json` 的对象计数、角色和证据 ID 必须一致。它不写标题、五点、Search Terms 成稿，也不包含广告策略。

## 11. 可用性与视觉 QA

- 首行筛选、冻结关键列、使用可读的列宽和换行；
- 数值保持数值类型，百分比和币种使用一致格式；
- 用颜色表达词库角色，但不能只靠颜色传达含义；
- RAW 表不追求装饰，结论、主库和 QA 表重点优化可读性；
- 公式不覆盖用户原始输入；
- 生成后重新打开工作簿，检查公式错误与工作表结构；
- 渲染关键表并目视检查截断、乱码、重叠、隐藏列和错误格式；
- 最终文件名包含产品简称、站点与快照日期，避免覆盖旧版本。
