'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const alm = require('../bin/lib/oxe-alm.cjs');

// 1.21.2 — alm.transport "mcp": no token and no network in the oxe-cc. The same push / sync / move / defect decide
// WHAT to do and queue it (.oxe/program/alm-mcp-queue.json); the agent runs the queue with the MCP tools of its
// session (Jira or Azure DevOps) and reports each op with `alm ack`, which fills the same ledger as the REST path.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const STATES = { in_progress: 'Em andamento', in_review: 'Em revisão', merged: 'Na main', released: 'Lançado' };
const PRD = [
  '---', 'oxe_doc: prd', 'version: 1', '---', '', '# PRD — Envio para o celular', '',
  '## Histórias de usuário', '',
  '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |',
  '|----|------|-------|------|------------|-----------|------------|',
  '| US-1 | operador | enviar texto ao celular | não digitar duas vezes | R1 | A1 | Must |', '',
].join('\n');

function project(almBlock) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-almmcp-'));
  dirs.push(dir);
  write(dir, '.oxe/config.json', JSON.stringify({ alm: almBlock, docs_publish: false, adr: false }));
  write(dir, '.oxe/PRD.md', PRD);
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [
    { id: 'T1', title: 'enviar texto', acceptance: ['A1'], files: ['src/send.ts'] },
    { id: 'T2', title: 'status (CODE-8)', acceptance: ['A9'] },
  ] }, null, 2));
  write(dir, '.oxe/program/PROGRAM.json', JSON.stringify({ active_phase: 'F1', phases: [{ id: 'F1', status: 'executing' }] }));
  return dir;
}

const MCP_JIRA = { provider: 'jira', transport: 'mcp', program: '152code', jira: { project: 'OXE' }, labels: ['area-oxe'], fix_version: '1.5.2', states: STATES, adopt_prefixes: ['CODE'] };
const noNet = async () => { throw new Error('o modo MCP não pode chamar a rede'); };

describe('ALM via MCP: config', () => {
  it('needs no environment variable; an unknown transport is refused', () => {
    const cfg = alm.almConfig({ alm: MCP_JIRA });
    assert.equal(cfg.transport, 'mcp');
    assert.deepEqual(alm.checkConfig(cfg, {}), []);
    assert.equal(alm.almConfig({ alm: { provider: 'jira' } }).transport, 'rest');
    assert.throws(() => alm.almConfig({ alm: { provider: 'jira', transport: 'smtp' } }), /transport/);
  });
});

