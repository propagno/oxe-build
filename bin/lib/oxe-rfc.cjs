'use strict';

/**
 * 1.21.2 — RFCs: the technical proposal a risky phase writes BEFORE its plan. `.oxe/rfc/RFC-<fase>-<n>-<slug>.md`
 * (template oxe/templates/RFC.template.md): summary, motivation (US/R/A), proposal, alternatives that lost, risks,
 * rollout and rollback, open questions. Status: rascunho → aceito | recusado | substituído.
 *
 * `accept` refuses while "Perguntas em aberto" has a real item, then records the decision in the ledger (the ADR):
 * title = the RFC's, context = motivation, decision = proposal, consequences = risks, alternatives = the ones listed.
 *
 * Gate (`plan lint` of a phase): a phase that has a P0/P1 criterion (the SPEC's Risco column) needs an accepted RFC.
 * Advisory by default (warning); `rfc: { required: "risk" }` makes it an error, `"always"` requires one for every
 * phase, `"never"` turns the check off.
 */

const fs = require('fs');
const path = require('path');

const STATUS = { rascunho: 'draft', draft: 'draft', aceito: 'accepted', aceita: 'accepted', accepted: 'accepted', recusado: 'rejected', recusada: 'rejected', rejected: 'rejected', 'substituído': 'superseded', substituido: 'superseded', superseded: 'superseded' };
const STATUS_PT = { draft: 'rascunho', accepted: 'aceito', rejected: 'recusado', superseded: 'substituído' };
const ID_RE = /^RFC-(?:(F\d+)-)?(\d+)$/i;
const PLACEHOLDER = /^\(.*\)$|^—$|^-$|^…$/;

const slug = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'proposta';

