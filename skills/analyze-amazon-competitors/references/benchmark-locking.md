# 对标竞品发现、评分与锁定

## 目标

把第一步的市场商品池转成“本次运行锁定”的对标组，而不是凭销量、排名或个人印象挑几个 ASIN。锁定只对当前站点、候选产品、价格/套装、目标阶段和数据月份有效；它不是永久名单。

## 上游输入

用户手上有选品插件产出的 `handoff.json` 时读取它并保留下列内容；没有就直接从产品方向/类目 seed 或锚点 ASIN 开始（选品已冻结，见 xander-operations/references/lineage-and-selection.md），缺的 ID 留空、不编造：

- `project_id / selection_run_id / candidate_id`；
- 站点、币种、研究日期、目标类目和市场 seed；
- 目标人群、场景、产品形态、目标价格、成本上限和阶段边界；
- 用户指定 ASIN、原始顺序、研究新增 ASIN 和已有角色；
- 已证实产品事实、主张门禁、风险和证据 ID。
- 完整 `operating_context` 信封及稳定的 `context_id`；原样透传，不进入竞品评分。

没有上游文件时，可从当前对话、用户资料和卖家精灵/Amazon 数据重建最小输入。未知值保持 `UNKNOWN`；不要为完成评分猜售价、评论阶段、套装或产品规格。

## 统一角色

每个唯一 ASIN 使用一个 `primary_role`，必要时另列多个 `roles`：

- `LEADER`：类目或核心词头部，界定天花板、成熟做法和强壁垒；
- `LAUNCH_PEER`：与我方当前/目标评分数阶段、星级信任水平、标准化价格或资源更接近；
- `DIRECT_PRICE_FORM`：用途、形态、规格、套装、价格和购买逻辑最直接；
- `NEW_ENTRANT`：近期上架且出现可见需求，用来验证新链接通道；
- `DIFFERENTIATED_CHALLENGER`：通过不同结构、组合或定位取得需求；
- `ADJACENT_ALTERNATIVE`：解决相同任务但产品形态或购买逻辑不同。

另设 `source_role = USER_SUPPLIED / UPSTREAM_SELECTED / RESEARCH_ADDED`，它只说明来源，不等于市场角色。兼容旧值：`ANCHOR` 只转成 `USER_SUPPLIED`，再按证据确定市场角色；`DIRECT → DIRECT_PRICE_FORM`，`CHALLENGER → DIFFERENTIATED_CHALLENGER`，`SUBSTITUTE → ADJACENT_ALTERNATIVE`。

## 候选发现

候选池至少覆盖适用的以下来源：

1. 第一阶段交接的全部 ASIN；
2. 用户明确指定 ASIN，保留原顺序和排序依据；
3. 卖家精灵 `competitor_lookup` 的类目/关键词商品池；
4. `asin_competitor`、`traffic_listing` 返回的直接关联对象；
5. Amazon 核心 seed SERP、类目榜单和新进入者信号；
6. 同一任务的替代方案。

每个研究新增对象记录发现工具、参数、seed/锚点、页码、月份和 `source_run_id`。不要先选喜欢的 ASIN，再反向寻找支持它的数据。

## 身份与可比性硬门禁

评分前确认：

- ASIN 与站点有效、当前可售或明确标为历史参考；
- 父体、子体、当前变体和套装已解析；
- 标价、Coupon 后价、套装数和单件价口径可比；
- 核心购买任务、产品形态和主要使用人群没有混淆；
- 评分值、评分数量、上架时间和第三方销量均带时间快照；
- 价格、可售状态和配送快照标明 `demand_phase_at_capture`；页面不可售只作为当前 Offer 证据，不推断真实库存、生产或补货能力；
- 评分数优先读取结构化 `ratings` 字段；空白 `reviews` 保持 `MISSING`，再用 `asin_detail` 核对，不能当成 0；
- 星级与评分数分列，`rating_scope` 标明 `PARENT / CHILD / VARIATION_SHARED / UNKNOWN`；
- 第三方字段空白保持 `MISSING`，不填成 0。

身份无效或下架对象标 `EXCLUDED_INVALID`；变体未解析标 `IDENTITY_PENDING`，不能进入锁定组。用户输入行仍保留在覆盖表。

## 评分维度

对每个唯一有效 ASIN 使用 0–5 分。默认权重只用于本次候选池内排序：

| 维度 | 默认权重 | 判断内容 |
|---|---:|---|
| `intent_match` | 20% | 核心购买任务与搜索意图 |
| `form_spec_match` | 16% | 形态、规格、数量、接口和关键功能 |
| `price_pack_match` | 14% | Coupon 后到手价、套装和标准化单件价格的可比性 |
| `ratings_count_match` | 14% | 评分数是否处于我方当前/目标阶段或所选可追赶区间 |
| `star_rating_strength` | 8% | 星级形成的信任强度及其稳定性，不与评分数混为一项 |
| `audience_scenario_match` | 9% | 目标人群、场景和替代方案 |
| `stage_attainability` | 7% | 上架阶段、品牌/资源、内容成熟度和新链接可达性；不再重复代替评分数 |
| `market_relevance` | 7% | 核心词/类目可见度、销量趋势和市场代表性 |
| `evidence_quality` | 5% | 身份、变体、父子体口径、时间窗和数据完整度 |

