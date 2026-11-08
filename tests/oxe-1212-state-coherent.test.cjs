'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 - OXB-121 (contradiction, P0): after F1's close the oxespace STATE.md said "status: completed, checks 38/38"
// in one block and "Status da run: failed, Concluidos (0), Falhos (7)" in the other, for the same run.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const RUNTIME_BLOCK = [
  '# Estado',
  '',
  '## Fase atual',
  '',
  '- **Status da run:** failed',
  '- **Run ID:** oxe-run-x',
  '',
  '## Runtime operacional',
  '',
  '- **runtime_status:** failed',
  '',
  '## Progresso',
  '',
  '- **Concluídos (0):** —',
  '- **Falhos (3):** T1, T2, T3',
  '- **Bloqueados (0):** —',
].join('\n');

describe('OXB-121: the STATE.md runtime block agrees with the run and with PLAN.json', () => {
  it('status from the run state; done tasks from PLAN.json are never listed as failed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-state-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [
      { id: 'T1', title: 'a', wave: 1, files: ['a.js'], done: true },
      { id: 'T2', title: 'b', wave: 1, files: ['b.js'], done: true },
      { id: 'T3', title: 'c', wave: 1, files: ['c.js'] },
      { id: 'T4', title: 'd', wave: 1, files: [], kind: 'external_delivery', blocked_by: ['o/r#1'] },
    ] }));
    const out = op.coherentStateProjection(dir, null, RUNTIME_BLOCK, { status: 'completed' });
    assert.match(out, /- \*\*Status da run:\*\* completed/);
    assert.match(out, /- \*\*runtime_status:\*\* completed/);
    assert.match(out, /- \*\*Concluídos \(2\):\*\* T1, T2/);
    assert.match(out, /- \*\*Falhos \(1\):\*\* T3/);
    assert.match(out, /- \*\*Aguardando entrega externa \(1\):\*\* T4/);
    assert.doesNotMatch(out, /failed/);
  });
});
