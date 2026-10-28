import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { command, runSync } from '../scripts/sync-plugin.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-sync-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, 'upstream'), repo = path.join(root, 'local repo'), stateDir = path.join(root, 'state'), installed = path.join(root, 'installed');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  fs.mkdirSync(upstream); git(upstream, 'init', '-b', 'release-line');
  git(upstream, 'config', 'user.name', 'Synthetic'); git(upstream, 'config', 'user.email', 'synthetic@example.invalid');
  const put = (cwd, file, content) => { const p = path.join(cwd, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  for (const f of ['package.json', 'plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) put(upstream, f, JSON.stringify({ name: 'xander-zaozao-xiaban', version: '9.0.0' }));
  put(upstream, 'server/index.js', '// synthetic server'); put(upstream, 'lib/a.js', 'export const n = 1;'); put(upstream, 'skills/a/SKILL.md', '# synthetic skill');
  git(upstream, 'add', '.'); git(upstream, 'commit', '-qm', 'synthetic initial');
  execFileSync('git', ['clone', '-q', upstream, repo]);
  git(repo, 'config', 'user.name', 'Synthetic'); git(repo, 'config', 'user.email', 'synthetic@example.invalid');
  git(repo, 'remote', 'rename', 'origin', 'z-tracked'); git(repo, 'remote', 'add', 'a-decoy', path.join(root, 'not-the-upstream'));
  git(repo, 'branch', '-m', 'local-name');
  const state = { calls: [], notices: [], failure: null, registered: null, ps: true, running: true };
  const run = (bin, args, options) => {
    state.calls.push({ bin, args: [...args] });
    if (bin === 'git') {
      if (args.includes('fetch') && state.failure === 'fetch') return { status: 128, stdout: '', stderr: 'synthetic network unavailable' };
      if (args.includes('merge') && state.failure === 'merge') return { status: 1, stdout: '', stderr: 'synthetic merge failure' };
      return command(bin, args, options);
    }
    if (bin === '/bin/ps') return state.ps ? { status: 0, stdout: state.running ? `123 /synthetic/node ${repo}/server/index.js\n124 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n` : '', stderr: '' } : { status: 1, stdout: '', stderr: '' };
    assert.equal(bin, '/synthetic/codex');
    if (args[1] === 'list') return { status: 0, stdout: JSON.stringify({ installed: state.registered ? [state.registered] : [] }), stderr: '' };
    if (args[1] === 'marketplace') return { status: state.failure === 'upgrade' ? 1 : 0, stdout: JSON.stringify({ errors: state.failure === 'upgrade-json' ? ['synthetic error'] : [] }), stderr: '' };
    assert.equal(args[1], 'add');
    if (state.failure === 'install') return { status: 1, stdout: '', stderr: 'synthetic install failure' };
    fs.rmSync(installed, { recursive: true, force: true }); fs.mkdirSync(installed);
    for (const f of git(repo, 'ls-files', '-z').split('\0').filter(Boolean)) { const target = path.join(installed, f); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, f), target); }
    const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'))).version;
    state.registered = { pluginId: 'xander-zaozao-xiaban@xander-zaozao', installed: true, enabled: true, version };
    if (state.failure === 'content') fs.writeFileSync(path.join(installed, 'lib/a.js'), 'wrong bytes');
    return { status: 0, stdout: JSON.stringify({ name: 'xander-zaozao-xiaban', version: state.failure === 'version' ? '1.0.0' : version, installedPath: installed }), stderr: '' };
  };
  const config = { repo, codex: '/synthetic/codex', stateDir };
  const deps = { run, notify: message => state.notices.push(message) };
  const sync = () => runSync(config, deps);
  const update = (file = 'lib/a.js', content = 'export const n = 2;') => { put(upstream, file, content); git(upstream, 'add', '.'); git(upstream, 'commit', '-qm', 'synthetic update'); };
  return { root, upstream, repo, stateDir, installed, git, put, state, config, deps, sync, update };
}

test('sync follows configured upstream remote and branch, fetches once and verifies actual installation', t => {
  const f = fixture(t); f.update(); const r = f.sync();
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.equal(r.repo.remote, 'z-tracked'); assert.equal(r.repo.remoteBranch, 'release-line');
  assert.equal(r.repo.branch, 'local-name'); assert.equal(r.repo.commit, f.git(f.upstream, 'rev-parse', 'HEAD'));
  assert.equal(r.codex.contentVerified, true); assert.equal(r.codex.verifiedFiles, 7);
  const fetches = f.state.calls.filter(c => c.args.includes('fetch')); assert.equal(fetches.length, 1);
  assert.deepEqual(fetches[0].args.slice(-2), ['z-tracked', 'refs/heads/release-line']);
  assert.ok(!f.state.calls.some(c => c.args.includes('pull') || c.bin === 'kill'));
  assert.deepEqual(f.state.calls.filter(c => c.bin === '/synthetic/codex').map(c => c.args[1]), ['list', 'marketplace', 'add']);
  assert.deepEqual(r.restart.pendingProcesses, { dsh: [123], codex: [124] }); assert.equal(r.restart.loadedVersionsVerified, false);
  assert.ok(!fs.existsSync(path.join(f.stateDir, '.applied-version')));
});

test('network failure is nonzero, preserves last success, deduplicates notice, then recovers', t => {
  const f = fixture(t); const before = f.sync(); f.update(); f.state.failure = 'fetch'; f.state.calls.length = 0;
  const failed = f.sync(); assert.equal(failed.exitCode, 1); assert.equal(failed.error.code, 'fetch-failed');
  assert.deepEqual(failed.lastSuccess, before.lastSuccess); assert.ok(!f.state.calls.some(c => c.bin === '/synthetic/codex'));
  assert.deepEqual(failed.restart, before.restart, 'failure cannot erase pending restart guidance');
  const n = f.state.notices.length; f.sync(); assert.equal(f.state.notices.length, n);
  assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), before.repo.commit);
  f.state.failure = null; const recovered = f.sync(); assert.equal(recovered.exitCode, 0); assert.notEqual(recovered.lastSuccess.commit, before.lastSuccess.commit);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.stateDir, 'sync.status.json'))).status, 'success');
});

