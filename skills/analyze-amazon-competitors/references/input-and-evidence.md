# 输入与证据规范

## 目录

- 输入契约
- 工作档位
- 运行模式与就绪状态
- 证据层级
- 证据账本
- 变体、时间与冲突规则
- 评论与问答抽样
- 流量入口观察与交接

## 输入契约

最低输入：

```yaml
marketplace: US
gear: fast             # fast / deep；省略时默认 fast
asins:
  - asin: B0XXXXXXXX
    input_role: primary # primary / benchmark / price-peer，可省略
objective: image_strategy
```

对标锁定模式优先接受第一步交接字段：

```yaml
project_id: project-stable-id
selection_run_id: selection-run-id
candidate_id: CAND-001
objective: benchmark_lock
marketplace: US
market_seeds: []
asins: []
target_product: {}
```

上游已经存在的产品事实、风险门禁、ASIN 原始顺序、`evidence_id` 和 `market_seed_id` 必须原样保留。发现冲突时增加本阶段证据与变化记录，不覆盖上游值。

上游存在经营和履约上下文时，将顶层 `operating_context` 信封原样透传：

```yaml
operating_context:
  context_id: operating-context-stable-id
  profit_objective: {}
  price_context: {}
  demand_calendar: {}
  supply_routes: []
  replenishment_policy: {}
  content_change_control: null
  acknowledged_risks: []
operating_context_sha256: sha256:<64 lowercase hex>
competitor_context_updates: []
```

本 Skill 不校正、补算或评分信封成员。竞品阶段观察到的价格、可售状态、配送或需求阶段变化写入 `competitor_context_updates[]`，携带时间和证据 ID；不得覆盖上游利润底线、价格阶段、生产交期、路线成本、库存口径、补货规则、内容控制或已知风险。

若旧交接缺少 `operating_context_sha256`，可按选品共同契约补算；若已经提供则必须匹配，否则停止交接。新输出始终携带哈希。

推荐补充：

```yaml
target_product:
  asin: null
  verified_facts: []
  planned_features: []
  dimensions: null
  materials: null
  included_items: null
  certifications: []
  allowed_claims: []
  forbidden_claims: []
  target_price: null
  target_ratings_count_range: null
  target_star_rating_range: null
  brand_positioning: null
constraints:
  audience: null
  price_band: null
  image_count: null
  launch_timing: null
  available_assets: []
  product_or_cost_limits: []
```

把 `planned_features` 视为计划，不视为已证实事实。若用户提供我方 ASIN，仍要确认当前分析的是哪一个子体和套装。

`input_role` 兼容旧输入，只记录用户为何提供该 ASIN。新输出统一使用 `source_role = USER_SUPPLIED / UPSTREAM_SELECTED / RESEARCH_ADDED`，并为每个 ASIN 填 `primary_role` 和 `roles[]`：

- `LEADER`；
- `LAUNCH_PEER`；
- `DIRECT_PRICE_FORM`；
- `NEW_ENTRANT`；
- `DIFFERENTIATED_CHALLENGER`；
- `ADJACENT_ALTERNATIVE`。

兼容旧输入字段 `role / input_role / battlefield_role`：`ANCHOR` 只转成来源角色 `USER_SUPPLIED`，再按证据确定市场角色；`DIRECT → DIRECT_PRICE_FORM`，`CHALLENGER → DIFFERENTIATED_CHALLENGER`，`SUBSTITUTE → ADJACENT_ALTERNATIVE`。报告不得同时混用新旧枚举。

## 工作档位

档位与运行模式是两件事：档位决定深度，运行模式决定任务类型。

### 极速实战档 `fast`

