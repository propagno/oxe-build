'use strict';

/**
 * 1.21.2 — remote verification: the heavy checks (e2e, packaged build, Android) run in the repository's CI on GitHub
 * instead of the developer's machine; the light ones (vitest, tsc, lint) stay local.
 *
 * Config (.oxe/config.json):
 *   "verify": { "remote": { "provider": "github", "workflow": "ci.yml", "ref": "branch", "wait_minutes": 60,
 *                            "required": false, "protected": ["release/*"] },
 *               "where": { "A7": "remote", "gate-e2e": "remote", "T4": "local" } }
 * and, per check / acceptance test / task in PLAN.json, `"where": "remote" | "local" | "both"` and `"remote_job": "<job>"`.
 * `both` runs the check here AND in the CI: red only in the CI is reported as `ci_only` (the CI's trace is kept).
 *
 * Safety (agreed with the coordination): never push to main/master or to a protected branch; never `--force` (a
 * rejected push leaves the checks "not verified"); the workflow is dispatched WITHOUT inputs — a release/publish
 * input is refused; a run already green on the same commit is reused, and the run the dispatch created is found by
 * commit + event `workflow_dispatch`, so CI is not paid twice. Any GitHub trouble (no gh, no auth, down, timeout)
 * makes the remote checks `not_verified` with the reason; the local verify goes on. No new token: the logged-in gh.
 */

const { spawnSync } = require('child_process');

const HEAVY_RE = /\b(e2e|playwright|cypress|detox|maestro|appium|android|gradlew|assemble(Debug|Release)?|bundle(Debug|Release)|electron-builder|packag(e|ed|ing)|smoke)\b/i;
const NEVER_PUSH = /^(main|master|trunk|develop)$/;
const FORBIDDEN_INPUT = /publish|release|deploy|tag/i;

function remoteConfig(cfg) {
  const v = cfg && cfg.verify && typeof cfg.verify === 'object' ? cfg.verify : null;
  const r = v && v.remote && typeof v.remote === 'object' ? v.remote : null;
  if (!r || r.enabled === false) return null;
  if ((r.provider || 'github') !== 'github') throw new Error(`verify.remote.provider "${r.provider}" desconhecido (github)`);
  if (!r.workflow) throw new Error('verify.remote.workflow ausente (ex.: "ci.yml")');
  const inputs = r.inputs && typeof r.inputs === 'object' ? r.inputs : {};
  const bad = Object.keys(inputs).filter((k) => FORBIDDEN_INPUT.test(k));
  if (bad.length) throw new Error(`verify.remote.inputs não pode conter ${bad.join(', ')}: o verify remoto nunca publica, lança ou faz deploy`);
  return {
    provider: 'github',
    workflow: String(r.workflow),
    wait_minutes: Number(r.wait_minutes) > 0 ? Number(r.wait_minutes) : 60,
    required: r.required === true,
    detach: r.detach === true,
    poll_seconds: Number(r.poll_seconds) > 0 ? Number(r.poll_seconds) : 30,
    // artifacts downloaded when a job fails (gh run download -p <pattern>); [] turns it off
    artifacts: Array.isArray(r.artifacts) ? r.artifacts.map(String) : ['*trace*', '*playwright-report*', '*test-results*', '*screenshot*'],
    protected: Array.isArray(r.protected) ? r.protected.map(String) : [],
    inputs,
    where: v.where && typeof v.where === 'object' ? v.where : {},
  };
}

/**
 * Where a check runs: explicit `where` (check, its criterion or task in PLAN.json, or verify.where by id) wins;
 * otherwise heavy commands go remote and the rest stays local.
 * @param {{ id: string, acceptance_ref?: string|null, command?: string|null, where?: string }} check
 * @param {{ byCriterion?: Map, byTask?: Map }} plan
 */
