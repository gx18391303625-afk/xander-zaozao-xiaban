import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isolate } from './helpers.js';

// No network, real credentials, real shop or real XANDER_HOME is ever read.
const home = isolate();
assert.ok(path.resolve(home).startsWith(path.join(os.tmpdir(), 'xander-test-')));
const journal = await import('../lib/decision-journal.js');
const { FILES } = await import('../lib/paths.js');
const archive = await import('../lib/archive.js');
const filter = { store: 'synthetic-journal-store', marketplace: 'US' };
const scope = { ...filter, sku: 'TEST-SKU', currency: 'USD', timezone: 'America/Los_Angeles', startDate: '2020-01-01', endDate: '2020-01-02' };
function card(overrides = {}) {
  return {
    scope: { ...scope }, goal: { objective: 'protect_profit', confirmation: 'confirmed' },
    evidence: [], actions: [{ id: 'action-1', object: { type: 'sku', id: scope.sku },
      ownerModule: 'xander-operations', intent: 'investigate', reason: '人工核对缺失证据', gates: [] }],
    ...overrides,
  };
}
function experiment(diagnostic = journal.saveDiagnostic(card()), overrides = {}) {
  return {
    diagnosticId: diagnostic.id, actionId: 'action-1', scope: { ...diagnostic.scope },
    hypothesis: '仅记录假设，不认定效果', primaryVariable: '一个待人工批准的变量',
    baseline: '诊断期描述，尚未独立核验', control: '对照未知，暂不认定因果',
    maxAdditionalSpend: 0, maxLoss: 5, stopConditions: ['损失超过计划上限时人工复核'],
    earliestReviewDate: '2020-01-03', sources: ['synthetic-source'], confounders: [], ...overrides,
  };
}
function review(exp, overrides = {}) {
  return {
    experimentId: exp.id, ...filter, observation: { startDate: '2020-01-03', endDate: '2020-01-04' },
    executionReadback: { summary: '调用方声称平台回读一致；账本未独立核验', sources: ['synthetic-readback'] },
    businessOutcome: { summary: '观察到订单变化，但不知道归因', sources: ['synthetic-report'] },
    confounders: [], ...overrides,
  };
}
function raw() { return new DatabaseSync(FILES.archive()); }
test.after(() => { journal.closeDecisionJournal(); archive.closeArchive(); });

