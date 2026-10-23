import test from 'node:test';
import assert from 'node:assert/strict';
import { createListingAttributeOperation } from '../lib/ops-listing.js';

const US = 'ATVPDKIKX0DER';
const CA = 'A2EUQ1WTGCTBG2';
const store = { alias: 'synthetic', sellerId: 'SYNTHETIC_SELLER', region: 'NA', defaultMarketplace: 'US' };
const clone = (value) => structuredClone(value);
const row = (value, language_tag = 'en_US', marketplace_id = US) => ({ value, language_tag, marketplace_id });
const change = (value = 'Synthetic new highlight', extra = {}) => ({ op: 'listing.attribute', sku: 'SYNTHETIC-SKU', attribute: 'title_differentiation', value, ...extra });

function fixture() {
  const state = {
    calls: [],
    attributes: {
      title_differentiation: [row('Canadian highlight', 'en_CA', CA), row('Spanish highlight', 'es_US'), row('Old US highlight')],
      item_name: [row('Old title')],
      bullet_point: [row('Old bullet 1'), row('Old bullet 2')],
      product_description: [row('Old description')],
      generic_keyword: [row('Old keywords')],
      brand: [row('Unrelated brand')],
      purchasable_offer: [{ marketplace_id: US, currency: 'USD', our_price: [{ schedule: [{ value_with_tax: 19.99 }] }] }],
    },
    summaries: [
      { marketplaceId: CA, asin: 'B000000002', productType: 'OTHER_PRODUCT_TYPE' },
      { marketplaceId: US, asin: 'B000000001', productType: 'APPENDAGE_WARMER' },
    ],
    schema: { properties: { title_differentiation: { type: 'array', items: { type: 'object', properties: {
      value: { type: 'string' }, language_tag: { type: 'string' }, marketplace_id: { type: 'string' },
    } } } } },
    preview: { status: 'VALID', issues: [] },
    submit: { status: 'ACCEPTED', submissionId: 'synthetic-submission', issues: [] },
    apply: true,
  };
  const op = createListingAttributeOperation({
    async listing(alias, sku, market) {
      assert.equal(alias, store.alias); assert.equal(sku, 'SYNTHETIC-SKU'); assert.equal(market, 'US');
      state.calls.push({ kind: 'read' });
      return { sku, summaries: clone(state.summaries), attributes: clone(state.attributes), issues: clone(state.issues || []) };
    },
    async api(alias, method, path, options) {
      state.calls.push({ kind: 'definition', alias, method, path, options: clone(options) });
      return { schema: { link: { resource: 'https://synthetic.amazonaws.com/schema.json' } } };
    },
    async fetchSchema(definition) {
      assert.equal(definition.schema.link.resource, 'https://synthetic.amazonaws.com/schema.json');
      state.calls.push({ kind: 'schema' });
      if (state.schemaError) throw new Error(state.schemaError);
      return clone(state.schema);
    },
    async patch(alias, sku, market, request) {
      assert.equal(alias, store.alias); assert.equal(sku, 'SYNTHETIC-SKU'); assert.equal(market, 'US');
      state.calls.push({ kind: request.preview ? 'preview' : 'submit', request: clone(request) });
      if (request.preview) return clone(state.preview);
      if (state.apply && state.submit.status === 'ACCEPTED') {
        for (const p of request.patches) state.attributes[p.path.slice('/attributes/'.length)] = clone(p.value);
      }
      return clone(state.submit);
    },
  });
  return { op, state };
}

async function prepare(op, c) {
  const read = await op.read(store, c);
  const checked = op.check(c, read, {});
  const request = op.build(c, read, checked.newValue);
  const preview = await op.preview(store, request);
  return { read, checked, request, preview };
}

test('Item Highlights uses title_differentiation, selected marketplace summary and current official PTD', async () => {
  const { op, state } = fixture();
  const r = await prepare(op, change());
  assert.deepEqual(r.read.old, ['Old US highlight']);
  assert.equal(r.read.marketplace, 'US');
  assert.equal(r.read.entity.productType, 'APPENDAGE_WARMER');
  assert.equal(r.read.entity.asin, 'B000000001');
  assert.equal(r.request.productType, 'APPENDAGE_WARMER');
  const definition = state.calls.find((c) => c.kind === 'definition');
  assert.equal(definition.method, 'GET');
  assert.equal(definition.path, '/definitions/2020-09-01/productTypes/APPENDAGE_WARMER');
  assert.equal(definition.options.query.marketplaceIds, US);
  assert.equal(definition.options.query.sellerId, store.sellerId);
  assert.equal(definition.options.query.requirements, 'LISTING');
  assert.equal(definition.options.query.requirementsEnforced, 'ENFORCED');
  assert.equal(definition.options.query.productTypeVersion, 'LATEST');
  assert.ok(state.calls.some((c) => c.kind === 'schema'));
});

