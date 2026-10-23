# 输入契约与运行能力

普通用户直接用自然语言、附件和 ASIN 列表启动，不要求其填写 JSON、绝对路径、seed 或内部状态。只有需要复用、校验或自动化时，执行者才把已知内容规范化为本契约；未知可选字段写 `null` 或省略，不猜值。

## 示例

```json
{
  "mode": "FULL_BUILD",
  "project_id": "project-stable-id",
  "selection_run_id": "selection-run-id",
  "candidate_id": "CAND-001",
  "competitor_lock_run_id": "competitor-lock-run-id",
  "marketplace": "US",
  "product": {
    "name": "示例产品",
    "brand": "示例品牌",
    "asin": null,
    "asin_role": "OUR_PRODUCT",
    "category": "示例品类",
    "facts": [
      {
        "name": "pack_count",
        "value": 2,
        "unit": "pcs",
        "evidence_type": "USER_CONFIRMED",
        "risk_class": "LOW_RISK_SPEC",
        "research_status": "RESEARCH_USABLE",
        "publication_status": "COPY_RELEASED",
        "applicable_variant": "current production version",
        "source": "用户最新确认",
        "source_location": null
      }
    ],
    "compliance_documents": []
  },
  "target_price": {
    "min": null,
    "max": null,
    "currency": "USD"
  },
  "review_stage": {
    "current": 0,
    "target_min": 100,
    "target_max": 300,
    "decision_basis_stage": "TARGET_RANGE"
  },
  "competitors": [
    {
      "asin": "BXXXXXXXXX",
      "rank": 1,
      "order_basis": "subcategory_rank",
      "source_role": "USER_SUPPLIED",
      "primary_role": "LAUNCH_PEER",
      "roles": ["LAUNCH_PEER", "DIRECT_PRICE_FORM"],
      "lock_status": "CORE_BENCHMARK",
      "keyword_acquisition_scope": "FULL_TRAFFIC",
      "lock_run_id": "competitor-lock-run-id",
      "evidence_ids": []
    }
  ],
  "market_seeds": [
    {
      "query": "core category keyword",
      "purpose": "MARKET_DISCOVERY",
      "source": "product category"
    }
  ],
  "source_files": ["/absolute/path/resolved/by/the/system/manual.pdf"],
  "requested_deliverables": [
    "KEYWORD_LIBRARY",
    "SOURCE_COVERAGE",
    "SERP_VALIDATION",
    "EVIDENCE_AUDIT",
    "LISTING_HANDOFF"
  ],
  "output": {
    "language": "zh-CN",
    "workbook": true,
    "serp_validation": true
  }
}
```

## 模式与最低输入

`mode` 可为：

- `FULL_BUILD`：完整建库；
- `COMPETITOR_ACQUISITION`：只有竞品 ASIN 也可先抓身份和流量词；
- `PRODUCT_ASIN_ENRICHMENT`：从我方 ASIN 和资料补产品事实；
- `SERP_ONLY`：只做指定关键词前台复核；
- `AUDIT`：审计已有词库或工作簿。
- `INCREMENTAL_REFRESH`：承接既有项目和稳定 ID，只追加新快照并记录角色变化。

采集能力只要求站点和至少一个有效 ASIN/seed/既有工作簿。缺我方产品资料时仍可采集，但产品匹配和词库角色必须保持 `UNKNOWN/PROVISIONAL`。

## 字段规则

