// 把 xander_ads_report collect 下载的日维度广告报表，按对象汇总成 xander_review_ad_performance 能直接用的输入。
// 只做本地加总：不联网、不改账户。缺的指标保持 null，不当 0；口径（广告产品、归因窗口、销售范围）随行标明。
import fs from 'node:fs';
import path from 'node:path';
import { p } from './paths.js';
import { MARKETPLACES } from './regions.js';

const PRODUCT = { SPONSORED_PRODUCTS: 'SP', SPONSORED_BRANDS: 'SB', SPONSORED_DISPLAY: 'SD', SP: 'SP', SB: 'SB', SD: 'SD' };
// 对象标识由哪些字段组成（v1 字段名 / v3 字段名）；v1 目前只有活动、广告组维度的公开字段
const ENTITY_KEYS = {
  campaign: [['campaign.id', 'campaignId']],
  ad_group: [['campaign.id', 'campaignId'], ['adGroup.id', 'adGroupId']],
  target: [[null, 'campaignId'], [null, 'adGroupId'], [null, 'keywordId']],
  search_term: [[null, 'campaignId'], [null, 'adGroupId'], [null, 'keywordId'], [null, 'searchTerm']],
  placement: [[null, 'campaignId'], [null, 'placementClassification']],
  advertised_product: [[null, 'campaignId'], [null, 'adGroupId'], [null, 'advertisedAsin']],
};
const PRESET_HINT = {
  campaign: 'campaigns（v1）或 sp_placement 以外的活动维度', ad_group: 'ad_groups（v1）', target: 'sp_targeting',
  search_term: 'sp_search_terms', placement: 'sp_placement', advertised_product: 'sp_advertised_product',
};
const METRICS = {
  impressions: ['metric.impressions', 'impressions'], clicks: ['metric.clicks', 'clicks'], spend: ['metric.totalCost', 'cost'],
  orders: ['metric.purchases', 'purchases7d'], sales: ['metric.sales', 'sales7d'],
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500);
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

function checkWindow(w, label) {
  if (!w || !DATE.test(w.startDate || '') || !DATE.test(w.endDate || '')) throw new Error(`${label} 需要 startDate/endDate（YYYY-MM-DD）`);
  for (const d of [w.startDate, w.endDate]) if (new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) throw new Error(`${label} 日期无效：${d}`);
  if (w.startDate > w.endDate) throw new Error(`${label} 起止日期倒置`);
}

function todayIn(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = (t) => parts.find((x) => x.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function readReport(file) {
  const real = (f) => { try { return fs.realpathSync(f); } catch { return path.resolve(f); } };
  const dir = real(p('reports'));
  const full = real(String(file || ''));
  if (path.dirname(full) !== dir || !full.endsWith('.json') || full.endsWith('.meta.json')) {
    throw new Error(`只读取 xander_ads_report collect 保存在 ${dir} 里的 .json 报表文件。`);
  }
  if (!fs.existsSync(full)) throw new Error(`找不到报表文件：${full}`);
  const rows = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('报表文件不是行数组；请用 collect 返回的 file。');
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(`${full}.meta.json`, 'utf8')); } catch { /* 旧版本下载的报表没有元数据 */ }
  return { full, rows, meta };
}

