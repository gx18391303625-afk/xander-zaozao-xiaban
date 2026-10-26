import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolate } from './helpers.js';

// A disposable home and a fetch stub are the only configuration and transport.
// No fallback to real fetch, real account data, or the running panel is allowed.
const testHome = isolate();
const OP = 'ads.sp.campaign.name';
const SP = 'SPONSORED_PRODUCTS';
const PROFILE = '900';
const ID = '101';
const ORIGINAL = 'Synthetic paused campaign';
const NEW_NAME = '新的合成活动名称';
const origin = 'https://synthetic-campaign-name.invalid';
const originalFetch = globalThis.fetch;
const savedAdsHost = process.env.XANDER_ADS_HOST;
const savedLwaUrl = process.env.XANDER_LWA_URL;
process.env.XANDER_ADS_HOST = origin;
process.env.XANDER_LWA_URL = `${origin}/auth/o2/token`;
const state = {};
const profile = () => ({ profileId: PROFILE, countryCode: 'US', currencyCode: 'USD', timezone: 'America/Los_Angeles', accountInfo: { type: 'seller', id: 'SYNTHETIC-ACCOUNT', marketplaceStringId: 'ATVPDKIKX0DER' } });
const campaign = () => ({ campaignId: ID, adProduct: SP, name: ORIGINAL, state: 'PAUSED', globalCampaignId: null, marketplaceScope: 'SINGLE_MARKETPLACE', portfolioId: '701', budgets: [{ recurrenceTimePeriod: 'DAILY', budgetType: 'MONETARY', budgetValue: { monetaryBudgetValue: { monetaryBudget: { value: 13, currencyCode: 'USD' } } } }] });
function reset() {
  Object.assign(state, { calls: [], unexpected: [], profiles: [profile()], campaigns: [campaign()], queryResult: undefined, receipt: undefined, apply: true, writeMode: null, pending: null });
}
reset();
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, options = {}) => {
  const address = new URL(url);
  const method = options.method || 'GET';
  if (address.origin !== origin) {
    state.unexpected.push(`${method} ${address.origin}${address.pathname}`);
    return json({ message: 'External access is forbidden in this synthetic test' }, 400);
  }
  if (address.pathname === '/auth/o2/token') return json({ access_token: 'SYNTHETIC_ACCESS_TOKEN', expires_in: 3600 });
  const headers = new Headers(options.headers);
  const body = options.body === undefined ? undefined : JSON.parse(options.body);
  const call = { method, path: address.pathname, body, scope: headers.get('Amazon-Advertising-API-Scope') };
  state.calls.push(call);
  if (method === 'GET' && address.pathname === '/v2/profiles') return json(state.profiles);
  if (method === 'POST' && address.pathname === '/adsApi/v1/query/campaigns') return json(state.queryResult ?? { campaigns: state.campaigns });
  if (method === 'POST' && address.pathname === '/adsApi/v1/update/campaigns') {
    state.pending = structuredClone(body);
    if (state.writeMode === 'timeout') throw Object.assign(new Error('Synthetic lost response'), { name: 'AbortError' });
    if (['408', '409', '503'].includes(state.writeMode)) return json({ message: 'Synthetic uncertain submission' }, Number(state.writeMode));
    if (state.apply) {
      for (const item of body.campaigns) {
        const row = state.campaigns.find((entry) => String(entry.campaignId) === String(item.campaignId));
        if (row) Object.assign(row, structuredClone(item));
      }
    }
    return json(state.receipt === undefined ? { success: [{ index: 0, campaign: { campaignId: body.campaigns[0].campaignId } }], error: [] } : state.receipt, 207);
  }
  state.unexpected.push(`${method} ${address.pathname}`);
  return json({ message: 'Unexpected synthetic route' }, 400);
};

