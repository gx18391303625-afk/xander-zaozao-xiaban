#!/usr/bin/env node
// MCP 服务入口：Claude / Codex 通过插件配置自动启动它（stdio）。
import { startServer } from './mcp.js';
import { VERSION } from '../lib/version.js';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  process.stderr.write(`[xander] 需要 Node.js 22.13 或更高版本，当前是 ${process.versions.node}。请到 https://nodejs.org 安装 LTS 版。\n`);
  process.exit(1);
}

// Warning filtering belongs only to this standalone transport process, never shared libraries.
// Load tools afterwards so native DSH imports do not alter the host's warning/console handlers.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning, type, ...rest) {
  const message = typeof warning === 'string' ? warning : warning?.message;
  if (message?.includes('SQLite') && (type === 'ExperimentalWarning' || warning?.name === 'ExperimentalWarning')) return;
  return originalEmitWarning.call(this, warning, type, ...rest);
};
const { buildTools, INSTRUCTIONS } = await import('./tools.js');
startServer({ name: 'xander', version: VERSION, instructions: INSTRUCTIONS, tools: buildTools(VERSION) });
