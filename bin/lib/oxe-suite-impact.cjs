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
const SKIP_DIR_RE = /(^|\/)(node_modules|dist|build|out|coverage|\.oxe)\//;
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

function trackedFiles(root) {
  const r = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
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

/** target file → [{ test, names, wildcard }] for every test file of the repo. */
function importIndex(root, { files = null, readText = null } = {}) {
  const pb = require('./oxe-plan-build.cjs');
  const all = (files || trackedFiles(root)).filter((f) => CODE_RE.test(f) && !SKIP_DIR_RE.test(f));
  const known = new Set(all);
  const aliases = pb.loadPathAliases(root);
  const read = readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const byTarget = new Map();
  for (const test of all.filter((f) => TEST_RE.test(f))) {
    for (const imp of pb.extractModuleImports(read(test))) {
      const target = pb.resolveModuleSpecifier(test, imp.specifier, known, aliases);
      if (!target || target === test) continue;
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push({ test, names: imp.names || [], wildcard: Boolean(imp.wildcard) });
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
  // readFileSync('a/b.json') / path.join(__dirname, 'fixtures', 'x.json') / path.resolve('tests/fixtures/x.json')
  for (const m of src.matchAll(/\b(?:readFileSync|readFile|path\.(?:join|resolve))\(([^)]*)\)/g)) {
    const parts = [...m[1].matchAll(/['"`]([^'"`$]+)['"`]/g)].map((p) => p[1]);
    if (parts.length) consider(parts.join('/'));
  }
  return [...out];
}

/**
 * Per task not done: the suites that import its files and are outside its verify/scope.
 * @returns {{ task: string, file: string, suites: { test: string, level: 'warn'|'error', names: string[] }[] }[]}
 */
function suiteImpact(root, planDoc, options = {}) {
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => t && !(t.done === true || t.status === 'done'));
  if (!tasks.length) return [];
  const { byTarget, read } = options.index || importIndex(root, options);
  const known = new Set(options.files || trackedFiles(root));
  const accept = (planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []);
  // G38: a suite another pending task owns (in its files) at the same or a later wave is not asked into this verify —
  // it turns green only with that task (OxeCode F6: u83, owned by T30, was put in T27's verify)
  const laterOwner = new Map();
  for (const o of tasks) for (const f of o.files || []) {
    const p = norm(typeof f === 'string' ? f : f && f.path);
    if (p && TEST_RE.test(p) && /(^|\/)acceptance\//i.test(p)) laterOwner.set(p, [...(laterOwner.get(p) || []), o]);
  }
  // cross-review 15/11: the frozen entries count as G38 counts them — a frozen test is never in its owner's files, and
  // G30 asking it into the earlier verify while G38 asks it out was a deadlock
  for (const a of accept) {
    if (!a) continue;
    const owners = a.task ? tasks.filter((o) => o.id === a.task) : tasks.filter((o) => (o.acceptance || []).includes(a.criterion));
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
    const inScope = (f) => scope.some((s) => s === f || (s.endsWith('/') && f.startsWith(s)) || (/[*?]/.test(s) && new RegExp(`^${s.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*')}$`).test(f)));
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
  const pending = all.filter((t) => !(t.done === true || t.status === 'done'));
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
  // a frozen entry of the owner, or a file of its scope under an acceptance/ folder
  const ACCEPT_DIR = /(^|\/)acceptance\//i;
  for (const t of pending) for (const f of t.files || []) { const p = norm(typeof f === 'string' ? f : f && f.path); if (ACCEPT_DIR.test(p)) own(p, t.id); }
  for (const a of (planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : [])) {
    if (!a) continue;
    const ids = a.task ? [a.task] : pending.filter((t) => (t.acceptance || []).includes(a.criterion)).map((t) => t.id);
    for (const id of ids) if (pending.some((t) => t.id === id)) for (const f of a.files || []) { own(typeof f === 'string' ? f : f.path, id); frozenOwners.add(`${norm(typeof f === 'string' ? f : f.path)}\u0000${id}`); }
  }
  const waveOf = (t) => (Number.isFinite(Number(t && t.wave)) ? Number(t.wave) : null);
  const out = [];
  for (const t of pending) {
    // OxeSpace 15/11 (F6 T44, wave 18): a vitest file argument is a SUBSTRING filter — `pu03-app-version.test.ts` also
    // ran T59's `pu03-app-version.test.tsx` (wave 33). Each command's arguments are matched as filters; a command
    // narrowed by -t / --testNamePattern is taken as running its own cases only.
    const commands = [...((t.verify && t.verify.commands) || []), t.verify && t.verify.command, t.verifyCommand].filter(Boolean).map((c) => String(c).replace(/\\/g, '/'));
    const tests = [];
    const via = new Map(); // matched file → the verify argument that selects it (when not the same path)
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
          if (known === a || (substring && known.includes(a))) { tests.push(known); if (known !== a && !via.has(known)) via.set(known, a); }
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
        out.push({ task: t.id, wave: w, test, owner: ownerId, owner_wave: ow, ...(via.has(test) ? { via: via.get(test) } : {}) });
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
  const git = (args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); return r.status === 0 ? r.stdout : ''; };
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => t && !(t.done === true || t.status === 'done'));
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

module.exports = { suiteImpact, messages, laterOwnedTests, laterOwnedMessages, pinnedByExisting, pinnedMessages, importIndex, exportedConstants, trackedFiles, dataFilesOf, TEST_RE };
