'use strict';

/**
 * OXB-C1 Adendo 2 (OxeSpace 16/11, OQ T1 / OXE-220):
 * File-size cap rules (`scripts/check-file-size.mjs` or `.oxe/config.json` `file_size` / `lint.file_size`)
 * previously ran ONLY at the post-attempt checkpoint (`checkpointCheck`), after a paid executor attempt had already
 * finished (`electron/main/index.ts` hit 1002 > 1000 lines by 2 wiring lines, costing a second paid attempt).
 *
 * This module provides:
 * 1. `detectFileSizePolicy(projectRoot, config)` — detects `scripts/check-file-size.{mjs,cjs,js}` + baseline JSONs
 *    and/or `.oxe/config.json` caps (`defaultLimit`, per-file `overrides`, `warnMarginFor`).
 * 2. `findDelegationTargets(projectRoot, relFile, sourceText, context)` — locates where new wiring/logic should go
 *    instead of bloating the near-limit file (e.g. `registerAgentActivityIpc` imported/called in `index.ts`, declared
 *    in `IMPLEMENTATION-PACK.json`, or exported by a sibling file in `task.files`).
 * 3. `fileSizeHeadroomFindings` / `fileSizeHeadroomMessages` (`[G47]`) + `annotatePlanFileSizeNotes` — warns in
 *    `plan lint` / `plan build` when an in-scope file has <= ~20 lines of headroom and writes the delegation note
 *    idempotently into `task.notes` (and node prompt `lessons`).
 * 4. `verifyTaskFileSize` + CLI (`node oxe-file-size-guard.cjs --verify [--task Tn]`) — runs the exact same file-size
 *    rule during the attempt's `verify` (`applyTaskGatesToGraph`), inside `finish_task`, and in `commit-task` so
 *    oversized files fail immediately and for free before the checkpoint.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_CANDIDATES = [
  'scripts/check-file-size.mjs',
  'scripts/check-file-size.cjs',
  'scripts/check-file-size.js',
];

const BASELINE_CANDIDATES = [
  'scripts/file-size-baseline.json',
  'scripts/check-file-size-baseline.json',
  'scripts/file-size-limits.json',
  '.oxe/file-size-baseline.json',
];

const CODE_FILE_RE = /\.(?:[cm]?[jt]sx?|vue|svelte|py|kt|kts|java|rs|go|rb|php|cs|swift|css|scss)$/i;
const TEST_FILE_RE = /(?:^|\/)(?:tests?|__tests__|e2e|cypress|playwright)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const WIRING_SYMBOL_RE = /^(?:register|setup|wire|mount|bind|attach|install|init|configure|bootstrap)[A-Z_]\w*|\w+(?:Ipc|Handlers?|Routes?|Router|Listeners?|Registrar|Bridge|Controller|Service|Plugin)$/;

const STOPWORDS = new Set([
  'src', 'lib', 'app', 'main', 'index', 'renderer', 'electron', 'shared', 'common', 'utils', 'helpers',
  'types', 'models', 'components', 'pages', 'views', 'hooks', 'store', 'state', 'test', 'tests', 'spec',
  'add', 'added', 'adding', 'create', 'update', 'fix', 'remove', 'implement', 'wire', 'wiring', 'task',
  'file', 'files', 'para', 'com', 'sem', 'por', 'uma', 'uns', 'umas', 'dos', 'das', 'nos', 'nas', 'que',
  'novo', 'nova', 'novos', 'novas', 'adicionar', 'adiciona', 'criar', 'cria', 'ajustar', 'implementar',
]);

function norm(p) {
  let s = String(p || '').trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try { s = JSON.parse(s); } catch { s = s.slice(1, -1); }
  }
  return s.replace(/\\/g, '/').replace(/^\.\//, '');
}

function readTextQuiet(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

function readJsonQuiet(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function readMergedConfig(projectRoot, explicitConfig) {
  const base = readJsonQuiet(path.join(projectRoot, 'oxe.config.json'));
  const local = readJsonQuiet(path.join(projectRoot, '.oxe', 'config.json'));
  return {
    ...(base && typeof base === 'object' ? base : {}),
    ...(local && typeof local === 'object' ? local : {}),
    ...(explicitConfig && typeof explicitConfig === 'object' ? explicitConfig : {}),
  };
}

function parseNumericToken(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/_/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function ingestOverridesObject(obj, overrides, exempt) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj.exempt)) {
    for (const item of obj.exempt) if (typeof item === 'string' && item.trim()) exempt.add(norm(item));
  }
  if (Array.isArray(obj.allowlist)) {
    for (const item of obj.allowlist) if (typeof item === 'string' && item.trim()) exempt.add(norm(item));
  }
  const containers = [obj, obj.files, obj.overrides, obj.baseline, obj.limits].filter((x) => x && typeof x === 'object' && !Array.isArray(x));
  for (const mapObj of containers) {
    for (const [k, v] of Object.entries(mapObj)) {
      if (['files', 'overrides', 'baseline', 'limits', 'exempt', 'allowlist', 'max_lines', 'default', 'warn_margin'].includes(k)) continue;
      if (!k.includes('/') && !CODE_FILE_RE.test(k)) continue;
      if (v === false || v === 'exempt') {
        exempt.add(norm(k));
        continue;
      }
      const cap = typeof v === 'number'
        ? parseNumericToken(v)
        : (v && typeof v === 'object' ? parseNumericToken(v.max_lines ?? v.max ?? v.limit ?? v.lines ?? v.cap) : null);
      if (cap) overrides.set(norm(k), cap);
    }
  }
}

function parseScriptPolicyHints(projectRoot, scriptRel, scriptText, overrides, exempt) {
  let defaultLimit = null;
  let lineMode = 'trimmed';

  if (/\.split\([^)]*\)\s*\.filter\(\s*Boolean\s*\)/.test(scriptText)) {
    lineMode = 'non_empty';
  }

  // 1. Referenced JSON baseline files inside the script
  const jsonRefs = new Set(BASELINE_CANDIDATES);
  for (const m of scriptText.matchAll(/['"]([^'"\n]*(?:file-size|size-baseline|size-limit)[^'"\n]*\.json)['"]/gi)) {
    const rawRef = m[1];
    const fromScriptDir = norm(path.join(path.dirname(scriptRel), rawRef));
    jsonRefs.add(norm(rawRef));
    jsonRefs.add(fromScriptDir);
  }
  for (const cand of jsonRefs) {
    const parsed = readJsonQuiet(path.join(projectRoot, cand));
    if (parsed) ingestOverridesObject(parsed, overrides, exempt);
  }

  // 2. Inline per-file caps inside the script (`'electron/main/index.ts': 1000`)
  for (const m of scriptText.matchAll(/['"]([\w./-]+\.(?:[cm]?[jt]sx?|vue|svelte|py|kt|java|rs|go|css|scss))['"]\s*:\s*(\d[\d_]*)/g)) {
    const cap = parseNumericToken(m[2]);
    if (cap) overrides.set(norm(m[1]), cap);
  }

  // 3. Explicit named cap constant (`const MAX_LINES = 1000`)
  const constMatch = /\b(?:MAX_LINES|DEFAULT_MAX_LINES|MAX_FILE_LINES|FILE_SIZE_LIMIT|LINE_LIMIT|HARD_LIMIT|DEFAULT_LIMIT|MAX_SIZE_LINES|LIMIT|CAP)\s*=\s*(\d[\d_]*)/i.exec(scriptText);
  if (constMatch) {
    defaultLimit = parseNumericToken(constMatch[1]);
  }

  // 4. Direct comparison (`if (lines > 1000)` / `if (n > 5)`)
  if (!defaultLimit) {
    const cmpGt = /\b(?:lines|lineCount|numLines|totalLines|count|n)\s*>\s*(\d[\d_]*)/.exec(scriptText);
    if (cmpGt) defaultLimit = parseNumericToken(cmpGt[1]);
  }
  if (!defaultLimit) {
    const cmpGte = /\b(?:lines|lineCount|numLines|totalLines|count|n)\s*>=\s*(\d[\d_]*)/.exec(scriptText);
    if (cmpGte) {
      const v = parseNumericToken(cmpGte[1]);
      if (v && v > 1) defaultLimit = v - 1;
    }
  }

  return { defaultLimit: defaultLimit || 1000, lineMode };
}

function countFileLines(text, lineMode = 'trimmed') {
  const s = String(text ?? '');
  if (!s) return 0;
  if (lineMode === 'non_empty') return s.split(/\r?\n/).filter(Boolean).length;
  return s.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

/**
 * Detects the active file-size policy for `projectRoot`.
 */
