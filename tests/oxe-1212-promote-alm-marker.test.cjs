'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// OxeSpace 15/11 (OXE-277): the promoted PR body says "Fecha KEY" only for the card's last open task, "Parte de KEY"
// while another task of the plan still shares the card — the merge then moves the card only on "Fecha".

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function setup(t2Key) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pmark-'));
  dirs.push(dir);
  const g = (...a) => git(dir, ...a);
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'src/a.js', 'a\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'program');
  write(dir, 'src/a.js', 'a2\n');
  g('add', '-A'); g('commit', '-qm', 'feat: T1', '-m', 'OXE-Task: T1');
  const t1 = g('rev-parse', 'HEAD');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/config.json', JSON.stringify({ docs_publish: false, adr: false, alm: { provider: 'jira', program: 'p', jira: { project: 'OXE' }, states: { integrated: 'Na main' } } }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [
    { id: 'T1', title: 'parte um', wave: 1, files: ['src/a.js'], done: true, done_commit: t1, verify: { commands: ['node -e 0'] } },
    { id: 'T2', title: 'parte dois', wave: 2, files: ['src/b.js'], verify: { commands: ['node -e 0'] } },
  ] }));
  const links = [{ ref: 'T1', key: 'OXE-5' }, { ref: 'T2', key: t2Key }].map((l) => JSON.stringify(l)).join('\n');
  const almLib = require('../bin/lib/oxe-alm.cjs');
  for (const l of links.split('\n')) almLib.addLink(path.join(dir, '.oxe', 'program'), JSON.parse(l));
  return dir;
}

describe('promote: Parte de / Fecha in the PR body', () => {
  it('another open task on the same card → "Parte de"; the card\'s last task → "Fecha"', () => {
    const shared = setup('OXE-5');
    const a = op.runtimePromote(shared, null, { task: 'T1', base: 'main', prReady: false });
    assert.equal(a.alm_key, 'OXE-5');
    assert.equal(a.alm_marker, 'Parte de OXE-5');
    assert.match(fs.readFileSync(path.join(shared, a.body_file), 'utf8'), /Parte de OXE-5 \(ainda abertas no card: T2\)/);
    const own = setup('OXE-6');
    const b = op.runtimePromote(own, null, { task: 'T1', base: 'main', prReady: false });
    assert.equal(b.alm_marker, 'Fecha OXE-5');
    assert.match(fs.readFileSync(path.join(own, b.body_file), 'utf8'), /\nFecha OXE-5\n$/);
  });
});
