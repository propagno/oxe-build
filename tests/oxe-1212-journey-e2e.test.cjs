'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — the guided journey end to end, by the CLI a user would type, with fakes only (ALM by MCP queue, no
// network, no gh, no claude -p): at every stage `status --json` points to exactly the step that follows.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

const SPEC = [
  '# SPEC — Envio para o celular', '', '## Requisitos', '',
  '| R-ID | Requisito | Versão | Critério de aceite |', '|---|---|---|---|', '| R1 | enviar texto | v1 | A1, A2 |', '',
  '## Critérios de aceite', '',
  '| ID | Critério | Risco | Como verificar |', '|---|---|---|---|',
  '| A1 | o Envio chega ao celular | P2 | node -e 1 |', '| A2 | erro claro quando offline | P2 | node -e 1 |', '',
  '## Suposições', '', '- nenhuma além das do grill', '',
].join('\n');
const ROADMAP = '# Roteiro\n\n## Fase 1 — Envio\n\n**Requisitos:** R1\n**Critérios de aceite:** A1, A2\n**Escopo:** envio\n';
const PRD = '# PRD — Envio\n\n## Histórias de usuário\n\n| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |\n|---|---|---|---|---|---|---|\n| US-1 | operador | enviar texto ao celular | não digitar duas vezes | R1 | A1, A2 | Must |\n';

describe('journey e2e (fakes only)', () => {
  it('grill → spec check/approve → ALM stories (MCP queue + ack) → program start → plan → ALM tasks → execute', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-e2e-'));
    dirs.push(dir);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    write(dir, '.oxe/STATE.md', '# STATE\n');
    write(dir, '.oxe/config.json', JSON.stringify({ adr: false, alm: { provider: 'jira', transport: 'mcp', program: 'e2e', jira: { project: 'OXE' } } }));
    for (const m of ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONVENTIONS.md', 'CONCERNS.md']) write(dir, `.oxe/codebase/${m}`, `# ${m}\n`);
    const cli = (...a) => {
      const r = spawnSync(process.execPath, [CLI, ...a, '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', OXE_NO_PROMPT: '1' } });
      return r;
    };
    const step = () => JSON.parse(cli('status', '--journey', '--json').stdout).next;

    // 1 — discover (grill)
    assert.equal(cli('grill', 'start', 'investigação').status, 0);
    assert.equal(step().step, 'spec');
    for (const b of ['problem', 'scope', 'risks']) {
      assert.equal(cli('grill', 'ask', '--branch', b, '--question', `qual a decisão de ${b}?`, '--options', 'opção alfa | opção beta', '--recommended', 'opção alfa', '--why', 'evidência do código', ...(b === 'scope' ? ['--decision'] : [])).status, 0);
    }
    for (const q of ['Q-1', 'Q-2', 'Q-3']) assert.equal(cli('grill', 'answer', q, 'ok').status, 0);
    for (const b of ['problem', 'scope', 'risks']) assert.equal(cli('grill', 'confirm', b, '--playback', 'resumo do ramo confirmado pelo usuário').status, 0, `confirm ${b}`);
    const closed = cli('grill', 'close', '--by', 'po');
    assert.equal(closed.status, 0, closed.stdout + closed.stderr);

    // 2 — validate
    write(dir, '.oxe/SPEC.md', SPEC);
    write(dir, '.oxe/ROADMAP.md', ROADMAP);
    write(dir, '.oxe/PRD.md', PRD);
    assert.equal(step().step, 'spec-approve');
    const check = cli('spec', 'check');
    assert.equal(check.status, 0, check.stdout);
    assert.equal(cli('spec', 'approve', '--by', 'po').status, 0);

    // 3 — program + ALM stories through the MCP queue
    assert.equal(step().step, 'alm-push');
    await op.runtimeAlm(dir, null, { action: 'push', tasks: false });
    assert.equal(step().step, 'alm-queue');
    const q = JSON.parse(cli('alm', 'queue', '--json').stdout).ops;
    let n = 10;
    for (const o of q) assert.equal(cli('alm', 'ack', o.id, ...(o.op === 'ensure' ? ['--key', `OXE-${(n += 1)}`] : [])).status, 0, o.id);
    op.runtimeProgramInit(dir, null, {});
    let s = step();
    assert.equal(s.step, 'program-start', JSON.stringify(s));
    op.runtimeProgramStart(dir, null, 'F1');
    assert.equal(step().step, 'plan');

    // 5 — plan → ALM tasks → execute
    write(dir, '.oxe/PLAN.md', '# PLAN\n\n## Autoavaliação do Plano\n\n- Melhor plano atual: sim\n- Confiança: 95%\n');
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', wave: 1, title: 'enviar', acceptance: ['A1', 'A2'], files: ['src/send.js'] }] }));
    s = step();
    assert.equal(s.step, 'alm-push');
    assert.match(s.cursorCmd, /--tasks-only/);
    await op.runtimeAlm(dir, null, { action: 'push', stories: false });
    for (const o of JSON.parse(cli('alm', 'queue', '--json').stdout).ops) cli('alm', 'ack', o.id, ...(o.op === 'ensure' ? ['--key', `OXE-${(n += 1)}`] : []));
    s = step();
    assert.equal(s.step, 'execute', JSON.stringify(s));

    // the map shows where the user is
    const j = JSON.parse(cli('status', '--journey', '--json').stdout);
    assert.deepEqual(j.stages.filter((x) => x.state === 'done').map((x) => x.id).slice(0, 3), ['prepare', 'discover', 'validate']);
    assert.equal(j.current, 'build');
  });
});

