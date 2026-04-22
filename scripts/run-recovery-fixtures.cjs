#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const operational = require('../bin/lib/oxe-operational.cjs');
const release = require('../bin/lib/oxe-release.cjs');

const PACKAGE_ROOT = process.env.OXE_RELEASE_PACKAGE_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PACKAGE_ROOT)
  : path.join(__dirname, '..');
const PROJECT_ROOT = process.env.OXE_RELEASE_PROJECT_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PROJECT_ROOT)
  : PACKAGE_ROOT;
const FIXTURE_DIR = path.join(PACKAGE_ROOT, 'tests', 'fixtures', 'runtime-incidents');

function loadFixtures() {
  return fs.readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      name: name.replace(/\.json$/i, ''),
      payload: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')),
    }));
}

function seedFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-recovery-${payload.name || payload.run_id}-`));
  const oxe = path.join(dir, '.oxe');
  const runId = payload.run_id;
  fs.mkdirSync(path.join(oxe, 'runs', runId), { recursive: true });
  fs.mkdirSync(path.join(oxe, 'execution'), { recursive: true });
  fs.writeFileSync(path.join(oxe, 'STATE.md'), `## Fase atual\n\n\`${payload.phase || 'executing'}\`\n`, 'utf8');
  operational.writeRunState(dir, null, payload.run_state);
  fs.writeFileSync(path.join(oxe, 'runs', runId, 'journal.json'), JSON.stringify(payload.journal, null, 2), 'utf8');
  if (Array.isArray(payload.gates)) {
    fs.writeFileSync(path.join(oxe, 'execution', 'GATES.json'), JSON.stringify(payload.gates, null, 2), 'utf8');
  }
  if (Array.isArray(payload.policy_decisions)) {
    fs.writeFileSync(path.join(oxe, 'runs', runId, 'policy-decisions.json'), JSON.stringify(payload.policy_decisions, null, 2), 'utf8');
  }
  if (payload.verification_manifest) {
    fs.writeFileSync(
      path.join(oxe, 'runs', runId, 'verification-manifest.json'),
      JSON.stringify(payload.verification_manifest, null, 2),
      'utf8'
    );
  }
  if (payload.residual_risks) {
    fs.writeFileSync(
      path.join(oxe, 'runs', runId, 'residual-risk-ledger.json'),
      JSON.stringify(payload.residual_risks, null, 2),
      'utf8'
    );
  }
  if (payload.evidence_coverage) {
    fs.writeFileSync(
      path.join(oxe, 'runs', runId, 'evidence-coverage.json'),
      JSON.stringify(payload.evidence_coverage, null, 2),
      'utf8'
    );
  }
  if (payload.promotion_record) {
    fs.writeFileSync(
      path.join(oxe, 'runs', runId, 'promotion-record.json'),
      JSON.stringify(payload.promotion_record, null, 2),
      'utf8'
    );
  }
  if (Array.isArray(payload.events)) {
    for (const event of payload.events) {
      operational.appendEvent(dir, null, event);
    }
  }
  return dir;
}

function includesAll(expected, actual) {
  return expected.every((value) => actual.includes(value));
}

function evaluateFixture(name, payload) {
  const dir = seedFixture(payload);
  const replay = operational.replayRuntimeState(dir, null, {
    runId: payload.run_id,
    writeReport: true,
  });
  const recovered = operational.recoverRuntimeState(dir, null, {
    runId: payload.run_id,
  });
  const report = {
    fixture: name,
    ok: true,
    replay_report_present: Boolean(replay.report_path && fs.existsSync(replay.report_path)),
    recovery_summary_present: fs.existsSync(path.join(dir, '.oxe', 'RECOVERY-SUMMARY.md')),
    orphan_work_items: recovered.recoverySummary && Array.isArray(recovered.recoverySummary.orphan_work_items)
      ? recovered.recoverySummary.orphan_work_items
      : [],
    consistency_issue_count: recovered.recoverySummary
      && recovered.recoverySummary.consistency
      && Array.isArray(recovered.recoverySummary.consistency.issues)
      ? recovered.recoverySummary.consistency.issues.length
      : 0,
    pending_gate_count: replay.gateQueue && Array.isArray(replay.gateQueue.pending) ? replay.gateQueue.pending.length : 0,
    policy_decision_count: Array.isArray(replay.policyDecisions) ? replay.policyDecisions.length : 0,
    verification_present: Boolean(replay.verification && replay.verification.manifest),
    observations: [],
  };

  if (!report.replay_report_present) report.observations.push('replay-report.json ausente');
  if (!report.recovery_summary_present) report.observations.push('RECOVERY-SUMMARY.md ausente');
  if (payload.expect) {
    if (Array.isArray(payload.expect.orphan_work_items) && !includesAll(payload.expect.orphan_work_items, report.orphan_work_items)) {
      report.observations.push(`órfãos esperados ausentes: ${payload.expect.orphan_work_items.join(', ')}`);
    }
    if (typeof payload.expect.consistency_issue_min === 'number' && report.consistency_issue_count < payload.expect.consistency_issue_min) {
      report.observations.push(`consistency issues abaixo do mínimo (${payload.expect.consistency_issue_min})`);
    }
    if (typeof payload.expect.pending_gate_min === 'number' && report.pending_gate_count < payload.expect.pending_gate_min) {
      report.observations.push(`pending gates abaixo do mínimo (${payload.expect.pending_gate_min})`);
    }
    if (typeof payload.expect.policy_decision_min === 'number' && report.policy_decision_count < payload.expect.policy_decision_min) {
      report.observations.push(`policy decisions abaixo do mínimo (${payload.expect.policy_decision_min})`);
    }
    if (payload.expect.verification_present === true && !report.verification_present) {
      report.observations.push('verification manifest ausente no replay');
    }
  }
  report.ok = report.observations.length === 0;
  return report;
}

function main() {
  const results = loadFixtures().map(({ name, payload }) => evaluateFixture(name, payload));
  const output = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      pass: results.filter((item) => item.ok).length,
      fail: results.filter((item) => !item.ok).length,
    },
  };
  const reportPath = release.releasePaths(PROJECT_ROOT).recoveryFixtureReport;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  if (output.summary.fail > 0) {
    console.error(`run-recovery-fixtures: ${output.summary.fail} fixture(s) com falha`);
    process.exit(1);
  }
  console.log(`run-recovery-fixtures: OK (${output.summary.pass}/${output.summary.total})`);
}

main();
