'use strict';

/**
 * OxeSpace 15/11 (1.5.2 F6, T34 then T35, ~US$ 15 each): both converted raw <button>s to primitives, passed their own
 * verify, and failed the checkpoint on brd-01/brd-03 ("a contagem de botões crus cai e a trava desce") — those suites
 * require the design-lint cap to be <= the real count, and the executor never lowered it although
 * tests/design-lint.test.ts was in both tasks' files. A ratchet declared in config is lowered to the counted value in
 * the task's own commit (only down, only when its file is in the task's scope), the pack names it, and a change that
 * only moves the cap number does not make the plan stale for the other tasks listing the file.
 *
 * config lint.ratchets: [{ file, pattern (one capture group: the cap), counts (regex of what is counted),
 *   paths (globs), exclude (globs), direction: "down" }]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const norm = (p) => String(typeof p === 'string' ? p : (p && p.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');

function globToRe(glob) {
  const g = norm(glob);
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const ch = g[i];
    if (ch === '*' && g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** The ratchets of the config, normalized (invalid entries dropped). */
function ratchetsOf(config) {
  const list = config && config.lint && Array.isArray(config.lint.ratchets) ? config.lint.ratchets : [];
  const out = [];
  for (const r of list) {
    if (!r || !r.file || !r.pattern || !r.counts) continue;
    try {
      const pattern = new RegExp(r.pattern, 'd');
      const counts = new RegExp(r.counts, 'g');
      out.push({ file: norm(r.file), pattern, counts, paths: (r.paths || ['**/*']).map(globToRe), exclude: (r.exclude || []).map(globToRe), direction: r.direction === 'up' ? 'up' : 'down', raw: r });
    } catch { /* an invalid regex is skipped */ }
  }
  return out;
}

/** The cap in the ratchet file: the first match of the pattern, its captured number and line. */
function capOf(text, ratchet) {
  const m = ratchet.pattern.exec(String(text || ''));
  if (!m || m[1] == null || !/^\d+$/.test(m[1])) return null;
  const span = m.indices && m.indices[1];
  const numAt = span ? span[0] : m.index + m[0].lastIndexOf(m[1]);
  return { value: Number(m[1]), index: numAt, length: m[1].length, line: String(text).slice(0, numAt).split('\n').length };
}

/** The tracked and untracked (not ignored) files of the working tree. */
function treeFiles(root) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? String(r.stdout || '').split('\0').filter(Boolean).map(norm) : [];
}

/** How many times `counts` matches over the files the ratchet covers (paths minus exclude). */
function countOf(root, ratchet, options = {}) {
  const files = (options.files || treeFiles(root)).filter((f) => ratchet.paths.some((re) => re.test(f)) && !ratchet.exclude.some((re) => re.test(f)));
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  let n = 0;
  for (const f of files) { ratchet.counts.lastIndex = 0; n += (read(f).match(ratchet.counts) || []).length; }
  return n;
}

/**
 * Lowers, in the working tree, each ratchet whose file is in the task's scope and whose cap is above the real count.
 * @returns {{ file: string, line: number, from: number, to: number }[]}
 */
function lowerRatchets(root, config, scope, options = {}) {
  const testScope = require('./oxe-test-scope.cjs');
  const inScope = (f) => (scope || []).some((s) => testScope.covers(norm(s), f));
  const out = [];
  for (const r of ratchetsOf(config)) {
    if (r.direction !== 'down' || !inScope(r.file)) continue;
    const full = path.join(root, r.file);
    let text = '';
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const cap = capOf(text, r);
    if (!cap) continue;
    const count = countOf(root, r, options);
    if (count >= cap.value) continue;
    const next = text.slice(0, cap.index) + String(count) + text.slice(cap.index + cap.length);
    if (!options.dryRun) fs.writeFileSync(full, next, 'utf8');
    out.push({ file: r.file, line: cap.line, from: cap.value, to: count });
  }
  return out;
}

/** The pack / prompt note for a task that holds a ratchet file in its scope. */
function ratchetNotes(root, config, scope) {
  const testScope = require('./oxe-test-scope.cjs');
  const notes = [];
  for (const r of ratchetsOf(config)) {
    if (!(scope || []).some((s) => testScope.covers(norm(s), r.file))) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(root, r.file), 'utf8'); } catch { continue; }
    const cap = capOf(text, r);
    if (!cap) continue;
    notes.push(`a trava em ${r.file}:${cap.line} está em ${cap.value} (o que ela conta: ${r.raw.counts}). Se esta tarefa reduz essa contagem, baixe a trava para a contagem nova — o checkpoint a baixa sozinho se ficar acima`);
  }
  return notes;
}

/** Whether a diff of a ratchet file only moves the cap number (every changed line differs only in a declared cap). */
function onlyCapChanged(before, after, config, file) {
  const rs = ratchetsOf(config).filter((x) => x.file === norm(file));
  if (!rs.length) return false;
  const a = String(before || '').split(/\r?\n/);
  const b = String(after || '').split(/\r?\n/);
  if (a.length !== b.length) return false;
  const maskCap = (line, r) => {
    const c = capOf(line, r);
    return c ? `${line.slice(0, c.index)}#${line.slice(c.index + c.length)}` : null;
  };
  let changed = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    changed += 1;
    if (!rs.some((r) => { const ma = maskCap(a[i], r); const mb = maskCap(b[i], r); return ma !== null && ma === mb; })) return false;
  }
  return changed > 0;
}

module.exports = { ratchetsOf, capOf, countOf, lowerRatchets, ratchetNotes, onlyCapChanged, globToRe };
