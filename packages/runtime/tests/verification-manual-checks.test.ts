import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  compile,
  runCheck,
  verifyRun,
  summarizeSuite,
  extractCommandFromHowToVerify,
} from '../src/verification/verification-compiler';
import type { AcceptanceCheck, CheckResult } from '../src/verification/verification-compiler';
import { buildManifest } from '../src/verification/verification-manifest';
import { MergeGateEvaluator } from '../src/delivery/promotion-pipeline';
import type { RunResult } from '../src/scheduler/scheduler';

// Regressão do e2e "linkly": prosa de "Como verificar" era executada como comando shell e
// `package.json` (um path entre crases) virava `&& package.json`.

const spec = {
  objective: 'linkly',
  criteria: [
    { id: 'A1', criterion: 'botão visível', howToVerify: 'Abrir o app e conferir visualmente que o botão aparece' },
    { id: 'A2', criterion: 'POST cria link', howToVerify: '`npm test` — `test/api.test.js` caso "POST /links cria link"' },
    { id: 'A3', criterion: 'scripts.test', howToVerify: 'Inspeção de `package.json` (`scripts.test`)' },
    { id: 'A4', criterion: 'oculto', howToVerify: '# pendente' },
  ],
};
const emptyPlan = { tasks: [] as Array<{ id: string; verifyCommand: string | null; aceite: string[] }> };

function manualResult(id: string, ref: string): CheckResult {
  return {
    check_id: id,
    acceptance_ref: ref,
    status: 'skip',
    stdout: '',
    stderr: '',
    exit_code: null,
    duration_ms: 0,
    error: null,
    skip_reason: 'needs_structured_check',
  };
}

function passResult(id: string): CheckResult {
  return { check_id: id, acceptance_ref: null, status: 'pass', stdout: 'ok', stderr: '', exit_code: 0, duration_ms: 1, error: null };
}

describe('verification — critérios manuais nunca viram comando', () => {
  test('extractCommandFromHowToVerify: só spans que parecem comando', () => {
    assert.equal(extractCommandFromHowToVerify('Abrir o app e conferir visualmente'), null);
    assert.equal(extractCommandFromHowToVerify('`npm test` — `test/api.test.js` caso X'), 'npm test');
    assert.equal(extractCommandFromHowToVerify('Inspeção de `package.json` (`scripts.test`)'), null);
    assert.equal(extractCommandFromHowToVerify('npm test'), 'npm test');
    assert.equal(
      extractCommandFromHowToVerify('`node --test test/a.test.js` e `npm run lint`'),
      'node --test test/a.test.js && npm run lint'
    );
    assert.equal(extractCommandFromHowToVerify('# manual'), null);
    assert.equal(extractCommandFromHowToVerify(''), null);
  });

  test('compile: prosa e paths viram checks manual com command null', () => {
    const suite = compile(spec, emptyPlan);
    const byId = Object.fromEntries(suite.checks.map((c) => [c.id, c]));
    assert.equal(byId['check-a1'].type, 'manual');
    assert.equal(byId['check-a1'].command, null);
    assert.equal(byId['check-a2'].command, 'npm test');
    assert.equal(byId['check-a2'].type, 'unit');
    assert.equal(byId['check-a3'].type, 'manual');
    assert.equal(byId['check-a3'].command, null);
    assert.equal(byId['check-a4'].command, null);
  });

  test('compile: a tarefa vinculada continua a mandar no comando', () => {
    const suite = compile(spec, { tasks: [{ id: 'T1', verifyCommand: 'node --test test/ui.test.js', aceite: ['A1'] }] });
    const a1 = suite.checks.find((c) => c.id === 'check-a1')!;
    assert.equal(a1.command, 'node --test test/ui.test.js');
    assert.equal(a1.type, 'unit');
  });

  test('runCheck: check manual → skip com needs_structured_check', async () => {
    const check: AcceptanceCheck = {
      id: 'check-a1',
      type: 'manual',
      command: null,
      evidence_type_expected: 'stdout',
      acceptance_ref: 'A1',
      description: 'manual',
    };
    const result = await runCheck(check, os.tmpdir());
    assert.equal(result.status, 'skip');
    assert.equal(result.skip_reason, 'needs_structured_check');
  });

  test('verifyRun: critérios manuais deixam a run partial com gaps nomeados', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-manual-'));
    try {
      const suite = compile({ objective: 'x', criteria: [spec.criteria[0]] }, emptyPlan);
      const result = await verifyRun({ projectRoot: tmp, runId: 'run-manual', workItemId: 'run', cwd: tmp, suite });
      assert.equal(result.status, 'partial');
      assert.equal(result.gaps.length, 1);
      assert.match(result.gaps[0], /A1/);
      assert.equal(result.manifest?.summary.all_passed, false);
      assert.equal(result.manifest?.summary.manual, 1);
      assert.equal(summarizeSuite(result.check_results).manual, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('buildManifest: skip manual não é all_passed; skip deliberado continua passando', () => {
    const withManual = buildManifest('r', [passResult('c1'), manualResult('c2', 'A2')]);
    assert.equal(withManual.summary.all_passed, false);
    assert.equal(withManual.summary.manual, 1);

    const plainSkip = buildManifest('r', [passResult('c1'), { ...manualResult('c2', 'A2'), skip_reason: 'no_command' }]);
    assert.equal(plainSkip.summary.all_passed, true);
    assert.equal(plainSkip.summary.manual, 0);
  });

  test('MergeGateEvaluator bloqueia promoção quando há critério manual', () => {
    const manifest = buildManifest('r', [passResult('c1'), manualResult('c2', 'A2')]);
    const runResult: RunResult = { run_id: 'r', status: 'completed', completed: ['T1'], failed: [], blocked: [] };
    const report = new MergeGateEvaluator().evaluate(runResult, manifest, null, [], null, 0);
    assert.equal(report.verdict, 'blocked');
    assert.ok(report.reasons.some((r) => /without executable check/.test(r)), report.reasons.join(' | '));
  });
});
