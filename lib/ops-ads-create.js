// Official contract: amzn/ads-advanced-tools-docs, unified-api-sp.json (2026-08-27).
// Creates are intentionally sequential. Every write is preceded by a durable checkpoint.
import crypto from 'node:crypto';
import { ads, profileFor } from './ads.js';
import { marketplace } from './regions.js';
import { canonical } from './jsonfile.js';
import { HttpError } from './http.js';

const SP = 'SPONSORED_PRODUCTS';
const GROUP = '广告 · SP 商品推广';
const TAG = 'xander-operation';
const STRATEGIES = ['MANUAL', 'SALES_DOWN_ONLY', 'SALES_UP_AND_DOWN'];
const PLACEMENTS = ['PRODUCT_PAGE', 'REST_OF_SEARCH', 'SITE_AMAZON_BUSINESS', 'TOP_OF_SEARCH'];
const STATES = { include: ['ENABLED', 'PAUSED', 'ARCHIVED'] };
const SINGLE = { campaigns: 'campaign', adGroups: 'adGroup', ads: 'ad' };
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => canonical(a) === canonical(b);
const nameKey = (v) => String(v || '').trim().toLocaleLowerCase('en-US');
const productOf = (ad) => ad?.creative?.productCreative?.productCreativeSettings?.advertisedProduct;
const hasTag = (item, key) => (item?.tags || []).some((t) => t.key === TAG && t.value === key);

