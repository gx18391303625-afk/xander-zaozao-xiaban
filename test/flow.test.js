import fs from 'node:fs';
// 端到端：接入 → 读数据 → 出提案 → 开关拦截 → 批准执行 → 回读；以及各种失败保护。
import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';
import { startMock } from './mock-amazon.js';

isolate();
const mock = await startMock();
process.env.XANDER_SPAPI_HOST = mock.base;
process.env.XANDER_ADS_HOST = mock.base;
process.env.XANDER_LWA_URL = `${mock.base}/auth/o2/token`;

const { updateConfig } = await import('../lib/config.js');
const { setSecret } = await import('../lib/secrets.js');
const { setSwitch, setAll, isOn, setLimits } = await import('../lib/switches.js');
const { prepareChange, executeChange, verifyChange, loadProposal } = await import('../lib/proposals.js');
const { listEntities } = await import('../lib/ads.js');
const { spapi } = await import('../lib/spapi.js');

setSecret('spapi:main', { clientId: 'cid', clientSecret: 'sec', refreshToken: 'Atzr|X' });
setSecret('ads:main', { clientId: 'acid', clientSecret: 'asec', refreshToken: 'Atzr|ADS' });
updateConfig((c) => { c.stores.main = { region: 'NA', sellerId: 'SELLER1', marketplaces: ['US'], defaultMarketplace: 'US', ads: { profiles: { US: '999' } } }; });

test.after(() => mock.server.close());

test('读卖家接口与广告列表', async () => {
  const parts = await spapi('main', 'GET', '/sellers/v1/marketplaceParticipations');
  assert.equal(parts.payload[0].marketplace.countryCode, 'US');
  const kws = await listEntities('main', 'sp.keywords', {});
  assert.equal(kws.count, 1);
  assert.equal(kws.complete, true);
  const call = mock.state.calls.find((c) => c.path === '/adsApi/v1/query/targets');
  assert.ok(call, '应调用 v1 统一接口查询投放');
  assert.deepEqual(call.body.targetTypeFilter.include, ['KEYWORD']);
  assert.equal(call.headers['amazon-ads-clientid'], 'acid');
  assert.equal(call.headers['amazon-advertising-api-scope'], '999');
});

test('卖家报表：边下载边解压写盘，预览只读开头', async () => {
  const { collectReport } = await import('../lib/spapi.js');
  const r = await collectReport('main', 'SPR1');
  assert.equal(r.status, 'DONE');
  assert.equal(r.preview.totalLines, 50001);
  assert.match(r.preview.head, /^sku\tasin/);
  assert.equal(fs.statSync(r.file).size, r.bytes);
  assert.ok(!fs.existsSync(`${r.file}.part`));
});

test('开关关着时：可以出提案，但不能执行', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 1.2, reason: '测试' }] });
  assert.equal(pr.ok, true);
  assert.deepEqual(pr.switchesOff.length, 1);
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true }), /开关还关着/);
  assert.equal(mock.state.targets['111'].bid.bid, 1.0, '不应改动');
});

test('没批准 / 哈希不对 都拒绝', async () => {
  setSwitch('ads.sp.target.bid', true);
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 1.2 }] });
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: false }), /approved=true/);
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: 'deadbeefdeadbeef', approved: true }), /哈希不匹配/);
});

test('批准后执行一次并回读一致；不能重复执行', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 1.2 }] });
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED');
  assert.equal(mock.state.targets['111'].bid.bid, 1.2);
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true }), /不能再次执行/);
});

test('超过安全上限直接拒绝出提案', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 5 }] });
  assert.equal(pr.ok, false);
  assert.match(pr.errors[0].error, /安全上限/);
  setLimits({ bidChangePctMax: 400 });
  const pr2 = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 5 }] });
  assert.equal(pr2.ok, true);
  setLimits({ bidChangePctMax: 50 });
});

test('原值被别人改过：跳过不提交', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 1.3 }] });
  mock.state.targets['111'].bid.bid = 1.25; // 模拟有人在后台改了
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'SKIPPED_STALE');
  assert.equal(mock.state.targets['111'].bid.bid, 1.25);
});

test('提交时服务端 503（其实已生效）→ 结果未知 → 回读确认生效', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 1.4 }] });
  mock.state.mode.targetUpdate = '503-applied';
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED', '回读发现已是新值');
  const puts = mock.state.calls.filter((c) => c.path === '/adsApi/v1/update/targets' && c.body.targets[0].bid.bid === 1.4);
  assert.equal(puts.length, 1, '写请求只能发一次，不能自动重发');
});

test('提交时 503 → 暂读到原值仍保留未知，不能据此重发', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 1.5 }] });
  mock.state.mode.targetUpdate = '503-not-applied';
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'OUTCOME_UNKNOWN');
  assert.equal(mock.state.targets['111'].bid.bid, 1.4);
});

test('提案过期不能执行', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.campaign.budget', campaignId: 'C1', value: 25 }] });
  const fs = await import('node:fs');
  const { p } = await import('../lib/paths.js');
  const f = p('proposals', `${pr.proposalId}.json`);
  const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
  obj.expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(f, JSON.stringify(obj));
  setSwitch('ads.sp.campaign.budget', true);
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true }), /过期/);
  assert.equal(mock.state.campaigns.C1.budgets[0].budgetValue.monetaryBudgetValue.monetaryBudget.value, 20);
});

