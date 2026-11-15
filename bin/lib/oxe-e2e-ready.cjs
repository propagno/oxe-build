'use strict';

/**
 * G40 (OxeSpace 15/11, PR #863): a planner-written frozen e2e pressed Ctrl+Shift+U ~50 ms after launchApp, before the
 * shell mounted its keybindings — no toast, a race proven on CI, and a frozen-test release to fix it. In each frozen
 * e2e spec of the plan, the first interaction after a launch / navigation / resize must come after a readiness wait.
 */

const LAUNCH_RE = /\b(launchApp|electron\.launch|_electron\.launch|launchElectron|page\.goto|\.goto\(|resizeWindow|setViewportSize|newPage\(|reload\()/;
const ACT_RE = /\b(keyboard\.(press|type|down|insertText)|\.press\(|\.click\(|\.dblclick\(|\.fill\(|\.type\(|\.check\(|\.selectOption\(|\.hover\(|\.dragTo\()/;
const BUILTIN_WAIT_RE = /\b(waitFor\(|waitForSelector\(|waitForLoadState\(|waitForEvent\(|waitForFunction\(|waitForURL\(|toBeVisible\(|toBeAttached\(|toHaveCount\(|toBeEnabled\(|toHaveText\(|toContainText\(|toHaveTitle\(|toHaveURL\(|expect\.poll\()/;

const E2E_FILE_RE = /(^|\/)(e2e|playwright)\/|\.(e2e|spec)\.[cm]?[jt]sx?$/i;

// a test body or a hook starts a new sequence
const BLOCK_RE = /^\s*(?:test|it|describe)(?:\.(?:only|skip|describe|serial|parallel))*\s*\(|^\s*(?:test\.)?(?:beforeEach|afterEach|beforeAll|afterAll)\s*\(/;

/** The line without its `//` and block comments — never cut inside a string (`'http://localhost'`). */
function stripComment(line) {
  const l = String(line || '');
  let q = null;
  let out = '';
  for (let i = 0; i < l.length; i += 1) {
    const ch = l[i];
    if (q) {
      out += ch;
      if (ch === '\\') { out += l[i + 1] || ''; i += 1; } else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; out += ch; continue; }
    if (ch === '/' && l[i + 1] === '/') break;
    if (ch === '/' && l[i + 1] === '*') {
      const end = l.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Within each test body, the first interaction after a launch with no wait in between.
 * @param {string} text the spec source
 * @param {{ helpers?: string[] }} [options] repo helpers that count as a readiness wait (e.g. waitForAppReady)
 * @returns {{ line: number, launch: string, action: string }[]}
 */
function racyActions(text, options = {}) {
  const helpers = (options.helpers || []).map((h) => String(h).trim()).filter(Boolean);
  const helperRe = helpers.length ? new RegExp(`\\b(${helpers.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\(`, 'g') : null;
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let pending = null; // the last launch not yet followed by a wait
  const g = (re) => new RegExp(re.source, 'g');
  const kinds = [['launch', g(LAUNCH_RE)], ['wait', g(BUILTIN_WAIT_RE)], ['act', g(ACT_RE)], ...(helperRe ? [['wait', helperRe]] : [])];
  for (let i = 0; i < lines.length; i += 1) {
    const l = stripComment(lines[i]);
    // a new test body or hook: what the previous one launched does not carry over (cross-review 15/11)
    if (BLOCK_RE.test(l)) pending = null;
    // the events of the line in order: a launch and an action on the same line (`goto(u); click(x)`) count too
    const events = [];
    for (const [kind, re] of kinds) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(l))) { events.push({ kind, at: m.index }); if (!m[0]) re.lastIndex += 1; }
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === 'launch') pending = { line: i + 1, launch: l.trim().slice(0, 120) };
      else if (e.kind === 'wait') pending = null;
      else if (pending) {
        out.push({ line: i + 1, launch: pending.launch, action: l.trim().slice(0, 120) });
        pending = null;
      }
    }
  }
  return out;
}

/** For the plan's frozen e2e specs (pending tasks): the racy first actions, file:line. */
function racyFrozenE2e(root, planDoc, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => t && !(t.done === true || t.status === 'done'));
  const pendingIds = new Set(tasks.map((t) => t.id));
  const out = [];
  const seen = new Set();
  for (const a of planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
    if (!a) continue;
    const owner = a.task || (tasks.find((t) => (t.acceptance || []).includes(a.criterion)) || {}).id || null;
    if (owner && !pendingIds.has(owner)) continue;
    for (const f of a.files || []) {
      const file = String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/');
      if (seen.has(file) || !E2E_FILE_RE.test(file)) continue;
      seen.add(file);
      const text = read(file);
      if (!/@playwright\/test|_electron|electron\.launch|launchApp/.test(text)) continue;
      for (const r of racyActions(text, options)) out.push({ task: owner, criterion: a.criterion || null, file, ...r });
    }
  }
  return out;
}

/**
 * G40b (OxeSpace 15/11, #862 OXE-246): a frozen e2e pinned `getByRole('menuitem', { name: /Comfortable/ })` — a
 * case-SENSITIVE regex — while the app's rule makes the item read "Use comfortable density". A string `name` is
 * case-insensitive in Playwright; a regex is not. With the app's string catalogs (config lint.ui_strings: JSON files),
 * a regex name that matches no catalog string, but would ignoring case, is named file:line.
 */
function labelMismatches(root, planDoc, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const catalogs = (options.catalogs || []).map((c) => String(c).replace(/\\/g, '/'));
  if (!catalogs.length) return [];
  const strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x); };
  for (const c of catalogs) { try { walk(JSON.parse(read(c) || 'null')); } catch { /* not JSON */ } }
  if (!strings.length) return [];
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => t && !(t.done === true || t.status === 'done'));
  const pendingIds = new Set(tasks.map((t) => t.id));
  const NAME_RE = /getByRole\(\s*['"`]([\w-]+)['"`]\s*,\s*\{[^}]*?\bname\s*:\s*\/((?:\\\/|[^/\n])+)\/([a-z]*)/g;
  const out = [];
  const seen = new Set();
  for (const a of planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
    if (!a) continue;
    const owner = a.task || (tasks.find((t) => (t.acceptance || []).includes(a.criterion)) || {}).id || null;
    if (owner && !pendingIds.has(owner)) continue;
    for (const f of a.files || []) {
      const file = String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/');
      if (seen.has(file) || !E2E_FILE_RE.test(file)) continue;
      seen.add(file);
      const text = read(file);
      for (const m of text.matchAll(NAME_RE)) {
        const [, role, src, flags] = m;
        if (flags.includes('i')) continue;
        let exact;
        let loose;
        try { exact = new RegExp(src, flags); loose = new RegExp(src, `${flags}i`); } catch { continue; }
        if (strings.some((s) => exact.test(s))) continue;
        const real = strings.find((s) => loose.test(s));
        if (!real) continue; // not in the catalogs (a dynamic label): nothing to compare
        out.push({ task: owner, file, line: text.slice(0, m.index).split('\n').length, role, pattern: `/${src}/${flags}`, real });
      }
    }
  }
  return out;
}

function labelMessages(found) {
  return found.map((f) => `${f.task ? `${f.task}: ` : ''}${f.file}:${f.line} fixa o ${f.role} pelo regex ${f.pattern}, sensível a maiúsculas, e o texto real no catálogo é "${f.real}" — o regex não casa: use /${f.pattern.slice(1, f.pattern.lastIndexOf('/'))}/i (ou um name string, que o Playwright compara sem diferenciar maiúsculas) [G40]`);
}

/**
 * G41 (OxeSpace 15/11, Celular F4 T13, ~US$ 23): a frozen Paparazzi test switched locale with
 * `context.createConfigurationContext(config)` — layoutlib's BridgeContext returns `this` there, so its en-US case
 * could never be green. In the plan's frozen JVM/Android tests of pending tasks, Paparazzi + createConfigurationContext
 * (or a Configuration locale / fontScale set by hand) is named, with the fix: a DeviceConfig on the Paparazzi rule.
 */
function layoutlibHazards(root, planDoc, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => t && !(t.done === true || t.status === 'done'));
  const pendingIds = new Set(tasks.map((t) => t.id));
  const out = [];
  const seen = new Set();
  for (const a of planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
    if (!a) continue;
    const owner = a.task || (tasks.find((t) => (t.acceptance || []).includes(a.criterion)) || {}).id || null;
    if (owner && !pendingIds.has(owner)) continue;
    for (const f of a.files || []) {
      const file = String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/');
      if (seen.has(file) || !/\.(kt|java)$/i.test(file)) continue;
      seen.add(file);
      const text = read(file);
      if (!/\bPaparazzi\b|paparazzi/i.test(text)) continue;
      const lines = text.split(/\r?\n/);
      lines.forEach((l, i) => {
        if (/createConfigurationContext\s*\(/.test(l) || /\b(setLocale|setLocales|fontScale\s*=)/.test(l)) out.push({ task: owner, file, line: i + 1, code: l.trim().slice(0, 140) });
      });
    }
  }
  return out;
}

function layoutlibMessages(found) {
  return found.map((f) => `${f.task ? `${f.task}: ` : ''}${f.file}:${f.line} troca a configuração (\`${f.code}\`) num teste Paparazzi — no layoutlib o createConfigurationContext devolve o próprio contexto, e o locale/fontScale não muda: use um DeviceConfig na regra (ex.: Paparazzi(deviceConfig = DeviceConfig.PIXEL_5.copy(locale = "en"))) ou uma classe por locale [G41]`);
}

/**
 * G42 (OxeSpace 15/11, PR #867): 18 frozen e2e guarded Docker with `docker info` only; on the GitHub Windows runner
 * Docker answers but runs WINDOWS containers, and `docker run postgres:16-alpine` failed ("no matching manifest for
 * windows…") instead of skipping. A frozen test that starts containers behind a `docker info` guard must check the
 * engine's OSType (or pass --platform); a skip must say why.
 */
function containerGuardHazards(root, planDoc, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const tasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => t && !(t.done === true || t.status === 'done'));
  const pendingIds = new Set(tasks.map((t) => t.id));
  const out = [];
  const seen = new Set();
  for (const a of planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
    if (!a) continue;
    const owner = a.task || (tasks.find((t) => (t.acceptance || []).includes(a.criterion)) || {}).id || null;
    if (owner && !pendingIds.has(owner)) continue;
    for (const f of a.files || []) {
      const file = String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/');
      if (seen.has(file) || !/\.[cm]?[jt]sx?$/i.test(file)) continue;
      seen.add(file);
      const text = read(file);
      const startsContainers = /docker['"`]?\s*,?\s*\[?\s*['"`]?\s*(run|compose)\b|docker\s+(run|compose)\b|GenericContainer|testcontainers/i.test(text);
      if (!startsContainers) continue;
      const lines = text.split(/\r?\n/);
      const guardIdx = lines.findIndex((l) => /docker['"`]?\s*,?\s*\[?\s*['"`]?\s*info\b|docker\s+info\b/.test(l));
      if (guardIdx >= 0 && !/OSType|--platform|platform\s*:/i.test(text)) {
        out.push({ task: owner, file, line: guardIdx + 1, kind: 'ostype', code: lines[guardIdx].trim().slice(0, 140) });
      }
      // a skip with no reason: test.skip(cond) / it.skip without a message
      // the arguments read with balanced parentheses: a reason is a SECOND top-level argument (`skip(!ready(), 'why')`)
      const skipHasReason = (l, at) => {
        let depth = 0;
        let q = null;
        for (let i = at; i < l.length; i += 1) {
          const ch = l[i];
          if (q) { if (ch === '\\') { i += 1; continue; } if (ch === q) q = null; continue; }
          if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
          if (ch === '(') depth += 1;
          else if (ch === ')') { depth -= 1; if (depth === 0) return false; }
          else if (ch === ',' && depth === 1) return true;
        }
        return true; // the call continues on the next line: not judged
      };
      lines.forEach((raw, i) => {
        const l = stripComment(raw); // a commented-out skip is no skip (R30)
        const m = /\b(test|it|describe)\.skip\(/.exec(l);
        if (!m) return;
        const open = m.index + m[0].length - 1;
        if (/^\(\s*\)/.test(l.slice(open))) return; // test.skip() inside a test: unconditional, no condition to explain
        if (!skipHasReason(l, open)) out.push({ task: owner, file, line: i + 1, kind: 'skip_reason', code: l.trim().slice(0, 140) });
      });
    }
  }
  return out;
}

function containerGuardMessages(found) {
  return found.map((f) => (f.kind === 'ostype'
    ? `${f.task ? `${f.task}: ` : ''}${f.file}:${f.line} protege o Docker só com \`docker info\` (\`${f.code}\`) e sobe container — num runner Windows o Docker responde com containers Windows e a imagem Linux falha em vez de pular (OxeSpace #867): exija \`docker info --format {{.OSType}}\` = linux (ou --platform linux/amd64) e pule com o motivo [G42]`
    : `${f.task ? `${f.task}: ` : ''}${f.file}:${f.line} pula sem dizer o motivo (\`${f.code}\`) — passe a descrição (test.skip(cond, 'sem engine Linux de containers')) para o relatório mostrar por que pulou [G42]`));
}

function racyMessages(found) {
  return found.map((f) => `${f.task ? `${f.task}: ` : ''}${f.file}:${f.line} age logo depois de abrir o app (\`${f.launch}\` → \`${f.action}\`) sem esperar o app ficar pronto — corrida com a montagem da UI (OxeSpace #863): espere um elemento da shell antes (ex.: locator(...).waitFor() / expect(...).toBeVisible(), ou o helper do repo em lint.e2e_ready_helpers) [G40]`);
}

module.exports = { racyActions, racyFrozenE2e, racyMessages, labelMismatches, labelMessages, layoutlibHazards, layoutlibMessages, containerGuardHazards, containerGuardMessages, E2E_FILE_RE };
