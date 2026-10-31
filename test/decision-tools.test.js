// 合成接口测试：只使用隔离的临时目录，不访问真实店铺、凭证或 Amazon。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isolate } from './helpers.js';

const home = isolate();
const { saveConfig, loadConfig } = await import('../lib/config.js');
const { buildTools } = await import('../server/tools.js');
const { closeDecisionJournal } = await import('../lib/decision-journal.js');
const { decisionSummary } = await import('../panel/decision-summary.js');
const { closeArchive, setFact, overview } = await import('../lib/archive.js');
after(() => { closeDecisionJournal(); closeArchive(); });
const config = loadConfig();
config.stores.demo = { region: 'NA', marketplaces: ['US'], defaultMarketplace: 'US' };
config.stores.other = { region: 'NA', marketplaces: ['US'], defaultMarketplace: 'US' };
saveConfig(config);
const tools = new Map(buildTools('2.5.0').map(t => [t.name, t]));
const call = async (name, a) => JSON.parse(await tools.get(name).handler(a));
const fixture = () => {
  const scope = { store: 'demo', marketplace: 'US', sku: 'TEST-SKU', asin: 'B000000001', currency: 'USD', timezone: 'America/Los_Angeles', startDate: '2020-01-01', endDate: '2020-01-14' };
  const evidence = { id: 'test-report', module: 'build-amazon-advertising-strategy', source: 'SIMULATED / NOT LIVE：接口测试事实声明，不是真实店铺数据', kind: 'fact', fetchedAt: '2020-01-20T12:00:00Z', coverage: 'complete', pagination: 'complete', attribution: 'mature', scope, productAttribution: 'isolated', metrics: { clicks: 100, orders: 10 } };
  return { scope, goal: { objective: 'scale_validated', confirmation: 'confirmed' }, evidence: [evidence], actions: [{ id: 'test-action', object: { type: 'sku', id: scope.sku }, ownerModule: 'build-amazon-advertising-strategy', intent: 'scale', reason: '仅测试：进入人工复核，不实际加预算', gates: ['economics', 'eligibility', 'inventory_cash', 'demand_window'].map(name => ({ name, status: 'satisfied', reason: '合成测试中的明确来源声明', evidenceIds: ['test-report'] })) }], sampleCheck: { evidenceId: 'test-report', policy: { basis: '测试规则，不是统计充分标准', evidenceIds: ['test-report'], minClicks: 80, minOrders: 5 } } };
};

let diagnostic, experiment;
test('六个本地工具注册、注解与既有写入链互不替代', () => {
  for (const name of ['xander_diagnose_asin', 'xander_save_diagnostic', 'xander_diagnostics', 'xander_experiment_create', 'xander_experiment_review', 'xander_experiments']) {
    assert.ok(tools.has(name), name);
    assert.equal(tools.get(name).inputSchema.type, 'object');
    assert.equal(tools.get(name).inputSchema.additionalProperties, false);
    assert.equal(tools.get(name).annotations.openWorldHint, false);
  }
  assert.equal(tools.get('xander_diagnose_asin').annotations.readOnlyHint, true);
  assert.equal(tools.get('xander_save_diagnostic').annotations.readOnlyHint, false);
  assert.ok(tools.has('xander_prepare_change') && tools.has('xander_execute_change'));
  assert.ok(![...tools.keys()].some(n => /switch_(on|set)|set_switch|toggle/.test(n)));
});

test('只读诊断不建账本、不改配置开关或提案', async () => {
  const before = fs.readFileSync(`${home}/config.json`, 'utf8');
  const result = await call('xander_diagnose_asin', fixture());
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.executionAuthorized, false);
  assert.equal(fs.existsSync(`${home}/archive.db`), false);
  assert.equal(fs.existsSync(`${home}/switches.json`), false);
  assert.deepEqual(fs.readdirSync(`${home}/proposals`), []);
  assert.equal(fs.readFileSync(`${home}/config.json`, 'utf8'), before);
});

