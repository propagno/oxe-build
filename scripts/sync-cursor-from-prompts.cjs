#!/usr/bin/env node
/**
 * Gera `.cursor/commands/*.md` a partir de `.github/prompts/*.prompt.md` (fonte Copilot).
 * Cursor espera frontmatter mínimo com `description`; corpo aponta para `oxe/workflows/*.md`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const runtimeSemantics = require('../bin/lib/oxe-runtime-semantics.cjs');

/** Raiz do pacote; em testes pode definir-se OXE_SYNC_REPO_ROOT para uma cópia temporária. */
const ROOT = process.env.OXE_SYNC_REPO_ROOT
  ? path.resolve(process.env.OXE_SYNC_REPO_ROOT)
  : path.join(__dirname, '..');
const PROMPTS = path.join(ROOT, '.github', 'prompts');
const DEST = path.join(ROOT, '.cursor', 'commands');

function extractDescription(front) {
  const m = front.match(/^description:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : 'Comando OXE';
}

function stripFrontmatter(raw) {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { desc: 'Comando OXE', body: normalized.trim(), extraFrontmatter: [] };
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { desc: 'Comando OXE', body: normalized.trim(), extraFrontmatter: [] };
  const front = normalized.slice(4, end);
  const body = normalized.slice(end + 5).trim();
  const extraFrontmatter = [];
  for (const line of front.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /^name:/.test(trimmed) || /^agent:/.test(trimmed) || /^description:/.test(trimmed)) continue;
    if (/^argument-hint:/.test(trimmed) || runtimeSemantics.RUNTIME_METADATA_KEYS.some((key) => trimmed.startsWith(`${key}:`))) {
      extraFrontmatter.push(trimmed);
    }
  }
  return { desc: extractDescription(front), body, extraFrontmatter };
}

function main() {
  if (!fs.existsSync(PROMPTS)) {
    console.error('sync-cursor-from-prompts: pasta .github/prompts ausente');
    process.exit(1);
  }
  fs.mkdirSync(DEST, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(PROMPTS)) {
    if ((name !== 'oxe.prompt.md' && !name.startsWith('oxe-')) || !name.endsWith('.prompt.md')) continue;
    const outName = name.replace(/\.prompt\.md$/i, '.md');
    const raw = fs.readFileSync(path.join(PROMPTS, name), 'utf8');
    const { desc, body, extraFrontmatter } = stripFrontmatter(raw);
    // Cursor (picker) muitas vezes não mostra o campo YAML `description` e usa a 1.ª linha
    // do ficheiro como resumo — se o corpo começasse logo após `---`, aparecia "---" ao lado do comando.
    const summaryLine = desc.trim() ? `${desc.trim()}\n\n` : '';
    const frontmatterLines = [`description: ${JSON.stringify(desc)}`, ...extraFrontmatter];
    const out = `---\n${frontmatterLines.join('\n')}\n---\n\n${summaryLine}${body}\n`;
    fs.writeFileSync(path.join(DEST, outName), out, 'utf8');
    n++;
  }
  console.log(`sync-cursor-from-prompts: ${n} ficheiro(s) em .cursor/commands/`);
}

main();
