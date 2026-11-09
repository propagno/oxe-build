import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
import type { TaskExecutor, TaskResult } from '../scheduler/scheduler';
import type { PluginRegistry } from '../plugins/plugin-registry';
import { streamCompletion } from './stream-completion';
import type { ChatMessage, ToolCall } from './stream-completion';
import { BUILT_IN_TOOLS } from './built-in-tools';
import { selectToolsForActions } from './action-tool-map';
import { buildNodePrompt } from './node-prompt-builder';
import type { NodeContextProvider } from './node-context';
import path from 'path';

export interface LlmProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  maxTurns?: number;
  timeoutMs?: number;
  systemPrompt?: string;
}

export type LlmExecutorEventType =
  | 'executor_turn'
  | 'executor_slow_turn'
  | 'turn_start'
  | 'turn_complete'
  | 'tool_call'
  | 'tool_result'
  | 'tool_denied'
  | 'executor_complete'
  /** Once per attempt: turns, tool calls and backend-reported cost. */
  | 'executor_usage'
  | 'turn_timeout';

/** Injectable completion function (defaults to the HTTP OpenAI-compatible client). */
export type CompletionFn = typeof streamCompletion;

export interface LlmExecutorEvent {
  type: LlmExecutorEventType;
  nodeId: string;
  attempt: number;
  detail?: Record<string, unknown>;
}

export interface LlmExecuteOptions {
  previousError?: string | null;
  /** OXB-131: the model of this attempt (tier escalation); empty keeps the provider's. */
  model?: string | null;
  /** Cap from the run budget (OXB-023): the attempt never uses more turns than the run has left. */
  maxTurns?: number | null;
}

export interface LlmTaskExecutorOptions {
  /** Task body, pack contract, workspace snapshot… rendered into the node prompt. */
  contextProvider?: NodeContextProvider | null;
  /**
   * Workspace-relative files the executor may not write (plan-owned acceptance tests, 1.19).
   * `write_file`/`patch_file` on them are denied; anything else that changes them is caught by
   * the verify hash check (`acceptance_tampered`).
   */
  protectedPaths?: string[] | null;
  /** OXB-125: offer the ask_orchestrator tool (opt-in: execute.ask_orchestrator). */
  askOrchestrator?: boolean;
  /**
   * OXB-186: consecutive turns with no file written and no finish_task that end the attempt as `no_progress`
   * (default 8; 0 disables).
   */
  noProgressTurns?: number;
  /** OXB-186: a turn slower than this (ms, default 180000) is reported with the prompt size behind it. */
  slowTurnMs?: number;
}

