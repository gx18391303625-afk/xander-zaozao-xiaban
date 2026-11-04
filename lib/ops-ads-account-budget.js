// Official Profiles API: /v2/profiles; only seller Sponsored Products.
import { ads, profileFor } from './ads.js';
import { marketplace } from './regions.js';
import { HttpError } from './http.js';

const validId = (v, expected) => (typeof v === 'string' && /^[1-9]\d*$/.test(v) || typeof v === 'number' && Number.isSafeInteger(v) && v > 0) && String(v) === expected;
const allowed = new Set(['op', 'marketplace', 'value', 'reason']);
function amount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 21000000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) throw new Error('账户预算须为 1–21000000 的 JSON 数字，最多两位小数。');
  return value;
}
export function createAccountBudgetOperation({ client = ads, resolveProfile = profileFor } = {}) {
  async function read(store, c) {
    const extra = Object.keys(c).filter(k => !allowed.has(k));
    if (extra.length) throw new Error(`账户总预算不接受其他字段：${extra.join('、')}`);
    const { profileId, code } = resolveProfile(store, c.marketplace);
    const mp = marketplace(code);
    if (code !== 'US' || store.region !== 'NA') throw new Error('当前账户总预算写入仅核验美国 US / NA 站，其他站点尚未验证。');
    if (mp.region !== store.region || !/^\d+$/.test(profileId) || !Number.isSafeInteger(Number(profileId))) throw new Error('账户 profile ID/区域绑定无效。');
    const p = await client(store.alias, 'GET', `/v2/profiles/${profileId}`, { noProfile: true });
    if (!validId(p?.profileId, profileId) || p.countryCode !== code || p.currencyCode !== mp.currency || p.accountInfo?.type !== 'seller' || (store.sellerId && p.accountInfo.id !== store.sellerId)) throw new Error('账户身份、站点、币种或 seller 类型未通过核验。');
    if (typeof p.dailyBudget !== 'number' || !Number.isFinite(p.dailyBudget) || p.dailyBudget < 0) throw new Error('账户 dailyBudget 缺失或无效，不能当成 0。');
    // Profiles API 只有 dailyBudget 一个数值字段，没有“账户预算模式”。2026-11-04 实测：控制台切回
    // “使用广告活动级别预算”后，GET 会先返回旧值（1，滞后约 10 分钟），随后稳定为 21000000（接口允许的最大值，
    // 等价于不封顶）。因此金额既不能证明模式，也不能当成“当前生效上限”：
    //   old / storedDailyBudget = profile 里存着的金额，是 PUT 会覆盖的那个值；
    //   budgetModeProven        = false，表示“当前是否以该金额封顶”必须走控制台核验，接口无法证明。
    return { marketplace: code, profileId, old: p.dailyBudget, storedDailyBudget: p.dailyBudget, budgetModeProven: false, entity: { name: `${p.accountInfo.name} / ${code} / SP 账户每日预算（存储值）` }, precondition: { profileId, countryCode: code, currencyCode: p.currencyCode, sellerId: p.accountInfo.id, timezone: p.timezone || null } };
  }
  return {
    id: 'ads.sp.account.budget', channel: 'ads', group: '广告 · SP 商品推广', label: '修改美国 SP 账户总每日预算金额', risk: '高', implemented: true, capability: 'api',
    params: { value: '美国SP账户总每日预算金额，USD1–21000000；不支持0或取消总上限', marketplace: '目标站点；不接受活动ID或其他广告字段' },
    limitation: '仅 seller SP 账户；不改 SB/SD、各活动预算、竞价、预算增长比例。',
    mutationIdentity: (c, req) => ({ profileId: req.profileId }),
    read,
    check(c, r, limits = {}) {
      const value = amount(c.value);
      if (value === r.old) throw new Error('接口存储金额与当前回读一致；该存储值不代表控制台生效模式，不重复写入。');
      if (r.old > 0 && value > 0 && Math.abs((value - r.old) / r.old * 100) > (limits.budgetChangePctMax ?? 100)) throw new Error('账户预算改动幅度超过安全上限。');
      return { newValue: value, warnings: ['影响该账户全部 SP 活动，不包含 SB/SD。', '接口回读可能延迟；只改正数金额，不支持取消总上限或据金额判断控制台模式。'] };
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
      return { ok, status: ok ? 'SUBMITTED' : 'FAILED', response, profileResponse: matches[0], error: ok ? undefined : JSON.stringify(matches[0]) };
    },
    async readback(store, c, expected, sent) {
      const r = await read(store, c); const match = r.old === expected;
      return { actual: r.old, match, ...(!match && sent?.ok === true ? { status: 'AWAITING_READBACK', note: '已受理，但Profiles回读尚未匹配；可能延迟，只核验，不自动重发。' } : {}) };
    },
  };
}
export const ACCOUNT_BUDGET_OP = createAccountBudgetOperation();
