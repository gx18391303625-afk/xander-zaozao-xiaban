// 测试用的“假亚马逊”：模拟 LWA、卖家接口、广告接口的一小部分，用来验证整条写入流程。
import http from 'node:http';

export function startMock() {
  const state = {
    keywords: { '111': { keywordId: '111', campaignId: 'C1', adGroupId: 'G1', keywordText: 'dog bowl', matchType: 'EXACT', state: 'ENABLED', bid: 1.0 } },
    campaigns: { 'C1': { campaignId: 'C1', name: 'Bowl - Exact', state: 'ENABLED', budget: { budget: 20, budgetType: 'DAILY' } } },
    adGroups: { 'G1': { adGroupId: 'G1', campaignId: 'C1', name: 'Exact', state: 'ENABLED', defaultBid: 0.8 } },
    negatives: {},
    listing: { sku: 'BOWL-BLUE', productType: 'PET_SUPPLIES', title: 'Old Title', price: 19.99 },
    calls: [],
    mode: {}, // 故障注入：{ kwPut: '503-applied' | '503-not-applied' }
  };
  let seq = 1000;

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const ch of req) raw += ch;
    const url = new URL(req.url, 'http://x');
    const body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : raw;
    state.calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

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
    // ---- Ads ----
    if (url.pathname === '/v2/profiles') {
      return json(200, [{ profileId: 999, countryCode: 'US', currencyCode: 'USD', accountInfo: { type: 'seller', marketplaceStringId: 'ATVPDKIKX0DER', name: 'Test' } }]);
    }
    if (req.headers['amazon-advertising-api-scope'] === undefined && url.pathname.startsWith('/sp/')) return json(400, { message: 'missing scope' });
    const listOf = (coll, idKey, filterKey) => {
      const inc = body?.[filterKey]?.include;
      const ag = body?.adGroupIdFilter?.include;
      return Object.values(coll).filter((o) => (!inc || inc.includes(String(o[idKey]))) && (!ag || ag.includes(String(o.adGroupId))));
    };
    if (url.pathname === '/sp/keywords/list') return json(200, { keywords: listOf(state.keywords, 'keywordId', 'keywordIdFilter') });
    if (url.pathname === '/sp/campaigns/list') return json(200, { campaigns: listOf(state.campaigns, 'campaignId', 'campaignIdFilter') });
    if (url.pathname === '/sp/adGroups/list') return json(200, { adGroups: listOf(state.adGroups, 'adGroupId', 'adGroupIdFilter') });
    if (url.pathname === '/sp/negativeKeywords/list') {
      const inc = body?.negativeKeywordIdFilter?.include;
      return json(200, { negativeKeywords: Object.values(state.negatives).filter((n) => !inc || inc.includes(n.keywordId)) });
    }
    if (url.pathname === '/sp/keywords' && req.method === 'PUT') {
      const mode = state.mode.kwPut;
      const it = body.keywords[0];
      if (mode !== '503-not-applied') Object.assign(state.keywords[it.keywordId], it);
      if (mode?.startsWith('503')) { state.mode.kwPut = null; return json(503, { message: 'Service Unavailable' }); }
      return json(207, { keywords: { success: [{ index: 0, keywordId: it.keywordId }], error: [] } });
    }
    if (url.pathname === '/sp/campaigns' && req.method === 'PUT') {
      const it = body.campaigns[0];
      Object.assign(state.campaigns[it.campaignId], it);
      return json(207, { campaigns: { success: [{ index: 0, campaignId: it.campaignId }], error: [] } });
    }
    if (url.pathname === '/sp/negativeKeywords' && req.method === 'POST') {
      const it = body.negativeKeywords[0];
      const id = String(++seq);
      state.negatives[id] = { ...it, keywordId: id };
      return json(207, { negativeKeywords: { success: [{ index: 0, negativeKeywordId: id }], error: [] } });
    }
    json(404, { message: `mock: no route ${req.method} ${url.pathname}` });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, base, state });
  }));
}
