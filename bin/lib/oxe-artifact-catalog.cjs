'use strict';

/**
 * OXE artifact catalog — single source of truth for what lives under `.oxe/`.
 *
 * Every entry here drives THREE outputs from ONE definition:
 *   - the generated `.oxe/README.md` legend (`renderLegend`)
 *   - the live `oxe-cc map` tree (`buildMapModel` + `renderMap`)
 *   - the host-integration model (`oxe-cc map --json`, SDK `artifacts.*`)
 *
 * Design intent: the `.oxe/` directory is *lean at install* (only STATE.md,
 * config.json and this README). Everything else is created lazily, on first
 * use, by the workflow named in `createdBy`. The catalog documents the FULL
 * structure so users understand the flow without the empty folders cluttering
 * their editor file tree.
 *
 * Entry shape:
 *   {
 *     path: 'codebase/',          // relative to `.oxe/`; trailing `/` ⇒ directory
 *     kind: 'file' | 'dir',
 *     purpose: 'one-line what-it-is',
 *     createdBy: 'install' | 'scan' | 'spec' | 'plan' | 'execute' | 'verify'
 *              | 'runtime' | 'conduct' | 'session' | 'workstream' | 'milestone'
 *              | 'capabilities' | 'plugins' | 'azure' | 'memory' | 'distill',
 *     group: 'core' | 'discovery' | 'spec' | 'plan' | 'execute' | 'verify'
 *          | 'autonomous' | 'memory' | 'project' | 'platform',
 *   }
 */

const fs = require('fs');
const path = require('path');

/** @type {{key:string,label:string,order:number}[]} */
const GROUPS = [
  { key: 'core', label: 'Núcleo (sempre presente após install)', order: 0 },
  { key: 'discovery', label: 'Descoberta — scan / compact', order: 1 },
  { key: 'spec', label: 'Especificação — spec / discuss / research', order: 2 },
  { key: 'plan', label: 'Planejamento — plan / plan-agents / quick', order: 3 },
  { key: 'execute', label: 'Execução — runtime operacional', order: 4 },
  { key: 'verify', label: 'Verificação — verify / gaps / security / ui', order: 5 },
  { key: 'autonomous', label: 'Modo autônomo — conduct / agent / swarm', order: 6 },
  { key: 'memory', label: 'Memória & aprendizado', order: 7 },
  { key: 'project', label: 'Gestão de projeto — sessões / workstreams / milestones', order: 8 },
  { key: 'platform', label: 'Plataforma — capabilities / plugins / cloud / install', order: 9 },
  { key: 'layout', label: 'Layout instalado (árvore canônica copiada no install)', order: 10 },
];

