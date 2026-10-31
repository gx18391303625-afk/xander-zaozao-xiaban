// 纯本地、无 I/O 的证据诊断。输入声明不等于独立核验，推荐不等于执行授权。
const text = { type: 'string', minLength: 1, maxLength: 4096,
  pattern: '^(?![\\s\\S]*[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f])\\S(?:[\\s\\S]*\\S)?$' };
const modules = ['analyze-amazon-competitors', 'build-amazon-keyword-library', 'write-amazon-listing',
  'build-amazon-advertising-strategy', 'plan-amazon-replenishment', 'reconcile-amazon-profit', 'xander-operations'];
const targetSchema = { type: 'object', additionalProperties: false, required: ['type', 'id'], properties: {
  type: { type: 'string', enum: ['sku', 'asin', 'campaign', 'ad_group', 'keyword', 'search_term', 'listing', 'offer'] }, id: text,
} };
const enumeration = (...values) => ({ type: 'string', enum: values });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const array = (items) => ({ type: 'array', items, maxItems: 200 });
const ids = { ...array(text), uniqueItems: true };
const scopeSchema = object({
  store: text, marketplace: text, currency: { type: 'string', pattern: '^[A-Z]{3}$' }, timezone: text,
  sku: text, asin: { type: 'string', pattern: '^[A-Z0-9]{10}$' },
  startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' },
}, ['store', 'marketplace', 'currency', 'timezone', 'startDate', 'endDate']);
scopeSchema.anyOf = [{ required: ['sku'] }, { required: ['asin'] }];
const gateSchema = object({
  name: text, status: enumeration('satisfied', 'unmet', 'unknown', 'not_applicable'), reason: text, evidenceIds: ids,
});
const evidenceSchema = object({
  id: text, source: text, module: text,
  kind: enumeration('fact', 'inference', 'estimate', 'simulation', 'unknown'),
  fetchedAt: { type: 'string', format: 'date-time' },
  coverage: enumeration('complete', 'partial', 'unknown'),
  pagination: enumeration('complete', 'incomplete', 'unknown', 'not_applicable'), paginationReason: text,
  attribution: enumeration('mature', 'immature', 'unknown', 'not_applicable'), attributionReason: text,
  scope: scopeSchema, object: targetSchema,
  productAttribution: enumeration('isolated', 'shared', 'unknown'),
  metrics: object({ clicks: { type: 'integer', minimum: 0 }, orders: { type: 'integer', minimum: 0 } }, []),
}, ['id', 'source', 'module', 'kind', 'fetchedAt', 'coverage', 'pagination', 'attribution', 'scope']);
const actionSchema = object({
  id: text, object: targetSchema, ownerModule: enumeration(...modules),
  intent: enumeration('investigate', 'validate_demand', 'scale', 'reduce_exposure', 'clear_inventory', 'hold'),
  reason: text, hardStop: { type: 'boolean' }, gates: array(gateSchema),
}, ['id', 'object', 'ownerModule', 'intent', 'reason', 'gates']);
const policySchema = object({
  basis: text, evidenceIds: ids,
  minClicks: { type: 'integer', minimum: 1 }, minOrders: { type: 'integer', minimum: 1 },
});

