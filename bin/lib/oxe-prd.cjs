'use strict';

/**
 * 1.21.2 — PRD (product layer above the SPEC). `.oxe/PRD.md`: problem, personas, goals with metrics (M-n), user stories
 * (US-n: como / quero / para, pointing to the SPEC's R* and A*), out of scope, business risks, version history.
 * The SPEC keeps what is built and how it is verified; the PRD keeps why and for whom. The stories are what the ALM
 * (Jira / Azure DevOps) receives (`oxe-cc alm push`), and what the plan and the verify trace back to.
 *
 * Lint (inside `plan lint` when a PRD exists; `prd: { required: true }` makes it an error to have none, and turns
 * the traceability warnings into errors):
 *   - a story with no A* (nothing proves it was delivered);
 *   - a story citing an A* / R* the SPEC does not have;
 *   - v1 criteria of the SPEC that no story covers (once the PRD has stories);
 *   - template placeholders left in a story or a metric; a metric without a target.
 */

const fs = require('fs');
const criteriaIds = require('./oxe-criteria-ids.cjs');

const ID_LIST = (s) => [...new Set(String(s || '').split(/[,;\s]+/).map((x) => x.replace(/\*/g, '').trim().toUpperCase()).filter((x) => /^[A-Z][A-Z0-9.-]*\d+$/.test(x)))];
const PLACEHOLDER = /^\(.*\)$|^…$|^\.\.\.$/;

function stripNoise(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)\s*$/gm, ' ');
}

