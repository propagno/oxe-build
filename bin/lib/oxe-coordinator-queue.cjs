'use strict';

/**
 * OXB-103: coordinator mode. From the PROGRAM DAG, the next preparation item of each role goes to a queue file the
 * roles read (`.oxe/program/QUEUE.md` and `queue.json`):
 *   - open CRs → the roles of the tasks they touch (else the tech lead), ordered by severity;
 *   - the next phases (pending, every dependency closed or active) → for each criterion without a frozen acceptance
 *     test, "write the frozen test of A<n>" for the test role; a phase without a plan → "plan Fk" for the planner;
 *   - the active phase → its open tasks for their roles (the execute is the runtime's; this only orders the prep).
 * Roles come from PLAN.json task `roles` (plan merge) and config `program.roles` ({ tests: "qa", planner: "tl", … }).
 */

const SEV = { critical: 0, high: 1, medium: 2, low: 3, unrated: 4 };

const rolesOfTask = (t) => (t && Array.isArray(t.roles) && t.roles.length ? t.roles : t && t.role ? [String(t.role)] : []);
const critMatch = (a, b) => {
  const x = String(a || '').trim().toUpperCase();
  const y = String(b || '').trim().toUpperCase();
  return Boolean(x && y) && (x === y || x.startsWith(`${y}.`) || y.startsWith(`${x}.`));
};

function readyPhases(program) {
  const phases = (program && program.phases) || [];
  const status = new Map(phases.map((p) => [p.id, p.status]));
  return phases.filter((p, i) => p && p.status === 'pending' && (Array.isArray(p.depends_on) ? p.depends_on : Array.isArray(p.dependsOn) ? p.dependsOn : phases.slice(0, i).map((q) => q.id)).every((d) => ['closed', 'done', 'planning', 'executing', 'verifying'].includes(status.get(d))));
}

function build(ctx = {}) {
  const roles = { tests: 'qa', planner: 'tech lead', lead: 'tech lead', ...((ctx.config && ctx.config.program && ctx.config.program.roles) || {}) };
  const tasks = ((ctx.doc && ctx.doc.tasks) || []).filter(Boolean);
  const rolesOfCriterion = (c) => [...new Set(tasks.filter((t) => (t.acceptance || []).some((tc) => critMatch(tc, c))).flatMap(rolesOfTask))];
  const items = [];
  const push = (role, item) => items.push({ role, ...item });
  const sevRank = (s) => SEV[String(s || '').toLowerCase()] ?? 4;
  for (const cr of (ctx.changes || []).filter((c) => c && c.status === 'open').sort((a, b) => sevRank(a.severity) - sevRank(b.severity))) {
    const rs = [...new Set([...(cr.tasks || []).flatMap((id) => rolesOfTask(tasks.find((t) => t.id === id))), ...(cr.criteria || []).flatMap(rolesOfCriterion)])];
    for (const r of rs.length ? rs : [roles.lead]) push(r, { kind: 'cr', ref: cr.id, phase: cr.phase || null, text: `${cr.id} (${cr.class}${cr.severity ? `, ${cr.severity}` : ''}): ${String(cr.summary || '').slice(0, 140)}` });
  }
  const accept = (ctx.doc && (Array.isArray(ctx.doc.acceptance_tests) ? ctx.doc.acceptance_tests : Array.isArray(ctx.doc.acceptanceTests) ? ctx.doc.acceptanceTests : [])) || [];
  const frozen = new Set(accept.map((a) => a && a.criterion).filter(Boolean));
  for (const f of ctx.frozenByPhase || []) if (f) frozen.add(f);
  const isFrozen = (c) => frozen.has(c) || (String(c).includes('.') && frozen.has(String(c).split('.')[0]));
  for (const p of readyPhases(ctx.program)) {
    if (!p.plan_ref) push(roles.planner, { kind: 'plan', ref: p.id, phase: p.id, text: `planejar ${p.id} — ${p.title || ''} (critérios ${(p.acceptance || []).join(', ') || '—'})` });
    for (const c of (p.acceptance || []).filter((x) => !isFrozen(x))) push(roles.tests, { kind: 'frozen_test', ref: c, phase: p.id, text: `escrever o teste congelado de ${c} (${p.id}) antes do plano` });
  }
  const active = ctx.program && ctx.program.active_phase;
  for (const t of tasks.filter((x) => !(x.done === true || x.status === 'done') && !x.superseded && !x.merged_into)) {
    for (const r of rolesOfTask(t)) push(r, { kind: 'task', ref: t.id, phase: active || null, text: `${t.id} — ${t.title} (onda ${t.wave})` });
  }
  const byRole = {};
  for (const it of items) (byRole[it.role] = byRole[it.role] || []).push(it);
  return { generated_at: new Date().toISOString(), active_phase: active || null, roles: byRole, next: Object.fromEntries(Object.entries(byRole).map(([r, xs]) => [r, xs[0]])) };
}

function render(q) {
  const lines = ['# QUEUE — próximo item de cada papel', '', `> Gerado por \`oxe-cc program queue\` a partir do DAG do PROGRAM (${q.generated_at}). Cada papel pega o primeiro item da sua lista.`, ''];
  for (const [role, xs] of Object.entries(q.roles)) {
    lines.push(`## ${role}`, '');
    xs.forEach((x, i) => lines.push(`${i === 0 ? '- **→**' : '-'} [${x.kind}] ${x.text}`));
    lines.push('');
  }
  if (!Object.keys(q.roles).length) lines.push('_Nada na fila._', '');
  return lines.join('\n');
}

module.exports = { build, render, readyPhases };
