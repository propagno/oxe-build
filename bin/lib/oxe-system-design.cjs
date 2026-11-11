'use strict';

/**
 * OXB-104: `.oxe/SYSTEM-DESIGN.md` — components and processes, technical and business flows, ADR-style decisions and
 * Mermaid diagrams (C4 context/container, main sequences), every section linked to R/A ids and to the paths it
 * describes by a marker line:  <!-- oxe-design: id=<section> paths=src/queue/**,src/sync.ts ids=R3,A12 -->
 * `oxe-cc design build` writes the skeleton from what the project already has (.oxe/codebase, SPEC requirements and
 * criteria, decisions.ndjson, top-level source dirs); the scan/spec workflow fills the prose. Re-running keeps the
 * prose of sections that already exist (by id) and adds the new ones.
 * OXB-105: at the phase close, a phase diff that touches the paths of a section while SYSTEM-DESIGN.md (and the
 * matching .oxe/codebase file) did not change in the phase fails the close with the stale sections; after the close a
 * structural CODEBASE-DELTA entry lists which sections and codebase maps the phase touched (the compact refreshes them).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FILE = (root) => path.join(root, '.oxe', 'SYSTEM-DESIGN.md');
const MARK_RE = /<!--\s*oxe-design:\s*id=([^\s]+)\s+paths=([^\s]*)\s+ids=([^\s]*)\s*-->/g;
const norm = (p) => String(p).replace(/\\/g, '/');
function globRe(g) { return new RegExp(`^${norm(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*')}$`); }

function requirements(specText) {
  const out = [];
  for (const m of String(specText || '').matchAll(/^\|\s*(R\d+)\s*\|\s*([^|]+?)\s*\|[^|]*\|\s*([^|]*)\|/gm)) out.push({ id: m[1], text: m[2], criteria: [...m[3].matchAll(/A\d+/g)].map((x) => x[0]) });
  for (const m of String(specText || '').matchAll(/^\s*[-*]\s+\*\*(R\d+)\*\*\s*[—:-]\s*(.+?)(?:\(([^)]*)\))?\s*$/gm)) if (!out.some((r) => r.id === m[1])) out.push({ id: m[1], text: m[2].trim(), criteria: [...String(m[3] || '').matchAll(/A\d+/g)].map((x) => x[0]) });
  return out;
}

function topDirs(root) {
  const git = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const files = git.status === 0 ? git.stdout.split(/\r?\n/).filter(Boolean) : [];
  const counts = new Map();
  for (const f of files) {
    if (f.startsWith('.oxe/') || f.startsWith('.') || !f.includes('/')) continue;
    const parts = f.split('/');
    const key = ['src', 'packages', 'apps', 'lib', 'bin', 'app', 'services'].includes(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([d]) => d);
}

function parseSections(text) {
  const out = [];
  for (const m of String(text || '').matchAll(MARK_RE)) out.push({ id: m[1], paths: m[2] ? m[2].split(',').filter(Boolean) : [], ids: m[3] ? m[3].split(',').filter(Boolean) : [] });
  return out;
}

/** The skeleton; `existing` text keeps the body of sections already written (by id). */
function build(root, ctx = {}) {
  const reqs = requirements(ctx.specText);
  const dirs = ctx.dirs || topDirs(root);
  const existing = String(ctx.existing || '');
  const bodies = new Map();
  for (const chunk of existing.split(/(?=^### )/m)) {
    const m = /<!--\s*oxe-design:\s*id=([^\s]+)/.exec(chunk);
    if (m) bodies.set(m[1], chunk.replace(/^### [^\n]*\n/, '').replace(/<!--\s*oxe-design:[^>]*-->\s*\n?/, '').trim());
  }
  const reqFor = (dir) => reqs.filter((r) => new RegExp(`\\b${path.posix.basename(dir).replace(/[-_]/g, '[-_ ]?')}\\b`, 'i').test(r.text));
  const section = (id, title, paths, ids, fallback) => [`### ${title}`, `<!-- oxe-design: id=${id} paths=${paths.join(',')} ids=${ids.join(',')} -->`, '', bodies.get(id) || fallback, ''].join('\n');
  const lines = ['# SYSTEM-DESIGN', '', '> Gerado por `oxe-cc design build` e mantido pelo scan/spec. Cada seção liga caminhos a ids R/A: o close da fase (OXB-105) recusa um diff que muda esses caminhos sem atualizar a seção.', '', '## Componentes e processos', ''];
  for (const d of dirs) {
    const rs = reqFor(d);
    lines.push(section(`component/${d.replace(/[^\w/-]+/g, '-')}`, d, [`${d}/**`], [...rs.map((r) => r.id), ...rs.flatMap((r) => r.criteria)], `_Responsabilidade, interfaces e dependências de \`${d}\` (preencher no scan)._`));
  }
  lines.push('## Fluxos técnicos e de negócio', '');
  for (const r of reqs) lines.push(section(`flow/${r.id}`, `${r.id} — ${r.text}`, [], [r.id, ...r.criteria], `_Passo a passo do fluxo de ${r.id}; ligue os caminhos em paths= quando souber._`));
  lines.push('## Decisões (estilo ADR)', '');
  for (const d of (ctx.decisions || []).filter((x) => !x.status || x.status === 'active')) {
    lines.push(section(`adr/${d.id}`, `${d.id} — ${d.title}`, [], d.criteria || [], [`- **Contexto:** ${d.text || '—'}`, `- **Decisão:** ${d.title}`, ...(d.alternatives || []).map((a) => `- **Alternativa recusada:** ${a.text} — ${a.reason} (${a.by})`), `- **Fonte:** decisions.ndjson ${d.id}, ${d.by}`].join('\n')));
  }
  lines.push('## Diagramas', '', '### C4 — contexto e containers', '<!-- oxe-design: id=diagram/c4 paths= ids= -->', '', '```mermaid', 'flowchart LR', '  user([Usuário]) --> system[Sistema]', ...dirs.map((d, i) => `  system --> c${i}[${d}]`), '```', '');
  const seqReqs = reqs.slice(0, 3);
  if (seqReqs.length) {
    lines.push('### Sequências principais', '<!-- oxe-design: id=diagram/sequences paths= ids=' + seqReqs.map((r) => r.id).join(',') + ' -->', '');
    for (const r of seqReqs) lines.push('```mermaid', 'sequenceDiagram', `  title ${r.id}`, '  participant U as Usuário', '  participant S as Sistema', `  U->>S: ${r.text.replace(/[;:]/g, ',').slice(0, 80)}`, '  S-->>U: resultado', '```', '');
  }
  return lines.join('\n');
}

/** OXB-105: sections whose paths the phase diff touched while the design doc did not change. */
function staleSections(root, base, options = {}) {
  const text = (() => { try { return fs.readFileSync(FILE(root), 'utf8'); } catch { return null; } })();
  if (text == null || !base) return { enabled: false, stale: [] };
  const r = spawnSync('git', ['diff', '--name-only', `${base}`, '--'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const changed = String(r.stdout || '').split(/\r?\n/).filter(Boolean).map(norm);
  // .oxe/ is often git-ignored: the document also counts as changed when written after the phase started.
  let mtimeChanged = false;
  try { mtimeChanged = Boolean(options.since) && fs.statSync(FILE(root)).mtimeMs > Date.parse(options.since); } catch { mtimeChanged = false; }
  const designChanged = options.designChanged === true || (options.designChanged !== false && (changed.includes('.oxe/SYSTEM-DESIGN.md') || mtimeChanged));
  const touched = changed.filter((f) => !f.startsWith('.oxe/'));
  const stale = [];
  for (const s of parseSections(text)) {
    if (!s.paths.length) continue;
    const res = s.paths.map(globRe);
    const hit = touched.filter((f) => res.some((re) => re.test(f)));
    if (hit.length && !designChanged) stale.push({ section: s.id, files: hit.slice(0, 5), ids: s.ids });
  }
  return { enabled: true, stale, changed: touched };
}

/** After the close: which design sections and codebase maps the phase touched — appended to CODEBASE-DELTA.md. */
function deltaEntry(root, phase, base) {
  const st = staleSections(root, base, { designChanged: false });
  if (!st.enabled) return null;
  const text = fs.readFileSync(FILE(root), 'utf8');
  const touchedSections = parseSections(text).filter((s) => s.paths.length && (st.changed || []).some((f) => s.paths.some((g) => globRe(g).test(f)))).map((s) => s.id);
  const entry = [`## ${new Date().toISOString().slice(0, 10)} — close da ${phase}`, '', `- Arquivos mudados na fase: ${(st.changed || []).length}`, `- Seções do SYSTEM-DESIGN tocadas: ${touchedSections.join(', ') || '—'}`, '- Próximo: o compact (`/oxe-compact`) atualiza os mapas de `.oxe/codebase/` destas áreas.', ''].join('\n');
  const file = path.join(root, '.oxe', 'CODEBASE-DELTA.md');
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# CODEBASE-DELTA\n\n';
  fs.writeFileSync(file, `${prev.replace(/\s*$/, '\n\n')}${entry}`);
  return { file, sections: touchedSections };
}

module.exports = { FILE, requirements, build, parseSections, staleSections, deltaEntry, topDirs };
