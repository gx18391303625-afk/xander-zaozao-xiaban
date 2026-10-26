// SP single-field rename. See docs/ads-campaign-name.md for the pinned contract.
import { ads, profileFor } from './ads.js';
import { HttpError } from './http.js';

const SP = 'SPONSORED_PRODUCTS';
const ALLOWED_INPUT = new Set(['op', 'marketplace', 'campaignId', 'value', 'reason']);
const CLEAR_REJECTIONS = new Set([400, 401, 403, 404, 413, 415, 422, 429]);

function campaignId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('campaignId 数字超出安全精度，请使用字符串。');
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d{0,199}$/.test(String(value))) throw new Error('campaignId 必须是完整的正整数 ID，建议使用字符串。');
  return String(value);
}

const matchesId = (value, expected) => (typeof value === 'string' || Number.isSafeInteger(value)) && String(value) === expected;

function newName(value) {
  // 256 is this plugin's conservative limit, not a limit declared by the API schema.
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 256 || /\p{Cc}/u.test(value)) throw new Error('新名称必须是 1–256 字符的非空文本，不能含控制字符。');
  return value.trim();
}

function input(c) {
  const extra = Object.keys(c).filter((key) => !ALLOWED_INPUT.has(key));
  if (extra.length) throw new Error(`活动改名只接受 campaignId、value、marketplace 和 reason，不接受其他字段：${extra.join('、')}。`);
  return { id: campaignId(c.campaignId), name: newName(c.value) };
}

async function readCampaign(store, c) {
  const { id } = input(c);
  const { profileId, code } = profileFor(store, c.marketplace);
  if (code !== 'US' || store.region !== 'NA') throw new Error('当前活动改名只支持美国 US 站的 NA 区域 profile。');
  const profiles = await ads(store.alias, 'GET', '/v2/profiles', { noProfile: true });
  const matches = Array.isArray(profiles) ? profiles.filter((row) => matchesId(row?.profileId, profileId)) : [];
  if (matches.length !== 1 || matches[0].countryCode !== 'US' || matches[0].currencyCode !== 'USD') throw new Error('绑定的广告 profile 未唯一确认属于 US / USD，停止改名。');
  const result = await ads(store.alias, 'POST', '/adsApi/v1/query/campaigns', {
    profileId,
    body: { adProductFilter: { include: [SP] }, campaignIdFilter: { include: [id] }, stateFilter: { include: ['ENABLED', 'PAUSED', 'ARCHIVED'] }, maxResults: 10 },
  });
  if (!Array.isArray(result?.campaigns) || result.campaigns.length !== 1 || result.nextToken) throw new Error('活动查询未返回唯一完整结果，不能确认改名目标。');
  const row = result.campaigns[0];
  if (!matchesId(row.campaignId, id) || row.adProduct !== SP) throw new Error('活动 ID 或广告类型与批准目标不符，必须是指定 SP 活动。');
  if (!['ENABLED', 'PAUSED'].includes(row.state)) throw new Error('只支持已确认开启或暂停的活动，不能修改归档或未知状态。');
  if ((row.globalCampaignId != null && typeof row.globalCampaignId !== 'string') || row.globalCampaignId || row.marketplaceScope !== 'SINGLE_MARKETPLACE') throw new Error('不支持全球、跨站点或站点范围未确认的活动改名。');
  for (const key of ['marketplaces', 'countries']) {
    if (row[key] !== undefined && (!Array.isArray(row[key]) || row[key].length > 1 || row[key].some((code) => code !== 'US'))) throw new Error('活动站点或国家字段与 US profile 不一致，停止改名。');
  }
  if (typeof row.name !== 'string' || !row.name.trim()) throw new Error('活动没有可核对的原名称，停止改名。');
  return {
    profileId, marketplace: code, entity: { name: row.name }, old: row.name,
    precondition: { campaignId: id, adProduct: row.adProduct, state: row.state, globalCampaignId: row.globalCampaignId ?? null, marketplaceScope: row.marketplaceScope ?? null },
  };
}

