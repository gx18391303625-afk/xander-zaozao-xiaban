// Synthetic fixtures only. Contract assertions follow official unified-api-sp.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isolate } from './helpers.js';

isolate();
const state = { campaigns: [], adGroups: [], ads: [], calls: [], mode: null, pageSize: 1000, profileType: 'seller', country: 'US', currency: 'USD' };
let sequence = 0;
const copy = (v) => JSON.parse(JSON.stringify(v));
const SP = 'SPONSORED_PRODUCTS';
const singulars = { campaigns: 'campaign', adGroups: 'adGroup', ads: 'ad' };
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const url = new URL(req.url, 'http://localhost');
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/auth/o2/token') return json(200, { access_token: 'FAKE-ADS-TOKEN', expires_in: 3600 });
  const body = raw ? JSON.parse(raw) : null;
  state.calls.push({ path: url.pathname, body: copy(body), method: req.method });
  if (url.pathname === '/v2/profiles') return json(200, [{ profileId: 987, countryCode: state.country, currencyCode: state.currency, accountInfo: { type: state.profileType } }]);
  const match = url.pathname.match(/^\/adsApi\/v1\/(query|create|update)\/(campaigns|adGroups|ads)$/);
  if (!match || req.method !== 'POST') return json(400, { code: 'BAD_REQUEST' });
  const [, action, resource] = match; const singular = singulars[resource]; const idField = `${singular}Id`;
  if (action === 'query') {
    const found = state[resource].filter((item) => Object.entries(body).every(([key, value]) => {
      if (key === 'nameFilter') return value.include.includes(item.name);
      if (key.endsWith('Filter')) return value.include.includes(String(item[key.slice(0, -6)]));
      return true;
    }));
    const offset = Number(body.nextToken || 0); const page = found.slice(offset, offset + state.pageSize);
    return json(200, { [resource]: page, ...(state.mode === 'loop' ? { nextToken: '1' } : offset + page.length < found.length ? { nextToken: String(offset + page.length) } : {}) });
  }
  if (action === 'update') {
    const value = body.campaigns[0]; const item = state.campaigns.find((x) => x.campaignId === value.campaignId);
    item.optimizations.bidSettings = copy(value.optimizations.bidSettings);
    return json(207, { success: [{ index: 0, campaign: item }], error: [] });
  }
  if (state.mode === `unknown-code:${resource}`) return json(207, { success: [], error: [{ index: 0, errors: [{ code: 'UNKNOWN_SERVER_FAILURE' }] }] });
  const httpStatus = /^http-(408|409|429|499):/.exec(state.mode || '')?.[1];
  if (httpStatus && state.mode.endsWith(`:${resource}`)) { res.setHeader('Retry-After', '0.001'); return json(Number(httpStatus), { message: 'Synthetic transport response' }); }
  const reject = state.mode === `reject:${resource}`;
  if (reject) return json(207, { success: [], error: [{ index: 0, errors: [{ code: 'PRODUCT_INELIGIBLE', message: 'Synthetic rejection' }] }] });
  const value = copy(body[resource][0]);
  // Validate meaningful wire contract fields instead of accepting any shape.
  const required = resource === 'campaigns' ? ['adProduct', 'autoCreationSettings', 'budgets', 'marketplaceScope', 'name', 'startDateTime', 'state']
    : resource === 'adGroups' ? ['adProduct', 'bid', 'campaignId', 'name', 'state'] : ['adGroupId', 'adProduct', 'adType', 'creative', 'state'];
  if (required.some((k) => value[k] === undefined) || value.state !== 'PAUSED' || value.adProduct !== SP) return json(400, { code: 'BAD_REQUEST', message: 'Missing SP schema field' });
  if (resource === 'campaigns' && (!value.budgets[0]?.budgetValue?.monetaryBudgetValue?.monetaryBudget?.value || value.marketplaceScope !== 'SINGLE_MARKETPLACE')) return json(400, { message: 'Bad budget/scope contract' });
  if (resource === 'adGroups' && !state.campaigns.some((x) => x.campaignId === value.campaignId)) return json(400, { message: 'Unknown parent campaign' });
  if (resource === 'ads' && (!state.adGroups.some((x) => x.adGroupId === value.adGroupId) || !value.creative?.productCreative?.productCreativeSettings?.advertisedProduct?.productIdType)) return json(400, { message: 'Bad creative/parent contract' });
  value[idField] = `synthetic-${++sequence}`;
  if (resource === 'ads') value.campaignId = state.adGroups.find((x) => x.adGroupId === value.adGroupId).campaignId;
  if (state.mode !== `503-unapplied:${resource}`) state[resource].push(value);
  if (state.mode === `503-applied:${resource}` || state.mode === `503-unapplied:${resource}`) return json(503, { message: 'Synthetic ambiguous outcome' });
  if (state.mode === `no-id:${resource}`) return json(207, { success: [{ index: 0, [singular]: {} }], error: [] });
  if (state.mode === `missing-errors:${resource}`) return json(207, { success: [{ index: 0, [singular]: value }] });
  return json(207, { success: [{ index: 0, [singular]: value }], error: [] });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.XANDER_ADS_HOST = base; process.env.XANDER_LWA_URL = `${base}/auth/o2/token`;
