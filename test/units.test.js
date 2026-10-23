import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolate } from './helpers.js';

const dir = isolate();
const calc = await import('../lib/calc.js');
const ar = await import('../lib/archive.js');
const { signS3, encrypt, decrypt } = await import('../lib/sync.js');
const { parseCsv } = await import('../lib/csv.js');
const { setSecret, getSecret } = await import('../lib/secrets.js');

test('广告经济线：与技能 Python 计算器结果一致（美国）', () => {
  const r = calc.adEconomics({ price: 29.99, referralFeePct: 15, fbaFee: 5.2, purchaseCost: 4.1, firstLegCost: 1.3, cvrPct: 12, targetMarginPct: 10, notApplicable: ['otherUnitCost', 'returnsCostPerUnit', 'refundLossPerUnit'] });
  assert.equal(r.status, 'READY_ESTIMATED');
  assert.equal(r.perUnit.广告前贡献利润, 14.89);
  assert.equal(r.盈亏平衡ACoS, 49.65);
  assert.equal(r.目标ACoS, 39.65);
  assert.equal(r.盈亏平衡CPC, 1.78, 'CPC 向下取整（Python 计算器同为 1.78）');
  assert.equal(r.目标CPC, 1.42);
});

test('广告经济线：含税站点利润率底线按不含税净销售额（英国，对齐 Python 30.83%）', () => {
  const r = calc.adEconomics({ price: 24, vatPct: 20, referralFeePct: 15, fbaFee: 3, purchaseCost: 3, firstLegCost: 1, targetMarginPct: 10, cvrPct: 12, notApplicable: ['otherUnitCost', 'returnsCostPerUnit', 'refundLossPerUnit'] });
  assert.equal(r.perUnit.净销售额, 20);
  assert.equal(r.perUnit.广告前贡献利润, 9.4);
  assert.equal(r.盈亏平衡ACoS, 39.17);
  assert.equal(r.利润底线每件, 2);
  assert.equal(r.目标ACoS, 30.83);
  assert.equal(r.盈亏平衡CPC, 1.12);
  assert.equal(r.目标CPC, 0.88);
});

test('广告经济线：可选成本没给 → PROVISIONAL；缺核心 → INCOMPLETE；不赚钱 → BLOCKED', () => {
  const p = calc.adEconomics({ price: 29.99, referralFeePct: 15, fbaFee: 5.2, purchaseCost: 4.1, firstLegCost: 1.3 });
  assert.equal(p.status, 'PROVISIONAL');
  assert.ok(p.assumedZero.length === 3);
  const inc = calc.adEconomics({ price: 20, referralFeePct: 15, fbaFee: 5, firstLegCost: 1 });
  assert.equal(inc.status, 'INCOMPLETE');
  assert.ok(inc.missing.some((m) => m.includes('采购')));
  const blk = calc.adEconomics({ price: 10, referralFeePct: 15, fbaFee: 5, purchaseCost: 4, firstLegCost: 1, notApplicable: ['otherUnitCost', 'returnsCostPerUnit', 'refundLossPerUnit'] });
  assert.equal(blk.status, 'BLOCKED');
  assert.equal(blk.盈亏平衡ACoS, null);
});

test('补货：到货前的失销不重复补回；整箱与 MOQ；在途无日期不计入', () => {
  const [r] = calc.replenishment({ rows: [{ sku: 'A', dailySales: 10, sellable: 200, inbound: [{ qty: 300, availableInDays: 25 }, { qty: 999 }], leadTimeDays: 40, safetyDays: 14, coverDays: 30, casePack: 24, moq: 500 }] });
  assert.equal(r.当前可售天数, 20);
  assert.equal(r.预计断货天数, 21);
  const base = r.情景.find((s) => s.需求倍数 === 1);
  assert.equal(base.新货可售前预计失销件数, 50, '第 21–25 天断货，失销 50 件');
  assert.equal(base.需要件数, 280, '窗口 40–69 天：安全 140 + 需求 300 − 起始 160（失销的 50 件不补回）');
  assert.equal(base.建议件数, 504, 'MOQ 500 → 取整到 24 的倍数');
  assert.equal(base.箱数, 21);
  assert.ok(r.warnings.some((w) => w.includes('没有可售日期')));
  assert.ok(r.warnings.some((w) => w.includes('不会被这次补货补回')));
});

test('补货：窗口中途到货也要检查每一天，不能只看总量', () => {
  // 起始 100，日销 10；第 45 天有 500 件到（当天结束入库）。新货第 20 天可售，覆盖 30 天（20–49），安全 0。
  const [r] = calc.replenishment({ rows: [{ sku: 'B', dailySales: 10, sellable: 100, inbound: [{ qty: 500, availableInDays: 45 }], leadTimeDays: 20, coverDays: 30, safetyDays: 0 }] });
  const base = r.情景.find((s) => s.需求倍数 === 1);
  // 第 20 天前已断货（第 11 天起），起始库存 0；第 20–45 天要靠新货（26 天 × 10 = 260），之后有在途
  assert.equal(base.需要件数, 260, '只看总量会算成 0（因为窗口总需求 300 < 到货 500），逐日看才对');
});

test('补货：日需求为 0 时不给“无限续航”', () => {
  const [r] = calc.replenishment({ rows: [{ sku: 'C', dailySales: 0, sellable: 100 }] });
  assert.equal(r.status, 'PARTIAL');
});

