'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const guard = require('../bin/lib/oxe-guard.cjs');

// 1.21.2 — OXB-119: tool guards that block BEFORE the action (pre-tool hook), fail closed, PolicyBlocked events.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const SCRIPT = path.join(__dirname, '..', 'bin', 'lib', 'oxe-guard.cjs');

function project(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-gd-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(config));
  return dir;
}
const CONFIG = {
  policy_rules: [
    { id: 'no-live-db', kind: 'path', deny_read: '**/AppData/Roaming/oxespace/**', message: 'nunca ler o banco vivo do app' },
    { id: 'no-stash', kind: 'command', deny: '\\bgit\\s+stash\\b', message: 'nunca git stash no checkout do usuário' },
  ],
  guards: { heavy: ['\\btsc\\b', '\\bvitest\\b'], heavy_wrapper: 'node scripts/heavy-lock.cjs', protected_checkouts: ['.'] },
};
const run = (dir, call) => spawnSync(process.execPath, [SCRIPT, '--project', dir], { input: JSON.stringify({ cwd: dir, ...call }), encoding: 'utf8' });

describe('OXB-119: guards', () => {
  it('blocks a write outside the root; a write inside passes', () => {
    const dir = project(CONFIG);
    const out = run(dir, { tool_name: 'Write', tool_input: { file_path: path.join(os.tmpdir(), 'elsewhere.txt') } });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /escrita fora da raiz/);
    assert.equal(run(dir, { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'a.ts') } }).status, 0);
  });

  it('blocks reading the live DB by Read, Grep and the shell (cat, git show ref:path, $( ), bash -c)', () => {
    const dir = project(CONFIG);
    const db = 'C:/Users/u/AppData/Roaming/oxespace/state.db';
    assert.equal(run(dir, { tool_name: 'Read', tool_input: { file_path: db } }).status, 2);
    assert.equal(run(dir, { tool_name: 'Grep', tool_input: { pattern: 'x', path: 'C:/Users/u/AppData/Roaming/oxespace' } }).status, 2);
    for (const command of [`cat "${db}"`, `echo $(type ${db})`, `bash -c "head ${db}"`, 'git show HEAD:AppData/Roaming/oxespace/state.db']) {
      const r = run(dir, { tool_name: 'Bash', tool_input: { command } });
      assert.equal(r.status, 2, command);
      assert.match(r.stderr, /regra no-live-db/);
    }
  });

  it('blocks a denied command and git checkout/stash in the protected checkout; heavy commands need the lock wrapper', () => {
    const dir = project(CONFIG);
    assert.match(run(dir, { tool_name: 'Bash', tool_input: { command: 'git stash push -m wip' } }).stderr, /regra no-stash/);
    assert.match(run(dir, { tool_name: 'Bash', tool_input: { command: 'git checkout feature-x' } }).stderr, /checkout protegido/);
    const heavy = run(dir, { tool_name: 'Bash', tool_input: { command: 'npx tsc --noEmit' } });
    assert.equal(heavy.status, 2);
    assert.match(heavy.stderr, /sem o wrapper de lock — rode: node scripts\/heavy-lock\.cjs npx tsc --noEmit/);
    assert.equal(run(dir, { tool_name: 'Bash', tool_input: { command: 'node scripts/heavy-lock.cjs npx tsc --noEmit' } }).status, 0);
    assert.equal(run(dir, { tool_name: 'Bash', tool_input: { command: 'git status' } }).status, 0);
  });

  it('each block is a PolicyBlocked event; an internal error fails closed; guards.enabled false is a no-op', () => {
    const dir = project(CONFIG);
    run(dir, { tool_name: 'Bash', tool_input: { command: 'git stash' } });
    const ev = fs.readFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(ev[0].type, 'PolicyBlocked');
    assert.equal(ev[0].payload.rule, 'no-stash');
    const broken = spawnSync(process.execPath, [SCRIPT, '--project', dir], { input: '{not json', encoding: 'utf8' });
    assert.equal(broken.status, 2);
    assert.match(broken.stderr, /erro interno, ação bloqueada/);
    const off = project({ ...CONFIG, guards: { ...CONFIG.guards, enabled: false } });
    assert.equal(run(off, { tool_name: 'Bash', tool_input: { command: 'git stash' } }).status, 0);
  });

  it('shellPaths finds paths in substitutions and git show', () => {
    assert.ok(guard.shellPaths('git show main:src/a.ts').includes('src/a.ts'));
    assert.ok(guard.shellPaths('x=$(cat /etc/hosts)').some((p) => p.includes('/etc/hosts')));
  });
});