test('read APIs do not create an archive, tables or home folders', () => {
  assert.equal(fs.existsSync(FILES.archive()), false);
  assert.deepEqual(journal.listDiagnostics(filter), []);
  assert.deepEqual(journal.listExperiments(filter), []);
  const absent = '00000000-0000-4000-8000-000000000000';
  assert.equal(journal.getDiagnostic(absent, filter), null);
  assert.equal(journal.getExperiment(absent, filter), null);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('diagnostics are immutable UUID snapshots with locally recomputed decisions', () => {
  const input = card();
  const first = journal.saveDiagnostic(input); const second = journal.saveDiagnostic(input);
  assert.match(first.id, /^[0-9a-f-]{36}$/); assert.notEqual(first.id, second.id);
  assert.equal(first.executionAuthorized, false); assert.equal(first.result.executionAuthorized, false);
  assert.equal(first.result.recommendations.length, 0);
  assert.equal(first.result.deferred[0].status, 'blocked');
  assert.equal(first.status, 'LOCAL_SNAPSHOT'); assert.match(first.statusExplanation, /本地/);
  assert.ok(Number.isFinite(Date.parse(first.createdAt)));
  input.actions[0].reason = 'mutated'; first.input.actions[0].reason = 'also mutated';
  assert.equal(journal.getDiagnostic(first.id, filter).input.actions[0].reason, '人工核对缺失证据');
  assert.deepEqual(journal.getDiagnostic(second.id, filter).input, card());
  assert.equal(journal.getDiagnostic(first.id, { ...filter, store: 'other' }), null);
  assert.equal(journal.getDiagnostic(first.id, { ...filter, marketplace: 'CA' }), null);
  assert.deepEqual(journal.listDiagnostics({ ...filter, sku: 'other' }), []);
  assert.deepEqual(journal.listDiagnostics({ ...filter, limit: 1 }).map((x) => x.id), [second.id]);
});

test('rejects fabricated evaluated results and non-JSON agent fields', () => {
  assert.throws(() => journal.saveDiagnostic({ ...card(), executionAuthorized: true }), /未知字段/);
  assert.throws(() => journal.saveDiagnostic({ ...card(), recommendations: [{ executed: true }] }), /未知字段/);
  assert.throws(() => journal.saveDiagnostic({ ...card(), id: '../oops' }), /未知字段/);
  assert.throws(() => journal.saveDiagnostic({ ...card(), hidden: undefined }), /纯 JSON/);
  assert.throws(() => journal.saveDiagnostic({ ...card(), hidden: Infinity }), /纯 JSON/);
  assert.throws(() => journal.saveDiagnostic({ ...card(), hidden: () => 'bad' }), /纯 JSON/);
  const accessor = card(); Object.defineProperty(accessor, 'trap', { enumerable: true, get() { throw new Error('getter must not run'); } });
  assert.throws(() => journal.saveDiagnostic(accessor), /不安全字段/);
  const circular = card(); circular.loop = circular;
  assert.throws(() => journal.saveDiagnostic(circular), /无循环/);
  const sparse = card(); sparse.evidence = new Array(2);
  assert.throws(() => journal.saveDiagnostic(sparse), /空位/);
  const prototype = JSON.parse('{"__proto__":{"admin":true}}');
  assert.throws(() => journal.saveDiagnostic(prototype), /不安全字段/);
});

test('all public reads require exact scoped filters, safe UUIDs and bounded limits', () => {
  for (const id of ['../../secret', 'x', "' OR 1=1 --", 'P20200101000000abcd']) {
    assert.throws(() => journal.getDiagnostic(id, filter), /格式/);
    assert.throws(() => journal.getExperiment(id, filter), /格式/);
  }
  const saved = journal.saveDiagnostic(card());
  assert.throws(() => journal.getDiagnostic(saved.id), /JSON|对象/);
  assert.throws(() => journal.listDiagnostics({ store: filter.store }), /marketplace/);
  for (const limit of [0, -1, 101, 1.5, '20', null]) assert.throws(() => journal.listExperiments({ ...filter, limit }), /数值/);
  assert.throws(() => journal.listDiagnostics({ ...filter, unknown: true }), /未知字段/);
});

test('experiments bind a saved diagnostic, concrete action and entire scope', () => {
  const saved = journal.saveDiagnostic(card()); const plan = experiment(saved);
  const exp = journal.createExperiment(plan);
  assert.equal(exp.status, 'LOCAL_PLAN'); assert.equal(exp.executionAuthorized, false);
  assert.equal(exp.action.id, 'action-1'); assert.equal(exp.proposalReference, null);
  assert.equal(exp.scope.currency, 'USD'); assert.match(exp.notice, /不会修改提案/);
  assert.deepEqual(journal.getExperiment(exp.id, filter).reviews, []);
  assert.equal(journal.getExperiment(exp.id, { ...filter, marketplace: 'CA' }), null);
  assert.throws(() => journal.createExperiment({ ...plan, diagnosticId: '00000000-0000-4000-8000-000000000000' }), /诊断不存在/);
  assert.throws(() => journal.createExperiment({ ...plan, actionId: 'fabricated' }), /actionId/);
  for (const [key, value] of Object.entries({ store: 'other', marketplace: 'CA', sku: 'other', asin: 'B000000001', currency: 'CAD', timezone: 'UTC', startDate: '2019-12-31', endDate: '2020-01-01' })) {
    assert.throws(() => journal.createExperiment({ ...plan, scope: { ...plan.scope, [key]: value } }), /不匹配/);
  }
  assert.throws(() => journal.createExperiment({ ...plan, action: {} }), /未知字段/);
  assert.throws(() => journal.createExperiment({ ...plan, status: 'EXECUTED' }), /未知字段/);
});

test('experiment actions preserve evaluated blocked/hold/ready states, not raw gate claims', () => {
  const evidence = [{ id: 'fact', source: 'synthetic-source', module: 'xander-operations', kind: 'fact',
    fetchedAt: '2020-01-03T00:00:00Z', coverage: 'complete', pagination: 'complete', attribution: 'mature', scope }];
  const base = card().actions[0];
  const supported = [{ name: 'facts', status: 'satisfied', reason: 'synthetic fact', evidenceIds: ['fact'] }];
  const saved = journal.saveDiagnostic(card({ evidence, actions: [
    { ...base, id: 'blocked', intent: 'reduce_exposure', gates: [{ name: 'economics', status: 'satisfied', reason: 'unsupported caller claim', evidenceIds: [] }] },
    { ...base, id: 'hold', intent: 'hold', gates: supported },
    { ...base, id: 'ready', gates: supported },
  ] }));
  assert.deepEqual(saved.result.evaluatedActions.map(a => a.status), ['blocked', 'hold', 'review_ready']);
  for (const assessed of saved.result.evaluatedActions) {
    const exp = journal.createExperiment(experiment(saved, { actionId: assessed.id }));
    assert.deepEqual(exp.action, assessed);
    assert.deepEqual(exp.rawAction, saved.input.actions.find(a => a.id === assessed.id));
    assert.equal(exp.actionAssessment.source, 'diagnostic_snapshot');
    assert.equal(exp.actionAssessment.diagnosticCreatedAt, saved.createdAt);
    assert.equal(exp.actionAssessment.revalidated, false);
    assert.match(exp.actionAssessment.explanation, /诊断保存时.*未按当前数据复评/);
    assert.equal(exp.status, 'LOCAL_PLAN'); assert.equal(exp.executionAuthorized, false);
    assert.deepEqual(journal.getExperiment(exp.id, filter).action, assessed);
    assert.deepEqual(journal.listExperiments({ ...filter, limit: 1 })[0].action, assessed);
    exp.action.status = 'tampered'; exp.rawAction.reason = 'tampered';
    assert.deepEqual(journal.getExperiment(exp.id, filter).action, assessed);
  }
  const blocked = saved.result.evaluatedActions[0];
  assert.equal(blocked.gates.find(g => g.name === 'economics').status, 'unknown');
});

test('legacy experiment raw gate claims read as unknown without rewriting append-only rows', () => {
  const saved = journal.saveDiagnostic(card());
  const rawAction = { ...saved.input.actions[0], gates: [{ name: 'economics', status: 'satisfied', reason: 'legacy caller claim', evidenceIds: [] }] };
  const legacy = { ...journal.createExperiment(experiment(saved)), id: randomUUID(), action: rawAction };
  delete legacy.rawAction; delete legacy.actionAssessment;
  const encoded = JSON.stringify(legacy); const d = raw();
  try {
    d.prepare('INSERT INTO decision_experiments (id, diagnostic_id, action_id, store, marketplace, sku, asin, created_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(legacy.id, legacy.diagnosticId, legacy.actionId, scope.store, scope.marketplace, scope.sku, null, legacy.createdAt, encoded);
    for (const readback of [journal.getExperiment(legacy.id, filter), journal.listExperiments({ ...filter, limit: 1 })[0]]) {
      assert.equal(readback.id, legacy.id); assert.equal(readback.action.status, 'unknown');
      assert.equal(readback.action.gates[0].status, 'unknown'); assert.equal(readback.action.executionAuthorized, false);
      assert.deepEqual(readback.rawAction, rawAction);
      assert.equal(readback.actionAssessment.source, 'legacy_raw_unassessed');
      assert.equal(readback.actionAssessment.revalidated, false);
      assert.match(readback.actionAssessment.explanation, /缺少已评估动作快照/);
    }
    assert.equal(d.prepare('SELECT snapshot FROM decision_experiments WHERE id=?').get(legacy.id).snapshot, encoded);
  } finally { d.close(); }
});

test('legacy diagnostic without evaluated actions creates explicitly unassessed plans', () => {
  const saved = journal.saveDiagnostic(card()); const legacy = { ...saved, id: randomUUID(), result: { ...saved.result } };
  delete legacy.result.evaluatedActions;
  const d = raw();
  try {
    d.prepare('INSERT INTO decision_diagnostics (id, store, marketplace, sku, asin, created_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(legacy.id, scope.store, scope.marketplace, scope.sku, null, legacy.createdAt, JSON.stringify(legacy));
    const exp = journal.createExperiment(experiment(legacy));
    assert.equal(exp.action.status, 'unknown'); assert.deepEqual(exp.rawAction, legacy.input.actions[0]);
    assert.equal(exp.actionAssessment.source, 'legacy_raw_unassessed');
  } finally { d.close(); }
});

test('every saved diagnostic action identifier remains bindable through the experiment schema', () => {
  const action = { ...card().actions[0], id: 'a'.repeat(4096) };
  const saved = journal.saveDiagnostic(card({ actions: [action] }));
  const exp = journal.createExperiment(experiment(saved, { actionId: action.id }));
  assert.equal(exp.action.id, action.id); assert.equal(exp.rawAction.id, action.id);
});

test('diagnostic scope identifier boundaries remain usable through create/get/list/review', () => {
  const wideScope = { ...scope, store: 's'.repeat(4096), marketplace: 'm'.repeat(4096), sku: 'k'.repeat(4096) };
  const action = { ...card().actions[0], object: { type: 'sku', id: wideScope.sku } };
  const saved = journal.saveDiagnostic(card({ scope: wideScope, actions: [action] }));
  const wideFilter = { store: wideScope.store, marketplace: wideScope.marketplace };
  assert.equal(journal.getDiagnostic(saved.id, wideFilter).id, saved.id);
  assert.equal(journal.listDiagnostics({ ...wideFilter, sku: wideScope.sku })[0].id, saved.id);
  const exp = journal.createExperiment(experiment(saved));
  assert.equal(journal.getExperiment(exp.id, wideFilter).id, exp.id);
  assert.equal(journal.listExperiments({ ...wideFilter, sku: wideScope.sku })[0].id, exp.id);
  assert.equal(journal.recordExperimentReview(review(exp, wideFilter)).experimentId, exp.id);
  for (const key of ['store', 'marketplace', 'sku']) {
    assert.throws(() => journal.listDiagnostics({ ...wideFilter, sku: wideScope.sku, [key]: 'x'.repeat(4097) }), /格式/);
  }
  const schema = journal.DIAGNOSTIC_SCHEMA;
  assert.equal(journal.CREATE_EXPERIMENT_SCHEMA.properties.scope, schema.properties.scope);
  assert.equal(journal.CREATE_EXPERIMENT_SCHEMA.properties.actionId, schema.properties.actions.items.properties.id);
});

test('validates experiment dates, budget bounds, source, stop conditions and timezone', () => {
  const plan = experiment();
  for (const changes of [
    { earliestReviewDate: '2020-02-30' }, { earliestReviewDate: '2020-01-01' },
    { maxAdditionalSpend: -1 }, { maxLoss: '0' }, { maxLoss: Infinity },
    { stopConditions: [] }, { sources: [] }, { control: '' },
    { scope: { ...scope, timezone: 'Not/A_Zone' } }, { scope: { ...scope, startDate: '2020-02-30' } },
    { scope: { ...scope, startDate: '2020-02-01' } },
  ]) assert.throws(() => journal.createExperiment({ ...plan, ...changes }));
});

test('proposal references are explicitly unverified declarations, never execution', () => {
  const id = 'P20200101000000abcd';
  const exp = journal.createExperiment(experiment(undefined, { proposalId: id }));
  assert.equal(exp.proposalId, id); assert.equal(exp.proposalReference.status, 'unverified_reference');
  assert.match(exp.proposalReference.statusExplanation, /未核实存在性、店站、执行状态/);
  assert.equal(exp.executionAuthorized, false);
  assert.deepEqual(fs.readdirSync(path.join(home, 'proposals')), []);
  assert.throws(() => journal.createExperiment(experiment(undefined, { proposalId: '../config' })), /格式/);
});

test('reviews append separately, split platform readback from descriptive business outcomes', () => {
  const exp = journal.createExperiment(experiment()); const input = review(exp);
  const first = journal.recordExperimentReview(input); const second = journal.recordExperimentReview(input);
  assert.notEqual(first.id, second.id); assert.equal(first.causalStatus, 'UNKNOWN');
  assert.equal(first.executionReadback.status, 'REPORTED_UNVERIFIED');
  assert.equal(first.businessOutcome.status, 'DESCRIPTIVE_ONLY'); assert.equal(first.status, 'DESCRIPTIVE_ONLY');
  assert.match(first.causalStatusExplanation, /因果未知/);
  assert.ok(first.limitations.some((x) => x.includes('归因')));
  assert.ok(first.limitations.some((x) => x.includes('对照')));
  assert.ok(first.limitations.some((x) => x.includes('报告覆盖')));
  assert.deepEqual(journal.getExperiment(exp.id, filter).reviews.map((x) => x.id), [first.id, second.id]);
  assert.equal(journal.getExperiment(exp.id, filter).status, 'LOCAL_PLAN');
  assert.throws(() => journal.recordExperimentReview(review(exp, { marketplace: 'CA' })), /不匹配/);
  assert.throws(() => journal.recordExperimentReview(review(exp, { store: 'other' })), /不匹配/);
  assert.throws(() => journal.recordExperimentReview(review(exp, { experimentId: '../../config' })), /格式/);
});

test('caller cannot inject causal verification, execution flags, invalid attribution or expansion approval', () => {
  const exp = journal.createExperiment(experiment());
  for (const changes of [
    { causalStatus: 'VERIFIED' }, { independentlyVerified: true }, { status: 'EXECUTED' },
    { executionReadback: { summary: 'ok', sources: [], verified: true } },
    { businessOutcome: { summary: 'causal', sources: [], causal: true } },
    { attribution: 'mature' }, { attribution: 'automatically_mature', attributionReason: 'agent says so' },
    { decision: 'scale' },
  ]) assert.throws(() => journal.recordExperimentReview(review(exp, changes)));
  const mature = journal.recordExperimentReview(review(exp, {
    attribution: 'mature', attributionReason: '调用方声明报告归因期已过，未独立核验', controlObservation: '对照组也变化',
    businessOutcome: { summary: '销量变动', sources: ['report'], reportingThroughDate: '2020-01-04' },
    confounders: ['同期促销'], decision: 'stop',
  }));
  assert.equal(mature.causalStatus, 'UNKNOWN'); assert.equal(mature.decision, 'stop');
  assert.ok(mature.limitations.some((x) => x.includes('混杂项')));
  assert.equal(journal.getExperiment(exp.id, filter).status, 'LOCAL_PLAN');
});

test('reviews reject impossible/reversed/future dates and preserve early observations as unknown', () => {
  const exp = journal.createExperiment(experiment());
  for (const observation of [
    { startDate: '2020-02-30', endDate: '2020-03-02' }, { startDate: '2020-01-05', endDate: '2020-01-04' },
    { startDate: '2999-01-01', endDate: '2999-01-02' },
  ]) assert.throws(() => journal.recordExperimentReview(review(exp, { observation })));
  assert.throws(() => journal.recordExperimentReview(review(exp, { businessOutcome: { summary: '未来', sources: [], reportingThroughDate: '2999-01-01' } })), /未来/);
  const early = journal.recordExperimentReview(review(exp, { observation: { startDate: '2020-01-01', endDate: '2020-01-02' } }));
  assert.equal(early.status, 'EARLY_OBSERVATION'); assert.equal(early.causalStatus, 'UNKNOWN');
  assert.ok(early.limitations.some((x) => x.includes('观察窗口不足')));
});

test('journal dates reject year zero but accept four-digit ancient dates consistently', () => {
  const ancientScope = { ...scope, startDate: '0999-01-01', endDate: '0999-01-02' };
  const saved = journal.saveDiagnostic(card({ scope: ancientScope }));
  const plan = experiment(saved, { earliestReviewDate: '0999-01-03' });
  const exp = journal.createExperiment(plan);
  assert.equal(exp.scope.startDate, '0999-01-01');
  for (const key of ['startDate', 'endDate']) {
    assert.throws(() => journal.createExperiment({ ...plan, scope: { ...ancientScope, [key]: '0000-01-01' } }), /日期/);
  }
  assert.throws(() => journal.createExperiment({ ...plan, earliestReviewDate: '0000-01-03' }), /日期/);
  const input = review(exp, { observation: { startDate: '0999-01-03', endDate: '0999-01-04' },
    businessOutcome: { summary: 'ancient synthetic outcome', sources: [], reportingThroughDate: '0999-01-04' } });
  assert.equal(journal.recordExperimentReview(input).status, 'DESCRIPTIVE_ONLY');
  for (const key of ['startDate', 'endDate']) {
    assert.throws(() => journal.recordExperimentReview({ ...input, observation: { ...input.observation, [key]: '0000-01-01' } }), /日期/);
  }
  assert.throws(() => journal.recordExperimentReview({ ...input, businessOutcome: { ...input.businessOutcome, reportingThroughDate: '0000-01-04' } }), /日期/);
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['0999-01-04T12:00:00Z'])); }
    static now() { return new RealDate('0999-01-04T12:00:00Z').getTime(); }
  };
  try {
    assert.equal(journal.recordExperimentReview(input).status, 'DESCRIPTIVE_ONLY');
    assert.throws(() => journal.recordExperimentReview({ ...input, observation: { startDate: '0999-01-03', endDate: '0999-01-05' } }), /不能晚于/);
    assert.throws(() => journal.recordExperimentReview({ ...input, businessOutcome: { ...input.businessOutcome, reportingThroughDate: '0999-01-05' } }), /未来/);
  } finally { globalThis.Date = RealDate; }
});

