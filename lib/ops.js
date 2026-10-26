// 写入操作目录：每一项写入能力就是开关面板上的一个“灯”。
// 每项定义：读原值(read) → 校验(check) → 组装请求(build) → 提交(send) → 回读(readback)。
// implemented=false 的项目只在面板里显示为“规划中”，无法打开。
import { ads, profileFor } from './ads.js';
import { HttpError } from './http.js';
import { getListing } from './spapi.js';
import { getStore } from './config.js';
import { marketplace as mp } from './regions.js';
import { CONTENT_OPS } from './ops-content.js';
import { PROMOTION_OP } from './promotions.js';
import { ADS_CREATE_OPS, isDefiniteAdsCreateHttpRejection } from './ops-ads-create.js';
import { ADS_BUDGET_OPS } from './ops-ads-budget.js';
import { createListingAttributeOperation } from './ops-listing.js';
import { CAMPAIGN_NAME_OP } from './ops-ads-campaign-name.js';

const STATES = ['ENABLED', 'PAUSED'];

function pctChange(oldV, newV) {
  if (oldV === null || oldV === undefined || Number(oldV) === 0) return null;
  return ((Number(newV) - Number(oldV)) / Number(oldV)) * 100;
}

function needNumber(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`${name} 必须是大于 0 的 JSON 数字，收到：${v}`);
  const n = v;
  const rounded = Math.round(n * 100) / 100;
  if (!Number.isFinite(rounded) || rounded <= 0) throw new Error(`${name} 保留两位小数后必须是大于 0 的有限数字，收到：${v}`);
  return rounded;
}

function needState(v) {
  const s = String(v || '').toUpperCase();
  if (!STATES.includes(s)) throw new Error(`状态只能是 ENABLED（开启）或 PAUSED（暂停），收到：${v}。归档不可逆，本工具不提供。`);
  return s;
}

// ---------- 广告 v1 统一接口：修改已有对象的一个字段 ----------
// 依据官方 OpenAPI（amzn/ads-advanced-tools-docs, unified-api-sp/sb.json）：
//   POST /adsApi/v1/query/{resource}   body: { adProductFilter, {id}Filter }
//   POST /adsApi/v1/update/{resource}  body: { {resource}: [ { {id}, 字段 } ] } → 207 { success:[{index, <单数资源名>}], error:[...] }
//   活动预算：budgets[].budgetValue.monetaryBudgetValue.monetaryBudget.value
//   广告组默认竞价：读 bid.defaultBid，改 bid: { defaultBid }
//   投放（关键词/商品/自动）竞价：读 bid.bid，改 bid: { bid }
const AD_PRODUCTS = { SP: 'SPONSORED_PRODUCTS', SB: 'SPONSORED_BRANDS' };
const SINGULAR = { campaigns: 'campaign', adGroups: 'adGroup', ads: 'ad', targets: 'target' };

function budgetOf(obj) {
  const b = (obj?.budgets || [])[0];
  return { value: b?.budgetValue?.monetaryBudgetValue?.monetaryBudget?.value ?? null, recurrence: b?.recurrenceTimePeriod || null, currency: b?.budgetValue?.monetaryBudgetValue?.monetaryBudget?.currencyCode || null };
}

function unifiedErrors(resp) {
  const errs = resp?.error || [];
  if (!errs.length) return null;
  return errs.map((e) => (e.errors || []).map((x) => `${x.code || ''} ${x.message || ''}${x.fieldLocation ? ` (${x.fieldLocation})` : ''}`.trim()).join('; ')).join(' | ');
}

