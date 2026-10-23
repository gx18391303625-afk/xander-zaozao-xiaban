import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentApi } from '../lib/ops-content.js';
import { isolate } from './helpers.js';
isolate();

const US = 'ATVPDKIKX0DER';
const store = { alias: 'synthetic', region: 'NA', sellerId: 'SYNTHETIC_SELLER', defaultMarketplace: 'US' };
const clone = (v) => JSON.parse(JSON.stringify(v));
const doc = (name = 'Synthetic A+ draft') => ({ name, contentType: 'EBC', locale: 'en-US', contentModuleList: [{ contentModuleType: 'STANDARD_TEXT', standardText: { body: { textList: [{ value: 'Synthetic fixture only', decoratorSet: [] }] } } }] });

function fixture({ persistent = false } = {}) {
  const state = { calls: [], docs: new Map(), imageAttrs: { main_product_image_locator: [{ marketplace_id: US, media_location: 'https://example.com/old.jpg' }, { marketplace_id: 'A2EUQ1WTGCTBG2', media_location: 'https://example.com/canada.jpg' }], item_name: [{ value: 'Unrelated title' }] },
    imageSupported: ['main_product_image_locator', 'other_product_image_locator_1'], previewStatus: 'VALID', imageStatus: 'ACCEPTED', validation: {}, warnings: [], publishRecords: [],
    clock: Date.parse('2026-10-23T00:00:00Z'), mode: null, listPageSize: 2, tokens: new Map() };
  function insert(name = 'Existing synthetic draft', asins = ['B000000001']) {
    const key = `CONTENT${state.docs.size + 1}`;
    state.docs.set(key, { contentReferenceKey: key, contentDocument: doc(name), contentMetadata: { name, marketplaceId: US, status: 'DRAFT', badgeSet: ['STANDARD'], updateTime: new Date(state.clock).toISOString() }, asins: [...asins] });
    return key;
  }
  function paginated(rows, field, path, query) {
    const offset = query.pageToken ? state.tokens.get(query.pageToken)?.offset : 0;
    if (query.pageToken) assert.deepEqual(Object.keys(query), ['pageToken'], 'pagination token must be the ONLY query parameter');
    const result = { [field]: rows.slice(offset, offset + state.listPageSize) };
    if (rows.length > offset + state.listPageSize) {
      result.nextPageToken = `${path}:${offset + state.listPageSize}`;
      state.tokens.set(result.nextPageToken, { offset: offset + state.listPageSize, path });
    }
    return result;
  }
  async function api(alias, method, path, options = {}) {
    assert.equal(alias, store.alias);
    state.calls.push({ method, path, ...clone(options) });
    if (path.startsWith('/definitions/')) {
      assert.equal(options.query.sellerId, store.sellerId);
      assert.equal(options.query.marketplaceIds, US);
      return { schema: { link: { resource: 'https://example.amazonaws.com/schema.json' } } };
    }
    if (path.endsWith('/contentAsinValidations')) {
      assert.equal(options.isWrite, false, 'validation does not mutate content');
      assert.ok(options.body.contentDocument);
      return clone(state.validation);
    }
    if (path.endsWith('/contentPublishRecords')) {
      const rows = state.publishRecords.filter((p) => options.query.pageToken || p.asin === options.query.asin);
      return paginated(rows, 'publishRecordList', path, options.query);
    }
    if (path.endsWith('/contentDocuments') && method === 'GET') {
      return paginated([...state.docs.values()].map(({ contentReferenceKey, contentMetadata }) => ({ contentReferenceKey, contentMetadata })), 'contentMetadataRecords', path, options.query);
    }
    if (path.endsWith('/contentDocuments') && method === 'POST') {
      assert.equal(options.isWrite, true);
      const key = insert(options.body.contentDocument.name, []);
      state.docs.get(key).contentDocument = clone(options.body.contentDocument);
      if (state.mode === 'lost-create-response') throw Object.assign(new Error('Synthetic timeout after creation'), { sent: true, status: 0 });
      return state.mode === 'missing-create-id' ? {} : { contentReferenceKey: key, warnings: clone(state.warnings) };
    }
    const match = path.match(/\/contentDocuments\/([^/]+)(\/asins|\/approvalSubmissions)?$/);
    if (!match) throw new Error(`Unexpected synthetic endpoint ${method} ${path}`);
    const key = decodeURIComponent(match[1]);
    const current = state.docs.get(key);
    assert.ok(current, `synthetic document ${key} exists`);
    if (method === 'GET' && !match[2]) return { contentRecord: clone(Object.fromEntries(Object.entries(current).filter(([k]) => k !== 'asins'))) };
    if (method === 'GET' && match[2] === '/asins') return paginated(current.asins.map((asin) => ({ asin })), 'asinMetadataSet', path, options.query);
    assert.equal(options.isWrite, true);
    if (match[2] === '/asins') current.asins = clone(options.body.asinSet);
    else if (match[2] === '/approvalSubmissions') {
      assert.equal(options.body, undefined, 'approval submission has no fabricated body');
      current.contentMetadata.status = 'SUBMITTED';
    } else {
      current.contentDocument = clone(options.body.contentDocument);
      current.contentMetadata.name = options.body.contentDocument.name;
      current.contentMetadata.status = 'DRAFT';
    }
    current.contentMetadata.updateTime = new Date(state.clock).toISOString();
    return match[2] ? { warnings: clone(state.warnings) } : { contentReferenceKey: key, warnings: clone(state.warnings) };
  }
  async function listing(alias, sku, market) {
    assert.equal(alias, store.alias); assert.equal(sku, 'SYNTHETIC-SKU'); assert.equal(market, 'US');
    return { summaries: [{ asin: 'B000000001', productType: 'TEST_PRODUCT', marketplaceId: US }], attributes: clone(state.imageAttrs), issues: clone(state.imageIssues || []) };
  }
  async function patch(alias, sku, market, body) {
    state.calls.push({ method: 'PATCH', path: '/synthetic-listing', body: clone(body) });
    if (body.preview) return { status: state.previewStatus, issues: clone(state.previewIssues || []) };
    for (const p of body.patches) state.imageAttrs[p.path.slice('/attributes/'.length)] = clone(p.value);
    return { status: state.imageStatus, issues: [] };
  }
  const dependencies = { api, listing, patch, fetchSchema: async () => ({ properties: Object.fromEntries(state.imageSupported.map((key) => [key, { type: 'array' }])) }), now: () => state.clock, reviewCache: persistent ? undefined : new Map() };
  const client = createContentApi(dependencies);
  return { state, insert, reopen: () => createContentApi(dependencies), ...client };
}
async function prepare(op, change) {
  const read = await op.read(store, change);
  const { newValue, warnings } = op.check(change, read, {});
  const request = op.build(change, read, newValue);
  const preview = op.preview ? await op.preview(store, request) : null;
  return { read, newValue, warnings, request, preview };
}
async function perform(op, change) {
  const prepared = await prepare(op, change);
  const checkpoints = [];
  const sent = await op.send(store, prepared.request, { checkpoint: async (value) => checkpoints.push(clone(value)) });
  const verified = await op.readback(store, change, prepared.newValue, sent);
  return { ...prepared, checkpoints, sent, verified };
}