test('dirty files, detached HEAD and missing upstream stop before fetch without discarding work', t => {
  const f = fixture(t); f.put(f.repo, 'my-notes.txt', 'keep me');
  assert.equal(f.sync().error.code, 'dirty-worktree'); assert.equal(fs.readFileSync(path.join(f.repo, 'my-notes.txt'), 'utf8'), 'keep me');
  fs.unlinkSync(path.join(f.repo, 'my-notes.txt')); f.git(f.repo, 'checkout', '--detach', '-q');
  assert.equal(f.sync().error.code, 'detached-head'); f.git(f.repo, 'checkout', '-q', 'local-name'); f.git(f.repo, 'branch', '--unset-upstream');
  assert.equal(f.sync().error.code, 'missing-upstream'); assert.ok(!f.state.calls.some(c => c.args.includes('fetch')));
});

test('local ahead or diverged commits are retained and require manual reconciliation', t => {
  const f = fixture(t); f.put(f.repo, 'lib/local.js', '// keep local'); f.git(f.repo, 'add', '.'); f.git(f.repo, 'commit', '-qm', 'local work');
  const head = f.git(f.repo, 'rev-parse', 'HEAD'); assert.equal(f.sync().error.code, 'not-fast-forward');
  f.update(); assert.equal(f.sync().error.code, 'not-fast-forward'); assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), head);
  assert.ok(!f.state.calls.some(c => c.bin === '/synthetic/codex'));
});

test('merge failure cannot become a successful Codex sync', t => {
  const f = fixture(t); f.update(); f.state.failure = 'merge';
  const r = f.sync(); assert.equal(r.error.code, 'merge-failed'); assert.equal(r.lastSuccess, null); assert.ok(!f.state.calls.some(c => c.bin === '/synthetic/codex'));
});

