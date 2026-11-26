'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const signal = require('../bin/lib/oxe-signal.cjs');
const questions = require('../bin/lib/oxe-questions.cjs');
const policyRules = require('../bin/lib/oxe-policy-rules.cjs');
const findings = require('../bin/lib/oxe-findings.cjs');
const verdicts = require('../bin/lib/oxe-verdicts.cjs');
const phaseExtras = require('../bin/lib/oxe-phase-extras.cjs');
const scorecard = require('../bin/lib/oxe-scorecard.cjs');
const unsafe = require('../bin/lib/oxe-unsafe-commands.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix = 'oxe-r13-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function initRepo(prefix = 'oxe-r13-git-') {
  const d = tmpDir(prefix);
  spawnSync('git', ['init', '-q'], { cwd: d, encoding: 'utf8', windowsHide: true });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: d, encoding: 'utf8', windowsHide: true });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: d, encoding: 'utf8', windowsHide: true });
  return d;
}

describe('Round 13 hardening: signal, questions, policy-rules, findings, verdicts, phase-extras, scorecard, unsafe-commands', () => {
  it('oxe-signal: criteriaFromFiles reads task.acceptance and {path} objects; parseReport handles dotted subphases and fenced blocks', () => {
    const md = [
      '- **HML-F2.10-3** [spec-gap] (A12.1.2, G4) Botão oculto em `src/ui/btn.tsx`',
      '  Detalhe com exemplo:',
      '  ```md',
      '  - **HML-F99-1** [defect] (A99) Dentro do bloco cercado não abre novo achado',
      '  ### Também não corta no heading dentro do fence',
      '  ```',
      '  Linha final do achado real.',
    ].join('\n');
    const parsed = signal.parseReport(md);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'HML-F2.10-3');
    assert.equal(parsed[0].phase, 'F2.10');
    assert.equal(parsed[0].class, 'spec_gap');
    assert.deepEqual(parsed[0].criteria, ['A12.1.2', 'G4']);
    assert.match(parsed[0].body, /Linha final do achado real/);

    const traced = signal.criteriaFromFiles(
      {
        tasks: [
          { id: 'T1', files: [{ path: './src\\ui\\btn.tsx' }], acceptance: ['A12.1'], superseded: false },
          { id: 'T2', files: ['src/ui/btn.tsx'], acceptance: ['A99'], superseded: true },
        ],
      },
      ['src/ui/btn.tsx'],
    );
    assert.deepEqual(traced, { criteria: ['A12.1'], tasks: ['T1'] });
  });

  it('oxe-questions: empty-term questions do not false-match decisions, short options require word boundaries, and blank defaults wait', () => {
    const ds = [
      { id: 'DEC-1', status: 'active', title: 'Tipo de código no fluxo', text: 'Manter tipo principal e código interno para autenticação.' },
    ];
    // Stop-word-only question has 0 significant terms -> must not match DEC-1 via Math.min(2, 0) === 0
    assert.equal(questions.fromDecisions({ question: 'o que é?', options: ['tipo', 'outro'] }, ds), null);
    // Short option "ip" or "go" must not match inside "tipo" or "código"
    assert.equal(questions.fromDecisions({ question: 'autenticação fluxo principal', options: ['ip', 'go'] }, ds), null);
    // Exact word option "tipo" with >= 2 shared terms matches DEC-1
    assert.deepEqual(questions.fromDecisions({ question: 'autenticação fluxo principal', options: ['tipo', 'token'] }, ds), { answer: 'tipo', source: 'DEC-1' });

    const pdir = tmpDir('oxe-q-');
    // Blank/whitespace default and empty interruptOn strings: blank default forces waiting_answer instead of recording empty provisional decision
    const res = questions.resolve(pdir, { question: 'Qual porta usar no serviço local?', options: ['3000', '4000'], default: '   ' }, { interruptOn: [''] });
    assert.equal(res.wait, true);
    assert.equal(questions.list(pdir)[0].why, 'sem default');
  });

  it('oxe-policy-rules: rejects empty forbid/deny/strip, supports 0-subdir /**/ globs + arrays, and reads object event payloads', () => {
    const cls = policyRules.classifyRules([
      { id: 'r-empty-forbid', forbid: '   ' },
      { id: 'r-empty-deny', kind: 'command', deny: '' },
      { id: 'r-empty-strip', kind: 'env', strip: ['  '] },
      { id: 'r-arr-path', kind: 'path', deny_read: ['./secrets/**/*.pem'], deny_write: ['dist/**', 'build/*.js'] },
      { id: 'r-arr-env', kind: 'env', strip: ['AWS_', 'SECRET.KEY_'] },
    ]);
    assert.equal(cls[0].state, 'advisory');
    assert.equal(cls[1].state, 'advisory');
    assert.equal(cls[2].state, 'advisory');
    assert.equal(cls[3].state, 'enforced');
    assert.equal(cls[4].state, 'enforced');

    assert.deepEqual(policyRules.envStripPatterns(cls.map((c) => c.rule)), ['^AWS_', '^SECRET\\.KEY_']);

    const events = [
      {
        type: 'ExecutorUsage',
        run_id: 'r1',
        work_item_id: 'T1',
        payload: {
          commands: [{ command: 'rm -rf /' }],
          reads: [{ path: './secrets/root.pem' }], // 0 intermediate directories under secrets/**/
          writes: [{ path: 'build\\bundle.js' }],
        },
      },
    ];
    const actions = policyRules.actionsFromEvents(events, 'r1');
    const hits = policyRules.checkActionRules([cls[3].rule, { id: 'r-cmd', kind: 'command', deny: 'rm\\s+-rf' }], actions);
    assert.deepEqual(hits.map((h) => [h.rule, h.kind, h.what]), [
      ['r-arr-path', 'path_read', 'secrets/root.pem'],
      ['r-arr-path', 'path_write', 'build/bundle.js'],
      ['r-cmd', 'command', 'rm -rf /'],
    ]);
  });

  it('oxe-findings: normalizes uppercase severities, ignores unknown blockOn ranks, and matches hierarchical standing criteria', () => {
    const dir = initRepo();
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'finding-rules.json'), JSON.stringify({ rules: [{ id: 'custom-sec', severity: 'CRITICAL' }] }));
    const rated = findings.rate(dir, { rule: 'custom-sec', severity: 'critical' });
    assert.equal(rated.severity, 'critical');

    const crs = [
      { id: 'CR-1', status: 'open', severity: 'low', criteria: ['A1'] },
      { id: 'CR-2', status: 'open', severity: 'HIGH', criteria: ['a70.2'] },
    ];
    // Unknown severity token "blocker" must NOT give rank -1 and block low CR-1; A70.2 matches standing A70
    const blocked = findings.blockingFindings(crs, ['blocker', 'high@standing'], ['A70']);
    assert.deepEqual(blocked.map((c) => c.id), ['CR-2']);
    assert.equal(findings.bySeverity(crs).high.length, 1);
  });

  it('oxe-verdicts: escapes multi-dot criterion IDs, resolves short SHAs, matches subcriteria/globs, and flags deleted criteria', () => {
    const dir = initRepo();
    fs.writeFileSync(path.join(dir, 'src-a.js'), '1\n');
    spawnSync('git', ['add', '-A'], { cwd: dir, windowsHide: true });
    spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir, windowsHide: true });
    const fullHead = verdicts.headOf(dir);
    const shortHead = fullHead.slice(0, 8);

    const spec1 = '| ID | Critério | Como |\n|---|---|---|\n| A1.2.3 | fluxo seguro | e2e |\n';
    const versions = verdicts.criteriaVersions(spec1, ['A1.2.3']);
    // Regex escaping: A1X2Y3 in table must NOT match A1.2.3
    assert.equal(verdicts.criterionRow('| A1X2Y3 | falso | x |\n', 'A1.2.3'), null);

    const v = { head: shortHead, criteria: ['A1.2'], criteria_versions: { 'A1.2': versions['A1.2.3'] } };
    const doc = { tasks: [{ id: 'T1', files: [{ path: './src-*.js' }], acceptance: ['A1.2.3'] }] };
    // Short SHA equals HEAD -> fresh when criterion row matches A1.2
    const specParent = '| ID | Critério | Como |\n|---|---|---|\n| **A1.2** | fluxo seguro | e2e |\n';
    const vParent = { head: shortHead, criteria: ['A1.2'], criteria_versions: verdicts.criteriaVersions(specParent, ['A1.2']) };
    assert.deepEqual(verdicts.freshness(dir, vParent, { doc, specText: specParent }), { fresh: true, why: null });

    // Deleting A1.2 from SPEC.md after sign-off marks verdict stale
    assert.match(verdicts.freshness(dir, vParent, { doc, specText: '| ID | Critério | Como |\n' }).why, /A1\.2 foi emendado/);

    // Commit touching glob/subcriterion scope invalidates verdict
    fs.writeFileSync(path.join(dir, 'src-a.js'), '2\n');
    spawnSync('git', ['commit', '-qam', 'touch scope'], { cwd: dir, windowsHide: true });
    assert.match(verdicts.freshness(dir, vParent, { doc, specText: specParent }).why, /commit novo no escopo de A1\.2/);
    void v;
  });

  it('oxe-phase-extras: skips status=done/superseded tasks, ignores blank quarantine entries, deduplicates regression hits, and cleans rollback wt', () => {
    const dir = tmpDir('oxe-px-r13-');
    // Empty command must be ignored rather than matching every task via "".includes("")
    phaseExtras.quarantine(dir, { task: 'T0', command: '   ', at: '2026-11-15T00:00:00Z' });
    phaseExtras.quarantine(dir, { task: 'T1', command: 'node --test tests/flaky.test.cjs', at: '2026-11-15T00:00:00Z' });
    const warnings = phaseExtras.quarantineWarnings(dir, {
      tasks: [
        { id: 'Tdone', status: 'done', verify: 'node --test tests/flaky.test.cjs' },
        { id: 'Tsup', superseded: true, verify: ['node --test tests/flaky.test.cjs'] },
        { id: 'Topen', verify: 'node --test tests/flaky.test.cjs' },
      ],
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /usado por Topen;/);

    const cost = phaseExtras.costReport(
      [{ type: 'ExecutorUsage', work_item_id: 'T1', payload: { attempt: 1, cost_usd: 2, turns: 4, elapsed_ms: 1000 } }],
      {
        tasks: [
          { id: 'T1', status: 'done', acceptance: ['A1.1'], reopened: [{ by: 'CR-9' }] },
          { id: 'T2', superseded: true },
          { id: 'T3' },
        ],
      },
      [{ id: 'CR-9', class: 'defect', criteria: ['A1'] }],
    );
    assert.equal(cost.forecast.pending_tasks, 1);
    assert.deepEqual(cost.crs, [{ cr: 'CR-9', class: 'defect', tasks: ['T1'], cost_usd: 2 }]);

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'lib.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(dir, 'tests', 'a.test.js'), "require('../src/lib.js');\n");
    fs.writeFileSync(path.join(dir, 'tests', 'b.test.js'), "require('../src/lib.js');\n");
    const impact = phaseExtras.regressionImpact(
      dir,
      [{ id: 'reg-1', regression_phase: 'F1', command: 'node --test ./tests/a.test.js ./tests/b.test.js' }],
      { tasks: [{ id: 'T3', files: [{ path: './src/lib.js' }, './src/lib.js'] }, { id: 'Tdone', status: 'done', files: ['src/lib.js'] }] },
    );
    assert.deepEqual(impact, [{ check: 'reg-1', phase: 'F1', file: 'src/lib.js', tasks: ['T3'] }]);
  });

  it('oxe-scorecard: validates invalid --since, counts external_delivery apart, and scopes post_green_crs per phase', () => {
    assert.throws(() => scorecard.computeScorecard({ events: [], since: 'not-a-date' }), /data --since inválida/);

    const events = [
      { type: 'PhaseStarted', payload: { phase: 'F1' }, timestamp: '2026-11-01T09:00:00Z' },
      { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T1', payload: { attempt_number: 1 }, timestamp: '2026-11-01T09:30:00Z' },
      { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T2', payload: { completed_by: 'external_delivery' }, timestamp: '2026-11-01T09:40:00Z' },
      { type: 'VerificationCompleted', payload: { status: 'passed' }, timestamp: '2026-11-01T10:00:00Z' },
      { type: 'PhaseStarted', payload: { phase: 'F2' }, timestamp: '2026-11-02T09:00:00Z' },
    ];
    const changeLines = [
      // Filed in F2 BEFORE F2 ever had a green verify -> must NOT count as post_green_crs against F1's verify!
      { kind: 'cr', id: 'CR-F2-EARLY', phase: 'F2', class: 'defect', at: '2026-11-02T09:30:00Z', status: 'open' },
      // Explicitly filed against F1 after F1's green verify -> MUST count as post_green_crs!
      { kind: 'cr', id: 'CR-F1-LATE', phase: 'F1', class: 'defect', at: '2026-11-02T09:45:00Z', status: 'open' },
    ];
    const card = scorecard.computeScorecard({ events, changeLines, ledgers: [] });
    assert.equal(card.sample.external_deliveries, 1);
    assert.equal(card.sample.tasks_judged, 1);
    assert.equal(card.metrics.find((m) => m.metric === 'post_green_crs').value, 1);
  });

  it('oxe-unsafe-commands: preserves && inside quoted node -e expressions while splitting prose apostrophes and flagging npm --silent ci / Remove-Item', () => {
    assert.deepEqual(
      unsafe.verifyCommandProblems('T1', 'node -e "const ok = true && 1 === 1; if (!ok) process.exit(1)" && npm test'),
      [],
    );
    assert.deepEqual(
      unsafe.verifyCommandProblems('T1', "node -e 'const ok = true && 1 === 1; if (!ok) process.exit(1)' && npm run lint"),
      [],
    );
    // Prose apostrophe ("PR's") does NOT swallow top-level && before git reset --hard
    const probs = unsafe.verifyCommandProblems('T2', "npm --silent ci (on CI: the PR's job) && git reset --hard HEAD");
    assert.equal(probs.length, 2);
    assert.ok(unsafe.unsafeReason('Remove-Item -Recurse -Force node_modules'));
    assert.equal(unsafe.unsafeReason('npm --silent test -- --ci'), null);
  });
});