test('listing image: real PTD names, validation preview, PATCH contribution and exact readback', async () => {
  const f = fixture();
  const c = { sku: 'SYNTHETIC-SKU', images: { main_product_image_locator: 'https://example.com/new.jpg', other_product_image_locator_1: 'https://example.com/secondary.jpg' } };
  const result = await perform(f.ops[0], c);
  assert.equal(result.sent.status, 'IMAGES_ACCEPTED');
  assert.equal(result.verified.status, 'IMAGE_CONTRIBUTION_VERIFIED');
  assert.equal(result.verified.match, true);
  assert.match(result.verified.note, /卖家图片贡献/);
  assert.deepEqual(f.state.imageAttrs.item_name, [{ value: 'Unrelated title' }]);
  assert.equal(f.state.imageAttrs.main_product_image_locator[0].media_location, 'https://example.com/canada.jpg', 'preserves other marketplace contribution');
  assert.equal(f.state.calls.filter((c) => c.method === 'PATCH' && c.body.preview).length, 2);
  assert.deepEqual(result.checkpoints.map((c) => c.stage), ['IMAGE_PATCH_SENDING', 'IMAGE_PATCH_RECEIVED']);
});

test('listing image: blocks unsupported PTD attributes, local URLs, region mismatch and invalid preview', async () => {
  const f = fixture(); const op = f.ops[0];
  await assert.rejects(prepare(op, { sku: 'SYNTHETIC-SKU', images: { other_product_image_locator_9: 'https://example.com/nine.jpg' } }), /PTD 不支持/);
  for (const url of ['/Users/example/photo.jpg', 'http://example.com/image.jpg', 'https://127.0.0.1/image.jpg', 'https://localhost/image.jpg', 'https://user:password@example.com/image.jpg']) {
    await assert.rejects(prepare(op, { sku: 'SYNTHETIC-SKU', images: { main_product_image_locator: url } }), /HTTPS/);
  }
  await assert.rejects(op.read(store, { marketplace: 'UK', sku: 'SYNTHETIC-SKU', images: { main_product_image_locator: 'https://example.com/new.jpg' } }), /区域/);
  f.state.previewStatus = 'INVALID';
  await assert.rejects(prepare(op, { sku: 'SYNTHETIC-SKU', images: { main_product_image_locator: 'https://example.com/new.jpg' } }), /预校验未通过/);
  assert.equal(f.state.calls.filter((c) => c.method === 'PATCH' && !c.body.preview).length, 0);
});

