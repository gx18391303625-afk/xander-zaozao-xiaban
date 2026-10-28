import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isolate } from './helpers.js';

isolate();
const { createFbaInboundOperation } = await import('../lib/ops-fba-inbound.js');
const { validateFbaType, validateFbaBody } = await import('../lib/fba-inbound-schema.js');
const { OPS } = await import('../lib/ops.js');
const { updateConfig } = await import('../lib/config.js');
const { setSwitch } = await import('../lib/switches.js');
const { prepareChange, executeChange, verifyChange, loadProposal, panelDecision } = await import('../lib/proposals.js');
const { p } = await import('../lib/paths.js');
const { HttpError } = await import('../lib/http.js');

// All identifiers, addresses, quotes and carrier data below are synthetic.
// Fixtures follow the pinned official model; no credentials are provisioned.
const BASE = '/inbound/fba/2024-03-20';
const MARKETPLACE = 'ATVPDKIKX0DER';
const store = { alias: 'synthetic-fba-actions', sellerId: 'SYNTHETIC-SELLER', region: 'NA', defaultMarketplace: 'US', marketplaces: ['US'] };
const id = (prefix, n) => `${prefix}00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PLAN = id('wf', 1), PACKING = id('pk', 2), GROUP = id('pg', 3), PLACEMENT = id('pl', 4);
const SHIPMENTS = [id('sh', 5), id('sh', 6)], TRANSPORT = [id('to', 7), id('to', 8)];
const WINDOW = id('dw', 9), OPERATION = id('', 10);
const NOW = Date.parse('2030-01-01T00:00:00Z'), FUTURE = '2030-01-02T00:00:00Z';
const DOCUMENT_URL = 'https://synthetic-documents.s3.amazonaws.com/test.pdf?X-Amz-Signature=SYNTHETIC-ONLY';
const clone = (value) => structuredClone(value);
const address = () => ({ name: 'Synthetic sender', addressLine1: '100 Example Street', city: 'Seattle', stateOrProvinceCode: 'WA', countryCode: 'US', postalCode: '98101', phoneNumber: '2065550100' });
const itemInput = (quantity = 12) => ({ msku: 'SYNTHETIC-SKU', quantity, labelOwner: 'SELLER', prepOwner: 'SELLER' });
const itemResponse = ({ prepOwner, ...item }) => ({ ...clone(item), asin: 'B000000001', fnsku: 'X000000001', prepInstructions: [{ prepOwner: item.labelOwner, prepType: 'ITEM_LABELING' }, { prepOwner, prepType: 'ITEM_NO_PREP' }] });
const boxInput = () => ({ contentInformationSource: 'BOX_CONTENT_PROVIDED', dimensions: { length: 10, width: 8, height: 6, unitOfMeasurement: 'IN' }, weight: { value: 5, unit: 'LB' }, quantity: 2, items: [itemInput()] });
const boxResponse = (input = boxInput(), index = 0) => ({ ...clone(input), packageId: id('pa', 20 + index), boxId: `SYNTHETIC-BOX-${index + 1}`, items: input.items.map(itemResponse) });
const incentive = (amount = 5.5, type = 'FEE') => ({ description: 'Synthetic placement fee', target: 'Placement Services', type, value: { amount, code: 'USD' } });
const contact = () => ({ name: 'Synthetic contact', phoneNumber: '2065550100', email: 'synthetic@example.invalid' });
const action = (name, extra = {}) => ({ op: 'fba.inbound', marketplace: 'US', action: name, inboundPlanId: PLAN, ...extra });
const palletInput = () => ({ dimensions: { length: 48, width: 40, height: 45, unitOfMeasurement: 'IN' }, weight: { value: 300, unit: 'LB' }, stackability: 'STACKABLE', quantity: 2 });
const palletResponse = (input = palletInput(), index = 0) => ({ ...clone(input), packageId: id('pt', 30 + index) });
function syntheticPdf() {
  const stream = 'BT /F1 12 Tf 36 72 Td (Synthetic FBA document) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(`${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
function noDownloadUrl(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(DOCUMENT_URL), false);
  assert.equal(text.includes('X-Amz-Signature'), false);
  assert.equal(text.includes('DownloadURL'), false);
}

