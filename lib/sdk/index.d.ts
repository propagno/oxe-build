/**
 * OXE SDK (`oxe-cc`) — tipos para consumo em TypeScript.
 * O pacote é CommonJS; use `import oxe = require('oxe-cc')` ou `createRequire`.
 */

export interface PackageMeta {
  version: string;
  name: string;
}

export interface WorkflowDiff {
  expected: string[];
  actual: string[];
  missing: string[];
  extra: string[];
  ok: boolean;
}

export interface DoctorIssue {
  code: string;
  message: string;
  detail?: unknown;
}

export interface WorkflowShapeFileResult {
  file: string;
  warnings: string[];
}

export interface WorkflowShapeResult {
  fileResults: WorkflowShapeFileResult[];
  warnings: DoctorIssue[];
}

/** Idade do scan ou do compact face a `scan_max_age_days` / `compact_max_age_days`. */
export interface HealthStaleInfo {
  stale: boolean;
  days: number | null;
}

export interface OxeNextSuggestion {
  step: string;
  cursorCmd: string;
  reason: string;
  artifacts: string[];
}

/** Relatório retornado por `health.buildHealthReport` e incluído em `runDoctorChecks`.healthReport. */
export interface OxeHealthReport {
  configPath: string | null;
  configParseError: string | null;
  unknownConfigKeys: string[];
  typeErrors: string[];
  phase: string | null;
  scanDate: Date | null;
  stale: HealthStaleInfo;
  compactDate: Date | null;
  staleCompact: HealthStaleInfo;
  phaseWarn: string[];
  summaryGapWarn: string | null;
  specWarn: string[];
  planWarn: string[];
  next: OxeNextSuggestion;
  scanFocusGlobs?: unknown;
  scanIgnoreGlobs?: unknown;
}

export interface DoctorChecksResult {
  ok: boolean;
  errors: DoctorIssue[];
  warnings: DoctorIssue[];
  node: { currentMajor: number; minimumMajor: number; ok: boolean };
  workflowDiff: WorkflowDiff | null;
  projectWorkflowsDir: string | null;
  packageWorkflowsDir: string;
  config: {
    config: Record<string, unknown>;
    path: string | null;
    parseError: string | null;
  };
  validation: { unknownKeys: string[]; typeErrors: string[] };
  healthReport: OxeHealthReport;
  workflowShape: WorkflowShapeResult | null;
}

export interface OxeSdk {
  version: string;
  name: string;
  PACKAGE_ROOT: string;
  readPackageMeta: (root?: string) => PackageMeta;
  readMinNode: (packageRoot: string) => number;
  health: Record<string, unknown>;
  workflows: {
    resolveWorkflowsDir: (targetProject: string) => string | null;
    listWorkflowMdFiles: (workflowsDir: string) => string[];
    diffWorkflows: (expectedDir: string, actualDir: string) => WorkflowDiff;
    validateWorkflowShapes: (
      workflowsDir: string,
      options?: { maxBytesSoft?: number }
    ) => WorkflowShapeResult;
    DEFAULT_MAX_BYTES_SOFT: number;
    SUCCESS_CRITERIA_EXCEPTIONS: Set<string>;
  };
  install: {
    resolveOptionsFromConfig: (
      projectRoot: string,
      optsIn: Record<string, unknown>
    ) => { options: Record<string, unknown>; warnings: string[] };
  };
  manifest: Record<string, unknown>;
  agents: Record<string, unknown>;
  runDoctorChecks: (args: {
    projectRoot: string;
    packageRoot?: string;
    nodeMajor?: number;
    includeWorkflowLint?: boolean;
    workflowLintOptions?: { maxBytesSoft?: number };
  }) => DoctorChecksResult;
}

declare const sdk: OxeSdk;
export = sdk;
