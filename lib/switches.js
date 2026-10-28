// 开关状态：每一项写入能力一个开关，默认全部关闭。
// 重要：AI 只能“看”开关，不能“拨”开关。拨开关只有两条路：本地开关面板、或在终端里手动确认的命令。
import { FILES } from './paths.js';
import { readJson, writeJson } from './jsonfile.js';
import { OPS, PLANNED } from './ops.js';

export const DEFAULT_LIMITS = {
  bidChangePctMax: 50,        // 竞价单次最多改 ±50%
  budgetChangePctMax: 100,    // 预算单次最多改 ±100%
  priceChangePctMax: 20,      // 售价单次最多改 ±20%
  maxChangesPerProposal: 50,  // 一个提案最多包含多少项改动
};

function load() {
  const s = readJson(FILES.switches(), { switches: {}, limits: {}, history: [] });
  s.switches ||= {};
  s.limits = { ...DEFAULT_LIMITS, ...(s.limits || {}) };
  s.history ||= [];
  return s;
}

function save(s) {
  s.history = s.history.slice(-500);
  writeJson(FILES.switches(), s);
}

export function isOn(id) {
  return !!load().switches[id]?.on;
}

export function limits() {
  return load().limits;
}

export function listSwitches() {
  const s = load();
  const items = OPS.map((o) => ({
    id: o.id, group: o.group, label: o.label, risk: o.risk, beta: !!o.beta, special: !!o.special,
    implemented: true, on: !!s.switches[o.id]?.on, changedAt: s.switches[o.id]?.changedAt || null,
    capability: o.capability || 'api', limitation: o.limitation || null, requirements: o.requirements || null,
  }));
  for (const p of PLANNED) items.push({ ...p, implemented: false, on: false, risk: '-', special: false });
  return { items, limits: s.limits };
}

export function setSwitch(id, on, by = 'panel') {
  const op = OPS.find((o) => o.id === id);
  if (!op) throw new Error(`没有这个开关：${id}（规划中的功能暂时不能打开）`);
  const s = load();
  s.switches[id] = { on: !!on, changedAt: new Date().toISOString(), by };
  s.history.push({ at: new Date().toISOString(), id, on: !!on, by });
  save(s);
  return s.switches[id];
}

// 一键全开 / 全关。FBA、紫鸟等 special 能力默认不跟随“一键全开”。
export function setAll(on, { includeSpecial = false, by = 'panel' } = {}) {
  const s = load();
  const now = new Date().toISOString();
  const changed = [];
  for (const o of OPS) {
    if (on && (o.special || o.channel === 'handoff') && !includeSpecial) continue;
    s.switches[o.id] = { on: !!on, changedAt: now, by };
    changed.push(o.id);
  }
  s.history.push({ at: now, id: on ? 'ALL_ON' : 'ALL_OFF', on: !!on, by, includeSpecial });
  save(s);
  return changed;
}

export function setLimits(patch, by = 'panel') {
  const s = load();
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULT_LIMITS)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${k} 必须是正数`);
    s.limits[k] = n;
  }
  s.history.push({ at: new Date().toISOString(), id: 'LIMITS', limits: s.limits, by });
  save(s);
  return s.limits;
}
