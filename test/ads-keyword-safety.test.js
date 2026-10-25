// Synthetic local HTTP only; isolated files and fake credentials.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';

const home = isolate();
const SP = 'SPONSORED_PRODUCTS';
let mode = 'normal';
let returnedTargets = [];
let recurrence = 'DAILY';
let creationReceipt;
const calls = [];
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const apiPath = new URL(req.url, 'http://localhost').pathname;
  const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (apiPath === '/auth/o2/token') return json(200, { access_token: 'FAKE-TOKEN', expires_in: 3600 });
  const body = raw ? JSON.parse(raw) : null;
  calls.push({ path: apiPath, body });
  if (apiPath === '/adsApi/v1/query/adGroups') return json(200, { adGroups: [{ adGroupId: body.adGroupIdFilter.include[0], campaignId: 'C1', name: 'Synthetic group', state: 'ENABLED', adProduct: SP }] });
  if (apiPath === '/adsApi/v1/query/targets') {
    if (body.targetIdFilter) return json(200, { targets: returnedTargets });
    if (mode === 'second-page') return json(200, body.nextToken ? { targets: [validTarget({ targetDetails: { keywordTarget: { keyword: ' Pagination Keyword ', matchType: 'EXACT' } } })] } : { targets: [], nextToken: 'page2' });
    if (mode === 'loop') return json(200, { targets: [], nextToken: 'page2' });
    if (mode === 'malformed') return json(200, { nextToken: 'page2' });
    return json(200, { targets: [] });
  }
  if (apiPath === '/adsApi/v1/create/targets') {
    if (mode === 'unknown') return json(503, { message: 'Synthetic uncertain result' });
    if (/^http-(408|409|499)$/.test(mode)) return json(Number(mode.slice(5)), { message: 'Synthetic ambiguous write response' });
    if (creationReceipt !== undefined) return json(207, creationReceipt);
    returnedTargets = [{ ...body.targets[0], targetId: 'T1', campaignId: 'C1', ...(mode === 'wrong-bid' ? { bid: { bid: 9.9 } } : {}) }];
    return json(207, { success: [{ index: 0, target: { targetId: 'T1' } }], error: [] });
  }
  if (apiPath === '/adsApi/v1/query/campaigns') return json(200, { campaigns: [{ campaignId: 'C1', name: 'Synthetic campaign', state: 'ENABLED', budgets: [{ budgetType: 'MONETARY', ...(recurrence === undefined ? {} : { recurrenceTimePeriod: recurrence }), budgetValue: { monetaryBudgetValue: { monetaryBudget: { value: 10, currencyCode: 'USD' } } } }] }] });
  return json(400, { message: `Unexpected synthetic route ${apiPath}` });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.XANDER_ADS_HOST = base;
