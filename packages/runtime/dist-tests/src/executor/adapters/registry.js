"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXECUTOR_ADAPTER_IDS = void 0;
exports.normalizeExecutorAdapterId = normalizeExecutorAdapterId;
exports.isExecutorAdapterId = isExecutorAdapterId;
exports.createExecutorAdapter = createExecutorAdapter;
exports.detectExecutorAdapters = detectExecutorAdapters;
const antigravity_cli_1 = require("./antigravity-cli");
const claude_cli_1 = require("./claude-cli");
const http_openai_1 = require("./http-openai");
exports.EXECUTOR_ADAPTER_IDS = ['claude', 'antigravity', 'http'];
function normalizeExecutorAdapterId(value) {
    const clean = String(value || '').trim().toLowerCase();
    if (clean === 'agy' || clean === 'antigravity')
        return 'antigravity';
    if (clean === 'claude')
        return 'claude';
    if (clean === 'http')
        return 'http';
    return null;
}
function isExecutorAdapterId(value) {
    return exports.EXECUTOR_ADAPTER_IDS.includes(value);
}
function createExecutorAdapter(id, options = {}) {
    const normalized = normalizeExecutorAdapterId(id);
    switch (normalized) {
        case 'claude':
            return new claude_cli_1.ClaudeCliAdapter(options.claude);
        case 'antigravity':
            return new antigravity_cli_1.AntigravityCliAdapter(options.antigravity);
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
