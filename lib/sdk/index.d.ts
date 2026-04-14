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

export interface AzureInventorySummary {
  total: number;
  servicebus: number;
  eventgrid: number;
  sql: number;
  other: number;
}

export interface AzureHealthContext {
  profile: Record<string, unknown> | null;
  authStatus: Record<string, unknown> | null;
  inventorySummary: AzureInventorySummary | null;
  inventoryPath: string;
  operationsPath: string;
  inventorySyncedAt: string | null;
  inventoryStale: { stale: boolean; hours: number | null };
  pendingOperations: number;
  lastOperation: Record<string, unknown> | null;
  warnings: string[];
}

export type CopilotPromptSource = 'workspace' | 'legacy_global' | 'missing';

export interface CopilotWorkspaceIntegration {
  root: string;
  promptsDir: string;
  instructions: string;
  manifest: string;
  promptFiles: string[];
  hasInstructions: boolean;
  hasOxeBlock: boolean;
}

export interface CopilotLegacyIntegration {
  root: string;
  promptsDir: string;
  instructions: string;
  promptFiles: string[];
  hasInstructions: boolean;
  hasOxeBlock: boolean;
  hasOtherManagedBlocks: boolean;
  detected: boolean;
}

export interface CopilotIntegrationReport {
  status: 'healthy' | 'warning' | 'broken' | 'not_installed';
  detected: boolean;
  target: 'workspace';
  promptSource: CopilotPromptSource;
  workspace: CopilotWorkspaceIntegration;
  legacy: CopilotLegacyIntegration;
  manifest: Record<string, unknown> | null;
  warnings: string[];
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
  retroDate: Date | null;
  staleLessons: HealthStaleInfo;
  phaseWarn: string[];
  runtimeWarn?: string[];
  reviewWarn?: string[];
  capabilityWarn?: string[];
  investigationWarn?: string[];
  sessionWarn?: string[];
  installWarn?: string[];
  copilotWarn?: string[];
  copilot?: CopilotIntegrationReport | null;
  summaryGapWarn: string | null;
  specWarn: string[];
  planWarn: string[];
  planSelfEvaluation?: Record<string, unknown> | null;
  planReviewStatus?: string | null;
  activeRun?: Record<string, unknown> | null;
  eventsSummary?: Record<string, unknown> | null;
  memoryLayers?: Record<string, unknown> | null;
  next: OxeNextSuggestion;
  azureActive?: boolean;
  azure?: AzureHealthContext | null;
  scanFocusGlobs?: unknown;
  scanIgnoreGlobs?: unknown;
}

export interface SecurityReport {
  secretFiles: string[];
  pluginsValid: boolean;
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
  securityReport: SecurityReport | null;
}

/** Tarefa parseada de PLAN.md. */
export interface ParsedTask {
  id: string;
  title: string;
  wave: number | null;
  dependsOn: string[];
  files: string[];
  verifyCommand: string | null;
  aceite: string[];
  decisions: string[];
  done: boolean;
  meta: Record<string, unknown> | null;
}

export interface ParsedPlan {
  tasks: ParsedTask[];
  waves: Record<number, string[]>;
  totalTasks: number;
}

export interface ParsedCriterion {
  id: string;
  criterion: string;
  howToVerify: string;
}

export interface ParsedSpec {
  objective: string | null;
  criteria: ParsedCriterion[];
  requiredSections: string[];
}

export interface ParsedState {
  phase: string | null;
  lastScanDate: string | null;
  lastRetroDate: string | null;
  nextStep: string | null;
  decisions: string[];
  activeWorkstreams: string[];
  activeMilestone: string | null;
  /** run_id do blueprint ativo extraído da seção "Blueprint de agentes" em STATE.md. */
  runId: string | null;
  /** lifecycle_status do blueprint: pending_execute | executing | closed | invalidated. */
  lifecycleStatus: string | null;
  /** loop_status da sessão de loop: retrying | passed | escalated. */
  loopStatus: string | null;
}

