// 统一的网络请求：超时、限流重试、错误信息中文化。
// 规则：读请求遇到 429/5xx 会自动重试；写请求只在 429（亚马逊明确拒收、肯定没生效）时重试，
// 其他失败一律不重发，避免重复改动。

export class HttpError extends Error {
  constructor(message, { status, body, url, method, sent }) {
    super(message);
    this.status = status;
    this.body = body;
    this.url = url;
    this.method = method;
    this.sent = sent; // 请求是否可能已到达亚马逊（用于判断“结果未知”）
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 60000, retries, isWrite = false, raw = false } = {}) {
  const maxRetries = retries ?? (isWrite ? 2 : 4);
  let attempt = 0;
  for (;;) {
    attempt++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const timedOut = e.name === 'AbortError';
      // 写请求超时或断网：不知道亚马逊有没有收到，交给上层标记 OUTCOME_UNKNOWN
      if (!isWrite && attempt <= maxRetries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new HttpError(timedOut ? `请求超时：${method} ${url}` : `网络错误：${e.message}`, {
        status: 0, url, method, sent: isWrite, body: null,
      });
    }
    clearTimeout(timer);

    const retryable = res.status === 429 || (!isWrite && res.status >= 500);
    if (retryable && attempt <= maxRetries) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30000) : 1000 * 2 ** attempt);
      continue;
    }

    if (raw) {
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new HttpError(`HTTP ${res.status}：${t.slice(0, 500)}`, { status: res.status, body: t, url, method, sent: true });
      }
      return res;
    }

    const text = await res.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* 保留文本 */ }
    if (!res.ok) {
      throw new HttpError(explain(res.status, data), { status: res.status, body: data, url, method, sent: res.status >= 500 });
    }
    return { status: res.status, headers: Object.fromEntries(res.headers), data };
  }
}

function explain(status, data) {
  const detail = typeof data === 'string' ? data.slice(0, 400) : JSON.stringify(data)?.slice(0, 400);
  const hint = {
    400: '请求参数有误',
    401: '授权失效或令牌错误，请重新运行 `xander setup` 检查这项连接',
    403: '没有权限：可能是应用没勾选这个角色/权限，或这个店铺/广告账户没授权给你的应用',
    404: '找不到对象：ID、SKU 或站点可能不对',
    409: '对象状态冲突',
    413: '请求太大',
    415: '内容类型不对',
    422: '亚马逊不接受这个改动（校验未通过）',
    429: '请求太频繁，被亚马逊限流了，请稍后再试',
  }[status] || (status >= 500 ? '亚马逊服务端出错' : '请求失败');
  return `HTTP ${status}（${hint}）：${detail}`;
}
