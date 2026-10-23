// 极简 MCP（Model Context Protocol）服务端：stdio + JSON-RPC 2.0，不依赖任何第三方包。
// 只实现插件需要的部分：initialize / tools/list / tools/call / ping。
import readline from 'node:readline';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function startServer({ name, version, instructions, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  // 任何日志都只能写到 stderr，stdout 专门留给协议
  console.log = (...a) => process.stderr.write(a.join(' ') + '\n');

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const m of batch) handle(m).catch((e) => process.stderr.write(`[xander] ${e.stack}\n`));
  });
  rl.on('close', () => process.exit(0));

  async function handle(m) {
    const { id, method, params } = m;
    const reply = (result) => id !== undefined && write({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => id !== undefined && write({ jsonrpc: '2.0', id, error: { code, message } });

    if (method === 'initialize') {
      const want = params?.protocolVersion;
      return reply({
        protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name, version },
        instructions,
      });
    }
    if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return;
    if (method === 'ping') return reply({});
    if (method === 'tools/list') {
      return reply({ tools: tools.map(({ name: n, description, inputSchema, annotations }) => ({ name: n, description, inputSchema, ...(annotations ? { annotations } : {}) })) });
    }
    if (method === 'resources/list') return reply({ resources: [] });
    if (method === 'prompts/list') return reply({ prompts: [] });
    if (method === 'tools/call') {
      const tool = byName.get(params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.handler(params.arguments || {});
        return reply({ content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: `出错了：${e.message}` }], isError: true });
      }
    }
    return fail(-32601, `Method not found: ${method}`);
  }
}
