// 紫鸟浏览器（实验功能）。
// 工作方式：紫鸟客户端以 WebDriver 模式启动后，会在本机开一个 HTTP 端口；
// 我们通过它打开指定店铺的浏览器，再用 Chrome DevTools 协议（CDP）读取页面、按批准的步骤点击/填写。
// 参数名以紫鸟官方 WebDriver 文档为准；不同版本可能有差异，可在 config.json 的 ziniao 段调整。
import { request } from './http.js';
import { loadConfig } from './config.js';
import { getSecret } from './secrets.js';
import { isOn } from './switches.js';

const ACTIONS = ['goto', 'click', 'type', 'wait', 'press'];

function endpoint() {
  const cfg = loadConfig().ziniao || {};
  return `http://127.0.0.1:${cfg.port || 16851}`;
}

async function call(action, extra = {}) {
  const cfg = loadConfig().ziniao || {};
  const sec = getSecret('ziniao') || {};
  const body = {
    action, requestId: `${Date.now()}`,
    company: cfg.company, username: cfg.username, password: sec.password,
    ...extra,
  };
  const res = await request(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, timeoutMs: 120000, retries: 0 });
  const d = res.data || {};
  if (d.statusCode !== undefined && Number(d.statusCode) !== 0) throw new Error(`紫鸟返回错误：${d.err || d.message || JSON.stringify(d).slice(0, 300)}`);
  return d;
}

export async function status() {
  const cfg = loadConfig().ziniao || {};
  if (!cfg.enabled) return { configured: false, note: '还没配置紫鸟。运行 `xander setup` → 紫鸟浏览器。' };
  try {
    const list = await call('getBrowserList');
    const stores = (list.browserList || list.data || []).map((b) => ({ browserId: String(b.browserOauth ?? b.browserId ?? b.id), name: b.browserName || b.name, platform: b.platform_name || b.siteName }));
    return { configured: true, reachable: true, controlSwitchOn: isOn('ziniao.control'), stores };
  } catch (e) {
    return { configured: true, reachable: false, controlSwitchOn: isOn('ziniao.control'), error: e.message, hint: '请确认紫鸟客户端已用 WebDriver 模式启动，并且端口与配置一致。' };
  }
}

async function open(browserId) {
  const d = await call('startBrowser', { browserOauth: String(browserId), browserId: String(browserId), isHeadless: 0, isWebDriverReadOnlyMode: 0 });
  const port = d.debuggingPort || d.data?.debuggingPort;
  if (!port) throw new Error(`紫鸟没有返回调试端口：${JSON.stringify(d).slice(0, 300)}`);
  return port;
}

// ---------- 极简 CDP 客户端（Node 22+ 自带 WebSocket） ----------
async function cdp(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page') || targets[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('找不到可控制的页面标签。');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('连接浏览器调试端口失败')); });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, 30000);
    pending.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(m.error.message)) : resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '页面脚本出错');
    return r.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps 不能为空');
  if (steps.length > 40) throw new Error('一次最多 40 步，请拆分。');
  return steps.map((s, i) => {
    if (!ACTIONS.includes(s.action)) throw new Error(`第 ${i + 1} 步 action 只能是 ${ACTIONS.join('/')}`);
    if (s.action === 'goto' && !/^https:\/\/[^/]*(amazon\.|sellercentral|advertising\.amazon)/.test(s.url || '')) throw new Error(`第 ${i + 1} 步只允许打开亚马逊后台网址`);
    if ((s.action === 'click' || s.action === 'type') && !s.selector) throw new Error(`第 ${i + 1} 步缺少 selector`);
    if (s.action === 'type' && typeof s.text !== 'string') throw new Error(`第 ${i + 1} 步缺少 text`);
    if (s.action === 'wait') return { action: 'wait', ms: Math.min(Number(s.ms) || 1000, 30000) };
    return { action: s.action, url: s.url, selector: s.selector, text: s.text, key: s.key };
  });
}

// 只读：打开店铺浏览器、可选跳转，读取当前页面的标题、网址和文字（截断）
export async function snapshot(browserId, url) {
  const port = await open(browserId);
  const c = await cdp(port);
  try {
    if (url) {
      validateSteps([{ action: 'goto', url }]);
      await c.send('Page.navigate', { url });
      await sleep(4000);
    }
    const info = await c.evaluate(`({ title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 12000) : '' })`);
    return info;
  } finally { c.close(); }
}

// 写：只在开关打开、提案已批准后由 proposals.js 调用
export async function runSteps(browserId, steps) {
  if (!isOn('ziniao.control')) throw new Error('紫鸟控制开关是关着的。');
  const port = await open(browserId);
  const c = await cdp(port);
  const log = [];
  try {
    for (const [i, s] of steps.entries()) {
      if (s.action === 'goto') { await c.send('Page.navigate', { url: s.url }); await sleep(3000); }
      else if (s.action === 'wait') await sleep(s.ms);
      else if (s.action === 'click') {
        const ok = await c.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(s.selector)}); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`);
        if (!ok) throw new Error(`第 ${i + 1} 步找不到元素：${s.selector}`);
        await sleep(800);
      } else if (s.action === 'type') {
        const ok = await c.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(s.selector)}); if (!el) return false; el.focus();
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(s.text)});
          el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
        if (!ok) throw new Error(`第 ${i + 1} 步找不到输入框：${s.selector}`);
      } else if (s.action === 'press') {
        await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: s.key || 'Enter' });
        await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key || 'Enter' });
      }
      log.push({ step: i + 1, action: s.action, ok: true });
    }
    const after = await c.evaluate(`({ title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 3000) : '' })`);
    return { ok: true, log, after };
  } catch (e) {
    return { ok: false, log, error: e.message };
  } finally { c.close(); }
}
