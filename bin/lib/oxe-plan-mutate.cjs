'use strict';

/**
 * `oxe-cc plan mutate`: strength of the frozen tests, measured per criterion.
 *
 * `plan lint --mutation` samples the files a test imports, which measures nothing for a test that talks HTTP or CLI.
 * Here the targets come from the plan (the files of the tasks of each criterion), so a black-box test is measured too.
 * One mutant at a time, in a copy of the working tree outside the repository (no worktree, the real files untouched).
 *
 * A criterion whose test kills no mutant cannot tell that code from a broken one. For a P0 criterion that blocks, and
 * so does "not measured": no silent green.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { mutantsOf } = require('./oxe-test-rigor.cjs');
const verdicts = require('./oxe-verdicts.cjs');

const CODE_RE = /\.(c|m)?[jt]sx?$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[a-z]+$|\.d\.ts$|(^|\/)node_modules\//i;
const norm = (p) => String(typeof p === 'string' ? p : (p && p.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');
const up = (s) => String(s || '').trim().toUpperCase();

/** `n` items evenly spread over the list, so the sample is not just the top of the file. */
function spread(list, n) {
  if (list.length <= n) return list.slice();
  return Array.from({ length: n }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / n)]);
}

function declares(declared, file) {
  return declared.some((d) => {
    if (d === file) return true;
    const star = d.indexOf('*');
    if (star >= 0) return file.startsWith(d.slice(0, star));
    return file.startsWith(`${d.replace(/\/$/, '')}/`);
  });
}

/** criterion → { commands, targets } from the plan and the files that exist in the copy. */
function targetsOf(doc, files) {
  const tasks = (doc.tasks || []).filter((t) => t && !t.superseded && !t.merged_into && t.status !== 'superseded');
  const entries = (doc.acceptance_tests || []).filter((a) => a && a.criterion && a.command);
  const frozen = new Set(entries.flatMap((a) => a.files || []).map(norm));
  const code = files.filter((f) => CODE_RE.test(f) && !TEST_RE.test(f) && !frozen.has(f));
  const ids = new Set([...tasks.flatMap((t) => t.acceptance || []).map(up), ...entries.map((a) => up(a.criterion))]);
  return [...ids].map((id) => {
    const owners = tasks.filter((t) => (t.acceptance || []).map(up).includes(id));
    const declared = owners.flatMap((t) => t.files || []).map(norm).filter(Boolean);
    return {
      id,
      commands: [...new Set(entries.filter((a) => up(a.criterion) === id).map((a) => String(a.command).trim()))],
      targets: code.filter((f) => declares(declared, f)),
    };
  });
}

/** Runs a command with its output discarded; on timeout the whole process tree goes (a mutant can loop forever). */
function run(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const env = { ...process.env, NODE_TEST_CONTEXT: '' };
    delete env.NODE_TEST_CONTEXT;
    const win = process.platform === 'win32';
    const child = spawn(command, { cwd, env, shell: true, stdio: 'ignore', windowsHide: true, detached: !win });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (win) spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
      else try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, timedOut }); });
    child.on('exit', (status) => { clearTimeout(timer); resolve({ ok: status === 0 && !timedOut, timedOut }); });
  });
}

