// 本地开关面板：只监听 127.0.0.1，每次启动生成随机口令，别的网站和局域网里的人都访问不到。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { listSwitches, setSwitch, setAll, setLimits } from '../lib/switches.js';
import { loadConfig, updateConfig } from '../lib/config.js';
import { listProposals, panelDecision, changeLog } from '../lib/proposals.js';
import { getSecret } from '../lib/secrets.js';
import { VERSION } from '../lib/version.js';
import { decisionSummary } from './decision-summary.js';

const HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html');
const HTML_UNAVAILABLE = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>面板暂时无法加载</title><body><h1>面板暂时无法加载</h1><p>页面资源暂时不可用，请稍后刷新。若插件已更新，请在当前操作完成后从新版本重新打开面板。</p></body></html>';

function state() {
  const cfg = loadConfig();
  return {
    version: VERSION,
    switches: listSwitches(),
    settings: cfg.settings,
    stores: Object.fromEntries(Object.entries(cfg.stores).map(([k, s]) => [k, {
      region: s.region, marketplaces: s.marketplaces, sellerApi: !!getSecret(`spapi:${k}`), adsApi: !!getSecret(`ads:${k}`),
    }])),
    ziniaoConfigured: !!cfg.ziniao?.enabled,
    proposals: listProposals(20),
    ledger: changeLog(40).reverse(),
    decisionHistory: decisionSummary(cfg),
  };
}

export function startPanel({ port = 8765, open = true } = {}) {
  // The installer may remove this version's directory while its panel is still
  // serving an approval. Keep HTML paired with the already-loaded server code.
  let html;
  const readHtml = () => html ??= fs.readFileSync(HTML, 'utf8');
  try { readHtml(); } catch { /* Retry on GET if installation is not ready yet. */ }
  const token = crypto.randomBytes(18).toString('base64url');
  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      if (res.destroyed || res.writableEnded) return;
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
      res.end(payload);
    };
    try {
      // 防 DNS 重绑定：只接受本机地址的 Host
      const host = req.headers.host || '';
      const actualPort = server.address()?.port;
      if (host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) return send(403, { error: 'forbidden host' });

      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/') {
        let page;
        try { page = readHtml(); } catch { return send(503, HTML_UNAVAILABLE, 'text/html; charset=utf-8'); }
        return send(200, page, 'text/html; charset=utf-8');
      }
      if (!url.pathname.startsWith('/api/')) return send(404, { error: 'not found' });
      if (req.headers['x-xander-token'] !== token) return send(401, { error: '口令不对：请用终端里打印的完整网址打开面板。' });

      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, state());
      if (req.method !== 'POST') return send(405, { error: 'method' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return send(413, { error: 'too large' }); }
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/api/switch') setSwitch(body.id, !!body.on, 'panel');
      else if (url.pathname === '/api/all') setAll(!!body.on, { includeSpecial: !!body.includeSpecial, by: 'panel' });
      else if (url.pathname === '/api/limits') setLimits(body, 'panel');
      else if (url.pathname === '/api/settings') {
        updateConfig((cfg) => {
          if (['chat', 'panel'].includes(body.approvalMode)) cfg.settings.approvalMode = body.approvalMode;
          if (typeof body.dryRun === 'boolean') cfg.settings.dryRun = body.dryRun;
        });
      } else if (url.pathname === '/api/proposal') panelDecision(body.id, body.decision === 'approve' ? 'approve' : 'reject');
      else return send(404, { error: 'not found' });
      return send(200, state());
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      return send(400, { error: e.message });
    }
  });

  return new Promise((resolve) => {
    const tryListen = (p) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && p !== 0) tryListen(0);
        else throw e;
      });
      server.listen(p, '127.0.0.1', () => {
        const address = `http://127.0.0.1:${server.address().port}/#t=${token}`;
        if (open) openBrowser(address);
        resolve({ server, address });
      });
    };
    tryListen(port);
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* 打不开就让用户手动复制 */ }
}
