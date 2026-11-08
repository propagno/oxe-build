'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const refs = require('../bin/lib/oxe-artifact-refs.cjs');

// 1.21.2 — OXB-032: the oxespace ignores .oxe/; the team copied SPEC and ROADMAP to docs/roadmap-1.5/oxe/ by hand for
// review (3 times in one day) and the copies diverged from what the runtime ran.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const SPEC = '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a base | manual |\n| A2 | o resto | manual |\n';
const ROADMAP = '# Roteiro\n\n## Fase 1 — Base\n\n**Requisitos:** R1\n**Critérios de aceite:** A1\n**Escopo:** base\n\n## Fase 2 — Resto\n\n**Critérios de aceite:** A2\n';

function project(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-refs-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'roadmap', 'oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(dir, 'docs', 'roadmap', 'oxe', 'SPEC.md'), SPEC);
  fs.writeFileSync(path.join(dir, 'docs', 'roadmap', 'oxe', 'ROADMAP.md'), ROADMAP);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const cfg = { spec_ref: 'docs/roadmap/oxe/SPEC.md', roadmap_ref: 'docs/roadmap/oxe/ROADMAP.md' };

describe('OXB-032: SPEC and ROADMAP from versioned paths', () => {
  it('program init reads the ROADMAP ref; spec add writes into the SPEC ref (not a .oxe/ copy)', () => {
    const dir = project(cfg);
    const st = op.runtimeProgramInit(dir, null, {});
    assert.deepEqual(st.state.phases.map((p) => p.id), ['F1', 'F2']);
    assert.equal(st.state.roadmap_ref, 'docs/roadmap/oxe/ROADMAP.md');
    op.runtimeSpecAdd(dir, null, { kind: 'criterion', id: 'A3', text: 'mais um', verify: 'manual', by: 'tl', reason: 'emenda do review' });
    assert.match(fs.readFileSync(path.join(dir, 'docs', 'roadmap', 'oxe', 'SPEC.md'), 'utf8'), /\| A3 \| mais um \| manual \|/);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'SPEC.md')), 'no .oxe/ copy is created');
  });

  it('export into the ref dir does not copy a file onto itself; without refs nothing changes', () => {
    const dir = project({ ...cfg, program: { export_dir: 'docs/roadmap/oxe' } });
    op.runtimeProgramInit(dir, null, {});
    const out = op.runtimeProgramExport(dir, null, {});
    assert.ok(out.written.includes('docs/roadmap/oxe/PROGRAM.json'));
    assert.equal(fs.readFileSync(path.join(dir, 'docs', 'roadmap', 'oxe', 'SPEC.md'), 'utf8'), SPEC);
    const plain = project({});
    fs.writeFileSync(path.join(plain, '.oxe', 'ROADMAP.md'), ROADMAP);
    assert.equal(op.runtimeProgramInit(plain, null, {}).state.roadmap_ref, '.oxe/ROADMAP.md');
  });

  it('doctor: a missing ref and a diverging .oxe/ copy are warnings', () => {
    const dir = project({ ...cfg, roadmap_ref: 'docs/nope/ROADMAP.md' });
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), SPEC.replace('o resto', 'outro texto'));
    const w = refs.refWarnings(dir).join('\n');
    assert.match(w, /roadmap_ref aponta para docs\/nope\/ROADMAP\.md, que não existe/);
    assert.match(w, /\.oxe\/SPEC\.md diverge de docs\/roadmap\/oxe\/SPEC\.md \(o runtime lê docs\/roadmap\/oxe\/SPEC\.md\)/);
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), SPEC.replace(/\n/g, '\r\n'));
    assert.doesNotMatch(refs.refWarnings(dir).join('\n'), /diverge/, 'only CRLF differs: same content');
  });

  it('status sees the SPEC through the ref (no "SPEC.md ausente" block)', () => {
    const dir = project(cfg);
    const r = spawnSync(process.execPath, [CLI, 'status', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.doesNotMatch(r.stdout, /SPEC\.md ausente/);
  });
});
