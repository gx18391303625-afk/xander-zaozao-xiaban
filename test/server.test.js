// MCP 协议与开关面板的安全检查
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isolate } from './helpers.js';
import { PERMISSION_MODEL } from '../lib/switch-groups.js';

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
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'xander_status', arguments: { check: false } } },
  ]);
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.equal(byId[1].result.serverInfo.name, 'xander');
  const expectedVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  assert.equal(byId[1].result.serverInfo.version, expectedVersion);
  assert.equal(JSON.parse(byId[6].result.content[0].text).version, expectedVersion);
  for (const file of ['plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    assert.equal(JSON.parse(readFileSync(path.join(root, file), 'utf8')).version, expectedVersion, file);
  }
  const names = byId[2].result.tools.map((t) => t.name);
  assert.ok(names.includes('xander_prepare_change'));
  for (const name of ['xander_diagnose_asin', 'xander_save_diagnostic', 'xander_diagnostics', 'xander_experiment_create', 'xander_experiment_review', 'xander_experiments']) {
    const tool = byId[2].result.tools.find(t => t.name === name);
    assert.ok(tool, `${name} 必须通过真实MCP协议注册`);
    assert.equal(tool.annotations.openWorldHint, false, '诊断账本只操作本机');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
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
    assert.deepEqual(st.switches.items.map((item) => item.id), ['ads.manage', 'listing.manage', 'fba.inbound', 'ziniao.control']);
    assert.match(st.revision, /^[a-f0-9]{64}$/);
    const enabled = await req(port, { method: 'POST', pathName: '/api/switch', headers: h,
      body: { id: 'ads.manage', on: true, permissionModel: PERMISSION_MODEL, expectedRevision: st.revision } });
    assert.equal(enabled.status, 200);
    const after = JSON.parse(enabled.body);
    assert.equal(after.switches.items.find((x) => x.id === 'ads.manage').on, true);
    assert.ok(after.switches.items.find((x) => x.id === 'ads.manage').operations.every((operation) => operation.on === true));
    const persisted = readFileSync(path.join(dir, 'switches.json'), 'utf8');
    for (const id of ['unknown.operation', 'ads.sp.target.bid', 'listing.price']) {
      const bad = await req(port, { method: 'POST', pathName: '/api/switch', headers: h,
        body: { id, on: true, permissionModel: PERMISSION_MODEL, expectedRevision: after.revision } });
      assert.equal(bad.status, 400, '未知或旧细分 ID 不能从公开面板授权');
    }
    for (const body of [{ id: 'ads.manage', on: false, permissionModel: PERMISSION_MODEL }, { id: 'ads.manage', on: 'false', permissionModel: PERMISSION_MODEL, expectedRevision: after.revision },
      { id: 'ads.manage', on: false, permissionModel: PERMISSION_MODEL, expectedRevision: after.revision, bypass: true }]) {
      assert.equal((await req(port, { method: 'POST', pathName: '/api/switch', headers: h, body })).status, 400);
    }
    const all = await req(port, { method: 'POST', pathName: '/api/all', headers: h, body: { on: true } });
    assert.ok([400, 404, 405].includes(all.status), '公开网页不再允许绕过四个总权限的一键全开');
    assert.equal(readFileSync(path.join(dir, 'switches.json'), 'utf8'), persisted);
    assert.equal(after.switches.items.find((x) => x.id === 'ziniao.control').on, false, '广告授权不含紫鸟');
    assert.equal(after.switches.items.find((x) => x.id === 'fba.inbound').on, false, '广告授权不含 FBA');
    const stale = await req(port, { method: 'POST', pathName: '/api/switch', headers: h,
      body: { id: 'ads.manage', on: false, permissionModel: PERMISSION_MODEL, expectedRevision: st.revision } });
    assert.equal(stale.status, 409);
    assert.equal(JSON.parse(stale.body).state.revision, after.revision);
    assert.equal(readFileSync(path.join(dir, 'switches.json'), 'utf8'), persisted);
    const fbaResponse = await req(port, { method: 'POST', pathName: '/api/switch', headers: h,
      body: { id: 'fba.inbound', on: true, permissionModel: PERMISSION_MODEL, expectedRevision: after.revision } });
    assert.equal(fbaResponse.status, 200);
    const fba = JSON.parse(fbaResponse.body);
    assert.equal(fba.switches.items.find((x) => x.id === 'fba.inbound').on, true, 'FBA 可由用户单独打开');
  } finally {
    server.close();
  }
});

