import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 每个测试文件一个独立的临时数据目录；凭证用文件后端，不碰系统钥匙串
export function isolate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-test-'));
  process.env.XANDER_HOME = dir;
  process.env.XANDER_SECRET_BACKEND = 'file';
  return dir;
}
