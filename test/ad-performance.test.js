import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewAdPerformance } from '../lib/ad-performance.js';

const basis = { adProduct: 'SP', chargeType: 'CPC', interaction: 'CLICK', salesScope: 'PROMOTED', attributionWindow: '7-day-click' };
const snapshot = (m = {}) => ({ source: 'SIMULATED report', startDate: '2026-10-15', endDate: '2026-10-21', coverage: 'complete',
  attributionMature: true, basis: { ...basis }, metrics: { impressions: 10000, clicks: 100, orders: 10, spend: 100, sales: 200, ...m } });
const fixture = () => ({ scope: { store: 'DEMO', marketplace: 'US', currency: 'USD', timezone: 'America/Los_Angeles', entityType: 'campaign' },
  evidenceKind: 'simulation', rows: [{ id: 'SP-DEMO', objective: 'sales', current: snapshot(),
    baseline: { ...snapshot({ orders: 20, sales: 600 }), startDate: '2026-10-01', endDate: '2026-10-07' },
    economics: { source: 'SIMULATED matching contribution', quality: 'verified', contributionBeforeAds: 90, profitFloor: 20 },
    inventory: { source: 'SIMULATED stock', availableUnits: 400, dailyUnitDemand: 20, replenishmentDays: 7, sellingDaysRemaining: 60 },
    budget: { source: 'SIMULATED budget report', limited: true }, changes: ['price and main image changed during this comparison'] }] });
const codes = result => result.rows[0].candidates.map(x => x.code);

test('recomputes raw ratios and decomposes comparable ACoS without causal attribution', () => {
  const result = reviewAdPerformance(fixture()), r = result.rows[0];
  assert.equal(r.metrics.acosPct, 50); assert.equal(r.metrics.cpc, 1); assert.equal(r.metrics.cvrPct, 10);
  assert.equal(r.metrics.aov, 20); assert.equal(r.metrics.ctrPct, 1);
  assert.equal(r.comparison.factors.cpc, 1); assert.equal(r.comparison.factors.inverseCvr, 2);
  assert.equal(r.comparison.factors.inverseAov, 1.5); assert.ok(Math.abs(r.comparison.factors.acos - 3) < 1e-12);
  assert.equal(r.comparison.status, 'CONFOUNDED');
  assert.ok(codes(result).includes('INVESTIGATE_CVR'));
  assert.ok(codes(result).includes('SEGMENT_CHANGES'));
  assert.equal(result.executionAuthorized, false); assert.equal(result.independentSourceVerification, false);
});

test('a low ACoS does not override a contribution loss or profit floor', () => {
  const i = fixture(); i.rows[0].current.metrics.sales = 2000;
  const r = reviewAdPerformance(i);
  assert.equal(r.rows[0].metrics.acosPct, 5);
  assert.equal(r.rows[0].economics.contributionAfterAds, -10);
  assert.equal(r.rows[0].economics.profitFloorGap, -30);
  assert.ok(codes(r).includes('ECONOMICS_REVIEW')); assert.ok(!codes(r).includes('BUDGET_OPPORTUNITY_REVIEW'));
});

test('stockout risk outranks historical profitable budget constraints', () => {
  const i = fixture(); i.rows[0].economics.contributionBeforeAds = 200;
  i.rows[0].inventory.availableUnits = 10;
  const r = reviewAdPerformance(i);
  assert.equal(r.priorityActions[0].code, 'INVENTORY_FIRST');
  assert.equal(r.rows[0].inventory.coverageDays, 0.5);
  assert.ok(!codes(r).includes('BUDGET_OPPORTUNITY_REVIEW'));
});

test('unverified or missing stock is unknown, not safe to expand', () => {
  for (const change of [r => { delete r.inventory; }, r => { r.inventory.dailyUnitDemand = null; }, r => { r.inventory.replenishmentDays = null; r.inventory.sellingDaysRemaining = null; }]) {
    const i = fixture(); i.rows[0].economics.contributionBeforeAds = 200; change(i.rows[0]);
    const r = reviewAdPerformance(i);
    assert.equal(r.rows[0].inventory.stockRisk, null);
    assert.ok(!codes(r).includes('BUDGET_OPPORTUNITY_REVIEW'));
  }
});

