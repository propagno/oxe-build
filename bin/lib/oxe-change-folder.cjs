'use strict';

const fs = require('fs');
const path = require('path');

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function changesRoot(projectRoot) {
  return path.join(projectRoot, '.oxe', 'changes');
}

function changeDir(projectRoot, slug) {
  const safe = slugify(slug);
  if (!safe) throw new Error('Informe um slug válido para o change folder (ex.: fix-auth-refresh).');
  return path.join(changesRoot(projectRoot), safe);
}

/**
 * Create a self-contained brownfield change folder: `.oxe/changes/<slug>/{meta.json,proposal.md,delta.md,tasks.json}`.
 */
function initChangeFolder(projectRoot, { slug, title, card = null, quickId = null, files = [] }) {
  const safe = slugify(slug || title);
  if (!safe) throw new Error('Informe um slug ou título para criar o change folder.');
  const dir = changeDir(projectRoot, safe);
  if (fs.existsSync(dir)) throw new Error(`Change folder já existe: .oxe/changes/${safe}`);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const meta = {
    schema_version: 1,
    slug: safe,
    title: String(title || safe),
    status: 'open',
    card: card || null,
    promoted_from_quick: quickId || null,
    created_at: now,
    updated_at: now,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'proposal.md'),
    `# Change: ${meta.title}\n\n- **Slug:** \`${safe}\`\n- **Card:** ${card || '—'}\n- **Origem:** ${quickId ? `promovido de ${quickId}` : 'direto'}\n\n## Problema / Contexto\n\n(descreva o comportamento atual e o porquê da mudança)\n\n## Critérios de aceite (EARS)\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | Quando <gatilho>, o sistema deve <resposta> | <comando/teste> |\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'delta.md'),
    `# Delta técnico — ${safe}\n\n## Arquivos impactados\n\n${files.length ? files.map((f) => `- \`${f}\``).join('\n') : '- (listar caminhos exatos)'}\n\n## Riscos e rollback\n\n- (descrever impacto em módulos existentes)\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'tasks.json'),
    `${JSON.stringify({ schema_version: 1, change: safe, tasks: [] }, null, 2)}\n`,
    'utf8',
  );
  return { ...meta, dir: path.relative(projectRoot, dir).replace(/\\/g, '/') };
}

function listChangeFolders(projectRoot) {
  const root = changesRoot(projectRoot);
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  const out = [];
  for (const e of entries) {
    const metaFile = path.join(root, e.name, 'meta.json');
    if (!fs.existsSync(metaFile)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      let tasksCount = 0;
      let doneCount = 0;
      try {
        const t = JSON.parse(fs.readFileSync(path.join(root, e.name, 'tasks.json'), 'utf8'));
        const list = Array.isArray(t.tasks) ? t.tasks : [];
        tasksCount = list.length;
        doneCount = list.filter((x) => x && x.done === true).length;
      } catch { /* ignore */ }
      out.push({ ...meta, tasks_total: tasksCount, tasks_done: doneCount, dir: `.oxe/changes/${e.name}` });
    } catch { /* ignore */ }
  }
  return out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function getChangeFolderStatus(projectRoot, slug) {
  const safe = slugify(slug);
  const dir = changeDir(projectRoot, safe);
  const metaFile = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaFile)) throw new Error(`Change folder não encontrado: .oxe/changes/${safe}`);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const tasksDoc = fs.existsSync(path.join(dir, 'tasks.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')) : { tasks: [] };
  const tasks = Array.isArray(tasksDoc.tasks) ? tasksDoc.tasks : [];
  return {
    ...meta,
    dir: `.oxe/changes/${safe}`,
    artifacts: {
      proposal: fs.existsSync(path.join(dir, 'proposal.md')),
      delta: fs.existsSync(path.join(dir, 'delta.md')),
      tasks: fs.existsSync(path.join(dir, 'tasks.json')),
    },
    tasks_total: tasks.length,
    tasks_done: tasks.filter((t) => t && t.done === true).length,
  };
}

/** Promote the currently open quick (`.oxe/quick/current.json`) into a self-contained change folder. */
function promoteQuickToChange(projectRoot, { slug } = {}) {
  const quickLib = require('./oxe-quick.cjs');
  const cur = quickLib.current(projectRoot);
  if (!cur) throw new Error('Nenhum quick aberto para promover (abra um com oxe-cc quick <KEY> "<objetivo>").');
  const targetSlug = slug || `${cur.key ? `${cur.key}-` : ''}${cur.objective}`;
  return initChangeFolder(projectRoot, {
    slug: targetSlug,
    title: cur.objective,
    card: cur.key || null,
    quickId: cur.id,
  });
}

module.exports = {
  slugify,
  initChangeFolder,
  listChangeFolders,
  getChangeFolderStatus,
  promoteQuickToChange,
};