function unifiedUpdate({ id, group, label, risk, adProduct, resource, idField, kind }) {
  const getVal = (obj) => {
    if (!obj) return undefined;
    if (kind === 'state') return obj.state;
    if (kind === 'budget') return budgetOf(obj).value;
    if (kind === 'adGroupBid') return obj.bid?.defaultBid ?? null;
    if (kind === 'targetBid') return obj.bid?.bid ?? null;
    return undefined;
  };
  const idOf = (c) => String(c[idField] ?? c.id ?? '');
  return {
    id, group, label, risk, implemented: true, channel: 'ads', api: 'Ads API v1',
    params: { [idField]: '对象 ID', value: kind === 'state' ? 'ENABLED / PAUSED' : '新数值（站点币种）' },
    async read(store, c) {
      const { profileId, code } = profileFor(store, c.marketplace);
      if (!idOf(c)) throw new Error(`缺少 ${idField}`);
      const resp = await ads(store.alias, 'POST', `/adsApi/v1/query/${resource}`, {
        profileId, body: { adProductFilter: { include: [AD_PRODUCTS[adProduct]] }, [`${idField}Filter`]: { include: [idOf(c)] }, maxResults: 10 },
      });
      const obj = (resp?.[resource] || []).find((o) => String(o[idField]) === idOf(c));
      if (!obj) throw new Error(`没找到 ${adProduct} 对象 ${idField}=${idOf(c)}（站点 ${code}）。`);
      if (String(obj.state).toUpperCase() === 'ARCHIVED') throw new Error('对象已归档，不能修改。');
      if (kind === 'targetBid' && obj.negative) throw new Error('这是否定投放，没有竞价可改。');
      if (kind === 'budget' && budgetOf(obj).recurrence !== 'DAILY') throw new Error(`这个活动的预算周期为 ${budgetOf(obj).recurrence || '未知'}，为安全起见只支持修改已确认的日预算。`);
      return { profileId, marketplace: code, entity: { name: obj.name, currency: kind === 'budget' ? budgetOf(obj).currency : obj.bid?.currencyCode }, old: getVal(obj) };
    },
    check(c, r, limits) {
      const newV = kind === 'state' ? needState(c.value) : needNumber(c.value, label);
      const warn = [];
      if (kind !== 'state') {
        const pct = pctChange(r.old, newV);
        const max = kind === 'budget' ? limits.budgetChangePctMax : limits.bidChangePctMax;
        if (pct !== null && Math.abs(pct) > max) throw new Error(`改动幅度 ${pct.toFixed(1)}% 超过安全上限 ±${max}%（可在开关面板“安全上限”里调整）。`);
        if (pct === null) warn.push('原值为空或为 0，无法计算改动幅度。');
      }
      const same = kind === 'state' ? String(r.old).toUpperCase() === newV : Number(r.old) === newV;
      if (same) throw new Error('新值和当前值一样，不需要改。');
      return { newValue: newV, warnings: warn };
    },
    build(c, r, newV) {
      const item = { [idField]: idOf(c) };
      if (kind === 'state') item.state = newV;
      if (kind === 'budget') item.budgets = [{ budgetType: 'MONETARY', recurrenceTimePeriod: 'DAILY', budgetValue: { monetaryBudgetValue: { monetaryBudget: { value: newV } } } }];
      if (kind === 'adGroupBid') item.bid = { defaultBid: newV };
      if (kind === 'targetBid') item.bid = { bid: newV };
      return { method: 'POST', path: `/adsApi/v1/update/${resource}`, contentType: 'application/json', body: { [resource]: [item] }, profileId: r.profileId };
    },
    async send(store, req) {
      const resp = await ads(store.alias, req.method, req.path, { profileId: req.profileId, contentType: req.contentType, body: req.body, isWrite: true });
      const err = unifiedErrors(resp);
      const ok = !err && (resp?.success || []).length > 0;
      return { ok, error: err || (ok ? null : `没有成功回执：${JSON.stringify(resp).slice(0, 300)}`), response: resp };
    },
    async readback(store, c, expected) {
      const r = await this.read(store, c);
      const match = kind === 'state' ? String(r.old).toUpperCase() === String(expected).toUpperCase() : Number(r.old) === Number(expected);
      return { actual: r.old, match };
    },
  };
}

