import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

// Never touch the user's actual permissions, configuration or credentials.
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xander-settings-test-')));
const previousHome = process.env.XANDER_HOME;
process.env.XANDER_HOME = path.join(temporary, 'isolated-data');
const { createSettingsBridge, apply, inject } = await import('../dsh/settings.js');
const { listSwitches } = await import('../lib/switches.js');
const switchesFile = path.join(process.env.XANDER_HOME, 'switches.json');
const browserPeer = { principal: { kind: 'owner' }, signal: new AbortController().signal };
const apiPeer = { ...browserPeer };
const guest = { principal: { kind: 'guest' }, signal: browserPeer.signal };
const connection = {
  browserPeer,
  admit(req) {
    const kind = req.headers['x-test-peer'];
    if (kind === 'missing') return { rejection: 401 };
    if (kind === 'cross-site') return { rejection: 403 };
    return { peer: kind === 'api' ? apiPeer : kind === 'guest' ? guest : browserPeer };
  },
};
const bridges = [];
const servers = [];
after(async () => {
  await Promise.all(bridges.map(bridge => bridge.dispose()));
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (previousHome === undefined) delete process.env.XANDER_HOME; else process.env.XANDER_HOME = previousHome;
  assert.equal(path.dirname(temporary), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(temporary), /^xander-settings-test-/);
  fs.rmSync(temporary, { recursive: true, force: true });
});

