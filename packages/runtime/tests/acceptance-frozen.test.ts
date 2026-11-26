import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { compile, runCheck, sha256File } from '../src/verification/verification-compiler';
import { LlmTaskExecutor } from '../src/executor/llm-task-executor';
import type { LlmExecutorEvent, CompletionFn } from '../src/executor/llm-task-executor';
import { renderNodeContext } from '../src/executor/node-context';
import type { GraphNode } from '../src/compiler/graph-compiler';

// e2e real 1.19: o executor leu mal o requisito (createApi devolveu { handle } em vez da função),
// escreveu o próprio teste com a mesma leitura e o verify ficou verde. O aceite agora é do plano:
// escrito antes, congelado por hash, protegido do executor.

const ACCEPT = "const t=require('node:test');const a=require('node:assert');t('A1',()=>a.equal(typeof require('./api.js').createApi(), 'function'));\n";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-accept-'));
}

describe('teste de aceite congelado no verify', () => {
  test('gera check-accept-*, passa intacto e reprova adulterado/ausente/não congelado', async () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'accept.test.js'), ACCEPT);
      fs.writeFileSync(path.join(dir, 'api.js'), 'module.exports = { createApi: () => () => 1 };\n');
      const sha = sha256File(path.join(dir, 'accept.test.js'));
      const suite = compile(
        { objective: null, criteria: [] },
        { tasks: [], acceptanceTests: [{ criterion: 'A1', command: 'node --test accept.test.js', files: [{ path: 'accept.test.js', sha256: sha }] }] },
      );
      const check = suite.checks.find((c) => c.id === 'check-accept-a1')!;
      assert.equal(check.acceptance_ref, 'A1');
      assert.equal(check.type, 'unit');

      const ok = await runCheck(check, dir);
      assert.equal(ok.status, 'pass', `${ok.error} ${ok.stderr}`);

      // Implementação com a leitura errada: o aceite do plano reprova.
      fs.writeFileSync(path.join(dir, 'api.js'), 'module.exports = { createApi: () => ({ handle() {} }) };\n');
      assert.equal((await runCheck(check, dir)).status, 'fail');

      // core.autocrlf: frozen with LF, read back as CRLF — the same file, never "tampered" (OxeSpace 14/11, F3 close)
      fs.writeFileSync(path.join(dir, 'api.js'), 'module.exports = { createApi: () => () => 1 };\n');
      fs.writeFileSync(path.join(dir, 'accept.test.js'), ACCEPT.replace(/\n/g, '\r\n'));
      const crlf = await runCheck(check, dir);
      assert.notEqual(crlf.error, 'acceptance_tampered: accept.test.js');
      assert.equal(crlf.status, 'pass', `${crlf.error} ${crlf.stderr}`);
      fs.writeFileSync(path.join(dir, 'accept.test.js'), ACCEPT);

      // Executor "ajusta" o teste para passar: adulterado.
      fs.writeFileSync(path.join(dir, 'accept.test.js'), ACCEPT.replace("'function'", "'object'"));
      const tampered = await runCheck(check, dir);
      assert.equal(tampered.status, 'fail');
      assert.equal(tampered.error, 'acceptance_tampered: accept.test.js');

      fs.rmSync(path.join(dir, 'accept.test.js'));
      assert.equal((await runCheck(check, dir)).error, 'acceptance_missing: accept.test.js');

      const unlocked = { ...check, frozen_files: [{ path: 'api.js', sha256: null }] };
      assert.match(String((await runCheck(unlocked, dir)).error), /^acceptance_not_frozen: api\.js/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('executor não escreve o aceite do plano', () => {
  test('write_file em arquivo protegido é negado; outros arquivos passam', async () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'test', 'acceptance'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'test', 'acceptance', 'a1.test.js'), ACCEPT);
      let turn = 0;
      const complete: CompletionFn = async () => {
        turn += 1;
        if (turn === 1) {
          return {
            content: '',
            finish_reason: 'tool_calls',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'test\\acceptance\\a1.test.js', content: 'hacked' }) } },
              { id: 'c2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'api.js', content: 'ok' }) } },
              // P0-2: malformed JSON is an explicit error to the model, never {} in silence
              { id: 'c4', type: 'function', function: { name: 'write_file', arguments: '{"path": "api.js", "content": ' } },
              // cross-review 15/11: whitespace arguments are "no arguments", not malformed JSON
              { id: 'c5', type: 'function', function: { name: 'write_file', arguments: '   ' } },
              // cross-review 15/11: a different case reaches the same file on Windows/macOS
              ...(process.platform === 'win32' || process.platform === 'darwin'
                ? [{ id: 'c6', type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify({ path: 'TEST/Acceptance/A1.test.js', content: 'hacked' }) } }]
                : []),
            ],
            usage: { input_tokens: 100, output_tokens: 20 },
          };
        }
        return { content: 'done', usage: { input_tokens: 50, output_tokens: 5 }, finish_reason: 'tool_calls', tool_calls: [{ id: 'c3', type: 'function', function: { name: 'finish_task', arguments: '{"summary":"x"}' } }] };
      };
      const events: LlmExecutorEvent[] = [];
      const node: GraphNode = {
        id: 'T1', title: 'api', wave: 1, depends_on: [], workspace_strategy: 'inplace', mutation_scope: ['api.js'],
        actions: [{ type: 'generate_patch', targets: ['api.js'] }],
        verify: { must_pass: [], acceptance_refs: ['A1'], command: null },
        policy: { requires_human_approval: false, max_retries: 0 },
      };
      const exec = new LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, (e) => events.push(e), complete, {
        protectedPaths: ['test/acceptance/a1.test.js'],
      });
      const result = await exec.execute(node, {
        workspace_id: 'w', strategy: 'inplace', isolation_level: 'shared', branch: null, base_commit: null, root_path: dir, ttl_minutes: 5,
      }, 'r', 1);
      assert.equal(result.success, true);
      assert.equal(fs.readFileSync(path.join(dir, 'test', 'acceptance', 'a1.test.js'), 'utf8'), ACCEPT, 'aceite intacto');
      assert.equal(fs.readFileSync(path.join(dir, 'api.js'), 'utf8'), 'ok');
      const denied = events.find((e) => e.type === 'tool_denied' && e.detail?.reason === 'frozen_acceptance_test');
      assert.equal(denied?.detail?.reason, 'frozen_acceptance_test');
      assert.ok(events.some((e) => e.type === 'tool_denied' && e.detail?.reason === 'invalid_tool_arguments'), 'malformed JSON reported');
      assert.equal(events.filter((e) => e.type === 'tool_denied' && e.detail?.reason === 'invalid_tool_arguments').length, 1, 'whitespace arguments are not malformed');
      assert.equal(events.filter((e) => e.type === 'tool_call').length, events.filter((e) => e.type === 'tool_result').length, 'every tool_call has its tool_result');
      if (process.platform === 'win32' || process.platform === 'darwin') {
        assert.equal(events.filter((e) => e.type === 'tool_denied' && e.detail?.reason === 'frozen_acceptance_test').length, 2, 'case variant denied too');
      }
      const u = events.find((e) => e.type === 'executor_usage')?.detail as { input_tokens?: number; output_tokens?: number } | undefined;
      assert.equal(u?.input_tokens, 150);
      assert.equal(u?.output_tokens, 25);
      // the events carry the real attempt (it was a fixed 0)
      assert.ok(events.filter((e) => e.type === 'tool_call').every((e) => e.attempt === 1), JSON.stringify(events.filter((e) => e.type === 'tool_call').map((e) => e.attempt)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('o prompt traz o aceite como especificação executável', () => {
    const text = renderNodeContext({ acceptanceTests: [{ criterion: 'A1', path: 'test/acceptance/a1.test.js', command: 'node --test x', content: ACCEPT }] }).join('\n');
    assert.match(text, /## Testes de aceite do plano \(congelados\)/);
    assert.match(text, /- A1: `test\/acceptance\/a1\.test\.js` — `node --test x`/);
    assert.match(text, /typeof require\('\.\/api\.js'\)\.createApi\(\)/);
  });
});
