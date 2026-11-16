'use strict';

/**
 * OXB-C1 (P1 #1–#4): single-task / multi-task `runtime promote` hardening:
 *   1. `selectPromoteQuickCommits` — includes `OXE-Quick` commits of the task's card (or naming the task) made since the
 *      previous checkpoint on that card (or preceding checkpoint), in history order; warns & skips if a quick touches
 *      another task's files.
 *   2. `reconcilePromotedRatchets` & `checkPromotedEnforcedTargets` — recalculates `lint.ratchets` caps in the promote
 *      worktree against `base + task` so program-wide caps lower than `base + task`'s real count never break `main` CI;
 *      warns when `enforced.lock.json` promotes a target to `enforced` whose selector is absent from `main`'s
 *      conformance scene, proposing `pending` with reason.
 *   3. `analyzeUnpromotedDependencies` — finds unpromoted tasks in `base..HEAD` whose commits share modified files or
 *      define/modify modules/symbols imported by the promoted task, suggesting the topological promotion order (and
 *      blocking when `--strict` is set).
 *   4. `discoverMainCiRiskSuites` & `buildPreviewCiCommands` — identifies `axe`/`a11y-surfaces`/`conformance` and `e2e`
 *      suites on `main` covering the touched components (for the PR body risk section and `promote --preview-ci`).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const norm = (p) => String(typeof p === 'string' ? p : (p && p.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');

const QUICK_RE = /^OXE-Quick:\s*(Q-\d{8}-[a-z0-9]{4})\s*$/im;
const CARD_RE = /^OXE-Card:\s*([A-Za-z][A-Za-z0-9]*-\d+|\d+)\s*$/im;
const TASK_TRAILER_RE = /^OXE-Task:\s*(?:([A-Za-z][\w.-]*)\/)?(T(?:\d[\w.-]*|-[A-Za-z0-9][\w.-]*))\s*$/gm;

function gitOut(cwd, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

function gitLines(cwd, args) {
  const r = gitOut(cwd, args);
  return r.ok ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
}

function parseTaskTrailers(body, currentPhase) {
  const out = [];
  for (const m of String(body || '').matchAll(TASK_TRAILER_RE)) {
    const ph = m[1] || null;
    const id = String(m[2] || '').toUpperCase();
    if (currentPhase && ph && ph.toUpperCase() !== String(currentPhase).toUpperCase()) continue;
    out.push({ phase: ph, id });
  }
  return out;
}

/**
 * Resolves the ALM card key(s) associated with a plan task (from task fields or `.oxe/program` ALM mapping).
 */
function resolveTaskCards(projectRoot, programDir, config, phaseId, task) {
  const keys = new Set();
  for (const raw of [task && task.card, task && task.alm_key, task && task.key, ...(Array.isArray(task && task.cards) ? task.cards : [])]) {
    if (typeof raw === 'string' && raw.trim()) keys.add(raw.trim().toUpperCase());
  }
  try {
    const almLib = require('./oxe-alm.cjs');
    const almCfg = almLib.almConfig(config || {});
    if (almCfg && task && task.id) {
      const k = almLib.keyFor(programDir || path.join(projectRoot, '.oxe', 'program'), almCfg, phaseId || null, task.id);
      if (k) keys.add(String(k).trim().toUpperCase());
    }
  } catch { /* no ALM */ }
  return keys;
}

/**
 * P1.1: Selects `OXE-Quick` commits in `range` (`baseSha..HEAD`) that belong to the promoted `planTasks`.
 *
 * A quick belongs to `planTasks` when:
 *   - it carries an `OXE-Task` trailer naming one of `taskIds`, OR its commit message / `.oxe/quick/<id>.json` objective
 *     explicitly mentions `\bT<n>\b` (not qualified by another phase), OR
 *   - its `OXE-Card` (from trailer or `.oxe/quick/<id>.json`) matches one of `planTasks`' cards AND the commit sits
 *     after any earlier done task's checkpoint on that same card (and not in a window before a prior checkpoint that
 *     already closed another task of the same card).
 *
 * Safety rule: if a matching quick modifies a file outside `planTasks`' scope that belongs to another active task in
 * `PLAN.json` (or that another task already modified in `range`), it is NOT cherry-picked and emits a warning instead.
 */
