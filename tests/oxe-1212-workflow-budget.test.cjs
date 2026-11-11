'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const budget = require('../bin/lib/oxe-workflow-budget.cjs');

// 1.21.2 — OXB-132: size budget for workflows and personas, compact variants, the per-task context pack.

const ROOT = path.join(__dirname, '..');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('OXB-132: workflow size budget', () => {
  it('every workflow and persona is declared and within its class', () => {
    assert.deepEqual(budget.checkBudget(ROOT), []);
  });

  it('the budget test fails when a file passes its limit', () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-wb-'));
    dirs.push(fake);
    fs.mkdirSync(path.join(fake, 'oxe', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(fake, 'oxe', 'personas'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'oxe', 'workflows', 'a.md'), 'x\n'.repeat(250));
    fs.writeFileSync(path.join(fake, 'oxe', 'workflows', 'size-budget.json'), JSON.stringify({ files: { 'workflows/a.md': 's' } }));
    assert.match(budget.checkBudget(fake).join('\n'), /workflows\/a\.md: 251 linhas, acima do limite 200 do nível s/);
  });

  it('the compact variants are up to date and keep every command and gate the full one cites', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-compact-workflows.cjs'), '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    for (const name of fs.readdirSync(path.join(ROOT, 'oxe', 'workflows', 'compact'))) {
      const full = budget.citations(fs.readFileSync(path.join(ROOT, 'oxe', 'workflows', name), 'utf8'));
      const compact = budget.citations(fs.readFileSync(path.join(ROOT, 'oxe', 'workflows', 'compact', name), 'utf8'));
      const missing = [...full].filter((c) => !compact.has(c));
      assert.deepEqual(missing, [], `${name}: a variante compacta perdeu ${missing.join(', ')}`);
      assert.ok(budget.lineCount(fs.readFileSync(path.join(ROOT, 'oxe', 'workflows', 'compact', name), 'utf8')) < budget.lineCount(fs.readFileSync(path.join(ROOT, 'oxe', 'workflows', name), 'utf8')) / 2);
    }
  });

  it('auto picks the compact variant under 30% slack; on/off force it', () => {
    assert.equal(budget.chooseVariant('plan.md', {}, 0.2).variant, 'compact');
    assert.equal(budget.chooseVariant('plan.md', {}, 0.6).variant, 'full');
    assert.equal(budget.chooseVariant('plan.md', { context: { compact: 'on' } }, 0.9).variant, 'compact');
    assert.equal(budget.chooseVariant('plan.md', { context: { compact: 'off' } }, 0.1).variant, 'full');
    assert.equal(budget.chooseVariant('help.md', {}, 0.1).variant, 'full', 'no compact variant → the full one');
  });
});

describe('OXB-132: task context pack', () => {
  it('includes the task and its dependencies, excludes the others, and is far smaller than PLAN.json + pack', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `T${i + 1}`, title: `tarefa ${i + 1} ${'x'.repeat(300)}`, wave: 1 + Math.floor(i / 5), files: [`src/f${i}.ts`], acceptance: ['A1'], depends_on: i === 9 ? ['T3'] : i === 2 ? ['T1'] : [], verify: { commands: ['node -e 0'] } }));
    const doc = { schema_version: 1, tasks };
    const pack = { tasks: tasks.map((t) => ({ id: t.id, symbols: [{ name: `s${t.id}`, path: t.files[0] }], notes: 'y'.repeat(400) })) };
    const out = budget.taskContextPack(doc, pack, 'T10');
    assert.deepEqual(out.stats.tasks_included.sort(), ['T1', 'T10', 'T3']);
    assert.deepEqual(out.slice.pack.map((p) => p.id).sort(), ['T1', 'T10', 'T3']);
    assert.ok(out.stats.reduction >= 0.7, String(out.stats.reduction));
  });
});
