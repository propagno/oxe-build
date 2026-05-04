import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
import type { TaskExecutor, TaskResult } from '../scheduler/scheduler';
import type { PluginRegistry } from '../plugins/plugin-registry';
import { streamCompletion } from './stream-completion';
import type { ChatMessage, ToolCall, ToolSchema } from './stream-completion';
import { BUILT_IN_TOOLS } from './built-in-tools';
import { selectToolsForActions } from './action-tool-map';
import { buildNodePrompt } from './node-prompt-builder';

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
  | 'turn_start'
  | 'turn_complete'
  | 'tool_call'
  | 'tool_result'
  | 'executor_complete';

export interface LlmExecutorEvent {
  type: LlmExecutorEventType;
  nodeId: string;
  attempt: number;
  detail?: Record<string, unknown>;
}

export interface LlmExecuteOptions {
  previousError?: string | null;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a precise software engineering agent. Use the tools provided to complete the task. ' +
  'When all actions are done, call finish_task with a summary of what was accomplished.';

export class LlmTaskExecutor implements TaskExecutor {
  constructor(
    private readonly provider: LlmProviderConfig,
    private readonly registry?: PluginRegistry,
    private readonly onProgress?: (event: LlmExecutorEvent) => void,
  ) {}

  async execute(
    node: GraphNode,
    lease: WorkspaceLease,
    runId: string,
    attempt: number,
    options: LlmExecuteOptions = {},
  ): Promise<TaskResult> {
    const prompt = buildNodePrompt(node, lease, runId, attempt, { previousError: options.previousError ?? null });
    const tools = selectToolsForActions(node.actions);
    const cwd = lease.root_path;
    const maxTurns = this.provider.maxTurns ?? 10;
    const systemPrompt = this.provider.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    let finalOutput = '';
    const evidencePaths: string[] = [];
    let completedByFinishTask = false;
    let finishTaskSummary = '';

    let turn = 0;
    for (; turn < maxTurns; turn++) {
      this.emit({ type: 'turn_start', nodeId: node.id, attempt, detail: { turn } });

      let response;
      try {
        response = await streamCompletion({
          baseUrl: this.provider.baseUrl,
          apiKey: this.provider.apiKey,
          model: this.provider.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          maxTokens: this.provider.maxTokens,
          timeoutMs: this.provider.timeoutMs,
        });
      } catch (err) {
        return { success: false, failure_class: 'env', evidence: evidencePaths, output: String(err) };
      }

      this.emit({ type: 'turn_complete', nodeId: node.id, attempt, detail: { turn, finish_reason: response.finish_reason } });

      if (response.content) finalOutput = response.content;

      if (!response.tool_calls.length) break;

      messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.tool_calls,
      });

      // Partition: idempotent tools run concurrently, mutations run serially
      const [concurrent, serial] = partitionToolCalls(response.tool_calls, tools);

      const concurrentResults = await Promise.all(
        concurrent.map((tc) => this.invokeToolCall(tc, cwd, node, evidencePaths)),
      );
      const serialResults: ChatMessage[] = [];
      for (const tc of serial) {
        serialResults.push(await this.invokeToolCall(tc, cwd, node, evidencePaths));
      }

      messages.push(...concurrentResults, ...serialResults);

      // Detect finish_task call — authoritative completion signal
      const allResults = [...concurrentResults, ...serialResults];
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
      return {
        success: false,
        failure_class: 'llm',
        evidence: evidencePaths,
        output: finalOutput || `Task exhausted ${maxTurns} turns without calling finish_task`,
        completed_by: completedBy,
      };
    }

    return {
      success: true,
      failure_class: null,
      evidence: evidencePaths,
      output: completedByFinishTask ? (finishTaskSummary || finalOutput) : finalOutput,
      completed_by: completedBy,
    };
  }

  private async invokeToolCall(
    tc: ToolCall,
    cwd: string,
    node: GraphNode,
    evidencePaths: string[],
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
    if (builtIn) {
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
      content: result,
    };
  }

  private emit(event: LlmExecutorEvent): void {
    this.onProgress?.(event);
  }
}

function partitionToolCalls(
  toolCalls: ToolCall[],
  schemas: ToolSchema[],
): [ToolCall[], ToolCall[]] {
  const idempotentNames = new Set(
    schemas
      .map((s) => s.function.name)
      .filter((name) => BUILT_IN_TOOLS[name]?.idempotent ?? true),
  );
  const concurrent = toolCalls.filter((tc) => idempotentNames.has(tc.function.name));
  const serial = toolCalls.filter((tc) => !idempotentNames.has(tc.function.name));
  return [concurrent, serial];
}
