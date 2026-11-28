'use strict';

/**
 * 1.23.0 (OXB-230-12): Compact agent onboarding guide (`oxe-cc primer` & MCP `oxe_primer`).
 * Teaches any AI agent (chat or headless terminal) the single canonical autonomous OXE workflow
 * in < 80 lines, detecting greenfield vs. brownfield and any in-flight DELIVER.json automatically.
 * Pure Node.js stdlib — zero external production dependencies.
 */

const fs = require('fs');
const path = require('path');

const IGNORE_ENTRIES = new Set([
  '.git',
  '.oxe',
  'node_modules',
  '.vscode',
  '.idea',
  '.claude',
  '.cursor',
  '.github',
  '.DS_Store',
  'Thumbs.db',
]);

const CODE_MARKERS = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'cargo.toml',
  'pom.xml',
  'build.gradle',
  'gemfile',
  'composer.json',
  'src',
  'lib',
  'app',
  'bin',
  'cmd',
  'packages',
]);

function readPkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

/**
 * Classifies target directory as `greenfield` (empty or no recognizable source/manifest)
 * or `brownfield` (existing codebase).
 */
function detectProjectMode(projectRoot) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  let entries = [];
  try {
    entries = fs.readdirSync(rootAbs);
  } catch {
    return 'greenfield';
  }
  const meaningful = entries.filter((name) => !IGNORE_ENTRIES.has(name) && !name.startsWith('.'));
  if (meaningful.length === 0) return 'greenfield';
  for (const name of meaningful) {
    const low = name.toLowerCase();
    if (CODE_MARKERS.has(low)) return 'brownfield';
    if (/\.(js|cjs|mjs|ts|tsx|jsx|py|go|rs|java|cs|rb|php|html|css)$/i.test(low)) return 'brownfield';
  }
  return 'greenfield';
}

function findActiveDelivery(projectRoot) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const candidates = [];
  try {
    const health = require('./oxe-project-health.cjs');
    const statePath = health.oxePaths(rootAbs).state;
    if (fs.existsSync(statePath)) {
      const activeSession = health.parseActiveSession(fs.readFileSync(statePath, 'utf8'));
      if (activeSession) candidates.push(path.join(rootAbs, '.oxe', activeSession, 'DELIVER.json'));
    }
  } catch { /* auxiliary */ }
  candidates.push(path.join(rootAbs, '.oxe', 'DELIVER.json'));
  const sessionsDir = path.join(rootAbs, '.oxe', 'sessions');
  try {
    if (fs.existsSync(sessionsDir)) {
      const dirs = fs.readdirSync(sessionsDir).sort().reverse();
      for (const d of dirs) candidates.push(path.join(sessionsDir, d, 'DELIVER.json'));
    }
  } catch { /* auxiliary */ }

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (doc && doc.deliver_id) {
        return {
          path: file,
          deliver_id: doc.deliver_id,
          title: doc.title || null,
          status: doc.status || 'UNKNOWN',
          approval_mode: doc.approval_mode || 'pending_choice',
          active_phase_index: typeof doc.active_phase_index === 'number' ? doc.active_phase_index : 0,
          total_phases: Array.isArray(doc.phases) ? doc.phases.length : 0,
        };
      }
    } catch { /* ignore malformed */ }
  }
  return null;
}

/**
 * Builds the structured primer payload for any AI agent or human operator.
 */
