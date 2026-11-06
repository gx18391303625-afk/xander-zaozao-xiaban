// Pure, local arithmetic over supplied report rows. No account access or write authority.
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const text = { type: 'string', minLength: 1, maxLength: 2048 };
const choice = (...values) => ({ type: 'string', enum: values });
const number = { type: ['number', 'null'], minimum: 0, maximum: 1e12 };
const count = { ...number, type: ['integer', 'null'] };
const signed = { ...number, minimum: -1e12 };
const flag = { type: ['boolean', 'null'] };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const basis = obj({ adProduct: choice('SP', 'SB', 'SD'), chargeType: choice('CPC', 'CPM', 'VCPM', 'OTHER', 'UNKNOWN'),
  interaction: choice('CLICK', 'VIEW', 'MIXED', 'UNKNOWN'), salesScope: choice('PROMOTED', 'HALO', 'COMBINED', 'UNKNOWN'), attributionWindow: text });
const snapshot = obj({ source: text, startDate: date, endDate: date, coverage: choice('complete', 'partial', 'unknown'),
  attributionMature: flag, basis,
  metrics: obj({ impressions: count, clicks: count, orders: number, spend: number, sales: number }, []) });
const row = obj({
  id: text, name: text, objective: choice('sales', 'discovery', 'awareness'), current: snapshot, baseline: snapshot,
  economics: obj({ source: text, quality: choice('verified', 'estimated', 'unknown'), contributionBeforeAds: signed, profitFloor: number }),
  inventory: obj({ source: text, availableUnits: count, dailyUnitDemand: number, replenishmentDays: number, sellingDaysRemaining: number }),
  budget: obj({ source: text, limited: flag }),
  retail: obj({ source: text, sessions: count, orders: number, sales: number }),
  changes: { type: 'array', items: text, maxItems: 30 },
}, ['id', 'objective', 'current']);

export const AD_PERFORMANCE_SCHEMA = obj({
  scope: obj({ store: text, marketplace: text, currency: { ...text, pattern: '^[A-Z]{3}$' }, timezone: text,
    entityType: choice('campaign', 'ad_group', 'target', 'search_term', 'placement', 'advertised_product') }),
  evidenceKind: choice('provided', 'simulation'),
  rows: { type: 'array', items: row, minItems: 1, maxItems: 100 },
});

function validate(schema, value, location = 'input') {
  const fail = reason => { throw new Error(`${location}: ${reason}`); };
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.includes(actual) && !(actual === 'number' && types.includes('integer') && Number.isSafeInteger(value))) fail('字段类型错误');
  if (schema.enum && !schema.enum.includes(value)) fail('未知枚举');
  if (actual === 'number' && (!Number.isFinite(value) || value < schema.minimum || value > schema.maximum)) fail('数值越界');
  if (actual === 'string' && (!value.trim() || value !== value.trim() || value.length > (schema.maxLength ?? 4096)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) fail('无效文字');
  if (actual === 'object') {
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) fail(`未知字段 ${key}`);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`缺少 ${key}`);
    for (const [key, item] of Object.entries(value)) validate(schema.properties[key], item, `${location}.${key}`);
  }
  if (actual === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > schema.maxItems) fail('条目数量越界');
    value.forEach((item, index) => validate(schema.items, item, `${location}[${index}]`));
  }
}
const known = value => typeof value === 'number' && Number.isFinite(value);
const ratio = (a, b, factor = 1) => known(a) && known(b) && b > 0 ? a / b * factor : null;
const metricNames = ['impressions', 'clicks', 'orders', 'spend', 'sales'];
function metrics(m, b) {
  return { ...Object.fromEntries(metricNames.map(k => [k, m[k] ?? null])),
    ctrPct: ratio(m.clicks, m.impressions, 100), cpc: ratio(m.spend, m.clicks),
    cvrPct: b.interaction === 'CLICK' ? ratio(m.orders, m.clicks, 100) : null, aov: ratio(m.sales, m.orders),
    clickCostMeaning: b.chargeType === 'CPC' ? 'CPC' : 'EFFECTIVE_COST_PER_CLICK',
    acosPct: ratio(m.spend, m.sales, 100), roas: ratio(m.sales, m.spend) };
}
function checkSnapshot(s) {
  for (const d of [s.startDate, s.endDate]) {
    const parsed = new Date(`${d}T00:00:00Z`);
    if (d.startsWith('0000') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) throw new Error('报表日期无效');
  }
  if (s.startDate > s.endDate) throw new Error('报表起止日期倒置');
}
const complete = s => s.coverage === 'complete' && s.attributionMature === true;
const sameBasis = (a, b) => Object.keys(basis.properties).every(k => a[k] === b[k])
  && !Object.values(a).includes('UNKNOWN') && !/^unknown$/i.test(a.attributionWindow);