// ── jornada até a entrega e o fechamento (itens 1–9, 14, 17): programa, sem programa e quick ─────────────────────

const PLAN_MD = [
  '# PLAN', '', '## Autoavaliação do Plano', '- **Melhor plano atual:** sim', '- **Confiança:** 91%', '- **Base da confiança:**',
  '  - Completude dos requisitos: 23/25', '  - Dependências conhecidas: 14/15', '  - Risco técnico: 18/20', '  - Impacto no código existente: 14/15',
  '  - Clareza da validação / testes: 13/15', '  - Lacunas externas / decisões pendentes: 9/10', '- **Principais incertezas:** nenhuma',
  '- **Alternativas descartadas:** nenhuma', '- **Condição para replanejar:** falha em A1', '',
  '<confidence_vector cycle="C-01" generated_at="2026-04-22T12:00:00Z">', '  <dim name="requirements" score="0.92" weight="25" note="ok" />',
  '  <dim name="dependencies" score="0.93" weight="15" note="ok" />', '  <dim name="technical_risk" score="0.90" weight="20" note="ok" />',
  '  <dim name="code_impact" score="0.93" weight="15" note="ok" />', '  <dim name="validation" score="0.87" weight="15" note="ok" />',
  '  <dim name="open_gaps" score="0.90" weight="10" note="ok" />', '  <global score="0.91" gate="proceed" />', '</confidence_vector>', '',
  '### T1 — enviar', '- **Aceite vinculado:** A1, A2', '',
].join('\n');
// the rational packs the /oxe-plan writes next to the PLAN (the execute gate reads them)
function writePacks(dir) {
  write(dir, '.oxe/IMPLEMENTATION-PACK.md', '# implementation\n');
  write(dir, '.oxe/IMPLEMENTATION-PACK.json', JSON.stringify({ schema_version: '1', generated_at: '2026-04-22T12:00:00Z', ready: true, critical_gaps: [], tasks: [{ id: 'T1', title: 'T1', mode: 'mutating', ready: true, exact_paths: ['src/send.js'], write_set: 'closed', symbols: [{ kind: 'function', name: 'send', path: 'src/send.js', signature: '() => void' }], contracts: [{ name: 'T1-contract', input_shape: 'void', output_shape: 'void', invariants: ['none'], not_allowed: ['none'] }], snippets: [], expected_checks: ['node -e 1'], requires_fixture: false, critical_gaps: [] }] }, null, 2));
  write(dir, '.oxe/REFERENCE-ANCHORS.md', '<reference_anchors version="1" ready="true" status="not_applicable"></reference_anchors>\n');
  write(dir, '.oxe/FIXTURE-PACK.md', '# fixture\n');
  write(dir, '.oxe/FIXTURE-PACK.json', JSON.stringify({ schema_version: '1', generated_at: '2026-04-22T12:00:00Z', ready: true, critical_gaps: [], fixtures: [] }, null, 2));
}
const ROADMAP2 ='# Roteiro\n\n## Fase 1 — Envio\n\n**Requisitos:** R1\n**Critérios de aceite:** A1\n**Escopo:** envio\n\n## Fase 2 — Erros\n\n**Requisitos:** R1\n**Critérios de aceite:** A2\n**Escopo:** offline\n';

