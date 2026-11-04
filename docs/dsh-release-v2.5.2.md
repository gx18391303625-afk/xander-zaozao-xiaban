# Xander v2.5.2 — 紫鸟 WebDriver 打开店铺失败修复

补丁版本，只修紫鸟自动化链路，不改变任何工具名称、参数、审批流程和既有开关状态。

## 修复内容

`xander_ziniao_snapshot` 与 `ziniao.control` 之前一律失败：

```
紫鸟返回错误：无权限操作 错误码：102
```

根因是 `lib/ziniao.js` 调用 `startBrowser` 时同时传了 `browserOauth` 和 `browserId`。紫鸟在两者并存时**优先使用 `browserId`**，而 `getBrowserList` 返回的 `browserOauth` 是加密店铺标识；把它当明文店铺 ID 传入后被判定为无效，于是返回 102「无权限操作」，看起来像权限没开通。

修复方式是只传 `browserOauth`。实测修复后 `startBrowser` 返回 `statusCode 0` 与 `debuggingPort`，可通过 CDP 正常导航并读取卖家后台页面。

## 部署前提（排障要点）

1. 紫鸟必须以 WebDriver 模式启动：

   ```bash
   open -a /Applications/ziniao.app --args \
     --run_type=web_driver --ipc_type=http --port=20394
   ```

2. 启动前需要**关闭紫鸟主进程**；强制退出后要清掉残留锁，否则客户端认为已有实例在运行而静默退出：

   ```
   ~/Library/Application Support/ziniaobrowser/instances/<userdir>/custom-lockfile
   ```

3. 紫鸟本地端口每次重启可能变化，`config.json` 里 `ziniao.port` 必须与启动参数一致；写死某个历史端口会表现为 `fetch failed`。

## 验证边界

本次只验证了连接、启动店铺、导航和读取页面文字。未验证真实业务写入，也未验证重前端单页（例如 MCF 订单列表）里的表格抓取——这类页面需要用 `ziniao.control` 点击导航进入，而不是直接拼 URL。

## 安装

```text
github:gx18391303625-afk/xander-zaozao-xiaban#v2.5.2
```

或使用 Release 附件：

```text
https://github.com/gx18391303625-afk/xander-zaozao-xiaban/releases/download/v2.5.2/xander-zaozao-xiaban-2.5.2.tgz
```