test('新增否定关键词：防重复、回读新对象', async () => {
  setSwitch('ads.sp.negativeKeyword.create', true);
  const ch = { op: 'ads.sp.negativeKeyword.create', campaignId: 'C1', adGroupId: 'G1', keywordText: 'cat', matchType: 'NEGATIVE_EXACT' }; // 旧写法也能识别
  const pr = await prepareChange({ store: 'main', changes: [ch] });
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED');
  const created = mock.state.calls.find((c) => c.path === '/adsApi/v1/create/targets').body.targets[0];
  assert.equal(created.negative, true);
  assert.equal(created.targetType, 'KEYWORD');
  assert.equal(created.targetDetails.keywordTarget.matchType, 'EXACT');
  assert.equal(created.bid, undefined, '否定词没有竞价');
  const again = await prepareChange({ store: 'main', changes: [ch] });
  assert.equal(again.ok, false);
  assert.match(again.errors[0].error, /已有相同/);
});

test('广告组不属于该活动时拒绝', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', campaignId: 'C9', adGroupId: 'G1', keywordText: 'x', matchType: 'NEGATIVE_EXACT' }] });
  assert.equal(pr.ok, false);
});

test('Listing 改标题：预校验 + 执行 + 回读', async () => {
  setSwitch('listing.attribute', true);
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'listing.attribute', sku: 'BOWL-BLUE', attribute: 'item_name', value: 'New Stainless Dog Bowl' }] });
  assert.equal(pr.ok, true, JSON.stringify(pr.errors));
  assert.ok(mock.state.calls.some((c) => c.method === 'PATCH' && c.query.mode === 'VALIDATION_PREVIEW'), '应先做预校验');
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED');
  assert.equal(mock.state.listing.title, 'New Stainless Dog Bowl');
});

test('改价超过 ±20% 被拒，范围内可执行', async () => {
  setSwitch('listing.price', true);
  const bad = await prepareChange({ store: 'main', changes: [{ op: 'listing.price', sku: 'BOWL-BLUE', value: 9.99 }] });
  assert.equal(bad.ok, false);
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'listing.price', sku: 'BOWL-BLUE', value: 21.99 }] });
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED');
  assert.equal(mock.state.listing.price, 21.99);
});

test('一个提案里有一项不合格，整个提案不生成', async () => {
  const pr = await prepareChange({ store: 'main', changes: [
    { op: 'ads.sp.target.bid', targetId: '111', value: 1.45 },
    { op: 'ads.sp.target.bid', targetId: 'NOPE', value: 1 },
  ] });
  assert.equal(pr.ok, false);
  assert.equal(pr.passed, 1);
});

test('不认识的操作不能用', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'unknown.operation' }] });
  assert.equal(pr.ok, false);
});

test('面板审批模式：没在面板批准不能执行', async () => {
  updateConfig((c) => { c.settings.approvalMode = 'panel'; });
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 1.45 }] });
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true }), /面板审批/);
  const { panelDecision } = await import('../lib/proposals.js');
  panelDecision(pr.proposalId, 'approve');
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED');
  updateConfig((c) => { c.settings.approvalMode = 'chat'; });
});

test('演练模式：只记录不提交', async () => {
  updateConfig((c) => { c.settings.dryRun = true; });
  const before = mock.state.targets['111'].bid.bid;
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 1.1 }] });
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'DRY_RUN');
  assert.equal(mock.state.targets['111'].bid.bid, before);
  updateConfig((c) => { c.settings.dryRun = false; });
});

test('一键全开不含 FBA 和紫鸟；一键全关全部关闭', () => {
  setAll(true);
  assert.equal(isOn('ads.sp.campaign.state'), true);
  assert.equal(isOn('ziniao.control'), false);
  assert.equal(isOn('fba.inbound'), false);
  setAll(false);
  assert.equal(isOn('ads.sp.target.bid'), false);
});

test('verify 可以重复回读', async () => {
  setSwitch('ads.sp.campaign.state', true);
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.campaign.state', campaignId: 'C1', value: 'PAUSED' }] });
  await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  const v = await verifyChange({ proposalId: pr.proposalId });
  assert.equal(v.status, 'API_STATE_VERIFIED');
  assert.equal(loadProposal(pr.proposalId).items[0].result.status, 'API_STATE_VERIFIED');
});

