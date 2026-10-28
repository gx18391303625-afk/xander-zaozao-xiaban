import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isolate } from './helpers.js';

// Every response is synthetic and injected directly; no credentials or network.
const home = isolate();
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network is forbidden in FBA reader tests'); };
const { createFbaReader, FBA_READ_RESOURCES } = await import('../lib/fba-inbound-api.js');
const { marketplace } = await import('../lib/regions.js');
test.after(() => { globalThis.fetch = originalFetch; fs.rmSync(home, { recursive: true, force: true }); });

const BASE = '/inbound/fba/2024-03-20';
const uuid = '00000000-0000-0000-0000-000000000001';
const PLAN = `wf${uuid}`, SHIPMENT = `sh${uuid}`, GROUP = `pg${uuid}`, PLACEMENT = `pl${uuid}`;
const OTHER = `zz${uuid}`;
const PLAN_PATH = `${BASE}/inboundPlans/${PLAN}`;
const SHIPMENT_PATH = `${PLAN_PATH}/shipments/${SHIPMENT}`;
const storeFor = (code = 'US') => ({ alias: `synthetic-fba-${code}`, region: marketplace(code).region, defaultMarketplace: code, marketplaces: [code] });
const planFor = (code = 'US') => ({ inboundPlanId: PLAN, marketplaceIds: [marketplace(code).id], shipments: [{ shipmentId: SHIPMENT, status: 'WORKING' }], name: 'Synthetic inbound plan', sourceAddress: { name: 'Synthetic sender', countryCode: 'US' } });
const shipment = () => ({ shipmentId: SHIPMENT, shipmentConfirmationId: 'FBA-SYNTHETIC', status: 'WORKING', destination: { destinationType: 'AMAZON_WAREHOUSE', warehouseId: 'SYN1' } });
const input = (resource, extra = {}) => ({ resource, marketplace: 'US', ...(!['plans', 'operation'].includes(resource) ? { inboundPlanId: PLAN } : {}), ...extra });
const listing = (key, items, nextToken) => ({ [key]: items, ...(nextToken === undefined ? {} : { pagination: { nextToken } }) });

function harness(routes = {}, code = 'US') {
  const calls = [];
  const defaults = {
    [PLAN_PATH]: planFor(code),
    [SHIPMENT_PATH]: shipment(),
    [`${PLAN_PATH}/packingOptions`]: listing('packingOptions', [{ packingOptionId: `po${uuid}`, packingGroups: [GROUP], status: 'OFFERED' }]),
    [`${PLAN_PATH}/placementOptions`]: listing('placementOptions', [{ placementOptionId: PLACEMENT, shipmentIds: [SHIPMENT], status: 'OFFERED' }]),
  };
  const api = async (alias, method, path, options) => {
    calls.push(structuredClone({ alias, method, path, ...options }));
    assert.equal(method, 'GET');
    assert.equal(options.isWrite, false);
    assert.equal(options.body, undefined);
    assert.equal(alias, storeFor(code).alias);
    const route = Object.hasOwn(routes, path) ? routes[path] : defaults[path];
    assert.notEqual(route, undefined, `Unexpected synthetic route: ${path}`);
    return typeof route === 'function' ? route(options.query, calls) : route;
  };
  return { ...createFbaReader({ api }), calls, store: storeFor(code) };
}

test('regional plans are fully paged then selected by marketplace without altering raw evidence', async () => {
  const ca = { ...planFor('CA'), inboundPlanId: OTHER };
  const us = planFor();
  const multi = { ...planFor(), inboundPlanId: `mm${uuid}`, marketplaceIds: [marketplace('US').id, marketplace('CA').id] };
  const first = listing('inboundPlans', [ca, multi], 'next-region-page');
  const last = listing('inboundPlans', [us]);
  const before = structuredClone([first, last]);
  const h = harness({ [`${BASE}/inboundPlans`]: (query) => query.paginationToken ? last : first });
  const result = await h.read(h.store, input('plans', { filters: { pageSize: 30, status: 'ACTIVE', sortBy: 'LAST_UPDATED_TIME', sortOrder: 'DESC' } }));
  assert.equal(result.complete, true);
  assert.equal(result.pages, 2);
  assert.equal(result.nextPaginationToken, null);
  assert.equal(result.rawPagesScope, 'REGION');
  assert.equal(result.excludedCount, 2);
  assert.deepEqual(result.items, [us]);
  assert.deepEqual(result.data.inboundPlans, [us]);
  assert.deepEqual(result.rawPages, before);
  assert.deepEqual([first, last], before);
  assert.deepEqual(h.calls.map((call) => call.query), [
    { pageSize: 30, status: 'ACTIVE', sortBy: 'LAST_UPDATED_TIME', sortOrder: 'DESC' },
    { pageSize: 30, status: 'ACTIVE', sortBy: 'LAST_UPDATED_TIME', sortOrder: 'DESC', paginationToken: 'next-region-page' },
  ]);
});

