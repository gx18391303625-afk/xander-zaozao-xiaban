// These helpers never call getLabels/getBillOfLading. The approved operation
// sends that GET with isWrite:true, then immediately downloads its ephemeral URL.
// Official contract: fulfillmentInboundV0.json, commit
// 6ff4ad1fddb377a8febd5a8a300575703d6ca93e; v2024 Shipment/TransportationOption.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { p } from './paths.js';

const PAGE_TYPES = new Set([
  'PackageLabel_Letter_2', 'PackageLabel_Letter_4', 'PackageLabel_Letter_6',
  'PackageLabel_Letter_6_CarrierLeft', 'PackageLabel_A4_2', 'PackageLabel_A4_4',
  'PackageLabel_Plain_Paper', 'PackageLabel_Plain_Paper_CarrierBottom',
  'PackageLabel_Thermal', 'PackageLabel_Thermal_Unified', 'PackageLabel_Thermal_NonPCP',
  'PackageLabel_Thermal_No_Carrier_Rotation',
]);
const PRINT_KEYS = ['PageType', 'LabelType', 'NumberOfPackages', 'PackageLabelsToPrint', 'NumberOfPallets', 'PageSize', 'PageStartIndex'];
const FREIGHT = ['FREIGHT_LTL', 'FREIGHT_FTL_PALLET', 'FREIGHT_FTL_NONPALLET'];
const PARCEL = ['GROUND_SMALL_PARCEL', 'AIR_SMALL_PARCEL', 'AIR_SMALL_PARCEL_EXPRESS'];
const MAX_BYTES = 32 * 1024 * 1024; // Local resource limit, not an Amazon limit.
const TIMEOUT_MS = 15_000;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function positive(v, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(v) || v < 1 || v > maximum) throw new Error(`${name} 必须是 1–${maximum} 的整数。`);
}
function boxId(v) {
  if (typeof v !== 'string' || !v.length || v.length > 1024 || v.trim() !== v || /[\p{Cc},]/u.test(v)) throw new Error('boxId 必须是完整、无控制字符或逗号的 API 箱号。');
  return v;
}
function internalId(v, name) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9-]{38}$/.test(v)) throw new Error(`${name} 必须是 38 字符的当前 API ID。`);
  return v;
}

// Only action/body are checked here; the owning operation validates top-level keys.
export function validateFbaDocumentChange(c) {
  if (!object(c) || !['generateLabels', 'billOfLading'].includes(c.action)) throw new Error('不支持的 FBA 文档动作。');
  const body = c.body === undefined ? {} : c.body;
  if (!object(body)) throw new Error('文档 body 必须是对象。');
  const allowed = c.action === 'generateLabels' ? PRINT_KEYS : [];
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new Error('文档 body 包含不支持的打印参数。');
  if (c.action === 'billOfLading') return true;
  if (!PAGE_TYPES.has(body.PageType)) throw new Error('PageType 必须使用官方 v0 打印纸张枚举。');
  if (!['UNIQUE', 'PALLET'].includes(body.LabelType)) throw new Error('本版 LabelType 仅支持 UNIQUE 箱唛或 PALLET 托盘标签，不支持 BARCODE_2D。');
  for (const key of ['NumberOfPackages', 'NumberOfPallets']) if (body[key] !== undefined) positive(body[key], key);
  if (body.PageSize !== undefined) positive(body.PageSize, 'PageSize', 1000);
  if (body.PageStartIndex !== undefined && (!Number.isSafeInteger(body.PageStartIndex) || body.PageStartIndex < 0)) throw new Error('PageStartIndex 必须是非负安全整数。');
  if ((body.PageSize === undefined) !== (body.PageStartIndex === undefined)) throw new Error('PageSize 与 PageStartIndex 必须一起明确提供，不推算打印分页。');
  if (body.PackageLabelsToPrint !== undefined) {
    if (!Array.isArray(body.PackageLabelsToPrint) || !body.PackageLabelsToPrint.length || body.PackageLabelsToPrint.length > 1000) throw new Error('PackageLabelsToPrint 必须包含 1–1000 个箱号（本地单次上限）。');
    body.PackageLabelsToPrint.forEach(boxId);
    if (new Set(body.PackageLabelsToPrint).size !== body.PackageLabelsToPrint.length) throw new Error('PackageLabelsToPrint 不能重复箱号。');
  }
  if (body.LabelType === 'UNIQUE' && body.NumberOfPallets !== undefined) throw new Error('UNIQUE 不接受 NumberOfPallets。');
  if (body.LabelType === 'PALLET') {
    positive(body.NumberOfPallets, 'NumberOfPallets');
    if (body.NumberOfPackages !== undefined || body.PackageLabelsToPrint !== undefined) throw new Error('PALLET 不接受箱唛参数 NumberOfPackages/PackageLabelsToPrint。');
  }
  return true;
}

