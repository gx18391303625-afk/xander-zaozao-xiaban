#!/usr/bin/env node
// Local, opt-in plugin updater. It never calls marketplace business APIs or kills host processes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOKEN = () => crypto.randomUUID();
const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const error = (code, message) => Object.assign(new Error(message), { code });

function atomicJson(file, data) {
  const tmp = `${file}.${TOKEN()}.tmp`;
  try { fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}

export function command(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...options,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env } });
  if (result.error) return { status: -1, stdout: '', stderr: result.error.message };
  return { status: result.status ?? -1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function acquireLock(file, isAlive, pid) {
  const owner = { pid, token: TOKEN(), startedAt: new Date().toISOString() };
  try { fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    return () => { if (readJson(file)?.token === owner.token) fs.unlinkSync(file); };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const previous = readJson(file);
    if (!previous) {
      if (Date.now() - fs.statSync(file).mtimeMs < 30_000) return null; // Writer may still be filling the file.
      throw error('invalid-lock', `同步锁记录损坏：${file}。确认同步进程已退出后删除该锁，再重试。`);
    }
    if (isAlive(previous.pid)) return null;
    // Do not unlink another owner's lock: concurrent stale-lock reapers can otherwise erase a new lock.
    throw error('stale-lock', `旧同步进程已退出，但锁仍在：${file}。确认没有同步进程后删除该锁，再重试。`);
  }
}

function desktopNotice(message) {
  if (process.platform !== 'darwin') return;
  const script = 'on run argv\ndisplay notification (item 1 of argv) with title "Xander 插件同步"\nend run';
  if (command('/usr/bin/osascript', ['-e', script, message], { timeout: 5000 }).status !== 0) throw Error('notification unavailable');
}

function processSnapshot(run, repo, configuredRepo) {
  const result = run('/bin/ps', ['-axo', 'pid=,command=']);
  if (result.status !== 0) return { available: false, dsh: [], codex: [] };
  const rows = result.stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(.+)$/)).filter(Boolean);
  return { available: true,
    dsh: rows.filter(m => [repo, path.resolve(configuredRepo)].some(root => m[2].includes(`/node ${root}/server/index.js`) || m[2].startsWith(`node ${root}/server/index.js`))).map(m => Number(m[1])),
    codex: rows.filter(m => /\/Applications\/(?:ChatGPT|Codex)\.app\/Contents\/MacOS\//.test(m[2])).map(m => Number(m[1])) };
}

const runtimeFile = f => /^(cli|lib|server|panel|skills)\//.test(f) || ['package.json', 'plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'mcp.json', '.mcp.json'].includes(f);

export function runSync(input, dependencies = {}) {
  const config = { marketplace: 'xander-zaozao', plugin: 'xander-zaozao-xiaban', ...input };
  const run = dependencies.run || command;
  const notify = dependencies.notify || desktopNotice;
  const now = dependencies.now || (() => new Date().toISOString());
  const stateDir = path.resolve(config.stateDir || path.join(os.homedir(), '.dsh/xander'));
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const statusFile = path.join(stateDir, 'sync.status.json');
  let releaseLock, lockError;
  try { releaseLock = acquireLock(path.join(stateDir, 'sync.lock'), dependencies.isAlive || alive, dependencies.pid || process.pid); } catch (e) { lockError = e; }
  if (!releaseLock && !lockError) return { status: 'busy', exitCode: 0, message: '已有同步进程或刚创建的锁记录，本轮不执行。' };
  const previous = readJson(statusFile, {});
  const result = { schemaVersion: 1, checkedAt: now(), status: 'running', phase: lockError ? 'lock' : 'repository', lastSuccess: previous.lastSuccess || null, ...(previous.restart ? { restart: previous.restart } : {}) };
  let repo;
  const log = message => fs.appendFileSync(path.join(stateDir, 'sync.log'), `${result.checkedAt} ${message}\n`, { mode: 0o600 });
  const checked = (bin, args, code, message, options = {}) => {
    const reply = run(bin, args, options);
    if (reply.status !== 0) throw error(code, message);
    return reply.stdout.trim();
  };
  const git = (args, code = 'git-failed', message = 'Git 检查失败，请查看仓库状态。') => checked('git', ['-C', repo, ...args], code, message);
  try {
    if (lockError) throw lockError;
    if (!config.repo || !config.codex) throw error('configuration', '需要指定 --repo 和 --codex。');
    repo = fs.realpathSync(config.repo);
    const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], 'detached-head', '仓库不在本地分支上，请先选择有上游配置的分支。');
    const remote = git(['config', '--get', `branch.${branch}.remote`], 'missing-upstream', `分支 ${branch} 没有上游远端，请先配置 tracking branch。`);
    const mergeRef = git(['config', '--get', `branch.${branch}.merge`], 'missing-upstream', `分支 ${branch} 没有上游分支配置。`);
    if (!remote || remote === '.' || remote.startsWith('-') || !mergeRef.startsWith('refs/heads/') || mergeRef.includes('\n')) throw error('invalid-upstream', '只支持一个远端分支作为上游；请检查 branch.remote / branch.merge。');
    git(['remote', 'get-url', remote], 'missing-remote', '配置的上游远端不存在，请修正 Git tracking branch。');
    if (git(['status', '--porcelain', '--untracked-files=normal'])) throw error('dirty-worktree', '仓库有未提交或未跟踪的文件，已保留本地工作；请处理后再同步。');
    const before = git(['rev-parse', 'HEAD']);
    result.repo = { path: repo, branch, remote, remoteBranch: mergeRef.slice(11), beforeCommit: before };
    git(['fetch', '--quiet', '--no-tags', remote, mergeRef], 'fetch-failed', `无法获取 ${remote}/${mergeRef.slice(11)}，请检查网络和仓库访问权限；下次定时运行会重试。`);
    const target = git(['rev-parse', 'FETCH_HEAD^{commit}']);
    if (target !== before) {
      const ancestor = run('git', ['-C', repo, 'merge-base', '--is-ancestor', before, target]);
      if (ancestor.status !== 0) throw error('not-fast-forward', '本地提交与上游不一致，不能快进更新；已保留本地工作，请人工合并或确认分支。');
      // Apply precisely the fetched commit; do not perform another fetch through git pull.
      git(['merge', '--ff-only', '--quiet', target], 'merge-failed', '快进更新失败，未执行 Codex 安装；请检查仓库状态。');
    }
    const current = git(['rev-parse', 'HEAD']);
    if (current !== target) throw error('repository-changed', '同步期间仓库发生变化，停止安装并等待下次重试。');
    const manifest = readJson(path.join(repo, 'package.json'));
    if (!manifest?.version || manifest.name !== config.plugin) throw error('invalid-package', '仓库的插件名称或版本信息不匹配。');
    result.repo = { ...result.repo, commit: current, version: manifest.version, changed: current !== before };
    const files = git(['ls-files', '-z']).split('\0').filter(runtimeFile);
    if (!files.includes('server/index.js') || !files.includes('package.json')) throw error('invalid-package', '仓库缺少必需的插件运行文件。');
    const expected = new Map(files.map(f => [f, fs.readFileSync(path.join(repo, f))]));
    const verifyInstalled = installedPath => {
      if (!installedPath) return false;
      try { return [...expected].every(([f, bytes]) => fs.readFileSync(path.join(installedPath, f)).equals(bytes)); } catch { return false; }
    };
    result.phase = 'codex';
    const listed = checked(config.codex, ['plugin', 'list', '--json'], 'codex-list-failed', '无法读取 Codex 插件安装状态，请检查 Codex 路径后重试。');
    let registration;
    try { const list = JSON.parse(listed); if (!Array.isArray(list.installed)) throw Error('installed list missing'); registration = list.installed.find(p => p.pluginId === `${config.plugin}@${config.marketplace}`); }
    catch { throw error('codex-list-invalid', 'Codex 插件列表返回了无法校验的结果。'); }
    if (registration?.enabled === false) throw error('codex-plugin-disabled', 'Codex 中的 Xander 插件已停用，同步器不会擅自启用；请按需要在 Codex 中开启。');
    const old = previous.lastSuccess;
    let installedPath = old?.installedPath;
    const sameSource = old?.commit === current && old?.repo === repo && old?.marketplace === config.marketplace && old?.plugin === config.plugin;
    let installed = false;
    if (!sameSource || registration?.installed !== true || registration?.version !== manifest.version || !verifyInstalled(installedPath)) {
      const upgraded = checked(config.codex, ['plugin', 'marketplace', 'upgrade', config.marketplace, '--json'], 'codex-upgrade-failed', 'Codex 插件目录刷新失败；仓库更新已保留，下次重试安装。');
      let upgrade;
      try { upgrade = JSON.parse(upgraded); } catch { throw error('codex-upgrade-invalid', 'Codex 插件目录返回了无法校验的结果。'); }
      if (!Array.isArray(upgrade.errors) || upgrade.errors.length) throw error('codex-upgrade-failed', 'Codex 插件目录报告更新错误，下次重试。');
      const added = checked(config.codex, ['plugin', 'add', `${config.plugin}@${config.marketplace}`, '--json'], 'codex-install-failed', 'Codex 插件安装失败；仓库更新已保留，下次重试安装。');
      let installation;
      try { installation = JSON.parse(added); } catch { throw error('codex-install-invalid', 'Codex 插件安装返回了无法校验的结果。'); }
      installedPath = installation.installedPath;
      if (installation.version !== manifest.version || installation.name !== config.plugin || !path.isAbsolute(installedPath || '') || !verifyInstalled(installedPath)) throw error('codex-content-mismatch', 'Codex 安装内容与目标提交不一致，不能确认同步成功；请检查 marketplace 来源或版本缓存。');
      installed = true;
    }
    if (git(['rev-parse', 'HEAD']) !== current || git(['status', '--porcelain', '--untracked-files=normal'])) throw error('repository-changed', '安装期间仓库发生变化，停止确认成功，请重新运行。');
    result.codex = { version: manifest.version, installedPath, contentVerified: true, verifiedFiles: files.length, installed };
    result.phase = 'restart-guidance';
    const processes = processSnapshot(run, repo, config.repo);
    const sourceChanged = !sameSource || installed;
    const pending = previous.restart?.pendingProcesses || { dsh: [], codex: [] };
    const pendingProcesses = Object.fromEntries(['dsh', 'codex'].map(host => [host, !processes.available ? pending[host] : sourceChanged || previous.restart?.processInspectionAvailable === false ? processes[host] : pending[host].filter(pid => processes[host].includes(pid))]));
    result.restart = { processInspectionAvailable: processes.available, pendingProcesses, required: Object.values(pendingProcesses).some(pids => pids.length > 0), loadedVersionsVerified: false,
      note: processes.available ? '已安装文件不等于当前会话已重载；待当前任务结束后重开列出的宿主。同步器不会结束进程。' : '无法检查宿主进程；若更新时宿主正在运行，请在当前任务结束后重开。' };
    result.status = 'success'; result.phase = 'complete'; result.exitCode = 0;
    result.lastSuccess = { checkedAt: result.checkedAt, repo, commit: current, version: manifest.version, installedPath, marketplace: config.marketplace, plugin: config.plugin };
  } catch (e) {
    result.status = 'error'; result.exitCode = 1;
    result.error = { code: e.code || 'unexpected-error', message: e.code ? e.message : '同步检查发生异常；请检查目录权限、配置和日志后重试。' };
  }
  try {
    const noticeKey = result.status === 'error' ? `error:${result.phase}:${result.error.code}` : result.restart.required || !result.restart.processInspectionAvailable ? `restart:${result.lastSuccess.commit}` : `ok:${result.lastSuccess.commit}`;
    result.notificationKey = noticeKey;
    atomicJson(statusFile, result);
    // Preserve a readable compatibility summary; never record a loaded/applied version from disk alone.
    const summary = `${result.checkedAt} status=${result.status} dsh=${result.repo?.version || 'unknown'} codex=${result.codex?.version || 'unverified'}${result.error ? ` error=${result.error.code}` : ''}\n`;
    fs.writeFileSync(path.join(stateDir, 'sync.status'), summary, { mode: 0o600 });
    if (noticeKey !== previous.notificationKey) {
      const message = result.status === 'error' ? result.error.message : result.restart.required || !result.restart.processInspectionAvailable ? `文件已同步至 ${result.lastSuccess.version}；当前任务结束后重开 DSH / Codex，加载新版。` : `文件已同步至 ${result.lastSuccess.version}。`;
      log(message);
      try { notify(message); } catch { log('桌面通知未送达，请查看 sync.status.json。'); result.notificationKey = previous.notificationKey || null; result.notificationDelivery = 'failed'; atomicJson(statusFile, result); }
    }
  } finally { releaseLock?.(); }
  return result;
}

function cliOptions(args) {
  const options = {};
  const names = { '--repo': 'repo', '--codex': 'codex', '--state-dir': 'stateDir', '--marketplace': 'marketplace', '--plugin': 'plugin' };
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`参数无效：${args[i]}`);
    options[names[args[i]]] = args[i + 1];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = runSync(cliOptions(process.argv.slice(2))); console.log(JSON.stringify(result)); process.exitCode = result.exitCode; }
  catch (e) { console.error(`插件同步无法启动：${e.message}`); process.exitCode = 1; }
}