- `marketplace`：必填。校验器内置列表只作提示；最终按当次 Amazon/SellerSprite 工具 schema 确认，未知站点不因静态列表过旧而直接判死。
- `product.name/category`：完整决策强烈建议；只有 ASIN 时可从页面先发现，缺失不阻塞原始采集。
- `product.asin`：可选；`asin_role` 使用 `OUR_PRODUCT / COMPETITOR / UNKNOWN_ROLE`。角色不明且影响结论时才询问。
- `product.facts`：每条事实必须分开填写 `evidence_type`、`risk_class`、`research_status` 和 `publication_status`。不能用一个含混 `status` 同时表达证据和门禁。高风险正式释放还需 `claim_text`、`claim_scope`、`claim_model`；请求徽标时另填 `requested_mark` 并关联有效标志授权。
- `product.compliance_documents`：对象数组；高风险主张释放时至少记录 `document_type`、路径/来源、`coverage_level`、精确型号、签发主体、标准/编号、`issue_date`、`received_at`、`reviewed_at`、`review_status=APPROVED`、有效状态、批准措辞和标志授权。`expected_receipt_date` 只用于排期，`PENDING_NOTICE` 永远不能释放。
- `target_price`：缺失不阻塞建库，只使价格竞争背景暂定。
- `review_stage.current` 是已拥有评论；`target_min/max` 是目标窗口；`decision_basis_stage` 明确本次竞争背景与词库分层按 `CURRENT / TARGET_RANGE / BOTH` 哪个阶段判断。
- `competitors`：保留每个输入位置；查询时按规范 ASIN 去重。未给 `order_basis` 时默认 `user_provided_order`，不追问，不影响采集全部 ASIN。
- `project_id / selection_run_id / candidate_id / competitor_lock_run_id`：承接第一步和竞品锁定阶段的稳定 ID。缺失不阻止独立建库，但完整工作流必须列入交接缺口。
- 锁定竞品使用统一字段：`source_role = USER_SUPPLIED / UPSTREAM_SELECTED / RESEARCH_ADDED`；`primary_role` 与 `roles[]` 使用 `LEADER / LAUNCH_PEER / DIRECT_PRICE_FORM / NEW_ENTRANT / DIFFERENTIATED_CHALLENGER / ADJACENT_ALTERNATIVE`；`lock_status` 和 `keyword_acquisition_scope` 按竞品锁定契约填写。
- `IDENTITY_PENDING / EXCLUDED_INVALID` 不要求伪造 `primary_role` 或非空 `roles[]`，但必须使用 `NO_QUERY` 并保留身份核验依据；其余锁定状态必须有统一角色。
- 提供 `competitor_lock_run_id` 时，关键词 Skill 不重新挑选竞品。只核对身份和快照；明确冲突才允许变更角色，并必须保留 `previous_role / change_reason / evidence_ids`。
- 所有 `USER_SUPPLIED` 且身份有效的 ASIN 均应为 `FULL_TRAFFIC`；即使角色为相邻或上下文，也先完整采集，再在主库中隔离。研究新增对象按交接范围执行。
- `market_seeds`：可使用字符串简写或对象。产品品类清楚但用户未给 seed 时由技能生成，并把来源标为 `INFERRED_FROM_PRODUCT`。认证/安全/医疗等高风险 seed 只能用 `ISOLATED_RISK_RESEARCH`，不能因此进入已释放词库角色。
- `source_files`：执行者把用户附件解析为系统路径；不要求用户手写绝对路径。空路径和不可访问路径不算有效事实来源。
- `output.language` 默认跟随用户语言；`workbook` 与 `serp_validation` 在完整建库中默认 `true`。

## 可选运营上下文

用户已经明确当前价格、未来价格阶段、季节窗口、文案/素材锁定或风险处理决定时，可增加 `operating_context`。该对象只解释研究阶段并原样交给下游，不生成广告动作；缺失时保持兼容。

```yaml
operating_context:
  context_id: "stable-context-id"
  profit_objective: <optional upstream object, preserve unchanged>
  demand_calendar: <optional upstream object, preserve unchanged>
  supply_routes: <optional upstream array, preserve unchanged>
  replenishment_policy: <optional upstream object, preserve unchanged>
  price_context:
    current_observed:
      amount: <nonnegative number>
      currency: <ISO-4217 code>
      observed_at: <timezone-aware ISO-8601 timestamp>
      verification_status: OBSERVED
      evidence_ids: [<source-id>]
    planned_phases:
      - phase_id: <stable-phase-id>
        trigger:
          type: DATE|ELAPSED_SELLABLE_DAYS|PERFORMANCE_GATE|MANUAL_CONFIRMATION|OTHER
          value: <type-specific value>
        intended_price:
          amount: <nonnegative number>
          currency: <ISO-4217 code>
        verification_status: PLANNED_UNVERIFIED
        source_type: USER_CONFIRMED|SELLER_PLAN|UNKNOWN
        evidence_ids: [<decision-or-source-id>]
  current_stage:
    stage_id: <stable-stage-id>
    observed_at: <timezone-aware ISO-8601 timestamp>
    evidence_ids: [<current-state-source-id>]
  seasonality_context:
    classification: SEASONAL|EVERGREEN_WITH_PEAKS|EVERGREEN|UNKNOWN
    current_phase: PRESEASON|RAMP|PEAK|TAIL|OFFSEASON|UNKNOWN
    source_period: <observed source period>
    source_granularity: DAY|WEEK|MONTH|QUARTER|UNKNOWN
    evidence_ids: [<source-id>]
    confidence: HIGH|MEDIUM|LOW|UNKNOWN
    refresh_due_at: <optional YYYY-MM-DD>
  content_change_control:
    decision_id: <stable-decision-id>
    decided_at: <timezone-aware ISO-8601 timestamp>
    copy_state: OPEN|LOCKED|PARTIAL|UNKNOWN
    asset_state: OPEN|LOCKED|PARTIAL|UNKNOWN
    locked_scopes: [TITLE|ITEM_HIGHLIGHT|BULLETS|PRODUCT_DESCRIPTION|SEARCH_TERMS|IMAGES|A_PLUS]
    reopen_conditions: [<observable condition>]
  acknowledged_risks:
    - risk_id: <stable-risk-id>
      decision: ACKNOWLEDGED_FOR_OPERATION|NOT_ACCEPTED|REVIEW_REQUIRED
      scope: <decision scope>
      review_trigger: <observable recheck condition>
      does_not_change_evidence_or_publication_status: true
operating_context_sha256: sha256:<64 lowercase hex>
```

