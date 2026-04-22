#!/usr/bin/env node
/**
 * OXE — CLI em pt-BR: instala workflows no projeto, bootstrap `.oxe/`, doctor, uninstall, update.
 * Uso: npx oxe-cc, doctor, status, init-oxe, uninstall, update (ver --help).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const readlinePromises = require('readline/promises');
const { spawnSync } = require('child_process');

const PKG_ROOT = path.join(__dirname, '..');
const oxeManifest = require(path.join(__dirname, 'lib', 'oxe-manifest.cjs'));
const oxeHealth = require(path.join(__dirname, 'lib', 'oxe-project-health.cjs'));
const oxeAgentInstall = require(path.join(__dirname, 'lib', 'oxe-agent-install.cjs'));
const oxeWorkflows = require(path.join(__dirname, 'lib', 'oxe-workflows.cjs'));
const oxeInstallResolve = require(path.join(__dirname, 'lib', 'oxe-install-resolve.cjs'));
const oxeNpmVersion = require(path.join(__dirname, 'lib', 'oxe-npm-version.cjs'));
const oxeDashboard = require(path.join(__dirname, 'lib', 'oxe-dashboard.cjs'));
const oxeOperational = require(path.join(__dirname, 'lib', 'oxe-operational.cjs'));
const oxeAzure = require(path.join(__dirname, 'lib', 'oxe-azure.cjs'));
const oxePlugins = require(path.join(__dirname, 'lib', 'oxe-plugins.cjs'));
const oxeContext = require(path.join(__dirname, 'lib', 'oxe-context-engine.cjs'));
const oxeRuntimeSemantics = require(path.join(__dirname, 'lib', 'oxe-runtime-semantics.cjs'));

/** Merge markers for ~/.copilot/copilot-instructions.md (bloco OXE). */
const OXE_INST_BEGIN = '<!-- oxe-cc:install-begin -->';
const OXE_INST_END = '<!-- oxe-cc:install-end -->';

const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const dim = '\x1b[2m';
const red = '\x1b[31m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

/** @type {string} */
const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/** Plain banner if banner.txt is missing (keep in sync with bin/banner.txt style). */
const DEFAULT_BANNER = `   .============================================.
   |     OXE     ·  spec-driven workflow CLI    |
   |     multi-IDE ·  Cursor · Copilot · +CLIs   |
   '============================================'
                    v{version}
`;

function useAnsiColors() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === '0') return false;
  return process.stdout.isTTY === true;
}

/** Section header (CLI). */
function printSection(title) {
  const c = useAnsiColors();
  if (!c) {
    console.log(`\n${title}\n${'─'.repeat(50)}\n`);
    return;
  }
  console.log(`\n${dim}${RULE}${reset}`);
  console.log(`  ${cyan}${bold}${title}${reset}`);
  console.log(`${dim}${RULE}${reset}\n`);
}

/** Print branded header; skip with OXE_NO_BANNER=1. Not used for --version (scripts). */
function printBanner() {
  if (process.env.OXE_NO_BANNER === '1' || process.env.OXE_NO_BANNER === 'true') return;
  const color = useAnsiColors();
  const ver = readPkgVersion();
  const bannerPath = path.join(PKG_ROOT, 'bin', 'banner.txt');
  let raw = DEFAULT_BANNER;
  if (fs.existsSync(bannerPath)) {
    try {
      raw = fs.readFileSync(bannerPath, 'utf8');
    } catch {
      /* keep default */
    }
  }
  const text = raw.replace(/\{version\}/g, ver).replace(/\r\n/g, '\n').trimEnd();
  if (color) console.log(`${dim}${RULE}${reset}\n`);
  if (!color) {
    console.log(text + '\n');
    return;
  }
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.includes(`v${ver}`)) console.log(`${dim}${line}${reset}`);
    else console.log(`${cyan}${bold}${line}${reset}`);
  }
  if (color) console.log(`\n${dim}${RULE}${reset}\n`);
  else console.log('');
}

/**
 * Caminho amigável: prefere ~/ quando estiver sob o HOME.
 * @param {string} absPath
 */