function fixture(t) {
  isolate();
  updateConfig((cfg) => { cfg.stores[store.alias] = clone(store); cfg.settings.dryRun = false; cfg.settings.approvalMode = 'panel'; });
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Unexpected network request outside synthetic FBA fixtures'); });
  const state = {
    now: NOW, calls: [], checkpoints: [], operationName: '', operationStatus: 'SUCCESS', operationProblems: [],
    downloads: [], downloadFailure: false, documentMode: null, proposalId: null,
    plan: { inboundPlanId: PLAN, name: 'Synthetic action plan', sourceAddress: address(), marketplaceIds: [MARKETPLACE], status: 'ACTIVE', createdAt: '2030-01-01T00:00:00Z', lastUpdatedAt: '2030-01-01T00:00:00Z', packingOptions: [], placementOptions: [], shipments: [] },
    items: [itemResponse(itemInput(24))],
    groupItems: [itemResponse(itemInput(24))], shipmentItems: SHIPMENTS.map(() => [itemResponse(itemInput())]),
    packing: [{ packingOptionId: PACKING, status: 'OFFERED', packingGroups: [GROUP], fees: [incentive(1.5)], discounts: [], expiration: FUTURE, supportedConfigurations: [{ boxPackingMethods: ['BOX_CONTENT_PROVIDED'] }], supportedShippingConfigurations: [] }],
    placement: [{ placementOptionId: PLACEMENT, status: 'OFFERED', shipmentIds: clone(SHIPMENTS), fees: [incentive()], discounts: [incentive(1, 'DISCOUNT')], expiration: FUTURE }],
    shipments: SHIPMENTS.map((shipmentId) => ({ shipmentId, placementOptionId: PLACEMENT, name: 'Synthetic shipment', source: { sourceType: 'SELLER_FACILITY', address: address() }, destination: { destinationType: 'AMAZON_WAREHOUSE', warehouseId: 'SYNTHETIC-FC', address: address() }, status: 'UNCONFIRMED' })),
    transport: SHIPMENTS.map((shipmentId, i) => ({ transportationOptionId: TRANSPORT[i], shipmentId, carrier: { name: 'Synthetic carrier', alphaCode: 'SYN' }, shippingMode: 'GROUND_SMALL_PARCEL', shippingSolution: 'AMAZON_PARTNERED_CARRIER', preconditions: [], quote: { cost: { amount: 12.5 + i, code: 'USD' }, expiration: FUTURE } })),
    windows: [{ deliveryWindowOptionId: WINDOW, availabilityType: 'AVAILABLE', startDate: '2030-01-04T08:00Z', endDate: '2030-01-04T16:00Z', validUntil: '2030-01-02T00:00Z' }],
    groupBoxes: [boxResponse()], shipmentBoxes: SHIPMENTS.map((_, i) => [boxResponse({ ...boxInput(), quantity: 1 }, i)]),
    shipmentPallets: SHIPMENTS.map((_, i) => [palletResponse(palletInput(), i)]),
  };
  const acceptedPacking = () => { state.packing[0].status = 'ACCEPTED'; };
  const acceptedPlacement = () => {
    state.placement[0].status = 'ACCEPTED';
    state.plan.shipments = SHIPMENTS.map((shipmentId) => ({ shipmentId, status: 'WORKING' }));
    state.shipments.forEach((shipment) => { shipment.status = 'WORKING'; });
  };
  const documentReady = (shippingMode = 'GROUND_SMALL_PARCEL') => {
    acceptedPlacement();
    state.shipments[0].selectedTransportationOptionId = TRANSPORT[0];
    state.shipments[0].shipmentConfirmationId = 'FBASYNTHETIC001';
    state.transport[0].shippingMode = shippingMode;
  };
  const api = async (alias, method, path, options = {}) => {
    assert.equal(alias, store.alias);
    state.calls.push({ method, path, options: clone(options) });
    const prefix = `${BASE}/inboundPlans/${PLAN}`;
    if (method === 'GET' && ['/fba/inbound/v0/shipments/FBASYNTHETIC001/labels', '/fba/inbound/v0/shipments/FBASYNTHETIC001/billOfLading'].includes(path)) {
      assert.equal(options.isWrite, true, 'document-generation GET must follow write retry and approval rules');
      assert.equal(Object.hasOwn(options, 'body'), false);
      if (state.documentMode === '408') throw new HttpError('Synthetic document request timeout', { status: 408, body: null, method, sent: false });
      if (state.documentMode === 'missing-url') return { payload: {} };
      return { payload: { DownloadURL: DOCUMENT_URL } };
    }
    if (method === 'GET') {
      assert.notEqual(options.isWrite, true);
      if (path === `${BASE}/operations/${OPERATION}`) return { operationId: OPERATION, operation: state.operationName, operationStatus: state.operationStatus, operationProblems: clone(state.operationProblems) };
      if (path === prefix) return clone(state.plan);
      if (path === `${prefix}/items`) return { items: clone(state.items) };
      if (path === `${prefix}/packingOptions`) return { packingOptions: clone(state.packing) };
      if (path === `${prefix}/placementOptions`) return { placementOptions: clone(state.placement) };
      if (path === `${prefix}/boxes`) return { boxes: clone(state.groupBoxes) };
      if (path === `${prefix}/packingGroups/${GROUP}/items`) return { items: clone(state.groupItems) };
      if (path === `${prefix}/packingGroups/${GROUP}/boxes`) return { boxes: clone(state.groupBoxes) };
      if (path === `${prefix}/transportationOptions`) return { transportationOptions: clone(state.transport.filter((row) => !options.query?.shipmentId || row.shipmentId === options.query.shipmentId)) };
      for (const [index, shipmentId] of SHIPMENTS.entries()) {
        const shipmentPath = `${prefix}/shipments/${shipmentId}`;
        if (path === shipmentPath) return clone(state.shipments[index]);
        if (path === `${shipmentPath}/items`) return { items: clone(state.shipmentItems[index]) };
        if (path === `${shipmentPath}/boxes`) return { boxes: clone(state.shipmentBoxes[index]) };
        if (path === `${shipmentPath}/pallets`) return { pallets: clone(state.shipmentPallets[index]) };
        if (path === `${shipmentPath}/deliveryWindowOptions`) return { deliveryWindowOptions: clone(state.windows) };
      }
    }
    const routes = [
      ['POST', `${prefix}/packingOptions`, 'generatePackingOptions'],
      ['POST', `${prefix}/packingOptions/${PACKING}/confirmation`, 'confirmPackingOption'],
      ['POST', `${prefix}/packingInformation`, 'setPackingInformation'],
      ['POST', `${prefix}/placementOptions`, 'generatePlacementOptions'],
      ['POST', `${prefix}/placementOptions/${PLACEMENT}/confirmation`, 'confirmPlacementOption'],
      ['POST', `${prefix}/transportationOptions`, 'generateTransportationOptions'],
      ['POST', `${prefix}/transportationOptions/confirmation`, 'confirmTransportationOptions'],
      ['POST', `${prefix}/shipments/${SHIPMENTS[0]}/deliveryWindowOptions`, 'generateDeliveryWindowOptions'],
      ['POST', `${prefix}/shipments/${SHIPMENTS[0]}/deliveryWindowOptions/${WINDOW}/confirmation`, 'confirmDeliveryWindowOptions'],
      ['PUT', `${prefix}/shipments/${SHIPMENTS[0]}/trackingDetails`, 'updateShipmentTrackingDetails'],
    ];
    const route = routes.find(([expectedMethod, expectedPath]) => method === expectedMethod && path === expectedPath);
    if (route) {
      assert.equal(options.isWrite, true);
      const name = route[2]; validateFbaBody(name, options.body);
      state.operationName = name;
      if (name === 'confirmPackingOption') acceptedPacking();
      if (name === 'confirmPlacementOption') acceptedPlacement();
      if (name === 'generateTransportationOptions') for (const configuration of options.body.shipmentTransportationConfigurations) {
        const shipment = state.shipments.find((row) => row.shipmentId === configuration.shipmentId);
        const start = new Date(configuration.readyToShipWindow.start); start.setUTCSeconds(0, 0);
        shipment.dates = { readyToShipWindow: { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() } };
        if (configuration.contactInformation) shipment.contactInformation = clone(configuration.contactInformation);
        if (configuration.freightInformation) shipment.freightInformation = clone(configuration.freightInformation);
        if (configuration.pallets !== undefined) state.shipmentPallets[SHIPMENTS.indexOf(configuration.shipmentId)] = configuration.pallets.map(palletResponse);
      }
      if (name === 'setPackingInformation') for (const grouping of options.body.packageGroupings) {
        const boxes = grouping.boxes.map(boxResponse);
        if (grouping.packingGroupId) state.groupBoxes = boxes;
        else state.shipmentBoxes[SHIPMENTS.indexOf(grouping.shipmentId)] = boxes;
      }
      if (name === 'confirmTransportationOptions') for (const selection of options.body.transportationSelections) {
        const shipment = state.shipments.find((row) => row.shipmentId === selection.shipmentId);
        shipment.selectedTransportationOptionId = selection.transportationOptionId;
        if (selection.contactInformation) shipment.contactInformation = clone(selection.contactInformation);
      }
      if (name === 'confirmDeliveryWindowOptions') {
        const { validUntil, ...selected } = state.windows[0]; state.shipments[0].selectedDeliveryWindow = clone(selected);
      }
      if (name === 'updateShipmentTrackingDetails') {
        state.shipments[0].trackingDetails = clone(options.body.trackingDetails);
        for (const row of state.shipments[0].trackingDetails.spdTrackingDetail?.spdTrackingItems || []) row.trackingNumberValidationStatus = 'NOT_VALIDATED';
      }
      return { operationId: OPERATION };
    }
    throw new Error(`Unexpected synthetic FBA action route: ${method} ${path}`);
  };
  const downloadDocument = async (url, { kind }) => {
    state.downloads.push({ kind });
    assert.equal(url, DOCUMENT_URL);
    const generated = state.proposalId ? loadProposal(state.proposalId).items[0].sendResult : state.checkpoints.at(-1);
    assert.equal(generated.documentGenerated, true, 'generation receipt must be persisted before the downloader starts');
    assert.equal(generated.status, 'SUBMITTED');
    noDownloadUrl(generated);
    if (state.downloadFailure) throw new Error(`Synthetic download failure ${url}`);
    const root = p('documents'); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const directory = fs.mkdtempSync(path.join(root, 'synthetic-')); fs.chmodSync(directory, 0o700);
    const file = path.join(directory, `${kind}.pdf`), data = syntheticPdf();
    fs.writeFileSync(file, data, { mode: 0o600, flag: 'wx' });
    return { path: file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), mimeType: 'application/pdf' };
  };
  const op = createFbaInboundOperation({ api, now: () => state.now, downloadDocument });
  const index = OPS.findIndex((row) => row.id === op.id); assert.notEqual(index, -1);
  const original = OPS[index]; OPS[index] = op; t.after(() => { OPS[index] = original; });
  const prepare = async (change) => {
    const read = await op.read(store, change), checked = op.check(change, read);
    return { change: clone(change), read, expected: checked.newValue, warnings: checked.warnings, request: op.build(change, read, checked.newValue) };
  };
  const send = (prepared) => op.send(store, prepared.request, { checkpoint: async (progress) => { state.checkpoints.push(clone(progress)); } });
  return {
    state, op, prepare, send, acceptedPacking, acceptedPlacement, documentReady,
    readback: (prepared, sent) => op.readback(store, prepared.change, prepared.expected, sent),
    writes: () => state.calls.filter((call) => call.options.isWrite === true),
  };
}