export function adReportRows(input) {
  const { file, entityType, current, baseline, timezone, objective = 'sales', adProduct, campaignIds, limit = 50, basisOverride } = input || {};
  if (!ENTITY_KEYS[entityType]) throw new Error(`entityType 只能是 ${Object.keys(ENTITY_KEYS).join(' / ')}`);
  checkWindow(current, 'current');
  if (baseline) {
    checkWindow(baseline, 'baseline');
    if (baseline.endDate >= current.startDate) throw new Error('baseline 必须早于 current 且不重叠');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new Error('timezone 无效：用广告 profile 的时区，如 America/Los_Angeles'); }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit 须为 1–100 的整数');
  if (basisOverride && (typeof basisOverride.source !== 'string' || !basisOverride.source.trim())) throw new Error('basisOverride 必须写明 source（口径依据，如官方文档链接）');

  const { full, rows, meta } = readReport(file);
  const gaps = [];
  if (!rows.length) gaps.push('报表文件里没有任何行：可能确实没有投放数据，也可能是范围/站点不对；不要直接当成 0。');
  const sample = rows.find((r) => r && typeof r === 'object') || {};
  const api = meta?.api || (Object.keys(sample).some((k) => k.includes('.')) ? 'v1' : 'v3');
  const pick = (r, [v1, v3]) => (api === 'v1' ? (v1 ? r[v1] : undefined) : r[v3]);
  const dateKey = api === 'v1' ? 'date.value' : 'date';
  if (rows.length && rows.every((r) => !DATE.test(String(r?.[dateKey] ?? '')))) throw new Error('报表没有日维度（date）字段，无法按窗口汇总；请用带日期的预设重新申请。');
  const keys = ENTITY_KEYS[entityType];
  if (rows.length && keys.some((k) => rows.every((r) => pick(r, k) === undefined))) {
    throw new Error(`这份报表（${api}）没有 ${entityType} 维度所需字段；请用 preset=${PRESET_HINT[entityType]} 重新申请。`);
  }

  const currencies = new Set();
  const groups = new Map();
  const seen = { min: null, max: null };
  let skipped = 0;
  for (const r of rows) {
    const date = String(r?.[dateKey] ?? '');
    if (!DATE.test(date)) { skipped++; continue; }
    if (!seen.min || date < seen.min) seen.min = date;
    if (!seen.max || date > seen.max) seen.max = date;
    const win = date >= current.startDate && date <= current.endDate ? 'current' : baseline && date >= baseline.startDate && date <= baseline.endDate ? 'baseline' : null;
    if (!win) continue;
    const product = api === 'v1' ? PRODUCT[r['adProduct.value']] : 'SP';
    if (!product) { skipped++; continue; }
    if (adProduct && product !== adProduct) continue;
    const parts = keys.map((k) => clean(pick(r, k)));
    if (parts.some((x) => !x)) { skipped++; continue; }
    if (campaignIds?.length && !campaignIds.map(String).includes(parts[0])) continue;
    const cur = api === 'v1' ? r['budgetCurrency.value'] : null;
    if (cur) currencies.add(cur);
    const id = parts.join('|');
    const gk = `${product}:${id}`;
    if (!groups.has(gk)) groups.set(gk, { id, product, name: null, current: null, baseline: null });
    const g = groups.get(gk);
    g.name ||= clean(entityType === 'search_term' ? r.searchTerm : entityType === 'target' ? [r.targeting || r.keyword, r.matchType].filter(Boolean).join(' ')
      : entityType === 'placement' ? r.placementClassification : entityType === 'advertised_product' ? r.advertisedAsin
        : api === 'v1' ? r[entityType === 'ad_group' ? 'adGroup.name' : 'campaign.name'] : r.campaignName) || null;
    g[win] ||= { rows: 0, metrics: Object.fromEntries(Object.keys(METRICS).map((m) => [m, 0])) };
    g[win].rows++;
    for (const [m, names] of Object.entries(METRICS)) {
      const v = num(pick(r, names));
      g[win].metrics[m] = Number.isFinite(v) && v >= 0 && g[win].metrics[m] !== null ? g[win].metrics[m] + v : null;
    }
  }
  if (currencies.size > 1) throw new Error(`所选行包含多个币种（${[...currencies].join('、')}），不能合在一起复盘；请按站点分开。`);
  const marketplace = meta?.marketplace || input.marketplace || null;
  const currency = [...currencies][0] || input.currency || MARKETPLACES[marketplace]?.currency;
  if (!/^[A-Z]{3}$/.test(currency || '')) throw new Error('无法确定币种：报表行没有币种字段，请传 currency（如 USD）。');
  if (!marketplace) gaps.push('报表元数据里没有站点，scope.marketplace 用了调用方提供的值或为空，请核对。');
  if (skipped) gaps.push(`${skipped} 行缺日期、广告产品或对象标识，未计入。`);

  const today = todayIn(timezone);
  const matureDays = api === 'v3' ? 8 : 14;
  const coverage = (w) => (!meta?.startDate || !meta?.endDate ? 'unknown' : w.startDate >= meta.startDate && w.endDate <= meta.endDate ? 'complete' : 'partial');
  if (!meta?.startDate) gaps.push('这份报表没有申请窗口元数据（旧版本下载），覆盖状态标为 unknown；用 fresh=true 重新申请可补齐。');
  const basis = (product) => ({
    adProduct: product,
    chargeType: product === 'SP' ? 'CPC' : 'UNKNOWN',
    interaction: product === 'SP' ? 'CLICK' : 'UNKNOWN',
    salesScope: basisOverride?.salesScope || (api === 'v3' ? 'COMBINED' : 'UNKNOWN'),
    attributionWindow: basisOverride?.attributionWindow || (api === 'v3' ? '7d click' : 'unknown'),
  });
  if (api === 'v1' && !basisOverride) gaps.push('v1 报表的归因窗口和销售范围官方未在本插件中核实，标为 unknown；复盘只给原始指标，不做 ACoS 变化分解。若已按官方文档确认，可用 basisOverride 写明并注明 source。');
  const source = `Ads ${api} ${meta?.reportTypeId || meta?.preset || 'report'} ${meta?.reportId || path.basename(full)}`;
  const snapshot = (w, agg, product) => {
    const m = { ...agg.metrics };
    for (const k of ['impressions', 'clicks']) if (m[k] !== null && !Number.isSafeInteger(m[k])) m[k] = null;
    return { source, startDate: w.startDate, endDate: w.endDate, coverage: coverage(w), attributionMature: w.endDate <= addDays(today, -matureDays), basis: basis(product), metrics: m };
  };

  const all = [...groups.values()];
  const onlyBaseline = all.filter((g) => !g.current).length;
  const ranked = all.filter((g) => g.current).sort((a, b) => (b.current.metrics.spend ?? -1) - (a.current.metrics.spend ?? -1));
  const kept = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  const reviewRows = kept.map((g) => ({
    id: g.id, ...(g.name ? { name: g.name } : {}), objective,
    current: snapshot(current, g.current, g.product),
    ...(baseline && g.baseline ? { baseline: snapshot(baseline, g.baseline, g.product) } : {}),
  }));
  if (!reviewRows.length) gaps.push('当前窗口没有匹配的对象行；没有行不等于这些对象花费为 0，先核对窗口、站点和筛选条件。');
  if (current.endDate > addDays(today, -matureDays)) gaps.push(`当前窗口结束于 ${current.endDate}，距今不足 ${matureDays} 天，归因可能还在回填，已标 attributionMature=false。`);
  if (meta?.endDate && seen.max && seen.max < meta.endDate) gaps.push(`报表申请到 ${meta.endDate}，但最后一行数据是 ${seen.max}；之后的日期可能没有投放，也可能尚未生成。`);

  return {
    reviewInput: reviewRows.length ? {
      scope: { store: meta?.store || input.store || 'unknown', marketplace: marketplace || 'unknown', currency, timezone, entityType },
      evidenceKind: 'provided', rows: reviewRows,
    } : null,
    summary: {
      file: full, api, reportId: meta?.reportId ?? null, reportWindow: meta?.startDate ? { startDate: meta.startDate, endDate: meta.endDate } : null,
      datesInFile: seen.min ? { first: seen.min, last: seen.max } : null, rowsRead: rows.length, objects: ranked.length,
      included: kept.length, truncated: rest.length ? { objects: rest.length, spend: rest.every((g) => g.current.metrics.spend !== null) ? Math.round(rest.reduce((s, g) => s + g.current.metrics.spend, 0) * 100) / 100 : null } : null,
      onlyInBaseline: onlyBaseline,
      basisNote: api === 'v3'
        ? 'v3 SP 报表：订单/销售额为 7 天点击归因的 purchases7d/sales7d，含同品牌其他商品（salesScope=COMBINED）；不能与 v1 指标相加或对比。'
        : 'v1 报表：metric.purchases/sales 口径以官方说明为准；SB/SD 的计费与互动方式未知时标 UNKNOWN。',
    },
    gaps,
    nextStep: reviewRows.length
      ? '把 reviewInput 原样传给 xander_review_ad_performance。需要利润/库存判断时，先在对应行补 economics（该行归因销售对应的广告前贡献总额）和 inventory，再调用；不要编造。'
      : '先解决 gaps 里的问题再复盘。',
  };
}
