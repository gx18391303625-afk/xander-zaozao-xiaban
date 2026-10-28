import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isolate } from './helpers.js';

const home = isolate();
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Real network is forbidden in document tests'); };
const { validateFbaDocumentChange: validate, prepareFbaDocumentQuery: prepare, downloadFbaDocument: download } = await import('../lib/fba-inbound-documents.js');
test.beforeEach(() => { fs.rmSync(home, { recursive: true, force: true }); fs.mkdirSync(home, { mode: 0o700 }); });
test.after(() => { globalThis.fetch = originalFetch; fs.rmSync(home, { recursive: true, force: true }); });

const UUID = '00000000-0000-0000-0000-000000000001';
const SHIP = `sh${UUID}`, TRANSPORT = `to${UUID}`, OTHER = `zz${UUID}`;
const CONFIRMATION = 'FBA1234ABCD';
const BOX1 = `${CONFIRMATION}U000001`, BOX2 = `${CONFIRMATION}U000002`;
const shipment = (patch = {}) => ({ shipmentId: SHIP, shipmentConfirmationId: CONFIRMATION, selectedTransportationOptionId: TRANSPORT, status: 'WORKING', ...patch });
const transport = (patch = {}) => ({ shipmentId: SHIP, transportationOptionId: TRANSPORT, shippingMode: 'GROUND_SMALL_PARCEL', shippingSolution: 'USE_YOUR_OWN_CARRIER', carrier: { name: 'Synthetic carrier' }, ...patch });
const boxes = () => [{ boxId: BOX1, packageId: `pk${UUID}`, quantity: 1 }, { boxId: BOX2, packageId: `pb${UUID}`, quantity: 1 }];
const labels = (body = {}, extra = {}) => ({ action: 'generateLabels', shipmentId: SHIP, marketplace: 'US', body: { PageType: 'PackageLabel_Letter_4', LabelType: 'UNIQUE', ...body }, ...extra });
const bol = () => ({ action: 'billOfLading', shipmentId: SHIP, marketplace: 'US', body: {} });
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const URL = 'https://synthetic-labels.s3.us-east-1.amazonaws.com/print.pdf?Signature=SYNTHETIC_SECRET';
const response = (data = pdf, headers = {}) => new Response(data, { status: 200, headers: { 'Content-Type': 'application/pdf', ...headers } });
const now = () => Date.parse('2026-10-28T00:00:00Z');
const downloadWith = (fetchImpl, url = URL, extra = {}) => download(url, { fetchImpl, now, ...extra });

test('body validator accepts official page enums and leaves top-level validation to the owning op', () => {
  for (const PageType of ['PackageLabel_Letter_2', 'PackageLabel_Letter_4', 'PackageLabel_Letter_6', 'PackageLabel_Letter_6_CarrierLeft', 'PackageLabel_A4_2', 'PackageLabel_A4_4', 'PackageLabel_Plain_Paper', 'PackageLabel_Plain_Paper_CarrierBottom', 'PackageLabel_Thermal', 'PackageLabel_Thermal_Unified', 'PackageLabel_Thermal_NonPCP', 'PackageLabel_Thermal_No_Carrier_Rotation']) {
    assert.equal(validate(labels({ PageType }, { extraTopLevelForOwningOperation: true })), true);
  }
  assert.equal(validate(bol()), true);
  assert.equal(validate({ action: 'billOfLading' }), true);
  for (const value of [null, { action: 'unapprovedOtherAction' }, labels({ PageType: 'PDF' }), labels({ LabelType: 'BARCODE_2D' }), labels({ unknown: 1 }), labels({}, { body: null }), { ...bol(), body: { PageType: 'PackageLabel_Letter_4' } }]) assert.throws(() => validate(value));
});