async function verifiedAction(f, change) {
  const prepared = await f.prepare(change);
  const before = clone(prepared);
  const sent = await f.send(prepared);
  assert.equal(sent.status, 'SUBMITTED');
  assert.equal(sent.operationId, OPERATION);
  assert.equal(f.state.checkpoints[0].status, 'OUTCOME_UNKNOWN');
  const result = await f.readback(prepared, sent);
  assert.equal(result.status, 'API_STATE_VERIFIED');
  assert.equal(result.match, true);
  assert.deepEqual(prepared, before, 'send/readback must preserve the approved snapshot');
  assert.equal(f.writes().length, 1);
  assert.deepEqual(f.writes()[0].options.body, change.body);
  return { prepared, sent, result };
}
const packingChange = () => action('confirmPackingOption', { packingOptionId: PACKING });
const boxesChange = () => action('setPackingInformation', { body: { packageGroupings: [{ packingGroupId: GROUP, boxes: [boxInput()] }] } });
const placementChange = () => action('confirmPlacementOption', { placementOptionId: PLACEMENT });
const transportationChange = () => action('confirmTransportationOptions', { body: { transportationSelections: SHIPMENTS.map((shipmentId, i) => ({ shipmentId, transportationOptionId: TRANSPORT[i], contactInformation: contact() })) } });
const windowChange = () => action('confirmDeliveryWindowOptions', { shipmentId: SHIPMENTS[0], deliveryWindowOptionId: WINDOW });
const trackingChange = () => action('updateShipmentTrackingDetails', { shipmentId: SHIPMENTS[0], body: { trackingDetails: { spdTrackingDetail: { spdTrackingItems: [{ boxId: 'SYNTHETIC-BOX-1', trackingId: 'SYNTHETIC-TRACKING-1' }] } } } });

test('FBA action fixture responses use the pinned official nested schema shapes', (t) => {
  const f = fixture(t);
  for (const [type, values] of [['InboundPlan', [f.state.plan]], ['Item', f.state.items], ['PackingOption', f.state.packing], ['PlacementOption', f.state.placement], ['Shipment', f.state.shipments], ['TransportationOption', f.state.transport], ['DeliveryWindowOption', f.state.windows], ['Box', f.state.groupBoxes]]) {
    for (const value of values) assert.doesNotThrow(() => validateFbaType(type, value));
  }
});

test('FBA packing confirmation writes no body and verifies the exact groups and fees', async (t) => {
  const f = fixture(t);
  const { prepared, sent } = await verifiedAction(f, packingChange());
  assert.equal(Object.hasOwn(prepared.request, 'body'), false);
  assert.deepEqual(prepared.expected.selected.fees, [incentive(1.5)]);
  f.state.packing[0].fees[0].value.amount += 0.01;
  assert.equal((await f.readback(prepared, sent)).match, false);
  f.state.packing[0].fees[0].value.amount -= 0.01;
  f.state.groupItems[0].quantity = 23;
  assert.equal((await f.readback(prepared, sent)).match, false);
});

test('FBA option generation performs one async action and requires nonempty independently read options', async (t) => {
  for (const name of ['generatePackingOptions', 'generatePlacementOptions', 'generateDeliveryWindowOptions']) await t.test(name, async (t) => {
    const f = fixture(t);
    if (name === 'generatePlacementOptions') f.acceptedPacking();
    if (name === 'generateDeliveryWindowOptions') f.acceptedPlacement();
    const change = action(name, name === 'generatePlacementOptions' ? { body: {} } : name === 'generateDeliveryWindowOptions' ? { shipmentId: SHIPMENTS[0] } : {});
    const { prepared, sent } = await verifiedAction(f, change);
    if (name === 'generatePackingOptions') f.state.packing = [];
    if (name === 'generatePlacementOptions') f.state.placement = [];
    if (name === 'generateDeliveryWindowOptions') f.state.windows = [];
    assert.equal((await f.readback(prepared, sent)).match, false, 'SUCCESS without generated options is not completion evidence');
    assert.equal(f.writes().length, 1);
  });
});

