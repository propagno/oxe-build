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

module.exports = { suiteImpact, messages, importIndex, exportedConstants, TEST_RE };
