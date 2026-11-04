import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { shellInvocation, childProcessEnv } from '../src/executor/shell-argv';
import { BUILT_IN_TOOLS } from '../src/executor/built-in-tools';
import { runCheck } from '../src/verification/verification-compiler';

// Regressão do e2e "linkly" (Windows): `cmd /c` com re-quoting do Node quebrava `"..."` em
// grep/node -e e os agentes gastaram retries depurando o shell em vez do código.

describe('shell-argv — invocação portável', () => {
  test('win32 usa cmd /d /s /c "<cmd>" com argumentos verbatim', () => {
    const inv = shellInvocation('node -e "console.log(1)" && echo ok', 'win32');
    assert.equal(inv.file, 'cmd.exe');
    assert.deepEqual(inv.args, ['/d', '/s', '/c', '"node -e "console.log(1)" && echo ok"']);
    assert.equal(inv.windowsVerbatimArguments, true);
  });

  test('posix usa sh -c sem verbatim', () => {
    const inv = shellInvocation('echo "a b"', 'linux');
    assert.deepEqual([inv.file, ...inv.args], ['sh', '-c', 'echo "a b"']);
    assert.equal(inv.windowsVerbatimArguments, false);
  });

  test('childProcessEnv remove NODE_TEST_CONTEXT e preserva o resto', () => {
    const env = childProcessEnv({ NODE_TEST_CONTEXT: 'child-v8', PATH: '/bin' });
    assert.equal(env.NODE_TEST_CONTEXT, undefined);
    assert.equal(env.PATH, '/bin');
  });

  test('aspas duplas sobrevivem no run_command e no verify (plataforma atual)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-shell-'));
    try {
      fs.writeFileSync(path.join(tmp, 'README.md'), 'Use npm start para subir.\n', 'utf8');
      const cmd = 'node -e "const s=require(\'fs\').readFileSync(\'README.md\',\'utf8\'); if(!s.includes(\'npm start\')) process.exit(3); console.log(\'has npm start\')"';
      const out = await BUILT_IN_TOOLS.run_command.execute({ command: cmd }, tmp);
      assert.equal(out, 'has npm start');
      const result = await runCheck(
        { id: 'c', type: 'custom', command: cmd, evidence_type_expected: 'stdout', acceptance_ref: null, description: 'c' },
        tmp
      );
      assert.equal(result.status, 'pass', `${result.stderr}${result.error ?? ''}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('run_command não fica pendurado esperando stdin', async () => {
    const out = await BUILT_IN_TOOLS.run_command.execute(
      { command: 'node -e "process.stdin.resume(); process.stdin.on(\'end\', () => console.log(\'eof\'))"', timeout_ms: 10_000 },
      os.tmpdir()
    );
    assert.equal(out, 'eof');
  });
});
