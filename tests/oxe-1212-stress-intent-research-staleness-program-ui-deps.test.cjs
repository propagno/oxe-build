'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const stressLib = require('../bin/lib/oxe-spec-stress.cjs');
const intentLib = require('../bin/lib/oxe-intent-context.cjs');
const researchLib = require('../bin/lib/oxe-research-provenance.cjs');
const stalenessLib = require('../bin/lib/oxe-plan-staleness.cjs');
const coordLib = require('../bin/lib/oxe-coordinator-queue.cjs');
const membersLib = require('../bin/lib/oxe-program-members.cjs');
const uiEvidenceLib = require('../bin/lib/oxe-ui-evidence.cjs');
const complexityLib = require('../bin/lib/oxe-complexity.cjs');
const depsAuditLib = require('../bin/lib/oxe-deps-audit.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function write(dir, rel, content) {
  const fp = path.join(dir, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
}

function git(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function initRepo(dir) {
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@oxe.local');
  git(dir, 'config', 'user.name', 'OXE Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

describe('Round 12: upstream → midstream → downstream precision hardening', () => {
  it('spec-stress: parses fenced JSON preceded by {A1} prose, avoids same-ms overwrite, and rejects traversal in readRun', async () => {
    const parsed = stressLib.parseChanges({
      ok: true,
      text: 'Analisando {A1} antes do bloco:\n```json\n{"changes":[{"text":"Rejeitar token expirado","rationale":"segurança"}]}\n```',
    });
    assert.deepEqual(parsed, [{ text: 'Rejeitar token expirado', rationale: 'segurança' }]);
    assert.deepEqual(stressLib.chooseMethods({ id: 'A1', text: 'x' }, []), []);

    const dir = mkDir('oxe-r12-ss-');
    const reviewer = async () => ({ ok: true, text: '{"changes":[{"text":"ok","rationale":"r"}]}' });
    const [r1, r2] = await Promise.all([
      stressLib.stress(dir, { specText: '## Objetivo\nTeste', criteria: [{ id: 'A1', text: 'curto' }], methods: ['adversary'], reviewer }),
      stressLib.stress(dir, { specText: '## Objetivo\nTeste', criteria: [{ id: 'A1', text: 'curto' }], methods: ['adversary'], reviewer }),
    ]);
    assert.notEqual(r1.id, r2.id, 'concurrent/same-ms stress runs never overwrite one another');
    assert.throws(() => stressLib.readRun(dir, '../../package.json'), /id de stress inválido/);
    assert.ok(stressLib.readRun(dir).doc.id);
  });

  it('intent-context: matches src/**/*.ts against 0-subdir src/index.ts, normalizes Windows/object paths, subcriteria, and symbol fences', () => {
    const items = intentLib.build(
      {
        id: 'T1',
        files: [{ path: '.\\src\\index.ts' }],
        acceptance: ['A19.1'],
        verify: 'npm test',
      },
      {
        decisions: [{ id: 'D-1', title: 'Auth stateless', criteria: ['A19'] }],
        policyRules: [
          { id: 'ts-all', forbid: 'eval', paths: ['src/**/*.ts'], message: 'sem eval em TS' },
          { id: 'global-empty', forbid: 'debugger', paths: [], message: 'sem debugger' },
        ],
        criteriaText: { A19: 'Sessão expira com segurança' },
        packEntry: { symbols: [{ name: 'boot', file: '.\\src\\index.ts' }] },
      },
    );
    assert.ok(items.some((x) => x.type === 'decision' && x.id === 'D-1'));
    assert.ok(items.some((x) => x.type === 'rule' && x.id === 'ts-all' && x.why === 'a regra cobre arquivos da tarefa'));
    assert.ok(items.some((x) => x.type === 'rule' && x.id === 'global-empty' && x.why === 'regra global'));
    assert.ok(items.some((x) => x.type === 'criterion' && x.id === 'A19.1' && /Sessão expira/.test(x.text)));
    assert.ok(items.some((x) => x.type === 'symbol' && x.pointer === 'src/index.ts#boot'));

    const warnings = intentLib.lint(
      { tasks: [{ id: 'T0', superseded: true, description: '```js\nx\n```' }] },
      { entries: [{ task: 'T1', symbols: [{ name: 'boot', snippet: '```ts\nconst x = 1;\n```' }] }] },
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /pack T1 símbolo boot\.snippet copiado/);
  });

  it('research-provenance: handles numbered/### headings, multiline sourced claims, bold assumptions, notes/assumptions arrays, and skips fenced bullets', () => {
    const dir = mkDir('oxe-r12-rp-');
    write(
      dir,
      '.oxe/research/01-api.md',
      [
        '# Pesquisa API',
        '## 1. Afirmações (Claims)',
        '- O endpoint devolve 200',
        '  [fonte: src/api.ts:42]',
        '```sh',
        '- linha de output que não é afirmação',
        '```',
        '### 2. Suposições',
        '- **S1**: latência abaixo de 50ms',
        '- `S2` — cache local ativo',
      ].join('\n'),
    );
    const note = researchLib.parseNote(fs.readFileSync(path.join(dir, '.oxe/research/01-api.md'), 'utf8'));
    assert.equal(note.claims.length, 1);
    assert.equal(note.claims[0].sourced, true);
    assert.deepEqual(note.assumptions.map((a) => a.id), ['S1', 'S2']);

    const w1 = researchLib.lintResearch(dir, {
      tasks: [
        { id: 'T1', notes: 'Depende de S1 e S2' },
        { id: 'T2', status: 'done', notes: 'Usa S2' },
      ],
      risks: [{ id: 'R1', assumptions: ['S1'] }],
    });
    assert.equal(w1.length, 1);
    assert.match(w1[0], /T1 usa a suposição S2/);
  });

  it('plan-staleness: recognizes subphase F2.1/T1 and multi-task together checkpoints, skips status:done/superseded, and supports acceptanceTests', () => {
    const dir = mkDir('oxe-r12-ps-');
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, 'src/a.js', '1\n');
    write(dir, 'src/b.js', '1\n');
    write(dir, 'tests/a1.test.js', '1\n');
    initRepo(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    write(dir, 'src/a.js', '2\n');
    write(dir, 'src/b.js', '2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: wave 1 together', '-m', 'OXE-Task: F2.1/T1\nOXE-Task: F2.1/T2');

    const doc = {
      base_sha: base,
      tasks: [
        { id: 'T1', status: 'done', files: ['src/a.js'], acceptance: ['A1.1'] },
        { id: 'T2', files: [{ path: './src/b.js' }], acceptance: ['A1.1'] },
      ],
      acceptanceTests: [{ criterion: 'A1', files: ['tests/a1.test.js'] }],
    };
    assert.deepEqual(stalenessLib.staleness(dir, doc, null).stale, []);

    write(dir, 'tests/a1.test.js', 'changed externally\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'chore: external test edit');
    const st = stalenessLib.staleness(dir, doc, null).stale;
    assert.deepEqual(st, [{ task: 'T2', file: 'tests/a1.test.js', why: 'o teste congelado mudou depois do plano' }]);
  });

  it('coordinator-queue & program-members: handles singular role, subcriteria, uppercase severity, status:done, unborn member repos, and member order preservation', () => {
    const q = coordLib.build({
      program: {
        active_phase: 'F1',
        phases: [
          { id: 'F1', status: 'executing', acceptance: ['A1'] },
          { id: 'F2', status: 'pending', acceptance: ['A2.1'], dependsOn: ['F1'] },
        ],
      },
      doc: {
        tasks: [
          { id: 'T1', title: 'api', wave: 1, role: 'backend', acceptance: ['A1'] },
          { id: 'T2', title: 'old', wave: 1, role: 'frontend', status: 'done', acceptance: ['A1'] },
          { id: 'T3', title: 'done-other', wave: 1, role: 'dba', status: 'done', acceptance: ['A9'] },
        ],
        acceptanceTests: [{ criterion: 'A2', files: ['t.js'] }],
      },
      changes: [
        { id: 'CR-1', status: 'open', class: 'defect', severity: 'LOW', criteria: ['A1.1'], summary: 'baixa' },
        { id: 'CR-2', status: 'open', class: 'defect', severity: 'CRITICAL', criteria: ['A1.1'], summary: 'alta' },
      ],
    });
    assert.deepEqual(q.roles.backend.map((x) => x.ref), ['CR-2', 'CR-1', 'T1']);
    assert.deepEqual(q.roles.frontend.map((x) => x.ref), ['CR-2', 'CR-1'], 'status:done task excluded while open CRs on A1.1 reach its role');
    assert.equal(q.roles.dba, undefined, 'status:done task without open CR produces no queue item');
    assert.equal(q.roles.qa, undefined, 'A2 parent frozen covers A2.1');

    const top = mkDir('oxe-r12-pm-');
    const coord = path.join(top, 'coord');
    const unborn = path.join(top, 'unborn');
    fs.mkdirSync(coord, { recursive: true });
    fs.mkdirSync(unborn, { recursive: true });
    initRepo(coord);
    initRepo(unborn);
    const prog = { members: [] };
    membersLib.add(coord, prog, { name: 'svc', path: '../unborn', order: 5 });
    membersLib.add(coord, prog, { name: 'svc', path: '../unborn', branch: 'develop' });
    assert.equal(prog.members[0].order, 5, 're-adding member without --order preserves existing order');
    assert.equal(prog.members[0].branch, 'develop');
    const closeRes = membersLib.closeMembers(coord, prog);
    assert.equal(closeRes.ok, false);
    assert.match(closeRes.reason, /ainda não tem commit em HEAD/);
    const lintErrs = membersLib.lint(
      { tasks: [{ id: 'T1', files: [{ path: 'svc:src/a.ts' }] }, { id: 'T2', superseded: true, repo: 'ghost', files: ['x.ts'] }] },
      prog,
    );
    assert.equal(lintErrs.length, 1);
    assert.match(lintErrs[0], /T1: a tarefa toca mais de um repositório/);
  });

  it('ui-evidence: blocks path traversal, NaN diff_ratio, missing/array a11y violations, and reads G*/subcriteria standing UI rows', () => {
    const dir = mkDir('oxe-r12-ui-');
    const pkgDir = path.join(dir, 'hml');
    write(dir, 'secret.png', 'outside');
    write(pkgDir, 'ok.png', 'img');
    write(pkgDir, 'base.png', 'img');
    write(pkgDir, 'a11y.json', '{}');
    write(
      pkgDir,
      'ui-evidence.json',
      JSON.stringify({
        schema: 1,
        sha: 'ABCDEF1234',
        matrix: { locale: ['pt-BR'], theme: ['dark'], os: ['windows'] },
        runs: [
          {
            locale: 'pt-BR',
            theme: 'dark',
            os: 'windows',
            steps: [{ action: 'goto', value: '/' }],
            captures: [
              { state: 's1', file: '../secret.png', baseline: 'base.png', diff_ratio: 'not-a-number' },
            ],
            a11y: [{ state: 's1', file: 'a11y.json', violations: [{ id: 'color-contrast' }] }],
          },
        ],
      }),
    );
    const v = uiEvidenceLib.validate(pkgDir, { head: 'abcdef1234567890' });
    assert.equal(v.ok, false);
    const joined = v.errors.join('\n');
    assert.doesNotMatch(joined, /avaliou outro commit/, 'case-insensitive sha prefix matches');
    assert.match(joined, /escapa da pasta do pacote/);
    assert.match(joined, /diff visual inválido/);
    assert.match(joined, /1 violação\(ões\) de acessibilidade/);

    const standing = uiEvidenceLib.uiStandingCriteria(
      { ui_evidence: { standing: true } },
      ['G1', 'A70.1'],
      '| G1 | Layout responsivo \\| acessível na tela inicial | HML |\n| A70 | Botão visível | HML |\n',
    );
    assert.deepEqual(standing, ['G1', 'A70.1']);
  });

  it('complexity & deps-audit: Kotlin nullable types do not inflate complexity while Elvis/when count; workspace/alias/shell-unsafe deps handled safely', () => {
    const kt = [
      'fun render(a: String?, b: Int?, c: List<String?>) {',
      '  val x: String? = a as? String',
      '  val y = x ?: "fallback"',
      '  when (b) { 1 -> println(y) }',
      '}',
    ].join('\n');
    const fns = complexityLib.functionsOf(kt, 'src/App.kt');
    assert.equal(fns.length, 1);
    assert.equal(fns[0].complexity, 3, 'base 1 + Elvis ?: + when = 3 (nullable String? and as? ignored)');

    const dir = mkDir('oxe-r12-deps-');
    write(dir, 'package.json', JSON.stringify({ name: 'p', dependencies: { lodash: '^4.0.0' } }));
    write(dir, 'package-lock.json', JSON.stringify({ packages: { '': { name: 'p' } } }));
    write(
      dir,
      'src/Overload.kt',
      `fun parse(s: String) {\n${Array.from({ length: 18 }, (_, i) => `  if (s == "${i}") return`).join('\n')}\n}\nfun parse(n: Int) {\n  return\n}\n`,
    );
    initRepo(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    // Touch Overload.kt without increasing overload 1's complexity
    write(
      dir,
      'src/Overload.kt',
      `// touched\nfun parse(s: String) {\n${Array.from({ length: 18 }, (_, i) => `  if (s == "${i}") return`).join('\n')}\n}\nfun parse(n: Int) {\n  return\n}\n`,
    );
    assert.deepEqual(complexityLib.complexityAlarms(dir, base, { profile: 'strict' }).alarms, []);

    write(
      dir,
      'package.json',
      JSON.stringify({
        name: 'p',
        dependencies: {
          lodash: '^4.0.0',
          '@oxe/internal': 'workspace:*',
          'local-pkg': 'file:../local',
          'http-alias': 'npm:axois@^1.0.0',
          'bad;echo pwn': '1.0.0',
        },
      }),
    );
    write(dir, 'package-lock.json', JSON.stringify({ packages: { '': { name: 'p' }, 'node_modules/axois': { version: '1.0.0' } } }));
    const regCalls = [];
    const res = depsAuditLib.auditDeps(dir, base, {
      registry: (name) => {
        regCalls.push(name);
        return true;
      },
      audit: (lock) => (lock.includes('axois') ? { 'x:1': { name: 'x', severity: 'CRITICAL', id: 'GHSA-1' } } : {}),
    });
    assert.deepEqual(regCalls, ['axois'], 'workspace/file skipped; invalid shell name rejected before registry; npm: alias unwrapped');
    assert.deepEqual(res.missing, ['bad;echo pwn']);
    assert.deepEqual(res.lookalikes, [{ name: 'http-alias', like: 'axios' }]);
    assert.ok(res.blocks.some((b) => /advisory CRITICAL nova/.test(b)));
  });
});
