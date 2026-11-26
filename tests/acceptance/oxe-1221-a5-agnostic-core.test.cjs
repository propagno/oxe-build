'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const op = require('../../bin/lib/oxe-operational.cjs');
const shipPr = require('../../bin/lib/oxe-ship-pr.cjs');
const envSanitize = require('../../bin/lib/oxe-env-sanitize.cjs');
const vitestBatch = require('../../bin/lib/oxe-vitest-batch.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkDir(prefix, cfg) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  fs.mkdirSync(path.join(d, '.oxe'), { recursive: true });
  if (cfg) fs.writeFileSync(path.join(d, '.oxe', 'config.json'), JSON.stringify(cfg, null, 2));
  return d;
}

describe('A5 (OB-29 / OXB-221-05): agnostic core decoupled from OXESpace heuristics via presets + ADR D-5', () => {
  it('generic project without brand-strict or src/design/targets triggers 0 BRD-n/marca/OXESPACE heuristics', () => {
    const genericDir = mkDir('oxe-a5-generic-', { preset: 'cli' });
    fs.mkdirSync(path.join(genericDir, 'src', 'components'), { recursive: true });

    const uiCardMd = [
      '# CARD-1 — Improve layout',
      '## Contexto',
      '- Alters src/components/Header.tsx',
      '## Critérios de aceite',
      '1. **CA-1** — Dado header, quando carrega, então exibe título com padding 12 px · Teste: header.test.tsx',
    ].join('\n');

    const gaps = op.uiCardGaps(uiCardMd, { kind: 'story', labels: [] }, { projectRoot: genericDir });
    assert.equal(gaps.isUi, false, `generic cli repo must not enforce BRD-n brand gate: ${JSON.stringify(gaps)}`);
    assert.deepEqual(gaps.gaps, []);

    const cs = shipPr.inspectRequiredCommitStatuses(genericDir, 'abc1234', {
      commitStatuses: [
        { context: 'marca/conformidade', state: 'failure', description: '2 enforced divergences' },
      ],
    });
    assert.equal(cs.ok, true, 'generic cli repo must not require marca/conformidade commit status');
    assert.deepEqual(cs.checked, []);
    assert.deepEqual(cs.failures, []);

    const envRes = envSanitize.sanitizeEnv(
      { OXESPACE_PORT: '9000', AI_MEMORY_DB: '/tmp/a', NODE_TEST_CONTEXT: '1', KEEP_ME: 'yes' },
      genericDir
    );
    assert.equal(envRes.env.NODE_TEST_CONTEXT, undefined, 'NODE_TEST_CONTEXT is always stripped');
    assert.equal(envRes.env.OXESPACE_PORT, '9000', 'cli preset must not strip OXESPACE_* by default');
    assert.equal(envRes.env.AI_MEMORY_DB, '/tmp/a', 'cli preset must not strip AI_MEMORY_* by default');
    assert.equal(envRes.env.KEEP_ME, 'yes');
  });

  it('brand-strict and desktop-mobile presets opt into brand gate, marca/conformidade, OXESPACE_* scrub, and noBatchPatterns', () => {
    const brandDir = mkDir('oxe-a5-brand-', { preset: 'brand-strict' });
    fs.mkdirSync(path.join(brandDir, 'src', 'components'), { recursive: true });

    const uiCardMd = [
      '# CARD-2 — Visual button polish',
      '## Contexto',
      '- Alters src/components/Button.tsx',
      '## Critérios de aceite',
      '1. **CA-1** — Dado botão, quando carrega, então renderiza cor primária · Teste: button.test.tsx',
    ].join('\n');

    const gaps = op.uiCardGaps(uiCardMd, { kind: 'story', labels: [] }, { projectRoot: brandDir });
    assert.equal(gaps.isUi, true);
    assert.ok(gaps.gaps.some((g) => /BRD-n/i.test(g)), `expected BRD-n gap under brand-strict: ${JSON.stringify(gaps)}`);

    const cs = shipPr.inspectRequiredCommitStatuses(brandDir, 'abc1234', {
      commitStatuses: [
        { context: 'marca/conformidade', state: 'failure', description: '3 enforced divergences' },
      ],
    });
    assert.equal(cs.ok, false, 'brand-strict must enforce marca/conformidade');
    assert.equal(cs.failures.length, 1);
    assert.equal(cs.failures[0].enforced_divergences, 3);

    const desktopDir = mkDir('oxe-a5-desktop-', { preset: 'desktop-mobile' });
    const envRes = envSanitize.sanitizeEnv(
      { OXESPACE_PORT: '9000', AI_MEMORY_DB: '/tmp/a', SAFE_VAR: 'ok' },
      desktopDir
    );
    assert.equal(envRes.env.OXESPACE_PORT, undefined);
    assert.equal(envRes.env.AI_MEMORY_DB, undefined);
    assert.equal(envRes.env.SAFE_VAR, 'ok');

    const batchedNormal = vitestBatch.batchVerifyCommand(
      'npm run test:unit -- a.test.js && npm run test:unit -- b.test.js',
      { noBatchPatterns: ['gradle152'] }
    );
    assert.equal(batchedNormal, 'npm run test:unit -- a.test.js b.test.js');

    const unbatchedGradle = vitestBatch.batchVerifyCommand(
      'npm run gradle152 -- a.test.js && npm run gradle152 -- b.test.js',
      { noBatchPatterns: ['gradle152'] }
    );
    assert.equal(unbatchedGradle, 'npm run gradle152 -- a.test.js && npm run gradle152 -- b.test.js');
  });

  it('publishes ADR D-5 formalizing agnostic core vs declarative presets in docs/adr/', () => {
    const adrDir = path.join(ROOT, 'docs', 'adr');
    const files = fs.readdirSync(adrDir);
    const d5 = files.find((f) => /^D-5-.*\.md$/i.test(f));
    assert.ok(d5, `ADR D-5-*.md not found in docs/adr/ (found: ${files.join(', ')})`);
    const readme = fs.readFileSync(path.join(adrDir, 'README.md'), 'utf8');
    assert.ok(readme.includes('D-5'), 'docs/adr/README.md must list D-5');
  });
});
