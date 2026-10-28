import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';

isolate();
const { createFbaInboundOperation } = await import('../lib/ops-fba-inbound.js');
const { OPS } = await import('../lib/ops.js');
const { updateConfig } = await import('../lib/config.js');
const { setSwitch } = await import('../lib/switches.js');
const { prepareChange, executeChange, verifyChange, loadProposal, panelDecision } = await import('../lib/proposals.js');
const { HttpError } = await import('../lib/http.js');
const { p } = await import('../lib/paths.js');
const { writeJson } = await import('../lib/jsonfile.js');

// Synthetic identities and schema-shaped fixtures only. The real transport and
// document downloader are blocked even if a route is accidentally uninjected.
const store = { alias: 'synthetic-fba-flow', sellerId: 'SYNTHETIC-SELLER-A', region: 'NA', defaultMarketplace: 'US', marketplaces: ['US'] };
const ROOT = '/inbound/fba/2024-03-20';
const MARKETPLACE = 'ATVPDKIKX0DER';
const PLAN = 'wf00000000-0000-4000-8000-000000000001';
const OPERATION = '00000000-0000-4000-8000-000000000002';
const PACKING = 'pk00000000-0000-4000-8000-000000000003';
const PACKING_GROUP = 'pg00000000-0000-4000-8000-000000000004';
const clone = (value) => structuredClone(value);
const createBody = () => ({
  name: 'Synthetic inbound plan', destinationMarketplaces: [MARKETPLACE],
  sourceAddress: { name: 'Synthetic sender', companyName: 'Synthetic company', addressLine1: '100 Example Street', city: 'Seattle', stateOrProvinceCode: 'WA', countryCode: 'US', postalCode: '98101', phoneNumber: '2065550100' },
  items: [{ msku: 'SYNTHETIC-SKU-A', quantity: 24, labelOwner: 'SELLER', prepOwner: 'SELLER' }],
});
const createChange = () => ({ op: 'fba.inbound', action: 'createInboundPlan', marketplace: 'US', body: createBody() });

