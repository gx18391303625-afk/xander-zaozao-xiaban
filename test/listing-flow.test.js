// Exercise the installed MCP handlers against localhost only. All configuration,
// approval records and synthetic credentials live in a disposable test directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { isolate } from './helpers.js';

const dir = isolate();
const US = 'ATVPDKIKX0DER';
const CA = 'A2EUQ1WTGCTBG2';
const SKU = 'SYNTHETIC-HIGHLIGHT-SKU';
const schemaUrl = 'https://synthetic.amazonaws.com/listing-test-schema.json';
const row = (value, language_tag = 'en_US', marketplace_id = US) => ({ value, language_tag, marketplace_id });
const initial = () => ({
  title_differentiation: [row('Other market', 'en_CA', CA), row('Other language', 'es_US'), row('Old highlight')],
  item_name: [row('Old title')],
  bullet_point: [row('Old bullet one'), row('Old bullet two')],
  product_description: [row('Old description')],
  brand: [row('Preserved brand')],
  purchasable_offer: [{ marketplace_id: US, currency: 'USD', our_price: [{ schedule: [{ value_with_tax: 19.99 }] }] }],
});
const schema = () => ({
  $defs: { language_tag: { type: 'string', enum: ['en_US', 'es_US'] }, marketplace_id: { type: 'string', enum: [US] } },
  properties: { title_differentiation: { type: 'array', minItems: 1, minUniqueItems: 1, maxUniqueItems: 1,
    selectors: ['marketplace_id', 'language_tag'], items: { type: 'object', additionalProperties: false,
      required: ['language_tag', 'value'], properties: {
        value: { type: 'string', maxLength: 125 },
        language_tag: { $ref: '#/$defs/language_tag' }, marketplace_id: { $ref: '#/$defs/marketplace_id' },
      } } } },
});
const state = {};
function reset() {
  Object.assign(state, { attributes: initial(), calls: [], preview: { status: 'VALID', issues: [] },
    schema: schema(), schemaUrl, checksum: undefined, apply: true, pending: undefined, productType: 'APPENDAGE_WARMER', submitMode: undefined });
}
reset();
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const piece of req) raw += piece;
  const url = new URL(req.url, 'http://localhost');
  const body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : raw;
  const call = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body };
  state.calls.push(call);
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/auth/o2/token') return json(200, { access_token: 'SYNTHETIC_ACCESS_TOKEN', expires_in: 3600 });
  if (url.pathname.startsWith('/definitions/2020-09-01/productTypes/')) return json(200, {
    schema: { link: { resource: state.schemaUrl }, ...(state.checksum ? { checksum: state.checksum } : {}) },
  });
  if (url.pathname !== `/listings/2021-08-01/items/SYNTHETIC_SELLER/${SKU}`) return json(404, { message: 'Unexpected synthetic route' });
  if (req.method === 'GET') return json(200, { sku: SKU,
    summaries: [{ marketplaceId: US, productType: state.productType, asin: 'B000000001' }], attributes: state.attributes, issues: [],
  });
  if (req.method === 'PATCH') {
    if (url.searchParams.get('mode') === 'VALIDATION_PREVIEW') return json(200, state.preview);
    state.pending = structuredClone(body.patches);
    if (state.submitMode === 'lost-response-locale-drift') {
      state.attributes.title_differentiation = [row('New highlight', 'es_US')];
      return json(503, { message: 'Synthetic uncertain submission' });
    }
    if (state.apply) for (const patch of body.patches) state.attributes[patch.path.slice('/attributes/'.length)] = patch.value;
    return json(200, { status: 'ACCEPTED', submissionId: 'synthetic-submission', issues: [] });
  }
  return json(405, { message: 'Unexpected synthetic method' });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.XANDER_SPAPI_HOST = base;