const { setSecret } = await import('../lib/secrets.js');
const { updateConfig, getStore } = await import('../lib/config.js');
const { ADS_CREATE_OPS } = await import('../lib/ops-ads-create.js');
const { prepareChange, executeChange, verifyChange, loadProposal } = await import('../lib/proposals.js');
const { setSwitch } = await import('../lib/switches.js');
const [create, placement] = ADS_CREATE_OPS;
setSecret('ads:synthetic', { clientId: 'FAKE-CLIENT', clientSecret: 'FAKE-SECRET', refreshToken: 'FAKE-REFRESH' });
updateConfig((c) => { c.stores.synthetic = { region: 'NA', defaultMarketplace: 'US', marketplaces: ['US'], ads: { profiles: { US: '987' } } }; });
const store = getStore('synthetic');
const input = (extra = {}) => ({ marketplace: 'US', campaignName: 'Fixture campaign', adGroupName: 'Fixture group', dailyBudget: 5, defaultBid: 0.8, targetingType: 'MANUAL', startDateTime: '2030-11-01T00:00:00-07:00', products: [{ sku: 'SYNTHETIC-SKU-1' }, { sku: 'SYNTHETIC-SKU-2' }], ...extra });
async function prepare(c = input()) { const read = await create.read(store, c); const { newValue } = create.check(c, read); return { c, read, newValue, request: create.build(c, read, newValue) }; }
async function run(p) { const checkpoints = []; const result = await create.send(store, p.request, { checkpoint: async (v) => checkpoints.push(copy(v)) }); return { result, checkpoints }; }
const writes = () => state.calls.filter((c) => c.path.includes('/create/'));
function seedParents() {
  state.campaigns.push({ campaignId: 'C-existing', name: 'Existing', adProduct: SP, state: 'PAUSED', optimizations: { bidSettings: { bidStrategy: 'SALES_DOWN_ONLY', bidAdjustments: { audienceBidAdjustments: [{ audienceId: 'audience-fixture', percentage: 20 }], creativeBidAdjustments: [{ creativeType: 'SPOTLIGHT', percentage: 5 }], placementBidAdjustments: [{ placement: 'REST_OF_SEARCH', percentage: 10 }] } } } });
  state.adGroups.push({ adGroupId: 'G-existing', campaignId: 'C-existing', name: 'Existing group', state: 'PAUSED', adProduct: SP, bid: { defaultBid: 0.7 } });
}
test.beforeEach(() => { state.campaigns = []; state.adGroups = []; state.ads = []; state.calls = []; state.mode = null; state.pageSize = 1000; state.profileType = 'seller'; state.country = 'US'; state.currency = 'USD'; });
test.after(() => server.close());

