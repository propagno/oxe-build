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
    for (const b of ['problem', 'scope', 'risks']) assert.equal(cli('grill', 'confirm', b).status, 0, `confirm ${b}`);
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
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', title: 'enviar', acceptance: ['A1', 'A2'], files: ['src/send.js'] }] }));
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