test('NA EU FE detail reads validate selected plan scope and preserve every API field', async () => {
  for (const code of ['US', 'DE', 'JP']) {
    const h = harness({}, code);
    const result = await h.read(h.store, input('plan', { marketplace: code }));
    assert.equal(result.marketplaceId, marketplace(code).id);
    assert.equal(result.region, marketplace(code).region);
    assert.equal(result.complete, true);
    assert.deepEqual(result.data, planFor(code));
    assert.deepEqual(result.rawPages, [planFor(code)]);
    assert.equal(result.rawPagesScope, 'REQUESTED_RESOURCE');
    assert.deepEqual(result.scope, { inboundPlanId: PLAN });
    assert.equal(h.calls.length, 1);
  }
});

test('each list uses its official route and page size ceiling, including group and shipment scopes', async () => {
  const cases = [
    ['plans', 'inboundPlans', `${BASE}/inboundPlans`, 30, {}],
    ['planItems', 'items', `${PLAN_PATH}/items`, 1000, {}],
    ['planBoxes', 'boxes', `${PLAN_PATH}/boxes`, 1000, {}],
    ['packingOptions', 'packingOptions', `${PLAN_PATH}/packingOptions`, 20, {}],
    ['packingGroupItems', 'items', `${PLAN_PATH}/packingGroups/${GROUP}/items`, 100, { packingGroupId: GROUP }],
    ['packingGroupBoxes', 'boxes', `${PLAN_PATH}/packingGroups/${GROUP}/boxes`, 100, { packingGroupId: GROUP }],
    ['placementOptions', 'placementOptions', `${PLAN_PATH}/placementOptions`, 20, {}],
    ['transportationOptions', 'transportationOptions', `${PLAN_PATH}/transportationOptions`, 20, {}],
    ['shipmentItems', 'items', `${SHIPMENT_PATH}/items`, 1000, { shipmentId: SHIPMENT }],
    ['shipmentBoxes', 'boxes', `${SHIPMENT_PATH}/boxes`, 1000, { shipmentId: SHIPMENT }],
    ['shipmentPallets', 'pallets', `${SHIPMENT_PATH}/pallets`, 1000, { shipmentId: SHIPMENT }],
    ['deliveryWindowOptions', 'deliveryWindowOptions', `${SHIPMENT_PATH}/deliveryWindowOptions`, 100, { shipmentId: SHIPMENT }],
  ];
  for (const [resource, key, path, max, scope] of cases) {
    const h = harness({ [path]: listing(key, []) });
    const result = await h.read(h.store, input(resource, { ...scope, filters: { pageSize: max } }));
    assert.equal(result.complete, true, resource);
    assert.deepEqual(result.items, []);
    assert.deepEqual(h.calls.at(-1).query, { pageSize: max });
    for (const invalid of [max + 1, 0, -1, 1.5, '10', null]) {
      const n = h.calls.length;
      await assert.rejects(h.read(h.store, input(resource, { ...scope, filters: { pageSize: invalid } })), /pageSize/);
      assert.equal(h.calls.length, n, 'bad page size must fail before requests');
    }
  }
});