process.env.XANDER_LWA_URL = `${base}/auth/o2/token`;
const { setSecret } = await import('../lib/secrets.js');
const { updateConfig, getStore } = await import('../lib/config.js');
const { opById } = await import('../lib/ops.js');
const { prepareChange, executeChange, verifyChange, loadProposal } = await import('../lib/proposals.js');
const { setSwitch } = await import('../lib/switches.js');
const { canonical, sha256 } = await import('../lib/jsonfile.js');
setSecret('ads:synthetic', { clientId: 'FAKE-CLIENT', clientSecret: 'FAKE-SECRET', refreshToken: 'FAKE-REFRESH' });
updateConfig(c => { c.stores.synthetic = { region: 'NA', defaultMarketplace: 'US', marketplaces: ['US', 'CA'], ads: { profiles: { US: '987', CA: '988' } } }; });
const store = getStore('synthetic');
const positive = opById('ads.sp.keyword.create');
const negative = opById('ads.sp.negativeKeyword.create');
const input = (extra = {}) => ({ op: positive.id, marketplace: 'US', adGroupId: 'G1', keywordText: 'synthetic keyword', matchType: 'EXACT', bid: 0.8, ...extra });
const expected = { keywordText: 'synthetic keyword', matchType: 'EXACT', bid: 0.8 };
function validTarget(extra = {}) {
  return { targetId: 'T1', adGroupId: 'G1', campaignId: 'C1', adProduct: SP, targetType: 'KEYWORD', state: 'ENABLED', negative: false, bid: { bid: 0.8 }, targetDetails: { keywordTarget: { keyword: 'synthetic keyword', matchType: 'EXACT' } }, ...extra };
}
async function readback(op = positive, c = input(), approved = expected) {
  return op.readback(store, c, approved, { createdIds: ['T1'] });
}
test.beforeEach(() => {
  mode = 'normal'; returnedTargets = []; recurrence = 'DAILY'; creationReceipt = undefined; calls.length = 0;
  fs.rmSync(path.join(home, 'proposals'), { recursive: true, force: true });
});
test.after(() => { server.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('keyword readback requires approved bid, state, polarity, identity and parent scope', async () => {
  returnedTargets = [validTarget()];
  assert.equal((await readback()).match, true);
  for (const bad of [
    { bid: { bid: 9.9 } }, { bid: {} }, { state: 'PAUSED' }, { negative: true }, { negative: undefined },
    { targetId: 'T-other' }, { adGroupId: 'G-other' }, { adProduct: 'SPONSORED_BRANDS' }, { targetType: 'PRODUCT' },
    { targetDetails: { keywordTarget: { keyword: 'different', matchType: 'EXACT' } } },
    { targetDetails: { keywordTarget: { keyword: 'synthetic keyword', matchType: 'BROAD' } } },
  ]) {
    returnedTargets = [validTarget(bad)];
    assert.equal((await readback()).match, false, JSON.stringify(bad));
  }
  returnedTargets = [validTarget({ campaignId: 'C-other' })];
  assert.equal((await readback(positive, input({ campaignId: 'C1' }))).match, false);
  returnedTargets = [validTarget({ targetId: 'T-other', bid: { bid: 9.9 } }), validTarget()];
  assert.equal((await readback()).match, true, 'Select the created target by its ID, not response order');
});

test('negative keyword readback checks ad-group and campaign levels separately', async () => {
  const approved = { keywordText: expected.keywordText, matchType: 'EXACT' };
  returnedTargets = [validTarget({ negative: true, bid: undefined })];
  assert.equal((await readback(negative, input({ op: negative.id }), approved)).match, true);
  const c = { op: negative.id, marketplace: 'US', campaignId: 'C1', keywordText: expected.keywordText, matchType: 'EXACT' };
  assert.equal((await readback(negative, c, approved)).match, false, 'Ad-group exclusion must not verify as campaign exclusion');
  returnedTargets = [validTarget({ negative: true, bid: undefined, adGroupId: undefined })];
  assert.equal((await readback(negative, c, approved)).match, true);
  returnedTargets = [validTarget({ negative: true, bid: undefined, adGroupId: undefined, campaignId: 'C-other' })];
  assert.equal((await readback(negative, c, approved)).match, false);
});

test('execution reports MISMATCH when created keyword has a different bid', async () => {
  setSwitch(positive.id, true, 'synthetic-test'); mode = 'wrong-bid';
  const p = await prepareChange({ store: 'synthetic', changes: [input()] });
  assert.equal(p.ok, true);
  const r = await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true });
  assert.equal(r.status, 'MISMATCH');
  assert.equal(calls.filter(x => x.path.includes('/create/')).length, 1);
});

test('duplicate keywords on later pages block creation; incomplete pages fail closed', async () => {
  mode = 'second-page';
  const p = await prepareChange({ store: 'synthetic', changes: [input({ keywordText: 'pagination keyword' })] });
  assert.equal(p.ok, false); assert.match(p.errors[0].error, /已有相同/);
  assert.equal(calls.filter(x => x.path.endsWith('/query/targets')).length, 2);
  for (const broken of ['loop', 'malformed']) {
    mode = broken;
    const r = await prepareChange({ store: 'synthetic', changes: [input()] });
    assert.equal(r.ok, false); assert.match(r.errors[0].error, /完整|循环/);
  }
});

