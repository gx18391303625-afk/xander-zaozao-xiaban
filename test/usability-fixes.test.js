// 使用体验修复：广告位报表预设、否定商品、参数校验、出价预检。全部走本地假亚马逊。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolate } from './helpers.js';
import { startMock } from './mock-amazon.js';

const dir = isolate();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mock = await startMock();
process.env.XANDER_SPAPI_HOST = mock.base;
process.env.XANDER_ADS_HOST = mock.base;
process.env.XANDER_LWA_URL = `${mock.base}/auth/o2/token`;

const { updateConfig } = await import('../lib/config.js');
const { setSecret } = await import('../lib/secrets.js');
const { setSwitch, setLimits } = await import('../lib/switches.js');
const { prepareChange, executeChange } = await import('../lib/proposals.js');
const { V3_PRESETS } = await import('../lib/ads.js');
const { opById, OPS } = await import('../lib/ops.js');

setSecret('ads:main', { clientId: 'acid', clientSecret: 'asec', refreshToken: 'Atzr|ADS' });
updateConfig((c) => { c.stores.main = { region: 'NA', sellerId: 'SELLER1', marketplaces: ['US'], defaultMarketplace: 'US', ads: { profiles: { US: '999' } } }; });
test.after(() => mock.server.close());

const SP = 'SPONSORED_PRODUCTS';
const createCalls = () => mock.state.calls.filter((c) => c.path === '/adsApi/v1/create/targets');

test('sp_placement 预设不含与 campaignPlacement 分组冲突的 topOfSearchImpressionShare', () => {
  const preset = V3_PRESETS.sp_placement;
  assert.ok(preset.groupBy.includes('campaignPlacement'));
  assert.ok(!preset.columns.includes('topOfSearchImpressionShare'));
  assert.ok(preset.columns.includes('campaignName') && preset.columns.includes('unitsSoldClicks7d'));
});

test('新增否定关键词的重复检查每页不超过 1000（亚马逊 SP 上限）', async () => {
  mock.state.calls.length = 0;
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', campaignId: 'C1', adGroupId: 'G1', keywordText: 'maxresults check', matchType: 'EXACT' }] });
  assert.equal(pr.ok, true, JSON.stringify(pr.errors));
  const queries = mock.state.calls.filter((c) => c.path === '/adsApi/v1/query/targets');
  assert.ok(queries.length > 0);
  for (const q of queries) assert.ok(!(q.body.maxResults > 1000), `maxResults=${q.body.maxResults}`);
});

test('否定商品：广告组级创建 → 回读一致', async () => {
  setSwitch('ads.sp.negativeKeyword.create', true);
  mock.state.calls.length = 0;
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', adGroupId: 'G1', asin: ' b0abcdef12 ' }] });
  assert.equal(pr.ok, true, JSON.stringify(pr.errors));
  assert.match(pr.table[0].提醒.join(''), /否定商品/);
  const dupQuery = mock.state.calls.find((c) => c.path === '/adsApi/v1/query/targets');
  assert.deepEqual(dupQuery.body.targetTypeFilter.include, ['PRODUCT']);
  assert.deepEqual(dupQuery.body.negativeFilter.include, [true]);
  assert.equal(dupQuery.body.maxResults, 1000);
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED', JSON.stringify(r));
  const sent = createCalls().at(-1).body.targets[0];
  assert.deepEqual(sent, { adProduct: SP, state: 'ENABLED', negative: true, targetType: 'PRODUCT', adGroupId: 'G1',
    targetDetails: { productTarget: { matchType: 'PRODUCT_EXACT', productIdType: 'ASIN', product: { productId: 'B0ABCDEF12' } } } });
  assert.equal(r.items[0].回读值.includes('B0ABCDEF12'), true);
});

test('否定商品：重复（忽略大小写）被拒；活动级创建不带 adGroupId', async () => {
  const dup = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', adGroupId: 'G1', asin: 'b0abcdef12' }] });
  assert.equal(dup.ok, false);
  assert.match(dup.errors[0].error, /已有相同/);
  const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', campaignId: 'C1', asin: 'B0ABCDEF12' }] });
  assert.equal(pr.ok, true, JSON.stringify(pr.errors));
  assert.equal(pr.table[0].对象.campaignId, 'C1');
  const r = await executeChange({ proposalId: pr.proposalId, hash: pr.hash, approved: true });
  assert.equal(r.status, 'API_STATE_VERIFIED', JSON.stringify(r));
  const sent = createCalls().at(-1).body.targets[0];
  assert.equal(sent.adGroupId, undefined);
  assert.equal(sent.campaignId, 'C1');
  const again = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', campaignId: 'C1', asin: 'b0abcdef12' }] });
  assert.equal(again.ok, false);
});

