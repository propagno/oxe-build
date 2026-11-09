'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const rp = require('../bin/lib/oxe-research-provenance.cjs');

// 1.21.2 — OXB-134: research claims carry a source; assumptions used by a task become plan risks.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function project(plan) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-rp-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, '.oxe/PLAN.json', JSON.stringify(plan));
  write(dir, '.oxe/research/2026-11-09-fila.md', '# N\n\n## Afirmações\n\n- O worker reprocessa a fila a cada 5 s\n- A fila usa SQLite [fonte: src/queue.ts:12]\n- O cliente tolera 2 s de atraso\n- O lock é por workspace\n\n## Suposições\n\n- S1: o volume fica abaixo de 100 itens/min\n- S2: ninguém roda dois apps no mesmo perfil\n');
  write(dir, '.oxe/research/2025-antiga.md', '# Nota antiga\n\nTexto livre.\n');
  return dir;
}
const task = (extra = {}) => ({ id: 'T1', title: 'fila', wave: 1, files: ['src/q.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] }, ...extra });

describe('OXB-134: research provenance', () => {
  it('parses claims with and without a source and assumptions with ids', () => {
    const n = rp.parseNote('## Afirmações\n\n- a [fonte: x.ts:1]\n- b\n\n## Suposições\n\n- S1: c\n- d\n');
    assert.deepEqual(n.claims.map((c) => c.sourced), [true, false]);
    assert.deepEqual(n.assumptions.map((a) => a.id), ['S1', null]);
    assert.equal(rp.parseNote('# só texto').structured, false);
  });

  it('three claims without a source are the three warnings; an old note is a warning, not an error', () => {
    const dir = project({ schema_version: 1, tasks: [task()] });
    const lint = op.runtimePlanLint(dir, null, {});
    assert.equal(lint.warnings.filter((w) => /afirmação sem fonte/.test(w)).length, 3, lint.warnings.join('\n'));
    assert.ok(lint.warnings.some((w) => /2025-antiga\.md: nota sem as seções/.test(w)));
    assert.ok(!lint.errors.some((e) => /research\//.test(e)));
  });

  it('an assumption a task uses without a risk → assumption_without_risk; with the risk it is quiet', () => {
    const dir = project({ schema_version: 1, tasks: [task({ assumptions: ['S1'] }), { ...task(), id: 'T2', title: 'depende de S2' }] });
    let w = op.runtimePlanLint(dir, null, {}).warnings.filter((x) => /assumption_without_risk/.test(x));
    assert.equal(w.length, 2, w.join('\n'));
    assert.match(w[0], /T1 usa a suposição S1/);
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [task({ assumptions: ['S1'] })], risks: [{ id: 'R1', assumption: 'S1', mitigation: 'spike:T9' }] }));
    w = op.runtimePlanLint(dir, null, {}).warnings.filter((x) => /assumption_without_risk/.test(x));
    assert.deepEqual(w, []);
  });
});
