// 凭证（令牌、密钥）存放：优先放进系统自带的保险箱，不放进任何会被同步或上传的文件。
//   macOS   → 钥匙串（security 命令）
//   Windows → DPAPI 加密（只有当前 Windows 用户能解开），密文存本地
//   Linux   → Secret Service（secret-tool），没有时退回本地文件
//   兜底    → 本地文件（权限 600），并在体检里提示
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { FILES, p } from './paths.js';
import { readJson, writeJson } from './jsonfile.js';

const SERVICE = 'xander-zaozao-xiaban';

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  return { ok: r.status === 0 && !r.error, out: (r.stdout || '').trim(), err: (r.stderr || r.error?.message || '').trim() };
}

function hasCmd(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

let cachedBackend = null;
export function backendName() {
  if (cachedBackend) return cachedBackend;
  const forced = process.env.XANDER_SECRET_BACKEND;
  if (forced) return (cachedBackend = forced);
  if (process.platform === 'darwin' && hasCmd('security')) return (cachedBackend = 'macos-keychain');
  if (process.platform === 'win32') return (cachedBackend = 'windows-dpapi');
  if (process.platform === 'linux' && hasCmd('secret-tool')) {
    // 无桌面环境时 secret-tool 存在但用不了，试一下
    const probe = run('secret-tool', ['lookup', 'service', SERVICE, 'account', '__probe__']);
    if (probe.ok || !/dbus|DBus|secret service/i.test(probe.err)) return (cachedBackend = 'linux-secret-service');
  }
  return (cachedBackend = 'file');
}

export function backendLabel() {
  return {
    'macos-keychain': 'macOS 钥匙串',
    'windows-dpapi': 'Windows DPAPI 加密',
    'linux-secret-service': 'Linux Secret Service',
    file: '本地文件（权限 600，未加密）',
  }[backendName()] || backendName();
}

// ---------- 各后端 ----------
const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const macos = {
  get(name) {
    const r = run('security', ['find-generic-password', '-a', name, '-s', SERVICE, '-w']);
    return r.ok ? r.out : null;
  },
  set(name, value) {
    // 通过 stdin 交给 security，避免密钥出现在进程列表里
    const cmd = `add-generic-password -U -a ${quote(name)} -s ${quote(SERVICE)} -w ${quote(value)}\n`;
    const r = run('security', ['-i'], cmd);
    if (!r.ok) throw new Error(`写入钥匙串失败：${r.err}`);
  },
  del(name) {
    run('security', ['delete-generic-password', '-a', name, '-s', SERVICE]);
  },
};

const dpapiFile = () => p('secrets.dpapi.json');
const windows = {
  get(name) {
    const store = readJson(dpapiFile(), {});
    if (!store[name]) return null;
    const ps = '$c=[Console]::In.ReadToEnd().Trim();$s=ConvertTo-SecureString $c;' +
      '[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))';
    const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], store[name]);
    if (!r.ok) throw new Error(`解密凭证失败：${r.err}`);
    return r.out;
  },
  set(name, value) {
    const b64 = Buffer.from(value, 'utf8').toString('base64');
    const ps = '$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()));' +
      'ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)';
    const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], b64);
    if (!r.ok || !r.out) throw new Error(`加密凭证失败：${r.err}`);
    const store = readJson(dpapiFile(), {});
    store[name] = r.out;
    writeJson(dpapiFile(), store);
  },
  del(name) {
    const store = readJson(dpapiFile(), {});
    delete store[name];
    writeJson(dpapiFile(), store);
  },
};

const linux = {
  get(name) {
    const r = run('secret-tool', ['lookup', 'service', SERVICE, 'account', name]);
    return r.ok && r.out ? r.out : null;
  },
  set(name, value) {
    const r = run('secret-tool', ['store', `--label=${SERVICE} ${name}`, 'service', SERVICE, 'account', name], value);
    if (!r.ok) throw new Error(`写入 Secret Service 失败：${r.err}`);
  },
  del(name) {
    run('secret-tool', ['clear', 'service', SERVICE, 'account', name]);
  },
};

const file = {
  get(name) {
    const store = readJson(FILES.fallbackSecrets(), {});
    return store[name] ?? null;
  },
  set(name, value) {
    const store = readJson(FILES.fallbackSecrets(), {});
    store[name] = value;
    writeJson(FILES.fallbackSecrets(), store, 0o600);
    try { fs.chmodSync(FILES.fallbackSecrets(), 0o600); } catch { /* Windows 忽略 */ }
  },
  del(name) {
    const store = readJson(FILES.fallbackSecrets(), {});
    delete store[name];
    writeJson(FILES.fallbackSecrets(), store, 0o600);
  },
};

function impl() {
  return { 'macos-keychain': macos, 'windows-dpapi': windows, 'linux-secret-service': linux, file }[backendName()] || file;
}

// ---------- 对外接口：存取 JSON 对象 ----------
export function getSecret(name) {
  const raw = impl().get(name);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setSecret(name, obj) {
  impl().set(name, JSON.stringify(obj));
}

export function deleteSecret(name) {
  impl().del(name);
}

// 给日志/输出用：把令牌之类的打码
export function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
