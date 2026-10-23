// Listing image contributions and A+ Content. Official contracts and limits: docs/content-api.md.
// Each A+ proposal performs ONE mutation. No create/associate/submit retry chain.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { spapi, getListing, patchListing } from './spapi.js';
import { request } from './http.js';
import { marketplace } from './regions.js';
import { canonical, readJson, writeJson } from './jsonfile.js';
import { p } from './paths.js';

const APLUS = '/aplus/2020-11-01';
const HOUR = 3600_000;
const IMAGE_ATTRIBUTE = /^(main_product_image_locator|other_product_image_locator_[1-9])$/;
const ACTIONS = ['create', 'update', 'associate', 'submit'];
const same = (a, b) => canonical(a) === canonical(b);
const copy = (v) => JSON.parse(JSON.stringify(v));
const messages = (v) => (v || []).map((x) => typeof x === 'string' ? x : `${x.code || ''} ${x.message || ''}`.trim());
function requireValidation(result, submit = false) {
  if (!result.valid) throw new Error(`A+ 官方校验未通过：${messages(result.errors).join('；')}`);
  if (submit && result.warnings.length) throw new Error(`提交前需处理 A+ 校验警告：${messages(result.warnings).join('；')}`);
}

function marketFor(store, code) {
  const m = marketplace(code || store.defaultMarketplace);
  if (store.region !== m.region) throw new Error(`站点 ${m.code} 属于 ${m.region}，与店铺区域 ${store.region} 不一致。`);
  return m;
}
function referenceKey(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('缺少 contentReferenceKey；请先查询文档或完成草稿创建。');
  return value.trim();
}
function asins(value, required = false) {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.some((a) => typeof a !== 'string' || !/^[A-Z0-9]{10}$/.test(a))) throw new Error('asinSet 必须是 10 位大写字母/数字 ASIN 数组。');
  if (new Set(value).size !== value.length) throw new Error('asinSet 不能有重复 ASIN。');
  if (required && !value.length) throw new Error('asinSet 不能为空；本操作不提供清空所有关联。');
  return [...value].sort();
}
function publicImageUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('图片必须是已托管、可公开访问的 HTTPS URL；本机文件需先由用户自行托管。'); }
  const hostname = u.hostname.toLowerCase();
  // Images are fetched by Amazon, not by this plugin. Disallow local/private addresses nonetheless.
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || !hostname.includes('.') || net.isIP(hostname) || hostname.startsWith('[') || /(^|\.)(localhost|local|internal|test)$/.test(hostname) || hostname.endsWith('.localhost') || (u.port && u.port !== '443')) {
    throw new Error('图片 URL 必须是无账号密码、无片段的公开 HTTPS 域名地址，不能使用本机或内网地址。');
  }
  return u.href;
}
function requestedImages(c) {
  const value = c.images;
  if (!value || Array.isArray(value) || typeof value !== 'object' || !Object.keys(value).length) throw new Error('缺少 images 对象：图片属性名 → 公开 HTTPS 图片 URL。');
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (!IMAGE_ATTRIBUTE.test(key)) throw new Error(`不支持图片属性 ${key}；使用 main_product_image_locator 或 other_product_image_locator_N。`);
    if (typeof value[key] !== 'string') throw new Error(`${key} 必须是图片 URL 字符串。`);
    out[key] = publicImageUrl(value[key]);
  }
  return out;
}
function selectedImageValues(item, names, mpId) {
  return Object.fromEntries(names.sort().map((key) => [key, (item?.attributes?.[key] || []).filter((a) => !a.marketplace_id || a.marketplace_id === mpId).map((a) => a.media_location)]));
}
function contentDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('缺少完整 contentDocument。');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('A+ 文档 name 需要 1–100 个字符。');
  if (!['EBC', 'EMC', 'BrandStory'].includes(value.contentType)) throw new Error('contentType 必须是 EBC（卖家）、EMC（供应商）或 BrandStory。');
  if (!/^[a-z]{2,}-[A-Z0-9]{2,}$/.test(value.locale || '')) throw new Error('A+ locale 使用 en-US 形式的语言标签。');
  if (!Array.isArray(value.contentModuleList) || !value.contentModuleList.length || value.contentModuleList.length > 100) throw new Error('contentModuleList 必须是非空模块数组（模块数量和资格由 Amazon 实时校验）。');
  for (const module of value.contentModuleList) {
    if (!module || typeof module.contentModuleType !== 'string' || !module.contentModuleType) throw new Error('每个 A+ 模块必须包含 contentModuleType。');
  }
  // Full nested schema and account-specific eligibility are checked by Amazon's validation operation.
  const visit = (v) => {
    if (!v || typeof v !== 'object') return;
    if ('uploadDestinationId' in v && (typeof v.uploadDestinationId !== 'string' || !v.uploadDestinationId.trim())) throw new Error('A+ 图片需要已有的 uploadDestinationId。请先完成官方 Uploads API 上传或在 A+ Content Manager 中准备素材。');
    if ('imageCropSpecification' in v && !v.uploadDestinationId) throw new Error('A+ 图片缺少 uploadDestinationId；公开图片 URL 或本机文件路径不能直接用作 A+ 素材。');
    for (const child of Object.values(v)) visit(child);
  };
  visit(value);
  return copy(value);
}

