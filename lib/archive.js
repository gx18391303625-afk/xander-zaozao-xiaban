// 店铺档案库：存亚马逊后台没有的信息（采购价、头程、箱规、交期、认证、决策和待办）。
// 用 Node 自带的 SQLite，数据只在本机 archive.db 里。
// 规则：每条事实都记来源和生效日期；改价不覆盖旧值，旧值标记为“已被取代”，可随时查历史。
import fs from 'node:fs';
import { FILES, ensureHome } from './paths.js';
import { parseCsv } from './csv.js';

// Library imports must not replace process-wide warning handlers in an embedding host.
// The standalone MCP entry handles its own SQLite warning output.
import { DatabaseSync } from 'node:sqlite';

// 推荐字段（可以用别的字段名，但这些名字会被利润/补货计算直接识别）
export const STANDARD_FIELDS = {
  purchase_cost: '采购单价（每个可售单位）',
  first_leg_cost: '头程运费（每个可售单位）',
  other_unit_cost: '其他单件成本（包装、贴标、质检等）',
  case_pack_qty: '箱规：每箱件数',
  carton_dimensions: '外箱尺寸',
  carton_weight: '外箱重量',
  production_lead_days: '生产交期（天）',
  sea_transit_days: '海运时效（天）',
  air_transit_days: '空运时效（天）',
  moq: '最小起订量',
  safety_stock_days: '安全库存天数',
  supplier: '供应商',
  certification: '认证（名称、编号、有效期、覆盖范围）',
  target_margin: '目标利润率',
  min_profit_per_unit: '每件最低利润底线',
};

let db = null;
function open() {
  if (db) return db;
  ensureHome();
  db = new DatabaseSync(FILES.archive());
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS stores (
      store TEXT PRIMARY KEY, note TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      store TEXT NOT NULL, sku TEXT NOT NULL, asin TEXT, parent_asin TEXT, title TEXT, variant TEXT,
      marketplace TEXT, note TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (store, sku)
    );
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL, sku TEXT, field TEXT NOT NULL, value TEXT NOT NULL,
      unit TEXT, currency TEXT, effective_from TEXT, source TEXT NOT NULL, note TEXT,
      recorded_at TEXT NOT NULL, superseded_at TEXT, superseded_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS facts_lookup ON facts (store, sku, field, superseded_at);
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL, sku TEXT, kind TEXT NOT NULL, text TEXT NOT NULL,
      created_at TEXT NOT NULL, done_at TEXT
    );
  `);
  return db;
}

export function closeArchive() {
  if (db) { db.close(); db = null; }
}

const now = () => new Date().toISOString();
const norm = (s) => (s === undefined || s === null || s === '' ? null : String(s));

function ensureStore(store) {
  open().prepare('INSERT OR IGNORE INTO stores (store, created_at) VALUES (?, ?)').run(store, now());
}

export function upsertProduct(store, { sku, asin, parent_asin, title, variant, marketplace, note }) {
  if (!sku) throw new Error('sku 必填');
  ensureStore(store);
  open().prepare(`INSERT INTO products (store, sku, asin, parent_asin, title, variant, marketplace, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, sku) DO UPDATE SET asin=COALESCE(excluded.asin, asin), parent_asin=COALESCE(excluded.parent_asin, parent_asin),
      title=COALESCE(excluded.title, title), variant=COALESCE(excluded.variant, variant), marketplace=COALESCE(excluded.marketplace, marketplace),
      note=COALESCE(excluded.note, note), updated_at=excluded.updated_at`)
    .run(store, sku, norm(asin), norm(parent_asin), norm(title), norm(variant), norm(marketplace), norm(note), now());
  return getProduct(store, sku);
}

// 记一条事实。同一店铺/SKU/字段的旧值会被标记为“已被取代”，但不会删除。
export function setFact(store, { sku = null, field, value, unit, currency, effective_from, source, note }) {
  if (!field) throw new Error('field 必填');
  if (value === undefined || value === null || value === '') throw new Error('value 不能为空；不知道就别记，留空比记错好。');
  if (!source) throw new Error('source 必填：写清楚来源，比如“用户口述 2026-10-22”或“工厂报价单 PI-123”。');
  ensureStore(store);
  const d = open();
  const eff = norm(effective_from) || now().slice(0, 10);
  const prev = d.prepare(`SELECT * FROM facts WHERE store=? AND sku IS ? AND field=? AND superseded_at IS NULL ORDER BY effective_from DESC, id DESC LIMIT 1`).get(store, norm(sku), field);
  const info = d.prepare(`INSERT INTO facts (store, sku, field, value, unit, currency, effective_from, source, note, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(store, norm(sku), field, String(value), norm(unit), norm(currency), eff, source, norm(note), now());
  const newId = Number(info.lastInsertRowid);
  if (prev && (!prev.effective_from || prev.effective_from <= eff)) {
    d.prepare('UPDATE facts SET superseded_at=?, superseded_by=? WHERE id=?').run(now(), newId, prev.id);
    return { id: newId, replaced: { id: prev.id, value: prev.value, effective_from: prev.effective_from } };
  }
  if (prev) {
    // 补录的是更早的历史值：存进历史，但当前值不变
    d.prepare('UPDATE facts SET superseded_at=?, superseded_by=? WHERE id=?').run(now(), prev.id, newId);
    return { id: newId, replaced: null, note: `这是更早生效的历史值，当前值仍是 ${prev.value}（${prev.effective_from} 起）。` };
  }
  return { id: newId, replaced: null };
}