function detectFileSizePolicy(projectRoot, explicitConfig) {
  const cfg = readMergedConfig(projectRoot, explicitConfig);
  const lintCfg = cfg.lint && typeof cfg.lint === 'object' ? cfg.lint : {};
  if (cfg.file_size === false || lintCfg.file_size === false) {
    return { enabled: false };
  }
  const fsCfg = (cfg.file_size && typeof cfg.file_size === 'object' ? cfg.file_size : null)
    || (lintCfg.file_size && typeof lintCfg.file_size === 'object' ? lintCfg.file_size : null)
    || {};

  const overrides = new Map();
  const exempt = new Set();

  let scriptRel = null;
  for (const cand of SCRIPT_CANDIDATES) {
    if (fs.existsSync(path.join(projectRoot, cand))) {
      scriptRel = cand;
      break;
    }
  }

  let command = typeof fsCfg.command === 'string' && fsCfg.command.trim()
    ? fsCfg.command.trim()
    : (typeof lintCfg.file_size_command === 'string' && lintCfg.file_size_command.trim() ? lintCfg.file_size_command.trim() : null);

  if (!command && Array.isArray(cfg.integration_checks)) {
    const match = cfg.integration_checks.map((c) => String(c || '').trim()).find((c) => /check-file-size/i.test(c));
    if (match) command = match;
  }
  if (!command && scriptRel && cfg.integration_checks !== false) {
    command = `node ${scriptRel}`;
  }

  let defaultLimit = null;
  let lineMode = 'trimmed';
  if (scriptRel) {
    const scriptText = readTextQuiet(path.join(projectRoot, scriptRel)) || '';
    const parsed = parseScriptPolicyHints(projectRoot, scriptRel, scriptText, overrides, exempt);
    defaultLimit = parsed.defaultLimit;
    lineMode = parsed.lineMode;
  }

  ingestOverridesObject(fsCfg, overrides, exempt);

  const explicitMax = parseNumericToken(
    fsCfg.max_lines ?? fsCfg.limit ?? lintCfg.max_file_lines ?? (typeof cfg.file_size === 'number' ? cfg.file_size : null),
  );
  if (explicitMax) defaultLimit = explicitMax;

  if (!command && !defaultLimit && overrides.size === 0) {
    return { enabled: false };
  }

  const configuredMargin = fsCfg.warn_margin != null
    ? Number(fsCfg.warn_margin)
    : (lintCfg.file_size_warn_margin != null ? Number(lintCfg.file_size_warn_margin) : null);

  const warnMarginFor = (limit) => {
    if (configuredMargin != null && Number.isFinite(configuredMargin) && configuredMargin >= 0) {
      return Math.floor(configuredMargin);
    }
    return limit >= 100 ? 20 : Math.max(1, Math.floor(limit * 0.2));
  };

  const limitFor = (relPath) => {
    const key = norm(relPath);
    if (exempt.has(key)) return null;
    if (overrides.has(key)) return overrides.get(key);
    return defaultLimit || null;
  };

  return {
    enabled: true,
    scriptRel,
    command,
    defaultLimit: defaultLimit || 1000,
    lineMode,
    overrides,
    exempt,
    limitFor,
    warnMarginFor,
  };
}

