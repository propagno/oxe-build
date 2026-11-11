'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const cu = require('../bin/lib/oxe-customize.cjs');

// 1.21.2 — OXB-146: workflow overlays per team and per person, reapplied on update, never dropped silently.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const WF = '# Workflow: demo\n\n## Contexto\n\nLer a SPEC.\n\n## Verificar\n\nRodar o verify.\n\n## Fechar\n\nAtualizar o STATE com {{oxe:canal}}.\n';

function project(pkgText = WF) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-cu-'));
  dirs.push(root);
  const pkg = path.join(root, '_pkg');
  write(pkg, 'demo.md', pkgText);
  write(root, '.oxe/workflows/demo.md', pkgText);
  return { root, pkg };
}

describe('OXB-146: workflow overlays', () => {
  it('points come from the headings; precedence personal > team > package; rules and fields', () => {
    assert.deepEqual(cu.points(WF).filter((p) => p.startsWith('after:')), ['after:contexto', 'after:verificar', 'after:fechar']);
    const { root, pkg } = project();
    write(root, '.oxe/custom/demo.json', JSON.stringify({ extensions: [{ point: 'after:verificar', text: 'Equipe: rodar também o lint.' }, { point: 'before:fechar', text: 'Equipe: avisar no canal.' }], rules: ['nunca push direto na main'], fields: { canal: '#oxe-time' } }));
    write(root, '.oxe/custom/demo.user.json', JSON.stringify({ extensions: [{ point: 'after:verificar', text: 'Pessoal: rodar só o lint rápido.' }] }));
    const out = cu.applyAll(root, { pkgDir: pkg });
    const text = fs.readFileSync(path.join(root, '.oxe', 'workflows', 'demo.md'), 'utf8');
    assert.match(text, /## Verificar\n\nRodar o verify\.\n\n<!-- oxe-custom: after:verificar \(pessoal\) -->\nPessoal: rodar só o lint rápido\./);
    assert.doesNotMatch(text, /Equipe: rodar também o lint/, 'personal wins on the same point');
    assert.match(text, /Equipe: avisar no canal\.\n\n## Fechar/);
    assert.match(text, /Atualizar o STATE com #oxe-time\./);
    assert.match(text, /## Regras extras do projeto[\s\S]*nunca push direto na main/);
    assert.equal(out.decisions.length, 0);
  });

  it('an update where the point was renamed stops and lists the overlay; nothing dropped silently', () => {
    const { root, pkg } = project();
    write(root, '.oxe/custom/demo.json', JSON.stringify({ extensions: [{ point: 'after:verificar', text: 'Equipe: rodar também o lint.' }] }));
    write(pkg, 'demo.md', WF.replace('## Verificar', '## Validar'));
    const out = cu.applyAll(root, { pkgDir: pkg });
    assert.equal(out.decisions.length, 1);
    assert.deepEqual([out.decisions[0].point, out.decisions[0].options.length], ['after:verificar', 3]);
    assert.ok(JSON.parse(fs.readFileSync(path.join(root, '.oxe', 'custom', 'demo.json'), 'utf8')).extensions.length === 1, 'the overlay file is untouched');
  });

  it('a direct edit of the installed copy is detected by hash and migrated to an overlay', () => {
    const { root, pkg } = project();
    cu.applyAll(root, { pkgDir: pkg });
    const f = path.join(root, '.oxe', 'workflows', 'demo.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Rodar o verify.', 'Rodar o verify.\nTambém rodar o typecheck do monorepo.'));
    assert.deepEqual(cu.directEdits(root), ['demo.md']);
    const m = cu.migrate(root, { pkgDir: pkg });
    assert.deepEqual(m[0].migrated, ['after:verificar']);
    const team = JSON.parse(fs.readFileSync(path.join(root, '.oxe', 'custom', 'demo.json'), 'utf8'));
    assert.equal(team.extensions[0].text, 'Também rodar o typecheck do monorepo.');
    assert.deepEqual(cu.directEdits(root), [], 'after migrating, the copy is the applied one');
    assert.match(fs.readFileSync(f, 'utf8'), /oxe-custom: after:verificar \(equipe\)/);
  });

  it('customize edit refuses a point that does not exist in the packaged workflow', () => {
    const { root } = project();
    const r = spawnSync(process.execPath, [CLI, 'customize', 'edit', 'plan', '--point', 'after:nao-existe', '--text', 'x', '--dir', root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ponto after:nao-existe não existe em plan/);
  });
});
