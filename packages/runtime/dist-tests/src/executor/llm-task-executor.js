"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmTaskExecutor = void 0;
exports.partitionToolCalls = partitionToolCalls;
const stream_completion_1 = require("./stream-completion");
const built_in_tools_1 = require("./built-in-tools");
const action_tool_map_1 = require("./action-tool-map");
const node_prompt_builder_1 = require("./node-prompt-builder");
const path_1 = __importDefault(require("path"));
function normalizeRel(p) {
    return path_1.default.normalize(String(p || '')).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}
const DEFAULT_SYSTEM_PROMPT = 'You are a precise software engineering agent. Use the tools provided to complete the task. ' +
    'When all actions are done, call finish_task with a summary of what was accomplished.';
class LlmTaskExecutor {
    constructor(provider, registry, onProgress, complete = stream_completion_1.streamCompletion, options = {}) {
        this.provider = provider;
        this.registry = registry;
        this.onProgress = onProgress;
        this.complete = complete;
        this.options = options;
    }
    async execute(node, lease, runId, attempt, options = {}) {
        let context = null;
        try {
            context = this.options.contextProvider?.(node, lease) ?? null;
        }
        catch {
            // Context is an aid, never a reason to fail the attempt.
        }
        const prompt = (0, node_prompt_builder_1.buildNodePrompt)(node, lease, runId, attempt, { previousError: options.previousError ?? null, context });
        const tools = (0, action_tool_map_1.selectToolsForActions)(node.actions);
        // Only the tools offered for this node's actions may run; the model can still name others.
        const allowedTools = new Set(tools.map((tool) => tool.function.name));
        const cwd = lease.root_path;
        const maxTurns = this.provider.maxTurns ?? 10;
        const systemPrompt = this.provider.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ];
        let finalOutput = '';
        const evidencePaths = [];
        let completedByFinishTask = false;
        let finishTaskSummary = '';
        const usage = { turns: 0, tool_calls: 0, cost_usd: null, tools: {} };
        const done = (result) => {
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
        for (; turn < maxTurns; turn++) {
            this.emit({ type: 'turn_start', nodeId: node.id, attempt, detail: { turn } });
            let response;
            try {
                response = await this.complete({
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
                return done({ success: false, failure_class: 'env', evidence: evidencePaths, output: String(err) });
            }
            usage.turns += 1;
            if (typeof response.usage?.cost_usd === 'number')
                usage.cost_usd = (usage.cost_usd ?? 0) + response.usage.cost_usd;
            usage.tool_calls += response.tool_calls.length;
            for (const tc of response.tool_calls)
                usage.tools[tc.function.name] = (usage.tools[tc.function.name] ?? 0) + 1;
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
            const [concurrent, serial] = partitionToolCalls(response.tool_calls, this.registry ?? undefined);
            const concurrentResults = await Promise.all(concurrent.map((tc) => this.invokeToolCall(tc, cwd, node, evidencePaths, allowedTools)));
            const serialResults = [];
            for (const tc of serial) {
                serialResults.push(await this.invokeToolCall(tc, cwd, node, evidencePaths, allowedTools));
            }
            messages.push(...concurrentResults, ...serialResults);
            // Detect finish_task call — authoritative completion signal
            const allResults = [...concurrentResults, ...serialResults];
            const finishResult = allResults.find((r) => r.name === 'finish_task');
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
                catch { /* ignore parse errors */ }
                if (completedByFinishTask)
                    break;
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
                failure_class: 'llm',
                evidence: evidencePaths,
                output: finalOutput || `Task exhausted ${maxTurns} turns without calling finish_task`,
                completed_by: completedBy,
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
    async invokeToolCall(tc, cwd, node, evidencePaths, allowedTools) {
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
        const writesFile = tc.function.name === 'write_file' || tc.function.name === 'patch_file';
        const protectedTarget = writesFile && typeof args.path === 'string' && this.isProtected(args.path, cwd);
        if (protectedTarget) {
            this.emit({ type: 'tool_denied', nodeId: node.id, attempt: 0, detail: { tool: tc.function.name, path: args.path, reason: 'frozen_acceptance_test' } });
            result = `[tool denied: ${String(args.path)} is a frozen acceptance test owned by the plan — implement the code so this test passes; do not edit it]`;
        }
        else if (builtIn && !allowedTools.has(tc.function.name)) {
            this.emit({ type: 'tool_denied', nodeId: node.id, attempt: 0, detail: { tool: tc.function.name } });
            result = `[tool denied: ${tc.function.name} is not permitted for this task]`;
        }
        else if (builtIn) {
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
    isProtected(target, cwd) {
        const list = this.options.protectedPaths ?? [];
        if (!list.length)
            return false;
        const rel = normalizeRel(path_1.default.isAbsolute(target) ? path_1.default.relative(cwd, target) : target);
        return list.some((p) => normalizeRel(p) === rel);
    }
    emit(event) {
        this.onProgress?.(event);
    }
}
exports.LlmTaskExecutor = LlmTaskExecutor;
/** Only tools known to be idempotent run concurrently; anything unknown is treated as a mutation. */
function partitionToolCalls(toolCalls, registry) {
    const isIdempotent = (name) => built_in_tools_1.BUILT_IN_TOOLS[name]?.idempotent ?? registry?.toolProviderFor(name)?.idempotent ?? false;
    const concurrent = toolCalls.filter((tc) => isIdempotent(tc.function.name));
    const serial = toolCalls.filter((tc) => !isIdempotent(tc.function.name));
    return [concurrent, serial];
}
