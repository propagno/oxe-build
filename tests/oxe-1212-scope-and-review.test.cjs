'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const testScope = require('../bin/lib/oxe-test-scope.cjs');
const reviewLib = require('../bin/lib/oxe-plan-review.cjs');
const rigorLib = require('../bin/lib/oxe-test-rigor.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sr-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

describe('1.21.2: oxe-test-scope alias resolution (tsconfig/jsconfig + package.json#imports)', () => {
  it('resolves JSONC tsconfig extends + references + multi-target paths + specificity + $ segments without flagging npm packages', () => {
    const dir = mkDir({
      'package.json': JSON.stringify({
        name: 'demo',
        dependencies: { react: '^18.0.0', '@testing-library/react': '^14.0.0' },
        imports: {
          '#db/*': './src/db/*',
          '#env': { node: './src/config/env.ts', default: './src/config/env.ts' },
        },
      }),
      'tsconfig.base.json': [
        '{',
        '  // schema URL has // inside a string and must stay intact',
        '  "$schema": "https://json.schemastore.org/tsconfig",',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        '      "@/*": ["./src/*", "./shared/*"], /* trailing comma below */',
        '      "@/special/*": ["./vendor/special/*"],',
        '      "@test/*": ["./tests/*"],',
        '    },',
        '  },',
        '}',
      ].join('\n'),
      'tsconfig.app.json': [
        '{',
        '  "extends": "./tsconfig.base",',
        '  "compilerOptions": {',
        '    "paths": {',
        '      "~renderer/*": ["electron/renderer/*"],',
        '    },',
        '  },',
        '}',
      ].join('\n'),
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }],
      }),
      'src/services/auth.ts': 'export const login = () => true;\n',
      'shared/types/ipc.ts': 'export const CHANNELS = [];\n',
      'vendor/special/token.ts': 'export const TOKEN = 1;\n',
      'electron/renderer/routes/$layout.tsx': 'export const Layout = () => null;\n',
      'src/db/client.ts': 'export const db = {};\n',
      'src/config/env.ts': 'export const ENV = "test";\n',
      'tests/helpers/render.ts': 'export const renderApp = () => {};\n',
      'tests/acceptance/f4/login.test.ts': [
        "import fs from 'node:fs';",
        "import { readFile } from 'fs/promises';",
        "import React from 'react';",
        "import { render } from '@testing-library/react';",
        "import { describe, it } from 'vitest';",
        "import { renderApp } from '@test/helpers/render';",
        "import { login } from '@/services/auth';",
        "import { CHANNELS } from '@/types/ipc';",
        "import { TOKEN } from '@/special/token';",
        "import { Layout } from '~renderer/routes/$layout';",
        "import { db } from '#db/client';",
        "const env = require('#env');",
      ].join('\n'),
    });

    const req = testScope
      .testRequirements(dir, 'tests/acceptance/f4/login.test.ts')
      .map((r) => `${r.kind}:${r.path}`)
      .sort();

    assert.deepEqual(req, [
      'import:electron/renderer/routes/$layout.tsx',
      'import:shared/types/ipc.ts',
      'import:src/config/env.ts',
      'import:src/db/client.ts',
      'import:src/services/auth.ts',
      'import:vendor/special/token.ts',
    ]);
  });

  it('matches yet-to-be-created aliased files against declared task files and honors camelCase dependsOn', () => {
    const dir = mkDir({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          paths: { '@/*': ['./src/*', './shared/*'] },
        },
      }),
      'tests/acceptance/f4/widget.test.ts': [
        "import { Widget } from '@/components/Widget';",
        "import { bus } from '@/events/bus';",
      ].join('\n'),
    });

    const planWithGap = {
      tasks: [
        { id: 'T1', files: ['shared/events/bus.ts'] },
        { id: 'T2', files: ['src/components/Widget.tsx'], acceptance: ['A1'] },
      ],
      acceptance_tests: [{ criterion: 'A1', task: 'T2', files: ['tests/acceptance/f4/widget.test.ts'] }],
    };
    const gaps = testScope.scopeGaps(dir, planWithGap);
    assert.deepEqual(gaps.T2.files, ['shared/events/bus.ts']);

    const planOrdered = {
      tasks: [
        { id: 'T1', files: ['shared/events/bus.ts'] },
        { id: 'T2', dependsOn: ['T1'], files: ['src/components/Widget.tsx'], acceptance: ['A1'] },
      ],
      acceptance_tests: planWithGap.acceptance_tests,
    };
    assert.deepEqual(testScope.scopeGaps(dir, planOrdered), {});
  });

  it('prevents false source-assertion rigor errors when a frozen test reads source AND imports product via @/ alias', () => {
    const dir = mkDir({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@/*': ['./src/*'] } },
      }),
      'src/services/pairing.ts': 'export function pair() { return true; }\n',
      'tests/acceptance/f4/pairing.test.ts': [
        "import fs from 'node:fs';",
        "import { pair } from '@/services/pairing';",
        "const raw = fs.readFileSync('src/services/pairing.ts', 'utf8');",
      ].join('\n'),
    });

    const doc = {
      tasks: [{ id: 'T1', files: ['src/services/pairing.ts'], acceptance: ['A1'] }],
      acceptance_tests: [{ criterion: 'A1', task: 'T1', files: ['tests/acceptance/f4/pairing.test.ts'] }],
    };
    assert.deepEqual(rigorLib.sourceAssertionFindings(dir, doc), []);
  });
});

describe('1.21.2: oxe-plan-review coupling and verification precision', () => {
  it('flags unordered directory-vs-file overlap, ignores duplicate entries on the same task and verify_only tasks, and links aliased scopeGaps to directory owners', () => {
    const dir = mkDir({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@/*': ['./src/*'] } },
      }),
      'src/pairing/PairingFlow.kt': 'class PairingFlow\n',
      'src/shared/ipc.ts': 'export const ipc = 1;\n',
      'tests/acceptance/f4/pairing.test.ts': 'export {};\n',
      'tests/acceptance/f4/ui.test.ts': "import { ipc } from '@/shared/ipc';\n",
    });

    const doc = {
      tasks: [
        {
          id: 'T1',
          title: 'pairing dir',
          files: ['src/pairing', './src/pairing'],
          acceptance: ['A1'],
          verify: { commands: ['npx vitest run pairing.test.ts'] },
        },
        {
          id: 'T2',
          title: 'pairing file',
          files: ['src/pairing/PairingFlow.kt'],
          acceptance: ['A1'],
          verify: { commands: ['node -e 0'] },
        },
        {
          id: 'T3',
          title: 'shared dir owner',
          files: ['src/shared/'],
          acceptance: ['A1'],
          verify: { commands: ['node -e 0'] },
        },
        {
          id: 'T4',
          title: 'ui consumer missing dep on T3',
          dependsOn: ['T1', 'T2'],
          files: ['src/ui/panel.ts'],
          acceptance: ['A2'],
          verifyCommand: 'npx vitest run tests/acceptance/f4',
        },
        {
          id: 'T5',
          title: 'verify only observer',
          kind: 'verify_only',
          files: ['src/pairing/PairingFlow.kt'],
          acceptance: ['A1'],
        },
        {
          id: 'T10',
          title: 'superseded task',
          done: true,
          status: 'done',
          files: ['src/chat.ts'],
          acceptance: [],
          superseded: { by_phase: 'AG-10', acceptance: ['A11'] },
        },
      ],
      acceptance_tests: [
        {
          criterion: 'A1',
          task: 'T1',
          files: ['tests/acceptance/f4/pairing.test.ts'],
        },
        {
          criterion: 'A2',
          task: 'T4',
          files: [{ path: 'tests/acceptance/f4/ui.test.ts', sha256: 'abc' }],
        },
      ],
    };

    const rev = reviewLib.review(dir, doc, { phaseCriteria: ['A1', 'A2', 'A11'] });
    assert.equal(rev.dimensions.coverage.verdict, 'PASS', JSON.stringify(rev.dimensions.coverage.findings));
    assert.equal(rev.dimensions.coupling.verdict, 'FAIL');
    const texts = rev.dimensions.coupling.findings.map((f) => f.text);
    assert.ok(texts.some((t) => /T1 e T2 mexem em src\/pairing\/PairingFlow\.kt \(via src\/pairing\)/.test(t)), texts.join('\n'));
    assert.ok(!texts.some((t) => /T1 e T1|T5/.test(t)), 'no self-coupling or verify_only write-coupling');
    assert.ok(texts.some((t) => /T4: o teste congelado precisa de src\/shared\/ipc\.ts, que T3 entrega/.test(t)), texts.join('\n'));
    // T4 uses verifyCommand with a directory argument ('tests/acceptance/f4') and object files[] → verification PASS!
    assert.equal(rev.dimensions.verification.verdict, 'PASS', JSON.stringify(rev.dimensions.verification.findings));
  });

  it('rejects unrelated path-qualified index.test.ts or substring basename collisions in verification', () => {
    const dir = mkDir({
      'src/app.ts': 'export const app = 1;\n',
      'tests/acceptance/f4/index.test.ts': "import '../../src/app';\n",
      'tests/acceptance/f4/a1.test.ts': "import '../../src/app';\n",
    });

    const badVerifyPlan = {
      tasks: [
        {
          id: 'T1',
          title: 'wrong index test',
          files: ['src/app.ts'],
          acceptance: ['A1'],
          verify: { commands: ['npx vitest run src/unit/index.test.ts'] },
        },
        {
          id: 'T2',
          title: 'substring test name',
          depends_on: ['T1'],
          files: ['src/app.ts'],
          aceite: ['A2'],
          verify: { commands: ['npx vitest run tests/unit/other-a1.test.ts'] },
        },
      ],
      acceptance_tests: [
        { criterion: 'A1', task: 'T1', files: ['tests/acceptance/f4/index.test.ts'] },
        { criterion: 'A2', task: 'T2', files: ['tests/acceptance/f4/a1.test.ts'] },
      ],
    };

    const rev = reviewLib.review(dir, badVerifyPlan, { phaseCriteria: ['A1', 'A2'] });
    assert.equal(rev.dimensions.verification.verdict, 'FAIL');
    assert.equal(rev.dimensions.verification.findings.length, 2);
  });
});
