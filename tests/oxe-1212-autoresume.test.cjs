'use strict';

// 1.21.2 (G24, OXE-143): runtime execute resumes the phase by itself after a restart or a kill for memory — at the next
// task not done, under the memory rule, and never a paused phase. No paid executor: a `claude` shim.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const ar = require('../bin/lib/oxe-autoresume.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmpDir = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };

/** A pid that existed and is gone now. */
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  return Number(r.stdout.trim());
}

const cfg = (o = {}) => ar.config({ autoresume: { min_free_mb: 100, ...o } }, {});

describe('G24 · lease e decisão', () => {
  it('os argumentos de relançamento não levam segredo nem o --supervise', () => {
    assert.deepEqual(ar.relaunchArgv(['runtime', 'execute', '--api-key', 'sk-x', '--supervise', '--wave', '2', '--api-key=sk-y']), ['runtime', 'execute', '--wave', '2']);
  });

  it('min_free_mb cai para parallel.min_free_mb, depois o env, depois 2,5 GB', () => {
    assert.equal(ar.config({}, {}).minFreeMb, 2560);
    assert.equal(ar.config({ parallel: { min_free_mb: 1536 } }, {}).minFreeMb, 1536);
    assert.equal(ar.config({}, { OXE_EXECUTOR_MIN_FREE_MB: '2048' }).minFreeMb, 2048);
    assert.equal(ar.config({ autoresume: { min_free_mb: 3000 }, parallel: { min_free_mb: 1536 } }, {}).minFreeMb, 3000);
  });

  it('lease aberto com o pid morto é interrompido; fim limpo e processo vivo não são', () => {
    const d = tmpDir('oxe-ar-lease-');
    const file = ar.leasePath(d);
    assert.equal(ar.inspect(file).state, 'none');
    ar.startLease(file, { pid: deadPid(), argv: ['runtime', 'execute'] });
    assert.equal(ar.inspect(file).state, 'interrupted');
    ar.startLease(file, { pid: process.pid, argv: ['runtime', 'execute'] });
    assert.equal(ar.inspect(file).state, 'running');
    ar.finishLease(file, 'finished');
    assert.equal(ar.inspect(file).state, 'ended');
    // a crash of the runtime (uncaught exception) is resumable, unlike "failed" (OxeSpace 14/11, ERR_STRING_TOO_LONG)
    ar.startLease(file, { pid: process.pid, argv: ['runtime', 'execute'] });
    ar.finishLease(file, 'crashed');
    const crashed = ar.inspect(file);
    assert.equal(crashed.state, 'interrupted');
    assert.equal(crashed.crashed, true);
    const dc = ar.decide({ inspection: crashed, cfg: ar.config({ autoresume: { min_free_mb: 1 } }, {}), freeMb: 4000 });
    assert.equal(dc.resume, true);
    assert.match(dc.why, /caiu \(crash\)/);
    ar.startLease(file, { pid: process.pid, argv: [] });
    ar.finishLease(file, 'failed');
    assert.equal(ar.inspect(file).state, 'ended');
    // a newer execute's lease is never closed by an older process
    ar.startLease(file, { pid: 999999, argv: [] });
    assert.equal(ar.finishLease(file, 'failed', { pid: process.pid }), null);
  });

  it('retoma o interrompido; nunca o pausado, o que terminou, o desligado ou o laço de queda', () => {
    const d = tmpDir('oxe-ar-dec-');
    const file = ar.leasePath(d);
    const lease = ar.startLease(file, { pid: deadPid(), argv: ['runtime', 'execute'] });
    const inspection = ar.inspect(file);
    assert.equal(ar.decide({ inspection, cfg: cfg(), freeMb: 4000 }).resume, true);
    // paused: runtime pause, a checkpoint waiting, or a scheduler pause after the lease started
    for (const runState of [{ status: 'paused' }, { status: 'waiting_approval' }]) {
      const dd = ar.decide({ inspection, runState, cfg: cfg(), freeMb: 4000 });
      assert.equal(dd.resume, false);
      assert.equal(dd.paused, true);
    }
    const ev = [{ type: 'RunPaused', timestamp: new Date(Date.parse(lease.started_at) + 1000).toISOString(), payload: { reason: 'quota', resume_at: '2026-11-15T03:00:00Z' } }];
    const q = ar.decide({ inspection, runState: { status: 'running' }, events: ev, cfg: cfg(), freeMb: 4000 });
    assert.equal(q.resume, false);
    assert.match(q.why, /nunca é retomada sozinha/);
    // a pause from before this lease (an older run, already resumed by hand) does not hold it
    const old = [{ type: 'RunPaused', timestamp: '2020-01-01T00:00:00Z', payload: {} }];
    assert.equal(ar.decide({ inspection, events: old, cfg: cfg(), freeMb: 4000 }).resume, true);
    assert.equal(ar.decide({ inspection, cfg: cfg({ enabled: false }), freeMb: 4000 }).resume, false);
    // crash loop: max_restarts in the window
    const now = new Date();
    const looped = { ...inspection, lease: { ...inspection.lease, restarts: [1, 2, 3].map((m) => ({ at: new Date(now - m * 60000).toISOString() })) } };
    const loop = ar.decide({ inspection: looped, cfg: cfg(), freeMb: 4000, now });
    assert.equal(loop.resume, false);
    assert.equal(loop.crash_loop, true);
    const ended = ar.decide({ inspection: { state: 'ended', lease: { status: 'stopped' } }, cfg: cfg(), freeMb: 4000 });
    assert.match(ended.why, /stopped/);
  });

  it('regra de memória: espera a memória voltar; sem ela, desiste e diz por quê', async () => {
    const d = tmpDir('oxe-ar-mem-');
    const file = ar.leasePath(d);
    ar.startLease(file, { pid: deadPid(), argv: [] });
    let free = 500;
    const decideNow = () => ar.decide({ inspection: ar.inspect(file), cfg: cfg({ min_free_mb: 2560 }), freeMb: free });
    let waits = 0;
    const back = await ar.waitForResume(decideNow, { waitMs: 120000, pollMs: 30000, wait: async () => { waits += 1; if (waits === 2) free = 3000; } });
    assert.equal(back.resume, true);
    assert.equal(waits, 2);
    free = 500;
    const gave = await ar.waitForResume(decideNow, { waitMs: 60000, pollMs: 30000, wait: async () => {} });
    assert.equal(gave.resume, false);
    assert.match(gave.why, /regra de memória.*não retomou/);
  });

  it('próxima tarefa: a primeira não concluída, dentro do --wave/--task', () => {
    const doc = { tasks: [{ id: 'T1', wave: 1, status: 'done' }, { id: 'T2', wave: 1 }, { id: 'T3', wave: 2 }] };
    assert.equal(ar.nextTask(doc, []).id, 'T2');
    assert.equal(ar.nextTask(doc, ['--wave', '2']).id, 'T3');
    assert.equal(ar.nextTask({ tasks: [{ id: 'T1', done: true }] }, []), null);
  });

  it('supervisor: relança quando o filho cai no meio e para no fim limpo', async () => {
    const d = tmpDir('oxe-ar-sup-');
    const file = ar.leasePath(d);
    const calls = [];
    const res = await ar.supervise({
      file,
      argv: ['runtime', 'execute'],
      waitMs: 0,
      decideNow: () => ar.decide({ inspection: ar.inspect(file), cfg: cfg(), freeMb: 4000 }),
      spawnChild: async (argv, from) => {
        calls.push(from);
        // 1st run: dies mid-run (lease left open); 2nd: ends clean
        ar.startLease(file, { pid: 424242, argv, resumedFrom: from });
        if (calls.length === 2) ar.finishLease(file, 'finished', { pid: 424242 });
        return { code: calls.length === 1 ? null : 0, signal: calls.length === 1 ? 'SIGKILL' : null };
      },
    });
    assert.equal(res.runs, 2);
    assert.equal(res.ended, 'finished');
    assert.equal(calls[0], null);
    assert.equal(calls[1].why, 'supervisor');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).restarts.length, 1);
  });

  it('install no Windows: um .cmd na pasta Inicializar, um por projeto; fora dele só a linha do crontab', () => {
    const startup = tmpDir('oxe-ar-startup-');
    const proj = tmpDir('oxe-ar-proj-');
    const w = ar.install({ projectDir: proj, platform: 'win32', startupDir: startup, cliPath: CLI });
    assert.equal(w.installed, true);
    const body = fs.readFileSync(w.file, 'utf8');
    assert.match(body, /runtime" "autoresume" "run" "--dir"/);
    assert.equal(ar.installed({ projectDir: proj, platform: 'win32', startupDir: startup }), w.file);
    assert.equal(ar.uninstall({ projectDir: proj, platform: 'win32', startupDir: startup }).removed, true);
    const l = ar.install({ projectDir: proj, platform: 'linux', cliPath: CLI });
    assert.equal(l.installed, false);
    assert.match(l.crontab, /^@reboot /);
  });
});

