'use strict';

/**
 * 1.21.2 — `oxe-cc trace`: the traceability graph of the artifacts. Each reference is written ONCE, on the child
 * side (a task names its criteria, a decision its criteria and stories, a PRD story its criteria and card, a refined
 * card's CA its A, an ALM bug its CR); this module derives the reverse links and lists the orphans — every loose end
 * with the command that ties it. The acceptance criterion (A-n) is the axis: a story reaches its decisions, tests,
 * tasks and evidence through the criteria they share.
 *
 * Pure over a loaded snapshot (see runtimeTrace in oxe-operational for the loading).
 */

const ANCHOR_RE = /^[AG]\d+(\.\d+)?$/;

/**
 * @param {{ stories: Array<{id, criteria: string[], requirements: string[], cards?: string[]}>,
 *   criteria: Array<{id, text, risk}>, requirements: Array<{id, version, criteria: string[]}>,
 *   decisions: Array<{id, title, status, criteria?: string[], stories?: string[], source?}>,
 *   rfcs: Array<{id, phase, status, decision}>, tasks: Array<{id, acceptance?: string[], aceite?: string[], decisions?: string[], done?}>,
 *   tests: Array<{id?, criterion, files, resolves?: string[]}>, changes: Array<{id, class, status, criteria?: string[], tasks?: string[]}>,
 *   links: Map<string, {ref, key, kind, cr?, origin?}>, cardSpecs: Map<string, Array<{id, spec_id}>>,
 *   checks: Array<{check_id, acceptance_ref, status}>, phase: string|null, almConfigured: boolean, storiesSource: string,
 *   cardKeysOf: (text: string) => string[] }} s
 */