// ---------- SD（官方尚未发布统一接口迁移资料，暂用原 SD 接口：数组请求、小写状态） ----------
function sdUpdate({ id, label, risk, entity, field, kind }) {
  const base = entity === 'campaign' ? '/sd/campaigns' : '/sd/targets';
  const idField = entity === 'campaign' ? 'campaignId' : 'targetId';
  return {
    id, group: '广告 · SD 展示型', label, risk, implemented: true, channel: 'ads', beta: true, api: 'SD 原接口',
    params: { [idField]: '对象 ID', value: kind === 'state' ? 'ENABLED / PAUSED' : '新数值' },
    async read(store, c) {
      const { profileId, code } = profileFor(store, c.marketplace);
      const oid = String(c[idField] ?? c.id);
      const obj = await ads(store.alias, 'GET', `${base}/${encodeURIComponent(oid)}`, { profileId });
      if (!obj) throw new Error(`没找到 SD 对象 ${oid}`);
      if (String(obj.state).toLowerCase() === 'archived') throw new Error('对象已归档，不能修改。');
      const old = kind === 'state' ? String(obj.state).toUpperCase() : obj[field];
      return { profileId, marketplace: code, entity: { name: obj.name }, old };
    },
    check(c, r, limits) {
      const newV = kind === 'state' ? needState(c.value) : needNumber(c.value, label);
      if (kind !== 'state') {
        const pct = pctChange(r.old, newV);
        const max = field === 'budget' ? limits.budgetChangePctMax : limits.bidChangePctMax;
        if (pct !== null && Math.abs(pct) > max) throw new Error(`改动幅度 ${pct.toFixed(1)}% 超过安全上限 ±${max}%。`);
      }
      if (String(r.old) === String(newV)) throw new Error('新值和当前值一样，不需要改。');
      return { newValue: newV, warnings: ['SD 暂用原接口（官方尚未发布 SD 统一接口迁移资料）。'] };
    },
    build(c, r, newV) {
      const item = { [idField]: Number(c[idField] ?? c.id) };
      item[field] = kind === 'state' ? String(newV).toLowerCase() : newV;
      return { method: 'PUT', path: base, contentType: 'application/json', body: [item], profileId: r.profileId };
    },
    async send(store, req) {
      const resp = await ads(store.alias, req.method, req.path, { profileId: req.profileId, contentType: req.contentType, body: req.body, isWrite: true });
      const bad = (Array.isArray(resp) ? resp : []).filter((x) => x.code && x.code !== 'SUCCESS');
      return { ok: bad.length === 0, error: bad.length ? JSON.stringify(bad) : null, response: resp };
    },
    async readback(store, c, expected) {
      const r = await this.read(store, c);
      const match = kind === 'state' ? String(r.old).toUpperCase() === String(expected).toUpperCase() : Number(r.old) === Number(expected);
      return { actual: r.old, match };
    },
  };
}

