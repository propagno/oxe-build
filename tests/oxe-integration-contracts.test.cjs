'use strict';

// Host-integration contracts (OXESpace and other embedding hosts):
//   - `oxe events --tail --json`  → read-only projection of OXE-EVENTS.ndjson
//   - `oxe dashboard --json`      → emits one versioned line with the live URL/port
// These are additive surfaces; the existing `status --json` / dashboard human
// output are unchanged. See docs/INTEGRATION.md for the stable contract.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');

function makeOxeProject(events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-integ-'));
  const oxe = path.join(dir, '.oxe');
  fs.mkdirSync(oxe, { recursive: true });
  fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE STATE\n\nphase: plan\n', 'utf8');
  fs.writeFileSync(path.join(oxe, 'config.json'), '{}', 'utf8');
  if (Array.isArray(events) && events.length) {
    fs.writeFileSync(path.join(oxe, 'OXE-EVENTS.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
  return dir;
}

const SAMPLE_EVENTS = [
  { event_id: 'evt-a', type: 'RunStarted', timestamp: '2026-05-30T10:00:00.000Z', run_id: 'run-1', payload: {} },
  { event_id: 'evt-b', type: 'WorkItemReady', timestamp: '2026-05-30T10:00:05.000Z', run_id: 'run-1', payload: {} },
  { event_id: 'evt-c', type: 'RunCompleted', timestamp: '2026-05-30T10:01:00.000Z', run_id: 'run-1', payload: {} },
];

describe('oxe events --json', () => {
  test('projects a versioned, parseable event payload with summary', () => {
    const dir = makeOxeProject(SAMPLE_EVENTS);
    const out = execFileSync(process.execPath, [BIN, 'events', '--json', '--dir', dir], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.oxeEventsSchema, 1);
    assert.strictEqual(parsed.summary.total, 3);
    assert.strictEqual(parsed.summary.byType.RunStarted, 1);
    assert.strictEqual(parsed.summary.lastEvent.event_id, 'evt-c');
    assert.ok(Array.isArray(parsed.events));
    assert.strictEqual(parsed.events[parsed.events.length - 1].type, 'RunCompleted');
  });

  test('--tail N returns only the last N events', () => {
    const dir = makeOxeProject(SAMPLE_EVENTS);
    const out = execFileSync(process.execPath, [BIN, 'events', '--tail', '2', '--json', '--dir', dir], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.events.length, 2);
    assert.strictEqual(parsed.events[0].event_id, 'evt-b');
  });

  test('--since <evt_id> returns only newer events', () => {
    const dir = makeOxeProject(SAMPLE_EVENTS);
    const out = execFileSync(process.execPath, [BIN, 'events', '--since', 'evt-a', '--json', '--dir', dir], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    const ids = parsed.events.map((e) => e.event_id);
    assert.deepStrictEqual(ids, ['evt-b', 'evt-c']);
  });

  test('empty log degrades to an empty array (no throw)', () => {
    const dir = makeOxeProject([]);
    const out = execFileSync(process.execPath, [BIN, 'events', '--json', '--dir', dir], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.summary.total, 0);
    assert.deepStrictEqual(parsed.events, []);
  });
});

describe('oxe dashboard --json', () => {
  test('emits one versioned line with an ephemeral url/port, then keeps serving', async () => {
    const dir = makeOxeProject(SAMPLE_EVENTS);
    const child = spawn(process.execPath, [BIN, 'dashboard', '--no-open', '--port', '0', '--json', '--dir', dir], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    try {
      const firstLine = await new Promise((resolve, reject) => {
        const rl = readline.createInterface({ input: child.stdout });
        const timer = setTimeout(() => reject(new Error('dashboard did not emit a line in time')), 10_000);
        rl.once('line', (line) => { clearTimeout(timer); rl.close(); resolve(line); });
        child.once('error', reject);
      });
      const info = JSON.parse(firstLine);
      assert.strictEqual(info.oxeDashboardSchema, 1);
      assert.ok(typeof info.port === 'number' && info.port > 0, 'port should be a positive number');
      assert.notStrictEqual(info.port, 4173, '--port 0 should yield an ephemeral port, not the default');
      assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    } finally {
      child.kill();
    }
  });
});

describe('oxe map --json', () => {
  test('projects a versioned artifact map with present/available split and counts', () => {
    const dir = makeOxeProject(SAMPLE_EVENTS);
    const out = execFileSync(process.execPath, [BIN, 'map', '--json', '--dir', dir], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.oxeMapSchema, 1);
    assert.strictEqual(parsed.oxeExists, true);
    assert.ok(Array.isArray(parsed.groups));
    assert.ok(Array.isArray(parsed.present));
    assert.ok(Array.isArray(parsed.available));
    assert.ok(parsed.counts && typeof parsed.counts.total === 'number');
    // STATE.md exists in the fixture, so it must appear as present/active.
    const state = parsed.present.find((n) => n.path === 'STATE.md');
    assert.ok(state, 'STATE.md should be present');
    assert.strictEqual(state.state, 'active');
  });
});