test('highlight patch retains other marketplaces, languages and unrelated attributes', async () => {
  const { op, state } = fixture();
  const original = clone(state.attributes);
  const r = await prepare(op, change());
  assert.equal(r.request.patches.length, 1);
  assert.equal(r.request.patches[0].op, 'replace');
  assert.equal(r.request.patches[0].path, '/attributes/title_differentiation');
  assert.deepEqual(r.request.patches[0].value, [...original.title_differentiation.slice(0, 2), row('Synthetic new highlight')]);
  assert.deepEqual(state.attributes, original, 'prepare and validation cannot mutate listings');
  const sent = await op.send(store, r.request);
  assert.equal(sent.ok, true);
  assert.deepEqual(state.attributes, { ...original, title_differentiation: r.request.patches[0].value });
  assert.deepEqual((await op.readback(store, change(), r.checked.newValue)).actual, ['Synthetic new highlight']);
});

test('editing selected text preserves its existing metadata and semicolons as a single value', async () => {
  const { op, state } = fixture();
  state.attributes.title_differentiation[2].qualifier = 'Synthetic existing metadata';
  const value = 'First highlight; Second highlight; Third highlight';
  const r = await prepare(op, change(value));
  assert.deepEqual(r.checked.newValue, [value]);
  assert.deepEqual(r.request.patches[0].value[2], { ...state.attributes.title_differentiation[2], value });
});

test('explicit language only changes that language; original other-language values are retained', async () => {
  const { op, state } = fixture();
  const original = clone(state.attributes.title_differentiation);
  const r = await prepare(op, change('Nuevo texto', { languageTag: 'es_US' }));
  assert.deepEqual(r.read.old, ['Spanish highlight']);
  assert.deepEqual(r.request.patches[0].value, [original[0], row('Nuevo texto', 'es_US'), original[2]]);
  await op.send(store, r.request);
  const rb = await op.readback(store, change('Nuevo texto', { languageTag: 'es_US' }), ['Nuevo texto']);
  assert.equal(rb.match, true);
});

test('absent highlight uses marketplace language and still gets Amazon validation', async () => {
  const { op, state } = fixture();
  delete state.attributes.title_differentiation;
  const r = await prepare(op, change());
  assert.deepEqual(r.read.old, []);
  assert.deepEqual(r.request.patches[0].value, [row('Synthetic new highlight')]);
  assert.equal(state.calls.filter((c) => c.kind === 'preview').length, 1);
});

test('schema absence and schema fetch failures block highlight proposals', async () => {
  for (const problem of ['unsupported', 'download']) {
    const { op, state } = fixture();
    if (problem === 'unsupported') state.schema = { properties: { item_name: { type: 'array' } } };
    else state.schemaError = 'Synthetic schema download failure';
    await assert.rejects(prepare(op, change()), problem === 'unsupported' ? /title_differentiation|亮点|支持/ : /schema download failure/);
    assert.ok(!state.calls.some((c) => c.kind === 'submit' || c.kind === 'preview'));
  }
});

test('Amazon preview owns category limits; a schema violation cannot become a proposal', async () => {
  const { op, state } = fixture();
  state.preview = { status: 'INVALID', issues: [{ severity: 'ERROR', code: '90244', message: 'Synthetic maxItems schema restriction' }] };
  await assert.rejects(prepare(op, change(['Highlight one', 'Highlight two'])), /90244|maxItems|预校验|INVALID/);
  assert.equal(state.calls.filter((c) => c.kind === 'preview').length, 1);
  assert.equal(state.calls.filter((c) => c.kind === 'submit').length, 0);
});

test('schema item counts apply to the complete preserved attribute array', async () => {
  const { op, state } = fixture();
  Object.assign(state.schema.properties.title_differentiation, { minItems: 3, maxItems: 3 });
  const r = await prepare(op, change('One replacement with two preserved locales'));
  assert.equal(r.request.patches[0].value.length, 3);
  await assert.rejects(prepare(op, change(['One replacement', 'An extra replacement'])), /3/);
  assert.equal(state.calls.filter((c) => c.kind === 'preview').length, 1, 'array beyond schema cardinality is blocked before preview');
});

test('unknown, invalid and incomplete preview results fail closed; VALID plus ERROR also fails', async () => {
  for (const preview of [undefined, {}, { status: 'INVALID', issues: [] }, { status: 'ACCEPTED', issues: [] },
    { status: 'VALID', issues: [{ severity: 'ERROR', code: 'ERROR', message: 'Rejected attribute' }] }]) {
    const { op, state } = fixture();
    state.preview = preview;
    await assert.rejects(prepare(op, change()));
    assert.equal(state.calls.filter((c) => c.kind === 'submit').length, 0);
  }
});

test('VALID preview warnings remain visible without being treated as validation failure', async () => {
  const { op, state } = fixture();
  const issue = { severity: 'WARNING', code: 'WARN', message: 'Synthetic warning' };
  state.preview = { status: 'VALID', issues: [issue] };
  const r = await prepare(op, change());
  assert.deepEqual(r.preview.issues, [issue]);
});

