'use strict';

// 1.21.2 — revisão de 21/11 do motor de próximo passo (achados 2, 3, 4, 5, 8). Os achados 1 e 6 (quick × delivery.mode)
// estão em oxe-1212-journey-e2e.test.cjs; o 7 (grill --card isolado) em oxb-c20-dogfooding-gaps.test.cjs.
// Sem rede: nenhum ALM, nenhum gh real (spawn fake onde o código chamaria git/gh remoto).

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const health = require('../bin/lib/oxe-project-health.cjs');
const journey = require('../bin/lib/oxe-journey.cjs');
const rfcLib = require('../bin/lib/oxe-rfc.cjs');
const quick = require('../bin/lib/oxe-quick.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const NO_ALM_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(JIRA_|AZURE_|AZDO_|OXE_ALM_)/i.test(k))), NO_COLOR: '1', OXE_NO_PROMPT: '1' };
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

const SPEC = [
  '# SPEC — Envio para o celular', '', '## Requisitos', '',
  '| R-ID | Requisito | Versão | Critério de aceite |', '|---|---|---|---|', '| R1 | enviar texto | v1 | A1, A2 |', '',
  '## Critérios de aceite', '',
  '| ID | Critério | Risco | Como verificar |', '|---|---|---|---|',
  '| A1 | o Envio chega ao celular | P2 | node -e 1 |', '| A2 | erro claro quando offline | P2 | node -e 1 |', '',
  '## Suposições', '', '- nenhuma', '',
].join('\n');
const ROADMAP2 = '# Roteiro\n\n## Fase 1 — Envio\n\n**Requisitos:** R1\n**Critérios de aceite:** A1\n**Escopo:** envio\n\n## Fase 2 — Erros\n\n**Requisitos:** R1\n**Critérios de aceite:** A2\n**Escopo:** offline\n';
const ROADMAP1 = '# Roteiro\n\n## Fase 1 — Envio\n\n**Requisitos:** R1\n**Critérios de aceite:** A1, A2\n**Escopo:** envio\n';

function project(config = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-r2111-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const cli = (...a) => spawnSync(process.execPath, [CLI, ...a, '--dir', dir], { encoding: 'utf8', env: NO_ALM_ENV });
  assert.equal(cli('init-oxe').status, 0, 'init-oxe');
  if (config) {
    const f = path.join(dir, '.oxe', 'config.json');
    const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    fs.writeFileSync(f, JSON.stringify({ ...cur, adr: false, ...config }, null, 2));
  }
  return { dir, cli };
}

describe('achado 4: sem grill, ROADMAP de 2+ fases pede a aprovação e depois o program init', () => {
  it('/oxe-spec --fast (sem grill) + ROADMAP de 2 fases → spec-approve → program-init, nunca direto ao /oxe-plan', () => {
    const { dir, cli } = project();
    write(dir, '.oxe/SPEC.md', SPEC);
    write(dir, '.oxe/ROADMAP.md', ROADMAP2);
    let s = health.suggestNextStep(dir, {});
    assert.equal(s.step, 'spec-approve', JSON.stringify(s));
    assert.equal(s.cursorCmd, 'oxe-cc spec approve --by <papel> --fast', s.reason);
    assert.match(s.reason, /ROADMAP com 2 fases/);
    const ap = cli('spec', 'approve', '--by', 'po', '--fast');
    assert.equal(ap.status, 0, ap.stdout + ap.stderr);
    s = health.suggestNextStep(dir, {});
    assert.equal(s.step, 'program-init', JSON.stringify(s));
  });

  it('ROADMAP de 1 fase sem grill continua indo ao plano (sem cerimônia extra)', () => {
    const { dir } = project();
    write(dir, '.oxe/SPEC.md', SPEC);
    write(dir, '.oxe/ROADMAP.md', ROADMAP1);
    assert.equal(health.suggestNextStep(dir, {}).step, 'plan');
  });
});

describe('achado 5: RFC global', () => {
  const RISKY_SPEC = SPEC.replace('| A1 | o Envio chega ao celular | P2 |', '| A1 | o Envio chega ao celular | P0 |');
  const setStatus = (file, status) => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^- \*\*Status:\*\*.*$/m, `- **Status:** ${status}`));

  it('rfcCoverage: o rascunho global só conta quando o RFC é exigido', () => {
    const rfcs = [{ id: 'RFC-1', phase: null, status: 'draft' }];
    assert.equal(journey.rfcCoverage(rfcs, 'F1', [], { required: false }).draft, null);
    assert.equal(journey.rfcCoverage(rfcs, 'F1', [], { required: true }).draft.id, 'RFC-1');
    // o rascunho da própria fase espera a decisão sempre
    assert.equal(journey.rfcCoverage([{ id: 'RFC-F1-1', phase: 'F1', status: 'draft' }], 'F1', [], { required: false }).draft.id, 'RFC-F1-1');
  });

  it('advisory: um rascunho global não bloqueia o planejamento da fase', () => {
    const { dir } = project();
    write(dir, '.oxe/SPEC.md', RISKY_SPEC);
    rfcLib.create(dir, { title: 'proposta geral de envio' });
    assert.equal(journey.rfcStep(dir, null, { id: 'F1', acceptance: ['A1'] }, {}), null);
  });

  it('risk: RFC global aceito que não cita o A* P0 → o passo nomeia o critério que falta (não um rfc new cego)', () => {
    const { dir } = project({ rfc: { required: 'risk' } });
    write(dir, '.oxe/SPEC.md', RISKY_SPEC);
    const r = rfcLib.create(dir, { title: 'proposta geral de envio' });
    setStatus(r.file, 'aceito (2026-11-21)');
    const s = journey.rfcStep(dir, null, { id: 'F1', acceptance: ['A1'] }, {});
    assert.equal(s.step, 'rfc', JSON.stringify(s));
    assert.match(s.reason, /RFC-1 \(aceito, global\) não cita o\(s\) critério\(s\) de risco A1/);
    assert.ok(!/rfc new --title/.test(s.cursorCmd), s.cursorCmd);
    // citado → cobre
    const cites = [{ id: 'RFC-1', phase: null, status: 'accepted', motivation: 'Cobre A1 (P0).' }];
    assert.equal(journey.rfcCoverage(cites, 'F1', ['A1'], { required: true }).accepted.id, 'RFC-1');
    assert.deepEqual(journey.rfcCoverage([{ ...cites[0], motivation: 'outra coisa' }], 'F1', ['A1', 'A2'], { required: true }).uncited.missing, ['A1', 'A2']);
  });

  it('risk: RFC recusado → decidir a alternativa (/oxe-discuss --rfc), não rfc new em laço', () => {
    const { dir } = project({ rfc: { required: 'risk' } });
    write(dir, '.oxe/SPEC.md', RISKY_SPEC);
    const r = rfcLib.create(dir, { title: 'proposta geral de envio' });
    rfcLib.reject(dir, r.id, { reason: 'custo alto demais' });
    const s = journey.rfcStep(dir, null, { id: 'F1', acceptance: ['A1'] }, {});
    assert.equal(s.step, 'rfc', JSON.stringify(s));
    assert.equal(s.cursorCmd, '/oxe-discuss --rfc');
    assert.match(s.reason, /RFC-1 foi recusado/);
  });
});

