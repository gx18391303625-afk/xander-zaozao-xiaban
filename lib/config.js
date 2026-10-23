// 非敏感配置：店铺别名、区域、站点、广告 profile、各种设置。
// 敏感内容（令牌、密钥）一律不放这里，见 secrets.js。
import { FILES, ensureHome } from './paths.js';
import { readJson, writeJson } from './jsonfile.js';

const DEFAULT_CONFIG = {
  version: 1,
  // stores.<别名> = { region, sellerId, marketplaces: ['US'], defaultMarketplace: 'US',
  //                  spapi: true/false, ads: { profiles: { US: '123' } } }
  stores: {},
  sellerSprite: { note: '卖家精灵 MCP 由你在 Claude / Codex 里单独连接，本插件不经手它的密钥。' },
  sync: { enabled: false, provider: 's3', bucket: '', region: '', prefix: 'xander-zaozao/' },
  ziniao: { enabled: false, port: 16851, clientPath: '', company: '', username: '' },
  settings: {
    approvalMode: 'chat',     // chat：在对话里批准即可；panel：必须在开关面板里点“批准”
    dryRun: false,            // true：执行时只记录不提交（演练）
    proposalTtlMinutes: 30,   // 提案有效期
    language: 'zh-CN',
  },
};

export function loadConfig() {
  ensureHome();
  const c = readJson(FILES.config(), DEFAULT_CONFIG);
  return { ...structuredClone(DEFAULT_CONFIG), ...c, settings: { ...DEFAULT_CONFIG.settings, ...(c.settings || {}) } };
}

export function saveConfig(cfg) {
  ensureHome();
  writeJson(FILES.config(), cfg);
}

export function updateConfig(fn) {
  const cfg = loadConfig();
  fn(cfg);
  saveConfig(cfg);
  return cfg;
}

export function getStore(alias) {
  const cfg = loadConfig();
  const names = Object.keys(cfg.stores);
  if (!alias) {
    if (names.length === 1) return { alias: names[0], ...cfg.stores[names[0]] };
    if (names.length === 0) throw new Error('还没有接入任何店铺。请先运行 `xander setup`，或让我带你接入。');
    throw new Error(`有多个店铺（${names.join('、')}），请指定是哪一个（store 参数）。`);
  }
  if (!cfg.stores[alias]) throw new Error(`没有叫“${alias}”的店铺。已接入：${names.join('、') || '无'}`);
  return { alias, ...cfg.stores[alias] };
}