async function fixture(options) {
  const bridge = createSettingsBridge(connection, options);
  bridges.push(bridge);
  const routes = new Map(bridge.routes.map(route => [route.path, route.handler]));
  const server = http.createServer((req, res) => {
    const handler = routes.get(req.url);
    if (!handler) { res.writeHead(404); res.end(); } else void handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}/xander-settings/api`;
  const request = async (action, { method = 'GET', body, csrf, headers = {} } = {}) => {
    const response = await fetch(`${base}/${action}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-Xander-CSRF': csrf } : {}), ...headers },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
  return { bridge, request, base };
}

let real;
test('settings activation/read are side-effect free and expose no secrets or agent tools', async () => {
  real = await fixture();
  assert.equal(fs.existsSync(switchesFile), false);
  const state = await real.request('state');
  assert.equal(state.status, 200);
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.equal(state.headers.get('access-control-allow-origin'), null);
  assert.equal(state.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(state.data.switches.items.length, listSwitches().items.length);
  assert.ok(state.data.switches.items.every(row => !row.on));
  assert.match(state.data.revision, /^[a-f0-9]{64}$/);
  assert.ok(state.data.csrfToken.length >= 32);
  assert.deepEqual(Object.keys(state.data).sort(), ['csrfToken', 'revision', 'switches', 'version']);
  assert.equal(fs.existsSync(switchesFile), false);
  assert.deepEqual(inject, ['webServer', 'connection']);
});

test('authentication, request trust, browser identity and allowed methods gate every route', async () => {
  for (const action of ['state', 'switch', 'open']) {
    for (const [peer, expected] of [['missing', 401], ['cross-site', 403], ['api', 403], ['guest', 403]]) {
      const response = await real.request(action, { headers: { 'X-Test-Peer': peer } });
      assert.equal(response.status, expected, `${action}/${peer}`);
    }
    const response = await real.request(action, { method: action === 'state' ? 'POST' : 'GET' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), action === 'state' ? 'GET' : 'POST');
  }
  assert.equal(fs.existsSync(switchesFile), false);
});

test('CSRF, schema, planned capabilities and body size fail closed without writes', async () => {
  const { data: state } = await real.request('state');
  const id = state.switches.items.find(row => row.implemented).id;
  const valid = { id, on: true, expectedRevision: state.revision };
  for (const csrf of [undefined, 'invalid', 'é'.repeat(state.csrfToken.length)]) {
    assert.equal((await real.request('switch', { method: 'POST', body: valid, csrf })).status, 403);
  }
  const csrf = state.csrfToken;
  const invalid = [
    {}, { ...valid, on: 'false' }, { ...valid, on: 1 }, { ...valid, id: '__proto__' },
    { ...valid, id: 'not.a.real.switch' }, { ...valid, expectedRevision: '' },
    { ...valid, by: 'panel' }, { ...valid, approved: true }, [], null, '{bad json',
  ];
  const planned = state.switches.items.find(row => !row.implemented);
  if (planned) invalid.push({ ...valid, id: planned.id });
  for (const body of invalid) {
    const response = await real.request('switch', { method: 'POST', body, csrf });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal((await real.request('switch', { method: 'POST', body: valid, csrf, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await real.request('switch', { method: 'POST', body: 'x'.repeat(5000), csrf })).status, 413);
  assert.equal(fs.existsSync(switchesFile), false);
});

test('one isolated switch change reuses the original store and audit; stale requests never overwrite', async () => {
  const { data: before } = await real.request('state');
  const id = before.switches.items.find(row => row.implemented).id;
  const body = { id, on: true, expectedRevision: before.revision };
  const changed = await real.request('switch', { method: 'POST', body, csrf: before.csrfToken });
  assert.equal(changed.status, 200);
  assert.equal(listSwitches().items.find(row => row.id === id).on, true);
  const stored = JSON.parse(fs.readFileSync(switchesFile, 'utf8'));
  assert.equal(stored.history.length, 1);
  assert.equal(stored.history[0].by, 'dsh-settings');
  assert.equal(stored.history[0].id, id);
  assert.notEqual(changed.data.revision, before.revision);
  const conflict = await real.request('switch', { method: 'POST', body: { ...body, on: false }, csrf: before.csrfToken });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.state.revision, changed.data.revision);
  const same = await real.request('switch', { method: 'POST', body: { ...body, expectedRevision: changed.data.revision }, csrf: before.csrfToken });
  assert.equal(same.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(switchesFile, 'utf8')).history.length, 1, 'no-op must not create an audit write');
});

test('write and read failures are visible and never retried', async () => {
  let writes = 0;
  const fixtureData = { items: [{ id: 'fixture', implemented: true, on: false }], limits: {} };
  const fixtureA = await fixture({ read: () => structuredClone(fixtureData), write: () => { writes++; throw new Error('synthetic disk failure'); } });
  const { data: state } = await fixtureA.request('state');
  const response = await fixtureA.request('switch', { method: 'POST', csrf: state.csrfToken, body: { id: 'fixture', on: true, expectedRevision: state.revision } });
  assert.equal(response.status, 500);
  assert.match(response.data.error, /synthetic disk failure/);
  assert.equal(writes, 1);
  const fixtureB = await fixture({ read: () => { throw new Error('synthetic unreadable state'); } });
  assert.equal((await fixtureB.request('state')).status, 500);
});

test('complete panel opens lazily once and closes with the bridge, without changing switches', async () => {
  let opens = 0, closes = 0;
  const before = fs.readFileSync(switchesFile, 'utf8');
  const fixtureA = await fixture({ openPanel: async () => {
    opens++;
    return { address: 'http://127.0.0.1:12345/#t=synthetic', server: { closeAllConnections() {}, close(done) { closes++; done(); } } };
  } });
  const { data: state } = await fixtureA.request('state');
  assert.equal(opens, 0);
  for (let n = 0; n < 2; n++) {
    const response = await fixtureA.request('open', { method: 'POST', body: {}, csrf: state.csrfToken });
    assert.equal(response.status, 200);
    assert.equal(response.data.address, 'http://127.0.0.1:12345/#t=synthetic');
  }
  assert.equal(opens, 1);
  await fixtureA.bridge.dispose();
  assert.equal(closes, 1);
  assert.equal((await fixtureA.request('state')).status, 403);
  assert.equal(fs.readFileSync(switchesFile, 'utf8'), before);
});

test('panel startup failure returns an error, permits a later user retry and never blocks disposal', { timeout: 2000 }, async () => {
  let opens = 0;
  const fixtureA = await fixture({ openPanel: async () => {
    opens++;
    throw Object.assign(new Error('synthetic listen failure'), { code: 'EACCES' });
  } });
  const { data: state } = await fixtureA.request('state');
  for (let n = 0; n < 2; n++) {
    const response = await fixtureA.request('open', { method: 'POST', body: {}, csrf: state.csrfToken });
    assert.equal(response.status, 500);
    assert.match(response.data.error, /synthetic listen failure/);
    assert.equal(opens, n + 1, 'only the explicit user request retries panel startup');
  }
  await fixtureA.bridge.dispose();
});

test('unload or lost browser authority while reading a request prevents a late write', async () => {
  for (const stop of ['dispose', 'abort']) {
    let writes = 0;
    const controller = new AbortController();
    const peer = { principal: { kind: 'owner' }, signal: controller.signal };
    const bridge = createSettingsBridge({ browserPeer: peer, admit: () => ({ peer }) }, {
      read: () => ({ items: [{ id: 'fixture', implemented: true, on: false }], limits: {} }),
      write: () => { writes++; },
    });
    const response = () => ({ setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } });
    const initial = response();
    await bridge.routes[0].handler({ method: 'GET', headers: {} }, initial);
    const req = new PassThrough();
    req.method = 'POST';
    req.headers = { 'content-type': 'application/json', 'x-xander-csrf': initial.body.csrfToken };
    const res = response();
    const pending = bridge.routes[1].handler(req, res);
    if (stop === 'dispose') await bridge.dispose(); else controller.abort();
    req.end(JSON.stringify({ id: 'fixture', on: true, expectedRevision: initial.body.revision }));
    await pending;
    assert.equal(res.status, 403);
    assert.equal(writes, 0);
    await bridge.dispose();
  }
});

test('Client manifest ships native settings resources without changing business entrypoints', () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.exports['./settings'], './dsh/settings.js');
  assert.equal(pkg.exports['./client'], './dsh/client.js');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.dsh.client.immediately, true);
  assert.equal(pkg.main, './dsh/index.js');
  const client = fs.readFileSync(new URL('dsh/client.js', root), 'utf8');
  assert.match(client, /name: 'settings.section', id: 'xander'/);
  assert.match(client, /name: 'settings.section.icon', id: 'xander'/);
  assert.match(client, /role: 'switch'/);
  assert.match(client, /prefers-reduced-motion/);
  assert.match(client, /position: sticky/);
  assert.match(client, /window\.open\(address, '_blank', 'noopener,noreferrer'\)/, 'Desktop must receive the validated HTTP URL, not only about:blank');
  assert.doesNotMatch(client, /require\(['"]@deepseek-ai\//);
  assert.doesNotMatch(client, /document\.body|<iframe|createElement\(['"]iframe/);
});

test('Host registers only three exact routes and retracts them on unload or partial failure', async () => {
  const routes = new Map();
  let dispose;
  apply({ connection, webServer: { register(route) {
    assert.equal(route.kind, 'exact');
    routes.set(route.path, route);
    return () => routes.delete(route.path);
  } }, effect(register) { dispose = register(); } });
  assert.equal(routes.size, 3);
  await dispose();
  assert.equal(routes.size, 0);
  assert.throws(() => apply({ connection, webServer: { register(route) {
    if (routes.size === 1) throw new Error('synthetic route conflict');
    routes.set(route.path, route);
    return () => routes.delete(route.path);
  } }, effect(register) { register(); } }), /synthetic route conflict/);
  assert.equal(routes.size, 0);
});