export interface DecisionFidelityResult {
  ok: boolean;
  gaps: Array<{ decisionId: string; decision: string }>;
  covered: Array<{ decisionId: string; taskIds: string[] }>;
}

export interface PathSafetyResult {
  safe: boolean;
  reason: string | null;
}

export interface SecretMatch {
  line: number;
  pattern: string;
  preview: string;
}

export interface SecretScanResult {
  hasSecrets: boolean;
  matches: SecretMatch[];
}

export interface PlanPathsResult {
  ok: boolean;
  issues: Array<{ path: string; reason: string }>;
}

export interface OxePermissionRule {
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
  scope?: 'execute' | 'apply' | 'all';
}

export interface PermissionCheckResult {
  denied: string[];
  needsApproval: string[];
  allowed: string[];
}

export interface ReplayReport {
  events: Array<Record<string, unknown>>;
  totalEvents: number;
  duration_ms: number | null;
  runId: string | null;
  waveIds: number[];
  taskSequence: string[];
  checkpointSequence: string[];
  failureEvents: Array<Record<string, unknown>>;
  _reportPath?: string;
}

export interface PluginSource {
  source: string;
  version?: string;
}

export interface OxePlugin {
  name: string;
  version?: string;
  hooks: Record<string, (ctx: Record<string, unknown>) => Promise<void> | void>;
}

export interface PluginLoadResult {
  plugins: OxePlugin[];
  errors: Array<{ file: string; error: string }>;
}

export interface PluginValidationResult {
  valid: boolean;
  issues: Array<{ file: string; issue: string }>;
}

export interface ManifestAPI {
  loadFileManifest: (home: string) => Record<string, unknown>;
  writeFileManifest: (home: string, manifest: Record<string, unknown>) => void;
  sha256File: (filePath: string) => string;
  collectFilesRecursive: (dir: string) => string[];
  MANIFEST_DIR: string;
  PATCHES_DIR: string;
}

export interface AgentsAPI {
  adjustWorkflowPathsForNestedLayout: (content: string, layout?: string) => string;
  parseCursorCommandFrontmatter: (mdContent: string) => Record<string, unknown>;
}

export interface OxeSdk {
  version: string;
  name: string;
  PACKAGE_ROOT: string;
  readPackageMeta: (root?: string) => PackageMeta;
  readMinNode: (packageRoot: string) => number;

  /** Parsing de artefatos OXE. */
  parsePlan: (planMd: string) => ParsedPlan;
  parseSpec: (specMd: string) => ParsedSpec;
  parseState: (stateMd: string) => ParsedState;
  validateDecisionFidelity: (discussMd: string, planMd: string) => DecisionFidelityResult;

  health: {
    loadOxeConfigMerged: (targetProject: string) => { config: Record<string, unknown>; path: string | null; parseError: string | null; sources: { system: string | null; user: string | null; project: string | null } };
    validateConfigShape: (cfg: Record<string, unknown>) => { unknownKeys: string[]; typeErrors: string[] };
    buildHealthReport: (target: string) => OxeHealthReport;
    suggestNextStep: (target: string, cfg?: { discuss_before_plan?: boolean }) => OxeNextSuggestion;
    oxePaths: (target: string) => Record<string, string>;
    parseStatePhase: (stateText: string) => string | null;
    parseLastScanDate: (stateText: string) => Date | null;
    parseLastCompactDate: (stateText: string) => Date | null;
    parseLastRetroDate: (stateText: string) => Date | null;
    isStaleScan: (scanDate: Date | null, maxAgeDays: number) => HealthStaleInfo;
    isStaleLessons: (retroDate: Date | null, maxAgeDays: number) => HealthStaleInfo;
    copilotWorkspacePaths: (target: string) => { root: string; promptsDir: string; instructions: string; manifest: string };
    copilotLegacyPaths: () => { root: string; promptsDir: string; instructions: string };
    copilotIntegrationReport: (target: string) => CopilotIntegrationReport;
    planAgentsWarnings: (target: string) => string[];
    phaseCoherenceWarnings: (phase: string, paths: Record<string, string>) => string[];
    specSectionWarnings: (specPath: string, requiredHeadings: string[]) => string[];
    planWaveWarningsFixed: (planPath: string, maxPerWave: number) => string[];
    planTaskAceiteWarnings: (planPath: string) => string[];
    verifyGapsWithoutSummaryWarning: (verifyPath: string, summaryPath: string) => string | null;
    expandExecutionProfile: (profile: string) => Record<string, unknown>;
    ALLOWED_CONFIG_KEYS: string[];
    EXECUTION_PROFILES: string[];
    VERIFICATION_DEPTHS: string[];
    INSTALL_PROFILES: string[];
    INSTALL_REPO_LAYOUTS: string[];
    INSTALL_OBJECT_KEYS: string[];
    EXPECTED_CODEBASE_MAPS: string[];
  };

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