test('SP creates exact approved campaign → group → products, paused, with durable checkpoints', async () => {
  const p = await prepare(); const { result, checkpoints } = await run(p);
  assert.equal(result.status, 'SUBMITTED'); assert.equal(result.ok, true);
  assert.deepEqual(writes().map((w) => w.path.split('/').at(-1)), ['campaigns', 'adGroups', 'ads', 'ads']);
  assert.equal(checkpoints.length, 9);
  assert.equal(checkpoints[0].steps[0].status, 'OUTCOME_UNKNOWN');
  assert.equal(checkpoints[1].steps[0].id, state.campaigns[0].campaignId);
  assert.equal(writes()[1].body.adGroups[0].campaignId, state.campaigns[0].campaignId);
  assert.equal(writes()[2].body.ads[0].adGroupId, state.adGroups[0].adGroupId);
  assert.deepEqual(writes()[2].body.ads[0].creative.productCreative.productCreativeSettings.advertisedProduct, { productIdType: 'SKU', productId: 'SYNTHETIC-SKU-1' });
  assert.equal(state.campaigns[0].autoCreationSettings.autoCreateTargets, false);
  assert.equal(state.campaigns[0].budgets[0].budgetValue.monetaryBudgetValue.monetaryBudget.value, 5);
  const readback = await create.readback(store, p.c, p.newValue, result);
  assert.equal(readback.match, true); assert.equal(readback.status, 'API_STATE_VERIFIED');
});

test('readback checks approved budget, targeting, dates, strategy, parent, product and paused state', async () => {
  const p = await prepare(); const { result } = await run(p);
  const campaign = copy(state.campaigns[0]); const group = copy(state.adGroups[0]); const ad = copy(state.ads[0]);
  for (const mutation of [
    () => { state.campaigns[0].budgets[0].budgetValue.monetaryBudgetValue.monetaryBudget.value = 50; },
    () => { state.campaigns[0].autoCreationSettings.autoCreateTargets = true; },
    () => { state.campaigns[0].startDateTime = '2030-11-02T00:00:00Z'; },
    () => { state.campaigns[0].optimizations.bidSettings.bidStrategy = 'MANUAL'; },
    () => { state.adGroups[0].campaignId = 'wrong'; },
    () => { state.ads[0].state = 'ENABLED'; },
    () => { state.ads[0].creative.productCreative.productCreativeSettings.advertisedProduct.productId = 'wrong'; },
  ]) {
    state.campaigns[0] = copy(campaign); state.adGroups[0] = copy(group); state.ads[0] = copy(ad); mutation();
    assert.equal((await create.readback(store, p.c, p.newValue, result)).match, false);
  }
});

test('uniqueness checks paginate and include archived names, case-insensitively', async () => {
  state.pageSize = 1;
  state.campaigns = [{ campaignId: 'C-1', name: 'First', adProduct: SP, state: 'PAUSED' }, { campaignId: 'C-2', name: 'FIXTURE CAMPAIGN', adProduct: SP, state: 'ARCHIVED' }];
  const c = input(); const r = await create.read(store, c);
  assert.throws(() => create.check(c, r), /重复创建/);
  assert.ok(state.calls.some((x) => x.body?.nextToken === '1')); assert.equal(writes().length, 0);
});

test('pagination loop fails closed', async () => { state.mode = 'loop'; await assert.rejects(() => prepare(), /分页令牌循环/); assert.equal(writes().length, 0); });

test('explicit child rejection preserves successful campaign and stops remaining writes', async () => {
  const p = await prepare(); state.mode = 'reject:adGroups'; const { result, checkpoints } = await run(p);
  assert.equal(result.status, 'PARTIALLY_SUCCEEDED'); assert.equal(result.ok, false);
  assert.ok(result.createdIds.campaignId); assert.equal(writes().length, 2);
  assert.equal(checkpoints.at(-1).steps.at(-1).status, 'FAILED');
  const checked = await create.readback(store, p.c, p.newValue, result);
  assert.equal(checked.status, 'PARTIALLY_SUCCEEDED'); assert.equal(checked.reconciled, true);
  state.campaigns[0].state = 'ENABLED';
  assert.equal((await create.readback(store, p.c, p.newValue, result)).reconciled, false);
});