function pageCompatibility(body, transport, marketplace) {
  const own = transport.shippingSolution === 'USE_YOUR_OWN_CARRIER';
  const code = String(transport.carrier?.alphaCode || '').toUpperCase();
  const name = String(transport.carrier?.name || '').toUpperCase();
  const ups = ['UPS', 'UPSN'].includes(code) || ['UPS', 'UNITED PARCEL SERVICE'].includes(name);
  const dhl = ['DHL', 'DHLE', 'DHLEX'].includes(code) || name === 'DHL';
  const ats = code === 'ATS' || name === 'ATS' || name === 'AMAZON TRANSPORTATION SERVICES';
  if (['PackageLabel_Plain_Paper', 'PackageLabel_Thermal_NonPCP'].includes(body.PageType) && !own) throw new Error('所选 PageType 仅用于非合作承运货件。');
  if (body.PageType === 'PackageLabel_Thermal' && (own || !ups)) throw new Error('PackageLabel_Thermal 需要已确认的 UPS 合作承运方案。');
  if (body.PageType === 'PackageLabel_Thermal_Unified' && !ats) throw new Error('PackageLabel_Thermal_Unified 需要 ATS 承运方案。');
  if (body.PageType === 'PackageLabel_Thermal_No_Carrier_Rotation' && (own || !dhl)) throw new Error('此热敏纸张需要 DHL 合作承运方案。');
  if (marketplace === 'US' && body.PageType === 'PackageLabel_Letter_2' && (own || !ups)) throw new Error('美国站 PackageLabel_Letter_2 需要 UPS 合作承运方案。');
  // The v0 model does not define a complete pallet/page-type compatibility matrix.
  // Preserve other official enum values; Amazon may reject unavailable formats.
}

