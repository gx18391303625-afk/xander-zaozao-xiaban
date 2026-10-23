// 暴露给 AI 的全部工具。原则：
// 1. 读数据、算数、写本地档案可以直接用；
// 2. 改亚马逊的东西只能走 prepare → 用户批准 → execute → verify；
// 3. 开关只能看不能拨（拨开关的工具故意不提供）。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, getStore } from '../lib/config.js';
import { p, homeDir, ensureHome } from '../lib/paths.js';
import { backendLabel, getSecret } from '../lib/secrets.js';
import { spapi, getListing, requestReport, collectReport } from '../lib/spapi.js';
import { listProfiles, listEntities, requestAdsReport, collectAdsReport, ENTITIES, V1_PRESETS, V3_PRESETS, V3_REPORT_SUNSET } from '../lib/ads.js';
import { checkSpapiPath, checkReportType } from '../lib/deprecations.js';
import * as archive from '../lib/archive.js';
import * as calc from '../lib/calc.js';
import { listSwitches } from '../lib/switches.js';
import { prepareChange, executeChange, verifyChange, listProposals, changeLog, recordPromotionReceipt } from '../lib/proposals.js';
import { readPromotions } from '../lib/promotions.js';
import { getListingImageRequirements, listAplusDocuments, validateAplusContent, getAplusStatus } from '../lib/ops-content.js';
import { OPS } from '../lib/ops.js';
import * as ziniao from '../lib/ziniao.js';
import { isOn } from '../lib/switches.js';
import { accessToken } from '../lib/lwa.js';
import { marketplaceById, marketplace as mpOf } from '../lib/regions.js';

const MAX_INLINE = 60_000;

