import { getListing, patchListing, spapi } from './spapi.js';
import { marketplace as mp } from './regions.js';
import { canonical } from './jsonfile.js';
import { officialSchema } from './product-type-schema.js';

export const LISTING_ATTRS = {
  item_name: '标题',
  title_differentiation: 'Item Highlights（亮点）',
  bullet_point: '五点描述',
  product_description: '产品描述',
  generic_keyword: '后台搜索词',
};

function selectedAttribute(item, attribute, market, explicitLanguage) {
  const instances = item?.attributes?.[attribute] ?? [];
  if (!Array.isArray(instances) || instances.some((a) => !a || typeof a !== 'object' || Array.isArray(a) || typeof a.value !== 'string')) {
    throw new Error(`${attribute} 当前属性结构不完整，不能安全替换。`);
  }
  if (explicitLanguage !== undefined && (typeof explicitLanguage !== 'string' || !explicitLanguage.trim())) throw new Error('languageTag 必须是非空语言标签。');
  const local = instances.filter((a) => !a.marketplace_id || a.marketplace_id === market.id);
  const languages = [...new Set(local.map((a) => a.language_tag).filter(Boolean))];
  let languageTag = explicitLanguage?.trim();
  if (!languageTag) {
    if (languages.includes(market.lang) || local.some((a) => !a.language_tag) || !languages.length) languageTag = market.lang;
    else if (languages.length === 1) languageTag = languages[0];
    else throw new Error(`${attribute} 在该站点有多种语言，请指定 languageTag，避免覆盖其他语言。`);
  }
  if (!languageTag) throw new Error(`${market.code} 站没有默认语言标签，请在提案里指定 languageTag。`);
  const selectedIndices = instances.flatMap((a, i) =>
    (!a.marketplace_id || a.marketplace_id === market.id)
      && (a.language_tag === languageTag || (!a.language_tag && languageTag === market.lang)) ? [i] : []);
  return { instances, selectedIndices, languageTag, values: selectedIndices.map((i) => instances[i].value) };
}

const issueMessages = (issues = []) => issues.map((x) => `${x?.code || ''} ${x?.message || ''}`.trim()).join('；');

