// 记忆总览：一次读到事实、决策（含已完成）、最近真正执行过的改动和到期实验，支持用 ASIN 查。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isolate } from './helpers.js';

isolate();
const { updateConfig } = await import('../lib/config.js');
const { p } = await import('../lib/paths.js');
const archive = await import('../lib/archive.js');
const journal = await import('../lib/decision-journal.js');
const { buildTools } = await import('../server/tools.js');
const tools = Object.fromEntries(buildTools('test').map((t) => [t.name, t]));
const call = async (name, args) => JSON.parse(await tools[name].handler(args));
test.after(() => { journal.closeDecisionJournal(); archive.closeArchive(); });

updateConfig((c) => {
  c.stores.main = { region: 'NA', marketplaces: ['US'], defaultMarketplace: 'US' };
  c.stores.other = { region: 'NA', marketplaces: ['US'], defaultMarketplace: 'US' };
});

function writeProposal(id, store, items, extra = {}) {
  fs.mkdirSync(p('proposals'), { recursive: true });
  fs.writeFileSync(p('proposals', `${id}.json`), JSON.stringify({ id, store, status: 'DONE', items, ...extra }));
}

test('总览带上已完成的决策、只含本店已执行的改动，并能用 ASIN 查单品', async () => {
  archive.upsertProduct('main', { sku: 'BOWL-BLUE', asin: 'B0TESTBLUE' });
  archive.setFact('main', { sku: 'BOWL-BLUE', field: 'purchase_cost', value: '11.8', currency: 'CNY', source: '测试' });
  const { id } = archive.addNote('main', { sku: 'BOWL-BLUE', kind: 'decision', text: '降价到 18.99 冲排名，两周后复盘' });
  archive.completeNote('main', id);
  writeProposal('P20261101100000aaaa', 'main', [{ op: 'listing.price', label: '售价', marketplace: 'US', target: { sku: 'BOWL-BLUE' }, old: 19.99, new: 18.99, reason: '冲排名', result: { status: 'API_STATE_VERIFIED' } }], { executedAt: '2026-11-01T10:00:00Z' });
  writeProposal('P20261102100000bbbb', 'main', [{ op: 'ads.sp.target.bid', label: '投放竞价', marketplace: 'US', target: { targetId: '111' }, old: 1, new: 1.2, reason: null, result: { status: 'API_STATE_VERIFIED' } }], { executedAt: '2026-11-02T10:00:00Z' });
  writeProposal('P20261103100000cccc', 'main', [{ op: 'listing.price', label: '售价', target: { sku: 'BOWL-BLUE' }, old: 18.99, new: 9.99 }], { status: 'PROPOSED' });
  writeProposal('P20261104100000dddd', 'other', [{ op: 'listing.price', label: '售价', target: { sku: 'BOWL-BLUE' }, old: 5, new: 6 }], { executedAt: '2026-11-04T10:00:00Z' });

  const r = await call('xander_archive_overview', { store: 'main', asin: 'B0TESTBLUE' });
  assert.equal(r.product.sku, 'BOWL-BLUE', 'ASIN 反查到 SKU');
  assert.equal(r.facts.find((f) => f.field === 'purchase_cost').value, '11.8');
  assert.equal(r.openNotes.length, 0);
  assert.equal(r.recentDecisions[0].text, '降价到 18.99 冲排名，两周后复盘', '已完成的决策仍然可见');
  assert.deepEqual(r.recentChanges.map((x) => x.proposalId), ['P20261102100000bbbb', 'P20261101100000aaaa'], '只含本店、已执行，从新到旧');
  assert.deepEqual(r.recentChanges.map((x) => x.aboutThisProduct), [false, true]);
  assert.equal(r.recentChanges[1].old, '19.99');
  assert.equal(r.recentChanges[1].reason, '冲排名');
});

test('ASIN 未登记或对应多个 SKU 时给出明确提示', async () => {
  const none = await call('xander_archive_overview', { store: 'main', asin: 'B0UNKNOWN0' });
  assert.ok(none.memoryNotes.some((n) => n.includes('还没有登记 ASIN')));
  archive.upsertProduct('main', { sku: 'BOWL-BLUE-FBM', asin: 'B0TESTBLUE' });
  const many = await call('xander_archive_overview', { store: 'main', asin: 'B0TESTBLUE' });
  assert.deepEqual(many.candidates, ['BOWL-BLUE', 'BOWL-BLUE-FBM']);
});

test('到期且没有结论的实验卡会被标出来', async () => {
  const scope = { store: 'main', marketplace: 'US', sku: 'BOWL-BLUE', currency: 'USD', timezone: 'America/Los_Angeles', startDate: '2020-01-01', endDate: '2020-01-02' };
  const diagnostic = journal.saveDiagnostic({ scope, goal: { objective: 'protect_profit', confirmation: 'confirmed' }, evidence: [],
    actions: [{ id: 'action-1', object: { type: 'sku', id: 'BOWL-BLUE' }, ownerModule: 'xander-operations', intent: 'investigate', reason: '核对', gates: [] }] });
  journal.createExperiment({ diagnosticId: diagnostic.id, actionId: 'action-1', scope, hypothesis: '降价提升转化', primaryVariable: '价格',
    baseline: '诊断期', control: '无', maxAdditionalSpend: 0, maxLoss: 5, stopConditions: ['亏损超限'], earliestReviewDate: '2020-01-03', sources: ['s'], confounders: [] });
  const r = await call('xander_archive_overview', { store: 'main', sku: 'BOWL-BLUE' });
  assert.equal(r.experiments.length, 1);
  assert.equal(r.experiments[0].dueForReview, true);
  assert.match(r.reminder, /复盘/);
  const other = await call('xander_archive_overview', { store: 'other' });
  assert.equal(other.experiments.length, 0, '不跨店铺');
});

test('改动日志可以只看一个店铺', async () => {
  const r = await call('xander_change_log', { store: 'other' });
  assert.deepEqual(r.proposals.map((x) => x.id), ['P20261104100000dddd']);
});