function fixture(t) {
  isolate();
  updateConfig((cfg) => {
    cfg.stores[store.alias] = clone(store);
    cfg.settings.dryRun = false;
    cfg.settings.approvalMode = 'panel';
  });
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Unexpected real network request in synthetic FBA test'); });
  const state = {
    calls: [], plan: null, items: [], mode: null, operationStatus: 'IN_PROGRESS',
    operationName: 'createInboundPlan', operationProblems: [], packingOptions: [], placementOptions: [], boxes: [], beforeWrite: null, beforeRead: null,
    aliases: new Set([store.alias]),
  };
  function seedPlan(body = createBody()) {
    state.plan = {
      inboundPlanId: PLAN, name: body.name, marketplaceIds: clone(body.destinationMarketplaces), sourceAddress: clone(body.sourceAddress), status: 'ACTIVE',
      createdAt: '2030-01-01T00:00:00Z', lastUpdatedAt: '2030-01-01T00:00:00Z', packingOptions: [], placementOptions: [], shipments: [],
    };
    state.items = body.items.map(({ prepOwner, ...item }) => ({ ...clone(item), asin: 'B000000001', fnsku: 'X000000001', prepInstructions: [{ prepOwner: item.labelOwner, prepType: 'ITEM_LABELING' }, { prepOwner, prepType: 'ITEM_NO_PREP' }] }));
  }
  const api = async (alias, method, path, options = {}) => {
    assert.ok(state.aliases.has(alias), 'only explicitly configured synthetic aliases may reach the fixture');
    state.calls.push({ alias, method, path, options: clone(options) });
    if (method === 'GET') {
      assert.notEqual(options.isWrite, true);
      await state.beforeRead?.({ alias, method, path, options });
      if (path === `${ROOT}/inboundPlans`) return { inboundPlans: state.plan ? [clone(state.plan)] : [] };
      if (path === `${ROOT}/operations/${OPERATION}`) return { operationId: OPERATION, operation: state.operationName, operationStatus: state.operationStatus, operationProblems: clone(state.operationProblems) };
      if (path === `${ROOT}/inboundPlans/${PLAN}`) {
        assert.ok(state.plan, 'fixture plan must exist');
        return clone(state.plan);
      }
      if (path === `${ROOT}/inboundPlans/${PLAN}/items`) return { items: clone(state.items) };
      if (path === `${ROOT}/inboundPlans/${PLAN}/packingOptions`) return { packingOptions: clone(state.packingOptions) };
      if (path === `${ROOT}/inboundPlans/${PLAN}/placementOptions`) return { placementOptions: clone(state.placementOptions) };
      if (path === `${ROOT}/inboundPlans/${PLAN}/boxes`) return { boxes: clone(state.boxes) };
    }
    if (method === 'POST' && [
      `${ROOT}/inboundPlans`, `${ROOT}/inboundPlans/${PLAN}/packingOptions`, `${ROOT}/inboundPlans/${PLAN}/placementOptions`,
    ].includes(path)) {
      assert.equal(options.isWrite, true, 'every FBA mutation must disable ambiguous transport retries');
      state.beforeWrite?.();
      if (path === `${ROOT}/inboundPlans`) {
        state.operationName = 'createInboundPlan';
        if (state.mode !== 'timeout-unapplied' && !Number.isInteger(state.mode)) seedPlan(options.body);
      } else {
        state.operationName = path.endsWith('/packingOptions') ? 'generatePackingOptions' : 'generatePlacementOptions';
      }
      if (state.mode === 'timeout-unapplied' || state.mode === 'timeout-applied') throw new HttpError('Synthetic lost response', { status: 0, body: null, method, sent: true });
      if (Number.isInteger(state.mode)) throw new HttpError('Synthetic ambiguous HTTP response', { status: state.mode, body: { errors: [{ code: 'SyntheticAmbiguousError' }] }, method, sent: state.mode >= 500 });
      if (state.mode === 'missing-operation-id') return path === `${ROOT}/inboundPlans` ? { inboundPlanId: PLAN } : {};
      return path === `${ROOT}/inboundPlans` ? { inboundPlanId: PLAN, operationId: OPERATION } : { operationId: OPERATION };
    }
    throw new Error(`Unexpected synthetic FBA route: ${method} ${path}`);
  };
  const op = createFbaInboundOperation({ api, downloadDocument: async () => { assert.fail('FBA flow tests must not download documents'); } });
  const index = OPS.findIndex((candidate) => candidate.id === op.id);
  assert.notEqual(index, -1, 'FBA operation must be registered in the actual proposal registry');
  const original = OPS[index];
  OPS[index] = op;
  t.after(() => { OPS[index] = original; });
  return {
    state, op, seedPlan,
    prepare: (change = createChange()) => prepareChange({ store: store.alias, changes: [clone(change)] }),
    writes: () => state.calls.filter((call) => call.options.isWrite === true),
  };
}

function approvedFields(proposal) {
  return { hash: proposal.hash, hashVersion: proposal.hashVersion, store: proposal.store, items: proposal.items.map((item) => ({
    index: item.index, op: item.op, old: item.old, new: item.new, request: item.request, change: item.change,
    marketplace: item.marketplace, target: item.target, creationKey: item.creationKey, precondition: item.precondition,
  })) };
}
function approve(f, prepared) {
  setSwitch(f.op.id, true, 'synthetic-test');
  const approvedAction = loadProposal(prepared.proposalId).items[0].change.action;
  f.state.beforeWrite = () => {
    const persisted = loadProposal(prepared.proposalId);
    assert.equal(persisted.status, 'EXECUTING');
    assert.equal(persisted.items[0].sendResult.status, 'OUTCOME_UNKNOWN', 'uncertainty must be durable before dispatch');
    assert.equal(persisted.items[0].sendResult.action, approvedAction);
  };
  panelDecision(prepared.proposalId, 'approve');
}
const execute = (prepared, extra = {}) => executeChange({ proposalId: prepared.proposalId, hash: prepared.hash, approved: true, ...extra });
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function rejectedPreparation(run, pattern) {
  let result;
  try { result = await run(); }
  catch (error) { assert.match(error.message, pattern); return; }
  assert.equal(result.ok, false);
  assert.equal(result.proposalId, undefined);
  assert.match(result.errors?.map((item) => item.error).join(' ') || result.message || '', pattern);
}

