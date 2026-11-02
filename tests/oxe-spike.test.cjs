'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const spike = require('../bin/lib/oxe-spike.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');

// 1.21 · OXB-007: incerteza que bloqueia o plano vira tarefa spike: pergunta → relatório com evidência → decisão.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-spike-')); dirs.push(d); return d; }

const REPORT = [
  '# Spike T0',
  '- **Pergunta:** o PowerShell 5.1 consegue assinar eventos WinRT?',
  '- **Resposta:** não — Register-ObjectEvent recusa eventos Windows RT; usar loop de RecognizeAsync',
  '- **Evidência:** saída do probe em .oxe/spikes/T0-probe.txt',
].join('\n');

describe('spike', () => {
  it('PLAN.json: spike tem escopo padrão no relatório e verify pelo próprio relatório', () => {
    const doc = { schema_version: 1, tasks: [{ id: 'T0', kind: 'spike', title: 'WinRT no PS 5.1', wave: 1, question: 'PS 5.1 assina eventos WinRT?' }] };
    assert.deepEqual(planJson.validatePlanJson(doc), []);
    const [task] = planJson.planJsonToParsedPlan(doc).tasks;
    assert.deepEqual(task.files, ['.oxe/spikes/T0.md']);
    assert.match(task.verifyCommand, /oxe-spike\.cjs" --check \.oxe\/spikes\/T0\.md$/);
    assert.equal(task.meta.kind, 'spike');
  });

  it('lint: spike sem pergunta ou escrevendo fora de .oxe/spikes/ é erro', () => {
    const plan = planJson.planJsonToParsedPlan({ schema_version: 1, tasks: [{ id: 'T0', kind: 'spike', title: 'x', wave: 1, files: ['src/a.ts'] }] });
    const errors = planJson.lintPlan({ plan, spec: null, pack: null, phase: null, projectRoot: process.cwd(), requiredVersions: new Map() }).errors.join('\n');
    assert.match(errors, /T0: spike sem "question"/);
    assert.match(errors, /T0: spike escreve fora de \.oxe\/spikes\/ \(src\/a\.ts\)/);
  });

  it('o verify do spike exige pergunta, resposta e evidência', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.oxe', 'spikes'), { recursive: true });
    const file = path.join(dir, '.oxe', 'spikes', 'T0.md');
    assert.match(spike.checkSpikeReport(file).message, /ausente/);
    fs.writeFileSync(file, '# Spike\n- Pergunta: algo importante?\n');
    assert.match(spike.checkSpikeReport(file).message, /incompleto \(answer, evidence\)/);
    fs.writeFileSync(file, REPORT);
    assert.equal(spike.checkSpikeReport(file).ok, true);
    const cmd = spike.spikeVerifyCommand('T0');
    assert.doesNotThrow(() => execSync(cmd, { cwd: dir, stdio: 'pipe' }));
  });

  it('a resposta vira decisão append-only no programa', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.oxe', 'spikes'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'spikes', 'T0.md'), REPORT);
    const programDir = path.join(dir, '.oxe', 'program');
    const decision = spike.recordSpikeDecision(dir, programDir, { id: 'T0' });
    assert.equal(decision.id, 'D-SPIKE-T0');
    assert.match(decision.title, /^não — Register-ObjectEvent/);
    const lines = fs.readFileSync(path.join(programDir, 'decisions.ndjson'), 'utf8').trim().split('\n');
    assert.equal(JSON.parse(lines[0]).source, '.oxe/spikes/T0.md');
  });
});
