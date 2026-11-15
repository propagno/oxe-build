'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const e2eReady = require('../bin/lib/oxe-e2e-ready.cjs');
const skeleton = require('../bin/lib/oxe-plan-skeleton.cjs');
const stubCheck = require('../bin/lib/oxe-stub-check.cjs');
const reviewLib = require('../bin/lib/oxe-plan-review.cjs');
const specFreeze = require('../bin/lib/oxe-spec-freeze.cjs');
const domHooks = require('../bin/lib/oxe-dom-hooks.cjs');
const packRemoved = require('../bin/lib/oxe-pack-removed.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('Round 8 — oxe-e2e-ready precision (done criterion entries, multi-line block comments, multi-line skip)', () => {
  it('skips criterion-bound entries (without entry.task) when all owning tasks are done across G40, G40b, G41, G42', () => {
    const racySpec = [
      "import { test } from '@playwright/test';",
      "test('old', async () => {",
      '  const page = await launchApp();',
      "  await page.keyboard.press('Control+Shift+U');",
      "  await page.getByRole('menuitem', { name: /Comfortable/ }).click();",
      '});',
    ].join('\n');
    const ktSpec = [
      'class OldPaparazziTest {',
      '  @get:Rule val paparazzi = Paparazzi()',
      '  @Test fun oldLocale() { val ctx = context.createConfigurationContext(config) }',
      '}',
    ].join('\n');
    const dockerSpec = [
      "const bad = () => spawnSync('docker', ['info']).status !== 0;",
      'test.skip(bad());',
      "test('pg', () => { spawnSync('docker', ['run', 'postgres:16']); });",
    ].join('\n');
    const files = {
      'e2e/done-racy.spec.ts': racySpec,
      'app/src/test/OldPaparazziTest.kt': ktSpec,
      'e2e/done-docker.spec.ts': dockerSpec,
      'locales/en.json': JSON.stringify({ density: 'Use comfortable density' }),
    };

    // Criterion-bound entries WITHOUT `task` field where owning task T1 has `done: true` (and T2 has `status: 'done'`)
    const doc = {
      tasks: [
        { id: 'T1', done: true, acceptance: ['AC-DONE-1'] },
        { id: 'T2', status: 'done', aceite: ['AC-DONE-2'] },
      ],
      acceptance_tests: [
        { criterion: 'AC-DONE-1', files: ['e2e/done-racy.spec.ts', 'app/src/test/OldPaparazziTest.kt'] },
        { criterion: 'AC-DONE-2', files: ['e2e/done-docker.spec.ts'] },
      ],
    };

    const readText = (f) => files[f] || '';
    assert.deepEqual(e2eReady.racyFrozenE2e('/x', doc, { readText }), []);
    assert.deepEqual(e2eReady.labelMismatches('/x', doc, { catalogs: ['locales/en.json'], readText }), []);
    assert.deepEqual(e2eReady.layoutlibHazards('/x', doc, { readText }), []);
    assert.deepEqual(e2eReady.containerGuardHazards('/x', doc, { readText }), []);
  });

  it('ignores multi-line /* ... */ comments across G40/G40b/G41/G42 and catches multi-line reason-less test.skip(...)', () => {
    const commentedRacy = [
      "import { test } from '@playwright/test';",
      '/*',
      ' * Example in block comment:',
      ' * const page = await launchApp();',
      " * await page.keyboard.press('Enter');",
      " * await page.getByRole('menuitem', { name: /Comfortable/ }).click();",
      ' */',
      "test('clean', async () => {",
      '  const page = await launchApp();',
      "  await page.locator('#ready').waitFor();",
      "  await page.keyboard.press('Enter');",
      '});',
    ].join('\n');
    assert.deepEqual(e2eReady.racyActions(commentedRacy), []);

    const multilineSkipSpec = [
      '/* docker run postgres:16 */',
      "const linuxReady = () => spawnSync('docker', ['info', '--format', '{{.OSType}}']).stdout.trim() === 'linux';",
      'test.skip(',
      '  !linuxReady()',
      ');',
      "test('pg', () => { spawnSync('docker', ['run', 'postgres:16']); });",
    ].join('\n');
    const doc = {
      tasks: [{ id: 'T1', acceptance: ['A1'] }],
      acceptance_tests: [
        { criterion: 'A1', files: ['e2e/commented.spec.ts', 'e2e/multi-skip.spec.ts'] },
      ],
    };
    const files = {
      'e2e/commented.spec.ts': commentedRacy,
      'e2e/multi-skip.spec.ts': multilineSkipSpec,
      'locales/en.json': JSON.stringify({ density: 'Use comfortable density' }),
    };
    const readText = (f) => files[f] || '';
    assert.deepEqual(e2eReady.labelMismatches('/x', doc, { catalogs: ['locales/en.json'], readText }), []);
    const guards = e2eReady.containerGuardHazards('/x', doc, { readText });
    assert.deepEqual(guards.map((g) => [g.file, g.line, g.kind]), [['e2e/multi-skip.spec.ts', 3, 'skip_reason']]);
  });
});

