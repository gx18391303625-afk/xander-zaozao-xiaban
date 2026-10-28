// US FBA inbound, one approved mutation at a time. Never chain async steps.
import fs from 'node:fs';
import path from 'node:path';
import { spapi } from './spapi.js';
import { getStore } from './config.js';
import { marketplace } from './regions.js';
import { canonical, sha256, readJson } from './jsonfile.js';
import { p } from './paths.js';
import { HttpError } from './http.js';
import { createFbaReader } from './fba-inbound-api.js';
import { FBA_ACTIONS, validateFbaBody, validateFbaType, fbaId } from './fba-inbound-schema.js';
import { validateFbaDocumentChange, prepareFbaDocumentQuery, downloadFbaDocument } from './fba-inbound-documents.js';

const OP = 'fba.inbound';
const DOCUMENT_ACTIONS = ['generateLabels', 'billOfLading'];
const unresolved = new Set(['EXECUTING', 'SUBMITTING', 'OUTCOME_UNKNOWN', 'PARTIALLY_SUCCEEDED', 'SUBMITTED', 'AWAITING_READBACK', 'MISMATCH']);
const same = (a, b) => canonical(a) === canonical(b);
const copy = (v) => structuredClone(v);
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const sorted = (v) => [...v].sort();
const unique = (v, label) => { if (new Set(v).size !== v.length) throw new Error(`${label} 不能重复。`); return v; };
const strictKeys = (v, keys, label) => { for (const key of Object.keys(v)) if (!keys.includes(key)) throw new Error(`${label} 不接受字段 ${key}。`); };

function binding(store, code) {
  const m = marketplace(code || store.defaultMarketplace);
  if (m.code !== 'US' || store.region !== 'NA') throw new Error('本版 FBA 写入先支持 NA 区域美国站；其他站点可以只读查询。');
  if (typeof store.sellerId !== 'string' || !store.sellerId.trim()) throw new Error('FBA 写入需要已配置的 sellerId 以锁定账户。');
  return { sellerId: store.sellerId, region: store.region, marketplaceId: m.id, marketplace: m.code };
}
function bindingIssue(store, request) {
  try { return same(binding(store, request?.marketplace), request?.binding) ? null : '卖家账户或站点绑定已变化，不能执行或核验原 FBA 提案。'; }
  catch (e) { return e.message; }
}
function input(c) {
  strictKeys(c, ['op', 'action', 'marketplace', 'inboundPlanId', 'packingOptionId', 'placementOptionId', 'shipmentId', 'deliveryWindowOptionId', 'body', 'reason'], 'FBA 改动');
  const document = DOCUMENT_ACTIONS.includes(c.action);
  const spec = document ? { method: 'GET', path: '/inboundPlans/{inboundPlanId}/shipments/{shipmentId}' } : FBA_ACTIONS[c.action];
  if (!spec) throw new Error('不支持这个 FBA 动作；不提供取消计划、删除货件或自动采购。');
  if (document) {
    validateFbaDocumentChange(c);
    if (c.action === 'billOfLading' && c.body !== undefined) throw new Error('billOfLading 没有请求体，不接受 body。');
  } else validateFbaBody(c.action, c.body);
  const parameters = [...spec.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  for (const field of ['inboundPlanId', 'packingOptionId', 'placementOptionId', 'shipmentId', 'deliveryWindowOptionId']) {
    if (parameters.includes(field)) fbaId(c[field], field, field === 'deliveryWindowOptionId' ? { min: 36, max: 38 } : {});
    else if (c[field] !== undefined) throw new Error(`${c.action} 不接受多余的 ${field}；请求体字段放在 body 中。`);
  }
  if (c.action === 'generatePlacementOptions' && Object.keys(c.body || {}).length) throw new Error('美国站不接受印度站的 customPlacement。');
  const walkItems = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Object.hasOwn(v, 'msku')) {
      if (v.labelOwner === 'AMAZON' || v.prepOwner === 'AMAZON') throw new Error('美国站已不支持 Amazon 代贴标/预处理；请确认实际由 SELLER 或适用的 NONE 完成。');
    }
    for (const child of Object.values(v)) walkItems(child);
  };
  walkItems(c.body);
  return spec;
}
function creationIdentity(c) {
  return { address: c.body?.sourceAddress, marketplaces: c.body?.destinationMarketplaces,
    skus: sorted([...new Set((c.body?.items || []).map((i) => i.msku))]) };
}
function assertNoPendingCreatedPlan(planId, account) {
  if (!fs.existsSync(p('proposals'))) return;
  for (const file of fs.readdirSync(p('proposals')).filter((f) => f.endsWith('.json'))) {
    const proposal = readJson(p('proposals', file), null);
    for (const item of proposal?.items || []) {
      if (item.op === OP && unresolved.has(item.result?.status) && same(item.request?.binding, account)
          && item.sendResult?.inboundPlanId === planId && item.change?.action === 'createInboundPlan') {
        throw new Error(`计划 ${planId} 的创建提案 ${proposal.id} 仍未核验；先查询原提案，不能继续后续动作。`);
      }
    }
  }
}
function itemKey(item) { return canonical([item.msku, item.labelOwner, item.expiration ?? null, item.manufacturingLotCode ?? null]); }
function itemTotals(items, multiplier = 1, totals = {}) {
  if (!Array.isArray(items)) throw new Error('FBA 商品明细不完整。');
  if (!Number.isSafeInteger(multiplier) || multiplier < 1) throw new Error('FBA 箱数必须是正整数。');
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || typeof item.msku !== 'string') throw new Error('FBA 商品数量或 SKU 明细不完整。');
    const key = itemKey(item); totals[key] = (totals[key] || 0) + item.quantity * multiplier;
    if (!Number.isSafeInteger(totals[key])) throw new Error('FBA 合计数量超过安全整数范围。');
  }
  return totals;
}
function prepMatches(actual, expected) {
  return expected.every((item) => {
    const found = actual.filter((a) => itemKey(a) === itemKey(item));
    return found.length && found.every((a) => Array.isArray(a.prepInstructions)
      && (a.prepInstructions.length ? a.prepInstructions.every((i) => i.prepType === 'ITEM_LABELING'
        ? i.prepOwner === item.labelOwner
        : i.prepOwner === item.prepOwner || (i.prepType === 'ITEM_NO_PREP' && i.prepOwner === 'NONE')) : item.prepOwner === 'NONE'));
  });
}
function contains(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => contains(actual[i], v));
  if (object(expected)) return object(actual) && Object.keys(expected).every((k) => contains(actual[k], expected[k]));
  return actual === expected;
}
const inventoryEvidence = (items) => items.map((i) => canonical({ key: itemKey(i), quantity: i.quantity,
  prep: (i.prepInstructions || []).map((p) => canonical(p)).sort() })).sort();
