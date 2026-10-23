// MCP 协议与开关面板的安全检查
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isolate } from './helpers.js';

const dir = isolate();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mcpSession(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, XANDER_HOME: dir, XANDER_SECRET_BACKEND: 'file' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', () => {
      try { resolve({ lines: out.trim().split('\n').map((l) => JSON.parse(l)), err }); } catch (e) { reject(new Error(`stdout 不是纯 JSON：${out}\n${err}`)); }
    });
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
    setTimeout(() => child.stdin.end(), 1500);
  });
}

test('MCP：握手、列工具、调用；stdout 只有协议内容', async () => {
  const { lines, err } = await mcpSession([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'xander_switches', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'xander_execute_change', arguments: { proposalId: 'P20260101000000abcd', hash: 'x', approved: true } } },
    { jsonrpc: '2.0', id: 5, method: 'nope' },
  ]);
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.equal(byId[1].result.serverInfo.name, 'xander');
  const names = byId[2].result.tools.map((t) => t.name);
  assert.ok(names.includes('xander_prepare_change'));
  assert.ok(!names.some((n) => /switch_(on|set)|set_switch|toggle/.test(n)), '不能有拨开关的工具');
  const sw = JSON.parse(byId[3].result.content[0].text);
  assert.ok(sw.items.every((x) => x.on === false), '默认全关');
  assert.equal(byId[4].result.isError, true);
  assert.equal(byId[5].error.code, -32601);
  assert.ok(!/ExperimentalWarning/.test(err), 'SQLite 实验提示应被屏蔽');
});

function req(port, { method = 'GET', pathName = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: pathName, headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

test('开关面板：没口令、外部 Host 都被拒；有口令可以拨开关', async () => {
  const { startPanel } = await import('../panel/server.js');
  const { server, address } = await startPanel({ port: 0, open: false });
  const port = server.address().port;
  const token = new URL(address).hash.split('t=')[1];
  try {
    assert.equal((await req(port, { headers: { host: `127.0.0.1:${port}` } })).status, 200);
    assert.equal((await req(port, { headers: { host: 'evil.example.com' } })).status, 403);
    assert.equal((await req(port, { pathName: '/api/state', headers: { host: `127.0.0.1:${port}` } })).status, 401);
    const h = { host: `127.0.0.1:${port}`, 'x-xander-token': token, 'content-type': 'application/json' };
    const st = JSON.parse((await req(port, { pathName: '/api/state', headers: h })).body);
    assert.ok(st.switches.items.length > 10);
    const after = JSON.parse((await req(port, { method: 'POST', pathName: '/api/switch', headers: h, body: { id: 'ads.sp.target.bid', on: true } })).body);
    assert.equal(after.switches.items.find((x) => x.id === 'ads.sp.target.bid').on, true);
    const bad = await req(port, { method: 'POST', pathName: '/api/switch', headers: h, body: { id: 'fba.inbound', on: true } });
    assert.equal(bad.status, 400, '规划中的功能不能打开');
    const all = JSON.parse((await req(port, { method: 'POST', pathName: '/api/all', headers: h, body: { on: true } })).body);
    assert.equal(all.switches.items.find((x) => x.id === 'ziniao.control').on, false, '一键全开不含紫鸟');
  } finally {
    server.close();
  }
});

test('终端开关命令：非交互环境不能打开开关', async () => {
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'cli/xander.js'), 'switch', 'on', 'ads.sp.target.bid'], { env: { ...process.env, XANDER_HOME: dir, XANDER_SECRET_BACKEND: 'file' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end('确认\n');
  });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /本人在终端/);
});
