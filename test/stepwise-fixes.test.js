// 回归：报表复用、站点拆分、档案库预览/待办这几处容易“悄悄出错”的地方。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { isolate } from './helpers.js';

const dir = isolate();
const state = { seq: 0, spStatus: {}, accounts: 'ok', adsReports: {} };
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const ch of req) raw += ch;
  const url = new URL(req.url, 'http://x');
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (url.pathname === '/auth/o2/token') return json(200, { access_token: 'AT', expires_in: 3600 });
  if (url.pathname === '/reports/2021-06-30/reports' && req.method === 'POST') return json(202, { reportId: `R${++state.seq}` });
  const rm = url.pathname.match(/^\/reports\/2021-06-30\/reports\/(R\d+)$/);
  if (rm) {
    const status = state.spStatus[rm[1]] || 'DONE';
    return json(200, { reportId: rm[1], reportType: 'GET_SALES_AND_TRAFFIC_REPORT', processingStatus: status, ...(status === 'DONE' ? { reportDocumentId: 'DOCJ' } : {}) });
  }
  if (url.pathname === '/reports/2021-06-30/documents/DOCJ') return json(200, { reportDocumentId: 'DOCJ', url: `${base}/spdl/DOCJ` });
  if (url.pathname === '/spdl/DOCJ') { res.writeHead(200); return res.end('{"salesAndTrafficByAsin":[]}'); }
  if (url.pathname === '/adsApi/v1/query/advertiserAccounts') {
    if (state.accounts !== 'ok') return json(403, { message: 'denied' });
    return json(200, { advertiserAccounts: [{ advertiserAccountId: 'amzn1.ads-account.g.T', alternateIds: [{ countryCode: 'US', entityId: 'ENT1', profileId: '999' }] }] });
  }
  if (url.pathname === '/adsApi/v1/create/reports') {
    const id = `ads-${++state.seq}`;
    state.adsReports[id] = 'FAILED';
    return json(207, { success: [{ index: 0, report: { reportId: id, status: 'PENDING' } }] });
  }
  if (url.pathname === '/adsApi/v1/retrieve/reports') {
    const id = JSON.parse(raw).reportIds[0];
    if (state.adsReports[id] === 'FAILED') return json(207, { success: [{ index: 0, report: { reportId: id, status: 'FAILED', failureReason: 'synthetic' } }] });
    return json(207, { success: [{ index: 0, report: { reportId: id, status: 'COMPLETED', completedReportParts: [{ url: `${base}/dl/${id}` }] } }] });
  }
  if (url.pathname.startsWith('/dl/')) {
    res.writeHead(200);
    return res.end(zlib.gzipSync(Buffer.from(JSON.stringify([{ 'advertiserAccount.entityId': 'ENT1', 'metric.clicks': 3 }]))));
  }
  json(404, { message: `no route ${url.pathname}` });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.XANDER_SPAPI_HOST = base;
process.env.XANDER_ADS_HOST = base;
process.env.XANDER_LWA_URL = `${base}/auth/o2/token`;
test.after(() => server.close());

const { updateConfig, getStore } = await import('../lib/config.js');
const { setSecret } = await import('../lib/secrets.js');
const { requestReport, collectReport } = await import('../lib/spapi.js');
const { requestAdsReport, collectAdsReport, splitBySite } = await import('../lib/ads.js');
const ar = await import('../lib/archive.js');
setSecret('spapi:main', { clientId: 'c', clientSecret: 's', refreshToken: 'Atzr|X' });
setSecret('ads:main', { clientId: 'a', clientSecret: 's', refreshToken: 'Atzr|A' });
updateConfig((c) => {
  c.stores.main = { region: 'NA', sellerId: 'S1', marketplaces: ['US'], defaultMarketplace: 'US', ads: { profiles: { US: '999' } } };
  c.stores.other = { region: 'NA', sellerId: 'S2', marketplaces: ['US'], defaultMarketplace: 'US' };
});

test('卖家报表：失败/取消的报表不会在 12 小时内被复用；fresh 可强制重新申请', async () => {
  const args = { reportType: 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA' };
  const first = await requestReport('main', args);
  assert.equal((await requestReport('main', args)).reportId, first.reportId, '成功申请的报表仍然复用，避免限流');
  state.spStatus[first.reportId] = 'FATAL';
  assert.equal((await collectReport('main', first.reportId)).status, 'FATAL');
  const again = await requestReport('main', args);
  assert.equal(again.reused, false);
  assert.notEqual(again.reportId, first.reportId);
  const forced = await requestReport('main', { ...args, reuseHours: 0 });
  assert.notEqual(forced.reportId, again.reportId);
});

test('卖家报表：按内容识别 JSON，不按报表名猜扩展名', async () => {
  const r = await collectReport('main', 'R999');
  assert.equal(r.status, 'DONE');
  assert.equal(path.extname(r.file), '.json');
  assert.ok(!fs.existsSync(r.file.replace(/\.json$/, '.part')));
});

test('广告报表：v1 失败的报表不再复用', async () => {
  const args = { startDate: '2026-10-01', endDate: '2026-10-07', preset: 'campaigns' };
  const first = await requestAdsReport('main', args);
  assert.equal((await collectAdsReport('main', first.reportId)).status, 'FAILED');
  const again = await requestAdsReport('main', args);
  assert.equal(again.reused, false);
  assert.notEqual(again.reportId, first.reportId);
});

test('广告报表：读不到站点映射时报错，而不是返回 0 行', async () => {
  updateConfig((c) => { delete c.stores.main.ads.accounts; });
  state.accounts = 'deny';
  try {
    await assert.rejects(splitBySite(getStore('main'), [{ 'advertiserAccount.entityId': 'ENT1', 'metric.clicks': 3 }], 'US'), /不是 0 行/);
  } finally { state.accounts = 'ok'; }
  const ok = await splitBySite(getStore('main'), [{ 'advertiserAccount.entityId': 'ENT1', 'metric.clicks': 3 }], 'US');
  assert.equal(ok.kept.length, 1);
});

test('档案库：CSV 预览（dryRun）不写入任何产品或事实', () => {
  const f = path.join(dir, 'preview.csv');
  fs.writeFileSync(f, 'sku,asin,title,purchase_cost\nPREVIEW-1,B0PREVIEW1,预览品,9.9\n');
  const pre = ar.importCsv('main', f, { dryRun: true });
  assert.equal(pre.wouldImport, 1);
  assert.equal(pre.wouldRegisterProducts, 1);
  assert.equal(ar.getProduct('main', 'PREVIEW-1'), null);
  assert.equal(ar.factsFor('main', 'PREVIEW-1').length, 0);
  ar.importCsv('main', f, { defaultSource: '测试' });
  assert.equal(ar.getProduct('main', 'PREVIEW-1').asin, 'B0PREVIEW1');
});

test('档案库：完成待办会核对编号和店铺', () => {
  const { id } = ar.addNote('main', { kind: 'todo', text: '复查竞价' });
  assert.throws(() => ar.completeNote('other', id), /没有编号/);
  assert.throws(() => ar.completeNote('main', 987654), /没有编号/);
  assert.throws(() => ar.completeNote('main', 1.5), /正整数/);
  assert.deepEqual(ar.completeNote('main', id), { id, done: true });
  assert.ok(ar.completeNote('main', id).alreadyDoneAt);
});