test('FBA packing confirmation rejects accepted, expired and unknown-fee options', async (t) => {
  const f = fixture(t);
  for (const mutate of [
    (option) => { option.status = 'ACCEPTED'; },
    (option) => { option.expiration = '2029-12-31T00:00:00Z'; },
    (option) => { delete option.fees; },
    (option) => { option.fees[0].value.amount = null; },
  ]) {
    const original = clone(f.state.packing[0]); mutate(f.state.packing[0]);
    await assert.rejects(() => f.prepare(packingChange()));
    f.state.packing[0] = original;
  }
  assert.equal(f.writes().length, 0);
});

test('FBA packing information verifies per-box units times identical-box count and packaging measurements', async (t) => {
  const f = fixture(t); f.acceptedPacking();
  const { prepared, sent } = await verifiedAction(f, boxesChange());
  assert.equal(f.writes()[0].options.body.packageGroupings[0].boxes[0].quantity, 2);
  assert.equal(f.state.groupBoxes[0].items[0].quantity, 12);
  for (const mutate of [
    (box) => { box.quantity = 1; }, (box) => { box.items[0].quantity = 11; },
    (box) => { box.weight.value = 6; }, (box) => { box.dimensions.width = 9; },
    (box) => { box.items[0].prepInstructions[0].prepOwner = 'AMAZON'; },
    (box) => { box.items[0].prepInstructions = []; },
  ]) {
    const original = clone(f.state.groupBoxes[0]); mutate(f.state.groupBoxes[0]);
    assert.equal((await f.readback(prepared, sent)).match, false);
    f.state.groupBoxes[0] = original;
  }
});

test('FBA packing after placement uses every shipment group instead of pre-placement packing-group IDs', async (t) => {
  const f = fixture(t); f.acceptedPacking(); f.acceptedPlacement();
  const change = action('setPackingInformation', { body: { packageGroupings: SHIPMENTS.map((shipmentId) => ({ shipmentId, boxes: [{ ...boxInput(), quantity: 1 }] })) } });
  await verifiedAction(f, change);
  const partial = clone(change); partial.body.packageGroupings.pop();
  await assert.rejects(() => f.prepare(partial), /全部分组|全部.*货件/);
  await assert.rejects(() => f.prepare(boxesChange()), /全部分组|全部.*货件/);
});

test('FBA packing rejects missing groups, inconsistent counts, wrong prep owner and unsupported content source', async (t) => {
  const f = fixture(t); f.acceptedPacking();
  for (const mutate of [
    (change) => { change.body.packageGroupings[0].packingGroupId = id('pg', 999); },
    (change) => { change.body.packageGroupings[0].boxes[0].quantity = 1; },
    (change) => { change.body.packageGroupings[0].boxes[0].items[0].prepOwner = 'NONE'; },
    (change) => { change.body.packageGroupings[0].boxes[0].contentInformationSource = 'MANUAL_PROCESS'; },
  ]) {
    const change = boxesChange(); mutate(change); await assert.rejects(() => f.prepare(change));
  }
  assert.equal(f.writes().length, 0);
});

test('FBA placement generation requires complete packing; confirmation binds fees, discounts and all shipment IDs', async (t) => {
  const f = fixture(t); f.acceptedPacking();
  const generate = action('generatePlacementOptions', { body: {} });
  const preparedGeneration = await f.prepare(generate);
  f.state.groupBoxes[0].quantity = 1;
  await assert.rejects(() => f.prepare(generate), /装箱|件数/);
  f.state.groupBoxes[0].quantity = 2;
  assert.deepEqual(preparedGeneration.request.body, {});
  const { prepared, sent } = await verifiedAction(f, placementChange());
  assert.deepEqual(prepared.expected.selected.fees, [incentive()]);
  assert.deepEqual(prepared.expected.selected.shipmentIds, SHIPMENTS);
  for (const mutate of [
    (option) => { option.fees[0].value.code = 'EUR'; },
    (option) => { option.discounts[0].value.amount = 2; },
    (option) => { option.shipmentIds.pop(); },
  ]) {
    const original = clone(f.state.placement[0]); mutate(f.state.placement[0]);
    assert.equal((await f.readback(prepared, sent)).match, false);
    f.state.placement[0] = original;
  }
  f.state.shipmentItems[0][0].quantity = 11;
  assert.equal((await f.readback(prepared, sent)).match, false);
  f.state.shipmentItems[0][0].quantity = 12;
  f.state.shipments[0].destination.warehouseId = 'SYNTHETIC-OTHER-FC';
  assert.equal((await f.readback(prepared, sent)).match, false);
});

test('FBA changed placement fees after approval skip the real proposal execution without a write', async (t) => {
  const f = fixture(t);
  const proposal = await prepareChange({ store: store.alias, changes: [placementChange()] });
  assert.equal(proposal.ok, true);
  const original = loadProposal(proposal.proposalId);
  setSwitch(f.op.id, true, 'synthetic-test'); panelDecision(proposal.proposalId, 'approve');
  f.state.placement[0].fees[0].value.amount += 0.01;
  assert.equal((await executeChange({ proposalId: proposal.proposalId, hash: proposal.hash, approved: true })).status, 'SKIPPED_STALE');
  const saved = loadProposal(proposal.proposalId);
  assert.equal(saved.hash, original.hash);
  assert.deepEqual(saved.items[0].request, original.items[0].request);
  assert.deepEqual(saved.items[0].new, original.items[0].new);
  assert.equal(f.writes().length, 0);
});

test('FBA transportation generation preserves official readiness windows and covers every selected shipment', async (t) => {
  const f = fixture(t);
  const change = action('generateTransportationOptions', { body: { placementOptionId: PLACEMENT, shipmentTransportationConfigurations: SHIPMENTS.map((shipmentId) => ({ shipmentId, readyToShipWindow: { start: '2030-01-03T12:00Z' }, contactInformation: contact() })) } });
  const { prepared, sent } = await verifiedAction(f, change);
  assert.equal(prepared.request.body.shipmentTransportationConfigurations[0].readyToShipWindow.start, '2030-01-03T12:00Z');
  assert.equal(f.state.shipments[0].dates.readyToShipWindow.start, '2030-01-03T12:00:00.000Z');
  f.state.shipments[0].dates.readyToShipWindow.start = '2030-01-03T12:01:00.000Z';
  assert.equal((await f.readback(prepared, sent)).match, false);
  f.state.shipments[0].dates.readyToShipWindow.start = '2030-01-03T12:00:00.000Z';
  const lastOption = f.state.transport.pop();
  assert.equal((await f.readback(prepared, sent)).match, false, 'every requested shipment needs a generated option');
  f.state.transport.push(lastOption);
  const missing = clone(change); missing.body.shipmentTransportationConfigurations.pop();
  await assert.rejects(() => f.prepare(missing), /全部货件/);
  const stale = clone(change); stale.body.shipmentTransportationConfigurations[0].readyToShipWindow.start = '2029-12-31T12:00Z';
  await assert.rejects(() => f.prepare(stale), /过期/);
});

