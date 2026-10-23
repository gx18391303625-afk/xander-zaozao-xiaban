# 关键词证据与词库角色模型

本模型只负责把关键词研究结果变成可追溯的词库角色，不输出广告活动、匹配方式、竞价、预算、ACoS、止损或放量方案。判断顺序固定为：

`产品与主张门禁 → 需求证据 → Amazon 前台相关性 → 竞争背景 → 词库角色`

## 1. 词意图标签

每个词可有一个主意图和多个副标签：

- `CATEGORY_CORE`：品类核心；
- `FORM_FACTOR`：形态、数量、尺寸、材质；
- `FEATURE`：功能、接口、性能、兼容性；
- `USE_CASE`：场景、季节、活动；
- `AUDIENCE`：人群、职业、年龄或礼赠；
- `PROBLEM_SOLUTION`：痛点与结果；
- `BRAND_MODEL`：品牌、竞品或型号；
- `ACCESSORY`：配件或替换件；
- `ALTERNATIVE_FORM`：邻近但不同产品形态；
- `INCOMPATIBLE`：规格、数量、功能或使用方式不匹配；
- `POLICY_RISK`：医疗、安全、认证、环保或绝对化主张风险；
- `IRRELEVANT`：非目标需求。

不要只依赖词面判断。最终意图结合产品事实、SellerSprite 关联 ASIN 和 Amazon SERP。

## 2. 产品匹配与门禁

先判断产品匹配：

- `DIRECT_FIT`：产品与查询核心意图一致；
- `CONDITIONAL_FIT`：需特定变体、套装、场景或批准措辞；
- `WEAK_FIT`：相关但不是主要购买意图；
- `NO_FIT`：产品不满足；
- `UNKNOWN_FIT`：事实不足。

再叠加主张门禁。高搜索量不能覆盖 `NO_FIT / NOT_SUPPORTED / CONTRADICTED` 或未释放的高风险主张。涉及未释放主张的原词进入 `HOLD_CLAIM`，不能继承基础词的核心角色。

## 3. 需求证据层

不使用固定搜索量阈值跨品类硬套。按证据质量记录：

- `D1_FIRST_PARTY`：用户账户、Search Term、SQP、Brand Analytics 或订单数据有可追溯表现；
- `D2_MARKET_ESTIMATE`：SellerSprite 等第三方市场词有搜索、购买或趋势估算；
- `D3_COMPETITOR_TRAFFIC`：一个或多个竞品获得自然、广告或推荐关联；
- `D4_SERP_ONLY`：前台高度相关，但没有独立需求数据；
- `D5_INFERRED_ONLY`：仅由产品事实或词根生成；
- `D0_NONE`：无证据或数据失败。

同一个词可以同时具有多个层级。记录月份、时间窗、样本数和源 ASIN 角色。第一方表现只说明该账户在对应时间和投放条件下观察到的结果，不自动代表全市场需求。

## 4. SERP 相关性层

按 [serp-validation.md](serp-validation.md) 保存页面观察，再给出：

- `HIGH_PURITY`：结果主要是我方同类、同形态、同核心购买意图；
- `MIXED_BUT_USABLE`：存在明显污染，但目标商品仍占可解释比例；
- `LOW_PURITY`：替代品、不同形态或错误意图占主导；
- `UNVERIFIED`：未检查或检查不足。

首页和全扫描深度分别评级。首页高纯度但深页混杂，说明 Amazon 对核心意图理解清楚但长尾供给复杂；深页高相关不能抵消首页低相关。

## 5. 竞争背景

先按可比套装和实际到手价归一化，再记录：

- 我方价格相对首页中位数和四分位区间；
- 我方当前评论数、目标评论窗口相对首页与全扫描分布；
- 星级、近期评论速度、品牌强度、Sponsored 密度和配送；
- `LAUNCH_PEER` 的出现位置与数量；
- 核心差异能否在搜索卡片和 Offer 中被理解；
- 单数/复数、数量和容量是否造成价格误读。

输出 `CURRENTLY_COMPARABLE / CHALLENGING / LATER_STAGE / NOT_COMPARABLE / UNKNOWN`。这些只是市场背景，不是投放建议。不要仅凭深页低评论中位数推导容易进入首页，也不要擅自设定固定价格带或评论门槛。

## 6. 词库角色

每个原词只给一个当前 `library_role`：

