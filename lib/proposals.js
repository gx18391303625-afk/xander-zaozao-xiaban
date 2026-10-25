// 改动提案：读原值 → 生成精确提案（含哈希、有效期）→ 用户批准 → 执行一次 → 独立回读。
// 结果状态：
//   PROPOSED           已生成，未执行
//   SUBMITTED          已提交，等待回读
//   API_STATE_VERIFIED 回读一致（接口层面生效，不等于买家页面已显示）
//   AWAITING_READBACK  已提交但回读还不一致（常见于 Listing 延迟），稍后再查
//   MISMATCH           回读结果与批准值不同
//   FAILED             亚马逊明确拒绝，未生效
//   OUTCOME_UNKNOWN    超时/断网，不知道是否生效 —— 不能重发，先查清楚
//   SKIPPED_STALE      执行前发现原值已被别人改过，跳过，需要重新出提案
//   DRY_RUN            演练模式，只记录未提交
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { p, FILES } from './paths.js';
import { readJson, writeJson, appendJsonLine, canonical, sha256, readJsonLines } from './jsonfile.js';
import { loadConfig, getStore } from './config.js';
import { opById, normalizeChange } from './ops.js';
import { isOn, limits as getLimits } from './switches.js';
import { HttpError } from './http.js';
import * as ziniao from './ziniao.js';
import { lockStore } from './execution-lock.js';

const UNRESOLVED = new Set(['EXECUTING', 'SUBMITTING', 'OUTCOME_UNKNOWN', 'PARTIALLY_SUCCEEDED', 'SUBMITTED', 'AWAITING_READBACK', 'MISMATCH']);
const RECHECK = new Set([...UNRESOLVED, 'IMAGES_ACCEPTED', 'SUBMITTED_FOR_REVIEW', 'APPROVED', 'DRAFT_CREATED', 'CONTENT_UPDATED', 'ASINS_ASSOCIATED', 'HANDOFF_READY', 'PLATFORM_STATUS_OBSERVED']);

function creationKey(op, store, c, request) {
  if (!(typeof op.creates === 'function' ? op.creates(c) : op.creates)) return null;
  return sha256(canonical({ store, op: op.id, marketplace: String(c.marketplace || '').toUpperCase(), identity: op.creationIdentity ? op.creationIdentity(c) : request }));
}

function proposalHash(pr) {
  const items = pr.items.map(({ index, op, old, new: nv, request, change, marketplace, target, creationKey, precondition }) =>
    pr.hashVersion === 3 ? { index, op, old, new: nv, request, change, marketplace, target, creationKey, precondition }
      : pr.hashVersion === 2 ? { index, op, old, new: nv, request, change, marketplace, target, creationKey } : { index, op, old, new: nv, request });
  return sha256(canonical({ store: pr.store, items })).slice(0, 16);
}
function assertIntegrity(pr) {
  if (proposalHash(pr) !== pr.hash) throw new Error('提案内容完整性/哈希校验失败；请重新生成并取得批准，不能执行已变化的内容。');
}

function unresolvedCreatedParent(other, item, candidate) {
  // A new parent ID is unknown when a full-chain proposal is prepared. Its
  // stable name key cannot prevent a later child-only proposal using that ID.
  if (candidate?.op !== 'ads.sp.campaign.create' || item.op !== candidate.op || other.store !== candidate.store) return false;
  if (String(item.marketplace || item.change?.marketplace || '').toUpperCase() !== String(candidate.marketplace || '').toUpperCase()) return false;
  const mode = candidate.change?.mode || 'campaign';
  const previousMode = item.change?.mode || item.new?.mode || 'campaign';
  const ids = { ...item.new?.parent, ...item.result?.createdIds, ...item.sendResult?.createdIds };
  const campaignId = ids.campaignId || item.readback?.actual?.campaign?.campaignId;
  const adGroupId = ids.adGroupId || item.readback?.actual?.adGroup?.adGroupId;
  if (mode === 'ads' && ['campaign', 'adGroup'].includes(previousMode)) return !!adGroupId && String(candidate.change.adGroupId) === String(adGroupId);
  if (mode === 'adGroup' && previousMode === 'campaign') return !!campaignId && String(candidate.change.campaignId) === String(campaignId);
  return false;
}

