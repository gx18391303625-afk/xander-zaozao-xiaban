// 接入向导：一步步把店铺、广告、卖家精灵、云备份、紫鸟接上。每接好一项立刻联网测试。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask, askSecret, choose, confirm, c, title } from './prompt.js';
import { loadConfig, updateConfig } from '../lib/config.js';
import { setSecret, getSecret, backendLabel } from '../lib/secrets.js';
import { accessToken, exchangeCode, clearTokenCache } from '../lib/lwa.js';
import { MARKETPLACES, ADS_AUTH_URLS, marketplace, marketplaceById } from '../lib/regions.js';
import { spapi } from '../lib/spapi.js';
import { listProfiles, listAdvertiserAccounts } from '../lib/ads.js';
import { ensureHome, homeDir } from '../lib/paths.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function setup() {
  ensureHome();
  console.log(c.bold('\nXander（自用）早早下班小助手 · 接入向导'));
  console.log(c.dim(`数据目录：${homeDir()}    凭证保存在：${backendLabel()}`));
  console.log(c.dim('凭证保存在本机；授权和业务请求会访问你所选的接口，业务数据也会按宿主所选模型传输。密钥只在你自己的终端输入，不要贴到聊天里。随时按 Ctrl+C 退出。'));
  for (;;) {
    const cfg = loadConfig();
    const stores = Object.keys(cfg.stores);
    const pick = await choose('想接入哪一项？', [
      { label: `店铺数据（卖家接口 SP-API）${stores.length ? c.dim(`  已接：${stores.join('、')}`) : ''}`, value: 'spapi' },
      { label: '广告数据（Amazon Ads API）', value: 'ads' },
      { label: '卖家精灵 MCP（关键词/竞品数据，可选）', value: 'sellersprite' },
      { label: '云备份档案库（你自己的 AWS S3，可选）', value: 'sync' },
      { label: '紫鸟浏览器（官方接口做不到时兜底，可选）', value: 'ziniao' },
      { label: '安装到 Claude / Codex / DSH（显示安装方法）', value: 'install' },
      { label: '偏好设置（审批方式、演练模式）', value: 'settings' },
      { label: '退出', value: 'exit' },
    ]);
    try {
      if (pick === 'exit') return;
      if (pick === 'spapi') await setupSpapi();
      if (pick === 'ads') await setupAds();
      if (pick === 'sellersprite') sellerSpriteGuide();
      if (pick === 'sync') await setupSync();
      if (pick === 'ziniao') await setupZiniao();
      if (pick === 'install') installGuide();
      if (pick === 'settings') await setupSettings();
    } catch (e) {
      console.log(c.red(`\n✗ ${e.message}`));
      console.log(c.dim('可以重新选择这一项再试。详细说明见 docs/新手接入教程.md'));
    }
  }
}

