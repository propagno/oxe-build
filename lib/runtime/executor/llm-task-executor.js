"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmTaskExecutor = void 0;
const stream_completion_1 = require("./stream-completion");
const built_in_tools_1 = require("./built-in-tools");
const action_tool_map_1 = require("./action-tool-map");
const node_prompt_builder_1 = require("./node-prompt-builder");
const DEFAULT_SYSTEM_PROMPT = 'You are a precise software engineering agent. Use the tools provided to complete the task. ' +
    'When the task is done, summarize what was accomplished in your final message without calling any tools.';
class LlmTaskExecutor {
    constructor(provider, registry, onProgress) {
        this.provider = provider;
        this.registry = registry;
        this.onProgress = onProgress;
    }
    async execute(node, lease, runId, attempt, options = {}) {
        // Gap 3: pass previousError to prompt builder for retry context
        const prompt = (0, node_prompt_builder_1.buildNodePrompt)(node, lease, runId, attempt, { previousError: options.previousError ?? null });
        const tools = (0, action_tool_map_1.selectToolsForActions)(node.actions);
        const cwd = lease.root_path;
        const maxTurns = this.provider.maxTurns ?? 10;
        const systemPrompt = this.provider.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ];
        let finalOutput = '';
        const evidencePaths = [];
        // Gap 4: track authoritative completion signal
        let completedByFinishTask = false;
        let finishTaskSummary = '';
        let turn = 0;
        for (; turn < maxTurns; turn++) {
            this.emit({ type: 'turn_start', nodeId: node.id, attempt, detail: { turn } });
            let response;
            try {
                response = await (0, stream_completion_1.streamCompletion)({
                    baseUrl: this.provider.baseUrl,
                    apiKey: this.provider.apiKey,
                    model: this.provider.model,
                    messages,
                    tools: tools.length > 0 ? tools : undefined,
                    maxTokens: this.provider.maxTokens,
                    timeoutMs: this.provider.timeoutMs,
                });
            }
            catch (err) {
                return { success: false, failure_class: 'env', evidence: evidencePaths, output: String(err) };
            }
            this.emit({ type: 'turn_complete', nodeId: node.id, attempt, detail: { turn, finish_reason: response.finish_reason } });
            if (response.content)
                finalOutput = response.content;
            if (!response.tool_calls.length)
                break;
            messages.push({
                role: 'assistant',
                content: response.content || null,
                tool_calls: response.tool_calls,
            });
            // Partition: idempotent tools run concurrently, mutations run serially
            const [concurrent, serial] = partitionToolCalls(response.tool_calls, tools);
            const concurrentResults = await Promise.all(concurrent.map((tc) => this.invokeToolCall(tc, cwd, node, evidencePaths)));
            const serialResults = [];
            for (const tc of serial) {
                serialResults.push(await this.invokeToolCall(tc, cwd, node, evidencePaths));
            }
            messages.push(...concurrentResults, ...serialResults);
            // Gap 4: detect finish_task call — exit loop immediately after processing
            const finishResult = [...concurrentResults, ...serialResults].find((r) => r.name === 'finish_task');
            if (finishResult) {
                try {
                    const parsed = JSON.parse(finishResult.content);
                    if (parsed.__finish_task__) {
                        completedByFinishTask = true;
                        finishTaskSummary = parsed.summary || '';
                        if (Array.isArray(parsed.evidence_paths)) {
                            evidencePaths.push(...parsed.evidence_paths.filter((p) => typeof p === 'string'));
                        }
                    }
                }
                catch { /* malformed finish_task result — treat as not called */ }
                if (completedByFinishTask)
                    break;
            }
        }
        // Gap 4: determine completion_by signal and handle turn limit exhaustion
        const completedBy = completedByFinishTask
            ? 'finish_task'
            : (turn < maxTurns ? 'no_tool_call' : 'turn_limit_exhausted');
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
            output: completedByFinishTask ? finishTaskSummary || finalOutput : finalOutput,
            completed_by: completedBy,
        };
    }
    async invokeToolCall(tc, cwd, node, evidencePaths) {
        this.emit({ type: 'tool_call', nodeId: node.id, attempt: 0, detail: { tool: tc.function.name } });
        let args = {};
        try {
            args = JSON.parse(tc.function.arguments || '{}');
        }
        catch {
            // malformed args — pass empty
        }
        let result;
        const builtIn = built_in_tools_1.BUILT_IN_TOOLS[tc.function.name];
        if (builtIn) {
            try {
                result = await builtIn.execute(args, cwd);
                if (tc.function.name === 'write_file' || tc.function.name === 'patch_file') {
                    if (typeof args.path === 'string')
                        evidencePaths.push(args.path);
                }
            }
            catch (err) {
                result = `[tool error] ${err}`;
            }
        }
        else {
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
                }
                catch (err) {
                    result = `[plugin error] ${err}`;
                }
            }
            else {
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
    emit(event) {
        this.onProgress?.(event);
    }
}
exports.LlmTaskExecutor = LlmTaskExecutor;
function partitionToolCalls(toolCalls, schemas) {
    const idempotentNames = new Set(schemas
        .map((s) => s.function.name)
        .filter((name) => built_in_tools_1.BUILT_IN_TOOLS[name]?.idempotent ?? true));
    const concurrent = toolCalls.filter((tc) => idempotentNames.has(tc.function.name));
    const serial = toolCalls.filter((tc) => !idempotentNames.has(tc.function.name));
    return [concurrent, serial];
}
