'use strict';

/**
 * 1.21.2 (OXB-058): edits of SPEC.md and ROADMAP.md that used to be done by hand or by one-off scripts.
 *
 * Pure text functions (no I/O): amend a criterion row, add a criterion or a requirement row, insert a ROADMAP phase
 * and renumber the later phases. The CLI layer (oxe-operational) reads/writes the files and records each edit in
 * `program/changes.ndjson`.
 */

const EOL_RE = /\r?\n/;

function eolOf(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

function joinRow(cells) {
  return `| ${cells.join(' | ')} |`;
}

const isSeparator = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c));

/**
 * Finds the markdown tables whose header matches `headerTest`. Returns line ranges and the header cells.
 * @returns {Array<{ header: string[], headerLine: number, firstRow: number, lastRow: number }>}
 */
function findTables(lines, headerTest) {
  const out = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = splitRow(lines[i]);
    const sep = splitRow(lines[i + 1]);
    if (!header || !sep || !isSeparator(sep) || !headerTest(header)) continue;
    let last = i + 1;
    while (last + 1 < lines.length && splitRow(lines[last + 1])) last += 1;
    out.push({ header, headerLine: i, firstRow: i + 2, lastRow: last });
    i = last;
  }
  return out;
}

const isCriteriaHeader = (h) => /^id$/i.test(h[0] || '') && /crit[ée]rio|criterion/i.test(h[1] || '');
const isRequirementsHeader = (h) => /^r-?id$/i.test(h[0] || '') && /requisito|requirement/i.test(h[1] || '');

function idsInTables(lines, tables, prefix) {
  const ids = [];
  for (const t of tables) {
    for (let i = t.firstRow; i <= t.lastRow; i += 1) {
      const cells = splitRow(lines[i]);
      const id = cells && cells[0] ? cells[0].replace(/\*/g, '').trim().toUpperCase() : '';
      if (new RegExp(`^${prefix}\\d+$`).test(id)) ids.push(id);
    }
  }
  return ids;
}

const idNumber = (id) => Number(String(id).replace(/\D/g, ''));

/** Unique and without gaps: the new id must not exist and must be the next number (unless `allowGap`). */
function checkNewId(existing, id, prefix, allowGap) {
  const norm = String(id || '').trim().toUpperCase();
  if (!new RegExp(`^${prefix}\\d+$`).test(norm)) throw new Error(`id inválido: ${id} (use ${prefix}<n>)`);
  if (existing.includes(norm)) throw new Error(`${norm} já existe na SPEC`);
  const max = existing.reduce((m, e) => Math.max(m, idNumber(e)), 0);
  if (!allowGap && idNumber(norm) !== max + 1) {
    throw new Error(`${norm} deixa um buraco na numeração (o próximo é ${prefix}${max + 1}); use --allow-gap se for intencional`);
  }
  return norm;
}

function criteriaIds(specText) {
  const lines = String(specText || '').split(EOL_RE);
  const tables = findTables(lines, isCriteriaHeader);
  // OXB-037: A<n>, its subcriteria A<n>.<m> and the global G<n>.
  const ids = [];
  for (const t of tables) {
    for (let i = t.firstRow; i <= t.lastRow; i += 1) {
      const cells = splitRow(lines[i]);
      const id = cells && cells[0] ? cells[0].replace(/\*/g, '').trim().toUpperCase() : '';
      if (/^(?:A\d+(?:\.\d+)?|G\d+)$/.test(id)) ids.push(id);
    }
  }
  return ids;
}

// OXB-075: requirements written as bullets — `- **R10** — text (A1, A2)`, possibly with indented continuation lines.
const REQ_BULLET_RE = /^(\s*)([-*])\s+\*\*(R\d+)\*\*\s*([—–:-])\s*/;

/** Bullet requirements: ids, and the line after the last bullet's block (its indented continuation included). */
function bulletRequirements(lines) {
  const ids = [];
  let last = -1;
  let indent = '';
  let marker = '-';
  let sep = '—';
  for (let i = 0; i < lines.length; i += 1) {
    const m = REQ_BULLET_RE.exec(lines[i]);
    if (!m) continue;
    ids.push(m[3].toUpperCase());
    last = i;
    [, indent, marker, , sep] = m;
  }
  if (last < 0) return { ids, insertAt: -1, indent, marker, sep };
  let end = last + 1;
  while (end < lines.length && lines[end].trim() && /^\s+/.test(lines[end]) && !REQ_BULLET_RE.test(lines[end])) end += 1;
  return { ids, insertAt: end, indent, marker, sep };
}

function requirementIds(specText) {
  const lines = String(specText || '').split(EOL_RE);
  return [...new Set([...idsInTables(lines, findTables(lines, isRequirementsHeader), 'R'), ...bulletRequirements(lines).ids])];
}

