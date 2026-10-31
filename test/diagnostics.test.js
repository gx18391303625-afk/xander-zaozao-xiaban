import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAGNOSTIC_SCHEMA, evaluateDiagnostic as evaluateAtClock } from '../lib/diagnostics.js';
const NOW = Date.parse('2026-10-31T03:00:00Z');
const evaluateDiagnostic = (input) => evaluateAtClock(input, { now: NOW });

const owner = 'build-amazon-advertising-strategy';
const scope = () => ({ store: 'store-a', marketplace: 'US', currency: 'USD', timezone: 'America/Los_Angeles', sku: 'sku-a', asin: 'B000000001', startDate: '2026-10-01', endDate: '2026-10-14' });
const evidence = (id = 'report') => ({ id, source: 'user-provided-report', module: owner, kind: 'fact', fetchedAt: '2026-10-20T12:00:00Z', coverage: 'complete', pagination: 'complete', attribution: 'mature', productAttribution: 'isolated', scope: scope(), metrics: { clicks: 100, orders: 10 } });
const gate = (name, status = 'satisfied', evidenceIds = ['report']) => ({ name, status, reason: '依据所供完整报表及人工确认的业务规则，待核准。', evidenceIds });
const action = (id = 'scale-a', intent = 'scale') => ({ id, object: { type: 'sku', id: 'sku-a' }, ownerModule: owner, intent, reason: '复核该 SKU 是否具备扩量条件', gates: ['economics', 'eligibility', 'inventory_cash', 'demand_window'].map((n) => gate(n)) });
const input = () => ({ scope: scope(), goal: { objective: 'scale_validated', confirmation: 'confirmed' }, evidence: [evidence(), evidence('policy')], actions: [action()], sampleCheck: { evidenceId: 'report', policy: { basis: '经营者提供的实验设计与复核规则（非模块固定阈值）', evidenceIds: ['policy'], minClicks: 80, minOrders: 5 } } });
const evaluated = (result, id = 'scale-a') => result.evaluatedActions.find((a) => a.id === id);
const getGate = (result, name, id) => evaluated(result, id).gates.find((g) => g.name === name);

// 这些测试仅用内存中的输入，无用户目录、网络、Amazon API 或配置依赖。
test('根 object JSON Schema 与输入契约固定且深冻结', () => {
  assert.equal(DIAGNOSTIC_SCHEMA.type, 'object');
  assert.equal(DIAGNOSTIC_SCHEMA.additionalProperties, false);
  assert.deepEqual(DIAGNOSTIC_SCHEMA.required, ['scope', 'goal', 'evidence', 'actions']);
  assert.deepEqual(DIAGNOSTIC_SCHEMA.properties.goal.properties.objective.enum, ['validate_demand', 'scale_validated', 'protect_profit', 'clear_inventory']);
  assert.throws(() => { DIAGNOSTIC_SCHEMA.properties.actions.items.properties.ownerModule.enum.push('evil'); }, TypeError);
});

test('完整事实证据仅返回人工复核方案，不授权、不宣称独立验证', () => {
  const i = input();
  const result = evaluateDiagnostic(i);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.sampleCheck.status, 'satisfied');
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.executed, false);
  assert.equal(result.independentlyVerified, false);
  assert.match(result.disclaimer, /仅基于所供证据.*不是独立验证/);
  assert.match(result.summary.message, /待核准方案/);
  assert.deepEqual(result.actions, i.actions);
  assert.deepEqual(result.evidence, i.evidence);
  assert.deepEqual(result.scope, i.scope);
  assert.deepEqual(result.goal, i.goal);
  assert.equal(result.focus[0].ownerModule, owner);
  assert.ok(result.recommendations[0].gates.every((g) => g.reason && Array.isArray(g.evidenceIds) && g.statusMeaning));
});

test('纯函数不修改输入，输出是独立快照，重复评估确定性', () => {
  const i = input();
  const before = structuredClone(i);
  const first = evaluateDiagnostic(i);
  assert.deepEqual(i, before);
  assert.deepEqual(first, evaluateDiagnostic(i));
  first.scope.store = 'changed';
  first.evidence[0].metrics.clicks = 999;
  first.actions[0].gates[0].reason = 'changed';
  assert.deepEqual(i, before);
});