const { updateConfig } = await import('../lib/config.js');
const { setSecret } = await import('../lib/secrets.js');
const { opById } = await import('../lib/ops.js');
const { listSwitches, setSwitch } = await import('../lib/switches.js');
const { prepareChange, executeChange, verifyChange, loadProposal, panelDecision } = await import('../lib/proposals.js');
const input = (extra = {}) => ({ op: OP, marketplace: 'US', campaignId: ID, value: NEW_NAME, reason: 'Synthetic rename only', ...extra });
const draft = (extra = {}) => prepareChange({ store: 'synthetic-name', changes: [input(extra)] });
const writes = () => state.calls.filter((call) => call.path === '/adsApi/v1/update/campaigns');
const execute = (proposal, extra = {}) => executeChange({ proposalId: proposal.proposalId, hash: proposal.hash, approved: true, ...extra });
async function prepared(extra = {}) {
  const proposal = await draft(extra);
  assert.equal(proposal.ok, true, JSON.stringify(proposal.errors));
  return proposal;
}
test.beforeEach(() => {
  reset();
  fs.rmSync(testHome, { recursive: true, force: true });
  fs.mkdirSync(testHome, { recursive: true });
  setSecret('ads:synthetic-name', { clientId: 'SYNTHETIC_CLIENT', clientSecret: 'SYNTHETIC_SECRET', refreshToken: 'SYNTHETIC_REFRESH' });
  updateConfig((config) => {
    config.stores = { 'synthetic-name': { region: 'NA', defaultMarketplace: 'US', marketplaces: ['US'], ads: { profiles: { US: PROFILE } } } };
    config.settings.approvalMode = 'chat';
    config.settings.dryRun = false;
  });
});
test.afterEach(() => assert.deepEqual(state.unexpected, [], 'every request must stay within the synthetic contract'));
test.after(() => {
  globalThis.fetch = originalFetch;
  if (savedAdsHost === undefined) delete process.env.XANDER_ADS_HOST; else process.env.XANDER_ADS_HOST = savedAdsHost;
  if (savedLwaUrl === undefined) delete process.env.XANDER_LWA_URL; else process.env.XANDER_LWA_URL = savedLwaUrl;
  fs.rmSync(testHome, { recursive: true, force: true });
});

test('campaign name is a separately registered API capability whose switch defaults off', async () => {
  const { CAMPAIGN_NAME_OP } = await import('../lib/ops-ads-campaign-name.js');
  assert.equal(opById(OP), CAMPAIGN_NAME_OP);
  const item = listSwitches().items.find((entry) => entry.id === OP);
  assert.equal(item.implemented, true);
  assert.equal(item.capability, 'api');
  assert.equal(item.on, false);
});

test('prepare binds US/USD profile, explicitly queries all SP states and snapshots the old name and identity', async () => {
  const proposal = await prepared({ value: `  ${NEW_NAME}  ` });
  const saved = loadProposal(proposal.proposalId).items[0];
  assert.equal(saved.old, ORIGINAL);
  assert.equal(saved.new, NEW_NAME);
  assert.equal(saved.marketplace, 'US');
  assert.equal(saved.precondition.campaignId, ID);
  assert.equal(saved.precondition.adProduct, SP);
  assert.equal(saved.precondition.state, 'PAUSED');
  assert.ok(Object.hasOwn(saved.precondition, 'globalCampaignId'));
  assert.equal(saved.precondition.globalCampaignId, null);
  assert.equal(saved.request.profileId, PROFILE);
  assert.deepEqual(saved.request.body, { campaigns: [{ campaignId: ID, name: NEW_NAME }] });
  assert.equal(state.calls[0].path, '/v2/profiles');
  assert.equal(state.calls[0].method, 'GET');
  assert.equal(state.calls[0].scope, null, 'profile discovery cannot be scoped to the profile it is validating');
  const query = state.calls.find((call) => call.path === '/adsApi/v1/query/campaigns');
  assert.equal(query.scope, PROFILE);
  assert.deepEqual(query.body.campaignIdFilter, { include: [ID] });
  assert.deepEqual(query.body.adProductFilter, { include: [SP] });
  assert.deepEqual([...query.body.stateFilter.include].sort(), ['ARCHIVED', 'ENABLED', 'PAUSED']);
  assert.equal(writes().length, 0);
});

