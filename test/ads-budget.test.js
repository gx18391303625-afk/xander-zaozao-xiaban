import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdsBudgetOps } from '../lib/ops-ads-budget.js';

// Synthetic contract fixtures only. No credentials, real IDs or network.
const store = { alias: 'fixture', region: 'NA', defaultMarketplace: 'US', ads: { profiles: { US: '900' } } };
const lim = { budgetChangePctMax: 50 };
const details = (name = 'Synthetic schedule') => ({ name, ruleType: 'SCHEDULE', duration: { dateRangeTypeRuleDuration: { startDate: '20300101', endDate: '20300131' } }, recurrence: { type: 'DAILY' }, budgetIncreaseBy: { type: 'PERCENT', value: 20 } });
const portfolio = (name = 'Synthetic portfolio') => ({ name, state: 'ENABLED', budget: { policy: 'MONTHLY_RECURRING', amount: 100, currencyCode: 'USD' } });
function fixture() {
  const state = { calls: [], rules: [], portfolios: [], campaigns: Object.fromEntries(['101', '102', '103'].map((id) => [id, { campaignId: id, name: `Synthetic campaign ${id}`, state: 'ENABLED', portfolioId: null, budgets: [{ recurrenceTimePeriod: 'DAILY' }] }])), associations: { 101: [], 102: [], 103: [] }, fail: null };
  const copy = (v) => structuredClone(v);
  const adsClient = async (alias, method, path, options = {}) => {
    const call = { alias, method, path, ...copy(options) };
    state.calls.push(call);
    assert.equal(options.profileId, '900');
    if (state.fail) { const result = await state.fail(call, state); if (result !== undefined) return result; }
    const body = options.body;
    if (path === '/sp/budgetRules' && method === 'GET') {
      assert.equal(options.query.pageSize, 30);
      const start = Number(options.query.nextToken || 0);
      return { budgetRulesForAdvertiserResponse: copy(state.rules.slice(start, start + 30)), ...(start + 30 < state.rules.length ? { nextToken: String(start + 30) } : {}) };
    }
    if (path === '/sp/budgetRules' && method === 'POST') {
      assert.equal(options.isWrite, true);
      const ruleId = `synthetic-rule-${state.rules.length + 1}`;
      state.rules.push({ ruleId, ruleDetails: copy(body.budgetRulesDetails[0]), ruleState: 'ACTIVE', ruleStatus: 'PENDING' });
      return { responses: [{ code: 'Ok', ruleId }] };
    }
    if (path === '/sp/budgetRules' && method === 'PUT') {
      assert.equal(options.isWrite, true);
      const item = body.budgetRulesDetails[0];
      Object.assign(state.rules.find((r) => r.ruleId === item.ruleId), copy(item));
      return { responses: [{ code: 'Ok', ruleId: item.ruleId }] };
    }
    const related = path.match(/^\/sp\/budgetRules\/([^/]+)\/campaigns$/);
    if (related) return { associatedCampaigns: Object.entries(state.associations).filter(([, ids]) => ids.includes(related[1])).map(([campaignId]) => ({ campaignId, campaignName: state.campaigns[campaignId].name, ruleStatus: 'PENDING' })) };
    const one = path.match(/^\/sp\/budgetRules\/([^/]+)$/);
    if (one) return { budgetRule: copy(state.rules.find((r) => r.ruleId === one[1])) };
    const assoc = path.match(/^\/sp\/campaigns\/(\d+)\/budgetRules(?:\/([^/]+))?$/);
    if (assoc) {
      const [, id, ruleId] = assoc;
      if (method === 'GET') return { associatedRules: copy(state.rules.filter((r) => state.associations[id].includes(r.ruleId))) };
      assert.equal(options.isWrite, true);
      if (method === 'DELETE') { state.associations[id] = state.associations[id].filter((r) => r !== ruleId); return {}; }
      state.associations[id].push(body.budgetRuleIds[0]);
      return { responses: [{ code: 'Ok', ruleId: body.budgetRuleIds[0] }] };
    }
    if (path === '/portfolios/list') {
      assert.equal(options.contentType, 'application/vnd.spPortfolio.v3+json');
      return { portfolios: copy(state.portfolios.filter((p) => !body.portfolioIdFilter || body.portfolioIdFilter.include.includes(p.portfolioId))) };
    }
    if (path === '/portfolios') {
      assert.equal(options.contentType, 'application/vnd.spPortfolio.v3+json');
      assert.equal(options.isWrite, true);
      const input = body.portfolios[0];
      const id = method === 'POST' ? `synthetic-portfolio-${state.portfolios.length + 1}` : input.portfolioId;
      if (method === 'POST') state.portfolios.push({ portfolioId: id, ...copy(input) });
      else Object.assign(state.portfolios.find((p) => p.portfolioId === id), copy(input));
      return { portfolios: { success: [{ index: 0, portfolioId: id }], error: [] } };
    }
    if (path === '/sd/campaigns') return copy(Object.values(state.campaigns).filter((c) => c.adProduct === 'SPONSORED_DISPLAY' && c.portfolioId === options.query.portfolioIdFilter).slice(options.query.startIndex, options.query.startIndex + options.query.count));
    if (path === '/adsApi/v1/query/campaigns') return { campaigns: copy(Object.values(state.campaigns).filter((c) => body.adProductFilter.include.includes(c.adProduct || 'SPONSORED_PRODUCTS') && (!body.campaignIdFilter || body.campaignIdFilter.include.includes(c.campaignId)) && (!body.portfolioIdFilter || body.portfolioIdFilter.include.includes(c.portfolioId)))) };
    if (path === '/adsApi/v1/update/campaigns') {
      assert.equal(options.isWrite, true);
      Object.assign(state.campaigns[body.campaigns[0].campaignId], copy(body.campaigns[0]));
      return { success: [{ index: 0, campaign: copy(state.campaigns[body.campaigns[0].campaignId]) }], error: [] };
    }
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  };
  const [rules, portfolios] = createAdsBudgetOps({ adsClient });
  return { state, rules, portfolios };
}
async function prepare(op, c) {
  const r = await op.read(store, c);
  const { newValue } = op.check(c, r, lim);
  return { r, value: newValue, request: op.build(c, r, newValue) };
}
async function execute(op, c, options) {
  const p = await prepare(op, c);
  const sent = await op.send(store, p.request, options);
  const rb = await op.readback(store, c, p.value, sent);
  return { ...p, sent, rb };
}
const writes = (s) => s.calls.filter((x) => x.isWrite);

