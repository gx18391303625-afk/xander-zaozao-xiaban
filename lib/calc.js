// 三个随手可用的计算器（任何宿主都能用，不需要 Python）。
// 口径与技能规则一致：
//   广告经济线 ← build-amazon-advertising-strategy/references/economics-calculation.md
//   补货       ← plan-amazon-replenishment/references/demand-and-quantity.md、inventory-and-fulfillment.md
//   利润桥     ← reconcile-amazon-profit/references/*.md
// 原则：缺的输入就是缺，结果给 null 并列出缺口，绝不拿 0 去凑；假设为 0 的结果标 PROVISIONAL（偏乐观，不叫保守）。
// 更完整的广告经济/策略校验仍用技能里的 Python 脚本。

const toCents = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const fromCents = (c) => (c === null ? null : c / 100);
const round = (v, d = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const floorCent = (v) => (v === null || !Number.isFinite(v) ? null : Math.floor(v * 100 + 1e-9) / 100);

// ---------- 广告经济线（单件，单件订单） ----------
const OPTIONAL_COSTS = {
  otherUnitCost: '其他单件成本（包装、贴标、质检、关税、仓储等）',
  returnsCostPerUnit: '退货非收入损耗/件（退货处理、运费、报废）',
  refundLossPerUnit: '预计退款造成的收入损失/件',
};

const AD_MONEY_INPUTS = ['price', 'fbaFee', 'purchaseCost', 'firstLegCost', ...Object.keys(OPTIONAL_COSTS), 'attributedSalesPerOrder', 'targetProfitPerUnit', 'riskBufferPerUnit'];
const AD_PERCENT_INPUTS = ['referralFeePct', 'vatPct', 'targetMarginPct', 'cvrPct'];
const AD_INPUT_FIELDS = new Set([...AD_MONEY_INPUTS, ...AD_PERCENT_INPUTS, 'notApplicable']);
const absentNumber = (v) => v === undefined || v === null || v === '';

// The quick MCP calculator needs the same input boundaries as the full model.
// Missing values remain missing; malformed values must never become zero or READY.
function validateAdInputs(i) {
  if (!i || typeof i !== 'object' || Array.isArray(i)) throw new Error('广告经济线输入必须是对象');
  const unknown = Object.keys(i).filter((k) => !AD_INPUT_FIELDS.has(k));
  if (unknown.length) throw new Error(`广告经济线不支持这些字段：${unknown.join(', ')}；请使用已支持字段，复杂成本用完整 Python 模型。`);
  for (const k of [...AD_MONEY_INPUTS, ...AD_PERCENT_INPUTS]) {
    const value = i[k];
    if (absentNumber(value)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${k} 必须是有限数字`);
    if (value < 0) throw new Error(`${k} 不能为负数`);
    if (AD_PERCENT_INPUTS.includes(k) && value > 100) throw new Error(`${k} 必须在 0–100% 之间`);
    if (AD_MONEY_INPUTS.includes(k) && !Number.isSafeInteger(Math.round(value * 100))) throw new Error(`${k} 超出可精确计算的金额范围`);
    if (['price', 'attributedSalesPerOrder'].includes(k) && Math.round(value * 100) <= 0) throw new Error(`${k} 必须是按分可表示的正金额`);
  }
  if (i.notApplicable !== undefined && (!Array.isArray(i.notApplicable) || i.notApplicable.some((k) => !Object.hasOwn(OPTIONAL_COSTS, k)))) {
    throw new Error('notApplicable 只能包含已支持的可选成本字段');
  }
}

export function adEconomics(i) {
  validateAdInputs(i);
  const missing = [];
  const need = (k, label) => { const c = toCents(i[k]); if (c === null) missing.push(label); return c; };
  const price = need('price', '售价 price（含税站点填含税价）');
  const fba = need('fbaFee', 'FBA 配送费 fbaFee（自发货填自己的配送成本）');
  const cogs = need('purchaseCost', '采购成本 purchaseCost');
  const firstLeg = need('firstLegCost', '头程 firstLegCost');
  const referralPct = absentNumber(i.referralFeePct) ? null : i.referralFeePct;
  if (referralPct === null) missing.push('佣金比例 referralFeePct');
  const vatPct = absentNumber(i.vatPct) ? 0 : i.vatPct;

  const notApplicable = new Set(Array.isArray(i.notApplicable) ? i.notApplicable : []);
  const assumedZero = [];
  const opt = {};
  for (const [k, label] of Object.entries(OPTIONAL_COSTS)) {
    const c = toCents(i[k]);
    if (c !== null) opt[k] = c;
    else { opt[k] = 0; if (!notApplicable.has(k)) assumedZero.push(label); }
  }

  const out = { inputs: i, missing, assumedZero };
  if (missing.length) return { ...out, status: 'INCOMPLETE', note: '缺核心输入，不能给出盈亏线。' };

  // 收入：含税站点先去税；退款损失减收入
  const pretax = vatPct ? price / (1 + vatPct / 100) : price;
  const netSales = pretax - opt.refundLossPerUnit;
  // 佣金按含税成交价计算（亚马逊口径）
  const referral = price * referralPct / 100;
  const contribution = netSales - referral - fba - cogs - firstLeg - opt.otherUnitCost - opt.returnsCostPerUnit;
  // ACoS 分母 = 广告归因销售额（每单 ≈ 含税成交价）
  const attributed = toCents(i.attributedSalesPerOrder) ?? price;
  const be = contribution / attributed;

  // 利润底线：金额 与 净销售额×比例 取更严格的；风险缓冲另加
  const floorAmount = toCents(i.targetProfitPerUnit);
  const floorRate = absentNumber(i.targetMarginPct) ? null : netSales * i.targetMarginPct / 100;
  const floors = [floorAmount, floorRate].filter((x) => x !== null);
  const targetFloor = floors.length ? Math.max(...floors) + (toCents(i.riskBufferPerUnit) ?? 0) : null;
  const capacity = targetFloor === null ? null : contribution - targetFloor;
  const cvr = absentNumber(i.cvrPct) ? null : i.cvrPct / 100;

  let status;
  if (contribution <= 0 || (capacity !== null && capacity <= 0)) status = 'BLOCKED';
  else if (assumedZero.length) status = 'PROVISIONAL';
  else status = 'READY_ESTIMATED';

  return {
    ...out,
    status,
    statusMeaning: {
      BLOCKED: contribution <= 0
        ? '广告前就不赚钱或刚好打平：这个价格/成本下没有做广告的空间。'
        : '利润底线已耗尽或超过贡献利润：在当前底线下没有广告空间。',
      PROVISIONAL: `有成本按 0 假设（${assumedZero.join('、')}），结果偏乐观，不是保守估计。确认确实没有的项目请放进 notApplicable。`,
      READY_ESTIMATED: '成本齐全；转化率和归因销售额仍是估计值。',
    }[status],
    perUnit: {
      含税售价: fromCents(price), 不含税收入: round(fromCents(pretax)), 退款收入损失: fromCents(opt.refundLossPerUnit), 净销售额: round(fromCents(netSales)),
      佣金: round(fromCents(referral)), 配送费: fromCents(fba), 采购: fromCents(cogs), 头程: fromCents(firstLeg),
      其他: fromCents(opt.otherUnitCost), 退货损耗: fromCents(opt.returnsCostPerUnit),
      广告前贡献利润: round(fromCents(contribution)),
    },
    盈亏平衡ACoS: contribution > 0 ? round(be * 100) : null,
    目标ACoS: capacity === null ? null : capacity >= 0 ? round(capacity / attributed * 100) : null,
    利润底线每件: targetFloor === null ? null : round(fromCents(targetFloor)),
    盈亏平衡CPC: cvr === null || contribution <= 0 ? null : floorCent(fromCents(contribution) * cvr),
    目标CPC: cvr === null || capacity === null || capacity < 0 ? null : floorCent(fromCents(capacity) * cvr),
    notes: [
      contribution <= 0 ? '广告前就不赚钱：任何广告花费都会扩大亏损。' : null,
      capacity !== null && capacity <= 0 ? '利润底线已经吃掉全部贡献利润：在这个底线下没有广告空间。' : null,
      cvr === null ? '没有转化率（cvrPct），不能给 CPC 上限。' : null,
      targetFloor === null ? '没有利润底线（targetProfitPerUnit / targetMarginPct），只给盈亏平衡线。' : null,
      targetFloor !== null && floorRate !== null ? '利润率底线按“不含税净销售额”计算。' : null,
      'CPC 上限已向下取整到分。ACoS 以广告归因销售额为分母；TACoS 需要总销售额，不能混用。',
    ].filter(Boolean),
  };
}

// ---------- 补货（逐日推演） ----------
// rows: [{ sku, dailySales, sellable, inbound:[{qty, availableInDays}], leadTimeDays, coverDays, safetyDays, casePack, moq, unitCost }]
//  - availableInDays：第几天“当天结束时”入库可售（保守：当天的需求用不上，第二天才能卖）
//  - leadTimeDays：现在下单，新货从第几天起可售（A）
//  - coverDays：新货要覆盖的天数（窗口 = 第 A 天 到 第 A+coverDays-1 天）
//  - safetyDays：窗口内每天结束时至少留多少天的库存
export function replenishment({ rows, scenarios = [0.8, 1, 1.2] }) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('rows 不能为空');
  return rows.map((r) => {
    const missing = [];
    const num = (k, label) => { const v = r[k]; if (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) { missing.push(label); return null; } return Number(v); };
    const daily = num('dailySales', '日均销量 dailySales（件/天，用实际件数，不用订单数）');
    const sellable = num('sellable', '当前可售 sellable');
    const inbound = (r.inbound || []).map((x) => ({ qty: Number(x.qty), day: x.availableInDays === undefined || x.availableInDays === null ? null : Number(x.availableInDays) }));
    const unknownEta = inbound.filter((x) => x.day === null);
    const base = { sku: r.sku, missing, warnings: [] };
    if (unknownEta.length) base.warnings.push(`${unknownEta.length} 笔在途没有可售日期，未计入时间线（不能当现货）。`);
    if (daily === null || sellable === null) return { ...base, status: 'INCOMPLETE' };
    if (daily <= 0) return { ...base, status: 'PARTIAL', note: '日需求为 0 或未知：续航无法估计（不是“无限”）。断货期的零销量不能当零需求。' };

    const arrivals = new Map();
    for (const x of inbound) if (x.day !== null) arrivals.set(x.day, (arrivals.get(x.day) || 0) + x.qty);

    // 逐日推演（库存不为负；卖不出去的记为失销）
    const project = (mult, days) => {
      let stock = sellable;
      let lost = 0;
      let stockout = null;
      for (let d = 1; d <= days; d++) {
        const demand = daily * mult;
        const served = Math.min(stock, demand);
        if (served < demand && stockout === null) stockout = d;
        lost += demand - served;
        stock -= served;
        stock += arrivals.get(d) || 0; // 当天结束入库
      }
      return { stock, lost, stockout };
    };

    const horizonAll = project(1, 730);
    const res = {
      ...base,
      当前可售天数: round(sellable / daily, 1),
      预计断货天数: horizonAll.stockout,
    };
    const lead = r.leadTimeDays === undefined ? null : Number(r.leadTimeDays);
    const cover = r.coverDays === undefined ? null : Number(r.coverDays);
    const safety = r.safetyDays === undefined ? null : Number(r.safetyDays);
    if (![lead, cover, safety].every((x) => x !== null && Number.isFinite(x) && x >= 0) || cover < 1 || lead < 1) {
      if (lead === null) missing.push('新货可售所需天数 leadTimeDays');
      if (cover === null) missing.push('新货要覆盖的天数 coverDays');
      if (safety === null) missing.push('安全库存天数 safetyDays');
      return { ...res, status: 'PARTIAL', note: '缺交期/覆盖天数/安全天数，只给续航，不给补货量。' };
    }

    res.情景 = scenarios.map((m) => {
      const demand = daily * m;
      const beforeA = project(m, lead - 1); // 第 A 天开始前
      const safetyUnits = safety * demand;
      // 窗口内每天“当天卖完后”的库存 ≥ 安全库存；新货 Q 在第 A 天开始前入库。
      // 加了 Q 之后窗口内不会断货，所以库存只是整体抬高 Q：Q = max(安全量 + 累计需求 − 起始库存 − 已到货)
      let stockNoQ = beforeA.stock;
      let need = 0;
      for (let d = lead; d <= lead + cover - 1; d++) {
        stockNoQ -= demand;
        need = Math.max(need, safetyUnits - stockNoQ);
        stockNoQ += arrivals.get(d) || 0;
      }
      need = Math.max(0, Math.ceil(need - 1e-9));
      let qty = need;
      let cartons = null;
      if (r.casePack) { cartons = Math.ceil(qty / Number(r.casePack)); qty = cartons * Number(r.casePack); }
      if (r.moq && qty > 0 && qty < Number(r.moq)) {
        qty = Number(r.moq);
        if (r.casePack) { cartons = Math.ceil(qty / Number(r.casePack)); qty = cartons * Number(r.casePack); }
      }
      return {
        需求倍数: m, 需要件数: need, 建议件数: qty, 箱数: cartons, 超出需求件数: qty - need,
        新货可售前预计失销件数: round(beforeA.lost, 0),
        新货可售前断货日: beforeA.stockout,
        采购金额: r.unitCost !== undefined && r.unitCost !== null ? round(qty * Number(r.unitCost)) : null,
      };
    });
    if (res.预计断货天数 !== null && res.预计断货天数 < lead) {
      res.warnings.push(`按当前速度第 ${res.预计断货天数} 天断货，早于新货可售（第 ${lead} 天）：期间的失销量不会被这次补货补回，需要考虑加急、空运或控速。`);
    }
    if (!r.casePack) res.warnings.push('没有箱规，只给件数，不给箱数。');
    res.status = 'SCENARIO';
    res.口径 = `窗口 = 第 ${lead} 天到第 ${lead + cover - 1} 天（共 ${cover} 天），每天卖完后至少留 ${safety} 天库存；在途按“当天结束入库、次日可卖”计。新货到之前卖不出去的量单独列出，不计入补货量。需求倍数是情景，不是预测概率。`;
    return res;
  });
}

// ---------- 利润桥 ----------
// items: [{ name, amount, category: revenue|fee|ads|cogs|refund|adjustment|other, status: INCLUDED|NETTED|EXTRA_PAID|ESTIMATED|UNKNOWN|USER_EXCLUDED }]
//  revenue 正数 = 收入；fee/ads/cogs/refund/other 填正数 = 扣减；adjustment 按原符号（正 = 加，负 = 减）。
//  某个核心项确实为 0（比如本期没有退款）也要填一行 amount=0，表示“已确认为 0”，否则视为缺项。
const CORE = { revenue: '收入', fee: '平台/配送费', ads: '广告费', cogs: '售出成本', refund: '退款' };

export function profitBridge({ items, currency }) {
  if (!Array.isArray(items) || !items.length) throw new Error('items 不能为空');
  const lines = [];
  const warnings = [];
  let subtotal = 0;
  const present = new Set();
  const unknown = [];
  const estimated = [];
  for (const it of items) {
    const st = it.status || 'INCLUDED';
    const c = toCents(it.amount);
    if (st === 'UNKNOWN' || c === null) { unknown.push(it.name); lines.push({ ...it, status: 'UNKNOWN', 计入: false }); continue; }
    if (st === 'NETTED' || st === 'USER_EXCLUDED') { lines.push({ ...it, 计入: false, 说明: st === 'NETTED' ? '已含在其他净额里，不再扣' : '本次用户指定排除（不自动延续到最终总账）' }); continue; }
    const signed = it.category === 'revenue' ? c : it.category === 'adjustment' ? c : -Math.abs(c);
    subtotal += signed;
    present.add(it.category);
    if (st === 'ESTIMATED') estimated.push(it.name);
    if (st === 'EXTRA_PAID') warnings.push(`“${it.name}”标为另付费用：先确认它没有被资本化进采购成本、也没有在其他分项里扣过，否则会重复扣。`);
    lines.push({ ...it, 计入: true, 计入金额: fromCents(signed) });
  }
  const missingCore = Object.keys(CORE).filter((k) => !present.has(k));
  const complete = missingCore.length === 0 && unknown.length === 0;
  return {
    currency: currency || null,
    lines,
    已知收支小计: fromCents(subtotal),
    经营利润: complete ? fromCents(subtotal) : null,
    状态: complete ? (estimated.length ? 'ESTIMATE' : 'COMPLETE_INPUTS') : 'KNOWN_SUBTOTAL_ONLY',
    状态说明: complete
      ? (estimated.length ? '核心项齐全，但含估算项：这是暂定利润。' : '核心项齐全且都有依据：期间经营利润（仍不等于结算后的最终利润）。')
      : '缺核心项或有未知项：只能叫“已知收支小计”，不能叫利润。',
    缺少的核心项: missingCore.map((k) => CORE[k]),
    未知项: unknown,
    估算项: estimated,
    提醒: warnings,
  };
}
