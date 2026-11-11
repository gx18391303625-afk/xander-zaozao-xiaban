// 出价预检：改竞价策略 / 广告位加价 / 关键词竞价前，估算“每次点击最高有效出价”的前后变化。
// 只产生提醒，不阻止提案，也不参与提案哈希。
import { ads } from './ads.js';

const SP = 'SPONSORED_PRODUCTS';
const PLACEMENTS = ['TOP_OF_SEARCH', 'REST_OF_SEARCH', 'PRODUCT_PAGE'];
const PLACEMENT_LABEL = { TOP_OF_SEARCH: '搜索顶部', REST_OF_SEARCH: '搜索其余位置', PRODUCT_PAGE: '商品页' };
const STRATEGY_LABEL = { MANUAL: '固定竞价', SALES_DOWN_ONLY: '只降低', SALES_UP_AND_DOWN: '提高和降低' };
const SYMBOLS = { USD: '$', GBP: '£', EUR: '€', JPY: '¥', CAD: 'CA$', AUD: 'A$', MXN: 'MX$' };
const DROP_WARN_RATIO = 0.7;
const MAX_TARGET_PAGES = 10;
const money = (v) => Math.round(v * 100 + 1e-9) / 100;

// 亚马逊文档：动态提高最多 +100%（搜索顶部）、+50%（其他广告位）
export const dynamicFactor = (strategy, placement) => strategy === 'SALES_UP_AND_DOWN' ? (placement === 'TOP_OF_SEARCH' ? 2 : 1.5) : 1;

export function maxEffectiveBid(bases, strategy, adjustments, placement) {
  const pct = Number(adjustments?.[placement]) || 0;
  const peak = Math.max(...bases);
  return peak * (1 + pct / 100) * dynamicFactor(strategy, placement);
}

const pctMap = (settings) => Object.fromEntries((settings?.bidAdjustments?.placementBidAdjustments || []).map((x) => [x.placement, x.percentage]));
const settingsOf = (campaign) => {
  const b = campaign?.optimizations?.bidSettings || {};
  return { bidStrategy: b.bidStrategy || null, bidAdjustments: { placementBidAdjustments: b.bidAdjustments?.placementBidAdjustments || [] } };
};
const symbol = (code) => (code ? SYMBOLS[code] || `${code} ` : '$');

async function queryAllTargets(store, profileId, filters) {
  const targets = []; const tokens = new Set(); let nextToken; let complete = true;
  for (let page = 0; ; page++) {
    if (page >= MAX_TARGET_PAGES) { complete = false; break; }
    const resp = await ads(store.alias, 'POST', '/adsApi/v1/query/targets', {
      profileId, body: { adProductFilter: { include: [SP] }, ...filters, maxResults: 1000, ...(nextToken ? { nextToken } : {}) },
    });
    if (!Array.isArray(resp?.targets)) throw new Error('读取投放失败');
    targets.push(...resp.targets); nextToken = resp.nextToken;
    if (!nextToken) break;
    if (tokens.has(nextToken)) { complete = false; break; }
    tokens.add(nextToken);
  }
  return { targets, complete };
}

function warnCampaign({ name, current, bidChanges, before, after, targets, observed }) {
  const warnings = [];
  if (before.strategy === 'SALES_UP_AND_DOWN' && after.strategy !== 'SALES_UP_AND_DOWN') {
    warnings.push(`${name}：竞价策略从“${STRATEGY_LABEL[before.strategy]}”改为“${STRATEGY_LABEL[after.strategy] || after.strategy}”，动态加价（搜索顶部最高 +100%，其他位置最高 +50%）将不再生效，实际能出的最高价会低于现在。`);
  }
  for (const placement of PLACEMENTS) {
    const bidsBefore = targets.map((t) => t.before); const bidsAfter = targets.map((t) => t.after);
    if (!bidsBefore.length) continue;
    const b = money(maxEffectiveBid(bidsBefore, before.strategy, before.pct, placement));
    const a = money(maxEffectiveBid(bidsAfter, after.strategy, after.pct, placement));
    const sym = symbol(current.currency);
    const cpc = Number(observed?.[placement]);
    const label = `${name} · ${PLACEMENT_LABEL[placement]}`;
    if (Number.isFinite(cpc) && cpc > 0 && a < cpc) {
      warnings.push(`${label}：调整后每次点击最高出价 ${sym}${a.toFixed(2)}（调整前 ${sym}${b.toFixed(2)}），低于近期实际 CPC ${sym}${cpc.toFixed(2)}，该位置大概率拿不到曝光。`);
    } else if (b > 0 && a < b * DROP_WARN_RATIO) {
      warnings.push(`${label}：每次点击最高出价 ${sym}${b.toFixed(2)} → ${sym}${a.toFixed(2)}（${Math.round((a / b - 1) * 100)}%），如果低于这个位置的实际 CPC，曝光会明显下降。`);
    }
  }
  return warnings;
}

