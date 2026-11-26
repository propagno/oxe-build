'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const op = require('../bin/lib/oxe-operational.cjs');
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

const dirs = [];
afterEach(() => {
  while (dirs.length) {
    try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* Windows lock */ }
  }
});

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return String(r.stdout || '').trim();
}

function writeFiles(root, map) {
  for (const [rel, content] of Object.entries(map)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

describe('OXB-C1 P3: #9 commit-task verify_timeout_ms inheritance, #10 single-step program close --by-ci, #11 worktree quick ALM inheritance', () => {
  it('#9 commit-task reads oxe.config.json, nested execute.verify_timeout_ms, main-worktree fallback, and CLI --verify-timeout <s>', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c1-p3-to-'));
    dirs.push(base);
    const mainDir = path.join(base, 'main');
    const wtDir = path.join(base, 'wt');
    fs.mkdirSync(mainDir, { recursive: true });
    git(mainDir, ['init', '-q']);
    git(mainDir, ['config', 'user.email', 'test@oxe.local']);
    git(mainDir, ['config', 'user.name', 'OXE Test']);

    writeFiles(mainDir, {
      '.gitignore': '.oxe/\n',
      'src/app.js': 'module.exports = 1;\n',
      '.oxe/config.json': JSON.stringify({ execute: { verify_timeout_ms: 400 } }, null, 2),
    });
    git(mainDir, ['add', '.']);
    git(mainDir, ['commit', '-qm', 'init']);
    git(mainDir, ['worktree', 'add', '-b', 'prog', wtDir]);

    // wtDir has NO `.oxe/config.json` verify_timeout_ms: inherits `execute.verify_timeout_ms: 400` from main worktree!
    writeFiles(wtDir, {
      'src/app.js': 'module.exports = 2;\n',
      '.oxe/PLAN.md': '# PLAN\n\n### T18 — Timeout\n',
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        tasks: [
          {
            id: 'T18',
            title: 'Timeout',
            wave: 1,
            files: ['src/app.js'],
            verify: { commands: ['node -e "setTimeout(() => {}, 2500)"'] },
          },
        ],
      }, null, 2),
    });

    assert.throws(
      () => op.runtimeCommitTask(wtDir, null, { task: 'T18', by: 'coord' }),
      /estourou o tempo.*0 s|estourou o tempo.*1 s/
    );

    // Passing `--verify-timeout 5` (seconds) overrides the 400ms config so a 600ms verify passes and commits!
    writeFiles(wtDir, {
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        tasks: [
          {
            id: 'T18',
            title: 'Timeout',
            wave: 1,
            files: ['src/app.js'],
            verify: { commands: ['node -e "setTimeout(() => process.exit(0), 500)"'] },
          },
        ],
      }, null, 2),
    });
    const okCli = spawnSync(process.execPath, [CLI, 'runtime', 'commit-task', 'T18', '--by', 'coord', '--verify-timeout', '5', '--dir', wtDir], { encoding: 'utf8', windowsHide: true });
    assert.equal(okCli.status, 0, okCli.stderr + okCli.stdout);
  });

  it('#10 program close F1 --by-ci <run> auto-attaches the CI run and closes in one command; program --help documents --by-ci', () => {
    const helpOut = spawnSync(process.execPath, [CLI, 'program', '--help'], { encoding: 'utf8', windowsHide: true });
    assert.equal(helpOut.status, 0);
    assert.match(helpOut.stdout, /program close \[Fn\] \[--by-ci/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c1-p3-byci-'));
    dirs.push(dir);
    writeFiles(dir, {
      '.gitignore': '.oxe/\n',
      '.oxe/STATE.md': '# S\n',
      '.oxe/PLAN.md': '# PLAN\n',
      '.oxe/SPEC.md': '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n',
      '.oxe/ROADMAP.md': '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n',
      '.oxe/config.json': JSON.stringify({ external_dependency_check: false }),
      '.oxe/PLAN.json': JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'ui', wave: 1, files: ['src/ui.ts'], acceptance: ['A1'], done: true }] }),
      'src/ui.ts': 'export {};\n',
    });
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 't@t.local']);
    git(dir, ['config', 'user.name', 'Test']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'base']);

    op.runtimeProgramInit(dir, null, {});
    op.runtimeProgramStart(dir, null, 'F1');
    const head = git(dir, ['rev-parse', 'HEAD']);
    const ghSpawn = () => ({
      status: 0,
      stdout: JSON.stringify({ status: 'completed', conclusion: 'success', headSha: head, url: 'https://github.com/org/repo/actions/runs/43795148664' }),
      stderr: '',
    });

    // Single-step close with `ciRun` (no prior `runtime ci --attach` needed)
    const out = op.runtimeProgramClose(dir, null, {
      phase: 'F1',
      byCi: true,
      ciRun: '43795148664',
      by: 'coord',
      reason: 'CI verde na main contém todos os commits da fase F1',
      gates: false,
      dossier: false,
      commit: false,
      defects: false,
      rollbackCheck: false,
      ghSpawn,
    });
    assert.equal(out.closed, true, JSON.stringify(out.gate && out.gate.reasons));
    assert.equal(out.close_by_ci.run, '43795148664');
  });

  it('#11 quick in a program worktree inherits ALM from sibling worktree or --alm-dir and routes reader pending requests to that worktree', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c1-p3-quick-'));
    dirs.push(base);
    const mainDir = path.join(base, 'main');
    const sibAlmDir = path.join(base, 'wt-writer');
    const progWtDir = path.join(base, 'wt-f6');
    fs.mkdirSync(mainDir, { recursive: true });
    git(mainDir, ['init', '-q']);
    git(mainDir, ['config', 'user.email', 'test@oxe.local']);
    git(mainDir, ['config', 'user.name', 'OXE Test']);
    writeFiles(mainDir, {
      '.gitignore': '.oxe/\n',
      'src/a.js': 'module.exports = 1;\n',
    });
    git(mainDir, ['add', '.']);
    git(mainDir, ['commit', '-qm', 'init']);

    // `mainDir` has NO `.oxe/config.json`! `sibAlmDir` has the ALM config (just like OxeSpace worktrees)
    git(mainDir, ['worktree', 'add', '-b', 'alm-writer', sibAlmDir]);
    git(mainDir, ['worktree', 'add', '-b', 'prog-f6', progWtDir]);

    writeFiles(sibAlmDir, {
      '.oxe/config.json': JSON.stringify({
        alm: {
          provider: 'jira',
          base_url: 'https://example.atlassian.net',
          project: 'OXE',
          writer: 'OXE_ALM_WRITER',
          states: { in_progress: 'Em desenvolvimento' },
        },
      }, null, 2),
    });

    // Running `quick start` in `progWtDir` (reader session, no OXE_ALM_WRITER) discovers ALM from `sibAlmDir` and queues pending in `sibAlmDir`!
    const started = await op.runtimeQuick(progWtDir, null, {
      action: 'start',
      key: 'OXE-311',
      objective: 'ajustar alinhamento do painel',
      env: {},
    });
    assert.equal(started.alm.from, path.resolve(sibAlmDir));
    assert.equal(started.alm.pending.length, 2);
    assert.equal(fs.existsSync(path.join(sibAlmDir, '.oxe', 'alm', 'pending.ndjson')), true, 'pending ALM ops must land in inherited ALM worktree');

    // Also supports explicit `--alm-dir` via CLI (hermetic env without writer/token so no live HTTP call is made)
    const extAlmDir = path.join(base, 'external-alm');
    writeFiles(extAlmDir, {
      '.oxe/config.json': JSON.stringify({
        alm: {
          provider: 'jira',
          base_url: 'https://example.atlassian.net',
          project: 'OXE',
          writer: 'OXE_ALM_WRITER',
          states: { in_progress: 'Em desenvolvimento' },
        },
      }, null, 2),
    });
    const hermeticEnv = { ...process.env };
    delete hermeticEnv.OXE_ALM_WRITER;
    delete hermeticEnv.JIRA_API_TOKEN;
    delete hermeticEnv.JIRA_TOKEN;
    const cliOut = spawnSync(process.execPath, [
      CLI, 'quick', 'OXE-312', 'outro ajuste', '--replace', '--alm-dir', extAlmDir, '--dir', progWtDir,
    ], { encoding: 'utf8', windowsHide: true, env: hermeticEnv });
    assert.equal(cliOut.status, 0, cliOut.stderr + cliOut.stdout);
    assert.match(cliOut.stdout, /external-alm/);
    assert.equal(fs.existsSync(path.join(extAlmDir, '.oxe', 'alm', 'pending.ndjson')), true);
  });
});