function copyTree(root) {
  const tree = verdicts.worktreeTree(root);
  if (!tree) throw new Error('plan mutate precisa do topo de um repositório git (a pasta do projeto com o seu próprio .git)');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mutate-'));
  const ws = path.join(base, 'ws');
  fs.mkdirSync(ws);
  const env = { ...process.env, GIT_INDEX_FILE: path.join(base, 'index') };
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${String(r.stderr || '').trim().slice(0, 300)}`);
    return r.stdout;
  };
  try {
    git(['read-tree', tree]);
    git(['checkout-index', '-a', '-f', `--prefix=${ws.replace(/\\/g, '/')}/`]);
    return { base, ws, tree, files: git(['ls-files']).split(/\r?\n/).filter(Boolean) };
  } catch (err) {
    fs.rmSync(base, { recursive: true, force: true });
    throw err;
  }
}

/** The node_modules link goes first; with the link still there, nothing is deleted (it points at the real folder). */
function discard(base, link) {
  if (link) {
    try { fs.unlinkSync(link); } catch { try { fs.rmdirSync(link); } catch { /* checked below */ } }
    try { fs.lstatSync(link); return; } catch { /* gone */ }
  }
  try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a process still holds it: temp dir */ }
}

/**
 * @param {string} root
 * @param {{ tasks: object[], acceptance_tests: object[] }} doc
 * @param {{ risks?: Map<string,string>, max?: number, timeoutMs?: number, criteria?: string[] }} [options]
 */
async function measure(root, doc, options = {}) {
  const max = Number(options.max) > 0 ? Math.floor(Number(options.max)) : 24;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 60_000;
  const risks = options.risks || new Map();
  const copy = copyTree(root);
  let link = null;
  try {
    const nm = path.join(root, 'node_modules');
    if (fs.existsSync(nm) && !fs.existsSync(path.join(copy.ws, 'node_modules'))) {
      const to = path.join(copy.ws, 'node_modules');
      fs.symlinkSync(fs.realpathSync(nm), to, process.platform === 'win32' ? 'junction' : 'dir');
      link = to;
    }
    try { require('./oxe-local-config.cjs').copyLocalFiles(root, copy.ws); } catch { /* no local files */ }

    const only = new Set((options.criteria || []).map(up));
    const all = targetsOf(doc, copy.files);
    for (const id of only) if (!all.some((c) => c.id === id)) throw new Error(`${id}: critério fora do plano`);
    const rows = all.filter((c) => !only.size || only.has(c.id))
      .map((c) => ({ ...c, risk: risks.get(c.id) || null, mutants: 0, killed: 0, unmeasured: null }));

    const baseline = new Map();
    for (const row of rows) {
      if (!row.commands.length) { row.unmeasured = 'sem teste de aceite com comando'; continue; }
      if (!row.targets.length) { row.unmeasured = 'nenhuma tarefa dele declara código JS/TS que exista no projeto'; continue; }
      for (const cmd of row.commands) {
        if (!baseline.has(cmd)) baseline.set(cmd, (await run(cmd, copy.ws, timeoutMs)).ok);
        if (!baseline.get(cmd)) row.unmeasured = 'o teste já falha sem mutação';
      }
    }

    // The budget goes to the files of P0 criteria first.
    const measurable = rows.filter((r) => !r.unmeasured).sort((a, b) => Number(b.risk === 'P0') - Number(a.risk === 'P0'));
    const files = [...new Set(measurable.flatMap((r) => r.targets))];
    const perFile = Math.max(1, Math.floor(max / Math.max(1, files.length)));
    const survived = [];
    let total = 0;
    for (const file of files) {
      if (total >= max) break;
      const abs = path.join(copy.ws, file);
      if (!fs.lstatSync(abs).isFile()) continue;
      const original = fs.readFileSync(abs, 'utf8');
      const lines = original.split('\n');
      const usable = [];
      for (const m of spread(mutantsOf(original, Infinity), perFile * 2)) {
        if (usable.length >= perFile || total + usable.length >= max) break;
        const text = lines.map((l, i) => (i === m.line - 1 ? m.after : l)).join('\n');
        // A mutant that does not parse would be "killed" by any test.
        if (/\.(c|m)?js$/i.test(file)) {
          fs.writeFileSync(abs, text);
          const ok = spawnSync(process.execPath, ['--check', abs], { windowsHide: true, stdio: 'ignore' }).status === 0;
          fs.writeFileSync(abs, original);
          if (!ok) continue;
        }
        usable.push({ ...m, text });
      }
      const judges = measurable.filter((r) => r.targets.includes(file));
      for (const m of usable) {
        fs.writeFileSync(abs, m.text);
        const results = new Map();
        let anyKill = false;
        try {
          for (const row of judges) {
            let killed = false;
            for (const cmd of row.commands) {
              if (!results.has(cmd)) results.set(cmd, (await run(cmd, copy.ws, timeoutMs)).ok);
              if (!results.get(cmd)) killed = true;
            }
            row.mutants += 1;
            if (killed) { row.killed += 1; anyKill = true; }
          }
        } finally {
          fs.writeFileSync(abs, original);
        }
        total += 1;
        if (!anyKill) survived.push({ file, line: m.line, after: m.after.trim().slice(0, 100) });
      }
    }

    for (const row of measurable) {
      if (!row.mutants) row.unmeasured = 'nenhum mutante aplicável no código dele (ou o limite --max acabou antes)';
    }
    const p0 = rows.filter((r) => r.risk === 'P0');
    const weak = p0.filter((r) => !r.unmeasured && r.killed === 0).map((r) => r.id);
    const unmeasured = p0.filter((r) => r.unmeasured).map((r) => r.id);
    return {
      tree: copy.tree,
      mutants: total,
      killed: total - survived.length,
      survived,
      criteria: rows.map(({ commands, ...r }) => r),
      weak,
      unmeasured,
      // 1: a P0 test that detects nothing · 2: a P0 (or everything) that could not be measured
      exit: weak.length ? 1 : unmeasured.length || !total ? 2 : 0,
    };
  } finally {
    discard(copy.base, link);
  }
}

module.exports = { measure, targetsOf, spread };
