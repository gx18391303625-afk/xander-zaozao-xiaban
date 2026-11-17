import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { OPS } from '../lib/ops.js';
import { SWITCH_GROUPS } from '../lib/switch-groups.js';

// The prior six-category/31-sub-switch design was rejected. Test the actual
// four-master Client validator, not a React/DOM surrogate or a screenshot mock.
const client = fs.readFileSync(new URL('../dsh/client.js', import.meta.url), 'utf8');
const begin = 'BEGIN MASTER SWITCH MODEL';
const end = 'END MASTER SWITCH MODEL';
const beginAt = client.indexOf(begin);
const endAt = client.indexOf(end);
assert.ok(beginAt >= 0 && endAt > beginAt, 'client must mark its pure master-state validation model');
assert.equal(client.indexOf(begin, beginAt + begin.length), -1);
assert.equal(client.indexOf(end, endAt + end.length), -1);
const model = client.slice(client.indexOf('\n', beginAt) + 1, client.lastIndexOf('\n', endAt));
const normalizeState = vm.runInNewContext(`${model}\n;normalizeState;`, Object.create(null), {
  filename: 'dsh/client.js#master-switch-model', timeout: 1000,
});
const ids = ['ads.manage', 'listing.manage', 'fba.inbound', 'ziniao.control'];
const byId = new Map(OPS.map(operation => [operation.id, operation]));
function fixture() {
  return {
    revision: 'a'.repeat(64), csrfToken: 'SYNTHETIC_UI_TOKEN_NOT_A_CREDENTIAL',
    switches: {
      limits: {}, items: SWITCH_GROUPS.map(scope => ({
        id: scope.id, label: scope.label, description: scope.description,
        implemented: true, partial: false, on: false, enabledOperations: 0,
        totalOperations: scope.memberIds.length,
        operations: scope.memberIds.map(id => ({
          id, label: byId.get(id).label, implemented: true, on: false,
        })),
      })),
    },
  };
}
const normalized = value => JSON.parse(JSON.stringify(normalizeState(value)));
const malformed = (change, error = /invalid-state/) => {
  const value = fixture(); change(value); assert.throws(() => normalizeState(value), error);
};

test('Client accepts only four public master IDs in stable order, with all 31 read-only operations', () => {
  const value = fixture();
  value.switches.items.reverse();
  const result = normalized(value);
  assert.deepEqual(result.switches.items.map(item => item.id), ids);
  assert.deepEqual(result.switches.items.map(item => item.totalOperations), [23, 6, 1, 1]);
  const operations = result.switches.items.flatMap(item => item.operations);
  assert.equal(operations.length, 31);
  assert.equal(new Set(operations.map(item => item.id)).size, 31);
  assert.ok(result.switches.items.every(item => item.on === false && item.partial === false));
  assert.deepEqual(value.switches.items.map(item => item.id), [...ids].reverse(), 'validation must not mutate the Host snapshot');
});

test('a mixed legacy scope stays explicitly null/partial while its exact enabled gate is preserved', () => {
  const value = fixture();
  const scope = value.switches.items[0];
  scope.operations[0].on = true;
  scope.enabledOperations = 1; scope.on = null; scope.partial = true;
  const result = normalized(value).switches.items[0];
  assert.equal(result.on, null);
  assert.equal(result.partial, true);
  assert.equal(result.enabledOperations, 1);
  assert.deepEqual(result.operations.map(operation => operation.on), scope.operations.map(operation => operation.on));
});

test('a complete master requires every operation to be strictly enabled', () => {
  const value = fixture();
  const scope = value.switches.items[0];
  scope.operations.forEach(operation => { operation.on = true; });
  scope.enabledOperations = scope.totalOperations; scope.on = true;
  const result = normalized(value);
  assert.equal(result.switches.items[0].on, true);
  assert.ok(result.switches.items.slice(1).every(item => item.on === false));
});

test('old 31-switch Hosts fail closed and request reload rather than resurrecting sub-switches', () => {
  const value = fixture();
  value.switches.items = OPS.map(operation => ({ id: operation.id, label: operation.label, implemented: true, on: false }));
  assert.throws(() => normalizeState(value), /reload-required/);
});

