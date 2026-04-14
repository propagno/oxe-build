'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
const { isolatedHomeEnv } = require('./isolated-home-env.cjs');

function run(args, cwd = REPO_ROOT) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: isolatedHomeEnv(fakeHome),
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', fakeHome };
}

describe('oxe-cc CLI', () => {
  test('unknown flag exits 1', () => {
    const { status, stderr } = run(['--not-a-real-flag']);
    assert.strictEqual(status, 1);
    assert.match(stderr, /Opção desconhecida/);
  });

  test('install nests workflows under .oxe and bootstraps (no oxe/ at repo root)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['--oxe-only', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'references', 'legacy-brownfield.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'quick.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'STATE.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'config.json')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'codebase')));
    assert.ok(!fs.existsSync(path.join(dir, 'oxe')), 'default layout must not create top-level oxe/');
    // schemas devem ser copiados para .oxe/schemas/
    assert.ok(
      fs.existsSync(path.join(dir, '.oxe', 'schemas', 'plan-agents.schema.json')),
      '.oxe/schemas/plan-agents.schema.json deve existir após install'
    );
    const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.match(gi, /\.oxe\/\s*$/m);
  });

  test('commands/oxe/ has review-pr.md, update.md, session.md, ask.md, capabilities.md and dashboard.md', () => {
    const path_ = require('path');
    const cmdsDir = path_.join(__dirname, '..', 'commands', 'oxe');
    assert.ok(
      require('fs').existsSync(path_.join(cmdsDir, 'review-pr.md')),
      'commands/oxe/review-pr.md deve existir'
    );
    assert.ok(
      require('fs').existsSync(path_.join(cmdsDir, 'update.md')),
      'commands/oxe/update.md deve existir'
    );
    assert.ok(
      require('fs').existsSync(path_.join(cmdsDir, 'session.md')),
      'commands/oxe/session.md deve existir'
    );
    assert.ok(
      require('fs').existsSync(path_.join(cmdsDir, 'ask.md')),
      'commands/oxe/ask.md deve existir'
    );
    assert.ok(
      require('fs').existsSync(path_.join(cmdsDir, 'capabilities.md')),
      'commands/oxe/capabilities.md deve existir'
    );
    assert.ok(
      require('fs').existsSync(path_.join(cmdsDir, 'dashboard.md')),
      'commands/oxe/dashboard.md deve existir'
    );
  });

  test('--no-init-oxe skips .oxe bootstrap but keeps .oxe/workflows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['--oxe-only', '--no-init-oxe', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'STATE.md')));
    const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.match(gi, /\.oxe\/\s*$/m);
  });

  test('doctor passes after install', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    assert.strictEqual(run(['--oxe-only', dir]).status, 0);
    const d = run(['doctor', dir]);
    assert.strictEqual(d.status, 0, d.stderr + d.stdout);
  });

  test('status exits 0 after oxe-only install and mentions próximo passo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    assert.strictEqual(run(['--oxe-only', dir]).status, 0);
    const s = run(['status', dir]);
    assert.strictEqual(s.status, 0, s.stderr + s.stdout);
    assert.match(s.stdout + s.stderr, /Próximo passo sugerido|próximo passo/i);
  });

  test('doctor fails without oxe/workflows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const d = run(['doctor', dir]);
    assert.strictEqual(d.status, 1);
  });

  test('init-oxe creates .oxe only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['init-oxe', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'STATE.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'config.json')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'global', 'LESSONS.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'global', 'MILESTONES.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'global', 'milestones')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'sessions')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'EXECUTION-RUNTIME.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'CHECKPOINTS.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'CAPABILITIES.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'INVESTIGATIONS.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'capabilities')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'investigations')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'dashboard')));
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'config.json'), 'utf8'));
    assert.strictEqual(cfg.plan_confidence_threshold, 70);
    const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.match(gi, /\.oxe\/\s*$/m);
  });

  test('install does not duplicate .oxe/ rule when .gitignore already ignores .oxe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    fs.writeFileSync(path.join(dir, '.gitignore'), '# x\n.oxe/\n', 'utf8');
    assert.strictEqual(run(['--oxe-only', dir]).status, 0);
    const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const matches = gi.match(/^\.oxe\/\s*$/gm);
    assert.strictEqual(matches ? matches.length : 0, 1);
  });

  test('--version has no banner (single line)', () => {
    const r = spawnSync(process.execPath, [CLI, '--version'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout.trim(), /^oxe-cc v[\d.]+/);
    assert.ok(!r.stdout.includes('===='), 'banner box should not appear');
  });

  test('--all-agents writes OpenCode, Gemini TOML, Codex skills, Windsurf workflows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status, fakeHome } = run(['--all-agents', '--no-init-oxe', '--no-global-cli', '-l', dir]);
    assert.strictEqual(status, 0);
    const xdg = path.join(fakeHome, '.config');
    assert.ok(fs.existsSync(path.join(xdg, 'opencode', 'commands', 'oxe-scan.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.gemini', 'commands', 'oxe.toml')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.gemini', 'commands', 'oxe', 'scan.toml')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'oxe-scan', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.codeium', 'windsurf', 'global_workflows', 'oxe-scan.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.gemini', 'antigravity', 'skills', 'oxe-scan', 'SKILL.md')));
  });

  test('--copilot-cli creates ~/.claude/commands and .oxe/workflows in project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status, fakeHome } = run(['--copilot-cli', '--no-init-oxe', '--no-global-cli', '-l', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'oxe-scan.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.copilot', 'commands', 'oxe-scan.md')));
    const skillScan = path.join(fakeHome, '.copilot', 'skills', 'oxe-scan', 'SKILL.md');
    const skillOxe = path.join(fakeHome, '.copilot', 'skills', 'oxe', 'SKILL.md');
    assert.ok(fs.existsSync(skillScan), 'Copilot CLI espera skills em ~/.copilot/skills/');
    assert.ok(fs.existsSync(skillOxe), 'entrada /oxe → skills/oxe/SKILL.md');
    const skillText = fs.readFileSync(skillScan, 'utf8');
    assert.match(skillText, /name:\s*oxe-scan/);
    assert.ok(skillText.includes('<!-- oxe-cc managed -->'));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
  });

  test('uninstall --ide-only removes CLI command dirs but keeps .oxe/workflows', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = isolatedHomeEnv(fakeHome);
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--oxe-only', dir], { cwd: REPO_ROOT, env }).status,
      0
    );
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--copilot-cli', '--no-init-oxe', '--no-global-cli', '-l', dir], {
        cwd: REPO_ROOT,
        env,
      }).status,
      0
    );
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'oxe-scan.md')));
    const u = spawnSync(process.execPath, [CLI, 'uninstall', '--ide-only', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(u.status, 0, u.stderr + u.stdout);
    assert.ok(!fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'oxe-scan.md')));
    assert.ok(!fs.existsSync(path.join(fakeHome, '.copilot', 'commands', 'oxe-scan.md')));
    assert.ok(!fs.existsSync(path.join(fakeHome, '.copilot', 'skills', 'oxe-scan', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(fakeHome, '.copilot', 'skills', 'oxe', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
  });

  test('uninstall removes nested .oxe/workflows from project', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = isolatedHomeEnv(fakeHome);
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--oxe-only', dir], { cwd: REPO_ROOT, env }).status,
      0
    );
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
    const u = spawnSync(process.execPath, [CLI, 'uninstall', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(u.status, 0, u.stderr + u.stdout);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
  });

  test('--global-cli and --no-global-cli together exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const r = run(['--global-cli', '--no-global-cli', '--oxe-only', dir]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /Não use.*global-cli/i);
  });

  test('doctor fails on invalid .oxe/config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    assert.strictEqual(run(['--oxe-only', dir]).status, 0);
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{ not: json', 'utf8');
    const d = run(['doctor', dir]);
    assert.strictEqual(d.status, 1);
    assert.match(d.stdout + d.stderr, /JSON inválido/i);
  });

  test('--global and --local together exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const r = run(['--global', '--local', '--oxe-only', dir]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /Não use --global e --local/i);
  });

  test('.oxe/config.json install.profile core skips IDE files (non-interactive)', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = isolatedHomeEnv(fakeHome, { OXE_NO_PROMPT: '1' });
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--oxe-only', dir], { cwd: REPO_ROOT, env }).status,
      0
    );
    const cfgPath = path.join(dir, '.oxe', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.install = { profile: 'core', repo_layout: 'nested' };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    const r = spawnSync(process.execPath, [CLI, '--no-init-oxe', '--no-global-cli', '-l', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(!fs.existsSync(path.join(fakeHome, '.cursor', 'commands', 'oxe-scan.md')));
  });

  test('--no-install-config ignores .oxe install.profile core', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = isolatedHomeEnv(fakeHome, { OXE_NO_PROMPT: '1' });
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--oxe-only', dir], { cwd: REPO_ROOT, env }).status,
      0
    );
    const cfgPath = path.join(dir, '.oxe', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.install = { profile: 'core', repo_layout: 'nested' };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    const r = spawnSync(
      process.execPath,
      [CLI, '--no-install-config', '--no-init-oxe', '--no-global-cli', '-l', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env }
    );
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(path.join(fakeHome, '.cursor', 'commands', 'oxe-scan.md')));
  });

  test('install subcommand is equivalent to default install', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['install', '--oxe-only', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
  });

  test('--global --cursor installs under HOME .cursor and oxe/ at repo root', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = isolatedHomeEnv(fakeHome);
    const r = spawnSync(process.execPath, [CLI, '--cursor', '--global', '--no-init-oxe', '--no-global-cli', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(path.join(fakeHome, '.cursor', 'commands', 'oxe-scan.md')));
    assert.ok(fs.existsSync(path.join(dir, 'oxe', 'workflows', 'scan.md')));
  });

  test('--ide-local --cursor installs commands under project .cursor', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(
      ['--cursor', '--ide-local', '--no-init-oxe', '--no-global-cli', '-l', dir],
      REPO_ROOT
    );
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.cursor', 'commands', 'oxe-scan.md')));
  });

  test('--ide-global and --ide-local together exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status, stderr } = run(['--cursor', '--ide-global', '--ide-local', '--no-global-cli', '-l', dir]);
    assert.strictEqual(status, 1);
    assert.match(stderr, /ide-global|ide-local|Não use/i);
  });

  test('--opencode alone installs only OpenCode paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status, fakeHome } = run(
      ['--opencode', '--no-init-oxe', '--no-global-cli', '-l', dir],
      REPO_ROOT
    );
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(fakeHome, '.config', 'opencode', 'commands', 'oxe-scan.md')));
    assert.ok(!fs.existsSync(path.join(fakeHome, '.gemini', 'commands', 'oxe.toml')));
  });

  test('--copilot installs workspace prompts and manifest without writing legacy ~/.copilot/prompts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status, fakeHome } = run(
      ['--copilot', '--no-init-oxe', '--no-global-cli', '-l', dir],
      REPO_ROOT
    );
    assert.strictEqual(status, 0);
    const inst = path.join(dir, '.github', 'copilot-instructions.md');
    const prompt = path.join(dir, '.github', 'prompts', 'oxe-scan.prompt.md');
    const manifest = path.join(dir, '.oxe', 'install', 'copilot-vscode.json');
    assert.ok(fs.existsSync(inst));
    assert.ok(fs.existsSync(prompt));
    assert.ok(fs.existsSync(manifest));
    const txt = fs.readFileSync(inst, 'utf8');
    const promptText = fs.readFileSync(prompt, 'utf8');
    const manifestJson = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.ok(txt.includes('oxe-cc:install-begin'));
    assert.ok(promptText.includes('.oxe/workflows/'));
    assert.ok(Array.isArray(manifestJson.prompt_files));
    assert.ok(manifestJson.prompt_files.includes('oxe-scan.prompt.md'));
    assert.ok(!fs.existsSync(path.join(fakeHome, '.copilot', 'prompts', 'oxe-scan.prompt.md')));
  });

  test('--gemini alone installs only Gemini TOML', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status, fakeHome } = run(
      ['--gemini', '--no-init-oxe', '--no-global-cli', '-l', dir],
      REPO_ROOT
    );
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(fakeHome, '.gemini', 'commands', 'oxe.toml')));
    assert.ok(!fs.existsSync(path.join(fakeHome, '.config', 'opencode', 'commands', 'oxe-scan.md')));
  });

  test('install --ide-local with --config-dir exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const r = spawnSync(
      process.execPath,
      [CLI, '--cursor', '--ide-local', '--config-dir', fakeHome, '--no-global-cli', '-l', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedHomeEnv(fakeHome) }
    );
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /ide-local|config-dir/i);
  });

  test('install --copilot with --config-dir exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const r = spawnSync(
      process.execPath,
      [CLI, '--copilot', '--config-dir', fakeHome, '--no-global-cli', '-l', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedHomeEnv(fakeHome) }
    );
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /copilot|config-dir|workspace/i);
  });

  test('uninstall --ide-local removes project .cursor OXE commands', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = isolatedHomeEnv(fakeHome, { OXE_NO_PROMPT: '1' });
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--cursor', '--ide-local', '--no-init-oxe', '--no-global-cli', '-l', dir], {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf8',
      }).status,
      0
    );
    const cmd = path.join(dir, '.cursor', 'commands', 'oxe-scan.md');
    assert.ok(fs.existsSync(cmd));
    const u = spawnSync(process.execPath, [CLI, 'uninstall', '--ide-local', '--ide-only', '--dir', dir], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });
    assert.strictEqual(u.status, 0, u.stderr + u.stdout);
    assert.ok(!fs.existsSync(cmd));
  });

  test('uninstall --copilot removes workspace assets and leaves legacy global until explicit clean', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = isolatedHomeEnv(fakeHome, { OXE_NO_PROMPT: '1' });

    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--copilot', '--no-init-oxe', '--no-global-cli', '-l', dir], {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf8',
      }).status,
      0
    );

    const legacyPromptsDir = path.join(fakeHome, '.copilot', 'prompts');
    fs.mkdirSync(legacyPromptsDir, { recursive: true });
    fs.writeFileSync(path.join(legacyPromptsDir, 'oxe-scan.prompt.md'), 'legacy', 'utf8');
    const legacyInstructions = path.join(fakeHome, '.copilot', 'copilot-instructions.md');
    fs.mkdirSync(path.dirname(legacyInstructions), { recursive: true });
    fs.writeFileSync(
      legacyInstructions,
      '<!-- oxe-cc:install-begin -->\nlegacy\n<!-- oxe-cc:install-end -->\n',
      'utf8'
    );

    const workspaceInstructions = path.join(dir, '.github', 'copilot-instructions.md');
    const workspacePrompt = path.join(dir, '.github', 'prompts', 'oxe-scan.prompt.md');
    const workspaceManifest = path.join(dir, '.oxe', 'install', 'copilot-vscode.json');
    assert.ok(fs.existsSync(workspaceInstructions));
    assert.ok(fs.existsSync(workspacePrompt));
    assert.ok(fs.existsSync(workspaceManifest));

    const uninstallWorkspace = spawnSync(
      process.execPath,
      [CLI, 'uninstall', '--copilot', '--ide-only', '--dir', dir],
      { cwd: REPO_ROOT, env, encoding: 'utf8' }
    );
    assert.strictEqual(uninstallWorkspace.status, 0, uninstallWorkspace.stderr + uninstallWorkspace.stdout);
    assert.ok(!fs.existsSync(workspacePrompt));
    assert.ok(!fs.existsSync(workspaceManifest));
    const strippedWorkspaceInstructions = fs.readFileSync(workspaceInstructions, 'utf8');
    assert.ok(!strippedWorkspaceInstructions.includes('oxe-cc:install-begin'));
    assert.ok(fs.existsSync(path.join(legacyPromptsDir, 'oxe-scan.prompt.md')));
    assert.match(fs.readFileSync(legacyInstructions, 'utf8'), /oxe-cc:install-begin/);

    const uninstallLegacy = spawnSync(
      process.execPath,
      [CLI, 'uninstall', '--copilot-legacy-clean', '--ide-only', '--dir', dir],
      { cwd: REPO_ROOT, env, encoding: 'utf8' }
    );
    assert.strictEqual(uninstallLegacy.status, 0, uninstallLegacy.stderr + uninstallLegacy.stdout);
    assert.ok(!fs.existsSync(path.join(legacyPromptsDir, 'oxe-scan.prompt.md')));
    assert.ok(!fs.readFileSync(legacyInstructions, 'utf8').includes('oxe-cc:install-begin'));
  });
});
