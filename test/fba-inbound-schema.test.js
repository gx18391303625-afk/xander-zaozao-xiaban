import test from 'node:test';
import assert from 'node:assert/strict';
import { FBA_ACTIONS, FBA_SCHEMA_SOURCE, validateFbaBody, validateFbaType, fbaId } from '../lib/fba-inbound-schema.js';

// Pure synthetic data. This module has no account, filesystem or HTTP dependencies.
const id = (prefix = 'wf') => `${prefix}12345678-1234-1234-1234-123456789012`;
const opId = '12345678-1234-1234-1234-123456789012';
const item = () => ({ msku: 'SYNTHETIC-SKU', quantity: 12, labelOwner: 'SELLER', prepOwner: 'NONE' });
const address = () => ({ addressLine1: '1 Synthetic Street', city: 'Synthetic City', countryCode: 'US', name: 'Synthetic Contact', phoneNumber: '5550100', postalCode: '00000' });
const create = () => ({ destinationMarketplaces: ['ATVPDKIKX0DER'], items: [item()], sourceAddress: address() });
const box = () => ({ contentInformationSource: 'BOX_CONTENT_PROVIDED', dimensions: { height: 20, length: 30, width: 40, unitOfMeasurement: 'CM' }, quantity: 2, weight: { unit: 'KG', value: 5.5 }, items: [item()] });
const operation = () => ({ operation: 'createInboundPlan', operationId: opId, operationStatus: 'SUCCESS', operationProblems: [] });
const packingOption = () => ({ packingOptionId: id('po'), discounts: [], fees: [], packingGroups: [id('pg')], status: 'OFFERED', supportedConfigurations: [] });
const clone = (value) => structuredClone(value);

test('eleven descriptors use official operation names, exact methods and request contracts', () => {
  assert.equal(Object.keys(FBA_ACTIONS).length, 11);
  for (const [name, descriptor] of Object.entries(FBA_ACTIONS)) {
    assert.equal(descriptor.operation, name);
    assert.ok(descriptor.path.startsWith('/inbound/fba/2024-03-20/'));
    assert.ok(Object.isFrozen(descriptor));
  }
  assert.ok(Object.isFrozen(FBA_ACTIONS));
  assert.equal(FBA_ACTIONS.updateShipmentTrackingDetails.method, 'PUT');
  assert.equal(FBA_ACTIONS.confirmDeliveryWindowOptions.path, '/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/deliveryWindowOptions/{deliveryWindowOptionId}/confirmation');
  assert.equal(FBA_ACTIONS.generatePlacementOptions.bodyType, 'GeneratePlacementOptionsRequest');
  assert.equal(FBA_SCHEMA_SOURCE.commit, '6ff4ad1fddb377a8febd5a8a300575703d6ca93e');
  assert.equal(FBA_SCHEMA_SOURCE.sha256, 'a4d4cdd08dd3f381f27154d7f9f503d45e0486d416c629598341bbd23c7ff487');
});

test('all body actions accept a representative valid contract without cloning or adding defaults', () => {
  const examples = {
    createInboundPlan: create(),
    setPackingInformation: { packageGroupings: [{ packingGroupId: id('pg'), boxes: [box()] }] },
    generatePlacementOptions: {},
    generateTransportationOptions: { placementOptionId: id('pl'), shipmentTransportationConfigurations: [{ shipmentId: id('sh'), readyToShipWindow: { start: '2030-01-02T10:15Z' } }] },
    confirmTransportationOptions: { transportationSelections: [{ shipmentId: id('sh'), transportationOptionId: id('to') }] },
    updateShipmentTrackingDetails: { trackingDetails: { spdTrackingDetail: { spdTrackingItems: [{ boxId: 'FBA-SYNTHETIC-U000001', trackingId: 'SYNTHETIC-TRACKING' }] } } },
  };
  for (const [action, body] of Object.entries(examples)) {
    const before = JSON.stringify(body);
    assert.equal(validateFbaBody(action, body), body, action);
    assert.equal(JSON.stringify(body), before);
  }
  const freight = { trackingDetails: { ltlTrackingDetail: { freightBillNumber: ['SYNTHETIC-FREIGHT'], billOfLadingNumber: 'SYNTHETIC-BOL' } } };
  assert.equal(validateFbaBody('updateShipmentTrackingDetails', freight), freight);
});

test('only official no-body actions accept undefined; invented or extra body fields fail closed', () => {
  const noBody = ['generatePackingOptions', 'confirmPackingOption', 'confirmPlacementOption', 'generateDeliveryWindowOptions', 'confirmDeliveryWindowOptions'];
  for (const action of noBody) {
    assert.equal(validateFbaBody(action, undefined), undefined);
    for (const body of [null, {}, [], false, '']) assert.throws(() => validateFbaBody(action, body), /does not accept/);
  }
  for (const action of Object.keys(FBA_ACTIONS).filter((name) => !noBody.includes(name))) assert.throws(() => validateFbaBody(action, undefined), /object/);
  for (const action of ['confirmDeliveryWindowOption', 'cancelInboundPlan', 'constructor', '__proto__', null]) assert.throws(() => validateFbaBody(action, {}), /unknown action/);
  assert.throws(() => validateFbaBody('generatePlacementOptions', { placementOptionId: id('pl') }), /unknown field/);
});

