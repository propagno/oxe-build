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

  it('OxeSpace 16/11 (F6 + OQ): primitives/reuse lists, platform-tree scoping, reference clauses, test runners/docs, and frozen-header change verbs', () => {
    const repoFiles = [
      ...files,
      'mobile/android/app/src/main/java/com/oxespace/ui/EmptyState.kt',
      'src/ui/DockPanel.tsx',
      'src/ui/CodeRail.tsx',
      'src/components/Agent/AgentActivityBadge.tsx',
      'src/styles/tokens.generated.css',
      'src/tokens/css.ts',
      'src/design/motion.ts',
      'src/state/mode.ts',
      'docs/design/motion.md',
      'docs/security/ccr-h1-http-audit.md',
      'scripts/test-electron.mjs',
      'scripts/custom-verify.mjs',
      'tests/acceptance/f6-motion.test.ts',
      'tests/acceptance/f6-mutate.test.ts',
      'tests/acceptance/oq-audit.test.ts',
    ];
    const extraTexts = {
      ...texts,
      'tests/acceptance/f6-motion.test.ts': [
        '// Reads durations from src/design/motion.ts and spec in docs/design/motion.md',
        "import { DURATION } from '../../src/design/motion';",
        "describe('Toast inside CodeRail with src/state/mode.ts', () => { it('renders smoothly', () => {}); });",
      ].join('\n'),
      'tests/acceptance/f6-mutate.test.ts': [
        '// A18: CodeRail now collapses on Escape and adds aria-expanded',
        "describe('CodeRail collapse', () => { it('cria atalho de teclado em ChangesPanel', () => {}); });",
      ].join('\n'),
      'tests/acceptance/oq-audit.test.ts': [
        '// Audit check for docs/security/ccr-h1-http-audit.md',
        "describe('HTTP audit', () => { it('passes', () => {}); });",
      ].join('\n'),
    };
    const read = (f) => extraTexts[f] || '';

    // 1a + 1b: "primitives only" / "use ... primitives" / "from ... primitives" / "a partir de", and src/ never resolves PascalCase to mobile/android
    const doc1 = {
      tasks: [
        {
          id: 'T36',
          title: 'Chat empty view',
          notes: [
            'UI primitives only: DockPanel, CodeRail.',
            'Render EmptyState when thread has no messages.',
            'Construir layout a partir de DockPanel; reuse existing components from src/ui primitives.',
          ].join('\n'),
          files: ['src/components/Chat/ChatEmpty.tsx'],
        },
      ],
      acceptance_tests: [],
    };
    assert.deepEqual(cp.citedPathGaps('.', doc1, { files: repoFiles, readText: read }), []);

    // 2: Reference phrases ("names are the ... of X", "never a ... name of Y", "generated ones of", "conforme", "ver", "see", "per", "according to") count as reads
    const doc2 = {
      tasks: [
        {
          id: 'T56',
          notes: [
            'Token names are the keys of src/tokens/css.ts; only the generated ones of src/styles/tokens.generated.css.',
            'Never a raw class name of AgentActivityBadge.',
            'Implementar conforme docs/design/motion.md; see CodeRail; ver src/state/mode.ts; per docs/security/ccr-h1-http-audit.md; according to src/design/motion.ts.',
          ].join('\n'),
          files: ['src/components/Theme/ThemePreview.tsx'],
        },
      ],
      acceptance_tests: [],
    };
    assert.deepEqual(cp.citedPathGaps('.', doc2, { files: repoFiles, readText: read }), []);

    // Reference clause followed by a real out-of-scope mutation still catches the mutated target
    const doc2Mut = {
      tasks: [
        {
          id: 'T57',
          notes: 'Conforme docs/design/motion.md, alterar src/state/store.ts.',
          files: ['src/components/Theme/ThemePreview.tsx'],
        },
      ],
      acceptance_tests: [],
    };
    assert.deepEqual(cp.citedPathGaps('.', doc2Mut, { files: repoFiles, readText: read }).map((g) => g.file), ['src/state/store.ts']);

    // 3 + 4: scripts/test-*.mjs, verify command files, docs/**/*.md in frozen header, and frozen header imports without change verbs do NOT fire
    const doc3 = {
      tasks: [
        {
          id: 'T45',
          notes: 'Run via scripts/test-electron.mjs and scripts/custom-verify.mjs.',
          files: ['src/components/Toast/Toast.tsx'],
          verify: { commands: ['node scripts/custom-verify.mjs tests/acceptance/f6-motion.test.ts'] },
          acceptance: ['A45', 'AQ1'],
        },
      ],
      acceptance_tests: [
        { criterion: 'A45', task: 'T45', files: ['tests/acceptance/f6-motion.test.ts'] },
        { criterion: 'AQ1', task: 'T45', files: ['tests/acceptance/oq-audit.test.ts'] },
      ],
    };
    assert.deepEqual(cp.citedPathGaps('.', doc3, { files: repoFiles, readText: read }), []);

    // 4 (positive): frozen header WITH a change verb ("now", "cria") DOES flag out-of-scope components
    const doc4 = {
      tasks: [{ id: 'T58', files: ['src/components/Toast/Toast.tsx'], acceptance: ['A18'] }],
      acceptance_tests: [{ criterion: 'A18', task: 'T58', files: ['tests/acceptance/f6-mutate.test.ts'] }],
    };
    assert.deepEqual(
      cp.citedPathGaps('.', doc4, { files: repoFiles, readText: read }).map((g) => g.file).sort(),
      ['src/components/Changes/ChangesPanel.tsx', 'src/ui/CodeRail.tsx'],
    );
  });
});