function extractTaskKeywords(task, packTask, nearFile) {
  const nearNorm = norm(nearFile);
  const chunks = [
    task && task.title,
    String((task && task.notes) || '').replace(/\[limite-tamanho:[^\n]*/g, ''),
    ...(Array.isArray(task && task.files) ? task.files.filter((f) => norm(f) !== nearNorm) : []),
    packTask && packTask.intent,
  ].filter(Boolean);

  const words = new Set();
  for (const chunk of chunks) {
    const expanded = String(chunk)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .toLowerCase();
    for (const tok of expanded.split(/\s+/)) {
      if (tok.length >= 3 && !STOPWORDS.has(tok) && !/^\d+$/.test(tok)) {
        words.add(tok);
      }
    }
  }
  return words;
}

function resolveLocalModule(projectRoot, fromFile, specifier) {
  if (!specifier || !specifier.startsWith('.')) return null;
  const baseAbs = path.resolve(projectRoot, path.dirname(fromFile), specifier);
  const candidates = [
    baseAbs,
    `${baseAbs}.ts`,
    `${baseAbs}.tsx`,
    `${baseAbs}.js`,
    `${baseAbs}.cjs`,
    `${baseAbs}.mjs`,
    path.join(baseAbs, 'index.ts'),
    path.join(baseAbs, 'index.js'),
  ];
  for (const abs of candidates) {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const rel = norm(path.relative(projectRoot, abs));
      if (!rel.startsWith('..')) return rel;
    }
  }
  const guessed = norm(path.relative(projectRoot, /\.[a-z0-9]+$/i.test(baseAbs) ? baseAbs : `${baseAbs}.ts`));
  return guessed.startsWith('..') ? null : guessed;
}

function extractExportedHelpers(sourceText) {
  const out = [];
  const src = String(sourceText || '');
  for (const m of src.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)) {
    out.push(m[1]);
  }
  const cjs = /\bmodule\.exports\s*=\s*\{([^}]+)\}/.exec(src);
  if (cjs) {
    for (const m of cjs[1].matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) out.push(m[1]);
  }
  return [...new Set(out)];
}