describe('achado 2: quick promote confere a origem do range certo', () => {
  it('check-origin recebe target base..HEAD e a reprovação conta as violations', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-r2111-q-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe', 'quick'), { recursive: true });
    const id = 'Q-20261121-abcd';
    fs.writeFileSync(path.join(dir, '.oxe', 'quick', `${id}.json`), JSON.stringify({ schema: 1, id, key: null, objective: 'ajustar o texto', status: 'done', commits: [{ sha: 'a'.repeat(40), subject: 'fix: texto' }], started_at: '2026-11-21T10:00:00Z', closed_at: '2026-11-21T10:10:00Z' }));
    const seen = [];
    const spawn = (cmd, args) => {
      seen.push([cmd, ...args]);
      if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: 'fix/texto\n', stderr: '' };
      // um commit sem trailer de origem no range
      if (cmd === 'git' && args[0] === 'log' && String(args[1]).startsWith('--format=%H%x1f')) return { status: 0, stdout: `${'b'.repeat(40)}\x1f${'c'.repeat(40)}\x1fDev\x1fdev@example.invalid\x1f2026-11-21T10:05:00Z\x1f2026-11-21T10:05:00Z\x1fchore: sem origem\x1e`, stderr: '' };
      if (cmd === 'git' && args[0] === 'show') return { status: 0, stdout: 'src/a.ts\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    assert.throws(() => quick.promote(dir, { id, openPr: true, base: 'main', spawn }), /reprovou 1 commit\(s\) sem origem/);
    assert.ok(seen.some((c) => c[0] === 'git' && c[1] === 'log' && c.includes('main..HEAD')), 'o range é base..HEAD');
    assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'reprovado: nada de push');
  });
});

