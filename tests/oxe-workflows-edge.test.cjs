'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wf = require('../bin/lib/oxe-workflows.cjs');
const REPO_ROOT = path.join(__dirname, '..');

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

  test('validateWorkflowShapes help.md without output warns', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-wf-help-'));
    fs.writeFileSync(
      path.join(dir, 'help.md'),
      '<objective>x</objective>\n<success_criteria></success_criteria>\n',
      'utf8'
    );
    const r = wf.validateWorkflowShapes(dir);
    assert.ok(r.warnings.some((w) => w.message.includes('output')));
  });

  test('core workflows declare pack-first context consumption', () => {
    for (const slug of ['ask', 'plan', 'execute', 'verify']) {
      const text = fs.readFileSync(path.join(REPO_ROOT, 'oxe', 'workflows', `${slug}.md`), 'utf8');
      assert.match(text, new RegExp(`\\.oxe/context/packs/${slug}\\.(md|json)`), `${slug}.md deve citar o context pack`);
      assert.match(text, /pack/i, `${slug}.md deve mencionar o pack explicitamente`);
      assert.match(text, /fallback explícito|fallback para leitura direta/i, `${slug}.md deve declarar fallback explícito`);
    }
  });

  test('execute e verify preferem runtime enterprise como caminho padrão', () => {
    const execute = fs.readFileSync(path.join(REPO_ROOT, 'oxe', 'workflows', 'execute.md'), 'utf8');
    const verify = fs.readFileSync(path.join(REPO_ROOT, 'oxe', 'workflows', 'verify.md'), 'utf8');

    assert.match(execute, /oxe-cc runtime compile --dir <projeto>/i);
    assert.match(execute, /oxe-cc runtime project --dir <projeto>/i);
    assert.match(execute, /fallback legado/i);

    assert.match(verify, /oxe-cc runtime verify --dir <projeto>/i);
    assert.match(verify, /verification-manifest\.json/i);
    assert.match(verify, /residual-risk-ledger\.json/i);
    assert.match(verify, /evidence-coverage\.json/i);
    assert.match(verify, /fallback legado/i);
  });
});
