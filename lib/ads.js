// 亚马逊广告接口（Amazon Ads API v3）客户端。
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { request, HttpError } from './http.js';
import { accessToken } from './lwa.js';
import { getSecret } from './secrets.js';
import { getStore } from './config.js';
import { adsHost } from './regions.js';
import { p, FILES } from './paths.js';
import { readJson, writeJson } from './jsonfile.js';
import { previewText } from './spapi.js';

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

export async function ads(alias, method, apiPath, { body, query, contentType = 'application/json', accept, profileId, isWrite = false, noProfile = false } = {}) {
  const store = getStore(alias);
  const creds = adsCreds(store.alias);
  const token = await accessToken(creds, store.region);
  const url = new URL(adsHost(store.region) + apiPath);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const headers = {
    Authorization: `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId': creds.clientId,
    'Content-Type': contentType,
    Accept: accept || contentType,
  };
  if (!noProfile) headers['Amazon-Advertising-API-Scope'] = profileId;
  const res = await request(url.toString(), { method, headers, body, isWrite });
  return res.data;
}

export async function listProfiles(alias) {
  return ads(alias, 'GET', '/v2/profiles', { noProfile: true });
}

// 读列表用的实体目录（只读）
export const ENTITIES = {
  'sp.campaigns': { v3: true, path: '/sp/campaigns/list', ct: 'application/vnd.spCampaign.v3+json', key: 'campaigns' },
  'sp.adGroups': { v3: true, path: '/sp/adGroups/list', ct: 'application/vnd.spAdGroup.v3+json', key: 'adGroups' },
  'sp.keywords': { v3: true, path: '/sp/keywords/list', ct: 'application/vnd.spKeyword.v3+json', key: 'keywords' },
  'sp.negativeKeywords': { v3: true, path: '/sp/negativeKeywords/list', ct: 'application/vnd.spNegativeKeyword.v3+json', key: 'negativeKeywords' },
  'sp.targets': { v3: true, path: '/sp/targets/list', ct: 'application/vnd.spTargetingClause.v3+json', key: 'targetingClauses' },
  'sp.productAds': { v3: true, path: '/sp/productAds/list', ct: 'application/vnd.spProductAd.v3+json', key: 'productAds' },
  'sb.campaigns': { v3: true, path: '/sb/v4/campaigns/list', ct: 'application/vnd.sbcampaignresource.v4+json', key: 'campaigns' },
  'sd.campaigns': { v3: false, path: '/sd/campaigns' },
  'sd.targets': { v3: false, path: '/sd/targets' },
};

export async function listEntities(alias, entity, { marketplace, filters = {}, maxPages = 20 } = {}) {
  const def = ENTITIES[entity];
  if (!def) throw new Error(`不支持的实体：${entity}。可用：${Object.keys(ENTITIES).join('、')}`);
  const store = getStore(alias);
  const { profileId, code } = profileFor(store, marketplace);
  const items = [];
  let pages = 0;
  let complete = true;
  if (def.v3) {
    let nextToken;
    do {
      const data = await ads(store.alias, 'POST', def.path, {
        profileId, contentType: def.ct, body: { maxResults: 1000, ...filters, ...(nextToken ? { nextToken } : {}) },
      });
      items.push(...(data?.[def.key] || []));
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
  return { marketplace: code, profileId, count: items.length, complete, pages, items };
}

// ---------- 广告报表 v3（异步） ----------
export async function requestAdsReport(alias, { marketplace, name, startDate, endDate, configuration, reuseHours = 12 }) {
  const store = getStore(alias);
  const { profileId, code } = profileFor(store, marketplace);
  const key = JSON.stringify(['ads', store.alias, profileId, startDate, endDate, configuration]);
  const index = readJson(FILES.reportIndex(), {});
  const prev = index[key];
  if (prev && Date.now() - prev.requestedAt < reuseHours * 3600_000) {
    return { reused: true, reportId: prev.reportId, marketplace: code };
  }
  let reportId;
  try {
    const data = await ads(store.alias, 'POST', '/reporting/reports', {
      profileId,
      contentType: 'application/vnd.createasyncreportrequest.v3+json',
      body: { name: name || `xander-${configuration?.reportTypeId}-${startDate}-${endDate}`, startDate, endDate, configuration },
    });
    reportId = data.reportId;
  } catch (e) {
    // 425：亚马逊说这是重复申请，并告诉我们已有的报表 ID
    const m = e instanceof HttpError && e.status === 425 && JSON.stringify(e.body).match(/duplicate of\s*:?\s*([0-9a-f-]{36})/i);
    if (!m) throw e;
    reportId = m[1];
  }
  index[key] = { reportId, requestedAt: Date.now(), reportType: configuration?.reportTypeId };
  writeJson(FILES.reportIndex(), index);
  return { reused: false, reportId, marketplace: code };
}

export async function collectAdsReport(alias, reportId, { marketplace } = {}) {
  const store = getStore(alias);
  const { profileId } = profileFor(store, marketplace);
  const meta = await ads(store.alias, 'GET', `/reporting/reports/${encodeURIComponent(reportId)}`, {
    profileId, contentType: 'application/vnd.createasyncreportrequest.v3+json',
  });
  if (meta.status !== 'COMPLETED') {
    return { status: meta.status, note: meta.status === 'FAILED' ? `报表失败：${meta.failureReason || ''}` : '报表还在生成，稍后再查。生成中不等于 0。', meta };
  }
  const res = await request(meta.url, { raw: true });
  let buf = Buffer.from(await res.arrayBuffer());
  try { buf = zlib.gunzipSync(buf); } catch { /* 有时已解压 */ }
  const file = path.join(p('reports'), `${store.alias}_ads_${meta.configuration?.reportTypeId || 'report'}_${reportId}.json`);
  fs.writeFileSync(file, buf, { mode: 0o600 });
  let rows = null;
  try { rows = JSON.parse(buf.toString('utf8')).length; } catch { /* 非 JSON 数组 */ }
  return { status: 'COMPLETED', file, rows, bytes: buf.length, preview: previewText(buf.toString('utf8').slice(0, 6000), 3) };
}