function collectPackSymbolsForFile(packTask) {
  const pairs = [];
  if (!packTask || typeof packTask !== 'object') return pairs;
  for (const c of Array.isArray(packTask.contracts) ? packTask.contracts : []) {
    const file = c && c.file ? norm(c.file) : null;
    for (const sym of Array.isArray(c && c.symbols) ? c.symbols : []) {
      const name = typeof sym === 'string' ? sym : (sym && (sym.name || sym.symbol));
      if (name) pairs.push({ symbol: String(name).trim(), file });
    }
    if (c && (c.symbol || c.name)) {
      pairs.push({ symbol: String(c.symbol || c.name).trim(), file });
    }
  }
  for (const sym of Array.isArray(packTask.symbols) ? packTask.symbols : []) {
    if (typeof sym === 'string') pairs.push({ symbol: sym.trim(), file: null });
    else if (sym && (sym.name || sym.symbol)) pairs.push({ symbol: String(sym.name || sym.symbol).trim(), file: sym.file ? norm(sym.file) : null });
  }
  return pairs;
}

/**
 * Finds the most relevant delegation target(s) (functions/modules) where wiring or new logic should live
 * instead of adding lines to `relFile`.
 */
function findDelegationTargets(projectRoot, relFile, sourceText, context = {}) {
  const nearNorm = norm(relFile);
  const task = context.task || {};
  const packTask = context.packTask || null;
  const policy = context.policy || null;
  const taskFiles = new Set(
    [...(Array.isArray(task.files) ? task.files : []), ...(Array.isArray(packTask && packTask.exact_paths) ? packTask.exact_paths : [])]
      .map(norm)
      .filter(Boolean),
  );
  const keywords = extractTaskKeywords(task, packTask, nearNorm);
  const candidates = new Map();

  const scoreWords = (text) => {
    if (!text || !keywords.size) return 0;
    const expanded = String(text)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .toLowerCase();
    let hits = 0;
    for (const tok of new Set(expanded.split(/\s+/))) {
      if (keywords.has(tok)) hits += 1;
    }
    return hits;
  };

  const isTargetFileOversized = (file) => {
    if (!file || file === nearNorm) return true;
    if (!policy || !policy.enabled) return false;
    const text = readTextQuiet(path.join(projectRoot, file));
    if (text == null) return false;
    const cap = policy.limitFor(file);
    if (!cap) return false;
    return cap - countFileLines(text, policy.lineMode) <= policy.warnMarginFor(cap);
  };

  const addCandidate = ({ symbol, file, inScope, fromPack }) => {
    const cleanSym = symbol ? String(symbol).trim() : null;
    const cleanFile = file ? norm(file) : null;
    if (cleanFile === nearNorm && !cleanSym) return;
    if (cleanFile && TEST_FILE_RE.test(cleanFile)) return;
    if (cleanFile && cleanFile !== nearNorm && isTargetFileOversized(cleanFile)) return;
    const key = `${cleanSym || ''}::${cleanFile || ''}`;
    const kwHits = scoreWords(`${cleanSym || ''} ${cleanFile || ''}`);
    const isWiring = cleanSym ? WIRING_SYMBOL_RE.test(cleanSym) : false;
    let score = kwHits * 35;
    if (fromPack) score += 60;
    if (inScope) score += 40;
    if (isWiring) score += 30;
    if (cleanSym && cleanFile && cleanFile !== nearNorm) score += 15;
    const prev = candidates.get(key);
    if (!prev || score > prev.score) {
      candidates.set(key, {
        symbol: cleanSym,
        file: cleanFile && cleanFile !== nearNorm ? cleanFile : null,
        inScope: Boolean(inScope || (cleanFile && taskFiles.has(cleanFile))),
        kwHits,
        isWiring,
        score,
      });
    }
  };

  // 1. Symbols declared in IMPLEMENTATION-PACK for sibling files of this task
  for (const p of collectPackSymbolsForFile(packTask)) {
    if (p.file === nearNorm) continue;
    addCandidate({ symbol: p.symbol, file: p.file, inScope: !p.file || taskFiles.has(p.file), fromPack: true });
  }

  // 2. Sibling code files in `task.files`
  for (const sib of taskFiles) {
    if (sib === nearNorm || !CODE_FILE_RE.test(sib) || TEST_FILE_RE.test(sib)) continue;
    const sibText = readTextQuiet(path.join(projectRoot, sib));
    if (sibText != null) {
      const exports = extractExportedHelpers(sibText);
      const wiringExports = exports.filter((e) => WIRING_SYMBOL_RE.test(e));
      for (const exp of (wiringExports.length ? wiringExports : exports.slice(0, 3))) {
        addCandidate({ symbol: exp, file: sib, inScope: true, fromPack: false });
      }
    }
    addCandidate({ symbol: null, file: sib, inScope: true, fromPack: false });
  }

  // 3. Imports & registration calls inside `nearFile` itself (`electron/main/index.ts`)
  const src = String(sourceText || '');
  for (const m of src.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    const targetFile = resolveLocalModule(projectRoot, nearNorm, spec);
    for (const part of m[1].split(',')) {
      const cleaned = part.replace(/\btype\s+/, '').trim();
      if (!cleaned) continue;
      const ident = cleaned.split(/\s+as\s+/)[0].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(ident)) continue;
      if (WIRING_SYMBOL_RE.test(ident) || (targetFile && /(?:^|\/)(?:ipc|handlers?|routes?|register|wiring)(?:\/|-|\.)/i.test(targetFile))) {
        addCandidate({ symbol: ident, file: targetFile, inScope: Boolean(targetFile && taskFiles.has(targetFile)), fromPack: false });
      }
    }
  }
  for (const m of src.matchAll(/\bconst\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[2];
    const targetFile = resolveLocalModule(projectRoot, nearNorm, spec);
    for (const part of m[1].split(',')) {
      const ident = part.split(':')[0].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(ident)) continue;
      if (WIRING_SYMBOL_RE.test(ident) || (targetFile && /(?:^|\/)(?:ipc|handlers?|routes?|register|wiring)(?:\/|-|\.)/i.test(targetFile))) {
        addCandidate({ symbol: ident, file: targetFile, inScope: Boolean(targetFile && taskFiles.has(targetFile)), fromPack: false });
      }
    }
  }
  for (const m of src.matchAll(/\b((?:register|setup|wire|mount|bind|attach|install)[A-Z][\w$]*)\s*\(/g)) {
    const ident = m[1];
    const alreadyHasWithFile = [...candidates.values()].some((c) => c.symbol === ident && c.file);
    if (!alreadyHasWithFile) {
      addCandidate({ symbol: ident, file: null, inScope: false, fromPack: false });
    }
  }

  // 4. Frozen acceptance tests for this task mentioning `register*` / `*Ipc`
  for (const at of Array.isArray(context.acceptanceTests) ? context.acceptanceTests : []) {
    if (!at) continue;
    const ownsAt = (at.task && String(at.task).toUpperCase() === String(task.id || '').toUpperCase())
      || (!at.task && Array.isArray(task.acceptance) && task.acceptance.includes(at.criterion));
    if (!ownsAt) continue;
    for (const tf of Array.isArray(at.files) ? at.files : []) {
      const tfText = readTextQuiet(path.join(projectRoot, norm(tf)));
      if (!tfText) continue;
      for (const m of tfText.matchAll(/\b((?:register|setup|wire|mount)[A-Z][\w$]*|\w+Ipc)\b/g)) {
        addCandidate({ symbol: m[1], file: null, inScope: false, fromPack: true });
      }
    }
  }

  const sorted = [...candidates.values()]
    .filter((c) => c.score > 0 || c.inScope || c.isWiring)
    .sort((a, b) => b.score - a.score || String(a.symbol || a.file).localeCompare(String(b.symbol || b.file)));

  // Deduplicate by symbol (preferring entries with file) and take top 2
  const picked = [];
  const seenSyms = new Set();
  const seenFiles = new Set();
  for (const c of sorted) {
    if (c.symbol && seenSyms.has(c.symbol)) continue;
    if (!c.symbol && c.file && seenFiles.has(c.file)) continue;
    if (c.symbol) seenSyms.add(c.symbol);
    if (c.file) seenFiles.add(c.file);
    picked.push(c);
    if (picked.length >= 2) break;
  }

  return picked;
}

