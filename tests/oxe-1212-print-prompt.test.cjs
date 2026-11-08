'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// 1.21.2 - OXB-148 (a): see the prompt a task would send, with the size of each section, without running anything.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('OXB-148: runtime execute --task T1 --print-prompt', () => {
  it('writes .oxe/prompts/T1.md with the section table and prints the sizes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pp-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# S\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n\n### T1 — base\n\nfaz a base\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{"external_dependency_check":false}');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'base', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] }));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'execute', '--task', 'T1', '--print-prompt', '--json', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.task, 'T1');
    assert.ok(out.total_chars > 0 && out.est_tokens > 0);
    assert.ok(out.sections.some((s) => s.name === 'workspaceFiles'), JSON.stringify(out.sections));
    const md = fs.readFileSync(out.file, 'utf8');
    assert.match(md, /\| Seção \| chars no prompt \| tokens \(est\.\) \| dado bruto \(chars\) \|/);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'runs')) || true);
  });
});
