'use strict';

/**
 * 1.21.2 (G24, OXE-143): `runtime execute` resumes the phase by itself after a restart of the machine or a kill for
 * memory. A night of three runs in a row lost ~6 h to one restart: the run died, nothing relaunched it, and nothing
 * on disk even said it had been running.
 *
 *   - Every `runtime execute` holds a lease (EXECUTE-LEASE.json next to ACTIVE-RUN.json): its pid, the arguments to
 *     run it again (never a secret), and the state. A clean end closes it (finished / paused / blocked / failed).
 *     A lease still "running" whose pid is gone means the run was cut: a restart or a kill.
 *   - `runtime autoresume run` relaunches the cut run with the same arguments. The execute itself skips what is done,
 *     so the run starts at the next task that is not done (an interrupted task's leftovers stay its work, OXB-170).
 *   - `runtime execute --supervise` keeps a light parent that relaunches the child when it dies mid-run (the kill for
 *     memory with the machine still on); `runtime autoresume install` runs `autoresume run` at logon (the restart).
 *
 * Never resumed: a paused run (`runtime pause`, a quota or environment pause, a checkpoint waiting for approval), a
 * lease that ended cleanly, `autoresume.enabled: false`, more than `max_restarts` in `window_hours` (a crash loop),
 * or below the memory rule: it waits up to `wait_memory_minutes` for `min_free_mb` free, then gives up and says so.
 *
 * `.oxe/config.json`:
 *   "autoresume": { "enabled": true, "min_free_mb": 2560, "wait_memory_minutes": 30, "max_restarts": 3, "window_hours": 6 }
 * `min_free_mb` falls back to `parallel.min_free_mb`, then OXE_EXECUTOR_MIN_FREE_MB, then 2560 (2.5 GB).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LEASE_FILE = 'EXECUTE-LEASE.json';
const DEFAULT_MIN_FREE_MB = 2560;
// flags never copied into the lease: a secret, and the supervisor's own switch
const SECRET_FLAGS = new Set(['--api-key']);
const DROP_FLAGS = new Set(['--supervise']);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function config(projectConfig = {}, env = process.env) {
  const a = projectConfig.autoresume && typeof projectConfig.autoresume === 'object' ? projectConfig.autoresume : {};
  const p = projectConfig.parallel && typeof projectConfig.parallel === 'object' ? projectConfig.parallel : {};
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return {
    enabled: a.enabled !== false,
    minFreeMb: num(a.min_free_mb, num(p.min_free_mb, num(env.OXE_EXECUTOR_MIN_FREE_MB, DEFAULT_MIN_FREE_MB))),
    waitMemoryMinutes: a.wait_memory_minutes === 0 ? 0 : num(a.wait_memory_minutes, 30),
    maxRestarts: num(a.max_restarts, 3),
    windowHours: num(a.window_hours, 6),
  };
}

/** The arguments to run this execute again: without a secret and without --supervise. */
function relaunchArgv(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i]);
    const [flag] = a.split('=');
    if (SECRET_FLAGS.has(flag)) { if (!a.includes('=')) i += 1; continue; }
    if (DROP_FLAGS.has(flag)) continue;
    out.push(a);
  }
  return out;
}

const defaultAlive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return Boolean(e && e.code === 'EPERM'); }
};

function leasePath(executionRoot) {
  return path.join(executionRoot, LEASE_FILE);
}

/** Opens the lease of this execute; keeps the restart history of a run it resumes. */
function startLease(file, { pid = process.pid, argv = [], cwd = process.cwd(), session = null, now = new Date(), resumedFrom = null } = {}) {
  const old = readJson(file);
  const restarts = resumedFrom && old && Array.isArray(old.restarts) ? old.restarts : [];
  const lease = {
    schema: 1,
    status: 'running',
    pid,
    host: os.hostname(),
    cwd,
    session,
    argv: relaunchArgv(argv),
    // this execute stops before its next task on a `runtime pause` (an older one does not read the pause)
    reads_pause: true,
    started_at: now.toISOString(),
    restarts: resumedFrom ? [...restarts, { at: now.toISOString(), from_pid: resumedFrom.pid || null, why: resumedFrom.why || 'interrupted' }] : [],
  };
  writeJson(file, lease);
  return lease;
}

