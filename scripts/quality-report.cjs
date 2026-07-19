#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runPackageManagerSync } = require('../bin/lib/oxe-process.cjs');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, '.oxe', 'release');
const DEFAULT_STATE = path.join(RELEASE_DIR, 'quality-gates-state.json');
const DEFAULT_JSON = path.join(RELEASE_DIR, 'quality-gates-report.json');
const DEFAULT_MARKDOWN = path.join(RELEASE_DIR, 'quality-gates-report.md');
const REQUIRED_GATES = Object.freeze([
  'lint', 'format', 'sdk-types', 'coverage', 'extension-host', 'npm-audit',
  'assets', 'vsix', 'pack', 'release-manifest',
]);
const BASELINE = Object.freeze({
  version: '1.15.0',
  coverage: { lines: 82.72, statements: 82.72, functions: 92.37, branches: 61.37 },
  npm: { size_bytes: 2068354, file_count: 501 },
  vsix: { size_bytes: 13688 },
});

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function parsePackOutput(stdout) {
  const parsed = JSON.parse(String(stdout || '[]'));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function collectPack(root = ROOT, runPackageManager = runPackageManagerSync) {
  const result = runPackageManager('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return { status: 'missing', error: String(result.stderr || result.error || 'npm pack failed') };
  }
  try {
    const entry = parsePackOutput(result.stdout);
    return {
      status: 'present',
      observed_at: new Date().toISOString(),
      filename: entry.filename,
      size_bytes: entry.size,
      unpacked_size_bytes: entry.unpackedSize,
      file_count: Array.isArray(entry.files) ? entry.files.length : null,
    };
  } catch (error) {
    return { status: 'missing', error: `invalid npm pack JSON: ${error.message}` };
  }
}

function collectVsix(root = ROOT) {
  const pkg = readJson(path.join(root, 'vscode-extension', 'package.json'), {});
  const file = path.join(root, 'vscode-extension', `oxe-agents-${pkg.version}.vsix`);
  if (!fs.existsSync(file)) return { status: 'missing', filename: path.basename(file) };
  const stat = fs.statSync(file);
  return {
    status: 'present', filename: path.basename(file), size_bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
  };
}

function collectCoverage(root = ROOT) {
  const summary = readJson(path.join(root, 'coverage', 'coverage-summary.json'));
  if (!summary || !summary.total) return { status: 'missing' };
  const metric = (name) => Number(summary.total[name]?.pct);
  return {
    status: 'present',
    modified_at: fs.statSync(path.join(root, 'coverage', 'coverage-summary.json')).mtime.toISOString(),
    lines: metric('lines'),
    statements: metric('statements'),
    functions: metric('functions'),
    branches: metric('branches'),
  };
}

function compareNumber(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null;
  return Number((current - baseline).toFixed(2));
}

function buildReport(options = {}) {
  const baseline = options.baseline || BASELINE;
  const state = options.state || { gates: [] };
  const coverage = options.coverage || { status: 'missing' };
  const npm = options.npm || { status: 'missing' };
  const vsix = options.vsix || { status: 'missing' };
  const gates = Array.isArray(state.gates) ? state.gates : [];
  const gateNames = gates.map((gate) => gate.name);
  const missingGates = REQUIRED_GATES.filter((name) => !gateNames.includes(name));
  const unexpectedGates = gateNames.filter((name) => !REQUIRED_GATES.includes(name));
  const duplicateGates = gateNames.filter((name, index) => gateNames.indexOf(name) !== index);
  const startedAtMs = Date.parse(state.started_at || '');
  const artifactTimes = {
    coverage: Date.parse(coverage.modified_at || ''),
    npm: Date.parse(npm.observed_at || ''),
    vsix: Date.parse(vsix.modified_at || ''),
  };
  const staleArtifacts = Object.entries(artifactTimes)
    .filter(([, time]) => !Number.isFinite(startedAtMs) || !Number.isFinite(time) || time < startedAtMs)
    .map(([name]) => name);
  const artifactsPresent = coverage.status === 'present' && npm.status === 'present' && vsix.status === 'present';
  const gatesPassed = missingGates.length === 0 && unexpectedGates.length === 0 &&
    duplicateGates.length === 0 && gates.every((gate) => gate.status === 'pass');
  const evidenceFresh = staleArtifacts.length === 0;
  return {
    schema_version: 1,
    generated_at: options.generatedAt || new Date().toISOString(),
    baseline_version: baseline.version,
    run_id: state.run_id || null,
    started_at: state.started_at || null,
    status: gatesPassed && artifactsPresent && evidenceFresh ? 'passed' : 'failed',
    summary: {
      gate_count: gates.length,
      passed: gates.filter((gate) => gate.status === 'pass').length,
      failed: gates.filter((gate) => gate.status !== 'pass').length,
      duration_ms: gates.reduce((total, gate) => total + (Number(gate.duration_ms) || 0), 0),
      missing_gates: missingGates,
      unexpected_gates: [...new Set(unexpectedGates)],
      duplicate_gates: [...new Set(duplicateGates)],
      stale_artifacts: staleArtifacts,
    },
    gates,
    coverage: {
      ...coverage,
      delta: coverage.status === 'present' ? {
        lines: compareNumber(coverage.lines, baseline.coverage.lines),
        statements: compareNumber(coverage.statements, baseline.coverage.statements),
        functions: compareNumber(coverage.functions, baseline.coverage.functions),
        branches: compareNumber(coverage.branches, baseline.coverage.branches),
      } : null,
    },
    npm: {
      ...npm,
      delta: npm.status === 'present' ? {
        size_bytes: compareNumber(npm.size_bytes, baseline.npm.size_bytes),
        file_count: compareNumber(npm.file_count, baseline.npm.file_count),
      } : null,
    },
    vsix: {
      ...vsix,
      delta: vsix.status === 'present'
        ? { size_bytes: compareNumber(vsix.size_bytes, baseline.vsix.size_bytes) }
        : null,
    },
  };
}

function signed(value, suffix = '') {
  if (value == null) return 'n/a';
  return `${value > 0 ? '+' : ''}${value}${suffix}`;
}

function renderMarkdown(report) {
  const rows = report.gates.map((gate) =>
    `| ${gate.name} | ${gate.status} | ${gate.exit_code} | ${gate.duration_ms} |`
  );
  const coverage = report.coverage;
  return [
    '# OXE Quality Gates',
    '',
    `Status: **${report.status.toUpperCase()}** · duração total: **${report.summary.duration_ms} ms**`,
    '',
    '| Gate | Status | Exit code | Duration (ms) |',
    '|---|---:|---:|---:|',
    ...(rows.length ? rows : ['| _nenhum gate registrado_ | failed | n/a | 0 |']),
    '',
    `## Evolução contra baseline ${report.baseline_version}`,
    '',
    '| Indicador | Atual | Delta |',
    '|---|---:|---:|',
    `| Coverage lines | ${coverage.lines ?? 'n/a'}% | ${signed(coverage.delta?.lines, ' pp')} |`,
    `| Coverage statements | ${coverage.statements ?? 'n/a'}% | ${signed(coverage.delta?.statements, ' pp')} |`,
    `| Coverage functions | ${coverage.functions ?? 'n/a'}% | ${signed(coverage.delta?.functions, ' pp')} |`,
    `| Coverage branches | ${coverage.branches ?? 'n/a'}% | ${signed(coverage.delta?.branches, ' pp')} |`,
    `| npm package | ${report.npm.size_bytes ?? 'n/a'} bytes | ${signed(report.npm.delta?.size_bytes, ' bytes')} |`,
    `| npm files | ${report.npm.file_count ?? 'n/a'} | ${signed(report.npm.delta?.file_count)} |`,
    `| VSIX | ${report.vsix.size_bytes ?? 'n/a'} bytes | ${signed(report.vsix.delta?.size_bytes, ' bytes')} |`,
    '',
  ].join('\n');
}

function argumentValue(args, flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
}

function executeGate(args) {
  const separator = args.indexOf('--');
  const controlArgs = separator >= 0 ? args.slice(0, separator) : args;
  const nameIndex = controlArgs.indexOf('--name');
  if (separator < 0 || nameIndex < 0 || !args[nameIndex + 1] || !args[separator + 1]) {
    throw new Error('usage: quality-report exec --name <gate> [--state file] -- <command> [args]');
  }
  const name = controlArgs[nameIndex + 1];
  if (!REQUIRED_GATES.includes(name)) throw new Error(`unknown quality gate: ${name}`);
  const statePath = argumentValue(controlArgs, '--state', DEFAULT_STATE);
  const command = args[separator + 1];
  const commandArgs = args.slice(separator + 2);
  const start = process.hrtime.bigint();
  const spawnOptions = {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  };
  const normalizedManager = command.replace(/\.cmd$/i, '');
  const result = normalizedManager === 'npm' || normalizedManager === 'npx'
    ? runPackageManagerSync(normalizedManager, commandArgs, spawnOptions)
    : spawnSync(command, commandArgs, spawnOptions);
  const durationMs = Number((process.hrtime.bigint() - start) / 1000000n);
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  const state = readJson(statePath, { schema_version: 1, gates: [] });
  state.gates = (state.gates || []).filter((gate) => gate.name !== name);
  state.gates.push({
    name, status: exitCode === 0 ? 'pass' : 'fail', exit_code: exitCode,
    duration_ms: durationMs, completed_at: new Date().toISOString(),
  });
  writeJsonAtomic(statePath, state);
  return exitCode;
}

function finalize(args, options = {}) {
  const statePath = argumentValue(args, '--state', DEFAULT_STATE);
  const jsonPath = argumentValue(args, '--json', DEFAULT_JSON);
  const markdownPath = argumentValue(args, '--markdown', DEFAULT_MARKDOWN);
  const report = buildReport({
    state: readJson(statePath, { gates: [] }),
    coverage: options.coverage || collectCoverage(),
    npm: options.npm || collectPack(),
    vsix: options.vsix || collectVsix(),
    generatedAt: options.generatedAt,
  });
  writeJsonAtomic(jsonPath, report);
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(markdownPath, `${renderMarkdown(report)}\n`, 'utf8');
  console.log(`quality-report: ${report.status.toUpperCase()} — ${jsonPath}`);
  return report.status === 'passed' ? 0 : 1;
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (command === 'reset') {
    const statePath = argumentValue(argv, '--state', DEFAULT_STATE);
    writeJsonAtomic(statePath, {
      schema_version: 1,
      run_id: crypto.randomUUID(),
      started_at: new Date().toISOString(),
      gates: [],
    });
    return 0;
  }
  if (command === 'exec') return executeGate(argv.slice(1));
  if (command === 'finalize') return finalize(argv.slice(1));
  console.error('usage: quality-report <reset|exec|finalize>');
  return 2;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}

module.exports = {
  BASELINE,
  REQUIRED_GATES,
  buildReport,
  collectCoverage,
  collectPack,
  collectVsix,
  finalize,
  main,
  parsePackOutput,
  renderMarkdown,
};
