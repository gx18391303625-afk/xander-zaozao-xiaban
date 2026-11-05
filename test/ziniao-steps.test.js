import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';
isolate();
const { validateSteps } = await import('../lib/ziniao.js');

test('clickText 必须带文字，并原样保留', () => {
  assert.throws(() => validateSteps([{ action: 'clickText' }]), /文字/);
  assert.throws(() => validateSteps([{ action: 'clickText', text: '  ' }]), /文字/);
  const [s] = validateSteps([{ action: 'clickText', text: '保存' }]);
  assert.equal(s.action, 'clickText');
  assert.equal(s.text, '保存');
});

test('未知动作仍然被拒绝', () => {
  assert.throws(() => validateSteps([{ action: 'hover', selector: '#a' }]), /action/);
});