test('listing image: processing errors prevent contribution verification even when the URL is stored', async () => {
  const f = fixture(); const op = f.ops[0];
  const c = { sku: 'SYNTHETIC-SKU', images: { main_product_image_locator: 'https://example.com/new.jpg' } };
  const p = await prepare(op, c);
  await op.send(store, p.request);
  f.state.imageIssues = [{ severity: 'ERROR', attributeNames: ['main_product_image_locator'], code: 'IMAGE_REJECTED' }];
  const actual = await op.readback(store, c, p.newValue);
  assert.equal(actual.match, false);
  assert.equal(actual.status, 'AWAITING_READBACK');
});

test('A+ end-to-end: validated creation, full association, content edit, approval submission and delayed readback', async () => {
  const f = fixture(); const op = f.ops[1];
  const create = await perform(op, { action: 'create', contentDocument: doc(), asinSet: ['B000000001'] });
  assert.equal(create.sent.status, 'DRAFT_CREATED');
  assert.deepEqual(create.sent.createdIds, ['CONTENT1']);
  assert.equal(create.verified.match, true);
  assert.deepEqual(create.verified.actual.asinSet, [], 'validation ASIN set must not silently associate');
  assert.equal(create.checkpoints[0].stage, 'CREATE_SENDING');
  assert.equal(create.checkpoints[1].contentReferenceKey, 'CONTENT1');
  const association = await perform(op, { action: 'associate', contentReferenceKey: 'CONTENT1', asinSet: ['B000000002', 'B000000001'] });
  assert.equal(association.verified.status, 'ASINS_ASSOCIATED');
  assert.deepEqual(association.request.body, { asinSet: ['B000000001', 'B000000002'] });
  const edit = doc(); edit.contentModuleList[0].standardText.body.textList[0].value = 'Revised synthetic content';
  const update = await perform(op, { action: 'update', contentReferenceKey: 'CONTENT1', contentDocument: edit });
  assert.equal(update.request.method, 'POST', 'official update operation is POST, not PUT');
  assert.equal(update.sent.status, 'CONTENT_UPDATED');
  assert.equal(update.verified.match, true);
  const submit = await perform(op, { action: 'submit', contentReferenceKey: 'CONTENT1' });
  assert.equal(submit.sent.status, 'SUBMITTED_FOR_REVIEW');
  assert.equal(submit.verified.match, false);
  assert.equal(submit.verified.actual.reviewStatus, 'NOT_YET_CHECKED');
  f.state.clock += 3600_001;
  const review = await op.readback(store, { action: 'submit', contentReferenceKey: 'CONTENT1' }, submit.newValue, submit.sent);
  assert.equal(review.match, true);
  assert.equal(review.status, 'SUBMITTED_FOR_REVIEW');
  assert.notEqual(review.status, 'PUBLISHED');
  await assert.rejects(prepare(op, { action: 'submit', contentReferenceKey: 'CONTENT1' }), /不重复提交/);
  const writes = f.state.calls.filter((c) => c.isWrite);
  assert.deepEqual(writes.map((c) => c.path), ['/aplus/2020-11-01/contentDocuments', '/aplus/2020-11-01/contentDocuments/CONTENT1/asins', '/aplus/2020-11-01/contentDocuments/CONTENT1', '/aplus/2020-11-01/contentDocuments/CONTENT1/approvalSubmissions']);
});

