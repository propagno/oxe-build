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

function walkAcceptanceTestFiles(dir, rootDir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkAcceptanceTestFiles(full, rootDir, acc);
    } else if (ent.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(ent.name)) {
      acc.push(norm(path.relative(rootDir, full)));
    }
  }
  return acc;
}

function regexRequiresLiteralDigit(pattern) {
  const cleaned = String(pattern || '')
    .replace(/\\[^d0-9]/g, '')
    .replace(/\{\d+(?:,\d*)?\}/g, '')
    .replace(/\[\^[^\]]*\]/g, '');
  return /\\d|[0-9]/.test(cleaned);
}

function assertionRequiresDigit(assertionCall) {
  const call = String(assertionCall || '');
  if (/\.not\b/.test(call)) return false;
  const reMatch = /\.toMatch\s*\(\s*\/((?:\\.|[^/\\])+)\/[dgimsuvy]*\s*\)/.exec(call);
  if (reMatch) return regexRequiresLiteralDigit(reMatch[1]);
  const strMatch = /\.(?:toMatch|toContain|toBe|toEqual)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)/.exec(call);
  if (strMatch) return /[0-9]/.test(strMatch[2]);
  return false;
}

function collectTargetAcceptanceFiles(projectRoot, docOrFiles) {
  const files = new Set();
  if (Array.isArray(docOrFiles)) {
    for (const f of docOrFiles) if (f) files.add(norm(typeof f === 'string' ? f : f.path));
  } else {
    for (const entry of entriesOf(docOrFiles)) {
      for (const f of entry.files || []) {
        if (f) files.add(norm(typeof f === 'string' ? f : f.path));
      }
    }
    if (!docOrFiles || docOrFiles.scanAcceptanceDir !== false) {
      for (const f of walkAcceptanceTestFiles(path.join(projectRoot, 'tests', 'acceptance'), projectRoot)) {
        files.add(f);
      }
    }
  }
  return [...files].sort();
}

/**
 * Masks comments with spaces (`commentStripped`, keeping string literals intact) and also produces `structureOnly`
 * (strings/templates masked too, preserving `{`/`}` only in code and `\r`/`\n` everywhere so offsets/lines stay exact).
 */
function maskJsSource(raw) {
  const src = String(raw || '');
  const commentArr = src.split('');
  const structArr = src.split('');
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    // Line comment //
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') {
        commentArr[i] = ' ';
        structArr[i] = ' ';
        i += 1;
      }
      continue;
    }
    // Block comment /* ... */
    if (ch === '/' && next === '*') {
      commentArr[i] = ' ';
      structArr[i] = ' ';
      commentArr[i + 1] = ' ';
      structArr[i + 1] = ' ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n' && src[i] !== '\r') {
          commentArr[i] = ' ';
          structArr[i] = ' ';
        }
        i += 1;
      }
      if (i < src.length) {
        commentArr[i] = ' ';
        structArr[i] = ' ';
        if (i + 1 < src.length) {
          commentArr[i + 1] = ' ';
          structArr[i + 1] = ' ';
        }
        i += 2;
      }
      continue;
    }
    // Single, double, or backtick string literal
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      structArr[i] = ' ';
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          if (src[i] !== '\n' && src[i] !== '\r') structArr[i] = ' ';
          if (src[i + 1] !== '\n' && src[i + 1] !== '\r') structArr[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (src[i] !== '\n' && src[i] !== '\r') structArr[i] = ' ';
        i += 1;
      }
      if (i < src.length) {
        structArr[i] = ' ';
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return {
    commentStripped: commentArr.join(''),
    structureOnly: structArr.join(''),
  };
}