test('request validation enforces nested unknown fields, required presence, scalar types and enum values', () => {
  const mutations = [
    (v) => { v.marketplaceId = 'ATVPDKIKX0DER'; },
    (v) => { v.items[0].asin = 'B000000001'; },
    (v) => { v.sourceAddress.state = 'CA'; },
    (v) => { delete v.items[0].prepOwner; },
    (v) => { v.items[0].quantity = undefined; },
    (v) => { v.items[0].quantity = '12'; },
    (v) => { v.items[0].quantity = 1.5; },
    (v) => { v.items[0].quantity = false; },
    (v) => { v.items[0].labelOwner = 'seller'; },
    (v) => { v.items = {}; },
    (v) => { v.sourceAddress = null; },
    (v) => { v.sourceAddress = new Date(); },
  ];
  for (const mutate of mutations) { const body = create(); mutate(body); assert.throws(() => validateFbaBody('createInboundPlan', body), /FBA /, mutate.toString()); }
  const prototypeField = JSON.parse('{"constructor":{}}');
  assert.throws(() => validateFbaBody('generatePlacementOptions', prototypeField), /unknown field/);
  const suppliedUndefined = { name: undefined, ...create() };
  assert.throws(() => validateFbaBody('createInboundPlan', suppliedUndefined), /name.*string/);
});