// --- CA-1: a simulated restart in a test program ------------------------------------------------------------------

const SHIM = `
const fs = require('fs');
let input = '';
if (process.argv.includes('--version')) { console.log('9.9.9 (shim)'); process.exit(0); }
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const task = /marcador-T2/.test(input) ? 'T2' : 'T1';
  fs.appendFileSync(process.env.OXE_SHIM_LOG, JSON.stringify({ task }) + '\\n');
  // the "restart": the first call of T2 kills the execute (TerminateProcess / SIGKILL: no handler runs)
  if (task === 'T2' && !fs.existsSync(process.env.OXE_SHIM_MARK)) {
    fs.writeFileSync(process.env.OXE_SHIM_MARK, '1');
    const lease = JSON.parse(fs.readFileSync(process.env.OXE_SHIM_LEASE, 'utf8'));
    try { process.kill(lease.pid, 'SIGKILL'); } catch {}
    process.exit(0);
  }
  const file = task === 'T2' ? 'src/b.js' : 'src/a.js';
  const result = input.includes('TOOL RESULT (write_file')
    ? JSON.stringify({ content: 'ok', tool_calls: [{ name: 'finish_task', arguments: { summary: file + ' criado' } }] })
    : JSON.stringify({ content: '', tool_calls: [{ name: 'write_file', arguments: { path: file, content: 'const value = 1;\\nmodule.exports = { value };\\n' } }] });
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: 0 }));
});
`;