test('review clock uses scoped local day, not UTC, and report coverage is distinct', () => {
  const RealDate = globalThis.Date;
  const inputs = ['Pacific/Kiritimati', 'America/Adak'].map((timezone) => {
    const diagnostic = journal.saveDiagnostic(card({ scope: { ...scope, timezone } }));
    return journal.createExperiment(experiment(diagnostic));
  });
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2020-01-02T10:30:00Z'])); }
    static now() { return new RealDate('2020-01-02T10:30:00Z').getTime(); }
  };
  try {
    const input = { observation: { startDate: '2020-01-03', endDate: '2020-01-03' },
      businessOutcome: { summary: '仅早期报告', sources: [], reportingThroughDate: '2020-01-02' } };
    const east = journal.recordExperimentReview(review(inputs[0], input));
    assert.equal(east.status, 'DESCRIPTIVE_ONLY'); assert.equal(east.causalStatus, 'UNKNOWN');
    assert.ok(east.limitations.some((x) => x.includes('报告覆盖')));
    assert.throws(() => journal.recordExperimentReview(review(inputs[1], input)), /不能晚于/);
  } finally { globalThis.Date = RealDate; }
});

test('SQLite enforces append-only diagnostics, experiments and review rows', () => {
  const diagnostic = journal.saveDiagnostic(card()); const exp = journal.createExperiment(experiment(diagnostic));
  journal.recordExperimentReview(review(exp));
  const d = raw();
  try {
    for (const table of ['decision_diagnostics', 'decision_experiments', 'decision_reviews']) {
      assert.throws(() => d.exec(`DELETE FROM ${table}`), /append-only/);
      assert.throws(() => d.exec(`UPDATE ${table} SET created_at='changed'`), /append-only/);
    }
    assert.equal(d.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  } finally { d.close(); }
});

test('old archive facts survive and VACUUM backup includes the entire journal', () => {
  archive.setFact(filter.store, { sku: scope.sku, field: 'purchase_cost', value: 2, source: 'synthetic-old-archive' });
  const before = archive.history(filter.store, scope.sku);
  const diagnostic = journal.saveDiagnostic(card()); const exp = journal.createExperiment(experiment(diagnostic));
  const rev = journal.recordExperimentReview(review(exp));
  assert.deepEqual(archive.history(filter.store, scope.sku), before);
  const target = path.join(home, 'journal-backup.db'); archive.snapshotTo(target);
  const backup = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(backup.prepare('SELECT value FROM facts WHERE store=?').get(filter.store).value, '2');
    assert.equal(backup.prepare('SELECT id FROM decision_diagnostics WHERE id=?').get(diagnostic.id).id, diagnostic.id);
    assert.equal(backup.prepare('SELECT id FROM decision_experiments WHERE id=?').get(exp.id).id, exp.id);
    assert.equal(backup.prepare('SELECT id FROM decision_reviews WHERE id=?').get(rev.id).id, rev.id);
  } finally { backup.close(); }
});

