'use strict';

/**
 * 1.23.0 (OXB-230-07): Native local MCP (Model Context Protocol) stdio server (`oxe-cc mcp`).
 * Pure Node.js stdlib JSON-RPC 2.0 implementation (zero external npm dependencies).
 * Supports both `Content-Length` framing and newline-delimited JSON (NDJSON) over stdio.
 */

const fs = require('fs');
const path = require('path');

const PROTOCOL_VERSION = '2024-11-05';

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

const TOOLS = [
  {
    name: 'oxe_status',
    description: 'Returns OXE project health report, workspace mode, active session, phase, and next step (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory (defaults to server cwd).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_onboard',
    description: 'Builds the read-only agnostic onboarding pack (stacks, CI pipelines, ALM profile, env, phase_gates gaps).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        activeSession: { type: 'string', description: 'Optional active session path.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_agents_list',
    description: 'Lists active multi-agent leases across all worktrees of the git repository (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_agents_register',
    description: 'Registers or renews an active agent lease with write_set ownership in the shared git ledger.',
    inputSchema: {
      type: 'object',
      required: ['agent_id'],
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        agent_id: { type: 'string', description: 'Unique agent identifier.' },
        provider: { type: 'string', description: 'Agent/IDE provider name.' },
        role: { type: 'string', description: 'Agent role (executor, planner, verifier, etc.).' },
        task: { type: 'string', description: 'Current task or card ID.' },
        write_set: { type: 'array', items: { type: 'string' }, description: 'Relative file paths owned by this agent.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_agents_collisions',
    description: 'Checks whether candidate files collide with write_set leases held by other active agents.',
    inputSchema: {
      type: 'object',
      required: ['files'],
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Candidate relative file paths to check.' },
        exclude_agent_id: { type: 'string', description: 'Agent ID to exclude from collision check.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_agents_send',
    description: 'Posts a coordination message to the shared cross-worktree agent inbox.',
    inputSchema: {
      type: 'object',
      required: ['body'],
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        from: { type: 'string', description: 'Sender agent ID.' },
        to: { type: 'string', description: 'Target agent ID or "all".' },
        topic: { type: 'string', description: 'Optional message topic.' },
        body: { type: 'string', description: 'Message content.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_agents_inbox',
    description: 'Reads messages from the shared cross-worktree agent inbox.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        to: { type: 'string', description: 'Optional filter by recipient agent ID.' },
        limit: { type: 'number', description: 'Max number of messages to return.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_reevaluate',
    description: 'Evaluates upstream drift on base branch against pending PLAN.json tasks (no_impact, mechanical_sync, contract_drift).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        against: { type: 'string', description: 'Base branch/ref to compare against (default origin/main or main).' },
        since: { type: 'string', description: 'Optional base SHA override.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_plan_lint',
    description: 'Runs deterministic OXE plan lint checks on the active plan.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        session: { type: 'string', description: 'Optional active session.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_doctor_ci_parity',
    description: 'Runs local pre-push CI parity checks (clean-checkout doctor, engines.node parity, POSIX symlink gitignore hygiene).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_scorecard',
    description: 'Returns OXE runtime scorecard metrics and model routing telemetry.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        session: { type: 'string', description: 'Optional active session.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_primer',
    description: 'Returns the compact (<80 lines) OXE agent onboarding primer detecting greenfield/brownfield, approval modes (single-ok vs auto), and autonomous deliver protocol.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        session: { type: 'string', description: 'Optional active session.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_deliver_status',
    description: 'Returns the current autonomous delivery state machine (DELIVER.json), progress, approval mode, and budget.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        session: { type: 'string', description: 'Optional delivery session.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_deliver_next',
    description: 'Returns the single next atomic step contract (state, allowed_files, frozen_tests, verify_cmd, advance_cmd) for Chat-Driven autonomous delivery.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        session: { type: 'string', description: 'Optional delivery session.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'oxe_deliver_advance',
    description: 'Mechanically verifies the active delivery gate (frozen test hashes, anti-stub, verification/regression, smoke) and advances DELIVER.json.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project root directory.' },
        session: { type: 'string', description: 'Optional delivery session.' },
        frozen_tests: { type: 'array', items: { type: 'string' }, description: 'Acceptance test files to freeze in PHASE_FREEZE_TESTS.' },
        verify_command: { type: 'string', description: 'Optional explicit verification command.' },
        smoke_command: { type: 'string', description: 'Optional explicit smoke command for FINAL_SMOKE.' },
      },
      additionalProperties: false,
    },
  },
];

async function executeTool(name, args = {}, ctx = {}) {
  const targetDir = path.resolve((args && args.dir) || ctx.projectRoot || process.cwd());
  const session = (args && (args.session || args.activeSession)) || ctx.activeSession || null;

  if (name === 'oxe_status') {
    const health = require('./oxe-project-health.cjs');
    const report = health.buildHealthReport(targetDir);
    return {
      projectRoot: targetDir,
      workspaceMode: report.workspaceMode,
      healthStatus: report.healthStatus,
      phase: report.phase,
      activeSession: report.activeSession,
      next: report.next,
      warnings: {
        session: report.sessionWarn || [],
        phase: report.phaseWarn || [],
        plan: report.planWarn || [],
      },
    };
  }
  if (name === 'oxe_onboard') {
    return require('./oxe-onboard.cjs').buildOnboardingPack(targetDir, { activeSession: session });
  }
  if (name === 'oxe_agents_list') {
    const coord = require('./oxe-agent-coord.cjs');
    return { agents: coord.listActiveAgents(targetDir, { readOnly: true }) };
  }
  if (name === 'oxe_agents_register') {
    const coord = require('./oxe-agent-coord.cjs');
    const lease = coord.registerAgentLease(targetDir, {
      agent_id: args.agent_id,
      provider: args.provider || 'mcp-client',
      role: args.role || 'executor',
      task: args.task || null,
      write_set: Array.isArray(args.write_set) ? args.write_set : [],
    });
    return { ok: true, lease };
  }
  if (name === 'oxe_agents_collisions') {
    const coord = require('./oxe-agent-coord.cjs');
    return coord.detectWriteSetCollisions(targetDir, Array.isArray(args.files) ? args.files : [], {
      excludeAgentId: args.exclude_agent_id || null,
    });
  }
  if (name === 'oxe_agents_send') {
    const coord = require('./oxe-agent-coord.cjs');
    const message = coord.postAgentMessage(targetDir, {
      from: args.from || 'mcp-client',
      to: args.to || 'all',
      topic: args.topic || 'general',
      body: args.body || '',
    });
    return { ok: true, message };
  }
  if (name === 'oxe_agents_inbox') {
    const coord = require('./oxe-agent-coord.cjs');
    return { messages: coord.readAgentMessages(targetDir, { to: args.to || null, limit: args.limit || 50 }) };
  }
  if (name === 'oxe_reevaluate') {
    return require('./oxe-reevaluate.cjs').reevaluateAgainstBase(targetDir, {
      against: args.against || null,
      since: args.since || null,
    });
  }
  if (name === 'oxe_plan_lint') {
    return require('./oxe-operational.cjs').runtimePlanLint(targetDir, session, { precheck: false });
  }
  if (name === 'oxe_doctor_ci_parity') {
    return require('./oxe-ci-parity.cjs').runCiParityCheck(targetDir);
  }
  if (name === 'oxe_scorecard') {
    return require('./oxe-operational.cjs').runtimeScorecard(targetDir, session, {});
  }
  if (name === 'oxe_primer') {
    const primerMod = require('./oxe-primer.cjs');
    const primer = primerMod.buildPrimer(targetDir, { activeSession: session });
    return { ...primer, markdown: primerMod.formatPrimerMarkdown(primer) };
  }
  if (name === 'oxe_deliver_status') {
    return require('./oxe-deliver-engine.cjs').getDeliveryStatus(targetDir, { session });
  }
  if (name === 'oxe_deliver_next') {
    return require('./oxe-deliver-engine.cjs').getNextDeliveryStep(targetDir, { session });
  }
  if (name === 'oxe_deliver_advance') {
    return require('./oxe-deliver-engine.cjs').advanceDelivery(targetDir, {
      session,
      frozenTests: Array.isArray(args.frozen_tests) ? args.frozen_tests : undefined,
      verifyCommand: args.verify_command || undefined,
      smokeCommand: args.smoke_command || undefined,
    });
  }
  return null;
}

/**
 * Pure JSON-RPC 2.0 handler for MCP messages. Returns `null` for notifications (no `id`).
 */
async function handleJsonRpcMessage(msg, ctx = {}) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: msg && msg.id !== undefined ? msg.id : null,
      error: { code: -32600, message: 'Invalid JSON-RPC 2.0 Request' },
    };
  }

  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== undefined;
  const { id, method, params = {} } = msg;

  // Notifications require no response
  if (method === 'notifications/initialized' || method === 'notifications/cancelled' || !hasId) {
    return null;
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: 'oxe-cc',
          version: readPackageVersion(),
        },
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const toolName = params && typeof params.name === 'string' ? params.name : '';
    const known = TOOLS.some((t) => t.name === toolName);
    if (!known) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown MCP tool: ${toolName}` },
      };
    }
    try {
      const data = await executeTool(toolName, (params && params.arguments) || {}, ctx);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          isError: false,
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: String(err && err.message ? err.message : err) }],
          isError: true,
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

function encodeResponse(payload, mode) {
  const json = JSON.stringify(payload);
  if (mode === 'ndjson') return `${json}\n`;
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

/**
 * Starts the stdio MCP JSON-RPC 2.0 server, listening on `input` (default `process.stdin`)
 * and writing framed responses to `output` (default `process.stdout`).
 */
function startStdioServer(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const ctx = {
    projectRoot: path.resolve(options.projectRoot || process.cwd()),
    activeSession: options.activeSession || null,
  };

  let buffer = Buffer.alloc(0);
  let framingMode = options.framing || 'auto'; // 'lsp' | 'ndjson' | 'auto'
  let chain = Promise.resolve();

  function enqueueMessage(rawText, detectedMode) {
    const replyMode = framingMode === 'auto' ? detectedMode : framingMode;
    chain = chain.then(async () => {
      let msg = null;
      try {
        msg = JSON.parse(rawText);
      } catch {
        const parseErr = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
        output.write(encodeResponse(parseErr, replyMode));
        return;
      }
      const res = await handleJsonRpcMessage(msg, ctx);
      if (res) output.write(encodeResponse(res, replyMode));
    }).catch(() => { /* never crash stdio loop */ });
  }

  function drainBuffer() {
    while (buffer.length > 0) {
      // Skip leading CR/LF whitespace between messages
      let start = 0;
      while (start < buffer.length && (buffer[start] === 0x0d || buffer[start] === 0x0a)) start += 1;
      if (start > 0) buffer = buffer.subarray(start);
      if (buffer.length === 0) break;

      // Case 1: LSP / MCP `Content-Length: N\r\n\r\n<body>`
      if (buffer.subarray(0, 15).toString('ascii').toLowerCase().startsWith('content-length:')) {
        const sepIdx = buffer.indexOf('\r\n\r\n');
        const sepLen = sepIdx >= 0 ? 4 : 2;
        const headerEnd = sepIdx >= 0 ? sepIdx : buffer.indexOf('\n\n');
        if (headerEnd < 0) break; // wait for complete header
        const headerText = buffer.subarray(0, headerEnd).toString('ascii');
        const m = /content-length:\s*(\d+)/i.exec(headerText);
        if (!m) {
          buffer = buffer.subarray(headerEnd + sepLen);
          continue;
        }
        const contentLen = Number(m[1]);
        const bodyStart = headerEnd + sepLen;
        if (buffer.length < bodyStart + contentLen) break; // wait for complete body
        const bodyText = buffer.subarray(bodyStart, bodyStart + contentLen).toString('utf8');
        buffer = buffer.subarray(bodyStart + contentLen);
        enqueueMessage(bodyText, 'lsp');
        continue;
      }

      // Case 2: NDJSON (one JSON object per line)
      const nlIdx = buffer.indexOf(0x0a);
      if (nlIdx < 0) break;
      const line = buffer.subarray(0, nlIdx).toString('utf8').trim();
      buffer = buffer.subarray(nlIdx + 1);
      if (line) enqueueMessage(line, 'ndjson');
    }
  }

  return new Promise((resolve) => {
    input.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      buffer = Buffer.concat([buffer, buf]);
      drainBuffer();
    });
    input.on('end', () => {
      // Flush any trailing line without trailing newline
      const rem = buffer.toString('utf8').trim();
      if (rem && rem.startsWith('{')) {
        buffer = Buffer.alloc(0);
        enqueueMessage(rem, 'ndjson');
      }
      chain.finally(() => resolve({ ok: true }));
    });
    if (typeof input.resume === 'function') input.resume();
  });
}

function createMcpServer(options = {}) {
  const ctx = {
    projectRoot: path.resolve(options.projectRoot || process.cwd()),
    activeSession: options.activeSession || null,
  };
  return {
    ctx,
    handleRequest: (msg) => handleJsonRpcMessage(msg, ctx),
    startStdio: (stdioOpts = {}) => startStdioServer({ ...options, ...stdioOpts }),
  };
}

module.exports = {
  PROTOCOL_VERSION,
  TOOLS,
  executeTool,
  handleJsonRpcMessage,
  startStdioServer,
  createMcpServer,
};