test('FBA partnered transport confirms the exact shipment option map and approved contact data', async (t) => {
  const f = fixture(t); f.acceptedPlacement();
  const { prepared, sent } = await verifiedAction(f, transportationChange());
  assert.deepEqual(prepared.expected.selectedTransport.map((row) => row.quote.cost), [{ amount: 12.5, code: 'USD' }, { amount: 13.5, code: 'USD' }]);
  assert.ok(prepared.warnings.some((warning) => /扣款/.test(warning)));
  f.state.shipments[1].selectedTransportationOptionId = TRANSPORT[0];
  assert.equal((await f.readback(prepared, sent)).match, false);
  f.state.shipments[1].selectedTransportationOptionId = TRANSPORT[1];
  f.state.shipments[1].contactInformation.phoneNumber = '2065550199';
  assert.equal((await f.readback(prepared, sent)).match, false);
  f.state.shipments[1].contactInformation = contact();
  f.state.transport[1].quote.cost.amount += 0.01;
  assert.equal((await f.readback(prepared, sent)).match, false);
});

test('FBA transport rejects missing or expired quotes, partial selections and unmet delivery-window prerequisites', async (t) => {
  const f = fixture(t); f.acceptedPlacement();
  const partial = transportationChange(); partial.body.transportationSelections.pop();
  await assert.rejects(() => f.prepare(partial), /全部货件/);
  for (const mutate of [
    (option) => { delete option.quote; },
    (option) => { delete option.quote.expiration; },
    (option) => { option.quote.expiration = '2029-12-31T00:00:00Z'; },
    (option) => { option.quote.cost.amount = null; },
    (option) => { option.preconditions = ['CONFIRMED_DELIVERY_WINDOW']; },
    (option) => { option.preconditions = ['SYNTHETIC_UNKNOWN_CONDITION']; },
  ]) {
    const original = clone(f.state.transport[0]); mutate(f.state.transport[0]);
    await assert.rejects(() => f.prepare(transportationChange())); f.state.transport[0] = original;
  }
  assert.equal(f.writes().length, 0);
});

test('FBA option, transport-quote and delivery-window expiration is checked again at dispatch', async (t) => {
  for (const name of ['packing', 'placement', 'transport', 'window']) await t.test(name, async (t) => {
    const f = fixture(t); if (['transport', 'window'].includes(name)) f.acceptedPlacement();
    const change = { packing: packingChange, placement: placementChange, transport: transportationChange, window: windowChange }[name]();
    const prepared = await f.prepare(change);
    const original = clone(prepared);
    f.state.now = Date.parse(FUTURE);
    await assert.rejects(() => f.send(prepared), /过期/);
    assert.deepEqual(prepared, original);
    assert.equal(f.writes().length, 0);
  });
});

test('FBA changed quote amount, currency or delivery-window dates invalidate an approved proposal', async (t) => {
  for (const name of ['quote amount', 'quote currency', 'window dates']) await t.test(name, async (t) => {
    const f = fixture(t); f.acceptedPlacement();
    const change = name === 'window dates' ? windowChange() : transportationChange();
    const proposal = await prepareChange({ store: store.alias, changes: [change] });
    assert.equal(proposal.ok, true);
    const original = loadProposal(proposal.proposalId);
    setSwitch(f.op.id, true, 'synthetic-test'); panelDecision(proposal.proposalId, 'approve');
    if (name === 'quote amount') f.state.transport[0].quote.cost.amount += 0.01;
    if (name === 'quote currency') f.state.transport[0].quote.cost.code = 'EUR';
    if (name === 'window dates') f.state.windows[0].endDate = '2030-01-04T17:00Z';
    assert.equal((await executeChange({ proposalId: proposal.proposalId, hash: proposal.hash, approved: true })).status, 'SKIPPED_STALE');
    const saved = loadProposal(proposal.proposalId);
    assert.equal(saved.hash, original.hash);
    assert.deepEqual(saved.items[0].request, original.items[0].request);
    assert.deepEqual(saved.items[0].new, original.items[0].new);
    assert.equal(f.writes().length, 0);
  });
});

test('FBA delivery-window confirmation preserves minute precision and verifies selected dates', async (t) => {
  const f = fixture(t); f.acceptedPlacement();
  const { prepared, sent } = await verifiedAction(f, windowChange());
  assert.equal(prepared.expected.selected.startDate, '2030-01-04T08:00Z');
  assert.equal(Object.hasOwn(prepared.request, 'body'), false);
  f.state.shipments[0].selectedDeliveryWindow.endDate = '2030-01-04T17:00Z';
  assert.equal((await f.readback(prepared, sent)).match, false);
});

test('FBA blocked, expired or already-confirmed delivery windows cannot be submitted', async (t) => {
  const f = fixture(t); f.acceptedPlacement();
  f.state.windows[0].availabilityType = 'BLOCKED';
  await assert.rejects(() => f.prepare(windowChange()), /不可用/);
  f.state.windows[0].availabilityType = 'AVAILABLE';
  f.state.windows[0].validUntil = '2029-12-31T00:00Z';
  await assert.rejects(() => f.prepare(windowChange()), /过期/);
  f.state.windows[0].validUntil = '2030-01-02T00:00Z';
  f.state.shipments[0].selectedDeliveryWindow = { deliveryWindowOptionId: WINDOW, availabilityType: 'AVAILABLE', startDate: f.state.windows[0].startDate, endDate: f.state.windows[0].endDate };
  await assert.rejects(() => f.prepare(windowChange()), /已经确认/);
  assert.equal(f.writes().length, 0);
});

