#!/usr/bin/env node
// 命令行入口：xander <命令>
import fs from 'node:fs';
import path from 'node:path';
import { c, title, ask } from './prompt.js';
import { VERSION } from '../lib/version.js';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`需要 Node.js 22.13 或更高版本，当前是 ${process.versions.node}。请到 https://nodejs.org 下载安装 LTS 版。`);
  process.exit(1);
}

const HELP = `${c.bold(`Xander（自用）早早下班小助手 v${VERSION}`)}

常用命令：
  xander setup              接入向导：店铺、广告、卖家精灵、云备份、紫鸟、安装到 Claude/Codex
  xander doctor             体检：逐项测试连接是否正常
  xander panel              打开写入开关面板（浏览器）
  xander switch list        在终端查看开关
  xander switch on <开关ID>  在终端打开某个开关（需要你手动确认）
  xander switch off <开关ID> / all-off
  xander archive list | show <店铺> [SKU] | import <店铺> <CSV文件> | export <店铺>
  xander sync push | pull [--replace]   加密备份档案库到你自己的 S3 / 从 S3 恢复
  xander log                查看最近的写入日志
  xander install            显示安装到 Claude / Codex 的方法
  xander mcp                启动 MCP 服务（由 Claude/Codex 自动调用，一般不用手动运行）
`;

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case undefined: case 'help': case '-h': case '--help': console.log(HELP); return;
    case '-v': case '--version': console.log(VERSION); return;
    case 'setup': return (await import('./setup.js')).setup();
    case 'install': return (await import('./setup.js')).installGuide();
    case 'doctor': return doctor();
    case 'panel': return panel();
    case 'switch': return switchCmd();
    case 'archive': return archiveCmd();
    case 'sync': return syncCmd();
    case 'log': return logCmd();
    case 'mcp': await import('../server/index.js'); return;
    default: console.log(`不认识的命令：${cmd}\n`); console.log(HELP); process.exitCode = 1;
  }
}

// ---------------- 体检 ----------------
async function doctor() {
  const { loadConfig } = await import('../lib/config.js');
  const { homeDir, ensureHome } = await import('../lib/paths.js');
  const { backendName, backendLabel, getSecret } = await import('../lib/secrets.js');
  const { accessToken, clearTokenCache } = await import('../lib/lwa.js');
  const { spapi } = await import('../lib/spapi.js');
  const { listProfiles } = await import('../lib/ads.js');
  const { listSwitches } = await import('../lib/switches.js');
  const ok = (s) => console.log(`  ${c.green('✓')} ${s}`);
  const bad = (s) => console.log(`  ${c.red('✗')} ${s}`);
  const warn = (s) => console.log(`  ${c.yellow('!')} ${s}`);

  title('基础');
  ok(`Node.js ${process.versions.node}`);
  ensureHome();
  try { fs.accessSync(homeDir(), fs.constants.W_OK); ok(`数据目录可写：${homeDir()}`); } catch { bad(`数据目录不可写：${homeDir()}`); }
  (backendName() === 'file' ? warn : ok)(`凭证保存方式：${backendLabel()}`);
  try { (await import('../lib/archive.js')).listStores(); ok('档案库正常'); } catch (e) { bad(`档案库：${e.message}`); }

  const cfg = loadConfig();
  clearTokenCache();
  for (const [alias, s] of Object.entries(cfg.stores)) {
    title(`店铺 ${alias}（${s.region}，站点 ${s.marketplaces?.join('、') || '-'}）`);
    const sp = getSecret(`spapi:${alias}`);
    if (!sp) warn('卖家接口：未接入（运行 xander setup）');
    else {
      try {
        await accessToken(sp, s.region);
        const parts = await spapi(alias, 'GET', '/sellers/v1/marketplaceParticipations');
        ok(`卖家接口：正常（开通 ${(parts?.payload || []).length} 个站点）`);
        if (!s.sellerId) warn('没有填写卖家 ID（Merchant Token），读写 Listing 会失败');
      } catch (e) { bad(`卖家接口：${e.message}`); }
    }
    const ad = getSecret(`ads:${alias}`);
    if (!ad) warn('广告接口：未接入');
    else {
      try {
        const pf = await listProfiles(alias);
        ok(`广告接口：正常（${pf.length} 个 profile；已绑定 ${Object.entries(s.ads?.profiles || {}).map(([k, v]) => `${k}→${v}`).join('、') || '无'}）`);
        const { listEntities } = await import('../lib/ads.js');
        for (const mp of Object.keys(s.ads?.profiles || {})) {
          try {
            const r = await listEntities(alias, 'sp.campaigns', { marketplace: mp, maxPages: 1 });
            ok(`广告 v1 统一接口（${mp}）：可读取，SP 活动 ${r.count}${r.complete ? '' : '+'} 个`);
          } catch (e) { bad(`广告 v1 统一接口（${mp}）：${e.message}`); }
        }
      } catch (e) { bad(`广告接口：${e.message}`); }
    }
  }
  if (!Object.keys(cfg.stores).length) warn('还没接入任何店铺，运行 xander setup');

  title('可选项');
  if (cfg.sync?.enabled) ok(`云备份：s3://${cfg.sync.bucket}/${cfg.sync.prefix}`); else console.log('  - 云备份：未开启');
  if (cfg.ziniao?.enabled) {
    const st = await (await import('../lib/ziniao.js')).status();
    (st.reachable ? ok : warn)(`紫鸟：${st.reachable ? `已连上，${st.stores.length} 个店铺` : st.error}`);
  } else console.log('  - 紫鸟：未配置');

  title('写入开关');
  const on = listSwitches().items.filter((x) => x.on);
  if (on.length) on.forEach((x) => warn(`已打开：${x.label}（${x.id}）`)); else ok('全部关闭（最安全）');
  console.log(c.dim(`\n设置：审批=${cfg.settings.approvalMode === 'panel' ? '面板' : '对话'}，演练模式=${cfg.settings.dryRun ? '开' : '关'}`));
}