test('原面板即使持有新token与revision，旧格式或错误permissionModel也零写入', async () => {
  const { startPanel } = await import('../panel/server.js');
  const { setSwitch } = await import('../lib/switches.js');
  const ids = ['ads.manage', 'listing.manage', 'fba.inbound', 'ziniao.control'];
  for (const id of ids) setSwitch(id, false, 'isolated-protocol-test-setup');
  const { server, address } = await startPanel({ port: 0, open: false });
  const port = server.address().port;
  const token = new URLSearchParams(new URL(address).hash.slice(1)).get('t');
  const headers = { host: `127.0.0.1:${port}`, 'x-xander-token': token, 'content-type': 'application/json' };
  try {
    const before = JSON.parse((await req(port, { pathName: '/api/state', headers })).body);
    assert.ok(before.switches.items.every(item => item.on === false));
    const persisted = readFileSync(path.join(dir, 'switches.json'), 'utf8');
    for (const id of ids) {
      for (const model of [undefined, null, '', 'operations-v1', 'masters-v0', 'masters-v2', 'masters-v1 ', true, 1, {}, [PERMISSION_MODEL]]) {
        const body = { id, on: true, expectedRevision: before.revision };
        if (model !== undefined) body.permissionModel = model;
        const response = await req(port, { method: 'POST', pathName: '/api/switch', headers, body });
        assert.equal(response.status, 400, `${id}/${JSON.stringify(model)}`);
        assert.match(JSON.parse(response.body).error, /permissionModel|重载/);
        assert.equal(readFileSync(path.join(dir, 'switches.json'), 'utf8'), persisted, '旧客户端不能开启整组，也不能写审计');
      }
    }
    const after = JSON.parse((await req(port, { pathName: '/api/state', headers })).body);
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.switches, before.switches);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

test('原面板总权限revision对同组相同数量的细授权交换也拒绝过期请求', async () => {
  const { startPanel } = await import('../panel/server.js');
  const { setSwitch } = await import('../lib/switches.js');
  setSwitch('ads.manage', false, 'isolated-reset');
  setSwitch('ads.sp.target.bid', true, 'isolated-legacy');
  const { server, address } = await startPanel({ port: 0, open: false });
  const port = server.address().port;
  const token = new URLSearchParams(new URL(address).hash.slice(1)).get('t');
  const headers = { host: `127.0.0.1:${port}`, 'x-xander-token': token, 'content-type': 'application/json' };
  try {
    const before = JSON.parse((await req(port, { pathName: '/api/state', headers })).body);
    assert.equal(before.switches.items[0].on, null);
    assert.equal(before.switches.items[0].enabledOperations, 1);
    setSwitch('ads.sp.target.bid', false, 'isolated-legacy');
    setSwitch('ads.sp.campaign.budget', true, 'isolated-legacy');
    const persisted = readFileSync(path.join(dir, 'switches.json'), 'utf8');
    const response = await req(port, { method: 'POST', pathName: '/api/switch', headers,
      body: { id: 'ads.manage', on: true, permissionModel: PERMISSION_MODEL, expectedRevision: before.revision } });
    assert.equal(response.status, 409);
    const latest = JSON.parse(response.body).state;
    assert.notEqual(latest.revision, before.revision);
    assert.equal(latest.switches.items[0].on, before.switches.items[0].on);
    assert.equal(latest.switches.items[0].enabledOperations, before.switches.items[0].enabledOperations);
    assert.equal(readFileSync(path.join(dir, 'switches.json'), 'utf8'), persisted, '冲突不能统一开启剩余细授权');
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

async function runSwitchCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'cli/xander.js'), 'switch', ...args], {
      env: { ...process.env, XANDER_HOME: dir, XANDER_SECRET_BACKEND: 'file' },
    });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('isolated switch CLI timed out')); }, 5000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    child.stdin.end();
  });
}

test('公开CLI仅列四个总授权，混合状态不误报全关，旧细ID的on/off都不能写', async () => {
  const before = readFileSync(path.join(dir, 'switches.json'), 'utf8');
  const listing = await runSwitchCli(['list']);
  assert.equal(listing.code, 0);
  for (const id of ['ads.manage', 'listing.manage', 'fba.inbound', 'ziniao.control']) assert.ok(listing.output.includes(id));
  assert.doesNotMatch(listing.output, /ads\.sp\.target\.bid|listing\.price/);
  assert.match(listing.output, /部分|混合/, '旧库只有部分细授权时应明确提示');
  for (const command of ['on', 'off']) {
    const result = await runSwitchCli([command, 'ads.sp.target.bid']);
    assert.notEqual(result.code, 0);
    assert.equal(readFileSync(path.join(dir, 'switches.json'), 'utf8'), before);
  }
});

test('终端开关命令：非交互环境不能打开总权限', async () => {
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'cli/xander.js'), 'switch', 'on', 'ads.manage'], { env: { ...process.env, XANDER_HOME: dir, XANDER_SECRET_BACKEND: 'file' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end('确认\n');
  });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /本人在终端/);
});