const shipmentRoute = (s) => ({ shipmentId: s.shipmentId, placementOptionId: s.placementOptionId, source: s.source, destination: s.destination });
const transportationEvidence = (o) => ({ transportationOptionId: o.transportationOptionId, shipmentId: o.shipmentId,
  carrier: o.carrier, shippingMode: o.shippingMode, shippingSolution: o.shippingSolution, cost: o.quote?.cost ?? null });
const palletCounts = (values) => values.reduce((t, pallet) => {
  if (!Number.isSafeInteger(pallet.quantity) || pallet.quantity < 1 || !pallet.dimensions || !pallet.weight || !pallet.stackability) throw new Error('托盘数量、尺寸、重量或可堆叠性回读不完整。');
  const key = canonical({ dimensions: pallet.dimensions, weight: pallet.weight, stackability: pallet.stackability });
  t[key] = (t[key] || 0) + pallet.quantity; return t;
}, {});
const sameInstant = (a, b, minute = false) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && (minute ? Math.floor(x / 60000) === Math.floor(y / 60000) : x === y);
};
function deadline(value, name, now, required = false) {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now()) throw new Error(`${name} 已过期或时间不完整，请重新查询方案。`);
}
function offered(option, id, now) {
  if (!option || option.status !== 'OFFERED') throw new Error(`方案 ${id} 不是可确认的 OFFERED 状态；已确认或过期方案不能重复确认。`);
  deadline(option.expiration, '方案', now);
  for (const key of ['fees', 'discounts']) {
    if (!Array.isArray(option[key])) throw new Error(`方案缺少 ${key} 明细，不能把未知费用当作零。`);
    for (const entry of option[key]) {
      if (!object(entry.value) || typeof entry.value.amount !== 'number' || !Number.isFinite(entry.value.amount) || entry.value.amount < 0 || !/^[A-Z]{3}$/.test(entry.value.code)) throw new Error('方案费用/折扣金额或币种不完整。');
    }
  }
}

