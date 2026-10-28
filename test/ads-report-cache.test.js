import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isolate } from './helpers.js';

const dir = isolate();
const { updateConfig, loadConfig } = await import('../lib/config.js');
const { setSecret } = await import('../lib/secrets.js');
const { FILES } = await import('../lib/paths.js');
const { readJson, writeJson } = await import('../lib/jsonfile.js');
const { requestAdsReport, V1_PRESETS, V3_PRESETS } = await import('../lib/ads.js');
const v1Presets = structuredClone(V1_PRESETS), v3Presets = structuredClone(V3_PRESETS);
const originalFetch = globalThis.fetch;
const state = { calls: [], accounts: [], sequence: 0, duplicate: false, accountHook: null };
const alias = 'synthetic-report-cache';
const ACCOUNT = 'advertiserAccount.id', SITE = 'advertiserAccount.entityId';
const params = { startDate: '2026-10-01', endDate: '2026-10-07', preset: 'campaigns' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const account = (id = 'ACCOUNT-A', profileId = '900', global = true) => ({
  advertiserAccountId: id, isGlobalAccount: global,
  alternateIds: [{ countryCode: 'US', entityId: 'ENTITY-US', profileId }, ...(global ? [{ countryCode: 'CA', entityId: 'ENTITY-CA', profileId: '902' }] : [])],
});
const creates = () => state.calls.filter((call) => ['/adsApi/v1/create/reports', '/reporting/reports'].includes(call.path));
const accountQueries = () => state.calls.filter((call) => call.path === '/adsApi/v1/query/advertiserAccounts');

// No real network or keychain access: all requests terminate in this local synthetic dispatcher.
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  if (path === '/auth/o2/token') return response({ access_token: 'SYNTHETIC-TOKEN', expires_in: 3600 });
  const body = options.body ? JSON.parse(options.body) : undefined;
  state.calls.push({ path, body, scope: options.headers?.['Amazon-Advertising-API-Scope'] });
  if (path === '/adsApi/v1/query/advertiserAccounts') {
    state.accountHook?.();
    return response({ advertiserAccounts: state.accounts });
  }
  if (path === '/adsApi/v1/create/reports') {
    const fields = body.reports[0].query.fields;
    if (fields.includes(SITE) && !fields.includes(ACCOUNT)) return response({ error: [{ errors: [{ code: '400006', message: 'entityId requires advertiserAccount.id' }] }] }, 207);
    if (fields.filter((field) => field.startsWith('date.')).length !== 1) return response({ error: [{ errors: [{ code: '400016', message: 'one date dimension required' }] }] }, 207);
    return response({ success: [{ report: { reportId: `synthetic-v1-${++state.sequence}`, status: 'PENDING' } }] }, 207);
  }
  if (path === '/reporting/reports') {
    if (state.duplicate) return response({ message: 'The report is a duplicate of: 12345678-1234-1234-1234-123456789012' }, 425);
    return response({ reportId: `synthetic-v3-${++state.sequence}`, status: 'PENDING' });
  }
  throw new Error(`Unexpected synthetic request: ${path}`);
};

