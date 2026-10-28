// 亚马逊广告接口客户端。
//
// 用的接口（2026-10 核对）：
//   广告管理（SP、SB）：统一接口 Amazon Ads API v1（/adsApi/v1/{query|update|create}/{campaigns|adGroups|ads|targets}），官方正式版。
//   广告管理（SD）：官方尚未发布 SD 的统一接口迁移资料，暂用原 SD 接口（/sd/...）。
//   报表：Reporting API v1（/adsApi/v1/{create|retrieve}/reports）。官方目前仍标为测试版，
//         只用公开示例里能确认的字段；搜索词/投放/推广商品等维度暂时自动退回 v3 报表（/reporting/reports），
//         v3 报表 2027-06-30 关停，届时按官方 v1 字段更新。
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { request, HttpError } from './http.js';
import { accessToken } from './lwa.js';
import { getSecret } from './secrets.js';
import { getStore, updateConfig } from './config.js';
import { adsHost } from './regions.js';
import { p, FILES } from './paths.js';
import { readJson, writeJson, canonical } from './jsonfile.js';
import { previewText } from './spapi.js';

export const V3_REPORT_SUNSET = '2027-06-30';

export function adsCreds(alias) {
  const c = getSecret(`ads:${alias}`);
  if (!c) throw new Error(`店铺“${alias}”还没接广告接口（Ads API）。请运行 \`xander setup\` → 接入广告。`);
  return c;
}

export function profileFor(store, mpCode) {
  const profiles = store.ads?.profiles || {};
  const code = (mpCode || store.defaultMarketplace || Object.keys(profiles)[0] || '').toUpperCase();
  const id = profiles[code];
  if (!id) throw new Error(`店铺“${store.alias}”的 ${code || '?'} 站没有绑定广告 profile。已绑定：${Object.keys(profiles).join('、') || '无'}`);
  return { code, profileId: String(id) };
}

// 通用请求。统一接口用 Amazon-Ads-ClientId；旧接口（SD、v3 报表、profiles）用 Amazon-Advertising-API-ClientId。两个都带，互不影响。
export async function ads(alias, method, apiPath, { body, query, contentType = 'application/json', accept, profileId, accountId, isWrite = false, noProfile = false } = {}) {
  const store = getStore(alias);
  const creds = adsCreds(store.alias);
  const token = await accessToken(creds, store.region);
  const url = new URL(adsHost(store.region) + apiPath);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const headers = {
    Authorization: `Bearer ${token}`,
    'Amazon-Ads-ClientId': creds.clientId,
    'Amazon-Advertising-API-ClientId': creds.clientId,
    'Content-Type': contentType,
    Accept: accept || contentType,
  };
  if (!noProfile && profileId) headers['Amazon-Advertising-API-Scope'] = profileId;
  if (accountId) headers['Amazon-Ads-AccountId'] = accountId;
  const res = await request(url.toString(), { method, headers, body, isWrite });
  return res.data;
}

export async function listProfiles(alias) {
  return ads(alias, 'GET', '/v2/profiles', { noProfile: true });
}

// ---------- 统一接口：广告主账户（报表 v1 需要） ----------
export async function listAdvertiserAccounts(alias) {
  const data = await ads(alias, 'POST', '/adsApi/v1/query/advertiserAccounts', { body: {}, noProfile: true });
  return data?.advertiserAccounts || [];
}

