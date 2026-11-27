'use strict';

/**
 * 1.21.2 — `oxe-cc spec check`: the deterministic quality gate of the upstream, before the spec is approved. It joins
 * what used to be checked in pieces (or not at all): every v1 requirement proved by an existing criterion, every
 * criterion with "Como verificar" and a risk, the PRD's stories tied to the criteria, the glossary's forbidden
 * synonyms absent, the grill closed with its decisions in the ledger, an RFC for every P0/P1, and the ROADMAP
 * covering every criterion. Pure: the caller reads the files.
 */

const fs = require('fs');
const path = require('path');
const criteriaIds = require('./oxe-criteria-ids.cjs');

const RISKS = ['P0', 'P1', 'P2', 'P3'];
const PLACEHOLDER = /^(—|-|\?|tbd|todo|a definir|\(.*\))$/i;

/** Strip HTML comments and fenced code blocks (and optionally inline code spans) so prose/table scans ignore noise. */
function stripMarkdownNoise(text, { inlineCode = false } = {}) {
  let out = String(text || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)\s*$/gm, ' ');
  if (inlineCode) out = out.replace(/`[^`\r\n]*`/g, ' ');
  return out;
}

function splitRow(line) {
  const t = String(line).trim();
  if (!t.startsWith('|')) return null;
  return t
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}
const isSep = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

/** Every table: header + rows. */
function tables(text) {
  const lines = stripMarkdownNoise(text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const h = splitRow(lines[i]);
    const s = splitRow(lines[i + 1]);
    if (!h || !s || !isSep(s)) continue;
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && splitRow(lines[j]); j += 1) rows.push(splitRow(lines[j]));
    out.push({ header: h.map((x) => x.replace(/\*/g, '').trim()), rows });
    i = j - 1;
  }
  return out;
}

const col = (header, re) => header.findIndex((h, i) => i > 0 && re.test(h));

/** Criteria of the SPEC: id, text, verify, risk. */
function criteria(specText) {
  const out = [];
  let hasRiskColumn = false;
  for (const t of tables(specText)) {
    if (!/^id$/i.test(t.header[0] || '') || !/crit[ée]rio|criterion/i.test(t.header[1] || '')) continue;
    const ci = col(t.header, /crit[ée]rio|criterion/i);
    const vi = col(t.header, /verific|verify/i);
    const ri = col(t.header, /^(risco|risk)\b/i);
    if (ri >= 0) hasRiskColumn = true;
    for (const r of t.rows) {
      const id = String(r[0] || '').replace(/\*/g, '').trim().toUpperCase();
      if (!/^(A\d+(\.\d+)?|G\d+)$/.test(id)) continue;
      out.push({ id, text: r[ci] || '', verify: vi >= 0 ? r[vi] || '' : null, risk: ri >= 0 ? String(r[ri] || '').toUpperCase() : null });
    }
  }
  return { list: out, hasRiskColumn };
}

const A_RE = /\b(A\d+(?:\.\d+)?|G\d+)\b/g;

/** Requirements of the SPEC (table or bullets): id, version (v1/v2/fora), criteria cited. */
function requirements(specText) {
  const out = new Map();
  for (const t of tables(specText)) {
    if (!/^r-?id$/i.test(t.header[0] || '')) continue;
    const vi = col(t.header, /vers[aã]o|version/i);
    const ai = col(t.header, /crit[ée]rio|criteria|aceite/i);
    for (const r of t.rows) {
      const id = String(r[0] || '').replace(/\*/g, '').trim().toUpperCase();
      if (!/^R(-RB)?-?\d+$/.test(id)) continue;
      out.set(id, { id, version: vi >= 0 ? String(r[vi] || '').toLowerCase() : 'v1', criteria: ai >= 0 ? (String(r[ai] || '').match(A_RE) || []) : [] });
    }
  }
  const bulletLines = stripMarkdownNoise(specText).split(/\r?\n/);
  let currentReq = null;
  const commitBullet = () => {
    if (!currentReq || out.has(currentReq.id)) return;
    const body = currentReq.body;
    out.set(currentReq.id, {
      id: currentReq.id,
      version: /\b(v2|fora)\b/i.test(body) ? (/\bfora\b/i.test(body) ? 'fora' : 'v2') : 'v1',
      criteria: [...new Set(body.match(A_RE) || [])],
    });
  };
  for (const line of bulletLines) {
    const m = /^\s*[-*]\s+(?:\*\*)?(R(?:-RB)?-?\d+)(?:\*\*)?(?:\s*\([^)]*\))?\s*[—–:-]\s*(.*)$/.exec(line);
    if (m) {
      commitBullet();
      currentReq = { id: m[1].toUpperCase(), body: m[2] };
    } else if (currentReq && /^\s{2,}(?![-*]\s|\d+\.\s)(.+)$/.test(line)) {
      currentReq.body += ` ${line.trim()}`;
    } else {
      commitBullet();
      currentReq = null;
    }
  }
  commitBullet();
  return [...out.values()];
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {{ specText: string, roadmapText?: string, prdText?: string, prd?: object|null, lintPrd?: Function, prdRequired?: boolean,
 *           glossary?: Array<{term:string, synonyms:string[]}>, grill?: object|null, fast?: boolean,
 *           decisionSources?: string[], rfcs?: Array<{id:string,status:string}>, rfcMode?: string }} input
 * @returns {{ ok: boolean, errors: string[], warnings: string[], summary: object }}
 */
function checkSpec(input) {
  const errors = [];
  const warnings = [];
  const specText = String(input.specText || '');
  if (!specText.trim()) return { ok: false, errors: ['SPEC.md ausente — rode /oxe-spec'], warnings, summary: {} };
  const crit = criteria(specText);
  if (!crit.list.length) errors.push('SPEC sem tabela de critérios de aceite (| ID | Critério | Risco | Como verificar |)');
  const ids = crit.list.map((c) => c.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) errors.push(`critério(s) duplicado(s): ${[...new Set(dup)].join(', ')}`);
  for (const c of crit.list) {
    if (c.verify == null) { errors.push('a tabela de critérios não tem a coluna "Como verificar"'); break; }
    if (!c.verify.trim() || PLACEHOLDER.test(c.verify.trim())) errors.push(`${c.id}: sem "Como verificar" — critério sem verificação não fecha`);
  }
  if (!crit.hasRiskColumn) warnings.push('tabela de critérios sem a coluna Risco (P0–P3): o close da fase decide PASS/CONCERNS/FAIL por ela');
  else for (const c of crit.list) if (!RISKS.includes(c.risk)) errors.push(`${c.id}: risco "${c.risk || ''}" inválido (P0 | P1 | P2 | P3)`);

  // requirements → criteria
  const reqs = requirements(specText);
  const known = new Set(ids);
  const cited = new Set();
  for (const r of reqs) {
    for (const a of r.criteria) cited.add(a);
    if (r.version !== 'v1' && !/^v1/.test(r.version)) continue;
    if (!r.criteria.length) errors.push(`${r.id} (v1): não aponta para nenhum critério A* — nada prova que foi entregue`);
    const missing = r.criteria.filter((a) => !known.has(a));
    if (missing.length) errors.push(`${r.id}: cita ${missing.join(', ')}, que não existe(m) na tabela de critérios`);
  }
  if (reqs.length) {
    const orphan = ids.filter((a) => /^A/.test(a) && !cited.has(a) && !cited.has(a.replace(/\.\d+$/, '')));
    if (orphan.length) warnings.push(`critério(s) sem requisito que os cite: ${orphan.join(', ')}`);
  } else warnings.push('SPEC sem requisitos R-ID: a rastreabilidade requisito → critério não pode ser checada');

  // ROADMAP covers every criterion (including subcriteria A19.1, ignoring HTML comments and fenced code)
  if (input.roadmapText != null) {
    const cleanRoadmap = stripMarkdownNoise(input.roadmapText);
    const inRoadmap = new Set(cleanRoadmap.match(A_RE) || []);
    const subs = criteriaIds.subcriteriaOf(ids);
    const out = ids.filter((a) => /^A\d+(?:\.\d+)?$/.test(a) && !criteriaIds.inPhase(a, inRoadmap) && !(subs.get(a) && subs.get(a).every((s) => inRoadmap.has(s))));
    if (!String(input.roadmapText).trim()) errors.push('ROADMAP.md ausente — o roteiro é parte da spec');
    else if (out.length) warnings.push(`critério(s) fora de todas as fases do ROADMAP: ${out.join(', ')}`);
  }

  // PRD
  if (input.lintPrd && (input.prd || input.prdRequired)) {
    const r = input.lintPrd(input.prd, { criteria: ids, requirements: reqs.map((x) => x.id), required: input.prdRequired === true });
    errors.push(...r.errors.map((e) => `PRD: ${e}`));
    warnings.push(...r.warnings.map((w) => `PRD: ${w}`));
  } else if (!input.prd) warnings.push('PRD.md ausente: histórias de usuário e métricas não foram escritas (oxe/templates/PRD.template.md)');

  // glossary: forbidden synonyms absent from SPEC and PRD (prose only — ignore code spans, fenced blocks and comments)
  const corpus = stripMarkdownNoise(`${specText}\n${input.prdText || ''}`, { inlineCode: true });
  for (const t of input.glossary || []) {
    for (const s of t.synonyms || []) {
      if (!s || s.length < 3) continue;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(s)}(?=$|[^\\p{L}\\p{N}])`, 'iu');
      if (re.test(corpus)) warnings.push(`glossário: "${s}" é sinônimo proibido de "${t.term}" e aparece na SPEC/PRD — use "${t.term}"`);
    }
  }

  // grill
  const g = input.grill;
  if (!g || !g.started) {
    if (!input.fast) errors.push('grill não feito: rode a descoberta (oxe-cc grill start --type …) ou confirme o modo rápido (oxe-cc spec check --fast)');
  } else if (!g.closed) errors.push(`grill aberto (${(g.blockers || []).length} pendência(s)) — oxe-cc grill status`);
  else {
    const sources = new Set(input.decisionSources || []);
    const missing = (g.decisions || []).filter((d) => !sources.has(`grill:${d.id}`)).map((d) => d.id);
    if (missing.length) errors.push(`decisões do grill fora do registro: ${missing.join(', ')} — oxe-cc grill export`);
    if ((g.assumptions || []).length && !/##\s*Suposi/i.test(specText)) errors.push(`o grill adiou ${g.assumptions.map((a) => a.id).join(', ')}, mas a SPEC não tem a seção Suposições`);
  }

  if (g && g.started) {
    const f = require('./oxe-grill-cases.cjs').specFindings({ questions: g.questions, criteria: crit.list });
    errors.push(...f.errors);
    warnings.push(...f.warnings);
  }

  // RFC for P0/P1
  const mode = input.rfcMode || 'advisory';
  const risky = crit.list.filter((c) => c.risk === 'P0' || c.risk === 'P1').map((c) => c.id);
  if (mode !== 'never' && risky.length && !(input.rfcs || []).length) {
    (mode === 'risk' || mode === 'always' ? errors : warnings).push(`critério(s) de risco ${risky.join(', ')} sem RFC — rascunhe a proposta técnica: oxe-cc rfc new --title "…"`);
  }

  // OXB-222-11: SPEC depth & real-path checks (Bordas/Proibições, overloaded criteria, doc paths on disk)
  if (crit.list.length) {
    const cleanSpec = stripMarkdownNoise(specText);
    if (!/^#{2,3}\s*(?:bordas|proibi[cç][oõ]es|restri[cç][oõ]es|contratos\s+observ[aá]veis|invariantes)/im.test(cleanSpec)) {
      warnings.push('SPEC sem seção de Bordas/Proibições (ex.: "## Bordas e proibições") — feche limites e casos de erro antes do /oxe-plan');
    }
    for (const c of crit.list) {
      if (c.text && c.text.length > 320) {
        warnings.push(`${c.id}: critério extenso/sobrecarregado (${c.text.length} chars) — considere dividir em critérios menores e independentes`);
      }
    }
    if (input.projectRoot) {
      const rootAbs = path.resolve(input.projectRoot);
      const DOC_PATH_RE = /`((?:docs\/adr|oxe\/workflows|oxe\/templates)\/[^`\r\n*<>]+\.(?:md|json))`/g;
      const NEW_HINT_RE = /\b(?:novo|nova|criar|a\s+criar|new)\b/i;
      const seenDocPaths = new Set();
      let dm;
      while ((dm = DOC_PATH_RE.exec(cleanSpec))) {
        const rel = dm[1].trim().replace(/#.*$/, '');
        if (!rel || seenDocPaths.has(rel) || rel.includes('..')) continue;
        const after = cleanSpec.slice(dm.index + dm[0].length, dm.index + dm[0].length + 35);
        if (NEW_HINT_RE.test(after)) continue;
        seenDocPaths.add(rel);
        if (!fs.existsSync(path.join(rootAbs, rel))) {
          errors.push(`referência inexistente na SPEC: \`${rel}\` (verifique o caminho real no repositório)`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: { criteria: ids.length, requirements: reqs.length, risky, stories: input.prd && input.prd.stories ? input.prd.stories.length : 0, terms: (input.glossary || []).length, grill: g && g.started ? (g.closed ? 'fechado' : 'aberto') : (input.fast ? 'rápido' : 'ausente') },
  };
}

module.exports = { checkSpec, criteria, requirements, tables };
