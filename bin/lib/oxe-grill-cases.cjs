'use strict';

/**
 * Executable disambiguation. A grill question may carry cases: one scenario and, for each option, what is observed.
 *   --case "aprovador lista sem parâmetros => vê a fila | não vê nada"
 *   --need "aprovador lista sem parâmetros => vê a fila"     (what the material says that role must get)
 * The recommended option must satisfy every need, so it is checked, not only argued. The answer turns each case into
 * an example with an id that names the option chosen (Q-4.1b): the SPEC cites it and the frozen test of that criterion
 * carries it. A changed answer changes the id, so a SPEC or a test left on the old reading no longer matches.
 */

const letter = (i) => String.fromCharCode(97 + i);
const same = (a, b) => String(a).trim().replace(/\s+/g, ' ').toLowerCase() === String(b).trim().replace(/\s+/g, ' ').toLowerCase();

/** "scenario => right side" */
function split(raw, flag) {
  const text = String(raw == null ? '' : raw);
  const at = text.indexOf('=>');
  const left = at < 0 ? '' : text.slice(0, at).trim();
  const right = at < 0 ? '' : text.slice(at + 2).trim();
  if (!left || !right) throw new Error(`${flag} "${text}": use "<cenário> => <o que se observa>"`);
  return { left, right };
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * @returns {Array<{ scenario: string, outcomes: string[], need?: string }>}
 * @throws when the cases do not tell the options apart or the recommended option fails a need
 */
function build({ options, recommended, cases, needs }) {
  const rawCases = asList(cases);
  const rawNeeds = asList(needs);
  if (!rawCases.length) {
    if (rawNeeds.length) throw new Error('--need exige o --case do mesmo cenário');
    return [];
  }
  if (options.length < 2) throw new Error('--case exige ao menos duas opções (--options "A | B")');
  const rec = options.findIndex((o) => same(o, recommended));
  if (rec < 0) throw new Error('com --case, a recomendada é uma das opções (--recommended igual ao texto da opção)');
  const out = rawCases.map((raw) => {
    const { left, right } = split(raw, '--case');
    const outcomes = right.split(/\s+\|\s+/).map((s) => s.trim());
    if (outcomes.length !== options.length || outcomes.some((s) => !s)) {
      throw new Error(`--case "${left}": ${outcomes.length} resultado(s) para ${options.length} opções; um por opção, na mesma ordem, separados por " | "`);
    }
    return { scenario: left, outcomes };
  });
  for (let i = 0; i < options.length; i += 1) {
    for (let j = i + 1; j < options.length; j += 1) {
      if (out.every((c) => same(c.outcomes[i], c.outcomes[j]))) {
        throw new Error(`nenhum caso separa ${letter(i)}) de ${letter(j)}): se nada observável muda, não é pergunta para o usuário; se muda, escreva o caso que mostra a diferença`);
      }
    }
  }
  for (const raw of rawNeeds) {
    const { left, right } = split(raw, '--need');
    const c = out.find((x) => same(x.scenario, left));
    if (!c) throw new Error(`--need "${left}": não há --case com esse cenário`);
    if (!c.outcomes.some((o) => same(o, right))) throw new Error(`--need "${left}": "${right}" não é o resultado de nenhuma opção`);
    if (!same(c.outcomes[rec], right)) {
      const fits = options.map((_, i) => i).filter((i) => same(c.outcomes[i], right)).map((i) => `${letter(i)})`);
      throw new Error(`a recomendada ${letter(rec)}) falha no que o papel precisa: em "${left}" ela dá "${c.outcomes[rec]}", e o necessário é "${right}" (atendem: ${fits.join(', ')}). Troque a recomendada.`);
    }
    c.need = right;
  }
  return out;
}

/** The block the user reads: each case, with what each option does. */
function render(q) {
  const lines = [];
  for (const c of q.cases || []) {
    lines.push(`    Caso: ${c.scenario}`);
    c.outcomes.forEach((o, i) => lines.push(`      ${letter(i)}) ${o}${c.need && same(o, c.need) ? '  (atende ao que o papel precisa)' : ''}`));
  }
  return lines;
}

/** The examples the answer froze; null when the question has cases and the answer is none of its options. */
function examplesOf(q) {
  if (!q.cases || !q.cases.length || q.status !== 'decided') return [];
  const picked = q.options.findIndex((o) => same(o, q.answer));
  if (picked < 0) return null;
  return q.cases.map((c, i) => ({ id: `${q.id}.${i + 1}${letter(picked)}`, question: q.id, scenario: c.scenario, expect: c.outcomes[picked] }));
}

function decided(questions) {
  const examples = [];
  const unresolved = [];
  for (const q of questions || []) {
    const found = examplesOf(q);
    if (found) examples.push(...found);
    else unresolved.push(q.id);
  }
  return { examples, unresolved };
}

const idsIn = (text) => new Set(String(text || '').match(/\bQ-\d+\.\d+[a-z]\b/g) || []);

/** spec check: every example is cited by a criterion, and no criterion cites a reading that was not chosen. */
function specFindings({ questions, criteria }) {
  const { examples, unresolved } = decided(questions);
  const valid = new Set(examples.map((e) => e.id));
  // Only ids of questions that carry cases are judged: anything else that looks alike belongs to the project.
  const withCases = new Set((questions || []).filter((q) => q.cases && q.cases.length).map((q) => q.id));
  const cited = new Set();
  const errors = [];
  for (const c of criteria || []) {
    for (const id of idsIn(`${c.text} ${c.verify || ''}`)) {
      cited.add(id);
      if (!valid.has(id) && withCases.has(id.split('.')[0])) errors.push(`${c.id}: cita ${id}, que não é a leitura escolhida no grill (oxe-cc grill status lista os exemplos válidos)`);
    }
  }
  for (const e of examples) {
    if (!cited.has(e.id)) errors.push(`${e.id}: exemplo decidido no grill sem critério que o cite — "${e.scenario} => ${e.expect}"`);
  }
  const warnings = unresolved.map((id) => `${id}: a resposta não é nenhuma das opções, então os casos dela não viraram exemplo — pergunte de novo com os casos da resposta nova`);
  return { errors, warnings };
}

/** plan lint: the frozen test of a criterion carries the examples that criterion cites. */
function planFindings({ questions, criteria, doc, readFile }) {
  const { examples } = decided(questions);
  if (!examples.length || !doc) return [];
  const up = (s) => String(s || '').toUpperCase();
  const tests = Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests.filter(Boolean) : [];
  const inPlan = new Set([
    ...(doc.tasks || []).flatMap((t) => (t && t.acceptance) || []).map(up),
    ...tests.map((a) => up(a.criterion)),
  ]);
  const byId = new Map(examples.map((e) => [e.id, e]));
  const errors = [];
  for (const c of criteria || []) {
    if (!inPlan.has(c.id)) continue;
    const wanted = [...idsIn(`${c.text} ${c.verify || ''}`)].filter((id) => byId.has(id));
    if (!wanted.length) continue;
    const files = tests.filter((a) => up(a.criterion) === c.id).flatMap((a) => a.files || []).map((f) => (typeof f === 'string' ? f : f.path));
    const present = idsIn(files.map((f) => readFile(f) || '').join('\n'));
    for (const id of wanted) {
      const e = byId.get(id);
      if (!present.has(id)) errors.push(`${c.id}: nenhum teste congelado dele traz ${id} — escreva o caso "${e.scenario} => ${e.expect}" com ${id} no título`);
    }
  }
  return errors;
}

module.exports = { build, render, examplesOf, decided, specFindings, planFindings };