test('missing, extra, duplicated and foreign master IDs fail closed', () => {
  malformed(value => value.switches.items.pop(), /reload-required/);
  malformed(value => value.switches.items.push(structuredClone(value.switches.items[0])), /reload-required/);
  malformed(value => { value.switches.items[1].id = 'ads.manage'; }, /reload-required/);
  malformed(value => { value.switches.items[0].id = 'ads.sp.target.bid'; }, /reload-required/);
});

test('missing revision, CSRF or item arrays cannot establish writable Client state', () => {
  for (const value of [null, {}, [], { revision: 'x', csrfToken: '', switches: { items: [] } }]) {
    assert.throws(() => normalizeState(value), /invalid-state/);
  }
  malformed(value => { delete value.revision; });
  malformed(value => { delete value.csrfToken; });
  malformed(value => { value.switches.items = {}; });
});

test('master labels, descriptions and implemented flags are validated rather than guessed', () => {
  malformed(value => { value.switches.items[0].label = null; });
  malformed(value => { delete value.switches.items[0].description; });
  malformed(value => { value.switches.items[0].implemented = false; });
});

test('inconsistent operation counts or non-boolean gate values reject the entire snapshot', () => {
  malformed(value => { value.switches.items[0].totalOperations = 0; });
  malformed(value => { value.switches.items[0].totalOperations = 23.5; });
  malformed(value => { value.switches.items[0].operations.pop(); });
  malformed(value => { value.switches.items[0].enabledOperations = 1; });
  malformed(value => { value.switches.items[0].operations[0].on = 1; });
  malformed(value => { value.switches.items[0].operations[0].on = 'true'; });
  malformed(value => { value.switches.items[0].operations[0].implemented = false; });
});

test('duplicate exact operation IDs and absent operation labels cannot validate', () => {
  malformed(value => { value.switches.items[1].operations[0].id = value.switches.items[0].operations[0].id; });
  malformed(value => { value.switches.items[0].operations[0].label = null; });
  malformed(value => { value.switches.items[0].operations[0].id = ''; });
});

test('a partial operation vector cannot masquerade as a fully enabled or fully disabled master', () => {
  for (const on of [true, false]) malformed(value => {
    const scope = value.switches.items[0];
    scope.operations[0].on = true; scope.enabledOperations = 1;
    scope.partial = true; scope.on = on;
  });
  malformed(value => { value.switches.items[0].on = null; });
  malformed(value => { value.switches.items[0].partial = true; });
});

test('both UIs retain one master control per scope, explicit mixed state and scope confirmation', () => {
  const panel = fs.readFileSync(new URL('../panel/index.html', import.meta.url), 'utf8');
  assert.match(client, /role: 'checkbox'/, 'mixed state requires checkbox semantics, not an invalid mixed switch');
  assert.match(client, /item\.partial \? 'mixed' : item\.on/);
  assert.match(client, /'aria-checked': state/);
  assert.match(client, /item\.operations\.map/);
  assert.doesNotMatch(client, /buildSwitchGroups|toggleSwitchGroup|renderSubgroup|renderRow\(operation/);
  assert.match(client, /changeSwitch\(choice\.item, true, choice\.revision\)/);
  assert.match(client, /changeSwitch\(choice\.item, false, choice\.revision\)/);
  assert.match(client, /confirmWarning/);
  assert.match(client, /reload-required/);
  assert.match(client, /request\('switch', \{ body: \{[^}]*permissionModel: 'masters-v1'/, 'the confirmed DSH write must identify the master-permission protocol');
  assert.match(panel, /act\('\/api\/switch', \{[^}]*permissionModel: 'masters-v1'/, 'the confirmed panel write must identify the same protocol');
  assert.match(panel, /expectedRevision/);
  assert.match(panel, /partial/);
  assert.doesNotMatch(panel, /fetch\(['"]\/api\/all|api\(['"]\/all/);
});