test('ambiguous error never retries; no object found remains OUTCOME_UNKNOWN', async () => {
  const p = await prepare(); state.mode = '503-unapplied:adGroups'; const { result } = await run(p);
  assert.equal(result.status, 'OUTCOME_UNKNOWN'); assert.equal(writes().length, 2);
  assert.equal((await create.readback(store, p.c, p.newValue, result)).status, 'OUTCOME_UNKNOWN');
  await create.send(store, p.request, { sendResult: result, checkpoint: async () => assert.fail('must not write') });
  assert.equal(writes().length, 2);
});

test('lost final response recovers by unique operation tag and exact product, read only', async () => {
  const p = await prepare(input({ products: [{ sku: 'SYNTHETIC-SKU-1' }] })); state.mode = '503-applied:ads'; const { result } = await run(p);
  assert.equal(result.status, 'OUTCOME_UNKNOWN'); assert.equal(result.createdIds.adIds.length, 0);
  const checked = await create.readback(store, p.c, p.newValue, result);
  assert.equal(checked.match, true); assert.equal(writes().length, 3);
});

test('unknown child found with exact values reconciles attempted steps without sending unattempted ads', async () => {
  const p = await prepare(); state.mode = '503-applied:adGroups'; const { result } = await run(p);
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  const checked = await create.readback(store, p.c, p.newValue, result);
  assert.equal(checked.status, 'PARTIALLY_SUCCEEDED'); assert.equal(checked.reconciled, true); assert.equal(checked.match, false);
  assert.equal(writes().length, 2); assert.equal(state.ads.length, 0);
});

test('same name/product with foreign operation tag cannot claim unknown creation', async () => {
  const p = await prepare(input({ products: [{ sku: 'SYNTHETIC-SKU-1' }] })); state.mode = '503-applied:ads'; const { result } = await run(p);
  state.ads[0].tags = [{ key: 'xander-operation', value: 'someone-else' }];
  const checked = await create.readback(store, p.c, p.newValue, result);
  assert.equal(checked.match, false); assert.equal(checked.status, 'OUTCOME_UNKNOWN');
});

test('missing success ID stays unknown and does not advance to child creation', async () => {
  const p = await prepare(); state.mode = 'no-id:campaigns'; const { result } = await run(p);
  assert.equal(result.status, 'OUTCOME_UNKNOWN'); assert.equal(writes().length, 1);
});

test('requires durable checkpoint and aborts before first write when persistence fails', async () => {
  const p = await prepare(); await assert.rejects(() => create.send(store, p.request), /checkpoint/);
  await assert.rejects(() => create.send(store, p.request, { checkpoint: async () => { throw new Error('Disk full'); } }), /Disk full/);
  assert.equal(writes().length, 0);
});

test('rechecks duplicates immediately before first submission', async () => {
  const p = await prepare(); state.campaigns.push({ campaignId: 'someone-else', adProduct: SP, name: p.c.campaignName, state: 'PAUSED' });
  const { result } = await run(p); assert.equal(result.status, 'FAILED'); assert.equal(writes().length, 0);
});

test('existing parent modes create group or products without recreating parents', async () => {
  seedParents(); const p = await prepare(input({ mode: 'adGroup', campaignId: 'C-existing' })); const first = await run(p);
  assert.equal(first.result.ok, true); assert.equal(writes().filter((c) => c.path.endsWith('/campaigns')).length, 0);
  assert.equal((await create.readback(store, p.c, p.newValue, first.result)).match, true);
  const p2 = await prepare(input({ mode: 'ads', adGroupId: 'G-existing' })); const second = await run(p2);
  assert.equal(second.result.ok, true); assert.equal((await create.readback(store, p2.c, p2.newValue, second.result)).match, true);
});

test('rejects wrong profile country/currency, seller ASIN, mismatched/archived parent', async () => {
  state.country = 'CA'; await assert.rejects(() => prepare(), /国家或币种/); state.country = 'US';
  state.currency = 'CAD'; await assert.rejects(() => prepare(), /国家或币种/); state.currency = 'USD';
  await assert.rejects(() => prepare(input({ products: [{ asin: 'B000000001' }] })), /卖家广告账户/);
  seedParents(); await assert.rejects(() => prepare(input({ mode: 'ads', adGroupId: 'G-existing', campaignId: 'wrong' })), /不属于/);
  state.campaigns[0].state = 'ARCHIVED'; await assert.rejects(() => prepare(input({ mode: 'adGroup', campaignId: 'C-existing' })), /已归档/);
  assert.equal(writes().length, 0);
});

