'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const writeFiles = (dir, files) => {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
};

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
};

const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', windowsHide: true });

describe('OXB-C7 #1: plan pack sync|rebuild Tn regenerates single task pack entry and refuses started tasks', () => {
  it('rewrites legacy hand-built pack entry to lean C5b schema with derived symbols & phase, leaving other tasks intact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c7-pack-'));
    dirs.push(dir);
    writeFiles(dir, {
      '.oxe/STATE.md': '# STATE\n',
      '.oxe/SPEC.md': '# SPEC\n\n| ID | Critério | Verificação |\n|---|---|---|\n| A5 | approve action | vitest |\n',
      '.oxe/PLAN.md': '# PLAN\n\n### T5 — Approve action\n',
      '.oxe/config.json': JSON.stringify({ external_dependency_check: false }, null, 2),
      'src/approvals.ts': 'export function approveDecision() { return true; }\nexport function revokeDecision() { return false; }\n',
      'tests/acceptance/a5-approvals.test.ts': [
        "import { describe, it } from 'vitest';",
        "import { approveDecision, revokeDecision } from '../../src/approvals';",
        "describe('A5', () => {",
        "  it('approves and revokes', () => { approveDecision(); revokeDecision(); });",
        '});',
      ].join('\n') + '\n',
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F3',
        acceptance_tests: [
          { criterion: 'A5', task: 'T5', files: ['tests/acceptance/a5-approvals.test.ts'], command: 'npx vitest run tests/acceptance/a5-approvals.test.ts' },
        ],
        tasks: [
          { id: 'T1', title: 'unrelated task', wave: 1, files: ['src/other.ts'], verify: { commands: ['node -e 0'] } },
          { id: 'T5', title: 'approve flow', wave: 1, acceptance: ['A5'], files: ['src/approvals.ts'], verify: { commands: ['npx vitest run tests/unit/approvals.test.ts'] } },
        ],
      }, null, 2),
      '.oxe/IMPLEMENTATION-PACK.json': JSON.stringify({
        schema_version: 1,
        tasks: [
          { id: 'T1', mode: 'mutating', exact_paths: ['src/other.ts'], symbols: [], contracts: ['escopo fechado: src/other.ts'], expected_checks: ['node -e 0'], custom_keep: 'untouched' },
          { id: 'T5', title: 'legacy title', risk: 'P1', ready: true, mode: 'mutating', exact_paths: ['src/approvals.ts'], symbols: [], contracts: [{ name: 'old-object-contract' }], expected_checks: ['old-check'] },
        ],
      }, null, 2),
    });

    // Dry-run does not modify disk
    const dry = op.runtimePlanPackSync(dir, null, { task: 'T5', dryRun: true });
    assert.equal(dry.dry_run, true);
    assert.equal(dry.action, 'rebuilt');
    assert.equal(dry.after.phase, 'F3');
    assert.equal(dry.after.title, undefined);
    assert.equal(dry.after.symbols.length, 2);
    const packBefore = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    assert.equal(packBefore.tasks[1].title, 'legacy title');

    // Live rebuild via CLI alias `plan pack rebuild T5`
    const cliRes = runCli(['plan', 'pack', 'rebuild', 'T5', '--dir', dir, '--json']);
    assert.equal(cliRes.status, 0, cliRes.stdout + cliRes.stderr);
    const parsed = JSON.parse(cliRes.stdout);
    assert.equal(parsed.oxePlanPackSyncSchema, 1);
    assert.equal(parsed.action, 'rebuilt');

    const packAfter = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    assert.equal(packAfter.tasks[0].custom_keep, 'untouched', 'other tasks must not be rewritten');
    const t5 = packAfter.tasks[1];
    assert.equal(t5.id, 'T5');
    assert.equal(t5.phase, 'F3');
    assert.equal(t5.title, undefined);
    assert.equal(t5.risk, undefined);
    assert.equal(t5.ready, undefined);
    assert.deepEqual(t5.exact_paths, ['src/approvals.ts']);
    assert.deepEqual(t5.expected_checks, ['npx vitest run tests/unit/approvals.test.ts']);
    assert.deepEqual(t5.symbols.map((s) => `${s.path}#${s.name}`).sort(), ['src/approvals.ts#approveDecision', 'src/approvals.ts#revokeDecision']);
    assert.ok(t5.contracts.every((c) => typeof c === 'string'), 'contracts must be lean strings');

    // Refuses once task has started (event or done/status/started_at)
    op.appendEvent(dir, null, { type: 'TaskStarted', work_item_id: 'T5', payload: { task: 'T5' } });
    assert.throws(() => op.runtimePlanPackSync(dir, null, { task: 'T5' }), /já iniciou execução/);
    const planDoc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    planDoc.tasks[0].done = true;
    writeFiles(dir, { '.oxe/PLAN.json': JSON.stringify(planDoc, null, 2) });
    assert.throws(() => op.runtimePlanPackSync(dir, null, { task: 'T1' }), /já iniciou execução/);
  });
});