test('FBA creation requires exact approval, panel approval and its switch before one asynchronous write', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  const approved = approvedFields(loadProposal(prepared.proposalId));
  assert.equal(f.writes().length, 0);
  await assert.rejects(execute(prepared, { approved: false }), /approved=true/);
  await assert.rejects(execute(prepared, { hash: 'synthetic-wrong-hash' }), /哈希不匹配/);
  await assert.rejects(execute(prepared), /面板审批/);
  panelDecision(prepared.proposalId, 'approve');
  await assert.rejects(execute(prepared), /开关还关着/);
  assert.equal(f.writes().length, 0);
  setSwitch(f.op.id, true, 'synthetic-test');

  assert.equal((await execute(prepared)).status, 'SUBMITTED');
  assert.equal(f.writes().length, 1);
  assert.deepEqual(f.writes()[0].options.body, createBody());
  const pending = loadProposal(prepared.proposalId);
  assert.equal(pending.items[0].sendResult.operationId, OPERATION);
  assert.deepEqual(approvedFields(pending), approved);
  await assert.rejects(execute(prepared), /不能再次执行/);
  assert.equal(f.writes().length, 1);

  f.state.operationStatus = 'SUCCESS';
  f.state.calls = [];
  assert.equal((await verifyChange({ proposalId: prepared.proposalId })).status, 'API_STATE_VERIFIED');
  const verified = loadProposal(prepared.proposalId);
  assert.deepEqual(approvedFields(verified), approved);
  assert.equal(verified.items[0].readback.match, true);
  assert.ok(f.state.calls.length > 0);
  assert.ok(f.state.calls.every((call) => call.method === 'GET'));
  assert.equal(f.writes().length, 0);
  await assert.rejects(execute(prepared), /不能再次执行/);
});

test('FBA proposals reject batching with another FBA action or another operation', async (t) => {
  const f = fixture(t);
  assert.equal(f.op.exclusive, true);
  for (const second of [createChange(), { op: 'ads.sp.campaign.name', campaignId: 'SYNTHETIC-CAMPAIGN', value: 'Synthetic name' }]) {
    await rejectedPreparation(() => prepareChange({ store: store.alias, changes: [createChange(), second] }), /单|独|一.*FBA|FBA.*一|exclusive/i);
  }
  assert.equal(f.state.calls.length, 0, 'exclusive batch rejection must happen before unrelated account reads');
  assert.equal(f.writes().length, 0);
});

test('FBA no-body actions reject body instead of silently ignoring approved extra input', async (t) => {
  const f = fixture(t);
  f.seedPlan();
  await rejectedPreparation(() => f.prepare({ op: f.op.id, action: 'generatePackingOptions', marketplace: 'US', inboundPlanId: PLAN, body: {} }), /body|请求体/);
  assert.equal(f.writes().length, 0);
});

test('FBA lost creation response stays unknown even when a same-name plan appears; verify never retries', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  approve(f, prepared);
  const approved = approvedFields(loadProposal(prepared.proposalId));
  f.state.mode = 'timeout-applied';
  assert.equal((await execute(prepared)).status, 'OUTCOME_UNKNOWN');
  assert.equal(f.writes().length, 1);
  assert.ok(f.state.plan, 'the fixture models a write that happened before its response was lost');
  assert.notEqual(loadProposal(prepared.proposalId).items[0].sendResult?.operationId, OPERATION);
  f.state.operationStatus = 'SUCCESS';
  f.state.calls = [];
  assert.equal((await verifyChange({ proposalId: prepared.proposalId })).status, 'OUTCOME_UNKNOWN');
  assert.deepEqual(approvedFields(loadProposal(prepared.proposalId)), approved);
  assert.ok(f.state.calls.every((call) => call.method === 'GET'));
  assert.equal(f.writes().length, 0);
  await assert.rejects(execute(prepared), /不能再次执行/);
});

test('FBA HTTP 408, 409 and 5xx retain unknown outcome and never release the creation lock', async (t) => {
  for (const status of [408, 409, 500, 503]) await t.test(String(status), async (t) => {
    const f = fixture(t);
    const prepared = await f.prepare();
    assert.equal(prepared.ok, true);
    approve(f, prepared);
    f.state.mode = status;
    assert.equal((await execute(prepared)).status, 'OUTCOME_UNKNOWN');
    assert.equal(f.writes().length, 1);
    assert.equal((await verifyChange({ proposalId: prepared.proposalId })).status, 'OUTCOME_UNKNOWN');
    await rejectedPreparation(() => f.prepare(), /仍未核验|未.*核验|未知/);
    assert.equal(f.writes().length, 1);
  });
});

