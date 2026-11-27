'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scorecardLib = require('../../bin/lib/oxe-scorecard.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkTelemetryProject(prefix = 'oxe-1222-a8-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.oxe', 'events'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ profile: 'lean' }, null, 2));

  // F1: 1 CI run (first-pass green!). F2: 3 CI runs (2 rework cycles before green!).
  fs.writeFileSync(
    path.join(dir, '.oxe', 'program', 'ci.ndjson'),
    [
      JSON.stringify({ kind: 'ci', phase: 'F1', run: '1001', head: 'aaaa1111', conclusion: 'success', at: '2026-11-26T10:30:00.000Z' }),
      JSON.stringify({ kind: 'ci', phase: 'F2', run: '1002', head: 'bbbb1111', conclusion: 'failure', at: '2026-11-26T12:15:00.000Z' }),
      JSON.stringify({ kind: 'ci', phase: 'F2', run: '1003', head: 'bbbb2222', conclusion: 'failure', at: '2026-11-26T12:35:00.000Z' }),
      JSON.stringify({ kind: 'ci', phase: 'F2', run: '1004', head: 'bbbb3333', conclusion: 'success', at: '2026-11-26T12:55:00.000Z' }),
    ].join('\n') + '\n',
  );

  fs.writeFileSync(
    path.join(dir, '.oxe', 'events', 'events.ndjson'),
    [
      JSON.stringify({ type: 'PhaseStarted', timestamp: '2026-11-26T10:00:00.000Z', payload: { phase: 'F1' } }),
      JSON.stringify({ type: 'VerificationCompleted', timestamp: '2026-11-26T10:20:00.000Z', payload: { phase: 'F1', status: 'passed' } }),
      JSON.stringify({ type: 'PhaseClosed', timestamp: '2026-11-26T10:35:00.000Z', payload: { phase: 'F1' } }),
      JSON.stringify({ type: 'PhaseStarted', timestamp: '2026-11-26T11:30:00.000Z', payload: { phase: 'F2' } }),
      JSON.stringify({ type: 'VerificationCompleted', timestamp: '2026-11-26T12:00:00.000Z', payload: { phase: 'F2', status: 'passed' } }),
      JSON.stringify({ type: 'PhaseClosed', timestamp: '2026-11-26T13:00:00.000Z', payload: { phase: 'F2' } }),
    ].join('\n') + '\n',
  );

  return dir;
}

describe('A8 — OXB-222-08: runtime scorecard --with-ci (CI rework & leadtime telemetry)', () => {
  it('OXB-222-08: computeLeadtimeAndCiMetrics calculates first_pass_ci_green_rate, ci_rework_cycles, and leadtime offline', () => {
    assert.equal(typeof scorecardLib.computeLeadtimeAndCiMetrics, 'function', 'oxe-scorecard must export computeLeadtimeAndCiMetrics');
    const dir = mkTelemetryProject('oxe-1222-a8-lib-');
    const telemetry = scorecardLib.computeLeadtimeAndCiMetrics(dir);

    assert.equal(telemetry.offline, true);
    assert.equal(telemetry.total_ci_runs, 4);
    assert.equal(telemetry.phases_with_ci, 2);
    assert.equal(telemetry.first_pass_ci_green_rate, 0.5, '1 of 2 phases green on first CI run => 0.5');
    assert.equal(telemetry.ci_rework_cycles, 2, 'F2 took 2 extra CI rework cycles (3 runs - 1)');
    assert.ok(telemetry.leadtime_breakdown && typeof telemetry.leadtime_breakdown.avg_plan_to_verify_ms === 'number');
    assert.ok(telemetry.leadtime_breakdown.avg_plan_to_verify_ms > 0);
    assert.ok(typeof telemetry.leadtime_breakdown.avg_verify_to_close_ms === 'number' && telemetry.leadtime_breakdown.avg_verify_to_close_ms > 0);
    assert.ok(typeof telemetry.leadtime_breakdown.post_verify_share_pct === 'number');
  });

  it('OXB-222-08: runtime scorecard --with-ci attaches ci_telemetry without breaking default contract', () => {
    const dir = mkTelemetryProject('oxe-1222-a8-cli-');

    const baseRes = spawnSync(process.execPath, [BIN, 'runtime', 'scorecard', '--json', '--dir', dir], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(baseRes.status, 0, baseRes.stderr || baseRes.stdout);
    const baseJson = JSON.parse(baseRes.stdout);
    assert.equal(baseJson.oxeScorecardSchema, 1);
    assert.equal(baseJson.ci_telemetry, undefined, 'default scorecard without --with-ci keeps original shape');

    const ciRes = spawnSync(process.execPath, [BIN, 'runtime', 'scorecard', '--with-ci', '--json', '--dir', dir], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(ciRes.status, 0, ciRes.stderr || ciRes.stdout);
    const ciJson = JSON.parse(ciRes.stdout);
    assert.equal(ciJson.oxeScorecardSchema, 1);
    assert.ok(ciJson.ci_telemetry, 'runtime scorecard --with-ci must attach ci_telemetry');
    assert.equal(ciJson.ci_telemetry.first_pass_ci_green_rate, 0.5);
    assert.equal(ciJson.ci_telemetry.ci_rework_cycles, 2);
    assert.equal(ciJson.ci_telemetry.total_ci_runs, 4);
  });
});