/** @type {Array<{path:string,kind:'file'|'dir',purpose:string,createdBy:string,group:string}>} */
const ARTIFACT_CATALOG = [
  // ── core ────────────────────────────────────────────────────────────────
  { path: 'STATE.md', kind: 'file', purpose: 'Estado curto: fase, sessão ativa, próximo passo, bloqueios', createdBy: 'install', group: 'core' },
  { path: 'config.json', kind: 'file', purpose: 'Configuração do projeto (profile, verificação, permissões, azure)', createdBy: 'install', group: 'core' },
  { path: 'README.md', kind: 'file', purpose: 'Esta legenda — o que cada artefato é e quando aparece', createdBy: 'install', group: 'core' },

  // ── discovery ───────────────────────────────────────────────────────────
  { path: 'codebase/', kind: 'dir', purpose: 'Mapas do repositório (OVERVIEW, STACK, STRUCTURE, TESTING, INTEGRATIONS, CONVENTIONS, CONCERNS)', createdBy: 'scan', group: 'discovery' },
  { path: 'CODEBASE-DELTA.md', kind: 'file', purpose: 'Diff incremental dos mapas de codebase', createdBy: 'scan', group: 'discovery' },
  { path: 'RESUME.md', kind: 'file', purpose: 'Resumo de retomada gerado pelo compact', createdBy: 'scan', group: 'discovery' },

  // ── spec ────────────────────────────────────────────────────────────────
  { path: 'SPEC.md', kind: 'file', purpose: 'Especificação da feature com critérios de aceite', createdBy: 'spec', group: 'spec' },
  { path: 'ROADMAP.md', kind: 'file', purpose: 'Roteiro de requisitos (R-ID v1/v2/fora)', createdBy: 'spec', group: 'spec' },
  { path: 'DISCUSS.md', kind: 'file', purpose: 'Perguntas e decisões de esclarecimento antes do plano', createdBy: 'spec', group: 'spec' },
  { path: 'NOTES.md', kind: 'file', purpose: 'Notas não resolvidas da discussão', createdBy: 'spec', group: 'spec' },
  { path: 'RESEARCH.md', kind: 'file', purpose: 'Índice de pesquisa exploratória', createdBy: 'spec', group: 'spec' },
  { path: 'research/', kind: 'dir', purpose: 'Dossiês de pesquisa exploratória', createdBy: 'spec', group: 'spec' },
  { path: 'INVESTIGATIONS.md', kind: 'file', purpose: 'Índice de investigações estruturadas', createdBy: 'spec', group: 'spec' },
  { path: 'investigations/', kind: 'dir', purpose: 'Investigações estruturadas (inclui visual/VISUAL-INPUTS)', createdBy: 'spec', group: 'spec' },
  { path: 'UI-SPEC.md', kind: 'file', purpose: 'Contrato de UI derivado da SPEC', createdBy: 'spec', group: 'spec' },
  { path: 'SECURITY.md', kind: 'file', purpose: 'Auditoria de segurança OWASP (P0/P1/P2)', createdBy: 'verify', group: 'spec' },

  // ── plan ────────────────────────────────────────────────────────────────
  { path: 'PLAN.md', kind: 'file', purpose: 'Plano por ondas com verificação por tarefa', createdBy: 'plan', group: 'plan' },
  { path: 'plan-agents.json', kind: 'file', purpose: 'Blueprint multi-agente (schema 3) — Plan-Driven Dynamic Agents', createdBy: 'plan', group: 'plan' },
  { path: 'plan-agent-messages/', kind: 'dir', purpose: 'Protocolo de mensagens agente→agente', createdBy: 'plan', group: 'plan' },
  { path: 'IMPLEMENTATION-PACK.json', kind: 'file', purpose: 'Pack racional: paths exatos, símbolos, contratos, write-set', createdBy: 'plan', group: 'plan' },
  { path: 'REFERENCE-ANCHORS.md', kind: 'file', purpose: 'Âncoras de referência resolvidas para o plano', createdBy: 'plan', group: 'plan' },
  { path: 'FIXTURE-PACK.json', kind: 'file', purpose: 'Fixtures obrigatórias por tipo de tarefa', createdBy: 'plan', group: 'plan' },
  { path: 'QUICK.md', kind: 'file', purpose: 'Passos do modo rápido (sem cerimônia)', createdBy: 'plan', group: 'plan' },
  { path: 'quick-agents.json', kind: 'file', purpose: 'Agentes lean (PDDA) do modo quick', createdBy: 'plan', group: 'plan' },
  { path: 'PLAN-REVIEW.md', kind: 'file', purpose: 'Revisão de plano para aprovação (dashboard)', createdBy: 'plan', group: 'plan' },

  // ── execute (runtime operacional) ─────────────────────────────────────────
  { path: 'EXECUTION-RUNTIME.md', kind: 'file', purpose: 'Runtime tático da onda: agentes ativos, handoffs, retries', createdBy: 'execute', group: 'execute' },
  { path: 'ACTIVE-RUN.json', kind: 'file', purpose: 'Cursor e estado do run atual', createdBy: 'runtime', group: 'execute' },
  { path: 'OXE-EVENTS.ndjson', kind: 'file', purpose: 'Trace append-only de eventos do run', createdBy: 'runtime', group: 'execute' },
  { path: 'runs/', kind: 'dir', purpose: 'Artefatos por run do runtime enterprise (manifest, evidence, risk)', createdBy: 'runtime', group: 'execute' },
  { path: 'CHECKPOINTS.md', kind: 'file', purpose: 'Gates humanos de aprovação', createdBy: 'execute', group: 'execute' },
  { path: 'OBSERVATIONS.md', kind: 'file', purpose: 'Observações contextuais pendentes de incorporação', createdBy: 'execute', group: 'execute' },
  { path: 'DEBUG.md', kind: 'file', purpose: 'Diagnóstico técnico durante execução', createdBy: 'execute', group: 'execute' },
  { path: 'context/', kind: 'dir', purpose: 'Context packs e summaries por workflow', createdBy: 'execute', group: 'execute' },

  // ── verify ──────────────────────────────────────────────────────────────
  { path: 'VERIFY.md', kind: 'file', purpose: 'Validação dos critérios da SPEC', createdBy: 'verify', group: 'verify' },
  { path: 'SUMMARY.md', kind: 'file', purpose: 'Sumário de entrega', createdBy: 'verify', group: 'verify' },
  { path: 'VALIDATION-GAPS.md', kind: 'file', purpose: 'Gaps de cobertura pós-verify', createdBy: 'verify', group: 'verify' },
  { path: 'UI-REVIEW.md', kind: 'file', purpose: 'Auditoria de UI face ao UI-SPEC', createdBy: 'verify', group: 'verify' },

  // ── autonomous (conduct / agent / swarm) ──────────────────────────────────
  { path: 'agent/', kind: 'dir', purpose: 'Artefatos de Agent Mode (AGENT-SESSION, RECONCILIATION, SKILLS-LOADED)', createdBy: 'conduct', group: 'autonomous' },
  { path: 'swarm/', kind: 'dir', purpose: 'Artefatos de Swarm Mode (SWARM-RUN, TASK-GRAPH, FILE-OWNERSHIP, BOARD, reviews)', createdBy: 'conduct', group: 'autonomous' },

  // ── memory & learning ─────────────────────────────────────────────────────
  { path: 'memory/', kind: 'dir', purpose: 'Memory Kernel: REPO-MEMORY + índice + sidecars injetados', createdBy: 'memory', group: 'memory' },
  { path: 'learning/', kind: 'dir', purpose: 'Learning Kernel: candidates, promotion queue, learning events', createdBy: 'distill', group: 'memory' },
  { path: 'global/', kind: 'dir', purpose: 'Cross-session: LESSONS.md, MILESTONES.md, milestones/', createdBy: 'verify', group: 'memory' },

  // ── project mgmt ──────────────────────────────────────────────────────────
  { path: 'sessions/', kind: 'dir', purpose: 'Sessões isoladas (sNNN-slug com spec/plan/execution/verification)', createdBy: 'session', group: 'project' },
  { path: 'SESSIONS.md', kind: 'file', purpose: 'Índice de sessões', createdBy: 'session', group: 'project' },
  { path: 'workstreams/', kind: 'dir', purpose: 'Trilhas paralelas com artefatos independentes', createdBy: 'workstream', group: 'project' },

  // ── platform ──────────────────────────────────────────────────────────────
  { path: 'CAPABILITIES.md', kind: 'file', purpose: 'Índice de capabilities nativas do projeto', createdBy: 'capabilities', group: 'platform' },
  { path: 'capabilities/', kind: 'dir', purpose: 'Manifestos de capabilities', createdBy: 'capabilities', group: 'platform' },
  { path: 'plugins/', kind: 'dir', purpose: 'Plugins opcionais do runtime', createdBy: 'plugins', group: 'platform' },
  { path: 'cloud/', kind: 'dir', purpose: 'Provider Azure local-first (inventário e operações)', createdBy: 'azure', group: 'platform' },
  { path: 'dashboard/', kind: 'dir', purpose: 'Estado do dashboard web (opt-in)', createdBy: 'execute', group: 'platform' },
  { path: 'install/', kind: 'dir', purpose: 'Auditoria de instalação (runtime-semantics, manifests de IDE)', createdBy: 'install', group: 'platform' },

  // ── layout (nested install copia a árvore canônica para `.oxe/`) ───────────
  { path: 'workflows/', kind: 'dir', purpose: 'Workflows canônicos OXE (fonte da verdade dos passos)', createdBy: 'install', group: 'layout' },
  { path: 'templates/', kind: 'dir', purpose: 'Templates de artefatos usados pelos workflows', createdBy: 'install', group: 'layout' },
  { path: 'personas/', kind: 'dir', purpose: 'Personas builtin dos agentes', createdBy: 'install', group: 'layout' },
  { path: 'agents/', kind: 'dir', purpose: 'Definições de agentes especializados', createdBy: 'install', group: 'layout' },
  { path: 'schemas/', kind: 'dir', purpose: 'JSON schemas (plan-agents, swarm-run)', createdBy: 'install', group: 'layout' },
];