test('Vendor product uses ASIN, automatic campaign uses autoCreateTargets', async () => {
  state.profileType = 'vendor'; const p = await prepare(input({ targetingType: 'AUTO', products: [{ asin: 'B000000001' }] })); const { result } = await run(p);
  assert.equal(result.ok, true); assert.equal(state.campaigns[0].autoCreationSettings.autoCreateTargets, true);
  assert.equal(state.ads[0].creative.productCreative.productCreativeSettings.advertisedProduct.productIdType, 'ASIN');
});

test('creation validates exact values and does not silently round or enable', async () => {
  for (const extra of [{ dailyBudget: 0.001 }, { defaultBid: -1 }, { state: 'ENABLED' }, { targetingType: undefined }, { startDateTime: '2030-11-01' }, { bidStrategy: 'RULE_BASED' }, { placementBidAdjustments: [{ placement: 'TOP_OF_SEARCH', percentage: 901 }] }]) await assert.rejects(() => prepare(input(extra)));
  await assert.rejects(() => prepare(input({ products: [{ sku: 'DUP' }, { sku: 'DUP' }] })), /重复商品/);
  assert.equal(writes().length, 0);
});

test('stable creation identity blocks changed-budget retry and overlapping product lists', () => {
  assert.deepEqual(create.creationIdentity(input()), create.creationIdentity(input({ dailyBudget: 25, campaignName: ' FIXTURE CAMPAIGN ' })));
  assert.deepEqual(create.creationIdentity(input({ mode: 'ads', adGroupId: 'G', products: [{ sku: 'A' }] })), create.creationIdentity(input({ mode: 'ads', adGroupId: 'G', products: [{ sku: 'A' }, { sku: 'B' }] })));
});

test('placement update preserves unmentioned placements/audience/creative adjustments and uses official field path', async () => {
  seedParents(); const c = { campaignId: 'C-existing', bidStrategy: 'MANUAL', placementBidAdjustments: [{ placement: 'TOP_OF_SEARCH', percentage: 20 }] };
  const r = await placement.read(store, c); const { newValue } = placement.check(c, r, { bidChangePctMax: 30 }); const req = placement.build(c, r, newValue);
  assert.deepEqual(req.body.campaigns[0].optimizations.bidSettings.bidAdjustments.audienceBidAdjustments, [{ audienceId: 'audience-fixture', percentage: 20 }]);
  assert.equal(newValue.bidAdjustments.placementBidAdjustments.find((x) => x.placement === 'REST_OF_SEARCH').percentage, 10);
  assert.equal((await placement.send(store, req)).ok, true); assert.equal((await placement.readback(store, c, newValue)).match, true);
  state.campaigns[0].optimizations.bidSettings.bidAdjustments.audienceBidAdjustments[0].percentage = 25;
  assert.equal((await placement.readback(store, c, newValue)).match, false);
});

test('placement bounds and multiplier safety cap apply; explicit zero resets only named placement', async () => {
  seedParents(); const r = await placement.read(store, { campaignId: 'C-existing' });
  assert.throws(() => placement.check({ placementBidAdjustments: [{ placement: 'TOP_OF_SEARCH', percentage: 100 }] }, r, { bidChangePctMax: 30 }), /安全上限/);
  for (const percentage of [-1, 0.5, 901, '10']) assert.throws(() => placement.check({ placementBidAdjustments: [{ placement: 'TOP_OF_SEARCH', percentage }] }, r));
  assert.throws(() => placement.check({ bidStrategy: 'RULE_BASED' }, r), /RULE_BASED/);
  assert.throws(() => placement.check({ placementBidAdjustments: [] }, r), /明确列出/);
  const { newValue } = placement.check({ placementBidAdjustments: [{ placement: 'REST_OF_SEARCH', percentage: 0 }] }, r, { bidChangePctMax: 30 });
  assert.equal(newValue.bidAdjustments.placementBidAdjustments[0].percentage, 0);
  state.campaigns[0].optimizations.bidSettings.bidAdjustments.placementBidAdjustments = [];
  assert.equal((await placement.readback(store, { campaignId: 'C-existing' }, newValue)).match, true);
});

