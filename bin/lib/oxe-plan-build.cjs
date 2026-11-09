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
const CONFIG_FILE_RE = /\.(json|ya?ml|toml|ini|env|cfg|conf|properties)$|(^|\/)\.[a-z]+rc(\.[a-z]+)?$|(^|\/)(Dockerfile|Makefile)$/i;
const CODE_RE = /\.(c|m)?[jt]sx?$|\.(py|go|rs|java|kt|kts|swift|rb|cs|cpp|c|h|php|scala|vue|svelte)$/i;
const KINDS = new Set(['add', 'remove', 'move', 'test-only', 'config-only']);
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

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
  const moves = Array.isArray(role.moves) ? role.moves.map((m) => ({ from: norm(m.from), to: norm(m.to) })) : [];
  const exact = uniq([...(task.files || []).map(norm), ...deleted, ...created, ...edited, ...moves.flatMap((m) => [m.from, m.to])]).filter((f) => !frozenFiles.has(f));
  const symbols = [];
  for (const t of frozenTests) for (const s of importedSymbols(root, t, exact)) if (!symbols.some((x) => x.name === s.name && x.path === s.path)) symbols.push(s);
  const entry = { id: task.id, mode: 'mutating', write_set: 'closed', exact_paths: exact, symbols, contracts: [], expected_checks: (task.verify && task.verify.commands) || [], ...(task.phase ? { phase: task.phase } : {}) };
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

/** inputs: [{ file, doc }]; ctx: { root, phase }. */
function build(inputs, ctx = {}) {
  const root = ctx.root || process.cwd();
  const res = merge.mergeRolePlans(inputs, { key: ctx.key || 'rid' });
  const errors = [...res.errors];
  const warnings = [...res.warnings];
  const plan = res.plan;
  const frozenFiles = new Set((plan.acceptance_tests || []).flatMap((a) => (a.files || []).map(norm)));
  // role-level path declarations by key
  const roleByKey = new Map();
  for (const { doc } of inputs) for (const t of (doc && doc.tasks) || []) {
    const k = String(t.rid || t[ctx.key || 'rid'] || '');
    const cur = roleByKey.get(k) || { deleted: [], created: [], edited: [], moves: [] };
    for (const f of ['deleted', 'created', 'edited']) cur[f].push(...(Array.isArray(t[f]) ? t[f] : []));
    cur.moves.push(...(Array.isArray(t.moves) ? t.moves : []));
    roleByKey.set(k, cur);
  }
  for (const t of plan.tasks) {
    const before = t.files.length;
    const r = roleByKey.get(String(t.rid)) || {};
    t.files = uniq([...t.files.map(norm), ...(r.created || []).map(norm), ...(r.edited || []).map(norm), ...(r.deleted || []).map(norm), ...(r.moves || []).flatMap((m) => [norm(m.from), norm(m.to)])]).filter((f) => !frozenFiles.has(f));
    if (before && t.files.length < before) warnings.push(`${t.id}: arquivos de aceite congelados tirados do escopo`);
    if (ctx.phase) t.phase = ctx.phase;
  }
  assignWaves(plan.tasks);
  const pack = { schema_version: 1, generated_by: 'oxe-cc plan build', ...(ctx.phase ? { phase: ctx.phase } : {}), tasks: [] };
  for (const t of plan.tasks) {
    const tests = (plan.acceptance_tests || []).filter((a) => (t.acceptance || []).includes(a.criterion)).flatMap((a) => a.files || []);
    const info = packEntry(root, t, roleByKey.get(String(t.rid)) || {}, frozenFiles, tests);
    errors.push(...kindErrors(t, info));
    const removed = new Set(info.entry.removed_paths || []);
    const uncovered = info.exact.filter((p) => CODE_RE.test(p) && !removed.has(p));
    if (!info.entry.symbols.length && uncovered.length && !['test-only', 'config-only'].includes(info.kind)) warnings.push(`${t.id}: nenhum símbolo saiu dos testes congelados para ${uncovered.slice(0, 3).join(', ')} — declare symbols no pack antes do execute`);
    pack.tasks.push(info.entry);
  }
  if (ctx.phase) plan.phase = ctx.phase;
  return { plan, pack, planMd: renderPlanMd(plan, ctx.phase), errors, warnings, map: res.map };
}

function gitHas(root, ref, p) { return spawnSync('git', ['cat-file', '-e', `${ref}:${norm(p)}`], { cwd: root, windowsHide: true }).status === 0; }

/** OXB-098: problems of one role file. */
function checkRole(root, doc, options = {}) {
  const errors = [];
  const warnings = [];
  const ref = options.ref || 'HEAD';
  const ACCEPT_RE = require('./oxe-plan-json.cjs').ACCEPT_RE;
  for (const [i, t] of ((doc && doc.tasks) || []).entries()) {
    const at = `tasks[${i}]${t && t.rid ? ` (${t.rid})` : ''}`;
    if (!t || !t.rid) errors.push(`${at}: sem rid`);
    for (const c of [...(Array.isArray(t.acceptance) ? t.acceptance : []), ...(Array.isArray(t.criteria) ? t.criteria : typeof t.criteria === 'string' ? [t.criteria] : [])]) if (!ACCEPT_RE.test(String(c).trim())) errors.push(`${at}: critério em prosa "${String(c).slice(0, 50)}" — use ids A<n>`);
    for (const p of [...(t.deleted || []), ...(t.edited || [])]) if (!gitHas(root, ref, p)) errors.push(`${at}: ${p} não existe em ${ref} (declarado como ${(t.deleted || []).includes(p) ? 'deleted' : 'edited'})`);
    for (const p of t.created || []) if (gitHas(root, ref, p)) errors.push(`${at}: ${p} já existe em ${ref} (declarado como created — é edited)`);
    const v = t.verify;
    const cmds = Array.isArray(v) ? v : v && Array.isArray(v.commands) ? v.commands : typeof v === 'string' ? [v] : [];
    if (!cmds.length && !['external_delivery', 'verify_only', 'spike'].includes(t.kind)) errors.push(`${at}: sem verify (verify.commands: ["…"])`);
    for (const c of cmds) if (typeof c !== 'string' || !c.trim() || /\.\.\.|<[^>]+>/.test(c)) errors.push(`${at}: verify "${String(c).slice(0, 60)}" não é um comando executável (placeholder)`);
    if (t.kind && !KINDS.has(t.kind) && !['external_delivery', 'verify_only', 'spike'].includes(t.kind)) warnings.push(`${at}: kind "${t.kind}" desconhecido (add|remove|move|test-only|config-only)`);
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
  return { errors, warnings };
}

module.exports = { build, checkRole, importedSymbols, assignWaves, kindErrors, renderPlanMd, KINDS };
