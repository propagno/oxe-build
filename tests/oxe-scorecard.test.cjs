'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scorecard = require('../bin/lib/oxe-scorecard.cjs');
const program = require('../bin/lib/oxe-program.cjs');
const runtime = require('../lib/runtime/index.js');

// 1.21 · maturidade medida: o scorecard sai dos registros do próprio runtime; e o handoff das fases fechadas chega ao executor.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-score-')); dirs.push(d); return d; }

const ev = (type, task, payload, ts) => ({ type, run_id: 'r1', work_item_id: task, payload, timestamp: ts });

describe('scorecard', () => {
  it('mede 1ª tentativa, turnos pagos após concluir, estouro de orçamento, CR sem prova e CR pós-verde', () => {
    const events = [
      ev('ExecutorUsage', 'T1', { turns: 5 }, '2026-11-01T10:00:00Z'),
      ev('WorkItemCompleted', 'T1', { attempt_number: 1 }, '2026-11-01T10:01:00Z'),
      ev('ExecutorUsage', 'T1', { turns: 3 }, '2026-11-01T10:05:00Z'),
      ev('ExecutorUsage', 'T2', { turns: 5 }, '2026-11-01T10:06:00Z'),
      ev('WorkItemCompleted', 'T2', { attempt_number: 2 }, '2026-11-01T10:08:00Z'),
      ev('VerificationCompleted', null, { status: 'passed' }, '2026-11-01T11:00:00Z'),
    ];
    const changeLines = [
      { kind: 'cr', id: 'CR-01', class: 'defect', at: '2026-11-01T09:00:00Z', status: 'open' },
      { kind: 'cr', id: 'CR-02', class: 'constraint', at: '2026-11-01T12:00:00Z', status: 'open', by: 'CI 123' },
      { kind: 'cr', id: 'CR-03', class: 'constraint', at: '2026-11-01T12:30:00Z', status: 'open', gate: 'typecheck' },
      { kind: 'status', id: 'CR-01', status: 'resolved', resolution: 'teste de aceite A1 verde', at: '2026-11-01T10:30:00Z' },
      { kind: 'status', id: 'CR-02', status: 'resolved', resolution: 'resolvido à mão', at: '2026-11-01T13:00:00Z' },
    ];
    const ledgers = [{ limit_turns: 10, used_turns: 12 }, { limit_turns: 20, used_turns: 18 }];
    const card = scorecard.computeScorecard({ events, changeLines, ledgers });
    const by = Object.fromEntries(card.metrics.map((m) => [m.metric, m]));
    assert.equal(by.first_attempt_rate.value, 0.5);
    assert.equal(by.first_attempt_rate.ok, false);
    assert.equal(by.turns_on_finished_work.value, 3, 'os 3 turnos pagos na T1 já concluída');
    assert.equal(by.budget_overruns.value, 1);
    assert.equal(by.crs_closed_without_proof.value, 1, 'CR-02 fechado sem teste nem gate');
    assert.equal(by.post_green_crs.value, 1, 'CR-02 (CI) depois do verde; CR-03 é do próprio gate da fase');
    assert.equal(card.ok, false);
  });

  it('sem dados a 1ª tentativa fica neutra e o resto dentro das metas', () => {
    const card = scorecard.computeScorecard({ events: [], changeLines: [], ledgers: [] });
    assert.equal(card.metrics.find((m) => m.metric === 'first_attempt_rate').ok, null);
    assert.equal(card.ok, true);
  });
});

describe('handoff das fases fechadas no contexto', () => {
  it('lê o handoff preenchido do dossiê e o prompt do nó o renderiza', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'F1'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'F2'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'F1', 'plan.md'), '<!-- oxe:dossier:begin -->\nx\n<!-- oxe:dossier:end -->\n\n## O que a próxima fase deve saber\n\n- O PS 5.1 não assina eventos WinRT: sem parciais; use RecognizeAsync em loop.\n');
    fs.writeFileSync(path.join(dir, 'F2', 'plan.md'), '<!-- oxe:dossier:begin -->\nx\n<!-- oxe:dossier:end -->\n\n## O que a próxima fase deve saber\n\n(preencher antes do `program close`)\n');
    const state = { phases: [{ id: 'F1', status: 'closed' }, { id: 'F2', status: 'closed' }, { id: 'F3', status: 'executing' }] };
    const handoffs = program.loadClosedHandoffs(dir, state);
    assert.deepEqual(handoffs.map((h) => h.phase), ['F1'], 'F2 ainda com o placeholder não conta');
    assert.match(handoffs[0].text, /RecognizeAsync/);
    const text = runtime.renderNodeContext({ handoffs }).join('\n');
    assert.match(text, /## O que as fases anteriores deixaram\n.*\n### F1\n- O PS 5\.1/);
  });
});

describe('release exige scorecard de projetos reais (≥ 1.21.0)', () => {
  const release = require('../bin/lib/oxe-release.cjs');
  const op = require('../bin/lib/oxe-operational.cjs');

  it('runtime scorecard --release-report faz upsert por projeto; o gate conta projetos dentro das metas', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const report = path.join(dir, 'release', 'scorecard-report.json');
    op.runtimeScorecard(dir, null, { releaseReport: report, name: 'proj-a' });
    op.runtimeScorecard(dir, null, { releaseReport: report, name: 'proj-a' });
    const doc = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.deepEqual(doc.results.map((r) => r.name), ['proj-a'], 'upsert, sem duplicar');

    const manifest = release.buildReleaseManifest(path.join(__dirname, '..'), { skipWrapperSync: true });
    const blockersFor = (version, scorecardSummary) => {
      const m = JSON.parse(JSON.stringify(manifest));
      m.versions.root = version;
      m.reports.scorecard = scorecardSummary;
      return release.evaluateReleaseManifest(m, { enforceSync: false }).blockers.filter((b) => /scorecard/.test(b));
    };
    const ok = (name) => ({ name, ok: true, report: { ok: true, sample: { completed_tasks: 12 } } });
    assert.deepEqual(blockersFor('1.20.0', { present: false, failures: ['report_missing'], results: [] }), [], 'antes da 1.21 não exige');
    assert.match(blockersFor('1.21.0', { present: false, failures: ['report_missing'], results: [] })[0], /scorecard report ausente/);
    assert.match(blockersFor('1.21.0', { present: true, failures: [], results: [ok('a')] })[0], /1 projeto\(s\) real\(is\); a release exige 2/);
    assert.deepEqual(blockersFor('1.21.0', { present: true, failures: [], results: [ok('a'), ok('b')] }), []);
  });
});