describe('achado 3 e 8: sessões', () => {
  it('session create: id de card fica como está, sem aviso de formato; SESSIONS.md criado com a linha', () => {
    const { dir, cli } = project();
    const c = cli('session', 'create', 'OXE-294', '--json');
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.equal(JSON.parse(c.stdout).active_session, 'sessions/OXE-294');
    const index = fs.readFileSync(path.join(dir, '.oxe', 'SESSIONS.md'), 'utf8');
    assert.match(index, /\| OXE-294 \| OXE-294 \| active \|.*`sessions\/OXE-294` \|/);
    const state = fs.readFileSync(path.join(dir, '.oxe', 'STATE.md'), 'utf8');
    assert.equal(health.parseActiveSession(state), 'sessions/OXE-294');
    const report = health.buildHealthReport(dir);
    const all = JSON.stringify(report);
    assert.ok(!/não segue o formato sessions\/sNNN-slug/.test(all), 'id de card sem aviso de formato');
    assert.ok(!/SESSIONS\.md não existe/.test(all), 'índice criado');
  });

  it('session create com id livre gera sNNN-<slug>; switch pelo slug acha; o índice atualiza sem duplicar', () => {
    const { dir, cli } = project();
    const c = cli('session', 'create', 'cache', '--json');
    assert.equal(c.status, 0, c.stdout + c.stderr);
    const out = JSON.parse(c.stdout);
    assert.equal(out.id, 's001-cache');
    assert.equal(out.requested, 'cache');
    assert.equal(JSON.parse(cli('session', 'create', 'outra', '--json').stdout).id, 's002-outra');
    const sw = cli('session', 'switch', 'cache', '--json');
    assert.equal(sw.status, 0, sw.stdout + sw.stderr);
    assert.equal(JSON.parse(sw.stdout).active_session, 'sessions/s001-cache');
    const index = fs.readFileSync(path.join(dir, '.oxe', 'SESSIONS.md'), 'utf8');
    assert.equal((index.match(/sessions\/s001-cache/g) || []).length, 1, 'switch atualiza a linha, não duplica');
    assert.ok(index.indexOf('s002-outra') < index.indexOf('s001-cache'), 'a mais recente no topo');
  });

  it('plan amend-test --session <id> solto usa o PLAN da sessão, não o da raiz', () => {
    const { dir, cli } = project();
    assert.equal(cli('session', 'create', 'OXE-300').status, 0);
    // a sessão ativa no STATE é limpa: só o --session decide
    assert.equal(cli('session', 'switch', '--none').status, 0);
    const rootPlan = JSON.stringify({ schema_version: 1, tasks: [] });
    write(dir, '.oxe/PLAN.md', '# PLAN raiz\n');
    write(dir, '.oxe/PLAN.json', rootPlan);
    write(dir, '.oxe/sessions/OXE-300/plan/PLAN.md', '# PLAN da sessão\n');
    write(dir, '.oxe/sessions/OXE-300/plan/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [], acceptance_tests: [{ criterion: 'A1', files: ['tests/a1.test.js'], command: 'node --test tests/a1.test.js', sha256: '0'.repeat(64) }] }));
    write(dir, 'tests/a1.test.js', "require('node:test')('a1', () => {});\n");
    const r = cli('plan', 'amend-test', 'tests/a1.test.js', '--reason', 'CR-1', '--by', 'tl', '--session', 'OXE-300', '--force', '--json');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const sess = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'sessions', 'OXE-300', 'plan', 'PLAN.json'), 'utf8'));
    assert.notEqual(sess.acceptance_tests[0].sha256, '0'.repeat(64), 'o sha da sessão foi emendado');
    assert.equal(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'), rootPlan, 'o PLAN da raiz ficou intacto');
  });

  it('memory kernel lê a sessão ativa nos dois formatos (**active_session:** e active_session:)', () => {
    const kernel = require('../bin/lib/oxe-memory-kernel.cjs');
    for (const line of ['**active_session:** sessions/s001-x', 'active_session: sessions/s001-x']) {
      const { dir } = project();
      write(dir, '.oxe/STATE.md', `# STATE\n\n${line}\n`);
      write(dir, '.oxe/sessions/s001-x/SESSION.md', '# Sessão s001-x\n\n- memória da sessão\n');
      const res = kernel.retrieveMemory(dir, [], null, '');
      assert.ok(res.layers.includes('session_memory'), `${line}: ${JSON.stringify(res.layers)}`);
    }
  });
});
