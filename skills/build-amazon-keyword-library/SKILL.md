---
name: build-amazon-keyword-library
description: "建立、刷新或审计亚马逊关键词词库，采集市场/竞品流量词，核验自然位与同屏证据。不用于选品、Listing 成稿或广告决策。"
---

# 亚马逊关键词词库

产品事实、搜索需求、前台（SERP）相关性和竞争背景是四种不同证据，不能互相替代。用简洁中文，先给结论。

## 开始

1. 本会话没调过就先 `xander_status`；涉及我方产品先 `xander_archive_overview`（档案有的不再问，上次的词库版本和结论接着用）。
2. 取数：一方数据优先——搜索查询表现报表（`xander_spapi_report` reportType=GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT，品牌卖家）、广告搜索词报表（`xander_ads_report` preset=sp_search_terms）；市场与竞品词优先用已连接的卖家精灵 MCP；前台 SERP 用宿主的浏览器/网页读取。方法见 [取数方法](../xander-operations/references/data-workflow.md)。
3. 没限定范围的“建库”默认完整建库，先完整读 [core-rules.md](references/core-rules.md)；“刷新”“审计”不等于全部重采。局部任务只读对应参考：

| 任务 | 读 |
|---|---|
| 完整建库 | [core-rules.md](references/core-rules.md) 的流程，依次加载下面各参考 |
| 接受/校验输入、稳定 ID、经营上下文 | [输入契约](references/input-contract.md) |
| 只采集竞品词或补 ASIN | [采集与标准化](references/acquisition-and-normalization.md) |
| 产品事实、缺失、冲突或主张 | [证据门禁](references/evidence-and-gates.md) |
| 新建/重算/审计关键词角色 | [证据门禁](references/evidence-and-gates.md)、[判断模型](references/decision-model.md) |
| SERP、排名、广告展示、同屏核验 | [前台验证](references/serp-validation.md)；限定词、ASIN、窗口 |
| 增量刷新 | [增量刷新](references/incremental-refresh.md) |
| Excel 制作或格式审计 | [工作簿契约](references/workbook-contract.md) |
| 正式交接 Listing | [下游交接](references/downstream-handoff.md)、[输入契约](references/input-contract.md) |

## 底线

- 前台验证默认轻量：用户没指定深度时只验核心词和争议词，每词只看首页；没验证的次级词保持“待前台验证”，不能标已验证。宿主没有浏览器时不中断，标缺口、最多 PROVISIONAL。
- 用户指定的 ASIN 全部采词或记缺口，保留原顺序；原始行不丢，去重只在标准化视图里做，近似词族不擅自相加。
- 卖家精灵的搜索量、CPC、转化等字段永远标 ESTIMATED，不能替代我方转化率。MISSING / NO_ROWS / FETCH_FAILED 原样保留，不补 0；没找到不等于零曝光或掉榜。
- 认证、安全、医疗、环保、儿童、绝对化、精确量化类主张没有正式证据就 HOLD_CLAIM。
- 只出词库和证据，不出活动、匹配方式、出价、预算等广告动作（交广告技能）；文案交 Listing 技能。运行状态只用 COMPLETE / PROVISIONAL / RUN_BLOCKED。

## 收尾

先给核心/次级/待验证词族、关键理由和缺口。词库版本、核心词族结论、缺口和下一步用 `xander_archive_note` 记下；用户新确认的产品事实用 `xander_archive_set_fact`。规则见 [店铺档案](../xander-operations/references/business-context.md)。
