'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const impact = require('../bin/lib/oxe-suite-impact.cjs');
const rigor = require('../bin/lib/oxe-test-rigor.cjs');
const stub = require('../bin/lib/oxe-stub-check.cjs');
const origin = require('../bin/lib/oxe-origin.cjs');

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

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

describe('Round 7 — oxe-suite-impact precision (barrel re-exports & bare directory scopes)', () => {
  it('follows barrel re-exports by symbol into the leaf module without pulling sibling leaves', () => {
    const dir = mkDir('oxe-r7-impact-');
    write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
    write(dir, 'src/services/index.ts', "export { pairDevice as connectDevice } from './pairing';\nexport { readTheme } from './theme';\n");
    write(dir, 'src/services/pairing.ts', 'export function pairDevice() { return true; }\n');
    write(dir, 'src/services/theme.ts', "export function readTheme() { return 'dark'; }\n");
    write(dir, 'tests/pairing-existing.test.ts', "import { connectDevice } from '@/services';\nconnectDevice();\n");
    write(dir, 'tests/theme-existing.test.ts', "import { readTheme } from '@/services';\nreadTheme();\n");

    const plan = {
      schema_version: 1,
      tasks: [
        // Directory scope WITHOUT trailing slash (`src/services` -> covers `src/services/pairing.ts`? Wait: let's test exact leaf AND bare directory)
        { id: 'T1', wave: 1, files: ['src/services/pairing.ts'], verify: { commands: ['npx vitest run tests/t1.test.ts'] } },
        { id: 'T2', wave: 2, files: ['src/other'], verify: { commands: ['npx vitest run tests/other.test.ts'] } },
      ],
    };
    write(dir, 'src/other/leaf.ts', 'export const x = 1;\n');
    write(dir, 'tests/other-suite.test.ts', "import { x } from '../src/other/leaf';\nconsole.log(x);\n");

    const findings = impact.suiteImpact(dir, plan);
    const t1Suites = findings.filter((f) => f.task === 'T1').flatMap((f) => f.suites.map((s) => s.test));
    assert.deepEqual(t1Suites, ['tests/pairing-existing.test.ts']);
    assert.ok(!t1Suites.includes('tests/theme-existing.test.ts'), 'sibling barrel export not touched by T1');

    // T2 uses bare directory `'src/other'` without trailing `/`; `tests/other-suite.test.ts` imports `src/other/leaf.ts`
    const t2Suites = findings.filter((f) => f.task === 'T2').flatMap((f) => f.suites.map((s) => s.test));
    assert.deepEqual(t2Suites, ['tests/other-suite.test.ts']);
  });
});