test('uncertain creation cannot be retried by changing bid, case or redundant parent input', async () => {
  setSwitch(positive.id, true, 'synthetic-test'); mode = 'unknown';
  const p = await prepareChange({ store: 'synthetic', changes: [input()] });
  const r = await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true });
  assert.equal(r.status, 'OUTCOME_UNKNOWN');
  for (const change of [input({ bid: 0.9 }), input({ keywordText: ' SYNTHETIC KEYWORD ', matchType: 'exact', campaignId: 'C1', bid: 1.1 })]) {
    const retry = await prepareChange({ store: 'synthetic', changes: [change] });
    assert.equal(retry.ok, false); assert.match(retry.errors[0].error, /仍未核验/);
  }
  for (const change of [input({ adGroupId: 'G2' }), input({ matchType: 'PHRASE' }), input({ keywordText: 'another keyword' }), input({ marketplace: 'CA' }), input({ op: negative.id })]) {
    assert.equal((await prepareChange({ store: 'synthetic', changes: [change] })).ok, true, JSON.stringify(change));
  }
  assert.equal(calls.filter(x => x.path.includes('/create/')).length, 1);
});

test('legacy unresolved request-based keys still block same keyword after upgrade', async () => {
  setSwitch(positive.id, true, 'synthetic-test'); mode = 'unknown';
  const p = await prepareChange({ store: 'synthetic', changes: [input()] });
  await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true });
  const previous = loadProposal(p.proposalId);
  const it = previous.items[0];
  it.creationKey = sha256(canonical({ store: 'synthetic', op: positive.id, marketplace: 'US', identity: it.request }));
  previous.hash = sha256(canonical({ store: previous.store, items: previous.items.map(({ index, op, old, new: nv, request, change, marketplace, target, creationKey, precondition }) => ({ index, op, old, new: nv, request, change, marketplace, target, creationKey, precondition })) })).slice(0, 16);
  fs.writeFileSync(path.join(home, 'proposals', `${p.proposalId}.json`), JSON.stringify(previous));
  const retry = await prepareChange({ store: 'synthetic', changes: [input({ bid: 0.9 })] });
  assert.equal(retry.ok, false); assert.match(retry.errors[0].error, /仍未核验/);
  assert.equal(loadProposal(p.proposalId).hash, previous.hash, 'Do not rewrite legacy approval');
});

test('daily budget edits require confirmed DAILY recurrence for SP and SB', async () => {
  for (const op of ['ads.sp.campaign.budget', 'ads.sb.campaign.budget']) {
    for (const value of [undefined, null, '', 'LIFETIME']) {
      recurrence = value;
      const p = await prepareChange({ store: 'synthetic', changes: [{ op, campaignId: 'C1', value: 12 }] });
      assert.equal(p.ok, false); assert.match(p.errors[0].error, /已确认的日预算/);
    }
    recurrence = 'DAILY';
    assert.equal((await prepareChange({ store: 'synthetic', changes: [{ op, campaignId: 'C1', value: 12 }] })).ok, true);
  }
});

test('rounding cannot create zero or nonfinite keyword bids', async () => {
  for (const bid of [0.001, 0.004, Number.MAX_VALUE]) {
    const p = await prepareChange({ store: 'synthetic', changes: [input({ bid })] });
    assert.equal(p.ok, false); assert.match(p.errors[0].error, /两位小数/);
  }
  const p = await prepareChange({ store: 'synthetic', changes: [input({ bid: 0.01 })] });
  assert.equal(p.ok, true); assert.equal(loadProposal(p.proposalId).items[0].new.bid, 0.01);
});