// ---------------- 卖家接口 ----------------
async function setupSpapi() {
  title('接入店铺数据（SP-API 私有应用自授权）');
  console.log(`你需要先在卖家后台准备好一个“私有开发者应用”。没做过的话按这几步：
  1. 卖家后台 → 右上角“设置/应用和服务” → “开发应用”（Develop Apps），注册开发者资料，选“私有开发者”（只给自己店铺用）。
  2. 审核通过后“添加新应用客户端”，API 类型选 SP API，勾选你需要的角色（至少：商品列表、库存与订单跟踪、品牌分析、财务与会计、定价）。
  3. 在应用列表里点“查看”拿到 ${c.bold('LWA 客户端编号 (Client ID)')} 和 ${c.bold('客户端密钥 (Client Secret)')}。
  4. 点“授权”（Authorize）→ 生成 ${c.bold('刷新令牌 (Refresh Token)')}，以 Atzr| 开头。
  5. 卖家后台 → 设置 → 账户信息 → 商家记号（Merchant Token），这就是 ${c.bold('卖家 ID')}。
  ${c.dim('详细图文：docs/新手接入教程.md 第 2 节')}
`);
  if (!(await confirm('这些都准备好了吗？', true))) return;
  const alias = (await ask('给这个店铺起个简短的英文名字（以后用来区分店铺）', 'main')).replace(/[^\w-]/g, '');
  const region = await choose('店铺属于哪个区域？', [
    { label: '北美（美国/加拿大/墨西哥/巴西）', value: 'NA' },
    { label: '欧洲（英/德/法/意/西/荷/瑞典/波兰/比利时/土耳其/中东/印度）', value: 'EU' },
    { label: '远东（日本/澳洲/新加坡）', value: 'FE' },
  ]);
  const codes = Object.entries(MARKETPLACES).filter(([, m]) => m.region === region).map(([k, m]) => `${k}=${m.name}`).join('，');
  const mps = (await ask(`你要管理的站点代码，多个用逗号（${codes}）`, region === 'NA' ? 'US' : region === 'EU' ? 'UK' : 'JP'))
    .split(/[,，\s]+/).filter(Boolean).map((x) => marketplace(x).code);
  for (const m of mps) if (marketplace(m).region !== region) throw new Error(`${m} 不属于 ${region} 区域`);
  const sellerId = await ask('卖家 ID（Merchant Token）');
  const clientId = await ask('LWA Client ID（amzn1.application-oa2-client. 开头）');
  const clientSecret = await askSecret('LWA Client Secret');
  const refreshToken = await askSecret('Refresh Token（Atzr| 开头）');

  console.log(c.dim('\n正在测试连接…'));
  const creds = { clientId, clientSecret, refreshToken };
  clearTokenCache();
  await accessToken(creds, region);
  console.log(c.green('✓ 令牌有效'));
  // 先临时写配置，才能用 spapi() 测试
  setSecret(`spapi:${alias}`, creds);
  updateConfig((cfg) => {
    cfg.stores[alias] = { ...(cfg.stores[alias] || {}), region, sellerId, marketplaces: mps, defaultMarketplace: mps[0] };
  });
  const parts = await spapi(alias, 'GET', '/sellers/v1/marketplaceParticipations');
  const active = (parts?.payload || []).filter((x) => x.participation?.isParticipating).map((x) => marketplaceById(x.marketplace?.id)?.code || x.marketplace?.countryCode);
  console.log(c.green(`✓ 卖家接口可用。这个账户开通的站点：${active.join('、') || '（未返回）'}`));
  const missing = mps.filter((m) => !active.includes(m));
  if (missing.length) console.log(c.yellow(`! 你填的 ${missing.join('、')} 不在开通列表里，请核对。`));
  console.log(c.green(`\n店铺“${alias}”已接入。凭证保存在：${backendLabel()}`));
}

