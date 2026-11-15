'use strict';

/**
 * Unified deterministic plan repair engine (`oxe-plan-repair.cjs`).
 *
 * Consolidates six mechanical PLAN.json repairs into a single idempotent, auditable pipeline:
 *  1. `frozen_in_task_files`   — removes frozen `acceptance_tests[].files` mistakenly placed in `task.files`
 *  2. `scope_gaps`             — resolves `oxe-test-scope` gaps: wires `depends_on` when another pending task owns
 *                                the required product file (cycle-safe), or adds unowned product files to `task.files`
 *  3. `wave_order_and_overlap` — enforces `task.wave > dep.wave` across pending tasks, serializes same-wave write
 *                                collisions (`covers(a, b) || covers(b, a)`), and compacts empty wave gaps
 *  4. `verify_later_owned`     — prunes G38 later-owned tests and anchors vitest substring collisions (`arg$`) per
 *                                subcommand without corrupting `$` route segments or dropping non-test subcommands
 *  5. `suite_impact_verify`    — appends G30 impacted existing suites to `task.verify.commands` and (when unowned)
 *                                adds G30b baseline data fixtures to `task.files`
 *  6. `proves_verbose`         — adds `--reporter=verbose` to vitest commands in `acceptance_tests` that declare `proves`
 */

const fs = require('fs');
const path = require('path');
const testScope = require('./oxe-test-scope.cjs');
const suiteImpactLib = require('./oxe-suite-impact.cjs');
const planJsonLib = require('./oxe-plan-json.cjs');
const changeLib = require('./oxe-change.cjs');

