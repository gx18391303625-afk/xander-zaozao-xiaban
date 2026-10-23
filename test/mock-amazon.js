// 测试用的“假亚马逊”：模拟 LWA、卖家接口、广告 v1 统一接口、v1/v3 报表的一小部分。
// 请求/返回结构按官方 OpenAPI（amzn/ads-advanced-tools-docs 与 selling-partner-api-models）编写。
import http from 'node:http';
import zlib from 'node:zlib';

const money = (v) => [{ budgetType: 'MONETARY', recurrenceTimePeriod: 'DAILY', budgetValue: { monetaryBudgetValue: { monetaryBudget: { value: v, currencyCode: 'USD' } } } }];

export function startMock() {
  const state = {
    targets: {
      '111': { targetId: '111', adGroupId: 'G1', campaignId: 'C1', adProduct: 'SPONSORED_PRODUCTS', negative: false, targetType: 'KEYWORD', state: 'ENABLED', bid: { bid: 1.0, currencyCode: 'USD' }, targetDetails: { keywordTarget: { keyword: 'dog bowl', matchType: 'EXACT' } } },
    },
    campaigns: { 'C1': { campaignId: 'C1', adProduct: 'SPONSORED_PRODUCTS', name: 'Bowl - Exact', state: 'ENABLED', budgets: money(20) } },
    adGroups: { 'G1': { adGroupId: 'G1', campaignId: 'C1', adProduct: 'SPONSORED_PRODUCTS', name: 'Exact', state: 'ENABLED', bid: { defaultBid: 0.8, currencyCode: 'USD' } } },
    ads: {},
    listing: { sku: 'BOWL-BLUE', productType: 'PET_SUPPLIES', title: 'Old Title', price: 19.99 },
    reports: {},
    calls: [],
    mode: {}, // 故障注入：{ targetUpdate: '503-applied' | '503-not-applied' }
  };
  let seq = 1000;

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const ch of req) raw += ch;
    const url = new URL(req.url, 'http://x');
    const body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : raw;
    state.calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: req.headers });
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const base = `http://127.0.0.1:${server.address().port}`;

    // ---- LWA ----
    if (url.pathname === '/auth/o2/token') {
      const p = new URLSearchParams(raw);
      if (p.get('refresh_token') === 'BAD') return json(400, { error: 'invalid_grant' });
      if (p.get('grant_type') === 'authorization_code') return json(200, { access_token: 'AT', refresh_token: 'Atzr|ADS', expires_in: 3600 });
      return json(200, { access_token: 'AT', expires_in: 3600 });
    }
    // ---- SP-API ----
    if (url.pathname === '/sellers/v1/marketplaceParticipations') {
      return json(200, { payload: [{ marketplace: { id: 'ATVPDKIKX0DER', countryCode: 'US' }, participation: { isParticipating: true } }] });
    }
    if (url.pathname === '/reports/2021-06-30/reports/SPR1') return json(200, { reportId: 'SPR1', reportType: 'GET_FLAT_FILE_OPEN_LISTINGS_DATA', processingStatus: 'DONE', reportDocumentId: 'DOC1' });
    if (url.pathname === '/reports/2021-06-30/documents/DOC1') return json(200, { reportDocumentId: 'DOC1', url: `${base}/spdl/DOC1`, compressionAlgorithm: 'GZIP' });
    if (url.pathname === '/spdl/DOC1') {
      const lines = ['sku\tasin\tprice\tquantity'];
      for (let i = 0; i < 50000; i++) lines.push(`SKU-${i}\tB0${String(i).padStart(8, '0')}\t19.99\t${i % 30}`);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(zlib.gzipSync(Buffer.from(lines.join('\n') + '\n')));
    }
    if (url.pathname === '/orders/2026-01-01/orders') return json(200, { orders: [{ orderId: '111-1' }] });
    const lm = url.pathname.match(/^\/listings\/2021-08-01\/items\/([^/]+)\/([^/]+)$/);
    if (lm) {
      const L = state.listing;
      if (decodeURIComponent(lm[2]) !== L.sku) return json(404, { errors: [{ code: 'NOT_FOUND' }] });
      if (req.method === 'GET') {
        return json(200, {
          sku: L.sku,
          summaries: [{ marketplaceId: 'ATVPDKIKX0DER', asin: 'B0TEST0001', productType: L.productType }],
          attributes: {
            item_name: [{ value: L.title, language_tag: 'en_US', marketplace_id: 'ATVPDKIKX0DER' }],
            purchasable_offer: [{ marketplace_id: 'ATVPDKIKX0DER', currency: 'USD', our_price: [{ schedule: [{ value_with_tax: L.price }] }] }],
          },
          fulfillmentAvailability: [{ fulfillmentChannelCode: 'AMAZON_NA' }],
          issues: [],
        });
      }
      if (req.method === 'PATCH') {
        if (url.searchParams.get('mode') === 'VALIDATION_PREVIEW') return json(200, { sku: L.sku, status: 'VALID', issues: [] });
        for (const pt of body.patches) {
          if (pt.path === '/attributes/item_name') L.title = pt.value[0].value;
          if (pt.path === '/attributes/purchasable_offer') L.price = pt.value[0].our_price[0].schedule[0].value_with_tax;
        }
        return json(200, { sku: L.sku, status: 'ACCEPTED', submissionId: 'sub-1', issues: [] });
      }
    }
    // ---- Ads：profiles（旧接口，仍是官方获取 profile 的方式） ----
    if (url.pathname === '/v2/profiles') {
      return json(200, [{ profileId: 999, countryCode: 'US', currencyCode: 'USD', accountInfo: { type: 'seller', marketplaceStringId: 'ATVPDKIKX0DER', name: 'Test' } }]);
    }
    // ---- Ads v1 统一接口 ----
    if (url.pathname.startsWith('/adsApi/v1/')) {
      if (!req.headers['amazon-ads-clientid']) return json(400, { message: 'missing Amazon-Ads-ClientId' });
      if (req.method !== 'POST') return json(405, { message: 'v1 only accepts POST' });
      const [, , , action, resource] = url.pathname.split('/');
      if (resource === 'advertiserAccounts' && action === 'query') {
        return json(200, { advertiserAccounts: [{ advertiserAccountId: 'amzn1.ads-account.g.TEST', alternateIds: [{ countryCode: 'US', entityId: 'ENT1', profileId: '999' }, { countryCode: 'UK', entityId: 'ENT2', profileId: '998' }], displayName: 'Test', isGlobalAccount: true }] });
      }
      if (resource === 'reports') {
        if (action === 'create') {
          const id = `rep-${++seq}`;
          state.reports[id] = { reportId: id, status: 'PENDING', query: body.reports[0].query, polls: 0 };
          return json(207, { error: null, success: [{ index: 0, report: { ...state.reports[id] } }] });
        }
        if (action === 'retrieve') {
          const r = state.reports[body.reportIds[0]];
          if (!r) return json(207, { error: [{ index: 0, errors: [{ code: 'NOT_FOUND', message: 'no report' }] }], success: [] });
          r.polls++;
          if (r.polls >= 2) { r.status = 'COMPLETED'; r.completedReportParts = [{ partNumber: 1, url: `${base}/dl/${r.reportId}.json.gz` }]; }
          return json(207, { error: null, success: [{ index: 0, report: { ...r } }] });
        }
      }
      const coll = { campaigns: state.campaigns, adGroups: state.adGroups, targets: state.targets, ads: state.ads }[resource];
      if (!coll) return json(404, { message: `mock: no v1 resource ${resource}` });
      const singular = { campaigns: 'campaign', adGroups: 'adGroup', targets: 'target', ads: 'ad' }[resource];
      const idKey = `${singular}Id`;
      if (action === 'query') {
        if (!body?.adProductFilter?.include?.length) return json(400, { message: 'adProductFilter required' });
        const f = (k, v) => !body[k] || body[k].include.map(String).includes(String(v));
        const items = Object.values(coll).filter((o) => body.adProductFilter.include.includes(o.adProduct)
          && f(`${idKey}Filter`, o[idKey]) && f('adGroupIdFilter', o.adGroupId) && f('campaignIdFilter', o.campaignId)
          && f('targetTypeFilter', o.targetType) && (!body.negativeFilter || body.negativeFilter.include.includes(o.negative)));
        return json(200, { [resource]: items });
      }
      if (action === 'update') {
        const it = body[resource][0];
        const mode = resource === 'targets' ? state.mode.targetUpdate : null;
        const obj = coll[it[idKey]];
        if (!obj) return json(207, { success: [], error: [{ index: 0, errors: [{ code: 'NOT_FOUND', message: 'Existing Object not found' }] }] });
        if (mode !== '503-not-applied') {
          if (it.state) obj.state = it.state;
          if (it.bid?.bid !== undefined) obj.bid.bid = it.bid.bid;
          if (it.bid?.defaultBid !== undefined) obj.bid.defaultBid = it.bid.defaultBid;
          if (it.budgets) obj.budgets = money(it.budgets[0].budgetValue.monetaryBudgetValue.monetaryBudget.value);
        }
        if (mode?.startsWith('503')) { state.mode.targetUpdate = null; return json(503, { message: 'Service Unavailable' }); }
        return json(207, { success: [{ index: 0, [singular]: obj }], error: [] });
      }
      if (action === 'create' && resource === 'targets') {
        const it = body.targets[0];
        if (it.negative === undefined || !it.targetType) return json(400, { message: 'negative and targetType required' });
        const id = String(++seq);
        const parent = it.adGroupId ? state.adGroups[it.adGroupId] : null;
        coll[id] = { ...it, targetId: id, campaignId: it.campaignId || parent?.campaignId, bid: it.bid ? { ...it.bid, currencyCode: 'USD' } : undefined };
        return json(207, { success: [{ index: 0, target: coll[id] }], error: [] });
      }
    }
    // ---- 报表下载（v1/v3 都给 gzip JSON） ----
    if (url.pathname.startsWith('/dl/')) {
      const rows = url.pathname.includes('v3-')
        ? [{ date: '2026-10-20', campaignId: 'C1', searchTerm: 'dog bowl', clicks: 12, cost: 9.6 }]
        : [{ 'advertiserAccount.entityId': 'ENT1', 'date.value': '2026-10-20', 'adProduct.value': 'SPONSORED_PRODUCTS', 'campaign.id': 'C1', 'budgetCurrency.value': 'USD', 'metric.clicks': 12, 'metric.totalCost': 9.6 },
          { 'advertiserAccount.entityId': 'ENT2', 'date.value': '2026-10-20', 'adProduct.value': 'SPONSORED_PRODUCTS', 'campaign.id': 'C9', 'budgetCurrency.value': 'GBP', 'metric.clicks': 5, 'metric.totalCost': 3.1 }];
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(zlib.gzipSync(Buffer.from(JSON.stringify(rows))));
    }
    // ---- v3 报表（搜索词等暂用） ----
    if (url.pathname === '/reporting/reports' && req.method === 'POST') return json(200, { reportId: 'v3-rep-1', status: 'PENDING' });
    if (url.pathname === '/reporting/reports/v3-rep-1') return json(200, { reportId: 'v3-rep-1', status: 'COMPLETED', url: `${base}/dl/v3-rep-1.json.gz`, configuration: { reportTypeId: 'spSearchTerm' } });
    json(404, { message: `mock: no route ${req.method} ${url.pathname}` });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, base, state });
  }));
}
