'use strict';

/**
 * OXB-147: a verify command is run by the dry-verify, the task verify and the phase verify on the user's checkout.
 * F2's T18 had `npm ci --ignore-scripts (on CI: …)` as a verify "command": the dry-verify ran it, `npm ci` deleted
 * node_modules and the half-finished install left vitest missing. Verify commands must observe, never change the
 * dependency tree or the git state; and a sentence is not a command.
 */

const UNSAFE = [
  { re: /\bnpm\s+(ci|clean-install|install|i|add|uninstall|un|remove|rm|prune|dedupe|update|up|rebuild|link|unlink)\b/i, why: 'reinstala/remove pacotes (npm ci apaga node_modules antes de instalar)' },
  { re: /\b(yarn|pnpm|bun)\s+(install|add|remove|i|up|upgrade|prune|import)\b/i, why: 'reinstala/remove pacotes' },
  { re: /^\s*(yarn|pnpm)\s*$/i, why: 'instala as dependências' },
  { re: /\b(rm|del|rmdir|rd)\s+(-[a-z]*\s+|\/[a-z]\s+)*[^\s]*node_modules/i, why: 'apaga node_modules' },
  { re: /\b(rimraf|del-cli|trash)\b/i, why: 'apaga arquivos' },
  { re: /\bgit\s+(stash|checkout|switch|reset\s+--hard|clean\s+-[a-z]*[fdx]|restore|rebase|merge|pull|push|commit|tag|branch\s+-[dD])\b/i, why: 'muda o estado do git do checkout' },
  { re: /\bnpx\s+(?:-y\s+|--yes\s+)?(npm-check-updates|ncu)\b.*-u\b/i, why: 'reescreve o package.json' },
];

/** Why running `command` in a verify is unsafe, or null. */
function unsafeReason(command) {
  const text = String(command || '');
  for (const u of UNSAFE) if (u.re.test(text)) return u.why;
  return null;
}

const PROSE_FIRST = new Set(['the', 'a', 'an', 'o', 'os', 'as', 'um', 'uma', 'when', 'after', 'before', 'if', 'once', 'se', 'quando', 'depois', 'antes', 'on', 'em', 'no', 'na', 'all', 'todos', 'todas', 'every', 'each', 'cada', 'pr', 'ci', 'manual', 'manually', 'check', 'confirm', 'verify', 'verificar', 'conferir', 'confirmar']);

/** A verify "command" that is a sentence (evidence to collect elsewhere, e.g. CI jobs), not something a shell runs. */
function looksLikeProse(command) {
  const text = String(command || '').trim();
  if (!text) return false;
  const words = text.split(/\s+/);
  const first = words[0].toLowerCase().replace(/[^a-z']/g, '');
  if (PROSE_FIRST.has(first) && words.length >= 4 && !/^\.?[\\/]/.test(words[0])) return true;
  // a shell command followed by a parenthesized explanation: `npm ci --ignore-scripts (on CI: the PR's own jobs …)`
  if (/\(\s*(on|em|no|na|via|see|ver|ex\.?|e\.g\.)\b[^)]*\)\s*$/i.test(text) && /'s\b|:\s/.test(text)) return true;
  // a sentence with a colon and no flags/operators: `install-over.yml dispatched on the PR head: green on NSIS, deb …`
  if (words.length >= 6 && /:\s/.test(text) && !words.some((w) => w.startsWith('-')) && !/[|&<>]/.test(text)) return true;
  return false;
}

/** Problems of a task's verify command (split on top-level &&). */
function verifyCommandProblems(taskId, command, split) {
  const problems = [];
  // naive && split: an apostrophe in prose ("the PR's …") must not glue two commands together here
  for (const segment of String(command || '').split('&&').map((s) => s.trim()).filter(Boolean)) {
    const why = unsafeReason(segment);
    if (why) problems.push(`${taskId}: comando de verify em prosa ou destrutivo: ${segment.slice(0, 120)} — ${why}; um verify só observa (passo de setup/CI vai em notes ou numa tarefa external_delivery)`);
    else if (looksLikeProse(segment)) problems.push(`${taskId}: comando de verify em prosa ou destrutivo: ${segment.slice(0, 120)} — é texto, não comando (evidência de CI/manual vai em notes, sign-off ou external_delivery)`);
  }
  return problems;
}

module.exports = { unsafeReason, looksLikeProse, verifyCommandProblems };