function assertNoUnresolvedCreation(key, exceptId, candidate) {
  if (!key || !fs.existsSync(p('proposals'))) return;
  for (const name of fs.readdirSync(p('proposals')).filter((n) => n.endsWith('.json'))) {
    const other = readJson(p('proposals', name), null);
    if (!other || other.id === exceptId) continue;
    if (other.items.some((it) => {
      const unresolved = UNRESOLVED.has(it.result?.status) && !(it.result?.status === 'PARTIALLY_SUCCEEDED' && it.readback?.reconciled === true)
        || (other.status === 'EXECUTING' && !it.result);
      if (!unresolved) return false;
      // Recompute stable identities for older proposals that used the whole
      // request (including mutable bids). Never rewrite their approved hash.
      const oldOp = opById(it.op);
      const stableKey = oldOp?.creationIdentity && it.change ? creationKey(oldOp, other.store, { ...it.change, marketplace: it.marketplace || it.change.marketplace }, it.request) : null;
      return it.creationKey === key || stableKey === key || unresolvedCreatedParent(other, it, candidate);
    })) {
      throw new Error(`相同创建目标在提案 ${other.id} 中仍未核验。只能先用 xander_verify_change 查清楚，不能换提案重复提交。`);
    }
  }
}

const file = (id) => {
  if (!/^P\d{14}[a-f0-9]{4}$/.test(id)) throw new Error(`提案编号格式不对：${id}`);
  return p('proposals', `${id}.json`);
};

export function loadProposal(id) {
  const f = file(id);
  if (!fs.existsSync(f)) throw new Error(`找不到提案 ${id}`);
  return readJson(f, null);
}

function saveProposal(pr) {
  writeJson(file(pr.id), pr);
}

function newId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `P${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${crypto.randomBytes(2).toString('hex')}`;
}