test('FBA own-carrier tracking uses PUT and preserves pending carrier validation as separate evidence', async (t) => {
  const f = fixture(t); f.acceptedPlacement();
  f.state.transport[0].shippingSolution = 'USE_YOUR_OWN_CARRIER'; delete f.state.transport[0].quote;
  f.state.shipments[0].selectedTransportationOptionId = TRANSPORT[0];
  const { prepared, sent, result } = await verifiedAction(f, trackingChange());
  assert.equal(f.writes()[0].method, 'PUT');
  assert.equal(result.actual.shipment.trackingDetails.spdTrackingDetail.spdTrackingItems[0].trackingNumberValidationStatus, 'NOT_VALIDATED');
  assert.match(result.note, /不代表实际发运/);
  f.state.shipments[0].trackingDetails.spdTrackingDetail.spdTrackingItems[0].trackingId = 'SYNTHETIC-OTHER-TRACKING';
  assert.equal((await f.readback(prepared, sent)).match, false);
});

test('FBA tracking rejects partnered carriers, foreign or duplicate boxes, empty rows and mixed SPD/LTL details', async (t) => {
  const f = fixture(t); f.acceptedPlacement();
  f.state.shipments[0].selectedTransportationOptionId = TRANSPORT[0];
  await assert.rejects(() => f.prepare(trackingChange()), /自选承运/);
  f.state.transport[0].shippingSolution = 'USE_YOUR_OWN_CARRIER';
  for (const mutate of [
    (change) => { change.body.trackingDetails.spdTrackingDetail.spdTrackingItems[0].boxId = 'SYNTHETIC-FOREIGN-BOX'; },
    (change) => { change.body.trackingDetails.spdTrackingDetail.spdTrackingItems.push(clone(change.body.trackingDetails.spdTrackingDetail.spdTrackingItems[0])); },
    (change) => { change.body.trackingDetails.spdTrackingDetail.spdTrackingItems = []; },
    (change) => { change.body.trackingDetails.ltlTrackingDetail = { freightBillNumber: ['SYNTHETIC-PRO-1'] }; },
  ]) { const change = trackingChange(); mutate(change); await assert.rejects(() => f.prepare(change)); }
  f.state.shipmentBoxes[0][0].items[0].quantity = 6;
  f.state.shipmentBoxes[0].push(boxResponse({ ...boxInput(), quantity: 1, items: [itemInput(6)] }, 2));
  await assert.rejects(() => f.prepare(trackingChange()), /全部|完整|箱/);
  assert.equal(f.writes().length, 0);
});

test('FBA tracking must use the branch matching the confirmed shipping mode', async (t) => {
  const f = fixture(t); f.acceptedPlacement();
  f.state.transport[0].shippingSolution = 'USE_YOUR_OWN_CARRIER'; delete f.state.transport[0].quote;
  f.state.shipments[0].selectedTransportationOptionId = TRANSPORT[0];
  const ltl = action('updateShipmentTrackingDetails', { shipmentId: SHIPMENTS[0], body: { trackingDetails: { ltlTrackingDetail: { freightBillNumber: ['SYNTHETIC-PRO-1'] } } } });
  for (const shippingMode of ['GROUND_SMALL_PARCEL', 'AIR_SMALL_PARCEL', 'AIR_SMALL_PARCEL_EXPRESS']) {
    f.state.transport[0].shippingMode = shippingMode;
    await assert.rejects(() => f.prepare(ltl), /小包|LTL|模式|运输方式/);
    await assert.doesNotReject(() => f.prepare(trackingChange()));
  }
  for (const shippingMode of ['FREIGHT_LTL', 'FREIGHT_FTL_PALLET', 'FREIGHT_FTL_NONPALLET']) {
    f.state.transport[0].shippingMode = shippingMode;
    await assert.rejects(() => f.prepare(trackingChange()), /小包|SPD|模式|运输方式/);
    await assert.doesNotReject(() => f.prepare(ltl));
  }
  for (const shippingMode of ['OCEAN_LCL', 'OCEAN_FCL', 'SYNTHETIC_UNKNOWN_MODE']) {
    f.state.transport[0].shippingMode = shippingMode;
    await assert.rejects(() => f.prepare(trackingChange()));
    await assert.rejects(() => f.prepare(ltl));
  }
  assert.equal(f.writes().length, 0);
});

test('FBA LTL tracking accepts the official one-element freightBillNumber array', async (t) => {
  const f = fixture(t); f.acceptedPlacement();
  f.state.transport[0].shippingSolution = 'USE_YOUR_OWN_CARRIER'; f.state.transport[0].shippingMode = 'FREIGHT_LTL'; delete f.state.transport[0].quote;
  f.state.shipments[0].selectedTransportationOptionId = TRANSPORT[0];
  const change = action('updateShipmentTrackingDetails', { shipmentId: SHIPMENTS[0], body: { trackingDetails: { ltlTrackingDetail: { freightBillNumber: ['SYNTHETIC-PRO-1'], billOfLadingNumber: 'SYNTHETIC-BOL-1' } } } });
  await verifiedAction(f, change);
  const wrongShape = clone(change); wrongShape.body.trackingDetails.ltlTrackingDetail.freightBillNumber = 'SYNTHETIC-PRO-1';
  await assert.rejects(() => f.prepare(wrongShape), /array/);
});

test('FBA transport generation independently verifies complete pallet counts, dimensions, weight and stackability', async (t) => {
  const f = fixture(t);
  const change = action('generateTransportationOptions', { body: {
    placementOptionId: PLACEMENT,
    shipmentTransportationConfigurations: SHIPMENTS.map((shipmentId) => ({ shipmentId, readyToShipWindow: { start: '2030-01-03T12:00Z' }, pallets: [palletInput()] })),
  } });
  validateFbaType('PalletInput', palletInput());
  validateFbaType('Pallet', f.state.shipmentPallets[0][0]);
  const { prepared, sent, result } = await verifiedAction(f, change);
  assert.equal(result.actual.pallets.length, 2);
  assert.deepEqual(f.writes()[0].options.body, change.body);
  for (const mutate of [
    (pallet) => { pallet.quantity = 1; },
    (pallet) => { pallet.dimensions.height = 46; },
    (pallet) => { pallet.weight.value = 301; },
    (pallet) => { pallet.stackability = 'NON_STACKABLE'; },
  ]) {
    const original = clone(f.state.shipmentPallets[0][0]); mutate(f.state.shipmentPallets[0][0]);
    assert.equal((await f.readback(prepared, sent)).match, false);
    f.state.shipmentPallets[0][0] = original;
  }
  f.state.shipmentPallets[1] = [];
  assert.equal((await f.readback(prepared, sent)).match, false);
});