// ---------- SP 新增关键词 / 否定关键词（v1：统一走 /targets） ----------
function spCreateKeyword({ id, label, risk, negative }) {
  const matchTypes = ['EXACT', 'PHRASE', ...(negative ? [] : ['BROAD'])];
  const normMatch = (m) => String(m || '').toUpperCase().replace(/^NEGATIVE_/, '');
  const keywordKey = (s) => String(s || '').trim().toLowerCase();
  return {
    id, group: '广告 · SP 商品推广', label, risk, implemented: true, channel: 'ads', creates: true, api: 'Ads API v1',
    params: negative
      ? { adGroupId: '广告组 ID（广告组级否定）', campaignId: '只填活动 ID 不填广告组 = 活动级否定', keywordText: '关键词', matchType: 'EXACT / PHRASE' }
      : { adGroupId: '广告组 ID', keywordText: '关键词', matchType: 'EXACT / PHRASE / BROAD', bid: '竞价' },
    creationIdentity(c) {
      return { level: c.adGroupId ? 'adGroup' : 'campaign', parentId: String(c.adGroupId || c.campaignId), keyword: keywordKey(c.keywordText), matchType: normMatch(c.matchType) };
    },
    async read(store, c) {
      const { profileId, code } = profileFor(store, c.marketplace);
      if (!c.keywordText || !c.matchType) throw new Error('缺少 keywordText 或 matchType');
      if (!c.adGroupId && !(negative && c.campaignId)) throw new Error(negative ? '需要 adGroupId（广告组级）或 campaignId（活动级）' : '需要 adGroupId');
      let groupName = null;
      if (c.adGroupId) {
        const ag = await ads(store.alias, 'POST', '/adsApi/v1/query/adGroups', {
          profileId, body: { adProductFilter: { include: ['SPONSORED_PRODUCTS'] }, adGroupIdFilter: { include: [String(c.adGroupId)] } },
        });
        const group = (ag?.adGroups || [])[0];
        if (!group) throw new Error(`没找到广告组 ${c.adGroupId}`);
        if (c.campaignId && String(group.campaignId) !== String(c.campaignId)) throw new Error('广告组不属于这个广告活动，请核对 ID。');
        groupName = group.name;
      }
      const scope = c.adGroupId ? { adGroupIdFilter: { include: [String(c.adGroupId)] } } : { campaignIdFilter: { include: [String(c.campaignId)] } };
      const targets = []; const tokens = new Set(); let nextToken;
      for (let page = 0; ; page++) {
        if (page >= 1000) throw new Error('关键词查询超过 1000 页，未完成重复检查，停止创建。');
        const existing = await ads(store.alias, 'POST', '/adsApi/v1/query/targets', {
          profileId, body: { adProductFilter: { include: ['SPONSORED_PRODUCTS'] }, ...scope, targetTypeFilter: { include: ['KEYWORD'] }, negativeFilter: { include: [negative] }, maxResults: 5000, ...(nextToken ? { nextToken } : {}) },
        });
        if (!Array.isArray(existing?.targets)) throw new Error('无法完整读取关键词，停止创建。');
        targets.push(...existing.targets); nextToken = existing.nextToken;
        if (!nextToken) break;
        if (tokens.has(nextToken)) throw new Error('关键词查询分页令牌循环，未完成重复检查，停止创建。');
        tokens.add(nextToken);
      }
      const mt = normMatch(c.matchType);
      const dup = targets.find((t) => {
        const kw = t.targetDetails?.keywordTarget;
        const sameLevel = c.adGroupId ? String(t.adGroupId) === String(c.adGroupId) : !t.adGroupId;
        return sameLevel && kw && keywordKey(kw.keyword) === keywordKey(c.keywordText) && kw.matchType === mt && t.state !== 'ARCHIVED';
      });
      return { profileId, marketplace: code, entity: { adGroup: groupName, level: c.adGroupId ? '广告组' : '活动', duplicate: dup || null }, old: dup ? `已存在（${dup.state}）` : null };
    },
    check(c, r) {
      if (r.entity.duplicate) throw new Error('同一位置已有相同的词和匹配方式，不需要重复添加。');
      const mt = normMatch(c.matchType);
      if (!matchTypes.includes(mt)) throw new Error(`匹配方式只能是 ${matchTypes.join('/')}`);
      const value = { keywordText: String(c.keywordText).trim(), matchType: mt, state: 'ENABLED' };
      if (!negative) value.bid = needNumber(c.bid, '竞价');
      return { newValue: value, warnings: [negative
        ? '新建否定关键词状态为 ENABLED（启用），会排除对应匹配流量。'
        : '新建关键词状态为 ENABLED（启用）；所属活动和广告组满足投放条件时可能产生花费。'] };
    },
    build(c, r, v) {
      const item = {
        adProduct: 'SPONSORED_PRODUCTS', state: 'ENABLED', negative, targetType: 'KEYWORD',
        targetDetails: { keywordTarget: { keyword: v.keywordText, matchType: v.matchType } },
      };
      if (c.adGroupId) item.adGroupId = String(c.adGroupId); else item.campaignId = String(c.campaignId);
      if (!negative) item.bid = { bid: v.bid };
      return { method: 'POST', path: '/adsApi/v1/create/targets', contentType: 'application/json', body: { targets: [item] }, profileId: r.profileId };
    },
    async send(store, req) {
      let resp;
      try {
        resp = await ads(store.alias, req.method, req.path, { profileId: req.profileId, contentType: req.contentType, body: req.body, isWrite: true });
      } catch (e) {
        // The generic transport marks HTTP 4xx unsent; a create timeout or
        // conflict or unknown status does not establish rejection; retain the duplicate lock.
        if (e instanceof HttpError && !isDefiniteAdsCreateHttpRejection(e)) return { ok: false, status: 'OUTCOME_UNKNOWN', error: e.message, createdIds: [] };
        throw e;
      }
      const successes = Array.isArray(resp?.success) ? resp.success : null;
      const errors = Array.isArray(resp?.error) ? resp.error : null;
      const row = successes?.length === 1 && successes[0]?.index === 0 ? successes[0] : null;
      const targetId = row?.target?.targetId;
      const validId = typeof targetId === 'string' ? !!targetId.trim() : typeof targetId === 'number' && Number.isSafeInteger(targetId) && targetId > 0;
      const created = validId ? [String(targetId)] : [];
      const err = (errors || []).flatMap((e) => Array.isArray(e?.errors) ? e.errors : []).map((e) => `${e?.code || ''} ${e?.message || ''}`.trim()).filter(Boolean).join('; ');
      const ok = created.length === 1 && errors?.length === 0;
      const rejected = successes?.length === 0 && errors?.length === 1 && errors[0]?.index === 0
        && Array.isArray(errors[0]?.errors) && errors[0].errors.length > 0
        // Unknown codes cannot prove no object was created. Keep this allowlist
        // limited to confirmed validation rejections instead of excluding a few transient codes.
        && errors[0].errors.every((e) => e?.code === 'INVALID_INPUT');
      return { ok, status: ok ? 'SUBMITTED' : rejected ? 'FAILED' : 'OUTCOME_UNKNOWN', error: err || (ok ? null : '响应缺少唯一的新对象 ID 或完整回执，结果未知；只能先核对，不能重新创建。'), response: resp, createdIds: created };
    },
    async readback(store, c, expected, sendResult) {
      const { profileId } = profileFor(store, c.marketplace);
      const tid = sendResult?.createdIds?.[0];
      if (!tid) return { actual: null, match: false, note: '提交回执里没有新对象 ID，需要人工核对。' };
      const resp = await ads(store.alias, 'POST', '/adsApi/v1/query/targets', {
        profileId, body: { adProductFilter: { include: ['SPONSORED_PRODUCTS'] }, targetIdFilter: { include: [tid] } },
      });
      const t = (resp?.targets || []).find((target) => String(target.targetId) === String(tid));
      const kw = t?.targetDetails?.keywordTarget;
      const scopeMatch = !!t && (c.adGroupId ? String(t.adGroupId) === String(c.adGroupId) : !t.adGroupId && String(t.campaignId) === String(c.campaignId))
        && (!c.campaignId || String(t.campaignId) === String(c.campaignId));
      const match = scopeMatch && t.adProduct === 'SPONSORED_PRODUCTS' && t.targetType === 'KEYWORD'
        && t.state === 'ENABLED' && t.negative === negative
        && !!kw && kw.keyword === expected.keywordText && kw.matchType === expected.matchType
        && (negative || t.bid?.bid === expected.bid);
      return { actual: t ? { targetId: t.targetId, adProduct: t.adProduct, targetType: t.targetType, adGroupId: t.adGroupId, campaignId: t.campaignId, keywordText: kw?.keyword, matchType: kw?.matchType, bid: t.bid?.bid, state: t.state, negative: t.negative } : null, match };
    },
  };
}