function journeyProject(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-e2e-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'e2e@example.invalid'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'e2e'], { cwd: dir });
  const env = { ...process.env, NO_COLOR: '1', OXE_NO_PROMPT: '1' };
  const cli = (...a) => spawnSync(process.execPath, [CLI, ...a, '--dir', dir], { encoding: 'utf8', env });
  assert.equal(cli('init-oxe').status, 0, 'init-oxe');
  if (Object.keys(config).length) {
    const cfgFile = path.join(dir, '.oxe', 'config.json');
    const cur = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
    fs.writeFileSync(cfgFile, JSON.stringify({ ...cur, adr: false, ...config }, null, 2));
  }
  /** `status --json` (nomes canônicos + alias) e `status --journey --json` conferidos juntos a cada passo */
  const status = () => {
    const r = cli('status', '--json');
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.equal(j.next, j.nextStep, 'next é alias de nextStep');
    const jr = JSON.parse(cli('status', '--journey', '--json').stdout);
    assert.equal(jr.next.step, j.nextStep, 'o mapa e o status --json dão o mesmo próximo passo');
    return { step: j.nextStep, cursorCmd: j.cursorCmd, reason: j.reason, journey: jr };
  };
  const grill = () => {
    assert.equal(cli('grill', 'start', 'investigação').status, 0);
    for (const b of ['problem', 'scope', 'risks']) {
      assert.equal(cli('grill', 'ask', '--branch', b, '--question', `qual a decisão de ${b}?`, '--options', 'opção alfa | opção beta', '--recommended', 'opção alfa', '--why', 'evidência do código', ...(b === 'scope' ? ['--decision'] : [])).status, 0);
    }
    for (const q of ['Q-1', 'Q-2', 'Q-3']) assert.equal(cli('grill', 'answer', q, 'ok').status, 0);
    for (const b of ['problem', 'scope', 'risks']) assert.equal(cli('grill', 'confirm', b, '--playback', 'resumo do ramo confirmado pelo usuário').status, 0);
    const closed = cli('grill', 'close', '--by', 'po');
    assert.equal(closed.status, 0, closed.stdout + closed.stderr);
  };
  const markDone = () => {
    const f = path.join(dir, '.oxe', 'PLAN.json');
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const t of doc.tasks) t.done = true;
    fs.writeFileSync(f, JSON.stringify(doc));
  };
  const programLib = require('../bin/lib/oxe-program.cjs');
  const programDir = path.join(dir, '.oxe', 'program');
  const setPhase = (id, patch) => {
    const st = programLib.readProgram(programDir);
    const ph = st.phases.find((x) => x.id === id);
    Object.assign(ph, patch);
    if (patch.status === 'closed') st.active_phase = null;
    programLib.writeProgram(programDir, st);
  };
  return { dir, cli, status, grill, markDone, setPhase };
}

