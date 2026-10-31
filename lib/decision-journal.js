// 本地行动卡/实验账本。只追加记录，不执行、不授权、不监控，也不修改提案。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { FILES, ensureHome } from './paths.js';
import { evaluateDiagnostic, DIAGNOSTIC_SCHEMA } from './diagnostics.js';

export { DIAGNOSTIC_SCHEMA };
const text = { type: 'string', minLength: 1, maxLength: 10000 };
const date = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
const texts = { type: 'array', items: text, maxItems: 100 };
const sources = { ...texts, minItems: 1 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
// Share identifier/scope contracts with diagnostics so every accepted snapshot remains queryable and bindable.
const scopeSchema = DIAGNOSTIC_SCHEMA.properties.scope;
const scopeProperties = scopeSchema.properties;
export const JOURNAL_SCOPE_FILTER_SCHEMA = object({ store: scopeProperties.store, marketplace: scopeProperties.marketplace });
export const JOURNAL_FILTER_SCHEMA = object({
  store: scopeProperties.store, marketplace: scopeProperties.marketplace, sku: scopeProperties.sku, asin: scopeProperties.asin,
  limit: { type: 'integer', minimum: 1, maximum: 100 },
}, ['store', 'marketplace']);
export const EXPERIMENT_REVIEW_PAGE_SCHEMA = object({
  reviewOffset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  reviewLimit: { type: 'integer', minimum: 1, maximum: 100 },
}, []);
export const CREATE_EXPERIMENT_SCHEMA = object({
  diagnosticId: uuid, actionId: DIAGNOSTIC_SCHEMA.properties.actions.items.properties.id, scope: scopeSchema,
  hypothesis: text, primaryVariable: text, baseline: text, control: text,
  maxAdditionalSpend: { type: 'number', minimum: 0 }, maxLoss: { type: 'number', minimum: 0 },
  stopConditions: sources, earliestReviewDate: date, sources, confounders: texts,
  proposalId: { type: 'string', pattern: '^P[0-9]{14}[a-f0-9]{4}$' }, note: text,
}, ['diagnosticId', 'actionId', 'scope', 'hypothesis', 'primaryVariable', 'baseline', 'control',
  'maxAdditionalSpend', 'maxLoss', 'stopConditions', 'earliestReviewDate', 'sources', 'confounders']);
export const EXPERIMENT_REVIEW_SCHEMA = object({
  experimentId: uuid, store: scopeProperties.store, marketplace: scopeProperties.marketplace,
  observation: object({ startDate: date, endDate: date }),
  executionReadback: object({ summary: text, sources: texts }),
  businessOutcome: object({ summary: text, sources: texts, reportingThroughDate: date }, ['summary', 'sources']),
  confounders: texts, controlObservation: text,
  attribution: { type: 'string', enum: ['mature', 'immature', 'unknown', 'not_applicable'] }, attributionReason: text,
  decision: { type: 'string', enum: ['keep', 'stop', 'continue_observing'] }, note: text,
}, ['experimentId', 'store', 'marketplace', 'observation', 'executionReadback', 'businessOutcome', 'confounders']);
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
}
[CREATE_EXPERIMENT_SCHEMA, EXPERIMENT_REVIEW_SCHEMA, JOURNAL_FILTER_SCHEMA, JOURNAL_SCOPE_FILTER_SCHEMA, EXPERIMENT_REVIEW_PAGE_SCHEMA].forEach(deepFreeze);

let db = null;
let dbPath = null;
let initialized = false;
export function closeDecisionJournal() {
  if (db) db.close();
  db = null; dbPath = null; initialized = false;
}