test('FBA transport pallet input must include independently verifiable physical details', async (t) => {
  const f = fixture(t);
  for (const field of ['dimensions', 'weight', 'stackability', 'quantity']) {
    const pallet = palletInput(); delete pallet[field];
    const change = action('generateTransportationOptions', { body: { placementOptionId: PLACEMENT, shipmentTransportationConfigurations: SHIPMENTS.map((shipmentId) => ({ shipmentId, readyToShipWindow: { start: '2030-01-03T12:00Z' }, pallets: [clone(pallet)] })) } });
    await assert.rejects(() => f.prepare(change));
  }
  assert.equal(f.writes().length, 0);
});

test('FBA partnered freight confirmation binds existing pallet inventory before and after accepting the quote', async (t) => {
  const f = fixture(t); f.acceptedPlacement();
  f.state.transport[0].shippingMode = 'FREIGHT_LTL';
  f.state.transport[1].shippingMode = 'FREIGHT_FTL_PALLET';
  const { prepared, sent } = await verifiedAction(f, transportationChange());
  assert.equal(prepared.expected.pallets.length, 2);
  for (const mutate of [
    (pallet) => { pallet.quantity += 1; },
    (pallet) => { pallet.dimensions.height += 1; },
    (pallet) => { pallet.stackability = 'NON_STACKABLE'; },
  ]) {
    const original = clone(f.state.shipmentPallets[0][0]); mutate(f.state.shipmentPallets[0][0]);
    assert.equal((await f.readback(prepared, sent)).match, false);
    f.state.shipmentPallets[0][0] = original;
  }
  f.state.shipments[0].destination.warehouseId = 'SYNTHETIC-OTHER-DESTINATION';
  assert.equal((await f.readback(prepared, sent)).match, false);
});

test('FBA partnered pallet freight cannot confirm with absent or incomplete pallet inventory', async (t) => {
  const f = fixture(t); f.acceptedPlacement(); f.state.transport[0].shippingMode = 'FREIGHT_LTL';
  const original = clone(f.state.shipmentPallets[0]);
  f.state.shipmentPallets[0] = [];
  await assert.rejects(() => f.prepare(transportationChange()), /托盘/);
  for (const field of ['dimensions', 'weight', 'stackability', 'quantity']) {
    f.state.shipmentPallets[0] = clone(original); delete f.state.shipmentPallets[0][0][field];
    await assert.rejects(() => f.prepare(transportationChange()), /托盘/);
  }
  assert.equal(f.writes().length, 0);
});

const labelChange = () => action('generateLabels', { shipmentId: SHIPMENTS[0], body: { PageType: 'PackageLabel_Letter_4', LabelType: 'UNIQUE', NumberOfPackages: 1, PackageLabelsToPrint: ['SYNTHETIC-BOX-1'] } });

test('FBA labels use the approved confirmation number and query in one write-classified v0 GET', async (t) => {
  const f = fixture(t); f.documentReady();
  const prepared = await f.prepare(labelChange()), approved = clone(prepared);
  assert.equal(prepared.request.method, 'GET');
  assert.equal(prepared.request.path, '/fba/inbound/v0/shipments/FBASYNTHETIC001/labels');
  assert.deepEqual(prepared.request.query, labelChange().body);
  assert.equal(Object.hasOwn(prepared.request, 'body'), false);
  const sent = await f.send(prepared);
  assert.equal(sent.documentGenerated, true);
  assert.equal(sent.status, 'SUBMITTED');
  assert.equal(f.state.downloads.length, 1);
  assert.equal(f.state.checkpoints[0].status, 'OUTCOME_UNKNOWN');
  assert.equal(f.state.checkpoints[1].documentGenerated, true);
  assert.equal(f.state.checkpoints[1].artifact, undefined);
  noDownloadUrl(f.state.checkpoints); noDownloadUrl(sent);
  assert.deepEqual(f.writes()[0].options.query, prepared.request.query);
  assert.equal(f.writes().length, 1);
  assert.ok(sent.artifact.path.startsWith(`${p('documents')}${path.sep}`));
  const data = fs.readFileSync(sent.artifact.path);
  assert.equal(data.subarray(0, 8).toString(), '%PDF-1.4');
  assert.equal(sent.artifact.sha256, createHash('sha256').update(data).digest('hex'));
  assert.equal(sent.artifact.bytes, data.length);
  assert.equal(fs.statSync(sent.artifact.path).mode & 0o777, 0o600);
  f.state.calls = [];
  const result = await f.readback(prepared, sent);
  assert.equal(result.status, 'API_STATE_VERIFIED');
  assert.equal(result.match, true);
  assert.match(result.note, /不等于.*实际发运/);
  assert.deepEqual(prepared, approved);
  assert.ok(f.state.calls.length > 0);
  assert.ok(f.state.calls.every((call) => call.method === 'GET' && call.options.isWrite === false && call.path.startsWith(BASE)));
  assert.equal(f.state.downloads.length, 1);
});

test('FBA document readback rejects mismatched receipt scope, artifact bytes and current shipment binding', async (t) => {
  const f = fixture(t); f.documentReady();
  const prepared = await f.prepare(labelChange()), sent = await f.send(prepared);
  for (const mutate of [
    (receipt) => { receipt.documentScope.shipmentId = SHIPMENTS[1]; },
    (receipt) => { receipt.documentScope.print.PackageLabelsToPrint = ['SYNTHETIC-OTHER-BOX']; },
    (receipt) => { receipt.artifact.sha256 = '0'.repeat(64); },
    (receipt) => { receipt.artifact.bytes += 1; },
  ]) {
    const receipt = clone(sent); mutate(receipt);
    assert.equal((await f.readback(prepared, receipt)).match, false);
  }
  const original = clone(f.state.shipments[0]);
  f.state.shipments[0].shipmentConfirmationId = 'FBASYNTHETIC999';
  assert.equal((await f.readback(prepared, sent)).match, false);
  f.state.shipments[0] = clone(original);
  f.state.shipments[0].selectedTransportationOptionId = TRANSPORT[1];
  assert.equal((await f.readback(prepared, sent)).match, false);
  f.state.shipments[0] = original;
  fs.appendFileSync(sent.artifact.path, 'synthetic tampering');
  assert.equal((await f.readback(prepared, sent)).match, false);
  assert.equal(f.writes().length, 1);
  assert.equal(f.state.downloads.length, 1);
});