// ---------------- 开关面板 ----------------
async function panel() {
  const { startPanel } = await import('../panel/server.js');
  const port = Number(args.find((a) => /^\d+$/.test(a)) || 8765);
  const { address } = await startPanel({ port, open: !args.includes('--no-open') });
  console.log(`${c.bold('开关面板已打开：')}\n  ${address}\n`);
  console.log(c.dim('浏览器没自动打开的话，复制上面整行网址。网址里带一次性口令，别发给别人。关掉这个终端窗口，面板就停止。'));
}

// ---------------- 终端开关 ----------------
async function switchCmd() {
  const { listSwitches, setSwitch, setAll } = await import('../lib/switches.js');
  const sub = args[0] || 'list';
  if (sub === 'list') {
    for (const it of listSwitches().items) {
      console.log(`${it.on ? c.green('● 开') : c.dim('○ 关')}  ${it.implemented ? '' : c.dim('[规划中] ')}${it.label}  ${c.dim(it.id)}`);
    }
    return;
  }
  // 打开开关必须是真人在终端里确认，AI 在后台跑命令时没有交互终端，会被拦下
  const needHuman = async (what) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('打开开关需要你本人在终端里操作（检测到非交互环境，已拒绝）。也可以用 xander panel。');
    }
    const a = await ask(`确认要${what}？请输入“确认”两个字`);
    if (a !== '确认') throw new Error('已取消');
  };
  if (sub === 'on') { const id = args[1]; if (!id) throw new Error('用法：xander switch on <开关ID>'); await needHuman(`打开 ${id}`); setSwitch(id, true, 'cli'); console.log(c.green(`已打开 ${id}`)); return; }
  if (sub === 'off') { const id = args[1]; if (!id) throw new Error('用法：xander switch off <开关ID>'); setSwitch(id, false, 'cli'); console.log(`已关闭 ${id}`); return; }
  if (sub === 'all-off') { setAll(false, { by: 'cli' }); console.log('已全部关闭'); return; }
  if (sub === 'all-on') { await needHuman('打开全部官方写入开关（不含紫鸟）'); setAll(true, { by: 'cli', includeSpecial: args.includes('--with-ziniao') }); console.log(c.green('已全部打开')); return; }
  throw new Error(`不认识的子命令：${sub}`);
}

// ---------------- 档案 ----------------
async function archiveCmd() {
  const ar = await import('../lib/archive.js');
  const sub = args[0] || 'list';
  if (sub === 'list') { console.table(ar.listStores()); return; }
  if (sub === 'show') { console.log(JSON.stringify(ar.overview(args[1], args[2] || null), null, 2)); return; }
  if (sub === 'import') {
    const [store, file] = args.slice(1);
    if (!store || !file) throw new Error('用法：xander archive import <店铺> <CSV文件>');
    const preview = ar.importCsv(store, path.resolve(file), { dryRun: true });
    console.log(`将导入 ${preview.wouldImport} 条，前几条：`);
    console.table(preview.sample);
    const a = await ask('确认导入？输入 y');
    if (a.toLowerCase() !== 'y') return console.log('已取消');
    console.log(ar.importCsv(store, path.resolve(file)));
    return;
  }
  if (sub === 'export') {
    const store = args[1];
    if (!store) throw new Error('用法：xander archive export <店铺>');
    const { toCsv } = await import('../lib/csv.js');
    const { p } = await import('../lib/paths.js');
    const ov = ar.overview(store);
    const rows = [['sku', 'field', 'value', 'unit', 'currency', 'effective_from', 'source', 'note']];
    for (const f of ov.storeFacts) rows.push(['', f.field, f.value, f.unit, f.currency, f.effective_from, f.source, f.note]);
    for (const pr of ov.products) for (const f of ar.factsFor(store, pr.sku)) rows.push([pr.sku, f.field, f.value, f.unit, f.currency, f.effective_from, f.source, f.note]);
    const out = p('exports', `${store}-archive-${new Date().toISOString().slice(0, 10)}.csv`);
    fs.writeFileSync(out, '﻿' + toCsv(rows));
    console.log(`已导出：${out}`);
    return;
  }
  throw new Error(`不认识的子命令：${sub}`);
}

async function syncCmd() {
  const s = await import('../lib/sync.js');
  if (args[0] === 'push') return console.log(await s.push());
  if (args[0] === 'pull') return console.log(await s.pull({ replace: args.includes('--replace') }));
  throw new Error('用法：xander sync push | pull [--replace]');
}

async function logCmd() {
  const { changeLog } = await import('../lib/proposals.js');
  for (const l of changeLog(Number(args[0]) || 50)) {
    console.log(`${l.at}  ${l.event}  ${l.op || ''} ${l.proposalId || ''} ${l.target ? JSON.stringify(l.target) : ''} ${l.error ? c.red(l.error) : ''}`);
  }
}

main().catch((e) => { console.error(c.red(`✗ ${e.message}`)); process.exitCode = 1; });