  manifest: ManifestAPI;
  agents: AgentsAPI;

  security: {
    checkPathSafety: (filePath: string, projectRoot: string, options?: {
      allowedRoots?: string[];
      deniedPatterns?: RegExp[];
      secretPatterns?: RegExp[];
    }) => PathSafetyResult;
    scanFileForSecrets: (filePath: string, options?: { contentPatterns?: RegExp[] }) => SecretScanResult;
    scanDirForSecretFiles: (dir: string, options?: { secretPatterns?: RegExp[]; maxDepth?: number }) => string[];
    validatePlanPaths: (filePaths: string[], projectRoot: string) => PlanPathsResult;
    checkFilePermission: (filePath: string, permissions: OxePermissionRule[], currentScope?: string) => { action: string; rule: OxePermissionRule | null };
    checkPermissions: (fileList: string[], permissions: OxePermissionRule[], scope?: string) => PermissionCheckResult;
    globToRegex: (glob: string) => RegExp;
    DEFAULT_SECRET_PATTERNS: RegExp[];
    DEFAULT_SECRET_CONTENT_PATTERNS: RegExp[];
    DEFAULT_DENIED_PATH_PATTERNS: RegExp[];
  };

  /** Plugin system — hooks de ciclo de vida em `.oxe/plugins/*.cjs`. */
  plugins: {
    loadPlugins: (projectRoot: string) => PluginLoadResult;
    runHook: (plugins: OxePlugin[], hookName: string, ctx: Record<string, unknown>) => Promise<Array<{ plugin: string; error: string }>>;
    validatePlugins: (projectRoot: string) => PluginValidationResult;
    initPluginsDir: (projectRoot: string) => void;
    resolvePluginSources: (projectRoot: string, pluginsSources: Array<string | PluginSource>) => { resolved: string[]; errors: Array<{ source: string; error: string }> };
    installNpmPlugin: (projectRoot: string, pkgName: string, version?: string) => { ok: boolean; path: string; error: string };
  };

  dashboard: {
    loadDashboardContext: (projectRoot: string, opts?: { activeSession?: string | null }) => Record<string, unknown>;
    savePlanReviewStatus: (projectRoot: string, input?: Record<string, unknown>) => Record<string, unknown>;
    addPlanReviewComment: (projectRoot: string, input?: Record<string, unknown>) => Record<string, unknown>;
    updatePlanReviewCommentStatus: (projectRoot: string, input?: Record<string, unknown>) => Record<string, unknown> | null;
  };

