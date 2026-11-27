'use strict';

/**
 * 1.22.2 (OXB-222-12): Agnostic, 100% read-only onboarding context pack (`oxe-cc onboard`).
 * Auto-discovers OXE profile/state, toolchain/env leaks, CI pipelines (GitHub Actions, GitLab CI,
 * Azure Pipelines, Bitbucket Pipelines, CircleCI, Jenkins, or local-only), ALM provider
 * (Jira, Azure DevOps, custom, or none/local), delivery/origin rules and CI-vs-phase_gates gaps.
 *
 * Strictly zero network calls, zero disk writes unless `{ write: true }`, and never emits secret values.
 */

const fs = require('fs');
const path = require('path');

function readJsonQuiet(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readTextQuiet(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readMergedConfig(projectRoot) {
  const base = readJsonQuiet(path.join(projectRoot, 'oxe.config.json'));
  const local = readJsonQuiet(path.join(projectRoot, '.oxe', 'config.json'));
  if (base && typeof base === 'object' && local && typeof local === 'object') {
    return { ...base, ...local };
  }
  return (local && typeof local === 'object') ? local : ((base && typeof base === 'object') ? base : {});
}

function detectProjectStacks(projectRoot, config = {}) {
  const stacks = [];
  const exists = (rel) => fs.existsSync(path.join(projectRoot, rel));
  const pkg = readJsonQuiet(path.join(projectRoot, 'package.json'));
  if (pkg) stacks.push('node');
  if (exists('tsconfig.json')) stacks.push('typescript');
  if (exists('pyproject.toml') || exists('requirements.txt') || exists('setup.py') || exists('Pipfile')) stacks.push('python');
  if (exists('go.mod')) stacks.push('go');
  if (exists('Cargo.toml')) stacks.push('rust');
  if (exists('pom.xml') || exists('build.gradle') || exists('build.gradle.kts')) stacks.push('java');
  try {
    const entries = fs.readdirSync(projectRoot);
    if (entries.some((e) => /\.(?:csproj|sln|fsproj)$/i.test(e))) stacks.push('dotnet');
  } catch { /* ignore */ }
  if (exists('mobile/android') || exists('android/build.gradle') || exists('android/build.gradle.kts')) stacks.push('android');
  if (
    config.profile === 'legacy'
    || (Array.isArray(config.scan_focus_globs) && config.scan_focus_globs.some((g) => /\b(cbl|jcl|cpy|cob|vb)\b/i.test(String(g))))
  ) {
    stacks.push('legacy');
  }
  const packageScripts = pkg && pkg.scripts && typeof pkg.scripts === 'object'
    ? Object.keys(pkg.scripts).slice(0, 30)
    : [];
  return {
    stacks: [...new Set(stacks)],
    package_name: (pkg && pkg.name) || path.basename(path.resolve(projectRoot)),
    package_scripts: packageScripts,
  };
}

const BOILERPLATE_CMD_RE = /^(?:#|echo\b|cd\s|export\s|set\s+-|mkdir\b|rm\s+-rf\b|cp\s|mv\s|chmod\b|git\s+(?:config|checkout|fetch|pull|status)\b|npm\s+(?:ci|install)\b|pnpm\s+install\b|yarn\s+install\b|pip\s+install\b|poetry\s+install\b|apt-get\b|brew\s+install\b|choco\b)/i;

function cleanCommand(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+#.*$/, '')
    .trim();
  if (!s || s.length < 3 || s.length > 220) return null;
  if (BOILERPLATE_CMD_RE.test(s)) return null;
  if (/^\$\{\{|^if\s+\[|^fi$|^done$|^for\s+/.test(s)) return null;
  return s;
}

function extractYamlBlockOrInlineCommands(text, keyRe) {
  const lines = String(text || '').split(/\r?\n/);
  const cmds = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = keyRe.exec(line);
    if (!m) continue;
    const indent = line.search(/\S/);
    const val = String(m[1] || '').trim();
    if (!val || val === '|' || val === '>' || val === '|-' || val === '>-') {
      for (let j = i + 1; j < lines.length; j += 1) {
        const sub = lines[j];
        if (!sub.trim()) continue;
        const subIndent = sub.search(/\S/);
        if (subIndent <= indent) break;
        const c = cleanCommand(sub);
        if (c) cmds.push(c);
      }
    } else {
      const c = cleanCommand(val);
      if (c) cmds.push(c);
    }
  }
  return [...new Set(cmds)];
}

function extractJenkinsCommands(text) {
  const cmds = [];
  for (const m of String(text || '').matchAll(/\b(?:sh|bat|powershell)\s*\(?\s*['"]([^'"\r\n]+)['"]/g)) {
    const c = cleanCommand(m[1]);
    if (c) cmds.push(c);
  }
  return [...new Set(cmds)];
}

/**
 * Agnostically discovers CI pipeline definitions across GitHub Actions, GitLab CI,
 * Azure Pipelines, Bitbucket Pipelines, CircleCI, and Jenkins.
 */
function detectCiPipelines(projectRoot) {
  const providers = new Set();
  const pipelines = [];
  const allCommands = [];
  const addPipeline = (provider, relFile, commands) => {
    providers.add(provider);
    pipelines.push({ provider, file: relFile.replace(/\\/g, '/'), commands });
    for (const c of commands) if (!allCommands.includes(c)) allCommands.push(c);
  };

  // 1. GitHub Actions (.github/workflows/*.y*ml)
  const ghDir = path.join(projectRoot, '.github', 'workflows');
  if (fs.existsSync(ghDir)) {
    try {
      for (const f of fs.readdirSync(ghDir).filter((n) => /\.ya?ml$/i.test(n)).sort()) {
        const rel = `.github/workflows/${f}`;
        const body = readTextQuiet(path.join(ghDir, f));
        const cmds = extractYamlBlockOrInlineCommands(body, /^\s*(?:-\s*)?run\s*:\s*(.*)$/);
        addPipeline('github-actions', rel, cmds);
      }
    } catch { /* ignore */ }
  }

  // 2. GitLab CI (.gitlab-ci.yml)
  const glFile = path.join(projectRoot, '.gitlab-ci.yml');
  if (fs.existsSync(glFile)) {
    const body = readTextQuiet(glFile);
    const cmds = extractYamlBlockOrInlineCommands(body, /^\s*(?:script|before_script)\s*:\s*(.*)$/);
    addPipeline('gitlab-ci', '.gitlab-ci.yml', cmds);
  }

  // 3. Azure Pipelines (azure-pipelines.y*ml + .azure-pipelines/*.y*ml)
  const azCandidates = ['azure-pipelines.yml', 'azure-pipelines.yaml'];
  const azDir = path.join(projectRoot, '.azure-pipelines');
  if (fs.existsSync(azDir)) {
    try {
      for (const f of fs.readdirSync(azDir).filter((n) => /\.ya?ml$/i.test(n)).sort()) {
        azCandidates.push(`.azure-pipelines/${f}`);
      }
    } catch { /* ignore */ }
  }
  for (const rel of azCandidates) {
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const body = readTextQuiet(abs);
    const cmds = extractYamlBlockOrInlineCommands(body, /^\s*(?:-\s*)?(?:script|bash|pwsh|powershell)\s*:\s*(.*)$/i);
    addPipeline('azure-pipelines', rel, cmds);
  }

  // 4. Bitbucket Pipelines (bitbucket-pipelines.yml)
  const bbFile = path.join(projectRoot, 'bitbucket-pipelines.yml');
  if (fs.existsSync(bbFile)) {
    const body = readTextQuiet(bbFile);
    const cmds = extractYamlBlockOrInlineCommands(body, /^\s*script\s*:\s*(.*)$/);
    addPipeline('bitbucket-pipelines', 'bitbucket-pipelines.yml', cmds);
  }

  // 5. CircleCI (.circleci/config.yml)
  const ccFile = path.join(projectRoot, '.circleci', 'config.yml');
  if (fs.existsSync(ccFile)) {
    const body = readTextQuiet(ccFile);
    const cmds = extractYamlBlockOrInlineCommands(body, /^\s*(?:-\s*)?(?:run|command)\s*:\s*(.*)$/);
    addPipeline('circleci', '.circleci/config.yml', cmds);
  }

  // 6. Jenkins (Jenkinsfile)
  const jkFile = path.join(projectRoot, 'Jenkinsfile');
  if (fs.existsSync(jkFile)) {
    const body = readTextQuiet(jkFile);
    const cmds = extractJenkinsCommands(body);
    addPipeline('jenkins', 'Jenkinsfile', cmds);
  }

  const providerList = [...providers];
  return {
    mode: providerList.length ? 'ci' : 'local-only',
    providers: providerList,
    pipelines,
    commands: allCommands,
  };
}

function commandSignature(cmd) {
  return String(cmd || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isCommandMirrored(ciCmd, localGateCommands) {
  const ciNorm = commandSignature(ciCmd);
  if (!ciNorm) return false;
  for (const local of localGateCommands) {
    const lNorm = commandSignature(local);
    if (!lNorm) continue;
    if (lNorm === ciNorm || lNorm.includes(ciNorm) || ciNorm.includes(lNorm)) return true;
  }
  return false;
}

/**
 * Agnostically detects ALM / Issue Tracker configuration (Jira, Azure DevOps, custom, or none/local).
 * Never returns credential/token values — only variable names and boolean `present`.
 */
function detectAlmProfile(projectRoot, config = {}, env = process.env) {
  const raw = config && config.alm && typeof config.alm === 'object' ? config.alm : null;
  const provider = raw && raw.provider ? String(raw.provider).trim().toLowerCase() : 'none';
  if (!raw || !provider || provider === 'none') {
    return {
      configured: false,
      provider: 'none',
      transport: null,
      project: null,
      states: {},
      track: [],
      writer: null,
      require_apply: false,
      env_vars: [],
      missing_env_vars: [],
      note: 'ALM não configurado — o OXE opera 100% localmente via .oxe/ sem exigir Jira ou Azure DevOps.',
    };
  }

  const transport = raw.transport ? String(raw.transport).trim().toLowerCase() : 'rest';
  let project = null;
  const envVarNames = [];

  if (provider === 'jira') {
    const j = raw.jira && typeof raw.jira === 'object' ? raw.jira : {};
    project = j.project || raw.project || null;
    if (transport === 'rest') {
      if (!j.site && !raw.site) envVarNames.push(j.site_env || 'JIRA_SITE');
      envVarNames.push(j.email_env || 'JIRA_EMAIL');
      envVarNames.push(j.token_env || 'JIRA_API_TOKEN');
    }
  } else if (provider === 'azure-devops') {
    const az = raw.azure_devops && typeof raw.azure_devops === 'object' ? raw.azure_devops : {};
    project = az.project || raw.project || null;
    if (transport === 'rest') {
      if (!az.org && !raw.org) envVarNames.push(az.org_env || 'AZURE_DEVOPS_ORG');
      envVarNames.push(az.token_env || 'AZURE_DEVOPS_EXT_PAT');
    }
  } else {
    project = raw.project || null;
    if (raw.token_env) envVarNames.push(String(raw.token_env));
  }

  const envVars = [...new Set(envVarNames)].map((name) => ({
    name,
    present: Boolean(env && env[name] && String(env[name]).trim()),
  }));
  const missingEnvVars = envVars.filter((v) => !v.present).map((v) => v.name);
  const states = raw.states && typeof raw.states === 'object' ? raw.states : {};
  const track = Array.isArray(raw.track) ? raw.track.map(String) : [];

  return {
    configured: true,
    provider,
    transport,
    project,
    fix_version: raw.fix_version || null,
    states,
    track,
    writer: raw.writer || null,
    require_apply: Boolean(raw.require_apply),
    env_vars: envVars,
    missing_env_vars: missingEnvVars,
    note: transport === 'mcp'
      ? `ALM ${provider} via MCP (sem tokens locais; operações passam por oxe-cc alm queue).`
      : `ALM ${provider} via REST (somente leitura até --apply; nunca exponha tokens).`,
  };
}

function detectGitRemoteHost(projectRoot) {
  const cfg = readTextQuiet(path.join(projectRoot, '.git', 'config'));
  const m = /\[remote "origin"\][\s\S]*?url\s*=\s*([^\r\n]+)/i.exec(cfg);
  if (!m) return null;
  const url = m[1].trim();
  if (/github\.com/i.test(url)) return 'github';
  if (/gitlab\.com|gitlab\./i.test(url)) return 'gitlab';
  if (/dev\.azure\.com|visualstudio\.com/i.test(url)) return 'azure-repos';
  if (/bitbucket\.org/i.test(url)) return 'bitbucket';
  return 'custom-git';
}

function buildOnboardingPack(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const env = options.env || process.env;
  const config = readMergedConfig(rootAbs);
  const hasOxeDir = fs.existsSync(path.join(rootAbs, '.oxe'));
  const hasOxeConfig = fs.existsSync(path.join(rootAbs, '.oxe', 'config.json')) || fs.existsSync(path.join(rootAbs, 'oxe.config.json'));

  const projectInfo = detectProjectStacks(rootAbs, config);
  const ciRaw = detectCiPipelines(rootAbs);
  const alm = detectAlmProfile(rootAbs, config, env);

  // Environment check (instant, read-only, nativeCheck off by default)
  let envCheck = { ok: true, problems: [], warnings: [], scrubbed_env: [], leaked_env: [], toolchain: { node: process.versions.node, platform: process.platform, arch: process.arch } };
  try {
    envCheck = require('./oxe-project-env.cjs').checkProjectEnvironment(rootAbs, {
      env,
      nativeCheck: options.nativeCheck === true,
    });
  } catch { /* fallback safe */ }

  // Local gates & triggers
  const localGateCommands = [];
  if (Array.isArray(config.phase_gates)) {
    for (const g of config.phase_gates) if (g && g.command) localGateCommands.push(String(g.command));
  }
  if (config.preflight && Array.isArray(config.preflight.checks)) {
    for (const c of config.preflight.checks) if (c && c.command) localGateCommands.push(String(c.command));
  }
  if (config.preflight && Array.isArray(config.preflight.triggers)) {
    for (const t of config.preflight.triggers) {
      if (t && t.command) localGateCommands.push(String(t.command));
      if (t && Array.isArray(t.commands)) for (const c of t.commands) localGateCommands.push(String(c));
    }
  }
  if (Array.isArray(config.task_gates)) {
    for (const g of config.task_gates) if (g && g.command) localGateCommands.push(String(g.command));
  }

  const mirroredCommands = ciRaw.commands.filter((c) => isCommandMirrored(c, localGateCommands));
  const unmirroredCommands = ciRaw.commands.filter((c) => !isCommandMirrored(c, localGateCommands));

  let suggestedPathGates = [];
  try {
    const pg = require('./oxe-phase-gates.cjs');
    if (typeof pg.suggestPathGates === 'function') {
      suggestedPathGates = pg.suggestPathGates(rootAbs).slice(0, 8);
    }
  } catch { /* optional */ }

  // OXE state/health read-only
  let nextStep = null;
  let activeSession = options.activeSession || null;
  let activePhase = null;
  let oxeVersion = null;
  try {
    const vDoc = readJsonQuiet(path.join(rootAbs, '.oxe', 'oxe-version.json'));
    if (vDoc && vDoc.oxe_version) oxeVersion = vDoc.oxe_version;
    if (hasOxeDir) {
      const h = require('./oxe-project-health.cjs').buildHealthReport(rootAbs);
      if (h && h.next) nextStep = { command: h.next.cursorCmd || h.next.command || null, reason: h.next.reason || null };
      if (!activeSession && h && h.session) activeSession = h.session;
    }
  } catch { /* optional */ }

  try {
    const progFile = activeSession
      ? path.join(rootAbs, '.oxe', activeSession, 'program', 'PROGRAM.json')
      : path.join(rootAbs, '.oxe', 'program', 'PROGRAM.json');
    const prog = readJsonQuiet(progFile) || readJsonQuiet(path.join(rootAbs, '.oxe', 'program', 'PROGRAM.json'));
    if (prog && prog.active_phase) activePhase = prog.active_phase;
  } catch { /* optional */ }

  const profile = config.profile || 'balanced';
  const planCeremony = config.plan_ceremony || (profile === 'lean' ? 'lean' : 'full');
  const presets = Array.isArray(config.presets) ? config.presets : (config.preset ? [config.preset] : []);
  const deliveryCfg = config.delivery && typeof config.delivery === 'object' ? config.delivery : { mode: typeof config.delivery === 'string' ? config.delivery : 'local' };
  const originCfg = config.origin && typeof config.origin === 'object' ? config.origin : {};
  const shipCfg = config.ship && typeof config.ship === 'object' ? config.ship : {};
  const syncCfg = config.sync && typeof config.sync === 'object' ? config.sync : {};

  // Adaptive operational rules tailored to the project's actual setup
  const rules = [
    'Use sempre `oxe-cc` instalado (nunca `npx oxe-cc` sem versão).',
    'Nunca edite teste de aceite congelado sem `oxe-cc plan amend-test <path> --reason "<CR>"` + OK do usuário.',
    'Commits de código sempre via `oxe-cc runtime commit-task T<n>` ou `oxe-cc quick commit` (nunca commit manual solto).',
    'Para ampliar escopo de tarefa pós-CI, use `oxe-cc plan scope add T<n> <arquivo> --auto-cr --reason "..."`.',
    'Nunca faça push remoto, abra PR/MR ou faça merge sem OK explícito do usuário.',
  ];
  if (alm.configured) {
    rules.push(`ALM (${alm.provider}/${alm.transport}): rode leitura/simulação (--dry-run) antes de qualquer escrita e nunca exponha credenciais.`);
  } else {
    rules.push('ALM não configurado: opere 100% localmente via `.oxe/` (sem exigir Jira ou Azure DevOps).');
  }

  // Actionable onboarding gaps
  const gaps = [];
  if (!hasOxeConfig) gaps.push('Projeto sem `.oxe/config.json` ou `oxe.config.json` — rode `oxe-cc init-oxe` ou `oxe-cc install --oxe-only`.');
  if (profile !== 'lean') gaps.push(`Profile atual é "${profile}" (considere "profile": "lean" para menor cerimônia mantendo testes congelados e gates).`);
  if (unmirroredCommands.length) {
    gaps.push(`${unmirroredCommands.length} comando(s) de CI não espelhado(s) em phase_gates/preflight.triggers locais: ${unmirroredCommands.slice(0, 5).join(', ')}${unmirroredCommands.length > 5 ? '…' : ''}.`);
  }
  if (envCheck.leaked_env && envCheck.leaked_env.length) {
    gaps.push(`Variável(is) do shell coincidem com stripEnvPrefixes: ${envCheck.leaked_env.join(', ')}.`);
  }
  if (envCheck.worktrees && envCheck.worktrees.needs_gc) {
    const wt = envCheck.worktrees;
    const gcCmd = wt.nested_agent > 0
      ? 'oxe-cc gc-worktrees --merged --include-nested --ignore-agent-settings --apply'
      : 'oxe-cc gc-worktrees --merged --apply';
    gaps.push(`Higiene de worktrees: ${wt.secondary} worktree(s) secundária(s) (${wt.clean_merged} mergeada(s), ${wt.prunable} prunable, ${wt.nested_agent} aninhada(s)) — rode \`${gcCmd}\`.`);
  }
  if (alm.missing_env_vars.length) {
    gaps.push(`ALM (${alm.provider}) sem variável(is) de ambiente: ${alm.missing_env_vars.join(', ')}.`);
  }
  for (const p of envCheck.problems || []) gaps.push(`Ambiente (bloqueante): ${p}`);

  const pack = {
    ok: true,
    read_only: !options.write,
    written_path: null,
    project: {
      name: projectInfo.package_name,
      root: rootAbs,
      stacks: projectInfo.stacks,
      package_scripts: projectInfo.package_scripts,
      git_remote_host: detectGitRemoteHost(rootAbs),
    },
    oxe: {
      initialized: hasOxeDir,
      config_present: hasOxeConfig,
      oxe_version: oxeVersion,
      profile,
      plan_ceremony: planCeremony,
      presets,
      active_session: activeSession,
      active_phase: activePhase,
      next_step: nextStep,
      local_gates_count: localGateCommands.length,
    },
    environment: {
      ok: Boolean(envCheck.ok),
      toolchain: envCheck.toolchain || {},
      problems: envCheck.problems || [],
      warnings: envCheck.warnings || [],
      leaked_env: envCheck.leaked_env || [],
      scrubbed_env: envCheck.scrubbed_env || [],
      worktrees: envCheck.worktrees || null,
    },
    ci: {
      mode: ciRaw.mode,
      providers: ciRaw.providers,
      pipelines: ciRaw.pipelines,
      commands: ciRaw.commands,
      mirrored_commands: mirroredCommands,
      unmirrored_commands: unmirroredCommands,
      suggested_path_gates: suggestedPathGates,
    },
    alm,
    delivery: {
      mode: deliveryCfg.mode || 'local',
      deploy_env: deliveryCfg.deploy_env || null,
      train_labels: Array.isArray(shipCfg.train_labels) ? shipCfg.train_labels : [],
      origin_base: originCfg.base || null,
      origin_commit_msg: originCfg.commit_msg || 'require',
      allow_no_alm_quick: Boolean(originCfg.allow_no_alm_quick),
      sync_version_pins: Array.isArray(syncCfg.version_pins) ? syncCfg.version_pins.length : 0,
    },
    rules,
    gaps,
    prompt_markdown: '',
  };

  pack.prompt_markdown = renderOnboardingMarkdown(pack);

  if (options.write) {
    const outRel = '.oxe/ONBOARDING.md';
    const outAbs = path.join(rootAbs, outRel);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, `${pack.prompt_markdown}\n`, 'utf8');
    pack.written_path = outRel;
    pack.read_only = false;
  }

  return pack;
}

function renderOnboardingMarkdown(pack) {
  const lines = [
    `# OXE Onboarding — ${pack.project.name}`,
    '',
    '## 1. Ambiente & OXE',
    `- **Profile / Cerimônia:** \`${pack.oxe.profile}\` (\`${pack.oxe.plan_ceremony}\`)${pack.oxe.presets.length ? ` · presets: ${pack.oxe.presets.join(', ')}` : ''}`,
    `- **Stack detectada:** ${pack.project.stacks.length ? pack.project.stacks.join(', ') : 'genérica'}${pack.project.git_remote_host ? ` · git host: \`${pack.project.git_remote_host}\`` : ''}`,
    `- **Sessão / Fase ativa:** ${pack.oxe.active_session || 'raiz (.oxe/)'} · fase: ${pack.oxe.active_phase || 'nenhuma'}${pack.oxe.next_step && pack.oxe.next_step.command ? ` · próximo: \`${pack.oxe.next_step.command}\`` : ''}`,
    `- **Toolchain:** node ${pack.environment.toolchain.node || '?'} · ${pack.environment.toolchain.platform || '?'}/${pack.environment.toolchain.arch || '?'}${pack.environment.leaked_env.length ? ` · env leak (stripEnvPrefixes): ${pack.environment.leaked_env.join(', ')}` : ''}`,
    ...(pack.environment.worktrees && pack.environment.worktrees.secondary > 0
      ? [`- **Worktrees secundárias:** ${pack.environment.worktrees.secondary} (${pack.environment.worktrees.clean_merged} mergeada(s), ${pack.environment.worktrees.prunable} prunable, ${pack.environment.worktrees.nested_agent} aninhada(s))${pack.environment.worktrees.needs_gc ? ' · limpeza recomendada (`oxe-cc gc-worktrees --merged --apply`)' : ''}`]
      : []),
    '',
    '## 2. CI / Pipelines (Agnóstico)',
    `- **Provedor(es):** ${pack.ci.providers.length ? pack.ci.providers.join(', ') : 'local-only (nenhum pipeline de CI detectado)'}`,
  ];
  if (pack.ci.pipelines.length) {
    lines.push(`- **Arquivos:** ${pack.ci.pipelines.map((p) => `\`${p.file}\``).join(', ')}`);
  }
  lines.push(`- **Espelhados em phase_gates/preflight locais:** ${pack.ci.mirrored_commands.length ? pack.ci.mirrored_commands.map((c) => `\`${c}\``).join(', ') : 'nenhum'}`);
  if (pack.ci.unmirrored_commands.length) {
    lines.push(`- **Lacunas (rodam só no CI):** ${pack.ci.unmirrored_commands.slice(0, 8).map((c) => `\`${c}\``).join(', ')}`);
  }

  lines.push('', '## 3. ALM / Issue Tracker (Agnóstico)');
  if (!pack.alm.configured) {
    lines.push(`- **Provedor:** \`none\` (sem ALM — operação 100% local via \`.oxe/\`, sem exigir Jira ou Azure DevOps).`);
  } else {
    lines.push(`- **Provedor / Transporte:** \`${pack.alm.provider}\` / \`${pack.alm.transport}\`${pack.alm.project ? ` · projeto: \`${pack.alm.project}\`` : ''}${pack.alm.require_apply ? ' · `require_apply: true`' : ''}`);
    const stateKeys = Object.keys(pack.alm.states || {});
    if (stateKeys.length) lines.push(`- **Colunas mapeadas:** ${stateKeys.map((k) => `${k}→${pack.alm.states[k]}`).join(', ')}`);
    if (pack.alm.track.length) lines.push(`- **Etapas movidas pelo OXE (\`track\`):** ${pack.alm.track.join(', ')}`);
    if (pack.alm.env_vars.length) {
      lines.push(`- **Variáveis requeridas (nomes apenas):** ${pack.alm.env_vars.map((v) => `${v.name} (${v.present ? 'OK' : 'ausente'})`).join(', ')}`);
    }
  }

  lines.push(
    '',
    '## 4. Entrega & Origem',
    `- **Delivery:** \`${pack.delivery.mode}\`${pack.delivery.deploy_env ? ` (deploy_env: \`${pack.delivery.deploy_env}\`)` : ''}${pack.delivery.origin_base ? ` · origin.base: \`${pack.delivery.origin_base}\`` : ''}${pack.delivery.sync_version_pins ? ` · sync.version_pins: ${pack.delivery.sync_version_pins}` : ''}`,
    '',
    '## 5. Lacunas Detectadas',
    ...(pack.gaps.length ? pack.gaps.map((g) => `- ${g}`) : ['- Nenhuma lacuna crítica detectada.']),
    '',
    '## 6. Regras Operacionais Fixas',
    ...pack.rules.map((r) => `- ${r}`),
  );
  return lines.join('\n');
}

module.exports = {
  buildOnboardingPack,
  detectCiPipelines,
  detectAlmProfile,
  detectProjectStacks,
  renderOnboardingMarkdown,
};
