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

const { maskJsSource } = require('./oxe-test-rigor.cjs');

// a test body or a hook starts a new sequence
const BLOCK_RE = /^\s*(?:test|it|describe)(?:\.(?:only|skip|describe|serial|parallel))*\s*\(|^\s*(?:test\.)?(?:beforeEach|afterEach|beforeAll|afterAll)\s*\(/;

function pendingContextOf(planDoc) {
  const allTasks = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter(Boolean);
  const isDone = (t) => t.done === true || t.status === 'done';
  const pendingTasks = allTasks.filter((t) => !isDone(t));
  const pendingIds = new Set(pendingTasks.map((t) => t.id));
  return { allTasks, pendingTasks, pendingIds };
}

function resolveEntryPendingOwner(entry, ctx) {
  if (!entry) return { skip: true, owner: null };
  if (entry.task) {
    return ctx.pendingIds.has(entry.task) ? { skip: false, owner: entry.task } : { skip: true, owner: entry.task };
  }
  if (entry.criterion) {
    const owners = ctx.allTasks.filter((t) => {
      const acc = Array.isArray(t.acceptance) ? t.acceptance : Array.isArray(t.aceite) ? t.aceite : [];
      return acc.includes(entry.criterion);
    });
    const pendingOwner = owners.find((t) => ctx.pendingIds.has(t.id));
    if (owners.length > 0 && !pendingOwner) return { skip: true, owner: null };
    return { skip: false, owner: pendingOwner ? pendingOwner.id : null };
  }
  return { skip: false, owner: null };
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
  const { commentStripped } = maskJsSource(String(text || ''));
  const lines = commentStripped.split(/\r?\n/);
  const out = [];
  let pending = null; // the last launch not yet followed by a wait
  const g = (re) => new RegExp(re.source, 'g');
  const kinds = [['launch', g(LAUNCH_RE)], ['wait', g(BUILTIN_WAIT_RE)], ['act', g(ACT_RE)], ...(helperRe ? [['wait', helperRe]] : [])];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
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
  const ctx = pendingContextOf(planDoc);
  const out = [];
  const seen = new Set();
  for (const a of planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
    if (!a) continue;
    const { skip, owner } = resolveEntryPendingOwner(a, ctx);
    if (skip) continue;
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
  const ctx = pendingContextOf(planDoc);
  const NAME_RE = /getByRole\(\s*['"`]([\w-]+)['"`]\s*,\s*\{[^}]*?\bname\s*:\s*\/((?:\\\/|[^/\n])+)\/([a-z]*)/g;
  const out = [];
  const seen = new Set();
  for (const a of planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
    if (!a) continue;
    const { skip, owner } = resolveEntryPendingOwner(a, ctx);
    if (skip) continue;
    for (const f of a.files || []) {
      const file = String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/');
      if (seen.has(file) || !E2E_FILE_RE.test(file)) continue;
      seen.add(file);
      const { commentStripped } = maskJsSource(read(file));
      for (const m of commentStripped.matchAll(NAME_RE)) {
        const [, role, src, flags] = m;
        if (flags.includes('i')) continue;
        let exact;
        let loose;
        try { exact = new RegExp(src, flags); loose = new RegExp(src, `${flags}i`); } catch { continue; }
        if (strings.some((s) => exact.test(s))) continue;
        const real = strings.find((s) => loose.test(s));
        if (!real) continue; // not in the catalogs (a dynamic label): nothing to compare
        out.push({ task: owner, file, line: commentStripped.slice(0, m.index).split('\n').length, role, pattern: `/${src}/${flags}`, real });
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
  const ctx = pendingContextOf(planDoc);
  const out = [];
  const seen = new Set();
  for (const a of planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
    if (!a) continue;
    const { skip, owner } = resolveEntryPendingOwner(a, ctx);
    if (skip) continue;
    for (const f of a.files || []) {
      const file = String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/');
      if (seen.has(file) || !/\.(kt|java)$/i.test(file)) continue;
      seen.add(file);
      const rawText = read(file);
      const { commentStripped } = maskJsSource(rawText);
      if (!/\bPaparazzi\b|paparazzi/i.test(commentStripped)) continue;
      const rawLines = rawText.split(/\r?\n/);
      const codeLines = commentStripped.split(/\r?\n/);
      codeLines.forEach((l, i) => {
        if (/createConfigurationContext\s*\(/.test(l) || /\b(setLocale|setLocales|fontScale\s*=)/.test(l)) {
          out.push({ task: owner, file, line: i + 1, code: (rawLines[i] || l).trim().slice(0, 140) });
        }
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
  const ctx = pendingContextOf(planDoc);
  const out = [];
  const seen = new Set();
  const inspectSkipCall = (src, openIdx) => {
    let depth = 0;
    let q = null;
    let hasCommaAtTop = false;
    const endLimit = Math.min(src.length, openIdx + 1500);
    for (let i = openIdx; i < endLimit; i += 1) {
      const ch = src[i];
      if (q) { if (ch === '\\') { i += 1; continue; } if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          const inner = src.slice(openIdx + 1, i);
          if (!/\S/.test(inner)) return { unconditional: true, hasReason: true };
          return { unconditional: false, hasReason: hasCommaAtTop };
        }
      } else if (ch === ',' && depth === 1) {
        const afterComma = src.slice(i + 1);
        // Ignore a trailing comma `test.skip(cond,)` with nothing before `)`
        if (!/^\s*\)/.test(afterComma)) hasCommaAtTop = true;
      }
    }
    return { unconditional: false, hasReason: true };
  };
  for (const a of planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
    if (!a) continue;
    const { skip, owner } = resolveEntryPendingOwner(a, ctx);
    if (skip) continue;
    for (const f of a.files || []) {
      const file = String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/');
      if (seen.has(file) || !/\.[cm]?[jt]sx?$/i.test(file)) continue;
      seen.add(file);
      const rawText = read(file);
      const { commentStripped } = maskJsSource(rawText);
      const startsContainers = /docker['"`]?\s*,?\s*\[?\s*['"`]?\s*(run|compose)\b|docker\s+(run|compose)\b|GenericContainer|testcontainers/i.test(commentStripped);
      if (!startsContainers) continue;
      const rawLines = rawText.split(/\r?\n/);
      const codeLines = commentStripped.split(/\r?\n/);
      const guardIdx = codeLines.findIndex((l) => /docker['"`]?\s*,?\s*\[?\s*['"`]?\s*info\b|docker\s+info\b/.test(l));
      if (guardIdx >= 0 && !/OSType|--platform|platform\s*:/i.test(commentStripped)) {
        out.push({ task: owner, file, line: guardIdx + 1, kind: 'ostype', code: (rawLines[guardIdx] || codeLines[guardIdx]).trim().slice(0, 140) });
      }
      const skipRe = /\b(test|it|describe)\.skip\s*\(/g;
      let m;
      while ((m = skipRe.exec(commentStripped)) !== null) {
        const open = m.index + m[0].length - 1;
        const info = inspectSkipCall(commentStripped, open);
        if (info.unconditional || info.hasReason) continue;
        const lineNo = commentStripped.slice(0, m.index).split('\n').length;
        out.push({ task: owner, file, line: lineNo, kind: 'skip_reason', code: (rawLines[lineNo - 1] || '').trim().slice(0, 140) });
      }
    }
  }
  return out;
}

function containerGuardMessages(found) {
  return found.map((f) => (f.kind === 'ostype'
    ? `${f.task ? `${f.task}: ` : ''}${f.file}:${f.line} protege o Docker só com \`docker info\` (\`${f.code}\`) e sobe container — num runner Windows o Docker responde com containers Windows e a imagem Linux falha em vez de pular (OxeSpace #867): exija \`docker info --format {{.OSType}}\` = linux (ou --platform linux/amd64) e pule com o motivo [G42]`
    : `${f.task ? `${f.task}: ` : ''}${f.file}:${f.line} pula sem dizer o motivo (\`${f.code}\`) — passe a descrição (test.skip(cond, 'sem engine Linux de containers')) para o relatório mostrar por que pulou [G42]`));
}

/**
 * G40c (OxeSpace 15/11, OQ T14, 3 paid attempts): a frozen e2e measured two boxes inside a dialog with separate
 * boundingBox() calls while the dialog was still rising in its entrance animation (@starting-style translate) — the
 * layout was aligned on every frame, the test saw 1–2 px and failed 3 of 5 runs. Within each test body, a geometry
 * read (boundingBox, getBoundingClientRect, toHaveCSS of size/position) after an overlay (dialog, menu, popover,
 * tooltip, listbox, drawer, sheet, modal) with no wait for its animations in between.
 * @returns {{ line: number, overlay: string, read: string }[]}
 */
// an overlay LOCATOR (R45): a role, or a locator / test id naming one — never any string (a test title, a URL, a text)
const OVERLAY_RE = /getByRole\(\s*['"](dialog|alertdialog|menu|listbox|tooltip)['"]|(?:locator|getByTestId)\(\s*['"`][^'"`]*\b(dialog|popover|menu|modal|drawer|sheet|tooltip)\b/i;
const GEOMETRY_RE = /\.boundingBox\(|getBoundingClientRect\(|toHaveCSS\(\s*['"](width|height|top|left|right|bottom|transform|translate|inset)['"]/;
const ANIM_WAIT_RE = /getAnimations\(|\.finished\b|animationend|transitionend/;
// the overlay closed (R45): what is measured after it is the page
const OVERLAY_CLOSED_RE = /\.toBeHidden\(|\.not\.toBeVisible\(|toHaveCount\(\s*0\s*\)|\.press\(\s*['"]Escape['"]/;
const ASSIGN_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;

function overlayGeometryReads(text, options = {}) {
  const helpers = (options.helpers || []).map((h) => String(h).trim()).filter(Boolean);
  const helperRe = helpers.length ? new RegExp(`\\b(${helpers.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\(`) : null;
  const { commentStripped } = maskJsSource(String(text || ''));
  const lines = commentStripped.split(/\r?\n/);
  const out = [];
  let overlay = null; // the overlay opened in this test body and not yet waited for
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (BLOCK_RE.test(l)) { overlay = null; continue; } // a test title is never an overlay
    if (ANIM_WAIT_RE.test(l) || (helperRe && helperRe.test(l)) || OVERLAY_CLOSED_RE.test(l)) { overlay = null; continue; }
    // the whole statement (R50): a fluent chain broken across lines by a formatter (`dialog` / `.locator(...)` /
    // `.boundingBox()`) is read as one — back to the line the continuation lines (`^\s*\.`) hang from
    // a continuation line starts with "." or ")." (`await expect(\n  dialog.locator('.h'),\n).toHaveCSS(...)`, R51)
    const cont = /^\s*\)?\s*\./;
    let start = i;
    while (start > 0 && cont.test(lines[start])) start -= 1;
    let end = i;
    while (end + 1 < lines.length && cont.test(lines[end + 1])) end += 1;
    const stmt = lines.slice(start, end + 1).join(' ');
    const om = OVERLAY_RE.exec(l);
    const assigned = ASSIGN_RE.exec(start === i ? stmt : l);
    // a second overlay keeps the first one's variables (R50): both stay in reach until a wait or a close
    if (om) overlay = { line: i + 1, text: l.trim().slice(0, 120), vars: new Set([...(overlay ? overlay.vars : []), ...(assigned ? [assigned[1]] : [])]) };
    // a locator derived from the overlay's variable is inside it too (`const row = dialog.locator(...)`)
    else if (overlay && assigned && [...overlay.vars].some((v) => new RegExp(`(?<![\\w$])${v.replace(/\$/g, '\\$')}\\s*\\.`).test(stmt))) overlay.vars.add(assigned[1]);
    if (overlay && GEOMETRY_RE.test(l)) {
      // R (chat-f5 T12): only a measurement OF the overlay counts — its locator inline, or a variable that derives
      // from it; a toolbar measured while a listbox was open (and closed) is the page
      const usesVar = [...overlay.vars].some((v) => new RegExp(`(?<![\\w$])${v.replace(/\$/g, '\\$')}\\s*[.)]`).test(stmt));
      const inline = Boolean(om) || OVERLAY_RE.test(stmt.replace(/^[^=]*=/, ''));
      if (usesVar || inline || (!overlay.vars.size && Boolean(om))) {
        out.push({ line: i + 1, overlay: overlay.text, read: l.trim().slice(0, 120) });
        overlay = null; // one finding per overlay
      }
    }
  }
  return out;
}

/** For the plan's frozen e2e specs (pending tasks): the geometry reads inside an overlay with no animation wait. */
function overlayGeometryFrozenE2e(root, planDoc, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  // the same pending-owner rule as G40 (R45): an entry whose owners are all done is not read
  const ctx = pendingContextOf(planDoc);
  const out = [];
  const seen = new Set();
  for (const a of planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
    if (!a) continue;
    const { skip, owner } = resolveEntryPendingOwner(a, ctx);
    if (skip) continue;
    for (const f of a.files || []) {
      const file = String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/');
      if (seen.has(file) || !E2E_FILE_RE.test(file)) continue;
      seen.add(file);
      for (const r of overlayGeometryReads(read(file), options)) out.push({ task: owner, criterion: a.criterion || null, file, ...r });
    }
  }
  return out;
}

function overlayGeometryMessages(found) {
  return found.map((f) => `${f.task ? `${f.task}: ` : ''}${f.file}:${f.line} mede geometria (\`${f.read}\`) dentro de um overlay (\`${f.overlay}\`) sem esperar a animação de entrada — a medição pega o overlay ainda subindo e falha intermitente (OxeSpace OQ T14: alinhado em todo frame, 1–2 px no teste, 3 de 5 falham). Antes de medir: await el.evaluate((e) => Promise.all(e.getAnimations({ subtree: true }).map((a) => a.finished))) (ou o helper do repo em lint.e2e_ready_helpers) [G40c]`);
}

function racyMessages(found) {
  return found.map((f) => `${f.task ? `${f.task}: ` : ''}${f.file}:${f.line} age logo depois de abrir o app (\`${f.launch}\` → \`${f.action}\`) sem esperar o app ficar pronto — corrida com a montagem da UI (OxeSpace #863): espere um elemento da shell antes (ex.: locator(...).waitFor() / expect(...).toBeVisible(), ou o helper do repo em lint.e2e_ready_helpers) [G40]`);
}

module.exports = { racyActions, racyFrozenE2e, racyMessages, overlayGeometryReads, overlayGeometryFrozenE2e, overlayGeometryMessages, labelMismatches, labelMessages, layoutlibHazards, layoutlibMessages, containerGuardHazards, containerGuardMessages, E2E_FILE_RE };
