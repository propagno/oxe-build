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

export interface VerificationSummary {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  error: number;
  allPassed: boolean;
  profile: string | null;
  manifestPath: string;
}

export interface ResidualRiskSummary {
  total: number;
  highOrCritical: number;
  ledgerPath: string;
}

export interface EvidenceCoverageSummary {
  total_checks: number;
  checks_with_evidence: number;
  total_evidence_refs: number;
  coverage_percent: number;
}

export interface PendingGatesSummary {
  path: string;
  total: number;
  gateSlaHours?: number;
  staleGateCount?: number;
  pending: Array<Record<string, unknown>>;
  stalePending: Array<Record<string, unknown>>;
}

export interface GateQueueSnapshot {
  path: string;
  total: number;
  gate_sla_hours?: number;
  staleCount?: number;
  pending: Array<Record<string, unknown>>;
  stale_pending?: Array<Record<string, unknown>>;
  resolved_recent?: Array<Record<string, unknown>>;
  byRun?: Record<string, number>;
  byScope?: Record<string, number>;
  all?: Array<Record<string, unknown>>;
}

export interface MultiAgentStatusSummary {
  path: string | null;
  enabled: boolean;
  runId: string | null;
  mode: string | null;
  workspaceIsolationEnforced: boolean;
  agents: Array<Record<string, unknown>>;
  ownership: Array<Record<string, unknown>>;
  orphanReassignments: Array<Record<string, unknown>>;
  handoffs: Array<Record<string, unknown>>;
  arbitrationResults: Array<Record<string, unknown>>;
  summary?: Record<string, unknown> | null;
}

export type WorkspaceMode = 'product_package' | 'oxe_project';

export interface ReleaseManifest {
  schema_version: number;
  generated_at: string;
  project_root: string;
  package_root: string;
  release_contract: Record<string, unknown>;
  versions: Record<string, unknown>;
  runtime_compiled: { path: string; ok: boolean };
  canonical_source?: Record<string, unknown>;
  semantics?: Record<string, unknown>;
  wrappers: Record<string, unknown>;
  reports: Record<string, unknown>;
}

export interface ReleaseConsistencyResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  manifest: ReleaseManifest;
  manifestPath: string;
}

export interface RuntimeSmokeReport {
  path: string;
  present: boolean;
  ok: boolean;
  total: number;
  failures: string[];
  missingRequired: string[];
  results: Array<Record<string, unknown>>;
  raw: Record<string, unknown> | null;
}

export interface PolicyDecisionSummary {
  total: number;
  denied: number;
  gated: number;
  overridesWithoutRationale: number;
}

export interface QuotaSummary {
  limits: {
    maxWorkItemsPerRun: number | null;
    maxMutationsPerRun: number | null;
    maxRetriesPerRun: number | null;
  };
  consumed: {
    workItems: number;
    mutations: number;
    retries: number;
  };
  violations: string[];
  exceeded: boolean;
}

export interface AuditSummary {
  path: string;
  totalEntries: number;
  runEntries: number;
  warn: number;
  critical: number;
  oldest: string | null;
  newest: string | null;
  actors: string[];
  actions: Record<string, number>;
}

export interface PromotionSummary {
  status: string | null;
  targetKind: string | null;
  remote: string | null;
  targetRef: string | null;
  prUrl: string | null;
  prNumber: number | null;
  coveragePercent: number | null;
  reasons: string[];
  path: string;
}

export interface ExecutionImplementationPackSummary {
  path: string | null;
  exists: boolean;
  parseError: string | null;
  ready: boolean;
  tasks: Array<Record<string, unknown>>;
  taskCount: number;
  mutatingTasks: number;
  criticalGaps: string[];
}

export interface ExecutionReferenceAnchorsSummary {
  path: string | null;
  exists: boolean;
  ready: boolean;
  anchors: Array<Record<string, unknown>>;
  missingCriticalCount: number;
  staleCount: number;
  criticalGaps: string[];
}

export interface ExecutionFixturePackSummary {
  path: string | null;
  exists: boolean;
  parseError: string | null;
  ready: boolean;
  fixtures: Array<Record<string, unknown>>;
  fixtureCount: number;
  criticalGaps: string[];
}

export interface ExecutionRationalitySummary {
  applicable: boolean;
  planTaskCount: number;
  externalReferenceCount: number;
  implementationPackReady: boolean;
  referenceAnchorsReady: boolean;
  fixturePackReady: boolean;
  executionRationalityReady: boolean;
  criticalExecutionGaps: string[];
  implementationPack: ExecutionImplementationPackSummary;
  referenceAnchors: ExecutionReferenceAnchorsSummary;
  fixturePack: ExecutionFixturePackSummary;
}

