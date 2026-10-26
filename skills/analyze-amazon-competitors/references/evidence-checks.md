# 竞品证据记录检查

本文件集中维护评论归属、报价及事件时间线的检查入口，其他参考只引用，不另起一套门槛。它检查输入记录的一致性，不抓取网页、不读取凭据、不写账户、不验证引用内容真实，也不替代人工看图、读原评或研究完成判断。

## 按本次任务运行

在引用原评主题、比较报价或据时间线作判断前，只整理本次需要的部分：`voc`、`offers`、`timeline`。不相关部分直接省略；已尝试但未取得的部分保留缺失状态。不要为了让检查通过补造数据，或删掉不利的评论/报价/事件。

有代码执行能力时，把结构化证据保存为 JSON，再使用当前已安装技能的**绝对路径**运行：

```sh
python3 /absolute/plugin/skills/analyze-amazon-competitors/scripts/validate_competitor_evidence.py --input /absolute/work/evidence.json --output /absolute/work/evidence-check.json
```

顶层格式为 `{"schema_version":1,"voc":{...},"offers":{...},"timeline":{...}}`，至少提供一项。未知数用 `null`。重复 JSON 字段、未知字段、非有限数值会拒绝，避免后值覆盖前值或拼错检查项被忽略；只有时间线 `values` 是开放的指标映射。下面的字段样例和 `scripts/fixtures/evidence_*.json` 只作格式/回归参考，真实任务必须绑定自己的来源。

没有执行能力时按相同字段人工检查，并说明没有运行程序。不要声称校验器已运行。

## 如何使用结果

退出码 `0 / 1 / 2` 分别对应 `PASS / INCOMPLETE / INVALID`，白话沿用[状态对照](../../xander-operations/references/status-glossary.md)。

- `PASS` 只代表所提供记录一致；未提供的部分列在 `not_checked_sections`，不当作已检查。来源真实性、覆盖完整性及因果始终未由程序证明。
- `INCOMPLETE` 保留已取得记录和明确缺口。只限制依赖缺失项的结论，不阻断无关报价、视觉或其他分析。
- `INVALID` 的受影响记录不能作为已验证依据进入机会评分或交接；先修正，或保留冲突并将依赖结论标为待验证。不得只删掉报错记录使报告变成“通过”。

整体报告仍使用技能已有 `READY / PROVISIONAL / BLOCKED`，不把检查状态自动转换成“研究完成”“可投广告”或“可发布”。底稿保留完整检查 JSON，正文只解释影响决策的问题。

## 原评：按身份去重，再谈目标变体

`voc` 包含 `targets` 和 `pages`：

- `targets`：本次目标的 `{marketplace, asin}` 数组。
- 每页记录 `marketplace`、`host_asin`、`source_locator`、带时区的 `captured_at`、`access_status`、`sampling:{method,sort_order}`、`reviews`。
- 每条原评记录 `review_id`、`review_variant_asin`、`review_date`、`source_locator`、`evidence_kind`；可补 `rating` 和原文 `content_fingerprint`。日期可为原页显示日期；采集时间必须带时区。仅保存短摘要/定位，不批量复制长评或用户名。
- `access_status` 区分 `OBSERVED`、`OBSERVED_EMPTY`、`LOGIN_REQUIRED`、`PARSE_ERROR`、`NOT_COLLECTED`。后面三者表示本次未取得，不能推成平台永远拿不到，也不能当零评论。只有成功确认的空样本使用 `OBSERVED_EMPTY`。
- `evidence_kind` 区分 `RAW_REVIEW`、`AI_SUMMARY`、`APLUS_TESTIMONIAL`。后两者不能进入原评分母；Q&A 等材料另列原证据类型。

跨宿主页面以站点＋review ID 去重，宿主 ASIN 不代替评论所属变体。缺 ID 不计独立原评；归属不明不计目标变体；同 ID 身份冲突暴露并剔除受影响计数。保留去重前展示数、独立原评数、目标可归属数和未核实数，不把同一评论在三个子体下出现算三票。不同时间的正常编辑不凭文字变化就认定身份冲突。

主题分母采用相同范围的独立、可归属原评，继续按原有正负/近期分层抽样；样本比例不是市场发生率。“本批没有目标变体样本”不等于该变体没有评论。

## 报价：资格、套装和优惠分别保留

`offers` 使用 `quotes` 数组，优惠另放 `promotions`，有比较任务才提供 `comparison`。每条报价分别保留身份、来源、采样时刻、金额、币种、地区、需求阶段、购买资格、单位和套装依据。普通价、Prime 价、参考划线价及附条件价格分别存行，不用一个“到手价”覆盖所有买家条件。

- 比较明确购买资格与优惠条件，Prime 价不能充当人人可买价；参考价不进入实际购买价比较。
- `PACK / UNIT` 保留整套与每只口径；数量必须有依据。商品图与目录数量冲突时保留冲突，不能把全表硬编码为两只装。每只显示价可能已舍入，不能乘数量逆推精确套价；整套除以数量只产生均摊价，不是单只购买报价，保留未舍入值。
- 优惠仅按有证据的原始整套基价计算；每只展示价不足以核算整套优惠，已反映在报价中的优惠不得再扣一次。不同优惠保持独立，不自动叠加；组合优惠须另外取得实际适用证据。
- 比较只使用明确的同站点、币种、地区、采样窗口、需求阶段和资格，按声明的单位归一化；缺少可比字段不输出貌似精确的比较结果。

报价中位数即使算对，也只是所采集条目的统计，不是销量加权成交价、市场份额或降价理由。程序不判断消费者是否愿意支付溢价。

## 时间线：观察和实际动作分开

`timeline` 包含带时区的 `as_of`、`events`，以及按需提供的 `comparisons`。

- 事件：`id`、`kind: SNAPSHOT|CHANGE`、`source_ref`、`first_observed_at`。`actual_changed_at` 未知为 null；确知变更时间须使用 `CHANGE` 并记录独立的 `change_source_ref`。
- 比较所用事件补全 `asin`、`variant`、`marketplace`、`pack_count`、`currency`、`region`、`eligibility`、`context` 和 `values`。`context` 标识指标定义、父子体/来源范围及需求阶段；相同文字标签不证明源数据真的可比，仍须人工核对。
- 比较：`kind`、`before_event_id`、`after_event_id`、`field`；效果判断另用 `action_event_id`、`followup_window:{start,end}`。窗口应符合动作与结果观察的先后关系，并保留尚未走完的窗口。
- `CHANGE / NO_CHANGE` 只说明两次已知观测值的差异或相同，不能反推期间没有波动或实际变更日期。新型号/不同 ASIN 不拼成一条价格历史。
- `ASSOCIATION` 只核对所提供的时间关系；`EFFECT / CAUSAL` 即使日期完整，仍提示需要独立审查。时间线检查不证明增量销量、广告效果或因果。

纯快照不强求未知的实际变更日或完整历史；这种范围的通过只表示快照记录通过。