export function prepareFbaDocumentQuery(c, shipment, boxes, transportOption) {
  validateFbaDocumentChange(c);
  if (!object(shipment) || shipment.shipmentId !== c.shipmentId) throw new Error('文档货件必须与当前请求的 shipmentId 精确匹配。');
  internalId(shipment.shipmentId, 'shipmentId');
  const confirmationId = shipment.shipmentConfirmationId;
  // The model only says string; this stricter local boundary accepts FBA IDs,
  // never an internal UUID, a path, an externally supplied substitute or an alias.
  if (typeof confirmationId !== 'string' || !/^FBA[A-Z0-9]+$/.test(confirmationId) || confirmationId.length > 1024) throw new Error('缺少有效 shipmentConfirmationId（FBA 确认货件号）；不能使用内部 38 字符 ID 调用 v0。');
  if (!object(transportOption) || transportOption.shipmentId !== shipment.shipmentId
      || transportOption.transportationOptionId !== shipment.selectedTransportationOptionId) throw new Error('必须提供此货件当前已确认的运输方案。');
  internalId(transportOption.transportationOptionId, 'transportationOptionId');
  if (!['AMAZON_PARTNERED_CARRIER', 'USE_YOUR_OWN_CARRIER'].includes(transportOption.shippingSolution)) throw new Error('运输方案的承运方式不明确。');
  const expected = {
    kind: c.action, shipmentId: shipment.shipmentId, shipmentConfirmationId: confirmationId,
    transportationOptionId: transportOption.transportationOptionId,
    shippingMode: transportOption.shippingMode, shippingSolution: transportOption.shippingSolution,
  };
  const prefix = `/fba/inbound/v0/shipments/${confirmationId}`;
  if (c.action === 'billOfLading') {
    if (transportOption.shippingSolution !== 'AMAZON_PARTNERED_CARRIER' || !FREIGHT.includes(transportOption.shippingMode)) throw new Error('提单仅支持已确认的 Amazon 合作承运 LTL/FTL 货件。');
    return { path: `${prefix}/billOfLading`, query: {}, expected };
  }
  const query = structuredClone(c.body);
  if (![...PARCEL, ...FREIGHT].includes(transportOption.shippingMode)) throw new Error('本版文档仅支持小包或 LTL/FTL 运输方式。');
  pageCompatibility(query, transportOption, c.marketplace || 'US');
  const nonPartneredLtl = transportOption.shippingSolution === 'USE_YOUR_OWN_CARRIER' && transportOption.shippingMode === 'FREIGHT_LTL';
  if (nonPartneredLtl && query.PageSize === undefined) throw new Error('非合作 LTL 必须明确 PageSize 与 PageStartIndex。');
  if (PARCEL.includes(transportOption.shippingMode) && query.PageSize !== undefined) throw new Error('小包打印使用明确 boxId，不接受 LTL 打印分页。');
  if (query.LabelType === 'PALLET') {
    if (!['FREIGHT_LTL', 'FREIGHT_FTL_PALLET'].includes(transportOption.shippingMode)) throw new Error('PALLET 标签仅用于有托盘的 LTL/FTL_PALLET 货件。');
    // The four-argument interface has no pallet inventory. Do not pretend that
    // the user-approved count has been independently verified against Amazon.
    expected.palletCount = query.NumberOfPallets;
    expected.palletCountSource = 'APPROVED_INPUT';
  } else {
    if (!Array.isArray(boxes) || !boxes.length) throw new Error('UNIQUE 标签需要完整的当前货件箱号明细。');
    const ids = boxes.map((box) => {
      if (!object(box) || box.quantity !== 1) throw new Error('每条箱记录必须明确 quantity=1；不能从合并箱组推造或复制 UNIQUE 箱号。');
      return boxId(box.boxId);
    });
    if (new Set(ids).size !== ids.length) throw new Error('当前货件 boxId 重复，不能确认箱唛范围。');
    if (query.NumberOfPackages !== undefined && query.NumberOfPackages !== ids.length) throw new Error('NumberOfPackages 必须等于完整当前货件的实际箱数。');
    const requested = query.PackageLabelsToPrint || ids;
    if (requested.length > 1000) throw new Error('单次超过 1000 个箱唛；请明确较小的 PackageLabelsToPrint 后重新审批。');
    if (requested.some((value) => !ids.includes(value))) throw new Error('PackageLabelsToPrint 必须使用此货件实际 boxId，不能使用 packageId 或其他货件箱号。');
    query.NumberOfPackages = ids.length;
    query.PackageLabelsToPrint = [...requested];
    expected.totalBoxCount = ids.length;
    expected.boxIds = [...requested];
  }
  // PageStartIndex's base is not specified by the official v0 model. Forward the
  // approved literal values; never derive a printed ID range or loop label GETs.
  expected.print = structuredClone(query);
  return { path: `${prefix}/labels`, query, expected };
}

function safeUrl(value, base) {
  let url;
  try {
    if (typeof value !== 'string' || !value.length || value.length > 16_384 || /[\p{Cc}]/u.test(value)) throw new Error();
    url = new URL(value, base);
  } catch { throw new Error('文档下载地址无效。'); }
  const host = url.hostname.toLowerCase();
  const amazon = host === 'amazon.com' || host.endsWith('.amazon.com');
  // Amazon does not publish a fixed label-download host list. This local
  // allowlist permits Amazon's own domain and ordinary S3 endpoints only.
  // It deliberately excludes compute, API Gateway, VPC endpoints and CloudFront.
  const s3 = /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-](?:dualstack\.)?[a-z]{2}(?:-[a-z]+)+-\d)?\.amazonaws\.com(?:\.cn)?$/.test(host);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash || (!amazon && !s3)) throw new Error('文档只允许 HTTPS Amazon 自有域名或标准 S3 下载地址。');
  return url;
}
function checkExpiry(url, timestamp) {
  const expires = url.searchParams.get('Expires');
  if (expires !== null && (!/^\d+$/.test(expires) || !Number.isSafeInteger(Number(expires)) || Number(expires) * 1000 <= timestamp)) throw new Error('文档下载地址已过期或期限无效，请保留原生成回执，不自动重新生成。');
  const date = url.searchParams.get('X-Amz-Date'), seconds = url.searchParams.get('X-Amz-Expires');
  if (date !== null || seconds !== null) {
    if (!/^\d{8}T\d{6}Z$/.test(date || '') || !/^\d+$/.test(seconds || '')) throw new Error('文档下载签名期限无效。');
    const issued = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
    if (!Number.isFinite(issued) || !Number.isSafeInteger(Number(seconds)) || Number(seconds) < 1 || issued + Number(seconds) * 1000 <= timestamp) throw new Error('文档下载地址已过期或期限无效，请保留原生成回执，不自动重新生成。');
  }
}

