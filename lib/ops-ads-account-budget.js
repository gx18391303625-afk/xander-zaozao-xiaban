// Official Profiles API: /v2/profiles; only seller Sponsored Products.
import { ads, profileFor } from './ads.js';
import { marketplace } from './regions.js';
import { HttpError } from './http.js';

const validId = (v, expected) => (typeof v === 'string' && /^[1-9]\d*$/.test(v) || typeof v === 'number' && Number.isSafeInteger(v) && v > 0) && String(v) === expected;
const allowed = new Set(['op', 'marketplace', 'value', 'reason']);
function amount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 21000000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) throw new Error('账户预算须为 0–21000000 的 JSON 数字，最多两位小数。');
  if (value > 0 && value < 1) throw new Error('正数账户总上限至少为 1；0 的恢复语义需要独立核验。');
  return value;
}
export function createAccountBudgetOperation({ client = ads, resolveProfile = profileFor } = {}) {
  async function read(store, c) {
    const extra = Object.keys(c).filter(k => !allowed.has(k));
    if (extra.length) throw new Error(`账户总预算不接受其他字段：${extra.join('、')}`);
    const { profileId, code } = resolveProfile(store, c.marketplace);
    const mp = marketplace(code);
    if (mp.region !== store.region || !/^\d+$/.test(profileId) || !Number.isSafeInteger(Number(profileId))) throw new Error('账户 profile ID/区域绑定无效。');
    const p = await client(store.alias, 'GET', `/v2/profiles/${profileId}`, { noProfile: true });
    if (!validId(p?.profileId, profileId) || p.countryCode !== code || p.currencyCode !== mp.currency || p.accountInfo?.type !== 'seller' || (store.sellerId && p.accountInfo.id !== store.sellerId)) throw new Error('账户身份、站点、币种或 seller 类型未通过核验。');
    if (typeof p.dailyBudget !== 'number' || !Number.isFinite(p.dailyBudget) || p.dailyBudget < 0) throw new Error('账户 dailyBudget 缺失或无效，不能当成 0。');
    return { marketplace: code, profileId, old: p.dailyBudget, entity: { name: `${p.accountInfo.name} / ${code} / SP 账户总预算` }, precondition: { profileId, countryCode: code, currencyCode: p.currencyCode, sellerId: p.accountInfo.id, timezone: p.timezone || null } };
  }
  return {
    id: 'ads.sp.account.budget', channel: 'ads', group: '广告 · SP 商品推广', label: '修改 SP 账户总每日预算', risk: '高', implemented: true, capability: 'api',
    params: { value: 'SP账户总每日预算数字；0 的恢复语义必须完成独立核验', marketplace: '目标站点；不接受活动ID或其他广告字段' },
    limitation: '仅 seller SP 账户；不改 SB/SD、各活动预算、竞价、预算增长比例。',
    mutationIdentity: (c, req) => ({ profileId: req.profileId }),
    read,
    check(c, r, limits = {}) {
      const value = amount(c.value);
      if (value === r.old) throw new Error('账户预算与当前值一致，无需修改。');
      if (r.old > 0 && value > 0 && Math.abs((value - r.old) / r.old * 100) > (limits.budgetChangePctMax ?? 100)) throw new Error('账户预算改动幅度超过安全上限。');
      return { newValue: value, warnings: ['影响该账户全部 SP 活动，不包含 SB/SD。', ...(value === 0 ? ['0 的恢复模式须以官方回执及网页独立核验，不能只凭数值认定已取消总上限。'] : [])] };
    },
    build(c, r, value) { return { profileId: r.profileId, marketplace: r.marketplace, body: [{ profileId: Number(r.profileId), dailyBudget: value }] }; },
    async send(store, req) {
      let response;
      try { response = await client(store.alias, 'PUT', '/v2/profiles', { body: req.body, noProfile: true, isWrite: true }); }
      catch (e) {
        const rejected = e instanceof HttpError && [400,401,403,404,413,415,422,429].includes(e.status);
        return { ok: false, status: rejected || e.sent === false ? 'FAILED' : 'OUTCOME_UNKNOWN', error: e.message };
      }
      const matches = Array.isArray(response) ? response.filter(p => validId(p?.profileId, req.profileId)) : [];
      if (response?.length !== 1 || matches.length !== 1 || typeof matches[0].code !== 'string') return { ok: false, status: 'OUTCOME_UNKNOWN', response, error: '没有唯一匹配 profile 的明确回执。' };
      const code = matches[0].code;
      if (code !== 'SUCCESS' && !['INVALID_ARGUMENT','INVALID_PARAMETER','UNAUTHORIZED','FORBIDDEN','NOT_FOUND'].includes(code)) return { ok: false, status: 'OUTCOME_UNKNOWN', response, error: '未识别的回执 code，只能核验，不重发。' };
      const ok = code === 'SUCCESS';
      return { ok, status: ok ? 'SUBMITTED' : 'FAILED', response, error: ok ? undefined : JSON.stringify(matches[0]) };
    },
    async readback(store, c, expected) { const r = await read(store, c); return { actual: r.old, match: r.old === expected }; },
  };
}
export const ACCOUNT_BUDGET_OP = createAccountBudgetOperation();