test('approved-looking estimated economics cannot create a profitable budget opportunity', () => {
  const i = fixture(); i.rows[0].economics.quality = 'estimated'; i.rows[0].economics.contributionBeforeAds = 200;
  const r = reviewAdPerformance(i);
  assert.equal(r.rows[0].economics.status, 'ESTIMATED');
  assert.ok(!codes(r).includes('BUDGET_OPPORTUNITY_REVIEW'));
});

test('mature zero orders call for relevance and conversion checks, never automatic negatives', () => {
  const i = fixture(); i.rows[0].current.metrics = { impressions: 300, clicks: 8, spend: 7, orders: 0, sales: 0 };
  delete i.rows[0].economics;
  const r = reviewAdPerformance(i);
  assert.equal(r.rows[0].metrics.acosPct, null); assert.equal(r.rows[0].metrics.cvrPct, 0);
  assert.equal(r.rows[0].comparison.factors, null); assert.ok(codes(r).includes('ZERO_ORDER_REVIEW'));
  assert.ok(r.rows[0].candidates.every(x => x.executionAuthorized === false));
});

test('immature attribution cannot produce a final-loss or zero-order verdict', () => {
  const i = fixture(); i.rows[0].current.attributionMature = false; i.rows[0].current.metrics.orders = 0;
  const r = reviewAdPerformance(i);
  assert.equal(r.rows[0].economics.contributionAfterAds, null); assert.equal(r.rows[0].comparison.factors, null);
  assert.ok(codes(r).includes('COMPLETE_DATA'));
  assert.ok(!codes(r).includes('ZERO_ORDER_REVIEW')); assert.ok(!codes(r).includes('ECONOMICS_REVIEW'));
});

test('missing spend is not zero and zero denominators remain unavailable', () => {
  const i = fixture(); i.rows[0].current.metrics = { orders: 0, clicks: 0, impressions: 0, sales: 0 };
  const r = reviewAdPerformance(i).rows[0];
  for (const k of ['spend', 'acosPct', 'roas', 'cpc', 'ctrPct', 'cvrPct', 'aov']) assert.equal(r.metrics[k], null, k);
  assert.equal(r.economics.contributionAfterAds, null);
});

test('no decomposition across products, attribution, or sales scopes', () => {
  for (const [key, value] of [['adProduct', 'SB'], ['attributionWindow', '14-day-click'], ['salesScope', 'COMBINED'], ['interaction', 'MIXED']]) {
    const i = fixture(); i.rows[0].baseline.basis[key] = value;
    const r = reviewAdPerformance(i).rows[0];
    assert.equal(r.comparison.status, 'INCOMPATIBLE'); assert.equal(r.comparison.factors, null);
  }
});

test('awareness/view campaigns are not judged as failed sales campaigns', () => {
  const i = fixture(); const r = i.rows[0]; r.objective = 'awareness';
  r.current.basis = { ...basis, adProduct: 'SD', chargeType: 'VCPM', interaction: 'VIEW' };
  r.baseline.basis = { ...r.current.basis }; r.current.metrics.orders = 0; r.current.metrics.sales = 0;
  const result = reviewAdPerformance(i);
  assert.equal(result.rows[0].comparison.status, 'OTHER_MEASUREMENT_BASIS');
  assert.equal(result.rows[0].metrics.cvrPct, null);
  assert.ok(codes(result).includes('OBJECTIVE_REVIEW'));
  for (const code of ['ECONOMICS_REVIEW', 'ZERO_ORDER_REVIEW', 'BUDGET_OPPORTUNITY_REVIEW']) assert.ok(!codes(result).includes(code));
});

test('seasonal sell-through exposes required demand and does not auto spend', () => {
  const i = fixture(); i.rows[0].inventory = { ...i.rows[0].inventory, availableUnits: 600, dailyUnitDemand: 10, sellingDaysRemaining: 30 };
  const r = reviewAdPerformance(i);
  assert.equal(r.rows[0].inventory.clearanceDailyUnits, 20); assert.ok(codes(r).includes('SELL_THROUGH_SCENARIO'));
  assert.match(r.rows[0].inventory.clearanceAssumption, /待确认/);
  assert.equal(r.executed, false);
});