test('SP rule creation uses dedicated schema, checkpoints every step and verifies all associations', async () => {
  const { rules, state } = fixture(), journal = [];
  const c = { action: 'create', ruleDetails: details(), campaignIds: ['102', '101'] };
  const r = await execute(rules, c, { checkpoint: async (x) => journal.push(x) });
  assert.equal(r.sent.ok, true); assert.equal(r.rb.status, 'API_STATE_VERIFIED');
  assert.deepEqual(writes(state).map((x) => [x.method, x.path]), [['POST', '/sp/budgetRules'], ['POST', '/sp/campaigns/101/budgetRules'], ['POST', '/sp/campaigns/102/budgetRules']]);
  assert.deepEqual(writes(state)[0].body, { budgetRulesDetails: [details()] });
  assert.equal(journal[0].steps[0].status, 'SUBMITTING');
  assert.deepEqual(journal[1].createdIds, ['synthetic-rule-1']);
  assert.equal(journal.at(-1).status, 'SUBMITTED');
  assert.equal(r.rb.actual.ruleStatus, 'PENDING', 'API config verification does not claim the rule triggered');
});

test('SP update preserves server-owned fields and shows all affected campaigns', async () => {
  const { rules, state } = fixture();
  await execute(rules, { action: 'create', ruleDetails: details(), campaignIds: ['101'] });
  const c = { action: 'update', ruleId: 'synthetic-rule-1', ruleState: 'PAUSED' };
  const r = await execute(rules, c);
  assert.equal(r.rb.match, true);
  assert.deepEqual(r.value.affectedCampaigns, [{ campaignId: '101', campaignName: 'Synthetic campaign 101' }]);
  assert.deepEqual(writes(state).at(-1).body, { budgetRulesDetails: [{ ruleId: 'synthetic-rule-1', ruleState: 'PAUSED' }] });
  assert.deepEqual(state.rules[0].ruleDetails, details());
});

test('existing SP rules can associate and disassociate independently', async () => {
  const { rules, state } = fixture();
  await execute(rules, { action: 'create', ruleDetails: details() });
  assert.equal((await execute(rules, { action: 'associate', ruleId: 'synthetic-rule-1', campaignIds: ['101'] })).rb.match, true);
  const r = await execute(rules, { action: 'disassociate', ruleId: 'synthetic-rule-1', campaignIds: ['101'] });
  assert.equal(r.rb.match, true); assert.deepEqual(state.associations[101], []);
  assert.equal(writes(state).at(-1).method, 'DELETE');
});