test('scope 要求店铺站点币种时区日期及 SKU 或 ASIN', () => {
  for (const field of ['store', 'marketplace', 'currency', 'timezone', 'startDate', 'endDate']) {
    const i = input(); delete i.scope[field];
    assert.throws(() => evaluateDiagnostic(i), new RegExp(field));
  }
  const i = input(); delete i.scope.sku; delete i.scope.asin;
  assert.throws(() => evaluateDiagnostic(i), /sku 或 asin/);
  for (const field of ['sku', 'asin']) {
    const j = input(); delete j.scope[field];
    if (field === 'sku') j.actions[0].object = { type: 'asin', id: j.scope.asin };
    assert.equal(evaluateDiagnostic(j).recommendations.length, 1);
  }
});

test('拒绝无效日历日期、倒置时间范围、坏时区及取数时间', () => {
  for (const date of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-01', 'tomorrow']) {
    const i = input(); i.scope.startDate = date;
    assert.throws(() => evaluateDiagnostic(i), /日期/);
  }
  const reversed = input(); reversed.scope.startDate = '2026-10-15';
  assert.throws(() => evaluateDiagnostic(reversed), /startDate/);
  const timezone = input(); timezone.scope.timezone = 'Mars/Somewhere';
  assert.throws(() => evaluateDiagnostic(timezone), /时区/);
  for (const time of ['2026-02-30T12:00:00Z', '2026-10-20T25:00:00Z', '2026-10-20T12:00:00', '2026-10-20T12:00:00+01:99']) {
    const i = input(); i.evidence[0].fetchedAt = time;
    assert.throws(() => evaluateDiagnostic(i), /取数时间/);
  }
});

test('严格拒绝未知字段、未知 ownerModule、阶段自动猜测、精确写入 payload', () => {
  for (const mutate of [
    (i) => { i.extra = true; }, (i) => { i.scope.account = 'other'; },
    (i) => { i.actions[0].ownerModule = 'unknown-module'; },
    (i) => { i.goal.ageMonths = 12; }, (i) => { i.goal.confirmed = true; },
    (i) => { i.actions[0].writePayload = { bid: 1.5 }; },
    (i) => { i.scope.asin += '\n'; },
    (i) => { i.scope.currency += '\n'; },
    (i) => { i.executionAuthorized = true; },
  ]) { const i = input(); mutate(i); assert.throws(() => evaluateDiagnostic(i)); }
});

test('缺失指标不是零，缺失门禁自动补未知', () => {
  const i = input(); i.actions[0].gates = [];
  const result = evaluateDiagnostic(i);
  assert.equal(result.recommendations.length, 0);
  for (const name of ['economics', 'eligibility', 'inventory_cash', 'demand_window']) {
    assert.equal(getGate(result, name).status, 'unknown');
  }
  // 样本证据也计入归属/质量门禁，不丢弃其引用；这不能补足缺失的业务门禁。
  assert.equal(getGate(result, 'data_ownership').status, 'satisfied');
  assert.ok(getGate(result, 'data_ownership').evidenceIds.includes('report'));
  delete i.sampleCheck;
  assert.equal(evaluateDiagnostic(i).sampleCheck.clicks, null);
});

test('跨店铺、站点、币种、时区、商品、日期证据均阻断扩量', () => {
  const mismatches = { store: 'store-b', marketplace: 'CA', currency: 'CAD', timezone: 'UTC', sku: 'sku-b', asin: 'B000000002', startDate: '2026-09-01', endDate: '2026-10-15' };
  for (const [key, value] of Object.entries(mismatches)) {
    const i = input(); i.evidence[0].scope[key] = value;
    const result = evaluateDiagnostic(i);
    assert.equal(result.recommendations.length, 0, key);
    assert.equal(getGate(result, 'data_ownership').status, 'unknown', key);
    assert.ok(result.evidenceAssessments[0].issues.some((s) => s.includes(key)));
  }
});

test('覆盖缺失、分页遗漏或未知都不能按 0 或完整处理', () => {
  for (const [key, values] of Object.entries({ coverage: ['partial', 'unknown'], pagination: ['incomplete', 'unknown'] })) {
    for (const value of values) {
      const i = input(); i.evidence[0][key] = value;
      const result = evaluateDiagnostic(i);
      assert.equal(result.recommendations.length, 0);
      assert.equal(getGate(result, 'evidence_quality').status, 'unknown');
    }
  }
});

test('推断、估算、模拟、未知证据不能伪装事实放行', () => {
  for (const kind of ['inference', 'estimate', 'simulation', 'unknown']) {
    const i = input(); i.evidence[0].kind = kind;
    const result = evaluateDiagnostic(i);
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.evidenceAssessments[0].kind, kind);
    assert.equal(getGate(result, 'economics').status, 'unknown');
  }
});

