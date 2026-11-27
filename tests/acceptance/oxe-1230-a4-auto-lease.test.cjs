'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const quick = require('../../bin/lib/oxe-quick.cjs');
const coord = require('../../bin/lib/oxe-agent-coord.cjs');
const op = require('../../bin/lib/oxe-operational.cjs');

function mkRepo(prefix = 'oxe-a4-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A4 — Auto-lease automático em quick, runtime commit-task e runtime execute (OXB-230-04)', () => {
  it('OXB-230-04: quick start/done/cancel automatically manage leases in .git/oxe/active-agents.json and respect agents.auto_lease: false', () => {
    const dir = mkRepo('oxe-a4-quick-');
    try {
      assert.equal(typeof coord.isAutoLeaseEnabled, 'function');
      assert.equal(coord.isAutoLeaseEnabled(dir), true);

      const leaseFile = path.join(dir, '.git/oxe/active-agents.json');
      const started = quick.start(dir, { key: 'OB-65', objective: 'Testar auto-lease em quick start e cancel' });
      assert.ok(fs.existsSync(leaseFile), 'quick start must register an active agent lease in .git/oxe/active-agents.json');
      const activeAfterStart = coord.listActiveAgents(dir, { readOnly: true });
      assert.ok(activeAfterStart.some((a) => a.task === started.id || a.agent_id === `quick:${started.id}`), `expected lease for ${started.id}, got ${JSON.stringify(activeAfterStart)}`);

      // quick cancel releases the lease automatically
      quick.cancel(dir, { id: started.id, reason: 'Cancelamento controlado para validar release de lease' });
      const activeAfterCancel = coord.listActiveAgents(dir, { readOnly: true });
      assert.equal(activeAfterCancel.some((a) => a.task === started.id || a.agent_id === `quick:${started.id}`), false, 'quick cancel must release its auto-lease');

      // quick start + done (--no-commit) also registers and releases automatically
      const started2 = quick.start(dir, { key: 'OB-65', objective: 'Testar auto-lease em quick start e done' });
      assert.ok(coord.listActiveAgents(dir, { readOnly: true }).some((a) => a.task === started2.id || a.agent_id === `quick:${started2.id}`));
      quick.done(dir, { id: started2.id, noCommit: true });
      assert.equal(coord.listActiveAgents(dir, { readOnly: true }).some((a) => a.task === started2.id || a.agent_id === `quick:${started2.id}`), false, 'quick done must release its auto-lease');

      // Opt-out via `.oxe/config.json` -> `agents.auto_lease: false`
      fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ agents: { auto_lease: false } }, null, 2));
      assert.equal(coord.isAutoLeaseEnabled(dir), false);
      const started3 = quick.start(dir, { key: 'OB-65', objective: 'Quick com auto_lease desativado na config' });
      assert.equal(coord.listActiveAgents(dir, { readOnly: true }).some((a) => a.task === started3.id || a.agent_id === `quick:${started3.id}`), false, 'auto_lease: false must suppress lease registration');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-230-04: runtime commit-task heartbeats and releases task auto-lease cleanly after checkpoint commit', () => {
    const dir = mkRepo('oxe-a4-commit-');
    try {
      fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'hello.js'), 'module.exports = 1;\n');
      execFileSync('git', ['add', 'src/hello.js'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'add hello'], { cwd: dir, stdio: 'ignore' });

      fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
        schema_version: 1,
        tasks: [{
          id: 'T1',
          title: 'Update hello',
          wave: 1,
          files: ['src/hello.js'],
          verify: { commands: ['node -e "process.exit(0)"'] },
          done: false,
        }],
        acceptance_tests: [],
      }, null, 2));
      fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n\n### T1 — Update hello\n- **Onda:** 1\n- **Arquivos alvo:** `src/hello.js`\n- **Comando:** `node -e "process.exit(0)"`\n');

      // Pre-register a lease for T1 (simulating active execution) and modify src/hello.js
      coord.registerAgentLease(dir, { agent_id: 'task:T1', provider: 'oxe-runtime', role: 'executor', task: 'T1', write_set: ['src/hello.js'] });
      assert.equal(coord.listActiveAgents(dir, { readOnly: true }).length, 1);

      fs.writeFileSync(path.join(dir, 'src', 'hello.js'), 'module.exports = 2;\n');
      const res = op.runtimeCommitTask(dir, null, { task: 'T1', stubCheck: false });
      assert.equal(res.ok, true);
      assert.ok(res.auto_lease && res.auto_lease.released === true, `expected auto_lease.released=true, got ${JSON.stringify(res.auto_lease)}`);
      assert.equal(coord.listActiveAgents(dir, { readOnly: true }).some((a) => a.task === 'T1' || a.agent_id === 'task:T1'), false, 'runtime commit-task must release the task lease after committing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
