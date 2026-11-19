'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const prs = require('../bin/lib/oxe-alm-prs.cjs');
const op = require('../bin/lib/oxe-operational.cjs');
const health = require('../bin/lib/oxe-project-health.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function writeRel(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

describe('OXB-C18: 6 UX/CLI improvements from 42-PR quick/ship/alm + OxeChat F5 dogfooding', () => {
  it('1) runtime status --verbose is accepted and unknown runtime flag shows runtime subcommand help (not root help)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c18-rt-verbose-'));
    dirs.push(dir);
    writeRel(dir, '.oxe/STATE.md', '# STATE\n');

    const ok = spawnSync(process.execPath, [CLI, 'runtime', 'status', '--verbose', '--plain', '--dir', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    assert.doesNotMatch(ok.stderr, /Opção desconhecida/);

    const bad = spawnSync(process.execPath, [CLI, 'runtime', 'status', '--nao-existe', '--dir', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Opção desconhecida:.*--nao-existe/);
    assert.match(bad.stdout, /Uso: oxe-cc runtime <ação>/);
    assert.doesNotMatch(bad.stdout, /--all-agents/);
  });

  it('2) alm pr-merged recognizes OXE-Card trailer and single linked title key without requiring literal Fecha', async () => {
    const cfg = { provider: 'jira', p: { project: 'OXE' }, states: { integrated: 'Na main', in_progress: 'Em andamento' } };

    // OXE-Card trailer promotes key to closes unless explicitly marked Parte de
    const m1 = prs.prMarkers(['fix: adjust button [OXE-201]', 'feat/oxe-201', '', 'fix: button\n\nOXE-Quick: Q-1\nOXE-Card: OXE-201'], cfg);
    assert.deepEqual(m1.closes, ['OXE-201']);
    assert.deepEqual(m1.bare, []);

    const mPartial = prs.prMarkers(['fix: step 1 (OXE-202)', 'feat/oxe-202', 'Parte de OXE-202', 'wip\n\nOXE-Card: OXE-202'], cfg);
    assert.deepEqual(mPartial.closes, []);
    assert.deepEqual(mPartial.partial, ['OXE-202']);

    // Single bare key in title already linked via alm link promotes to close
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c18-pr-merged-'));
    dirs.push(dir);
    const programDir = path.join(dir, '.oxe', 'program');
    const moved = [];
    const almLib = {
      links() { return new Map([['Q-1', { key: 'OXE-300', ref: 'Q-1' }]]); },
      async stageAtOrPast() { return { past: false, live: 'Em andamento', liveStage: 'in_progress' }; },
      async move(_pd, _c, key, stage) { moved.push([key, stage]); return { key, changed: true }; },
      async comment() { return { key: 'OXE-300' }; },
    };
    const prData = { number: 948, url: 'https://x/pull/948', state: 'MERGED', title: 'fix(chat): polish [OXE-300]', branch: 'b', body: 'No literal keyword here', commits: [] };
    const out = await prs.prMerged(dir, programDir, cfg, almLib, { prData, apply: true });
    assert.deepEqual(out.bare, []);
    assert.deepEqual(out.moved.map((m) => m.key), ['OXE-300']);
    assert.deepEqual(moved, [['OXE-300', 'integrated']]);
  });

  it('3) checkpoint_check timeout explicitly reports timeout duration and suggests checkpoint_check_timeout_ms', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c18-cp-timeout-'));
    dirs.push(dir);
    writeRel(dir, '.gitignore', '.oxe/\n');
    writeRel(dir, 'src/a.js', 'module.exports = 1;\n');
    writeRel(dir, '.oxe/config.json', {
      checkpoint_check: 'node -e "setTimeout(() => {}, 5000)"',
      checkpoint_check_timeout_ms: 400,
      checkpoint_integration_checks: false,
    });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@oxe.test');
    git(dir, 'config', 'user.name', 'OXE Test');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');

    writeRel(dir, 'src/a.js', 'module.exports = 2;\n');
    const cp = op.commitTaskCheckpoint(dir, { run_id: 'r1' }, 'T1', {
      task: { id: 'T1', title: 'A', files: ['src/a.js'] },
      ratchets: false,
      stubGuard: false,
    });
    assert.equal(cp.committed, false);
    assert.equal(cp.timed_out, true);
    assert.match(cp.reason, /checkpoint_check timeout: passou de \d+s/);
    assert.match(cp.reason, /checkpoint_check_timeout_ms/);
  });

  it('4) quick --help documents --plain and clarifies --dry-run vs local mode without --apply', () => {
    const r = spawnSync(process.execPath, [CLI, 'quick', '--help'], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--plain/);
    assert.match(r.stdout, /--dry-run/);
    assert.match(r.stdout, /sem --apply/i);
  });

  it('5) worktree ALM inheritance prioritizes main worktree over sibling worktrees and clarifies message', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c18-wt-alm-'));
    dirs.push(root);
    const mainDir = path.join(root, 'repo-main');
    const sibDir = path.join(root, 'repo-sib');
    const curDir = path.join(root, 'repo-cur');
    fs.mkdirSync(mainDir, { recursive: true });
    writeRel(mainDir, '.gitignore', '.oxe/\n');
    writeRel(mainDir, 'README.md', '# repo\n');
    writeRel(mainDir, '.oxe/config.json', { alm: { provider: 'jira', project: 'OXE', url: 'https://main.example', require_apply: true } });
    git(mainDir, 'init', '-q', '-b', 'main');
    git(mainDir, 'config', 'user.email', 't@oxe.test');
    git(mainDir, 'config', 'user.name', 'OXE Test');
    git(mainDir, 'add', '-A');
    git(mainDir, 'commit', '-qm', 'base');

    git(mainDir, 'worktree', 'add', '-q', '-b', 'wt-sib', sibDir);
    writeRel(sibDir, '.oxe/config.json', { alm: { provider: 'jira', project: 'OXE', url: 'https://sib.example', require_apply: true } });
    git(mainDir, 'worktree', 'add', '-q', '-b', 'wt-cur', curDir);
    writeRel(curDir, '.oxe/config.json', { profile: 'balanced' });

    const r = spawnSync(process.execPath, [CLI, 'quick', 'OXE-10', 'Test worktree ALM inheritance', '--plain', '--dir', curDir], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /ALM herdado da worktree principal/);
    assert.ok(r.stdout.includes(mainDir), `expected mainDir ${mainDir} in output:\n${r.stdout}`);
  });

  it('6) validateConfigShape warns on unknown execute.*/executor.* keys and conflicting max_context_chars', () => {
    const ok = health.validateConfigShape({
      execute: { max_context_chars: 120000, max_context_action: 'retry', defer_failed: true },
      executor: { max_run_ms: 1800000, scratch_ignore: ['*.log'] },
    });
    assert.deepEqual(ok.unknownKeys, []);
    assert.deepEqual(ok.typeErrors, []);

    const bad = health.validateConfigShape({
      execute: { max_context_chars: 120000, typo_key: 1 },
      executor: { max_context_chars: 90000, unknown_exec: true },
    });
    assert.ok(bad.unknownKeys.includes('execute.typo_key'));
    assert.ok(bad.unknownKeys.includes('executor.unknown_exec'));
    assert.ok(bad.unknownKeys.some((k) => /execute\.max_context_chars.*conflito com executor\.max_context_chars/.test(k)));
  });
});