test('partial association failure retains created rule and successful earlier links', async () => {
  const { rules, state } = fixture();
  state.fail = (call) => call.path === '/sp/campaigns/102/budgetRules' && call.method === 'POST' ? { responses: [{ code: 'INVALID_ARGUMENT', details: 'Synthetic ineligible campaign', ruleId: 'synthetic-rule-1' }] } : undefined;
  const r = await execute(rules, { action: 'create', ruleDetails: details(), campaignIds: ['101', '102', '103'] });
  assert.equal(r.sent.status, 'PARTIALLY_SUCCEEDED'); assert.equal(r.rb.status, 'PARTIALLY_SUCCEEDED');
  assert.equal(r.rb.reconciled, true, 'all attempted steps have definite receipts and successful state matches');
  assert.deepEqual(r.sent.createdIds, ['synthetic-rule-1']);
  assert.deepEqual(state.associations[101], ['synthetic-rule-1']); assert.deepEqual(state.associations[103], []);
  assert.equal(writes(state).length, 3, 'do not continue or compensate after failure');
  await rules.readback(store, { action: 'create' }, r.value, r.sent);
  assert.equal(writes(state).length, 3, 'verification never resubmits');
});

test('create 5xx without receipt ID keeps identical candidates unknown and never posts again', async () => {
  const { rules, state } = fixture();
  state.fail = (call) => {
    if (call.path !== '/sp/budgetRules' || call.method !== 'POST') return;
    state.rules.push({ ruleId: 'recovered-rule', ruleState: 'ACTIVE', ruleDetails: structuredClone(call.body.budgetRulesDetails[0]) });
    throw Object.assign(new Error('Synthetic 503 after apply'), { sent: true });
  };
  const r = await execute(rules, { action: 'create', ruleDetails: details() });
  assert.equal(r.sent.status, 'OUTCOME_UNKNOWN'); assert.equal(r.rb.status, 'OUTCOME_UNKNOWN');
  assert.equal(r.rb.actual.candidates[0].ruleId, 'recovered-rule');
  assert.equal(r.rb.reconciled, false, 'the candidate could be an external concurrent creation');
  assert.equal(writes(state).length, 1);
});

test('unknown creation absent or ambiguous remains unknown; no new request', async () => {
  const { rules, state } = fixture();
  state.fail = (call) => { if (call.isWrite) throw Object.assign(new Error('Synthetic timeout'), { sent: true }); };
  const r = await execute(rules, { action: 'create', ruleDetails: details() });
  assert.equal(r.rb.status, 'OUTCOME_UNKNOWN'); assert.equal(writes(state).length, 1);
  state.rules.push({ ruleId: 'a', ruleDetails: details() }, { ruleId: 'b', ruleDetails: details() });
  assert.equal((await rules.readback(store, {}, r.value, r.sent)).status, 'OUTCOME_UNKNOWN');
  assert.equal(writes(state).length, 1);
});

test('empty or malformed 207 is outcome unknown, never a success', async () => {
  const { rules, portfolios, state } = fixture();
  state.fail = (call) => call.isWrite ? {} : undefined;
  for (const [op, c] of [[rules, { action: 'create', ruleDetails: details() }], [portfolios, { action: 'create', portfolio: portfolio() }]]) {
    const p = await prepare(op, c); const sent = await op.send(store, p.request);
    assert.equal(sent.ok, false); assert.equal(sent.status, 'OUTCOME_UNKNOWN');
  }
});

test('full pagination finds duplicate SP rule on page two', async () => {
  const { rules, state } = fixture();
  state.rules = Array.from({ length: 31 }, (_, i) => ({ ruleId: String(i), ruleDetails: details(i === 30 ? 'Synthetic schedule' : `Other ${i}`) }));
  await assert.rejects(prepare(rules, { action: 'create', ruleDetails: details() }), /同名/);
  assert.equal(state.calls.filter((x) => x.path === '/sp/budgetRules').length, 2); assert.equal(writes(state).length, 0);
});

test('repeating or incomplete pagination fails closed before creating', async () => {
  const { rules, state } = fixture();
  state.fail = (call) => call.path === '/sp/budgetRules' ? { budgetRulesForAdvertiserResponse: [], nextToken: 'again' } : undefined;
  await assert.rejects(prepare(rules, { action: 'create', ruleDetails: details() }), /分页令牌重复/);
  assert.equal(writes(state).length, 0);
});