test('A+ rejects validation errors on HTTP 200 and blocks approval with warnings or absent associations', async () => {
  const f = fixture(); const op = f.ops[1];
  f.state.validation = { errors: [{ code: 'ASIN_NOT_ELIGIBLE', message: 'Synthetic brand restriction' }] };
  const validation = await f.validateAplusContent(store, { contentDocument: doc(), asinSet: ['B000000001'] });
  assert.equal(validation.valid, false);
  assert.equal(validation.submitted, false);
  await assert.rejects(prepare(op, { action: 'create', contentDocument: doc() }), /ASIN_NOT_ELIGIBLE/);
  f.state.validation = { warnings: [{ code: 'WARNING', message: 'Synthetic review warning' }] };
  const key = f.insert();
  await assert.rejects(prepare(op, { action: 'submit', contentReferenceKey: key }), /校验警告/);
  f.state.validation = {};
  f.state.docs.get(key).asins = [];
  await assert.rejects(prepare(op, { action: 'submit', contentReferenceKey: key }), /没有关联 ASIN/);
  assert.equal(f.state.calls.filter((c) => c.isWrite).length, 0);
});

test('A+ duplicate creation scans every page and is rejected before writing, including execute preflight', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) f.insert(`Existing ${i}`);
  await assert.rejects(f.ops[1].read(store, { action: 'create', contentDocument: doc('Existing 4') }), /已有同名/);
  assert.equal(f.state.calls.filter((c) => c.path.endsWith('/contentDocuments')).length, 3);
  assert.equal(f.state.calls.filter((c) => c.isWrite).length, 0);
  assert.equal(f.ops[1].creates({ action: 'create' }), true);
  assert.equal(f.ops[1].creates({ action: 'associate' }), false);
  assert.deepEqual(f.ops[1].creationIdentity({ action: 'create', contentDocument: doc('A') }), { action: 'create', name: 'A' });
});

