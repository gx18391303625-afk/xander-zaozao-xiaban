import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';

isolate();
const { createAdsBudgetOps } = await import('../lib/ops-ads-budget.js');
const { OPS } = await import('../lib/ops.js');
const { updateConfig } = await import('../lib/config.js');
const { prepareChange, verifyChange, loadProposal } = await import('../lib/proposals.js');
const { p } = await import('../lib/paths.js');
const { writeJson } = await import('../lib/jsonfile.js');

// Synthetic account and responses only. The client rejects every business write.
const store = { alias: 'synthetic-no-cap', region: 'NA', defaultMarketplace: 'US', ads: { profiles: { US: '900' } } };
const portfolioId = 'synthetic-no-cap-portfolio';
const clearedFields = ['amount', 'startDate', 'endDate'];
const approvedBudget = { policy: 'NO_CAP', currencyCode: 'USD', amount: null, startDate: null, endDate: null };
const products = { SP: 'SPONSORED_PRODUCTS', SB: 'SPONSORED_BRANDS', SD: 'SPONSORED_DISPLAY' };
const change = { action: 'update', portfolioId, portfolio: { budget: { policy: 'NO_CAP', currencyCode: 'USD' } } };
const sent = { ok: true, status: 'SUBMITTED', objectId: portfolioId, createdIds: [], steps: [{ key: 'update', status: 'SUBMITTED', objectId: portfolioId }] };
const scope = [{ adProduct: 'SP', campaignId: '101' }, { adProduct: 'SB', campaignId: '201' }, { adProduct: 'SD', campaignId: '301' }];

function fixture(budget = approvedBudget) {
  const state = {
    portfolio: { portfolioId, name: 'Synthetic portfolio', state: 'ENABLED', budget: structuredClone(budget) },
    scope: structuredClone(scope), calls: [],
  };
  const expected = { action: 'update', portfolioId, campaignIds: [], portfolio: { budget: structuredClone(approvedBudget) }, affectedCampaigns: structuredClone(scope) };
  const adsClient = async (_alias, method, path, options) => {
    state.calls.push({ method, path, options: structuredClone(options) });
    assert.equal(options.profileId, '900');
    assert.notEqual(options.isWrite, true, 'readback must never submit a business write');
    if (method === 'POST' && path === '/portfolios/list') return { portfolios: [structuredClone(state.portfolio)] };
    if (method === 'POST' && path === '/adsApi/v1/query/campaigns') {
      return { campaigns: state.scope.filter((row) => options.body.adProductFilter.include.includes(products[row.adProduct])).map((row) => ({ campaignId: row.campaignId, name: `Synthetic ${row.adProduct}`, state: 'ENABLED', portfolioId })) };
    }
    if (method === 'GET' && path === '/sd/campaigns') return state.scope.filter((row) => row.adProduct === 'SD').map((row) => ({ campaignId: row.campaignId, name: 'Synthetic SD', state: 'enabled', portfolioId }));
    throw new Error(`Unexpected synthetic request: ${method} ${path}`);
  };
  const [, op] = createAdsBudgetOps({ adsClient, profileResolver: () => ({ profileId: '900', code: 'US' }) });
  return { state, expected, op, readback: () => op.readback(store, change, expected, sent) };
}

test('NO_CAP readback accepts every mix of omitted and explicit-null clearing fields without changing evidence', async () => {
  for (let mask = 0; mask < 8; mask++) {
    const budget = { policy: 'NO_CAP', currencyCode: 'USD' };
    clearedFields.forEach((key, index) => { if (mask & (1 << index)) budget[key] = null; });
    const f = fixture(budget);
    const before = structuredClone({ actual: f.state.portfolio, expected: f.expected });
    const result = await f.readback();
    assert.equal(result.match, true, `clearing-field mask ${mask}`);
    assert.equal(result.status, 'API_STATE_VERIFIED');
    assert.equal(result.reconciled, true);
    assert.deepEqual(result.actual.portfolio, before.actual, 'raw omitted fields must stay omitted in persisted evidence');
    assert.deepEqual(f.state.portfolio, before.actual);
    assert.deepEqual(f.expected, before.expected, 'approved values must not be normalized in place');
  }
});

