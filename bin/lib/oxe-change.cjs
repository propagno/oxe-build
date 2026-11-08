'use strict';

/**
 * OXE 1.20b — Ciclo de correção: "não ficou certo / completo / do jeito que eu queria".
 *
 * Toda pushback (usuário, UAT, revisão) vira um Change Request append-only em `.oxe/program/changes.ndjson`, com uma
 * classe que define a rota (estudo de 20.574 sessões: 38% violação de restrição, 27% leitura errada de intenção, 91%
 * exigiram correção explícita — e a falha tende a voltar na sessão seguinte se não virar artefato):
 *
 *   defect     código não cumpre a SPEC   → teste de aceite que reproduz (congelado, `resolves: [CR]`) + delta-plan
 *   spec_gap   a SPEC estava errada        → emenda versionada do A*; testes de versão anterior ficam stale
 *   constraint violou regra do projeto/dev → regra verificável (gatekeeper no verify) + teste
 *   new_scope  pedido novo                 → backlog/ROADMAP; não reabre a fase
 *
 * Um CR fecha só com evidência: o teste congelado que o declara em `resolves` passou no verify.
 */

const fs = require('fs');
const path = require('path');

const CLASSES = ['defect', 'spec_gap', 'constraint', 'new_scope'];
const REOPENING = new Set(['defect', 'spec_gap', 'constraint']);

function changesFile(programDir) {
  return path.join(programDir, 'changes.ndjson');
}

