"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXECUTOR_ADAPTER_IDS = void 0;
exports.isExecutorAdapterId = isExecutorAdapterId;
exports.createExecutorAdapter = createExecutorAdapter;
exports.detectExecutorAdapters = detectExecutorAdapters;
const claude_cli_1 = require("./claude-cli");
const http_openai_1 = require("./http-openai");
exports.EXECUTOR_ADAPTER_IDS = ['claude', 'http'];
function isExecutorAdapterId(value) {
    return exports.EXECUTOR_ADAPTER_IDS.includes(value);
}
function createExecutorAdapter(id, options = {}) {
    switch (id) {
        case 'claude':
            return new claude_cli_1.ClaudeCliAdapter(options.claude);
        case 'http':
            return new http_openai_1.HttpOpenAiAdapter();
        default:
            throw new Error(`Adapter de executor desconhecido: ${String(id)}`);
    }
}
/** Detection result for every known adapter (`oxe-cc runtime providers`). */
function detectExecutorAdapters(options = {}) {
    return exports.EXECUTOR_ADAPTER_IDS.map((id) => {
        const adapter = createExecutorAdapter(id, options);
        return { id, requires_api_key: adapter.requiresApiKey, ...adapter.detect() };
    });
}