test('NO_CAP residual amounts and dates remain mismatches, including zero and empty strings', async () => {
  for (const [key, value] of [['amount', 75], ['amount', 0], ['amount', ''], ['startDate', '2030-01-01'], ['startDate', ''], ['endDate', '2030-01-31'], ['endDate', '']]) {
    const f = fixture({ policy: 'NO_CAP', currencyCode: 'USD', [key]: value });
    const result = await f.readback();
    assert.equal(result.match, false, `${key}=${JSON.stringify(value)}`);
    assert.equal(result.status, 'AWAITING_READBACK');
    assert.equal(result.reconciled, false);
  }
});

test('NO_CAP still requires the approved policy, currency and other approved portfolio fields', async () => {
  for (const budget of [{ policy: 'MONTHLY_RECURRING', currencyCode: 'USD' }, { policy: 'NO_CAP', currencyCode: 'EUR' }, { currencyCode: 'USD' }, { policy: 'NO_CAP' }, null]) {
    const result = await fixture(budget).readback();
    assert.equal(result.match, false);
    assert.equal(result.reconciled, false);
  }
  const f = fixture({ policy: 'NO_CAP', currencyCode: 'USD' });
  f.expected.portfolio.name = 'Approved synthetic name';
  assert.equal((await f.readback()).match, false);
});

test('NO_CAP readback rejects changed affected campaign IDs or ad products', async () => {
  for (const mutate of [
    (rows) => { rows[1].campaignId = '202'; },
    (rows) => { rows[1].adProduct = 'SP'; },
    (rows) => { rows.pop(); },
    (rows) => { rows.push({ adProduct: 'SB', campaignId: '202' }); },
  ]) {
    const f = fixture({ policy: 'NO_CAP', currencyCode: 'USD' });
    mutate(f.state.scope);
    const result = await f.readback();
    assert.equal(result.match, false);
    assert.equal(result.reconciled, false);
    assert.equal(result.status, 'AWAITING_READBACK');
  }
});

test('nullable fields under capped portfolio policies retain strict comparison', async () => {
  for (const policy of ['MONTHLY_RECURRING', 'DATE_RANGE']) {
    const budget = { policy, currencyCode: 'USD', amount: 100, startDate: '2030-01-01' };
    const f = fixture(budget);
    f.expected.portfolio.budget = { ...budget, endDate: null };
    assert.equal((await f.readback()).match, false, 'null and omission must not become generally equivalent');
    f.state.portfolio.budget.endDate = null;
    assert.equal((await f.readback()).match, true);
  }
});

test('verifyChange reconciles a synthetic previously-submitted NO_CAP proposal without replaying writes', async () => {
  updateConfig((cfg) => { cfg.stores[store.alias] = structuredClone(store); cfg.settings.dryRun = false; });
  const index = OPS.findIndex((op) => op.id === 'ads.portfolio');
  const original = OPS[index];
  try {
    for (const explicitNulls of [false, true]) {
      const f = fixture({ policy: 'MONTHLY_RECURRING', currencyCode: 'USD', amount: 100 });
      OPS[index] = f.op;
      const prepared = await prepareChange({ store: store.alias, changes: [{ op: f.op.id, ...change }] });
      assert.equal(prepared.ok, true);
      const proposal = loadProposal(prepared.proposalId);
      const approvedHash = proposal.hash;
      const approvedRequest = structuredClone(proposal.items[0].request);
      // Only this test's isolated synthetic proposal is marked as already sent.
      proposal.status = 'AWAITING_READBACK';
      proposal.items[0].result = { status: 'AWAITING_READBACK' };
      proposal.items[0].sendResult = structuredClone(sent);
      writeJson(p('proposals', `${proposal.id}.json`), proposal);
      f.state.portfolio.budget = explicitNulls ? structuredClone(approvedBudget) : { policy: 'NO_CAP', currencyCode: 'USD' };
      f.state.calls = [];
      const result = await verifyChange({ proposalId: proposal.id });
      assert.equal(result.status, 'API_STATE_VERIFIED');
      const verified = loadProposal(proposal.id);
      assert.equal(verified.items[0].result.status, 'API_STATE_VERIFIED');
      assert.equal(verified.items[0].readback.reconciled, true);
      assert.deepEqual(verified.items[0].readback.actual.portfolio.budget, f.state.portfolio.budget);
      assert.equal(verified.hash, approvedHash);
      assert.deepEqual(verified.items[0].request, approvedRequest);
      assert.ok(f.state.calls.length > 0);
      assert.ok(f.state.calls.every((call) => !call.options.isWrite));
    }
  } finally { OPS[index] = original; }
});
