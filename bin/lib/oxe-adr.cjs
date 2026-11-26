'use strict';

/**
 * 1.21.2 — ADRs from the decision ledger. `.oxe/program/decisions.ndjson` stays the source (append-only, ids D-F2-3 /
 * D-01, `check` verified at the phase verify, alternatives that lost); this projects it into a versioned folder
 * (default `docs/adr/`, config `adr: { dir }`, `adr: false` turns it off), one file per decision plus a README index:
 *
 *   docs/adr/D-F2-3-fila-local-com-retry.md   — status, date, phase, criteria, context, decision, alternatives,
 *                                                consequences, evidence (the check), supersedes / superseded by
 *   docs/adr/README.md                        — the index, by status
 *
 * The generated part sits between markers; text a person writes outside them (discussion, links) is kept on every
 * publish. A file is named by its id plus a slug of the title at its first publish and keeps that name afterwards.
 */

const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->';
const END = '<!-- oxe-adr:end -->';
const STATUS_PT = { active: 'Aceita', superseded: 'Substituída', retired: 'Aposentada' };

function slug(text) {
  return String(text || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'decisao';
}

/** The configured ADR dir (relative to the project) or null when turned off. */
function adrDir(config) {
  const c = config && config.adr;
  if (c === false) return null;
  if (c && typeof c === 'object' && c.enabled === false) return null;
  const dir = c && typeof c === 'object' && typeof c.dir === 'string' && c.dir.trim() ? c.dir.trim() : 'docs/adr';
  return dir;
}

const date = (iso) => (iso ? String(iso).slice(0, 10) : '—');

function defaultFileName(d) {
  return d && d.id ? `${d.id}-${slug(d.title)}.md` : null;
}

function resolveFile(d, fileMap) {
  if (!d || !d.id) return null;
  if (fileMap && fileMap.has(d.id)) return fileMap.get(d.id);
  return defaultFileName(d);
}

/** The generated block of one ADR. */
function renderAdr(d, byId = new Map(), fileMap = null) {
  const status = d.status || 'active';
  const map = byId instanceof Map ? byId : new Map();
  const lines = [`# ${d.id} — ${d.title}`, ''];
  lines.push(`- **Status:** ${STATUS_PT[status] || status}${status === 'superseded' && d.superseded_by ? ` por [${d.superseded_by}](${resolveFile(map.get(d.superseded_by) || { id: d.superseded_by }, fileMap) || ''})` : ''}${d.status_reason && status !== 'active' ? ` — ${d.status_reason}` : ''}`);
  lines.push(`- **Data:** ${date(d.at)}${d.status_at && status !== 'active' ? ` · status em ${date(d.status_at)}` : ''}`);
  if (d.phase) lines.push(`- **Fase:** ${d.phase}`);
  if (Array.isArray(d.criteria) && d.criteria.length) lines.push(`- **Critérios:** ${d.criteria.join(', ')}`);
  if (Array.isArray(d.stories) && d.stories.length) lines.push(`- **Histórias:** ${d.stories.map((s) => (d.story_keys && d.story_keys[s] ? `${s} (${d.story_keys[s]})` : s)).join(', ')}`);
  lines.push(`- **Por:** ${d.by || '—'}`);
  if (d.supersedes) lines.push(`- **Substitui:** [${d.supersedes}](${resolveFile(map.get(d.supersedes) || { id: d.supersedes }, fileMap) || ''})`);
  if (d.source) lines.push(`- **Origem:** ${d.source}`);
  lines.push('');
  lines.push('## Contexto', '', d.context || '_(não registrado — `oxe-cc decision add --context "…"`)_', '');
  lines.push('## Decisão', '', d.text || d.title, '');
  if (Array.isArray(d.alternatives) && d.alternatives.length) {
    lines.push('## Alternativas consideradas', '');
    for (const a of d.alternatives) lines.push(`- **${a.text}** — recusada: ${a.reason} (por ${a.by}${a.link ? `, ${a.link}` : ''})`);
    lines.push('');
  }
  lines.push('## Consequências', '', d.consequences || '_(não registradas — `oxe-cc decision add --consequences "…"`)_', '');
  lines.push('## Evidência', '', d.check ? `O verify de cada fase que cita esta decisão roda \`${d.check}\` (gate \`decision-${d.id}\`); o \`oxe-cc docs check\` roda de novo nas fases fechadas.` : '_Sem comando de verificação: esta decisão não é conferida automaticamente._', '');
  return lines.join('\n');
}

/** Keeps the person's text outside the markers; replaces only the generated block. */
function merge(existing, block) {
  const wrapped = `${BEGIN}\n${block}\n${END}`;
  if (!existing) return `${wrapped}\n\n## Notas\n\n_(texto livre — preservado a cada publicação)_\n`;
  const b = existing.indexOf(BEGIN);
  const e = existing.indexOf(END);
  if (b < 0 || e < b) return `${wrapped}\n\n${existing}`;
  return existing.slice(0, b) + wrapped + existing.slice(e + END.length);
}

function renderIndex(decisions, fileMap = null) {
  const lines = ['# Decisões de arquitetura (ADR)', '', `Gerado de \`.oxe/program/decisions.ndjson\` pelo \`oxe-cc decision publish\`. Registre com \`oxe-cc decision add\`; substitua com \`--supersedes\`; aposente com \`oxe-cc decision status <id> retired --reason\`.`, ''];
  for (const [status, label] of [['active', 'Aceitas'], ['superseded', 'Substituídas'], ['retired', 'Aposentadas']]) {
    const group = decisions.filter((d) => (d.status || 'active') === status);
    if (!group.length) continue;
    lines.push(`## ${label}`, '', '| ID | Decisão | Fase | Data | Evidência |', '|----|---------|------|------|-----------|');
    for (const d of group) lines.push(`| [${d.id}](${resolveFile(d, fileMap)}) | ${String(d.title).replace(/\|/g, '\\|')}${d.superseded_by ? ` → ${d.superseded_by}` : ''} | ${d.phase || '—'} | ${date(d.at)} | ${d.check ? 'check' : '—'} |`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Writes the ADR files and the README index. Spikes (D-SPIKE-*) are evidence of a task, not architecture: left out.
 * @returns {{ dir: string, written: string[], unchanged: number }}
 */
function publish(projectRoot, dirRel, decisions, options = {}) {
  const rootAbs = path.resolve(projectRoot);
  const dir = path.resolve(rootAbs, String(dirRel || 'docs/adr'));
  const relRoot = path.relative(rootAbs, dir);
  if (relRoot.startsWith('..') || path.isAbsolute(relRoot)) {
    throw new Error('a pasta dos ADRs não pode ficar fora da raiz do projeto');
  }
  if (relRoot === '') throw new Error('a pasta dos ADRs não pode ser a raiz do projeto (ex.: docs/adr)');
  const relOxe = path.relative(path.join(rootAbs, '.oxe'), dir);
  if (!options.allowOxeDir && !relOxe.startsWith('..') && !path.isAbsolute(relOxe)) {
    throw new Error('a pasta dos ADRs não pode ficar dentro de .oxe/ (ela existe para ser versionada)');
  }
  const relGit = path.relative(path.join(rootAbs, '.git'), dir);
  if (!relGit.startsWith('..') && !path.isAbsolute(relGit)) {
    throw new Error('a pasta dos ADRs não pode ficar dentro de .git/');
  }
  const list = decisions.filter((d) => d && d.id && !/^D-SPIKE-/.test(d.id)).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || String(a.id).localeCompare(String(b.id)));
  // No decision → no file: an empty index is noise in somebody's commit (oxespace-152-code F1 close).
  if (!list.length) return { dir: path.relative(projectRoot, dir).replace(/\\/g, '/'), written: [], unchanged: 0 };
  fs.mkdirSync(dir, { recursive: true });
  // A file keeps the name of its first publish (the title may be reworded later).
  const present = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  const fileMap = new Map(list.map((d) => [d.id, present.find((f) => f.startsWith(`${d.id}-`) || f === `${d.id}.md`) || defaultFileName(d)]));
  const byId = new Map(list.map((d) => [d.id, d]));
  const written = [];
  let unchanged = 0;
  const put = (name, content) => {
    const p = path.join(dir, name);
    const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (before === content) { unchanged += 1; return; }
    fs.writeFileSync(p, content, 'utf8');
    written.push(path.relative(projectRoot, p).replace(/\\/g, '/'));
  };
  for (const d of list) {
    const name = fileMap.get(d.id);
    const p = path.join(dir, name);
    put(name, merge(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null, renderAdr(d, byId, fileMap)));
  }
  const readme = path.join(dir, 'README.md');
  put('README.md', merge(fs.existsSync(readme) ? fs.readFileSync(readme, 'utf8') : null, renderIndex(list, fileMap)).replace(/\n\n## Notas\n\n_\(texto livre — preservado a cada publicação\)_\n$/, '\n'));
  return { dir: path.relative(projectRoot, dir).replace(/\\/g, '/'), written, unchanged };
}

module.exports = { adrDir, publish, renderAdr, renderIndex, slug, BEGIN, END };