| 角色 | 最低含义 | 不能由此直接推导 |
|---|---|---|
| `CORE_VERIFIED` | `DIRECT_FIT`，主张已释放或不适用，有 D1/D2/D3 独立需求证据，SERP 高纯度或可解释 | 必须投放、必胜、具体匹配方式或预算 |
| `SECONDARY_VERIFIED` | 产品真实相关且有证据，但需求更窄、角色次要或市场背景更复杂 | 低价投放、低预算或固定优先级 |
| `RELEVANT_NEEDS_VALIDATION` | 产品相关，但需求、SERP、身份、月份或来源证据仍不完整 | 有流量、应投放或应写入 Listing |
| `LATER_STAGE_RELEVANT` | 产品相关，但当前与目标价格、评论、Offer 或内容阶段差距明显 | 到某一固定评论数即可投放 |
| `INDEXING_CANDIDATE` | 有收录研究价值且主张已释放；交给 Listing Skill 复核实际放置 | 自动写入标题、五点或后台 Search Terms |
| `MARKET_CONTEXT` | 用于理解类目边界、污染、替代品或市场语言 | 我方正向关键词 |
| `BRAND_IP_ISOLATED` | 品牌、竞品或型号词，隔离保存并标知识产权边界 | 竞品投放许可或商标使用许可 |
| `HOLD_CLAIM` | 词涉及未释放功能、量化性能、认证或其他高风险主张 | 可公开使用或交给下游直接执行 |
| `WRONG_INTENT` | 核心购买意图、产品形态、套装或兼容关系不符 | 自动生成广告否定词 |
| `UNSUPPORTED` | 产品明确不支持、侵权或会造成严重误导 | 任何正向用途 |

每行另列：

- `role_reason`；
- `next_research_step`；
- `missing_evidence`；
- `release_gate`；
- `downstream_review_eligible`；
- `evidence_ids`。

词库角色是研究结论，不是广告或 Listing 执行动作。

## 7. 阶段背景

阶段由用户自己的运营输入定义，不使用固定的评论模板硬套。必须分开：

- `CURRENT_STAGE`：当前价、当前评论、现有内容和已释放功能；
- `TARGET_STAGE`：用户明确给出的目标价、目标评论窗口和目标 Offer；
- `SEASONAL_CONTEXT`：季节变化、需求提前量和库存背景；
- `UNKNOWN_STAGE`：关键运营输入缺失。

当前 0 评论与目标 100–300 评论不能混成同一事实。阶段只帮助解释竞争背景和词库角色，不输出何时加预算或如何放量。

`LATER_STAGE_RELEVANT` 默认 `current_stage_eligible=false`。只有新的当前状态快照实际满足原释放条件时才可改为 `true`，并在关键词行保留：

```text
stage_eligibility_basis.stage_id
stage_eligibility_basis.evaluated_at
stage_eligibility_basis.basis_type = CURRENT_OBSERVED_STAGE
stage_eligibility_basis.evidence_ids
stage_eligibility_basis.operating_context_id
```

`evidence_ids` 必须指向当前观察状态，而不是未来计划、目标价、预计评论、预计 Offer 或用户希望达到的阶段。阶段资格只允许 Listing 和后续广告 Skill 重新复核该词，不把词库角色改写成广告许可。

## 8. 直接竞品与头部的不同用途

- `LAUNCH_PEER`：观察当前同阶段语言、价格和评论背景；
- `DIRECT_PRICE_FORM`：判断同用途、同形态、同套装和同价位的直接购买语言；
- `LEADER`：界定类目大词和长期市场边界；
- `NEW_ENTRANT`：观察新链接当前能获得的词与阶段信号；
- `DIFFERENTIATED_CHALLENGER`：发现差异化定位和替代语言；
- `ADJACENT_ALTERNATIVE`：识别污染、替代意图和错误形态。

不因头部难打而省略其数据，也不因头部流量大就把其全部词列为我方核心词。

锁定状态决定研究职责而不是词库结论：`CORE_BENCHMARK / BOUNDARY_REFERENCE / DIFFERENTIATION_REFERENCE / KEYWORD_SOURCE_ONLY` 可以提供完整竞品需求证据；`CONTEXT_ONLY` 默认只提供市场背景。用户指定且身份有效的 ASIN 即使为上下文角色，也保留完整原始采集，主库再逐词判断。

## 9. 单复数、词序与错拼

Amazon 可能把近似变体合并匹配，但第三方数据和前台结果仍可能不同：

- 主库保留每个原词；
- 通过 `keyword_family_id` 汇总研究；
- 原词指标不得擅自相加；
- 错拼只有在有独立证据时才获得独立角色；
- 单数、复数、数量词和容量词必须结合 SERP 与我方 Offer 判断。

## 10. 隔离与排除

- 品牌、竞品和型号词进入 `BRAND_IP_ISOLATED`；
- 未释放主张进入 `HOLD_CLAIM`；
- 相关但证据不足进入 `RELEVANT_NEEDS_VALIDATION`；
- 错误产品形态或购买意图进入 `WRONG_INTENT`；
- 产品明确不支持或存在严重风险进入 `UNSUPPORTED`。

不要在本技能中把这些角色转成 Exact/Phrase 否定、竞品投放、活动结构或账户级规则。

## 11. 下游交接边界

词库可向 `$build-amazon-advertising-strategy` 提供：

- 原词与词族；
- 产品匹配；
- 需求证据等级；
- SellerSprite 原始市场指标；
- 竞品自然/广告关联；
- SERP 纯度和竞争背景；
- 品牌/IP、错误意图和主张门禁；
- 第一方表现及其时间/归因口径；
- 证据缺口和快照日期。

广告策略 Skill 自己决定活动、匹配方式、竞价、预算、ACoS、止损、放量和否定规则。本技能不得提前生成这些内容，也不得把 SellerSprite 购买率当作我方 CVR。
