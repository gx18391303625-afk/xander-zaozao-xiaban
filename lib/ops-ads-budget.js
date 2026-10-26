// Official contracts and supported scope: docs/ads-budget-api.md.
// Keep these dedicated endpoints separate from the unified campaign API.
import { ads, profileFor, buildUnifiedQueryBody } from './ads.js';
import { marketplace } from './regions.js';
import { canonical } from './jsonfile.js';

const PORTFOLIO_MEDIA = 'application/vnd.spPortfolio.v3+json';
const COMPARISONS = ['EQUAL_TO', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN', 'LESS_THAN_OR_EQUAL_TO'];
const clone = (v) => structuredClone(v);
const same = (a, b) => canonical(a) === canonical(b);
const nameKey = (s) => String(s || '').trim().normalize('NFKC').toLowerCase();
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const ruleView = (r) => r ? pick(r, ['ruleId', 'ruleDetails', 'ruleState']) : null;
const portfolioView = (p) => p ? pick(p, ['portfolioId', 'name', 'state', 'budget', 'budgetControls']) : null;
const campaignView = (c) => ({ campaignId: String(c.campaignId), name: c.name, state: c.state, portfolioId: c.portfolioId ?? null, budgets: c.budgets });
function textId(v, label) {
  if ((typeof v !== 'string' && typeof v !== 'number') || !String(v).trim() || String(v).length > 200) throw new Error(`缺少或无效的 ${label}`);
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error(`${label} 请使用字符串，避免长 ID 精度丢失。`);
  return String(v).trim();
}
function campaignIds(c, required = false) {
  const ids = c.campaignIds ?? (c.campaignId ? [c.campaignId] : []);
  if (!Array.isArray(ids) || ids.length > 25 || (required && !ids.length)) throw new Error('campaignIds 需要 1–25 个活动 ID（创建时可省略）。');
  const out = ids.map((id) => textId(id, 'campaignId'));
  if (new Set(out).size !== out.length) throw new Error('campaignIds 不能重复。');
  if (out.some((id) => !/^\d+$/.test(id))) throw new Error('campaignId 必须是数字字符串。');
  return out.sort();
}
function actionOf(c, allowed) {
  const a = String(c.action || '').toLowerCase();
  if (!allowed.includes(a)) throw new Error(`action 必须是 ${allowed.join(' / ')}`);
  return a;
}
function name(v, label = 'name') {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 355) throw new Error(`${label} 必须是 1–355 个字符。`);
  return v.trim();
}
function positive(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`${label} 必须是大于 0 的有限数字。`);
  return v;
}
function date(v, compact = false) {
  const s = String(v || '');
  const iso = compact && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) throw new Error(`无效日期 ${s}；请用 ${compact ? 'YYYYMMDD' : 'YYYY-MM-DD'}。`);
  return compact ? iso.replaceAll('-', '') : iso;
}
function assertKeys(o, keys, label) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${label} 必须是对象。`);
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) throw new Error(`${label} 不支持字段：${extra.join('、')}，不会静默忽略。`);
}
function ruleDetails(input, code, limits = {}) {
  assertKeys(input, ['name', 'ruleType', 'duration', 'recurrence', 'budgetIncreaseBy', 'performanceMeasureCondition'], 'ruleDetails');
  const d = clone(input);
  d.name = name(d.name);
  if (!['SCHEDULE', 'PERFORMANCE'].includes(d.ruleType)) throw new Error('ruleType 只能是 SCHEDULE / PERFORMANCE。');
  assertKeys(d.duration, ['dateRangeTypeRuleDuration'], 'duration');
  assertKeys(d.duration.dateRangeTypeRuleDuration, ['startDate', 'endDate'], 'dateRangeTypeRuleDuration');
  const range = d.duration.dateRangeTypeRuleDuration;
  range.startDate = date(range.startDate, true);
  if (range.endDate !== undefined) {
    range.endDate = date(range.endDate, true);
    if (range.endDate < range.startDate) throw new Error('结束日期不能早于开始日期。');
  }
  assertKeys(d.recurrence, ['type', 'intraDaySchedule'], 'recurrence');
  // Current live SP OpenAPI enumerates DAILY only; the guide's WEEKLY example
  // contradicts that contract. Do not silently send an unverified enum.
  if (d.recurrence.type !== 'DAILY') throw new Error('当前已核实 SP 合约只列 DAILY；WEEKLY / daysOfWeek 请在广告后台设置。');
  if (d.recurrence.intraDaySchedule !== undefined) {
    if (d.ruleType !== 'SCHEDULE' || !['US', 'CA', 'UK', 'IN', 'JP'].includes(code)) throw new Error('日内时段规则仅支持 US/CA/UK/IN/JP 的 SCHEDULE 规则。');
    const windows = d.recurrence.intraDaySchedule;
    if (!Array.isArray(windows) || windows.length !== 1) throw new Error('intraDaySchedule 必须恰好一个时段。');
    const w = windows[0]; assertKeys(w, ['startTime', 'endTime'], 'intraDaySchedule');
    const time = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
    if (!time.test(w.startTime) || !time.test(w.endTime) || w.endTime <= w.startTime) throw new Error('日内时段需 hh:mm:ss 格式，结束时间必须晚于开始时间。');
  }
  assertKeys(d.budgetIncreaseBy, ['type', 'value'], 'budgetIncreaseBy');
  if (d.budgetIncreaseBy.type !== 'PERCENT') throw new Error('预算规则只支持 PERCENT 增幅。');
  positive(d.budgetIncreaseBy.value, '预算增加百分比');
  if (d.budgetIncreaseBy.value > (limits.budgetChangePctMax ?? 50)) throw new Error(`规则预算增幅超过安全上限 ${limits.budgetChangePctMax ?? 50}%。`);
  if (d.ruleType === 'PERFORMANCE') {
    const p = d.performanceMeasureCondition;
    assertKeys(p, ['metricName', 'comparisonOperator', 'threshold'], 'performanceMeasureCondition');
    if (!['ACOS', 'CTR', 'CVR', 'ROAS'].includes(p.metricName) || !COMPARISONS.includes(p.comparisonOperator)) throw new Error('无效的 SP 绩效指标或比较运算符。');
    if (typeof p.threshold !== 'number' || !Number.isFinite(p.threshold) || p.threshold < 0) throw new Error('绩效 threshold 必须是非负有限数字。');
    if (['CTR', 'CVR'].includes(p.metricName) && p.threshold > 100) throw new Error('CTR / CVR 百分比阈值不能超过 100。');
  } else if (d.performanceMeasureCondition !== undefined) throw new Error('SCHEDULE 规则不能包含绩效条件。');
  return d;
}
function portfolioFields(input, code, old, limits = {}, create = false) {
  assertKeys(input, ['name', 'state', 'budget'], 'portfolio');
  const p = clone(input);
  if (create || p.name !== undefined) p.name = name(p.name);
  if (create) p.state ??= 'ENABLED';
  if (p.state !== undefined && p.state !== 'ENABLED') throw new Error('官方 Portfolios v3 的 state 只支持 ENABLED；本功能不归档组合。');
  if (p.budget !== undefined) {
    const b = p.budget;
    assertKeys(b, ['policy', 'amount', 'currencyCode', 'startDate', 'endDate'], 'portfolio.budget');
    const currency = marketplace(code).currency;
    if (b.currencyCode !== currency) throw new Error(`组合预算币种必须是 ${currency}（${code} 站）。`);
    if (!['DATE_RANGE', 'MONTHLY_RECURRING', 'NO_CAP'].includes(b.policy)) throw new Error('预算 policy 必须是 DATE_RANGE / MONTHLY_RECURRING / NO_CAP。');
    if (b.policy === 'NO_CAP') {
      if (['amount', 'startDate', 'endDate'].some((k) => b[k] !== undefined && b[k] !== null)) throw new Error('NO_CAP 的 amount/startDate/endDate 必须为空。');
      b.amount = null; b.startDate = null; b.endDate = null;
    } else {
      positive(b.amount, '组合预算');
      if (b.policy === 'DATE_RANGE') {
        b.startDate = date(b.startDate); b.endDate = date(b.endDate);
        if (b.endDate < b.startDate) throw new Error('组合预算结束日期不能早于开始日期。');
      } else {
        if (b.startDate != null) b.startDate = date(b.startDate);
        if (b.endDate != null) b.endDate = date(b.endDate);
        if (b.startDate && b.endDate && b.endDate < b.startDate) throw new Error('组合预算结束日期不能早于开始日期。');
      }
      const amount = old?.budget?.amount;
      if (amount > 0 && Math.abs((b.amount - amount) / amount * 100) > (limits.budgetChangePctMax ?? 50)) throw new Error('组合预算改动幅度超过安全上限。');
    }
  }
  if (!Object.keys(p).length) throw new Error('portfolio 至少提供一个待修改字段。');
  return p;
}
// Only compare approved fields; read-only fields, event annotations, evaluation
// status and unrelated defaults must not make an accepted edit look different.
function contains(actual, expected) {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => contains(actual[i], v));
  return !!actual && Object.entries(expected).every(([k, v]) => contains(actual[k], v));
}

export function createAdsBudgetOps({ adsClient = ads, profileResolver = profileFor } = {}) {
  const call = (store, profileId, method, path, options = {}) => adsClient(store.alias, method, path, { profileId, ...options });
  function context(store, c) {
    const { profileId, code } = profileResolver(store, c.marketplace);
    if (marketplace(code).region !== store.region) throw new Error('广告 profile 站点与店铺 API 区域不一致，请先修正绑定。');
    return { profileId, marketplace: code };
  }
  async function pages(store, profileId, { path, key, method = 'GET', body = {}, contentType = 'application/json' }) {
    const out = []; const seen = new Set(); let nextToken;
    for (let i = 0; i < 100; i++) {
      const options = method === 'GET' ? { query: { pageSize: 30, ...(nextToken ? { nextToken } : {}) } } : { body: { ...body, ...(nextToken ? { nextToken } : {}) }, contentType };
      const r = await call(store, profileId, method, path, options);
      if (!Array.isArray(r?.[key])) throw new Error(`${path} 没有返回 ${key} 数组，不能确认完整结果。`);
      out.push(...r[key]);
      nextToken = r.nextToken;
      if (!nextToken) return out;
      if (seen.has(nextToken)) throw new Error(`${path} 分页令牌重复，停止以免漏查重。`);
      seen.add(nextToken);
    }
    throw new Error(`${path} 超过 100 页，结果不完整，禁止据此创建或修改。`);
  }
  const rules = (s, p) => pages(s, p, { path: '/sp/budgetRules', key: 'budgetRulesForAdvertiserResponse' });
  const portfolios = (s, p, ids) => pages(s, p, { path: '/portfolios/list', key: 'portfolios', method: 'POST', body: ids ? { portfolioIdFilter: { include: ids } } : {}, contentType: PORTFOLIO_MEDIA });
  const associated = (s, p, id) => pages(s, p, { path: `/sp/budgetRules/${encodeURIComponent(id)}/campaigns`, key: 'associatedCampaigns' });
  async function campaign(s, p, id) {
    const r = await call(s, p, 'POST', '/adsApi/v1/query/campaigns', { body: { adProductFilter: { include: ['SPONSORED_PRODUCTS'] }, campaignIdFilter: { include: [id] }, maxResults: 10 } });
    const hit = r?.campaigns?.find((x) => String(x.campaignId) === id);
    if (!hit) throw new Error(`当前 profile 找不到 SP 活动 ${id}。`);
    return hit;
  }
  async function getRule(s, p, id) {
    const r = await call(s, p, 'GET', `/sp/budgetRules/${encodeURIComponent(id)}`);
    if (!r?.budgetRule || String(r.budgetRule.ruleId) !== id) throw new Error(`预算规则 ${id} 回读缺少匹配对象。`);
    return r.budgetRule;
  }
  async function getPortfolio(s, p, id) {
    const arr = await portfolios(s, p, [id]);
    const hit = arr.find((x) => String(x.portfolioId) === id);
    if (!hit) throw new Error(`当前 profile 找不到投资组合 ${id}。`);
    return hit;
  }
  async function portfolioCampaigns(s, p, id) {
    const out = [];
    for (const [adProduct, apiProduct] of [['SP', 'SPONSORED_PRODUCTS'], ['SB', 'SPONSORED_BRANDS']]) {
      const body = buildUnifiedQueryBody({ ad: apiProduct, resource: 'campaigns', filters: { portfolioIdFilter: { include: [id] } } });
      const rows = await pages(s, p, { method: 'POST', path: '/adsApi/v1/query/campaigns', key: 'campaigns', body });
      for (const row of rows) out.push({ adProduct, ...campaignView(row) });
    }
    const seen = new Set(); let complete = false;
    for (let i = 0; i < 100; i++) {
      const rows = await call(s, p, 'GET', '/sd/campaigns', { query: { portfolioIdFilter: id, stateFilter: 'enabled,paused,archived', startIndex: i * 100, count: 100 } });
      if (!Array.isArray(rows) || rows.length > 100) throw new Error('SD 组合活动列表不完整，不能确认预算影响范围。');
      for (const row of rows) {
        const campaignId = textId(row.campaignId, 'SD campaignId');
        if (seen.has(campaignId)) throw new Error('SD 组合活动分页重复，不能确认预算影响范围。');
        seen.add(campaignId);
        out.push({ adProduct: 'SD', campaignId, name: row.name, state: String(row.state).toUpperCase(), portfolioId: row.portfolioId == null ? null : String(row.portfolioId), budget: row.budget, budgetType: row.budgetType });
      }
      if (rows.length < 100) { complete = true; break; }
    }
    if (!complete) throw new Error('SD 组合活动超过 100 页，禁止使用不完整影响范围修改组合。');
    if (out.some((row) => row.portfolioId !== id)) throw new Error('组合活动查询返回其他组合的活动，无法确认影响范围。');
    return out.sort((a, b) => `${a.adProduct}:${a.campaignId}`.localeCompare(`${b.adProduct}:${b.campaignId}`));
  }
  async function linksFor(s, p, ids) {
    const out = [];
    for (const id of ids) {
      const c = await campaign(s, p, id);
      if (c.state === 'ARCHIVED' || c.globalCampaignId) throw new Error(`活动 ${id} 已归档或由全球活动管理，本功能只处理本地 SP 活动。`);
      const r = await call(s, p, 'GET', `/sp/campaigns/${encodeURIComponent(id)}/budgetRules`);
      if (!Array.isArray(r?.associatedRules)) throw new Error(`活动 ${id} 未返回 associatedRules，不能确认原关联。`);
      out.push({ ...campaignView(c), rules: r.associatedRules.map(ruleView).sort((a, b) => a.ruleId.localeCompare(b.ruleId)) });
    }
    return out;
  }
  function classify(response, format, wantedId) {
    if (format === 'empty') return { ok: true, id: wantedId };
    if (format === 'rule') {
      const rows = response?.responses;
      if (!Array.isArray(rows) || rows.length !== 1) return { ok: false, unknown: true, error: '预算规则回执缺失或条数不匹配。' };
      const row = rows[0];
      if (String(row.code).toLowerCase() !== 'ok') return { ok: false, unknown: !row.code, error: `${row.code || 'UNKNOWN'} ${row.details || ''}`.trim() };
      if (!row.ruleId || (wantedId && String(row.ruleId) !== wantedId)) return { ok: false, unknown: true, error: '预算规则成功回执缺少匹配的 ruleId。' };
      return { ok: true, id: String(row.ruleId) };
    }
    const r = format === 'portfolio' ? response?.portfolios : response;
    const success = r?.success, errors = r?.error;
    if (Array.isArray(errors) && errors.length) return { ok: false, unknown: !!success?.length, error: JSON.stringify(errors).slice(0, 1500) };
    if (!Array.isArray(success) || success.length !== 1 || success[0].index !== 0) return { ok: false, unknown: true, error: '写入回执没有唯一 index=0 成功项。' };
    const id = format === 'portfolio' ? success[0].portfolioId ?? success[0].portfolio?.portfolioId : success[0].campaign?.campaignId;
    if (!id || (wantedId && String(id) !== wantedId)) return { ok: false, unknown: true, error: '成功回执缺少匹配的对象 ID。' };
    return { ok: true, id: String(id) };
  }
  async function sendPlan(store, req, { checkpoint } = {}) {
    const result = { ok: false, status: 'OUTCOME_UNKNOWN', createdIds: [], steps: [], objectId: req.objectId || null };
    const save = async () => { if (checkpoint) await checkpoint(clone(result)); };
    async function run(key, request, format, wantedId) {
      const step = { key, status: 'SUBMITTING' };
      result.steps.push(step);
      // A durable marker exists before each irreversible network request.
      await save();
      try {
        const response = await call(store, req.profileId, request.method, request.path, { body: request.body, contentType: request.contentType || 'application/json', isWrite: true });
        const parsed = classify(response, format, wantedId);
        step.status = parsed.ok ? 'SUBMITTED' : parsed.unknown ? 'OUTCOME_UNKNOWN' : 'FAILED';
        step.response = response;
        if (parsed.id) step.objectId = parsed.id;
        if (!parsed.ok) {
          result.error = parsed.error;
          result.status = parsed.unknown ? 'OUTCOME_UNKNOWN' : result.steps.some((x) => x.status === 'SUBMITTED') ? 'PARTIALLY_SUCCEEDED' : 'FAILED';
          await save(); return null;
        }
        if (key === 'create') { result.objectId = parsed.id; result.createdIds = [parsed.id]; }
        await save(); return parsed;
      } catch (e) {
        step.status = e.sent === false ? 'FAILED' : 'OUTCOME_UNKNOWN';
        result.error = e.message;
        result.status = step.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : result.steps.some((x) => x.status === 'SUBMITTED') ? 'PARTIALLY_SUCCEEDED' : 'FAILED';
        await save(); return null;
      }
    }
    if (req.objectRequest && !await run(req.action, req.objectRequest, req.kind, req.objectId)) return result;
    for (const id of req.campaignIds) {
      let request, format;
      if (req.kind === 'rule') {
        const base = `/sp/campaigns/${encodeURIComponent(id)}/budgetRules`;
        request = req.action === 'disassociate' ? { method: 'DELETE', path: `${base}/${encodeURIComponent(result.objectId)}` } : { method: 'POST', path: base, body: { budgetRuleIds: [result.objectId] } };
        format = req.action === 'disassociate' ? 'empty' : 'rule';
      } else {
        request = { method: 'POST', path: '/adsApi/v1/update/campaigns', body: { campaigns: [{ campaignId: id, portfolioId: result.objectId }] } };
        format = 'campaign';
      }
      if (!await run(`${req.action === 'disassociate' ? 'disassociate' : 'associate'}:${id}`, request, format, req.kind === 'rule' ? result.objectId : id)) return result;
    }
    result.ok = true; result.status = 'SUBMITTED'; await save(); return result;
  }
  function verification(actual, match, sent, anyMatch = false, objectMatch = false) {
    const status = match ? 'API_STATE_VERIFIED' : sent?.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : anyMatch ? 'PARTIALLY_SUCCEEDED' : 'AWAITING_READBACK';
    const successful = sent?.steps?.filter((s) => s.status === 'SUBMITTED') || [];
    const reconciled = match || (!!successful.length && sent.steps.every((s) => ['SUBMITTED', 'FAILED'].includes(s.status)) && successful.every((s) => {
      if (['create', 'update'].includes(s.key)) return objectMatch;
      const campaignId = s.key.slice(s.key.indexOf(':') + 1);
      return actual.campaigns?.some((row) => row.campaignId === campaignId && row.match);
    }));
    return { actual, match, status, reconciled, note: match ? '已核对 API 对象及批准的关联；规则是否触发、组合是否实际消耗预算需另看投放数据。' : reconciled ? '已核清成功步骤与明确失败回执。使用已有对象 ID 为失败关联单独生成新提案，不重新创建对象。' : '回读未确认全部批准改动；不自动重发。继续核验已有对象和每项关联。' };
  }
  const budgetOp = {
    id: 'ads.budgetRules', group: '广告 · 预算与组合', label: 'SP 预算规则：创建 / 修改 / 活动关联', risk: '高', implemented: true, capability: 'api', channel: 'ads', api: 'SP Budget Rules API',
    requirements: 'Ads campaign_management 授权、对应区域 profile、advertiser_campaign_edit；规则实际触发还受活动资格和预算门槛限制。',
    limitation: '支持 SP 日期范围 DAILY 规则及五站点日内时段；WEEKLY/推荐事件、SB/SD 规则需广告后台交接。已创建/已关联不等于预算已触发。',
    creates: (c) => String(c.action).toLowerCase() === 'create', creationIdentity: (c) => ({ action: 'create', name: nameKey(c.ruleDetails?.name) }),
    params: { action: 'create / update / associate / disassociate', ruleId: '非创建时必填', ruleDetails: '创建或完整编辑规则详情；日期范围、DAILY、PERCENT、SCHEDULE/PERFORMANCE', ruleState: 'update 可改 ACTIVE / PAUSED', campaignIds: '创建后关联或已有规则关联/解除：1–25 个 SP 活动 ID' },
    async read(store, c) {
      const ctx = context(store, c), p = ctx.profileId;
      const action = actionOf(c, ['create', 'update', 'associate', 'disassociate']);
      const ids = campaignIds(c, ['associate', 'disassociate'].includes(action));
      if (action === 'update' && ids.length) throw new Error('修改规则会影响其全部现有关联；新增/解除关联请用独立 action。');
      if (action === 'create' && c.ruleState !== undefined) throw new Error('创建接口不接受 ruleState；需暂停时先创建不关联，再用 update 暂停。');
      const ruleId = action === 'create' ? null : textId(c.ruleId, 'ruleId');
      const object = ruleId ? await getRule(store, p, ruleId) : null;
      const duplicates = action === 'create' || c.ruleDetails?.name !== undefined ? (await rules(store, p)).filter((x) => nameKey(x.ruleDetails?.name) === nameKey(c.ruleDetails?.name) && String(x.ruleId) !== ruleId) : [];
      const links = action === 'update' ? (await associated(store, p, ruleId)).map((x) => ({ campaignId: String(x.campaignId), campaignName: x.campaignName })).sort((a, b) => a.campaignId.localeCompare(b.campaignId)) : await linksFor(store, p, ids);
      return { ...ctx, entity: { name: object?.ruleDetails?.name || c.ruleDetails?.name, duplicates }, old: { rule: ruleView(object), campaigns: links, duplicateIds: duplicates.map((x) => x.ruleId).sort() } };
    },
    check(c, r, limits) {
      const action = actionOf(c, ['create', 'update', 'associate', 'disassociate']);
      if (r.entity.duplicates.length) throw new Error('当前 profile 已有同名预算规则，请核对 ruleId，不能重复创建。');
      const v = { action, ruleId: action === 'create' ? null : textId(c.ruleId, 'ruleId'), campaignIds: campaignIds(c, ['associate', 'disassociate'].includes(action)) };
      if (action === 'create' || c.ruleDetails !== undefined) v.ruleDetails = ruleDetails(c.ruleDetails, r.marketplace, limits);
      if (action === 'update' && c.ruleState !== undefined) {
        if (!['ACTIVE', 'PAUSED'].includes(c.ruleState)) throw new Error('ruleState 必须是 ACTIVE / PAUSED。');
        v.ruleState = c.ruleState;
      }
      if (action === 'update') {
        if (v.ruleDetails === undefined && v.ruleState === undefined) throw new Error('update 至少提供 ruleDetails 或 ruleState。');
        if (contains(r.old.rule, pick(v, ['ruleDetails', 'ruleState']))) throw new Error('规则新值和当前值一致，不需要修改。');
        v.affectedCampaigns = r.old.campaigns;
      }
      if (['associate', 'disassociate'].includes(action) && (c.ruleDetails !== undefined || c.ruleState !== undefined)) throw new Error('关联 action 不能同时修改规则内容。');
      for (const row of action === 'update' ? [] : r.old.campaigns) {
        const existing = row.rules.some((x) => String(x.ruleId) === v.ruleId);
        if ((action === 'associate' && existing) || (action === 'disassociate' && !existing)) throw new Error(`活动 ${row.campaignId} 的关联已经是目标状态，不重复提交。`);
        if (action !== 'disassociate' && row.rules.length >= 250) throw new Error(`活动 ${row.campaignId} 已达到 250 条预算规则上限。`);
        if (action !== 'disassociate' && row.rules.some((x) => nameKey(x.ruleDetails?.name) === nameKey(v.ruleDetails?.name || r.old.rule?.ruleDetails?.name))) throw new Error(`活动 ${row.campaignId} 已有关联同名规则。`);
        if (action !== 'disassociate' && row.budgets?.[0]?.recurrenceTimePeriod !== 'DAILY') throw new Error(`活动 ${row.campaignId} 不是已核实的日预算活动。`);
      }
      if (action === 'associate' && r.old.rule?.ruleDetails?.budgetIncreaseBy?.value > (limits?.budgetChangePctMax ?? 50)) throw new Error('待关联规则增幅超过预算安全上限。');
      if (action === 'update' && v.ruleState === 'ACTIVE' && (v.ruleDetails || r.old.rule?.ruleDetails)?.budgetIncreaseBy?.value > (limits?.budgetChangePctMax ?? 50)) throw new Error('待启用规则增幅超过预算安全上限。');
      const warnings = ['规则增加的是可用预算；创建成功、关联成功、规则触发和实际花费是不同状态。'];
      if (v.ruleDetails?.ruleType === 'PERFORMANCE' || v.ruleDetails?.recurrence?.intraDaySchedule || r.old.rule?.ruleDetails?.ruleType === 'PERFORMANCE') warnings.push('绩效/日内规则有最低预算与数据资格门槛，需以 Amazon ruleStatus 和实际投放为准。');
      if (action === 'update') warnings.push(`修改会影响现有关联的 ${r.old.campaigns.length} 个活动，名单已包含在提案中。`);
      return { newValue: v, warnings };
    },
    build(c, r, v) {
      const req = { kind: 'rule', action: v.action, profileId: r.profileId, objectId: v.ruleId, campaignIds: v.campaignIds };
      if (['create', 'update'].includes(v.action)) req.objectRequest = { method: v.action === 'create' ? 'POST' : 'PUT', path: '/sp/budgetRules', body: { budgetRulesDetails: [v.action === 'create' ? v.ruleDetails : { ruleId: v.ruleId, ...pick(v, ['ruleDetails', 'ruleState']) }] } };
      return req;
    },
    send: sendPlan,
    async readback(store, c, v, sent) {
      const { profileId: p } = context(store, c);
      let id = sent?.objectId || sent?.createdIds?.[0] || v.ruleId;
      let obj;
      if (!id) {
        const matches = (await rules(store, p)).filter((x) => nameKey(x.ruleDetails?.name) === nameKey(v.ruleDetails?.name));
        return { ...verification({ candidates: matches.map(ruleView) }, false, { status: 'OUTCOME_UNKNOWN' }), note: '缺少本请求的创建回执 ID。同名同内容也可能由其他操作者创建；候选仅供核对，不能认定本次创建成功，不重发。' };
      } else obj = await getRule(store, p, id);
      const expected = pick(v, ['ruleDetails', 'ruleState']);
      let objectMatch = contains(obj, expected);
      const actual = { rule: ruleView(obj), ruleStatus: obj.ruleStatus, campaigns: [] };
      for (const campaignId of v.campaignIds) {
        const r = await call(store, p, 'GET', `/sp/campaigns/${encodeURIComponent(campaignId)}/budgetRules`);
        if (!Array.isArray(r?.associatedRules)) throw new Error('回读关联缺少 associatedRules 数组。');
        const present = r.associatedRules.some((x) => String(x.ruleId) === id);
        actual.campaigns.push({ campaignId, associated: present, match: present === (v.action !== 'disassociate') });
      }
      // An update of a shared rule must also confirm the approved impact scope.
      if (v.action === 'update') {
        const current = (await associated(store, p, id)).map((x) => String(x.campaignId)).sort();
        actual.affectedCampaignIds = current;
        objectMatch &&= same(current, v.affectedCampaigns.map((x) => x.campaignId).sort());
      }
      return verification(actual, objectMatch && actual.campaigns.every((x) => x.match), sent, (['create', 'update'].includes(v.action) && objectMatch) || actual.campaigns.some((x) => x.match), objectMatch);
    },
  };
  const portfolioOp = {
    id: 'ads.portfolio', group: '广告 · 预算与组合', label: '投资组合：创建 / 预算修改 / SP 活动归属', risk: '高', implemented: true, capability: 'api', channel: 'ads', api: 'Portfolios v3 + Ads API v1',
    requirements: 'Ads campaign_management 授权、区域 profile、advertiser_campaign_edit。组合预算币种须与站点一致。',
    limitation: '创建/编辑名称和预算上限，归属/移除本地 SP 活动；不归档组合、不启用余额共享、不修改 SB/SD 归属。',
    creates: (c) => String(c.action).toLowerCase() === 'create', creationIdentity: (c) => ({ action: 'create', name: nameKey(c.portfolio?.name) }),
    params: { action: 'create / update / assign', portfolioId: 'update/assign 必填；assign 使用 null 可移出组合', portfolio: 'name / state=ENABLED / budget {policy,amount,currencyCode,startDate,endDate}', campaignIds: '创建后归属或 assign：1–25 个 SP 活动 ID' },
    async read(store, c) {
      const ctx = context(store, c), p = ctx.profileId;
      const action = actionOf(c, ['create', 'update', 'assign']);
      const ids = campaignIds(c, action === 'assign');
      if (action === 'update' && ids.length) throw new Error('组合编辑与活动归属请用独立 action。');
      if (action === 'assign' && c.portfolioId === undefined) throw new Error('assign 必须明确 portfolioId（移出时使用 null）。');
      const id = action === 'create' || c.portfolioId === null ? null : textId(c.portfolioId, 'portfolioId');
      if (action === 'update' && id === null) throw new Error('update 需要 portfolioId。');
      const object = id ? await getPortfolio(store, p, id) : null;
      const duplicates = action === 'create' || c.portfolio?.name !== undefined ? (await portfolios(store, p)).filter((x) => nameKey(x.name) === nameKey(c.portfolio?.name) && String(x.portfolioId) !== id) : [];
      const campaigns = [];
      // A portfolio cap affects every ad product, so permission or pagination
      // failures in any one of SP/SB/SD block updates instead of hiding scope.
      const linked = action === 'update' ? await portfolioCampaigns(store, p, id) : [];
      for (const cid of ids) {
        const entity = await campaign(store, p, cid);
        if (entity.state === 'ARCHIVED' || entity.globalCampaignId) throw new Error(`活动 ${cid} 已归档或由全球活动管理。`);
        campaigns.push(campaignView(entity));
      }
      return { ...ctx, entity: { name: object?.name || c.portfolio?.name, duplicates }, old: { portfolio: portfolioView(object), campaigns: action === 'update' ? linked : campaigns, duplicateIds: duplicates.map((x) => x.portfolioId).sort() } };
    },
    check(c, r, limits) {
      const action = actionOf(c, ['create', 'update', 'assign']);
      if (r.entity.duplicates.length) throw new Error('当前 profile 已有同名投资组合，请核对 portfolioId，不能重复创建。');
      const v = { action, portfolioId: action === 'create' || c.portfolioId === null ? null : textId(c.portfolioId, 'portfolioId'), campaignIds: campaignIds(c, action === 'assign') };
      if (['create', 'update'].includes(action)) v.portfolio = portfolioFields(c.portfolio, r.marketplace, r.old.portfolio, limits, action === 'create');
      else if (c.portfolio !== undefined) throw new Error('assign 不能同时修改组合内容。');
      if (action === 'update') {
        if (contains(r.old.portfolio, v.portfolio)) throw new Error('组合新值和当前值一致，不需要修改。');
        v.affectedCampaigns = r.old.campaigns;
        v.affectedSPCampaigns = r.old.campaigns.filter((x) => x.adProduct === 'SP');
      }
      if (action === 'assign' && r.old.campaigns.some((x) => x.portfolioId === v.portfolioId)) throw new Error('部分活动已经属于目标组合，请从提案中移除这些活动。');
      const warnings = ['组合预算上限会影响该组合内所有广告活动，包括 SB/SD；活动只能属于一个组合。'];
      if (v.portfolio?.budget?.policy === 'NO_CAP') warnings.push('NO_CAP 会移除组合预算上限，各活动按自身预算继续投放。');
      if (action === 'create' && !v.portfolio?.budget) warnings.push('未设置组合预算上限。');
      return { newValue: v, warnings };
    },
    build(c, r, v) {
      const req = { kind: 'portfolio', action: v.action, profileId: r.profileId, objectId: v.portfolioId, campaignIds: v.campaignIds };
      if (['create', 'update'].includes(v.action)) req.objectRequest = { method: v.action === 'create' ? 'POST' : 'PUT', path: '/portfolios', contentType: PORTFOLIO_MEDIA, body: { portfolios: [v.action === 'create' ? v.portfolio : { portfolioId: v.portfolioId, ...v.portfolio }] } };
      return req;
    },
    send: sendPlan,
    async readback(store, c, v, sent) {
      const { profileId: p } = context(store, c);
      let id = sent?.objectId || sent?.createdIds?.[0] || v.portfolioId;
      let obj = null;
      if (v.action === 'create' && !id) {
        const matches = (await portfolios(store, p)).filter((x) => nameKey(x.name) === nameKey(v.portfolio?.name));
        return { ...verification({ candidates: matches.map(portfolioView) }, false, { status: 'OUTCOME_UNKNOWN' }), note: '缺少本请求的创建回执 ID。同名同内容也可能由其他操作者创建；候选仅供核对，不能认定本次创建成功，不重发。' };
      } else if (id) obj = await getPortfolio(store, p, id);
      let objectMatch = !v.portfolio || contains(obj, v.portfolio);
      const actual = { portfolio: portfolioView(obj), campaigns: [] };
      for (const campaignId of v.campaignIds) {
        const row = await campaign(store, p, campaignId);
        actual.campaigns.push({ campaignId, portfolioId: row.portfolioId ?? null, match: (row.portfolioId ?? null) === (id ?? null) });
      }
      if (v.action === 'update') {
        actual.affectedCampaigns = await portfolioCampaigns(store, p, id);
        const scope = (rows) => rows.map((x) => `${x.adProduct}:${x.campaignId}`).sort();
        objectMatch &&= same(scope(actual.affectedCampaigns), scope(v.affectedCampaigns));
      }
      return verification(actual, objectMatch && actual.campaigns.every((x) => x.match), sent, (['create', 'update'].includes(v.action) && objectMatch) || actual.campaigns.some((x) => x.match), objectMatch);
    },
  };
  return [budgetOp, portfolioOp];
}

export const ADS_BUDGET_OPS = createAdsBudgetOps();