// ---------- Listing（SP-API Listings Items） ----------
const listingAttribute = createListingAttributeOperation();

function findOffer(item, marketplaceId) {
  const offers = item?.attributes?.purchasable_offer || [];
  return offers.find((o) => o.marketplace_id === marketplaceId && (!o.audience || o.audience === 'ALL')) || offers.find((o) => o.marketplace_id === marketplaceId);
}

const listingPrice = {
  id: 'listing.price', group: 'Listing', label: '修改售价', risk: '高', implemented: true, channel: 'spapi',
  params: { sku: 'SKU', value: '新售价（站点币种，含税价按站点规则）' },
  async read(store, c) {
    if (!c.sku) throw new Error('缺少 sku');
    const m = mp(c.marketplace || store.defaultMarketplace);
    const item = await getListing(store.alias, c.sku, m.code);
    const productType = item?.summaries?.[0]?.productType;
    if (!productType) throw new Error('读不到这个 SKU 的 productType。');
    const offer = findOffer(item, m.id);
    const old = offer?.our_price?.[0]?.schedule?.[0]?.value_with_tax ?? null;
    return { marketplace: m.code, entity: { sku: c.sku, productType, offer, currency: offer?.currency || m.currency }, old };
  },
  check(c, r, limits) {
    const v = needNumber(c.value, '售价');
    if (!r.entity.offer) throw new Error('这个 SKU 没有现成的报价结构（purchasable_offer），为安全起见不新建，请在后台先设置一次价格。');
    const pct = pctChange(r.old, v);
    if (pct !== null && Math.abs(pct) > limits.priceChangePctMax) throw new Error(`改价幅度 ${pct.toFixed(1)}% 超过安全上限 ±${limits.priceChangePctMax}%。`);
    if (Number(r.old) === v) throw new Error('新价格和当前价格一样。');
    return { newValue: v, warnings: r.entity.offer?.discounted_price ? ['注意：这个 SKU 当前有促销价（discounted_price），本次只改原价。'] : [] };
  },
  build(c, r, v) {
    const offer = structuredClone(r.entity.offer);
    offer.our_price = [{ schedule: [{ value_with_tax: v }] }];
    return { sku: c.sku, marketplace: r.marketplace, productType: r.entity.productType, patches: [{ op: 'replace', path: '/attributes/purchasable_offer', value: [offer] }] };
  },
  preview: listingAttribute.preview,
  send: listingAttribute.send,
  async readback(store, c, expected) {
    const r = await this.read(store, c);
    return { actual: r.old, match: Number(r.old) === Number(expected), note: '价格生效可能有延迟，不一致时稍后再查。' };
  },
};