function connection(write = false) {
  const file = path.resolve(FILES.archive());
  if (dbPath && dbPath !== file) closeDecisionJournal();
  // Panel polling/reads of an untouched installation must not create any files.
  if (!db) {
    if (!write && !fs.existsSync(file)) return null;
    if (write) ensureHome();
    db = new DatabaseSync(file);
    dbPath = file;
    db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;');
  }
  if (write && !initialized) {
    enableWal(db);
    transaction(db, () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS decision_diagnostics (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          store TEXT NOT NULL, marketplace TEXT NOT NULL, sku TEXT, asin TEXT,
          created_at TEXT NOT NULL, snapshot TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS decision_diagnostics_scope ON decision_diagnostics(store, marketplace, sku, sequence);
        CREATE TABLE IF NOT EXISTS decision_experiments (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          diagnostic_id TEXT NOT NULL REFERENCES decision_diagnostics(id), action_id TEXT NOT NULL,
          store TEXT NOT NULL, marketplace TEXT NOT NULL, sku TEXT, asin TEXT,
          created_at TEXT NOT NULL, snapshot TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS decision_experiments_scope ON decision_experiments(store, marketplace, sku, sequence);
        CREATE TABLE IF NOT EXISTS decision_reviews (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          experiment_id TEXT NOT NULL REFERENCES decision_experiments(id),
          created_at TEXT NOT NULL, snapshot TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS decision_reviews_experiment ON decision_reviews(experiment_id, sequence);
      `);
      for (const table of ['decision_diagnostics', 'decision_experiments', 'decision_reviews']) {
        for (const operation of ['UPDATE', 'DELETE']) {
          db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation.toLowerCase()}
            BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'decision journal is append-only'); END;`);
        }
      }
    });
    initialized = true;
  }
  return db;
}
function enableWal(d) {
  // Journal-mode upgrades can return SQLITE_BUSY without invoking SQLite's busy handler.
  // Retry only this initialization pragma, never a business mutation; use a monotonic deadline.
  const deadline = performance.now() + 10000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try { d.exec('PRAGMA journal_mode = WAL;'); return; }
    catch (error) {
      const sqliteCode = error.errcode & 0xff;
      const remaining = deadline - performance.now();
      if (![5, 6].includes(sqliteCode) || remaining <= 0) throw error;
      Atomics.wait(pause, 0, 0, Math.min(25, remaining));
    }
  }
}
function transaction(d, fn, mode = 'IMMEDIATE') {
  d.exec(`BEGIN ${mode}`);
  try { const value = fn(); d.exec('COMMIT'); return value; }
  catch (e) { d.exec('ROLLBACK'); throw e; }
}
function hasTable(d, table) {
  return !!d?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

// Accept only bounded, lossless JSON; never invoke input getters/toJSON or silently drop values.
function jsonCopy(value) {
  const seen = new Set();
  function visit(v, depth) {
    if (depth > 30) throw new Error('输入嵌套过深');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || seen.has(v)) throw new Error('输入必须是有限、无循环的纯 JSON');
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new Error('输入必须是纯 JSON 对象');
    if (Object.getOwnPropertySymbols(v).length) throw new Error('输入不能含 Symbol');
    seen.add(v);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (Array.isArray(v) && key === 'length') continue;
      if (!descriptor.enumerable || !('value' in descriptor) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('输入含不安全字段');
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(v) && (Object.keys(v).length !== v.length || Object.keys(v).some((key, index) => key !== String(index)))) throw new Error('输入数组不能有空位或额外属性');
    seen.delete(v);
  }
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded) > 1024 * 1024) throw new Error('输入不能超过 1 MiB');
  return JSON.parse(encoded);
}
function validate(value, schema, name = 'input') {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${name} 枚举值不合法`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${name}.${key} 必填`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`${name}.${key} 是未知字段`);
      validate(item, schema.properties[key], `${name}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems || 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${name} 数组长度不合法`);
    value.forEach((v, i) => validate(v, schema.items, `${name}[${i}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > (schema.maxLength ?? 10000) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
      || (schema.pattern && !new RegExp(schema.pattern).test(value))) throw new Error(`${name} 字符串格式不合法`);
    if (schema.format === 'date' && (value.startsWith('0000-') || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw new Error(`${name} 日期不合法`);
  } else if (['number', 'integer'].includes(schema.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value)) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${name} 数值不合法`);
  }
}
function checked(value, schema) { const copy = jsonCopy(value); validate(copy, schema); return copy; }
function checkScope(scope) {
  validate(scope, scopeSchema, 'scope');
  if (!scope.sku && !scope.asin) throw new Error('scope 必须指定 sku 或 asin');
  if (scope.startDate > scope.endDate) throw new Error('scope 日期区间不合法');
  try { new Intl.DateTimeFormat('en', { timeZone: scope.timezone }).format(); }
  catch { throw new Error('scope.timezone 必须为有效时区'); }
}
const localNotice = '仅为本地记录，不表示已执行、用户授权或自动监控；不会修改提案、开关或自动回滚。';
function getRow(d, table, id, filter) {
  if (!hasTable(d, table)) return null;
  const row = d.prepare(`SELECT snapshot FROM ${table} WHERE id=? AND store=? AND marketplace=?`).get(id, filter.store, filter.marketplace);
  return row ? JSON.parse(row.snapshot) : null;
}
function insert(d, table, record, extraColumns = [], extraValues = []) {
  const s = record.scope;
  const columns = ['id', 'store', 'marketplace', 'sku', 'asin', 'created_at', 'snapshot', ...extraColumns];
  d.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
    .run(record.id, s.store, s.marketplace, s.sku || null, s.asin || null, record.createdAt, JSON.stringify(record), ...extraValues);
}

