'use strict';

/**
 * 1.22.2 (OXB-222-17): IDE-agnostic multi-agent local coordination ledger.
 * Stores active agent leases in `<git-common-dir>/oxe/active-agents.json` and cross-worktree
 * messages in `<git-common-dir>/oxe/agent-messages.ndjson`, visible to every worktree of the repo
 * (Antigravity, Claude Code, Cursor, Codex, Copilot, etc.).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { resolveProjectGitRoot, normPath } = require('./oxe-git-root.cjs');

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function normRelFile(f) {
  return String(f || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return true;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

/**
 * Resolves the shared `<git-common-dir>/oxe` directory for all worktrees of `projectRoot`.
 * When `options.readOnly === true`, never creates directories on disk.
 */
function coordDirOf(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const spawn = options.spawn || spawnSync;
  const gitRoot = resolveProjectGitRoot(rootAbs, { spawn });
  let dir = null;
  if (gitRoot) {
    const res = spawn('git', ['rev-parse', '--git-common-dir'], { cwd: rootAbs, encoding: 'utf8', windowsHide: true });
    if (res && res.status === 0 && String(res.stdout || '').trim()) {
      dir = path.join(path.resolve(rootAbs, String(res.stdout).trim()), 'oxe');
    }
  }
  if (!dir) dir = path.join(rootAbs, '.oxe', 'agents');
  if (!options.readOnly) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function leasesFileOf(projectRoot, options = {}) {
  return path.join(coordDirOf(projectRoot, options), 'active-agents.json');
}

function messagesFileOf(projectRoot, options = {}) {
  return path.join(coordDirOf(projectRoot, options), 'agent-messages.ndjson');
}

function readLeasesRaw(file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc && Array.isArray(doc.agents)) return doc.agents;
  } catch { /* absent or corrupt */ }
  return [];
}

function writeLeasesAtomic(file, agents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ schema: 1, updated_at: new Date().toISOString(), agents }, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function pruneExpiredLeases(agents, options = {}) {
  const now = options.now != null ? Number(options.now) : Date.now();
  const checkPid = options.checkPid !== false;
  return (Array.isArray(agents) ? agents : []).filter((a) => {
    if (!a || !a.agent_id) return false;
    const exp = Date.parse(String(a.expires_at || ''));
    if (Number.isFinite(exp) && exp < now) return false;
    if (checkPid && a.pid != null && !isPidAlive(a.pid)) return false;
    return true;
  });
}

function detectBranch(projectRoot, spawn = spawnSync) {
  try {
    const r = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
    if (r && r.status === 0) return String(r.stdout || '').trim() || null;
  } catch { /* ignore */ }
  return null;
}

function registerAgentLease(projectRoot, lease = {}, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const file = leasesFileOf(rootAbs, { ...options, readOnly: false });
  const now = options.now != null ? Number(options.now) : Date.now();
  const ttlMs = Number.isFinite(Number(lease.ttl_ms)) ? Number(lease.ttl_ms) : DEFAULT_TTL_MS;
  const agentId = String(lease.agent_id || lease.id || `agent-${crypto.randomBytes(4).toString('hex')}`).trim();
  const writeSet = [...new Set((Array.isArray(lease.write_set) ? lease.write_set : []).map(normRelFile).filter(Boolean))];
  const worktree = path.resolve(lease.worktree || rootAbs);
  const record = {
    agent_id: agentId,
    provider: String(lease.provider || 'unknown'),
    role: String(lease.role || 'executor'),
    worktree,
    worktree_norm: normPath(worktree),
    branch: lease.branch || detectBranch(worktree, options.spawn),
    task: lease.task ? String(lease.task) : null,
    write_set: writeSet,
    pid: lease.pid === null ? null : (lease.pid != null ? Number(lease.pid) : process.pid),
    started_at: new Date(now).toISOString(),
    last_seen: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  };
  const existing = pruneExpiredLeases(readLeasesRaw(file), { now, checkPid: options.checkPid }).filter((a) => a.agent_id !== agentId);
  existing.push(record);
  writeLeasesAtomic(file, existing);
  return record;
}