for (const [mode, code] of [['upgrade', 'codex-upgrade-failed'], ['upgrade-json', 'codex-upgrade-failed'], ['install', 'codex-install-failed'], ['version', 'codex-content-mismatch'], ['content', 'codex-content-mismatch']]) {
  test(`Codex ${mode} failure preserves last success and is retried`, t => {
    const f = fixture(t); const first = f.sync(); f.update(); f.state.failure = mode;
    const r = f.sync(); assert.equal(r.exitCode, 1); assert.equal(r.error.code, code); assert.deepEqual(r.lastSuccess, first.lastSuccess);
    assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), f.git(f.upstream, 'rev-parse', 'HEAD'), 'successful repo update is retained');
    f.state.failure = null; const recovered = f.sync(); assert.equal(recovered.status, 'success'); assert.equal(recovered.codex.installed, true);
  });
}

test('same-version commit changes and cache tampering trigger verified reinstall', t => {
  const f = fixture(t); const first = f.sync(); f.update('skills/a/SKILL.md', '# new documentation, same version');
  const changed = f.sync(); assert.equal(changed.repo.version, first.repo.version); assert.notEqual(changed.repo.commit, first.repo.commit); assert.equal(changed.codex.installed, true);
  fs.writeFileSync(path.join(f.installed, 'lib/a.js'), '// tampered'); assert.equal(f.sync().codex.installed, true);
  f.state.calls.length = 0; f.sync(); assert.equal(f.state.calls.filter(c => c.bin === '/synthetic/codex').length, 1, 'only inspect registration when verified source and contents match');
});

test('removed registration is reinstalled; deliberately disabled plugin stays disabled', t => {
  const f = fixture(t); f.sync(); f.state.registered = null; assert.equal(f.sync().codex.installed, true);
  f.state.registered.enabled = false; f.state.calls.length = 0; const r = f.sync();
  assert.equal(r.error.code, 'codex-plugin-disabled'); assert.ok(!f.state.calls.some(c => c.args[1] === 'add'));
});

test('unchanged sync deduplicates restart notice and never kills active processes', t => {
  const f = fixture(t); f.sync(); const n = f.state.notices.length; const r = f.sync(); assert.equal(f.state.notices.length, n); assert.equal(r.restart.required, true);
  f.state.running = false; const idle = f.sync(); assert.equal(idle.restart.required, false); assert.equal(idle.restart.loadedVersionsVerified, false);
  assert.ok(!f.state.calls.some(c => /kill|pkill|launchctl/.test(c.bin)));
});

test('process inspection failure is visible and recommends reload without claiming a loaded version', t => {
  const f = fixture(t); f.state.ps = false; const r = f.sync(); assert.equal(r.status, 'success');
  assert.equal(r.restart.processInspectionAvailable, false); assert.equal(r.restart.loadedVersionsVerified, false); assert.match(f.state.notices[0], /重开/);
});

test('concurrent updater is skipped; a stale lock fails visibly until manually removed', t => {
  const f = fixture(t); fs.mkdirSync(f.stateDir); const lock = path.join(f.stateDir, 'sync.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 12345, token: 'synthetic-owner' }));
  assert.equal(runSync(f.config, { ...f.deps, isAlive: () => true }).status, 'busy'); assert.equal(f.state.calls.length, 0);
  const blocked = runSync(f.config, { ...f.deps, isAlive: () => false }); assert.equal(blocked.error.code, 'stale-lock'); assert.equal(blocked.exitCode, 1); assert.ok(fs.existsSync(lock));
  fs.unlinkSync(lock); assert.equal(f.sync().status, 'success'); assert.ok(!fs.existsSync(lock));
});

test('an old malformed lock produces an actionable failure instead of silently skipping forever', t => {
  const f = fixture(t); fs.mkdirSync(f.stateDir); const lock = path.join(f.stateDir, 'sync.lock'); fs.writeFileSync(lock, ''); fs.utimesSync(lock, 1, 1);
  const r = f.sync(); assert.equal(r.exitCode, 1); assert.equal(r.error.code, 'invalid-lock'); assert.ok(fs.existsSync(lock)); assert.equal(f.state.notices.length, 1);
});

test('failed desktop notifications are logged and retried next run', t => {
  const f = fixture(t); let attempts = 0; const dependencies = { ...f.deps, notify: () => { attempts++; throw Error('synthetic denied'); } };
  const first = runSync(f.config, dependencies); assert.equal(first.status, 'success'); assert.equal(first.notificationDelivery, 'failed');
  runSync(f.config, dependencies); assert.equal(attempts, 2);
});
