import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isolate } from './helpers.js';
isolate();
const { lockStore } = await import('../lib/execution-lock.js');
const { p } = await import('../lib/paths.js');
const { sha256, writeJson } = await import('../lib/jsonfile.js');

test('stale-lock recovery cannot delete a newly acquired live lock from an interleaved contender', () => {
  const store = 'synthetic-lock-race';
  const file = p('locks', `${sha256(store).slice(0, 24)}.lock`);
  const fakeDeadPid = 2147483000;
  writeJson(file, { pid: fakeDeadPid, at: '2000-01-01T00:00:00Z' });
  const unlink = fs.unlinkSync; const kill = process.kill;
  let interleaved = false; let firstUnlock; let firstError; let secondUnlock;
  process.kill = function (pid, signal) {
    if (pid === fakeDeadPid) throw Object.assign(new Error('Synthetic dead PID'), { code: 'ESRCH' });
    return kill.call(process, pid, signal);
  };
  fs.unlinkSync = function (target) {
    if (target === file && !interleaved) {
      interleaved = true;
      // Reproduce another process winning after a dead owner was observed,
      // but before this contender removes the stale path.
      try { firstUnlock = lockStore(store); } catch (e) { firstError = e; }
    }
    return unlink.call(fs, target);
  };
  let outerError;
  try { secondUnlock = lockStore(store); } catch (e) { outerError = e; }
  finally { fs.unlinkSync = unlink; process.kill = kill; }
  try {
    assert.ok(firstUnlock || secondUnlock || firstError || outerError);
    assert.ok(!(firstUnlock && secondUnlock), 'both contenders acquired a supposedly exclusive store lock');
  } finally {
    if (fs.existsSync(file)) {
      try { (secondUnlock || firstUnlock)?.(); } catch { /* cleanup only */ }
    }
  }
});