// 结果太大时存成文件，只回传路径和开头部分，避免撑爆对话
function out(obj, label = 'result') {
  const text = JSON.stringify(obj, null, 2);
  if (text.length <= MAX_INLINE) return text;
  ensureHome();
  const f = p('exports', `${label}-${Date.now()}.json`);
  fs.writeFileSync(f, text, { mode: 0o600 });
  return JSON.stringify({
    savedTo: f, bytes: text.length,
    note: '数据较大，完整内容已保存到本地文件。请用代码读取该文件计算，不要只看下面的开头部分下结论。',
    head: text.slice(0, 8000),
  }, null, 2);
}

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });
const bool = (d) => ({ type: 'boolean', description: d });
const store = str('店铺别名（只接了一个店铺时可省略）');
const mkt = str('站点代码，如 US、UK、DE、JP（省略则用店铺默认站点）');
const READ = { readOnlyHint: true, openWorldHint: true };
const LOCAL_READ = { readOnlyHint: true, openWorldHint: false };
const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function buildTools(version) {
  return [
    // ---------------- 状态 ----------------
    {
      name: 'xander_status',
      description: '查看本插件状态：已接入的店铺、各连接是否配置、开关哪些打开、设置、数据目录。每次会话开始先调用一次；check=true 时会实际联网测试令牌。',
      inputSchema: S({ check: bool('是否联网测试每个连接（会花几秒）') }),
      annotations: LOCAL_READ,
      async handler({ check }) {
        const cfg = loadConfig();
        const stores = {};
        for (const [alias, s] of Object.entries(cfg.stores)) {
          const sp = !!getSecret(`spapi:${alias}`);
          const ad = !!getSecret(`ads:${alias}`);
          const row = { region: s.region, sellerId: s.sellerId || null, marketplaces: s.marketplaces, defaultMarketplace: s.defaultMarketplace,
            sellerApi: sp ? '已配置' : '未接入', adsApi: ad ? '已配置' : '未接入', adsProfiles: s.ads?.profiles || {} };
          if (check) {
            if (sp) row.sellerApiCheck = await accessToken(getSecret(`spapi:${alias}`), s.region).then(() => 'OK').catch((e) => e.message);
            if (ad) row.adsApiCheck = await accessToken(getSecret(`ads:${alias}`), s.region).then(() => 'OK').catch((e) => e.message);
          }
          stores[alias] = row;
        }
        const sw = listSwitches();
        return out({
          version, dataDir: homeDir(), secretStore: backendLabel(), stores,
          switchesOn: sw.items.filter((x) => x.on).map((x) => `${x.id}（${x.label}）`),
          safetyLimits: sw.limits, settings: cfg.settings,
          ziniao: { configured: !!cfg.ziniao?.enabled, controlSwitchOn: isOn('ziniao.control') },
          cloudBackup: cfg.sync?.enabled ? `S3：${cfg.sync.bucket}` : '未开启',
          sellerSprite: '卖家精灵 MCP 由用户在宿主（Claude/Codex）里单独连接；若工具列表里有它的工具即可使用。',
          hint: Object.keys(stores).length ? null : '还没接入店铺：请引导用户在终端运行 `xander setup`（见 xander-operations/references/setup-guide.md）。',
        });
      },
    },

    // ---------------- 卖家接口（只读） ----------------
    {
      name: 'xander_spapi_get',
      description: '只读调用亚马逊卖家接口（SP-API）的 GET 路径（只用最新版本）：库存 /fba/inventory/v1/summaries、订单 /orders/2026-01-01/orders、财务 /finances/2024-06-19/transactions、目录 /catalog/2022-04-01/items/{asin}、入库 /inbound/fba/2024-03-20/inboundPlans、站点 /sellers/v1/marketplaceParticipations。已弃用的旧版本（orders/v0、finances/v0 等）会被拒绝并提示新路径。站点参数会自动补上。分页按返回的 nextToken / paginationToken 继续调用。',
      inputSchema: S({ store, path: str('以 / 开头的接口路径'), query: { type: 'object', description: '查询参数', additionalProperties: true }, marketplace: mkt }, ['path']),
      annotations: READ,
      async handler({ store: alias, path: apiPath, query = {}, marketplace }) {
        if (!apiPath?.startsWith('/')) throw new Error('path 必须以 / 开头');
        checkSpapiPath(apiPath);
        const s = getStore(alias);
        const q = { ...query };
        const code = marketplace || s.defaultMarketplace;
        // 常用接口自动补上站点参数
        if (code && !q.marketplaceIds && !q.MarketplaceIds) {
          if (apiPath.startsWith('/fba/inventory')) {
            q.granularityType ||= 'Marketplace'; q.granularityId ||= mpOf(code).id; q.marketplaceIds = mpOf(code).id;
          } else if (/^\/finances\/2024-06-19\/transactions/.test(apiPath)) {
            q.marketplaceId ||= mpOf(code).id;
          } else if (/^\/(orders|catalog|listings|sales|products\/pricing|finances\/2024-06-19\/(balances|summary))/.test(apiPath)) {
            q.marketplaceIds = mpOf(code).id;
          }
        }
        const data = await spapi(s.alias, 'GET', apiPath, { query: q });
        return out({ path: apiPath, query: q, fetchedAt: new Date().toISOString(), data }, 'spapi');
      },
    },
    {
      name: 'xander_listing_get',
      description: '只读获取一个 SKU 的 Listing（标题、Item Highlights 亮点、五点、属性、问题、报价、配送渠道库存）。亮点原值在 attributes.title_differentiation，与标题 item_name 分开；属性保留 marketplace_id 和 language_tag，可独立读取而不生成改动提案。',
      inputSchema: S({ store, sku: str('卖家 SKU'), marketplace: mkt }, ['sku']),
      annotations: READ,
      async handler({ store: alias, sku, marketplace }) {
        return out(await getListing(getStore(alias).alias, sku, marketplace), 'listing');
      },
    },
    {
      name: 'xander_spapi_report',
      description: '卖家报表（异步）。action=request 申请（12 小时内同参数自动复用，避免限流），action=collect 查询并下载到本地文件。常用 reportType：GET_SALES_AND_TRAFFIC_REPORT、GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA、GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL、GET_MERCHANT_LISTINGS_ALL_DATA、GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT；结算报表用 GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2（系统定期生成，先用 /reports/2021-06-30/reports?reportTypes=… 列出再 collect）。已弃用的报表类型会被拒绝。生成中不等于没数据，不要当 0。',
      inputSchema: S({
        store, action: { type: 'string', enum: ['request', 'collect'] }, reportType: str('报表类型'),
        marketplaces: { type: 'array', items: { type: 'string' }, description: '站点代码数组' },
        dataStartTime: str('ISO 时间，如 2026-10-01T00:00:00Z'), dataEndTime: str('ISO 时间'),
        reportOptions: { type: 'object', additionalProperties: true, description: '报表选项（如 SQP 的 reportPeriod、asin）' },
        reportId: str('collect 时必填'),
      }, ['action']),
      annotations: READ,
      async handler(a) {
        if (a.action === 'request') {
          if (!a.reportType) throw new Error('request 需要 reportType');
          checkReportType(a.reportType);
          return out(await requestReport(a.store, a));
        }
        if (!a.reportId) throw new Error('collect 需要 reportId');
        return out(await collectReport(a.store, a.reportId), 'report');
      },
    },

    // ---------------- 广告接口（只读） ----------------
    {
      name: 'xander_ads_profiles',
      description: '列出广告账户下的 profile（每个站点一个），用于核对店铺绑定是否正确。',
      inputSchema: S({ store }),
      annotations: READ,
      async handler({ store: alias }) {
        const s = getStore(alias);
        const list = await listProfiles(s.alias);
        return out(list.map((x) => ({ profileId: x.profileId, countryCode: x.countryCode, currency: x.currencyCode, type: x.accountInfo?.type, name: x.accountInfo?.name, marketplace: marketplaceById(x.accountInfo?.marketplaceStringId)?.code })));
      },
    },
    {
      name: 'xander_ads_list',
      description: `读取广告对象列表（自动翻页）。SP/SB 用 Amazon Ads API v1 统一接口，SD 暂用原接口。entity 可选：${Object.keys(ENTITIES).join('、')}（v1 里关键词、否定词、商品投放、自动投放都属于“targets”；sp.keywords / sp.negativeKeywords 是自动加好筛选的快捷方式）。filters 原样传给亚马逊，例如 {"stateFilter":{"include":["ENABLED","PAUSED"]}}、{"campaignIdFilter":{"include":["123"]}}、{"targetTypeFilter":{"include":["PRODUCT"]}}；SD 用 {"stateFilter":"enabled,paused"}。v1 的竞价在 bid.bid（投放）或 bid.defaultBid（广告组），预算在 budgets[0].budgetValue.monetaryBudgetValue.monetaryBudget.value。`,
      inputSchema: S({ store, entity: { type: 'string', enum: Object.keys(ENTITIES) }, marketplace: mkt, filters: { type: 'object', additionalProperties: true }, maxPages: num('最多翻几页，默认 20') }, ['entity']),
      annotations: READ,
      async handler({ store: alias, entity, marketplace, filters, maxPages }) {
        const s = getStore(alias);
        const r = await listEntities(s.alias, entity, { marketplace, filters, maxPages });
        return out({ ...r, note: r.complete ? null : '没翻完所有页（达到 maxPages），数据不完整。' }, `ads-${entity}`);
      },
    },
    {
      name: 'xander_ads_report',
      description: `广告报表（异步）。默认用 Reporting API v1：preset 可选 ${Object.keys(V1_PRESETS).join('、')}，或自己传 fields（如 campaign.id、adGroup.id、date.value、adProduct.value、budgetCurrency.value、metric.clicks、metric.totalCost、metric.sales 等）；v1 报表覆盖 SP/SB/SD，结果里用 adProduct.value 区分。搜索词、投放、推广商品三类报表的 v1 字段官方尚未公开，preset=${Object.keys(V3_PRESETS).join('、')} 暂自动用 v3（${V3_REPORT_SUNSET} 关停）。action=request 申请（12 小时内同参数自动复用），action=collect 下载到本地文件。生成中不等于 0；SD 没有搜索词报表。`,
      inputSchema: S({
        store, action: { type: 'string', enum: ['request', 'collect'] }, marketplace: mkt,
        preset: { type: 'string', enum: [...Object.keys(V1_PRESETS), ...Object.keys(V3_PRESETS)] },
        fields: { type: 'array', items: { type: 'string' }, description: 'v1 自定字段（不用 preset 时）' },
        startDate: str('YYYY-MM-DD'), endDate: str('YYYY-MM-DD'),
        reportId: str('collect 时必填'),
      }, ['action']),
      annotations: READ,
      async handler(a) {
        const s = getStore(a.store);
        if (a.action === 'request') {
          if (!a.startDate || !a.endDate) throw new Error('需要 startDate 和 endDate');
          if (!a.preset && !a.fields?.length) throw new Error('需要 preset 或 fields');
          return out(await requestAdsReport(s.alias, { marketplace: a.marketplace, startDate: a.startDate, endDate: a.endDate, preset: a.preset, fields: a.fields }));
        }
        if (!a.reportId) throw new Error('collect 需要 reportId');
        return out(await collectAdsReport(s.alias, a.reportId, { marketplace: a.marketplace }), 'ads-report');
      },
    },

    // ---------------- 档案库（本地） ----------------
    {
      name: 'xander_archive_overview',
      description: '读取店铺档案：不传 sku 看店铺级事实和产品清单；传 sku 看该产品当前有效的成本/箱规/交期等事实和未完成待办。做利润、补货、广告经济前先读这里，已有的信息不要再问用户。',
      inputSchema: S({ store, sku: str('可选') }),
      annotations: LOCAL_READ,
      async handler({ store: alias, sku }) {
        const s = getStore(alias);
        return out({ ...archive.overview(s.alias, sku || null), standardFields: sku ? undefined : archive.STANDARD_FIELDS });
      },
    },
    {
      name: 'xander_archive_set_fact',
      description: `往档案里记一条事实（只能记用户明确确认过的）。推荐字段：${Object.keys(archive.STANDARD_FIELDS).join('、')}。旧值不会被删除，会自动进入历史。必须写清 source；必须 userConfirmed=true。`,
      inputSchema: S({
        store, sku: str('产品级事实填 SKU；店铺级事实不填'), field: str('字段名'), value: str('值（统一用字符串）'),
        unit: str('单位，如 件、天、kg'), currency: str('币种，如 CNY、USD'), effective_from: str('生效日期 YYYY-MM-DD，默认今天'),
        source: str('来源，如“用户口述 2026-10-22”“工厂报价单 PI-123”'), note: str('备注'),
        userConfirmed: bool('用户已经明确确认这条信息'),
      }, ['field', 'value', 'source', 'userConfirmed']),
      annotations: LOCAL_WRITE,
      async handler(a) {
        if (a.userConfirmed !== true) throw new Error('只能记录用户明确确认过的信息。先跟用户核对再记。');
        const s = getStore(a.store);
        return archive.setFact(s.alias, a);
      },
    },
    {
      name: 'xander_archive_product',
      description: '在档案里登记/更新一个产品（SKU 与 ASIN、标题、变体的对应关系）。',
      inputSchema: S({ store, sku: str('SKU'), asin: str('ASIN'), parent_asin: str('父 ASIN'), title: str('简称'), variant: str('颜色/尺寸等'), marketplace: mkt, note: str('备注') }, ['sku']),
      annotations: LOCAL_WRITE,
      async handler(a) {
        const s = getStore(a.store);
        return archive.upsertProduct(s.alias, a);
      },
    },
    {
      name: 'xander_archive_history',
      description: '查某个字段（或某个产品全部字段）的历史值，例如采购价什么时候从多少改成多少。',
      inputSchema: S({ store, sku: str('可选'), field: str('可选') }),
      annotations: LOCAL_READ,
      async handler({ store: alias, sku, field }) {
        const s = getStore(alias);
        return out(archive.history(s.alias, sku || null, field || null));
      },
    },
    {
      name: 'xander_archive_note',
      description: '记录决策、待办或进度（action=add），或把待办标记完成（action=done）。交接时把结论、待办和下一步记在这里。',
      inputSchema: S({ store, action: { type: 'string', enum: ['add', 'done'] }, sku: str('可选'), kind: { type: 'string', enum: ['note', 'decision', 'todo', 'progress'] }, text: str('内容'), id: num('done 时的待办编号') }, ['action']),
      annotations: LOCAL_WRITE,
      async handler(a) {
        if (a.action === 'done') return archive.completeNote(a.id);
        const s = getStore(a.store);
        return archive.addNote(s.alias, a);
      },
    },
    {
      name: 'xander_archive_import_csv',
      description: '从用户的 CSV 成本表批量导入档案。支持长表（sku,field,value,...）或宽表（sku,purchase_cost,first_leg_cost,...）。先 dryRun=true 预览给用户确认，再正式导入。',
      inputSchema: S({ store, file: str('CSV 文件的完整路径'), source: str('来源说明'), dryRun: bool('只预览不写入') }, ['file']),
      annotations: LOCAL_WRITE,
      async handler(a) {
        const s = getStore(a.store);
        if (!fs.existsSync(a.file)) throw new Error(`找不到文件：${a.file}`);
        return archive.importCsv(s.alias, path.resolve(a.file), { defaultSource: a.source, dryRun: a.dryRun === true });
      },
    },

    // ---------------- 计算器 ----------------
    {
      name: 'xander_calc_ad_economics',
      description: '算单件广告经济线：广告前贡献利润、盈亏平衡 ACoS/CPC、目标 ACoS/CPC（CPC 向下取整到分）。含税站点给 vatPct，利润率底线按不含税净销售额算；金额底线与比例底线取更严格的。可选成本没给会按 0 假设并标 PROVISIONAL（偏乐观）；卖家确认确实没有的放进 notApplicable。缺核心输入返回 INCOMPLETE。状态：BLOCKED（没有广告空间）/ PROVISIONAL / READY_ESTIMATED。更完整的模型用技能里的 calculate_ad_economics.py（calculation_scope=ECONOMICS_ONLY）。',
      inputSchema: S({
        price: num('售价（含税站点填含税价）'), referralFeePct: num('佣金比例，如 15'), fbaFee: num('FBA 配送费'), purchaseCost: num('采购成本（同币种）'),
        firstLegCost: num('头程（同币种）'), otherUnitCost: num('其他单件成本（包装、贴标、质检、关税、仓储等）'),
        returnsCostPerUnit: num('退货非收入损耗/件'), refundLossPerUnit: num('预计退款收入损失/件'),
        notApplicable: { type: 'array', items: { type: 'string', enum: ['otherUnitCost', 'returnsCostPerUnit', 'refundLossPerUnit'] }, description: '卖家确认不适用的可选成本' },
        vatPct: num('含税站点的增值税率，如 20（美国不填）'), attributedSalesPerOrder: num('每单广告归因销售额（默认 = 售价）'),
        targetProfitPerUnit: num('每件最低利润'), targetMarginPct: num('最低利润率%（按不含税净销售额）'), riskBufferPerUnit: num('额外风险缓冲/件'),
        cvrPct: num('广告转化率%'),
      }),
      annotations: LOCAL_READ,
      async handler(a) { return calc.adEconomics(a); },
    },
    {
      name: 'xander_calc_replenishment',
      description: '算补货（逐日推演）：续航天数、断货日、新货到之前的失销量，以及按情景（默认 0.8/1/1.2 倍需求）让窗口内每天都不跌破安全库存的最小补货件数和整箱数。在途必须给 availableInDays（第几天结束时入库，次日可卖），没有就不计入。新货到之前卖不出去的量不会被算进补货量。',
      inputSchema: S({
        rows: { type: 'array', items: { type: 'object', additionalProperties: true, description: '{sku, dailySales(件/天), sellable, inbound:[{qty, availableInDays}], leadTimeDays(新货第几天起可售), coverDays(新货要覆盖几天), safetyDays(窗口内每天至少留几天库存), casePack, moq, unitCost}' } },
        scenarios: { type: 'array', items: { type: 'number' } },
      }, ['rows']),
      annotations: LOCAL_READ,
      async handler(a) { return calc.replenishment(a); },
    },
    {
      name: 'xander_calc_profit',
      description: '利润桥：逐项列收入/费用/广告/售出成本/退款，标记 INCLUDED/NETTED/EXTRA_PAID/ESTIMATED/UNKNOWN/USER_EXCLUDED。核心项是收入、平台/配送费、广告、售出成本、退款；某项确实为 0 也要填 amount=0 表示已确认。缺核心项时只给“已知收支小计”，不叫利润。',
      inputSchema: S({
        currency: str('币种'),
        items: { type: 'array', items: { type: 'object', additionalProperties: true, description: '{name, amount(正数；adjustment 按原符号), category: revenue|fee|ads|cogs|refund|adjustment|other, status}' } },
      }, ['items']),
      annotations: LOCAL_READ,
      async handler(a) { return calc.profitBridge(a); },
    },

    // ---------------- 内容和促销的资格/状态查询（不提交业务改动） ----------------
    {
      name: 'xander_content_check',
      description: '图片/A+ 官方要求与状态查询。imageRequirements 读取该SKU实时商品类型定义；listAplus 分页列文档；validateAplus 校验内容和可选ASIN资格（不创建或提交）；aplusStatus 返回审核及发布记录，记录不含版本时不能宣称本次修订已发布。',
      inputSchema: S({ store, marketplace: mkt, action: { type: 'string', enum: ['imageRequirements', 'listAplus', 'validateAplus', 'aplusStatus'] }, sku: str('SKU'), contentReferenceKey: str('A+文档ID'), contentDocument: { type: 'object', additionalProperties: true }, asinSet: { type: 'array', items: { type: 'string' } } }, ['action']),
      annotations: READ,
      async handler(a) {
        const s = getStore(a.store);
        const fn = { imageRequirements: getListingImageRequirements, listAplus: listAplusDocuments, validateAplus: validateAplusContent, aplusStatus: getAplusStatus }[a.action];
        if (!fn) throw new Error('不支持的action');
        return out(await fn(s, a), 'content-check');
      },
    },
    {
      name: 'xander_promotions',
      description: '官方 Promotions v2025-12-01 只读查询：search 搜索（分页 nextToken 传 query.paginationToken）；get 详情/问题/版本；selection 商品明细（query.revisionId 必填，使用详情中 selection.revisionId；可 includedData:[ISSUES]）。官方暂无促销创建或修改接口，不能用它提交优惠券。',
      inputSchema: S({ store, marketplace: mkt, action: { type: 'string', enum: ['search', 'get', 'selection'] }, promotionId: str('促销ID'), selectionId: str('商品选择ID'), query: { type: 'object', additionalProperties: true } }),
      annotations: READ,
      async handler(a) { return out(await readPromotions(getStore(a.store), a), 'promotions'); },
    },
    {
      name: 'xander_record_promotion_receipt',
      description: '网页操作后，把操作者提供的 promotionId 关联到已批准并生成交接包的促销提案，随后只读查询官方状态。不会提交/重提促销，不把回执输入当作成功证明。',
      inputSchema: S({ proposalId: str('提案编号'), hash: str('提案哈希'), itemIndex: num('提案内的零起始项序号，默认0'), promotionId: str('平台返回的promotionId') }, ['proposalId', 'hash', 'promotionId']),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      async handler(a) { return out(await recordPromotionReceipt(a)); },
    },

    // ---------------- 写入：开关、提案、执行、回读 ----------------
    {
      name: 'xander_switches',
      description: '查看写入开关（只读）。每项写入能力都有一个开关，默认全关；只有用户本人能在开关面板（终端运行 `xander panel`）里打开。AI 不能、也不要尝试替用户打开。',
      inputSchema: S({}),
      annotations: LOCAL_READ,
      async handler() {
        const sw = listSwitches();
        return out({
          ...sw,
          operations: OPS.map((o) => ({ op: o.id, label: o.label, params: o.params, capability: o.capability || 'api', requirements: o.requirements, limitation: o.limitation })),
          howToTurnOn: '请用户在终端运行 `xander panel` 打开本地开关面板，自己点开需要的开关。',
        });
      },
    },
    {
      name: 'xander_prepare_change',
      description: '为亚马逊改动生成本地精确提案，不正式提交亚马逊：读取当前值、检查安全上限，Listing 文案做 Amazon VALIDATION_PREVIEW。listing.attribute 支持 item_name、title_differentiation（Item Highlights 亮点）、bullet_point、product_description、generic_keyword；亮点额外检查真实 PTD 的字段支持与基础结构，完整条件规则由 Amazon 预校验。languageTag 指定目标语言，保留其他站点/语言的原值。原值相同则不生成提案。返回提案编号、哈希和新旧值对照表；格式见 xander_switches 的 operations。',
      inputSchema: S({
        store, marketplace: mkt, note: str('这次改动的目的'),
        changes: { type: 'array', items: { type: 'object', additionalProperties: true } },
      }, ['changes']),
      annotations: READ,
      async handler(a) { return out(await prepareChange(a)); },
    },
    {
      name: 'xander_execute_change',
      description: '执行一个已被用户明确批准的提案（只执行一次）。要求：用户在对话里明确批准了这一份提案；相关开关已由用户打开；提案未过期；哈希一致；面板审批模式下还必须有该提案的面板批准。演练模式只记录 DRY_RUN，不正式提交亚马逊。正式执行后自动回读；OUTCOME_UNKNOWN 绝不能重发，只能用 xander_verify_change 查。',
      inputSchema: S({ proposalId: str('提案编号'), hash: str('提案哈希'), approved: bool('用户已明确批准这份提案') }, ['proposalId', 'hash', 'approved']),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      async handler(a) { return out(await executeChange(a)); },
    },
    {
      name: 'xander_verify_change',
      description: '只读重新核验一个已执行提案的结果（包括 Item Highlights/title_differentiation；Listing 改动常有延迟，OUTCOME_UNKNOWN 必须用它查清楚）。演练结果不等于已提交或已生效；没有已执行提案时可用 xander_listing_get 独立读取当前属性。',
      inputSchema: S({ proposalId: str('提案编号') }, ['proposalId']),
      annotations: READ,
      async handler(a) { return out(await verifyChange(a)); },
    },
    {
      name: 'xander_change_log',
      description: '查看最近的提案列表和写入日志（谁在什么时候改了什么、结果如何）。',
      inputSchema: S({ limit: num('条数，默认 50') }),
      annotations: LOCAL_READ,
      async handler({ limit = 50 }) { return out({ proposals: listProposals(20), ledger: changeLog(limit) }); },
    },

    // ---------------- 紫鸟（实验） ----------------
    {
      name: 'xander_ziniao_status',
      description: '查看紫鸟浏览器是否配置、能否连上、店铺列表，以及“紫鸟控制”开关状态。',
      inputSchema: S({}),
      annotations: LOCAL_READ,
      async handler() { return out(await ziniao.status()); },
    },
    {
      name: 'xander_ziniao_snapshot',
      description: '（需要用户打开“紫鸟控制”开关）用紫鸟打开指定店铺浏览器，可选跳转到亚马逊后台某个网址，读取页面标题和文字。只读，不点击任何东西。只在官方接口做不到时使用。',
      inputSchema: S({ browserId: str('紫鸟店铺 ID（从 xander_ziniao_status 获取）'), url: str('可选：亚马逊后台网址') }, ['browserId']),
      annotations: READ,
      async handler({ browserId, url }) {
        if (!isOn('ziniao.control')) throw new Error('“紫鸟控制”开关是关着的。请用户在开关面板里打开后再试（AI 不能代开）。');
        return out(await ziniao.snapshot(browserId, url), 'ziniao');
      },
    },
  ];
}

export const INSTRUCTIONS = `Xander（自用）早早下班小助手：亚马逊运营本地工具。
- 会话开始先调 xander_status。所有数据只在用户本机。
- 读数据、计算、记本地档案可直接做；改亚马逊必须：xander_prepare_change → 把表格给用户看并取得明确批准 → xander_execute_change → 结果核对。
- 写入开关默认全关，只有用户能在 \`xander panel\` 打开；AI 不得尝试替用户打开开关、修改开关文件或运行开关命令。
- 新建对象默认暂停；多步创建可能部分成功。未知结果只核验，不能换提案重提。
- 图片贡献回读不代表零售页已换图。A+草稿/关联/审核/批准/发布记录分别报告，发布记录缺版本不能宣称当前修订已发布。
- 优惠券只有准备、网页交接与官方只读查询。HANDOFF_READY不代表已提交。宿主电脑操控仅在有工具且用户允许前台操作时使用，不强依赖紫鸟。
- 未知数据保持未知，不当 0；模拟结果标注 SIMULATED。`;
