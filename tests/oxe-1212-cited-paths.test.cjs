'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('../bin/lib/oxe-cited-paths.cjs');

// G44 (OxeSpace 15/11, OxeCode F6 T34, ~US$ 20): the notes named "the ChangesPanel wait", the frozen brd15 case
// asserted its skeleton, and src/components/Changes/ChangesPanel.tsx was not in the task's files.

const files = ['src/components/Changes/ChangesPanel.tsx', 'src/ui/Skeleton.tsx', 'src/a/Button.tsx', 'src/b/Button.tsx', 'tests/acceptance/brd15.test.tsx', 'src/state/store.ts'];
const texts = {
  'tests/acceptance/brd15.test.tsx': "// brd15: o ChangesPanel mostra o Skeleton enquanto espera\nimport { render } from '@testing-library/react';\ndescribe('ChangesPanel loading', () => { it('shows the skeleton from the wait', () => {}); });\n",
};
const readText = (f) => texts[f] || '';

describe('G44: a cited path or component out of the task scope', () => {
  it('a component named in the notes or the frozen header resolving to one file is named', () => {
    const doc = {
      tasks: [{ id: 'T34', title: 'loading', notes: 'Loading: the src/ui Skeleton (Changes: the Suspense fallback and the ChangesPanel wait)', files: ['src/ui/Skeleton.tsx'], acceptance: ['A15'] }],
      acceptance_tests: [{ criterion: 'A15', task: 'T34', files: ['tests/acceptance/brd15.test.tsx'] }],
    };
    const found = cp.citedPathGaps('.', doc, { files, readText });
    assert.deepEqual(found.map((f) => [f.task, f.file, f.cited]), [['T34', 'src/components/Changes/ChangesPanel.tsx', 'ChangesPanel']]);
    assert.match(cp.citedPathMessages(found, { level: 'error' }).errors[0], /T34 cita ChangesPanel \(src\/components\/Changes\/ChangesPanel\.tsx\).*read_only.*\[G44\]/);
  });

  it('in files, in an ancestor, declared read_only, ambiguous, or done: nothing', () => {
    const base = { acceptance_tests: [] };
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes: 'the ChangesPanel wait', files: ['src/components/Changes/ChangesPanel.tsx'] }] }, { files, readText }).length, 0);
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T0', files: ['src/components/Changes'] }, { id: 'T1', notes: 'the ChangesPanel wait', depends_on: ['T0'], files: ['x.ts'] }] }, { files, readText }).length, 0);
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes: 'reads src/state/store.ts', read_only: ['src/state/store.ts'], files: ['x.ts'] }] }, { files, readText }).length, 0);
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes: 'the Button looks right', files: ['x.ts'] }] }, { files, readText }).length, 0, 'two Button files: ambiguous');
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', done: true, notes: 'the ChangesPanel wait', files: ['x.ts'] }] }, { files, readText }).length, 0);
    assert.deepEqual(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes: 'touches src/state/store.ts', files: ['x.ts'] }] }, { files, readText }).map((f) => f.file), ['src/state/store.ts'], 'an explicit path counts');
  });

  it('R51: a scope boundary, a sibling of the same criterion, a builtin or a package segment never counts', () => {
    const base = { acceptance_tests: [] };
    for (const notes of ['Não alterar ChangesPanel (fica para T35).', 'Fora do escopo: ChangesPanel', 'Do not touch src/state/store.ts', 'sem tocar em ChangesPanel']) {
      assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes, files: ['x.ts'] }] }, { files, readText }).length, 0, notes);
    }
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes: 'Não alterar ChangesPanel. Ajustar src/state/store.ts', files: ['x.ts'] }] }, { files, readText }).map((f) => f.file).join(), 'src/state/store.ts', 'only the boundary sentence is dropped');
    const shared = {
      tasks: [{ id: 'T1', files: ['src/api/changes.ts'], acceptance: ['A15'] }, { id: 'T2', files: ['src/components/Changes/ChangesPanel.tsx'], acceptance: ['A15'] }],
      acceptance_tests: [{ criterion: 'A15', files: ['tests/acceptance/brd15.test.tsx'] }],
    };
    assert.equal(cp.citedPathGaps('.', shared, { files, readText }).length, 0, 'T2 owns it for the shared criterion');
    // R52: the sibling done mid-phase still owns it; an abbreviation does not split the boundary sentence
    const sharedDone = { ...shared, tasks: [shared.tasks[0], { ...shared.tasks[1], done: true }] };
    assert.equal(cp.citedPathGaps('.', sharedDone, { files, readText }).length, 0);
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes: 'Não alterar p.ex. ChangesPanel.', files: ['x.ts'] }] }, { files, readText }).length, 0);
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes: 'Do not touch e.g. ChangesPanel.', files: ['x.ts'] }] }, { files, readText }).length, 0);
    const shim = [...files, 'src/polyfills/ResizeObserver.ts'];
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes: 'reage ao ResizeObserver', files: ['x.ts'] }] }, { files: shim, readText }).length, 0);
    assert.equal(cp.citedPathGaps('.', { ...base, tasks: [{ id: 'T1', notes: 'usa @scope/ChangesPanel', files: ['x.ts'] }] }, { files, readText }).length, 0);
    assert.match(cp.testHeader("it(\"ChangesPanel's skeleton waits\", () => {});"), /ChangesPanel's skeleton/);
    assert.match(cp.testHeader("/*\n  brd15: ChangesPanel wait\n*/\nimport {\n  render,\n} from 'x';\n// SecondNote here\nconst a = 1;"), /brd15: ChangesPanel wait[\s\S]*SecondNote/);
  });
});