test('prepare fails closed for absent, duplicate, non-US or non-USD profile bindings and wrong API region', async () => {
  const invalidProfiles = [[], [{ ...profile(), profileId: '901' }], [{ ...profile(), profileId: [PROFILE] }], [{ ...profile(), countryCode: 'CA' }], [{ ...profile(), currencyCode: 'CAD' }], [profile(), profile()]];
  for (const profiles of invalidProfiles) {
    state.profiles = profiles;
    assert.equal((await draft()).ok, false, JSON.stringify(profiles));
  }
  state.profiles = [{ ...profile(), profileId: Number(PROFILE) }];
  await prepared();
  const unsafeProfile = Number.MAX_SAFE_INTEGER + 1;
  state.profiles = [{ ...profile(), profileId: unsafeProfile }];
  updateConfig((config) => { config.stores['synthetic-name'].ads.profiles.US = String(unsafeProfile); });
  assert.equal((await draft()).ok, false, 'unsafe numeric profile IDs cannot prove the configured binding');
  updateConfig((config) => { config.stores['synthetic-name'].ads.profiles.US = PROFILE; });
  state.profiles = [profile()];
  updateConfig((config) => { config.stores['synthetic-name'].region = 'EU'; });
  assert.equal((await draft()).ok, false);
  updateConfig((config) => { config.stores['synthetic-name'].region = 'NA'; });
  assert.equal((await draft({ marketplace: 'CA' })).ok, false);
  updateConfig((config) => { config.stores['synthetic-name'].ads.profiles = {}; });
  assert.equal((await draft()).ok, false);
  assert.equal(writes().length, 0);
});

test('name validation rejects empty, non-string and control-containing names with a local 256-codepoint bound', async () => {
  for (const value of ['', '   ', null, 5, true, [], {}, 'x'.repeat(257), '😀'.repeat(257), 'New\nName', 'New\tName', 'New\u0000Name', 'New\u007fName', 'New\u0085Name', 'New\u009fName']) {
    assert.equal((await draft({ value })).ok, false, JSON.stringify(value));
  }
  for (const value of ['x'.repeat(256), '😀'.repeat(256)]) {
    const proposal = await prepared({ value: ` ${value} ` });
    assert.equal(loadProposal(proposal.proposalId).items[0].new, value);
  }
  assert.equal((await draft({ value: ORIGINAL })).ok, false, 'a no-op rename must not produce a write proposal');
  assert.equal(writes().length, 0);
});

test('campaign IDs reject coercion, fractional and unsafe numbers while preserving long decimal strings', async () => {
  for (const campaignId of [undefined, null, '', ' ', '101abc', true, [], {}, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await draft({ campaignId })).ok, false, JSON.stringify(campaignId));
  }
  const numeric = await prepared({ campaignId: 101 });
  assert.equal(loadProposal(numeric.proposalId).items[0].request.body.campaigns[0].campaignId, ID);
  const large = '9007199254740993123';
  state.campaigns[0].campaignId = large;
  const exact = await prepared({ campaignId: large });
  assert.equal(loadProposal(exact.proposalId).items[0].request.body.campaigns[0].campaignId, large);
  state.campaigns[0].campaignId = Number.MAX_SAFE_INTEGER + 1;
  assert.equal((await draft({ campaignId: String(Number.MAX_SAFE_INTEGER + 1) })).ok, false, 'response IDs must not use unsafe numbers even when String() appears to match');
  assert.equal(writes().length, 0);
});

test('rename refuses extra writable fields instead of silently discarding them', async () => {
  for (const extra of [{ budget: 99 }, { state: 'ENABLED' }, { name: 'Alternative name' }, { portfolioId: '702' }, { campaignIds: ['102'] }, { bid: 3 }, { action: 'update' }]) {
    assert.equal((await draft(extra)).ok, false, JSON.stringify(extra));
  }
  assert.equal(writes().length, 0);
});