test('FBA unknown creation cannot be bypassed with another name or quantity for the same source and SKU set', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  approve(f, prepared);
  f.state.mode = 'timeout-unapplied';
  assert.equal((await execute(prepared)).status, 'OUTCOME_UNKNOWN');
  for (const mutate of [
    (change) => { change.body.name = 'Renamed synthetic inbound'; },
    (change) => { change.body.items[0].quantity = 48; },
    (change) => { change.body.name = 'Another synthetic name'; change.body.items[0].quantity = 72; },
  ]) {
    const change = createChange(); mutate(change);
    await rejectedPreparation(() => f.prepare(change), /仍未核验|未.*核验|未知/);
  }
  assert.equal(f.writes().length, 1);
});

test('FBA accepted but unfinished creation blocks child actions using its returned plan ID', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  approve(f, prepared);
  assert.equal((await execute(prepared)).status, 'SUBMITTED');
  await rejectedPreparation(() => f.prepare({ op: f.op.id, action: 'generatePackingOptions', marketplace: 'US', inboundPlanId: PLAN }), /仍未核验|未.*核验|未知/);
  assert.equal(f.writes().length, 1);
});

test('FBA operation success alone cannot verify changed created-plan content', async (t) => {
  for (const [label, mutate] of [
    ['quantity', (state) => { state.items[0].quantity += 1; }],
    ['name', (state) => { state.plan.name = 'Other synthetic inbound plan'; }],
    ['source address', (state) => { state.plan.sourceAddress.addressLine1 = '200 Other Example Street'; }],
    ['label owner', (state) => { state.items[0].labelOwner = 'NONE'; }],
    ['prep owner', (state) => { state.items[0].prepInstructions[0].prepOwner = 'AMAZON'; }],
  ]) await t.test(label, async (t) => {
    const f = fixture(t);
    const prepared = await f.prepare();
    assert.equal(prepared.ok, true);
    approve(f, prepared);
    assert.equal((await execute(prepared)).status, 'SUBMITTED');
    const approved = approvedFields(loadProposal(prepared.proposalId));
    f.state.operationStatus = 'SUCCESS';
    mutate(f.state);
    f.state.calls = [];
    assert.notEqual((await verifyChange({ proposalId: prepared.proposalId })).status, 'API_STATE_VERIFIED');
    const saved = loadProposal(prepared.proposalId);
    assert.equal(saved.items[0].readback.match, false);
    assert.deepEqual(approvedFields(saved), approved);
    assert.ok(f.state.calls.every((call) => call.method === 'GET'));
    assert.equal(f.writes().length, 0);
  });
});

test('FBA pending action locks its inbound plan across different actions and keeps verification read-only', async (t) => {
  const f = fixture(t);
  f.seedPlan();
  const prepared = await f.prepare({ op: f.op.id, action: 'generatePackingOptions', marketplace: 'US', inboundPlanId: PLAN });
  assert.equal(prepared.ok, true);
  approve(f, prepared);
  assert.equal((await execute(prepared)).status, 'SUBMITTED');
  assert.equal(f.writes().length, 1);
  // An external actor can advance the plan while our own operation is pending.
  // Make the next action valid on its own so only the durable lock rejects it.
  f.state.packingOptions = [{ packingOptionId: PACKING, status: 'ACCEPTED', packingGroups: [PACKING_GROUP], fees: [], discounts: [], supportedConfigurations: [], supportedShippingConfigurations: [] }];
  f.state.boxes = [{ packageId: 'pa00000000-0000-4000-8000-000000000005', boxId: 'SYNTHETIC-BOX-1', quantity: 1, items: clone(f.state.items), contentInformationSource: 'BOX_CONTENT_PROVIDED', dimensions: { length: 10, width: 10, height: 10, unitOfMeasurement: 'IN' }, weight: { value: 5, unit: 'LB' } }];
  await rejectedPreparation(() => f.prepare({ op: f.op.id, action: 'generatePlacementOptions', marketplace: 'US', inboundPlanId: PLAN, body: {} }), /仍未核验|未.*核验|未知/);
  f.state.calls = [];
  assert.equal((await verifyChange({ proposalId: prepared.proposalId })).status, 'SUBMITTED');
  assert.ok(f.state.calls.length > 0);
  assert.ok(f.state.calls.every((call) => call.method === 'GET'));
});

test('FBA seller rebinding after approval blocks execution before any new-account request', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  approve(f, prepared);
  const approved = approvedFields(loadProposal(prepared.proposalId));
  updateConfig((cfg) => { cfg.stores[store.alias].sellerId = 'SYNTHETIC-SELLER-B'; });
  f.state.calls = [];
  const result = await execute(prepared);
  assert.ok(['SKIPPED_STALE', 'FAILED'].includes(result.status));
  assert.deepEqual(approvedFields(loadProposal(prepared.proposalId)), approved);
  assert.equal(f.state.calls.length, 0);
});

