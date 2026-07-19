'use strict';

const COMMAND_NAME = /^[a-z][a-z0-9-]*$/;

function createCommandRegistry(definitions = []) {
  const commands = new Map();
  for (const definition of definitions) {
    if (!definition || !COMMAND_NAME.test(definition.name || '')) {
      throw new TypeError('nome de comando inválido');
    }
    if (typeof definition.handler !== 'function') {
      throw new TypeError(`handler obrigatório para ${definition.name}`);
    }
    if (commands.has(definition.name)) throw new Error(`comando duplicado: ${definition.name}`);
    commands.set(definition.name, Object.freeze({ ...definition }));
  }
  return Object.freeze({
    has(name) { return commands.has(name); },
    names() { return [...commands.keys()]; },
    get(name) { return commands.get(name) || null; },
    async dispatch(name, argv = [], context = {}) {
      const definition = commands.get(name);
      if (!definition) return { handled: false, result: undefined };
      if (!Array.isArray(argv)) throw new TypeError('argv deve ser um array');
      const result = await definition.handler([...argv], context);
      return { handled: true, result };
    },
  });
}

module.exports = { createCommandRegistry };