test('VALID without optional issues is accepted; malformed issues are rejected', async () => {
  const { op, state } = fixture();
  state.preview = { status: 'VALID' };
  assert.deepEqual((await prepare(op, change())).preview.issues, []);
  for (const issues of [null, {}, 'not-an-array', [null]]) {
    state.preview = { status: 'VALID', issues };
    await assert.rejects(prepare(op, change()));
  }
});

test('send validates again; rejection at execution prevents the formal PATCH', async () => {
  const { op, state } = fixture();
  const r = await prepare(op, change());
  state.preview = { status: 'INVALID', issues: [{ severity: 'ERROR', code: 'CHANGED_SCHEMA', message: 'Synthetic schema changed' }] };
  try {
    const sent = await op.send(store, r.request);
    assert.equal(sent.ok, false);
  } catch (error) {
    assert.match(error.message, /预校验|CHANGED_SCHEMA|INVALID/);
  }
  assert.equal(state.calls.filter((c) => c.kind === 'submit').length, 0);
});

test('formal mock PATCH preserves productType and exact approved patches, and is sent only once', async () => {
  const { op, state } = fixture();
  const r = await prepare(op, change());
  const sent = await op.send(store, r.request);
  assert.equal(sent.ok, true);
  const submissions = state.calls.filter((c) => c.kind === 'submit');
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].request.patches, r.request.patches);
  assert.equal(submissions[0].request.productType, 'APPENDAGE_WARMER');
  assert.equal(state.calls.filter((c) => c.kind === 'preview').length, 2);
});

test('readback checks only the approved locale, not a matching value in another locale', async () => {
  const { op, state } = fixture();
  state.attributes.title_differentiation[1].value = 'Synthetic new highlight';
  const rb = await op.readback(store, change(), ['Synthetic new highlight']);
  assert.deepEqual(rb.actual, ['Old US highlight']);
  assert.equal(rb.match, false);
});

test('readback is independent of schema downloads and surfaces relevant attribute errors', async () => {
  const { op, state } = fixture();
  state.schemaError = 'Synthetic schema unavailable during independent verification';
  const c = change('Old US highlight', { languageTag: 'en_US' });
  assert.equal((await op.readback(store, c, ['Old US highlight'])).match, true);
  state.issues = [{ severity: 'ERROR', code: '100473', message: 'Synthetic policy error', attributeNames: ['title_differentiation'] }];
  const failed = await op.readback(store, c, ['Old US highlight']);
  assert.equal(failed.match, false, 'matching contribution text with target ERROR is not verified success');
  assert.match(failed.note, /100473/);
  state.issues[0].attributeNames = ['item_name'];
  assert.equal((await op.readback(store, c, ['Old US highlight'])).match, true, 'unrelated attribute error does not invalidate this contribution check');
  assert.equal(state.calls.filter((call) => call.kind === 'definition' || call.kind === 'schema' || call.kind === 'submit').length, 0);
});

test('unchanged or whitespace-only differences never produce a false success', async () => {
  for (const value of ['Old US highlight', '  Old US highlight  ', ['Old US highlight']]) {
    const { op, state } = fixture();
    await assert.rejects(prepare(op, change(value)), /当前内容一样|相同|already/i);
    assert.equal(state.calls.filter((c) => c.kind === 'preview' || c.kind === 'submit').length, 0);
  }
});

test('empty or non-string highlight payloads are rejected', async () => {
  for (const value of ['', '   ', [], [''], [null], [1], {}]) {
    const { op, state } = fixture();
    await assert.rejects(prepare(op, change(value)));
    assert.equal(state.calls.filter((c) => c.kind === 'preview' || c.kind === 'submit').length, 0);
  }
});

test('existing title, bullets, description and keywords continue through preview, send and readback', async () => {
  for (const [attribute, value] of [['item_name', 'New title'], ['bullet_point', ['New bullet 1', 'New bullet 2']],
    ['product_description', 'New description'], ['generic_keyword', 'New keywords']]) {
    const { op, state } = fixture();
    const original = clone(state.attributes);
    const c = change(value, { attribute });
    const r = await prepare(op, c);
    assert.equal(state.calls.filter((c) => c.kind === 'definition').length, 0, 'existing attributes need no new PTD dependency');
    assert.equal(r.request.patches[0].path, `/attributes/${attribute}`);
    assert.equal((await op.send(store, r.request)).ok, true);
    assert.equal((await op.readback(store, c, r.checked.newValue)).match, true);
    for (const key of Object.keys(original).filter((key) => key !== attribute)) assert.deepEqual(state.attributes[key], original[key]);
  }
});

test('whitelist, title cardinality and bullet count safeguards remain active', async () => {
  for (const c of [change('brand change', { attribute: 'brand' }), change(['Title one', 'Title two'], { attribute: 'item_name' }),
    change(Array.from({ length: 11 }, (_, i) => `Bullet ${i}`), { attribute: 'bullet_point' })]) {
    const { op, state } = fixture();
    await assert.rejects(prepare(op, c));
    assert.equal(state.calls.filter((c) => c.kind === 'preview' || c.kind === 'submit').length, 0);
  }
});
