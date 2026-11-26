'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RISK_PATTERNS = [
  { kind: 'debugger_leftover', severity: 'error', re: /^\+[^+]*\bdebugger\b/m, message: 'Instrução `debugger` adicionada no diff.' },
  { kind: 'skipped_test', severity: 'warning', re: /^\+[^+]*\b(?:it|test|describe)\.skip\s*\(/m, message: 'Teste marcado com `.skip(...)` adicionado no diff.' },
  { kind: 'empty_catch', severity: 'warning', re: /^\+[^+]*catch\s*(?:\([^)]*\))?\s*\{\s*\}/m, message: 'Bloco `catch {}` vazio sem comentário ou tratamento explícito.' },
  { kind: 'hardcoded_secret', severity: 'error', re: /^\+[^+]*(?:AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{36})/m, message: 'Possível credencial ou chave privada hardcoded no diff.' },
];

/**
 * Build an independent clean-context diff review packet + deterministic static risk findings.
 * Separates the reviewer from executor history: only SPEC acceptance criteria + git diff + static findings.
 * @param {string} projectRoot
 * @param {{ base?: string, diffText?: string, specText?: string }} [options]
 */
function buildCleanDiffReview(projectRoot, options = {}) {
  const base = options.base || 'HEAD';
  let diffText = typeof options.diffText === 'string' ? options.diffText : '';
  if (!diffText) {
    const r = spawnSync('git', ['diff', base], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    diffText = r.status === 0 ? String(r.stdout || '') : '';
  }

  const changedFiles = [];
  for (const m of diffText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    const f = m[2].trim();
    if (f && !changedFiles.includes(f)) changedFiles.push(f);
  }

  const findings = [];
  // Scan per-file hunks for static risks
  const fileSections = diffText.split(/^diff --git /m).slice(1);
  for (const sec of fileSections) {
    const header = /^a\/(.+?) b\/(.+)/.exec(sec);
    const file = header ? header[2].trim() : '(unknown)';
    for (const rule of RISK_PATTERNS) {
      if (rule.re.test(sec)) {
        findings.push({ file, kind: rule.kind, severity: rule.severity, message: rule.message });
      }
    }
  }

  // Flag production code changes with zero test changes
  const prodChanges = changedFiles.filter((f) => /^(?:src|bin|lib|packages\/[^/]+\/src)\//.test(f) && !/\.test\.|\.spec\.|tests?\//.test(f));
  const testChanges = changedFiles.filter((f) => /\.test\.|\.spec\.|tests?\//.test(f));
  if (prodChanges.length > 0 && testChanges.length === 0) {
    findings.push({
      file: prodChanges[0],
      kind: 'missing_tests',
      severity: 'warning',
      message: `${prodChanges.length} arquivo(s) de produção alterado(s) sem nenhum arquivo de teste no diff.`,
    });
  }

  let specText = typeof options.specText === 'string' ? options.specText : '';
  if (!specText) {
    const specFile = path.join(projectRoot, '.oxe', 'SPEC.md');
    if (fs.existsSync(specFile)) {
      try { specText = fs.readFileSync(specFile, 'utf8'); } catch { specText = ''; }
    }
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  const reviewPrompt = [
    '# Independent Clean-Context Diff Review',
    '',
    'Você é um revisor independente (contexto limpo, sem histórico do executor).',
    'Avalie o diff abaixo contra os critérios de aceite do SPEC.md procurando bugs lógicos, edge cases, segurança e aderência arquitetural.',
    '',
    `## Arquivos alterados (${changedFiles.length})`,
    ...changedFiles.map((f) => `- ${f}`),
    '',
    `## Achados estáticos automáticos (${findings.length})`,
    ...(findings.length ? findings.map((f) => `- [${f.severity}] ${f.file}: ${f.message}`) : ['- Nenhum achado estático automático.']),
    '',
    '## Critérios de aceite (SPEC.md)',
    specText ? specText.slice(0, 6000) : '_SPEC.md ausente._',
    '',
    '## Diff',
    '```diff',
    diffText.slice(0, 24000),
    '```',
  ].join('\n');

  return {
    schema_version: 1,
    ok: errors.length === 0,
    base,
    changed_files: changedFiles,
    errors,
    warnings,
    findings,
    review_prompt: reviewPrompt,
  };
}

module.exports = {
  buildCleanDiffReview,
};