test('print counts and ranges reject malformed or conflicting inputs without rewriting them', () => {
  for (const key of ['NumberOfPackages', 'NumberOfPallets', 'PageSize']) {
    for (const value of [0, -1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validate(labels({ [key]: value })));
  }
  for (const value of [-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validate(labels({ PageStartIndex: value, PageSize: 2 })));
  assert.throws(() => validate(labels({ PageSize: 1001, PageStartIndex: 0 })));
  assert.throws(() => validate(labels({ PageSize: 10 })));
  assert.throws(() => validate(labels({ PageStartIndex: 0 })));
  for (const value of [[], [BOX1, BOX1], [null], [''], ['evil,second'], ['control\n'], [1], Array(1001).fill(BOX1)]) assert.throws(() => validate(labels({ PackageLabelsToPrint: value })));
  assert.throws(() => validate(labels({ NumberOfPallets: 2 })));
  assert.throws(() => validate(labels({ LabelType: 'PALLET' })));
  assert.throws(() => validate(labels({ LabelType: 'PALLET', NumberOfPallets: 2, NumberOfPackages: 2 })));
  assert.throws(() => validate(labels({ LabelType: 'PALLET', NumberOfPallets: 2, PackageLabelsToPrint: [BOX1] })));
  assert.equal(validate(labels({ PageSize: 1000, PageStartIndex: 0 })), true);
});

test('UNIQUE query binds FBA confirmation ID, all actual boxes and immutable expected print parameters', () => {
  const c = labels(), s = shipment(), b = boxes(), t = transport();
  const before = structuredClone([c, s, b, t]);
  const result = prepare(c, s, b, t);
  assert.equal(result.path, `/fba/inbound/v0/shipments/${CONFIRMATION}/labels`);
  assert.equal(result.path.includes(SHIP), false);
  assert.deepEqual(result.query, { PageType: 'PackageLabel_Letter_4', LabelType: 'UNIQUE', NumberOfPackages: 2, PackageLabelsToPrint: [BOX1, BOX2] });
  assert.deepEqual(result.expected, { kind: 'generateLabels', shipmentId: SHIP, shipmentConfirmationId: CONFIRMATION, transportationOptionId: TRANSPORT, shippingMode: 'GROUND_SMALL_PARCEL', shippingSolution: 'USE_YOUR_OWN_CARRIER', totalBoxCount: 2, boxIds: [BOX1, BOX2], print: result.query });
  assert.deepEqual([c, s, b, t], before);
  result.query.PackageLabelsToPrint.push('changed-output');
  assert.deepEqual(result.expected.boxIds, [BOX1, BOX2]);
  assert.deepEqual(result.expected.print.PackageLabelsToPrint, [BOX1, BOX2]);
});

test('subset printing still checks total shipment count and refuses fabricated package or grouped box IDs', () => {
  const result = prepare(labels({ NumberOfPackages: 2, PackageLabelsToPrint: [BOX2] }), shipment(), boxes(), transport());
  assert.deepEqual(result.expected.boxIds, [BOX2]);
  assert.equal(result.expected.totalBoxCount, 2);
  assert.throws(() => prepare(labels({ NumberOfPackages: 1, PackageLabelsToPrint: [BOX2] }), shipment(), boxes(), transport()), /NumberOfPackages/);
  assert.throws(() => prepare(labels({ PackageLabelsToPrint: [boxes()[0].packageId] }), shipment(), boxes(), transport()), /实际 boxId/);
  for (const bad of [[], null, [{ boxId: BOX1 }], [{ boxId: BOX1, quantity: 2 }], [{ boxId: BOX1, quantity: 1 }, { boxId: BOX1, quantity: 1 }], [{ packageId: boxes()[0].packageId, quantity: 1 }]]) assert.throws(() => prepare(labels(), shipment(), bad, transport()));
});

test('v0 paths reject internal IDs, mismatched shipments and unconfirmed or unrelated transport', () => {
  for (const shipmentConfirmationId of [undefined, SHIP, '', '../labels', 'FBA123/labels', 'FBA123?x=y', 'fba123', 123]) {
    assert.throws(() => prepare(labels(), shipment({ shipmentConfirmationId }), boxes(), transport()), /shipmentConfirmationId/);
  }
  assert.throws(() => prepare(labels(), shipment({ shipmentId: OTHER }), boxes(), transport()), /精确匹配/);
  for (const selectedTransportationOptionId of [undefined, OTHER, 123]) assert.throws(() => prepare(labels(), shipment({ selectedTransportationOptionId }), boxes(), transport()));
  for (const t of [null, transport({ shipmentId: OTHER }), transport({ transportationOptionId: OTHER }), transport({ shippingSolution: 'UNKNOWN' }), transport({ shippingMode: 'OCEAN_FCL' })]) assert.throws(() => prepare(labels(), shipment(), boxes(), t));
});

test('LTL printing preserves approved literal pagination and PALLET identifies its unverified count source', () => {
  const ltl = transport({ shippingMode: 'FREIGHT_LTL' });
  assert.throws(() => prepare(labels(), shipment(), boxes(), ltl), /非合作 LTL/);
  const c = labels({ PageSize: 1000, PageStartIndex: 0 });
  const result = prepare(c, shipment(), boxes(), ltl);
  assert.equal(result.query.PageStartIndex, 0);
  assert.equal(result.query.PageSize, 1000);
  const pallet = prepare(labels({ LabelType: 'PALLET', NumberOfPallets: 2, PageSize: 1000, PageStartIndex: 0 }), shipment(), [], ltl);
  assert.equal(pallet.expected.palletCount, 2);
  assert.equal(pallet.expected.palletCountSource, 'APPROVED_INPUT');
  assert.equal(pallet.query.PackageLabelsToPrint, undefined);
  for (const shippingMode of ['GROUND_SMALL_PARCEL', 'FREIGHT_FTL_NONPALLET']) assert.throws(() => prepare(labels({ LabelType: 'PALLET', NumberOfPallets: 2 }), shipment(), [], transport({ shippingMode })), /PALLET/);
  assert.throws(() => prepare(c, shipment(), boxes(), transport()), /小包/);
});

test('documented carrier-specific page constraints are checked against the selected transport', () => {
  const ups = transport({ shippingSolution: 'AMAZON_PARTNERED_CARRIER', carrier: { alphaCode: 'UPS' } });
  assert.equal(prepare(labels({ PageType: 'PackageLabel_Letter_2' }), shipment(), boxes(), ups).query.PageType, 'PackageLabel_Letter_2');
  assert.equal(prepare(labels({ PageType: 'PackageLabel_Thermal' }), shipment(), boxes(), ups).query.PageType, 'PackageLabel_Thermal');
  for (const PageType of ['PackageLabel_Letter_2', 'PackageLabel_Thermal', 'PackageLabel_Thermal_Unified', 'PackageLabel_Thermal_No_Carrier_Rotation']) assert.throws(() => prepare(labels({ PageType }), shipment(), boxes(), transport()));
  for (const PageType of ['PackageLabel_Plain_Paper', 'PackageLabel_Thermal_NonPCP']) assert.throws(() => prepare(labels({ PageType }), shipment(), boxes(), ups));
});

test('bill of lading is empty-body and restricted to confirmed partnered LTL/FTL modes', () => {
  for (const shippingMode of ['FREIGHT_LTL', 'FREIGHT_FTL_PALLET', 'FREIGHT_FTL_NONPALLET']) {
    const result = prepare(bol(), shipment(), undefined, transport({ shippingMode, shippingSolution: 'AMAZON_PARTNERED_CARRIER' }));
    assert.equal(result.path, `/fba/inbound/v0/shipments/${CONFIRMATION}/billOfLading`);
    assert.deepEqual(result.query, {});
    assert.equal(result.expected.shippingMode, shippingMode);
  }
  for (const t of [transport({ shippingMode: 'FREIGHT_LTL' }), transport({ shippingSolution: 'AMAZON_PARTNERED_CARRIER' }), transport({ shippingMode: 'OCEAN_FCL', shippingSolution: 'AMAZON_PARTNERED_CARRIER' })]) assert.throws(() => prepare(bol(), shipment(), [], t), /提单仅支持/);
});

test('PDF is downloaded once without authentication, privately saved and returned with SHA-256 but no URL', async () => {
  const calls = [];
  const result = await downloadWith(async (url, options) => { calls.push({ url, options }); return response(pdf, { 'Content-Length': String(pdf.length) }); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/pdf' });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(fs.readFileSync(result.path), pdf);
  assert.equal(result.sha256, createHash('sha256').update(pdf).digest('hex'));
  assert.equal(result.bytes, pdf.length);
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(fs.statSync(result.path).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(result.path)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(home, 'documents')).mode & 0o777, 0o700);
  assert.equal(JSON.stringify(result).includes('Signature'), false);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'), false);
  const second = await downloadWith(async () => response(), URL, { kind: 'billOfLading' });
  assert.notEqual(second.path, result.path);
});

test('unsafe schemes, hosts, URL credentials and malformed kinds cause zero network calls', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(); };
  for (const url of ['http://amazon.com/a.pdf', 'https://evil.example/a.pdf', 'https://amazon.com.evil.example/a.pdf', 'https://evilamazon.com/a.pdf', 'https://127.0.0.1/a.pdf', 'https://amazon.com:8443/a.pdf', 'https://user:secret@amazon.com/a.pdf', 'https://amazon.com/a.pdf#secret', 'https://instance.compute.amazonaws.com/a.pdf', 'https://vpce-private.s3.us-east-1.vpce.amazonaws.com/a.pdf', 'https://amazon.com/a\nsecret']) await assert.rejects(downloadWith(fetchImpl, url));
  await assert.rejects(downloadWith(fetchImpl, URL, { kind: '../traversal' }));
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(path.join(home, 'documents')), false);
});