function displayPathForUser(absPath) {
  const home = os.homedir();
  const rel = path.relative(home, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return absPath;
  const normalized = rel.split(path.sep).join('/');
  return '~/' + normalized;
}

/**
 * Rodapé: o que foi afetado + próximos comandos (pt-BR).
 * @param {boolean} c
 * @param {{ bullets: string[], nextSteps: { desc: string, cmd: string }[], dryRun?: boolean }} block
 */
function printSummaryAndNextSteps(c, { bullets, nextSteps, dryRun = false }) {
  const title = dryRun ? 'Simulação (dry-run)' : 'Resumo do que foi feito';
  console.log(`\n  ${c ? dim : ''}${RULE}${reset}`);
  console.log(`  ${c ? cyan : ''}${title}${reset}`);
  for (const b of bullets) {
    console.log(`  ${c ? green : ''}•${c ? reset : ''} ${b}`);
  }
  if (nextSteps.length) {
    console.log(`\n  ${c ? yellow : ''}Próximos passos sugeridos${c ? reset : ''}`);
    let n = 1;
    for (const s of nextSteps) {
      console.log(`  ${c ? dim : ''}${n}.${c ? reset : ''} ${s.desc}`);
      console.log(`     ${c ? cyan : ''}${s.cmd}${reset}`);
      n += 1;
    }
  }
  console.log(`  ${c ? dim : ''}${RULE}${reset}\n`);
}

/**
 * @param {InstallOpts} opts
 * @param {boolean} fullLayout
 */
function buildInstallSummary(opts, fullLayout) {
  const bullets = [];
  const prefix = opts.dryRun ? '[simulação] ' : '';
  const cursorBase = installCursorBase(opts);
  const copilotCliHome = installCopilotCliHome(opts);
  const claudeBase = installClaudeBase(opts);
  const agentPaths = oxeAgentInstall.buildAgentInstallPaths(!opts.ideLocal, opts.dir);

  if (opts.oxeOnly) {
    bullets.push(`${prefix}Repositório: .oxe/workflows/ e .oxe/templates/`);
  } else if (fullLayout) {
    bullets.push(`${prefix}Repositório: pastas oxe/ e .oxe/ (workflows e templates)`);
    if (opts.commands) bullets.push(`${prefix}Repositório: commands/oxe/ (comandos estilo Claude)`);
    if (opts.agents) bullets.push(`${prefix}Repositório: AGENTS.md na raiz`);
    if (opts.vscode) bullets.push(`${prefix}Repositório: .vscode/settings.json (chat.promptFiles)`);
  } else {
    bullets.push(`${prefix}Repositório: .oxe/workflows/ e .oxe/templates/ (layout mínimo, sem oxe/ na raiz)`);
  }

  if (!opts.noInitOxe) {
    bullets.push(`${prefix}Bootstrap .oxe/: STATE.md, config.json e pasta codebase/`);
  }

  if (opts.cursor) {
    bullets.push(
      `${prefix}Cursor: comandos em ${displayPathForUser(path.join(cursorBase, 'commands'))} e regras em ${displayPathForUser(path.join(cursorBase, 'rules'))}`
    );
  }
  if (opts.copilot) {
    bullets.push(
      `${prefix}Copilot (VS Code): integração workspace-first em ${displayPathForUser(copilotInstructionsPath(opts))} + ${displayPathForUser(copilotPromptsDirPath(opts))}`
    );
  }
  if (opts.copilotCli && !opts.allAgents) {
    bullets.push(
      `${prefix}CLI: skills Copilot em ${displayPathForUser(path.join(copilotCliHome, 'skills'))} (/oxe, /oxe-scan, …); cópia legado em ${displayPathForUser(path.join(claudeBase, 'commands'))} e ${displayPathForUser(path.join(copilotCliHome, 'commands'))}`
    );
  }
  if (opts.allAgents) {
    const oc = agentPaths.opencodeCommandDirs.map((d) => displayPathForUser(d)).join(' + ');
    bullets.push(
      `${prefix}Multi-agente: OpenCode ${oc}; Gemini ${displayPathForUser(agentPaths.geminiCommandsBase)}; Codex ${displayPathForUser(agentPaths.codexAgentsSkillsRoot)} + ${displayPathForUser(agentPaths.codexPromptsDir)}; Windsurf ${displayPathForUser(agentPaths.windsurfWorkflowsDir)}; Antigravity ${displayPathForUser(agentPaths.antigravitySkillsRoot)}; + Claude/Copilot CLI como em --copilot-cli`
    );
  } else if (anyGranularAgent(opts)) {
    const parts = [];
    if (opts.agentOpenCode) parts.push(`OpenCode ${agentPaths.opencodeCommandDirs.map((d) => displayPathForUser(d)).join(' + ')}`);
    if (opts.agentGemini) parts.push(`Gemini ${displayPathForUser(agentPaths.geminiCommandsBase)}`);
    if (opts.agentCodex) {
      parts.push(
        `Codex ${displayPathForUser(agentPaths.codexAgentsSkillsRoot)} + ${displayPathForUser(agentPaths.codexPromptsDir)}`
      );
    }
    if (opts.agentWindsurf) parts.push(`Windsurf ${displayPathForUser(agentPaths.windsurfWorkflowsDir)}`);
    if (opts.agentAntigravity) parts.push(`Antigravity ${displayPathForUser(agentPaths.antigravitySkillsRoot)}`);
    if (parts.length) bullets.push(`${prefix}Agentes (seleção): ${parts.join('; ')}`);
  }

  const nextSteps = [];
  nextSteps.push({
    desc: 'Validar workflows e pasta .oxe (rode na raiz do projeto):',
    cmd: 'npx oxe-cc doctor',
  });
  nextSteps.push({
    desc: 'Resumo rápido: coerência .oxe/ e um único próximo passo:',
    cmd: 'npx oxe-cc status',
  });

  const agentHint = [];
  if (opts.cursor) agentHint.push('Cursor');
  if (opts.copilot) agentHint.push('Copilot no VS Code');
  if (opts.copilotCli || opts.allAgents || anyGranularAgent(opts)) agentHint.push('CLIs / multi-agente');
  if (agentHint.length) {
    nextSteps.push({
      desc: `Mapear o código no agente (${agentHint.join(', ')}):`,
      cmd: '/oxe-scan',
    });
  } else if (opts.oxeOnly) {
    nextSteps.push({
      desc: 'Para ativar integrações IDE/CLI neste repo, instale de novo sem --oxe-only:',
      cmd: 'npx oxe-cc@latest',
    });
  } else {
    nextSteps.push({
      desc: 'Primeiro passo do fluxo no seu editor:',
      cmd: '/oxe-scan',
    });
  }

  if (opts.copilotCli || opts.allAgents) {
    nextSteps.push({
      desc: 'No Copilot CLI: após instalar, rode /skills reload (ou reinicie o copilot) e use /oxe ou /oxe-scan:',
      cmd: '/skills list',
    });
  }
  if (opts.allAgents || opts.agentGemini) {
    nextSteps.push({
      desc: 'No Gemini CLI: recarregar comandos personalizados (/oxe, /oxe:scan, …):',
      cmd: '/commands reload',
    });
  }

  nextSteps.push({
    desc: 'Atualizar OXE depois (mesmo repositório):',
    cmd: 'npx oxe-cc@latest --force   ou   npx oxe-cc update',
  });

  return { bullets, nextSteps, dryRun: opts.dryRun };
}

/**
 * @param {UninstallOpts} u
 */
function buildUninstallFooter(u) {
  const bullets = [];
  const p = u.dryRun ? '[simulação] ' : '';
  const rm = u.dryRun ? 'Seriam removidos' : 'Removidos';
  const granularAgents = [
    u.agentOpenCode ? 'OpenCode' : null,
    u.agentGemini ? 'Gemini' : null,
    u.agentCodex ? 'Codex' : null,
    u.agentWindsurf ? 'Windsurf' : null,
    u.agentAntigravity ? 'Antigravity' : null,
  ].filter(Boolean);
  if (u.cursor) bullets.push(`${p}${rm} artefatos OXE em ~/.cursor (comandos e regras).`);
  if (u.copilot) {
    bullets.push(`${p}${rm} prompt files OXE em .github/prompts/ e o bloco OXE em .github/copilot-instructions.md.`);
  }
  if (u.copilotLegacyClean) {
    bullets.push(`${p}${rm} apenas o legado global do Copilot VS Code em ~/.copilot/ (prompts oxe-* e bloco OXE global).`);
  }
  if (u.copilotCli) {
    bullets.push(`${p}${rm} comandos oxe/oxe-* em ~/.claude/commands e ~/.copilot/commands.`);
    bullets.push(`${p}${rm} skills OXE (marcadas oxe-cc) em ~/.copilot/skills/oxe*/.`);
  }
  if (u.allAgents) {
    bullets.push(
      `${p}${rm} extensões multi-agente marcadas oxe-cc (OpenCode, Gemini TOML, Windsurf workflows, Codex prompts/skills, Antigravity), se existirem.`
    );
  } else if (granularAgents.length) {
    bullets.push(`${p}${rm} apenas as integrações selecionadas: ${granularAgents.join(', ')}.`);
  }
  if (u.ideLocal) {
    bullets.push(
      `${p}${rm} integrações OXE no repositório (.cursor, .github, .claude, .copilot, .opencode, … conforme flags).`
    );
  }
  if (u.globalCli) bullets.push(`${p}${rm} também o pacote npm global oxe-cc do PATH.`);
  if (!u.noProject) {
    bullets.push(
      `${p}${u.dryRun ? 'Seriam removidas' : 'Removidas'} no repositório: .oxe/workflows, .oxe/templates, oxe/ e commands/oxe (o que existir).`
    );
  } else {
    bullets.push(`${p}Pastas do repositório não ${u.dryRun ? 'seriam alteradas' : 'foram alteradas'} (--ide-only).`);
  }
  const nextSteps = [
    { desc: 'Instalar OXE de novo neste projeto:', cmd: 'npx oxe-cc@latest' },
    { desc: 'Conferir o estado após reinstalar:', cmd: 'npx oxe-cc doctor' },
  ];
  return { bullets, nextSteps, dryRun: u.dryRun };
}

/** @typedef {{ help: boolean, version: boolean, cursor: boolean, copilot: boolean, copilotCli: boolean, allAgents: boolean, agentOpenCode: boolean, agentGemini: boolean, agentCodex: boolean, agentWindsurf: boolean, agentAntigravity: boolean, vscode: boolean, commands: boolean, agents: boolean, force: boolean, dryRun: boolean, dir: string, all: boolean, noInitOxe: boolean, oxeOnly: boolean, globalCli: boolean, noGlobalCli: boolean, installAssetsGlobal: boolean, explicitScope: boolean, integrationsUnset: boolean, ideLocal: boolean, explicitIdeScope: boolean, explicitConfigDir: string | null, parseError: boolean, unknownFlag: string, conflictFlags: string, ignoreInstallConfig: boolean }} InstallOpts */

/** @param {InstallOpts} o */
function anyGranularAgent(o) {
  return !!(o.agentOpenCode || o.agentGemini || o.agentCodex || o.agentWindsurf || o.agentAntigravity);
}

/** @param {UninstallOpts} o */
function anyGranularUninstallAgent(o) {
  return !!(o.agentOpenCode || o.agentGemini || o.agentCodex || o.agentWindsurf || o.agentAntigravity);
}

/** @param {UninstallOpts} u */
function buildAgentCleanupTargets(u) {
  if (u.allAgents || !anyGranularUninstallAgent(u)) return null;
  return {
    opencode: Boolean(u.agentOpenCode),
    gemini: Boolean(u.agentGemini),
    windsurf: Boolean(u.agentWindsurf),
    codex: Boolean(u.agentCodex),
    antigravity: Boolean(u.agentAntigravity),
  };
}

/** @param {InstallOpts} o */
function anyIdeIntegration(o) {
  return !!(o.cursor || o.copilot || o.copilotCli || o.allAgents || anyGranularAgent(o));
}

/**
 * @param {string[]} argv
 * @returns {InstallOpts & { restPositional: string[] }}
 */
function parseInstallArgs(argv) {
  /** @type {InstallOpts & { restPositional: string[] }} */
  const out = {
    help: false,
    version: false,
    cursor: false,
    copilot: false,
    copilotCli: false,
    allAgents: false,
    agentOpenCode: false,
    agentGemini: false,
    agentCodex: false,
    agentWindsurf: false,
    agentAntigravity: false,
    vscode: false,
    commands: true,
    agents: true,
    force: false,
    dryRun: false,
    dir: process.cwd(),
    all: false,
    noInitOxe: false,
    oxeOnly: false,
    globalCli: false,
    noGlobalCli: false,
    installAssetsGlobal: false,
    explicitScope: false,
    integrationsUnset: false,
    ideLocal: false,
    explicitIdeScope: false,
    explicitConfigDir: null,
    parseError: false,
    unknownFlag: '',
    conflictFlags: '',
    ignoreInstallConfig: false,
    /** Saída JSON em `status` (CI / agentes). */
    jsonOutput: false,
    /** Lembretes agregados scan/compact em `status`. */
    statusHints: false,
    /** Visão extendida CLI-first: coverage matrix + readiness gate no terminal. */
    statusFull: false,
    restPositional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-v' || a === '--version') out.version = true;
    else if (a === '--no-install-config') out.ignoreInstallConfig = true;
    else if ((a === '--config-dir' || a === '-c') && argv[i + 1]) {
      out.explicitConfigDir = path.resolve(expandTilde(argv[++i]));
    } else if (a === '--global') {
      out.installAssetsGlobal = true;
      out.explicitScope = true;
    } else if (a === '--local') {
      out.installAssetsGlobal = false;
      out.explicitScope = true;
    } else if (a === '--ide-global') {
      out.ideLocal = false;
      out.explicitIdeScope = true;
    } else if (a === '--ide-local') {
      out.ideLocal = true;
      out.explicitIdeScope = true;
    } else if (a === '--cursor') out.cursor = true;
    else if (a === '--copilot' || a === '--copilot-vscode') out.copilot = true;
    else if (a === '--copilot-cli') out.copilotCli = true;
    else if (a === '--all-agents') out.allAgents = true;
    else if (a === '--opencode') out.agentOpenCode = true;
    else if (a === '--gemini') out.agentGemini = true;
    else if (a === '--codex') out.agentCodex = true;
    else if (a === '--windsurf') out.agentWindsurf = true;
    else if (a === '--antigravity') out.agentAntigravity = true;
    else if (a === '--vscode') out.vscode = true;
    else if (a === '--no-commands') out.commands = false;
    else if (a === '--no-agents') out.agents = false;
    else if (a === '--force' || a === '-f') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--all' || a === '-a') out.all = true;
    else if (a === '--no-init-oxe') out.noInitOxe = true;
    else if (a === '--oxe-only') out.oxeOnly = true;
    else if (a === '--global-cli' || a === '-g') out.globalCli = true;
    else if (a === '--no-global-cli' || a === '-l') out.noGlobalCli = true;
    else if (a === '--dir' && argv[i + 1]) {
      out.dir = path.resolve(argv[++i]);
    } else if (a === '--json') out.jsonOutput = true;
    else if (a === '--hints') out.statusHints = true;
    else if (a === '--full') out.statusFull = true;
    else if (!a.startsWith('-')) out.restPositional.push(a);
    else {
      out.parseError = true;
      out.unknownFlag = a;
      break;
    }
  }
  if (out.globalCli && out.noGlobalCli) {
    out.conflictFlags = 'Não use --global-cli (-g) e --no-global-cli (-l) ao mesmo tempo';
  }
  if (!out.conflictFlags && argv.includes('--global') && argv.includes('--local')) {
    out.conflictFlags = 'Não use --global e --local ao mesmo tempo (são o layout do repositório: oxe/ vs só .oxe/)';
  }
  if (!out.conflictFlags && argv.includes('--ide-global') && argv.includes('--ide-local')) {
    out.conflictFlags = 'Não use --ide-global e --ide-local ao mesmo tempo';
  }
  if (!out.conflictFlags && out.ideLocal && out.explicitConfigDir) {
    out.conflictFlags = '--ide-local não combina com --config-dir';
  }
  if (!out.conflictFlags && out.explicitConfigDir) {
    if (out.oxeOnly || out.allAgents) {
      out.conflictFlags = '--config-dir não combina com --oxe-only nem com --all-agents';
    } else {
      const ideCount = [out.cursor, out.copilot, out.copilotCli].filter(Boolean).length;
      if (out.copilot && !out.cursor && !out.copilotCli) {
        out.conflictFlags =
          '--config-dir não combina com --copilot porque o GitHub Copilot no VS Code usa .github/ no workspace';
      } else if (ideCount !== 1) {
        out.conflictFlags =
          '--config-dir exige exatamente um entre --cursor, --copilot e --copilot-cli (e não combina com --oxe-only)';
      }
    }
  }
  if (out.allAgents && !out.oxeOnly) {
    out.cursor = true;
    out.copilot = true;
    out.agentOpenCode = true;
    out.agentGemini = true;
    out.agentCodex = true;
    out.agentWindsurf = true;
    out.agentAntigravity = true;
  }
  if (out.oxeOnly) {
    out.cursor = false;
    out.copilot = false;
    out.copilotCli = false;
    out.allAgents = false;
    out.agentOpenCode = false;
    out.agentGemini = false;
    out.agentCodex = false;
    out.agentWindsurf = false;
    out.agentAntigravity = false;
    out.vscode = false;
    out.commands = false;
    out.agents = false;
    out.integrationsUnset = false;
  } else if (out.all) {
    out.cursor = true;
    out.copilot = true;
    out.integrationsUnset = false;
  } else if (!out.cursor && !out.copilot && !out.copilotCli && !out.vscode && !anyGranularAgent(out)) {
    out.integrationsUnset = true;
  } else {
    out.integrationsUnset = false;
  }
  if (out.restPositional.length) out.dir = path.resolve(out.restPositional[0]);
  return out;
}

function readPkgVersion() {
  try {
    const p = path.join(PKG_ROOT, 'package.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readPkgName() {
  try {
    const p = path.join(PKG_ROOT, 'package.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return typeof j.name === 'string' ? j.name : 'oxe-cc';
  } catch {
    return 'oxe-cc';
  }
}

function readMinNode() {
  try {
    const p = path.join(PKG_ROOT, 'package.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const eng = j.engines && j.engines.node;
    if (!eng || typeof eng !== 'string') return 18;
    const m = eng.match(/>=?\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 18;
  } catch {
    return 18;
  }
}

/** @param {string} filePath */
function expandTilde(filePath) {
  if (filePath && typeof filePath === 'string' && filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/** Windows-native Node on WSL breaks paths — abort with guidance. */
function assertNotWslWindowsNode() {
  if (process.platform !== 'win32') return;
  let isWsl = false;
  try {
    if (process.env.WSL_DISTRO_NAME) isWsl = true;
    else if (fs.existsSync('/proc/version')) {
      const pv = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
      if (pv.includes('microsoft') || pv.includes('wsl')) isWsl = true;
    }
  } catch {
    /* ignore */
  }
  if (!isWsl) return;
  console.error(`
${yellow}Node.js do Windows detectado dentro do WSL.${reset}

Isso quebra caminhos (HOME / instalação). Instale o Node nativo no WSL e execute o comando de novo.
`);
  process.exit(1);
}

/** @param {InstallOpts} opts */
function cursorUserDir(opts) {
  if (opts.explicitConfigDir && opts.cursor) return path.resolve(expandTilde(opts.explicitConfigDir));
  if (process.env.CURSOR_CONFIG_DIR) return expandTilde(process.env.CURSOR_CONFIG_DIR);
  return path.join(os.homedir(), '.cursor');
}

/** @param {InstallOpts} opts */
function copilotUserDir(opts) {
  if (opts.explicitConfigDir && opts.copilot) return path.resolve(expandTilde(opts.explicitConfigDir));
  if (process.env.COPILOT_CONFIG_DIR) return expandTilde(process.env.COPILOT_CONFIG_DIR);
  if (process.env.COPILOT_HOME) return expandTilde(process.env.COPILOT_HOME);
  return path.join(os.homedir(), '.copilot');
}

/** @param {InstallOpts} opts */
function claudeUserDir(opts) {
  if (opts.explicitConfigDir && opts.copilotCli) return path.resolve(expandTilde(opts.explicitConfigDir));
  if (process.env.CLAUDE_CONFIG_DIR) return expandTilde(process.env.CLAUDE_CONFIG_DIR);
  return path.join(os.homedir(), '.claude');
}

/** Base Cursor: ~/.cursor ou <projeto>/.cursor (com --ide-local). */
function installCursorBase(opts) {
  const target = path.resolve(opts.dir);
  if (opts.ideLocal && opts.cursor) {
    return path.join(target, '.cursor');
  }
  return cursorUserDir(opts);
}

/** Home Copilot CLI (skills, commands): ~/.copilot ou ./.copilot. */
function installCopilotCliHome(opts) {
  const target = path.resolve(opts.dir);
  if (opts.ideLocal && (opts.copilotCli || opts.allAgents)) {
    return path.join(target, '.copilot');
  }
  return copilotUserDir(opts);
}

/** Pasta .claude (comandos) global ou no projeto. */
function installClaudeBase(opts) {
  const target = path.resolve(opts.dir);
  if (opts.ideLocal && (opts.copilotCli || opts.allAgents)) {
    return path.join(target, '.claude');
  }
  return claudeUserDir(opts);
}

/** Ficheiro copilot-instructions (VS Code): sempre no workspace (.github/). */
function copilotInstructionsPath(opts) {
  const target = path.resolve(opts.dir);
  return path.join(target, '.github', 'copilot-instructions.md');
}

/** Pasta de prompt files do Copilot VS Code: sempre no workspace (.github/prompts). */
function copilotPromptsDirPath(opts) {
  const target = path.resolve(opts.dir);
  return path.join(target, '.github', 'prompts');
}

/** Artefato de auditoria da integração Copilot VS Code. */
function copilotWorkspaceManifestPath(opts) {
  return path.join(path.resolve(opts.dir), '.oxe', 'install', 'copilot-vscode.json');
}

/** Artefato de auditoria da semântica multi-runtime. */
function runtimeSemanticsManifestPath(opts) {
  return path.join(path.resolve(opts.dir), '.oxe', 'install', 'runtime-semantics.json');
}

/**
 * Instala a extensão VS Code OXE Agents via `code --install-extension`.
 * Não falha a instalação global se o VS Code CLI não estiver disponível.
 * @param {{ dryRun?: boolean, force?: boolean }} opts
 */
function installVscodeExtension(opts) {
  const c = useAnsiColors();
  const extDir = path.join(PKG_ROOT, 'vscode-extension');

  // Encontrar o VSIX mais recente na pasta da extensão
  let vsixPath = null;
  if (fs.existsSync(extDir)) {
    const vsixFiles = fs.readdirSync(extDir)
      .filter((f) => f.startsWith('oxe-agents') && f.endsWith('.vsix'))
      .sort()
      .reverse();
    if (vsixFiles.length > 0) vsixPath = path.join(extDir, vsixFiles[0]);
  }

  if (!vsixPath) {
    console.log(`  ${c ? dim : ''}VS Code extension${c ? reset : ''}  VSIX não encontrado — pulando.`);
    return;
  }

  if (opts.dryRun) {
    console.log(`${dim}vscode${reset}  (dry-run) code --install-extension "${vsixPath}"`);
    return;
  }

  // Candidatos ao CLI do VS Code (Windows precisa do .cmd)
  const codeCandidates = process.platform === 'win32'
    ? ['code.cmd', 'code', 'code-insiders.cmd', 'code-insiders']
    : ['code', 'code-insiders'];

  const { spawnSync } = require('child_process');
  for (const codeBin of codeCandidates) {
    try {
      const result = spawnSync(
        codeBin,
        ['--install-extension', vsixPath, '--force'],
        { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' }
      );
      if (result.status === 0) {
        console.log(`  ${c ? green : ''}✓${c ? reset : ''} VS Code extension instalada: ${c ? cyan : ''}OXE Agents${c ? reset : ''} (${path.basename(vsixPath)})`);
        return;
      }
    } catch {
      /* tenta próximo candidato */
    }
  }

  // code CLI não encontrado no PATH — instrução manual
  console.log(
    `  ${c ? dim : ''}VS Code extension${c ? reset : ''}  ${c ? yellow : ''}(instalação manual necessária)${c ? reset : ''}\n` +
    `    ${c ? cyan : ''}code --install-extension "${vsixPath}"${c ? reset : ''}`
  );
}

/** Integração legado do Copilot VS Code em ~/.copilot/. */
function copilotLegacyPromptDir(opts) {
  return path.join(copilotUserDir(opts), 'prompts');
}

/** Integração legado do Copilot VS Code em ~/.copilot/. */
function copilotLegacyInstructionsPath(opts) {
  return path.join(copilotUserDir(opts), 'copilot-instructions.md');
}

/** Layout “clássico”: pasta `oxe/` na raiz do repo. Caso contrário: só `.oxe/` (workflows em `.oxe/workflows`). */
function useFullRepoLayout(opts) {
  return opts.installAssetsGlobal === true;
}

/** @param {string} content */
function adjustWorkflowPathsForNestedLayout(content) {
  return oxeAgentInstall.adjustWorkflowPathsForNestedLayout(content);
}

/**
 * Skills Copilot CLI (~/.copilot/skills/).
 * @param {string} cCmdSrc
 * @param {string} copilotHome
 * @param {{ dryRun: boolean, force: boolean }} opts
 * @param {boolean} pathRewriteNested
 */
function installOxeCopilotCliSkills(cCmdSrc, copilotHome, opts, pathRewriteNested) {
  oxeAgentInstall.installSkillTreeFromCursorCommands(
    cCmdSrc,
    path.join(copilotHome, 'skills'),
    opts,
    pathRewriteNested,
    (d) => console.log(`${dim}omitido${reset} ${d} (já existe — use --force para substituir)`),
    (msg) => console.log(`${dim}skill${reset}  ${msg}`)
  );
}

function isTextAssetForPathRewrite(fileName) {
  return (
    fileName.endsWith('.md') ||
    fileName.endsWith('.mdc') ||
    fileName.endsWith('.prompt.md')
  );
}

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Merge into copilot-instructions.md (user-level).
 * @param {string} srcPath
 * @param {string} destPath
 * @param {{ dryRun: boolean, force: boolean }} opts
 * @param {boolean} idePathRewrite
 */
function installMergedCopilotInstructions(srcPath, destPath, opts, idePathRewrite) {
  let body = fs.readFileSync(srcPath, 'utf8');
  if (idePathRewrite) body = adjustWorkflowPathsForNestedLayout(body);
  const block = `${OXE_INST_BEGIN}\n${body.trim()}\n${OXE_INST_END}\n`;
  if (opts.dryRun) {
    console.log(`${dim}fusão${reset}  copilot-instructions.md → ${destPath}`);
    return;
  }
  if (!fs.existsSync(destPath)) {
    ensureDir(path.dirname(destPath));
    fs.writeFileSync(destPath, block, 'utf8');
    return;
  }
  const existing = fs.readFileSync(destPath, 'utf8');
  if (!opts.force) {
    if (existing.includes(OXE_INST_BEGIN)) {
      console.log(`${dim}omitido${reset} ${destPath} (bloco OXE já existe — use --force para atualizar)`);
    } else {
      console.log(`${dim}omitido${reset} ${destPath} (arquivo existe — use --force para acrescentar o bloco OXE)`);
    }
    return;
  }
  ensureDir(path.dirname(destPath));
  let merged;
  if (existing.includes(OXE_INST_BEGIN)) {
    const re = new RegExp(`${escapeForRegExp(OXE_INST_BEGIN)}[\\s\\S]*?${escapeForRegExp(OXE_INST_END)}`, 'm');
    merged = existing.replace(re, block.trim());
  } else {
    merged = `${existing.trimEnd()}\n\n${block}`;
  }
  fs.writeFileSync(destPath, merged, 'utf8');
}

/**
 * @param {InstallOpts} opts
 * @param {{ layout: 'nested' | 'classic' }} info
 */
function writeCopilotVsCodeManifest(opts, info) {
  const promptsDir = copilotPromptsDirPath(opts);
  const instructionsPath = copilotInstructionsPath(opts);
  const manifestPath = copilotWorkspaceManifestPath(opts);
  const promptFiles = fs.existsSync(promptsDir)
    ? fs
        .readdirSync(promptsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^oxe-.*\.prompt\.md$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort()
    : [];
  const payload = {
    schema_version: 1,
    target: 'copilot-vscode',
    synced_at: new Date().toISOString(),
    oxe_version: readPkgVersion(),
    layout: info.layout,
    instructions_path: path.relative(path.resolve(opts.dir), instructionsPath).replace(/\\/g, '/'),
    prompt_files: promptFiles,
    hashes: {},
  };
  if (fs.existsSync(instructionsPath)) {
    payload.hashes[payload.instructions_path] = oxeManifest.sha256File(instructionsPath);
  }
  for (const name of promptFiles) {
    const rel = path.posix.join('.github', 'prompts', name);
    payload.hashes[rel] = oxeManifest.sha256File(path.join(promptsDir, name));
  }
  ensureDir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

/**
 * @param {InstallOpts} opts
 * @param {{ layout: 'nested' | 'classic' }} info
 */
function writeRuntimeSemanticsManifest(opts, info) {
  const target = path.resolve(opts.dir);
  const manifestPath = runtimeSemanticsManifestPath(opts);
  const audit = oxeRuntimeSemantics.auditRuntimeTargets(target);
  const wrappers = {};
  const collectWrapper = (name, root, nameFilter) => {
    if (!fs.existsSync(root)) return;
    const files = oxeManifest.collectFilesRecursive(root, nameFilter);
    wrappers[name] = {
      path: path.relative(target, root).replace(/\\/g, '/'),
      files: files
        .map((filePath) => ({
          path: path.relative(target, filePath).replace(/\\/g, '/'),
          hash: oxeManifest.sha256File(filePath),
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
  };
  collectWrapper('commands', path.join(target, 'commands', 'oxe'), (name) => name.endsWith('.md'));
  collectWrapper(
    'copilot_prompts',
    path.join(target, '.github', 'prompts'),
    (name) => (name === 'oxe.prompt.md' || name.startsWith('oxe-')) && name.endsWith('.prompt.md')
  );
  collectWrapper(
    'cursor_commands',
    path.join(target, '.cursor', 'commands'),
    (name) => (name === 'oxe.md' || name.startsWith('oxe-')) && name.endsWith('.md')
  );
  const payload = {
    schema_version: 1,
    target: 'runtime-semantics',
    synced_at: new Date().toISOString(),
    oxe_version: readPkgVersion(),
    contract_version: oxeRuntimeSemantics.CONTRACT_VERSION,
    layout: info.layout,
    installed_runtimes: {
      cursor: Boolean(opts.cursor),
      copilot_vscode: Boolean(opts.copilot),
      copilot_cli: Boolean(opts.copilotCli || opts.allAgents),
      opencode: Boolean(opts.agentOpenCode || opts.allAgents),
      gemini: Boolean(opts.agentGemini || opts.allAgents),
      codex: Boolean(opts.agentCodex || opts.allAgents),
      windsurf: Boolean(opts.agentWindsurf || opts.allAgents),
      antigravity: Boolean(opts.agentAntigravity || opts.allAgents),
    },
    semantics_hashes: Object.fromEntries(
      oxeRuntimeSemantics.getAllWorkflowContracts().map((contract) => [
        contract.workflow_slug,
        oxeRuntimeSemantics.computeSemanticsHash(contract.workflow_slug),
      ])
    ),
    wrappers,
    audit: {
      ok: audit.ok,
      warnings: audit.warnings,
      mismatches: audit.mismatches.map((entry) => ({
        target: entry.target,
        slug: entry.slug,
        file: path.relative(target, entry.file).replace(/\\/g, '/'),
        issues: entry.issues,
      })),
    },
  };
  ensureDir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function canInstallPrompt() {
  return (
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    process.env.OXE_NO_PROMPT !== '1' &&
    process.env.OXE_NO_PROMPT !== 'true'
  );
}

/**
 * Aplica `install` de `.oxe/config.json` quando a CLI não fixou integrações/layout (flags prevalecem).
 * @param {InstallOpts} opts
 * @param {string} targetDir
 */
function applyInstallFromOxeConfig(opts, targetDir) {
  const { options, warnings } = oxeInstallResolve.resolveInstallOptionsFromConfig(targetDir, opts);
  Object.assign(opts, options);
  const c = useAnsiColors();
  for (const w of warnings) {
    console.log(`  ${c ? yellow : ''}AVISO${c ? reset : ''} .oxe/config.json: ${w}`);
  }
}

/**
 * Mapa número da lista → chaves de runtime 
 * @param {string} input
 * @returns {string[]}
 */
function parseRuntimeMultiselect(input) {
  const runtimeMap = {
    '1': 'claude',
    '2': 'opencode',
    '3': 'gemini',
    '4': 'codex',
    '5': 'copilot',
    '6': 'antigravity',
    '7': 'cursor',
    '8': 'windsurf',
  };
  const trimmed = (input || '7').trim();
  if (trimmed === '9') return ['all'];
  const choices = trimmed.split(/[\s,]+/).filter(Boolean);
  const selected = [];
  for (const c of choices) {
    const k = runtimeMap[c];
    if (k && !selected.includes(k)) selected.push(k);
  }
  return selected.length > 0 ? selected : ['cursor', 'copilot'];
}

/**
 * @param {InstallOpts} opts
 * @param {string[]} keys
 */
function applyRuntimeKeysToOpts(opts, keys) {
  if (keys.includes('all')) {
    opts.cursor = true;
    opts.copilot = true;
    opts.copilotCli = true;
    opts.allAgents = true;
    opts.agentOpenCode = true;
    opts.agentGemini = true;
    opts.agentCodex = true;
    opts.agentWindsurf = true;
    opts.agentAntigravity = true;
    opts.commands = true;
    opts.agents = true;
    return;
  }
  opts.cursor = keys.includes('cursor');
  opts.copilot = keys.includes('copilot');
  opts.copilotCli = keys.includes('claude');
  opts.agentOpenCode = keys.includes('opencode');
  opts.agentGemini = keys.includes('gemini');
  opts.agentCodex = keys.includes('codex');
  opts.agentWindsurf = keys.includes('windsurf');
  opts.agentAntigravity = keys.includes('antigravity');
  opts.allAgents =
    opts.agentOpenCode &&
    opts.agentGemini &&
    opts.agentCodex &&
    opts.agentWindsurf &&
    opts.agentAntigravity;
  const coreOnly = keys.length === 0;
  if (coreOnly) {
    opts.commands = true;
    opts.agents = true;
    return;
  }
  opts.commands = true;
  opts.agents = true;
}

/** Multiselect de ambientes (1–8, 9=todos), em português. */
async function promptRuntimeSelection() {
  const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
  const c = useAnsiColors();
  try {
    const home = displayPathForUser(os.homedir());
    console.log(`  ${c ? yellow : ''}Para quais ambientes deseja instalar o OXE?${c ? reset : ''}

  ${c ? cyan : ''}1${c ? reset : ''}) Claude Code     ${c ? dim : ''}(${home}/.claude, CLI Copilot)${c ? reset : ''}
  ${c ? cyan : ''}2${c ? reset : ''}) OpenCode        ${c ? dim : ''}(${home}/.config/opencode ou ${home}/.opencode)${c ? reset : ''}
  ${c ? cyan : ''}3${c ? reset : ''}) Gemini          ${c ? dim : ''}(${home}/.gemini)${c ? reset : ''}
  ${c ? cyan : ''}4${c ? reset : ''}) Codex           ${c ? dim : ''}(${home}/.codex, ${home}/.agents)${c ? reset : ''}
  ${c ? cyan : ''}5${c ? reset : ''}) Copilot         ${c ? dim : ''}(${home}/.copilot — VS Code / instruções)${c ? reset : ''}
  ${c ? cyan : ''}6${c ? reset : ''}) Antigravity     ${c ? dim : ''}(${home}/.gemini/antigravity)${c ? reset : ''}
  ${c ? cyan : ''}7${c ? reset : ''}) Cursor          ${c ? dim : ''}(${home}/.cursor)${c ? reset : ''}
  ${c ? cyan : ''}8${c ? reset : ''}) Windsurf        ${c ? dim : ''}(${home}/.codeium/windsurf)${c ? reset : ''}
  ${c ? cyan : ''}9${c ? reset : ''}) Todos os ambientes acima

  ${c ? dim : ''}Vários: 1,4,7 ou 1 4 7  (Enter = 7 Cursor + 5 Copilot, recomendado)${c ? reset : ''}
`);
    const answer = await rl.question(`  ${c ? dim : ''}Escolha${c ? reset : ''} ${c ? dim : ''}[7 5]${c ? reset : ''}: `);
    return parseRuntimeMultiselect(answer || '7 5');
  } finally {
    rl.close();
  }
}

/** Global vs local (pastas do projeto) */
async function promptIdeLocation(opts) {
  const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
  const c = useAnsiColors();
  const target = path.resolve(opts.dir);
  try {
    console.log(`  ${c ? yellow : ''}Onde instalar as integrações de IDE?${c ? reset : ''}

  ${c ? cyan : ''}1${c ? reset : ''}) Global  ${c ? dim : ''}(~/.cursor, ~/.copilot, ~/.claude, … — disponível em todos os projetos)${c ? reset : ''}
  ${c ? cyan : ''}2${c ? reset : ''}) Local   ${c ? dim : ''}(${displayPathForUser(path.join(target, '.cursor'))}, .github, .claude, .copilot, … — só este repositório)${c ? reset : ''}
`);
    const answer = await rl.question(`  ${c ? dim : ''}Escolha${c ? reset : ''} ${c ? dim : ''}[1]${c ? reset : ''}: `);
    const choice = (answer || '1').trim();
    opts.ideLocal = choice === '2';
    opts.explicitIdeScope = true;
  } finally {
    rl.close();
  }
}

/** @param {InstallOpts} opts */
async function promptInstallScope(opts) {
  const hasIde = anyIdeIntegration(opts);
  if (!hasIde) return;
  const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
  const c = useAnsiColors();
  try {
    const ideHint = opts.ideLocal
      ? `${c ? dim : ''}Integrações IDE ficam em pastas dentro deste repo (${c ? cyan : ''}.cursor${c ? dim : ''}, ${c ? cyan : ''}.github${c ? dim : ''}, …).${c ? reset : ''}`
      : `${c ? dim : ''}Comandos Cursor/Copilot/CLI ficam no seu utilizador (${c ? cyan : ''}~/.cursor${c ? dim : ''}, …).${c ? reset : ''}`;
    console.log(`  ${c ? yellow : ''}Como organizar os ficheiros OXE na raiz do repositório?${c ? reset : ''}
  ${ideHint}

  ${c ? cyan : ''}1${c ? reset : ''}) ${c ? dim : ''}Clássico${c ? reset : ''} — ${c ? dim : ''}pasta ${c ? cyan : ''}oxe/${c ? dim : ''} na raiz + ${c ? cyan : ''}.oxe/${c ? dim : ''} (e, se aplicável, ${c ? cyan : ''}commands/oxe${c ? dim : ''}, ${c ? cyan : ''}AGENTS.md${c ? dim : ''})${c ? reset : ''}
  ${c ? cyan : ''}2${c ? reset : ''}) ${c ? dim : ''}Só ${c ? cyan : ''}.oxe/${c ? reset : ''} ${c ? dim : ''}— workflows em ${c ? cyan : ''}.oxe/workflows/${c ? dim : ''}; sem ${c ? cyan : ''}oxe/${c ? dim : ''} na raiz${c ? reset : ''}
`);
    const answer = await rl.question(`  ${c ? dim : ''}Escolha${c ? reset : ''} ${c ? dim : ''}[1]${c ? reset : ''}: `);
    const choice = (answer || '1').trim();
    opts.installAssetsGlobal = choice !== '2';
  } finally {
    rl.close();
  }
}

/** @param {InstallOpts} opts */
async function resolveInteractiveInstall(opts) {
  if (!opts.ignoreInstallConfig) {
    applyInstallFromOxeConfig(opts, opts.dir);
  }

  if (opts.dryRun) {
    if (opts.integrationsUnset) {
      opts.cursor = true;
      opts.copilot = true;
      opts.allAgents = false;
      opts.agentOpenCode = false;
      opts.agentGemini = false;
      opts.agentCodex = false;
      opts.agentWindsurf = false;
      opts.agentAntigravity = false;
      opts.integrationsUnset = false;
    }
    if (!opts.explicitScope && anyIdeIntegration(opts)) {
      opts.installAssetsGlobal = false;
    }
    return;
  }

  const can = canInstallPrompt();

  if (opts.integrationsUnset) {
    if (can) {
      const keys = await promptRuntimeSelection();
      if (keys.length === 0) {
        opts.cursor = false;
        opts.copilot = false;
        opts.copilotCli = false;
        opts.allAgents = false;
        opts.agentOpenCode = false;
        opts.agentGemini = false;
        opts.agentCodex = false;
        opts.agentWindsurf = false;
        opts.agentAntigravity = false;
        opts.commands = false;
        opts.agents = false;
      } else {
        applyRuntimeKeysToOpts(opts, keys);
      }
      opts.integrationsUnset = false;
    } else {
      opts.cursor = true;
      opts.copilot = true;
      opts.allAgents = false;
      opts.integrationsUnset = false;
      const c = useAnsiColors();
      console.log(
        `\n  ${c ? yellow : ''}Terminal não interativo${c ? reset : ''} — layout mínimo: só ${c ? cyan : ''}.oxe/${c ? reset : ''}; integrações em ~/.cursor e ~/.copilot. Para ${c ? cyan : ''}oxe/${c ? reset : ''} na raiz use ${c ? cyan : ''}--global${c ? reset : ''} (layout do repo). IDE no projeto: ${c ? cyan : ''}--ide-local${c ? reset : ''}. Flags: ${c ? cyan : ''}--cursor${c ? reset : ''}, ${c ? cyan : ''}--copilot${c ? reset : ''}, ${c ? cyan : ''}--all-agents${c ? reset : ''}, ${c ? cyan : ''}--opencode${c ? reset : ''}, … ${c ? cyan : ''}--oxe-only${c ? reset : ''}, ${c ? cyan : ''}OXE_NO_PROMPT=1${c ? reset : ''}.\n`
      );
    }
  }

  if (anyIdeIntegration(opts) && !opts.explicitIdeScope) {
    if (can) await promptIdeLocation(opts);
    else {
      opts.ideLocal = false;
      const c = useAnsiColors();
      console.log(
        `\n  ${c ? yellow : ''}Terminal não interativo${c ? reset : ''} — integrações IDE em pastas globais (~/.cursor, …). Para instalar só neste repo: ${c ? cyan : ''}--ide-local${c ? reset : ''}.\n`
      );
    }
  }

  if (anyIdeIntegration(opts) && !opts.explicitScope) {
    if (can) await promptInstallScope(opts);
    else {
      opts.installAssetsGlobal = false;
      const c = useAnsiColors();
      console.log(
        `\n  ${c ? yellow : ''}Terminal não interativo${c ? reset : ''} — layout do repo: só ${c ? cyan : ''}.oxe/${c ? reset : ''} (opção 2). Use ${c ? cyan : ''}--global${c ? reset : ''} para também criar ${c ? cyan : ''}oxe/${c ? reset : ''} na raiz.\n`
      );
    }
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** @param {string} src @param {string} dest @param {{ dryRun: boolean }} opts */
function copyFile(src, dest, opts) {
  if (opts.dryRun) {
    console.log(`${dim}file${reset}  ${src} → ${dest}`);
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {{ dryRun: boolean, force: boolean }} opts
 * @param {boolean} pathRewriteNested
 */
function copyFileMaybeRewrite(src, dest, opts, pathRewriteNested) {
  if (opts.dryRun) {
    console.log(`${dim}file${reset}  ${src} → ${dest}`);
    return;
  }
  if (fs.existsSync(dest) && !opts.force) {
    console.log(`${dim}omitido${reset} ${dest} (já existe)`);
    return;
  }
  ensureDir(path.dirname(dest));
  if (pathRewriteNested && isTextAssetForPathRewrite(path.basename(src))) {
    const t = adjustWorkflowPathsForNestedLayout(fs.readFileSync(src, 'utf8'));
    fs.writeFileSync(dest, t, 'utf8');
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * @param {string} srcDir
 * @param {string} destDir
 * @param {{ dryRun: boolean, force: boolean }} opts
 * @param {boolean} [pathRewriteNested]
 */
function copyDir(srcDir, destDir, opts, pathRewriteNested = false) {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(destDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(srcDir, e.name);
    const d = path.join(destDir, e.name);
    if (e.isDirectory()) copyDir(s, d, opts, pathRewriteNested);
    else {
      if (fs.existsSync(d) && !opts.force) {
        console.log(`${dim}omitido${reset} ${d} (já existe — use --force para substituir)`);
        continue;
      }
      if (opts.dryRun) console.log(`${dim}file${reset}  ${s} → ${d}`);
      else {
        ensureDir(path.dirname(d));
        if (pathRewriteNested && isTextAssetForPathRewrite(e.name)) {
          const t = adjustWorkflowPathsForNestedLayout(fs.readFileSync(s, 'utf8'));
          fs.writeFileSync(d, t, 'utf8');
        } else {
          fs.copyFileSync(s, d);
        }
      }
    }
  }
}

/**
 * @param {string} content
 * @returns {boolean}
 */
function gitignoreAlreadyIgnoresOxe(content) {
  for (const line of content.split(/\r?\n/)) {
    const t = line.replace(/#.*$/, '').trim();
    if (!t || t.startsWith('!')) continue;
    if (t === '.oxe' || t === '.oxe/') return true;
    if (t === '.oxe/*' || t === '.oxe/**') return true;
  }
  return false;
}

/**
 * Garante que o `.gitignore` na raiz do projeto inclui `.oxe/` (pasta de estado OXE, não versionar).
 * @param {string} projectRoot
 * @param {{ dryRun?: boolean }} opts
 */
function ensureGitignoreIgnoresOxeDir(projectRoot, opts = {}) {
  const dryRun = opts.dryRun === true;
  const giPath = path.join(projectRoot, '.gitignore');
  const rel = path.relative(projectRoot, giPath) || '.gitignore';
  const block =
    '\n# OXE (oxe-cc) — pasta de estado local; não versionar\n' + '.oxe/\n';

  if (dryRun) {
    console.log(`${dim}gitignore${reset}  garantir .oxe/ em ${rel}`);
    return;
  }

  if (fs.existsSync(giPath)) {
    const raw = fs.readFileSync(giPath, 'utf8');
    if (gitignoreAlreadyIgnoresOxe(raw)) return;
    let out = raw;
    if (out.length > 0 && !/\n$/.test(out)) out += '\n';
    fs.writeFileSync(giPath, out + block, 'utf8');
  } else {
    fs.writeFileSync(giPath, block.replace(/^\n/, ''), 'utf8');
  }
  console.log(`${green}gitignore${reset}  ${rel} (+ .oxe/)`);
}

/**
 * Create `.oxe/STATE.md` from template and ensure `.oxe/codebase/` exists.
 * @param {string} target
 * @param {{ dryRun: boolean, force: boolean }} opts
 */
function bootstrapOxe(target, opts) {
  const oxeDir = path.join(target, '.oxe');
  const codebaseDir = path.join(oxeDir, 'codebase');
  const capabilitiesDir = path.join(oxeDir, 'capabilities');
  const investigationsDir = path.join(oxeDir, 'investigations');
  const dashboardDir = path.join(oxeDir, 'dashboard');
  const contextDir = path.join(oxeDir, 'context');
  const contextPacksDir = path.join(contextDir, 'packs');
  const contextSummariesDir = path.join(contextDir, 'summaries');
  const installDir = path.join(oxeDir, 'install');
  const stateSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'STATE.md');
  const stateDest = path.join(oxeDir, 'STATE.md');
  const configSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'config.template.json');
  const configDest = path.join(oxeDir, 'config.json');

  if (!fs.existsSync(stateSrc)) {
    console.error(`${yellow}aviso:${reset} modelo ausente: ${stateSrc}`);
    return;
  }

  if (opts.dryRun) {
    console.log(`${dim}init${reset}  ${oxeDir}/ (STATE.md, config.json, codebase/, capabilities/, investigations/, dashboard/, context/, install/, runs/, OXE-EVENTS.ndjson, ACTIVE-RUN.json)`);
    ensureGitignoreIgnoresOxeDir(target, { dryRun: true });
    return;
  }

  ensureDir(codebaseDir);
  ensureDir(capabilitiesDir);
  ensureDir(investigationsDir);
  ensureDir(dashboardDir);
  ensureDir(contextPacksDir);
  ensureDir(contextSummariesDir);
  ensureDir(installDir);

  if (!fs.existsSync(stateDest) || opts.force) {
    copyFile(stateSrc, stateDest, { dryRun: false });
    console.log(`${green}init${reset}  ${stateDest}`);
  } else {
    console.log(`${dim}omitido${reset} ${stateDest} (já existe — use --force para substituir)`);
  }

  if (fs.existsSync(configSrc)) {
    if (!fs.existsSync(configDest) || opts.force) {
      copyFile(configSrc, configDest, { dryRun: false });
      console.log(`${green}init${reset}  ${configDest}`);
    } else {
      console.log(`${dim}omitido${reset} ${configDest} (já existe — use --force para substituir)`);
    }
  }

  // Criar estruturas opcionais: plugins/, workstreams/, memory/
  const pluginsDir = path.join(oxeDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    ensureDir(pluginsDir);
    const pluginsReadme = path.join(PKG_ROOT, 'oxe', 'templates', 'PLUGINS.md');
    if (fs.existsSync(pluginsReadme)) {
      const destPluginsReadme = path.join(pluginsDir, 'README.md');
      if (!fs.existsSync(destPluginsReadme)) {
        copyFile(pluginsReadme, destPluginsReadme, { dryRun: false });
        console.log(`${green}init${reset}  ${destPluginsReadme}`);
      }
    }
  }

  const workstreamsDir = path.join(oxeDir, 'workstreams');
  if (!fs.existsSync(workstreamsDir)) {
    ensureDir(workstreamsDir);
  }

  const sessionsDir = path.join(oxeDir, 'sessions');
  if (!fs.existsSync(sessionsDir)) {
    ensureDir(sessionsDir);
  }

  const globalDir = path.join(oxeDir, 'global');
  if (!fs.existsSync(globalDir)) {
    ensureDir(globalDir);
  }

  const globalMilestonesDir = path.join(globalDir, 'milestones');
  if (!fs.existsSync(globalMilestonesDir)) {
    ensureDir(globalMilestonesDir);
  }

  const lessonsSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'LESSONS.template.md');
  const lessonsDest = path.join(globalDir, 'LESSONS.md');
  if (fs.existsSync(lessonsSrc) && !fs.existsSync(lessonsDest)) {
    copyFile(lessonsSrc, lessonsDest, { dryRun: false });
    console.log(`${green}init${reset}  ${lessonsDest}`);
  }

  const milestonesSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'MILESTONES.template.md');
  const milestonesDest = path.join(globalDir, 'MILESTONES.md');
  if (fs.existsSync(milestonesSrc) && !fs.existsSync(milestonesDest)) {
    copyFile(milestonesSrc, milestonesDest, { dryRun: false });
    console.log(`${green}init${reset}  ${milestonesDest}`);
  }

  const memoryDir = path.join(oxeDir, 'memory');
  if (!fs.existsSync(memoryDir)) {
    ensureDir(memoryDir);
  }

  const runsDir = path.join(oxeDir, 'runs');
  if (!fs.existsSync(runsDir)) {
    ensureDir(runsDir);
  }

  const runtimeSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'EXECUTION-RUNTIME.template.md');
  const runtimeDest = path.join(oxeDir, 'EXECUTION-RUNTIME.md');
  if (fs.existsSync(runtimeSrc) && !fs.existsSync(runtimeDest)) {
    copyFile(runtimeSrc, runtimeDest, { dryRun: false });
    console.log(`${green}init${reset}  ${runtimeDest}`);
  }

  const activeRunSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'ACTIVE-RUN.template.json');
  const activeRunDest = path.join(oxeDir, 'ACTIVE-RUN.json');
  if (fs.existsSync(activeRunSrc) && !fs.existsSync(activeRunDest)) {
    copyFile(activeRunSrc, activeRunDest, { dryRun: false });
    console.log(`${green}init${reset}  ${activeRunDest}`);
  }

  const eventsDest = path.join(oxeDir, 'OXE-EVENTS.ndjson');
  if (!fs.existsSync(eventsDest)) {
    fs.writeFileSync(eventsDest, '', 'utf8');
    console.log(`${green}init${reset}  ${eventsDest}`);
  }

  const checkpointsSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'CHECKPOINTS.template.md');
  const checkpointsDest = path.join(oxeDir, 'CHECKPOINTS.md');
  if (fs.existsSync(checkpointsSrc) && !fs.existsSync(checkpointsDest)) {
    copyFile(checkpointsSrc, checkpointsDest, { dryRun: false });
    console.log(`${green}init${reset}  ${checkpointsDest}`);
  }

  const capabilitiesSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'CAPABILITIES.template.md');
  const capabilitiesDest = path.join(oxeDir, 'CAPABILITIES.md');
  if (fs.existsSync(capabilitiesSrc) && !fs.existsSync(capabilitiesDest)) {
    copyFile(capabilitiesSrc, capabilitiesDest, { dryRun: false });
    console.log(`${green}init${reset}  ${capabilitiesDest}`);
  }

  const investigationsIndexDest = path.join(oxeDir, 'INVESTIGATIONS.md');
  if (!fs.existsSync(investigationsIndexDest)) {
    fs.writeFileSync(
      investigationsIndexDest,
      '# OXE — Investigações\n\n| Data | Ficheiro | Objetivo | Modo | Estado |\n|------|----------|----------|------|--------|\n',
      'utf8'
    );
    console.log(`${green}init${reset}  ${investigationsIndexDest}`);
  }

  ensureGitignoreIgnoresOxeDir(target, { dryRun: false });
}

/**
 * @param {string} url
 */
function openUrlInBrowser(url) {
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, shell: false });
    return;
  }
  if (process.platform === 'darwin') {
    spawnSync('open', [url], { stdio: 'ignore', detached: true, shell: false });
    return;
  }
  spawnSync('xdg-open', [url], { stdio: 'ignore', detached: true, shell: false });
}

/**
 * Lembretes de rotina (scan/compact antigos) para `status --hints` ou JSON.
 * @param {string} target
 * @param {ReturnType<typeof oxeHealth.buildHealthReport>} r
 * @param {ReturnType<typeof oxeHealth.loadOxeConfigMerged>['config']} config
 * @returns {string[]}
 */
function collectOxeRoutineHints(target, r, config) {
  /** @type {string[]} */
  const out = [];
  const statePath = path.join(target, '.oxe', 'STATE.md');
  const hasState = fs.existsSync(statePath);
  if (config.scan_max_age_days > 0 && r.scanDate && r.stale.stale) {
    out.push(
      `Último scan há ~${r.stale.days} dia(s) (limite: ${config.scan_max_age_days}) — considere /oxe-scan`
    );
  } else if (config.scan_max_age_days > 0 && !r.scanDate && hasState) {
    out.push(
      'Preencha **Data:** em STATE.md (secção Último scan) para o aviso de scan antigo, ou use scan_max_age_days: 0'
    );
  }
  if (config.compact_max_age_days > 0 && r.compactDate && r.staleCompact.stale) {
    out.push(
      `Último compact há ~${r.staleCompact.days} dia(s) (limite: ${config.compact_max_age_days}) — considere /oxe-compact se .oxe/codebase/ divergiu do código`
    );
  } else if (config.compact_max_age_days > 0 && !r.compactDate && hasState) {
    out.push(
      'Preencha **Data:** em STATE.md (secção Último compact) para o aviso de compact antigo, ou use compact_max_age_days: 0'
    );
  }
  return out;
}

/**
 * Doctor / status: config estendida, fase STATE, scan antigo, SUMMARY, SPEC/PLAN.
 * @param {string} target
 * @param {boolean} c
 * @param {{ skipScanCompactAgeWarnings?: boolean }} [diagOpts]
 */
function printOxeHealthDiagnostics(target, c, diagOpts = {}) {
  const skipAge = Boolean(diagOpts.skipScanCompactAgeWarnings);
  const r = oxeHealth.buildHealthReport(target);
  const { config } = oxeHealth.loadOxeConfigMerged(target);

  console.log(`\n  ${c ? cyan : ''}▸ Coerência .oxe/ e config${reset}`);
  console.log(`  ${c ? dim : ''}Saúde lógica:${c ? reset : ''} ${r.healthStatus}`);

  if (r.configParseError) {
    console.log(`  ${red}FALHA${reset} config.json: ${r.configParseError}`);
    return;
  }

  for (const err of r.typeErrors) {
    console.log(`  ${yellow}AVISO${reset} ${err}`);
  }
  if (r.unknownConfigKeys.length) {
    console.log(
      `  ${yellow}AVISO${reset} Chaves desconhecidas em .oxe/config.json (não usadas pelo oxe-cc): ${r.unknownConfigKeys.join(', ')}`
    );
  }

  if (r.phase) {
    console.log(`  ${c ? dim : ''}Fase (STATE.md):${c ? reset : ''} ${r.phase}`);
  }
  if (r.activeSession) {
    console.log(`  ${c ? dim : ''}Sessão ativa:${c ? reset : ''} ${r.activeSession}`);
  }
  if (r.planReviewStatus) {
    console.log(`  ${c ? dim : ''}Revisão do plano:${c ? reset : ''} ${r.planReviewStatus}`);
  }
  if (r.activeRun && r.activeRun.run_id) {
    console.log(`  ${c ? dim : ''}Run ativo:${c ? reset : ''} ${r.activeRun.run_id} (${r.activeRun.status || 'planned'})`);
  }
  if (r.eventsSummary) {
    console.log(`  ${c ? dim : ''}Tracing:${c ? reset : ''} ${r.eventsSummary.total} evento(s)`);
  }
  if (r.planSelfEvaluation && r.planSelfEvaluation.hasSection) {
    const best = r.planSelfEvaluation.bestPlan || '—';
    const conf =
      typeof r.planSelfEvaluation.confidence === 'number' ? `${r.planSelfEvaluation.confidence}%` : '—';
    console.log(`  ${c ? dim : ''}Plano (autoavaliação):${c ? reset : ''} melhor=${best} | confiança=${conf}`);
  }
  if (r.contextQuality) {
    console.log(
      `  ${c ? dim : ''}Contexto:${c ? reset : ''} score=${r.contextQuality.primaryScore != null ? r.contextQuality.primaryScore : '—'} | workflow=${r.contextQuality.primaryWorkflow || '—'} | status=${r.contextQuality.primaryStatus || '—'}`
    );
  }
  if (r.semanticsDrift) {
    console.log(`  ${c ? dim : ''}Semântica multi-runtime:${c ? reset : ''} ${r.semanticsDrift.ok ? 'alinhada' : 'com drift'}`);
  }
  if (r.copilot && (r.copilot.detected || r.copilot.warnings.length)) {
    const promptSource =
      r.copilot.promptSource === 'workspace'
        ? '.github/prompts/'
        : r.copilot.promptSource === 'legacy_global'
          ? '~/.copilot/prompts/ (legado)'
          : 'ausente';
    console.log(`  ${c ? dim : ''}Copilot VS Code:${c ? reset : ''} target=workspace | source=${promptSource}`);
    console.log(`  ${c ? dim : ''}Copilot workspace:${c ? reset : ''} ${displayPathForUser(r.copilot.workspace.promptsDir)}`);
    if (r.copilot.legacy.detected) {
      console.log(`  ${c ? dim : ''}Legado global:${c ? reset : ''} ${displayPathForUser(r.copilot.legacy.root)}`);
    }
  }
  if (r.azureActive && r.azure) {
    console.log(`  ${c ? dim : ''}Azure:${c ? reset : ''} ${r.azure.authStatus && r.azure.authStatus.login_active ? 'login ativo' : 'sem login'} | subscription=${r.azure.profile && (r.azure.profile.subscription_name || r.azure.profile.subscription_id) || '—'}`);
    console.log(`  ${c ? dim : ''}Azure inventory:${c ? reset : ''} total=${r.azure.inventorySummary ? r.azure.inventorySummary.total : 0} | pendências=${r.azure.pendingOperations || 0}`);
    if (r.azure.inventoryStale && r.azure.inventoryStale.stale) {
      console.log(`  ${yellow}AVISO${reset} Inventário Azure stale — rode ${cyan}npx oxe-cc azure sync${reset}`);
    }
    for (const warning of r.azure.warnings || []) {
      console.log(`  ${yellow}AVISO${reset} ${warning}`);
    }
  }

  if (!skipAge) {
    if (config.scan_max_age_days > 0 && r.scanDate && r.stale.stale) {
      console.log(
        `  ${yellow}AVISO${reset} Último scan há ~${r.stale.days} dia(s) (limite: ${config.scan_max_age_days}) — considere ${cyan}/oxe-scan${reset}`
      );
    } else if (config.scan_max_age_days > 0 && !r.scanDate && fs.existsSync(path.join(target, '.oxe', 'STATE.md'))) {
      console.log(
        `  ${dim}Obs.:${reset} Preencha **Data:** em STATE.md (secção Último scan) para o aviso de scan antigo, ou use scan_max_age_days: 0`
      );
    }

    if (config.compact_max_age_days > 0 && r.compactDate && r.staleCompact.stale) {
      console.log(
        `  ${yellow}AVISO${reset} Último compact há ~${r.staleCompact.days} dia(s) (limite: ${config.compact_max_age_days}) — considere ${cyan}/oxe-compact${reset} se .oxe/codebase/ estiver desatualizado`
      );
    } else if (
      config.compact_max_age_days > 0 &&
      !r.compactDate &&
      fs.existsSync(path.join(target, '.oxe', 'STATE.md'))
    ) {
      console.log(
        `  ${dim}Obs.:${reset} Preencha **Data:** em STATE.md (secção Último compact) para o aviso de compact antigo, ou use compact_max_age_days: 0`
      );
    }
  }

  if (Array.isArray(config.scan_focus_globs) && config.scan_focus_globs.length) {
    console.log(`  ${c ? dim : ''}Scan (foco em .oxe/config):${c ? reset : ''} ${config.scan_focus_globs.join(', ')}`);
  }
  if (Array.isArray(config.scan_ignore_globs) && config.scan_ignore_globs.length) {
    console.log(`  ${c ? dim : ''}Scan (ignorar):${c ? reset : ''} ${config.scan_ignore_globs.join(', ')}`);
  }

  for (const w of r.phaseWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.runtimeWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.reviewWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.capabilityWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.investigationWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.sessionWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.installWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.copilotWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.contextWarn || []) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.semanticsWarn || []) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  if (r.summaryGapWarn) {
    console.log(`  ${yellow}AVISO${reset} ${r.summaryGapWarn}`);
  }
  for (const w of r.specWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
  for (const w of r.planWarn) {
    console.log(`  ${yellow}AVISO${reset} ${w}`);
  }
}

/**
 * Imprime uma célula de coverage com cor ANSI.
 * @param {boolean} exists
 * @param {string} label
 */
function coverageCell(exists, label) {
  const c = useAnsiColors();
  return exists ? `${c ? green : ''}✓ ${label}${c ? reset : ''}` : `${c ? dim : ''}✗ ${label}${c ? reset : ''}`;
}

/**
 * Visão CLI-first: health + coverage matrix + readiness gate no terminal.
 * @param {string} target
 */
function runStatusFull(target) {
  const c = useAnsiColors();
  const report = oxeHealth.buildHealthReport(target);
  const p = oxeHealth.oxePaths(target);
  const activeSession = report.activeSession || null;
  let sp = p;
  if (activeSession) {
    sp = oxeHealth.scopedOxePaths(target, activeSession);
  }

  printSection('OXE ▸ status --full');
  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}Sessão:${c ? reset : ''} ${c ? cyan : ''}${activeSession || 'modo legado'}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}Fase:${c ? reset : ''} ${report.phase || '—'}`);

  const healthColor = report.healthStatus === 'healthy' ? green : report.healthStatus === 'warning' ? yellow : red;
  console.log(`  ${c ? green : ''}Saúde:${c ? reset : ''} ${c ? healthColor : ''}${report.healthStatus}${c ? reset : ''}`);

  if (report.copilot && (report.copilot.detected || report.copilot.warnings.length)) {
    console.log(`\n  ${c ? yellow : ''}Copilot VS Code${c ? reset : ''}`);
    console.log(`  ${c ? dim : ''}Target:${c ? reset : ''} workspace (.github/)`);
    console.log(`  ${c ? dim : ''}Source:${c ? reset : ''} ${report.copilot.promptSource}`);
    console.log(`  ${c ? dim : ''}Workspace prompts:${c ? reset : ''} ${displayPathForUser(report.copilot.workspace.promptsDir)}`);
    console.log(`  ${c ? dim : ''}Legado global:${c ? reset : ''} ${report.copilot.legacy.detected ? 'detectado' : 'não'}`);
    for (const warning of report.copilotWarn.slice(0, 3)) {
      console.log(`  ${c ? yellow : ''}  • ${warning}${c ? reset : ''}`);
    }
  }

  // Coverage matrix
  const specPath = activeSession && sp.spec ? sp.spec : p.spec;
  const planPath = activeSession && sp.plan ? sp.plan : p.plan;
  const verifyPath = activeSession && sp.verify ? sp.verify : p.verify;
  const specExists = fs.existsSync(specPath);
  const planExists = fs.existsSync(planPath);
  const verifyExists = fs.existsSync(verifyPath);
  const lessonsExists = fs.existsSync(p.globalLessons || p.lessons);
  const codebaseExists = fs.existsSync(p.codebase);

  console.log(`\n  ${c ? yellow : ''}Coverage matrix${c ? reset : ''}`);
  console.log(`  ${coverageCell(codebaseExists, 'codebase scan')}   ${coverageCell(specExists, 'SPEC.md')}   ${coverageCell(planExists, 'PLAN.md')}   ${coverageCell(verifyExists, 'VERIFY.md')}   ${coverageCell(lessonsExists, 'LESSONS.md')}`);

  // Readiness gate
  const ready = specExists && planExists && !report.planWarn.length && !report.runtimeWarn.length;
  const gateColor = ready ? green : yellow;
  console.log(`\n  ${c ? yellow : ''}Readiness gate${c ? reset : ''}`);
  console.log(`  ${c ? gateColor : ''}${ready ? '✓ Pronto para executar' : '✗ Não pronto para executar'}${c ? reset : ''}`);
  if (!specExists) console.log(`  ${c ? dim : ''}  • SPEC.md ausente — rode /oxe-spec${c ? reset : ''}`);
  if (!planExists) console.log(`  ${c ? dim : ''}  • PLAN.md ausente — rode /oxe-plan${c ? reset : ''}`);
  if (report.planWarn.length) {
    for (const w of report.planWarn) {
      console.log(`  ${c ? yellow : ''}  • ${w}${c ? reset : ''}`);
    }
  }

  // Active run summary
  if (report.activeRun) {
    const ar = report.activeRun;
    console.log(`\n  ${c ? yellow : ''}Active run${c ? reset : ''}`);
    console.log(`  ${c ? dim : ''}Run:${c ? reset : ''} ${ar.run_id || '—'}   ${c ? dim : ''}Estado:${c ? reset : ''} ${ar.status || '—'}   ${c ? dim : ''}Onda:${c ? reset : ''} ${ar.current_wave != null ? ar.current_wave : '—'}`);
  }

  if (
    report.runtimeMode ||
    report.providerCatalog ||
    (report.activeRun && (report.verificationSummary || report.pendingGates || report.quotaSummary || report.auditSummary || report.promotionSummary || report.policyDecisionSummary)) ||
    (report.pendingGates && report.pendingGates.total > 0)
  ) {
    console.log(`\n  ${c ? yellow : ''}Runtime enterprise${c ? reset : ''}`);
    if (report.runtimeMode) {
      console.log(`  ${c ? dim : ''}Runtime mode:${c ? reset : ''} ${report.runtimeMode.runtime_mode || 'legacy'}${report.runtimeMode.enterprise_available === false ? ' (engine indisponível)' : ''}`);
    }
    if (report.fallbackMode) {
      console.log(`  ${c ? dim : ''}Fallback:${c ? reset : ''} ${report.fallbackMode}${report.runtimeMode && report.runtimeMode.reason ? ` · ${report.runtimeMode.reason}` : ''}`);
    }
    if (report.verificationSummary) {
      console.log(`  ${c ? dim : ''}Verification:${c ? reset : ''} total ${report.verificationSummary.total} · pass ${report.verificationSummary.pass} · fail ${report.verificationSummary.fail} · error ${report.verificationSummary.error}`);
    }
    if (report.residualRiskSummary) {
      console.log(`  ${c ? dim : ''}Residual risks:${c ? reset : ''} total ${report.residualRiskSummary.total} · high/critical ${report.residualRiskSummary.highOrCritical}`);
    }
    if (report.evidenceCoverage) {
      console.log(`  ${c ? dim : ''}Evidence coverage:${c ? reset : ''} ${report.evidenceCoverage.coverage_percent}% (${report.evidenceCoverage.checks_with_evidence}/${report.evidenceCoverage.total_checks})`);
    }
    if (report.pendingGates) {
      console.log(`  ${c ? dim : ''}Pending gates:${c ? reset : ''} ${report.pendingGates.pending.length} (stale ${report.pendingGates.stalePending.length}) · SLA ${report.pendingGates.gateSlaHours || 24}h`);
    }
    if (report.policyDecisionSummary) {
      console.log(`  ${c ? dim : ''}Policy decisions:${c ? reset : ''} total ${report.policyDecisionSummary.total} · denied ${report.policyDecisionSummary.denied} · gated ${report.policyDecisionSummary.gated} · override sem razão ${report.policyDecisionSummary.overridesWithoutRationale}`);
    }
    if (report.policyCoverage) {
      console.log(`  ${c ? dim : ''}Policy coverage:${c ? reset : ''} ${report.policyCoverage.coveragePercent}% · mutations ${report.policyCoverage.coveredMutations}/${report.policyCoverage.mutationNodes}`);
    }
    if (report.quotaSummary) {
      const consumed = report.quotaSummary.consumed || {};
      const limits = report.quotaSummary.limits || {};
      console.log(`  ${c ? dim : ''}Quotas:${c ? reset : ''} work items ${consumed.workItems ?? 0}/${limits.maxWorkItemsPerRun ?? '∞'} · mutations ${consumed.mutations ?? 0}/${limits.maxMutationsPerRun ?? '∞'} · retries ${consumed.retries ?? 0}/${limits.maxRetriesPerRun ?? '∞'}`);
    }
    if (report.auditSummary) {
      console.log(`  ${c ? dim : ''}Audit trail:${c ? reset : ''} run ${report.auditSummary.runEntries} · warn ${report.auditSummary.warn} · critical ${report.auditSummary.critical}`);
    }
    if (report.promotionSummary) {
      console.log(`  ${c ? dim : ''}Promotion:${c ? reset : ''} ${report.promotionSummary.status || '—'} · target ${report.promotionSummary.targetKind || '—'} · remote ${report.promotionSummary.remote || '—'}`);
    }
    if (report.promotionReadiness) {
      console.log(`  ${c ? dim : ''}Promotion readiness:${c ? reset : ''} ${report.promotionReadiness.status || 'unknown'}${Array.isArray(report.promotionReadiness.blockers) && report.promotionReadiness.blockers.length ? ` · blockers ${report.promotionReadiness.blockers.join(', ')}` : ''}`);
    }
    if (report.recoveryState) {
      console.log(`  ${c ? dim : ''}Recovery:${c ? reset : ''} ${report.recoveryState.status || 'unknown'} · recoveries ${report.recoveryState.recoverCount ?? 0} · issues ${Array.isArray(report.recoveryState.issues) ? report.recoveryState.issues.length : 0}`);
    }
    if (report.multiAgent) {
      const agents = Array.isArray(report.multiAgent.agents) ? report.multiAgent.agents.length : 0;
      const handoffs = Array.isArray(report.multiAgent.handoffs) ? report.multiAgent.handoffs.length : 0;
      const ownership = Array.isArray(report.multiAgent.ownership) ? report.multiAgent.ownership.length : 0;
      console.log(`  ${c ? dim : ''}Multi-agent:${c ? reset : ''} ${report.multiAgent.enabled ? (report.multiAgent.mode || 'active') : 'disabled'} · agentes ${agents} · ownership ${ownership} · handoffs ${handoffs}`);
    }
    if (report.providerCatalog) {
      const summary = report.providerCatalog.summary || {};
      const pluginsCount = summary.pluginsCount ?? summary.total_plugins ?? (Array.isArray(summary.plugins) ? summary.plugins.length : 0);
      const toolProviders = summary.toolProviders ?? summary.tool_providers ?? 0;
      const verifierProviders = summary.verifierProviders ?? summary.verifier_providers ?? 0;
      const loadErrors = summary.loadErrors ?? summary.load_errors ?? (Array.isArray(report.providerCatalog.load_errors) ? report.providerCatalog.load_errors.length : 0);
      console.log(`  ${c ? dim : ''}Provider catalog:${c ? reset : ''} plugins ${pluginsCount} · tools ${toolProviders} · verifiers ${verifierProviders} · load errors ${loadErrors}`);
    }
  }

  if (report.contextQuality || report.semanticsDrift) {
    const primaryWorkflow = report.contextQuality && report.contextQuality.primaryWorkflow ? report.contextQuality.primaryWorkflow : 'dashboard';
    const primaryScore = report.contextQuality && report.contextQuality.primaryScore != null ? report.contextQuality.primaryScore : null;
    const primaryStatus = report.contextQuality && report.contextQuality.primaryStatus ? report.contextQuality.primaryStatus : '—';
    const freshness = report.packFreshness && report.packFreshness[primaryWorkflow] ? report.packFreshness[primaryWorkflow] : null;
    console.log(`\n  ${c ? yellow : ''}Contexto e semântica${c ? reset : ''}`);
    console.log(`  ${c ? dim : ''}Pack primário:${c ? reset : ''} ${primaryWorkflow}`);
    console.log(`  ${c ? dim : ''}Qualidade:${c ? reset : ''} ${primaryScore != null ? `${primaryScore} (${primaryStatus})` : '—'}`);
    console.log(`  ${c ? dim : ''}Freshness:${c ? reset : ''} ${freshness ? `${freshness.reason}${freshness.pack_age_hours != null ? ` · ${freshness.pack_age_hours}h` : ''}` : '—'}`);
    console.log(`  ${c ? dim : ''}Drift semântico:${c ? reset : ''} ${report.semanticsDrift && report.semanticsDrift.ok ? 'não detectado' : 'detectado'}`);
  }

  // Plan self-evaluation
  if (report.planSelfEvaluation) {
    const pse = report.planSelfEvaluation;
    console.log(`\n  ${c ? yellow : ''}Autoavaliação do plano${c ? reset : ''}`);
    if (pse.best_plan_current != null) {
      const bestColor = pse.best_plan_current ? green : red;
      console.log(`  ${c ? dim : ''}Melhor plano atual:${c ? reset : ''} ${c ? bestColor : ''}${pse.best_plan_current ? 'sim' : 'não'}${c ? reset : ''}`);
    }
    if (pse.confidence != null) {
      const confColor = Number(pse.confidence) >= 70 ? green : Number(pse.confidence) >= 50 ? yellow : red;
      console.log(`  ${c ? dim : ''}Confiança:${c ? reset : ''} ${c ? confColor : ''}${pse.confidence}%${c ? reset : ''}`);
    }
  }

  console.log(`\n  ${c ? dim : ''}Próximo passo:${c ? reset : ''} ${c ? cyan : ''}${report.next && report.next.cursorCmd ? report.next.cursorCmd : '—'}${c ? reset : ''}`);
  console.log(`  ${c ? dim : ''}Motivo:${c ? reset : ''} ${report.next && report.next.reason ? report.next.reason : '—'}`);
  console.log(`\n  ${c ? dim : ''}Para visão operacional completa (web): ${cyan}oxe-cc dashboard${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}✓${c ? reset : ''} status --full concluído.\n`);
}

/**
 * @param {string} target
 * @param {{ json?: boolean, hints?: boolean, full?: boolean }} [opts]
 */
function runStatus(target, opts = {}) {
  const { config } = oxeHealth.loadOxeConfigMerged(target);
  const report = oxeHealth.buildHealthReport(target);
  const routineHints = collectOxeRoutineHints(target, report, config);
  const next = report.next;

  if (opts.json) {
    /** @type {Record<string, unknown>} */
    const payload = {
      oxeStatusSchema: 5,
      projectRoot: path.resolve(target),
      nextStep: report.next.step,
      cursorCmd: report.next.cursorCmd,
      reason: report.next.reason,
      artifacts: report.next.artifacts,
      phase: report.phase,
      healthStatus: report.healthStatus,
      activeSession: report.activeSession,
      scanDate: report.scanDate,
      staleScan: report.stale,
      compactDate: report.compactDate,
        staleCompact: report.staleCompact,
        planSelfEvaluation: report.planSelfEvaluation,
        planReviewStatus: report.planReviewStatus,
      activeRun: report.activeRun,
      eventsSummary: report.eventsSummary,
      runtimeMode: report.runtimeMode,
      fallbackMode: report.fallbackMode,
      gateSla: report.pendingGates ? report.pendingGates.gateSlaHours || 24 : 24,
      staleGateCount: report.pendingGates ? report.pendingGates.staleGateCount || 0 : 0,
      verificationSummary: report.verificationSummary,
      residualRiskSummary: report.residualRiskSummary,
      evidenceCoverage: report.evidenceCoverage,
      pendingGates: report.pendingGates,
      gateQueue: report.gateQueue,
      policyDecisionSummary: report.policyDecisionSummary,
      policyCoverage: report.policyCoverage,
      quotaSummary: report.quotaSummary,
      auditSummary: report.auditSummary,
      promotionSummary: report.promotionSummary,
      promotionReadiness: report.promotionReadiness,
      recoveryState: report.recoveryState,
      multiAgent: report.multiAgent || null,
      providerCatalog: report.providerCatalog,
      memoryLayers: report.memoryLayers,
      azureActive: report.azureActive,
      azure: report.azure,
      copilot: report.copilot,
      contextPacks: report.contextPacks,
      contextQuality: report.contextQuality,
      semanticsDrift: report.semanticsDrift,
      packFreshness: report.packFreshness,
      activeSummaryRefs: report.activeSummaryRefs,
        diagnostics: {
        configParseError: report.configParseError,
        typeErrors: report.typeErrors,
        unknownConfigKeys: report.unknownConfigKeys,
        phaseWarnings: report.phaseWarn,
        runtimeWarnings: report.runtimeWarn,
        reviewWarnings: report.reviewWarn,
        enterpriseWarnings: report.enterpriseWarn,
        capabilityWarnings: report.capabilityWarn,
        investigationWarnings: report.investigationWarn,
        sessionWarnings: report.sessionWarn,
        installWarnings: report.installWarn,
        copilotWarnings: report.copilotWarn,
        contextWarnings: report.contextWarn,
        semanticsWarnings: report.semanticsWarn,
        summaryGapWarning: report.summaryGapWarn,
        specWarnings: report.specWarn,
        planWarnings: report.planWarn,
      },
    };
    if (opts.hints) {
      payload.hints = routineHints;
    }
    console.log(JSON.stringify(payload));
    return;
  }

  printSection('OXE ▸ status');
  const c = useAnsiColors();
  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);

  const wfTgt = oxeWorkflows.resolveWorkflowsDir(target);
  if (!wfTgt) {
    console.log(`  ${yellow}AVISO${reset} Workflows OXE não encontrados — ${cyan}npx oxe-cc@latest${reset}`);
  }

  printOxeHealthDiagnostics(target, c, { skipScanCompactAgeWarnings: Boolean(opts.hints) });

  // IDE readiness summary
  const ideStatusLines = [];
  const _copilotPromptsDir = path.join(target, '.github', 'prompts');
  const _copilotInstructions = path.join(target, '.github', 'copilot-instructions.md');
  ideStatusLines.push(`Copilot ${fs.existsSync(_copilotPromptsDir) || fs.existsSync(_copilotInstructions) ? (c ? green + '✓' + reset : '✓') : (c ? dim + '✗' + reset : '✗')}`);
  ideStatusLines.push(`Cursor ${fs.existsSync(path.join(target, '.cursor', 'commands')) ? (c ? green + '✓' + reset : '✓') : (c ? dim + '✗' + reset : '✗')}`);
  const _claudeLocal = path.join(target, 'commands', 'oxe');
  const _claudeGlobal = path.join(require('os').homedir(), '.claude', 'commands');
  ideStatusLines.push(`Claude Code ${fs.existsSync(_claudeLocal) || fs.existsSync(_claudeGlobal) ? (c ? green + '✓' + reset : '✓') : (c ? dim + '✗' + reset : '✗')}`);
  console.log(`\n  ${c ? dim : ''}IDEs:${c ? reset : ''} ${ideStatusLines.join('  ')}`);

  // Gates pending in default view
  const pendingGateCount = report.pendingGates ? (report.pendingGates.pendingCount || 0) : 0;
  const staleGateCount = report.pendingGates ? (report.pendingGates.staleGateCount || 0) : 0;
  if (pendingGateCount > 0 || staleGateCount > 0) {
    const gateMsg = [];
    if (pendingGateCount > 0) gateMsg.push(`${pendingGateCount} pendente(s)`);
    if (staleGateCount > 0) gateMsg.push(`${staleGateCount} stale`);
    console.log(`  ${c ? yellow : ''}⚠ Gates:${c ? reset : ''} ${gateMsg.join(', ')} — ${c ? cyan : ''}npx oxe-cc runtime gates list --dir .${c ? reset : ''}`);
  }

  // Explicit blockage diagnosis
  const specMissing = !fs.existsSync(path.join(target, '.oxe', 'SPEC.md'));
  const planMissing = !fs.existsSync(path.join(target, '.oxe', 'PLAN.md'));
  const verifyMissing = !fs.existsSync(path.join(target, '.oxe', 'VERIFY.md'));
  if (specMissing) {
    console.log(`  ${c ? yellow : ''}⚠ Bloqueio:${c ? reset : ''} SPEC.md ausente — rode ${c ? cyan : ''}/oxe-spec${c ? reset : ''} antes de planejar`);
  } else if (planMissing) {
    console.log(`  ${c ? yellow : ''}⚠ Bloqueio:${c ? reset : ''} PLAN.md ausente — rode ${c ? cyan : ''}/oxe-plan${c ? reset : ''}`);
  } else if (verifyMissing && !planMissing) {
    console.log(`  ${c ? dim : ''}Obs.:${c ? reset : ''} VERIFY.md ainda não gerado — rode ${c ? cyan : ''}/oxe-verify${c ? reset : ''} após executar`);
  }

  if (opts.hints) {
    console.log(`\n  ${c ? cyan : ''}Lembretes (rotina OXE)${reset}`);
    if (routineHints.length) {
      for (const h of routineHints) {
        console.log(`  ${c ? dim : ''}•${c ? reset : ''} ${h}`);
      }
    } else {
      console.log(`  ${c ? dim : ''}•${c ? reset : ''} Nenhum (ajuste scan_max_age_days / compact_max_age_days em .oxe/config.json se quiser lembretes por idade)${reset}`);
    }
  }

  console.log(`\n  ${c ? yellow : ''}Próximo passo sugerido (único)${reset}`);
  console.log(`  ${c ? dim : ''}Passo:${c ? reset : ''} ${c ? green : ''}${next.step}${reset}`);
  console.log(`  ${c ? dim : ''}No Cursor (referência):${c ? reset : ''} ${c ? cyan : ''}${next.cursorCmd}${reset}`);
  console.log(`  ${c ? dim : ''}Motivo:${c ? reset : ''} ${next.reason}`);

  printSummaryAndNextSteps(c, {
    bullets: [
      `Saúde lógica: ${report.healthStatus}`,
      `Artefatos em jogo: ${next.artifacts.join(', ')}`,
    ],
    nextSteps: [
      { desc: 'Diagnóstico completo (inclui pacote de workflows):', cmd: 'npx oxe-cc doctor' },
      { desc: 'Ação sugerida no agente:', cmd: next.cursorCmd },
    ],
    dryRun: false,
  });
  console.log(`  ${c ? green : ''}✓${c ? reset : ''} status concluído.\n`);
}

/** @param {string} target */
function runDoctor(target) {
  printSection('OXE ▸ doctor');
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0], 10);
  const minNode = readMinNode();
  const c = useAnsiColors();
  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
  console.log(`  Node.js ${v} (mínimo exigido pelo pacote: ${minNode})`);
  if (major < minNode) {
    console.log(`${red}FALHA${reset} Versão do Node abaixo do exigido em engines do pacote`);
    process.exit(1);
  }
  console.log(`${green}OK${reset} Node.js`);

  const wfPkg = path.join(PKG_ROOT, 'oxe', 'workflows');
  const wfTgt = oxeWorkflows.resolveWorkflowsDir(target);
  if (!fs.existsSync(wfPkg)) {
    console.log(`${red}FALHA${reset} Workflows do pacote npm ausentes: ${wfPkg}`);
    process.exit(1);
  }
  const expected = fs
    .readdirSync(wfPkg)
    .filter((f) => f.endsWith('.md'))
    .sort();

  if (!wfTgt) {
    console.log(
      `${yellow}AVISO${reset} Não há oxe/workflows/ nem .oxe/workflows/ neste projeto — rode ${cyan}npx oxe-cc@latest${reset} para instalar.`
    );
    process.exit(1);
  }

  const actual = fs
    .readdirSync(wfTgt)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const missing = expected.filter((f) => !actual.includes(f));
  const extra = actual.filter((f) => !expected.includes(f));

  if (missing.length) {
    console.log(`${red}FALHA${reset} Faltam workflows em relação ao pacote: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (extra.length) {
    console.log(
      `${dim}Obs.:${reset} Há workflows extras no projeto (ok em forks): ${extra.join(', ')}`
    );
  }
  const wfLabel = wfTgt.includes(`${path.sep}.oxe${path.sep}`) ? '.oxe/workflows' : 'oxe/workflows';
  console.log(`${green}OK${reset} ${wfLabel} contém os ${expected.length} arquivos esperados do pacote`);

  const shape = oxeWorkflows.validateWorkflowShapes(wfTgt);
  if (shape.warnings.length) {
    for (const w of shape.warnings) {
      console.log(`${yellow}Obs. (workflow):${reset} ${w.message}`);
    }
  }

  // Verificar workflows sem contrato no registry de semântica
  const allContractSlugs = new Set(oxeRuntimeSemantics.getAllWorkflowContracts().map((ct) => ct.workflow_slug));
  const workflowMdFiles = fs.readdirSync(wfTgt).filter((f) => f.endsWith('.md'));
  const orphanedWorkflows = workflowMdFiles
    .map((f) => f.replace(/\.md$/, ''))
    .filter((slug) => !allContractSlugs.has(slug));
  if (orphanedWorkflows.length) {
    for (const slug of orphanedWorkflows) {
      console.log(`${yellow}AVISO${reset} Workflow sem contrato semântico no registry: ${slug}.md — adicione em workflow-runtime-contracts.json ou rode \`npx oxe-cc update\`.`);
    }
  } else {
    console.log(`${green}OK${reset} Todos os workflows têm contrato semântico registado`);
  }

  const oxeState = path.join(target, '.oxe', 'STATE.md');
  if (fs.existsSync(oxeState)) console.log(`${green}OK${reset} .oxe/STATE.md encontrado`);
  else {
    console.log(
      `${dim}Obs.:${reset} .oxe/STATE.md ausente — rode ${cyan}oxe-cc init-oxe${reset} ou instale sem ${cyan}--no-init-oxe${reset}`
    );
  }

  const cfgPath = path.join(target, '.oxe', 'config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      console.log(`${green}OK${reset} .oxe/config.json (JSON válido)`);
    } catch (e) {
      console.log(`${red}FALHA${reset} .oxe/config.json com JSON inválido: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log(`${dim}Obs.:${reset} .oxe/config.json ausente (opcional — ver oxe/templates/CONFIG.md)`);
  }

  const cbDir = path.join(target, '.oxe', 'codebase');
  const expectedMaps = [
    'OVERVIEW.md',
    'STACK.md',
    'STRUCTURE.md',
    'TESTING.md',
    'INTEGRATIONS.md',
    'CONVENTIONS.md',
    'CONCERNS.md',
  ];
  if (fs.existsSync(cbDir)) {
    const missingMaps = expectedMaps.filter((f) => !fs.existsSync(path.join(cbDir, f)));
    if (missingMaps.length) {
      console.log(
        `${yellow}Obs.:${reset} Mapa do codebase incompleto — faltam em .oxe/codebase/: ${missingMaps.join(', ')} (rode ${cyan}/oxe-scan${reset})`
      );
    } else {
      console.log(`${green}OK${reset} .oxe/codebase/ com os ${expectedMaps.length} mapas esperados`);
    }
  }

  // IDE health gates
  console.log('');
  const ideChecks = [];
  const copilotPromptsDir = path.join(target, '.github', 'prompts');
  const copilotInstructions = path.join(target, '.github', 'copilot-instructions.md');
  const copilotReady = fs.existsSync(copilotPromptsDir) || fs.existsSync(copilotInstructions);
  ideChecks.push({ label: 'Copilot', ready: copilotReady, hint: '.github/prompts/ ou copilot-instructions.md' });

  const cursorDir = path.join(target, '.cursor', 'commands');
  const cursorReady = fs.existsSync(cursorDir);
  ideChecks.push({ label: 'Cursor', ready: cursorReady, hint: '.cursor/commands/' });

  const claudeLocalDir = path.join(target, 'commands', 'oxe');
  const claudeGlobalDir = path.join(require('os').homedir(), '.claude', 'commands');
  const claudeReady = fs.existsSync(claudeLocalDir) || fs.existsSync(claudeGlobalDir);
  ideChecks.push({ label: 'Claude Code', ready: claudeReady, hint: 'commands/oxe/ ou ~/.claude/commands/' });

  for (const ide of ideChecks) {
    if (ide.ready) {
      console.log(`${c ? green : ''}OK${c ? reset : ''} ${ide.label} pronto (${ide.hint})`);
    } else {
      console.log(`${c ? dim : ''}Obs.:${c ? reset : ''} ${ide.label} não detectado — esperado ${ide.hint}`);
    }
  }

  // Runtime compilation check
  const runtimeCompiledPath = path.join(target, 'lib', 'runtime', 'index.js');
  const runtimeDistPath = path.join(target, 'packages', 'runtime', 'dist-tests');
  const runtimeCompiled = fs.existsSync(runtimeCompiledPath) || fs.existsSync(runtimeDistPath);
  if (runtimeCompiled) {
    console.log(`${c ? green : ''}OK${c ? reset : ''} Runtime compilado detectado — modo enterprise disponível`);
  } else {
    console.log(`${c ? dim : ''}Obs.:${c ? reset : ''} Runtime não compilado — operando em modo legado (sem perda de UX)`);
  }

  // Readiness gate summary
  const stateFilePath = path.join(target, '.oxe', 'STATE.md');
  let readinessCmd = '/oxe-scan';
  let readinessDesc = 'Nenhum STATE.md encontrado';
  if (fs.existsSync(stateFilePath)) {
    try {
      const stateContent = fs.readFileSync(stateFilePath, 'utf8');
      const phaseMatch = stateContent.match(/fase[:\s]+([a-z_]+)/i) || stateContent.match(/phase[:\s]+([a-z_]+)/i) || stateContent.match(/status[:\s]+([a-z_]+)/i);
      const phase = phaseMatch ? phaseMatch[1].toLowerCase() : 'init';
      const phaseMap = {
        init: { cmd: '/oxe-scan', desc: 'Pronto para /oxe-scan' },
        scan_complete: { cmd: '/oxe-spec', desc: 'Pronto para /oxe-spec' },
        spec_complete: { cmd: '/oxe-plan', desc: 'Pronto para /oxe-plan' },
        plan_complete: { cmd: '/oxe-execute', desc: 'Pronto para /oxe-execute' },
        execute_complete: { cmd: '/oxe-verify', desc: 'Pronto para /oxe-verify' },
        verify_complete: { cmd: 'runtime promote --target pr_draft', desc: 'Pronto para promoção' },
      };
      const next = phaseMap[phase] || { cmd: '/oxe', desc: `Fase detectada: ${phase}` };
      readinessCmd = next.cmd;
      readinessDesc = next.desc;
    } catch (_) { /* ignore */ }
  }
  const specPath = path.join(target, '.oxe', 'SPEC.md');
  const specExists = fs.existsSync(specPath);
  console.log('');
  if (specExists) {
    console.log(`  ${c ? green : ''}✓ ${readinessDesc}${c ? reset : ''} — próximo: ${c ? cyan : ''}${readinessCmd}${c ? reset : ''}`);
  } else {
    console.log(`  ${c ? yellow : ''}⚠ Falta SPEC — rode ${c ? cyan : ''}${readinessCmd}${c ? reset : ''}`);
  }

  printOxeHealthDiagnostics(target, c);
  const report = oxeHealth.buildHealthReport(target);
  const statusColor = report.healthStatus === 'healthy' ? green : report.healthStatus === 'warning' ? yellow : red;
  console.log(`\n  ${statusColor}Diagnóstico ${report.healthStatus}${reset}`);
  if (report.healthStatus === 'broken') {
    process.exitCode = 1;
  }
  const ideReadySummary = ideChecks.filter((i) => i.ready).map((i) => i.label).join(', ') || 'nenhuma IDE detectada';
  printSummaryAndNextSteps(c, {
    bullets: [
      `Projeto em ${target}`,
      `Workflows conferidos em ${wfLabel}`,
      `IDEs prontas: ${ideReadySummary}`,
      `Saúde lógica: ${report.healthStatus}`,
    ],
    nextSteps: [
      { desc: 'Mapear ou atualizar o codebase no agente:', cmd: '/oxe-scan' },
      { desc: 'Ver ajuda e ordem dos passos OXE:', cmd: '/oxe-help' },
      { desc: 'Reinstalar ou atualizar arquivos do OXE:', cmd: 'npx oxe-cc@latest --force' },
    ],
    dryRun: false,
  });
}

/**
 * npm install -g oxe-cc@version (same version as this running CLI).
 * @returns {boolean}
 */
function installGlobalCliPackage() {
  const name = readPkgName();
  const ver = readPkgVersion();
  const spec = `${name}@${ver}`;
  const c = useAnsiColors();
  const dimOrEmpty = c ? dim : '';
  const resetOrEmpty = c ? reset : '';
  console.log(`\n  ${dimOrEmpty}npm install -g ${spec}${resetOrEmpty}\n`);
  const r = spawnSync('npm', ['install', '-g', spec], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (r.status === 0) {
    console.log(
      `\n  ${c ? green : ''}✓${c ? reset : ''} ${c ? cyan : ''}oxe-cc${c ? reset : ''} disponível globalmente (execute ${c ? cyan : ''}oxe-cc --help${c ? reset : ''} em qualquer pasta).\n`
    );
    return true;
  }
  console.log(
    `\n  ${c ? yellow : ''}⚠${c ? reset : ''} npm install -g falhou. Tente manualmente: ${c ? cyan : ''}npm install -g ${spec}${c ? reset : ''}\n`
  );
  return false;
}

/**
 * `npm uninstall -g oxe-cc` com a mesma semântica cross-platform do instalador.
 * @returns {boolean}
 */
function uninstallGlobalCliPackage() {
  const name = readPkgName();
  const c = useAnsiColors();
  const dimOrEmpty = c ? dim : '';
  const resetOrEmpty = c ? reset : '';
  console.log(`\n  ${dimOrEmpty}npm uninstall -g ${name}${resetOrEmpty}\n`);
  const r = spawnSync('npm', ['uninstall', '-g', name], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (r.status === 0) {
    console.log(
      `\n  ${c ? green : ''}✓${c ? reset : ''} pacote global ${c ? cyan : ''}${name}${c ? reset : ''} removido do npm global.\n`
    );
    return true;
  }
  console.log(
    `\n  ${c ? yellow : ''}⚠${c ? reset : ''} npm uninstall -g falhou. Remova manualmente: ${c ? cyan : ''}npm uninstall -g ${name}${c ? reset : ''}\n`
  );
  return false;
}

/**
 * Best-effort: detecta se esta execução vem de uma instalação global do npm.
 * Usa `npm root -g` para evitar confundir execução local do repositório com pacote global.
 * @returns {boolean}
 */
function isRunningFromGlobalNpmInstall() {
  try {
    const r = spawnSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      shell: true,
      env: process.env,
    });
    if (r.status !== 0) return false;
    const root = String(r.stdout || '').trim();
    if (!root) return false;
    const rel = path.relative(path.resolve(root), PKG_ROOT);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/** @returns {string[]} */
function updateForwardedInstallFlags() {
  return [
    '--cursor',
    '--copilot',
    '--copilot-vscode',
    '--copilot-cli',
    '--all-agents',
    '--opencode',
    '--gemini',
    '--codex',
    '--windsurf',
    '--antigravity',
    '--vscode',
    '--no-commands',
    '--no-agents',
    '--no-init-oxe',
    '--oxe-only',
    '--global',
    '--local',
    '--ide-global',
    '--ide-local',
    '--global-cli',
    '-g',
    '--no-global-cli',
    '-l',
    '--no-install-config',
    '--force',
    '-f',
    '--all',
    '-a',
    '--config-dir',
    '-c',
  ];
}

/**
 * @param {string[]} rest
 * @returns {boolean}
 */
function updateArgsExplicitlyControlGlobalCli(rest) {
  return rest.includes('--global-cli') || rest.includes('-g') || rest.includes('--no-global-cli') || rest.includes('-l');
}

/**
 * After copying OXE into the project: optionally install the CLI globally (pergunta interativa ou flags).
 * @param {InstallOpts} opts
 * @returns {Promise<void>}
 */
function maybePromptGlobalCli(opts) {
  if (opts.oxeOnly) return Promise.resolve();
  if (opts.dryRun) {
    if (useAnsiColors()) console.log(`${dim}  (dry-run — pergunta do CLI global ignorada neste modo)${reset}`);
    return Promise.resolve();
  }
  if (opts.globalCli) {
    installGlobalCliPackage();
    return Promise.resolve();
  }
  if (opts.noGlobalCli) return Promise.resolve();
  if (process.env.OXE_NO_PROMPT === '1' || process.env.OXE_NO_PROMPT === 'true') return Promise.resolve();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const c = useAnsiColors();
    if (c) {
      console.log(
        `\n  ${yellow}Terminal não interativo${reset} — sem pergunta de CLI global. Use ${cyan}npx oxe-cc@latest${reset} ou ${cyan}--global-cli${reset}.\n`
      );
    } else {
      console.log(
        '\nTerminal não interativo — pergunta do CLI global ignorada. Use npx oxe-cc@latest ou --global-cli.\n'
      );
    }
    return Promise.resolve();
  }

  const c = useAnsiColors();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const colW = 42;
  const row = (cmd, desc) => {
    const pad = ' '.repeat(Math.max(1, colW - cmd.length));
    console.log(`  ${c ? dim : ''}${cmd}${c ? reset : ''}${pad}${desc}`);
  };

  console.log(
    `  ${c ? yellow : ''}Instalar o comando oxe-cc globalmente?${c ? reset : ''}
  (Os ficheiros OXE já foram copiados para o projeto.)

  O ${c ? cyan : ''}oxe-cc${c ? reset : ''} na linha de comandos permite validar e atualizar sem depender só do npx:

`
  );
  row('npx oxe-cc doctor', 'Validar workflows, config e mapa de scan');
  row('npx oxe-cc status', 'Estado .oxe/ e um próximo passo sugerido');
  row(`npx oxe-cc@latest --force`, 'Reinstalar/atualizar workflows no projeto');
  console.log(`
  ${c ? cyan : ''}1${c ? reset : ''}) ${c ? dim : ''}Não — uso ${c ? reset : ''}${c ? cyan : ''}npx oxe-cc@latest${c ? reset : ''}${c ? dim : ''} (recomendado em CI)${c ? reset : ''}
  ${c ? cyan : ''}2${c ? reset : ''}) ${c ? dim : ''}Sim — ${c ? reset : ''}${c ? cyan : ''}npm install -g ${readPkgName()}@${readPkgVersion()}${c ? reset : ''}${c ? dim : ''} (${c ? reset : ''}${c ? cyan : ''}oxe-cc${c ? reset : ''}${c ? dim : ''} no PATH)${c ? reset : ''}
`
  );

  return new Promise((resolve) => {
    rl.question(`  ${c ? dim : ''}Escolha${c ? reset : ''} ${c ? dim : ''}[1]${c ? reset : ''}: `, (answer) => {
      rl.close();
      const choice = (answer || '1').trim();
      if (choice === '2') installGlobalCliPackage();
      else {
        console.log(
          `\n  ${c ? green : ''}✓${c ? reset : ''} Para atualizar workflows: ${c ? cyan : ''}npx oxe-cc@latest --force${c ? reset : ''} ou ${c ? cyan : ''}npx oxe-cc update${c ? reset : ''} na raiz do projeto.\n`
        );
      }
      resolve();
    });
  });
}

function usage() {
  console.log(`
${cyan}oxe-cc${reset} — instala workflows OXE (núcleo .oxe/ + integrações: Cursor, Copilot, Claude, OpenCode, Gemini, Codex, Windsurf, Antigravity, …)

${green}Uso:${reset}
  npx oxe-cc@latest [opções] [pasta-do-projeto]
  npx oxe-cc@latest install [opções] [pasta-do-projeto]   ${dim}(equivalente à instalação predefinida)${reset}
  npx oxe-cc@latest --dir /caminho/do/projeto
  npx oxe-cc doctor [opções] [pasta-do-projeto]
  npx oxe-cc status [opções] [pasta-do-projeto]
  npx oxe-cc init-oxe [opções] [pasta-do-projeto]
  npx oxe-cc context <build|inspect> [opções] [pasta-do-projeto]
  npx oxe-cc dashboard [opções] [pasta-do-projeto]
  npx oxe-cc runtime <status|start|pause|resume|replay|compile|verify|project|ci|promote|recover|gates> [opções] [pasta-do-projeto]
  npx oxe-cc azure <status|doctor|auth|sync|find|servicebus|eventgrid|sql|operations> [opções] [pasta-do-projeto]
  npx oxe-cc capabilities <list|install|remove|update> [opções] [id]
  npx oxe-cc uninstall [opções] [pasta-do-projeto]
  npx oxe-cc update [opções] [argumentos extras…]

${green}uninstall${reset} (remove OXE da pasta do usuário + pastas de workflows no repo)
  --cursor / --copilot / --copilot-cli   só essa integração (omissão = todas)
  --copilot-vscode                       alias explícito de --copilot
  --copilot-legacy-clean                 limpa só o legado antigo do Copilot VS Code em ~/.copilot/
  --all-agents                           também remove ficheiros multi-plataforma (com --copilot-cli implícito)
  --opencode / --gemini / --codex / --windsurf / --antigravity
                                         remove só esse agente multi-runtime
  --ide-local                            remove integrações IDE neste repositório (.cursor, .github, .claude, .copilot, …)
  --ide-only                             não apagar .oxe/workflows, oxe/, etc. no projeto
  --global-cli, -g                       também executa npm uninstall -g oxe-cc
  --config-dir <caminho>                 com exatamente uma flag IDE acima (não combina com --ide-local, --copilot nem agentes granulares)
  --dry-run
  --dir <pasta>                          raiz do projeto (padrão: diretório atual)

${green}update${reset} (executa npx oxe-cc@latest --force na pasta do projeto)
  --check                                só consulta npm: compara versão em execução com latest (saída 0=ok, 1=há mais nova, 2=erro; incompatível com --dry-run)
  --if-newer                             só executa o npx se existir versão mais nova no npm (falha de rede/registry: saída 2, sem npx)
  --dir <pasta>                          pasta em que o npx roda (padrão: atual; ignorada com --check)
  --dry-run                              mostra o comando sem executar
  [argumentos extras…]                   repassados ao oxe-cc (ex.: --cursor --global, --ide-local, --global-cli)
  ${dim}CI / sem rede:${reset} OXE_UPDATE_SKIP_REGISTRY=1 desativa consultas (--check sai 2; --if-newer sai 2 sem npx)

${green}dashboard${reset} (interface web local para revisão e aprovação do plano)
  --port <número>                        porta local (padrão: 4173)
  --no-open                              não abre o browser automaticamente
  --session <sessions/sNNN-slug>         força visualização de uma sessão específica
  --dump-context                         imprime JSON consolidado e sai
  --dir <pasta>                          raiz do projeto (padrão: diretório atual)

${green}context${reset} (Context Engine V2: seleção, compressão e inspeção determinística)
  build [--workflow <slug>]              gera pack(s) em .oxe/context/packs/
  inspect [--workflow <slug>]            lê um pack existente ou resolve sob demanda
  --workflow <slug>                      workflow alvo (omissão: build=todos; inspect=dashboard)
  --tier <minimal|standard|full>         tier de contexto (padrão: standard)
  --session <sessions/sNNN-slug>         força sessão específica
  --json                                 saída estruturada em JSON
  --dir <pasta>                          raiz do projeto (padrão: diretório atual)

${green}runtime${reset} (controle operacional explícito do ACTIVE-RUN)
  status                                 mostra o run ativo resolvido para a sessão atual
  start                                  cria um novo run com tracing inicial
  pause                                  pausa o run ativo e preserva o cursor
  resume                                 retoma o run ativo
  replay                                 marca replay parcial por onda ou tarefa
  compile                                compila PLAN/SPEC em ExecutionGraph formal + verification suite
  verify                                 executa a suite enterprise, coleta evidência e projeta VERIFY.md
  project                                projeta markdowns derivados do estado canônico
  ci                                     executa checks do runtime e persiste o resultado na run
  promote                                promove remotamente a run ativa (estável: pr_draft)
  recover                                reidrata estado canônico/journal/gates/policy da run ativa
  gates <list|show|resolve>              fila operacional de gates pendentes e resoluções auditáveis
  --session <sessions/sNNN-slug>         força sessão específica
  --wave <número>                        fixa onda atual/cursor
  --task <Tn>                            fixa tarefa atual/cursor
  --mode <complete|wave|task>            modo operacional do cursor
  --reason <texto>                       motivo explícito da transição
  --run <run_id>                         (replay|ci) filtra um run específico
  --from <event_id>                      (replay) começa em um event_id específico
  --write                                (replay) gera REPLAY-SESSION.md
  --gate <gate_id>                       (gates show|resolve) gate alvo
  --decision <approve|reject|waive>      (gates resolve) decisão aplicada
  --actor <id>                           (gates resolve) ator responsável
  --target <pr_draft|branch_push>        (promote) alvo remoto; padrão pr_draft, branch_push é avançado
  --remote <nome>                        (promote) remote git; padrão origin
  --base <branch>                        (promote) branch/ref base; padrão main
  --minimum-coverage <0-100>             (promote) cobertura mínima exigida; padrão 100
  --timeout <ms>                         (verify) timeout por check
  --dir <pasta>                          raiz do projeto (padrão: diretório atual)

${green}azure${reset} (provider Azure nativo via Azure CLI no Windows)
  status                                 estado compacto: CLI, login, subscription, inventário, pendências
  doctor                                 valida Azure CLI, login, subscription e inventário
  auth login [--tenant <id>]             login interativo via Azure CLI (Entra ID: use --tenant <tenant-id>)
  auth whoami                            mostra identidade, tenant, subscription e cloud
  auth set-subscription --subscription <id|nome>
                                         fixa a subscription operacional do projeto
  Fluxo corporativo: auth login --tenant <tenant-id> → auth set-subscription --subscription <dev-sub-id>
  sync                                   sincroniza inventário via Azure Resource Graph
  sync --diff                            sincroniza e mostra recursos adicionados/removidos
  find <texto>                           busca recursos no inventário local materializado
  find <texto> --type <tipo>             filtra por tipo de serviço (ex.: servicebus, eventgrid, sql)
  find <texto> --filter-rg <rg>          filtra por resource group
  servicebus <list|show|plan|apply>      namespace, queue, topic, subscription
  eventgrid <list|show|plan|apply>       topic, system-topic, event-subscription
  sql <list|show|plan|apply>             server, database, firewall-rule
  operations list                        histórico de operações planejadas/aplicadas/pendentes
  --kind <tipo>                          ex.: namespace, queue, topic, system-topic, database
  --resource-group <rg>                  resource group alvo
  --name <nome>                          nome principal do recurso
  --namespace <nome>                     namespace Service Bus
  --topic-name <nome>                    topic Service Bus
  --subscription-name <nome>             subscription de topic Service Bus
  --source-resource-id <id>              origem de event subscription
  --endpoint <url|id>                    endpoint de Event Grid
  --server <nome> / --database <nome>    recursos Azure SQL
  --location <região>                    localização alvo
  --admin-user <user>                    admin do SQL server (plan/apply)
  --admin-password-env <ENV>             variável de ambiente com password do SQL admin
  --start-ip-address / --end-ip-address  faixa de firewall rule para Azure SQL
  --approve                              aplica mutação já planejada após checkpoint formal
  --dry-run                              pré-visualiza comando sem executar nem criar artefatos
  --diff                                 (sync) exibe diff de recursos adicionados/removidos
  --type <tipo>                          (find) filtra por família de serviço
  --filter-rg <rg>                       (find) filtra por resource group
  --tenant <id>                          (auth login) tenant Entra ID para contas corporativas
  --vpn-confirmed                        confirma conexão VPN quando vpn_required está configurado
  --override-policy                      override explícito para policy deny_unless_overridden
  --session <sessions/sNNN-slug>         associa a operação ao runtime da sessão ativa
  --dir <pasta>                          raiz do projeto (padrão: diretório atual)

${green}Opções da instalação:${reset}
  --cursor       Copia comandos e regras para ~/.cursor (padrão com --all)
  --copilot      Instala GitHub Copilot VS Code no workspace: .github/copilot-instructions.md + .github/prompts/
  --copilot-vscode  Alias explícito de --copilot
  --copilot-cli  Skills em ~/.copilot/skills (/oxe, /oxe-scan, …) + cópia legado em ~/.claude/commands e ~/.copilot/commands
                   (subconjunto de --all-agents)
  --all-agents   Cursor+Copilot + CLIs + OpenCode, Gemini (TOML), Codex, Windsurf, Antigravity
  --opencode / --gemini / --codex / --windsurf / --antigravity   só esse agente (sem os outros)
  --ide-global   Instalar integrações IDE nas pastas do utilizador (~/.cursor, …) — predefinido
  --ide-local    Instalar integrações IDE locais quando suportado (.cursor, .claude, .copilot CLI, …); Copilot VS Code continua em .github/
  --vscode       Também copia .vscode/settings.json (chat.promptFiles)
  --all, -a      Cursor + Copilot (padrão se não passar --cursor nem --copilot)
  --no-commands  Não copia commands/oxe
  --no-agents    Não copia AGENTS.md
  --no-init-oxe  Não cria .oxe/STATE.md + .oxe/codebase/ após copiar workflows
  --oxe-only     Só .oxe/workflows e templates (sem integrações IDE/CLI, commands, AGENTS.md)
  --global       Layout do ${dim}repositório${reset}: pasta oxe/ na raiz + .oxe/ ${dim}(não confundir com --ide-global)${reset}
  --local        Layout do ${dim}repositório${reset}: só .oxe/workflows ${dim}(não confundir com --ide-local)${reset}
  --global-cli, -g   Depois da cópia: npm install -g oxe-cc@<versão> (sem pergunta)
  --no-global-cli, -l  Não pergunta pelo CLI global (recomendado em CI)
  --force, -f    Sobrescreve arquivos existentes
  --dry-run      Lista ações sem gravar
  --config-dir, -c <pasta>  Só com exatamente um de --cursor ou --copilot-cli (não use com --copilot nem --all-agents)
  --no-install-config  Ignora o bloco install em .oxe/config.json (só integração/layout vindos das flags ou do menu)
  --dir <pasta>   Pasta de destino (padrão: diretório atual)
  -h, --help
  -v, --version

${green}doctor${reset} (valida estrutura OXE, config e saúde do projeto)
  --dir <pasta>   raiz do projeto (padrão: diretório atual)

${green}init-oxe${reset} (bootstrap só de .oxe/ no projeto — STATE.md, codebase/, templates)
  --dir <pasta>   raiz do projeto (padrão: diretório atual)
  --force, -f     sobrescreve arquivos existentes

${green}status${reset} (coerência .oxe/ + um próximo passo sugerido; não exige pacote de workflows completo)
  --dir <pasta>   raiz do projeto (padrão: diretório atual)
  --json          imprime um único objeto JSON (próximo passo + diagnósticos) em stdout; adequado a CI
  --hints         lembretes de rotina (idade scan/compact quando configurado em config.json); com --json inclui array \`hints\`

${green}capabilities${reset} (catálogo nativo de extensões do projeto)
  list                               lista capabilities instaladas em .oxe/capabilities/
  install <id>                       cria capability local a partir do template nativo
  remove <id>                        remove capability do catálogo local
  update                             regera .oxe/CAPABILITIES.md a partir dos manifestos locais
  --dir <pasta>                      raiz do projeto (padrão: diretório atual)

${green}Atualizar (projeto já tem OXE):${reset}
  /oxe-update                            no Cursor (outras IDEs: mesmo fluxo pelo terminal)
  npx oxe-cc update --check              só ver se há versão nova no npm
  npx oxe-cc update
  npx oxe-cc@latest --force
  npm install -g oxe-cc@latest && oxe-cc --force
  npx clear-npx-cache                # se o npx ficar preso em tarball antigo (npm 7+)

${green}Exemplos:${reset}
  npx oxe-cc@latest
  npx oxe-cc@latest ./meu-app
  npx oxe-cc@latest --cursor --dry-run
  npx oxe-cc@latest --copilot --copilot-cli
  npx oxe-cc@latest --all-agents
  npx oxe-cc@latest --cursor --ide-local
  npx oxe-cc doctor
  npx oxe-cc init-oxe --dir ./meu-app
  npx oxe-cc uninstall --dir .
`);
}

function runInstall(opts) {
  const target = opts.dir;
  if (!opts.dryRun && !fs.existsSync(target)) {
    console.error(`${yellow}Diretório não encontrado: ${target}${reset}`);
    process.exit(1);
  }

  assertNotWslWindowsNode();
  const home = os.homedir();
  const prevManifest = oxeManifest.loadFileManifest(home);
  oxeManifest.backupModifiedFromManifest(home, prevManifest, opts, { yellow, cyan, dim, reset });

  printSection('OXE ▸ Instalação no projeto');
  const c = useAnsiColors();
  const fullLayout = useFullRepoLayout(opts);
  const idePathRewrite = !fullLayout;

  console.log(`  ${c ? green : ''}Destino:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
  if (opts.dryRun) console.log(`  ${c ? yellow : ''}(dry-run)${c ? reset : ''}`);

  if (fullLayout) {
    console.log(
      `  ${c ? dim : ''}Layout repo:${c ? reset : ''} ${c ? yellow : ''}oxe/${c ? reset : ''} na raiz + ${c ? yellow : ''}.oxe/${c ? reset : ''}`
    );
  } else {
    console.log(
      `  ${c ? dim : ''}Layout repo:${c ? reset : ''} ${c ? yellow : ''}só .oxe/${c ? reset : ''} ${c ? dim : ''}(${c ? cyan : ''}.oxe/workflows${c ? dim : ''})${c ? reset : ''}`
    );
  }
  const ideAny = anyIdeIntegration(opts);
  if (ideAny) {
    const scopeParts = [];
    if (opts.cursor) {
      scopeParts.push(opts.ideLocal ? '.cursor no repositório' : '~/.cursor');
    }
    if (opts.copilot) {
      scopeParts.push('.github/ no repositório (Copilot VS Code)');
    }
    if (opts.copilotCli || opts.allAgents) {
      scopeParts.push(opts.ideLocal ? '.copilot/.claude no repositório (CLI)' : '~/.copilot + ~/.claude (CLI)');
    }
    const extra = opts.allAgents
      ? `${c ? dim : ''} + OpenCode, Gemini, Codex, Windsurf, Antigravity${c ? reset : ''}`
      : anyGranularAgent(opts)
        ? `${c ? dim : ''} + agentes selecionados${c ? reset : ''}`
        : '';
    console.log(`  ${c ? dim : ''}Integrações IDE:${c ? reset : ''} ${scopeParts.join('; ')}${extra}`);
  }

  const copyOpts = { dryRun: opts.dryRun, force: opts.force };
  const agentPaths = oxeAgentInstall.buildAgentInstallPaths(!opts.ideLocal, target);

  if (fullLayout) {
    copyDir(path.join(PKG_ROOT, 'oxe'), path.join(target, 'oxe'), copyOpts, false);
  } else {
    const nested = path.join(target, '.oxe');
    copyDir(path.join(PKG_ROOT, 'oxe', 'workflows'), path.join(nested, 'workflows'), copyOpts, true);
    copyDir(path.join(PKG_ROOT, 'oxe', 'templates'), path.join(nested, 'templates'), copyOpts, true);
    // Personas: copiar para .oxe/personas/ (não sobrescreve personalizações do projeto)
    const personasSrc = path.join(PKG_ROOT, 'oxe', 'personas');
    if (fs.existsSync(personasSrc)) {
      copyDir(personasSrc, path.join(nested, 'personas'), copyOpts, false);
    }
    // Schemas: copiar para .oxe/schemas/ (ex.: plan-agents.schema.json para validação local)
    const schemasSrc = path.join(PKG_ROOT, 'oxe', 'schemas');
    if (fs.existsSync(schemasSrc)) {
      copyDir(schemasSrc, path.join(nested, 'schemas'), copyOpts, false);
    }
  }

  const cursorBase = installCursorBase(opts);
  if (opts.cursor) {
    const cCmd = path.join(PKG_ROOT, '.cursor', 'commands');
    const cRules = path.join(PKG_ROOT, '.cursor', 'rules');
    if (fs.existsSync(cCmd)) copyDir(cCmd, path.join(cursorBase, 'commands'), copyOpts, idePathRewrite);
    if (fs.existsSync(cRules)) copyDir(cRules, path.join(cursorBase, 'rules'), copyOpts, idePathRewrite);
  }

  const doAgentClis = opts.copilotCli || opts.allAgents;
  if (doAgentClis) {
    const cCmd = path.join(PKG_ROOT, '.cursor', 'commands');
    const clBase = installClaudeBase(opts);
    const cpHome = installCopilotCliHome(opts);
    const clDest = path.join(clBase, 'commands');
    const cpCmdDest = path.join(cpHome, 'commands');
    const cpSkills = path.join(cpHome, 'skills');
    if (fs.existsSync(cCmd)) {
      console.log(
        `  ${c ? green : ''}cli${c ? reset : ''}   ${c ? dim : ''}Claude/Copilot: skills em${c ? reset : ''} ${c ? cyan : ''}${cpSkills}${c ? reset : ''} ${c ? dim : ''}(/oxe, /oxe-scan, …); comandos .md:${c ? reset : ''} ${c ? cyan : ''}${clDest}${c ? reset : ''} ${c ? dim : ''}+${c ? reset : ''} ${c ? cyan : ''}${cpCmdDest}${c ? reset : ''}`
      );
      installOxeCopilotCliSkills(cCmd, cpHome, copyOpts, idePathRewrite);
      copyDir(cCmd, clDest, copyOpts, idePathRewrite);
      copyDir(cCmd, cpCmdDest, copyOpts, idePathRewrite);
    } else {
      console.warn(`${yellow}aviso:${reset} pasta ausente ${cCmd} — ignorando comandos CLI`);
    }
  }

  const cCmdAgents = path.join(PKG_ROOT, '.cursor', 'commands');
  if (fs.existsSync(cCmdAgents) && (opts.allAgents || anyGranularAgent(opts))) {
    const logO = (d) => console.log(`${dim}omitido${reset} ${d} (já existe — use --force)`);
    const logW = (msg) => console.log(`${dim}agents${reset}  ${msg}`);
    console.log(
      `  ${c ? green : ''}agents${c ? reset : ''}  ${c ? dim : ''}OpenCode, Gemini (TOML), Windsurf, Codex (prompts + skills), Antigravity (conforme seleção)${c ? reset : ''}`
    );
    if (opts.agentOpenCode || opts.allAgents) {
      oxeAgentInstall.installOpenCodeCommands(cCmdAgents, agentPaths, copyOpts, idePathRewrite, logO, logW);
    }
    if (opts.agentGemini || opts.allAgents) {
      oxeAgentInstall.installGeminiTomlCommands(cCmdAgents, agentPaths, copyOpts, idePathRewrite, logO, logW);
    }
    if (opts.agentWindsurf || opts.allAgents) {
      oxeAgentInstall.installWindsurfGlobalWorkflows(cCmdAgents, agentPaths, copyOpts, idePathRewrite, logO, logW);
    }
    if (opts.agentCodex || opts.allAgents) {
      oxeAgentInstall.installCodexPrompts(cCmdAgents, agentPaths, copyOpts, idePathRewrite, logO, logW);
    }
    if (opts.agentAntigravity || opts.allAgents) {
      oxeAgentInstall.installSkillTreeFromCursorCommands(
        cCmdAgents,
        agentPaths.antigravitySkillsRoot,
        copyOpts,
        idePathRewrite,
        logO,
        logW
      );
    }
    if (opts.agentCodex || opts.allAgents) {
      oxeAgentInstall.installSkillTreeFromCursorCommands(
        cCmdAgents,
        agentPaths.codexAgentsSkillsRoot,
        copyOpts,
        idePathRewrite,
        logO,
        logW
      );
    }
  }

  if (opts.copilot) {
    const gh = path.join(PKG_ROOT, '.github');
    const inst = path.join(gh, 'copilot-instructions.md');
    const prompts = path.join(gh, 'prompts');
    if (fs.existsSync(inst)) {
      installMergedCopilotInstructions(inst, copilotInstructionsPath(opts), copyOpts, idePathRewrite);
    }
    if (fs.existsSync(prompts)) {
      copyDir(prompts, copilotPromptsDirPath(opts), copyOpts, idePathRewrite);
    }
    if (!opts.dryRun) {
      writeCopilotVsCodeManifest(opts, { layout: fullLayout ? 'classic' : 'nested' });
    }
  }

  if (opts.vscode && fullLayout) {
    const vs = path.join(PKG_ROOT, '.vscode', 'settings.json');
    if (fs.existsSync(vs)) {
      const dest = path.join(target, '.vscode', 'settings.json');
      if (opts.dryRun) console.log(`${dim}file${reset}  ${vs} → ${dest}`);
      else {
        if (fs.existsSync(dest) && !opts.force) console.log(`${dim}omitido${reset} ${dest} (já existe)`);
        else copyFile(vs, dest, copyOpts);
      }
    }
  }

  if (opts.commands && fullLayout) {
    const cmdSrc = path.join(PKG_ROOT, 'commands', 'oxe');
    const cmdDest = path.join(target, 'commands', 'oxe');
    if (fs.existsSync(cmdSrc)) copyDir(cmdSrc, cmdDest, copyOpts, idePathRewrite);
  }

  if (opts.agents && fullLayout) {
    const agents = path.join(PKG_ROOT, 'AGENTS.md');
    if (fs.existsSync(agents)) {
      const dest = path.join(target, 'AGENTS.md');
      if (opts.dryRun) console.log(`${dim}file${reset}  ${agents} → ${dest}`);
      else if (fs.existsSync(dest) && !opts.force) console.log(`${dim}omitido${reset} ${dest} (já existe)`);
      else copyFileMaybeRewrite(agents, dest, copyOpts, idePathRewrite);
    }
  }

  if (!opts.noInitOxe) bootstrapOxe(target, { dryRun: opts.dryRun, force: opts.force });
  else ensureGitignoreIgnoresOxeDir(target, { dryRun: opts.dryRun });

  if (!opts.dryRun) {
    writeRuntimeSemanticsManifest(opts, { layout: fullLayout ? 'classic' : 'nested' });
  }

  if (!opts.dryRun && (opts.cursor || opts.copilot || opts.copilotCli || opts.allAgents || anyGranularAgent(opts))) {
    const nextFiles = {};
    const addTracked = (root, nameFilter) => {
      if (!fs.existsSync(root)) return;
      const files = oxeManifest.collectFilesRecursive(root, nameFilter);
      for (const f of files) {
        try {
          nextFiles[f] = oxeManifest.sha256File(f);
        } catch {
          /* skip */
        }
      }
    };
    const trackFile = (f) => {
      if (!fs.existsSync(f)) return;
      try {
        nextFiles[f] = oxeManifest.sha256File(f);
      } catch {
        /* skip */
      }
    };
    const cpCliHome = installCopilotCliHome(opts);
    if (opts.cursor) {
      addTracked(path.join(cursorBase, 'commands'), (n) => n.startsWith('oxe-') && n.endsWith('.md'));
      addTracked(path.join(cursorBase, 'rules'), (n) => n.includes('oxe') && (n.endsWith('.mdc') || n.endsWith('.md')));
    }
    if (opts.copilot) {
      const instP = copilotInstructionsPath(opts);
      if (fs.existsSync(instP)) {
        try {
          nextFiles[instP] = oxeManifest.sha256File(instP);
        } catch {
          /* skip */
        }
      }
      addTracked(copilotPromptsDirPath(opts), (n) => n.startsWith('oxe-'));
      trackFile(copilotWorkspaceManifestPath(opts));
    }
    trackFile(runtimeSemanticsManifestPath(opts));
    if (opts.copilotCli || opts.allAgents) {
      addTracked(path.join(installClaudeBase(opts), 'commands'), (n) => oxeAgentInstall.isOxeCommandMarkdownName(n));
      addTracked(path.join(cpCliHome, 'commands'), (n) => oxeAgentInstall.isOxeCommandMarkdownName(n));
      const skRoot = path.join(cpCliHome, 'skills');
      if (fs.existsSync(skRoot)) {
        for (const sub of fs.readdirSync(skRoot, { withFileTypes: true })) {
          if (!sub.isDirectory() || !/^oxe($|-)/.test(sub.name)) continue;
          const sm = path.join(skRoot, sub.name, 'SKILL.md');
          if (fs.existsSync(sm)) {
            try {
              nextFiles[sm] = oxeManifest.sha256File(sm);
            } catch {
              /* skip */
            }
          }
        }
      }
    }
    if (opts.agentOpenCode || opts.allAgents) {
      for (const d of agentPaths.opencodeCommandDirs) {
        addTracked(d, (n) => oxeAgentInstall.isOxeCommandMarkdownName(n));
      }
    }
    if (opts.agentGemini || opts.allAgents) {
      const gCmd = agentPaths.geminiCommandsBase;
      trackFile(path.join(gCmd, 'oxe.toml'));
      const oxeGem = path.join(gCmd, 'oxe');
      if (fs.existsSync(oxeGem)) {
        for (const n of fs.readdirSync(oxeGem)) {
          if (n.endsWith('.toml')) trackFile(path.join(oxeGem, n));
        }
      }
    }
    if (opts.agentWindsurf || opts.allAgents) {
      addTracked(agentPaths.windsurfWorkflowsDir, (n) => n === 'oxe.md' || (n.startsWith('oxe-') && n.endsWith('.md')));
    }
    if (opts.agentCodex || opts.allAgents) {
      const cxPrompts = agentPaths.codexPromptsDir;
      if (fs.existsSync(cxPrompts)) {
        addTracked(cxPrompts, (n) => oxeAgentInstall.isOxeCommandMarkdownName(n));
      }
    }
    if (opts.agentAntigravity || opts.allAgents) {
      const root = agentPaths.antigravitySkillsRoot;
      if (fs.existsSync(root)) {
        for (const sub of fs.readdirSync(root, { withFileTypes: true })) {
          if (!sub.isDirectory() || !/^oxe($|-)/.test(sub.name)) continue;
          trackFile(path.join(root, sub.name, 'SKILL.md'));
        }
      }
    }
    if (opts.agentCodex || opts.allAgents) {
      const root = agentPaths.codexAgentsSkillsRoot;
      if (fs.existsSync(root)) {
        for (const sub of fs.readdirSync(root, { withFileTypes: true })) {
          if (!sub.isDirectory() || !/^oxe($|-)/.test(sub.name)) continue;
          trackFile(path.join(root, sub.name, 'SKILL.md'));
        }
      }
    }
    const mergedManifest = { ...prevManifest, ...nextFiles };
    oxeManifest.writeFileManifest(home, mergedManifest, readPkgVersion());
  }

  // Instalar extensão VS Code OXE Agents (sempre tenta, falha graciosamente)
  installVscodeExtension(opts);

  printSummaryAndNextSteps(c, buildInstallSummary(opts, fullLayout));
  if (opts.copilot) {
    const copilotReport = oxeHealth.copilotIntegrationReport(target);
    if (copilotReport.legacy && copilotReport.legacy.detected) {
      console.log(
        `  ${yellow}Nota:${reset} legado do Copilot VS Code detectado em ${c ? cyan : ''}${displayPathForUser(
          copilotReport.legacy.root
        )}${reset}. O OXE agora usa ${c ? cyan : ''}.github/${reset} no workspace para a IDE.`
      );
      console.log(
        `  ${c ? dim : ''}Limpeza opcional:${c ? reset : ''} ${c ? cyan : ''}npx oxe-cc uninstall --copilot-legacy-clean --dir "${target}"${reset}`
      );
    }
  }
  console.log(`  ${c ? green : ''}✓${c ? reset : ''} Instalação concluída com sucesso.\n`);
}

/** @typedef {{ help: boolean, dryRun: boolean, cursor: boolean, copilot: boolean, copilotCli: boolean, allAgents: boolean, agentOpenCode: boolean, agentGemini: boolean, agentCodex: boolean, agentWindsurf: boolean, agentAntigravity: boolean, globalCli: boolean, ideLocal: boolean, ideExplicit: boolean, noProject: boolean, copilotLegacyClean: boolean, dir: string, explicitConfigDir: string | null, parseError: boolean, unknownFlag: string, conflictFlags: string }} UninstallOpts */

/**
 * @param {UninstallOpts} u
 * @param {string[]} removedPaths
 */
function uninstallLocalIdeFromProject(u, removedPaths) {
  const proj = path.resolve(u.dir);
  const track = (p) => {
    if (removedPaths.indexOf(p) === -1) removedPaths.push(p);
  };

  if (u.cursor) {
    const cmdDir = path.join(proj, '.cursor', 'commands');
    if (fs.existsSync(cmdDir)) {
      for (const name of fs.readdirSync(cmdDir)) {
        if (oxeAgentInstall.isOxeCommandMarkdownName(name)) {
          const p = path.join(cmdDir, name);
          unlinkQuiet(p, u);
          track(p);
        }
      }
    }
    const ruleDir = path.join(proj, '.cursor', 'rules');
    if (fs.existsSync(ruleDir)) {
      for (const name of fs.readdirSync(ruleDir)) {
        if (name.includes('oxe') && (name.endsWith('.mdc') || name.endsWith('.md'))) {
          const p = path.join(ruleDir, name);
          unlinkQuiet(p, u);
          track(p);
        }
      }
    }
  }

  if (u.copilot) {
    const inst = path.join(proj, '.github', 'copilot-instructions.md');
    stripOxeFromCopilotInstructions(inst, u);
    if (fs.existsSync(inst)) track(inst);
    const pr = path.join(proj, '.github', 'prompts');
    if (fs.existsSync(pr)) {
      for (const name of fs.readdirSync(pr)) {
        if (/^oxe-.*\.prompt\.md$/i.test(name)) {
          const p = path.join(pr, name);
          unlinkQuiet(p, u);
          track(p);
        }
      }
    }
    const manifest = path.join(proj, '.oxe', 'install', 'copilot-vscode.json');
    unlinkQuiet(manifest, u);
    track(manifest);
  }

  if (u.copilotCli || u.allAgents) {
    for (const base of [path.join(proj, '.claude'), path.join(proj, '.copilot')]) {
      const cmdDir = path.join(base, 'commands');
      if (!fs.existsSync(cmdDir)) continue;
      for (const name of fs.readdirSync(cmdDir)) {
        if (oxeAgentInstall.isOxeCommandMarkdownName(name)) {
          const p = path.join(cmdDir, name);
          unlinkQuiet(p, u);
          track(p);
        }
      }
    }
    const skillsRoot = path.join(proj, '.copilot', 'skills');
    if (fs.existsSync(skillsRoot)) {
      for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
        if (!ent.isDirectory() || !/^oxe($|-)/.test(ent.name)) continue;
        const skillFile = path.join(skillsRoot, ent.name, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        let txt = '';
        try {
          txt = fs.readFileSync(skillFile, 'utf8');
        } catch {
          continue;
        }
        if (!txt.includes('<!-- oxe-cc managed -->')) continue;
        const dir = path.join(skillsRoot, ent.name);
        if (u.dryRun) {
          console.log(`${dim}rm -r${reset}  ${dir}`);
        } else {
          fs.rmSync(dir, { recursive: true, force: true });
        }
        track(skillFile);
      }
    }
  }

  if (u.allAgents || anyGranularUninstallAgent(u)) {
    const localPaths = oxeAgentInstall.buildAgentInstallPaths(false, proj);
    const cleanupTargets = buildAgentCleanupTargets(u);
    if (!u.dryRun) {
      oxeAgentInstall.cleanupMarkedUnifiedArtifacts({ dryRun: u.dryRun, targets: cleanupTargets }, localPaths);
    } else {
      const label = cleanupTargets
        ? Object.keys(cleanupTargets).filter((key) => cleanupTargets[key]).join(', ')
        : 'OpenCode, Gemini, Windsurf, Codex, Antigravity';
      console.log(`${dim}agents${reset}  (dry-run) limparia marcadores oxe-cc em pastas locais do projeto (${label})`);
    }
  }

  if (u.cursor || u.copilot || u.copilotCli || u.allAgents || anyGranularUninstallAgent(u)) {
    const runtimeManifest = path.join(proj, '.oxe', 'install', 'runtime-semantics.json');
    unlinkQuiet(runtimeManifest, u);
    track(runtimeManifest);
  }
}

/**
 * @param {string[]} argv
 * @returns {UninstallOpts}
 */
function parseUninstallArgs(argv) {
  /** @type {UninstallOpts} */
  const out = {
    help: false,
    dryRun: false,
    cursor: false,
    copilot: false,
    copilotCli: false,
    allAgents: false,
    agentOpenCode: false,
    agentGemini: false,
    agentCodex: false,
    agentWindsurf: false,
    agentAntigravity: false,
    globalCli: false,
    ideLocal: false,
    ideExplicit: false,
    noProject: false,
    copilotLegacyClean: false,
    dir: process.cwd(),
    explicitConfigDir: null,
    parseError: false,
    unknownFlag: '',
    conflictFlags: '',
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if ((a === '--config-dir' || a === '-c') && argv[i + 1]) {
      out.explicitConfigDir = path.resolve(expandTilde(argv[++i]));
    } else if (a === '--cursor') {
      out.cursor = true;
      out.ideExplicit = true;
    } else if (a === '--copilot' || a === '--copilot-vscode') {
      out.copilot = true;
      out.ideExplicit = true;
    } else if (a === '--copilot-cli') {
      out.copilotCli = true;
      out.ideExplicit = true;
    } else if (a === '--opencode') {
      out.agentOpenCode = true;
      out.ideExplicit = true;
    } else if (a === '--gemini') {
      out.agentGemini = true;
      out.ideExplicit = true;
    } else if (a === '--codex') {
      out.agentCodex = true;
      out.ideExplicit = true;
    } else if (a === '--windsurf') {
      out.agentWindsurf = true;
      out.ideExplicit = true;
    } else if (a === '--antigravity') {
      out.agentAntigravity = true;
      out.ideExplicit = true;
    } else if (a === '--copilot-legacy-clean') {
      out.copilotLegacyClean = true;
    } else if (a === '--all-agents') {
      out.allAgents = true;
      out.copilotCli = true;
      out.agentOpenCode = true;
      out.agentGemini = true;
      out.agentCodex = true;
      out.agentWindsurf = true;
      out.agentAntigravity = true;
      out.ideExplicit = true;
    } else if (a === '--global-cli' || a === '-g') {
      out.globalCli = true;
    } else if (a === '--ide-local') out.ideLocal = true;
    else if (a === '--ide-only') out.noProject = true;
    else if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (!a.startsWith('-')) rest.push(path.resolve(a));
    else {
      out.parseError = true;
      out.unknownFlag = a;
      break;
    }
  }
  if (rest.length) out.dir = rest[0];
  if (!out.ideExplicit && !out.copilotLegacyClean) {
    out.cursor = true;
    out.copilot = true;
    out.copilotCli = true;
    out.allAgents = true;
  } else if (out.copilotLegacyClean && !out.ideExplicit && !out.noProject) {
    out.noProject = true;
  }
  if (!out.conflictFlags && out.explicitConfigDir) {
    if (out.ideLocal) {
      out.conflictFlags = '--config-dir não combina com --ide-local';
    } else if (out.allAgents) {
      out.conflictFlags = '--config-dir não combina com --all-agents';
    } else if (anyGranularUninstallAgent(out)) {
      out.conflictFlags = '--config-dir só é suportado com exatamente um entre --cursor, --copilot e --copilot-cli';
    } else if (out.copilot && !out.cursor && !out.copilotCli) {
      out.conflictFlags =
        '--config-dir não combina com --copilot porque o GitHub Copilot no VS Code usa .github/ no workspace';
    } else {
      const n = [out.cursor, out.copilot, out.copilotCli].filter(Boolean).length;
      if (n !== 1) {
        out.conflictFlags =
          '--config-dir exige exatamente um entre --cursor, --copilot e --copilot-cli';
      }
    }
  }
  return out;
}

/**
 * @param {string} destPath
 * @param {{ dryRun: boolean }} opts
 */
function stripOxeFromCopilotInstructions(destPath, opts) {
  if (!fs.existsSync(destPath)) return;
  const existing = fs.readFileSync(destPath, 'utf8');
  if (!existing.includes(OXE_INST_BEGIN)) return;
  if (opts.dryRun) {
    console.log(`${dim}strip${reset}  bloco OXE em ${destPath}`);
    return;
  }
  const re = new RegExp(
    `\\n?${escapeForRegExp(OXE_INST_BEGIN)}[\\s\\S]*?${escapeForRegExp(OXE_INST_END)}\\n?`,
    'm'
  );
  const merged = existing.replace(re, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  fs.writeFileSync(destPath, merged ? `${merged}\n` : '\n', 'utf8');
}

/**
 * @param {InstallOpts} ideOpts
 * @param {UninstallOpts} opts
 * @param {string[]} removedPaths
 */
function cleanupLegacyCopilotVsCode(ideOpts, opts, removedPaths) {
  const inst = copilotLegacyInstructionsPath(ideOpts);
  stripOxeFromCopilotInstructions(inst, opts);
  if (fs.existsSync(inst)) removedPaths.push(inst);
  const pr = copilotLegacyPromptDir(ideOpts);
  if (!fs.existsSync(pr)) return;
  for (const name of fs.readdirSync(pr)) {
    if (!/^oxe-.*\.prompt\.md$/i.test(name)) continue;
    const promptPath = path.join(pr, name);
    unlinkQuiet(promptPath, opts);
    removedPaths.push(promptPath);
  }
}

/**
 * @param {string} filePath
 * @param {{ dryRun: boolean }} opts
 */
function unlinkQuiet(filePath, opts) {
  if (!fs.existsSync(filePath)) return;
  if (opts.dryRun) {
    console.log(`${dim}rm${reset}     ${filePath}`);
    return;
  }
  fs.unlinkSync(filePath);
}

/**
 * @param {string} dirPath
 * @param {{ dryRun: boolean }} opts
 */
function rmDirIfEmpty(dirPath, opts) {
  if (!fs.existsSync(dirPath) || opts.dryRun) return;
  try {
    const n = fs.readdirSync(dirPath);
    if (n.length === 0) fs.rmdirSync(dirPath);
  } catch {
    /* ignore */
  }
}

/**
 * @param {UninstallOpts} u
 */
function runUninstall(u) {
  assertNotWslWindowsNode();
  const c = useAnsiColors();
  const home = os.homedir();
  const ideOpts = /** @type {InstallOpts} */ ({
    help: false,
    version: false,
    cursor: u.cursor,
    copilot: u.copilot,
    copilotCli: u.copilotCli,
    allAgents: u.allAgents,
    agentOpenCode: u.agentOpenCode,
    agentGemini: u.agentGemini,
    agentCodex: u.agentCodex,
    agentWindsurf: u.agentWindsurf,
    agentAntigravity: u.agentAntigravity,
    vscode: false,
    commands: false,
    agents: false,
    force: true,
    dryRun: u.dryRun,
    dir: u.dir,
    all: false,
    noInitOxe: true,
    oxeOnly: false,
    globalCli: false,
    noGlobalCli: true,
    installAssetsGlobal: false,
    explicitScope: true,
    integrationsUnset: false,
    explicitConfigDir: u.explicitConfigDir,
    parseError: false,
    unknownFlag: '',
    conflictFlags: '',
    ignoreInstallConfig: false,
    ideLocal: false,
    explicitIdeScope: true,
    agentOpenCode: false,
    agentGemini: false,
    agentCodex: false,
    agentWindsurf: false,
    agentAntigravity: false,
  });

  printSection('OXE ▸ uninstall');
  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${u.dir}${c ? reset : ''}`);
  if (u.dryRun) console.log(`  ${c ? yellow : ''}(dry-run)${c ? reset : ''}`);

  const removedPaths = [];

  if (u.cursor) {
    const base = cursorUserDir(ideOpts);
    const cmdDir = path.join(base, 'commands');
    const ruleDir = path.join(base, 'rules');
    if (fs.existsSync(cmdDir)) {
      for (const name of fs.readdirSync(cmdDir)) {
        if (oxeAgentInstall.isOxeCommandMarkdownName(name)) {
          const p = path.join(cmdDir, name);
          unlinkQuiet(p, u);
          removedPaths.push(p);
        }
      }
    }
    if (fs.existsSync(ruleDir)) {
      for (const name of fs.readdirSync(ruleDir)) {
        if (name.includes('oxe') && (name.endsWith('.mdc') || name.endsWith('.md'))) {
          const p = path.join(ruleDir, name);
          unlinkQuiet(p, u);
          removedPaths.push(p);
        }
      }
    }
  }

  if (u.copilot) {
    const inst = path.join(u.dir, '.github', 'copilot-instructions.md');
    stripOxeFromCopilotInstructions(inst, u);
    if (fs.existsSync(inst)) removedPaths.push(inst);
    const pr = path.join(u.dir, '.github', 'prompts');
    if (fs.existsSync(pr)) {
      for (const name of fs.readdirSync(pr)) {
        if (/^oxe-.*\.prompt\.md$/i.test(name)) {
          const p = path.join(pr, name);
          unlinkQuiet(p, u);
          removedPaths.push(p);
        }
      }
    }
    const manifest = copilotWorkspaceManifestPath(ideOpts);
    unlinkQuiet(manifest, u);
    removedPaths.push(manifest);
  }

  if (u.copilotLegacyClean) {
    cleanupLegacyCopilotVsCode(ideOpts, u, removedPaths);
  }

  if (u.copilotCli) {
    for (const base of [claudeUserDir(ideOpts), copilotUserDir(ideOpts)]) {
      const cmdDir = path.join(base, 'commands');
      if (!fs.existsSync(cmdDir)) continue;
      for (const name of fs.readdirSync(cmdDir)) {
        if (oxeAgentInstall.isOxeCommandMarkdownName(name)) {
          const p = path.join(cmdDir, name);
          unlinkQuiet(p, u);
          removedPaths.push(p);
        }
      }
    }
    const skillsRoot = path.join(copilotUserDir(ideOpts), 'skills');
    if (fs.existsSync(skillsRoot)) {
      for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
        if (!ent.isDirectory() || !/^oxe($|-)/.test(ent.name)) continue;
        const skillFile = path.join(skillsRoot, ent.name, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        let txt = '';
        try {
          txt = fs.readFileSync(skillFile, 'utf8');
        } catch {
          continue;
        }
        if (!txt.includes('<!-- oxe-cc managed -->')) continue;
        const dir = path.join(skillsRoot, ent.name);
        if (u.dryRun) {
          console.log(`${dim}rm -r${reset}  ${dir}`);
        } else {
          fs.rmSync(dir, { recursive: true, force: true });
        }
        removedPaths.push(skillFile);
      }
    }
  }

  if (u.allAgents || anyGranularUninstallAgent(u)) {
    const cleanupTargets = buildAgentCleanupTargets(u);
    if (u.dryRun) {
      const label = cleanupTargets
        ? Object.keys(cleanupTargets).filter((key) => cleanupTargets[key]).join(', ')
        : 'OpenCode, Gemini, Windsurf, Codex, Antigravity';
      console.log(`${dim}agents${reset}  (dry-run) limparia ${label || 'OpenCode, Gemini, Windsurf, Codex, Antigravity'} (marcadores oxe-cc)`);
    } else {
      oxeAgentInstall.cleanupMarkedUnifiedArtifacts({ dryRun: u.dryRun, targets: cleanupTargets });
    }
    const globalAgentPaths = oxeAgentInstall.buildAgentInstallPaths(true, u.dir);
    const shouldTrack = (name) => !cleanupTargets || cleanupTargets[name] !== false;
    const pushRemoved = (filePath) => {
      if (removedPaths.indexOf(filePath) === -1) removedPaths.push(filePath);
    };
    if (shouldTrack('opencode')) {
      for (const dir of globalAgentPaths.opencodeCommandDirs) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
          if (!oxeAgentInstall.isOxeCommandMarkdownName(name)) continue;
          pushRemoved(path.join(dir, name));
        }
      }
    }
    if (shouldTrack('gemini')) {
      pushRemoved(path.join(globalAgentPaths.geminiCommandsBase, 'oxe.toml'));
      const geminiSub = path.join(globalAgentPaths.geminiCommandsBase, 'oxe');
      if (fs.existsSync(geminiSub)) {
        for (const name of fs.readdirSync(geminiSub)) {
          if (name.endsWith('.toml')) pushRemoved(path.join(geminiSub, name));
        }
      }
    }
    if (shouldTrack('windsurf') && fs.existsSync(globalAgentPaths.windsurfWorkflowsDir)) {
      for (const name of fs.readdirSync(globalAgentPaths.windsurfWorkflowsDir)) {
        if (!oxeAgentInstall.isOxeCommandMarkdownName(name)) continue;
        pushRemoved(path.join(globalAgentPaths.windsurfWorkflowsDir, name));
      }
    }
    if (shouldTrack('codex')) {
      if (fs.existsSync(globalAgentPaths.codexPromptsDir)) {
        for (const name of fs.readdirSync(globalAgentPaths.codexPromptsDir)) {
          if (!oxeAgentInstall.isOxeCommandMarkdownName(name)) continue;
          pushRemoved(path.join(globalAgentPaths.codexPromptsDir, name));
        }
      }
      if (fs.existsSync(globalAgentPaths.codexAgentsSkillsRoot)) {
        for (const entry of fs.readdirSync(globalAgentPaths.codexAgentsSkillsRoot, { withFileTypes: true })) {
          if (!entry.isDirectory() || !/^oxe($|-)/.test(entry.name)) continue;
          pushRemoved(path.join(globalAgentPaths.codexAgentsSkillsRoot, entry.name, 'SKILL.md'));
        }
      }
    }
    if (shouldTrack('antigravity') && fs.existsSync(globalAgentPaths.antigravitySkillsRoot)) {
      for (const entry of fs.readdirSync(globalAgentPaths.antigravitySkillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^oxe($|-)/.test(entry.name)) continue;
        pushRemoved(path.join(globalAgentPaths.antigravitySkillsRoot, entry.name, 'SKILL.md'));
      }
    }
  }

  if (u.ideLocal) {
    uninstallLocalIdeFromProject(u, removedPaths);
  }

  if (!u.noProject) {
    const target = u.dir;
    const nestedWf = path.join(target, '.oxe', 'workflows');
    const nestedTpl = path.join(target, '.oxe', 'templates');
    const globalOxe = path.join(target, 'oxe');
    const globalCmd = path.join(target, 'commands', 'oxe');

    const rmTree = (p) => {
      if (!fs.existsSync(p)) return;
      if (u.dryRun) {
        console.log(`${dim}rm -r${reset}  ${p}`);
        return;
      }
      fs.rmSync(p, { recursive: true, force: true });
    };

    if (fs.existsSync(nestedWf)) rmTree(nestedWf);
    if (fs.existsSync(nestedTpl)) rmTree(nestedTpl);
    if (fs.existsSync(globalOxe)) rmTree(globalOxe);
    if (fs.existsSync(globalCmd)) rmTree(globalCmd);

    if (!u.dryRun) {
      rmDirIfEmpty(path.join(target, '.oxe', 'templates'), u);
      rmDirIfEmpty(path.join(target, '.oxe', 'workflows'), u);
    }
  }

  if (!u.dryRun && (u.cursor || u.copilot || u.copilotCli || u.copilotLegacyClean || anyGranularUninstallAgent(u))) {
    const prev = oxeManifest.loadFileManifest(home);
    const next = { ...prev };
    for (const p of removedPaths) delete next[p];
    if (u.copilot) {
      const instPath = path.join(u.dir, '.github', 'copilot-instructions.md');
      if (fs.existsSync(instPath)) {
        try {
          next[instPath] = oxeManifest.sha256File(instPath);
        } catch {
          delete next[instPath];
        }
      } else {
        delete next[instPath];
      }
    }
    oxeManifest.writeFileManifest(home, next, readPkgVersion());
  }

  if (u.globalCli && !u.dryRun) {
    uninstallGlobalCliPackage();
  } else if (u.globalCli && u.dryRun) {
    console.log(`${dim}npm${reset}    npm uninstall -g ${readPkgName()}`);
  }

  printSummaryAndNextSteps(c, buildUninstallFooter(u));
  if (!u.globalCli) {
    console.log(
      `  ${c ? yellow : ''}Nota:${c ? reset : ''} o pacote npm global ${c ? cyan : ''}${readPkgName()}${c ? reset : ''} não é removido por padrão. Use ${c ? cyan : ''}oxe-cc uninstall --global-cli${c ? reset : ''} ou ${c ? cyan : ''}npm uninstall -g ${readPkgName()}${c ? reset : ''}.\n`
    );
  }
  console.log(`  ${c ? green : ''}✓${c ? reset : ''} Desinstalação concluída com sucesso.\n`);
}

/** @typedef {{ help: boolean, dryRun: boolean, check: boolean, ifNewer: boolean, dir: string, rest: string[], parseError: boolean, unknownFlag: string, conflictFlags: string|null }} UpdateOpts */

/**
 * @param {string[]} argv
 * @returns {UpdateOpts}
 */
function parseUpdateArgs(argv) {
  /** @type {UpdateOpts} */
  const out = {
    help: false,
    dryRun: false,
    check: false,
    ifNewer: false,
    dir: process.cwd(),
    rest: [],
    parseError: false,
    unknownFlag: '',
    conflictFlags: null,
  };
  let dirExplicit = false;
  let firstPositionalConsumed = false;
  const passthroughFlags = new Set(updateForwardedInstallFlags());
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--check') out.check = true;
    else if (a === '--if-newer') out.ifNewer = true;
    else if (a === '--dir' && argv[i + 1]) {
      out.dir = path.resolve(argv[++i]);
      dirExplicit = true;
    } else if (!a.startsWith('-')) {
      if (!dirExplicit && !firstPositionalConsumed) {
        out.dir = path.resolve(a);
        firstPositionalConsumed = true;
      } else out.rest.push(a);
    } else if (passthroughFlags.has(a)) {
      out.rest.push(a);
      if ((a === '--config-dir' || a === '-c') && argv[i + 1]) {
        out.rest.push(argv[++i]);
      }
    } else {
      out.parseError = true;
      out.unknownFlag = a;
      break;
    }
  }
  if (!out.parseError) {
    if (out.check && out.dryRun) {
      out.conflictFlags = 'Combinação inválida: --check não pode ser usada com --dry-run.';
    } else if (out.check && out.ifNewer) {
      out.conflictFlags = 'Combinação inválida: use só --check ou só --if-newer.';
    }
  }
  return out;
}

/**
 * Compara versão em execução com `npm view`; termina o processo com 0 / 1 / 2.
 * @param {UpdateOpts} u
 */
function runUpdateVersionCheck(u) {
  assertNotWslWindowsNode();
  const c = useAnsiColors();
  const skip =
    process.env.OXE_UPDATE_SKIP_REGISTRY === '1' || process.env.OXE_UPDATE_SKIP_REGISTRY === 'true';
  printSection('OXE ▸ update — verificação no npm');
  if (skip) {
    console.error(
      `${yellow}Consulta ao registro desativada (OXE_UPDATE_SKIP_REGISTRY). Não foi possível verificar a versão.${reset}\n`
    );
    process.exit(2);
  }
  const pkgName = readPkgName();
  const current = readPkgVersion();
  const res = oxeNpmVersion.syncNpmViewVersion(pkgName);
  if (!res.ok) {
    console.error(`${red}Não foi possível obter a versão no npm:${reset} ${res.error}\n`);
    process.exit(2);
  }
  const latest = res.version;
  const newer = oxeNpmVersion.isNewerThan(latest, current);
  console.log(`  ${dim}Pacote:${reset} ${pkgName}`);
  console.log(`  ${dim}Versão em execução:${reset} ${current}`);
  console.log(`  ${dim}Última no npm (tag latest):${reset} ${latest}`);
  if (newer) {
    console.log(
      `\n  ${yellow}Existe uma versão mais recente no npm.${reset} Atualize com ${cyan}/oxe-update${reset} no Cursor ou, na raiz do projeto (qualquer IDE):\n  ${cyan}npx oxe-cc update${reset} (ou ${cyan}npx oxe-cc update --if-newer${reset})\n`
    );
    process.exit(1);
  }
  console.log(`\n  ${c ? green : ''}✓${c ? reset : ''} Já está na mesma ou numa versão mais recente que a publicada como latest.\n`);
  process.exit(0);
}

/**
 * @param {UpdateOpts} u
 */
function runUpdate(u) {
  assertNotWslWindowsNode();
  const c = useAnsiColors();
  if (u.dryRun) {
    printSection('OXE ▸ update (simulação)');
    if (u.ifNewer) {
      console.log(
        `  ${dim}Com --if-newer, primeiro correria${reset} ${cyan}npm view ${readPkgName()} version${reset} ${dim}(salvo OXE_UPDATE_SKIP_REGISTRY). Só depois, se houver versão mais nova que a em execução, o npx abaixo.${reset}\n`
      );
    }
    console.log(`  ${dim}Comando que seria executado (instalação):${reset}`);
    const dryRunArgs = ['-y', 'oxe-cc@latest', '--force'];
    if (updateArgsExplicitlyControlGlobalCli(u.rest)) dryRunArgs.push(...u.rest);
    else if (isRunningFromGlobalNpmInstall()) dryRunArgs.push('--global-cli');
    else dryRunArgs.push('--no-global-cli', '-l');
    console.log(`  ${cyan}npx ${dryRunArgs.join(' ')}${reset}`);
    console.log(`  ${dim}Diretório:${reset} ${u.dir}`);
    printSummaryAndNextSteps(c, {
      bullets: [
        '[simulação] O npx baixaria o pacote oxe-cc@latest e rodaria a instalação com --force.',
        u.ifNewer ? '[simulação] Com --if-newer, sem versão nova no npm não executaria o npx.' : '',
      ].filter(Boolean),
      nextSteps: [
        { desc: 'Só ver versão no npm (sem instalar):', cmd: 'npx oxe-cc update --check' },
        { desc: 'Rodar de verdade (sem --dry-run), na pasta do projeto:', cmd: 'npx oxe-cc update' },
        { desc: 'Depois, validar:', cmd: 'npx oxe-cc doctor' },
      ],
      dryRun: true,
    });
    return;
  }

  if (u.ifNewer) {
    const skip =
      process.env.OXE_UPDATE_SKIP_REGISTRY === '1' || process.env.OXE_UPDATE_SKIP_REGISTRY === 'true';
    if (skip) {
      console.error(
        `${yellow}OXE_UPDATE_SKIP_REGISTRY está ativo: não é possível comparar versões; o update não foi executado.${reset}\n`
      );
      process.exit(2);
    }
    const res = oxeNpmVersion.syncNpmViewVersion(readPkgName());
    if (!res.ok) {
      console.error(`${red}Não foi possível obter a versão no npm:${reset} ${res.error}`);
      console.error(`${dim}O update não foi executado (use sem --if-newer para forçar).${reset}\n`);
      process.exit(2);
    }
    const current = readPkgVersion();
    if (!oxeNpmVersion.isNewerThan(res.version, current)) {
      printSection('OXE ▸ update');
      console.log(
        `  ${dim}Versão em execução:${reset} ${current}  ${dim}| npm latest:${reset} ${res.version}`
      );
      console.log(
        `\n  ${c ? green : ''}✓${c ? reset : ''} Nenhuma versão mais nova no npm; nada a instalar. Use ${cyan}npx oxe-cc update --check${reset} para só consultar.\n`
      );
      return;
    }
    console.log(
      `  ${dim}Há versão mais nova no npm (${res.version} > ${current}); a executar npx…${reset}\n`
    );
  }

  printSection('OXE ▸ update');
  const args = ['-y', 'oxe-cc@latest', '--force'];
  if (updateArgsExplicitlyControlGlobalCli(u.rest)) {
    args.push(...u.rest);
  } else if (isRunningFromGlobalNpmInstall()) {
    args.push('--global-cli', ...u.rest);
  } else {
    args.push('--no-global-cli', '-l', ...u.rest);
  }
  const r = spawnSync('npx', args, {
    cwd: u.dir,
    stdio: 'inherit',
    env: { ...process.env },
    shell: process.platform === 'win32',
  });
  if (r.error) {
    console.error(`${red}Falha ao executar npx:${reset}`, r.error.message);
    process.exit(1);
  }
  if (r.status !== 0 && r.status !== null) process.exit(r.status);
  printSummaryAndNextSteps(c, {
    bullets: [
      'Pacote oxe-cc atualizado via npx (--force); arquivos do projeto e integrações foram alinhados à versão publicada.',
    ],
    nextSteps: [
      { desc: 'Validar workflows e .oxe na raiz do projeto:', cmd: 'npx oxe-cc doctor' },
      { desc: 'Retomar o fluxo no agente:', cmd: '/oxe-scan' },
      { desc: 'Ajuda geral no chat:', cmd: '/oxe-help' },
    ],
    dryRun: false,
  });
  console.log(`  ${c ? green : ''}✓${c ? reset : ''} Atualização concluída com sucesso.\n`);
}

/**
 * @typedef {{ help: boolean, dir: string, action: string, id: string, parseError: boolean, unknownFlag: string }} CapabilityOpts
 */

/**
 * @param {string[]} argv
 * @returns {CapabilityOpts}
 */
function parseCapabilitiesArgs(argv) {
  /** @type {CapabilityOpts} */
  const out = {
    help: false,
    dir: process.cwd(),
    action: 'list',
    id: '',
    parseError: false,
    unknownFlag: '',
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (!a.startsWith('-')) positionals.push(a);
    else {
      out.parseError = true;
      out.unknownFlag = a;
      break;
    }
  }
  if (positionals.length) {
    out.action = positionals[0];
    out.id = positionals[1] || '';
  }
  return out;
}

/**
 * @typedef {{ help: boolean, dir: string, port: number, noOpen: boolean, readOnly: boolean, dumpContext: boolean, activeSession: string|null, parseError: boolean, unknownFlag: string }} DashboardOpts
 */

/**
 * @typedef {{ help: boolean, dir: string, action: 'build'|'inspect', workflow: string, tier: 'minimal'|'standard'|'full', activeSession: string|null, json: boolean, parseError: boolean, unknownFlag: string }} ContextOpts
 */

/**
 * @typedef {{ help: boolean, dir: string, action: string, subAction: string, activeSession: string|null, wave: number|null, task: string, mode: string, reason: string, runId: string, fromEventId: string, writeReport: boolean, gateId: string, decision: string, actor: string, targetKind: string, remote: string, baseBranch: string, minimumCoverage: number|null, timeoutMs: number|null, jsonOutput: boolean, gateStatus: string, gateScope: string, parseError: boolean, unknownFlag: string }} RuntimeOpts
 */

/**
 * @typedef {{
 *   help: boolean,
 *   dir: string,
 *   scope: string,
 *   action: string,
 *   query: string,
 *   activeSession: string|null,
 *   subscription: string,
 *   kind: string,
 *   resourceGroup: string,
 *   name: string,
 *   namespace: string,
 *   topicName: string,
 *   subscriptionName: string,
 *   sourceResourceId: string,
 *   endpoint: string,
 *   location: string,
 *   server: string,
 *   database: string,
 *   adminUser: string,
 *   adminPasswordEnv: string,
 *   startIpAddress: string,
 *   endIpAddress: string,
 *   approve: boolean,
 *   overridePolicy: boolean,
 *   dryRun: boolean,
 *   diff: boolean,
 *   filterType: string,
 *   filterRg: string,
 *   vpnConfirmed: boolean,
 *   tenant: string,
 *   parseError: boolean,
 *   unknownFlag: string
 * }} AzureOpts
 */

/**
 * @param {string[]} argv
 * @returns {DashboardOpts}
 */
function parseDashboardArgs(argv) {
  /** @type {DashboardOpts} */
  const out = {
    help: false,
    dir: process.cwd(),
    port: 4173,
    noOpen: false,
    readOnly: false,
    dumpContext: false,
    activeSession: null,
    parseError: false,
    unknownFlag: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i]) || 4173;
    else if (a === '--no-open') out.noOpen = true;
    else if (a === '--read-only') out.readOnly = true;
    else if (a === '--dump-context') out.dumpContext = true;
    else if (a === '--session' && argv[i + 1]) out.activeSession = String(argv[++i]).replace(/\\/g, '/');
    else if (!a.startsWith('-') && i === 0) out.dir = path.resolve(a);
    else {
      out.parseError = true;
      out.unknownFlag = a;
      break;
    }
  }
  return out;
}

/**
 * @param {string[]} argv
 * @returns {ContextOpts}
 */
function parseContextArgs(argv) {
  /** @type {ContextOpts} */
  const out = {
    help: false,
    dir: process.cwd(),
    action: 'build',
    workflow: '',
    tier: 'standard',
    activeSession: null,
    json: false,
    parseError: false,
    unknownFlag: '',
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (a === '--workflow' && argv[i + 1]) out.workflow = String(argv[++i]);
    else if (a === '--tier' && argv[i + 1]) {
      const tier = String(argv[++i]);
      out.tier = ['minimal', 'standard', 'full'].includes(tier) ? /** @type {'minimal'|'standard'|'full'} */ (tier) : 'standard';
    }
    else if (a === '--session' && argv[i + 1]) out.activeSession = String(argv[++i]).replace(/\\/g, '/');
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('-')) positionals.push(a);
    else {
      out.parseError = true;
      out.unknownFlag = a;
      break;
    }
  }
  if (positionals[0] === 'build' || positionals[0] === 'inspect') {
    out.action = /** @type {'build'|'inspect'} */ (positionals[0]);
  }
  if (!out.workflow && positionals[1]) out.workflow = String(positionals[1]);
  return out;
}

/**
 * @param {string[]} argv
 * @returns {RuntimeOpts}
 */
function parseRuntimeArgs(argv) {
  /** @type {RuntimeOpts} */
  const out = {
    help: false,
    dir: process.cwd(),
    action: 'status',
    subAction: '',
    activeSession: null,
    wave: null,
    task: '',
    mode: '',
    reason: '',
    runId: '',
    fromEventId: '',
    writeReport: false,
    gateId: '',
    decision: '',
    actor: '',
    targetKind: '',
    remote: '',
    baseBranch: '',
    minimumCoverage: null,
    timeoutMs: null,
    jsonOutput: false,
    gateStatus: '',
    gateScope: '',
    parseError: false,
    unknownFlag: '',
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (a === '--session' && argv[i + 1]) out.activeSession = String(argv[++i]).replace(/\\/g, '/');
    else if (a === '--wave' && argv[i + 1]) out.wave = Number(argv[++i]);
    else if (a === '--task' && argv[i + 1]) out.task = String(argv[++i]);
    else if (a === '--mode' && argv[i + 1]) out.mode = String(argv[++i]);
    else if (a === '--reason' && argv[i + 1]) out.reason = String(argv[++i]);
    else if (a === '--run' && argv[i + 1]) out.runId = String(argv[++i]);
    else if (a === '--from' && argv[i + 1]) out.fromEventId = String(argv[++i]);
    else if (a === '--write') out.writeReport = true;
    else if (a === '--gate' && argv[i + 1]) out.gateId = String(argv[++i]);
    else if (a === '--decision' && argv[i + 1]) out.decision = String(argv[++i]);
    else if (a === '--actor' && argv[i + 1]) out.actor = String(argv[++i]);
    else if (a === '--target' && argv[i + 1]) out.targetKind = String(argv[++i]);
    else if (a === '--remote' && argv[i + 1]) out.remote = String(argv[++i]);
    else if (a === '--base' && argv[i + 1]) out.baseBranch = String(argv[++i]);
    else if (a === '--minimum-coverage' && argv[i + 1]) out.minimumCoverage = Number(argv[++i]);
    else if (a === '--timeout' && argv[i + 1]) out.timeoutMs = Number(argv[++i]);
    else if (a === '--status' && argv[i + 1]) out.gateStatus = String(argv[++i]);
    else if (a === '--scope' && argv[i + 1]) out.gateScope = String(argv[++i]);
    else if (a === '--json') out.jsonOutput = true;
    else if (!a.startsWith('-')) positionals.push(a);
    else {
      out.parseError = true;
      out.unknownFlag = a;
      break;
    }
  }
  if (positionals[0]) out.action = positionals[0];
  if (out.action === 'gates') {
    if (positionals[1]) out.subAction = positionals[1];
    if (positionals[2]) out.dir = path.resolve(positionals[2]);
  } else {
    if (positionals[1]) out.dir = path.resolve(positionals[1]);
  }
  if (Number.isNaN(out.wave)) out.wave = null;
  if (Number.isNaN(out.minimumCoverage)) out.minimumCoverage = null;
  if (Number.isNaN(out.timeoutMs)) out.timeoutMs = null;
  return out;
}

/**
 * @param {string[]} argv
 * @returns {AzureOpts}
 */
function parseAzureArgs(argv) {
  /** @type {AzureOpts} */
  const out = {
    help: false,
    dir: process.cwd(),
    scope: 'doctor',
    action: '',
    query: '',
    activeSession: null,
    subscription: '',
    kind: '',
    resourceGroup: '',
    name: '',
    namespace: '',
    topicName: '',
    subscriptionName: '',
    sourceResourceId: '',
    endpoint: '',
    location: '',
    server: '',
    database: '',
    adminUser: '',
    adminPasswordEnv: '',
    startIpAddress: '',
    endIpAddress: '',
    approve: false,
    overridePolicy: false,
    dryRun: false,
    diff: false,
    filterType: '',
    filterRg: '',
    vpnConfirmed: false,
    tenant: '',
    parseError: false,
    unknownFlag: '',
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (a === '--session' && argv[i + 1]) out.activeSession = String(argv[++i]).replace(/\\/g, '/');
    else if (a === '--subscription' && argv[i + 1]) out.subscription = String(argv[++i]);
    else if (a === '--kind' && argv[i + 1]) out.kind = String(argv[++i]);
    else if (a === '--resource-group' && argv[i + 1]) out.resourceGroup = String(argv[++i]);
    else if (a === '--name' && argv[i + 1]) out.name = String(argv[++i]);
    else if (a === '--namespace' && argv[i + 1]) out.namespace = String(argv[++i]);
    else if (a === '--topic-name' && argv[i + 1]) out.topicName = String(argv[++i]);
    else if (a === '--subscription-name' && argv[i + 1]) out.subscriptionName = String(argv[++i]);
    else if (a === '--source-resource-id' && argv[i + 1]) out.sourceResourceId = String(argv[++i]);
    else if (a === '--endpoint' && argv[i + 1]) out.endpoint = String(argv[++i]);
    else if (a === '--location' && argv[i + 1]) out.location = String(argv[++i]);
    else if (a === '--server' && argv[i + 1]) out.server = String(argv[++i]);
    else if (a === '--database' && argv[i + 1]) out.database = String(argv[++i]);
    else if (a === '--admin-user' && argv[i + 1]) out.adminUser = String(argv[++i]);
    else if (a === '--admin-password-env' && argv[i + 1]) out.adminPasswordEnv = String(argv[++i]);
    else if (a === '--start-ip-address' && argv[i + 1]) out.startIpAddress = String(argv[++i]);
    else if (a === '--end-ip-address' && argv[i + 1]) out.endIpAddress = String(argv[++i]);
    else if (a === '--approve') out.approve = true;
    else if (a === '--override-policy') out.overridePolicy = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--diff') out.diff = true;
    else if (a === '--type' && argv[i + 1]) out.filterType = String(argv[++i]);
    else if (a === '--filter-rg' && argv[i + 1]) out.filterRg = String(argv[++i]);
    else if (a === '--vpn-confirmed') out.vpnConfirmed = true;
    else if (a === '--tenant' && argv[i + 1]) out.tenant = String(argv[++i]);
    else if (!a.startsWith('-')) positionals.push(a);
    else {
      out.parseError = true;
      out.unknownFlag = a;
      break;
    }
  }
  if (positionals[0]) out.scope = String(positionals[0]);
  if (positionals[1]) out.action = String(positionals[1]);
  if (out.scope === 'find') {
    out.query = positionals.slice(1).join(' ').trim();
  } else if (!out.action && positionals[2]) {
    out.query = positionals.slice(2).join(' ').trim();
  } else if (positionals[2]) {
    out.query = positionals.slice(2).join(' ').trim();
  }
  return out;
}

/**
 * @param {ContextOpts} opts
 */
function runContext(opts) {
  const c = useAnsiColors();
  printSection('OXE ▸ context');
  if (!fs.existsSync(opts.dir)) {
    console.error(`${yellow}Diretório não encontrado: ${opts.dir}${reset}`);
    process.exit(1);
  }
  const statePath = oxeHealth.oxePaths(opts.dir).state;
  const stateText = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '';
  const activeSession = opts.activeSession || oxeHealth.parseActiveSession(stateText) || null;
  const workflow = opts.workflow || '';

  if (opts.action === 'inspect') {
    const selectedWorkflow = workflow || 'dashboard';
    let pack;
    try {
      pack = oxeContext.inspectContextPack(opts.dir, {
        workflow: selectedWorkflow,
        tier: opts.tier,
        activeSession,
      });
    } catch (err) {
      console.error(`${red}Erro ao inspecionar context pack para "${selectedWorkflow}": ${err instanceof Error ? err.message : String(err)}${reset}`);
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(pack, null, 2));
      return;
    }
    console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${opts.dir}${c ? reset : ''}`);
    console.log(`  ${c ? green : ''}Sessão:${c ? reset : ''} ${c ? cyan : ''}${activeSession || 'modo legado'}${c ? reset : ''}`);
    console.log(`  ${c ? green : ''}Workflow:${c ? reset : ''} ${selectedWorkflow}`);
    console.log(`  ${c ? green : ''}Tier:${c ? reset : ''} ${pack.context_tier}`);
    console.log(`  ${c ? green : ''}Quality:${c ? reset : ''} ${pack.context_quality.score} (${pack.context_quality.status})`);
    if (pack.context_quality.score < 30 || pack.context_quality.status === 'critical') {
      console.log(`  ${yellow}AVISO${reset} Contexto crítico — artefatos obrigatórios ausentes. Use \`oxe-cc context build --workflow ${selectedWorkflow}\` para regenerar.`);
    }
    console.log(`  ${c ? green : ''}Freshness:${c ? reset : ''} ${pack.freshness.reason}${pack.freshness.pack_age_hours != null ? ` · ${pack.freshness.pack_age_hours}h` : ''}`);
    console.log(`  ${c ? green : ''}Pack:${c ? reset : ''} ${pack.path || '—'}`);
    console.log(`  ${c ? green : ''}Artefatos:${c ? reset : ''} ${(pack.read_order || []).join(', ') || '—'}`);
    if ((pack.gaps || []).length) {
      for (const gap of pack.gaps) {
        console.log(`  ${gap.severity === 'critical' ? red : yellow}${gap.severity.toUpperCase()}${reset} ${gap.alias}: ${gap.reason}`);
      }
    }
    if ((pack.conflicts || []).length) {
      for (const conflict of pack.conflicts) {
        console.log(`  ${yellow}CONFLICT${reset} ${conflict.alias}: ${conflict.reason}`);
      }
    }
    return;
  }

  if (workflow) {
    bootstrapOxe(opts.dir, { dryRun: false, force: false });
    let pack;
    try {
      pack = oxeContext.buildContextPack(opts.dir, {
        workflow,
        tier: opts.tier,
        activeSession,
        write: true,
      });
    } catch (err) {
      console.error(`${red}Erro ao gerar context pack para "${workflow}": ${err instanceof Error ? err.message : String(err)}${reset}`);
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(pack, null, 2));
      return;
    }
    console.log(`  ${c ? green : ''}✓${c ? reset : ''} Context pack gerado para ${workflow}.`);
    console.log(`  ${c ? green : ''}Quality:${c ? reset : ''} ${pack.context_quality.score} (${pack.context_quality.status})`);
    if (pack.context_quality.score < 30 || pack.context_quality.status === 'critical') {
      console.log(`  ${yellow}AVISO${reset} Contexto crítico — artefatos obrigatórios ausentes. Verifique o STATE e os artefatos do workflow.`);
    }
    console.log(`  ${c ? green : ''}Pack:${c ? reset : ''} ${oxeContext.resolvePackFile(opts.dir, workflow, activeSession)}`);
    return;
  }

  bootstrapOxe(opts.dir, { dryRun: false, force: false });
  let packs;
  try {
    packs = oxeContext.buildAllContextPacks(opts.dir, {
      tier: opts.tier,
      activeSession,
      write: true,
    });
  } catch (err) {
    console.error(`${red}Erro ao gerar context packs: ${err instanceof Error ? err.message : String(err)}${reset}`);
    process.exit(1);
  }
  if (opts.json) {
    console.log(JSON.stringify(packs, null, 2));
    return;
  }
  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${opts.dir}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}Sessão:${c ? reset : ''} ${c ? cyan : ''}${activeSession || 'modo legado'}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}Packs:${c ? reset : ''} ${packs.length}`);
  for (const pack of packs) {
    const qualityFlag = (pack.context_quality.score < 30 || pack.context_quality.status === 'critical') ? ` ${yellow}[CRÍTICO]${reset}` : '';
    console.log(`  ${c ? dim : ''}•${c ? reset : ''} ${pack.workflow} · ${pack.context_quality.score} (${pack.context_quality.status}) · ${pack.freshness.reason}${qualityFlag}`);
  }
}

/**
 * @param {DashboardOpts} opts
 */
async function runDashboard(opts) {
  assertNotWslWindowsNode();
  if (!fs.existsSync(opts.dir)) {
    console.error(`${yellow}Diretório não encontrado: ${opts.dir}${reset}`);
    process.exit(1);
  }
  const target = opts.dir;
  if (opts.dumpContext) {
    console.log(JSON.stringify(oxeDashboard.loadDashboardContext(target, { activeSession: opts.activeSession }), null, 2));
    return;
  }
  const c = useAnsiColors();
  printSection('OXE ▸ dashboard');
  const server = oxeDashboard.createDashboardServer(target, { activeSession: opts.activeSession });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : opts.port;
  const url = `http://127.0.0.1:${port}/`;
  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}URL:${c ? reset : ''} ${c ? cyan : ''}${url}${c ? reset : ''}`);
  if (opts.readOnly) {
    console.log(`  ${c ? yellow : ''}Modo:${c ? reset : ''} read-only (UI visual; persistência deve ser evitada no uso desta flag)`);
  }
  if (!opts.noOpen) {
    try {
      openUrlInBrowser(url);
      console.log(`  ${c ? green : ''}✓${c ? reset : ''} Browser aberto.`);
    } catch {
      console.log(`  ${yellow}Não foi possível abrir o browser automaticamente.${reset}`);
    }
  }
  console.log(`  ${dim}Pressione Ctrl+C para encerrar o servidor local.${reset}\n`);
  await new Promise(() => {});
}

/**
 * @param {RuntimeOpts} opts
 */
async function runRuntime(opts) {
  const c = useAnsiColors();
  printSection('OXE ▸ runtime');
  if (!fs.existsSync(opts.dir)) {
    console.error(`${yellow}Diretório não encontrado: ${opts.dir}${reset}`);
    process.exit(1);
  }
  bootstrapOxe(opts.dir, { dryRun: false, force: false });
  const statePath = oxeHealth.oxePaths(opts.dir).state;
  const stateText = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '';
  const activeSession = opts.activeSession || oxeHealth.parseActiveSession(stateText) || null;
  const p = oxeOperational.operationalPaths(opts.dir, activeSession);
  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${opts.dir}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}Sessão:${c ? reset : ''} ${c ? cyan : ''}${activeSession || 'modo legado'}${c ? reset : ''}`);

  if (opts.action === 'status') {
    const current = oxeOperational.readRunState(opts.dir, activeSession);
    if (!current) {
      if (opts.jsonOutput) console.log(JSON.stringify({ run: null, status: 'absent' }, null, 2));
      else console.log(`  ${yellow}Nenhum ACTIVE-RUN encontrado.${reset}`);
      return;
    }
    const report = oxeHealth.buildHealthReport(opts.dir);
    const gates = oxeOperational.readRuntimeGates
      ? oxeOperational.readRuntimeGates(opts.dir, activeSession, { runId: current.run_id })
      : null;
    const runtimeMode = oxeOperational.buildRuntimeModeStatus
      ? oxeOperational.buildRuntimeModeStatus(current)
      : null;
    const multiAgent = oxeOperational.readRuntimeMultiAgentStatus
      ? oxeOperational.readRuntimeMultiAgentStatus(opts.dir, activeSession, { runId: current.run_id })
      : null;
    if (opts.jsonOutput) {
      console.log(
        JSON.stringify(
          {
            run: current,
            runtimeMode,
            gateQueue: gates,
            gateSla: gates ? gates.gateSlaHours || 24 : 24,
            staleGateCount: gates ? gates.staleCount || 0 : 0,
            policyCoverage: report.policyCoverage || null,
            promotionReadiness: report.promotionReadiness || null,
            recoveryState: report.recoveryState || null,
            providerCatalog: report.providerCatalog || null,
            multiAgent: multiAgent || null,
          },
          null,
          2
        )
      );
      return;
    }
    console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${current.run_id}`);
    console.log(`  ${c ? green : ''}Estado:${c ? reset : ''} ${current.status}`);
    console.log(`  ${c ? green : ''}Cursor:${c ? reset : ''} onda=${current.cursor && current.cursor.wave != null ? current.cursor.wave : '—'} tarefa=${current.cursor && current.cursor.task ? current.cursor.task : '—'} modo=${current.cursor && current.cursor.mode ? current.cursor.mode : '—'}`);
    console.log(`  ${c ? green : ''}Arquivo:${c ? reset : ''} ${path.join(p.runsDir, `${current.run_id}.json`)}`);
    if (current.compiled_graph && current.compiled_graph.metadata) {
      console.log(`  ${c ? green : ''}Graph:${c ? reset : ''} ${current.compiled_graph.metadata.node_count || 0} nós · ${current.compiled_graph.metadata.wave_count || 0} ondas`);
    }
    if (current.canonical_state && current.canonical_state.summary) {
      console.log(`  ${c ? green : ''}Canonical:${c ? reset : ''} work_items=${current.canonical_state.summary.work_item_count || 0} · attempts=${current.canonical_state.summary.attempt_count || 0}`);
    }
    if (current.ci_checks && current.ci_checks.summary) {
      console.log(`  ${c ? green : ''}CI:${c ? reset : ''} pass=${current.ci_checks.summary.pass || 0} fail=${current.ci_checks.summary.fail || 0} skip=${current.ci_checks.summary.skip || 0} error=${current.ci_checks.summary.error || 0}`);
    }
    if (current.projections && current.projections.generated_at) {
      console.log(`  ${c ? green : ''}Projection:${c ? reset : ''} ${current.projections.generated_at}`);
    }
    if (gates) {
      console.log(`  ${c ? green : ''}Gates:${c ? reset : ''} ${gates.pending.length} pendente(s) · stale ${gates.stalePending.length} · SLA ${gates.gateSlaHours || 24}h`);
    }
    if (runtimeMode) {
      console.log(`  ${c ? green : ''}Runtime:${c ? reset : ''} ${runtimeMode.runtime_mode || 'legacy'} · fallback=${runtimeMode.fallback_mode || 'none'}`);
    }
    if (report.policyCoverage) {
      console.log(`  ${c ? green : ''}Policy coverage:${c ? reset : ''} ${report.policyCoverage.coveragePercent}% · uncovered=${report.policyCoverage.uncoveredMutations}`);
    }
    if (report.promotionReadiness) {
      console.log(`  ${c ? green : ''}Promotion readiness:${c ? reset : ''} ${report.promotionReadiness.status}${Array.isArray(report.promotionReadiness.blockers) && report.promotionReadiness.blockers.length ? ` · ${report.promotionReadiness.blockers.join(', ')}` : ''}`);
    }
    if (report.recoveryState) {
      console.log(`  ${c ? green : ''}Recovery:${c ? reset : ''} ${report.recoveryState.status} · recoveries=${report.recoveryState.recoverCount ?? 0} · issues=${Array.isArray(report.recoveryState.issues) ? report.recoveryState.issues.length : 0}`);
    }
    if (multiAgent) {
      console.log(`  ${c ? green : ''}Multi-agent:${c ? reset : ''} ${multiAgent.enabled ? (multiAgent.mode || 'active') : 'disabled'} · agentes=${Array.isArray(multiAgent.agents) ? multiAgent.agents.length : 0} · ownership=${Array.isArray(multiAgent.ownership) ? multiAgent.ownership.length : 0}`);
    }
    if (report.providerCatalog && report.providerCatalog.summary) {
      const summary = report.providerCatalog.summary;
      const pluginsCount = summary.pluginsCount ?? summary.total_plugins ?? (Array.isArray(summary.plugins) ? summary.plugins.length : 0);
      const toolProviders = summary.toolProviders ?? summary.tool_providers ?? 0;
      const verifierProviders = summary.verifierProviders ?? summary.verifier_providers ?? 0;
      const loadErrors = summary.loadErrors ?? summary.load_errors ?? (Array.isArray(report.providerCatalog.load_errors) ? report.providerCatalog.load_errors.length : 0);
      console.log(`  ${c ? green : ''}Providers:${c ? reset : ''} plugins=${pluginsCount} tools=${toolProviders} verifiers=${verifierProviders} load_errors=${loadErrors}`);
    }
    return;
  }

  if (opts.action === 'gates') {
    const sub = opts.subAction || 'list';
    const current = oxeOperational.readRunState(opts.dir, activeSession);
    const runId = opts.runId || (current && current.run_id) || '';
    if (sub === 'list') {
      const gates = oxeOperational.readRuntimeGates(opts.dir, activeSession, {
        runId: runId || null,
        status: opts.gateStatus || 'all',
        scope: opts.gateScope || null,
        task: opts.task || null,
      });
      if (opts.jsonOutput) {
        console.log(JSON.stringify(gates, null, 2));
        return;
      }
      const slaHours = gates.gateSlaHours || 24;
      console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${runId || '—'}`);
      console.log(`  ${c ? green : ''}Gates:${c ? reset : ''} total=${gates.total} pendentes=${gates.pending.length} stale=${gates.stalePending.length} resolvidos<24h=${gates.resolvedRecent.length} SLA=${slaHours}h`);
      console.log(`  ${c ? green : ''}Filtros:${c ? reset : ''} status=${gates.filters.status || 'all'} scope=${gates.filters.scope || '—'} task=${gates.filters.workItemId || '—'}`);
      const allPending = [...gates.pending];
      for (const gate of allPending) {
        const ageHours = gate.requested_at ? Math.max(0, Math.round((Date.now() - Date.parse(gate.requested_at)) / 36e5)) : null;
        const isStale = ageHours != null && ageHours > slaHours;
        const icon = isStale ? `${c ? yellow : ''}⚠ stale (>${slaHours}h)${c ? reset : ''}` : `${c ? yellow : ''}⏳ pending${c ? reset : ''}`;
        const suggested = gate.action === 'approve' ? 'approve' : 'approve|reject|waive';
        console.log(`  ${icon}  ${gate.gate_id} · ${gate.scope || '—'} · ${gate.work_item_id || 'run'}${ageHours != null ? ` · ${ageHours}h aberto` : ''}`);
        console.log(`    ${c ? dim : ''}ação sugerida: --decision ${suggested} · impacto: bloqueia promoção${c ? reset : ''}`);
      }
      for (const gate of gates.resolvedRecent) {
        console.log(`  ${c ? green : ''}✓ resolved${c ? reset : ''}  ${gate.gate_id} · ${gate.scope || '—'} · ${gate.decision || '—'} · ${gate.actor || '—'}`);
      }
      if (gates.pending.length === 0 && gates.resolvedRecent.length === 0) {
        console.log(`  ${c ? dim : ''}Nenhum gate pendente.${c ? reset : ''}`);
      }
      return;
    }
    if (sub === 'show') {
      if (!opts.gateId) {
        console.error(`${red}Use --gate <gate_id> com runtime gates show${reset}`);
        process.exit(1);
      }
      const gates = oxeOperational.readRuntimeGates(opts.dir, activeSession, { runId: runId || null });
      const gate = gates.all.find((entry) => entry.gate_id === opts.gateId);
      if (!gate) {
        console.error(`${red}Gate não encontrado: ${opts.gateId}${reset}`);
        process.exit(1);
      }
      if (opts.jsonOutput) {
        console.log(JSON.stringify(gate, null, 2));
        return;
      }
      console.log(`  ${c ? green : ''}Gate:${c ? reset : ''} ${gate.gate_id}`);
      console.log(`  ${c ? green : ''}Status:${c ? reset : ''} ${gate.status || 'pending'}`);
      console.log(`  ${c ? green : ''}Escopo:${c ? reset : ''} ${gate.scope || '—'} · action=${gate.action || '—'} · work_item=${gate.work_item_id || 'run'}`);
      console.log(`  ${c ? green : ''}Ator:${c ? reset : ''} ${gate.actor || '—'} · decisão=${gate.decision || '—'}`);
      console.log(`  ${c ? green : ''}Motivo:${c ? reset : ''} ${gate.reason || gate.context && gate.context.description || '—'}`);
      if (Array.isArray(gate.resolution_history) && gate.resolution_history.length) {
        console.log(`  ${c ? green : ''}Histórico:${c ? reset : ''}`);
        for (const item of gate.resolution_history) {
          console.log(`    • ${item.timestamp || '—'} · ${item.actor || '—'} · ${item.decision || '—'}${item.reason ? ` · ${item.reason}` : ''}`);
        }
      }
      return;
    }
    if (sub === 'resolve') {
      if (!opts.gateId || !opts.decision || !opts.actor) {
        console.error(`${red}Use --gate, --decision e --actor com runtime gates resolve${reset}`);
        process.exit(1);
      }
      if ((opts.decision === 'reject' || opts.decision === 'waive') && !opts.reason) {
        console.error(`${red}Reject/waive exigem --reason explícito.${reset}`);
        process.exit(1);
      }
      try {
        const resolved = await oxeOperational.resolveRuntimeGate(opts.dir, activeSession, {
          runId: runId || null,
          gateId: opts.gateId,
          decision: opts.decision,
          actor: opts.actor,
          reason: opts.reason || '',
        });
        if (opts.jsonOutput) {
          console.log(JSON.stringify(resolved, null, 2));
          return;
        }
        const remaining = resolved.impact ? (resolved.impact.pendingRemaining || 0) : 0;
        const staleRemaining = resolved.impact ? (resolved.impact.staleRemaining || 0) : 0;
        const canPromote = remaining === 0 && staleRemaining === 0;
        console.log(`  ${c ? green : ''}✓${c ? reset : ''} Gate ${resolved.gate.gate_id} resolvido (${resolved.gate.decision}).`);
        console.log(`  ${c ? green : ''}Ator:${c ? reset : ''} ${resolved.gate.actor}`);
        if (canPromote) {
          console.log(`  ${c ? green : ''}✓ Run pode avançar para promoção — nenhum gate restante.${c ? reset : ''}`);
        } else {
          console.log(`  ${c ? yellow : ''}⚠ Run ainda bloqueada por ${remaining} gate(s) restante(s)${staleRemaining > 0 ? ` (${staleRemaining} stale)` : ''}.${c ? reset : ''}`);
        }
        return;
      } catch (err) {
        console.error(`${red}${err && err.message ? err.message : 'Falha ao resolver gate.'}${reset}`);
        process.exit(1);
      }
    }
    console.error(`${red}Subcomando runtime gates desconhecido: ${sub}${reset}`);
    process.exit(1);
  }

  if (opts.action === 'replay' && !opts.task) {
    const report = opts.jsonOutput
      ? oxeOperational.replayRuntimeState(opts.dir, activeSession, {
          runId: opts.runId || undefined,
          fromEventId: opts.fromEventId || undefined,
          waveId: opts.wave != null ? opts.wave : undefined,
          writeReport: opts.writeReport || false,
        })
      : oxeOperational.replayEvents(opts.dir, activeSession, {
          runId: opts.runId || undefined,
          fromEventId: opts.fromEventId || undefined,
          waveId: opts.wave != null ? opts.wave : undefined,
          writeReport: opts.writeReport || false,
        });
    if (opts.jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`  ${c ? green : ''}Total eventos:${c ? reset : ''} ${report.totalEvents}`);
    console.log(`  ${c ? green : ''}Duração:${c ? reset : ''} ${report.duration_ms != null ? `${(report.duration_ms / 1000).toFixed(1)}s` : '—'}`);
    console.log(`  ${c ? green : ''}Ondas:${c ? reset : ''} ${report.waveIds.join(', ') || '—'}`);
    console.log(`  ${c ? green : ''}Tarefas:${c ? reset : ''} ${report.taskSequence.join(', ') || '—'}`);
    console.log(`  ${c ? green : ''}Falhas:${c ? reset : ''} ${report.failureEvents.length}`);
    if (report.totalEvents > 0) {
      console.log('');
      const dim = c ? '\x1b[2m' : '';
      console.log(`  ${dim}#   Tipo                    Wave    Task    Delta      Timestamp${c ? reset : ''}`);
      for (let i = 0; i < Math.min(report.events.length, 50); i++) {
        const e = report.events[i];
        const delta = i > 0 ? `+${(e._delta_ms / 1000).toFixed(1)}s` : '—';
        const num = String(i + 1).padStart(3);
        const type = String(e.type).padEnd(22).slice(0, 22);
        const wave = String(e.wave_id || '—').padEnd(7).slice(0, 7);
        const task = String(e.task_id || e.work_item_id || '—').padEnd(7).slice(0, 7);
        const deltaStr = delta.padStart(10);
        console.log(`  ${num} ${type} ${wave} ${task} ${deltaStr}  ${e.timestamp}`);
      }
      if (report.events.length > 50) {
        console.log(`  … (${report.events.length - 50} mais)`);
      }
    }
    if (report._reportPath) {
      console.log(`\n  ${c ? green : ''}Relatório:${c ? reset : ''} ${report._reportPath}`);
    }
    return;
  }

  if (opts.action === 'compile') {
    try {
      const compiled = oxeOperational.compileExecutionGraphFromArtifacts(opts.dir, activeSession);
      const suite = oxeOperational.compileVerificationSuiteFromArtifacts(opts.dir, activeSession, {
        runState: compiled.run,
      });
      console.log(`  ${c ? green : ''}✓${c ? reset : ''} Runtime compilado.`);
      console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${compiled.run.run_id}`);
      console.log(`  ${c ? green : ''}Graph:${c ? reset : ''} ${compiled.graph.metadata.node_count} nó(s) · ${compiled.graph.metadata.wave_count} onda(s)`);
      console.log(`  ${c ? green : ''}Checks:${c ? reset : ''} ${Array.isArray(suite.suite.checks) ? suite.suite.checks.length : 0}`);
      if (compiled.validationErrors.length) {
        console.log(`  ${yellow}Validation:${reset} ${compiled.validationErrors.join(' | ')}`);
      }
      console.log(`  ${c ? green : ''}Arquivo:${c ? reset : ''} ${path.join(p.runsDir, `${compiled.run.run_id}.json`)}`);
      return;
    } catch (err) {
      console.error(`${red}${err && err.message ? err.message : 'Falha ao compilar o runtime.'}${reset}`);
      process.exit(1);
    }
  }

  if (opts.action === 'verify') {
    try {
      const verified = await oxeOperational.runRuntimeVerify(opts.dir, activeSession, {
        runId: opts.runId || undefined,
        task: opts.task || undefined,
        workItemId: opts.task || undefined,
        timeoutMs: opts.timeoutMs || undefined,
      });
      if (opts.jsonOutput) {
        console.log(JSON.stringify(verified, null, 2));
        return;
      }
      console.log(`  ${c ? green : ''}✓${c ? reset : ''} Runtime verify executado.`);
      console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${verified.run.run_id}`);
      console.log(`  ${c ? green : ''}Status:${c ? reset : ''} ${verified.report.status}`);
      if (verified.report.manifest && verified.report.manifest.summary) {
        console.log(`  ${c ? green : ''}Checks:${c ? reset : ''} total=${verified.report.manifest.summary.total} pass=${verified.report.manifest.summary.pass} fail=${verified.report.manifest.summary.fail} error=${verified.report.manifest.summary.error}`);
      }
      if (verified.report.evidence_coverage) {
        console.log(`  ${c ? green : ''}Coverage:${c ? reset : ''} ${verified.report.evidence_coverage.coverage_percent}%`);
      }
      if (verified.report.gaps.length) {
        for (const gap of verified.report.gaps) {
          console.log(`  ${yellow}GAP${reset} ${gap}`);
        }
      }
      console.log(`  ${c ? green : ''}VERIFY:${c ? reset : ''} ${verified.projected.paths.verify}`);
      return;
    } catch (err) {
      console.error(`${red}${err && err.message ? err.message : 'Falha ao executar runtime verify.'}${reset}`);
      process.exit(1);
    }
  }

  if (opts.action === 'project') {
    try {
      const projected = oxeOperational.projectRuntimeArtifacts(opts.dir, activeSession, { write: true });
      console.log(`  ${c ? green : ''}✓${c ? reset : ''} Projeções geradas a partir do estado canônico.`);
      console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${projected.run.run_id}`);
      console.log(`  ${c ? green : ''}STATE:${c ? reset : ''} ${projected.paths.state}`);
      console.log(`  ${c ? green : ''}PLAN:${c ? reset : ''} ${projected.paths.plan}`);
      console.log(`  ${c ? green : ''}VERIFY:${c ? reset : ''} ${projected.paths.verify}`);
      console.log(`  ${c ? green : ''}RUN-SUMMARY:${c ? reset : ''} ${projected.paths.runSummary}`);
      console.log(`  ${c ? green : ''}PR-SUMMARY:${c ? reset : ''} ${projected.paths.prSummary}`);
      return;
    } catch (err) {
      console.error(`${red}${err && err.message ? err.message : 'Falha ao projetar artefatos do runtime.'}${reset}`);
      process.exit(1);
    }
  }

  if (opts.action === 'ci') {
    try {
      const report = await oxeOperational.runRuntimeCiChecks(opts.dir, activeSession, {
        runId: opts.runId || undefined,
      });
      if (opts.jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
        if (!report.summary.allPassed) process.exitCode = 1;
        return;
      }
      console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${report.runId || '—'}`);
      for (const result of report.results) {
        const color = result.status === 'pass'
          ? green
          : result.status === 'skip'
            ? dim
            : red;
        console.log(`  ${c ? color : ''}${result.status.toUpperCase()}${c ? reset : ''} ${result.check} · ${result.message}`);
      }
      console.log(`  ${c ? green : ''}Resumo:${c ? reset : ''} pass=${report.summary.pass} fail=${report.summary.fail} skip=${report.summary.skip} error=${report.summary.error}`);
      if (!report.summary.allPassed) {
        process.exitCode = 1;
      }
      return;
    } catch (err) {
      console.error(`${red}${err && err.message ? err.message : 'Falha ao executar checks do runtime.'}${reset}`);
      process.exit(1);
    }
  }

  if (opts.action === 'promote') {
    try {
      const promoted = await oxeOperational.runRuntimePromotion(opts.dir, activeSession, {
        runId: opts.runId || undefined,
        targetKind: opts.targetKind || 'pr_draft',
        remote: opts.remote || 'origin',
        baseBranch: opts.baseBranch || 'main',
        minimumCoverage: opts.minimumCoverage == null ? 100 : opts.minimumCoverage,
      });
      if (opts.jsonOutput) {
        console.log(JSON.stringify(promoted, null, 2));
        return;
      }
      console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${promoted.run.run_id}`);
      console.log(`  ${c ? green : ''}Commit:${c ? reset : ''} ${promoted.commitRecord.commit_sha || '—'} · ${promoted.commitRecord.status}`);
      console.log(`  ${c ? green : ''}Promotion:${c ? reset : ''} ${promoted.promotion.target_kind} · ${promoted.promotion.status}`);
      if (promoted.promotion.pr_url) {
        console.log(`  ${c ? green : ''}PR:${c ? reset : ''} ${promoted.promotion.pr_url}`);
      }
      if (Array.isArray(promoted.promotion.reasons) && promoted.promotion.reasons.length) {
        for (const reason of promoted.promotion.reasons) {
          console.log(`  ${yellow}BLOCKER${reset} ${reason}`);
        }
      }
      return;
    } catch (err) {
      console.error(`${red}${err && err.message ? err.message : 'Falha ao promover a run.'}${reset}`);
      process.exit(1);
    }
  }

  if (opts.action === 'recover') {
    try {
      const recovered = oxeOperational.recoverRuntimeState(opts.dir, activeSession, {
        runId: opts.runId || undefined,
      });
      if (opts.jsonOutput) {
        console.log(JSON.stringify(recovered, null, 2));
        return;
      }
      console.log(`  ${c ? green : ''}✓${c ? reset : ''} Runtime recover concluído.`);
      console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${recovered.run.run_id}`);
      console.log(`  ${c ? green : ''}Estado:${c ? reset : ''} ${recovered.run.status}`);
      console.log(`  ${c ? green : ''}Journal:${c ? reset : ''} ${recovered.journal.scheduler_state}`);
      console.log(`  ${c ? green : ''}Órfãos:${c ? reset : ''} ${(recovered.recoverySummary.orphan_work_items || []).join(', ') || '—'}`);
      return;
    } catch (err) {
      console.error(`${red}${err && err.message ? err.message : 'Falha ao executar recover.'}${reset}`);
      process.exit(1);
    }
  }

  if (opts.action === 'agents') {
    const sub = opts.subAction || 'status';
    if (sub !== 'status') {
      console.error(`${red}Subcomando runtime agents desconhecido: ${sub}${reset}`);
      process.exit(1);
    }
    const current = oxeOperational.readRunState(opts.dir, activeSession);
    const runId = opts.runId || (current && current.run_id) || '';
    const multiAgent = oxeOperational.readRuntimeMultiAgentStatus
      ? oxeOperational.readRuntimeMultiAgentStatus(opts.dir, activeSession, { runId: runId || null })
      : null;
    if (opts.jsonOutput) {
      console.log(JSON.stringify(multiAgent, null, 2));
      return;
    }
    if (!multiAgent) {
      console.log(`  ${yellow}Multi-agent indisponível para o escopo atual.${reset}`);
      return;
    }
    console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${multiAgent.runId || '—'}`);
    console.log(`  ${c ? green : ''}Modo:${c ? reset : ''} ${multiAgent.enabled ? (multiAgent.mode || 'active') : 'disabled'}`);
    console.log(`  ${c ? green : ''}Isolamento:${c ? reset : ''} ${multiAgent.workspaceIsolationEnforced ? 'enforced' : 'shared/disabled'}`);
    console.log(`  ${c ? green : ''}Agentes:${c ? reset : ''} ${Array.isArray(multiAgent.agents) ? multiAgent.agents.length : 0} · ownership=${Array.isArray(multiAgent.ownership) ? multiAgent.ownership.length : 0} · handoffs=${Array.isArray(multiAgent.handoffs) ? multiAgent.handoffs.length : 0}`);
    return;
  }

  try {
    const next = oxeOperational.applyRuntimeAction(opts.dir, activeSession, {
      action: opts.action,
      wave: opts.wave,
      task: opts.task || null,
      mode: opts.mode || null,
      reason: opts.reason || '',
    });
    console.log(`  ${c ? green : ''}✓${c ? reset : ''} Runtime atualizado.`);
    console.log(`  ${c ? green : ''}Run:${c ? reset : ''} ${next.run_id}`);
    console.log(`  ${c ? green : ''}Estado:${c ? reset : ''} ${next.status}`);
    console.log(`  ${c ? green : ''}Cursor:${c ? reset : ''} onda=${next.cursor && next.cursor.wave != null ? next.cursor.wave : '—'} tarefa=${next.cursor && next.cursor.task ? next.cursor.task : '—'} modo=${next.cursor && next.cursor.mode ? next.cursor.mode : '—'}`);
    console.log(`  ${c ? green : ''}Trace:${c ? reset : ''} ${p.events}`);
  } catch (err) {
    console.error(`${red}${err && err.message ? err.message : 'Falha ao atualizar runtime.'}${reset}`);
    process.exit(1);
  }
}

/**
 * @param {AzureOpts} opts
 */
function runAzure(opts) {
  const c = useAnsiColors();
  printSection('OXE ▸ azure');
  if (!fs.existsSync(opts.dir)) {
    console.error(`${yellow}Diretório não encontrado: ${opts.dir}${reset}`);
    process.exit(1);
  }
  bootstrapOxe(opts.dir, { dryRun: false, force: false });
  oxeAzure.ensureAzureArtifacts(opts.dir);
  oxeAzure.ensureAzureCapabilities(opts.dir);
  writeCapabilitiesIndex(opts.dir);
  const { config } = oxeHealth.loadOxeConfigMerged(opts.dir);
  const statePath = oxeHealth.oxePaths(opts.dir).state;
  const stateText = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '';
  const activeSession = opts.activeSession || oxeHealth.parseActiveSession(stateText) || null;
  const azureCfg = config.azure && typeof config.azure === 'object' ? config.azure : {};
  const preferredLocation = Array.isArray(azureCfg.preferred_locations) && azureCfg.preferred_locations.length
    ? String(azureCfg.preferred_locations[0])
    : '';
  const input = {
    kind: opts.kind,
    resourceGroup: opts.resourceGroup || String(azureCfg.default_resource_group || ''),
    name: opts.name || opts.server,
    namespace: opts.namespace,
    topicName: opts.topicName,
    subscriptionName: opts.subscriptionName,
    sourceResourceId: opts.sourceResourceId,
    endpoint: opts.endpoint,
    location: opts.location || preferredLocation,
    server: opts.server,
    database: opts.database,
    adminUser: opts.adminUser,
    adminPasswordEnv: opts.adminPasswordEnv || 'AZURE_SQL_ADMIN_PASSWORD',
    startIpAddress: opts.startIpAddress,
    endIpAddress: opts.endIpAddress,
    env: process.env,
  };

  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${opts.dir}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}Sessão:${c ? reset : ''} ${c ? cyan : ''}${activeSession || 'modo legado'}${c ? reset : ''}`);

  try {
    if (opts.scope === 'status') {
      const st = oxeAzure.statusAzure(opts.dir, config);
      const loginColor = st.loginActive ? green : red;
      const invColor = st.inventoryPresent && !st.inventoryStale ? green : yellow;
      console.log(`  ${c ? (st.cliInstalled ? green : red) : ''}CLI:${c ? reset : ''}       ${st.cliInstalled ? `Azure CLI ${st.cliVersion || 'detectada'}` : 'não instalada'}`);
      console.log(`  ${c ? loginColor : ''}Login:${c ? reset : ''}     ${st.loginActive ? 'ativo' : 'ausente'}`);
      console.log(`  ${c ? green : ''}Sub:${c ? reset : ''}       ${st.subscription || '—'}`);
      console.log(`  ${c ? invColor : ''}Inventário:${c ? reset : ''} ${st.inventoryPresent ? `${st.inventoryAgeHours !== null ? `${st.inventoryAgeHours}h atrás` : 'presente'}${st.inventoryStale ? ' (stale)' : ''}` : 'ausente'}`);
      if (st.inventorySummary) {
        console.log(`  ${c ? green : ''}Recursos:${c ? reset : ''}  total=${st.inventorySummary.total} sb=${st.inventorySummary.servicebus} eg=${st.inventorySummary.eventgrid} sql=${st.inventorySummary.sql}`);
      }
      if (st.pendingOperations > 0) {
        console.log(`  ${yellow}Ops pendentes:${reset} ${st.pendingOperations} (${st.pendingOperationIds.join(', ')})`);
      }
      if (st.vpnRequired) {
        console.log(`  ${yellow}VPN:${reset}       requerida pela configuração do projeto`);
      }
      return;
    }

    if (opts.scope === 'operations') {
      const ops = oxeAzure.listAzureOperations(opts.dir);
      if (!ops.length) {
        console.log(`  ${c ? dim : ''}Nenhuma operação registrada.${c ? reset : ''}`);
        return;
      }
      for (const op of ops) {
        const phaseColor = op.phase === 'applied' ? green : op.phase === 'waiting_approval' ? yellow : op.phase === 'failed' ? red : dim;
        console.log(`  ${c ? phaseColor : ''}${op.phase}${c ? reset : ''} · ${op.operation_id} · ${op.domain}/${op.kind} · ${op.summary || '—'}`);
      }
      return;
    }

    if (opts.scope === 'doctor') {
      const report = oxeAzure.azureDoctor(opts.dir, config, {
        autoInstall: Boolean(azureCfg.resource_graph_auto_install !== false),
      });
      console.log(`  ${c ? green : ''}CLI:${c ? reset : ''} ${report.authStatus.installed ? `Azure CLI ${report.authStatus.version || 'detectada'}` : 'não instalada'}`);
      console.log(`  ${c ? green : ''}Login:${c ? reset : ''} ${report.authStatus.login_active ? 'ativo' : 'ausente'}`);
      console.log(`  ${c ? green : ''}Subscription:${c ? reset : ''} ${report.profile.subscription_name || report.profile.subscription_id || '—'}`);
      console.log(`  ${c ? green : ''}Inventário:${c ? reset : ''} ${report.inventory && report.inventory.synced_at ? `sync em ${report.inventory.synced_at}` : 'ausente'}`);
      if (report.warnings.length) {
        for (const warning of report.warnings) {
          console.log(`  ${yellow}AVISO${reset} ${warning}`);
        }
      } else {
        console.log(`  ${c ? green : ''}✓${c ? reset : ''} Contexto Azure saudável.`);
      }
      if (!report.authStatus.installed || !report.authStatus.login_active || !report.profile.subscription_id) {
        process.exit(1);
      }
      return;
    }

    if (opts.scope === 'auth') {
      if (opts.action === 'login') {
        const context = oxeAzure.loginAzure(opts.dir, { inherit: true, tenant: opts.tenant || undefined });
        console.log(`  ${c ? green : ''}✓${c ? reset : ''} Login Azure concluído.`);
        console.log(`  ${c ? green : ''}Conta:${c ? reset : ''} ${context.authStatus.user || '—'}`);
        console.log(`  ${c ? green : ''}Subscription:${c ? reset : ''} ${context.profile.subscription_name || context.profile.subscription_id || '—'}`);
        return;
      }
      if (opts.action === 'whoami' || !opts.action) {
        const context = oxeAzure.getAzureContext(opts.dir);
        console.log(`  ${c ? green : ''}Cloud:${c ? reset : ''} ${context.profile.cloud || '—'}`);
        console.log(`  ${c ? green : ''}Conta:${c ? reset : ''} ${context.authStatus.user || '—'}`);
        console.log(`  ${c ? green : ''}Tipo:${c ? reset : ''} ${context.authStatus.user_type || context.profile.auth_mode || '—'}`);
        console.log(`  ${c ? green : ''}Tenant:${c ? reset : ''} ${context.profile.tenant_id || '—'}`);
        console.log(`  ${c ? green : ''}Subscription:${c ? reset : ''} ${context.profile.subscription_name || context.profile.subscription_id || '—'}`);
        console.log(`  ${c ? green : ''}Resource Graph:${c ? reset : ''} ${context.authStatus.resource_graph_enabled ? 'habilitado' : 'ausente'}`);
        return;
      }
      if (opts.action === 'set-subscription') {
        if (!opts.subscription) {
          console.error(`${red}Informe --subscription <id|nome>.${reset}`);
          process.exit(1);
        }
        const context = oxeAzure.setAzureSubscription(opts.dir, opts.subscription);
        console.log(`  ${c ? green : ''}✓${c ? reset : ''} Subscription selecionada.`);
        console.log(`  ${c ? green : ''}Subscription:${c ? reset : ''} ${context.profile.subscription_name || context.profile.subscription_id || '—'}`);
        return;
      }
      throw new Error(`Subcomando Azure auth desconhecido: ${opts.action || '—'}`);
    }

    if (opts.scope === 'sync') {
      const synced = oxeAzure.syncAzureInventory(opts.dir, {
        autoInstall: Boolean(azureCfg.resource_graph_auto_install !== false),
        diff: opts.diff,
      });
      console.log(`  ${c ? green : ''}✓${c ? reset : ''} Inventário Azure sincronizado.`);
      console.log(`  ${c ? green : ''}Subscription:${c ? reset : ''} ${synced.profile.subscription_name || synced.profile.subscription_id || '—'}`);
      console.log(`  ${c ? green : ''}Resumo:${c ? reset : ''} total=${synced.inventory.summary.total} servicebus=${synced.inventory.summary.servicebus} eventgrid=${synced.inventory.summary.eventgrid} sql=${synced.inventory.summary.sql}`);
      console.log(`  ${c ? green : ''}Artefato:${c ? reset : ''} ${synced.paths.inventory}`);
      if (synced.diff) {
        const d = synced.diff;
        console.log(`  ${c ? green : ''}Diff:${c ? reset : ''} +${d.added.length} adicionados · -${d.removed.length} removidos · ${d.unchanged} inalterados`);
        for (const item of d.added) console.log(`    ${c ? green : ''}+${c ? reset : ''} ${item.name} · ${item.type} · ${item.resourceGroup || '—'}`);
        for (const item of d.removed) console.log(`    ${c ? red : ''}-${c ? reset : ''} ${item.name} · ${item.type} · ${item.resourceGroup || '—'}`);
      }
      return;
    }

    if (opts.scope === 'find') {
      const filters = {};
      if (opts.filterType) filters.type = opts.filterType;
      if (opts.filterRg) filters.resourceGroup = opts.filterRg;
      const matches = oxeAzure.searchAzureInventory(opts.dir, opts.query, filters);
      if (!matches.length) {
        console.log(`  ${yellow}Nenhum recurso encontrado no inventário local.${reset}`);
        return;
      }
      for (const item of matches) {
        console.log(`  ${c ? dim : ''}•${c ? reset : ''} ${item.name} · ${item.type} · ${item.resourceGroup || '—'} · ${item.location || '—'}`);
      }
      return;
    }

    if (!['servicebus', 'eventgrid', 'sql'].includes(opts.scope)) {
      throw new Error(`Escopo Azure desconhecido: ${opts.scope}. Use: doctor | status | auth | sync | find | operations | servicebus | eventgrid | sql`);
    }
    if (!opts.action) {
      throw new Error(`Informe a ação para ${opts.scope}: list | show | plan | apply`);
    }

    if (opts.action === 'list' || opts.action === 'show') {
      const result = oxeAzure.executeAzureRead(opts.dir, activeSession, opts.scope, opts.action, input);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (opts.action === 'plan') {
      const planned = oxeAzure.planAzureOperation(opts.dir, activeSession, opts.scope, input);
      console.log(`  ${c ? green : ''}✓${c ? reset : ''} Operação Azure planejada.`);
      console.log(`  ${c ? green : ''}Operation ID:${c ? reset : ''} ${planned.operation.operation_id}`);
      console.log(`  ${c ? green : ''}Checkpoint:${c ? reset : ''} ${planned.operation.checkpoint_id}`);
      console.log(`  ${c ? green : ''}Comando:${c ? reset : ''} ${planned.operation.command_display_redacted}`);
      console.log(`  ${c ? green : ''}Resumo:${c ? reset : ''} ${planned.operation.summary}`);
      console.log(`  ${c ? green : ''}Artefatos:${c ? reset : ''} ${planned.files.jsonPath} · ${planned.files.mdPath}`);
      return;
    }
    if (opts.action === 'apply') {
      const applied = oxeAzure.applyAzureOperation(opts.dir, activeSession, opts.scope, input, {
        approve: opts.approve,
        overridePolicy: opts.overridePolicy,
        dryRun: opts.dryRun,
        vpnRequired: Boolean(azureCfg.vpn_required),
        vpnConfirmed: opts.vpnConfirmed,
      });
      if (applied.dryRun) {
        console.log(`  ${yellow}[dry-run]${reset} Validação OK — nenhuma alteração foi feita.`);
        console.log(`  ${c ? green : ''}Comando:${c ? reset : ''} ${applied.commandPreview}`);
        console.log(`  ${c ? green : ''}Resumo:${c ? reset : ''} ${applied.operation.summary}`);
        return;
      }
      if (!applied.approved) {
        console.log(`  ${yellow}Checkpoint aberto antes da mutação.${reset}`);
        console.log(`  ${c ? green : ''}Operation ID:${c ? reset : ''} ${applied.operation.operation_id}`);
        console.log(`  ${c ? green : ''}Checkpoint:${c ? reset : ''} ${applied.checkpoint_id}`);
        console.log(`  ${c ? green : ''}Resumo:${c ? reset : ''} ${applied.operation.summary}`);
        console.log(`  ${c ? green : ''}Reexecute:${c ? reset : ''} npx oxe-cc azure ${opts.scope} apply --approve --kind ${applied.operation.kind} --resource-group ${applied.operation.resource_group}`);
        return;
      }
      console.log(`  ${c ? green : ''}✓${c ? reset : ''} Operação Azure aplicada.`);
      console.log(`  ${c ? green : ''}Operation ID:${c ? reset : ''} ${applied.operation.operation_id}`);
      console.log(`  ${c ? green : ''}Artefatos:${c ? reset : ''} ${applied.files.jsonPath} · ${applied.files.mdPath}`);
      return;
    }

    throw new Error(`Ação Azure desconhecida: ${opts.action}`);
  } catch (err) {
    console.error(`${red}${err && err.message ? err.message : 'Falha no provider Azure.'}${reset}`);
    process.exit(1);
  }
}

