'use strict';

/**
 * OXB-123: edge and prohibition probes on the spec. For each criterion A*, a closed taxonomy of edges raises only the
 * categories its text calls for; each edge is then `coberta` (a subcriterion with a verify), `descartada` (reason
 * required), `prova_extra` (needs a test outside the criterion) or `aberta` (becomes a plan assumption). A prohibition
 * probe asks what the feature must NOT do and records negative criteria `N<n>` at level `teste` (has a verify) or
 * `julgamento` (needs a sign-off). Items `prova_extra` / `julgamento` without explicit evidence are `needs_human` —
 * never passed.
 *
 * SPEC sections: `## Bordas` (| ID | Critério | Borda | Status | Motivo / verify |) and
 * `## Proibições` (| ID | Critério | Não pode | Nível | Verify |).
 */

const TAXONOMY = [
  { key: 'limite', q: 'o que acontece no mínimo, no máximo e logo além do limite?', re: /\b(m[aá]x|m[ií]n|limite|at[eé]\s+\d|\d+\s*(caracteres|itens|mb|kb|s|ms|%)|tamanho|quantidade|tentativas)\b/i },
  { key: 'vazio', q: 'e com a entrada vazia, nula ou sem itens?', re: /\b(lista|vazi[oa]|nenhum|sem\s+\w+|campo|entrada|busca|filtro|resultado)\b/i },
  { key: 'adjacência', q: 'e nos valores vizinhos da borda (início/fim de intervalo, primeiro/último item)?', re: /\b(entre|intervalo|per[ií]odo|in[ií]cio|fim|primeir[oa]|[uú]ltim[oa]|anterior|pr[oó]xim[oa])\b/i },
  { key: 'encoding/locale', q: 'com acentos, emoji, outro idioma, outro formato de data ou moeda?', re: /\b(texto|nome|idioma|pt-br|i18n|tradu|data|hora|moeda|r\$|formato|mensagem|r[oó]tulo)\b/i },
  { key: 'ordem', q: 'a ordem importa? e fora de ordem ou repetido?', re: /\b(ordem|orden|sequ[eê]ncia|lista|hist[oó]rico|fila|antes|depois)\b/i },
  { key: 'precisão', q: 'arredondamento, casas decimais, fuso horário?', re: /\b(valor|pre[cç]o|total|soma|percent|%|decimal|tempo|dura[cç][aã]o|taxa|m[eé]dia)\b/i },
  { key: 'idempotência', q: 'o que acontece se repetir a ação (duplo clique, reenviar, reimportar)?', re: /\b(salv|envi|cri[ao]|import|export|confirm|pag|registr|sincroniz|atualiz)\w*/i },
  { key: 'concorrência', q: 'e com duas ações ao mesmo tempo ou outra janela/processo mexendo junto?', re: /\b(simult|paralel|ao mesmo tempo|concorr|sincroniz|janela|aba|processo|worker|fila)\w*/i },
  { key: 'teclado e foco', q: 'dá para fazer só com teclado? onde o foco vai antes, durante e depois?', re: /\b(bot[aã]o|tela|di[aá]logo|modal|formul[aá]rio|menu|painel|campo|aba|lista|ui|interface|clic)\w*/i },
];

const PROHIBITIONS = [
  { key: 'perda de dado', text: 'apagar ou sobrescrever dado do usuário sem confirmação', re: /\b(salv|apag|remov|exclu|import|sincroniz|migra)\w*/i },
  { key: 'vazamento', text: 'expor segredo, token ou dado pessoal em log, tela ou rede', re: /\b(token|senha|chave|segredo|login|conta|e-?mail|pessoa|usu[aá]rio)\w*/i },
  { key: 'rede', text: 'depender de rede quando o fluxo deve funcionar offline/local', re: /\b(offline|local|sem internet|on-device)\b/i },
  { key: 'travamento', text: 'travar a interface enquanto a operação roda', re: /\b(carreg|process|import|export|gerar|baixar|sincroniz|busca)\w*/i },
  { key: 'erro cru', text: 'mostrar erro técnico cru, sem tradução, ao usuário', re: /\b(erro|falha|mensagem|aviso|tela|ui)\w*/i },
];

function criteriaOf(specText) {
  const out = [];
  for (const line of String(specText || '').split(/\r?\n/)) {
    const m = /^\|\s*(A\d+)\s*\|([^|]*)\|/.exec(line);
    if (m) out.push({ id: m[1], text: m[2].trim() });
  }
  return out;
}

/** The edges and prohibitions a criterion's text calls for. */
function probe(criterion) {
  const edges = TAXONOMY.filter((t) => t.re.test(criterion.text)).map((t, i) => ({ id: `${criterion.id}.e${i + 1}`, criterion: criterion.id, edge: t.key, question: t.q, status: 'aberta', note: '' }));
  const prohibitions = PROHIBITIONS.filter((p) => p.re.test(criterion.text)).map((p) => ({ criterion: criterion.id, kind: p.key, text: p.text, level: 'julgamento', verify: '' }));
  return { edges, prohibitions };
}