test('real proposal pipeline persists SP checkpoints and verifies complete paused structure', async () => {
  setSwitch(create.id, true);
  const pr = await prepareChange({ store: store.alias, changes: [{ op: create.id, ...input({ campaignName: 'Pipeline complete' }) }] });
  assert.equal(pr.ok, true);
  const result = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(result.status, 'API_STATE_VERIFIED');
  const saved = loadProposal(pr.proposalId);
  assert.equal(saved.items[0].sendResult.steps.length, 4);
  assert.equal(saved.items[0].sendResult.createdIds.adIds.length, 2);
  assert.equal(writes().length, 4);
  await assert.rejects(() => executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true }), /不能再次执行/);
  setSwitch(create.id, false);
});

test('proposal pipeline keeps uncertain product creation blocked across verify and another proposal', async () => {
  seedParents(); setSwitch(create.id, true);
  const changes = [{ op: create.id, ...input({ mode: 'ads', adGroupId: 'G-existing', products: [{ sku: 'SYNTHETIC-UNKNOWN' }] }) }];
  const pr = await prepareChange({ store: store.alias, changes });
  assert.equal(pr.ok, true); state.mode = '503-unapplied:ads';
  const result = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  const saved = loadProposal(pr.proposalId);
  assert.equal(saved.items[0].sendResult.steps[0].stage, 'ad:0');
  assert.equal(saved.items[0].sendResult.createdIds.adGroupId, 'G-existing');
  assert.equal((await verifyChange({ proposalId: pr.proposalId })).status, 'OUTCOME_UNKNOWN');
  assert.equal((await prepareChange({ store: store.alias, changes })).ok, false);
  assert.equal(writes().length, 1); setSwitch(create.id, false);
});

test('unknown full-chain product creation blocks child-only aliases by returned campaign and group IDs', async () => {
  setSwitch(create.id, true);
  const pr = await prepareChange({ store: store.alias, changes: [{ op: create.id, ...input({ campaignName: 'Cross-mode campaign unknown', products: [{ sku: 'CROSS-MODE-SKU' }] }) }] });
  assert.equal(pr.ok, true); state.mode = '503-unapplied:ads';
  const result = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  const ids = loadProposal(pr.proposalId).items[0].sendResult.createdIds;
  for (const change of [
    input({ mode: 'ads', adGroupId: ids.adGroupId, products: [{ sku: 'CROSS-MODE-SKU' }] }),
    input({ mode: 'adGroup', campaignId: ids.campaignId, adGroupName: 'New group while original uncertain', products: [{ sku: 'CROSS-MODE-SKU' }] }),
  ]) {
    const next = await prepareChange({ store: store.alias, changes: [{ op: create.id, ...change }] });
    assert.equal(next.ok, false); assert.match(next.errors[0].error, /仍未核验/);
  }
  assert.equal(writes().length, 3); setSwitch(create.id, false);
});

