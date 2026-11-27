'use strict';

/**
 * 1.21.2 (G30): the existing test suites that import a task's files and are not in its verify or scope.
 *
 * Three paid redos in one round had the same cause: the task changed a file (terminal.service.ts, desktop.ts, a policy
 * list) that a test OUTSIDE `files` imports; the verify did not run it, the CI/related tests did, and the red was out of
 * the task's scope (CR-07, CR-08). `plan lint` now lists, per task, the suites that import any file in `files` and are
 * neither in `files`, nor named by the task's verify, nor its acceptance tests:
 *   - a warning by default (add the suite to the verify, or to `files` if the task may have to change it);
 *   - an error when the task's text names an exported list or constant (`export const NAME = [ … ]` / `{ … }` / a
 *     literal) of the file that the suite imports by name — the suite asserts on what the task is about to change.
 * `lint.suite_impact`: "warn" turns the error into a warning; "off" disables the rule.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CODE_RE = /\.(c|m)?[jt]sx?$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const ACCEPT_OR_FROZEN_DIR_RE = /(?:^|\/)(?:acceptance|tests\/acceptance|e2e\/acceptance|tests\/oxe\d+)\//i;
const PARKED_DIR_RE = /(?:^|\/)parked[^/]*\//i;
const SKIP_DIR_RE = /(^|\/)(node_modules|dist|build|out|coverage|\.oxe)\//;
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
const isSupersededTask = (t) => !t || t.status === 'superseded' || Boolean(t.superseded) || Boolean(t.merged_into);
const isDoneTask = (t) => Boolean(t && !isSupersededTask(t) && (t.done === true || t.status === 'done'));
const isInactiveTask = (t) => !t || isDoneTask(t) || isSupersededTask(t);

function taskCriteriaOf(task) {
  if (!task || typeof task !== 'object') return [];
  const raw = [
    ...(Array.isArray(task.acceptance) ? task.acceptance : []),
    ...(Array.isArray(task.aceite) ? task.aceite : []),
  ];
  return [...new Set(raw.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))];
}

function criterionMatches(taskCriteria, entryCriterion) {
  const ec = String(entryCriterion || '').trim().toUpperCase();
  if (!ec || !Array.isArray(taskCriteria) || !taskCriteria.length) return false;
  return taskCriteria.some((raw) => {
    const tc = String(raw || '').trim().toUpperCase();
    if (!tc) return false;
    return tc === ec || tc.startsWith(`${ec}.`) || ec.startsWith(`${tc}.`);
  });
}

function trackedFiles(root) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0 && r.stdout) return r.stdout.split(/\r?\n/).map(norm).filter(Boolean);
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (['node_modules', '.git', '.oxe', 'dist', 'build'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(norm(path.relative(root, full)));
    }
  };
  walk(root);
  return out;
}

/** Exported lists and constants of a source file: `export const NAME = [` / `{` / a literal / Object.freeze(. */
function exportedConstants(text) {
  const names = new Set();
  for (const m of String(text || '').matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(\[|\{|Object\.freeze\(|['"`\d-]|new\s+(?:Set|Map)\()/g)) names.add(m[1]);
  for (const m of String(text || '').matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=\s*(\[|\{|Object\.freeze\(|['"`\d-])/g)) names.add(m[1]);
  return names;
}

/** target file → [{ test, names, wildcard }] for every test file of the repo (following barrel re-exports by symbol). */
function importIndex(root, { files = null, readText = null } = {}) {
  const pb = require('./oxe-plan-build.cjs');
  const testScope = require('./oxe-test-scope.cjs');
  const all = (files || trackedFiles(root)).filter((f) => CODE_RE.test(f) && !SKIP_DIR_RE.test(f));
  const known = new Set(all);
  const aliases = pb.loadPathAliases(root);
  const read = readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const byTarget = new Map();
  const addHit = (targetPath, test, names, wildcard) => {
    if (!targetPath || targetPath === test) return;
    if (!byTarget.has(targetPath)) byTarget.set(targetPath, []);
    const list = byTarget.get(targetPath);
    const existing = list.find((e) => e.test === test);
    if (existing) {
      if (wildcard) existing.wildcard = true;
      for (const n of names || []) if (!existing.names.includes(n)) existing.names.push(n);
    } else {
      list.push({ test, names: [...(names || [])], wildcard: Boolean(wildcard) });
    }
  };
  for (const test of all.filter((f) => TEST_RE.test(f))) {
    for (const imp of pb.extractModuleImports(read(test))) {
      const target = pb.resolveModuleSpecifier(test, imp.specifier, known, aliases);
      if (!target || target === test) continue;
      addHit(target, test, imp.names || [], Boolean(imp.wildcard));
      if (!readText && root && fs.existsSync(path.join(root, target))) {
        const exp = testScope.parseModuleExports(root, target);
        if (exp && (exp.namedReexports.size > 0 || exp.wildcardReexports.length > 0)) {
          const cur = { path: target, exists: true };
          if (imp.wildcard || !(imp.names && imp.names.length)) {
            if (exp.localExports.size === 0) {
              for (const leaf of testScope.collectPureBarrelTargets(root, cur)) {
                if (leaf.path !== target) addHit(leaf.path, test, [], true);
              }
            }
          } else {
            for (const sym of imp.names) {
              for (const def of testScope.findSymbolDefinitions(root, cur, sym)) {
                if (def.path !== target) addHit(def.path, test, [def.resolvedSymbol || sym], false);
              }
            }
          }
        }
      }
    }
  }
  return { byTarget, read };
}

const words = (s) => new Set(String(s || '').match(/[A-Za-z_$][\w$]*/g) || []);

/**
 * G30b (OxeSpace 14/11, OxeCode F4 T20, ~US$ 15): the data a suite reads — a baseline fixture (palette-commands.base.json)
 * the guard compares against, a verb list. Literal paths only: an import/require of a data file, readFileSync /
 * path.join / path.resolve with string literals. Resolved against the test's folder and the repo root; existing
 * files only.
 */
const DATA_RE = /\.(json|ya?ml|txt|csv|snap|md)$/i;
function dataFilesOf(root, test, text, known) {
  const out = new Set();
  const dir = path.posix.dirname(test);
  const consider = (rel) => {
    const r = norm(rel);
    if (!DATA_RE.test(r)) return;
    for (const cand of [path.posix.normalize(path.posix.join(dir, r)), path.posix.normalize(r)]) {
      if (known.has(cand) || fs.existsSync(path.join(root, cand))) { out.add(cand); return; }
    }
  };
  const src = String(text || '');
  for (const m of src.matchAll(/\b(?:import|export)\s+[\s\S]*?\s+from\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) consider(m[1] || m[2] || m[3]);
  // readFileSync('a/b.json', 'utf8') / path.join(__dirname, 'fixtures', 'x.json') / path.resolve('tests/fixtures/x.json')
  for (const m of src.matchAll(/\b(readFileSync|readFile|path\.(?:join|resolve))\(([^)]*)\)/g)) {
    const parts = [...m[2].matchAll(/['"`]([^'"`$]+)['"`]/g)].map((p) => p[1]);
    if (!parts.length) continue;
    const isJoined = /^path\./.test(m[1]) || /\bpath\.(?:join|resolve)\s*\(/.test(m[2]);
    consider(isJoined ? parts.join('/') : parts[0]);
  }
  return [...out];
}

/**
 * Per task not done: the suites that import its files and are outside its verify/scope.
 * @returns {{ task: string, file: string, suites: { test: string, level: 'warn'|'error', names: string[] }[] }[]}
 */
function suiteImpact(root, planDoc, options = {}) {
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => !isInactiveTask(t));
  if (!tasks.length) return [];
  const { byTarget, read } = options.index || importIndex(root, options);
  const known = new Set(options.files || trackedFiles(root));
  const accept = (planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []);
  // G38: a suite another pending task owns (in its files) at the same or a later wave is not asked into this verify —
  // it turns green only with that task (OxeCode F6: u83, owned by T30, was put in T27's verify)
  const laterOwner = new Map();
  for (const o of tasks) for (const f of o.files || []) {
    const p = norm(typeof f === 'string' ? f : f && f.path);
    if (p && TEST_RE.test(p) && ACCEPT_OR_FROZEN_DIR_RE.test(p)) laterOwner.set(p, [...(laterOwner.get(p) || []), o]);
  }
  // cross-review 15/11: the frozen entries count as G38 counts them — a frozen test is never in its owner's files, and
  // G30 asking it into the earlier verify while G38 asks it out was a deadlock
  for (const a of accept) {
    if (!a) continue;
    const owners = a.task
      ? tasks.filter((o) => String(o.id).toUpperCase() === String(a.task).toUpperCase())
      : tasks.filter((o) => criterionMatches(taskCriteriaOf(o), a.criterion));
    for (const f of a.files || []) {
      const p = norm(typeof f === 'string' ? f : f && f.path);
      if (p) laterOwner.set(p, [...(laterOwner.get(p) || []), ...owners]);
    }
  }
  const ownedLater = (test, t) => (laterOwner.get(test) || []).some((o) => o.id !== t.id && !(Number(o.wave) < Number(t.wave)));
  const findings = [];
  for (const t of tasks) {
    const scope = (t.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)).filter(Boolean);
    const verifyText = [...((t.verify && t.verify.commands) || []), t.verify && t.verify.command, t.verifyCommand].filter(Boolean).join(' \n ').replace(/\\/g, '/');
    const ownAccept = new Set(accept.filter((a) => a && (a.task === t.id || (t.acceptance || []).includes(a.criterion))).flatMap((a) => (a.files || []).map((f) => norm(typeof f === 'string' ? f : f.path))));
    const testScope = require('./oxe-test-scope.cjs');
    const inScope = (f) => scope.some((s) => testScope.covers(s, f));
    const namedInVerify = (test) => {
      if (verifyText.includes(test)) return true;
      const base = path.posix.basename(test).replace(/\.(test|spec)\.[cm]?[jt]sx?$/i, '').replace(/\.[cm]?[jt]sx?$/i, '');
      return base.length >= 4 && verifyText.includes(base);
    };
    const taskText = JSON.stringify({ ...t, files: undefined, verify: undefined });
    const mentioned = words(taskText);
    const targets = [...byTarget.keys()].filter((f) => inScope(f));
    for (const file of targets) {
      const consts = exportedConstants(read(file));
      const suites = [];
      const seen = new Set();
      const data = [];
      for (const imp of byTarget.get(file)) {
        if (seen.has(imp.test)) continue;
        seen.add(imp.test);
        // G38: a later task's acceptance test is that task's — neither its suite nor its data are asked of this one
        if (!inScope(imp.test) && !ownAccept.has(imp.test) && ownedLater(imp.test, t)) continue;
        // G30b: the data the suite reads, outside the task's files — also for a suite already in the verify (the T20
        // guard was in the verify; its baseline fixture was not in files)
        if (!inScope(imp.test)) for (const d of dataFilesOf(root, imp.test, read(imp.test), known)) if (!inScope(d)) data.push({ test: imp.test, file: d });
        if (inScope(imp.test) || ownAccept.has(imp.test) || namedInVerify(imp.test)) continue;
        const asserted = imp.names.filter((n) => consts.has(n) && mentioned.has(n));
        suites.push({ test: imp.test, level: asserted.length ? 'error' : 'warn', names: asserted });
      }
      if (suites.length || data.length) findings.push({ task: t.id, file, suites, data });
    }
  }
  return findings;
}

/**
 * OxeSpace 15/11 (OxeCode F6 T27, US$ 16.91 in 3 attempts): a test in a task's verify that a LATER pending task owns
 * (in its files, or its frozen acceptance test) — e.g. u83 released for T30 (wave 3) in T27's verify (wave 1) — is
 * unpassable at the task's point in the order. Per pending task: each such test, with its owner.
 * @returns {{ task: string, wave: number|null, test: string, owner: string, owner_wave: number|null }[]}
 */
function laterOwnedTests(planDoc) {
  const all = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter(Boolean);
  const pending = all.filter((t) => !isInactiveTask(t));
  if (pending.length < 2) return [];
  const byId = new Map(all.map((t) => [t.id, t]));
  const ancestors = (id, seen = new Set()) => {
    for (const d of (byId.get(id) || {}).depends_on || (byId.get(id) || {}).dependsOn || []) if (!seen.has(d)) { seen.add(d); ancestors(d, seen); }
    return seen;
  };
  const owners = new Map(); // test file → pending owner ids
  const frozenOwners = new Set(); // `${file}\0${id}`: the owner holds the file as a FROZEN acceptance entry
  const own =(file, id) => { const f = norm(file); if (f && TEST_RE.test(f)) owners.set(f, [...new Set([...(owners.get(f) || []), id])]); };
  // a shared suite many tasks extend (brand-targets, design-lint) is not "green only later": only ACCEPTANCE tests count —
  // a frozen entry of the owner, or a file of its scope under an acceptance/ or tests/oxe<N>/ folder
  for (const t of pending) for (const f of t.files || []) { const p = norm(typeof f === 'string' ? f : f && f.path); if (ACCEPT_OR_FROZEN_DIR_RE.test(p)) own(p, t.id); }
  for (const a of (planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : [])) {
    if (!a) continue;
    const ids = a.task
      ? [String(a.task).toUpperCase()]
      : pending.filter((t) => criterionMatches(taskCriteriaOf(t), a.criterion)).map((t) => t.id);
    for (const id of ids) if (pending.some((t) => String(t.id).toUpperCase() === String(id).toUpperCase())) for (const f of a.files || []) { own(typeof f === 'string' ? f : f.path, id); frozenOwners.add(`${norm(typeof f === 'string' ? f : f.path)}\u0000${id}`); }
  }
  const waveOf = (t) => (Number.isFinite(Number(t && t.wave)) ? Number(t.wave) : null);
  const out = [];
  for (const t of pending) {
    // OxeSpace 15/11 (F6 T44, wave 18): a vitest file argument is a SUBSTRING filter — `pu03-app-version.test.ts` also
    // ran T59's `pu03-app-version.test.tsx` (wave 33). Each command's arguments are matched as filters; a command
    // narrowed by -t / --testNamePattern is taken as running its own cases only.
    const commands = [...((t.verify && t.verify.commands) || []), t.verify && t.verify.command, t.verifyCommand].filter(Boolean).map((c) => String(c).replace(/\\/g, '/'));
    const tests = [];
    const directHits = new Set(); // matched file named directly as a verify argument
    const viaMap = new Map(); // matched file → Set of verify arguments that substring-select it (when not the same path)
    // cross-review 15/11: each SUBCOMMAND on its own (`a -t x && b`): a -t narrows only its subcommand, and only the
    // substring expansion — a path named exactly is always run; a trailing `$` anchors the argument; `node --test`
    // takes exact paths (never a substring filter)
    for (const sub of commands.flatMap((c) => c.split(/\s*(?:&&|\|\||;)\s*/)).filter(Boolean)) {
      const narrowed = /(^|\s)(-t|--testNamePattern|--grep|-g)(\s|=)/.test(sub);
      const exactRunner = /\bnode\b[^|;&]*\s--test(\s|=|$)/.test(sub);
      for (const raw of sub.match(/[^\s"'`]+/g) || []) {
        const anchored = raw.endsWith('$');
        const a = norm(anchored ? raw.slice(0, -1) : raw);
        if (!(a.includes('/') && TEST_RE.test(a) && /\.[cm]?[jt]sx?$/i.test(a))) continue;
        const substring = !narrowed && !anchored && !exactRunner;
        for (const known of owners.keys()) {
          if (known === a) {
            tests.push(known);
            directHits.add(known);
          } else if (substring && known.includes(a)) {
            tests.push(known);
            if (!viaMap.has(known)) viaMap.set(known, new Set());
            viaMap.get(known).add(a);
          }
        }
      }
    }
    const anc = ancestors(t.id);
    const ownFiles = new Set((t.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)));
    for (const test of [...new Set(tests)]) {
      for (const ownerId of owners.get(test) || []) {
        if (ownerId === t.id || anc.has(ownerId)) continue; // its own, or done before it by the dependency order
        // cross-review 15/11: a mutable test this task writes (in its files), that a later task only extends, is this
        // task's to run — only a later task's FROZEN entry is out of its reach
        if (ownFiles.has(test) && !frozenOwners.has(`${test}\u0000${ownerId}`)) continue;
        const owner = byId.get(ownerId);
        const w = waveOf(t);
        const ow = waveOf(owner);
        if (w != null && ow != null && ow < w) continue; // the owner's wave runs first
        if (directHits.has(test)) out.push({ task: t.id, wave: w, test, owner: ownerId, owner_wave: ow });
        for (const viaArg of viaMap.get(test) || []) {
          out.push({ task: t.id, wave: w, test, owner: ownerId, owner_wave: ow, via: viaArg });
        }
      }
    }
  }
  return out;
}

/**
 * G39 (OxeSpace 15/11, OxeQuery polish T1, US$ 11.70): the task's frozen A1 needs `IPC_CHANNELS.agentActivity.changed`,
 * while a 1.5.0 frozen test pins `expect(IPC_CHANNELS.agentActivity).toEqual({ list, detail, badge })` — no change passes
 * both. For each member path a pending task's frozen test asks for and the product does not have yet (`X.y.z`), the
 * tests OUTSIDE the plan's frozen entries that assert its parent (`X.y`) by exact equality are named, file:line.
 * @returns {{ task: string, path: string, parent: string, entry: string, pinned_by: string, line: string }[]}
 */
function pinnedByExisting(root, planDoc, options = {}) {
  const git = (args) => { const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); return r.status === 0 ? r.stdout : ''; };
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => !isInactiveTask(t));
  const accept = planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : [];
  const planFrozen = new Set(accept.flatMap((a) => (a && a.files) || []).map((f) => norm(typeof f === 'string' ? f : f.path)));
  // a member path, never a method call (`X.y.includes(`) — cross-review 15/11
  const PATH_RE = /(?<![\w$.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){2,})(?![\w$(])/g;
  const NATIVE_LEAF = /^(length|prototype|constructor|size|name)$/;
  // the scope a task can change: its files and its ancestors' files (a mutable test there is the task's to update)
  const byId = new Map((planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter(Boolean).map((t) => [t.id, t]));
  const scopeOf = (t) => {
    const out = new Set();
    const stack = [t.id];
    const seenIds = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const x = byId.get(id);
      if (!x) continue;
      for (const f of x.files || []) out.add(norm(typeof f === 'string' ? f : f && f.path));
      stack.push(...(x.depends_on || x.dependsOn || []));
    }
    return out;
  };
  // 1. the candidates: member paths the pending tasks' frozen tests name
  const candidates = [];
  const seen = new Set();
  for (const t of tasks) {
    const own = accept.filter((a) => a && (a.task === t.id || (!a.task && (t.acceptance || []).includes(a.criterion))));
    for (const a of own) {
      for (const f of a.files || []) {
        const entry = norm(typeof f === 'string' ? f : f.path);
        for (const m of read(entry).matchAll(PATH_RE)) {
          const full = m[1];
          if (/^(expect|vi|jest|Object|Array|JSON|Math|Promise|console|process|window|document|this|module|exports|require|t|it|describe|screen|page|user)\./.test(full)) continue;
          if (NATIVE_LEAF.test(full.slice(full.lastIndexOf('.') + 1))) continue;
          const key = `${t.id}\u0000${full}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({ task: t.id, full, parent: full.slice(0, full.lastIndexOf('.')), entry });
        }
      }
    }
  }
  if (!candidates.length) return [];
  // batched git grep (a lint must stay fast): -o says which needle matched each line
  const grepBatch = (needles, extra) => {
    const lines = [];
    const list = [...new Set(needles)];
    for (let i = 0; i < list.length; i += 150) {
      const args = ['grep', ...extra, '-I', '-F'];
      for (const n of list.slice(i, i + 150)) args.push('-e', n);
      // the working tree (tracked files), as read() sees it — line numbers and contents stay in sync (cross-review)
      lines.push(...git(args).split(/\r?\n/).filter(Boolean));
    }
    return lines;
  };
  // 2. new for the product: the full path is in no tracked non-test file yet
  const inProduct = new Set();
  for (const l of grepBatch(candidates.map((c) => c.full), ['-o'])) {
    const i = l.indexOf(':');
    if (i > 0 && !TEST_RE.test(l.slice(0, i))) inProduct.add(l.slice(i + 1));
  }
  // …nor as an object-literal key of its parent (`agentActivity: { list: … }` already has .list): a non-test file that
  // names the parent's last segment and has `leaf:` keeps the member
  const lastSeg = (p) => p.slice(p.lastIndexOf('.') + 1);
  // only the files that DECLARE the parent as an object literal (`seg: {` / `seg = {`), and only inside that literal
  const parentFiles = new Map();
  const declNeedles = [...new Set(candidates.map((c) => lastSeg(c.parent)))].flatMap((s) => [`${s}: {`, `${s}:{`, `${s} = {`]);
  for (const l of grepBatch(declNeedles, ['-o'])) {
    const i = l.indexOf(':');
    if (i <= 0 || TEST_RE.test(l.slice(0, i))) continue;
    const seg = l.slice(i + 1).replace(/\s*(:|=)\s*\{$/, '');
    if (!parentFiles.has(seg)) parentFiles.set(seg, new Set());
    parentFiles.get(seg).add(l.slice(0, i));
  }
  const literalOf = (text, at) => {
    let depth = 0;
    let q = null;
    for (let i = at; i < text.length && i < at + 65536; i += 1) {
      const ch = text[i];
      const nx = text[i + 1];
      if (q) { if (ch === '\\') { i += 1; continue; } if (ch === q) q = null; continue; }
      // comments first: an apostrophe in `// user's channels` never opens a string (cross-review 15/11)
      if (ch === '/' && nx === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
      if (ch === '/' && nx === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) return text.slice(at, i + 1); }
    }
    return '';
  };
  const keyed = (c) => {
    const seg = lastSeg(c.parent);
    const leaf = c.full.slice(c.full.lastIndexOf('.') + 1).replace(/[$]/g, '\\$');
    const leafRe = new RegExp(`(^|[^\\w$.])${leaf}\\s*:`);
    const declRe = new RegExp(`(^|[^\\w$.])${seg.replace(/[$]/g, '\\$')}\\s*(:|=)\\s*\\{`, 'g');
    for (const f of parentFiles.get(seg) || []) {
      const text = read(f);
      for (const m of text.matchAll(declRe)) {
        const obj = literalOf(text, m.index + m[0].length - 1);
        // the leaf at the literal's own level is enough here (nested keys rarely share the name)
        if (leafRe.test(obj)) return true;
      }
    }
    return false;
  };
  const fresh = candidates.filter((c) => !inProduct.has(c.full) && !keyed(c));
  if (!fresh.length) return [];
  // 3. the tests outside the plan (and outside the task's scope) that pin the parent by exact equality — the matcher's
  // argument is extracted with a balanced-parenthesis scanner (strings and comments skipped), never by indentation
  const filesWithParent = new Map(); // file → set of parents it names
  for (const l of grepBatch(fresh.map((c) => c.parent), ['-o'])) {
    const i = l.indexOf(':');
    if (i <= 0) continue;
    const file = l.slice(0, i);
    if (!TEST_RE.test(file) || planFrozen.has(file)) continue;
    if (!filesWithParent.has(file)) filesWithParent.set(file, new Set());
    filesWithParent.get(file).add(l.slice(i + 1));
  }
  const argOf = (text, open) => {
    let depth = 0;
    let q = null;
    for (let i = open; i < text.length && i < open + 16384; i += 1) {
      const ch = text[i];
      const nx = text[i + 1];
      if (q) { if (ch === '\\') { i += 1; continue; } if (ch === q) q = null; continue; }
      if (ch === '/' && nx === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
      if (ch === '/' && nx === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) return text.slice(open + 1, i); }
    }
    return null;
  };
  const out = [];
  for (const c of fresh) {
    const t = byId.get(c.task);
    const scope = t ? scopeOf(t) : new Set();
    const esc = c.parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // expect(X.y) or expect(Object.keys(X.y)) / (…).sort(), then (across a line break) .toEqual( / .toStrictEqual( / .toHaveLength(
    const re = new RegExp(`expect\\(\\s*(?:Object\\.(?:keys|values|entries)\\(\\s*)?${esc}\\s*\\)?(?:\\s*\\.\\s*sort\\(\\s*\\))?\\s*\\)\\s*\\.\\s*(toEqual|toStrictEqual|toHaveLength)\\s*\\(`, 'g');
    const leaf = c.full.slice(c.full.lastIndexOf('.') + 1);
    const leafRe = new RegExp(`(^|[^\\w$])${leaf.replace(/[$]/g, '\\$')}\\s*:|['"\`]${leaf.replace(/[$]/g, '\\$')}['"\`]`);
    for (const [file, parents] of filesWithParent) {
      if (!parents.has(c.parent)) continue;
      // a mutable test in the task's own scope (or an ancestor's) is the task's to update — not a conflict
      const inScope = scope.has(file) || [...scope].some((s) => s && file.startsWith(`${s.replace(/\/+$/, '')}/`));
      if (inScope && !/(^|\/)acceptance\//i.test(file)) continue;
      const text = read(file);
      for (const m of text.matchAll(re)) {
        const open = m.index + m[0].length - 1;
        const arg = argOf(text, open);
        if (arg == null || leafRe.test(arg)) continue; // the pinned shape already has the leaf
        const lineNo = text.slice(0, m.index).split('\n').length;
        out.push({ task: c.task, path: c.full, parent: c.parent, entry: c.entry, pinned_by: `${file}:${lineNo}`, line: m[0].replace(/\s+/g, ' ').trim().slice(0, 160), frozen: /(^|\/)acceptance\//i.test(file) });
      }
    }
  }
  return out;
}

function pinnedMessages(findings, { mode = 'error' } = {}) {
  const errors = [];
  const warnings = [];
  for (const f of findings) {
    const fix = f.frozen
      ? `precisa de um release desse teste (CR + spec freeze/amend) antes de ${f.task}`
      : `inclua ${f.pinned_by.split(':')[0]} nos files de ${f.task} (ou de uma dependência) para atualizá-lo junto, ou release por CR se for congelado`;
    const line = `${f.task}: o teste congelado ${f.entry} pede ${f.path}, mas ${f.pinned_by} fixa ${f.parent} por igualdade exata (\`${f.line}\`) — nenhuma mudança passa os dois: ${fix} [G39]`;
    if (mode === 'error') errors.push(line); else warnings.push(line);
  }
  return { errors, warnings };
}

function laterOwnedMessages(findings, { mode = 'error' } = {}) {
  const errors = [];
  const warnings = [];
  for (const f of findings) {
    const line = `${f.task}${f.wave != null ? ` (onda ${f.wave})` : ''}: o verify roda ${f.test}${f.via ? ` (o argumento ${f.via} casa como filtro de substring do vitest)` : ''}, que só fica verde com ${f.owner}${f.owner_wave != null ? ` (onda ${f.owner_wave})` : ''} — inalcançável neste ponto da ordem: tire do verify de ${f.task}${f.via ? ' (ou ancore o caminho, ou estreite com -t)' : ''}, ou faça ${f.task} depender de ${f.owner} [G38]`;
    if (mode === 'error') errors.push(line); else warnings.push(line);
  }
  return { errors, warnings };
}

function messages(findings, { mode = 'error' } = {}) {
  const errors = [];
  const warnings = [];
  for (const f of findings) {
    for (const s of f.suites) {
      const line = s.level === 'error'
        ? `${f.task}: ${s.test} importa ${s.names.join(', ')} de ${f.file} — a tarefa muda essa lista/constante e a suíte afirma sobre ela, mas não está no verify nem no escopo (inclua no verify, ou em files se a tarefa pode ter de mudá-la) [G30]`
        : `${f.task}: ${s.test} importa ${f.file} e não está no verify nem no escopo da tarefa — se a mudança a quebrar, o vermelho fica fora do escopo (inclua no verify) [G30]`;
      if (s.level === 'error' && mode === 'error') errors.push(line);
      else warnings.push(line);
    }
    for (const d of f.data || []) {
      warnings.push(`${f.task}: ${d.test} (que importa ${f.file}) lê ${d.file} — se a tarefa muda o que essa suíte compara (ids, rótulos, uma lista), ${d.file} precisa estar em files da tarefa [G30b]`);
    }
  }
  return { errors, warnings };
}

/**
 * G43 (OxeSpace 15/11, OxeCode F6 T42, US$ 8 in 3 attempts): T42 added a channel to shared/types/ipc.ts, and
 * tests/mcp-coverage.test.ts ("gives every IPC channel a capability") checks it against shared/mcp-coverage.ts, which
 * was not in T42's scope — unpassable at every attempt. Per pending task: a REGISTRY in its scope whose MANIFEST is out
 * of its scope (and its ancestors'), when a repo suite checks both. The pairs: declared (`lint.registry_pairs`:
 * [{ registry, manifest }]) or found — a suite imports the registry and a file that itself imports the registry.
 * @returns {{ task: string, registry: string, manifest: string, suite: string|null, declared: boolean }[]}
 */
function registryManifestGaps(root, planDoc, options = {}) {
  const all = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter(Boolean);
  const pending = all.filter((t) => !isInactiveTask(t));
  if (!pending.length) return [];
  const testScope = require('./oxe-test-scope.cjs');
  const pb = require('./oxe-plan-build.cjs');
  const byId = new Map(all.map((t) => [t.id, t]));
  const scopeOf = (t) => {
    const out = [];
    const seen = new Set();
    const stack = [t.id];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const x = byId.get(id);
      if (!x) continue;
      for (const f of x.files || []) { const p = norm(typeof f === 'string' ? f : f && f.path); if (p) out.push(p); }
      for (const d of x.depends_on || x.dependsOn || []) stack.push(d);
    }
    return out;
  };
  const declared = (Array.isArray(options.pairs) ? options.pairs : []).map((p) => ({ registry: norm(p && p.registry), manifest: norm(p && p.manifest) })).filter((p) => p.registry && p.manifest);
  // found pairs: a suite that imports the registry and a manifest which imports the registry too
  let index = null;
  const lazyIndex = () => { if (!index) index = options.index || importIndex(root, options); return index; };
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const known = () => new Set(options.files || trackedFiles(root));
  let knownSet = null;
  let aliases = null;
  // R42: VALUE imports only (an `import type` never checks a key at run time), memoized; per target, the names imported
  const memo = new Map();
  const importsOf = (file) => {
    if (memo.has(file)) return memo.get(file);
    if (!knownSet) knownSet = known();
    if (!aliases) aliases = pb.loadPathAliases(root);
    const src = read(file);
    const out = new Map();
    const add = (spec, names, wildcard) => {
      const target = pb.resolveModuleSpecifier(file, spec, knownSet, aliases);
      if (!target) return;
      const cur = out.get(target) || { names: new Set(), wildcard: false };
      for (const n of names) cur.names.add(n);
      if (wildcard) cur.wildcard = true;
      out.set(target, cur);
    };
    for (const m of src.matchAll(/\bimport\s+(type\s+)?([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
      if (m[1]) continue;
      const clause = m[2];
      const named = /\{([\s\S]*)\}/.exec(clause);
      const names = named ? named[1].split(',').map((x) => x.trim()).filter((x) => x && !/^type\s/.test(x)).map((x) => x.split(/\s+as\s+/)[0].trim()) : [];
      const wildcard = /\*\s+as\s+/.test(clause) || /^[A-Za-z_$][\w$]*\s*(,|$)/.test(clause.trim());
      if (names.length || wildcard) add(m[3], names, wildcard);
    }
    for (const m of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1], [], true);
    memo.set(file, out);
    return out;
  };
  const constsMemo = new Map();
  const constsOf = (f) => { if (!constsMemo.has(f)) constsMemo.set(f, exportedConstants(read(f))); return constsMemo.get(f); };
  const usesConst = (imp, consts) => Boolean(imp) && consts.size > 0 && (imp.wildcard || [...imp.names].some((n) => consts.has(n)));
  const out = [];
  const seen = new Set();
  for (const t of pending) {
    const own = (t.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)).filter(Boolean);
    const scope = scopeOf(t);
    const inScope = (f) => scope.some((s) => testScope.covers(s, f));
    const registries = own.filter((f) => CODE_RE.test(f) && !TEST_RE.test(f));
    const push = (registry, manifest, suite, isDeclared) => {
      const k = `${t.id}\u0000${registry}\u0000${manifest}`;
      if (seen.has(k) || inScope(manifest)) return;
      seen.add(k);
      out.push({ task: t.id, registry, manifest, suite, declared: isDeclared });
    };
    for (const p of declared) if (own.some((f) => testScope.covers(f, p.registry))) push(p.registry, p.manifest, null, true);
    // R42: detection is opt-in (lint.registry_detect: true) — the declared pair is the reliable form (in the real F6
    // case the manifest does not even import the registry). Detected: the suite uses constants of BOTH, the manifest
    // imports the registry by value, and both export constants (types, errors and helpers never count).
    if (options.detect !== true) continue;
    const { byTarget } = lazyIndex();
    for (const registry of registries) {
      const regConsts = constsOf(registry);
      if (!regConsts.size) continue;
      for (const hit of byTarget.get(registry) || []) {
        const suiteImps = importsOf(hit.test);
        if (!usesConst(suiteImps.get(registry), regConsts)) continue;
        for (const [m, imp] of suiteImps) {
          if (m === registry || TEST_RE.test(m) || !CODE_RE.test(m) || inScope(m)) continue;
          if (!usesConst(imp, constsOf(m))) continue;
          if (!importsOf(m).has(registry)) continue;
          push(registry, m, hit.test, false);
        }
      }
    }
  }
  return out;
}

function registryManifestMessages(found, { level = 'warn' } = {}) {
  const lines = found.map((f) => `${f.task} muda ${f.registry}, e ${f.manifest} fica fora do escopo${f.suite ? ` — ${f.suite} confere um contra o outro` : ' (par declarado em lint.registry_pairs)'}: uma chave nova no registro sem o manifesto não passa nessa suíte em nenhuma tentativa (OxeCode F6 T42) — inclua ${f.manifest} nos files de ${f.task} (ou numa tarefa de que ela dependa) [G43]`);
  return level === 'error' ? { errors: lines, warnings: [] } : { errors: [], warnings: lines };
}

function extractEntryTestFiles(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const out = [];
  for (const f of entry.files || []) {
    const p = norm(typeof f === 'string' ? f : f && f.path);
    if (p) out.push(p);
  }
  if (typeof entry.command === 'string' && entry.command.trim()) {
    for (const m of entry.command.replace(/\\/g, '/').matchAll(/([^\s"'`]+\.(?:test|spec)\.[cm]?[jt]sx?)\$?/gi)) {
      const p = norm(m[1]);
      if (p && p.includes('/')) out.push(p);
    }
  }
  return [...new Set(out)];
}

function extractTaskVerifySpecs(task) {
  const commands = [
    ...((task && task.verify && Array.isArray(task.verify.commands)) ? task.verify.commands : []),
    task && task.verify && task.verify.command,
    task && task.verifyCommand,
  ].filter(Boolean).map((c) => String(c).replace(/\\/g, '/'));
  const exact = new Set();
  const filters = new Set();
  for (const sub of commands.flatMap((c) => c.split(/\s*(?:&&|\|\||;)\s*/)).filter(Boolean)) {
    const narrowed = /(^|\s)(-t|--testNamePattern|--grep|-g)(\s|=)/.test(sub);
    const exactRunner = /\bnode\b[^|;&]*\s--test(\s|=|$)/.test(sub);
    for (const raw of sub.match(/[^\s"'`]+/g) || []) {
      const anchored = raw.endsWith('$');
      const cleaned = norm(anchored ? raw.slice(0, -1) : raw);
      if (!cleaned || cleaned.startsWith('-')) continue;
      if (cleaned.includes('/') && TEST_RE.test(cleaned) && /\.[cm]?[jt]sx?$/i.test(cleaned)) {
        exact.add(cleaned);
        if (!narrowed && !anchored && !exactRunner) filters.add(cleaned);
      } else if (!narrowed && !exactRunner && /^[A-Za-z0-9][\w./-]{5,}$/.test(cleaned) && !/\.(?:mjs|cjs|js|json)$/i.test(cleaned)) {
        // e.g. `vitest run ag04d-changes-badge` or `vitest run tests/oxe152/ag/ag04d-changes-badge`
        filters.add(cleaned);
      }
    }
  }
  return { exact, filters };
}

function canonicalRepoTestPath(rawFile, knownPaths, projectRoot) {
  let f = norm(rawFile);
  if (!f) return '';
  if (knownPaths.has(f)) return f;
  if (projectRoot && path.isAbsolute(String(rawFile || ''))) {
    const rel = norm(path.relative(projectRoot, String(rawFile)));
    if (rel && !rel.startsWith('..') && (knownPaths.has(rel) || fs.existsSync(path.join(projectRoot, rel)))) return rel;
  }
  for (const k of knownPaths) {
    if (f.endsWith(`/${k}`)) return k;
  }
  if (projectRoot && f.includes('/')) {
    const parts = f.split('/').filter(Boolean);
    for (let i = 1; i < parts.length - 1; i += 1) {
      const suffix = parts.slice(i).join('/');
      if (TEST_RE.test(suffix) && fs.existsSync(path.join(projectRoot, suffix))) return suffix;
    }
  }
  return f;
}

/**
 * OXB-C3 (OxeSpace 16/11, F6 T39 wave 14): applies G38 (`laterOwnedTests` / `plan verify prune --later-owned`) to the
 * failing list of `checkpoint_related_tests` (`vitest related`), separating frozen tests of pending later tasks (e.g.
 * `ag04d-changes-badge` → T43, `ag04c-pin-a11y` → T41, `pu03-first-run-forced` → T54) and superseded/parked tests from
 * candidate regressions of `taskId`.
 */
function classifyRelatedTestFiles(planDoc, taskId, failingItems, options = {}) {
  const items = Array.isArray(failingItems)
    ? failingItems.map((it) => (typeof it === 'string' ? { file: it, names: [] } : { file: it && it.file, names: Array.isArray(it && it.names) ? it.names : [] })).filter((it) => it.file)
    : [];
  if (!items.length) return { candidates: [], later_owned: [], other_ignored: [] };

  const allTasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter(Boolean);
  const activeOrDone = allTasks.filter((t) => !isSupersededTask(t));
  const byId = new Map(activeOrDone.map((t) => [String(t.id).toUpperCase(), t]));
  const normTaskId = taskId ? String(taskId).trim().toUpperCase() : null;
  const curTask = normTaskId ? byId.get(normTaskId) : null;
  const curOwnFiles = new Set(((curTask && curTask.files) || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)).filter(Boolean));
  const waveOf = (t) => (t && Number.isFinite(Number(t.wave)) ? Number(t.wave) : null);

  const knownPaths = new Set();
  const supersededMap = new Map();
  for (const s of (planDoc && Array.isArray(planDoc.superseded_tests) ? planDoc.superseded_tests : [])) {
    if (!s) continue;
    const owner = (s.superseded && s.superseded.by_phase) || 'fase-posterior';
    for (const p of extractEntryTestFiles(s)) {
      knownPaths.add(p);
      supersededMap.set(p, { owner, criterion: s.criterion || null });
    }
  }

  const explicitOwners = new Map(); // file → { ids: Set, criteria: Set, declaredTasks: Set, frozenOwners: Set }
  const ensureExplicit = (p) => {
    knownPaths.add(p);
    if (!explicitOwners.has(p)) explicitOwners.set(p, { ids: new Set(), criteria: new Set(), declaredTasks: new Set(), frozenOwners: new Set() });
    return explicitOwners.get(p);
  };

  const acceptList = [
    ...((planDoc && Array.isArray(planDoc.acceptance_tests)) ? planDoc.acceptance_tests : []),
    ...((planDoc && Array.isArray(planDoc.acceptanceTests)) ? planDoc.acceptanceTests : []),
  ];
  for (const a of acceptList) {
    if (!a) continue;
    const declaredTask = a.task ? String(a.task).trim().toUpperCase() : null;
    const matched = declaredTask
      ? activeOrDone.filter((t) => String(t.id).toUpperCase() === declaredTask)
      : activeOrDone.filter((t) => criterionMatches(taskCriteriaOf(t), a.criterion));
    for (const p of extractEntryTestFiles(a)) {
      const rec = ensureExplicit(p);
      if (a.criterion) rec.criteria.add(String(a.criterion));
      if (declaredTask) rec.declaredTasks.add(declaredTask);
      for (const t of matched) {
        const uid = String(t.id).toUpperCase();
        rec.ids.add(uid);
        rec.frozenOwners.add(uid);
      }
    }
  }

  for (const t of activeOrDone) {
    const uid = String(t.id).toUpperCase();
    for (const f of t.files || []) {
      const p = norm(typeof f === 'string' ? f : f && f.path);
      if (p) knownPaths.add(p);
      if (p && TEST_RE.test(p) && ACCEPT_OR_FROZEN_DIR_RE.test(p)) {
        const rec = ensureExplicit(p);
        rec.ids.add(uid);
      }
    }
  }

  const verifySpecsByTask = new Map();
  for (const t of activeOrDone) {
    const spec = extractTaskVerifySpecs(t);
    for (const p of spec.exact) knownPaths.add(p);
    verifySpecsByTask.set(String(t.id).toUpperCase(), { task: t, ...spec });
  }

  const resolveVerifyOwnersForFrozen = (file) => {
    const exactIds = [];
    for (const [uid, spec] of verifySpecsByTask) {
      if (spec.exact.has(file)) exactIds.push(uid);
    }
    if (exactIds.length) return exactIds;
    const stem = path.posix.basename(file).replace(/\.(test|spec)\.[cm]?[jt]sx?$/i, '').replace(/\.[cm]?[jt]sx?$/i, '');
    const filterIds = [];
    for (const [uid, spec] of verifySpecsByTask) {
      for (const flt of spec.filters) {
        if (file.includes(flt) || (stem.length >= 6 && flt === stem)) {
          filterIds.push(uid);
          break;
        }
      }
    }
    return filterIds;
  };

  const candidates = [];
  const laterOwned = [];
  const otherIgnored = [];

  for (const rawItem of items) {
    const file = canonicalRepoTestPath(rawItem.file, knownPaths, options.projectRoot || null);
    const item = { ...rawItem, file };
    if (PARKED_DIR_RE.test(file)) {
      otherIgnored.push({ file, names: item.names, owner: 'parked', reason: 'parked' });
      continue;
    }

    const exp = explicitOwners.get(file);
    if (exp) {
      const ids = [...exp.ids];
      // G38 cross-review rule: if curTask writes a mutable acceptance file (in its own files) and no later task holds it
      // as a frozen acceptance_tests entry, curTask runs it itself; if a later pending task holds it as frozen, later wins.
      const frozenPendingLater = [...exp.frozenOwners].filter((id) => id !== normTaskId && !isDoneTask(byId.get(id)));
      if (normTaskId && ids.includes(normTaskId) && (!frozenPendingLater.length || exp.frozenOwners.has(normTaskId) || curOwnFiles.has(file))) {
        if (!frozenPendingLater.length || exp.frozenOwners.has(normTaskId)) {
          candidates.push(item);
          continue;
        }
      }
      if (ids.length > 0 && ids.every((id) => isDoneTask(byId.get(id)))) {
        candidates.push(item);
        continue;
      }
      const pendingIds = ids.filter((id) => id !== normTaskId && !isDoneTask(byId.get(id)));
      const firstOwner = pendingIds.length ? byId.get(pendingIds[0]) : null;
      const criterion = exp.criteria.size ? [...exp.criteria][0] : null;
      const ownerLabel = pendingIds.length
        ? pendingIds.map((id) => (byId.get(id) ? byId.get(id).id : id)).join(', ')
        : ([...exp.declaredTasks][0] || (criterion ? `critério ${criterion}` : 'outra-fase'));
      laterOwned.push({
        file,
        names: item.names,
        owner: ownerLabel,
        owner_wave: waveOf(firstOwner),
        ...(criterion ? { criterion } : {}),
      });
      continue;
    }

    if (supersededMap.has(file)) {
      const sup = supersededMap.get(file);
      laterOwned.push({
        file,
        names: item.names,
        owner: sup.owner,
        owner_wave: null,
        ...(sup.criterion ? { criterion: sup.criterion } : {}),
      });
      continue;
    }

    if (ACCEPT_OR_FROZEN_DIR_RE.test(file)) {
      const vIds = resolveVerifyOwnersForFrozen(file);
      if (vIds.length > 0) {
        if (normTaskId && vIds.includes(normTaskId)) {
          candidates.push(item);
          continue;
        }
        if (vIds.every((id) => isDoneTask(byId.get(id)))) {
          candidates.push(item);
          continue;
        }
        const pendingIds = vIds.filter((id) => id !== normTaskId && !isDoneTask(byId.get(id)));
        const firstOwner = pendingIds.length ? byId.get(pendingIds[0]) : null;
        laterOwned.push({
          file,
          names: item.names,
          owner: pendingIds.map((id) => (byId.get(id) ? byId.get(id).id : id)).join(', '),
          owner_wave: waveOf(firstOwner),
        });
        continue;
      }
      if (/(?:^|\/)acceptance\//i.test(file)) {
        otherIgnored.push({ file, names: item.names, owner: 'outra-fase', reason: 'other_phase_acceptance' });
        continue;
      }
    }

    candidates.push(item);
  }

  return { candidates, later_owned: laterOwned, other_ignored: otherIgnored };
}

/**
 * OXB-C3: returns all Vitest-runnable frozen/acceptance test paths owned by pending later tasks, superseded_tests or
 * unowned criteria relative to `taskId`, so `relatedTestsCommand` can proactively pass `--exclude <path>` to Vitest
 * before running `vitest related --run`.
 */
function laterOwnedExcludesForTask(planDoc, taskId) {
  if (!planDoc || typeof planDoc !== 'object') return [];
  const isE2e = (f) => /(^|\/)(e2e|playwright)\//i.test(f) || /\.e2e\.[cm]?[jt]sx?$/i.test(f);
  const allFrozenCandidates = new Set();
  for (const a of [
    ...(Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []),
    ...(Array.isArray(planDoc.acceptanceTests) ? planDoc.acceptanceTests : []),
    ...(Array.isArray(planDoc.superseded_tests) ? planDoc.superseded_tests : []),
  ]) {
    for (const p of extractEntryTestFiles(a)) {
      if (p && TEST_RE.test(p) && !isE2e(p)) allFrozenCandidates.add(p);
    }
  }
  for (const t of (Array.isArray(planDoc.tasks) ? planDoc.tasks : [])) {
    if (isSupersededTask(t)) continue;
    for (const f of t.files || []) {
      const p = norm(typeof f === 'string' ? f : f && f.path);
      if (p && TEST_RE.test(p) && ACCEPT_OR_FROZEN_DIR_RE.test(p) && !isE2e(p)) allFrozenCandidates.add(p);
    }
    const spec = extractTaskVerifySpecs(t);
    for (const p of spec.exact) {
      if (p && ACCEPT_OR_FROZEN_DIR_RE.test(p) && !isE2e(p)) allFrozenCandidates.add(p);
    }
  }
  if (!allFrozenCandidates.size) return [];
  const classified = classifyRelatedTestFiles(planDoc, taskId || null, [...allFrozenCandidates]);
  return [...new Set([...classified.later_owned, ...classified.other_ignored].map((x) => x.file))];
}

/**
 * OXB-C6 #6: Detects when frozen acceptance tests live in a config or directory (e.g. `playwright.acceptance.config.ts`,
 * `tests/acceptance/`, `e2e/acceptance/`) that NO `package.json` script and NO job in `.github/workflows/*.yml` executes.
 */
function findUnrunFrozenAcceptanceCi(projectRoot, planDoc = null, options = {}) {
  const readFile = options.readText || ((rel) => {
    try { return fs.readFileSync(path.join(projectRoot, rel), 'utf8'); } catch { return null; }
  });
  let pkg = null;
  try {
    const rawPkg = readFile('package.json');
    if (rawPkg) pkg = JSON.parse(rawPkg);
  } catch { pkg = null; }
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const scriptEntries = Object.entries(scripts).filter(([, cmd]) => typeof cmd === 'string' && cmd.trim());

  const wfDir = path.join(projectRoot, '.github', 'workflows');
  const workflowFiles = [];
  if (fs.existsSync(wfDir)) {
    try {
      for (const name of fs.readdirSync(wfDir).sort()) {
        if (/\.ya?ml$/i.test(name)) workflowFiles.push(`.github/workflows/${name}`);
      }
    } catch { /* ignore */ }
  }

  // Bare synthetic test fixtures with neither package scripts nor CI workflows have nothing to audit against
  if (!scriptEntries.length && !workflowFiles.length) return [];

  const allTracked = options.files || trackedFiles(projectRoot);
  const acceptEntries = [
    ...(planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []),
    ...(planDoc && Array.isArray(planDoc.acceptanceTests) ? planDoc.acceptanceTests : []),
  ];

  // 1. Discover frozen acceptance config files and acceptance test directories
  const configsMap = new Map(); // relConfig -> { runner, files: Set, dirs: Set }
  const dirsMap = new Map(); // relDir -> { runner, files: Set }
  const addConfig = (cfgPath, runner = 'unknown', file = null, dirRel = null) => {
    const c = norm(cfgPath);
    if (!c || /(^|\/)parked[^/]*\//i.test(c)) return;
    if (!configsMap.has(c)) configsMap.set(c, { runner, files: new Set(), dirs: new Set() });
    const entry = configsMap.get(c);
    if (runner !== 'unknown' && entry.runner === 'unknown') entry.runner = runner;
    if (file) entry.files.add(norm(file));
    if (dirRel) entry.dirs.add(norm(dirRel).replace(/\/+$/, '') + '/');
  };
  const addDir = (dirRel, runner = 'unknown', file = null) => {
    const d = norm(dirRel).replace(/\/+$/, '') + '/';
    if (!d || d === '/' || /(^|\/)parked[^/]*\//i.test(d)) return;
    if (!dirsMap.has(d)) dirsMap.set(d, { runner, files: new Set() });
    const entry = dirsMap.get(d);
    if (runner !== 'unknown' && entry.runner === 'unknown') entry.runner = runner;
    if (file) entry.files.add(norm(file));
  };
  const inferRunner = (cmdOrPath, fileText) => {
    const s = `${cmdOrPath || ''}\n${fileText || ''}`;
    if (/\bnode\s+--test\b|require\(['"]node:test['"]\)|from\s+['"]node:test['"]/i.test(s)) return 'node-test';
    if (/\bplaywright\b|@playwright\/test/i.test(s)) return 'playwright';
    if (/\bvitest\b|from\s+['"]vitest['"]/i.test(s)) return 'vitest';
    if (/\bjest\b/i.test(s)) return 'jest';
    if (/\.e2e\.|\.spec\.[cm]?[jt]sx?$/i.test(String(cmdOrPath || '')) && !/\bvitest\b/i.test(s)) return 'playwright';
    return 'unknown';
  };
  const acceptanceFolderFor = (rel) => {
    const f = norm(rel);
    if (/(^|\/)parked[^/]*\//i.test(f)) return null;
    const m = /^((?:[^/]+\/)*acceptance)(?:\/|$)/i.exec(f);
    if (m) return `${m[1]}/`;
    return null;
  };

  for (const a of acceptEntries) {
    if (!a || typeof a !== 'object') continue;
    const cmd = typeof a.command === 'string' ? a.command : '';
    const aFiles = extractEntryTestFiles(a).filter((f) => !/(^|\/)parked[^/]*\//i.test(f));
    const cfgM = /(?:^|\s)(?:-c|--config(?:=|\s+))["']?([^\s"']+)["']?/.exec(cmd);
    const aFolders = aFiles.map((f) => acceptanceFolderFor(f)).filter(Boolean);
    if (cfgM) addConfig(cfgM[1], inferRunner(cmd, ''), aFiles[0] || null, aFolders[0] || null);
    for (const f of aFiles) {
      const folder = acceptanceFolderFor(f);
      if (folder) {
        const txt = readFile(f) || '';
        addDir(folder, inferRunner(cmd || f, txt), f);
        if (cfgM) addConfig(cfgM[1], inferRunner(cmd, ''), f, folder);
      }
    }
  }

  for (const f of allTracked) {
    const rel = norm(f);
    if (!rel || /(^|\/)parked[^/]*\//i.test(rel)) continue;
    if (/^(?:playwright|vitest|jest)\.[^/]*acceptance[^/]*\.config\.[cm]?[jt]s$/i.test(path.posix.basename(rel))) {
      const cfgBody = readFile(rel) || '';
      const tdMatch = /testDir\s*:\s*['"](?:\.\/)?([^'"]+)['"]/.exec(cfgBody);
      addConfig(rel, inferRunner(rel, cfgBody), null, tdMatch ? tdMatch[1] : null);
    }
    if (TEST_RE.test(rel)) {
      const folder = acceptanceFolderFor(rel);
      if (folder) {
        addDir(folder, inferRunner(rel, readFile(rel) || ''), rel);
      }
    }
  }

  if (!configsMap.size && !dirsMap.size) return [];

  // Read workflow YAML contents (strip `# ...` comments line-by-line)
  const workflows = workflowFiles.map((wf) => {
    const raw = readFile(wf) || '';
    const clean = raw
      .split(/\r?\n/)
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    return { file: wf, text: clean };
  });

  // Read root vitest/playwright configs once to avoid false positives when a root runner excludes/overrides acceptance dirs
  const vitestCfgText = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs']
    .map((c) => readFile(c))
    .find(Boolean) || '';
  const pwCfgText = ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', 'playwright.config.mjs']
    .map((c) => readFile(c))
    .find(Boolean) || '';

  const textCoversTarget = (cmdText, target, isConfig, runner) => {
    const cleanTarget = norm(target).replace(/\/+$/, '');
    const esc = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Explicit path/config reference or `tests/acceptance` / `e2e/acceptance` substring match
    if (new RegExp(`(?:^|[\\s"'=/:])${esc}(?:$|[/\\s"'])`, 'i').test(cmdText)) return true;
    const base = path.posix.basename(cleanTarget);
    if (isConfig && new RegExp(`(?:-c|--config(?:=|\\s+))["']?(?:\\./)?${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(cmdText)) {
      return true;
    }
    if (!isConfig) {
      // Bare runner command without explicit path/config filter: check if default config covers this folder
      const hasPwCfgFile = [...configsMap.keys()].some((c) => /playwright/i.test(c));
      if ((runner === 'playwright' || /^e2e\//i.test(cleanTarget)) && /\bplaywright\s+test\b/i.test(cmdText)) {
        const filteredElsewhere = /\bplaywright\s+test\b[^\n;|&]*(?:\s(?:-c|--config)|\s(?:e2e|tests)\/)/i.test(cmdText);
        if (!filteredElsewhere && !hasPwCfgFile && (!pwCfgText || pwCfgText.includes(cleanTarget))) return true;
      }
      if ((runner === 'vitest' || runner === 'unknown') && !/^e2e\//i.test(cleanTarget) && /\bvitest(?:\s+run)?\b/i.test(cmdText)) {
        // If `vitest run <specificPath>` targets e.g. `tests/unit`, it does NOT cover `tests/acceptance`
        const explicitPaths = [...cmdText.matchAll(/\bvitest(?:\s+run)?\s+([^\n;|&]+)/gi)]
          .flatMap((m) => m[1].replace(/(?:^|\s)(?:-c|--config(?:=|\s+))["']?[^\s"']+["']?/gi, ' ').trim().split(/\s+/))
          .filter((tok) => tok && !tok.startsWith('-'));
        const excludesInCfg = vitestCfgText && new RegExp(`exclude[^\\]]*${esc}`, 'is').test(vitestCfgText);
        if (!explicitPaths.length && !excludesInCfg && !hasPwCfgFile) return true;
        if (explicitPaths.some((p) => cleanTarget.startsWith(norm(p).replace(/\/+$/, '')))) return true;
      }
      if ((runner === 'node-test' || runner === 'unknown') && /\bnode\s+--test\b/i.test(cmdText)) {
        const cleanParent = path.posix.dirname(cleanTarget);
        if (cleanParent && cleanParent !== '.' && new RegExp(`(?:^|[\\s"'=/:])${cleanParent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[/\\s"'])`, 'i').test(cmdText)) {
          return true;
        }
      }
      // OXB-222-07: inspect local Node test runner scripts invoked by package.json (e.g. `node scripts/quality-check.cjs test-root`)
      for (const m of cmdText.matchAll(/\bnode\s+["']?([^\s"']+\.[cm]?js)["']?/gi)) {
        const scriptRel = norm(m[1]);
        const scriptText = readFile(scriptRel);
        if (scriptText && new RegExp(`(?:^|[\\s"'=/:\\\\])${esc}(?:$|[/\\s"'\\\\])`, 'i').test(scriptText.replace(/\\/g, '/'))) {
          return true;
        }
      }
    }
    return false;
  };

  const scriptCallsTarget = new Map(); // scriptName -> boolean (resolved recursively max depth 3 for wrapper scripts)
  const matchesViaScript = (name, target, isConfig, runner, seen = new Set()) => {
    if (seen.has(name)) return false;
    seen.add(name);
    const body = scripts[name];
    if (typeof body !== 'string') return false;
    if (textCoversTarget(body, target, isConfig, runner)) return true;
    for (const m of body.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z0-9:_-]+)\b/g)) {
      if (m[1] === 'install' || m[1] === 'ci') continue;
      if (matchesViaScript(m[1], target, isConfig, runner, seen)) return true;
    }
    return false;
  };

  const findings = [];
  const evalTarget = (target, info, kind) => {
    const isConfig = kind === 'config';
    const matchingScripts = scriptEntries
      .filter(([name]) => matchesViaScript(name, target, isConfig, info.runner))
      .map(([name]) => name);
    scriptCallsTarget.set(target, matchingScripts);

    const coveredByWorkflow = workflows.some((wf) => {
      if (textCoversTarget(wf.text, target, isConfig, info.runner)) return true;
      return matchingScripts.some((sn) => {
        const snEsc = sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (sn === 'test') return /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i.test(wf.text);
        return new RegExp(`\\b(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?${snEsc}\\b`, 'i').test(wf.text);
      });
    });

    if (workflows.length && !coveredByWorkflow) {
      findings.push({
        target,
        kind,
        runner: info.runner,
        files_count: info.files.size,
        sample_files: [...info.files].slice(0, 3),
        in_package_scripts: matchingScripts,
        in_workflows: false,
      });
    } else if (!workflows.length && scriptEntries.length && !matchingScripts.length) {
      findings.push({
        target,
        kind,
        runner: info.runner,
        files_count: info.files.size,
        sample_files: [...info.files].slice(0, 3),
        in_package_scripts: [],
        in_workflows: false,
      });
    }
  };

  for (const [cfg, info] of configsMap.entries()) evalTarget(cfg, info, 'config');
  for (const [dirRel, info] of dirsMap.entries()) {
    // If an explicit acceptance config covers this directory (either reported unrun OR verified covered in CI/scripts), skip redundant dir entry
    const assocConfigs = [...configsMap.entries()].filter(([, cfgInfo]) => cfgInfo.dirs.has(dirRel));
    if (assocConfigs.length > 0) continue;
    const coveredByReportedCfg = [...configsMap.keys()].some((c) => findings.some((f) => f.target === c) && info.runner === (configsMap.get(c) || {}).runner);
    if (coveredByReportedCfg) continue;
    evalTarget(dirRel, info, 'dir');
  }

  return findings;
}

function unrunFrozenAcceptanceCiMessages(findings) {
  return (findings || []).map((f) => {
    const scopeHint = f.sample_files && f.sample_files.length ? ` (ex.: ${f.sample_files.slice(0, 2).join(', ')})` : '';
    if (f.in_package_scripts && f.in_package_scripts.length) {
      return `testes de aceite em \`${f.target}\`${scopeHint} têm script em package.json (${f.in_package_scripts.join(', ')}), mas nenhum job em \`.github/workflows/*.yml\` o executa — adicione ao workflow de CI ou estes testes nunca rodam no merge`;
    }
    return `testes de aceite congelados em \`${f.target}\`${scopeHint} nunca rodam no CI: nenhum script em \`package.json\` nem job em \`.github/workflows/*.yml\` executa essa config/pasta`;
  });
}

module.exports = { suiteImpact, messages, laterOwnedTests, laterOwnedMessages, classifyRelatedTestFiles, laterOwnedExcludesForTask, findUnrunFrozenAcceptanceCi, unrunFrozenAcceptanceCiMessages, criterionMatches, pinnedByExisting, pinnedMessages, registryManifestGaps, registryManifestMessages, importIndex, exportedConstants, trackedFiles, dataFilesOf, TEST_RE };
