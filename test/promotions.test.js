import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isolate } from './helpers.js';
isolate();
const { updateConfig, getStore } = await import('../lib/config.js');
const { setSecret } = await import('../lib/secrets.js');
const { setSwitch } = await import('../lib/switches.js');
const { prepareChange, executeChange, recordPromotionReceipt, verifyChange } = await import('../lib/proposals.js');
const { readPromotions } = await import('../lib/promotions.js');
const calls = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/token') return res.end(JSON.stringify({ access_token: 'synthetic', expires_in: 3600 }));
  if (req.method !== 'GET') { res.writeHead(500); return res.end('{}'); }
  if (url.pathname.endsWith('/promo-1')) return res.end(JSON.stringify({ promotionId: 'promo-1', marketplaceId: 'ATVPDKIKX0DER', promotionType: 'COUPON', status: 'PROCESSING', issues: [] }));
  return res.end(JSON.stringify({ promotions: [], pagination: { nextToken: 'page-two' } }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.XANDER_SPAPI_HOST = `http://127.0.0.1:${server.address().port}`;
process.env.XANDER_LWA_URL = `${process.env.XANDER_SPAPI_HOST}/token`;
setSecret('spapi:main', { clientId: 'fixture', clientSecret: 'fixture', refreshToken: 'fixture' });
updateConfig((c) => { c.stores.main = { region: 'NA', defaultMarketplace: 'US' }; });
test.after(() => server.close());
const plan = () => ({ promotionType: 'COUPON', title: 'Synthetic coupon', items: [{ asin: 'B000000001', sku: 'TEST-1' }], discount: { type: 'PERCENTAGE_OFF', value: 10 }, budget: { amount: 100, currency: 'USD' }, startDate: new Date(Date.now() + 86400_000).toISOString(), endDate: new Date(Date.now() + 172800_000).toISOString(), audience: 'All eligible customers', stackingPolicy: 'Do not combine with other promotions' });

test('coupon preparation validates input, needs switch/approval, releases only a local handoff', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'promotions.coupon', value: plan() }] });
  assert.equal(pr.ok, true);
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true }), /开关还关着/);
  setSwitch('promotions.coupon', true);
  const before = calls.length;
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'HANDOFF_READY');
  assert.equal(calls.length, before, 'handoff cannot submit any API request');
  assert.equal(r.items[0].receipt.platformSubmission, false);
  const observed = await recordPromotionReceipt({ proposalId: pr.proposalId, hash: pr.hash, promotionId: 'promo-1' });
  assert.equal(observed.status, 'PLATFORM_STATUS_OBSERVED');
  assert.match(observed.items[0].说明, /不能宣称/);
  await verifyChange({ proposalId: pr.proposalId });
  assert.ok(calls.filter((c) => c.path.startsWith('/promotions')).every((c) => c.method === 'GET'));
});

test('plan rejects invalid discounts, dates, currencies, duplicate items and silently dropped fields', async () => {
  for (const patch of [{ discount: { type: 'PERCENTAGE_OFF', value: 100 } }, { startDate: '2026-10-23' }, { budget: { amount: 100, currency: 'EUR' } }, { items: [{ asin: 'B000000001' }, { asin: 'B000000001' }] }, { inventedCreateEndpoint: true }]) {
    const r = await prepareChange({ store: 'main', changes: [{ op: 'promotions.coupon', value: { ...plan(), ...patch } }] });
    assert.equal(r.ok, false);
  }
});

test('official promotion read uses one marketplace and preserves pagination; no caller-controlled paths', async () => {
  const r = await readPromotions(getStore('main'), { query: { promotionTypes: ['COUPON'], paginationToken: 'page-one' } });
  assert.equal(r.nextToken, 'page-two');
  const last = calls.at(-1);
  assert.equal(last.path, '/promotions/2025-12-01/promotions');
  assert.equal(last.query.marketplaceIds, 'ATVPDKIKX0DER');
  assert.equal(last.query.paginationToken, 'page-one');
  await assert.rejects(readPromotions(getStore('main'), { query: { marketplaceIds: 'foreign' } }), /不支持/);
  await assert.rejects(readPromotions(getStore('main'), { action: 'create' }), /action/);
  await assert.rejects(readPromotions(getStore('main'), { action: 'selection', promotionId: 'promo-1', selectionId: 'selection-1' }), /revisionId/);
  await readPromotions(getStore('main'), { action: 'selection', promotionId: 'promo-1', selectionId: 'selection-1', query: { revisionId: 1, includedData: ['ISSUES'] } });
  assert.equal(calls.at(-1).query.revisionId, '1');
  assert.equal(calls.at(-1).query.includedData, 'ISSUES');
});
