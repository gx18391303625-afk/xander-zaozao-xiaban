import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every server runs in its own process, temporary plugin copy and data home.
// These tests never import the live panel, read user configuration, or open a browser.
async function isolatedPanel(t, { missingHtml = false } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-panel-resilience-'));
  const pluginRoot = path.join(tempRoot, 'plugin');
  const dataRoot = path.join(tempRoot, 'data');
  let child;
  let stderr = '';
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
      });
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  fs.mkdirSync(pluginRoot);
  fs.mkdirSync(dataRoot);
  for (const entry of ['lib', 'panel', 'package.json']) {
    fs.cpSync(path.join(sourceRoot, entry), path.join(pluginRoot, entry), { recursive: true });
  }
  fs.writeFileSync(path.join(dataRoot, 'config.json'), JSON.stringify({ stores: {}, settings: { approvalMode: 'panel', dryRun: true } }));
  const htmlPath = path.join(pluginRoot, 'panel', 'index.html');
  const originalHtml = fs.readFileSync(htmlPath, 'utf8');
  if (missingHtml) fs.rmSync(htmlPath);
  const runnerPath = path.join(tempRoot, 'runner.mjs');
  fs.writeFileSync(runnerPath, `
import assert from 'node:assert/strict';
assert.equal(process.env.XANDER_HOME, ${JSON.stringify(dataRoot)});
assert.equal(process.env.XANDER_SECRET_BACKEND, 'file');
const { startPanel } = await import('./plugin/panel/server.js');
const { address } = await startPanel({ port: 0, open: false });
process.send({ address });
`);
  child = spawn(process.execPath, ['--unhandled-rejections=strict', runnerPath], {
    cwd: tempRoot,
    env: { ...process.env, XANDER_HOME: dataRoot, XANDER_SECRET_BACKEND: 'file' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  const address = await new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('message', onMessage);
      if (error) reject(error); else resolve(value);
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) => finish(new Error(`Temporary panel exited before listening (${code ?? signal}): ${stderr}`));
    const onMessage = (message) => finish(null, message.address);
    const timer = setTimeout(() => finish(new Error(`Temporary panel startup timed out: ${stderr}`)), 5000);
    child.once('error', onError);
    child.once('exit', onExit);
    child.once('message', onMessage);
  });
  const url = new URL(address);
  const port = Number(url.port);
  const token = new URLSearchParams(url.hash.slice(1)).get('t');
  assert.ok(token, 'the temporary panel must issue its own token');
  const request = ({ target = '/', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: target, headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('Temporary panel request timed out')));
    req.on('error', (error) => reject(new Error(`Temporary panel request failed (${error.code || error.message}); child exit=${child.exitCode}, signal=${child.signalCode}: ${stderr}`)));
    req.end();
  });
  return { pluginRoot, htmlPath, originalHtml, child, port, token, request };
}

async function assertStateAndProtection(panel) {
  const goodHeaders = { 'x-xander-token': panel.token };
  const state = await panel.request({ target: '/api/state', headers: goodHeaders });
  assert.equal(state.status, 200, 'the API must remain usable while static files are unavailable');
  const parsed = JSON.parse(state.body);
  assert.deepEqual(parsed.stores, {}, 'the server must use only the empty temporary data home');
  assert.equal(parsed.settings.dryRun, true);
  assert.deepEqual(parsed.proposals, []);
  assert.deepEqual(parsed.ledger, []);
  assert.ok(parsed.switches.items.every((item) => item.on === false));
  assert.equal((await panel.request({ target: '/api/state' })).status, 401);
  assert.equal((await panel.request({ target: '/api/state', headers: { 'x-xander-token': 'synthetic-invalid-token' } })).status, 401);
  for (const target of ['/', '/api/state']) {
    assert.equal((await panel.request({ target, headers: { ...goodHeaders, host: 'untrusted.example' } })).status, 403);
  }
  assert.equal((await panel.request({ target: '/api/state', headers: { ...goodHeaders, host: `localhost:${panel.port}` } })).status, 200);
  assert.equal(panel.child.exitCode, null);
  assert.equal(panel.child.signalCode, null);
}

for (const resource of ['index.html', 'plugin directory']) {
  test(`panel serves its startup HTML after the temporary ${resource} is removed`, { timeout: 15000 }, async (t) => {
    const panel = await isolatedPanel(t);
    // Remove before the first HTTP request: a previous GET must not be required
    // to survive an upgrade that removes the running plugin's directory.
    fs.rmSync(resource === 'index.html' ? panel.htmlPath : panel.pluginRoot, { recursive: true });
    for (let i = 0; i < 2; i++) {
      const page = await panel.request();
      assert.equal(page.status, 200);
      assert.match(page.headers['content-type'], /^text\/html/);
      assert.equal(page.body, panel.originalHtml);
    }
    await assertStateAndProtection(panel);
  });
}

test('panel started without HTML returns a friendly 503 and recovers when the resource returns', { timeout: 15000 }, async (t) => {
  const panel = await isolatedPanel(t, { missingHtml: true });
  for (let i = 0; i < 2; i++) {
    const unavailable = await panel.request();
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.body, /面板|页面|资源|暂时|稍后|unavailable/i);
    assert.doesNotMatch(unavailable.body, /ENOENT|readFileSync|node:fs/);
    assert.ok(!unavailable.body.includes(panel.pluginRoot), 'error responses must not expose local file paths');
  }
  await assertStateAndProtection(panel);
  fs.writeFileSync(panel.htmlPath, panel.originalHtml);
  const restored = await panel.request();
  assert.equal(restored.status, 200);
  assert.equal(restored.body, panel.originalHtml);
  fs.rmSync(panel.htmlPath);
  const cachedAfterRecovery = await panel.request();
  assert.equal(cachedAfterRecovery.status, 200, 'the first successful recovery must cache HTML for later file removal');
  assert.equal(cachedAfterRecovery.body, panel.originalHtml);
  await assertStateAndProtection(panel);
});

test('malformed request URLs return a client error without terminating the temporary panel', { timeout: 15000 }, async (t) => {
  const panel = await isolatedPanel(t);
  for (const target of ['http://[', '//[', 'http://%']) {
    const invalid = await panel.request({ target });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.length > 0);
    assert.doesNotMatch(invalid.body, /node:internal|at new URL/);
    const page = await panel.request();
    assert.equal(page.status, 200);
    assert.equal(page.body, panel.originalHtml);
  }
  await assertStateAndProtection(panel);
});