默认权重是透明起点，不是市场事实。项目需要调整时可在顶层提供完整 `weights` 对象；必须包含全部九个维度、非负且合计为 1，并原样写入锁定包，不能在结果出来后偷偷改权重追答案。

不得只填裸分数。每个有效候选必须提供 `role_evidence = {basis, evidence_ids[]}`，并为上述每个维度提供 `dimension_evidence.<dimension> = {basis, evidence_ids[]}`。`basis` 写观察或计算口径，`evidence_ids` 回链页面、卖家精灵快照或上游证据。身份无效或变体待确认的对象不评分、不强行分角色，但必须提供 `identity_evidence = {basis, evidence_ids[]}`。证据不足时保持待核验，不凭印象补分。

运行：

```bash
python3 <skill-directory>/scripts/score_benchmark_candidates.py --input <candidates.json>
```

阈值可由用户或项目覆盖。默认值只用于同一候选池内的可复现排序，不能跨品类宣称“达到多少分就一定值得打”。分数不能覆盖身份门禁，也不能把 `ADJACENT_ALTERNATIVE` 变成直接竞品。

## 评分数 × 价格对标带

当用户要求按评分数/价格对标，或第一阶段已经给出目标价与目标评分窗口时，增加顶层 `peer_bands`：

```json
{
  "basis": "USER_DEFINED",
  "derivation": "用户或当前市场分布定义本次价格与评分数对标区间",
  "evidence_ids": ["E-PEER-BAND-001"],
  "price_metric": "effective_price",
  "price_min": null,
  "price_max": null,
  "currency": "USD",
  "ratings_count_min": null,
  "ratings_count_max": null,
  "star_rating_min": null
}
```

规则如下：

- `basis` 只能为 `USER_DEFINED / UPSTREAM_STAGE / MARKET_DISTRIBUTION`。用户阈值优先；使用市场分布时必须记录样本宇宙、页数、类目/seed、快照日期、分位数或分箱算法，不能把一次分布固化成跨品类默认值。
- `price_metric` 只能选 `effective_price` 或 `unit_price`。不同套装、数量或容量必须先标准化；标价、Coupon、Prime 价不得混为一个字段。
- 每个候选的 `snapshot` 至少记录所选价格、币种、`star_rating`、`ratings_count`、`rating_scope` 和 `observed_at`。父体共享评分与子体独立评分不得直接混比。
- 核心组仍须满足用途/形态直接可比、总分阈值、`price_pack_match >= 3`、`ratings_count_match >= 3`；启用 `peer_bands` 时还必须 `peer_band_result.status = IN_BAND`。
- 直接相关但评分数或星级明显高于所选可追赶上限的对象作为信任壁垒，转为 `BOUNDARY_REFERENCE`，不因销量高就进入当前核心组。
- 价格越界、评分数低于目标阶段或其他不匹配对象不自动删除；按角色进入差异化、词源或上下文组。字段缺失、日期缺失或 `rating_scope = UNKNOWN` 时结果为 `UNKNOWN`，不能进入核心组，也不能把空值写成 0。
- `peer_bands.currency` 未知时，即使两个价格数字相同也不能判定同价位；观察日期须为有效、非未来 ISO 日期。日期无效/未来或币种不明时保留 `UNKNOWN`，不得进入核心组。脚本不验证来源真伪或自定过期天数，时效需按本次研究窗口复核。
- 没有启用 `peer_bands` 时，仍单独评估价格、评分数和星级，但不得臆造固定区间。

## 锁定状态

- `CORE_BENCHMARK`：直接且当前最值得深度对标；
- `BOUNDARY_REFERENCE`：头部边界，保留但不等同当前可追赶对象；
- `DIFFERENTIATION_REFERENCE`：新品或差异化挑战者；
- `KEYWORD_SOURCE_ONLY`：有词源价值，但不作为产品/Offer 核心基准；
- `CONTEXT_ONLY`：只用于替代需求、污染和市场背景；
- `IDENTITY_PENDING`：身份/变体未闭环；
- `EXCLUDED_INVALID`：身份无效、下架或与本市场不属于同一对象。

`CORE_BENCHMARK` 不强制固定数量。应覆盖足以代表直接竞争的对象，同时避免大量近乎相同 ASIN 重复消耗深拆资源。头部即使不进入核心组，也保留为 `BOUNDARY_REFERENCE`。

## 研究深度与关键词范围

| 锁定状态 | 竞品研究深度 | 关键词采集 |
|---|---|---|
| `CORE_BENCHMARK` | `DEEP` | `FULL_TRAFFIC` |
| `BOUNDARY_REFERENCE` | `STANDARD` | `FULL_TRAFFIC` |
| `DIFFERENTIATION_REFERENCE` | `STANDARD` | `FULL_TRAFFIC` |
| `KEYWORD_SOURCE_ONLY` | `IDENTITY_AND_TRAFFIC` | `FULL_TRAFFIC` |
| `CONTEXT_ONLY` | `SCAN` | `CONTEXT_ONLY` |
| `IDENTITY_PENDING / EXCLUDED_INVALID` | `NONE` | `NO_QUERY` |