function formatDelegationHint(targets) {
  if (!targets || !targets.length) {
    return 'módulo/helper dedicado (ex.: função `register*` / `setup*` fora do arquivo no limite)';
  }
  return targets
    .map((t) => {
      if (t.symbol && t.file) {
        return t.inScope ? `${t.symbol} (${t.file})` : `${t.symbol} (ver ${t.file})`;
      }
      if (t.symbol) return t.symbol;
      return t.inScope ? t.file : `ver ${t.file}`;
    })
    .join(' / ');
}

function buildFileSizeTaskNote(finding) {
  const targetText = formatDelegationHint(finding.delegation_targets);
  const statusDesc = finding.headroom < 0
    ? `${finding.lines}/${finding.limit} linhas (${Math.abs(finding.headroom)} acima do teto)`
    : `${finding.lines}/${finding.limit} linhas (folga: ${finding.headroom})`;
  return `[limite-tamanho: ${finding.file}] ${statusDesc} — coloque a ligação/lógica nova em ${targetText} e mantenha ${finding.file} <= ${finding.limit} linhas.`;
}

/**
 * Scans all pending tasks in `planDoc` and returns headroom findings (`<= warn_margin` lines from cap, or already over).
 */
function fileSizeHeadroomFindings(projectRoot, planDoc, options = {}) {
  const policy = options.policy || detectFileSizePolicy(projectRoot, options.config);
  if (!policy || !policy.enabled || !planDoc || !Array.isArray(planDoc.tasks)) return [];
  const packTasks = options.pack && Array.isArray(options.pack.tasks) ? options.pack.tasks : [];
  const acceptanceTests = Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : [];
  const findings = [];

  for (const task of planDoc.tasks) {
    if (!task || task.done === true || task.status === 'superseded' || task.merged_into) continue;
    if (['verify_only', 'external_delivery'].includes(task.kind)) continue;
    const packTask = packTasks.find((pt) => String((pt && (pt.id || pt.task_id)) || '').trim() === task.id) || null;
    const removedSet = new Set([...(task.removed_paths || []), ...((packTask && packTask.removed_paths) || [])].map(norm));
    const scopeFiles = [...new Set([...(task.files || []), ...((packTask && packTask.exact_paths) || [])].map(norm).filter(Boolean))];

    for (const relFile of scopeFiles) {
      if (removedSet.has(relFile) || relFile.includes('*') || !CODE_FILE_RE.test(relFile)) continue;
      const limit = policy.limitFor(relFile);
      if (!limit) continue;
      const sourceText = readTextQuiet(path.join(projectRoot, relFile));
      if (sourceText == null) continue;
      const lines = countFileLines(sourceText, policy.lineMode);
      const warnMargin = policy.warnMarginFor(limit);
      const headroom = limit - lines;
      if (headroom > warnMargin) continue;

      const delegationTargets = findDelegationTargets(projectRoot, relFile, sourceText, {
        task,
        packTask,
        policy,
        acceptanceTests,
      });
      const finding = {
        task: task.id,
        file: relFile,
        lines,
        limit,
        headroom,
        warn_margin: warnMargin,
        delegation_targets: delegationTargets.map((t) => ({
          symbol: t.symbol || null,
          file: t.file || null,
          in_scope: Boolean(t.inScope),
        })),
      };
      finding.note = buildFileSizeTaskNote(finding);
      findings.push(finding);
    }
  }

  return findings;
}