describe('Round 8 — oxe-plan-skeleton & oxe-stub-check precision (Kotlin receivers, $-symbols, comments, Java methods)', () => {
  it('nameOf extracts Kotlin receiver extensions, generator functions, and typealias accurately', () => {
    assert.equal(skeleton.nameOf('fun String.toSlug(): String'), 'toSlug');
    assert.equal(skeleton.nameOf('fun <T> List<T>?.firstSafe(): T?'), 'firstSafe');
    assert.equal(skeleton.nameOf('export function* eventStream(seed: number)'), 'eventStream');
    assert.equal(skeleton.nameOf('typealias SessionId = String'), 'SessionId');
  });

  it('skeleton.plan ignores symbol mentions in comments/strings, stays idempotent on $store and Java methods, and skips status=done tasks', () => {
    const dir = mkDir('oxe-r8-skel-');
    // `drain` appears in a comment and a string, NOT defined yet — skeleton MUST still emit the stub!
    write(dir, 'src/queue.ts', "// Next wave implements drain\nexport const LABEL = 'drain';\n");
    write(dir, 'src/state.ts', 'export const $store: number = undefined as unknown as number;\n');
    write(
      dir,
      'src/main/java/com/oxe/Queue.java',
      'package com.oxe;\n\npublic class Queue {\n  public int size() {\n    throw new UnsupportedOperationException("TODO");\n  }\n}\n',
    );

    assert.equal(stubCheck.definesSymbol(fs.readFileSync(path.join(dir, 'src/main/java/com/oxe/Queue.java'), 'utf8'), 'size'), true);

    const doc = {
      tasks: [
        { id: 'T1', title: 'queue', wave: 1, files: ['src/queue.ts', 'src/state.ts', 'src/main/java/com/oxe/Queue.java'] },
        { id: 'T2', title: 'already done by status', wave: 1, status: 'done', files: ['src/done.ts'] },
      ],
    };
    const pack = {
      tasks: [
        {
          id: 'T1',
          symbols: [
            { name: 'drain', path: 'src/queue.ts', signature: 'export function drain(max: number): number' },
            { name: '$store', path: 'src/state.ts', signature: 'export const $store: number' },
            { name: 'size', path: 'src/main/java/com/oxe/Queue.java', signature: 'public int size()' },
          ],
        },
        {
          id: 'T2',
          symbols: [{ name: 'skipMe', path: 'src/done.ts', signature: 'export function skipMe(): void' }],
        },
      ],
    };

    const planned = skeleton.plan(dir, doc, pack);
    assert.deepEqual(
      planned.files.map((f) => [f.path, f.stubs.map((s) => s.name)]),
      [['src/queue.ts', ['drain']]],
      'generates stub for commented `drain`, keeps `$store` and Java `size()` idempotent, and skips `status: done` T2',
    );
  });
});

