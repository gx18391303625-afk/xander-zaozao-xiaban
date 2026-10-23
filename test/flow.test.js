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
  const call = mock.state.calls.find((c) => c.path === '/sp/keywords/list');
  assert.ok(call, '应调用了关键词列表');
});

test('开关关着时：可以出提案，但不能执行', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 1.2, reason: '测试' }] });
  assert.equal(pr.ok, true);
  assert.deepEqual(pr.switchesOff.length, 1);
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true }), /开关还关着/);
  assert.equal(mock.state.keywords['111'].bid, 1.0, '不应改动');
});

test('没批准 / 哈希不对 都拒绝', async () => {
  setSwitch('ads.sp.keyword.bid', true);
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 1.2 }] });
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: false }), /approved=true/);
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: 'deadbeefdeadbeef', approved: true }), /哈希不匹配/);
});

test('批准后执行一次并回读一致；不能重复执行', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 1.2 }] });
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED');
  assert.equal(mock.state.keywords['111'].bid, 1.2);
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true }), /不能再次执行/);
});

test('超过安全上限直接拒绝出提案', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 5 }] });
  assert.equal(pr.ok, false);
  assert.match(pr.errors[0].error, /安全上限/);
  setLimits({ bidChangePctMax: 400 });
  const pr2 = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 5 }] });
  assert.equal(pr2.ok, true);
  setLimits({ bidChangePctMax: 50 });
});

test('原值被别人改过：跳过不提交', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 1.3 }] });
  mock.state.keywords['111'].bid = 1.25; // 模拟有人在后台改了
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'SKIPPED_STALE');
  assert.equal(mock.state.keywords['111'].bid, 1.25);
});

test('提交时服务端 503（其实已生效）→ 结果未知 → 回读确认生效', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 1.4 }] });
  mock.state.mode.kwPut = '503-applied';
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED', '回读发现已是新值');
  const puts = mock.state.calls.filter((c) => c.path === '/sp/keywords' && c.method === 'PUT' && c.body.keywords[0].bid === 1.4);
  assert.equal(puts.length, 1, '写请求只能发一次，不能自动重发');
});

test('提交时 503（没生效）→ 回读仍是原值 → 判定失败', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 1.5 }] });
  mock.state.mode.kwPut = '503-not-applied';
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'FAILED');
  assert.equal(mock.state.keywords['111'].bid, 1.4);
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
  assert.equal(mock.state.campaigns.C1.budget.budget, 20);
});

test('新增否定关键词：防重复、回读新对象', async () => {
  setSwitch('ads.sp.negativeKeyword.create', true);
  const ch = { op: 'ads.sp.negativeKeyword.create', campaignId: 'C1', adGroupId: 'G1', keywordText: 'cat', matchType: 'NEGATIVE_EXACT' };
  const pr = await prepareChange({ store: 'main', changes: [ch] });
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED');
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
    { op: 'ads.sp.keyword.bid', keywordId: '111', value: 1.45 },
    { op: 'ads.sp.keyword.bid', keywordId: 'NOPE', value: 1 },
  ] });
  assert.equal(pr.ok, false);
  assert.equal(pr.passed, 1);
});

test('不认识的操作和规划中的功能不能用', async () => {
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'fba.inbound' }] });
  assert.equal(pr.ok, false);
});

test('面板审批模式：没在面板批准不能执行', async () => {
  updateConfig((c) => { c.settings.approvalMode = 'panel'; });
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 1.45 }] });
  await assert.rejects(executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true }), /面板审批/);
  const { panelDecision } = await import('../lib/proposals.js');
  panelDecision(pr.proposalId, 'approve');
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED');
  updateConfig((c) => { c.settings.approvalMode = 'chat'; });
});

test('演练模式：只记录不提交', async () => {
  updateConfig((c) => { c.settings.dryRun = true; });
  const before = mock.state.keywords['111'].bid;
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.keyword.bid', keywordId: '111', value: 1.1 }] });
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'DRY_RUN');
  assert.equal(mock.state.keywords['111'].bid, before);
  updateConfig((c) => { c.settings.dryRun = false; });
});

test('一键全开不含紫鸟；一键全关全部关闭', () => {
  setAll(true);
  assert.equal(isOn('ads.sp.campaign.state'), true);
  assert.equal(isOn('ziniao.control'), false);
  setAll(false);
  assert.equal(isOn('ads.sp.keyword.bid'), false);
});

test('verify 可以重复回读', async () => {
  setSwitch('ads.sp.campaign.state', true);
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.campaign.state', campaignId: 'C1', value: 'PAUSED' }] });
  await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  const v = await verifyChange({ proposalId: pr.proposalId });
  assert.equal(v.status, 'API_STATE_VERIFIED');
  assert.equal(loadProposal(pr.proposalId).items[0].result.status, 'API_STATE_VERIFIED');
});