/**
 * Amends criterion `id`: `text` replaces the criterion; `append` adds a clause to it; `verify` replaces "Como verificar".
 * @returns {{ text: string, before: string, after: string }}
 */
function amendCriterion(specText, id, change = {}) {
  const eol = eolOf(specText);
  const lines = String(specText).split(EOL_RE);
  const key = String(id || '').trim().toUpperCase();
  const tables = findTables(lines, isCriteriaHeader);
  if (!tables.length) throw new Error('SPEC sem tabela de critérios de aceite (| ID | Critério | Como verificar |)');
  if (!change.text && !change.append && !change.verify) throw new Error('informe --text <novo critério>, --append <cláusula> ou --verify <como verificar>');
  for (const t of tables) {
    for (let i = t.firstRow; i <= t.lastRow; i += 1) {
      const cells = splitRow(lines[i]);
      if (!cells || cells[0].replace(/\*/g, '').trim().toUpperCase() !== key) continue;
      const before = lines[i];
      const next = [...cells];
      while (next.length < t.header.length) next.push('');
      if (change.text) next[1] = String(change.text).trim();
      if (change.append) next[1] = `${next[1].replace(/[.;\s]+$/, '')}; ${String(change.append).trim()}`;
      if (change.verify) next[2] = String(change.verify).trim();
      lines[i] = joinRow(next);
      return { text: lines.join(eol), before, after: lines[i] };
    }
  }
  throw new Error(`${key} não está na tabela de critérios da SPEC`);
}

/** Adds criterion row `| id | text | verify |` at the end of the criteria table. */
function addCriterion(specText, id, change = {}) {
  const eol = eolOf(specText);
  const lines = String(specText).split(EOL_RE);
  const tables = findTables(lines, isCriteriaHeader);
  if (!tables.length) throw new Error('SPEC sem tabela de critérios de aceite (| ID | Critério | Como verificar |)');
  if (!change.text) throw new Error('informe --text <critério>');
  if (!change.verify) throw new Error('informe --verify <como verificar> (critério sem verificação não fecha)');
  // OXB-037: a subcriterion A19.3 needs its parent; a subcriterion or a global G<n> only has to be new.
  const wanted = String(id || '').trim().toUpperCase();
  let key;
  if (/^A\d+\.\d+$/.test(wanted) || /^G\d+$/.test(wanted)) {
    const all = criteriaIds(lines.join('\n'));
    if (all.includes(wanted)) throw new Error(`${wanted} já existe na SPEC`);
    if (/^A\d+\.\d+$/.test(wanted) && !all.includes(wanted.replace(/\.\d+$/, ''))) throw new Error(`${wanted}: o critério pai ${wanted.replace(/\.\d+$/, '')} não existe na SPEC`);
    key = wanted;
  } else {
    key = checkNewId(idsInTables(lines, tables, 'A'), id, 'A', change.allowGap);
  }
  const t = tables[tables.length - 1];
  const cells = [key, String(change.text).trim(), String(change.verify).trim()];
  while (cells.length < t.header.length) cells.push('');
  const row = joinRow(cells);
  lines.splice(t.lastRow + 1, 0, row);
  return { text: lines.join(eol), id: key, before: null, after: row };
}

/**
 * Adds requirement row `| id | text | version | criteria |` to the requirements table. Without one, `before` names the
 * heading (e.g. "### Fora do escopo") above which a new requirements table is created.
 */
function addRequirement(specText, id, change = {}) {
  const eol = eolOf(specText);
  const lines = String(specText).split(EOL_RE);
  if (!change.text) throw new Error('informe --text <requisito>');
  const tables = findTables(lines, isRequirementsHeader);
  const bullets = bulletRequirements(lines);
  const key = checkNewId([...new Set([...idsInTables(lines, tables, 'R'), ...bullets.ids])], id, 'R', change.allowGap);
  const criteria = (Array.isArray(change.criteria) ? change.criteria : String(change.criteria || '').split(','))
    .map((c) => c.trim().toUpperCase()).filter(Boolean).join(', ');
  const values = [key, String(change.text).trim(), change.version || 'v1', criteria || '—'];
  // OXB-075: the SPEC lists requirements as bullets → append a bullet in the same style, after the last one's block.
  if (!tables.length && bullets.insertAt >= 0) {
    const row = `${bullets.indent}${bullets.marker} **${key}** ${bullets.sep} ${String(change.text).trim().replace(/\s*\.$/, '')}${criteria ? ` (${criteria})` : ''}`;
    lines.splice(bullets.insertAt, 0, row);
    return { text: lines.join(eol), id: key, before: null, after: row };
  }
  if (tables.length) {
    const t = tables[tables.length - 1];
    const cells = values.slice(0, Math.max(2, t.header.length));
    while (cells.length < t.header.length) cells.push('');
    const row = joinRow(cells);
    lines.splice(t.lastRow + 1, 0, row);
    return { text: lines.join(eol), id: key, before: null, after: row };
  }
  if (!change.before) throw new Error('SPEC sem tabela de requisitos (| R-ID | Requisito | …); use --before "<cabeçalho>" para criar uma');
  const at = lines.findIndex((l) => l.trim() === String(change.before).trim());
  if (at < 0) throw new Error(`cabeçalho não encontrado na SPEC: ${change.before}`);
  const row = joinRow(values);
  lines.splice(at, 0, '| R-ID | Requisito | Versão | Critério de aceite |', '|------|-----------|--------|--------------------|', row, '');
  return { text: lines.join(eol), id: key, before: null, after: row };
}

