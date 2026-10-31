"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const stream_completion_1 = require("../src/executor/stream-completion");
// Regressão: `new URL('/chat/completions', base)` descartava o prefixo `/v1` e o runtime batia
// em `https://api.anthropic.com/chat/completions` (404) com a configuração padrão.
(0, node_test_1.describe)('buildChatCompletionsUrl', () => {
    (0, node_test_1.test)('preserva o prefixo /v1 da base', () => {
        strict_1.default.equal((0, stream_completion_1.buildChatCompletionsUrl)('https://api.anthropic.com/v1').href, 'https://api.anthropic.com/v1/chat/completions');
        strict_1.default.equal((0, stream_completion_1.buildChatCompletionsUrl)('https://api.openai.com/v1/').href, 'https://api.openai.com/v1/chat/completions');
        strict_1.default.equal((0, stream_completion_1.buildChatCompletionsUrl)('http://127.0.0.1:8787/v1').href, 'http://127.0.0.1:8787/v1/chat/completions');
    });
    (0, node_test_1.test)('base sem path continua funcionando', () => {
        strict_1.default.equal((0, stream_completion_1.buildChatCompletionsUrl)('http://localhost:11434').href, 'http://localhost:11434/chat/completions');
        strict_1.default.equal((0, stream_completion_1.buildChatCompletionsUrl)('http://localhost:11434///').href, 'http://localhost:11434/chat/completions');
    });
});
