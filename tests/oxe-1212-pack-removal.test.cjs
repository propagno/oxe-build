'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const removal = require('../bin/lib/oxe-pack-removed.cjs');
const { validatePackTask } = require('../bin/lib/oxe-rationality.cjs');

// 1.21.2 — OXB-088: F2 is 16 removal tasks; the pack rule "≥1 symbol per code file" could not be met by a task whose
// contract is what must NOT exist any more. And F1's stale pack passed T1–T13 of F2 because the ids happened to match.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const removalEntry = {
  id: 'T14', mode: 'mutating', write_set: 'closed', contracts: ['sem AI Memory'], expected_checks: ['vitest'],
  exact_paths: ['electron/main/ai-memory/index.ts', 'electron/main/ipc.ts'],
  removed_paths: ['electron/main/ai-memory/index.ts'],
  symbols_removed: [{ name: 'registerMemoryIpc', path: 'electron/main/ipc.ts' }],
};

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-rm-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'electron', 'main', 'ai-memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'electron', 'main', 'ai-memory', 'index.ts'), 'export const memory = 1;\n');
  fs.writeFileSync(path.join(dir, 'electron', 'main', 'ipc.ts'), 'export function registerMemoryIpc() {}\nexport function registerCoreIpc() {}\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), JSON.stringify({ phase: 'F2', tasks: [removalEntry] }));
  return dir;
}

describe('OXB-088: removal tasks in the IMPLEMENTATION-PACK', () => {
  it('a removal whose code paths are covered by removed_paths / symbols_removed needs no symbols; an uncovered path does', () => {
    assert.deepEqual(validatePackTask(removalEntry).gaps, []);
    const { gaps } = validatePackTask({ ...removalEntry, exact_paths: [...removalEntry.exact_paths, 'electron/main/menu.ts'] });
    assert.match(gaps.join('\n'), /T14 sem symbols \(escreve arquivo de código: electron\/main\/menu\.ts\)/);
    assert.match(validatePackTask({ ...removalEntry, removed_paths: [], symbols_removed: [] }).gaps.join('\n'), /numa remoção, declare removed_paths \/ symbols_removed/);
    assert.match(validatePackTask({ ...removalEntry, symbols_removed: [{ name: 'x' }] }).gaps.join('\n'), /symbols_removed inválido/);
  });

  it('the static check: before the removal it is red (still exists / still exports), after it green; kept exports do not matter', () => {
    const dir = project();
    let res = removal.checkRemoval(dir, removalEntry);
    assert.deepEqual(res.problems, ['electron/main/ai-memory/index.ts ainda existe (removed_paths)', 'electron/main/ipc.ts ainda exporta registerMemoryIpc (symbols_removed)']);
    const cmd = removal.checkCommand(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'T14');
    let r = spawnSync(cmd, { cwd: dir, shell: true, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /AssertionError: removal T14: electron\/main\/ai-memory\/index\.ts ainda existe/);
    fs.rmSync(path.join(dir, 'electron', 'main', 'ai-memory'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'ipc.ts'), 'export function registerCoreIpc() {}\n');
    res = removal.checkRemoval(dir, removalEntry);
    assert.deepEqual(res.problems, []);
    r = spawnSync(cmd, { cwd: dir, shell: true, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  it('the pack contract never requires a removed path to exist, and the removal check joins the task verify', () => {
    const dir = project();
    const plan = { tasks: [{ id: 'T14', files: removalEntry.exact_paths, verifyCommand: 'vitest run' }] };
    // attachImplementationPackContracts is internal; the compiled plan of a lint shows its effect.
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A48 | sem memory | manual |\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, phase: 'F2', tasks: [{ id: 'T14', title: 'remover AI Memory', wave: 1, files: plan.tasks[0].files, acceptance: ['A48'], verify: { commands: ['node -e "process.exit(0)"'] } }] }));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const lint = op.runtimePlanLint(dir, null, { preflight: false, dryVerify: true, dryVerifyAnyway: true });
    const entry = (lint.dry_verify || []).find((x) => x.task === 'T14');
    assert.ok(entry, JSON.stringify(lint));
    assert.equal(entry.segments, 2, 'the task verify + the removal check');
    assert.equal(entry.verdict, 'assertion_red', 'before the task: red for the right reason');
    assert.ok(!lint.errors.some((e) => /sem symbols/.test(e)), lint.errors.join('\n'));
  });

  it('lint names a pack of another phase', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), JSON.stringify({ phase: 'F1', tasks: [{ ...removalEntry, id: 'T1' }] }));
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A48 | x | manual |\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, phase: 'F2', tasks: [{ id: 'T14', title: 'x', wave: 1, files: ['src/a.ts'], acceptance: ['A48'] }] }));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const lint = op.runtimePlanLint(dir, null, { preflight: false });
    assert.ok(lint.errors.some((e) => /T14: tarefa mutável sem entrada no IMPLEMENTATION-PACK \(o pack é da fase F1\)/.test(e)), lint.errors.join('\n'));
    assert.ok(lint.warnings.some((w) => /IMPLEMENTATION-PACK é da fase F1, e o plano é da F2/.test(w)));
  });
});