const PHASE_HEADING = /^(##\s+)(Fase|Phase)(\s+)(\d+)(\b.*)$/i;

/**
 * Inserts `## Fase <after+1> — title` after phase `after` and renumbers the later phase headings (+1).
 * @returns {{ text: string, renumbered: Array<{from:string,to:string}> }}
 */
function insertRoadmapPhase(roadmapText, after, phase) {
  const eol = eolOf(roadmapText);
  const lines = String(roadmapText).split(EOL_RE);
  const n = Number(String(after).replace(/\D/g, ''));
  const headings = lines.map((l, i) => ({ i, m: PHASE_HEADING.exec(l) })).filter((h) => h.m);
  const target = headings.find((h) => Number(h.m[4]) === n);
  if (!target) throw new Error(`ROADMAP sem "## Fase ${n}"`);
  const renumbered = [];
  for (const h of headings) {
    const k = Number(h.m[4]);
    if (k <= n) continue;
    lines[h.i] = `${h.m[1]}${h.m[2]}${h.m[3]}${k + 1}${h.m[5]}`;
    renumbered.push({ from: `F${k}`, to: `F${k + 1}` });
  }
  // End of the target phase block: the next phase heading, or the next `---` / `## ` section after it.
  let end = lines.length;
  for (let i = target.i + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) { end = i; break; }
  }
  while (end > target.i + 1 && lines[end - 1].trim() === '') end -= 1;
  const word = target.m[2];
  const block = [
    '',
    `## ${word} ${n + 1} — ${String(phase.title || '').trim()}`,
    '',
    `**Requisitos:** ${(phase.requirements || []).join(', ') || '—'}`,
    `**Critérios de aceite:** ${(phase.acceptance || []).join(', ') || '—'}`,
    `**Escopo:** ${String(phase.scope || phase.title || '').trim()}`,
  ];
  lines.splice(end, 0, ...block);
  return { text: lines.join(eol), renumbered };
}

/**
 * OXB-076: rewrites one phase's section in the ROADMAP — header title, `**Requisitos:**`, `**Critérios de aceite:**`
 * and `**Escopo:**` (a missing line is added after the last field line). Only the fields given change.
 * @param {{ title?: string, requirements?: string[], acceptance?: string[], scope?: string }} fields
 */