describe('Round 8 — oxe-plan-review precision (self-title links illusion, object file entries, status=done, command-only verification)', () => {
  it('flags orphan new module in links even when creating task repeats stem in its own title/commit, handles {path} entries and status=done', () => {
    const dir = mkDir('oxe-r8-review-');
    write(dir, 'tests/acceptance/a1.test.ts', 'export const ok = 1;\n');

    const doc = {
      tasks: [
        {
          id: 'T0',
          title: 'finished earlier',
          status: 'done',
          files: [], // done via status='done': must NOT fail completeness!
          acceptance: ['A0'],
        },
        {
          id: 'T1',
          // Repeats `orphanWidget` in its own title AND commit — still nobody else wires `src/orphanWidget.ts`!
          title: 'Create orphanWidget helper module',
          commit: 'feat: add orphanWidget',
          wave: 1,
          files: [{ path: 'src/orphanWidget.ts' }],
          acceptance: ['A1'],
          verify: { commands: ['npx vitest run tests/acceptance/a1.test.ts'] },
        },
      ],
      acceptance_tests: [
        {
          criterion: 'A1',
          // `files` intentionally omitted; command uses `--reporter=verbose` and `$` anchor while task.verify omits them
          files: [],
          command: 'npx vitest run --reporter=verbose tests/acceptance/a1.test.ts$',
        },
      ],
    };

    const rev = reviewLib.review(dir, doc, {
      phaseCriteria: ['A1'],
      pack: { tasks: [{ id: 'T1', symbols: [{ name: 'orphanWidget', path: 'src/orphanWidget.ts' }] }] },
    });

    assert.equal(rev.dimensions.completeness.verdict, 'PASS', JSON.stringify(rev.dimensions.completeness.findings));
    assert.equal(rev.dimensions.verification.verdict, 'PASS', JSON.stringify(rev.dimensions.verification.findings));
    assert.equal(rev.dimensions.links.verdict, 'WARN', 'self-mentions in T1 title/commit/pack must not hide an unwired module');
    assert.match(rev.dimensions.links.findings[0].text, /T1: cria src\/orphanWidget\.ts/);
  });
});