  operational: {
    operationalPaths: (projectRoot: string, activeSession: string | null) => Record<string, string | null>;
    appendEvent: (projectRoot: string, activeSession: string | null, event?: Record<string, unknown>) => Record<string, unknown>;
    readEvents: (projectRoot: string, activeSession: string | null) => Array<Record<string, unknown>>;
    summarizeEvents: (events: Array<Record<string, unknown>>) => Record<string, unknown>;
    writeRunState: (projectRoot: string, activeSession: string | null, runState?: Record<string, unknown>) => Record<string, unknown>;
    readRunState: (projectRoot: string, activeSession: string | null) => Record<string, unknown> | null;
    buildOperationalGraph: (runState?: Record<string, unknown>) => { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
    applyRuntimeAction: (projectRoot: string, activeSession: string | null, input?: Record<string, unknown>) => Record<string, unknown>;
    parseCapabilityManifest: (text: string) => Record<string, unknown>;
    readCapabilityCatalog: (projectRoot: string) => Array<Record<string, unknown>>;
    buildMemoryLayers: (projectRoot: string, activeSession: string | null) => Record<string, unknown>;
    replayEvents: (projectRoot: string, activeSession: string | null, options?: {
      fromEventId?: string;
      runId?: string;
      waveId?: number;
      limit?: number;
      writeReport?: boolean;
    }) => ReplayReport;
  };

  azure: {
    MIN_AZURE_CLI_MAJOR: number;
    AZURE_CAPABILITY_IDS: string[];
    RESOURCE_GRAPH_QUERY: string;
    DEFAULT_AZURE_PROFILE: Record<string, unknown>;
    azurePaths: (projectRoot: string) => Record<string, string>;
    ensureAzureArtifacts: (projectRoot: string) => Record<string, string>;
    isAzureContextEnabled: (projectRoot: string, config?: Record<string, unknown>) => boolean;
    detectAzureCli: (projectRoot: string, options?: Record<string, unknown>) => Record<string, unknown>;
    loadAzureProfile: (projectRoot: string) => Record<string, unknown>;
    loadAzureAuthStatus: (projectRoot: string) => Record<string, unknown> | null;
    loadAzureInventory: (projectRoot: string) => Record<string, unknown> | null;
    listAzureOperations: (projectRoot: string) => Array<Record<string, unknown>>;
    summarizeInventory: (items: Array<Record<string, unknown>>) => AzureInventorySummary;
    searchAzureInventory: (projectRoot: string, query: string, filters?: { type?: string; resourceGroup?: string }) => Array<Record<string, unknown>>;
    diffInventory: (previousItems: Array<Record<string, unknown>>, currentItems: Array<Record<string, unknown>>) => { added: Array<Record<string, unknown>>; removed: Array<Record<string, unknown>>; unchanged: number };
    statusAzure: (projectRoot: string, config?: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
    ensureAzureCapabilities: (projectRoot: string) => string[];
    getAzureContext: (projectRoot: string, options?: Record<string, unknown>) => Record<string, unknown>;
    loginAzure: (projectRoot: string, options?: Record<string, unknown>) => Record<string, unknown>;
    setAzureSubscription: (projectRoot: string, subscription: string, options?: Record<string, unknown>) => Record<string, unknown>;
    syncAzureInventory: (projectRoot: string, options?: Record<string, unknown>) => Record<string, unknown>;
    executeAzureRead: (projectRoot: string, activeSession: string | null, domain: string, verb: string, input: Record<string, unknown>, options?: Record<string, unknown>) => unknown;
    planAzureOperation: (projectRoot: string, activeSession: string | null, domain: string, input: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
    applyAzureOperation: (projectRoot: string, activeSession: string | null, domain: string, input: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
    azureDoctor: (projectRoot: string, config?: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
    redactObject: (value: unknown) => unknown;
  };

  runDoctorChecks: (args: {
    projectRoot: string;
    packageRoot?: string;
    nodeMajor?: number;
    includeWorkflowLint?: boolean;
    workflowLintOptions?: { maxBytesSoft?: number };
    includeSecurity?: boolean;
  }) => DoctorChecksResult;
}

declare const sdk: OxeSdk;
export = sdk;
