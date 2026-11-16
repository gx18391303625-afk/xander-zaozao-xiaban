// 快速经济线（lib/calc.js，MCP 工具 xander_calc_ad_economics）和完整模型
// （技能里的 calculate_ad_economics.py，策略包校验也用它）共用同一套核心口径：
// 同样的输入，盈亏平衡/目标 ACoS 与 CPC 必须一致，防止两边各改各的。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adEconomics } from '../lib/calc.js';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/build-amazon-advertising-strategy/scripts');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const rate = (pct) => String(pct / 100);

function toPython(i) {
  const py = {
    marketplace: i.vatPct ? 'UK' : 'US', scope_id: 'PARITY', currency: i.vatPct ? 'GBP' : 'USD', data_mode: 'NEW_PRODUCT',
    calculation_scope: 'ECONOMICS_ONLY', price_includes_tax: !!i.vatPct,
    fees_verified: true, costs_verified: true, tax_basis_verified: true,
    selling_price: String(i.price), referral_fee_rate: rate(i.referralFeePct), referral_fee_basis_amount: String(i.price),
    fulfillment_fee: String(i.fbaFee), cogs: String(i.purchaseCost), inbound_freight: String(i.firstLegCost),
  };
  if (i.vatPct) py.tax_rate = rate(i.vatPct);
  if (i.otherUnitCost !== undefined) py.other_variable_cost = String(i.otherUnitCost);
  if (i.refundLossPerUnit !== undefined || i.returnsCostPerUnit !== undefined) {
    py.returns_mode = 'ALLOWANCE_AMOUNT';
    py.expected_refund_revenue_loss = String(i.refundLossPerUnit ?? 0);
    py.return_nonrevenue_cost = String(i.returnsCostPerUnit ?? 0);
  }
  if (i.attributedSalesPerOrder !== undefined) Object.assign(py, { ad_attributed_sales_per_order: String(i.attributedSalesPerOrder), attributed_sales_data_class: 'ESTIMATED' });
  else py.allow_revenue_proxy = true;
  if (i.cvrPct !== undefined) Object.assign(py, { conversion_rate: rate(i.cvrPct), conversion_data_class: 'ASSUMPTION' });
  if (i.targetProfitPerUnit !== undefined) py.target_profit_per_order = String(i.targetProfitPerUnit);
  if (i.targetMarginPct !== undefined) py.minimum_post_ads_contribution_rate = rate(i.targetMarginPct);
  if (i.riskBufferPerUnit !== undefined) py.risk_buffer_per_order = String(i.riskBufferPerUnit);
  return py;
}

function runPython(input) {
  const code = `import json, sys\nsys.path.insert(0, ${JSON.stringify(scripts)})\nfrom calculate_ad_economics import calculate\nprint(json.dumps(calculate(json.load(sys.stdin))["ceilings"]))`;
  const r = spawnSync('python3', ['-c', code], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const pctOrNull = (v) => (v === null ? null : Math.round(Number(v) * 10000) / 100);
const moneyOrNull = (v) => (v === null ? null : Number(v));

const CASES = {
  '美国站，无利润底线': { price: 29.99, referralFeePct: 15, fbaFee: 5.2, purchaseCost: 4.1, firstLegCost: 1.3, cvrPct: 12 },
  '美国站，金额底线+风险缓冲+退货': { price: 24.99, referralFeePct: 15, fbaFee: 4.75, purchaseCost: 5.4, firstLegCost: 0.9, otherUnitCost: 0.35,
    refundLossPerUnit: 0.6, returnsCostPerUnit: 0.4, targetProfitPerUnit: 2, riskBufferPerUnit: 0.5, cvrPct: 9, attributedSalesPerOrder: 27.5 },
  '英国含税站，利润率底线': { price: 19.99, referralFeePct: 15.3, vatPct: 20, fbaFee: 3.1, purchaseCost: 2.8, firstLegCost: 0.7, targetMarginPct: 12, cvrPct: 10 },
  '金额与比例底线取更严格者': { price: 39.99, referralFeePct: 8, fbaFee: 6.1, purchaseCost: 7.25, firstLegCost: 2.1, targetProfitPerUnit: 1, targetMarginPct: 20, cvrPct: 7.5 },
  '广告前已亏损': { price: 12.99, referralFeePct: 15, fbaFee: 5.8, purchaseCost: 5.5, firstLegCost: 1.2, cvrPct: 10 },
};

for (const [name, input] of Object.entries(CASES)) {
  test(`广告经济线 JS/Python 一致：${name}`, { skip: !hasPython && '未安装 python3' }, () => {
    const js = adEconomics(input);
    const py = runPython(toPython(input));
    const hasFloor = ['targetProfitPerUnit', 'targetMarginPct', 'riskBufferPerUnit'].some((k) => input[k] !== undefined);
    assert.equal(js.盈亏平衡ACoS, pctOrNull(py.operating_break_even_acos), '盈亏平衡 ACoS');
    assert.equal(js.盈亏平衡CPC, moneyOrNull(py.break_even_cpc), '盈亏平衡 CPC');
    if (hasFloor) {
      assert.equal(js.目标ACoS, pctOrNull(py.target_acos), '目标 ACoS');
      assert.equal(js.目标CPC, moneyOrNull(py.target_cpc), '目标 CPC');
    }
  });
}
