# 更新记录

## 2.1.0（2026-10-23）全部换成最新接口

- 广告管理 SP/SB 迁到 **Amazon Ads API v1 统一接口**（`/adsApi/v1/query|update|create/...`），按官方 OpenAPI 规范：统一 POST、`Amazon-Ads-ClientId` 头、竞价 `bid.bid` / `bid.defaultBid`、预算 `budgets[].budgetValue.monetaryBudgetValue.monetaryBudget.value`；关键词、否定词、商品投放统一为 targets。
- 新增 SB 投放竞价、开/停；新增活动级否定关键词。旧操作名（如 `ads.sp.keyword.bid` + keywordId）自动转换。
- 广告报表改用 **Reporting API v1**（自动查找并缓存广告主账户 ID）；搜索词/投放/推广商品报表的 v1 字段官方未公开，暂自动用 v3 并标注 2027-06-30 关停日期。
- SP-API 订单改用 **Orders v2026-01-01**、财务改用 **Finances v2024-06-19**、入库改用 **Inbound v2024-03-20**；已弃用接口和报表类型直接拒绝并提示新路径。
- 体检新增 v1 统一接口实测；测试增至 40 项。

## 2.0.0（2026-10-23）开源版

- 从私有远程插件改为**完全本地**运行：没有服务商、没有中转服务器，令牌存系统钥匙串。
- 新增接入向导 `xander setup`、体检 `xander doctor`。
- 新增写入开关面板 `xander panel`：逐项开关、一键全开/全关、紫鸟单独开关、安全上限、面板审批、演练模式。
- 新增本地店铺档案库（SQLite）：成本、箱规、交期、认证、决策和待办，带历史版本；可选加密备份到自己的 S3。
- 写入流程：精确提案（哈希 + 有效期）→ 用户批准 → 只执行一次 → 自动回读；执行前重读原值，结果未知不重发。
- 7 个技能精简重写：去掉重复的工具路由段落，修正 `xander_status` / `xander_live_status` 前后矛盾，统一工具名；保留 1.9.0 全部方法论参考文件与脚本。
- 同时适配 Claude Code（`.claude-plugin`）和 Codex（`plugin.json` + `mcp.json` + `.codex-plugin`）。
- 零第三方依赖。
