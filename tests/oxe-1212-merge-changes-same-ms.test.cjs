'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const change = require('../bin/lib/oxe-change.cjs');

// The R9 test of mergeChanges failed once in a battery (00:32Z, 16/11) and passed on rerun: the fork's CR-01 and the
// main CR-01 were written in the same millisecond, so the dedupe key (kind|id|at|status) took them for one record and
// the fork's was never renamed. A CR's summary is part of its identity.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-mcms-')); dirs.push(d); return d; };

describe('mergeChanges: two different CRs with the same id in the same millisecond', () => {
  it('the fork CR is merged and renamed; the same CR (same summary) is still deduped', () => {
    const at = '2026-11-16T00:00:00.000Z';
    const main = tmp();
    const fork = tmp();
    change.appendNdjson(change.changesFile(main), { kind: 'cr', id: 'CR-01', class: 'constraint', summary: 'main', status: 'open', at });
    change.appendNdjson(change.changesFile(fork), { kind: 'cr', id: 'CR-01', class: 'spec_gap', summary: 'fork', status: 'open', phase: 'F4', at });
    const out = change.mergeChanges(main, fork, { phase: 'F4', from: fork });
    assert.deepEqual(out.renamed, { 'CR-01': 'CR-F4-1' });
    const same = tmp();
    change.appendNdjson(change.changesFile(same), { kind: 'cr', id: 'CR-01', class: 'constraint', summary: 'main', status: 'open', at });
    assert.equal(change.mergeChanges(main, same, { phase: 'F4', from: same }).merged, 0, 'the very same record is not duplicated');
  });
});
