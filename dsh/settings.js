// Authenticated owner-UI Settings surface. No switch-writing tool or command is registered.
// This is not a sandbox against same-origin scripts or arbitrary same-machine code.
// Connection owns authentication, request trust and Desktop's authenticated carrier.
import crypto from 'node:crypto';
import { listSwitches, setSwitch } from '../lib/switches.js';
import { VERSION } from '../lib/version.js';

export const inject = ['webServer', 'connection'];
const PREFIX = '/xander-settings/api';
const MAX_BODY = 4096;

function failure(status, message) { return Object.assign(new Error(message), { status }); }

function jsonBody(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
    return Promise.reject(failure(415, '请使用 JSON 请求。'));
  }
  if (Number(req.headers['content-length']) > MAX_BODY) {
    req.resume();
    return Promise.reject(failure(413, '请求内容过大。'));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => {
      req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted);
    };
    const error = err => { cleanup(); reject(err); };
    const aborted = () => error(failure(400, '请求已中断，请刷新后核对状态。'));
    const data = chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        cleanup(); req.resume(); reject(failure(413, '请求内容过大。')); return;
      }
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch { reject(failure(400, '请求内容不是有效的 JSON 对象。')); }
    };
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted);
  });
}

function send(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  res.end(JSON.stringify(body));
}

// Dependency injection is only for isolated tests; the installed entry always uses
// the same business functions and history as the original standalone panel.
export function createSettingsBridge(connection, {
  read = listSwitches, write = setSwitch, version = VERSION,
  openPanel = async () => (await import('../panel/server.js')).startPanel({ port: 0, open: false }),
} = {}) {
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  let disposed = false;
  let panelPromise;
  const snapshot = () => {
    const switches = read();
    const revision = crypto.createHash('sha256').update(JSON.stringify(switches)).digest('hex');
    return { version, switches, revision, csrfToken };
  };
  const checkCaller = req => {
    const admission = connection.admit(req);
    if ('rejection' in admission) throw failure(admission.rejection, '请重新连接 DSH 后再试。');
    const peer = admission.peer;
    if (disposed || peer !== connection.browserPeer || peer.principal?.kind !== 'owner' || peer.signal.aborted) {
      throw failure(403, '只有当前 DSH 的用户界面可以操作此面板。');
    }
    return peer;
  };
  const handler = action => async (req, res) => {
    try {
      const peer = checkCaller(req);
      const method = action === 'state' ? 'GET' : 'POST';
      if (req.method !== method) {
        res.setHeader('Allow', method);
        throw failure(405, '此接口不支持该请求方法。');
      }
      if (action === 'state') return send(res, 200, snapshot());
      const token = req.headers['x-xander-csrf'];
      if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(csrfToken) ||
          !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(csrfToken))) {
        throw failure(403, '面板会话已失效，请刷新后再试。');
      }
      const body = await jsonBody(req);
      // Re-check after awaiting the body; disposal or lost authority must not write.
      if (disposed || peer.signal.aborted || req.aborted) throw failure(403, '请求已失效，请刷新后核对状态。');
      if (action === 'open') {
        if (Object.keys(body).length) throw failure(400, '打开网页的请求不需要参数。');
        // One lazily-owned instance, without changing switches, settings or credentials.
        panelPromise ||= Promise.resolve().then(openPanel).catch(error => { panelPromise = undefined; throw error; });
        const panel = await panelPromise;
        if (disposed || peer.signal.aborted || req.aborted) throw failure(503, '面板请求已失效，请重新打开。');
        return send(res, 200, { address: panel.address });
      }
      if (Object.keys(body).some(key => !['id', 'on', 'expectedRevision'].includes(key)) ||
          typeof body.id !== 'string' || typeof body.on !== 'boolean' ||
          typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRevision)) {
        throw failure(400, '开关请求需要有效的 id、布尔值 on 和读取时的版本。');
      }
      const before = snapshot();
      const item = before.switches.items.find(row => row.id === body.id && row.implemented);
      if (!item) throw failure(400, '这个开关不存在，或功能尚未开放。');
      if (before.revision !== body.expectedRevision) {
        return send(res, 409, { error: '开关已在别处更新，已为你重新读取；请核对后再操作。', state: before });
      }
      if (item.on !== body.on) write(body.id, body.on, 'dsh-settings');
      return send(res, 200, snapshot());
    } catch (error) {
      send(res, error.status || 500, { error: error.message || '操作失败，请刷新后核对状态。' });
    }
  };
  return {
    routes: ['state', 'switch', 'open'].map(action => ({ kind: 'exact', path: `${PREFIX}/${action}`, handler: handler(action) })),
    async dispose() {
      disposed = true;
      if (!panelPromise) return;
      const pending = panelPromise;
      panelPromise = undefined;
      const panel = await pending.catch(() => undefined);
      if (panel?.server) {
        panel.server.closeAllConnections?.();
        await new Promise(resolve => panel.server.close(resolve));
      }
    },
  };
}

export function apply(ctx) {
  ctx.effect(() => {
    const bridge = createSettingsBridge(ctx.connection);
    const disposers = [];
    try {
      for (const route of bridge.routes) disposers.push(ctx.webServer.register(route));
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose();
      void bridge.dispose();
      throw error;
    }
    return async () => {
      for (const dispose of disposers.reverse()) dispose();
      await bridge.dispose();
    };
  });
}
