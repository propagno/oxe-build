'use strict';

/**
 * OXB-099: `oxe-cc spec freeze --from <PR|sha> [--paths glob] [--criteria A12] [--cr CR-n]` imports the frozen tests a
 * PR (or commit) brings into the program: each test file it changed (filtered by --paths) becomes an
 * `acceptance_tests` entry of PLAN.json with its `proves` (the it/test titles in the file), its content hash and its
 * origin (`{ kind: pr|sha, ref, sha }`). The criterion comes from --criteria, else from an `A<n>` in the file's
 * describe/it titles. A file already frozen with different content is refused unless a CR is named (`--cr`), which is
 * recorded as `resolves`. A file not yet in the working tree is written from the ref.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TEST_RE = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const norm = (p) => String(p).replace(/\\/g, '/');
function globRe(g) { return new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?')}$`); }

function titlesOf(text) {
  return [...String(text).matchAll(/\b(?:it|test)(?:\.only|\.skip)?\s*\(\s*(['"`])((?:\\.|(?!\1).)+)\1/g)].map((m) => m[2]);
}
function criterionOf(text) { const m = /\b(?:describe|it|test)\s*\(\s*['"`][^'"`]*\b(A\d+)\b/.exec(String(text)); return m ? m[1] : null; }

/** The ref's commit sha and changed files: a PR via `gh`, a sha via git. spawn is injectable (tests). */
function resolveRef(root, from, spawn = spawnSync) {
  const pr = /^(?:#|pr[-:]?)?(\d+)$/i.exec(String(from));
  if (pr && !/^[0-9a-f]{7,40}$/i.test(String(from))) {
    const r = spawn('gh', ['pr', 'view', pr[1], '--json', 'headRefOid,files,url'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`gh pr view ${pr[1]} falhou: ${String(r.stderr || '').trim().slice(0, 200)}`);
    const j = JSON.parse(r.stdout);
    return { kind: 'pr', ref: `#${pr[1]}`, url: j.url || null, sha: j.headRefOid, files: (j.files || []).map((f) => norm(f.path)) };
  }
  const v = spawn('git', ['rev-parse', '--verify', `${from}^{commit}`], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (v.status !== 0) throw new Error(`${from}: não é um PR (#n) nem um commit deste repositório`);
  const s = v.stdout.trim();
  const d = spawn('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', s], { cwd: root, encoding: 'utf8', windowsHide: true });
  return { kind: 'sha', ref: s.slice(0, 12), sha: s, files: String(d.stdout || '').split(/\r?\n/).filter(Boolean).map(norm) };
}

function contentAt(root, ref, file, spawn = spawnSync) {
  const r = spawn('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function freeze(root, jsonPath, doc, options = {}) {
  const origin = resolveRef(root, options.from, options.spawn);
  const globs = options.paths ? String(options.paths).split(',').map((g) => globRe(g.trim())) : null;
  const files = origin.files.filter((f) => TEST_RE.test(f) && (!globs || globs.some((re) => re.test(f))));
  if (!files.length) throw new Error(`${origin.ref}: nenhum arquivo de teste${options.paths ? ` em ${options.paths}` : ''}`);
  doc.acceptance_tests = Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : [];
  const frozen = [];
  const refused = [];
  for (const f of files) {
    let text = contentAt(root, origin.sha, f, options.spawn);
    const abs = path.join(root, f);
    const local = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (text == null) text = local;
    if (text == null) { refused.push({ file: f, why: `o conteúdo de ${f} em ${origin.ref} não está disponível (faça fetch do PR)` }); continue; }
    const hash = sha(text);
    const existing = doc.acceptance_tests.find((a) => (a.files || []).map(norm).includes(f));
    if (existing && existing.sha256 && existing.sha256 !== hash && !options.cr) { refused.push({ file: f, why: `${f} já está congelado com outro conteúdo — mudar um teste congelado exige um CR (--cr CR-n)` }); continue; }
    const criterion = (options.criteria && String(options.criteria).split(',')[0].trim().toUpperCase()) || criterionOf(text) || (existing && existing.criterion) || null;
    if (!criterion) { refused.push({ file: f, why: `${f}: sem critério — informe --criteria A<n> ou cite o A<n> no describe` }); continue; }
    const proves = titlesOf(text);
    if (!proves.length) { refused.push({ file: f, why: `${f}: nenhum it/test com título — nada a provar` }); continue; }
    if (local == null || local !== text) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text); }
    const entry = {
      ...(existing || {}),
      criterion,
      files: [f],
      command: (existing && existing.command) || options.command || `npx vitest run ${f}`,
      proves,
      sha256: hash,
      origin: { kind: origin.kind, ref: origin.ref, sha: origin.sha, ...(origin.url ? { url: origin.url } : {}) },
      ...(options.cr ? { resolves: [...new Set([...((existing && existing.resolves) || []), String(options.cr).toUpperCase()])], version: ((existing && existing.version) || 1) + (existing ? 1 : 0) } : {}),
    };
    if (existing) Object.assign(existing, entry); else doc.acceptance_tests.push(entry);
    frozen.push({ file: f, criterion, proves: proves.length, origin: origin.ref });
  }
  if (frozen.length) fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
  return { origin, frozen, refused };
}

module.exports = { freeze, titlesOf, criterionOf, resolveRef };