describe('Round 7 — oxe-test-rigor precision (criterion ownership, regex/URL masking, TS-safe mutants)', () => {
  it('isEntryDone & mutationSample: skips criterion-bound entries of pending tasks and runs only done criteria', () => {
    const dir = mkDir('oxe-r7-rigor-done-');
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, 'src/doneMod.js', 'exports.check = (n) => {\n  if (n > 2) return true;\n  return false;\n};\n');
    write(dir, 'src/pendingMod.js', 'exports.todo = () => false;\n');
    write(
      dir,
      'tests/acceptance/done.test.js',
      "const { check } = require('../../src/doneMod.js');\nif (check(5) !== true || check(1) !== false) process.exit(1);\n",
    );
    write(
      dir,
      'tests/acceptance/pending-text.test.js',
      "const fs = require('fs');\nconst s = fs.readFileSync('src/pendingMod.js', 'utf8');\nif (!s.includes('REAL_IMPL')) process.exit(1);\n",
    );
    write(
      dir,
      'tests/acceptance/done-text.test.js',
      "const fs = require('fs');\nconst s = fs.readFileSync('src/doneMod.js', 'utf8');\nif (!s.includes('exports')) process.exit(1);\n",
    );
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');

    const doc = {
      tasks: [
        { id: 'T1', wave: 1, files: ['src/doneMod.js'], acceptance: ['AC-DONE'], done: true },
        { id: 'T2', wave: 2, files: ['src/pendingMod.js'], acceptance: ['AC-PEND'] },
      ],
      acceptance_tests: [
        // Criterion-bound entries WITHOUT `task` property:
        { criterion: 'AC-DONE', files: ['tests/acceptance/done.test.js'], command: 'node tests/acceptance/done.test.js' },
        { criterion: 'AC-DONE', files: ['tests/acceptance/done-text.test.js'], command: 'node tests/acceptance/done-text.test.js' },
        { criterion: 'AC-PEND', files: ['tests/acceptance/pending-text.test.js'], command: 'node tests/acceptance/pending-text.test.js' },
      ],
    };

    // sourceAssertionFindings skips AC-DONE (T1 is done) and flags only AC-PEND (T2 is pending)
    const srcFindings = rigor.sourceAssertionFindings(dir, doc);
    assert.deepEqual(srcFindings.map((f) => f.file), ['tests/acceptance/pending-text.test.js']);

    // mutationSample runs ONLY AC-DONE entries, never touching pending AC-PEND
    const mutReport = rigor.mutationSample(dir, doc, { max: 2 });
    assert.ok(!mutReport.some((r) => r.file.includes('pending-text')), 'pending criterion entry must not run in mutationSample');
    const doneRow = mutReport.find((r) => r.file === 'tests/acceptance/done.test.js');
    assert.ok(doneRow && doneRow.mutants >= 2 && doneRow.survived.length === 0);
  });

  it('maskJsSource & suspiciousRegexFindings: regex /[/*]/ never opens block comment; URLs with http:// do not truncate lines', () => {
    const dir = mkDir('oxe-r7-rigor-mask-');
    write(
      dir,
      'tests/acceptance/url-and-regex.test.ts',
      [
        "const ok = /[/*]/.test(input);",
        "const endpoint = 'http://localhost:3000/api'; expect(endpoint).toMatch(/d+/); // trailing comment /w+/",
        "const stripped = 'https://example.com/v2'.replace(/\\d+/g, ''); expect(stripped).toMatch(/2/);",
        '',
      ].join('\n'),
    );

    const findings = rigor.suspiciousRegexFindings(dir, ['tests/acceptance/url-and-regex.test.ts']);
    assert.equal(findings.length, 2, JSON.stringify(findings));
    assert.equal(findings[0].kind, 'unescaped_char_class');
    assert.equal(findings[0].line, 2);
    assert.equal(findings[0].pattern, '/d+/');
    assert.equal(findings[1].kind, 'contradictory_strip_assert');
    assert.equal(findings[1].line, 3);
  });

  it('mutantsOf: skips TS generics, type/interface lines, strings and comments while mutating real code accurately', () => {
    const tsCode = [
      'export interface GateConfig { enabled: true; }',
      'export type Flag = false;',
      'export function evaluate(cache: Map<string, Array<number>>, n: number): boolean {',
      '  const label = "=== true; a;b"; // true === false',
      '  if (n < 10) return "semi;inside";',
      '  return label === "ok";',
      '}',
      '',
    ].join('\n');

    const mutants = rigor.mutantsOf(tsCode, 10);
    // Line 1 (interface), Line 2 (type), Line 3 (Map<string, Array<number>>), Line 4 (only strings & comment) -> ALL skipped!
    assert.deepEqual(mutants.map((m) => m.line), [5, 6], JSON.stringify(mutants));
    assert.equal(mutants[0].after, '  if (n >= 10) return "semi;inside";');
    assert.equal(mutants[1].after, '  return label !== "ok";');
  });
});