const SELF_EVAL = '## Autoavaliação do Plano\n\n**Melhor plano atual:** sim\n**Confiança:** 95%\n**Principais incertezas:** nenhuma\n**Alternativas descartadas:** nenhuma\n**Condição para replanejar:** spec muda\n\n| Dimensão | Nota |\n|---|---|\n| Completude dos requisitos | 5 |\n| Dependências conhecidas | 5 |\n| Risco técnico | 5 |\n| Impacto no código existente | 5 |\n| Clareza da validação / testes | 5 |\n| Lacunas externas / decisões pendentes | 5 |\n\n<confidence_vector>\n<global score="0.95"/>\n'
  + ['requirements', 'dependencies', 'technical_risk', 'code_impact', 'validation', 'open_gaps'].map((n) => `<dimension name="${n}" score="0.95"/>\n`).join('') + '</confidence_vector>\n';
const SPEC = '# OXE — SPEC\n\n## Objetivo\n\nFixture do G24.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | Processo termina com 0 | `node -e "process.exit(0)"` |\n';
const task = (id, file, wave, dep) => `### ${id} — Criar ${file}\n\n- **Arquivos alvo:** \`${file}\`\n- **Depende de:** ${dep}\n- **Onda:** ${wave}\n- **Implementar:** exportar 1 (marcador-${id})\n- **Verificar:**\n  - Comando: \`node -e "process.exit(0)"\`\n- **Aceite vinculado:** A1\n`;
const PLAN = `# OXE — PLAN\n\n## Resumo\n\nDuas tarefas.\n\n${task('T1', 'src/a.js', 1, '—')}\n${task('T2', 'src/b.js', 2, 'T1')}\n${SELF_EVAL}`;
// the packs the execute preflight requires: closed write sets, anchors and fixtures not applicable
function writePacks(oxeDir) {
  const t = (id, file) => ({ id, title: id, mode: 'mutating', ready: true, exact_paths: [file], write_set: 'closed', symbols: [{ kind: 'const', name: 'value', path: file, signature: 'number' }], contracts: [{ name: `${id}-c`, input_shape: 'void', output_shape: 'void', invariants: ['none'], not_allowed: ['none'] }], snippets: [], expected_checks: ['node -e "process.exit(0)"'], requires_fixture: false, critical_gaps: [] });
  fs.writeFileSync(path.join(oxeDir, 'IMPLEMENTATION-PACK.md'), '# implementation\n');
  fs.writeFileSync(path.join(oxeDir, 'IMPLEMENTATION-PACK.json'), JSON.stringify({ schema_version: '1', generated_at: '2026-11-14T12:00:00Z', ready: true, critical_gaps: [], tasks: [t('T1', 'src/a.js'), t('T2', 'src/b.js')] }));
  fs.writeFileSync(path.join(oxeDir, 'REFERENCE-ANCHORS.md'), '<reference_anchors version="1" ready="true" status="not_applicable"></reference_anchors>\n');
  fs.writeFileSync(path.join(oxeDir, 'FIXTURE-PACK.md'), '# fixture\n');
  fs.writeFileSync(path.join(oxeDir, 'FIXTURE-PACK.json'), JSON.stringify({ schema_version: '1', generated_at: '2026-11-14T12:00:00Z', ready: true, critical_gaps: [], fixtures: [] }));
}

