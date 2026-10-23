# 证据、缺失值与发布门禁

本参考用于阻止四类常见错误：把第三方估算当事实、把前台相关性当流量、把用户口头功能当认证证据、把缺失值当成 0。

## 1. 证据类型

每个会影响词库分类的事实或指标都分配稳定的 `evidence_id`，并记录来源、对象、站点、变体、采集日期和口径。

| 代码 | 含义 | 可支持什么 | 不能单独支持什么 |
|---|---|---|---|
| `OBSERVED_PRODUCT_SOURCE` | 当前量产规格、说明书、BOM、样品或可追溯实测中直接可见 | 精确对象和范围内的普通产品事实 | 法定认证、标志授权或文件范围外的主张 |
| `OBSERVED_COMPLIANCE_DOC` | 合规文件原文及其元数据 | 仅支持该文档类型、型号、部件层级、标准和措辞范围 | 自动升级为整机 certified/listed/approved |
| `OBSERVED_AMAZON_COPY` | 我方或竞品 Amazon 页面当前写出的文案 | 证明页面曾出现该表达 | 主张真实、测试完成或认证有效 |
| `USER_CONFIRMED` | 用户最新明确确认的当前量产功能或运营输入 | 工作版本的产品事实、价格、阶段目标 | 法定认证、测试范围、商标授权或高风险绝对化主张 |
| `OBSERVED_SERP` | 指定站点、时间和查询下的 Amazon 搜索结果 | 当前相关性、污染、价格/评论竞争、结果形态 | 搜索量、未来表现、稳定排名或全市场份额 |
| `ESTIMATED_THIRD_PARTY` | SellerSprite 等第三方工具的估算 | 搜索、购买、流量、竞价和竞争的方向性证据 | Amazon 官方精确值、我方第一方表现或未来结果 |
| `FIRST_PARTY_PERFORMANCE` | 用户自己的 Search Term、广告、订单或 Brand Analytics 数据 | 对应账户、时间和口径的真实表现 | 未覆盖时段、未投词或其他 ASIN 的表现 |
| `INFERRED` | 从产品事实、词根或多项证据推导 | 候选词、分层判断和下一步验证 | 需求规模、产品事实或认证事实 |
| `UNKNOWN` | 尚未取得、范围不清或冲突未解 | 形成待办和门禁 | 任何肯定结论 |

动态数据必须带时间快照。父体与子体、单只与套装、标价与 Coupon 后价格、市场与竞品指标不得混用。

### 合规文档必须细分

`OBSERVED_COMPLIANCE_DOC` 不能单独决定可用措辞，必须记录 `document_type`、`coverage_level`、型号、签发主体、标准/编号、日期、有效状态、允许措辞和标志授权：

| `document_type` | 最多可支持 | 永远不能自动支持 |
|---|---|---|
| `MSDS_SDS` | `SDS available` 及覆盖对象的化学/运输信息 | passed、certified、approved、safe、整机认证 |
| `TEST_REPORT` | 精确范围内的 `tested to` 或报告中的具体测试结果 | certified、listed、approved、标志使用 |
| `SDOC_DOC` | 法定要素和适用范围闭环后的 `complies with` | certified、listed、标志授权 |
| `CERTIFICATE_LISTING` | 证书原文允许的 certified/listed 措辞 | 范围外型号、部件升级整机、标志使用 |
| `MARK_AUTHORIZATION` | 精确标志和范围的使用资格 | 未授权的其他标志或认证措辞 |
| `PENDING_NOTICE` | 内部待办和隔离需求研究 | 任何当前公开主张或已释放词库角色 |
| `OWN_LISTING` / `COMPETITOR_COPY` | 证明页面出现了该文案 | 主张真实或合规有效 |

`coverage_level` 至少区分 `whole_unit / battery_pack / cell / component / accessory`。高风险事实的 `claim_text / claim_scope / claim_model` 必须与文件批准措辞、覆盖层级和型号一致；部件、电芯或附件文件不得释放整机词。正式释放要求 `issue_date` 不在未来、文件已收件、已审查且 `review_status=APPROVED`；`expected_receipt_date` 只用于排期，日期到达不会自动把 `PENDING` 改为已释放。

