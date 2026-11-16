'use strict';

/**
 * OXB-C1 P2 (#5 G45 & #7 G46):
 *   - `crossCardFrozenConflicts` (G45): detects existing frozen/acceptance/e2e/out-of-scope tests that render, import,
 *     or inspect the components/CSS touched by a pending task AND assert shapes that the task removes, hides, or
 *     changes in cardinality (e.g. `data-variant="plain"`, `.plain` CSS rule, `'main'` branch chip, or `> 10` nav rows
 *     against `9` sections in BRD-23 Settings).
 *   - `rateLimitHazards` (G46): checks the plan's frozen/acceptance tests against `config.lint.rate_limits` for call
 *     volumes exceeding per-minute budgets (e.g. 250 calls to `oxequery_read` vs 120/min) and unmocked calls to tools
 *     marked `requires_approval: true` (e.g. `oxequery_execute`).
 */

const fs = require('fs');
const path = require('path');
const si = require('./oxe-suite-impact.cjs');
const testScope = require('./oxe-test-scope.cjs');

const norm = (p) => String(typeof p === 'string' ? p : (p && p.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');
const isInactiveTask = (t) => !t || t.done === true || t.status === 'done' || t.status === 'superseded' || Boolean(t.superseded) || Boolean(t.merged_into);
const TEST_RE = /(^|\/)(tests?|__tests__|specs?|e2e|playwright)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const FROZEN_DIR_RE = /(^|\/)(acceptance|e2e)\//i;

const STOP_TOKENS = new Set([
  'true', 'false', 'null', 'undefined', 'none', 'auto', 'flex', 'grid', 'block', 'inline',
  'div', 'span', 'button', 'input', 'label', 'form', 'section', 'header', 'footer',
  'test', 'spec', 'todo', 'done', 'open', 'close', 'file', 'path', 'text', 'type', 'name',
  'value', 'data', 'item', 'list', 'page', 'view', 'code', 'json', 'html', 'body', 'head',
]);

function stripCommentsPreserveLines(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts SPEC criterion descriptions by criterion ID (`A1` -> row text) when `specText` is provided.
 */
function parseSpecCriteriaText(specText) {
  const map = new Map();
  if (!specText) return map;
  for (const line of String(specText).split(/\r?\n/)) {
    const m = /^\s*\|\s*(A\d+(?:\.\d+)?)\s*\|(.*)$/.exec(line);
    if (m) map.set(m[1].toUpperCase(), m[2].trim());
  }
  return map;
}

/**
 * Extracts shape removals/negations and target counts from a task's prose (`title`, `notes`, `description`, `SPEC` rows)
 * and from negative/exact-count assertions in the task's own frozen acceptance tests.
 */
function extractTaskShapeMutations(task, specCriteriaMap, ownFrozenTexts) {
  const removedTokens = new Map(); // token -> { token, kind: 'selector'|'attr'|'class'|'token', source }
  const countTargets = []; // { count: number, noun: string|null, source: string }

  const addRemoved = (raw, source) => {
    const t = String(raw || '').trim();
    if (!t || t.length < 3 || t.length > 80) return;
    const clean = t.replace(/^['"`]|['"`]$/g, '').trim();
    if (!clean || clean.length < 3 || /\s{2,}/.test(clean)) return;
    if (STOP_TOKENS.has(clean.toLowerCase())) return;
    // Ignore file paths (contain `/` or file extensions like `.ts`, `.tsx`, `.cjs`, `.json`, `.md`)
    if (clean.includes('/') || /\.(c|m)?[jt]sx?$|(\.json|\.md|\.ya?ml|\.css|\.scss|\.html)$/i.test(clean)) return;
    const kind = clean.startsWith('[') || clean.includes('=')
      ? 'attr'
      : clean.startsWith('.')
        ? 'class'
        : 'token';
    if (!removedTokens.has(clean)) removedTokens.set(clean, { token: clean, kind, source });
    // If `data-variant="plain"` or `variant="plain"`, also register the value if >= 4 chars and specific, or `.plain`
    const attrVal = /^(?:data-)?[\w-]+\s*=\s*["']?([\w-]+)["']?$/.exec(clean);
    if (attrVal && attrVal[1].length >= 4 && !STOP_TOKENS.has(attrVal[1].toLowerCase())) {
      if (!removedTokens.has(attrVal[1])) removedTokens.set(attrVal[1], { token: attrVal[1], kind: 'token', source });
    }
  };

  const proseParts = [
    task.title,
    task.notes,
    task.description,
    task.objective,
    ...((task.acceptance || []).map((a) => specCriteriaMap.get(String(a).toUpperCase())).filter(Boolean)),
  ].filter(Boolean);
  const prose = proseParts.join('\n');

  // 1a. Negation / removal clauses in task prose (PT + EN)
  const NEG_CLAUSE_RE = /\b(?:remove[r]?|removi\w+|elimina\w*|sem|sai|saem|deixa\s+de\s+(?:ter|exibir|mostrar|renderizar)|esconde\w*|oculta\w*|suprime\w*|substitui\w*|descarta\w*|drop(?:s|ped)?|hide[s]?|hidden|without|no\s+longer|removes?|eliminates?)\b([^\n;]{1,160})/gi;
  for (const m of prose.matchAll(NEG_CLAUSE_RE)) {
    // Stop before sentence period (`.` followed by whitespace/end) or replacement target (`por`, `para`, `with`, `->`, `→`)
    const clause = m[1].split(/\.(?=\s|$)|\b(?:por|para|em\s+favor\s+de|with|in\s+favor\s+of)\b|->|→/i)[0];
    for (const q of clause.matchAll(/`([^`]{2,80})`|"([^"]{2,80})"|'([^']{2,80})'/g)) {
      addRemoved(q[1] || q[2] || q[3], 'spec/notes');
    }
    for (const c of clause.matchAll(/(?:^|\s)(\.[A-Za-z_-][\w-]{2,})\b/g)) {
      addRemoved(c[1], 'spec/notes');
    }
    for (const a of clause.matchAll(/\[?(data-[\w-]+(?:\s*=\s*["'][^"']+["'])?)\]?/g)) {
      addRemoved(a[1], 'spec/notes');
    }
  }

  // 1b. Explicit count targets in task prose (`9 seções`, `consolida em 9 seções`, `exactly 9 sections`, etc.)
  const COUNT_PROSE_RE = /\b(?:exatamente\s+|apenas\s+|consolida\w*\s+(?:em|para)\s+|reduz\w*\s+para\s+|exact(?:ly)?\s+|into\s+|down\s+to\s+)?(\d{1,3})\s+(seç(?:ões|oes)|secoes|navegaç\w*|linhas(?:\s+de\s+navegaç\w*)?|abas|itens|sections|nav\s+rows|rows|tabs|items)\b/gi;
  for (const m of prose.matchAll(COUNT_PROSE_RE)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 100) {
      countTargets.push({ count: n, noun: m[2].toLowerCase(), source: 'spec/notes' });
    }
  }

  // 2. Negative assertions & exact count assertions in the task's OWN frozen acceptance tests
  for (const { file, text } of ownFrozenTexts) {
    const clean = stripCommentsPreserveLines(text);
    // `.not.toContain('plain')`, `.not.toHaveClass('plain')`, `.not.toMatch(/\.plain/)`
    for (const m of clean.matchAll(/\.not\.(?:toContain|toHaveClass|toHaveText|toContainText)\(\s*['"`]([^'"`]{3,60})['"`]\s*\)/g)) {
      addRemoved(m[1], file);
    }
    for (const m of clean.matchAll(/\.not\.toHaveAttribute\(\s*['"`]([\w-]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
      addRemoved(`${m[1]}="${m[2]}"`, file);
      addRemoved(m[2], file);
    }
    for (const m of clean.matchAll(/\.not\.toMatch\(\s*\/\\?(\.[A-Za-z_-][\w-]{2,})\\b?\//g)) {
      addRemoved(m[1], file);
    }
    // `queryByText('main') ... .toBeNull()` or `locator('...').toHaveCount(0)` or `expect(chip).not.toBeVisible()`
    for (const m of clean.matchAll(/(?:queryByText|getByText|locator)\(\s*['"`]([^'"`]{3,60})['"`]\s*\)[^\n]{0,80}?(?:\.toBeNull\(\)|\.toHaveCount\(\s*0\s*\)|\.not\.toBeVisible\(\)|\.not\.toBeInTheDocument\(\))/g)) {
      addRemoved(m[1], file);
    }
    // Exact count in task's frozen test: `expect(sections).toHaveLength(9)` or `.toHaveCount(9)`
    for (const m of clean.matchAll(/expect\(([^)\n]{1,100})\)\s*\.\s*(?:toHaveLength|toHaveCount)\(\s*(\d{1,3})\s*\)/g)) {
      const expr = m[1].toLowerCase();
      const n = Number(m[2]);
      if (Number.isInteger(n) && n >= 1 && n <= 100 && /(section|sec|nav|row|tab|item|menu|group)/.test(expr)) {
        countTargets.push({ count: n, noun: expr.trim(), source: file });
      }
    }
  }

  return {
    removedTokens: [...removedTokens.values()],
    countTargets,
  };
}

function isNegativeAssertionLine(line) {
  return /\.not\b|toBeNull\s*\(|toBeFalsy\s*\(|toHaveCount\s*\(\s*0\s*\)|toHaveLength\s*\(\s*0\s*\)|===\s*0\b|===\s*null\b|!\s*\w+\.includes\(/.test(line);
}

function isAssertionOrSelectorContext(windowText) {
  return /\b(?:expect|assert|getBy\w+|findBy\w+|queryBy\w+|locator|querySelector\w*|toHave\w+|toContain\w*|toBe\w*|toEqual|toMatch|data-variant|variant\s*[:=]|className)\b/.test(windowText);
}

function findPositiveTokenConflict(cleanTestText, mut) {
  const lines = cleanTestText.split(/\r?\n/);
  const tok = mut.token;
  const patterns = [];
  if (mut.kind === 'class') {
    // Match `.plain` in string/regex/selector (`'.plain'`, `/\.plain\b/`, `classList.contains('plain')`)
    const bare = escapeRegExp(tok.slice(1));
    patterns.push(new RegExp(`(?:\\\\?\\.${bare}\\b|className[^\\n]*['"\`]${bare}['"\`]|toHaveClass\\(\\s*['"\`]${bare}['"\`])`));
  } else if (mut.kind === 'attr') {
    patterns.push(new RegExp(escapeRegExp(tok)));
  } else {
    const esc = escapeRegExp(tok);
    // Match quoted `'plain'` / `"plain"` / `data-...="plain"` / regex `/\bplain\b/`
    patterns.push(new RegExp(`(?:['"\`=]${esc}['"\`\\]]|/${esc}/)`));
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!patterns.some((re) => re.test(line))) continue;
    const win = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join('\n');
    if (isNegativeAssertionLine(line) || (!isAssertionOrSelectorContext(line) && isNegativeAssertionLine(win))) continue;
    if (!isAssertionOrSelectorContext(win)) continue;
    return { line: i + 1, snippet: line.trim().slice(0, 140) };
  }
  return null;
}

function nounBucket(s) {
  const lower = String(s || '').toLowerCase();
  if (/(nav|seç|sec|section|menu|sidebar|category|categoria)/.test(lower)) return 'nav_section';
  if (/(tab|aba)/.test(lower)) return 'tab';
  if (/(row|linha|item)/.test(lower)) return 'row_item';
  return null;
}

function findCountConflict(cleanTestText, target) {
  const lines = cleanTestText.split(/\r?\n/);
  const K = target.count;
  const targetBucket = nounBucket(target.noun);

  for (let i = 0; i < lines.length; i += 1) {
    const win = lines.slice(i, Math.min(lines.length, i + 3)).join(' ');
    // Match `expect(expr).toBeGreaterThan(M)` / `toBeGreaterThanOrEqual(M)` / `toBeLessThan(M)` / `toBeLessThanOrEqual(M)` starting on line i
    const bound = /\bexpect\s*\(/.test(lines[i])
      ? /expect\(([^)]{1,120})\)\s*\.\s*(toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual)\(\s*(\d{1,4})\s*\)/.exec(win)
      : null;
    if (bound) {
      const expr = bound[1];
      const op = bound[2];
      const M = Number(bound[3]);
      const exprBucket = nounBucket(expr) || nounBucket(lines.slice(Math.max(0, i - 4), i + 1).join(' '));
      if (targetBucket && exprBucket && targetBucket !== exprBucket && !(targetBucket === 'nav_section' && exprBucket === 'row_item')) continue;
      if (!exprBucket) continue;
      const incompatible = (op === 'toBeGreaterThan' && !(K > M))
        || (op === 'toBeGreaterThanOrEqual' && !(K >= M))
        || (op === 'toBeLessThan' && !(K < M))
        || (op === 'toBeLessThanOrEqual' && !(K <= M));
      if (incompatible) {
        return { line: i + 1, expected_by_test: `${op}(${M})`, snippet: lines[i].trim().slice(0, 140) };
      }
    }
    // Also match `assert.ok(rows.length > 10)` or `expect(rows.length > 10).toBe(true)`
    const cmp = /\b([\w$.]+)\.length\s*(>=|>|<=|<|===)\s*(\d{1,4})\b/.exec(lines[i]);
    if (cmp && /\b(expect|assert)\b/.test(win) && !isNegativeAssertionLine(lines[i])) {
      const exprBucket = nounBucket(cmp[1]) || nounBucket(lines.slice(Math.max(0, i - 3), i + 1).join(' '));
      if (!exprBucket) continue;
      if (targetBucket && exprBucket !== targetBucket && !(targetBucket === 'nav_section' && exprBucket === 'row_item')) continue;
      const op = cmp[2];
      const M = Number(cmp[3]);
      const ok = op === '>' ? K > M : op === '>=' ? K >= M : op === '<' ? K < M : op === '<=' ? K <= M : K === M;
      if (!ok) {
        return { line: i + 1, expected_by_test: `length ${op} ${M}`, snippet: lines[i].trim().slice(0, 140) };
      }
    }
  }
  return null;
}

/**
 * G45: Finds existing frozen/acceptance/e2e/out-of-scope tests that render/import/inspect a pending task's touched
 * components or CSS and assert shapes that the task removes, hides, or changes in count.
 */
function crossCardFrozenConflicts(root, planDoc, options = {}) {
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => !isInactiveTask(t));
  if (!tasks.length) return [];

  const allFiles = options.files || si.trackedFiles(root);
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const { byTarget } = options.index || si.importIndex(root, { files: allFiles, readText: read });
  const specCriteriaMap = parseSpecCriteriaText(options.specText || '');
  const accept = (planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []);

  const allTests = allFiles.filter((f) => TEST_RE.test(f) && !/(^|\/)parked[^/]*\//i.test(f));
  if (!allTests.length) return [];

  const cleanTextCache = new Map();
  const cleanOf = (f) => {
    if (!cleanTextCache.has(f)) cleanTextCache.set(f, stripCommentsPreserveLines(read(f)));
    return cleanTextCache.get(f);
  };

  const findings = [];
  const seen = new Set();

  for (const t of tasks) {
    const scope = (t.files || []).map(norm).filter(Boolean);
    if (!scope.length) continue;
    const inScope = (f) => scope.some((s) => testScope.covers(s, f));

    const ownAcceptFiles = new Set(
      accept
        .filter((a) => a && (a.task === t.id || (!a.task && (t.acceptance || []).includes(a.criterion))))
        .flatMap((a) => (a.files || []).map(norm))
        .filter(Boolean)
    );
    const ownFrozenTexts = [...ownAcceptFiles].map((f) => ({ file: f, text: read(f) })).filter((x) => x.text);

    const mutations = extractTaskShapeMutations(t, specCriteriaMap, ownFrozenTexts);
    if (!mutations.removedTokens.length && !mutations.countTargets.length) continue;

    // Identify candidate tests that import, read, or render the task's touched components/CSS
    const candidateTests = new Map(); // testFile -> touchedComponentFile
    for (const [target, importers] of byTarget.entries()) {
      if (!inScope(target)) continue;
      for (const imp of importers) {
        if (!candidateTests.has(imp.test)) candidateTests.set(imp.test, target);
      }
    }

    // Also match CSS / PascalCase component references in acceptance/e2e tests that read CSS or mount via route/app
    const nonTestScope = scope.filter((f) => !TEST_RE.test(f));
    const refTerms = [];
    for (const sf of nonTestScope) {
      const base = path.posix.basename(sf);
      const stem = base.replace(/\.(module\.)?(css|scss|less)$/i, '').replace(/\.[cm]?[jt]sx?$/i, '');
      if (/\.(css|scss|less)$/i.test(base) && base.length >= 6) refTerms.push({ file: sf, needle: base });
      if (/^[A-Z][A-Za-z0-9]{4,}$/.test(stem)) refTerms.push({ file: sf, needle: stem });
    }
    if (refTerms.length) {
      for (const tf of allTests) {
        if (candidateTests.has(tf)) continue;
        const txt = cleanOf(tf);
        const hit = refTerms.find((rt) => txt.includes(rt.needle));
        if (hit) candidateTests.set(tf, hit.file);
      }
    }

    for (const [testFile, touchedFile] of candidateTests.entries()) {
      if (ownAcceptFiles.has(testFile)) continue;
      const isFrozen = FROZEN_DIR_RE.test(testFile);
      // Mutable unit test already inside the task's own `files` can be updated directly by the task — not a cross-card block
      if (inScope(testFile) && !isFrozen) continue;

      const clean = cleanOf(testFile);
      if (!clean) continue;

      for (const mut of mutations.removedTokens) {
        const hit = findPositiveTokenConflict(clean, mut);
        if (!hit) continue;
        const key = `${t.id}\u0000${testFile}:${hit.line}\u0000${mut.token}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          task: t.id,
          component: touchedFile,
          test: testFile,
          line: hit.line,
          kind: 'removed_token',
          token: mut.token,
          source: mut.source,
          snippet: hit.snippet,
          frozen: isFrozen,
        });
      }

      for (const ct of mutations.countTargets) {
        const hit = findCountConflict(clean, ct);
        if (!hit) continue;
        const key = `${t.id}\u0000${testFile}:${hit.line}\u0000count:${ct.count}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          task: t.id,
          component: touchedFile,
          test: testFile,
          line: hit.line,
          kind: 'count_conflict',
          target_count: ct.count,
          expected_by_test: hit.expected_by_test,
          source: ct.source,
          snippet: hit.snippet,
          frozen: isFrozen,
        });
      }
    }
  }

  return findings;
}

function crossCardConflictMessages(findings, { level = 'warn' } = {}) {
  const lines = findings.map((f) => {
    const fix = f.frozen
      ? `abra CR e atualize/reescreva o teste congelado (spec freeze / plan amend-test) antes de rodar ${f.task}`
      : `inclua ${f.test} em files de ${f.task} (plan scope add) ou abra CR se for contrato de outro card`;
    if (f.kind === 'count_conflict') {
      return `${f.task} (${f.component}): define ${f.target_count} (${f.source}), mas ${f.test}:${f.line} afirma \`${f.expected_by_test}\` (\`${f.snippet}\`) — conflito entre cards: ${fix} [G45]`;
    }
    return `${f.task} (${f.component}): remove/esconde \`${f.token}\` (${f.source}), mas ${f.test}:${f.line} afirma \`${f.token}\` (\`${f.snippet}\`) — conflito com teste existente: ${fix} [G45]`;
  });
  return level === 'error' ? { errors: lines, warnings: [] } : { errors: [], warnings: lines };
}

/**
 * Normalizes `config.lint.rate_limits` from either an array of rules or an object map.
 */
function normalizeRateLimitRules(raw) {
  if (!raw) return [];
  const entries = Array.isArray(raw)
    ? raw
    : (typeof raw === 'object'
      ? Object.entries(raw).map(([k, v]) => (typeof v === 'number' ? { tool: k, max_per_min: v } : (v && typeof v === 'object' ? { tool: k, ...v } : null)))
      : []);
  const out = [];
  for (const r of entries) {
    if (!r || typeof r !== 'object') continue;
    const tool = String(r.tool || r.name || r.id || r.pattern || '').trim();
    if (!tool) continue;
    const maxRaw = r.max_per_min ?? r.per_minute ?? r.limit ?? r.max_calls ?? r.max;
    const maxCalls = Number.isFinite(Number(maxRaw)) && Number(maxRaw) > 0 ? Number(maxRaw) : null;
    const requiresApproval = Boolean(r.requires_approval || r.approval === true || r.approval === 'required');
    if (maxCalls == null && !requiresApproval) continue;
    out.push({ tool, max_per_min: maxCalls, requires_approval: requiresApproval });
  }
  return out;
}

function extractLoopBoundsInWindow(windowText) {
  const counts = [];
  const patterns = [
    /Array\.from\(\s*\{\s*length\s*:\s*(\d[\d_]*)\s*\}/g,
    /\bnew\s+Array\(\s*(\d[\d_]*)\s*\)/g,
    /\bArray\(\s*(\d[\d_]*)\s*\)\.fill\b/g,
    /\bfor\s*\([^;\n]*;\s*[\w$]+\s*<=?\s*(\d[\d_]*)\s*;/g,
    /\.repeat\(\s*(\d[\d_]*)\s*\)/g,
    /\btimes\(\s*(\d[\d_]*)\s*,/g,
  ];
  for (const re of patterns) {
    for (const m of windowText.matchAll(re)) {
      const n = Number(String(m[1]).replace(/_/g, ''));
      if (Number.isFinite(n) && n > 1) counts.push(n);
    }
  }
  return counts;
}

function isToolMockedOrApproved(cleanText, tool, windowText) {
  const esc = escapeRegExp(tool);
  const mockRe = new RegExp(`(?:vi|jest)\\.(?:mock|spyOn)[^\\n]*${esc}|${esc}[^\\n]*(?:mockResolvedValue|mockReturnValue|mockImplementation|vi\\.fn|jest\\.fn)`);
  if (mockRe.test(cleanText) || mockRe.test(windowText)) return true;
  if (/\b(?:approve\w*|autoApprove|approval\s*:\s*['"](?:allow|approved|auto)|confirmApproval|grantApproval|mockApproval|bypassApproval)\b/i.test(windowText)) {
    return true;
  }
  return false;
}

/**
 * G46: Scans the plan's frozen/acceptance tests against `config.lint.rate_limits` for:
 *   - loop/batch volumes exceeding `max_per_min` (e.g. 250 calls to `oxequery_read` vs 120/min);
 *   - unmocked calls to tools with `requires_approval: true` (e.g. `oxequery_execute`).
 */
function rateLimitHazards(root, planDoc, options = {}) {
  const rules = normalizeRateLimitRules(options.rules);
  if (!rules.length) return [];

  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const accept = (planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []);
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => !isInactiveTask(t));

  const filesToCheck = new Map(); // file -> ownerLabel
  for (const a of accept) {
    if (!a) continue;
    const label = a.task || a.criterion || 'acceptance';
    for (const f of a.files || []) {
      const p = norm(f);
      if (p && !filesToCheck.has(p)) filesToCheck.set(p, label);
    }
  }
  for (const t of tasks) {
    for (const f of t.files || []) {
      const p = norm(f);
      if (p && TEST_RE.test(p) && !filesToCheck.has(p)) filesToCheck.set(p, t.id);
    }
  }

  const findings = [];
  const seen = new Set();

  for (const [file, owner] of filesToCheck.entries()) {
    const raw = read(file);
    if (!raw) continue;
    const clean = stripCommentsPreserveLines(raw);
    const lines = clean.split(/\r?\n/);

    for (const rule of rules) {
      const toolRe = new RegExp(`\\b${escapeRegExp(rule.tool)}\\b`);
      const hitLines = [];
      for (let i = 0; i < lines.length; i += 1) {
        if (toolRe.test(lines[i])) hitLines.push(i);
      }
      if (!hitLines.length) continue;

      // 1. Volume / rate limit check
      if (rule.max_per_min != null) {
        let worstCount = hitLines.length;
        let worstLine = hitLines[0] + 1;
        for (const idx of hitLines) {
          const win = lines.slice(Math.max(0, idx - 18), Math.min(lines.length, idx + 15)).join('\n');
          if (/\buseFakeTimers\s*\(/.test(clean) || isToolMockedOrApproved(clean, rule.tool, win)) continue;
          const bounds = extractLoopBoundsInWindow(win);
          for (const b of bounds) {
            if (b > worstCount) {
              worstCount = b;
              worstLine = idx + 1;
            }
          }
        }
        if (worstCount > rule.max_per_min) {
          const key = `${file}\u0000${rule.tool}\u0000rate`;
          if (!seen.has(key)) {
            seen.add(key);
            findings.push({
              owner,
              file,
              line: worstLine,
              kind: 'rate_limit',
              tool: rule.tool,
              calls: worstCount,
              max_per_min: rule.max_per_min,
            });
          }
        }
      }

      // 2. Approval-gated tool without mock/approval
      if (rule.requires_approval) {
        for (const idx of hitLines) {
          // Ignore pure string assertions on tool names (`expect(tools).toContain('oxequery_execute')`)
          if (/\bexpect\([^)]*\)\s*\.\s*(?:toContain|toEqual|toMatch|toHaveProperty)\b/.test(lines[idx])) continue;
          const win = lines.slice(Math.max(0, idx - 20), Math.min(lines.length, idx + 20)).join('\n');
          if (isToolMockedOrApproved(clean, rule.tool, win)) continue;
          const key = `${file}\u0000${rule.tool}\u0000approval`;
          if (!seen.has(key)) {
            seen.add(key);
            findings.push({
              owner,
              file,
              line: idx + 1,
              kind: 'requires_approval',
              tool: rule.tool,
            });
          }
          break;
        }
      }
    }
  }

  return findings;
}

function rateLimitMessages(findings, { level = 'warn' } = {}) {
  const lines = findings.map((f) => (
    f.kind === 'rate_limit'
      ? `${f.owner} (${f.file}:${f.line}): chama \`${f.tool}\` ~${f.calls}× num laço, acima do limite declarado em lint.rate_limits (${f.max_per_min}/min) — semear estado direto, usar fake timers/mock ou reduzir o volume abaixo do rate limit [G46]`
      : `${f.owner} (${f.file}:${f.line}): chama \`${f.tool}\` (declarada com requires_approval em lint.rate_limits) sem mock nem aprovação explícita — vai cair em requires_approval durante o teste [G46]`
  ));
  return level === 'error' ? { errors: lines, warnings: [] } : { errors: [], warnings: lines };
}

module.exports = {
  crossCardFrozenConflicts,
  crossCardConflictMessages,
  rateLimitHazards,
  rateLimitMessages,
  normalizeRateLimitRules,
};
