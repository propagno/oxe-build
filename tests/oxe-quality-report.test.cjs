'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const quality = require('../scripts/quality-report.cjs');

test('buildReport is deterministic and calculates evolution against a baseline', () => {
  const gates = quality.REQUIRED_GATES.map((name, index) => ({
    name, status: 'pass', exit_code: 0, duration_ms: index < 2 ? [120, 30][index] : 0,
  }));
  const report = quality.buildReport({
    generatedAt: '2026-07-18T00:00:00.000Z',
    baseline: {
      version: 'baseline',
      coverage: { lines: 80, statements: 80, functions: 90, branches: 60 },
      npm: { size_bytes: 1000, file_count: 10 },
      vsix: { size_bytes: 500 },
    },
    state: { run_id: 'run-1', started_at: '2026-07-17T00:00:00.000Z', gates },
    coverage: { status: 'present', modified_at: '2026-07-17T01:00:00.000Z', lines: 82, statements: 83, functions: 91, branches: 64 },
    npm: { status: 'present', observed_at: '2026-07-17T01:00:00.000Z', size_bytes: 1100, file_count: 12 },
    vsix: { status: 'present', modified_at: '2026-07-17T01:00:00.000Z', size_bytes: 490 },
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.summary.duration_ms, 150);
  assert.deepEqual(report.coverage.delta, { lines: 2, statements: 3, functions: 1, branches: 4 });
  assert.deepEqual(report.npm.delta, { size_bytes: 100, file_count: 2 });
  assert.deepEqual(report.vsix.delta, { size_bytes: -10 });
  assert.match(quality.renderMarkdown(report), /Coverage branches \| 64% \| \+4 pp/);
});

test('missing artifacts or a failed gate make the report fail without throwing', () => {
  const report = quality.buildReport({
    generatedAt: '2026-07-18T00:00:00.000Z',
    state: { gates: [{ name: 'test', status: 'fail', exit_code: 1, duration_ms: 5 }] },
    coverage: { status: 'missing' },
    npm: { status: 'missing' },
    vsix: { status: 'missing' },
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.summary.failed, 1);
  assert.equal(report.coverage.delta, null);
});

test('relatório bloqueia gates ausentes, inesperados e artefatos stale', () => {
  const report = quality.buildReport({
    state: {
      started_at: '2026-07-18T00:00:00.000Z',
      gates: [{ name: 'lint', status: 'pass' }, { name: 'fake', status: 'pass' }],
    },
    coverage: { status: 'present', modified_at: '2026-07-17T00:00:00.000Z' },
    npm: { status: 'present', observed_at: '2026-07-18T01:00:00.000Z' },
    vsix: { status: 'present', modified_at: '2026-07-18T01:00:00.000Z' },
  });
  assert.equal(report.status, 'failed');
  assert.ok(report.summary.missing_gates.includes('coverage'));
  assert.deepEqual(report.summary.unexpected_gates, ['fake']);
  assert.deepEqual(report.summary.stale_artifacts, ['coverage']);
});

test('collectPack delegates npm execution to the shared shell-free process runner', () => {
  let call;
  const result = quality.collectPack('/tmp/project', (manager, args, options) => {
    call = { manager, args, options };
    return {
      status: 0,
      stdout: JSON.stringify([{ filename: 'oxe.tgz', size: 10, unpackedSize: 20, files: [{ path: 'package.json' }] }]),
    };
  });
  assert.equal(call.manager, 'npm');
  assert.deepEqual(call.args, ['pack', '--dry-run', '--json', '--ignore-scripts']);
  assert.equal(call.options.cwd, '/tmp/project');
  assert.equal(result.status, 'present');
  assert.equal(result.file_count, 1);
});

test('finalize writes evidence and exits non-zero for a failed report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-quality-finalize-'));
  const state = path.join(dir, 'state.json');
  const json = path.join(dir, 'report.json');
  const markdown = path.join(dir, 'report.md');
  fs.writeFileSync(state, JSON.stringify({ gates: [
    { name: 'lint', status: 'fail', exit_code: 1, duration_ms: 1 },
  ] }));
  const code = quality.finalize(
    ['--state', state, '--json', json, '--markdown', markdown],
    {
      generatedAt: '2026-07-18T00:00:00.000Z',
      coverage: { status: 'missing' },
      npm: { status: 'missing' },
      vsix: { status: 'missing' },
    }
  );
  assert.equal(code, 1);
  assert.equal(JSON.parse(fs.readFileSync(json, 'utf8')).status, 'failed');
  assert.match(fs.readFileSync(markdown, 'utf8'), /Status: \*\*FAILED\*\*/);
});

test('CLI reset and exec persist a gate result in an isolated state file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-quality-report-'));
  const state = path.join(dir, 'state.json');
  assert.equal(quality.main(['reset', '--state', state]), 0);
  assert.equal(quality.main([
    'exec', '--name', 'lint', '--state', state, '--', process.execPath, '-e', 'process.exit(0)',
  ]), 0);
  const saved = JSON.parse(fs.readFileSync(state, 'utf8'));
  assert.equal(saved.gates.length, 1);
  assert.equal(saved.gates[0].name, 'lint');
  assert.equal(saved.gates[0].status, 'pass');
  assert.ok(saved.gates[0].duration_ms >= 0);
  assert.ok(saved.run_id);
  assert.ok(saved.started_at);
});

test('opções depois de -- pertencem ao comando e não redirecionam o state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-quality-args-'));
  const state = path.join(dir, 'state.json');
  const hostile = path.join(dir, 'hostile.json');
  quality.main(['reset', '--state', state]);
  assert.equal(quality.main([
    'exec', '--name', 'lint', '--state', state, '--', process.execPath,
    '-e', 'process.exit(0)', '--', '--state', hostile,
  ]), 0);
  assert.equal(fs.existsSync(hostile), false);
  assert.equal(JSON.parse(fs.readFileSync(state, 'utf8')).gates.length, 1);
});
