// 亚马逊站点、区域与接口地址。只放公开的固定值。
// lang：该站点 Listing 的默认语言标签（改文案时，没有原值也没指定就用它）。

export const MARKETPLACES = {
  US: { id: 'ATVPDKIKX0DER', region: 'NA', currency: 'USD', name: '美国', lang: 'en_US' },
  CA: { id: 'A2EUQ1WTGCTBG2', region: 'NA', currency: 'CAD', name: '加拿大', lang: 'en_CA' },
  MX: { id: 'A1AM78C64UM0Y8', region: 'NA', currency: 'MXN', name: '墨西哥', lang: 'es_MX' },
  BR: { id: 'A2Q3Y263D00KWC', region: 'NA', currency: 'BRL', name: '巴西', lang: 'pt_BR' },
  UK: { id: 'A1F83G8C2ARO7P', region: 'EU', currency: 'GBP', name: '英国', lang: 'en_GB' },
  DE: { id: 'A1PA6795UKMFR9', region: 'EU', currency: 'EUR', name: '德国', lang: 'de_DE' },
  FR: { id: 'A13V1IB3VIYZZH', region: 'EU', currency: 'EUR', name: '法国', lang: 'fr_FR' },
  IT: { id: 'APJ6JRA9NG5V4', region: 'EU', currency: 'EUR', name: '意大利', lang: 'it_IT' },
  ES: { id: 'A1RKKUPIHCS9HS', region: 'EU', currency: 'EUR', name: '西班牙', lang: 'es_ES' },
  NL: { id: 'A1805IZSGTT6HS', region: 'EU', currency: 'EUR', name: '荷兰', lang: 'nl_NL' },
  SE: { id: 'A2NODRKZP88ZB9', region: 'EU', currency: 'SEK', name: '瑞典', lang: 'sv_SE' },
  PL: { id: 'A1C3SOZRARQ6R3', region: 'EU', currency: 'PLN', name: '波兰', lang: 'pl_PL' },
  BE: { id: 'AMEN7PMS3EDWL', region: 'EU', currency: 'EUR', name: '比利时', lang: 'fr_BE' },
  TR: { id: 'A33AVAJ2PDY3EV', region: 'EU', currency: 'TRY', name: '土耳其', lang: 'tr_TR' },
  AE: { id: 'A2VIGQ35RCS4UG', region: 'EU', currency: 'AED', name: '阿联酋', lang: 'en_AE' },
  SA: { id: 'A17E79C6D8DWNP', region: 'EU', currency: 'SAR', name: '沙特', lang: 'ar_SA' },
  EG: { id: 'ARBP9OOSHTCHU', region: 'EU', currency: 'EGP', name: '埃及', lang: 'ar_EG' },
  IN: { id: 'A21TJRUUN4KGV', region: 'EU', currency: 'INR', name: '印度', lang: 'en_IN' },
  JP: { id: 'A1VC38T7YXB528', region: 'FE', currency: 'JPY', name: '日本', lang: 'ja_JP' },
  AU: { id: 'A39IBJ37TRP1C6', region: 'FE', currency: 'AUD', name: '澳大利亚', lang: 'en_AU' },
  SG: { id: 'A19VAU5U5O7RUS', region: 'FE', currency: 'SGD', name: '新加坡', lang: 'en_SG' },
};

export const SPAPI_HOSTS = {
  NA: 'https://sellingpartnerapi-na.amazon.com',
  EU: 'https://sellingpartnerapi-eu.amazon.com',
  FE: 'https://sellingpartnerapi-fe.amazon.com',
};

export const ADS_HOSTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

// 广告授权页（新手在浏览器里点“允许”的地方）
export const ADS_AUTH_URLS = {
  NA: 'https://www.amazon.com/ap/oa',
  EU: 'https://eu.account.amazon.com/ap/oa',
  FE: 'https://apac.account.amazon.com/ap/oa',
};

export const LWA_TOKEN_URLS = {
  NA: 'https://api.amazon.com/auth/o2/token',
  EU: 'https://api.amazon.co.uk/auth/o2/token',
  FE: 'https://api.amazon.co.jp/auth/o2/token',
};

export function marketplace(code) {
  const m = MARKETPLACES[String(code || '').toUpperCase()];
  if (!m) throw new Error(`不认识的站点代码：${code}。可用：${Object.keys(MARKETPLACES).join(', ')}`);
  return { code: String(code).toUpperCase(), ...m };
}

export function marketplaceById(id) {
  for (const [code, m] of Object.entries(MARKETPLACES)) if (m.id === id) return { code, ...m };
  return null;
}

// 测试时可以用环境变量把接口指向本地假服务器。
export function spapiHost(region) {
  return process.env.XANDER_SPAPI_HOST || SPAPI_HOSTS[region];
}
export function adsHost(region) {
  return process.env.XANDER_ADS_HOST || ADS_HOSTS[region];
}
export function lwaTokenUrl(region) {
  return process.env.XANDER_LWA_URL || LWA_TOKEN_URLS[region] || LWA_TOKEN_URLS.NA;
}
