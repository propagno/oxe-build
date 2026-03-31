#!/usr/bin/env node
/**
 * OXE — install workflows into a target project; bootstrap `.oxe/`; doctor.
 * Usage:
 *   npx oxe-cc [options] [target-dir]
 *   npx oxe-cc doctor [options] [target-dir]
 *   npx oxe-cc init-oxe [options] [target-dir]
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const PKG_ROOT = path.join(__dirname, '..');

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
   |     Cursor  ·  GitHub Copilot              |
   '============================================'
                    v{version}
`;

function useAnsiColors() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === '0') return false;
  return process.stdout.isTTY === true;
}

/** Section header (GSD-inspired). */
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

/** @typedef {{ help: boolean, version: boolean, cursor: boolean, copilot: boolean, copilotCli: boolean, vscode: boolean, commands: boolean, agents: boolean, force: boolean, dryRun: boolean, dir: string, all: boolean, noInitOxe: boolean, oxeOnly: boolean, globalCli: boolean, noGlobalCli: boolean, parseError: boolean, unknownFlag: string, conflictFlags: string }} InstallOpts */

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
    parseError: false,
    unknownFlag: '',
    conflictFlags: '',
    restPositional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-v' || a === '--version') out.version = true;
    else if (a === '--cursor') out.cursor = true;
    else if (a === '--copilot') out.copilot = true;
    else if (a === '--copilot-cli') out.copilotCli = true;
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
    }     else if (!a.startsWith('-')) out.restPositional.push(a);
    else {
      out.parseError = true;
      out.unknownFlag = a;
      break;
    }
  }
  if (out.globalCli && out.noGlobalCli) {
    out.conflictFlags = 'Cannot use both --global-cli (-g) and --no-global-cli (-l)';
  }
  if (out.oxeOnly) {
    out.cursor = false;
    out.copilot = false;
    out.copilotCli = false;
    out.vscode = false;
    out.commands = false;
    out.agents = false;
  } else if (out.all || (!out.cursor && !out.copilot && !out.copilotCli)) {
    out.cursor = true;
    out.copilot = true;
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

/** @param {string} srcDir @param {string} destDir @param {{ dryRun: boolean, force: boolean }} opts */
function copyDir(srcDir, destDir, opts) {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(destDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(srcDir, e.name);
    const d = path.join(destDir, e.name);
    if (e.isDirectory()) copyDir(s, d, opts);
    else {
      if (fs.existsSync(d) && !opts.force) {
        console.log(`${dim}skip${reset} ${d} (exists, use --force)`);
        continue;
      }
      if (opts.dryRun) console.log(`${dim}file${reset}  ${s} → ${d}`);
      else {
        ensureDir(path.dirname(d));
        fs.copyFileSync(s, d);
      }
    }
  }
}

/**
 * Create `.oxe/STATE.md` from template and ensure `.oxe/codebase/` exists.
 * @param {string} target
 * @param {{ dryRun: boolean, force: boolean }} opts
 */
function bootstrapOxe(target, opts) {
  const oxeDir = path.join(target, '.oxe');
  const codebaseDir = path.join(oxeDir, 'codebase');
  const stateSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'STATE.md');
  const stateDest = path.join(oxeDir, 'STATE.md');
  const configSrc = path.join(PKG_ROOT, 'oxe', 'templates', 'config.template.json');
  const configDest = path.join(oxeDir, 'config.json');

  if (!fs.existsSync(stateSrc)) {
    console.error(`${yellow}warn:${reset} template missing: ${stateSrc}`);
    return;
  }

  if (opts.dryRun) {
    console.log(`${dim}init${reset}  ${oxeDir}/ (STATE.md, config.json, codebase/)`);
    return;
  }

  ensureDir(codebaseDir);

  if (!fs.existsSync(stateDest) || opts.force) {
    copyFile(stateSrc, stateDest, { dryRun: false });
    console.log(`${green}init${reset}  ${stateDest}`);
  } else {
    console.log(`${dim}skip${reset} ${stateDest} (exists, use --force to replace)`);
  }

  if (fs.existsSync(configSrc)) {
    if (!fs.existsSync(configDest) || opts.force) {
      copyFile(configSrc, configDest, { dryRun: false });
      console.log(`${green}init${reset}  ${configDest}`);
    } else {
      console.log(`${dim}skip${reset} ${configDest} (exists, use --force to replace)`);
    }
  }
}

