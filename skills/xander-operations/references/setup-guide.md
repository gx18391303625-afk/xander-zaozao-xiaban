# 带新手接入（AI 用）

目标：让完全不懂代码的人，在 15–30 分钟内把店铺、广告接上。语气耐心，一次只说一步，等用户做完再说下一步。

## 铁律

- **密钥只在用户自己的终端里输入**（`xander setup` 会隐藏输入）。不要让用户把 Client Secret、Refresh Token、AWS 密钥、紫鸟密码贴进对话。如果用户已经贴了：提醒他这把密钥已经暴露，去对应后台重新生成，再用 `xander setup` 录入新的。
- 你没法替用户点亚马逊后台的按钮，也看不到他的屏幕；用户卡住时，请他描述看到的页面文字或报错原文。
- 每接好一项，让用户运行 `xander doctor` 或你调用 `xander_status`（check=true）确认。

## 第 0 步：装好运行环境

1. 安装 Node.js 22 LTS 或更新版本：https://nodejs.org （下载 LTS，一路下一步）。装完在终端运行 `node -v`，看到 v22.13 以上即可。
2. 获取插件：
   - Claude Code：`/plugin marketplace add gx18391303625-afk/xander-zaozao-xiaban`，再 `/plugin install xander-zaozao-xiaban@xander-zaozao`。
   - Codex：`codex plugin marketplace add gx18391303625-afk/xander-zaozao-xiaban`，然后在 ChatGPT 桌面版的插件目录里安装。
   - 也可以直接下载仓库 zip 解压。
3. 让 `xander` 命令可用：在插件文件夹里运行 `npm link`（或直接用 `node cli/xander.js <命令>`）。

## 第 1 步：店铺数据（SP-API，必做）

用户运行 `xander setup` → “店铺数据”。向导会要：区域、站点、卖家 ID（Merchant Token）、LWA Client ID、Client Secret、Refresh Token。
准备这些的步骤（卖家后台，用主账号登录）：

1. 设置 → “开发应用 / Develop Apps”（找不到就在后台搜索“开发者中心”）。第一次要填开发者资料，选“私有开发者：只为自己的公司开发”。审核一般 1–3 天，期间可以先接广告。
2. 通过后“添加新应用客户端” → API 类型选 **SP API** → 勾选角色。建议：商品列表、定价、库存与订单跟踪、财务与会计、品牌分析（品牌卖家）、亚马逊物流。
3. 应用列表里“查看”LWA 凭证 → Client ID、Client Secret。
4. 同一行点“授权”→“授权应用”→ 得到 Refresh Token（`Atzr|` 开头）。
5. 设置 → 账户信息 → 商家记号（Merchant Token）= 卖家 ID。

常见报错：
| 报错 | 原因与处理 |
|---|---|
| `invalid_client` | Client ID/Secret 抄错，或 Secret 已轮换。重新复制。 |
| `invalid_grant` | Refresh Token 抄错/已失效。回到应用页面重新授权。 |
| `403 Unauthorized` 访问某接口 | 应用没勾选对应角色。到应用页面编辑角色后**重新授权**生成新令牌。 |
| 欧洲站读不到 | 区域选错（欧洲店铺必须选 EU）。 |
| 读 Listing 报 404 | 卖家 ID 不对，或 SKU/站点不对。 |

## 第 2 步：广告数据（Ads API，强烈建议）

1. 申请 Ads API 权限：https://advertising.amazon.com/API/docs/en-us/guides/onboarding/overview 。个人自用选“直接广告主”。通常几天内回复邮件。
2. 在 https://developer.amazon.com 创建“Login with Amazon 安全配置文件”，拿 Client ID/Secret；在 Web Settings 的 Allowed Return URLs 填 `https://www.amazon.com`。
3. 批准邮件到了以后，把安全配置文件关联到 Ads API（邮件里会说明）。
4. 用户运行 `xander setup` → “广告数据”。向导会给一个授权网址，用户用浏览器打开 → 登录广告账户 → 允许 → 浏览器跳到 amazon.com，地址栏里有 `code=...`，把整个网址复制回终端（几分钟内有效）。
5. 向导会列出广告 profile 并自动对应站点，一般选 seller 类型。

常见报错：`redirect_uri_mismatch`（返回网址和安全配置文件里填的不一致）、`unauthorized_client`（安全配置文件还没关联到 Ads API）、`invalid_grant`（code 过期，重新走一遍）。

## 第 3 步：卖家精灵 MCP（可选）

本插件不经手它的密钥。用户在卖家精灵拿到 MCP 地址后，自己加到宿主：Claude Code `claude mcp add --transport http sellersprite <地址>`；Codex 在 `~/.codex/config.toml` 加 `[mcp_servers.sellersprite]` 和 `url = "<地址>"`。加好后你的工具列表里会出现卖家精灵的工具。它的数据一律标 ESTIMATED（第三方估算）。

## 第 4 步：云备份（可选）

档案库默认只在本机。想多台电脑同步或防丢，`xander setup` → “云备份”：用户自己的 S3 存储桶 + 专用 IAM 用户（只给这个桶的 GetObject/PutObject 权限）+ 一个同步口令。上传前在本机加密。以后 `xander sync push` 备份、`xander sync pull --replace` 恢复。也可以简单地设置环境变量 `XANDER_HOME` 把数据目录放进 OneDrive/iCloud。

## 第 5 步：紫鸟（可选，高风险）

只在官方接口做不到时用。需要紫鸟账号有 WebDriver 权限，并以 WebDriver 模式启动客户端。`xander setup` → “紫鸟浏览器” 配置后，用户还要在开关面板单独打开“紫鸟控制”。

## 第 6 步：开关面板

`xander panel` 打开本地网页。所有写入开关默认全关。建议新手：先开“演练模式”，开一两个低风险开关（如“新增否定关键词”）试一次完整流程，再按需要打开其他开关。

## 排错总表

- `xander doctor` 会逐项测试并给中文原因，先让用户运行它并把输出（不含密钥，它本来也不会打印密钥）发给你。
- 国内网络访问亚马逊接口超时：让用户确认代理开着；Node 22.21+/24 可设置环境变量 `NODE_USE_ENV_PROXY=1` 让 Node 走系统代理（`HTTPS_PROXY`）。
- 工具列表里没有 `xander_*`：插件没装好或 MCP 没启动，让用户重启 Claude/Codex；仍不行就按 `xander install` 打印的手动方法配置。