function shimExecutable(dir, js) {
  if (process.platform === 'win32') {
    const f = path.join(dir, 'claude.cmd');
    fs.writeFileSync(f, `@"${process.execPath}" "${js}" %*\r\n`);
    return f;
  }
  const f = path.join(dir, 'claude');
  fs.writeFileSync(f, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
  fs.chmodSync(f, 0o755);
  return f;
}

describe('G24 · CA-1: reinício simulado num programa de teste', () => {
  it('o execute morto em T2 é retomado em T2 pelo autoresume run, sem refazer T1', () => {
    const tmp = tmpDir('oxe-ar-ca1-');
    const shimDir = tmpDir('oxe-ar-shim-');
    fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.oxe', 'SPEC.md'), SPEC);
    fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.md'), PLAN);
    fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# OXE — STATE\n\n- **phase:** plan_ready\n');
    writePacks(path.join(tmp, '.oxe'));
    // PLAN.json: where each completed task is marked done as it completes (OXB-025) — what the relaunch skips
    const verify = { commands: ['node -e "process.exit(0)"'] };
    fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [
      { id: 'T1', title: 'Criar src/a.js', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify },
      { id: 'T2', title: 'Criar src/b.js (marcador-T2)', wave: 2, depends_on: ['T1'], files: ['src/b.js'], acceptance: ['A1'], verify },
    ] }, null, 2));
    // the memory rule is tested above; here it must not depend on this machine's free memory
    fs.writeFileSync(path.join(tmp, '.oxe', 'config.json'), JSON.stringify({ autoresume: { min_free_mb: 1, wait_memory_minutes: 0 } }));
    const js = path.join(shimDir, 'shim.js');
    fs.writeFileSync(js, SHIM);
    const log = path.join(shimDir, 'calls.ndjson');
    const lease = ar.leasePath(op.operationalPaths(tmp, null).executionRoot);
    const env = { ...process.env, NO_COLOR: '1', OXE_CLAUDE_BIN: shimExecutable(shimDir, js), OXE_SHIM_LOG: log, OXE_SHIM_MARK: path.join(shimDir, 'killed'), OXE_SHIM_LEASE: lease };
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
    delete env.OXE_BASE_URL;

    // 1) the run before the "restart": T1 done, killed during T2
    const first = spawnSync(process.execPath, [CLI, 'runtime', 'execute', '--adapter', 'claude', '--dir', tmp], { env, encoding: 'utf8', timeout: 180000 });
    assert.ok(fs.existsSync(path.join(shimDir, 'killed')), `o shim não chegou a T2:\n${first.stdout}\n${first.stderr}\n${JSON.stringify(op.readEvents(tmp, null).filter((e) => /Verif|Blocked|Failed/.test(e.type)).slice(-3))}`.slice(0, 6000));
    assert.equal(ar.inspect(lease).state, 'interrupted', 'o kill deixa o lease aberto');
    const status = spawnSync(process.execPath, [CLI, 'runtime', 'autoresume', 'status', '--json', '--dir', tmp], { env, encoding: 'utf8' });
    const st = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')));
    assert.equal(st.state, 'interrupted');
    assert.equal(st.decision.resume, true, st.decision.why);
    assert.equal(st.next_task.id, 'T2');

    // 2) after the "restart": the logon entry runs autoresume run
    const run = spawnSync(process.execPath, [CLI, 'runtime', 'autoresume', 'run', '--dir', tmp], { env, encoding: 'utf8', timeout: 180000 });
    const out = `${run.stdout}\n${run.stderr}`;
    assert.match(out, /retomando o execute em T2/, out);
    assert.equal(fs.readFileSync(path.join(tmp, 'src', 'b.js'), 'utf8'), 'const value = 1;\nmodule.exports = { value };\n');
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).task);
    assert.equal(calls.filter((t) => t === 'T1').length, 2, `T1 não roda de novo: ${calls}`);
    const end = JSON.parse(fs.readFileSync(lease, 'utf8'));
    assert.equal(end.status, 'finished');
    assert.equal(end.restarts.length, 1);
    const resumed = op.readEvents(tmp, null).filter((e) => e.type === 'AutoResumed');
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0].payload.next_task, 'T2');
    // 3) nothing left to resume
    const again = spawnSync(process.execPath, [CLI, 'runtime', 'autoresume', 'run', '--dir', tmp], { env, encoding: 'utf8' });
    assert.match(again.stdout, /terminou \(finished\)/);
  });

  it('uma fase pausada nunca é retomada: autoresume run sai com 2 e não relança', () => {
    const tmp = tmpDir('oxe-ar-paused-');
    fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.oxe', 'config.json'), JSON.stringify({ autoresume: { min_free_mb: 1 } }));
    const lease = ar.leasePath(op.operationalPaths(tmp, null).executionRoot);
    ar.startLease(lease, { pid: deadPid(), argv: ['runtime', 'execute', '--dir', tmp], cwd: tmp });
    op.appendEvent(tmp, null, { type: 'RunPaused', payload: { reason: 'quota', resume_at: '2026-11-15T03:00:00Z' } });
    const run = spawnSync(process.execPath, [CLI, 'runtime', 'autoresume', 'run', '--dir', tmp], { env: { ...process.env, NO_COLOR: '1' }, encoding: 'utf8' });
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stdout, /nunca é retomada sozinha/);
    assert.equal(ar.inspect(lease).state, 'interrupted');
    assert.equal(op.readEvents(tmp, null).filter((e) => e.type === 'AutoResumeSkipped').length, 1);
  });
});