function capabilityManifestPath(target, id) {
  return path.join(target, '.oxe', 'capabilities', id, 'CAPABILITY.md');
}

function listLocalCapabilities(target) {
  const dir = path.join(target, '.oxe', 'capabilities');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'CAPABILITY.md')))
    .map((e) => e.name)
    .sort();
}

function renderCapabilitiesIndex(target) {
  const template = ['# OXE — Capabilities Instaladas', '', '> Catálogo local de capabilities do projeto. Cada capability vive em `.oxe/capabilities/<id>/`.', '', '| ID | Tipo | Status | Escopo | Política | Side effects | Requer env | Evidência | Resumo |', '|----|------|--------|--------|-----------|--------------|------------|-----------|--------|'];
  const catalog = oxeOperational.readCapabilityCatalog(target);
  if (!catalog.length) {
    template.push('| (vazio) | — | — | — | — | — | — | — | Nenhuma capability instalada |');
    return template.join('\n') + '\n';
  }
  for (const cap of catalog) {
    template.push(`| ${cap.id} | ${cap.type} | ${cap.status} | ${cap.scope} | ${cap.approvalPolicy || '—'} | ${(cap.sideEffects || []).join(', ') || '—'} | ${(cap.requiresEnv || []).join(', ') || '—'} | ${(cap.evidenceOutputs || []).join(', ') || '—'} | ${cap.description} |`);
  }
  return template.join('\n') + '\n';
}

