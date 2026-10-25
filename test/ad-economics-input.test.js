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

test('分摊成本保留到最终输出，不能提前按分取整抬高 CPC', () => {
  const common = { ...base(), referralFeePct: 0, fbaFee: 0, firstLegCost: 0, cvrPct: 100, targetMarginPct: 0 };
  const halfCent = adEconomics({ ...common, price: 2, purchaseCost: 1.005 });
  assert.equal(halfCent.perUnit.采购, 1.01, '显示使用十进制四舍五入');
  assert.equal(halfCent.盈亏平衡ACoS, 49.75);
  assert.equal(halfCent.盈亏平衡CPC, 0.99, '实际贡献0.995不能变成1.00的CPC');
  const subCent = adEconomics({ ...common, price: 1, purchaseCost: 0.004 });
  assert.equal(subCent.盈亏平衡CPC, 0.99);
  assert.equal(subCent.目标CPC, 0.99);
  const priceFraction = adEconomics({ ...common, price: 1.005, purchaseCost: 0 });
  assert.equal(priceFraction.perUnit.含税售价, 1.01);
  assert.equal(priceFraction.目标CPC, 1);
});

test('精确低于一分边界的CPC不会被浮点epsilon向上释放', () => {
  const r = adEconomics({ ...base(), price: 1, referralFeePct: 1e-10, fbaFee: 0, purchaseCost: 0, firstLegCost: 0, cvrPct: 100, targetMarginPct: 0 });
  assert.equal(r.盈亏平衡CPC, 0.99);
  assert.equal(r.目标CPC, 0.99);
  const tinyCost = adEconomics({ ...base(), price: 1, referralFeePct: 0, fbaFee: 0, purchaseCost: 1e-7, firstLegCost: 0, cvrPct: 100, targetMarginPct: 0 });
  assert.equal(tinyCost.目标CPC, 0.99);
});

test('不适用声明不能与同名成本同时提供，确认零成本可只填0', () => {
  for (const field of ['otherUnitCost', 'returnsCostPerUnit', 'refundLossPerUnit']) {
    for (const value of [0, 0.2, null]) assert.throws(() => adEconomics({ ...base(), [field]: value }), /notApplicable/);
  }
  assert.equal(adEconomics({ ...base(), notApplicable: [], otherUnitCost: 0, returnsCostPerUnit: 0, refundLossPerUnit: 0 }).status, 'READY_ESTIMATED');
});

test('退款损失以税前收入为界，拒绝负净收入但允许全额退款情景', () => {
  const values = { ...base(), price: 24, vatPct: 20, notApplicable: ['otherUnitCost', 'returnsCostPerUnit'] };
  assert.throws(() => adEconomics({ ...values, refundLossPerUnit: 20.001 }), /refundLossPerUnit/);
  const allRefunded = adEconomics({ ...values, refundLossPerUnit: 20 });
  assert.equal(allRefunded.perUnit.净销售额, 0);
  assert.equal(allRefunded.status, 'BLOCKED');
});

test('金额与净收入比例利润底线取严格者，风险缓冲不被忽略', () => {
  const combined = adEconomics({ ...base(), price: 24, vatPct: 20, refundLossPerUnit: 2, notApplicable: ['otherUnitCost', 'returnsCostPerUnit'], targetProfitPerUnit: 2, riskBufferPerUnit: 0.1, cvrPct: 12, attributedSalesPerOrder: 18 });
  assert.equal(combined.perUnit.净销售额, 18);
  assert.equal(combined.perUnit.广告前贡献利润, 7.4);
  assert.equal(combined.利润底线每件, 2.1);
  assert.equal(combined.目标ACoS, 29.44);
  assert.equal(combined.目标CPC, 0.63);
  const bufferOnly = adEconomics({ ...base(), targetMarginPct: null, riskBufferPerUnit: 1.005 });
  assert.equal(bufferOnly.利润底线每件, 1.01);
  assert.equal(bufferOnly.目标CPC, 0.89);
});

test('缺CVR与零CVR分别报告，ACoS代用分母和单位明确且没有执行授权', () => {
  const missing = adEconomics({ ...base(), cvrPct: null });
  assert.equal(missing.status, 'READY_ESTIMATED', '只有CPC缺输入，不阻断可算的ACoS');
  assert.equal(missing.metricStatus.breakEvenCpc, 'UNAVAILABLE_CVR');
  assert.equal(missing.盈亏平衡CPC, null);
  assert.match(missing.statusMeaning, /未提供转化率/);
  const zero = adEconomics({ ...base(), cvrPct: 0 });
  assert.equal(zero.目标CPC, 0);
  assert.equal(zero.metricStatus.targetCpc, 'NO_AD_CAPACITY');
  assert.equal(zero.modelBasis.attributedSalesBasis, 'PRICE_PROXY');
  assert.equal(zero.modelBasis.outputAcosUnit, 'PERCENT');
  assert.equal(zero.executionAuthorized, false);
  const reported = adEconomics({ ...base(), attributedSalesPerOrder: 10 });
  assert.equal(reported.modelBasis.attributedSalesBasis, 'INPUT_ESTIMATE');
  assert.equal(reported.盈亏平衡ACoS, 100);
  assert.equal(reported.目标ACoS, 80);
  assert.equal(reported.目标CPC, 0.8, '改变ACoS收入分母不改变每单贡献×CVR');
});