test('FBA document artifacts must stay inside the isolated documents directory and cannot be symlinks', async (t) => {
  const f = fixture(t); f.documentReady();
  const prepared = await f.prepare(labelChange()), sent = await f.send(prepared);
  const outside = p('exports', 'synthetic-outside.pdf');
  fs.copyFileSync(sent.artifact.path, outside);
  assert.equal((await f.readback(prepared, { ...sent, artifact: { ...sent.artifact, path: outside } })).match, false);
  const symlink = path.join(path.dirname(sent.artifact.path), 'synthetic-link.pdf');
  fs.symlinkSync(sent.artifact.path, symlink);
  assert.equal((await f.readback(prepared, { ...sent, artifact: { ...sent.artifact, path: symlink } })).match, false);
  fs.rmSync(sent.artifact.path);
  assert.equal((await f.readback(prepared, sent)).match, false);
  assert.equal(f.writes().length, 1);
});

test('FBA labels obey real proposal approval gates, preserve the approved hash and never regenerate on verify', async (t) => {
  const f = fixture(t); f.documentReady();
  const proposal = await prepareChange({ store: store.alias, changes: [labelChange()] });
  assert.equal(proposal.ok, true);
  f.state.proposalId = proposal.proposalId;
  const original = loadProposal(proposal.proposalId);
  const execute = (extra = {}) => executeChange({ proposalId: proposal.proposalId, hash: proposal.hash, approved: true, ...extra });
  await assert.rejects(execute({ approved: false }), /approved=true/);
  await assert.rejects(execute(), /面板审批/);
  panelDecision(proposal.proposalId, 'approve');
  await assert.rejects(execute(), /开关还关着/);
  assert.equal(f.writes().length, 0);
  setSwitch(f.op.id, true, 'synthetic-test');
  assert.equal((await execute()).status, 'API_STATE_VERIFIED');
  const saved = loadProposal(proposal.proposalId);
  assert.equal(saved.hash, original.hash);
  for (const key of ['old', 'new', 'request', 'change', 'precondition']) assert.deepEqual(saved.items[0][key], original.items[0][key]);
  noDownloadUrl(saved);
  assert.equal(fs.readFileSync(p('ledger.jsonl'), 'utf8').includes('X-Amz-Signature'), false);
  assert.equal(f.writes().length, 1);
  assert.equal(f.state.downloads.length, 1);
  f.state.calls = [];
  assert.equal((await verifyChange({ proposalId: proposal.proposalId })).status, 'API_STATE_VERIFIED');
  assert.ok(f.state.calls.every((call) => call.method === 'GET' && call.options.isWrite === false));
  assert.equal(f.state.downloads.length, 1);
  await assert.rejects(execute(), /不能再次执行/);
});

test('FBA generated document with a failed download stays DOCUMENT_NOT_SAVED without retrying generation', async (t) => {
  const f = fixture(t); f.documentReady(); f.state.downloadFailure = true;
  const proposal = await prepareChange({ store: store.alias, changes: [labelChange()] });
  assert.equal(proposal.ok, true); f.state.proposalId = proposal.proposalId;
  setSwitch(f.op.id, true, 'synthetic-test'); panelDecision(proposal.proposalId, 'approve');
  const execute = () => executeChange({ proposalId: proposal.proposalId, hash: proposal.hash, approved: true });
  assert.equal((await execute()).status, 'DOCUMENT_NOT_SAVED');
  const saved = loadProposal(proposal.proposalId);
  assert.equal(saved.items[0].sendResult.documentGenerated, true);
  assert.equal(saved.items[0].sendResult.downloadFailed, true);
  assert.equal(saved.items[0].sendResult.artifact, undefined);
  noDownloadUrl(saved);
  assert.equal(f.writes().length, 1);
  assert.equal(f.state.downloads.length, 1);
  f.state.calls = [];
  assert.equal((await verifyChange({ proposalId: proposal.proposalId })).status, 'DOCUMENT_NOT_SAVED');
  assert.equal(f.writes().length, 0);
  assert.equal(f.state.downloads.length, 1);
  await assert.rejects(execute(), /不能再次执行/);
});

test('FBA missing document URL or HTTP 408 stays unknown and does not start a download', async (t) => {
  for (const mode of ['missing-url', '408']) await t.test(mode, async (t) => {
    const f = fixture(t); f.documentReady(); f.state.documentMode = mode;
    const prepared = await f.prepare(labelChange()), sent = await f.send(prepared);
    assert.equal(sent.status, 'OUTCOME_UNKNOWN');
    assert.notEqual(sent.documentGenerated, true);
    assert.equal((await f.readback(prepared, sent)).status, 'OUTCOME_UNKNOWN');
    assert.equal((await f.readback(prepared, sent)).status, 'OUTCOME_UNKNOWN');
    assert.equal(f.writes().length, 1);
    assert.equal(f.state.downloads.length, 0);
    noDownloadUrl(sent); noDownloadUrl(f.state.checkpoints);
  });
});

test('FBA bill of lading uses a no-body v0 GET for a confirmed partnered freight shipment', async (t) => {
  const f = fixture(t); f.documentReady('FREIGHT_LTL');
  const change = action('billOfLading', { shipmentId: SHIPMENTS[0] });
  await assert.rejects(() => f.prepare({ ...change, body: {} }), /没有请求体|body/);
  const prepared = await f.prepare(change);
  assert.equal(prepared.request.path, '/fba/inbound/v0/shipments/FBASYNTHETIC001/billOfLading');
  assert.deepEqual(prepared.request.query, {});
  assert.equal(Object.hasOwn(prepared.request, 'body'), false);
  const sent = await f.send(prepared);
  assert.equal((await f.readback(prepared, sent)).status, 'API_STATE_VERIFIED');
  assert.equal(f.writes().length, 1);
  assert.equal(f.writes()[0].method, 'GET');
  assert.equal(f.state.downloads[0].kind, 'billOfLading');
});

test('FBA pallet label approval must match independently read shipment pallet count', async (t) => {
  const f = fixture(t); f.documentReady('FREIGHT_LTL');
  const change = action('generateLabels', { shipmentId: SHIPMENTS[0], body: { PageType: 'PackageLabel_Letter_4', LabelType: 'PALLET', NumberOfPallets: 2 } });
  const wrong = clone(change); wrong.body.NumberOfPallets = 1;
  await assert.rejects(() => f.prepare(wrong), /托盘.*不一致/);
  const prepared = await f.prepare(change);
  assert.equal(prepared.expected.document.palletCountSource, 'API_READBACK');
  assert.equal(prepared.expected.document.palletCount, 2);
  const sent = await f.send(prepared);
  assert.equal((await f.readback(prepared, sent)).status, 'API_STATE_VERIFIED');
  assert.equal(f.writes()[0].options.query.NumberOfPallets, 2);
});