// 找到某个站点 profile 对应的广告主账户 ID，并缓存到配置里
export async function advertiserAccountFor(store, mpCode) {
  const { code, profileId } = profileFor(store, mpCode);
  const cached = store.ads?.accounts?.[code];
  // 旧缓存没有绑定 profile/区域；重新接入后不能把旧广告主 ID 当成新账户使用。
  if (cached?.entities && typeof cached.entities === 'object' && !Array.isArray(cached.entities) && typeof cached.advertiserAccountId === 'string' && cached.advertiserAccountId &&
      cached.profileId === profileId && cached.region === store.region) return { ...cached, code, profileId };
  const accounts = await listAdvertiserAccounts(store.alias);
  // 优先选只覆盖这个站点的账户，其次选包含它的全球账户
  const hits = accounts.filter((a) => (a.alternateIds || []).some((x) => String(x.profileId) === profileId));
  hits.sort((a, b) => (a.alternateIds?.length || 0) - (b.alternateIds?.length || 0));
  const hit = hits[0];
  if (!hit || typeof hit.advertiserAccountId !== 'string' || !hit.advertiserAccountId) throw new Error(`没找到 profile ${profileId}（${code} 站）对应的广告主账户。请运行 \`xander doctor\` 检查广告授权。`);
  // entityId → 站点代码：全球账户的 v1 报表会混着多个站点，靠 advertiserAccount.entityId 拆开
  const entities = {};
  for (const x of hit.alternateIds || []) if (x.entityId && x.countryCode) entities[String(x.entityId)] = String(x.countryCode).toUpperCase();
  const entry = { advertiserAccountId: hit.advertiserAccountId, isGlobalAccount: !!hit.isGlobalAccount || (hit.alternateIds || []).length > 1, entities, profileId, region: store.region };
  updateConfig((cfg) => {
    const s = cfg.stores[store.alias];
    if (!s || s.region !== store.region || String(s.ads?.profiles?.[code]) !== profileId) throw new Error('广告账户绑定已改变，请按当前配置重新申请报表。');
    s.ads ||= {};
    s.ads.accounts ||= {};
    s.ads.accounts[code] = entry;
  });
  return { code, profileId, ...entry };
}

// ---------- 读广告对象 ----------
const AD_PRODUCT = { sp: 'SPONSORED_PRODUCTS', sb: 'SPONSORED_BRANDS', sd: 'SPONSORED_DISPLAY' };

// resource：统一接口的资源名；preset：自动附加的筛选（让“关键词”“否定词”这些老说法也能用）
export const ENTITIES = {
  'sp.campaigns': { unified: true, ad: 'sp', resource: 'campaigns', max: 100 },
  'sp.adGroups': { unified: true, ad: 'sp', resource: 'adGroups', max: 100 },
  'sp.ads': { unified: true, ad: 'sp', resource: 'ads', max: 100 },
  'sp.targets': { unified: true, ad: 'sp', resource: 'targets', max: 5000 },
  'sp.keywords': { unified: true, ad: 'sp', resource: 'targets', max: 5000, preset: { targetTypeFilter: { include: ['KEYWORD'] }, negativeFilter: { include: [false] } } },
  'sp.negativeKeywords': { unified: true, ad: 'sp', resource: 'targets', max: 5000, preset: { targetTypeFilter: { include: ['KEYWORD'] }, negativeFilter: { include: [true] } } },
  'sb.campaigns': { unified: true, ad: 'sb', resource: 'campaigns', max: 100 },
  'sb.adGroups': { unified: true, ad: 'sb', resource: 'adGroups', max: 100 },
  'sb.ads': { unified: true, ad: 'sb', resource: 'ads', max: 100 },
  'sb.targets': { unified: true, ad: 'sb', resource: 'targets', max: 5000 },
  'sd.campaigns': { unified: false, path: '/sd/campaigns' },
  'sd.targets': { unified: false, path: '/sd/targets' },
};

// Campaign/ad-group/ad query limits differ by ad product. Keep targets on their
// existing contract; these limits must not be applied to target queries or SD's
// legacy offset/count API. See docs/ads-budget-api.md for the pinned schemas.
const ENTITY_QUERY_MAX_RESULTS = { SPONSORED_PRODUCTS: 1000, SPONSORED_BRANDS: 100 };
export function buildUnifiedQueryBody({ ad, resource, filters = {}, maxResults, nextToken }) {
  const body = { adProductFilter: { include: [AD_PRODUCT[ad] || ad] }, ...filters };
  if (['campaigns', 'adGroups', 'ads'].includes(resource)) {
    const products = body.adProductFilter?.include;
    if (!Array.isArray(products) || !products.length || products.some((p) => !ENTITY_QUERY_MAX_RESULTS[p])) throw new Error('统一实体查询需要已支持的 SP / SB 广告类型。');
    const limit = Math.min(...products.map((p) => ENTITY_QUERY_MAX_RESULTS[p]));
    const requested = maxResults ?? body.maxResults ?? limit;
    if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('maxResults 必须是正整数。');
    body.maxResults = Math.min(requested, limit);
  } else if (maxResults !== undefined) body.maxResults = maxResults;
  if (nextToken) body.nextToken = nextToken;
  return body;
}

