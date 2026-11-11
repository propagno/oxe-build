'use strict';

/**
 * OXB-097: `oxe-cc plan build --from <role files…>` writes PLAN.json, PLAN.md and IMPLEMENTATION-PACK.json together.
 *   - covers `plan merge` (OXB-086) and then: waves also by file overlap (a hot file — written by two tasks of the same
 *     wave — serializes: the later task moves to the next wave), acceptance test files out of the task scopes;
 *   - pack symbols from the named imports of the frozen tests that resolve to a task's files, and from the role's
 *     `deleted` / `edited` / `created` paths; contracts from the symbols; the pack and PLAN.md carry the `phase`.
 * OXB-098: `oxe-cc plan check-role <file> [--ref <git ref>]` — what the agents run BEFORE handing a plan to the TL:
 *   exact titles of `proves` in the frozen test files, prose × A ids, `deleted`/`edited` paths existing at the ref,
 *   `created` paths not existing there, the verify shape.
 * OXB-106: declarative task kinds with their own pack rule — `add` (only created paths), `remove` (OXB-088:
 *   removed_paths, no symbols), `move` (`moves: [{from, to}]`), `test-only` (only test files, no product code),
 *   `config-only` (only config files, no symbols).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const merge = require('./oxe-plan-merge.cjs');

const TEST_FILE_RE = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const NON_PROD_DIR_RE = /^(scripts|docs|roles|benchmarks|examples|fixtures|\.oxe|\.git|node_modules|dist|build|coverage)\//i;
const CONFIG_FILE_RE = /\.(json|ya?ml|toml|ini|env|cfg|conf|properties)$|(^|\/)\.[a-z]+rc(\.[a-z]+)?$|(^|\/)(Dockerfile|Makefile)$/i;
const CODE_RE = /\.(c|m)?[jt]sx?$|\.(py|go|rs|java|kt|kts|swift|rb|cs|cpp|c|h|php|scala|vue|svelte)$/i;
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte'];
const KINDS = new Set(['add', 'remove', 'move', 'test-only', 'config-only']);
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

function inScope(file, scope) {
  const f = norm(file);
  for (const raw of scope || []) {
    const s = norm(raw);
    if (!s) continue;
    if (/[*?[{]/.test(s)) {
      const re = new RegExp(`^${s.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*')}$`);
      if (re.test(f)) return true;
    } else {
      const clean = s.replace(/\/+$/, '');
      if (f === clean || f.startsWith(`${clean}/`)) return true;
    }
  }
  return false;
}

function isDirEntry(root, ref, entryPath) {
  const raw = String(entryPath || '').trim();
  if (raw.endsWith('/') || raw.endsWith('/**')) return true;
  const cleaned = norm(raw).replace(/(\/\*\*|\/)+$/, '');
  if (!cleaned) return false;
  try {
    const typeRes = spawnSync('git', ['cat-file', '-t', `${ref || 'HEAD'}:${cleaned}`], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (typeRes.status === 0 && typeRes.stdout.trim() === 'tree') return true;
  } catch { /* check disk */ }
  try {
    const abs = path.resolve(root, cleaned);
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function expandDirEntry(root, ref, entryPath) {
  const cleaned = norm(entryPath).replace(/(\/\*\*|\/)+$/, '');
  const out = [];
  try {
    const gitRes = spawnSync('git', ['ls-tree', '-r', '--name-only', ref || 'HEAD', cleaned], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (gitRes.status === 0 && gitRes.stdout && gitRes.stdout.trim()) {
      for (const line of gitRes.stdout.trim().split(/\r?\n/)) {
        const p = norm(line);
        if (p) out.push(p);
      }
    }
  } catch { /* check disk */ }
  if (!out.length) {
    const abs = path.resolve(root, cleaned);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        const walk = (d) => {
          for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, ent.name);
            if (ent.isDirectory()) walk(full);
            else if (ent.isFile()) out.push(norm(path.relative(root, full)));
          }
        };
        walk(abs);
      }
    } catch { /* ignore */ }
  }
  return uniq(out);
}

