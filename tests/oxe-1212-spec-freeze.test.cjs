'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const sf = require('../bin/lib/oxe-spec-freeze.cjs');

// 1.21.2 — OXB-099: spec freeze imports the frozen tests of a PR / commit, with proves and origin.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const TEST = "import { it, describe } from 'vitest';\ndescribe('A12 fila', () => {\n  it('enfileira em ordem', () => {});\n  it(\"drena vazio\", () => {});\n});\n";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sf-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/q.ts'], acceptance: ['A12'], verify: { commands: ['node -e 0'] } }] }));
  write(dir, 'src/q.ts', 'x\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  write(dir, 'tests/acceptance/queue.test.ts', TEST);
  write(dir, 'docs/x.md', 'doc\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'testes congelados');
  return { dir, sha: git(dir, 'rev-parse', 'HEAD').stdout.trim() };
}

describe('OXB-099: spec freeze', () => {
  it('a commit: the test files become acceptance tests with proves, hash and origin; non-test files ignored', () => {
    const { dir, sha } = project();
    const r = spawnSync(process.execPath, [CLI, 'spec', 'freeze', '--from', sha, '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.equal(doc.acceptance_tests.length, 1);
    const a = doc.acceptance_tests[0];
    assert.deepEqual([a.criterion, a.files, a.proves], ['A12', ['tests/acceptance/queue.test.ts'], ['enfileira em ordem', 'drena vazio']]);
    assert.equal(a.origin.kind, 'sha');
    assert.equal(a.origin.sha, sha);
    assert.deepEqual(require('../bin/lib/oxe-plan-json.cjs').validatePlanJson(doc), []);
  });

  it('changing an already frozen file is refused without a CR; with --cr it is recorded as resolves', () => {
    const { dir, sha } = project();
    op.runtimeSpecFreeze(dir, null, { from: sha });
    write(dir, 'tests/acceptance/queue.test.ts', TEST.replace('drena vazio', 'drena vazio sem erro'));
    git(dir, 'commit', '-qam', 'muda teste');
    const sha2 = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const refused = op.runtimeSpecFreeze(dir, null, { from: sha2 });
    assert.match(refused.refused[0].why, /já está congelado com outro conteúdo — mudar um teste congelado exige um CR/);
    const ok = op.runtimeSpecFreeze(dir, null, { from: sha2, cr: 'CR-7' });
    assert.equal(ok.frozen.length, 1);
    const a = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8')).acceptance_tests[0];
    assert.deepEqual(a.resolves, ['CR-7']);
    assert.ok(a.proves.includes('drena vazio sem erro'));
  });

  it('a PR via gh: the files listed by the PR, origin kind pr', () => {
    const { dir, sha } = project();
    const spawn = (cmd, args, opts) => (cmd === 'gh' ? { status: 0, stdout: JSON.stringify({ headRefOid: sha, url: 'https://github.com/o/r/pull/686', files: [{ path: 'tests/acceptance/queue.test.ts' }, { path: 'src/q.ts' }] }) } : spawnSync(cmd, args, opts));
    const out = op.runtimeSpecFreeze(dir, null, { from: '#686', spawn });
    assert.deepEqual(out.frozen.map((f) => f.origin), ['#686']);
    assert.equal(sf.titlesOf(TEST).length, 2);
  });
});
