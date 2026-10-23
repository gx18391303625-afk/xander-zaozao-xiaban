// 已弃用 / 已下线的亚马逊接口：插件不再调用，并告诉 AI 改用哪个新接口。
// 来源：SP-API 弃用时间表（developer-docs.amazon/sp-api/docs/sp-api-deprecations，2026-09-09 更新）、
//       selling-partner-api-models 官方模型、Amazon Ads 官方迁移资料。2026-10 核对。
export const SPAPI_DEPRECATED_PATHS = [
  { re: /^\/orders\/v0\//, use: '/orders/2026-01-01/orders（searchOrders，按 createdAfter/lastUpdatedAfter 查询，includedData 选 BUYER/RECIPIENT/PROCEEDS/FULFILLMENT 等）或 /orders/2026-01-01/orders/{orderId}', note: 'Orders v0 已于 2026-01-28 弃用，2027-03-27 下线。' },
  { re: /^\/finances\/v0\//, use: '/finances/2024-06-19/transactions（postedAfter/postedBefore/marketplaceId/transactionStatus）', note: 'Finances v0（listFinancialEvents 等）已于 2025-07-21 弃用，2027-08-27 下线。' },
  { re: /^\/fba\/inbound\/v0\//, use: '/inbound/fba/2024-03-20/inboundPlans 及其下的 shipments', note: 'FBA Inbound v0 的主要操作已于 2025-01-21 下线。' },
  { re: /^\/catalog\/v0\//, use: '/catalog/2022-04-01/items/{asin} 或 /catalog/2022-04-01/items?identifiers=…', note: 'Catalog Items v0 已下线。' },
  { re: /^\/catalog\/2020-12-01\//, use: '/catalog/2022-04-01/…', note: '请用最新版 Catalog Items 2022-04-01。' },
  { re: /^\/listings\/2020-09-01\//, use: '/listings/2021-08-01/items/{sellerId}/{sku}', note: '请用最新版 Listings Items 2021-08-01。' },
  { re: /^\/reports\/2020-09-04\//, use: '/reports/2021-06-30/…', note: 'Reports 2020-09-04 已下线。' },
];

export const SPAPI_DEPRECATED_REPORTS = {
  GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE: '已弃用，2026-11-11 下线。改用 GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2。',
  GET_V2_SETTLEMENT_REPORT_DATA_XML: '已弃用，2026-11-11 下线。改用 GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2。',
  GET_FBA_SNS_FORECAST_DATA: '已下线（2025-12-11）。',
  GET_FBA_SNS_PERFORMANCE_DATA: '已下线（2025-12-11）。',
  GET_FBA_UNO_INVENTORY_DATA: '已下线。',
};

export function checkSpapiPath(p) {
  const hit = SPAPI_DEPRECATED_PATHS.find((d) => d.re.test(p));
  if (hit) throw new Error(`这个接口已弃用/下线：${p}。${hit.note} 请改用：${hit.use}`);
}

export function checkReportType(t) {
  if (SPAPI_DEPRECATED_REPORTS[t]) throw new Error(`报表 ${t} ${SPAPI_DEPRECATED_REPORTS[t]}`);
}
