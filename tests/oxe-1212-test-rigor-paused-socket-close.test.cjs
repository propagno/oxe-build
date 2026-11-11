'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const rigor = require('../bin/lib/oxe-test-rigor.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-208:
//   Detect `net.connect` / `tls.connect` blocks in `tests/acceptance/**` that register `.on('close')` or `.on('end')`
//   after `.write()` without `.on('data')`, `.once('data')`, or `.resume()` in the same scope (Node 22+ paused stream hang).

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
};

function makeF11Project(testBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-oxb208-'));
  dirs.push(dir);

  write(dir, '.oxe/STATE.md', '# S\n');
  write(
    dir,
    '.oxe/SPEC.md',
    '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A68 | proxy CONNECT encerra túnel ocioso | `npx vitest run tests/acceptance/f11/a68-hosts-proxy.native.test.ts` |\n'
  );
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 11 — Proxy\n\n**Critérios de aceite:** A68\n');
  write(dir, '.oxe/config.json', JSON.stringify({ plan_lint_preflight: false }));
  write(dir, 'electron/main/services/proxy/hosts-proxy.ts', 'export function startProxy() { return 0; }\n');
  write(dir, 'tests/acceptance/f11/a68-hosts-proxy.native.test.ts', testBody);

  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/PLAN.json', {
    schema_version: 1,
    phase: 'F11',
    tasks: [
      {
        id: 'T1',
        title: 'Fechar túnel CONNECT ocioso após 400ms',
        wave: 1,
        files: ['electron/main/services/proxy/hosts-proxy.ts'],
        verify: { commands: ['npx vitest run tests/acceptance/f11/a68-hosts-proxy.native.test.ts'] },
        acceptance: ['A68'],
      },
    ],
    acceptance_tests: [
      {
        criterion: 'A68',
        files: ['tests/acceptance/f11/a68-hosts-proxy.native.test.ts'],
        command: 'npx vitest run tests/acceptance/f11/a68-hosts-proxy.native.test.ts --reporter=verbose',
        proves: ['closes idle tunnel after 400ms'],
      },
    ],
  });
  write(dir, '.oxe/IMPLEMENTATION-PACK.json', {
    schema_version: 1,
    ready: true,
    phase: 'F11',
    tasks: [
      {
        id: 'T1',
        mode: 'mutating',
        write_set: 'closed',
        requires_fixture: false,
        exact_paths: ['electron/main/services/proxy/hosts-proxy.ts'],
        symbols: [{ name: 'startProxy', path: 'electron/main/services/proxy/hosts-proxy.ts' }],
        contracts: ['startProxy exportado de electron/main/services/proxy/hosts-proxy.ts'],
        expected_checks: ['npx vitest run tests/acceptance/f11/a68-hosts-proxy.native.test.ts'],
      },
    ],
  });
  write(dir, '.oxe/REFERENCE-ANCHORS.md', '<reference_anchors status="not_applicable" ready="true"></reference_anchors>\n');
  write(dir, '.oxe/FIXTURE-PACK.json', { ready: true, fixtures: [] });

  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'freeze f11');

  return dir;
}

describe('OXB-208: paused `net.connect` socket awaiting `close`/`end` without `resume()` or `data` listener (Node 22+)', () => {
  it('flags paused `connect(...)` + `.write(...)` + `.on("close"|"end")` in plan lint and plan build, even with timeout `.destroy()`', () => {
    const buggyTest = [
      "import { connect } from 'node:net';",
      "import { describe, it, expect } from 'vitest';",
      "import { startProxy } from '../../../electron/main/services/proxy/hosts-proxy';",
      '',
      "describe('A68 hosts proxy', () => {",
      "  it('drains first test properly', async () => {",
      "    const socket = connect(8080, '127.0.0.1');",
      "    socket.on('data', () => {});",
      "    socket.write('CONNECT ok.example:443 HTTP/1.1\\r\\n\\r\\n');",
      "    await new Promise((resolve) => socket.on('close', () => resolve(true)));",
      '  });',
      '',
      "  it('closes idle tunnel after 400ms', async () => {",
      '    const port = startProxy();',
      "    const socket = connect(port, '127.0.0.1');",
      "    socket.write('CONNECT example.com:443 HTTP/1.1\\r\\nHost: example.com:443\\r\\n\\r\\n');",
      '    const closed = await new Promise<boolean>((resolve, reject) => {',
      "      const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout 5000ms')); }, 5000);",
      "      socket.on('close', () => { clearTimeout(timer); resolve(true); });",
      '    });',
      '    expect(closed).toBe(true);',
      '  });',
      '});',
      '',
    ].join('\n');

    const dir = makeF11Project(buggyTest);
    const findings = rigor.pausedSocketFindings(dir);
    assert.equal(findings.length, 1, 'flags only the second test block, not the drained first one');
    assert.equal(findings[0].file, 'tests/acceptance/f11/a68-hosts-proxy.native.test.ts');
    assert.equal(findings[0].variable, 'socket');
    assert.equal(findings[0].event, 'close');
    assert.equal(findings[0].line, 19);

    const lintRes = op.runtimePlanLint(dir, null, { preflight: false });
    assert.equal(lintRes.ok, false);
    assert.ok(
      lintRes.errors.some((e) => e.includes('a68-hosts-proxy.native.test.ts:19') && e.includes('Node 22+') && e.includes('socket.resume()')),
      `expected Node 22+ paused socket error in plan lint, got: ${lintRes.errors.join(' | ')}`
    );

    // Also blocks `plan amend-test` if the amended file still leaves the socket paused
    const amendBlocked = spawnSync(
      process.execPath,
      [CLI, 'plan', 'amend-test', 'tests/acceptance/f11/a68-hosts-proxy.native.test.ts', '--reason', 'CR-F11-1', '--dir', dir],
      { cwd: dir, encoding: 'utf8', windowsHide: true }
    );
    assert.notEqual(amendBlocked.status, 0);
    assert.match(amendBlocked.stdout + amendBlocked.stderr, /socket pausado|Node 22\+/);
  });

  it('passes cleanly once `socket.resume()` or `.on("data")` / `.once("data")` is added in the same scope', () => {
    const fixedWithResume = [
      "import { connect } from 'node:net';",
      "import { describe, it, expect } from 'vitest';",
      "import { startProxy } from '../../../electron/main/services/proxy/hosts-proxy';",
      '',
      "describe('A68 hosts proxy', () => {",
      "  it('closes idle tunnel after 400ms', async () => {",
      '    const port = startProxy();',
      "    const socket = connect(port, '127.0.0.1');",
      "    socket.write('CONNECT example.com:443 HTTP/1.1\\r\\nHost: example.com:443\\r\\n\\r\\n');",
      '    socket.resume();',
      '    const closed = await new Promise<boolean>((resolve) => {',
      "      socket.once('end', () => resolve(true));",
      '    });',
      '    expect(closed).toBe(true);',
      '  });',
      '});',
      '',
    ].join('\n');

    const dir = makeF11Project(fixedWithResume);
    assert.deepEqual(rigor.pausedSocketFindings(dir), []);

    const lintRes = op.runtimePlanLint(dir, null, { preflight: false });
    assert.equal(lintRes.ok, true, `unexpected lint errors: ${lintRes.errors.join('; ')}`);
  });
});