- 默认档位，服务于快速确定打法和进入做图。
- 把用户最新明确确认的我方事实、文件中明确描述为当前量产产品的事实，以及用户指定为有效的我方链接文案记为 `OBSERVED / USER-CONFIRMED`。计划功能、概念图和未来版本仍建立 `V-ID`。
- 我方旧链接存在未维护字段时，以用户最新纠正为当前工作值，并把旧字段记作待更新；不要要求用户反复证明已确认事实。
- 只为影响主打法、核心优劣势和图片任务的事实建立最小证据账本。
- 对高风险主张保留“发布前核验”，但除非存在硬红线，不阻断策略与设计简报。
- 竞品研究深度使用 [SKILL.md 的竞品研究分层规则](../SKILL.md#竞品研究分层)：保留全部 ASIN 原序；只有明确排名或优先级顺序才按位置分层，普通列表按相关性、角色和证据缺口分层。

### 深度尽调档 `deep`

- 用于正式立项、可审计报告、发布级比较、认证范围核查或高成本产品决策。
- 完整建立证据账本，核对多数据源、变体、VOC、关键词、流量与动态快照。
- 用户确认事实仍可使用，但高风险发布主张需进一步映射证书、测试或原始文件。
- 对所有用户指定竞品保留可追溯结果，核心叙事可另选重点组。

## 运行模式与就绪状态

### 对标竞品锁定模式

使用第一步商品池、seed、锚点 ASIN 或用户列表建立候选池，完成身份/变体核对、可比性评分、角色与锁定状态，输出 `competitor_lock.json`。该模式可以只做必要的 Offer、市场表现和流量结构摘要，不强制图库、VOC、突破口和视觉交接。

### 锚点竞品模式

只有站点与竞品 ASIN 即可运行。允许输出：

- 竞品事实、市场角色、内容打法与护城河；
- VOC 主题与买家异议；
- 条件式机会和我方产品需求；
- 需要补拍、实测或索取的证据。

不得输出：未经证实的我方优势、可直接发布的比较主张或确定性胜率。

### 我方对标模式

至少有一组可追溯的我方产品事实后运行。只有映射到我方证据的维度才能判为优势或劣势；其余标为 `UNKNOWN`。

在极速实战档中，用户直接确认的产品事实本身即可作为可追溯的我方证据，不要求第二来源。若用户明确表示链接中的部分参数尚未维护，不能再用这些旧字段推翻其最新确认。

### 就绪状态

每份报告只给一个整体状态，不同时写“研究状态”和“发布状态”。单个主张或图片可以另行标记 `READY / [待验证] / BLOCKED`。使用以下唯一矩阵：

- `READY`：现有证据足以完成用户要求的核心交付。极速实战档中，证书标志、准确措辞等不影响设计方向的发布前核验不会单独导致降级。
- `PROVISIONAL`：策略或研究可交付，但任一用户要求的核心发布项尚未就绪；把相应项目标为 `[待验证]` 或 `BLOCKED`。直接发布任务尚未核验当前 Amazon 规则时，也使用该状态。
- `BLOCKED`：站点/ASIN身份无法确认，或硬红线使全部核心交付无法成立。若仍能完成其他核心部分，整体不得设为 `BLOCKED`。

只有竞品 ASIN 不等于 `BLOCKED`；应交付 `PROVISIONAL` 的机会与验证简报。

## 证据层级

使用以下类型，不把来源强弱压成一个模糊“可信度”：

| 类型 | 内容 | 允许用途 | 主要限制 |
|---|---|---|---|
| `OBSERVED` | Amazon 当前页面、图库、A+、视频、规格、品牌资料、用户确认的我方事实 | 描述当前可见事实 | 页面未写不等于产品没有 |
| `VOC` | 评论、Q&A、买家上传图片/视频 | 识别问题、场景、语言和异议 | 抽样不是总体频率；注意变体共享评论 |
| `ESTIMATED` | 卖家精灵或其他第三方销量、收入、关键词、趋势、利润估算 | 比较量级、方向和相对变化 | 必须写估算、日期与口径 |
| `INFERRED` | 受众、定位、意图、机会与策略推断 | 形成解释和假设 | 必须列出依据与置信度 |
| `UNKNOWN` | 缺失、冲突或无法归属的数据 | 暴露风险和验证任务 | 不得静默填补 |

报告中的证据置信度显示为 `高 / 中 / 低 / 未知`。评分脚本字段 `evidence_confidence` 同时接受中文值和 `high / medium / low / unknown`，并统一规范化：

- 高：至少两个独立且一致的信号，其中一个为直接事实或强 VOC。
- 中：一个直接信号，或多个一致的间接信号。
- 低：主要来自第三方估算、少量样本或分析推断。
- 未知：缺少足够信息判断强度。

## 证据账本

为每条关键证据分配 `E01`、`E02` 等稳定 ID：

| 字段 | 要求 |
|---|---|
| Evidence ID | 报告内唯一且不重排 |
| Source | Amazon 页面、评论、Q&A、SellerSprite、用户资料等 |
| Marketplace | 明确站点，不只写 Amazon |
| ASIN / Variant | 父体、子体和选中变体；无法确定时写 unknown |
| Captured at | 含日期，动态数据需要时间 |
| Raw fact | 保留单位、币种、样本量和原始范围 |
| Type | OBSERVED / VOC / ESTIMATED / INFERRED / UNKNOWN |
| Confidence | 高 / 中 / 低 / 未知；评分脚本可使用对应英文值 |
| Used for | 对应矩阵、机会或图片 ID |

引用评论时优先摘要，不大段复制原文。保留星级、日期、变体和使用场景；只有需要精确措辞时使用极短引用。

极速实战档允许把账本压缩到只覆盖最终机会、我方优劣势和图片任务；深度尽调档使用完整字段，不省略关键动态数据和冲突。

为待验证事实分配 `V01`、`V02` 等稳定 ID：

| 字段 | 要求 |
|---|---|
| Validation ID | 报告内唯一且不重排 |
| Required fact | 要确认的我方事实或发布条件 |
| Method | 实测、证书核对、样品确认、政策核验或用户确认 |
| Pass criteria | 满足什么条件可升级为证据 |
| Owner / output | 负责人和应交付的文件、照片、数据或结论 |
| Unlocks | 对应的 `O-ID`、`I-ID` 或主张 |

## 变体、时间与冲突规则

- 分开父 ASIN 的聚合表现与子 ASIN 的具体产品事实。
- 变体共享评论时，不把评论问题归因到当前子体，除非评论明确标注该变体。
- 比较数量、容量、尺寸和价格时统一成可比单位，同时保留原值。
- 把价格、Coupon、配送、库存、BSR、评论数和页面内容视为时间快照。
- 动态 Offer/配送快照记录 `demand_phase_at_capture`；不同需求阶段的价格、排名、销量估算或可售状态不得无说明直接比较。
- 页面可见断货、到货日期或配送延迟不等于竞品内部库存数量、生产周期、运输路线或补货能力；这些内部字段保持 `UNKNOWN`。
- 发现 Amazon 页面与第三方工具冲突时，以直接页面事实描述当前状态，同时保留估算差异。
- 发现用户资料内部冲突时，不自行选“更好”的值；标为 `UNKNOWN` 并写入补证清单。
- 我方旧链接字段与用户最新明确纠正冲突时，使用最新纠正值，并把旧链接字段记为待更新；这不属于需要反复追问的 `UNKNOWN`。
- 页面没有提及某功能，只能得出“页面未证明”，不能得出“产品没有”。

## 评论与问答抽样

按可用性进行分层，而不是只看“Top reviews”：

1. 最近 1–3 星评论：发现当前问题和退货触发。
2. 最近 4–5 星评论：识别真正被购买和复购的价值。
3. 高帮助度评论：识别长期稳定问题，但注意陈旧性。
4. 不同变体、用途和人群：避免把单一场景泛化。
5. Q&A：识别购买前信息缺口、兼容性、尺寸和使用门槛。

记录每个 ASIN 的可见样本量与时间范围。只有跨多个独立评论反复出现时，才称为“重复主题”；即使重复，也不得把抽样占比当成市场发生率。

## 流量入口观察与交接

这是竞品研究的窄范围证据模块，不是广告优化方案。每条观察沿用证据账本，并补充：

- 搜索页：原查询/纠错词、页面或加载批次、模块与卡片顺序、自然/广告/未知分类、我方与邻居 ASIN 的实际关系；相邻或同屏必须来自同次页面证据。
- 详情页：宿主 URL、选中子 ASIN、展示商品 ASIN、模块原名、Sponsored 标识依据与模块内位置。区分“竞品在我方页”和“我方在竞品页”；只有后台 target/matched ID 时单列为报告上下文，不冒充前台观察。
- 两类页面都保留采样时间/时区、地区/邮编、登录/会话与设备、实际覆盖、原始页面或截图定位。无法确认的字段保留未知；同次观察与后补详情核验分开。
- 只补能改变比较的变体/套装、标价、优惠适用条件、星级、评分数、配送与核心表达。卡片价、之后取得的详情页价和第三方估价分别保留；不把 Prime 限定价当普遍到手价。

有竞品卡片不等于付费广告；品牌内容、A+ 比较表和自然推荐保留各自性质。广告出现只证明当时可见，不证明对方特意定向我方 ASIN，也不能算出抢走了多少点击、订单或销售。缺少广告标识/宿主身份时降低该项结论，不补造。

不要点击 Sponsored 链接做验证；如需普通详情资料，从已确认 ASIN 的普通商品链接进入。遇到阻断沿用一次聚焦获取和一次合理替代的停止边界。

交接给广告策略技能时给出原证据 ID、范围与时间、可比 Offer 差距、推断和缺口，不把同屏对象自动升级成核心对标、监控对象或已批准广告目标。没有跨技能调用能力时仍可直接交付这些证据；不假称其他模块已完成复核。