const listingFbmQty = {
  id: 'listing.fbmQuantity', group: 'Listing', label: '修改自发货（FBM）库存数量', risk: '中', implemented: true, channel: 'spapi',
  params: { sku: 'SKU', value: '新数量（整数，≥0）' },
  async read(store, c) {
    const m = mp(c.marketplace || store.defaultMarketplace);
    const item = await getListing(store.alias, c.sku, m.code);
    const productType = item?.summaries?.[0]?.productType;
    const fa = (item?.fulfillmentAvailability || []);
    const def = fa.find((f) => f.fulfillmentChannelCode === 'DEFAULT');
    if (!def) throw new Error('这个 SKU 不是自发货（没有 DEFAULT 渠道），FBA 库存不能这样改。');
    return { marketplace: m.code, entity: { sku: c.sku, productType }, old: def.quantity ?? null };
  },
  check(c, r) {
    const q = Number(c.value);
    if (!Number.isInteger(q) || q < 0) throw new Error('数量必须是 ≥0 的整数。');
    if (q === r.old) throw new Error('数量没有变化。');
    return { newValue: q, warnings: [] };
  },
  build(c, r, q) {
    return { sku: c.sku, marketplace: r.marketplace, productType: r.entity.productType, patches: [{ op: 'replace', path: '/attributes/fulfillment_availability', value: [{ fulfillment_channel_code: 'DEFAULT', quantity: q }] }] };
  },
  preview: listingAttribute.preview,
  send: listingAttribute.send,
  async readback(store, c, expected) {
    const r = await this.read(store, c);
    return { actual: r.old, match: r.old === expected };
  },
};

// ---------- 紫鸟浏览器控制（单独的开关） ----------
const ziniaoControl = {
  id: 'ziniao.control', group: '紫鸟浏览器', label: '允许通过紫鸟浏览器代为点击/填写', risk: '高', implemented: true, channel: 'ziniao', special: true,
  params: { browserId: '紫鸟店铺 ID', steps: '[{action:"goto"|"click"|"type"|"wait", url/selector/text/ms}]', description: '这一串操作要达成什么' },
};

