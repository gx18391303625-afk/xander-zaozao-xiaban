// 可选：把档案库加密后备份到“你自己的” AWS S3 存储桶。
// 加密在本机完成（AES-256-GCM，密钥由你的同步口令派生），S3 上只有密文；口令存在系统钥匙串里。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { request } from './http.js';
import { loadConfig } from './config.js';
import { getSecret } from './secrets.js';
import { p, FILES } from './paths.js';
import { snapshotTo, closeArchive } from './archive.js';

const MAGIC = Buffer.from('XZ1');

export function encrypt(buf, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}

export function decrypt(buf, passphrase) {
  if (!buf.subarray(0, 3).equals(MAGIC)) throw new Error('不是本工具加密的备份文件');
  const salt = buf.subarray(3, 19);
  const iv = buf.subarray(19, 31);
  const tag = buf.subarray(31, 47);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(47)), d.final()]);
  } catch {
    throw new Error('解密失败：同步口令不对，或文件已损坏。');
  }
}

// ---------- AWS Signature V4（只实现 S3 的 PUT/GET 对象） ----------
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const encSeg = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

export function signS3({ method, bucket, region, key, body = Buffer.alloc(0), accessKeyId, secretAccessKey, sessionToken, date = new Date(), endpoint, hostOverride, extraHeaders = {} }) {
  const pathStyle = bucket.includes('.') || !!endpoint;
  const host = hostOverride || (endpoint ? new URL(endpoint).host : pathStyle ? `s3.${region}.amazonaws.com` : `${bucket}.s3.${region}.amazonaws.com`);
  const uriPath = (pathStyle ? `/${bucket}/` : '/') + key.split('/').map(encSeg).join('/');
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = hash(body);
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  for (const [k, v] of Object.entries(extraHeaders)) headers[k.toLowerCase()] = String(v).trim();
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, uriPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `${endpoint ? new URL(endpoint).origin : `https://${host}`}${uriPath}`;
  return { url, headers };
}

function settings() {
  const cfg = loadConfig().sync || {};
  if (!cfg.enabled || !cfg.bucket || !cfg.region) throw new Error('还没开启云同步。运行 `xander setup` → 云备份（S3）。');
  const creds = getSecret('aws:sync');
  const pass = getSecret('sync:passphrase');
  if (!creds || !pass) throw new Error('缺少 AWS 凭证或同步口令，请重新运行 `xander setup` → 云备份（S3）。');
  return { ...cfg, creds, passphrase: pass.passphrase, endpoint: process.env.XANDER_S3_ENDPOINT };
}

async function s3(method, key, body) {
  const s = settings();
  const { url, headers } = signS3({ method, bucket: s.bucket, region: s.region, key, body, ...s.creds, endpoint: s.endpoint });
  const res = await request(url, { method, headers: { ...headers, ...(body ? { 'Content-Length': String(body.length) } : {}) }, body, raw: true, isWrite: method === 'PUT', timeoutMs: 120000 });
  return res;
}

export async function push() {
  const s = settings();
  const tmp = p('backups', `snapshot-${Date.now()}.db`);
  snapshotTo(tmp);
  const enc = encrypt(fs.readFileSync(tmp), s.passphrase);
  fs.unlinkSync(tmp);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await s3('PUT', `${s.prefix || ''}history/archive-${stamp}.enc`, enc);
  await s3('PUT', `${s.prefix || ''}archive-latest.enc`, enc);
  return { ok: true, bytes: enc.length, key: `${s.prefix || ''}archive-latest.enc`, history: `${s.prefix || ''}history/archive-${stamp}.enc` };
}

// 下载并解密到旁边，替换前先备份当前档案库
export async function pull({ replace = false } = {}) {
  const s = settings();
  const res = await s3('GET', `${s.prefix || ''}archive-latest.enc`);
  const buf = decrypt(Buffer.from(await res.arrayBuffer()), s.passphrase);
  const pulled = p('backups', `pulled-${Date.now()}.db`);
  fs.writeFileSync(pulled, buf, { mode: 0o600 });
  if (!replace) return { ok: true, file: pulled, note: '已下载到备份目录，尚未替换当前档案库。' };
  closeArchive();
  const cur = FILES.archive();
  if (fs.existsSync(cur)) fs.copyFileSync(cur, p('backups', `before-pull-${Date.now()}.db`));
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(cur + ext)) fs.unlinkSync(cur + ext);
  fs.copyFileSync(pulled, cur);
  return { ok: true, replaced: true, backupDir: path.dirname(pulled) };
}
