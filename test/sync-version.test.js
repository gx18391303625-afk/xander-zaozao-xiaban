// scripts/sync-version.mjs：版本只认 package.json，其余清单和固定版本来源跟着改
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncVersion } from '../scripts/sync-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['package.json', 'plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'README.md', 'docs/dsh.md'];

test('仓库当前版本一致', () => {
  assert.deepEqual(syncVersion({ check: true }).stale, []);
});

test('升版本后同步全部清单与固定版本来源，历史版本说明不动', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-version-'));
  for (const f of FILES) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(dir, f)); }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const old = pkg.version;
  pkg.version = '99.0.1';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');

  assert.equal(syncVersion({ dir, check: true }).stale.length, 5);
  syncVersion({ dir });
  assert.deepEqual(syncVersion({ dir, check: true }).stale, []);
  for (const f of FILES.slice(1, 4)) assert.equal(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).version, '99.0.1', f);
  for (const f of ['README.md', 'docs/dsh.md']) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(`v${old}`), f);
  assert.ok(fs.readFileSync(path.join(dir, 'README.md'), 'utf8').includes('#v99.0.1'));
  assert.equal(readme.match(/v2\.5\.1/g)?.length, fs.readFileSync(path.join(dir, 'README.md'), 'utf8').match(/v2\.5\.1/g)?.length);
});
