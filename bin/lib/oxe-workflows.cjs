'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve o diretório de workflows OXE no projeto (`.oxe/workflows` tem precedência sobre `oxe/workflows`).
 * @param {string} targetProject raiz do repositório alvo
 * @returns {string | null} caminho absoluto ou null
 */
function resolveWorkflowsDir(targetProject) {
  const nested = path.join(targetProject, '.oxe', 'workflows');
  const root = path.join(targetProject, 'oxe', 'workflows');
  if (fs.existsSync(nested)) return nested;
  if (fs.existsSync(root)) return root;
  return null;
}

/**
 * Lista ficheiros `*.md` num diretório de workflows (sem recursão).
 * @param {string} workflowsDir
 * @returns {string[]} nomes ordenados
 */
function listWorkflowMdFiles(workflowsDir) {
  if (!fs.existsSync(workflowsDir)) return [];
  return fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/**
 * Compara dois conjuntos de workflows (ex.: pacote npm vs projeto).
 * @param {string} expectedDir diretório canónico (ex. `…/oxe/workflows` do pacote)
 * @param {string} actualDir diretório no projeto
 * @returns {{ expected: string[], actual: string[], missing: string[], extra: string[], ok: boolean }}
 */
function diffWorkflows(expectedDir, actualDir) {
  const expected = listWorkflowMdFiles(expectedDir);
  const actual = listWorkflowMdFiles(actualDir);
  const actSet = new Set(actual);
  const expSet = new Set(expected);
  const missing = expected.filter((f) => !actSet.has(f));
  const extra = actual.filter((f) => !expSet.has(f));
  return { expected, actual, missing, extra, ok: missing.length === 0 };
}

/** Ficheiros onde não exigimos `<success_criteria>` / `<success>` (critérios noutro bloco ou passo minimalista). */
const SUCCESS_CRITERIA_EXCEPTIONS = new Set(['help.md']);

const DEFAULT_MAX_BYTES_SOFT = 45000;

/**
 * Validação flexível da estrutura dos workflows (avisos, não bloqueante).
 * @param {string} workflowsDir diretório absoluto com `*.md` (sem recursão)
 * @param {{ maxBytesSoft?: number }} [options]
 * @returns {{
 *   fileResults: Array<{ file: string, warnings: string[] }>,
 *   warnings: Array<{ code: 'WORKFLOW_SHAPE', message: string, detail?: { file: string } }>,
 * }}
 */
function validateWorkflowShapes(workflowsDir, options = {}) {
  /** @type {Array<{ file: string, warnings: string[] }>} */
  const fileResults = [];
  /** @type {Array<{ code: 'WORKFLOW_SHAPE', message: string, detail?: { file: string } }>} */
  const warnings = [];
  if (!workflowsDir || !fs.existsSync(workflowsDir)) {
    return { fileResults, warnings };
  }
  const maxBytesSoft = options.maxBytesSoft ?? DEFAULT_MAX_BYTES_SOFT;
  const files = listWorkflowMdFiles(workflowsDir);

  for (const file of files) {
    const full = path.join(workflowsDir, file);
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      warnings.push({
        code: 'WORKFLOW_SHAPE',
        message: `${file}: não foi possível ler o ficheiro`,
        detail: { file },
      });
      continue;
    }

    const fileWarnings = [];

    const iObj = content.indexOf('<objective>');
    const iObjEnd = content.indexOf('</objective>');
    if (iObj === -1 && iObjEnd === -1) {
      fileWarnings.push('falta bloco <objective>…</objective>');
    } else {
      if (iObj === -1) fileWarnings.push('falta tag de abertura <objective>');
      if (iObjEnd === -1) fileWarnings.push('falta tag de fecho </objective>');
      if (iObj !== -1 && iObjEnd !== -1 && iObjEnd < iObj) {
        fileWarnings.push('</objective> aparece antes de <objective>');
      }
    }

    if (file === 'help.md') {
      if (content.indexOf('<output>') === -1 || content.indexOf('</output>') === -1) {
        fileWarnings.push('help.md deveria incluir <output>…</output>');
      }
    } else if (!SUCCESS_CRITERIA_EXCEPTIONS.has(file)) {
      const hasSC =
        content.includes('<success_criteria>') && content.includes('</success_criteria>');
      const hasSuccess = content.includes('<success>') && content.includes('</success>');
      if (!hasSC && !hasSuccess) {
        fileWarnings.push(
          'sem <success_criteria> nem <success>; veja oxe/templates/WORKFLOW_AUTHORING.md'
        );
      }
    }

    // LF bytes: a Windows checkout with core.autocrlf adds one byte per line, and the same plan.md read 45155 bytes there
    // against 44594 in the repository (OxeSpace 15/11)
    const bytes = Buffer.byteLength(content.replace(/\r\n/g, '\n'), 'utf8');
    if (bytes > maxBytesSoft) {
      fileWarnings.push(
        `ficheiro grande (${bytes} bytes); considere extrair para oxe/workflows/references/ (limite suave ${maxBytesSoft})`
      );
    }

    if (fileWarnings.length) {
      fileResults.push({ file, warnings: fileWarnings });
      for (const msg of fileWarnings) {
        warnings.push({
          code: 'WORKFLOW_SHAPE',
          message: `${file}: ${msg}`,
          detail: { file },
        });
      }
    }
  }

  return { fileResults, warnings };
}

