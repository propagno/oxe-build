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
    case 'text': return node.text || '';
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
  const existing = options.projectRoot ? codeRefs.filter((p) => fs.existsSync(path.join(options.projectRoot, p.replace(/:\d+$/, '')))) : [];
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
  story: ['História', 'Contexto', 'Critérios de aceite', 'Regras de negócio', 'Regras técnicas', 'Fora de escopo', 'Dependências', 'Riscos', 'Definição de pronto', 'Referências', 'Perguntas em aberto'],
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
  const refs = [
    `- Card: [${c.key}](${c.url}) · ${c.type || kind} · ${c.status || '—'}${c.fix_versions.length ? ` · versão ${c.fix_versions.join(', ')}` : ''}`,
    ...(c.parent ? [`- Épico/pai: ${c.parent.key}${c.parent.summary ? ` — ${c.parent.summary}` : ''}`] : []),
    ...c.links.map((l) => `- ${l.type}: ${l.key}${l.summary ? ` — ${l.summary}` : ''}${l.status ? ` (${l.status})` : ''}`),
    ...c.design_refs.map((r) => `- Design: ${r}`),
    ...c.code_refs.map((p) => `- Código: \`${p}\`${c.code_refs_found.includes(p) ? '' : ' (não encontrado no repositório)'}`),
    ...(c.dev ? [`- Desenvolvimento: ${c.dev.pullrequests} PR(s), ${c.dev.commits} commit(s), ${c.dev.builds} build(s)`] : []),
  ];
  const body = {
    'História': [`Como **${TBC}**, quero **${c.summary || TBC}**, para **${TBC}**.`],
    Resumo: [c.summary || TBC],
    Objetivo: [c.summary || TBC],
    Contexto: [c.description ? c.description.split('\n').filter(Boolean).slice(0, 12).join('\n') : TBC],
    'Critérios de aceite': ['1. **CA-1** — Dado … quando … então … _(A confirmar)_ · Teste: A confirmar'],
    'Critérios de correção': ['1. **CA-1** — Dado … quando … então … _(A confirmar)_ · Teste: A confirmar'],
    'Regras de negócio': [`- **RN-1** — ${TBC}`],
    'Regras técnicas': [`- **RT-1** — ${TBC} (arquivos, contratos/IPC, migração, desempenho, testes congelados afetados, compatibilidade)`],
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
    const m = /^\s*(?:\d+[.)]|[-*])\s+\*\*(CA-\d+)(?:\s*\((?:([A-Za-z0-9][A-Za-z0-9._-]*):)?([AG]\d+(?:\.\d+)*)\))?\*\*(?:\s*\((?:([A-Za-z0-9][A-Za-z0-9._-]*):)?([AG]\d+(?:\.\d+)*)\))?\s*[—–:-]\s*(.*)$/.exec(line);
    if (!m) return;
    const rest = m[6];
    const testM = /·\s*Teste:\s*([^·]+)/i.exec(rest);
    const riskM = /·\s*Risco:\s*(P[0-3])\b/i.exec(rest);
    const text = rest.split(/\s*·\s*(?:Teste|Risco):/i)[0].trim();
    const specId = m[3] || m[5] || null;
    const specProgram = m[2] || m[4] || null;
    let planRef = null;
    const planoM = /\(\s*plano:\s*([AG]\d+(?:\.\d+)*)(?:\s*,\s*([^)\n]+))?\)/i.exec(text);
    if (planoM) {
      planRef = { spec_id: planoM[1].toUpperCase(), program: planoM[2] ? planoM[2].trim() : null };
    }
    out.push({
      id: m[1],
      spec_id: specId ? specId.toUpperCase() : null,
      spec_program: specProgram || null,
      plan_ref: planRef,
      text,
      test: testM ? testM[1].trim() : null,
      risk: riskM ? riskM[1].toUpperCase() : null,
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
    lines[c.line] = lines[c.line].replace(`**${c.id}**`, `**${c.id} (${prefix}${a})**`);
  }
  return lines.join('\n');
}

/**
 * @returns {{ ok: boolean, errors: string[], warnings: string[], questions: string[], criteria: Array<{id,text,test}> }}
 */
function lintSpec(md, kind) {
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
  const lint = lintSpec(md, collected.kind);
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
    const m = /active_session\s*[:=]\s*([^\r\n]+)/i.exec(state);
    if (m) {
      const cand = m[1].trim().replace(/^[`'"]+|[`'"]+$/g, '');
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

  if (best) return { entry: best, matchedBy: bestScore >= 100 ? 'plan_card_lookup' : 'card_lookup', catalog };
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

module.exports = { TBC_RE, parseCriteria, setSpecIds, collect, skeleton, lintSpec, apply, mdToAdf, adfToText, descriptionBody, kindOf, sectionsOf, dirs, hash, SECTIONS, REQUIRED, discoverProgramCatalog, resolveProgramSpec, resolveCardProgram, lintCardCriteriaAgainstPrograms };