test('close and XANDER_HOME changes never reuse another home connection', () => {
  const diagnostic = journal.saveDiagnostic(card()); archive.closeArchive();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-test-journal-switch-'));
  process.env.XANDER_HOME = other;
  try {
    assert.deepEqual(journal.listDiagnostics(filter), []); assert.equal(fs.existsSync(FILES.archive()), false);
    const saved = journal.saveDiagnostic(card()); assert.notEqual(saved.id, diagnostic.id);
    assert.equal(journal.getDiagnostic(diagnostic.id, filter), null);
    journal.closeDecisionJournal(); assert.equal(journal.getDiagnostic(saved.id, filter).id, saved.id);
  } finally { journal.closeDecisionJournal(); process.env.XANDER_HOME = home; }
  assert.equal(journal.getDiagnostic(diagnostic.id, filter).id, diagnostic.id);
});

test('read-only polling of a legacy archive does not add tables or change schema', () => {
  journal.closeDecisionJournal(); archive.closeArchive();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-test-journal-legacy-'));
  process.env.XANDER_HOME = other;
  const file = FILES.archive(); const d = new DatabaseSync(file); d.exec('CREATE TABLE legacy (value TEXT); INSERT INTO legacy VALUES (\'keep\')');
  const before = d.prepare('PRAGMA schema_version').get().schema_version;
  try {
    assert.deepEqual(journal.listDiagnostics(filter), []); assert.deepEqual(journal.listExperiments(filter), []);
    assert.equal(d.prepare('PRAGMA schema_version').get().schema_version, before);
    assert.equal(d.prepare('SELECT value FROM legacy').get().value, 'keep');
  } finally { d.close(); journal.closeDecisionJournal(); process.env.XANDER_HOME = home; }
});

