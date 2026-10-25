import test from 'node:test';
import assert from 'node:assert/strict';
import { adEconomics } from '../lib/calc.js';
import fs from 'node:fs';
import { isolate } from './helpers.js';

const base = () => ({ price: 20, referralFeePct: 15, fbaFee: 3, purchaseCost: 3, firstLegCost: 1, cvrPct: 10, targetMarginPct: 10, notApplicable: ['otherUnitCost', 'returnsCostPerUnit', 'refundLossPerUnit'] });

test('广告经济线不允许负成本或负利润底线制造更高出价能力', () => {
  for (const field of ['fbaFee', 'purchaseCost', 'firstLegCost', 'otherUnitCost', 'returnsCostPerUnit', 'refundLossPerUnit', 'targetProfitPerUnit', 'riskBufferPerUnit']) {
    assert.throws(() => adEconomics({ ...base(), [field]: -1 }), new RegExp(field));
  }
  assert.throws(() => adEconomics({ ...base(), targetMarginPct: -20 }), /targetMarginPct/);
});

test('广告经济线拒绝越界百分比和非有限值，合法端点继续可算', () => {
  for (const field of ['referralFeePct', 'vatPct', 'targetMarginPct', 'cvrPct']) {
    for (const value of [-100, 100.01, Infinity, NaN]) assert.throws(() => adEconomics({ ...base(), [field]: value }), new RegExp(field));
  }
  assert.equal(adEconomics({ ...base(), cvrPct: 0 }).目标CPC, 0);
  assert.equal(adEconomics({ ...base(), cvrPct: 100 }).目标CPC, 8);
});

test('广告经济线要求正收入分母，不允许零销售额仍标为可用', () => {
  for (const field of ['price', 'attributedSalesPerOrder']) {
    for (const value of [0, -1, 0.001]) assert.throws(() => adEconomics({ ...base(), [field]: value }), new RegExp(field));
  }
  assert.throws(() => adEconomics({ ...base(), price: Number.MAX_VALUE }), /price/);
});

test('广告经济线不将布尔值、数组或坏字符串转换成成本数字', () => {
  for (const value of [true, false, [], {}, 'unknown', ' ', '5']) assert.throws(() => adEconomics({ ...base(), purchaseCost: value }), /purchaseCost/);
  assert.throws(() => adEconomics({ ...base(), otherUnitCost: 'unknown' }), /otherUnitCost/);
});

test('未知和缺失输入仍保持原有不完整与估算语义', () => {
  const missing = adEconomics({ ...base(), purchaseCost: null, referralFeePct: '' });
  assert.equal(missing.status, 'INCOMPLETE');
  assert.equal(missing.missing.length, 2);
  const provisional = adEconomics({ ...base(), notApplicable: [], otherUnitCost: null });
  assert.equal(provisional.status, 'PROVISIONAL');
  assert.equal(provisional.assumedZero.length, 3);
  const noCvr = adEconomics({ ...base(), cvrPct: '', targetMarginPct: null });
  assert.equal(noCvr.盈亏平衡CPC, null);
  assert.equal(noCvr.利润底线每件, null);
  assert.equal(adEconomics(base()).目标CPC, 0.8);
});

test('广告经济线拒绝拼错字段和无效的不适用声明', () => {
  assert.throws(() => adEconomics({ ...base(), couponDiscount: 5 }), /couponDiscount/);
  assert.throws(() => adEconomics({ ...base(), notApplicable: ['purchaseCost'] }), /notApplicable/);
  assert.throws(() => adEconomics(null), /对象/);
});

test('利润底线耗尽广告空间时阻断，仍提供参考盈亏线', () => {
  const equal = adEconomics({ ...base(), targetProfitPerUnit: 10 });
  assert.equal(equal.status, 'BLOCKED');
  assert.equal(equal.目标CPC, 0);
  assert.equal(equal.目标ACoS, 0);
  assert.equal(equal.盈亏平衡CPC, 1);
  assert.match(equal.statusMeaning, /利润底线/);
  const over = adEconomics({ ...base(), targetProfitPerUnit: 11 });
  assert.equal(over.status, 'BLOCKED');
  assert.equal(over.目标CPC, null);
  assert.equal(over.目标ACoS, null);
  const unknownCvr = adEconomics({ ...base(), targetProfitPerUnit: 10, cvrPct: null });
  assert.equal(unknownCvr.status, 'BLOCKED');
  assert.equal(unknownCvr.目标CPC, null);
});

test('MCP 广告计算入口即使未做 schema 预校验也拒绝非法输入', async () => {
  const home = isolate();
  try {
    const { buildTools } = await import('../server/tools.js');
    const tool = buildTools('test').find(item => item.name === 'xander_calc_ad_economics');
    await assert.rejects(() => tool.handler({ ...base(), fbaFee: -10 }), /fbaFee/);
    await assert.rejects(() => tool.handler({ ...base(), cvrPct: 150 }), /cvrPct/);
    await assert.rejects(() => tool.handler({ ...base(), couponDiscount: 5 }), /couponDiscount/);
    assert.equal((await tool.handler(base())).目标CPC, 0.8);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
