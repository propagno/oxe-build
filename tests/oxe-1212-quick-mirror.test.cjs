'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const quick = require('../bin/lib/oxe-quick.cjs');
const origin = require('../bin/lib/oxe-origin.cjs');

// OxeSpace 15/11 (worktree t30, F5): quick records vanished from a worktree's untracked .oxe/quick and check-origin
// refused commits `quick commit` made. Records are mirrored in the git common dir, shared by every worktree.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };

describe('quick records mirrored in the git common dir', () => {
  it('a record lost from .oxe/quick is still known, read back and restored; another worktree of the repo sees it too', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-qmirror-'));
    dirs.push(base);
    const main = path.join(base, 'main');
    fs.mkdirSync(main);
    git(main, 'init', '-q'); git(main, 'config', 'user.email', 't@t'); git(main, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(main, '.gitignore'), '.oxe/\n');
    fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
    git(main, 'add', '-A'); git(main, 'commit', '-qm', 'base');
    // a record made BEFORE the mirror existed, in the main checkout: backfilled at the first mirror lookup
    fs.mkdirSync(path.join(main, '.oxe', 'quick'), { recursive: true });
    fs.writeFileSync(path.join(main, '.oxe', 'quick', 'Q-20261114-0c70.json'), JSON.stringify({ id: 'Q-20261114-0c70', status: 'done', started_at: '2026-11-14T10:00:00Z' }));
    const wt = path.join(base, 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
    quick.mirrorDirOf(main);
    assert.equal(quick.exists(wt, 'Q-20261114-0c70'), true, 'the old record reaches the other worktree through the backfill');
    const rec = quick.start(wt, { key: 'OXE-75', objective: 'ajustar o tom do workspace' });
    quick.cancel(wt, { id: rec.id, reason: 'teste do espelho de registros' });
    // the worktree's .oxe is re-created (the loss): the record is gone locally
    fs.rmSync(path.join(wt, '.oxe'), { recursive: true, force: true });
    assert.equal(quick.exists(wt, rec.id), true, 'known through the mirror');
    assert.equal(quick.read(wt, rec.id).id, rec.id);
    assert.ok(fs.existsSync(path.join(wt, '.oxe', 'quick', `${rec.id}.json`)), 'the local copy is restored');
    // the main checkout (same repo, other worktree) sees it as well
    assert.equal(quick.exists(main, rec.id), true);
    assert.ok(quick.list(main).some((r) => r.id === rec.id));
    // check-origin: a commit with the trailer is a plain quick, not "não está registrado"
    fs.rmSync(path.join(wt, '.oxe'), { recursive: true, force: true });
    fs.mkdirSync(path.join(wt, '.oxe', 'quick'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
    git(wt, 'add', 'b.txt'); git(wt, 'commit', '-qm', `fix: b\n\nOXE-Quick: ${rec.id}`);
    const out = origin.check(wt, { target: 'HEAD~1..HEAD', config: { origin: { require_card: false } } });
    assert.equal(out.ok, true, JSON.stringify(out.violations));
    assert.equal(out.results[0].kind, 'quick');
  });
});