process.env.XANDER_LWA_URL = `${base}/auth/o2/token`;
// officialSchema's Amazon URL/checksum handling is exercised without external I/O.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const address = new URL(url);
  if (address.origin === base) return originalFetch(url, options);
  if (address.href === schemaUrl) {
    state.calls.push({ method: 'GET', path: 'synthetic-schema-download' });
    return new Response(JSON.stringify(state.schema), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  assert.fail(`External network access is forbidden in this test: ${address.origin}`);
};

const { updateConfig } = await import('../lib/config.js');
const { setSecret } = await import('../lib/secrets.js');
const { setSwitch } = await import('../lib/switches.js');
const { panelDecision, loadProposal, listProposals } = await import('../lib/proposals.js');
const { buildTools } = await import('../server/tools.js');
const tools = Object.fromEntries(buildTools('synthetic-test').map((tool) => [tool.name, tool]));
const invoke = async (name, args) => JSON.parse(await tools[name].handler(args));
const draft = (value = 'New highlight', extra = {}) => invoke('xander_prepare_change', {
  store: 'synthetic', changes: [{ op: 'listing.attribute', sku: SKU, attribute: 'title_differentiation', value, ...extra }],
});
const execute = (proposal) => invoke('xander_execute_change', { proposalId: proposal.proposalId, hash: proposal.hash, approved: true });
const realPatches = () => state.calls.filter((call) => call.method === 'PATCH' && call.query.mode !== 'VALIDATION_PREVIEW');
const previews = () => state.calls.filter((call) => call.method === 'PATCH' && call.query.mode === 'VALIDATION_PREVIEW');
setSecret('spapi:synthetic', { clientId: 'SYNTHETIC_ID', clientSecret: 'SYNTHETIC_SECRET', refreshToken: 'SYNTHETIC_REFRESH' });
updateConfig((config) => { config.stores.synthetic = { region: 'NA', sellerId: 'SYNTHETIC_SELLER', defaultMarketplace: 'US', marketplaces: ['US'] }; });

test.beforeEach(() => {
  reset();
  updateConfig((config) => { config.settings.dryRun = true; config.settings.approvalMode = 'panel'; });
  setSwitch('listing.attribute', true);
});
test.after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('real listing_get handler returns title_differentiation through the read-only endpoint', async () => {
  const listing = await invoke('xander_listing_get', { store: 'synthetic', sku: SKU, marketplace: 'US' });
  assert.deepEqual(listing.attributes.title_differentiation, initial().title_differentiation);
  const call = state.calls.find((call) => call.path.startsWith('/listings/'));
  assert.equal(call.method, 'GET');
  assert.equal(call.query.marketplaceIds, US);
  assert.ok(call.query.includedData.split(',').includes('attributes'));
  assert.equal(realPatches().length, 0);
});

test('prepare → panel approval → DRY_RUN does no formal PATCH and cannot bypass approval', async () => {
  const before = structuredClone(state.attributes);
  const proposal = await draft();
  assert.equal(proposal.ok, true, JSON.stringify(proposal.errors));
  assert.equal(proposal.approvalMode, 'panel');
  assert.equal(previews().length, 1);
  assert.equal(previews()[0].body.productType, 'APPENDAGE_WARMER');
  assert.equal(previews()[0].body.patches[0].path, '/attributes/title_differentiation');
  await assert.rejects(execute(proposal), /面板审批/);
  assert.equal(loadProposal(proposal.proposalId).status, 'PROPOSED');
  panelDecision(proposal.proposalId, 'approve');
  assert.equal((await execute(proposal)).status, 'DRY_RUN');
  assert.equal(realPatches().length, 0);
  assert.deepEqual(state.attributes, before);
  assert.equal((await invoke('xander_verify_change', { proposalId: proposal.proposalId })).status, 'DRY_RUN');
  assert.equal(realPatches().length, 0);
  await assert.rejects(execute(proposal), /不能再次执行/);
});

test('mock formal submit and delayed independent verify use the approved request and never resend', async () => {
  updateConfig((config) => { config.settings.dryRun = false; });
  state.apply = false;
  const original = structuredClone(state.attributes);
  const proposal = await draft();
  assert.equal(proposal.ok, true, JSON.stringify(proposal.errors));
  const request = loadProposal(proposal.proposalId).items[0].request;
  panelDecision(proposal.proposalId, 'approve');
  const submitted = await execute(proposal);
  assert.equal(submitted.status, 'AWAITING_READBACK');
  assert.equal(realPatches().length, 1);
  assert.deepEqual(realPatches()[0].body, { productType: request.productType, patches: request.patches });
  assert.equal(previews().length, 2, 'formal mock execution revalidates before sending');
  assert.deepEqual(state.attributes, original, 'ACCEPTED alone does not claim a verified result');
  const getCount = state.calls.filter((call) => call.method === 'GET' && call.path.startsWith('/listings/')).length;
  for (const patch of state.pending) state.attributes[patch.path.slice('/attributes/'.length)] = structuredClone(patch.value);
  const verified = await invoke('xander_verify_change', { proposalId: proposal.proposalId });
  assert.equal(verified.status, 'API_STATE_VERIFIED');
  assert.ok(state.calls.filter((call) => call.method === 'GET' && call.path.startsWith('/listings/')).length > getCount);
  assert.equal(realPatches().length, 1, 'independent verification is read-only');
  assert.deepEqual(state.attributes, { ...original, title_differentiation: request.patches[0].value });
  await assert.rejects(execute(proposal), /不能再次执行/);
});

test('another locale changing after approval makes the complete attribute snapshot stale', async () => {
  updateConfig((config) => { config.settings.dryRun = false; });
  const proposal = await draft();
  assert.equal(proposal.ok, true, JSON.stringify(proposal.errors));
  panelDecision(proposal.proposalId, 'approve');
  state.attributes.title_differentiation[0].value = 'Concurrent Canadian edit';
  const result = await execute(proposal);
  assert.equal(result.status, 'SKIPPED_STALE');
  assert.equal(realPatches().length, 0);
  assert.equal(state.attributes.title_differentiation[0].value, 'Concurrent Canadian edit');
  assert.equal(state.attributes.title_differentiation[2].value, 'Old highlight');
});

test('uncertain submission cannot be falsely verified by matching text in a different language', async () => {
  updateConfig((config) => { config.settings.dryRun = false; });
  const proposal = await draft();
  assert.equal(proposal.ok, true, JSON.stringify(proposal.errors));
  assert.equal(loadProposal(proposal.proposalId).items[0].change.languageTag, 'en_US', 'approval fixes the readback locale even if send loses its receipt');
  panelDecision(proposal.proposalId, 'approve');
  state.submitMode = 'lost-response-locale-drift';
  assert.equal((await execute(proposal)).status, 'OUTCOME_UNKNOWN');
  assert.equal(realPatches().length, 1);
  assert.equal((await invoke('xander_verify_change', { proposalId: proposal.proposalId })).status, 'OUTCOME_UNKNOWN');
  assert.equal(realPatches().length, 1, 'uncertain submission is never retried by verification');
});

test('Amazon rejection on execution revalidation remains FAILED rather than OUTCOME_UNKNOWN', async () => {
  updateConfig((config) => { config.settings.dryRun = false; });
  const proposal = await draft();
  assert.equal(proposal.ok, true, JSON.stringify(proposal.errors));
  panelDecision(proposal.proposalId, 'approve');
  state.preview = { status: 'INVALID', issues: [{ severity: 'ERROR', code: 'REJECTED', message: 'Synthetic updated rules' }] };
  assert.equal((await execute(proposal)).status, 'FAILED');
  assert.equal(realPatches().length, 0);
});

test('the complete attribute precondition is integrity protected by the proposal hash', async () => {
  const proposal = await draft();
  assert.equal(proposal.ok, true, JSON.stringify(proposal.errors));
  const saved = loadProposal(proposal.proposalId);
  assert.ok(saved.items[0].precondition, 'full attribute precondition is saved for concurrency protection');
  saved.items[0].precondition.productType = 'TAMPERED_PRODUCT_TYPE';
  fs.writeFileSync(path.join(dir, 'proposals', `${proposal.proposalId}.json`), JSON.stringify(saved));
  await assert.rejects(execute(proposal), /完整性|哈希/);
  assert.equal(realPatches().length, 0);
});

test('a stored v2 title proposal retains its historical approved hash and executes through mock approval', async () => {
  updateConfig((config) => { config.settings.dryRun = false; });
  // Frozen pre-upgrade v2 signature; deliberately lacks the new precondition and
  // languageTag fields. Do not recalculate its hash with the current signer.
  const legacy = {
    id: 'P20261023000000abcd', hashVersion: 2, hash: 'c35c1df4cb813af3', store: 'synthetic', status: 'PROPOSED',
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), approvalMode: 'panel', panelApproved: false,
    items: [{ index: 0, op: 'listing.attribute', label: 'Legacy title change', old: ['Old title'], new: ['Legacy approved title'],
      request: { sku: SKU, marketplace: 'US', productType: 'APPENDAGE_WARMER',
        patches: [{ op: 'replace', path: '/attributes/item_name', value: [row('Legacy approved title')] }] },
      change: { op: 'listing.attribute', sku: SKU, attribute: 'item_name', value: 'Legacy approved title', marketplace: 'US' },
      marketplace: 'US', target: { sku: SKU, attribute: 'item_name', asin: 'B000000001' }, creationKey: null,
    }],
  };
  fs.mkdirSync(path.join(dir, 'proposals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposals', `${legacy.id}.json`), JSON.stringify(legacy));
  const proposal = { proposalId: legacy.id, hash: legacy.hash };
  await assert.rejects(execute(proposal), /面板审批/);
  panelDecision(legacy.id, 'approve');
  assert.equal((await execute(proposal)).status, 'API_STATE_VERIFIED');
  assert.equal(realPatches().length, 1);
  assert.deepEqual(state.attributes.item_name, [row('Legacy approved title')]);
  assert.deepEqual(state.attributes.title_differentiation, initial().title_differentiation);
});