// 统一接口查询（单页）；调用方仍须完整处理 nextToken。
export async function unifiedQuery(alias, { ad, resource, profileId, filters = {}, maxResults, nextToken }) {
  const body = buildUnifiedQueryBody({ ad, resource, filters, maxResults, nextToken });
  return ads(alias, 'POST', `/adsApi/v1/query/${resource}`, { profileId, body });
}

export async function listEntities(alias, entity, { marketplace, filters = {}, maxPages = 20 } = {}) {
  const def = ENTITIES[entity];
  if (!def) throw new Error(`不支持的实体：${entity}。可用：${Object.keys(ENTITIES).join('、')}`);
  const store = getStore(alias);
  const { profileId, code } = profileFor(store, marketplace);
  const items = [];
  let pages = 0;
  let complete = true;
  if (def.unified) {
    let nextToken;
    do {
      const data = await unifiedQuery(store.alias, { ad: def.ad, resource: def.resource, profileId, filters: { ...(def.preset || {}), ...filters }, maxResults: def.max, nextToken });
      items.push(...(data?.[def.resource] || []));
      nextToken = data?.nextToken;
      pages++;
    } while (nextToken && pages < maxPages);
    complete = !nextToken;
  } else {
    let startIndex = 0;
    for (;;) {
      const data = await ads(store.alias, 'GET', def.path, { profileId, query: { ...filters, startIndex, count: 100 } });
      const arr = Array.isArray(data) ? data : [];
      items.push(...arr);
      pages++;
      if (arr.length < 100) break;
      if (pages >= maxPages) { complete = false; break; }
      startIndex += 100;
    }
  }
  return { marketplace: code, profileId, api: def.unified ? 'Ads API v1（统一接口）' : 'SD 原接口', count: items.length, complete, pages, items };
}

// ---------- 报表 ----------
// v1 预设：只用官方公开示例里出现过的字段
const V1_BASE_METRICS = ['metric.impressions', 'metric.clicks', 'metric.totalCost', 'metric.purchases', 'metric.sales', 'metric.unitsSold'];
// advertiserAccount.entityId 用来区分站点（全球账户会把多个站点放在同一份报表里）。
// Amazon 强制要求：只要带了 entityId，就必须同时带 advertiserAccount.id，
// 否则 create report 返回 400006 "field advertiserAccount.entityId cannot be
// used without also including fields: (advertiserAccount.id)"。
const ACCOUNT_ID = 'advertiserAccount.id';
const SITE = 'advertiserAccount.entityId';
export const V1_PRESETS = {
  campaigns: [ACCOUNT_ID, SITE, 'date.value', 'adProduct.value', 'campaign.id', 'campaign.name', 'budgetCurrency.value', ...V1_BASE_METRICS],
  ad_groups: [ACCOUNT_ID, SITE, 'date.value', 'adProduct.value', 'campaign.id', 'adGroup.id', 'adGroup.name', 'budgetCurrency.value', ...V1_BASE_METRICS],
  // 亚马逊要求 fields 里必须恰好有一个时间维度（否则 400016），所以汇总类预设也要带 date.value。
  campaigns_summary: [ACCOUNT_ID, SITE, 'date.value', 'adProduct.value', 'campaign.id', 'campaign.name', 'budgetCurrency.value', ...V1_BASE_METRICS, 'metric.newToBrandPurchases', 'metric.newToBrandSales', 'metric.detailPageViews'],
};

// v1 还不能确认字段名的报表，暂用 v3（2027-06-30 前可用）
export const V3_PRESETS = {
  sp_search_terms: { adProduct: 'SPONSORED_PRODUCTS', reportTypeId: 'spSearchTerm', groupBy: ['searchTerm'], columns: ['date', 'campaignId', 'adGroupId', 'keywordId', 'keyword', 'matchType', 'searchTerm', 'impressions', 'clicks', 'cost', 'purchases7d', 'sales7d'] },
  sp_targeting: { adProduct: 'SPONSORED_PRODUCTS', reportTypeId: 'spTargeting', groupBy: ['targeting'], columns: ['date', 'campaignId', 'adGroupId', 'keywordId', 'targeting', 'keywordType', 'matchType', 'impressions', 'clicks', 'cost', 'purchases7d', 'sales7d'] },
  sp_advertised_product: { adProduct: 'SPONSORED_PRODUCTS', reportTypeId: 'spAdvertisedProduct', groupBy: ['advertiser'], columns: ['date', 'campaignId', 'adGroupId', 'advertisedAsin', 'advertisedSku', 'impressions', 'clicks', 'cost', 'purchases7d', 'sales7d', 'unitsSoldClicks7d'] },
};

