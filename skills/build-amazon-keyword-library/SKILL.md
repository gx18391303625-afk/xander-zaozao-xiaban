---
name: build-amazon-keyword-library
description: "建立、刷新或审计亚马逊关键词词库，采集市场/竞品流量词，核验自然位与同屏证据。不用于选品、Listing 成稿或广告决策。"
---

## 数据与工具

- 本会话还没调过就先 `xander_status`；涉及我方产品先 `xander_archive_overview`（档案里有的事实不再问）。
- 取数：一方搜索数据优先——搜索查询表现报表（`xander_spapi_report` reportType=GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT，品牌卖家）、广告搜索词报表（`xander_ads_report` preset=sp_search_terms）；市场与竞品词优先用已连接的卖家精灵 MCP 工具；前台 SERP 用宿主自带的浏览器/网页读取。方法见 [取数方法](../xander-operations/references/data-workflow.md)。
- 本技能只出词库和证据，不改账户、不出广告动作。需要改动时按 [写入安全](../xander-operations/references/write-safety.md) 交给对应技能。
- 未知数字是 null，不是 0；卖家精灵等第三方字段标 ESTIMATED；模拟结果标 SIMULATED / NOT LIVE。
- 脚本只在宿主能执行代码时运行（Codex、Claude Code 可以）；否则透明说明限制。用简洁中文回答。

# 亚马逊关键词词库

产品事实/发布门禁、需求、SERP相关性和竞争背景是四种不同证据，不能互相替代。既有项目先定位当前入口、主库版本与适用数据 SOP，遵守用户来源/付费上限，复用有效证据；账户、词表和商品配置留在项目。

## 最小任务路由

未限定范围的建库请求默认完整建库；“刷新”“审计”不等于全部重采。已完整读取且本轮未变化的参考不重复加载，选中的参考完整读取。

| 用户任务 | 需要的参考与边界 |
|---|---|
| 完整建库 | 按下方流程依次加载输入、采集、证据、分类、SERP、工作簿与正式交接参考 |
| 接受/校验输入、稳定 ID 或经营上下文 | [输入契约](references/input-contract.md) |
| 仅采集竞品词或补产品 ASIN | [采集与标准化](references/acquisition-and-normalization.md)；有站点及有效 seed/ASIN 即可采集，缺我方资料不伪造角色 |
| 新增/修改/审计产品事实、缺失、冲突或主张 | [证据门禁](references/evidence-and-gates.md) |
| 新建/重算/审计关键词角色 | [证据门禁](references/evidence-and-gates.md)、[判断模型](references/decision-model.md) |
| SERP专项、排名/广告展示/同屏核验 | [前台验证](references/serp-validation.md)；限定词、ASIN、窗口，不默认十页扫描、建库、重分类或 Excel |
| 增量刷新 | [增量刷新](references/incremental-refresh.md)；只重开新增、实质变化、争议或失效证据影响项 |
| Excel词库制作/格式审计 | [工作簿契约](references/workbook-contract.md)；语义审计另读对应证据/分类参考 |
| Listing正式交接 | [下游交接](references/downstream-handoff.md)、[输入契约](references/input-contract.md) |
| 局部审计 | 只读被审对象所对应参考，不因“审计”自动要求所有来源与全库交付 |

只分析竞品视觉/VOC交竞品技能；标题、五点、后台词成稿交 Listing；广告决策与联合诊断交广告技能。本技能仅提供可复核证据，不生成活动、匹配、出价、预算、ACoS管理、止损或放量动作。

## 完整建库流程

