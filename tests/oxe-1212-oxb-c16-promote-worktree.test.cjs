'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
};

const writeRel = (dir, rel, content) => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, 'utf8');
};

describe('OXB-C16: promote worktree short slug, MAX_PATH safety, and pr:ready cwd/PWD setup.ts resolution', () => {
  it('shortens multi-task promote worktree directory name and keeps deep paths under Windows MAX_PATH during pr:ready', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c16-long-repo-name-'));
    dirs.push(dir);

    const deepRel = 'mobile/android/app/src/test/snapshots/images/com.oxespace.mobile.ui.components_ComponentsSnapshotTest_providerAvatar_night_false_provider-avatar.png';
    writeRel(dir, '.gitignore', '.oxe/\nnode_modules/\n');
    writeRel(dir, 'tests/setup.ts', 'export const ok = true;\n');
    writeRel(dir, deepRel, 'png-placeholder\n');
    writeRel(dir, 'package.json', {
      name: 'c16-fixture',
      version: '1.0.0',
      scripts: {
        'pr:ready': 'node scripts/pr-ready.cjs',
      },
    });
    writeRel(
      dir,
      'scripts/pr-ready.cjs',
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "const setup = path.resolve(process.cwd(), 'tests', 'setup.ts');",
        "if (!fs.existsSync(setup)) { console.error('Missing setup:', setup); process.exit(1); }",
        "if (process.env.PWD && path.resolve(process.env.PWD) !== path.resolve(process.cwd())) {",
        "  console.error('Stale PWD:', process.env.PWD, 'vs cwd:', process.cwd());",
        '  process.exit(1);',
        '}',
        "console.log('pr:ready setup ok:', setup);",
      ].join('\n') + '\n',
    );
    writeRel(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | ok | pass |\n');
    writeRel(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
    writeRel(dir, '.oxe/STATE.md', '# STATE\n');

    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@oxe.test');
    git(dir, 'config', 'user.name', 'OXE Test');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'checkout', '-qb', 'feat/c16');

    const tasks = [];
    for (let n = 8; n <= 17; n += 1) {
      const id = `T${n}`;
      const file = `src/f${n}.txt`;
      writeRel(dir, file, `v-${n}\n`);
      git(dir, 'add', file);
      git(dir, 'commit', '-qm', `feat(ui): task ${id}\n\nOXE-Task: ${id}`);
      const sha = git(dir, 'rev-parse', 'HEAD');
      tasks.push({ id, title: `Task ${id}`, wave: 1, files: [file], acceptance: ['A1'], done: true, done_commit: sha });
    }
    writeRel(dir, '.oxe/PLAN.json', { schema_version: 1, phase: 'F1', tasks });
    writeRel(dir, '.oxe/PLAN.md', '# PLAN\n');

    const prevPwd = process.env.PWD;
    process.env.PWD = dir;
    let out;
    try {
      out = op.runtimePromote(dir, null, {
        tasks: 'T8,T9,T10,T11,T12,T13,T14,T15,T16,T17',
        base: 'main',
        prReady: true,
        quietProgress: true,
      });
    } finally {
      if (prevPwd === undefined) delete process.env.PWD;
      else process.env.PWD = prevPwd;
    }

    assert.equal(out.error, undefined, out.error);
    assert.ok(out.pr_ready && out.pr_ready.ok, JSON.stringify(out.pr_ready));
    assert.equal(out.worktree.includes('t8-t9-t10'), false, `worktree path must NOT expand full task list: ${out.worktree}`);
    assert.match(path.basename(out.worktree), /^t8-10t-[0-9a-f]{6}-/);
  });

  it('sweeps crashed external promote-ws directories via .pid pointer in .oxe/promote-ws', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c16-sweep-'));
    const extWt = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-pw-dead-'));
    dirs.push(dir, extWt);

    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@oxe.test');
    git(dir, 'config', 'user.name', 'OXE Test');
    writeRel(dir, 'a.txt', 'a\n');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-qm', 'base');

    writeRel(dir, '.oxe/promote-ws/t8-10t-dead00-abc.pid', {
      pid: 999999,
      task: 'T8-T9-T10',
      dir: extWt,
      at: new Date().toISOString(),
    });
    assert.equal(fs.existsSync(extWt), true);

    const swept = op.sweepStalePromoteWorkspaces(dir, { minAgeMs: 0 });
    assert.equal(fs.existsSync(extWt), false, 'dead external worktree must be swept');
    assert.equal(fs.existsSync(path.join(dir, '.oxe/promote-ws/t8-10t-dead00-abc.pid')), false);
    assert.equal(swept.length, 1);
  });
});