function fmt(v) {
  if (v === null || v === undefined) return '（无）';
  if (Array.isArray(v)) return v.map((x, i) => `${i + 1}. ${x}`).join(' / ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export async function prepareChange({ store: alias, marketplace, changes, note }) {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('changes 不能为空');
  const lim = getLimits();
  if (changes.length > lim.maxChangesPerProposal) throw new Error(`一次最多 ${lim.maxChangesPerProposal} 项改动，请拆分。`);
  const store = getStore(alias);
  const cfg = loadConfig();
  const items = [];
  const errors = [];

  for (let i = 0; i < changes.length; i++) {
    const c = normalizeChange({ ...changes[i], marketplace: changes[i].marketplace || marketplace || store.defaultMarketplace });
    const op = opById(c.op);
    if (!op) { errors.push({ index: i, op: c.op, error: '不认识的操作，或这项功能还在规划中。用 xander_switches 查看可用操作。' }); continue; }
    try {
      if (op.channel === 'ziniao') {
        const steps = ziniao.validateSteps(c.steps);
        if (!c.browserId) throw new Error('缺少 browserId（紫鸟店铺 ID）');
        if (!c.description) throw new Error('请用 description 说明这串操作要完成什么');
        items.push({ index: i, op: op.id, label: op.label, switchOn: isOn(op.id), marketplace: c.marketplace || null,
          target: { browserId: String(c.browserId) }, old: null, new: { description: c.description, steps },
          warnings: ['紫鸟操作是模拟人工点击，页面改版可能导致失败；执行后必须人工或回读核对结果。'],
          request: { browserId: String(c.browserId), steps }, change: c, reason: c.reason || null });
        continue;
      }
      const r = await op.read(store, c);
      c.marketplace = r.marketplace;
      // Freeze the approved locale for later reads, including a timed-out PATCH
      // that never returned a sendResult. It is covered by the proposal hash.
      if (op.id === 'listing.attribute') c.languageTag = r.entity.languageTag;
      const { newValue, warnings } = op.check(c, r, lim);
      const request = op.build(c, r, newValue);
      const key = creationKey(op, store.alias, c, request);
      assertNoUnresolvedCreation(key, undefined, { store: store.alias, marketplace: r.marketplace, op: op.id, change: c });
      if (key && items.some((it) => it.creationKey === key)) throw new Error('同一提案不能重复创建相同目标。');
      let preview = null;
      if (op.preview) preview = await op.preview(store, request);
      const pErr = (preview?.issues || []).filter((x) => x.severity === 'ERROR');
      if (pErr.length) throw new Error(`亚马逊预校验不通过：${pErr.map((x) => `${x.code} ${x.message}`).join('；')}`);
      items.push({
        index: i, op: op.id, label: op.label, switchOn: isOn(op.id), marketplace: r.marketplace,
        target: summarizeTarget(c, r), old: r.old, new: newValue, warnings: [...warnings, ...(preview?.issues || []).map((x) => `预校验提示：${x.message}`)],
        request, change: c, reason: c.reason || null, creationKey: key, ...(r.precondition === undefined ? {} : { precondition: r.precondition }),
      });
    } catch (e) {
      errors.push({ index: i, op: c.op, error: e.message });
    }
  }

  if (errors.length) {
    return { ok: false, message: '有改动没通过检查，整个提案没有生成。请修正后重新提交。', errors, passed: items.length };
  }

  const id = newId();
  const now = Date.now();
  const pr = {
    id, hashVersion: 3, status: 'PROPOSED', store: store.alias,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + cfg.settings.proposalTtlMinutes * 60000).toISOString(),
    approvalMode: cfg.settings.approvalMode, panelApproved: false, note: note || null, items,
  };
  pr.hash = proposalHash(pr);
  saveProposal(pr);
  appendJsonLine(FILES.ledger(), { at: pr.createdAt, event: 'PROPOSED', proposalId: id, store: store.alias, items: items.length });

  const offSwitches = [...new Set(items.filter((x) => !x.switchOn).map((x) => `${x.op}（${x.label}）`))];
  return {
    ok: true, proposalId: id, hash: pr.hash, expiresAt: pr.expiresAt, approvalMode: pr.approvalMode,
    table: items.map((x) => ({ '#': x.index + 1, 操作: x.label, 站点: x.marketplace, 对象: x.target, 原值: fmt(x.old), 新值: fmt(x.new), 理由: x.reason, 提醒: x.warnings })),
    switchesOff: offSwitches,
    nextStep: [
      '把上面的表格完整展示给用户，等用户明确说“批准/确认执行”这一份提案。',
      offSwitches.length ? `执行前用户需要先在开关面板打开：${offSwitches.join('、')}。AI 不能代开。` : null,
      pr.approvalMode === 'panel' ? '当前是“面板审批”模式：用户还需要在开关面板里点“批准”。' : null,
      `批准后调用 xander_execute_change，传 proposalId=${id}、hash=${pr.hash}、approved=true。提案 ${cfg.settings.proposalTtlMinutes} 分钟内有效。`,
    ].filter(Boolean),
  };
}

function summarizeTarget(c, r) {
  const keys = ['action', 'mode', 'name', 'campaignName', 'adGroupName', 'campaignId', 'adGroupId', 'targetId', 'adId', 'portfolioId', 'ruleId', 'contentReferenceKey', 'sku', 'attribute', 'keywordText', 'matchType'];
  const t = {};
  for (const k of keys) if (c[k] !== undefined) t[k] = c[k];
  if (r.entity?.name) t.name = r.entity.name;
  if (r.entity?.asin) t.asin = r.entity.asin;
  return t;
}

export async function executeChange(args) {
  const pr = loadProposal(args.proposalId);
  const unlock = lockStore(pr.store);
  try { return await executeLocked(args); } finally { unlock(); }
}