function compare(current, baseline, changes) {
  if (!baseline) return { status: 'NO_BASELINE', reason: '没有基准窗口，保留当前观察。', factors: null };
  if (!sameBasis(current.basis, baseline.basis)) return { status: 'INCOMPATIBLE', reason: '广告产品、计费、归因或销售范围不同/未知，不作效率变化分解。', factors: null };
  if (current.basis.chargeType !== 'CPC' || current.basis.interaction !== 'CLICK') return { status: 'OTHER_MEASUREMENT_BASIS', reason: '该分解用于按点击计费、点击归因；观看归因或展示计费需按对应目标与可见性/触达指标分析。', factors: null };
  if (!complete(current) || !complete(baseline)) return { status: 'INCOMPLETE', reason: '窗口不完整或归因未成熟，只展示各自原始指标。', factors: null };
  if (current.startDate <= baseline.endDate) return { status: 'OVERLAPPING_OR_REVERSED', reason: '基准须早于当前窗口且不重叠。', factors: null };
  const a = metrics(current.metrics, current.basis), b = metrics(baseline.metrics, baseline.basis);
  // This identity is descriptive, not causal or a statistical significance test.
  const factors = [a.cpc, b.cpc, a.cvrPct, b.cvrPct, a.aov, b.aov].every(x => known(x) && x > 0)
    ? { cpc: a.cpc / b.cpc, inverseCvr: b.cvrPct / a.cvrPct, inverseAov: b.aov / a.aov,
      acos: a.acosPct / b.acosPct } : null;
  const days = s => (Date.parse(s.endDate) - Date.parse(s.startDate)) / 86400000 + 1;
  return { status: changes.length ? 'CONFOUNDED' : 'DESCRIPTIVE', factors,
    changes, currentDays: days(current), baselineDays: days(baseline),
    reason: 'ACoS变化倍数 = CPC倍数 × CVR倒数倍数 × 客单价倒数倍数；未知或零分母不强行分解。变化不能证明原因，未报告并发改动也不证明不存在混杂。' };
}

