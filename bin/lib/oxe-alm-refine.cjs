'use strict';

/**
 * 1.21.2 — `oxe-cc alm refine`: re-reading the Jira cards into a safe, guided spec (user request, 14/11: "nenhum card
 * está no padrão de história de usuário com critérios de aceite, regras técnicas, regras de negócio, descrição, fora
 * de escopo"). Three steps, none of them calls a paid model:
 *
 *   1. collect (read-only, the default): the whole card — summary, description, type, status, labels, epic, links,
 *      comments, versions, the dev summary (PRs/commits/builds) when Jira gives it, the design refs (ref-BRD/VIS) and
 *      the code paths the card cites — into .oxe/alm/refine/<KEY>.json, plus a skeleton .oxe/alm/specs/<KEY>.md with
 *      the sections of its type, what the card already says placed in them, and every gap as "A confirmar".
 *   2. the agent of the session rewrites the skeleton following oxe/workflows/references/alm-refine.md (never invents a
 *      rule: what is not in the card, the code or the decisions stays "A confirmar" with the question), then
 *      `alm refine lint` (vague criterion, criterion without test, no out-of-scope…).
 *   3. apply (writer only): the description becomes the spec (ADF with headings), the original text goes to a comment,
 *      labels spec-v1 (+ needs-info with the open questions as a comment). Idempotent: when the card changed after the
 *      collect, nothing is overwritten without --confirm-overwrite.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = { story: ['story', 'história', 'historia', 'user story'], bug: ['bug', 'defeito', 'erro'], epic: ['epic', 'épico', 'epico'], task: ['task', 'tarefa', 'subtask', 'sub-task', 'subtarefa'] };
const kindOf = (typeName, labels = []) => {
  const t = String(typeName || '').toLowerCase();
  if (labels.map((l) => String(l).toLowerCase()).includes('bug')) return 'bug';
  for (const [k, names] of Object.entries(KINDS)) if (names.includes(t)) return k;
  return 'task';
};

const dirs = (projectRoot) => ({ data: path.join(projectRoot, '.oxe', 'alm', 'refine'), specs: path.join(projectRoot, '.oxe', 'alm', 'specs') });
const hash = (s) => crypto.createHash('sha256').update(String(s || '').replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);

// ── ADF ⇄ text ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Plain text of an Atlassian Document Format node (headings, lists and paragraphs kept as lines). */
function adfToText(node, depth = 0) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const kids = (node.content || []).map((c) => adfToText(c, depth + (node.type === 'bulletList' || node.type === 'orderedList' ? 1 : 0)));
  switch (node.type) {
    case 'text': {
      const t = node.text || '';
      if (!t) return '';
      const marks = Array.isArray(node.marks) ? node.marks.map((m) => m && m.type) : [];
      const wm = /^(\s*)(.*?)(\s*)$/.exec(t);
      const core = wm ? wm[2] : '';
      if (!core) return t;
      if (marks.includes('code') && !/^`.*`$/.test(core)) return `${wm[1]}\`${core}\`${wm[3]}`;
      if (marks.includes('strong') && !/^\*\*.*\*\*$/.test(core)) return `${wm[1]}**${core}**${wm[3]}`;
      return t;
    }
    case 'hardBreak': return '\n';
    case 'heading': return `\n${'#'.repeat(Math.min(6, (node.attrs && node.attrs.level) || 2))} ${kids.join('')}\n`;
    case 'paragraph': return `${kids.join('')}\n`;
    case 'listItem': return `${'  '.repeat(Math.max(0, depth - 1))}- ${kids.join('').trim()}\n`;
    case 'codeBlock': return `\n\`\`\`\n${kids.join('')}\n\`\`\`\n`;
    case 'mention': return `@${(node.attrs && (node.attrs.text || node.attrs.id)) || ''}`;
    case 'inlineCard': case 'blockCard': return (node.attrs && node.attrs.url) || '';
    default: return kids.join('');
  }
}

const textNode = (t) => ({ type: 'text', text: t });
/** Inline **bold** and `code` to ADF marks. */
function inline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  const s = String(text);
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(textNode(s.slice(last, m.index)));
    const tok = m[0];
    out.push(tok.startsWith('**') ? { type: 'text', text: tok.slice(2, -2), marks: [{ type: 'strong' }] } : { type: 'text', text: tok.slice(1, -1), marks: [{ type: 'code' }] });
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(textNode(s.slice(last)));
  return out.filter((n) => n.text !== '');
}

/** The spec markdown (headings, paragraphs, - and 1. lists, tables as paragraphs) to an ADF document. */
function mdToAdf(md) {
  const content = [];
  let list = null;
  const flush = () => { if (list) { content.push(list); list = null; } };
  for (const raw of String(md).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^<!--.*-->$/.test(line.trim())) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); content.push({ type: 'heading', attrs: { level: Math.min(6, Math.max(2, h[1].length)) }, content: inline(h[2]) }); continue; }
    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    const o = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (b || o) {
      const type = b ? 'bulletList' : 'orderedList';
      if (!list || list.type !== type) { flush(); list = { type, content: [] }; }
      list.content.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline((b || o)[1]) }] });
      continue;
    }
    flush();
    if (/^\|?\s*:?-{3,}/.test(line)) continue; // table separator
    content.push({ type: 'paragraph', content: inline(line.replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ' — ')) });
  }
  flush();
  return { type: 'doc', version: 1, content };
}

// ── collect ──────────────────────────────────────────────────────────────────────────────────────────────────────

// a path (src/x.ts) or a bare file name (App.tsx, thread-view.spec.ts:10) with a code extension
const CODE_PATH_RE = /(?<![\w/.-])(?:[\w.-]+\/)*[\w-]+(?:\.[\w-]+)*\.(?:tsx?|jsx?|mjs|cjs|kt|swift|java|py|go|rs|css|scss|sql)\b(?::\d+)?/g;
const DESIGN_REF_RE = /\bref-(?:BRD|VIS|DS|UX)-[\w-]+\b|\b(?:BRD|VIS)-\d+\b/g;
const ARTIFACT_CITE_RE = /\b(?:PRD\.md|SPEC\.md|SYSTEM-DESIGN\.md|GLOSSARY\.md|US-\d+|RFC-\d+|ADR-\d+|D-\d+)\b/i;

/**
 * Discovers upstream OXE / architecture artifacts in a repository so cards refined or pushed
 * to Jira / Azure DevOps carry explicit links to PRD, SPEC, SYSTEM-DESIGN, GLOSSARY, RFCs, ADRs and D-nn decisions.
 */
