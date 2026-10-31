// Native DSH entry. Never import server/index.js: that entry owns MCP stdio and process exit.
import { buildTools, INSTRUCTIONS } from '../server/tools.js';
import { VERSION } from '../lib/version.js';
import { closeArchive } from '../lib/archive.js';
import { closeDecisionJournal } from '../lib/decision-journal.js';
import { createToolAdapter } from './adapter.js';

export const inject = ['tools', 'systemPrompt'];

// The business libraries own process-local database singletons. Mount this Host plugin once,
// not independently in several presets, so one Fiber cannot close another Fiber's handles.
let mounted = false;

export function apply(ctx) {
  if (mounted) throw new Error('Xander 已在当前宿主加载或正在结束调用；请只安装一份全局插件，不要在多个预设重复挂载。');
  const adapter = createToolAdapter(buildTools(VERSION));
  mounted = true;
  try {
    ctx.effect(() => {
      const disposers = [];
      const unregister = () => {
        for (const dispose of disposers.splice(0).reverse()) dispose();
      };
      try {
        for (const definition of adapter.definitions) disposers.push(ctx.tools.register(definition));
        disposers.push(ctx.systemPrompt.section({
          name: 'xander-zaozao-xiaban',
          order: 700,
          interpolate: false,
          text: '以下规则仅适用于 Xander / 亚马逊运营任务：先加载 xander-operations 技能，其他模块按需加载。\n' + INSTRUCTIONS,
        }));
      } catch (error) {
        unregister();
        void adapter.stop();
        throw error;
      }
      return async () => {
        try { unregister(); }
        finally {
          await adapter.stop();
          try { closeArchive(); }
          finally {
            try { closeDecisionJournal(); }
            finally { mounted = false; }
          }
        }
      };
    });
  } catch (error) {
    mounted = false;
    throw error;
  }
}