/** @param {string} target */
function runDoctor(target) {
  printSection('OXE ▸ doctor');
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0], 10);
  const minNode = readMinNode();
  const c = useAnsiColors();
  console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
  console.log(`Node.js ${v} (require >= ${minNode})`);
  if (major < minNode) {
    console.log(`${red}FAIL${reset} Node.js version below package engines`);
    process.exit(1);
  }
  console.log(`${green}OK${reset} Node.js`);

  const wfPkg = path.join(PKG_ROOT, 'oxe', 'workflows');
  const wfTgt = path.join(target, 'oxe', 'workflows');
  if (!fs.existsSync(wfPkg)) {
    console.log(`${red}FAIL${reset} package workflows missing: ${wfPkg}`);
    process.exit(1);
  }
  const expected = fs
    .readdirSync(wfPkg)
    .filter((f) => f.endsWith('.md'))
    .sort();

  if (!fs.existsSync(wfTgt)) {
    console.log(`${yellow}WARN${reset} Target has no oxe/workflows/ — run ${cyan}oxe-cc${reset} to install.`);
    process.exit(1);
  }

  const actual = fs
    .readdirSync(wfTgt)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const missing = expected.filter((f) => !actual.includes(f));
  const extra = actual.filter((f) => !expected.includes(f));

  if (missing.length) {
    console.log(`${red}FAIL${reset} Missing workflows vs package: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (extra.length) console.log(`${dim}Note:${reset} Extra workflows in target (ok for forks): ${extra.join(', ')}`);
  console.log(`${green}OK${reset} oxe/workflows has all ${expected.length} package files`);

  const oxeState = path.join(target, '.oxe', 'STATE.md');
  if (fs.existsSync(oxeState)) console.log(`${green}OK${reset} .oxe/STATE.md present`);
  else console.log(`${dim}Note:${reset} .oxe/STATE.md absent — run ${cyan}oxe-cc init-oxe${reset} or install without ${cyan}--no-init-oxe${reset}`);

  const cfgPath = path.join(target, '.oxe', 'config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      console.log(`${green}OK${reset} .oxe/config.json (valid JSON)`);
    } catch (e) {
      console.log(`${red}FAIL${reset} .oxe/config.json invalid JSON: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log(`${dim}Note:${reset} .oxe/config.json absent (optional — see oxe/templates/CONFIG.md)`);
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
        `${yellow}Note:${reset} scan incomplete — missing under .oxe/codebase/: ${missingMaps.join(', ')} (run ${cyan}/oxe-scan${reset})`
      );
    } else {
      console.log(`${green}OK${reset} .oxe/codebase/ has all ${expectedMaps.length} map files`);
    }
  }

  console.log(`\n${green}Doctor finished.${reset}`);
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
      `\n  ${c ? green : ''}✓${c ? reset : ''} ${c ? cyan : ''}oxe-cc${c ? reset : ''} disponível globalmente (corre ${c ? cyan : ''}oxe-cc --help${c ? reset : ''} em qualquer pasta).\n`
    );
    return true;
  }
  console.log(
    `\n  ${c ? yellow : ''}⚠${c ? reset : ''} npm install -g falhou. Tenta manualmente: ${c ? cyan : ''}npm install -g ${spec}${c ? reset : ''}\n`
  );
  return false;
}

/**
 * After copying OXE into the project: optionally install the CLI globally (like GSD’s “where to install” choice).
 * @param {InstallOpts} opts
 */
function maybePromptGlobalCli(opts) {
  if (opts.oxeOnly) return;
  if (opts.dryRun) {
    if (useAnsiColors()) console.log(`${dim}  (dry-run — pergunta do CLI global ignorada)${reset}`);
    return;
  }
  if (opts.globalCli) {
    installGlobalCliPackage();
    return;
  }
  if (opts.noGlobalCli) return;
  if (process.env.OXE_NO_PROMPT === '1' || process.env.OXE_NO_PROMPT === 'true') return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const c = useAnsiColors();
    if (c) {
      console.log(
        `\n  ${yellow}Terminal não interativo${reset} — sem pergunta de CLI global. Usa ${cyan}npx oxe-cc@latest${reset} ou ${cyan}--global-cli${reset}.\n`
      );
    } else {
      console.log('\nNon-interactive terminal — skipping global CLI prompt. Use npx oxe-cc@latest or --global-cli.\n');
    }
    return;
  }

  const c = useAnsiColors();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(
    `  ${c ? yellow : ''}Instalar o comando oxe-cc globalmente?${c ? reset : ''}
  (Os ficheiros OXE já foram copiados para o projeto.)

  ${c ? cyan : ''}1${c ? reset : ''}) ${c ? dim : ''}Não — uso ${c ? reset : ''}${c ? cyan : ''}npx oxe-cc@latest${c ? reset : ''}${c ? dim : ''} para atualizar (recomendado em CI)${c ? reset : ''}
  ${c ? cyan : ''}2${c ? reset : ''}) ${c ? dim : ''}Sim — ${c ? reset : ''}${c ? cyan : ''}npm install -g ${readPkgName()}@${readPkgVersion()}${c ? reset : ''}${c ? dim : ''} (${c ? reset : ''}${c ? cyan : ''}oxe-cc${c ? reset : ''}${c ? dim : ''} no PATH)${c ? reset : ''}
`
  );

  rl.question(`  ${c ? cyan : ''}Escolha${c ? reset : ''} ${c ? dim : ''}[1]${c ? reset : ''}: `, (answer) => {
    rl.close();
    const choice = (answer || '1').trim();
    if (choice === '2') installGlobalCliPackage();
    else {
      console.log(
        `\n  ${c ? green : ''}✓${c ? reset : ''} Para atualizar workflows: ${c ? cyan : ''}npx oxe-cc@latest --force${c ? reset : ''} na raiz do projeto.\n`
      );
    }
  });
}

