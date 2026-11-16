'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const op = require('../bin/lib/oxe-operational.cjs');
const runtime = require('../lib/runtime');
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

const dirs = [];
afterEach(() => {
  while (dirs.length) {
    try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* Windows lock */ }
  }
});

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return String(r.stdout || '').trim();
}

function writeFiles(root, map) {
  for (const [rel, content] of Object.entries(map)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

describe('OXB-C1 P2: G45 cross-card conflicts, #6 all-segments verify, G46 rate_limits, #8 plan verify move/drop', () => {
  it('#5 (G45) catches all 3 Settings conflicts (plain variant, .plain CSS, >10 nav rows vs 9) + hidden main chip, with 0 false positives on clean tests', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c1-g45-'));
    dirs.push(dir);
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@oxe.local']);
    git(dir, ['config', 'user.name', 'OXE Test']);

    writeFiles(dir, {
      'src/Settings.tsx': 'export function Settings() { return <div data-variant="plain" className="plain" />; }\n',
      'src/Settings.module.css': '.plain { border: none; }\n.card { border: 1px solid #333; }\n',
      'src/SessionHeader.tsx': 'export function SessionHeader() { return <span>main</span>; }\n',
      'tests/acceptance/oxe-130-notification.test.tsx': [
        "import { Settings } from '../../src/Settings';",
        "it('renders notification section', () => {",
        "  const el = Settings();",
        "  expect(el).toHaveAttribute('data-variant', 'plain');",
        '});',
      ].join('\n') + '\n',
      'tests/acceptance/oxe-131-send-key.test.tsx': [
        "import fs from 'node:fs';",
        "import { Settings } from '../../src/Settings';",
        "it('keeps plain rule in Settings.module.css', () => {",
        "  const css = fs.readFileSync('src/Settings.module.css', 'utf8');",
        "  expect(css).toMatch(/\\.plain\\b/);",
        '});',
      ].join('\n') + '\n',
      'tests/acceptance/brd-06-settings.test.tsx': [
        "import { Settings } from '../../src/Settings';",
        "it('CA-3 renders > 10 nav rows', () => {",
        '  const navRows = Settings();',
        '  expect(navRows.length).toBeGreaterThan(10);',
        '});',
      ].join('\n') + '\n',
      'e2e/session-location.spec.ts': [
        '// Mounts SessionHeader in app shell',
        "test('shows branch chip', async ({ page }) => {",
        "  await expect(page.locator('[data-testid=\"SessionHeader\"]')).toContainText('main');",
        '});',
      ].join('\n') + '\n',
      'tests/acceptance/clean-settings.test.tsx': [
        "import { Settings } from '../../src/Settings';",
        "it('unrelated clean test', () => {",
        "  expect(Settings()).toHaveAttribute('data-variant', 'card');",
        '});',
      ].join('\n') + '\n',
      'tests/acceptance/brd-23-settings.test.tsx': [
        "import { Settings } from '../../src/Settings';",
        "it('BRD-23 consolidates 9 sections without plain', () => {",
        '  const navSections = Settings();',
        '  expect(navSections).toHaveLength(9);',
        "  expect(navSections).not.toHaveAttribute('data-variant', 'plain');",
        '});',
      ].join('\n') + '\n',
      '.oxe/SPEC.md': [
        '# SPEC',
        '| ID | Critério | Verificação |',
        '|---|---|---|',
        '| A23 | BRD-23 Settings: remove `data-variant="plain"` e `.plain`, consolida em 9 seções | vitest |',
        "| A14 | BRD-14 SessionHeader: esconde o chip 'main' no cabeçalho | playwright |",
      ].join('\n') + '\n',
      '.oxe/PLAN.md': '# PLAN\n\n### T36 — BRD-23 Settings\n### T33 — BRD-14 SessionHeader\n',
    });
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'base']);

    writeFiles(dir, {
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        acceptance_tests: [
          {
            criterion: 'A23',
            task: 'T36',
            files: ['tests/acceptance/brd-23-settings.test.tsx'],
            command: 'node -e "process.exit(0)"',
            proves: ['BRD-23 consolidates 9 sections without plain'],
          },
        ],
        tasks: [
          {
            id: 'T36',
            title: 'BRD-23 Settings: remove plain e consolida em 9 seções',
            wave: 1,
            acceptance: ['A23'],
            files: ['src/Settings.tsx', 'src/Settings.module.css'],
            notes: 'Remove variante `plain` e classe `.plain`; consolida em 9 seções de navegação.',
            verify: { commands: ['node -e "process.exit(0)"'] },
          },
          {
            id: 'T33',
            title: "BRD-14 SessionHeader: esconde 'main'",
            wave: 1,
            acceptance: ['A14'],
            files: ['src/SessionHeader.tsx'],
            notes: "Esconde o chip 'main' quando na branch principal.",
            verify: { commands: ['node -e "process.exit(0)"'] },
          },
        ],
      }, null, 2),
    });

    const lint = op.runtimePlanLint(dir, null, { precheckTests: false });
    const g45 = lint.warnings.filter((w) => w.includes('[G45]'));
    assert.ok(g45.some((w) => w.includes('oxe-130-notification.test.tsx:4') && w.includes('plain')), `expected oxe-130 conflict, got: ${g45.join('\n')}`);
    assert.ok(g45.some((w) => w.includes('oxe-131-send-key.test.tsx:5') && w.includes('.plain')), `expected oxe-131 conflict, got: ${g45.join('\n')}`);
    assert.ok(g45.some((w) => w.includes('brd-06-settings.test.tsx:4') && w.includes('toBeGreaterThan(10)')), `expected brd-06 count conflict, got: ${g45.join('\n')}`);
    assert.ok(g45.some((w) => w.includes('e2e/session-location.spec.ts:3') && w.includes('main')), `expected session-location main chip conflict, got: ${g45.join('\n')}`);
    assert.ok(!g45.some((w) => w.includes('clean-settings.test.tsx')), 'clean test must not false-positive');
  });

  it('#6 commit-task runs all && verify segments by default (listing every red segment at once), --fail-fast stops at first, and Scheduler supports allSegments', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c1-segs-'));
    dirs.push(dir);
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@oxe.local']);
    git(dir, ['config', 'user.name', 'OXE Test']);

    writeFiles(dir, {
      'src/a.js': 'module.exports = 1;\n',
      '.oxe/PLAN.md': '# PLAN\n\n### T34 — Multi segment\n',
    });
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'base']);

    const marker3 = path.join(dir, '.oxe', 'seg3-ran.txt').replace(/\\/g, '/');
    writeFiles(dir, {
      'src/a.js': 'module.exports = 2;\n',
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 2,
        phase: 'F6',
        tasks: [
          {
            id: 'T34',
            title: 'Multi segment',
            wave: 1,
            files: ['src/a.js'],
            verify: {
              commands: [
                `node -e "console.error('ERR_SEG_ONE'); process.exit(1)" && node -e "process.exit(0)" && node -e "require('fs').writeFileSync('${marker3}', 'ran'); console.error('ERR_SEG_THREE'); process.exit(2)"`,
              ],
            },
          },
        ],
      }, null, 2),
    });

    // Default commit-task: runs ALL 3 segments and reports BOTH [1/3] and [3/3]
    assert.throws(
      () => op.runtimeCommitTask(dir, null, { task: 'T34', by: 'coord' }),
      (err) => {
        assert.match(err.message, /falhou em 2\/3 segmentos/);
        assert.match(err.message, /\[1\/3\].*ERR_SEG_ONE/s);
        assert.match(err.message, /\[3\/3\].*ERR_SEG_THREE/s);
        return true;
      }
    );
    assert.equal(fs.existsSync(marker3), true, 'segment 3 must execute when allSegments is default');

    // --fail-fast stops at [1/3] without running segment 3
    fs.rmSync(marker3, { force: true });
    const ffCli = spawnSync(process.execPath, [CLI, 'runtime', 'commit-task', 'T34', '--by', 'coord', '--fail-fast', '--dir', dir], { encoding: 'utf8', windowsHide: true });
    assert.notEqual(ffCli.status, 0);
    assert.equal(fs.existsSync(marker3), false, '--fail-fast must stop before segment 3');

    // Scheduler describeVerifyFailure with multiple failed segments lists all of them
    const desc = runtime.describeVerifyFailure(
      'seg1 && seg2 && seg3',
      { check_id: 's1', status: 'failed', exit_code: 1, stdout: 'out1', stderr: 'err1', duration_ms: 10 },
      [],
      { index: 1, total: 3, command: 'seg1' },
      [
        { index: 1, total: 3, command: 'seg1', status: 'failed', check: { check_id: 's1', status: 'failed', exit_code: 1, stdout: 'out1', stderr: 'err1', duration_ms: 10 } },
        { index: 2, total: 3, command: 'seg2', status: 'passed', check: { check_id: 's2', status: 'passed', exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 10 } },
        { index: 3, total: 3, command: 'seg3', status: 'failed', check: { check_id: 's3', status: 'failed', exit_code: 2, stdout: '', stderr: 'err3', duration_ms: 10 } },
      ]
    );
    assert.match(desc, /2 of 3 verify segments failed/);
    assert.match(desc, /Failing segment \[1\/3\]: seg1/);
    assert.match(desc, /Failing segment \[3\/3\]: seg3/);
  });

  it('#7 (G46) lint.rate_limits warns on loop volume > max_per_min (250 > 120) and unmocked requires_approval tools', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c1-g46-'));
    dirs.push(dir);
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@oxe.local']);
    git(dir, ['config', 'user.name', 'OXE Test']);

    writeFiles(dir, {
      'src/query.ts': 'export async function run() {}\n',
      'tests/acceptance/a12-query.test.ts': [
        "import { run } from '../../src/query';",
        "it('A12 heavy volume and unmocked execute', async () => {",
        '  await Promise.all(Array.from({ length: 250 }, (_, i) => callTool("oxequery_read", { i })));',
        '  await callTool("oxequery_execute", { sql: "DELETE FROM t" });',
        '});',
      ].join('\n') + '\n',
      'tests/acceptance/a13-clean.test.ts': [
        "import { vi } from 'vitest';",
        "it('A13 mocked and within budget', async () => {",
        '  const oxequery_execute = vi.fn().mockResolvedValue({ ok: true });',
        '  await Promise.all(Array.from({ length: 20 }, () => oxequery_read()));',
        '  await oxequery_execute({ autoApprove: true });',
        '});',
      ].join('\n') + '\n',
      '.oxe/config.json': JSON.stringify({
        lint: {
          rate_limits: [
            { tool: 'oxequery_read', max_per_min: 120 },
            { tool: 'oxequery_execute', requires_approval: true },
          ],
        },
      }, null, 2),
      '.oxe/PLAN.md': '# PLAN\n\n### T12 — Query\n',
    });
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'base']);

    writeFiles(dir, {
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F1',
        acceptance_tests: [
          {
            criterion: 'A12',
            task: 'T12',
            files: ['tests/acceptance/a12-query.test.ts'],
            command: 'node -e "process.exit(0)"',
            proves: ['A12 heavy volume and unmocked execute'],
          },
          {
            criterion: 'A13',
            task: 'T12',
            files: ['tests/acceptance/a13-clean.test.ts'],
            command: 'node -e "process.exit(0)"',
            proves: ['A13 mocked and within budget'],
          },
        ],
        tasks: [
          {
            id: 'T12',
            title: 'Query',
            wave: 1,
            acceptance: ['A12', 'A13'],
            files: ['src/query.ts'],
            verify: { commands: ['node -e "process.exit(0)"'] },
          },
        ],
      }, null, 2),
    });

    const lint = op.runtimePlanLint(dir, null, { precheckTests: false });
    const g46 = lint.warnings.filter((w) => w.includes('[G46]'));
    assert.equal(g46.length, 2, `expected 2 G46 warnings, got: ${g46.join('\n')}`);
    assert.ok(g46.some((w) => w.includes('oxequery_read') && w.includes('250') && w.includes('120/min')));
    assert.ok(g46.some((w) => w.includes('oxequery_execute') && w.includes('requires_approval')));
    assert.ok(!g46.some((w) => w.includes('a13-clean.test.ts')));
  });

  it('#8 plan verify move (--to T<m> and --to OXE-card with CR) and plan verify drop update PLAN.json, changes.ndjson and events', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c1-vfyedit-'));
    dirs.push(dir);
    writeFiles(dir, {
      '.oxe/PLAN.md': '# PLAN\n',
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 2,
        phase: 'F6',
        tasks: [
          {
            id: 'T27',
            title: 'Header',
            wave: 1,
            files: ['src/Header.tsx'],
            verify: {
              commands: [
                'npx vitest run tests/header.test.ts tests/later.test.ts && npx playwright test e2e/session-location.spec.ts',
              ],
            },
          },
          {
            id: 'T30',
            title: 'Later owner',
            wave: 2,
            files: ['src/Later.tsx'],
            verify: { commands: ['npx vitest run tests/own.test.ts'] },
          },
        ],
      }, null, 2),
    });

    // 1. Move test argument `tests/later.test.ts` from T27 -> T30
    const mvTask = spawnSync(process.execPath, [
      CLI, 'plan', 'verify', 'move', 'T27', 'tests/later.test.ts',
      '--to', 'T30', '--cr', 'CR-F6-10', '--by', 'coord', '--reason', 'pertence à T30', '--dir', dir,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(mvTask.status, 0, mvTask.stderr + mvTask.stdout);

    // 2. Move whole playwright segment from T27 -> ALM card OXE-292
    const mvCard = spawnSync(process.execPath, [
      CLI, 'plan', 'verify', 'move', 'T27', 'e2e/session-location.spec.ts',
      '--to', 'OXE-292', '--cr', 'CR-F6-11', '--by', 'coord', '--dir', dir,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(mvCard.status, 0, mvCard.stderr + mvCard.stdout);

    // 3. Drop obsolete test from T30
    const drop = spawnSync(process.execPath, [
      CLI, 'plan', 'verify', 'drop', 'T30', 'tests/own.test.ts',
      '--by', 'coord', '--reason', 'substituído pela suíte de T30', '--dir', dir,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(drop.status, 0, drop.stderr + drop.stdout);

    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const t27 = plan.tasks.find((t) => t.id === 'T27');
    const t30 = plan.tasks.find((t) => t.id === 'T30');
    assert.deepEqual(t27.verify.commands, ['npx vitest run tests/header.test.ts']);
    assert.deepEqual(t30.verify.commands, ['npx vitest run tests/later.test.ts']);

    const changesRaw = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(changesRaw.length, 3);
    assert.equal(changesRaw[0].kind, 'verify_move');
    assert.equal(changesRaw[0].to, 'T30');
    assert.equal(changesRaw[1].kind, 'verify_move');
    assert.equal(changesRaw[1].to, 'OXE-292');
    assert.equal(changesRaw[1].to_kind, 'card');
    assert.equal(changesRaw[2].kind, 'verify_drop');
  });
});
