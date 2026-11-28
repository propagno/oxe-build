/**
 * 1.23.0 (OXB-230-18): Native ESM entrypoint for `oxe-cc`.
 * Usage: `import oxe, { createClient, runDoctorChecks, version } from 'oxe-cc';`
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sdk = require('./index.cjs');

export const {
  version,
  name,
  PACKAGE_ROOT,
  readPackageMeta,
  readMinNode,
  parsePlan,
  parseSpec,
  parseHypotheses,
  parseConfidenceVector,
  parseExecutionPlanTasks,
  parseState,
  validateDecisionFidelity,
  parseLessonsMetrics,
  updateLessonMetric,
  deprecateLowEffectiveness,
  health,
  workflows,
  install,
  manifest,
  agents,
  security,
  plugins,
  dashboard,
  release,
  operational,
  context,
  runtimeSemantics,
  azure,
  artifacts,
  runDoctorChecks,
  createClient,
} = sdk;

export default sdk;
