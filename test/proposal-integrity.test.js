import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';
isolate();
const { OPS } = await import('../lib/ops.js');
const { updateConfig } = await import('../lib/config.js');
const { setSwitch } = await import('../lib/switches.js');
const { prepareChange, executeChange, loadProposal } = await import('../lib/proposals.js');
const { p } = await import('../lib/paths.js');
const { writeJson } = await import('../lib/jsonfile.js');
const op = {
  id: 'test.integrityCreate', label: 'Synthetic integrity create', creates: true,
  creationIdentity: (c) => ({ name: c.name }),
  async read(store, c) { return { old: null, marketplace: String(c.marketplace).toUpperCase(), entity: {} }; },
  check(c) { return { newValue: { name: c.name, amount: 1 }, warnings: [] }; },
  build(c) { return { name: c.name, amount: 1 }; },
  async send() { calls++; return { ok: false, status: 'OUTCOME_UNKNOWN', note: 'Synthetic unknown result' }; },
  async readback() { return { actual: null, match: false, status: 'OUTCOME_UNKNOWN' }; },
};
let calls = 0;
OPS.push(op); setSwitch(op.id, true);
updateConfig((c) => { c.stores.integrity = { region: 'NA', defaultMarketplace: 'US' }; c.settings.dryRun = false; c.settings.approvalMode = 'chat'; });
test.after(() => OPS.splice(OPS.indexOf(op), 1));
const prepare = (name, marketplace = 'US') => prepareChange({ store: 'integrity', changes: [{ op: op.id, name, marketplace }] });
const execute = (pr) => executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });

test('stored request cannot change while keeping approved hash', async () => {
  const pr = await prepare('request-tamper'); const saved = loadProposal(pr.proposalId);
  saved.items[0].request.amount = 500;
  writeJson(p('proposals', `${pr.proposalId}.json`), saved);
  const before = calls;
  await assert.rejects(() => execute(pr), /哈希|内容|完整性/);
  assert.equal(calls, before);
});

test('stored approval values cannot change while keeping approved hash', async () => {
  const pr = await prepare('value-tamper'); const saved = loadProposal(pr.proposalId);
  saved.items[0].new.amount = 500;
  writeJson(p('proposals', `${pr.proposalId}.json`), saved);
  const before = calls;
  await assert.rejects(() => execute(pr), /哈希|内容|完整性/);
  assert.equal(calls, before);
});

test('marketplace letter case cannot bypass unresolved-creation protection', async () => {
  const pr = await prepare('same-profile', 'US'); assert.equal((await execute(pr)).status, 'OUTCOME_UNKNOWN');
  const duplicate = await prepare('same-profile', 'us');
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors[0].error, /未核验|不能换提案/);
});

test('approved hash survives the JSON save/load round trip even with undefined fields', async () => {
  const opU = {
    id: 'test.integrityUndefined', label: 'Synthetic undefined fields',
    async read() { return { old: 0, marketplace: 'US', entity: {} }; },
    // 模拟紫鸟步骤里 url/selector/text 互斥为 undefined 的形状
    check() { return { newValue: { steps: [{ action: 'click', selector: '#a', url: undefined, text: undefined }] }, warnings: [] }; },
    build() { return {}; },
    async send() { return { ok: false, status: 'FAILED', error: 'synthetic' }; },
    async readback() { return { actual: 0, match: false }; },
  };
  OPS.push(opU); setSwitch(opU.id, true);
  try {
    const r = await prepareChange({ store: 'integrity', changes: [{ op: opU.id, marketplace: 'US' }] });
    const loaded = loadProposal(r.proposalId);
    // 回归点：以前这里会抛“提案内容完整性/哈希校验失败”
    const res = await executeChange({ proposalId: r.proposalId, hash: loaded.hash, approved: true });
    assert.equal(res.status, 'FAILED');
  } finally { OPS.splice(OPS.indexOf(opU), 1); }
});