function usage() {
  console.log(`
${cyan}oxe-cc${reset} — install OXE workflows (Cursor + GitHub Copilot) into a project

${green}Usage:${reset}
  npx oxe-cc@latest [options] [target-dir]
  npx oxe-cc@latest --dir /path/to/project
  npx oxe-cc doctor [options] [target-dir]
  npx oxe-cc init-oxe [options] [target-dir]

${green}Install options:${reset}
  --cursor       Install .cursor/commands and .cursor/rules (default with --all)
  --copilot      Install .github/copilot-instructions.md and .github/prompts
  --copilot-cli  Copy .cursor/commands → .claude/commands (Copilot CLI slash /oxe-* — experimental)
  --vscode       Also copy .vscode/settings.json (chat.promptFiles)
  --all, -a      Cursor + Copilot (default when neither --cursor nor --copilot)
  --no-commands  Skip commands/oxe (Claude-style frontmatter)
  --no-agents    Skip AGENTS.md
  --no-init-oxe  Do not create .oxe/STATE.md + .oxe/codebase/ after install
  --oxe-only     Only copy oxe/ (skip Cursor, Copilot, commands, AGENTS.md)
  --global-cli, -g   After install: npm install -g oxe-cc@<version> (no prompt)
  --no-global-cli, -l  Skip the interactive “CLI global?” step (default in CI)
  --force, -f    Overwrite existing files
  --dry-run      Print actions without writing
  --dir <path>   Target directory (default: cwd)
  -h, --help
  -v, --version

${green}Upgrade (project already has OXE):${reset}
  npx oxe-cc@latest --force          # repo root — refresh oxe/, .cursor/, .github/, …
  npm install -g oxe-cc@latest && oxe-cc --force   # global CLI install
  npx clear-npx-cache                # if npx keeps an old tarball (npm 7+)

${green}Examples:${reset}
  npx oxe-cc@latest
  npx oxe-cc@latest ./my-app
  npx oxe-cc@latest --cursor --dry-run
  npx oxe-cc@latest --copilot --copilot-cli
  npx oxe-cc doctor
  npx oxe-cc init-oxe --dir ./my-app
`);
}