test('2 点击 1 单的 CVR 再高也不得放量，即使调用者自行声称样本门禁已满足', () => {
  const i = input(); i.evidence[0].metrics = { clicks: 2, orders: 1 };
  i.sampleCheck.policy.minClicks = 1; i.sampleCheck.policy.minOrders = 1;
  i.actions[0].gates.push(gate('sample_attribution'));
  const result = evaluateDiagnostic(i);
  assert.equal(result.sampleCheck.cvr, 0.5);
  assert.equal(result.sampleCheck.status, 'unmet');
  assert.equal(getGate(result, 'sample_attribution').status, 'unmet');
  assert.equal(result.recommendations.length, 0);
});

test('没有内置 20/30 点击充分阈值：较小样本可满足所供规则，大样本缺依据仍未知', () => {
  const i = input(); i.evidence[0].metrics = { clicks: 12, orders: 3 };
  i.sampleCheck.policy.minClicks = 10; i.sampleCheck.policy.minOrders = 3;
  assert.equal(evaluateDiagnostic(i).sampleCheck.status, 'satisfied');
  i.evidence[0].metrics = { clicks: 10000, orders: 1000 };
  delete i.sampleCheck.policy;
  assert.equal(evaluateDiagnostic(i).sampleCheck.status, 'unknown');
  i.sampleCheck.policy = { basis: '来源未引用', evidenceIds: [], minClicks: 30, minOrders: 2 };
  assert.equal(evaluateDiagnostic(i).sampleCheck.status, 'unknown');
});

test('样本阈值必须有明确依据和真实可用的证据引用', () => {
  for (const mutate of [
    (i) => { i.sampleCheck.policy.basis = ''; },
    (i) => { i.sampleCheck.policy.minClicks = 0; },
    (i) => { i.sampleCheck.policy.minOrders = -1; },
  ]) { const i = input(); mutate(i); assert.throws(() => evaluateDiagnostic(i)); }
  for (const mutate of [
    (i) => { i.sampleCheck.policy.evidenceIds = ['not-found']; },
    (i) => { i.evidence[1].kind = 'simulation'; },
    (i) => { i.evidence[1].scope.currency = 'EUR'; },
    (i) => { i.sampleCheck.policy.minClicks = 101; },
  ]) { const i = input(); mutate(i); assert.notEqual(evaluateDiagnostic(i).sampleCheck.status, 'satisfied'); }
});

test('样本指标未知保留 null，已知 0 保留 0；不接收字符串、负数和布尔值', () => {
  const i = input(); delete i.evidence[0].metrics.orders;
  let sample = evaluateDiagnostic(i).sampleCheck;
  assert.equal(sample.orders, null); assert.equal(sample.status, 'unknown'); assert.equal(sample.cvr, null);
  i.evidence[0].metrics.orders = 0;
  sample = evaluateDiagnostic(i).sampleCheck;
  assert.equal(sample.orders, 0); assert.equal(sample.cvr, 0); assert.equal(sample.status, 'unmet');
  for (const value of [null, '0', -1, NaN, Infinity, false, 1.5]) {
    i.evidence[0].metrics.orders = value;
    assert.throws(() => evaluateDiagnostic(i));
  }
});

test('归因未成熟或未知时不放行，not_applicable 也不能跳过样本归因', () => {
  for (const attribution of ['immature', 'unknown', 'not_applicable']) {
    const i = input(); i.evidence[0].attribution = attribution;
    if (attribution === 'not_applicable') i.evidence[0].attributionReason = '此报表不含归因字段';
    const result = evaluateDiagnostic(i);
    assert.equal(result.sampleCheck.status, 'unknown');
    assert.equal(result.recommendations.length, 0);
  }
});

test('所有不适用声明须理由；核心硬门禁不能不适用跳过', () => {
  for (const field of ['pagination', 'attribution']) {
    const i = input(); i.evidence[0][field] = 'not_applicable';
    assert.throws(() => evaluateDiagnostic(i), /必须提供理由/);
  }
  const noReason = input(); noReason.actions[0].gates[0] = { ...gate('economics', 'not_applicable'), reason: ' ' };
  assert.throws(() => evaluateDiagnostic(noReason), /字符串/);
  for (const name of ['economics', 'eligibility', 'data_ownership', 'evidence_quality', 'goal_confirmed', 'inventory_cash', 'sample_attribution']) {
    const i = input(); i.actions[0].gates = i.actions[0].gates.filter((g) => g.name !== name);
    i.actions[0].gates.push(gate(name, 'not_applicable'));
    const result = evaluateDiagnostic(i);
    assert.equal(getGate(result, name).status, 'unknown', name);
    assert.equal(result.recommendations.length, 0, name);
  }
});