/** MCP input schema. Runtime additionally checks calendar/timezone, IDs and cross-field semantics. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
export const DIAGNOSTIC_SCHEMA = deepFreeze({
  $schema: 'http://json-schema.org/draft-07/schema#',
  ...object({
    scope: scopeSchema,
    goal: object({
      objective: enumeration('validate_demand', 'scale_validated', 'protect_profit', 'clear_inventory'),
      confirmation: enumeration('confirmed', 'unconfirmed', 'unknown'),
    }),
    evidence: array(evidenceSchema), actions: array(actionSchema),
    sampleCheck: object({ evidenceId: text, policy: policySchema }, ['evidenceId']),
  }, ['scope', 'goal', 'evidence', 'actions']),
});

const DISCLAIMER = '仅基于所供证据及其来源声明进行本地诊断，不是独立验证、已执行结果或任何写入/执行授权。';
const STATE = {
  satisfied: '所供证据满足本门禁（未独立核验）', unmet: '所供证据显示未满足',
  unknown: '证据不足或不适用，不能放行', not_applicable: '有明确理由及证据的不适用',
};
const BASE_GATES = ['data_ownership', 'evidence_quality', 'goal_confirmed'];
const OPERATION_GATES = ['economics', 'eligibility'];
const SCALE_GATES = ['inventory_cash', 'sample_attribution', 'demand_window'];
const NO_SKIP = new Set([...BASE_GATES, ...OPERATION_GATES, 'inventory_cash', 'sample_attribution', 'learning_bounds']);
const own = (v, k) => Object.hasOwn(v, k);
const fail = (path, reason) => { throw new Error(`诊断 ${path}: ${reason}`); };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith('0000-')) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}
function validTimestamp(v) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  return !!match && validDate(match[1]) && +match[2] < 24 && +match[3] < 60 && +match[4] < 60
    && (match[5] === 'Z' || (+match[5].slice(1, 3) < 24 && +match[5].slice(4, 6) < 60))
    && Number.isFinite(Date.parse(v));
}
// Bound work before recursive schema validation, even when MCP does not validate input.
function checkSize(root) {
  let count = 0;
  const active = new WeakSet();
  function visit(value, depth) {
    if (++count > 10000 || depth > 12) fail('input', '输入过大或过深');
    if (typeof value === 'string' && value.length > 4096) fail('input', '字符串过长');
    if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return;
    if (!isObject(value) && !Array.isArray(value)) fail('input', '仅接受 JSON 普通对象与值');
    if (Array.isArray(value) && ![Array.prototype, null].includes(Object.getPrototypeOf(value))) fail('input', '仅接受 JSON 普通数组');
    if (active.has(value)) fail('input', '不接受循环引用');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors).filter((key) => !(Array.isArray(value) && key === 'length'));
    if (keys.length > 200) fail('input', '数组或对象过大');
    active.add(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !descriptor.enumerable || !own(descriptor, 'value')
        || (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
        fail('input', '仅接受 JSON 可枚举数据字段，不接受访问器、隐藏字段或数组附加字段');
      }
      visit(descriptor.value, depth + 1);
    }
    active.delete(value);
  }
  visit(root, 0);
}
// A deliberately small validator for the schema above; no config, network or package dependency.
function validate(schema, value, path = 'input', active = new WeakSet()) {
  if (schema.type === 'object') {
    if (!isObject(value)) fail(path, '必须是普通对象');
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail(path, '必须是数组');
    if (value.length > schema.maxItems) fail(path, '数组超过上限');
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || (schema.minLength && value.length < schema.minLength)) fail(path, '字符串为空或格式无效');
    if (schema.pattern) {
      const match = new RegExp(schema.pattern, 'u').exec(value);
      if (!match || (schema.pattern.startsWith('^') && schema.pattern.endsWith('$') && match[0] !== value)) fail(path, '字符串为空或格式无效');
    }
    if (schema.format === 'date' && !validDate(value)) fail(path, '无效日期，应为 YYYY-MM-DD');
    if (schema.format === 'date-time' && !validTimestamp(value)) fail(path, '取数时间必须是有效的带时区 ISO 时间');
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum) fail(path, '必须是范围内的安全整数');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail(path, '必须是布尔值');
  if (schema.enum && !schema.enum.includes(value)) fail(path, `必须为 ${schema.enum.join('/')}`);
  if (schema.type !== 'object' && schema.type !== 'array') return;
  if (active.has(value)) fail(path, '不接受循环引用');
  active.add(value);
  try {
    if (schema.type === 'object') {
      for (const key of schema.required || []) if (!own(value, key)) fail(`${path}.${key}`, '缺少必填字段');
      for (const key of Object.keys(value)) {
        if (!own(schema.properties, key)) fail(`${path}.${key}`, '未知字段');
        validate(schema.properties[key], value[key], `${path}.${key}`, active);
      }
      if (schema.anyOf && !schema.anyOf.some((s) => s.required.every((k) => own(value, k)))) fail(path, '必须提供 sku 或 asin');
    } else {
      for (let i = 0; i < value.length; i++) validate(schema.items, value[i], `${path}[${i}]`, active);
      if (schema.uniqueItems && new Set(value).size !== value.length) fail(path, '不能有重复项');
    }
  } finally { active.delete(value); }
}
function validateScope(scope, path) {
  if (scope.startDate > scope.endDate) fail(path, 'startDate 不能晚于 endDate');
  try { new Intl.DateTimeFormat('en', { timeZone: scope.timezone }); } catch { fail(`${path}.timezone`, '无效时区'); }
}
function uniqueBy(rows, key, path) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row[key])) fail(path, `${key} 必须唯一：${row[key]}`);
    seen.add(row[key]);
  }
}
function localDate(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, era: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const value = (type) => parts.find((p) => p.type === type).value;
  // Ancient timestamps can cross into 1 BCE under a negative timezone offset.
  const era = parts.find((p) => p.type === 'era')?.value;
  const year = era === 'BC' ? '0000' : value('year').padStart(4, '0');
  if (Number(year) > 9999) return '9999-12-31'; // All supported scope dates precede this local year.
  return `${year}-${value('month')}-${value('day')}`;
}
function conflictingProductMappings(evidence) {
  const mappings = new Map();
  for (const e of evidence) {
    if (!e.scope.sku || !e.scope.asin) continue;
    const key = JSON.stringify([e.scope.store, e.scope.marketplace, e.scope.sku]);
    if (!mappings.has(key)) mappings.set(key, new Set());
    mappings.get(key).add(e.scope.asin);
  }
  return new Set(evidence.filter((e) => e.scope.sku && mappings.get(JSON.stringify([
    e.scope.store, e.scope.marketplace, e.scope.sku,
  ]))?.size > 1).map((e) => e.id));
}
function productAttributionIssue(e) {
  if (!e.metrics || e.productAttribution === 'isolated') return null;
  return e.productAttribution === 'shared'
    ? '共享广告组或多商品聚合绩效不能代表单 SKU/ASIN，不能据此放行；scope 声明不证明单品隔离。'
    : '绩效证据未明确单品隔离（productAttribution 为未知或缺失），不能仅凭 scope 归属单 SKU/ASIN。';
}
function assessEvidence(e, scope, now, mappingConflicts) {
  const mismatches = ['store', 'marketplace', 'currency', 'timezone', 'startDate', 'endDate', 'sku', 'asin']
    .filter((key) => own(scope, key) && e.scope[key] !== scope[key]);
  if (mappingConflicts.has(e.id)) mismatches.push('同店铺站点 SKU→ASIN 映射冲突');
  const issues = [];
  const productIssue = productAttributionIssue(e);
  if (productIssue) issues.push(productIssue);
  if (mismatches.length) issues.push(`范围不匹配：${mismatches.join('、')}`);
  if (Date.parse(e.fetchedAt) > now) issues.push('取数时间晚于本地评估时间，未来事实不可用');
  if (e.scope.endDate > localDate(e.fetchedAt, e.scope.timezone)) issues.push('报告结束日期晚于取数时在该时区的日期，覆盖不可信');
  if (e.kind !== 'fact') issues.push(`证据类型为 ${e.kind}，不能作为已核实事实放行`);
  if (e.coverage !== 'complete') issues.push('覆盖不完整或未知，不能把遗漏当作零');
  if (!['complete', 'not_applicable'].includes(e.pagination)) issues.push('分页未完整取回或未知');
  return {
    ...e, scopeMatches: mismatches.length === 0, usable: issues.length === 0,
    issues, attributionReady: e.attribution === 'mature',
    statusMeaning: issues.length ? '仅保留为待核对证据，不能放行操作' : '输入声明完整且匹配，尚未独立核验',
  };
}
function makeGate(name, status, reason, evidenceIds = []) {
  return { name, status, statusMeaning: STATE[status], reason, evidenceIds };
}
function checkSample(input, evidenceById) {
  const check = input.sampleCheck;
  if (!check) return { status: 'unknown', reason: '未提供样本及有明确依据的判断规则，不能仅凭 CVR 放量。', evidenceIds: [], clicks: null, orders: null, cvr: null };
  const e = evidenceById.get(check.evidenceId);
  const clicks = e?.metrics?.clicks ?? null;
  const orders = e?.metrics?.orders ?? null;
  const result = { evidenceIds: [check.evidenceId, ...(check.policy?.evidenceIds || [])], clicks, orders, cvr: clicks > 0 && orders !== null ? orders / clicks : null };
  const report = (status, reason) => ({ ...result, status, statusMeaning: STATE[status], reason });
  if (e && productAttributionIssue(e)) return report('unknown', productAttributionIssue(e));
  if (!e || !e.usable) return report('unknown', '样本证据缺失、范围不匹配、非事实或取数不完整。');
  if (!e.attributionReady) return report('unknown', '样本归因尚未成熟或未知；不把未归因订单当作零。');
  if (clicks === null || orders === null) return report('unknown', '点击或订单未知；未知与已知 0 不同。');
  if (clicks === 0 || orders <= 1) return report('unmet', '零点击或至多一单不能证明稳定转化；2 点击 1 单的高 CVR 也不支持放量。');
  if (!check.policy || !check.policy.evidenceIds.length) return report('unknown', '缺少来自明确证据依据的样本阈值，不能硬编码点击数为充分样本。');
  if (check.policy.evidenceIds.some((id) => !evidenceById.get(id)?.usable)) return report('unknown', '样本阈值依据证据不存在或不可用于当前范围。');
  if (clicks < check.policy.minClicks || orders < check.policy.minOrders) return report('unmet', '未达到所供依据中的点击/订单阈值。');
  return report('satisfied', `达到所供规则（${check.policy.basis}）；仅说明满足输入规则，不是统计学独立验证或需求已验证。`);
}

/** Evaluate caller-supplied candidates; returns review tasks only, never precise writes or authorization. */
export function evaluateDiagnostic(input, { now = Date.now() } = {}) {
  // Clock injection is for deterministic local tests; never accepted in the MCP input schema.
  if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) fail('clock', '本地评估时间无效');
  checkSize(input);
  validate(DIAGNOSTIC_SCHEMA, input);
  validateScope(input.scope, 'scope');
  uniqueBy(input.evidence, 'id', 'evidence');
  uniqueBy(input.actions, 'id', 'actions');
  for (const e of input.evidence) {
    validateScope(e.scope, `evidence.${e.id}.scope`);
    if (['sku', 'asin'].includes(e.object?.type) && e.scope[e.object.type] !== e.object.id) fail(`evidence.${e.id}.object`, '证据对象与其商品范围不一致');
    for (const field of ['pagination', 'attribution']) {
      if (e[field] === 'not_applicable' && !e[`${field}Reason`]) fail(`evidence.${e.id}.${field}`, 'not_applicable 必须提供理由');
    }
  }
  for (const action of input.actions) {
    uniqueBy(action.gates, 'name', `actions.${action.id}.gates`);
    if (action.hardStop && action.intent !== 'reduce_exposure') fail(`actions.${action.id}.hardStop`, '硬止损仅适用于 reduce_exposure');
    if (action.object.type === 'sku' && action.object.id !== input.scope.sku
      || action.object.type === 'asin' && action.object.id !== input.scope.asin) fail(`actions.${action.id}.object`, '动作商品对象与诊断范围不匹配');
  }
  // Clone once: output snapshots must not share mutable references with caller data.
  const snapshot = JSON.parse(JSON.stringify(input));
  const mappingConflicts = conflictingProductMappings(snapshot.evidence);
  const evidenceAssessments = snapshot.evidence.map((e) => assessEvidence(e, snapshot.scope, now, mappingConflicts));
  const evidenceById = new Map(evidenceAssessments.map((e) => [e.id, e]));
  const sampleCheck = checkSample(snapshot, evidenceById);
  const assessed = snapshot.actions.map((action) => {
    const required = [...BASE_GATES];
    if (!['investigate', 'hold'].includes(action.intent)) required.push(...OPERATION_GATES);
    if (action.intent === 'scale') required.push(...SCALE_GATES);
    if (['validate_demand', 'clear_inventory'].includes(action.intent)) required.push('inventory_cash', 'demand_window');
    if (action.intent === 'validate_demand') required.push('learning_bounds');
    const supplied = new Map(action.gates.map((g) => [g.name, g]));
    const allNames = [...new Set([...required, ...supplied.keys()])];
    const sampleForAction = { ...sampleCheck };
    if (allNames.includes('sample_attribution') && !['sku', 'asin'].includes(action.object.type)) {
      const sampleMatches = sampleCheck.evidenceIds.length > 0 && sampleCheck.evidenceIds.every((id) => {
        const e = evidenceById.get(id);
        return e?.object?.type === action.object.type && e.object.id === action.object.id;
      });
      if (!sampleMatches) {
        sampleForAction.status = 'unknown';
        sampleForAction.statusMeaning = STATE.unknown;
        sampleForAction.reason = '样本及阈值依据未全部明确归属于本动作的具体对象；不能跨活动/广告组/关键词复用样本放行。';
      }
    }
    const citedIds = [...new Set([...action.gates.flatMap((g) => g.evidenceIds),
      ...(allNames.includes('sample_attribution') ? sampleForAction.evidenceIds : [])])];
    const refs = citedIds.map((id) => evidenceById.get(id));
    const sameObject = (e) => e?.object?.type === action.object.type && e.object.id === action.object.id;
    const targetMatches = ['sku', 'asin'].includes(action.object.type)
      || (refs.some(sameObject) && refs.every((e) => !e?.object || sameObject(e)));
    const gates = allNames.map((name) => {
      const g = supplied.get(name);
      if (g?.status === 'not_applicable' && NO_SKIP.has(name)) return makeGate(name, 'unknown', '本项为硬门禁，不接受不适用跳过；请补实际证据。', g.evidenceIds);
      if (g && ['unknown', 'unmet'].includes(g.status)) return makeGate(name, g.status, g.reason, g.evidenceIds);
      if (name === 'goal_confirmed') return makeGate(name, snapshot.goal.confirmation === 'confirmed' ? 'satisfied' : 'unknown',
        snapshot.goal.confirmation === 'confirmed' ? '经营目标由输入单独确认，不按商品月龄自动转阶段。' : '经营目标未明确确认，需人工确认。');
      if (name === 'data_ownership') return makeGate(name,
        refs.length && targetMatches && refs.every((e) => e?.scopeMatches) ? 'satisfied' : 'unknown',
        refs.length && targetMatches && refs.every((e) => e?.scopeMatches) ? '所引用证据的账户/站点/币种/时区/商品/日期与范围一致。' : '缺引用证据，或账户/站点/币种/时区/商品/日期归属不明或不匹配。', citedIds);
      if (name === 'evidence_quality') return makeGate(name,
        refs.length && refs.every((e) => e?.usable) ? 'satisfied' : 'unknown',
        refs.length && refs.every((e) => e?.usable) ? '引用证据声明为事实、覆盖完整、分页完整或有不适用理由。' : '引用证据缺失、非事实、覆盖/分页不完整或未知。', citedIds);
      if (name === 'sample_attribution') return makeGate(name, sampleForAction.status, sampleForAction.reason, sampleForAction.evidenceIds);
      if (!g) return makeGate(name, 'unknown', '缺少本动作必需门禁，自动按未知处理。');
      if (g.status === 'not_applicable' && NO_SKIP.has(name)) return makeGate(name, 'unknown', '本项为硬门禁，不接受不适用跳过；请补实际证据。', g.evidenceIds);
      if (g.evidenceIds.some((id) => !evidenceById.has(id))) return makeGate(name, 'unknown', '引用了不存在的证据 ID。', g.evidenceIds);
      if (['satisfied', 'not_applicable'].includes(g.status)
        && (!g.evidenceIds.length || g.evidenceIds.some((id) => !evidenceById.get(id).usable))) {
        return makeGate(name, 'unknown', '满足/不适用声明缺少匹配、完整的事实证据，不能放行。', g.evidenceIds);
      }
      return makeGate(name, g.status, g.reason, g.evidenceIds);
    });
    if (action.intent === 'scale' && snapshot.goal.objective !== 'scale_validated') {
      gates.push(makeGate('goal_alignment', 'unmet', '当前经营目标不是已验证后扩量；不自动切换目标。'));
    }
    if (action.intent === 'validate_demand' && snapshot.goal.objective !== 'validate_demand') {
      gates.push(makeGate('goal_alignment', 'unmet', '当前经营目标不是需求验证；不自动切换目标或增加学习暴露。'));
    }
    if (action.intent === 'clear_inventory' && snapshot.goal.objective !== 'clear_inventory') {
      gates.push(makeGate('goal_alignment', 'unmet', '当前经营目标不是清库存；需先确认目标。'));
    }
    const blocked = gates.some((g) => !['satisfied', 'not_applicable'].includes(g.status));
    return {
      ...action, gates, ...(allNames.includes('sample_attribution') ? { sampleCheck: sampleForAction } : {}),
      status: action.intent === 'hold' ? 'hold' : blocked ? 'blocked' : 'review_ready',
      statusMeaning: blocked ? '证据门禁未齐，暂不动作；先补证或核对。' : '仅可作为人工复核待办，不代表授权或已执行。',
      executionAuthorized: false, executed: false,
    };
  });
  const hardStops = assessed.filter((a) => a.hardStop);
  // Unresolved hard-stop concerns block both expansion and new learning exposure, not risk-reducing inventory clearance.
  if (hardStops.length) {
    for (const action of assessed.filter((a) => ['scale', 'validate_demand'].includes(a.intent))) {
      action.gates.push(makeGate('hard_stop_priority', 'unmet', '存在需优先人工复核的硬止损风险；尚未执行止损。'));
      action.status = 'blocked';
      action.statusMeaning = '先人工复核硬止损风险，暂不扩量或增加学习暴露；尚未执行任何变更。';
    }
  }
  const priority = (a) => a.hardStop ? 0 : a.intent === 'reduce_exposure' ? 1 : a.intent === 'investigate' ? 2 : 3;
  const ready = assessed.filter((a) => a.status === 'review_ready').sort((a, b) => priority(a) - priority(b));
  const recommendations = ready.slice(0, 3);
  const chosen = new Set(recommendations.map((a) => a.id));
  const deferred = assessed.filter((a) => !chosen.has(a.id)).map((a) => ({
    ...a, deferredReason: a.status === 'review_ready' ? '本次最多推荐 3 项，留待后续人工复核。' : a.status === 'hold' ? '明确暂不动作。' : '存在未满足或未知门禁。',
  }));
  return {
    status: hardStops.length ? 'hard_stop_review' : recommendations.length ? 'review_ready' : 'insufficient_evidence',
    statusMeaning: hardStops.length ? '优先人工复核硬止损风险；未执行、不能宣称已止损。' : '仅基于所供证据筛选人工复核待办及暂不动项目。',
    disclaimer: DISCLAIMER, scope: snapshot.scope, goal: snapshot.goal,
    evidence: snapshot.evidence, actions: snapshot.actions, evaluatedActions: assessed,
    summary: { recommended: recommendations.length, deferred: deferred.length, hardStopReview: hardStops.length,
      message: '依据所供证据，待核准方案；不代表独立验证、执行或授权。' },
    focus: recommendations.map((a) => ({ id: a.id, object: a.object, ownerModule: a.ownerModule, intent: a.intent, reason: a.reason })),
    evidenceAssessments, sampleCheck, recommendations, deferred,
    executionAuthorized: false, executed: false, independentlyVerified: false,
    limitations: [DISCLAIMER, '不联网、不写 Amazon、不改配置、不持久化；不生成精确写入指令。',
      '门禁结论依赖输入的事实/完整性/归因及阈值依据声明；不能证明来源真实或阈值科学合理。',
      '不根据月龄推断阶段；未提供的指标保留未知，已知 0 保留为 0。'],
  };
}