test('否定商品：非法 ASIN、缺少层级被拒；readback 要求 ASIN 与匹配方式一致', async () => {
  for (const asin of ['B0ABC', 'B0ABCDEF1!', 'B0ABCDEF123', '', undefined]) {
    const pr = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', adGroupId: 'G1', asin }] });
    assert.equal(pr.ok, false, String(asin));
  }
  assert.equal((await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', asin: 'B0ZZZZZZZZ' }] })).ok, false);
  const op = opById('ads.sp.negativeKeyword.create');
  const { getStore } = await import('../lib/config.js');
  const created = Object.values(mock.state.targets).find((t) => t.negative && t.targetType === 'PRODUCT' && t.adGroupId === 'G1');
  const c = { adGroupId: 'G1', asin: 'B0ABCDEF12', marketplace: 'US' };
  const expected = { asin: 'B0ABCDEF12', matchType: 'PRODUCT_EXACT', state: 'ENABLED' };
  assert.equal((await op.readback(getStore('main'), c, expected, { createdIds: [created.targetId] })).match, true);
  assert.equal((await op.readback(getStore('main'), c, { ...expected, asin: 'B0OTHER000' }, { createdIds: [created.targetId] })).match, false);
  assert.equal((await op.readback(getStore('main'), c, expected, { createdIds: [] })).match, false);
});

test('否定词合并为一个开关：无独立 negativeProduct 开关；两种填法互斥；旧名称仍可用', async () => {
  const { listSwitches } = await import('../lib/switches.js');
  const items = listSwitches().items;
  assert.ok(!items.some((x) => /negativeProduct/.test(x.id)));
  assert.equal(items.find((x) => x.id === 'ads.sp.negativeKeyword.create').label, '新增否定关键词 / 否定 ASIN（广告组级 / 活动级）');
  const both = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', adGroupId: 'G1', asin: 'B0QQQQQQQQ', keywordText: 'x', matchType: 'EXACT' }] });
  assert.equal(both.ok, false);
  assert.match(both.errors[0].error, /不能同时填 keywordText 和 asin/);
  const neither = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', adGroupId: 'G1' }] });
  assert.equal(neither.ok, false);
  assert.match(neither.errors[0].error, /二选一/);
  const alias = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeProduct.create', adGroupId: 'G1', asin: 'B0QQQQQQQQ' }] });
  assert.equal(alias.ok, true, JSON.stringify(alias.errors));
  assert.equal(alias.table[0].操作, '新增否定关键词 / 否定 ASIN（广告组级 / 活动级）');
  const kw = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.negativeKeyword.create', adGroupId: 'G1', keywordText: 'merged kw', matchType: 'PHRASE' }] });
  assert.equal(kw.ok, true, JSON.stringify(kw.errors));
  const item = (await import('../lib/proposals.js')).loadProposal(kw.proposalId).items[0];
  assert.deepEqual(item.request.body.targets[0].targetDetails, { keywordTarget: { keyword: 'merged kw', matchType: 'PHRASE' } });
  assert.deepEqual(opById('ads.sp.negativeKeyword.create').creationIdentity({ adGroupId: 'G1', keywordText: ' Merged KW ', matchType: 'NEGATIVE_PHRASE' }), { level: 'adGroup', parentId: 'G1', keyword: 'merged kw', matchType: 'PHRASE' });
  assert.equal(opById('ads.sp.negativeKeyword.create').creationIdentity({ adGroupId: 'G1', asin: 'b0qqqqqqqq' }).kind, 'asin');
});

test('紫鸟控制参数：列出 6 个动作', async () => {
  const op = OPS.find((o) => o.id === 'ads.sp.negativeKeyword.create');
  assert.equal(op.risk, '低');
  assert.equal(op.group, '广告 · SP 商品推广');
  for (const a of ['goto', 'click', 'clickText', 'type', 'press', 'wait']) assert.ok(OPS.find((o) => o.id === 'ziniao.control').params.steps.includes(a), a);
});

test('prepare_change：嵌套 params 被展平，冲突时报错', async () => {
  setSwitch('ads.sp.target.state', true);
  const flat = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.state', params: { targetId: '111', value: 'PAUSED' } }] });
  assert.equal(flat.ok, true, JSON.stringify(flat.errors));
  assert.equal(flat.table[0].对象.targetId, '111');
  const { loadProposal } = await import('../lib/proposals.js');
  assert.equal(loadProposal(flat.proposalId).items[0].change.params, undefined);
  const same = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.state', targetId: '111', params: { targetId: '111', value: 'PAUSED' } }] });
  assert.equal(same.ok, true);
  const bad = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.state', targetId: '222', params: { targetId: '111', value: 'PAUSED' } }] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].error, /params.*targetId/);
});

function mcpCall(messages) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, XANDER_HOME: dir, XANDER_SECRET_BACKEND: 'file' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => resolve(Object.fromEntries(out.trim().split('\n').map((l) => JSON.parse(l)).map((l) => [l.id, l]))));
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
    setTimeout(() => child.stdin.end(), 1500);
  });
}

