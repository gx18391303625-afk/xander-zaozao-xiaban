// 面板只展示已有本地记录的摘要；不创建诊断、不触发试验、不改变审批或开关。
import { listDiagnostics, listExperiments } from '../lib/decision-journal.js';

export function decisionSummary(config) {
  const diagnostics = [];
  const experiments = [];
  try {
    for (const [store, setting] of Object.entries(config.stores || {})) {
      for (const marketplace of new Set(setting.marketplaces || [])) {
        const filter = { store, marketplace, limit: 3 };
        for (const card of listDiagnostics(filter)) {
          diagnostics.push({
            id: card.id, createdAt: card.createdAt, scope: card.scope,
            goal: card.result.goal, statusMeaning: card.result.statusMeaning,
            evidenceCount: card.result.evidenceAssessments.length,
            recommendations: card.result.recommendations.map(a => ({ id: a.id, object: a.object, reason: a.reason, ownerModule: a.ownerModule })),
            deferred: card.result.deferred.slice(0, 3).map(a => ({
              id: a.id, object: a.object, reason: a.reason,
              blockingReasons: a.gates.filter(g => ['unmet', 'unknown'].includes(g.status)).map(g => g.reason),
              deferredReason: a.deferredReason,
            })),
            deferredCount: card.result.deferred.length,
          });
        }
        for (const plan of listExperiments(filter)) experiments.push({
          id: plan.id, createdAt: plan.createdAt, scope: plan.scope, hypothesis: plan.hypothesis,
          earliestReviewDate: plan.earliestReviewDate, statusExplanation: plan.statusExplanation,
          maxAdditionalSpend: plan.maxAdditionalSpend, maxLoss: plan.maxLoss,
          reviewCount: plan.reviewCount, latestReview: plan.latestReview,
        });
      }
    }
    const recent = rows => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
    return { diagnostics: recent(diagnostics), experiments: recent(experiments),
      note: '历史诊断与本地计划，只读展示。不是当前账户状态、审批、已执行证明或自动监控。' };
  } catch (e) {
    return { diagnostics: [], experiments: [], error: `经营记录读取失败：${e.message}。不能将读取失败当作没有问题。` };
  }
}
