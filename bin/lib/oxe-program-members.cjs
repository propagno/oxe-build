'use strict';

/**
 * OXB-135: a program that changes more than one repository. PROGRAM.json `members`: [{ name, path (relative to the
 * coordinator repo), remote?, branch (default main), order }]. A task declares `repo: "<member>"` (absent = the
 * coordinator) and changes ONE repository: its files are relative to that member, and a file written as
 * `<member>:<path>` must name the same member. The verify runs from the coordinator. The close goes through the members
 * in `order`: a member with uncommitted changes stops the close; each member's landed sha (HEAD of its branch) is
 * recorded in the phase and listed in the dossier (`members.md`).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

function list(program) { return [...((program && program.members) || [])].sort((a, b) => (a.order || 0) - (b.order || 0)); }

function add(root, program, input) {
  const name = String(input.name || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error('member add exige --name <nome> (letras, números, - e _)');
  if (!input.path) throw new Error('member add exige --path <caminho do repositório, relativo ao coordenador>');
  const abs = path.resolve(root, input.path);
  if (git(abs, ['rev-parse', '--git-dir']).status !== 0) throw new Error(`${input.path} não é um repositório git`);
  program.members = (program.members || []).filter((m) => m.name !== name);
  const member = { name, path: path.relative(root, abs).replace(/\\/g, '/') || '.', remote: input.remote || null, branch: input.branch || 'main', order: Number.isInteger(Number(input.order)) && input.order != null ? Number(input.order) : program.members.length + 1 };
  program.members.push(member);
  return member;
}

function remove(program, name) {
  const before = (program.members || []).length;
  program.members = (program.members || []).filter((m) => m.name !== name);
  if (program.members.length === before) throw new Error(`membro ${name} não existe`);
  return name;
}

/** Lint: unknown repo; a task touching two repositories. */
function lint(doc, program) {
  const errors = [];
  const names = new Set(list(program).map((m) => m.name));
  if (!names.size) return errors;
  for (const t of (doc && doc.tasks) || []) {
    if (!t) continue;
    if (t.repo && !names.has(t.repo)) errors.push(`${t.id}: repo "${t.repo}" não é membro do programa (oxe-cc program member list)`);
    const prefixed = new Set((t.files || []).map((f) => /^([a-z0-9][a-z0-9_-]*):(?!\/\/)/i.exec(String(f))).filter(Boolean).map((m) => m[1]).filter((n) => names.has(n)));
    const repos = new Set([...(t.repo ? [t.repo] : []), ...prefixed]);
    if (repos.size > 1 || (!t.repo && prefixed.size)) errors.push(`${t.id}: a tarefa toca mais de um repositório (${[...new Set([t.repo || '(coordenador)', ...prefixed])].join(', ')}) — divida em uma tarefa por repositório`);
  }
  return errors;
}

/** The close of the members, in order: dirty stops; returns the landed shas. */
function closeMembers(root, program) {
  const landed = [];
  for (const m of list(program)) {
    const abs = path.resolve(root, m.path);
    const st = git(abs, ['status', '--porcelain']);
    if (st.status !== 0) return { ok: false, landed, reason: `membro ${m.name}: ${m.path} não é legível como repositório` };
    if (String(st.stdout || '').trim()) return { ok: false, landed, reason: `membro ${m.name} (ordem ${m.order}) tem mudanças não commitadas — commite ou descarte antes do close` };
    const sha = git(abs, ['rev-parse', 'HEAD']).stdout.trim();
    const branch = git(abs, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    landed.push({ name: m.name, order: m.order, path: m.path, branch, sha });
  }
  return { ok: true, landed };
}

function renderMembers(phaseId, landed) {
  return [`# Membros do programa — ${phaseId}`, '', '| Ordem | Membro | Caminho | Branch | sha pousado |', '|---|---|---|---|---|', ...landed.map((l) => `| ${l.order} | ${l.name} | ${l.path} | ${l.branch} | ${l.sha.slice(0, 12)} |`), ''].join('\n');
}

module.exports = { list, add, remove, lint, closeMembers, renderMembers };