async function executeLocked({ proposalId, hash, approved }) {
  if (approved !== true) throw new Error('必须在用户明确批准后，传 approved=true 才能执行。');
  const pr = loadProposal(proposalId);
  if (pr.hash !== hash) throw new Error('哈希不匹配：提案内容可能已变，或传错了提案。请重新展示提案并取得批准。');
  assertIntegrity(pr);
  if (pr.status !== 'PROPOSED') throw new Error(`这个提案的状态是 ${pr.status}，不能再次执行（防止重复提交）。如需再改，请重新出提案。`);
  if (Date.now() > Date.parse(pr.expiresAt)) {
    pr.status = 'EXPIRED'; saveProposal(pr);
    throw new Error('提案已过期，原值可能已变化。请重新出提案并再次取得批准。');
  }
  const cfg = loadConfig();
  if (cfg.settings.approvalMode === 'panel' && !pr.panelApproved) {
    throw new Error('当前是“面板审批”模式，请用户先在开关面板里点“批准”这个提案。');
  }
  const off = [...new Set(pr.items.filter((x) => !isOn(x.op)).map((x) => x.op))];
  if (off.length) throw new Error(`以下开关还关着，不能执行：${off.join('、')}。请用户在开关面板里打开（AI 不能代开）。`);

  const store = getStore(pr.store);
  pr.status = 'EXECUTING';
  pr.executedAt = new Date().toISOString();
  pr.dryRun = !!cfg.settings.dryRun;
  saveProposal(pr);

  let stop = false;
  for (const it of pr.items) {
    if (stop) { it.result = { status: 'NOT_RUN', note: '前面的改动出现异常，后续改动未执行。' }; saveProposal(pr); continue; }
    const op = opById(it.op);
    try {
      if (pr.dryRun) {
        it.result = { status: 'DRY_RUN', note: '演练模式：只记录，未提交亚马逊。' };
        saveProposal(pr);
        continue;
      }
      if (op.channel === 'ziniao') {
        const res = await ziniao.runSteps(it.request.browserId, it.request.steps);
        it.result = { status: res.ok ? 'SUBMITTED' : 'FAILED', detail: res, note: '紫鸟操作完成后需要人工或接口回读核对。' };
        if (!res.ok) stop = true;
        continue;
      }
      // 执行前再读一次，确认原值没被别人改过
      assertNoUnresolvedCreation(it.creationKey, pr.id, { store: pr.store, marketplace: it.marketplace, op: it.op, change: it.change });
      const now = await op.read(store, it.change);
      if (canonical(now.old) !== canonical(it.old) || (it.precondition !== undefined && canonical(now.precondition) !== canonical(it.precondition))) {
        it.result = { status: 'SKIPPED_STALE', note: canonical(now.old) !== canonical(it.old)
          ? `原值已从 ${fmt(it.old)} 变成 ${fmt(now.old)}，为安全跳过。请重新出提案。`
          : '属性实例、语言、站点或商品类型已变化，为避免覆盖未批准的内容而跳过。请重新出提案。' };
        stop = true;
        continue;
      }
      // Persist before sending: a crash is uncertainty, never permission to retry.
      it.result = { status: 'SUBMITTING', at: new Date().toISOString() };
      saveProposal(pr);
      const checkpoint = async (progress) => {
        it.sendResult = structuredClone(progress);
        it.result = { status: progress.status || 'SUBMITTING', at: new Date().toISOString(), note: progress.note };
        saveProposal(pr);
        appendJsonLine(FILES.ledger(), { at: new Date().toISOString(), event: 'CHECKPOINT', proposalId: pr.id, op: it.op, stage: progress.stage, status: it.result.status });
      };
      const sent = await op.send(store, it.request, { checkpoint });
      it.result = { status: sent.status || (sent.ok ? 'SUBMITTED' : 'FAILED'), createdIds: sent.createdIds, error: sent.error, note: sent.note, at: new Date().toISOString() };
      const { response: _response, ...receipt } = sent;
      it.sendResult = { ...it.sendResult, ...receipt };
      if (!sent.ok) stop = true;
    } catch (e) {
      const unknown = e instanceof HttpError ? e.sent : it.result?.status === 'SUBMITTING' || UNRESOLVED.has(it.sendResult?.status);
      it.result = { status: unknown ? 'OUTCOME_UNKNOWN' : 'FAILED', error: e.message, at: new Date().toISOString(),
        note: unknown ? '不知道亚马逊是否已生效。不要重发！先用 xander_verify_change 回读确认。' : undefined };
      stop = true;
    }
    saveProposal(pr);
    appendJsonLine(FILES.ledger(), { at: new Date().toISOString(), event: it.result.status, proposalId: pr.id, store: pr.store, op: it.op, target: it.target, old: it.old, new: it.new, error: it.result.error });
  }
  saveProposal(pr);
  if (!pr.dryRun) await readbackAll(pr, store);
  pr.status = overall(pr);
  saveProposal(pr);
  appendJsonLine(FILES.ledger(), { at: new Date().toISOString(), event: 'EXECUTED', proposalId: pr.id, status: pr.status });
  return report(pr);
}

