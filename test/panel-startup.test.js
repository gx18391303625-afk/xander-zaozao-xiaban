import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// node:test runs this file in its own worker process. No browser or real data home.
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xander-panel-startup-')));
process.env.XANDER_HOME = home;
process.env.XANDER_SECRET_BACKEND = 'file';
const { startPanel } = await import('../panel/server.js');
const nativeListeningListeners = http.createServer().listenerCount('listening');
after(() => {
  assert.equal(path.dirname(home), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(home), /^xander-panel-startup-/);
  fs.rmSync(home, { recursive: true, force: true });
});

for (const code of ['EACCES', 'EMFILE', 'EADDRNOTAVAIL', 'EADDRINUSE']) {
  test(`panel listen ${code} rejects instead of throwing in the shared Host`, { timeout: 2000 }, async () => {
    const original = http.Server.prototype.listen;
    let server;
    http.Server.prototype.listen = function () {
      server = this;
      process.nextTick(() => this.emit('error', Object.assign(new Error(`synthetic ${code}`), { code })));
      return this;
    };
    try {
      await assert.rejects(startPanel({ port: 0, open: false }), { code });
      assert.equal(server.listening, false);
      assert.equal(server.listenerCount('listening'), nativeListeningListeners);
      assert.equal(server.listenerCount('error'), 0);
    } finally { http.Server.prototype.listen = original; }
    assert.deepEqual(fs.readdirSync(home), [], 'startup must not access/create user configuration');
  });
}

test('panel releases failed fixed-port listeners before retrying on an ephemeral port', { timeout: 3000 }, async (t) => {
  const occupied = http.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const { server, address } = await startPanel({ port: occupied.address().port, open: false });
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.notEqual(new URL(address).port, String(occupied.address().port));
  assert.equal(server.listenerCount('listening'), nativeListeningListeners);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listening, true);
  assert.deepEqual(fs.readdirSync(home), []);
});