test('rejects arbitrary paths, label GETs, wrong scope and malformed IDs before any API call', async () => {
  const h = harness();
  const bad = [
    input('labels'), input('billOfLading'), input('constructor'),
    input('plan', { path: '/arbitrary' }), input('plan', { body: {} }),
    input('plan', { inboundPlanId: `${PLAN}/../labels` }), input('plan', { inboundPlanId: 123 }),
    input('plan', { inboundPlanId: 'x'.repeat(37) }), input('plan', { inboundPlanId: 'x'.repeat(39) }),
    input('plan', { marketplace: 'DE' }), input('plan', { marketplace: 'CA' }),
    input('plan', { marketplace: null }), input('plan', { marketplace: '' }), input('plan', { marketplace: ['US'] }),
    input('plan', { shipmentId: SHIPMENT }), input('plan', { packingGroupId: GROUP }),
    input('plan', { operationId: uuid }), input('plans', { inboundPlanId: PLAN }),
    input('operation', { operationId: uuid, inboundPlanId: PLAN }),
    input('shipment'), input('shipmentPallets'), input('packingGroupBoxes'), input('operation'),
    input('plans', { filters: { marketplaceIds: ['ATVPDKIKX0DER'] } }),
    input('planItems', { filters: { status: 'ACTIVE' } }), input('plan', { filters: { pageSize: 1 } }),
    input('plans', { filters: { status: 'INVALID' } }), input('plans', { filters: { sortBy: 'NAME' } }),
    input('plans', { filters: { sortOrder: 'ascending' } }), input('plans', { filters: [] }), input('plans', { filters: null }),
    input('plans', { filters: { paginationToken: '' } }), input('plans', { filters: { paginationToken: 'x'.repeat(1025) } }),
    input('plan', { maxPages: 0 }), input('plan', { maxPages: 101 }), input('plan', { maxPages: 1.5 }), input('plan', { maxPages: null }),
  ];
  for (const args of bad) await assert.rejects(h.read(h.store, args), undefined, JSON.stringify(args));
  assert.equal(h.calls.length, 0);
});

test('wrong or uncertain plan identity or marketplace blocks all child reads', async () => {
  for (const value of [
    null, { ...planFor(), inboundPlanId: OTHER }, { ...planFor(), marketplaceIds: undefined },
    { ...planFor(), marketplaceIds: [] }, { ...planFor(), marketplaceIds: [marketplace('CA').id] },
    { ...planFor(), marketplaceIds: [marketplace('US').id, marketplace('CA').id] },
  ]) {
    const h = harness({ [PLAN_PATH]: value });
    await assert.rejects(h.read(h.store, input('planItems')));
    assert.deepEqual(h.calls.map((call) => call.path), [PLAN_PATH]);
  }
});

test('shipment membership is verified in plan summaries before reading boxes', async () => {
  const boxes = [{ boxId: 'synthetic-box-label-id', packageId: 'distinct-package-id', quantity: 1, items: [{ msku: 'SYNTHETIC-SKU', quantity: 12 }] }];
  const h = harness({ [`${SHIPMENT_PATH}/boxes`]: listing('boxes', boxes) });
  const result = await h.read(h.store, input('shipmentBoxes', { shipmentId: SHIPMENT }));
  assert.deepEqual(h.calls.map((call) => call.path), [PLAN_PATH, SHIPMENT_PATH, `${SHIPMENT_PATH}/boxes`]);
  assert.deepEqual(result.items, boxes);
  assert.equal(result.items[0].boxId, 'synthetic-box-label-id');
  assert.deepEqual(result.scope, { inboundPlanId: PLAN, shipmentId: SHIPMENT });
});

test('shipment pallets preserve every approved physical field across complete pagination', async () => {
  const path = `${SHIPMENT_PATH}/pallets`;
  const first = { packageId: `pa${uuid}`, quantity: 2, stackability: 'STACKABLE',
    dimensions: { height: 48, length: 40, width: 48, unitOfMeasurement: 'IN' },
    weight: { unit: 'LB', value: 250 }, futureMetadata: { preserve: true } };
  const last = { ...structuredClone(first), packageId: `pb${uuid}`, quantity: 1, stackability: 'NON_STACKABLE' };
  const raw = [listing('pallets', [first], 'pallet-page-2'), listing('pallets', [last])];
  const before = structuredClone(raw);
  const h = harness({ [path]: (query) => query.paginationToken ? raw[1] : raw[0] });
  const result = await h.read(h.store, input('shipmentPallets', { shipmentId: SHIPMENT, filters: { pageSize: 1000 } }));
  assert.equal(result.complete, true);
  assert.equal(result.pages, 2);
  assert.deepEqual(result.scope, { inboundPlanId: PLAN, shipmentId: SHIPMENT });
  assert.deepEqual(result.items, [first, last]);
  assert.deepEqual(result.data.pallets, [first, last]);
  assert.deepEqual(result.rawPages, before);
  assert.deepEqual(raw, before);
  assert.deepEqual(h.calls.map((call) => call.path), [PLAN_PATH, SHIPMENT_PATH, path, path]);
  assert.deepEqual(h.calls.filter((call) => call.path === path).map((call) => call.query), [
    { pageSize: 1000 }, { pageSize: 1000, paginationToken: 'pallet-page-2' },
  ]);
});

