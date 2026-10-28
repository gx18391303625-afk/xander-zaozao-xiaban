# 本机插件自动同步

`scripts/sync-plugin.mjs` 是可选的本机同步器，使用 Node.js 自带模块。它更新 Git 检出目录和 Codex 插件文件，不调用亚马逊业务接口，不修改开关，不结束正在运行的 DSH、Codex 或 MCP 进程。

## 同步规则

1. 按当前本地分支的 `branch.<name>.remote` 和 `branch.<name>.merge` 读取上游。远端不必叫 `origin`，本地和远端分支名也可以不同；多个远端时不会随便选择第一个。
2. 拒绝 detached HEAD、没有上游、本地未提交/未跟踪文件、本地领先或分叉等状态，保留本地工作。只 fetch 一次，再将已获取的提交快进合并；不 reset、不 stash、不额外 pull。
3. 读取 Codex 的实际安装登记。已明确停用的插件保持停用；需要更新时，依次执行 `plugin marketplace upgrade` 和 `plugin add`，检查返回的版本及安装目录，并逐文件对比目标提交中的运行代码、技能、清单和 MCP 配置。
4. 用提交号和实际文件判断是否需要更新。版本号没变但内容变了，也不会直接跳过；单看缓存目录里最大的版本号不能证明正在使用该版本。
5. 安装失败或内容不一致时标为失败，保留上次成功记录。已成功更新的 Git 检出不回滚；下次定时运行继续检查和重试 Codex 安装。

Codex marketplace 有自己的来源配置。如果它与 DSH 仓库所跟踪的来源/分支不同，同步器可能在内容校验时拒绝确认成功。此时应检查两边来源，不会擅自修改 marketplace 配置。

## 安装到已有定时任务

同步器不创建定时任务。已有 `com.xander.plugin-sync` 的 30 分钟间隔可以继续使用，只替换其调用的本机脚本。

先备份旧脚本，再把审核、测试后的 `scripts/sync-plugin.mjs` 复制到 `~/.dsh/xander/sync-plugin.mjs`。保留独立本机副本，仓库更新不会偷偷替换正在使用的同步逻辑；以后升级同步器时再次明确复制。

已有 `node.sh` 的 `sync.sh` 包装器示例：

```sh
#!/bin/sh
set -eu
. "$HOME/.dsh/xander/lib/node.sh"
require_node
exec "$NODE" "$HOME/.dsh/xander/sync-plugin.mjs" \
  --repo "$REPO" \
  --codex "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" \
  --state-dir "$HOME/.dsh/xander"
```

`--repo` 和 `--codex` 使用本机实际路径。可选参数 `--marketplace` 默认 `xander-zaozao`，`--plugin` 默认 `xander-zaozao-xiaban`。不依赖 launchd 的 PATH 寻找 Node；Git 使用 macOS 默认可用的 `git`。

## 状态与重开提示

- `sync.status.json` 原子写入完整结果：检查时间、阶段、错误代码、目标提交、磁盘版本、安装内容校验、上次成功结果及待重开进程。
- `sync.status` 保留简短可读状态；`sync.log` 记录状态变化和问题。失败退出码为 1，成功或已有另一个同步进程在运行时为 0。
- 同一个未变化的错误/重开提示不会每半小时重复弹通知；失败恢复后会更新状态。系统拒绝桌面通知时写入日志，下次再次尝试；应以状态文件为准。
- 已安装的新文件不代表旧会话已经重新加载。同步时仍在运行的 DSH MCP 或 Codex 应用会记录待重开提示；请在当前工作结束后重开宿主。同步器不自动结束它们，也不把磁盘版本写成“已加载版本”。
- 无法读取进程列表时明确标记未知，提示按需重开。重开提示会跨网络/安装失败保留；旧进程消失后解除对应提示，但仍不宣称做过 MCP 运行版本握手。

## 异常恢复

网络失败不需要断网实测：回归测试注入 fetch 失败，并验证失败状态、上次成功记录、去重通知、恢复后继续更新。安装和内容校验失败也有独立测试。

并发运行使用 `sync.lock`，活进程持有锁时下一次调用立即跳过。若进程异常退出留下锁，或者写锁中断留下损坏记录，同步器会明确报 `stale-lock` / `invalid-lock`，保留锁并退出失败。确认没有同步进程后再删除该文件重试；不会自动删除别人的锁，以避免两个恢复进程同时运行。刚创建、尚未写完的锁会短暂跳过，超过 30 秒仍损坏则报错。

本机同步脚本的测试只使用临时 Git 仓库和模拟 Codex/系统调用，不连接真实账户，不安装插件，不弹桌面通知，不断开网络，也不结束进程。

```sh
node --test test/plugin-sync.test.js
```
