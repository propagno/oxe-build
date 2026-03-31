'use strict';

/**
 * Instalação multi-plataforma estilo: mesmos fluxos OXE em vários “homes” de agentes.
 * Referências: OpenCode (~/.config/opencode/commands), Gemini CLI (~/.gemini/commands/*.toml),
 * Codex (~/.agents/skills + ~/.codex/prompts), Copilot (~/.copilot/skills), Antigravity (~/.gemini/antigravity/skills),
 * Windsurf (~/.codeium/windsurf/global_workflows).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const OXE_MANAGED_HTML = '<!-- oxe-cc managed -->';
const OXE_MANAGED_TOML = '# oxe-cc managed';

function expandTilde(p) {
  if (typeof p !== 'string') return p;
  if (p === '~' || p.startsWith(`~${path.sep}`)) return path.join(os.homedir(), p.slice(2));
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** @param {string} content */
function adjustWorkflowPathsForNestedLayout(content) {
  return content
    .replace(/\boxe\/workflows\//g, '.oxe/workflows/')
    .replace(/\boxe\/templates\//g, '.oxe/templates/');
}

/**
 * @param {string} text
 * @returns {{ description: string, body: string }}
 */
function parseCursorCommandFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { description: '', body: normalized.trim() };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { description: '', body: normalized.trim() };
  }
  const yamlBlock = normalized.slice(4, end);
  let description = '';
  for (const line of yamlBlock.split('\n')) {
    const m = line.match(/^description:\s*(.+)$/);
    if (m) {
      description = m[1].trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
  const body = normalized.slice(end + 5).trim();
  return { description, body };
}

/**
 * @param {string} skillName
 * @param {string} description
 * @param {string} body
 */
function buildAgentSkillMarkdown(skillName, description, body) {
  const desc = description.trim() || `Comando OXE — ${skillName}`;
  return (
    `---\n` +
    `name: ${skillName}\n` +
    `description: ${JSON.stringify(desc)}\n` +
    `user-invocable: true\n` +
    `---\n\n` +
    `${OXE_MANAGED_HTML}\n\n` +
    `${body}\n`
  );
}

/**
 * @returns {string[]}
 */
function opencodeCommandDirs() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return [path.join(xdg, 'opencode', 'commands'), path.join(os.homedir(), '.opencode', 'commands')];
}

function windsurfGlobalWorkflowsDir() {
  return path.join(os.homedir(), '.codeium', 'windsurf', 'global_workflows');
}

function geminiUserDir() {
  return path.join(os.homedir(), '.gemini');
}

function codexAgentsSkillsRoot() {
  return path.join(os.homedir(), '.agents', 'skills');
}

function codexPromptsDir() {
  const home = process.env.CODEX_HOME ? path.resolve(expandTilde(process.env.CODEX_HOME)) : path.join(os.homedir(), '.codex');
  return path.join(home, 'prompts');
}

function antigravitySkillsRoot() {
  return path.join(geminiUserDir(), 'antigravity', 'skills');
}

/**
 * Insere marcador após o frontmatter YAML inicial, se existir.
 * @param {string} raw
 * @param {boolean} pathRewriteNested
 */
function injectManagedAfterFrontmatter(raw, pathRewriteNested) {
  let t = pathRewriteNested ? adjustWorkflowPathsForNestedLayout(raw) : raw;
  if (!t.startsWith('---\n')) return `${OXE_MANAGED_HTML}\n\n${t}`;
  const end = t.indexOf('\n---\n', 4);
  if (end === -1) return `${OXE_MANAGED_HTML}\n\n${t}`;
  return t.slice(0, end + 5) + `\n${OXE_MANAGED_HTML}\n\n` + t.slice(end + 5);
}

/**
 * @param {string} description
 * @param {string} body
 */
function buildGeminiToml(description, body) {
  const desc = description.trim() || 'OXE';
  const safeBody = body.replace(/"""/g, '\\"\\"\\"');
  return `${OXE_MANAGED_TOML}\ndescription = ${JSON.stringify(desc)}\nprompt = """\n${safeBody}\n"""\n`;
}

/**
 * @param {string} cCmdSrc
 * @param {string} skillsRoot
 * @param {{ dryRun: boolean, force: boolean }} opts
 * @param {boolean} pathRewriteNested
 * @param {(s: string) => void} [logOmitido]
 * @param {(s: string) => void} [logWrite]
 */
function installSkillTreeFromCursorCommands(cCmdSrc, skillsRoot, opts, pathRewriteNested, logOmitido, logWrite) {
  if (!fs.existsSync(cCmdSrc)) return;

  const writeOne = (skillName, srcPath, descSuffix) => {
    let raw = fs.readFileSync(srcPath, 'utf8');
    if (pathRewriteNested) raw = adjustWorkflowPathsForNestedLayout(raw);
    const { description, body } = parseCursorCommandFrontmatter(raw);
    const desc = descSuffix ? `${description.trim()} ${descSuffix}`.trim() : description.trim();
    const md = buildAgentSkillMarkdown(skillName, desc, body);
    const destDir = path.join(skillsRoot, skillName);
    const dest = path.join(destDir, 'SKILL.md');
    if (opts.dryRun) {
      if (logWrite) logWrite(`${srcPath} → ${dest}`);
      return;
    }
    if (fs.existsSync(dest) && !opts.force) {
      if (logOmitido) logOmitido(dest);
      return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, md, 'utf8');
  };

  for (const name of fs.readdirSync(cCmdSrc)) {
    if (!name.startsWith('oxe-') || !name.endsWith('.md')) continue;
    const skillName = name.replace(/\.md$/i, '');
    writeOne(skillName, path.join(cCmdSrc, name));
  }

  const helpPath = path.join(cCmdSrc, 'oxe-help.md');
  if (fs.existsSync(helpPath)) {
    writeOne('oxe', helpPath, 'Ponto de entrada /oxe (mesmo fluxo que oxe-help).');
  }
}

/**
 * Copia .md dos comandos Cursor para pastas OpenCode (markdown nativo).
 */
function installOpenCodeCommands(cCmdSrc, opts, pathRewriteNested, logOmitido, logWrite) {
  if (!fs.existsSync(cCmdSrc)) return;
  for (const destDir of opencodeCommandDirs()) {
    for (const name of fs.readdirSync(cCmdSrc)) {
      if (!name.startsWith('oxe-') || !name.endsWith('.md')) continue;
      const src = path.join(cCmdSrc, name);
      const dest = path.join(destDir, name);
      if (opts.dryRun) {
        if (logWrite) logWrite(`opencode ${src} → ${dest}`);
        continue;
      }
      if (fs.existsSync(dest) && !opts.force) {
        if (logOmitido) logOmitido(dest);
        continue;
      }
      const raw = fs.readFileSync(src, 'utf8');
      const out = injectManagedAfterFrontmatter(raw, pathRewriteNested);
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(dest, out, 'utf8');
    }
  }
}

/**
 * ~/.gemini/commands/oxe.toml → /oxe ; oxe/scan.toml → /oxe:scan
 */
function installGeminiTomlCommands(cCmdSrc, opts, pathRewriteNested, logOmitido, logWrite) {
  if (!fs.existsSync(cCmdSrc)) return;
  const base = path.join(geminiUserDir(), 'commands');

  const writeToml = (relPath, srcPath, descSuffix) => {
    let raw = fs.readFileSync(srcPath, 'utf8');
    if (pathRewriteNested) raw = adjustWorkflowPathsForNestedLayout(raw);
    const { description, body } = parseCursorCommandFrontmatter(raw);
    const desc = descSuffix ? `${description} ${descSuffix}`.trim() : description;
    const toml = buildGeminiToml(desc, body);
    const dest = path.join(base, relPath);
    if (opts.dryRun) {
      if (logWrite) logWrite(`gemini ${srcPath} → ${dest}`);
      return;
    }
    if (fs.existsSync(dest) && !opts.force) {
      if (logOmitido) logOmitido(dest);
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, toml, 'utf8');
  };

  const helpPath = path.join(cCmdSrc, 'oxe-help.md');
  if (fs.existsSync(helpPath)) {
    writeToml('oxe.toml', helpPath, '(Gemini: /oxe)');
  }

  const oxeDir = path.join(base, 'oxe');
  for (const name of fs.readdirSync(cCmdSrc)) {
    if (!name.startsWith('oxe-') || !name.endsWith('.md')) continue;
    const short = name.replace(/^oxe-/i, '').replace(/\.md$/i, '');
    writeToml(path.join('oxe', `${short}.toml`), path.join(cCmdSrc, name), `(Gemini: /oxe:${short})`);
  }
}

/**
 * Windsurf Cascade: workflows globais (~/.codeium/windsurf/global_workflows).
 */
function installWindsurfGlobalWorkflows(cCmdSrc, opts, pathRewriteNested, logOmitido, logWrite) {
  if (!fs.existsSync(cCmdSrc)) return;
  const destDir = windsurfGlobalWorkflowsDir();
  for (const name of fs.readdirSync(cCmdSrc)) {
    if (!name.startsWith('oxe-') || !name.endsWith('.md')) continue;
    const src = path.join(cCmdSrc, name);
    const dest = path.join(destDir, name);
    if (opts.dryRun) {
      if (logWrite) logWrite(`windsurf ${src} → ${dest}`);
      continue;
    }
    if (fs.existsSync(dest) && !opts.force) {
      if (logOmitido) logOmitido(dest);
      continue;
    }
    let raw = fs.readFileSync(src, 'utf8');
    if (pathRewriteNested) raw = adjustWorkflowPathsForNestedLayout(raw);
    const { description, body } = parseCursorCommandFrontmatter(raw);
    const title = description || name.replace(/\.md$/i, '');
    const out =
      `---\n` +
      `description: ${JSON.stringify(title)}\n` +
      `---\n\n` +
      `${OXE_MANAGED_HTML}\n\n` +
      `# ${name.replace(/\.md$/i, '')}\n\n` +
      `${body}\n`;
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, out, 'utf8');
  }
  const helpPath = path.join(cCmdSrc, 'oxe-help.md');
  const helpDest = path.join(destDir, 'oxe.md');
  if (fs.existsSync(helpPath)) {
    if (opts.dryRun) {
      if (logWrite) logWrite(`windsurf ${helpPath} → ${helpDest}`);
    } else if (!fs.existsSync(helpDest) || opts.force) {
      let raw = fs.readFileSync(helpPath, 'utf8');
      if (pathRewriteNested) raw = adjustWorkflowPathsForNestedLayout(raw);
      const { description, body } = parseCursorCommandFrontmatter(raw);
      const out =
        `---\n` +
        `description: ${JSON.stringify(`${description} (OXE /oxe)`.trim())}\n` +
        `---\n\n` +
        `${OXE_MANAGED_HTML}\n\n` +
        `# oxe\n\n` +
        `${body}\n`;
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(helpDest, out, 'utf8');
    } else if (logOmitido) logOmitido(helpDest);
  }
}

/**
 * Codex: ~/.codex/prompts/oxe-scan.md → /prompts:oxe-scan (deprecado mas ainda suportado).
 */
function installCodexPrompts(cCmdSrc, opts, pathRewriteNested, logOmitido, logWrite) {
  if (!fs.existsSync(cCmdSrc)) return;
  const destDir = codexPromptsDir();
  for (const name of fs.readdirSync(cCmdSrc)) {
    if (!name.startsWith('oxe-') || !name.endsWith('.md')) continue;
    const src = path.join(cCmdSrc, name);
    const dest = path.join(destDir, name);
    if (opts.dryRun) {
      if (logWrite) logWrite(`codex prompts ${src} → ${dest}`);
      continue;
    }
    if (fs.existsSync(dest) && !opts.force) {
      if (logOmitido) logOmitido(dest);
      continue;
    }
    let raw = fs.readFileSync(src, 'utf8');
    if (pathRewriteNested) raw = adjustWorkflowPathsForNestedLayout(raw);
    const { description, body } = parseCursorCommandFrontmatter(raw);
    const out =
      `---\n` +
      `description: ${JSON.stringify(description || 'OXE')}\n` +
      `argument-hint: [texto livre opcional]\n` +
      `---\n\n` +
      `${OXE_MANAGED_HTML}\n\n` +
      `${body}\n`;
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, out, 'utf8');
  }
}

/**
 * Remove apenas ficheiros/pastas criados pelo oxe-cc (marcadores).
 * @param {{ dryRun: boolean }} u
 */
function cleanupMarkedUnifiedArtifacts(u) {
  const unlinkQuiet = (p) => {
    if (!fs.existsSync(p)) return;
    if (u.dryRun) return;
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  };

  const rmDirIfOxeSkill = (skillDir) => {
    const sm = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(sm)) return;
    let txt = '';
    try {
      txt = fs.readFileSync(sm, 'utf8');
    } catch {
      return;
    }
    if (!txt.includes(OXE_MANAGED_HTML)) return;
    if (u.dryRun) return;
    try {
      fs.rmSync(skillDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  for (const dir of opencodeCommandDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('oxe-') || !name.endsWith('.md')) continue;
      const p = path.join(dir, name);
      let txt = '';
      try {
        txt = fs.readFileSync(p, 'utf8');
      } catch {
        continue;
      }
      if (txt.includes(OXE_MANAGED_HTML)) unlinkQuiet(p);
    }
  }

  const gBase = path.join(geminiUserDir(), 'commands');
  const oxeToml = path.join(gBase, 'oxe.toml');
  if (fs.existsSync(oxeToml)) {
    try {
      if (fs.readFileSync(oxeToml, 'utf8').includes(OXE_MANAGED_TOML)) unlinkQuiet(oxeToml);
    } catch {
      /* ignore */
    }
  }
  const oxeSub = path.join(gBase, 'oxe');
  if (fs.existsSync(oxeSub)) {
    for (const name of fs.readdirSync(oxeSub)) {
      if (!name.endsWith('.toml')) continue;
      const p = path.join(oxeSub, name);
      try {
        if (fs.readFileSync(p, 'utf8').includes(OXE_MANAGED_TOML)) unlinkQuiet(p);
      } catch {
        /* ignore */
      }
    }
    try {
      if (!u.dryRun && fs.existsSync(oxeSub) && fs.readdirSync(oxeSub).length === 0) fs.rmdirSync(oxeSub);
    } catch {
      /* ignore */
    }
  }

  const wfDir = windsurfGlobalWorkflowsDir();
  if (fs.existsSync(wfDir)) {
    for (const name of fs.readdirSync(wfDir)) {
      if (name !== 'oxe.md' && !(name.startsWith('oxe-') && name.endsWith('.md'))) continue;
      const p = path.join(wfDir, name);
      try {
        if (fs.readFileSync(p, 'utf8').includes(OXE_MANAGED_HTML)) unlinkQuiet(p);
      } catch {
        /* ignore */
      }
    }
  }

  const cpDir = codexPromptsDir();
  if (fs.existsSync(cpDir)) {
    for (const name of fs.readdirSync(cpDir)) {
      if (!name.startsWith('oxe-') || !name.endsWith('.md')) continue;
      const p = path.join(cpDir, name);
      try {
        if (fs.readFileSync(p, 'utf8').includes(OXE_MANAGED_HTML)) unlinkQuiet(p);
      } catch {
        /* ignore */
      }
    }
  }

  const agRoot = antigravitySkillsRoot();
  if (fs.existsSync(agRoot)) {
    for (const name of fs.readdirSync(agRoot, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      if (!/^oxe($|-)/.test(name.name)) continue;
      rmDirIfOxeSkill(path.join(agRoot, name.name));
    }
  }

  const cxRoot = codexAgentsSkillsRoot();
  if (fs.existsSync(cxRoot)) {
    for (const name of fs.readdirSync(cxRoot, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      if (!/^oxe($|-)/.test(name.name)) continue;
      rmDirIfOxeSkill(path.join(cxRoot, name.name));
    }
  }
}

module.exports = {
  OXE_MANAGED_HTML,
  OXE_MANAGED_TOML,
  adjustWorkflowPathsForNestedLayout,
  parseCursorCommandFrontmatter,
  buildAgentSkillMarkdown,
  installSkillTreeFromCursorCommands,
  installOpenCodeCommands,
  installGeminiTomlCommands,
  installWindsurfGlobalWorkflows,
  installCodexPrompts,
  opencodeCommandDirs,
  windsurfGlobalWorkflowsDir,
  geminiUserDir,
  codexAgentsSkillsRoot,
  codexPromptsDir,
  antigravitySkillsRoot,
  cleanupMarkedUnifiedArtifacts,
};