// 查某个时点有效的事实（不传日期 = 当前）
export function factsFor(store, sku = null, { asOf } = {}) {
  const d = open();
  let rows;
  if (asOf) {
    rows = d.prepare(`SELECT * FROM facts WHERE store=? AND sku IS ? AND effective_from <= ? ORDER BY field, effective_from DESC, id DESC`).all(store, norm(sku), asOf);
    const seen = new Set();
    rows = rows.filter((r) => (seen.has(r.field) ? false : seen.add(r.field)));
  } else {
    rows = d.prepare(`SELECT * FROM facts WHERE store=? AND sku IS ? AND superseded_at IS NULL ORDER BY field`).all(store, norm(sku));
  }
  return rows.map(clean);
}

export function history(store, sku = null, field = null) {
  const d = open();
  const rows = field
    ? d.prepare('SELECT * FROM facts WHERE store=? AND sku IS ? AND field=? ORDER BY effective_from DESC, id DESC').all(store, norm(sku), field)
    : d.prepare('SELECT * FROM facts WHERE store=? AND sku IS ? ORDER BY field, effective_from DESC, id DESC').all(store, norm(sku));
  return rows.map(clean);
}

function clean(r) {
  const o = { ...r };
  for (const k of Object.keys(o)) if (o[k] === null) delete o[k];
  return o;
}

export function getProduct(store, sku) {
  const p = open().prepare('SELECT * FROM products WHERE store=? AND sku=?').get(store, sku);
  return p ? clean(p) : null;
}

export function overview(store, sku = null) {
  const d = open();
  if (sku) {
    return {
      store, product: getProduct(store, sku), facts: factsFor(store, sku), storeFacts: factsFor(store, null),
      openNotes: d.prepare('SELECT * FROM notes WHERE store=? AND (sku=? OR sku IS NULL) AND done_at IS NULL ORDER BY id DESC LIMIT 30').all(store, sku).map(clean),
    };
  }
  return {
    store,
    storeFacts: factsFor(store, null),
    products: d.prepare('SELECT sku, asin, title, variant, marketplace FROM products WHERE store=? ORDER BY sku').all(store).map(clean),
    factCount: d.prepare('SELECT COUNT(*) AS n FROM facts WHERE store=? AND superseded_at IS NULL').get(store).n,
    openNotes: d.prepare('SELECT * FROM notes WHERE store=? AND done_at IS NULL ORDER BY id DESC LIMIT 30').all(store).map(clean),
  };
}

export function listStores() {
  return open().prepare(`SELECT s.store, (SELECT COUNT(*) FROM products p WHERE p.store=s.store) AS products,
    (SELECT COUNT(*) FROM facts f WHERE f.store=s.store AND f.superseded_at IS NULL) AS facts FROM stores s ORDER BY s.store`).all();
}

export function addNote(store, { sku, kind = 'note', text }) {
  if (!text) throw new Error('text 必填');
  if (!['note', 'decision', 'todo', 'progress'].includes(kind)) throw new Error('kind 只能是 note / decision / todo / progress');
  ensureStore(store);
  const info = open().prepare('INSERT INTO notes (store, sku, kind, text, created_at) VALUES (?, ?, ?, ?, ?)').run(store, norm(sku), kind, text, now());
  return { id: Number(info.lastInsertRowid) };
}

export function completeNote(id) {
  open().prepare('UPDATE notes SET done_at=? WHERE id=?').run(now(), id);
  return { id, done: true };
}

// 从 CSV 批量导入。表头：sku,field,value[,unit,currency,effective_from,source,note]
// 或宽表：sku,purchase_cost,first_leg_cost,case_pack_qty,...（其余列当字段名）
export function importCsv(store, file, { defaultSource, dryRun = false } = {}) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV 至少要有表头和一行数据');
  const header = rows[0].map((h) => h.trim());
  const idx = (n) => header.indexOf(n);
  const long = idx('field') >= 0 && idx('value') >= 0;
  const planned = [];
  for (const r of rows.slice(1)) {
    if (r.every((c) => !c.trim())) continue;
    const get = (n) => (idx(n) >= 0 ? r[idx(n)]?.trim() : undefined);
    const sku = get('sku') || null;
    const base = { unit: get('unit'), currency: get('currency'), effective_from: get('effective_from'), source: get('source') || defaultSource || `CSV 导入 ${file}`, note: get('note') };
    if (long) {
      if (get('value')) planned.push({ sku, field: get('field'), value: get('value'), ...base });
    } else {
      for (const h of header) {
        if (['sku', 'asin', 'title', 'unit', 'currency', 'effective_from', 'source', 'note'].includes(h)) continue;
        const v = get(h);
        const money = /cost|price|fee|profit|margin_amount/i.test(h);
        if (v) planned.push({ sku, field: h, value: v, ...base, currency: money ? base.currency : undefined });
      }
      if (sku && (get('asin') || get('title'))) upsertProduct(store, { sku, asin: get('asin'), title: get('title') });
    }
  }
  if (dryRun) return { wouldImport: planned.length, sample: planned.slice(0, 10) };
  const d = open();
  d.exec('BEGIN');
  try {
    for (const f of planned) {
      if (f.sku) upsertProduct(store, { sku: f.sku });
      setFact(store, f);
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { imported: planned.length };
}

// 做一份一致的快照（同步/备份用）
export function snapshotTo(path) {
  open().exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  return path;
}
