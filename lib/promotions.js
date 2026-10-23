// Public Promotions v2025-12-01 has GET operations only (verified 2026-10-23).
// A handoff is a local plan, never an API submission or browser automation.
import { spapi } from './spapi.js';
import { marketplace as market } from './regions.js';

const BASE = '/promotions/2025-12-01/promotions';
export const PROMOTIONS_SOURCE = 'https://developer-docs.amazon/sp-api/docs/promotions-api';
const TYPES = ['COUPON', 'BASKET_BUILDING', 'DEAL', 'PRICE_DISCOUNT'];
const id = (v, name) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 256) throw new Error(`缺少或无效 ${name}`);
  return encodeURIComponent(v);
};

export async function readPromotions(store, { action = 'search', marketplace, promotionId, selectionId, query = {} } = {}) {
  const m = market(marketplace || store.defaultMarketplace);
  if (m.region !== store.region) throw new Error('站点不属于这个店铺的 API 区域。');
  const allowed = action === 'search'
    ? ['locale', 'statuses', 'asins', 'skus', 'promotionTypes', 'startDateBefore', 'startDateAfter', 'endDateBefore', 'endDateAfter', 'updateDateAfter', 'updateDateBefore', 'paginationToken', 'revision', 'limit', 'includedData']
    : action === 'get' ? ['locale', 'includedData'] : ['locale', 'revisionId', 'paginationToken', 'limit', 'includedData'];
  for (const k of Object.keys(query)) if (!allowed.includes(k)) throw new Error(`不支持查询参数 ${k}`);
  let path = BASE;
  const q = { locale: m.lang, ...query };
  if (action === 'search') q.marketplaceIds = [m.id];
  else if (action === 'get') { path += `/${id(promotionId, 'promotionId')}`; q.includedData ||= ['ISSUES', 'SELECTION']; }
  else if (action === 'selection') {
    if (!Number.isInteger(query.revisionId) || query.revisionId < 1) throw new Error('selection 必须提供 query.revisionId（从详情 selection.revisionId 取得的正整数）');
    path += `/${id(promotionId, 'promotionId')}/selections/${id(selectionId, 'selectionId')}`;
  }
  else throw new Error('action 只能是 search/get/selection');
  const data = await spapi(store.alias, 'GET', path, { query: q });
  if (action === 'get' && data.marketplaceId !== m.id) throw new Error('促销回执不属于所选站点。');
  return { api: 'Promotions v2025-12-01', marketplace: m.code, capability: 'READ_ONLY', data,
    nextToken: data.pagination?.nextToken || null,
    note: '官方只读结果。PROCESSING=处理中，UPCOMING=已排期，RUNNING=平台标记正在运行；不证明与某份本地提案完全一致。' };
}

function checkPlan(c, m) {
  const v = c.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('value 必须是促销计划对象');
  const known = ['promotionType', 'title', 'items', 'discount', 'budget', 'startDate', 'endDate', 'audience', 'stackingPolicy', 'conditions'];
  for (const k of Object.keys(v)) if (!known.includes(k)) throw new Error(`不认识的促销字段 ${k}，避免被静默忽略。`);
  if (!TYPES.includes(v.promotionType)) throw new Error(`promotionType 必须是 ${TYPES.join('/')}`);
  for (const k of ['title', 'audience', 'stackingPolicy']) if (typeof v[k] !== 'string' || !v[k].trim()) throw new Error(`请明确 ${k}`);
  if (!Array.isArray(v.items) || !v.items.length || v.items.length > 100) throw new Error('items 需有 1–100 项 {asin, sku?}');
  const seen = new Set();
  for (const item of v.items) {
    if (!/^[A-Z0-9]{10}$/.test(item.asin || '') || (item.sku !== undefined && (typeof item.sku !== 'string' || !item.sku.trim()))) throw new Error('商品需要有效的十位 ASIN，可同时填写 SKU');
    if (seen.has(item.asin)) throw new Error('items 中有重复 ASIN');
    seen.add(item.asin);
    for (const key of Object.keys(item)) if (!['asin', 'sku'].includes(key)) throw new Error(`不支持商品字段 ${key}`);
  }
  const d = v.discount;
  if (!d || !['PERCENTAGE_OFF', 'AMOUNT_OFF'].includes(d.type) || typeof d.value !== 'number' || !Number.isFinite(d.value) || d.value <= 0) throw new Error('discount 需要 type=PERCENTAGE_OFF/AMOUNT_OFF 与正数 value');
  if (Object.keys(d).some((k) => !['type', 'value', 'currency'].includes(k))) throw new Error('discount 包含不支持的字段');
  if (d.type === 'PERCENTAGE_OFF' && d.value >= 100) throw new Error('百分比折扣必须小于 100');
  if (d.type === 'AMOUNT_OFF' && d.currency !== m.currency) throw new Error(`折扣币种必须为 ${m.currency}`);
  if (!v.budget || typeof v.budget.amount !== 'number' || !Number.isFinite(v.budget.amount) || v.budget.amount <= 0 || v.budget.currency !== m.currency) throw new Error(`budget 需要正数 amount 与 currency=${m.currency}（本地投入上限，不是保证平台停止支出）`);
  if (Object.keys(v.budget).some((k) => !['amount', 'currency'].includes(k))) throw new Error('budget 包含不支持的字段');
  for (const k of ['startDate', 'endDate']) if (typeof v[k] !== 'string' || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(v[k]) || !Number.isFinite(Date.parse(v[k]))) throw new Error(`${k} 需要带时区的 ISO 日期时间`);
  if (Date.parse(v.endDate) <= Date.parse(v.startDate) || Date.parse(v.startDate) <= Date.now()) throw new Error('开始时间须在未来，结束时间须晚于开始时间');
  if (v.promotionType !== 'COUPON' && (typeof v.conditions !== 'string' || !v.conditions.trim())) throw new Error('非优惠券促销需在 conditions 明确资格、门槛/数量、商品级折扣和费用核验事项');
  return structuredClone(v);
}

