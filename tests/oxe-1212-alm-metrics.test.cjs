'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../bin/lib/oxe-alm-metrics.cjs');
const alm = require('../bin/lib/oxe-alm.cjs');

// 1.21.2 — alm metrics: time per column, lead and cycle time, throughput per ISO week, WIP now (and over limit),
// the bottleneck by median, from the status changelog. The 12 canonical stages map to the board's own columns.

const D = (s) => `2026-11-${s}T12:00:00.000Z`;
const STATES = { intake: 'Backlog', grooming: 'Em grooming', refinement: 'Em refinamento', ready: 'Pronto para desenvolvimento', in_progress: 'Em desenvolvimento', review: 'Em revisão', verified: 'Testado', queued: 'Na fila', integrated: 'Na main', staging: 'Em homologação', accepted: 'Homologado', released: 'Lançado' };
const cfg = { states: STATES, wip: { in_progress: 1 }, stages: alm.STAGES };
const issues = [
  { key: 'OXE-1', created: D('01'), status: 'Lançado', changes: [
    { at: D('02'), from: 'Backlog', to: 'Em desenvolvimento' }, { at: D('06'), from: 'Em desenvolvimento', to: 'Em revisão' }, { at: D('07'), from: 'Em revisão', to: 'Lançado' }] },
  { key: 'OXE-2', created: D('01'), status: 'Lançado', changes: [
    { at: D('03'), from: 'Backlog', to: 'Em desenvolvimento' }, { at: D('05'), from: 'Em desenvolvimento', to: 'Em revisão' }, { at: D('09'), from: 'Em revisão', to: 'Lançado' }] },
  { key: 'OXE-3', created: D('08'), status: 'Em desenvolvimento', changes: [{ at: D('09'), from: 'Backlog', to: 'Em desenvolvimento' }] },
  { key: 'OXE-4', created: D('08'), status: 'Em desenvolvimento', changes: [{ at: D('10'), from: 'Backlog', to: 'Em desenvolvimento' }] },
];

describe('alm metrics', () => {
  const out = m.compute(issues, cfg, { now: Date.parse(D('11')) });
  it('lead time (created → Lançado) and cycle time (Em desenvolvimento → Lançado)', () => {
    assert.equal(out.lead_time.done, 2);
    assert.deepEqual([out.lead_time.median_days, out.cycle_time.median_days].map((x) => x > 0), [true, true]);
    assert.ok([6, 8].includes(out.lead_time.median_days));
    assert.ok([5, 6].includes(out.cycle_time.median_days));
  });
  it('WIP now per column, over the alm.wip limit → warning; throughput per ISO week', () => {
    const dev = out.columns.find((c) => c.column === 'Em desenvolvimento');
    assert.equal(dev.now, 2);
    assert.equal(dev.over_wip, true);
    assert.match(out.warnings[0], /Em desenvolvimento: 2 card\(s\), acima do limite de WIP 1/);
    assert.equal(out.throughput.reduce((a, w) => a + w.done, 0), 2);
    assert.equal(m.isoWeek(Date.parse('2026-11-13T12:00:00Z')), '2026-W46');
    assert.equal(m.isoWeek(Date.parse('2027-01-01T12:00:00Z')), '2026-W53');
  });
  it('the bottleneck is the middle column with the highest median time', () => {
    assert.equal(out.bottleneck.column, 'Em revisão'); // medians: revisão [1, 4] d → 4; desenvolvimento [1, 2, 2, 4] d → 2
    assert.equal(out.bottleneck.median_days, 4);
  });
  it('Jira changelog → status changes', () => {
    const ch = m.changesFromJira({ changelog: { histories: [{ created: D('02'), items: [{ field: 'status', fromString: 'Backlog', toString: 'Em grooming' }, { field: 'labels', fromString: '', toString: 'x' }] }] } });
    assert.deepEqual(ch, [{ at: D('02'), from: 'Backlog', to: 'Em grooming', fromId: null, toId: null }]);
  });
  it('the 12 canonical stages, and the old names still accepted (todo / in_review / merged)', () => {
    assert.equal(alm.STAGES.length, 12);
    const c = alm.almConfig({ alm: { provider: 'jira', jira: { project: 'OXE' }, states: { todo: 'A fazer', in_review: 'Em revisão', merged: 'Na main' }, track: ['in_review', 'grooming'] } });
    assert.equal(c.states.intake, 'A fazer');
    assert.equal(c.states.review, 'Em revisão');
    assert.equal(c.states.integrated, 'Na main');
    assert.deepEqual(c.track, ['review', 'grooming']);
  });
});

describe('alm metrics: renamed columns', () => {
  it('a column renamed on the board (same status id) is counted under its current name', () => {
    const issues = [
      { key: 'A', created: D('01'), status: 'Em desenvolvimento', statusId: '3', changes: m.changesFromJira({ changelog: { histories: [{ created: D('02'), items: [{ field: 'status', from: '1', fromString: 'A fazer', to: '3', toString: 'Em andamento' }] }] } }) },
      { key: 'B', created: D('01'), status: 'Backlog', statusId: '1', changes: [] },
    ];
    m.renameByStatusId(issues);
    assert.deepEqual([issues[0].changes[0].from, issues[0].changes[0].to], ['Backlog', 'Em desenvolvimento']);
    const out = m.compute(issues, cfg, { now: Date.parse(D('03')) });
    assert.ok(!out.columns.some((c) => c.column === 'A fazer' || c.column === 'Em andamento'));
  });
});