function discoverProjectArtifacts(projectRoot, activeSession = null, cardKey = null) {
  const empty = { prd: null, spec: null, system_design: null, glossary: null, rfcs: [], adrs: [], decisions: [], has_any: false };
  if (!projectRoot) return empty;
  const rootAbs = path.resolve(projectRoot);
  if (!fs.existsSync(rootAbs)) return empty;
  const rel = (abs) => path.relative(rootAbs, abs).replace(/\\/g, '/');
  const oxeBase = activeSession ? path.join(rootAbs, '.oxe', 'sessions', activeSession) : path.join(rootAbs, '.oxe');
  const fallbackBase = path.join(rootAbs, '.oxe');
  const pickFile = (name) => {
    const p1 = path.join(oxeBase, name);
    if (fs.existsSync(p1)) return p1;
    if (oxeBase !== fallbackBase) {
      const p2 = path.join(fallbackBase, name);
      if (fs.existsSync(p2)) return p2;
    }
    return null;
  };
  const publishedMap = new Map();
  try {
    const pubFile = path.join(rootAbs, '.oxe', 'docs', 'published.json');
    if (fs.existsSync(pubFile)) {
      const pub = JSON.parse(fs.readFileSync(pubFile, 'utf8'));
      const entries = Array.isArray(pub) ? pub : (Array.isArray(pub && pub.pages) ? pub.pages : Object.values(pub || {}));
      for (const e of entries) {
        if (e && typeof e === 'object' && e.source && e.url) publishedMap.set(String(e.source).replace(/\\/g, '/'), String(e.url));
      }
    }
  } catch { /* optional */ }
  const urlFor = (relPath) => publishedMap.get(relPath) || publishedMap.get(path.basename(relPath)) || null;

  const prdAbs = pickFile('PRD.md');
  let prd = null;
  if (prdAbs) {
    const prdRel = rel(prdAbs);
    const stories = [];
    try {
      const txt = fs.readFileSync(prdAbs, 'utf8');
      const keyRe = cardKey ? new RegExp(`(?<![A-Za-z0-9-])${String(cardKey).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`, 'i') : null;
      const blocks = txt.split(/(?=^###?\s+US-\d+\b)/m);
      for (const b of blocks) {
        const m = /^###?\s+(US-\d+)\b/m.exec(b);
        if (m && (!keyRe || keyRe.test(b))) stories.push(m[1].toUpperCase());
      }
      for (const line of txt.split(/\r?\n/)) {
        const tm = /^\|\s*(US-\d+)\s*\|/i.exec(line.trim());
        if (tm && (!keyRe || keyRe.test(line))) stories.push(tm[1].toUpperCase());
      }
    } catch { /* ignore */ }
    prd = { path: prdRel, stories: [...new Set(stories)].slice(0, 8), url: urlFor(prdRel) };
  }
  const specAbs = pickFile('SPEC.md');
  const spec = specAbs ? { path: rel(specAbs), url: urlFor(rel(specAbs)) } : null;
  const sdAbs = pickFile('SYSTEM-DESIGN.md');
  const system_design = sdAbs ? { path: rel(sdAbs), url: urlFor(rel(sdAbs)) } : null;
  const glAbs = pickFile('GLOSSARY.md');
  const glossary = glAbs ? { path: rel(glAbs), url: urlFor(rel(glAbs)) } : null;

  const listMatching = (dirAbs, re, idRe) => {
    const found = [];
    if (!fs.existsSync(dirAbs)) return found;
    try {
      for (const f of fs.readdirSync(dirAbs).sort()) {
        if (!re.test(f)) continue;
        const abs = path.join(dirAbs, f);
        if (!fs.statSync(abs).isFile()) continue;
        const r = rel(abs);
        const im = idRe.exec(f);
        found.push({ id: im ? im[0].toUpperCase() : f.replace(/\.md$/i, ''), path: r, url: urlFor(r) });
      }
    } catch { /* ignore */ }
    return found;
  };
  const rfcs = [
    ...listMatching(path.join(oxeBase, 'rfc'), /^RFC-.*\.md$/i, /^RFC-\d+/i),
    ...(oxeBase !== fallbackBase ? listMatching(path.join(fallbackBase, 'rfc'), /^RFC-.*\.md$/i, /^RFC-\d+/i) : []),
  ].filter((x, i, a) => a.findIndex((y) => y.path === x.path) === i).slice(0, 10);

  const adrs = [
    ...listMatching(path.join(rootAbs, 'docs', 'adr'), /^(?:ADR|D)-\d+.*\.md$/i, /^(?:ADR|D)-\d+/i),
    ...listMatching(path.join(oxeBase, 'adr'), /^(?:ADR|D)-\d+.*\.md$/i, /^(?:ADR|D)-\d+/i),
  ].filter((x, i, a) => a.findIndex((y) => y.path === x.path) === i).slice(0, 10);

  const decisions = [];
  const decFile = fs.existsSync(path.join(oxeBase, 'program', 'decisions.ndjson'))
    ? path.join(oxeBase, 'program', 'decisions.ndjson')
    : path.join(fallbackBase, 'program', 'decisions.ndjson');
  if (fs.existsSync(decFile)) {
    try {
      const byId = new Map();
      for (const line of fs.readFileSync(decFile, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          if (obj && obj.id) byId.set(String(obj.id), obj);
        } catch { /* skip malformed */ }
      }
      for (const d of byId.values()) {
        const st = String(d.status || 'active').toLowerCase();
        if (st === 'superseded' || st === 'revoked' || st === 'rejected') continue;
        decisions.push({ id: String(d.id), title: String(d.title || d.decision || d.summary || '').slice(0, 120) });
      }
    } catch { /* ignore */ }
  }
  const activeDecisions = decisions.slice(-15);
  const has_any = Boolean(prd || spec || system_design || glossary || rfcs.length || adrs.length || activeDecisions.length);
  return { prd, spec, system_design, glossary, rfcs, adrs, decisions: activeDecisions, has_any };
}

/** Formats discovered OXE artifacts as markdown bullet lines for Referências / ALM push descriptions. */
function formatArtifactRefs(artifacts, opts = {}) {
  if (!artifacts || !artifacts.has_any) return [];
  const fmtLink = (item, anchor = null) => {
    if (!item) return null;
    const label = anchor ? `${item.path}#${anchor}` : item.path;
    return item.url ? `[${label}](${anchor ? `${item.url}#${anchor}` : item.url})` : `\`${label}\``;
  };
  const lines = [];
  if (artifacts.prd) {
    const storyHint = opts.storyId ? null : (artifacts.prd.stories && artifacts.prd.stories.length ? ` (${artifacts.prd.stories.join(', ')})` : '');
    lines.push(`- PRD: ${fmtLink(artifacts.prd, opts.storyId || null)}${storyHint || ''}`);
  }
  if (artifacts.spec) lines.push(`- SPEC: ${fmtLink(artifacts.spec)}`);
  if (artifacts.system_design) lines.push(`- Arquitetura (SYSTEM-DESIGN): ${fmtLink(artifacts.system_design)}`);
  if (artifacts.glossary) lines.push(`- Glossário: ${fmtLink(artifacts.glossary)}`);
  if (artifacts.rfcs && artifacts.rfcs.length) lines.push(`- RFCs: ${artifacts.rfcs.map((r) => fmtLink(r)).join(', ')}`);
  if (artifacts.adrs && artifacts.adrs.length) lines.push(`- ADRs: ${artifacts.adrs.map((a) => fmtLink(a)).join(', ')}`);
  if (artifacts.decisions && artifacts.decisions.length) {
    const top = artifacts.decisions.slice(-6).map((d) => (d.title ? `${d.id} (${d.title})` : d.id));
    lines.push(`- Decisões registradas: ${top.join('; ')}`);
  }
  return lines;
}

/**
 * Reads a card through a Jira REST context (`request` + site): read-only.
 * @returns {Promise<object>} the context saved for the agent
 */
async function collect(ctx, key, options = {}) {
  const { request, site } = ctx;
  const fields = 'summary,description,issuetype,status,labels,parent,issuelinks,comment,fixVersions,priority,components,created,updated,assignee,reporter';
  const issue = await request('GET', `${site}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`);
  if (!issue || !issue.fields) throw new Error(`${key}: card não encontrado`);
  const f = issue.fields;
  const description = adfToText(f.description).trim();
  const comments = ((f.comment && f.comment.comments) || []).map((c) => ({ by: c.author ? c.author.displayName : null, at: c.created, text: adfToText(c.body).trim() })).filter((c) => c.text);
  const links = (f.issuelinks || []).map((l) => {
    const other = l.outwardIssue || l.inwardIssue;
    return other ? { type: l.type ? (l.outwardIssue ? l.type.outward : l.type.inward) : 'relates', key: other.key, summary: other.fields ? other.fields.summary : null, status: other.fields && other.fields.status ? other.fields.status.name : null } : null;
  }).filter(Boolean);
  let dev = null;
  if (options.dev !== false && issue.id) {
    try {
      const d = await request('GET', `${site}/rest/dev-status/latest/issue/summary?issueId=${issue.id}`);
      const s = d && d.summary;
      if (s) dev = { pullrequests: s.pullrequest && s.pullrequest.overall ? s.pullrequest.overall.count : 0, commits: s.repository && s.repository.overall ? s.repository.overall.count : 0, builds: s.build && s.build.overall ? s.build.overall.count : 0 };
    } catch { dev = null; }
  }
  let parent = null;
  if (f.parent) parent = { key: f.parent.key, summary: f.parent.fields ? f.parent.fields.summary : null };
  const corpus = [f.summary, description, ...comments.map((c) => c.text)].join('\n');
  const codeRefs = [...new Set(corpus.match(CODE_PATH_RE) || [])];
  const designRefs = [...new Set([...(corpus.match(DESIGN_REF_RE) || []), ...(f.labels || []).filter((l) => /^ref-(BRD|VIS|DS|UX)-/i.test(l))])];
  const rootAbs = options.projectRoot ? path.resolve(options.projectRoot) : null;
  const existing = rootAbs ? codeRefs.filter((p) => fs.existsSync(path.join(rootAbs, p.replace(/:\d+$/, '')))) : [];
  const projectArtifacts = rootAbs ? discoverProjectArtifacts(rootAbs, options.activeSession || null, issue.key) : null;
  return {
    key: issue.key,
    id: issue.id,
    url: `${site}/browse/${issue.key}`,
    kind: kindOf(f.issuetype && f.issuetype.name, f.labels),
    type: f.issuetype ? f.issuetype.name : null,
    status: f.status ? f.status.name : null,
    summary: f.summary || '',
    description,
    description_hash: hash(description),
    labels: f.labels || [],
    parent,
    links,
    comments,
    fix_versions: (f.fixVersions || []).map((v) => v.name),
    priority: f.priority ? f.priority.name : null,
    dev,
    code_refs: codeRefs,
    code_refs_found: existing,
    design_refs: designRefs,
    project_artifacts: projectArtifacts,
    collected_at: new Date().toISOString(),
    already_refined: (f.labels || []).includes('spec-v1'),
  };
}

// ── skeletons per type ───────────────────────────────────────────────────────────────────────────────────────────

const TBC = 'A confirmar';
/**
 * The "A confirmar" MARKER, never a substring: OxeSpace 15/11 (OXE-274) "…, para confirmar com segurança …" read as an
 * open item ("pAra confirmar"). A whole phrase: no letter/digit right before "a" nor right after "confirmar".
 * Cross-review 15/11: prose also says "obrigando-o a confirmar a exclusão" — a lower-case "a confirmar" between words is
 * the preposition, not the marker. So: "A confirmar" with a capital A anywhere; lower-case only where it stands alone
 * (not preceded by "<word> " nor followed by " <word>"). `_` is a boundary (Markdown italics: _A confirmar_).
 */
const TBC_RE = /(?<![\p{L}\p{N}])(?:A[ \t]+(?:confirmar|Confirmar|CONFIRMAR)|(?<![\p{L}\p{N}][ \t]+)a[ \t]+confirmar(?![ \t]+[\p{L}\p{N}]))(?![\p{L}\p{N}])/u;
const TBC_RE_G = new RegExp(TBC_RE.source, 'gu');
const SECTIONS = {
  story: ['História', 'Contexto', 'Critérios de aceite', 'Regras de negócio', 'Regras técnicas', 'Arquitetura e fluxo', 'Fora de escopo', 'Dependências', 'Riscos', 'Definição de pronto', 'Referências', 'Perguntas em aberto'],
  bug: ['Resumo', 'Passos para reproduzir', 'Resultado esperado', 'Resultado obtido', 'Ambiente e versão', 'Causa', 'Critérios de correção', 'Teste de regressão', 'Fora de escopo', 'Definição de pronto', 'Referências', 'Perguntas em aberto'],
  task: ['Objetivo', 'Contexto', 'Critérios de aceite', 'Regras técnicas', 'Fora de escopo', 'Dependências', 'Definição de pronto', 'Referências', 'Perguntas em aberto'],
  epic: ['Objetivo', 'Escopo', 'Fora de escopo', 'Métricas de sucesso', 'Filhos', 'Riscos', 'Referências', 'Perguntas em aberto'],
};
const REQUIRED = {
  story: ['História', 'Critérios de aceite', 'Regras de negócio', 'Regras técnicas', 'Fora de escopo', 'Definição de pronto'],
  bug: ['Passos para reproduzir', 'Resultado esperado', 'Resultado obtido', 'Critérios de correção', 'Teste de regressão', 'Definição de pronto'],
  task: ['Objetivo', 'Critérios de aceite', 'Regras técnicas', 'Fora de escopo', 'Definição de pronto'],
  epic: ['Objetivo', 'Escopo', 'Fora de escopo', 'Métricas de sucesso'],
};

function skeleton(c) {
  const kind = c.kind;
  const art = c.project_artifacts && c.project_artifacts.has_any ? c.project_artifacts : null;
  const refs = [
    `- Card: [${c.key}](${c.url}) · ${c.type || kind} · ${c.status || '—'}${c.fix_versions.length ? ` · versão ${c.fix_versions.join(', ')}` : ''}`,
    ...(c.parent ? [`- Épico/pai: ${c.parent.key}${c.parent.summary ? ` — ${c.parent.summary}` : ''}`] : []),
    ...c.links.map((l) => `- ${l.type}: ${l.key}${l.summary ? ` — ${l.summary}` : ''}${l.status ? ` (${l.status})` : ''}`),
    ...c.design_refs.map((r) => `- Design: ${r}`),
    ...c.code_refs.map((p) => `- Código: \`${p}\`${c.code_refs_found.includes(p) ? '' : ' (não encontrado no repositório)'}`),
    ...formatArtifactRefs(art),
    ...(c.dev ? [`- Desenvolvimento: ${c.dev.pullrequests} PR(s), ${c.dev.commits} commit(s), ${c.dev.builds} build(s)`] : []),
  ];
  const archLines = [];
  if (art && art.system_design) archLines.push(`- Componentes e fluxo: ${TBC} (consultar \`${art.system_design.path}\`)`);
  else archLines.push(`- Componentes e fluxo: ${TBC} (descrever fluxo ponta a ponta ou "N/A" sem impacto arquitetural)`);
  if (art && ((art.adrs && art.adrs.length) || (art.decisions && art.decisions.length) || (art.rfcs && art.rfcs.length))) {
    const pointers = [
      ...(art.rfcs || []).map((r) => `\`${r.path}\``),
      ...(art.adrs || []).map((a) => `\`${a.path}\``),
      ...(art.decisions || []).slice(-4).map((d) => d.id),
    ];
    archLines.push(`- ADRs / RFCs / Decisões aplicáveis: ${pointers.join(', ')}`);
  } else {
    archLines.push(`- ADRs / Decisões aplicáveis: ${TBC} (ou nenhuma)`);
  }
  const body = {
    'História': [`Como **${TBC}**, quero **${c.summary || TBC}**, para **${TBC}**.`],
    Resumo: [c.summary || TBC],
    Objetivo: [c.summary || TBC],
    Contexto: [c.description ? c.description.split('\n').filter(Boolean).slice(0, 12).join('\n') : TBC],
    'Critérios de aceite': ['1. **CA-1** — Dado … quando … então … _(A confirmar)_ · Teste: A confirmar'],
    'Critérios de correção': ['1. **CA-1** — Dado … quando … então … _(A confirmar)_ · Teste: A confirmar'],
    'Regras de negócio': [`- **RN-1** — ${TBC}`],
    'Regras técnicas': [`- **RT-1** — ${TBC} (arquivos, contratos/IPC, migração, desempenho, testes congelados afetados, compatibilidade)`],
    'Arquitetura e fluxo': archLines,
    'Fora de escopo': [`- ${TBC}`],
    'Dependências': [c.links.length ? c.links.map((l) => `- ${l.key} (${l.type})`).join('\n') : '- Nenhuma conhecida'],
    Riscos: [`- ${TBC}`],
    'Definição de pronto': ['- Critérios com teste verde no CI', '- PR revisado e pronto (pr:ready)', '- Homologado (HML)', '- Portão de desempenho, quando aplicável'],
    'Passos para reproduzir': ['1. A confirmar'],
    'Resultado esperado': [TBC],
    'Resultado obtido': [TBC],
    'Ambiente e versão': [c.fix_versions.length ? c.fix_versions.join(', ') : TBC],
    Causa: ['Desconhecida (A confirmar)'],
    'Teste de regressão': [`${TBC} — o teste que falha antes da correção e passa depois`],
    Escopo: [`- ${TBC}`],
    'Métricas de sucesso': [`- **M-1** — ${TBC} (linha de base, meta)`],
    Filhos: [c.links.length ? c.links.map((l) => `- ${l.key}`).join('\n') : `- ${TBC}`],
    'Referências': refs.length ? refs : ['- —'],
    'Perguntas em aberto': ['- (preencha com cada "A confirmar" acima, uma pergunta por linha)'],
  };
  // OxeSpace 15/11 (OXE-166..169): a card written by `alm intake --from <spec>` already HAS the sections; the
  // skeleton put the whole description under Contexto (cut after ~12 lines) and reset the rest to "A confirmar", and a
  // later apply would have overwritten the real spec. Sections the card already has are kept as they are.
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const existing = new Map();
  if (c.description && /^#{2,3}\s+\S/m.test(c.description)) {
    for (const [name, text] of sectionsOf(String(c.description).replace(/^###\s+/gm, '## '))) {
      if (String(text || '').trim()) existing.set(norm(name), String(text).trim().split('\n'));
    }
  }
  const known = SECTIONS[kind].filter((s) => existing.has(norm(s)));
  if (known.length) {
    for (const s of known) body[s] = existing.get(norm(s));
    // what the card says before its first section is the context, when the card has no "Contexto" of its own
    if (!existing.has(norm('Contexto')) && SECTIONS[kind].includes('Contexto')) {
      const lead = String(c.description).replace(/\r\n/g, '\n').split(/^#{2,3}\s+/m)[0].trim();
      body.Contexto = [lead || TBC];
    }
  }
  const out = [
    `<!-- oxe-refine: ${c.key} · tipo ${kind} · coletado ${c.collected_at} · descricao-sha ${c.description_hash}${known.length ? ` · seções do card mantidas: ${known.length}` : ''} -->`,
    `# ${c.key} — ${c.summary || '(sem título)'}`,
    '',
  ];
  for (const s of SECTIONS[kind]) out.push(`## ${s}`, '', ...body[s], '');
  out.push('<!-- Texto original do card (não vai para a descrição; vira comentário no apply) -->', '<!--', (c.description || '(vazio)').replace(/--/g, '—'), '-->', '');
  return `${out.join('\n')}`;
}

// ── lint ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const VAGUE_RE = /\b(melhor(ar|ia)?|r[aá]pid[oa]s?|lent[oa]|adequad[oa]|intuitiv[oa]|f[aá]cil|eficiente|otimizad?[oa]?|otimizar|bom|boa|amig[aá]vel|robust[oa]|simples|moderno|bonit[oa]|fluid[oa]|perform[aá]tic[oa])\b/i;
const HAS_NUMBER_RE = /\d/;

function sectionsOf(md) {
  const out = new Map();
  let cur = null;
  // OXB-G16: what is inside an HTML comment (the card's original text) never goes to the card, so it is not linted
  for (const line of String(md).replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { cur = h[1].trim(); out.set(cur, []); continue; }
    if (cur && !/^<!--/.test(line.trim())) out.get(cur).push(line);
  }
  for (const [k, v] of out) out.set(k, v.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim());
  return out;
}

/**
 * The card's criteria: `1. **CA-2 (A14)** — Dado … · Teste: <teste> · Risco: P1` or `1. **CA-2 (base-polish:A14)** — …`
 * (or fallback `(plano: A14, <programa>)` inside the criterion text). `Risco` feeds the SPEC's Risco column.
 * @returns {Array<{ id: string, spec_id: string|null, spec_program: string|null, plan_ref: { spec_id: string, program: string|null }|null, text: string, test: string|null, risk: string|null, line: number }>}
 */
function parseCriteria(md) {
  const sec = sectionsOf(md);
  const name = sec.has('Critérios de aceite') ? 'Critérios de aceite' : 'Critérios de correção';
  const out = [];
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  let inside = false;
  let inComment = false;
  let inFence = false;
  lines.forEach((rawLine, i) => {
    let line = rawLine;
    if (inComment) {
      const closeIdx = line.indexOf('-->');
      if (closeIdx < 0) return;
      inComment = false;
      line = line.slice(closeIdx + 3);
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    const openIdx = line.indexOf('<!--');
    if (openIdx >= 0) {
      inComment = true;
      line = line.slice(0, openIdx);
    }
    if (/^\s*(?:```|~~~)/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { inside = h[1].trim() === name; return; }
    if (!inside) return;
    const m = /^\s*(?:\d+[.)]|[-*])\s+(?:\*\*(CA-\d+)(?:\s*\((?:([A-Za-z0-9][A-Za-z0-9._-]*):)?([AG]\d+(?:\.\d+)*)\))?\*\*|(CA-\d+)(?:\s*\((?:([A-Za-z0-9][A-Za-z0-9._-]*):)?([AG]\d+(?:\.\d+)*)\))?)(?:\s*\((?:([A-Za-z0-9][A-Za-z0-9._-]*):)?([AG]\d+(?:\.\d+)*)\))?\s*[—–:-]\s*(.*)$/.exec(line);
    if (!m) return;
    const id = m[1] || m[4];
    const specProgram = m[2] || m[5] || m[7] || null;
    const specId = m[3] || m[6] || m[8] || null;
    const rest = m[9];
    // Split on explicit field delimiters (`· Teste:` / `· Risco:`) rather than stopping at any middle dot `·`,
    // so test titles containing `·` (e.g. `"{project} · OxeQuery"`) and criterion text with `·` stay intact.
    const markerRe = /\s*·\s*(Teste|Risco)\s*:/gi;
    const markers = [];
    let mm;
    while ((mm = markerRe.exec(rest))) {
      markers.push({ key: mm[1].toLowerCase(), index: mm.index, valueStart: mm.index + mm[0].length });
    }
    const text = (markers.length ? rest.slice(0, markers[0].index) : rest).trim();
    let testVal = null;
    let riskVal = null;
    for (let idx = 0; idx < markers.length; idx += 1) {
      const end = idx + 1 < markers.length ? markers[idx + 1].index : rest.length;
      const val = rest.slice(markers[idx].valueStart, end).trim();
      if (markers[idx].key === 'teste') testVal = val || null;
      else if (markers[idx].key === 'risco') {
        const rm = /^(P[0-3])\b/i.exec(val);
        if (rm) riskVal = rm[1].toUpperCase();
      }
    }
    let planRef = null;
    const planoM = /\(\s*plano:\s*([AG]\d+(?:\.\d+)*)(?:\s*,\s*([^)\n]+))?\)/i.exec(text);
    if (planoM) {
      planRef = { spec_id: planoM[1].toUpperCase(), program: planoM[2] ? planoM[2].trim() : null };
    }
    out.push({
      id,
      spec_id: specId ? specId.toUpperCase() : null,
      spec_program: specProgram || null,
      plan_ref: planRef,
      text,
      test: testVal,
      risk: riskVal,
      line: i,
    });
  });
  return out;
}

/** Writes `(A14)` or `(prog:A14)` into the CA lines that got a SPEC criterion. */
function setSpecIds(md, map, options = {}) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const prefix = options && options.program ? `${options.program}:` : '';
  for (const c of parseCriteria(md)) {
    const a = map.get(c.id);
    if (!a || c.spec_id) continue;
    const boldNeedle = `**${c.id}**`;
    if (lines[c.line].includes(boldNeedle)) {
      lines[c.line] = lines[c.line].replace(boldNeedle, `**${c.id} (${prefix}${a})**`);
    } else {
      lines[c.line] = lines[c.line].replace(new RegExp(`(?<=^\\s*(?:\\d+[.)]|[-*])\\s+)${c.id}\\b`), `**${c.id} (${prefix}${a})**`);
    }
  }
  return lines.join('\n');
}

/**
 * @returns {{ ok: boolean, errors: string[], warnings: string[], questions: string[], criteria: Array<{id,text,test}> }}
 */
function lintSpec(md, kind, options = {}) {
  const errors = [];
  const warnings = [];
  const sec = sectionsOf(md);
  for (const s of REQUIRED[kind] || REQUIRED.task) {
    if (!sec.has(s)) errors.push(`seção obrigatória ausente: ${s}`);
    else if (!sec.get(s).replace(/[-*\s]/g, '')) errors.push(`seção vazia: ${s}`);
  }
  const criteria = parseCriteria(md);
  if ((REQUIRED[kind] || []).some((s) => /Critérios/.test(s)) && !criteria.length) errors.push('nenhum critério no formato "1. **CA-1** — Dado … quando … então … · Teste: …"');
  for (const c of criteria) {
    // a vague word counts unless a number follows it closely ("rápido: em até 2 s"); another number elsewhere in the
    // sentence ("4000 caracteres") does not measure it
    const vague = new RegExp(VAGUE_RE.source, 'gi');
    let vm;
    while ((vm = vague.exec(c.text))) {
      // OXB-C20 #5: allow "simples" when qualifying a known domain noun (e.g. "shell simples", "texto simples", "clique simples")
      if (/^simples$/i.test(vm[0])) {
        const before = c.text.slice(Math.max(0, vm.index - 32), vm.index);
        if (/\b(?:shell|texto|clique|valor|lista|consulta|busca|modo|campo|sele[cç][aã]o|linha|comando|arquivo|filtro|tipo|formato|rota|requisi[cç][aã]o|tabela|vis[aã]o|layout|terminal|prompt|editor|string|json|sql|regex)\s+$/i.test(before)) {
          continue;
        }
      }
      if (!HAS_NUMBER_RE.test(c.text.slice(vm.index, vm.index + vm[0].length + 30))) { errors.push(`${c.id} é vago ("${vm[0]}" sem número ou limiar): diga o que se mede e quanto`); break; }
    }
    if (!c.test || TBC_RE.test(c.test)) errors.push(`${c.id} sem o teste que o prova (· Teste: <arquivo ou nome do teste>)`);
    if (!/\b(dado|quando|então|entao|given|when|then)\b/i.test(c.text)) warnings.push(`${c.id} fora do formato Dado/Quando/Então`);
  }
  const fora = sec.get('Fora de escopo');
  if (fora != null && /^[-\s]*(a confirmar)?\s*$/i.test(fora)) errors.push('Fora de escopo sem nenhum item: diga o que esta entrega NÃO faz');
  const body = [...sec.entries()].filter(([k]) => k !== 'Perguntas em aberto').map(([, v]) => v).join('\n');
  const tbc = (body.match(TBC_RE_G) || []).length;
  const questions = (sec.get('Perguntas em aberto') || '').split('\n').map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter((l) => l && !/^\(preencha/.test(l) && !/^\(?\s*nenhuma\b/i.test(l));
  if (tbc && !questions.length) errors.push(`${tbc} item(ns) "A confirmar" sem pergunta em "Perguntas em aberto"`);
  if (tbc) warnings.push(`${tbc} item(ns) "A confirmar": o card recebe needs-info, com as perguntas num comentário`);
  const artifacts = options.artifacts || (options.projectRoot ? discoverProjectArtifacts(options.projectRoot, options.activeSession || null) : null);
  if (kind === 'story' && artifacts && artifacts.has_any) {
    const hasUpstreamDesign = Boolean(
      artifacts.prd
      || artifacts.system_design
      || (artifacts.rfcs && artifacts.rfcs.length)
      || (artifacts.adrs && artifacts.adrs.length)
      || (artifacts.decisions && artifacts.decisions.length)
    );
    const hasSpecLink = criteria.some((c) => c.spec_id || c.plan_ref);
    const avail = [
      artifacts.prd && 'PRD.md',
      artifacts.spec && 'SPEC.md',
      artifacts.system_design && 'SYSTEM-DESIGN.md',
      artifacts.rfcs && artifacts.rfcs.length && 'RFC',
      ((artifacts.adrs && artifacts.adrs.length) || (artifacts.decisions && artifacts.decisions.length)) && 'ADR/D-nn',
    ].filter(Boolean);
    if (!ARTIFACT_CITE_RE.test(body) && (hasUpstreamDesign || !hasSpecLink)) {
      warnings.push(`rastreabilidade: o projeto possui artefatos OXE (${avail.join(', ')}) mas a história não referencia nenhum (PRD/US-n, SYSTEM-DESIGN, RFC ou ADR/D-nn)`);
    }
    if (artifacts.system_design && !sec.has('Arquitetura e fluxo') && !/SYSTEM-DESIGN/i.test(body)) {
      warnings.push('arquitetura: o projeto possui SYSTEM-DESIGN.md mas a história não traz a seção "Arquitetura e fluxo" nem referencia o documento');
    }
  }

  // OXB-222-11: mechanical repo path validation, existing-symbol verification and anti-combo cohesion checks.
  const rootAbs = options.projectRoot ? path.resolve(options.projectRoot) : null;
  const NEW_PATH_HINT_RE = /\b(?:novo|nova|criar|a\s+criar|gerado|new|to\s+be\s+created)\b/i;
  const EPHEMERAL_OXE_RE = /^\.oxe\/(?:grill|alm\/grill|runs|tmp|evidence|quick|checkpoints|archive)(?:\/|$)/i;
  const PLACEHOLDER_SEG_RE = /(?:^|\/)(?:KEY|ID|CARD|SLUG|RUN_ID|SESSION|PHASE|Fn|Tn)(?:\/|$)/;
  const REPO_PATH_RE = /`((?:\.oxe|docs|bin|oxe|src|packages|scripts|lib|tests?|e2e|shared|electron|mobile|app|config)\/[^`\r\n]+)`/g;
  if (rootAbs) {
    const checkedPaths = new Set();
    for (const secName of ['Referências', 'Arquitetura e fluxo']) {
      const secBody = sec.get(secName);
      if (!secBody) continue;
      for (const line of secBody.split('\n')) {
        let pm;
        const re = new RegExp(REPO_PATH_RE.source, 'g');
        while ((pm = re.exec(line))) {
          const raw = pm[1].trim();
          const clean = raw.replace(/#.*$/, '').replace(/:\d+(?::\d+)?$/, '').trim();
          if (!clean || /[*<>]|\.\.|^https?:/i.test(clean)) continue;
          if (EPHEMERAL_OXE_RE.test(clean) || PLACEHOLDER_SEG_RE.test(clean)) continue;
          const after = line.slice(pm.index + pm[0].length, pm.index + pm[0].length + 40);
          if (NEW_PATH_HINT_RE.test(after)) continue;
          if (checkedPaths.has(clean)) continue;
          checkedPaths.add(clean);
          const abs = path.join(rootAbs, clean);
          if (!fs.existsSync(abs)) {
            errors.push(`referência inexistente no repositório: \`${clean}\` (confira o caminho real ou marque "(novo)" se será criado)`);
          }
        }
      }
    }

    // Verify `file.ext` (`symbol`) pairs against existing files (skip creation verbs)
    const CREATE_VERB_RE = /\b(?:criar|adicionar|implementar|exportar|introduzir|novo|nova|add|create|implement|export|new)\b/i;
    const FILE_SYM_RE = /`([A-Za-z0-9_.\-/]+\.(?:[cm]?js|tsx?|jsx?|py|go|rs))`\s*\(\s*`([A-Za-z_$][\w$]*)`\s*\)/g;
    const fileCache = new Map();
    const checkedSyms = new Set();
    for (const secName of ['Regras técnicas', 'Critérios de aceite', 'Arquitetura e fluxo']) {
      const secBody = sec.get(secName);
      if (!secBody) continue;
      let sm;
      const re = new RegExp(FILE_SYM_RE.source, 'g');
      while ((sm = re.exec(secBody))) {
        const fileRel = sm[1].trim();
        const sym = sm[2].trim();
        if (!fileRel || !sym || /[*<>]|\.\./.test(fileRel)) continue;
        const before = secBody.slice(Math.max(0, sm.index - 40), sm.index);
        if (CREATE_VERB_RE.test(before)) continue;
        const pairKey = `${fileRel}::${sym}`;
        if (checkedSyms.has(pairKey)) continue;
        checkedSyms.add(pairKey);
        const abs = path.join(rootAbs, fileRel);
        if (!fs.existsSync(abs)) continue;
        let content = fileCache.get(abs);
        if (content === undefined) {
          try { content = fs.readFileSync(abs, 'utf8'); } catch { content = ''; }
          fileCache.set(abs, content);
        }
        const symRe = new RegExp(`(?<![A-Za-z0-9_$])${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_$])`);
        if (content && !symRe.test(content)) {
          warnings.push(`símbolo \`${sym}\` citado como existente não encontrado em \`${fileRel}\` — confira o código real antes de fechar o card`);
        }
      }
    }
  }

  // Anti-combo cohesion warning for story/task (epics naturally span modules)
  if (kind === 'story' || kind === 'task') {
    const comboReasons = [];
    const titleMatch = /^#\s+(?:[A-Z]+-\d+\s*[—–-]\s*)?(.*)$/m.exec(String(md || '').replace(/<!--[\s\S]*?-->/g, ''));
    const cleanTitle = titleMatch ? titleMatch[1].trim() : '';
    const titleParts = cleanTitle.split(/[,+]|\s+e\s+/i).map((x) => x.trim()).filter(Boolean);
    if (cleanTitle.length > 120 && titleParts.length >= 4) {
      comboReasons.push(`título muito amplo (${cleanTitle.length} chars, ${titleParts.length} frentes)`);
    }
    const refsSec = sec.get('Referências') || '';
    const codeLines = refsSec.split('\n').filter((l) => /^\s*[-*]\s*C[oó]digo\s*:/i.test(l));
    const codePaths = new Set();
    for (const l of codeLines) {
      for (const m of l.matchAll(/`([^`\r\n]+\.(?:[cm]?js|tsx?|jsx?|py|go|rs|json|md))`/g)) codePaths.add(m[1].trim());
    }
    if (codePaths.size >= 5) {
      comboReasons.push(`${codePaths.size} arquivos distintos em Referências/Código`);
    }
    const compoundCas = criteria.filter((c) => /;\s+e\s+/i.test(c.text.replace(/`[^`]*`/g, '')));
    if (compoundCas.length) {
      comboReasons.push(`${compoundCas.map((c) => c.id).join(', ')} combina múltiplas proposições com "; e "`);
    }
    if (comboReasons.length) {
      warnings.push(`coesão/granularidade (card combo): ${comboReasons.join('; ')} — considere dividir em cards menores e independentes`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, questions, criteria, needs_info: tbc > 0 };
}

// ── apply ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What goes into the card's description: the spec without the header comment and the original text block. */
function descriptionBody(md) {
  return String(md).replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->\n?/g, '').replace(/^#\s+.*\n+/, '').trim();
}

/**
 * Writes the refined spec into the card (REST). Never overwrites a card edited after the collect unless confirmed.
 * @returns {Promise<object>}
 */
async function apply(ctx, collected, md, options = {}) {
  const { request, site } = ctx;
  const encKey = encodeURIComponent(collected.key);
  const lint = lintSpec(md, collected.kind, {
    projectRoot: options.projectRoot || null,
    artifacts: options.artifacts || null,
  });
  if (!lint.ok && !options.allowLintErrors) throw Object.assign(new Error(`spec reprovado no lint:\n  - ${lint.errors.join('\n  - ')}`), { lint });
  const now = await request('GET', `${site}/rest/api/3/issue/${encKey}?fields=description,labels`);
  const currentText = adfToText(now && now.fields ? now.fields.description : null).trim();
  const body = descriptionBody(md);
  const specHash = hash(body);
  // OxeSpace 14/11 (OXE-134/89/87): an amended spec was labelled spec-v1 again — the card could not tell it from the
  // first. The version follows the card's own marker: a different sha than the applied one is the next version. spec-v1
  // stays (it means "refined", what the ready gate reads); spec-vN is added from v2 on.
  const prev = /oxe-refine spec-v(\d+) · sha ([0-9a-f]+)/.exec(currentText);
  const prevFromCollect = /oxe-refine spec-v(\d+) · sha ([0-9a-f]+)/.exec(collected && collected.description ? collected.description : '');
  const alreadyRefinedInJira = Boolean(prev);
  // OXB-C4: when Jira already holds our own prior `oxe-refine spec-vN`, re-applying an amended spec overwrites
  // cleanly without `--confirm-overwrite` and without reposting `Texto original (antes do refine)` as a new comment.
  const sameRefinedCard = alreadyRefinedInJira && (!prevFromCollect || prevFromCollect[2] === prev[2]);
  const version = prev ? Number(prev[1]) + (prev[2] === specHash ? 0 : 1) : 1;
  const marker = `oxe-refine spec-v${version} · sha ${specHash}`;
  // OxeSpace 15/11 (OXE-189): a spec with no open question left takes needs-info off the card (apply only added it)
  const hadLabels = now && now.fields && Array.isArray(now.fields.labels) ? now.fields.labels : [];
  const clearNeedsInfo = !lint.needs_info && hadLabels.includes('needs-info');
  if (currentText.includes(`sha ${specHash}`)) {
    if (clearNeedsInfo && !options.dryRun) await request('PUT', `${site}/rest/api/3/issue/${encKey}`, { update: { labels: [{ remove: 'needs-info' }] } });
    return { key: collected.key, unchanged: true, sha: specHash, ...(clearNeedsInfo ? { [options.dryRun ? 'would_remove' : 'removed']: ['needs-info'] } : {}) };
  }
  if (hash(currentText) !== collected.description_hash && !sameRefinedCard && !options.confirmOverwrite) {
    throw Object.assign(new Error(`${collected.key} mudou depois da coleta (alguém editou o card): nada foi gravado. Colete de novo (oxe-cc alm refine ${collected.key}) ou, depois de revisar a diferença, rode com --confirm-overwrite`), { changed: true, current: currentText });
  }
  const labels = ['spec-v1', ...(version > 1 ? [`spec-v${version}`] : []), ...(lint.needs_info ? ['needs-info'] : [])];
  const postOriginalComment = Boolean(collected.description) && !alreadyRefinedInJira && !prevFromCollect;
  // --dry-run: everything above only read; report what the apply would write and stop (OXB-G13)
  if (options.dryRun) return { key: collected.key, dry_run: true, sha: specHash, labels, questions: lint.questions.length, would: { original_comment: postOriginalComment, description: true, labels, questions_comment: Boolean(lint.needs_info && lint.questions.length), ...(clearNeedsInfo ? { remove_labels: ['needs-info'] } : {}) } };
  const adf = mdToAdf(`${body}\n\n---\n${marker}`);
  if (postOriginalComment) {
    await request('POST', `${site}/rest/api/3/issue/${encKey}/comment`, { body: mdToAdf(`**Texto original (antes do refine)**\n\n${collected.description}`) });
  }
  await request('PUT', `${site}/rest/api/3/issue/${encKey}`, { fields: { description: adf }, update: { labels: [...labels.map((l) => ({ add: l })), ...(clearNeedsInfo ? [{ remove: 'needs-info' }] : [])] } });
  if (lint.needs_info && lint.questions.length) {
    await request('POST', `${site}/rest/api/3/issue/${encKey}/comment`, { body: mdToAdf(`**Perguntas em aberto (refine)**\n\n${lint.questions.map((q) => `- ${q}`).join('\n')}`) });
  }
  const back = await request('GET', `${site}/rest/api/3/issue/${encKey}?fields=description,labels`);
  const ok = adfToText(back.fields.description).includes(`sha ${specHash}`) && labels.every((l) => (back.fields.labels || []).includes(l))
    && !(clearNeedsInfo && (back.fields.labels || []).includes('needs-info'));
  return { key: collected.key, applied: true, confirmed: ok, sha: specHash, version, labels, questions: lint.questions.length, ...(clearNeedsInfo ? { removed: ['needs-info'] } : {}) };
}

// ── cross-program SPEC / PLAN resolution (OXB-C4) ────────────────────────────────────────────────────────────────

const EPHEMERAL_WT_RE = /-(?:pr\d+|t\d+(?:dbg)?|oq-t\d+\w*|f\d+-t\d+\w*|oxe\d+fix)$/i;
const normProg = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[·/,_:]+/g, ' ').replace(/\s+/g, ' ').trim();
const escRe = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keyBoundaryRe = (key) => new RegExp(`(?<![A-Za-z0-9-])${escRe(key)}(?![A-Za-z0-9-])`, 'i');

function readTextQuiet(p) {
  try { return p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; }
}
function readJsonQuietLocal(p) {
  try { return p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; }
}

function activeSessionDirForRoot(rootAbs, activeSession) {
  let sess = activeSession || null;
  if (!sess) {
    const state = readTextQuiet(path.join(rootAbs, '.oxe', 'STATE.md'));
    // both formats: `**active_session:** sessions/x` (session create, parseActiveSession) and `active_session: sessions/x`
    const m = /^\s*(?:[-*]\s*)?(?:\*\*)?active_session(?:\*\*)?\s*[:=]\s*(?:\*\*\s*)?([^\r\n]+)/im.exec(state);
    if (m) {
      const cand = m[1].trim().replace(/^[`'"]+|[`'"]+$/g, '').replace(/\\/g, '/');
      if (cand && cand !== 'none' && cand !== 'null' && !/^[-—]$/.test(cand)) sess = cand;
    }
  }
  return sess ? path.join(rootAbs, '.oxe', sess) : null;
}

function readProgramEntry(rootAbs, options = {}) {
  const abs = path.resolve(rootAbs);
  const oxeDir = path.join(abs, '.oxe');
  const sessDir = options.activeSession !== false ? activeSessionDirForRoot(abs, options.activeSession || null) : null;
  const pickFile = (rels) => {
    for (const rel of rels) if (rel && fs.existsSync(rel)) return rel;
    return null;
  };
  const specPath = pickFile([
    options.explicitSpecFile || null,
    sessDir ? path.join(sessDir, 'spec', 'SPEC.md') : null,
    path.join(oxeDir, 'SPEC.md'),
  ]);
  const planPath = pickFile([
    sessDir ? path.join(sessDir, 'plan', 'PLAN.json') : null,
    path.join(oxeDir, 'PLAN.json'),
  ]);
  if (!specPath && !planPath) return null;
  const specText = readTextQuiet(specPath);
  const planRaw = readTextQuiet(planPath);
  let planDoc = null;
  try { planDoc = planRaw ? JSON.parse(planRaw) : null; } catch { planDoc = null; }
  const programDir = pickFile([sessDir ? path.join(sessDir, 'program') : null, path.join(oxeDir, 'program')]) || path.join(oxeDir, 'program');
  const almLinksText = readTextQuiet(path.join(programDir, 'alm-links.ndjson'));
  const cfg = readJsonQuietLocal(path.join(oxeDir, 'config.json')) || {};
  const roadmapText = readTextQuiet(pickFile([sessDir ? path.join(sessDir, 'spec', 'ROADMAP.md') : null, path.join(oxeDir, 'ROADMAP.md')]));
  const prdText = readTextQuiet(pickFile([sessDir ? path.join(sessDir, 'spec', 'PRD.md') : null, path.join(oxeDir, 'PRD.md')]));

  const name = path.basename(abs);
  const stripVer = (s) => String(s || '').replace(/\s+\d+(?:\.\d+)+\s*$/, '').trim();
  const titleCandidates = [];
  if (cfg.alm && cfg.alm.program) titleCandidates.push(String(cfg.alm.program));
  if (cfg.program && typeof cfg.program === 'string') titleCandidates.push(cfg.program);
  const rmH = /^#\s+[^—\n-]+[—-]\s*(.+)$/m.exec(roadmapText);
  if (rmH) { titleCandidates.push(rmH[1].trim()); titleCandidates.push(stripVer(rmH[1].trim())); }
  const specH = /^#\s+(?:OXE\s*[—-]\s*Especifica[çc][ãa]o:\s*)?(.+)$/m.exec(specText);
  if (specH) { titleCandidates.push(specH[1].trim()); titleCandidates.push(stripVer(specH[1].trim())); }
  const prdH = /^#\s+(?:PRD\s*[—-]\s*)?(.+)$/m.exec(prdText);
  if (prdH) { titleCandidates.push(prdH[1].trim()); titleCandidates.push(stripVer(prdH[1].trim())); }
  if (planDoc && typeof planDoc.summary === 'string') {
    const preParen = planDoc.summary.split('(')[0].trim();
    if (preParen) titleCandidates.push(preParen);
  }
  const primaryTitle = rmH ? stripVer(rmH[1].trim()) : (cfg.alm && cfg.alm.program ? String(cfg.alm.program) : name);
  const specIds = specText ? require('./oxe-spec-edit.cjs').criteriaIds(specText) : [];
  const basePrefix = options.repoPrefix || '';
  const slug = basePrefix && name.startsWith(basePrefix) ? name.slice(basePrefix.length) : name;
  return {
    root: abs,
    name,
    slug,
    label: primaryTitle !== name ? `${slug} (${primaryTitle})` : slug,
    ephemeral: EPHEMERAL_WT_RE.test(name),
    titles: [...new Set([name, slug, ...titleCandidates].filter(Boolean))],
    specPath,
    specText,
    specIds,
    planPath,
    planDoc,
    planRaw,
    programDir,
    almLinksText,
  };
}

function repoFamilyPrefix(dirName) {
  const m = /^(.*-\d+(?:\.\d+)*-)/.exec(String(dirName || ''));
  return m ? m[1] : '';
}

function discoverProgramCatalog(projectRoot, options = {}) {
  if (Array.isArray(options.catalogCache)) return options.catalogCache;
  const os = require('os');
  const rootAbs = path.resolve(projectRoot);
  const baseName = path.basename(rootAbs);
  const prefix = options.repoPrefix != null ? String(options.repoPrefix) : repoFamilyPrefix(baseName);
  const tmpAbs = path.resolve(os.tmpdir());
  const parentDirs = [...new Set([
    path.dirname(rootAbs),
    ...((Array.isArray(options.programRoots) ? options.programRoots : []).map((d) => path.resolve(String(d)))),
  ])];
  const explicitRoots = new Set((Array.isArray(options.programRoots) ? options.programRoots : []).map((d) => path.resolve(String(d))));
  const candidateDirs = new Set([rootAbs]);
  const cfg = readJsonQuietLocal(path.join(rootAbs, '.oxe', 'config.json')) || {};
  for (const extra of [
    ...((cfg.alm && Array.isArray(cfg.alm.program_dirs)) ? cfg.alm.program_dirs : []),
    ...((Array.isArray(options.extraProgramDirs)) ? options.extraProgramDirs : []),
  ]) {
    if (extra) candidateDirs.add(path.resolve(rootAbs, String(extra)));
  }
  for (const parent of parentDirs) {
    // Avoid scanning unrelated temp dirs directly in os.tmpdir() unless explicitly requested or family-prefixed
    if (parent === tmpAbs && !prefix && !explicitRoots.has(parent)) continue;
    let entries = [];
    try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { entries = []; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (prefix && !e.name.startsWith(prefix)) continue;
      candidateDirs.add(path.join(parent, e.name));
    }
  }
  const catalog = [];
  for (const dir of candidateDirs) {
    const isLocal = dir === rootAbs;
    const entry = readProgramEntry(dir, { activeSession: isLocal ? options.activeSession : null, repoPrefix: prefix });
    if (entry) catalog.push(entry);
  }
  catalog.sort((a, b) => {
    if (a.root === rootAbs) return -1;
    if (b.root === rootAbs) return 1;
    if (a.ephemeral !== b.ephemeral) return a.ephemeral ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return catalog;
}

function resolveProgramSpec(projectRoot, activeSession, specRef, options = {}) {
  const ref = String(specRef || '').trim();
  if (!ref) return null;
  const rootAbs = path.resolve(projectRoot);
  const prefix = options.repoPrefix != null ? String(options.repoPrefix) : repoFamilyPrefix(path.basename(rootAbs));

  // 1. Direct filesystem path (to a SPEC .md, PLAN.json, or program folder)
  for (const cand of [...new Set([path.resolve(rootAbs, ref), path.resolve(ref)])]) {
    if (!fs.existsSync(cand)) continue;
    let st = null;
    try { st = fs.statSync(cand); } catch { st = null; }
    if (st && st.isFile()) {
      const parent = path.dirname(cand);
      const grand = path.basename(parent) === '.oxe' ? path.dirname(parent) : (path.basename(parent) === 'spec' ? path.dirname(path.dirname(path.dirname(parent))) : parent);
      const entry = readProgramEntry(grand, { activeSession: grand === rootAbs ? activeSession : false, explicitSpecFile: /\.md$/i.test(cand) ? cand : null, repoPrefix: prefix });
      if (entry) return entry;
      return {
        root: grand,
        name: path.basename(grand),
        slug: path.basename(grand),
        label: path.basename(cand),
        ephemeral: false,
        titles: [path.basename(cand)],
        specPath: cand,
        specText: readTextQuiet(cand),
        specIds: require('./oxe-spec-edit.cjs').criteriaIds(readTextQuiet(cand)),
        planPath: null,
        planDoc: null,
        planRaw: '',
        programDir: path.join(grand, '.oxe', 'program'),
        almLinksText: '',
      };
    }
    if (st && st.isDirectory()) {
      const entry = readProgramEntry(cand, { activeSession: cand === rootAbs ? activeSession : null, repoPrefix: prefix });
      if (entry) return entry;
    }
  }

  // 2. Match against sibling program catalog (slug, folder basename, normalized title)
  const catalog = discoverProgramCatalog(projectRoot, { activeSession, ...options });
  const targetNorm = normProg(ref);
  if (!targetNorm) return null;
  const ordered = [...catalog.filter((e) => !e.ephemeral), ...catalog.filter((e) => e.ephemeral)];
  for (const e of ordered) {
    if (e.name.toLowerCase() === ref.toLowerCase() || e.slug.toLowerCase() === ref.toLowerCase()) return e;
    if (prefix && e.name.toLowerCase() === `${prefix}${ref}`.toLowerCase()) return e;
    if (e.titles.some((t) => normProg(t) === targetNorm)) return e;
  }
  // Suffix or unambiguous partial title match (e.g. "Polimento Componentes base" vs versioned heading)
  for (const e of ordered) {
    if (e.name.toLowerCase().endsWith(`-${ref.toLowerCase()}`)) return e;
    if (e.titles.some((t) => { const nt = normProg(t); return nt && nt.length >= 4 && (nt.includes(targetNorm) || targetNorm.includes(nt)); })) return e;
  }
  return null;
}

function cardProgramHints(md) {
  const hints = [];
  const text = String(md || '');
  for (const m of text.matchAll(/\(\s*worktree\s+([^)\r\n]+)\)/gi)) hints.push(m[1].trim());
  for (const m of text.matchAll(/^\s*-\s*Plano:\s*(?:programa\s+)?([^(\r\n]+)/gim)) hints.push(m[1].trim());
  for (const c of parseCriteria(text)) {
    if (c.spec_program) hints.push(c.spec_program);
    if (c.plan_ref && c.plan_ref.program) hints.push(c.plan_ref.program);
  }
  return [...new Set(hints.map((h) => h.trim()).filter(Boolean))];
}

/** OXB-C27-5: every phase of the entry's program is closed (or the program itself is). */
function programClosed(entry) {
  try {
    const state = require('./oxe-program.cjs').readProgram(entry && entry.programDir);
    if (!state) return false;
    if (state.status === 'closed') return true;
    return state.phases.length > 0 && state.phases.every((p) => p && p.status === 'closed');
  } catch { return false; }
}

function resolveCardProgram(projectRoot, activeSession, { key, md = '', spec = null, catalogCache = null, programRoots = null } = {}) {
  const catalog = discoverProgramCatalog(projectRoot, { activeSession, catalogCache, programRoots });
  if (spec) {
    const explicit = resolveProgramSpec(projectRoot, activeSession, spec, { catalogCache: catalog, programRoots });
    if (!explicit) {
      throw new Error(`--spec "${spec}" não encontrado (disponíveis: ${catalog.filter((e) => !e.ephemeral).map((e) => e.slug).join(', ') || 'nenhum'})`);
    }
    return { entry: explicit, matchedBy: 'explicit_spec', catalog };
  }

  const rootAbs = path.resolve(projectRoot);
  // OXB-C27-5: the program of --dir (config.alm.program) wins over a loose card lookup (text in a SPEC, alm-links),
  // which picked another program's CLOSED phase until --spec was given. Only a PLAN task naming the card (OXB-C4)
  // still sends it to a sibling program; a closed program is never picked by lookup.
  const localCfg = readJsonQuietLocal(path.join(rootAbs, '.oxe', 'config.json')) || {};
  const ownProgram = localCfg.alm && localCfg.alm.program
    ? resolveProgramSpec(projectRoot, activeSession, String(localCfg.alm.program), { catalogCache: catalog, programRoots })
    : null;
  const own = ownProgram && !programClosed(ownProgram) ? ownProgram : null;
  const hints = cardProgramHints(md);
  const hintEntries = new Set();
  for (const h of hints) {
    const resolved = resolveProgramSpec(projectRoot, activeSession, h, { catalogCache: catalog, programRoots });
    if (resolved) hintEntries.add(resolved.root);
  }

  const keyStr = key ? String(key).toUpperCase() : '';
  const keyRe = keyStr ? keyBoundaryRe(keyStr) : null;
  let best = null;
  let bestScore = 0;

  for (const e of catalog) {
    let score = 0;
    if (programClosed(e)) continue;
    if (keyRe && e.planDoc && Array.isArray(e.planDoc.tasks)) {
      const taskHit = e.planDoc.tasks.some((t) => t && [t.id, t.title, t.commit, ...(Array.isArray(t.refs) ? t.refs : []), ...(Array.isArray(t.notes) ? t.notes : [t.notes])].filter(Boolean).some((v) => keyRe.test(String(v))));
      if (taskHit) score += 100;
      else if (e.planRaw && keyRe.test(e.planRaw)) score += 80;
    }
    if (keyRe && e.almLinksText && keyRe.test(e.almLinksText)) score += 60;
    if (hintEntries.has(e.root)) score += 50;
    if (keyRe && e.specText && keyRe.test(e.specText)) score += 40;
    if (score > 0 && e.root === rootAbs) score += 1; // local tie-breaker only when local actually matched the card
    if (score > 0 && !e.ephemeral) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }

  if (best && bestScore >= 100) return { entry: best, matchedBy: 'plan_card_lookup', catalog };
  if (own) return { entry: own, matchedBy: 'config_program', catalog };
  if (best) return { entry: best, matchedBy: 'card_lookup', catalog };
  const local = catalog.find((e) => e.root === rootAbs) || readProgramEntry(rootAbs, { activeSession });
  return { entry: local, matchedBy: 'dir_default', catalog };
}

function planTaskCriteria(task) {
  if (!task || typeof task !== 'object') return [];
  return [...new Set([...(Array.isArray(task.acceptance) ? task.acceptance : []), ...(Array.isArray(task.aceite) ? task.aceite : [])].map((x) => String(x || '').toUpperCase()).filter(Boolean))];
}

function lintCardCriteriaAgainstPrograms(md, key, primaryEntry, options = {}) {
  const errors = [];
  const warnings = [];
  const notLinked = [];
  const criteria = parseCriteria(md);
  const catalog = options.catalog || discoverProgramCatalog(options.projectRoot || (primaryEntry && primaryEntry.root) || '.', options);
  const keyStr = String(key || '').toUpperCase();
  const keyRe = keyStr ? keyBoundaryRe(keyStr) : null;
  const checkedPrograms = new Set();

  const taskSummary = (t) => `${t.id}${planTaskCriteria(t).length ? ` (${planTaskCriteria(t).join(', ')})` : ''}`;

  for (const c of criteria) {
    const rawTarget = c.spec_id ? { id: c.spec_id, program: c.spec_program, qualified: true }
      : (c.plan_ref ? { id: c.plan_ref.spec_id, program: c.plan_ref.program, qualified: false } : null);
    if (!rawTarget) {
      notLinked.push(c.id);
      continue;
    }
    let targetEntry = primaryEntry;
    if (rawTarget.program) {
      const resolved = resolveProgramSpec(options.projectRoot || (primaryEntry && primaryEntry.root) || '.', options.activeSession || null, rawTarget.program, { catalogCache: catalog, programRoots: options.programRoots });
      if (!resolved) {
        errors.push(`${c.id} aponta para programa "${rawTarget.program}" (${rawTarget.id}), que não foi encontrado`);
        continue;
      }
      targetEntry = resolved;
    }
    if (!targetEntry || !targetEntry.specText) continue;
    checkedPrograms.add(targetEntry.label || targetEntry.slug);
    const progSuffix = targetEntry.root !== (options.projectRoot ? path.resolve(options.projectRoot) : targetEntry.root)
      ? ` de ${targetEntry.slug}`
      : '';
    if (!targetEntry.specIds.includes(rawTarget.id)) {
      errors.push(`${c.id} aponta para ${rawTarget.id}, que não existe na SPEC${progSuffix}`);
      continue;
    }
    // Check card criteria against the target program's PLAN.json
    const tasks = targetEntry.planDoc && Array.isArray(targetEntry.planDoc.tasks)
      ? targetEntry.planDoc.tasks.filter((t) => t && t.status !== 'superseded' && !t.superseded && !t.merged_into)
      : [];
    if (tasks.length) {
      const tasksWithA = tasks.filter((t) => planTaskCriteria(t).includes(rawTarget.id));
      const tasksForCard = keyRe
        ? tasks.filter((t) => [t.id, t.title, t.commit, ...(Array.isArray(t.refs) ? t.refs : []), ...(Array.isArray(t.notes) ? t.notes : [t.notes])].filter(Boolean).some((v) => keyRe.test(String(v))))
        : [];
      if (!tasksWithA.length) {
        warnings.push(`${c.id} (${rawTarget.id}) existe na SPEC${progSuffix}, mas nenhuma tarefa do PLAN.json cobre ${rawTarget.id}`);
      } else if (tasksForCard.length && !tasksForCard.some((t) => planTaskCriteria(t).includes(rawTarget.id))) {
        const otherKeys = [...new Set(tasksWithA.flatMap((t) => String(t.title || '').match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || []).filter((k) => k.toUpperCase() !== keyStr))];
        if (otherKeys.length) {
          errors.push(`${c.id} aponta para ${rawTarget.id}, mas no PLAN.json${progSuffix} ${rawTarget.id} pertence a ${otherKeys.join(', ')} (${tasksWithA.map((t) => t.id).join(', ')}); ${keyStr} está em ${tasksForCard.map(taskSummary).join(', ')}`);
        } else {
          warnings.push(`${c.id} (${rawTarget.id}) não está nas tarefas de ${keyStr} no PLAN.json${progSuffix} (${tasksForCard.map(taskSummary).join(', ')})`);
        }
      }
    }
  }
  if (notLinked.length && primaryEntry && primaryEntry.specText) {
    const hintArg = primaryEntry.root !== (options.projectRoot ? path.resolve(options.projectRoot) : primaryEntry.root) ? ` --spec ${primaryEntry.slug}` : '';
    warnings.push(`${notLinked.length} CA(s) ainda sem critério da SPEC (${notLinked.join(', ')}) — oxe-cc alm refine import ${key}${hintArg} cria e liga`);
  }
  return { errors, warnings, programs: [...checkedPrograms] };
}

module.exports = { TBC_RE, parseCriteria, setSpecIds, collect, skeleton, lintSpec, apply, mdToAdf, adfToText, descriptionBody, kindOf, sectionsOf, dirs, hash, SECTIONS, REQUIRED, discoverProjectArtifacts, formatArtifactRefs, discoverProgramCatalog, resolveProgramSpec, resolveCardProgram, lintCardCriteriaAgainstPrograms };