/**
 * Friendly "source" label per `createdBy` value. Not every artifact comes from
 * a `/oxe-<x>` slash command — some are produced by CLI subcommands or kernels.
 * @type {Record<string,string>}
 */
const SOURCE_LABELS = {
  install: 'install',
  scan: '/oxe-scan',
  spec: '/oxe-spec',
  plan: '/oxe-plan',
  execute: '/oxe-execute',
  verify: '/oxe-verify',
  runtime: 'oxe-cc runtime',
  conduct: '/oxe (autônomo)',
  session: '/oxe-session',
  workstream: '/oxe-workstream',
  milestone: '/oxe-milestone',
  capabilities: 'oxe-cc capabilities',
  plugins: 'oxe-cc plugins',
  azure: 'oxe-cc azure',
  memory: 'Memory Kernel',
  distill: 'Learning Kernel',
};

function sourceLabel(createdBy) {
  return SOURCE_LABELS[createdBy] || createdBy;
}

const CORE_INSTALL_PATHS = ARTIFACT_CATALOG.filter((e) => e.createdBy === 'install' && e.group === 'core').map((e) => e.path);

function groupLabel(key) {
  const g = GROUPS.find((x) => x.key === key);
  return g ? g.label : key;
}

/**
 * Render the `.oxe/README.md` legend from the catalog. Pure string output so it
 * is trivially testable and identical across install/doctor regeneration.
 * @returns {string}
 */
