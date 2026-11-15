'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// OxeSpace 15/11 (OxeCode F5 → #854): the phase verify passed, main's CI failed a frozen 1.5.0 acceptance suite reading
// a CSS file the phase changed and the static CSS-class guard. `verify.phase_suites` runs them in the phase verify.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-phase-suites-'));
  dirs.push(dir);
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  write(dir, 'src/design/workspace-color.css', '.tint { color: red; }\n');
  write(dir, 'src/tint.ts', 'export const tint = 1;\n');
  write(dir, 'src/other.ts', 'export const other = 1;\n');
  write(dir, 'tests/acceptance/f1/cr15-tint.test.ts', "const css = require('fs').readFileSync('src/design/workspace-color.css', 'utf8');\n");
  write(dir, 'tests/acceptance/f1/a2-import.test.ts', "import { tint } from '../../../src/tint';\n");
  write(dir, 'tests/acceptance/f1/a3-other.test.ts', "import { other } from '../../../src/other';\n");
  write(dir, 'tests/unit/css-classes-guard.test.ts', "// scans src/**\n");
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/design/workspace-color.css', '.tint { color: blue; }\n');
  write(dir, 'src/tint.ts', 'export const tint = 2;\n');
  git(dir, 'commit', '-qam', 'phase');
  return { dir, base };
}

describe('verify.phase_suites: the repo suites that read the phase files, in the phase verify', () => {
  it('off by default; with the config, the acceptance suites that import or name a changed file, plus the guards', () => {
    const { dir, base } = repo();
    assert.deepEqual(op.phaseSuitesGates(dir, base, {}), [], 'opt-in');
    const [g] = op.phaseSuitesGates(dir, base, { verify: { phase_suites: { guards: ['tests/unit/css-classes-guard.test.ts', 'tests/unit/missing.test.ts'], run_command: 'node scripts/run.mjs {files}' } } });
    assert.equal(g.id, 'phase-suites');
    assert.equal(g.when, 'phase_verify');
    assert.equal(g.command, 'node scripts/run.mjs tests/acceptance/f1/a2-import.test.ts tests/acceptance/f1/cr15-tint.test.ts tests/unit/css-classes-guard.test.ts');
    assert.doesNotMatch(g.command, /a3-other/, 'a suite on an unchanged file is not run');
    assert.doesNotMatch(g.command, /missing\.test/, 'a guard that does not exist is skipped');
  });

  it('only real suites (no helper, fixture, e2e spec or parked suite); path.join names a file; max_files never cuts the guards (cross-review 15/11)', () => {
    const { dir, base } = repo();
    write(dir, 'tests/acceptance/helpers/h.ts', "import { tint } from '../../../src/tint';\n");
    write(dir, 'tests/acceptance/fixtures/notes.md', 'reads src/tint.ts\n');
    write(dir, 'tests/acceptance/f1/menu.e2e.test.ts', "import { tint } from '../../../src/tint';\n");
    write(dir, 'tests/acceptance/parked-f9/later.test.ts', "import { tint } from '../../../src/tint';\n");
    write(dir, 'src/css/app.css', '.a {}\n');
    write(dir, 'tests/acceptance/f1/joined.test.ts', "const p = require('path').join('src', 'css', 'app.css');\n");
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'more');
    write(dir, 'src/css/app.css', '.a { color: red }\n');
    git(dir, 'commit', '-qam', 'phase 2');
    const [g] = op.phaseSuitesGates(dir, base, { verify: { phase_suites: true } });
    const files = g.command.replace('npx vitest run ', '').split(' ');
    assert.ok(files.includes('tests/acceptance/f1/joined.test.ts'), files.join(' '));
    for (const bad of ['tests/acceptance/helpers/h.ts', 'tests/acceptance/fixtures/notes.md', 'tests/acceptance/f1/menu.e2e.test.ts', 'tests/acceptance/parked-f9/later.test.ts']) assert.ok(!files.includes(bad), bad);
    const [capped] = op.phaseSuitesGates(dir, base, { verify: { phase_suites: { max_files: 1, guards: ['tests/unit/css-classes-guard.test.ts'] } } });
    const cf = capped.command.replace('npx vitest run ', '').split(' ');
    assert.equal(cf.length, 2);
    assert.equal(cf[1], 'tests/unit/css-classes-guard.test.ts', 'the guard survives the cap');
  });

  it('it is one of the implicit phase gates (stub-check off too)', () => {
    const { dir, base } = repo();
    const state = { phases: [{ id: 'F5', base_commit: base }] };
    const ids = op.implicitPhaseGates(dir, state, 'F5', { stub_check: false, verify: { phase_suites: true } }).map((x) => x.id);
    assert.ok(ids.includes('phase-suites'), ids.join(','));
  });
});
