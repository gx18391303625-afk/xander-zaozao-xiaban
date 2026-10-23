// 亚马逊卖家接口（SP-API）客户端。只做“私有应用自授权”这一种用法：
// 店铺主自己在卖家后台建应用、自己授权，令牌只在本机。
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { request } from './http.js';
import { accessToken } from './lwa.js';
import { getSecret } from './secrets.js';
import { getStore } from './config.js';
import { marketplace, spapiHost } from './regions.js';
import { p, FILES } from './paths.js';
import { readJson, writeJson } from './jsonfile.js';

export function spapiCreds(alias) {
  const c = getSecret(`spapi:${alias}`);
  if (!c) throw new Error(`店铺“${alias}”还没接卖家接口（SP-API）。请运行 \`xander setup\` → 接入店铺。`);
  return c;
}

export async function spapi(alias, method, apiPath, { query, body, isWrite = false } = {}) {
  const store = getStore(alias);
  const token = await accessToken(spapiCreds(store.alias), store.region);
  const url = new URL(spapiHost(store.region) + apiPath);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const res = await request(url.toString(), {
    method,
    headers: {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'xander-zaozao-xiaban/1.0 (Language=JavaScript)',
    },
    body,
    isWrite,
  });
  return res.data;
}

export function mpId(store, code) {
  return marketplace(code || store.defaultMarketplace || store.marketplaces?.[0]).id;
}

// ---------- Listing ----------
export async function getListing(alias, sku, mpCode) {
  const store = getStore(alias);
  if (!store.sellerId) throw new Error(`店铺“${alias}”没有填写卖家 ID（Merchant Token），无法读 Listing。`);
  return spapi(alias, 'GET', `/listings/2021-08-01/items/${encodeURIComponent(store.sellerId)}/${encodeURIComponent(sku)}`, {
    query: { marketplaceIds: mpId(store, mpCode), includedData: 'summaries,attributes,issues,offers,fulfillmentAvailability' },
  });
}

export async function patchListing(alias, sku, mpCode, { productType, patches, preview = false }) {
  const store = getStore(alias);
  return spapi(alias, 'PATCH', `/listings/2021-08-01/items/${encodeURIComponent(store.sellerId)}/${encodeURIComponent(sku)}`, {
    query: { marketplaceIds: mpId(store, mpCode), ...(preview ? { mode: 'VALIDATION_PREVIEW' } : {}), includedData: 'issues' },
    body: { productType, patches },
    isWrite: !preview,
  });
}

// ---------- 报表：申请、查询、下载（异步） ----------
function reportKey(o) {
  return JSON.stringify([o.alias, o.reportType, o.marketplaceIds, o.dataStartTime || '', o.dataEndTime || '', o.reportOptions || {}]);
}

export async function requestReport(alias, { reportType, marketplaces, dataStartTime, dataEndTime, reportOptions, reuseHours = 12 }) {
  const store = getStore(alias);
  const marketplaceIds = (marketplaces?.length ? marketplaces : [store.defaultMarketplace]).map((c) => marketplace(c).id);
  const key = reportKey({ alias: store.alias, reportType, marketplaceIds, dataStartTime, dataEndTime, reportOptions });
  const index = readJson(FILES.reportIndex(), {});
  const prev = index[key];
  if (prev && Date.now() - prev.requestedAt < reuseHours * 3600_000) {
    return { reused: true, reportId: prev.reportId, note: `复用 ${new Date(prev.requestedAt).toISOString()} 申请的同一份报表，避免重复申请被限流。` };
  }
  const body = { reportType, marketplaceIds };
  if (dataStartTime) body.dataStartTime = dataStartTime;
  if (dataEndTime) body.dataEndTime = dataEndTime;
  if (reportOptions) body.reportOptions = reportOptions;
  const data = await spapi(store.alias, 'POST', '/reports/2021-06-30/reports', { body });
  index[key] = { reportId: data.reportId, requestedAt: Date.now(), reportType };
  writeJson(FILES.reportIndex(), index);
  return { reused: false, reportId: data.reportId };
}

export async function collectReport(alias, reportId) {
  const store = getStore(alias);
  const meta = await spapi(store.alias, 'GET', `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`);
  if (meta.processingStatus !== 'DONE') {
    return {
      status: meta.processingStatus,
      note: meta.processingStatus === 'FATAL' || meta.processingStatus === 'CANCELLED'
        ? '报表失败或被取消（CANCELLED 常见于该期间没有数据）。不要当成 0。'
        : '报表还在生成，稍后再查。生成中不等于没有数据。',
      meta,
    };
  }
  const doc = await spapi(store.alias, 'GET', `/reports/2021-06-30/documents/${encodeURIComponent(meta.reportDocumentId)}`);
  const res = await request(doc.url, { raw: true });
  let buf = Buffer.from(await res.arrayBuffer());
  if (doc.compressionAlgorithm === 'GZIP') buf = zlib.gunzipSync(buf);
  const ext = /JSON|_JSON|DATA_KIOSK/i.test(meta.reportType) ? 'json' : 'tsv';
  const file = path.join(p('reports'), `${store.alias}_${meta.reportType}_${reportId}.${ext}`);
  fs.writeFileSync(file, buf, { mode: 0o600 });
  return { status: 'DONE', file, bytes: buf.length, meta, preview: previewText(buf.toString('utf8')) };
}

export function previewText(text, lines = 8) {
  const all = text.split(/\r?\n/);
  return { totalLines: all.filter(Boolean).length, head: all.slice(0, lines).join('\n').slice(0, 4000) };
}
