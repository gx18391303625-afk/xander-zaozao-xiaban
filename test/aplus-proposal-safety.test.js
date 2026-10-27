import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';

isolate();
const { createContentApi } = await import('../lib/ops-content.js');
const { OPS } = await import('../lib/ops.js');
const { updateConfig } = await import('../lib/config.js');
const { setSwitch } = await import('../lib/switches.js');
const { prepareChange, executeChange, verifyChange, loadProposal, panelDecision } = await import('../lib/proposals.js');
const { p } = await import('../lib/paths.js');
const { writeJson } = await import('../lib/jsonfile.js');
const { HttpError } = await import('../lib/http.js');

// All account data and documents are synthetic. No credentials or real HTTP
// transport are needed: the actual operation runs against an injected API.
const store = { alias: 'synthetic-aplus-proposal', region: 'NA', defaultMarketplace: 'US' };
const MARKETPLACE = 'ATVPDKIKX0DER';
const KEY = 'SYNTHETIC-APLUS-CONTENT';
const ROOT = '/aplus/2020-11-01';
const clone = (value) => structuredClone(value);
const document = (text = 'Initial synthetic text') => ({
  name: 'Synthetic approval document', contentType: 'EBC', locale: 'en-US',
  contentModuleList: [
    { contentModuleType: 'PREMIUM_HERO_VIDEO', premiumHeroVideo: {
      headline: { value: 'Synthetic video headline', decoratorSet: [] },
      heroVideo: { videoMediaId: 'synthetic-media/video-A.asset', imageMediaId: 'synthetic-media/poster-A.asset' },
    } },
    { contentModuleType: 'STANDARD_TEXT', standardText: { body: { textList: [{ value: text, decoratorSet: [] }] } } },
  ],
});

function paddedReadback(value) {
  const out = clone(value);
  out.contentSubType = null;
  out.contentModuleList[0].standardText = null;
  out.contentModuleList[0].premiumHeroVideo.footer = null;
  out.contentModuleList[0].premiumHeroVideo.heroVideo.imageCropSpecification = null;
  out.contentModuleList[1].premiumHeroVideo = null;
  out.contentModuleList[1].standardText.headline = null;
  return out;
}

function fixture(t) {
  isolate();
  updateConfig((cfg) => {
    cfg.stores[store.alias] = clone(store);
    cfg.settings.dryRun = false;
    cfg.settings.approvalMode = 'panel';
  });
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Unexpected network request outside the injected A+ fixture'); });
  const state = { document: document(), asins: ['B000000001'], calls: [], validationErrors: [], validationWarnings: [], videoCrop: 'null', mode: null, status: 'DRAFT' };
  const api = async (alias, method, path, options = {}) => {
    assert.equal(alias, store.alias);
    state.calls.push({ method, path, options: clone(options) });
    assert.equal(options.query.marketplaceId, MARKETPLACE);
    if (method === 'POST' && path === `${ROOT}/contentAsinValidations`) {
      assert.equal(options.isWrite, false);
      return { errors: clone(state.validationErrors), warnings: clone(state.validationWarnings) };
    }
    if (method === 'GET' && path === `${ROOT}/contentDocuments/${KEY}`) {
      const returnedDocument = paddedReadback(state.document);
      if (state.videoCrop === 'omitted') delete returnedDocument.contentModuleList[0].premiumHeroVideo.heroVideo.imageCropSpecification;
      return { contentRecord: {
        contentReferenceKey: KEY, contentDocument: returnedDocument,
        contentMetadata: { marketplaceId: MARKETPLACE, name: state.document.name, status: state.status, updateTime: '2030-01-01T00:00:00Z' },
      } };
    }
    if (method === 'GET' && path === `${ROOT}/contentDocuments/${KEY}/asins`) return { asinMetadataSet: state.asins.map((asin) => ({ asin })) };
    if (method === 'POST' && path === `${ROOT}/contentDocuments/${KEY}`) {
      assert.equal(options.isWrite, true);
      if (state.mode === 'timeout-unapplied') throw new HttpError('Synthetic timeout after dispatch', { status: 0, body: null, method, sent: true });
      state.document = clone(options.body.contentDocument);
      return { contentReferenceKey: KEY, warnings: [] };
    }
    throw new Error(`Unexpected synthetic A+ route: ${method} ${path}`);
  };
  const op = createContentApi({ api, reviewCache: new Map() }).ops[1];
  const index = OPS.findIndex((candidate) => candidate.id === op.id);
  assert.notEqual(index, -1);
  const original = OPS[index];
  OPS[index] = op;
  t.after(() => { OPS[index] = original; });
  const change = { op: op.id, action: 'update', contentReferenceKey: KEY, contentDocument: document('Revised synthetic text') };
  const submitChange = { op: op.id, action: 'submit', contentReferenceKey: KEY };
  return {
    state, op, change, submitChange,
    prepare: () => prepareChange({ store: store.alias, changes: [clone(change)] }),
    prepareSubmit: () => prepareChange({ store: store.alias, changes: [clone(submitChange)] }),
    writes: () => state.calls.filter((call) => call.options.isWrite === true),
  };
}