test('ambiguous keyword receipts stay unknown and cannot authorize another creation', async () => {
  setSwitch(positive.id, true, 'synthetic-test');
  const ambiguous = [
    { success: [{ index: 0, target: {} }], error: [] },
    { success: [], error: [] },
    {},
    { success: [{ index: 1, target: { targetId: 'T1' } }], error: [] },
    { success: [{ index: 0, target: { targetId: true } }], error: [] },
    { success: [{ index: 0, target: { targetId: 'T1' } }, { index: 0, target: { targetId: 'T2' } }], error: [] },
    { success: [], error: [{ index: 0, errors: [{ code: 'INTERNAL_ERROR' }] }] },
    { success: [], error: [{ index: 0, errors: [{ code: 'CONFLICT' }] }] },
    { success: [], error: [{ index: 0, errors: [{ code: 'UNKNOWN_SERVER_FAILURE' }] }] },
    { success: [], error: [{ index: 0, errors: [{ code: '   ' }] }] },
    { success: [], error: [{ index: 0, errors: [{}] }] },
    { success: [], error: [{ index: 1, errors: [{ code: 'INVALID_INPUT' }] }] },
    { success: [{ index: 0, target: {} }], error: [{ index: 0, errors: [{ code: 'INVALID_INPUT' }] }] },
  ];
  for (const [index, receipt] of ambiguous.entries()) {
    creationReceipt = receipt;
    const change = input({ keywordText: `ambiguous keyword ${index}` });
    const p = await prepareChange({ store: 'synthetic', changes: [change] });
    assert.equal(p.ok, true);
    const execution = await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true });
    assert.equal(execution.status, 'OUTCOME_UNKNOWN', JSON.stringify(receipt));
    assert.equal((await verifyChange({ proposalId: p.proposalId })).status, 'OUTCOME_UNKNOWN');
    const retry = await prepareChange({ store: 'synthetic', changes: [{ ...change, bid: 0.9 }] });
    assert.equal(retry.ok, false); assert.match(retry.errors[0].error, /仍未核验/);
  }
  assert.equal(calls.filter(x => x.path.includes('/create/')).length, ambiguous.length, 'Each proposal submits once; verification and retry preparation cannot write');
});

test('only the matching explicit keyword rejection is FAILED and permits a corrected proposal', async () => {
  setSwitch(positive.id, true, 'synthetic-test');
  creationReceipt = { success: [], error: [{ index: 0, errors: [{ code: 'INVALID_INPUT', message: 'Synthetic validation failure' }] }] };
  const p = await prepareChange({ store: 'synthetic', changes: [input()] });
  const execution = await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true });
  assert.equal(execution.status, 'FAILED');
  assert.equal((await prepareChange({ store: 'synthetic', changes: [input({ bid: 0.9 })] })).ok, true);
});

test('monetary input must be a JSON number, never boolean, array, object or numeric text', async () => {
  for (const bid of [true, false, [0.8], [], { value: 0.8 }, '0.8', null]) {
    const p = await prepareChange({ store: 'synthetic', changes: [input({ bid })] });
    assert.equal(p.ok, false, JSON.stringify(bid)); assert.match(p.errors[0].error, /JSON 数字/);
  }
  const budget = opById('ads.sp.campaign.budget');
  assert.throws(() => budget.check({ value: [12] }, { old: 10 }, { budgetChangePctMax: 100 }), /JSON 数字/);
  assert.equal((await prepareChange({ store: 'synthetic', changes: [input({ bid: 0.8 })] })).ok, true);
});


test('legacy missing-ID FAILED receipts remain unresolved without rewriting approval hashes', async () => {
  setSwitch(positive.id, true, 'synthetic-test'); mode = 'unknown';
  const p = await prepareChange({ store: 'synthetic', changes: [input()] });
  await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true });
  const legacy = loadProposal(p.proposalId);
  legacy.status = 'FAILED';
  legacy.items[0].result = { status: 'FAILED', error: '没有返回新对象 ID', createdIds: [] };
  legacy.items[0].sendResult = { ok: false, error: '没有返回新对象 ID', createdIds: [] };
  fs.writeFileSync(path.join(home, 'proposals', `${p.proposalId}.json`), JSON.stringify(legacy));
  const retry = await prepareChange({ store: 'synthetic', changes: [input({ bid: 0.9 })] });
  assert.equal(retry.ok, false); assert.match(retry.errors[0].error, /仍未核验/);
  assert.equal((await verifyChange({ proposalId: p.proposalId })).status, 'OUTCOME_UNKNOWN');
  assert.equal(loadProposal(p.proposalId).hash, legacy.hash);
  assert.equal(calls.filter(x => x.path.includes('/create/')).length, 1);
});

test('profile rebinding cannot authorize stale-account writes or readback', async () => {
  setSwitch(positive.id, true, 'synthetic-test');
  const p = await prepareChange({ store: 'synthetic', changes: [input()] });
  updateConfig(c => { c.stores.synthetic.ads.profiles.US = '999'; });
  const r = await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true });
  assert.equal(r.status, 'SKIPPED_STALE');
  assert.equal(calls.filter(x => x.path.includes('/create/')).length, 0);

  updateConfig(c => { c.stores.synthetic.ads.profiles.US = '987'; }); mode = 'wrong-bid';
  const pending = await prepareChange({ store: 'synthetic', changes: [input()] });
  assert.equal((await executeChange({ proposalId: pending.proposalId, hash: pending.hash, approved: true })).status, 'MISMATCH');
  returnedTargets = [validTarget()];
  updateConfig(c => { c.stores.synthetic.ads.profiles.US = '999'; });
  const reads = calls.length;
  assert.equal((await verifyChange({ proposalId: pending.proposalId })).status, 'MISMATCH');
  assert.equal(calls.length, reads, 'Never query a different profile to verify the approved write');
  assert.match(loadProposal(pending.proposalId).items[0].readback.error, /profile/);
});