test('retail ratios are separate from ad attribution and no cross-row ROAS ranking is invented', () => {
  const i = fixture(); i.rows[0].retail = { source: 'SIMULATED same-window retail', sessions: 200, orders: 50, sales: 1000 };
  const second = structuredClone(i.rows[0]); second.id = 'SB-DEMO'; second.current.basis.adProduct = 'SB';
  i.rows.push(second); const r = reviewAdPerformance(i);
  assert.equal(r.rows[0].retail.rowSpendToRetailSalesPct, 10); assert.equal(r.rows[0].retail.orderSessionPct, 25);
  assert.equal(r.rows[0].retail.tacosPct, undefined);
  assert.equal(r.rows[0].metrics.cvrPct, 10); assert.equal(r.rows.length, 2);
  assert.equal(r.priorityActions.length, 3); assert.ok(r.deferredActions.length > 0); assert.equal(r.aggregateRoas, undefined);
});

test('overlapping windows cannot masquerade as a before/after experiment', () => {
  const i = fixture(); i.rows[0].baseline.startDate = '2026-10-10'; i.rows[0].baseline.endDate = '2026-10-15';
  assert.equal(reviewAdPerformance(i).rows[0].comparison.status, 'OVERLAPPING_OR_REVERSED');
});

test('an exhausted selling window prevents profitable-looking budget expansion', () => {
  const i = fixture(); i.rows[0].economics.contributionBeforeAds = 200; i.rows[0].inventory.sellingDaysRemaining = 0;
  const r = reviewAdPerformance(i);
  assert.equal(r.rows[0].inventory.sellingWindowClosed, true);
  assert.equal(r.priorityActions[0].code, 'SALES_WINDOW_CLOSED');
  assert.ok(!codes(r).includes('BUDGET_OPPORTUNITY_REVIEW'));
});

test('view-attributed orders never become click conversion, including above-click order counts', () => {
  for (const interaction of ['VIEW', 'MIXED', 'UNKNOWN']) {
    const i = fixture(); i.rows[0].current.basis.interaction = interaction;
    i.rows[0].current.metrics.clicks = 10; i.rows[0].current.metrics.orders = 20;
    assert.equal(reviewAdPerformance(i).rows[0].metrics.cvrPct, null);
  }
});

test('inventory considers the remaining selling window and treats equality as no buffer', () => {
  const i = fixture(); i.rows[0].economics.contributionBeforeAds = 200;
  i.rows[0].inventory = { ...i.rows[0].inventory, availableUnits: 200, dailyUnitDemand: 10, replenishmentDays: 90, sellingDaysRemaining: 10 };
  let r = reviewAdPerformance(i);
  assert.equal(r.rows[0].inventory.planningHorizonDays, 10); assert.equal(r.rows[0].inventory.stockRisk, false);
  assert.ok(codes(r).includes('BUDGET_OPPORTUNITY_REVIEW'));
  i.rows[0].inventory.availableUnits = 100; r = reviewAdPerformance(i);
  assert.equal(r.rows[0].inventory.stockRisk, true); assert.ok(!codes(r).includes('BUDGET_OPPORTUNITY_REVIEW'));
});

test('unknown attribution basis cannot support a contribution/budget verdict', () => {
  const i = fixture(); i.rows[0].economics.contributionBeforeAds = 200;
  i.rows[0].current.basis.interaction = 'UNKNOWN'; const r = reviewAdPerformance(i);
  assert.equal(r.rows[0].economics.status, 'UNAVAILABLE'); assert.ok(!codes(r).includes('BUDGET_OPPORTUNITY_REVIEW'));
});

test('rejects duplicate entities, invalid dates, invalid types and undeclared fields', () => {
  for (const edit of [i => i.rows.push(structuredClone(i.rows[0])), i => { i.rows[0].current.startDate = '2026-02-30'; },
    i => { i.rows[0].current.metrics.spend = -1; }, i => { i.rows[0].current.metrics.clicks = 0.5; },
    i => { i.rows[0].current.metrics.orders = true; }, i => { i.rows[0].current.metrics.sales = Infinity; },
    i => { i.rows[0].current.metrics.acos = 5; }, i => { i.scope.timezone = 'Invalid/Zone'; },
    i => { i.executionAuthorized = true; }]) {
    const i = fixture(); edit(i); assert.throws(() => reviewAdPerformance(i));
  }
});

test('review leaves its original evidence unchanged', () => {
  const i = fixture(), before = JSON.stringify(i); reviewAdPerformance(i); assert.equal(JSON.stringify(i), before);
});
