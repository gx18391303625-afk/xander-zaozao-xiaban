#!/usr/bin/env node
// 版本号只认 package.json；其他清单和文档里的固定版本来源由本脚本同步。
// node scripts/sync-version.mjs          同步
// node scripts/sync-version.mjs --check  只检查，不一致时退出码 1（CI 用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFESTS = ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json'];
// 文档里只认固定版本来源的写法，避免误改“从 v2.5.1 起支持”这类历史版本说明。
const V = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const pin = (before, after = '') => new RegExp(`(${before})${V}(${after})`, 'g');
const DOCS = {
  'README.md': [pin('xander-zaozao-xiaban#v')],
  'docs/dsh.md': [
    pin('根包 `xander-zaozao-xiaban` \\*\\*'),
    pin('### 固定版本来源：v'),
    pin('xander-zaozao-xiaban#v'),
    pin('releases/download/v'),
    pin('xander-zaozao-xiaban-', '\\.tgz'),
    pin('\\[v', ' 发布页\\]'),
    pin('releases/tag/v'),
  ],
};

export function syncVersion({ check = false, dir = root } = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  const stale = [];
  for (const file of MANIFESTS) {
    const full = path.join(dir, file);
    const text = fs.readFileSync(full, 'utf8');
    const json = JSON.parse(text);
    if (json.version === version) continue;
    stale.push(`${file}: ${json.version}`);
    if (!check) fs.writeFileSync(full, text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
  }
  for (const [file, patterns] of Object.entries(DOCS)) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    let next = text;
    for (const re of patterns) next = next.replace(re, `$1${version}$2`);
    if (next === text) continue;
    stale.push(file);
    if (!check) fs.writeFileSync(full, next);
  }
  return { version, stale };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { version, stale } = syncVersion({ check });
  if (!stale.length) console.log(`版本一致：${version}`);
  else if (check) { console.error(`以下文件版本与 package.json（${version}）不一致：\n  ${stale.join('\n  ')}\n请运行 node scripts/sync-version.mjs`); process.exit(1); }
  else console.log(`已同步到 ${version}：\n  ${stale.join('\n  ')}`);
}