test('MCP：additionalProperties:false 的工具拒绝未知参数，xander_spapi_report 提示 dataStartTime/dataEndTime', async () => {
  const res = await mcpCall([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'xander_spapi_report', arguments: { action: 'request', reportType: 'GET_SALES_AND_TRAFFIC_REPORT', startDate: '2026-10-01', endDate: '2026-10-07' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'xander_switches', arguments: { bogus: 1 } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'xander_switches', arguments: {} } },
  ]);
  assert.equal(res[1].result.isError, true);
  assert.match(res[1].result.content[0].text, /startDate、endDate/);
  assert.match(res[1].result.content[0].text, /dataStartTime/);
  assert.equal(res[2].result.isError, true);
  assert.match(res[2].result.content[0].text, /bogus/);
  assert.notEqual(res[3].result.isError, true);
});

test('xander_spapi_report 处理函数本身也拒绝错误的时间参数名', async () => {
  const { buildTools } = await import('../server/tools.js');
  const tool = buildTools('t').find((t) => t.name === 'xander_spapi_report');
  await assert.rejects(tool.handler({ action: 'request', reportType: 'GET_SALES_AND_TRAFFIC_REPORT', startDate: '2026-10-01' }), /dataStartTime.*dataEndTime/);
});

test('ziniao 说明指向 ziniao.control 写入路径', async () => {
  const { buildTools } = await import('../server/tools.js');
  const snap = buildTools('t').find((t) => t.name === 'xander_ziniao_snapshot');
  assert.match(snap.description, /ziniao\.control/);
  for (const a of ['goto', 'click', 'clickText', 'type', 'press', 'wait']) assert.ok(snap.description.includes(a), a);
});

function setCampaign(strategy, top) {
  mock.state.campaigns.C1.optimizations = { bidSettings: { bidStrategy: strategy, bidAdjustments: { placementBidAdjustments: [{ placement: 'TOP_OF_SEARCH', percentage: top }] } } };
}

test('出价预检：复现事故（0.62/TOP+50%/提高和降低 → 0.45/TOP+150%/只降低）提示 1.86 → 1.13', async () => {
  setSwitch('ads.sp.placement', true); setSwitch('ads.sp.target.bid', true);
  setLimits({ bidChangePctMax: 200 });
  setCampaign('SALES_UP_AND_DOWN', 50);
  mock.state.targets['111'].bid.bid = 0.62;
  const pr = await prepareChange({ store: 'main', changes: [
    { op: 'ads.sp.placement', campaignId: 'C1', bidStrategy: 'SALES_DOWN_ONLY', placementBidAdjustments: [{ placement: 'TOP_OF_SEARCH', percentage: 150 }] },
    { op: 'ads.sp.target.bid', targetId: '111', value: 0.45 },
  ] });
  assert.equal(pr.ok, true, JSON.stringify(pr.errors));
  const all = pr.table.flatMap((row) => row.提醒).join('\n');
  assert.match(all, /Bowl - Exact · 搜索顶部：每次点击最高出价 \$1\.86 → \$1\.13（-39%）/);
  assert.match(all, /动态加价（搜索顶部最高 \+100%，其他位置最高 \+50%）将不再生效/);
  assert.ok(pr.nextStep.some((s) => /出价预检/.test(s)));
  const { loadProposal } = await import('../lib/proposals.js');
  const stored = loadProposal(pr.proposalId);
  assert.ok(stored.hash && stored.hashVersion === 3);
});

test('出价预检：带 observedCpc 时点明实际 CPC；温和改动不产生预检警告', async () => {
  setCampaign('SALES_UP_AND_DOWN', 50);
  mock.state.targets['111'].bid.bid = 0.62;
  const observed = await prepareChange({ store: 'main', changes: [
    { op: 'ads.sp.placement', campaignId: 'C1', bidStrategy: 'SALES_DOWN_ONLY', placementBidAdjustments: [{ placement: 'TOP_OF_SEARCH', percentage: 150 }], observedCpc: { TOP_OF_SEARCH: 1.6 } },
    { op: 'ads.sp.target.bid', targetId: '111', value: 0.5 },
  ] });
  assert.equal(observed.ok, true, JSON.stringify(observed.errors));
  assert.match(observed.table.flatMap((row) => row.提醒).join('\n'), /低于近期实际 CPC \$1\.60/);

  setCampaign('SALES_DOWN_ONLY', 50);
  mock.state.targets['111'].bid.bid = 1.0;
  const benign = await prepareChange({ store: 'main', changes: [{ op: 'ads.sp.target.bid', targetId: '111', value: 0.95 }] });
  assert.equal(benign.ok, true, JSON.stringify(benign.errors));
  assert.ok(!benign.table.flatMap((row) => row.提醒).some((w) => /最高出价|动态加价|出价预检/.test(w)));
});
