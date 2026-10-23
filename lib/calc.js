// 三个随手可用的计算器（任何宿主都能用，不需要 Python）。
// 原则：缺的输入就是缺，结果给 null 并列出缺口，绝不拿 0 去凑。
// 更完整的广告经济/策略校验仍用技能里的 Python 脚本。

const toCents = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const fromCents = (c) => (c === null ? null : c / 100);
const round = (v, d = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// ---------- 广告经济线 ----------
export function adEconomics(i) {
  const missing = [];
  const need = (k, label) => { const c = toCents(i[k]); if (c === null) missing.push(label); return c; };
  const price = need('price', '售价 price');
  const fba = need('fbaFee', 'FBA 配送费 fbaFee（自发货填自己的配送成本）');
  const cogs = need('purchaseCost', '采购成本 purchaseCost');
  const firstLeg = need('firstLegCost', '头程 firstLegCost');
  const referralPct = i.referralFeePct === undefined ? null : Number(i.referralFeePct);
  if (referralPct === null) missing.push('佣金比例 referralFeePct');
  const other = toCents(i.otherUnitCost) ?? 0;
  const returnsAllowance = toCents(i.returnsCostPerUnit) ?? 0;
  const vatPct = Number(i.vatPct || 0);

  const out = { inputs: i, missing, assumptions: [] };
  if (!i.otherUnitCost) out.assumptions.push('其他单件成本未提供，按 0 计（请确认确实没有）');
  if (!i.returnsCostPerUnit) out.assumptions.push('退货损耗未提供，按 0 计');
  if (missing.length) return { ...out, status: 'INCOMPLETE', note: '缺核心输入，不能给出盈亏线。' };

  const netPrice = vatPct ? Math.round(price / (1 + vatPct / 100)) : price;
  const referral = Math.round(price * referralPct / 100);
  const contribution = netPrice - referral - fba - cogs - firstLeg - other - returnsAllowance;
  const be = contribution / price;
  const targetProfit = i.targetProfitPerUnit !== undefined ? toCents(i.targetProfitPerUnit)
    : i.targetMarginPct !== undefined ? Math.round(price * Number(i.targetMarginPct) / 100) : null;
  const target = targetProfit === null ? null : (contribution - targetProfit) / price;
  const cvr = i.cvrPct !== undefined ? Number(i.cvrPct) / 100 : null;

  return {
    ...out,
    status: contribution <= 0 ? 'NO_AD_ROOM' : 'OK',
    perUnit: {
      售价: fromCents(price), 不含税售价: fromCents(netPrice), 佣金: fromCents(referral), 配送费: fromCents(fba),
      采购: fromCents(cogs), 头程: fromCents(firstLeg), 其他: fromCents(other), 退货损耗: fromCents(returnsAllowance),
      广告前贡献利润: fromCents(contribution),
    },
    盈亏平衡ACoS: round(be * 100), 目标ACoS: target === null ? null : round(target * 100),
    盈亏平衡CPC: cvr === null ? null : round(fromCents(price) * be * cvr),
    目标CPC: cvr === null || target === null ? null : round(fromCents(price) * target * cvr),
    notes: [
      contribution <= 0 ? '广告前就不赚钱：任何广告花费都会扩大亏损。' : null,
      cvr === null ? '没有转化率（cvrPct），不能给 CPC 上限。' : null,
      targetProfit === null ? '没有目标利润，只给盈亏平衡线。' : null,
      'ACoS 以广告归因销售额为分母；TACoS 需要总销售额，不能混用。',
    ].filter(Boolean),
  };
}

// ---------- 补货 ----------
// rows: [{ sku, dailySales, sellable, inbound:[{qty, availableInDays}], leadTimeDays, safetyDays, coverDays, casePack, moq, unitCost }]
export function replenishment({ rows, scenarios = [0.8, 1, 1.2] }) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('rows 不能为空');
  return rows.map((r) => {
    const missing = [];
    const num = (k, label) => { const v = r[k]; if (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) { missing.push(label); return null; } return Number(v); };
    const daily = num('dailySales', '日均销量 dailySales');
    const sellable = num('sellable', '当前可售 sellable');
    const lead = num('leadTimeDays', '从下单到可售的总天数 leadTimeDays');
    const safety = r.safetyDays === undefined ? null : Number(r.safetyDays);
    const cover = r.coverDays === undefined ? null : Number(r.coverDays);
    const inbound = (r.inbound || []).map((x) => ({ qty: Number(x.qty), day: x.availableInDays === undefined || x.availableInDays === null ? null : Number(x.availableInDays) }));
    const unknownEta = inbound.filter((x) => x.day === null);
    const base = { sku: r.sku, missing, warnings: [] };
    if (unknownEta.length) base.warnings.push(`${unknownEta.length} 笔在途没有可售日期，未计入时间线（不能当现货）。`);
    if (daily === null || sellable === null) return { ...base, status: 'INCOMPLETE' };

    // 断货日：逐日推演
    const timeline = inbound.filter((x) => x.day !== null).sort((a, b) => a.day - b.day);
    const stockoutDay = (mult) => {
      let stock = sellable;
      for (let d = 1; d <= 730; d++) {
        for (const x of timeline) if (x.day === d) stock += x.qty;
        stock -= daily * mult;
        if (stock < 0) return d;
      }
      return null;
    };
    const res = {
      ...base,
      当前可售天数: daily > 0 ? round(sellable / daily, 1) : null,
      预计断货天数: stockoutDay(1),
    };
    if (lead === null || safety === null || cover === null) {
      if (safety === null) missing.push('安全库存天数 safetyDays');
      if (cover === null) missing.push('到货后要覆盖的天数 coverDays');
      return { ...res, status: 'PARTIAL', note: '缺交期/安全天数/覆盖天数，只给续航，不给补货量。' };
    }
    const horizon = lead + cover + safety;
    const supplyBefore = sellable + timeline.filter((x) => x.day <= lead + cover).reduce((s, x) => s + x.qty, 0);
    res.情景 = scenarios.map((m) => {
      const need = Math.max(0, Math.ceil(daily * m * horizon - supplyBefore));
      let qty = need;
      let cartons = null;
      if (r.casePack) { cartons = Math.ceil(qty / Number(r.casePack)); qty = cartons * Number(r.casePack); }
      if (r.moq && qty > 0 && qty < Number(r.moq)) {
        qty = Number(r.moq);
        if (r.casePack) { cartons = Math.ceil(qty / Number(r.casePack)); qty = cartons * Number(r.casePack); }
      }
      return {
        需求倍数: m, 需要件数: need, 建议件数: qty, 箱数: cartons, 超出需求件数: qty - need,
        采购金额: r.unitCost !== undefined && r.unitCost !== null ? round(qty * Number(r.unitCost)) : null,
        断货天数_不补货: stockoutDay(m),
      };
    });
    if (lead && res.预计断货天数 !== null && res.预计断货天数 < lead) res.warnings.push(`按当前速度第 ${res.预计断货天数} 天断货，早于新货可售（第 ${lead} 天）：需要考虑加急、空运或控速。`);
    if (!r.casePack) res.warnings.push('没有箱规，只给件数，不给箱数。');
    res.status = 'SCENARIO';
    res.口径 = `需求窗口 = 交期 ${lead} + 覆盖 ${cover} + 安全 ${safety} = ${horizon} 天；供给 = 当前可售 + 窗口内可售的在途。需求倍数是情景，不是预测概率。`;
    return res;
  });
}