test('MCP入口拒绝未配置店铺/站点、未知字段和手造放行结果', async () => {
  for (const edit of [i => { i.scope.store = 'missing'; }, i => { i.scope.marketplace = 'CA'; }, i => { i.executionAuthorized = true; }, i => { i.result = { status: 'review_ready' }; }]) {
    const i = fixture(); edit(i);
    await assert.rejects(() => call('xander_diagnose_asin', i));
    await assert.rejects(() => call('xander_save_diagnostic', i));
  }
});

test('保存/查询诊断、建实验、追加复盘形成完整本地链路', async () => {
  diagnostic = await call('xander_save_diagnostic', fixture());
  assert.equal(diagnostic.result.executionAuthorized, false);
  const found = await call('xander_diagnostics', { action: 'get', store: 'demo', marketplace: 'US', id: diagnostic.id });
  assert.equal(found.record.id, diagnostic.id);
  experiment = await call('xander_experiment_create', {
    diagnosticId: diagnostic.id, actionId: 'test-action', scope: diagnostic.scope,
    hypothesis: '合成测试：记录动作，不实际写入', primaryVariable: '关键词竞价（仅计划）', baseline: '合成基准', control: '无对照，不能声称因果',
    maxAdditionalSpend: 5, maxLoss: 3, stopConditions: ['仅记录停止条件，不执行'], earliestReviewDate: '2020-02-01', sources: ['test-source'], confounders: [],
  });
  assert.equal(experiment.executionAuthorized, false);
  const review = await call('xander_experiment_review', {
    experimentId: experiment.id, store: 'demo', marketplace: 'US', observation: { startDate: '2020-02-01', endDate: '2020-02-02' },
    executionReadback: { summary: '没有提交任何业务改动', sources: [] }, businessOutcome: { summary: '无真实投放，不能得出效果', sources: [], reportingThroughDate: '2020-02-02' }, confounders: [],
  });
  assert.equal(review.causalStatus, 'UNKNOWN');
  assert.equal(review.executionAuthorized, false);
  const result = await call('xander_experiments', { action: 'get', store: 'demo', marketplace: 'US', id: experiment.id });
  assert.equal(result.record.reviews.length, 1);
  assert.equal(result.record.reviews[0].id, review.id);
  assert.equal((await call('xander_diagnostics', { action: 'list', store: 'demo', marketplace: 'US', sku: 'TEST-SKU' })).records.length, 1);
});

test('本地查询不能跨店站、绕过UUID、混用list/get字段', async () => {
  assert.equal((await call('xander_diagnostics', { action: 'get', store: 'other', marketplace: 'US', id: diagnostic.id })).record, null);
  assert.equal((await call('xander_experiments', { action: 'get', store: 'other', marketplace: 'US', id: experiment.id })).record, null);
  for (const a of [
    { action: 'get', store: 'demo', marketplace: 'US', id: '../../config.json' },
    { action: 'get', store: 'demo', marketplace: 'US', id: diagnostic.id, limit: 1 },
    { action: 'list', store: 'demo', marketplace: 'US', id: diagnostic.id },
    { action: 'list', store: 'demo', marketplace: 'US', approved: true },
    { action: 'list', store: 'demo', marketplace: 'US', limit: 1000 },
  ]) await assert.rejects(() => call('xander_diagnostics', a));
});

