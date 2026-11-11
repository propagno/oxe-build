'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const rigor = require('../bin/lib/oxe-test-rigor.cjs');

// 1.21.2 — OXB-205: suspicious regex lint on frozen acceptance suites + `oxe-cc plan amend-test`.

const CLI = path.resolve(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], {
  cwd,
  encoding: 'utf8',
  windowsHide: true,
});
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content, 'utf8');
};

function makePhaseF6Project(testBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-amend-'));
  dirs.push(dir);
  const frozenRel = 'tests/acceptance/f6/u61-header-as-task.test.tsx';
  const otherFrozenRel = 'tests/acceptance/f6/u62-other.test.tsx';
  const otherBody = "import { it, expect } from 'vitest';\nit('A2 baseline', () => { expect(1 + 1).toBe(2); });\n";

  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# STATE\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', [
    '# SPEC',
    '',
    '## Critérios de aceite',
    '',
    '| ID | Critério | Como verificar |',
    '|---|---|---|',
    '| A1 | Header tabs counters | vitest |',
    '| A2 | Baseline | vitest |',
    '',
  ].join('\n'));
  write(dir, '.oxe/ROADMAP.md', '# ROADMAP\n\n## Fase 6 — Header\n\n**Critérios de aceite:** A1, A2\n');
  write(dir, '.oxe/config.json', JSON.stringify({
    external_dependency_check: false,
    stub_check: false,
    checkpoint_commits: false,
  }));
  write(dir, frozenRel, testBody);
  write(dir, otherFrozenRel, otherBody);
  write(dir, 'src/header.tsx', 'export const renderHeader = () => "Changes 2";\n');

  const planDoc = {
    schema_version: 1,
    phase: 'F6',
    acceptance_tests: [
      {
        criterion: 'A1',
        files: [frozenRel],
        command: 'node -e 0',
        proves: ['renders header tab counters'],
        sha256: sha256(testBody),
      },
      {
        criterion: 'A2',
        files: [otherFrozenRel],
        command: 'node -e 0',
        proves: ['A2 baseline'],
        sha256: sha256(otherBody),
      },
    ],
    tasks: [
      { id: 'T1', title: 'Task 1', wave: 1, files: ['src/header.tsx'], acceptance: ['A1'], verify: { commands: ['node -e 0'] }, done: true, status: 'done', done_at: '2026-11-10T10:00:00.000Z', done_commit: '1111111' },
      { id: 'T2', title: 'Task 2', wave: 1, files: ['src/header.tsx'], acceptance: ['A1'], verify: { commands: ['node -e 0'] }, done: true, status: 'done', done_at: '2026-11-10T10:05:00.000Z', done_commit: '2222222' },
      { id: 'T3', title: 'Task 3', wave: 1, files: ['src/header.tsx'], acceptance: ['A1'], verify: { commands: ['node -e 0'] }, done: true, status: 'done', done_at: '2026-11-10T10:10:00.000Z', done_commit: '3333333' },
      { id: 'T4', title: 'Task 4', wave: 2, depends_on: ['T1'], files: ['src/header.tsx'], acceptance: ['A1'], verify: { commands: ['node -e 0'] }, done: true, status: 'done', done_at: '2026-11-10T10:15:00.000Z', done_commit: '4444444' },
      { id: 'T5', title: 'Task 5', wave: 2, depends_on: ['T2'], files: ['src/header.tsx'], acceptance: ['A1'], verify: { commands: ['node -e 0'] }, done: true, status: 'done', done_at: '2026-11-10T10:20:00.000Z', done_commit: '5555555' },
      { id: 'T6', title: 'Task 6', wave: 3, depends_on: ['T4', 'T5'], files: ['src/header.tsx'], acceptance: ['A1', 'A2'], verify: { commands: ['node -e 0'] } },
    ],
  };
  write(dir, '.oxe/PLAN.json', JSON.stringify(planDoc, null, 2));

  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@oxe.dev');
  git(dir, 'config', 'user.name', 'OXE Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'freeze f6');
  return { dir, frozenRel, otherFrozenRel, otherSha: sha256(otherBody) };
}