const NON_WRITER_KINDS = new Set(['external_delivery', 'verify_only', 'spike']);
const TEST_ARG_RE = /[^\s"'`]+\.(?:test|spec)\.[cm]?[jt]sx?/g;
const VERBOSE_RE = /--reporter[= ]verbose|--verbose|--test-reporter[= ](tap|spec)|node\s+--test|\s-v\b|junit|\b(gradlew|gradle|mvnw?)/i;

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
const isDone = (t) => Boolean(t && (t.done === true || t.status === 'done'));
const isPendingWriter = (t) => Boolean(t && !isDone(t) && !NON_WRITER_KINDS.has(t.kind));
const getDeps = (t) => [...(t.depends_on || t.dependsOn || [])].filter(Boolean);
const setDeps = (t, next) => {
  const uniq = [...new Set(next.filter(Boolean))];
  if (Array.isArray(t.dependsOn) && !Array.isArray(t.depends_on)) t.dependsOn = uniq;
  else t.depends_on = uniq;
};

function overlaps(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return testScope.covers(na, nb) || testScope.covers(nb, na);
}

function wouldCreateCycle(tasksById, fromId, toDepId) {
  if (fromId === toDepId) return true;
  const visited = new Set();
  const stack = [toDepId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === fromId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const t = tasksById.get(cur);
    if (t) stack.push(...getDeps(t));
  }
  return false;
}

function pruneVerifyCommand(cmd, dropSet, anchorSet) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = (s) => esc(norm(s)).replace(/\//g, '[\\\\/]');
  const parts = String(cmd).split(/(\s*(?:&&|\|\||;)\s*)/);
  const keep = [];
  for (let i = 0; i < parts.length; i += 2) {
    let n = parts[i];
    for (const arg of dropSet) {
      n = n.replace(new RegExp(`(^|\\s)(["'\`]?)${pat(arg)}\\$?\\2(?=\\s|$)`, 'g'), (_m, p1) => p1);
    }
    for (const arg of anchorSet) {
      n = n.replace(new RegExp(`(^|\\s)(["'\`]?)(${pat(arg)})\\2(?=\\s|$)`, 'g'), (_m, p1, q, a) => `${p1}${q}${a}$${q}`);
    }
    if (n !== parts[i]) n = n.replace(/\s{2,}/g, ' ').trim();
    const had = (parts[i].match(TEST_ARG_RE) || []).length;
    const has = (n.match(TEST_ARG_RE) || []).length;
    if (had && !has) continue;
    if (n) keep.push({ sep: i ? parts[i - 1] : null, text: n });
  }
  return keep.map((k, j) => (j ? (k.sep || ' && ') : '') + k.text).join('');
}

function inferSuiteRunnerTemplate(task, configuredTemplate) {
  if (typeof configuredTemplate === 'string' && configuredTemplate.includes('{files}')) {
    return configuredTemplate;
  }
  const cmds = [
    ...((task.verify && Array.isArray(task.verify.commands)) ? task.verify.commands : []),
    task.verify && task.verify.command,
    task.verifyCommand,
  ].filter(Boolean).join(' && ');
  if (/\bnode\s+--test\b/.test(cmds)) return 'node --test {files}';
  if (/\bpnpm\s+(?:exec\s+)?vitest\b/.test(cmds)) return 'pnpm vitest run {files}';
  if (/\bvitest\b/.test(cmds)) return 'npx vitest run {files}';
  if (/\bjest\b/.test(cmds)) return 'npx jest {files}';
  return 'npx vitest run {files}';
}

/**
 * Runs all deterministic repairs against a cloned `PLAN.json` document in memory.
 *
 * @param {string} projectRoot
 * @param {object} inputDoc
 * @param {{
 *   scopeAdd?: boolean,
 *   suiteImpact?: boolean,
 *   runnerTemplate?: string|null,
 *   suiteImpactOptions?: object,
 * }} [options]
 */
function repairPlan(projectRoot, inputDoc, options = {}) {
  const doc = JSON.parse(JSON.stringify(inputDoc || { schema_version: 1, tasks: [] }));
  const allowScopeAdd = options.scopeAdd !== false;
  const allowSuiteImpact = options.suiteImpact !== false;
  const repairs = [];
  const taskEdits = new Map();
  const noteTaskEdit = (taskId, patch) => {
    if (!taskEdits.has(taskId)) taskEdits.set(taskId, []);
    taskEdits.get(taskId).push(patch);
  };

  const tasks = (Array.isArray(doc.tasks) ? doc.tasks : []).filter(Boolean);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const acceptance = (Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : []).filter(Boolean);
  const frozenFiles = new Set(
    acceptance.flatMap((a) => (a.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path))).filter(Boolean),
  );

  // ── 1. Remove frozen acceptance test paths from pending tasks' `files` ────────────────────────────────────────
  for (const t of tasks) {
    if (isDone(t) || !Array.isArray(t.files)) continue;
    const removed = [];
    const kept = [];
    for (const raw of t.files) {
      const p = norm(typeof raw === 'string' ? raw : raw && raw.path);
      if (p && frozenFiles.has(p)) removed.push(p);
      else kept.push(raw);
    }
    if (removed.length) {
      t.files = kept;
      repairs.push({ kind: 'frozen_in_task_files', task: t.id, removed });
      noteTaskEdit(t.id, { removed_frozen_from_files: removed });
    }
  }

  // ── 2. Resolve OXB-171 scopeGaps (wire `depends_on` to owner, or add unowned product files to `task.files`) ───
  const gaps = testScope.scopeGaps(projectRoot, doc);
  const pendingWriters = tasks.filter(isPendingWriter);
  for (const [taskId, gap] of Object.entries(gaps)) {
    const t = byId.get(taskId);
    if (!t || isDone(t)) continue;
    const addedDeps = [];
    const addedFiles = [];
    const haveFiles = new Set((t.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)));
    for (const missingPath of gap.files || []) {
      const p = norm(missingPath);
      if (!p || frozenFiles.has(p)) continue;
      const owners = pendingWriters.filter(
        (o) => o.id !== t.id && (o.files || []).some((entry) => testScope.covers(norm(typeof entry === 'string' ? entry : entry && entry.path), p)),
      );
      if (owners.length > 0) {
        const curDeps = getDeps(t);
        for (const owner of owners) {
          if (!curDeps.includes(owner.id) && !wouldCreateCycle(byId, t.id, owner.id)) {
            curDeps.push(owner.id);
            addedDeps.push(owner.id);
          }
        }
        setDeps(t, curDeps);
      } else if (allowScopeAdd && !haveFiles.has(p)) {
        t.files = [...(t.files || []), p];
        haveFiles.add(p);
        addedFiles.push(p);
      }
    }
    if (addedDeps.length) {
      const uniqDeps = [...new Set(addedDeps)];
      repairs.push({ kind: 'scope_gap_dependency', task: t.id, added_depends_on: uniqDeps });
      noteTaskEdit(t.id, { added_depends_on: uniqDeps });
    }
    if (addedFiles.length) {
      repairs.push({ kind: 'scope_gap_files', task: t.id, added_files: addedFiles });
      noteTaskEdit(t.id, { added_files: addedFiles });
    }
  }

  // ── 3. Fix dependency wave inversions, serialize same-wave write overlaps, and compact empty waves ────────────
  const pending = tasks.filter((t) => !isDone(t));
  for (const t of pending) {
    if (!Number.isInteger(t.wave) || t.wave < 1) t.wave = 1;
  }
  const propagateWaves = () => {
    const bumped = new Map();
    let changed = true;
    let guard = 0;
    while (changed && guard < pending.length + 2) {
      changed = false;
      guard += 1;
      for (const t of pending) {
        for (const depId of getDeps(t)) {
          const dep = byId.get(depId);
          if (!dep || isDone(dep)) continue;
          const minWave = (Number(dep.wave) || 1) + 1;
          if (t.wave < minWave) {
            if (!bumped.has(t.id)) bumped.set(t.id, t.wave);
            t.wave = minWave;
            changed = true;
          }
        }
      }
    }
    return bumped;
  };

  const depBumps = propagateWaves();
  for (const [id, fromWave] of depBumps) {
    const toWave = byId.get(id).wave;
    repairs.push({ kind: 'dependency_wave_order', task: id, from_wave: fromWave, to_wave: toWave });
    noteTaskEdit(id, { wave_from: fromWave, wave_to: toWave });
  }

  // Same-wave write overlap serialization
  let collisionPass = 0;
  let foundCollision = true;
  while (foundCollision && collisionPass < pendingWriters.length + 2) {
    foundCollision = false;
    collisionPass += 1;
    const writers = tasks.filter(isPendingWriter);
    for (let i = 0; i < writers.length; i += 1) {
      for (let j = i + 1; j < writers.length; j += 1) {
        const a = writers[i];
        const b = writers[j];
        if (a.wave !== b.wave) continue;
        const aFiles = [...new Set((a.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)).filter(Boolean))];
        const bFiles = [...new Set((b.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)).filter(Boolean))];
        const shared = aFiles.find((fa) => bFiles.some((fb) => overlaps(fa, fb)));
        if (!shared) continue;
        const canBDependOnA = !wouldCreateCycle(byId, b.id, a.id);
        const earlier = canBDependOnA ? a : b;
        const later = canBDependOnA ? b : a;
        const prevWave = later.wave;
        if (!wouldCreateCycle(byId, later.id, earlier.id)) {
          const deps = getDeps(later);
          if (!deps.includes(earlier.id)) setDeps(later, [...deps, earlier.id]);
        }
        later.wave = earlier.wave + 1;
        propagateWaves();
        repairs.push({
          kind: 'same_wave_overlap',
          task: later.id,
          serialized_after: earlier.id,
          shared_path: shared,
          from_wave: prevWave,
          to_wave: later.wave,
        });
        noteTaskEdit(later.id, { serialized_after: earlier.id, shared_path: shared, wave_to: later.wave });
        foundCollision = true;
        break;
      }
      if (foundCollision) break;
    }
  }

  // Compact empty wave gaps among pending tasks (keeps min pending wave intact)
  if (pending.length > 0) {
    const uniqueWaves = [...new Set(pending.map((t) => t.wave))].sort((a, b) => a - b);
    const baseWave = uniqueWaves[0];
    const waveMap = new Map(uniqueWaves.map((w, idx) => [w, baseWave + idx]));
    for (const t of pending) {
      const targetWave = waveMap.get(t.wave);
      if (targetWave !== t.wave) {
        const prev = t.wave;
        t.wave = targetWave;
        repairs.push({ kind: 'compact_empty_wave', task: t.id, from_wave: prev, to_wave: targetWave });
        noteTaskEdit(t.id, { compacted_wave_from: prev, wave_to: targetWave });
      }
    }
  }

  // ── 4. Prune G38 later-owned tests and anchor vitest substring collisions ─────────────────────────────────────
  const laterFindings = suiteImpactLib.laterOwnedTests(doc);
  if (laterFindings.length > 0) {
    const byTask = new Map();
    for (const f of laterFindings) {
      if (!byTask.has(f.task)) byTask.set(f.task, { drop: new Set(), anchor: new Set() });
      const entry = byTask.get(f.task);
      if (!f.via) entry.drop.add(f.test);
      else entry.anchor.add(f.via);
    }
    for (const entry of byTask.values()) {
      for (const a of entry.anchor) if (entry.drop.has(a)) entry.anchor.delete(a);
    }
    for (const t of pending) {
      const entry = byTask.get(t.id);
      if (!entry) continue;
      const beforeCmds = t.verify && Array.isArray(t.verify.commands) ? [...t.verify.commands] : null;
      const beforeCmd = t.verify && t.verify.command ? t.verify.command : null;
      const beforeVC = t.verifyCommand || null;
      const afterCmds = beforeCmds ? beforeCmds.map((c) => pruneVerifyCommand(c, entry.drop, entry.anchor)).filter(Boolean) : null;
      const afterCmd = beforeCmd ? pruneVerifyCommand(beforeCmd, entry.drop, entry.anchor) || null : null;
      const afterVC = beforeVC ? pruneVerifyCommand(beforeVC, entry.drop, entry.anchor) || null : null;
      const flat = (cmds, cmd, vc) => [...(cmds || []), ...(cmd ? [cmd] : []), ...(vc ? [vc] : [])];
      if (JSON.stringify(flat(afterCmds, afterCmd, afterVC)) === JSON.stringify(flat(beforeCmds, beforeCmd, beforeVC))) continue;
      if (beforeCmds) t.verify.commands = afterCmds;
      if (beforeCmd) { if (afterCmd) t.verify.command = afterCmd; else delete t.verify.command; }
      if (beforeVC) { if (afterVC) t.verifyCommand = afterVC; else delete t.verifyCommand; }
      const removed = [...entry.drop];
      const anchored = [...entry.anchor];
      repairs.push({ kind: 'verify_later_owned', task: t.id, removed, anchored });
      noteTaskEdit(t.id, { verify_pruned: removed, ...(anchored.length ? { verify_anchored: anchored } : {}) });
    }
  }

  // ── 5. Add G30 impacted existing suites to `task.verify.commands` (+ unowned G30b data fixtures) ─────────────
  if (allowSuiteImpact && projectRoot) {
    let impactFindings = [];
    try {
      impactFindings = suiteImpactLib.suiteImpact(projectRoot, doc, options.suiteImpactOptions || {});
    } catch {
      impactFindings = [];
    }
    const suitesByTask = new Map();
    const dataByTask = new Map();
    for (const f of impactFindings) {
      if (!suitesByTask.has(f.task)) suitesByTask.set(f.task, new Set());
      for (const s of f.suites || []) if (s && s.test) suitesByTask.get(f.task).add(norm(s.test));
      if (!dataByTask.has(f.task)) dataByTask.set(f.task, new Set());
      for (const d of f.data || []) if (d && d.file) dataByTask.get(f.task).add(norm(d.file));
    }
    for (const [taskId, suiteSet] of suitesByTask) {
      const t = byId.get(taskId);
      if (!t || isDone(t) || !suiteSet.size) continue;
      const suites = [...suiteSet];
      const tpl = inferSuiteRunnerTemplate(t, options.runnerTemplate);
      const cmd = tpl.replace('{files}', suites.join(' '));
      if (!t.verify || typeof t.verify !== 'object') t.verify = { commands: [] };
      if (!Array.isArray(t.verify.commands)) {
        t.verify.commands = t.verify.command ? [t.verify.command] : [];
        delete t.verify.command;
      }
      if (!t.verify.commands.includes(cmd)) {
        t.verify.commands.push(cmd);
        repairs.push({ kind: 'suite_impact_verify', task: t.id, added_suites: suites, command: cmd });
        noteTaskEdit(t.id, { added_impacted_suites: suites });
      }
    }
    if (allowScopeAdd) {
      const writersNow = tasks.filter(isPendingWriter);
      for (const [taskId, dataSet] of dataByTask) {
        const t = byId.get(taskId);
        if (!t || !isPendingWriter(t) || !dataSet.size) continue;
        const have = new Set((t.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)));
        const addedData = [];
        for (const df of dataSet) {
          if (have.has(df) || frozenFiles.has(df)) continue;
          const ownedElsewhere = writersNow.some((o) => o.id !== t.id && (o.files || []).some((e) => overlaps(e, df)));
          if (ownedElsewhere) continue;
          t.files = [...(t.files || []), df];
          have.add(df);
          addedData.push(df);
        }
        if (addedData.length) {
          repairs.push({ kind: 'suite_impact_data_scope', task: t.id, added_files: addedData });
          noteTaskEdit(t.id, { added_suite_data_files: addedData });
        }
      }
    }
  }

  // ── 6. Inject `--reporter=verbose` on vitest `acceptance_tests` that declare `proves` ─────────────────────────
  for (const entry of acceptance) {
    if (!Array.isArray(entry.proves) || entry.proves.length === 0) continue;
    const cmd = String(entry.command || '');
    if (!cmd || VERBOSE_RE.test(cmd)) continue;
    if (!/\bvitest\b/.test(cmd)) continue;
    const updated = cmd.replace(/\b(vitest(?:\s+run)?)\b/, '$1 --reporter=verbose');
    if (updated !== cmd) {
      entry.command = updated;
      repairs.push({
        kind: 'proves_verbose_reporter',
        criterion: entry.criterion || entry.id || null,
        before: cmd,
        after: updated,
      });
    }
  }

  const byKind = {};
  for (const r of repairs) byKind[r.kind] = (byKind[r.kind] || 0) + 1;

  return {
    changed: repairs.length > 0,
    repairs,
    counts: byKind,
    taskEdits,
    doc,
  };
}