test('rules validate safety limits, dates, fields, performance and regional schedule scope', async () => {
  const { rules } = fixture();
  const cases = [
    [{ ...details(), budgetIncreaseBy: { type: 'PERCENT', value: 51 } }, /安全上限/],
    [{ ...details(), duration: { dateRangeTypeRuleDuration: { startDate: '20300231' } } }, /无效日期/],
    [{ ...details(), recurrence: { type: 'WEEKLY', daysOfWeek: ['MONDAY'] } }, /不支持字段|DAILY/],
    [{ ...details(), surprise: true }, /不支持字段/],
    [{ ...details(), ruleType: 'PERFORMANCE', performanceMeasureCondition: { metricName: 'IS', comparisonOperator: 'GREATER_THAN', threshold: 20 } }, /绩效指标/],
  ];
  for (const [ruleDetails, pattern] of cases) await assert.rejects(prepare(rules, { action: 'create', ruleDetails }), pattern);
  const good = { ...details(), ruleType: 'PERFORMANCE', performanceMeasureCondition: { metricName: 'ACOS', comparisonOperator: 'LESS_THAN', threshold: 20 } };
  assert.equal((await prepare(rules, { action: 'create', ruleDetails: good })).value.ruleDetails.ruleType, 'PERFORMANCE');
  const r = await rules.read(store, { action: 'create', ruleDetails: details() });
  assert.throws(() => rules.check({ action: 'create', ruleDetails: { ...details(), recurrence: { type: 'DAILY', intraDaySchedule: [{ startTime: '17:00:00', endTime: '22:00:00' }] } } }, { ...r, marketplace: 'DE' }, lim), /仅支持/);
});

test('portfolio create + SP assignment uses v3 media and nested receipt', async () => {
  const { portfolios, state } = fixture();
  const r = await execute(portfolios, { action: 'create', portfolio: portfolio(), campaignIds: ['101'] });
  assert.equal(r.rb.match, true); assert.equal(state.campaigns[101].portfolioId, 'synthetic-portfolio-1');
  assert.deepEqual(writes(state)[0].body, { portfolios: [portfolio()] });
  assert.deepEqual(writes(state)[1].body, { campaigns: [{ campaignId: '101', portfolioId: 'synthetic-portfolio-1' }] });
});

test('portfolio updates and explicit NO_CAP use exact approved values', async () => {
  const { portfolios, state } = fixture();
  await execute(portfolios, { action: 'create', portfolio: portfolio(), campaignIds: ['101'] });
  const c = { action: 'update', portfolioId: 'synthetic-portfolio-1', portfolio: { budget: { policy: 'NO_CAP', currencyCode: 'USD' } } };
  const r = await execute(portfolios, c);
  assert.equal(r.rb.match, true); assert.equal(r.value.affectedSPCampaigns.length, 1);
  assert.deepEqual(state.portfolios[0].budget, { policy: 'NO_CAP', currencyCode: 'USD', amount: null, startDate: null, endDate: null });
  assert.equal(state.portfolios[0].name, 'Synthetic portfolio');
});

test('portfolio approval lists SP, SB and SD; changed membership prevents verification', async () => {
  const { portfolios, state } = fixture();
  await execute(portfolios, { action: 'create', portfolio: portfolio(), campaignIds: ['101'] });
  const id = 'synthetic-portfolio-1';
  state.campaigns['201'] = { campaignId: '201', adProduct: 'SPONSORED_BRANDS', name: 'Synthetic SB', state: 'ENABLED', portfolioId: id };
  state.campaigns['301'] = { campaignId: '301', adProduct: 'SPONSORED_DISPLAY', name: 'Synthetic SD', state: 'enabled', portfolioId: id };
  const c = { action: 'update', portfolioId: id, portfolio: { budget: { ...portfolio().budget, amount: 110 } } };
  const p = await prepare(portfolios, c);
  assert.deepEqual(p.value.affectedCampaigns.map((x) => x.adProduct), ['SB', 'SD', 'SP']);
  const sent = await portfolios.send(store, p.request);
  state.campaigns['302'] = { campaignId: '302', adProduct: 'SPONSORED_DISPLAY', name: 'External new SD', state: 'enabled', portfolioId: id };
  const rb = await portfolios.readback(store, c, p.value, sent);
  assert.equal(rb.match, false); assert.equal(rb.reconciled, false);
  assert.equal(rb.actual.affectedCampaigns.length, 4);
});

