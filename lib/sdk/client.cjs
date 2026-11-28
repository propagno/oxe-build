'use strict';

/**
 * 1.23.0 (OXB-230-18): Project-bound ergonomic SDK facade (`createClient(projectRoot, options)`).
 * Wraps OXE health, doctor, primer, onboard, CI-parity, multi-agent coordination,
 * autonomous delivery (`deliver`), dashboard context and operational runtime bridges
 * without introducing any external dependencies.
 */

const fs = require('fs');
const path = require('path');
const health = require('../../bin/lib/oxe-project-health.cjs');
const operational = require('../../bin/lib/oxe-operational.cjs');
const dashboard = require('../../bin/lib/oxe-dashboard.cjs');
const agentCoord = require('../../bin/lib/oxe-agent-coord.cjs');
const primer = require('../../bin/lib/oxe-primer.cjs');
const deliverIntake = require('../../bin/lib/oxe-deliver-intake.cjs');
const deliverEngine = require('../../bin/lib/oxe-deliver-engine.cjs');
const deliverRunner = require('../../bin/lib/oxe-deliver-runner.cjs');
const deliverHandoff = require('../../bin/lib/oxe-deliver-handoff.cjs');

const PACKAGE_ROOT = path.join(__dirname, '..', '..');

function readSdkVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

/**
 * Creates a project-bound OXE SDK client.
 *
 * @param {string} [projectRoot]
 * @param {{ session?: string | null, packageRoot?: string }} [options]
 */
function createClient(projectRoot = process.cwd(), options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const defaultSession = options && options.session ? String(options.session) : null;
  const packageRoot = options && options.packageRoot ? path.resolve(options.packageRoot) : PACKAGE_ROOT;
  const version = readSdkVersion();

  const withSession = (opts = {}) => ({
    ...(defaultSession ? { session: defaultSession } : {}),
    ...(opts && typeof opts === 'object' ? opts : {}),
  });

  return {
    projectRoot: rootAbs,
    version,

    status: () => health.buildHealthReport(rootAbs),
    summary: () => health.buildStatusSummary(health.buildHealthReport(rootAbs)),
    doctor: (opts = {}) => {
      const sdk = require('./index.cjs');
      return sdk.runDoctorChecks({ projectRoot: rootAbs, packageRoot, ...(opts || {}) });
    },
    primer: (opts = {}) => primer.buildPrimer(rootAbs, opts || {}),
    onboard: (opts = {}) => operational.runtimeOnboard(rootAbs, opts || {}),
    ciParity: (opts = {}) => operational.runtimeCiParity(rootAbs, opts || {}),
    reevaluate: (opts = {}) => {
      const merged = withSession(opts);
      return operational.runtimeReevaluate(rootAbs, merged.session || null, merged);
    },

    agents: {
      list: (opts = {}) => agentCoord.listActiveAgents(rootAbs, opts || {}),
      register: (lease = {}, opts = {}) => agentCoord.registerAgentLease(rootAbs, lease, opts || {}),
      heartbeat: (agentId, updates = {}, opts = {}) => agentCoord.heartbeatAgentLease(rootAbs, agentId, updates, opts || {}),
      release: (agentId, opts = {}) => agentCoord.releaseAgentLease(rootAbs, agentId, opts || {}),
      collisions: (files = [], opts = {}) => agentCoord.detectWriteSetCollisions(rootAbs, files, opts || {}),
      send: (msg = {}, opts = {}) => agentCoord.postAgentMessage(rootAbs, msg, opts || {}),
      inbox: (opts = {}) => agentCoord.readAgentMessages(rootAbs, opts || {}),
    },

    deliver: {
      init: (opts = {}) => deliverIntake.initDelivery(rootAbs, withSession(opts)),
      status: (opts = {}) => deliverEngine.getDeliveryStatus(rootAbs, withSession(opts)),
      next: (opts = {}) => deliverEngine.getNextDeliveryStep(rootAbs, withSession(opts)),
      advance: (opts = {}) => deliverEngine.advanceDelivery(rootAbs, withSession(opts)),
      mode: (mode, opts = {}) => deliverEngine.setApprovalMode(rootAbs, mode, withSession(opts)),
      answer: (answers, opts = {}) => deliverEngine.answerClarification(rootAbs, answers, withSession(opts)),
      approve: (opts = {}) => deliverEngine.approveDelivery(rootAbs, withSession(opts)),
      resume: (opts = {}) => deliverEngine.resumeDelivery(rootAbs, withSession(opts)),
      cancel: (opts = {}) => deliverEngine.cancelDelivery(rootAbs, withSession(opts)),
      run: (opts = {}) => deliverRunner.runAutonomousDelivery(rootAbs, withSession(opts)),
      probeHttp: (opts = {}) => deliverHandoff.probeHttpServerSmoke(rootAbs, opts || {}),
    },

    dashboard: {
      context: (opts = {}) => dashboard.loadDashboardContext(rootAbs, {
        ...(defaultSession ? { activeSession: defaultSession } : {}),
        ...(opts || {}),
      }),
    },

    operational: {
      verify: (opts = {}) => {
        const merged = withSession(opts);
        return operational.runRuntimeVerify(rootAbs, merged.session || null, merged);
      },
      scorecard: (opts = {}) => {
        const merged = withSession(opts);
        return operational.runtimeScorecard(rootAbs, merged.session || null, merged);
      },
      programStatus: (opts = {}) => {
        const merged = withSession(opts);
        return operational.runtimeProgramStatus(rootAbs, merged.session || null, merged);
      },
    },
  };
}

module.exports = {
  createClient,
};