function worker(code, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: process.cwd(), env: { ...process.env, XANDER_HOME: home, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', (data) => { stderr += data; });
    child.stdout.resume(); child.once('error', reject);
    child.once('exit', (status) => status === 0 ? resolve() : reject(new Error(`child exit ${status}: ${stderr}`)));
  });
}
test('multiple processes append reviews without lost updates or fabricated aggregate state', async () => {
  const exp = journal.createExperiment(experiment()); const payload = review(exp);
  const url = new URL('../lib/decision-journal.js', import.meta.url).href;
  const code = `import {recordExperimentReview, closeDecisionJournal} from ${JSON.stringify(url)};
    const input=JSON.parse(process.env.JOURNAL_TEST_REVIEW);
    for(let i=0;i<12;i++) recordExperimentReview({...input,note:'worker '+process.pid+' / '+i});
    closeDecisionJournal();`;
  await Promise.all(Array.from({ length: 4 }, () => worker(code, { JOURNAL_TEST_REVIEW: JSON.stringify(payload) })));
  const saved = journal.getExperiment(exp.id, filter, { reviewLimit: 100 });
  assert.equal(saved.reviewCount, 48); assert.equal(saved.reviewsTruncated, false);
  assert.equal(saved.reviews.length, 48); assert.equal(new Set(saved.reviews.map((r) => r.id)).size, 48);
  assert.equal(saved.status, 'LOCAL_PLAN'); assert.ok(saved.reviews.every((r) => r.causalStatus === 'UNKNOWN'));
});

