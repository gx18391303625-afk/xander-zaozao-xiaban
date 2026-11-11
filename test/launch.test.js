// server/launch.sh：宿主 PATH 里没有 node 时仍能找到并启动 MCP 服务
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolate } from './helpers.js';

const dir = isolate();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = path.join(root, 'server/launch.sh');

function run(env) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', [launcher], { env: { XANDER_HOME: dir, XANDER_SECRET_BACKEND: 'file', PATH: '/usr/bin:/bin', ...env } });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    setTimeout(() => child.stdin.end(), 1500);
  });
}

function assertServed({ out }) {
  const byId = Object.fromEntries(out.trim().split('\n').map((l) => JSON.parse(l)).map((l) => [l.id, l]));
  assert.equal(byId[1].result.serverInfo.name, 'xander');
  assert.ok(byId[2].result.tools.some((t) => t.name === 'xander_status'));
}

test('launch.sh：XANDER_NODE 指定 node，PATH 里没有 node 也能启动', async () => {
  const r = await run({ XANDER_NODE: process.execPath, HOME: dir });
  assertServed(r);
});

test('launch.sh：没设 XANDER_NODE 时用 ~/.local/share/xander-runtime 里最新的内置 node', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-launch-'));
  try {
    for (const v of ['node-v22.9.0-x', 'node-v22.99.0-x']) fs.mkdirSync(path.join(home, '.local/share/xander-runtime', v, 'bin'), { recursive: true });
    fs.symlinkSync(process.execPath, path.join(home, '.local/share/xander-runtime/node-v22.99.0-x/bin/node'));
    fs.writeFileSync(path.join(home, '.local/share/xander-runtime/node-v22.9.0-x/bin/node'), '#!/bin/sh\necho old-runtime-used >&2\nexit 9\n', { mode: 0o755 });
    const r = await run({ HOME: home });
    assertServed(r);
    assert.ok(!r.err.includes('old-runtime-used'));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('launch.sh：找不到 node 时向 stderr 报中文错误并退出 1，stdout 保持为空', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-launch-'));
  try {
    const r = await run({ HOME: home, XANDER_NODE: '', PATH: '/nonexistent' });
    if (fs.existsSync('/opt/homebrew/bin/node') || fs.existsSync('/usr/local/bin/node')) return;
    assert.equal(r.code, 1);
    assert.equal(r.out, '');
    assert.match(r.err, /Node\.js 22\.13/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
