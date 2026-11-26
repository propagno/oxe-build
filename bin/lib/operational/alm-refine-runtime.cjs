'use strict';

/**
 * 1.22.1 (OXB-221-09): Strangler Fig Slice 1 — ALM, Refine, Traceability, Metrics and `uiCardGaps`
 * extracted from `bin/lib/oxe-operational.cjs` with explicit dependency injection (zero circular require).
 */

const fs = require('fs');
const path = require('path');

const NON_UI_DOMAIN_LABEL_RE = /^(?:area-(?:desempenho|performance|perf|backend|infra(?:estrutura)?|dados|db|database|seguran[cç]a|security|arquitetura|architecture|ipc|runtime|terminal|git|ci|build|cli|core|engine)|desempenho|performance|perf|backend|infra(?:estrutura)?|seguran[cç]a|security|arquitetura|database|db)$/i;

/** A whole-word, accent-aware, case-insensitive match of `word` (glossary synonyms). */
function wholeWord(word) {
  const esc = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

const refineLibCriteria = (md) => {
  try { return require('../oxe-alm-refine.cjs').parseCriteria(md); } catch { return []; }
};

/** G34: what a UI card's spec still lacks (BRD-n, target, measures in the CAs, both themes, both densities). */
function criteriaOnlyReadSharedLocales(crit) {
  if (!Array.isArray(crit) || !crit.length) return false;
  const combined = crit.map((c) => String((c && c.text) || '')).join('\n');
  if (!/\bshared\/locales(?:\/[^\s`'",)*]+)?/i.test(combined)) return false;
  const PATH_RE = /\b(?:src|shared|app|mobile|packages|desktop|web|client|server)\/[\w./*{}-]+/gi;
  const TEST_FILE_RE = /(^|\/)(?:tests?|__tests__|specs?|e2e|playwright)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
  for (const m of combined.matchAll(PATH_RE)) {
    const p = m[0];
    if (TEST_FILE_RE.test(p)) continue;
    if (!/^shared\/locales(?:\/|$)/i.test(p)) return false;
  }
  const NON_LOCALE_EXT_RE = /\b[\w.-]+\.(?:tsx|jsx|css|scss|less|kt)\b/gi;
  for (const m of combined.matchAll(NON_LOCALE_EXT_RE)) {
    if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(m[0])) return false;
  }
  return true;
}

function uiCardGaps(md, collected = {}, options = {}) {
  const text = String(md || '');
  const labels = (collected.labels || []).map((l) => String(l).toLowerCase());
  const hasMarca = labels.includes('area-marca');
  const hasVisualLabel = labels.some((l) => /^(?:area-marca|visual|polish|ui|design)$/i.test(l));
  if (collected.kind === 'epic' && !hasMarca) return { isUi: false, gaps: [], epic_exempt: true };
  let brandStrict = false;
  if (options && options.projectRoot) {
    const presetCfg = require('../oxe-presets.cjs').resolvePresetConfig(options.projectRoot);
    const hasDesignTargets = fs.existsSync(path.join(options.projectRoot, 'src', 'design', 'targets'));
    brandStrict = Boolean(presetCfg.ui && presetCfg.ui.brandGate);
    if (!hasMarca && !hasVisualLabel && !brandStrict) {
      const uiDirs = ['src/ui', 'src/styles', 'src/design', 'src/renderer', 'src/components', 'mobile/android'];
      const hasUiTree = uiDirs.some((d) => fs.existsSync(path.join(options.projectRoot, d)));
      if (!hasUiTree) return { isUi: false, gaps: [], no_ui_tree_exempt: true };
    }
    if (!hasMarca && !hasDesignTargets && !brandStrict) {
      return { isUi: false, gaps: [], brand_gate_disabled_exempt: true };
    }
  }
  const hasExplicitNonUiLabel = !hasMarca && labels.some((l) => NON_UI_DOMAIN_LABEL_RE.test(l));
  const crit = refineLibCriteria(text);
  const critText = crit.map((c) => String((c && c.text) || '')).join('\n');
  const UI_PATHS = /\b(src\/(renderer|ui|styles|design|components)\/|mobile\/android\/[\w/.-]*\/ui\/)/;
  const STRICT_UI_PATHS = /\b(src\/(ui|styles|design)\/|mobile\/android\/[\w/.-]*\/ui\/)/;
  const isUi = hasMarca || (hasExplicitNonUiLabel ? STRICT_UI_PATHS.test(critText) : UI_PATHS.test(text));
  if (!isUi) return { isUi: false, gaps: [] };
  if (criteriaOnlyReadSharedLocales(crit)) return { isUi: false, gaps: [], locale_only_exempt: true };
  const declaresNoBrd = /\b(?:sem BRD|BRD:\s*(?:nenhum|n\/a|—|-))\b/i.test(text);
  const touchesStyleOrTokens = /\.(?:css|scss|less)\b|var\(--[\w-]+\)|--(?:bar|row|control|fs|radius|space)-|src\/(?:styles|design)\//i.test(text);
  if (collected.kind === 'bug' && !hasVisualLabel && declaresNoBrd && !touchesStyleOrTokens) {
    return { isUi: false, gaps: [], bug_non_visual_exempt: true };
  }
  if (!hasMarca && !brandStrict && !hasVisualLabel && !/\b(src\/(renderer|ui|styles|design)\/|mobile\/android\/[\w/.-]*\/ui\/)/.test(text)) {
    const VISUAL_RE = /\b\d+(?:[.,]\d+)?\s*(?:px|dp|sp|rem|em)\b|var\(--[\w-]+\)|\.(?:css|scss|less)\b|\b(?:raio|altura|largura|fonte|espa[cç]amento|padding|margem|margin|borda|sombra|temas?|densidades?|alinhamento|geometria|tokens?|cores?|contraste|tamanho)\b|\bBRD-\d+\b/i;
    if (!VISUAL_RE.test(text)) return { isUi: false, gaps: [], behavior_component_exempt: true };
  }
  const gaps = [];
  if (!/\bBRD-\d+\b/.test(text) && !/\bsem BRD\b|\bBRD:\s*(nenhum|n\/a|—|-)|\bfun[cç][aã]o nova\b|\bnova fun[cç][aã]o\b/i.test(text)) gaps.push('qual é o BRD-n deste card? (a referência do rebranding; sem BRD, escreva "BRD: nenhum (função nova)")');
  const target = /(\.brand-audit\/|playground|src\/[\w/.-]+\.(tsx?|css|kt|json)|mobile\/android\/[\w/.-]+\.kt|[\w/.-]+\.(png|fig|html)|https?:\/\/claude\.ai\/[\w/-]*artifact\/[\w-]+|\bartefato\s+[A-Za-z0-9]{12,})/.test(text);
  if (!target) gaps.push('qual é o alvo aprovado (arquivo, playground ou artefato da marca)?');
  const measured = crit.filter((c) => (
    /\b\d+(?:[.,]\d+)?\s*(?:px|dp|sp|ms)\b|var\(--[\w-]+\)|--[a-z][\w-]+|Oxe(?:Radius|Theme|Space)\.\w+|\b(?:raio|altura|fonte|peso)\s+\d+|\bforced-colors\b/i.test(c.text)
    || /\b(?:Highlight(?:Text)?|Canvas(?:Text)?)\b/.test(c.text)
  ));
  if (!crit.length || !measured.length) gaps.push('quais medidas os critérios conferem (altura, fonte, raio, cor como token)?');
  if (!/(dois temas|ambos os temas|claro e (o )?escuro|escuro e (o )?claro|noite e (o )?dia|light and dark|dark and light)/i.test(text)) gaps.push('as medidas valem nos dois temas (claro e escuro)?');
  if (!/(duas densidades|compacta e (a )?confortável|confortável e (a )?compacta|data-density|densidade)/i.test(text)) gaps.push('as medidas valem nas duas densidades (compacta e confortável)?');
  return { isUi: true, gaps };
}

/** The refine moves its own stages (when mapped and in alm.track): refinement while writing, then ready or back to grooming. */
async function refineMove(lib, cfg, key, stage, options) {
  if (!cfg.states[stage] || !cfg.track.includes(stage)) return { stage, skipped: true, why: !cfg.states[stage] ? `etapa "${stage}" sem estado em alm.states: nada movido` : `etapa "${stage}" fora de alm.track: nada movido` };
  try {
    const prov = lib.provider(cfg, options);
    if (typeof prov.status === 'function') {
      const live = await prov.status(key);
      const liveStage = lib.STAGES.find((s) => cfg.states[s] && live && String(cfg.states[s]).toLowerCase() === String(live).toLowerCase()) || null;
      const movable = ['intake', 'grooming', 'refinement'];
      if (!liveStage || !movable.includes(liveStage)) return { stage, skipped: true, state: live, why: liveStage ? `o card está em "${live}" (${liveStage}): o refine só move cards antes de "pronto"` : `estado "${live}" sem etapa mapeada: nada movido` };
      if (String(live).toLowerCase() === String(cfg.states[stage]).toLowerCase()) return { stage, state: live, changed: false };
      if (options.dryRun) return { stage, planned: true, from: live, state: cfg.states[stage] };
    } else if (options.dryRun) return { stage, planned: true, state: cfg.states[stage] };
    const r = await prov.transition(key, cfg.states[stage]);
    return { stage, state: r.status, changed: r.changed };
  } catch (err) { return { stage, error: err.message }; }
}

function createAlmRefineRuntime(deps) {
  const {
    readProjectConfig,
    resolveRuntimeArtifactPaths,
    readTextIfExists,
    writeTextAtomic,
    appendEvent,
    readEvents,
    readRunState,
    readPlanJsonDoc,
    activeProgramPhase,
    prdPathFor,
    grillPaths,
    runtimeProgramPhaseEdit,
    detectMergedPrs,
  } = deps;

  /**
   * `oxe-cc alm status|push|sync|move|link|defect`. Async (network). With `dryRun` nothing is written anywhere.
   */
  async function runtimeAlm(projectRoot, activeSession, options = {}) {
    const lib = require('../oxe-alm.cjs');
    const config = readProjectConfig(projectRoot) || {};
    const cfg = lib.almConfig(config, { defaultProgram: path.basename(path.resolve(projectRoot)) });
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const env = options.env || process.env;
    const problems = lib.checkConfig(cfg, env);
    if ((options.action === 'status' || !options.action) && options.ref) {
      if (!cfg) return { configured: false, key: options.ref, why: 'ALM não configurado aqui' };
      const item = lib.resolveItem(programDir, cfg, options.ref);
      if (!item) throw new Error(`${options.ref}: não é uma chave deste projeto (${cfg.provider === 'jira' ? `${cfg.p.project}-n` : 'número'})`);
      const prov = lib.provider(cfg, { http: options.http, env, sleep: options.sleep, readOnly: true });
      const state = typeof prov.status === 'function' && !prov.deferred ? await prov.status(item.key) : null;
      const stage = lib.STAGES.find((s) => cfg.states[s] && state && String(cfg.states[s]).toLowerCase() === String(state).toLowerCase()) || null;
      return { configured: true, key: item.key, ref: item.direct ? null : item.ref, state, stage };
    }
    if (options.action === 'status' || !options.action) {
      const st = lib.readState(programDir);
      return { configured: Boolean(cfg), provider: cfg ? cfg.provider : 'none', transport: cfg ? cfg.transport : null, problems, links: lib.links(programDir).size, pending: (st.pending || []).length, queue: lib.readQueue(programDir).ops.length, last_sync: st.last_sync || null, auto: cfg ? cfg.auto : false };
    }
    if (options.action === 'queue') {
      return { provider: cfg ? cfg.provider : 'none', transport: cfg ? cfg.transport : null, ops: lib.pendingOps(programDir) };
    }
    if (!cfg) throw new Error('ALM não configurado: defina "alm": { "provider": "jira" | "azure-devops", … } no .oxe/config.json (sem ALM, o OXE segue normalmente)');
    if (options.action === 'list') {
      const states = String(options.state || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!states.length) throw new Error('uso: oxe-cc alm list --state "<estado do quadro>"[,…] [--with-prs] [--json]');
      if (problems.length) throw new Error(`ALM: ${problems.join('; ')}`);
      const prov = lib.provider(cfg, { http: options.http, env, sleep: options.sleep, readOnly: true });
      if (prov.deferred) throw new Error('alm list lê o quadro pela API REST; com alm.transport "mcp", consulte pela ferramenta MCP da sessão');
      if (typeof prov.searchByStates !== 'function') throw new Error(`${cfg.provider}: alm list ainda não suportado`);
      const cards = await prov.searchByStates(states);
      if (options.withPrs) {
        const byKey = require('../oxe-alm-prs.cjs').mergedPrsByKey(projectRoot, cfg, { ghSpawn: options.ghSpawn, repo: options.repo });
        for (const card of cards) card.prs = byKey.get(String(card.key).toUpperCase()) || [];
      }
      return { states, count: cards.length, cards, with_prs: Boolean(options.withPrs) };
    }
    if (options.action === 'pr-merged' && !options.apply) options = { ...options, dryRun: true };
    const dryRun = lib.isDry(cfg, options);
    if (problems.length && !dryRun) throw new Error(`ALM: ${problems.join('; ')}`);
    const net = { http: options.http, env, sleep: options.sleep, provider: options.provider, retries: options.retries, dryRun, apply: options.apply, readOnlyLookup: dryRun && !problems.length };
    const phase = activeProgramPhase(projectRoot, activeSession);
    const WRITES = ['push', 'sync', 'move', 'defect', 'ack', 'link', 'label', 'version', 'summary', 'supersede', 'pr-merged'];
    const writes = WRITES.includes(options.action) || (options.action === 'pending' && options.sub === 'apply');
    if ((writes || options.action === 'comment') && !dryRun && !options.auto) lib.warnApply(cfg, options);
    if (writes && !dryRun) {
      if (!lib.isWriter(cfg, env)) throw lib.writerError(cfg);
      if (['push', 'sync', 'defect', 'pr-merged'].includes(options.action) && !options.noLock) {
        return lib.withWriteLock(programDir, () => runtimeAlm(projectRoot, activeSession, { ...options, noLock: true }));
      }
    }
    if (options.action === 'comment') {
      const ref = /^T\d+$/i.test(options.ref || '') ? lib.taskRef(phase ? phase.id : null, options.ref.toUpperCase()) : options.ref;
      return lib.comment(programDir, cfg, ref, options.text || options.comment, net);
    }
    if (options.action === 'pr-merged') {
      const prsLib = require('../oxe-alm-prs.cjs');
      const out = await prsLib.prMerged(projectRoot, programDir, cfg, lib, { pr: options.pr, repo: options.repo, ghSpawn: options.ghSpawn, apply: !dryRun, net, prData: options.prData });
      if (!out.dry_run) appendEvent(projectRoot, activeSession, { type: 'AlmPrMerged', payload: { pr: out.pr, moved: out.moved.map((m) => m.key), commented: out.commented, bare: out.bare, errors: out.errors } });
      return out;
    }
    if (options.action === 'ack') {
      if (!options.ref) throw new Error('uso: oxe-cc alm ack <id-da-operação|US-n|Fn-Tn> [--key <chave>] [--url <url>] [--error "…"]');
      const ref = /^T\d+$/i.test(options.ref) ? lib.taskRef(phase ? phase.id : null, options.ref.toUpperCase()) : options.ref;
      const out = lib.ack(programDir, cfg, ref, { key: options.key, url: options.url, error: options.error, adopted: options.adopted });
      if (out.done) appendEvent(projectRoot, activeSession, { type: 'AlmAcked', payload: { id: out.id, key: options.key || null } });
      return out;
    }
    if (options.action === 'push') {
      const prdFile = prdPathFor(projectRoot, activeSession);
      const prd = fs.existsSync(prdFile) ? require('../oxe-prd.cjs').readPrd(prdFile) : null;
      const doc = readPlanJsonDoc(projectRoot, activeSession).doc;
      const wantStories = options.stories !== false;
      const wantTasks = options.tasks !== false;
      const title = (() => { const m = prd && /^#\s+(?:PRD\s+[—-]\s+)?(.+)$/m.exec(readTextIfExists(prdFile) || ''); return m ? m[1].trim() : null; })();
      const out = await lib.push(programDir, cfg, {
        stories: wantStories && prd ? prd.stories : [],
        tasks: wantTasks && doc ? doc.tasks || [] : [],
        phase: phase ? phase.id : (doc && doc.phase) || null,
        epicTitle: title && !/^\(/.test(title) ? title : null,
        dryRun,
        rebuild: Boolean(options.rebuildLedger),
        firstPush: Boolean(options.firstPush),
      }, net);
      if (!dryRun) appendEvent(projectRoot, activeSession, { type: 'AlmPushed', payload: { created: out.created.length, reused: out.reused.length, failed: out.failed.length } });
      return { provider: cfg.provider, dry_run: dryRun, ...out };
    }
    if (options.action === 'sync') {
      if (!dryRun) { try { detectMergedPrs(projectRoot, activeSession, readEvents(projectRoot, activeSession), options); } catch { /* sem gh: segue */ } }
      const events = readEvents(projectRoot, activeSession);
      const links = lib.links(programDir);
      const doc = readPlanJsonDoc(projectRoot, activeSession).doc;
      const phaseId = phase ? phase.id : (doc && doc.phase) || null;
      const refsOfPhase = (ph) => [...links.keys()].filter((ref) => (ph ? ref.startsWith(`${ph}-`) : /^(F\d+-)?T\d+/.test(ref)) || /^US-/.test(ref));
      const releasedEnv = config.alm && typeof config.alm.released_env === 'string' ? config.alm.released_env : null;
      const out = await lib.sync(programDir, cfg, events, { phase: phaseId, refsOfPhase, releasedEnv }, net);
      return { provider: cfg.provider, dry_run: dryRun, ...out };
    }
    if (options.action === 'move') {
      const ref = /^T\d+$/i.test(options.ref || '') ? lib.taskRef(phase ? phase.id : null, options.ref.toUpperCase()) : options.ref;
      return lib.move(programDir, cfg, ref, options.stage, { ...net, comment: options.comment });
    }
    if (options.action === 'label') return lib.labelItem(programDir, cfg, options.ref, options.add, { ...net, remove: options.remove });
    if (options.action === 'pending') {
      if (options.sub !== 'apply') return { pending: lib.listPending(projectRoot) };
      const out = await lib.applyPending(projectRoot, programDir, cfg, net);
      if (!dryRun) appendEvent(projectRoot, activeSession, { type: 'AlmPendingApplied', payload: { applied: out.applied.length, failed: out.failed.length } });
      let synced = null;
      try { synced = await runtimeAlm(projectRoot, activeSession, { ...options, action: 'sync', noLock: false }); } catch (err) { synced = { error: err.message }; }
      return { dry_run: dryRun, ...out, sync: synced };
    }
    if (options.action === 'supersede') {
      const out = await lib.supersede(programDir, cfg, options.ref, options.newKeys, { ...net, comment: options.comment, closeTo: options['close-to'] || options.closeTo, noClose: Boolean(options.noClose) });
      if (out.applied) appendEvent(projectRoot, activeSession, { type: 'AlmSuperseded', payload: { key: out.key, by: out.by, link_type: out.link_type, status: out.status } });
      return { dry_run: dryRun, ...out };
    }
    if (options.action === 'summary') return { dry_run: dryRun, ...(await lib.setItemSummary(programDir, cfg, options.ref, options.summary, { ...net, comment: options.comment })) };
    if (options.action === 'version') return { dry_run: dryRun, ...(await lib.setItemVersion(programDir, cfg, options.ref, options.version, { ...net, comment: options.comment })) };
    if (options.action === 'link' && options.relates) return lib.relateItems(programDir, cfg, options.ref, options.relates, net);
    if (options.action === 'link' && options.pr) {
      return lib.linkPr(programDir, cfg, options.ref, { pr: options.pr, repo: options.repo || (config.alm && config.alm.docs && config.alm.docs.repo) || null, title: options.title }, net);
    }
    if (options.action === 'link') {
      if (!options.ref || !options.key) throw new Error('uso: oxe-cc alm link <US-n|Tn> <chave> · oxe-cc alm link <chave> --pr <n> [--repo <url>]');
      const ref = /^T\d+$/i.test(options.ref) ? lib.taskRef(phase ? phase.id : null, options.ref.toUpperCase()) : options.ref;
      let prev = null;
      try {
        for (const line of fs.readFileSync(path.join(programDir, 'alm-links.ndjson'), 'utf8').split(/\r?\n/)) {
          let r = null;
          try { r = JSON.parse(line); } catch { r = null; }
          if (r && r.ref === ref) prev = { ...(prev || {}), ...r };
        }
      } catch { prev = null; }
      if (prev) delete prev.at;
      if (options.kind && !['bug', 'task', 'story', 'epic'].includes(String(options.kind))) throw new Error(`--kind ${options.kind}: use bug | task | story | epic`);
      if (options.cr && !require('../oxe-change.cjs').listChanges(programDir).some((c) => c.id === options.cr)) throw new Error(`${options.cr}: CR inexistente (oxe-cc runtime feedback list)`);
      const kind = options.kind ? String(options.kind) : prev && prev.kind ? prev.kind : /^US-/.test(ref) ? 'story' : 'task';
      const rec = { ...(prev || {}), ref, key: options.key, kind, provider: cfg.provider, manual: true, ...(options.cr ? { cr: String(options.cr) } : {}) };
      if (!dryRun) { lib.addLink(programDir, rec); lib.dropEnsure(programDir, ref); }
      return { ref, key: options.key, kind: rec.kind, ...(rec.cr ? { cr: rec.cr } : {}), dry_run: dryRun };
    }
    if (options.action === 'defect') {
      const ref = options.ref || `BUG-${Date.now().toString(36).toUpperCase()}`;
      if (options.cr && !require('../oxe-change.cjs').listChanges(programDir).some((c) => c.id === options.cr)) throw new Error(`${options.cr}: CR inexistente (oxe-cc runtime feedback list)`);
      return lib.reportDefect(programDir, cfg, { ref, title: options.title || 'defeito', description: options.description, origin: options.origin, cr: options.cr }, net);
    }
    throw new Error(`alm ${options.action}: ação desconhecida (status | push | sync | move | link | defect | comment | queue | ack)`);
  }

  /** `oxe-cc alm refine import <KEY…> [--risk P2] [--phase Fn] [--dry-run] --by <papel>`. */
  function runtimeAlmRefineImport(projectRoot, activeSession, options = {}) {
    const refine = require('../oxe-alm-refine.cjs');
    const specEdit = require('../oxe-spec-edit.cjs');
    const changeLib = require('../oxe-change.cjs');
    const keysAll = (options.keys || []).map((k) => String(k).toUpperCase());
    const d = refine.dirs(projectRoot);
    const catalog = refine.discoverProgramCatalog(projectRoot, { activeSession, programRoots: options.programRoots || null });
    let targetRoot = projectRoot;
    let targetSession = activeSession;
    let targetSlug = null;
    let explicitTarget = null;
    if (options.spec) {
      explicitTarget = refine.resolveProgramSpec(projectRoot, activeSession, options.spec, { catalogCache: catalog, programRoots: options.programRoots || null });
      if (!explicitTarget || !explicitTarget.specPath) {
        throw new Error(`--spec "${options.spec}" não encontrado ou sem SPEC.md`);
      }
      targetRoot = explicitTarget.root;
      targetSession = targetRoot === path.resolve(projectRoot) ? activeSession : null;
      targetSlug = targetRoot !== path.resolve(projectRoot) ? explicitTarget.slug : null;
    } else if (keysAll.length) {
      const resolvedTargets = [];
      for (const key of keysAll) {
        const mdPath = path.join(d.specs, `${key}.md`);
        if (!fs.existsSync(mdPath)) continue;
        const mdText = fs.readFileSync(mdPath, 'utf8');
        const r = refine.resolveCardProgram(projectRoot, activeSession, { key, md: mdText, catalogCache: catalog, programRoots: options.programRoots || null });
        if (r && r.entry && r.matchedBy !== 'dir_default') resolvedTargets.push(r.entry);
      }
      const distinctRoots = [...new Set(resolvedTargets.map((e) => e.root))];
      if (distinctRoots.length > 1) {
        throw new Error(`os cards pertencem a programas diferentes (${[...new Set(resolvedTargets.map((e) => e.slug))].join(', ')}): informe --spec <programa|caminho> ou rode por card`);
      }
      if (distinctRoots.length === 1 && distinctRoots[0] !== path.resolve(projectRoot)) {
        explicitTarget = resolvedTargets[0];
        targetRoot = explicitTarget.root;
        targetSession = null;
        targetSlug = explicitTarget.slug;
      }
    }
    const paths = resolveRuntimeArtifactPaths(targetRoot, targetSession);
    const specPath = (explicitTarget && explicitTarget.specPath) || paths.spec;
    if (!specPath || !fs.existsSync(specPath)) throw new Error('SPEC.md ausente: o import leva os critérios do card para a SPEC do programa (/oxe-spec primeiro)');
    if (!options.dryRun && !options.by) throw new Error('o import emenda a SPEC: informe --by <papel>');
    let specText = fs.readFileSync(specPath, 'utf8');
    const programDir = (explicitTarget && explicitTarget.programDir) || paths.programDir || path.join(targetRoot, '.oxe', 'program');
    const results = [];
    let program = null;
    try { program = require('../oxe-program.cjs').readProgram(programDir); } catch { program = null; }
    const phases = (program && program.phases) || [];
    const frozen = (ph) => Boolean(ph) && (['executing', 'verifying', 'closed'].includes(ph.status) || Boolean(ph.run_id));
    const phaseOfA = (a) => phases.find((ph) => (ph.acceptance || []).includes(a)) || null;
    const activePh = program && program.active_phase ? phases.find((ph) => ph.id === String(program.active_phase).toUpperCase()) || null : null;
    const relSpec = path.relative(projectRoot, specPath).replace(/\\/g, '/');
    if (options.phase) {
      const target = phases.find((ph) => ph.id === String(options.phase).toUpperCase());
      if (target && frozen(target)) {
        const cas = keysAll.join(', ');
        return {
          dry_run: true,
          refused: true,
          spec: relSpec,
          ...(targetSlug ? { program: targetSlug } : {}),
          reason: `a fase ${target.id} está ${target.status}${target.run_id ? ' (com run)' : ''}: os arquivos dela estão congelados e nada foi escrito. Critério novo entra por CR nesta fase ou numa fase posterior`,
          commands: [
            `oxe-cc runtime feedback --class new_scope --summary "critérios dos cards refinados ${cas}" --by <papel>`,
            `oxe-cc alm refine import ${keysAll.join(' ')}${options.spec ? ` --spec ${options.spec}` : ''} --phase <fase ainda não iniciada> --by <papel>`,
          ],
          results: [],
        };
      }
    }
    const specCriteria = new Map(require('../oxe-spec-check.cjs').criteria(specText).list.map((c) => [c.id, c]));
    const norm = (t) => String(t || '').replace(/\([A-Z][A-Z0-9]+-\d+\)/g, '').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const key of keysAll) {
      const specFile = path.join(d.specs, `${key}.md`);
      if (!fs.existsSync(specFile)) { results.push({ key, error: `sem spec refinado: oxe-cc alm refine ${key}` }); continue; }
      let md = fs.readFileSync(specFile, 'utf8');
      const criteria = refine.parseCriteria(md);
      const existing = specEdit.criteriaIds(specText);
      const added = new Map();
      const out = { key, criteria_count: criteria.length, added: [], linked: [], problems: [] };
      if (!criteria.length) {
        out.problems.push(`0 critérios lidos em ${key}.md (esperado "1. **CA-n** — Dado … · Teste: …" ou "- CA-n — …")`);
      }
      for (const c of criteria) {
        if (c.spec_id) {
          if (c.spec_program) {
            const critProg = refine.resolveProgramSpec(projectRoot, activeSession, c.spec_program, { catalogCache: catalog, programRoots: options.programRoots || null });
            if (!critProg || path.resolve(critProg.root) !== path.resolve(targetRoot)) {
              out.linked.push({ ca: c.id, a: `${c.spec_program}:${c.spec_id}` });
              continue;
            }
          }
          if (!existing.includes(c.spec_id)) out.problems.push(`${c.id} aponta para ${c.spec_id}, que não existe na SPEC${targetSlug ? ` de ${targetSlug}` : ''}`);
          else {
            const row = String(specText).split(/\r?\n/).find((l) => new RegExp(`^\\|\\s*\\**${c.spec_id}\\**\\s*\\|`).test(l)) || '';
            const ph = phaseOfA(c.spec_id);
            const isFrozen = frozen(ph);
            if (!row.includes(key)) {
              out.problems.push(isFrozen
                ? `${c.spec_id} (de ${c.id}) não cita ${key}, e a fase ${ph.id} está ${ph.status}: registre a ligação por CR — oxe-cc runtime feedback --class spec_gap --criteria ${c.spec_id} --summary "${c.spec_id} é o ${c.id} de ${key}" --additive --by <papel>`
                : `${c.spec_id} (de ${c.id}) não cita ${key} na SPEC — emende com oxe-cc spec amend ${c.spec_id} --append "(${key})"`);
            }
            const a = specCriteria.get(c.spec_id);
            if (a && norm(a.text) && norm(c.text) && norm(a.text) !== norm(c.text)) {
              out.proposals = out.proposals || [];
              out.proposals.push(isFrozen
                ? { ca: c.id, a: c.spec_id, frozen: true, command: `oxe-cc runtime feedback --class spec_gap --criteria ${c.spec_id} --amend-to <N> --summary "${key} ${c.id}: ${c.text.slice(0, 80)}" --by <papel>`, why: `${c.spec_id} pertence à fase ${ph.id} (${ph.status}): o teste congelado dela ganha uma versão nova (vN), não é trocado` }
                : { ca: c.id, a: c.spec_id, frozen: false, command: `oxe-cc spec amend ${c.spec_id} --text "${c.text.replace(/"/g, '\\"').slice(0, 160)} (${key})" --by <papel> --reason "alm refine ${key} ${c.id}"`, why: `o ${c.id} do card diz outra coisa que o ${c.spec_id} da SPEC` });
            }
            out.linked.push({ ca: c.id, a: c.spec_id });
          }
          continue;
        }
        if (!c.test || refine.TBC_RE.test(c.test)) { out.problems.push(`${c.id} sem teste: não vira critério da SPEC (rode o lint do refine)`); continue; }
        const max = [...existing, ...added.values()].filter((x) => /^A\d+$/.test(x)).reduce((m, x) => Math.max(m, Number(x.slice(1))), 0);
        const id = `A${max + 1}`;
        try {
          const edit = specEdit.addCriterion(specText, id, { text: `${c.text} (${key})`, verify: c.test, risk: c.risk || options.risk });
          specText = edit.text;
          added.set(c.id, id);
          out.added.push({ ca: c.id, a: id, row: edit.after });
        } catch (err) { out.problems.push(`${c.id}: ${err.message}`); }
      }
      if (!options.dryRun && added.size) {
        md = refine.setSpecIds(md, added, targetSlug ? { program: targetSlug } : {});
        fs.writeFileSync(specFile, md);
        for (const a of out.added) changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'spec_edit', action: 'add_criterion', id: a.a, by: options.by, reason: `alm refine import ${key} ${a.ca}`, origin: 'alm_refine', at: new Date().toISOString(), after: a.row });
      }
      results.push(out);
    }
    let assignedPhase = null;
    let phaseWarning = null;
    const addedIds = results.flatMap((r) => (r.added || []).map((a) => a.a));
    if (!options.dryRun && addedIds.length) {
      writeTextAtomic(specPath, specText);
      appendEvent(targetRoot, targetSession, { type: 'SpecEdited', payload: { action: 'alm_refine_import', keys: results.map((r) => r.key), added: addedIds } });
      const targetPhaseId = options.phase
        ? String(options.phase).toUpperCase()
        : (activePh && !frozen(activePh) ? activePh.id : null);
      if (targetPhaseId) {
        try {
          runtimeProgramPhaseEdit(targetRoot, targetSession, { phase: targetPhaseId, addAcceptance: addedIds.join(','), by: options.by, reason: `alm refine import ${results.map((r) => r.key).join(', ')}` });
          assignedPhase = targetPhaseId;
        } catch (err) {
          if (options.phase) {
            results.push({ key: '(fase)', problems: [`os critérios entraram na SPEC, mas não na fase ${targetPhaseId}: ${err.message}`], added: [], linked: [] });
          } else {
            phaseWarning = `critério(s) ${addedIds.join(', ')} adicionado(s) na SPEC sem fase ("fase -"): ${err.message}`;
          }
        }
      } else if (program) {
        phaseWarning = `critério(s) ${addedIds.join(', ')} adicionado(s) na SPEC sem fase ("fase -")${activePh ? ` porque a fase ativa ${activePh.id} está ${activePh.status}` : ''} — vincule à fase (oxe-cc runtime program phase edit ${activePh ? activePh.id : '<Fn>'} --add-acceptance ${addedIds.join(',')} --by ${options.by || '<papel>'} --reason "…" ou via --phase <Fn> / CR) antes de plan append`;
      }
    }
    return {
      dry_run: Boolean(options.dryRun),
      spec: relSpec,
      ...(targetSlug ? { program: targetSlug } : {}),
      ...(assignedPhase ? { phase: assignedPhase } : {}),
      ...(phaseWarning ? { phase_warning: phaseWarning } : {}),
      results,
    };
  }

  /** The snapshot oxe-trace.cjs builds the graph from: every artifact's own ids and references, read-only. */
  function traceSnapshot(projectRoot, activeSession) {
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const config = readProjectConfig(projectRoot) || {};
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const prdLib = require('../oxe-prd.cjs');
    const specCheck = require('../oxe-spec-check.cjs');
    const refine = require('../oxe-alm-refine.cjs');
    const almLib = require('../oxe-alm.cjs');
    const prdFile = prdPathFor(projectRoot, activeSession);
    const prd = fs.existsSync(prdFile) ? prdLib.readPrd(prdFile) : null;
    const specText = readTextIfExists(paths.spec) || '';
    let doc = null;
    try { doc = readPlanJsonDoc(projectRoot, activeSession).doc; } catch { doc = null; }
    const cardSpecs = new Map();
    const specsDir = refine.dirs(projectRoot).specs;
    if (fs.existsSync(specsDir)) for (const f of fs.readdirSync(specsDir).filter((x) => /\.md$/.test(x))) cardSpecs.set(f.replace(/\.md$/, ''), refine.parseCriteria(fs.readFileSync(path.join(specsDir, f), 'utf8')));
    let almCfg = null;
    try { almCfg = almLib.almConfig(config, { defaultProgram: path.basename(path.resolve(projectRoot)) }); } catch { almCfg = null; }
    let run = null;
    try { run = readRunState(projectRoot, activeSession); } catch { run = null; }
    const phase = activeProgramPhase(projectRoot, activeSession);
    return {
      stories: prd ? prd.stories : [],
      criteria: specCheck.criteria(specText).list,
      requirements: specCheck.requirements(specText),
      decisions: require('../oxe-decisions.cjs').list(programDir),
      rfcs: require('../oxe-rfc.cjs').list(projectRoot),
      tasks: (doc && doc.tasks) || [],
      tests: (doc && doc.acceptance_tests) || [],
      changes: require('../oxe-change.cjs').listChanges(programDir),
      links: almLib.links(programDir),
      knownFailureItems: (() => { try { return new Set(require('../oxe-known-failures.cjs').listAll(projectRoot, programDir).filter((k) => !k.expired).map((k) => String(k.item).toUpperCase())); } catch { return new Set(); } })(),
      cardSpecs,
      checks: (run && run.verification_check_results) || [],
      phase: phase ? phase.id : (doc && doc.phase) || null,
      phaseCriteria: phase && Array.isArray(phase.acceptance) && phase.acceptance.length ? [...phase.acceptance, ...require('../oxe-criteria-ids.cjs').standingAcceptance(projectRoot)] : null,
      almConfigured: Boolean(almCfg),
      storiesSource: almCfg ? almCfg.stories_source : 'prd',
      cardKeysOf: prdLib.cardKeys,
      _cfg: almCfg,
      _config: config,
      _programDir: programDir,
    };
  }

  /** alm.trace_gate: the traceability orphans in the gates. */
  function traceGateFindings(projectRoot, activeSession, stage) {
    const config = readProjectConfig(projectRoot) || {};
    const mode = config.alm && ['warn', 'close', 'strict'].includes(config.alm.trace_gate) ? config.alm.trace_gate : null;
    if (!mode) return { errors: [], warnings: [], mode: null };
    const graph = require('../oxe-trace.cjs').build(traceSnapshot(projectRoot, activeSession));
    const blocking = mode === 'strict' || (mode === 'close' && stage === 'close');
    const lines = graph.orphans.map((o) => `rastreabilidade: ${o.kind} ${o.id}: ${o.why} — ${o.fix}`);
    return blocking ? { errors: lines, warnings: [], mode } : { errors: [], warnings: lines, mode };
  }

  /** `oxe-cc alm intake | doctor | version ensure | usage`. */
  async function runtimeAlmAdmin(projectRoot, activeSession, options = {}) {
    const lib = require('../oxe-alm.cjs');
    const admin = require('../oxe-alm-admin.cjs');
    if (options.action === 'usage') return admin.usageReport(projectRoot);
    const config = readProjectConfig(projectRoot) || {};
    const cfg = lib.almConfig(config, { defaultProgram: path.basename(path.resolve(projectRoot)) });
    if (!cfg) throw new Error('ALM não configurado: veja o exemplo em oxe/templates/CONFIG.md (seção ALM) ou rode /oxe-alm setup');
    if (cfg.provider !== 'jira') throw new Error(`alm ${options.action}: por enquanto só Jira`);
    const env = options.env || process.env;
    const problems = lib.checkConfig(cfg, env);
    const offlineIntake = options.action === 'intake' && lib.isDry(cfg, options) && problems.length > 0;
    if (problems.length && !offlineIntake) throw new Error(`ALM: ${problems.join('; ')}`);
    if (offlineIntake) options = { ...options, offline: true };
    if (options.action === 'doctor') return admin.doctor(lib.jiraRest(cfg, { ...options, readOnly: true }), cfg);
    options = { ...options, dryRun: lib.isDry(cfg, options) };
    const rest = lib.jiraRest(cfg, options);
    if (!options.dryRun && !lib.isWriter(cfg, env)) throw lib.writerError(cfg);
    if (!options.dryRun) lib.warnApply(cfg, options);
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    if (options.action === 'version') return admin.versionEnsure(rest, cfg, options.name, options);
    if (options.action === 'priority') {
      const out = await admin.setPriority(rest, cfg, options.key, options.name, options);
      if (!out.planned) appendEvent(projectRoot, activeSession, { type: 'AlmPrioritySet', payload: { key: out.key, priority: out.priority, confirmed: out.confirmed } });
      return out;
    }
    if (options.action === 'intake') {
      let fromText = null;
      if (options.from && !/^https?:\/\//i.test(options.from)) {
        const f = path.resolve(projectRoot, options.from);
        if (!fs.existsSync(f)) throw new Error(`--from ${options.from}: arquivo não encontrado`);
        fromText = fs.readFileSync(f, 'utf8');
      }
      const out = await admin.intake(rest, cfg, { ...options, fromText }, { programDir, options: { ...options, env } });
      if (out.created) appendEvent(projectRoot, activeSession, { type: 'AlmIntake', payload: { ref: out.ref, key: out.key, type: options.type } });
      return out;
    }
    throw new Error(`alm ${options.action}: ação desconhecida`);
  }

  /** `oxe-cc trace` and `oxe-cc trace publish [--apply]`. */
  async function runtimeTrace(projectRoot, activeSession, options = {}) {
    const snap = traceSnapshot(projectRoot, activeSession);
    const graph = require('../oxe-trace.cjs').build(snap);
    fs.mkdirSync(path.join(projectRoot, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.oxe', 'trace.json'), JSON.stringify({ at: new Date().toISOString(), ...graph }, null, 2));
    if (options.action !== 'publish') return { file: '.oxe/trace.json', ...graph };
    const lib = require('../oxe-alm.cjs');
    const cfg = snap._cfg;
    if (!cfg) throw new Error('trace publish escreve nos cards: configure alm.provider');
    const docs = snap._config.alm && snap._config.alm.docs && typeof snap._config.alm.docs === 'object' ? snap._config.alm.docs : null;
    const dirRel = (docs && docs.dir) || (snap._config.docs_publish && snap._config.docs_publish.dir) || 'docs';
    const docsBase = docs && docs.repo ? `${String(docs.repo).replace(/\/+$/, '')}/blob/${docs.branch || 'main'}/${dirRel}` : null;
    const adrDirAbs = path.join(projectRoot, require('../oxe-adr.cjs').adrDir(snap._config) || 'docs/adr');
    const adrFiles = fs.existsSync(adrDirAbs) ? fs.readdirSync(adrDirAbs) : [];
    const adrFile = (id) => adrFiles.find((f) => f.startsWith(`${id}-`)) || null;
    const trace = require('../oxe-trace.cjs');
    const posts = [];
    for (const st of graph.stories.filter((x) => x.card)) posts.push({ key: st.card, text: trace.cardDocs({ story: st.id, criteria: st.criteria, decisions: st.decisions }, { docsBase, adrFile }) });
    const critById = new Map(graph.criteria.map((c) => [c.id, c]));
    const decTitle = new Map(snap.decisions.map((d) => [d.id, d.title]));
    for (const t of graph.tasks.filter((x) => x.card)) {
      const crit = t.criteria.map((a) => ({ id: a, evidence: critById.get(a) ? critById.get(a).evidence : null, tests: critById.get(a) ? critById.get(a).tests : [], changes: critById.get(a) ? critById.get(a).changes : [] }));
      const decs = [...new Set([...t.decisions, ...t.criteria.flatMap((a) => (critById.get(a) ? critById.get(a).decisions : []))])].map((id) => ({ id, title: decTitle.get(id) || null }));
      posts.push({ key: t.card, text: trace.cardDocs({ criteria: crit, decisions: decs }, { docsBase, adrFile }) });
    }
    if (!options.apply) return { file: '.oxe/trace.json', dry_run: true, publish: posts.map((p) => ({ key: p.key, lines: p.text.split('\n').length, text: p.text })), ...graph };
    const env = options.env || process.env;
    if (!lib.isWriter(cfg, env)) throw lib.writerError(cfg);
    if (cfg.transport === 'mcp') {
      lib.enqueue(snap._programDir, posts.map((p) => ({ id: `docs:${p.key}`, op: 'comment', ref: p.key, key: p.key, upsert_marker: 'Documentos (OXE)', comments: [p.text] })));
      return { file: '.oxe/trace.json', queued: posts.length, ...graph };
    }
    const problems = lib.checkConfig(cfg, env);
    if (problems.length) throw new Error(`ALM: ${problems.join('; ')}`);
    const rest = lib.jiraRest(cfg, options);
    const refine = require('../oxe-alm-refine.cjs');
    const done = [];
    for (const p of posts) {
      try {
        const r = await rest.request('GET', `${rest.site}/rest/api/3/issue/${p.key}/comment?maxResults=100`);
        const mine = ((r && r.comments) || []).find((c) => refine.adfToText(c.body).trim().startsWith('Documentos (OXE)'));
        const body = { body: refine.mdToAdf(p.text) };
        if (mine) await rest.request('PUT', `${rest.site}/rest/api/3/issue/${p.key}/comment/${mine.id}`, body);
        else await rest.request('POST', `${rest.site}/rest/api/3/issue/${p.key}/comment`, body);
        done.push({ key: p.key, updated: Boolean(mine) });
      } catch (err) { done.push({ key: p.key, error: err.message }); }
    }
    appendEvent(projectRoot, activeSession, { type: 'TracePublished', payload: { cards: done.length, failed: done.filter((d) => d.error).length } });
    return { file: '.oxe/trace.json', published: done, ...graph };
  }

  /** `oxe-cc alm metrics [--jql "…"] [--max N]`. */
  async function runtimeAlmMetrics(projectRoot, activeSession, options = {}) {
    const lib = require('../oxe-alm.cjs');
    const metrics = require('../oxe-alm-metrics.cjs');
    const config = readProjectConfig(projectRoot) || {};
    const cfg = lib.almConfig(config, { defaultProgram: path.basename(path.resolve(projectRoot)) });
    if (!cfg || cfg.provider !== 'jira') throw new Error('alm metrics: precisa de alm.provider "jira"');
    const env = options.env || process.env;
    const problems = lib.checkConfig(cfg, env);
    if (problems.length) throw new Error(`ALM: ${problems.join('; ')}`);
    const rest = lib.jiraRest(cfg, options);
    const jql = options.jql || `project = "${cfg.p.project}" AND updated >= -90d ORDER BY created ASC`;
    const max = Number(options.max) > 0 ? Number(options.max) : 300;
    const issues = [];
    let token = null;
    do {
      const r = await rest.request('GET', `${rest.site}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=status,created,issuetype,summary&expand=changelog&maxResults=100${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`);
      for (const i of (r && r.issues) || []) issues.push({ key: i.key, created: i.fields.created, status: i.fields.status ? i.fields.status.name : null, statusId: i.fields.status ? i.fields.status.id : null, summary: i.fields.summary, changes: metrics.changesFromJira(i) });
      token = r && !r.isLast ? r.nextPageToken : null;
    } while (token && issues.length < max);
    metrics.renameByStatusId(issues);
    const out = metrics.compute(issues.slice(0, max), { states: cfg.states, wip: cfg.wip, stages: lib.STAGES }, { now: options.now });
    const dir = path.join(projectRoot, '.oxe', 'alm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify({ jql, at: new Date().toISOString(), ...out }, null, 2));
    fs.writeFileSync(path.join(dir, 'metrics.md'), metrics.renderMarkdown(out, { project: cfg.p.project, jql, doneName: cfg.states.released || cfg.states.integrated }));
    return { jql, file: '.oxe/alm/metrics.md', ...out };
  }

  /** `oxe-cc alm refine <KEY…> | --jql "…" [--max-cards N]` · `lint` · `apply`. */
  async function runtimeAlmRefine(projectRoot, activeSession, options = {}) {
    const lib = require('../oxe-alm.cjs');
    const refine = require('../oxe-alm-refine.cjs');
    const config = readProjectConfig(projectRoot) || {};
    const cfg = lib.almConfig(config, { defaultProgram: path.basename(path.resolve(projectRoot)) });
    if (!cfg) throw new Error('ALM não configurado: alm refine lê os cards do Jira (alm.provider: "jira")');
    if (cfg.provider !== 'jira') throw new Error('alm refine: por enquanto só Jira');
    const env = options.env || process.env;
    const d = refine.dirs(projectRoot);
    const action = options.action || 'collect';
    let keys = (options.keys || []).map((k) => String(k).toUpperCase());
    if (action === 'lint' || action === 'apply') {
      if (!keys.length) keys = fs.existsSync(d.specs) ? fs.readdirSync(d.specs).filter((f) => /\.md$/.test(f)).map((f) => f.replace(/\.md$/, '')) : [];
      const catalogCache = refine.discoverProgramCatalog(projectRoot, { activeSession, programRoots: options.programRoots || null });
      const out = [];
      for (const key of keys) {
        const specFile = path.join(d.specs, `${key}.md`);
        const dataFile = path.join(d.data, `${key}.json`);
        if (!fs.existsSync(specFile) || !fs.existsSync(dataFile)) { out.push({ key, error: `sem coleta: rode oxe-cc alm refine ${key}` }); continue; }
        const collected = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        const md = fs.readFileSync(specFile, 'utf8');
        let resolvedProgram = null;
        try {
          resolvedProgram = refine.resolveCardProgram(projectRoot, activeSession, {
            key,
            md,
            spec: options.spec || null,
            catalogCache,
            programRoots: options.programRoots || null,
          });
        } catch (err) {
          if (action === 'lint') {
            out.push({ key, kind: collected.kind, ok: false, errors: [err.message], warnings: [], questions: [], criteria: [], needs_info: false });
            continue;
          }
          out.push({ key, error: err.message });
          continue;
        }
        const targetEntry = resolvedProgram ? resolvedProgram.entry : null;
        if (action === 'lint') {
          const artRoot = targetEntry ? targetEntry.root : projectRoot;
          const artSess = artRoot === path.resolve(projectRoot) ? activeSession : null;
          const artifacts = (collected && collected.project_artifacts && collected.project_artifacts.has_any)
            ? collected.project_artifacts
            : refine.discoverProjectArtifacts(artRoot, artSess, key);
          const l = refine.lintSpec(md, collected.kind, { artifacts });
          const ui = uiCardGaps(md, collected, { projectRoot: artRoot });
          if (ui.isUi && ui.gaps.length) {
            for (const g of ui.gaps) { l.warnings.push(`interface: ${g}`); l.questions.push(`MARCA: ${g}`); }
            l.needs_info = true;
          }
          const cross = refine.lintCardCriteriaAgainstPrograms(md, key, targetEntry, {
            projectRoot,
            activeSession,
            catalog: catalogCache,
            programRoots: options.programRoots || null,
          });
          if (cross.errors.length) { l.errors.push(...cross.errors); l.ok = false; }
          if (cross.warnings.length) l.warnings.push(...cross.warnings);
          try {
            const glRoot = targetEntry ? targetEntry.root : projectRoot;
            const glSess = glRoot === path.resolve(projectRoot) ? activeSession : null;
            const gl = require('../oxe-grill.cjs').readGlossary(grillPaths(glRoot, glSess).glossary);
            for (const t of gl) for (const syn of t.synonyms || []) {
              if (syn.length >= 3 && wholeWord(syn).test(md)) l.warnings.push(`glossário: "${syn}" é sinônimo proibido de "${t.term}" — use "${t.term}"`);
            }
          } catch { /* sem glossário */ }
          out.push({
            key,
            kind: collected.kind,
            ...(targetEntry && targetEntry.root !== path.resolve(projectRoot) ? { program: targetEntry.slug, spec: path.relative(path.dirname(path.resolve(projectRoot)), targetEntry.specPath || targetEntry.planPath || targetEntry.root).replace(/\\/g, '/') } : {}),
            ...l,
          });
          continue;
        }
        if (options.spec || (resolvedProgram && resolvedProgram.matchedBy !== 'dir_default')) {
          const crossApply = refine.lintCardCriteriaAgainstPrograms(md, key, targetEntry, {
            projectRoot,
            activeSession,
            catalog: catalogCache,
            programRoots: options.programRoots || null,
          });
          if (crossApply.errors.length) {
            out.push({ key, error: `spec reprovado no lint (SPEC/PLAN):\n  - ${crossApply.errors.join('\n  - ')}`, lint: { ok: false, errors: crossApply.errors, warnings: crossApply.warnings } });
            continue;
          }
        }
        const dry = lib.isDry(cfg, options);
        if (!dry && !lib.isWriter(cfg, env)) throw lib.writerError(cfg);
        if (!dry) lib.warnApply(cfg, options);
        const problems = lib.checkConfig(cfg, env);
        if (problems.length) throw new Error(`ALM: ${problems.join('; ')}`);
        try {
          const r = await refine.apply(lib.jiraRest(cfg, { ...options, dryRun: dry }), collected, md, { confirmOverwrite: options.confirmOverwrite, dryRun: dry });
          const target = r.questions ? 'grooming' : 'ready';
          if (options.keepStatus) r.moved = { skipped: true, why: '--keep-status: o card fica na coluna em que está' };
          else if (r.applied) r.moved = await refineMove(lib, cfg, key, target, { ...options, env });
          else if (r.dry_run) r.moved = await refineMove(lib, cfg, key, target, { ...options, env, dryRun: true });
          if (r.dry_run && cfg.require_apply && !options.dryRun && !options.apply) r.why_dry = 'alm.require_apply: gravar exige --apply';
          if (!dry) appendEvent(projectRoot, activeSession, { type: 'AlmRefined', payload: { key, sha: r.sha || null, applied: Boolean(r.applied) } });
          out.push(r);
        } catch (err) { out.push({ key, error: err.message, ...(err.lint ? { lint: err.lint } : {}) }); }
      }
      return { action, results: out };
    }
    const problems = lib.checkConfig(cfg, env);
    if (problems.length) throw new Error(`ALM: ${problems.join('; ')} — o refine lê o card pela API do Jira`);
    const rest = lib.jiraRest(cfg, options);
    if (options.jql) {
      const r = await rest.request('GET', `${rest.site}/rest/api/3/search/jql?jql=${encodeURIComponent(options.jql)}&fields=summary&maxResults=${Math.min(100, Number(options.maxCards) || 20)}`);
      keys = [...keys, ...((r && r.issues) || []).map((i) => i.key)];
    }
    const max = Number(options.maxCards) > 0 ? Number(options.maxCards) : 15;
    if (keys.length > max) throw new Error(`${keys.length} card(s) passam do teto --max-cards ${max}: refine em lote só com o OK do usuário (aumente --max-cards de propósito)`);
    fs.mkdirSync(d.data, { recursive: true });
    fs.mkdirSync(d.specs, { recursive: true });
    const out = [];
    for (const key of keys) {
      try {
        const c = await refine.collect(rest, key, { projectRoot, activeSession });
        fs.writeFileSync(path.join(d.data, `${key}.json`), JSON.stringify(c, null, 2));
        const specFile = path.join(d.specs, `${key}.md`);
        const kept = fs.existsSync(specFile) && !options.reset;
        if (!kept) fs.writeFileSync(specFile, refine.skeleton(c));
        const claimDry = lib.isDry(cfg, options);
        if (options.claim && !claimDry && lib.isWriter(cfg, env)) lib.warnApply(cfg, options);
        const claimed = !options.claim ? null
          : !lib.isWriter(cfg, env) && !claimDry ? { stage: 'refinement', skipped: true, why: lib.writerError(cfg).message }
            : await refineMove(lib, cfg, key, 'refinement', { ...options, env, dryRun: claimDry });
        out.push({ key, ...(claimed ? { moved: claimed } : {}), kind: c.kind, type: c.type, status: c.status, summary: c.summary, comments: c.comments.length, links: c.links.length, code_refs: c.code_refs.length, already_refined: c.already_refined, spec: path.relative(projectRoot, specFile).replace(/\\/g, '/'), kept });
      } catch (err) { out.push({ key, error: err.message }); }
    }
    return { action: 'collect', dry_run: !options.claim || lib.isDry(cfg, options), claim: Boolean(options.claim), results: out };
  }

  return {
    runtimeAlm,
    runtimeAlmRefineImport,
    traceGateFindings,
    runtimeAlmAdmin,
    traceSnapshot,
    runtimeTrace,
    runtimeAlmMetrics,
    runtimeAlmRefine,
    uiCardGaps,
    wholeWord,
    refineMove,
    criteriaOnlyReadSharedLocales,
  };
}

module.exports = {
  NON_UI_DOMAIN_LABEL_RE,
  wholeWord,
  criteriaOnlyReadSharedLocales,
  uiCardGaps,
  refineMove,
  createAlmRefineRuntime,
};
