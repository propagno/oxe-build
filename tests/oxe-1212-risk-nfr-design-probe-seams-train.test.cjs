'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const riskLib = require('../bin/lib/oxe-risk-decision.cjs');
const nfrLib = require('../bin/lib/oxe-nfr.cjs');
const designLib = require('../bin/lib/oxe-system-design.cjs');
const probeLib = require('../bin/lib/oxe-spec-probe.cjs');
const apiLib = require('../bin/lib/oxe-api-surface.cjs');
const seamsLib = require('../bin/lib/oxe-seams.cjs');
const defectsLib = require('../bin/lib/oxe-open-defects.cjs');
const trainLib = require('../bin/lib/oxe-merge-train.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkDir(prefix = 'oxe-1212-r11-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

describe('Round 11 — risk-decision camelCase acceptanceTests, subcriteria, escaped pipes & subphase waivers', () => {
  it('reads subcriteria/global risks with escaped pipes, ignores non-criteria ID tables, and honors camelCase acceptanceTests', () => {
    const spec = [
      '# SPEC',
      '',
      '| ID | Risco | Mitigação |',
      '|---|---|---|',
      '| A1 | P3 | tabela de riscos narrativa — não é tabela de critérios |',
      '',
      '## Critérios de aceite',
      '| **ID** | **Critério** | **Risco** | **Como verificar** |',
      '|---|---|---|---|',
      '| **A19.1** | filtro `a \\| b` | **P0** | teste |',
      '| A19.2 | ordenação | P2 | teste |',
      '| G1 | invariante global | P1 | gate |',
    ].join('\n');

    const risks = riskLib.criterionRisks(spec);
    assert.deepEqual([...risks], [['A19.1', 'P0'], ['A19.2', 'P2'], ['G1', 'P1']]);

    const dir = mkDir();
    const pdir = path.join(dir, '.oxe', 'program');
    const w = riskLib.addWaiver(pdir, { criteria: 'A19.2', by: 'po', reason: 'fica para a subfase F2.1', until: 'F2.1' });
    assert.equal(w[0].until, 'F2.1');

    // Normalized PLAN.json uses camelCase `acceptanceTests` and phase acceptance lists parent `A19`.
    const out = riskLib.decide({
      phase: { id: 'F1', acceptance: ['A19', 'G1'] },
      program: { phases: [{ id: 'F1' }, { id: 'F2.1' }] },
      specText: spec,
      doc: {
        tasks: [{ id: 'T1', acceptance: ['A19.1', 'A19.2', 'G1'] }],
        acceptanceTests: [
          { criterion: 'A19.1', files: ['t1.js'], command: 'node -e 0' },
          { criterion: 'A19.2', files: ['t2.js'], command: 'node -e 0' },
        ],
      },
      verifyCompleted: true,
      signoffs: [{ phase: 'F1', criteria: ['g1'], evidence: 'docs/g1.md' }],
      waivers: [],
      config: {},
    });
    assert.equal(out.decision, 'PASS');
    assert.equal(out.rows.find((r) => r.criterion === 'A19').risk, 'P0', 'parent inherits worst subcriterion risk');
  });
});

describe('Round 11 — NFR ANSI stripping, metric left boundary, subcriteria & zero-median regression', () => {
  it('strips ANSI CSI sequences, avoids matching max_latency for latency, and catches 0 -> N regressions', () => {
    assert.equal(nfrLib.parseValue('max_latency=5000\nlatency=120\n', 'latency'), 120);
    assert.equal(nfrLib.parseValue('\u001b[32mtook 145 ms\u001b[39m\n', 'startup_ms'), 145);

    const dir = mkDir();
    const pdir = path.join(dir, '.oxe', 'program');
    nfrLib.declare(pdir, 'A12.1', { metric: 'errors', method: 'node check.js', threshold: '<=5', samples: 2 });

    const f1 = nfrLib.measure(dir, pdir, 'A12.1', { phase: 'F1', run: () => ({ ok: true, stdout: 'errors=0\n' }) });
    assert.equal(f1.pass, true);
    assert.equal(f1.median, 0);

    const f2 = nfrLib.measure(dir, pdir, 'A12.1', { phase: 'F2', run: () => ({ ok: true, stdout: 'errors=2\n' }) });
    assert.equal(f2.pass, true, 'still within <=5 threshold');
    assert.ok(f2.regression, '0 -> 2 errors must be flagged as regression even inside threshold');
    assert.equal(f2.regression.from, 0);
    assert.equal(f2.regression.to, 2);
  });
});

describe('Round 11 — system-design R-RB/subcriteria parsing & safe regex/Mermaid labels', () => {
  it('handles dirs with regex/Mermaid special chars (c++, @core) and links R-RB + A19.1 + G1', () => {
    const dir = mkDir();
    const spec = [
      '| R-ID | Requisito | Versão | Critério de aceite |',
      '|---|---|---|---|',
      '| **R-RB-01** | O módulo `@core` valida `a \\| b` | v1 | A19.1, G1 |',
    ].join('\n');
    const md = designLib.build(dir, { specText: spec, dirs: ['packages/@core', 'native/c++'] });
    assert.match(md, /id=component\/packages\/-core paths=packages\/@core\/\*\* ids=R-RB-01,A19\.1,G1/);
    assert.match(md, /c0\["packages\/@core"\]/);
    assert.match(md, /c1\["native\/c\+\+"\]/);
  });
});

describe('Round 11 — spec-probe subcriteria, CRLF preservation & exact assumption boundary (A1.e1 vs A1.e10)', () => {
  it('preserves CRLF, supports A19.1 with escaped pipes, and does not confuse A19.1.e1 with A19.1.e10', () => {
    const specCrlf = [
      '# SPEC',
      '',
      '## Critérios de aceite',
      '',
      '| ID | Critério | Como verificar |',
      '|---|---|---|',
      '| **A19.1** | Salvar filtro `a \\| b` no formulário | teste |',
    ].join('\r\n');

    const res = probeLib.writeProbe(specCrlf);
    assert.ok(res.text.includes('\r\n') && !/(?<!\r)\n/.test(res.text), 'CRLF preserved');
    assert.ok(res.edges.some((e) => e.id === 'A19.1.e1'));

    // Plan only declares A19.1.e10 — A19.1.e1 must still warn!
    const lint = probeLib.lintProbe(res.text, { assumptions: ['A19.1.e10: falso irmão'] });
    assert.ok(lint.warnings.some((w) => w.startsWith('A19.1.e1: borda aberta sem suposição')), lint.warnings.join('\n'));
  });
});

describe('Round 11 — api-surface, seams, open-defects & merge-train precision', () => {
  it('api-surface ignores commented exports and accepts string symbol lists; seams handles braces in strings, $-exports, multi-task trailers & 4-col SPEC', () => {
    const surface = apiLib.surfaceOf([
      '// export function ghost() {}',
      '/* ipcMain.handle("fake:chan", () => {}) */',
      'export const $store = (x) => x;',
      'ipcMain.handle("real:chan", () => "https://example.com");',
    ].join('\n'));
    assert.deepEqual([...surface.keys()].sort(), ['export:$store', 'ipc:real:chan']);

    // Brace inside string literal must not break bodiesOf duplicate helper detection:
    const fnWithBraceString = (name) => [
      `export function ${name}(items) {`,
      '  const sep = "{";',
      '  const out = [];',
      '  for (const it of items) {',
      '    if (it) out.push(sep + it);',
      '  }',
      '  return out;',
      '}',
    ].join('\n');
    const b1 = seamsLib.bodiesOf(fnWithBraceString('alpha'));
    const b2 = seamsLib.bodiesOf(fnWithBraceString('beta'));
    assert.equal(b1.length, 1);
    assert.equal(b1[0].hash, b2[0].hash);

    // 4-column SPEC template (| ID | Critério | Risco | Como verificar |) + parent phase criterion A19:
    const spec4Col = [
      '| ID | Critério | Risco | Como verificar |',
      '|---|---|---|---|',
      '| A19.1 | login completo | P0 | executar o fluxo de ponta a ponta |',
      '| A19.2 | unitário | P2 | `npm test` |',
    ].join('\n');
    assert.deepEqual(seamsLib.behaviorCriteriaFromSpec(spec4Col, ['A19']), ['A19.1']);

    // Integration repo for seams ($store consumer + multi-OXE-Task trailer) and open-defects (.oxe exclusion + status:'done'):
    const dir = mkDir();
    write(dir, 'src/store.js', 'export function $store(a, b) { return a + b; }\n');
    write(dir, 'src/view.js', "import { $store } from './store';\nexport const v = $store(1, 2);\n");
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    write(dir, 'src/store.js', 'export function $store(a) { return a; }\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'T1 store', '-m', 'OXE-Task: F2.1/T1');

    write(dir, 'src/view.js', "import { $store } from './store';\nexport const v = $store(1);\n");
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'T2+T3 batch', '-m', 'OXE-Task: F2.1/T2\nOXE-Task: F2.1/T3');

    const diff = apiLib.apiDiff(dir, base, { tasks: [{ id: 'T1', symbols: ['$store'] }] });
    assert.equal(diff.flagged.length, 0, 'string symbol list in pack is honored');

    const seamRep = seamsLib.seamsReport(dir, base, { phase: 'F2.1' });
    assert.equal(seamRep.export_consumers.length, 1);
    assert.equal(seamRep.export_consumers[0].export, '$store');
    assert.deepEqual(seamRep.export_consumers[0].consumers[0].tasks.sort(), ['T2', 'T3']);

    // Untracked file under .oxe/ must NOT be scanned by open-defects, while status:'done' task without verify & subcriterion standing CR ARE caught:
    write(dir, '.oxe/scratch.js', '// TODO: internal note inside .oxe\n');
    const defDoc = defectsLib.collect(dir, {
      phase: 'F2.1',
      base,
      doc: { tasks: [{ id: 'T9', title: 'sem verify', status: 'done' }] },
      standing: ['A70'],
      changes: [{ id: 'CR-9', status: 'open', summary: 'quebra A70.1', criteria: ['A70.1'] }],
    });
    assert.ok(!defDoc.items.some((it) => it.file && it.file.startsWith('.oxe/')), '.oxe/ untracked ignored');
    assert.ok(defDoc.items.some((it) => it.kind === 'verify_missing' && it.task === 'T9'));
    assert.ok(defDoc.items.some((it) => it.kind === 'standing_cr' && it.cr === 'CR-9'));
  });

  it('merge-train takes the last directive in multi-line comments and resyncs even when item.branch is currently checked out', () => {
    const st = trainLib.trainState({
      state: 'OPEN',
      comments: [{ body: 'merge-train: queued\nmerge-train: car 1\nmerge-train: removed (flake)' }],
    });
    assert.equal(st.state, 'left');

    const remote = mkDir('oxe-1212-r11-rem-');
    git(remote, 'init', '-q', '--bare');
    const dir = mkDir('oxe-1212-r11-wt-');
    write(dir, 'a.js', '1\n');
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'remote', 'add', 'origin', remote);
    git(dir, 'push', '-q', 'origin', 'main');

    // Keep `oxe/t1` checked out in `dir` while main advances on origin!
    git(dir, 'checkout', '-qb', 'oxe/t1');
    write(dir, 't1.js', 'ok\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 't1');
    git(dir, 'push', '-q', 'origin', 'oxe/t1');

    const other = mkDir('oxe-1212-r11-main-');
    git(other, 'clone', '-q', remote, '.');
    git(other, 'config', 'user.email', 't@t');
    git(other, 'config', 'user.name', 't');
    write(other, 'main2.js', '2\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-qm', 'main2');
    git(other, 'push', '-q', 'origin', 'main');

    const spawn = (cmd, args, opts) => (cmd === 'gh' ? { status: 0, stdout: '{}' } : spawnSync(cmd, args, opts));
    const res = trainLib.resync({
      root: dir,
      item: { task: 'T1', branch: 'oxe/t1', base: 'main', state: 'left', url: 'https://github.com/o/r/pull/1' },
      verifyCommand: 'node -e 0',
      spawn,
    });
    assert.equal(res.ok, true, JSON.stringify(res));
  });
});