test('利润桥：退款是核心项；NETTED 不重复扣；已确认为 0 的退款算齐', () => {
  const r = calc.profitBridge({ items: [
    { name: '销售额', amount: 1000, category: 'revenue' },
    { name: '佣金', amount: 150, category: 'fee' },
    { name: '已含在净额里的配送费', amount: 200, category: 'fee', status: 'NETTED' },
    { name: '广告', amount: 120, category: 'ads' },
    { name: '售出成本', amount: 300, category: 'cogs' },
  ] });
  assert.equal(r.已知收支小计, 430);
  assert.equal(r.经营利润, null, '没有退款项 → 不能叫利润');
  assert.deepEqual(r.缺少的核心项, ['退款']);
  const full = calc.profitBridge({ items: [
    { name: '销售额', amount: 1000, category: 'revenue' }, { name: '佣金', amount: 150, category: 'fee' },
    { name: '广告', amount: 120, category: 'ads' }, { name: '售出成本', amount: 300, category: 'cogs', status: 'ESTIMATED' },
    { name: '本期无退款', amount: 0, category: 'refund' }, { name: '赔偿入账', amount: 25, category: 'adjustment' },
    { name: '入仓服务费', amount: 10, category: 'fee', status: 'EXTRA_PAID' },
  ] });
  assert.equal(full.经营利润, 445);
  assert.equal(full.状态, 'ESTIMATE');
  assert.ok(full.提醒.some((w) => w.includes('重复扣')));
});

test('档案库：记事实、改价保留历史、补录旧值不覆盖当前', () => {
  ar.upsertProduct('main', { sku: 'BOWL-BLUE', asin: 'B0TEST0001', title: '狗碗 蓝' });
  ar.setFact('main', { sku: 'BOWL-BLUE', field: 'purchase_cost', value: '12.5', currency: 'CNY', effective_from: '2026-09-01', source: '工厂报价' });
  const r2 = ar.setFact('main', { sku: 'BOWL-BLUE', field: 'purchase_cost', value: '11.8', currency: 'CNY', effective_from: '2026-10-15', source: '新报价' });
  assert.equal(r2.replaced.value, '12.5');
  const r3 = ar.setFact('main', { sku: 'BOWL-BLUE', field: 'purchase_cost', value: '13', currency: 'CNY', effective_from: '2026-06-01', source: '补录' });
  assert.match(r3.note, /当前值仍是 11.8/);
  const cur = ar.factsFor('main', 'BOWL-BLUE').find((f) => f.field === 'purchase_cost');
  assert.equal(cur.value, '11.8');
  const asOf = ar.factsFor('main', 'BOWL-BLUE', { asOf: '2026-09-20' }).find((f) => f.field === 'purchase_cost');
  assert.equal(asOf.value, '12.5');
  assert.equal(ar.history('main', 'BOWL-BLUE', 'purchase_cost').length, 3);
  assert.throws(() => ar.setFact('main', { field: 'x', value: '1' }), /source/);
});

test('档案库：CSV 宽表导入（含引号和 BOM）', () => {
  const f = path.join(dir, 'cost.csv');
  fs.writeFileSync(f, '﻿sku,title,purchase_cost,case_pack_qty,note\r\nBOWL-RED,"狗碗, 红",12.5,24,"含""礼盒"""\r\n');
  const pre = ar.importCsv('main', f, { dryRun: true });
  assert.equal(pre.wouldImport, 2);
  ar.importCsv('main', f, { defaultSource: '测试' });
  const facts = ar.factsFor('main', 'BOWL-RED');
  assert.equal(facts.find((x) => x.field === 'case_pack_qty').value, '24');
  assert.equal(facts[0].note, '含"礼盒"');
  assert.equal(ar.getProduct('main', 'BOWL-RED').title, '狗碗, 红');
});

test('CSV 解析：引号里的换行', () => {
  assert.deepEqual(parseCsv('a,b\n"x\ny",2\n'), [['a', 'b'], ['x\ny', '2']]);
});

test('S3 签名：与 AWS 官方文档示例一致', () => {
  const { headers } = signS3({
    method: 'GET', bucket: 'examplebucket', region: 'us-east-1', key: 'test.txt',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    date: new Date('2013-05-24T00:00:00Z'), hostOverride: 'examplebucket.s3.amazonaws.com', extraHeaders: { Range: 'bytes=0-9' },
  });
  assert.match(headers.Authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  assert.match(headers.Authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/);
});

test('加密备份：口令对能解开，口令错解不开', () => {
  const data = Buffer.from('档案内容 secret');
  const enc = encrypt(data, 'correct horse');
  assert.ok(!enc.includes(data));
  assert.equal(decrypt(enc, 'correct horse').toString(), '档案内容 secret');
  assert.throws(() => decrypt(enc, 'wrong pass'), /口令不对/);
});

test('凭证：存取正常，配置文件里没有密钥', async () => {
  setSecret('spapi:t', { clientSecret: 'SUPER-SECRET-123' });
  assert.equal(getSecret('spapi:t').clientSecret, 'SUPER-SECRET-123');
  const { updateConfig } = await import('../lib/config.js');
  updateConfig((c) => { c.stores.t = { region: 'NA' }; });
  assert.ok(!fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes('SUPER-SECRET'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'secrets.local.json')).mode & 0o777, 0o600);
});