export async function downloadFbaDocument(value, { kind = 'generateLabels', now = Date.now, fetchImpl = globalThis.fetch } = {}) {
  if (!['generateLabels', 'billOfLading'].includes(kind)) throw new Error('不支持的文档类型。');
  let current = safeUrl(value);
  const started = now();
  if (!Number.isFinite(started)) throw new Error('文档下载时钟无效。');
  const controller = new AbortController();
  let rejectTimeout, reader, response, directory;
  const timedOut = new Promise((_, reject) => { rejectTimeout = reject; });
  const timeoutError = () => new Error('文档下载超过 15 秒或中断；保留生成回执，不自动重新生成。');
  const timer = setTimeout(() => { controller.abort(); rejectTimeout(timeoutError()); }, TIMEOUT_MS);
  const checkTime = () => {
    const timestamp = now();
    if (!Number.isFinite(timestamp) || timestamp < started || timestamp - started >= TIMEOUT_MS) { controller.abort(); throw timeoutError(); }
    return timestamp;
  };
  try {
    const seen = new Set();
    for (let redirects = 0; ; redirects++) {
      checkExpiry(current, checkTime());
      if (seen.has(current.href)) throw new Error('文档下载重定向重复。');
      seen.add(current.href);
      response = await Promise.race([
        fetchImpl(current.href, { method: 'GET', redirect: 'manual', signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/pdf' } }),
        timedOut,
      ]);
      checkTime();
      if (response.redirected) throw new Error('下载客户端不能自行跟随未经校验的重定向。');
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        void response.body?.cancel().catch(() => {});
        if (redirects >= 2) throw new Error('文档下载超过重定向上限。');
        current = safeUrl(location, current);
        continue;
      }
      if (response.status !== 200) throw new Error('文档下载未成功；不自动重新生成或重试。');
      break;
    }
    const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (mimeType !== 'application/pdf') throw new Error('文档响应不是 application/pdf。');
    const size = response.headers.get('content-length');
    if (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_BYTES)) throw new Error('文档大小无效或超过本地 32 MiB 上限。');
    if (!response.body?.getReader) throw new Error('文档下载没有可读内容。');
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      checkTime();
      const chunk = await Promise.race([reader.read(), timedOut]);
      checkTime();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw new Error('文档下载流无效。');
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('文档超过本地 32 MiB 上限。');
      chunks.push(Buffer.from(chunk.value));
    }
    const data = Buffer.concat(chunks, bytes);
    if (bytes < 8 || !/^%PDF-\d\.\d/.test(data.subarray(0, 8).toString('ascii'))) throw new Error('下载内容缺少有效 PDF 文件头。');
    if (!data.subarray(Math.max(0, bytes - 1024)).includes(Buffer.from('%%EOF'))) throw new Error('PDF 缺少文件结束标记，可能下载不完整。');
    if (size !== null && Number(size) !== bytes && !response.headers.get('content-encoding')) throw new Error('文档实际字节数与响应长度不一致。');
    const root = p('documents');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('文档目录必须是权限 0700 的私有目录。');
    directory = fs.mkdtempSync(path.join(root, `${kind}-`));
    fs.chmodSync(directory, 0o700);
    const file = path.join(directory, `${randomUUID()}.pdf`);
    fs.writeFileSync(file, data, { flag: 'wx', mode: 0o600 });
    return { path: file, sha256: createHash('sha256').update(data).digest('hex'), bytes, mimeType };
  } catch {
    // Never embed fetch/URL/parser messages: they can include presigned secrets.
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    throw new Error('FBA PDF 下载或校验失败；生成动作不会自动重试。原生成回执需保留，下载地址不得写入日志。');
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    else if (response?.body) void response.body.cancel().catch(() => {});
  }
}