/** Closes the lease (only this process's own: a newer execute's lease is never touched). */
function finishLease(file, status, { pid = process.pid, now = new Date(), detail = null } = {}) {
  const lease = readJson(file);
  if (!lease || lease.pid !== pid) return null;
  const next = { ...lease, status, ended_at: now.toISOString(), ...(detail ? { detail } : {}) };
  writeJson(file, next);
  return next;
}

/** The state the run's process status maps to on a clean end. */
function endStatus(result) {
  const r = (result && result.result) || {};
  if (r.status === 'paused') return 'paused';
  if ((r.failed || []).length) return 'failed';
  if ((r.blocked || []).length || r.status === 'blocked') return 'blocked';
  return 'finished';
}

/** none | running (alive) | interrupted (running, pid gone) | ended (closed cleanly). */
function inspect(file, { alive = defaultAlive } = {}) {
  const lease = readJson(file);
  if (!lease) return { state: 'none', lease: null };
  // a crash of the runtime is a cut run, like a kill: resumable (under the crash-loop limit)
  if (lease.status === 'crashed') return { state: 'interrupted', lease, crashed: true };
  if (lease.status !== 'running') return { state: 'ended', lease };
  // a lease from another machine (a shared folder) is never judged by a local pid
  if (lease.host && lease.host !== os.hostname()) return { state: 'running', lease, foreign_host: true };
  return { state: alive(lease.pid) ? 'running' : 'interrupted', lease };
}

/**
 * Is the run paused? The run state (`runtime pause`, a checkpoint waiting for approval), or a pause event after the
 * lease started with no resume after it (the scheduler's quota/environment pause, OXB-120).
 */
function pausedReason(runState, events = [], since = null) {
  const st = runState && String(runState.status || '');
  if (st === 'paused') return 'o run está pausado (runtime pause): retome com oxe-cc runtime resume';
  if (st === 'waiting_approval') return 'o run espera aprovação de checkpoint: aprove antes de retomar';
  const t0 = since ? Date.parse(since) : 0;
  let paused = null;
  for (const e of events) {
    const at = Date.parse(e.timestamp || e.at || e.ts || '') || 0;
    if (t0 && at && at < t0) continue;
    if (e.type === 'RunPaused' || e.type === 'run_paused') paused = e;
    else if (e.type === 'run_resumed' || e.type === 'RunResumed' || e.type === 'AutoResumed') paused = null;
  }
  if (!paused) return null;
  const p = paused.payload || {};
  return `a fase foi pausada${p.reason ? ` (${p.reason === 'quota' ? 'cota do provedor' : p.reason})` : ''}${p.resume_at ? `, retoma em ${p.resume_at}` : ''}: uma fase pausada nunca é retomada sozinha`;
}

/** The first task not done, in plan order, within the relaunch's --wave / --task. */
function nextTask(planDoc, argv = [], { completed = [] } = {}) {
  const doneIds = new Set(completed.map((id) => String(id).toUpperCase()));
  const tasks = ((planDoc && Array.isArray(planDoc.tasks)) ? planDoc.tasks : [])
    .map((t) => (doneIds.has(String(t.id).toUpperCase()) ? { ...t, done: true } : t));
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const onlyTask = at('--task');
  const wave = at('--wave') != null ? Number(at('--wave')) : null;
  const pending = tasks.filter((t) => !(t.done === true || t.status === 'done'))
    .filter((t) => !onlyTask || String(t.id).toUpperCase() === String(onlyTask).toUpperCase())
    .filter((t) => wave == null || Number(t.wave) === wave);
  return pending.length ? { id: pending[0].id, title: pending[0].title || '', pending: pending.length } : null;
}