export function createFbaInboundOperation({ api = spapi, now = Date.now, downloadDocument = downloadFbaDocument } = {}) {
  const reader = createFbaReader({ api });
  const read = async (store, resource, c, extra = {}) => {
    const pageSizes = { plans: 30, planItems: 1000, planBoxes: 1000, packingOptions: 20, packingGroupItems: 100, packingGroupBoxes: 100, placementOptions: 20, transportationOptions: 20, shipmentItems: 1000, shipmentBoxes: 1000, shipmentPallets: 1000, deliveryWindowOptions: 100 };
    const expectedBinding = binding(store, c.marketplace);
    const safeReader = api === spapi ? createFbaReader({ api: (alias, ...args) => {
      const issue = bindingIssue(getStore(alias), { marketplace: c.marketplace || 'US', binding: expectedBinding });
      if (issue) throw new Error(issue);
      return api(alias, ...args);
    } }) : reader;
    const result = await safeReader.read(store, { resource, marketplace: c.marketplace || 'US', ...(c.inboundPlanId && !['operation', 'plans'].includes(resource) ? { inboundPlanId: c.inboundPlanId } : {}), ...extra,
      ...(pageSizes[resource] ? { filters: { pageSize: pageSizes[resource], ...extra.filters } } : {}), maxPages: 100 });
    if (!result.complete) throw new Error(`FBA ${resource} 分页不完整，不能生成或核验写入提案。`);
    const type = { plans: 'InboundPlanSummary', plan: 'InboundPlan', planItems: 'Item', planBoxes: 'Box', packingOptions: 'PackingOption', packingGroupItems: 'Item', packingGroupBoxes: 'Box', placementOptions: 'PlacementOption', transportationOptions: 'TransportationOption', shipment: 'Shipment', shipmentItems: 'Item', shipmentBoxes: 'Box', shipmentPallets: 'Pallet', deliveryWindowOptions: 'DeliveryWindowOption', operation: 'InboundOperationStatus' }[resource];
    const value = result.items || result.data;
    for (const row of result.items || [value]) validateFbaType(type, row, { allowUnknown: true });
    if (resource === 'operation' && value.operationProblems.some((p) => !['ERROR', 'WARNING'].includes(p.severity))) throw new Error('异步任务出现未知问题严重程度，不能确认成功。');
    return value;
  };
  async function snapshot(store, c) {
    input(c);
    const account = binding(store, c.marketplace);
    if (c.action === 'createInboundPlan') {
      if (typeof c.body.name !== 'string' || !c.body.name.trim() || c.body.name !== c.body.name.trim()) throw new Error('创建入仓计划需要唯一、非空且无首尾空格的 name，便于防重和核验。');
      if (!same(c.body.destinationMarketplaces, [account.marketplaceId])) throw new Error('destinationMarketplaces 必须与已批准美国站一致。');
      unique(c.body.items.map(itemKey), '计划商品行');
      const plans = await read(store, 'plans', c);
      if (plans.some((plan) => typeof plan.name === 'string' && plan.name.trim().toLowerCase() === c.body.name.toLowerCase())) throw new Error('已有同名 FBA 入仓计划，请查询原计划；不能重复创建。');
      return { binding: account, duplicates: [] };
    }
    assertNoPendingCreatedPlan(c.inboundPlanId, account);
    const plan = await read(store, 'plan', c);
    const afterShipping = DOCUMENT_ACTIONS.includes(c.action) || c.action === 'updateShipmentTrackingDetails';
    if (plan.status !== 'ACTIVE' && !(afterShipping && plan.status === 'SHIPPED')) throw new Error(`FBA 计划状态为 ${plan.status || '未知'}，本版仅 ACTIVE 计划可规划；SHIPPED 计划只支持文档和跟踪。`);
    const current = { binding: account, plan, items: await read(store, 'planItems', c) };
    if (DOCUMENT_ACTIONS.includes(c.action)) {
      current.shipment = await read(store, 'shipment', c, { shipmentId: c.shipmentId });
      current.transport = await read(store, 'transportationOptions', c, { shipmentId: c.shipmentId });
      const option = current.transport.find((o) => o.transportationOptionId === current.shipment.selectedTransportationOptionId);
      current.boxes = c.action === 'generateLabels' && c.body.LabelType === 'UNIQUE' ? await read(store, 'shipmentBoxes', c, { shipmentId: c.shipmentId }) : [];
      current.document = prepareFbaDocumentQuery(c, current.shipment, current.boxes, option);
      if (c.action === 'generateLabels' && c.body.LabelType === 'PALLET') {
        current.pallets = await read(store, 'shipmentPallets', c, { shipmentId: c.shipmentId });
        const count = current.pallets.reduce((n, pallet) => { if (!Number.isSafeInteger(pallet.quantity) || pallet.quantity < 1) throw new Error('托盘回读数量不完整。'); return n + pallet.quantity; }, 0);
        if (count !== c.body.NumberOfPallets) throw new Error('批准的托盘标签数量与当前货件托盘数不一致。');
        current.document.expected.palletCountSource = 'API_READBACK';
      }
      return current;
    }
    if (['generatePackingOptions', 'confirmPackingOption', 'setPackingInformation', 'generatePlacementOptions'].includes(c.action)) current.packing = await read(store, 'packingOptions', c);
    if (['setPackingInformation', 'generatePlacementOptions', 'confirmPlacementOption', 'generateTransportationOptions', 'confirmTransportationOptions'].includes(c.action)) current.placement = await read(store, 'placementOptions', c);
    const chosenPacking = current.packing?.filter((o) => o.status === 'ACCEPTED') || [];
    const chosenPlacement = current.placement?.filter((o) => o.status === 'ACCEPTED') || [];
    if (chosenPacking.length > 1 || chosenPlacement.length > 1) throw new Error('方案回执出现多个已确认选项，停止。');
    if (c.action === 'generatePackingOptions' && chosenPacking.length) throw new Error('装箱方案已经确认，不能重新生成。');
    if (c.action === 'confirmPackingOption') {
      if (chosenPacking.length) throw new Error('装箱方案已经确认，不能重复确认。');
      current.selected = current.packing.find((o) => o.packingOptionId === c.packingOptionId);
      offered(current.selected, c.packingOptionId, now);
      if (!Array.isArray(current.selected.packingGroups) || !current.selected.packingGroups.length) throw new Error('装箱方案缺少完整 packingGroups。');
      current.allocations = await Promise.all(current.selected.packingGroups.map(async (packingGroupId) => ({ packingGroupId, items: await read(store, 'packingGroupItems', c, { packingGroupId }) })));
      if (!same(current.allocations.reduce((t, g) => itemTotals(g.items, 1, t), {}), itemTotals(current.items))) throw new Error('装箱方案分组总数与计划商品不一致。');
    }
    if (c.action === 'setPackingInformation') {
      if (chosenPacking.length !== 1) throw new Error('先确认装箱方案并核验，再填写箱内明细。');
      const afterPlacement = chosenPlacement.length === 1;
      const field = afterPlacement ? 'shipmentId' : 'packingGroupId';
      const expectedIds = afterPlacement ? chosenPlacement[0].shipmentIds : chosenPacking[0].packingGroups;
      const ids = c.body.packageGroupings.map((g) => g[field]);
      if (!same(sorted(unique(ids, '装箱分组')), sorted(expectedIds || []))) throw new Error('装箱分组必须覆盖当前已确认方案的全部分组/货件。');
      current.groups = [];
      for (const group of c.body.packageGroupings) {
        if ((!!group.packingGroupId + !!group.shipmentId) !== 1 || !group[field]) throw new Error('分仓确认前仅用 packingGroupId，确认后仅用 shipmentId，不能混用。');
        const groupItems = await read(store, afterPlacement ? 'shipmentItems' : 'packingGroupItems', c, { [field]: group[field] });
        const totals = {};
        for (const box of group.boxes) {
          if (box.contentInformationSource !== 'BOX_CONTENT_PROVIDED' || !Array.isArray(box.items) || !box.items.length) throw new Error('本版要求每箱提供完整商品明细，不使用手工补填或二维条码代替箱内明细。');
          itemTotals(box.items, box.quantity, totals);
          if (!prepMatches(groupItems, box.items)) throw new Error('箱内预处理责任与计划商品不一致。');
        }
        if (!same(totals, itemTotals(groupItems))) throw new Error('箱内商品数量（每箱数量 × 箱数）与当前分组/货件不一致。');
        current.groups.push({ [field]: group[field], items: groupItems });
      }
    }
    if (c.action === 'generatePlacementOptions') {
      if (chosenPacking.length !== 1) throw new Error('本版采用先装箱流程：请先确认装箱方案。');
      if (chosenPlacement.length) throw new Error('分仓方案已确认，不能重新生成。');
      current.boxes = await read(store, 'planBoxes', c);
      if (!current.boxes.length || !same(current.boxes.reduce((t, b) => itemTotals(b.items, b.quantity, t), {}), itemTotals(current.items))) throw new Error('请先完成全部装箱信息并核验件数，再生成分仓方案。');
    }
    if (c.action === 'confirmPlacementOption') {
      if (chosenPlacement.length) throw new Error('分仓方案已确认且不可切换，不重复确认。');
      current.selected = current.placement.find((o) => o.placementOptionId === c.placementOptionId);
      offered(current.selected, c.placementOptionId, now);
      if (!current.selected.shipmentIds?.length) throw new Error('分仓方案缺少货件。');
      current.shipments = await Promise.all(current.selected.shipmentIds.map((shipmentId) => read(store, 'shipment', c, { shipmentId })));
      current.allocations = await Promise.all(current.selected.shipmentIds.map(async (shipmentId) => ({ shipmentId, items: await read(store, 'shipmentItems', c, { shipmentId }) })));
      if (!same(current.allocations.reduce((t, g) => itemTotals(g.items, 1, t), {}), itemTotals(current.items))) throw new Error('分仓方案的各货件合计与计划商品不一致。');
    }
    if (c.action === 'generateTransportationOptions') {
      current.selected = current.placement.find((o) => o.placementOptionId === c.body.placementOptionId);
      if (!current.selected || !['OFFERED', 'ACCEPTED'].includes(current.selected.status)) throw new Error('运输请求的分仓方案不属于当前有效计划。');
      deadline(current.selected.expiration, '分仓方案', now);
      const ids = unique(c.body.shipmentTransportationConfigurations.map((x) => x.shipmentId), '运输货件');
      if (!same(sorted(ids), sorted(current.selected.shipmentIds || []))) throw new Error('运输配置必须覆盖所选分仓方案的全部货件。');
      current.shipments = await Promise.all(ids.map((shipmentId) => read(store, 'shipment', c, { shipmentId })));
      if (current.shipments.some((s) => s.selectedTransportationOptionId)) throw new Error('已有已确认运输，不能再次生成运输方案。');
      for (const cfg of c.body.shipmentTransportationConfigurations) {
        deadline(cfg.readyToShipWindow.start, '备货/提货日期', now, true);
        if (cfg.pallets?.some((p) => !p.dimensions || !p.weight || !p.stackability)) throw new Error('本版托盘报价需要完整尺寸、重量、可堆叠性与数量，以便独立核验。');
      }
    }
    if (c.action === 'confirmTransportationOptions') {
      if (chosenPlacement.length !== 1) throw new Error('请先确认分仓方案并核验，再确认运输及费用。');
      const ids = unique(c.body.transportationSelections.map((x) => x.shipmentId), '运输货件');
      if (!same(sorted(ids), sorted(chosenPlacement[0].shipmentIds || []))) throw new Error('必须一次确认当前分仓方案的全部货件运输。');
      current.shipments = await Promise.all(ids.map((shipmentId) => read(store, 'shipment', c, { shipmentId })));
      if (current.shipments.some((s) => s.selectedTransportationOptionId)) throw new Error('已有已确认运输，不能重复确认或扣费。');
      current.transport = await read(store, 'transportationOptions', c, { filters: { placementOptionId: chosenPlacement[0].placementOptionId } });
      current.selectedTransport = c.body.transportationSelections.map((selection) => {
        const option = current.transport.find((o) => o.transportationOptionId === selection.transportationOptionId && o.shipmentId === selection.shipmentId);
        if (!option) throw new Error('运输选项 ID 与货件不匹配。');
        if (!['AMAZON_PARTNERED_CARRIER', 'USE_YOUR_OWN_CARRIER'].includes(option.shippingSolution) || !Array.isArray(option.preconditions)) throw new Error('运输方案的承运方式或前置条件不完整。');
        if (option.preconditions.some((p) => p !== 'CONFIRMED_DELIVERY_WINDOW')) throw new Error('运输方案有尚不支持的前置条件。');
        if (option.preconditions.includes('CONFIRMED_DELIVERY_WINDOW') && !current.shipments.find((s) => s.shipmentId === selection.shipmentId)?.selectedDeliveryWindow) throw new Error('该运输方案要求先确认到仓窗口。');
        if (option.shippingSolution === 'AMAZON_PARTNERED_CARRIER') {
          if (!object(option.quote?.cost) || typeof option.quote.cost.amount !== 'number' || !Number.isFinite(option.quote.cost.amount) || option.quote.cost.amount < 0 || !/^[A-Z]{3}$/.test(option.quote.cost.code)) throw new Error('合作承运报价金额/币种不完整，不能确认扣款。');
          deadline(option.quote.expiration, '运输报价', now, true);
        } else if (option.quote) deadline(option.quote.expiration, '运输报价', now);
        return option;
      });
      current.pallets = [];
      for (const option of current.selectedTransport.filter((o) => ['FREIGHT_LTL', 'FREIGHT_FTL_PALLET'].includes(o.shippingMode))) {
        const pallets = await read(store, 'shipmentPallets', c, { shipmentId: option.shipmentId });
        if (!pallets.length) throw new Error('本版托盘货运确认需要完整托盘清单。');
        palletCounts(pallets);
        current.pallets.push({ shipmentId: option.shipmentId, pallets });
      }
    }
    if (['generateDeliveryWindowOptions', 'confirmDeliveryWindowOptions', 'updateShipmentTrackingDetails'].includes(c.action)) {
      current.shipment = await read(store, 'shipment', c, { shipmentId: c.shipmentId });
      if (!plan.shipments?.some((s) => s.shipmentId === c.shipmentId)) throw new Error('该动作需要已确认分仓方案的货件。');
    }
    if (c.action === 'confirmDeliveryWindowOptions') {
      current.windows = await read(store, 'deliveryWindowOptions', c, { shipmentId: c.shipmentId });
      current.selected = current.windows.find((o) => o.deliveryWindowOptionId === c.deliveryWindowOptionId);
      if (!current.selected || !['AVAILABLE', 'CONGESTED', 'DISCOUNTED'].includes(current.selected.availabilityType)) throw new Error('所选到仓窗口不可用。');
      deadline(current.selected.validUntil, '到仓窗口', now, true);
      if (current.shipment.selectedDeliveryWindow?.deliveryWindowOptionId === c.deliveryWindowOptionId) throw new Error('到仓窗口已经确认，不重复提交。');
      if (current.shipment.selectedDeliveryWindow) deadline(current.shipment.selectedDeliveryWindow.editableUntil, '原到仓窗口可编辑期', now, true);
    }
    if (c.action === 'generateDeliveryWindowOptions' && current.shipment.selectedDeliveryWindow) throw new Error('已确认到仓窗口，不能重新生成候选窗口。');
    if (c.action === 'updateShipmentTrackingDetails') {
      const details = c.body.trackingDetails;
      if ((!!details.spdTrackingDetail + !!details.ltlTrackingDetail) !== 1) throw new Error('每次只更新小包或卡车其中一种跟踪信息。');
      current.transport = await read(store, 'transportationOptions', c, { shipmentId: c.shipmentId });
      const chosen = current.transport.find((o) => o.transportationOptionId === current.shipment.selectedTransportationOptionId);
      if (!chosen || chosen.shippingSolution !== 'USE_YOUR_OWN_CARRIER') throw new Error('跟踪信息写入只用于已确认的自选承运方式。');
      if (details.spdTrackingDetail) {
        if (!['GROUND_SMALL_PARCEL', 'AIR_SMALL_PARCEL', 'AIR_SMALL_PARCEL_EXPRESS'].includes(chosen.shippingMode)) throw new Error('小包跟踪信息与当前运输方式不匹配。');
        const rows = details.spdTrackingDetail.spdTrackingItems;
        if (!rows.length) throw new Error('跟踪箱号明细不能为空。');
        unique(rows.map((x) => x.boxId), '跟踪箱号');
        current.boxes = await read(store, 'shipmentBoxes', c, { shipmentId: c.shipmentId });
        if (rows.some((x) => !current.boxes.some((b) => b.boxId === x.boxId))) throw new Error('跟踪箱号不属于当前货件。');
        if (current.boxes.some((b) => !b.boxId || b.quantity !== 1) || !same(sorted(rows.map((x) => x.boxId)), sorted(current.boxes.map((b) => b.boxId)))) throw new Error('本版跟踪提交必须覆盖货件全部独立箱号，不能把部分箱子当完整发运。');
      } else if (!['FREIGHT_LTL', 'FREIGHT_FTL_PALLET', 'FREIGHT_FTL_NONPALLET'].includes(chosen.shippingMode)) {
        throw new Error('货运跟踪信息与当前运输方式不匹配；海运及未知模式暂不支持写入。');
      }
      if (contains(current.shipment.trackingDetails, details)) throw new Error('跟踪信息与当前一致，不重复更新。');
    }
    return current;
  }

  const op = {
    id: OP, group: 'FBA 物流', label: '创建与管理美国站 FBA 入仓计划和货件', risk: '高', beta: true, special: true, exclusive: true, implemented: true, channel: 'spapi', capability: 'api', api: 'Fulfillment Inbound 2024-03-20',
    requirements: 'Amazon Fulfillment 角色、美国站卖家授权；每个异步动作分别批准并核验。',
    limitation: '需单独打开，不跟随一键全开。先装箱流程；不采购、不取消、不替代承运商实际发运。确认合作承运会接受报价并授权扣款。',
    params: { action: [...Object.keys(FBA_ACTIONS), ...DOCUMENT_ACTIONS].join(' / '), inboundPlanId: '除创建外必填', body: '官方动作完整 JSON；无请求体动作不传。generateLabels 用 PageType/LabelType 及明确打印范围，见 docs/fba-inbound.md', marketplace: '本版写入 US' },
    creates: (c) => c.action === 'createInboundPlan', creationIdentity,
    mutationIdentity: (c, req) => ({ binding: req?.binding, target: c.action === 'createInboundPlan' ? creationIdentity(c) : c.inboundPlanId }),
    executionLockKey: (req) => `fba-account:${canonical(req?.binding)}`,
    bindingIssue,
    async read(store, c) {
      const old = await snapshot(store, c);
      return { marketplace: 'US', old, entity: { name: c.body?.name || old.plan?.name, inboundPlanId: c.inboundPlanId } };
    },
    check(c, r) {
      const warnings = ['每份提案只执行当前动作；异步任务完成并核验后才能准备下一步。货件创建、标签准备、实际发运、仓库接收和可售是不同状态。'];
      if (c.action === 'confirmPlacementOption') warnings.push('确认后该计划不能更换分仓方案；批准范围包含以下分仓费用及仓库/货件分配。');
      if (c.action === 'confirmTransportationOptions') warnings.push('合作承运确认会接受报价、授权 Amazon 扣款并请求承运；自选承运的第三方运费不在 Amazon 报价中，未知不能视为免费。');
      if (c.action === 'updateShipmentTrackingDetails') warnings.push('跟踪号录入不代表承运验证、已发运或已签收；保留平台跟踪号验证状态。');
      if (DOCUMENT_ACTIONS.includes(c.action)) warnings.push('本次仅生成并下载获批文档，核对货件号及文件校验值；不等于已发运或 READY_TO_SHIP。下载失败不会自动重新生成。');
      return { newValue: { action: c.action, binding: r.old.binding, ...(c.inboundPlanId ? { inboundPlanId: c.inboundPlanId } : {}),
        ...(c.body !== undefined ? { body: copy(c.body) } : {}),
        ...(r.old.selected ? { selected: copy(r.old.selected) } : {}),
        ...(r.old.selectedTransport ? { selectedTransport: copy(r.old.selectedTransport) } : {}),
        ...(r.old.shipments ? { shipments: copy(r.old.shipments) } : {}),
        ...(r.old.allocations ? { allocations: copy(r.old.allocations) } : {}),
        ...(r.old.pallets ? { pallets: copy(r.old.pallets) } : {}),
        ...(r.old.document ? { document: copy(r.old.document.expected) } : {}),
        ...(c.shipmentId ? { shipmentId: c.shipmentId } : {}),
      }, warnings };
    },
    build(c, r, expected) {
      const spec = input(c);
      if (DOCUMENT_ACTIONS.includes(c.action)) return { method: 'GET', path: r.old.document.path, query: copy(r.old.document.query), action: c.action,
        binding: r.old.binding, marketplace: 'US', expected, inboundPlanId: c.inboundPlanId };
      return { method: spec.method, path: spec.path.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(c[key])), action: c.action,
        binding: r.old.binding, marketplace: 'US', expected, ...(c.body !== undefined ? { body: copy(c.body) } : {}),
        ...(c.inboundPlanId ? { inboundPlanId: c.inboundPlanId } : {}) };
    },
    async send(store, req, { checkpoint } = {}) {
      const issue = bindingIssue(store, req); if (issue) throw new Error(issue);
      for (const option of [req.expected.selected, ...(req.expected.selectedTransport || [])].filter(Boolean)) {
        deadline(option.expiration, '已批准选项', now);
        deadline(option.validUntil, '已批准窗口', now);
        deadline(option.quote?.expiration, '已批准报价', now);
      }
      let result = { ok: false, status: 'OUTCOME_UNKNOWN', stage: `${req.action}_SENDING`, action: req.action, binding: req.binding,
        ...(req.inboundPlanId ? { inboundPlanId: req.inboundPlanId } : {}), attemptedAt: new Date(now()).toISOString() };
      await checkpoint?.(result);
      let response;
      try {
        if (api === spapi) {
          const freshIssue = bindingIssue(getStore(store.alias), req);
          if (freshIssue) { result = { ...result, status: 'SKIPPED_STALE', error: freshIssue }; await checkpoint?.(result); return result; }
        }
        response = await api(store.alias, req.method, req.path, { ...(req.body !== undefined ? { body: req.body } : {}), ...(req.query ? { query: req.query } : {}), isWrite: true });
      }
      catch (e) {
        const definite = e instanceof HttpError && [400, 401, 403, 404, 413, 415, 422, 429].includes(e.status);
        result = { ...result, status: definite ? 'FAILED' : 'OUTCOME_UNKNOWN', stage: `${req.action}_HTTP_FAILED`, error: e.message };
        await checkpoint?.(result); return result;
      }
      if (DOCUMENT_ACTIONS.includes(req.action)) {
        if (!object(response) || (response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length)) || typeof response.payload?.DownloadURL !== 'string' || !response.payload.DownloadURL) {
          result = { ...result, error: '文档生成响应缺失有效下载地址；只保留原提案，不能自动重试。' };
          await checkpoint?.(result); return result;
        }
        // Persist a known generation before downloading. Presigned URLs never
        // enter proposals, receipts or the log, including failure paths.
        result = { ...result, ok: true, status: 'SUBMITTED', stage: `${req.action}_GENERATED`, documentGenerated: true, documentScope: copy(req.expected.document) };
        await checkpoint?.(result);
        try { result.artifact = await downloadDocument(response.payload.DownloadURL, { kind: req.action, now }); }
        catch { result.downloadFailed = true; result.note = '平台已返回文档下载地址，但本机文件未保存或校验失败；不会重新生成。'; }
        await checkpoint?.(result); return result;
      }
      if (req.action === 'createInboundPlan' && object(response)) {
        // Retain each independently valid known ID even if the other receipt
        // field is missing. An unknown creation still owns its returned plan.
        try { fbaId(response.inboundPlanId, 'inboundPlanId'); result.inboundPlanId = response.inboundPlanId; } catch { /* unknown plan */ }
        try { fbaId(response.operationId, 'operationId', { min: 36, max: 38 }); result.operationId = response.operationId; } catch { /* unknown operation */ }
      }
      try {
        if (!object(response) || (response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length))) throw new Error('异步响应不完整或包含错误。');
        fbaId(response.operationId, 'operationId', { min: 36, max: 38 });
        if (req.action === 'createInboundPlan') fbaId(response.inboundPlanId, 'inboundPlanId');
        if (req.inboundPlanId && response.inboundPlanId && req.inboundPlanId !== response.inboundPlanId) throw new Error('异步响应计划 ID 不匹配。');
        result = { ...result, ok: true, status: 'SUBMITTED', stage: `${req.action}_ACCEPTED`, operationId: response.operationId,
          ...(response.inboundPlanId ? { inboundPlanId: response.inboundPlanId } : {}), response };
      } catch (e) { result = { ...result, response, error: `${e.message} 只查询原结果，不重新发送。` }; }
      await checkpoint?.(result);
      return result;
    },
    async readback(store, c, expected, sent = {}) {
      const issue = bindingIssue(store, { binding: expected.binding, marketplace: 'US' }); if (issue) throw new Error(issue);
      if (DOCUMENT_ACTIONS.includes(c.action)) {
        const actual = { documentGenerated: !!sent.documentGenerated, artifact: sent.artifact || null };
        if (!sent.documentGenerated) return { actual, match: false, status: 'OUTCOME_UNKNOWN', note: '未保存确定的文档生成响应；不自动重发。' };
        actual.shipment = await read(store, 'shipment', c, { shipmentId: c.shipmentId });
        if (!sent.artifact) return { actual, match: false, status: 'DOCUMENT_NOT_SAVED', note: '已取得文档生成响应，但没有保存可用 PDF。没有自动重发；需要重新取得文档时另行审批。' };
        const artifact = sent.artifact, file = path.resolve(artifact.path || '');
        const relative = path.relative(path.resolve(p('documents')), file);
        const inside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        let fileMatches = false;
        if (inside && fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink()) {
          const data = fs.readFileSync(file);
          fileMatches = data.length === artifact.bytes && sha256(data) === artifact.sha256 && data.subarray(0, 5).toString() === '%PDF-';
        }
        const match = fileMatches && same(sent.documentScope, expected.document)
          && actual.shipment.shipmentConfirmationId === expected.document.shipmentConfirmationId
          && actual.shipment.selectedTransportationOptionId === expected.document.transportationOptionId;
        return { actual, match, status: match ? 'API_STATE_VERIFIED' : 'AWAITING_READBACK', note: match ? '文档已保存，文件校验值与货件/运输编号已核对。打印前仍须查看 PDF；不等于 READY_TO_SHIP、实际发运或仓库接收。' : '文档文件或当前货件绑定未匹配；不重新生成。' };
      }
      if (!sent.operationId) return { actual: { inboundPlanId: sent.inboundPlanId || c.inboundPlanId || null }, match: false, status: 'OUTCOME_UNKNOWN', note: '缺少原异步任务 ID；同名计划只是线索，不能认领成功或重新提交。' };
      const operation = await read(store, 'operation', { marketplace: 'US' }, { operationId: sent.operationId });
      if (operation.operation !== c.action || operation.operationId !== sent.operationId || !Array.isArray(operation.operationProblems)) throw new Error('异步任务名称/ID/问题明细不匹配，不能核验。');
      if (operation.operationStatus === 'IN_PROGRESS') return { actual: { operation }, match: false, status: 'SUBMITTED', note: 'Amazon 正在处理原请求；稍后只核验，不重发。' };
      if (operation.operationStatus !== 'SUCCESS' || operation.operationProblems.some((p) => p.severity === 'ERROR')) return { actual: { operation }, match: false, status: 'PARTIALLY_SUCCEEDED', note: '异步任务失败或有错误，需核对已生成对象和影响范围；暂不解除防重，不能自动重试。' };
      const planId = sent.inboundPlanId || c.inboundPlanId;
      if (!planId) throw new Error('原创建任务未保存计划 ID，不能靠同名计划认领成功。');
      const scope = { marketplace: 'US', inboundPlanId: planId };
      const plan = await read(store, 'plan', scope);
      const actual = { operation, plan };
      let match = false;
      if (c.action === 'createInboundPlan') {
        actual.items = await read(store, 'planItems', scope);
        match = plan.name === expected.body.name && same(sorted(plan.marketplaceIds), sorted(expected.body.destinationMarketplaces))
          && contains(plan.sourceAddress, expected.body.sourceAddress) && same(itemTotals(actual.items), itemTotals(expected.body.items)) && prepMatches(actual.items, expected.body.items);
      } else if (['generatePackingOptions', 'confirmPackingOption'].includes(c.action)) {
        actual.options = await read(store, 'packingOptions', scope);
        match = c.action === 'generatePackingOptions' ? actual.options.length > 0
          : actual.options.some((o) => o.packingOptionId === c.packingOptionId && o.status === 'ACCEPTED' && same(o.packingGroups, expected.selected.packingGroups) && same(o.fees, expected.selected.fees) && same(o.discounts, expected.selected.discounts));
        if (c.action === 'confirmPackingOption') {
          actual.allocations = await Promise.all(expected.allocations.map(async (g) => ({ packingGroupId: g.packingGroupId, items: await read(store, 'packingGroupItems', scope, { packingGroupId: g.packingGroupId }) })));
          match &&= expected.allocations.every((g) => same(inventoryEvidence(g.items), inventoryEvidence(actual.allocations.find((a) => a.packingGroupId === g.packingGroupId).items)));
        }
      } else if (c.action === 'setPackingInformation') {
        actual.groups = [];
        match = true;
        for (const group of expected.body.packageGroupings) {
          const shipment = !!group.shipmentId;
          const boxes = await read(store, shipment ? 'shipmentBoxes' : 'packingGroupBoxes', scope, shipment ? { shipmentId: group.shipmentId } : { packingGroupId: group.packingGroupId });
          actual.groups.push({ groupId: group.shipmentId || group.packingGroupId, boxes });
          const signature = (b) => canonical({ contentInformationSource: b.contentInformationSource, dimensions: b.dimensions, weight: b.weight, items: itemTotals(b.items) });
          const counts = (values) => values.reduce((totals, box) => { if (!Number.isSafeInteger(box.quantity) || box.quantity < 1) throw new Error('箱数回执缺失。'); const key = signature(box); totals[key] = (totals[key] || 0) + box.quantity; return totals; }, {});
          match &&= same(counts(boxes), counts(group.boxes));
          match &&= boxes.every((b) => group.boxes.some((e) => signature(b) === signature(e) && prepMatches(b.items, e.items)));
        }
      } else if (['generatePlacementOptions', 'confirmPlacementOption'].includes(c.action)) {
        actual.options = await read(store, 'placementOptions', scope);
        match = c.action === 'generatePlacementOptions' ? actual.options.length > 0
          : actual.options.some((o) => o.placementOptionId === c.placementOptionId && o.status === 'ACCEPTED' && same(sorted(o.shipmentIds), sorted(expected.selected.shipmentIds)) && same(o.fees, expected.selected.fees) && same(o.discounts, expected.selected.discounts));
        if (c.action === 'confirmPlacementOption') {
          actual.shipments = await Promise.all(expected.shipments.map((s) => read(store, 'shipment', scope, { shipmentId: s.shipmentId })));
          actual.allocations = await Promise.all(expected.allocations.map(async (g) => ({ shipmentId: g.shipmentId, items: await read(store, 'shipmentItems', scope, { shipmentId: g.shipmentId }) })));
          match &&= same(sorted((plan.shipments || []).map((s) => s.shipmentId)), sorted(expected.selected.shipmentIds));
          match &&= expected.shipments.every((s) => same(shipmentRoute(s), shipmentRoute(actual.shipments.find((a) => a.shipmentId === s.shipmentId))));
          match &&= expected.allocations.every((g) => same(inventoryEvidence(g.items), inventoryEvidence(actual.allocations.find((a) => a.shipmentId === g.shipmentId).items)));
        }
      } else if (c.action === 'generateTransportationOptions') {
        actual.options = await read(store, 'transportationOptions', scope, { filters: { placementOptionId: expected.body.placementOptionId } });
        match = expected.body.shipmentTransportationConfigurations.every((s) => actual.options.some((o) => o.shipmentId === s.shipmentId));
        actual.shipments = await Promise.all(expected.body.shipmentTransportationConfigurations.map((s) => read(store, 'shipment', scope, { shipmentId: s.shipmentId })));
        match &&= expected.body.shipmentTransportationConfigurations.every((s) => {
          const shipment = actual.shipments.find((a) => a.shipmentId === s.shipmentId);
          return sameInstant(shipment.dates?.readyToShipWindow?.start, s.readyToShipWindow.start, true)
            && (!s.contactInformation || contains(shipment.contactInformation, s.contactInformation))
            && (!s.freightInformation || contains(shipment.freightInformation, s.freightInformation));
        });
        actual.pallets = [];
        for (const cfg of expected.body.shipmentTransportationConfigurations.filter((s) => s.pallets !== undefined)) {
          const pallets = await read(store, 'shipmentPallets', scope, { shipmentId: cfg.shipmentId });
          actual.pallets.push({ shipmentId: cfg.shipmentId, pallets });
          match &&= same(palletCounts(pallets), palletCounts(cfg.pallets));
        }
      } else if (c.action === 'confirmTransportationOptions') {
        actual.shipments = await Promise.all(expected.body.transportationSelections.map((s) => read(store, 'shipment', scope, { shipmentId: s.shipmentId })));
        match = expected.body.transportationSelections.every((s) => actual.shipments.some((a) => a.shipmentId === s.shipmentId && a.selectedTransportationOptionId === s.transportationOptionId && (!s.contactInformation || contains(a.contactInformation, s.contactInformation))));
        actual.options = await read(store, 'transportationOptions', scope);
        match &&= expected.selectedTransport.every((o) => actual.options.some((a) => same(transportationEvidence(a), transportationEvidence(o))));
        match &&= expected.shipments.every((s) => same(shipmentRoute(s), shipmentRoute(actual.shipments.find((a) => a.shipmentId === s.shipmentId))));
        actual.pallets = [];
        for (const approved of expected.pallets || []) {
          const pallets = await read(store, 'shipmentPallets', scope, { shipmentId: approved.shipmentId });
          actual.pallets.push({ shipmentId: approved.shipmentId, pallets });
          match &&= same(palletCounts(pallets), palletCounts(approved.pallets));
        }
      } else if (c.action === 'generateDeliveryWindowOptions') {
        actual.options = await read(store, 'deliveryWindowOptions', scope, { shipmentId: c.shipmentId }); match = actual.options.length > 0;
      } else if (c.action === 'confirmDeliveryWindowOptions') {
        actual.shipment = await read(store, 'shipment', scope, { shipmentId: c.shipmentId });
        const selected = actual.shipment.selectedDeliveryWindow;
        match = selected?.deliveryWindowOptionId === c.deliveryWindowOptionId
          && sameInstant(selected.startDate, expected.selected.startDate) && sameInstant(selected.endDate, expected.selected.endDate);
      } else if (c.action === 'updateShipmentTrackingDetails') {
        actual.shipment = await read(store, 'shipment', scope, { shipmentId: c.shipmentId });
        const target = expected.body.trackingDetails;
        match = target.spdTrackingDetail ? target.spdTrackingDetail.spdTrackingItems.every((i) => actual.shipment.trackingDetails?.spdTrackingDetail?.spdTrackingItems?.some((a) => a.boxId === i.boxId && a.trackingId === i.trackingId))
          : contains(actual.shipment.trackingDetails?.ltlTrackingDetail, target.ltlTrackingDetail);
      }
      return { actual, match, status: match ? 'API_STATE_VERIFIED' : 'AWAITING_READBACK', note: match ? '已核验本次 FBA 动作的接口状态；不代表实际发运、到仓接收、可售或第三方运费已结清。' : '异步任务完成但独立回读尚未完整匹配，只核验原请求，不重发。' };
    },
  };
  return op;
}

export const FBA_INBOUND_OP = createFbaInboundOperation();