function selectPromoteQuickCommits(projectRoot, {
  range,
  orderedTaskShas,
  planTasks,
  allTasks = [],
  phase = null,
  programDir = null,
  config = {},
}) {
  const idSet = new Set((planTasks || []).map((t) => String(t.id).toUpperCase()));
  const existingSet = new Set(orderedTaskShas || []);
  const allRangeShas = gitLines(projectRoot, ['rev-list', '--reverse', '--topo-order', range]);
  if (!allRangeShas.length) return { quicks: [], skipped: [], warnings: [] };

  const quickLib = (() => { try { return require('./oxe-quick.cjs'); } catch { return null; } })();
  const testScope = require('./oxe-test-scope.cjs');

  // Card keys of promoted tasks vs other tasks on the same card
  const ourCards = new Set();
  for (const t of planTasks || []) {
    for (const k of resolveTaskCards(projectRoot, programDir, config, phase, t)) ourCards.add(k);
  }
  const otherTasks = (allTasks || []).filter((t) => t && !idSet.has(String(t.id).toUpperCase()) && !t.superseded && !t.merged_into);
  const otherByCard = new Map();
  for (const o of otherTasks) {
    for (const k of resolveTaskCards(projectRoot, programDir, config, phase, o)) {
      if (!otherByCard.has(k)) otherByCard.set(k, []);
      otherByCard.get(k).push(o);
    }
  }

  const ownScope = (planTasks || []).flatMap((t) => (t.files || []).map(norm)).filter(Boolean);
  const inOwnScope = (f) => ownScope.some((s) => testScope.covers(s, f));
  const otherTaskScopes = otherTasks.map((o) => ({
    id: String(o.id).toUpperCase(),
    wave: Number.isFinite(Number(o.wave)) ? Number(o.wave) : null,
    files: (o.files || []).map(norm).filter(Boolean),
  }));

  // Metadata of every commit in range
  const shaIndex = new Map();
  const commitMeta = new Map();
  const otherCommitsByFile = new Map(); // file -> Set<otherTaskId>
  const lastCheckpointIdxByTask = new Map();

  allRangeShas.forEach((sha, idx) => {
    shaIndex.set(sha, idx);
    const body = gitOut(projectRoot, ['log', '-1', '--format=%B', sha]).stdout;
    const files = gitLines(projectRoot, ['show', '--name-only', '--format=', '--no-renames', sha]).map(norm).filter((f) => f && !f.startsWith('.oxe/'));
    const taskTrailers = parseTaskTrailers(body, phase);
    for (const tr of taskTrailers) {
      lastCheckpointIdxByTask.set(tr.id, idx);
      if (!idSet.has(tr.id)) {
        for (const f of files) {
          if (!otherCommitsByFile.has(f)) otherCommitsByFile.set(f, new Set());
          otherCommitsByFile.get(f).add(tr.id);
        }
      }
    }
    commitMeta.set(sha, { idx, body, files, taskTrailers });
  });
  for (const o of otherTasks) {
    if (o.done_commit) {
      const full = gitLines(projectRoot, ['rev-parse', '--verify', `${o.done_commit}^{commit}`])[0];
      if (full && shaIndex.has(full)) lastCheckpointIdxByTask.set(String(o.id).toUpperCase(), shaIndex.get(full));
    }
  }

  // Earliest commit index of our promoted tasks (if any)
  const ourIndices = (orderedTaskShas || []).map((s) => shaIndex.get(s)).filter((x) => x !== undefined);
  const firstOurIdx = ourIndices.length ? Math.min(...ourIndices) : 0;
  // Immediate previous task checkpoint index before our first commit (general lower bound for task-less card quicks when earlier tasks share card)
  const minWave = Math.min(...(planTasks || []).map((t) => (Number.isFinite(Number(t.wave)) ? Number(t.wave) : Infinity)));

  const quicks = [];
  const skipped = [];
  const warnings = [];

  const mentionsOurTask = (text) => {
    for (const id of idSet) {
      // Match `T34` or `F6/T34`, but NOT `F5/T34` when phase is `F6`
      const re = new RegExp(`(?:([A-Za-z][\\w.-]*)/)?\\b${id}\\b`, 'gi');
      for (const m of String(text || '').matchAll(re)) {
        if (m[1] && phase && m[1].toUpperCase() !== String(phase).toUpperCase()) continue;
        return true;
      }
    }
    return false;
  };

  for (const sha of allRangeShas) {
    if (existingSet.has(sha)) continue;
    const meta = commitMeta.get(sha);
    if (!meta) continue;
    // Skip commits that belong to another task's OXE-Task trailer
    if (meta.taskTrailers.some((tr) => !idSet.has(tr.id))) continue;

    const qm = QUICK_RE.exec(meta.body);
    if (!qm) continue;
    const quickId = qm[1];
    const rec = quickLib ? quickLib.read(projectRoot, quickId) : null;
    const cardMatch = CARD_RE.exec(meta.body);
    const quickCard = String((cardMatch && cardMatch[1]) || (rec && rec.key) || '').trim().toUpperCase() || null;
    const combinedText = `${meta.body}\n${(rec && rec.objective) || ''}`;

    const directTaskMatch = meta.taskTrailers.some((tr) => idSet.has(tr.id)) || mentionsOurTask(combinedText);
    let cardWindowMatch = false;
    if (!directTaskMatch && quickCard && ourCards.has(quickCard)) {
      const siblings = otherByCard.get(quickCard) || [];
      // Previous checkpoint on the same card: max checkpoint index of done sibling tasks that preceded our task
      let lowerBound = -1;
      let upperBound = Infinity;
      for (const sib of siblings) {
        const sibId = String(sib.id).toUpperCase();
        const sibIdx = lastCheckpointIdxByTask.get(sibId);
        if (sibIdx === undefined) continue;
        const sibWave = Number.isFinite(Number(sib.wave)) ? Number(sib.wave) : Infinity;
        if (sibIdx < firstOurIdx || sibWave < minWave) {
          if (sibIdx > lowerBound) lowerBound = sibIdx;
        } else if (sibIdx > firstOurIdx && sib.done === true) {
          if (sibIdx < upperBound) upperBound = sibIdx;
        }
      }
      cardWindowMatch = meta.idx > lowerBound && meta.idx < upperBound;
    }

    if (!directTaskMatch && !cardWindowMatch) continue;

    // Check if this quick touches files belonging to ANOTHER task
    const foreignTouches = [];
    for (const f of meta.files) {
      const committedByOther = [...(otherCommitsByFile.get(f) || [])];
      const scopedToOther = !inOwnScope(f)
        ? otherTaskScopes.filter((o) => o.files.some((sf) => testScope.covers(sf, f))).map((o) => o.id)
        : [];
      const owners = [...new Set([...committedByOther, ...scopedToOther])];
      if (owners.length) foreignTouches.push({ file: f, tasks: owners });
    }

    if (foreignTouches.length) {
      const ownerIds = [...new Set(foreignTouches.flatMap((x) => x.tasks))];
      const touchedList = foreignTouches.map((x) => `${x.file} (${x.tasks.join(', ')})`).slice(0, 4).join(', ');
      skipped.push({ sha, quick: quickId, card: quickCard, foreign: foreignTouches });
      warnings.push(
        `quick ${sha.slice(0, 8)} (${quickId}${quickCard ? `, ${quickCard}` : ''}) não foi incluído no promote: toca arquivo(s) de outra tarefa — ${touchedList}. Leve à mão se seguro ou promova junto (--tasks ${[...idSet, ...ownerIds].join(',')})`
      );
      continue;
    }

    quicks.push({ sha, quick: quickId, card: quickCard, files: meta.files });
  }

  return { quicks, skipped, warnings };
}