/** Without PLAN.json: the tasks of PLAN.md (`### Tn — title`, `**Onda:** n`), in order. */
function tasksFromPlanMd(md) {
  const out = [];
  for (const block of String(md || '').split(/^### /m).slice(1)) {
    const m = block.match(/^(T\d+)\s*[—–-]\s*([^\n]*)/);
    if (!m) continue;
    const w = block.match(/\*\*Onda:\*\*\s*(\d+)/);
    out.push({ id: m[1], title: m[2].trim(), wave: w ? Number(w[1]) : null });
  }
  return { tasks: out };
}

/**
 * Decides whether an interrupted run is resumed now. Pure: the caller passes the inspection, the run state, the
 * events, the config and the free memory.
 */
function decide({ inspection, runState = null, events = [], cfg, freeMb, now = new Date() }) {
  if (!inspection || inspection.state === 'none') return { resume: false, why: 'nenhum execute registrado aqui (sem lease)' };
  if (inspection.state === 'running') return { resume: false, why: inspection.foreign_host ? `o lease é de outra máquina (${inspection.lease.host})` : `o execute ainda está rodando (pid ${inspection.lease.pid})` };
  if (inspection.state === 'ended') return { resume: false, why: `o último execute terminou (${inspection.lease.status}): nada a retomar` };
  if (!cfg.enabled) return { resume: false, why: 'autoresume.enabled: false' };
  const lease = inspection.lease;
  const paused = pausedReason(runState, events, lease.started_at);
  if (paused) return { resume: false, why: paused, paused: true };
  const windowMs = cfg.windowHours * 3600_000;
  const recent = (lease.restarts || []).filter((r) => now.getTime() - Date.parse(r.at) < windowMs);
  if (recent.length >= cfg.maxRestarts) return { resume: false, why: `${recent.length} retomada(s) em ${cfg.windowHours} h (autoresume.max_restarts ${cfg.maxRestarts}): parece um laço de queda — olhe o log antes de rodar de novo`, crash_loop: true };
  if (freeMb < cfg.minFreeMb) return { resume: false, why: `memória livre ${freeMb} MB < ${cfg.minFreeMb} MB (regra de memória)`, wait: 'memory' };
  return { resume: true, why: inspection.crashed ? `o runtime caiu (crash) no execute do pid ${lease.pid}` : `execute interrompido (pid ${lease.pid} não existe mais)` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for the memory rule, polling; the decision is re-taken each time (a pause in the meantime wins).
 * @param {() => object} decideNow  returns decide(...) with fresh inputs
 */
async function waitForResume(decideNow, { waitMs, pollMs = 30_000, wait = sleep, onWait = null } = {}) {
  const t0 = Date.now();
  let d = decideNow();
  let waited = 0;
  while (!d.resume && d.wait === 'memory' && waited < waitMs) {
    if (onWait) onWait(d);
    const step = Math.min(pollMs, waitMs - waited);
    await wait(step);
    waited += step;
    d = decideNow();
  }
  if (!d.resume && d.wait === 'memory') d = { ...d, why: `${d.why}; esperou ${Math.round((Date.now() - t0 || waited) / 60000)} min (autoresume.wait_memory_minutes) e não retomou` };
  return d;
}

// --- install at logon -----------------------------------------------------------------------------------------------

function installName(projectDir, session) {
  const h = crypto.createHash('sha1').update(`${path.resolve(projectDir).toLowerCase()}|${session || ''}`).digest('hex').slice(0, 8);
  return `oxe-autoresume-${path.basename(path.resolve(projectDir)).replace(/[^\w.-]/g, '_')}-${h}`;
}

function windowsStartupDir(env = process.env) {
  return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function runCommand({ nodePath, cliPath, projectDir, session }) {
  return [nodePath, cliPath, 'runtime', 'autoresume', 'run', '--dir', path.resolve(projectDir), ...(session ? ['--session', session] : [])];
}

/**
 * Windows: a .cmd in the user's Startup folder (no admin, visible window, one per project). Elsewhere: the @reboot
 * line for the crontab, printed and not written (the crontab is the person's).
 */
function install({ projectDir, session = null, platform = process.platform, startupDir = null, nodePath = process.execPath, cliPath, env = process.env }) {
  const name = installName(projectDir, session);
  const cmd = runCommand({ nodePath, cliPath, projectDir, session });
  if (platform === 'win32') {
    const dir = startupDir || windowsStartupDir(env);
    const file = path.join(dir, `${name}.cmd`);
    const q = (s) => `"${s}"`;
    const body = ['@echo off', `rem OXE autoresume (G24): relança o runtime execute interrompido de ${path.resolve(projectDir)}`, `cd /d ${q(path.resolve(projectDir))}`, `start "OXE autoresume" /min cmd /c "${cmd.map(q).join(' ')}"`, ''].join('\r\n');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, body);
    return { installed: true, platform, file, command: cmd };
  }
  const line = `@reboot cd ${JSON.stringify(path.resolve(projectDir))} && ${cmd.map((s) => JSON.stringify(s)).join(' ')} >> ${JSON.stringify(path.join(path.resolve(projectDir), '.oxe', 'autoresume.log'))} 2>&1`;
  return { installed: false, platform, crontab: line, command: cmd, why: 'fora do Windows o oxe-cc não escreve no crontab: adicione a linha com crontab -e' };
}

function uninstall({ projectDir, session = null, platform = process.platform, startupDir = null, env = process.env }) {
  if (platform !== 'win32') return { removed: false, why: 'remova a linha @reboot do crontab (crontab -e)' };
  const file = path.join(startupDir || windowsStartupDir(env), `${installName(projectDir, session)}.cmd`);
  const existed = fs.existsSync(file);
  if (existed) fs.rmSync(file, { force: true });
  return { removed: existed, file };
}

function installed({ projectDir, session = null, platform = process.platform, startupDir = null, env = process.env }) {
  if (platform !== 'win32') return null;
  const file = path.join(startupDir || windowsStartupDir(env), `${installName(projectDir, session)}.cmd`);
  return fs.existsSync(file) ? file : null;
}

// --- supervisor -----------------------------------------------------------------------------------------------------

/**
 * `runtime execute --supervise`: runs the execute as a child and relaunches it when it dies mid-run (its lease still
 * "running"), under the same decision as autoresume (pause, crash loop, memory). A clean end of the child ends it.
 * @param {{ spawnChild: (argv: string[], resumedFrom: object|null) => Promise<{ code: number|null, signal: string|null }>,
 *           decideNow: () => object, waitMs: number, pollMs?: number, wait?: Function, file: string, argv: string[],
 *           alive?: Function, log?: Function }} o
 */
async function supervise(o) {
  const log = o.log || (() => {});
  let resumedFrom = o.resumedFrom || null;
  let runs = 0;
  for (;;) {
    runs += 1;
    const exit = await o.spawnChild(o.argv, resumedFrom);
    const insp = inspect(o.file, { alive: o.alive || (() => false) });
    if (insp.state !== 'interrupted') return { runs, exit, ended: insp.lease ? insp.lease.status : null };
    log(`execute caiu (código ${exit.code}${exit.signal ? `, sinal ${exit.signal}` : ''}) no meio do run`);
    const d = await waitForResume(o.decideNow, { waitMs: o.waitMs, pollMs: o.pollMs, wait: o.wait, onWait: (x) => log(`esperando: ${x.why}`) });
    if (!d.resume) return { runs, exit, ended: 'interrupted', why: d.why };
    resumedFrom = { pid: insp.lease.pid, why: 'supervisor' };
    log(`retomando: ${d.why}`);
  }
}

/**
 * 1.23.0 (OXB-G04 / OXE-143): Idempotent post-restart reconciliation of a runtime phase.
 * Scans for orphan PID leases, expired `.lock` / `*.lock.json` files, and already-landed `OXE-Task` checkpoint commits,
 * returning the exact next checkpoint/task to resume safely without duplicating completed work.
 */
function reconcileOrphansAndResumePlan(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot);
  const session = options.session || null;
  const execRoot = session
    ? path.join(rootAbs, '.oxe', ...String(session).split('/'), 'runs')
    : path.join(rootAbs, '.oxe', 'runs');
  const alive = typeof options.alive === 'function' ? options.alive : defaultAlive;
  const now = options.now instanceof Date ? options.now : new Date();
  const lockTtlMs = Number(options.lockTtlMs) > 0 ? Number(options.lockTtlMs) : 12 * 3600_000;
  const apply = options.apply !== false;

  // 1. Reconcile orphan EXECUTE-LEASE.json
  const lFile = leasePath(execRoot);
  const insp = inspect(lFile, { alive });
  let reconciledLease = null;
  const leaseExpired = insp.lease && insp.lease.status === 'running' && insp.lease.started_at
    && (now.getTime() - Date.parse(insp.lease.started_at)) > lockTtlMs;
  if (insp.state === 'interrupted' || leaseExpired) {
    reconciledLease = {
      file: path.relative(rootAbs, lFile).replace(/\\/g, '/'),
      previous_pid: insp.lease ? insp.lease.pid : null,
      reason: leaseExpired ? 'lock_expired' : 'orphan_pid',
      reconciled: apply,
    };
    if (apply && insp.lease) {
      writeJson(lFile, {
        ...insp.lease,
        status: 'crashed',
        reconciled_at: now.toISOString(),
        reconciled_reason: reconciledLease.reason,
      });
    }
  }

  // 2. Clean expired or dead-PID lock files in .oxe/runs, .oxe/program, .oxe/plan
  const cleanedLocks = [];
  const lockDirs = [
    execRoot,
    path.join(rootAbs, '.oxe', 'program'),
    path.join(rootAbs, '.oxe', 'plan'),
    path.join(rootAbs, '.oxe'),
  ];
  for (const dir of lockDirs) {
    if (!fs.existsSync(dir)) continue;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!/\.lock(?:\.json)?$/i.test(name)) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        const lockObj = readJson(full);
        const lockPid = lockObj && Number.isInteger(lockObj.pid) ? lockObj.pid : null;
        const isDeadPid = lockPid != null && !alive(lockPid);
        const isExpired = (now.getTime() - st.mtimeMs) > lockTtlMs;
        if (isDeadPid || isExpired) {
          if (apply) fs.rmSync(full, { force: true });
          cleanedLocks.push({
            file: path.relative(rootAbs, full).replace(/\\/g, '/'),
            pid: lockPid,
            reason: isDeadPid ? 'orphan_pid' : 'expired_lock',
            removed: apply,
          });
        }
      } catch { /* ignore */ }
    }
  }

  // 3. Reconcile already-committed checkpoints from git log (`OXE-Task: T<n>`) against PLAN.json
  const planFile = session
    ? path.join(rootAbs, '.oxe', ...String(session).split('/'), 'plan', 'PLAN.json')
    : path.join(rootAbs, '.oxe', 'PLAN.json');
  const planDoc = readJson(planFile);
  const completedFromGit = new Set();
  if (Array.isArray(options.gitCommittedTasks)) {
    for (const id of options.gitCommittedTasks) completedFromGit.add(String(id).toUpperCase());
  } else if (planDoc && Array.isArray(planDoc.tasks)) {
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync('git', ['log', '-n', '50', '--format=%B'], { cwd: rootAbs, encoding: 'utf8', windowsHide: true });
      if (r.status === 0) {
        for (const m of String(r.stdout || '').matchAll(/^OXE-Task:\s*(T\d+(?:-[A-Z0-9-]+)?)/gim)) {
          completedFromGit.add(m[1].toUpperCase());
        }
      }
    } catch { /* not a git repo */ }
  }
  const reconciledCheckpoints = [];
  const completedAll = new Set(completedFromGit);
  if (planDoc && Array.isArray(planDoc.tasks)) {
    for (const t of planDoc.tasks) {
      if (!t || !t.id) continue;
      const tid = String(t.id).toUpperCase();
      if (t.done === true || t.status === 'done') {
        completedAll.add(tid);
      } else if (completedFromGit.has(tid)) {
        reconciledCheckpoints.push(tid);
      }
    }
  }

  const next = planDoc ? nextTask(planDoc, (insp.lease && insp.lease.argv) || [], { completed: [...completedAll] }) : null;
  const freshInsp = inspect(lFile, { alive });
  const cfg = config(options.projectConfig || {}, options.env || process.env);
  const freeMb = typeof options.freeMb === 'number' ? options.freeMb : Math.round(os.freemem() / (1024 * 1024));
  const decision = decide({
    inspection: freshInsp,
    runState: options.runState || null,
    events: options.events || [],
    cfg,
    freeMb,
    now,
  });

  return {
    ok: true,
    applied: apply,
    reconciled_lease: reconciledLease,
    cleaned_locks: cleanedLocks,
    reconciled_checkpoints: reconciledCheckpoints,
    resume_task: next,
    can_resume: Boolean(decision.resume && next),
    decision,
  };
}

module.exports = {
  LEASE_FILE,
  DEFAULT_MIN_FREE_MB,
  config,
  relaunchArgv,
  leasePath,
  startLease,
  finishLease,
  endStatus,
  inspect,
  pausedReason,
  nextTask,
  tasksFromPlanMd,
  decide,
  waitForResume,
  installName,
  install,
  uninstall,
  installed,
  supervise,
  reconcileOrphansAndResumePlan,
};