test('unknown adGroup chain blocks ads alias, while reconciled failure permits only missing products', async () => {
  seedParents(); setSwitch(create.id, true);
  const change = input({ mode: 'adGroup', campaignId: 'C-existing', adGroupName: 'Cross-mode group', products: [{ sku: 'GROUP-MISSING-SKU' }] });
  const pr = await prepareChange({ store: store.alias, changes: [{ op: create.id, ...change }] });
  assert.equal(pr.ok, true); state.mode = '503-unapplied:ads';
  assert.equal((await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true })).status, 'OUTCOME_UNKNOWN');
  const ids = loadProposal(pr.proposalId).items[0].sendResult.createdIds;
  const alias = { op: create.id, ...input({ mode: 'ads', adGroupId: ids.adGroupId, products: [{ sku: 'GROUP-MISSING-SKU' }] }) };
  const blocked = await prepareChange({ store: store.alias, changes: [alias] });
  assert.equal(blocked.ok, false); assert.match(blocked.errors[0].error, /仍未核验/);
  assert.equal(writes().length, 2);

  // A separate workflow has an explicit rejection, so readback can reconcile
  // its successful parent and allow a freshly approved child-only repair.
  state.mode = null;
  const resolved = await prepareChange({ store: store.alias, changes: [{ op: create.id, ...input({ campaignName: 'Cross-mode reconciled', products: [{ sku: 'RETRY-MISSING-SKU' }] }) }] });
  assert.equal(resolved.ok, true); state.mode = 'reject:ads';
  assert.equal((await executeChange({ proposalId: resolved.proposalId, hash: resolved.hash, approved: true })).status, 'PARTIALLY_SUCCEEDED');
  const saved = loadProposal(resolved.proposalId);
  assert.equal(saved.items[0].readback.reconciled, true);
  state.mode = null;
  const repair = await prepareChange({ store: store.alias, changes: [{ op: create.id, ...input({ mode: 'ads', adGroupId: saved.items[0].sendResult.createdIds.adGroupId, products: [{ sku: 'RETRY-MISSING-SKU' }] }) }] });
  assert.equal(repair.ok, true);
  assert.equal((await executeChange({ proposalId: repair.proposalId, hash: repair.hash, approved: true })).status, 'API_STATE_VERIFIED');
  const duplicate = await prepareChange({ store: store.alias, changes: [{ op: create.id, ...input({ mode: 'ads', adGroupId: saved.items[0].sendResult.createdIds.adGroupId, products: [{ sku: 'RETRY-MISSING-SKU' }] }) }] });
  assert.equal(duplicate.ok, false); assert.match(duplicate.errors[0].error, /重复创建/);
  setSwitch(create.id, false);
});


test('unknown create error codes and incomplete success receipts cannot advance the chain', async () => {
  for (const mode of ['unknown-code:campaigns', 'missing-errors:campaigns']) {
    state.campaigns = []; state.adGroups = []; state.ads = []; state.calls = [];
    const p = await prepare(); state.mode = mode;
    const { result } = await run(p);
    assert.equal(result.status, 'OUTCOME_UNKNOWN', mode);
    assert.equal(writes().length, 1, 'Do not create children after an ambiguous parent receipt');
    state.mode = null;
  }
});

test('campaign readback requires the explicit approved auto-manage setting', async () => {
  const p = await prepare(); const { result } = await run(p);
  delete state.campaigns[0].autoCreationSettings.autoManageCampaign;
  assert.equal((await create.readback(store, p.c, p.newValue, result)).match, false);
});


test('HTTP timeout and conflict remain unresolved and retain the duplicate-creation lock', async () => {
  setSwitch(create.id, true);
  for (const code of [408, 409, 499]) {
    state.mode = `http-${code}:campaigns`; state.calls = [];
    const changes = [{ op: create.id, ...input({ campaignName: `HTTP uncertainty ${code}` }) }];
    const p = await prepareChange({ store: store.alias, changes });
    const r = await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true });
    assert.equal(r.status, 'OUTCOME_UNKNOWN', String(code));
    assert.equal((await verifyChange({ proposalId: p.proposalId })).status, 'OUTCOME_UNKNOWN');
    const retry = await prepareChange({ store: store.alias, changes: [{ ...changes[0], dailyBudget: 6 }] });
    assert.equal(retry.ok, false); assert.match(retry.errors[0].error, /仍未核验/);
    assert.equal(writes().length, 1, 'Neither verification nor retry proposal can resend the creation');
  }
});

test('HTTP 429 follows the existing explicit-rate-rejection policy after bounded transport retries', async () => {
  const p = await prepare(); state.mode = 'http-429:campaigns';
  const { result } = await run(p);
  assert.equal(result.status, 'FAILED');
  assert.equal(writes().length, 3, 'Existing HTTP transport retries 429 twice; no child stage is sent');
});