function lineNumberAt(text, offset) {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function findEnclosingBlockBounds(structureOnly, pos) {
  let depth = 0;
  let openBrace = -1;
  for (let i = pos - 1; i >= 0; i -= 1) {
    const ch = structureOnly[i];
    if (ch === '}') depth += 1;
    else if (ch === '{') {
      if (depth === 0) {
        openBrace = i;
        break;
      }
      depth -= 1;
    }
  }
  if (openBrace < 0) return { start: 0, end: structureOnly.length };
  let fwdDepth = 1;
  for (let i = openBrace + 1; i < structureOnly.length; i += 1) {
    const ch = structureOnly[i];
    if (ch === '{') fwdDepth += 1;
    else if (ch === '}') {
      fwdDepth -= 1;
      if (fwdDepth === 0) return { start: openBrace, end: i + 1 };
    }
  }
  return { start: openBrace, end: structureOnly.length };
}

/**
 * OXB-208: static lint for Node 22+ paused `net.connect` / `tls.connect` sockets in frozen acceptance tests.
 * When a test opens `connect(...)`, sends data via `.write(...)`, and waits for `.on('close')` or `.on('end')`
 * without `.resume()` or a `'data'`/`'readable'` listener in the same scope, unread server bytes in
 * `readableState.buffer` prevent `'end'` and `'close'` from firing on graceful server EOF in Node 22+.
 */
function pausedSocketFindings(projectRoot, docOrFiles) {
  const files = collectTargetAcceptanceFiles(projectRoot, docOrFiles);
  const findings = [];
  const seenKey = new Set();
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const assignedConnectRe = /(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*|(?<![.\w$])([A-Za-z_$][\w$]*)\s*=\s*)(?:await\s+)?(?:(net|tls|nodeNet|nodeTls)\s*\.\s*)?(connect|createConnection)\s*\(/g;
  const bareConnectRe = /(?<![=.\w$])(?:(net|tls|nodeNet|nodeTls)\s*\.\s*)?(connect|createConnection)\s*\(/g;

  for (const file of files) {
    const abs = path.join(projectRoot, file);
    if (!fs.existsSync(abs)) continue;
    let raw;
    try { raw = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (!/\b(?:connect|createConnection)\s*\(/.test(raw)) continue;

    const { commentStripped, structureOnly } = maskJsSource(raw);
    const rawLines = raw.split(/\r?\n/);

    assignedConnectRe.lastIndex = 0;
    let m;
    while ((m = assignedConnectRe.exec(commentStripped)) !== null) {
      const varName = m[1] || m[2];
      const matchStart = m.index;
      const afterConnect = matchStart + m[0].length;
      const bounds = findEnclosingBlockBounds(structureOnly, matchStart);
      let scopeEnd = bounds.end;

      // Cap scope if the same variable is reassigned later in the same block
      const reassignRe = new RegExp(`(?<![.\\w$])${escRe(varName)}\\s*=[^=]`, 'g');
      reassignRe.lastIndex = afterConnect;
      const nextReassign = reassignRe.exec(structureOnly);
      if (nextReassign && nextReassign.index < scopeEnd) {
        scopeEnd = nextReassign.index;
      }

      const scopeCode = commentStripped.slice(matchStart, scopeEnd);
      const escVar = escRe(varName);
      const writeRe = new RegExp(`\\b(?:${escVar}|this)\\s*\\.\\s*write\\s*\\(`);
      const closeOrEndRe = new RegExp(`\\b${escVar}\\s*\\.\\s*(?:on|once|addListener)\\s*\\(\\s*(['"\`])(close|end)\\1`);
      const drainRe = new RegExp(
        `\\b${escVar}\\s*\\.\\s*(?:resume|pipe)\\s*\\(`
        + `|\\b${escVar}\\s*\\.\\s*(?:on|once|addListener)\\s*\\(\\s*(['"\`])(?:data|readable)\\1`
        + `|\\bfor\\s+await\\s*\\([^)]*\\bof\\s+${escVar}\\b`
        + `|\\bpipeline\\s*\\([^)]*\\b${escVar}\\b`
      );

      const writeMatch = writeRe.exec(scopeCode);
      const closeMatch = closeOrEndRe.exec(scopeCode);
      if (writeMatch && closeMatch && !drainRe.test(scopeCode)) {
        const closeLine = lineNumberAt(commentStripped, matchStart + closeMatch.index);
        const connectLine = lineNumberAt(commentStripped, matchStart);
        const key = `${file}:${closeLine}:${varName}`;
        if (!seenKey.has(key)) {
          seenKey.add(key);
          findings.push({
            file,
            line: closeLine,
            connect_line: connectLine,
            kind: 'paused_socket_close',
            variable: varName,
            event: closeMatch[2],
            suggestion: `chame ${varName}.resume() ou registre ${varName}.on('data', () => {}) no mesmo escopo`,
            snippet: (rawLines[closeLine - 1] || '').trim().slice(0, 140),
          });
        }
      }
    }

    bareConnectRe.lastIndex = 0;
    while ((m = bareConnectRe.exec(commentStripped)) !== null) {
      // Skip if preceded by `= ` (already handled by assignedConnectRe)
      const prefix = commentStripped.slice(Math.max(0, m.index - 40), m.index);
      if (/=\s*(?:await\s+)?$/.test(prefix)) continue;
      const bounds = findEnclosingBlockBounds(structureOnly, m.index);
      const scopeCode = commentStripped.slice(m.index, bounds.end);
      const writeMatch = /\.\s*write\s*\(/.exec(scopeCode);
      const closeMatch = /\.\s*(?:on|once|addListener)\s*\(\s*(['"`])(close|end)\1/.exec(scopeCode);
      const drainMatch = /\.\s*(?:resume|pipe)\s*\(|\.\s*(?:on|once|addListener)\s*\(\s*(['"`])(?:data|readable)\1/.test(scopeCode);
      if (writeMatch && closeMatch && !drainMatch) {
        const closeLine = lineNumberAt(commentStripped, m.index + closeMatch.index);
        const connectLine = lineNumberAt(commentStripped, m.index);
        const key = `${file}:${closeLine}:<chained>`;
        if (!seenKey.has(key)) {
          seenKey.add(key);
          findings.push({
            file,
            line: closeLine,
            connect_line: connectLine,
            kind: 'paused_socket_close',
            variable: 'socket',
            event: closeMatch[2],
            suggestion: "chame socket.resume() ou registre .on('data', () => {}) no mesmo escopo",
            snippet: (rawLines[closeLine - 1] || '').trim().slice(0, 140),
          });
        }
      }
    }
  }
  return findings;
}

function pausedSocketMessages(findings) {
  return (findings || []).map((f) => (
    `${f.file}:${f.line}: socket \`${f.variable}\` aberto com connect() (linha ${f.connect_line}) aguarda '${f.event}' após .write() em modo pausado (Node 22+ não emite '${f.event}' com bytes não lidos no buffer) — ${f.suggestion}`
  ));
}

/**
 * OXB-205: static lint over frozen acceptance test suites (`tests/acceptance/**` + `acceptance_tests.files`).
 * Detects:
 *  1. Suspicious unescaped regex character classes (`/d+/`, `/s+/`, `/w+/`, etc.) next to `.replace(`, `.match(`,
 *     `.split(`, `.toMatch(`, `.test(`, `.exec(`.
 *  2. Contradictory strip-digits (`.replace(/\d+/g, '')`) immediately followed by an assertion expecting digits on
 *     the stripped value.
 */
function suspiciousRegexFindings(projectRoot, docOrFiles) {
  const files = collectTargetAcceptanceFiles(projectRoot, docOrFiles);

  const findings = [];
  const callBeforeRe = /\.(replace|replaceAll|match|matchAll|split|search|toMatch)\s*\(\s*\/(\^?(?:\\b)?([dswDSW])(\+|\*|\{\d+(?:,\d*)?\})(?:\\b)?\$?)\/([dgimsuvy]*)/g;
  const callAfterRe = /\/(\^?(?:\\b)?([dswDSW])(\+|\*|\{\d+(?:,\d*)?\})(?:\\b)?\$?)\/([dgimsuvy]*)\s*\.\s*(test|exec)\s*\(/g;
  const stripDigitsRe = /\.replace(?:All)?\s*\(\s*\/(?:\\d\+|\[0-9\]\+)\/[dgimsuvy]*\s*,\s*(['"`])([^'"`0-9]*)\1\s*\)/;

  for (const file of files) {
    const abs = path.join(projectRoot, file);
    if (!fs.existsSync(abs)) continue;
    let raw;
    try { raw = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    // Replace block comments preserving newlines so line numbers stay exact
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) continue;
      const codeLine = line.replace(/\/\/.*$/, '');

      callBeforeRe.lastIndex = 0;
      let m;
      while ((m = callBeforeRe.exec(codeLine)) !== null) {
        const body = m[2];
        const cls = m[3];
        const flags = m[5] || '';
        const suggested = `/${body.replace(cls, `\\${cls}`)}/${flags}`;
        findings.push({
          file,
          line: i + 1,
          kind: 'unescaped_char_class',
          pattern: `/${body}/${flags}`,
          suggestion: suggested,
          method: `.${m[1]}(`,
          snippet: trimmed.slice(0, 140),
        });
      }

      callAfterRe.lastIndex = 0;
      while ((m = callAfterRe.exec(codeLine)) !== null) {
        const body = m[1];
        const cls = m[2];
        const flags = m[4] || '';
        const suggested = `/${body.replace(cls, `\\${cls}`)}/${flags}`;
        findings.push({
          file,
          line: i + 1,
          kind: 'unescaped_char_class',
          pattern: `/${body}/${flags}`,
          suggestion: suggested,
          method: `.${m[5]}(`,
          snippet: trimmed.slice(0, 140),
        });
      }

      if (stripDigitsRe.test(codeLine)) {
        // Case A: chained `expect(...replace(/\d+/g, '')...).toMatch(/2/)`
        const window2 = `${codeLine} ${lines[i + 1] ? lines[i + 1].replace(/\/\/.*$/, '') : ''}`;
        if (/\bexpect\s*\([^)]*\.replace(?:All)?\s*\(\s*\/(?:\\d\+|\[0-9\]\+)\//.test(window2) && assertionRequiresDigit(window2)) {
          findings.push({
            file,
            line: i + 1,
            kind: 'contradictory_strip_assert',
            pattern: '.replace(/\\d+/g, ...)',
            suggestion: 'não remova dígitos antes de afirmar presença de dígitos no mesmo valor',
            snippet: trimmed.slice(0, 140),
          });
          continue;
        }
        // Case B: `const x = ...replace(/\d+/g, '')` followed by `expect(x).toMatch(/2/)`
        const assignMatch = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(codeLine);
        if (assignMatch) {
          const varName = assignMatch[1];
          const escapedVar = varName.replace(/\$/g, '\\$');
          const expectVarRe = new RegExp(`\\bexpect\\s*\\(\\s*${escapedVar}(?:\\s*\\.[\\w$]+\\(\\s*\\))*\\s*\\)`);
          const reassignRe = new RegExp(`\\b${escapedVar}\\s*=[^=]`);
          for (let j = i + 1; j < Math.min(lines.length, i + 12); j += 1) {
            const nextCode = lines[j].replace(/\/\/.*$/, '');
            if (/^\s*\}\s*\)\s*;?\s*$/.test(nextCode)) break;
            if (reassignRe.test(nextCode)) break;
            if (expectVarRe.test(nextCode) && assertionRequiresDigit(nextCode)) {
              findings.push({
                file,
                line: j + 1,
                kind: 'contradictory_strip_assert',
                pattern: `${varName} (após .replace(/\\d+/g, ''))`,
                suggestion: 'a linha anterior removeu todos os dígitos com .replace(/\\d+/g, ""); a asserção de dígitos sempre falhará',
                snippet: lines[j].trim().slice(0, 140),
              });
              break;
            }
          }
        }
      }
    }
  }
  return findings;
}

function suspiciousRegexMessages(findings) {
  return (findings || []).map((f) => {
    if (f.kind === 'contradictory_strip_assert') {
      return `${f.file}:${f.line}: contradição em teste congelado — ${f.pattern} remove dígitos, mas a asserção exige dígito (${f.snippet})`;
    }
    return `${f.file}:${f.line}: regex suspeita ${f.pattern} ao lado de ${f.method} (provável barra invertida omitida: use ${f.suggestion})`;
  });
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

module.exports = {
  sourceAssertionFindings,
  rigorMessages,
  suspiciousRegexFindings,
  suspiciousRegexMessages,
  pausedSocketFindings,
  pausedSocketMessages,
  mutationSample,
  mutationMessages,
  mutantsOf,
};
