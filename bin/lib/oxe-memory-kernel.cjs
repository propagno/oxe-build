'use strict';

const fs = require('fs');
const path = require('path');

/**
 * OXE Memory Kernel
 *
 * Recupera memória relevante ao objetivo atual lendo as 4 camadas de memória do OXE
 * na ordem definida por buildMemoryLayers() (oxe-operational.cjs:2364):
 *   1. runtime_state  → .oxe/STATE.md
 *   2. session_memory → .oxe/<session>/SESSION.md
 *   3. project_memory → .oxe/memory/REPO-MEMORY.md
 *   4. lessons        → .oxe/global/LESSONS.md
 *   5. observations   → .oxe/OBSERVATIONS.md
 *
 * Retorna um context pack filtrado por intent_tags e phase.
 */

function readFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch {
    // non-fatal
  }
  return null;
}

function extractRelevantFragments(content, intentTags, phase) {
  if (!content) return [];

  const lines = content.split('\n');
  const fragments = [];
  let currentSection = null;
  let currentLines = [];
  let currentScore = 0;

  const scoreFragment = (text) => {
    let score = 0;
    for (const tag of intentTags) {
      if (text.toLowerCase().includes(tag.toLowerCase())) score += 3;
    }
    if (text.includes('Impacto: alto') || text.includes('impact: high')) score += 2;
    if (text.includes('Frequência: 3') || text.includes('Frequência: 4') || text.includes('Frequência: 5')) score += 2;
    if (text.includes(phase)) score += 2;
    if (text.includes('Frequência: 2')) score += 1;
    if (text.includes('Status: ativo') || text.includes('status: active')) score += 1;
    return score;
  };

  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('### ')) {
      if (currentSection && currentLines.length > 0 && currentScore > 0) {
        fragments.push({ section: currentSection, content: currentLines.join('\n'), score: currentScore });
      }
      currentSection = line.trim();
      currentLines = [line];
      currentScore = 0;
    } else {
      currentLines.push(line);
      currentScore = Math.max(currentScore, scoreFragment(line));
    }
  }

  if (currentSection && currentLines.length > 0 && currentScore > 0) {
    fragments.push({ section: currentSection, content: currentLines.join('\n'), score: currentScore });
  }

  return fragments.sort((a, b) => b.score - a.score).slice(0, 10);
}

function retrieveMemory(projectRoot, intentTags, phase, objective) {
  const layers = {
    runtime_state: null,
    session_memory: null,
    project_memory: null,
    lessons: null,
    observations: null,
  };

  // Layer 1: runtime_state
  layers.runtime_state = readFileSafe(path.join(projectRoot, '.oxe', 'STATE.md'));

  // Layer 2: session_memory (read active session from STATE.md)
  if (layers.runtime_state) {
    const sessionMatch = layers.runtime_state.match(/active_session:\s*(.+)/);
    if (sessionMatch && sessionMatch[1].trim() !== '—') {
      const sessionPath = sessionMatch[1].trim();
      layers.session_memory = readFileSafe(path.join(projectRoot, sessionPath, 'SESSION.md'))
        || readFileSafe(path.join(projectRoot, '.oxe', sessionPath, 'SESSION.md'));
    }
  }

  // Layer 3: project_memory
  layers.project_memory = readFileSafe(path.join(projectRoot, '.oxe', 'memory', 'REPO-MEMORY.md'));

  // Layer 4: lessons
  layers.lessons = readFileSafe(path.join(projectRoot, '.oxe', 'global', 'LESSONS.md'));

  // Layer 5: observations
  layers.observations = readFileSafe(path.join(projectRoot, '.oxe', 'OBSERVATIONS.md'));

  // Extract relevant fragments from each layer
  const contextParts = [];

  if (layers.runtime_state) {
    contextParts.push(`### Estado Atual\n${layers.runtime_state.split('\n').slice(0, 20).join('\n')}`);
  }

  if (layers.project_memory) {
    const frags = extractRelevantFragments(layers.project_memory, intentTags, phase);
    if (frags.length > 0) {
      contextParts.push(`### Memória do Projeto\n${frags.map(f => f.content).join('\n\n')}`);
    }
  }

  if (layers.lessons) {
    const frags = extractRelevantFragments(layers.lessons, intentTags, phase);
    const activeFrags = frags.filter(f => f.content.includes('Status: ativo'));
    if (activeFrags.length > 0) {
      contextParts.push(`### Lições Aplicáveis\n${activeFrags.map(f => f.content).join('\n\n')}`);
    }
  }

  if (layers.session_memory) {
    contextParts.push(`### Contexto da Sessão\n${layers.session_memory.split('\n').slice(0, 30).join('\n')}`);
  }

  if (layers.observations) {
    const pendingObs = layers.observations.split('\n\n').filter(block =>
      block.includes('Status: pendente') &&
      (block.includes('all') || intentTags.some(tag => block.toLowerCase().includes(tag)))
    );
    if (pendingObs.length > 0) {
      contextParts.push(`### Observações Pendentes\n${pendingObs.join('\n\n')}`);
    }
  }

  const hasMemory = contextParts.length > 1; // more than just state
  const contextPack = [
    `## Contexto de Memória — ${phase} / ${new Date().toISOString()}`,
    `**Objetivo:** ${objective}`,
    `**Intent Tags:** ${intentTags.join(', ')}`,
    `**Fontes:** ${Object.entries(layers).filter(([, v]) => v).map(([k]) => k).join(', ')}`,
    '',
    ...contextParts,
  ].join('\n');

  return { contextPack, hasMemory, layers: Object.keys(layers).filter(k => layers[k]) };
}

function saveContextPack(projectRoot, contextPack, mode, phase) {
  let outPath;

  if (mode === 'agent') {
    outPath = path.join(projectRoot, '.oxe', 'agent', 'MEMORY-INJECTIONS.md');
  } else {
    outPath = path.join(projectRoot, '.oxe', 'swarm', 'DECISIONS.md');
  }

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    // For DECISIONS.md (swarm), prepend a section header
    if (mode === 'swarm' && fs.existsSync(outPath)) {
      const existing = fs.readFileSync(outPath, 'utf8');
      if (!existing.includes('## Contexto de Memória')) {
        fs.writeFileSync(outPath, existing + '\n\n' + contextPack, 'utf8');
      }
    } else {
      fs.writeFileSync(outPath, contextPack, 'utf8');
    }

    // Also save snapshot in retrieved/
    const retrievedDir = path.join(projectRoot, '.oxe', 'memory', 'retrieved');
    fs.mkdirSync(retrievedDir, { recursive: true });
    fs.writeFileSync(path.join(retrievedDir, `${phase}.md`), contextPack, 'utf8');
  } catch {
    // non-fatal
  }
}

module.exports = {
  retrieveMemory,
  saveContextPack,
};