test('适用性允许有完整证据和理由的窗口不适用，无依据不能跳过', () => {
  const i = input(); const g = i.actions[0].gates.find((g) => g.name === 'demand_window');
  g.status = 'not_applicable'; g.reason = '所供销售窗口评估表明确该产品无限定活动窗口';
  assert.equal(evaluateDiagnostic(i).recommendations.length, 1);
  g.evidenceIds = [];
  assert.equal(getGate(evaluateDiagnostic(i), 'demand_window').status, 'unknown');
});

test('目标确认与经营目标分离，不自动把需求验证转为扩量', () => {
  for (const confirmation of ['unknown', 'unconfirmed']) {
    const i = input(); i.goal.confirmation = confirmation;
    assert.equal(getGate(evaluateDiagnostic(i), 'goal_confirmed').status, 'unknown');
  }
  for (const objective of ['validate_demand', 'protect_profit', 'clear_inventory']) {
    const i = input(); i.goal.objective = objective;
    assert.equal(getGate(evaluateDiagnostic(i), 'goal_alignment').status, 'unmet');
    assert.equal(evaluateDiagnostic(i).goal.objective, objective);
  }
  const i = input(); i.goal.objective = 'launch';
  assert.throws(() => evaluateDiagnostic(i), /objective/);
});

test('调用者显式未知/未满足的自动门禁不能被输入完整而升级', () => {
  for (const name of ['goal_confirmed', 'evidence_quality', 'data_ownership', 'sample_attribution']) {
    for (const status of ['unknown', 'unmet']) {
      const i = input(); i.actions[0].gates.push(gate(name, status));
      assert.equal(getGate(evaluateDiagnostic(i), name).status, status);
      assert.equal(evaluateDiagnostic(i).recommendations.length, 0);
    }
  }
});

test('每个动作独立门禁：另一动作合格不能使缺经济性门禁动作放行', () => {
  const i = input(); i.actions.push(action('scale-b'));
  i.actions[1].gates = i.actions[1].gates.filter((g) => g.name !== 'economics');
  const result = evaluateDiagnostic(i);
  assert.deepEqual(result.recommendations.map((a) => a.id), ['scale-a']);
  assert.equal(getGate(result, 'economics', 'scale-b').status, 'unknown');
});

test('硬止损优先于扩量，但只能待核准，不能声称已执行止损', () => {
  const i = input(); i.actions.push({ ...action('stop', 'reduce_exposure'), hardStop: true });
  const result = evaluateDiagnostic(i);
  assert.equal(result.status, 'hard_stop_review');
  assert.equal(result.recommendations[0].id, 'stop');
  assert.equal(getGate(result, 'hard_stop_priority').status, 'unmet');
  assert.equal(result.recommendations[0].executed, false);
  assert.equal(result.recommendations[0].executionAuthorized, false);
  assert.match(result.statusMeaning, /未执行.*不能宣称已止损/);
  const bad = input(); bad.actions[0].hardStop = true;
  assert.throws(() => evaluateDiagnostic(bad), /reduce_exposure/);
});

test('硬止损自身因未知门禁暂缓时也阻断扩量，但不自动停投', () => {
  const i = input(); const stop = { ...action('stop', 'reduce_exposure'), hardStop: true };
  stop.gates = stop.gates.filter((g) => g.name !== 'eligibility');
  i.actions.push(stop);
  const result = evaluateDiagnostic(i);
  assert.equal(result.recommendations.length, 0);
  assert.equal(evaluated(result, 'stop').status, 'blocked');
  assert.equal(evaluated(result).status, 'blocked');
  assert.equal(getGate(result, 'hard_stop_priority').status, 'unmet');
  assert.equal(result.executed, false); assert.equal(result.executionAuthorized, false);
});

test('需求验证和清库存也需库存现金及需求窗口，验证需独立学习边界', () => {
  for (const intent of ['validate_demand', 'clear_inventory']) {
    const i = input(); i.goal.objective = intent;
    i.actions = [action('operation', intent)];
    for (const name of ['inventory_cash', 'demand_window']) {
      const j = structuredClone(i); j.actions[0].gates = j.actions[0].gates.filter((g) => g.name !== name);
      assert.equal(getGate(evaluateDiagnostic(j), name, 'operation').status, 'unknown');
    }
    if (intent === 'validate_demand') {
      assert.equal(getGate(evaluateDiagnostic(i), 'learning_bounds', 'operation').status, 'unknown');
      i.actions[0].gates.push(gate('learning_bounds', 'not_applicable'));
      assert.equal(getGate(evaluateDiagnostic(i), 'learning_bounds', 'operation').status, 'unknown');
      i.actions[0].gates.pop();
      i.actions[0].gates.push({ ...gate('learning_bounds'), reason: '所供经营者批准记录明确试验总支出和损失边界，仅待人工核准' });
    }
    delete i.sampleCheck;
    assert.equal(evaluateDiagnostic(i).recommendations.length, 1, '需求验证不要求既有成熟样本，但其他门禁必须完整');
  }
});

