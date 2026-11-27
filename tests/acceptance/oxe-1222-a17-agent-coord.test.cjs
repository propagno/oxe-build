'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const coord = require('../../bin/lib/oxe-agent-coord.cjs');
const oxeOp = require('../../bin/lib/oxe-operational.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

function mkGitRepo(prefix = 'oxe-a17-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# coord test\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'shared.js'), 'module.exports = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A17 — Coordenação multi-agente local e prevenção de colisão (OXB-222-17)', () => {
  it('OXB-222-17: manages leases and inbox across sibling worktrees in .git/oxe/, expires stale leases, and detects write_set collisions', () => {
    const mainRepo = mkGitRepo('oxe-a17-main-');
    const siblingWt = path.join(os.tmpdir(), `oxe-a17-sib-${Date.now()}`);
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'feat/sib', siblingWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });

      // Agent A registers lease from siblingWt
      const leaseA = coord.registerAgentLease(siblingWt, {
        agent_id: 'agent-antigravity-1',
        provider: 'antigravity',
        role: 'executor',
        task: 'T1',
        branch: 'feat/sib',
        write_set: ['src/shared.js', 'src/other.js'],
        pid: process.pid,
        ttl_ms: 60_000,
      });
      assert.equal(leaseA.agent_id, 'agent-antigravity-1');

      // Agent B registers an already-expired lease -> must be auto-expired on listActiveAgents
      coord.registerAgentLease(mainRepo, {
        agent_id: 'agent-expired',
        provider: 'claude',
        write_set: ['src/expired.js'],
        pid: process.pid,
        ttl_ms: -5000,
      });

      // Reading from mainRepo sees Agent A registered in siblingWt (shared .git/oxe/active-agents.json!)
      const active = coord.listActiveAgents(mainRepo);
      assert.equal(active.length, 1);
      assert.equal(active[0].agent_id, 'agent-antigravity-1');

      // Collision detection from mainRepo catches overlap on src/shared.js
      const col = coord.detectWriteSetCollisions(mainRepo, ['src/shared.js', 'src/clean.js'], { excludeWorktree: mainRepo });
      assert.equal(col.ok, false);
      assert.equal(col.collisions.length, 1);
      assert.equal(col.collisions[0].file, 'src/shared.js');
      assert.equal(col.collisions[0].agent_id, 'agent-antigravity-1');

      // Cross-worktree message bus
      coord.postAgentMessage(siblingWt, { from: 'agent-antigravity-1', to: 'all', topic: 'handoff', body: 'Updated src/shared.js' });
      const inbox = coord.readAgentMessages(mainRepo, { to: 'all' });
      assert.equal(inbox.length, 1);
      assert.match(inbox[0].body, /Updated src\/shared\.js/);

      // Heartbeat + release
      const hb = coord.heartbeatAgentLease(siblingWt, 'agent-antigravity-1', { task: 'T2' });
      assert.equal(hb.task, 'T2');
      coord.releaseAgentLease(siblingWt, 'agent-antigravity-1');
      assert.equal(coord.listActiveAgents(mainRepo).length, 0);
    } finally {
      try { execFileSync('git', ['worktree', 'remove', '--force', siblingWt], { cwd: mainRepo, stdio: 'ignore' }); } catch { /* */ }
      fs.rmSync(siblingWt, { recursive: true, force: true });
      fs.rmSync(mainRepo, { recursive: true, force: true });
    }
  });

  it('OXB-222-17: CLI oxe-cc agents, plan lint collision warning, and status --all-worktrees integrate active agent visibility', () => {
    const mainRepo = mkGitRepo('oxe-a17-cli-');
    const siblingWt = path.join(os.tmpdir(), `oxe-a17-cli-sib-${Date.now()}`);
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'feat/cli-sib', siblingWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });

      const regOut = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'agents', 'register', '--id', 'cli-agent-1', '--provider', 'cursor', '--task', 'F8/T1', '--files', 'src/shared.js', '--dir', siblingWt, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(regOut.oxeAgentsSchema, 1);
      assert.equal(regOut.lease.agent_id, 'cli-agent-1');

      const colOut = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'agents', 'collisions', '--files', 'src/shared.js', '--dir', mainRepo, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(colOut.ok, false);
      assert.equal(colOut.collisions.length, 1);

      // status --all-worktrees --json surfaces active_agents for siblingWt
      fs.mkdirSync(path.join(mainRepo, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(mainRepo, '.oxe', 'STATE.md'), '# STATE\n');
      const stOut = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'status', '--all-worktrees', '--dir', mainRepo, '--json'],
        { encoding: 'utf8' },
      ));
      const allWts = stOut.worktrees || [];
      assert.ok(allWts.some((w) => Array.isArray(w.active_agents) && w.active_agents.some((a) => a.agent_id === 'cli-agent-1')),
        `expected active_agents on worktree in status --all-worktrees, got: ${JSON.stringify(allWts)}`);

      // runtimePlanLint warns when PLAN.json files collide with active sibling agent lease
      fs.writeFileSync(path.join(mainRepo, '.oxe', 'SPEC.md'), '# SPEC\n## Critérios de aceite\n| ID | Critério | Risco | Como verificar |\n|---|---|---|---|\n| A1 | Ok | P2 | `node -e "process.exit(0)"` |\n');
      fs.writeFileSync(path.join(mainRepo, '.oxe', 'PLAN.json'), JSON.stringify({
        schema_version: 1,
        tasks: [{ id: 'T1', title: 'Touch shared', files: ['src/shared.js'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(0)"'] } }],
        acceptance_tests: [],
      }, null, 2));
      const lint = oxeOp.runtimePlanLint(mainRepo, null, { precheck: false });
      assert.ok(
        (lint.warnings || []).some((w) => /cli-agent-1|colis[aã]o|write_set/i.test(w)),
        `expected collision warning in runtimePlanLint, got: ${JSON.stringify(lint.warnings)}`,
      );
    } finally {
      try { execFileSync('git', ['worktree', 'remove', '--force', siblingWt], { cwd: mainRepo, stdio: 'ignore' }); } catch { /* */ }
      fs.rmSync(siblingWt, { recursive: true, force: true });
      fs.rmSync(mainRepo, { recursive: true, force: true });
    }
  });
});