describe('ALM via MCP: push queues, ack links', () => {
  it('epic → story → tasks queued in order, children named by parent_ref, the label search included; nothing on the network', async () => {
    const dir = project(MCP_JIRA);
    const out = await op.runtimeAlm(dir, null, { action: 'push', env: {}, http: noNet });
    assert.deepEqual(out.queued.map((q) => q.ref), ['EPIC', 'US-1', 'F1-T1', 'F1-T2']);
    assert.equal(out.created.length, 0);
    const q = await op.runtimeAlm(dir, null, { action: 'queue' });
    assert.deepEqual(q.ops.map((o) => o.id), ['ensure:EPIC', 'ensure:US-1', 'ensure:F1-T1', 'link:F1-T1:US-1', 'ensure:F1-T2']);
    const t1 = q.ops.find((o) => o.id === 'ensure:F1-T1');
    assert.equal(t1.type, 'Task');
    assert.equal(t1.parent_ref, 'EPIC');
    assert.equal(t1.fix_version, '1.5.2');
    assert.ok(t1.labels.includes('ref-152code-F1-T1') && t1.labels.includes('area-oxe'));
    assert.equal(t1.search.jql, 'project = "OXE" AND labels in ("ref-152code-F1-T1")');
    const t2 = q.ops.find((o) => o.id === 'ensure:F1-T2');
    assert.deepEqual(t2.adopt, ['CODE-8']);
    assert.match(t2.search.jql, /"ref-CODE-8"/, 'the old code is searched too (adoption)');
    // rerun: same queue, no duplicate
    await op.runtimeAlm(dir, null, { action: 'push', env: {} });
    assert.equal((await op.runtimeAlm(dir, null, { action: 'queue' })).ops.length, 5);
  });

  it('ack with the key links it; the children then see the real parent key; the ledger feeds the PR / commit key', async () => {
    const dir = project(MCP_JIRA);
    await op.runtimeAlm(dir, null, { action: 'push', env: {} });
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'ack', ref: 'ensure:EPIC' }), /informe a chave/);
    const a = await op.runtimeAlm(dir, null, { action: 'ack', ref: 'ensure:EPIC', key: 'OXE-50' });
    assert.equal(a.done, true);
    const q = (await op.runtimeAlm(dir, null, { action: 'queue' })).ops;
    assert.equal(q.find((o) => o.id === 'ensure:F1-T1').parent, 'OXE-50');
    await op.runtimeAlm(dir, null, { action: 'ack', ref: 'US-1', key: 'OXE-51' });
    await op.runtimeAlm(dir, null, { action: 'ack', ref: 'T1', key: 'OXE-52' }); // Tn → F1-Tn
    const link = (await op.runtimeAlm(dir, null, { action: 'queue' })).ops.find((o) => o.op === 'link');
    assert.equal(link.key, 'OXE-52');
    assert.equal(link.other_key, 'OXE-51');
    assert.equal(alm.keyFor(path.join(dir, '.oxe', 'program'), alm.almConfig({ alm: MCP_JIRA }), 'F1', 'T1'), 'OXE-52');
    // a failure keeps the op, with the error
    const f = await op.runtimeAlm(dir, null, { action: 'ack', ref: 'ensure:F1-T2', error: 'MCP: 403' });
    assert.equal(f.failed, true);
    assert.equal((await op.runtimeAlm(dir, null, { action: 'queue' })).ops.find((o) => o.id === 'ensure:F1-T2').last_error, 'MCP: 403');
    // alm link by hand settles the ensure too
    await op.runtimeAlm(dir, null, { action: 'link', ref: 'T2', key: 'OXE-9' });
    assert.ok(!(await op.runtimeAlm(dir, null, { action: 'queue' })).ops.some((o) => o.id === 'ensure:F1-T2'));
    // nothing linked is re-queued by the next push
    await op.runtimeAlm(dir, null, { action: 'push', env: {} });
    assert.deepEqual((await op.runtimeAlm(dir, null, { action: 'queue' })).ops.map((o) => o.id), ['link:F1-T1:US-1']);
  });
});