function runInstall(opts) {
  const target = opts.dir;
  if (!opts.dryRun && !fs.existsSync(target)) {
    console.error(`${yellow}Target directory does not exist: ${target}${reset}`);
    process.exit(1);
  }

  printSection('OXE ▸ Copiar workflows para o projeto');
  const c = useAnsiColors();
  console.log(`  ${c ? green : ''}Destino:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
  if (opts.dryRun) console.log(`  ${c ? yellow : ''}(dry-run)${c ? reset : ''}`);

  const copyOpts = { dryRun: opts.dryRun, force: opts.force };

  copyDir(path.join(PKG_ROOT, 'oxe'), path.join(target, 'oxe'), copyOpts);

  if (opts.cursor) {
    const cCmd = path.join(PKG_ROOT, '.cursor', 'commands');
    const cRules = path.join(PKG_ROOT, '.cursor', 'rules');
    if (fs.existsSync(cCmd)) copyDir(cCmd, path.join(target, '.cursor', 'commands'), copyOpts);
    if (fs.existsSync(cRules)) copyDir(cRules, path.join(target, '.cursor', 'rules'), copyOpts);
  }

  if (opts.copilotCli) {
    const cCmd = path.join(PKG_ROOT, '.cursor', 'commands');
    const dest = path.join(target, '.claude', 'commands');
    const c = useAnsiColors();
    if (fs.existsSync(cCmd)) {
      console.log(
        `  ${c ? green : ''}cli${c ? reset : ''}   ${c ? dim : ''}Copilot CLI:${c ? reset : ''} ${c ? cyan : ''}.claude/commands/${c ? reset : ''}${c ? dim : ''} (experimental — teste /oxe-scan na sessão)${c ? reset : ''}`
      );
      copyDir(cCmd, dest, copyOpts);
    } else {
      console.warn(`${yellow}warn:${reset} missing ${cCmd} — skip --copilot-cli`);
    }
  }

  if (opts.copilot) {
    const gh = path.join(PKG_ROOT, '.github');
    const inst = path.join(gh, 'copilot-instructions.md');
    const prompts = path.join(gh, 'prompts');
    if (fs.existsSync(inst)) {
      const dest = path.join(target, '.github', 'copilot-instructions.md');
      if (opts.dryRun) console.log(`${dim}file${reset}  ${inst} → ${dest}`);
      else {
        if (fs.existsSync(dest) && !opts.force) console.log(`${dim}skip${reset} ${dest} (exists)`);
        else copyFile(inst, dest, copyOpts);
      }
    }
    if (fs.existsSync(prompts)) copyDir(prompts, path.join(target, '.github', 'prompts'), copyOpts);
  }

  if (opts.vscode) {
    const vs = path.join(PKG_ROOT, '.vscode', 'settings.json');
    if (fs.existsSync(vs)) {
      const dest = path.join(target, '.vscode', 'settings.json');
      if (opts.dryRun) console.log(`${dim}file${reset}  ${vs} → ${dest}`);
      else {
        if (fs.existsSync(dest) && !opts.force) console.log(`${dim}skip${reset} ${dest} (exists)`);
        else copyFile(vs, dest, copyOpts);
      }
    }
  }

  if (opts.commands) {
    const cmdSrc = path.join(PKG_ROOT, 'commands', 'oxe');
    const cmdDest = path.join(target, 'commands', 'oxe');
    if (fs.existsSync(cmdSrc)) copyDir(cmdSrc, cmdDest, copyOpts);
  }

  if (opts.agents) {
    const agents = path.join(PKG_ROOT, 'AGENTS.md');
    if (fs.existsSync(agents)) {
      const dest = path.join(target, 'AGENTS.md');
      if (opts.dryRun) console.log(`${dim}file${reset}  ${agents} → ${dest}`);
      else if (fs.existsSync(dest) && !opts.force) console.log(`${dim}skip${reset} ${dest} (exists)`);
      else copyFile(agents, dest, copyOpts);
    }
  }

  if (!opts.noInitOxe) bootstrapOxe(target, { dryRun: opts.dryRun, force: opts.force });

  console.log(
    `\n  ${c ? green : ''}✓${c ? reset : ''} Ficheiros OXE instalados. Abre no Cursor (${c ? cyan : ''}/oxe-scan${c ? reset : ''}) ou VS Code + Copilot (prompt ${c ? cyan : ''}/oxe-scan${c ? reset : ''}).`
  );
}

function main() {
  const argv = process.argv.slice(2);
  let command = 'install';
  if (argv[0] === 'doctor' || argv[0] === 'init-oxe') {
    command = argv[0];
    argv.shift();
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
    console.error(`${red}Unknown option:${reset} ${opts.unknownFlag}`);
    usage();
    process.exit(1);
  }

  if (opts.help) {
    printBanner();
    usage();
    process.exit(0);
  }

  printBanner();

  const target = opts.dir;
  if (command === 'doctor') {
    if (!fs.existsSync(target)) {
      console.error(`${yellow}Target directory does not exist: ${target}${reset}`);
      process.exit(1);
    }
    runDoctor(target);
    return;
  }

  if (command === 'init-oxe') {
    if (!opts.dryRun && !fs.existsSync(target)) {
      console.error(`${yellow}Target directory does not exist: ${target}${reset}`);
      process.exit(1);
    }
    printSection('OXE ▸ init-oxe');
    const c0 = useAnsiColors();
    console.log(`  ${c0 ? green : ''}Destino:${c0 ? reset : ''} ${c0 ? cyan : ''}${target}${c0 ? reset : ''}`);
    if (opts.dryRun) console.log(`  ${c0 ? yellow : ''}(dry-run)${c0 ? reset : ''}`);
    bootstrapOxe(target, { dryRun: opts.dryRun, force: opts.force });
    console.log(`\n  ${c0 ? green : ''}✓${c0 ? reset : ''} Concluído.\n`);
    return;
  }

  runInstall(opts);
  maybePromptGlobalCli(opts);
}

main();