/** Relatório retornado por `health.buildHealthReport` e incluído em `runDoctorChecks`.healthReport. */
export interface OxeHealthReport {
  workspaceMode?: WorkspaceMode;
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
  implementationPackReady?: boolean;
  referenceAnchorsReady?: boolean;
  fixturePackReady?: boolean;
  executionRationalityReady?: boolean;
  criticalExecutionGaps?: string[];
  executionRationality?: ExecutionRationalitySummary | null;
  planReviewStatus?: string | null;
  activeRun?: Record<string, unknown> | null;
  eventsSummary?: Record<string, unknown> | null;
  memoryLayers?: Record<string, unknown> | null;
  verificationSummary?: VerificationSummary | null;
  residualRiskSummary?: ResidualRiskSummary | null;
  evidenceCoverage?: EvidenceCoverageSummary | null;
  pendingGates?: PendingGatesSummary | null;
  policyDecisionSummary?: PolicyDecisionSummary | null;
  enterpriseWarn?: string[];
  quotaSummary?: QuotaSummary | null;
  auditSummary?: AuditSummary | null;
  promotionSummary?: PromotionSummary | null;
  multiAgent?: MultiAgentStatusSummary | null;
  next: OxeNextSuggestion;
  azureActive?: boolean;
  azure?: AzureHealthContext | null;
  contextWarn?: string[];
  semanticsWarn?: string[];
  contextPacks?: Record<string, ContextPackSummary>;
  contextQuality?: ContextQualitySummary;
  semanticsDrift?: SemanticsDriftSummary;
  releaseReadiness?: ReleaseConsistencyResult | null;
  packFreshness?: Record<string, PackFreshness>;
  activeSummaryRefs?: { project: string | null; session: string | null; phase: string | null };
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

export type ContextPackMode = 'standard' | 'auditor';

export interface LessonOutcome {
  cycle: string;
  verify_status: string;
  saved_hours?: number;
  failure_condition?: string;
}

export interface LessonMetric {
  id: string;
  rule: string;
  type: string;
  applied_cycles: string[];
  outcomes: LessonOutcome[];
  success_rate: number;
  status: 'active' | 'deprecated' | 'conditional';
  deprecation_threshold: number;
}

export interface ConfidenceDimension {
  name: string;
  score: number;
  weight: number;
  note: string;
}

export interface ConfidenceVector {
  cycle: string | null;
  generated_at: string | null;
  dimensions: ConfidenceDimension[];
  global: { score: number; gate: string };
}

export interface CriticalHypothesis {
  id: string;
  condition: string;
  validation: string;
  on_failure: string;
  checkpoint: string | null;
  status: 'pending' | 'validated' | 'refuted' | 'skipped';
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

export interface ContextArtifactSelection {
  alias: string;
  path: string | null;
  exists: boolean;
  required: boolean;
  using_fallback: boolean;
  scope: string;
  summary: string;
}

export interface ContextGap {
  alias: string;
  severity: 'critical' | 'warning';
  reason: string;
}

export interface ContextConflict {
  alias: string;
  reason: string;
  primary_path: string | null;
  fallback_path: string | null;
}

export interface PackFreshness {
  generated_at: string | null;
  latest_source_at: string | null;
  pack_age_hours: number | null;
  max_pack_age_hours: number;
  stale: boolean;
  reason: 'fresh' | 'pack_age_exceeded' | 'source_newer_than_pack' | 'fallback_required';
}

export interface ContextQualityScore {
  score: number;
  status: 'excellent' | 'good' | 'fragile' | 'critical';
  requiredMissing: number;
  optionalMissing: number;
  conflicts: number;
  fallbackCount: number;
}

export interface ContextPackSummary {
  path?: string;
  context_tier: string;
  semantics_hash: string | null;
  read_order: string[];
  selected_artifacts: ContextArtifactSelection[];
  gaps: ContextGap[];
  conflicts: ContextConflict[];
  fallback_required: boolean;
  freshness: PackFreshness;
  context_quality: ContextQualityScore;
}

export interface ContextQualitySummary {
  primaryWorkflow: string | null;
  primaryScore: number | null;
  primaryStatus: string | null;
  byWorkflow: Record<string, Record<string, unknown>>;
}

export interface SemanticsDriftSummary {
  ok: boolean;
  contractVersion: string;
  manifestPath: string;
  manifest: Record<string, unknown> | null;
  audit: {
    ok: boolean;
    warnings: string[];
    mismatchCount: number;
    mismatches: Array<Record<string, unknown>>;
    targets: Record<string, { path: string; checked: number; missing: boolean }>;
  };
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

export interface ContextAPI {
  contextPaths: (projectRoot: string, activeSession?: string | null) => Record<string, unknown>;
  resolveArtifactCandidates: (projectRoot: string, activeSession?: string | null) => Record<string, unknown>;
  buildProjectSummary: (projectRoot: string, activeSession?: string | null, options?: Record<string, unknown>) => Record<string, unknown>;
  buildSessionSummary: (projectRoot: string, activeSession?: string | null, options?: Record<string, unknown>) => Record<string, unknown> | null;
  buildPhaseSummary: (projectRoot: string, activeSession?: string | null, options?: Record<string, unknown>) => Record<string, unknown>;
  buildContextIndex: (projectRoot: string, activeSession?: string | null, options?: Record<string, unknown>) => Record<string, unknown>;
  buildContextPack: (projectRoot: string, input?: Record<string, unknown>) => Record<string, unknown>;
  inspectContextPack: (projectRoot: string, input?: Record<string, unknown>) => Record<string, unknown>;
  buildAllContextPacks: (projectRoot: string, input?: Record<string, unknown>) => Array<Record<string, unknown>>;
  computeContextQuality: (pack: Record<string, unknown>) => Record<string, unknown>;
  computePackFreshness: (pack: Record<string, unknown>, contract?: Record<string, unknown>) => Record<string, unknown>;
  resolvePackFile: (projectRoot: string, workflow: string, activeSession?: string | null) => string;
  summarizeText: (text: string, maxChars?: number, maxLines?: number) => string;
  extractSemanticFragment: (text: string, options?: { intent?: string; maxChars?: number; preserveMarkers?: string[] }) => string;
  parseHypotheses: (planText: string) => CriticalHypothesis[];
  parseConfidenceVector: (planText: string) => ConfidenceVector | null;
}

export interface RuntimeSemanticsAPI {
  CONTRACT_VERSION: string;
  CONTRACTS_PATH: string;
  CONTRACTS_REGISTRY: Record<string, unknown>;
  REQUIRED_CONTRACT_FIELDS: string[];
  RUNTIME_METADATA_KEYS: string[];
  validateWorkflowContractsRegistry: (registry?: Record<string, unknown>) => string[];
  getWorkflowContract: (slug: string) => Record<string, unknown> | null;
  getAllWorkflowContracts: () => Array<Record<string, unknown>>;
  computeSemanticsHash: (slug: string) => string | null;
  getRuntimeMetadataForSlug: (slug: string, options?: Record<string, unknown>) => Record<string, string>;
  renderRuntimeMetadataLines: (meta: Record<string, string>) => string[];
  buildReasoningContractBlock: (meta: Record<string, string>, options?: Record<string, unknown>) => string;
  pickRuntimeMetadata: (frontmatter: Record<string, string>) => Record<string, string>;
  splitFrontmatter: (raw: string) => { frontmatter: string; body: string };
  parseFrontmatterMap: (raw: string) => Record<string, string>;
  slugFromPromptFilename: (name: string) => string;
  slugFromCommandFilename: (name: string) => string;
  auditWrapperText: (slug: string, raw: string) => Record<string, unknown>;
  auditRuntimeTargets: (projectRoot: string) => Record<string, unknown>;
}

export interface OxeSdk {
  version: string;
  name: string;
  PACKAGE_ROOT: string;
  readPackageMeta: (root?: string) => PackageMeta;
  readMinNode: (packageRoot: string) => number;

