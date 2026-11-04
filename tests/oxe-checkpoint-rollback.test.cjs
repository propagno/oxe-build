'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.20c: checkpoint de filesystem por tarefa (commit só do escopo dela) e rollback da tentativa falhada.

const hasGit = spawnSync('git', ['--version']).status === 0;
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const SPEC = '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | `node -e "process.exit(0)"` |\n';
const PLAN = '# PLAN\n\n### T1 — Primeira\n\n- **Arquivos alvo:** `src/a.js`\n- **Onda:** 1\n- **Verificar:**\n  - Comando: `node -e "process.exit(0)"`\n- **Aceite vinculado:** A1\n\n### T2 — Segunda\n\n- **Arquivos alvo:** `src/b.js`\n- **Onda:** 2\n- **Depende de:** T1\n- **Verificar:**\n  - Comando: `node -e "process.exit(0)"`\n- **Aceite vinculado:** A1\n';

function git(cwd, args) { return spawnSync('git', args, { cwd, encoding: 'utf8' }); }

function project() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-checkpoint-'));
  dirs.push(tmp);
  fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.oxe', 'SPEC.md'), SPEC);
  fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.md'), PLAN);
  fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(tmp, '.gitignore'), '.oxe/\n');
  fs.writeFileSync(path.join(tmp, 'unrelated.txt'), 'do usuário\n');
  git(tmp, ['init', '-q']);
  git(tmp, ['config', 'user.email', 't@t']);
  git(tmp, ['config', 'user.name', 't']);
  git(tmp, ['config', 'commit.gpgsign', 'false']);
  git(tmp, ['add', '.gitignore']);
  git(tmp, ['commit', '-qm', 'init']);
  return tmp;
}

const writer = {
  async execute(node, lease) {
    const file = node.id === 'T1' ? 'src/a.js' : 'src/b.js';
    fs.mkdirSync(path.join(lease.root_path, 'src'), { recursive: true });
    fs.writeFileSync(path.join(lease.root_path, file), `// ${node.id}\n`);
    return { success: true, failure_class: null, evidence: [file], output: 'ok' };
  },
};

describe('checkpoint por tarefa e rollback', { skip: !hasGit }, () => {
  it('commita só o escopo de cada tarefa concluída; arquivos alheios ficam fora', async () => {
    const tmp = project();
    fs.writeFileSync(path.join(tmp, 'unrelated.txt'), 'editado pelo usuário\n');
    await op.runRuntimeExecute(tmp, null, { executor: writer, skipPreflight: true, checkpointCommits: true });
    const log = git(tmp, ['log', '--format=%s']).stdout.trim().split('\n');
    assert.deepEqual(log, ['oxe(T2): Segunda', 'oxe(T1): Primeira', 'init']);
    assert.deepEqual(git(tmp, ['show', '--name-only', '--format=', 'HEAD~1']).stdout.trim().split('\n'), ['src/a.js']);
    assert.match(git(tmp, ['status', '--porcelain']).stdout, /unrelated\.txt/, 'o arquivo do usuário não entrou em commit nenhum');
  });

  it('rollback: dry-run por padrão; com --yes restaura e remove só o escopo da tarefa', async () => {
    const tmp = project();
    await op.runRuntimeExecute(tmp, null, { executor: writer, skipPreflight: true, checkpointCommits: true });
    // Uma tentativa "ruim" da T2 depois do checkpoint: edita b.js e cria um arquivo novo fora do escopo.
    fs.writeFileSync(path.join(tmp, 'src', 'b.js'), 'quebrado\n');
    fs.writeFileSync(path.join(tmp, 'src', 'extra.js'), 'fora do escopo\n');
    const dry = op.runtimeRollback(tmp, null, { task: 'T2' });
    assert.equal(dry.dry_run, true);
    assert.deepEqual(dry.actions, [{ file: 'src/b.js', action: 'restore' }]);
    assert.equal(fs.readFileSync(path.join(tmp, 'src', 'b.js'), 'utf8'), 'quebrado\n', 'dry-run não muda nada');
    op.runtimeRollback(tmp, null, { task: 'T2', yes: true });
    // autocrlf pode devolver CRLF no checkout (Windows): o conteúdo é o do checkpoint.
    assert.equal(fs.readFileSync(path.join(tmp, 'src', 'b.js'), 'utf8').replace(/\r\n/g, '\n'), '// T2\n');
    assert.ok(fs.existsSync(path.join(tmp, 'src', 'extra.js')), 'fora do escopo declarado nunca é tocado');
    assert.throws(() => op.runtimeRollback(tmp, null, { task: 'X' }), /--task/);
  });
});