function tableWithHeaders(text, heading) {
  const lines = stripNoise(text).split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}`, 'i').test(l.trim()));
  if (start < 0) return { headers: [], rows: [] };
  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i].trim();
    if (/^##\s/.test(l)) break;
    if (!l.startsWith('|')) continue;
    const cells = l
      .replace(/^\|/, '')
      .replace(/(?<!\\)\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.replace(/\\\|/g, '|').trim());
    if (cells.length && cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  return { headers: rows[0] || [], rows: rows.slice(1) };
}

function tableRows(text, heading) {
  return tableWithHeaders(text, heading).rows;
}

/** ALM keys cited in a row (OXE-48, CODE-8, AB#123), never the OXE's own ids (US-, R-, A-, M-, D-, CA-, RN-, RT-, F). */
const OWN_ID = /^(US|R|RB|A|G|M|D|CA|RN|RT|F|Q|CR|KF|RFC)$/;
function cardKeys(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\b([A-Z][A-Z0-9]+)-\d+\b|\bAB#\d+\b/g)) {
    if (m[1] && OWN_ID.test(m[1])) continue;
    out.push(m[0]);
  }
  return [...new Set(out)];
}

/** @returns {{ version: number, status: string|null, stories: object[], metrics: object[], personas: object[] }} */
function parsePrd(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  const field = (k) => { const m = fm && new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm[1]); return m ? m[1].trim() : null; };
  const cleanId = (v) => String(v || '').replace(/\*/g, '').trim();
  const storyTable = tableWithHeaders(text, 'Hist[óo]rias de usu[áa]rio');
  const normH = (h) => String(h || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const hdrs = storyTable.headers.map(normH);
  const colIdx = (re, fallback) => {
    const idx = hdrs.findIndex((h) => re.test(h));
    return idx >= 0 ? idx : fallback;
  };
  const isCompact = hdrs.length > 0 && hdrs.length <= 5 && hdrs.some((h) => /historia|story/.test(h));
  const critIdx = colIdx(/criteri|aceite|a\*/, isCompact ? 2 : 5);
  const reqIdx = colIdx(/requisit|r\*/, isCompact ? -1 : 4);
  const prioIdx = colIdx(/prioridad|fase|phase/, isCompact ? 3 : 6);
  const stories = storyTable.rows
    .filter((c) => /^US-\d+$/i.test(cleanId(c[0])))
    .map((c) => {
      let persona = c[1] || '';
      let want = c[2] || '';
      let benefit = c[3] || '';
      if (isCompact) {
        const storyText = String(c[1] || '').trim();
        const mFull = /^como\s+([^,]+),\s*quero\s+(.+?)(?:,?\s+para\s+(.+))?$/i.exec(storyText);
        if (mFull) {
          persona = mFull[1].trim();
          want = mFull[2].trim();
          benefit = (mFull[3] || mFull[2]).trim();
        } else {
          persona = storyText ? 'usuário' : '';
          want = storyText;
          benefit = storyText;
        }
      }
      return {
        id: cleanId(c[0]).toUpperCase(),
        persona,
        want,
        benefit,
        requirements: reqIdx >= 0 ? ID_LIST(c[reqIdx]).filter((x) => /^R/.test(x)) : [],
        criteria: critIdx >= 0 ? ID_LIST(c[critIdx]).filter((x) => /^[AG]\d+(?:\.\d+)?$/.test(x)) : [],
        priority: prioIdx >= 0 ? (c[prioIdx] || null) : null,
        cards: cardKeys(c.slice(1).join(' ')),
      };
    });
  const metrics = tableRows(text, 'Objetivos e m[ée]tricas')
    .filter((c) => /^M-\d+$/i.test(cleanId(c[0])))
    .map((c) => ({ id: cleanId(c[0]).toUpperCase(), goal: c[1] || '', metric: c[2] || '', target: c[3] || '', how: c[4] || '' }));
  const personas = tableRows(text, 'Personas').filter((c) => c[0] && !PLACEHOLDER.test(c[0])).map((c) => ({ name: c[0], who: c[1] || '', needs: c[2] || '' }));
  return { version: Number(field('version')) || 1, status: field('status'), stories, metrics, personas };
}

/** "Como <persona>, quero <ação>, para <benefício>." */
function storySentence(s) {
  return `Como ${s.persona}, quero ${s.want}, para ${s.benefit}.`;
}

/**
 * @param {ReturnType<typeof parsePrd>|null} prd
 * @param {{ criteria: string[], v1Criteria?: string[], requirements: string[], required?: boolean }} ctx
 */
function lintPrd(prd, ctx = {}) {
  const errors = [];
  const warnings = [];
  const strict = ctx.required === true;
  const push = (msg) => (strict ? errors : warnings).push(msg);
  if (!prd) {
    if (strict) errors.push('PRD.md ausente — prd.required está ligado; gere-o no /oxe-spec (problema, personas, métricas, histórias de usuário)');
    return { errors, warnings };
  }
  const criteriaList = (ctx.criteria || []).map((x) => String(x).toUpperCase());
  const criteria = new Set(criteriaList);
  const specSubs = criteriaIds.subcriteriaOf(criteriaList);
  const reqs = new Set((ctx.requirements || []).map((x) => String(x).toUpperCase()));
  if (!prd.stories.length) push('PRD.md sem histórias de usuário (tabela "Histórias de usuário" com US-1, US-2, …)');
  for (const s of prd.stories) {
    if ([s.persona, s.want, s.benefit].some((v) => !v || PLACEHOLDER.test(v))) push(`${s.id}: história incompleta — preencha Como / Quero / Para`);
    if (!s.criteria.length) push(`${s.id}: não aponta para nenhum critério A* — nada prova que ela foi entregue`);
    const unknownA = criteria.size ? s.criteria.filter((a) => !criteria.has(a) && !specSubs.has(a)) : [];
    if (unknownA.length) push(`${s.id}: cita ${unknownA.join(', ')}, que não existe(m) na SPEC`);
    const unknownR = reqs.size ? s.requirements.filter((r) => !reqs.has(r)) : [];
    if (unknownR.length) push(`${s.id}: cita ${unknownR.join(', ')}, que não existe(m) na SPEC/ROADMAP`);
  }
  if (prd.stories.length) {
    const covered = new Set(prd.stories.flatMap((s) => s.criteria));
    const pool = (ctx.v1Criteria || ctx.criteria || []).map((x) => String(x).toUpperCase()).filter((a) => !criteriaIds.isGlobal(a));
    const poolSubs = criteriaIds.subcriteriaOf(pool);
    const isCovered = (a) => criteriaIds.inPhase(a, covered) || (poolSubs.has(a) && poolSubs.get(a).every((sub) => covered.has(sub)));
    const orphan = pool.filter((a) => !isCovered(a));
    if (orphan.length) push(`critérios da SPEC sem história de usuário no PRD: ${orphan.slice(0, 12).join(', ')}${orphan.length > 12 ? ` e mais ${orphan.length - 12}` : ''} — ligue cada um a uma US (coluna Critérios)`);
  }
  for (const m of prd.metrics) {
    if (!m.target || PLACEHOLDER.test(m.target)) warnings.push(`${m.id}: métrica sem meta — "${m.goal || m.metric}" precisa de um número ou limiar`);
  }
  return { errors, warnings };
}

function readPrd(file) {
  try { return parsePrd(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** R* ids written anywhere in the SPEC / ROADMAP text (R1, R-RB-02, …). */
function requirementIds(...texts) {
  return [...new Set(texts.flatMap((t) => String(t || '').match(/\bR(?:-RB)?-?\d+\b/g) || []).map((x) => x.toUpperCase()))];
}

module.exports = { cardKeys, parsePrd, lintPrd, readPrd, storySentence, requirementIds, tableRows };
