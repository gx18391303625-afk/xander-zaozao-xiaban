# DSH 接入指南

本文对应根包 `xander-zaozao-xiaban` **2.5.1** 的 DeepSeek Harness（DSH）适配。它与 Claude / Codex 共用同一根包，不是另一个 Xander 包。

**DSH 原生适配从 v2.5.1 起提供。** GitHub 版本发布与市场收录是两个独立步骤：可按下方固定版本来源安装，市场是否已收录以目录实际状态为准。本文是安装与验收说明，不表示已经完成真实店铺验证。

## 1. 支持范围与接入方式

| 项目 | 范围 |
|---|---|
| DSH | 首批支持声明为 `^0.2.1-rc.5`；其他范围需另行验证 |
| Node.js | `>=22.13`；DSH Desktop 可使用其自带 Node 运行时，无需为原生插件另起 Node 服务 |
| 包入口 | [package.json](<../package.json>) 的 `dsh.bundle.patch` 为 `./dsh/cordis.patch.yml`，根 `main` / `exports` 指向 `./dsh/index.js` |
| 工具 | 通过 `ctx.tools.register` 直接复用 [server/tools.js](<../server/tools.js>) 的同一 handler；原生工具名保留 `xander_*`，不启动额外 Xander MCP 子进程 |
| 挂载位置 | 只挂载一份全局 Host 插件；不要在多个 Agent 预设重复挂载。重复实例会明确拒绝，避免一个实例卸载时关闭另一个实例使用的数据库 |
| 技能 | 官方 filesystem provider 从包内注册 7 个技能；不复制到 `~/.dsh/skills`，参考资料与脚本也留在包内 |
| 页面 | 不增加 DSH 专属业务页面；原有 `xander panel` 仍是独立的本机安全面板 |

凭证、配置、档案保存在本地；授权与业务请求会访问用户所选的接口，进入对话的业务数据也会按 DSH 所选模型传输。启用可选云备份时，加密档案会传到用户自己的 S3。**不能将“本地插件”理解为“所有数据绝不离开电脑”。**