test('未来取数、报告覆盖晚于取数本地日期不能视为事实完整，now 不准用户输入', () => {
  const i = input(); i.evidence[0].fetchedAt = '2026-11-01T00:00:00Z';
  let result = evaluateDiagnostic(i);
  assert.equal(result.recommendations.length, 0);
  assert.match(result.evidenceAssessments[0].issues.join(' '), /未来/);
  const j = input(); j.evidence[0].fetchedAt = '2026-10-14T01:00:00Z';
  // 洛杉矶此时仍是 10/13；10/14 结束的报表不能被声称为完整。
  result = evaluateDiagnostic(j);
  assert.equal(result.recommendations.length, 0);
  assert.match(result.evidenceAssessments[0].issues.join(' '), /报告结束日期/);
  const forged = input(); forged.now = '2099-01-01T00:00:00Z';
  assert.throws(() => evaluateDiagnostic(forged), /未知字段/);
  assert.throws(() => evaluateAtClock(input(), { now: NaN }), /本地评估时间/);
});

test('最多三个待办，其余及明确 hold 项均留在暂不动清单', () => {
  const i = input(); i.actions = Array.from({ length: 5 }, (_, n) => action(`review-${n}`, 'investigate'));
  i.actions.push(action('hold', 'hold'));
  const result = evaluateDiagnostic(i);
  assert.equal(result.recommendations.length, 3);
  assert.equal(result.deferred.length, 3);
  assert.equal(result.deferred.find((a) => a.id === 'hold').status, 'hold');
  assert.match(result.deferred.find((a) => a.id === 'review-4').deferredReason, /最多推荐 3/);
});

test('不重复 ID、不重复门禁、不引用不存在的证据，不许空动作对象', () => {
  for (const mutate of [
    (i) => { i.evidence.push(evidence()); },
    (i) => { i.actions.push(action()); },
    (i) => { i.actions[0].gates.push(gate('economics')); },
    (i) => { i.actions[0].object.id = ''; },
    (i) => { i.actions[0].object.id = 'sku-b'; },
    (i) => { i.actions[0].gates[0].evidenceIds = ['report', 'report']; },
  ]) { const i = input(); mutate(i); assert.throws(() => evaluateDiagnostic(i)); }
  const i = input(); i.actions[0].gates[0].evidenceIds = ['missing'];
  assert.equal(getGate(evaluateDiagnostic(i), 'economics').status, 'unknown');
});

test('广告活动等具体对象须有匹配对象证据，不能用另一活动代替', () => {
  const i = input(); i.actions[0].object = { type: 'campaign', id: 'campaign-a' };
  assert.equal(getGate(evaluateDiagnostic(i), 'data_ownership').status, 'unknown');
  i.evidence[0].object = { type: 'campaign', id: 'campaign-b' };
  assert.equal(getGate(evaluateDiagnostic(i), 'data_ownership').status, 'unknown');
  i.evidence[0].object.id = 'campaign-a';
  assert.equal(getGate(evaluateDiagnostic(i), 'sample_attribution').status, 'unknown', '阈值依据也需明确对象');
  i.evidence[1].object = { type: 'campaign', id: 'campaign-a' };
  assert.equal(evaluateDiagnostic(i).recommendations.length, 1);
  i.evidence.push({ ...evidence('other-campaign'), object: { type: 'campaign', id: 'campaign-b' } });
  i.actions[0].gates[0].evidenceIds.push('other-campaign');
  assert.equal(getGate(evaluateDiagnostic(i), 'data_ownership').status, 'unknown', '即使一份证据匹配，也不能混入另一对象的证据');
});