  /** Parsing de artefatos OXE. */
  parsePlan: (planMd: string) => ParsedPlan;
  parseHypotheses: (planText: string) => CriticalHypothesis[];
  parseConfidenceVector: (planText: string) => ConfidenceVector | null;
  parseExecutionPlanTasks: (planPath: string | null) => Array<Record<string, unknown>>;
  parseSpec: (specMd: string) => ParsedSpec;
  parseState: (stateMd: string) => ParsedState;
  validateDecisionFidelity: (discussMd: string, planMd: string) => DecisionFidelityResult;
  parseLessonsMetrics: (metricsJson: string) => LessonMetric[];
  updateLessonMetric: (metrics: LessonMetric[], lessonId: string, outcome: LessonOutcome) => LessonMetric[];
  deprecateLowEffectiveness: (metrics: LessonMetric[], threshold?: number, minObservations?: number) => LessonMetric[];
  verifyRun?: (input: {
    projectRoot: string;
    runId: string;
    workItemId: string;
    cwd: string;
    suite: Record<string, unknown>;
    pluginRegistry?: Record<string, unknown>;
    evidenceStore?: Record<string, unknown>;
    attemptNumber?: number;
    timeoutMs?: number;
  }) => Promise<Record<string, unknown>>;

  health: {
    loadOxeConfigMerged: (targetProject: string) => { config: Record<string, unknown>; path: string | null; parseError: string | null; sources: { system: string | null; user: string | null; project: string | null } };
    validateConfigShape: (cfg: Record<string, unknown>) => { unknownKeys: string[]; typeErrors: string[] };
    buildHealthReport: (target: string) => OxeHealthReport;
    detectWorkspaceMode: (target: string) => { workspaceMode: WorkspaceMode; packageName: string | null; canonicalTreePresent: boolean; commandsTreePresent: boolean };
    shouldSuppressExecutionWorkspaceGates: (workspaceMode: WorkspaceMode, phase?: string | null, activeSession?: string | null, activeRun?: Record<string, unknown> | null) => boolean;
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
    buildExecutionRationality: (paths?: Record<string, string | null | undefined>) => ExecutionRationalitySummary;
    executionRationalityWarningsFromSummary: (summary: ExecutionRationalitySummary) => string[];
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

  release: {
    REQUIRED_RUNTIMES: string[];
    WRAPPER_TARGETS: Array<Record<string, unknown>>;
    releasePaths: (projectRoot: string) => Record<string, string>;
    collectWrapperHashes: (projectRoot: string) => Record<string, unknown>;
    loadRuntimeSmokeReport: (projectRoot: string) => RuntimeSmokeReport;
    loadRecoveryFixtureReport: (projectRoot: string) => RuntimeSmokeReport;
    loadMultiAgentSoakReport: (projectRoot: string) => RuntimeSmokeReport;
    buildReleaseManifest: (projectRoot: string, options?: Record<string, unknown>) => ReleaseManifest;
    inspectCanonicalSource: (projectRoot: string) => Record<string, unknown>;
    evaluateReleaseManifest: (manifest: ReleaseManifest, options?: Record<string, unknown>) => ReleaseConsistencyResult;
    inspectReleaseReadiness: (projectRoot: string, options?: Record<string, unknown>) => ReleaseConsistencyResult;
    checkReleaseConsistency: (projectRoot: string, options?: Record<string, unknown>) => ReleaseConsistencyResult;
  };

  context: ContextAPI;
  runtimeSemantics: RuntimeSemanticsAPI;

  operational: {
    operationalPaths: (projectRoot: string, activeSession: string | null) => Record<string, string | null>;
    appendEvent: (projectRoot: string, activeSession: string | null, event?: Record<string, unknown>) => Record<string, unknown>;
    readEvents: (projectRoot: string, activeSession: string | null) => Array<Record<string, unknown>>;
    summarizeEvents: (events: Array<Record<string, unknown>>) => Record<string, unknown>;
    writeRunState: (projectRoot: string, activeSession: string | null, runState?: Record<string, unknown>) => Record<string, unknown>;
    readRunState: (projectRoot: string, activeSession: string | null) => Record<string, unknown> | null;
    buildOperationalGraph: (runState?: Record<string, unknown>) => { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
    serializeCanonicalState: (state: unknown) => Record<string, unknown> | null;
    hydrateCanonicalState: (serialized: unknown) => Record<string, unknown>;
    reduceCanonicalRunState: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Record<string, unknown> | null;
    compileExecutionGraphFromArtifacts: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Record<string, unknown>;
    compileVerificationSuiteFromArtifacts: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Record<string, unknown>;
    projectRuntimeArtifacts: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Record<string, unknown>;
    runRuntimeCiChecks: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    buildRuntimePluginRegistry: (projectRoot: string) => Record<string, unknown> | null;
    readRuntimeGates: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => GateQueueSnapshot;
    resolveRuntimeGate: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    runRuntimeVerify: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    runRuntimePromotion: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    recoverRuntimeState: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Record<string, unknown>;
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
    replayRuntimeState: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => Record<string, unknown>;
    readRuntimeMultiAgentStatus: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => MultiAgentStatusSummary;
    multiAgentStatus: (projectRoot: string, activeSession: string | null, options?: Record<string, unknown>) => MultiAgentStatusSummary;
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

// Re-exports from @oxe/runtime (R1 — Runtime Foundation)
export * from '../runtime/index';