function filterDeletedFromVerifyCommand(cmd, deletedSet) {
  if (!cmd || typeof cmd !== 'string') return null;
  const segments = cmd.split(/\s+&&\s+/);
  const keptSegments = [];
  for (const seg of segments) {
    const tokens = seg.split(/\s+/);
    const matchingDeleted = tokens.filter((tok) => {
      const cleanTok = norm(tok.replace(/^["']|["']$/g, ''));
      return deletedSet.has(cleanTok);
    });
    if (!matchingDeleted.length) {
      keptSegments.push(seg);
      continue;
    }
    const remainingTokens = tokens.filter((tok) => {
      const cleanTok = norm(tok.replace(/^["']|["']$/g, ''));
      return !deletedSet.has(cleanTok);
    });
    const hasRemainingTestFile = remainingTokens.some((tok) => TEST_FILE_RE.test(norm(tok.replace(/^["']|["']$/g, ''))));
    if (hasRemainingTestFile) {
      keptSegments.push(remainingTokens.join(' '));
    }
  }
  return keptSegments.length ? keptSegments.join(' && ') : null;
}

function transitiveDeletedForTask(task, allTasksById, roleByKey) {
  const deleted = new Set();
  const visited = new Set();
  const queue = [task.id];
  while (queue.length) {
    const curId = queue.shift();
    if (visited.has(curId)) continue;
    visited.add(curId);
    const curTask = allTasksById.get(curId);
    const r = roleByKey.get(String(curTask && curTask.rid ? curTask.rid : curId)) || {};
    for (const p of r.deleted || []) deleted.add(norm(p));
    if (curTask && Array.isArray(curTask.removed_paths)) {
      for (const p of curTask.removed_paths) deleted.add(norm(p));
    }
    const deps = curTask ? (curTask.depends_on || curTask.dependsOn || []) : [];
    for (const d of deps) queue.push(d);
  }
  return deleted;
}

const OFFER_AUDIT_FILE = 'e2e/offer-audit.spec.ts';
const OFFER_AUDIT_TRIGGERS = [
  'src/components/Navigation/appMenus.ts',
  'src/components/Settings/SettingsModal.tsx',
];
const DESIGN_LINT_TESTS = [
  'tests/design-lint.test.ts',
  'tests/design-lint-target-size.test.ts',
];

function hasRepoFile(root, ref, relPath) {
  if (!root) return false;
  const clean = norm(relPath);
  try {
    if (fs.existsSync(path.join(root, clean))) return true;
  } catch { /* check git */ }
  try {
    return spawnSync('git', ['cat-file', '-e', `${ref || 'HEAD'}:${clean}`], { cwd: root, windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

function loadCoupledScope(root, options = {}) {
  let explicit = [];
  let builtinDisabled = options.builtinCoupledScope === false;
  if (Array.isArray(options.coupledScope)) {
    explicit = options.coupledScope;
  } else if (root) {
    try {
      const cfgPath = path.join(root, '.oxe', 'config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (Array.isArray(cfg.coupled_scope)) explicit = cfg.coupled_scope;
        if (cfg.builtin_coupled_scope === false || cfg.coupled_scope === false) builtinDisabled = true;
      }
    } catch { /* ignore */ }
  }
  const rules = [...explicit];
  if (!builtinDisabled && root && (options.includeOfferAudit === true || hasRepoFile(root, options.ref || 'HEAD', OFFER_AUDIT_FILE))) {
    const alreadyCoversOfferAudit = rules.some((r) => {
      const inc = Array.isArray(r && r.include) ? r.include : (r && r.include ? [r.include] : []);
      return inc.map(norm).includes(OFFER_AUDIT_FILE);
    });
    if (!alreadyCoversOfferAudit) {
      rules.push({
        when: OFFER_AUDIT_TRIGGERS,
        include: [OFFER_AUDIT_FILE],
        note: 'confira MENU_EFFECTS em e2e/offer-audit.spec.ts ao editar appMenus.ts ou SettingsModal.tsx',
      });
    }
  }
  return rules;
}

function matchedCoupledRules(coupledRules, changes) {
  const toInclude = [];
  const matchedRules = [];
  const files = changes.files || [];
  const created = changes.created || [];
  const edited = changes.edited || [];
  const deleted = changes.deleted || [];
  const allChanges = [...files, ...created, ...edited, ...deleted];
  for (const rule of coupledRules || []) {
    if (!rule || typeof rule !== 'object') continue;
    const when = rule.when ? (Array.isArray(rule.when) ? rule.when : [rule.when]) : [];
    const whenDeleted = rule.when_deleted ? (Array.isArray(rule.when_deleted) ? rule.when_deleted : [rule.when_deleted]) : [];
    const whenEdited = rule.when_edited ? (Array.isArray(rule.when_edited) ? rule.when_edited : [rule.when_edited]) : [];
    const whenCreated = rule.when_created ? (Array.isArray(rule.when_created) ? rule.when_created : [rule.when_created]) : [];

    const matchWhen = when.some((w) => allChanges.some((p) => inScope(p, [w])));
    const matchDeleted = whenDeleted.some((w) => deleted.some((p) => inScope(p, [w])));
    const matchEdited = whenEdited.some((w) => edited.some((p) => inScope(p, [w])));
    const matchCreated = whenCreated.some((w) => created.some((p) => inScope(p, [w])));

    if (matchWhen || matchDeleted || matchEdited || matchCreated) {
      const inc = Array.isArray(rule.include) ? rule.include : (rule.include ? [rule.include] : []);
      toInclude.push(...inc.map(norm));
      matchedRules.push(rule);
    }
  }
  return { included: uniq(toInclude), matchedRules };
}

function applyCoupledScope(coupledRules, changes) {
  return matchedCoupledRules(coupledRules, changes).included;
}

/** Named imports of a test file that resolve to one of `files`: [{ name, path }]. */
function importedSymbols(root, testFile, files) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, testFile), 'utf8'); } catch { return []; }
  const out = [];
  const dir = path.posix.dirname(norm(testFile));
  const resolve = (spec) => {
    if (!spec.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(dir, spec));
    return files.find((f) => { const n = norm(f); return n === base || n.replace(/\.[^.]+$/, '') === base || n.replace(/\/index\.[^.]+$/, '') === base; }) || null;
  };
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const file = resolve(m[2]);
    if (file) for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) out.push({ name: n, path: norm(file) });
  }
  for (const m of text.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const file = resolve(m[2]);
    if (file) for (const n of m[1].split(',').map((x) => x.trim().split(':')[0].trim()).filter(Boolean)) out.push({ name: n, path: norm(file) });
  }
  return out;
}

/** Waves by dependency AND by file overlap: a task never shares a written file with another task of its wave. */
function assignWaves(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const waveFiles = new Map();
  const wave = new Map();
  for (const t of tasks) {
    let w = Math.max(1, ...(t.depends_on || []).map((d) => (wave.get(d) || 0) + 1));
    const files = (t.files || []).map(norm);
    while ((waveFiles.get(w) || new Set()) && files.some((f) => (waveFiles.get(w) || new Set()).has(f))) w += 1;
    wave.set(t.id, w);
    if (!waveFiles.has(w)) waveFiles.set(w, new Set());
    for (const f of files) waveFiles.get(w).add(f);
  }
  for (const t of tasks) t.wave = wave.get(t.id);
  // dependents of a task moved later must stay after it
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tasks) for (const d of t.depends_on || []) if (byId.has(d) && t.wave <= byId.get(d).wave) { t.wave = byId.get(d).wave + 1; changed = true; }
  }
  return tasks;
}

/** Pack entry by kind (OXB-106). */
function packEntry(root, task, role, frozenFiles, frozenTests) {
  const kind = task.kind && KINDS.has(task.kind) ? task.kind : null;
  const deleted = uniq((role.deleted || []).map(norm));
  const created = uniq((role.created || []).map(norm));
  const edited = uniq((role.edited || []).map(norm));
  const swept = uniq((role.swept || []).map(norm)).filter((f) => !frozenFiles.has(f));
  const moves = Array.isArray(role.moves) ? role.moves.map((m) => ({ from: norm(m.from), to: norm(m.to) })) : [];
  const exact = uniq([...(task.files || []).map(norm), ...deleted, ...created, ...edited, ...moves.flatMap((m) => [m.from, m.to])]).filter((f) => !frozenFiles.has(f));
  const symbols = [];
  for (const t of frozenTests) for (const s of importedSymbols(root, t, exact)) if (!symbols.some((x) => x.name === s.name && x.path === s.path)) symbols.push(s);
  const editedClean = edited.filter((f) => !frozenFiles.has(f));
  const symbolsRemoved = [];
  for (const rt of Array.isArray(role.rawTasks) ? role.rawTasks : []) {
    for (const sr of Array.isArray(rt.symbols_removed) ? rt.symbols_removed : []) {
      if (sr && typeof sr === 'object' && sr.name && sr.path) {
        const entrySr = { name: String(sr.name), path: norm(sr.path) };
        if (!symbolsRemoved.some((x) => x.name === entrySr.name && x.path === entrySr.path)) symbolsRemoved.push(entrySr);
      }
    }
  }
  const entry = {
    id: task.id,
    mode: 'mutating',
    write_set: 'closed',
    exact_paths: exact,
    ...(editedClean.length ? { edited_paths: editedClean } : {}),
    ...(swept.length ? { swept_paths: swept } : {}),
    ...(symbolsRemoved.length ? { symbols_removed: symbolsRemoved } : {}),
    symbols,
    contracts: [],
    expected_checks: (task.verify && task.verify.commands) || [],
    ...(task.phase ? { phase: task.phase } : {}),
  };
  for (const s of symbols) entry.contracts.push(`${s.name} exportado de ${s.path}`);
  if (kind === 'remove' || deleted.length) { entry.removed_paths = uniq([...deleted, ...moves.map((m) => m.from)]); for (const p of entry.removed_paths) entry.contracts.push(`${p} não existe mais`); }
  if (kind === 'move') for (const m of moves) { entry.removed_paths = uniq([...(entry.removed_paths || []), m.from]); entry.contracts.push(`${m.from} movido para ${m.to}`); }
  if (kind === 'add') for (const p of created) entry.contracts.push(`${p} criado`);
  if (kind === 'test-only') entry.contracts.push('só arquivos de teste: nenhum código de produto muda');
  if (kind === 'config-only') entry.contracts.push('só configuração: nenhum código muda');
  if (!entry.contracts.length && edited.length) for (const p of edited) entry.contracts.push(`${p} editado no escopo da tarefa`);
  if (!entry.contracts.length) entry.contracts.push(`escopo fechado: ${exact.slice(0, 4).join(', ')}`);
  return { entry, kind, created, deleted, moves, exact };
}

/** OXB-106: the kind rule — errors when the scope does not fit the declared kind. */
function kindErrors(task, info) {
  const errs = [];
  const f = info.exact;
  if (info.kind === 'test-only' && f.some((p) => !TEST_FILE_RE.test(p))) errs.push(`${task.id} (test-only): ${f.filter((p) => !TEST_FILE_RE.test(p)).join(', ')} não é arquivo de teste`);
  if (info.kind === 'config-only' && f.some((p) => !CONFIG_FILE_RE.test(p))) errs.push(`${task.id} (config-only): ${f.filter((p) => !CONFIG_FILE_RE.test(p)).join(', ')} não é configuração`);
  if (info.kind === 'add' && info.deleted.length) errs.push(`${task.id} (add): declara deleted (${info.deleted.join(', ')}) — use remove ou move`);
  if (info.kind === 'move' && !info.moves.length) errs.push(`${task.id} (move): declare moves: [{ from, to }]`);
  if (info.kind === 'remove' && !info.deleted.length && !(task.files || []).length) errs.push(`${task.id} (remove): declare deleted (os caminhos que deixam de existir)`);
  return errs;
}

function renderPlanMd(plan, phase) {
  const lines = [`# PLAN${phase ? ` — ${phase}` : ''}`, '', `> Gerado por \`oxe-cc plan build\` a partir de ${plan.merged_from.join(', ')}. A fonte é o PLAN.json; este arquivo é a leitura humana.`, ''];
  const waves = [...new Set(plan.tasks.map((t) => t.wave))].sort((a, b) => a - b);
  for (const w of waves) {
    lines.push(`## Onda ${w}`, '');
    for (const t of plan.tasks.filter((x) => x.wave === w)) {
      lines.push(`### ${t.id} — ${t.title}`, '', `- **Arquivos prováveis:** ${(t.files || []).map((f) => `\`${f}\``).join(', ') || '—'}`, `- **Depende de:** ${(t.depends_on || []).join(', ') || '—'}`, `- **Onda:** ${t.wave}`, ...(t.kind ? [`- **Tipo:** ${t.kind}`] : []), '- **Verificar:**', `  - Comando: ${((t.verify && t.verify.commands) || []).map((c) => `\`${c}\``).join(' · ') || '—'}`, `- **Aceite vinculado:** ${(t.acceptance || []).join(', ') || '—'}`, '');
    }
  }
  return lines.join('\n');
}

/** inputs: [{ file, doc }]; ctx: { root, phase, coupledScope, autoCloseImports }. */
function listProductionCodeFiles(root, ref = 'HEAD') {
  const files = [];
  try {
    const gitRes = spawnSync('git', ['ls-tree', '-r', '--name-only', ref || 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (gitRes.status === 0 && gitRes.stdout && gitRes.stdout.trim()) {
      for (const line of gitRes.stdout.trim().split(/\r?\n/)) {
        const p = norm(line);
        if (p && CODE_RE.test(p) && !TEST_FILE_RE.test(p) && !NON_PROD_DIR_RE.test(p)) files.push(p);
      }
      return uniq(files);
    }
  } catch { /* fallback to disk */ }
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.oxe') continue;
      const full = path.join(dir, ent.name);
      const rel = norm(path.relative(root, full));
      if (ent.isDirectory()) {
        if (!NON_PROD_DIR_RE.test(`${rel}/`)) walk(full);
      } else if (ent.isFile() && CODE_RE.test(rel) && !TEST_FILE_RE.test(rel) && !NON_PROD_DIR_RE.test(rel)) {
        files.push(rel);
      }
    }
  };
  walk(root);
  return uniq(files);
}

function readRepoText(root, ref, relPath) {
  const clean = norm(relPath);
  if (!ref || ref === 'HEAD') {
    try {
      const abs = path.join(root, clean);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return fs.readFileSync(abs, 'utf8');
    } catch { /* try git */ }
  }
  try {
    const res = spawnSync('git', ['show', `${ref || 'HEAD'}:${clean}`], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && typeof res.stdout === 'string') return res.stdout;
  } catch { /* ignore */ }
  try {
    return fs.readFileSync(path.join(root, clean), 'utf8');
  } catch {
    return '';
  }
}

function loadPathAliases(root) {
  const aliases = [
    { prefix: '@shared/', target: 'shared/' },
    { prefix: '@electron/', target: 'electron/' },
    { prefix: '@renderer/', target: 'src/' },
    { prefix: '@/', target: 'src/' },
    { prefix: '~/', target: 'src/' },
  ];
  try {
    const tsPath = path.join(root, 'tsconfig.json');
    if (fs.existsSync(tsPath)) {
      const raw = fs.readFileSync(tsPath, 'utf8').replace(/^\s*\/\/.*$/gm, '');
      const parsed = JSON.parse(raw);
      const pathsObj = parsed && parsed.compilerOptions && parsed.compilerOptions.paths;
      if (pathsObj && typeof pathsObj === 'object') {
        const baseUrl = norm((parsed.compilerOptions && parsed.compilerOptions.baseUrl) || '');
        for (const [k, vals] of Object.entries(pathsObj)) {
          if (!Array.isArray(vals) || !vals.length) continue;
          const pref = String(k).replace(/\*$/, '');
          const tgtRaw = norm(String(vals[0]).replace(/\*$/, ''));
          const tgt = baseUrl && baseUrl !== '.' ? norm(path.posix.join(baseUrl, tgtRaw)) : tgtRaw;
          if (pref && !aliases.some((a) => a.prefix === pref)) {
            aliases.unshift({ prefix: pref, target: tgt });
          }
        }
      }
    }
  } catch { /* ignore non-strict jsonc tsconfig */ }
  return aliases;
}

function resolveModuleSpecifier(importerFile, specifier, knownFilesSet, aliases = []) {
  const spec = String(specifier || '').trim();
  if (!spec) return null;
  const bases = [];
  if (spec.startsWith('.')) {
    bases.push(norm(path.posix.normalize(path.posix.join(path.posix.dirname(norm(importerFile)), spec))));
  } else {
    for (const a of aliases) {
      if (spec.startsWith(a.prefix)) {
        bases.push(norm(path.posix.normalize(a.target + spec.slice(a.prefix.length))));
      }
    }
    if (/^(src|electron|shared|resources)\//.test(spec)) {
      bases.push(norm(spec));
    }
  }
  for (const rawBase of bases) {
    const strippedJs = rawBase.replace(/\.(?:[cm]?js|jsx)$/i, '');
    const candidates = uniq([rawBase, strippedJs]);
    for (const b of candidates) {
      if (knownFilesSet.has(b)) return b;
      for (const ext of RESOLVE_EXTS) {
        if (knownFilesSet.has(`${b}${ext}`)) return `${b}${ext}`;
      }
      for (const ext of RESOLVE_EXTS) {
        if (knownFilesSet.has(`${b}/index${ext}`)) return `${b}/index${ext}`;
      }
    }
  }
  return null;
}

function parseNamedClause(clause) {
  const names = [];
  let wildcard = /\*\s+as\s+[A-Za-z_$][\w$]*/.test(clause);
  const braceMatch = clause.match(/\{([^}]+)\}/);
  if (braceMatch) {
    for (const part of braceMatch[1].split(',')) {
      const cleaned = part.replace(/^\s*type\s+/, '').trim();
      if (!cleaned) continue;
      const orig = cleaned.split(/\s+as\s+/)[0].trim();
      if (orig) names.push(orig);
    }
  }
  const beforeBrace = clause.replace(/\{[^}]*\}/g, '').replace(/^\s*type\s+/, '').replace(/,/g, ' ').trim();
  if (beforeBrace && !beforeBrace.startsWith('*')) {
    const defName = beforeBrace.split(/\s+/)[0].trim();
    if (defName) names.push('default');
  }
  if (clause.trim() === '*') wildcard = true;
  return { names: uniq(names), wildcard };
}

function extractModuleImports(text) {
  const out = [];
  const src = String(text || '');
  // import ... from 'spec' and export ... from 'spec'
  for (const m of src.matchAll(/\b(?:import|export)\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const parsed = parseNamedClause(m[1]);
    out.push({ specifier: m[2], names: parsed.names, wildcard: parsed.wildcard, isReExport: m[0].startsWith('export') });
  }
  // side-effect import 'spec'
  for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
    out.push({ specifier: m[1], names: [], wildcard: false, isReExport: false });
  }
  // dynamic import('spec') and require('spec')
  for (const m of src.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push({ specifier: m[1], names: [], wildcard: true, isReExport: false });
  }
  // vitest / jest module mocks: vi.mock('spec'), vi.importActual('spec'), jest.mock('spec')
  for (const m of src.matchAll(/\b(?:vi|jest)\.(?:mock|doMock|importActual|requireActual)\s*\(\s*['"]([^'"]+)['"]/g)) {
    out.push({ specifier: m[1], names: [], wildcard: true, isReExport: false });
  }
  return out;
}

function extractExportedUnions(text) {
  const unions = [];
  const src = String(text || '');
  // export type Foo = 'a' | 'b' (single or multi-line up to `;` or next `export`/`type`/`interface`/`const`/`function`)
  for (const m of src.matchAll(/\bexport\s+type\s+([A-Z][A-Za-z0-9_]*)\s*=\s*([^;]+?)(?:;|\n(?=\s*(?:export|type|interface|const|let|var|function|class|\/\*\*)\b)|$)/g)) {
    if (m[2] && m[2].includes('|')) unions.push(m[1]);
  }
  for (const m of src.matchAll(/\bexport\s+(?:const\s+)?enum\s+([A-Z][A-Za-z0-9_]*)\b/g)) {
    unions.push(m[1]);
  }
  return uniq(unions);
}

function extractExhaustiveRecordKeys(text) {
  const keys = [];
  const src = String(text || '');
  for (const m of src.matchAll(/\b(Partial\s*<\s*)?Record\s*<\s*(?:Readonly\s*<\s*)?([A-Z][A-Za-z0-9_]*)\b/g)) {
    if (!m[1]) keys.push(m[2]);
  }
  for (const m of src.matchAll(/\[\s*[A-Za-z_$][\w$]*\s+in\s+([A-Z][A-Za-z0-9_]*)\s*\](?!\s*\?)/g)) {
    keys.push(m[1]);
  }
  return uniq(keys);
}

function buildImportIndex(root, ref = 'HEAD') {
  const files = listProductionCodeFiles(root, ref);
  const known = new Set(files);
  const aliases = loadPathAliases(root);
  const byFile = new Map();
  for (const f of files) {
    const text = readRepoText(root, ref, f);
    const rawImports = extractModuleImports(text);
    const resolvedImports = [];
    for (const imp of rawImports) {
      const target = resolveModuleSpecifier(f, imp.specifier, known, aliases);
      if (target) resolvedImports.push({ ...imp, target });
    }
    byFile.set(f, {
      file: f,
      text,
      imports: resolvedImports,
      exportedUnions: extractExportedUnions(text),
      exhaustiveRecordKeys: extractExhaustiveRecordKeys(text),
    });
  }
  return { files, known, byFile };
}

/** OXB-199: 1-hop reverse importers in production code for newly deleted paths. */
function findOrphanImporters(index, newlyDeletedPaths, declaredScope = [], alreadyDeletedSet = new Set()) {
  const targetSet = new Set((newlyDeletedPaths || []).map(norm).filter((p) => p && !alreadyDeletedSet.has(p)));
  if (!targetSet.size) return [];
  const orphans = [];
  for (const [file, info] of index.byFile.entries()) {
    if (alreadyDeletedSet.has(file) || targetSet.has(file)) continue;
    if (inScope(file, declaredScope)) continue;
    if (info.imports.some((imp) => targetSet.has(imp.target))) {
      orphans.push(file);
    }
  }
  return orphans.sort();
}

/**
 * OXB-198: When a removal task edits a file exporting a union type/enum (e.g. `AppView` in `keybindings.ts`),
 * find production files that import that union type (directly or via 1-hop barrel re-export) and use it as an
 * exhaustive `Record<UnionType, ...>` or `[K in UnionType]` key (e.g. `viewSwitch.ts`, `ShortcutGuide.tsx`).
 */
function findCoupledUnionConsumers(index, editedFiles, declaredScope = [], deletedSet = new Set()) {
  const unionSources = new Map(); // TypeName -> Set<sourceFile | barrelFile>
  for (const rawFile of editedFiles || []) {
    const f = norm(rawFile);
    if (deletedSet.has(f)) continue;
    const info = index.byFile.get(f);
    if (!info || !info.exportedUnions.length) continue;
    for (const typeName of info.exportedUnions) {
      if (!unionSources.has(typeName)) unionSources.set(typeName, new Set());
      unionSources.get(typeName).add(f);
    }
  }
  if (!unionSources.size) return [];
  // Include 1-hop barrel re-exporters (`export * from` or `export { AppView } from`)
  for (const [file, info] of index.byFile.entries()) {
    for (const imp of info.imports) {
      if (!imp.isReExport) continue;
      for (const [typeName, sources] of unionSources.entries()) {
        if (sources.has(imp.target) && (imp.wildcard || imp.names.includes(typeName))) {
          sources.add(file);
        }
      }
    }
  }
  const coupled = [];
  for (const [file, info] of index.byFile.entries()) {
    if (deletedSet.has(file) || inScope(file, declaredScope)) continue;
    if (!info.exhaustiveRecordKeys.length) continue;
    for (const typeName of info.exhaustiveRecordKeys) {
      const sources = unionSources.get(typeName);
      if (!sources) continue;
      const importsType = info.imports.some((imp) => sources.has(imp.target) && (imp.wildcard || imp.names.includes(typeName)));
      if (importsType) {
        coupled.push(file);
        break;
      }
    }
  }
  return uniq(coupled).sort();
}

/** OXB-201: role path lists accept `edited`/`edited_paths`, `deleted`/`deleted_paths`, `created`/`created_paths`. */
function rolePathList(t, field) {
  if (!t) return [];
  const a = Array.isArray(t[field]) ? t[field] : [];
  const b = Array.isArray(t[`${field}_paths`]) ? t[`${field}_paths`] : [];
  return uniq([...a, ...b].map(norm));
}

/** OXB-201: renames in the recent history at `ref` (`git log --diff-filter=R`): [{ from, to }]. */
function recentRenames(root, ref = 'HEAD', max = 500) {
  const out = [];
  try {
    const r = spawnSync('git', ['log', '--diff-filter=R', '-M', '--name-status', '--format=', `-n${max}`, ref || 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) return out;
    for (const line of String(r.stdout || '').split(/\r?\n/)) {
      const m = /^R\d*\t([^\t]+)\t([^\t]+)$/.exec(line.trim());
      if (m) out.push({ from: norm(m[1]), to: norm(m[2]) });
    }
  } catch { /* no git */ }
  return out;
}

/**
 * OXB-201: the real path of a stale `edited`/`deleted` entry — the target of a rename of that exact path, or the single
 * renamed file with the same basename that exists at `ref`. null when there is no candidate or more than one.
 */
function staleSuggestion(root, ref, p, renames) {
  const clean = norm(p);
  const exists = (x) => gitHas(root, ref, x);
  // follow a rename chain of the exact path (a → b → c)
  let cur = clean;
  const seen = new Set();
  for (;;) {
    const hit = renames.find((r) => r.from === cur);
    if (!hit || seen.has(hit.to)) break;
    seen.add(hit.to);
    cur = hit.to;
  }
  if (cur !== clean && exists(cur)) return cur;
  const base = path.posix.basename(clean);
  const cands = uniq(renames.filter((r) => path.posix.basename(r.to) === base).map((r) => r.to)).filter(exists);
  return cands.length === 1 ? cands[0] : null;
}

/**
 * OXB-201: `edited`/`deleted` entries (of every role task, in order) that do not exist at `ref`, skipping paths created
 * by an earlier task of the phase. Returns [{ index, rid, field, path, suggestion }].
 */
function staleRolePaths(root, ref, tasks) {
  const out = [];
  const createdBefore = new Set();
  let renames = null;
  for (const [i, t] of (tasks || []).entries()) {
    if (!t) continue;
    for (const field of ['edited', 'deleted']) {
      for (const p of rolePathList(t, field)) {
        if (!p || /[*?[{]/.test(p)) continue;
        if (createdBefore.has(p) || gitHas(root, ref, p)) continue;
        if (!renames) renames = recentRenames(root, ref);
        out.push({ index: i, rid: t.rid || t.id || null, field, path: p, suggestion: staleSuggestion(root, ref, p, renames) });
      }
    }
    for (const p of rolePathList(t, 'created')) createdBefore.add(p);
  }
  return out;
}

/** OXB-201: replaces a stale path by its suggestion in the role task (edited/deleted/files and their *_paths). */
function applyStaleFix(t, stale) {
  for (const key of [stale.field, `${stale.field}_paths`, 'files']) {
    if (Array.isArray(t[key])) t[key] = uniq(t[key].map((x) => (norm(x) === stale.path ? stale.suggestion : norm(x))));
  }
}

function staleMessage(at, s, ref) {
  return `${at}: ${s.path} não existe em ${ref} (declarado como ${s.field})${s.suggestion ? ` — movido para ${s.suggestion}? (use --fix-stale-paths para corrigir)` : ''}`;
}

/** OXB-202: files whose change makes the third-party notices stale. */
const DEPENDENCY_MANIFEST_RE = /(^|\/)(package\.json|package-lock\.json)$/;
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md';

function readPackageScripts(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  } catch {
    return {};
  }
}

/**
 * OXB-202: when a task of the phase edits package.json / package-lock.json, the plan gets the `notices` phase gate
 * (`npm run notices:check`) and the task gets THIRD_PARTY_NOTICES.md in its scope (when the repo has it).
 */
function injectNoticesGate(root, ref, plan, warnings) {
  const touching = plan.tasks.filter((t) => (t.files || []).some((f) => DEPENDENCY_MANIFEST_RE.test(norm(f)) && !/node_modules\//.test(f)));
  if (!touching.length) return null;
  const scripts = readPackageScripts(root);
  const hasNotices = gitHas(root, ref, NOTICES_FILE) || fs.existsSync(path.join(root, NOTICES_FILE));
  for (const t of touching) {
    if (hasNotices && !(t.files || []).includes(NOTICES_FILE)) {
      t.files = uniq([...(t.files || []), NOTICES_FILE]);
      warnings.push(`${t.id}: muda ${t.files.filter((f) => DEPENDENCY_MANIFEST_RE.test(f)).join(', ')} — ${NOTICES_FILE} entrou no escopo (rode npm run notices:generate na tarefa)`);
    }
  }
  if (typeof scripts['notices:check'] !== 'string') {
    warnings.push(`${touching.map((t) => t.id).join(', ')} muda(m) package.json/lockfile, mas o package.json não tem o script notices:check — confira as licenças de terceiros antes do PR`);
    return null;
  }
  const gates = Array.isArray(plan.phase_gates) ? plan.phase_gates : [];
  if (!gates.some((g) => g && (g.id === 'notices' || String(g.command || '').includes('notices:check')))) {
    gates.push({ id: 'notices', command: 'npm run notices:check', description: `licenças de terceiros em dia (${touching.map((t) => t.id).join(', ')} muda(m) package.json/lockfile)` });
  }
  plan.phase_gates = gates;
  return 'notices';
}

/** OXB-203: the IPC contract files (shared channel types + the renderer's window typing) and the e2e IPC mock. */
const IPC_CONTRACT_FILES = ['src/types/window.d.ts', 'shared/types/ipc.ts'];
const IPC_CONSUMER_FILES = ['electron/main/e2e/mock-ipc.ts'];
const IPC_CONSUMER_RE = /\bwindow\.oxe\b|mock-ipc/;

function isFrontendTask(t) {
  return (t.roles || []).some((r) => /front|^fe$|^ui$|renderer/i.test(String(r)))
    || /^FE-/i.test(String(t.rid || ''))
    || (Array.isArray(t.ids) && t.ids.some((id) => /(?:^|:)FE-/i.test(String(id))));
}

/**
 * OXB-207: every `FE-*` / frontend task that creates or edits `.tsx` / `.css` under `src/` automatically includes
 * `tests/design-lint.test.ts` and `tests/design-lint-target-size.test.ts` (when present in the repo) in `verify.commands`.
 */
function injectFrontendDesignLintVerify(root, ref, task, roleInfo = {}, taskDeleted = [], overrideTests = null) {
  const isFe = isFrontendTask(task)
    || (Array.isArray(roleInfo.rawTasks) && roleInfo.rawTasks.some((rt) => rt && /^FE-/i.test(String(rt.id || rt.rid || ''))));
  if (!isFe) return [];
  const delSet = new Set((taskDeleted || []).map(norm));
  const touchedUi = uniq([
    ...(roleInfo.created || []),
    ...(roleInfo.edited || []),
    ...(task.files || []),
    ...((roleInfo.moves || []).map((m) => m.to)),
  ].map(norm)).filter((p) => !delSet.has(p) && !TEST_FILE_RE.test(p) && /^src\/.+\.(?:tsx|css)$/i.test(p));
  if (!touchedUi.length) return [];

  const candidates = Array.isArray(overrideTests)
    ? overrideTests.map(norm)
    : DESIGN_LINT_TESTS.filter((f) => hasRepoFile(root, ref, f) && !delSet.has(f));
  if (!candidates.length) return [];

  const existingCmds = (task.verify && Array.isArray(task.verify.commands))
    ? [...task.verify.commands]
    : (typeof task.verify === 'string' ? [task.verify] : []);
  const missingTests = candidates.filter((tf) => !existingCmds.some((c) => String(c).includes(tf)));
  if (missingTests.length) {
    existingCmds.push(`npx vitest run ${missingTests.join(' ')}`);
    task.verify = {
      ...(task.verify && typeof task.verify === 'object' && !Array.isArray(task.verify) ? task.verify : {}),
      commands: existingCmds,
    };
  }
  return missingTests;
}

/**
 * OXB-203 (`--pair-as-deps`): a frontend task that consumes `window.oxe` / the e2e IPC mock depends on the tasks of the
 * phase that edit the IPC contract (src/types/window.d.ts, shared/types/ipc.ts) — never the other way round, and never
 * when it would close a cycle. Returns [{ task, added: [ids] }].
 */
function pairIpcDependencies(root, ref, tasks, options = {}) {
  const contract = (options.contractFiles || IPC_CONTRACT_FILES).map(norm);
  const consumerFiles = (options.consumerFiles || IPC_CONSUMER_FILES).map(norm);
  const producers = tasks.filter((t) => (t.files || []).some((f) => contract.includes(norm(f))));
  if (!producers.length) return [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dependsOn = (a, b, seen = new Set()) => { // does a depend (transitively) on b?
    if (a === b) return true;
    if (seen.has(a)) return false;
    seen.add(a);
    return ((byId.get(a) || {}).depends_on || []).some((d) => dependsOn(d, b, seen));
  };
  const out = [];
  for (const t of tasks) {
    if (!isFrontendTask(t) || producers.includes(t)) continue;
    const files = (t.files || []).map(norm);
    const consumes = files.some((f) => consumerFiles.includes(f)) || files.some((f) => CODE_RE.test(f) && IPC_CONSUMER_RE.test(readRepoText(root, ref, f)));
    if (!consumes) continue;
    const added = [];
    for (const p of producers) {
      if ((t.depends_on || []).includes(p.id) || dependsOn(p.id, t.id)) continue;
      t.depends_on = uniq([...(t.depends_on || []), p.id]);
      added.push(p.id);
    }
    if (added.length) out.push({ task: t.id, added });
  }
  return out;
}

const GENERIC_EXPORT_NAMES = new Set([
  'init', 'index', 'main', 'default', 'types', 'config', 'state', 'store', 'props',
  'utils', 'helper', 'helpers', 'render', 'setup', 'start', 'close', 'reset', 'create',
  'update', 'remove', 'delete', 'open', 'read', 'write', 'list', 'load', 'save',
]);
const GENERIC_FEATURE_DIRS = new Set([
  'common', 'shared', 'layout', 'navigation', 'modal', 'modals', 'icons', 'keyboard',
  'editor', 'utils', 'hooks', 'types', 'store', 'stores', 'services', 'components',
  'main', 'renderer', 'preload', 'ipc', 'lib', 'core', 'app', 'ui', 'views', 'modes',
]);
const URL_SCHEMES = new Set([
  'http', 'https', 'file', 'data', 'node', 'ws', 'wss', 'mailto', 'about', 'chrome',
  'javascript', 'devtools', 'electron', 'app', 'oxe', 'backend', 'frontend', 'stress',
]);

function listAllRepoFiles(root, ref = 'HEAD') {
  const files = [];
  try {
    const gitRes = spawnSync('git', ['ls-tree', '-r', '--name-only', ref || 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (gitRes.status === 0 && gitRes.stdout && gitRes.stdout.trim()) {
      for (const line of gitRes.stdout.trim().split(/\r?\n/)) {
        const p = norm(line);
        if (p) files.push(p);
      }
      return uniq(files);
    }
  } catch { /* fallback to disk */ }
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (['node_modules', '.git', '.oxe', 'dist', 'build', 'coverage'].includes(ent.name)) continue;
      const full = path.join(dir, ent.name);
      const rel = norm(path.relative(root, full));
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) files.push(rel);
    }
  };
  walk(root);
  return uniq(files);
}

function extractExportedSymbols(text) {
  const out = [];
  const src = String(text || '');
  for (const m of src.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    if (m[1]) out.push(m[1]);
  }
  for (const m of src.matchAll(/\bexport\s*\{([^}]+)\}(?!\s*from\b)/g)) {
    for (const part of m[1].split(',')) {
      const cleaned = part.replace(/^\s*type\s+/, '').trim();
      if (!cleaned) continue;
      const parts = cleaned.split(/\s+as\s+/);
      const exported = (parts[1] || parts[0] || '').trim();
      if (exported && exported !== 'default') out.push(exported);
    }
  }
  return uniq(out);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasStringLiteral(text, lit) {
  if (!lit) return false;
  return text.includes(`'${lit}'`) || text.includes(`"${lit}"`) || text.includes(`\`${lit}\``);
}

function toKebabSlug(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

/**
 * OXB-206: On removal tasks (deleting files under src/ | electron/ | shared/, or removing IPC channels / modes / routes),
 * sweep non-frozen legacy tests (tests/ excluding tests/acceptance/), e2e/, appMenus.ts, and
 * docs/security/threat-model-*.md for removed imports, symbols, IPC channels, modes, and routes.
 */
function sweepRemovalImpacts(root, ref, task, roleInfo, sweepCtx = {}) {
  const deletedBefore = sweepCtx.deletedBefore || new Set();
  const frozenFiles = sweepCtx.frozenFiles || new Set();
  const allRepoFiles = sweepCtx.allRepoFiles || listAllRepoFiles(root, ref);
  const aliases = sweepCtx.aliases || loadPathAliases(root);
  const textCache = sweepCtx.textCache || new Map();
  const readText = (f) => {
    if (!textCache.has(f)) textCache.set(f, readRepoText(root, ref, f));
    return textCache.get(f);
  };

  const taskDeleted = uniq([
    ...((roleInfo && roleInfo.deleted) || []).map(norm),
    ...(((roleInfo && roleInfo.moves) || []).map((m) => norm(m.from))),
  ]);
  const newlyDeleted = taskDeleted.filter((p) => !deletedBefore.has(p));
  const deletedProd = newlyDeleted.filter((p) => /^(src|electron|shared)\//.test(p));
  const rawTasks = Array.isArray(roleInfo && roleInfo.rawTasks) ? roleInfo.rawTasks : [];

  const explicitSymbols = new Set();
  const explicitChannels = new Set();
  const explicitLiterals = new Set();

  for (const rt of rawTasks) {
    for (const s of [...(rt.removed_symbols || []), ...(rt.symbols_removed || [])]) {
      const name = typeof s === 'string' ? s.trim() : (s && s.name ? String(s.name).trim() : '');
      if (name) explicitSymbols.add(name);
    }
    for (const ch of [...(rt.removed_channels || []), ...(rt.ipc_channels_removed || [])]) {
      if (typeof ch === 'string' && ch.trim()) explicitChannels.add(ch.trim());
    }
    for (const lit of [
      ...(rt.removed_modes || []),
      ...(rt.modes_removed || []),
      ...(rt.removed_routes || []),
      ...(rt.routes_removed || []),
      ...(rt.removed_views || []),
      ...(rt.views_removed || []),
    ]) {
      if (typeof lit === 'string' && lit.trim()) explicitLiterals.add(lit.trim());
    }
  }

  const hasExplicitRemovals = explicitSymbols.size > 0 || explicitChannels.size > 0 || explicitLiterals.size > 0;
  const isRemovalTask =
    task.kind === 'remove'
    || deletedProd.length > 0
    || hasExplicitRemovals
    || /\b(remov|drop|strip|retir|delet)/i.test(String(task.title || ''));
  if (!isRemovalTask) return { swept: [], legacyTests: [], e2eSpecs: [], menuFiles: [], threatModelDocs: [] };

  // Extract quoted/backticked IPC channels, routes, and mode/tool literals from removal task title & notes
  const prose = `${task.title || ''}\n${task.notes || ''}`;
  for (const m of prose.matchAll(/(?:^|[\s'"`(,])([a-z][a-z0-9-]*:[a-z0-9][\w:-]*)(?=$|[\s'"`),.;])/g)) {
    const ch = m[1];
    const scheme = ch.split(':')[0];
    if (!URL_SCHEMES.has(scheme)) explicitChannels.add(ch);
  }
  for (const m of prose.matchAll(/['"`]([^'"`\s]{3,60})['"`]/g)) {
    const tok = m[1].trim();
    if (!tok || /^[AG]\d+(?:\.\d+)?$/.test(tok)) continue;
    if (/\.[a-z0-9]{1,5}$/i.test(tok) || tok.includes('/src/') || tok.includes('/electron/')) continue;
    if (tok.includes(':')) {
      const scheme = tok.split(':')[0];
      if (!URL_SCHEMES.has(scheme)) explicitChannels.add(tok);
      continue;
    }
    if (tok.startsWith('/') || /^(?:tool|view|mode|tab|nav)-[a-z0-9-]+$/i.test(tok) || /^[a-z][a-z0-9-]{2,}$/.test(tok)) {
      explicitLiterals.add(tok);
    } else if (/^[A-Za-z_$][\w$]{3,}$/.test(tok)) {
      explicitSymbols.add(tok);
    }
  }

  const allDeletedSet = new Set([...deletedBefore, ...taskDeleted]);

  // Surviving production exports and IPC handlers (to prevent false-positive symbol/channel collisions)
  const survivingExports = new Set();
  const survivingIpcHandlers = new Set();
  if (deletedProd.length) {
    for (const f of allRepoFiles) {
      if (allDeletedSet.has(f) || !/^(src|electron|shared)\//.test(f) || !CODE_RE.test(f) || TEST_FILE_RE.test(f)) continue;
      const txt = readText(f);
      for (const sym of extractExportedSymbols(txt)) survivingExports.add(sym);
      if (f.startsWith('electron/')) {
        for (const hm of txt.matchAll(/\b(?:ipcMain\.(?:handle|on)|handleIpc)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
          survivingIpcHandlers.add(hm[1]);
        }
      }
    }
  }

  const inferredSymbols = new Set();
  const inferredChannels = new Set();
  const featureSlugs = new Set();
  const deletedDirPrefixes = new Set();

  for (const rawDel of (roleInfo && roleInfo.rawDeleted) || []) {
    const cleaned = norm(rawDel).replace(/(\/\*\*|\/)+$/, '');
    if (/^(src|electron|shared)\//.test(cleaned) && isDirEntry(root, ref, rawDel)) {
      deletedDirPrefixes.add(cleaned);
    }
  }

  for (const f of deletedProd) {
    const txt = readText(f);
    for (const sym of extractExportedSymbols(txt)) {
      if (sym.length >= 4 && !GENERIC_EXPORT_NAMES.has(sym.toLowerCase()) && !survivingExports.has(sym)) {
        inferredSymbols.add(sym);
      }
    }
    for (const cm of txt.matchAll(/['"`]([a-z][a-z0-9-]*:[a-z0-9][\w:-]*)['"`]/g)) {
      const ch = cm[1];
      const scheme = ch.split(':')[0];
      if (!URL_SCHEMES.has(scheme) && !survivingIpcHandlers.has(ch)) {
        inferredChannels.add(ch);
      }
    }
    const segMatch = /^(?:src\/(?:components|views|modes|features)|electron\/main\/services)\/([^/]+)(?:\/|$)/.exec(f);
    if (segMatch && segMatch[1]) {
      const segBase = segMatch[1].replace(/\.[^.]+$/, '');
      const slug = toKebabSlug(segBase);
      if (slug.length >= 4 && !GENERIC_FEATURE_DIRS.has(slug) && !GENERIC_FEATURE_DIRS.has(segBase.toLowerCase())) {
        featureSlugs.add(slug);
        featureSlugs.add(segBase.toLowerCase());
      }
    }
  }

  const deletedTargets = new Set(deletedProd);
  const removedSymbols = new Set([...explicitSymbols, ...inferredSymbols]);
  const removedChannels = new Set([...explicitChannels, ...inferredChannels]);
  const removedLiterals = new Set([...explicitLiterals]);

  if (!deletedTargets.size && !removedSymbols.size && !removedChannels.size && !removedLiterals.size && !featureSlugs.size) {
    return { swept: [], legacyTests: [], e2eSpecs: [], menuFiles: [], threatModelDocs: [] };
  }

  const knownAllSet = new Set([...allRepoFiles, ...deletedTargets, ...taskDeleted]);
  const symbolRegexes = [...removedSymbols]
    .filter((sym) => explicitSymbols.has(sym) || sym.length >= 5)
    .map((sym) => new RegExp(`\\b${escapeRegExp(sym)}\\b`));

  const matchesCodeCandidate = (candFile, kind) => {
    const txt = readText(candFile);
    if (!txt) return false;
    const rawImports = extractModuleImports(txt);
    for (const imp of rawImports) {
      if (deletedTargets.size) {
        const resolved = resolveModuleSpecifier(candFile, imp.specifier, knownAllSet, aliases);
        if (resolved && deletedTargets.has(resolved)) return true;
        for (const dirPref of deletedDirPrefixes) {
          if (resolved && (resolved === dirPref || resolved.startsWith(`${dirPref}/`))) return true;
        }
      }
      if (removedSymbols.size && imp.names.some((n) => removedSymbols.has(n))) return true;
    }
    for (const ch of removedChannels) {
      if (hasStringLiteral(txt, ch)) return true;
    }
    for (const lit of removedLiterals) {
      if (hasStringLiteral(txt, lit)) return true;
    }
    for (const re of symbolRegexes) {
      if (re.test(txt)) return true;
    }
    if (kind === 'menu' && featureSlugs.size) {
      for (const slug of featureSlugs) {
        if (
          hasStringLiteral(txt, `tool-${slug}`)
          || hasStringLiteral(txt, `view-${slug}`)
          || hasStringLiteral(txt, `mode-${slug}`)
          || hasStringLiteral(txt, slug)
        ) {
          return true;
        }
      }
    }
    if (kind === 'e2e' && featureSlugs.size) {
      const base = path.posix.basename(candFile).toLowerCase();
      for (const slug of featureSlugs) {
        if (
          base.startsWith(slug)
          || hasStringLiteral(txt, `/${slug}`)
          || hasStringLiteral(txt, `tool-${slug}`)
          || hasStringLiteral(txt, slug)
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const matchesDocCandidate = (docFile) => {
    const txt = readText(docFile);
    if (!txt) return false;
    for (const p of deletedProd) {
      if (txt.includes(p)) return true;
    }
    for (const dirPref of deletedDirPrefixes) {
      if (txt.includes(dirPref)) return true;
    }
    for (const ch of removedChannels) {
      if (txt.includes(ch)) return true;
    }
    for (const lit of removedLiterals) {
      if (txt.includes(lit)) return true;
    }
    for (const sym of explicitSymbols) {
      if (sym.length >= 4 && new RegExp(`\\b${escapeRegExp(sym)}\\b`).test(txt)) return true;
    }
    return false;
  };

  const legacyTests = [];
  const e2eSpecs = [];
  const menuFiles = [];
  const threatModelDocs = [];

  for (const f of allRepoFiles) {
    if (allDeletedSet.has(f) || frozenFiles.has(f)) continue;
    if (f.startsWith('tests/') && !f.startsWith('tests/acceptance/') && (CODE_RE.test(f) || TEST_FILE_RE.test(f))) {
      if (matchesCodeCandidate(f, 'test')) legacyTests.push(f);
    } else if (f.startsWith('e2e/') && (CODE_RE.test(f) || TEST_FILE_RE.test(f))) {
      if (matchesCodeCandidate(f, 'e2e')) e2eSpecs.push(f);
    } else if (/(?:^|\/)appMenus\.[cm]?[jt]sx?$/.test(f)) {
      if (matchesCodeCandidate(f, 'menu')) menuFiles.push(f);
    } else if (/^docs\/security\/threat-model-[^/]*\.md$/.test(f)) {
      if (matchesDocCandidate(f)) threatModelDocs.push(f);
    }
  }

  legacyTests.sort();
  e2eSpecs.sort();
  menuFiles.sort();
  threatModelDocs.sort();
  const swept = uniq([...legacyTests, ...e2eSpecs, ...menuFiles, ...threatModelDocs]);
  return { swept, legacyTests, e2eSpecs, menuFiles, threatModelDocs };
}

function expandRolePaths(root, ref, list) {
  const expanded = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (isDirEntry(root, ref || 'HEAD', p)) {
      expanded.push(norm(p), ...expandDirEntry(root, ref || 'HEAD', p));
    } else {
      expanded.push(norm(p));
    }
  }
  return uniq(expanded);
}

function build(inputs, ctx = {}) {
  const root = ctx.root || process.cwd();
  const ref = ctx.ref || 'HEAD';
  const coupledRules = loadCoupledScope(root, ctx);
  // OXB-201: stale edited/deleted paths (moved by an earlier phase) — fixed with --fix-stale-paths, an error otherwise.
  const staleErrors = [];
  const staleFixed = [];
  if (ctx.checkPaths !== false) {
    for (const { file, doc } of inputs) {
      for (const s of staleRolePaths(root, ref, (doc && doc.tasks) || [])) {
        const at = `${path.basename(file)}: tasks[${s.index}]${s.rid ? ` (${s.rid})` : ''}`;
        if (ctx.fixStalePaths && s.suggestion) {
          applyStaleFix(doc.tasks[s.index], s);
          staleFixed.push(`${at}: ${s.path} → ${s.suggestion} (corrigido pelo histórico de renames)`);
        } else staleErrors.push(staleMessage(at, s, ref));
      }
    }
  }
  const res = merge.mergeRolePlans(inputs, { key: ctx.key || 'rid' });
  const errors = [...res.errors, ...staleErrors];
  const warnings = [...res.warnings, ...staleFixed];
  const plan = res.plan;
  const frozenFiles = new Set((plan.acceptance_tests || []).flatMap((a) => (a.files || []).map(norm)));
  // role-level path declarations by key
  const roleByKey = new Map();
  for (const { doc } of inputs) for (const t of (doc && doc.tasks) || []) {
    const k = String(t.rid || t[ctx.key || 'rid'] || '');
    const cur = roleByKey.get(k) || { deleted: [], created: [], edited: [], moves: [], swept: [], rawDeleted: [], rawTasks: [] };
    cur.rawDeleted.push(...rolePathList(t, 'deleted'));
    cur.rawTasks.push(t);
    for (const f of ['deleted', 'created', 'edited']) {
      cur[f].push(...expandRolePaths(root, ref, rolePathList(t, f)));
    }
    cur.moves.push(...(Array.isArray(t.moves) ? t.moves : []));
    roleByKey.set(k, cur);
  }

  let importIndex = null;
  const getImportIndex = () => {
    if (!importIndex) importIndex = buildImportIndex(root, ref);
    return importIndex;
  };
  let allRepoFiles = null;
  let pathAliases = null;
  const sweepTextCache = new Map();
  const getSweepBase = () => {
    if (!allRepoFiles) allRepoFiles = listAllRepoFiles(root, ref);
    if (!pathAliases) pathAliases = loadPathAliases(root);
    return { allRepoFiles, aliases: pathAliases, textCache: sweepTextCache };
  };

  const deletedBefore = new Set();
  const phaseSweptLegacyTests = [];
  const phaseSweptE2eSpecs = [];
  const phaseSweepTasks = [];

  for (const t of plan.tasks) {
    const before = t.files.length;
    const r = roleByKey.get(String(t.rid)) || {};
    const taskFilesExpanded = expandRolePaths(root, ref, t.files);
    const taskDeleted = uniq([...(r.deleted || []).map(norm), ...((r.moves || []).map((m) => norm(m.from)))]);
    const newlyDeleted = taskDeleted.filter((p) => !deletedBefore.has(p));

    // OXB-199: 1-hop reverse import closure when `--auto-close-imports` (`ctx.autoCloseImports`) is enabled
    let autoClosedImporters = [];
    if (ctx.autoCloseImports && newlyDeleted.length) {
      const currentScope = uniq([...taskFilesExpanded, ...(r.edited || []).map(norm), ...(r.created || []).map(norm), ...taskDeleted]);
      autoClosedImporters = findOrphanImporters(getImportIndex(), newlyDeleted, currentScope, deletedBefore);
    }

    // OXB-198: exhaustive Record<UnionType, ...> shrink coupling on mode/feature removal tasks
    let unionCoupled = [];
    const isRemovalTask = t.kind === 'remove' || taskDeleted.length > 0 || /\b(remov|drop|strip|retir|delet)/i.test(String(t.title || ''));
    const candidateUnionEdited = uniq([...taskFilesExpanded, ...(r.edited || []).map(norm), ...autoClosedImporters]).filter((p) => CODE_RE.test(p) && !taskDeleted.includes(p));
    if (isRemovalTask && candidateUnionEdited.length) {
      const allDeletedSoFar = new Set([...deletedBefore, ...taskDeleted]);
      const currentScope = uniq([...taskFilesExpanded, ...(r.edited || []).map(norm), ...(r.created || []).map(norm), ...autoClosedImporters, ...taskDeleted]);
      unionCoupled = findCoupledUnionConsumers(getImportIndex(), candidateUnionEdited, currentScope, allDeletedSoFar);
    }

    // OXB-206: sweep legacy suites (`tests/**`, `e2e/**`), `appMenus.ts`, and `docs/security/threat-model-*.md`
    const sweepRes = ctx.legacySweep === false
      ? { swept: [], legacyTests: [], e2eSpecs: [], menuFiles: [], threatModelDocs: [] }
      : sweepRemovalImpacts(root, ref, t, r, { deletedBefore, frozenFiles, ...getSweepBase() });

    const effectiveEdited = uniq([...(r.edited || []).map(norm), ...autoClosedImporters, ...unionCoupled, ...sweepRes.swept]);
    if (autoClosedImporters.length || unionCoupled.length || sweepRes.swept.length) {
      r.edited = effectiveEdited;
      r.swept = uniq([...(r.swept || []), ...sweepRes.swept]);
      roleByKey.set(String(t.rid), r);
    }
    if (effectiveEdited.length) {
      t.edited_paths = effectiveEdited.filter((f) => !frozenFiles.has(f));
    }

    if (sweepRes.swept.length) {
      phaseSweepTasks.push(t.id);
      const taskGates = Array.isArray(t.gates) ? [...t.gates] : [];
      if (sweepRes.legacyTests.length) {
        phaseSweptLegacyTests.push(...sweepRes.legacyTests);
        const existingCmds = (t.verify && Array.isArray(t.verify.commands)) ? t.verify.commands : [];
        const uncoveredTests = sweepRes.legacyTests.filter((tf) => !existingCmds.some((c) => String(c).includes(tf)));
        if (uncoveredTests.length) {
          t.verify = { ...(t.verify || {}), commands: [...existingCmds, `npx vitest run ${uncoveredTests.join(' ')}`] };
        }
        taskGates.push(`npx vitest run ${sweepRes.legacyTests.join(' ')}`);
      }
      if (sweepRes.e2eSpecs.length) {
        phaseSweptE2eSpecs.push(...sweepRes.e2eSpecs);
        taskGates.push(`npx playwright test ${sweepRes.e2eSpecs.join(' ')}`);
      }
      if (taskGates.length) t.gates = uniq(taskGates);
      warnings.push(`${t.id}: varredura de remoção anexou a edited_paths (${sweepRes.swept.join(', ')})`);
    }

    const coupledMatch = matchedCoupledRules(coupledRules, {
      files: [...taskFilesExpanded, ...autoClosedImporters, ...unionCoupled, ...sweepRes.swept],
      created: r.created || [],
      edited: effectiveEdited,
      deleted: r.deleted || [],
    });
    const coupled = coupledMatch.included;
    for (const mr of coupledMatch.matchedRules) {
      if (mr.note) warnings.push(`${t.id}: ${mr.note}`);
    }
    t.files = uniq([
      ...taskFilesExpanded,
      ...autoClosedImporters,
      ...unionCoupled,
      ...sweepRes.swept,
      ...coupled,
      ...(r.created || []).map(norm),
      ...effectiveEdited,
      ...(r.deleted || []).map(norm),
      ...(r.moves || []).flatMap((m) => [norm(m.from), norm(m.to)]),
    ]).filter((f) => !frozenFiles.has(f));
    if (ctx.designLintVerify !== false) {
      injectFrontendDesignLintVerify(root, ref, t, r, taskDeleted, ctx.designLintTests);
    }
    if (before && t.files.length < before) warnings.push(`${t.id}: arquivos de aceite congelados tirados do escopo`);
    if (ctx.phase) t.phase = ctx.phase;
    for (const p of taskDeleted) deletedBefore.add(p);
  }
  // OXB-206: attach phase_gates for legacy vitest / playwright suites swept by removal tasks (excluding tests deleted later in the phase)
  const survivingSweptLegacy = uniq(phaseSweptLegacyTests).filter((f) => !deletedBefore.has(f));
  const survivingSweptE2e = uniq(phaseSweptE2eSpecs).filter((f) => !deletedBefore.has(f));
  if (survivingSweptLegacy.length || survivingSweptE2e.length) {
    const gates = Array.isArray(plan.phase_gates) ? [...plan.phase_gates] : [];
    const byTasks = uniq(phaseSweepTasks).join(', ');
    if (survivingSweptLegacy.length && !gates.some((g) => g && g.id === 'legacy-tests')) {
      gates.push({
        id: 'legacy-tests',
        command: `npx vitest run ${survivingSweptLegacy.join(' ')}`,
        description: `suítes legadas impactadas por remoção (${byTasks})`,
      });
    }
    if (survivingSweptE2e.length && !gates.some((g) => g && g.id === 'legacy-e2e')) {
      gates.push({
        id: 'legacy-e2e',
        command: `npx playwright test ${survivingSweptE2e.join(' ')}`,
        description: `suítes e2e impactadas por remoção (${byTasks})`,
      });
    }
    if (gates.length) plan.phase_gates = gates;
  }
  // OXB-202: package.json / lockfile changed → notices gate (+ THIRD_PARTY_NOTICES.md in scope).
  const noticesGate = ctx.noticesGate === false ? null : injectNoticesGate(root, ref, plan, warnings);
  // OXB-203: --pair-as-deps — frontend consumers of window.oxe / the IPC mock after the IPC contract tasks.
  const pairCfg = (() => { try { return (JSON.parse(fs.readFileSync(path.join(root, '.oxe', 'config.json'), 'utf8')).plan || {}); } catch { return {}; } })();
  const paired = ctx.pairAsDeps || pairCfg.pair_as_deps === true
    ? pairIpcDependencies(root, ref, plan.tasks, { contractFiles: pairCfg.ipc_contract_files, consumerFiles: pairCfg.ipc_consumer_files })
    : [];
  for (const p of paired) warnings.push(`${p.task}: passa a depender de ${p.added.join(', ')} (contrato IPC: ${IPC_CONTRACT_FILES.join(', ')}) — --pair-as-deps`);
  assignWaves(plan.tasks);

  // OXB-194: filter deleted test files out of verify commands (own and transitive dependencies)
  const allTasksById = new Map(plan.tasks.map((t) => [t.id, t]));
  for (const t of plan.tasks) {
    const transitiveDel = transitiveDeletedForTask(t, allTasksById, roleByKey);
    if (t.verify && Array.isArray(t.verify.commands)) {
      const filteredCmds = [];
      for (const cmd of t.verify.commands) {
        const clean = filterDeletedFromVerifyCommand(cmd, transitiveDel);
        if (clean) filteredCmds.push(clean);
      }
      t.verify.commands = filteredCmds;
    }
  }

  const pack = { schema_version: 1, generated_by: 'oxe-cc plan build', ...(ctx.phase ? { phase: ctx.phase } : {}), tasks: [] };
  for (const t of plan.tasks) {
    const tests = (plan.acceptance_tests || []).filter((a) => (t.acceptance || []).includes(a.criterion)).flatMap((a) => a.files || []);
    const info = packEntry(root, t, roleByKey.get(String(t.rid)) || {}, frozenFiles, tests);
    errors.push(...kindErrors(t, info));
    const removed = new Set(info.entry.removed_paths || []);
    const sweptSet = new Set(info.entry.swept_paths || []);
    const uncovered = info.exact.filter((p) => CODE_RE.test(p) && !removed.has(p) && !sweptSet.has(p));
    if (!info.entry.symbols.length && uncovered.length && !['test-only', 'config-only'].includes(info.kind)) warnings.push(`${t.id}: nenhum símbolo saiu dos testes congelados para ${uncovered.slice(0, 3).join(', ')} — declare symbols no pack antes do execute`);
    pack.tasks.push(info.entry);
  }
  if (ctx.phase) plan.phase = ctx.phase;
  try {
    const rigor = require('./oxe-test-rigor.cjs');
    errors.push(
      ...rigor.suspiciousRegexMessages(rigor.suspiciousRegexFindings(root, plan)),
      ...rigor.pausedSocketMessages(rigor.pausedSocketFindings(root, plan)),
    );
  } catch { /* */ }
  return { plan, pack, planMd: renderPlanMd(plan, ctx.phase), errors, warnings, map: res.map, paired, notices_gate: noticesGate };
}

function gitHas(root, ref, p) {
  const clean = norm(p).replace(/(\/\*\*|\/)+$/, '');
  return spawnSync('git', ['cat-file', '-e', `${ref}:${clean}`], { cwd: root, windowsHide: true }).status === 0;
}

/** OXB-098 / OXB-199: problems of one role file (including 1-hop reverse import closure on deleted paths). */
function checkRole(root, doc, options = {}) {
  const errors = [];
  const warnings = [];
  const ref = options.ref || 'HEAD';
  const ACCEPT_RE = require('./oxe-plan-json.cjs').ACCEPT_RE;
  const coupledRules = loadCoupledScope(root, options);
  let importIndex = null;
  const getImportIndex = () => {
    if (!importIndex) importIndex = buildImportIndex(root, ref);
    return importIndex;
  };
  const deletedBefore = new Set();
  // OXB-201: edited/deleted must exist at the ref unless an earlier task creates them; a moved file gets its real path.
  const staleByIndex = new Map();
  for (const s of staleRolePaths(root, ref, (doc && doc.tasks) || [])) {
    if (!staleByIndex.has(s.index)) staleByIndex.set(s.index, []);
    staleByIndex.get(s.index).push(s);
  }
  for (const [i, t] of ((doc && doc.tasks) || []).entries()) {
    const at = `tasks[${i}]${t && t.rid ? ` (${t.rid})` : ''}`;
    if (!t || !t.rid) errors.push(`${at}: sem rid`);
    for (const c of [...(Array.isArray(t.acceptance) ? t.acceptance : []), ...(Array.isArray(t.criteria) ? t.criteria : typeof t.criteria === 'string' ? [t.criteria] : [])]) if (!ACCEPT_RE.test(String(c).trim())) errors.push(`${at}: critério em prosa "${String(c).slice(0, 50)}" — use ids A<n>`);
    for (const s of staleByIndex.get(i) || []) {
      if (options.fixStalePaths && s.suggestion) { applyStaleFix(t, s); warnings.push(`${at}: ${s.path} → ${s.suggestion} (corrigido pelo histórico de renames)`); }
      else errors.push(staleMessage(at, s, ref));
    }
    for (const p of rolePathList(t, 'created')) if (gitHas(root, ref, p)) errors.push(`${at}: ${p} já existe em ${ref} (declarado como created — é edited)`);
    const v = t.verify;
    const cmds = Array.isArray(v) ? v : v && Array.isArray(v.commands) ? v.commands : typeof v === 'string' ? [v] : [];
    if (!cmds.length && !['external_delivery', 'verify_only', 'spike'].includes(t.kind)) errors.push(`${at}: sem verify (verify.commands: ["…"])`);
    for (const c of cmds) if (typeof c !== 'string' || !c.trim() || /\.\.\.|<[^>]+>/.test(c)) errors.push(`${at}: verify "${String(c).slice(0, 60)}" não é um comando executável (placeholder)`);
    if (t.kind && !KINDS.has(t.kind) && !['external_delivery', 'verify_only', 'spike'].includes(t.kind)) warnings.push(`${at}: kind "${t.kind}" desconhecido (add|remove|move|test-only|config-only)`);

    // OXB-199: check 1-hop reverse importers of newly deleted paths
    const expandedDeleted = expandRolePaths(root, ref, t && t.deleted).filter((p) => gitHas(root, ref, p));
    const newlyDeleted = expandedDeleted.filter((p) => !deletedBefore.has(p));
    if (newlyDeleted.length) {
      const declaredScope = uniq([
        ...expandRolePaths(root, ref, t.files),
        ...expandRolePaths(root, ref, t.edited),
        ...expandRolePaths(root, ref, t.created),
        ...expandedDeleted,
      ]);
      const orphans = findOrphanImporters(getImportIndex(), newlyDeleted, declaredScope, deletedBefore);
      if (orphans.length) {
        if (options.autoCloseImports) {
          t.files = uniq([...(t.files || []).map(norm), ...orphans]);
        } else {
          errors.push(`${at}: importadores órfãos de caminhos em deleted fora de files/deleted: ${orphans.join(', ')} (adicione a files ou use --auto-close-imports)`);
        }
      }
    }
    for (const p of expandedDeleted) deletedBefore.add(p);

    if (coupledRules.length) {
      const coupledMatch = matchedCoupledRules(coupledRules, { files: t.files || [], created: t.created || [], edited: t.edited || [], deleted: t.deleted || [] });
      const coupled = coupledMatch.included;
      const declared = uniq([...(t.files || []), ...(t.edited || []), ...(t.created || [])].map(norm));
      const missing = coupled.filter((f) => !declared.includes(f));
      const notes = uniq(coupledMatch.matchedRules.map((mr) => mr.note).filter(Boolean));
      if (missing.length) {
        warnings.push(`${at}: escopo acoplado recomendado (${missing.join(', ')})${notes.length ? ` — ${notes.join('; ')}` : ''}`);
      } else {
        for (const note of notes) warnings.push(`${at}: ${note}`);
      }
    }
    if (t.proves && typeof t.proves === 'object' && !Array.isArray(t.proves)) {
      for (const [file, titles] of Object.entries(t.proves)) {
        let text = '';
        try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { errors.push(`${at}: proves cita ${file}, que não existe`); continue; }
        for (const title of Array.isArray(titles) ? titles : [titles]) {
          const exact = text.includes(`'${title}'`) || text.includes(`"${title}"`) || text.includes(`\`${title}\``);
          if (!exact) errors.push(`${at}: o título "${title}" não está em ${file} (proves exige o título exato do it/test)`);
        }
      }
    }
  }
  try {
    const rigor = require('./oxe-test-rigor.cjs');
    const roleTestFiles = [
      ...((doc && Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : []).flatMap((a) => (a && a.files) || [])),
      ...((doc && Array.isArray(doc.tasks) ? doc.tasks : []).flatMap((t) => (t && t.proves && typeof t.proves === 'object' && !Array.isArray(t.proves) ? Object.keys(t.proves) : []))),
    ];
    if (roleTestFiles.length) {
      errors.push(
        ...rigor.suspiciousRegexMessages(rigor.suspiciousRegexFindings(root, roleTestFiles)),
        ...rigor.pausedSocketMessages(rigor.pausedSocketFindings(root, roleTestFiles)),
      );
    }
  } catch { /* */ }
  return { errors, warnings };
}

module.exports = {
  build,
  checkRole,
  importedSymbols,
  assignWaves,
  kindErrors,
  renderPlanMd,
  KINDS,
  inScope,
  isDirEntry,
  expandDirEntry,
  filterDeletedFromVerifyCommand,
  transitiveDeletedForTask,
  loadCoupledScope,
  matchedCoupledRules,
  applyCoupledScope,
  injectFrontendDesignLintVerify,
  buildImportIndex,
  resolveModuleSpecifier,
  findOrphanImporters,
  findCoupledUnionConsumers,
  rolePathList,
  recentRenames,
  staleRolePaths,
  injectNoticesGate,
  pairIpcDependencies,
  sweepRemovalImpacts,
  IPC_CONTRACT_FILES,
};
