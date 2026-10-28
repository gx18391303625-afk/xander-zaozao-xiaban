// Fulfillment Inbound v2024-03-20 reads only. Label generation and bill of
// lading retrieval belong to the separately approved fba.inbound operation.
import { spapi } from './spapi.js';
import { marketplace as market } from './regions.js';

const BASE = '/inbound/fba/2024-03-20';
const RESOURCES = {
  plans: { key: 'inboundPlans', max: 30 },
  plan: {},
  planItems: { key: 'items', max: 1000, suffix: '/items' },
  planBoxes: { key: 'boxes', max: 1000, suffix: '/boxes' },
  packingOptions: { key: 'packingOptions', max: 20, suffix: '/packingOptions' },
  packingGroupItems: { key: 'items', max: 100, suffix: '/items', packingGroup: true },
  packingGroupBoxes: { key: 'boxes', max: 100, suffix: '/boxes', packingGroup: true },
  placementOptions: { key: 'placementOptions', max: 20, suffix: '/placementOptions' },
  transportationOptions: { key: 'transportationOptions', max: 20, suffix: '/transportationOptions' },
  shipment: { shipment: true },
  shipmentItems: { key: 'items', max: 1000, suffix: '/items', shipment: true },
  shipmentBoxes: { key: 'boxes', max: 1000, suffix: '/boxes', shipment: true },
  shipmentPallets: { key: 'pallets', max: 1000, suffix: '/pallets', shipment: true },
  deliveryWindowOptions: { key: 'deliveryWindowOptions', max: 100, suffix: '/deliveryWindowOptions', shipment: true },
  operation: {},
};
export const FBA_READ_RESOURCES = Object.freeze(Object.keys(RESOURCES));
const clone = (value) => structuredClone(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, label) {
  if (!object(value)) throw new Error(`${label} 必须是对象。`);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`${label} 不支持字段：${extra.join('、')}。`);
}
function id(value, label, operation = false) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]+$/.test(value) || value.length > 38 || value.length < (operation ? 36 : 38)) throw new Error(`${label} 必须是 ${operation ? '36–38' : '38'} 位字母、数字或连字符 ID。`);
  return value;
}
function integer(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label} 必须是 1–${max} 的整数。`);
  return value;
}
function queryFor(resource, filters, definition) {
  const allowed = definition.key ? ['pageSize', 'paginationToken'] : [];
  if (resource === 'plans') allowed.push('status', 'sortBy', 'sortOrder');
  if (resource === 'transportationOptions') allowed.push('placementOptionId', 'shipmentId');
  keys(filters, allowed, 'filters');
  const query = clone(filters);
  if (definition.key) query.pageSize = integer(query.pageSize === undefined ? 10 : query.pageSize, 'pageSize', definition.max);
  if (query.paginationToken !== undefined && (typeof query.paginationToken !== 'string' || !query.paginationToken.length || query.paginationToken.length > 1024)) throw new Error('paginationToken 必须是 1–1024 字符的不透明分页令牌。');
  for (const [key, values] of Object.entries({ status: ['ACTIVE', 'VOIDED', 'SHIPPED'], sortBy: ['LAST_UPDATED_TIME', 'CREATION_TIME'], sortOrder: ['ASC', 'DESC'] })) {
    if (query[key] !== undefined && !values.includes(query[key])) throw new Error(`${key} 必须是 ${values.join('/')}。`);
  }
  for (const key of ['placementOptionId', 'shipmentId']) if (query[key] !== undefined) query[key] = id(query[key], key);
  return query;
}
function planMarketplaces(plan) {
  if (!Array.isArray(plan?.marketplaceIds) || !plan.marketplaceIds.length || plan.marketplaceIds.some((value) => typeof value !== 'string' || !value)) throw new Error('入库计划缺少可确认的 marketplaceIds，不能判断站点范围。');
  return plan.marketplaceIds;
}

export function createFbaReader({ api = spapi } = {}) {
  const get = (store, path, query = {}) => api(store.alias, 'GET', path, { query, isWrite: false });
  async function pages(store, path, query, definition, maxPages) {
    const rawPages = [], items = [], seen = new Set();
    const initialToken = query.paginationToken;
    let token = initialToken;
    if (token) seen.add(token);
    for (let page = 0; page < maxPages; page++) {
      const response = await get(store, path, { ...query, ...(token ? { paginationToken: token } : {}) });
      if (!object(response) || !Array.isArray(response[definition.key])) throw new Error(`${path} 未返回 ${definition.key} 数组，结果不完整。`);
      if (response.pagination !== undefined && !object(response.pagination)) throw new Error('分页响应缺少有效的 pagination 对象。');
      const next = response.pagination?.nextToken;
      if (next !== undefined && (typeof next !== 'string' || !next.length || next.length > 1024)) throw new Error('响应 nextToken 无效，不能确认分页完整。');
      rawPages.push(clone(response));
      items.push(...clone(response[definition.key]));
      token = next;
      if (!token) break;
      if (seen.has(token)) throw new Error('分页令牌重复，不能使用不完整的入库范围。');
      seen.add(token);
    }
    const data = { ...clone(rawPages.at(-1)), [definition.key]: items };
    return { data, items, rawPages, pages: rawPages.length, complete: !token && !initialToken, pageComplete: !token, nextPaginationToken: token || null };
  }
  async function verifiedPlan(store, planId, m) {
    const plan = await get(store, `${BASE}/inboundPlans/${planId}`);
    if (!object(plan) || plan.inboundPlanId !== planId) throw new Error('返回的 inboundPlanId 与请求不一致。');
    // A child shipment does not independently expose its destination marketplace.
    // Do not silently treat a multi-market plan as a single-market plan.
    const markets = planMarketplaces(plan);
    if (markets.length !== 1 || markets[0] !== m.id) throw new Error('入库计划不属于所选单一站点，停止查询其下资源。');
    return plan;
  }
  async function allOptions(store, planId, kind, maxPages) {
    const definition = RESOURCES[kind];
    const result = await pages(store, `${BASE}/inboundPlans/${planId}${definition.suffix}`, { pageSize: definition.max }, definition, maxPages);
    if (!result.complete) throw new Error('用于确认归属的选项分页不完整，请提高 maxPages 后重查。');
    return result.items;
  }
  async function verifiedShipment(store, plan, shipmentId, maxPages) {
    if (plan.shipments !== undefined && !Array.isArray(plan.shipments)) throw new Error('计划 shipments 不是数组，无法确认货件归属。');
    let belongs = (plan.shipments || []).some((row) => row?.shipmentId === shipmentId);
    if (!belongs) {
      const placements = await allOptions(store, plan.inboundPlanId, 'placementOptions', maxPages);
      belongs = placements.some((option) => Array.isArray(option?.shipmentIds) && option.shipmentIds.includes(shipmentId));
    }
    if (!belongs) throw new Error('shipmentId 不在该计划的已确认货件或分仓选项中。');
    const shipment = await get(store, `${BASE}/inboundPlans/${plan.inboundPlanId}/shipments/${shipmentId}`);
    if (!object(shipment) || shipment.shipmentId !== shipmentId || (shipment.inboundPlanId !== undefined && shipment.inboundPlanId !== plan.inboundPlanId)) throw new Error('返回货件的 shipmentId / inboundPlanId 与请求不一致。');
    return shipment;
  }
  async function read(store, args = {}) {
    keys(args, ['resource', 'marketplace', 'inboundPlanId', 'shipmentId', 'packingGroupId', 'operationId', 'filters', 'maxPages'], '入库查询');
    const definition = RESOURCES[args.resource];
    if (!Object.hasOwn(RESOURCES, args.resource)) throw new Error(`resource 仅支持 ${FBA_READ_RESOURCES.join('/')}；标签和提单须通过 fba.inbound 审批操作取得。`);
    if (args.marketplace !== undefined && (typeof args.marketplace !== 'string' || !args.marketplace)) throw new Error('marketplace 必须是非空站点代码。');
    const m = market(args.marketplace || store.defaultMarketplace || store.marketplaces?.[0]);
    if (!['NA', 'EU', 'FE'].includes(store.region) || store.region !== m.region) throw new Error('查询站点与店铺 SP-API 区域不一致。');
    if (Array.isArray(store.marketplaces) && store.marketplaces.length && !store.marketplaces.some((code) => String(code).toUpperCase() === m.code)) throw new Error('查询站点不在该店铺已配置的站点范围内。');
    const maxPages = integer(args.maxPages === undefined ? 20 : args.maxPages, 'maxPages', 100);
    const query = queryFor(args.resource, args.filters === undefined ? {} : args.filters, definition);
    const scope = {};
    const needsPlan = !['plans', 'operation'].includes(args.resource);
    if (needsPlan) scope.inboundPlanId = id(args.inboundPlanId, 'inboundPlanId');
    else if (args.inboundPlanId !== undefined) throw new Error(`${args.resource} 不接受 inboundPlanId；操作状态本身没有计划归属字段。`);
    if (definition.packingGroup) scope.packingGroupId = id(args.packingGroupId, 'packingGroupId');
    else if (args.packingGroupId !== undefined) throw new Error('此 resource 不接受 packingGroupId。');
    if (definition.shipment) scope.shipmentId = id(args.shipmentId, 'shipmentId');
    else if (args.resource === 'transportationOptions') {
      if (args.shipmentId !== undefined) {
        const shipmentId = id(args.shipmentId, 'shipmentId');
        if (query.shipmentId !== undefined && query.shipmentId !== shipmentId) throw new Error('shipmentId 与 filters.shipmentId 冲突。');
        query.shipmentId = shipmentId;
      }
      if (query.shipmentId) scope.shipmentId = query.shipmentId;
    } else if (args.shipmentId !== undefined) throw new Error('此 resource 不接受 shipmentId。');
    if (args.resource === 'operation') scope.operationId = id(args.operationId, 'operationId', true);
    else if (args.operationId !== undefined) throw new Error('此 resource 不接受 operationId。');

    let path = `${BASE}/inboundPlans`, detail;
    const plan = needsPlan ? await verifiedPlan(store, scope.inboundPlanId, m) : null;
    if (plan) path += `/${scope.inboundPlanId}`;
    if (args.resource === 'plan') detail = plan;
    if (scope.packingGroupId) {
      const options = await allOptions(store, scope.inboundPlanId, 'packingOptions', maxPages);
      if (!options.some((option) => Array.isArray(option?.packingGroups) && option.packingGroups.includes(scope.packingGroupId))) throw new Error('packingGroupId 不属于该计划的装箱选项。');
      path += `/packingGroups/${scope.packingGroupId}`;
    }
    if (scope.shipmentId) {
      const shipment = await verifiedShipment(store, plan, scope.shipmentId, maxPages);
      if (definition.shipment) path += `/shipments/${scope.shipmentId}`;
      if (args.resource === 'shipment') detail = shipment;
    }
    if (query.placementOptionId) {
      const options = await allOptions(store, scope.inboundPlanId, 'placementOptions', maxPages);
      const option = options.find((row) => row?.placementOptionId === query.placementOptionId);
      if (!option || (scope.shipmentId && (!Array.isArray(option.shipmentIds) || !option.shipmentIds.includes(scope.shipmentId)))) throw new Error('placementOptionId 或其货件不属于该计划。');
      scope.placementOptionId = query.placementOptionId;
    }
    if (args.resource === 'operation') {
      detail = await get(store, `${BASE}/operations/${scope.operationId}`);
      if (!object(detail) || detail.operationId !== scope.operationId || !['SUCCESS', 'FAILED', 'IN_PROGRESS'].includes(detail.operationStatus) || !Array.isArray(detail.operationProblems)) throw new Error('异步操作状态响应缺少匹配 ID、有效状态或 operationProblems。');
    }
    let result = definition.key
      ? await pages(store, `${path}${definition.suffix || ''}`, query, definition, maxPages)
      : { data: clone(detail), rawPages: [clone(detail)], pages: 1, complete: true, pageComplete: true, nextPaginationToken: null };
    if (args.resource === 'plans') {
      for (const row of result.items) { id(row?.inboundPlanId, '响应 inboundPlanId'); planMarketplaces(row); }
      const items = result.items.filter((row) => row.marketplaceIds.length === 1 && row.marketplaceIds[0] === m.id);
      result = { ...result, items, data: { ...result.data, inboundPlans: items }, excludedCount: result.items.length - items.length };
    }
    return { resource: args.resource, apiVersion: '2024-03-20', marketplace: m.code, marketplaceId: m.id, region: store.region, scope, ...result,
      rawPagesScope: args.resource === 'plans' ? 'REGION' : 'REQUESTED_RESOURCE',
      ...(args.resource === 'plans' ? { note: 'items / data 已限定为所选单一站点；rawPages 保留区域接口原始证据，可能包含其他站点。' } : args.resource === 'operation' ? { note: '仅核对指定 operationId 的处理状态；该响应不包含计划归属，也不证明货件已实际发运。' } : {}),
      fetchedAt: new Date().toISOString() };
  }
  return { read };
}