test('A+ unknown creation keeps the before-send checkpoint and only offers candidates, never retries', async () => {
  const f = fixture(); const op = f.ops[1];
  const change = { action: 'create', contentDocument: doc() };
  const p = await prepare(op, change);
  f.state.mode = 'lost-create-response';
  const saved = [];
  await assert.rejects(op.send(store, p.request, { checkpoint: async (v) => saved.push(clone(v)) }), /timeout/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'OUTCOME_UNKNOWN');
  const result = await op.readback(store, change, p.newValue, saved[0]);
  assert.equal(result.match, false);
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(result.actual.candidates.length, 1);
  assert.equal(f.state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/contentDocuments')).length, 1);
});

test('A+ partial warning preserves the created ID; missing ID stays outcome-unknown', async () => {
  const f = fixture(); const op = f.ops[1];
  f.state.warnings = [{ code: 'PARTIAL', message: 'Synthetic partial result' }];
  const result = await perform(op, { action: 'create', contentDocument: doc() });
  assert.equal(result.sent.ok, false);
  assert.equal(result.sent.status, 'PARTIALLY_SUCCEEDED');
  assert.equal(result.checkpoints.at(-1).contentReferenceKey, 'CONTENT1');
  assert.equal(result.verified.match, true, 'readback can establish document persistence, not publication');
  f.state.warnings = []; f.state.mode = 'missing-create-id';
  const unknown = await perform(op, { action: 'create', contentDocument: doc('Second synthetic document') });
  assert.equal(unknown.sent.status, 'OUTCOME_UNKNOWN');
  assert.equal(unknown.verified.match, false);
});

test('A+ ASIN replacement warns about removals and comparison checks both content and whole association', async () => {
  const f = fixture(); const key = f.insert('Existing', ['B000000001', 'B000000002', 'B000000003']);
  const result = await perform(f.ops[1], { action: 'associate', contentReferenceKey: key, asinSet: ['B000000003'] });
  assert.ok(result.warnings.some((v) => /B000000001, B000000002/.test(v)));
  assert.deepEqual(f.state.docs.get(key).asins, ['B000000003']);
  f.state.docs.get(key).contentDocument.name = 'Someone else edited this';
  const readback = await f.ops[1].readback(store, { action: 'associate', contentReferenceKey: key }, result.newValue, result.sent);
  assert.equal(readback.match, false);
});

test('A+ published records never prove that an approved current revision is on the buyer page', async () => {
  const f = fixture(); const key = f.insert();
  f.state.docs.get(key).contentMetadata.status = 'APPROVED';
  f.state.publishRecords.push({ asin: 'B000000001', marketplaceId: US, locale: 'en-US', contentType: 'EBC', contentReferenceKey: key });
  const first = await f.getAplusStatus(store, { contentReferenceKey: key });
  assert.equal(first.reviewStatus, 'APPROVED');
  assert.equal(first.publicationRecordFound, true);
  assert.equal(first.publicationVerification, 'REFERENCE_ONLY_NO_REVISION');
  assert.equal(first.currentRevisionPublished, null);
  const second = await f.getAplusStatus(store, { contentReferenceKey: key });
  assert.equal(second.cached, true);
  assert.equal(f.state.calls.filter((c) => c.method === 'GET' && c.path.endsWith(`/contentDocuments/${key}`)).length, 1);
  f.state.clock += 3600_001;
  f.state.docs.get(key).contentMetadata.status = 'REJECTED';
  const later = await f.getAplusStatus(store, { contentReferenceKey: key });
  assert.equal(later.reviewStatus, 'REJECTED');
  assert.equal(later.publicationRecordFound, true, 'an older publication record can coexist with rejected revision');
  assert.equal(later.currentRevisionPublished, null);
});

test('A+ malformed document and unsupported image references are rejected before any write', async () => {
  const f = fixture();
  const invalid = doc(); invalid.locale = 'en_US';
  await assert.rejects(f.validateAplusContent(store, { contentDocument: invalid }), /en-US/);
  const imageDoc = doc(); imageDoc.contentModuleList = [{ contentModuleType: 'STANDARD_HEADER_IMAGE_TEXT', standardHeaderImageText: { block: { image: { imageCropSpecification: {}, altText: 'Synthetic image', url: 'https://example.com/image.jpg' } } } }];
  await assert.rejects(f.validateAplusContent(store, { contentDocument: imageDoc }), /uploadDestinationId/);
  await assert.rejects(f.validateAplusContent(store, { contentDocument: doc(), asinSet: ['invalid'] }), /10 位/);
  assert.equal(f.state.calls.filter((c) => c.isWrite).length, 0);
});


test('A+ review cache survives client restart and submission cooldown prevents early query', async () => {
  const f = fixture({ persistent: true }); const key = f.insert();
  await f.getAplusStatus(store, { contentReferenceKey: key });
  const reopened = f.reopen();
  const cached = await reopened.getAplusStatus(store, { contentReferenceKey: key });
  assert.equal(cached.cached, true);
  assert.equal(f.state.calls.filter((c) => c.method === 'GET' && c.path.endsWith(`/contentDocuments/${key}`)).length, 1);
  const submit = await perform(f.ops[1], { action: 'submit', contentReferenceKey: key });
  const before = f.state.calls.length;
  const delayed = await f.reopen().getAplusStatus(store, { contentReferenceKey: key });
  assert.equal(delayed.status, 'SUBMITTED_FOR_REVIEW');
  assert.equal(delayed.reviewStatus, 'NOT_YET_CHECKED');
  assert.equal(f.state.calls.length, before, 'must not poll approval early after restart');
  f.state.clock += 3600_001;
  const checked = await f.ops[1].readback(store, { action: 'submit', contentReferenceKey: key }, submit.newValue, submit.sent);
  assert.equal(checked.match, true);
  const count = f.state.calls.length;
  await f.reopen().ops[1].readback(store, { action: 'submit', contentReferenceKey: key }, submit.newValue, submit.sent);
  assert.equal(f.state.calls.length, count, 'repeated verify honors persisted hourly cache');
});

test('unknown image write remains unknown when readback does not match', async () => {
  const f = fixture();
  const result = await f.ops[0].readback(store, { sku: 'SYNTHETIC-SKU' }, { main_product_image_locator: 'https://example.com/missing.jpg' }, { status: 'OUTCOME_UNKNOWN' });
  assert.equal(result.match, false);
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
});


test('execution rechecks live image preview and A+ eligibility even if stored content is unchanged', async () => {
  const f = fixture(); const images = f.ops[0];
  const change = { sku: 'SYNTHETIC-SKU', images: { main_product_image_locator: 'https://example.com/new.jpg' } };
  const p = await prepare(images, change);
  f.state.previewStatus = 'INVALID';
  const result = await images.send(store, p.request);
  assert.equal(result.status, 'FAILED');
  assert.equal(f.state.calls.filter((c) => c.method === 'PATCH' && !c.body.preview).length, 0);
  const key = f.insert();
  const c = { action: 'submit', contentReferenceKey: key };
  await prepare(f.ops[1], c);
  f.state.validation = { errors: [{ code: 'ELIGIBILITY_CHANGED', message: 'Synthetic eligibility changed' }] };
  await assert.rejects(f.ops[1].read(store, c), /ELIGIBILITY_CHANGED/);
});
