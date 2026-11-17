// 四个用户总权限；细分操作位只用于精确执行校验、审计及旧状态兼容，默认全部关闭。
// 重要：AI 只能“看”开关，不能“拨”开关。拨开关只有两条路：本地开关面板、或在终端里手动确认的命令。
import { FILES } from './paths.js';
import { readJson, writeJson } from './jsonfile.js';
import { OPS } from './ops.js';
import { SWITCH_GROUPS, switchGroup } from './switch-groups.js';

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
  const s = load();
  const group = switchGroup(id);
  if (group) return group.memberIds.every(member => OPS.some(op => op.id === member) && s.switches[member]?.on === true);
  return OPS.some(op => op.id === id) && s.switches[id]?.on === true;
}

export function limits() {
  return load().limits;
}

export function listSwitches() {
  const s = load();
  const byId = new Map(OPS.map(op => [op.id, op]));
  const items = SWITCH_GROUPS.map(group => {
    const operations = group.memberIds.map(id => byId.get(id)).filter(Boolean).map(op => ({
      id: op.id, label: op.label, group: op.group, risk: op.risk, beta: !!op.beta,
      special: !!op.special, implemented: true, on: s.switches[op.id]?.on === true,
      changedAt: s.switches[op.id]?.changedAt || null, capability: op.capability || 'api',
      limitation: op.limitation || null, requirements: op.requirements || null,
    }));
    const enabledOperations = operations.filter(op => op.on).length;
    const implemented = operations.length === group.memberIds.length;
    const partial = enabledOperations > 0 && enabledOperations < group.memberIds.length;
    return {
      id: group.id, group: '权限总开关', label: group.label, description: group.description,
      risk: group.risk, special: group.special, beta: operations.some(op => op.beta), implemented,
      // Do not report mixed legacy permissions as off or silently enable the rest.
      on: partial ? null : implemented && enabledOperations === group.memberIds.length,
      partial, enabledOperations, totalOperations: group.memberIds.length, operations,
      changedAt: operations.map(op => op.changedAt).filter(value => typeof value === 'string').sort().at(-1) || null,
      capability: group.id === 'ziniao.control' ? 'browser' : 'mixed',
      limitation: group.limitation, requirements: '仍需逐份精确提案、明确批准及执行后核验。',
    };
  });
  return { items, limits: s.limits };
}

export function setSwitch(id, on, by = 'panel') {
  if (typeof on !== 'boolean') throw new Error('开关状态必须是布尔值。');
  const group = switchGroup(id);
  if (group) {
    // Resolve and validate the entire scope before changing any in-memory or saved bit.
    if (group.memberIds.some(member => !OPS.some(op => op.id === member))) throw new Error('权限范围尚未完整实现，不能统一更改。');
    const s = load();
    const changes = group.memberIds.filter(member => (s.switches[member]?.on === true) !== on)
      .map(member => ({ id: member, before: s.switches[member]?.on === true, after: on }));
    if (!changes.length) return { on, changedAt: null, by, changed: [] };
    const at = new Date().toISOString();
    for (const change of changes) s.switches[change.id] = { on, changedAt: at, by };
    s.history.push({ at, id, on, by, memberIds: [...group.memberIds], changes });
    save(s); // One atomic file replacement for the whole human-approved scope.
    return { on, changedAt: at, by, changed: changes.map(change => change.id) };
  }
  // Compatibility for internal operation-level callers, never exposed by UI/CLI.
  // An old exact grant stays exact; it must never enable its whole new group.
  const op = OPS.find(operation => operation.id === id);
  if (!op) throw new Error(`没有这个开关：${id}（规划中的功能暂时不能打开）`);
  const s = load();
  s.switches[id] = { on, changedAt: new Date().toISOString(), by };
  s.history.push({ at: new Date().toISOString(), id, on, by });
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