function renderLegend() {
  const lines = [];
  lines.push('# OXE — mapa de artefatos do `.oxe/`');
  lines.push('');
  lines.push('> Este diretório é **enxuto no install** — só `STATE.md`, `config.json` e este `README.md`.');
  lines.push('> Todo o resto **nasce sob demanda**, criado pelo workflow correspondente quando você o usa.');
  lines.push('> Rode **`oxe-cc map`** para ver, a qualquer momento, o que já existe no seu projeto e o que está disponível sob demanda.');
  lines.push('');
  lines.push('Legenda de estado no `oxe-cc map`: `✓` ativo (com conteúdo) · `◦` vazio/placeholder · `·` disponível sob demanda (ainda não criado) · `⚠` desatualizado.');
  lines.push('');
  for (const g of GROUPS) {
    const entries = ARTIFACT_CATALOG.filter((e) => e.group === g.key);
    if (!entries.length) continue;
    lines.push(`## ${g.label}`);
    lines.push('');
    lines.push('| Artefato | O que é | Criado por |');
    lines.push('|----------|---------|------------|');
    for (const e of entries) {
      const name = `\`${e.path}\``;
      const by = e.createdBy === 'install' ? 'install' : `\`${sourceLabel(e.createdBy)}\``;
      lines.push(`| ${name} | ${e.purpose} | ${by} |`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('_Gerado pelo OXE a partir do catálogo único de artefatos. Re-renderizado por `oxe-cc doctor`._');
  lines.push('');
  return lines.join('\n');
}

/**
 * Classify the on-disk state of a single catalog entry.
 * @param {string} oxeDir absolute path to the project's `.oxe/` directory
 * @param {{path:string,kind:string}} entry
 * @returns {'absent'|'empty'|'active'}
 */
function classifyEntry(oxeDir, entry) {
  const abs = path.join(oxeDir, entry.path.replace(/\/$/, ''));
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return 'absent';
  }
  if (entry.kind === 'dir') {
    if (!stat.isDirectory()) return 'active';
    let children;
    try {
      children = fs.readdirSync(abs);
    } catch {
      return 'empty';
    }
    const meaningful = children.filter((c) => c !== '.gitkeep' && c !== 'README.md');
    return meaningful.length > 0 ? 'active' : 'empty';
  }
  // file
  if (stat.isDirectory()) return 'active';
  return stat.size > 0 ? 'active' : 'empty';
}

/**
 * Build the live map model by cross-referencing the catalog with the real
 * `.oxe/` directory. Absence of a lazy artifact is a NORMAL state, never an
 * error. Optionally flags the codebase scan as stale via injected helpers.
 *
 * @param {string} target absolute path to the project root (NOT `.oxe`)
 * @param {{ staleScan?: boolean }} [opts]
 * @returns {{ projectRoot:string, oxeExists:boolean, groups:Array, present:Array, available:Array, extras:string[], counts:object }}
 */
function buildMapModel(target, opts = {}) {
  const root = path.resolve(target);
  const oxeDir = path.join(root, '.oxe');
  const oxeExists = fs.existsSync(oxeDir);

  const nodes = ARTIFACT_CATALOG.map((e) => {
    const state = oxeExists ? classifyEntry(oxeDir, e) : 'absent';
    let flagged = state;
    if (state === 'active' && opts.staleScan && e.path === 'codebase/') flagged = 'stale';
    return {
      path: e.path,
      kind: e.kind,
      purpose: e.purpose,
      createdBy: e.createdBy,
      group: e.group,
      state: flagged,
    };
  });

  const present = nodes.filter((n) => n.state !== 'absent');
  const available = nodes.filter((n) => n.state === 'absent');

  // extras: top-level entries on disk not described by the catalog
  const known = new Set(ARTIFACT_CATALOG.map((e) => e.path.replace(/\/$/, '')));
  let extras = [];
  if (oxeExists) {
    try {
      extras = fs
        .readdirSync(oxeDir, { withFileTypes: true })
        .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
        .filter((name) => !known.has(name.replace(/\/$/, '')))
        .sort();
    } catch {
      extras = [];
    }
  }

  const byGroup = GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    present: present.filter((n) => n.group === g.key),
    available: available.filter((n) => n.group === g.key),
  })).filter((g) => g.present.length || g.available.length);

  return {
    projectRoot: root,
    oxeExists,
    groups: byGroup,
    present,
    available,
    extras,
    counts: {
      total: nodes.length,
      present: present.length,
      active: nodes.filter((n) => n.state === 'active').length,
      empty: nodes.filter((n) => n.state === 'empty').length,
      stale: nodes.filter((n) => n.state === 'stale').length,
      available: available.length,
      extras: extras.length,
    },
  };
}