test('shipment pallets cannot bypass marketplace or shipment ownership checks', async () => {
  const path = `${SHIPMENT_PATH}/pallets`;
  const cases = [
    { [PLAN_PATH]: { ...planFor(), marketplaceIds: [marketplace('CA').id] } },
    { [PLAN_PATH]: { ...planFor(), shipments: [] }, [`${PLAN_PATH}/placementOptions`]: listing('placementOptions', []) },
    { [SHIPMENT_PATH]: { ...shipment(), shipmentId: OTHER } },
    { [PLAN_PATH]: { ...planFor(), shipments: [] }, [`${PLAN_PATH}/placementOptions`]: listing('placementOptions', [{ shipmentIds: [SHIPMENT] }], 'more-options') },
  ];
  for (const routes of cases) {
    const h = harness({ ...routes, [path]: listing('pallets', []) });
    await assert.rejects(h.read(h.store, input('shipmentPallets', { shipmentId: SHIPMENT, maxPages: 1 })));
    assert.equal(h.calls.some((call) => call.path === path), false);
  }
});

test('shipment pallet truncation stays incomplete and malformed or failed pages do not become empty success', async () => {
  const path = `${SHIPMENT_PATH}/pallets`;
  const pallet = { packageId: `pa${uuid}`, quantity: 1 };
  const partial = harness({ [path]: listing('pallets', [pallet], 'more-pallets') });
  const result = await partial.read(partial.store, input('shipmentPallets', { shipmentId: SHIPMENT, maxPages: 1 }));
  assert.equal(result.complete, false);
  assert.equal(result.pageComplete, false);
  assert.equal(result.nextPaginationToken, 'more-pallets');
  assert.deepEqual(result.items, [pallet]);
  for (const response of [{ boxes: [] }, { pallets: null }, { pallets: {} }]) {
    const h = harness({ [path]: response });
    await assert.rejects(h.read(h.store, input('shipmentPallets', { shipmentId: SHIPMENT })), /pallets/);
  }
  const lateError = harness({ [path]: (query) => {
    if (query.paginationToken) throw new Error('Synthetic pallet second-page failure');
    return listing('pallets', [pallet], 'more-pallets');
  } });
  await assert.rejects(lateError.read(lateError.store, input('shipmentPallets', { shipmentId: SHIPMENT })), /second-page failure/);
});

test('unconfirmed shipment membership uses every placement page and preserves shipment status', async () => {
  const h = harness({
    [PLAN_PATH]: { ...planFor(), shipments: [] },
    [`${PLAN_PATH}/placementOptions`]: (query) => query.paginationToken
      ? listing('placementOptions', [{ placementOptionId: PLACEMENT, shipmentIds: [SHIPMENT] }])
      : listing('placementOptions', [{ placementOptionId: OTHER, shipmentIds: [OTHER] }], 'placement-2'),
  });
  const result = await h.read(h.store, input('shipment', { shipmentId: SHIPMENT }));
  assert.equal(result.data.status, 'WORKING');
  assert.equal(result.data.shipmentConfirmationId, 'FBA-SYNTHETIC');
  assert.equal(h.calls.filter((call) => call.path.endsWith('/placementOptions')).length, 2);
  assert.equal(h.calls.at(-1).path, SHIPMENT_PATH);
});

