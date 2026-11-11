'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ch = require('../bin/lib/oxe-channels.cjs');

// 1.21.2 — OXB-100: next/stable channels (never publishes) and doctor --migrate-config.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ch-')); dirs.push(d); return d; };

describe('OXB-100: channels', () => {
  it('next records an RC; stable needs a real project phase closed on the build and is never a pre-release', () => {
    const d = tmp();
    assert.deepEqual(ch.recordNext(d, '1.21.2-rc.38').commands, ['npm publish --tag next   # 1.21.2-rc.38']);
    assert.throws(() => ch.promote(d, '1.21.2', { to: 'stable' }), /stable só depois de uma fase de projeto real fechada/);
    assert.throws(() => ch.promote(d, '1.21.2-rc.38', { to: 'stable', evidence: 'x', phase: 'F2', project: 'oxespace' }), /pré-release/);
    const ok = ch.promote(d, '1.21.2', { to: 'stable', evidence: 'oxespace@abc123 dossier/F2', phase: 'F2', project: 'oxespace' });
    assert.ok(ok.commands.includes('npm dist-tag add oxe-cc@1.21.2 latest'));
    const doc = ch.readChannels(d);
    assert.deepEqual([doc.next, doc.stable], ['1.21.2-rc.38', '1.21.2']);
    assert.equal(doc.history[1].phase, 'F2');
    const r = spawnSync(process.execPath, [CLI, 'release', 'channel', 'status', '--dir', d], { encoding: 'utf8' });
    assert.match(r.stdout, /next: 1\.21\.2-rc\.38 · stable: 1\.21\.2/);
  });
});

describe('OXB-100: doctor --migrate-config', () => {
  const MIG = [{ version: '1.21.2', notes: ['maxTurns virou teto'], moves: [{ from: 'executor.max_turns', to: 'runtime.provider.maxTurns' }] }, { version: '1.21.1', notes: ['antiga'], moves: [] }];

  it('pending migrations from the config version; moves only when the target is unset', () => {
    const p = ch.pending({ executor: { max_turns: 40 } }, '1.21.1', '1.21.2', MIG);
    assert.equal(p.length, 1);
    assert.deepEqual(p[0].moves, [{ from: 'executor.max_turns', to: 'runtime.provider.maxTurns' }]);
    assert.deepEqual(ch.pending({ executor: { max_turns: 40 }, runtime: { provider: { maxTurns: 60 } } }, '1.21.1', '1.21.2', MIG)[0].moves, []);
  });

  it('apply backs the config up, moves the keys and stamps the version', () => {
    const d = tmp();
    const cfg = path.join(d, 'config.json');
    fs.writeFileSync(cfg, JSON.stringify({ oxe_config_version: '1.21.1', executor: { max_turns: 40 } }));
    const out = ch.apply(cfg, '1.21.2', MIG);
    const now = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    assert.equal(now.runtime.provider.maxTurns, 40);
    assert.equal(now.executor.max_turns, undefined);
    assert.equal(now.oxe_config_version, '1.21.2');
    assert.ok(fs.existsSync(out.backup));
    assert.deepEqual(out.notes, ['1.21.2: maxTurns virou teto']);
  });

  it('the CLI lists the packaged notes without applying them', () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, '.oxe'));
    fs.writeFileSync(path.join(d, '.oxe', 'config.json'), JSON.stringify({ oxe_config_version: '1.21.1' }));
    const r = spawnSync(process.execPath, [CLI, 'doctor', '--migrate-config', '--json', '--dir', d], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    const pkg = require('../package.json').version;
    assert.equal(out.to, pkg);
    assert.deepEqual(out.pending, ch.pending({ oxe_config_version: '1.21.1' }, '1.21.1', pkg));
    assert.ok(ch.pending({}, '1.21.1', '1.21.2').some((m) => m.notes.some((n) => /TETO global/.test(n))), 'the packaged 1.21.2 notes');
    assert.equal(JSON.parse(fs.readFileSync(path.join(d, '.oxe', 'config.json'), 'utf8')).oxe_config_version, '1.21.1');
  });
});