test('v1 写入请求格式：竞价、预算、广告组默认竞价', async () => {
  setSwitch('ads.sp.target.bid', true); setSwitch('ads.sp.campaign.budget', true); setSwitch('ads.sp.adGroup.defaultBid', true);
  const before = mock.state.targets['111'].bid.bid;
  const pr = await prepareChange({ store: 'main', changes: [
    { op: 'ads.sp.target.bid', targetId: '111', value: Math.round(before * 110) / 100 },
    { op: 'ads.sp.campaign.budget', campaignId: 'C1', value: 30 },
    { op: 'ads.sp.adGroup.defaultBid', adGroupId: 'G1', value: 0.9 },
  ] });
  assert.equal(pr.ok, true, JSON.stringify(pr.errors));
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED');
  const upd = (res) => mock.state.calls.filter((c) => c.path === `/adsApi/v1/update/${res}`).at(-1);
  assert.equal(upd('campaigns').method, 'POST');
  assert.equal(upd('campaigns').headers['content-type'], 'application/json');
  assert.deepEqual(upd('campaigns').body.campaigns[0].budgets[0].budgetValue.monetaryBudgetValue.monetaryBudget, { value: 30 });
  assert.equal(upd('campaigns').body.campaigns[0].budgets[0].recurrenceTimePeriod, 'DAILY');
  assert.deepEqual(upd('adGroups').body.adGroups[0].bid, { defaultBid: 0.9 });
  assert.ok(upd('targets').body.targets[0].bid.bid > 0);
});

test('旧操作名（keywordId 写法）自动转换成 v1', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: mock.state.targets['111'].bid.bid + 0.05 }] });
  assert.equal(pr.ok, true, JSON.stringify(pr.errors));
  assert.match(JSON.stringify(pr.table), /targetId/);
});

test('否定投放不能改竞价', async () => {
  mock.state.targets['999'] = { targetId: '999', adGroupId: 'G1', campaignId: 'C1', adProduct: 'SPONSORED_PRODUCTS', negative: true, targetType: 'KEYWORD', state: 'ENABLED', targetDetails: { keywordTarget: { keyword: 'x', matchType: 'EXACT' } } };
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '999', value: 1 }] });
  assert.equal(pr.ok, false);
  assert.match(pr.errors[0].error, /否定投放/);
});

test('v1 报表：自动找广告主账户 → 申请 → 下载', async () => {
  const { requestAdsReport, collectAdsReport } = await import('../lib/ads.js');
  const r = await requestAdsReport('main', { preset: 'campaigns', startDate: '2026-10-14', endDate: '2026-10-20' });
  assert.equal(r.api, 'v1');
  const create = mock.state.calls.find((c) => c.path === '/adsApi/v1/create/reports');
  assert.equal(create.body.accessRequestedAccounts[0].advertiserAccountId, 'amzn1.ads-account.g.TEST');
  assert.ok(create.body.reports[0].query.fields.includes('metric.totalCost'));
  assert.match(r.note, /全球广告账户/);
  const again = await requestAdsReport('main', { preset: 'campaigns', startDate: '2026-10-14', endDate: '2026-10-20' });
  assert.equal(again.reused, true, '12 小时内复用');
  const first = await collectAdsReport('main', r.reportId);
  assert.match(first.note, /还在生成/);
  const done = await collectAdsReport('main', r.reportId);
  assert.equal(done.status, 'COMPLETED');
  assert.ok(create.body.reports[0].query.fields.includes('advertiserAccount.entityId'));
  assert.equal(done.rows, 1, '全球账户混了 UK 的行，只保留 US');
  assert.deepEqual(done.各站点行数, { US: 1, UK: 1 });
  assert.match(done.note, /只保留 US/);
  const kept = JSON.parse(fs.readFileSync(done.file, 'utf8'));
  assert.equal(kept[0].站点, 'US');
  assert.equal(JSON.parse(fs.readFileSync(done.allSitesFile, 'utf8')).length, 2);
  const { loadConfig } = await import('../lib/config.js');
  assert.equal(loadConfig().stores.main.ads.accounts.US.advertiserAccountId, 'amzn1.ads-account.g.TEST', '账户 ID 已缓存');
});

test('搜索词报表：v1 字段未公开，暂自动用 v3 并提示关停日期', async () => {
  const { requestAdsReport, collectAdsReport } = await import('../lib/ads.js');
  const r = await requestAdsReport('main', { preset: 'sp_search_terms', startDate: '2026-10-14', endDate: '2026-10-20' });
  assert.equal(r.api, 'v3');
  assert.match(r.note, /2027-06-30/);
  const done = await collectAdsReport('main', r.reportId);
  assert.equal(done.api, 'v3');
  assert.equal(done.status, 'COMPLETED');
});

test('SP-API：已弃用接口被拒绝并给出新路径；新版订单接口可用', async () => {
  const { checkSpapiPath, checkReportType } = await import('../lib/deprecations.js');
  assert.throws(() => checkSpapiPath('/orders/v0/orders'), /2026-01-01/);
  assert.throws(() => checkSpapiPath('/finances/v0/financialEvents'), /2024-06-19/);
  assert.throws(() => checkSpapiPath('/fba/inbound/v0/shipments'), /2024-03-20/);
  assert.doesNotThrow(() => checkSpapiPath('/orders/2026-01-01/orders'));
  assert.throws(() => checkReportType('GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE'), /FLAT_FILE_V2/);
  assert.doesNotThrow(() => checkReportType('GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2'));
  const data = await spapi('main', 'GET', '/orders/2026-01-01/orders', { query: { createdAfter: '2026-10-01T00:00:00Z' } });
  assert.equal(data.orders[0].orderId, '111-1');
});