describe('OXB-C7 #2: plan verify add and plan task edit --add-verify sync expected_checks in pack', () => {
  it('adds verify commands via --command, --suite, and task edit --add-verify and syncs IMPLEMENTATION-PACK.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c7-vadd-'));
    dirs.push(dir);
    writeFiles(dir, {
      '.oxe/STATE.md': '# STATE\n',
      '.oxe/PLAN.md': '# PLAN\n',
      '.oxe/config.json': JSON.stringify({ external_dependency_check: false }, null, 2),
      'tests/unit/extra-vitest.test.ts': "import { it } from 'vitest';\nit('ok', () => {});\n",
      'tests/integration/node-check.test.cjs': "const { it } = require('node:test');\nit('ok', () => {});\n",
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F3',
        tasks: [
          { id: 'T5', title: 'verify target', wave: 1, files: ['src/a.ts'], verify: { commands: ['npm run typecheck'] } },
          { id: 'T6', title: 'already done', wave: 1, files: ['src/b.ts'], verify: { commands: ['node -e 0'] }, done: true },
        ],
      }, null, 2),
      '.oxe/IMPLEMENTATION-PACK.json': JSON.stringify({
        schema_version: 1,
        tasks: [
          { id: 'T5', mode: 'mutating', exact_paths: ['src/a.ts'], symbols: [], contracts: ['escopo fechado: src/a.ts'], expected_checks: ['npm run typecheck'] },
        ],
      }, null, 2),
    });

    // 1. CLI `plan verify add T5 --command "..." --suite tests/unit/extra-vitest.test.ts`
    const r1 = runCli(['plan', 'verify', 'add', 'T5', '--command', 'npm run lint:css', '--suite', 'tests/unit/extra-vitest.test.ts', '--dir', dir, '--json']);
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const out1 = JSON.parse(r1.stdout);
    assert.equal(out1.oxePlanVerifyAddSchema, 1);
    assert.equal(out1.pack_updated, true);
    assert.deepEqual(out1.added, ['npm run lint:css', 'npx vitest run tests/unit/extra-vitest.test.ts']);

    // 2. Node:test suite detection
    const r2 = op.runtimePlanVerifyAdd(dir, null, { task: 'T5', suite: 'tests/integration/node-check.test.cjs' });
    assert.deepEqual(r2.added, ['node --test tests/integration/node-check.test.cjs']);

    // 3. Deduplicates already present commands
    const dup = op.runtimePlanVerifyAdd(dir, null, { task: 'T5', command: 'npm run typecheck' });
    assert.deepEqual(dup.added, []);
    assert.equal(dup.pack_updated, false);

    // 4. `plan task edit T5 --add-verify "..."` also adds and syncs pack
    const r3 = runCli(['plan', 'task', 'edit', 'T5', '--add-verify', 'npm run build:check', '--by', 'coord', '--reason', 'inclui check G30 pendente', '--dir', dir]);
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    assert.match(r3.stdout, /verify \+npm run build:check/);
    assert.match(r3.stdout, /\+IMPLEMENTATION-PACK\.json/);

    const finalPlan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const finalPack = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    const expected = [
      'npm run typecheck',
      'npm run lint:css',
      'npx vitest run tests/unit/extra-vitest.test.ts',
      'node --test tests/integration/node-check.test.cjs',
      'npm run build:check',
    ];
    assert.deepEqual(finalPlan.tasks[0].verify.commands, expected);
    assert.deepEqual(finalPack.tasks[0].expected_checks, expected);

    // Refuses done task
    assert.throws(() => op.runtimePlanVerifyAdd(dir, null, { task: 'T6', command: 'npm test' }), /T6 está done/);
  });
});