用户明确指定且身份有效的 ASIN，不论最终市场角色如何，都保留 `FULL_TRAFFIC` 采集资格；在关键词主库中再按角色隔离，不因“不好打”静默删词。竞品锁定 Skill 只读取决定角色所需的流量结构摘要，逐词分页、合并和词库角色由 `$build-amazon-keyword-library` 负责。

## 交付契约

输出 `competitor_lock.json`，至少包含：

```json
{
  "schema_version": "1.1",
  "project_id": "...",
  "selection_run_id": "...",
  "candidate_id": "...",
  "competitor_lock_run_id": "...",
  "marketplace": "US",
  "captured_at": "YYYY-MM-DD",
  "data_month": "YYYYMM",
  "target_context": {},
  "operating_context": {
    "context_id": "...",
    "profit_objective": {},
    "price_context": {},
    "demand_calendar": {},
    "supply_routes": [],
    "replenishment_policy": {},
    "content_change_control": null,
    "acknowledged_risks": []
  },
  "operating_context_sha256": "sha256:<64 lowercase hex>",
  "competitor_context_updates": [],
  "peer_bands": {
    "basis": "UPSTREAM_STAGE",
    "derivation": "...",
    "evidence_ids": ["E-PEER-BAND-001"],
    "price_metric": "effective_price",
    "price_min": null,
    "price_max": null,
    "currency": "USD",
    "ratings_count_min": null,
    "ratings_count_max": null,
    "star_rating_min": null
  },
  "competitors": [
    {
      "input_instances": [],
      "asin": "B012345678",
      "source_role": "USER_SUPPLIED",
      "primary_role": "LAUNCH_PEER",
      "roles": ["LAUNCH_PEER", "DIRECT_PRICE_FORM"],
      "role_evidence": {"basis": "...", "evidence_ids": ["E-ROLE-001"]},
      "dimension_evidence": {
        "intent_match": {"basis": "...", "evidence_ids": ["E-INTENT-001"]},
        "form_spec_match": {"basis": "...", "evidence_ids": ["E-FORM-001"]},
        "price_pack_match": {"basis": "...", "evidence_ids": ["E-PRICE-001"]},
        "ratings_count_match": {"basis": "...", "evidence_ids": ["E-RATINGS-001"]},
        "star_rating_strength": {"basis": "...", "evidence_ids": ["E-STARS-001"]},
        "audience_scenario_match": {"basis": "...", "evidence_ids": ["E-AUDIENCE-001"]},
        "stage_attainability": {"basis": "...", "evidence_ids": ["E-STAGE-001"]},
        "market_relevance": {"basis": "...", "evidence_ids": ["E-MARKET-001"]},
        "evidence_quality": {"basis": "...", "evidence_ids": ["E-QUALITY-001"]}
      },
      "lock_status": "CORE_BENCHMARK",
      "research_depth": "DEEP",
      "keyword_acquisition_scope": "FULL_TRAFFIC",
      "snapshot": {
        "effective_price": null,
        "currency": "USD",
        "star_rating": null,
        "ratings_count": null,
        "rating_scope": "PARENT",
        "observed_at": "YYYY-MM-DD"
      },
      "peer_band_result": {
        "status": "IN_BAND",
        "core_eligible": true,
        "trust_barrier": false
      },
      "score": 82.5,
      "lock_reasons": [],
      "exclusion_or_pending_reason": null,
      "evidence_ids": []
    }
  ],
  "coverage": {},
  "unknowns": [],
  "refresh_triggers": []
}
```

输入若已有 `operating_context_sha256`，必须与按选品契约计算的信封哈希一致；旧输入缺失时可在本阶段补算。新 `competitor_lock.json` 必须输出该哈希，并与信封一起原样交给下游。竞品观察只写 `competitor_context_updates[]`，不能靠重算哈希掩盖对原信封的改写。

同时输出用户可读的锁定表：原始顺序、ASIN、Coupon 后/单件价格、星级、评分数及其父子体口径、对标带结果、角色、锁定状态、分数、纳入/排除理由、研究深度、关键词范围和证据 ID。

## 刷新触发

出现下列情况时重新锁定或局部复核：

- 目标产品形态、套装、价格或人群改变；
- ASIN 下架、换父体、切换主变体或大幅改版；
- 最新月份的价格、评分、销量趋势或核心词 SERP 角色明显变化；
- 新进入者改变“新链接能否获得需求”的判断；
- 第一阶段 Go/No-Go 或产品事实发生变化。
- 目标价格阶段、需求阶段或利润底线变化并实际改变价格对标带或阶段可比性；
- 供应路线或补货约束变化并实际改变目标上市阶段。普通库存波动只局部刷新快照，不自动触发全量重锁。

刷新保留稳定 ASIN 与输入实例 ID，输出新增、升降级、失效和替换原因，不覆盖旧快照。
