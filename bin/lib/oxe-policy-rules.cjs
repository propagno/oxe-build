'use strict';

/**
 * OXB-118: which project rules (`.oxe/config.json` policy_rules) are actually ENFORCED, and rules about ACTIONS.
 *
 * A rule is `enforced` when it has a checkable structured form, else `advisory` (text the agents read, nothing checks):
 *   { id, forbid: "<regex>", paths?: "<regex>", message? }            content: the regex in files the phase touched
 *   { id, kind: "command", deny: "<regex>", message? }                a command the run executed (recorded)
 *   { id, kind: "path", deny_read: "<glob>" | deny_write: "<glob>" }   a path the run read / wrote
 *   { id, kind: "env", strip: "<PREFIX>" }                             removed from every child process environment
 * A plain string (the OXESpace had 10) is advisory. Before 1.21.2 such rules were dropped silently.
 */

const ACTION_KINDS = new Set(['command', 'path', 'env']);

function ruleText(rule) {
  if (typeof rule === 'string') return rule;
  if (!rule || typeof rule !== 'object') return '';
  return String(rule.message || rule.text || rule.description || rule.id || '');
}

const nonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;
const asPatterns = (v) => (Array.isArray(v) ? v : v != null ? [v] : []).filter(nonEmptyStr).map((s) => s.trim());

/** @returns {{ id: string, state: 'enforced'|'advisory', kind: string, text: string, problem: string|null, rule: any }[]} */
function classifyRules(rules) {
  return (Array.isArray(rules) ? rules : []).map((rule, i) => {
    const text = ruleText(rule);
    const base = { id: (rule && typeof rule === 'object' && rule.id) ? String(rule.id) : `rule-${i + 1}`, text, rule };
    if (typeof rule === 'string') return { ...base, state: 'advisory', kind: 'text', problem: null };
    if (!rule || typeof rule !== 'object') return { ...base, state: 'advisory', kind: 'text', problem: 'regra vazia' };
    const kind = rule.kind ? String(rule.kind) : (rule.forbid !== undefined ? 'content' : 'text');
    const regexOk = (src) => { try { new RegExp(src); return true; } catch { return false; } };
    if (kind === 'content') {
      if (!rule.id || !nonEmptyStr(rule.forbid)) return { ...base, state: 'advisory', kind, problem: !rule.id ? 'falta id' : 'forbid vazio' };
      if (!regexOk(rule.forbid)) return { ...base, state: 'enforced', kind, problem: `regex inválida: ${rule.forbid}` };
      return { ...base, state: 'enforced', kind, problem: null };
    }
    if (kind === 'command') {
      if (!rule.id || !nonEmptyStr(rule.deny)) return { ...base, state: 'advisory', kind, problem: 'kind command exige id e deny' };
      if (!regexOk(rule.deny)) return { ...base, state: 'enforced', kind, problem: `regex inválida: ${rule.deny}` };
      return { ...base, state: 'enforced', kind, problem: null };
    }
    if (kind === 'path') {
      if (!rule.id || (!asPatterns(rule.deny_read).length && !asPatterns(rule.deny_write).length)) return { ...base, state: 'advisory', kind, problem: 'kind path exige id e deny_read ou deny_write' };
      return { ...base, state: 'enforced', kind, problem: null };
    }
    if (kind === 'env') {
      if (!rule.id || !asPatterns(rule.strip).length) return { ...base, state: 'advisory', kind, problem: 'kind env exige id e strip' };
      return { ...base, state: 'enforced', kind, problem: null };
    }
    return { ...base, state: 'advisory', kind, problem: `kind desconhecido: ${kind}` };
  });
}

function summary(rules) {
  const classified = classifyRules(rules);
  const enforced = classified.filter((r) => r.state === 'enforced');
  const advisory = classified.filter((r) => r.state === 'advisory');
  return { total: classified.length, enforced, advisory, invalid: classified.filter((r) => r.problem && r.state === 'enforced') };
}

function globToRegex(glob) {
  const g = String(glob || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const s = g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*\*\//g, '\u0001')
    .replace(/^\*\*\//, '\u0002')
    .replace(/\/\*\*$/, '\u0003')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:/.*/|/)')
    .replace(/\u0002/g, '(?:.*/)?')
    .replace(/\u0003/g, '(?:/.*)?')
    .replace(/\u0000/g, '.*');
  return new RegExp(`(^|/)${s}$`, 'i');
}

/** Environment prefixes the `env` rules strip from every child process (regex sources for configureChildEnv). */
function envStripPatterns(rules) {
  return classifyRules(rules)
    .filter((r) => r.kind === 'env' && r.state === 'enforced' && !r.problem)
    .flatMap((r) => asPatterns(r.rule.strip).map((p) => `^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
}

/**
 * Action rules checked after the fact against what the run recorded.
 * @param {{ commands?: Array<{command:string, task?:string}>, reads?: Array<{path:string, task?:string}>, writes?: Array<{path:string, task?:string}> }} actions
 * @returns {{ rule: string, kind: string, what: string, task: string|null, message: string }[]}
 */
function checkActionRules(rules, actions = {}) {
  const out = [];
  for (const r of classifyRules(rules)) {
    if (r.state !== 'enforced' || r.problem) continue;
    const msg = r.rule.message || r.text;
    if (r.kind === 'command') {
      const re = new RegExp(r.rule.deny, 'i');
      for (const c of actions.commands || []) if (c && re.test(String(c.command || ''))) out.push({ rule: r.id, kind: 'command', what: c.command, task: c.task || null, message: msg });
    } else if (r.kind === 'path') {
      const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
      const readRes = asPatterns(r.rule.deny_read).map(globToRegex);
      if (readRes.length) {
        for (const x of actions.reads || []) {
          const p = norm(x && x.path);
          if (p && readRes.some((re) => re.test(p))) out.push({ rule: r.id, kind: 'path_read', what: p, task: (x && x.task) || null, message: msg });
        }
      }
      const writeRes = asPatterns(r.rule.deny_write).map(globToRegex);
      if (writeRes.length) {
        for (const x of actions.writes || []) {
          const p = norm(x && x.path);
          if (p && writeRes.some((re) => re.test(p))) out.push({ rule: r.id, kind: 'path_write', what: p, task: (x && x.task) || null, message: msg });
        }
      }
    }
  }
  return out;
}

/** Actions a run recorded: the executor's `ExecutorUsage` events (commands, reads, writes per attempt). */
function actionsFromEvents(events, runId) {
  const actions = { commands: [], reads: [], writes: [] };
  for (const e of events || []) {
    if (!e || e.type !== 'ExecutorUsage' || (runId && e.run_id !== runId)) continue;
    const p = e.payload || {};
    const task = e.work_item_id || null;
    for (const c of Array.isArray(p.commands) ? p.commands : []) {
      const cmd = typeof c === 'string' ? c : (c && c.command) || '';
      if (cmd) actions.commands.push({ command: String(cmd), task });
    }
    for (const x of Array.isArray(p.reads) ? p.reads : []) {
      const rp = typeof x === 'string' ? x : (x && x.path) || '';
      if (rp) actions.reads.push({ path: String(rp), task });
    }
    for (const x of Array.isArray(p.writes) ? p.writes : []) {
      const wp = typeof x === 'string' ? x : (x && x.path) || '';
      if (wp) actions.writes.push({ path: String(wp), task });
    }
  }
  return actions;
}

module.exports = { classifyRules, summary, checkActionRules, actionsFromEvents, envStripPatterns, globToRegex, ACTION_KINDS };