1. 从已有对话/文件提取站点、seed/ASIN与角色；未知项记录，不反复追问。仅站点或全部对象无法确认才阻塞。有明确品类可生成 seed 并记推导来源。承接 handoff.json/competitor_lock.json 时保留稳定 ID、ASIN原顺序、角色、事实和证据，不重新挑选已锁定竞品。
2. 建立我方事实及研究/发布门禁。用户确认的普通当前量产规格可研究，无需重复确认；认证、安全、医疗、环保、儿童、绝对化与精确量化主张须正式证据闭环，否则 HOLD_CLAIM。页面自述不是认证证明。
3. 记录全部指定竞品身份、变体/套装、价格/优惠、星级/评分数与采样时间。有效的用户指定ASIN均全量采词或记缺口，不因角色低删除；新增对象按锁定包的 FULL_TRAFFIC / CONTEXT_ONLY / NO_QUERY 范围处理。
4. 分别保留市场词、竞品词、我方事实推导词、前台观察词四条来源。前两类按本次月份、分页和工具返回上限取得全量 RAW；推导词不附会搜索量。先保存原始行，再合并标准化视图；近似词族不能擅自相加指标。
5. 按“产品/主张门禁 → 需求 → SERP相关性 → 竞争背景”顺序分类。角色、理由、来源/证据ID、缺口与下一步按判断模型填写；高相关不等于高流量或核心词，综合分不覆盖硬门禁。
6. 对进入核心、次级、待补池及争议的候选词做前台验证，不机械验证全部RAW。**默认轻量**：用户没指定深度时，只验证核心词与争议词，每词只看首页卡片；没验证的次级候选保持 RELEVANT_NEEDS_VALIDATION（不能标 SECONDARY_VERIFIED），列为“未前台验证”缺口。用户明确要“完整建库/深度核验”时，候选词有10页以上则前10页，不足则全部可见页；指定逐词清单以用户范围为准。宿主没有浏览器/网页读取能力时不中断：SERP 相关性标为缺口，相关词最多 PROVISIONAL，并告诉用户缺的是哪一步。先看卡片，只有必要才开详情；首页与2–10页分开，披露选词理由、计划/实扫页与阻断。
7. 默认交中文可筛选 .xlsx，按电子表格技能渲染检查；用户明确只要聊天版或取消前台验证时服从。完整第二步另交 listing_handoff.json，保留所有来源、覆盖与经营上下文，交接不是文案或广告方案。

“全量”仅指约定站点、seed、全部指定ASIN、月份与工具边界，不代表Amazon全站；不因工作量改成前五名或精选词。中途只发计数进度，标“中途预览｜非最终结果”，不要求确认才能继续；完整长任务在对象识别、取数、前台复核、Excel/QA节点简报。

## 跨模式底线

- 区分采集时间与源采样时间；遵守既有监控词表/数据源/付费限制，不恢复用户取消的浏览器检查。未找到不等于零曝光或确定掉榜。
- 同范围可取得的一方搜索数据优先；第三方补市场/竞品覆盖时优先获准的 SellerSprite MCP。其搜索/购买/CPC/流量/转化类字段始终标 ESTIMATED，不能替代我方CVR。不可用先查用户导出/RAW，剩余缺口降级，普通网页不冒充替代。
- 保留 MISSING / NO_ROWS / FETCH_FAILED 等状态，不补零；父子体、变体、单只/套装、税价与优惠口径分开。RAW不丢行，去重仅在标准化视图，近似变体不默认是独立流量池。
- 词库角色以判断模型为准，研究、收录、可见文案、标志及下游复核资格分别记录。阶段标签不解除未释放主张；LATER_STAGE_RELEVANT 的当前资格必须有 current_stage_eligible 和可追溯 stage_eligibility_basis，计划价格/评论/未来阶段不能释放当前资格。
- 可选 operating_context、context_id、operating_context_sha256 核对后原样透传；角色变更记新证据与原因。内容锁定和风险确认不是事实、发布或广告授权。
- 自然语言可用；只有生成输入JSON时才运行 [validate_inputs.py](scripts/validate_inputs.py)（脚本位于本技能目录）。能力校验不是源文件真实、RAW齐备、角色充分或发布就绪的证明；布尔用 true/false，数值禁止 NaN/Infinity。

## 按范围验收并停止

局部任务只验请求部分及实质依赖，不以前台全库、双词源、Excel或正式交接作为窄模式前置。完整建库核对所有指定对象、市场与竞品双词源、RAW/分页、角色证据、前台覆盖、工作簿QA和正式交接；不静默漏源。

最终先给核心/次级/待验证词族、关键理由及缺口，分别列ASIN身份、竞品明细、市场seed与SERP覆盖，不混成一个总覆盖率。完整工作簿附可点击链接、日期、QA与未取得原因。仅使用 COMPLETE / PROVISIONAL / RUN_BLOCKED 作为运行状态，不能当词库角色；核心词源缺失则PROVISIONAL，只有连原始采集都无法开展才RUN_BLOCKED。

## 收尾

词库版本、核心词族结论、缺口和下一步用 `xander_archive_note` 记下；用户新确认的产品事实用 `xander_archive_set_fact` 记下。规则见 [店铺档案](../xander-operations/references/business-context.md)。