const STATE_GLYPH = {
  active: '✓',
  empty: '◦',
  stale: '⚠',
  absent: '·',
};

/**
 * Render the map model as an annotated terminal tree. Colorizing is left to the
 * caller via the `paint` hook so this stays dependency-free and testable.
 *
 * @param {ReturnType<buildMapModel>} model
 * @param {{ paint?: (s:string, kind:string)=>string }} [opts]
 * @returns {string}
 */
function renderMap(model, opts = {}) {
  const paint = opts.paint || ((s) => s);
  const lines = [];
  lines.push(paint('.oxe/', 'root'));
  if (!model.oxeExists) {
    lines.push('  (não inicializado — rode `oxe-cc init-oxe`)');
    return lines.join('\n');
  }

  for (const g of model.groups) {
    if (!g.present.length) continue;
    lines.push('');
    lines.push(paint(`  ${g.label}`, 'group'));
    for (const n of g.present) {
      const glyph = STATE_GLYPH[n.state] || '·';
      const name = n.path.padEnd(26);
      lines.push(`    ${paint(glyph, n.state)} ${name} ${paint(n.purpose, 'dim')}`);
    }
  }

  if (model.extras.length) {
    lines.push('');
    lines.push(paint('  Outros (fora do catálogo)', 'group'));
    for (const name of model.extras) lines.push(`    ${paint('?', 'dim')} ${name}`);
  }

  // Available-on-demand: compact, grouped — NOT shown as folders.
  if (model.available.length) {
    lines.push('');
    lines.push(paint('  Disponível sob demanda (ainda não criado)', 'group'));
    const byCmd = new Map();
    for (const n of model.available) {
      const key = sourceLabel(n.createdBy);
      if (!byCmd.has(key)) byCmd.set(key, []);
      byCmd.get(key).push(n.path);
    }
    for (const [cmd, paths] of byCmd) {
      lines.push(`    ${paint('·', 'absent')} ${paint(cmd, 'dim')} → ${paths.join(', ')}`);
    }
  }

  lines.push('');
  const c = model.counts;
  lines.push(paint(`  ${c.active} ativo · ${c.empty} vazio · ${c.stale} desatualizado · ${c.available} sob demanda`, 'dim'));
  lines.push(paint('  Legenda: ✓ ativo · ◦ vazio · ⚠ desatualizado · · sob demanda', 'dim'));
  return lines.join('\n');
}

module.exports = {
  ARTIFACT_CATALOG,
  GROUPS,
  CORE_INSTALL_PATHS,
  SOURCE_LABELS,
  sourceLabel,
  groupLabel,
  renderLegend,
  classifyEntry,
  buildMapModel,
  renderMap,
  STATE_GLYPH,
};