test('invalid Amazon schema preview creates no proposal and no formal submission', async () => {
  const before = listProposals(1000).length;
  state.preview = { status: 'INVALID', issues: [{ severity: 'ERROR', code: '90244', message: 'Synthetic value exceeds schema maxLength 125' }] };
  const proposal = await draft('A schema-conforming length with a synthetic conditional error');
  assert.equal(proposal.ok, false);
  assert.equal(proposal.proposalId, undefined);
  assert.match(proposal.errors[0].error, /90244|maxLength|预校验|INVALID/);
  assert.equal(listProposals(1000).length, before);
  assert.equal(realPatches().length, 0);
});

test('highlight limits follow current PTD: 125 succeeds, 126 fails, and a changed schema is read afresh', async () => {
  assert.equal((await draft('x'.repeat(125))).ok, true);
  const previewCount = previews().length;
  const tooLong = await draft('x'.repeat(126));
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.errors[0].error, /125/);
  assert.equal(previews().length, previewCount, 'direct PTD length failure cannot reach preview or submission');
  state.schema.properties.title_differentiation.items.properties.value.maxLength = 140;
  assert.equal((await draft('x'.repeat(126))).ok, true, 'length 125 must not be hardcoded as a universal limit');
  assert.equal(realPatches().length, 0);
});

