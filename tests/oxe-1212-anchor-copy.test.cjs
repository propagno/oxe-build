'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const anchorCopy = require('../bin/lib/oxe-anchor-copy.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-049: F1-T5 (icons) passed its frozen test, but 4 icons were Lucide copies without the Mandacaru marks
// and History was the clock, not the approved scrubber. The approved drawing was in playground/src/components/icons.ts.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const APPROVED = `export const History = () => (
  <svg viewBox="0 0 24 24"><path d="M4 12h16 M8 8v8" /><circle cx="12" cy="12" r="2" /></svg>
);
export const Mic = () => (
  <svg viewBox="0 0 24 24"><path d="M12 3v10" /></svg>
);
`;
const LUCIDE_CLOCK = APPROVED.replace('M4 12h16 M8 8v8', 'M12 6v6l4 2').replace('cx="12" cy="12" r="2"', 'cx="12" cy="12" r="10"');

const ANCHORS = (attrs = 'target="src/design/icons.tsx" symbols="History,Mic" compare="geometry"') => `# Anchors

<reference_anchors version="1" ready="true" status="ready">
  <anchor id="RA-01" task="T5" critical="true" status="resolved" source_type="local" path="playground/src/components/icons.ts" ${attrs} source_ref="external-ref: icons">
    <relevance>desenho aprovado</relevance>
    <action>copy</action>
  </anchor>
</reference_anchors>
`;

function project({ anchors = ANCHORS(), target } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-anc-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'playground', 'src', 'components'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'playground', 'src', 'components', 'icons.ts'), APPROVED);
  if (target != null) {
    fs.mkdirSync(path.join(dir, 'src', 'design'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'design', 'icons.tsx'), target);
  }
  fs.writeFileSync(path.join(dir, '.oxe', 'REFERENCE-ANCHORS.md'), anchors);
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | ícones | manual |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T5', title: 'ícones', wave: 1, files: ['src/design/icons.tsx'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(0)"'] } }] }));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const anchorOf = (dir) => anchorCopy.copyAnchors(fs.readFileSync(path.join(dir, '.oxe', 'REFERENCE-ANCHORS.md'), 'utf8'))[0];

describe('OXB-049: a copy anchor is checked against its source', () => {
  it('geometry: the Lucide clock in place of the approved History fails, naming the symbol; the faithful copy passes', () => {
    const wrong = project({ target: `import x from 'y';\n${LUCIDE_CLOCK.replace('export const History', 'export const History')}` });
    let res = anchorCopy.checkAnchor(wrong, anchorOf(wrong));
    assert.equal(res.ok, false);
    assert.match(res.problems.join('\n'), /RA-01 History: a geometria difere da fonte/);
    assert.doesNotMatch(res.problems.join('\n'), /Mic/, 'Mic was copied right');
    // Formatting and an added import do not matter; geometry does.
    const right = project({ target: `import x from 'y';\n\nexport const Mic = () => (<svg viewBox='0 0 24 24'><path d='M12 3v10'/></svg>);\nexport const History = () => (\n    <svg viewBox="0 0 24 24">\n      <path d="M4 12h16 M8 8v8"/>\n      <circle cx="12" cy="12" r="2"/>\n    </svg>\n);\n` });
    res = anchorCopy.checkAnchor(right, anchorOf(right));
    assert.deepEqual(res.problems, []);
    assert.equal(res.compared, 2);
  });

  it('exact mode and snippet_ref lines; a missing target or symbol is reported', () => {
    const exact = project({ anchors: ANCHORS('target="src/design/icons.tsx" symbols="Mic" compare="exact"'), target: APPROVED.replace('M12 3v10', 'M12 4v10') });
    assert.match(anchorCopy.checkAnchor(exact, anchorOf(exact)).problems.join('\n'), /RA-01 Mic: o trecho copiado difere da fonte/);
    const lines = project({ anchors: ANCHORS('target="src/design/icons.tsx" snippet_ref="lines 4-6" compare="exact"'), target: `// header\n${APPROVED.split('\n').slice(3, 6).join('\n')}\n` });
    assert.deepEqual(anchorCopy.checkAnchor(lines, anchorOf(lines)).problems, []);
    const none = project({});
    assert.match(anchorCopy.checkAnchor(none, anchorOf(none)).problems.join('\n'), /alvo src\/design\/icons\.tsx não encontrado/);
    const noSym = project({ target: 'export const Other = 1;\n' });
    assert.match(anchorCopy.checkAnchor(noSym, anchorOf(noSym)).problems.join('\n'), /History: não encontrado no alvo/);
  });

  it('the check joins the task\'s verify: the CLI command exits 1 on a wrong copy, 0 on the right one', () => {
    const dir = project({ target: LUCIDE_CLOCK });
    const parsed = anchorCopy.attachAnchorCopyChecks({ tasks: [{ id: 'T5', verifyCommand: 'npm test', files: [] }, { id: 'T6', verifyCommand: 'x' }] }, path.join(dir, '.oxe', 'PLAN.md'));
    assert.match(parsed.tasks[0].verifyCommand, /^npm test && node ".*oxe-anchor-copy\.cjs" --anchors ".*REFERENCE-ANCHORS\.md" --id RA-01$/);
    assert.equal(parsed.tasks[1].verifyCommand, 'x');
    const cmd = parsed.tasks[0].verifyCommand.split(' && ')[1];
    let r = spawnSync(cmd, { cwd: dir, shell: true, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /AssertionError: anchor RA-01 History: a geometria difere/);
    fs.writeFileSync(path.join(dir, 'src', 'design', 'icons.tsx'), APPROVED);
    r = spawnSync(cmd, { cwd: dir, shell: true, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  it('execute: a copy that does not match the source does not complete the task', async () => {
    const dir = project({});
    const executor = { async execute() {
      fs.mkdirSync(path.join(dir, 'src', 'design'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'design', 'icons.tsx'), LUCIDE_CLOCK);
      return { success: true, failure_class: null, evidence: ['src/design/icons.tsx'], output: 'ok', completed_by: 'finish_task' };
    } };
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true, maxRetries: 0 });
    assert.ok(!(res.result.completed || []).includes('T5'), JSON.stringify(res.result));
  });

  it('lint warns on a copy anchor without target', () => {
    const w = anchorCopy.lintCopyAnchors(ANCHORS('symbols="History"'), ['T5']).join('\n');
    assert.match(w, /âncora RA-01 \(copy\) sem target=/);
  });
});