export function saveDiagnostic(card) {
  const input = jsonCopy(card);
  // Recompute with the trusted local evaluator, not agent-supplied recommendations or authorization.
  const result = jsonCopy(evaluateDiagnostic(input));
  checkScope(input.scope);
  const record = jsonCopy({
    id: randomUUID(), createdAt: new Date().toISOString(), scope: input.scope,
    status: 'LOCAL_SNAPSHOT', statusExplanation: '本地不可变诊断快照（未执行）',
    input, result, executionAuthorized: false, notice: localNotice,
  });
  const d = connection(true);
  transaction(d, () => insert(d, 'decision_diagnostics', record));
  return record;
}
export function getDiagnostic(id, filter) {
  validate(id, uuid, 'id'); const f = checked(filter, JOURNAL_SCOPE_FILTER_SCHEMA);
  return getRow(connection(), 'decision_diagnostics', id, f);
}
function list(table, filter) {
  const f = checked(filter, JOURNAL_FILTER_SCHEMA); const d = connection();
  if (!hasTable(d, table)) return [];
  const conditions = ['store=?', 'marketplace=?']; const values = [f.store, f.marketplace];
  for (const key of ['sku', 'asin']) if (f[key]) { conditions.push(`${key}=?`); values.push(f[key]); }
  return d.prepare(`SELECT snapshot FROM ${table} WHERE ${conditions.join(' AND ')} ORDER BY sequence DESC LIMIT ?`)
    .all(...values, f.limit ?? 20).map((row) => JSON.parse(row.snapshot));
}
export function listDiagnostics(filter) { return list('decision_diagnostics', filter); }

function actionBinding(rawAction, assessedAction, diagnostic) {
  const explanation = assessedAction
    ? '动作状态与门禁仅来自诊断保存时的评估快照；未按当前数据复评，不表示授权或已执行。'
    : '历史记录缺少已评估动作快照；原始声明仅保留在 rawAction，动作状态与门禁按未知处理，未复评、未授权。';
  const action = assessedAction ? jsonCopy(assessedAction) : {
    ...jsonCopy(rawAction),
    gates: (rawAction.gates || []).map(gate => ({ ...gate, status: 'unknown', reason: explanation })),
    status: 'unknown', statusMeaning: explanation, executionAuthorized: false, executed: false,
  };
  return {
    action, rawAction: jsonCopy(rawAction),
    actionAssessment: {
      source: assessedAction ? 'diagnostic_snapshot' : 'legacy_raw_unassessed',
      diagnosticId: diagnostic.id, diagnosticCreatedAt: diagnostic.createdAt || null,
      revalidated: false, explanation,
    },
  };
}
function experimentForRead(record) {
  if (!record || record.actionAssessment) return record;
  // Do not rewrite append-only legacy rows or upgrade original gate claims into assessments.
  return { ...record, ...actionBinding(record.rawAction || record.action, null, { id: record.diagnosticId }) };
}