function approvedFields(proposal) {
  return { hash: proposal.hash, hashVersion: proposal.hashVersion, items: proposal.items.map((item) => ({
    old: item.old, new: item.new, request: item.request, change: item.change,
    marketplace: item.marketplace, target: item.target, creationKey: item.creationKey, precondition: item.precondition,
  })) };
}

function permitSyntheticExecution(f, proposal) {
  setSwitch(f.op.id, true, 'synthetic-test');
  panelDecision(proposal.proposalId, 'approve');
}

test('A+ update preparation and approval gates preserve the exact request, then execute once despite null-padded readback', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  const before = loadProposal(prepared.proposalId);
  const approved = approvedFields(before);
  assert.deepEqual(before.items[0].request.body, { contentDocument: f.change.contentDocument });
  assert.equal(Object.hasOwn(before.items[0].new.contentDocument, 'contentSubType'), false);
  assert.equal(Object.hasOwn(before.items[0].new.contentDocument.contentModuleList[0].premiumHeroVideo.heroVideo, 'imageCropSpecification'), false);
  assert.equal(f.writes().length, 0);
  assert.ok(f.state.calls.some((call) => call.path.endsWith('/contentAsinValidations')));

  const execute = (extra = {}) => executeChange({ proposalId: prepared.proposalId, hash: prepared.hash, approved: true, ...extra });
  await assert.rejects(execute({ approved: false }), /approved=true/);
  await assert.rejects(execute({ hash: 'synthetic-wrong-hash' }), /哈希不匹配/);
  await assert.rejects(execute(), /面板审批/);
  panelDecision(prepared.proposalId, 'approve');
  await assert.rejects(execute(), /开关还关着/);
  assert.equal(f.writes().length, 0);
  assert.equal(loadProposal(prepared.proposalId).status, 'PROPOSED');
  setSwitch(f.op.id, true, 'synthetic-test');

  assert.equal((await execute()).status, 'CONTENT_UPDATED');
  assert.equal(f.writes().length, 1);
  assert.deepEqual(f.writes()[0].options.body, before.items[0].request.body);
  const saved = loadProposal(prepared.proposalId);
  assert.deepEqual(approvedFields(saved), approved);
  assert.equal(saved.items[0].readback.match, true);
  assert.deepEqual(saved.items[0].readback.actual.contentDocument, paddedReadback(f.change.contentDocument));
  assert.equal(saved.items[0].readback.actual.contentDocument.contentSubType, null, 'raw API evidence retains added nulls');
  await assert.rejects(execute(), /不能再次执行/);
  assert.equal(f.writes().length, 1);
});

test('A+ verify reconciles an already-submitted update without rewriting its hash, request, or approval evidence', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  const proposal = loadProposal(prepared.proposalId);
  const approved = approvedFields(proposal);
  // Model a previously sent proposal only inside this isolated synthetic home.
  proposal.status = 'AWAITING_READBACK';
  proposal.items[0].result = { status: 'AWAITING_READBACK' };
  proposal.items[0].sendResult = { ok: true, status: 'CONTENT_UPDATED', action: 'update', contentReferenceKey: KEY, createdIds: [] };
  writeJson(p('proposals', `${proposal.id}.json`), proposal);
  f.state.document = clone(f.change.contentDocument);
  f.state.calls = [];

  assert.equal((await verifyChange({ proposalId: proposal.id })).status, 'CONTENT_UPDATED');
  const saved = loadProposal(proposal.id);
  assert.deepEqual(approvedFields(saved), approved);
  assert.equal(saved.items[0].readback.match, true);
  assert.deepEqual(saved.items[0].readback.actual.contentDocument, paddedReadback(f.change.contentDocument));
  assert.equal(f.writes().length, 0);
  assert.ok(f.state.calls.length > 0);
  assert.ok(f.state.calls.every((call) => call.method === 'GET'), 'verification must not resubmit or validate through POST');
});

test('A+ semantic null equivalence does not relax integrity checks on the stored approved request', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  permitSyntheticExecution(f, prepared);
  const proposal = loadProposal(prepared.proposalId);
  proposal.items[0].request.body.contentDocument.contentSubType = null;
  writeJson(p('proposals', `${proposal.id}.json`), proposal);
  f.state.calls = [];
  await assert.rejects(executeChange({ proposalId: proposal.id, hash: proposal.hash, approved: true }), /完整性\/哈希校验失败/);
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.writes().length, 0);
});

