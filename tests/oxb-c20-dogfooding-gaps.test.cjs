'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const op = require('../bin/lib/oxe-operational.cjs');
const refine = require('../bin/lib/oxe-alm-refine.cjs');
const quick = require('../bin/lib/oxe-quick.cjs');
const health = require('../bin/lib/oxe-project-health.cjs');

const BIN = path.resolve(__dirname, '..', 'bin', 'oxe-cc.js');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxb-c20-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n\nFase atual: `executing`\n');
  return dir;
}

describe('OXB-C20: 9 dogfooding gaps (spec/grill/refine/quick/status/ship)', () => {
  it('#1: spec.md and references/grill.md document --card <KEY> for isolated ALM card grooming', () => {
    const specMd = fs.readFileSync(path.resolve(__dirname, '..', 'oxe', 'workflows', 'spec.md'), 'utf8');
    const grillMd = fs.readFileSync(path.resolve(__dirname, '..', 'oxe', 'workflows', 'references', 'grill.md'), 'utf8');
    assert.match(specMd, /--card <KEY>/);
    assert.match(specMd, /\.oxe\/alm\/grill\/<KEY>/);
    assert.match(grillMd, /--card <KEY>/);
    assert.match(grillMd, /\.oxe\/alm\/grill\/<KEY>\/adr\//);
  });

  it('#2 & #3: grill close --card writes ADRs inside .oxe/alm/grill/<KEY>/adr/ (never docs/adr/) and grill report defaults to .oxe/alm/grill/grooming-quality.md', async () => {
    const dir = mkRepo();
    try {
      op.runtimeGrill(dir, null, { action: 'start', card: 'OXE-41', type: 'task', title: 'Cache IPC' });
      const q = op.runtimeGrill(dir, null, {
        action: 'ask',
        card: 'OXE-41',
        branch: 'scope',
        question: 'Qual TTL usar no cache IPC?',
        options: ['30s', '60s'],
        recommended: '60s',
        decision: true,
      });
      op.runtimeGrill(dir, null, { action: 'answer', card: 'OXE-41', id: q.id, text: '60s', decision: true, by: 'usuário' });
      // confirm all blocking branches in topological order
      const st = op.runtimeGrill(dir, null, { action: 'status', card: 'OXE-41' });
      for (const b of st.branches.filter((x) => x.blocking && !x.confirmed)) {
        if (b.id !== 'scope') op.runtimeGrill(dir, null, { action: 'fact', card: 'OXE-41', branch: b.id, text: 'N/A confirmado', source: 'OXE-41' });
        op.runtimeGrill(dir, null, { action: 'confirm', card: 'OXE-41', branch: b.id });
      }
      op.runtimeGrill(dir, null, { action: 'term', card: 'OXE-41', none: true });
      const closed = op.runtimeGrill(dir, null, { action: 'close', card: 'OXE-41', by: 'usuário' });
      assert.ok(closed.decisions_recorded.length >= 1);
      assert.equal(fs.existsSync(path.join(dir, 'docs', 'adr')), false, 'must NOT pollute versioned docs/adr/');
      const cardAdrDir = path.join(dir, '.oxe', 'alm', 'grill', 'OXE-41', 'adr');
      assert.equal(fs.existsSync(cardAdrDir), true, 'must write ADRs inside .oxe/alm/grill/OXE-41/adr/');
      // revisão 21/11 (achado 7): o card tem o próprio ledger; o compartilhado não recebe a decisão do card
      const cardLedger = path.join(dir, '.oxe', 'alm', 'grill', 'OXE-41', 'decisions.ndjson');
      assert.match(fs.readFileSync(cardLedger, 'utf8'), /grill:OXE-41:/);
      const shared = path.join(dir, '.oxe', 'program', 'decisions.ndjson');
      assert.ok(!fs.existsSync(shared) || !/grill:OXE-41:/.test(fs.readFileSync(shared, 'utf8')), 'decisão do card não vai ao ledger compartilhado');
      // e a próxima decisão do projeto não publica as do card em docs/adr/
      op.runtimeDecision(dir, null, { action: 'add', title: 'Usar fila única para o envio do projeto', by: 'tl' });
      const docsAdr = path.join(dir, 'docs', 'adr');
      const published = fs.existsSync(docsAdr) ? fs.readdirSync(docsAdr).map((f) => fs.readFileSync(path.join(docsAdr, f), 'utf8')).join('\n') : '';
      assert.match(published, /fila única/);
      assert.ok(!/60s|TTL/.test(published), 'ADR do card não aparece em docs/adr/');

      const rep = await op.runtimeGrooming(dir, null, { action: 'report', card: 'OXE-41' });
      assert.equal(rep.file, '.oxe/alm/grill/grooming-quality.md');
      assert.equal(fs.existsSync(path.join(dir, 'docs', 'grooming-quality.md')), false, 'must NOT pollute docs/grooming-quality.md');
      assert.equal(fs.existsSync(path.join(dir, '.oxe', 'alm', 'grill', 'grooming-quality.md')), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#4: uiCardGaps exempts logical bugs (kind=bug) without visual labels that declare BRD: nenhum and touch no CSS/tokens', () => {
    const md = [
      '# OXE-294 — Corrigir race condition no TerminalPane',
      '## Resumo',
      'Corrigir race condition em `src/components/Terminal/TerminalPane.tsx` (BRD: nenhum).',
      '## Passos para reproduzir',
      '1. Abrir dois terminais.',
      '## Resultado esperado',
      'Sessão correta mantém foco.',
      '## Resultado obtido',
      'Sessão anterior sobrescreve buffer.',
      '## Critérios de correção',
      '1. **CA-1** — Dado dois terminais abertos, quando alternar em 50 ms, então 0 caracteres vazam entre sessões · Teste: tests/terminal-pane.test.tsx › isolates buffers',
      '## Teste de regressão',
      'tests/terminal-pane.test.tsx',
      '## Fora de escopo',
      '- Alterar layout do terminal.',
      '## Definição de pronto',
      '- CI verde.',
    ].join('\n');
    const res = op.uiCardGaps(md, { kind: 'bug', labels: ['bug', 'terminal'] });
    assert.equal(res.isUi, false);
    assert.equal(res.bug_non_visual_exempt, true);
    assert.deepEqual(res.gaps, []);
  });

  it('#5: VAGUE_RE allows "simples" qualifying domain nouns ("shell simples", "texto simples") while still rejecting vague UX "simples"', () => {
    const base = (ca) => [
      '# OXE-272 — Shell',
      '## Objetivo',
      'Suportar shell simples.',
      '## Critérios de aceite',
      `1. **CA-1** — ${ca} · Teste: tests/shell.test.ts › works`,
      '## Regras técnicas',
      '- **RT-1** — Usar spawn.',
      '## Fora de escopo',
      '- PTY avançado.',
      '## Definição de pronto',
      '- CI verde.',
    ].join('\n');
    const okDomain = refine.lintSpec(base('Dado um shell simples sem PTY, quando executar echo ok, então retorna código 0'), 'task');
    assert.equal(okDomain.ok, true, JSON.stringify(okDomain.errors));

    const badVague = refine.lintSpec(base('Dado o usuário na tela, quando clicar, então a interface fica simples'), 'task');
    assert.equal(badVague.ok, false);
    assert.ok(badVague.errors.some((e) => /vago.*simples/i.test(e)));
  });

  it('#6 & #7 & #9: quick template has Contexto + Plano formal existente?, --no-alm skips ALM, status/ship prioritize active quick, and quick promote builds PR with Fecha <KEY>', async () => {
    const dir = mkRepo();
    try {
      execFileSync('git', ['checkout', '-b', 'fix/oxe-41'], { cwd: dir, stdio: 'ignore' });
      const started = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-41', objective: 'Corrigir cache de introspecção', noAlm: true });
      assert.equal(started.key, 'OXE-41');
      assert.equal(started.alm, null);
      const quickMd = fs.readFileSync(path.join(dir, '.oxe', 'QUICK.md'), 'utf8');
      assert.match(quickMd, /## Contexto/);
      assert.match(quickMd, /Plano formal existente\?: não/);

      // status prioritizes active open quick
      const nextOpen = health.suggestNextStep(dir, {});
      assert.equal(nextOpen.step, 'quick');
      assert.match(nextOpen.cursorCmd, /oxe-cc quick done/);

      // ship status includes active quick
      const shipOpen = op.runtimeDeliveryStatus(dir, null, { refresh: false });
      assert.equal(shipOpen.quick.state, 'open');
      assert.equal(shipOpen.quick.id, started.id);

      // commit & close quick, then promote (dry-run + open-pr with fake spawn)
      fs.writeFileSync(path.join(dir, 'fix.txt'), 'ok\n');
      quick.commit(dir, { message: 'fix: cache', paths: ['fix.txt'] });
      await op.runtimeQuick(dir, null, { action: 'done', noAlm: true });

      // revisão 21/11 (achado 1): o promote só é sugerido com delivery.mode "pr" numa branch ≠ base
      const nextLocal = health.suggestNextStep(dir, {});
      assert.ok(!/quick promote/.test(nextLocal.cursorCmd || ''), JSON.stringify(nextLocal));
      fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ delivery: { mode: 'pr', base: 'main' } }));
      const nextDone = health.suggestNextStep(dir, {});
      assert.equal(nextDone.step, 'ship');
      assert.match(nextDone.cursorCmd, /oxe-cc quick promote --open-pr/);

      const calls = [];
      const fakeSpawn = (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: 'fix/oxe-41\n', stderr: '' };
        if (cmd === 'git' && args[0] === 'push') return { status: 0, stdout: '', stderr: '' };
        if (cmd === 'gh' && args[0] === 'pr') return { status: 0, stdout: 'https://github.com/org/repo/pull/999\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      };
      const promo = await op.runtimeQuick(dir, null, { action: 'promote', id: started.id, openPr: true, base: 'main', spawn: fakeSpawn });
      assert.equal(promo.promoted, true);
      // achado 2: check-origin recebe o range como target (antes ia como {range} e checava origin/main..HEAD)
      assert.equal(promo.origin.range, 'main..HEAD');
      assert.equal(promo.pr, 'https://github.com/org/repo/pull/999');
      assert.match(promo.body, /Fecha OXE-41/);
      assert.match(promo.body, new RegExp(`OXE-Quick: ${started.id}`));
      assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'create'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#8: oxe-cc status --json returns compact payload by default (compact: true) and full payload with --full', () => {
    const dir = mkRepo();
    try {
      const outCompact = JSON.parse(execFileSync(process.execPath, [BIN, 'status', '--dir', dir, '--json'], { encoding: 'utf8' }));
      assert.equal(outCompact.compact, true);
      const outFull = JSON.parse(execFileSync(process.execPath, [BIN, 'status', '--dir', dir, '--json', '--full'], { encoding: 'utf8' }));
      assert.equal(outFull.compact, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