function reviewRow(input, scope) {
  const s = input.current, m = metrics(s.metrics, s.basis), changes = input.changes || [];
  checkSnapshot(s); if (input.baseline) checkSnapshot(input.baseline);
  const observations = [], candidates = [], gaps = [];
  const add = (code, priority, reason, nextStep, successMetric, reviewWhen, sources = [s.source]) => {
    const id = `${s.basis.adProduct}:${input.id}:${code}`;
    candidates.push({ id, objectId: input.id, adProduct: s.basis.adProduct, code, priority, reason, nextStep, successMetric, reviewWhen, sources,
      executionAuthorized: false, executed: false });
  };
  const comparison = compare(s, input.baseline, changes);
  if (!complete(s)) {
    gaps.push('当前窗口未完整或归因未成熟；不能把暂未回填的销售当作最终零销售。');
    add('COMPLETE_DATA', 2, gaps.at(-1), '按相同对象和报表口径补齐完整窗口，保留此次快照再重算。', '完整覆盖及成熟归因下的订单、贡献与ACoS', '实际报告覆盖和归因回填完成后');
  }
  if (m.clicks === 0 && m.spend === 0) {
    add('DELIVERY_CHECK', 3, '当前行没有点击和花费，尚不能评价转化效率。', '核对该对象启用状态、商品资格、库存、目标匹配和可投广告位，再判断预算/竞价是否限制触达。', '资格状态与有效展示/点击', '取得对象设置及投放资格证据后');
  } else if (input.objective === 'sales' && s.basis.interaction === 'CLICK' && m.orders === 0 && known(m.clicks) && m.clicks > 0 && complete(s)) {
    add('ZERO_ORDER_REVIEW', 3, `已观察${m.clicks}次点击、${m.spend ?? '未知'}花费、0归因订单；点击数本身不是否词阈值。`, '先按真实搜索词/商品投放核相关性，再核商品转化与已批准学习损失；明确无关的查询和仍相关的查询分别处理。', '相关流量的转化与损失边界', '达到有依据的学习边界或取得明确不相关/转化阻碍证据时');
  }
  if (changes.length) {
    observations.push({ code: 'CONCURRENT_CHANGES', changes, reason: '价格、创意、库存或广告设置等同时变化，不能把结果归给其中一项。' });
    add('SEGMENT_CHANGES', 3, `已记录${changes.length}项影响解释的变化。`, '按生效时间拆分窗口并核对当时价格、促销、主图/详情页与广告设置；选择一个主要变量做下一轮可解释测试。', '同口径转化、客单价及贡献；主要KPI另按目标选择', '变更后的独立窗口完整且归因成熟后', [s.source, ...(input.baseline ? [input.baseline.source] : [])]);
  }
  if (comparison.factors) {
    const f = comparison.factors;
    observations.push({ code: 'ACOS_DECOMPOSITION', ...f, causeVerified: false });
    const largest = [['CPC', f.cpc], ['CVR', f.inverseCvr], ['AOV', f.inverseAov]].sort((a, b) => b[1] - a[1])[0];
    if (input.objective === 'sales' && f.acos > 1 && largest[1] > 1) {
      const checks = { CPC: '分开核对目标/搜索词和广告位的点击成本及流量构成；查动态竞价和广告位设置，不能由平均CPC直接算基础bid。',
        CVR: '核对真实搜索词意图、商品价格/促销、详情页、评价、库存及配送承诺；用零售转化与同屏证据区分流量和商品问题。',
        AOV: '核对价格/优惠变化、实际购买商品和订单件数，重新计算匹配销售组合的贡献。' };
      add('INVESTIGATE_' + largest[0], 3, `ACoS变为基准的${f.acos.toFixed(3)}倍；其中${largest[0]}对应因子的数学放大作用最大，尚非因果结论。`, checks[largest[0]], '在可比流量构成下改善贡献，同时检查CPC、CVR和客单价', '取得所列分层报表和经营变化证据后', [s.source, input.baseline.source]);
    }
  }
  const eco = input.economics;
  // Totals must be allocated to this row's actual attributed sales; not store-wide profit.
  const contributionUsable = eco && eco.quality !== 'unknown' && complete(s) && sameBasis(s.basis, s.basis)
    && known(eco.contributionBeforeAds) && known(m.spend) && known(m.sales);
  const contribution = contributionUsable ? eco.contributionBeforeAds - m.spend : null;
  const profitFloorGap = known(contribution) && known(eco.profitFloor) ? contribution - eco.profitFloor : null;
  const economics = { contributionAfterAds: contribution, profitFloorGap,
    status: !contributionUsable ? 'UNAVAILABLE' : eco.quality === 'estimated' ? 'ESTIMATED' : 'PROVIDED_VERIFIED_BASIS',
    source: eco?.source ?? null, note: '只表示所供归因销售对应的贡献模型，非店铺总利润或广告增量利润；不是独立审计。' };
  if (!contributionUsable) gaps.push('缺少与该行归因销售匹配的贡献，或窗口未成熟；不能据ACoS判断盈利/扩量。');
  else if (input.objective === 'sales' && (contribution < 0 || (known(profitFloorGap) && profitFloorGap < 0))) {
    add('ECONOMICS_REVIEW', 1, `该行模型广告后贡献${contribution.toFixed(2)} ${scope.currency}；${known(profitFloorGap) ? `距利润底线${profitFloorGap.toFixed(2)}` : '利润底线未知'}。`,
      '核对成本、价格与购买组合，再按搜索词/投放/版位定位损失；对超出当前批准损失边界的对象准备减暴露提案，避免把整活动一律降价或所有零单词否定。',
      '广告后贡献、总损失及利润底线差额', '先核当前损失边界；执行后的效果另等成熟窗口复盘', [s.source, eco.source]);
  }
  const stock = input.inventory;
  const cover = stock ? ratio(stock.availableUnits, stock.dailyUnitDemand) : null;
  // A finite selling window can end before replenishment is needed. Compare
  // against the nearer boundary; equality has no remaining demand buffer.
  const horizons = stock ? [stock.replenishmentDays, stock.sellingDaysRemaining].filter(known) : [];
  const horizon = horizons.length ? Math.min(...horizons) : null;
  const stockRisk = !stock || !known(stock.availableUnits) || (stock.availableUnits > 0 && (!known(cover) || !known(horizon)))
    ? null : stock.availableUnits === 0 || cover <= horizon;
  if (stockRisk) add('INVENTORY_FIRST', 0, stock.availableUnits === 0 ? '可售库存为0。' : `按当前总日销量估计可售${cover.toFixed(1)}天，至${horizon}天的补货/销售边界没有余量；这是需求情景，尚非必然缺货结论。`,
    '先核可售、补货可售日期和流量承接能力；将新增暴露暂缓复核，必要减暴露走具体对象提案。不得因为低ACoS直接扩量。',
    '到货前缺货风险、可售库存与可兑现交期', '新库存可售或补货时点被核实后', [stock.source]);
  if (!stock || !known(stock.availableUnits) || !known(stock.dailyUnitDemand) || !known(stock.replenishmentDays)) gaps.push('库存、总销量或补货时点未齐，不能确定扩量承接能力。');
  const sellingWindowClosed = stock?.sellingDaysRemaining === 0;
  if (sellingWindowClosed) add('SALES_WINDOW_CLOSED', 0, '已明确剩余销售窗口为0天，当前窗口不能承接新增销售计划。',
    '先核销售截止日及剩余库存的处置/下一周期计划；不要在已结束窗口增加投放。',
    '可执行销售窗口与库存处置结果', '新的销售窗口和经营目标经确认后', [stock.source]);
  const clearanceDailyUnits = stock ? ratio(stock.availableUnits, stock.sellingDaysRemaining) : null;
  if (known(clearanceDailyUnits) && known(stock.dailyUnitDemand) && clearanceDailyUnits > stock.dailyUnitDemand) {
    observations.push({ code: 'ZERO_ENDING_STOCK_SCENARIO', neededDailyUnits: clearanceDailyUnits, observedDailyUnits: stock.dailyUnitDemand,
      reason: '仅假设当前可售库存全部售罄、无新增可售入库的情景；未确认期末库存目标，不证明广告能独立补齐。' });
    add('SELL_THROUGH_SCENARIO', 2, `若目标是当前可售库存全部售罄且无新增入库，剩余窗口情景日销为${clearanceDailyUnits.toFixed(2)}件，当前${stock.dailyUnitDemand}件。`,
      '结合批准的清货利润底线，比较广告、价格促销和库存处置选择；先确认清货目标，避免只追求最低ACoS。', '窗口内售罄进度与现金/贡献', '获得明确销售窗口、经营目标和可承受损失后', [stock.source, ...(eco ? [eco.source] : [])]);
  }
  if (input.budget?.limited === true) {
    if (input.objective !== 'sales') add('OBJECTIVE_REVIEW', 3, '触达/认知目标存在预算限制，销售ROAS不能独自判胜负。',
      '核目标对应的覆盖、可见性、频次或新客指标及增量证据，按已批准测试预算安排。', '与活动目标一致的主KPI和支出保护指标', '目标指标与范围可核验后', [input.budget.source]);
    else if (contributionUsable && eco.quality === 'verified' && contribution > 0 && known(profitFloorGap) && profitFloorGap >= 0 && stockRisk === false && !sellingWindowClosed) {
      add('BUDGET_OPPORTUNITY_REVIEW', 4, '该行报告预算受限，历史贡献模型高于底线；这不证明新增预算仍有同等回报。',
        '核预算耗尽时段、搜索词/版位边际需求、样本稳定性与库存现金；满足后准备有总支出边界的预算测试，不能按历史平均ROAS比例直接分配。',
        '新增支出对应的贡献、目标KPI与库存承接', '取齐边际需求和库存证据后；试验后用成熟窗口复盘', [s.source, eco.source, input.budget.source]);
    } else gaps.push('预算受限不是加预算的充分理由；当前贡献、利润底线或库存证据不足/存在风险。');
  }
  const retail = input.retail;
  return { id: input.id, name: input.name ?? null, objective: input.objective, basis: s.basis,
    window: { startDate: s.startDate, endDate: s.endDate }, source: s.source, metrics: m,
    baselineMetrics: input.baseline ? metrics(input.baseline.metrics, input.baseline.basis) : null, comparison, economics,
    retail: retail ? { source: retail.source, orderSessionPct: ratio(retail.orders, retail.sessions, 100),
      rowSpendToRetailSalesPct: ratio(m.spend, retail.sales, 100), note: '本行花费/所供零售销售额的比例，不是全广告TACoS；须核同商品同期间且不得重复汇总零售分母。零售订单/session不等同广告CVR，不证明增量。' } : null,
    inventory: { coverageDays: cover, planningHorizonDays: horizon, stockRisk, clearanceDailyUnits, sellingWindowClosed,
      clearanceAssumption: '当前可售库存全部售罄、无新增可售入库；待确认经营目标，不是已批准清货任务。' }, observations, candidates, gaps };
}

