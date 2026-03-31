'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wf = require('../bin/lib/oxe-workflows.cjs');

describe('oxe-workflows edge', () => {
  test('validateWorkflowShapes read failure via directory named .md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-wf-'));
    fs.mkdirSync(path.join(dir, 'weird.md'));
    const r = wf.validateWorkflowShapes(dir);
    assert.ok(r.warnings.length >= 1);
  });

  test('validateWorkflowShapes partial objective tags', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-wf-'));
    fs.writeFileSync(path.join(dir, 'a.md'), '<objective>x\n', 'utf8');
    const r = wf.validateWorkflowShapes(dir);
    assert.ok(r.warnings.some((w) => w.message.includes('objective')));
  });

  test('validateWorkflowShapes objective close before open', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-wf-'));
    fs.writeFileSync(
      path.join(dir, 'a.md'),
      '</objective>\n<objective>x</objective>\n<success_criteria></success_criteria>\n',
      'utf8'
    );
    const r = wf.validateWorkflowShapes(dir);
    assert.ok(r.warnings.some((w) => w.message.includes('objective')));
  });

  test('validateWorkflowShapes oversize file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-wf-'));
    const big = `<objective>x</objective><success_criteria>y</success_criteria>\n${'z'.repeat(50000)}`;
    fs.writeFileSync(path.join(dir, 'huge.md'), big, 'utf8');
    const r = wf.validateWorkflowShapes(dir, { maxBytesSoft: 100 });
    assert.ok(r.warnings.some((w) => w.message.includes('grande')));
  });

  test('validateWorkflowShapes missing dir', () => {
    const r = wf.validateWorkflowShapes(path.join(os.tmpdir(), 'oxe-wf-missing-xyz'));
    assert.strictEqual(r.warnings.length, 0);
  });
});