function buildPrimer(projectRoot, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const projectMode = detectProjectMode(rootAbs);
  const activeDelivery = findActiveDelivery(rootAbs);

  let environment = {
    stacks: [],
    ci_mode: 'local-only',
    ci_providers: [],
    alm_provider: 'none',
    env_ok: true,
  };
  try {
    const pack = require('./oxe-onboard.cjs').buildOnboardingPack(rootAbs, {
      activeSession: opts.activeSession || null,
    });
    environment = {
      stacks: (pack.project && pack.project.stacks) || [],
      ci_mode: pack.ci ? pack.ci.mode : 'local-only',
      ci_providers: (pack.ci && pack.ci.providers) || [],
      alm_provider: (pack.alm && pack.alm.provider) || 'none',
      env_ok: pack.environment ? Boolean(pack.environment.ok) : true,
    };
  } catch { /* standalone or empty dir */ }

  const rules = [
    'Pergunte ao usuário no início se prefere `single-ok` (1 pausa para aprovar SPEC + Fases) ou `auto` (100% automático quando 0 ambiguidades bloqueantes).',
    'Use `oxe-cc deliver` para briefings completos (`oxe-cc quick` apenas para ajustes pontuais).',
    'Congele testes de aceite (`PHASE_FREEZE_TESTS`) ANTES de implementar código e NUNCA altere testes congelados.',
    'Sempre avance a máquina de estados via `oxe-cc deliver advance` (nunca declare conclusão sem verificação mecânica + smoke real).',
    'NUNCA execute `git push`, abra PR remoto ou rode `npm publish` sem autorização explícita do usuário.',
  ];

  const protocol = [
    { step: 1, action: 'Perguntar modo de aprovação (`single-ok` vs. `auto`) e receber o briefing completo.' },
    { step: 2, action: 'Executar `oxe-cc deliver init --from <briefing.md> --approval <single-ok|auto>`.' },
    { step: 3, action: 'Se `status=CLARIFY`, fazer apenas as 1–5 perguntas bloqueantes e registrar com `oxe-cc deliver answer`.' },
    { step: 4, action: 'Se `status=DESIGN_REVIEW` (`single-ok`), apresentar o resumo de SPEC/Fases e aguardar `oxe-cc deliver approve`.' },
    { step: 5, action: 'Executar em loop `oxe-cc deliver next --json` → implementar fatia → `oxe-cc deliver advance` (ou `oxe-cc deliver run` no terminal) até `DELIVERED`.' },
    { step: 6, action: 'Entregar `DELIVERY.md` com comandos testados no `FINAL_SMOKE` de como rodar a versão implementada.' },
  ];

  return {
    oxePrimerSchema: 1,
    version: readPkgVersion(),
    project_root: rootAbs,
    project_name: path.basename(rootAbs),
    project_mode: projectMode,
    environment,
    active_delivery: activeDelivery,
    approval_modes: {
      'single-ok': 'Pausa 1 única vez após SPEC e Fases F1..Fn para aprovação humana antes de executar.',
      auto: 'Executa automaticamente sem pausa de aprovação quando não houver ambiguidades bloqueantes.',
    },
    protocol,
    rules,
    quick_commands: {
      primer: 'oxe-cc primer --json',
      init: 'oxe-cc deliver init --from briefing.md --approval single-ok|auto',
      next: 'oxe-cc deliver next --json',
      advance: 'oxe-cc deliver advance --json',
      run: 'oxe-cc deliver run --from briefing.md --approval single-ok|auto',
      status: 'oxe-cc deliver status --json',
      dashboard: 'oxe-cc dashboard',
    },
  };
}

/**
 * Formats the primer into a crisp Markdown guide strictly under 80 lines.
 */
function formatPrimerMarkdown(primer) {
  const p = primer || buildPrimer(process.cwd());
  const stacks = (p.environment && p.environment.stacks && p.environment.stacks.length)
    ? p.environment.stacks.join(', ')
    : (p.project_mode === 'greenfield' ? 'nenhuma (projeto do zero)' : 'genérico');
  const ci = (p.environment && p.environment.ci_providers && p.environment.ci_providers.length)
    ? p.environment.ci_providers.join(', ')
    : 'local';
  const lines = [
    `# OXE Primer — Guia Rápido do Agente (oxe-cc v${p.version})`,
    '',
    `- **Projeto:** \`${p.project_name}\` · **Modo:** \`${p.project_mode}\` · **Stack:** ${stacks}`,
    `- **CI:** ${ci} · **ALM:** ${(p.environment && p.environment.alm_provider) || 'none'}`,
  ];
  if (p.active_delivery) {
    lines.push(
      `- **Entrega ativa:** \`${p.active_delivery.deliver_id}\` · status \`${p.active_delivery.status}\` · fase ${p.active_delivery.active_phase_index + 1}/${p.active_delivery.total_phases} (retome com \`oxe-cc deliver next --json\`)`,
    );
  }
  lines.push(
    '',
    '## Modos de Aprovação (pergunte no início)',
    '- `single-ok`: gera SPEC + Fases `F1..Fn` e pausa 1 única vez para o OK do usuário.',
    '- `auto`: avança 100% automático quando o briefing não tiver ambiguidades bloqueantes.',
    '',
    '## Fluxo Único (`oxe-cc deliver`)',
  );
  for (const s of p.protocol || []) {
    lines.push(`${s.step}. ${s.action}`);
  }
  lines.push('', '## Regras Inegociáveis');
  for (const r of p.rules || []) {
    lines.push(`- ${r}`);
  }
  lines.push(
    '',
    '## Comandos Essenciais',
    '```bash',
    'oxe-cc deliver init --from briefing.md --approval single-ok   # ou --approval auto',
    'oxe-cc deliver next --json                                     # 1 fatia atômica (chat)',
    'oxe-cc deliver advance --json                                  # valida gates e avança',
    'oxe-cc deliver run --from briefing.md --approval auto          # modo terminal headless',
    'oxe-cc deliver status --json                                   # progresso e orçamento',
    '```',
  );
  return `${lines.join('\n')}\n`;
}

module.exports = {
  detectProjectMode,
  findActiveDelivery,
  buildPrimer,
  formatPrimerMarkdown,
};
