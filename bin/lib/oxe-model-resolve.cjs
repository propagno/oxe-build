'use strict';

/**
 * OXB-187: which model an execute will really use, and who chose it — never a silent downgrade. The rc.37/rc.38
 * regression ran every `claude -p` turn on the http provider's default (claude-sonnet-4-6) with nobody having asked.
 *
 *   claude adapter: --model > OXE_CLAUDE_MODEL > (none: Claude Code's own default). `runtime.provider.model` is the
 *                   http model and is NOT applied to `claude -p`.
 *   http adapter:   --model > OXE_MODEL > runtime.provider.model > the built-in default (claude-sonnet-4-6) — the last
 *                   one is NOT the operator's choice and is reported.
 *   models.tiers / models.overrides (OXB-131) change the model per attempt — reported as such.
 */

const HTTP_DEFAULT_MODEL = 'claude-sonnet-4-6';

function resolve(input) {
  const rawAdapter = String(input.adapter || '').toLowerCase();
  const adapter = rawAdapter === 'agy' ? 'antigravity' : (input.adapter || '');
  const { flag, env = process.env, persisted = {}, config = {} } = input;
  const notes = [];
  let model;
  let source;
  if (adapter === 'claude') {
    if (flag) { model = flag; source = '--model'; }
    else if (env.OXE_CLAUDE_MODEL) { model = env.OXE_CLAUDE_MODEL; source = 'OXE_CLAUDE_MODEL'; }
    else { model = null; source = 'padrão do Claude Code (sem --model)'; }
    if (persisted && persisted.model && !flag && !env.OXE_CLAUDE_MODEL) notes.push(`runtime.provider.model=${persisted.model} é do adaptador http e não se aplica ao claude -p; para fixar o modelo do claude, use --model ou OXE_CLAUDE_MODEL`);
  } else if (adapter === 'antigravity') {
    const isPersistedAgy = persisted && (
      String(persisted.name || '').toLowerCase() === 'antigravity'
      || String(persisted.name || '').toLowerCase() === 'agy'
      || String(persisted.adapter || '').toLowerCase() === 'antigravity'
      || String(persisted.adapter || '').toLowerCase() === 'agy'
    );
    if (flag) { model = flag; source = '--model'; }
    else if (env.OXE_AGY_MODEL) { model = env.OXE_AGY_MODEL; source = 'OXE_AGY_MODEL'; }
    else if (env.OXE_ANTIGRAVITY_MODEL) { model = env.OXE_ANTIGRAVITY_MODEL; source = 'OXE_ANTIGRAVITY_MODEL'; }
    else if (isPersistedAgy && persisted.model && persisted.model !== HTTP_DEFAULT_MODEL) { model = persisted.model; source = 'runtime.provider.model'; }
    else { model = null; source = 'padrão do Antigravity CLI (sem --model)'; }
    if (persisted && persisted.model && !isPersistedAgy && !flag && !env.OXE_AGY_MODEL && !env.OXE_ANTIGRAVITY_MODEL) {
      notes.push(`runtime.provider.model=${persisted.model} é do adaptador http e não se aplica ao agy -p; para fixar o modelo do antigravity, use --model, OXE_AGY_MODEL ou runtime.provider.name="antigravity"`);
    }
  } else {
    if (flag) { model = flag; source = '--model'; }
    else if (env.OXE_MODEL) { model = env.OXE_MODEL; source = 'OXE_MODEL'; }
    else if (persisted && persisted.model) { model = persisted.model; source = 'runtime.provider.model'; }
    else { model = HTTP_DEFAULT_MODEL; source = 'padrão embutido'; notes.push(`nenhum modelo escolhido: o adaptador http usa o padrão embutido ${HTTP_DEFAULT_MODEL} — fixe runtime.provider.model ou passe --model`); }
  }
  const m = (config && config.models) || {};
  if (m.tiers) notes.push(`models.tiers ativo: cada tentativa usa o modelo do nível (${Object.entries(m.tiers).map(([k, v]) => `${k}=${v}`).join(', ')}) no lugar de ${model || 'o padrão'}`);
  if (m.overrides && Object.keys(m.overrides).length) notes.push(`models.overrides: ${Object.entries(m.overrides).map(([t, v]) => `${t}=${v}`).join(', ')}`);
  return { adapter, model, source, operator_chosen: source !== 'padrão embutido', notes };
}

function describe(r) {
  const defaultLabel = r.adapter === 'antigravity' ? '(padrão do Antigravity CLI)' : '(padrão do Claude Code)';
  return `${r.model || defaultLabel} — ${r.source}`;
}

module.exports = { HTTP_DEFAULT_MODEL, resolve, describe };
