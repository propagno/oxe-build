'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const stub = require('../bin/lib/oxe-stub-check.cjs');

// 1.21.2 — OXB-188: a stub the agent labels as blocked is scope_insufficient naming the file, never done.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

const STUBBED = [
  'package app',
  '',
  '/**',
  ' * BLOCKED (OXB): CommandApi has no markSeen — the call is a no-op for now.',
  ' */',
  'fun markSeen(id: String) {}',
  '',
  '// OXB stub: until a CommandApi.paneConversation lands a fetch reads as no-conversation',
  'fun paneConversationFetch(id: String): String? = null',
  '',
].join('\n');

function project(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-bs-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A43 | marca como visto | teste |\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, execute: { defer_failed: false }, ...config }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, budget: { max_retries: 2 }, tasks: [{ id: 'T1', title: 'marcar como visto', wave: 1, files: ['app/src/main/kotlin/app/LiveRepository.kt'], acceptance: ['A43'], verify: { commands: ['node -e 0'] } }] }));
  write(dir, 'protocol/live/Commands.kt', 'package protocol.live\n\ninterface CommandApi {\n  fun send(cmd: String)\n}\n');
  write(dir, 'app/src/main/kotlin/app/LiveRepository.kt', 'package app\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  return dir;
}

describe('OXB-188: blocked stub', () => {
  it('the markers: BLOCKED / OXB stub / "until … lands" in comments; plain code with the word is not a marker', () => {
    const dir = project();
    write(dir, 'app/src/main/kotlin/app/LiveRepository.kt', STUBBED);
    const f = stub.stubFindings(dir, { levels: ['substantive'], since: 'HEAD', scope: ['app/src/main/kotlin/app/LiveRepository.kt'] });
    const blocked = f.filter((x) => x.level === 'blocked');
    assert.equal(blocked.length, 2, JSON.stringify(f));
    assert.deepEqual(blocked[0].needs, [{ file: 'protocol/live/Commands.kt', symbol: 'CommandApi' }]);
    assert.match(stub.blockedLine(f), /^scope_insufficient: stub marcado como bloqueado em app\/src\/main\/kotlin\/app\/LiveRepository\.kt:4, app\/src\/main\/kotlin\/app\/LiveRepository\.kt:8 — a mudança precisa de protocol\/live\/Commands\.kt, fora do escopo da tarefa/);
    write(dir, 'app/src/main/kotlin/app/LiveRepository.kt', 'package app\nval status = "BLOCKED"\n');
    assert.deepEqual(stub.stubFindings(dir, { levels: ['substantive'], since: 'HEAD', scope: [] }).filter((x) => x.level === 'blocked'), []);
  });

  it('a task that cannot reach the file and writes a BLOCKED stub ends as scope_insufficient naming the file — no retry, not done', async () => {
    const dir = project();
    let calls = 0;
    const executor = { async execute(_n, lease) { calls += 1; write(lease.root_path, 'app/src/main/kotlin/app/LiveRepository.kt', STUBBED); return { success: true, failure_class: null, evidence: ['app/src/main/kotlin/app/LiveRepository.kt'], output: 'done (markSeen ficou como no-op até o CommandApi ter o método)' }; } };
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.equal(calls, 1, 'scope_insufficient is never retried');
    assert.ok(!(res.result.completed || []).includes('T1'));
    const ev = fs.readFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const si = ev.find((e) => e.type === 'ScopeInsufficient' && e.work_item_id === 'T1');
    assert.ok(si, ev.map((e) => e.type).join(','));
    assert.equal(si.payload.reason, 'blocked_stub');
    assert.deepEqual(si.payload.files, ['protocol/live/Commands.kt']);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.notEqual(doc.tasks[0].done, true);
  });

  it('a done checkpoint refuses an added stub marker even when the verify did not run the stub check', () => {
    const dir = project();
    write(dir, 'app/src/main/kotlin/app/LiveRepository.kt', STUBBED);
    const cp = op.commitTaskCheckpoint(dir, { run_id: 'r1' }, 'T1', { task: { id: 'T1', title: 'x', files: ['app/src/main/kotlin/app/LiveRepository.kt'] }, planFiles: ['app/src/main/kotlin/app/LiveRepository.kt'] });
    assert.equal(cp.committed, false);
    assert.equal(cp.failed, true);
    assert.match(cp.reason, /checkpoint recusado: \d+ marcador\(es\) de stub adicionados/);
    assert.match(cp.reason, /protocol\/live\/Commands\.kt/);
    assert.equal(git(dir, 'log', '--oneline').stdout.trim().split('\n').length, 1, 'nothing committed');
  });
});
