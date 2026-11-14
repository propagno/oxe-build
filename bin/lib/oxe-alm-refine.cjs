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
  const out = [
    `<!-- oxe-refine: ${c.key} · tipo ${kind} · coletado ${c.collected_at} · descricao-sha ${c.description_hash} -->`,
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
 * The card's criteria: `1. **CA-2 (A14)** — Dado … · Teste: <teste> · Risco: P1`. The `(A14)` is the program SPEC's
 * criterion the CA becomes (oxe-cc alm refine import writes it); `Risco` feeds the SPEC's Risco column.
 * @returns {Array<{ id: string, spec_id: string|null, text: string, test: string|null, risk: string|null, line: number }>}
 */
function parseCriteria(md) {
  const sec = sectionsOf(md);
  const name = sec.has('Critérios de aceite') ? 'Critérios de aceite' : 'Critérios de correção';
  const out = [];
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  let inside = false;
  lines.forEach((line, i) => {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { inside = h[1].trim() === name; return; }
    if (!inside) return;
    const m = /^\s*(?:\d+[.)]|[-*])\s+\*\*(CA-\d+)(?:\s*\(([AG]\d+(?:\.\d+)?)\))?\*\*(?:\s*\(([AG]\d+(?:\.\d+)?)\))?\s*[—–:-]\s*(.*)$/.exec(line);
    if (!m) return;
    const rest = m[4];
    const testM = /·\s*Teste:\s*([^·]+)/i.exec(rest);
    const riskM = /·\s*Risco:\s*(P[0-3])\b/i.exec(rest);
    out.push({ id: m[1], spec_id: m[2] || m[3] || null, text: rest.split(/\s*·\s*(?:Teste|Risco):/i)[0].trim(), test: testM ? testM[1].trim() : null, risk: riskM ? riskM[1].toUpperCase() : null, line: i });
  });
  return out;
}

/** Writes `(A14)` into the CA lines that got a SPEC criterion. */
function setSpecIds(md, map) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  for (const c of parseCriteria(md)) {
    const a = map.get(c.id);
    if (!a || c.spec_id) continue;
    lines[c.line] = lines[c.line].replace(`**${c.id}**`, `**${c.id} (${a})**`);
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
    if (!c.test || /a confirmar/i.test(c.test)) errors.push(`${c.id} sem o teste que o prova (· Teste: <arquivo ou nome do teste>)`);
    if (!/\b(dado|quando|então|entao|given|when|then)\b/i.test(c.text)) warnings.push(`${c.id} fora do formato Dado/Quando/Então`);
  }
  const fora = sec.get('Fora de escopo');
  if (fora != null && /^[-\s]*(a confirmar)?\s*$/i.test(fora)) errors.push('Fora de escopo sem nenhum item: diga o que esta entrega NÃO faz');
  const body = [...sec.entries()].filter(([k]) => k !== 'Perguntas em aberto').map(([, v]) => v).join('\n');
  const tbc = (body.match(/a confirmar/gi) || []).length;
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
  const lint = lintSpec(md, collected.kind);
  if (!lint.ok && !options.allowLintErrors) throw Object.assign(new Error(`spec reprovado no lint:\n  - ${lint.errors.join('\n  - ')}`), { lint });
  const now = await request('GET', `${site}/rest/api/3/issue/${collected.key}?fields=description,labels`);
  const currentText = adfToText(now && now.fields ? now.fields.description : null).trim();
  const body = descriptionBody(md);
  const specHash = hash(body);
  // OxeSpace 14/11 (OXE-134/89/87): an amended spec was labelled spec-v1 again — the card could not tell it from the
  // first. The version follows the card's own marker: a different sha than the applied one is the next version. spec-v1
  // stays (it means "refined", what the ready gate reads); spec-vN is added from v2 on.
  const prev = /oxe-refine spec-v(\d+) · sha ([0-9a-f]+)/.exec(currentText);
  const version = prev ? Number(prev[1]) + (prev[2] === specHash ? 0 : 1) : 1;
  const marker = `oxe-refine spec-v${version} · sha ${specHash}`;
  if (currentText.includes(`sha ${specHash}`)) return { key: collected.key, unchanged: true, sha: specHash };
  if (hash(currentText) !== collected.description_hash && !options.confirmOverwrite) {
    throw Object.assign(new Error(`${collected.key} mudou depois da coleta (alguém editou o card): nada foi gravado. Colete de novo (oxe-cc alm refine ${collected.key}) ou, depois de revisar a diferença, rode com --confirm-overwrite`), { changed: true, current: currentText });
  }
  const labels = ['spec-v1', ...(version > 1 ? [`spec-v${version}`] : []), ...(lint.needs_info ? ['needs-info'] : [])];
  // --dry-run: everything above only read; report what the apply would write and stop (OXB-G13)
  if (options.dryRun) return { key: collected.key, dry_run: true, sha: specHash, labels, questions: lint.questions.length, would: { original_comment: Boolean(collected.description), description: true, labels, questions_comment: Boolean(lint.needs_info && lint.questions.length) } };
  const adf = mdToAdf(`${body}\n\n---\n${marker}`);
  if (collected.description) {
    await request('POST', `${site}/rest/api/3/issue/${collected.key}/comment`, { body: mdToAdf(`**Texto original (antes do refine)**\n\n${collected.description}`) });
  }
  await request('PUT', `${site}/rest/api/3/issue/${collected.key}`, { fields: { description: adf }, update: { labels: labels.map((l) => ({ add: l })) } });
  if (lint.needs_info && lint.questions.length) {
    await request('POST', `${site}/rest/api/3/issue/${collected.key}/comment`, { body: mdToAdf(`**Perguntas em aberto (refine)**\n\n${lint.questions.map((q) => `- ${q}`).join('\n')}`) });
  }
  const back = await request('GET', `${site}/rest/api/3/issue/${collected.key}?fields=description,labels`);
  const ok = adfToText(back.fields.description).includes(`sha ${specHash}`) && labels.every((l) => (back.fields.labels || []).includes(l));
  return { key: collected.key, applied: true, confirmed: ok, sha: specHash, version, labels, questions: lint.questions.length };
}

module.exports = { parseCriteria, setSpecIds, collect, skeleton, lintSpec, apply, mdToAdf, adfToText, descriptionBody, kindOf, sectionsOf, dirs, hash, SECTIONS, REQUIRED };