function v3Allowed() {
  return new Date().toISOString().slice(0, 10) <= V3_REPORT_SUNSET;
}

export async function requestAdsReport(alias, { marketplace, startDate, endDate, preset, fields, configuration, api, reuseHours = 12 }) {
  const store = getStore(alias);
  const useV3 = !!(api === 'v3' || (!!configuration && api !== 'v1') || (preset && V3_PRESETS[preset]));
  const { profileId, code } = profileFor(store, marketplace);
  if (!Number.isFinite(reuseHours) || reuseHours < 0) throw new Error('reuseHours 必须是非负有限数字；0 表示不复用缓存。');
  let acct, cfgBody, qFields, body;
  if (useV3) {
    if (!v3Allowed()) throw new Error(`v3 报表已于 ${V3_REPORT_SUNSET} 关停。请改用 v1 报表（preset=campaigns/ad_groups 或自定 fields）。`);
    if (!configuration && !V3_PRESETS[preset]) throw new Error('v3 报表需要有效的 preset 或 configuration。');
    if (configuration && (typeof configuration !== 'object' || Array.isArray(configuration))) throw new Error('v3 configuration 必须是对象。');
    // 克隆实际会发送的 JSON，配置对象的插入顺序不影响缓存，列/分组数组仍保留顺序。
    cfgBody = JSON.parse(JSON.stringify(configuration || { ...V3_PRESETS[preset], timeUnit: 'DAILY', format: 'GZIP_JSON' }));
    body = { name: `xander-${cfgBody.reportTypeId}-${startDate}-${endDate}`, startDate, endDate, configuration: cfgBody };
  } else {
    if (fields !== undefined && (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string' || !field))) throw new Error('v1 fields 必须是非空字段名组成的数组。');
    const selected = fields?.length ? fields : V1_PRESETS[preset || 'campaigns'];
    if (!selected) throw new Error(`没有这个 v1 预设：${preset}。可用：${Object.keys(V1_PRESETS).join('、')}，或传 fields。`);
    qFields = [...selected];
    acct = await advertiserAccountFor(store, code);
    if (acct.isGlobalAccount && !qFields.includes(SITE)) qFields = [SITE, ...qFields];
    if (qFields.includes(SITE) && !qFields.includes(ACCOUNT_ID)) qFields = [ACCOUNT_ID, ...qFields];
    body = {
      reports: [{ format: 'GZIP_JSON', periods: [{ datePeriod: { startDate, endDate } }], query: { fields: qFields } }],
      accessRequestedAccounts: [{ advertiserAccountId: acct.advertiserAccountId }],
    };
  }
  // 先解析/校验当前账户及最终请求，再查缓存。新的版本标记使旧的不完整缓存键失效。
  const currentStore = getStore(store.alias);
  if (currentStore.region !== store.region || profileFor(currentStore, code).profileId !== profileId ||
      (acct && currentStore.ads?.accounts?.[code]?.advertiserAccountId !== acct.advertiserAccountId)) throw new Error('广告账户绑定已改变，请按当前配置重新申请报表。');
  body = JSON.parse(JSON.stringify(body));
  const binding = { store: store.alias, region: store.region, marketplace: code, profileId, ...(acct ? { advertiserAccountId: acct.advertiserAccountId } : {}) };
  const key = canonical(['ads-report', 2, useV3 ? 'v3' : 'v1', binding, body]);
  const index = readJson(FILES.reportIndex(), {});
  const prev = index[key];
  const age = Date.now() - prev?.requestedAt;
  if (prev?.cacheVersion === 2 && typeof prev.reportId === 'string' && prev.reportId && reuseHours > 0 && age >= 0 && age < reuseHours * 3600_000) {
    const { cacheVersion, ...metadata } = prev;
    return { ...metadata, reused: true, reuseNote: `复用 ${reuseHours} 小时内同账户、同请求的报表，避免重复申请被限流；status 是申请时回执，当前状态请 collect。` };
  }

  let out;
  if (useV3) {
    let reportId;
    try {
      const data = await ads(store.alias, 'POST', '/reporting/reports', {
        profileId, contentType: 'application/vnd.createasyncreportrequest.v3+json',
        body,
      });
      reportId = data.reportId;
    } catch (e) {
      const m = e instanceof HttpError && e.status === 425 && JSON.stringify(e.body).match(/duplicate of\s*:?\s*([0-9a-f-]{36})/i);
      if (!m) throw e;
      reportId = m[1];
    }
    if (typeof reportId !== 'string' || !reportId) throw new Error('v3 报表没有返回有效的 reportId。');
    out = { reportId, api: 'v3', marketplace: code, configuration: cfgBody, note: `这类报表（${cfgBody.reportTypeId}）暂用 v3 接口，v3 将于 ${V3_REPORT_SUNSET} 关停。` };
  } else {
    const data = await ads(store.alias, 'POST', '/adsApi/v1/create/reports', {
      noProfile: true,
      body,
    });
    const err = data?.error?.[0];
    if (err) throw new Error(`v1 报表申请被拒：${JSON.stringify(err.errors || err).slice(0, 500)}`);
    const rep = data?.success?.[0]?.report;
    if (!rep?.reportId) throw new Error(`v1 报表没有返回 reportId：${JSON.stringify(data).slice(0, 300)}`);
    out = {
      reportId: rep.reportId, api: 'v1', marketplace: acct.code, status: rep.status, fields: qFields,
      note: acct.isGlobalAccount ? `这是全球广告账户：报表会包含多个站点，取回时会按站点拆开，只保留 ${acct.code} 站的行。` : null,
    };
  }
  const requestedAt = Date.now();
  // 保留其他并行报表刚写入的索引；字段、站点、全球账户提示和原回执随缓存保留。
  const latestIndex = readJson(FILES.reportIndex(), {});
  latestIndex[key] = { ...out, requestedAt, cacheVersion: 2 };
  writeJson(FILES.reportIndex(), latestIndex);
  return { reused: false, ...out, requestedAt };
}

// 在 v1 返回的报表对象里找下载地址（字段结构官方仍在测试版，做宽松查找）
function findUrls(obj, acc = []) {
  if (!obj || typeof obj !== 'object') return acc;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /url|location|link/i.test(k)) acc.push(v);
    else if (typeof v === 'object') findUrls(v, acc);
  }
  return acc;
}

