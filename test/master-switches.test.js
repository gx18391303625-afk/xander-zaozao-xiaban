import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// All permission writes below are confined to this owned, disposable test home.
// Import production code only after isolation; no account/config/credential setup.
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xander-master-switches-')));
const home = path.join(temporary, 'data');
const file = path.join(home, 'switches.json');
const savedHome = process.env.XANDER_HOME;
const savedBackend = process.env.XANDER_SECRET_BACKEND;
const savedFetch = globalThis.fetch;
process.env.XANDER_HOME = home;
process.env.XANDER_SECRET_BACKEND = 'file';
globalThis.fetch = async () => { throw new Error('Network is forbidden in isolated permission tests'); };
const { OPS } = await import('../lib/ops.js');
const { PERMISSION_MODEL, SWITCH_GROUPS, switchGroup, operationSwitchGroup } = await import('../lib/switch-groups.js');
const { DEFAULT_LIMITS, isOn, limits, listSwitches, setAll, setSwitch } = await import('../lib/switches.js');
const ids = ['ads.manage', 'listing.manage', 'fba.inbound', 'ziniao.control'];
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const group = id => listSwitches().items.find(item => item.id === id);
const gates = () => Object.fromEntries(OPS.map(operation => [operation.id, isOn(operation.id)]));
function seed(switches, extra = {}) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ switches, limits: {}, history: [], ...extra }));
}
function reset() {
  assert.equal(path.dirname(path.resolve(home)), temporary);
  assert.equal(path.basename(home), 'data');
  fs.rmSync(home, { recursive: true, force: true });
}
beforeEach(reset);
after(() => {
  globalThis.fetch = savedFetch;
  if (savedHome === undefined) delete process.env.XANDER_HOME; else process.env.XANDER_HOME = savedHome;
  if (savedBackend === undefined) delete process.env.XANDER_SECRET_BACKEND; else process.env.XANDER_SECRET_BACKEND = savedBackend;
  assert.equal(path.dirname(temporary), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(temporary), /^xander-master-switches-/);
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('the explicit immutable four-scope catalog assigns all 31 exact operations once', () => {
  assert.equal(PERMISSION_MODEL, 'masters-v1', 'master permission confirmation uses a distinct versioned write protocol');
  assert.deepEqual(SWITCH_GROUPS.map(scope => scope.id), ids);
  assert.deepEqual(SWITCH_GROUPS.map(scope => scope.memberIds.length), [23, 6, 1, 1]);
  const members = SWITCH_GROUPS.flatMap(scope => scope.memberIds);
  assert.equal(members.length, 31);
  assert.equal(new Set(members).size, members.length);
  assert.deepEqual([...members].sort(), OPS.map(operation => operation.id).sort());
  assert.ok(Object.isFrozen(SWITCH_GROUPS));
  for (const scope of SWITCH_GROUPS) {
    assert.ok(Object.isFrozen(scope) && Object.isFrozen(scope.memberIds));
    assert.equal(switchGroup(scope.id), scope);
    for (const id of scope.memberIds) assert.equal(operationSwitchGroup(id), scope);
  }
  assert.equal(operationSwitchGroup('ads.sp.future.write'), null);
  assert.equal(switchGroup('ads.sp.target.bid'), null);
  assert.ok(!OPS.some(operation => operation.id === 'ads.manage' || operation.id === 'listing.manage'),
    'master authorization IDs must not become generic executable proposal operations');
});

test('business boundaries explicitly include account budget and all six listing capabilities', () => {
  assert.ok(switchGroup('ads.manage').memberIds.includes('ads.sp.account.budget'));
  assert.deepEqual([...switchGroup('listing.manage').memberIds].sort(), [
    'listing.attribute', 'listing.images', 'aplus.content', 'listing.price', 'promotions.coupon', 'listing.fbmQuantity',
  ].sort());
  assert.equal(switchGroup('fba.inbound').special, true);
  assert.equal(switchGroup('ziniao.control').special, true);
  assert.match(group('ads.manage').limitation, /账户.*预算/);
  assert.match(group('listing.manage').limitation, /促销.*准备.*交接|准备.*交接.*促销/);
});

test('first read exposes exactly four default-off masters and creates no permission store', () => {
  assert.equal(fs.existsSync(home), false);
  const snapshot = listSwitches();
  assert.deepEqual(snapshot.items.map(item => item.id), ids);
  assert.deepEqual(snapshot.items.map(item => item.totalOperations), [23, 6, 1, 1]);
  assert.deepEqual(snapshot.limits, DEFAULT_LIMITS);
  assert.deepEqual(limits(), DEFAULT_LIMITS);
  for (const item of snapshot.items) {
    assert.equal(item.on, false);
    assert.equal(item.partial, false);
    assert.equal(item.implemented, true);
    assert.equal(item.enabledOperations, 0);
    assert.ok(item.operations.every(operation => operation.on === false && operation.implemented === true));
    assert.equal(isOn(item.id), false);
  }
  assert.ok(Object.values(gates()).every(on => on === false));
  assert.equal(fs.existsSync(home), false, 'reading must not initialize or migrate permissions');
});

test('mixed legacy permissions remain exact and read-only; their master is null, never falsely off', () => {
  const original = {
    'ads.sp.target.bid': { on: true, changedAt: '2026-01-01T00:00:00.000Z', by: 'legacy' },
    'listing.price': { on: true, by: 'legacy' },
    'ziniao.control': { on: true, by: 'legacy' },
  };
  seed(original, { limits: { bidChangePctMax: 23 }, history: [{ id: 'OLD_SYNTHETIC_EVENT' }] });
  const before = fs.readFileSync(file, 'utf8');
  for (let i = 0; i < 3; i++) {
    for (const id of ['ads.manage', 'listing.manage']) {
      assert.equal(group(id).on, null);
      assert.equal(group(id).partial, true);
      assert.equal(group(id).enabledOperations, 1);
      assert.equal(isOn(id), false, 'a partial umbrella is not a complete authorization');
    }
    assert.equal(group('fba.inbound').on, false);
    assert.equal(group('ziniao.control').on, true);
    assert.equal(isOn('ads.sp.target.bid'), true);
    assert.equal(isOn('ads.sp.campaign.budget'), false);
    assert.equal(isOn('listing.price'), true);
    assert.equal(isOn('listing.attribute'), false);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'all reads preserve legacy bits, limits and audit bytes');
});

test('strict true semantics never interpret strings, numbers or a saved umbrella bit as authorization', () => {
  seed({
    'ads.manage': { on: true }, 'listing.manage': { on: true },
    'ads.sp.target.bid': { on: 'true' }, 'ads.sp.campaign.budget': { on: 1 },
    'listing.price': { on: 'false' }, 'ziniao.control': { on: 1 },
  });
  for (const id of ids) assert.equal(group(id).on, false, id);
  assert.ok(Object.values(gates()).every(on => on === false));
  assert.equal(isOn('ads.manage'), false);
  assert.equal(isOn('__proto__'), false);
});

for (const id of ids) {
  test(`master ${id} unifies only its explicit member gates and can fully revoke them`, () => {
    const members = switchGroup(id).memberIds;
    const before = gates();
    setSwitch(id, true, 'isolated-test-user');
    assert.equal(group(id).on, true);
    assert.equal(group(id).partial, false);
    assert.equal(group(id).enabledOperations, members.length);
    assert.equal(isOn(id), true);
    for (const operation of OPS) {
      assert.equal(isOn(operation.id), members.includes(operation.id) ? true : before[operation.id], operation.id);
    }
    const stored = read();
    assert.equal(stored.history.length, 1);
    assert.equal(stored.history[0].id, id);
    assert.equal(stored.history[0].by, 'isolated-test-user');
    assert.deepEqual(stored.history[0].memberIds, [...members]);
    assert.deepEqual(stored.history[0].changes, members.map(member => ({ id: member, before: false, after: true })));
    setSwitch(id, false, 'isolated-test-user');
    assert.equal(group(id).on, false);
    assert.equal(group(id).partial, false);
    assert.ok(Object.values(gates()).every(on => on === false));
    assert.equal(read().history.length, 2);
  });
}

test('a master transition performs one complete atomic replacement and one audit record', () => {
  seed({ 'ads.sp.target.bid': { on: true, changedAt: '2026-01-01T00:00:00Z', by: 'legacy' } }, {
    limits: { budgetChangePctMax: 17 }, history: [{ id: 'OLDER_EVENT' }],
  });
  const before = read();
  const rename = fs.renameSync;
  const replacements = [];
  fs.renameSync = (source, target) => {
    if (target === file) replacements.push(JSON.parse(fs.readFileSync(source, 'utf8')));
    return rename(source, target);
  };
  try { setSwitch('ads.manage', true, 'isolated-atomic-test'); }
  finally { fs.renameSync = rename; }
  assert.equal(replacements.length, 1);
  const saved = replacements[0];
  assert.ok(switchGroup('ads.manage').memberIds.every(id => saved.switches[id].on === true));
  assert.equal(saved.history.length, before.history.length + 1);
  assert.equal(saved.history[0].id, 'OLDER_EVENT');
  assert.equal(saved.history[1].changes.length, 22);
  assert.ok(saved.history[1].changes.every(change => change.before === false && change.after === true));
  assert.deepEqual(saved.switches['ads.sp.target.bid'], before.switches['ads.sp.target.bid'], 'unchanged member metadata is retained');
  assert.deepEqual(saved.limits, { ...DEFAULT_LIMITS, budgetChangePctMax: 17 });
  assert.equal(saved.switches['ads.manage'], undefined, 'an umbrella grant never replaces the exact gate vector');
});

test('failed atomic replacement does not leave partly enabled gates or a success audit', () => {
  seed({ 'ads.sp.target.bid': { on: true, by: 'legacy' } });
  const before = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (target === file) throw Object.assign(new Error('Synthetic atomic replacement denied'), { code: 'EACCES' });
    return rename(source, target);
  };
  try { assert.throws(() => setSwitch('ads.manage', true, 'isolated-failure-test'), /Synthetic atomic replacement denied/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(group('ads.manage').partial, true);
  assert.equal(group('ads.manage').enabledOperations, 1);
});

test('unchanged master settings never create a store or append an audit entry', () => {
  setSwitch('ads.manage', false, 'isolated-noop');
  assert.equal(fs.existsSync(file), false);
  setSwitch('ads.manage', true, 'isolated-noop');
  const before = fs.readFileSync(file, 'utf8');
  setSwitch('ads.manage', true, 'isolated-noop');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('internal legacy exact setters remain exact rather than implicitly expanding to a master', () => {
  setSwitch('ads.sp.target.bid', true, 'isolated-legacy');
  assert.equal(isOn('ads.sp.target.bid'), true);
  assert.equal(isOn('ads.sp.account.budget'), false);
  assert.equal(group('ads.manage').partial, true);
  assert.equal(group('ads.manage').enabledOperations, 1);
  assert.equal(read().history[0].id, 'ads.sp.target.bid');
  setSwitch('listing.price', true, 'isolated-legacy');
  assert.equal(group('listing.manage').enabledOperations, 1);
  assert.equal(isOn('listing.attribute'), false);
});

test('unknown future IDs do not inherit a master grant, even if unknown saved bits are true', () => {
  seed({ 'ads.sp.future.write': { on: true, by: 'unknown-old-version' } });
  assert.equal(isOn('ads.sp.future.write'), false);
  setSwitch('ads.manage', true, 'isolated-user');
  assert.equal(isOn('ads.sp.future.write'), false);
  assert.equal(read().switches['ads.sp.future.write'].on, true, 'unrelated stored data is preserved, not granted');
  assert.ok(!listSwitches().items.flatMap(item => item.operations).some(operation => operation.id === 'ads.sp.future.write'));
  const before = fs.readFileSync(file, 'utf8');
  for (const id of ['ads.sp.future.write', 'ads.future', '__proto__', 'constructor']) {
    assert.throws(() => setSwitch(id, true, 'isolated-user'));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a newly registered operation with no prior bit cannot inherit an existing umbrella authorization', () => {
  setSwitch('ads.manage', true, 'isolated-old-grant');
  const before = fs.readFileSync(file, 'utf8');
  const future = { id: 'ads.sp.future.registered', label: 'Synthetic future action', group: 'Synthetic future', risk: '高' };
  OPS.push(future);
  try {
    assert.equal(isOn(future.id), false);
    assert.equal(operationSwitchGroup(future.id), null);
    assert.equal(group('ads.manage').totalOperations, 23);
    assert.ok(!listSwitches().items.flatMap(item => item.operations).some(operation => operation.id === future.id));
    setSwitch('ads.manage', true, 'isolated-repeat-grant');
    assert.equal(isOn(future.id), false);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    assert.equal(OPS.at(-1), future);
    OPS.pop();
  }
});

test('non-boolean master and legacy writes fail closed without any persistence', () => {
  for (const id of [...ids, 'ads.sp.target.bid']) {
    for (const value of [undefined, null, 0, 1, '', 'false', 'true', [], {}, new Boolean(false)]) {
      assert.throws(() => setSwitch(id, value, 'isolated-invalid-user'), /布尔|boolean/i, `${id}/${String(value)}`);
    }
  }
  assert.equal(fs.existsSync(file), false);
});

test('internal setAll retains its special and handoff exclusions rather than auto-enabling whole groups', () => {
  setAll(true, { by: 'isolated-legacy-bulk' });
  assert.equal(isOn('ads.sp.target.bid'), true);
  assert.equal(isOn('fba.inbound'), false);
  assert.equal(isOn('ziniao.control'), false);
  assert.equal(isOn('promotions.coupon'), false);
  assert.equal(group('listing.manage').on, null);
  assert.equal(group('listing.manage').partial, true);
  setAll(false, { by: 'isolated-legacy-bulk' });
  assert.ok(Object.values(gates()).every(on => on === false));
  assert.ok(listSwitches().items.every(item => item.on === false && item.partial === false));
});