function editRoadmapPhase(roadmapText, phaseId, fields) {
  const eol = eolOf(roadmapText);
  const lines = String(roadmapText).split(EOL_RE);
  const n = Number(String(phaseId).replace(/\D/g, ''));
  const start = lines.findIndex((l) => { const m = PHASE_HEADING.exec(l); return m && Number(m[4]) === n; });
  if (start < 0) throw new Error(`ROADMAP sem "## Fase ${n}"`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) if (/^##\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) { end = i; break; }
  if (fields.title != null) {
    const m = PHASE_HEADING.exec(lines[start]);
    lines[start] = `${m[1]}${m[2]}${m[3]}${m[4]} — ${String(fields.title).trim()}`;
  }
  const setField = (labelRe, label, value) => {
    for (let i = start + 1; i < end; i += 1) {
      if (labelRe.test(lines[i])) { lines[i] = `**${label}:** ${value}`; return; }
    }
    let at = start + 1;
    for (let i = start + 1; i < end; i += 1) if (/^\*\*[^*]+:\*\*/.test(lines[i])) at = i + 1;
    if (at === start + 1 && lines[at] !== undefined && !lines[at].trim()) at += 1;
    lines.splice(at, 0, `**${label}:** ${value}`);
    end += 1;
  };
  if (fields.requirements) setField(/^\*\*(Requisitos|Requirements):\*\*/i, 'Requisitos', fields.requirements.join(', ') || '—');
  if (fields.acceptance) setField(/^\*\*(Crit[ée]rios de aceite|Acceptance(?: criteria)?):\*\*/i, 'Critérios de aceite', fields.acceptance.join(', ') || '—');
  if (fields.scope != null) setField(/^\*\*(Escopo|Scope):\*\*/i, 'Escopo', String(fields.scope).trim());
  // OXB-033: `**Depende de:**` — null removes the line (serial default), [] writes "—" (no dependency).
  if (fields.dependsOn !== undefined) {
    const re = /^\*\*(Depende de|Depends on|Dependências|Dependencies):\*\*/i;
    if (fields.dependsOn === null) {
      for (let i = start + 1; i < end; i += 1) if (re.test(lines[i])) { lines.splice(i, 1); end -= 1; break; }
    } else setField(re, 'Depende de', fields.dependsOn.length ? fields.dependsOn.join(', ') : '—');
  }
  // OXB-082: a new scope REPLACES the section's scope bullets (the list right after the field lines). Keeping the old
  // bullets under a new **Escopo:** left F3 contradicting itself. `keepBullets` keeps them; `scopeBullets` sets new ones.
  let removedBullets = [];
  if (fields.scope != null && !fields.keepBullets) {
    let i = start + 1;
    while (i < end && (/^\*\*[^*]+:\*\*/.test(lines[i]) || !lines[i].trim())) i += 1;
    const listStart = i;
    let listEnd = listStart;
    while (listEnd < end) {
      const l = lines[listEnd];
      if (/^\s*[-*+]\s+/.test(l) || (/^\s{2,}\S/.test(l) && listEnd > listStart)) { listEnd += 1; continue; }
      // A blank line inside the list (another bullet follows) belongs to it.
      if (!l.trim() && listEnd > listStart && listEnd + 1 < end && /^\s*[-*+]\s+/.test(lines[listEnd + 1])) { listEnd += 1; continue; }
      break;
    }
    if (listEnd > listStart) {
      removedBullets = lines.slice(listStart, listEnd).filter((l) => /^\s*[-*+]\s+/.test(l)).map((l) => l.trim());
      const replacement = Array.isArray(fields.scopeBullets) ? fields.scopeBullets.map((b) => `- ${String(b).replace(/^\s*[-*+]\s+/, '').trim()}`) : [];
      // No new list: the blank line after the old one goes too (no double blank before the next block).
      if (!replacement.length && listEnd < end && !lines[listEnd].trim()) listEnd += 1;
      lines.splice(listStart, listEnd - listStart, ...replacement);
      end += replacement.length - (listEnd - listStart);
    } else if (Array.isArray(fields.scopeBullets) && fields.scopeBullets.length) {
      let at = start + 1;
      for (let k = start + 1; k < end; k += 1) if (/^\*\*[^*]+:\*\*/.test(lines[k])) at = k + 1;
      const block = ['', ...fields.scopeBullets.map((b) => `- ${String(b).replace(/^\s*[-*+]\s+/, '').trim()}`)];
      lines.splice(at, 0, ...block);
      end += block.length;
    }
  }
  return { text: lines.join(eol), removed_bullets: removedBullets };
}

/**
 * OXB-082: `--scope-file scope.md`: the non-bullet lines are the **Escopo:** text (joined), the bullets are the new list.
 * @returns {{ scope: string, bullets: string[] }}
 */
function parseScopeFile(text) {
  const lines = String(text || '').replace(/<!--[\s\S]*?-->/g, '').split(EOL_RE);
  const bullets = [];
  const prose = [];
  for (const l of lines) {
    if (/^\s*[-*+]\s+/.test(l)) bullets.push(l.replace(/^\s*[-*+]\s+/, '').trim());
    else if (/^\s{2,}\S/.test(l) && bullets.length) bullets[bullets.length - 1] += ` ${l.trim()}`;
    else if (l.trim() && !/^#/.test(l.trim())) prose.push(l.trim().replace(/^\*\*(Escopo|Scope):\*\*\s*/i, ''));
  }
  return { scope: prose.join(' ').trim(), bullets };
}

/** Textual mentions of renumbered phases left in a document ("F8", "Fase 8", "phase F8"). */
function leftoverPhaseMentions(text, renumbered, file) {
  const out = [];
  const lines = String(text || '').split(EOL_RE);
  for (const { from } of renumbered) {
    const k = from.slice(1);
    const re = new RegExp(`\\b(?:${from}|(?:fase|phase)\\s+F?${k})\\b`, 'i');
    lines.forEach((line, idx) => {
      if (PHASE_HEADING.test(line)) return;
      if (re.test(line)) out.push(`${file}:${idx + 1}: menciona ${from} (agora renumerada) — ${line.trim().slice(0, 120)}`);
    });
  }
  return out;
}

module.exports = {
  amendCriterion,
  addCriterion,
  addRequirement,
  criteriaIds,
  requirementIds,
  insertRoadmapPhase,
  editRoadmapPhase,
  parseScopeFile,
  leftoverPhaseMentions,
  checkNewId,
};