## 2. 缺失值状态

空白不是 0。统一使用：

- `MISSING`：数据源未提供该字段；
- `NO_ROWS`：查询成功但该对象在所用条件下无返回行；
- `FETCH_FAILED`：调用、登录、验证码、权限或解析失败；
- `NOT_APPLICABLE`：该字段对对象不适用；
- `ZERO_OBSERVED`：数据源明确返回数值 0；
- `CONFLICT`：多个来源给出不兼容值；
- `STALE`：值存在但时间过旧，不宜用于当前分类。

主库中的数值列保持数值或真正空值；另设 `metric_status` 或逐字段状态列解释缺失。不要为方便公式把未知填成 0。

## 3. 产品事实冲突规则

按事实类型处理冲突，不使用一个笼统优先级：

1. **当前功能与操作**：用户最新明确确认可修正旧说明书；保留旧值与冲突记录，发布前要求同步资料。
2. **量化性能**：优先使用与当前量产变体匹配、方法清楚、日期可追溯的测试；用户确认可作为工作事实，但在前台量化主张前保留验证门禁。
3. **认证、安全、医疗、环保、儿童和法定合规**：必须核对正式文件、适用型号/部件、签发主体、标准、日期和标志使用范围。用户或工厂口头确认不能升级为正式认证。
4. **Amazon 当前价格、评论、库存和页面文案**：当前页面是时间快照；第三方值仅作交叉验证，冲突时并列展示。
5. **竞品功能**：竞品页面只能证明竞品自己的陈述，不能推导为我方事实。

遇到冲突时建立 `conflict_id`，列出各来源、影响的关键词、当前采用值和释放条件；不得静默选一个值。

## 4. 产品主张门禁

每个事实或主张必须同时填写三个独立维度，不能用一个 `status` 混在一起：

1. `evidence_type`：证据从哪里来；
2. `risk_class`：`LOW_RISK_SPEC / QUANTIFIED_PERFORMANCE / CERTIFICATION_SAFETY / MEDICAL_ENVIRONMENTAL_CHILDREN / BRAND_IP`；
3. 研究与发布资格。

### 研究资格

| `research_status` | 含义 |
|---|---|
| `RESEARCH_USABLE` | 可以查询需求、竞品和 SERP；不代表可进入已释放词库角色或写入 Listing |
| `RESEARCH_HOLD` | 连内部匹配也因身份、冲突或范围不明而应暂停 |

用户最新确认的双只、形态、接口、普通显示等低风险当前量产规格可设 `RESEARCH_USABLE`，不为内部研究反复追问。高风险或待件主张也可隔离研究需求，但必须保留发布冻结。

### 发布资格

| `publication_status` | 含义 | 词库角色边界 |
|---|---|---|
| `COPY_RELEASED` | 低风险客观规格已核对，可按批准措辞用于公开内容研究 | 仍需需求、相关性与竞争验证 |
| `FORMAL_CLAIM_RELEASED` | 高风险文件、范围和批准措辞已完整审查 | 仅按 `approved_claim_text/scope` 使用 |
| `HOLD_FEATURE` | 待件、仅口头、证据不足或高风险审查未完成 | 只能隔离研究；词库角色必须为 `HOLD_CLAIM` |
| `CONTRADICTED` | 来源冲突可能改变真实性或范围 | 冻结，先解冲突 |
| `NOT_SUPPORTED` | 当前产品不具备 | 词库角色为 `UNSUPPORTED` |
| `NOT_APPLICABLE` | 词不涉及需发布的产品主张 | 继续走产品匹配与需求判断 |

`NOT_APPLICABLE` 只用于某个关键词不涉及该主张，不能填在一个实际高风险事实上绕过门禁；如事实名为 UL/FCC/安全/医疗/精确性能，其发布状态必须按证据写 `FORMAL_CLAIM_RELEASED / HOLD_FEATURE / CONTRADICTED / NOT_SUPPORTED`。

