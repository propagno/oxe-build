'use strict';

const fs = require('fs');
const path = require('path');

/**
 * OXE Skill Loader
 *
 * Resolve skills/personas por ID seguindo a ordem de precedência:
 *   1. projeto: .oxe/skills/active/<id>.md
 *   2. capabilities: .oxe/capabilities/<id>/SKILL.md
 *   3. global: oxe/personas/<id>.md
 *
 * Retorna o conteúdo do skill/persona ou null se não encontrado.
 */

function resolveSkillPath(skillId, projectRoot) {
  const candidates = [
    path.join(projectRoot, '.oxe', 'skills', 'active', `${skillId}.md`),
    path.join(projectRoot, '.oxe', 'capabilities', skillId, 'SKILL.md'),
    path.join(projectRoot, 'oxe', 'personas', `${skillId}.md`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadSkill(skillId, projectRoot) {
  const skillPath = resolveSkillPath(skillId, projectRoot);
  if (!skillPath) {
    return null;
  }

  try {
    const content = fs.readFileSync(skillPath, 'utf8');
    return { id: skillId, path: skillPath, content };
  } catch {
    return null;
  }
}

function listSkills(projectRoot) {
  const skills = { active: [], proposed: [], archived: [], global: [] };

  const activeDir = path.join(projectRoot, '.oxe', 'skills', 'active');
  const proposedDir = path.join(projectRoot, '.oxe', 'skills', 'proposed');
  const archivedDir = path.join(projectRoot, '.oxe', 'skills', 'archived');
  const globalDir = path.join(projectRoot, 'oxe', 'personas');

  for (const [key, dir] of Object.entries({ active: activeDir, proposed: proposedDir, archived: archivedDir, global: globalDir })) {
    if (fs.existsSync(dir)) {
      skills[key] = fs.readdirSync(dir)
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace('.md', ''));
    }
  }

  return skills;
}

/**
 * Seleciona personas aplicáveis a partir de intent_tags.
 * Retorna lista de {id, persona_path, content} ordenada por prioridade.
 */
function selectPersonasForIntent(intentTags, projectRoot) {
  const tagToPersona = {
    backend:  { primary: 'executor', secondary: 'architect' },
    frontend: { primary: 'ui-specialist', secondary: 'executor' },
    storage:  { primary: 'db-specialist', secondary: 'architect' },
    auth:     { primary: 'architect', secondary: 'executor' },
    infra:    { primary: 'architect', secondary: null },
    test:     { primary: 'executor', secondary: 'verifier' },
    docs:     { primary: 'executor', secondary: null },
    config:   { primary: 'executor', secondary: null },
    research: { primary: 'researcher', secondary: null },
    debug:    { primary: 'debugger', secondary: null },
  };

  const selected = new Map();

  for (const tag of intentTags) {
    const mapping = tagToPersona[tag];
    if (!mapping) continue;
    if (mapping.primary && !selected.has(mapping.primary)) {
      selected.set(mapping.primary, 'primary');
    }
    if (mapping.secondary && !selected.has(mapping.secondary)) {
      selected.set(mapping.secondary, 'secondary');
    }
  }

  const result = [];
  for (const [id, priority] of selected) {
    const skill = loadSkill(id, projectRoot);
    if (skill) {
      result.push({ ...skill, priority });
    }
  }

  return result;
}

function recordSkillsLoaded(skills, sessionDir) {
  const record = {
    loaded_at: new Date().toISOString(),
    skills: skills.map(s => ({ id: s.id, path: s.path, priority: s.priority || 'explicit' })),
  };

  const outPath = path.join(sessionDir, 'SKILLS-LOADED.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(record, null, 2), 'utf8');
  } catch {
    // non-fatal
  }

  return record;
}

module.exports = {
  loadSkill,
  listSkills,
  resolveSkillPath,
  selectPersonasForIntent,
  recordSkillsLoaded,
};
