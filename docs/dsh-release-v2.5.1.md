# Xander v2.5.1 — DSH 原生插件适配

同一个 Xander 包现可用于 DeepSeek Harness（DSH）、Claude 与 Codex。本版新增 DSH 原生接入，不替换原来的 MCP 入口。

## 本版新增

- 33 个原生 `xander_*` 工具，直接复用原业务 handler 与模型侧名称、描述和参数，不另起 Xander MCP 子进程。
- 1 个总协调和 6 个运营模块，共 7 个包内技能；参考资料和脚本随包分发，不复制到用户技能目录。
- Xander 中英文名称与说明、原有品牌图标、可分发的 bundle 和资源导出。
- 单实例 Host 保护、互斥调用、停用排空和资源清理；移除共享库对宿主全局警告函数的覆盖。
- 安装、凭证存在性检查、同名技能覆盖、更新卸载和市场收录说明。配置与档案默认本地保存，但业务请求及对话数据仍按所选接口与模型的实际路径传输。

本版也包含 main 分支已有的 2.5 经营诊断与行动复盘能力。保存诊断或实验计划不等于批准改动、已经执行或证明收益。

## 安装到 DSH Desktop

兼容声明：**DSH `^0.2.1-rc.5`，Node.js `>=22.13`**。Desktop 可使用其自带 Node 运行时。

在当前 Desktop 插件管理器的“来源”中填入：

```text
github:gx18391303625-afk/xander-zaozao-xiaban#v2.5.1
```

或使用 Release 安装包：

```text
https://github.com/gx18391303625-afk/xander-zaozao-xiaban/releases/download/v2.5.1/xander-zaozao-xiaban-2.5.1.tgz
```

同页的 `SHA256SUMS` 可用于核对安装包。不要手工编辑运行中 Desktop 的 profile；安装结果提示需要重启时，按提示处理。

## Claude / Codex

现有插件身份、MCP stdio 入口和安装方式保留。升级后需由对应宿主重新连接或重载插件，不把 GitHub 更新当成所有会话已自动换版。

## 安全与验证范围

- 新数据目录的写入开关默认关闭；升级保留已有配置、开关、审批方式、演练设置、凭证与档案，不替用户改变权限。
- 亚马逊改动仍须精确提案、逐份明确批准、执行一次与独立回读。
- DSH 停止或超时不能撤回已发出的 Amazon 请求；未知结果只按原提案核验，不自动重试。
- 完整回归与隔离分发包测试覆盖适配与既有 MCP/面板安全行为；本地状态查询、开关查询和合成计算不等于真实账户业务读写验证。
- 未为本次适配对真实账户创建广告、修改 Listing/图片、提交 A+、创建优惠券或执行 FBA 入仓写入。
- GitHub 版本发布、市场目录 PR、审核通过和正式可见分别报告；GitHub 安装包不保证进入官方 Discover 索引。本次不发布 npm 包。

完整指南：https://github.com/gx18391303625-afk/xander-zaozao-xiaban/blob/v2.5.1/docs/dsh.md

2.5 功能说明：https://github.com/gx18391303625-afk/xander-zaozao-xiaban/blob/v2.5.1/docs/v2.5-features.md