// ---------------- 广告接口 ----------------
async function setupAds() {
  title('接入广告数据（Amazon Ads API）');
  console.log(`广告接口要单独申请（和卖家接口不是同一个授权）：
  1. 打开 https://advertising.amazon.com/API/docs/en-us/guides/onboarding/overview ，按“Onboarding”申请 Ads API 权限（个人自用选直接广告主 Direct advertiser）。
  2. 在 https://developer.amazon.com 的 “Login with Amazon” 里建一个“安全配置文件”(Security Profile)，拿到 ${c.bold('Client ID / Client Secret')}。
  3. 在这个安全配置文件的 Web Settings 里，“允许的返回网址 (Allowed Return URLs)” 加上：${c.bold('https://www.amazon.com')}（或你自己的网址）。
  4. Ads API 批准后，把这个安全配置文件关联到 Ads API。
  ${c.dim('详细图文：docs/新手接入教程.md 第 3 节')}
`);
  if (!(await confirm('准备好了吗？', true))) return;
  const cfg = loadConfig();
  const stores = Object.keys(cfg.stores);
  let alias;
  if (stores.length) {
    alias = await choose('这个广告账户对应哪个店铺？', [...stores.map((s) => ({ label: s, value: s })), { label: '新建一个（只接广告）', value: '' }]);
  }
  let region = alias ? cfg.stores[alias].region : null;
  if (!alias) {
    alias = (await ask('店铺简称', 'main')).replace(/[^\w-]/g, '');
    region = await choose('区域', [{ label: '北美', value: 'NA' }, { label: '欧洲', value: 'EU' }, { label: '远东', value: 'FE' }]);
  }
  const clientId = await ask('广告用的 Client ID');
  const clientSecret = await askSecret('广告用的 Client Secret');
  const redirectUri = await ask('允许的返回网址（必须和安全配置文件里填的完全一致）', 'https://www.amazon.com');
  const url = `${ADS_AUTH_URLS[region]}?client_id=${encodeURIComponent(clientId)}&scope=advertising::campaign_management&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;
  console.log(`\n请用浏览器打开下面这个网址，登录广告账户并点“允许”：\n\n${c.bold(url)}\n`);
  console.log('点完允许后，浏览器会跳到一个网址（地址栏里带 code=...），把整个网址复制回来。注意：code 几分钟内有效。');
  const back = await ask('粘贴跳转后的完整网址（或只粘 code）');
  let code = back;
  try { code = new URL(back).searchParams.get('code') || back; } catch { /* 只粘了 code */ }
  if (!code) throw new Error('没有拿到 code');
  const refreshToken = await exchangeCode({ clientId, clientSecret, code, redirectUri }, region);
  console.log(c.green('✓ 已换到广告刷新令牌'));
  setSecret(`ads:${alias}`, { clientId, clientSecret, refreshToken });
  updateConfig((cf) => { cf.stores[alias] = { region, marketplaces: [], ...(cf.stores[alias] || {}) }; });

  const profiles = await listProfiles(alias);
  if (!profiles?.length) throw new Error('这个账户下没有广告 profile。请确认登录的是有广告的账户。');
  console.log('\n找到这些广告 profile：');
  const map = {};
  profiles.forEach((pf, i) => {
    const mp = marketplaceById(pf.accountInfo?.marketplaceStringId)?.code || pf.countryCode;
    console.log(`  ${i + 1}. ${mp}  ${pf.accountInfo?.name || ''}  类型=${pf.accountInfo?.type}  profileId=${pf.profileId}`);
    if (pf.accountInfo?.type === 'seller' || !map[mp]) map[mp] = String(pf.profileId);
  });
  console.log(`\n自动对应：${Object.entries(map).map(([k, v]) => `${k}→${v}`).join('，')}`);
  if (!(await confirm('这样对应对吗？（一般选 seller 类型）', true))) {
    for (const k of Object.keys(map)) map[k] = await ask(`${k} 站用哪个 profileId`, map[k]);
  }
  // v1 报表需要“广告主账户 ID”，这里顺便记下（统一接口的账户查询仍是测试版，失败不影响使用）
  const accounts = {};
  try {
    const list = await listAdvertiserAccounts(alias);
    for (const [mp, pid] of Object.entries(map)) {
      const hit = list.filter((a) => (a.alternateIds || []).some((x) => String(x.profileId) === String(pid)))
        .sort((a, b) => (a.alternateIds?.length || 0) - (b.alternateIds?.length || 0))[0];
      if (hit) accounts[mp] = { advertiserAccountId: hit.advertiserAccountId, isGlobalAccount: !!hit.isGlobalAccount || (hit.alternateIds || []).length > 1 };
    }
    console.log(c.green(`✓ 已对应广告主账户（v1 报表用）：${Object.keys(accounts).join('、') || '无'}`));
  } catch (e) {
    console.log(c.yellow(`! 暂时查不到广告主账户（v1 报表会在第一次用时再查）：${e.message}`));
  }
  updateConfig((cf) => {
    const s = cf.stores[alias];
    s.ads = { profiles: map, accounts };
    s.marketplaces = [...new Set([...(s.marketplaces || []), ...Object.keys(map)])];
    s.defaultMarketplace ||= s.marketplaces[0];
  });
  console.log(c.green(`\n✓ 广告已接入店铺“${alias}”。`));
}

// ---------------- 卖家精灵 ----------------
function sellerSpriteGuide() {
  title('卖家精灵 MCP');
  console.log(`卖家精灵的 MCP 是它们官方提供的，本插件${c.bold('不保存')}它的密钥，你直接把它加到 Claude 或 Codex 里就行：
  1. 登录卖家精灵官网，找到“MCP / API”相关页面，拿到 MCP 服务地址和你的密钥（需要对应套餐）。
  2. Claude Code：终端运行   claude mcp add --transport http sellersprite <卖家精灵给你的地址>
     Claude 桌面版：设置 → 连接器 → 添加自定义连接器，填地址。
  3. Codex：在 ~/.codex/config.toml 里加：
       [mcp_servers.sellersprite]
       url = "<卖家精灵给你的地址>"
  4. 重启 Claude / Codex。之后让 AI 做关键词或竞品时，它会优先用卖家精灵，并把这些数据标成“第三方估算”。
  ${c.dim('卖家精灵按调用量收费时，AI 会遵守你说的“付费上限”。')}
`);
}

// ---------------- 云备份 ----------------
async function setupSync() {
  title('云备份档案库（你自己的 AWS S3）');
  console.log(`档案库会先在你电脑上加密，再上传到${c.bold('你自己的')} S3 存储桶，AWS 上只有密文。
  1. 登录 AWS 控制台 → S3 → 创建存储桶（建议开启“版本控制”，默认禁止公开访问不要改）。
  2. IAM → 用户 → 创建一个专用用户，只给它这个桶的读写权限（策略见 docs/新手接入教程.md 第 5 节），创建访问密钥。
`);
  if (!(await confirm('准备好了吗？', true))) return;
  const bucket = await ask('存储桶名称');
  const region = await ask('存储桶所在区域（如 us-east-1、ap-east-1、eu-west-1）');
  const prefix = await ask('存放的文件夹前缀', 'xander-zaozao/');
  const accessKeyId = await ask('访问密钥 ID（AKIA 开头）');
  const secretAccessKey = await askSecret('秘密访问密钥');
  const pass1 = await askSecret('设置一个同步口令（用来加密，换电脑恢复时要用，请记住）');
  const pass2 = await askSecret('再输一次同步口令');
  if (pass1 !== pass2) throw new Error('两次口令不一致');
  if (pass1.length < 8) throw new Error('口令至少 8 位');
  setSecret('aws:sync', { accessKeyId, secretAccessKey });
  setSecret('sync:passphrase', { passphrase: pass1 });
  updateConfig((cfg) => { cfg.sync = { enabled: true, provider: 's3', bucket, region, prefix }; });
  console.log(c.dim('正在做第一次上传测试…'));
  const { push } = await import('../lib/sync.js');
  const r = await push();
  console.log(c.green(`✓ 已加密上传（${r.bytes} 字节）到 s3://${bucket}/${r.key}`));
  console.log(c.yellow('请把同步口令记在安全的地方：忘了就无法解密备份。'));
}

