'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const signal = require('../bin/lib/oxe-signal.cjs');

// 1.21.2 — OXB-092 (minimal): HML findings (HML-F1-1 … became CR-12..14 by hand) and GitHub `bug` issues become CRs
// in their phase, tied to the criterion — the signal → intent link of the ADLC loop.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const REPORT = `# HML — F2 e F1

### HML-F2-1 [defect] (A48) Settings: o botão Remover não tem foco visível
Passos: abrir Settings, Tab até o botão.

- **HML-F2-2** — a lista de MCP ainda mostra o AI Memory em \`src/settings/McpList.tsx\`
- **HML-F2-3** — contraste baixo no rodapé (sem arquivo, sem critério)
- **HML-F1-4** [spec_gap] (A8) o pt-BR da tela de falha ainda traz texto em inglês
`;

function project({ standing = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sig-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A8 | f1 | m |\n| A48 | f2 | m |\n| A57 | f2 b | m |\n| A70 | ui polida | sign-off |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(standing ? { program: { standing_acceptance: ['A70'] } } : {}));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [
    { id: 'T1', title: 'settings', wave: 1, files: ['src/settings/Remove.tsx'], acceptance: ['A48'], done: true },
    { id: 'T2', title: 'mcp', wave: 1, files: ['src/settings/McpList.tsx'], acceptance: ['A57'], done: true },
  ] }));
  const ph = (id, acceptance, status) => ({ id, title: id, requirements: [], acceptance, scope: null, status, plan_ref: null, run_id: null, started_at: 'x', closed_at: status === 'closed' ? 'x' : null, closed_commit: null, regression_ref: null, interfaces_ref: null });
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: 'F2', created_at: 'x', updated_at: 'x', phases: [ph('F1', ['A8'], 'closed'), ph('F2', ['A48', 'A57'], 'executing')] }));
  fs.writeFileSync(path.join(dir, 'hml.md'), REPORT);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('OXB-092: signals → CRs in their phase', () => {
  it('parses the HML report: id, phase, class, criteria, files', () => {
    const f = signal.parseReport(REPORT);
    assert.deepEqual(f.map((x) => [x.id, x.phase, x.class, x.criteria, x.files]), [
      ['HML-F2-1', 'F2', 'defect', ['A48'], []],
      ['HML-F2-2', 'F2', 'defect', [], ['src/settings/McpList.tsx']],
      ['HML-F2-3', 'F2', 'defect', [], []],
      ['HML-F1-4', 'F1', 'spec_gap', ['A8'], []],
    ]);
    assert.match(f[0].summary, /^Settings: o botão Remover não tem foco visível$/);
  });

  it('creates the CRs (named criterion; A* → T → files), lists the closed phase and triage, and is idempotent', () => {
    const dir = project();
    const out = op.runtimeSignal(dir, null, { from: 'hml.md', by: 'hml' });
    assert.deepEqual(out.created.map((c) => [c.id, c.phase, c.criteria, c.criteria_source]), [
      ['HML-F2-1', 'F2', ['A48'], 'finding'],
      ['HML-F2-2', 'F2', ['A57'], 'traceability'],
    ]);
    assert.deepEqual(out.triage.map((t) => t.id), ['HML-F2-3']);
    assert.equal(out.closed_phase[0].id, 'HML-F1-4');
    assert.match(out.closed_phase[0].suggestion, /runtime feedback --class spec_gap --phase F1 --criteria A8/);
    const crs = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.kind === 'cr');
    assert.deepEqual(crs.map((c) => [c.class, c.phase, c.summary.slice(0, 9)]), [['defect', 'F2', 'HML-F2-1:'], ['defect', 'F2', 'HML-F2-2:']]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), 'utf8')).phases[0].status, 'closed', 'F1 not reopened');
    const again = op.runtimeSignal(dir, null, { from: 'hml.md', by: 'hml' });
    assert.deepEqual(again.created, []);
    assert.deepEqual(again.duplicates, ['HML-F2-1', 'HML-F2-2']);
  });

  it('with a standing UI criterion (A70) a finding without criterion or files is tied to it', () => {
    const dir = project({ standing: true });
    const out = op.runtimeSignal(dir, null, { from: 'hml.md', dryRun: true });
    const f3 = out.created.find((c) => c.id === 'HML-F2-3');
    assert.deepEqual([f3.criteria, f3.criteria_source], [['A70'], 'standing']);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'program', 'changes.ndjson')), 'dry-run writes nothing');
  });

  it('GitHub: one issue needs the bug label; github:<repo> lists open bug issues (gh injected)', () => {
    const dir = project();
    const issue = { number: 731, title: 'HML-F2-9: Settings quebra em 900 px', body: 'Critério A48. Arquivo `src/settings/Remove.tsx`', labels: [{ name: 'bug' }], url: 'https://github.com/o/r/issues/731' };
    const gh = (cmd, args) => (args[1] === 'view' ? { status: 0, stdout: JSON.stringify(issue) } : { status: 0, stdout: JSON.stringify([issue, { ...issue, number: 732, title: 'menu some', body: 'fase F2, `src/settings/McpList.tsx`' }]) });
    let out = op.runtimeSignal(dir, null, { from: 'https://github.com/o/r/issues/731', ghSpawn: gh, dryRun: true });
    assert.deepEqual(out.created.map((c) => [c.id, c.phase, c.criteria]), [['HML-F2-9', 'F2', ['A48']]]);
    const noBug = (cmd, args) => ({ status: 0, stdout: JSON.stringify({ ...issue, labels: [] }) });
    assert.throws(() => op.runtimeSignal(dir, null, { from: 'https://github.com/o/r/issues/731', ghSpawn: noBug }), /não tem o label bug/);
    out = op.runtimeSignal(dir, null, { from: 'github:o/r', ghSpawn: gh, dryRun: true });
    assert.deepEqual(out.created.map((c) => [c.id, c.phase, c.criteria_source]), [['HML-F2-9', 'F2', 'finding'], ['GH-o/r#732', 'F2', 'traceability']]);
  });

  it('CLI: runtime signal --from hml.md', () => {
    const dir = project();
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'signal', '--from', 'hml.md', '--by', 'hml', '--dir', dir], { cwd: dir, encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /2 CR\(s\) criados . 0 já importados . 1 de fase fechada . 1 para triagem/);
  });
});