describe('OXB-C7 #3: spec freeze --criteria A15,A16,A17 freezes every criterion in list', () => {
  it('freezes all criteria across separate matching files, shared multi-describe file, and untagged file, and refuses unmatched ids explicitly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c7-freeze-'));
    dirs.push(dir);
    writeFiles(dir, {
      '.gitignore': '.oxe/\n',
      '.oxe/STATE.md': '# S\n',
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        tasks: [
          { id: 'T4', title: 'chat f5', wave: 1, files: ['src/chat.ts'], acceptance: ['A15', 'A16', 'A17', 'A18'], verify: { commands: ['node -e 0'] } },
        ],
      }, null, 2),
      'src/chat.ts': 'export const chat = true;\n',
    });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 't@t.local']);
    git(dir, ['config', 'user.name', 'Test']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'base']);

    // Commit 1: three files, each tagged with its own criterion A15 / A16 / A17
    writeFiles(dir, {
      'tests/acceptance/a15-one.test.ts': "import { describe, it } from 'vitest';\ndescribe('A15 first', () => { it('checks A15 behavior', () => {}); });\n",
      'tests/acceptance/a16-two.test.ts': "import { describe, it } from 'vitest';\ndescribe('A16 second', () => { it('checks A16 behavior', () => {}); });\n",
      'tests/acceptance/a17-three.test.ts': "import { describe, it } from 'vitest';\ndescribe('A17 third', () => { it('checks A17 behavior', () => {}); });\n",
    });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'three frozen acceptance files']);
    const shaMulti = git(dir, ['rev-parse', 'HEAD']);

    const outMulti = op.runtimeSpecFreeze(dir, null, { from: shaMulti, criteria: 'A15,A16,A17', task: 'T4' });
    assert.equal(outMulti.refused.length, 0, JSON.stringify(outMulti.refused));
    assert.deepEqual(outMulti.frozen.map((x) => [x.criterion, x.file]).sort(), [
      ['A15', 'tests/acceptance/a15-one.test.ts'],
      ['A16', 'tests/acceptance/a16-two.test.ts'],
      ['A17', 'tests/acceptance/a17-three.test.ts'],
    ]);

    const docAfterMulti = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.equal(docAfterMulti.acceptance_tests.length, 3);
    for (const a of docAfterMulti.acceptance_tests) {
      assert.ok(a.sha256 && /^[0-9a-f]{64}$/.test(a.sha256), `expected sha256 on ${a.criterion}`);
      assert.ok(a.hashes && a.hashes[a.files[0]] === a.sha256);
    }

    // Commit 2: one shared file containing describes for A18, A19, and A20
    writeFiles(dir, {
      'tests/acceptance/shared-chat.test.ts': [
        "import { describe, it } from 'vitest';",
        "describe('A18 stream start', () => { it('A18 starts', () => {}); });",
        "describe('A19 stream pause', () => { it('A19 pauses', () => {}); });",
        "describe('A20 stream resume', () => { it('A20 resumes', () => {}); });",
      ].join('\n') + '\n',
    });
    git(dir, ['add', 'tests/acceptance/shared-chat.test.ts']);
    git(dir, ['commit', '-qm', 'shared multi-criterion suite']);
    const shaShared = git(dir, ['rev-parse', 'HEAD']);

    const outShared = op.runtimeSpecFreeze(dir, null, { from: shaShared, criteria: 'A18,A19,A20', task: 'T4' });
    assert.equal(outShared.refused.length, 0, JSON.stringify(outShared.refused));
    assert.deepEqual(outShared.frozen.map((x) => x.criterion), ['A18', 'A19', 'A20']);
    const docAfterShared = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const byCrit = new Map(docAfterShared.acceptance_tests.map((a) => [a.criterion, a]));
    assert.deepEqual(byCrit.get('A18').proves, ['A18 starts']);
    assert.deepEqual(byCrit.get('A19').proves, ['A19 pauses']);
    assert.deepEqual(byCrit.get('A20').proves, ['A20 resumes']);

    // Commit 3: A99 in --criteria doesn't match any test when files declare criteria -> refused explicitly (not silent drop!)
    writeFiles(dir, {
      'tests/acceptance/a21-only.test.ts': "import { describe, it } from 'vitest';\ndescribe('A21 only', () => { it('works', () => {}); });\n",
    });
    git(dir, ['add', 'tests/acceptance/a21-only.test.ts']);
    git(dir, ['commit', '-qm', 'single tagged criterion']);
    const shaPartial = git(dir, ['rev-parse', 'HEAD']);

    const cliFail = runCli(['spec', 'freeze', '--from', shaPartial, '--paths', 'tests/acceptance/a21-only.test.ts', '--criteria', 'A21,A99', '--dir', dir]);
    assert.equal(cliFail.status, 1);
    assert.match(cliFail.stdout + cliFail.stderr, /A99.*não correspondeu/i);
  });
});
