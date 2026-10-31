// 本地经营诊断与实验账本。只组织已有证据，不调用 Amazon，不授予任何业务写入权限。
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { p, ensureHome } from '../lib/paths.js';
import { getStore } from '../lib/config.js';
import { DIAGNOSTIC_SCHEMA, evaluateDiagnostic } from '../lib/diagnostics.js';
import {
  saveDiagnostic, getDiagnostic, listDiagnostics,
  createExperiment, recordExperimentReview, getExperiment, listExperiments,
  CREATE_EXPERIMENT_SCHEMA, EXPERIMENT_REVIEW_SCHEMA, JOURNAL_FILTER_SCHEMA, EXPERIMENT_REVIEW_PAGE_SCHEMA,
} from '../lib/decision-journal.js';

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
function output(value) {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= 60_000) return text;
  ensureHome();
  const file = p('exports', `decision-${randomUUID()}.json`);
  fs.writeFileSync(file, text, { mode: 0o600, flag: 'wx' });
  return JSON.stringify({ savedTo: file, bytes: Buffer.byteLength(text),
    note: '结果较大，完整数据已保存本机；不能只看摘要下结论，请读取完整文件或缩小查询范围。',
    head: text.slice(0, 8000) }, null, 2);
}

// Scope is explicit, never silently defaulted to a different marketplace or account.
function configuredScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('必须明确店铺和站点范围。');
  if (typeof scope.store !== 'string' || !scope.store.trim()) throw new Error('store 必填。');
  const s = getStore(scope.store);
  if (!Array.isArray(s.marketplaces) || !s.marketplaces.includes(scope.marketplace)) {
    throw new Error('站点不在所选店铺的配置范围内；请先核对账户与站点。');
  }
  return s;
}

const querySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['list', 'get'] },
    ...JOURNAL_FILTER_SCHEMA.properties,
    id: { type: 'string', description: 'get 时必填的本地记录 UUID；不是 Amazon 对象 ID' },
  },
  required: ['action', 'store', 'marketplace'],
};

const experimentQuerySchema = { ...querySchema, properties: { ...querySchema.properties, ...EXPERIMENT_REVIEW_PAGE_SCHEMA.properties } };

function readRecord(a, get, list, withReviews = false) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('查询参数必须是对象。');
  const schema = withReviews ? experimentQuerySchema : querySchema;
  if (Object.keys(a).some(k => !Object.hasOwn(schema.properties, k))) throw new Error('查询含未知字段。');
  configuredScope(a);
  const { action, id, reviewOffset, reviewLimit, ...filter } = a;
  const page = Object.fromEntries(['reviewOffset', 'reviewLimit'].filter(k => Object.hasOwn(a, k)).map(k => [k, a[k]]));
  if (action === 'list') {
    if (Object.hasOwn(a, 'id') || Object.keys(page).length) throw new Error('list 不接受 id 或复盘分页参数。');
    const records = list(filter);
    const limit = filter.limit ?? 20;
    return { records, limit, complete: records.length < limit,
      note: '仅返回本地匹配范围内最近的记录，达到limit时可能还有更早记录，不得当成全部历史；不是当前账户状态或已执行证明。' };
  }
  if (action !== 'get') throw new Error('action 只能是 list 或 get。');
  if (filter.sku !== undefined || filter.asin !== undefined || filter.limit !== undefined) throw new Error('get 不接受 SKU/ASIN/limit 过滤；实验复盘请用 reviewOffset/reviewLimit。');
  if (typeof id !== 'string' || !id) throw new Error('get 需要记录 id。');
  return { record: withReviews ? get(id, filter, page) : get(id, filter),
    note: '未找到或不属于所选店铺站点时返回 null；不跨范围检索。' + (withReviews ? '复盘历史按页返回，nextReviewOffset 不为 null 时须继续读取，不能把当前页当全部历史。' : '') };
}

export function buildDecisionTools() {
  return [
    {
      name: 'xander_diagnose_asin',
      description: '只读整理单个 SKU/ASIN 的经营诊断卡：确认目标、校验证据范围/完整性/归因与样本、逐动作门禁、最多三项优先待办和暂不动事项。输入应由对应运营模块采集现有证据，不让用户填大表。仅根据所供证据判读，不独立联网验证，不按月龄自动定阶段，不形成写入授权；不保存历史。',
      inputSchema: DIAGNOSTIC_SCHEMA, annotations: READ,
      async handler(a) { configuredScope(a?.scope); return output(evaluateDiagnostic(a)); },
    },
    {
      name: 'xander_save_diagnostic',
      description: '保存不可覆盖的本地诊断快照：重新运行证据门禁，记录完整输入与结果，返回 UUID。不是事实确认、不是审批、不会改广告或自动监控。输入与 xander_diagnose_asin 相同；不会接受客户端伪造的放行结果。',
      inputSchema: DIAGNOSTIC_SCHEMA, annotations: WRITE,
      async handler(a) { configuredScope(a?.scope); return output(saveDiagnostic(a)); },
    },
    {
      name: 'xander_diagnostics',
      description: '按店铺、站点查询已保存的经营诊断；list 可按 SKU/ASIN 过滤并限制条数，get 使用本地 UUID。历史计划不等于当前账户状态。',
      inputSchema: querySchema, annotations: READ,
      async handler(a) { return output(readRecord(a, getDiagnostic, listDiagnostics)); },
    },
    {
      name: 'xander_experiment_create',
      description: '创建本地行动/实验卡：绑定已保存诊断和具体动作，记录假设、主要变量、基准/对照、最大新增支出与损失、停止条件和最早复盘日期。仅规划，不启动投放、不安排定时监控、不批准任何改动；proposalId 只是未核实引用。',
      inputSchema: CREATE_EXPERIMENT_SCHEMA, annotations: WRITE,
      async handler(a) { configuredScope(a?.scope); return output(createExperiment(a)); },
    },
    {
      name: 'xander_experiment_review',
      description: '追加不可覆盖的实验复盘记录：严格区分调用方报告的执行回读与描述式经营结果；保留归因、对照与混杂缺口，不将前后变化宣称为因果增量。未到观察期可记进度，但不得宣称已经验证。不会自动加预算、停投或恢复原值。',
      inputSchema: EXPERIMENT_REVIEW_SCHEMA, annotations: WRITE,
      async handler(a) { configuredScope(a); return output(recordExperimentReview(a)); },
    },
    {
      name: 'xander_experiments',
      description: '只读查询本地行动/实验卡。list含最新复盘摘要；get的历史默认每页20条，上限100，使用reviewOffset/reviewLimit并按nextReviewOffset续读。按店铺站点隔离；计划、执行记录、业务效果分开，不将到期日期当作已安排提醒。',
      inputSchema: experimentQuerySchema, annotations: READ,
      async handler(a) { return output(readRecord(a, getExperiment, listExperiments, true)); },
    },
  ];
}