export const CAMPAIGN_NAME_OP = {
  id: 'ads.sp.campaign.name', group: '广告 · SP 商品推广', label: '修改广告活动名称', risk: '低',
  implemented: true, channel: 'ads', api: 'Ads API v1', capability: 'api',
  requirements: '已绑定并实时验证的 US / USD、NA 区域广告 profile，SP 活动编辑权限；单独开启活动改名开关并批准提案。',
  limitation: '仅美国单站点 SP 活动名称；不改预算、竞价、状态、日期、归属或其他字段，不支持归档/全球活动。',
  params: { campaignId: '活动 ID（建议字符串）', value: '新名称，去除两端空白后 1–256 字符', marketplace: 'US', reason: '可选改名理由' },
  // An unresolved rename locks this entity, regardless of the next proposed name.
  mutationIdentity(c, request) { return { profileId: String(request.profileId), campaignId: campaignId(c.campaignId) }; },
  read: readCampaign,
  check(c, r) {
    const { name } = input(c);
    if (r.old === name) throw new Error('新名称与当前名称一致，不需要修改。');
    return { newValue: name, warnings: ['仅修改名称；活动状态、预算、竞价、广告位和关联保持原有设置。'] };
  },
  build(c, r, value) {
    const { id } = input(c);
    return { method: 'POST', path: '/adsApi/v1/update/campaigns', profileId: r.profileId, contentType: 'application/json', body: { campaigns: [{ campaignId: id, name: newName(value) }] } };
  },
  async send(store, req) {
    let response;
    try {
      response = await ads(store.alias, req.method, req.path, { profileId: req.profileId, contentType: req.contentType, body: req.body, isWrite: true });
    } catch (error) {
      if (error instanceof HttpError && CLEAR_REJECTIONS.has(error.status)) return { ok: false, status: 'FAILED', error: error.message };
      if (error instanceof HttpError) return { ok: false, status: 'OUTCOME_UNKNOWN', error: error.message, note: '更新请求未得到明确拒绝或成功回执，只允许核验，不重新提交。' };
      throw error;
    }
    const success = response?.success ?? [];
    const errors = response?.error ?? [];
    const validArrays = response && typeof response === 'object' && !Array.isArray(response)
      && (response.success === undefined || Array.isArray(response.success)) && (response.error === undefined || Array.isArray(response.error));
    if (validArrays && success.length === 1 && errors.length === 0 && success[0]?.index === 0
      && matchesId(success[0]?.campaign?.campaignId, req.body.campaigns[0].campaignId)
      && (success[0].campaign.adProduct === undefined || success[0].campaign.adProduct === SP)) {
      return { ok: true, status: 'SUBMITTED', response, note: '收到目标活动的唯一成功回执，等待独立读取名称。' };
    }
    if (validArrays && success.length === 0 && errors.length === 1 && errors[0]?.index === 0 && Array.isArray(errors[0].errors) && errors[0].errors.length > 0 && errors[0].errors.every((error) => error.code === 'INVALID_INPUT')) {
      return { ok: false, status: 'FAILED', response, error: 'Amazon 明确拒绝活动改名参数（INVALID_INPUT）。' };
    }
    return { ok: false, status: 'OUTCOME_UNKNOWN', response, error: '改名回执缺失、矛盾或未唯一匹配活动 ID；只允许继续核验，不重新提交。' };
  },
  async readback(store, c, expected) {
    const r = await readCampaign(store, c);
    const match = r.old === expected;
    return {
      actual: { name: r.old, campaignId: r.precondition.campaignId, adProduct: r.precondition.adProduct, state: r.precondition.state },
      match, status: match ? 'API_STATE_VERIFIED' : 'AWAITING_READBACK',
      note: match ? '指定美国 SP 活动的名称已独立回读一致；本次只提交名称字段。' : '回读名称尚未与批准值一致；保留回执，仅继续核验，不重新提交。',
    };
  },
};
