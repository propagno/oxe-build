'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const dashboard = require('../../bin/lib/oxe-dashboard.cjs');
const coord = require('../../bin/lib/oxe-agent-coord.cjs');

function httpGet(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: raw }));
    });
    req.on('error', reject);
  });
}

describe('A9 — Dashboard v2 multi-agente ao vivo com navegação completa (OXB-230-09)', () => {
  it('OXB-230-09: oxe-dashboard.cjs v2 renders complete sectioned navigation HTML and GET /api/state exposes active_agents, agent_messages, agent_collisions, worktree_hygiene, reevaluate, and scorecard_routing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a9-dash-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
      fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# OXE\n\n## Fase atual\n\n`executing`\n');
      fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
        schema_version: 1,
        tasks: [{ id: 'T1', title: 'Demo task', wave: 1, files: ['src/a.js'], suggested_model_hint: 'fast', done: false }],
        acceptance_tests: [],
      }));
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

      // Register two agents colliding on src/a.js + post a message to the cross-worktree inbox
      coord.registerAgentLease(dir, { agent_id: 'agent-alpha', provider: 'antigravity', role: 'executor', task: 'T1', write_set: ['src/a.js'], worktree: path.join(dir, 'wt-a') });
      coord.registerAgentLease(dir, { agent_id: 'agent-beta', provider: 'claude', role: 'executor', task: 'T2', write_set: ['src/a.js'], worktree: path.join(dir, 'wt-b') });
      coord.postAgentMessage(dir, { from: 'agent-alpha', to: 'agent-beta', topic: 'handoff', body: 'Atenção: src/a.js em edição' });

      const server = dashboard.createDashboardServer(dir);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      try {
        // 1. HTML contains complete section navigation and v2 blue/obsidian shell
        const htmlRes = await httpGet(port, '/');
        assert.equal(htmlRes.statusCode, 200);
        assert.match(htmlRes.body, /Agentes|Colisões/i, 'HTML must include Agentes & Colisões section');
        assert.match(htmlRes.body, /Reavaliação|Drift/i, 'HTML must include Reavaliação section');
        assert.match(htmlRes.body, /Scorecard|ROI/i, 'HTML must include Scorecard & ROI section');
        assert.match(htmlRes.body, /Worktrees/i, 'HTML must include Worktrees section');
        assert.match(htmlRes.body, /\/api\/state/, 'HTML v2 must load live telemetry from /api/state');

        // 2. GET /api/state exposes all required live telemetry fields
        const stateRes = await httpGet(port, '/api/state');
        assert.equal(stateRes.statusCode, 200);
        const state = JSON.parse(stateRes.body);
        assert.ok(Array.isArray(state.active_agents), 'active_agents must be an array');
        assert.equal(state.active_agents.length, 2);
        assert.ok(Array.isArray(state.agent_messages), 'agent_messages must be an array');
        assert.ok(state.agent_messages.some((m) => m.from === 'agent-alpha' && /src\/a\.js/.test(m.body)));
        assert.ok(Array.isArray(state.agent_collisions), 'agent_collisions must be an array');
        assert.ok(state.agent_collisions.length >= 1, `expected collision on src/a.js, got ${JSON.stringify(state.agent_collisions)}`);
        assert.ok(state.worktree_hygiene && typeof state.worktree_hygiene === 'object', 'worktree_hygiene must be present');
        assert.ok(state.reevaluate && typeof state.reevaluate === 'object', 'reevaluate must be present');
        assert.ok(state.scorecard_routing && typeof state.scorecard_routing === 'object', 'scorecard_routing must be present');
      } finally {
        server.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