export function createExperiment(input) {
  const plan = checked(input, CREATE_EXPERIMENT_SCHEMA); checkScope(plan.scope);
  if (plan.earliestReviewDate < plan.scope.endDate) throw new Error('earliestReviewDate 不能早于诊断窗口结束日期');
  const d = connection(true);
  return transaction(d, () => {
    const diagnostic = getRow(d, 'decision_diagnostics', plan.diagnosticId, plan.scope);
    if (!diagnostic) throw new Error('诊断不存在或店铺/站点不匹配');
    for (const key of Object.keys(scopeProperties)) {
      if (diagnostic.scope[key] !== plan.scope[key]) throw new Error(`实验 scope.${key} 与诊断不匹配，不能跨范围绑定`);
    }
    const rawAction = diagnostic.input.actions.find((a) => a.id === plan.actionId);
    if (!rawAction) throw new Error('actionId 必须引用已保存诊断中的具体动作');
    const assessedAction = diagnostic.result?.evaluatedActions?.find((a) => a.id === plan.actionId);
    const record = {
      ...plan, id: randomUUID(), createdAt: new Date().toISOString(),
      ...actionBinding(rawAction, assessedAction, diagnostic),
      status: 'LOCAL_PLAN', statusExplanation: '本地实验计划（未执行、未授权、无自动监控）',
      proposalReference: plan.proposalId ? { id: plan.proposalId, status: 'unverified_reference', statusExplanation: '调用方声明的未核实引用；未核实存在性、店站、执行状态或与本动作关联' } : null,
      executionAuthorized: false, notice: localNotice,
    };
    insert(d, 'decision_experiments', record, ['diagnostic_id', 'action_id'], [plan.diagnosticId, plan.actionId]);
    return jsonCopy(record);
  });
}
function reviewCount(d, id) {
  return d.prepare('SELECT COUNT(*) AS n FROM decision_reviews WHERE experiment_id=?').get(id).n;
}
function withReviews(d, record, page) {
  if (!record) return null;
  const count = reviewCount(d, record.id);
  const offset = page.reviewOffset ?? 0; const limit = page.reviewLimit ?? 20;
  const reviews = d.prepare('SELECT snapshot FROM decision_reviews WHERE experiment_id=? ORDER BY sequence LIMIT ? OFFSET ?')
    .all(record.id, limit, offset).map((r) => JSON.parse(r.snapshot));
  const nextOffset = offset + reviews.length;
  return { ...record, reviews, reviewCount: count, reviewOffset: offset,
    reviewsTruncated: count > reviews.length, nextReviewOffset: nextOffset < count ? nextOffset : null };
}
export function getExperiment(id, filter, options = {}) {
  validate(id, uuid, 'id'); const f = checked(filter, JOURNAL_SCOPE_FILTER_SCHEMA);
  const page = checked(options, EXPERIMENT_REVIEW_PAGE_SCHEMA); const d = connection();
  if (!d) return null;
  // Count and page belong to one WAL read snapshot, even while other processes append.
  return transaction(d, () => withReviews(d, experimentForRead(getRow(d, 'decision_experiments', id, f)), page), 'DEFERRED');
}
function latestReviewSummary(d, id) {
  // Extract only presentation fields in SQLite; never load a potentially huge history/full review for the panel.
  const row = d.prepare(`SELECT created_at AS createdAt,
    json_extract(snapshot, '$.status') AS status,
    json_extract(snapshot, '$.statusExplanation') AS statusExplanation,
    json_extract(snapshot, '$.decision') AS decision,
    json_extract(snapshot, '$.businessOutcome.summary') AS businessSummary,
    json_extract(snapshot, '$.limitations') AS limitations
    FROM decision_reviews WHERE experiment_id=? ORDER BY sequence DESC LIMIT 1`).get(id);
  if (!row) return null;
  return { status: row.status, statusExplanation: row.statusExplanation, createdAt: row.createdAt,
    ...(row.decision ? { decision: row.decision, decisionExplanation: {
      keep: '本地记录：保留计划，不执行变更', stop: '本地记录：建议停止并人工复核，未执行停止或回滚',
      continue_observing: '本地记录：继续观察，未安排自动监控',
    }[row.decision] } : {}),
    businessOutcome: { summary: row.businessSummary }, limitations: JSON.parse(row.limitations) };
}
export function listExperiments(filter) {
  const records = list('decision_experiments', filter);
  if (!records.length) return records;
  const d = connection();
  return transaction(d, () => records.map((record) => ({ ...experimentForRead(record),
    reviewCount: reviewCount(d, record.id), latestReview: latestReviewSummary(d, record.id),
  })), 'DEFERRED');
}
function dateInZone(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
export function recordExperimentReview(input) {
  const review = checked(input, EXPERIMENT_REVIEW_SCHEMA);
  if (review.observation.startDate > review.observation.endDate) throw new Error('observation 日期区间不合法');
  if (review.attribution && !review.attributionReason) throw new Error('声明 attribution 必须说明 attributionReason');
  const d = connection(true);
  return transaction(d, () => {
    const experiment = getRow(d, 'decision_experiments', review.experimentId, review);
    if (!experiment) throw new Error('实验不存在或店铺/站点不匹配');
    const today = dateInZone(experiment.scope.timezone);
    if (review.observation.endDate > today) throw new Error('观察结束日期不能晚于店铺时区今天，不能把未来当成已观察');
    if (review.businessOutcome.reportingThroughDate > today) throw new Error('报告覆盖日期不能在未来');
    const reasons = ['本账本仅保存调用方描述，未进行独立归因或因果验证'];
    const reportIncomplete = !review.businessOutcome.reportingThroughDate || review.businessOutcome.reportingThroughDate < review.observation.endDate;
    const early = today < experiment.earliestReviewDate || review.observation.endDate < experiment.earliestReviewDate;
    if (early) reasons.push('尚未到最早可复盘日期或观察窗口不足');
    if (reportIncomplete) reasons.push('报告覆盖日期缺失或尚未覆盖完整观察窗口');
    if (!review.attribution || review.attribution !== 'mature') reasons.push('归因缺失、未成熟、未知或不适用；不能据此认定因果');
    if (!review.controlObservation) reasons.push('缺少对照观察');
    if (experiment.confounders.length || review.confounders.length) reasons.push('存在已声明混杂项，不能排除其他解释');
    if (!review.businessOutcome.sources.length) reasons.push('业务效果没有可追溯来源');
    const record = {
      ...review, id: randomUUID(), createdAt: new Date().toISOString(), scope: experiment.scope,
      status: early ? 'EARLY_OBSERVATION' : 'DESCRIPTIVE_ONLY',
      statusExplanation: early ? '观察期未满，仅可记录早期现象' : '描述式复盘，不代表已验证因果',
      executionReadback: { ...review.executionReadback, status: 'REPORTED_UNVERIFIED', statusExplanation: '调用方记录的平台回读声明，账本未独立核验；不等于业务效果' },
      businessOutcome: { ...review.businessOutcome, status: 'DESCRIPTIVE_ONLY', statusExplanation: '业务效果描述，不等于平台执行成功，也不构成因果证明' },
      causalStatus: 'UNKNOWN', causalStatusExplanation: '因果未知，不输出已验证因果', limitations: reasons,
      ...(review.attribution ? { attributionExplanation: {
        mature: '调用方声明归因已成熟（未独立核验）', immature: '调用方声明归因尚未成熟',
        unknown: '归因状态未知', not_applicable: '调用方声明归因不适用（不构成因果证明）',
      }[review.attribution] } : {}),
      ...(review.decision ? { decisionExplanation: {
        keep: '本地记录：保留计划，不执行变更', stop: '本地记录：建议停止并人工复核，未执行停止或回滚',
        continue_observing: '本地记录：继续观察，未安排自动监控',
      }[review.decision] } : {}),
      executionAuthorized: false, notice: localNotice,
    };
    d.prepare('INSERT INTO decision_reviews (id, experiment_id, created_at, snapshot) VALUES (?, ?, ?, ?)')
      .run(record.id, review.experimentId, record.createdAt, JSON.stringify(record));
    return jsonCopy(record);
  });
}
