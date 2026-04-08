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

describe('oxe-cc CLI edge', () => {
  test('install --help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /oxe-cc|Instalação/i);
  });

  test('uninstall --help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('update --dry-run exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /simulação|npx/i);
  });

  test('update --dry-run forwards install flags', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--dry-run', '--cursor', '--ide-local', '--global-cli'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout + r.stderr, /--cursor/);
    assert.match(r.stdout + r.stderr, /--ide-local/);
    assert.match(r.stdout + r.stderr, /--global-cli/);
  });

  test('capabilities help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'capabilities', '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('doctor missing dir exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'doctor', path.join(os.tmpdir(), 'oxe-nope-xyz')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('status missing dir exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'status', path.join(os.tmpdir(), 'oxe-nope2-xyz')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('status --json prints valid JSON with nextStep', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-json-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    const maps = [
      'OVERVIEW.md',
      'STACK.md',
      'STRUCTURE.md',
      'TESTING.md',
      'INTEGRATIONS.md',
      'CONVENTIONS.md',
      'CONCERNS.md',
    ];
    for (const f of maps) {
      fs.writeFileSync(path.join(codebase, f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`scan_complete`\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    const j = JSON.parse(line);
    assert.strictEqual(j.oxeStatusSchema, 2);
    assert.ok(typeof j.healthStatus === 'string');
    assert.ok(typeof j.nextStep === 'string');
    assert.ok(Array.isArray(j.artifacts));
    assert.ok(j.diagnostics && typeof j.diagnostics === 'object');
    assert.ok(Array.isArray(j.diagnostics.planWarnings));
    assert.ok(j.staleCompact && typeof j.staleCompact.stale === 'boolean');
  });

  test('status warns when PLAN.md misses autoavaliação and suggests replan on low confidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-plan-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    for (const f of [
      'OVERVIEW.md',
      'STACK.md',
      'STRUCTURE.md',
      'TESTING.md',
      'INTEGRATIONS.md',
      'CONVENTIONS.md',
      'CONCERNS.md',
    ]) {
      fs.writeFileSync(path.join(codebase, f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n',
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '## Critérios de aceite\n\n| ID | Critério | Como verificar |\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '## Tarefas\n\n### T1 — Demo\n- **Aceite vinculado:** A1\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j.healthStatus, 'warning');
    assert.ok(j.diagnostics.planWarnings.some((x) => /Autoavaliação do Plano/i.test(x)));

    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 60%\n- **Base da confiança:**\n  - Completude dos requisitos: 20/25\n  - Dependências conhecidas: 12/15\n  - Risco técnico: 8/20\n  - Impacto no código existente: 10/15\n  - Clareza da validação / testes: 7/15\n  - Lacunas externas / decisões pendentes: 3/10\n- **Principais incertezas:** integração\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n## Tarefas\n\n### T1 — Demo\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    const r2 = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r2.status, 0, r2.stderr || r2.stdout);
    const j2 = JSON.parse(r2.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j2.nextStep, 'plan');
    assert.strictEqual(j2.planSelfEvaluation.confidence, 60);
    assert.ok(j2.diagnostics.planWarnings.some((x) => /abaixo do limiar executável/i.test(x)));
  });

  test('status --json --hints includes hints array', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-hints-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    for (const f of [
      'OVERVIEW.md',
      'STACK.md',
      'STRUCTURE.md',
      'TESTING.md',
      'INTEGRATIONS.md',
      'CONVENTIONS.md',
      'CONCERNS.md',
    ]) {
      fs.writeFileSync(path.join(codebase, f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'config.json'),
      JSON.stringify({ scan_max_age_days: 1, compact_max_age_days: 1 }),
      'utf8'
    );
    const old = new Date();
    old.setDate(old.getDate() - 9);
    const iso = old.toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      `## Fase atual\n\n\`scan_complete\`\n\n## Último scan\n\n**Data:** ${iso}\n\n## Último compact (codebase + RESUME)\n\n- **Data:** ${iso}\n`,
      'utf8'
    );
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--hints', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    const j = JSON.parse(line);
    assert.ok(Array.isArray(j.hints));
    assert.ok(j.hints.length >= 1);
    assert.ok(j.hints.some((/** @type {string} */ x) => /oxe-scan|oxe-compact/i.test(x)));
  });

  test('init-oxe exits 1 when target path does not exist without dry-run', () => {
    const missing = path.join(os.tmpdir(), `oxe-init-miss-${Date.now()}`);
    assert.ok(!fs.existsSync(missing));
    const r = spawnSync(process.execPath, [CLI, 'init-oxe', missing], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /não encontrado/i);
  });

  test('init-oxe --dry-run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-init-'));
    const r = spawnSync(process.execPath, [CLI, 'init-oxe', '--dry-run', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('--config-dir with --all-agents exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cd-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const r = spawnSync(
      process.execPath,
      [CLI, '--all-agents', '--config-dir', fakeHome, '--oxe-only', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedHomeEnv(fakeHome) }
    );
    assert.strictEqual(r.status, 1);
  });

  test('uninstall --ide-local with --config-dir exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cd2-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h2-'));
    const r = spawnSync(
      process.execPath,
      [CLI, 'uninstall', '--ide-local', '--config-dir', fakeHome, '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedHomeEnv(fakeHome) }
    );
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /config-dir|ide-local/i);
  });

  test('uninstall unknown flag exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--nope'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('uninstall --global-cli calls npm uninstall -g', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-uninst-g-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-hg-'));
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-npm-g-'));
    const marker = path.join(fakeBin, 'npm-global-uninstall.txt');
    const npmCli = path.join(fakeBin, 'npm-cli.js');
    fs.writeFileSync(
      npmCli,
      `'use strict';\nconst fs = require('fs');\nconst path = require('path');\nif (process.argv[2] === 'uninstall' && process.argv[3] === '-g') { fs.writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '), 'utf8'); process.exit(0); }\nif (process.argv[2] === 'root' && process.argv[3] === '-g') { console.log(path.join(process.cwd(), 'fake-global-root')); process.exit(0); }\nprocess.exit(0);\n`,
      'utf8'
    );
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(fakeBin, 'npm.cmd'), `@node "${npmCli.replace(/\\/g, '\\\\')}" %*\r\n`, 'utf8');
    } else {
      const npmBin = path.join(fakeBin, 'npm');
      fs.writeFileSync(npmBin, `#!/usr/bin/env node\nrequire(${JSON.stringify(npmCli.replace(/\\/g, '\\\\'))});\n`, 'utf8');
      fs.chmodSync(npmBin, 0o755);
    }
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--global-cli', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...isolatedHomeEnv(fakeHome), PATH: fakeBin + path.delimiter + process.env.PATH },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(marker), 'npm uninstall -g deveria ter sido chamado');
    assert.match(fs.readFileSync(marker, 'utf8'), /uninstall -g oxe-cc/);
  });

  test('update unknown flag exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--nope'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('update --check --dry-run exits 1 (conflito)', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--check', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /inválid|check|dry-run/i);
  });

  test('update --check --if-newer exits 1 (conflito)', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--check', '--if-newer'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('update --check com OXE_UPDATE_SKIP_REGISTRY sai 2', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_UPDATE_SKIP_REGISTRY: '1' },
    });
    assert.strictEqual(r.status, 2);
  });

  test('update --if-newer com OXE_UPDATE_SKIP_REGISTRY sai 2', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-upd-skip-'));
    const r = spawnSync(process.execPath, [CLI, 'update', '--if-newer', '--dir', proj], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_UPDATE_SKIP_REGISTRY: '1' },
    });
    assert.strictEqual(r.status, 2);
  });

  test('update --if-newer sai 0 sem npx quando npm latest é mais antigo', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-upd-if-'));
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-npm-cli-'));
    const body = `'use strict';
const v = process.env.OXE_TEST_FAKE_NPM_VERSION || '0.0.1';
if (process.argv.includes('view')) { console.log(v); process.exit(0); }
process.exit(1);
`;
    const npmCli = path.join(fakeBin, 'npm-cli.js');
    fs.writeFileSync(npmCli, body, 'utf8');
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(fakeBin, 'npm.cmd'), `@node "${npmCli.replace(/\\/g, '\\\\')}" %*\r\n`, 'utf8');
    } else {
      const npmBin = path.join(fakeBin, 'npm');
      fs.writeFileSync(npmBin, `#!/usr/bin/env node\n${body}`, 'utf8');
      fs.chmodSync(npmBin, 0o755);
    }
    const pathEnv = fakeBin + path.delimiter + process.env.PATH;
    const r = spawnSync(process.execPath, [CLI, 'update', '--if-newer', '--dir', proj], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        OXE_NO_BANNER: '1',
        PATH: pathEnv,
        OXE_TEST_FAKE_NPM_VERSION: '0.0.1',
      },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /Nenhuma versão mais nova|npm latest/i);
  });

  test('install --dry-run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dr-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const r = spawnSync(process.execPath, [CLI, '--dry-run', '--oxe-only', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: isolatedHomeEnv(fakeHome),
    });
    assert.strictEqual(r.status, 0);
  });

  test('capabilities install/list/update/remove manage local capability catalog', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cap-'));
    let r = spawnSync(process.execPath, [CLI, 'capabilities', 'install', 'sample-http', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: isolatedHomeEnv(fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cap-home-'))),
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'capabilities', 'sample-http', 'CAPABILITY.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'CAPABILITIES.md')));
    const indexText = fs.readFileSync(path.join(dir, '.oxe', 'CAPABILITIES.md'), 'utf8');
    assert.match(indexText, /sample-http/);

    r = spawnSync(process.execPath, [CLI, 'capabilities', 'list', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout + r.stderr, /sample-http/);

    r = spawnSync(process.execPath, [CLI, 'capabilities', 'update', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);

    r = spawnSync(process.execPath, [CLI, 'capabilities', 'remove', 'sample-http', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'capabilities', 'sample-http')));
  });
});