function writeCapabilitiesIndex(target) {
  const dest = path.join(target, '.oxe', 'CAPABILITIES.md');
  fs.writeFileSync(dest, renderCapabilitiesIndex(target), 'utf8');
}

/**
 * @param {CapabilityOpts} opts
 */
function runCapabilities(opts) {
  const c = useAnsiColors();
  printSection('OXE ▸ capabilities');
  if (!fs.existsSync(opts.dir)) {
    console.error(`${yellow}Diretório não encontrado: ${opts.dir}${reset}`);
    process.exit(1);
  }
  bootstrapOxe(opts.dir, { dryRun: false, force: false });
  const capsDir = path.join(opts.dir, '.oxe', 'capabilities');
  ensureDir(capsDir);
  if (opts.action === 'list') {
    const ids = listLocalCapabilities(opts.dir);
    console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${opts.dir}${c ? reset : ''}`);
    if (!ids.length) {
      console.log(`  ${yellow}Nenhuma capability instalada.${reset}`);
    } else {
      for (const id of ids) console.log(`  ${c ? dim : ''}•${c ? reset : ''} ${id}`);
    }
    return;
  }
  if (!opts.id && (opts.action === 'install' || opts.action === 'remove')) {
    console.error(`${red}Informe o ID da capability.${reset}`);
    process.exit(1);
  }
  if (opts.action === 'install') {
    const safeId = opts.id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(safeId)) {
      console.error(`${red}ID inválido para capability:${reset} ${opts.id}`);
      process.exit(1);
    }
    const dir = path.join(capsDir, safeId);
    ensureDir(dir);
    const manifest = capabilityManifestPath(opts.dir, safeId);
    if (!fs.existsSync(manifest)) {
      const src = path.join(PKG_ROOT, 'oxe', 'templates', 'CAPABILITY.template.md');
      let raw = fs.readFileSync(src, 'utf8');
      raw = raw.replace(/^id:\s*sample-capability$/m, `id: ${safeId}`);
      fs.writeFileSync(manifest, raw, 'utf8');
    }
    writeCapabilitiesIndex(opts.dir);
    oxeOperational.appendEvent(opts.dir, null, { type: 'capability_installed', payload: { capability_id: safeId } });
    console.log(`  ${c ? green : ''}✓${c ? reset : ''} Capability instalada: ${safeId}`);
    return;
  }
  if (opts.action === 'remove') {
    fs.rmSync(path.join(capsDir, opts.id), { recursive: true, force: true });
    writeCapabilitiesIndex(opts.dir);
    oxeOperational.appendEvent(opts.dir, null, { type: 'capability_removed', payload: { capability_id: opts.id } });
    console.log(`  ${c ? green : ''}✓${c ? reset : ''} Capability removida: ${opts.id}`);
    return;
  }
  if (opts.action === 'update') {
    writeCapabilitiesIndex(opts.dir);
    oxeOperational.appendEvent(opts.dir, null, { type: 'capability_index_refreshed' });
    console.log(`  ${c ? green : ''}✓${c ? reset : ''} Índice de capabilities atualizado.`);
    return;
  }
  console.error(`${red}Ação desconhecida:${reset} ${opts.action}`);
  process.exit(1);
}

/**
 * @param {string[]} argv
 * @returns {{ help: boolean, dir: string, visual: boolean, activeSession: string|null, parseError: boolean, unknownFlag: string }}
 */
function parsePlanArgs(argv) {
  const out = { help: false, dir: process.cwd(), visual: false, activeSession: null, parseError: false, unknownFlag: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--visual') out.visual = true;
    else if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (a === '--session' && argv[i + 1]) out.activeSession = String(argv[++i]).replace(/\\/g, '/');
    else if (!a.startsWith('-') && i === 0) out.dir = path.resolve(a);
    else { out.parseError = true; out.unknownFlag = a; break; }
  }
  return out;
}

/**
 * @param {string[]} argv
 * @returns {{ help: boolean, dir: string, matrix: boolean, activeSession: string|null, parseError: boolean, unknownFlag: string }}
 */
function parseVerifyArgs(argv) {
  const out = { help: false, dir: process.cwd(), matrix: false, activeSession: null, parseError: false, unknownFlag: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--matrix') out.matrix = true;
    else if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (a === '--session' && argv[i + 1]) out.activeSession = String(argv[++i]).replace(/\\/g, '/');
    else if (!a.startsWith('-') && i === 0) out.dir = path.resolve(a);
    else { out.parseError = true; out.unknownFlag = a; break; }
  }
  return out;
}

/**
 * Imprime grafo ASCII de ondas e tarefas lido do PLAN.md.
 * @param {{ dir: string, activeSession: string|null }} opts
 */
function runPlanVisual(opts) {
  const c = useAnsiColors();
  printSection('OXE ▸ plan --visual');
  const statePath = oxeHealth.oxePaths(opts.dir).state;
  const stateText = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '';
  const activeSession = opts.activeSession || oxeHealth.parseActiveSession(stateText) || null;
  const sp = oxeHealth.scopedOxePaths(opts.dir, activeSession);
  const planPath = sp.plan || oxeHealth.oxePaths(opts.dir).plan;

  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${opts.dir}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}Sessão:${c ? reset : ''} ${c ? cyan : ''}${activeSession || 'modo legado'}${c ? reset : ''}`);

  if (!fs.existsSync(planPath)) {
    console.log(`\n  ${yellow}PLAN.md não encontrado em ${planPath}${reset}`);
    console.log(`  ${dim}Rode /oxe-plan para criar o plano.${reset}\n`);
    return;
  }

  const planMd = fs.readFileSync(planPath, 'utf8');
  const plan = oxeDashboard.parsePlan(planMd);

  if (!plan.waves.length) {
    console.log(`\n  ${yellow}Nenhuma onda encontrada no PLAN.md.${reset}\n`);
    return;
  }

  console.log('');
  for (const wave of plan.waves) {
    const waveLabel = `  ${c ? yellow : ''}Onda ${wave.wave}${c ? reset : ''}`;
    for (let i = 0; i < wave.tasks.length; i++) {
      const task = wave.tasks[i];
      const deps = task.dependsOn.length ? ` ${c ? dim : ''}← ${task.dependsOn.join(', ')}${c ? reset : ''}` : '';
      const complexity = task.complexity ? ` ${c ? dim : ''}[${task.complexity}]${c ? reset : ''}` : '';
      if (i === 0) {
        console.log(`${waveLabel}   ${c ? cyan : ''}${task.id}${c ? reset : ''} — ${task.title}${complexity}${deps}`);
      } else {
        console.log(`${''.padEnd(waveLabel.replace(/\x1b\[[0-9;]*m/g, '').length + 3)}${c ? cyan : ''}${task.id}${c ? reset : ''} — ${task.title}${complexity}${deps}`);
      }
    }
    console.log('');
  }

  const total = plan.totalTasks;
  const waveCount = plan.waves.length;
  console.log(`  ${c ? dim : ''}${total} tarefa${total !== 1 ? 's' : ''} · ${waveCount} onda${waveCount !== 1 ? 's' : ''}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}✓${c ? reset : ''} plan --visual concluído.\n`);
}