// ---------------- 紫鸟 ----------------
async function setupZiniao() {
  title('紫鸟浏览器（实验功能）');
  console.log(`用途：官方接口做不到的事（比如部分促销设置），可以让 AI 通过紫鸟浏览器代你点击。
  ${c.bold('默认关闭')}：配置好之后，还要在开关面板里单独打开“紫鸟控制”开关才会生效，而且每次操作都要你批准。
  1. 在紫鸟客户端里确认你的账号有“WebDriver/开放接口”权限（企业版通常需要管理员开通）。
  2. 用 WebDriver 模式启动紫鸟客户端（启动参数见紫鸟官方 WebDriver 文档，常见为 --run_type=web_driver --ipc_type=http --port=16851）。
`);
  if (!(await confirm('继续配置吗？', true))) return;
  const port = Number(await ask('紫鸟 WebDriver 端口', '16851'));
  const company = await ask('紫鸟公司名');
  const username = await ask('紫鸟用户名');
  const password = await askSecret('紫鸟密码');
  setSecret('ziniao', { password });
  updateConfig((cfg) => { cfg.ziniao = { enabled: true, port, company, username }; });
  const { status } = await import('../lib/ziniao.js');
  const st = await status();
  if (st.reachable) console.log(c.green(`✓ 已连上紫鸟，找到 ${st.stores.length} 个店铺。`));
  else console.log(c.yellow(`! 暂时连不上：${st.error}\n  配置已保存。启动紫鸟 WebDriver 模式后运行 \`xander doctor\` 再测。`));
  console.log(c.dim('记得：要用的时候去开关面板（xander panel）打开“紫鸟控制”。'));
}