test('实验复盘查询显式分页，不把一页当完整历史', async () => {
  const first = await call('xander_experiments', { action: 'get', store: 'demo', marketplace: 'US', id: experiment.id, reviewOffset: 0, reviewLimit: 1 });
  assert.equal(first.record.reviewCount, 1);
  assert.equal(first.record.reviews.length, 1);
  assert.equal(first.record.nextReviewOffset, null);
  const afterLast = await call('xander_experiments', { action: 'get', store: 'demo', marketplace: 'US', id: experiment.id, reviewOffset: 1, reviewLimit: 1 });
  assert.deepEqual(afterLast.record.reviews, []);
  assert.equal(afterLast.record.reviewCount, 1);
  assert.match(first.note, /不能把当前页当全部历史/);
  for (const a of [
    { action: 'get', id: experiment.id, reviewLimit: 101 },
    { action: 'get', id: experiment.id, reviewOffset: -1 },
    { action: 'get', id: experiment.id, reviewLimit: true },
    { action: 'list', reviewOffset: 0 },
  ]) await assert.rejects(() => call('xander_experiments', { store: 'demo', marketplace: 'US', ...a }));
  await assert.rejects(() => call('xander_diagnostics', { action: 'get', store: 'demo', marketplace: 'US', id: diagnostic.id, reviewLimit: 1 }));
});

test('经营快照与旧事实共存，面板有只读诊断/计划摘要', () => {
  setFact('demo', { sku: 'TEST-SKU', field: 'purchase_cost', value: '5', source: '测试确认' });
  assert.ok(overview('demo', 'TEST-SKU').facts.length);
  const summary = decisionSummary(config);
  assert.equal(summary.diagnostics[0].id, diagnostic.id);
  assert.equal(summary.diagnostics[0].recommendations.length, 1);
  assert.equal(summary.experiments[0].id, experiment.id);
  assert.equal(summary.experiments[0].reviewCount, 1);
  assert.equal(summary.experiments[0].latestReview.status, 'DESCRIPTIVE_ONLY');
  assert.match(summary.experiments[0].latestReview.businessOutcome.summary, /无真实投放/);
  assert.match(summary.note, /不是当前账户状态/);
  assert.equal(fs.existsSync(`${home}/switches.json`), false);
  assert.deepEqual(fs.readdirSync(`${home}/proposals`), []);
});

test('大结果显式导出完整文件，列表达到上限不冒充全历史', async () => {
  const i = fixture();
  i.evidence = Array.from({ length: 12 }, (_, n) => ({ ...structuredClone(i.evidence[0]), id: n ? `extra-${n}` : 'test-report', source: '合成测试来源'.repeat(600) }));
  const result = await call('xander_diagnose_asin', i);
  assert.ok(result.savedTo.startsWith(`${home}/exports/`));
  assert.ok(result.bytes > 60_000);
  assert.match(result.note, /不能只看摘要下结论/);
  const full = JSON.parse(fs.readFileSync(result.savedTo, 'utf8'));
  assert.equal(full.evidence.length, 12);
  assert.equal(full.executionAuthorized, false);
  assert.equal(fs.statSync(result.savedTo).mode & 0o077, 0);
  const limited = await call('xander_diagnostics', { action: 'list', store: 'demo', marketplace: 'US', limit: 1 });
  assert.equal(limited.complete, false);
  assert.match(limited.note, /不得当成全部历史/);
});

test('面板诊断模板转义所有外部内容，不提供一键执行按钮', () => {
  const html = fs.readFileSync(new URL('../panel/index.html', import.meta.url), 'utf8');
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const fn = html.slice(html.indexOf('function decisionHistoryHtml('), html.indexOf('\nfunction render()'));
  const context = { esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
  vm.createContext(context);
  vm.runInContext(`${fn}; this.format = decisionHistoryHtml;`, context);
  const summary = decisionSummary(config);
  summary.diagnostics[0].recommendations[0].reason = '<img src=x onerror=alert(1)>';
  summary.experiments[0].hypothesis = '<script>evil()</script>';
  const rendered = context.format(summary);
  assert.ok(rendered.includes('&lt;img'));
  assert.ok(rendered.includes('&lt;script&gt;'));
  assert.ok(!rendered.includes('<img') && !rendered.includes('<script>'));
  assert.ok(!rendered.includes('<button'));
  assert.match(rendered, /未安排自动提醒/);
  assert.match(context.format({ error: '<bad>' }), /&lt;bad&gt;/);
});