test('approval table discloses enabled state and effects for positive and negative keywords', async () => {
  for (const operation of [positive, negative]) {
    const p = await prepareChange({ store: 'synthetic', changes: [input({ op: operation.id })] });
    assert.equal(p.ok, true);
    assert.equal(JSON.parse(p.table[0].新值).state, 'ENABLED');
    assert.match(p.table[0].提醒.join(' '), operation === positive ? /启用.*花费/ : /否定.*启用.*排除/);
    assert.equal(loadProposal(p.proposalId).items[0].request.body.targets[0].state, 'ENABLED');
  }
});


test('keyword HTTP timeout and conflict preserve uncertainty and block another proposal', async () => {
  setSwitch(positive.id, true, 'synthetic-test');
  for (const code of [408, 409, 499]) {
    mode = `http-${code}`;
    const c = input({ keywordText: `http uncertain keyword ${code}` });
    const p = await prepareChange({ store: 'synthetic', changes: [c] });
    assert.equal((await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true })).status, 'OUTCOME_UNKNOWN');
    assert.equal((await verifyChange({ proposalId: p.proposalId })).status, 'OUTCOME_UNKNOWN');
    assert.equal((await prepareChange({ store: 'synthetic', changes: [{ ...c, bid: 0.9 }] })).ok, false);
  }
  assert.equal(calls.filter(x => x.path.includes('/create/')).length, 3);
});


test('legacy stored keyword error codes distinguish rejection from ambiguous creation', async () => {
  setSwitch(positive.id, true, 'synthetic-test'); mode = 'unknown';
  const fixtures = [
    { error: 'INTERNAL_ERROR', createdIds: [], unresolved: true },
    { error: 'UNKNOWN_SERVER_FAILURE', createdIds: [], unresolved: true },
    { error: 'INVALID_INPUT Invalid keyword', createdIds: [], unresolved: false },
    { error: 'INVALID_INPUT Invalid keyword; INTERNAL_ERROR', createdIds: [], unresolved: true },
    { error: 'INVALID_INPUT Invalid keyword', createdIds: ['T1'], unresolved: true },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const c = input({ keywordText: `legacy code ${index}` });
    const p = await prepareChange({ store: 'synthetic', changes: [c] });
    await executeChange({ proposalId: p.proposalId, hash: p.hash, approved: true });
    const legacy = loadProposal(p.proposalId);
    legacy.status = 'FAILED';
    legacy.items[0].result = { status: 'FAILED', error: fixture.error };
    legacy.items[0].sendResult = { ok: false, error: fixture.error, createdIds: fixture.createdIds };
    fs.writeFileSync(path.join(home, 'proposals', `${p.proposalId}.json`), JSON.stringify(legacy));
    const retry = await prepareChange({ store: 'synthetic', changes: [{ ...c, bid: 0.9 }] });
    assert.equal(retry.ok, !fixture.unresolved, fixture.error);
    assert.equal((await verifyChange({ proposalId: p.proposalId })).status, fixture.unresolved ? 'OUTCOME_UNKNOWN' : 'FAILED');
    assert.equal(loadProposal(p.proposalId).hash, legacy.hash);
    assert.deepEqual(loadProposal(p.proposalId).items[0].sendResult.createdIds, fixture.createdIds);
    if (fixture.createdIds.length) {
      returnedTargets = [validTarget({ targetDetails: { keywordTarget: { keyword: c.keywordText, matchType: 'EXACT' } } })];
      assert.equal((await verifyChange({ proposalId: p.proposalId })).status, 'API_STATE_VERIFIED');
    }
  }
  assert.equal(calls.filter(x => x.path.includes('/create/')).length, fixtures.length);
});