function heartbeatAgentLease(projectRoot, agentId, updates = {}, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const file = leasesFileOf(rootAbs, { ...options, readOnly: false });
  const now = options.now != null ? Number(options.now) : Date.now();
  const ttlMs = Number.isFinite(Number(updates.ttl_ms)) ? Number(updates.ttl_ms) : DEFAULT_TTL_MS;
  const list = pruneExpiredLeases(readLeasesRaw(file), { now, checkPid: options.checkPid });
  const idx = list.findIndex((a) => a.agent_id === String(agentId));
  if (idx < 0) return null;
  const cur = list[idx];
  const next = {
    ...cur,
    ...(updates.task !== undefined ? { task: updates.task ? String(updates.task) : null } : {}),
    ...(updates.role !== undefined ? { role: String(updates.role) } : {}),
    ...(Array.isArray(updates.write_set) ? { write_set: [...new Set(updates.write_set.map(normRelFile).filter(Boolean))] } : {}),
    last_seen: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  };
  list[idx] = next;
  writeLeasesAtomic(file, list);
  return next;
}

function releaseAgentLease(projectRoot, agentId, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const file = leasesFileOf(rootAbs, { ...options, readOnly: true });
  if (!fs.existsSync(file)) return { released: false, agent_id: String(agentId) };
  const before = readLeasesRaw(file);
  const after = before.filter((a) => a && a.agent_id !== String(agentId));
  writeLeasesAtomic(file, after);
  return { released: after.length < before.length, agent_id: String(agentId) };
}

function listActiveAgents(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const file = leasesFileOf(rootAbs, { ...options, readOnly: true });
  if (!fs.existsSync(file)) return [];
  const raw = readLeasesRaw(file);
  const active = pruneExpiredLeases(raw, options);
  if (!options.readOnly && active.length !== raw.length) {
    try { writeLeasesAtomic(file, active); } catch { /* read-only fallback */ }
  }
  return active;
}

function detectWriteSetCollisions(projectRoot, candidateFiles = [], options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const active = listActiveAgents(rootAbs, { ...options, readOnly: true });
  const wanted = [...new Set((Array.isArray(candidateFiles) ? candidateFiles : []).map(normRelFile).filter(Boolean))];
  const excludeAgent = options.excludeAgentId ? String(options.excludeAgentId) : null;
  const excludeWtNorm = options.excludeWorktree ? normPath(options.excludeWorktree) : null;

  const collisions = [];
  for (const agent of active) {
    if (excludeAgent && agent.agent_id === excludeAgent) continue;
    if (excludeWtNorm && normPath(agent.worktree) === excludeWtNorm) continue;
    const agentFiles = Array.isArray(agent.write_set) ? agent.write_set.map(normRelFile) : [];
    for (const f of wanted) {
      const hit = agentFiles.some((af) => af === f || f.startsWith(`${af}/`) || af.startsWith(`${f}/`));
      if (hit) {
        collisions.push({
          file: f,
          agent_id: agent.agent_id,
          provider: agent.provider,
          worktree: agent.worktree,
          branch: agent.branch,
          task: agent.task,
        });
      }
    }
  }
  return { ok: collisions.length === 0, collisions, active_agents: active.length };
}

function postAgentMessage(projectRoot, msg = {}, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const file = messagesFileOf(rootAbs, { ...options, readOnly: false });
  const entry = {
    id: `msg-${crypto.randomBytes(4).toString('hex')}`,
    at: new Date().toISOString(),
    from: String(msg.from || 'agent'),
    to: String(msg.to || 'all'),
    topic: msg.topic ? String(msg.topic) : 'general',
    body: String(msg.body || '').trim(),
    worktree: path.resolve(msg.worktree || rootAbs),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

function readAgentMessages(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const file = messagesFileOf(rootAbs, { ...options, readOnly: true });
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  let msgs = [];
  for (const l of lines) {
    try { msgs.push(JSON.parse(l)); } catch { /* skip corrupt */ }
  }
  if (options.to) {
    const target = String(options.to);
    msgs = msgs.filter((m) => m.to === target || m.to === 'all');
  }
  if (options.since) {
    const sinceMs = Date.parse(String(options.since));
    if (Number.isFinite(sinceMs)) msgs = msgs.filter((m) => Date.parse(String(m.at || '')) >= sinceMs);
  }
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 50;
  return msgs.slice(-limit);
}

module.exports = {
  coordDirOf,
  registerAgentLease,
  heartbeatAgentLease,
  releaseAgentLease,
  listActiveAgents,
  detectWriteSetCollisions,
  postAgentMessage,
  readAgentMessages,
};
