'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { run, validateCoverage, validateThresholdMonotonicity } = require('../scripts/coverage-ratchet.cjs');

function metrics(pct) {
  return Object.fromEntries(['lines', 'statements', 'functions', 'branches'].map((name) => [name, { pct }]));
}

test('coverage ratchet aprova global e módulos acima dos mínimos', () => {
  const summary = {
    total: metrics(90),
    'C:\\repo\\bin\\lib\\secure.cjs': metrics(85),
  };
  const config = {
    global: { branches: 60 },
    modules: { 'bin/lib/secure.cjs': { branches: 80 } },
  };
  assert.deepEqual(validateCoverage(summary, config), []);
});

test('coverage ratchet impede redução dos thresholds versionados', () => {
  const baseline = { global: { branches: 60 }, modules: { 'secure.cjs': { lines: 90 } } };
  const lowered = { global: { branches: 59 }, modules: { 'secure.cjs': { lines: 89 } } };
  assert.deepEqual(validateThresholdMonotonicity(lowered, baseline), [
    'global: threshold branches 59 < baseline 60',
    'secure.cjs: threshold lines 89 < baseline 90',
  ]);
});

test('coverage ratchet executa com summary, config e baseline explícitos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ratchet-'));
  const summaryPath = path.join(dir, 'summary.json');
  const configPath = path.join(dir, 'config.json');
  const baselinePath = path.join(dir, 'baseline.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ total: metrics(90) }));
  fs.writeFileSync(configPath, JSON.stringify({ global: { branches: 60 }, modules: {} }));
  fs.writeFileSync(baselinePath, JSON.stringify({ global: { branches: 60 }, modules: {} }));
  const result = run({ summaryPath, configPath, baselinePath });
  assert.equal(result.moduleCount, 0);
  assert.equal(result.total.branches.pct, 90);
});

test('coverage ratchet bloqueia regressão e módulo ausente', () => {
  const summary = { total: metrics(59) };
  const config = {
    global: { branches: 60 },
    modules: { 'lib/sdk/index.cjs': { lines: 90 } },
  };
  assert.deepEqual(validateCoverage(summary, config), [
    'global: branches 59% < 60%',
    'lib/sdk/index.cjs: módulo ausente do relatório de cobertura',
  ]);
});
