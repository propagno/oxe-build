'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dryRunVerifyCommands, classifyFailure } = require('../bin/lib/oxe-verify-dryrun.cjs');

// OXB-009 (OxeVoice F1): o verify da T1 tinha um esbuild sem `outdir` — reprovou 3 tentativas pagas do executor
// com código correto. O dry-run antes da execução exige "vermelho pelo motivo certo".

describe('dry-run dos comandos de verificação (vermelho pelo motivo certo)', () => {
  const dirs = [];
  after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

  it('classifica alvo ausente × comando quebrado pelo texto da falha', () => {
    assert.equal(classifyFailure("Could not resolve \"electron/main/services/voice/consent.ts\"", ['electron/main/services/voice/consent.ts']), 'missing_target');
    assert.equal(classifyFailure('Error: Failed to resolve import "../src/x/registry" from "t.test.ts". Does the file exist?', ['src/x/registry.ts']), 'missing_target');
    // O caso real: o comando quebra por configuração, sem nada ausente.
    assert.equal(classifyFailure('X [ERROR] Must use "outdir" when there are multiple input files', ['electron/main/services/voice/consent.ts']), 'broken_command');
    // Algo ausente, mas que não é alvo da tarefa (ex.: dependência não instalada) = quebrado.
    assert.equal(classifyFailure("Error: Cannot find module 'esbuild'", ['src/a.ts']), 'broken_command');
  });

  it('roda os comandos: quebrado é erro, já-verde é aviso, alvo ausente passa', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dryverify-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'exists.js'), 'module.exports = 1;\n');
    const plan = {
      tasks: [
        { id: 'T1', files: ['src/new.js'], verifyCommand: 'node -e "require(\'./src/new.js\')"' },
        { id: 'T2', files: ['src/other.js'], verifyCommand: 'node -e "process.exit(2)"' },
        { id: 'T3', files: ['exists.js'], verifyCommand: 'node -e "require(\'./exists.js\')"' },
        { id: 'T4', files: ['x.js'], verifyCommand: null },
        { id: 'T5', files: ['y.js'], verifyCommand: 'node -e "x"', done: true },
      ],
    };
    const result = dryRunVerifyCommands(dir, plan, { timeoutMs: 30_000 });
    const byTask = Object.fromEntries(result.results.map((r) => [r.task, r.verdict]));
    assert.deepEqual(byTask, { T1: 'missing_target', T2: 'broken_command', T3: 'already_green' });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /T2: comando de verificação falha por outro motivo/);
    assert.match(result.warnings.join('\n'), /T3: verificação já passa antes da tarefa/);
  });
});

describe('tarefa de correção: falha de asserção com alvo existente é vermelho certo (OXB-016)', () => {
  it('assertion_red só quando os alvos existem; erro de ferramenta continua broken_command', () => {
    assert.equal(classifyFailure('AssertionError: expected [ …(2) ] to deeply equal []', ['src/hook.ts'], { targetsExist: true }), 'assertion_red');
    assert.equal(classifyFailure(' FAIL  tests/a.test.ts > x\n× falhou', ['src/a.ts'], { targetsExist: true }), 'assertion_red');
    assert.equal(classifyFailure('AssertionError: expected 1 to be 2', ['src/hook.ts'], { targetsExist: false }), 'broken_command');
    assert.equal(classifyFailure('X [ERROR] Must use "outdir" when there are multiple input files\nAssertionError', ['a.ts'], { targetsExist: true }), 'broken_command');
  });
});