test('simultaneous first writes initialize independent decision tables without lost diagnostics', async () => {
  journal.closeDecisionJournal();
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-test-journal-first-write-'));
  const url = new URL('../lib/decision-journal.js', import.meta.url).href;
  const code = `import {saveDiagnostic, closeDecisionJournal} from ${JSON.stringify(url)};
    const input=JSON.parse(process.env.JOURNAL_TEST_CARD);
    for(let i=0;i<8;i++) saveDiagnostic(input);
    closeDecisionJournal();`;
  await Promise.all(Array.from({ length: 4 }, () => worker(code, { XANDER_HOME: fresh, JOURNAL_TEST_CARD: JSON.stringify(card()) })));
  process.env.XANDER_HOME = fresh;
  try {
    const records = journal.listDiagnostics({ ...filter, limit: 100 });
    assert.equal(records.length, 32); assert.equal(new Set(records.map((r) => r.id)).size, 32);
  } finally { journal.closeDecisionJournal(); process.env.XANDER_HOME = home; }
});

test('WAL initialization retries transient lock errors before any append', () => {
  journal.closeDecisionJournal();
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-test-journal-wal-retry-'));
  process.env.XANDER_HOME = fresh;
  const original = DatabaseSync.prototype.exec; let attempts = 0;
  DatabaseSync.prototype.exec = function (sql, ...args) {
    if (sql === 'PRAGMA journal_mode = WAL;' && ++attempts <= 2) throw Object.assign(new Error('synthetic database is locked'), { errcode: 5 });
    return original.call(this, sql, ...args);
  };
  try {
    const record = journal.saveDiagnostic(card());
    assert.equal(attempts, 3); assert.equal(journal.getDiagnostic(record.id, filter).id, record.id);
  } finally {
    DatabaseSync.prototype.exec = original; journal.closeDecisionJournal(); process.env.XANDER_HOME = home;
  }
});