// items：prepareChange 已通过检查的提案项。返回 Map<提案项, 提醒[]>
export async function bidPreflight(store, items) {
  const relevant = items.filter((it) => (it.op === 'ads.sp.placement' && it.change?.campaignId) || (it.op === 'ads.sp.target.bid' && it.change?.targetId));
  const result = new Map();
  if (!relevant.length) return result;
  const add = (it, msgs) => { if (msgs.length) result.set(it, [...(result.get(it) || []), ...msgs]); };
  const byProfile = new Map();
  for (const it of relevant) {
    const key = String(it.request?.profileId ?? '');
    byProfile.set(key, [...(byProfile.get(key) || []), it]);
  }
  for (const [profileId, group] of byProfile) {
    try {
      const bidItems = group.filter((it) => it.op === 'ads.sp.target.bid');
      const placementItems = new Map(group.filter((it) => it.op === 'ads.sp.placement').map((it) => [String(it.change.campaignId), it]));
      const touched = new Map();
      if (bidItems.length) {
        const { targets } = await queryAllTargets(store, profileId, { targetIdFilter: { include: bidItems.map((it) => String(it.change.targetId)) } });
        for (const it of bidItems) {
          const t = targets.find((x) => String(x.targetId) === String(it.change.targetId));
          if (t && !t.negative && t.campaignId !== undefined) touched.set(String(it.change.targetId), { item: it, campaignId: String(t.campaignId) });
        }
      }
      const campaignIds = [...new Set([...placementItems.keys(), ...[...touched.values()].map((x) => x.campaignId)])];
      if (!campaignIds.length) continue;
      const resp = await ads(store.alias, 'POST', '/adsApi/v1/query/campaigns', {
        profileId, body: { adProductFilter: { include: [SP] }, campaignIdFilter: { include: campaignIds }, maxResults: 1000 },
      });
      const campaigns = new Map((resp?.campaigns || []).map((c) => [String(c.campaignId), c]));
      for (const campaignId of campaignIds) {
        const campaign = campaigns.get(campaignId);
        const pItem = placementItems.get(campaignId);
        const own = [pItem, ...[...touched.values()].filter((x) => x.campaignId === campaignId).map((x) => x.item)].filter(Boolean);
        try {
          const currentSettings = settingsOf(campaign);
          const oldSettings = pItem?.old || currentSettings; const newSettings = pItem?.new || currentSettings;
          const before = { strategy: oldSettings.bidStrategy, pct: pctMap(oldSettings) };
          const after = { strategy: newSettings.bidStrategy, pct: pctMap(newSettings) };
          const { targets, complete } = await queryAllTargets(store, profileId, { campaignIdFilter: { include: [campaignId] }, negativeFilter: { include: [false] } });
          const live = targets.filter((t) => t.state === 'ENABLED' && !t.negative && Number.isFinite(Number(t.bid?.bid)));
          const considered = [];
          for (const t of live) {
            const change = touched.get(String(t.targetId));
            if (!pItem && !change) continue;
            considered.push({ before: change ? Number(change.item.old) : Number(t.bid.bid), after: change ? Number(change.item.new) : Number(t.bid.bid) });
          }
          const observed = Object.assign({}, ...own.map((it) => it.change?.observedCpc).filter((o) => o && typeof o === 'object' && !Array.isArray(o)));
          const msgs = warnCampaign({ name: campaign?.name || `活动 ${campaignId}`, current: { currency: live.find((t) => t.bid?.currencyCode)?.bid.currencyCode }, before, after, targets: considered, observed });
          if (!complete) msgs.push(`活动 ${campaignId} 的投放太多，出价预检只覆盖了读取到的部分。`);
          add(own[0], msgs);
        } catch (e) {
          add(own[0], [`出价预检没能完成（${e.message}），请自行核对调整后的最高出价。`]);
        }
      }
    } catch (e) {
      add(group[0], [`出价预检没能完成（${e.message}），请自行核对调整后的最高出价。`]);
    }
  }
  return result;
}
