# 第二步完成包与文案交接

## 目标

在关键词工作簿之外输出稳定的 `listing_handoff.json`，让第三步 `$write-amazon-listing` 直接读取已证实产品事实、锁定竞品、关键词角色、VOC/差异证据和主张门禁，不重新猜产品、挑竞品或筛词。

交接包是研究输入，不是 Listing 成稿，也不包含广告活动、匹配方式、竞价、预算或推广节奏。

## 上游链路

保留完整项目链：

- `project_id`；
- `selection_run_id`；
- `candidate_id`；
- `competitor_lock_run_id`；
- `keyword_run_id`；
- 对应工作簿、RAW manifest 和快照日期。

选品阶段已冻结：`project_id / selection_run_id / candidate_id` 没有就留空，不必写入缺口；其他 ID 缺失时可以继续，但写入 `unknowns`。任何情况都不能新建一个看似相同却无法回链的 ID 覆盖原值。

## JSON 最低结构

```json
{
  "schema_version": "1.0",
  "project_id": "...",
  "selection_run_id": "...",
  "candidate_id": "...",
  "competitor_lock_run_id": "...",
  "keyword_run_id": "...",
  "marketplace": "US",
  "language": "en-US",
  "snapshot_date": "<YYYY-MM-DD>",
  "run_status": "COMPLETE",
  "operating_context": null,
  "operating_context_sha256": null,
  "product": {
    "identity": {},
    "verified_facts": [],
    "target_price": {},
    "current_and_target_stage": {},
    "allowed_claims": [],
    "claim_gates": [],
    "forbidden_or_unsupported_claims": []
  },
  "competitor_set": {
    "core_benchmarks": [],
    "boundary_references": [],
    "differentiation_references": [],
    "keyword_sources": [],
    "context_only": [],
    "coverage": {}
  },
  "keyword_library": {
    "core_verified": [],
    "secondary_verified": [],
    "relevant_needs_validation": [],
    "later_stage_relevant": [],
    "indexing_candidates": [],
    "market_context": [],
    "isolated_or_blocked": []
  },
  "customer_and_competition": {
    "buyer_language": [],
    "repeated_jobs_and_scenarios": [],
    "competitor_promises": [],
    "verified_differentiation_directions": [],
    "voc_evidence": [],
    "content_gaps": []
  },
  "evidence_ids": [],
  "unknowns": [],
  "source_artifacts": []
}
```

## 关键词交接字段

每个交给文案 Skill 的原词至少包含：

- `keyword_id / keyword_original / keyword_family_id`；
- `library_role`；
- 产品匹配与主意图；
- 需求证据层及实际返回指标；
- SERP 纯度和竞争背景；
- 来源 seed 与源 ASIN/角色；
- `listing_indexing_eligible / front_end_copy_eligible / downstream_review_eligible`；
- `role_reason / missing_evidence / release_gate / evidence_ids`。
- `current_stage_eligible`；若 `library_role=LATER_STAGE_RELEVANT` 且为 `true`，还必须带 `stage_eligibility_basis.stage_id / evaluated_at / basis_type=CURRENT_OBSERVED_STAGE / evidence_ids / operating_context_id`。

不得只给一个关键词列表。第三步需要知道“为什么能用、可以放在哪里复核、哪些绝对不能写”。

## 运营上下文交接

若输入包含 [input-contract.md](input-contract.md) 定义的 `operating_context`，交接包必须原样保留整个 envelope，包括已有的 `profit_objective / demand_calendar / seasonality_context / supply_routes / replenishment_policy`，以及本技能读取的 `price_context / content_change_control / acknowledged_risks`。不得拆成同义对象或只摘取摘要。该上下文遵守以下边界：

- 当前观察价与计划价保持不同对象和验证状态；`PLANNED_UNVERIFIED` 不能被下游当作实时有效价。
- 非 `UNKNOWN` 的季节结论保留来源周期、粒度、证据 ID、置信度与刷新日期；缺数据不补造固定月份。
- `content_change_control` 只约束变更权限；它不把已确认内容自动升级为合规、准确、已验证或发布就绪。
- `acknowledged_risks` 只记录运营决定；`does_not_change_evidence_or_publication_status` 始终为 `true`，不得改变事实、主张或关键词门禁。
- 顶层 `operating_context_sha256` 必须与输入或本阶段补算值一致，并随 `context_id` 一起进入 Listing 交接；关键词研究的新观察不能通过改写信封再重算哈希来表达。
- 本对象不增加活动、匹配方式、竞价、预算、ACoS、TACOS、止损或放量字段。

## 竞品与 VOC 交接

从 `competitor_lock.json` 和竞品分析结果中保留：

- ASIN、原始顺序、`primary_role / roles / lock_status`；
- 目标变体、标准化价格/套装和快照；
- 竞品主要承诺、必须守住、可攻击面和护城河；
- VOC 主题、场景、期待、实际结果、样本边界和证据 ID；
- 我方已证实差异与仍待验证方向。

关键词 Skill 不自行发明 VOC 或产品优势。竞品分析尚未执行时，对应数组保持空并列入 `unknowns`。

## 门禁

- `HOLD_CLAIM / BRAND_IP_ISOLATED / WRONG_INTENT / UNSUPPORTED` 不进入可写词列表；
- `RELEVANT_NEEDS_VALIDATION` 只能作为研究提示，不能自动进入标题、五点或 Search Terms；
- `INDEXING_CANDIDATE` 只表示交给 Listing Skill 复核收录，不代表已经决定放置；
- 高风险正式主张必须携带批准措辞、适用型号/范围、文件和证据 ID；
- SellerSprite 估算不能被转写为我方销量、CVR、保证结果或广告执行值。

## 工作簿交接页

完整建库增加 `12_文案交接`，以人类可读方式汇总：

- 项目链和快照；
- 可用于文案复核的核心/次级/收录候选词；
- 锁定竞品及其职责；
- 已证实差异、VOC 和内容空缺；
- 冻结/禁用主张；
- 当前观察状态、计划状态、季节证据、内容锁定和风险确认；
- 仍缺证据及负责人。

该页必须与 `listing_handoff.json` 的计数和 ID 一致；QA 检查不能出现工作簿已释放、JSON 仍冻结或反向冲突。