describe('the run is live during the execute; one execute per worktree (OxeSpace 15/11)', () => {
  it('markRunLive writes running with the task as cursor, never over a pause requested during this execute', () => {
    const d = tmpDir('oxe-ar-live-');
    fs.mkdirSync(path.join(d, '.oxe'), { recursive: true });
    const old = '2026-11-15T02:00:00.000Z';
    op.writeRunState ? null : null;
    fs.mkdirSync(path.join(d, '.oxe', 'runs'), { recursive: true });
    const put = (status, at) => { const rs = { run_id: 'oxe-run-x', status, updated_at: at }; fs.writeFileSync(path.join(d, '.oxe', 'runs', 'oxe-run-x.json'), JSON.stringify(rs)); fs.writeFileSync(path.join(d, '.oxe', 'ACTIVE-RUN.json'), JSON.stringify(rs)); };
    put('paused', old);
    const since = Date.parse('2026-11-15T03:00:00.000Z');
    op.markRunLive(d, null, 'T8', since);
    const live = op.readRunState(d, null);
    assert.equal(live.status, 'running', 'an old pause (before this execute) does not hold');
    assert.equal(live.cursor.task, 'T8');
    put('paused', '2026-11-15T03:05:00.000Z');
    op.markRunLive(d, null, 'T9', since);
    assert.equal(op.readRunState(d, null).status, 'paused', 'a pause requested during this execute is kept');
  });

  it('a second runtime execute in the same worktree is refused while the lease of a live process is open', () => {
    const d = tmpDir('oxe-ar-second-');
    fs.mkdirSync(path.join(d, '.oxe'), { recursive: true });
    ar.startLease(ar.leasePath(op.operationalPaths(d, null).executionRoot), { pid: process.pid, argv: ['runtime', 'execute'] });
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'execute', '--dir', d], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(`outro runtime execute já roda nesta worktree (pid ${process.pid}`), r.stderr);
  });
});