function parseSection(specText, title) {
  const lines = String(specText || '').split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${title}\\s*$`, 'i').test(l));
  if (start < 0) return [];
  const rows = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i += 1) {
    const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length >= 4 && !/^-+$/.test(cells[0]) && cells[0] !== 'ID') rows.push(cells);
  }
  return rows;
}

function readEdges(specText) {
  return parseSection(specText, 'Bordas').map(([id, criterion, edge, status, note]) => ({ id, criterion, edge, status: String(status || '').toLowerCase().replace(/\s+/g, '_'), note: note || '' }));
}
function readProhibitions(specText) {
  return parseSection(specText, 'Proibi[cç][oõ]es').map(([id, criterion, text, level, verify]) => ({ id, criterion, text, level: String(level || '').toLowerCase(), verify: verify || '' }));
}

/** Appends `## Bordas` / `## Proibições` for the criteria that have none yet (existing rows are kept untouched). */
function writeProbe(specText, ids) {
  const crit = criteriaOf(specText).filter((c) => !ids || !ids.length || ids.includes(c.id));
  const haveEdges = new Set(readEdges(specText).map((e) => e.criterion));
  const haveNo = new Set(readProhibitions(specText).map((p) => p.criterion));
  const nextN = readProhibitions(specText).reduce((m, p) => Math.max(m, Number(String(p.id).replace(/\D/g, '')) || 0), 0);
  const newEdges = [];
  const newNo = [];
  let n = nextN;
  for (const c of crit) {
    const p = probe(c);
    if (!haveEdges.has(c.id)) newEdges.push(...p.edges);
    if (!haveNo.has(c.id)) for (const x of p.prohibitions) { n += 1; newNo.push({ ...x, id: `N${n}` }); }
  }
  let out = String(specText || '').replace(/\s*$/, '\n');
  const addRows = (title, header, rows, fmt) => {
    if (!rows.length) return;
    if (new RegExp(`^##\\s+${title}\\s*$`, 'im').test(out)) {
      const lines = out.split('\n');
      const start = lines.findIndex((l) => new RegExp(`^##\\s+${title}\\s*$`, 'i').test(l));
      let end = start + 1;
      while (end < lines.length && !/^##\s/.test(lines[end])) end += 1;
      while (end > start + 1 && !lines[end - 1].trim()) end -= 1;
      lines.splice(end, 0, ...rows.map(fmt));
      out = lines.join('\n');
    } else {
      out += `\n## ${title.replace('Proibi[cç][oõ]es', 'Proibições')}\n\n${header}\n${rows.map(fmt).join('\n')}\n`;
    }
  };
  addRows('Bordas', '| ID | Critério | Borda | Status | Motivo / verify |\n|---|---|---|---|---|', newEdges, (e) => `| ${e.id} | ${e.criterion} | ${e.edge}: ${e.question} | aberta | |`);
  addRows('Proibi[cç][oõ]es', '| ID | Critério | Não pode | Nível | Verify |\n|---|---|---|---|---|', newNo, (x) => `| ${x.id} | ${x.criterion} | ${x.text} | julgamento | |`);
  return { text: out, edges: newEdges, prohibitions: newNo };
}

/** Lint of the probe sections. */
function lintProbe(specText, doc) {
  const errors = [];
  const warnings = [];
  const assumptions = JSON.stringify((doc && doc.assumptions) || []) + JSON.stringify(((doc && doc.tasks) || []).map((t) => t.assumptions || []));
  for (const e of readEdges(specText)) {
    if (!['coberta', 'descartada', 'prova_extra', 'aberta'].includes(e.status)) errors.push(`${e.id}: status "${e.status}" inválido (coberta | descartada | prova_extra | aberta)`);
    if (e.status === 'descartada' && String(e.note).trim().length < 5) errors.push(`${e.id}: borda descartada sem motivo`);
    if (e.status === 'aberta' && !assumptions.includes(e.id)) warnings.push(`${e.id}: borda aberta sem suposição no plano (\"assumptions\": [\"${e.id}: …\"])`);
  }
  for (const p of readProhibitions(specText)) if (!['teste', 'julgamento'].includes(p.level)) errors.push(`${p.id}: nível "${p.level}" inválido (teste | julgamento)`);
  return { errors, warnings };
}

/** Items that need a person: prova_extra edges and julgamento prohibitions without evidence. */
function needsHuman(specText, evidenceIds) {
  const have = new Set(evidenceIds || []);
  return [
    ...readEdges(specText).filter((e) => e.status === 'prova_extra' && !have.has(e.id)).map((e) => e.id),
    ...readProhibitions(specText).filter((p) => p.level === 'julgamento' && !have.has(p.id)).map((p) => p.id),
  ];
}

module.exports = { TAXONOMY, criteriaOf, probe, writeProbe, readEdges, readProhibitions, lintProbe, needsHuman };
