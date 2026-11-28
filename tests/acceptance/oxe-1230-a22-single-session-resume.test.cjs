'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin/oxe-cc.js');

describe('A22 — Fonte única de sessão ativa (.oxe/state.json + STATE.md), SPEC por sessão e oxe-cc resume (OXB-230-22)', () => {
  it('OXB-230-22: oxe-state.cjs records active_session in .oxe/state.json and resolveEffectiveSession prioritizes state.json over stale root files', () => {
    const oxeState = require(path.join(REPO_ROOT, 'bin/lib/oxe-state.cjs'));
    const operational = require(path.join(REPO_ROOT, 'bin/lib/oxe-operational.cjs'));
    const specCheck = require(path.join(REPO_ROOT, 'bin/lib/oxe-spec-check.cjs'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a22-session-'));
    try {
      const oxe = path.join(dir, '.oxe');
      fs.mkdirSync(path.join(oxe, 'sessions', 's002-nova', 'program'), { recursive: true });
      // Stale root SPEC (legacy) vs active session SPEC
      fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# SPEC LEGADA\n', 'utf8');
      fs.writeFileSync(
        path.join(oxe, 'sessions', 's002-nova', 'SPEC.md'),
        '# SPEC ATIVA\n\n## Requisitos\n- **R1:** Novo fluxo (A1)\n\n## Critérios de aceite\n| ID | Critério | Risco | Como verificar |\n|----|----------|-------|----------------|\n| A1 | Teste real | P2 | `node --test a.test.cjs` |\n\n## Bordas e Proibições\n- Sem side effects\n',
        'utf8'
      );
      fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n\n## Sessão ativa\n- `sessions/s002-nova`\n', 'utf8');

      // 1. buildStateJson carries active_session and writes to .oxe/state.json
      const snap = oxeState.buildStateJson({
        activeSession: 'sessions/s002-nova',
        program: { active_phase: 'F1', phases: [{ id: 'F1', status: 'planning' }] },
        run: {},
        work: {},
        changes: [],
      });
      assert.equal(snap.active_session, 'sessions/s002-nova');
      oxeState.writeStateJson(dir, snap);
      assert.equal(oxeState.readActiveSessionPointer(dir), 'sessions/s002-nova');

      // 2. resolveEffectiveSession reads canonical state.json first
      assert.equal(operational.resolveEffectiveSession(dir, null), 'sessions/s002-nova');

      // 3. oxe-spec-check.cjs resolveSessionSpecPath prefers active session SPEC.md and falls back to root SPEC.md for legacy projects
      const resolvedActive = specCheck.resolveSessionSpecPath(dir);
      assert.ok(resolvedActive.replace(/\\/g, '/').endsWith('.oxe/sessions/s002-nova/SPEC.md'), `esperava SPEC da sessão ativa, obteve ${resolvedActive}`);

      // Legacy fallback: remove state.json and STATE.md session pointer -> falls back to root .oxe/SPEC.md
      fs.unlinkSync(path.join(oxe, 'state.json'));
      fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n', 'utf8');
      const resolvedLegacy = specCheck.resolveSessionSpecPath(dir);
      assert.ok(resolvedLegacy.replace(/\\/g, '/').endsWith('.oxe/SPEC.md'), `esperava fallback legado para .oxe/SPEC.md, obteve ${resolvedLegacy}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-230-22: oxe-cc resume (--json and text < 20 lines) and SDK client.resume() deliver concise recovery brief', () => {
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;

    const jsonRun = spawnSync(process.execPath, [CLI, 'resume', '--dir', REPO_ROOT, '--json'], {
      cwd: REPO_ROOT,
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(jsonRun.status, 0, `oxe-cc resume --json falhou:\n${jsonRun.stdout}\n${jsonRun.stderr}`);
    const data = JSON.parse(jsonRun.stdout);
    assert.equal(data.oxeResumeSchema, 1);
    assert.ok(data.active_session, 'resume deve detectar active_session no oxe-build');
    assert.ok(data.next_command, 'resume deve sugerir 1 próximo comando exato');

    const textRun = spawnSync(process.execPath, [CLI, 'resume', '--dir', REPO_ROOT], {
      cwd: REPO_ROOT,
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(textRun.status, 0, textRun.stdout + textRun.stderr);
    const nonEmptyLines = textRun.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    assert.ok(nonEmptyLines.length > 0 && nonEmptyLines.length <= 20, `oxe-cc resume texto deve ter < 20 linhas, teve ${nonEmptyLines.length}:\n${textRun.stdout}`);

    // SDK client.resume()
    const { createClient } = require(path.join(REPO_ROOT, 'lib/sdk/index.cjs'));
    const client = createClient(REPO_ROOT);
    assert.equal(typeof client.resume, 'function', 'client.resume() deve existir no SDK');
    const sdkRes = client.resume();
    assert.equal(sdkRes.oxeResumeSchema, 1);
    assert.equal(sdkRes.active_session, data.active_session);
  });
});