describe('Round 7 — oxe-stub-check precision (definesSymbol & UTF-8 git paths)', () => {
  it('definesSymbol ignores comments, supports $-prefixed symbols & exported destructuring, and respects export aliases', () => {
    assert.equal(stub.definesSymbol('// export function saveDraft() {}\n/* const saveDraft = () => {} */\n', 'saveDraft'), false);
    assert.equal(stub.definesSymbol('# def save_draft(): pass\n', 'save_draft'), false);

    assert.equal(stub.definesSymbol('export const $store = createStore();\n', '$store'), true);
    assert.equal(stub.definesSymbol('const $store = 1;\nmodule.exports = { $store };\n', '$store'), true);
    assert.equal(stub.definesSymbol('export { $store } from "./state";\n', '$store'), true);
    assert.equal(stub.definesSymbol('export const $store = 1;\n', 'store'), false, 'must not match store inside $store');

    assert.equal(stub.definesSymbol('export const { saveDraft, raw: publishDraft } = createApi();\n', 'saveDraft'), true);
    assert.equal(stub.definesSymbol('export const { saveDraft, raw: publishDraft } = createApi();\n', 'publishDraft'), true);
    assert.equal(stub.definesSymbol('export const { saveDraft, raw: publishDraft } = createApi();\n', 'raw'), false);
    assert.equal(stub.definesSymbol('const { saveDraft } = require("./other");\n', 'saveDraft'), false);

    assert.equal(stub.definesSymbol("export { internalImpl as publicApi } from './leaf';\n", 'publicApi'), true);
    assert.equal(stub.definesSymbol("export { internalImpl as publicApi } from './leaf';\n", 'internalImpl'), false);
    assert.equal(stub.definesSymbol('typealias UserId = String\nfun String.toSlug(): String = this\n', 'UserId'), true);
    assert.equal(stub.definesSymbol('fun String.toSlug(): String = this\n', 'toSlug'), true);
  });

  it('stubFindings detects substantive stubs inside files with accented UTF-8 paths', () => {
    const dir = mkDir('oxe-r7-stub-utf8-');
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false }));
    write(dir, 'src/páginas/início.ts', 'export const ok = 1;\n');
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');
    // Explicitly ensure default core.quotepath=true in this test repo
    git(dir, 'config', 'core.quotepath', 'true');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');

    write(dir, 'src/páginas/início.ts', "export const ok = 1;\nexport const salvar = () => { throw new Error('not implemented'); };\n");
    write(dir, 'src/páginas/sessão.ts', 'export function abrir() {}\n');

    const findings = stub.stubFindings(dir, { levels: ['substantive'] });
    assert.deepEqual(
      findings.map((f) => `${f.file}:${f.line}`).sort(),
      ['src/páginas/início.ts:2', 'src/páginas/sessão.ts:1'],
    );
  });
});

describe('Round 7 — oxe-origin precision (C-quoted UTF-8 git paths & bare exempt directory prefixes)', () => {
  it('unquotes git octal paths and matches bare exempt directories in both commitMsg and check', () => {
    assert.equal(origin.unquoteGitPath('".oxe/sess\\303\\265es/notas.md"'), '.oxe/sessões/notas.md');
    assert.equal(origin.underPaths('docs/releases/1.5.2.md', ['docs/releases']), true);
    assert.equal(origin.underPaths('docs/releases-old/1.5.2.md', ['docs/releases']), false);
    assert.equal(origin.underPaths('.oxe', ['.oxe/']), false);

    const dir = mkDir('oxe-r7-origin-utf8-');
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.name', 'Dev');
    git(dir, 'config', 'user.email', 'dev@example.com');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'core.quotepath', 'true');

    // Bare directory `'docs/releases'` (without trailing `/`) + default `'.oxe/'`
    const cfg = { origin: { exempt: { paths: ['.oxe/', 'docs/releases'] } } };
    write(dir, 'oxe.config.json', JSON.stringify(cfg));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'branch', 'base');

    // Stage an accented file inside `.oxe/` and a file inside `docs/releases` (bare directory config)
    write(dir, '.oxe/sessões/revisão.md', '# notas\n');
    write(dir, 'docs/releases/lançamento-1.21.2.md', '# release\n');
    git(dir, 'add', '.oxe/sessões/revisão.md', 'docs/releases/lançamento-1.21.2.md');

    const msgFile = path.join(dir, '.git', 'COMMIT_EDITMSG');
    fs.writeFileSync(msgFile, 'docs: notas de revisão\n', 'utf8');
    const hookRes = origin.commitMsg(dir, msgFile, {});
    assert.equal(hookRes.ok, true, JSON.stringify(hookRes));

    git(dir, 'commit', '-qm', 'docs: notas de revisão');
    const rangeRes = origin.check(dir, { target: 'base..HEAD' });
    assert.equal(rangeRes.ok, true, JSON.stringify(rangeRes.violations));
    assert.equal(rangeRes.by_kind.exempt, 1);
  });
});