/**
 * P1.2 (a): Reconciles `lint.ratchets` in the promote worktree `work` against `buildSha` (`base` + promoted task).
 * If a ratchet's cap in `work` is tighter than the real count in `work` (because unpromoted sibling tasks lowered it
 * on the program branch), or looser when `r.file` was modified by the promote, rewrites the cap to `realCount` (never
 * below what `work` actually has) and returns the modified files + adjustments.
 */
function reconcilePromotedRatchets(work, buildSha, config) {
  const ratchetsLib = require('./oxe-ratchets.cjs');
  const list = ratchetsLib.ratchetsOf(config || {});
  if (!list.length) return { adjusted: [], files: [] };

  const changedInWork = new Set(gitLines(work, ['diff', '--name-only', buildSha, 'HEAD']).map(norm));
  const adjusted = [];
  const files = new Set();

  for (const r of list) {
    const abs = path.join(work, r.file);
    if (!fs.existsSync(abs)) continue;
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const cap = ratchetsLib.capOf(text, r);
    if (!cap) continue;
    const realCount = ratchetsLib.countOf(work, r);
    const violatedOnMainPlusTask = r.direction === 'down' ? cap.value < realCount : cap.value > realCount;
    const touchedHere = changedInWork.has(r.file);
    if (!violatedOnMainPlusTask && !touchedHere) continue;
    if (cap.value === realCount) continue;

    // Never leave cap below realCount on a `down` ratchet, and when r.file was brought by the task set cap = realCount
    const nextCap = r.direction === 'down'
      ? (violatedOnMainPlusTask ? realCount : Math.min(cap.value, realCount))
      : (violatedOnMainPlusTask ? realCount : Math.max(cap.value, realCount));
    if (nextCap === cap.value) continue;

    const nextText = text.slice(0, cap.index) + String(nextCap) + text.slice(cap.index + cap.length);
    fs.writeFileSync(abs, nextText, 'utf8');
    files.add(r.file);
    adjusted.push({
      file: r.file,
      line: cap.line,
      program_cap: cap.value,
      promoted_cap: nextCap,
      real_count: realCount,
    });
  }

  return { adjusted, files: [...files] };
}

