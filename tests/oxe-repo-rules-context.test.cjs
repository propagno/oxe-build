'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rules = require('../bin/lib/oxe-repo-rules.cjs');

// 1.21 · OXB-020: as regras que o repositório cobra sozinho entram no prompt de cada nó.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-rules-')); dirs.push(d); return d; }

function repo() {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'tests', 'integration'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'design-lint.test.ts'), [
    "describe('design lint', () => {",
    "  it('has no color literal outside shadows', () => {})",
    "  it(\"raw <button> outside the primitives does not grow; use <Button> or <IconButton>\", () => {})",
    "  it('has no color literal outside shadows', () => {})",
    '})',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'tests', 'integration', 'fs-allowlist.test.ts'), "test('only allowlisted files import node:fs', () => {})\n");
  fs.writeFileSync(path.join(dir, 'tests', 'feature.test.ts'), "it('feature detail that is not a repo rule', () => {})\n");
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
    '# Agents',
    '- Never touch AppData or the installed app.asar.',
    '- Conventional Commits in English, always.',
    '- A note without a directive keyword here.',
    '```',
    '- never inside a code fence',
    '```',
  ].join('\n'));
  return dir;
}

describe('repo rules', () => {
  it('coleta policy_rules, diretivas de AGENTS.md e títulos dos testes de governança', () => {
    const dir = repo();
    const config = { policy_rules: [{ id: 'no-fs', forbid: "from 'node:fs'", paths: '^src/', message: 'renderer não importa node:fs' }] };
    const out = rules.collectRepoRules(dir, { config });
    const bySource = (s) => out.filter((r) => r.source === s).map((r) => r.text);
    assert.deepEqual(bySource('.oxe/config.json'), ['renderer não importa node:fs (em ^src/) [no-fs]']);
    assert.deepEqual(bySource('AGENTS.md'), ['Never touch AppData or the installed app.asar.', 'Conventional Commits in English, always.']);
    assert.deepEqual(bySource('tests/design-lint.test.ts'), ['has no color literal outside shadows', 'raw <button> outside the primitives does not grow; use <Button> or <IconButton>']);
    assert.deepEqual(bySource('tests/integration/fs-allowlist.test.ts'), ['only allowlisted files import node:fs']);
    assert.equal(out.some((r) => /feature detail/.test(r.text)), false, 'testes de feature não são regras do repo');
  });

  it('repo_rules.disabled desliga; repo_rules.tests acrescenta arquivos', () => {
    const dir = repo();
    assert.deepEqual(rules.collectRepoRules(dir, { config: { repo_rules: { disabled: true } } }), []);
    const extra = rules.collectRepoRules(dir, { config: { repo_rules: { tests: ['tests/feature.test.ts'] } } });
    assert.ok(extra.some((r) => r.source === 'tests/feature.test.ts'));
  });

  it('o prompt do nó renderiza a seção Regras do repositório agrupada por fonte', () => {
    const runtime = require('../lib/runtime/index.js');
    const lines = runtime.renderNodeContext({ repoRules: [{ source: 'tests/design-lint.test.ts', text: 'use <Button>' }, { source: 'tests/design-lint.test.ts', text: 'no color literal' }] });
    const text = lines.join('\n');
    assert.match(text, /## Regras do repositório/);
    assert.match(text, /- `tests\/design-lint\.test\.ts`\n  - use <Button>\n  - no color literal/);
  });
});
