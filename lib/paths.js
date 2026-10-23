// 所有本地数据的位置。默认放在用户主目录下的 .xander-zaozao 文件夹，
// 可以用环境变量 XANDER_HOME 改到别处（比如放进 OneDrive / iCloud 同步盘）。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function homeDir() {
  return process.env.XANDER_HOME || path.join(os.homedir(), '.xander-zaozao');
}

export function p(...parts) {
  return path.join(homeDir(), ...parts);
}

export function ensureHome() {
  const dirs = [homeDir(), p('reports'), p('proposals'), p('exports'), p('backups')];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return homeDir();
}

export const FILES = {
  config: () => p('config.json'),
  switches: () => p('switches.json'),
  archive: () => p('archive.db'),
  ledger: () => p('ledger.jsonl'),
  reportIndex: () => p('reports', 'index.json'),
  fallbackSecrets: () => p('secrets.local.json'),
};