test('campaign identity and scope must be unique, local SP and eligible before preparing', async () => {
  const badRows = [[], [{ ...campaign(), campaignId: '102' }], [{ ...campaign(), campaignId: [ID] }], [campaign(), campaign()], [{ ...campaign(), adProduct: 'SPONSORED_BRANDS' }], [{ ...campaign(), adProduct: undefined }], [{ ...campaign(), state: 'ARCHIVED' }], [{ ...campaign(), globalCampaignId: 'synthetic-global' }], [{ ...campaign(), globalCampaignId: false }], [{ ...campaign(), globalCampaignId: 0 }], [{ ...campaign(), marketplaceScope: 'MULTI_MARKETPLACE' }], [{ ...campaign(), marketplaceScope: undefined }], [{ ...campaign(), countries: ['CA'] }], [{ ...campaign(), marketplaces: ['CA'] }], [{ ...campaign(), marketplaces: ['US', 'US'] }], [{ ...campaign(), countries: 'US' }]];
  for (const rows of badRows) {
    state.campaigns = rows;
    assert.equal((await draft()).ok, false, JSON.stringify(rows));
  }
  state.campaigns = [campaign()];
  state.queryResult = { campaigns: [campaign()], nextToken: 'unread-synthetic-page' };
  assert.equal((await draft()).ok, false, 'a matching first page cannot prove a unique complete query');
  state.queryResult = {};
  assert.equal((await draft()).ok, false);
  assert.equal(writes().length, 0);
});

test('other campaign switches cannot authorize renaming and a permitted rename preserves paused state and budget', async () => {
  setSwitch('ads.sp.campaign.budget', true, 'synthetic-test');
  setSwitch('ads.sp.campaign.state', true, 'synthetic-test');
  const proposal = await prepared();
  await assert.rejects(execute(proposal), /开关/);
  assert.equal(writes().length, 0);
  setSwitch(OP, true, 'synthetic-test');
  setSwitch('ads.sp.campaign.budget', false, 'synthetic-test');
  setSwitch('ads.sp.campaign.state', false, 'synthetic-test');
  const before = structuredClone(state.campaigns[0]);
  const result = await execute(proposal);
  assert.equal(result.status, 'API_STATE_VERIFIED');
  assert.deepEqual(state.campaigns[0], { ...before, name: NEW_NAME });
  assert.deepEqual(writes().map(({ method, path: apiPath, body, scope }) => ({ method, path: apiPath, body, scope })), [{ method: 'POST', path: '/adsApi/v1/update/campaigns', body: { campaigns: [{ campaignId: ID, name: NEW_NAME }] }, scope: PROFILE }]);
  const readback = loadProposal(proposal.proposalId).items[0].readback.actual;
  assert.equal(readback.name, NEW_NAME);
  assert.equal(readback.state, 'PAUSED');
  assert.equal(readback.adProduct, SP);
  assert.equal(readback.campaignId, ID);
});

test('rename execution requires explicit approval, matching hash and panel approval when configured', async () => {
  setSwitch(OP, true, 'synthetic-test');
  updateConfig((config) => { config.settings.approvalMode = 'panel'; });
  const proposal = await prepared();
  await assert.rejects(execute(proposal, { approved: false }), /approved=true|批准/);
  await assert.rejects(execute(proposal, { hash: 'synthetic-wrong-hash' }), /哈希/);
  await assert.rejects(execute(proposal), /面板审批/);
  assert.equal(writes().length, 0);
  panelDecision(proposal.proposalId, 'approve');
  assert.equal((await execute(proposal)).status, 'API_STATE_VERIFIED');
  assert.equal(writes().length, 1);
  await assert.rejects(execute(proposal), /不能再次执行/);
});

test('approved request and identity precondition cannot be tampered without invalidating the hash', async () => {
  setSwitch(OP, true, 'synthetic-test');
  for (const mutate of [(item) => { item.request.body.campaigns[0].state = 'ENABLED'; }, (item) => { item.precondition.state = 'ENABLED'; }]) {
    const proposal = await prepared();
    const saved = loadProposal(proposal.proposalId);
    mutate(saved.items[0]);
    fs.writeFileSync(path.join(testHome, 'proposals', `${saved.id}.json`), JSON.stringify(saved));
    await assert.rejects(execute(proposal), /完整性|哈希/);
  }
  assert.equal(writes().length, 0);
});

