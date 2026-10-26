# SP 活动名称修改

操作与独立开关 ID：`ads.sp.campaign.name`，面板位于“广告 · SP 商品推广 → 修改广告活动名称”，新开关默认关闭。不会沿用活动开停、预算或新建活动的授权。

当前支持美国 US 站、NA 区域、USD profile 的已有单站点 SP 活动；开启和暂停状态均可改名，不支持归档或全球活动。准备、执行前和独立回读都会验证真实 `/v2/profiles` 中的 profile，以及目标活动的 ID、广告类型和站点范围。配置绑定变化、原名称变化或批准后的活动状态变化会阻止提交。

```json
{
  "op": "ads.sp.campaign.name",
  "marketplace": "US",
  "campaignId": "12345678901234",
  "value": "暖手宝-户外-精准",
  "reason": "使用简单直白的名称"
}
```

名称去除两端空白后须为 1–256 个 Unicode 字符，拒绝空文本和控制字符。256 是本插件的保护上限；官方 schema 仅声明字符串，实际字符、长度或重名限制仍以 Amazon 响应为准。`campaignId` 建议使用字符串，拒绝存在精度损失的数字。除了上述参数，不接受状态、预算、竞价、归属等额外改动字段。

正式请求严格为 `POST /adsApi/v1/update/campaigns`，body 仅包含 `campaigns: [{campaignId, name}]`。不会提交或重写预算、状态、竞价、广告位、日期、标签或组合归属。官方更新 schema 中只有 `campaignId` 是必填项，允许仅提供需要变更的 `name`。[官方固定版本合约](https://github.com/amzn/ads-advanced-tools-docs/blob/e25aace0ec07997c113dac48f333298472243558/unified-campaign-management-migration-skills/api-specs/unified-api-sp.json#L1752-L1816)

沿用现有流程：`xander_prepare_change` 生成原名称与新名称的精确提案 → 用户开启改名开关并批准相应提案（面板审批模式下在面板点批准）→ `xander_execute_change` 执行一次 → 按目标 ID 独立读取名称。AI 不得代开开关或代点审批。

单项回执必须唯一对应 `index: 0` 和目标 `campaignId`；空回执、错误 ID、重复或相互矛盾的成功/失败项均保留未知状态，只允许 `xander_verify_change` 继续核验，不重发。成功提交而暂读旧名时保留 `AWAITING_READBACK`，独立读取与批准名称一致才标记 `API_STATE_VERIFIED`。该状态只证明名称配置，不表示投放或花费变化。

未核清的改名会按 profile 和活动 ID 阻止跨提案重复提交，换新名称也不能绕过；已经提前准备的另一份提案在执行前同样检查。此身份从已纳入哈希的参数派生，不改变旧提案哈希格式。HTTP 408/409 等非明确拒绝保持未知状态，不能当作失败后重试。

安装新版后需要使用新版面板才能看到新增开关；旧进程的操作列表不会热加载。可以保留正在使用的 2.3.7 面板，并从新版启动额外面板；完整开关管理请转到新版，避免同时在两个页面修改设置。