const expectStep = (s, step, cmd, msg) => {
  assert.equal(s.step, step, `${msg || ''} ${JSON.stringify({ step: s.step, cursorCmd: s.cursorCmd, reason: s.reason })}`);
  if (cmd) assert.equal(s.cursorCmd, cmd, `${msg || ''} ${s.reason}`);
};

describe('journey e2e até a entrega (fakes only)', () => {
  it('com programa: init → spec → approve → program init/start → plan → execute → verify → close → F2 → programa concluído → CR', () => {
    const t = journeyProject();
    let s = t.status();
    expectStep(s, 'spec', '/oxe-spec', 'depois do init-oxe (item 3)');
    t.grill();
    expectStep(t.status(), 'spec-approve', '/oxe-spec', 'grill fechado sem SPEC');
    write(t.dir, '.oxe/SPEC.md', SPEC);
    write(t.dir, '.oxe/ROADMAP.md', ROADMAP2);
    expectStep(t.status(), 'spec-approve', 'oxe-cc spec approve --by <papel>', 'spec check verde (item 7)');
    assert.equal(t.cli('spec', 'approve', '--by', 'po').status, 0);
    s = t.status();
    expectStep(s, 'program-init', 'oxe-cc runtime program init', 'ROADMAP de 2 fases (item 4)');
    assert.equal(s.journey.current, 'program');
    op.runtimeProgramInit(t.dir, null, {});
    expectStep(t.status(), 'program-start', 'oxe-cc runtime program start --phase F1');
    op.runtimeProgramStart(t.dir, null, 'F1');
    expectStep(t.status(), 'plan', '/oxe-plan');
    write(t.dir, '.oxe/PLAN.md', PLAN_MD);
    write(t.dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', wave: 1, title: 'enviar', acceptance: ['A1'], files: ['src/send.js'] }] }));
    expectStep(t.status(), 'execute', '/oxe-execute');
    t.setPhase('F1', { status: 'executing' });
    expectStep(t.status(), 'execute', '/oxe-execute', 'tarefa pendente');
    t.markDone();
    s = t.status();
    expectStep(s, 'verify', '/oxe-verify', 'todas as tarefas feitas (item 1)');
    assert.equal(s.journey.current, 'verify');
    // o verify (fake): fase em verifying e run completed
    op.writeRunState(t.dir, null, { run_id: 'oxe-run-e2e-f1', status: 'completed', verification_status: 'passed', verification_check_results: [{ check_id: 'A1', acceptance_ref: 'A1', status: 'pass' }] });
    t.setPhase('F1', { status: 'verifying', run_id: 'oxe-run-e2e-f1' });
    s = t.status();
    expectStep(s, 'program-close', 'oxe-cc runtime program close', 'verify verde');
    assert.equal(s.journey.current, 'deliver');
    t.setPhase('F1', { status: 'closed', closed_at: new Date().toISOString() });
    expectStep(t.status(), 'program-start', 'oxe-cc runtime program start --phase F2', 'fase 2 depois do close');
    op.runtimeProgramStart(t.dir, null, 'F2');
    expectStep(t.status(), 'plan', '/oxe-plan', 'o plano da F1 não serve para a F2');
    write(t.dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F2', tasks: [{ id: 'T1', wave: 1, title: 'offline', acceptance: ['A2'], files: ['src/offline.js'] }] }));
    expectStep(t.status(), 'execute', '/oxe-execute');
    t.setPhase('F2', { status: 'executing' });
    t.markDone();
    expectStep(t.status(), 'verify', '/oxe-verify');
    op.writeRunState(t.dir, null, { run_id: 'oxe-run-e2e-f2', status: 'completed', verification_status: 'passed', verification_check_results: [{ check_id: 'A2', acceptance_ref: 'A2', status: 'pass' }] });
    t.setPhase('F2', { status: 'verifying', run_id: 'oxe-run-e2e-f2' });
    expectStep(t.status(), 'program-close', 'oxe-cc runtime program close');
    t.setPhase('F2', { status: 'closed', closed_at: new Date().toISOString() });
    s = t.status();
    expectStep(s, 'next', '/oxe-spec', 'programa concluído');
    assert.equal(s.journey.current, 'operate');
    for (const id of ['plan', 'build', 'verify', 'deliver']) assert.equal(s.journey.stages.find((x) => x.id === id).state, 'done', id);
    // item 8: um CR aberto depois do programa fechado (que não reabriu fase) é o próximo passo
    op.runtimeFeedback(t.dir, null, { class: 'constraint', summary: 'nunca logar o token do celular', by: 'qa' });
    expectStep(t.status(), 'plan', '/oxe-plan --replan', 'CR depois do programa fechado');
  });

  it('sem programa: init → spec → approve → plan → execute → verify → /oxe-ship → ciclo fechado → nova SPEC', () => {
    const t = journeyProject();
    expectStep(t.status(), 'spec', '/oxe-spec', 'depois do init-oxe');
    t.grill();
    write(t.dir, '.oxe/SPEC.md', SPEC);
    write(t.dir, '.oxe/ROADMAP.md', ROADMAP);
    expectStep(t.status(), 'spec-approve', 'oxe-cc spec approve --by <papel>');
    assert.equal(t.cli('spec', 'approve', '--by', 'po').status, 0);
    // greenfield com a SPEC aprovada: nunca --refresh (item 4); fase única: sem programa
    expectStep(t.status(), 'plan', '/oxe-plan', 'SPEC aprovada, fase única');
    write(t.dir, '.oxe/PLAN.md', PLAN_MD);
    write(t.dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', wave: 1, title: 'enviar', acceptance: ['A1', 'A2'], files: ['src/send.js'] }] }));
    writePacks(t.dir);
    let s = t.status();
    expectStep(s, 'execute', '/oxe-execute', 'plano pronto → execute, não dashboard (item 6)');
    assert.equal(s.journey.current, 'build');
    t.markDone();
    expectStep(t.status(), 'verify', '/oxe-verify', 'tarefas feitas (item 1, sem programa)');
    write(t.dir, '.oxe/VERIFY.md', '# VERIFY\n\n| Critério | Passou |\n|---|---|\n| A1 | sim |\n| A2 | sim |\n\n## Gaps\n\nNenhum\n');
    s = t.status();
    expectStep(s, 'ship', '/oxe-ship', 'verify verde → entregar, sem retro obrigatória (item 2)');
    assert.equal(s.journey.current, 'deliver');
    // /oxe-ship --local grava o registro do commit
    write(t.dir, '.oxe/commit-record.json', JSON.stringify({ sha: '0123456789abcdef', subject: 'feat: envio', branch: 'main', verify: 'pass' }));
    s = t.status();
    expectStep(s, 'next', '/oxe-spec', 'ciclo entregue');
    assert.match(s.reason, /Ciclo entregue \(commit local 012345678\)/);
    assert.equal(s.journey.current, 'operate');
    for (const id of ['plan', 'build', 'verify', 'deliver']) assert.equal(s.journey.stages.find((x) => x.id === id).state, 'done', id);
    // a próxima demanda: uma SPEC nova (mais nova que o VERIFY) leva ao plano
    const later = new Date(Date.now() + 10000);
    write(t.dir, '.oxe/SPEC.md', `${SPEC}\n| A3 | nova demanda | P2 | node -e 1 |\n`);
    fs.utimesSync(path.join(t.dir, '.oxe', 'SPEC.md'), later, later);
    expectStep(t.status(), 'plan', '/oxe-plan', 'SPEC nova depois da entrega');
  });

  it('quick local (padrão): init → quick aberto → quick commit → quick done → ciclo fechado (os commits já são a entrega)', () => {
    const t = journeyProject();
    spawnSync('git', ['checkout', '-q', '-b', 'main'], { cwd: t.dir });
    const opened = t.cli('quick', 'corrigir o texto do botão enviar');
    assert.equal(opened.status, 0, opened.stdout + opened.stderr);
    expectStep(t.status(), 'quick', 'oxe-cc quick done --verify "<comando>"', 'quick aberto');
    write(t.dir, 'src/botao.js', 'module.exports = "Enviar";\n');
    const c = t.cli('quick', 'commit', '-m', 'fix: texto do botão', 'src/botao.js');
    assert.equal(c.status, 0, c.stdout + c.stderr);
    const d = t.cli('quick', 'done', '--verify', 'node -e 1');
    assert.equal(d.status, 0, d.stdout + d.stderr);
    assert.match(d.stdout, /Próximo: \/oxe-spec/, 'local: o quick done fecha o ciclo, nunca o promote que recusa na base');
    // item 9: QUICK.md e STATE fechados
    const quickMd = fs.readFileSync(path.join(t.dir, '.oxe', 'QUICK.md'), 'utf8');
    assert.match(quickMd, /oxe-quick-status: done/);
    let s = t.status();
    expectStep(s, 'next', '/oxe-spec', 'quick local entregue → ciclo fechado');
    assert.match(s.reason, /entregue \(1 commit\(s\) local\(is\)\)/);
    assert.equal(s.journey.current, 'operate');
    // a próxima demanda (SPEC mais nova que o closed_at) não fica escondida atrás do quick
    const later = new Date(Date.now() + 10000);
    write(t.dir, '.oxe/SPEC.md', SPEC);
    fs.utimesSync(path.join(t.dir, '.oxe', 'SPEC.md'), later, later);
    s = t.status();
    assert.notEqual(s.step, 'next', JSON.stringify(s));
    assert.ok(!/quick promote/.test(s.cursorCmd), s.cursorCmd);
  });

  it('quick com delivery.mode pr: na base pede a branch; na branch → quick promote → CI/merge (ship-wait) → ciclo fechado', () => {
    const t = journeyProject({ delivery: { mode: 'pr', base: 'main' } });
    spawnSync('git', ['checkout', '-q', '-b', 'main'], { cwd: t.dir });
    assert.equal(t.cli('quick', 'corrigir o texto do botão enviar').status, 0);
    write(t.dir, 'src/botao.js', 'module.exports = "Enviar";\n');
    assert.equal(t.cli('quick', 'commit', '-m', 'fix: texto do botão', 'src/botao.js').status, 0);
    const d = t.cli('quick', 'done', '--verify', 'node -e 1');
    assert.equal(d.status, 0, d.stdout + d.stderr);
    let s = t.status();
    expectStep(s, 'ship', '/oxe-ship', 'pr na branch base: o promote recusaria — pede a branch');
    assert.match(s.reason, /branch base \(main\)/);
    spawnSync('git', ['checkout', '-q', '-b', 'fix/botao'], { cwd: t.dir });
    s = t.status();
    expectStep(s, 'ship', 'oxe-cc quick promote --open-pr', 'pr numa branch → PR');
    assert.equal(s.journey.current, 'deliver');
    // o promote (fake: sem push nem gh) grava o PR no registro e o evento QuickPromoted
    const ql = require('../bin/lib/oxe-quick.cjs');
    const rec = ql.list(t.dir)[0];
    const pr = 'https://example.invalid/pr/7';
    fs.writeFileSync(path.join(t.dir, '.oxe', 'quick', `${rec.id}.json`), JSON.stringify({ ...rec, pr, promoted_at: new Date().toISOString() }, null, 2));
    op.appendEvent(t.dir, null, { type: 'QuickPromoted', work_item_id: rec.id, payload: { id: rec.id, pr, branch: 'fix/botao' } });
    s = t.status();
    expectStep(s, 'ship-wait', 'oxe-cc ship status', 'PR aberto ainda não fecha o ciclo');
    assert.ok(op.runtimeDeliveryStatus(t.dir, null, { refresh: false }).prs.some((x) => x.quick === rec.id && x.pr === pr && !x.merged), 'ship status mostra o PR do quick');
    op.appendEvent(t.dir, null, { type: 'AlmMerged', work_item_id: rec.id, payload: { pr } });
    s = t.status();
    expectStep(s, 'next', '/oxe-spec', 'PR com merge → ciclo fechado');
    assert.match(s.reason, /entregue \(PR https:\/\/example\.invalid\/pr\/7 com merge\)/);
  });

  it('quick com delivery.mode pr e deploy_env: depois do merge, o deploy antes de fechar', () => {
    const t = journeyProject({ delivery: { mode: 'pr', base: 'main', deploy_env: 'staging' } });
    spawnSync('git', ['checkout', '-q', '-b', 'fix/deploy'], { cwd: t.dir });
    assert.equal(t.cli('quick', 'ajustar o rótulo do deploy').status, 0);
    write(t.dir, 'src/rotulo.js', 'module.exports = 1;\n');
    assert.equal(t.cli('quick', 'commit', '-m', 'fix: rótulo', 'src/rotulo.js').status, 0);
    assert.equal(t.cli('quick', 'done', '--verify', 'node -e 1').status, 0);
    const rec = require('../bin/lib/oxe-quick.cjs').list(t.dir)[0];
    op.appendEvent(t.dir, null, { type: 'QuickPromoted', work_item_id: rec.id, payload: { id: rec.id, pr: 'https://example.invalid/pr/8' } });
    op.appendEvent(t.dir, null, { type: 'AlmMerged', work_item_id: rec.id, payload: { pr: 'https://example.invalid/pr/8' } });
    const s = t.status();
    assert.equal(s.step, 'deploy', JSON.stringify(s));
    assert.match(s.cursorCmd, /runtime deploy --attach staging/);
  });

  it('quick fechado seguido de /oxe-ship --local (commit-record.json posterior) → ciclo fechado', () => {
    const t = journeyProject({ delivery: { mode: 'pr', base: 'main' } });
    spawnSync('git', ['checkout', '-q', '-b', 'fix/local'], { cwd: t.dir });
    assert.equal(t.cli('quick', 'ajustar o texto do rodapé').status, 0);
    write(t.dir, 'src/rodape.js', 'module.exports = 1;\n');
    assert.equal(t.cli('quick', 'commit', '-m', 'fix: rodapé', 'src/rodape.js').status, 0);
    assert.equal(t.cli('quick', 'done', '--verify', 'node -e 1').status, 0);
    write(t.dir, '.oxe/commit-record.json', JSON.stringify({ sha: 'abcdef0123456789', subject: 'fix: rodapé', branch: 'fix/local' }));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(t.dir, '.oxe', 'commit-record.json'), later, later);
    const s = t.status();
    expectStep(s, 'next', '/oxe-spec', 'commit local registrado depois do quick');
    assert.match(s.reason, /commit local abcdef012/);
  });

  it('quick sem commit (--no-commit) fecha direto no ciclo fechado', () => {
    const t = journeyProject();
    assert.equal(t.cli('quick', 'conferir se o bug ainda reproduz').status, 0);
    write(t.dir, '.oxe/STATE.md', `${fs.readFileSync(path.join(t.dir, '.oxe', 'STATE.md'), 'utf8')}\n## Fase atual\n\n\`quick_active\`\n`);
    const d = t.cli('quick', 'done', '--no-commit');
    assert.equal(d.status, 0, d.stdout + d.stderr);
    assert.match(fs.readFileSync(path.join(t.dir, '.oxe', 'STATE.md'), 'utf8'), /`quick_done`/, 'STATE sai de quick_active');
    expectStep(t.status(), 'next', '/oxe-spec', 'nada precisou mudar');
  });
});
