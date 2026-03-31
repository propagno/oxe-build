#!/usr/bin/env node
/**
 * Gera `.cursor/commands/*.md` a partir de `.github/prompts/*.prompt.md` (fonte Copilot).
 * Cursor espera frontmatter mínimo com `description`; corpo aponta para `oxe/workflows/*.md`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROMPTS = path.join(ROOT, '.github', 'prompts');
const DEST = path.join(ROOT, '.cursor', 'commands');

function extractDescription(front) {
  const m = front.match(/^description:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : 'Comando OXE';
}

function stripFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return { desc: 'Comando OXE', body: raw.trim() };
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) return { desc: 'Comando OXE', body: raw.trim() };
  const front = raw.slice(4, end);
  const body = raw.slice(end + 5).trim();
  return { desc: extractDescription(front), body };
}

function main() {
  if (!fs.existsSync(PROMPTS)) {
    console.error('sync-cursor-from-prompts: pasta .github/prompts ausente');
    process.exit(1);
  }
  fs.mkdirSync(DEST, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(PROMPTS)) {
    if (!name.startsWith('oxe-') || !name.endsWith('.prompt.md')) continue;
    const outName = name.replace(/\.prompt\.md$/i, '.md');
    const raw = fs.readFileSync(path.join(PROMPTS, name), 'utf8');
    const { desc, body } = stripFrontmatter(raw);
    const out = `---\ndescription: ${JSON.stringify(desc)}\n---\n\n${body}\n`;
    fs.writeFileSync(path.join(DEST, outName), out, 'utf8');
    n++;
  }
  console.log(`sync-cursor-from-prompts: ${n} ficheiro(s) em .cursor/commands/`);
}

main();
