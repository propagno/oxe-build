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
  const prev = (program.members || []).find((m) => m && m.name === name);
  program.members = (program.members || []).filter((m) => m && m.name !== name);
  const maxOrder = program.members.reduce((acc, m) => Math.max(acc, Number(m.order) || 0), 0);
  const defaultOrder = prev && Number.isInteger(Number(prev.order)) ? Number(prev.order) : maxOrder + 1;
  const member = {
    name,
    path: path.relative(root, abs).replace(/\\/g, '/') || '.',
    remote: input.remote !== undefined ? input.remote || null : (prev && prev.remote) || null,
    branch: input.branch || (prev && prev.branch) || 'main',
    order: input.order != null && Number.isInteger(Number(input.order)) ? Number(input.order) : defaultOrder,
  };
  program.members.push(member);
  return member;
}

function remove(program, name) {
  const before = (program.members || []).length;
  program.members = (program.members || []).filter((m) => m.name !== name);
  if (program.members.length === before) throw new Error(`membro ${name} não existe`);
  return name;
}

const fileStr = (f) => String(typeof f === 'string' ? f : (f && f.path) || '');

/** Lint: unknown repo; a task touching two repositories. */
function lint(doc, program) {
  const errors = [];
  const names = new Set(list(program).map((m) => m.name));
  if (!names.size) return errors;
  for (const t of (doc && doc.tasks) || []) {
    if (!t || t.superseded || t.merged_into) continue;
    if (t.repo && !names.has(t.repo)) errors.push(`${t.id}: repo "${t.repo}" não é membro do programa (oxe-cc program member list)`);
    const prefixed = new Set(
      (t.files || [])
        .map(fileStr)
        .filter((s) => !/^[A-Za-z]:[\\/]/.test(s))
        .map((s) => /^([a-z0-9][a-z0-9_-]*):(?!\/\/)/i.exec(s))
        .filter(Boolean)
        .map((m) => m[1])
        .filter((n) => names.has(n)),
    );
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
    const headRes = git(abs, ['rev-parse', '--verify', 'HEAD']);
    const sha = String(headRes.stdout || '').trim();
    if (headRes.status !== 0 || !sha) return { ok: false, landed, reason: `membro ${m.name} (ordem ${m.order}) ainda não tem commit em HEAD` };
    const rawBranch = String(git(abs, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim();
    const branch = rawBranch === 'HEAD' || !rawBranch ? 'detached' : rawBranch;
    landed.push({ name: m.name, order: m.order, path: m.path, branch, sha });
  }
  return { ok: true, landed };
}

const escCell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|');

function renderMembers(phaseId, landed) {
  return [`# Membros do programa — ${phaseId}`, '', '| Ordem | Membro | Caminho | Branch | sha pousado |', '|---|---|---|---|---|', ...(landed || []).map((l) => `| ${escCell(l.order)} | ${escCell(l.name)} | ${escCell(l.path)} | ${escCell(l.branch)} | ${escCell(String(l.sha || '').slice(0, 12))} |`), ''].join('\n');
}

module.exports = { list, add, remove, lint, closeMembers, renderMembers };