// ---------- 利润桥 ----------
// items: [{ name, amount, category: revenue|fee|ads|cogs|refund|other, status: INCLUDED|NETTED|EXTRA_PAID|ESTIMATED|UNKNOWN|USER_EXCLUDED }]
// amount 用正数；收入为正，费用/成本按正数填，程序自动当作扣减。
export function profitBridge({ items, currency }) {
  if (!Array.isArray(items) || !items.length) throw new Error('items 不能为空');
  const CORE = ['revenue', 'fee', 'ads', 'cogs'];
  const lines = [];
  let subtotal = 0;
  const present = new Set();
  const unknown = [];
  const estimated = [];
  for (const it of items) {
    const st = it.status || 'INCLUDED';
    const c = toCents(it.amount);
    if (st === 'UNKNOWN' || c === null) { unknown.push(it.name); present.add(`${it.category}:unknown`); lines.push({ ...it, status: 'UNKNOWN', 计入: false }); continue; }
    if (st === 'NETTED' || st === 'USER_EXCLUDED') { lines.push({ ...it, 计入: false, 说明: st === 'NETTED' ? '已含在其他净额里，不再扣' : '本次用户指定排除' }); continue; }
    const signed = it.category === 'revenue' ? c : -Math.abs(c);
    subtotal += signed;
    present.add(it.category);
    if (st === 'ESTIMATED') estimated.push(it.name);
    lines.push({ ...it, 计入: true, 计入金额: fromCents(signed) });
  }
  const missingCore = CORE.filter((k) => !present.has(k));
  const complete = missingCore.length === 0 && unknown.length === 0;
  return {
    currency: currency || null,
    lines,
    已知收支小计: fromCents(subtotal),
    经营利润: complete ? fromCents(subtotal) : null,
    状态: complete ? (estimated.length ? 'ESTIMATE' : 'REVIEWED') : 'KNOWN_SUBTOTAL_ONLY',
    缺少的核心项: missingCore.map((k) => ({ revenue: '收入', fee: '平台/配送费', ads: '广告费', cogs: '售出成本' }[k])),
    未知项: unknown,
    估算项: estimated,
    说明: complete ? null : '缺核心项或有未知项：只能叫“已知收支小计”，不能叫利润。',
  };
}