function extractEnforcedEntries(doc) {
  const out = new Map(); // id -> { status, selector }
  if (!doc || typeof doc !== 'object') return out;
  if (Array.isArray(doc)) {
    for (const item of doc) {
      if (item && typeof item === 'object' && item.id) {
        out.set(String(item.id), { status: String(item.status || item.state || ''), selector: item.selector || item.query || null });
      }
    }
    return out;
  }
  if (Array.isArray(doc.enforced)) {
    for (const id of doc.enforced) out.set(String(id), { status: 'enforced', selector: null });
  }
  const container = (doc.targets && typeof doc.targets === 'object' && !Array.isArray(doc.targets))
    ? doc.targets
    : (doc.entries && typeof doc.entries === 'object' && !Array.isArray(doc.entries))
      ? doc.entries
      : doc;
  for (const [k, v] of Object.entries(container)) {
    if (['schema', 'schema_version', 'version', 'updated_at', 'generated_at', 'enforced'].includes(k)) continue;
    if (typeof v === 'string') out.set(k, { status: v, selector: null });
    else if (v && typeof v === 'object') {
      out.set(k, { status: String(v.status || v.state || (v.enforced === true ? 'enforced' : '')), selector: v.selector || v.query || null });
    }
  }
  return out;
}

function extractSelectorTokens(selector, targetId) {
  const tokens = [];
  const s = String(selector || '').trim();
  if (s) {
    for (const m of s.matchAll(/\[([a-zA-Z0-9_-]+)(?:[~|^$*]?=["']?([^\]"']+)["']?)?\]/g)) {
      if (m[2]) tokens.push(m[2]);
      else tokens.push(m[1]);
    }
    for (const m of s.matchAll(/([.#][A-Za-z_-][\w-]*)/g)) tokens.push(m[1].slice(1));
  }
  if (!tokens.length && targetId) {
    // e.g. `BRD-13.branch.font-family` -> surface segment `branch`
    const parts = String(targetId).split('.');
    if (parts.length >= 2 && !/^BRD-\d+$/i.test(parts[1])) tokens.push(parts[1]);
  }
  return [...new Set(tokens.filter((t) => t && t.length >= 3))];
}

/**
 * P1.2 (b): Checks `*enforced*.json` files changed in `work` (`buildSha..HEAD`). For entries newly promoted to
 * `enforced`, verifies that `work`'s conformance scene files contain the target's selector/hook; otherwise warns and
 * proposes `"pending"` with the reason.
 */
function checkPromotedEnforcedTargets(work, buildSha, { base = 'main', config = {} } = {}) {
  const changed = gitLines(work, ['diff', '--name-only', buildSha, 'HEAD']).map(norm);
  const lockFiles = changed.filter((f) => /(^|\/)[^/]*enforced[^/]*\.json$/i.test(f));
  if (!lockFiles.length) return { gaps: [], warnings: [] };

  const allFiles = gitLines(work, ['ls-files']).map(norm);
  const configuredScenes = (config && config.promote && Array.isArray(config.promote.conformance_scenes))
    ? config.promote.conformance_scenes.map(norm)
    : [];
  const sceneFiles = configuredScenes.length
    ? allFiles.filter((f) => configuredScenes.some((s) => f === s || f.startsWith(s)))
    : allFiles.filter((f) => /(conformance|brand-scene|brand-targets|brand.*fixture|conformance.*scene)/i.test(f) && !/enforced[^/]*\.json$/i.test(f));
  if (!sceneFiles.length) return { gaps: [], warnings: [] };

  // Optional target definitions (selectors by target id) in brand target files
  const selectorByTarget = new Map();
  for (const tf of allFiles.filter((f) => /(brand[-_]?targets|conformance[-_]?targets)\.[cm]?[jt]sx?$|\.json$/i.test(f) && /brand|conformance/i.test(f)).slice(0, 20)) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(work, tf), 'utf8'); } catch { continue; }
    for (const m of txt.matchAll(/['"`](BRD-\d+(?:\.[\w-]+)+)['"`][\s\S]{0,240}?selector\s*:\s*['"`]([^'"`]+)['"`]/g)) {
      selectorByTarget.set(m[1], m[2]);
    }
  }

  const sceneCorpus = sceneFiles.map((f) => {
    try { return fs.readFileSync(path.join(work, f), 'utf8'); } catch { return ''; }
  }).join('\n');

  const gaps = [];
  const warnings = [];

  for (const lf of lockFiles) {
    let afterDoc = null;
    let beforeDoc = null;
    try { afterDoc = JSON.parse(fs.readFileSync(path.join(work, lf), 'utf8')); } catch { continue; }
    const baseShow = gitOut(work, ['show', `${buildSha}:${lf}`]);
    if (baseShow.ok) {
      try { beforeDoc = JSON.parse(baseShow.stdout); } catch { beforeDoc = null; }
    }
    const afterMap = extractEnforcedEntries(afterDoc);
    const beforeMap = extractEnforcedEntries(beforeDoc);

    for (const [id, info] of afterMap) {
      if (info.status !== 'enforced') continue;
      const prev = beforeMap.get(id);
      if (prev && prev.status === 'enforced') continue;

      const selector = info.selector || selectorByTarget.get(id) || null;
      const tokens = extractSelectorTokens(selector, id);
      if (!tokens.length) continue;

      const present = tokens.some((tok) => sceneCorpus.includes(tok));
      if (!present) {
        const proposal = {
          file: lf,
          id,
          selector: selector || tokens.join(', '),
          proposed_status: 'pending',
          proposed_reason: `cena de conformidade em ${base} ainda não monta ${selector || tokens[0]} (evita "measured no element")`,
        };
        gaps.push(proposal);
        warnings.push(
          `${lf} promove ${id} como "enforced", mas a cena de conformidade em ${base} não tem o seletor \`${proposal.selector}\` ("measured no element") — mantenha como "pending" com motivo: "${proposal.proposed_reason}"`
        );
      }
    }
  }

  return { gaps, warnings };
}

/**
 * P1.3: Finds unpromoted tasks in `range` (`baseSha..HEAD`) that the promoted `planTasks` touch or import from
 * (shared modified files or imported files/symbols created or changed by another unpromoted task), returning a
 * suggested topological promotion order.
 */
function analyzeUnpromotedDependencies(projectRoot, {
  range,
  baseSha,
  orderedTaskShas,
  planTasks,
  phase = null,
  stackedTaskIds = [],
}) {
  const idSet = new Set((planTasks || []).map((t) => String(t.id).toUpperCase()));
  const stackedSet = new Set((stackedTaskIds || []).map((id) => String(id).toUpperCase()));
  const allRangeShas = gitLines(projectRoot, ['rev-list', '--reverse', '--topo-order', range]);
  if (!allRangeShas.length) return { dependencies: [], suggested_order: [], warnings: [] };

  const CODE_RE = /\.(c|m)?[jt]sx?$/i;
  const pb = require('./oxe-plan-build.cjs');

  // Map other tasks' commits & touched files in range
  const otherTaskInfo = new Map(); // taskId -> { task, shas: [], files: Set, firstIdx: number }
  const fileOwners = new Map(); // file -> Set<taskId>
  const ourFiles = new Set();

  const ourShaSet = new Set(orderedTaskShas || []);
  allRangeShas.forEach((sha, idx) => {
    const files = gitLines(projectRoot, ['show', '--name-only', '--format=', '--no-renames', sha]).map(norm).filter((f) => f && !f.startsWith('.oxe/'));
    if (ourShaSet.has(sha)) {
      for (const f of files) ourFiles.add(f);
      return;
    }
    const body = gitOut(projectRoot, ['log', '-1', '--format=%B', sha]).stdout;
    const trailers = parseTaskTrailers(body, phase);
    for (const tr of trailers) {
      if (idSet.has(tr.id) || stackedSet.has(tr.id)) continue;
      if (!otherTaskInfo.has(tr.id)) otherTaskInfo.set(tr.id, { task: tr.id, shas: [], files: new Set(), firstIdx: idx });
      const entry = otherTaskInfo.get(tr.id);
      entry.shas.push(sha);
      for (const f of files) {
        entry.files.add(f);
        if (!fileOwners.has(f)) fileOwners.set(f, new Set());
        fileOwners.get(f).add(tr.id);
      }
    }
  });

  if (!otherTaskInfo.size) return { dependencies: [], suggested_order: [], warnings: [] };

  const ourFirstIdx = (() => {
    const idxs = allRangeShas.map((s, i) => (ourShaSet.has(s) ? i : -1)).filter((i) => i >= 0);
    return idxs.length ? Math.min(...idxs) : Infinity;
  })();

  // Check imports from our modified code files at HEAD into files created/modified by other unpromoted tasks
  const tracked = new Set(gitLines(projectRoot, ['ls-files']).map(norm));
  const aliases = pb.loadPathAliases(projectRoot);
  const importedByUs = new Map(); // targetFile -> Set<symbolName | '*'>
  for (const f of ourFiles) {
    if (!CODE_RE.test(f)) continue;
    let src = '';
    try { src = fs.readFileSync(path.join(projectRoot, f), 'utf8'); } catch { continue; }
    for (const imp of pb.extractModuleImports(src)) {
      const resolved = pb.resolveModuleSpecifier(f, imp.specifier, tracked, aliases);
      if (!resolved || ourFiles.has(resolved)) continue;
      if (!importedByUs.has(resolved)) importedByUs.set(resolved, new Set());
      const bucket = importedByUs.get(resolved);
      if (imp.wildcard || !(imp.names && imp.names.length)) bucket.add('*');
      else for (const n of imp.names) bucket.add(n);
    }
  }

  // Symbols newly added on HEAD vs baseSha in a file
  const baseTextCache = new Map();
  const textAtBase = (f) => {
    if (!baseTextCache.has(f)) {
      const r = gitOut(projectRoot, ['show', `${baseSha}:${f}`]);
      baseTextCache.set(f, r.ok ? r.stdout : null);
    }
    return baseTextCache.get(f);
  };

  const depMap = new Map(); // otherTaskId -> { task, firstIdx, shared_files: Set, imported_files: Map<file, string[]>, before_us: boolean }
  const ensureDep = (tid) => {
    if (!depMap.has(tid)) {
      const info = otherTaskInfo.get(tid);
      depMap.set(tid, {
        task: tid,
        firstIdx: info ? info.firstIdx : 0,
        shas: info ? info.shas : [],
        shared_files: new Set(),
        imported_files: new Map(),
        before_us: info ? info.firstIdx < ourFirstIdx : false,
      });
    }
    return depMap.get(tid);
  };

  // (a) Shared modified files
  for (const f of ourFiles) {
    for (const owner of fileOwners.get(f) || []) {
      ensureDep(owner).shared_files.add(f);
    }
  }

  // (b) Imported files / symbols modified or created by another unpromoted task
  for (const [targetFile, syms] of importedByUs) {
    const owners = fileOwners.get(targetFile);
    if (!owners || !owners.size) continue;
    const before = textAtBase(targetFile);
    const isNewFile = before === null;
    const requestedSyms = [...syms].filter((s) => s !== '*');
    // Either the file is brand-new after baseSha, or it changed in range and we import symbols from it
    const newOrChangedSyms = isNewFile
      ? (requestedSyms.length ? requestedSyms : ['(arquivo novo)'])
      : requestedSyms.filter((sym) => !new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(before));
    // Even if an existing symbol's signature/props changed (like PaneHeader), importing a component modified by To is a dependency!
    const relevantSyms = newOrChangedSyms.length ? newOrChangedSyms : (requestedSyms.length ? requestedSyms : [path.posix.basename(targetFile)]);
    for (const owner of owners) {
      const d = ensureDep(owner);
      d.imported_files.set(targetFile, relevantSyms);
    }
  }

  const dependencies = [...depMap.values()]
    .sort((a, b) => a.firstIdx - b.firstIdx)
    .map((d) => ({
      task: d.task,
      shas: d.shas,
      before_us: d.before_us,
      shared_files: [...d.shared_files],
      imports: [...d.imported_files.entries()].map(([file, symbols]) => ({ file, symbols })),
    }));

  if (!dependencies.length) return { dependencies: [], suggested_order: [], warnings: [] };

  // Topological / commit-order suggestion: dependencies whose commits precede us (or provide imports to us) go BEFORE us;
  // tasks that only share a file AFTER us go after us (or together via --tasks)
  const mustPrecede = dependencies.filter((d) => d.imports.length > 0 || d.before_us).map((d) => d.task);
  const afterUs = dependencies.filter((d) => !mustPrecede.includes(d.task)).map((d) => d.task);
  const ourLabel = [...idSet].join(',');
  const suggestedOrder = [...mustPrecede, ourLabel, ...afterUs];

  const parts = dependencies.map((d) => {
    const reasons = [];
    if (d.imports.length) {
      reasons.push(`importa ${d.imports.map((x) => `${x.symbols.join('/')} de ${x.file}`).slice(0, 3).join(', ')}`);
    }
    if (d.shared_files.length) {
      reasons.push(`compartilha ${d.shared_files.slice(0, 3).join(', ')}`);
    }
    return `${d.task} (${reasons.join('; ')})`;
  });

  const warnings = [
    `dependência(s) não promovida(s) fora da base: ${parts.join(' · ')} — ordem sugerida: ${suggestedOrder.join(' → ')}${mustPrecede.length ? ` (ou promova junto: oxe-cc runtime promote --tasks ${[...mustPrecede, ...idSet].join(',')})` : ''}`,
  ];

  return { dependencies, must_precede: mustPrecede, suggested_order: suggestedOrder, warnings };
}

function componentSearchTerms(filePath) {
  const base = path.posix.basename(filePath).replace(/\.[cm]?[jt]sx?$/i, '').replace(/\.(vue|svelte)$/i, '');
  if (!base || ['index', 'types', 'utils', 'constants', 'helpers'].includes(base.toLowerCase())) return [];
  const terms = new Set([base]);
  // PascalCase / camelCase -> kebab-case & spaced words (`ChangesPanel` -> `changes-panel`, `changes panel`)
  if (/[a-z][A-Z]/.test(base)) {
    const kebab = base.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const spaced = kebab.replace(/-/g, ' ');
    if (kebab.length >= 5) terms.add(kebab);
    if (spaced.length >= 5) terms.add(spaced);
  }
  return [...terms].filter((t) => t.length >= 4);
}

/**
 * P1.4: Discovers `axe`/`a11y-surfaces`/`conformance` and `e2e` suites in `work` (`main + task`) that cover the touched
 * components/files and are not already in the task's verify or frozen acceptance tests.
 */
function discoverMainCiRiskSuites(work, changedFiles, { excludeSuites = [] } = {}) {
  const touched = (changedFiles || []).map(norm).filter((f) => f && !f.startsWith('.oxe/') && !/\.(test|spec)\.[cm]?[jt]sx?$/i.test(f));
  if (!touched.length) return [];

  const allFiles = gitLines(work, ['ls-files']).map(norm);
  const excluded = new Set((excludeSuites || []).map(norm));
  const CI_SUITE_RE = /(^|\/)(e2e|playwright)\/.*\.(spec|test)\.[cm]?[jt]sx?$|\.(e2e|a11y)\.(spec|test)\.[cm]?[jt]sx?$|\/(axe|a11y[-_]?surfaces|brand[-_]?conformance|session[-_]?location)[^/]*\.(spec|test)\.[cm]?[jt]sx?$/i;

  const candidateSuites = allFiles.filter((f) => !excluded.has(f) && !/(^|\/)parked[^/]*\//i.test(f) && CI_SUITE_RE.test(`/${f}`));
  if (!candidateSuites.length) return [];

  const termsByFile = new Map();
  for (const f of touched) {
    const terms = componentSearchTerms(f);
    const stem = path.posix.basename(f).replace(/\.[^.]+$/, '');
    if (stem.length >= 4) terms.push(stem);
    if (terms.length) termsByFile.set(f, [...new Set(terms)]);
  }

  const hits = [];
  for (const suite of candidateSuites) {
    let text = '';
    try { text = fs.readFileSync(path.join(work, suite), 'utf8'); } catch { continue; }
    const lower = text.toLowerCase();
    const matchedFiles = [];
    for (const [srcFile, terms] of termsByFile) {
      if (terms.some((term) => lower.includes(term.toLowerCase()))) {
        matchedFiles.push(srcFile);
      }
    }
    if (matchedFiles.length) {
      const kind = /(axe|a11y)/i.test(suite) ? 'a11y' : /conformance/i.test(suite) ? 'conformance' : 'e2e';
      hits.push({ suite, kind, covers: matchedFiles.slice(0, 4) });
    }
  }

  return hits;
}

/**
 * Builds the shell command(s) for `promote --preview-ci` over discovered risk suites, preferring `remote-verify` when
 * present in the repository (or `config.promote.preview_ci_command`).
 */
function buildPreviewCiCommands(work, riskSuites, config = {}) {
  if (!riskSuites || !riskSuites.length) return [];
  const custom = config && config.promote && typeof config.promote.preview_ci_command === 'string'
    ? config.promote.preview_ci_command.trim()
    : '';
  const files = riskSuites.map((r) => r.suite);
  if (custom) {
    return [custom.includes('{suites}') ? custom.replace('{suites}', files.join(' ')) : `${custom} ${files.join(' ')}`];
  }

  const remoteScript = ['scripts/remote-verify.mjs', 'scripts/remote-verify.cjs', 'scripts/remote-verify.js']
    .find((rel) => fs.existsSync(path.join(work, rel)));
  const prefix = remoteScript ? `node ${remoteScript} -- ` : '';

  const playwrightSuites = riskSuites.filter((r) => r.kind === 'e2e' || r.kind === 'conformance' || /(^|\/)(e2e|playwright)\//i.test(r.suite)).map((r) => r.suite);
  const vitestSuites = files.filter((f) => !playwrightSuites.includes(f));
  const cmds = [];
  if (vitestSuites.length) cmds.push(`${prefix}npx vitest run ${vitestSuites.join(' ')}`);
  if (playwrightSuites.length) cmds.push(`${prefix}npx playwright test ${playwrightSuites.join(' ')}`);
  return cmds;
}

module.exports = {
  selectPromoteQuickCommits,
  reconcilePromotedRatchets,
  checkPromotedEnforcedTargets,
  analyzeUnpromotedDependencies,
  discoverMainCiRiskSuites,
  buildPreviewCiCommands,
  resolveTaskCards,
};