test('unrelated, mismatched, or incompletely verified shipment never reaches child resources', async () => {
  const cases = [
    { [PLAN_PATH]: { ...planFor(), shipments: [] }, [`${PLAN_PATH}/placementOptions`]: listing('placementOptions', []) },
    { [PLAN_PATH]: { ...planFor(), shipments: {} } },
    { [SHIPMENT_PATH]: { ...shipment(), shipmentId: OTHER } },
    { [SHIPMENT_PATH]: { ...shipment(), inboundPlanId: OTHER } },
    { [PLAN_PATH]: { ...planFor(), shipments: [] }, [`${PLAN_PATH}/placementOptions`]: listing('placementOptions', [{ shipmentIds: [SHIPMENT] }], 'pending-page') },
  ];
  for (const routes of cases) {
    const h = harness(routes);
    await assert.rejects(h.read(h.store, input('shipmentItems', { shipmentId: SHIPMENT, maxPages: 1 })));
    assert.equal(h.calls.some((call) => call.path.endsWith('/items')), false);
  }
});

test('packing group belongs to a fully fetched packing option, otherwise it is rejected', async () => {
  const path = `${PLAN_PATH}/packingGroups/${GROUP}/items`;
  const routes = {
    [`${PLAN_PATH}/packingOptions`]: (query) => query.paginationToken
      ? listing('packingOptions', [{ packingGroups: [GROUP] }]) : listing('packingOptions', [{ packingGroups: [OTHER] }], 'packing-2'),
    [path]: listing('items', [{ msku: 'SYNTHETIC-SKU', quantity: 5 }]),
  };
  const h = harness(routes);
  const result = await h.read(h.store, input('packingGroupItems', { packingGroupId: GROUP }));
  assert.equal(result.items[0].quantity, 5);
  assert.equal(h.calls.filter((call) => call.path.endsWith('/packingOptions')).length, 2);
  for (const response of [listing('packingOptions', []), listing('packingOptions', [{ packingGroups: [GROUP] }], 'more')]) {
    const bad = harness({ [`${PLAN_PATH}/packingOptions`]: response });
    await assert.rejects(bad.read(bad.store, input('packingGroupItems', { packingGroupId: GROUP, maxPages: 1 })));
    assert.equal(bad.calls.some((call) => call.path === path), false);
  }
});

test('transport filters bind both placement and shipment and reject conflicting or unrelated IDs', async () => {
  const path = `${PLAN_PATH}/transportationOptions`;
  const h = harness({ [path]: listing('transportationOptions', [{ transportationOptionId: 'SYNTHETIC-TRANSPORT', shippingMode: 'GROUND_SMALL_PARCEL' }]) });
  const result = await h.read(h.store, input('transportationOptions', { shipmentId: SHIPMENT, filters: { placementOptionId: PLACEMENT, shipmentId: SHIPMENT } }));
  assert.deepEqual(result.scope, { inboundPlanId: PLAN, shipmentId: SHIPMENT, placementOptionId: PLACEMENT });
  assert.deepEqual(h.calls.at(-1).query, { pageSize: 10, placementOptionId: PLACEMENT, shipmentId: SHIPMENT });
  const n = h.calls.length;
  await assert.rejects(h.read(h.store, input('transportationOptions', { shipmentId: SHIPMENT, filters: { shipmentId: OTHER } })), /冲突/);
  assert.equal(h.calls.length, n);
  const bad = harness({ [`${PLAN_PATH}/placementOptions`]: listing('placementOptions', [{ placementOptionId: PLACEMENT, shipmentIds: [OTHER] }]) });
  await assert.rejects(bad.read(bad.store, input('transportationOptions', { shipmentId: SHIPMENT, filters: { placementOptionId: PLACEMENT } })), /不属于/);
  assert.equal(bad.calls.some((call) => call.path === path), false);
});

