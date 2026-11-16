'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const guard = require('../bin/lib/oxe-guard.cjs');
const origin = require('../bin/lib/oxe-origin.cjs');
const quick = require('../bin/lib/oxe-quick.cjs');
const docsCheck = require('../bin/lib/oxe-docs-check.cjs');
const artifactRefs = require('../bin/lib/oxe-artifact-refs.cjs');
const realReg = require('../bin/lib/oxe-real-regression.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');
const stubCheck = require('../bin/lib/oxe-stub-check.cjs');
const suiteImpact = require('../bin/lib/oxe-suite-impact.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

describe('Round 18 hardening: guard, origin, quick, docs-check, artifact-refs, real-regression, program, stub-check, suite-impact', () => {
  it('oxe-guard: ./ globs, array policy rules, fd redirects vs JS arrows, and git flags/-C in protected_checkouts', () => {
    const root = mkTmp('oxe-r18-guard-');
    const cfg = {
      policy_rules: [
        { id: 'sec-read', kind: 'path', deny_read: ['./secrets/**', '   '], message: 'segredo local' },
        { id: 'sec-write', kind: 'path', deny_write: ['./locked/**'], message: 'pasta travada' },
        { id: 'cmd-arr', kind: 'command', deny: ['\\brm\\s+-rf\\s+/', '\\bformat\\s+c:'], message: 'destrutivo' },
      ],
      guards: { protected_checkouts: ['.'] },
    };

    // ./secrets/** blocks reading secrets/key.pem
    const r1 = guard.decide({ tool_name: 'Read', tool_input: { file_path: path.join(root, 'secrets', 'key.pem') }, cwd: root }, { root, config: cfg });
    assert.equal(r1.block, true);
    assert.equal(r1.rule, 'sec-read');

    // ./locked/** blocks writing locked/a.json
    const w1 = guard.decide({ tool_name: 'Write', tool_input: { file_path: path.join(root, 'locked', 'a.json') }, cwd: root }, { root, config: cfg });
    assert.equal(w1.block, true);
    assert.equal(w1.rule, 'sec-write');

    // array command deny matches second pattern
    const c1 = guard.decide({ tool_name: 'Bash', tool_input: { command: 'format c:' }, cwd: root }, { root, config: cfg });
    assert.equal(c1.block, true);
    assert.equal(c1.rule, 'cmd-arr');

    // JS arrow `=> /outside/path` is NOT misparsed as a shell redirect, while `2> /outside/err.log` IS caught
    const arrowCmd = 'node -e "const fn = () => /outside/regex.test(\'x\')"';
    assert.deepEqual(guard.writeTargetsOfShell(arrowCmd), []);
    const outsideErr = path.join(os.tmpdir(), 'oxe-r18-outside-err.log');
    const fdRedir = guard.decide({ tool_name: 'Bash', tool_input: { command: `node -e 1 2> "${outsideErr}"` }, cwd: root }, { root, config: cfg });
    assert.equal(fdRedir.block, true);
    assert.equal(fdRedir.rule, 'write_outside_root');

    // Chained `git status && git --no-pager checkout main` names `git checkout` (not `git status`), and `-C <other>` is respected
    const prot1 = guard.decide({ tool_name: 'Bash', tool_input: { command: 'git status && git --no-pager checkout main' }, cwd: root }, { root, config: cfg });
    assert.equal(prot1.block, true);
    assert.match(prot1.reason, /git checkout não é permitido/);

    const otherWt = mkTmp('oxe-r18-other-wt-');
    const allowOtherWt = guard.decide({ tool_name: 'Bash', tool_input: { command: `git -C "${otherWt}" checkout -b feat` }, cwd: root }, { root, config: cfg });
    assert.equal(allowOtherWt.block, false);
    const blockProtViaDashC = guard.decide({ tool_name: 'Bash', tool_input: { command: `git -C "${root}" reset --hard` }, cwd: otherWt }, { root, config: cfg });
    assert.equal(blockProtViaDashC.block, true);
    assert.match(blockProtViaDashC.reason, /git reset não é permitido/);
  });

  it('oxe-origin & oxe-quick: subphases, named phases, spike/CR tasks, multi-task trailers, CRLF commitMsg, and quick id traversal guard', () => {
    const ocfg = origin.originConfig({});
    const mk = (message) => ({ sha: '1234567890', parents: 1, author: { name: 'Dev', email: 'd@e' }, message, files: ['src/a.ts'] });

    assert.equal(origin.classify(mk('feat: sub\n\nOXE-Task: F2.1/T4'), ocfg).task, 'F2.1/T4');
    assert.equal(origin.classify(mk('feat: oq\n\nOXE-Task: OQ/T12'), ocfg).task, 'OQ/T12');
    assert.equal(origin.classify(mk('chore: spike\n\nOXE-Task: F4/T-SPIKE-1'), ocfg).task, 'F4/T-SPIKE-1');
    assert.equal(origin.classify(mk('wip\n\nOXE-Task: TBD'), ocfg).ok, false);

    const together = origin.classify(mk('feat: together\r\n\r\nOXE-Task: F6/T11\r\nOXE-Task: F6/T12\r\nOXE-Run: run-9\r\n'), ocfg);
    assert.equal(together.ok, true);
    assert.equal(together.task, 'F6/T11');
    assert.deepEqual(together.tasks, ['F6/T11', 'F6/T12']);
    assert.equal(together.run, 'run-9');

    assert.equal(
      origin.appendTrailers('fix: crlf\r\n\r\nCo-Authored-By: A <a@b>\r\n', ['OXE-Quick: Q-20261115-abcd']),
      'fix: crlf\n\nCo-Authored-By: A <a@b>\nOXE-Quick: Q-20261115-abcd\n'
    );

    const repo = mkTmp('oxe-r18-quick-');
    assert.equal(quick.read(repo, '../../package'), null);
    assert.equal(quick.exists(repo, '../outside'), false);
    assert.deepEqual(quick.commitsOf(repo, '../outside'), []);
  });

  it('oxe-artifact-refs & oxe-real-regression: blocks traversal/directory refs and ..prefix inside-repo snapshot bug', () => {
    const root = mkTmp('oxe-r18-refs-');
    fs.mkdirSync(path.join(root, '.oxe'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'specdir'), { recursive: true });
    fs.writeFileSync(path.join(root, '.oxe', 'config.json'), JSON.stringify({
      spec_ref: '../outside-spec.md',
      roadmap_ref: 'docs/specdir',
    }));
    const refs = artifactRefs.artifactRefs(root);
    assert.equal(refs.spec.exists, false);
    assert.equal(refs.spec.outside_root, true);
    assert.equal(refs.roadmap.exists, false);
    assert.equal(refs.roadmap.is_directory, true);
    const warnings = artifactRefs.refWarnings(root).join('\n');
    assert.match(warnings, /spec_ref aponta para \.\.\/outside-spec\.md, fora da raiz/);
    assert.match(warnings, /roadmap_ref aponta para docs\/specdir, que é uma pasta/);

    // `..snapshots` inside projectRoot starts with `..` as string but IS inside repo -> must throw!
    fs.writeFileSync(path.join(root, '.oxe', 'STATE.md'), '# S\n');
    assert.throws(() => realReg.snapshot(root, path.join(root, '..snapshots'), 'f1'), /FORA do repositório/);
    const ext = mkTmp('oxe-r18-ext-');
    assert.throws(() => realReg.snapshot(root, ext, '../escape'), /nome de snapshot inválido/);
  });

  it('oxe-docs-check & oxe-program: case-insensitive phase matching, directory non-file guard, and safe phaseId containment', () => {
    const root = mkTmp('oxe-r18-prog-');
    const pdir = path.join(root, '.oxe', 'program');
    const ddir = path.join(root, '.oxe', 'dossier');
    fs.mkdirSync(path.join(root, 'src', 'dir-not-file.ts'), { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: root });

    assert.throws(() => programLib.writeRegression(pdir, '../escape', []), /phaseId inválido/);
    assert.throws(() => programLib.writeInterfaces(pdir, 'F1/../../x', []), /phaseId inválido/);
    assert.deepEqual(programLib.contractedFiles({ tasks: [null, { filesExist: ['src\\a.ts', ''], exportsExpected: [{ file: 'src\\b.ts' }, null] }] }), ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(programLib.buildInterfaces(root, { readModuleExports: () => ['x'] }, ['../outside.js', 'src/dir-not-file.ts']), []);

    const dc = docsCheck.check(root, {
      programDir: pdir,
      dossierRoot: ddir,
      program: { phases: [{ id: 'F1', status: 'closed' }, { id: '../bad', status: 'closed' }] },
      decisions: [{ id: 'D-1', phase: 'f1', status: 'active', title: 'usa src/dir-not-file.ts', text: '' }],
    });
    assert.equal(dc.artifacts, 1);
    assert.equal(dc.divergences.length, 1);
    assert.equal(dc.divergences[0].why, 'não existe mais');
  });

  it('oxe-stub-check & oxe-suite-impact: wired ignores package.json null/substring stems and suite-impact skips superseded/merged tasks', () => {
    const root = mkTmp('oxe-r18-stub-');
    fs.mkdirSync(path.join(root, '.oxe'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, '.oxe', 'config.json'), JSON.stringify({ stub_check: { wired: true } }));
    // package.json main="dist/application.js" and module=undefined (previously JSON.stringify produced "null" and "application")
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', main: 'dist/application.js' }));
    fs.writeFileSync(path.join(root, 'src', 'application.js'), 'exports.main = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'not-app.js'), 'exports.x = 1;\n');
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: root });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: root });
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync('git', ['commit', '-qm', 'base'], { cwd: root });

    // New files: src/app.js (substring of "application" and suffix of "not-app") + src/null.js (substring of JSON null) + src/$store.js (imported)
    fs.writeFileSync(path.join(root, 'src', 'app.js'), 'exports.app = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'null.js'), 'exports.n = 1;\n');
    fs.writeFileSync(path.join(root, 'src', '$store.js'), 'exports.s = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'application.js'), "const np = require('./not-app');\nconst st = require('./$store');\nexports.main = [np, st];\n");

    const wf = stubCheck.stubFindings(root, { phase: true, levels: ['wired'] }).map((f) => f.file).sort();
    assert.deepEqual(wf, ['src/app.js', 'src/null.js']);

    // suite-impact: superseded / merged_into tasks neither emit G30 nor block earlier tasks in G38
    fs.writeFileSync(path.join(root, 'tests', 'app.test.js'), "const { app } = require('../src/app');\n");
    fs.mkdirSync(path.join(root, 'tests', 'acceptance'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'acceptance', 'a2.test.js'), 'module.exports = 1;\n');
    spawnSync('git', ['add', '-A'], { cwd: root });

    const planDoc = {
      tasks: [
        { id: 'T1', wave: 1, files: ['src/$store.js'], verify: { commands: ['node --test tests/acceptance/a2.test.js'] } },
        { id: 'T2', wave: 3, superseded: 'CR-09', files: ['src/app.js', 'tests/acceptance/a2.test.js'], verify: { commands: ['node -e 0'] } },
        { id: 'T3', wave: 4, merged_into: 'T1', files: ['src/app.js'], verify: { commands: ['node -e 0'] } },
      ],
    };
    assert.deepEqual(suiteImpact.suiteImpact(root, planDoc), []);
    assert.deepEqual(suiteImpact.laterOwnedTests(planDoc), []);
  });
});