async function officialSchema(definition) {
  const resource = definition?.schema?.link?.resource;
  let url;
  try { url = new URL(resource); } catch { throw new Error('Product Type Definitions 未返回 schema 下载地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(amazonaws\.com|amazon\.com)$/.test(url.hostname)) throw new Error('PTD schema 地址不是受支持的 Amazon HTTPS 地址。');
  const response = await request(url.href, { raw: true });
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw new Error('PTD schema 超过 8 MB，停止图片提案。');
  if (definition.schema.checksum && crypto.createHash('md5').update(text).digest('base64') !== definition.schema.checksum) throw new Error('PTD schema 校验和不一致，请重新查询。');
  return JSON.parse(text);
}

const persistentReviewCache = {
  file: (key) => p('aplus-review-cache', `${crypto.createHash('sha256').update(key).digest('hex')}.json`),
  get(key) { return readJson(this.file(key), null); },
  set(key, value) { writeJson(this.file(key), value); },
  delete(key) { fs.rmSync(this.file(key), { force: true }); },
};

export function createContentApi({ api = spapi, listing = getListing, patch = patchListing, fetchSchema = officialSchema, now = Date.now, reviewCache = persistentReviewCache } = {}) {
  const statusCache = reviewCache;
  const pathFor = (key) => `${APLUS}/contentDocuments/${encodeURIComponent(referenceKey(key))}`;
  const queryFor = (store, code) => ({ marketplaceId: marketFor(store, code).id });
  const cacheKey = (store, code, key) => `${store.alias}:${marketFor(store, code).id}:${key}`;
  function invalidate(store, code, key) { statusCache.delete(cacheKey(store, code, key)); }

  async function pages(store, path, query, field) {
    const rows = [];
    const seen = new Set();
    let next;
    do {
      const response = await api(store.alias, 'GET', path, { query: next ? { pageToken: next } : query });
      if (!Array.isArray(response?.[field])) throw new Error(`A+ ${field} 回执结构不完整，不能判定为空或没有重复。`);
      if (response.errors?.length) throw new Error(`A+ 查询失败：${messages(response.errors).join('；')}`);
      if (response.warnings?.length) throw new Error(`A+ 查询有警告，无法确认完整结果：${messages(response.warnings).join('；')}`);
      rows.push(...response[field]);
      next = response.nextPageToken;
      if (next && (seen.has(next) || seen.size >= 1000)) throw new Error('A+ 分页未完整结束，停止以避免漏掉现有对象。');
      if (next) seen.add(next);
    } while (next);
    return rows;
  }
  async function document(store, code, key) {
    const response = await api(store.alias, 'GET', pathFor(key), { query: { ...queryFor(store, code), includedDataSet: ['CONTENTS', 'METADATA'] } });
    const record = response?.contentRecord;
    if (!record?.contentDocument || !record?.contentMetadata || !record.contentReferenceKey) throw new Error('A+ 文档回执缺少内容/元数据/ID，不能核验。');
    if (record.contentReferenceKey !== key || record.contentMetadata.marketplaceId !== marketFor(store, code).id) throw new Error('A+ 文档回读的 ID 或站点与请求不一致。');
    if (response.errors?.length || response.warnings?.length) throw new Error(`A+ 文档读取未完整成功：${messages([...(response.errors || []), ...(response.warnings || [])]).join('；')}`);
    return record;
  }
  async function relations(store, code, key) {
    const rows = await pages(store, `${pathFor(key)}/asins`, queryFor(store, code), 'asinMetadataSet');
    return asins(rows.map((x) => x.asin));
  }
  async function listAplusDocuments(store, { marketplace: code } = {}) {
    const m = marketFor(store, code);
    return { marketplace: m.code, complete: true, documents: await pages(store, `${APLUS}/contentDocuments`, { marketplaceId: m.id }, 'contentMetadataRecords') };
  }
  async function validateAplusContent(store, { marketplace: code, contentDocument: value, asinSet } = {}) {
    const m = marketFor(store, code);
    const doc = contentDocument(value);
    const targetAsins = asins(asinSet);
    const response = await api(store.alias, 'POST', `${APLUS}/contentAsinValidations`, {
      query: { marketplaceId: m.id, ...(targetAsins ? { asinSet: targetAsins } : {}) }, body: { contentDocument: doc }, isWrite: false,
    });
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('A+ 校验响应不完整，不能把 HTTP 成功当作校验通过。');
    return { marketplace: m.code, valid: !(response.errors || []).length, errors: response.errors || [], warnings: response.warnings || [], status: (response.errors || []).length ? 'VALIDATION_FAILED' : 'VALIDATED', submitted: false, note: '仅校验内容和给定 ASIN 的资格；尚未创建、关联或提交审核。' };
  }
  async function getListingImageRequirements(store, { marketplace: code, sku } = {}) {
    if (typeof sku !== 'string' || !sku.trim()) throw new Error('缺少 sku。');
    const m = marketFor(store, code);
    const item = await listing(store.alias, sku, m.code);
    const summary = (item?.summaries || []).find((x) => x.marketplaceId === m.id) || item?.summaries?.[0];
    if (!summary?.productType) throw new Error('该 SKU 未返回 productType，不能构造图片更新。');
    const definition = await api(store.alias, 'GET', `/definitions/2020-09-01/productTypes/${encodeURIComponent(summary.productType)}`, {
      query: { marketplaceIds: m.id, sellerId: store.sellerId, requirements: 'LISTING', requirementsEnforced: 'ENFORCED', productTypeVersion: 'LATEST' },
    });
    const schema = await fetchSchema(definition);
    if (!schema?.properties || typeof schema.properties !== 'object') throw new Error('PTD schema 缺少 properties，不能确认图片属性。');
    const supportedAttributes = Object.keys(schema.properties).filter((key) => IMAGE_ATTRIBUTE.test(key)).sort();
    return { marketplace: m.code, productType: summary.productType, asin: summary.asin, supportedAttributes,
      current: selectedImageValues(item, supportedAttributes, m.id), attributes: item.attributes || {}, issues: item.issues || [],
      requirements: 'Product Listing 角色；使用该卖家/站点/商品类型的实时 PTD，并通过 VALIDATION_PREVIEW。',
      limitation: '公开 HTTPS 图片 URL；本工具不托管或上传本机图片。贡献回读不证明买家页面已显示。' };
  }
  async function getAplusStatus(store, { marketplace: code, contentReferenceKey, asinSet } = {}) {
    const m = marketFor(store, code);
    const key = referenceKey(contentReferenceKey);
    const explicitAsins = asins(asinSet);
    const ck = cacheKey(store, m.code, key);
    let snapshot = statusCache.get(ck);
    if (snapshot?.notBefore && now() < snapshot.notBefore) return { marketplace: m.code, contentReferenceKey: key,
      status: snapshot.submissionStatus, reviewStatus: 'NOT_YET_CHECKED', currentRevisionPublished: null,
      checkedAt: null, nextReviewCheckAt: new Date(snapshot.notBefore).toISOString(), cached: true,
      note: '审核提交后至少 1 小时再查；查询间隔已保存至本机，重启不会自动提前复查。' };
    const cached = !!snapshot?.record && now() - snapshot.checkedAt < HOUR;
    if (!cached) {
      snapshot = { checkedAt: now(), record: await document(store, m.code, key), asinSet: await relations(store, m.code, key) };
      statusCache.set(ck, snapshot);
    }
    const targets = explicitAsins || snapshot.asinSet;
    const publishRecords = [];
    // Publication records have no content revision identifier. Never label the current draft as published.
    for (const asin of targets) {
      const rows = await pages(store, `${APLUS}/contentPublishRecords`, { marketplaceId: m.id, asin }, 'publishRecordList');
      publishRecords.push(...rows.filter((r) => r.contentReferenceKey === key && r.marketplaceId === m.id && r.asin === asin));
    }
    const foundAsins = [...new Set(publishRecords.map((x) => x.asin))].sort();
    return { marketplace: m.code, contentReferenceKey: key, reviewStatus: snapshot.record.contentMetadata.status,
      status: snapshot.record.contentMetadata.status, contentMetadata: snapshot.record.contentMetadata,
      contentDocument: snapshot.record.contentDocument, asinSet: snapshot.asinSet, publishRecords,
      publishedAsins: foundAsins, publicationRecordFound: foundAsins.length > 0,
      publicationVerification: publishRecords.length ? 'REFERENCE_ONLY_NO_REVISION' : 'NO_PUBLISH_RECORD',
      currentRevisionPublished: null, checkedAt: new Date(snapshot.checkedAt).toISOString(),
      nextReviewCheckAt: new Date(snapshot.checkedAt + HOUR).toISOString(), cached,
      note: '审核状态按每文档至少 1 小时复查；发布记录不含版本号，不能单独证明当前修订已在买家页面显示。' };
  }

  const listingImages = {
    id: 'listing.images', group: 'Listing', label: '修改主图 / 附图', risk: '高', implemented: true, channel: 'spapi', capability: 'api', api: 'Listings Items 2021-08-01 + Product Type Definitions',
    requirements: 'Product Listing 权限；实时 PTD 和 Amazon 预校验通过。', limitation: '需要公开 HTTPS 图片 URL；仅核验卖家贡献，不声称买家页面已更新。',
    params: { sku: 'SKU', images: '对象：main_product_image_locator / other_product_image_locator_N → 公开 HTTPS 图片 URL' },
    async read(store, c) {
      const images = requestedImages(c);
      const r = await getListingImageRequirements(store, c);
      for (const key of Object.keys(images)) if (!r.supportedAttributes.includes(key)) throw new Error(`该卖家/站点/商品类型的实时 PTD 不支持 ${key}。`);
      return { marketplace: r.marketplace, entity: { sku: c.sku, asin: r.asin, productType: r.productType, supportedAttributes: r.supportedAttributes, attributes: r.attributes }, old: { productType: r.productType, images: Object.fromEntries(Object.keys(images).map((key) => [key, r.current[key] || []])), attributeInstances: Object.fromEntries(Object.keys(images).map((key) => [key, r.attributes[key] || []])) } };
    },
    check(c, r) {
      const images = requestedImages(c);
      for (const key of Object.keys(images)) if (!r.entity.supportedAttributes.includes(key)) throw new Error(`该卖家/站点/商品类型的实时 PTD 不支持 ${key}。`);
      if (Object.entries(images).every(([key, url]) => same(r.old.images[key], [url]))) throw new Error('图片 URL 与当前贡献一致，不需要修改。');
      return { newValue: images, warnings: ['Amazon 需能匿名访问图片 URL；本工具不会上传本机图片，也不验证图片版权或视觉合规。', 'ACCEPTED 和贡献回读一致均不等于买家详情页已换图。'] };
    },
    build(c, r, images) {
      const mpId = marketplace(r.marketplace).id;
      const patches = Object.entries(images).map(([key, url]) => {
        const otherMarkets = (r.entity.attributes[key] || []).filter((a) => a.marketplace_id && a.marketplace_id !== mpId);
        return { op: 'replace', path: `/attributes/${key}`, value: [...otherMarkets, { marketplace_id: mpId, media_location: url }] };
      });
      return { sku: c.sku, marketplace: r.marketplace, productType: r.entity.productType, patches };
    },
    async preview(store, req) {
      const response = await patch(store.alias, req.sku, req.marketplace, { ...req, preview: true });
      if (response?.status !== 'VALID') throw new Error(`图片预校验未通过：${response?.status || '无状态'} ${messages(response?.issues).join('；')}`);
      return { status: response.status, issues: response.issues || [] };
    },
    async send(store, req, { checkpoint } = {}) {
      // Validate again at execution: category requirements can change after proposal approval.
      try {
        const preview = await this.preview(store, req);
        if ((preview.issues || []).some((x) => x.severity === 'ERROR')) throw new Error(`图片预校验含 ERROR：${messages(preview.issues).join('；')}`);
      } catch (e) {
        const failed = { ok: false, status: 'FAILED', stage: 'IMAGE_PREVIEW_FAILED', error: e.message };
        await checkpoint?.(failed);
        return failed;
      }
      const pending = { ok: false, status: 'OUTCOME_UNKNOWN', stage: 'IMAGE_PATCH_SENDING' };
      await checkpoint?.(pending);
      const response = await patch(store.alias, req.sku, req.marketplace, req);
      const errors = (response?.issues || []).filter((x) => x.severity === 'ERROR');
      const ok = response?.status === 'ACCEPTED' && !errors.length;
      const result = { ok, status: ok ? 'IMAGES_ACCEPTED' : 'FAILED', stage: 'IMAGE_PATCH_RECEIVED', response,
        error: ok ? null : messages(errors).join('；') || `图片更新回执状态：${response?.status || '缺失'}` };
      await checkpoint?.(result);
      return result;
    },
    async readback(store, c, expected, sendResult = {}) {
      const m = marketFor(store, c.marketplace);
      const item = await listing(store.alias, c.sku, m.code);
      const actual = selectedImageValues(item, Object.keys(expected), m.id);
      const errors = (item?.issues || []).filter((x) => x.severity === 'ERROR' && (!x.attributeNames?.length || x.attributeNames.some((name) => name in expected)));
      const match = Object.entries(expected).every(([key, url]) => same(actual[key], [url])) && !errors.length;
      return { actual, match, status: match ? 'IMAGE_CONTRIBUTION_VERIFIED' : sendResult.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'AWAITING_READBACK', issues: errors,
        note: '只核验卖家图片贡献；Amazon 可延迟处理或选择其他贡献，买家页面展示仍需另行核实。' };
    },
  };

  const aplusContent = {
    id: 'aplus.content', group: '内容与促销', label: 'A+ 内容 / ASIN 关联 / 提交审核', risk: '高', implemented: true, channel: 'spapi', creates: (c) => c.action === 'create', creationIdentity: (c) => ({ action: 'create', name: c.contentDocument?.name }), capability: 'api', api: 'A+ Content 2020-11-01',
    requirements: 'Product Listing 权限；A+ 账户/品牌/ASIN 资格需实时校验。', limitation: '创建、编辑、关联和提交审核分开审批；图片需已有上传素材 ID；发布记录不证明当前版本已展示。',
    params: { action: 'create / update / associate / submit', contentReferenceKey: '更新/关联/提交时必填', contentDocument: '创建或更新时完整官方 A+ JSON；图片使用已上传 uploadDestinationId', asinSet: 'associate 的完整非空关联集合；create/update 可用于资格校验' },
    async read(store, c) {
      if (!ACTIONS.includes(c.action)) throw new Error(`action 必须是 ${ACTIONS.join(' / ')}。`);
      const m = marketFor(store, c.marketplace);
      if (c.action === 'create') {
        if (c.contentReferenceKey) throw new Error('create 不能携带 contentReferenceKey；编辑现有内容使用 update。');
        const doc = contentDocument(c.contentDocument);
        const all = await listAplusDocuments(store, { marketplace: m.code });
        const duplicates = all.documents.filter((x) => x.contentMetadata?.name === doc.name);
        if (duplicates.length) throw new Error(`已有同名 A+ 文档：${duplicates.map((x) => x.contentReferenceKey).join(', ')}。请核验并用 update；不重复创建。`);
        const validation = await validateAplusContent(store, { marketplace: m.code, contentDocument: doc, asinSet: c.asinSet });
        requireValidation(validation);
        return { marketplace: m.code, entity: { name: doc.name, duplicates, validation }, old: null };
      }
      const key = referenceKey(c.contentReferenceKey);
      const record = await document(store, m.code, key);
      const currentAsins = await relations(store, m.code, key);
      const doc = c.action === 'update' ? contentDocument(c.contentDocument) : record.contentDocument;
      const targetAsins = c.action === 'associate' ? asins(c.asinSet, true) : asins(c.asinSet) || currentAsins;
      if (c.action === 'submit' && c.asinSet !== undefined && !same(targetAsins, currentAsins)) throw new Error('submit 不修改关联；请先用 associate 关联完整 ASIN 集。');
      const validation = await validateAplusContent(store, { marketplace: m.code, contentDocument: doc, asinSet: targetAsins });
      requireValidation(validation, c.action === 'submit');
      return { marketplace: m.code, entity: { name: record.contentDocument.name, contentReferenceKey: key, validation },
        old: { contentDocument: record.contentDocument, asinSet: currentAsins, reviewStatus: record.contentMetadata.status, updateTime: record.contentMetadata.updateTime } };
    },
    check(c, r) {
      if (r.entity.duplicates?.length) throw new Error(`已有同名 A+ 文档：${r.entity.duplicates.map((x) => x.contentReferenceKey).join(', ')}。请核验并用 update；不重复创建。`);
      if (!r.entity.validation.valid) throw new Error(`A+ 官方校验未通过：${messages(r.entity.validation.errors).join('；')}`);
      const warnings = messages(r.entity.validation.warnings);
      const base = { action: c.action };
      if (c.action === 'create' || c.action === 'update') {
        base.contentDocument = contentDocument(c.contentDocument);
        if (c.action === 'update' && same(base.contentDocument, r.old.contentDocument)) throw new Error('A+ 新内容与现有文档一致。');
        warnings.push('本次仅保存内容，不关联 ASIN，也不提交审核；asinSet 仅用于资格校验。');
      }
      if (c.action !== 'create') base.contentReferenceKey = r.entity.contentReferenceKey;
      if (c.action === 'associate') {
        base.asinSet = asins(c.asinSet, true);
        base.contentDocument = r.old.contentDocument;
        if (same(base.asinSet, r.old.asinSet)) throw new Error('ASIN 关联集合未改变。');
        warnings.push(`已批准内容新增关联后可能自动展示。关联会替换全部原关联；移除：${r.old.asinSet.filter((a) => !base.asinSet.includes(a)).join(', ') || '无'}。移除 ASIN 可能使现有 A+ 停止展示。`);
      }
      if (c.action === 'submit') {
        if (['SUBMITTED', 'APPROVED'].includes(r.old.reviewStatus)) throw new Error(`文档状态为 ${r.old.reviewStatus}，不重复提交；请查询审核/发布记录，或先提交明确的内容更新。`);
        if (!r.old.asinSet.length) throw new Error('文档没有关联 ASIN；请先批准 associate 操作。');
        if (warnings.length) throw new Error(`提交前需处理 A+ 校验警告：${warnings.join('；')}`);
        base.contentDocument = r.old.contentDocument;
        base.asinSet = r.old.asinSet;
        warnings.push('本次提交审核；审核批准后 Amazon 可能自动发布至已关联 ASIN。200 回执不表示已批准或已发布。');
      }
      return { newValue: base, warnings };
    },
    build(c, r, value) {
      const key = value.contentReferenceKey;
      const suffix = c.action === 'associate' ? '/asins' : c.action === 'submit' ? '/approvalSubmissions' : '';
      return { method: 'POST', path: c.action === 'create' ? `${APLUS}/contentDocuments` : `${pathFor(key)}${suffix}`,
        marketplace: r.marketplace, query: { marketplaceId: marketplace(r.marketplace).id }, action: c.action,
        ...(key ? { contentReferenceKey: key } : {}), expected: value,
        ...(c.action === 'create' || c.action === 'update' ? { body: { contentDocument: value.contentDocument } } : c.action === 'associate' ? { body: { asinSet: value.asinSet } } : {}) };
    },
    async send(store, req, { checkpoint } = {}) {
      let state = { ok: false, status: 'OUTCOME_UNKNOWN', action: req.action, stage: `${req.action.toUpperCase()}_SENDING`, createdIds: [],
        ...(req.contentReferenceKey ? { contentReferenceKey: req.contentReferenceKey } : {}), attemptedAt: new Date(now()).toISOString() };
      await checkpoint?.(state);
      if (req.action === 'submit') statusCache.set(cacheKey(store, req.marketplace, req.contentReferenceKey), { notBefore: now() + HOUR, submissionStatus: 'OUTCOME_UNKNOWN' });
      // isWrite prevents transport retries after timeout/5xx; enclosing proposal also executes only once.
      const response = await api(store.alias, req.method, req.path, { query: req.query, body: req.body, isWrite: true });
      const key = response?.contentReferenceKey || req.contentReferenceKey;
      const errors = response?.errors || [];
      const warnings = response?.warnings || [];
      const missingKey = (req.action === 'create' || req.action === 'update') && !response?.contentReferenceKey;
      const missingResponse = !response || typeof response !== 'object' || Array.isArray(response);
      const ok = !errors.length && !warnings.length && !missingKey && !missingResponse;
      const status = { create: 'DRAFT_CREATED', update: 'CONTENT_UPDATED', associate: 'ASINS_ASSOCIATED', submit: 'SUBMITTED_FOR_REVIEW' }[req.action];
      state = { ...state, ok, status: missingKey || missingResponse ? 'OUTCOME_UNKNOWN' : errors.length || warnings.length ? 'PARTIALLY_SUCCEEDED' : status,
        stage: `${req.action.toUpperCase()}_RECEIVED`, response, warnings, contentReferenceKey: key || null,
        createdIds: req.action === 'create' && key ? [key] : [],
        error: ok ? null : missingKey || missingResponse ? '响应不完整或创建/更新缺少 contentReferenceKey；只核验，不重新发送。' : messages([...errors, ...warnings]).join('；') };
      if (req.action === 'submit' && ok) {
        state.submittedAt = new Date(now()).toISOString();
        state.nextReviewCheckAt = new Date(now() + HOUR).toISOString();
      }
      if (key) {
        invalidate(store, req.marketplace, key);
        if (req.action === 'submit') statusCache.set(cacheKey(store, req.marketplace, key), { notBefore: now() + HOUR, submissionStatus: state.status });
      }
      await checkpoint?.(state);
      return state;
    },
    async readback(store, c, expected, sendResult = {}) {
      const m = marketFor(store, c.marketplace);
      let key = sendResult.contentReferenceKey || sendResult.createdIds?.[0] || expected.contentReferenceKey;
      if (!key && expected.action === 'create') {
        const candidates = (await listAplusDocuments(store, { marketplace: m.code })).documents.filter((x) => x.contentMetadata?.name === expected.contentDocument.name);
        // A name match is only a candidate, never proof of ownership or of this request's success.
        return { actual: { candidates: candidates.map((x) => ({ contentReferenceKey: x.contentReferenceKey, metadata: x.contentMetadata })) }, match: false, status: 'OUTCOME_UNKNOWN',
          note: '创建回执未持久化文档 ID；同名查询只能提供人工核验线索，不能重建成功回执或重复创建。' };
      }
      key = referenceKey(key);
      if (expected.action === 'submit' && sendResult.nextReviewCheckAt && now() < Date.parse(sendResult.nextReviewCheckAt)) {
        return { actual: { contentReferenceKey: key, submissionAccepted: sendResult.ok, reviewStatus: 'NOT_YET_CHECKED', nextReviewCheckAt: sendResult.nextReviewCheckAt }, match: false, status: 'SUBMITTED_FOR_REVIEW',
          note: '已收到审核提交回执；依官方建议至少 1 小时后再查审核状态，此时不声称审核通过或已发布。' };
      }
      const cached = expected.action === 'submit' ? statusCache.get(cacheKey(store, m.code, key)) : null;
      if (cached?.notBefore && now() < cached.notBefore) return { actual: { contentReferenceKey: key, reviewStatus: 'NOT_YET_CHECKED', nextReviewCheckAt: new Date(cached.notBefore).toISOString() }, match: false, status: cached.submissionStatus, note: '审核请求结果以回执为准；至少 1 小时后只查询，不重发。' };
      const useCache = cached?.record && now() - cached.checkedAt < HOUR;
      const record = useCache ? cached.record : await document(store, m.code, key);
      const currentAsins = useCache ? cached.asinSet : await relations(store, m.code, key);
      const contentMatches = same(record.contentDocument, expected.contentDocument);
      const actual = { contentReferenceKey: key, contentDocument: record.contentDocument, asinSet: currentAsins, reviewStatus: record.contentMetadata.status, updateTime: record.contentMetadata.updateTime };
      if (expected.action === 'create' || expected.action === 'update') {
        return { actual, match: contentMatches, status: contentMatches ? expected.action === 'create' ? 'DRAFT_CREATED' : 'CONTENT_UPDATED' : 'AWAITING_READBACK', note: '已核验文档内容；创建/编辑不表示已提交审核或已在页面发布。' };
      }
      if (expected.action === 'associate') return { actual, match: contentMatches && same(currentAsins, expected.asinSet), status: contentMatches && same(currentAsins, expected.asinSet) ? 'ASINS_ASSOCIATED' : 'AWAITING_READBACK', note: '仅核验完整 ASIN 关联集合与内容；未声称审核或当前版本页面发布。' };
      const status = record.contentMetadata.status;
      const match = contentMatches && same(currentAsins, expected.asinSet) && ['SUBMITTED', 'APPROVED'].includes(status);
      if (!useCache) statusCache.set(cacheKey(store, m.code, key), { checkedAt: now(), record, asinSet: currentAsins });
      return { actual, match, status: status === 'REJECTED' ? 'REJECTED' : match ? status === 'APPROVED' ? 'APPROVED' : 'SUBMITTED_FOR_REVIEW' : sendResult.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'AWAITING_READBACK',
        note: '审核状态不等于当前修订的页面显示证据；可另查 publish records，实际买家页面需单独核实。' };
    },
  };
  return { ops: [listingImages, aplusContent], getListingImageRequirements, listAplusDocuments, validateAplusContent, getAplusStatus };
}

const defaults = createContentApi();
export const CONTENT_OPS = defaults.ops;
export const getListingImageRequirements = defaults.getListingImageRequirements;
export const listAplusDocuments = defaults.listAplusDocuments;
export const validateAplusContent = defaults.validateAplusContent;
export const getAplusStatus = defaults.getAplusStatus;
