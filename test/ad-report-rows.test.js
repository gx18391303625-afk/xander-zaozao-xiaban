// 报表 → 对象汇总 → 广告复盘：中间不靠 AI 手工抄数。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import { isolate } from './helpers.js';

isolate();
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
// 搜索词日数据：基准窗口 30–23 天前，当前窗口 20–13 天前（都已过 7 天归因期）
const v3Rows = [];
for (let n = 30; n >= 13; n--) {
  if (n < 23 && n > 20) continue;
  v3Rows.push({ date: day(n), campaignId: 'C1', adGroupId: 'G1', keywordId: 'K1', keyword: 'dog bowl', matchType: 'EXACT', searchTerm: 'dog bowl', impressions: 100, clicks: 10, cost: n > 20 ? 8 : 12, purchases7d: 2, sales7d: 40 });
  v3Rows.push({ date: day(n), campaignId: 'C1', adGroupId: 'G1', keywordId: 'K1', keyword: 'dog bowl', matchType: 'EXACT', searchTerm: 'cat bowl', impressions: 50, clicks: 5, cost: 4, purchases7d: 0, sales7d: 0 });
}
v3Rows.push({ date: day(14), campaignId: 'C2', adGroupId: 'G2', keywordId: 'K2', keyword: 'bowl', matchType: 'BROAD', searchTerm: 'steel bowl', impressions: 10, clicks: 1, cost: null, purchases7d: 0, sales7d: 0 });
const v1Rows = [
  { 'advertiserAccount.entityId': 'ENT1', 'date.value': day(3), 'adProduct.value': 'SPONSORED_PRODUCTS', 'campaign.id': 'C1', 'campaign.name': 'Bowl Exact', 'budgetCurrency.value': 'USD', 'metric.impressions': 100, 'metric.clicks': 10, 'metric.totalCost': 9, 'metric.purchases': 1, 'metric.sales': 20 },
  { 'advertiserAccount.entityId': 'ENT1', 'date.value': day(3), 'adProduct.value': 'SPONSORED_BRANDS', 'campaign.id': 'C1', 'campaign.name': 'Brand', 'budgetCurrency.value': 'USD', 'metric.impressions': 300, 'metric.clicks': 3, 'metric.totalCost': 6, 'metric.purchases': 0, 'metric.sales': 0 },
];

