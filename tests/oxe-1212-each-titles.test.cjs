'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const pj = require('../bin/lib/oxe-plan-json.cjs');

// 1.21.2 — OXB-190: test.each / it.each / describe.each titles are declared tests for `proves`.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

const TEST = [
  "import { test, it, describe } from 'vitest';",
  "test.each([['en'], ['pt-BR']])('x (%s)', (locale) => {});",
  "test.each(['local', 'remote'])(\"the Which one? menu names each place with U4.1's labels (%s)\", () => {});",
  'it.each`\n  a | b\n  ${1} | ${2}\n`(\'adds $a + $b\', () => {});',
  "describe.each([[1, 2]])('suite %d-%d', () => {});",
  "test('in pt-BR a missing path reads as missing', () => {});",
  '',
].join('\n');

function lintWith(proves) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-each-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | t |\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, 'tests/acceptance/f4/crf4-4-place-copy.test.tsx', TEST);
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.tsx'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }], acceptance_tests: [{ criterion: 'A1', files: ['tests/acceptance/f4/crf4-4-place-copy.test.tsx'], command: 'npx vitest run tests/acceptance/f4/crf4-4-place-copy.test.tsx', proves }] }));
  return op.runtimePlanLint(dir, null, {}).errors.filter((e) => /proves/.test(e));
}

describe('OXB-190: each titles', () => {
  it('the parser yields the template, its literal part and the expanded names of a literal table', () => {
    const t = pj.declaredTestTitles(TEST, 'a.test.tsx');
    for (const n of ['x (%s)', 'x', 'x (en)', 'x (pt-BR)', "the Which one? menu names each place with U4.1's labels", "the Which one? menu names each place with U4.1's labels (remote)", 'adds $a + $b', 'suite 1-2', 'in pt-BR a missing path reads as missing']) assert.ok(t.includes(n), `${n} ∉ ${JSON.stringify(t)}`);
  });

  it('done when: test.each([[\'en\'],[\'pt-BR\']])(\'x (%s)\') accepts the proves "x" and "x (en)"; an unknown one still fails', () => {
    assert.deepEqual(lintWith(['x', 'x (en)', "the Which one? menu names each place with U4.1's labels"]), []);
    assert.match(lintWith(['x (fr-CA)', 'nao existe']).join('\n'), /proves "nao existe" não é o nome de nenhum teste declarado/);
  });
});
