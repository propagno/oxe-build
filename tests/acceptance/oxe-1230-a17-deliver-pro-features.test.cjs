'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('A17 — Deliver Pro: probeHttpServerSmoke em porta efêmera, auto-branch/commit por fase e ondas paralelas disjuntas (OXB-230-17)', () => {
  it('OXB-230-17: oxe-deliver-handoff.cjs probeHttpServerSmoke boots real HTTP server on ephemeral port, verifies HTTP 200 and shuts down cleanly', async () => {
    const handoff = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-handoff.cjs'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a17-http-'));
    try {
      fs.writeFileSync(path.join(dir, 'server.js'), [
        "'use strict';",
        "const http = require('http');",
        'const port = Number(process.env.PORT || 0);',
        "const srv = http.createServer((req, res) => {",
        "  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }",
        "  res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('hello');",
        '});',
        "srv.listen(port, '127.0.0.1');",
        '',
      ].join('\n'), 'utf8');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'demo-web',
        version: '1.0.0',
        scripts: { start: 'node server.js' },
      }, null, 2));

      const res = await handoff.probeHttpServerSmoke(dir, {
        startCommand: `"${process.execPath}" server.js`,
        timeoutMs: 6000,
      });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.statusCode, 200);
      assert.ok(res.port > 0);
      assert.match(String(res.body_excerpt || ''), /ok|hello/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-230-17: oxe-deliver-runner.cjs partitions disjoint write_sets for parallel execution and creates deliver/<slug> branch + OXE-Deliver phase commits', async () => {
    const runner = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-runner.cjs'));

    // 1. Unit check on partitionDisjointTasks
    const batches = runner.partitionDisjointTasks([
      { id: 'T1', files: ['src/a.cjs'] },
      { id: 'T2', files: ['src/b.cjs'] },
      { id: 'T3', files: ['src/a.cjs', 'src/c.cjs'] },
    ]);
    assert.equal(batches.length, 2, `T1 & T2 are disjoint, T3 overlaps T1 -> expected 2 batches, got ${JSON.stringify(batches)}`);
    assert.deepEqual(batches[0].map((t) => t.id), ['T1', 'T2']);
    assert.deepEqual(batches[1].map((t) => t.id), ['T3']);

    // 2. End-to-end autoGit + parallel wave execution
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a17-git-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'README.md'), '# init\n');
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

      const briefing = '# Parallel Lib\n\n## Objetivo\nBiblioteca Node.js com modulos alpha e beta independentes.\n\n## Requisitos\n- Exportar alpha() em src/alpha.cjs\n- Exportar beta() em src/beta.cjs\n\n## Stack\n- Node.js 18+ stdlib\n';
      const executedTasks = [];
      const res = await runner.runAutonomousDelivery(dir, {
        briefingText: briefing,
        approval: 'auto',
        autoGit: true,
        parallel: true,
        executorFn: async (step) => {
          if (step.state === 'PHASE_FREEZE_TESTS') {
            fs.mkdirSync(path.join(dir, 'tests', 'acceptance'), { recursive: true });
            const testRel = 'tests/acceptance/a1-parallel.test.cjs';
            fs.writeFileSync(path.join(dir, testRel), [
              "const { test } = require('node:test');",
              "const assert = require('node:assert/strict');",
              "const a = require('../../src/alpha.cjs');",
              "const b = require('../../src/beta.cjs');",
              "test('alpha and beta work', () => { assert.equal(a.alpha(), 'A'); assert.equal(b.beta(), 'B'); });",
              '',
            ].join('\n'), 'utf8');
            return { frozenTests: [testRel], costUsd: 0.02 };
          }
          if (step.state === 'PHASE_PLAN') {
            return {
              planTasks: [
                { id: 'T1', title: 'Alpha', files: ['src/alpha.cjs'], acceptance: [step.phase.acceptance[0]], verify: 'node --test tests/acceptance/a1-parallel.test.cjs' },
                { id: 'T2', title: 'Beta', files: ['src/beta.cjs'], acceptance: step.phase.acceptance.slice(1), verify: 'node --test tests/acceptance/a1-parallel.test.cjs' },
              ],
              costUsd: 0.01,
            };
          }
          if (step.state === 'PHASE_IMPLEMENT') {
            fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
            const tid = step.task ? step.task.id : 'ALL';
            executedTasks.push(tid);
            if (tid === 'T1' || tid === 'ALL') fs.writeFileSync(path.join(dir, 'src', 'alpha.cjs'), "module.exports = { alpha: () => 'A' };\n");
            if (tid === 'T2' || tid === 'ALL') fs.writeFileSync(path.join(dir, 'src', 'beta.cjs'), "module.exports = { beta: () => 'B' };\n");
            return { costUsd: 0.02 };
          }
          return {};
        },
      });

      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.state.status, 'DELIVERED');
      assert.ok(executedTasks.includes('T1') && executedTasks.includes('T2'), `expected parallel per-task execution, saw ${JSON.stringify(executedTasks)}`);

      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assert.match(branch, /^deliver\//, `expected deliver/<slug> branch, got ${branch}`);
      const log = execFileSync('git', ['log', '--format=%B', '-n', '5'], { cwd: dir, encoding: 'utf8' });
      assert.match(log, /OXE-Deliver:/, `expected OXE-Deliver trailer in git log, got:\n${log}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