async function readbackAll(pr, store) {
  for (const it of pr.items) {
    const st = it.result?.status;
    if (!RECHECK.has(st)) continue;
    const op = opById(it.op);
    if (op.channel === 'ziniao') continue;
    try {
      const rb = await op.readback(store, it.change, it.new, it.sendResult);
      it.readback = { at: new Date().toISOString(), actual: rb.actual, match: rb.match, note: rb.note, reconciled: rb.reconciled === true };
      if (['OUTCOME_UNKNOWN', 'SUBMITTING'].includes(st) && !rb.match && rb.status !== 'PARTIALLY_SUCCEEDED') it.result.status = 'OUTCOME_UNKNOWN';
      else if (rb.status) it.result.status = rb.status;
      else if (rb.match) it.result.status = 'API_STATE_VERIFIED';
      else if (it.op.startsWith('listing.') && st !== 'OUTCOME_UNKNOWN') it.result.status = 'AWAITING_READBACK';
      else it.result.status = ['OUTCOME_UNKNOWN', 'SUBMITTING'].includes(st) ? 'OUTCOME_UNKNOWN' : st === 'PARTIALLY_SUCCEEDED' ? st : 'MISMATCH';
    } catch (e) {
      it.readback = { at: new Date().toISOString(), error: e.message };
    }
    appendJsonLine(FILES.ledger(), { at: new Date().toISOString(), event: `READBACK_${it.result.status}`, proposalId: pr.id, op: it.op, target: it.target, actual: it.readback?.actual });
  }
}

function overall(pr) {
  const sts = pr.items.map((x) => x.result?.status);
  if (sts.length && sts.every((s) => s === sts[0]) && sts[0]) return sts[0];
  if (sts.every((s) => s === 'DRY_RUN')) return 'DRY_RUN';
  if (sts.every((s) => s === 'API_STATE_VERIFIED')) return 'API_STATE_VERIFIED';
  if (sts.some((s) => s === 'OUTCOME_UNKNOWN')) return 'OUTCOME_UNKNOWN';
  if (sts.some((s) => s === 'PARTIALLY_SUCCEEDED')) return 'PARTIALLY_SUCCEEDED';
  if (sts.some((s) => ['FAILED', 'NOT_RUN', 'SKIPPED_STALE'].includes(s)) && sts.some((s) => !['FAILED', 'NOT_RUN', 'SKIPPED_STALE'].includes(s))) return 'PARTIALLY_SUCCEEDED';
  if (sts.some((s) => s === 'MISMATCH')) return 'MISMATCH';
  if (sts.some((s) => s === 'AWAITING_READBACK' || s === 'SUBMITTED')) return 'AWAITING_READBACK';
  if (sts.some((s) => s === 'SKIPPED_STALE')) return 'SKIPPED_STALE';
  if (sts.some((s) => ['SUBMITTED_FOR_REVIEW', 'IMAGES_ACCEPTED'].includes(s))) return 'AWAITING_READBACK';
  if (sts.every((s) => ['API_STATE_VERIFIED', 'IMAGE_CONTRIBUTION_VERIFIED', 'DRAFT_CREATED', 'CONTENT_UPDATED', 'ASINS_ASSOCIATED', 'APPROVED', 'PUBLISH_RECORD_FOUND'].includes(s))) return 'API_STATE_VERIFIED';
  return 'FAILED';
}

function report(pr) {
  return {
    proposalId: pr.id, status: pr.status, dryRun: !!pr.dryRun,
    items: pr.items.map((x) => ({ '#': x.index + 1, 操作: x.label, 对象: x.target, 批准值: fmt(x.new), 结果: x.result?.status, 回读值: x.readback ? fmt(x.readback.actual) : null, 说明: x.readback?.note || x.result?.note || x.result?.error || null, receipt: x.sendResult || null })),
    reminder: '“API_STATE_VERIFIED”只代表接口里已是新值，买家页面可能还要一段时间才显示。',
  };
}