Claude Code、Codex CLI / ChatGPT 桌面版与 Claude 桌面版的原有入口不变，见 [README 的快速开始](<../README.md#快速开始约-20-分钟>) 和 [新手接入教程](<新手接入教程.md>)。

## 2. 当前安装：使用 Desktop 插件管理器

1. 准备这份包含 DSH 适配的本地仓库，确认根目录内有 [package.json](<../package.json>)、[DSH 补丁](<../dsh/cordis.patch.yml>)、[DSH 入口](<../dsh/index.js>) 和 [技能目录](<../skills/>)。不要选父目录或仅选 `dsh` 子目录。
2. 在**当前运行的 DSH Desktop** 打开插件管理器，将本地仓库的**绝对目录**填入“来源”输入框，再由插件管理器完成安装。例如 `/Users/you/xander-zaozao-xiaban`，实际请换成自己的真实目录；目录名可以包含空格或中文。
3. 检查插件管理器给出的应用结果和警告。只有已应用才进入下一步；若提示需要重启，先按提示重启。失败或尚未应用不能算接入成功。
4. 在插件详情中核对 Xander 名称、说明、图标和版本，再按下一节只读验收。安装或技能可见不等于真店业务已经验证。

**不要为运行中的 Desktop 切换或改写 profile，也不要手工修改它的包配置或 Cordis 补丁。** 安装、启停、升级和卸载均通过当前 Desktop 的插件管理器处理。

### 固定版本来源：v2.5.1

在当前 Desktop 插件管理器的“来源”输入框填入以下来源：

```text
github:gx18391303625-afk/xander-zaozao-xiaban#v2.5.1
```

也可以直接使用该版本的 Release 安装包：

```text
https://github.com/gx18391303625-afk/xander-zaozao-xiaban/releases/download/v2.5.1/xander-zaozao-xiaban-2.5.1.tgz
```

请先核对 [v2.5.1 发布页](<https://github.com/gx18391303625-afk/xander-zaozao-xiaban/releases/tag/v2.5.1>) 中的版本、安装包和校验值；若标签或附件暂不可获取，不把失败当成安装成功。安装 GitHub 来源不要求先有 npm 发行，市场收录与官方 Discover 索引另见第 6 节。

### 非 Desktop 的本地 DSH CLI

只有独立运行的**非 Desktop 本地 DSH** 才使用以下 CLI 方式，明确选择它自己的 profile：

```text
dsh plugin --profile <profile> add <目录/来源>
```

本地目录应使用绝对路径并按终端规则加引号；GitHub 来源应固定到可获取的 tag 或 commit。Desktop 用户不要用这条命令代替正在运行的 Desktop 插件管理器，也不要用包管理器手工改其 profile。

## 3. 安装后的最小只读验收

这一步不接入新令牌、不做真实业务查询、不生成写入提案，不打开任何开关。可以向 DSH 发送：

> 只验证 Xander 本地接入：调用 `xander_status`，参数 `{"check":false}`；再调用 `xander_switches`，参数 `{}`，只读查看。不要联网测试令牌，不调用其他业务工具，不开开关，不准备或执行改动。

检查以下项目：

- `xander_status` 能返回版本、本地数据目录、配置情况和安全设置；**显式使用 `check=false`**，不是 `check=true`。它仍会检查本机凭证是否存在，但不回显凭证原文；不做令牌联网测试。返回“未接入店铺”不妨碍本地适配验收。若不希望进行凭证存在性检查，可只核对工具与技能发现，并在独立临时数据目录中测试。
- `xander_switches` 只查看开关与能力清单，不改变权限。新数据目录的开关默认关闭；使用已有数据目录时保留原状态，不能假设升级会替用户关闭已有开关。
- 可发现以下 7 个包内技能，且技能资源仍从包内加载：
  - `xander-operations`
  - `analyze-amazon-competitors`
  - `build-amazon-keyword-library`
  - `write-amazon-listing`
  - `build-amazon-advertising-strategy`
  - `plan-amazon-replenishment`
  - `reconcile-amazon-profit`
- 安装没有启动额外的 Xander MCP 子进程，也没有把技能写入 `~/.dsh/skills`。

**同名技能提示：** 如果用户原来手工安装过同名技能，用户技能可能优先于、覆盖包技能。请先查看实际技能来源；不要自动删除或覆盖用户技能。需要迁移时，先征得用户确认，再备份并处理旧副本。

**重复 MCP 提示：** 如果 DSH 原来手工接过 Xander MCP，先核对是否存在两套重复工具。只有在用户确认后，才通过 DSH 插件管理器禁用旧的手工 Xander MCP 连接；保留这次原生插件。不要自动停用无关 MCP，也不要为去重编辑运行中 Desktop 的 profile 文件。Claude / Codex 各自使用的 Xander MCP 不因 DSH 原生适配而被自动禁用。

只读验收成功仅表示本地插件可加载、工具可调用、技能可发现；**不证明 Amazon 令牌、真实业务读写权限、商品资格或效果已经验证。** `xander doctor`、`xander_status(check=true)` 会进行实际连接测试，不属于上述最小验收，必须由用户另行决定是否执行。

## 4. 接入令牌、权限和开关面板

接入店铺、广告、云备份或紫鸟时，**只由用户本人在自己的终端运行**：

```sh
xander setup
```

若本地没有安装 `xander` 命令，可在仓库根目录用兼容的 Node.js 运行 `node cli/xander.js setup`。用户终端需要可用的 Node.js `>=22.13`；Desktop 的插件运行时不等于终端必然已有 `node` 命令。向导会保存凭证并按所选项目实际测试连接，不能作为无联网验收步骤。

Client Secret、Refresh Token、AWS 密钥、紫鸟密码和授权回跳地址只在用户自己的终端输入，不发到对话、工具参数或插件公开配置里。不要让 AI 代填、读取或回显令牌。更多步骤见 [新手接入教程](<新手接入教程.md>)。

安装插件**不会自动打开权限或写入开关**。原有安全链不变：精确提案、安全上限、逐份批准、执行一次和独立回读；本地面板审批与演练模式仍按用户原设置生效。使用已有数据时也不重置安全设置。

**停止 / 超时不等于撤回：** DSH 停止或工具超时不能撤回已经提交的 Amazon 请求。不要自动重试；若结果未知，先保留 `proposalId`，按该提案核验提交状态与平台回读，再由用户决定后续动作，不能把取消当成“未执行”。

开关面板继续由用户在终端开启：

```sh
xander panel
```

没有全局命令时可在仓库根目录运行 `node cli/xander.js panel`。面板只用于本机安全操作，不是新增的 DSH 业务页；面板网址含一次性口令，请勿分享。是否开某一项权限由用户本人决定，AI 不自动打开。

## 5. 更新、停用与卸载

- **更新本地适配：** 保留仓库路径，先核对新版本来源，再通过 Desktop 插件管理器更新同一根包。替换已加载版本后如提示重启，应按提示重启；不能把文件已更新当作运行时代码已替换。公开发布后的更新同样先确认目标 tag 或 commit。
- **停用 / 卸载：** 通过 Desktop 插件管理器停用或卸载 Xander。不要手动改 profile 包配置，也不要用删业务数据目录代替卸载。
- **业务数据保留：** 更新和卸载不删除 `~/.xander-zaozao/`（或 `XANDER_HOME` 指定目录）的配置、开关、档案、提案、日志和报表，也不主动清除本机保存的凭证。再次安装仍应核对原有开关状态。若需彻底清理，须用户另行明确确认，先备份。
- **技能不落用户目录：** 包内技能随插件分发，不需要清理 `~/.dsh/skills` 中的包副本；用户曾手工复制的技能属于用户资源，不自动删。卸载后的包技能可见性应重新核验，用户同名技能仍可能存在。
- **跨宿主：** 不为 DSH 的更新或卸载改动 Claude / Codex 入口，也不自动清理其他宿主的配置与缓存。

## 6. 市场收录与发布说明

本地安装、GitHub 发布和市场收录是三个不同阶段。市场目录的投稿入口是 [awesome-dsh-plugin/awesome-dsh-plugin](<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>)：维护者提交收录 PR，等待审核与同步。**公开 tag、上传安装包或提交 PR 都不等于已通过审核或已在市场可见。**

### GitHub 安装包与 npm 的区别

- awesome 目录、网页和使用该目录的 dsh-market 可收录 GitHub Release 的 `.tgz` 安装包，不要求先发布 npm。
- 该目录导出的官方 DSH Discover format-1 索引目前另要求匹配仓库的 npm 包、精确版本和发布时间；只有 GitHub Release 不保证出现在官方 Discover。
- 如果自动探测到同仓库的 npm 发行，市场可能优先推荐 npm，而非条目中的 tarball。维护者应核对 npm 版本是否同样含 DSH 适配，不能拿旧 npm 版本代替新 Release。
- 本次发行使用固定版本的 GitHub 来源与安装包；npm 发行属于单独的公开发布操作，不自动执行。

### 维护者发布清单

1. 对精确提交运行完整测试和隔离打包检查，包含 DSH 补丁、入口、品牌元数据、[图标](<../assets/icon.svg>)、7 个技能及全部引用资源；保留 CLI 与 Claude / Codex 原入口。
2. 记录本地安装、只读验收、打包检查及未验证范围，不把模拟或离线测试写成真店验证。
3. 经维护者明确授权后发布 tag、Release 安装包与校验值，确认所有公开来源可获取。
4. 按市场当前投稿格式提交目录 PR，准确描述权限与验证边界；不承诺审核结果或同步时间。

## 7. 仍未验证的边界

- 本次 DSH 适配与最小验收不等于真实店铺验收；尚未据此对真店创建广告、改竞价、修改 Listing 或图片、提交 A+、创建优惠券或执行 FBA 入仓写入。
- 合成接口、离线契约与模拟测试不能证明真实账户具备所有角色、广告权限、品牌或商品资格；SD 等 Beta 能力仍保持原有边界。
- 原有接口版本、报表兼容性、紫鸟页面变化及卖家精灵套餐限制仍存在，见 [README 的已知限制](<../README.md#已知限制与待验证>)。
- 未验证超出 `^0.2.1-rc.5` 支持声明的 DSH 版本、其他远程部署或所有平台组合，不据此承诺兼容。
