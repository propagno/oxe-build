'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const findings = require('../bin/lib/oxe-findings.cjs');
const seams = require('../bin/lib/oxe-seams.cjs');
const deps = require('../bin/lib/oxe-deps-audit.cjs');

// 1.21.2 — OXB-137 (severity from a table), OXB-136 (seam review), OXB-127 (dependency audit).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const repo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-fsd-')); dirs.push(d); git(d, 'init', '-q'); git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't'); return d; };

describe('OXB-137: finding severity from the table', () => {
  it('the rule decides the severity; a different one is refused; no rule = observation; the project raises, never lowers', () => {
    const dir = repo();
    assert.deepEqual(findings.rate(dir, { rule: 'a11y-serious' }), { rule: 'a11y-serious', severity: 'high', rated: true });
    assert.throws(() => findings.rate(dir, { rule: 'a11y-serious', severity: 'low' }), /a severidade de a11y-serious é high/);
    assert.deepEqual(findings.rate(dir, {}), { rule: null, severity: 'unrated', rated: false });
    assert.throws(() => findings.rate(dir, { severity: 'critical' }), /severidade sem regra/);
    write(dir, '.oxe/finding-rules.json', JSON.stringify({ rules: [{ id: 'stale-copy', severity: 'medium' }, { id: 'crash', severity: 'low' }, { id: 'tenant-leak', severity: 'critical' }] }));
    const { rules, problems } = findings.loadRules(dir);
    assert.equal(rules.get('stale-copy').severity, 'medium', 'raised');
    assert.equal(rules.get('crash').severity, 'high', 'never lowered');
    assert.equal(rules.get('tenant-leak').severity, 'critical');
    assert.match(problems.join('\n'), /crash: o projeto não pode baixar/);
  });

  it('close.block_on: any critical, and high on a standing criterion', () => {
    const crs = [
      { id: 'CR-33', status: 'open', severity: 'high', criteria: ['A70'] },
      { id: 'CR-14', status: 'open', severity: 'low', criteria: ['A70'] },
      { id: 'CR-20', status: 'open', severity: 'high', criteria: ['A3'] },
      { id: 'CR-40', status: 'open', severity: 'critical', criteria: ['A9'] },
      { id: 'CR-41', status: 'resolved', severity: 'critical', criteria: [] },
    ];
    assert.deepEqual(findings.blockingFindings(crs, undefined, ['A70']).map((c) => c.id), ['CR-33', 'CR-40']);
  });
});

