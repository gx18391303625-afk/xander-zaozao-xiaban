import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isolate } from './helpers.js';

isolate();
const SP = 'SPONSORED_PRODUCTS', SB = 'SPONSORED_BRANDS';
const state = { calls: [], secondPageFails: false };
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.url === '/auth/o2/token') return json(200, { access_token: 'FAKE-TOKEN', expires_in: 3600 });
  const body = JSON.parse(raw);
  state.calls.push({ path: req.url, body, scope: req.headers['amazon-advertising-api-scope'] });
  const resource = req.url.split('/').at(-1);
  const product = body.adProductFilter.include[0];
  const limit = product === SB ? (resource === 'targets' ? 5000 : 100) : 1000;
  if (body.maxResults > limit) return json(400, { code: 'BAD_REQUEST', message: `Maximum supported: ${limit}` });
  if (state.secondPageFails && body.nextToken) return json(400, { code: 'BAD_REQUEST', message: 'Synthetic continuation denied' });
  const start = body.nextToken ? 100 : 0;
  const total = 101;
  const rows = Array.from({ length: Math.min(body.maxResults, total - start) }, (_, i) => ({ campaignId: `SYNTHETIC-${start + i}`, adProduct: product }));
  return json(200, { [resource]: rows, ...(start + rows.length < total ? { nextToken: 'synthetic-page-2' } : {}) });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.XANDER_ADS_HOST = base;
process.env.XANDER_LWA_URL = `${base}/auth/o2/token`;
const { setSecret } = await import('../lib/secrets.js');
const { updateConfig } = await import('../lib/config.js');
const { unifiedQuery, listEntities } = await import('../lib/ads.js');
setSecret('ads:synthetic-query', { clientId: 'FAKE-CLIENT', clientSecret: 'FAKE-SECRET', refreshToken: 'FAKE-REFRESH' });
updateConfig((c) => { c.stores['synthetic-query'] = { region: 'NA', defaultMarketplace: 'US', marketplaces: ['US'], ads: { profiles: { US: '900' } } }; });
test.beforeEach(() => { state.calls = []; state.secondPageFails = false; });
test.after(() => server.close());

test('shared SB entity query respects 100 even when a caller or filters request 1000', async () => {
  for (const resource of ['campaigns', 'adGroups', 'ads']) {
    for (const pagination of [{ maxResults: 1000 }, { filters: { maxResults: 1000 } }]) {
      const filters = { portfolioIdFilter: { include: ['SYNTHETIC-PORTFOLIO'] }, ...pagination.filters };
      const saved = structuredClone(filters);
      await unifiedQuery('synthetic-query', { ad: SB, resource, profileId: '900', ...pagination, filters, nextToken: 'synthetic-page-2' });
      const call = state.calls.at(-1);
      assert.equal(call.body.maxResults, 100);
      assert.equal(call.body.nextToken, 'synthetic-page-2');
      assert.equal(call.scope, '900');
      assert.deepEqual(call.body.portfolioIdFilter, saved.portfolioIdFilter);
      assert.deepEqual(filters, saved, 'pagination must not mutate approved filters');
    }
  }
});

test('SP retains 1000 while small ID lookups and effective mixed-product limits are preserved', async () => {
  await unifiedQuery('synthetic-query', { ad: 'sp', resource: 'campaigns', profileId: '900' });
  assert.equal(state.calls.at(-1).body.maxResults, 1000);
  for (const ad of ['sp', 'sb']) {
    await unifiedQuery('synthetic-query', { ad, resource: 'campaigns', profileId: '900', maxResults: 10, filters: { campaignIdFilter: { include: ['SYNTHETIC-1'] } } });
    assert.equal(state.calls.at(-1).body.maxResults, 10);
    assert.deepEqual(state.calls.at(-1).body.campaignIdFilter, { include: ['SYNTHETIC-1'] });
  }
  await unifiedQuery('synthetic-query', { ad: 'sp', resource: 'campaigns', profileId: '900', filters: { adProductFilter: { include: [SP, SB] }, maxResults: 1000 } });
  assert.equal(state.calls.at(-1).body.maxResults, 100);
});

test('SB public list reads both capped pages and preserves complete/count', async () => {
  const result = await listEntities('synthetic-query', 'sb.campaigns');
  assert.equal(result.complete, true);
  assert.equal(result.count, 101);
  assert.equal(result.pages, 2);
  assert.equal(new Set(result.items.map((x) => x.campaignId)).size, 101);
  assert.deepEqual(state.calls.map((x) => x.body.maxResults), [100, 100]);
  assert.equal(state.calls[1].body.nextToken, 'synthetic-page-2');
});

test('SB continuation failure rejects instead of returning the first page as complete', async () => {
  state.secondPageFails = true;
  await assert.rejects(listEntities('synthetic-query', 'sb.campaigns'), /Synthetic continuation denied/);
  assert.equal(state.calls.length, 2);
});

test('SP target and keyword aliases use the pinned 1000-item target limit', async () => {
  for (const entity of ['sp.targets', 'sp.keywords', 'sp.negativeKeywords']) {
    state.calls = [];
    const result = await listEntities('synthetic-query', entity, { filters: { maxResults: 5000 } });
    assert.equal(result.complete, true);
    assert.equal(result.count, 101);
    assert.equal(state.calls[0].path, '/adsApi/v1/query/targets');
    assert.equal(state.calls[0].body.maxResults, 1000);
    if (entity !== 'sp.targets') {
      assert.deepEqual(state.calls[0].body.targetTypeFilter, { include: ['KEYWORD'] });
      assert.deepEqual(state.calls[0].body.negativeFilter, { include: [entity === 'sp.negativeKeywords'] });
    }
  }
});

test('SB targets retain their separate 5000-item contract instead of campaign limits', async () => {
  await unifiedQuery('synthetic-query', { ad: 'sb', resource: 'targets', profileId: '900', maxResults: 5000 });
  assert.equal(state.calls.at(-1).body.maxResults, 5000);
});

test('invalid entity page sizes are rejected before any network request', async () => {
  for (const maxResults of [0, -1, 1.5, NaN, '100']) {
    await assert.rejects(unifiedQuery('synthetic-query', { ad: 'sb', resource: 'campaigns', profileId: '900', maxResults }), /maxResults/);
  }
  assert.equal(state.calls.length, 0);
});
