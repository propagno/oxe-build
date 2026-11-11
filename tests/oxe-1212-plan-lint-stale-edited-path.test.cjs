'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const pb = require('../bin/lib/oxe-plan-build.cjs');

// 1.21.2 — OXB-201: F5's role plans named electron/main/services/documentation/preview-automation.ts, moved by F1 to
// services/browser-preview/; plan build wrote the PLAN.json without a word.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2)); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const OLD = 'electron/main/services/documentation/preview-automation.ts';
const NEW = 'electron/main/services/browser-preview/preview-automation.ts';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-stale-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, OLD, 'export function runPreview() { return 1; }\n');
  write(dir, 'src/a.ts', 'export const a = 1;\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  fs.mkdirSync(path.join(dir, path.dirname(NEW)), { recursive: true });
  git(dir, 'mv', OLD, NEW);
  git(dir, 'commit', '-qm', 'R0c: move preview automation');
  return dir;
}

const role = (tasks) => ({ role: 'backend', tasks });

describe('OXB-201: stale edited/deleted paths', () => {
  it('staleRolePaths finds the moved file and suggests the real path; a path created by an earlier task is not stale', () => {
    const dir = project();
    const out = pb.staleRolePaths(dir, 'HEAD', [
      { rid: 'R1', title: 'novo', created: ['src/b.ts'], verify: ['x'] },
      { rid: 'R2', title: 'preview', edited_paths: [OLD], edited: ['src/b.ts', 'src/a.ts'], verify: ['x'] },
      { rid: 'R3', title: 'sumiu', deleted: ['src/nunca-existiu.ts'], verify: ['x'] },
    ]);
    assert.deepEqual(out.map((s) => [s.rid, s.field, s.path, s.suggestion]), [
      ['R2', 'edited', OLD, NEW],
      ['R3', 'deleted', 'src/nunca-existiu.ts', null],
    ]);
  });

  it('plan build errors with the suggestion; --fix-stale-paths rewrites the path into files and the pack', () => {
    const dir = project();
    write(dir, 'roles/backend.json', role([{ rid: 'R1', title: 'preview', files: [OLD], edited_paths: [OLD], acceptance: ['A1'], verify: { commands: ['node -e 1'] } }]));
    let r = spawnSync(process.execPath, [CLI, 'plan', 'build', '--from', 'roles/backend.json', '--dir', dir, '--dry-run', '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const errs = JSON.parse(r.stdout).errors.join('\n');
    assert.match(errs, new RegExp(`${OLD.replace(/[/.]/g, '\\$&')} não existe em HEAD \\(declarado como edited\\) — movido para ${NEW.replace(/[/.]/g, '\\$&')}\\?`));
    r = spawnSync(process.execPath, [CLI, 'plan', 'build', '--from', 'roles/backend.json', '--dir', dir, '--fix-stale-paths'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.deepEqual(plan.tasks[0].files, [NEW]);
    const pack = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    assert.ok(pack.tasks[0].exact_paths.includes(NEW) && !pack.tasks[0].exact_paths.includes(OLD));
    assert.match(r.stdout, /(→|->) electron\/main\/services\/browser-preview\/preview-automation\.ts/);
  });

  it('plan check-role names the move; plan lint flags edited_paths of PLAN.json that are not at HEAD', () => {
    const dir = project();
    write(dir, 'roles/backend.json', role([{ rid: 'R1', title: 'preview', edited: [OLD], acceptance: ['A1'], verify: { commands: ['node -e 1'] } }]));
    const r = spawnSync(process.execPath, [CLI, 'plan', 'check-role', 'roles/backend.json', '--dir', dir], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /movido para electron\/main\/services\/browser-preview\/preview-automation\.ts/);
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/PLAN.json', { schema_version: 1, tasks: [{ id: 'T1', title: 'preview', wave: 1, files: [NEW], edited_paths: [OLD], verify: { commands: ['node -e 1'] } }] });
    const lint = op.runtimePlanLint(dir, null, { preflight: false });
    assert.ok(lint.errors.some((e) => e.includes(`T1: edited_paths cita ${OLD}, que não existe em HEAD — movido para ${NEW}?`)), lint.errors.join('\n'));
  });
});