test('逐动作核验样本对象，B活动100点击10单不能为A活动2点击1单放行', () => {
  const i = input();
  const a = { ...evidence('sample-a'), object: { type: 'campaign', id: 'campaign-a' }, metrics: { clicks: 2, orders: 1 } };
  const b = { ...evidence('sample-b'), object: { type: 'campaign', id: 'campaign-b' }, metrics: { clicks: 100, orders: 10 } };
  i.evidence = [a, b];
  i.sampleCheck = { evidenceId: 'sample-b', policy: { basis: 'B活动所供实验规则', evidenceIds: ['sample-b'], minClicks: 80, minOrders: 5 } };
  i.actions[0].object = a.object;
  i.actions[0].gates.forEach((g) => { g.evidenceIds = ['sample-a']; });
  const onlyA = evaluateDiagnostic(i);
  assert.equal(onlyA.recommendations.length, 0);
  assert.equal(getGate(onlyA, 'sample_attribution').status, 'unknown');
  assert.equal(getGate(onlyA, 'data_ownership').status, 'unknown');
  assert.ok(getGate(onlyA, 'data_ownership').evidenceIds.includes('sample-b'));
  assert.equal(evaluated(onlyA).sampleCheck.status, 'unknown');

  const actionB = action('scale-b'); actionB.object = b.object;
  actionB.gates.forEach((g) => { g.evidenceIds = ['sample-b']; });
  i.actions.push(actionB);
  const both = evaluateDiagnostic(i);
  assert.deepEqual(both.recommendations.map((a) => a.id), ['scale-b']);
  assert.equal(getGate(both, 'sample_attribution', 'scale-a').status, 'unknown');
  assert.equal(getGate(both, 'sample_attribution', 'scale-b').status, 'satisfied');

  i.sampleCheck.evidenceId = 'sample-a';
  i.sampleCheck.policy.evidenceIds = ['sample-a'];
  const ownSmallSample = evaluateDiagnostic(i);
  assert.equal(getGate(ownSmallSample, 'sample_attribution', 'scale-a').status, 'unmet');
});

test('SKU或ASIN可使用同scope样本，但阈值引用跨具体对象不可为活动放行', () => {
  for (const type of ['sku', 'asin']) {
    const i = input(); i.actions[0].object = { type, id: i.scope[type] };
    i.evidence[0].object = { type: 'campaign', id: 'campaign-b' };
    assert.equal(evaluateDiagnostic(i).recommendations.length, 1);
  }
  const i = input(); i.actions[0].object = { type: 'campaign', id: 'campaign-a' };
  i.evidence[0].object = { type: 'campaign', id: 'campaign-a' };
  i.evidence[1].object = { type: 'campaign', id: 'campaign-b' };
  const result = evaluateDiagnostic(i);
  assert.equal(result.recommendations.length, 0);
  assert.equal(getGate(result, 'sample_attribution').status, 'unknown');
  assert.equal(getGate(result, 'data_ownership').status, 'unknown');
});

test('共享、未知及缺少单品隔离声明的绩效仅保留，不能成为放行样本', () => {
  for (const productAttribution of ['shared', 'unknown', undefined]) {
    const i = input();
    if (productAttribution === undefined) delete i.evidence[0].productAttribution;
    else i.evidence[0].productAttribution = productAttribution;
    const result = evaluateDiagnostic(i);
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.evidenceAssessments[0].usable, false);
    assert.equal(result.sampleCheck.status, 'unknown');
    assert.equal(getGate(result, 'sample_attribution').status, 'unknown');
    assert.match(result.sampleCheck.reason, /单.*SKU\/ASIN/);
    assert.equal(result.evidence[0].metrics.clicks, 100, '原始聚合绩效仍保留，不改成0');
    if (productAttribution === 'shared') assert.match(result.sampleCheck.reason, /共享广告组/);
  }
  const bad = input(); bad.evidence[0].productAttribution = 'verified';
  assert.throws(() => evaluateDiagnostic(bad), /productAttribution/);
});

test('同一广告组的两ASIN聚合数据不能靠各自scope声明变成单品证据', () => {
  for (const asin of ['B000000001', 'B000000002']) {
    const i = input(); i.scope.asin = asin;
    i.actions[0].object = { type: 'asin', id: asin };
    for (const e of i.evidence) e.scope.asin = asin;
    i.evidence[0].object = { type: 'ad_group', id: 'shared-group' };
    i.evidence[0].productAttribution = 'shared';
    const result = evaluateDiagnostic(i);
    assert.equal(result.evidenceAssessments[0].scopeMatches, true, '声明同scope不证明绩效隔离');
    assert.equal(result.recommendations.length, 0);
    assert.equal(getGate(result, 'evidence_quality').status, 'unknown');
    assert.equal(getGate(result, 'sample_attribution').status, 'unknown');
    assert.match(result.sampleCheck.reason, /聚合绩效不能代表单/);
  }
});