test('maxPages produces explicit incomplete result and a continuation never claims a complete snapshot', async () => {
  const path = `${PLAN_PATH}/items`;
  const h = harness({ [path]: (query) => query.paginationToken
    ? listing('items', [{ msku: 'SECOND', quantity: 2 }]) : listing('items', [{ msku: 'FIRST', quantity: 1 }], 'items-2') });
  const partial = await h.read(h.store, input('planItems', { maxPages: 1 }));
  assert.equal(partial.complete, false);
  assert.equal(partial.pageComplete, false);
  assert.equal(partial.nextPaginationToken, 'items-2');
  assert.deepEqual(partial.items.map((row) => row.msku), ['FIRST']);
  const tail = await h.read(h.store, input('planItems', { filters: { paginationToken: partial.nextPaginationToken } }));
  assert.equal(tail.complete, false);
  assert.equal(tail.pageComplete, true);
  assert.equal(tail.nextPaginationToken, null);
  assert.deepEqual(tail.items.map((row) => row.msku), ['SECOND']);
  const full = await h.read(h.store, input('planItems'));
  assert.equal(full.complete, true);
  assert.equal(full.pages, 2);
  assert.deepEqual(full.items.map((row) => row.msku), ['FIRST', 'SECOND']);
});

test('pagination rejects repeated tokens, malformed pages, and later-page errors instead of returning partial success', async () => {
  const path = `${PLAN_PATH}/items`;
  const broken = [
    null, { items: null }, { items: {} }, { items: [], pagination: null },
    { items: [], pagination: [] }, { items: [], pagination: { nextToken: null } },
    { items: [], pagination: { nextToken: 123 } }, { items: [], pagination: { nextToken: '' } },
    { items: [], pagination: { nextToken: 'x'.repeat(1025) } },
  ];
  for (const response of broken) {
    const h = harness({ [path]: response });
    await assert.rejects(h.read(h.store, input('planItems')));
  }
  const repeated = harness({ [path]: listing('items', [], 'same-token') });
  await assert.rejects(repeated.read(repeated.store, input('planItems')), /重复/);
  assert.equal(repeated.calls.filter((call) => call.path === path).length, 2);
  const continued = harness({ [path]: listing('items', [], 'same-token') });
  await assert.rejects(continued.read(continued.store, input('planItems', { filters: { paginationToken: 'same-token' } })), /重复/);
  const lateError = harness({ [path]: (query) => {
    if (query.paginationToken) throw new Error('Synthetic second-page failure');
    return listing('items', [{ msku: 'FIRST', quantity: 1 }], 'items-2');
  } });
  await assert.rejects(lateError.read(lateError.store, input('planItems')), /second-page failure/);
  assert.equal(lateError.calls.filter((call) => call.path === path).length, 2);
});

test('operation status is exact-ID regional evidence, never a plan ownership or actual shipment assertion', async () => {
  for (const status of ['IN_PROGRESS', 'SUCCESS', 'FAILED']) {
    const detail = { operationId: uuid, operation: 'generatePackingOptions', operationStatus: status, operationProblems: status === 'FAILED' ? [{ code: 'SYNTHETIC', severity: 'ERROR', message: 'Synthetic failure' }] : [] };
    const h = harness({ [`${BASE}/operations/${uuid}`]: detail });
    const result = await h.read(h.store, input('operation', { operationId: uuid }));
    assert.deepEqual(result.data, detail);
    assert.deepEqual(result.scope, { operationId: uuid });
    assert.match(result.note, /不包含计划归属/);
    assert.equal(h.calls.length, 1);
  }
  for (const detail of [
    { operationId: OTHER, operationStatus: 'SUCCESS', operationProblems: [] },
    { operationId: uuid, operationStatus: 'SHIPPED', operationProblems: [] },
    { operationId: uuid, operationStatus: 'SUCCESS' },
  ]) {
    const h = harness({ [`${BASE}/operations/${uuid}`]: detail });
    await assert.rejects(h.read(h.store, input('operation', { operationId: uuid })));
  }
});

test('MCP schema offers only fixed read resources and advertises the approved label boundary', async () => {
  const { buildTools } = await import('../server/tools.js');
  const tool = buildTools('synthetic').find((entry) => entry.name === 'xander_fba_inbound');
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.inputSchema.properties.resource.enum, FBA_READ_RESOURCES);
  assert.equal(FBA_READ_RESOURCES.includes('labels'), false);
  assert.equal(FBA_READ_RESOURCES.includes('billOfLading'), false);
  assert.equal(tool.inputSchema.properties.path, undefined);
  assert.match(tool.description, /Amazon Fulfillment/);
  assert.match(tool.description, /generateLabels\/billOfLading/);
  assert.match(tool.description, /不证明[^。]*实际发运/);
});