export function createListingAttributeOperation({ listing = getListing, patch = patchListing, api = spapi, fetchSchema = officialSchema } = {}) {
  async function readAttribute(store, c, requireSchema) {
    if (typeof c.sku !== 'string' || !c.sku.trim()) throw new Error('缺少 sku');
    if (!Object.hasOwn(LISTING_ATTRS, c.attribute)) throw new Error(`只支持修改：${Object.entries(LISTING_ATTRS).map(([k, v]) => `${k}(${v})`).join('、')}`);
    const market = mp(c.marketplace || store.defaultMarketplace);
    const item = await listing(store.alias, c.sku, market.code);
    const summary = item?.summaries?.find((s) => s.marketplaceId === market.id) || item?.summaries?.find((s) => !s.marketplaceId);
    if (!summary?.productType) throw new Error('读不到这个 SKU 在目标站点的 productType，可能 SKU 或站点不对。');
    const selected = selectedAttribute(item, c.attribute, market, c.languageTag);
    let attributeSchema;
    if (requireSchema && c.attribute === 'title_differentiation') {
      const definition = await api(store.alias, 'GET', `/definitions/2020-09-01/productTypes/${encodeURIComponent(summary.productType)}`, {
        query: { marketplaceIds: market.id, sellerId: store.sellerId, requirements: 'LISTING', requirementsEnforced: 'ENFORCED', productTypeVersion: 'LATEST' },
      });
      const schema = await fetchSchema(definition);
      if (!schema?.properties || !Object.hasOwn(schema.properties, c.attribute) || !schema.properties[c.attribute]) throw new Error(`该卖家/站点/商品类型的实时 PTD 未确认支持 ${c.attribute}，不能生成提案。`);
      attributeSchema = schema.properties[c.attribute];
      // Presence is a capability check, not full JSON Schema validation. Amazon's
      // VALIDATION_PREVIEW evaluates lengths, cardinality and conditional rules.
    }
    return {
      marketplace: market.code,
      entity: { sku: c.sku, asin: summary.asin, productType: summary.productType, languageTag: selected.languageTag,
        attributeInstances: structuredClone(selected.instances), selectedIndices: selected.selectedIndices, ...(attributeSchema ? { attributeSchema } : {}) },
      old: selected.values,
      precondition: { productType: summary.productType, languageTag: selected.languageTag, attributeInstances: structuredClone(selected.instances) },
      issues: item?.issues || [],
    };
  }

  return {
    id: 'listing.attribute', group: 'Listing', label: '修改标题 / Item Highlights（亮点）/ 五点 / 描述 / 后台词', risk: '高', implemented: true, channel: 'spapi',
    params: { sku: 'SKU', attribute: Object.keys(LISTING_ATTRS).join(' / '), value: '新内容（字符串或数组；不会按分号拆分亮点）', languageTag: '可选；优先目标站点默认语言的原值，否则沿用唯一现有语言；多语言不明确时需指定' },
    read(store, c) { return readAttribute(store, c, true); },
    check(c, r) {
      const input = Array.isArray(c.value) ? c.value : [c.value];
      if (!input.length || input.some((v) => typeof v !== 'string' || !v.trim())) throw new Error('内容不能为空。');
      const vals = input.map((v) => v.trim());
      if (c.attribute === 'item_name' && vals.length !== 1) throw new Error('标题只能有一条。');
      if (c.attribute === 'bullet_point' && vals.length > 10) throw new Error('五点最多 10 条。');
      const schema = r.entity.attributeSchema;
      if (schema) {
        const replacementCount = r.entity.attributeInstances.length - r.entity.selectedIndices.length + vals.length;
        if (Number.isInteger(schema.minItems) && replacementCount < schema.minItems) throw new Error(`实时 PTD 要求 ${c.attribute} 完整属性数组至少 ${schema.minItems} 条。`);
        if (Number.isInteger(schema.maxItems) && replacementCount > schema.maxItems) throw new Error(`实时 PTD 限制 ${c.attribute} 完整属性数组最多 ${schema.maxItems} 条。`);
        const valueSchema = schema.items?.properties?.value;
        for (const v of vals) {
          const length = [...v].length;
          if (Number.isInteger(valueSchema?.minLength) && length < valueSchema.minLength) throw new Error(`实时 PTD 要求 ${c.attribute} 每条至少 ${valueSchema.minLength} 个字符。`);
          if (Number.isInteger(valueSchema?.maxLength) && length > valueSchema.maxLength) throw new Error(`实时 PTD 限制 ${c.attribute} 每条最多 ${valueSchema.maxLength} 个字符。`);
          if (Array.isArray(valueSchema?.enum) && !valueSchema.enum.includes(v)) throw new Error(`内容不在实时 PTD 的 ${c.attribute} 可用值范围内。`);
        }
      }
      if (canonical(vals) === canonical(r.old)) throw new Error('新内容和当前内容一样。');
      return { newValue: vals, warnings: [] };
    },
    build(c, r, vals) {
      const marketplaceId = mp(r.marketplace).id;
      const selected = new Set(r.entity.selectedIndices);
      const value = [];
      let cursor = 0;
      for (let i = 0; i < r.entity.attributeInstances.length; i++) {
        const original = r.entity.attributeInstances[i];
        if (!selected.has(i)) value.push(structuredClone(original));
        else if (cursor < vals.length) value.push({ ...structuredClone(original), value: vals[cursor++] });
      }
      while (cursor < vals.length) value.push({ value: vals[cursor++], language_tag: r.entity.languageTag, marketplace_id: marketplaceId });
      return { sku: c.sku, marketplace: r.marketplace, productType: r.entity.productType, languageTag: r.entity.languageTag,
        patches: [{ op: 'replace', path: `/attributes/${c.attribute}`, value }] };
    },
    async preview(store, req) {
      const response = await patch(store.alias, req.sku, req.marketplace, { productType: req.productType, patches: req.patches, preview: true });
      const issues = response?.issues === undefined ? [] : response.issues;
      if (response?.status !== 'VALID' || !Array.isArray(issues) || issues.some((x) => !x || x.severity === 'ERROR')) {
        throw new Error(`Listing 预校验未通过：${response?.status || '无状态'} ${issueMessages(Array.isArray(response?.issues) ? response.issues : [])}`);
      }
      return { status: response.status, issues };
    },
    async send(store, req) {
      // Revalidate approved content when executing. A failed preview is a known
      // non-submission, never an uncertain write or permission to send anyway.
      try { await this.preview(store, req); }
      catch (e) { return { ok: false, status: 'FAILED', error: e.message, stage: 'LISTING_PREVIEW_FAILED' }; }
      const response = await patch(store.alias, req.sku, req.marketplace, { productType: req.productType, patches: req.patches });
      const errors = (response?.issues || []).filter((i) => i.severity === 'ERROR');
      const ok = response?.status === 'ACCEPTED' && !errors.length;
      return { ok, error: ok ? null : issueMessages(errors) || `状态：${response?.status || '缺失'}`, response, languageTag: req.languageTag };
    },
    async readback(store, c, expected, sendResult = {}) {
      const r = await readAttribute(store, { ...c, languageTag: sendResult.languageTag || c.languageTag }, false);
      const errors = r.issues.filter((i) => i.severity === 'ERROR' && (!i.attributeNames?.length || i.attributeNames.includes(c.attribute)));
      return { actual: r.old, match: canonical(r.old) === canonical(expected) && !errors.length, issues: errors,
        note: errors.length ? `目标属性回读含 ERROR：${issueMessages(errors)}` : '仅核验卖家接口贡献；Listing 可能延迟生效，买家页面展示仍需另行核实。不一致时稍后用 xander_verify_change 再查。' };
    },
  };
}