已释放词库角色集合定义为 `RELEASED_LIBRARY_ROLES = CORE_VERIFIED, SECONDARY_VERIFIED, LATER_STAGE_RELEVANT, INDEXING_CANDIDATE`。这些角色都要求该原词涉及的全部主张为 `COPY_RELEASED`、`FORMAL_CLAIM_RELEASED` 或真正不涉及主张的 `NOT_APPLICABLE`。`HOLD_FEATURE / CONTRADICTED` 不能用阶段标签绕过；当前角色必须保留为 `HOLD_CLAIM`。

以下主张永远不能走“用户允许的低风险例外”：认证、法定合规、安全、医疗、环保、儿童、食品接触、`certified/listed/approved/compliant/safe`、绝对化/最高级，以及精确温度、速度、续航、功率、承重、效率等量化性能。

工作簿同时保留 `research_eligible`、`listing_indexing_eligible`、`front_end_copy_eligible`、`logo_mark_eligible`、`downstream_review_eligible`、`approved_claim_text` 和 `approved_claim_scope`，避免把“可研究”误读为“可公开使用”。

### 精确量化性能的释放字段

量化性能除普通来源字段外，还需当前量产型号、BOM版本、固件版本或显式不适用、测试方法、测量起止定义、正整数样本数、环境、档位、测量误差、`TYPICAL/MAXIMUM/GUARANTEED` 值属性、报告日期、批准日期和批准人；日期使用 ISO 且不得在未来。字段不全时可研究需求，但保持 `HOLD_FEATURE`。

### 词族不得覆盖原词门禁

认证、安全、医疗、环保和量化修饰词建立独立 `claim_modifier_id`。原词的发布状态取全部修饰词中最严格值；`certified example device` 不得继承基础词 `example device` 的已释放角色。词族可以汇总需求，词库角色必须保留到原词层。

“真实支持”“可研究”“可公开使用”与“有市场需求”分别填写，不可合并成一个 `yes/no`。

## 5. 需求、相关性与竞争是三种证据

- **需求证据**回答“是否有人搜/买/从此词获得流量”。优先第一方数据，其次 SellerSprite/ABA 等估算。
- **相关性证据**回答“搜索这个词时 Amazon 主要展示什么，是否与我方形态和意图一致”。来自 SERP。
- **竞争证据**回答“我方当前价格、评论、Offer 和内容处于怎样的市场背景”。来自首页与深页竞争结构。

在原词全部主张已发布就绪或不适用的前提下，高相关但没有需求证据的词进入 `RELEVANT_NEEDS_VALIDATION` 或 `INDEXING_CANDIDATE`，不能写成高流量词。门禁未释放时仍只能进入 `HOLD_CLAIM`。竞品自然/广告排名存在但搜索量或流量估算为空时，只能说明“该竞品曾被该查询关联”，不能直接证明需求规模。

## 6. 推导与结论写法

每个词库分类行至少关联：

- 一个产品事实或主张门禁 ID；
- 一个需求、竞品或前台证据 ID；
- 一个分析判断 ID；
- 一条下一步补采或释放条件。

结论使用以下语气：

- `数据直接显示……`：仅用于对应数据源明确给出的值；
- `前台观察显示……`：仅用于指定时间快照；
- `据此推断……`：明确是分析判断；
- `尚不能判断……`：关键证据缺失或冲突。

## 7. 禁止的快捷推理

- 不把 SellerSprite 的购买率直接当成我方第一方表现。
- 不把竞品出现某词直接当成我方核心词依据。
- 不把前台结果多或高度相关直接当成高搜索量。
- 不把评论总量中位数直接当成首页竞争门槛。
- 不把价格均值用于未归一化的单只、双只、不同容量或不同附件套装。
- 不输出或补造广告预算、竞价、ACoS、止损、匹配方式或活动结构。
- 不把品牌词混入普通通用词库，也不忽略商标/IP 风险。