// ---------------- 安装说明 ----------------
export function installGuide() {
  title('安装到 Claude / Codex / DSH');
  const server = path.join(ROOT, 'server', 'index.js');
  console.log(`${c.bold('A. Claude Code（推荐）')}
   在 Claude Code 里输入：
     /plugin marketplace add gx18391303625-afk/xander-zaozao-xiaban
     /plugin install xander-zaozao-xiaban@xander-zaozao
   装好后重启 Claude Code，技能和工具会自动加载。

${c.bold('B. Codex（ChatGPT 桌面版 / Codex CLI）')}
   终端运行：
     codex plugin marketplace add gx18391303625-afk/xander-zaozao-xiaban
   然后在 ChatGPT 桌面版的“插件”目录里找到“Xander（自用）早早下班小助手”安装。
   如果插件目录里找不到，用手动方式：在 ~/.codex/config.toml 里加
     [mcp_servers.xander]
     command = "node"
     args = ["${server.replace(/\\/g, '/')}"]
   并把 ${path.join(ROOT, 'skills')} 下的 7 个文件夹复制到 ~/.codex/skills/ 。

${c.bold('C. Claude 桌面版（手动接工具）')}
   设置 → 开发者 → 编辑配置（claude_desktop_config.json），加入：
     "mcpServers": { "xander": { "command": "node", "args": ["${server.replace(/\\/g, '/')}"] } }
   技能部分：把 skills 下各文件夹打包上传到“设置 → 功能 → 技能”。

${c.bold('D. DeepSeek Harness（DSH，原生接入）')}
   支持声明：DSH ^0.2.1-rc.5；Node.js >=22.13（Desktop 可用自带 Node 运行时）。
   在当前 Desktop 插件管理器的“来源”输入框填 v2.5.1 固定版本来源，或下方本地仓库绝对目录：
      github:gx18391303625-afk/xander-zaozao-xiaban#v2.5.1
     ${ROOT}
   由插件管理器安装；不为运行中的 Desktop 改 profile，不手工编辑其包配置或补丁。
   仅独立的非 Desktop 本地 DSH 可用：
     dsh plugin --profile <profile> add <目录/来源>
   也可填该版本的 Release 安装包（先在发布页核对版本与校验值）：
     https://github.com/gx18391303625-afk/xander-zaozao-xiaban/releases/download/v2.5.1/xander-zaozao-xiaban-2.5.1.tgz
   DSH 直接注册 xander_* 工具，复用原 handler 和安全链，不再另起 Xander MCP 子进程。
   官方 filesystem provider 加载包内 7 个技能，不复制到 ~/.dsh/skills；用户同名技能可能覆盖包技能，先核对来源。
   只读验收：xander_status 参数 {"check":false}；xander_switches 参数 {}，不要调用真实业务工具。
   如有旧的手工 Xander MCP，先取得用户确认，再通过插件管理器禁用重复连接；不要自动改其他宿主。
   接入令牌只由用户在自己的终端运行 xander setup 输入；不把密钥贴进聊天或插件配置。
   安装不自动打开写入权限；无新增 DSH 业务页，原有本机安全面板仍用 xander panel。
   DSH 停止或超时不能撤回已提交的 Amazon 请求；不自动重试，结果未知须保留 proposalId 核验。
   更新、停用或卸载通过插件管理器，不删除 ~/.xander-zaozao/（或 XANDER_HOME）业务数据和凭证。
   本地安装、GitHub 发行和市场收录是独立步骤；目录 PR 支持 Release 安装包，但官方 Discover 索引另需 npm 发行。
   发布和投稿前核对精确提交、分发包及维护者授权；市场 PR 已提交不等于审核通过，不承诺审核或同步时间。
   此适配仍未完成真店读写验证。完整说明：${path.join(ROOT, 'docs', 'dsh.md')}

${c.dim('网页版 ChatGPT / claude.ai 连不到你电脑上的本地服务。凭证、配置和档案本地保存；业务数据按你所选接口和模型传输，不能承诺数据完全不出电脑。')}
`);
}

// ---------------- 偏好设置 ----------------
async function setupSettings() {
  title('偏好设置');
  const cfg = loadConfig();
  const approvalMode = await choose(`改动审批方式（当前：${cfg.settings.approvalMode === 'panel' ? '面板审批' : '对话审批'}）`, [
    { label: '对话审批：在对话里说“批准”即可（方便）', value: 'chat' },
    { label: '面板审批：还必须在开关面板里点“批准”（更安全）', value: 'panel' },
  ]);
  const dryRun = await confirm(`开启演练模式？开启后所有执行只记录不提交（当前：${cfg.settings.dryRun ? '开' : '关'}）`, cfg.settings.dryRun);
  const ttl = Number(await ask('提案有效期（分钟）', String(cfg.settings.proposalTtlMinutes)));
  updateConfig((cf) => { cf.settings.approvalMode = approvalMode; cf.settings.dryRun = dryRun; cf.settings.proposalTtlMinutes = ttl > 0 ? ttl : 30; });
  console.log(c.green('✓ 已保存'));
}

export { getSecret };