async function download(url) {
  const res = await request(url, { raw: true });
  let buf = Buffer.from(await res.arrayBuffer());
  try { buf = zlib.gunzipSync(buf); } catch { /* 已解压 */ }
  return buf;
}

export async function collectAdsReport(alias, reportId, { marketplace, api } = {}) {
  const store = getStore(alias);
  const index = readJson(FILES.reportIndex(), {});
  const known = Object.values(index).find((x) => x.reportId === reportId);
  const which = api || known?.api || 'v1';

  if (which === 'v3') {
    const { profileId } = profileFor(store, marketplace);
    const meta = await ads(store.alias, 'GET', `/reporting/reports/${encodeURIComponent(reportId)}`, {
      profileId, contentType: 'application/vnd.createasyncreportrequest.v3+json',
    });
    if (meta.status !== 'COMPLETED') {
      return { api: 'v3', status: meta.status, note: meta.status === 'FAILED' ? `报表失败：${meta.failureReason || ''}` : '报表还在生成，稍后再查。生成中不等于 0。' };
    }
    const buf = await download(meta.url);
    return save(store, `ads_v3_${meta.configuration?.reportTypeId || 'report'}_${reportId}.json`, buf, 'v3');
  }

  const data = await ads(store.alias, 'POST', '/adsApi/v1/retrieve/reports', { noProfile: true, body: { reportIds: [reportId] } });
  const err = data?.error?.[0];
  if (err) throw new Error(`查询 v1 报表失败：${JSON.stringify(err.errors || err).slice(0, 400)}`);
  const rep = data?.success?.[0]?.report;
  if (!rep) throw new Error(`查不到报表 ${reportId}`);
  if (rep.failureCode || rep.status === 'FAILED') return { api: 'v1', status: rep.status, note: `报表失败：${rep.failureCode || ''} ${rep.failureReason || ''}`.trim() };
  const urls = findUrls(rep.completedReportParts);
  if (!urls.length) {
    if (/COMPLETE|SUCCESS|DONE/i.test(String(rep.status))) {
      return { api: 'v1', status: rep.status, note: '报表显示已完成，但没找到下载地址（v1 报表仍是测试版，返回格式可能有变）。原始返回已附上，请把它反馈到 GitHub Issue；这次可先改用 v3 报表。', raw: rep };
    }
    return { api: 'v1', status: rep.status, note: '报表还在生成，稍后再查。生成中不等于 0。' };
  }
  const parts = [];
  for (const u of urls) parts.push(await download(u));
  // 多个分片：JSON 数组合并；CSV 去掉后续分片的表头
  let rows = null;
  try { rows = parts.flatMap((b) => JSON.parse(b.toString('utf8'))); } catch { /* 不是 JSON */ }
  if (!rows) {
    const buf = Buffer.from(parts.map((b, i) => (i === 0 ? b.toString('utf8') : b.toString('utf8').split('\n').slice(1).join('\n'))).join('\n'));
    return save(store, `ads_v1_${reportId}.csv`, buf, 'v1', { parts: urls.length, fields: rep.query?.fields, note: '返回不是 JSON，未按站点拆分；全球账户请自行按站点区分，不同币种不要相加。' });
  }
  const split = await splitBySite(store, rows, marketplace || known?.marketplace);
  const extra = { parts: urls.length, fields: rep.query?.fields, ...split.info };
  if (split.others.length) {
    const allFile = path.join(p('reports'), `${store.alias}_ads_v1_${reportId}_所有站点.json`);
    fs.writeFileSync(allFile, JSON.stringify(rows), { mode: 0o600 });
    extra.allSitesFile = allFile;
  }
  return save(store, `ads_v1_${reportId}.json`, Buffer.from(JSON.stringify(split.kept)), 'v1', extra);
}

