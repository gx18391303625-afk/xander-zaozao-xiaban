// 写入操作目录：每一项写入能力就是开关面板上的一个“灯”。
// 每项定义：读原值(read) → 校验(check) → 组装请求(build) → 提交(send) → 回读(readback)。
// implemented=false 的项目只在面板里显示为“规划中”，无法打开。
import { ads, profileFor } from './ads.js';
import { getListing, patchListing } from './spapi.js';
import { getStore } from './config.js';
import { marketplace as mp } from './regions.js';

const STATES = ['ENABLED', 'PAUSED'];

function pctChange(oldV, newV) {
  if (oldV === null || oldV === undefined || Number(oldV) === 0) return null;
  return ((Number(newV) - Number(oldV)) / Number(oldV)) * 100;
}

function needNumber(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} 必须是大于 0 的数字，收到：${v}`);
  return Math.round(n * 100) / 100;
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
      if (kind === 'budget' && budgetOf(obj).recurrence && budgetOf(obj).recurrence !== 'DAILY') throw new Error(`这个活动是 ${budgetOf(obj).recurrence} 预算（总预算），为安全起见只支持修改日预算。`);
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
  return {
    id, group: '广告 · SP 商品推广', label, risk, implemented: true, channel: 'ads', creates: true, api: 'Ads API v1',
    params: negative
      ? { adGroupId: '广告组 ID（广告组级否定）', campaignId: '只填活动 ID 不填广告组 = 活动级否定', keywordText: '关键词', matchType: 'EXACT / PHRASE' }
      : { adGroupId: '广告组 ID', keywordText: '关键词', matchType: 'EXACT / PHRASE / BROAD', bid: '竞价' },
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
      const existing = await ads(store.alias, 'POST', '/adsApi/v1/query/targets', {
        profileId, body: { adProductFilter: { include: ['SPONSORED_PRODUCTS'] }, ...scope, targetTypeFilter: { include: ['KEYWORD'] }, negativeFilter: { include: [negative] }, maxResults: 5000 },
      });
      const mt = normMatch(c.matchType);
      const dup = (existing?.targets || []).find((t) => {
        const kw = t.targetDetails?.keywordTarget;
        const sameLevel = c.adGroupId ? String(t.adGroupId) === String(c.adGroupId) : !t.adGroupId;
        return sameLevel && kw && kw.keyword?.toLowerCase() === String(c.keywordText).trim().toLowerCase() && kw.matchType === mt && t.state !== 'ARCHIVED';
      });
      return { profileId, marketplace: code, entity: { adGroup: groupName, level: c.adGroupId ? '广告组' : '活动', duplicate: dup || null }, old: dup ? `已存在（${dup.state}）` : null };
    },
    check(c, r) {
      if (r.entity.duplicate) throw new Error('同一位置已有相同的词和匹配方式，不需要重复添加。');
      const mt = normMatch(c.matchType);
      if (!matchTypes.includes(mt)) throw new Error(`匹配方式只能是 ${matchTypes.join('/')}`);
      const value = { keywordText: String(c.keywordText).trim(), matchType: mt };
      if (!negative) value.bid = needNumber(c.bid, '竞价');
      return { newValue: value, warnings: [] };
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
      const resp = await ads(store.alias, req.method, req.path, { profileId: req.profileId, contentType: req.contentType, body: req.body, isWrite: true });
      const err = unifiedErrors(resp);
      const created = (resp?.success || []).map((s) => s.target?.targetId).filter(Boolean).map(String);
      return { ok: !err && created.length > 0, error: err || (created.length ? null : '没有返回新对象 ID'), response: resp, createdIds: created };
    },
    async readback(store, c, expected, sendResult) {
      const { profileId } = profileFor(store, c.marketplace);
      const tid = sendResult?.createdIds?.[0];
      if (!tid) return { actual: null, match: false, note: '提交回执里没有新对象 ID，需要人工核对。' };
      const resp = await ads(store.alias, 'POST', '/adsApi/v1/query/targets', {
        profileId, body: { adProductFilter: { include: ['SPONSORED_PRODUCTS'] }, targetIdFilter: { include: [tid] } },
      });
      const t = (resp?.targets || [])[0];
      const kw = t?.targetDetails?.keywordTarget;
      return { actual: t ? { keywordText: kw?.keyword, matchType: kw?.matchType, bid: t.bid?.bid, state: t.state, negative: t.negative } : null, match: !!kw && kw.keyword === expected.keywordText && kw.matchType === expected.matchType };
    },
  };
}

// ---------- Listing（SP-API Listings Items） ----------
const LISTING_ATTRS = {
  item_name: '标题',
  bullet_point: '五点描述',
  product_description: '产品描述',
  generic_keyword: '后台搜索词',
};

function attrValues(attr) {
  return (attr || []).map((x) => x.value);
}

const listingAttribute = {
  id: 'listing.attribute', group: 'Listing', label: '修改标题 / 五点 / 描述 / 后台词', risk: '高', implemented: true, channel: 'spapi',
  params: { sku: 'SKU', attribute: Object.keys(LISTING_ATTRS).join(' / '), value: '新内容（五点用数组）', languageTag: '可选；默认沿用原值，没有原值就用站点默认语言（如 UK→en_GB、DE→de_DE、JP→ja_JP）' },
  async read(store, c) {
    if (!c.sku) throw new Error('缺少 sku');
    if (!LISTING_ATTRS[c.attribute]) throw new Error(`只支持修改：${Object.entries(LISTING_ATTRS).map(([k, v]) => `${k}(${v})`).join('、')}`);
    const code = mp(c.marketplace || store.defaultMarketplace).code;
    const item = await getListing(store.alias, c.sku, code);
    const productType = item?.summaries?.[0]?.productType;
    if (!productType) throw new Error('读不到这个 SKU 的 productType，可能 SKU 或站点不对。');
    const cur = item?.attributes?.[c.attribute] || [];
    return { marketplace: code, entity: { sku: c.sku, asin: item?.summaries?.[0]?.asin, productType, languageTag: cur[0]?.language_tag }, old: attrValues(cur) };
  },
  check(c, r) {
    const vals = Array.isArray(c.value) ? c.value : [c.value];
    if (vals.some((v) => typeof v !== 'string' || !v.trim())) throw new Error('内容不能为空。');
    if (c.attribute === 'item_name' && vals.length !== 1) throw new Error('标题只能有一条。');
    if (c.attribute === 'bullet_point' && vals.length > 10) throw new Error('五点最多 10 条。');
    if (JSON.stringify(vals) === JSON.stringify(r.old)) throw new Error('新内容和当前内容一样。');
    return { newValue: vals.map((v) => v.trim()), warnings: [] };
  },
  build(c, r, vals) {
    const marketplaceId = mp(r.marketplace).id;
    const lang = c.languageTag || r.entity.languageTag || mp(r.marketplace).lang;
    if (!lang) throw new Error(`${r.marketplace} 站没有默认语言标签，请在提案里指定 languageTag。`);
    return {
      sku: c.sku, marketplace: r.marketplace, productType: r.entity.productType,
      patches: [{ op: 'replace', path: `/attributes/${c.attribute}`, value: vals.map((v) => ({ value: v, language_tag: lang, marketplace_id: marketplaceId })) }],
    };
  },
  async preview(store, req) {
    const resp = await patchListing(store.alias, req.sku, req.marketplace, { productType: req.productType, patches: req.patches, preview: true });
    return { status: resp?.status, issues: resp?.issues || [] };
  },
  async send(store, req) {
    const resp = await patchListing(store.alias, req.sku, req.marketplace, { productType: req.productType, patches: req.patches });
    const errs = (resp?.issues || []).filter((i) => i.severity === 'ERROR');
    return { ok: resp?.status === 'ACCEPTED' && errs.length === 0, error: errs.length ? JSON.stringify(errs) : resp?.status !== 'ACCEPTED' ? `状态：${resp?.status}` : null, response: resp };
  },
  async readback(store, c, expected) {
    const r = await this.read(store, c);
    return { actual: r.old, match: JSON.stringify(r.old) === JSON.stringify(expected), note: 'Listing 改动通常要几分钟到几小时才在接口里生效；不一致时稍后用 xander_verify_change 再查。' };
  },
};

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
  { id: 'ads.sp.campaign.create', group: '广告 · SP 商品推广', label: '新建广告活动 / 广告组 / 广告商品' },
  { id: 'ads.sp.placement', group: '广告 · SP 商品推广', label: '修改竞价策略与广告位加价' },
  { id: 'ads.budgetRules', group: '广告 · 通用', label: '预算规则 / 投资组合' },
  { id: 'listing.images', group: 'Listing', label: '修改主图 / 副图' },
  { id: 'aplus.content', group: 'A+ 与品牌', label: 'A+ 内容提交' },
  { id: 'promotions.coupon', group: '促销', label: '优惠券 / 促销' },
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