function whereFor(check, rcfg, plan = {}) {
  // nothing to run (manual criterion, files-only check): never sent to the CI
  if (!check.command) return 'local';
  const explicit = check.where
    || rcfg.where[check.id]
    || (check.acceptance_ref && (rcfg.where[check.acceptance_ref] || (plan.byCriterion && plan.byCriterion.get(check.acceptance_ref))))
    || (() => { const t = /^(T\d+)\b/.exec(String(check.id || '')); return t ? rcfg.where[t[1]] || (plan.byTask && plan.byTask.get(t[1])) : null; })();
  if (explicit === 'remote' || explicit === 'local' || explicit === 'both') return explicit;
  const cmd = String(check.command || '');
  if (!cmd) return 'local';
  // a heavy command goes remote even when it also mentions a light runner ("vitest run e2e/…")
  return HEAVY_RE.test(cmd) ? 'remote' : 'local';
}

/** `where` / `remote_job` declared in PLAN.json (acceptance_tests[] by criterion, tasks[] by id). */
function planHints(doc) {
  const byCriterion = new Map();
  const byTask = new Map();
  const jobs = new Map();
  for (const t of (doc && doc.acceptance_tests) || []) {
    if (t && t.criterion && ['remote', 'local', 'both'].includes(t.where)) byCriterion.set(t.criterion, t.where);
    if (t && t.criterion && t.remote_job) jobs.set(t.criterion, String(t.remote_job));
  }
  for (const t of (doc && doc.tasks) || []) {
    if (t && t.id && ['remote', 'local', 'both'].includes(t.where)) byTask.set(t.id, t.where);
    if (t && t.id && t.remote_job) jobs.set(t.id, String(t.remote_job));
  }
  return { byCriterion, byTask, jobs };
}

const globToRe = (g) => new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

function sh(spawn, cmd, args, cwd, timeout) {
  const r = spawn(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: timeout || 60_000 });
  return { ok: Boolean(r) && r.status === 0 && !r.error, status: r ? r.status : null, stdout: String((r && r.stdout) || ''), stderr: String((r && (r.stderr || (r.error && r.error.message))) || ''), timedOut: Boolean(r && r.error && /ETIMEDOUT|timed out/i.test(String(r.error.message || r.error.code || ''))) || Boolean(r && r.signal === 'SIGTERM') };
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };

/**
 * Runs the remote checks through the repository's workflow. Synchronous (spawnSync), with an injectable `spawn`.
 * @returns {{ status: 'verified'|'not_verified', reason?: string, run?: {id, url, reused, head}, results: Array }}
 */