test('portfolio cap edit fails before a proposal when full SB/SD scope is inaccessible', async () => {
  const { portfolios, state } = fixture();
  await execute(portfolios, { action: 'create', portfolio: portfolio() });
  const before = writes(state).length;
  state.fail = (call) => { if (call.path === '/sd/campaigns') throw Object.assign(new Error('Synthetic SD permission denied'), { sent: false }); };
  await assert.rejects(prepare(portfolios, { action: 'update', portfolioId: 'synthetic-portfolio-1', portfolio: { budget: { ...portfolio().budget, amount: 110 } } }), /permission denied/);
  assert.equal(writes(state).length, before);
});

test('portfolio move and removal through nullable unified campaign portfolioId', async () => {
  const { portfolios, state } = fixture();
  await execute(portfolios, { action: 'create', portfolio: portfolio() });
  await execute(portfolios, { action: 'assign', portfolioId: 'synthetic-portfolio-1', campaignIds: ['101'] });
  const r = await execute(portfolios, { action: 'assign', portfolioId: null, campaignIds: ['101'] });
  assert.equal(r.rb.match, true); assert.equal(state.campaigns[101].portfolioId, null);
  await assert.rejects(prepare(portfolios, { action: 'assign', campaignIds: ['102'] }), /必须明确/);
});

test('portfolio duplicate and invalid currency cannot produce a write', async () => {
  const { portfolios, state } = fixture();
  state.portfolios.push({ portfolioId: 'existing', ...portfolio() });
  await assert.rejects(prepare(portfolios, { action: 'create', portfolio: portfolio() }), /同名/);
  const wrong = portfolio('New'); wrong.budget.currencyCode = 'EUR';
  await assert.rejects(prepare(portfolios, { action: 'create', portfolio: wrong }), /USD/);
  const bad = portfolio('New'); bad.state = 'ARCHIVED';
  await assert.rejects(prepare(portfolios, { action: 'create', portfolio: bad }), /只支持 ENABLED/);
  assert.equal(writes(state).length, 0);
});

test('portfolio partial assignment is retained and readback does not replay', async () => {
  const { portfolios, state } = fixture();
  state.fail = (call) => call.path === '/adsApi/v1/update/campaigns' ? { success: [], error: [{ index: 0, errors: [{ code: 'INVALID_INPUT', message: 'Synthetic denial' }] }] } : undefined;
  const r = await execute(portfolios, { action: 'create', portfolio: portfolio(), campaignIds: ['101', '102'] });
  assert.equal(r.sent.status, 'PARTIALLY_SUCCEEDED'); assert.equal(r.rb.status, 'PARTIALLY_SUCCEEDED');
  assert.deepEqual(r.sent.createdIds, ['synthetic-portfolio-1']); assert.equal(writes(state).length, 2);
});

test('checkpoint failure before network prevents a write and identity ignores budget changes', async () => {
  const { rules, portfolios, state } = fixture();
  const p = await prepare(rules, { action: 'create', ruleDetails: details() });
  await assert.rejects(rules.send(store, p.request, { checkpoint: async () => { throw new Error('Synthetic disk failure'); } }), /disk failure/);
  assert.equal(writes(state).length, 0);
  assert.deepEqual(rules.creationIdentity({ ruleDetails: details() }), rules.creationIdentity({ ruleDetails: { ...details(), budgetIncreaseBy: { type: 'PERCENT', value: 30 } } }));
  assert.deepEqual(portfolios.creationIdentity({ portfolio: portfolio() }), portfolios.creationIdentity({ portfolio: { ...portfolio(), budget: { amount: 200 } } }));
});

test('unknown association remains unknown if absent even after earlier success', async () => {
  const { rules, state } = fixture();
  state.fail = (call) => { if (call.path === '/sp/campaigns/101/budgetRules' && call.isWrite) throw Object.assign(new Error('Synthetic unknown'), { sent: true }); };
  const r = await execute(rules, { action: 'create', ruleDetails: details(), campaignIds: ['101'] });
  assert.equal(r.sent.status, 'OUTCOME_UNKNOWN'); assert.equal(r.rb.status, 'OUTCOME_UNKNOWN');
  assert.equal(r.rb.reconciled, false, 'an unresolved step must keep the creation lock');
  assert.equal(state.rules.length, 1); assert.equal(writes(state).length, 2);
});
