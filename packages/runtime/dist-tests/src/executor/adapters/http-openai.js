"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpOpenAiAdapter = void 0;
const stream_completion_1 = require("../stream-completion");
/** OpenAI-compatible `/chat/completions` over HTTP — the pre-1.18 behavior. */
class HttpOpenAiAdapter {
    constructor() {
        this.id = 'http';
        this.requiresApiKey = true;
    }
    detect() {
        return { available: true, version: null, binary: null, error: null };
    }
    createCompletion() {
        return stream_completion_1.streamCompletion;
    }
}
exports.HttpOpenAiAdapter = HttpOpenAiAdapter;