test('concurrent old-name or enabled/paused changes invalidate the approved snapshot before submission', async () => {
  setSwitch(OP, true, 'synthetic-test');
  for (const mutation of [{ name: 'Synthetic concurrent rename' }, { state: 'ENABLED' }]) {
    state.campaigns = [campaign()];
    const proposal = await prepared();
    Object.assign(state.campaigns[0], mutation);
    assert.equal((await execute(proposal)).status, 'SKIPPED_STALE', JSON.stringify(mutation));
  }
  assert.equal(writes().length, 0);
});

test('scope or global-management changes after approval prevent any rename write', async () => {
  setSwitch(OP, true, 'synthetic-test');
  for (const mutation of [{ globalCampaignId: 'synthetic-global' }, { adProduct: 'SPONSORED_BRANDS' }, { campaignId: '102' }]) {
    state.campaigns = [campaign()];
    const proposal = await prepared();
    Object.assign(state.campaigns[0], mutation);
    const result = await execute(proposal);
    assert.ok(['SKIPPED_STALE', 'FAILED'].includes(result.status), result.status);
    assert.equal(state.campaigns[0].name, ORIGINAL);
  }
  assert.equal(writes().length, 0);
});

test('profile rebinding blocks stale execution and independent verification before querying another account', async () => {
  setSwitch(OP, true, 'synthetic-test');
  const proposal = await prepared();
  updateConfig((config) => { config.stores['synthetic-name'].ads.profiles.US = '901'; });
  const before = state.calls.length;
  assert.equal((await execute(proposal)).status, 'SKIPPED_STALE');
  assert.equal(state.calls.length, before);
  updateConfig((config) => { config.stores['synthetic-name'].ads.profiles.US = PROFILE; });
  state.apply = false;
  const pending = await prepared();
  assert.equal((await execute(pending)).status, 'AWAITING_READBACK');
  state.campaigns[0].name = NEW_NAME;
  updateConfig((config) => { config.stores['synthetic-name'].ads.profiles.US = '901'; });
  const reads = state.calls.length;
  assert.equal((await verifyChange({ proposalId: pending.proposalId })).status, 'AWAITING_READBACK');
  assert.equal(state.calls.length, reads);
  assert.match(loadProposal(pending.proposalId).items[0].readback.error, /profile/);
  assert.equal(writes().length, 1);
});

test('success receipt with an old-name readback waits and later verifies with no second submission', async () => {
  setSwitch(OP, true, 'synthetic-test');
  state.apply = false;
  const proposal = await prepared();
  const approved = loadProposal(proposal.proposalId);
  assert.equal((await execute(proposal)).status, 'AWAITING_READBACK');
  assert.equal(loadProposal(proposal.proposalId).items[0].readback.actual.name, ORIGINAL);
  const readsBefore = state.calls.filter((call) => call.path === '/adsApi/v1/query/campaigns').length;
  state.campaigns[0].name = state.pending.campaigns[0].name;
  assert.equal((await verifyChange({ proposalId: proposal.proposalId })).status, 'API_STATE_VERIFIED');
  assert.ok(state.calls.filter((call) => call.path === '/adsApi/v1/query/campaigns').length > readsBefore);
  const verified = loadProposal(proposal.proposalId);
  assert.equal(verified.hash, approved.hash);
  assert.deepEqual(verified.items[0].request, approved.items[0].request);
  assert.equal(writes().length, 1);
  await assert.rejects(execute(proposal), /不能再次执行/);
});