const server = http.createServer(async (req, res) => {
  for await (const _ of req) { /* drain */ }
  const url = new URL(req.url, 'http://x');
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (url.pathname === '/auth/o2/token') return json(200, { access_token: 'AT', expires_in: 3600 });
  if (url.pathname === '/reporting/reports' && req.method === 'POST') return json(200, { reportId: 'v3-st-1', status: 'PENDING' });
  if (url.pathname === '/reporting/reports/v3-st-1') return json(200, { reportId: 'v3-st-1', status: 'COMPLETED', url: `${base}/dl/v3`, configuration: { reportTypeId: 'spSearchTerm' } });
  if (url.pathname === '/adsApi/v1/query/advertiserAccounts') return json(200, { advertiserAccounts: [{ advertiserAccountId: 'amzn1.ads-account.g.T', alternateIds: [{ countryCode: 'US', entityId: 'ENT1', profileId: '999' }] }] });
  if (url.pathname === '/adsApi/v1/create/reports') return json(207, { success: [{ index: 0, report: { reportId: 'v1-c-1', status: 'PENDING' } }] });
  if (url.pathname === '/adsApi/v1/retrieve/reports') return json(207, { success: [{ index: 0, report: { reportId: 'v1-c-1', status: 'COMPLETED', completedReportParts: [{ url: `${base}/dl/v1` }] } }] });
  if (url.pathname === '/dl/v3' || url.pathname === '/dl/v1') { res.writeHead(200); return res.end(zlib.gzipSync(Buffer.from(JSON.stringify(url.pathname.endsWith('v3') ? v3Rows : v1Rows)))); }
  json(404, { message: `no route ${url.pathname}` });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.XANDER_ADS_HOST = base;
process.env.XANDER_LWA_URL = `${base}/auth/o2/token`;
test.after(() => server.close());

const { updateConfig } = await import('../lib/config.js');
const { setSecret } = await import('../lib/secrets.js');
const { p } = await import('../lib/paths.js');
const { requestAdsReport, collectAdsReport } = await import('../lib/ads.js');
const { adReportRows } = await import('../lib/ad-report-rows.js');
const { reviewAdPerformance } = await import('../lib/ad-performance.js');
setSecret('ads:main', { clientId: 'a', clientSecret: 's', refreshToken: 'Atzr|A' });
updateConfig((c) => { c.stores.main = { region: 'NA', marketplaces: ['US'], defaultMarketplace: 'US', ads: { profiles: { US: '999' } } }; });
const tz = 'America/Los_Angeles';
const current = { startDate: day(20), endDate: day(13) };
const baseline = { startDate: day(30), endDate: day(23) };

test('v3 搜索词报表：按搜索词汇总两个窗口，结果可直接交给广告复盘', async () => {
  const req = await requestAdsReport('main', { preset: 'sp_search_terms', startDate: day(30), endDate: day(13) });
  const got = await collectAdsReport('main', req.reportId);
  const meta = JSON.parse(fs.readFileSync(`${got.file}.meta.json`, 'utf8'));
  assert.equal(meta.startDate, day(30));
  assert.equal(meta.reportTypeId, 'spSearchTerm');

  const r = adReportRows({ file: got.file, entityType: 'search_term', current, baseline, timezone: tz });
  assert.equal(r.summary.api, 'v3');
  assert.equal(r.reviewInput.scope.currency, 'USD');
  assert.equal(r.reviewInput.rows.length, 3);
  const [dog, cat] = r.reviewInput.rows;
  assert.equal(dog.id, 'C1|G1|K1|dog bowl', '按当前花费从高到低');
  assert.deepEqual(dog.current.metrics, { impressions: 800, clicks: 80, spend: 96, orders: 16, sales: 320 });
  assert.equal(dog.baseline.metrics.spend, 64);
  assert.equal(dog.current.coverage, 'complete');
  assert.equal(dog.current.attributionMature, true);
  assert.equal(dog.current.basis.attributionWindow, '7d click');
  assert.equal(cat.current.metrics.orders, 0);
  const steel = r.reviewInput.rows.find((x) => x.id.endsWith('steel bowl'));
  assert.equal(steel.current.metrics.spend, null, '缺的花费保持 null，不当 0');

  const review = reviewAdPerformance(r.reviewInput);
  const dogReview = review.rows.find((x) => x.id === dog.id);
  assert.equal(dogReview.comparison.status, 'DESCRIPTIVE', '同口径、成熟、不重叠的两个窗口可以做 ACoS 分解');
  assert.ok(review.rows.find((x) => x.id === cat.id).candidates.some((c) => c.code === 'ZERO_ORDER_REVIEW'));
});

test('limit 截断时给出剩余对象数和合计花费', async () => {
  const file = (await collectAdsReport('main', 'v3-st-1')).file;
  const r = adReportRows({ file, entityType: 'search_term', current, timezone: tz, limit: 1 });
  assert.equal(r.reviewInput.rows.length, 1);
  assert.deepEqual(r.summary.truncated, { objects: 2, spend: null }, '剩余里有缺失花费时合计为 null');
});

test('v1 活动报表：SP/SB 分开；近 3 天标为归因未成熟；口径未知时提示不做分解', async () => {
  const req = await requestAdsReport('main', { preset: 'campaigns', startDate: day(5), endDate: day(1) });
  const { file } = await collectAdsReport('main', req.reportId);
  const r = adReportRows({ file, entityType: 'campaign', current: { startDate: day(5), endDate: day(1) }, timezone: tz });
  assert.deepEqual(r.reviewInput.rows.map((x) => [x.current.basis.adProduct, x.name]), [['SP', 'Bowl Exact'], ['SB', 'Brand']]);
  assert.equal(r.reviewInput.rows[0].current.attributionMature, false);
  assert.equal(r.reviewInput.rows[1].current.basis.chargeType, 'UNKNOWN');
  assert.ok(r.gaps.some((g) => g.includes('basisOverride')));
  assert.ok(reviewAdPerformance(r.reviewInput).rows.length === 2);
  assert.throws(() => adReportRows({ file, entityType: 'search_term', current, timezone: tz }), /sp_search_terms/);
});

test('只读报表目录里的文件；窗口和参数校验', () => {
  assert.throws(() => adReportRows({ file: '/etc/hosts', entityType: 'campaign', current, timezone: tz }), /只读取/);
  const file = p('reports', 'main_ads_v3_spSearchTerm_v3-st-1.json');
  assert.throws(() => adReportRows({ file, entityType: 'search_term', current, baseline: current, timezone: tz }), /不重叠/);
  assert.throws(() => adReportRows({ file, entityType: 'search_term', current, timezone: 'Mars/Base' }), /timezone/);
  assert.throws(() => adReportRows({ file, entityType: 'search_term', current, timezone: tz, basisOverride: { salesScope: 'PROMOTED' } }), /source/);
});