/**
 * 1.23.0 (OXB-230-16): Scaffolds a new canonical workflow with valid <objective> + <success_criteria>,
 * registers it in `oxe/workflows/size-budget.json` and `workflow-runtime-contracts.json`,
 * and creates matching `.github/prompts/oxe-<slug>.prompt.md` and `commands/oxe/<slug>.md` wrappers.
 */
function scaffoldWorkflow(projectRoot, rawSlug, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const slug = String(rawSlug || '').trim().toLowerCase().replace(/^oxe-/, '').replace(/\.md$/, '');
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Slug de workflow inválido: "${rawSlug}". Use letras minúsculas, números e hífen (ex.: audit-demo).`);
  }
  const description = String(opts.description || `OXE — Workflow ${slug}`).trim();
  const mode = ['discovery', 'planning', 'execution', 'review', 'status'].includes(opts.mode) ? opts.mode : 'execution';
  const sizeClass = ['s', 'm', 'l'].includes(opts.size) ? opts.size : 's';

  const wfDir = path.join(rootAbs, 'oxe', 'workflows');
  const wfPath = path.join(wfDir, `${slug}.md`);
  if (fs.existsSync(wfPath) && !opts.force) {
    throw new Error(`Workflow já existe: oxe/workflows/${slug}.md (passe --force para sobrescrever).`);
  }

  fs.mkdirSync(wfDir, { recursive: true });
  const wfMd = [
    `# OXE — Workflow: ${slug}`,
    '',
    '<objective>',
    `${description}.`,
    '</objective>',
    '',
    '<context>',
    '- Ler `.oxe/STATE.md` e artefatos da sessão ativa antes de agir.',
    '- Manter escopo estrito e validação verificável.',
    '</context>',
    '',
    '## Passos',
    '',
    '1. Inspecionar o estado atual com `oxe-cc status --json`.',
    '2. Executar a ação principal deste workflow validando o resultado.',
    '',
    '<success_criteria>',
    `- Objetivo de \`${slug}\` concluído com evidência verificável e sem regressões.`,
    '</success_criteria>',
    '',
  ].join('\n');
  fs.writeFileSync(wfPath, wfMd, 'utf8');

  const written = [path.relative(rootAbs, wfPath).replace(/\\/g, '/')];

  // Register in size-budget.json if present
  const budgetPath = path.join(wfDir, 'size-budget.json');
  if (fs.existsSync(budgetPath)) {
    const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
    budget.files = budget.files || {};
    budget.files[`workflows/${slug}.md`] = sizeClass;
    const sorted = Object.fromEntries(Object.keys(budget.files).sort().map((k) => [k, budget.files[k]]));
    budget.files = sorted;
    fs.writeFileSync(budgetPath, `${JSON.stringify(budget, null, 2)}\n`, 'utf8');
    written.push('oxe/workflows/size-budget.json');
  }

  // Register in workflow-runtime-contracts.json if present
  const contractsPath = path.join(wfDir, 'references', 'workflow-runtime-contracts.json');
  if (fs.existsSync(contractsPath)) {
    const reg = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));
    reg.workflows = reg.workflows || {};
    if (!reg.workflows[slug] || opts.force) {
      reg.workflows[slug] = {
        reasoning_mode: mode,
        question_policy: 'ask_high_impact_only',
        required_artifacts: ['state'],
        optional_artifacts: ['spec', 'plan'],
        extraction_intent: mode === 'review' ? 'verification' : 'execution_input',
      };
      fs.writeFileSync(contractsPath, `${JSON.stringify(reg, null, 2)}\n`, 'utf8');
      written.push('oxe/workflows/references/workflow-runtime-contracts.json');
    }
  }

  // Create Copilot prompt & Claude/IDE command wrappers
  const promptDir = path.join(rootAbs, '.github', 'prompts');
  const cmdDir = path.join(rootAbs, 'commands', 'oxe');
  if (fs.existsSync(promptDir)) {
    const promptPath = path.join(promptDir, `oxe-${slug}.prompt.md`);
    fs.writeFileSync(promptPath, [
      '---',
      `name: oxe-${slug}`,
      'agent: agent',
      `description: "${description.replace(/"/g, '\\"')}"`,
      `oxe_workflow_slug: ${slug}`,
      '---',
      '',
      `Aplicar o workflow canônico \`oxe/workflows/${slug}.md\`.`,
      '',
    ].join('\n'), 'utf8');
    written.push(`.github/prompts/oxe-${slug}.prompt.md`);
  }
  if (fs.existsSync(cmdDir)) {
    const cmdPath = path.join(cmdDir, `${slug}.md`);
    fs.writeFileSync(cmdPath, [
      '---',
      `name: oxe:${slug}`,
      `description: "${description.replace(/"/g, '\\"')}"`,
      'allowed-tools:',
      '  - Read',
      '  - Write',
      '  - Glob',
      '  - Grep',
      '  - Bash',
      `oxe_workflow_slug: ${slug}`,
      '---',
      '',
      `Aplicar o workflow canônico \`oxe/workflows/${slug}.md\`.`,
      '',
    ].join('\n'), 'utf8');
    written.push(`commands/oxe/${slug}.md`);
  }

  return { ok: true, slug, mode, size: sizeClass, written };
}

module.exports = {
  resolveWorkflowsDir,
  listWorkflowMdFiles,
  diffWorkflows,
  validateWorkflowShapes,
  scaffoldWorkflow,
  DEFAULT_MAX_BYTES_SOFT,
  SUCCESS_CRITERIA_EXCEPTIONS,
};