describe('ALM via MCP: lifecycle', () => {
  it('sync queues one transition per item (the last stage wins, comments kept); ack records the stage; cursor advances', async () => {
    const dir = project(MCP_JIRA);
    const pdir = path.join(dir, '.oxe', 'program');
    alm.addLink(pdir, { ref: 'F1-T1', key: 'OXE-201' });
    const cfg = alm.almConfig({ alm: MCP_JIRA });
    const ev = [
      { type: 'TaskStarted', work_item_id: 'T1' },
      { type: 'TaskPromoted', work_item_id: 'T1', payload: { pr: 'https://github.com/o/r/pull/9' } },
    ];
    const r = await alm.sync(pdir, cfg, ev, { phase: 'F1' }, { http: noNet });
    assert.equal(r.moved.length, 0);
    assert.equal(r.queued.length, 2);
    let ops = alm.pendingOps(pdir);
    assert.equal(ops.length, 1);
    assert.deepEqual({ key: ops[0].key, state: ops[0].state, stage: ops[0].stage }, { key: 'OXE-201', state: 'Em revisão', stage: 'review' });
    assert.deepEqual(ops[0].comments, ['PR aberto: https://github.com/o/r/pull/9']);
    const again = await alm.sync(pdir, cfg, ev, { phase: 'F1' }, { http: noNet });
    assert.equal(again.queued.length, 0, 'cursor: the same events are not queued twice');
    alm.ack(pdir, cfg, 'transition:F1-T1');
    assert.equal(alm.readState(pdir).stages['F1-T1'], 'review');
    // a stage behind the acked one is not queued
    const back = await alm.sync(pdir, cfg, [...ev, { type: 'TaskStarted', work_item_id: 'T1' }], { phase: 'F1' }, { http: noNet });
    assert.ok(back.skipped.some((s) => /já em review/.test(s.why)));
    ops = alm.pendingOps(pdir);
    assert.equal(ops.length, 0);
  });

  it('an item still queued for creation gets its transition queued too (key filled after the ensure ack)', async () => {
    const dir = project(MCP_JIRA);
    await op.runtimeAlm(dir, null, { action: 'push', env: {} });
    const pdir = path.join(dir, '.oxe', 'program');
    await alm.sync(pdir, alm.almConfig({ alm: MCP_JIRA }), [{ type: 'TaskStarted', work_item_id: 'T1' }], { phase: 'F1' }, {});
    let t = alm.pendingOps(pdir).find((o) => o.id === 'transition:F1-T1');
    assert.ok(t && !t.key);
    alm.ack(pdir, alm.almConfig({ alm: MCP_JIRA }), 'ensure:F1-T1', { key: 'OXE-77' });
    t = alm.pendingOps(pdir).find((o) => o.id === 'transition:F1-T1');
    assert.equal(t.key, 'OXE-77');
  });

  it('move and defect queue; the auto-sync never touches the network', async () => {
    const dir = project(MCP_JIRA);
    const pdir = path.join(dir, '.oxe', 'program');
    alm.addLink(pdir, { ref: 'US-1', key: 'OXE-51' });
    const m = await op.runtimeAlm(dir, null, { action: 'move', ref: 'US-1', stage: 'merged', comment: 'na main' });
    assert.equal(m.queued, true);
    const d = await op.runtimeAlm(dir, null, { action: 'defect', ref: 'BUG-1', title: 'não chega', origin: 'US-1' });
    assert.equal(d.queued, 2);
    const ops = alm.pendingOps(pdir);
    assert.deepEqual(ops.map((o) => o.id), ['transition:US-1', 'ensure:BUG-1', 'link:BUG-1:US-1']);
    assert.ok(ops[1].labels.includes('bug'));
    assert.equal(ops[2].other_key, 'OXE-51');
    const st = await op.runtimeAlm(dir, null, { action: 'status' });
    assert.equal(st.transport, 'mcp');
    assert.equal(st.queue, 3);
  });

  it('Azure DevOps: WIQL search, User Story type, task under the story', async () => {
    const AZ = { provider: 'azure-devops', transport: 'mcp', program: 'p', azure_devops: { project: 'Proj', area_path: 'Proj\\Time' }, states: {} };
    const dir = project(AZ);
    await op.runtimeAlm(dir, null, { action: 'push', env: {} });
    const ops = alm.pendingOps(path.join(dir, '.oxe', 'program'));
    const us = ops.find((o) => o.id === 'ensure:US-1');
    assert.equal(us.type, 'User Story');
    assert.match(us.search.wiql, /\[System\.Tags\] CONTAINS 'ref-p-US-1'/);
    assert.equal(us.area_path, 'Proj\\Time');
    assert.equal(ops.find((o) => o.id === 'ensure:F1-T1').parent_ref, 'US-1');
    assert.ok(!ops.some((o) => o.op === 'link'), 'Azure: the hierarchy already ties the task to the story');
    alm.ack(path.join(dir, '.oxe', 'program'), alm.almConfig({ alm: AZ }), 'ensure:F1-T1', { key: 'AB#123' });
    assert.equal(alm.keyFor(path.join(dir, '.oxe', 'program'), alm.almConfig({ alm: AZ }), 'F1', 'T1'), 'AB#123');
  });
});