test('actual 100473 policy rejection blocks locked approved copy without rewriting it or producing a proposal', async () => {
  const value = 'Esports Essential; Christmas Gifts and Stocking Stuffers for Men and Women; Magnetic 2 Pack, 3 Heat Levels, Digital Display';
  state.preview = { status: 'INVALID', issues: [{ severity: 'ERROR', code: '100473',
    message: 'The Item Highlight has following prohibited phrases [Christmas Gifts], which is not compliant with Amazon policy and should be removed from the Item Highlight.',
    attributeNames: ['title_differentiation'],
  }] };
  const before = listProposals(1000).length;
  const result = await draft(value);
  assert.equal(result.ok, false);
  assert.equal(result.proposalId, undefined);
  assert.match(result.errors[0].error, /100473/);
  assert.match(result.errors[0].error, /Christmas Gifts/);
  assert.equal(listProposals(1000).length, before);
  assert.deepEqual(previews()[0].body.patches[0].value.at(-1), row(value), 'locked copy must reach preview unchanged');
  assert.deepEqual(state.attributes, initial());
  assert.equal(realPatches().length, 0);
});

test('same or trim-equivalent content returns no proposal rather than manufactured success', async () => {
  const before = listProposals(1000).length;
  for (const value of ['Old highlight', '  Old highlight  ']) {
    const result = await draft(value);
    assert.equal(result.ok, false);
    assert.equal(result.proposalId, undefined);
    assert.match(result.errors[0].error, /当前内容一样|相同|already/i);
  }
  assert.equal(listProposals(1000).length, before);
  assert.equal(previews().length, 0);
  assert.equal(realPatches().length, 0);
});

test('official PTD download rejects untrusted URLs and checksum mismatches', async () => {
  for (const invalid of ['untrusted-url', 'checksum']) {
    reset();
    if (invalid === 'untrusted-url') state.schemaUrl = 'https://untrusted.example/schema.json';
    else state.checksum = 'not-the-schema-checksum';
    const result = await draft();
    assert.equal(result.ok, false);
    assert.equal(result.proposalId, undefined);
    assert.equal(previews().length, 0);
    assert.equal(realPatches().length, 0);
  }
});
