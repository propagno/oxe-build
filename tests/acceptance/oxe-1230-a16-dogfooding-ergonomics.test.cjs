'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin/oxe-cc.js');

describe('A16 — Ergonomia do dogfooding: PRD por sessão, tabela compacta, [G30] agrupado, ci-parity scorecard e workflow new (OXB-230-16)', () => {
  it('OXB-230-16: oxe-prd.cjs parses Critérios from compact 4-column PRD tables and preserves 7-column canonical format', () => {
    const prdMod = require(path.join(REPO_ROOT, 'bin/lib/oxe-prd.cjs'));
    const compactMd = [
      '# PRD — Demo',
      '',
      '## Histórias de Usuário',
      '',
      '| ID | História | Critérios | Fase |',
      '|----|----------|-----------|------|',
      '| US-1 | Como dev, quero X para Y | A1, A2 | F1 |',
      '| US-2 | Como dev, quero Z | A3 | F2 |',
    ].join('\n');
    const parsed = prdMod.parsePrd(compactMd);
    assert.equal(parsed.stories.length, 2);
    assert.deepEqual(parsed.stories[0].criteria, ['A1', 'A2']);
    assert.deepEqual(parsed.stories[1].criteria, ['A3']);

    const lint = prdMod.lintPrd(parsed, ['A1', 'A2', 'A3']);
    assert.equal(lint.warnings.length, 0, JSON.stringify(lint.warnings));
  });

  it('OXB-230-16: prdPathFor resolves active session PRD.md for alm push / suggestNextStep before root PRD.md, and plan lint oxe-suite-impact groups > 5 [G30] warnings', () => {
    const op = require(path.join(REPO_ROOT, 'bin/lib/oxe-operational.cjs'));
    const suiteImpact = require(path.join(REPO_ROOT, 'bin/lib/oxe-suite-impact.cjs'));
    const health = require(path.join(REPO_ROOT, 'bin/lib/oxe-project-health.cjs'));
    assert.equal(typeof health.suggestNextStep, 'function');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a16-prd-'));
    try {
      fs.mkdirSync(path.join(dir, '.oxe', 'sessions', 's002-new'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# OXE\n\n- **active_session:** `sessions/s002-new`\n');
      fs.writeFileSync(path.join(dir, '.oxe', 'PRD.md'), '# Old Root PRD\n');
      const sessPrd = path.join(dir, '.oxe', 'sessions', 's002-new', 'PRD.md');
      fs.writeFileSync(sessPrd, '# Session PRD\n');

      const resolved = op.prdPathFor(dir, null);
      assert.equal(path.resolve(resolved), path.resolve(sessPrd));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // [G30] grouping when > 5 warning suites hit the same file
    const manySuites = Array.from({ length: 12 }, (_, i) => ({ test: `tests/t${i}.test.cjs`, level: 'warn', names: [] }));
    const res = suiteImpact.messages([{ task: 'T1', file: 'bin/lib/big.cjs', suites: manySuites, data: [] }]);
    assert.ok(res.warnings.length <= 5, `expected grouped [G30] warnings (<= 5), got ${res.warnings.length}`);
    assert.ok(res.warnings.some((w) => /12/.test(w) && /\[G30\]/.test(w)), JSON.stringify(res.warnings));
  });

  it('OXB-230-16: oxe-ci-parity.cjs warns on major.minor drift in release-evidence/scorecard-report.json and scaffoldWorkflow / oxe-cc workflow new creates valid workflow', () => {
    const ciParity = require(path.join(REPO_ROOT, 'bin/lib/oxe-ci-parity.cjs'));
    const wfMod = require(path.join(REPO_ROOT, 'bin/lib/oxe-workflows.cjs'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a16-wf-'));
    try {
      // 1. Scorecard evidence parity drift detection
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.23.0', engines: { node: '>=18.0.0' } }));
      fs.mkdirSync(path.join(dir, 'release-evidence'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'release-evidence', 'scorecard-report.json'), JSON.stringify({ oxe_version: '1.22.0', summary: {} }));
      const scCheck = ciParity.checkScorecardEvidenceParity(dir);
      assert.equal(scCheck.drifted, true);
      assert.ok(scCheck.warnings.some((w) => /1\.22\.0/.test(w) && /1\.23\.0/.test(w)));

      // 2. scaffoldWorkflow + CLI `oxe-cc workflow new`
      fs.mkdirSync(path.join(dir, 'oxe', 'workflows', 'references'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.github', 'prompts'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'commands', 'oxe'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'oxe', 'workflows', 'size-budget.json'), JSON.stringify({ schema_version: 1, limits: { s: 200, m: 400, l: 650 }, files: {} }, null, 2));
      fs.writeFileSync(path.join(dir, 'oxe', 'workflows', 'references', 'workflow-runtime-contracts.json'), JSON.stringify({ contract_version: '2.0.0', workflows: {} }, null, 2));

      const cliRes = spawnSync(process.execPath, [CLI, 'workflow', 'new', 'audit-demo', '--dir', dir, '--json'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, OXE_NO_BANNER: '1' },
      });
      assert.equal(cliRes.status, 0, cliRes.stderr + cliRes.stdout);
      const out = JSON.parse(cliRes.stdout.trim());
      assert.equal(out.ok, true);
      assert.ok(fs.existsSync(path.join(dir, 'oxe', 'workflows', 'audit-demo.md')));
      assert.ok(fs.existsSync(path.join(dir, '.github', 'prompts', 'oxe-audit-demo.prompt.md')));
      assert.ok(fs.existsSync(path.join(dir, 'commands', 'oxe', 'audit-demo.md')));

      const shape = wfMod.validateWorkflowShapes(path.join(dir, 'oxe', 'workflows'));
      assert.equal(shape.warnings.length, 0, JSON.stringify(shape.warnings));

      const budget = JSON.parse(fs.readFileSync(path.join(dir, 'oxe', 'workflows', 'size-budget.json'), 'utf8'));
      assert.equal(budget.files['workflows/audit-demo.md'], 's');

      const contracts = JSON.parse(fs.readFileSync(path.join(dir, 'oxe', 'workflows', 'references', 'workflow-runtime-contracts.json'), 'utf8'));
      assert.ok(contracts.workflows['audit-demo']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
