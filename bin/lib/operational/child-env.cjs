'use strict';

/**
 * 1.22.1 (OXB-221-09): Strangler Fig Slice 1 — child process env sanitization policy stack
 * extracted from `bin/lib/oxe-operational.cjs` with explicit dependency injection (zero circular require).
 */

const envSanitize = require('../oxe-env-sanitize.cjs');

/**
 * Builds `applyChildEnvPolicy` and `childEnvForProject` bound to injected runtime/config readers.
 * @param {{ loadRuntimeModule: () => any, readProjectConfig: (projectRoot: string) => any }} deps
 */
function createChildEnvPolicy(deps) {
  const { loadRuntimeModule, readProjectConfig } = deps;
  const childEnvPolicyStack = [];

  /** 1.21.1 (OXB-042) + 1.23.0 (OXB-G02): the project's env policy for every child process of this execute/verify. */
  function applyChildEnvPolicy(projectRoot) {
    const runtime = loadRuntimeModule();
    if (!runtime || typeof runtime.configureChildEnv !== 'function') return () => {};
    const cfg = readProjectConfig(projectRoot);
    const policy = envSanitize.toChildEnvPolicy(cfg);
    childEnvPolicyStack.push(policy);
    runtime.configureChildEnv(policy);
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      const idx = childEnvPolicyStack.lastIndexOf(policy);
      if (idx >= 0) childEnvPolicyStack.splice(idx, 1);
      const prev = childEnvPolicyStack.length ? childEnvPolicyStack[childEnvPolicyStack.length - 1] : {};
      runtime.configureChildEnv(prev);
    };
  }

  function childEnvForProject(projectRoot, baseEnv = process.env) {
    const restore = applyChildEnvPolicy(projectRoot);
    try {
      const rt = loadRuntimeModule();
      return rt && typeof rt.childProcessEnv === 'function'
        ? rt.childProcessEnv(baseEnv)
        : (() => { const e = { ...baseEnv }; delete e.NODE_TEST_CONTEXT; return e; })();
    } finally {
      restore();
    }
  }

  return { applyChildEnvPolicy, childEnvForProject };
}

module.exports = { createChildEnvPolicy };