test('oversized combined snapshots fail before committing any diagnostic row', () => {
  const d = raw(); const count = () => d.prepare('SELECT COUNT(*) AS n FROM decision_diagnostics').get().n;
  const before = count();
  const evidence = Array.from({ length: 130 }, (_, i) => ({
    id: `e-${i}`, source: 's'.repeat(4000), module: 'xander-operations', kind: 'fact',
    fetchedAt: '2020-01-03T00:00:00Z', coverage: 'complete', pagination: 'complete', attribution: 'mature', scope: { ...scope },
  }));
  try {
    assert.throws(() => journal.saveDiagnostic(card({ evidence })), /1 MiB/);
    assert.equal(count(), before);
  } finally { d.close(); }
});

test('experiment reviews are bounded by default and exact append-order pages remain complete', () => {
  const exp = journal.createExperiment(experiment());
  const ids = Array.from({ length: 45 }, (_, i) => journal.recordExperimentReview(review(exp, { note: `page-row-${i}` })).id);
  const first = journal.getExperiment(exp.id, filter);
  assert.equal(first.reviewCount, 45); assert.equal(first.reviewOffset, 0);
  assert.equal(first.reviews.length, 20); assert.equal(first.reviewsTruncated, true); assert.equal(first.nextReviewOffset, 20);
  const second = journal.getExperiment(exp.id, filter, { reviewOffset: first.nextReviewOffset });
  assert.equal(second.reviewOffset, 20); assert.equal(second.nextReviewOffset, 40); assert.equal(second.reviewCount, 45);
  const third = journal.getExperiment(exp.id, filter, { reviewOffset: second.nextReviewOffset });
  assert.equal(third.reviews.length, 5); assert.equal(third.nextReviewOffset, null); assert.equal(third.reviewsTruncated, true);
  assert.deepEqual([...first.reviews, ...second.reviews, ...third.reviews].map((r) => r.id), ids);
  const full = journal.getExperiment(exp.id, filter, { reviewLimit: 100 });
  assert.deepEqual(full.reviews.map((r) => r.id), ids); assert.equal(full.reviewsTruncated, false);
  const tail = journal.getExperiment(exp.id, filter, { reviewOffset: 45 });
  assert.equal(tail.reviewCount, 45); assert.deepEqual(tail.reviews, []); assert.equal(tail.nextReviewOffset, null);
  assert.equal(journal.getExperiment(exp.id, { ...filter, marketplace: 'CA' }, { reviewLimit: 1 }), null);
  const empty = journal.getExperiment(journal.createExperiment(experiment()).id, filter);
  assert.equal(empty.reviewCount, 0); assert.equal(empty.reviewsTruncated, false); assert.equal(empty.nextReviewOffset, null);
});

