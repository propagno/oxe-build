'use strict';

const path = require('path');

/** Variáveis que redirecionam “home” de IDEs; devem ser omitidas nos testes com HOME falso. */
const IDE_HOME_VARS = [
  'CURSOR_CONFIG_DIR',
  'COPILOT_CONFIG_DIR',
  'COPILOT_HOME',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'XDG_CONFIG_HOME',
];

/**
 * Ambiente para spawn: HOME/USERPROFILE coerentes e sem overrides que apontem para o utilizador real.
 * @param {string} fakeHome diretório absoluto que simula ~
 * @param {Record<string, string | undefined>} [extra]
 */
function isolatedHomeEnv(fakeHome, extra = {}) {
  const e = { ...process.env, ...extra };
  for (const k of IDE_HOME_VARS) delete e[k];
  e.HOME = fakeHome;
  e.USERPROFILE = fakeHome;
  e.XDG_CONFIG_HOME = path.join(fakeHome, '.config');
  e.OXE_NO_BANNER = e.OXE_NO_BANNER ?? '1';
  return e;
}

module.exports = { isolatedHomeEnv, IDE_HOME_VARS };