test('FBA seller rebinding after submission blocks verification against a different account', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  approve(f, prepared);
  assert.equal((await execute(prepared)).status, 'SUBMITTED');
  const approved = approvedFields(loadProposal(prepared.proposalId));
  updateConfig((cfg) => { cfg.stores[store.alias].sellerId = 'SYNTHETIC-SELLER-B'; });
  f.state.operationStatus = 'SUCCESS';
  f.state.calls = [];
  const result = await verifyChange({ proposalId: prepared.proposalId });
  assert.notEqual(result.status, 'API_STATE_VERIFIED');
  const saved = loadProposal(prepared.proposalId);
  assert.match(saved.items[0].readback.error, /账户|绑定|seller|店铺/i);
  assert.deepEqual(approvedFields(saved), approved);
  assert.equal(f.state.calls.length, 0);
});

test('FBA approved request tampering fails integrity checking before network or write', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  approve(f, prepared);
  const saved = loadProposal(prepared.proposalId);
  saved.items[0].request.body.items[0].quantity = 99;
  writeJson(p('proposals', `${saved.id}.json`), saved);
  f.state.calls = [];
  await assert.rejects(execute(prepared), /完整性\/哈希校验失败/);
  assert.equal(f.state.calls.length, 0);
});

test('FBA incomplete creation receipt durably retains a valid plan ID and blocks its child actions', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  approve(f, prepared);
  const approved = approvedFields(loadProposal(prepared.proposalId));
  const checkpoints = [], send = f.op.send;
  t.mock.method(f.op, 'send', async (account, request, context) => send(account, request, {
    ...context,
    checkpoint: async (progress) => { await context.checkpoint(progress); checkpoints.push(clone(progress)); },
  }));
  f.state.mode = 'missing-operation-id';
  assert.equal((await execute(prepared)).status, 'OUTCOME_UNKNOWN');
  const saved = loadProposal(prepared.proposalId);
  assert.equal(saved.items[0].sendResult.inboundPlanId, PLAN);
  assert.equal(saved.items[0].sendResult.operationId, undefined);
  assert.ok(checkpoints.some((progress) => progress.status === 'OUTCOME_UNKNOWN' && progress.inboundPlanId === PLAN), 'valid returned plan IDs must be checkpointed even when operationId is absent');
  assert.deepEqual(approvedFields(saved), approved);
  await rejectedPreparation(() => f.prepare({ op: f.op.id, action: 'generatePackingOptions', marketplace: 'US', inboundPlanId: PLAN }), /仍未核验|未.*核验|未知/);
  assert.equal((await verifyChange({ proposalId: prepared.proposalId })).status, 'OUTCOME_UNKNOWN');
  assert.equal(loadProposal(prepared.proposalId).items[0].sendResult.inboundPlanId, PLAN);
  assert.equal(f.writes().length, 1);
});

test('FBA seller rebinding while execution preflight awaits its response prevents dispatch', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  approve(f, prepared);
  const approved = approvedFields(loadProposal(prepared.proposalId));
  const entered = deferred(), release = deferred();
  let writeBoundaryCalls = 0;
  f.state.beforeWrite = () => { writeBoundaryCalls++; };
  f.state.beforeRead = async ({ path }) => {
    if (path === `${ROOT}/inboundPlans`) { entered.resolve(); await release.promise; }
  };
  const pending = execute(prepared);
  let result;
  try {
    await Promise.race([entered.promise, pending.then(() => assert.fail('execution ended before reaching the preflight barrier'))]);
    updateConfig((cfg) => { cfg.stores[store.alias].sellerId = 'SYNTHETIC-SELLER-B'; });
  } finally { release.resolve(); result = await pending; }
  assert.equal(result.status, 'SKIPPED_STALE');
  assert.equal(writeBoundaryCalls, 0, 'the API mutation callback must never be entered after rebinding');
  assert.equal(f.writes().length, 0);
  assert.deepEqual(approvedFields(loadProposal(prepared.proposalId)), approved);
});