test('numeric, string and collection limits reject out-of-range values without coercion', () => {
  for (const quantity of [0, -1, 500001, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const body = create(); body.items[0].quantity = quantity;
    assert.throws(() => validateFbaBody('createInboundPlan', body), /quantity/);
  }
  for (const quantity of [1, 500000]) { const body = create(); body.items[0].quantity = quantity; validateFbaBody('createInboundPlan', body); }
  for (const marketplaces of [[], ['A', 'B']]) { const body = create(); body.destinationMarketplaces = marketplaces; assert.throws(() => validateFbaBody('createInboundPlan', body), /destinationMarketplaces/); }
  const many = create(); many.items = Array.from({ length: 2001 }, item); assert.throws(() => validateFbaBody('createInboundPlan', many), /at most 2000/);
  const sparse = create(); sparse.items = new Array(1); assert.throws(() => validateFbaBody('createInboundPlan', sparse), /array holes/);
  const named = create(); named.name = '😀'.repeat(40); validateFbaBody('createInboundPlan', named); named.name += 'x'; assert.throws(() => validateFbaBody('createInboundPlan', named), /name.*length/);
  const unit = box(); unit.weight.unit = 'kg'; assert.throws(() => validateFbaType('BoxInput', unit), /weight.unit/);
  unit.weight.unit = 'KG'; unit.dimensions.height = -1; assert.throws(() => validateFbaType('BoxInput', unit), /height/);
});

test('date-only expiration requires real calendar days, including leap-century rules', () => {
  for (const expiration of ['2028-02-29', '2000-02-29', '2030-12-31']) {
    const body = create(); body.items[0].expiration = expiration; validateFbaBody('createInboundPlan', body);
  }
  for (const expiration of ['2026-02-29', '2100-02-29', '2030-04-31', '2030-13-01', '2030-00-01', '2030-01-00', '2030-01-02T00:00:00Z', '2030-01-02\n']) {
    const body = create(); body.items[0].expiration = expiration; assert.throws(() => validateFbaBody('createInboundPlan', body), /expiration/);
  }
});

test('timestamps require valid date, time and timezone while preserving documented readiness precision', () => {
  for (const start of ['2030-01-02T10:15Z', '2030-01-02t10:15:25z', '2030-01-02T10:15:25Z', '2030-01-02T10:15:25.123Z', '2030-01-02T10:15:00-08:00']) {
    const window = { start }; assert.equal(validateFbaType('WindowInput', window), window); assert.equal(window.start, start);
  }
  for (const start of ['2030-02-30T10:15Z', '2030-01-02', '2030-01-02T10:15:00', '2030-01-02T24:00:00Z', '2030-01-02T10:60:00Z', '2030-01-02T10:15:61Z', '2030-01-02T10:15:00+25:00', '2030-01-02T10:15Z\n']) assert.throws(() => validateFbaType('WindowInput', { start }), /date-time/);
  assert.throws(() => validateFbaType('Quote', { cost: { amount: 10, code: 'USD' }, expiration: '2030-01-02T10:15Z' }), /date-time/);
  validateFbaType('Quote', { cost: { amount: 10, code: 'USD' }, expiration: '2030-01-02T10:15:00Z' });
  const delivery = { availabilityType: 'AVAILABLE', deliveryWindowOptionId: id('dw'), startDate: '2030-01-02T10:15Z', endDate: '2030-01-09T10:15Z', validUntil: '2030-01-01T10:15Z' };
  validateFbaType('DeliveryWindowOption', delivery, { allowUnknown: true });
  validateFbaType('SelectedDeliveryWindow', { ...delivery, editableUntil: '2030-01-01T10:15Z' }, { allowUnknown: true });
});

test('IDs stay exact strings and reject trailing newlines even with a matching total length', () => {
  assert.equal(fbaId(id(), 'inboundPlanId'), id());
  assert.equal(fbaId(opId, 'operationId', { min: 36, max: 38 }), opId);
  for (const value of [null, 123, '', 'x'.repeat(37), 'x'.repeat(39), 'x'.repeat(37) + '\n', 'x'.repeat(37) + '/', ' ' + 'x'.repeat(37)]) assert.throws(() => fbaId(value, 'inboundPlanId'), /inboundPlanId/);
  const body = { transportationSelections: [{ shipmentId: 'x'.repeat(37) + '\n', transportationOptionId: id('to') }] };
  assert.throws(() => validateFbaBody('confirmTransportationOptions', body), /pattern/);
  assert.throws(() => fbaId('x', 'id', { min: 0, max: 2 }), /bounds/);
});

test('operation receipts validate required evidence, exact states and IDs without silently accepting future states', () => {
  const receipt = operation(); assert.equal(validateFbaType('InboundOperationStatus', receipt), receipt);
  for (const state of ['SUCCESS', 'FAILED', 'IN_PROGRESS']) validateFbaType('InboundOperationStatus', { ...receipt, operationStatus: state });
  for (const mutate of [(v) => { delete v.operationProblems; }, (v) => { v.operationProblems = null; }, (v) => { v.operationStatus = 'SUCCEEDED'; }, (v) => { v.operationId = 'short'; }]) {
    const value = operation(); mutate(value); assert.throws(() => validateFbaType('InboundOperationStatus', value, { allowUnknown: true }), /FBA /);
  }
  const known = { ...receipt, futureMetadata: { diagnostic: true }, operationProblems: [{ code: 'WARNING_CODE', message: 'Synthetic warning', severity: 'WARNING', futureDetail: true }] };
  assert.throws(() => validateFbaType('InboundOperationStatus', known), /unknown field/);
  assert.equal(validateFbaType('InboundOperationStatus', known, { allowUnknown: true }), known);
});

test('response compatibility relaxes only the explicitly deprecated PackingOption requirement', () => {
  const current = packingOption();
  assert.throws(() => validateFbaType('PackingOption', current), /supportedShippingConfigurations.*missing/);
  assert.equal(validateFbaType('PackingOption', current, { allowUnknown: true }), current);
  const old = { ...current, supportedShippingConfigurations: [] }; validateFbaType('PackingOption', old);
  assert.throws(() => validateFbaType('PackingOption', { ...current, supportedShippingConfigurations: null }, { allowUnknown: true }), /expected an array/);
  const missing = clone(current); delete missing.fees; assert.throws(() => validateFbaType('PackingOption', missing, { allowUnknown: true }), /fees.*missing/);
  const malformed = { ...current, supportedConfigurations: false }; assert.throws(() => validateFbaType('PackingOption', malformed, { allowUnknown: true }), /supportedConfigurations/);
});

test('response types cover plan, items and boxes; strict mode and successful validation do not mutate inputs', () => {
  const plan = { createdAt: '2030-01-02T10:15:00Z', lastUpdatedAt: '2030-01-02T10:15:00Z', inboundPlanId: id(), marketplaceIds: ['ATVPDKIKX0DER'], name: 'Synthetic', sourceAddress: address(), status: 'ACTIVE', futureField: 'future' };
  const before = clone(plan); validateFbaType('InboundPlan', plan, { allowUnknown: true }); assert.deepEqual(plan, before);
  assert.throws(() => validateFbaType('InboundPlan', plan), /unknown field/);
  validateFbaType('Box', { packageId: id('pk') }, { allowUnknown: true });
  validateFbaType('Item', { asin: 'B000000001', fnsku: 'X000000001', msku: 'SYNTHETIC-SKU', quantity: 1, labelOwner: 'SELLER', prepInstructions: [] }, { allowUnknown: true });
  for (const type of ['MissingType', 'constructor', '__proto__']) assert.throws(() => validateFbaType(type, {}), /unknown type/);
  assert.throws(() => validateFbaType('InboundPlan', plan, { allowUnknown: 'yes' }), /boolean/);
});
