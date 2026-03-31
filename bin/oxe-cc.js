#!/usr/bin/env node
/**
 * OXE installer — copies packaged assets into a target project (like get-shit-done-cc, minimal).
 * Usage: npx oxe-cc [--cursor] [--copilot] [--vscode] [--force] [--dry-run] [dir]
 */

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');

const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

function parseArgs(argv) {
  const out = {
    help: false,
    version: false,
    cursor: false,
    copilot: false,
    vscode: false,
    commands: true,
    agents: true,
    force: false,
    dryRun: false,
    dir: process.cwd(),
    all: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-v' || a === '--version') out.version = true;
    else if (a === '--cursor') out.cursor = true;
    else if (a === '--copilot') out.copilot = true;
    else if (a === '--vscode') out.vscode = true;
    else if (a === '--no-commands') out.commands = false;
    else if (a === '--no-agents') out.agents = false;
    else if (a === '--force' || a === '-f') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--all' || a === '-a') out.all = true;
    else if (a === '--dir' && argv[i + 1]) {
      out.dir = path.resolve(argv[++i]);
    } else if (!a.startsWith('-')) rest.push(a);
    else {
      console.error(`${yellow}Unknown option: ${a}${reset}`);
      out.help = true;
    }
  }
  if (out.all || (!out.cursor && !out.copilot)) {
    out.cursor = true;
    out.copilot = true;
  }
  if (rest.length) out.dir = path.resolve(rest[0]);
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

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest, opts) {
  if (opts.dryRun) {
    console.log(`${dim}file${reset}  ${src} → ${dest}`);
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

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

function usage() {
  console.log(`
${cyan}oxe-cc${reset} — install OXE workflows (Cursor + GitHub Copilot) into a project

${green}Usage:${reset}
  npx oxe-cc@latest [options] [target-dir]
  npx oxe-cc@latest --dir /path/to/project

${green}Options:${reset}
  --cursor       Install .cursor/commands and .cursor/rules (default with --all)
  --copilot      Install .github/copilot-instructions.md and .github/prompts
  --vscode       Also copy .vscode/settings.json (chat.promptFiles)
  --all, -a      Cursor + Copilot (default when neither --cursor nor --copilot)
  --no-commands  Skip commands/oxe (Claude-style frontmatter)
  --no-agents    Skip AGENTS.md
  --force, -f    Overwrite existing files
  --dry-run      Print actions without writing
  --dir <path>   Target directory (default: cwd)
  -h, --help
  -v, --version

${green}Examples:${reset}
  npx oxe-cc@latest
  npx oxe-cc@latest ./my-app
  npx oxe-cc@latest --cursor --dry-run
`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }
  if (opts.version) {
    console.log(`oxe-cc v${readPkgVersion()}`);
    process.exit(0);
  }

  const target = opts.dir;
  if (!opts.dryRun && !fs.existsSync(target)) {
    console.error(`${yellow}Target directory does not exist: ${target}${reset}`);
    process.exit(1);
  }

  console.log(`${cyan}OXE${reset} install → ${green}${target}${reset}`);
  if (opts.dryRun) console.log(`${yellow}(dry-run)${reset}`);

  const copyOpts = { dryRun: opts.dryRun, force: opts.force };

  // Always: workflows + templates
  copyDir(path.join(PKG_ROOT, 'oxe'), path.join(target, 'oxe'), copyOpts);

  if (opts.cursor) {
    const cCmd = path.join(PKG_ROOT, '.cursor', 'commands');
    const cRules = path.join(PKG_ROOT, '.cursor', 'rules');
    if (fs.existsSync(cCmd)) copyDir(cCmd, path.join(target, '.cursor', 'commands'), copyOpts);
    if (fs.existsSync(cRules)) copyDir(cRules, path.join(target, '.cursor', 'rules'), copyOpts);
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

  console.log(
    `\n${green}Done.${reset} Open the project in Cursor (${cyan}/oxe-scan${reset}) or VS Code + Copilot (prompt ${cyan}/oxe-scan${reset}).`
  );
}

main();
