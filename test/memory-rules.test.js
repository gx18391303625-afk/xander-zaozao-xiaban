// 长期规则、按类型拆开的记忆总览和历史记忆搜索。
import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';

isolate();
const { updateConfig } = await import('../lib/config.js');
const archive = await import('../lib/archive.js');
const journal = await import('../lib/decision-journal.js');
const { buildTools } = await import('../server/tools.js');
const tools = Object.fromEntries(buildTools('test').map((t) => [t.name, t]));
const call = async (name, args) => JSON.parse(await tools[name].handler(args));
test.after(() => { journal.closeDecisionJournal(); archive.closeArchive(); });

updateConfig((c) => { c.stores.main = { region: 'NA', marketplaces: ['US'], defaultMarketplace: 'US' }; });

const add = (kind, text, sku) => archive.addNote('main', { kind, text, sku }).id;
const storeRule = add('rule', '先排除站外促销订单再判断站内表现');
const ruleA = add('rule', 'A 的规则', 'A');
add('rule', 'B 的规则', 'B');
add('todo', '补货下单');
add('note', '普通备注');
for (let i = 1; i <= 12; i++) add('decision', `决策 ${i}`);
const progressIds = [];
for (let i = 1; i <= 40; i++) progressIds.push(add('progress', i === 1 ? `流水 ${i} zebrafish` : `流水 ${i}`));

test('总览按类型拆开，进度只带最近 5 条，并给出总数', () => {
  const o = archive.overview('main');
  assert.equal(o.rules.length, 3);
  assert.equal(o.rules[0].id, storeRule);
  assert.deepEqual(o.rules.map((r) => r.id), [...o.rules.map((r) => r.id)].sort((a, b) => a - b));
  assert.deepEqual(o.openTodos.map((n) => n.text), ['补货下单']);
  assert.deepEqual(o.openNotes.map((n) => n.text), ['普通备注']);
  assert.deepEqual(o.recentProgress.map((n) => n.id), progressIds.slice(-5).reverse());
  assert.equal(o.recentDecisions.length, 10);
  assert.deepEqual(o.memoryCounts, { rules: 3, openTodos: 1, openNotes: 1, decisions: 12, progress: 40 });
});

test('SKU 总览带全店规则和本 SKU 规则，不带别的 SKU', () => {
  const o = archive.overview('main', 'A');
  assert.deepEqual(o.rules.map((r) => r.text), ['先排除站外促销订单再判断站内表现', 'A 的规则']);
});

test('停用规则后不再出现在 rules 和计数里', () => {
  archive.completeNote('main', ruleA);
  const o = archive.overview('main');
  assert.equal(o.rules.length, 2);
  assert.equal(o.memoryCounts.rules, 2);
  assert.ok(!o.rules.some((r) => r.id === ruleA));
});

test('searchNotes：关键词、大小写、类型、已完成、分页', () => {
  const hit = archive.searchNotes('main', { q: 'zebrafish' });
  assert.deepEqual(hit.notes.map((n) => n.id), [progressIds[0]]);
  assert.equal(archive.searchNotes('main', { q: 'ZEBRAFISH' }).notes.length, 1);
  assert.ok(archive.searchNotes('main', { kind: 'rule' }).notes.every((n) => n.kind === 'rule'));
  assert.equal(archive.searchNotes('main', { kind: 'rule' }).notes.length, 3);
  assert.ok(!archive.searchNotes('main', { kind: 'rule', includeDone: false }).notes.some((n) => n.id === ruleA));
  assert.deepEqual(archive.searchNotes('main', { kind: 'rule', sku: 'B' }).notes.map((n) => n.text), ['B 的规则']);

  const seen = [];
  let beforeId;
  let page;
  let pages = 0;
  do {
    page = archive.searchNotes('main', { kind: 'progress', limit: 10, beforeId });
    pages++;
    seen.push(...page.notes.map((n) => n.id));
    beforeId = page.nextBeforeId;
  } while (beforeId && pages < 10);
  assert.equal(seen.length, 40);
  assert.equal(new Set(seen).size, 40);
  assert.deepEqual(seen, [...progressIds].reverse());
  assert.equal(page.nextBeforeId, null);
  assert.equal(archive.searchNotes('main', { kind: 'progress', limit: 10 }).nextBeforeId, progressIds[30]);
});

test('searchNotes：% 按字面匹配', () => {
  const withPct = add('note', '折扣 50% 起');
  add('note', '折扣 5050 起');
  const r = archive.searchNotes('main', { q: '50%' });
  assert.deepEqual(r.notes.map((n) => n.id), [withPct]);
});

test('未知 kind 报错', () => {
  assert.throws(() => archive.addNote('main', { kind: 'bogus', text: 'x' }));
  assert.throws(() => archive.searchNotes('main', { kind: 'bogus' }));
});

test('MCP：概览带 rules 和提示，查询工具和记规则可用', async () => {
  const o = await call('xander_archive_overview', { store: 'main' });
  assert.equal(o.rules.length, 2);
  assert.ok(o.memoryNotes.some((n) => n.includes('xander_archive_notes')));
  assert.ok(o.memoryNotes.some((n) => n.startsWith('先读 rules')));
  const s = await call('xander_archive_notes', { store: 'main', q: 'zebrafish' });
  assert.equal(s.notes.length, 1);
  const w = await tools.xander_archive_note.handler({ store: 'main', action: 'add', kind: 'rule', text: '新规则' });
  assert.ok(w.id > 0);
});