describe('Round 8 — oxe-spec-freeze, oxe-dom-hooks & oxe-pack-removed precision', () => {
  it('spec-freeze: criterionOf ignores comments, handles mixed quotes / modifiers / subcriteria, and resolveRef unquotes UTF-8 git paths', () => {
    const src = [
      "// Replaces describe('A99 legacy', () => {})",
      '/* it("A88 old", () => {}) */',
      'test.describe("fluxo d\'água A19.1", () => {',
      "  test('sincroniza', () => {});",
      '});',
    ].join('\n');
    assert.equal(specFreeze.criterionOf(src), 'A19.1');
    assert.equal(specFreeze.criterionOf("describe.serial('AC-04 login', () => {})"), 'AC-04');

    const dir = mkDir('oxe-r8-sf-');
    const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.ts'], acceptance: ['A19.1'] }] }));
    write(dir, 'tests/acceptance/sessão.test.ts', src);
    git('add', '-A');
    git('commit', '-qm', 'utf8 frozen test');
    const head = git('rev-parse', 'HEAD').stdout.trim();
    const out = specFreeze.freeze(dir, path.join(dir, '.oxe/PLAN.json'), JSON.parse(fs.readFileSync(path.join(dir, '.oxe/PLAN.json'), 'utf8')), { from: head });
    assert.deepEqual(out.frozen.map((f) => [f.file, f.criterion, f.proves]), [['tests/acceptance/sessão.test.ts', 'A19.1', 1]]);

    // Merge commit (`git merge --no-ff`) also resolves changed test files against first parent
    const baseBranch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    git('checkout', '-qb', 'feat-a20');
    write(dir, 'tests/acceptance/ação.test.ts', "describe('A20 ação', () => {\n  it('executa', () => {});\n});\n");
    git('add', '-A');
    git('commit', '-qm', 'add a20 test');
    git('checkout', '-q', baseBranch);
    git('merge', '--no-ff', '-qm', 'merge feat-a20', 'feat-a20');
    const mergeSha = git('rev-parse', 'HEAD').stdout.trim();
    const outMerge = specFreeze.freeze(dir, path.join(dir, '.oxe/PLAN.json'), JSON.parse(fs.readFileSync(path.join(dir, '.oxe/PLAN.json'), 'utf8')), { from: mergeSha });
    assert.deepEqual(outMerge.frozen.map((f) => [f.file, f.criterion, f.proves]), [['tests/acceptance/ação.test.ts', 'A20', 1]]);
  });

  it('dom-hooks: ignores commented-out markup, catches commenting-out a live hook, and handles accented UTF-8 paths', () => {
    const dir = mkDir('oxe-r8-dom-');
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('config', 'core.autocrlf', 'false');
    write(
      dir,
      'src/páginas/Menu.tsx',
      [
        'export function Menu() {',
        '  return (<div>',
        '    {/* <span data-testid="commented-hook">old</span> */}',
        '    <a href="https://example.com//path" data-testid="live-hook">ok</a>',
        '  </div>);',
        '}',
        '',
      ].join('\n'),
    );
    write(
      dir,
      'e2e/sessão.spec.ts',
      [
        "// await page.getByTestId('commented-hook').click();",
        "test('menu', async ({ page }) => { await page.getByTestId('live-hook').isVisible(); });",
        '',
      ].join('\n'),
    );
    git('add', '-A');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');

    // Shift-left pre-prompt check only reports `live-hook`, ignoring `commented-hook`
    const active = domHooks.hooksReadInFiles(dir, ['src/páginas/Menu.tsx']);
    assert.deepEqual(active.map((h) => h.hook), ['data-testid=live-hook']);

    // Commit 1: delete the commented-out JSX line -> must NOT report a removed hook
    write(
      dir,
      'src/páginas/Menu.tsx',
      'export function Menu() {\n  return (<div><a href="https://example.com//path" data-testid="live-hook">ok</a></div>);\n}\n',
    );
    git('commit', '-qam', 'clean dead comment');
    const c1 = git('rev-parse', 'HEAD');
    assert.deepEqual(domHooks.hooksStillRead(dir, base, c1), []);

    // Commit 2: comment out `live-hook` in JSX instead of deleting -> MUST catch that `live-hook` is no longer rendered!
    write(
      dir,
      'src/páginas/Menu.tsx',
      'export function Menu() {\n  return (<div>{/* <a href="https://example.com//path" data-testid="live-hook">ok</a> */}</div>);\n}\n',
    );
    git('commit', '-qam', 'comment out live hook');
    const c2 = git('rev-parse', 'HEAD');
    const broken = domHooks.hooksStillRead(dir, c1, c2);
    assert.deepEqual(broken.map((f) => [f.hook, f.removed_in]), [['data-testid=live-hook', 'src/páginas/Menu.tsx']]);
  });

  it('pack-removed: ignores commented/string exports and detects destructured, glob-adjacent, bracketed and shorthand exports', () => {
    const dir = mkDir('oxe-r8-rm-');
    // Still exported via destructuring, CJS shorthand, bracketed exports, and after `'foo/*'` + `'*/bar'` strings
    write(
      dir,
      'src/ipc.ts',
      [
        "const GLOB_START = 'foo/*';",
        'export const { raw: { registerMemoryIpc = null }, keepMe } = handlers;',
        "const GLOB_END = '*/bar';",
        'module.exports = { legacyHelper() {}, async otherHelper() {} };',
        "exports['bracketedExport'] = 1;",
      ].join('\n'),
    );
    const names = packRemoved.moduleExports(path.join(dir, 'src/ipc.ts'));
    assert.ok(names.includes('registerMemoryIpc'), names.join(','));
    assert.ok(names.includes('legacyHelper'), names.join(','));
    assert.ok(names.includes('bracketedExport'), names.join(','));

    // Once replaced by comments and string literals only, checkRemoval passes!
    write(
      dir,
      'src/ipc.ts',
      [
        '// export function registerMemoryIpc() {}',
        '/* export const legacyHelper = 1; */',
        "export const NOTE = 'export function bracketedExport() {}';",
      ].join('\n'),
    );
    const check = packRemoved.checkRemoval(dir, {
      removed_paths: [],
      symbols_removed: [
        { name: 'registerMemoryIpc', path: 'src/ipc.ts' },
        { name: 'legacyHelper', path: 'src/ipc.ts' },
        { name: 'bracketedExport', path: 'src/ipc.ts' },
      ],
    });
    assert.deepEqual(check, { ok: true, problems: [] });
  });
});