/**
 * Repairs `PLAN.json` on disk (locked & audited) or previews repairs when `dryRun` is true.
 *
 * @param {string} projectRoot
 * @param {string} planPath - path to `PLAN.md` or `PLAN.json`
 * @param {{
 *   dryRun?: boolean,
 *   apply?: boolean,
 *   by?: string,
 *   reason?: string,
 *   programDir?: string|null,
 *   scopeAdd?: boolean,
 *   suiteImpact?: boolean,
 *   runnerTemplate?: string|null,
 * }} [options]
 */
function repairPlanFile(projectRoot, planPath, options = {}) {
  const dryRun = options.apply === true ? false : options.dryRun !== false;
  const jsonPath = /\.json$/i.test(String(planPath || ''))
    ? path.resolve(projectRoot, planPath)
    : planJsonLib.planJsonPathFor(path.resolve(projectRoot, planPath || path.join('.oxe', 'PLAN.md')));
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    throw new Error('plan repair exige PLAN.json existente');
  }
  const by = String(options.by || '').trim();
  const reason = String(options.reason || '').trim();
  if (!dryRun) {
    if (!by) throw new Error('plan repair --apply exige --by <papel>');
    if (reason.length < 8) throw new Error('plan repair --apply exige --reason "…" (mínimo 8 caracteres)');
  }

  const at = new Date().toISOString();
  const outcome = planJsonLib.withPlanLock(jsonPath, () => {
    const current = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const res = repairPlan(projectRoot, current, options);
    if (!dryRun && res.changed) {
      for (const t of (res.doc.tasks || []).filter(Boolean)) {
        const patches = res.taskEdits.get(t.id);
        if (!patches || !patches.length) continue;
        t.edits = [
          ...(Array.isArray(t.edits) ? t.edits : []),
          { kind: 'plan_repair', by, reason, at, repairs: patches },
        ];
      }
      const tmp = `${jsonPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(res.doc, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, jsonPath);
    }
    return res;
  });

  if (!dryRun && outcome.changed) {
    const programDir = options.programDir || path.join(projectRoot, '.oxe', 'program');
    try {
      changeLib.appendNdjson(changeLib.changesFile(programDir), {
        kind: 'plan_repair',
        by,
        reason,
        at,
        counts: outcome.counts,
        repairs: outcome.repairs,
      });
    } catch { /* auxiliary audit log */ }
  }

  return {
    dry_run: dryRun,
    changed: outcome.changed,
    counts: outcome.counts,
    repairs: outcome.repairs,
    plan_json: jsonPath,
  };
}

module.exports = {
  repairPlan,
  repairPlanFile,
  pruneVerifyCommand,
};