function rowEntity(r) {
  const v = r?.['advertiserAccount.entityId'] ?? r?.advertiserAccount?.entityId;
  return v == null ? null : String(v);
}

// 给每行标上“站点”，并只保留目标站点的行（全球账户会混站点；币种不同的数字绝不能相加）
export async function splitBySite(store, rows, mpCode) {
  if (!rows.some((r) => rowEntity(r))) {
    const cur = new Set(rows.map((r) => r?.['budgetCurrency.value'] ?? r?.budgetCurrency?.value).filter(Boolean));
    return { kept: rows, others: [], info: cur.size > 1 ? { warning: `报表里有多个币种（${[...cur].join('、')}），可能混了多个站点，没有站点字段无法拆分，不同币种不要相加。` } : {} };
  }
  let acct;
  try { acct = await advertiserAccountFor(store, mpCode); } catch { acct = null; }
  const map = acct?.entities || {};
  const target = acct?.code || (mpCode ? String(mpCode).toUpperCase() : null);
  const kept = []; const others = []; const bySite = {};
  for (const r of rows) {
    const site = map[rowEntity(r)] || null;
    const row = { 站点: site || '未知', ...r };
    bySite[row.站点] = (bySite[row.站点] || 0) + 1;
    (site === target ? kept : others).push(row);
  }
  const info = { 站点: target, 各站点行数: bySite };
  if (others.length) info.note = `报表含 ${Object.keys(bySite).length} 个站点，已只保留 ${target} 站 ${kept.length} 行；其他站点的行在 allSitesFile 里。不同站点、不同币种不要相加。`;
  if (bySite['未知']) info.warning = `有 ${bySite['未知']} 行认不出站点（entityId 不在账户映射里），没有算进 ${target} 站。可运行 \`xander doctor\` 刷新广告账户后重取。`;
  return { kept, others, info };
}

function save(store, name, buf, api, extra = {}) {
  const file = path.join(p('reports'), `${store.alias}_${name}`);
  fs.writeFileSync(file, buf, { mode: 0o600 });
  let rows = null;
  try { rows = JSON.parse(buf.toString('utf8')).length; } catch { /* 非 JSON 数组 */ }
  return { api, status: 'COMPLETED', file, rows, bytes: buf.length, ...extra, preview: previewText(buf.toString('utf8').slice(0, 6000), 3) };
}