function build(s) {
  const by = (arr, key = 'id') => new Map(arr.map((x) => [x[key], x]));
  const A = by(s.criteria);
  const US = by(s.stories);
  const D = by(s.decisions);
  const activeD = s.decisions.filter((d) => !d.status || d.status === 'active');
  const taskRef = (t) => (s.phase ? `${s.phase}-${t.id}` : t.id);
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };

  // derived reverse indexes
  const storiesOfA = new Map();
  for (const u of s.stories) for (const a of u.criteria || []) add(storiesOfA, a, u.id);
  const decisionsOfA = new Map();
  const decisionsOfUS = new Map();
  for (const d of activeD) {
    for (const a of d.criteria || []) add(decisionsOfA, a, d.id);
    for (const u of d.stories || []) add(decisionsOfUS, u, d.id);
  }
  for (const u of s.stories) for (const a of u.criteria || []) for (const d of decisionsOfA.get(a) || []) add(decisionsOfUS, u.id, d);
  const testsOfA = new Map();
  for (const t of s.tests) if (t.criterion) add(testsOfA, t.criterion, (t.files || [])[0] || t.id || t.criterion);
  const tasksOfA = new Map();
  for (const t of s.tasks) for (const a of [...(t.acceptance || []), ...(t.aceite || [])]) add(tasksOfA, a, t.id);
  const cardsOfA = new Map();
  for (const a of s.criteria) for (const k of s.cardKeysOf(a.text)) add(cardsOfA, a.id, k);
  for (const [key, cas] of s.cardSpecs) for (const c of cas) if (c.spec_id) add(cardsOfA, c.spec_id, key);
  const changesOfA = new Map();
  for (const c of s.changes) for (const a of c.criteria || []) add(changesOfA, a, c.id);
  const evidence = new Map();
  for (const r of s.checks || []) {
    if (!r.acceptance_ref) continue;
    const prev = evidence.get(r.acceptance_ref);
    // a red anywhere wins over green; a skip only when nothing ran
    const rank = { fail: 3, error: 3, pass: 2, skip: 1 };
    if (!prev || (rank[r.status] || 0) > (rank[prev] || 0)) evidence.set(r.acceptance_ref, r.status);
  }
  const cardOf = (ref) => (s.links.get(ref) ? s.links.get(ref).key : null);

  // orphans: every loose end, with the command that ties it
  const orphans = [];
  const push = (severity, kind, id, why, fix) => orphans.push({ severity, kind, id, why, fix });
  for (const u of s.stories) {
    if (!(u.criteria || []).length) push('error', 'story', u.id, 'história sem critério: nada prova que foi entregue', `ligue a US a um A* no PRD (coluna Critérios)`);
    for (const a of u.criteria || []) if (!A.has(a)) push('error', 'story', u.id, `cita ${a}, que não existe na SPEC`, `oxe-cc spec add criterion ${a} … ou corrija o PRD`);
    if (s.almConfigured && !cardOf(u.id) && !(u.cards || []).length) push('warning', 'story', u.id, 'história sem card no ALM', s.storiesSource === 'alm' ? `ponha a chave do card na linha da US no PRD, ou oxe-cc alm link ${u.id} <chave>` : 'oxe-cc alm push --stories-only');
  }
  const v1 = new Set(s.requirements.filter((r) => !r.version || /^v1/.test(r.version)).flatMap((r) => r.criteria || []));
  for (const a of s.criteria) {
    if (!/^A\d/.test(a.id)) continue;
    if (s.stories.length && !storiesOfA.has(a.id)) push('warning', 'criterion', a.id, 'critério sem história no PRD', 'ligue-o a uma US (coluna Critérios do PRD)');
    // a subcriterion (A19.1) of a phase criterion and the global G* are the phase's too (OXB-037)
    const inThisPhase = !(Array.isArray(s.phaseCriteria) && s.phaseCriteria.length) || require('./oxe-criteria-ids.cjs').inPhase(a.id, s.phaseCriteria);
    if ((s.tasks.length || s.tests.length) && inThisPhase && v1.has(a.id) && !testsOfA.has(a.id) && !tasksOfA.has(a.id)) push('warning', 'criterion', a.id, 'critério v1 sem teste de aceite nem tarefa no plano', '/oxe-plan: um teste de aceite com "criterion": "' + a.id + '"');
  }
  for (const d of activeD) {
    if (!(d.criteria || []).length && !(d.stories || []).length) push('warning', 'decision', d.id, 'decisão sem critério nem história: nenhum card chega a ela', `oxe-cc decision add --supersedes ${d.id} --criteria A… (ou corrija a origem: ${d.source || 'manual'})`);
    for (const a of d.criteria || []) if (!A.has(a)) push('warning', 'decision', d.id, `cita ${a}, que não existe na SPEC`, `oxe-cc decision status ${d.id} retired --reason "…" ou corrija a SPEC`);
  }
  for (const r of s.rfcs) if (r.status === 'accepted' && r.decision && !D.has(r.decision)) push('error', 'rfc', r.id, `aceito como ${r.decision}, que não está no registro de decisões`, 'oxe-cc decision list; aceite de novo pelo oxe-cc rfc accept');
  for (const [key, cas] of s.cardSpecs) {
    for (const c of cas) {
      if (c.spec_id && !A.has(c.spec_id)) push('error', 'card', key, `${c.id} aponta para ${c.spec_id}, que não existe na SPEC`, `oxe-cc alm refine import ${key} --by <papel>`);
      if (!c.spec_id && s.criteria.length) push('warning', 'card', key, `${c.id} sem o critério da SPEC`, `oxe-cc alm refine import ${key} --by <papel>`);
    }
  }
  for (const a of s.criteria) {
    for (const k of s.cardKeysOf(a.text)) {
      const cas = s.cardSpecs.get(k);
      if (cas && !cas.some((c) => c.spec_id === a.id)) push('warning', 'criterion', a.id, `cita ${k}, mas nenhum CA do card refinado aponta para ${a.id}`, `escreva "(${a.id})" no CA correspondente de .oxe/alm/specs/${k}.md`);
    }
  }
  const bugs = [...s.links.values()].filter((l) => l.kind === 'bug');
  if (s.almConfigured) {
    for (const c of s.changes.filter((x) => x.class === 'defect' && x.status === 'open')) {
      if (!bugs.some((b) => b.cr === c.id)) push('warning', 'change', c.id, 'CR de defeito sem bug no ALM', `oxe-cc alm defect --title "…" --cr ${c.id} --origin <US-n|Fn-Tn>`);
    }
    const known = s.knownFailureItems || new Set();
    for (const b of bugs) {
      if (b.cr) continue;
      // a known CI failure (ship known-failure, item = this card) is a flake tracked by its own fix, not a defect of
      // this phase's criteria: no CR asked (OxeSpace 14/11, FLAKY-F6-FOCUS / OXE-135)
      if (known.has(String(b.key).toUpperCase()) || known.has(String(b.ref).toUpperCase())) continue;
      push('warning', 'card', b.key, `bug ${b.ref} sem CR: o defeito não reabre nada no OXE`, `oxe-cc runtime feedback --class defect --summary "${b.ref}" --criteria A… e depois oxe-cc alm link ${b.ref} ${b.key} --cr CR-n --apply (ou alm defect --cr); um flake anterior à fase: oxe-cc ship known-failure add "<teste>" --item ${b.key}`);
    }
  }
  for (const t of s.tasks) for (const d of t.decisions || []) if (D.has(d) && D.get(d).status && D.get(d).status !== 'active') push('warning', 'task', t.id, `cita ${d}, que está ${D.get(d).status}`, 'atualize o PLAN.json para a decisão vigente');

  // the index the projections read (card "Documentos", ADR "Histórias", PRD)
  const story = (u) => ({
    id: u.id,
    card: cardOf(u.id) || (u.cards || [])[0] || null,
    criteria: (u.criteria || []).map((a) => ({ id: a, evidence: evidence.get(a) || null, tests: [...(testsOfA.get(a) || [])], changes: [...(changesOfA.get(a) || [])] })),
    decisions: [...(decisionsOfUS.get(u.id) || [])].map((id) => ({ id, title: D.get(id) ? D.get(id).title : null })),
  });
  const criterion = (a) => ({ id: a.id, stories: [...(storiesOfA.get(a.id) || [])], cards: [...(cardsOfA.get(a.id) || [])], decisions: [...(decisionsOfA.get(a.id) || [])], tests: [...(testsOfA.get(a.id) || [])], tasks: [...(tasksOfA.get(a.id) || [])], changes: [...(changesOfA.get(a.id) || [])], evidence: evidence.get(a.id) || null });
  const tasks = s.tasks.map((t) => ({ id: t.id, ref: taskRef(t), card: cardOf(taskRef(t)), criteria: [...(t.acceptance || []), ...(t.aceite || [])], decisions: t.decisions || [] }));
  return {
    counts: { stories: s.stories.length, criteria: s.criteria.length, decisions: activeD.length, rfcs: s.rfcs.length, tasks: s.tasks.length, tests: s.tests.length, changes: s.changes.length, cards: s.links.size + s.cardSpecs.size },
    orphans,
    errors: orphans.filter((o) => o.severity === 'error').length,
    stories: s.stories.map(story),
    criteria: s.criteria.filter((a) => ANCHOR_RE.test(a.id)).map(criterion),
    tasks,
    decision_stories: Object.fromEntries(activeD.map((d) => [d.id, [...new Set([...(d.stories || []), ...[...(d.criteria || [])].flatMap((a) => [...(storiesOfA.get(a) || [])])])]])),
  };
}