test('不带绩效metrics的库存成本证据可不提供productAttribution，历史输入兼容', () => {
  const i = input(); delete i.evidence[1].metrics; delete i.evidence[1].productAttribution;
  assert.equal(evaluateDiagnostic(i).recommendations.length, 1);
  delete i.evidence[0].metrics; delete i.evidence[0].productAttribution;
  const result = evaluateDiagnostic(i);
  assert.equal(result.evidenceAssessments[0].usable, true);
  assert.equal(result.sampleCheck.status, 'unknown', '未提供样本仍是未知，而非零或抛错');
});

test('空数据合法但不臆造结论，未知 gate 和自定义附加门禁也须满足', () => {
  const i = input(); i.actions = []; i.evidence = []; delete i.sampleCheck;
  const result = evaluateDiagnostic(i);
  assert.equal(result.status, 'insufficient_evidence'); assert.deepEqual(result.recommendations, []);
  const j = input(); j.actions[0].gates.push(gate('business_review', 'unknown', []));
  assert.equal(evaluateDiagnostic(j).recommendations.length, 0);
});

test('拒绝循环、过深、过大及非 JSON 值，即使 MCP 不做 schema 校验', () => {
  const cycle = input(); cycle.scope.loop = cycle;
  assert.throws(() => evaluateDiagnostic(cycle), /循环/);
  const deep = input(); let v = deep;
  for (let i = 0; i < 15; i++) { v.child = {}; v = v.child; }
  assert.throws(() => evaluateDiagnostic(deep), /过深/);
  const big = input(); big.actions = Array.from({ length: 201 }, (_, n) => action(String(n)));
  assert.throws(() => evaluateDiagnostic(big), /过大/);
  const long = input(); long.actions[0].reason = 'x'.repeat(4097);
  assert.throws(() => evaluateDiagnostic(long), /过长/);
  for (const value of [undefined, () => {}, new Date(), new Map()]) {
    const i = input(); i.bad = value;
    assert.throws(() => evaluateDiagnostic(i));
  }
});

test('仅SKU范围也须隔离同店站SKU的跨ASIN映射冲突，但ASIN允许多个SKU', () => {
  const i = input(); delete i.scope.asin;
  i.evidence[1].scope.asin = 'B000000002';
  const result = evaluateDiagnostic(i);
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.sampleCheck.status, 'unknown');
  assert.equal(getGate(result, 'data_ownership').status, 'unknown');
  for (const e of result.evidenceAssessments) {
    assert.equal(e.usable, false);
    assert.match(e.issues.join(' '), /SKU→ASIN 映射冲突/);
  }
  const j = input(); delete j.scope.sku;
  j.actions[0].object = { type: 'asin', id: j.scope.asin };
  j.evidence[1].scope.sku = 'sku-b';
  assert.equal(evaluateDiagnostic(j).recommendations.length, 1, '同ASIN多SKU不是映射冲突');
  for (const key of ['store', 'marketplace']) {
    const k = input(); delete k.scope.asin;
    const unrelated = evidence('unrelated'); unrelated.scope.asin = 'B000000002'; unrelated.scope[key] = 'other';
    k.evidence.push(unrelated);
    assert.equal(evaluateDiagnostic(k).recommendations.length, 1, '不同店站未引用的SKU映射不污染当前商品');
  }
});

test('需求验证必须与已确认需求验证目标一致，不隐式切换其他目标', () => {
  const i = input(); i.actions = [action('learn', 'validate_demand')];
  i.actions[0].gates.push(gate('learning_bounds'));
  for (const objective of ['protect_profit', 'clear_inventory', 'scale_validated']) {
    i.goal.objective = objective;
    const result = evaluateDiagnostic(i);
    assert.equal(result.recommendations.length, 0);
    assert.equal(getGate(result, 'goal_alignment', 'learn').status, 'unmet');
    assert.equal(result.goal.objective, objective);
  }
  i.goal.objective = 'validate_demand';
  assert.equal(evaluateDiagnostic(i).recommendations.length, 1);
  i.goal.confirmation = 'unconfirmed';
  assert.equal(evaluateDiagnostic(i).recommendations.length, 0);
});

