'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const errors = require('../bin/lib/oxe-cli-errors.cjs');

// 1.21.2 — OXB-133: typed errors with a stable exit code across the CLI (--json-errors).

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ce-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd: tmp, encoding: 'utf8', timeout: 90_000, env: { ...process.env, OXE_NO_PROMPT: '1', ...env } });

// every command listed in `oxe-cc --help`, plus the 1.21.2 ones
const COMMANDS = ['azure', 'capabilities', 'context', 'doctor', 'events', 'map', 'plugins', 'program export', 'program phase', 'runtime', 'runtime ci', 'runtime deploy', 'runtime dossier', 'runtime execute', 'runtime feedback', 'runtime program', 'runtime promote', 'runtime rollback', 'runtime scorecard', 'runtime signal', 'runtime signoff', 'runtime sync', 'runtime verify', 'runtime questions', 'runtime ui-evidence', 'spec add', 'spec amend', 'spec probe', 'status', 'uninstall', 'update', 'init-oxe', 'plan lint', 'decision list', 'review status', 'docs check', 'state validate'];

describe('OXB-133: --json-errors', () => {
  it('the catalog in docs/cli-errors.md is the one in the code', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'cli-errors.md'), 'utf8');
    for (const [kind, exit] of Object.entries(errors.KINDS)) assert.match(md, new RegExp(`\\| \`${kind}\` \\| ${exit} \\|`), kind);
    const rows = [...md.matchAll(/^\| `([a-z_]+)` \| (\d+) \|/gm)].map((m) => m[1]);
    assert.deepEqual(rows.sort(), Object.keys(errors.KINDS).sort());
  });

  it('every command answers a usage error with a valid envelope and the same exit code', () => {
    const bad = [];
    for (const c of COMMANDS) {
      const r = run([...c.split(' '), '--zzz-unknown', '--json-errors']);
      const line = String(r.stderr || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
      let env = null;
      try { env = JSON.parse(line); } catch { /* */ }
      if (!env || env.ok !== false || env.kind !== 'usage' || env.exit !== 2 || r.status !== 2 || !env.message || !env.hint || env.command !== c) bad.push(`${c}: status=${r.status} ${line.slice(0, 160)}`);
    }
    assert.deepEqual(bad, []);
    assert.deepEqual(fs.readdirSync(tmp), [], 'a usage error writes nothing');
  });

  it('OXE_JSON_ERRORS=1 works like the flag; without it the human output is unchanged', () => {
    const viaEnv = run(['status', '--zzz'], { OXE_JSON_ERRORS: '1' });
    assert.equal(viaEnv.status, 2);
    assert.equal(JSON.parse(viaEnv.stderr.trim().split(/\r?\n/).pop()).kind, 'usage');
    const human = run(['status', '--zzz']);
    assert.equal(human.status, 1);
    assert.match(human.stderr, /Opção desconhecida: --zzz/);
    assert.doesNotMatch(human.stderr, /"kind"/);
  });

  it('classification of the CLI wording', () => {
    assert.equal(errors.classify('Opção desconhecida: --x', 1), 'usage');
    assert.equal(errors.classify('pergunta Q-3 não existe', 1), 'not_found');
    assert.equal(errors.classify('Q-1 já foi respondida: x', 1), 'conflict');
    assert.equal(errors.classify('pacote de evidência de UI recusado', 1), 'validation');
    assert.equal(errors.classify('claude não encontrado no PATH', 1), 'environment');
    assert.equal(errors.classify('', 1), 'gate_failed');
  });
});
