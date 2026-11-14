'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — oxespace-152 (code, mobile): two messages that pointed the wrong way.
// 1) `program start --phase F1` said "Próximo: /oxe-plan" with PLAN.json, PLAN.md and the packs of F1 in place.
// 2) plan lint printed HINT(html-fetch) ("se abrir em file://…") for an Electron app whose SPEC never says file://.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-fh-')); dirs.push(d); return d; };
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

describe('program start: a phase whose plan exists points to the execute', () => {
  const planning = { id: 'F1', status: 'planning', acceptance: ['A1'] };

  it('no PLAN.json, or one for another phase: no plan for this phase (→ /oxe-plan)', () => {
    const dir = tmp();
    write(dir, '.oxe/STATE.md', '# STATE\n');
    assert.equal(op.phasePlanReadiness(dir, null, planning).exists, false);
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F2', tasks: [{ id: 'T1', files: ['a.js'] }] }));
    assert.equal(op.phasePlanReadiness(dir, null, planning).exists, false);
  });

  it('a PLAN.json of this phase with tasks: exists, with the plan-only lint result', () => {
    const dir = tmp();
    write(dir, '.oxe/STATE.md', '# STATE\n');
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['a.js'], verify: { commands: ['node -e 0'] } }] }));
    const r = op.phasePlanReadiness(dir, null, planning);
    assert.equal(r.exists, true);
    assert.equal(r.tasks, 1);
    assert.equal(typeof r.errors, 'number');
    assert.ok(r.lint_ok === true || r.lint_ok === false || r.lint_ok === null);
  });

  it('only a phase in planning is looked at', () => {
    assert.equal(op.phasePlanReadiness(tmp(), null, { id: 'F1', status: 'executing' }), null);
    assert.equal(op.phasePlanReadiness(tmp(), null, null), null);
  });

  it('the CLI says "oxe-cc runtime execute" for an existing phase plan, "/oxe-plan" without one', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'oxe-cc.js'), 'utf8');
    assert.match(src, /status\.phase_plan && status\.phase_plan\.exists/);
    assert.match(src, /oxe-cc runtime execute \(o plano da fase/);
  });
});

describe('plan lint: HINT(html-fetch) only for a static file:// app', () => {
  const SPEC = { objective: 'Enviar texto para o celular pela LAN; a interface web (HTML) mostra o estado na página.', criteria: [] };
  const PLAN = { tasks: [{ id: 'T1', verifyCommand: 'npx vitest run tests/a.test.ts' }] };
  const hint = (dir) => op.lintPlanForCommonPitfalls(PLAN, SPEC, dir, '').some((h) => /HINT\(html-fetch\)/.test(h));

  it('an Electron app: no hint', () => {
    const dir = tmp();
    write(dir, 'index.html', '<html></html>');
    write(dir, 'package.json', JSON.stringify({ devDependencies: { electron: '^33.0.0', 'electron-vite': '^2.0.0' } }));
    assert.equal(op.looksLikeStaticFileApp(dir), false);
    assert.equal(hint(dir), false);
  });

  it('a Vite app or a project without index.html: no hint', () => {
    const dir = tmp();
    write(dir, 'index.html', '<html></html>');
    write(dir, 'package.json', JSON.stringify({ devDependencies: { vite: '^5.0.0' } }));
    assert.equal(hint(dir), false);
    assert.equal(hint(tmp()), false);
  });

  it('a plain index.html + app.js (no package.json or no bundler): the hint stays', () => {
    const dir = tmp();
    write(dir, 'index.html', '<html><script src="app.js"></script></html>');
    write(dir, 'app.js', 'console.log(1)');
    assert.equal(hint(dir), true);
    write(dir, 'package.json', JSON.stringify({ devDependencies: { eslint: '^9.0.0' } }));
    assert.equal(hint(dir), true);
  });
});