test('未解决硬止损阻断新增学习暴露，但不一刀切阻断有门禁的清库存', () => {
  const i = input(); i.goal.objective = 'validate_demand';
  i.actions = [action('learn', 'validate_demand'), { ...action('stop', 'reduce_exposure'), hardStop: true, gates: [] }];
  i.actions[0].gates.push(gate('learning_bounds'));
  const result = evaluateDiagnostic(i);
  assert.equal(result.status, 'hard_stop_review');
  assert.equal(result.recommendations.length, 0);
  assert.equal(evaluated(result, 'stop').status, 'blocked');
  assert.equal(evaluated(result, 'learn').status, 'blocked');
  assert.equal(getGate(result, 'hard_stop_priority', 'learn').status, 'unmet');
  i.goal.objective = 'clear_inventory'; i.actions[0] = action('clear', 'clear_inventory');
  assert.deepEqual(evaluateDiagnostic(i).recommendations.map((a) => a.id), ['clear']);
  for (const name of ['economics', 'inventory_cash']) {
    const j = structuredClone(i); j.actions[0].gates = j.actions[0].gates.filter((g) => g.name !== name);
    assert.equal(evaluateDiagnostic(j).recommendations.length, 0, name);
  }
});

test('低年份日期按四位比较并拒绝0000，含跨公元边界的本地取数日期', () => {
  const i = input(); i.scope.startDate = i.scope.endDate = '0999-12-31';
  for (const e of i.evidence) { e.scope = { ...i.scope }; e.fetchedAt = '0999-01-01T00:00:00Z'; }
  const result = evaluateDiagnostic(i);
  assert.equal(result.recommendations.length, 0);
  assert.ok(result.evidenceAssessments.every((e) => !e.usable && e.issues.some((s) => /报告结束日期/.test(s))));
  for (const mutate of [
    (j) => { j.scope.startDate = '0000-01-01'; },
    (j) => { j.evidence[0].scope.startDate = '0000-01-01'; },
    (j) => { j.evidence[0].fetchedAt = '0000-01-01T00:00:00Z'; },
  ]) { const j = input(); mutate(j); assert.throws(() => evaluateDiagnostic(j), /日期|取数时间/); }
  const j = input(); j.scope.startDate = j.scope.endDate = '0001-01-01'; j.scope.timezone = 'Etc/GMT+1';
  for (const e of j.evidence) { e.scope = { ...j.scope }; e.fetchedAt = '0001-01-01T00:00:00Z'; }
  assert.ok(evaluateDiagnostic(j).evidenceAssessments.every((e) => !e.usable));
  for (const e of j.evidence) e.fetchedAt = '0001-01-02T12:00:00Z';
  assert.equal(evaluateDiagnostic(j).recommendations.length, 1, '支持0001年正常时间而非全量拒绝早期年份');
});

test('诊断文本拒绝首尾空白与非JSON控制字符，保留内部常规空格及换行', () => {
  for (const value of [' sku-a', 'sku-a ', 'sku-a\n', '\tsku-a', 'sku\u0000a', 'sku\u0008a', 'sku\u000ba', 'sku\u000ca', 'sku\u001fa']) {
    const i = input(); i.scope.sku = value;
    assert.throws(() => evaluateDiagnostic(i), /字符串/, JSON.stringify(value));
  }
  for (const mutate of [
    (i) => { i.actions[0].id = 'id '; },
    (i) => { i.evidence[0].source = '\nreport'; },
    (i) => { i.actions[0].gates[0].reason = 'bad\u0001reason'; },
  ]) { const i = input(); mutate(i); assert.throws(() => evaluateDiagnostic(i), /字符串/); }
  const i = input(); i.actions[0].reason = '允许内部 空格\n以及\t换行';
  assert.equal(evaluateDiagnostic(i).recommendations.length, 1);
});

test('拒绝隐藏toJSON、访问器及非JSON数组字段，校验过程不执行调用者函数', () => {
  let invoked = 0;
  const i = input(); const replacement = structuredClone(i); i.evidence[0].kind = 'simulation';
  Object.defineProperty(i, 'toJSON', { value() { invoked++; return replacement; } });
  assert.throws(() => evaluateDiagnostic(i), /JSON/);
  assert.equal(invoked, 0);
  const j = input(); Object.defineProperty(j.scope, 'store', { enumerable: true, get() { invoked++; return 'store-a'; } });
  assert.throws(() => evaluateDiagnostic(j), /JSON/);
  assert.equal(invoked, 0);
  for (const mutate of [
    (k) => { k[Symbol('hidden')] = true; },
    (k) => { k.actions.extra = true; },
    (k) => { Object.setPrototypeOf(k.actions, { toJSON() { invoked++; return []; } }); },
  ]) { const k = input(); mutate(k); assert.throws(() => evaluateDiagnostic(k), /JSON/); }
  assert.equal(invoked, 0);
  const k = input(); k.scope = Object.assign(Object.create(null), k.scope);
  Object.freeze(k.scope);
  assert.equal(evaluateDiagnostic(k).recommendations.length, 1, '普通冻结对象与null原型数据对象仍可用');
});
