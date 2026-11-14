'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const freeze = require('../bin/lib/oxe-spec-freeze.cjs');
const pj = require('../bin/lib/oxe-plan-json.cjs');

// 1.21.2 — OxeSpace 14/11 (OxeCode F3, CR-07): spec freeze kept the JS escapes of the test titles ("checkout\'s")
// and the plan lint, which unescapes them, refused 9 proves. The freeze now reads titles with the lint's reader.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

const SOURCE = [
  "import { it, describe } from 'vitest'",
  "describe('A10 policy change gate', () => {",
  "  it('a worktree with no accepted version starts from its primary checkout\\'s', () => {})",
  '  it("M-2: an app write reads as \\"widening\\" only when it widens", () => {})',
  '  it(`a template title without placeholders`, () => {})',
  "  it.each([1, 2])('case %i of the matrix', () => {})",
  '})',
  '',
].join('\n');

describe('spec freeze reads test titles like the plan lint (escapes undone)', () => {
  it('the proves of a frozen test are exactly the declared titles the lint reads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-freeze-titles-'));
    dirs.push(dir);
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@oxe.dev');
    git(dir, 'config', 'user.name', 'T');
    fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    fs.mkdirSync(path.join(dir, 'tests', 'integration'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'integration', 'policy-change-gate.test.ts'), SOURCE);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'tests');
    const sha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const jsonPath = path.join(dir, 'PLAN.json');
    const doc = { schema_version: 1, tasks: [{ id: 'T13', title: 'grupo preview', acceptance: ['A10'] }], acceptance_tests: [] };
    const out = freeze.freeze(dir, jsonPath, doc, { from: sha, criteria: 'A10', cr: 'CR-07', task: 'T13', command: 'npx vitest run tests/integration/policy-change-gate.test.ts' });
    assert.equal(out.refused.length, 0, JSON.stringify(out.refused));
    const entry = doc.acceptance_tests[0];
    assert.ok(entry.proves.includes("a worktree with no accepted version starts from its primary checkout's"), entry.proves.join(' | '));
    assert.ok(entry.proves.includes('M-2: an app write reads as "widening" only when it widens'), 'not truncated at the escaped quote');
    assert.ok(entry.proves.includes('a template title without placeholders'));
    const declared = pj.declaredTestTitles(SOURCE, 'policy-change-gate.test.ts');
    for (const p of entry.proves) assert.ok(declared.includes(p), `lint knows "${p}"`);
    assert.equal(entry.task, 'T13');
    assert.deepEqual(entry.resolves, ['CR-07']);
    // freezing again for the same CR is idempotent: same entry, same version
    const v = entry.version || 1;
    freeze.freeze(dir, jsonPath, doc, { from: sha, criteria: 'A10', cr: 'CR-07', task: 'T13' });
    assert.equal(doc.acceptance_tests.length, 1);
    assert.equal(doc.acceptance_tests[0].version || 1, v, 'no version bump on a re-freeze for the same CR');
    assert.equal(doc.acceptance_tests[0].command, 'npx vitest run tests/integration/policy-change-gate.test.ts', 'no --command: the existing one stays');
    // an explicit --command wins on a re-freeze (OxeSpace 14/11: A5 kept a command naming a deleted .ts)
    freeze.freeze(dir, jsonPath, doc, { from: sha, criteria: 'A10', cr: 'CR-07', command: 'npx vitest run tests/integration/policy-change-gate.test.ts --reporter=verbose' });
    assert.equal(doc.acceptance_tests[0].command, 'npx vitest run tests/integration/policy-change-gate.test.ts --reporter=verbose');
  });
});

describe('freeze keeps only the titles the entry command selects (OxeSpace 14/11, OxeCode F4 T20)', () => {
  const SHARED = [
    "describe('OXE-128 next', () => {",
    "  it('opens the next attention', () => {});",
    "  it(\"skips a resolved one (A17)\", () => {});",
    "});",
    "describe('OXE-128 ring', () => {",
    "  // it('commented out', () => {})",
    "  it('rings once', () => {});",
    "  describe('nested', () => { test('rings twice', () => {}); });",
    "});",
  ].join('\n');

  it('full names carry the enclosing describes', () => {
    const names = freeze.fullTestNames(SHARED).map((t) => t.full);
    assert.ok(names.includes('OXE-128 next opens the next attention'));
    assert.ok(names.includes('OXE-128 ring nested rings twice'));
  });

  it('the -t / --testNamePattern of the command filters the declared titles', () => {
    assert.equal(freeze.namePatternOf('npx vitest run x.test.tsx -t "OXE-128 next"'), 'OXE-128 next');
    assert.equal(freeze.namePatternOf("jest --testNamePattern='ring'"), 'ring');
    assert.equal(freeze.namePatternOf('npx vitest run x.test.tsx'), null);
    const titles = freeze.titlesOf(SHARED, 'x.test.tsx');
    assert.deepEqual(freeze.filterTitles(SHARED, titles, 'OXE-128 next'), ['opens the next attention', 'skips a resolved one (A17)']);
    assert.deepEqual(freeze.filterTitles(SHARED, titles, 'OXE-128 ring').sort(), ['rings once', 'rings twice']);
    assert.deepEqual(freeze.filterTitles(SHARED, titles, null), titles, 'no pattern: every title');
    assert.deepEqual(freeze.filterTitles(SHARED, titles, 'nada disso'), []);
  });
});
