# 日常预估与计算入口

只取本题所需的销售、广告、交易费用样本及有批次依据的成本。列公式、样本外推依据、已计与未计项，标“暂定”。用户给出的均摊法可作为明确标注的情景模型，不能称逐单真实归属；若用户指定排除退款/促销等，限定本次情景。

用户只问已给数字的公式、小计或明确假设情景时，可直接用透明算术回答，标明“用户给定数据/假设算术，未做生产口径核验”，不必为这类回答登记共享数据。它不更新项目正式指标，不认证当前期间利润，也不允许把已失效/越界证据自动改称假设再使用。输出本项目日常经营利润时仍走下述绑定入口；缺核心费用时可先给已知小计而不冒称利润。

在“亚马逊最强工作台”项目，先读 `CURRENT_STATE.md`、`PROJECT_STATE.json` 的相关段及 `OPERATING_DATA_SOP.md`。日常订单利润复用 `integrations/amazon-operations-review/src/daily-profit.mjs` 的 `estimateBoundDailyProfit` 或其 CLI，不另建公式引擎。调用前查当前代码契约、`SHARED_DATA.md` 与 `SHARED_DATA_REGISTRY.json`：

- 输入 `mode=DAILY_ESTIMATE`；提供 `date/timezone/marketplace/currency/asins`、同币种整数分 `salesMinor/adSpendMinor`、两者来源、`requiredCostIds`、`costs`。
- 成本逐项提供 `id/amountMinor/currency/evidenceClass/source/note/appliesToDate/appliesToAsins/componentKeys`；未知金额为 `null`。计入类仅 `MATCHED_ACTUAL`、`OBSERVED_FEE_ESTIMATE`、`CONFIRMED_COST_ESTIMATE`；`HISTORICAL_UNVERIFIED`、`UNKNOWN`、`USER_EXCLUDED` 不扣除。`componentKeys` 标识互不重叠的账务组成。逐项检查出处、批次与外推基础，程序不能认证填写的证据等级。
- 生产调用要有有效 `inputBindings.policy/data`，各为精确 `{id,version,sha256}`；数据绑定的 payload 必须与除 `inputBindings` 外的完整输入相同。失效、越界或哈希变化时重新审查并显式登记，不静默改绑。`estimateDailyProfit` 只是无绑定算术/测试入口，不能声称通过生产闸门。历史回放通过也不证明当前有效。
- 核对返回 `bindingStatus/status/missingRequired/included/excluded`。`PARTIAL_COSTS_NOT_PROFIT` 时可报告 `knownCostSubtotalBeforeAdsMinor`，也可减去已知广告得到“已知广告后收支小计”，同时保留缺口；两者都不是利润，不能用小计替换脚本中为空的利润字段。`PROVISIONAL_ORDER_PROFIT_NOT_FINAL` 也不是最终利润。`finalProfit` 保持空值。

项目中已撤销的旧入库/仓储单件假设不得改名计入、构造利润下限或保守预留。已付款费用样本不是完整期间结算。没有项目专用入口时，可用可审计的 Decimal/整数分粗算并展示每一步与缺口。已配置项目若仅因运行环境不可用，最多给标注“离线暂算，未通过项目版本/成本准入闸门”的独立结果，不作为生产利润或广告执行依据；版本失效、哈希不符、证据越界等拒绝是实质阻断，不能改走临时计算绕过。输入不满足现有脚本的非负收入/费用限制时保留原符号并走适用的期间明细模型，不取绝对值或补零强塞。