test.beforeEach(() => {
  state.calls = []; state.accounts = [account()]; state.sequence = 0; state.duplicate = false; state.accountHook = null;
  for (const key of Object.keys(V1_PRESETS)) delete V1_PRESETS[key];
  Object.assign(V1_PRESETS, structuredClone(v1Presets));
  for (const key of Object.keys(V3_PRESETS)) delete V3_PRESETS[key];
  Object.assign(V3_PRESETS, structuredClone(v3Presets));
  updateConfig((cfg) => { cfg.stores = { [alias]: { region: 'NA', defaultMarketplace: 'US', marketplaces: ['US', 'CA'], ads: { profiles: { US: '900', CA: '902' } } } }; });
  setSecret(`ads:${alias}`, { clientId: 'SYNTHETIC-CLIENT', clientSecret: 'SYNTHETIC-SECRET', refreshToken: 'SYNTHETIC-REFRESH' });
  writeJson(FILES.reportIndex(), {});
});
test.after(() => {
  globalThis.fetch = originalFetch;
  Object.assign(V1_PRESETS, v1Presets); Object.assign(V3_PRESETS, v3Presets);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('v1 cache reuse preserves fields, marketplace, global-account warning and original receipt timestamp/status', async () => {
  const first = await requestAdsReport(alias, params);
  const again = await requestAdsReport(alias, { ...params, marketplace: 'us', reuseHours: 2 });
  assert.equal(first.reused, false); assert.equal(again.reused, true);
  for (const key of ['reportId', 'api', 'marketplace', 'fields', 'note', 'status', 'requestedAt']) assert.deepEqual(again[key], first[key]);
  assert.match(again.note, /全球广告账户/); assert.equal(again.status, 'PENDING');
  assert.match(again.reuseNote, /2 小时/); assert.match(again.reuseNote, /申请时回执/);
  assert.equal(creates().length, 1); assert.equal(accountQueries().length, 1);
  assert.equal(again.cacheVersion, undefined, 'internal cache version is not a report field');
});

test('effective custom v1 fields share cache after mandatory injection without mutating or sorting input', async () => {
  const fields = ['date.value', 'metric.clicks'];
  const saved = [...fields];
  const first = await requestAdsReport(alias, { ...params, fields });
  assert.deepEqual(fields, saved);
  assert.deepEqual(first.fields, [ACCOUNT, SITE, ...fields]);
  const explicit = await requestAdsReport(alias, { ...params, preset: undefined, fields: [ACCOUNT, SITE, ...fields] });
  assert.equal(explicit.reused, true); assert.equal(explicit.reportId, first.reportId);
  const reversed = await requestAdsReport(alias, { ...params, fields: [ACCOUNT, SITE, 'metric.clicks', 'date.value'] });
  assert.equal(reversed.reused, false, 'array order is preserved in actual request identity');
  assert.deepEqual(creates().at(-1).body.reports[0].query.fields, [ACCOUNT, SITE, 'metric.clicks', 'date.value']);
});

test('empty custom fields retain preset fallback and default campaigns can share the same actual request', async () => {
  const first = await requestAdsReport(alias, { ...params, fields: [] });
  const again = await requestAdsReport(alias, { ...params, preset: undefined });
  assert.equal(again.reused, true); assert.equal(again.reportId, first.reportId);
  assert.deepEqual(first.fields, V1_PRESETS.campaigns);
});

test('changed v1 preset fields invalidate cache and restoring the exact fields reuses original report', async () => {
  const first = await requestAdsReport(alias, params);
  V1_PRESETS.campaigns.push('metric.detailPageViews');
  const changed = await requestAdsReport(alias, params);
  assert.equal(changed.reused, false); assert.notEqual(changed.reportId, first.reportId);
  assert.ok(changed.fields.includes('metric.detailPageViews'));
  V1_PRESETS.campaigns.pop();
  assert.equal((await requestAdsReport(alias, params)).reportId, first.reportId);
  assert.equal(creates().length, 2);
});

test('changed injected v1 fields invalidate a previously cached custom request', async () => {
  state.accounts = [account('ACCOUNT-A', '900', false)];
  const fields = ['date.value', 'metric.clicks'];
  const first = await requestAdsReport(alias, { ...params, fields });
  assert.deepEqual(first.fields, fields);
  updateConfig((cfg) => { cfg.stores[alias].ads.accounts.US.isGlobalAccount = true; });
  const changed = await requestAdsReport(alias, { ...params, fields });
  assert.equal(changed.reused, false); assert.notEqual(changed.reportId, first.reportId);
  assert.deepEqual(changed.fields, [ACCOUNT, SITE, ...fields]);
  assert.deepEqual(fields, ['date.value', 'metric.clicks']);
});

test('v3 fallback cache follows resolved preset columns and retains its configuration and warning', async () => {
  const options = { ...params, preset: 'sp_search_terms' };
  const first = await requestAdsReport(alias, options);
  assert.equal(first.api, 'v3'); assert.equal(accountQueries().length, 0);
  const again = await requestAdsReport(alias, options);
  assert.equal(again.reused, true); assert.equal(again.note, first.note);
  assert.deepEqual(again.configuration, first.configuration); assert.equal(again.marketplace, 'US');
  V3_PRESETS.sp_search_terms.columns.push('unitsSoldClicks7d');
  const changed = await requestAdsReport(alias, options);
  assert.equal(changed.reused, false); assert.notEqual(changed.reportId, first.reportId);
  assert.ok(creates().at(-1).body.configuration.columns.includes('unitsSoldClicks7d'));
  V3_PRESETS.sp_search_terms.columns.pop();
  assert.equal((await requestAdsReport(alias, options)).reportId, first.reportId);
});

test('equivalent v3 configuration key ordering reuses cache, but column order and nested values remain significant', async () => {
  const config = { ...structuredClone(V3_PRESETS.sp_search_terms), timeUnit: 'DAILY', format: 'GZIP_JSON', filters: [{ field: 'campaignStatus', values: ['ENABLED'] }] };
  const before = structuredClone(config);
  const first = await requestAdsReport(alias, { ...params, preset: undefined, configuration: config });
  const reordered = Object.fromEntries(Object.entries(config).reverse());
  reordered.filters = [{ values: ['ENABLED'], field: 'campaignStatus' }];
  const again = await requestAdsReport(alias, { ...params, configuration: reordered });
  assert.equal(again.reused, true); assert.equal(again.reportId, first.reportId);
  assert.deepEqual(config, before);
  const changed = await requestAdsReport(alias, { ...params, configuration: { ...config, columns: [...config.columns].reverse() } });
  assert.equal(changed.reused, false);
  const filtered = await requestAdsReport(alias, { ...params, configuration: { ...config, filters: [{ field: 'campaignStatus', values: ['PAUSED'] }] } });
  assert.equal(filtered.reused, false); assert.equal(creates().length, 3);
});

test('v1 profile rebind refreshes advertiser-account mapping instead of reusing either old account or old report', async () => {
  const first = await requestAdsReport(alias, params);
  state.accounts.push(account('ACCOUNT-B', '901'));
  updateConfig((cfg) => { cfg.stores[alias].ads.profiles.US = '901'; });
  const changed = await requestAdsReport(alias, params);
  assert.equal(changed.reused, false); assert.notEqual(changed.reportId, first.reportId);
  assert.equal(creates().at(-1).body.accessRequestedAccounts[0].advertiserAccountId, 'ACCOUNT-B');
  assert.equal(accountQueries().length, 2);
  const saved = loadConfig().stores[alias].ads.accounts.US;
  assert.equal(saved.profileId, '901'); assert.equal(saved.region, 'NA'); assert.equal(saved.advertiserAccountId, 'ACCOUNT-B');
});

test('profile changes during advertiser-account lookup abort before creating or caching a report', async () => {
  state.accountHook = () => updateConfig((cfg) => { cfg.stores[alias].ads.profiles.US = '901'; });
  await assert.rejects(requestAdsReport(alias, params), /广告账户绑定已改变/);
  assert.equal(creates().length, 0); assert.deepEqual(readJson(FILES.reportIndex(), {}), {});
  assert.equal(loadConfig().stores[alias].ads.profiles.US, '901');
  assert.equal(loadConfig().stores[alias].ads.accounts, undefined, 'stale lookup must not overwrite the new configuration');
});

test('v1 region, marketplace and advertiser-account identity all separate report reuse', async () => {
  const first = await requestAdsReport(alias, params);
  const canada = await requestAdsReport(alias, { ...params, marketplace: 'CA' });
  assert.equal(canada.reused, false); assert.notEqual(canada.reportId, first.reportId);
  updateConfig((cfg) => { cfg.stores[alias].region = 'EU'; });
  const otherRegion = await requestAdsReport(alias, params);
  assert.equal(otherRegion.reused, false);
  assert.equal(accountQueries().length, 3, 'region changes invalidate advertiser-account mapping as well');
  updateConfig((cfg) => { cfg.stores[alias].ads.accounts.US.advertiserAccountId = 'ACCOUNT-REBOUND'; });
  const otherAccount = await requestAdsReport(alias, params);
  assert.equal(otherAccount.reused, false);
  assert.equal(creates().at(-1).body.accessRequestedAccounts[0].advertiserAccountId, 'ACCOUNT-REBOUND');
  assert.equal(creates().length, 4);
});

test('v3 profile, region and marketplace changes cannot reuse an old report', async () => {
  const options = { ...params, preset: 'sp_search_terms' };
  await requestAdsReport(alias, options);
  updateConfig((cfg) => { cfg.stores[alias].ads.profiles.US = '901'; });
  assert.equal((await requestAdsReport(alias, options)).reused, false);
  assert.equal(creates().at(-1).scope, '901');
  updateConfig((cfg) => { cfg.stores[alias].region = 'EU'; });
  assert.equal((await requestAdsReport(alias, options)).reused, false);
  assert.equal((await requestAdsReport(alias, { ...options, marketplace: 'CA' })).reused, false);
  assert.equal(creates().length, 4);
});

test('legacy report keys and unbound advertiser-account mappings are ignored and refreshed once', async () => {
  updateConfig((cfg) => { cfg.stores[alias].ads.accounts = { US: { advertiserAccountId: 'STALE-ACCOUNT', isGlobalAccount: true, entities: { OLD: 'US' } } }; });
  const oldKey = ['ads', 'v1', alias, 'US', params.startDate, params.endDate, params.preset, null];
  writeJson(FILES.reportIndex(), Object.fromEntries([oldKey, [...oldKey, V1_PRESETS.campaigns.join(',')]].map((key) => [JSON.stringify(key), { reportId: 'STALE-REPORT', api: 'v1', marketplace: 'US', requestedAt: Date.now() }])));
  const first = await requestAdsReport(alias, params);
  assert.equal(first.reused, false); assert.notEqual(first.reportId, 'STALE-REPORT');
  assert.equal(creates()[0].body.accessRequestedAccounts[0].advertiserAccountId, 'ACCOUNT-A');
  assert.equal((await requestAdsReport(alias, params)).reused, true);
  assert.equal(accountQueries().length, 1);
});

test('validation and profile resolution happen before cache reuse', async () => {
  await requestAdsReport(alias, params);
  await assert.rejects(requestAdsReport(alias, { ...params, fields: 'date.value' }), /fields/);
  await assert.rejects(requestAdsReport(alias, { ...params, preset: 'unknown' }), /没有这个 v1 预设/);
  updateConfig((cfg) => { delete cfg.stores[alias].ads.profiles.US; });
  await assert.rejects(requestAdsReport(alias, params), /没有绑定广告 profile/);
  assert.equal(creates().length, 1);
});

test('v3 sunset validation still rejects an otherwise reusable cached request', async (t) => {
  const options = { ...params, preset: 'sp_search_terms' };
  await requestAdsReport(alias, options);
  const RealDate = Date;
  t.mock.method(globalThis, 'Date', class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2027-07-01T12:00:00Z'])); }
    static now() { return new RealDate('2027-07-01T12:00:00Z').getTime(); }
  });
  await assert.rejects(requestAdsReport(alias, { ...options, reuseHours: 100000 }), /关停/);
  assert.equal(creates().length, 1);
});

test('reuseHours zero disables reuse and expired/future timestamps are not trusted', async () => {
  const first = await requestAdsReport(alias, params);
  const forced = await requestAdsReport(alias, { ...params, reuseHours: 0 });
  assert.equal(forced.reused, false); assert.notEqual(forced.reportId, first.reportId);
  for (const requestedAt of [Date.now() - 2 * 3600_000, Date.now() + 3600_000]) {
    const index = readJson(FILES.reportIndex(), {});
    Object.values(index).forEach((record) => { record.requestedAt = requestedAt; });
    writeJson(FILES.reportIndex(), index);
    assert.equal((await requestAdsReport(alias, { ...params, reuseHours: 1 })).reused, false);
  }
  assert.equal(creates().length, 4);
});

test('v3 duplicate-425 recovery remains cacheable with the actual resolved configuration', async () => {
  state.duplicate = true;
  const options = { ...params, preset: 'sp_search_terms' };
  const first = await requestAdsReport(alias, options);
  assert.equal(first.reportId, '12345678-1234-1234-1234-123456789012');
  const again = await requestAdsReport(alias, options);
  assert.equal(again.reused, true); assert.equal(again.reportId, first.reportId);
  assert.deepEqual(again.configuration, first.configuration); assert.equal(creates().length, 1);
});