/**
 * Imprime tabela ANSI spec → plan → verify (coverage matrix).
 * @param {{ dir: string, activeSession: string|null }} opts
 */
function runVerifyMatrix(opts) {
  const c = useAnsiColors();
  printSection('OXE ▸ verify --matrix');
  const statePath = oxeHealth.oxePaths(opts.dir).state;
  const stateText = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '';
  const activeSession = opts.activeSession || oxeHealth.parseActiveSession(stateText) || null;
  const sp = oxeHealth.scopedOxePaths(opts.dir, activeSession);
  const specPath = sp.spec || oxeHealth.oxePaths(opts.dir).spec;
  const planPath = sp.plan || oxeHealth.oxePaths(opts.dir).plan;
  const verifyPath = sp.verify || oxeHealth.oxePaths(opts.dir).verify;

  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${opts.dir}${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}Sessão:${c ? reset : ''} ${c ? cyan : ''}${activeSession || 'modo legado'}${c ? reset : ''}`);

  const specMd = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '';
  const planMd = fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf8') : '';
  const verifyMd = fs.existsSync(verifyPath) ? fs.readFileSync(verifyPath, 'utf8') : '';

  const spec = oxeDashboard.parseSpec(specMd);
  const plan = oxeDashboard.parsePlan(planMd);
  const verify = oxeDashboard.parseVerify(verifyMd);
  const matrix = oxeDashboard.buildCoverageMatrix(spec, plan, verify);

  if (!matrix.length) {
    if (!spec.criteria.length) {
      console.log(`\n  ${yellow}Nenhum critério A* encontrado no SPEC.md.${reset}`);
      console.log(`  ${dim}Rode /oxe-spec para criar a especificação.${reset}\n`);
    } else {
      console.log(`\n  ${yellow}Nenhum dado disponível para a matriz.${reset}\n`);
    }
    return;
  }

  const statusSymbol = (s) => {
    if (s === 'passed') return c ? `${green}✓${reset}` : '✓';
    if (s === 'failed') return c ? `${red}✗${reset}` : '✗';
    return c ? `${dim}—${reset}` : '—';
  };
  const planSymbol = (covered) => covered ? (c ? `${green}✓${reset}` : '✓') : (c ? `${dim}✗${reset}` : '✗');

  // Compute column widths
  const colId = Math.max(9, ...matrix.map((r) => r.id.length)) + 2;
  const colTasks = Math.max(12, ...matrix.map((r) => (r.tasks.join(', ') || '—').length)) + 2;

  const sep = `  ${'─'.repeat(colId)}┼${'─'.repeat(colTasks)}┼──────────┼──────────`;
  const header = `  ${' Critério'.padEnd(colId)}│${'  Tarefas'.padEnd(colTasks)}│  PLAN    │  VERIFY`;

  console.log('');
  console.log(c ? `${dim}${header}${reset}` : header);
  console.log(sep);

  let covered = 0;
  let verified = 0;
  for (const row of matrix) {
    const tasks = row.tasks.length ? row.tasks.join(', ') : '—';
    const planCell = planSymbol(row.planCovered);
    const verifyCell = statusSymbol(row.verifyStatus);
    const label = `  ${row.id}`.padEnd(colId);
    const taskCell = `  ${tasks}`.padEnd(colTasks);
    console.log(`${label}│${taskCell}│  ${planCell}       │  ${verifyCell}`);
    if (row.planCovered) covered++;
    if (row.verifyStatus === 'passed') verified++;
  }

  console.log(sep);
  const total = matrix.length;
  console.log(`\n  ${c ? dim : ''}${covered}/${total} critérios cobertos pelo plano · ${verified}/${total} aprovados no verify${c ? reset : ''}`);
  console.log(`  ${c ? green : ''}✓${c ? reset : ''} verify --matrix concluído.\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  let command = 'install';
  if (
    argv[0] === 'doctor' ||
    argv[0] === 'status' ||
    argv[0] === 'init-oxe' ||
    argv[0] === 'context' ||
    argv[0] === 'dashboard' ||
    argv[0] === 'runtime' ||
    argv[0] === 'azure' ||
    argv[0] === 'uninstall' ||
    argv[0] === 'update' ||
    argv[0] === 'capabilities' ||
    argv[0] === 'plugins' ||
    argv[0] === 'plan' ||
    argv[0] === 'verify' ||
    argv[0] === 'install'
  ) {
    command = argv[0];
    argv.shift();
  }

  if (command === 'uninstall') {
    const u = parseUninstallArgs(argv);
    if (u.help) {
      printBanner();
      usage();
      process.exit(0);
    }
    if (u.conflictFlags) {
      printBanner();
      console.error(`${red}${u.conflictFlags}${reset}`);
      usage();
      process.exit(1);
    }
    if (u.parseError) {
      printBanner();
      console.error(`${red}Opção desconhecida:${reset} ${u.unknownFlag}`);
      usage();
      process.exit(1);
    }
    printBanner();
    if (!u.dryRun && !fs.existsSync(u.dir)) {
      console.error(`${yellow}Diretório não encontrado: ${u.dir}${reset}`);
      process.exit(1);
    }
    runUninstall(u);
    return;
  }

  if (command === 'update') {
    const u = parseUpdateArgs(argv);
    if (u.help) {
      printBanner();
      usage();
      process.exit(0);
    }
    if (u.conflictFlags) {
      printBanner();
      console.error(`${red}${u.conflictFlags}${reset}`);
      usage();
      process.exit(1);
    }
    if (u.parseError) {
      printBanner();
      console.error(`${red}Opção desconhecida:${reset} ${u.unknownFlag}`);
      usage();
      process.exit(1);
    }
    printBanner();
    if (u.check) {
      runUpdateVersionCheck(u);
      return;
    }
    if (!u.dryRun && !fs.existsSync(u.dir)) {
      console.error(`${yellow}Diretório não encontrado: ${u.dir}${reset}`);
      process.exit(1);
    }
    runUpdate(u);
    return;
  }

  if (command === 'capabilities') {
    const cap = parseCapabilitiesArgs(argv);
    if (cap.help) {
      printBanner();
      usage();
      process.exit(0);
    }
    if (cap.parseError) {
      printBanner();
      console.error(`${red}Opção desconhecida:${reset} ${cap.unknownFlag}`);
      usage();
      process.exit(1);
    }
    printBanner();
    if (!fs.existsSync(cap.dir)) {
      console.error(`${yellow}Diretório não encontrado: ${cap.dir}${reset}`);
      process.exit(1);
    }
    runCapabilities(cap);
    return;
  }

  if (command === 'dashboard') {
    const d = parseDashboardArgs(argv);
    if (d.help) {
      printBanner();
      usage();
      process.exit(0);
    }
    if (d.parseError) {
      printBanner();
      console.error(`${red}Opção desconhecida:${reset} ${d.unknownFlag}`);
      usage();
      process.exit(1);
    }
    printBanner();
    await runDashboard(d);
    return;
  }

  if (command === 'context') {
    const contextOpts = parseContextArgs(argv);
    if (contextOpts.help) {
      printBanner();
      usage();
      process.exit(0);
    }
    if (contextOpts.parseError) {
      printBanner();
      console.error(`${red}Opção desconhecida:${reset} ${contextOpts.unknownFlag}`);
      usage();
      process.exit(1);
    }
    printBanner();
    runContext(contextOpts);
    return;
  }

  if (command === 'runtime') {
    const runtime = parseRuntimeArgs(argv);
    if (runtime.help) {
      printBanner();
      usage();
      process.exit(0);
    }
    if (runtime.parseError) {
      printBanner();
      console.error(`${red}Opção desconhecida:${reset} ${runtime.unknownFlag}`);
      usage();
      process.exit(1);
    }
    printBanner();
    if (!fs.existsSync(runtime.dir)) {
      console.error(`${yellow}Diretório não encontrado: ${runtime.dir}${reset}`);
      process.exit(1);
    }
    runRuntime(runtime).catch((err) => {
      console.error(`${red}${err && err.message ? err.message : 'Falha ao executar runtime.'}${reset}`);
      process.exit(1);
    });
    return;
  }

  if (command === 'plugins') {
    printBanner();
    // Parse --dir flag
    let pluginsDir = process.cwd();
    const pluginsArgv = argv.slice();
    for (let i = 0; i < pluginsArgv.length; i++) {
      if (pluginsArgv[i] === '--dir' && pluginsArgv[i + 1]) {
        pluginsDir = path.resolve(pluginsArgv[++i]);
        pluginsArgv.splice(i - 1, 2);
        i -= 2;
      }
    }
    const c = useAnsiColors();
    const subCmd = pluginsArgv[0] || 'list';
    const pluginTarget = pluginsArgv[1] || '';

    if (subCmd === 'list') {
      const result = oxePlugins.loadPlugins(pluginsDir);
      console.log(`\n  ${c ? green : ''}Plugins carregados:${c ? reset : ''} ${result.plugins.length}`);
      for (const p of result.plugins) {
        console.log(`    • ${p.name}${p.version ? ` (${p.version})` : ''} — hooks: ${Object.keys(p.hooks).join(', ')}`);
      }
      if (result.errors.length) {
        console.log(`\n  ${c ? yellow : ''}Erros:${c ? reset : ''}`);
        for (const e of result.errors) {
          console.log(`    ✗ ${e.file}: ${e.error}`);
        }
      }
    } else if (subCmd === 'install' && pluginTarget) {
      const src = pluginTarget.startsWith('npm:') ? pluginTarget.slice(4) : pluginTarget;
      const ver = pluginsArgv[2] || '';
      console.log(`  Instalando plugin: ${src}${ver ? `@${ver}` : ''}...`);
      const result = oxePlugins.installNpmPlugin(pluginsDir, src, ver || undefined);
      if (result.ok) {
        console.log(`  ${c ? green : ''}✓${c ? reset : ''} Instalado em: ${result.path}`);
        console.log(`  ${c ? dim : ''}Adicione ao .oxe/config.json: "plugins": [{ "source": "npm:${src}" }]${c ? reset : ''}`);
      } else {
        console.error(`  ${c ? red : ''}✗ Falha:${c ? reset : ''} ${result.error}`);
        process.exit(1);
      }
    } else if (subCmd === 'remove' && pluginTarget) {
      console.log(`  ${c ? yellow : ''}Remove "${pluginTarget}" de .oxe/config.json → plugins[] manualmente.${c ? reset : ''}`);
      console.log(`  ${c ? dim : ''}Arquivos npm: rm -rf .oxe/plugins/_npm/node_modules/${pluginTarget}${c ? reset : ''}`);
    } else {
      console.log(`  ${c ? yellow : ''}Uso: oxe-cc plugins list | install <npm:pkg|path> | remove <id>${c ? reset : ''}`);
    }
    return;
  }

  if (command === 'azure') {
    const azure = parseAzureArgs(argv);
    if (azure.help) {
      printBanner();
      usage();
      process.exit(0);
    }
    if (azure.parseError) {
      printBanner();
      console.error(`${red}Opção desconhecida:${reset} ${azure.unknownFlag}`);
      usage();
      process.exit(1);
    }
    printBanner();
    runAzure(azure);
    return;
  }

  if (command === 'plan') {
    const planOpts = parsePlanArgs(argv);
    if (planOpts.help) { printBanner(); usage(); process.exit(0); }
    if (planOpts.parseError) { printBanner(); console.error(`${red}Opção desconhecida:${reset} ${planOpts.unknownFlag}`); usage(); process.exit(1); }
    if (!planOpts.visual) { printBanner(); console.error(`${yellow}Use oxe-cc plan --visual${reset}`); process.exit(1); }
    printBanner();
    if (!fs.existsSync(planOpts.dir)) { console.error(`${yellow}Diretório não encontrado: ${planOpts.dir}${reset}`); process.exit(1); }
    runPlanVisual(planOpts);
    return;
  }

  if (command === 'verify') {
    const verifyOpts = parseVerifyArgs(argv);
    if (verifyOpts.help) { printBanner(); usage(); process.exit(0); }
    if (verifyOpts.parseError) { printBanner(); console.error(`${red}Opção desconhecida:${reset} ${verifyOpts.unknownFlag}`); usage(); process.exit(1); }
    if (!verifyOpts.matrix) { printBanner(); console.error(`${yellow}Use oxe-cc verify --matrix${reset}`); process.exit(1); }
    printBanner();
    if (!fs.existsSync(verifyOpts.dir)) { console.error(`${yellow}Diretório não encontrado: ${verifyOpts.dir}${reset}`); process.exit(1); }
    runVerifyMatrix(verifyOpts);
    return;
  }

  const opts = parseInstallArgs(argv);

  if (opts.version) {
    console.log(`oxe-cc v${readPkgVersion()}`);
    process.exit(0);
  }

  if (opts.conflictFlags) {
    printBanner();
    console.error(`${red}${opts.conflictFlags}${reset}`);
    usage();
    process.exit(1);
  }

  if (opts.parseError) {
    printBanner();
    console.error(`${red}Opção desconhecida:${reset} ${opts.unknownFlag}`);
    usage();
    process.exit(1);
  }

  if (opts.help) {
    printBanner();
    usage();
    process.exit(0);
  }

  if (!(command === 'status' && opts.jsonOutput)) {
    printBanner();
  }

  const target = opts.dir;
  if (command === 'doctor') {
    if (!fs.existsSync(target)) {
      console.error(`${yellow}Diretório não encontrado: ${target}${reset}`);
      process.exit(1);
    }
    runDoctor(target);
    return;
  }

  if (command === 'status') {
    if (!fs.existsSync(target)) {
      console.error(`${yellow}Diretório não encontrado: ${target}${reset}`);
      process.exit(1);
    }
    if (opts.statusFull) {
      runStatusFull(target);
    } else {
      runStatus(target, { json: opts.jsonOutput, hints: opts.statusHints });
    }
    return;
  }

  if (command === 'init-oxe') {
    if (!opts.dryRun && !fs.existsSync(target)) {
      console.error(`${yellow}Diretório não encontrado: ${target}${reset}`);
      process.exit(1);
    }
    printSection('OXE ▸ init-oxe');
    const c0 = useAnsiColors();
    console.log(`  ${c0 ? green : ''}Destino:${c0 ? reset : ''} ${c0 ? cyan : ''}${target}${c0 ? reset : ''}`);
    if (opts.dryRun) console.log(`  ${c0 ? yellow : ''}(dry-run)${c0 ? reset : ''}`);
    bootstrapOxe(target, { dryRun: opts.dryRun, force: opts.force });
    printSummaryAndNextSteps(c0, {
      bullets: opts.dryRun
        ? ['[simulação] Seriam criados ou atualizados .oxe/STATE.md, .oxe/config.json, .oxe/codebase/, .oxe/ACTIVE-RUN.json e .oxe/OXE-EVENTS.ndjson']
        : ['.oxe/STATE.md, .oxe/config.json, .oxe/codebase/, .oxe/context/, .oxe/ACTIVE-RUN.json e .oxe/OXE-EVENTS.ndjson (criados ou atualizados conforme --force)'],
      nextSteps: [
        { desc: 'Validar o projeto:', cmd: 'npx oxe-cc doctor' },
        { desc: 'Instalar integrações IDE/CLI (se ainda não fez):', cmd: 'npx oxe-cc@latest' },
        { desc: 'Começar o fluxo no agente:', cmd: '/oxe-scan' },
      ],
      dryRun: opts.dryRun,
    });
    console.log(`  ${c0 ? green : ''}✓${c0 ? reset : ''} init-oxe concluído com sucesso.\n`);
    return;
  }

  await resolveInteractiveInstall(opts);
  runInstall(opts);
  await maybePromptGlobalCli(opts);
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  console.error(`${red}Erro:${reset} ${msg}`);
  if (process.env.OXE_DEBUG === '1') console.error(err);
  process.exit(1);
});