test('redirects revalidate hosts, are bounded and never forward auth or loop', async () => {
  let calls = 0;
  const allowed = await downloadWith(async (_url, options) => {
    assert.deepEqual(options.headers, { Accept: 'application/pdf' });
    calls++;
    return calls === 1 ? new Response(null, { status: 302, headers: { Location: 'https://sellercentral.amazon.com/print.pdf' } }) : response();
  });
  assert.equal(calls, 2);
  assert.equal(allowed.bytes, pdf.length);
  calls = 0;
  await assert.rejects(downloadWith(async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }); }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(downloadWith(async () => { calls++; return new Response(null, { status: 302, headers: { Location: URL } }); }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(downloadWith(async () => { calls++; return new Response(null, { status: 307, headers: { Location: `https://sellercentral.amazon.com/${calls}.pdf` } }); }));
  assert.equal(calls, 3);
});

test('expired presigned URLs are rejected without a request or durable URL', async () => {
  let calls = 0;
  for (const suffix of ['Expires=1', 'X-Amz-Date=20260101T000000Z&X-Amz-Expires=15', 'X-Amz-Date=broken&X-Amz-Expires=15', 'Expires=invalid', 'Expires=999999999999999999999']) {
    await assert.rejects(downloadWith(async () => { calls++; return response(); }, `https://synthetic-labels.s3.amazonaws.com/a.pdf?${suffix}&Signature=SYNTHETIC_SECRET`), (error) => !error.message.includes('SYNTHETIC_SECRET') && !error.message.includes('https://'));
  }
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(path.join(home, 'documents')), false);
});