test('ambiguous, mixed, duplicate-index and wrong-ID update receipts remain unknown and are never replayed', async () => {
  setSwitch(OP, true, 'synthetic-test');
  state.apply = false;
  const success = { index: 0, campaign: { campaignId: ID } };
  const rejection = { index: 0, errors: [{ code: 'INVALID_INPUT', message: 'Synthetic rejection' }] };
  const receipts = [
    null, [], {}, { success: [], error: [] },
    { success: [{ index: 0, campaign: {} }], error: [] },
    { success: [{ index: 0, campaign: { campaignId: '102' } }], error: [] },
    { success: [{ index: 0, campaign: { campaignId: [ID] } }], error: [] },
    { success: [{ index: 0, campaign: { campaignId: ID, adProduct: 'SPONSORED_BRANDS' } }], error: [] },
    { success: [{ ...success, index: 1 }], error: [] },
    { success: [{ ...success, index: '0' }], error: [] },
    { success: [success, success], error: [] },
    { success: [success], error: [rejection] },
    { success: [success], error: null },
    { success: null, error: [rejection] },
    { success: [], error: [{ ...rejection, index: 1 }] },
    { success: [], error: [{ index: 0, errors: [{ code: 'INTERNAL_ERROR' }] }] },
  ];
  for (const [index, receipt] of receipts.entries()) {
    state.receipt = receipt;
    const campaignId = String(1000 + index);
    state.campaigns = [{ ...campaign(), campaignId }];
    const proposal = await prepared({ campaignId, value: `Synthetic uncertain rename ${index}` });
    assert.equal((await execute(proposal)).status, 'OUTCOME_UNKNOWN', JSON.stringify(receipt));
    assert.equal((await verifyChange({ proposalId: proposal.proposalId })).status, 'OUTCOME_UNKNOWN');
    await assert.rejects(execute(proposal), /不能再次执行/);
  }
  const unsafeId = Number.MAX_SAFE_INTEGER + 1;
  state.campaigns = [{ ...campaign(), campaignId: String(unsafeId) }];
  state.receipt = { success: [{ index: 0, campaign: { campaignId: unsafeId } }], error: [] };
  const unsafeReceipt = await prepared({ campaignId: String(unsafeId) });
  assert.equal((await execute(unsafeReceipt)).status, 'OUTCOME_UNKNOWN');
  assert.equal((await verifyChange({ proposalId: unsafeReceipt.proposalId })).status, 'OUTCOME_UNKNOWN');
  await assert.rejects(execute(unsafeReceipt), /不能再次执行/);
  assert.equal(writes().length, receipts.length + 1);
});

test('an unresolved rename blocks the same campaign even with a different new name, without blocking other scopes', async () => {
  setSwitch(OP, true, 'synthetic-test');
  state.apply = false;
  state.receipt = {};
  const unresolved = await prepared();
  assert.equal((await execute(unresolved)).status, 'OUTCOME_UNKNOWN');
  for (const value of [NEW_NAME, 'Synthetic alternative rename']) {
    const duplicate = await draft({ value });
    assert.equal(duplicate.ok, false, 'changing the requested name cannot bypass an unresolved mutation on this campaign');
  }
  assert.equal(writes().length, 1);

  // Another verified US profile may legitimately have the same campaign ID.
  updateConfig((config) => { config.stores['synthetic-name'].ads.profiles.US = '901'; });
  state.profiles = [{ ...profile(), profileId: '901' }];
  await prepared({ value: 'Synthetic other profile rename' });
  updateConfig((config) => { config.stores['synthetic-name'].ads.profiles.US = PROFILE; });
  state.profiles = [profile()];
  assert.equal((await draft()).ok, false, 'returning to the original profile must restore the unresolved guard');

  // Another campaign remains independently actionable, with its own authorization.
  state.campaigns = [{ ...campaign(), campaignId: '102' }];
  setSwitch(OP, false, 'synthetic-test');
  const independent = await prepared({ campaignId: '102', value: 'Synthetic independent rename' });
  await assert.rejects(execute(independent), /开关/);
  setSwitch(OP, true, 'synthetic-test');
  await assert.rejects(execute(independent, { approved: false }), /批准|approved=true/);
  assert.equal(writes().length, 1);
  state.apply = true;
  state.receipt = undefined;
  assert.equal((await execute(independent)).status, 'API_STATE_VERIFIED');
  assert.equal(writes().length, 2);
});