describe('OXB-205: suspicious regex lint on frozen suites & `oxe-cc plan amend-test`', () => {
  it('flags `/d+/`, `/s+/`, `/w+/` missing backslash next to `.replace(` and contradictory `.replace(/\\d+/g, "")` + digit assertion in `plan lint`', () => {
    const buggyTest = [
      "import { it, expect } from 'vitest';",
      "import { renderHeader } from '../../../src/header';",
      "it('renders header tab counters', () => {",
      "  const raw = renderHeader();",
      "  const stripped = raw.replace(/\\d+/g, '').trim();",
      "  expect(stripped).toMatch(/2/);",
      "  const tabs = 'Changes 1 Files 3 Checks 1'.replace(/d+/g, '');",
      "  const compact = tabs.replace(/s+/g, ' ').replace(/w+/g, 'x');",
      "  expect(compact).toBeTruthy();",
      "});",
      '',
    ].join('\n');

    const { dir, frozenRel } = makePhaseF6Project(buggyTest);
    const findings = rigor.suspiciousRegexFindings(dir, [frozenRel]);
    const kinds = findings.map((f) => f.kind);
    assert.ok(kinds.includes('unescaped_char_class'), 'must detect /d+/, /s+/, /w+/ without backslash');
    assert.ok(kinds.includes('contradictory_strip_assert'), 'must detect strip digits followed by digit assertion');
    assert.ok(findings.some((f) => f.pattern === '/d+/g' && f.suggestion === '/\\d+/g'));

    const lintRes = op.runtimePlanLint(dir, null);
    assert.equal(lintRes.ok, false, 'plan lint must fail on suspicious regex in frozen test');
    assert.ok(lintRes.errors.some((e) => e.includes('u61-header-as-task.test.tsx') && e.includes('/d+/g')));
    assert.ok(lintRes.errors.some((e) => e.includes('contradição em teste congelado')));
  });

  it('`oxe-cc plan amend-test <path> --reason "<CR-id>"` recalculates only that file sha256, preserves T1..T5 done status, updates active lock, and logs FrozenTestAmended', () => {
    const initialTest = [
      "import { it, expect } from 'vitest';",
      "import { renderHeader } from '../../../src/header';",
      "it('renders header tab counters', () => {",
      "  const tabs = renderHeader().replace(/d+/g, '');",
      "  expect(tabs).toContain('Changes');",
      "});",
      '',
    ].join('\n');

    const { dir, frozenRel, otherFrozenRel, otherSha } = makePhaseF6Project(initialTest);
    const oldSha = sha256(initialTest);

    // Compile an active run so acceptance_lock is frozen with oldSha
    op.compileExecutionGraphFromArtifacts(dir, null);
    const runBefore = op.readRunState(dir, null);
    assert.ok(runBefore && runBefore.acceptance_lock, 'active run has acceptance_lock');

    // Tech Lead applies surgical fix to the frozen test on disk
    const fixedTest = [
      "import { it, expect } from 'vitest';",
      "import { renderHeader } from '../../../src/header';",
      "it('renders header tab counters', () => {",
      "  const raw = renderHeader();",
      "  const labelOnly = raw.replace(/\\d+/g, '').trim();",
      "  expect(labelOnly).toBe('Changes');",
      "  expect(raw).toMatch(/2/);",
      "});",
      '',
    ].join('\n');
    write(dir, frozenRel, fixedTest);
    const expectedNewSha = sha256(fixedTest);

    // Before amend-test, commit-task T6 would reject as acceptance_tampered
    write(dir, 'src/header.tsx', 'export const renderHeader = () => "Changes 2"; // T6 impl\n');
    assert.throws(
      () => op.runtimeCommitTask(dir, null, { task: 'T6', by: 'executor' }),
      /acceptance_tampered/,
    );

    // Run `oxe-cc plan amend-test <path> --reason "CR-06" --by tech-lead --json`
    const amendOut = cli(dir, 'plan', 'amend-test', frozenRel, '--reason', 'CR-06', '--by', 'tech-lead', '--json');
    assert.equal(amendOut.status, 0, amendOut.stderr || amendOut.stdout);
    const amendJson = JSON.parse(amendOut.stdout);
    assert.equal(amendJson.ok, true);
    assert.equal(amendJson.file, frozenRel);
    assert.equal(amendJson.previous_sha256, oldSha);
    assert.equal(amendJson.sha256, expectedNewSha);
    assert.equal(amendJson.reason, 'CR-06');
    assert.equal(amendJson.preserved_done_tasks, 5);

    // Verify PLAN.json: ONLY u61's sha256 changed; u62's sha256 and T1..T5 status:"done" + done_commit are untouched!
    const afterPlan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const u61Entry = afterPlan.acceptance_tests.find((a) => a.files.includes(frozenRel));
    const u62Entry = afterPlan.acceptance_tests.find((a) => a.files.includes(otherFrozenRel));
    assert.equal(u61Entry.sha256, expectedNewSha);
    assert.equal(u61Entry.hashes[frozenRel], expectedNewSha);
    assert.ok(u61Entry.resolves.includes('CR-06'));
    assert.equal(u62Entry.sha256, otherSha, 'other frozen test sha256 must remain untouched');

    for (let n = 1; n <= 5; n += 1) {
      const t = afterPlan.tasks.find((x) => x.id === `T${n}`);
      assert.equal(t.done, true, `T${n}.done preserved`);
      assert.equal(t.status, 'done', `T${n}.status preserved`);
      assert.equal(t.done_commit, `${n}`.repeat(7), `T${n}.done_commit preserved`);
    }
    const t6 = afterPlan.tasks.find((x) => x.id === 'T6');
    assert.equal(t6.done, undefined);

    // Verify FrozenTestAmended event in OXE-EVENTS.ndjson
    const events = op.readEvents(dir, null);
    const ev = events.find((e) => e.type === 'FrozenTestAmended');
    assert.ok(ev, 'FrozenTestAmended event recorded');
    assert.equal(ev.payload.file, frozenRel);
    assert.equal(ev.payload.previous_sha256, oldSha);
    assert.equal(ev.payload.sha256, expectedNewSha);
    assert.equal(ev.payload.reason, 'CR-06');
    assert.equal(ev.payload.by, 'tech-lead');

    // Now T6 commit-task succeeds without acceptance_tampered!
    const commitRes = op.runtimeCommitTask(dir, null, { task: 'T6', by: 'executor' });
    assert.equal(commitRes.ok, true);
  });

  it('refuses `plan amend-test` when `--reason` is missing or when the amended file still has a suspicious regex', () => {
    const buggyTest = [
      "import { it, expect } from 'vitest';",
      "it('renders header tab counters', () => {",
      "  expect('Changes 1'.replace(/d+/g, '')).toBe('Changes ');",
      "});",
      '',
    ].join('\n');
    const { dir, frozenRel } = makePhaseF6Project(buggyTest);

    const noReason = cli(dir, 'plan', 'amend-test', frozenRel, '--json');
    assert.equal(noReason.status, 1);
    assert.match(noReason.stdout, /--reason/);

    const stillBroken = cli(dir, 'plan', 'amend-test', frozenRel, '--reason', 'CR-07', '--json');
    assert.equal(stillBroken.status, 1);
    assert.match(stillBroken.stdout, /regex suspeita/);
  });
});
