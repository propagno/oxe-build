'use strict';

/**
 * Instalação multi-plataforma estilo: mesmos fluxos OXE em vários “homes” de agentes.
 * Referências: OpenCode (~/.config/opencode/commands), Gemini CLI (~/.gemini/commands/*.toml),
 * Codex (~/.agents/skills + ~/.codex/prompts), Copilot (~/.copilot/skills), Antigravity (~/.gemini/antigravity/skills),
 * Windsurf (~/.codeium/windsurf/global_workflows).
 * Com `--ide-local`, destinos equivalentes sob a raiz do projeto (ex.: ./.opencode/commands).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const runtimeSemantics = require('./oxe-runtime-semantics.cjs');

const OXE_MANAGED_HTML = '<!-- oxe-cc managed -->';
const OXE_MANAGED_TOML = '# oxe-cc managed';

/** @param {string} name */
function isOxeCommandMarkdownName(name) {
  return (name === 'oxe.md' || name.startsWith('oxe-')) && name.endsWith('.md');
}

function expandTilde(p) {
  if (typeof p !== 'string') return p;
  if (p === '~' || p.startsWith(`~${path.sep}`)) return path.join(os.homedir(), p.slice(2));
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * @typedef {{
 *   ideGlobal: boolean,
 *   opencodeCommandDirs: string[],
 *   geminiCommandsBase: string,
 *   windsurfWorkflowsDir: string,
 *   codexPromptsDir: string,
 *   codexAgentsSkillsRoot: string,
 *   antigravitySkillsRoot: string,
 *   claudeAgentsDir: string,
 * }} AgentInstallPaths
 */

/**
 * @param {boolean} ideGlobal
 * @param {string} projectRoot
 * @returns {AgentInstallPaths}
 */
function buildAgentInstallPaths(ideGlobal, projectRoot) {
  const home = os.homedir();
  const root = path.resolve(projectRoot);
  if (ideGlobal) {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const codexHome = process.env.CODEX_HOME ? path.resolve(expandTilde(process.env.CODEX_HOME)) : path.join(home, '.codex');
    return {
      ideGlobal: true,
      opencodeCommandDirs: [path.join(xdg, 'opencode', 'commands'), path.join(home, '.opencode', 'commands')],
      geminiCommandsBase: path.join(home, '.gemini', 'commands'),
      windsurfWorkflowsDir: path.join(home, '.codeium', 'windsurf', 'global_workflows'),
      codexPromptsDir: path.join(codexHome, 'prompts'),
      codexAgentsSkillsRoot: path.join(home, '.agents', 'skills'),
      antigravitySkillsRoot: path.join(home, '.gemini', 'antigravity', 'skills'),
      claudeAgentsDir: path.join(home, '.claude', 'agents'),
    };
  }
  return {
    ideGlobal: false,
    opencodeCommandDirs: [path.join(root, '.opencode', 'commands')],
    geminiCommandsBase: path.join(root, '.gemini', 'commands'),
    windsurfWorkflowsDir: path.join(root, '.windsurf', 'global_workflows'),
    codexPromptsDir: path.join(root, '.codex', 'prompts'),
    codexAgentsSkillsRoot: path.join(root, '.agents', 'skills'),
    antigravitySkillsRoot: path.join(root, '.gemini', 'antigravity', 'skills'),
    claudeAgentsDir: path.join(root, '.claude', 'agents'),
  };
}

/** @param {string} content */
function adjustWorkflowPathsForNestedLayout(content) {
  return content
    .replace(/\boxe\/workflows\//g, '.oxe/workflows/')
    .replace(/\boxe\/templates\//g, '.oxe/templates/');
}

/**
 * @param {string} text
 * @returns {{ description: string, body: string, frontmatter: Record<string, string> }}
 */
function parseCursorCommandFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { description: '', body: normalized.trim(), frontmatter: {} };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { description: '', body: normalized.trim(), frontmatter: {} };
  }
  const yamlBlock = normalized.slice(4, end);
  const frontmatter = {};
  let description = '';
  const yamlLines = yamlBlock.split('\n');
  for (let i = 0; i < yamlLines.length; i++) {
    const line = yamlLines[i];
    const foldedDescription = line.match(/^description:\s*[>|]\s*$/);
    if (foldedDescription) {
      const parts = [];
      let j = i + 1;
      while (j < yamlLines.length && /^\s+/.test(yamlLines[j])) {
        const value = yamlLines[j].trim();
        if (value) parts.push(value);
        j += 1;
      }
      description = parts.join(' ').trim();
      frontmatter.description = description;
      i = j - 1;
      continue;
    }
    const m = line.match(/^description:\s*(.+)$/);
    if (m) {
      description = m[1].trim().replace(/^["']|["']$/g, '');
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (kv) frontmatter[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  const body = normalized.slice(end + 5).trim();
  return { description, body, frontmatter };
}

/**
 * @param {string} skillName
 * @param {string} description
 * @param {string} body
 * @param {Record<string, string>} [metadata]
 */
function buildAgentSkillMarkdown(skillName, description, body, metadata) {
  const desc = description.trim() || `Comando OXE — ${skillName}`;
  const meta = metadata ? runtimeSemantics.pickRuntimeMetadata(metadata) : {};
  const metaLines = Object.keys(meta).length
    ? `${runtimeSemantics.renderRuntimeMetadataLines(meta).join('\n')}\n`
    : '';
  return (
    `---\n` +
    `name: ${skillName}\n` +
    `description: ${JSON.stringify(desc)}\n` +
    `user-invocable: true\n` +
    metaLines +
    `---\n\n` +
    `${OXE_MANAGED_HTML}\n\n` +
    `${body}\n`
  );
}

/** @param {string} name */
function isOxeAgentMarkdownName(name) {
  return name.startsWith('oxe-') && name.endsWith('.md');
}

/**
 * @param {string} text
 * @returns {{ name: string, description: string, body: string, frontmatter: Record<string, string> }}
 */
function parseCanonicalAgentMarkdown(text) {
  const parsed = parseCursorCommandFrontmatter(text);
  return {
    name: parsed.frontmatter.name || '',
    description: parsed.description || parsed.frontmatter.description || '',
    body: parsed.body,
    frontmatter: parsed.frontmatter,
  };
}

/**
 * Instala agentes especializados OXE como markdown nativo para runtimes que suportam agentes.
 * @param {string} agentsSrc
 * @param {string} destDir
 * @param {{ dryRun: boolean, force: boolean }} opts
 * @param {(s: string) => void} [logOmitido]
 * @param {(s: string) => void} [logWrite]
 */
function installCanonicalAgentMarkdowns(agentsSrc, destDir, opts, logOmitido, logWrite) {
  if (!fs.existsSync(agentsSrc)) return;
  for (const name of fs.readdirSync(agentsSrc)) {
    if (!isOxeAgentMarkdownName(name)) continue;
    const src = path.join(agentsSrc, name);
    const dest = path.join(destDir, name);
    if (opts.dryRun) {
      if (logWrite) logWrite(`${src} → ${dest}`);
      continue;
    }
    if (fs.existsSync(dest) && !opts.force) {
      if (logOmitido) logOmitido(dest);
      continue;
    }
    const raw = fs.readFileSync(src, 'utf8');
    const out = raw.includes(OXE_MANAGED_HTML) ? raw : raw.replace(/\n?$/, `\n\n${OXE_MANAGED_HTML}\n`);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, out, 'utf8');
  }
}

/**
 * Instala agentes especializados OXE como skills Codex/Antigravity.
 * @param {string} agentsSrc
 * @param {string} skillsRoot
 * @param {{ dryRun: boolean, force: boolean }} opts
 * @param {(s: string) => void} [logOmitido]
 * @param {(s: string) => void} [logWrite]
 */
function installCanonicalAgentSkills(agentsSrc, skillsRoot, opts, logOmitido, logWrite) {
  if (!fs.existsSync(agentsSrc)) return;
  for (const name of fs.readdirSync(agentsSrc)) {
    if (!isOxeAgentMarkdownName(name)) continue;
    const src = path.join(agentsSrc, name);
    const raw = fs.readFileSync(src, 'utf8');
    const parsed = parseCanonicalAgentMarkdown(raw);
    const skillName = parsed.name || name.replace(/\.md$/i, '');
    const md = buildAgentSkillMarkdown(skillName, parsed.description, parsed.body, parsed.frontmatter);
    const destDir = path.join(skillsRoot, skillName);
    const dest = path.join(destDir, 'SKILL.md');
    if (opts.dryRun) {
      if (logWrite) logWrite(`${src} → ${dest}`);
      continue;
    }
    if (fs.existsSync(dest) && !opts.force) {
      if (logOmitido) logOmitido(dest);
      continue;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, md, 'utf8');
  }
}

/**
 * @returns {string[]}
 */
function opencodeCommandDirs() {
  return buildAgentInstallPaths(true, process.cwd()).opencodeCommandDirs;
}

function windsurfGlobalWorkflowsDir() {
  return buildAgentInstallPaths(true, process.cwd()).windsurfWorkflowsDir;
}

function geminiUserDir() {
  return path.join(os.homedir(), '.gemini');
}

function codexAgentsSkillsRoot() {
  return buildAgentInstallPaths(true, process.cwd()).codexAgentsSkillsRoot;
}

function codexPromptsDir() {
  return buildAgentInstallPaths(true, process.cwd()).codexPromptsDir;
}

function antigravitySkillsRoot() {
  return buildAgentInstallPaths(true, process.cwd()).antigravitySkillsRoot;
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
    const { description, body, frontmatter } = parseCursorCommandFrontmatter(raw);
    const desc = descSuffix ? `${description.trim()} ${descSuffix}`.trim() : description.trim();
    const md = buildAgentSkillMarkdown(skillName, desc, body, frontmatter);
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
 * @param {AgentInstallPaths} paths
 */
function installOpenCodeCommands(cCmdSrc, paths, opts, pathRewriteNested, logOmitido, logWrite) {
  if (!fs.existsSync(cCmdSrc)) return;
  for (const destDir of paths.opencodeCommandDirs) {
    for (const name of fs.readdirSync(cCmdSrc)) {
      if (!isOxeCommandMarkdownName(name)) continue;
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
 * @param {AgentInstallPaths} paths
 */
function installGeminiTomlCommands(cCmdSrc, paths, opts, pathRewriteNested, logOmitido, logWrite) {
  if (!fs.existsSync(cCmdSrc)) return;
  const base = paths.geminiCommandsBase;

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
 * Windsurf Cascade: workflows globais ou ./.windsurf/global_workflows (local).
 * @param {AgentInstallPaths} paths
 */
function installWindsurfGlobalWorkflows(cCmdSrc, paths, opts, pathRewriteNested, logOmitido, logWrite) {
  if (!fs.existsSync(cCmdSrc)) return;
  const destDir = paths.windsurfWorkflowsDir;
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
 * Codex: prompts em ~/.codex/prompts ou ./.codex/prompts (local).
 * @param {AgentInstallPaths} paths
 */
function installCodexPrompts(cCmdSrc, paths, opts, pathRewriteNested, logOmitido, logWrite) {
  if (!fs.existsSync(cCmdSrc)) return;
  const destDir = paths.codexPromptsDir;
  for (const name of fs.readdirSync(cCmdSrc)) {
    if (!isOxeCommandMarkdownName(name)) continue;
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
    const { description, body, frontmatter } = parseCursorCommandFrontmatter(raw);
    const meta = runtimeSemantics.pickRuntimeMetadata(frontmatter);
    const metaLines = Object.keys(meta).length
      ? `${runtimeSemantics.renderRuntimeMetadataLines(meta).join('\n')}\n`
      : '';
    const out =
      `---\n` +
      `description: ${JSON.stringify(description || 'OXE')}\n` +
      `argument-hint: [texto livre opcional]\n` +
      metaLines +
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
 * @param {AgentInstallPaths} [paths] omissão = instalação global (HOME)
 */
function cleanupMarkedUnifiedArtifacts(u, paths) {
  const p = paths || buildAgentInstallPaths(true, process.cwd());
  const targets = u && typeof u === 'object' && u.targets && typeof u.targets === 'object' ? u.targets : null;
  const shouldClean = (name) => !targets || targets[name] !== false;

  const unlinkQuiet = (filePath) => {
    if (!fs.existsSync(filePath)) return;
    if (u.dryRun) return;
    try {
      fs.unlinkSync(filePath);
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

  if (shouldClean('opencode')) {
    for (const dir of p.opencodeCommandDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!isOxeCommandMarkdownName(name)) continue;
        const filePath = path.join(dir, name);
        let txt = '';
        try {
          txt = fs.readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }
        if (txt.includes(OXE_MANAGED_HTML)) unlinkQuiet(filePath);
      }
    }
  }

  if (shouldClean('gemini')) {
    const gBase = p.geminiCommandsBase;
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
        const filePath = path.join(oxeSub, name);
        try {
          if (fs.readFileSync(filePath, 'utf8').includes(OXE_MANAGED_TOML)) unlinkQuiet(filePath);
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
  }

  if (shouldClean('windsurf')) {
    const wfDir = p.windsurfWorkflowsDir;
    if (fs.existsSync(wfDir)) {
      for (const name of fs.readdirSync(wfDir)) {
        if (!isOxeCommandMarkdownName(name)) continue;
        const filePath = path.join(wfDir, name);
        try {
          if (fs.readFileSync(filePath, 'utf8').includes(OXE_MANAGED_HTML)) unlinkQuiet(filePath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (shouldClean('codex')) {
    const cpDir = p.codexPromptsDir;
    if (fs.existsSync(cpDir)) {
      for (const name of fs.readdirSync(cpDir)) {
        if (!isOxeCommandMarkdownName(name)) continue;
        const filePath = path.join(cpDir, name);
        try {
          if (fs.readFileSync(filePath, 'utf8').includes(OXE_MANAGED_HTML)) unlinkQuiet(filePath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (shouldClean('claude')) {
    const clAgents = p.claudeAgentsDir;
    if (fs.existsSync(clAgents)) {
      for (const name of fs.readdirSync(clAgents)) {
        if (!isOxeAgentMarkdownName(name)) continue;
        const filePath = path.join(clAgents, name);
        try {
          if (fs.readFileSync(filePath, 'utf8').includes(OXE_MANAGED_HTML)) unlinkQuiet(filePath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (shouldClean('antigravity')) {
    const agRoot = p.antigravitySkillsRoot;
    if (fs.existsSync(agRoot)) {
      for (const name of fs.readdirSync(agRoot, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        if (!/^oxe($|-)/.test(name.name)) continue;
        rmDirIfOxeSkill(path.join(agRoot, name.name));
      }
    }
  }

  if (shouldClean('codex')) {
    const cxRoot = p.codexAgentsSkillsRoot;
    if (fs.existsSync(cxRoot)) {
      for (const name of fs.readdirSync(cxRoot, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        if (!/^oxe($|-)/.test(name.name)) continue;
        rmDirIfOxeSkill(path.join(cxRoot, name.name));
      }
    }
  }
}

module.exports = {
  OXE_MANAGED_HTML,
  OXE_MANAGED_TOML,
  buildAgentInstallPaths,
  adjustWorkflowPathsForNestedLayout,
  parseCursorCommandFrontmatter,
  buildAgentSkillMarkdown,
  installSkillTreeFromCursorCommands,
  installOpenCodeCommands,
  installGeminiTomlCommands,
  installWindsurfGlobalWorkflows,
  installCodexPrompts,
  installCanonicalAgentMarkdowns,
  installCanonicalAgentSkills,
  opencodeCommandDirs,
  windsurfGlobalWorkflowsDir,
  geminiUserDir,
  codexAgentsSkillsRoot,
  codexPromptsDir,
  antigravitySkillsRoot,
  isOxeCommandMarkdownName,
  isOxeAgentMarkdownName,
  cleanupMarkedUnifiedArtifacts,
};
