'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const coord = require('../../bin/lib/oxe-agent-coord.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('A3 — Eliminação determinística de flake PID reuse no Windows (OXB-230-03)', () => {
  it('OXB-230-03: findGuaranteedDeadPid returns a guaranteed inactive PID without child-process reuse race and promote-fixtures adopts it', () => {
    assert.equal(typeof coord.findGuaranteedDeadPid, 'function');
    for (let i = 0; i < 5; i += 1) {
      const pid = coord.findGuaranteedDeadPid();
      assert.ok(Number.isInteger(pid) && pid > 0, `expected positive integer PID, got ${pid}`);
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (err) {
        if (err && err.code === 'ESRCH') alive = false;
      }
      assert.equal(alive, false, `PID ${pid} must be guaranteed dead (ESRCH)`);
    }

    const fixturesTest = fs.readFileSync(path.join(REPO_ROOT, 'tests/oxe-1212-promote-fixtures.test.cjs'), 'utf8');
    assert.match(fixturesTest, /findGuaranteedDeadPid/, 'promote-fixtures test must use findGuaranteedDeadPid instead of ephemeral spawned child PID');
    assert.doesNotMatch(fixturesTest, /console\.log\(process\.pid\)/, 'ephemeral child PID snippet must be removed to avoid Windows PID reuse race');
  });
});
