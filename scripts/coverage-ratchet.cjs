#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function normalize(file) {
  return file.replace(/\\/g, '/');
}

function findModule(summary, modulePath) {
  const suffix = `/${normalize(modulePath)}`;
  return Object.entries(summary).find(([file]) => normalize(file).endsWith(suffix));
}

function validateCoverage(summary, config) {
  const failures = [];
  const check = (label, metrics, thresholds) => {
    for (const [metric, minimum] of Object.entries(thresholds)) {
      const actual = metrics && metrics[metric] && metrics[metric].pct;
      if (typeof actual !== 'number') failures.push(`${label}: métrica ${metric} ausente`);
      else if (actual < minimum) failures.push(`${label}: ${metric} ${actual}% < ${minimum}%`);
    }
  };
  check('global', summary.total, config.global);
  for (const [modulePath, thresholds] of Object.entries(config.modules || {})) {
    const match = findModule(summary, modulePath);
    if (!match) failures.push(`${modulePath}: módulo ausente do relatório de cobertura`);
    else check(modulePath, match[1], thresholds);
  }
  return failures;
}

function validateThresholdMonotonicity(config, baseline) {
  const failures = [];
  const compare = (label, current = {}, floor = {}) => {
    for (const [metric, minimum] of Object.entries(floor)) {
      if (typeof current[metric] !== 'number' || current[metric] < minimum) {
        failures.push(`${label}: threshold ${metric} ${current[metric] ?? 'ausente'} < baseline ${minimum}`);
      }
    }
  };
  compare('global', config.global, baseline.global);
  for (const [modulePath, thresholds] of Object.entries(baseline.modules || {})) {
    compare(modulePath, config.modules?.[modulePath], thresholds);
  }
  return failures;
}

function run(options = {}) {
  const summaryPath = options.summaryPath || path.join(ROOT, 'coverage', 'coverage-summary.json');
  const configPath = options.configPath || path.join(ROOT, 'config', 'coverage-ratchet.json');
  const baselinePath = options.baselinePath || path.join(ROOT, 'config', 'coverage-ratchet-baseline.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const failures = [
    ...validateThresholdMonotonicity(config, baseline),
    ...validateCoverage(summary, config),
  ];
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return { total: summary.total, moduleCount: Object.keys(config.modules || {}).length };
}

function main() {
  try {
    const result = run();
    console.log(`coverage-ratchet: OK (${result.moduleCount} módulos críticos)`);
    return 0;
  } catch (error) {
    console.error(`coverage-ratchet: BLOCKED\n${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { normalize, findModule, validateCoverage, validateThresholdMonotonicity, run, main };
