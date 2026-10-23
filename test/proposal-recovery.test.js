import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';
isolate();
const { OPS } = await import('../lib/ops.js');
const { updateConfig } = await import('../lib/config.js');
const { setSwitch } = await import('../lib/switches.js');
const { prepareChange, executeChange, verifyChange, loadProposal, panelDecision } = await import('../lib/proposals.js');
const { HttpError } = await import('../lib/http.js');
const { p } = await import('../lib/paths.js');
const { writeJson } = await import('../lib/jsonfile.js');
updateConfig((c) => { c.stores.main = { region: 'NA', defaultMarketplace: 'US' }; });
let calls = 0;
let hook;
const op = {
  id: 'test.create', creates: true, creationIdentity: (c) => ({ name: c.name }), label: 'fixture create',
  async read() { return { old: null, marketplace: 'US', entity: {} }; },
  check(c) { return { newValue: { name: c.name }, warnings: [] }; },
  build(c) { return { name: c.name }; },
  async send(store, req, { checkpoint }) {
    calls++;
    await checkpoint({ status: 'OUTCOME_UNKNOWN', stage: 'CHILD_SENDING', createdIds: { parentId: 'SYNTHETIC_PARENT' } });
    if (hook) await hook();
    throw new HttpError('synthetic timeout', { sent: true, status: 0 });
  },
  async readback(store, c, expected, receipt) {
    assert.equal(receipt.createdIds.parentId, 'SYNTHETIC_PARENT');
    return { actual: null, match: false, note: 'eventual consistency cannot establish rejection' };
  },
};
OPS.push(op);
setSwitch(op.id, true);
test.after(() => OPS.splice(OPS.indexOf(op), 1));
const prepare = (name) => prepareChange({ store: 'main', changes: [{ op: op.id, name }] });
const execute = (pr) => executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });

test('partial IDs survive a timeout; verify never sends; a new proposal cannot duplicate unknown creation', async () => {
  const pr = await prepare('uncertain');
  assert.equal(pr.ok, true);
  const result = await execute(pr);
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(loadProposal(pr.proposalId).items[0].sendResult.createdIds.parentId, 'SYNTHETIC_PARENT');
  const before = calls;
  assert.equal((await verifyChange({ proposalId: pr.proposalId })).status, 'OUTCOME_UNKNOWN');
  assert.equal(calls, before);
  const again = await prepare('uncertain');
  assert.equal(again.ok, false);
  assert.match(again.errors[0].error, /不能换提案重复提交/);
});

test('per-store execution lock stops concurrent sends and duplicate prepared proposals', async () => {
  const a = await prepare('concurrent');
  const b = await prepare('concurrent');
  let resume;
  let entered;
  const enteredPromise = new Promise((r) => { entered = r; });
  hook = async () => { entered(); await new Promise((r) => { resume = r; }); };
  const running = execute(a);
  await enteredPromise;
  await assert.rejects(execute(b), /已有提案/);
  resume();
  await running;
  hook = undefined;
  const before = calls;
  assert.equal((await execute(b)).status, 'FAILED');
  assert.equal(calls, before, 'preprepared duplicate must not send after lock is released');
});

test('process interruption preserves unknown stage and does not continue later items', async () => {
  const pr = await prepare('interrupted');
  const stored = loadProposal(pr.proposalId);
  stored.status = 'EXECUTING';
  stored.items[0].result = { status: 'SUBMITTING' };
  stored.items[0].sendResult = { stage: 'CHILD_SENDING', createdIds: { parentId: 'SYNTHETIC_PARENT' } };
  stored.items.push({ ...structuredClone(stored.items[0]), index: 1, result: undefined, sendResult: undefined });
  writeJson(p('proposals', `${pr.proposalId}.json`), stored);
  const before = calls;
  const result = await verifyChange({ proposalId: pr.proposalId });
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(result.items[1].结果, 'NOT_RUN');
  assert.equal(calls, before);
});

test('dry-run proposals cannot reserve or submit a new resource', async () => {
  updateConfig((c) => { c.settings.dryRun = true; });
  const pr = await prepare('dry');
  const before = calls;
  assert.equal((await execute(pr)).status, 'DRY_RUN');
  assert.equal(calls, before);
  assert.equal((await prepare('dry')).ok, true);
  updateConfig((c) => { c.settings.dryRun = false; });
});

test('panel approval and rejection cannot overwrite a running checkpoint or reopen an interrupted proposal', async () => {
  const pr = await prepare('panel-concurrent');
  panelDecision(pr.proposalId, 'approve');
  let resume;
  let entered;
  const enteredPromise = new Promise((r) => { entered = r; });
  hook = async () => { entered(); await new Promise((r) => { resume = r; }); };
  const running = execute(pr);
  await enteredPromise;
  try {
    const checkpoint = loadProposal(pr.proposalId);
    assert.equal(checkpoint.status, 'EXECUTING');
    assert.equal(checkpoint.items[0].sendResult.stage, 'CHILD_SENDING');
    assert.throws(() => panelDecision(pr.proposalId, 'approve'), /已有提案|执行锁/);
    assert.throws(() => panelDecision(pr.proposalId, 'reject'), /已有提案|执行锁/);
    assert.deepEqual(loadProposal(pr.proposalId), checkpoint, 'neither decision may overwrite persisted execution evidence');
  } finally { resume(); await running; hook = undefined; }
  const unknown = loadProposal(pr.proposalId);
  assert.equal(unknown.status, 'OUTCOME_UNKNOWN');
  assert.throws(() => panelDecision(pr.proposalId, 'approve'), /不能再批准/);
  assert.throws(() => panelDecision(pr.proposalId, 'reject'), /不能再批准/);
  assert.deepEqual(loadProposal(pr.proposalId), unknown);
});
