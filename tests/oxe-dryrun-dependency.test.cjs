'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dryRunVerifyCommands } = require('../bin/lib/oxe-verify-dryrun.cjs');

// 1.21 · OXB-027 (projeto de referência mdlint): o teste da T2 importa o módulo da T1, ainda pendente. "Cannot find
// module" do arquivo da dependência é vermelho pelo motivo certo, não comando quebrado.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('dry-verify com dependência pendente', () => {
  it('módulo ausente de uma dependência pendente é missing_target; de nenhuma tarefa continua broken_command', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dryrun-dep-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'test', 't2.test.js'), "require('../src/parse.js'); require('../src/rules/a.js');\n");
    fs.writeFileSync(path.join(dir, 'test', 't3.test.js'), "require('../src/unplanned.js');\n");
    const plan = {
      tasks: [
        { id: 'T1', files: ['src/parse.js'], verifyCommand: null, dependsOn: [] },
        { id: 'T2', files: ['src/rules/a.js'], verifyCommand: 'node --test test/t2.test.js', dependsOn: ['T1'] },
        { id: 'T3', files: ['src/rules/b.js'], verifyCommand: 'node --test test/t3.test.js', dependsOn: ['T1'] },
      ],
    };
    const out = dryRunVerifyCommands(dir, plan, { timeoutMs: 60000 });
    const by = Object.fromEntries(out.results.map((r) => [r.task, r.verdict]));
    assert.equal(by.T2, 'missing_target');
    assert.equal(by.T3, 'broken_command', 'um módulo que nenhuma tarefa cria continua sendo plano quebrado');
  });
});
