---
name: analyze-amazon-competitors
description: "锁定亚马逊对标竞品、对比我方与竞品的关键词点击率/转化率和销量趋势、拆解 ASIN 优劣势与同屏/详情页证据，或制作视觉研究简报。不用于选品、完整词库、Listing 成稿或广告决策。"
---

# 亚马逊竞品作战分析

把买家需求、竞品承诺、体验缺口和我方能证明的事实连起来，找出一个主突破口。用简洁中文，先给结论。

## 开始

1. 本会话没调过就先 `xander_status`；涉及我方产品先 `xander_archive_overview`（档案有的不再问，上次锁定的竞品清单和结论接着用）。
2. 取数：竞品目录 `xander_spapi_get` → `/catalog/2022-04-01/items/{asin}`；同词表现用搜索查询表现报表（`xander_spapi_report`，品牌卖家）和广告搜索词报表（`xander_ads_report` preset=sp_search_terms）；市场估算优先用已连接的卖家精灵 MCP；前台页面用宿主的浏览器/网页读取。方法见 [取数方法](../xander-operations/references/data-workflow.md)。
3. 默认“极速实战”：只取能改变打法的证据。只有用户要发布级、可审计、正式立项、完整证据、认证范围核查或同条件实测对比时，才做深度尽调，并先完整读 [core-rules.md](references/core-rules.md)。
4. 选最小模式，只读对应参考：

| 模式 | 读什么 / 到哪停 |
|---|---|
| 对标锁定 | [对标锁定](references/benchmark-locking.md)；交锁定表、覆盖、competitor_lock.json 和刷新条件后停 |
| 锚点/我方对标/多竞品分析 | [输入与证据](references/input-and-evidence.md)、[竞争框架](references/competitive-framework.md)；只有竞品资料时只给机会假设 |
| 我方与竞品同词点击率、转化率、购买量、销量趋势 | [表现对标](references/query-performance-benchmarking.md)；按指定词、对象、期间对比，不自动扩成完整报告或广告调整 |
| 搜索同屏或详情页入口快照 | [入口观察](references/input-and-evidence.md#流量入口观察与交接)；只看指定页面/对象 |
| 变化复核 | [增量刷新](references/incremental-refresh.md)；只深拆有实质变化的对象 |
| 评论归属、报价比较、事件时间线校验 | [证据检查](references/evidence-checks.md) |
| 卖家精灵、网页、扩展或导出取数 | [采集方法](references/seller-sprite-acquisition.md) |
| 写竞品报告 | [报告契约](references/report-contract.md) |
| 明确要拍摄/图片/视频/A+ 设计交接 | [视觉交接](references/visual-handoff.md) |

## 底线

- 保留用户给的全部 ASIN 和原顺序；只有站点/身份确认不了才停。上游 ID 有就原样保留，没有就留空，不编造。
- 证据分 OBSERVED / VOC / ESTIMATED / INFERRED / UNKNOWN 标清楚；竞品说的、市场常见的不能变成我方事实。价格、评分数、BSR 等带观察日期；空白不是 0。
- 页面断货不能反推库存或销量；广告位密度不能反推 CPC/转化率。
- 最终机会必须同时满足：买家在乎、竞品没做好、我方能证明、能展示、合规。输出一个主突破口、最多两个辅助理由、必须守住的和明确不打的。
- 只出分析，不改账户，不定预算、出价或否词（交广告技能）；词库交关键词技能，文案交 Listing 技能。证据够回答用户的问题就停。

## 收尾

先给结论，再给有日期的证据、关键缺口和下一步。用户新确认的我方事实用 `xander_archive_set_fact`（写清来源）；锁定的竞品清单、结论和复查时间用 `xander_archive_note`。规则见 [店铺档案](../xander-operations/references/business-context.md)。