function fileSizeHeadroomMessages(findings, options = {}) {
  const level = options.level === 'error' ? 'error' : 'warn';
  const list = (findings || []).map((f) => {
    const targetText = formatDelegationHint(
      (f.delegation_targets || []).map((t) => ({ symbol: t.symbol, file: t.file, inScope: t.in_scope })),
    );
    const gapDesc = f.headroom < 0
      ? `já está acima do limite (${f.lines}/${f.limit} linhas)`
      : `está a ${f.headroom} linha(s) do limite (${f.lines}/${f.limit} linhas, alerta <= ${f.warn_margin})`;
    const scopeHint = (f.delegation_targets || []).some((t) => t.file && !t.in_scope)
      ? ` (se precisar editar ${(f.delegation_targets.find((t) => t.file && !t.in_scope) || {}).file}, inclua-o em ${f.task}.files)`
      : '';
    return `${f.task}: [G47] ${f.file} ${gapDesc} — coloque a ligação/lógica nova em ${targetText}${scopeHint} para não reprovar por tamanho`;
  });
  return {
    errors: level === 'error' ? list : [],
    warnings: level === 'error' ? [] : list,
  };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Idempotently enriches `task.notes` in `planDoc` with `[limite-tamanho: <file>] ...` for every headroom finding.
 */
function annotatePlanFileSizeNotes(projectRoot, planDoc, options = {}) {
  const findings = options.findings || fileSizeHeadroomFindings(projectRoot, planDoc, options);
  if (!findings.length || !planDoc || !Array.isArray(planDoc.tasks)) {
    return { findings, updatedTasks: [] };
  }
  const byTask = new Map();
  for (const f of findings) {
    if (!byTask.has(f.task)) byTask.set(f.task, []);
    byTask.get(f.task).push(f);
  }

  const updatedTasks = [];
  for (const task of planDoc.tasks) {
    const list = task && byTask.get(task.id);
    if (!list || !list.length) continue;
    let nextNotes = typeof task.notes === 'string' ? task.notes : '';
    let changed = false;
    for (const f of list) {
      const markerRe = new RegExp(`^\\[limite-tamanho:\\s*${escapeRegExp(f.file)}\\][^\\r\\n]*$`, 'm');
      if (markerRe.test(nextNotes)) {
        const replaced = nextNotes.replace(markerRe, f.note);
        if (replaced !== nextNotes) {
          nextNotes = replaced;
          changed = true;
        }
      } else {
        nextNotes = nextNotes.trim() ? `${nextNotes.replace(/\s+$/, '')}\n${f.note}` : f.note;
        changed = true;
      }
    }
    if (changed) {
      task.notes = nextNotes;
      updatedTasks.push(task.id);
    }
  }

  return { findings, updatedTasks };
}

/**
 * Lesson lines injected into `buildNodeContextProvider` for the executor prompt.
 */
function fileSizeLessons(projectRoot, config, task, packTask) {
  if (!task || !Array.isArray(task.files) || !task.files.length) return [];
  const findings = fileSizeHeadroomFindings(
    projectRoot,
    { tasks: [{ ...task, done: false }] },
    { config, pack: packTask ? { tasks: [packTask] } : null },
  );
  return findings.map((f) => `Limite de tamanho: ${f.note}`);
}

function workingTreeDirtyPaths(root) {
  try {
    const res = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    if (res.status !== 0 || !res.stdout) return [];
    const out = new Set();
    for (const raw of res.stdout.split(/\r?\n/)) {
      if (raw.length < 4) continue;
      const body = raw.slice(3).trim();
      const target = body.includes(' -> ') ? body.split(' -> ').pop() : body;
      const p = norm(target);
      if (p && !p.startsWith('.oxe/')) out.add(p);
    }
    return [...out];
  } catch {
    return [];
  }
}

function gitHasAtHead(root, relFile) {
  const res = spawnSync('git', ['cat-file', '-e', `HEAD:${norm(relFile)}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return res.status === 0;
}

function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/**
 * Runs the checkpoint's exact file-size rule (`scripts/check-file-size.mjs` and/or configured `file_size` cap)
 * against the current working tree, exempting pre-existing out-of-scope red files (parity with `integrationRedIsPreexisting`).
 */
function verifyTaskFileSize(projectRoot, options = {}) {
  const cfg = readMergedConfig(options.configRoot || projectRoot, options.config);
  if (cfg.integration_checks === false || cfg.verify_file_size === false) {
    return { ok: true, skipped: true, violations: [] };
  }
  const policy = options.policy || detectFileSizePolicy(projectRoot, cfg);
  if (!policy || !policy.enabled) {
    return { ok: true, skipped: true, violations: [] };
  }

  const dirtyPaths = options.dirtyPaths ? options.dirtyPaths.map(norm) : workingTreeDirtyPaths(projectRoot);
  const taskFiles = Array.isArray(options.scope) ? options.scope.map(norm).filter(Boolean) : [];
  const relevantSet = new Set([...dirtyPaths, ...taskFiles]);

  if (options.changedOnly && dirtyPaths.length === 0) {
    return { ok: true, skipped: false, violations: [] };
  }

  // 1. Run the repo's exact file-size check script when present
  if (policy.command) {
    const run = options.spawn || spawnSync;
    const r = run(policy.command, {
      cwd: projectRoot,
      shell: true,
      encoding: 'utf8',
      windowsHide: true,
      env: childEnv(),
      timeout: options.timeoutMs || 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const exit = r && typeof r.status === 'number' ? r.status : null;
    if (exit !== 0) {
      const combined = `${(r && r.stdout) || ''}\n${(r && r.stderr) || ''}`.trim();
      const combinedNorm = combined.replace(/\\/g, '/');
      const tail = combined.split(/\r?\n/).slice(-10).join('\n');

      const scriptModifiedOrAdded = policy.scriptRel
        ? (dirtyPaths.includes(norm(policy.scriptRel)) || !gitHasAtHead(projectRoot, policy.scriptRel))
        : false;
      const pkgModified = dirtyPaths.some((p) => p === 'package.json' || p.endsWith('/package.json') || /lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/.test(p));
      const namedRelevant = [...relevantSet].filter((f) => f && combinedNorm.includes(f));
      const overCapDirty = dirtyPaths.filter((f) => {
        if (!CODE_FILE_RE.test(f)) return false;
        const cap = policy.limitFor(f);
        const txt = readTextQuiet(path.join(projectRoot, f));
        return Boolean(cap && txt != null && countFileLines(txt, policy.lineMode) > cap);
      });

      // Parity with `integrationRedIsPreexisting` (R29/R32): if the script already existed on HEAD, was not modified,
      // and neither names any touched/in-scope file nor has any dirty file over cap, do not block unrelated tasks.
      if (!scriptModifiedOrAdded && !pkgModified && namedRelevant.length === 0 && overCapDirty.length === 0 && dirtyPaths.length > 0) {
        // Double-check at least one path is named in combined output (so silent generic errors don't slip if dirty files grew)
        const namesSomeOtherFile = /[\w./-]+\.(?:[cm]?[jt]sx?|vue|svelte|py|kt|java|rs|go|css|scss)\b/.test(combinedNorm);
        if (namesSomeOtherFile) {
          return { ok: true, preexisting: true, command: policy.command, tail, violations: [] };
        }
      }

      const culpritFiles = [...new Set([...namedRelevant, ...overCapDirty])];
      const hints = culpritFiles.map((f) => {
        const src = readTextQuiet(path.join(projectRoot, f)) || '';
        const targets = findDelegationTargets(projectRoot, f, src, {
          task: options.task || { files: taskFiles },
          packTask: options.packTask || null,
          policy,
        });
        return `${f} -> delegue ligação/lógica para ${formatDelegationHint(targets)}`;
      });
      return {
        ok: false,
        command: policy.command,
        tail,
        violations: culpritFiles,
        hint: hints.join('; ') || null,
        message: `regra de tamanho de arquivo reprovou (${policy.command}):\n${tail}${hints.length ? `\nDica: ${hints.join('; ')}` : ''}`,
      };
    }
  }

  // 2. Also enforce explicit config `file_size` / `max_file_lines` caps (even when no script exists, or stricter override)
  const checkCandidates = dirtyPaths.length ? dirtyPaths : taskFiles;
  const violations = [];
  for (const rel of checkCandidates) {
    if (!CODE_FILE_RE.test(rel)) continue;
    const limit = policy.limitFor(rel);
    if (!limit) continue;
    // When `policy.command` already ran and passed, only check explicit config overrides (avoid disagreeing with script's own baseline)
    if (policy.command && !policy.overrides.has(rel) && !(cfg.file_size || (cfg.lint && cfg.lint.max_file_lines))) continue;
    const txt = readTextQuiet(path.join(projectRoot, rel));
    if (txt == null) continue;
    const lines = countFileLines(txt, policy.lineMode);
    if (lines > limit) {
      const targets = findDelegationTargets(projectRoot, rel, txt, {
        task: options.task || { files: taskFiles },
        packTask: options.packTask || null,
        policy,
      });
      violations.push({
        file: rel,
        lines,
        limit,
        delegation: formatDelegationHint(targets),
      });
    }
  }

  if (violations.length) {
    const detail = violations.map((v) => `${v.file}: ${v.lines} > ${v.limit} linhas (delegue para ${v.delegation})`).join('\n');
    return {
      ok: false,
      command: policy.command || 'config.file_size',
      tail: detail,
      violations: violations.map((v) => v.file),
      message: `regra de tamanho de arquivo reprovou:\n${detail}`,
    };
  }

  return { ok: true, command: policy.command || 'config.file_size', violations: [] };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  const root = path.resolve(arg('--root') || process.cwd());
  const taskId = arg('--task');
  const explicitPlan = arg('--plan');
  let task = null;
  let packTask = null;
  let scope = [];
  if (taskId) {
    const planFile = explicitPlan ? path.resolve(root, explicitPlan) : path.join(root, '.oxe', 'PLAN.json');
    const planDir = path.dirname(planFile);
    const planDoc = readJsonQuiet(planFile);
    task = planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks.find((x) => x && x.id === taskId) : null;
    scope = task && Array.isArray(task.files) ? task.files.map(norm).filter((p) => p && !p.includes('*')) : [];
    const packDoc = readJsonQuiet(path.join(planDir, 'IMPLEMENTATION-PACK.json'));
    packTask = packDoc && Array.isArray(packDoc.tasks)
      ? packDoc.tasks.find((x) => String((x && (x.id || x.task_id)) || '').trim() === taskId)
      : null;
  }
  const res = verifyTaskFileSize(root, { task, packTask, scope });
  if (!res.ok) {
    console.error(`oxe file-size-guard: ${res.message}`);
    process.exit(1);
  }
  console.log('oxe file-size-guard: ok');
}

module.exports = {
  detectFileSizePolicy,
  countFileLines,
  findDelegationTargets,
  formatDelegationHint,
  buildFileSizeTaskNote,
  fileSizeHeadroomFindings,
  fileSizeHeadroomMessages,
  annotatePlanFileSizeNotes,
  fileSizeLessons,
  verifyTaskFileSize,
};
