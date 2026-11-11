'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const { parseRateLimitResetMs } = require('../lib/runtime/scheduler/scheduler');
const { LlmTaskExecutor } = require('../lib/runtime/executor/llm-task-executor');

// 1.21.2 — OXB-204: safe dirty-tree resume when executor dies mid-task + automatic 429 backoff.

const CLI = path.resolve(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args, '--dir', cwd], {
  cwd,
  encoding: 'utf8',
  windowsHide: true,
});
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content, 'utf8');
};

function makeProject(tasks, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-resume-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# STATE\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | ok | test |\n');
  write(dir, '.oxe/ROADMAP.md', '# ROADMAP\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({
    external_dependency_check: false,
    stub_check: false,
    checkpoint_commits: false,
    ...config,
  }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({
    schema_version: 1,
    phase: 'F5',
    budget: { max_retries: 2 },
    tasks,
  }, null, 2));
  write(dir, 'locales/pt-BR/code.json', '{\n  "greeting": "Olá"\n}\n');
  write(dir, 'src/ok.ts', 'export const answer: number = 42;\n');
  write(dir, 'src/broken.ts', 'export function greet(name: string): string {\n  return name;\n}\n');
  write(dir, 'src/unrelated.ts', 'export const keepMe = "baseline";\n');
  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'user.email', 'test@oxe.dev');
  git(dir, 'config', 'user.name', 'OXE Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-204: safe dirty-tree resume and automatic 429 backoff', () => {
  it('records TaskStarted (with Tn, executor, base_sha) and marks Tn.status = "in_progress" while running, then transitions to "done"', async () => {
    const dir = makeProject([
      {
        id: 'T1',
        title: 'Atualizar saudação',
        wave: 1,
        files: ['src/ok.ts'],
        acceptance: ['A1'],
        verify: { commands: ['node -e 0'] },
      },
    ]);
    const headSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    let observedMidTask = null;
    const executor = {
      async execute() {
        observedMidTask = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
        write(dir, 'src/ok.ts', 'export const answer: number = 99;\n');
        return { success: true, evidence: ['src/ok.ts'], output: 'done' };
      },
    };

    const res = await op.runRuntimeExecute(dir, null, {
      executor,
      adapter: 'agy',
      skipPreflight: true,
    });
    assert.equal(res.result.status, 'completed');

    // During execution, T1 was marked in_progress with executor + base_sha
    assert.ok(observedMidTask, 'PLAN.json was read during task execution');
    const midT1 = observedMidTask.tasks.find((t) => t.id === 'T1');
    assert.equal(midT1.status, 'in_progress');
    assert.equal(midT1.executor, 'agy');
    assert.equal(midT1.base_sha, headSha);

    // TaskStarted event recorded in OXE-EVENTS.ndjson
    const events = op.readEvents(dir, null);
    const startedEv = events.find((e) => e.type === 'TaskStarted' && e.work_item_id === 'T1');
    assert.ok(startedEv, 'TaskStarted event must be emitted');
    assert.equal(startedEv.payload.task, 'T1');
    assert.equal(startedEv.payload.executor, 'agy');
    assert.equal(startedEv.payload.base_sha, headSha);

    // After completion, T1 is done and transient in_progress fields are cleaned up
    const finalPlan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const doneT1 = finalPlan.tasks.find((t) => t.id === 'T1');
    assert.equal(doneT1.done, true);
    assert.equal(doneT1.status, 'done');
    assert.equal(doneT1.started_at, undefined);
    assert.equal(doneT1.executor, undefined);
    assert.ok(!events.some((e) => e.type === 'VerificationSuiteRecompiled'), 'transient in_progress must not cause plan drift');
  });

  it('runtime resume detects in_progress + dirty tree, validates JSON/TS syntax, separates Tn.files vs out-of-scope, and supports continue vs reset-task', () => {
    const dir = makeProject([
      {
        id: 'T5',
        title: 'FE-B2 i18n e componentes',
        wave: 2,
        files: ['locales/pt-BR/code.json', 'src/ok.ts', 'src/broken.ts', 'src/new-helper.ts'],
        acceptance: ['A1'],
        verify: { commands: ['node -e 0'] },
      },
    ]);
    const baseSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    // Start T5 via CLI and simulate executor dying mid-write
    const startRes = cli(dir, 'runtime', 'start-task', 'T5', '--by', 'gemini-worker-2', '--json');
    assert.equal(startRes.status, 0, startRes.stderr);

    // Partial/corrupted writes inside T5.files + 1 untracked in-scope file + 1 out-of-scope modification
    write(dir, 'locales/pt-BR/code.json', '{\n  "greeting": "Olá",\n  "truncated": ');
    write(dir, 'src/broken.ts', 'export function greet(name: string {\n  return ;\n');
    write(dir, 'src/ok.ts', 'export const answer: number = 123;\n');
    write(dir, 'src/new-helper.ts', 'export const helper = true;\n');
    write(dir, 'src/unrelated.ts', 'export const keepMe = "user-uncommitted-edit";\n');

    // 1) `oxe-cc runtime resume --json` without decision inspects and pauses for operator choice
    const inspectOut = cli(dir, 'runtime', 'resume', '--json');
    assert.equal(inspectOut.status, 1, 'must exit 1 when operator decision is required');
    const report = JSON.parse(inspectOut.stdout);
    assert.equal(report.dirty_resume, true);
    assert.equal(report.needs_decision, true);
    assert.equal(report.task, 'T5');
    assert.equal(report.executor, 'gemini-worker-2');
    assert.equal(report.base_sha, baseSha);
    assert.deepEqual(report.choices, ['continue', 'reset-task']);

    const inScopePaths = report.in_scope.map((x) => x.path).sort();
    assert.deepEqual(inScopePaths, [
      'locales/pt-BR/code.json',
      'src/broken.ts',
      'src/new-helper.ts',
      'src/ok.ts',
    ]);
    assert.deepEqual(report.out_of_scope.map((x) => x.path), ['src/unrelated.ts']);

    const invalidPaths = report.invalid_files.map((x) => x.path).sort();
    assert.deepEqual(invalidPaths, ['locales/pt-BR/code.json', 'src/broken.ts']);

    // Human-readable output also lists diffs and both options
    const humanOut = cli(dir, 'runtime', 'resume');
    assert.equal(humanOut.status, 1);
    assert.match(humanOut.stdout, /T5/);
    assert.match(humanOut.stdout, /locales\/pt-BR\/code\.json/);
    assert.match(humanOut.stdout, /src\/unrelated\.ts/);
    assert.match(humanOut.stdout, /--continue/);
    assert.match(humanOut.stdout, /--reset-task/);

    // 2) `--continue` keeps T5's partial files and logs TaskResumed
    const contOut = cli(dir, 'runtime', 'resume', '--continue', '--json');
    assert.equal(contOut.status, 0, contOut.stderr);
    const contJson = JSON.parse(contOut.stdout);
    assert.equal(contJson.decision, 'continue');
    assert.ok(fs.existsSync(path.join(dir, 'src/new-helper.ts')));
    assert.match(fs.readFileSync(path.join(dir, 'src/ok.ts'), 'utf8'), /123/);

    // 3) `--reset-task` discards ONLY T5.files (both tracked edits & untracked new-helper.ts), keeping src/unrelated.ts!
    const resetOut = cli(dir, 'runtime', 'resume', '--reset-task', '--json');
    assert.equal(resetOut.status, 0, resetOut.stderr);
    const resetJson = JSON.parse(resetOut.stdout);
    assert.equal(resetJson.decision, 'reset-task');
    assert.equal(fs.existsSync(path.join(dir, 'src/new-helper.ts')), false, 'untracked T5 file must be removed');
    assert.equal(fs.readFileSync(path.join(dir, 'locales/pt-BR/code.json'), 'utf8'), '{\n  "greeting": "Olá"\n}\n');
    assert.equal(fs.readFileSync(path.join(dir, 'src/ok.ts'), 'utf8'), 'export const answer: number = 42;\n');
    assert.equal(fs.readFileSync(path.join(dir, 'src/unrelated.ts'), 'utf8'), 'export const keepMe = "user-uncommitted-edit";\n', 'out-of-scope file must NOT be discarded');

    const planAfterReset = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.equal(planAfterReset.tasks[0].status, undefined, 'in_progress cleared after reset-task');

    const events = op.readEvents(dir, null);
    assert.ok(events.some((e) => e.type === 'TaskResumed' && e.work_item_id === 'T5'));
    assert.ok(events.some((e) => e.type === 'TaskReset' && e.work_item_id === 'T5'));
  });

  it('automatically backs off and waits for reported reset time on 429 errors in both LlmTaskExecutor and Scheduler', async () => {
    assert.equal(parseRateLimitResetMs('', 1000, '3'), 3000);
    assert.equal(parseRateLimitResetMs('{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"18s"}]}}'), 18_000);
    assert.equal(parseRateLimitResetMs('429 Too Many Requests: please retry in 250ms'), 250);
    assert.equal(parseRateLimitResetMs('Rate limit reached, resets in 1m 30s'), 90_000);
    assert.equal(parseRateLimitResetMs("You've hit your weekly limit · resets Nov 14, 10am"), null);

    // Part A: LlmTaskExecutor waits on 429 without spending a turn
    const dir = makeProject([
      { id: 'T1', title: 'auto-wait 429', wave: 1, files: ['src/ok.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
    ]);
    const waitedLlm = [];
    const llmEvents = [];
    let calls = 0;
    const fakeComplete = async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('HTTP 429: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"2s"}]}}');
        err.kind = 'quota';
        throw err;
      }
      if (calls === 2) {
        return {
          content: '',
          finish_reason: 'tool_calls',
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'finish_task', arguments: JSON.stringify({ summary: 'done after 429 wait' }) } }],
        };
      }
      return { content: 'done', finish_reason: 'stop', tool_calls: [] };
    };

    const llmExec = new LlmTaskExecutor(
      { baseUrl: 'http://localhost:1234/v1', apiKey: 'k', model: 'm', maxTurns: 2 },
      null,
      (ev) => llmEvents.push(ev),
      fakeComplete,
      { sleep: async (ms) => { waitedLlm.push(ms); } },
    );
    const llmResult = await llmExec.execute(
      { id: 'T1', title: 't', wave: 1, depends_on: [], actions: [{ type: 'write_file', description: 'w' }], mutation_scope: ['src/ok.ts'], workspace_strategy: 'inplace', verify: { command: null, must_pass: [] }, policy: { requires_human_approval: false } },
      { workspace_id: 'ws-1', work_item_id: 'T1', root_path: dir, strategy: 'inplace', mutation_scope: ['src/ok.ts'], created_at: new Date().toISOString() },
      'run-1',
      1,
    );
    assert.equal(llmResult.success, true);
    assert.deepEqual(waitedLlm, [2000], 'LlmTaskExecutor waited exact reported retryDelay');
    assert.ok(llmEvents.some((e) => e.type === 'rate_limit_wait' && e.detail.wait_ms === 2000));

    // Part B: Scheduler / CLI-adapter 429 with reset time waits and retries without spending an attempt
    let adapterCalls = 0;
    const schedExecutor = {
      async execute(node, lease, runId, attempt) {
        adapterCalls += 1;
        assert.equal(attempt, 1, '429 wait must not increment attempt number');
        if (adapterCalls === 1) {
          return {
            success: false,
            failure_class: 'quota',
            evidence: [],
            output: 'RESOURCE_EXHAUSTED (429): rate limit exceeded, retry in 20ms',
          };
        }
        write(dir, 'src/ok.ts', 'export const answer: number = 777;\n');
        return { success: true, evidence: ['src/ok.ts'], output: 'recovered after 429' };
      },
    };

    const runRes = await op.runRuntimeExecute(dir, null, { executor: schedExecutor, skipPreflight: true });
    assert.equal(runRes.result.status, 'completed');
    assert.equal(adapterCalls, 2);
    const events = op.readEvents(dir, null);
    const waitEv = events.find((e) => e.type === 'RateLimitWait' && e.work_item_id === 'T1');
    assert.ok(waitEv, 'RateLimitWait event must be recorded');
    assert.equal(waitEv.payload.wait_ms, 20);
  });
});
