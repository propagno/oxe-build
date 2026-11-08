'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-041/044: `plan lint` said "ok" and `runtime execute` refused (PLAN.md missing; then 6 pack errors;
// then plan_self_evaluation_incomplete:9; then 2 more vector items). Lint now runs the execute preflight, dry, and
// lists every blocker at once.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const PLAN_JSON = { schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(0)"'] } }] };
const SELF_EVAL = `# PLAN

## Autoavaliação do Plano

**Melhor plano atual:** sim
**Confiança:** 95%
**Principais incertezas:** nenhuma
**Alternativas descartadas:** nenhuma
**Condição para replanejar:** spec muda

| Dimensão | Nota |
|---|---|
| Completude dos requisitos | 5 |
| Dependências conhecidas | 5 |
| Risco técnico | 5 |
| Impacto no código existente | 5 |
| Clareza da validação / testes | 5 |
| Lacunas externas / decisões pendentes | 5 |

<confidence_vector>
<global score="0.95"/>
<dimension name="requirements" score="0.95"/>
<dimension name="dependencies" score="0.95"/>
<dimension name="technical_risk" score="0.95"/>
<dimension name="code_impact" score="0.95"/>
<dimension name="validation" score="0.95"/>
<dimension name="open_gaps" score="0.95"/>
</confidence_vector>
`;

function project({ planMd = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-lp-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | manual |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(PLAN_JSON, null, 2));
  if (planMd != null) fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), planMd);
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, project_env_check: false }));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('OXB-041/044: plan lint runs the execute preflight', () => {
  it('only PLAN.json: lint is not ok (execute would refuse "PLAN.md ausente")', () => {
    const out = op.runtimePlanLint(project(), null, {});
    assert.equal(out.ok, false);
    assert.ok(out.errors.some((e) => /preflight: PLAN\.md ausente/.test(e)), out.errors.join('\n'));
  });

  it('a PLAN.md without the self-evaluation: ONE pass lists the whole contract (fields, rubric, vector with global and dims)', () => {
    const out = op.runtimePlanLint(project({ planMd: '# PLAN\n\n## Tarefas\n\n- T1\n' }), null, {});
    const text = out.errors.join('\n');
    assert.equal(out.ok, false);
    for (const needle of ['Alternativas descartadas', 'Condição para replanejar', 'Lacunas externas / decisões pendentes', '<global score=', 'open_gaps']) {
      assert.ok(text.includes(needle), `missing "${needle}" in:\n${text}`);
    }
  });

  it('a section without the vector: the message already names <global score> and every dimension', () => {
    const noVector = SELF_EVAL.replace(/<confidence_vector>[\s\S]*<\/confidence_vector>\n/, '');
    const out = op.runtimePlanLint(project({ planMd: noVector }), null, {});
    const text = out.errors.join('\n');
    assert.match(text, /sem bloco <confidence_vector> — ele precisa de <global score="0\.NN">/);
    assert.match(text, /requirements, dependencies, technical_risk, code_impact, validation e open_gaps/);
  });

  it('lint and the execute preflight agree: lint errors are exactly the preflight blockers', () => {
    for (const planMd of ['# PLAN\n', SELF_EVAL]) {
      const dir = project({ planMd });
      const lint = op.runtimePlanLint(dir, null, {});
      const pre = op.buildRuntimeExecutePreflight(dir, null, null);
      const lintPre = lint.errors.filter((e) => /^preflight: (plan_|project_env)/.test(e)).map((e) => e.replace(/^preflight: /, ''));
      const preBlockers = pre.blockers.filter((b) => !/^(execution_rationality|pending_gates):/.test(b));
      assert.deepEqual(lintPre, preBlockers, planMd.slice(0, 20));
    }
  });

  it('opt-out: --no-preflight / config plan_lint_preflight:false keeps the plan-only lint', () => {
    const out = op.runtimePlanLint(project(), null, { preflight: false });
    assert.ok(!out.errors.some((e) => /^preflight: PLAN\.md ausente/.test(e)));
  });
});

describe('phantom changes under core.autocrlf=true (found by e2e-program after OXB-067)', () => {
  it('a file restored by git checkout (CRLF) and rewritten with LF is not a change', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-eol-'));
    dirs.push(dir);
    const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    g('init', '-q');
    g('config', 'core.autocrlf', 'true');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'store.js'), "'use strict';\nmodule.exports = 1;\n");
    g('add', '-A');
    g('commit', '-qm', 'init');
    fs.writeFileSync(path.join(dir, 'src', 'store.js'), 'broken\n');
    g('checkout', 'HEAD', '--', 'src/store.js');
    fs.writeFileSync(path.join(dir, 'src', 'store.js'), "'use strict';\nmodule.exports = 1;\n");
    fs.writeFileSync(path.join(dir, 'src', 'new.js'), 'x\n');
    assert.deepEqual(op.projectStatusPaths(dir), ['src/new.js']);
    fs.writeFileSync(path.join(dir, 'src', 'store.js'), 'changed\n');
    assert.deepEqual(op.projectStatusPaths(dir).sort(), ['src/new.js', 'src/store.js']);
  });
});

describe('OXB-039 + 041: native_check runs in the execute preflight, not in plan lint', () => {
  it('a failing native_check blocks the preflight but is not run by lint', () => {
    const dir = project({ planMd: SELF_EVAL });
    fs.writeFileSync(path.join(dir, 'native.js'), "require('fs').writeFileSync('ran.txt', 'x'); process.exit(1);\n");
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, native_check: 'node native.js' }));
    const lint = op.runtimePlanLint(dir, null, {});
    assert.ok(!lint.errors.some((e) => /native_check/.test(e)), lint.errors.join('\n'));
    assert.equal(fs.existsSync(path.join(dir, 'ran.txt')), false, 'lint did not launch the native check');
    const pre = op.buildRuntimeExecutePreflight(dir, null, null);
    assert.ok(pre.blockers.some((b) => /native_check falhou/.test(b)), pre.blockers.join('\n'));
  });
});