describe('OXB-136: seam review', () => {
  it('shared files, exports changed with consumers in another task, duplicated helpers, growth, retro and behavior runs', () => {
    const dir = repo();
    write(dir, 'src/panel.js', 'export function render(a, b) { return a; }\n');
    write(dir, 'src/use.js', "import { render } from './panel';\nexport const x = render(1, 2);\n");
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const helper = (name) => `export function ${name}(xs) {\n  const out = [];\n  for (const x of xs) {\n    if (x) out.push(x * 2);\n  }\n  return out;\n}\n`;
    write(dir, 'src/panel.js', `export function render(a) { return a; }\n${helper('doubleA')}`);
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'T1 panel', '-m', 'OXE-Task: F1/T1');
    write(dir, 'src/use.js', "import { render } from './panel';\nexport const x = render(1);\n");
    write(dir, 'src/other.js', helper('doubleB') + Array.from({ length: 320 }, (_, i) => `export const v${i} = ${i};`).join('\n'));
    write(dir, 'src/panel.js', fs.readFileSync(path.join(dir, 'src/panel.js'), 'utf8') + '// T2 touched panel too\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'T2 use', '-m', 'OXE-Task: F1/T2');
    const r = seams.seamsReport(dir, base, {
      phase: 'F2',
      retroActions: [{ id: 'RA-F1-1', phase: 'F1', action: 'rodar o typecheck no verify das tarefas' }, { id: 'RA-F1-2', phase: 'F1', action: 'x', evidence: 'commit abc' }],
      behaviorCriteria: ['A5', 'A6'], behaviorRuns: [{ criteria: ['A6'] }],
    });
    assert.deepEqual(r.shared_files, [{ file: 'src/panel.js', tasks: ['T1', 'T2'] }]);
    assert.equal(r.export_consumers[0].export, 'render');
    assert.equal(r.export_consumers[0].consumers[0].file, 'src/use.js');
    assert.equal(r.duplicate_helpers.length, 1);
    const pair = `${r.duplicate_helpers[0].a} ${r.duplicate_helpers[0].b}`;
    assert.match(pair, /src\/panel\.js#doubleA/);
    assert.match(pair, /src\/other\.js#doubleB/);
    assert.equal(r.grown_files[0].file, 'src/other.js');
    assert.deepEqual(r.retro_open.map((a) => a.id), ['RA-F1-1']);
    assert.deepEqual(r.behavior_missing, ['A5']);
    assert.match(seams.renderSeams(r, 'F2'), /## Exports alterados com consumidor em outra tarefa \(1\)/);
    assert.deepEqual(seams.behaviorCriteriaFromSpec('| A5 | fluxo | executar o fluxo de ponta a ponta |\n| A6 | x | teste |\n'), ['A5']);
  });
});

describe('OXB-127: dependency audit', () => {
  const setup = () => {
    const dir = repo();
    write(dir, 'package.json', JSON.stringify({ name: 'p', dependencies: { lodash: '^4' } }));
    write(dir, 'package-lock.json', JSON.stringify({ packages: { '': { name: 'p' }, 'node_modules/ssh2': { hasInstallScript: true } } }));
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    return { dir, base: git(dir, 'rev-parse', 'HEAD').stdout.trim() };
  };
  it('a new high advisory, a non-existent name and a lookalike; native added/removed; an old advisory does not block', () => {
    const { dir, base } = setup();
    write(dir, 'package.json', JSON.stringify({ name: 'p', dependencies: { lodash: '^4', 'left-padx': '1', axois: '1', 'better-sqlite3': '9' } }));
    write(dir, 'package-lock.json', JSON.stringify({ packages: { '': { name: 'p' }, 'node_modules/better-sqlite3': { hasInstallScript: true } } }));
    const registry = (n) => n !== 'left-padx';
    const audit = (lock) => (lock.includes('better-sqlite3') ? { 'lodash:1': { name: 'lodash', severity: 'high', id: 'GHSA-old' }, 'axois:2': { name: 'axois', severity: 'critical', id: 'GHSA-new' } } : { 'lodash:1': { name: 'lodash', severity: 'high', id: 'GHSA-old' } });
    const r = deps.auditDeps(dir, base, { registry, audit });
    assert.deepEqual(r.missing, ['left-padx']);
    assert.deepEqual(r.lookalikes, [{ name: 'axois', like: 'axios' }]);
    assert.deepEqual(r.new_advisories.map((a) => a.id), ['GHSA-new']);
    assert.deepEqual(r.blocks.sort(), ['advisory critical nova em axois (GHSA-new)', 'pacote left-padx não existe no registro']);
    assert.deepEqual(r.native_added, ['better-sqlite3']);
    assert.deepEqual(r.native_removed, ['ssh2']);
    assert.match(deps.renderDeps(r), /rebuild/);
  });
  it('no manifest change: the audit does not run', () => {
    const { dir, base } = setup();
    write(dir, 'src.js', '1');
    assert.equal(deps.auditDeps(dir, base, { registry: () => true, audit: () => ({}) }).ran, false);
  });
});

describe('wiring: feedback --rule, guards install, runtime seams/deps', () => {
  const op = require('../bin/lib/oxe-operational.cjs');
  const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
  const project = () => {
    const dir = repo();
    write(dir, '.gitignore', '.oxe/\n.claude/\n');
    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | executar o fluxo de ponta a ponta |\n| A70 | ui | sign-off |\n');
    write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
    write(dir, '.oxe/config.json', JSON.stringify({ program: { standing_acceptance: ['A70'] } }));
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], done: true }] }));
    write(dir, 'src/a.js', '1\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
    op.runtimeProgramInit(dir, null, {});
    op.runtimeProgramStart(dir, null, 'F1');
    return dir;
  };

  it('feedback --rule stores the table severity; a high finding on the standing criterion blocks the close', () => {
    const dir = project();
    const out = op.runtimeFeedback(dir, null, { class: 'defect', summary: 'foco preso no diálogo de consentimento', criteria: 'A70', by: 'hml', rule: 'a11y-serious' });
    assert.equal(out.cr.severity, 'high');
    assert.equal(out.cr.rule, 'a11y-serious');
    assert.throws(() => op.runtimeFeedback(dir, null, { class: 'defect', summary: 'outro achado qualquer aqui', criteria: 'A1', by: 'hml', rule: 'a11y-serious', severity: 'low' }), /tabela/);
    const r = (() => { try { const x = op.runtimeProgramClose(dir, null, { phase: 'F1', gates: false, dossier: false, commit: false, defects: false, rollbackCheck: false }); return x.gate.reasons.join('\n'); } catch (e) { return e.message; } })();
    assert.ok(r.includes(`achado high aberto: ${out.cr.id} (a11y-serious)`), r);
    assert.match(r, /costura: o critério A1 pede o fluxo de ponta a ponta executado/);
  });

  it('runtime seams: retro actions and the behavior run are recorded; seams.md in the dossier', () => {
    const dir = project();
    const add = op.runtimeSeams(dir, null, { retroAdd: 'rodar o typecheck no verify' });
    assert.equal(add.retro_action.id, 'RA-F1-1');
    op.runtimeSeams(dir, null, { behaviorRan: 'A1', evidence: 'docs/e2e.md' });
    const rep = op.runtimeSeams(dir, null, {});
    assert.deepEqual(rep.report.behavior_missing, []);
    assert.ok(fs.existsSync(path.join(dir, rep.file)));
  });

  it('guards install writes the PreToolUse hook; uninstall removes only ours', () => {
    const dir = project();
    write(dir, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
    const r = spawnSync(process.execPath, [CLI, 'install', '--guards', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    assert.equal(s.hooks.PreToolUse.length, 2);
    assert.match(s.hooks.PreToolUse[1].hooks[0].command, /oxe-guard\.cjs" --project/);
    spawnSync(process.execPath, [CLI, 'guards', 'uninstall', '--dir', dir], { encoding: 'utf8' });
    const s2 = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(s2.hooks.PreToolUse.map((h) => h.hooks[0].command), ['echo mine']);
  });
});