const SPG = '广告 · SP 商品推广';
const SBG = '广告 · SB 品牌推广';
export const OPS = [
  ...ADS_CREATE_OPS,
  ...ADS_BUDGET_OPS,
  ...CONTENT_OPS,
  PROMOTION_OP,
  CAMPAIGN_NAME_OP,
  unifiedUpdate({ id: 'ads.sp.campaign.state', group: SPG, label: '开启 / 暂停广告活动', risk: '中', adProduct: 'SP', resource: 'campaigns', idField: 'campaignId', kind: 'state' }),
  unifiedUpdate({ id: 'ads.sp.campaign.budget', group: SPG, label: '修改广告活动日预算', risk: '中', adProduct: 'SP', resource: 'campaigns', idField: 'campaignId', kind: 'budget' }),
  unifiedUpdate({ id: 'ads.sp.adGroup.state', group: SPG, label: '开启 / 暂停广告组', risk: '中', adProduct: 'SP', resource: 'adGroups', idField: 'adGroupId', kind: 'state' }),
  unifiedUpdate({ id: 'ads.sp.adGroup.defaultBid', group: SPG, label: '修改广告组默认竞价', risk: '中', adProduct: 'SP', resource: 'adGroups', idField: 'adGroupId', kind: 'adGroupBid' }),
  unifiedUpdate({ id: 'ads.sp.target.bid', group: SPG, label: '修改投放竞价（关键词 / 商品 / 自动）', risk: '中', adProduct: 'SP', resource: 'targets', idField: 'targetId', kind: 'targetBid' }),
  unifiedUpdate({ id: 'ads.sp.target.state', group: SPG, label: '开启 / 暂停投放（关键词 / 商品 / 自动 / 否定）', risk: '低', adProduct: 'SP', resource: 'targets', idField: 'targetId', kind: 'state' }),
  unifiedUpdate({ id: 'ads.sp.ad.state', group: SPG, label: '开启 / 暂停广告商品', risk: '中', adProduct: 'SP', resource: 'ads', idField: 'adId', kind: 'state' }),
  spCreateKeyword({ id: 'ads.sp.keyword.create', label: '新增关键词', risk: '中', negative: false }),
  spCreateKeyword({ id: 'ads.sp.negativeKeyword.create', label: '新增否定关键词（广告组级 / 活动级）', risk: '低', negative: true }),
  unifiedUpdate({ id: 'ads.sb.campaign.state', group: SBG, label: '开启 / 暂停品牌广告活动', risk: '中', adProduct: 'SB', resource: 'campaigns', idField: 'campaignId', kind: 'state' }),
  unifiedUpdate({ id: 'ads.sb.campaign.budget', group: SBG, label: '修改品牌广告活动日预算', risk: '中', adProduct: 'SB', resource: 'campaigns', idField: 'campaignId', kind: 'budget' }),
  unifiedUpdate({ id: 'ads.sb.target.bid', group: SBG, label: '修改品牌广告投放竞价', risk: '中', adProduct: 'SB', resource: 'targets', idField: 'targetId', kind: 'targetBid' }),
  unifiedUpdate({ id: 'ads.sb.target.state', group: SBG, label: '开启 / 暂停品牌广告投放', risk: '低', adProduct: 'SB', resource: 'targets', idField: 'targetId', kind: 'state' }),
  sdUpdate({ id: 'ads.sd.campaign.state', label: '开启 / 暂停展示型广告活动', risk: '中', entity: 'campaign', field: 'state', kind: 'state' }),
  sdUpdate({ id: 'ads.sd.campaign.budget', label: '修改展示型广告活动预算', risk: '中', entity: 'campaign', field: 'budget', kind: 'number' }),
  sdUpdate({ id: 'ads.sd.target.bid', label: '修改展示型投放竞价', risk: '中', entity: 'target', field: 'bid', kind: 'number' }),
  sdUpdate({ id: 'ads.sd.target.state', label: '开启 / 暂停展示型投放', risk: '低', entity: 'target', field: 'state', kind: 'state' }),
  listingAttribute,
  listingPrice,
  listingFbmQty,
  ziniaoControl,
];

// 面板里显示为“规划中”的官方能力（还没实现，不能打开）
export const PLANNED = [
  { id: 'fba.inbound', group: 'FBA 物流', label: '创建 FBA 入仓计划与货件' },
];

// 旧版操作名 → 新版（v1 把关键词、商品投放统一成“投放 target”）
export const OP_ALIASES = {
  'ads.sp.keyword.bid': { op: 'ads.sp.target.bid', rename: { keywordId: 'targetId' } },
  'ads.sp.keyword.state': { op: 'ads.sp.target.state', rename: { keywordId: 'targetId' } },
  'ads.sp.productAd.state': { op: 'ads.sp.ad.state', rename: {} },
};

export function normalizeChange(c) {
  const a = OP_ALIASES[c.op];
  if (!a) return c;
  const out = { ...c, op: a.op };
  for (const [from, to] of Object.entries(a.rename)) if (out[from] !== undefined && out[to] === undefined) { out[to] = out[from]; delete out[from]; }
  return out;
}

export function opById(id) {
  return OPS.find((o) => o.id === id) || null;
}

export function storeOf(alias) {
  return getStore(alias);
}
