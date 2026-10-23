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

test('广告经济线：数字与官方算法一致', () => {
  const r = calc.adEconomics({ price: 29.99, referralFeePct: 15, fbaFee: 5.2, purchaseCost: 4.1, firstLegCost: 1.3, cvrPct: 12, targetMarginPct: 10 });
  assert.equal(r.perUnit.广告前贡献利润, 14.89);
  assert.equal(r.盈亏平衡ACoS, 49.65);
  assert.equal(r.目标ACoS, 39.65);
});

test('广告经济线：缺采购成本不出结论', () => {
  const r = calc.adEconomics({ price: 20, referralFeePct: 15, fbaFee: 5, firstLegCost: 1 });
  assert.equal(r.status, 'INCOMPLETE');
  assert.ok(r.missing.some((m) => m.includes('采购')));
});

test('广告经济线：含税站点先去税', () => {
  const r = calc.adEconomics({ price: 24, vatPct: 20, referralFeePct: 15, fbaFee: 3, purchaseCost: 3, firstLegCost: 1 });
  assert.equal(r.perUnit.不含税售价, 20);
  assert.equal(r.perUnit.广告前贡献利润, 9.4);
});

test('补货：整箱取整、MOQ、在途无日期不计入', () => {
  const [r] = calc.replenishment({ rows: [{ sku: 'A', dailySales: 10, sellable: 200, inbound: [{ qty: 300, availableInDays: 25 }, { qty: 999 }], leadTimeDays: 40, safetyDays: 14, coverDays: 30, casePack: 24, moq: 500 }] });
  assert.equal(r.当前可售天数, 20);
  assert.equal(r.预计断货天数, 21);
  const base = r.情景.find((s) => s.需求倍数 === 1);
  assert.equal(base.需要件数, 340); // 10*(40+30+14) - (200+300)
  assert.equal(base.建议件数, 504); // MOQ 500 → 取整到 24 的倍数
  assert.equal(base.箱数, 21);
  assert.ok(r.warnings.some((w) => w.includes('没有可售日期')));
  assert.ok(r.warnings.some((w) => w.includes('早于新货可售')));
});

test('补货：缺交期只给续航', () => {
  const [r] = calc.replenishment({ rows: [{ sku: 'A', dailySales: 5, sellable: 100 }] });
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.当前可售天数, 20);
});

test('利润桥：缺核心项只给小计，NETTED 不重复扣', () => {
  const r = calc.profitBridge({ items: [
    { name: '销售额', amount: 1000, category: 'revenue' },
    { name: '佣金', amount: 150, category: 'fee' },
    { name: '已含在净额里的配送费', amount: 200, category: 'fee', status: 'NETTED' },
    { name: '广告', amount: 120, category: 'ads' },
  ] });
  assert.equal(r.已知收支小计, 730);
  assert.equal(r.经营利润, null);
  assert.equal(r.状态, 'KNOWN_SUBTOTAL_ONLY');
  const full = calc.profitBridge({ items: [
    { name: '销售额', amount: 1000, category: 'revenue' }, { name: '佣金', amount: 150, category: 'fee' },
    { name: '广告', amount: 120, category: 'ads' }, { name: '售出成本', amount: 300, category: 'cogs', status: 'ESTIMATED' },
  ] });
  assert.equal(full.经营利润, 430);
  assert.equal(full.状态, 'ESTIMATE');
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