function normalizeRel(p: string): string {
  return path.normalize(String(p || '')).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

export interface ExecutorUsage {
  turns: number;
  tool_calls: number;
  /** Calls per tool name (e.g. how many `run_command`). */
  tools: Record<string, number>;
  cost_usd: number | null;
  /**
   * OXB-118: what the attempt did, for the project's action rules checked after the fact (a command run, a path
   * read or written). Capped; long commands are cut.
   */
  commands?: string[];
  reads?: string[];
  writes?: string[];
}

const ACTION_LOG_CAP = 300;
/** OXB-153: consecutive call timeouts tolerated inside one attempt before it fails as `timeout`. */
const MAX_CALL_TIMEOUTS_IN_A_ROW = 2;
const TIMEOUT_CONTINUE_NOTICE =
  'A chamada anterior excedeu o tempo limite antes de responder. Os arquivos já escritos continuam no workspace. ' +
  'Continue de onde parou, em passos menores: escreva um arquivo por vez (ou partes de um arquivo grande) e chame finish_task ao terminar.';
/** OXB-148: a single tool result kept in the conversation (the rest is cut with a note). */
export const TOOL_RESULT_MAX_CHARS = 40_000;
export function capToolResult(text: string, max = TOOL_RESULT_MAX_CHARS): string {
  const t = String(text ?? '');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n[… resultado cortado: ${t.length} chars, mostrados ${max}. Peça um trecho menor (offset/limit, path mais estreito).]`;
}
function logAction(list: string[] | undefined, value: unknown): void {
  if (!list || list.length >= ACTION_LOG_CAP || typeof value !== 'string' || !value) return;
  list.push(value.length > 500 ? `${value.slice(0, 500)}…` : value);
}

/** Sent before the last turn (OXB-026): finishing and reporting beats spending it on a verification the runtime repeats. */
export const LAST_TURN_NOTICE =
  'Last turn: finish what is left and call finish_task with a short summary. Do not spend this turn on a final ' +
  'verification run — the runtime runs the task verify itself and judges the work by it.';

const DEFAULT_SYSTEM_PROMPT =
  'You are a precise software engineering agent. Use the tools provided to complete the task. ' +
  'When all actions are done, call finish_task with a summary of what was accomplished.';

export class LlmTaskExecutor implements TaskExecutor {
  constructor(
    private readonly provider: LlmProviderConfig,
    private readonly registry?: PluginRegistry | null,
    private readonly onProgress?: ((event: LlmExecutorEvent) => void) | null,
    private readonly complete: CompletionFn = streamCompletion,
    private readonly options: LlmTaskExecutorOptions = {},
  ) {}

  async execute(
    node: GraphNode,
    lease: WorkspaceLease,
    runId: string,
    attempt: number,
    options: LlmExecuteOptions = {},
  ): Promise<TaskResult> {
    let context = null;
    try {
      context = this.options.contextProvider?.(node, lease) ?? null;
    } catch {
      // Context is an aid, never a reason to fail the attempt.
    }
    const prompt = buildNodePrompt(node, lease, runId, attempt, { previousError: options.previousError ?? null, context });
    const tools = selectToolsForActions(node.actions, { askOrchestrator: this.options.askOrchestrator === true });
    // Only the tools offered for this node's actions may run; the model can still name others.
    const allowedTools = new Set(tools.map((tool) => tool.function.name));
    const cwd = lease.root_path;
    // OXB-185: the provider's maxTurns is the global CAP; the attempt's turns (sized to the task, or the budget left)
    // come in options.maxTurns. Without either, 10 (the old default).
    const optTurns = typeof options.maxTurns === 'number' && options.maxTurns > 0 ? Math.floor(options.maxTurns) : null;
    const providerTurns = this.provider.maxTurns ?? (optTurns ?? 10);
    const maxTurns = optTurns != null ? Math.min(providerTurns, optTurns) : providerTurns;
    const systemPrompt = this.provider.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    let finalOutput = '';
    const evidencePaths: string[] = [];
    let completedByFinishTask = false;
    let finishTaskSummary = '';

    const usage: ExecutorUsage = { turns: 0, tool_calls: 0, cost_usd: null, tools: {}, commands: [], reads: [], writes: [] };
    const done = (result: TaskResult): TaskResult => {
      // A failed attempt keeps its reason in the event log: `env` failures (CLI crash, timeout)
      // were only visible on the console.
      const error = result.success ? null : String(result.output || '').slice(0, 500) || null;
      this.emit({
        type: 'executor_usage',
        nodeId: node.id,
        attempt,
        detail: { ...usage, completed_by: result.completed_by ?? null, success: result.success, failure_class: result.failure_class, error },
      });
      return result;
    };

    let turn = 0;
    let timeoutsInARow = 0;
    // OXB-186: progress = a file written (write/patch) or finish_task; K turns without it end the attempt.
    const noProgressLimit = this.options.noProgressTurns ?? 8;
    const slowTurnMs = this.options.slowTurnMs ?? 180_000;
    let turnsWithoutProgress = 0;
    let turnWrites = 0;
    for (; turn < maxTurns; turn++) {
      this.emit({ type: 'turn_start', nodeId: node.id, attempt, detail: { turn } });
      // OXB-026: the last turn finishes and reports; the runtime runs the task's verify itself afterwards.
      if (maxTurns > 1 && turn === maxTurns - 1 && turn > 0) {
        messages.push({ role: 'user', content: LAST_TURN_NOTICE });
      }

      let response;
      const turnStarted = Date.now();
      try {
        response = await this.complete({
          baseUrl: this.provider.baseUrl,
          apiKey: this.provider.apiKey,
          model: options.model || this.provider.model,
          // the attempt's own model only (OXB-131): the claude adapter must not turn the http default into --model
          attemptModel: options.model || null,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          maxTokens: this.provider.maxTokens,
          timeoutMs: this.provider.timeoutMs,
        });
      } catch (err) {
        // OXB-148: the adapter classifies its failure (context / quota / llm / env) and reports what it already cost.
        const kind = (err as { kind?: unknown }).kind;
        const spent = (err as { costUsd?: unknown }).costUsd;
        if (typeof spent === 'number' && spent > 0) usage.cost_usd = (usage.cost_usd ?? 0) + spent;
        // OXB-153: a call that timed out keeps the attempt — the files it already wrote stay, and the next call
        // continues from the same conversation (with a nudge) instead of restarting the task from scratch.
        if (kind === 'timeout' && timeoutsInARow < MAX_CALL_TIMEOUTS_IN_A_ROW) {
          timeoutsInARow += 1;
          this.emit({ type: 'turn_timeout', nodeId: node.id, attempt, detail: { turn, elapsed_ms: Date.now() - turnStarted, retry: timeoutsInARow } });
          messages.push({ role: 'user', content: TIMEOUT_CONTINUE_NOTICE });
          turn -= 1; // the timed-out call is not a model turn
          continue;
        }
        const failureClass = kind === 'context' || kind === 'quota' || kind === 'llm' || kind === 'timeout' ? kind : 'env';
        return done({ success: false, failure_class: failureClass, evidence: evidencePaths, output: String((err as Error)?.message ?? err) });
      }
      usage.turns += 1;
      timeoutsInARow = 0;
      if (typeof response.usage?.cost_usd === 'number') usage.cost_usd = (usage.cost_usd ?? 0) + response.usage.cost_usd;
      usage.tool_calls += response.tool_calls.length;
      for (const tc of response.tool_calls) usage.tools[tc.function.name] = (usage.tools[tc.function.name] ?? 0) + 1;

      this.emit({ type: 'turn_complete', nodeId: node.id, attempt, detail: { turn, finish_reason: response.finish_reason, elapsed_ms: Date.now() - turnStarted } });

      if (response.content) finalOutput = response.content;

      if (!response.tool_calls.length) break;

      messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.tool_calls,
      });

      // Partition: idempotent tools run concurrently, mutations run serially
      const [concurrent, serial] = partitionToolCalls(response.tool_calls, this.registry ?? undefined);

      const concurrentResults = await Promise.all(
        concurrent.map((tc) => this.invokeToolCall(tc, cwd, node, evidencePaths, allowedTools, usage)),
      );
      const serialResults: ChatMessage[] = [];
      for (const tc of serial) {
        serialResults.push(await this.invokeToolCall(tc, cwd, node, evidencePaths, allowedTools, usage));
      }

      messages.push(...concurrentResults, ...serialResults);

      // OXB-186: a heartbeat per turn (so a stall shows in OXE-EVENTS), a slow-turn report, and the no-progress guard.
      const writesBefore = turnWrites;
      turnWrites = (usage.writes ?? []).length;
      const latencyMs = Date.now() - turnStarted;
      const promptChars = messages.reduce((n, m) => n + String(m.content ?? '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
      this.emit({ type: 'executor_turn', nodeId: node.id, attempt, detail: { turn: turn + 1, max_turns: maxTurns, tool_calls: response.tool_calls.length, tool_calls_total: usage.tool_calls, files_written: (usage.writes ?? []).length, prompt_chars: promptChars, latency_ms: latencyMs } });
      if (latencyMs > slowTurnMs) this.emit({ type: 'executor_slow_turn', nodeId: node.id, attempt, detail: { turn: turn + 1, latency_ms: latencyMs, prompt_chars: promptChars, messages: messages.length } });
      const wroteThisTurn = turnWrites > writesBefore;
      const finishedThisTurn = [...concurrentResults, ...serialResults].some((r) => r.name === 'finish_task');
      turnsWithoutProgress = wroteThisTurn || finishedThisTurn ? 0 : turnsWithoutProgress + 1;
      if (noProgressLimit > 0 && turnsWithoutProgress >= noProgressLimit && !finishedThisTurn) {
        return done({
          success: false,
          failure_class: 'no_progress',
          evidence: evidencePaths,
          output: `no_progress: ${turnsWithoutProgress} turnos seguidos sem escrever arquivo nem chamar finish_task (turno ${turn + 1}/${maxTurns}, ${usage.tool_calls} tool calls, prompt ${promptChars} chars)${finalOutput ? `\n${String(finalOutput).slice(-1500)}` : ''}`,
          completed_by: 'no_progress',
        });
      }

      // Detect finish_task call — authoritative completion signal
      const allResults = [...concurrentResults, ...serialResults];
      // OXB-125: a blocking question with no answer in the artifacts — the task waits for a person (no retry).
      const blockedAsk = allResults.find((r) => r.name === 'ask_orchestrator' && String(r.content || '').includes('__ask_blocked__'));
      if (blockedAsk) {
        return done({ success: false, failure_class: 'waiting_answer', evidence: evidencePaths, output: `waiting_answer: ${String(blockedAsk.content)}` });
      }
      const finishResult = allResults.find((r) => r.name === 'finish_task');
      if (finishResult) {
        try {
          const parsed = JSON.parse(finishResult.content as string);
          if (parsed.__finish_task__) {
            completedByFinishTask = true;
            finishTaskSummary = parsed.summary || '';
            if (Array.isArray(parsed.evidence_paths)) {
              evidencePaths.push(...parsed.evidence_paths.filter((p: unknown) => typeof p === 'string'));
            }
          }
        } catch { /* ignore parse errors */ }
        if (completedByFinishTask) break;
      }
    }

    const completedBy = completedByFinishTask
      ? 'finish_task'
      : turn < maxTurns
        ? 'no_tool_call'
        : 'turn_limit_exhausted';

    if (completedBy === 'turn_limit_exhausted') {
      return done({
        success: false,
        failure_class: 'turns_exhausted',
        evidence: evidencePaths,
        output: `turns_exhausted: ${maxTurns}/${maxTurns} turnos usados sem finish_task${finalOutput ? `\n${finalOutput}` : ''}`,
        completed_by: completedBy,
        turns_used: maxTurns,
        turns_cap: maxTurns,
      });
    }

    // A text-only answer is not a completed task when the node had work to do and nothing was
    // written: that was the "T6 verified, test/api.test.js never created" false green.
    const requiresWork = node.actions.some((action) => action.type !== 'read_code' && action.type !== 'collect_evidence');
    if (completedBy === 'no_tool_call' && requiresWork && evidencePaths.length === 0) {
      return done({
        success: false,
        failure_class: 'llm',
        evidence: [],
        output: finalOutput || 'Model ended the turn without calling any tool or finish_task',
        completed_by: completedBy,
      });
    }

    return done({
      success: true,
      failure_class: null,
      evidence: evidencePaths,
      output: completedByFinishTask ? (finishTaskSummary || finalOutput) : finalOutput,
      completed_by: completedBy,
    });
  }

  private async invokeToolCall(
    tc: ToolCall,
    cwd: string,
    node: GraphNode,
    evidencePaths: string[],
    allowedTools: Set<string>,
    usage?: ExecutorUsage,
  ): Promise<ChatMessage> {
    this.emit({ type: 'tool_call', nodeId: node.id, attempt: 0, detail: { tool: tc.function.name } });

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}');
    } catch {
      // malformed args — pass empty
    }

    let result: string;
    const builtIn = BUILT_IN_TOOLS[tc.function.name];
    const writesFile = tc.function.name === 'write_file' || tc.function.name === 'patch_file';
    const protectedTarget = writesFile && typeof args.path === 'string' && this.isProtected(args.path, cwd);
    if (protectedTarget) {
      this.emit({ type: 'tool_denied', nodeId: node.id, attempt: 0, detail: { tool: tc.function.name, path: args.path, reason: 'frozen_acceptance_test' } });
      result = `[tool denied: ${String(args.path)} is a frozen acceptance test owned by the plan — implement the code so this test passes; do not edit it]`;
    } else if (builtIn && !allowedTools.has(tc.function.name)) {
      this.emit({ type: 'tool_denied', nodeId: node.id, attempt: 0, detail: { tool: tc.function.name } });
      result = `[tool denied: ${tc.function.name} is not permitted for this task]`;
    } else if (builtIn) {
      // OXB-118: recorded before running (a command that fails or times out still happened).
      if (tc.function.name === 'run_command') logAction(usage?.commands, args.command);
      else if (tc.function.name === 'read_file' || tc.function.name === 'list_dir') logAction(usage?.reads, args.path);
      else if (writesFile) logAction(usage?.writes, args.path);
      try {
        result = await builtIn.execute(args, cwd);
        if (tc.function.name === 'write_file' || tc.function.name === 'patch_file') {
          if (typeof args.path === 'string') evidencePaths.push(args.path);
        }
      } catch (err) {
        result = `[tool error] ${err}`;
      }
    } else {
      // Delegate to plugin registry
      const provider = this.registry?.toolProviderFor(tc.function.name);
      if (provider) {
        try {
          const res = await provider.invoke({
            action_type: tc.function.name,
            work_item_id: node.id,
            run_id: '',
            attempt_id: '',
            params: args,
            workspace_root: cwd,
          });
          result = res.output || (res.success ? 'done' : res.error ?? 'failed');
          evidencePaths.push(...res.evidence_paths);
        } catch (err) {
          result = `[plugin error] ${err}`;
        }
      } else {
        result = `[unknown tool: ${tc.function.name}]`;
      }
    }

    this.emit({ type: 'tool_result', nodeId: node.id, attempt: 0, detail: { tool: tc.function.name, length: result.length } });

    return {
      role: 'tool',
      tool_call_id: tc.id,
      name: tc.function.name,
      // OXB-148: one oversized result (a grep over minified bundles, a whole big file) no longer floods the prompt.
      content: capToolResult(result),
    };
  }

  private isProtected(target: string, cwd: string): boolean {
    const list = this.options.protectedPaths ?? [];
    if (!list.length) return false;
    const rel = normalizeRel(path.isAbsolute(target) ? path.relative(cwd, target) : target);
    return list.some((p) => normalizeRel(p) === rel);
  }

  private emit(event: LlmExecutorEvent): void {
    this.onProgress?.(event);
  }
}

/** Only tools known to be idempotent run concurrently; anything unknown is treated as a mutation. */
export function partitionToolCalls(
  toolCalls: ToolCall[],
  registry?: PluginRegistry,
): [ToolCall[], ToolCall[]] {
  const isIdempotent = (name: string): boolean =>
    BUILT_IN_TOOLS[name]?.idempotent ?? registry?.toolProviderFor(name)?.idempotent ?? false;
  const concurrent = toolCalls.filter((tc) => isIdempotent(tc.function.name));
  const serial = toolCalls.filter((tc) => !isIdempotent(tc.function.name));
  return [concurrent, serial];
}
