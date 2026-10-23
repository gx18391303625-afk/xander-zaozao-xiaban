import fs from 'node:fs';
import crypto from 'node:crypto';
import { p } from './paths.js';
import { sha256 } from './jsonfile.js';

// One writer per store, across MCP/panel processes. A dead owner's lock is
// recoverable; its proposal remains uncertain and is never resumed for writing.
export function lockStore(store) {
  const dir = p('locks');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = p('locks', `${sha256(store).slice(0, 24)}.lock`);
  const guard = `${file}.reclaim`;
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).token !== token) throw new Error('执行锁所有者已变化，拒绝释放其他进程的锁。');
        fs.unlinkSync(file);
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Serialize stale-lock reclamation, then re-read the owner inside guard.
      // An observed dead PID outside this guard is not enough to unlink safely.
      try { fs.mkdirSync(guard, { mode: 0o700 }); }
      catch { throw new Error('该店铺已有提案正在执行或执行锁正在恢复，请稍后再试；持续存在时检查 locks 目录。'); }
      let reclaimed = false;
      try {
        let owner;
        try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (err) {
          if (err.code === 'ENOENT') { reclaimed = true; continue; }
          throw new Error('执行锁不完整；请先核验未完成提案，再由用户检查 locks 目录。');
        }
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('执行锁无有效进程编号，拒绝写入。');
        try { process.kill(owner.pid, 0); }
        catch (err) {
          if (err.code === 'ESRCH') { fs.unlinkSync(file); reclaimed = true; }
        }
      } finally { fs.rmdirSync(guard); }
      if (!reclaimed) throw new Error('该店铺已有提案正在执行或核验，请等待完成后再操作。');
    }
  }
  throw new Error('无法取得店铺执行锁。');
}