/** The "Documentos (OXE)" comment of a card: its story, criteria with evidence, decisions (ADR links) and open CRs. */
function cardDocs(entry, ctx) {
  const L = ['Documentos (OXE)', ''];
  const link = (rel) => (ctx.docsBase ? `${ctx.docsBase}/${rel}` : rel);
  if (entry.story) L.push(`História: ${entry.story} — ${link('product/PRD.md')}`);
  if (entry.criteria && entry.criteria.length) {
    L.push('', 'Critérios:');
    for (const c of entry.criteria) {
      const ev = c.evidence === 'pass' ? '✓ verde' : c.evidence === 'fail' || c.evidence === 'error' ? '✗ vermelho' : c.evidence === 'skip' ? '· não verificado' : '· sem execução';
      L.push(`- ${c.id} ${ev}${c.tests && c.tests.length ? ` · teste ${c.tests[0]}` : ''}${c.changes && c.changes.length ? ` · CR ${c.changes.join(', ')}` : ''}`);
    }
  }
  if (entry.decisions && entry.decisions.length) {
    L.push('', 'Decisões:');
    for (const d of entry.decisions) L.push(`- ${d.id}${d.title ? ` — ${d.title}` : ''}${ctx.adrFile && ctx.adrFile(d.id) ? ` — ${link(`adr/${ctx.adrFile(d.id)}`)}` : ''}`);
  }
  if (entry.rfcs && entry.rfcs.length) L.push('', `RFC: ${entry.rfcs.map((r) => `${r.id} (${r.status})`).join(', ')}`);
  L.push('', `gerado por oxe-cc trace publish · ${ctx.at || new Date().toISOString().slice(0, 16)}`);
  return L.join('\n');
}

module.exports = { build, cardDocs };
