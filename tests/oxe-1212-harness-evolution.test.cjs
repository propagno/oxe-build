'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const repoMapLib = require('../bin/lib/oxe-repo-map.cjs');
const earsLib = require('../bin/lib/oxe-spec-ears.cjs');
const changeLib = require('../bin/lib/oxe-change-folder.cjs');
const telemetryLib = require('../bin/lib/oxe-telemetry.cjs');
const diffLib = require('../bin/lib/oxe-diff-reviewer.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function writeRel(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

describe('OXE harness evolution (Items #1, #4, #5, #7, #8)', () => {
  it('Item #1: oxe-repo-map builds symbol map and reverse imports, exposed via oxe-cc context --repo-map', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-repomap-'));
    dirs.push(dir);
    writeRel(dir, 'src/math.ts', 'export interface CalcResult { value: number }\nexport function add(a: number, b: number) { return a + b; }\n');
    writeRel(dir, 'src/app.ts', 'import { add } from "./math";\nexport class App { run() { return add(1, 2); } }\n');

    const map = repoMapLib.buildRepoMap(dir);
    assert.equal(map.total_files, 2);
    assert.match(map.markdown, /src\/math\.ts:.*fn:add/);
    assert.match(map.markdown, /src\/app\.ts:.*class:App/);
    assert.deepEqual(map.referenced_by['src/math'], ['src/app.ts']);

    const cli = spawnSync(process.execPath, [CLI, 'context', '--repo-map', '--json', '--dir', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 0, cli.stderr);
    const parsed = JSON.parse(cli.stdout);
    assert.equal(parsed.total_files, 2);
  });

  it('Item #4: oxe-spec-ears validates EARS syntax and flags ambiguous terms', () => {
    const spec = [
      '# SPEC',
      '## Critérios de aceite',
      '| ID | Critério | Como verificar |',
      '|---|---|---|',
      '| A1 | Quando o usuário clicar em Salvar, o sistema deve gravar o registro em <= 200ms | teste |',
      '| A2 | A tela fica rápido e intuitivo etc. | manual |',
    ].join('\n');

    const warn = earsLib.validateSpecEars(spec, { strictEars: false });
    assert.equal(warn.ok, true);
    assert.equal(warn.total_criteria, 2);
    assert.equal(warn.ears_compliant, 1);
    assert.ok(warn.warnings.some((w) => w.id === 'A2' && w.kind === 'ears_format'));
    assert.ok(warn.warnings.some((w) => w.id === 'A2' && w.kind === 'ambiguous_term'));

    const strict = earsLib.validateSpecEars(spec, { strictEars: true });
    assert.equal(strict.ok, false);
    assert.equal(strict.errors.length, 1);
  });

  it('Item #5: oxe-change-folder supports init, list, status, and promote from open quick', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-change-'));
    dirs.push(dir);

    const created = changeLib.initChangeFolder(dir, { slug: 'auth-refresh', title: 'Refresh token rotation', card: 'OXE-501' });
    assert.equal(created.slug, 'auth-refresh');
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'changes', 'auth-refresh', 'proposal.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'changes', 'auth-refresh', 'delta.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'changes', 'auth-refresh', 'tasks.json')));

    const list = changeLib.listChangeFolders(dir);
    assert.equal(list.length, 1);
    assert.equal(list[0].slug, 'auth-refresh');

    const st = changeLib.getChangeFolderStatus(dir, 'auth-refresh');
    assert.equal(st.artifacts.proposal, true);

    // Promote from an open quick via CLI
    const q = spawnSync(process.execPath, [CLI, 'quick', 'OXE-502', 'Medium refactor growing past quick', '--plain', '--dir', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(q.status, 0, q.stderr + q.stdout);
    const prom = spawnSync(process.execPath, [CLI, 'change', 'promote', '--slug', 'oxe-502-refactor', '--json', '--dir', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(prom.status, 0, prom.stderr + prom.stdout);
    const promOut = JSON.parse(prom.stdout);
    assert.equal(promOut.slug, 'oxe-502-refactor');
    assert.equal(promOut.card, 'OXE-502');
  });

  it('Item #7: oxe-telemetry aggregates events, hotspots, recommendations, and OTel JSON via CLI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-telemetry-'));
    dirs.push(dir);
    const events = [
      { run_id: 'r1', type: 'WorkItemCompleted', work_item_id: 'T1' },
      { run_id: 'r1', type: 'RetryScheduled', work_item_id: 'T2', payload: { failure_class: 'context_full' } },
      { run_id: 'r1', type: 'network_retry', work_item_id: 'T2' },
      { run_id: 'r1', type: 'context_compacted', work_item_id: 'T2' },
      { run_id: 'r1', type: 'CheckpointFailed', work_item_id: 'T2', payload: { kind: 'scope_insufficient' } },
      { run_id: 'r1', type: 'ExecutorUsage', work_item_id: 'T2', payload: { cost_usd: 0.42, input_tokens: 1000, output_tokens: 200 } },
    ];
    writeRel(dir, '.oxe/OXE-EVENTS.ndjson', `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);

    const report = telemetryLib.buildOperationalTelemetry(dir);
    assert.equal(report.totals.tasks_completed, 1);
    assert.equal(report.retries.network_retries, 1);
    assert.equal(report.retries.context_compactions, 1);
    assert.equal(report.checkpoints.failed_by_kind.scope_insufficient, 1);
    assert.equal(report.hotspots[0].task, 'T2');
    assert.ok(report.recommendations.length >= 2);

    const otel = spawnSync(process.execPath, [CLI, 'runtime', 'telemetry', '--otel', '--dir', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(otel.status, 0, otel.stderr);
    const otelJson = JSON.parse(otel.stdout);
    assert.ok(Array.isArray(otelJson.resourceSpans));
  });

  it('Item #8: oxe-diff-reviewer detects static risks and builds clean-context review prompt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-diffrev-'));
    dirs.push(dir);
    const fakeDiff = [
      'diff --git a/src/service.ts b/src/service.ts',
      '--- a/src/service.ts',
      '+++ b/src/service.ts',
      '@@ -1,2 +1,5 @@',
      '+debugger;',
      '+try { doWork(); } catch (e) {}',
    ].join('\n');

    const res = diffLib.buildCleanDiffReview(dir, { diffText: fakeDiff, specText: '| A1 | Quando salvar, deve validar |' });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.kind === 'debugger_leftover'));
    assert.ok(res.warnings.some((w) => w.kind === 'empty_catch'));
    assert.ok(res.warnings.some((w) => w.kind === 'missing_tests'));
    assert.match(res.review_prompt, /Independent Clean-Context Diff Review/);
  });
});
