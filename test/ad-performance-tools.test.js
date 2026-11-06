import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('MCP advertises and runs the local report review without credentials, proposals or account writes', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xander-ad-review-'));
  process.env.XANDER_HOME = home; process.env.XANDER_SECRET_BACKEND = 'file';
  try {
    const { buildTools } = await import('../server/tools.js');
    const tool = buildTools('test').find(x => x.name === 'xander_review_ad_performance');
    assert.deepEqual(tool.annotations, { readOnlyHint: true, openWorldHint: false });
    const input = JSON.parse(fs.readFileSync(new URL('../examples/ad-performance-review.json', import.meta.url), 'utf8'));
    const result = JSON.parse(await tool.handler(input));
    assert.equal(result.status, 'REVIEW_ONLY'); assert.equal(result.evidenceKind, 'simulation');
    assert.equal(result.executionAuthorized, false); assert.equal(result.rows.length, 3);
    assert.equal(result.priorityActions[0].code, 'INVENTORY_FIRST');
    assert.deepEqual(fs.readdirSync(home), []);
    await assert.rejects(() => tool.handler({ ...input, executed: true }));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
