'use strict';

/**
 * 1.21.2 — the business and technical documents, versioned with the code. `.oxe/` is usually gitignored; these are
 * copied into the repository (default `docs/`, config `docs_publish: { dir }`, `docs_publish: false` turns it off):
 *
 *   docs/product/PRD.md                     ← .oxe/PRD.md (+ the ALM key of each story, when there is one)
 *   docs/rfc/RFC-….md + docs/rfc/README.md  ← .oxe/rfc/*.md
 *   docs/adr/…                              ← the decision ledger (oxe-adr; its own `adr` config)
 *   docs/architecture/SYSTEM-DESIGN.md      ← .oxe/SYSTEM-DESIGN.md
 *
 * It runs on `oxe-cc docs publish`, and at the phase close only when `docs_publish` is configured (an object) and the
 * branch has no open PR — the close never adds files nobody asked for to a commit.
 */

const fs = require('fs');
const path = require('path');

function docsDir(config) {
  const c = config && config.docs_publish;
  if (c === false) return null;
  if (c && typeof c === 'object' && c.enabled === false) return null;
  return c && typeof c === 'object' && typeof c.dir === 'string' && c.dir.trim() ? c.dir.trim() : 'docs';
}

const HEADER = (src) => `<!-- Publicado pelo OXE a partir de ${src} — edite a fonte e rode oxe-cc docs publish (esta cópia é sobrescrita) -->\n\n`;

function guard(projectRoot, dir) {
  const rel = path.relative(path.join(projectRoot, '.oxe'), dir);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('a pasta de publicação não pode ficar dentro de .oxe/ (ela existe para ser versionada)');
  if (path.relative(path.resolve(projectRoot), dir) === '') throw new Error('a pasta de publicação não pode ser a raiz do projeto (ex.: docs)');
}

/**
 * @param {{ prdFile?: string, almLinks?: Map<string, {key: string, url?: string}>, rfcs?: object[], decisions?: object[], adrDir?: string|null, designFile?: string, glossaryFile?: string }} src
 * @returns {{ dir: string, written: string[], unchanged: number, skipped: string[] }}
 */
function publish(projectRoot, dirRel, src = {}) {
  const dir = path.resolve(projectRoot, dirRel);
  guard(projectRoot, dir);
  const written = [];
  const skipped = [];
  let unchanged = 0;
  const put = (rel, content) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === content) { unchanged += 1; return; }
    fs.writeFileSync(p, content, 'utf8');
    written.push(path.relative(projectRoot, p).replace(/\\/g, '/'));
  };
  // PRD (+ ALM keys of the stories)
  if (src.prdFile && fs.existsSync(src.prdFile)) {
    let text = fs.readFileSync(src.prdFile, 'utf8');
    const keys = src.almLinks ? [...src.almLinks.values()].filter((l) => /^US-\d+$/.test(l.ref)) : [];
    if (keys.length && !/^##\s+Itens no ALM\b/im.test(text)) {
      text = `${text.trimEnd()}\n\n## Itens no ALM\n\n| História | Item |\n|----------|------|\n${keys.map((l) => `| ${l.ref} | ${l.url ? `[${l.key}](${l.url})` : l.key} |`).join('\n')}\n`;
    }
    put('product/PRD.md', HEADER('.oxe/PRD.md') + text);
  } else skipped.push('PRD (sem .oxe/PRD.md)');
  // RFCs + index
  const rfcs = (src.rfcs || []).filter((r) => r && r.file && fs.existsSync(r.file));
  if (rfcs.length) {
    for (const r of rfcs) put(`rfc/${path.basename(r.file)}`, HEADER(`.oxe/rfc/${path.basename(r.file)}`) + fs.readFileSync(r.file, 'utf8'));
    const pt = { draft: 'rascunho', accepted: 'aceito', rejected: 'recusado', superseded: 'substituído' };
    put('rfc/README.md', ['# RFCs', '', 'Propostas técnicas escritas antes do plano de cada fase. Fonte: `.oxe/rfc/` (`oxe-cc rfc new | accept | reject`).', '', '| RFC | Título | Fase | Status | Decisão |', '|-----|--------|------|--------|---------|', ...rfcs.map((r) => `| [${r.id}](${path.basename(r.file)}) | ${String(r.title || '').replace(/\|/g, '\\|')} | ${r.phase || '—'} | ${pt[r.status] || r.status} | ${r.decision ? `[${r.decision}](../adr/)` : '—'} |`), ''].join('\n'));
  } else skipped.push('RFC (nenhuma em .oxe/rfc/)');
  // ADRs (own config: adr)
  if (src.adrDir && Array.isArray(src.decisions) && src.decisions.some((d) => d && !/^D-SPIKE-/.test(String(d.id)))) {
    const r = require('./oxe-adr.cjs').publish(projectRoot, src.adrDir, src.decisions);
    written.push(...r.written);
    unchanged += r.unchanged;
  } else skipped.push(src.adrDir ? 'ADR (nenhuma decisão registrada)' : 'ADR (adr: false)');
  // SYSTEM-DESIGN
  if (src.designFile && fs.existsSync(src.designFile)) put('architecture/SYSTEM-DESIGN.md', HEADER('.oxe/SYSTEM-DESIGN.md') + fs.readFileSync(src.designFile, 'utf8'));
  else skipped.push('SYSTEM-DESIGN (sem .oxe/SYSTEM-DESIGN.md — oxe-cc design build)');
  // 1.21.2: the domain glossary the grill produced (one term, one definition).
  if (src.glossaryFile && fs.existsSync(src.glossaryFile)) put('product/GLOSSARY.md', HEADER('.oxe/GLOSSARY.md') + fs.readFileSync(src.glossaryFile, 'utf8'));
  return { dir: path.relative(projectRoot, dir).replace(/\\/g, '/'), written, unchanged, skipped };
}

module.exports = { docsDir, publish };
