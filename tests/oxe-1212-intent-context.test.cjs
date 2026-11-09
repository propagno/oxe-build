'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const decisions = require('../bin/lib/oxe-decisions.cjs');
const ic = require('../bin/lib/oxe-intent-context.cjs');

// 1.21.2 — OXB-142: the task context keeps the intent in full and points at what the code already says.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CODE = `function login(user, pass) {\n${'  // linha copiada do repositório\n'.repeat(30)}}\n`;

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ic-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | o login bloqueia após 5 tentativas | teste |\n');
  write(dir, '.oxe/config.json', JSON.stringify({ policy_rules: [{ id: 'no-console', forbid: 'console\\.log', paths: ['src/**'], message: 'sem console.log em src' }, { id: 'docs-only', forbid: 'x', paths: ['docs/**'] }] }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [
    { id: 'T1', title: 'bloqueio de login', wave: 1, files: ['src/auth.ts'], acceptance: ['A1'], decisions: ['D-1'], verify: { commands: ['npm test -- auth'] }, description: `Copiar:\n\`\`\`ts\n${CODE}\`\`\`` },
    { id: 'T2', title: 'outra', wave: 1, files: ['src/x.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
  ] }));
  write(dir, '.oxe/IMPLEMENTATION-PACK.json', JSON.stringify({ tasks: [{ id: 'T1', symbols: [{ name: 'login', path: 'src/auth.ts', snippet: CODE }], snippet: CODE, rationale: 'o bloqueio é por conta, não por IP' }, { id: 'T2', symbols: [], snippet: CODE }] }));
  decisions.add(path.join(dir, '.oxe', 'program'), { title: 'Bloqueio por conta, não por IP', by: 'tl', alternatives: ['bloqueio por IP::quebra NAT corporativo'] });
  return dir;
}

describe('OXB-142: intent vs derivable', () => {
  it('the context pack carries every decision and rule of the task, pointers with a trigger, and no code copied', () => {
    const dir = project();
    const out = op.runtimeContextPack(dir, null, { task: 'T1', explain: true });
    const s = out.slice;
    assert.ok(s.intent.some((x) => x.type === 'decision' && x.id === 'D-1' && x.alternatives[0].text === 'bloqueio por IP'));
    assert.ok(s.intent.some((x) => x.type === 'rule' && x.id === 'no-console'));
    assert.ok(!s.intent.some((x) => x.id === 'docs-only'), 'a rule on other paths does not enter');
    assert.ok(s.intent.some((x) => x.type === 'criterion' && /5 tentativas/.test(x.text)));
    assert.ok(s.pointers.some((p) => p.pointer === 'src/auth.ts#login' && /antes de mudar ou chamar login, abra src\/auth\.ts/.test(p.trigger)));
    assert.ok(s.pointers.every((p) => !/consulte se/.test(p.trigger)));
    assert.ok(!JSON.stringify(s.pack).includes('linha copiada'), 'no code from the repository in the pack slice');
    assert.ok(out.explain.some((x) => x.kind === 'intent' && x.why === 'citada pela tarefa'));
    assert.ok(out.stats.pack_chars < out.stats.task_pack_chars_before * 0.5, `${out.stats.pack_chars} vs ${out.stats.task_pack_chars_before}`);
  });

  it('plan lint warns derivable_inlined and intent without a source', () => {
    const dir = project();
    const w = op.runtimePlanLint(dir, null, {}).warnings;
    assert.ok(w.some((x) => /derivable_inlined: T1\.description traz um bloco de código/.test(x)), w.join('\n'));
    assert.ok(w.some((x) => /derivable_inlined: pack T1\.snippet copia/.test(x)));
    assert.ok(w.some((x) => /intent sem fonte: pack T1\.rationale/.test(x)));
    assert.deepEqual(ic.lint({ tasks: [{ id: 'T9', description: 'sem código' }] }, { tasks: [{ id: 'T9', rationale: 'x', source: 'D-2' }] }), []);
  });
});