function readNdjson(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function appendNdjson(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

/** Estado atual de cada CR: o registro original + o último evento de status (append-only). */
function listChanges(programDir) {
  const byId = new Map();
  for (const entry of readNdjson(changesFile(programDir))) {
    if (entry.kind === 'cr') byId.set(entry.id, { ...entry });
    else if (entry.kind === 'status' && byId.has(entry.id)) Object.assign(byId.get(entry.id), { status: entry.status, resolution: entry.resolution || null, resolved_at: entry.at, resolved_by: entry.by || null });
  }
  return [...byId.values()];
}

/**
 * OXB-159: next CR id. Without a prefix, `CR-NN` over the plain ids only. With a prefix (a phase id — used in a forked
 * worktree, where the program tree keeps numbering its own CRs in parallel), `CR-<prefix>-<n>`, which cannot collide.
 */
function nextId(changes, prefix) {
  const p = prefix ? String(prefix).toUpperCase().replace(/[^A-Z0-9.]/g, '') : '';
  const re = p ? new RegExp(`^CR-${p.replace(/\./g, '\\.')}-(\\d+)$`) : /^CR-(\d+)$/;
  const max = changes.reduce((m, c) => { const hit = re.exec(String(c.id)); return hit ? Math.max(m, Number(hit[1])) : m; }, 0);
  return p ? `CR-${p}-${max + 1}` : `CR-${String(max + 1).padStart(2, '0')}`;
}

/** The phase prefix for new CR ids: set in a forked worktree (`program init --from`), or by `program.cr_id_prefix`. */
function idPrefixFor(program, phaseId) {
  if (program && program.cr_id_prefix) return String(program.cr_id_prefix);
  if (program && program.forked_from) return phaseId || 'X';
  return '';
}

/**
 * OXB-159: `program adopt` brings the CR records of the adopted worktree (CRs, status changes, signals) into this
 * program. A record already here (copied at the fork, or merged before) is skipped; a CR whose id is already taken
 * here by a DIFFERENT CR is renamed to `CR-<phase>-<n>` and its status records follow (`origin_id` keeps the trail).
 * @returns {{ merged: number, renamed: Record<string,string> }}
 */
function mergeChanges(ourDir, theirDir, options = {}) {
  const ours = readNdjson(changesFile(ourDir));
  const theirs = readNdjson(changesFile(theirDir));
  const key = (r) => `${r.kind}|${r.id || ''}|${r.at || ''}|${r.status || r.action || ''}`;
  const have = new Set();
  for (const r of ours) {
    have.add(key(r));
    if (r.origin_id) have.add(key({ ...r, id: r.origin_id }));
  }
  const crById = new Map(ours.filter((r) => r.kind === 'cr').map((r) => [r.id, r]));
  // a fork CR merged earlier under a new id: reuse the mapping
  const renamed = {};
  for (const r of ours) if (r.kind === 'cr' && r.origin_id && r.origin_root === options.from) renamed[r.origin_id] = r.id;
  const pending = [];
  let merged = 0;
  for (const r of theirs) {
    if (r.kind === 'program_edit' && r.action === 'program_fork') continue; // the fork's own bookkeeping
    if (have.has(key(r))) continue;
    let rec = { ...r };
    if (r.kind === 'cr') {
      const taken = crById.get(r.id);
      if (taken && !(taken.at === r.at && taken.summary === r.summary)) {
        const id = nextId([...crById.values(), ...pending], r.phase || options.phase || 'X');
        renamed[r.id] = id;
        rec = { ...r, id, origin_id: r.id, origin_root: options.from || null };
      }
      crById.set(rec.id, rec);
      pending.push(rec);
    } else if (r.id && renamed[r.id]) {
      rec = { ...r, id: renamed[r.id], origin_id: r.id };
    }
    if (Array.isArray(rec.resolves)) rec.resolves = rec.resolves.map((x) => renamed[x] || x);
    appendNdjson(changesFile(ourDir), rec);
    have.add(key(rec));
    merged += 1;
  }
  return { merged, renamed };
}

/** Rewrites CR ids in a copied JSON/markdown file (`resolves`, mentions) after a rename. */
function renameCrRefs(file, renamed) {
  const ids = Object.keys(renamed || {});
  if (!ids.length || !fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`\\b(${ids.map((i) => i.replace(/[.]/g, '\\.')).join('|')})\\b(?!-)`, 'g');
  const next = text.replace(re, (m) => renamed[m] || m);
  if (next !== text) fs.writeFileSync(file, next);
  return next !== text;
}

/** Tarefas ligadas aos critérios do CR (rastreabilidade A* → T). */
function impactedTasks(plan, criteria) {
  const set = new Set(criteria || []);
  return ((plan && plan.tasks) || []).filter((t) => (t.aceite || []).some((a) => set.has(a))).map((t) => t.id);
}

function routeFor(cr, impacted) {
  switch (cr.class) {
    case 'defect':
      return [
        `escrever um teste de aceite que REPRODUZA o defeito (deve falhar hoje) e declará-lo em PLAN.json acceptance_tests com "resolves": ["${cr.id}"]`,
        'oxe-cc plan lint --dry-verify  (o teste novo tem que estar vermelho pelo motivo certo)',
        `delta-plan só das tarefas impactadas: ${impacted.join(', ') || '(nova tarefa)'} — as concluídas e verdes ficam`,
        'oxe-cc runtime compile && oxe-cc runtime execute && oxe-cc runtime verify',
      ];
    case 'spec_gap':
      return [
        `emendar a SPEC: ${cr.criteria.map((a) => `${a} → v${cr.amend_to || 2}`).join(', ')} (motivo: ${cr.summary})`,
        cr.amendment === 'additive'
          ? `adicionar um teste de aceite novo com "version": ${cr.amend_to || 2} e "resolves": ["${cr.id}"]; a emenda é aditiva, os testes anteriores continuam valendo`
          : `reescrever o teste de aceite com "version": ${cr.amend_to || 2} e "resolves": ["${cr.id}"]; os de versão anterior ficam stale no plan lint`,
        `replan em modo merge das tarefas ${impacted.join(', ') || '(nenhuma ligada)'}`,
      ];
    case 'constraint':
      return [
        `registrar a regra em .oxe/config.json "policy_rules" (id, forbid regex, paths) — vira check no verify para não se repetir`,
        `teste de aceite com "resolves": ["${cr.id}"] que prova a regra cumprida`,
        `corrigir as tarefas ${impacted.join(', ') || '(onde a regra foi violada)'}`,
      ];
    default:
      return ['adicionar ao ROADMAP como fase nova ou item fora de escopo; a fase atual não é reaberta'];
  }
}

/**
 * Registra o CR e, quando a classe reabre e a fase está fechada, reabre a fase (regressão congelada continua valendo).
 * @returns {{ cr: object, reopened: boolean, route: string[], impacted: string[], program: object|null }}
 */
function recordChange(input) {
  const { programDir, program, plan } = input;
  const cls = String(input.class || '').trim();
  if (!CLASSES.includes(cls)) throw new Error(`classe inválida: use ${CLASSES.join(' | ')}`);
  const summary = String(input.summary || '').trim();
  if (summary.length < 8) throw new Error('descreva o problema (--summary) em uma frase');
  const by = String(input.by || '').trim() || 'usuário';
  const criteria = (Array.isArray(input.criteria) ? input.criteria : String(input.criteria || '').split(','))
    .map((c) => c.trim().toUpperCase()).filter((c) => /^(?:A\d+(?:\.\d+)?|G\d+)$/.test(c));
  if ((cls === 'defect' || cls === 'spec_gap') && criteria.length === 0) {
    throw new Error(`um CR ${cls} precisa apontar os critérios afetados (--criteria A4[,A5]); defeito sem critério é escopo novo`);
  }
  const existing = listChanges(programDir);
  const phaseId = input.phase || (program && program.active_phase) || null;
  const cr = {
    kind: 'cr',
    id: nextId(existing, idPrefixFor(program, phaseId)),
    class: cls,
    summary,
    criteria,
    phase: phaseId,
    by,
    at: new Date().toISOString(),
    status: 'open',
    amend_to: cls === 'spec_gap' ? Number(input.amendTo) || 2 : null,
    // OXB-062: an additive amendment only adds to the criterion (the earlier tests stay valid); a changing one
    // rewrites it (the earlier tests go stale).
    amendment: cls === 'spec_gap' ? (input.additive ? 'additive' : 'changing') : null,
    evidence: input.evidence || null,
    ...(input.gate ? { gate: String(input.gate) } : {}),
    // OXB-173: the tasks the CR is about (`--tasks`), linked whether or not they are reopened.
    ...(Array.isArray(input.tasks) && input.tasks.length ? { tasks: input.tasks } : {}),
    // OXB-058: the SPEC edit this CR made (`spec amend`): the row before and after, for the audit trail.
    ...(input.specEdit ? { spec_edit: input.specEdit } : {}),
  };
  appendNdjson(changesFile(programDir), cr);
  const impacted = impactedTasks(plan, criteria);

  let reopened = false;
  let nextProgram = program;
  if (program && phaseId && REOPENING.has(cls)) {
    const phase = program.phases.find((p) => p.id === phaseId);
    const busy = program.active_phase && program.active_phase !== phaseId
      && program.phases.some((p) => p.id === program.active_phase && p.status !== 'closed');
    if (phase && phase.status === 'closed' && !busy) {
      nextProgram = JSON.parse(JSON.stringify(program));
      const target = nextProgram.phases.find((p) => p.id === phaseId);
      target.history = [...(target.history || []), { closed_at: target.closed_at, closed_commit: target.closed_commit, reopened_at: cr.at, cr: cr.id }];
      target.status = 'planning';
      target.closed_at = null;
      target.reopened = (target.reopened || 0) + 1;
      nextProgram.active_phase = phaseId;
      nextProgram.updated_at = cr.at;
      reopened = true;
    }
  }
  return { cr, reopened, route: routeFor(cr, impacted), impacted, program: nextProgram };
}

function setChangeStatus(programDir, id, status, extra = {}) {
  appendNdjson(changesFile(programDir), { kind: 'status', id, status, at: new Date().toISOString(), ...extra });
}

/**
 * CRs abertos que a verificação resolveu: algum `check-accept-*` verde cujo teste declara `resolves: [CR]`,
 * ou, para um CR aberto por gate do projeto (`gate`), o próprio `gate-<id>` verde.
 * @returns {{ resolved: string[], open: object[] }}
 */
function reconcileChanges(programDir, phaseId, plan, checkResults, options = {}) {
  const passing = new Set((checkResults || []).filter((r) => r.status === 'pass').map((r) => r.check_id));
  // OXB-078: a gate CR whose gate is no longer declared can never go green — it closes as "gate removido do plano".
  const declaredGates = Array.isArray(options.declaredGates) ? new Set(options.declaredGates) : null;
  const resolvedBy = new Map();
  for (const a of (plan && plan.acceptanceTests) || []) {
    const key = a.id || a.criterion;
    if (!key || !passing.has(`check-accept-${String(key).toLowerCase()}`)) continue;
    for (const id of a.resolves || []) resolvedBy.set(id, key);
  }
  const resolved = [];
  for (const cr of listChanges(programDir)) {
    if (cr.status !== 'open' || (phaseId && cr.phase && cr.phase !== phaseId)) continue;
    if (resolvedBy.has(cr.id)) {
      setChangeStatus(programDir, cr.id, 'resolved', { resolution: `teste de aceite ${resolvedBy.get(cr.id)} verde`, by: 'verify' });
      resolved.push(cr.id);
    } else if (cr.gate && passing.has(`gate-${cr.gate}`)) {
      // 1.21: a CR raised by a red phase gate closes when that same gate goes green.
      setChangeStatus(programDir, cr.id, 'resolved', { resolution: `gate do projeto ${cr.gate} verde`, by: 'verify' });
      resolved.push(cr.id);
    } else if (cr.gate && declaredGates && !declaredGates.has(cr.gate)) {
      setChangeStatus(programDir, cr.id, 'withdrawn', { resolution: `gate ${cr.gate} removido do plano (phase_gates) — o CR não tem mais como ficar verde`, by: 'verify' });
      resolved.push(cr.id);
    }
  }
  const open = listChanges(programDir).filter((cr) => cr.status === 'open' && cr.class !== 'new_scope' && (!phaseId || !cr.phase || cr.phase === phaseId));
  return { resolved, open };
}

/**
 * OXB-062: per criterion, the version a new acceptance test must carry (`required`, the latest amendment) and the
 * version below which the earlier tests are stale (`staleBelow`, the latest CHANGING amendment; 1 when every
 * amendment was additive, so nothing goes stale).
 * @returns {Map<string, { required: number, staleBelow: number, additive: boolean }>}
 */
function amendmentRequirements(programDir) {
  const out = new Map();
  for (const cr of listChanges(programDir)) {
    if (cr.class !== 'spec_gap') continue;
    const version = cr.amend_to || 2;
    const additive = cr.amendment === 'additive';
    for (const a of cr.criteria || []) {
      const cur = out.get(a) || { required: 1, staleBelow: 1, additive: true, crs: [], last_at: null };
      cur.required = Math.max(cur.required, version);
      if (cr.id && !cur.crs.includes(cr.id)) cur.crs.push(cr.id);
      if (cr.at && (!cur.last_at || cr.at > cur.last_at)) cur.last_at = cr.at;
      if (!additive) cur.staleBelow = Math.max(cur.staleBelow, version);
      cur.additive = cur.staleBelow < cur.required;
      out.set(a, cur);
    }
  }
  return out;
}

/** Emendas de SPEC (spec_gap): versão mínima exigida por critério. */
function requiredVersions(programDir) {
  const out = new Map();
  for (const cr of listChanges(programDir)) {
    if (cr.class !== 'spec_gap') continue;
    for (const a of cr.criteria || []) out.set(a, Math.max(out.get(a) || 1, cr.amend_to || 2));
  }
  return out;
}

/**
 * Gatekeeper: regras do projeto (`config.json` policy_rules) verificadas nos arquivos tocados.
 * Regra: { id, forbid: "regex", paths?: "regex de caminho", message }.
 */
function checkPolicyRules(projectRoot, rules, files) {
  const violations = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    // Content rules only (OXB-118: action rules — kind command/path/env — are checked elsewhere; strings are advisory).
    if (!rule || !rule.id || !rule.forbid || (rule.kind && rule.kind !== 'content')) continue;
    let forbid;
    let scope = null;
    try {
      forbid = new RegExp(rule.forbid, 'm');
      scope = rule.paths ? new RegExp(rule.paths) : null;
    } catch {
      violations.push({ rule: rule.id, file: null, message: `regra inválida: ${rule.forbid}` });
      continue;
    }
    for (const file of files) {
      if (scope && !scope.test(file)) continue;
      let text = '';
      try {
        text = fs.readFileSync(path.resolve(projectRoot, file), 'utf8');
      } catch {
        continue;
      }
      const m = forbid.exec(text);
      if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        violations.push({ rule: rule.id, file: `${file}:${line}`, message: rule.message || rule.forbid });
      }
    }
  }
  return violations;
}

module.exports = { nextId, idPrefixFor, mergeChanges, renameCrRefs, CLASSES, appendNdjson, readNdjson, listChanges, recordChange, setChangeStatus, reconcileChanges, requiredVersions, amendmentRequirements, checkPolicyRules, impactedTasks, changesFile };