export function reviewAdPerformance(input) {
  validate(AD_PERFORMANCE_SCHEMA, input);
  try { new Intl.DateTimeFormat('en', { timeZone: input.scope.timezone }).format(); }
  catch { throw new Error('无效账户时区'); }
  const ids = new Set();
  for (const r of input.rows) {
    const key = `${r.current.basis.adProduct}:${r.id}`;
    if (ids.has(key)) throw new Error('重复对象；先在同口径下聚合，不能混入搜索词/广告位重复行');
    ids.add(key);
  }
  const rows = input.rows.map(r => reviewRow(r, input.scope));
  const candidates = rows.flatMap(r => r.candidates).sort((a, b) => a.priority - b.priority);
  // Prioritize operational risk, not ROAS across incompatible ad products or objectives.
  return { scope: input.scope, evidenceKind: input.evidenceKind, status: 'REVIEW_ONLY', statusMeaning: '仅供人工复核，未批准或执行',
    rows, priorityActions: candidates.slice(0, 3), deferredActions: candidates.slice(3),
    executionAuthorized: false, executed: false, independentSourceVerification: false,
    note: '本地重算所供数据；输入由运营模块从真实报表组织。来源声明不等于独立核验，观察不是因果；未合并不同广告产品、币种或报表粒度，不自动生成竞价/否词/预算写入。模拟输入不代表真实账户表现。' };
}