test('review page inputs require bounded safe integers and never pollute scope filters', () => {
  const exp = journal.createExperiment(experiment());
  for (const reviewLimit of [-1, 0, 101, 1.5, '20', null, Infinity]) assert.throws(() => journal.getExperiment(exp.id, filter, { reviewLimit }));
  for (const reviewOffset of [-1, 0.5, '0', null, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => journal.getExperiment(exp.id, filter, { reviewOffset }));
  for (const options of [null, [], true, { unknown: 1 }]) assert.throws(() => journal.getExperiment(exp.id, filter, options));
  const far = journal.getExperiment(exp.id, filter, { reviewOffset: Number.MAX_SAFE_INTEGER, reviewLimit: 100 });
  assert.equal(far.reviewOffset, Number.MAX_SAFE_INTEGER); assert.deepEqual(far.reviews, []); assert.equal(far.nextReviewOffset, null);
  assert.throws(() => journal.getExperiment(exp.id, { ...filter, reviewLimit: 10 }), /未知字段/);
  assert.throws(() => journal.getDiagnostic(exp.diagnosticId, { ...filter, reviewOffset: 0 }), /未知字段/);
});

test('experiment lists include exact counts and only the latest descriptive review summary', () => {
  const exp = journal.createExperiment(experiment());
  let item = journal.listExperiments({ ...filter, limit: 1 })[0];
  assert.equal(item.id, exp.id); assert.equal(item.reviewCount, 0); assert.equal(item.latestReview, null);
  journal.recordExperimentReview(review(exp, { businessOutcome: { summary: 'old-summary', sources: [] } }));
  const latest = journal.recordExperimentReview(review(exp, {
    businessOutcome: { summary: 'latest-summary', sources: ['private-source-not-in-list'] },
    decision: 'continue_observing', note: 'full-record-note-not-in-list',
  }));
  item = journal.listExperiments({ ...filter, limit: 1 })[0];
  assert.equal(item.reviewCount, 2); assert.equal(item.status, 'LOCAL_PLAN');
  assert.equal(item.latestReview.status, latest.status); assert.equal(item.latestReview.statusExplanation, latest.statusExplanation);
  assert.equal(item.latestReview.createdAt, latest.createdAt); assert.equal(item.latestReview.decision, 'continue_observing');
  assert.match(item.latestReview.decisionExplanation, /未安排自动监控/);
  assert.deepEqual(item.latestReview.businessOutcome, { summary: 'latest-summary' });
  assert.deepEqual(item.latestReview.limitations, latest.limitations);
  assert.equal(Object.hasOwn(item, 'reviews'), false);
  assert.equal(JSON.stringify(item).includes('private-source-not-in-list'), false);
  assert.equal(JSON.stringify(item).includes('full-record-note-not-in-list'), false);
  assert.deepEqual(journal.listExperiments({ ...filter, sku: 'other' }), []);
});

test('exported schemas cannot be modified to bypass runtime input validation', () => {
  for (const schema of [journal.CREATE_EXPERIMENT_SCHEMA, journal.EXPERIMENT_REVIEW_SCHEMA, journal.JOURNAL_FILTER_SCHEMA, journal.JOURNAL_SCOPE_FILTER_SCHEMA, journal.EXPERIMENT_REVIEW_PAGE_SCHEMA]) assert.ok(Object.isFrozen(schema));
  assert.throws(() => { journal.JOURNAL_FILTER_SCHEMA.properties.limit.maximum = 100000; }, TypeError);
  assert.throws(() => journal.listDiagnostics({ ...filter, limit: 100000 }));
});