function textValue(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`${label} 必须是 1–${max} 字符的非空文本。`);
  return value.trim();
}
function amount(value, label) {
  const n = Number(value);
  if (value === '' || typeof value === 'boolean' || !Number.isFinite(n) || n <= 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw new Error(`${label} 必须大于 0，且最多两位小数。`);
  return n;
}
function modeOf(c) {
  const mode = c.mode || 'campaign';
  if (!['campaign', 'adGroup', 'ads'].includes(mode)) throw new Error('mode 只能是 campaign（整链）、adGroup（已有活动下新组和商品）或 ads（已有组下新商品）。');
  return mode;
}
function placementValues(values) {
  if (!Array.isArray(values) || values.length > 4) throw new Error('placementBidAdjustments 必须是最多 4 项的数组。');
  const seen = new Set();
  return values.map((v) => {
    if (!v || !PLACEMENTS.includes(v.placement) || seen.has(v.placement)) throw new Error(`广告位必须唯一且属于 ${PLACEMENTS.join(' / ')}。`);
    if (typeof v.percentage !== 'number' || !Number.isInteger(v.percentage) || v.percentage < 0 || v.percentage > 900) throw new Error('广告位加价 percentage 必须是 0–900 的整数。');
    seen.add(v.placement);
    return { placement: v.placement, percentage: v.percentage };
  }).sort((a, b) => a.placement.localeCompare(b.placement));
}
function bidSettingsOf(item) {
  const b = item?.optimizations?.bidSettings || {};
  const out = { bidStrategy: b.bidStrategy || null, bidAdjustments: {} };
  for (const key of ['audienceBidAdjustments', 'creativeBidAdjustments', 'placementBidAdjustments']) {
    if (b.bidAdjustments?.[key]?.length) out.bidAdjustments[key] = clone(b.bidAdjustments[key]);
  }
  out.bidAdjustments.placementBidAdjustments = (out.bidAdjustments.placementBidAdjustments || []).sort((a, b) => a.placement.localeCompare(b.placement));
  return out;
}
function semanticBids(value) {
  const v = clone(value);
  v.bidAdjustments ||= {};
  // Amazon may omit an explicit zero adjustment in readback.
  v.bidAdjustments.placementBidAdjustments = (v.bidAdjustments.placementBidAdjustments || []).filter((p) => p.percentage !== 0).sort((a, b) => a.placement.localeCompare(b.placement));
  for (const k of ['audienceBidAdjustments', 'creativeBidAdjustments']) if (!v.bidAdjustments[k]?.length) delete v.bidAdjustments[k];
  return v;
}
async function queryAll(store, profileId, resource, filters = {}) {
  const out = []; const tokens = new Set(); let nextToken;
  for (let page = 0; page < 1000; page++) {
    const body = { adProductFilter: { include: [SP] }, stateFilter: STATES, ...filters, maxResults: 1000, ...(nextToken ? { nextToken } : {}) };
    const data = await ads(store.alias, 'POST', `/adsApi/v1/query/${resource}`, { profileId, body });
    if (!Array.isArray(data?.[resource])) throw new Error(`无法完整读取 ${resource}，停止创建/修改。`);
    out.push(...data[resource]); nextToken = data.nextToken;
    if (!nextToken) return out;
    if (tokens.has(nextToken)) throw new Error('亚马逊查询分页令牌循环，不能确认唯一性，停止写入。');
    tokens.add(nextToken);
  }
  throw new Error('亚马逊查询超过 1000 页，未完成唯一性检查，停止写入。');
}
async function findById(store, profileId, resource, id) {
  const field = `${SINGLE[resource]}Id`;
  return (await queryAll(store, profileId, resource, { [`${field}Filter`]: { include: [String(id)] } })).find((x) => String(x[field]) === String(id));
}
function usable(item, label) {
  if (!item || item.adProduct !== SP) throw new Error(`找不到对应的 SP ${label}。`);
  if (item.state === 'ARCHIVED') throw new Error(`${label}已归档，不能新增或修改。`);
  return item;
}
async function profileInfo(store, code, profileId) {
  const mp = marketplace(code);
  if (mp.region !== store.region) throw new Error(`站点 ${code} 与店铺广告区域 ${store.region} 不一致。`);
  const profiles = await ads(store.alias, 'GET', '/v2/profiles', { noProfile: true });
  const profile = Array.isArray(profiles) && profiles.find((p) => String(p.profileId) === profileId);
  if (!profile) throw new Error('当前广告授权不能读取指定 profile；请先检查连接与账户权限。');
  const country = String(profile.countryCode || '').toUpperCase().replace(/^GB$/, 'UK');
  if (country !== code || profile.currencyCode !== mp.currency) throw new Error('广告 profile 的国家或币种与指定站点不一致。');
  const accountType = String(profile.accountInfo?.type || '').toLowerCase();
  if (!['seller', 'vendor', 'kdp'].includes(accountType)) throw new Error(`广告账户类型 ${accountType || '未知'} 尚未验证可用于 SP 创建。`);
  return { accountType, currency: mp.currency, countryCode: country };
}
function normalizeProducts(c, accountType) {
  if (!Array.isArray(c.products) || !c.products.length || c.products.length > 20) throw new Error('products 必须包含 1–20 个商品；卖家用 {sku}，Vendor/KDP 用 {asin}。');
  const seen = new Set();
  return c.products.map((p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('每个商品必须是 {sku} 或 {asin} 对象。');
    if (!!p.sku === !!p.asin) throw new Error('每个商品只能提供 sku 或 asin 其中之一。');
    const productIdType = p.sku ? 'SKU' : 'ASIN';
    const productId = textValue(p.sku || p.asin, productIdType, 256);
    if (accountType === 'seller' && productIdType !== 'SKU') throw new Error('卖家广告账户请用 SKU，以免同 ASIN 多个报价关联错误。');
    if (accountType !== 'seller' && productIdType !== 'ASIN') throw new Error('Vendor/KDP 广告账户请用 ASIN。');
    if (productIdType === 'ASIN' && !/^[A-Z0-9]{10}$/.test(productId)) throw new Error('ASIN 必须是 10 位大写字母或数字。');
    const key = `${productIdType}:${productId}`;
    if (seen.has(key)) throw new Error(`products 中重复商品 ${productId}。`);
    seen.add(key);
    return { productIdType, productId };
  });
}
function namesFilter(name) { return { nameFilter: { include: [name], queryTermMatchType: 'EXACT_MATCH' } }; }
async function duplicates(store, profileId, mode, c, products) {
  if (mode === 'campaign') return (await queryAll(store, profileId, 'campaigns')).filter((x) => nameKey(x.name) === nameKey(c.campaignName)).map((x) => ({ campaignId: x.campaignId, name: x.name, state: x.state }));
  if (mode === 'adGroup') return (await queryAll(store, profileId, 'adGroups', { campaignIdFilter: { include: [String(c.campaignId)] } })).filter((x) => nameKey(x.name) === nameKey(c.adGroupName)).map((x) => ({ adGroupId: x.adGroupId, name: x.name, state: x.state }));
  return (await queryAll(store, profileId, 'ads', { adGroupIdFilter: { include: [String(c.adGroupId)] } })).filter((x) => products.some((p) => productOf(x)?.productId === p.productId && productOf(x)?.productIdType === p.productIdType)).map((x) => ({ adId: x.adId, product: productOf(x), state: x.state }));
}
function stamp(value, creationKey) { return { ...value, tags: [{ key: TAG, value: creationKey }] }; }
function responseError(response) {
  return (response?.error || []).flatMap((e) => e.errors || []).map((e) => `${e.code || ''} ${e.message || ''}`.trim()).join('; ');
}
function explicitRejection(e) { return e instanceof HttpError && e.status >= 400 && e.status < 500; }

const createSP = {
  id: 'ads.sp.campaign.create', group: GROUP, label: '新建广告活动 / 广告组 / 广告商品', risk: '高', implemented: true, channel: 'ads', creates: true, api: 'Ads API v1', capability: 'api',
  requirements: '已授权的单站点 SP 广告 profile；campaign edit / creatives edit 权限；卖家商品须具备广告资格。',
  limitation: '全部新对象保持暂停；手动活动需另加投放。API 创建成功不代表商品可投放；部分成功或未知只核验，不自动重建。',
  params: { mode: 'campaign（默认整链）/ adGroup / ads', campaignName: '新活动名称', campaignId: 'adGroup 模式的已有活动 ID', adGroupId: 'ads 模式的已有广告组 ID', adGroupName: '新广告组名称', dailyBudget: '新活动日预算', defaultBid: '新广告组默认竞价', targetingType: 'MANUAL / AUTO（新活动必填）', startDateTime: 'ISO 日期时间，含时区；新活动必填', endDateTime: '可选结束日期时间', bidStrategy: 'MANUAL / SALES_DOWN_ONLY / SALES_UP_AND_DOWN；默认 SALES_DOWN_ONLY', placementBidAdjustments: '可选 [{placement,percentage}]', products: '1–20 个 {sku}（seller）或 {asin}（vendor/KDP）' },
  creationIdentity(c) {
    const mode = modeOf(c);
    if (mode === 'campaign') return { mode, name: nameKey(c.campaignName) };
    if (mode === 'adGroup') return { mode, campaignId: String(c.campaignId || ''), name: nameKey(c.adGroupName) };
    return { mode, adGroupId: String(c.adGroupId || '') };
  },
  async read(store, c) {
    const mode = modeOf(c); const { profileId, code } = profileFor(store, c.marketplace);
    if (mode === 'campaign') textValue(c.campaignName, 'campaignName');
    if (mode !== 'ads') textValue(c.adGroupName, 'adGroupName');
    const eligibility = await profileInfo(store, code, profileId);
    const products = normalizeProducts(c, eligibility.accountType);
    let parent = null;
    if (mode === 'adGroup') {
      textValue(c.campaignId, 'campaignId');
      const p = usable(await findById(store, profileId, 'campaigns', c.campaignId), '活动');
      parent = { campaignId: String(p.campaignId), state: p.state };
    }
    if (mode === 'ads') {
      textValue(c.adGroupId, 'adGroupId');
      const g = usable(await findById(store, profileId, 'adGroups', c.adGroupId), '广告组');
      const p = usable(await findById(store, profileId, 'campaigns', g.campaignId), '活动');
      if (c.campaignId && String(c.campaignId) !== String(g.campaignId)) throw new Error('adGroupId 不属于 campaignId。');
      parent = { campaignId: String(p.campaignId), campaignState: p.state, adGroupId: String(g.adGroupId), state: g.state };
    }
    const duplicate = await duplicates(store, profileId, mode, c, products);
    return { profileId, marketplace: code, entity: { name: c.campaignName || c.adGroupName || c.adGroupId, eligibility, products, parent, duplicate }, old: { parent, duplicate } };
  },
  check(c, r) {
    const mode = modeOf(c);
    if (r.entity.duplicate.length) throw new Error('已有同名活动/广告组或同组同商品（包括归档对象），停止重复创建；请核对原提案与对象 ID。');
    if (c.state && c.state !== 'PAUSED') throw new Error('新建流程只接受 PAUSED；启用须另出精确提案。');
    const value = { mode, state: 'PAUSED', products: r.entity.products, creationKey: crypto.randomUUID(), currency: r.entity.eligibility.currency, parent: r.entity.parent };
    if (mode !== 'ads') Object.assign(value, { adGroupName: textValue(c.adGroupName, 'adGroupName'), defaultBid: amount(c.defaultBid, 'defaultBid') });
    if (mode === 'campaign') {
      if (!['AUTO', 'MANUAL'].includes(c.targetingType)) throw new Error('新活动必须明确 targetingType=AUTO 或 MANUAL。');
      const strategy = c.bidStrategy || 'SALES_DOWN_ONLY';
      if (!STRATEGIES.includes(strategy)) throw new Error(`bidStrategy 仅支持 ${STRATEGIES.join(' / ')}；规则竞价需要额外资格和规则配置。`);
      const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
      if (!validDate(c.startDateTime)) throw new Error('startDateTime 必须是含时区的 ISO 日期时间。');
      if (c.endDateTime && (!validDate(c.endDateTime) || Date.parse(c.endDateTime) <= Date.parse(c.startDateTime))) throw new Error('endDateTime 必须晚于 startDateTime，且含时区。');
      Object.assign(value, { campaignName: textValue(c.campaignName, 'campaignName'), dailyBudget: amount(c.dailyBudget, 'dailyBudget'), targetingType: c.targetingType, startDateTime: c.startDateTime, bidStrategy: strategy, placementBidAdjustments: placementValues(c.placementBidAdjustments || []) });
      if (c.endDateTime) value.endDateTime = c.endDateTime;
    }
    const warnings = ['仅核实当前 profile 可读取；写权限、商品资格和收费状态以亚马逊实际回执为准。所有新对象保持暂停。'];
    if (c.targetingType === 'MANUAL') warnings.push('手动活动在另行新增关键词/商品投放并批准启用前不会获得流量。');
    return { newValue: value, warnings };
  },
  build(c, r, v) {
    const req = { workflow: 'sp-create', profileId: r.profileId, marketplace: r.marketplace, approved: clone(v), steps: [] };
    const add = (stage, resource, value) => req.steps.push({ stage, resource, value: stamp(value, v.creationKey) });
    if (v.mode === 'campaign') add('campaign', 'campaigns', {
      adProduct: SP, state: 'PAUSED', name: v.campaignName, marketplaceScope: 'SINGLE_MARKETPLACE', marketplaces: [r.marketplace === 'UK' ? 'GB' : r.marketplace],
      autoCreationSettings: { autoCreateTargets: v.targetingType === 'AUTO', autoManageCampaign: false }, startDateTime: v.startDateTime, ...(v.endDateTime ? { endDateTime: v.endDateTime } : {}),
      budgets: [{ budgetType: 'MONETARY', recurrenceTimePeriod: 'DAILY', budgetValue: { monetaryBudgetValue: { monetaryBudget: { value: v.dailyBudget } } } }],
      optimizations: { bidSettings: { bidStrategy: v.bidStrategy, bidAdjustments: { placementBidAdjustments: v.placementBidAdjustments } } },
    });
    if (v.mode !== 'ads') add('adGroup', 'adGroups', { adProduct: SP, state: 'PAUSED', campaignId: v.parent?.campaignId || '$campaignId', name: v.adGroupName, bid: { defaultBid: v.defaultBid } });
    v.products.forEach((product, index) => add(`ad:${index}`, 'ads', { adProduct: SP, state: 'PAUSED', adType: 'PRODUCT_AD', adGroupId: v.parent?.adGroupId || '$adGroupId', creative: { productCreative: { productCreativeSettings: { advertisedProduct: product } } } }));
    return req;
  },
  async send(store, req, { checkpoint, sendResult } = {}) {
    if (sendResult?.steps?.length) return { ...sendResult, ok: false, status: 'OUTCOME_UNKNOWN', note: '已有执行记录，只允许回读，不重发。' };
    if (typeof checkpoint !== 'function') throw new Error('创建流程需要持久化 checkpoint；未提供时禁止写入。');
    const v = req.approved;
    const c = { ...v, campaignId: v.parent?.campaignId, adGroupId: v.parent?.adGroupId };
    if ((await duplicates(store, req.profileId, v.mode, c, v.products)).length) return { ok: false, status: 'FAILED', error: '提交前发现重复对象，未发送创建请求。', createdIds: {}, steps: [] };
    const result = { ok: false, status: 'OUTCOME_UNKNOWN', profileId: req.profileId, marketplace: req.marketplace, creationKey: v.creationKey, createdIds: { ...v.parent, adIds: [] }, steps: [] };
    // parent state is not an object ID; keep the persisted ID map unambiguous.
    delete result.createdIds.state; delete result.createdIds.campaignState;
    for (const step of req.steps) {
      const value = clone(step.value);
      if (value.campaignId === '$campaignId') value.campaignId = result.createdIds.campaignId;
      if (value.adGroupId === '$adGroupId') value.adGroupId = result.createdIds.adGroupId;
      const progress = { stage: step.stage, resource: step.resource, status: 'OUTCOME_UNKNOWN', value };
      result.stage = step.stage; result.steps.push(progress);
      // Persist before crossing the network boundary. A crash now is conservatively unknown.
      await checkpoint(clone(result));
      let response;
      try {
        response = await ads(store.alias, 'POST', `/adsApi/v1/create/${step.resource}`, { profileId: req.profileId, body: { [step.resource]: [value] }, isWrite: true });
      } catch (e) {
        progress.status = explicitRejection(e) ? 'FAILED' : 'OUTCOME_UNKNOWN'; progress.error = e.message;
        result.status = progress.status === 'FAILED' ? (result.steps.some((s) => s.status === 'SUBMITTED') ? 'PARTIALLY_SUCCEEDED' : 'FAILED') : 'OUTCOME_UNKNOWN';
        result.error = e.message; await checkpoint(clone(result)); return result;
      }
      const singular = SINGLE[step.resource]; const field = `${singular}Id`;
      const successes = (response?.success || []).filter((s) => s.index === 0 && s[singular]?.[field]);
      const errors = responseError(response);
      if (successes.length === 1) {
        const id = String(successes[0][singular][field]); progress.id = id;
        if (step.resource === 'ads') result.createdIds.adIds.push(id); else result.createdIds[field] = id;
      }
      const rejected = !successes.length && response?.error?.length === 1 && response.error[0].index === 0 && response.error[0].errors?.length && !response.error[0].errors.some((e) => ['INTERNAL_ERROR', 'CONFLICT', 'TOO_MANY_REQUESTS'].includes(e.code));
      if (successes.length !== 1 || response?.success?.length !== 1 || response?.error?.length || errors) {
        progress.status = rejected ? 'FAILED' : 'OUTCOME_UNKNOWN'; progress.error = errors || '响应缺少唯一的新对象 ID，结果未知。';
        result.status = rejected ? (result.steps.some((s) => s.status === 'SUBMITTED') ? 'PARTIALLY_SUCCEEDED' : 'FAILED') : 'OUTCOME_UNKNOWN';
        result.error = progress.error; await checkpoint(clone(result)); return result;
      }
      progress.status = 'SUBMITTED'; await checkpoint(clone(result));
    }
    result.ok = true; result.status = 'SUBMITTED'; result.stage = 'complete';
    await checkpoint(clone(result)); return result;
  },
  async readback(store, c, expected, sendResult) {
    const { profileId } = profileFor(store, c.marketplace);
    const ids = { ...(expected.parent || {}), ...(sendResult?.createdIds || {}) }; const actual = { campaign: null, adGroup: null, ads: [] }; const notes = [];
    const unique = (items, description) => { if (items.length > 1) notes.push(`${description}匹配多个对象，需人工核对。`); return items.length === 1 ? items[0] : null; };
    let ok = true; const verifiedStages = new Set();
    if (expected.mode === 'campaign') {
      const items = ids.campaignId ? [await findById(store, profileId, 'campaigns', ids.campaignId)].filter(Boolean) : (await queryAll(store, profileId, 'campaigns', namesFilter(expected.campaignName))).filter((x) => hasTag(x, expected.creationKey));
      const item = unique(items, '活动'); actual.campaign = item || null;
      if (item) ids.campaignId = String(item.campaignId);
      const money = item?.budgets?.[0];
      const matches = !!item && hasTag(item, expected.creationKey) && item.name === expected.campaignName && item.state === 'PAUSED' && item.adProduct === SP && item.marketplaceScope === 'SINGLE_MARKETPLACE'
        && same(item.marketplaces, [String(c.marketplace || store.defaultMarketplace).toUpperCase().replace(/^UK$/, 'GB')])
        && money?.recurrenceTimePeriod === 'DAILY' && money?.budgetType === 'MONETARY' && money?.budgetValue?.monetaryBudgetValue?.monetaryBudget?.value === expected.dailyBudget
        && item.autoCreationSettings?.autoCreateTargets === (expected.targetingType === 'AUTO') && item.autoCreationSettings?.autoManageCampaign !== true
        && Date.parse(item.startDateTime) === Date.parse(expected.startDateTime) && (!expected.endDateTime ? !item.endDateTime : Date.parse(item.endDateTime) === Date.parse(expected.endDateTime))
        && same(semanticBids(bidSettingsOf(item)), semanticBids({ bidStrategy: expected.bidStrategy, bidAdjustments: { placementBidAdjustments: expected.placementBidAdjustments } }));
      if (matches) verifiedStages.add('campaign'); else ok = false;
    }
    if (expected.mode !== 'ads') {
      const items = ids.adGroupId ? [await findById(store, profileId, 'adGroups', ids.adGroupId)].filter(Boolean) : ids.campaignId ? (await queryAll(store, profileId, 'adGroups', { campaignIdFilter: { include: [ids.campaignId] }, ...namesFilter(expected.adGroupName) })).filter((x) => hasTag(x, expected.creationKey)) : [];
      const item = unique(items, '广告组'); actual.adGroup = item || null;
      if (item) ids.adGroupId = String(item.adGroupId);
      const matches = !!item && hasTag(item, expected.creationKey) && item.name === expected.adGroupName && item.state === 'PAUSED' && item.adProduct === SP && String(item.campaignId) === ids.campaignId && item.bid?.defaultBid === expected.defaultBid;
      if (matches) verifiedStages.add('adGroup'); else ok = false;
    }
    const adsInGroup = ids.adGroupId ? await queryAll(store, profileId, 'ads', { adGroupIdFilter: { include: [ids.adGroupId] } }) : [];
    expected.products.forEach((product, i) => {
      const known = sendResult?.steps?.find((s) => s.stage === `ad:${i}`)?.id;
      const item = unique(adsInGroup.filter((x) => known ? String(x.adId) === known : hasTag(x, expected.creationKey) && productOf(x)?.productId === product.productId && productOf(x)?.productIdType === product.productIdType), `商品 ${product.productId}`);
      actual.ads.push(item || null);
      const matches = !!item && hasTag(item, expected.creationKey) && item.state === 'PAUSED' && item.adProduct === SP && item.adType === 'PRODUCT_AD' && String(item.adGroupId) === ids.adGroupId && productOf(item)?.productId === product.productId && productOf(item)?.productIdType === product.productIdType;
      if (matches) verifiedStages.add(`ad:${i}`); else ok = false;
    });
    if (ok) return { actual, match: true, reconciled: true, status: 'API_STATE_VERIFIED', note: '全部创建对象与批准值一致，状态均为暂停；不代表广告已启用或商品已具备投放资格。' };
    const reconciled = !!sendResult?.steps?.length && sendResult.steps.every((s) => s.status === 'FAILED' || verifiedStages.has(s.stage));
    const failed = sendResult?.steps?.some((s) => s.status === 'FAILED');
    return { actual, match: false, reconciled, status: reconciled ? (verifiedStages.size ? 'PARTIALLY_SUCCEEDED' : 'FAILED') : failed ? (sendResult.steps.some((s) => s.id) ? 'PARTIALLY_SUCCEEDED' : 'FAILED') : 'OUTCOME_UNKNOWN', note: [...notes, '创建尚未全部核验一致。保留已知 ID；不能因暂时查不到而判定失败或重复提交。已明确拒绝或确认未尝试的剩余步骤，可核对后用已有父级 ID 重新提案。'].join(' ') };
  },
};

const placementSP = {
  id: 'ads.sp.placement', group: GROUP, label: '修改竞价策略与广告位加价', risk: '高', implemented: true, channel: 'ads', api: 'Ads API v1', capability: 'api',
  requirements: '指定 SP 活动及广告编辑权限；广告位可用性以账户/站点回执为准。',
  limitation: '支持固定、只降低、提高和降低三种策略；不创建 RULE_BASED 规则竞价。保留未修改的广告位及受众/创意加价。',
  params: { campaignId: 'SP 活动 ID', bidStrategy: '可选 MANUAL / SALES_DOWN_ONLY / SALES_UP_AND_DOWN', placementBidAdjustments: '可选 [{placement, percentage: 0–900}]；仅修改列出的广告位，其余保留' },
  async read(store, c) {
    const { profileId, code } = profileFor(store, c.marketplace); textValue(c.campaignId, 'campaignId');
    if (marketplace(code).region !== store.region) throw new Error('指定站点与广告区域不一致。');
    const item = usable(await findById(store, profileId, 'campaigns', c.campaignId), '活动');
    const old = bidSettingsOf(item);
    if (!old.bidStrategy) throw new Error('读不到当前竞价策略，不能安全保留其他竞价设置。');
    return { profileId, marketplace: code, entity: { name: item.name }, old };
  },
  check(c, r, limits = {}) {
    if (c.bidStrategy === undefined && c.placementBidAdjustments === undefined) throw new Error('至少提供 bidStrategy 或 placementBidAdjustments。');
    if (c.bidStrategy !== undefined && !STRATEGIES.includes(c.bidStrategy)) throw new Error(`bidStrategy 仅支持 ${STRATEGIES.join(' / ')}；RULE_BASED 需另行核实资格和规则。`);
    const v = clone(r.old); const warnings = [];
    if (c.bidStrategy !== undefined) v.bidStrategy = c.bidStrategy;
    if (c.placementBidAdjustments !== undefined) {
      const changes = placementValues(c.placementBidAdjustments);
      if (!changes.length) throw new Error('要清零加价，请明确列出广告位并设置 percentage: 0。');
      const current = new Map(v.bidAdjustments.placementBidAdjustments.map((x) => [x.placement, x.percentage]));
      for (const p of changes) {
        const before = current.get(p.placement) || 0;
        const pct = ((100 + p.percentage) / (100 + before) - 1) * 100;
        if (Number.isFinite(limits.bidChangePctMax) && Math.abs(pct) > limits.bidChangePctMax + 1e-9) throw new Error(`广告位 ${p.placement} 的竞价倍数改动 ${pct.toFixed(1)}% 超过安全上限 ±${limits.bidChangePctMax}%。`);
        current.set(p.placement, p.percentage);
      }
      v.bidAdjustments.placementBidAdjustments = [...current].map(([placement, percentage]) => ({ placement, percentage })).sort((a, b) => a.placement.localeCompare(b.placement));
    }
    if (same(semanticBids(r.old), semanticBids(v))) throw new Error('新设置和当前设置一致，无需修改。');
    if (v.bidStrategy === 'SALES_UP_AND_DOWN') warnings.push('动态提高/降低竞价可与广告位加价叠加；这次未改基础竞价。');
    warnings.push('仅修改列出的广告位；没有列出的广告位及受众/创意加价按读取值保留。');
    return { newValue: v, warnings };
  },
  build(c, r, v) { return { method: 'POST', path: '/adsApi/v1/update/campaigns', profileId: r.profileId, contentType: 'application/json', body: { campaigns: [{ campaignId: String(c.campaignId), optimizations: { bidSettings: v } }] } }; },
  async send(store, req) {
    const response = await ads(store.alias, req.method, req.path, { profileId: req.profileId, contentType: req.contentType, body: req.body, isWrite: true });
    const error = responseError(response);
    const ok = !error && response?.success?.length === 1 && response.success[0].index === 0 && String(response.success[0].campaign?.campaignId) === req.body.campaigns[0].campaignId;
    const rejected = response?.error?.length === 1 && response.error[0].index === 0 && !response?.success?.length && response.error[0].errors?.length && !response.error[0].errors.some((e) => ['INTERNAL_ERROR', 'CONFLICT'].includes(e.code));
    return { ok, status: ok ? 'SUBMITTED' : rejected ? 'FAILED' : 'OUTCOME_UNKNOWN', error: error || (ok ? null : '缺少对应活动成功回执，结果未知。'), response };
  },
  async readback(store, c, expected) {
    const r = await this.read(store, c);
    return { actual: r.old, match: same(semanticBids(r.old), semanticBids(expected)) };
  },
};

export const ADS_CREATE_OPS = [createSP, placementSP];