export const PROMOTION_OP = {
  id: 'promotions.coupon', group: '促销', label: '优惠券 / 促销准备与网页交接', risk: '高', implemented: true,
  channel: 'handoff', capability: 'handoff', api: 'Promotions v2025-12-01（只读）',
  limitation: '可准备、校验、交接和查询；官方无创建/修改端点。此开关只批准交接，不能自动提交。',
  requirements: '查询需 Pricing 或 Product Listing 角色；NA/EU/FE。创建资格、费用、折扣门槛以卖家后台当次校验为准。',
  params: { value: '{promotionType:COUPON|BASKET_BUILDING|DEAL|PRICE_DISCOUNT,title,items:[{asin,sku?}],discount:{type:PERCENTAGE_OFF|AMOUNT_OFF,value,currency?},budget:{amount,currency},startDate,endDate,audience,stackingPolicy,conditions?}' },
  async read(store, c) {
    const m = market(c.marketplace || store.defaultMarketplace);
    if (m.region !== store.region) throw new Error('站点与店铺 API 区域不一致');
    return { marketplace: m.code, entity: { currency: m.currency }, old: null };
  },
  check(c, r) { return { newValue: checkPlan(c, market(r.marketplace)), warnings: ['仅本地格式与一致性校验；未验证账户/ASIN优惠资格、参考价和促销费用。', '提交前必须在 Seller Central 查看费用、叠加优惠和实际展示值；数值变化须重新审批。'] }; },
  build(c, r, value) {
    return { marketplace: r.marketplace, value, platformSubmission: false,
      handoff: {
        operator: '用户本人，或宿主提供的 GPT 电脑/浏览器操控（可用时）',
        requiresForegroundCoordination: true, ziniaoRequired: false,
        steps: ['用户登录所选站点 Seller Central，进入广告菜单中的优惠券/对应促销工具。', '按照批准表逐项填写商品、折扣、日期、预算、受众和叠加规则；本工具不自动打开浏览器。', '记录平台实际资格检查、费用与预览；出现新费用或字段变化时停止，重新出精确提案。', '只有这份提案已经批准且用户允许前台操作时才能点击提交；没有宿主电脑操控工具则由用户手动提交。', '记录平台 promotionId/提交回执。超时或无明确回执时只查询，不重新提交。', '用 xander_record_promotion_receipt 关联回执，再用 xander_verify_change / xander_promotions 读取平台状态。'],
      },
    };
  },
  async send(store, req, { checkpoint = async () => {} } = {}) {
    const result = { ok: true, status: 'HANDOFF_READY', platformSubmission: false, handoff: req.handoff, plan: req.value, marketplace: req.marketplace,
      note: '交接资料已准备；本工具未向亚马逊提交，也未操作浏览器。' };
    await checkpoint(result);
    return result;
  },
  async readback(store, c, expected, receipt) {
    if (!receipt?.promotionId) return { status: 'HANDOFF_READY', match: false, actual: null, note: '尚无平台回执。仅完成本地准备，未确认提交。' };
    const r = await readPromotions(store, { action: 'get', marketplace: c.marketplace, promotionId: receipt.promotionId });
    if (r.data.promotionType !== expected.promotionType) return { match: false, status: 'MISMATCH', actual: r.data, note: '回执促销类型与批准计划不同。' };
    return { match: false, status: 'PLATFORM_STATUS_OBSERVED', actual: r.data,
      note: `平台状态 ${r.data.status}；回执ID由操作者提供。尚未核对全部商品、折扣、费用和版本，不能宣称整份提案已生效。` };
  },
};
