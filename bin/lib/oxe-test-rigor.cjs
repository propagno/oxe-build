'use strict';

/**
 * OXB-109: rigor of the frozen acceptance tests.
 *  - source assertion: a test that READS product source code as text and imports no product module asserts on the
 *    text, not on behavior. Allowed only when its acceptance_tests entry declares `rigor: "source-assertion"` with a
 *    `rigor_reason`.
 *  - mutation sample (`plan lint --mutation`): for the frozen tests of DONE tasks, a few mutants of the product files
 *    each test imports (=== ↔ !==, true ↔ false, < ↔ >=, a return value → undefined); a mutant the test still passes
 *    "survived". Runs in a temporary worktree at HEAD — the real tree is never touched. Report per test file.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const testScope = require('./oxe-test-scope.cjs');

const SOURCE_CODE_RE = /\.(c|m)?[jt]sx?$|\.(kt|kts|java|py|go|rs|swift|cs|vue|svelte)$/i;
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

function entriesOf(doc) {
  return (doc && Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : []).filter(Boolean);
}

/** Per frozen test file: does it only assert on source text? */
function sourceAssertionFindings(projectRoot, doc) {
  const out = [];
  const tasks = (doc && Array.isArray(doc.tasks) ? doc.tasks : []).filter(Boolean);
  const doneIds = new Set(tasks.filter((t) => t.done === true).map((t) => t.id));
  for (const entry of entriesOf(doc)) {
    if (entry.rigor === 'source-assertion' && typeof entry.rigor_reason === 'string' && entry.rigor_reason.trim().length >= 8) continue;
    // frozen tests of finished work are history; the gate is for tests still to be proven
    if (entry.task && doneIds.has(entry.task)) continue;
    for (const f of entry.files || []) {
      const file = norm(typeof f === 'string' ? f : f.path);
      const req = testScope.testRequirements(projectRoot, file);
      const sourceReads = req.filter((r) => r.kind === 'read' && SOURCE_CODE_RE.test(r.path));
      const productImports = req.filter((r) => r.kind === 'import' && SOURCE_CODE_RE.test(r.path));
      if (sourceReads.length && !productImports.length) {
        out.push({ file, task: entry.task || null, criterion: entry.criterion || null, reads: sourceReads.map((r) => r.path), declared: entry.rigor === 'source-assertion' });
      }
    }
  }
  return out;
}

function rigorMessages(findings) {
  return findings.map((f) => `${f.task || f.criterion || 'acceptance'}: ${f.file} afirma sobre o TEXTO do código (lê ${f.reads.slice(0, 3).join(', ')}) sem importar nada do produto — teste o comportamento, ou declare no acceptance_tests "rigor": "source-assertion" com "rigor_reason"${f.declared ? ' (rigor_reason faltando ou curto)' : ''}`);
}

const MUTATORS = [
  { re: /===/, to: '!==' },
  { re: /!==/, to: '===' },
  { re: /\btrue\b/, to: 'false' },
  { re: /\bfalse\b/, to: 'true' },
  { re: /(\w)\s*<\s*(\w)/, to: '$1 >= $2' },
  { re: /(\w)\s*>\s*(\w)/, to: '$1 <= $2' },
  { re: /\breturn\s+(?!;)([^;\n]+);/, to: 'return undefined;' },
];

/** Up to `max` mutants for a file's text: { line, before, after }. Comments and imports are skipped. */
function mutantsOf(text, max) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length && out.length < max; i += 1) {
    const l = lines[i];
    if (/^\s*(\/\/|\*|\/\*|import\b|export\s+\{|#)/.test(l) || /require\(/.test(l)) continue;
    const m = MUTATORS.find((x) => x.re.test(l));
    if (!m) continue;
    const after = l.replace(m.re, m.to);
    if (after !== l) out.push({ line: i + 1, before: l, after });
  }
  return out;
}

function gitRun(root, args) { return spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }); }

/**
 * Mutation sample for the frozen tests of done tasks. @returns {Array<{ file, command, mutants, killed, survived: Array<{ target, line, after }> }>}
 */
function mutationSample(projectRoot, doc, options = {}) {
  const max = Number(options.max) > 0 ? Number(options.max) : 3;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 120_000;
  const tasks = (doc && Array.isArray(doc.tasks) ? doc.tasks : []).filter(Boolean);
  const doneIds = new Set(tasks.filter((t) => t.done === true).map((t) => t.id));
  const targets = entriesOf(doc).filter((e) => e.command && (!e.task || doneIds.has(e.task)));
  if (!targets.length) return [];
  const wt = path.join(projectRoot, '.oxe', 'mutation-ws', `m-${Date.now().toString(36)}`);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  if (gitRun(projectRoot, ['worktree', 'add', '-q', '--detach', wt, 'HEAD']).status !== 0) return [];
  const report = [];
  try {
    const nm = path.join(projectRoot, 'node_modules');
    if (fs.existsSync(nm)) fs.symlinkSync(fs.realpathSync(nm), path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    try { require('./oxe-local-config.cjs').copyLocalFiles(projectRoot, wt); } catch { /* */ }
    const run = (cmd) => spawnSync(cmd, { cwd: wt, shell: true, encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    for (const entry of targets) {
      for (const f of entry.files || []) {
        const file = norm(typeof f === 'string' ? f : f.path);
        const imports = testScope.testRequirements(wt, file).filter((r) => r.kind === 'import' && r.exists && SOURCE_CODE_RE.test(r.path));
        const row = { file, command: entry.command, mutants: 0, killed: 0, survived: [] };
        if (run(entry.command).status !== 0) { row.skipped = 'o teste já falha em HEAD'; report.push(row); continue; }
        for (const imp of imports) {
          const abs = path.join(wt, imp.path);
          const original = fs.readFileSync(abs, 'utf8');
          for (const m of mutantsOf(original, max)) {
            const lines = original.split('\n');
            lines[m.line - 1] = m.after;
            fs.writeFileSync(abs, lines.join('\n'));
            row.mutants += 1;
            const r = run(entry.command);
            if (r.status === 0) row.survived.push({ target: imp.path, line: m.line, after: m.after.trim().slice(0, 100) });
            else row.killed += 1;
            fs.writeFileSync(abs, original);
          }
        }
        report.push(row);
      }
    }
  } finally {
    try {
      const rt = (() => { try { return require('../../lib/runtime/index.js'); } catch { return null; } })();
      if (rt && typeof rt.unlinkExternalLinks === 'function') rt.unlinkExternalLinks(wt);
      else if (fs.existsSync(path.join(wt, 'node_modules'))) fs.unlinkSync(path.join(wt, 'node_modules'));
    } catch { /* */ }
    let linkLeft = false;
    try { linkLeft = fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink(); } catch { linkLeft = false; }
    if (!linkLeft) gitRun(projectRoot, ['worktree', 'remove', '--force', wt]);
    gitRun(projectRoot, ['worktree', 'prune']);
  }
  return report;
}

function mutationMessages(report) {
  const msgs = [];
  for (const r of report) {
    if (r.skipped) { msgs.push(`${r.file}: mutação pulada — ${r.skipped}`); continue; }
    if (!r.mutants) continue;
    if (r.survived.length) msgs.push(`${r.file}: ${r.killed}/${r.mutants} mutantes mortos — sobreviveram ${r.survived.slice(0, 3).map((s) => `${s.target}:${s.line} (${s.after})`).join('; ')}: o teste não pega essa mudança de comportamento`);
  }
  return msgs;
}

module.exports = { sourceAssertionFindings, rigorMessages, mutationSample, mutationMessages, mutantsOf };
