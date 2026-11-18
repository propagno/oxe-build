'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'oxe-cc.js');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function runCli(...args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
}

describe('OXB-C15 (Auditoria UX/CLI): --help nos subcomandos, quick --plain e consistência dos 5 workflows', () => {
  it('review/prd/decision/rfc/docs/plan --help saem com código 0 e ajuda específica do subcomando', () => {
    for (const [cmd, expectedRe] of [
      ['review', /oxe-cc review status/],
      ['prd', /oxe-cc prd lint/],
      ['decision', /oxe-cc decision add/],
      ['rfc', /oxe-cc rfc accept/],
      ['docs', /oxe-cc docs publish/],
      ['plan', /oxe-cc plan lint/],
    ]) {
      const r = runCli(cmd, '--help');
      assert.equal(r.status, 0, `${cmd} --help failed: ${r.stderr}\n${r.stdout}`);
      assert.doesNotMatch(r.stderr, /Opção desconhecida/);
      assert.match(r.stdout, expectedRe, `${cmd} --help output mismatch`);
    }
  });

  it('quick aceita --plain sem retornar Opção desconhecida', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c15-quick-'));
    dirs.push(tmp);
    const r = runCli('quick', 'status', '--dir', tmp, '--plain');
    assert.doesNotMatch(r.stderr, /Opção desconhecida: --plain/);
  });

  it('workflows execute/spec/plan/verify/ship trazem comandos, flags e referências atualizadas', () => {
    const wf = (name) => fs.readFileSync(path.join(ROOT, 'oxe', 'workflows', `${name}.md`), 'utf8');

    const execute = wf('execute');
    assert.match(execute, /oxe-cc runtime execute/);
    assert.match(execute, /oxe-cc runtime commit-task/);
    assert.match(execute, /OXE-Task/);
    assert.match(execute, /PLAN\.json/);
    assert.match(execute, /acceptance_tests/);
    assert.doesNotMatch(execute, /\boxe:(?:plan|quick)\b/);

    const spec = wf('spec');
    assert.match(spec, /oxe-cc alm push --stories-only --apply/);
    assert.match(spec, /oxe-cc grill fact --branch .* --text .* --source/);
    assert.match(spec, /grill defer <Q-n> --reason/);
    assert.match(spec, /grill term "<termo>" --definition/);
    assert.match(spec, /program close.*--by <papel> --reason/);
    assert.doesNotMatch(spec, /\boxe:(?:quick|discuss)\b/);

    const plan = wf('plan');
    assert.match(plan, /PLAN\.json/);
    assert.match(plan, /oxe-cc alm push --tasks-only --apply/);
    assert.match(plan, /oxe-cc decision add --title/);
    assert.match(plan, /oxe-cc rfc accept <RFC-n>/);

    const verify = wf('verify');
    assert.match(verify, /program close.*--by <papel> --reason/);
    assert.match(verify, /signoff.*--evidence <pasta>/);
    assert.doesNotMatch(verify, /\/oxe-project checkpoint/);

    const ship = wf('ship');
    assert.match(ship, /program close.*--by <papel> --reason/);
    assert.match(ship, /runtime feedback --class defect .*--tasks T<n> --reopen/);
  });
});