test('FBA execute and verify hold a shared seller lock across aliases even for different creation targets', async (t) => {
  const f = fixture(t), secondAlias = 'synthetic-fba-same-seller-alias';
  f.state.aliases.add(secondAlias);
  updateConfig((cfg) => { cfg.stores[secondAlias] = { ...clone(store), alias: secondAlias }; });
  const first = await f.prepare();
  const secondChange = createChange();
  secondChange.body.name = 'Second synthetic inbound plan';
  secondChange.body.items[0].msku = 'SYNTHETIC-SKU-B';
  const second = await prepareChange({ store: secondAlias, changes: [secondChange] });
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  approve(f, first); approve(f, second); f.state.beforeWrite = null;
  const secondApproved = approvedFields(loadProposal(second.proposalId));
  const entered = deferred(), release = deferred();
  f.state.beforeRead = async ({ alias, path }) => {
    if (alias === store.alias && path === `${ROOT}/inboundPlans`) { entered.resolve(); await release.promise; }
  };
  const running = execute(first);
  let firstResult;
  try {
    await Promise.race([entered.promise, running.then(() => assert.fail('execution ended before reaching the alias-lock barrier'))]);
    const count = f.state.calls.length;
    await assert.rejects(execute(second), /执行|核验|锁/);
    await assert.rejects(verifyChange({ proposalId: second.proposalId }), /执行|核验|锁/);
    assert.equal(f.state.calls.length, count, 'a blocked alias must not enter preflight or the API');
    assert.equal(loadProposal(second.proposalId).status, 'PROPOSED');
    assert.equal(f.writes().length, 0);
  } finally { release.resolve(); firstResult = await running; }
  assert.equal(firstResult.status, 'SUBMITTED');
  assert.equal(f.writes().length, 1);

  const verificationEntered = deferred(), verificationRelease = deferred();
  f.state.beforeRead = async ({ alias, path }) => {
    if (alias === store.alias && path === `${ROOT}/operations/${OPERATION}`) { verificationEntered.resolve(); await verificationRelease.promise; }
  };
  const verifying = verifyChange({ proposalId: first.proposalId });
  let verificationResult;
  try {
    await Promise.race([verificationEntered.promise, verifying.then(() => assert.fail('verification ended before reaching the alias-lock barrier'))]);
    const count = f.state.calls.length;
    await assert.rejects(execute(second), /执行|核验|锁/);
    assert.equal(f.state.calls.length, count);
    assert.equal(f.writes().length, 1);
  } finally { verificationRelease.resolve(); verificationResult = await verifying; }
  assert.equal(verificationResult.status, 'SUBMITTED');
  f.state.beforeRead = null;
  assert.equal((await verifyChange({ proposalId: second.proposalId })).status, 'PROPOSED', 'both alias and account locks must be released after a blocked contender');
  assert.deepEqual(approvedFields(loadProposal(second.proposalId)), secondApproved);
  assert.equal(f.writes().length, 1);
});


test('FBA label responsibility stays separate from other preparation responsibility', async (t) => {
  for (const [name, instructions, matches] of [
    ['seller labels with no preparation', [{ prepType: 'ITEM_LABELING', prepOwner: 'SELLER' }, { prepType: 'ITEM_NO_PREP', prepOwner: 'NONE' }], true],
    ['incorrect Amazon label responsibility', [{ prepType: 'ITEM_LABELING', prepOwner: 'AMAZON' }, { prepType: 'ITEM_NO_PREP', prepOwner: 'NONE' }], false],
    ['incorrect no-label responsibility', [{ prepType: 'ITEM_LABELING', prepOwner: 'NONE' }, { prepType: 'ITEM_NO_PREP', prepOwner: 'NONE' }], false],
    ['seller preparation must not substitute for none', [{ prepType: 'ITEM_LABELING', prepOwner: 'SELLER' }, { prepType: 'ITEM_POLYBAGGING', prepOwner: 'SELLER' }], false],
  ]) await t.test(name, async (t) => {
    const f = fixture(t), change = createChange();
    change.body.items[0].prepOwner = 'NONE';
    const prepared = await f.prepare(change); assert.equal(prepared.ok, true);
    approve(f, prepared); assert.equal((await execute(prepared)).status, 'SUBMITTED');
    f.state.items[0].prepInstructions = clone(instructions); f.state.operationStatus = 'SUCCESS';
    const result = await verifyChange({ proposalId: prepared.proposalId });
    assert.equal(result.status, matches ? 'API_STATE_VERIFIED' : 'AWAITING_READBACK');
    assert.equal(f.writes().length, 1);
  });
});