test('non-PDF, malformed PDF, wrong length, oversized and failed responses never produce files or retry', async () => {
  const factories = [
    () => response('<html>not a PDF</html>', { 'Content-Type': 'text/html' }),
    () => response('looks like PDF but no magic'),
    () => response('%PDF-1.7\ntruncated without trailer'),
    () => response(pdf, { 'Content-Length': '999' }),
    () => response(pdf, { 'Content-Length': String(32 * 1024 * 1024 + 1) }),
    () => new Response(null, { status: 503 }),
    () => Object.defineProperty(response(), 'redirected', { value: true }),
    () => response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(32 * 1024 * 1024 + 1)); controller.close(); } })),
  ];
  for (const factory of factories) {
    let calls = 0;
    await assert.rejects(downloadWith(async () => { calls++; return factory(); }));
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(path.join(home, 'documents')), false);
  }
});

test('elapsed 15-second deadline aborts download and scrubs transport and stream errors', async () => {
  let clock = 0, calls = 0, signal;
  await assert.rejects(downloadWith(async (_url, options) => { signal = options.signal; calls++; clock = 15_000; return response(); }, URL, { now: () => clock }));
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  for (const fetchImpl of [
    async () => { throw new Error(`Sensitive transport error: ${URL}`); },
    async () => response(new ReadableStream({ start(controller) { controller.enqueue(pdf.subarray(0, 8)); controller.error(new Error(URL)); } })),
  ]) {
    await assert.rejects(downloadWith(fetchImpl), (error) => !error.message.includes('SYNTHETIC_SECRET') && !error.message.includes('https://'));
  }
  assert.equal(fs.existsSync(path.join(home, 'documents')), false);
});

test('unsafe preexisting download directories are refused without changing their permissions', async () => {
  const root = path.join(home, 'documents');
  fs.mkdirSync(root, { mode: 0o755 });
  await assert.rejects(downloadWith(async () => response()));
  assert.deepEqual(fs.readdirSync(root), []);
  assert.equal(fs.statSync(root).mode & 0o777, 0o755);
  fs.rmdirSync(root);
  const outside = path.join(home, 'separate');
  fs.mkdirSync(outside, { mode: 0o700 });
  fs.symlinkSync(outside, root);
  await assert.rejects(downloadWith(async () => response()));
  assert.deepEqual(fs.readdirSync(outside), []);
});
