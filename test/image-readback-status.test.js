import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.js';
isolate();
const { overall } = await import('../lib/proposals.js');

const proposal = (...statuses) => ({ items: statuses.map((status, index) => ({ index, result: { status } })) });

test('图片回读收尾状态：全部“已提交待页面核验”就整体是这个状态，不退回 FAILED', () => {
  assert.equal(overall(proposal('IMAGE_CONTRIBUTION_SUBMITTED', 'IMAGE_CONTRIBUTION_SUBMITTED')), 'IMAGE_CONTRIBUTION_SUBMITTED');
});

test('图片回读收尾状态：部分核验通过也保持零售页待核验，不谎称已核验', () => {
  assert.equal(overall(proposal('IMAGE_CONTRIBUTION_VERIFIED', 'IMAGE_CONTRIBUTION_SUBMITTED')), 'IMAGE_CONTRIBUTION_SUBMITTED');
});

test('图片回读收尾状态：明确失败或结果未知仍优先暴露，不被图片状态盖住', () => {
  assert.equal(overall(proposal('IMAGE_CONTRIBUTION_SUBMITTED', 'FAILED')), 'PARTIALLY_SUCCEEDED');
  assert.equal(overall(proposal('IMAGE_CONTRIBUTION_SUBMITTED', 'OUTCOME_UNKNOWN')), 'OUTCOME_UNKNOWN');
  assert.equal(overall(proposal('IMAGE_CONTRIBUTION_SUBMITTED', 'MISMATCH')), 'MISMATCH');
});

test('图片回读收尾状态：Amazon 自家图片地址不一致按真差异报告', () => {
  assert.equal(overall(proposal('MISMATCH')), 'MISMATCH');
});