test('A+ official validation rejection blocks both preparation and the execution preflight', async (t) => {
  const f = fixture(t);
  const errors = [{ code: 'SYNTHETIC_VALIDATION_REJECTED', message: 'Synthetic rejection' }];
  f.state.validationErrors = errors;
  const rejected = await f.prepare();
  assert.equal(rejected.ok, false);
  assert.equal(rejected.proposalId, undefined);
  assert.match(rejected.errors[0].error, /SYNTHETIC_VALIDATION_REJECTED/);
  assert.equal(f.writes().length, 0);

  f.state.validationErrors = [];
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  permitSyntheticExecution(f, prepared);
  const approved = approvedFields(loadProposal(prepared.proposalId));
  f.state.validationErrors = errors;
  const result = await executeChange({ proposalId: prepared.proposalId, hash: prepared.hash, approved: true });
  assert.equal(result.status, 'FAILED');
  const saved = loadProposal(prepared.proposalId);
  assert.match(saved.items[0].result.error, /SYNTHETIC_VALIDATION_REJECTED/);
  assert.deepEqual(approvedFields(saved), approved);
  assert.equal(f.writes().length, 0);
});

test('A+ submit preparation accepts null or omitted video crop while retaining review, ASIN, and official validation guards', async (t) => {
  const f = fixture(t);
  for (const crop of ['null', 'omitted']) {
    f.state.videoCrop = crop;
    const prepared = await f.prepareSubmit();
    assert.equal(prepared.ok, true, `video crop ${crop} must reach submit proposal preparation`);
    const proposal = loadProposal(prepared.proposalId);
    const item = proposal.items[0];
    assert.equal(proposal.status, 'PROPOSED');
    assert.equal(item.new.action, 'submit');
    assert.equal(item.request.path, `${ROOT}/contentDocuments/${KEY}/approvalSubmissions`);
    assert.equal(Object.hasOwn(item.request, 'body'), false);
    const heroVideo = item.new.contentDocument.contentModuleList[0].premiumHeroVideo.heroVideo;
    assert.equal(Object.hasOwn(heroVideo, 'imageCropSpecification'), crop === 'null');
    if (crop === 'null') assert.equal(heroVideo.imageCropSpecification, null);
    assert.deepEqual(item.new.contentDocument, item.old.contentDocument, 'submit approval retains the unmodified observed document');
    assert.equal(f.writes().length, 0);
  }

  const invalidCases = [
    { status: 'SUBMITTED', expected: /SUBMITTED/ },
    { status: 'APPROVED', expected: /APPROVED/ },
    { asins: [], expected: /没有关联 ASIN/ },
    { validationWarnings: [{ code: 'SYNTHETIC_SUBMIT_WARNING', message: 'Synthetic warning' }], expected: /SYNTHETIC_SUBMIT_WARNING/ },
    { validationErrors: [{ code: 'SYNTHETIC_SUBMIT_REJECTED', message: 'Synthetic rejection' }], expected: /SYNTHETIC_SUBMIT_REJECTED/ },
  ];
  for (const { expected, ...values } of invalidCases) {
    Object.assign(f.state, { status: 'DRAFT', asins: ['B000000001'], validationWarnings: [], validationErrors: [], calls: [] }, values);
    const rejected = await f.prepareSubmit();
    assert.equal(rejected.ok, false);
    assert.equal(rejected.proposalId, undefined);
    assert.match(rejected.errors[0].error, expected);
    assert.equal(f.writes().length, 0);
    assert.ok(f.state.calls.every((call) => call.method === 'GET' || (call.path === `${ROOT}/contentAsinValidations` && call.options.isWrite === false)));
  }
});

test('A+ uncertain update remains verify-only and reconciles null-padded content without replaying the write', async (t) => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.ok, true);
  permitSyntheticExecution(f, prepared);
  const approved = approvedFields(loadProposal(prepared.proposalId));
  f.state.mode = 'timeout-unapplied';
  const execute = () => executeChange({ proposalId: prepared.proposalId, hash: prepared.hash, approved: true });
  assert.equal((await execute()).status, 'OUTCOME_UNKNOWN');
  assert.equal(f.writes().length, 1);
  assert.equal(loadProposal(prepared.proposalId).items[0].sendResult.stage, 'UPDATE_SENDING');
  await assert.rejects(execute(), /不能再次执行/);
  assert.equal(f.writes().length, 1);

  f.state.calls = [];
  assert.equal((await verifyChange({ proposalId: prepared.proposalId })).status, 'OUTCOME_UNKNOWN');
  assert.ok(f.state.calls.every((call) => call.method === 'GET'));
  f.state.document = clone(f.change.contentDocument);
  f.state.calls = [];
  assert.equal((await verifyChange({ proposalId: prepared.proposalId })).status, 'CONTENT_UPDATED');
  const saved = loadProposal(prepared.proposalId);
  assert.deepEqual(approvedFields(saved), approved);
  assert.equal(saved.items[0].readback.match, true);
  assert.equal(saved.items[0].sendResult.stage, 'UPDATE_SENDING', 'readback must not manufacture a successful send receipt');
  assert.equal(f.writes().length, 0);
  assert.ok(f.state.calls.length > 0);
  assert.ok(f.state.calls.every((call) => call.method === 'GET'));
  await assert.rejects(execute(), /不能再次执行/);
});
