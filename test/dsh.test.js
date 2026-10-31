import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createToolAdapter } from '../dsh/adapter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xander-dsh-test-')));
const dataHome = path.join(temporary, 'not-created-by-install');
const previousEnvironment = { home: process.env.XANDER_HOME, backend: process.env.XANDER_SECRET_BACKEND };
process.env.XANDER_HOME = dataHome;
process.env.XANDER_SECRET_BACKEND = 'file';
const original = { log: console.log, warning: process.emitWarning, stdin: process.stdin.listenerCount('data'), exit: process.exit };
const plugin = await import('../dsh/index.js');
const { buildTools, INSTRUCTIONS } = await import('../server/tools.js');
const { closeArchive } = await import('../lib/archive.js');
const { closeDecisionJournal } = await import('../lib/decision-journal.js');
const { VERSION } = await import('../lib/version.js');
const raw = buildTools(VERSION);

after(() => {
  closeArchive();
  closeDecisionJournal();
  for (const [name, value] of [['XANDER_HOME', previousEnvironment.home], ['XANDER_SECRET_BACKEND', previousEnvironment.backend]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  assert.equal(path.dirname(temporary), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(temporary), /^xander-dsh-test-/);
  fs.rmSync(temporary, { recursive: true, force: true });
});

function context({ conflictAt = -1, failPrompt = false } = {}) {
  const tools = new Map(), sections = new Map(), effects = [];
  let attempted = 0;
  return {
    registered: tools, sections,
    tools: {
      register(definition) {
        if (attempted++ === conflictAt || tools.has(definition.name)) throw new Error('synthetic duplicate tool');
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    systemPrompt: {
      section(section) {
        if (failPrompt) throw new Error('synthetic prompt conflict');
        sections.set(section.name, section);
        return () => sections.delete(section.name);
      },
    },
    effect(register) { const dispose = register(); effects.push(dispose); return dispose; },
    async dispose() { for (const dispose of effects.splice(0).reverse()) await dispose(); },
  };
}
const execution = () => ({ signal: new AbortController().signal });
const syntheticTool = (handler) => ({ name: 'xander_fixture', description: 'Synthetic local adapter fixture.', inputSchema: { type: 'object', additionalProperties: false }, handler });

test('DSH import/activation do not own stdio, change process globals or create business data', async () => {
  assert.equal(console.log, original.log);
  assert.equal(process.emitWarning, original.warning);
  assert.equal(process.exit, original.exit);
  assert.equal(process.stdin.listenerCount('data'), original.stdin);
  assert.equal(fs.existsSync(dataHome), false);
  const ctx = context();
  plugin.apply(ctx);
  assert.equal(fs.existsSync(dataHome), false);
  assert.deepEqual(plugin.inject, ['tools', 'systemPrompt']);
  await ctx.dispose();
  assert.equal(fs.existsSync(dataHome), false);
});

test('DSH uses every MCP handler with identical model-facing names, descriptions and schemas', async () => {
  const ctx = context();
  plugin.apply(ctx);
  assert.equal(ctx.registered.size, raw.length);
  assert.deepEqual([...ctx.registered.values()].map(({ name, description, parameters }) => ({ name, description, parameters })),
    raw.map(({ name, description, inputSchema }) => ({ name, description, parameters: inputSchema })));
  assert.ok(![...ctx.registered.keys()].some(name => /switch_(on|set)|set_switch|toggle/.test(name)));
  for (const definition of ctx.registered.values()) {
    assert.equal(definition.isConcurrencySafe({}), false, 'annotations cannot authorize parallel mutation');
    assert.deepEqual(definition.output.schema, { type: 'string' });
  }
  const section = ctx.sections.get('xander-zaozao-xiaban');
  assert.equal(section.interpolate, false);
  assert.ok(section.text.includes('xander-operations'));
  assert.ok(section.text.includes(INSTRUCTIONS));
  await ctx.dispose();
  assert.equal(ctx.registered.size, 0);
  assert.equal(ctx.sections.size, 0);
});

test('DSH rejects duplicate Host/preset mounts without disposing the active instance', async () => {
  const first = context(), second = context();
  plugin.apply(first);
  assert.throws(() => plugin.apply(second), /只安装一份全局插件/);
  assert.equal(first.registered.size, raw.length);
  assert.equal(first.sections.size, 1);
  assert.equal(second.registered.size, 0);
  await first.dispose();
  plugin.apply(second);
  assert.equal(second.registered.size, raw.length);
  await second.dispose();
});

test('DSH rolls back partial registration and prompt conflicts', () => {
  for (const options of [{ conflictAt: 2 }, { failPrompt: true }]) {
    const ctx = context(options);
    assert.throws(() => plugin.apply(ctx), /synthetic/);
    assert.equal(ctx.registered.size, 0);
    assert.equal(ctx.sections.size, 0);
  }
});

test('DSH exactly matches MCP text projection for JSON strings, objects, arrays and primitive results', async () => {
  for (const result of ['{\n  "ok": true\n}', { ok: true, status: 'NOT LIVE' }, [1, null, 'x'], 0, false, null]) {
    const args = { fixture: true };
    let called = 0;
    const adapter = createToolAdapter([syntheticTool(async input => { assert.equal(input, args); called++; return result; })]);
    const definition = adapter.definitions[0];
    const value = await definition.execute(args, execution());
    const expected = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    assert.equal(value, expected);
    assert.deepEqual(definition.output.render(args, value), [{ type: 'text', text: expected }]);
    assert.equal(called, 1);
    await adapter.stop();
  }
});

test('DSH detaches schemas from shared MCP definitions', async () => {
  const originalTool = syntheticTool(async () => 'ok');
  const adapter = createToolAdapter([originalTool]);
  adapter.definitions[0].parameters.additionalProperties = true;
  assert.equal(originalTool.inputSchema.additionalProperties, false);
  await adapter.stop();
});

test('DSH preserves domain failures without fake success, retries or switch changes', async () => {
  const failure = Object.assign(new Error('OUTCOME_UNKNOWN: verify only'), { code: 'OUTCOME_UNKNOWN' });
  let calls = 0;
  const adapter = createToolAdapter([syntheticTool(async () => { calls++; throw failure; })]);
  await assert.rejects(adapter.definitions[0].execute({}, execution()), error => error === failure);
  assert.equal(calls, 1);
  await adapter.stop();
  await assert.rejects(adapter.definitions[0].execute({}, execution()), /停用/);
  assert.equal(calls, 1);
});

test('DSH never dispatches a pre-cancelled call', async () => {
  let calls = 0;
  const adapter = createToolAdapter([syntheticTool(async () => { calls++; return 'not expected'; })]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter.definitions[0].execute({}, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  await adapter.stop();
});

test('DSH teardown drains a started operation once, without treating cancellation as rollback', async () => {
  let started, finish;
  const entered = new Promise(resolve => { started = resolve; });
  const deferred = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const adapter = createToolAdapter([syntheticTool(async () => { calls++; started(); return deferred; })]);
  const controller = new AbortController();
  const result = adapter.definitions[0].execute({}, { signal: controller.signal });
  await entered;
  controller.abort();
  let drained = false;
  const stop = adapter.stop().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  await assert.rejects(adapter.definitions[0].execute({}, execution()), /停用/);
  finish({ status: 'API_STATE_VERIFIED', note: 'synthetic only' });
  assert.equal(JSON.parse(await result).status, 'API_STATE_VERIFIED');
  await stop;
  assert.equal(drained, true);
  assert.equal(calls, 1);
});

test('DSH real local status/switch calls work in an isolated home and do not open permissions', async () => {
  const ctx = context(); plugin.apply(ctx);
  try {
    const status = JSON.parse(await ctx.registered.get('xander_status').execute({ check: false }, execution()));
    assert.equal(status.version, VERSION);
    assert.equal(status.dataDir, dataHome);
    assert.deepEqual(status.stores, {});
    const switches = JSON.parse(await ctx.registered.get('xander_switches').execute({}, execution()));
    assert.ok(switches.items.length > 10);
    assert.ok(switches.items.every(item => item.on === false));
    await assert.rejects(ctx.registered.get('xander_execute_change').execute({ proposalId: 'synthetic-missing', hash: 'synthetic', approved: true }, execution()));
    assert.ok(JSON.parse(await ctx.registered.get('xander_switches').execute({}, execution())).items.every(item => item.on === false));
  } finally { await ctx.dispose(); }
});

test('DSH manifest, resources and package-relative skill root preserve the other hosts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.main, './dsh/index.js');
  assert.equal(manifest.dsh.bundle.patch, './dsh/cordis.patch.yml');
  assert.equal(manifest.engines.dsh, '^0.2.1-rc.5');
  assert.ok(manifest.files.includes('dsh'));
  assert.equal(manifest.icon, 'assets/icon.svg');
  assert.ok(fs.statSync(path.join(root, manifest.icon)).size < 256 * 1024);
  for (const locale of ['en', 'zh']) {
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'dsh', 'locale', `${locale}.json`), 'utf8')).meta;
    assert.match(meta.title, /Xander/);
    assert.ok(meta.description.length > 30);
  }
  for (const file of ['plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).version, VERSION);
  }
  const mcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers.xander.type, 'stdio');
  assert.deepEqual(mcp.mcpServers.xander.args, ['${PLUGIN_ROOT}/server/index.js']);
  const patch = fs.readFileSync(path.join(root, manifest.dsh.bundle.patch), 'utf8');
  assert.match(patch, /includeDefaultRoots: false/);
  assert.match(patch, /providerName: xander-zaozao-xiaban/);
  assert.ok(!patch.includes('/Users/') && !patch.includes('mcp-xander'));
  const expression = patch.match(/!!js "(.+)"/)[1];
  const skillsRoot = new Function('baseUrl', `return (${expression});`)(new URL('../dsh/cordis.patch.yml', import.meta.url).href);
  assert.equal(skillsRoot, path.join(root, 'skills'));
  const require = createRequire(import.meta.url);
  assert.equal(require.resolve('xander-zaozao-xiaban/package.json'), path.join(root, 'package.json'));
  const skills = fs.readdirSync(skillsRoot).filter(name => fs.existsSync(path.join(skillsRoot, name, 'SKILL.md')));
  assert.equal(skills.length, 7);
  assert.ok(skills.includes('xander-operations'));
  for (const name of skills) {
    const content = fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf8');
    assert.match(content, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`));
    assert.match(content, /\ndescription: .+/);
  }
});
