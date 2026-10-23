// Login with Amazon（LWA）：用刷新令牌换短期访问令牌，并在内存里缓存到快过期。
import { request } from './http.js';
import { lwaTokenUrl } from './regions.js';

const cache = new Map();

export async function accessToken({ clientId, clientSecret, refreshToken }, region = 'NA') {
  if (!clientId || !clientSecret || !refreshToken) throw new Error('凭证不完整：需要 Client ID、Client Secret 和 Refresh Token。');
  const key = `${clientId}:${refreshToken.slice(-12)}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const res = await request(lwaTokenUrl(region), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
    }).toString(),
  });
  const token = res.data?.access_token;
  if (!token) throw new Error('LWA 没有返回访问令牌，请检查凭证。');
  cache.set(key, { token, expiresAt: Date.now() + (res.data.expires_in || 3600) * 1000 });
  return token;
}

// 广告授权：用浏览器跳转回来的 code 换刷新令牌（只在 setup 时用一次）
export async function exchangeCode({ clientId, clientSecret, code, redirectUri }, region = 'NA') {
  const res = await request(lwaTokenUrl(region), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret,
    }).toString(),
  });
  if (!res.data?.refresh_token) throw new Error('没有换到刷新令牌：code 可能已过期（几分钟内有效）或回跳地址不一致。');
  return res.data.refresh_token;
}

export function clearTokenCache() {
  cache.clear();
}
