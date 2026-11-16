'use strict';

// OxeSpace 15/11 (1.5.2 F6, T34 then T35): tasks that converted raw <button>s passed their verify and failed the
// checkpoint on brd-01/brd-03 because the design-lint cap stayed above the real count; each cap-down quick then made
// later tasks' plan stale. lint.ratchets lowers the cap in the task's own commit, the prompt names it, and a cap-only
// change is not plan_stale.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ratchets = require('../bin/lib/oxe-ratchets.cjs');
const staleness = require('../bin/lib/oxe-plan-staleness.cjs');

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', windowsHide: true });

const CAP_FILE = 'tests/design-lint.test.ts';
const config = {
  lint: {
    ratchets: [{
      file: CAP_FILE,
      pattern: 'count\\(tsx, /<button\\\\b/g\\)\\)\\.toBeLessThanOrEqual\\((\\d+)\\)',
      counts: '<button\\b',
      paths: ['src/**/*.tsx'],
      exclude: ['src/ui/**'],
    }],
  },
};
const capText = (n) => [
  "it('ratchets', () => {",
  "  expect(count(tsx, /role=\"alert\"/g)).toBeLessThanOrEqual(0)",
  `  expect(count(tsx, /<button\\b/g)).toBeLessThanOrEqual(${n})`,
  '})',
  '',
].join('\n');

function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ratchet-'));
  dirs.push(d);
  git(d, 'init', '-q');
  git(d, 'config', 'user.email', 't@t');
  git(d, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(d, 'src', 'ui'), { recursive: true });
  fs.mkdirSync(path.join(d, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(d, '.oxe', 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(d, CAP_FILE), capText(5));
  fs.writeFileSync(path.join(d, 'src', 'a.tsx'), '<button>1</button><button>2</button>\n');
  fs.writeFileSync(path.join(d, 'src', 'b.tsx'), '<button>3</button>\n');
  fs.writeFileSync(path.join(d, 'src', 'ui', 'Button.tsx'), '<button>primitive</button><button>x</button>\n');
  git(d, 'add', '-A');
  git(d, 'commit', '-qm', 'base');
  return d;
}

describe('lint.ratchets', () => {
  it('reads the specific cap (not the role="alert" one) and counts paths minus exclude', () => {
    const d = repo();
    const [r] = ratchets.ratchetsOf(config);
    const cap = ratchets.capOf(fs.readFileSync(path.join(d, CAP_FILE), 'utf8'), r);
    assert.equal(cap.value, 5);
    assert.equal(cap.line, 3);
    assert.equal(ratchets.countOf(d, r), 3, 'src/ui/** is excluded');
  });

  it('lowers the cap to the count when its file is in the scope; never raises; out of scope untouched', () => {
    const d = repo();
    fs.writeFileSync(path.join(d, 'src', 'a.tsx'), '<Button>1</Button><button>2</button>\n');
    assert.deepEqual(ratchets.lowerRatchets(d, config, ['src/a.tsx']), [], 'the cap file is not in the scope');
    assert.match(fs.readFileSync(path.join(d, CAP_FILE), 'utf8'), /toBeLessThanOrEqual\(5\)/);
    const out = ratchets.lowerRatchets(d, config, ['src/a.tsx', CAP_FILE]);
    assert.deepEqual(out, [{ file: CAP_FILE, line: 3, from: 5, to: 2 }]);
    const text = fs.readFileSync(path.join(d, CAP_FILE), 'utf8');
    assert.match(text, /<button\\b\/g\)\)\.toBeLessThanOrEqual\(2\)/);
    assert.match(text, /role="alert"\/g\)\)\.toBeLessThanOrEqual\(0\)/, 'the other ratchet is untouched');
    fs.writeFileSync(path.join(d, 'src', 'b.tsx'), '<button>3</button><button>4</button><button>5</button>\n');
    assert.deepEqual(ratchets.lowerRatchets(d, config, [CAP_FILE]), [], 'a count above the cap never raises it');
  });

  it('the prompt note names the file, line and cap', () => {
    const d = repo();
    const notes = ratchets.ratchetNotes(d, config, [CAP_FILE]);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /tests\/design-lint\.test\.ts:3 está em 5/);
    assert.deepEqual(ratchets.ratchetNotes(d, config, ['src/a.tsx']), []);
  });

  it('a commit that only moves the cap number is not plan_stale; any other change still is', () => {
    const d = repo();
    const base = git(d, 'rev-parse', 'HEAD').stdout.trim();
    fs.writeFileSync(path.join(d, CAP_FILE), capText(3));
    git(d, 'commit', '-qam', 'quick: cap down');
    const doc = { base_sha: base, tasks: [{ id: 'T36', files: [CAP_FILE, 'src/b.tsx'] }] };
    assert.deepEqual(staleness.staleness(d, doc, null).stale, []);
    fs.writeFileSync(path.join(d, CAP_FILE), `${capText(3)}// new test\n`);
    git(d, 'commit', '-qam', 'quick: new test line');
    const st = staleness.staleness(d, doc, null).stale;
    assert.equal(st.length, 1);
    assert.equal(st[0].file, CAP_FILE);
  });

  it('commitTaskCheckpoint lowers the cap in the task\'s own commit and reports it', () => {
    const op = require('../bin/lib/oxe-operational.cjs');
    const d = repo();
    fs.writeFileSync(path.join(d, 'src', 'a.tsx'), '<Button>1</Button><Button>2</Button>\n');
    const cp = op.commitTaskCheckpoint(d, { run_id: 'r1' }, 'T34', { task: { id: 'T34', files: ['src/a.tsx', CAP_FILE] }, config, message: 'T34: primitives' });
    assert.equal(cp.committed, true, cp.reason);
    assert.deepEqual(cp.ratchets_lowered, [{ file: CAP_FILE, line: 3, from: 5, to: 1 }]);
    const shown = git(d, 'show', `HEAD:${CAP_FILE}`).stdout;
    assert.match(shown, /<button\\b\/g\)\)\.toBeLessThanOrEqual\(1\)/);
    assert.equal(git(d, 'status', '--porcelain').stdout.trim(), '', 'the lowered cap went into the checkpoint');
  });

  it('onlyCapChanged refuses a change to another line or to the other ratchet', () => {
    assert.equal(ratchets.onlyCapChanged(capText(5), capText(4), config, CAP_FILE), true);
    assert.equal(ratchets.onlyCapChanged(capText(5), capText(5).replace('LessThanOrEqual(0)', 'LessThanOrEqual(1)'), config, CAP_FILE), false);
    assert.equal(ratchets.onlyCapChanged(capText(5), capText(5), config, CAP_FILE), false);
  });
});