export async function verifyChange({ proposalId }) {
  const pr = loadProposal(proposalId);
  const unlock = lockStore(pr.store);
  try {
  if (['PROPOSED', 'EXPIRED', 'REJECTED', 'DRY_RUN'].includes(pr.status)) return report(pr);
  if (pr.status === 'EXECUTING') {
    for (const it of pr.items) {
      if (!it.result) it.result = { status: 'NOT_RUN', note: '上次执行中断，此步骤未提交。' };
      else if (it.result.status === 'SUBMITTING') it.result = { ...it.result, status: 'OUTCOME_UNKNOWN', note: '上次提交中断，只核验不重发。' };
    }
  }
  await readbackAll(pr, getStore(pr.store));
  pr.status = overall(pr);
  saveProposal(pr);
  return report(pr);
  } finally { unlock(); }
}

export function listProposals(limit = 30) {
  const dir = p('proposals');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit).map((f) => {
    const pr = readJson(path.join(dir, f), null);
    return { id: pr.id, status: pr.status, store: pr.store, createdAt: pr.createdAt, expiresAt: pr.expiresAt, panelApproved: pr.panelApproved, items: pr.items.map((x) => ({ op: x.op, label: x.label, target: x.target, old: fmt(x.old), new: fmt(x.new), warnings: x.warnings || [], status: x.result?.status || null })) };
  });
}

export function panelDecision(id, decision) {
  const store = loadProposal(id).store;
  const unlock = lockStore(store);
  try {
    // Re-read only after acquiring the same lock as execution and verification.
    // A stale panel snapshot must never replace a newer execution checkpoint.
    const pr = loadProposal(id);
    if (pr.store !== store) throw new Error('提案店铺已变化，请重新读取提案。');
    assertIntegrity(pr);
    if (pr.status !== 'PROPOSED') throw new Error(`提案状态是 ${pr.status}，不能再批准或拒绝。`);
    if (decision === 'approve') pr.panelApproved = true;
    else { pr.status = 'REJECTED'; }
    pr.panelDecisionAt = new Date().toISOString();
    saveProposal(pr);
    appendJsonLine(FILES.ledger(), { at: pr.panelDecisionAt, event: decision === 'approve' ? 'PANEL_APPROVED' : 'PANEL_REJECTED', proposalId: id });
    return { id, status: pr.status, panelApproved: pr.panelApproved };
  } finally { unlock(); }
}

export function changeLog(limit = 100) {
  return readJsonLines(FILES.ledger(), limit);
}

// Recording an operator-supplied receipt is local evidence only. It cannot
// mark a plan submitted or successful, and never issues a promotion write.
export async function recordPromotionReceipt({ proposalId, hash, itemIndex = 0, promotionId }) {
  const pr = loadProposal(proposalId);
  const unlock = lockStore(pr.store);
  try {
    if (pr.hash !== hash) throw new Error('提案哈希不匹配');
    assertIntegrity(pr);
    if (pr.dryRun) throw new Error('演练提案不能关联真实促销回执');
    const it = pr.items[itemIndex];
    if (!Number.isInteger(itemIndex) || !it || it.op !== 'promotions.coupon' || !['HANDOFF_READY', 'PLATFORM_STATUS_OBSERVED', 'MISMATCH'].includes(it.result?.status)) throw new Error('必须先完成这项促销提案的审批与交接');
    if (typeof promotionId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(promotionId)) throw new Error('promotionId 无效');
    it.sendResult = { ...it.sendResult, promotionId, receiptSource: 'OPERATOR_REPORTED', recordedAt: new Date().toISOString() };
    it.result = { status: 'HANDOFF_READY', note: '已记录操作者提供的回执，等待官方查询；尚未确认批准计划生效。' };
    saveProposal(pr);
    appendJsonLine(FILES.ledger(), { at: new Date().toISOString(), event: 'PROMOTION_RECEIPT_REPORTED', proposalId, itemIndex, promotionId });
    await readbackAll(pr, getStore(pr.store));
    pr.status = overall(pr);
    saveProposal(pr);
    return report(pr);
  } finally { unlock(); }
}
