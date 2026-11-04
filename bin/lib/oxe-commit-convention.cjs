'use strict';

/**
 * 1.21 · Checkpoint commits that follow the project's convention (OXB-021). `oxe(T3): <título em pt-BR>` broke the
 * oxespace rule (Conventional Commits in English with a Co-Authored-By trailer) and had to be squashed.
 *
 * `.oxe/config.json`:
 *   "commit_convention": {
 *     "template": "{type}({scope}): {title}",   // used when the task has no own `commit` message
 *     "type": "feat", "scope": "voice",          // template defaults
 *     "pattern": "^(feat|fix|test|docs|chore|refactor)(\\([^)]+\\))?: .+", // every message must match (lint + commit)
 *     "trailers": ["Co-Authored-By: Claude <noreply@anthropic.com>"],
 *     "require_task_message": true               // each mutating task must carry its own `commit` in PLAN.json
 *   }
 * PLAN.json task: `"commit": "fix(voice): consent dialog on the dialog primitive (CR-13)"` (planner-written, in the
 * project's language). Every checkpoint also carries the `OXE-Task: Tn` trailer, which is how OXE finds it later.
 */

const LEGACY_TEMPLATE = 'oxe({task}): {title}';

function settingsOf(config) {
  const raw = config && config.commit_convention && typeof config.commit_convention === 'object' ? config.commit_convention : null;
  return raw || null;
}

function fill(template, values) {
  return String(template).replace(/\{(task|title|type|scope)\}/g, (_, key) => String(values[key] ?? ''))
    .replace(/\(\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function patternOf(settings) {
  if (!settings || !settings.pattern) return null;
  try {
    return new RegExp(settings.pattern);
  } catch {
    return null;
  }
}

/** Subject line for a task's checkpoint, following the convention. */
function checkpointSubject(task, config) {
  const settings = settingsOf(config);
  const own = task && typeof task.commit === 'string' && task.commit.trim() ? task.commit.trim() : null;
  if (own) return own.split(/\r?\n/)[0].slice(0, 100);
  const template = settings && settings.template ? settings.template : LEGACY_TEMPLATE;
  return fill(template, {
    task: task && task.id,
    title: String((task && task.title) || (task && task.id) || '').slice(0, 72),
    type: (task && task.commit_type) || (settings && settings.type) || 'feat',
    scope: (task && task.commit_scope) || (settings && settings.scope) || '',
  }).slice(0, 100);
}

/** Full message: subject, the task's body (when its `commit` has more lines), the trailers and `OXE-Task`. */
function checkpointMessage(task, config) {
  const settings = settingsOf(config);
  const subject = checkpointSubject(task, config);
  const own = task && typeof task.commit === 'string' ? task.commit.trim().split(/\r?\n/).slice(1).join('\n').trim() : '';
  const trailers = [...(settings && Array.isArray(settings.trailers) ? settings.trailers : []), `OXE-Task: ${task && task.id}`];
  return [subject, own, trailers.join('\n')].filter(Boolean).join('\n\n');
}

/** Lint: an invalid pattern, a task without its own message when required, a message that breaks the pattern. */
function lintCommitConvention(plan, config) {
  const settings = settingsOf(config);
  const errors = [];
  if (!settings) return errors;
  if (settings.pattern && !patternOf(settings)) errors.push(`commit_convention.pattern inválido: ${settings.pattern}`);
  const pattern = patternOf(settings);
  for (const task of (plan && plan.tasks) || []) {
    if (task.done) continue;
    const own = task.meta && task.meta.commit ? task.meta.commit : task.commit;
    if (settings.require_task_message && !own) {
      errors.push(`${task.id}: sem "commit" no PLAN.json (commit_convention.require_task_message) — escreva a mensagem do checkpoint na convenção do projeto`);
      continue;
    }
    const subject = checkpointSubject({ id: task.id, title: task.title, commit: own, commit_type: task.meta && task.meta.commit_type, commit_scope: task.meta && task.meta.commit_scope }, config);
    if (pattern && !pattern.test(subject)) errors.push(`${task.id}: mensagem do checkpoint "${subject}" não segue commit_convention.pattern`);
  }
  return errors;
}

module.exports = { checkpointSubject, checkpointMessage, lintCommitConvention, LEGACY_TEMPLATE };
