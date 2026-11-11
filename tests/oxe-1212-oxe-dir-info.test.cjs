'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const info = require('../bin/lib/oxe-dir-info.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-031: a session running an old global oxe-cc (1.12) on a .oxe/ written by 1.21 got no warning.
// OXB-043: the main checkout's September .oxe/ (dead plan) looked as valid as the active 1.5.0 worktree's.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const RUNNING = info.runningVersion();
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dir-'));
  dirs.push(dir);
  const g = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  return { dir, g };
}
const writeEvents = (dir, ts) => fs.writeFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), `${JSON.stringify({ type: 'x', timestamp: ts })}\n`);

describe('OXB-031/043: which oxe-cc wrote the .oxe/, and whether it is stale', () => {
  it('a runtime write records the running version; status (a read) never writes it', () => {
    const { dir } = repo();
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', info.MARKER)), 'status is a read: no marker written');
    assert.match(JSON.parse(r.stdout).oxeDir.reasons.join('\n'), /sem registro da versão/);
    op.appendEvent(dir, null, { type: 'Test' });
    assert.equal(info.readMarker(dir).oxe_version, RUNNING);
    const d = info.describeOxeDir(dir);
    assert.equal(d.stale, false);
    assert.equal(d.version, RUNNING);
  });

  it('older writer, newer writer and long idle are stale, with the reason; the program phase is shown', () => {
    const { dir } = repo();
    fs.writeFileSync(path.join(dir, '.oxe', info.MARKER), JSON.stringify({ oxe_version: '1.12.0' }));
    writeEvents(dir, new Date().toISOString());
    let d = info.describeOxeDir(dir, { running: '1.21.2' });
    assert.equal(d.stale, true);
    assert.match(d.reasons.join('\n'), /gerado pelo oxe-cc 1\.12\.0, mais antigo que o 1\.21\.2/);
    fs.writeFileSync(path.join(dir, '.oxe', info.MARKER), JSON.stringify({ oxe_version: '1.21.2' }));
    d = info.describeOxeDir(dir, { running: '1.12.0' });
    assert.match(d.reasons.join('\n'), /MAIS NOVO que o 1\.12\.0 em execução — rode a versão do projeto \(npx oxe-cc@1\.21\.2\)/);
    writeEvents(dir, new Date(Date.now() - 40 * 86_400_000).toISOString());
    fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ active_phase: 'F2', phases: [{ id: 'F1', status: 'closed' }, { id: 'F2', status: 'executing' }] }));
    d = info.describeOxeDir(dir, { running: '1.21.2' });
    assert.equal(d.stale, true);
    assert.match(d.reasons.join('\n'), /sem atividade há 40 dias/);
    assert.match(info.oxeDirLine(d), /gerado pelo oxe-cc 1\.21\.2 \(rodando 1\.21\.2\) · última atividade .* \(40d\) · programa: F2 executing \(1\/2 fechadas\)/);
  });

  it('status --all-worktrees lists each worktree\'s .oxe/ and marks the stale one', () => {
    const { dir, g } = repo();
    fs.writeFileSync(path.join(dir, '.oxe', info.MARKER), JSON.stringify({ oxe_version: '1.12.0' }));
    writeEvents(dir, new Date(Date.now() - 60 * 86_400_000).toISOString());
    const wt = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
    dirs.push(wt);
    g('worktree', 'add', '-q', wt, '-b', 'program');
    fs.mkdirSync(path.join(wt, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.oxe', info.MARKER), JSON.stringify({ oxe_version: RUNNING }));
    writeEvents(wt, new Date().toISOString());
    const r = spawnSync(process.execPath, [CLI, 'status', '--all-worktrees', '--json', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr);
    const rows = JSON.parse(r.stdout).worktrees;
    assert.equal(rows.length, 2);
    const main = rows.find((x) => x.here);
    const other = rows.find((x) => !x.here);
    assert.equal(main.oxe.stale, true);
    assert.equal(other.branch, 'program');
    assert.equal(other.oxe.stale, false);
    const text = spawnSync(process.execPath, [CLI, 'status', '--all-worktrees', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } }).stdout;
    assert.match(text, /\[main\] stale/);
    assert.match(text, /\[program\] ativo/);
  });
});

describe('OXB-031: init stamps the version without growing the lean core', () => {
  it('init-oxe: the README legend carries the version; the doctor reads it before any runtime write', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-init-'));
    dirs.push(dir);
    const r = spawnSync(process.execPath, [CLI, 'init-oxe', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.oxe')).sort(), ['README.md', 'STATE.md', 'config.json']);
    assert.equal(info.describeOxeDir(dir).version, RUNNING);
  });
});