- `current_observed` 是有时间和证据的当前快照；`planned_phases` 始终是 `PLANNED_UNVERIFIED`。计划价格不得填入当前观察价，也不得单独释放当前阶段资格。
- 已有 `profit_objective / demand_calendar / supply_routes / replenishment_policy` 时只验证不与本技能边界冲突并原样透传；关键词 Skill 不重算利润、不制定补货或运输方案，也不另造同义字段。
- `profit_objective` 的比例分母字段统一叫 `contribution_rate_basis`，且当前共同口径只能是 `NET_SALES_REVENUE`。旧 `rate_basis` 仅兼容读取并告警，新输出不得继续写旧名。
- `demand_calendar` 是完整销售窗口及日销量情景的规划对象；`seasonality_context` 只是带来源的当前季节观察；`current_stage` 是带证据的卖家经营阶段。它们职责不同，不能互相复制，也不能把未来计划写成当前观察。若本阶段获得新观察，优先写入词库运行自己的时间戳快照或变更记录；只有上游契约明确允许的版本更新才能产生新信封哈希。
- 非 `UNKNOWN` 的季节结论必须有 `source_period / source_granularity / evidence_ids / confidence`；无可靠数据时保持 `UNKNOWN`，不依据品类名称或日历常识补造旺季。
- 内容锁定只控制“能否主动改动”，不证明当前内容合规、准确或高转化。`reopen_conditions` 是复核触发器，不等于改动授权。
- 风险确认只记录用户的运营决定。它不得包含或产生 `publication_status_override / research_status_override / claim_release / library_role_override / release_status_override`，也不得释放 `HOLD_CLAIM / CONTRADICTED / NOT_SUPPORTED`。
- `operating_context_sha256` 使用选品契约的 canonical JSON 规则。旧交接缺失时本阶段可以补算并告警；已有值不匹配时必须停止。新词库交接必须同时保留 `context_id` 和哈希。

## 事实与合规枚举

常用 `evidence_type`：`OBSERVED_PRODUCT_SOURCE / OBSERVED_COMPLIANCE_DOC / OBSERVED_AMAZON_COPY / USER_CONFIRMED / FIRST_PARTY_PERFORMANCE / ESTIMATED_THIRD_PARTY / INFERRED / UNKNOWN`。

`risk_class`：`LOW_RISK_SPEC / QUANTIFIED_PERFORMANCE / CERTIFICATION_SAFETY / MEDICAL_ENVIRONMENTAL_CHILDREN / BRAND_IP`。

`research_status`：`RESEARCH_USABLE / RESEARCH_HOLD`。

`publication_status`：`COPY_RELEASED / FORMAL_CLAIM_RELEASED / HOLD_FEATURE / CONTRADICTED / NOT_SUPPORTED / NOT_APPLICABLE`。

`NOT_APPLICABLE` 只表示某关键词不涉及该主张；认证、安全、医疗、环保、品牌/IP 或精确量化事实不得用它绕过门禁。

用户或工厂口头来源、我方 Listing、竞品文案、MSDS/SDS、普通测试报告或待件通知不能单独支持 `FORMAL_CLAIM_RELEASED`。高风险释放缺少正式文件字段时，校验器应使相应词只能进入 `HOLD_CLAIM`，但不阻断无关原始采集。

## 交付物与广告策略边界

`requested_deliverables` 只接受：`KEYWORD_LIBRARY / SOURCE_COVERAGE / SERP_VALIDATION / EVIDENCE_AUDIT / LISTING_HANDOFF`。`LISTING_HANDOFF` 按 [downstream-handoff.md](downstream-handoff.md) 输出第二步到文案阶段的数据包，不生成 Listing 成稿。

活动结构、匹配方式、关键词投放、竞价、预算、ACoS、止损、放量和广告否定规则不属于本技能。若输入仍带有旧字段 `MATCH_TYPE_GUIDANCE / EXACT_BID / EXACT_DAILY_BUDGET / STOP_LOSS / economics / output.exact_bid_budget`，校验器应明确提示“广告策略请求已忽略”，继续运行词库任务，且不得生成相关计算或建议。`$build-amazon-advertising-strategy` 可读取本词库的原词、词族、来源、产品匹配、需求证据、SERP、竞争背景、门禁和 `downstream_review_eligible`，自行作广告决策。

## 校验与能力结果

运行：

```bash
python3 <skill-directory>/scripts/validate_inputs.py <input.json>
```

输出使用：

- `structurally_valid`：结构与明显冲突是否通过；不代表事实或认证真实；
- `capabilities.runnable_for_acquisition`：是否能开始采集；
- `capabilities.runnable_for_keyword_classification`：是否有足够我方事实给出产品匹配与词库角色；
- `capabilities.released_roles_available`：是否至少有一项事实可支持已释放的中立词库角色；
- `capabilities.released_roles_partially_restricted` 与 `restricted_claims`：是否只有部分高风险修饰词被冻结，不能因此误冻无关类目词；
- `errors / high_priority_warnings / warnings / missing_for_capabilities`。

校验器只做结构和显见门禁检查，不替代人工核对证书范围、Amazon 页面、市场数据和最终研究判断，也不生成广告策略。
