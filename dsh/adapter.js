// DSH transport adapter. Domain handlers and model-facing schemas remain shared with MCP.
// Keep every tool exclusive: even some nominal reads can create local proposal/log files.
export function createToolAdapter(tools) {
  let accepting = true;
  let stopped;
  const pending = new Set();

  const definitions = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: structuredClone(tool.inputSchema),
    output: {
      schema: { type: 'string' },
      render(_args, value) { return [{ type: 'text', text: value }]; },
    },
    isConcurrencySafe() { return false; },
    async execute(args, execution) {
      if (!accepting) throw new Error('Xander 插件正在停用，请等待当前调用结束。不要重发结果未知的写入。');
      execution.signal.throwIfAborted();
      const operation = Promise.resolve().then(async () => {
        if (!accepting) throw new Error('Xander 插件已停用，本次调用尚未开始。');
        execution.signal.throwIfAborted();
        const result = await tool.handler(args);
        // Match MCP's text projection exactly: do not double-encode existing JSON strings.
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        if (typeof text !== 'string') throw new TypeError(`Xander 工具 ${tool.name} 返回了不可序列化的结果。`);
        return text;
      });
      pending.add(operation);
      try { return await operation; }
      finally { pending.delete(operation); }
    },
  }));

  return {
    definitions,
    stop() {
      accepting = false;
      // Never retry or abandon an already-started Amazon write during plugin teardown.
      stopped ??= Promise.allSettled([...pending]).then(() => undefined);
      return stopped;
    },
  };
}