function section(text, title) {
  const lines = String(text || '').split(/\r?\n/);
  const i = lines.findIndex((l) => new RegExp(`^##\\s+${title}`, 'i').test(l.trim()));
  if (i < 0) return '';
  const out = [];
  for (let j = i + 1; j < lines.length && !/^##\s/.test(lines[j].trim()); j += 1) out.push(lines[j]);
  return out.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
}

const meta = (text, key) => { const m = new RegExp(`^- \\*\\*${key}:\\*\\*\\s*(.+)$`, 'mi').exec(String(text || '')); return m ? m[1].trim() : null; };
const bullets = (body) => body.split(/\r?\n/).map((l) => /^\s*[-*]\s+(.*)$/.exec(l)).filter(Boolean).map((m) => m[1].trim()).filter((b) => b && !PLACEHOLDER.test(b) && !/^\(nenhuma/i.test(b));

function parseRfc(text, file = null) {
  const head = /^#\s+(RFC-[\w-]+?)\s+[—-]\s+(.+)$/m.exec(String(text || ''));
  const statusRaw = (meta(text, 'Status') || 'rascunho').toLowerCase().split(/[\s(—-]/)[0];
  const alternatives = bullets(section(text, 'Alternativas')).map((b) => {
    const m = /^\*\*(.+?)\*\*\s*[—–-]+\s*(.+)$/.exec(b);
    return m ? { text: m[1].trim(), reason: m[2].trim() } : null;
  }).filter((a) => a && !PLACEHOLDER.test(a.text));
  return {
    id: head ? head[1].toUpperCase() : (file ? path.basename(file).replace(/^(RFC-(?:F\d+-)?\d+).*$/i, '$1').toUpperCase() : null),
    title: head ? head[2].trim() : null,
    status: STATUS[statusRaw] || 'draft',
    phase: (meta(text, 'Fase') || '').replace(/^—$/, '') || null,
    by: meta(text, 'Autor'),
    decision: /^D-[\w-]+$/.test(meta(text, 'Decisão') || '') ? meta(text, 'Decisão') : null,
    summary: section(text, 'Resumo'),
    motivation: section(text, 'Motiva'),
    proposal: section(text, 'Proposta'),
    risks: section(text, 'Riscos'),
    rollout: section(text, 'Implanta'),
    alternatives,
    open_questions: bullets(section(text, 'Perguntas em aberto')),
    file,
  };
}

const dirOf = (projectRoot) => path.join(projectRoot, '.oxe', 'rfc');

function list(projectRoot) {
  const dir = dirOf(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^RFC-.*\.md$/i.test(f)).sort().map((f) => parseRfc(fs.readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f)));
}

function create(projectRoot, input = {}) {
  const title = String(input.title || '').trim();
  if (title.length < 4) throw new Error('informe o título da proposta (--title "…")');
  const phase = input.phase ? String(input.phase).toUpperCase() : null;
  const existing = list(projectRoot);
  const n = existing.reduce((m, r) => { const hit = ID_RE.exec(r.id || ''); return hit && (hit[1] || null) === phase ? Math.max(m, Number(hit[2])) : m; }, 0) + 1;
  const id = phase ? `RFC-${phase}-${n}` : `RFC-${n}`;
  const tplPath = path.join(__dirname, '..', '..', 'oxe', 'templates', 'RFC.template.md');
  const tpl = fs.readFileSync(tplPath, 'utf8');
  const text = tpl.replace(/\{\{id\}\}/g, id).replace(/\{\{title\}\}/g, title).replace(/\{\{phase\}\}/g, phase || '—').replace(/\{\{by\}\}/g, String(input.by || 'usuário')).replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dirOf(projectRoot), { recursive: true });
  const file = path.join(dirOf(projectRoot), `${id}-${slug(title)}.md`);
  fs.writeFileSync(file, text, 'utf8');
  return { id, file };
}

function find(projectRoot, id) {
  const r = list(projectRoot).find((x) => x.id === String(id || '').toUpperCase());
  if (!r) throw new Error(`${id}: RFC inexistente (oxe-cc rfc list)`);
  return r;
}

function setMeta(file, key, value) {
  const text = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`^(- \\*\\*${key}:\\*\\*)\\s*.*$`, 'mi');
  fs.writeFileSync(file, re.test(text) ? text.replace(re, `$1 ${value}`) : text.replace(/^(#\s+RFC-.*)$/m, `$1\n\n- **${key}:** ${value}`), 'utf8');
}

/**
 * Accepts an RFC: no open question left; records the decision (D-…) with the RFC's alternatives; the RFC points at it.
 * @param {(input: object) => { id: string }} recordDecision — adds to the ledger (operational passes runtimeDecision)
 */
function accept(projectRoot, id, options = {}, recordDecision) {
  const r = find(projectRoot, id);
  if (r.status === 'accepted') throw new Error(`${r.id} já está aceito (${r.decision || 'sem decisão'})`);
  if (r.status !== 'draft') throw new Error(`${r.id} está ${STATUS_PT[r.status]} — só um rascunho pode ser aceito`);
  if (r.open_questions.length && !options.force) throw new Error(`${r.id} tem ${r.open_questions.length} pergunta(s) em aberto: ${r.open_questions.slice(0, 3).join(' | ')} — responda antes de aceitar`);
  if (!r.proposal || PLACEHOLDER.test(r.proposal)) throw new Error(`${r.id}: a seção Proposta está vazia`);
  const decision = recordDecision({
    title: r.title,
    phase: r.phase,
    context: r.motivation || r.summary || null,
    text: r.proposal,
    consequences: r.risks || null,
    alternatives: r.alternatives.map((a) => `${a.text}::${a.reason}`),
    by: options.by || r.by || 'usuário',
    source: r.id,
  });
  setMeta(r.file, 'Status', `aceito (${new Date().toISOString().slice(0, 10)}${options.by ? `, por ${options.by}` : ''})`);
  setMeta(r.file, 'Decisão', decision.id);
  return { rfc: r.id, decision: decision.id, file: r.file };
}

function reject(projectRoot, id, options = {}) {
  const r = find(projectRoot, id);
  const reason = String(options.reason || '').trim();
  if (reason.length < 4) throw new Error('informe o motivo (--reason "…")');
  if (r.status !== 'draft') throw new Error(`${r.id} está ${STATUS_PT[r.status]}`);
  setMeta(r.file, 'Status', `recusado — ${reason}`);
  return { rfc: r.id, status: 'rejected' };
}

/**
 * Does this phase need an accepted RFC, and does it have one?
 * @param {{ phase: string|null, phaseCriteria: string[], risks: Map<string,string>, mode?: string }} ctx
 * @returns {{ errors: string[], warnings: string[] }}
 */
function lintPhaseRfc(projectRoot, ctx = {}) {
  const errors = [];
  const warnings = [];
  const mode = ctx.mode || 'advisory';
  if (mode === 'never' || !ctx.phase) return { errors, warnings };
  const risky = (ctx.phaseCriteria || []).filter((a) => /^P[01]$/.test(String((ctx.risks && ctx.risks.get(a)) || '')));
  const needed = mode === 'always' || risky.length > 0;
  if (!needed) return { errors, warnings };
  const rfcs = list(projectRoot).filter((r) => r.phase === ctx.phase);
  if (rfcs.some((r) => r.status === 'accepted')) return { errors, warnings };
  const why = mode === 'always' ? 'rfc.required: "always"' : `critério(s) de risco ${risky.map((a) => `${a} (${ctx.risks.get(a)})`).join(', ')}`;
  const draft = rfcs.find((r) => r.status === 'draft');
  const msg = `fase ${ctx.phase} sem RFC aceito (${why}) — ${draft ? `aceite ${draft.id} com oxe-cc rfc accept ${draft.id}` : `escreva a proposta antes do plano: oxe-cc rfc new --title "…"`}`;
  (mode === 'risk' || mode === 'always' ? errors : warnings).push(msg);
  return { errors, warnings };
}

function rfcMode(config) {
  const c = config && config.rfc;
  if (c === false) return 'never';
  const r = c && typeof c === 'object' ? c.required : null;
  if (r === true) return 'risk';
  return ['risk', 'always', 'never'].includes(r) ? r : 'advisory';
}

module.exports = { parseRfc, list, create, accept, reject, lintPhaseRfc, rfcMode, STATUS_PT, dirOf };
