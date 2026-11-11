'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const ui = require('../bin/lib/oxe-ui-evidence.cjs');

// 1.21.2 — OXB-128: the reproducible UI evidence package; the standing UI sign-off accepts only it; --freeze.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ui-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\nhml/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | cálculo | teste |\n| A70 | Erros na interface não serão admitidos | HML |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ project_env_check: false, program: { standing_acceptance: ['A70'] }, ui_evidence: { standing: true } }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] }));
  write(dir, 'src/a.js', '1\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}
const head = (dir) => git(dir, 'rev-parse', 'HEAD').stdout.trim();

function pkg(dir, mutate) {
  const folder = path.join(dir, 'hml', 'f2');
  const steps = [{ action: 'goto', value: '/config' }, { action: 'click', role: 'button', name: 'Salvar' }, { action: 'expect', role: 'status', name: 'Resultado', value: 'Salvo' }];
  const runs = [];
  for (const locale of ['pt-BR', 'en']) for (const theme of ['light', 'dark']) {
    const base = `${locale}-${theme}`;
    for (const f of [`${base}.png`, `${base}.base.png`, `${base}.a11y.json`]) write(folder, f, 'x');
    runs.push({ locale, theme, os: 'windows', steps, captures: [{ state: 'saved', file: `${base}.png`, baseline: `${base}.base.png`, diff_ratio: 0.002 }], a11y: [{ state: 'saved', file: `${base}.a11y.json`, violations: 0 }] });
  }
  const doc = { schema: 1, sha: head(dir), criteria: ['A70'], matrix: { locale: ['pt-BR', 'en'], theme: ['light', 'dark'], os: ['windows'] }, runs,
    findings: [{ id: 'HML-F2-1', title: 'Salvar não confirma', steps, expected: 'Salvo', observed: 'nada' }] };
  if (mutate) mutate(doc);
  write(folder, 'ui-evidence.json', JSON.stringify(doc, null, 2));
  return folder;
}

describe('OXB-128: UI evidence package', () => {
  it('a complete package validates; incomplete matrix, a diff above the limit, CSS selectors and missing a11y are refused', () => {
    const dir = project();
    assert.deepEqual(ui.validate(pkg(dir)).errors, []);
    const e1 = ui.validate(pkg(dir, (d) => { d.runs.pop(); })).errors.join('\n');
    assert.match(e1, /falta a execução en\/dark\/windows/);
    const e2 = ui.validate(pkg(dir, (d) => { d.runs[0].captures[0].diff_ratio = 0.05; })).errors.join('\n');
    assert.match(e2, /diff visual 0\.05 acima do limite 0\.01/);
    const e3 = ui.validate(pkg(dir, (d) => { d.runs[1].steps = [{ action: 'click', selector: '#save' }]; })).errors.join('\n');
    assert.match(e3, /seletor livre não é estável/);
    const e4 = ui.validate(pkg(dir, (d) => { d.runs[2].a11y = []; })).errors.join('\n');
    assert.match(e4, /sem relatório de acessibilidade/);
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'ui-evidence', 'validate', 'hml/f2', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
  });

  it('the sign-off of the standing UI criterion accepts only a valid package of this commit', () => {
    const dir = project();
    assert.throws(() => op.runtimeSignoff(dir, null, { phase: 'F1', criteria: 'A70', by: 'po', evidence: 'docs/rel.md' }), /sem ui-evidence\.json/);
    pkg(dir, (d) => { d.runs[0].a11y = []; });
    assert.throws(() => op.runtimeSignoff(dir, null, { phase: 'F1', criteria: 'A70', by: 'po', evidence: 'hml/f2' }), /sem relatório de acessibilidade/);
    pkg(dir, (d) => { d.sha = 'abcdef1234'; });
    assert.throws(() => op.runtimeSignoff(dir, null, { phase: 'F1', criteria: 'A70', by: 'po', evidence: 'hml/f2' }), /avaliou outro commit/);
    pkg(dir);
    const rec = op.runtimeSignoff(dir, null, { phase: 'F1', criteria: 'A70', by: 'po', evidence: 'hml/f2' });
    assert.equal(rec.ui_evidence.cells, 4);
    // a non-UI criterion is not affected
    assert.ok(op.runtimeSignoff(dir, null, { phase: 'F1', criteria: 'A1', by: 'po', evidence: 'docs/rel.md' }));
  });

  it('signal --freeze turns a finding with steps into a frozen role/name test registered in the plan', () => {
    const dir = project();
    pkg(dir);
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'signal', '--from', 'hml/f2', '--freeze', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const test = fs.readFileSync(path.join(dir, 'tests', 'ui-regression', 'HML-F2-1.spec.js'), 'utf8');
    assert.match(test, /page\.getByRole\("button", \{ name: "Salvar" \}\)\.click\(\)/);
    assert.match(test, /toHaveText\("Salvo"\)/);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const at = doc.acceptance_tests.find((a) => a.id === 'ui-HML-F2-1');
    assert.equal(at.criterion, 'A70');
    assert.equal(at.frozen, true);
    assert.deepEqual(require('../bin/lib/oxe-plan-json.cjs').validatePlanJson(doc), []);
  });
});
