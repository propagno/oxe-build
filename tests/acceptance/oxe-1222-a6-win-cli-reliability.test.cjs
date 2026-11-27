'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const op = require('../../bin/lib/oxe-operational.cjs');
const planBuild = require('../../bin/lib/oxe-plan-build.cjs');
const originLib = require('../../bin/lib/oxe-origin.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkGitRepo(prefix = 'oxe-1222-a6-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'keep.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'drop.js'), 'module.exports = 2;\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A6 — OXB-222-06: Windows & CLI reliability fixes from v1.22.0 bench', () => {
  it('OXB-222-06: commitExactContent batches update-index --index-info with index.lock retry', () => {
    // 1. Structural & runtime guarantee: uses --index-info batching + index.lock retry helper
    const opSrc = fs.readFileSync(path.resolve(__dirname, '..', '..', 'bin', 'lib', 'oxe-operational.cjs'), 'utf8');
    const fnIdx = opSrc.indexOf('function commitExactContent(');
    assert.ok(fnIdx > 0, 'commitExactContent must exist');
    const fnSlice = opSrc.slice(fnIdx, fnIdx + 4500);
    assert.match(fnSlice, /update-index['",\s]+--index-info/, 'commitExactContent must use git update-index --index-info');
    assert.match(opSrc, /index\.lock/i, 'oxe-operational must implement retry on transient index.lock');

    // 2. Real git behavior: add + edit + delete in one atomic commitTaskCheckpoint call
    const dir = mkGitRepo('oxe-1222-a6-ckpt-');
    fs.writeFileSync(path.join(dir, 'src', 'keep.js'), 'module.exports = 10;\n');
    fs.writeFileSync(path.join(dir, 'src', 'added.js'), 'module.exports = 30;\n');
    fs.rmSync(path.join(dir, 'src', 'drop.js'));

    const res = op.commitTaskCheckpoint(
      dir,
      { run_id: 'run-1', compiled_graph: { nodes: { T1: { scope: ['src/keep.js', 'src/added.js', 'src/drop.js'] } } } },
      'T1',
      {
        task: { id: 'T1', title: 'multi-file atomic commit', files: ['src/keep.js', 'src/added.js', 'src/drop.js'] },
        ratchets: false,
        stubGuard: false,
        checkpointCheck: false,
      },
    );
    assert.equal(res.committed, true, res.reason || JSON.stringify(res));
    const headFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir, encoding: 'utf8' });
    assert.match(headFiles, /src\/keep\.js/);
    assert.match(headFiles, /src\/added\.js/);
    assert.doesNotMatch(headFiles, /src\/drop\.js/);
  });

  it('OXB-222-06: program init exits 1 on error and runtimeProgramClose caches complexityAlarms', () => {
    // 1. runtime program init without ROADMAP.md must exit with non-zero code (1)
    const emptyDir = mkGitRepo('oxe-1222-a6-init-');
    fs.mkdirSync(path.join(emptyDir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(emptyDir, '.oxe', 'STATE.md'), '# STATE\n');
    const initRes = spawnSync(process.execPath, [BIN, 'runtime', 'program', 'init', '--dir', emptyDir], {
      cwd: emptyDir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(initRes.status, 1, `runtime program init on missing ROADMAP must exit 1, got ${initRes.status}`);

    // 2. runtimeProgramClose computes complexityAlarms at most once per close
    const opSrc = fs.readFileSync(path.resolve(__dirname, '..', '..', 'bin', 'lib', 'oxe-operational.cjs'), 'utf8');
    const closeIdx = opSrc.indexOf('function runtimeProgramClose(');
    const nextFnIdx = opSrc.indexOf('function acceptanceAmendmentsSection(', closeIdx);
    assert.ok(closeIdx > 0 && nextFnIdx > closeIdx);
    const closeBody = opSrc.slice(closeIdx, nextFnIdx);
    const directCalls = closeBody.match(/complexityAlarms\s*\(/g) || [];
    assert.ok(directCalls.length <= 1, `runtimeProgramClose must cache complexityAlarms (<= 1 call), found ${directCalls.length}`);
  });

  it('OXB-222-06: plan build preserves role symbols and CJS requires, and origin supports allow_no_alm_quick', () => {
    // 1. plan build preserves explicit role.json symbols + infers CJS `const mod = require(...)` usage
    const dir = mkGitRepo('oxe-1222-a6-build-');
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests', 'acceptance'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'lib', 'alpha.cjs'), 'function runAlpha() { return 1; }\nmodule.exports = { runAlpha };\n');
    fs.writeFileSync(path.join(dir, 'lib', 'beta.cjs'), 'function runBeta() { return 2; }\nmodule.exports = { runBeta };\n');
    fs.writeFileSync(
      path.join(dir, 'tests', 'acceptance', 'a1.test.cjs'),
      "const alpha = require('../../lib/alpha.cjs');\nalpha.runAlpha();\n",
    );

    const built = planBuild.build(
      [
        {
          file: 'F1.role.json',
          doc: {
            role: 'fase',
            tasks: [
              {
                rid: 'R1',
                title: 'wire alpha and beta',
                files: ['lib/alpha.cjs', 'lib/beta.cjs'],
                edited: ['lib/alpha.cjs', 'lib/beta.cjs'],
                symbols: [{ kind: 'function', name: 'runBeta', path: 'lib/beta.cjs' }],
                acceptance: ['A1'],
                verify: { commands: ['node --test tests/acceptance/a1.test.cjs'] },
              },
            ],
            acceptance_tests: [
              { criterion: 'A1', files: ['tests/acceptance/a1.test.cjs'], command: 'node --test tests/acceptance/a1.test.cjs' },
            ],
          },
        },
      ],
      { root: dir, phase: 'F1' },
    );

    const t1Pack = built.pack.tasks[0];
    assert.ok(t1Pack.symbols.some((s) => s.name === 'runBeta' && s.path === 'lib/beta.cjs'), `must preserve explicit role.json symbols: ${JSON.stringify(t1Pack.symbols)}`);
    assert.ok(t1Pack.symbols.some((s) => s.name === 'runAlpha' && s.path === 'lib/alpha.cjs'), `must infer CJS require() member calls: ${JSON.stringify(t1Pack.symbols)}`);

    // 2. origin.allow_no_alm_quick permits registered local OXE-Quick without OXE-Card, rejects unregistered ones
    const ocfgStrict = originLib.originConfig({ alm: { provider: 'jira' } });
    const ocfgAllow = originLib.originConfig({ alm: { provider: 'jira' }, origin: { allow_no_alm_quick: true } });
    const commit = {
      sha: '1111111111111111111111111111111111111111',
      parents: 1,
      author: { name: 'Dev', email: 'dev@example.com' },
      message: 'chore: quick fix\n\nOXE-Quick: Q-20261126-ab12',
      files: ['src/app.js'],
    };

    const strictVerdict = originLib.classify(commit, ocfgStrict, { quickExists: () => true });
    assert.equal(strictVerdict.ok, false, 'without allow_no_alm_quick, ALM config requires OXE-Card');

    const allowedRegistered = originLib.classify(commit, ocfgAllow, { quickExists: (id) => id === 'Q-20261126-ab12' });
    assert.equal(allowedRegistered.ok, true, `allow_no_alm_quick must allow registered quick: ${JSON.stringify(allowedRegistered)}`);

    const rejectedUnregistered = originLib.classify(commit, ocfgAllow, { quickExists: () => false });
    assert.equal(rejectedUnregistered.ok, false, 'allow_no_alm_quick must still reject unregistered quick IDs');
  });
});