test('a second preapproved rename cannot execute after the first becomes unknown, and verification releases the guard', async () => {
  setSwitch(OP, true, 'synthetic-test');
  updateConfig((config) => { config.settings.approvalMode = 'panel'; });
  state.apply = false;
  state.receipt = {};
  const first = await prepared({ value: 'Synthetic first rename' });
  const second = await prepared({ value: 'Synthetic second rename' });
  panelDecision(first.proposalId, 'approve');
  panelDecision(second.proposalId, 'approve');
  assert.equal((await execute(first)).status, 'OUTCOME_UNKNOWN');
  const blocked = await execute(second);
  assert.ok(blocked.status === 'FAILED' || blocked.status.startsWith('SKIPPED'), blocked.status);
  assert.equal(writes().length, 1, 'a proposal prepared before the uncertain write must still recheck the mutation guard');
  assert.equal((await verifyChange({ proposalId: first.proposalId })).status, 'OUTCOME_UNKNOWN');
  assert.equal(writes().length, 1);

  state.campaigns[0].name = 'Synthetic first rename';
  assert.equal((await verifyChange({ proposalId: first.proposalId })).status, 'API_STATE_VERIFIED');
  assert.equal(writes().length, 1);
  state.apply = true;
  state.receipt = undefined;
  const afterVerification = await prepared({ value: 'Synthetic rename after verification' });
  await assert.rejects(execute(afterVerification), /面板审批/);
  panelDecision(afterVerification.proposalId, 'approve');
  assert.equal((await execute(afterVerification)).status, 'API_STATE_VERIFIED');
  assert.equal(writes().length, 2);
});

test('a successful receipt awaiting readback also blocks a new rename until its name is verified', async () => {
  setSwitch(OP, true, 'synthetic-test');
  state.apply = false;
  const pending = await prepared();
  assert.equal((await execute(pending)).status, 'AWAITING_READBACK');
  assert.equal((await draft({ value: 'Synthetic rename while awaiting readback' })).ok, false);
  assert.equal(writes().length, 1);
  state.campaigns[0].name = NEW_NAME;
  assert.equal((await verifyChange({ proposalId: pending.proposalId })).status, 'API_STATE_VERIFIED');
  await prepared({ value: 'Synthetic rename after delayed readback' });
  assert.equal(writes().length, 1);
});

test('a single matching explicit rejection is FAILED and not replayed by verification', async () => {
  setSwitch(OP, true, 'synthetic-test');
  state.apply = false;
  state.receipt = { success: [], error: [{ index: 0, errors: [{ code: 'INVALID_INPUT', message: 'Synthetic invalid name' }] }] };
  const proposal = await prepared();
  assert.equal((await execute(proposal)).status, 'FAILED');
  assert.equal((await verifyChange({ proposalId: proposal.proposalId })).status, 'FAILED');
  assert.equal(writes().length, 1);
});

test('lost update response or HTTP 408/409/503 remains unknown until independent matching readback', async () => {
  setSwitch(OP, true, 'synthetic-test');
  state.apply = false;
  for (const mode of ['timeout', '408', '409', '503']) {
    state.campaigns = [campaign()];
    state.writeMode = mode;
    const proposal = await prepared({ value: `Synthetic recoverable ${mode}` });
    assert.equal((await execute(proposal)).status, 'OUTCOME_UNKNOWN');
    assert.equal((await verifyChange({ proposalId: proposal.proposalId })).status, 'OUTCOME_UNKNOWN');
    const count = writes().length;
    state.campaigns[0].name = state.pending.campaigns[0].name;
    assert.equal((await verifyChange({ proposalId: proposal.proposalId })).status, 'API_STATE_VERIFIED');
    assert.equal(writes().length, count);
    await assert.rejects(execute(proposal), /不能再次执行/);
  }
  assert.equal(writes().length, 4);
});

test('a matching name in the wrong campaign or ad-product scope never verifies', async () => {
  setSwitch(OP, true, 'synthetic-test');
  state.apply = false;
  const proposal = await prepared();
  assert.equal((await execute(proposal)).status, 'AWAITING_READBACK');
  for (const mutation of [{ campaignId: '102' }, { adProduct: 'SPONSORED_BRANDS' }, { globalCampaignId: 'synthetic-global' }]) {
    state.campaigns = [{ ...campaign(), name: NEW_NAME, ...mutation }];
    assert.notEqual((await verifyChange({ proposalId: proposal.proposalId })).status, 'API_STATE_VERIFIED');
    assert.notEqual(loadProposal(proposal.proposalId).items[0].readback.match, true);
  }
  state.campaigns = [{ ...campaign(), name: NEW_NAME }];
  assert.equal((await verifyChange({ proposalId: proposal.proposalId })).status, 'API_STATE_VERIFIED');
  assert.equal(writes().length, 1);
});