function runRemote(input) {
  const { checks, rcfg } = input;
  const cwd = input.cwd;
  const spawn = input.spawn || spawnSync;
  const sleep = input.sleep || ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const jobOf = (c) => c.remote_job || (input.jobs && (input.jobs.get(c.acceptance_ref) || input.jobs.get((/^(T\d+)/.exec(c.id) || [])[1]))) || c.id;
  const notVerified = (reason, extra = {}) => ({ status: 'not_verified', reason, ...extra, results: checks.map((c) => ({ check: c, job: jobOf(c), status: 'not_verified', reason })) });
  if (!checks.length) return { status: 'verified', results: [] };

  const gh = sh(spawn, 'gh', ['auth', 'status'], cwd, 20_000);
  if (!gh.ok) return notVerified(`gh indisponível ou sem login (${(gh.stderr || 'sem saída').split('\n')[0].slice(0, 160)})`);
  const branch = sh(spawn, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd).stdout.trim();
  const head = sh(spawn, 'git', ['rev-parse', 'HEAD'], cwd).stdout.trim();
  if (!branch || branch === 'HEAD' || !head) return notVerified('HEAD destacado ou fora de um repositório git');
  if (NEVER_PUSH.test(branch) || rcfg.protected.some((g) => globToRe(g).test(branch))) return notVerified(`o branch ${branch} é protegido: o verify remoto nunca empurra para ele — verifique a partir do branch da fase`);
  const prot = sh(spawn, 'gh', ['api', `repos/{owner}/{repo}/branches/${encodeURIComponent(branch)}`, '--jq', '.protected'], cwd, 20_000);
  if (prot.ok && prot.stdout.trim() === 'true') return notVerified(`o branch ${branch} é protegido no GitHub: o verify remoto nunca empurra para ele`);

  // push: only to a branch that already has an upstream, unless --push; never --force
  const upstream = sh(spawn, 'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
  if (!upstream.ok && !input.push) return notVerified(`o branch ${branch} não tem upstream — rode o verify com --push para publicá-lo (nunca com --force)`);
  const ahead = upstream.ok ? Number(sh(spawn, 'git', ['rev-list', '--count', '@{u}..HEAD'], cwd).stdout.trim() || 0) : 1;
  let pushed = false;
  if (ahead > 0) {
    const args = upstream.ok ? ['push'] : ['push', '--set-upstream', 'origin', branch];
    const p = sh(spawn, 'git', args, cwd, 120_000);
    if (!p.ok) return notVerified(`push recusado (${(p.stderr || '').split('\n').find((l) => /rejected|denied|error|fatal/i.test(l)) || 'sem detalhe'}) — o verify remoto não reescreve o histórico; integre o remoto e rode de novo`);
    pushed = true;
  }

  const listRuns = () => json(sh(spawn, 'gh', ['run', 'list', '--workflow', rcfg.workflow, '--branch', branch, '--limit', '20', '--json', 'databaseId,headSha,event,status,conclusion,url'], cwd, 30_000).stdout) || [];
  // reuse: a run already green on this commit (any event); or one dispatched for this commit still running
  let runs = listRuns().filter((r) => r.headSha === head);
  let run = runs.find((r) => r.status === 'completed' && r.conclusion === 'success') || null;
  const reused = Boolean(run);
  if (!run) run = runs.find((r) => r.event === 'workflow_dispatch' && r.status !== 'completed') || null;
  if (!run) {
    // dispatched WITHOUT inputs (only the ones configured, never a publish/release one — refused in remoteConfig)
    const args = ['workflow', 'run', rcfg.workflow, '--ref', branch];
    for (const [k, v] of Object.entries(rcfg.inputs)) args.push('-f', `${k}=${v}`);
    const d = sh(spawn, 'gh', args, cwd, 30_000);
    if (!d.ok) return notVerified(`gh workflow run falhou (${(d.stderr || '').split('\n')[0].slice(0, 160)}) — o workflow aceita workflow_dispatch?`);
    for (let i = 0; i < 10 && !run; i += 1) {
      sleep(i === 0 ? 3000 : 6000);
      run = listRuns().find((r) => r.headSha === head && r.event === 'workflow_dispatch') || null;
    }
    if (!run) return notVerified('o run disparado não apareceu na lista do GitHub em 1 minuto');
  }
  const runInfo = { id: run.databaseId, url: run.url, reused, head, pushed };
  if (input.stateFile) writeState(input.stateFile, { run: runInfo, workflow: rcfg.workflow, branch, at: new Date().toISOString() });
  // OXB-f: a light, resumable poll (one short `gh run view` at a time, state on disk) — no long-lived watcher that
  // the machine's memory pressure can kill. detach: dispatch and return; the next verify picks the same run up.
  if (run.status !== 'completed') {
    if (rcfg.detach) return notVerified(`run em andamento (${run.url}) — rode o verify de novo para ler o resultado (verify.remote.detach)`, { run: runInfo, pending: true });
    const deadline = (input.now || Date.now)() + rcfg.wait_minutes * 60_000;
    let status = run.status;
    while (status !== 'completed') {
      if ((input.now || Date.now)() >= deadline) return notVerified(`tempo esgotado (${rcfg.wait_minutes} min) — o run ${run.url} segue no GitHub; rode o verify de novo para ler o resultado`, { run: runInfo, pending: true });
      sleep(rcfg.poll_seconds * 1000);
      const v = json(sh(spawn, 'gh', ['run', 'view', String(run.databaseId), '--json', 'status,conclusion'], cwd, 30_000).stdout);
      if (v && v.status) status = v.status;
    }
  }
  const view = json(sh(spawn, 'gh', ['run', 'view', String(run.databaseId), '--json', 'jobs,url,conclusion,status'], cwd, 30_000).stdout);
  if (!view || !Array.isArray(view.jobs)) return notVerified('não foi possível ler os jobs do run', { run: runInfo });
  const results = checks.map((c) => {
    const want = jobOf(c);
    const job = view.jobs.find((j) => j.name === want) || view.jobs.find((j) => String(j.name).toLowerCase().includes(String(want).toLowerCase()));
    if (!job) return { check: c, job: want, status: 'not_verified', reason: `o workflow ${rcfg.workflow} não tem o job "${want}" (remote_job)` };
    const url = job.url || view.url || run.url;
    if (job.conclusion === 'success') return { check: c, job: job.name, status: 'pass', url };
    if (['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(job.conclusion)) return { check: c, job: job.name, status: 'fail', url, reason: `job ${job.name}: ${job.conclusion}` };
    return { check: c, job: job.name, status: 'not_verified', url, reason: `job ${job.name}: ${job.conclusion || job.status || 'sem conclusão'}` };
  });
  // OXB-e: a red job keeps the CI's own evidence (trace, report, screenshots) next to the verify, so the failure is
  // read where it happened instead of "reproduce locally" — a slow Windows runner fails what a fast machine passes.
  let artifacts = null;
  if (results.some((r) => r.status === 'fail') && input.artifactsDir && rcfg.artifacts.length) {
    const args = ['run', 'download', String(run.databaseId), '--dir', input.artifactsDir];
    for (const p of rcfg.artifacts) args.push('-p', p);
    const d = sh(spawn, 'gh', args, cwd, 300_000);
    artifacts = d.ok ? { dir: input.artifactsDir } : { error: (d.stderr || 'sem detalhe').split('\n')[0].slice(0, 160) };
  }
  if (input.stateFile) writeState(input.stateFile, { run: { ...runInfo, url: view.url || run.url }, workflow: rcfg.workflow, branch, at: new Date().toISOString(), done: true, conclusion: view.conclusion || null });
  return { status: 'verified', run: { ...runInfo, url: view.url || run.url }, results, ...(artifacts ? { artifacts } : {}) };
}

function writeState(file, data) {
  try { require('fs').mkdirSync(require('path').dirname(file), { recursive: true }); require('fs').writeFileSync(file, JSON.stringify(data, null, 2)); } catch { /* auxiliary */ }
}

/** A remote result as a runtime CheckResult (merged into the verify report). */
function toCheckResult(r, run) {
  const link = r.url || (run && run.url) || '';
  return {
    check_id: r.check.id,
    acceptance_ref: r.check.acceptance_ref || null,
    status: r.status === 'pass' ? 'pass' : r.status === 'fail' ? 'fail' : 'skip',
    stdout: `verificação remota${r.job ? ` (job ${r.job})` : ''}: ${r.status}${link ? ` — ${link}` : ''}`,
    stderr: r.reason && r.status !== 'pass' ? r.reason : '',
    exit_code: r.status === 'pass' ? 0 : r.status === 'fail' ? 1 : null,
    duration_ms: 0,
    error: r.status === 'fail' ? r.reason || 'job remoto falhou' : null,
    evidence_refs: [],
    skip_reason: r.status === 'not_verified' ? 'remote_not_verified' : null,
    remote: { job: r.job || null, url: link || null, run: run ? run.id : null, status: r.status, reason: r.reason || null },
  };
}

module.exports = { remoteConfig, whereFor, planHints, runRemote, toCheckResult, HEAVY_RE, FORBIDDEN_INPUT };
